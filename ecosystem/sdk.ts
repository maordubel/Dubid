/**
 * ecosystem/sdk.ts — the one client for the shared layer (schema `shared`).
 * Byte-identical in fanlife, Offsides, Dubid and The-Worker. Change it in one
 * repo => the same bytes in the other three, same round (ecosystem/contract.json).
 *
 * No imports on purpose: it takes whatever Supabase client the app already has
 * (supabase-js v2 or @supabase/ssr), so it fits Next, Vite/React and edge code.
 * Every call returns a value and never throws: the shared layer must never be
 * the reason a page breaks.
 *
 * OFFSIDES note: until phase 4 Offsides talks to a different project, so it may
 * build links (`appUrl`) but must not call these RPCs with its own client.
 */

export type AppId = 'fanlife' | 'theworker' | 'dubid' | 'offsides'
export const APPS: readonly AppId[] = ['fanlife', 'theworker', 'dubid', 'offsides']

export const APP_URL: Record<AppId, string> = {
  fanlife: 'https://fanlife.dubelteam.com',
  theworker: 'https://theworker.dubelteam.com',
  dubid: 'https://dubid.dubelteam.com',
  offsides: 'https://offsides.dubelteam.com',
}

/** The query parameter a handoff travels in. */
export const HANDOFF_PARAM = 'eh'
const STASH_KEY = 'dubel.handoff.v1'
const SLUG = /^[a-z0-9][a-z0-9-]{1,59}$/
const CAMPAIGN = /^[a-z0-9][a-z0-9_-]{0,59}$/
const TOKEN = /^[0-9a-f]{64}$/

type RpcResult = { data: unknown; error: unknown }
type RpcTarget = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> }
/** Any supabase-js v2 client: `client.schema('shared').rpc(...)`. */
export type SharedClient = { schema: (name: string) => RpcTarget }

export type SharedResult<T = Record<string, unknown>> = ({ ok: true } & T) | { ok: false; error: string }

async function call<T>(client: SharedClient | null | undefined, fn: string, args?: Record<string, unknown>): Promise<SharedResult<T>> {
  if (!client) return { ok: false, error: 'no_client' }
  try {
    const { data, error } = await client.schema('shared').rpc(fn, args)
    if (error) return { ok: false, error: 'rpc_error' }
    const d = data as { ok?: boolean; error?: string } | null
    if (!d || d.ok !== true) return { ok: false, error: d?.error ?? 'unknown' }
    return d as SharedResult<T>
  } catch {
    return { ok: false, error: 'network' }
  }
}

/** "I am using this app." Call once a session exists (anonymous sessions count). */
export function touchApp(client: SharedClient | null | undefined, app: AppId) {
  return call<{ first: boolean }>(client, 'app_touch', { p_app: app })
}

/** My person row and the apps I use. */
export function me(client: SharedClient | null | undefined) {
  return call<{ person: Record<string, unknown> | null; apps: { app: AppId; first_seen: string; last_seen: string; source_app: AppId | null }[] }>(client, 'me')
}

/** Update my shared profile; null keeps the current value. */
export function updatePerson(client: SharedClient | null | undefined, p: { displayName?: string | null; favouriteClub?: string | null; locale?: string | null }) {
  return call(client, 'person_update', {
    p_display_name: p.displayName ?? null,
    p_favourite_club: p.favouriteClub ?? null,
    p_locale: p.locale ?? null,
  })
}

export type HandoffInput = { from: AppId; to: AppId; club?: string | null; campaign?: string | null; path?: string }

/** A plain link to another app (no tracking). */
export function appUrl(to: AppId, path = '/'): string {
  return APP_URL[to] + (path.startsWith('/') ? path : '/' + path)
}

/** Build the landing URL for a token. */
export function handoffUrl(to: AppId, token: string, path = '/'): string {
  const u = new URL(appUrl(to, path))
  u.searchParams.set(HANDOFF_PARAM, token)
  return u.toString()
}

/**
 * Create a tracked link to another app. Needs a session (or a service-role
 * client on a server). Falls back to the plain link if anything is refused —
 * a lead that cannot be counted is still a visitor worth sending.
 */
export async function createHandoff(client: SharedClient | null | undefined, h: HandoffInput): Promise<string> {
  const club = h.club && SLUG.test(h.club) ? h.club : null
  const campaign = h.campaign && CAMPAIGN.test(h.campaign) ? h.campaign : null
  const r = await call<{ token: string }>(client, 'handoff_create', { p_source: h.from, p_target: h.to, p_club: club, p_campaign: campaign })
  return r.ok ? handoffUrl(h.to, r.token, h.path) : appUrl(h.to, h.path)
}

function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

/**
 * On landing: read `?eh=` from the address, remove it from the bar, keep it
 * until it is claimed, and count the open (no session needed). Safe to call on
 * every page load.
 */
export async function receiveHandoff(client: SharedClient | null | undefined): Promise<void> {
  if (typeof window === 'undefined') return
  let token: string | null = null
  try {
    const u = new URL(window.location.href)
    token = u.searchParams.get(HANDOFF_PARAM)
    if (token) {
      u.searchParams.delete(HANDOFF_PARAM)
      window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash)
    }
  } catch { /* ignore */ }
  if (!token || !TOKEN.test(token)) return
  try { storage()?.setItem(STASH_KEY, JSON.stringify({ token, at: Date.now() })) } catch { /* ignore */ }
  await call(client, 'handoff_open', { p_token: token })
}

/**
 * Once a session exists in `app`: claim a kept token (first touch wins), then
 * forget it. Tokens older than 14 days are dropped without a call.
 */
export async function claimHandoff(client: SharedClient | null | undefined, app: AppId) {
  const s = storage()
  let kept: { token?: string; at?: number } | null = null
  try { kept = JSON.parse(s?.getItem(STASH_KEY) ?? 'null') } catch { kept = null }
  if (!kept?.token || !TOKEN.test(kept.token)) return { ok: false as const, error: 'none' }
  if (!kept.at || Date.now() - kept.at > 14 * 864e5) { try { s?.removeItem(STASH_KEY) } catch { /* */ } return { ok: false as const, error: 'expired' } }
  const r = await call<{ again: boolean; source_app: AppId; club: string | null; campaign: string | null }>(client, 'handoff_claim', { p_token: kept.token, p_app: app })
  if (r.ok || r.error === 'not_found') { try { s?.removeItem(STASH_KEY) } catch { /* */ } }
  return r
}

/** The usual sequence once a session is known: touch, then claim. */
export async function arrived(client: SharedClient | null | undefined, app: AppId) {
  const t = await touchApp(client, app)
  const c = await claimHandoff(client, app)
  return { touch: t, claim: c }
}
