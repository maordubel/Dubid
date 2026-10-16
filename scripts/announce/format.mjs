/**
 * DUBID announcements — pure formatting. No network, no secrets.
 * Text is Hebrew (this is DUBID's own voice). Times are Israel time.
 */
const TZ = 'Asia/Jerusalem'
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]))
const pts = (n) => { const v = Number(n); return Number.isInteger(v) ? String(v) : v.toFixed(1) }

export const when = (iso) => new Intl.DateTimeFormat('he-IL', {timeZone: TZ, weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false}).format(new Date(iso))
const hhmm = (iso) => new Intl.DateTimeFormat('he-IL', {timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false}).format(new Date(iso))
const day = (iso) => new Intl.DateTimeFormat('he-IL', {timeZone: TZ, weekday: 'long', day: 'numeric', month: 'numeric'}).format(new Date(iso))

/** the score of a match as "1-2" with home first, or null when it has no final score */
export const scoreOf = (m) => (m.status === 'finished' && m.homeGoals != null && m.awayGoals != null ? `${m.homeGoals}–${m.awayGoals}` : null)

export function textFor(job) {
  const p = job.payload
  const n = p.number
  switch (job.kind) {
    case 'opened':
      return [`<b>מחזור ${n} נפתח</b>`, ...p.matches.map((m) => `${esc(m.home)} – ${esc(m.away)} · ${esc(when(m.kickoff))}`), '', `ההגשות נסגרות ב-${esc(when(p.lockAt))}`, '', 'dubid.dubelteam.com'].join('\n')
    case 'reminder':
      return `<b>מחזור ${n}: שלוש שעות לנעילה</b>\nההגשות נסגרות ב-${esc(hhmm(p.lockAt))}. עד עכשיו הוגשו ${p.submitted} הרכבים.`
    case 'locked':
      return `<b>מחזור ${n} ננעל</b>\n${p.submitted} הרכבים הוגשו. עכשיו משחקים.`
    case 'published': {
      const lines = [`<b>מחזור ${n} – סיכום</b>`]
      for (const m of p.matches) lines.push(`${esc(m.home)} ${scoreOf(m) ?? 'ללא תוצאה'} ${esc(m.away)}`)
      if (p.round.length) { lines.push('', '<b>טבלת המחזור</b>'); p.round.slice(0, 5).forEach((r, i) => lines.push(`${i + 1}. ${esc(r.name)} · ${pts(r.points)}`)) }
      if (p.season.length) { lines.push('', '<b>הטבלה המצטברת</b>'); p.season.slice(0, 5).forEach((r, i) => lines.push(`${i + 1}. ${esc(r.name)} · ${pts(r.points)}`)) }
      lines.push('', 'dubid.dubelteam.com')
      return lines.join('\n')
    }
    case 'alert': return `<b>תקלה בקליטה${p.detail?.issue ? '' : ''}</b>\n${esc(job.gw_code ?? '')} · ${esc(p.kind)} (${esc(p.severity)})\nהמחזור לא יתפרסם עד שמישהו יסגור את ההתרעה ב-/admin → קליטה.`
    case 'stuck': return `<b>מחזור ${n} תקוע</b>`
    default: return `DUBID · ${esc(job.kind)}`
  }
}

/** kinds that get a picture card as well as text */
export const wantsCard = (kind) => kind === 'opened' || kind === 'published'

export function cardHtml(job) {
  const p = job.payload
  const rows = job.kind === 'opened'
    ? p.matches.map((m) => `<li><span class="t">${esc(m.home)} – ${esc(m.away)}</span><span class="v">${esc(hhmm(m.kickoff))}</span></li>`)
    : p.matches.map((m) => `<li><span class="t">${esc(m.home)} – ${esc(m.away)}</span><span class="v">${esc(scoreOf(m) ?? '—')}</span></li>`)
  const table = job.kind === 'published'
    ? (p.round.length ? `<h2>טבלת המחזור</h2><ol>${p.round.slice(0, 5).map((r) => `<li><span class="t">${esc(r.name)}</span><span class="v">${esc(pts(r.points))}</span></li>`).join('')}</ol>` : '')
    : ''
  const season = job.kind === 'published' && p.season.length
    ? `<h2>הטבלה המצטברת</h2><ol>${p.season.slice(0, 5).map((r) => `<li><span class="t">${esc(r.name)}</span><span class="v">${esc(pts(r.points))}</span></li>`).join('')}</ol>` : ''
  const head = job.kind === 'opened' ? `מחזור ${p.number} נפתח` : `מחזור ${p.number} – סיכום`
  const sub = job.kind === 'opened' ? `ההגשות נסגרות · ${esc(when(p.lockAt))}` : esc(day(p.matches[0]?.kickoff ?? new Date().toISOString()))
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;900&display=swap" rel="stylesheet"><style>
*{box-sizing:border-box;margin:0}body{width:1080px;height:1350px;background:#121110;color:#F6F3EB;font-family:'Heebo',sans-serif;padding:72px;display:flex;flex-direction:column;position:relative;overflow:hidden}
.bar{height:14px;background:#FF5B14;position:absolute;inset:0 0 auto 0}
.logo{font-size:44px;font-weight:900;letter-spacing:.04em;color:#FF5B14}
h1{font-size:96px;font-weight:900;line-height:1.05;margin-top:28px}.sub{font-size:36px;color:#C9C3B7;margin-top:12px}
h2{font-size:34px;font-weight:700;color:#FF5B14;margin:40px 0 10px}
ul,ol{list-style:none;padding:0}li{display:flex;justify-content:space-between;gap:24px;font-size:38px;padding:13px 0;border-bottom:2px solid rgba(246,243,235,.14)}
.v{font-weight:900;font-variant-numeric:tabular-nums;direction:ltr}.foot{margin-top:auto;font-size:30px;color:#8C857A}
</style></head><body><div class="bar"></div><div class="logo">DUBID</div><h1>${head}</h1><div class="sub">${sub}</div>
<h2>${job.kind === 'opened' ? 'המשחקים' : 'התוצאות'}</h2><ul>${rows.join('')}</ul>${table}${season}<div class="foot">dubid.dubelteam.com</div></body></html>`
}
