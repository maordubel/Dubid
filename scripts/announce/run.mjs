/**
 * DUBID announcements runner (GitHub Actions). Claims pending rows from game.announce_outbox, renders a card for the ones
 * that get one, sends to Telegram, and marks the row. Secrets come from the environment only and are never printed.
 * A send whose outcome is unknown is marked 'unknown' and never retried automatically.
 */
import {createClient} from '@supabase/supabase-js'
import {chromium} from 'playwright'
import {cardHtml, textFor, wantsCard} from './format.mjs'

const url = process.env.SUPABASE_URL || ''
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const token = process.env.TELEGRAM_BOT_TOKEN || ''
if (!url || !key) { console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing.'); process.exit(1) }
if (!token) { console.error('TELEGRAM_BOT_TOKEN is missing.'); process.exit(1) }

const sb = createClient(url, key, {auth: {persistSession: false}, db: {schema: 'game'}})
const scrub = (s) => String(s ?? '').split(token).join('[token]').slice(0, 250)

/** the owner's chat is the one FINAL WHISTLE already linked (same project, same bot) */
async function chatId() {
  if (process.env.DUBID_TELEGRAM_CHAT_ID) return process.env.DUBID_TELEGRAM_CHAT_ID
  const r = await createClient(url, key, {auth: {persistSession: false}, db: {schema: 'public'}})
    .from('worker_fanlife_files').select('body').eq('name', 'final-whistle/destination.json').maybeSingle()
  try { return JSON.parse(r.data?.body ?? 'null')?.chatId ?? null } catch { return null }
}

async function tg(method, body) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {method: 'POST', body, signal: AbortSignal.timeout(30_000)})
    const j = await r.json().catch(() => null)
    if (j?.ok) return {ok: true}
    // 4xx = Telegram refused: nothing was sent, safe to retry later. 5xx / unreadable = we cannot know.
    return r.status >= 400 && r.status < 500 && r.status !== 429 ? {ok: false, kind: 'failed', error: `telegram ${r.status}: ${j?.description ?? ''}`} : {ok: false, kind: 'failed', error: `telegram ${r.status} (retry)`, retry: true}
  } catch (e) {
    return {ok: false, kind: 'unknown', error: scrub(e?.message)}
  }
}

const chat = await chatId()
if (!chat) { console.log('No Telegram chat is linked yet (Fan Life → Final Whistle → Link Telegram). Nothing sent.'); process.exit(0) }

const {data: jobs, error} = await sb.rpc('announce_claim', {p_limit: 4})
if (error) { console.error('claim failed:', scrub(error.message)); process.exit(1) }
if (!jobs?.length) { console.log('nothing to do'); process.exit(0) }

const browser = jobs.some((j) => wantsCard(j.kind)) ? await chromium.launch() : null
try {
  for (const job of jobs) {
    console.log('job', job.id, job.kind, job.gw_code)
    let res
    try {
      if (wantsCard(job.kind)) {
        const page = await browser.newPage({viewport: {width: 1080, height: 1350}})
        await page.setContent(cardHtml(job), {waitUntil: 'networkidle'})
        await page.evaluate(() => document.fonts.ready)
        const png = await page.screenshot({type: 'png'})
        await page.close()
        const f = new FormData()
        f.set('chat_id', chat); f.set('caption', textFor(job).slice(0, 1000)); f.set('parse_mode', 'HTML')
        f.set('photo', new Blob([png], {type: 'image/png'}), `dubid-${job.gw_code}-${job.kind}.png`)
        res = await tg('sendPhoto', f)
      } else {
        const f = new FormData()
        f.set('chat_id', chat); f.set('text', textFor(job)); f.set('parse_mode', 'HTML'); f.set('disable_web_page_preview', 'true')
        res = await tg('sendMessage', f)
      }
    } catch (e) {
      res = {ok: false, kind: 'failed', error: `render: ${scrub(e?.message)}`}
    }
    await sb.rpc('announce_mark', {p_id: job.id, p_state: res.ok ? 'sent' : res.kind, p_error: res.ok ? null : res.error})
    console.log(res.ok ? 'sent' : `not sent: ${res.kind}`)
  }
} finally { await browser?.close() }
