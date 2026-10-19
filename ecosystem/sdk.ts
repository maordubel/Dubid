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

export type AppId = 'fanlife' | 'theworker' | 'dubid' | 'offsides' | 'fuckyou'
export const APPS: readonly AppId[] = ['fanlife', 'dubid', 'offsides', 'theworker', 'fuckyou']

/** FAN LIFE UNIVERSE — the owner's vision (19.10.2026). Mirrors shared.apps / shared.app_moments. */
export type AppRole = 'hub' | 'companion' | 'club-edition' | 'side-experience'
export const ROLE: Record<AppId, AppRole> = {
  fanlife: 'hub', dubid: 'companion', offsides: 'companion', theworker: 'club-edition', fuckyou: 'side-experience',
}
/** The named moment that carries a person from one app to another. */
export type Moment = 'before_round' | 'back_to_story' | 'next_moment' | 'kickoff_live' | 'go_deeper' | 'bring_depth_back' | 'derby_only'
export const MOMENTS: readonly { from: AppId; to: AppId; moment: Moment }[] = [
  { from: 'fanlife', to: 'dubid', moment: 'before_round' },
  { from: 'dubid', to: 'fanlife', moment: 'back_to_story' },
  { from: 'dubid', to: 'offsides', moment: 'next_moment' },
  { from: 'offsides', to: 'dubid', moment: 'next_moment' },
  { from: 'fanlife', to: 'offsides', moment: 'kickoff_live' },
  { from: 'offsides', to: 'fanlife', moment: 'back_to_story' },
  { from: 'fanlife', to: 'theworker', moment: 'go_deeper' },
  { from: 'theworker', to: 'fanlife', moment: 'bring_depth_back' },
  { from: 'fanlife', to: 'fuckyou', moment: 'derby_only' },
  { from: 'fuckyou', to: 'fanlife', moment: 'back_to_story' },
]
/** The moment of a route, if the universe names one. */
export function momentOf(from: AppId, to: AppId): Moment | null {
  return MOMENTS.find(m => m.from === from && m.to === to)?.moment ?? null
}

export const APP_URL: Record<AppId, string> = {
  fanlife: 'https://fanlife.dubelteam.com',
  theworker: 'https://theworker.dubelteam.com',
  dubid: 'https://dubid.dubelteam.com',
  offsides: 'https://offsides.dubelteam.com',
  fuckyou: 'https://fuckyou.dubelteam.com',
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

/** `moment` defaults to the universe's moment for the route; the server records it from the campaign prefix. */
export type HandoffInput = { from: AppId; to: AppId; club?: string | null; campaign?: string | null; moment?: Moment | null; path?: string }

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
  const moment = h.moment === undefined ? momentOf(h.from, h.to) : h.moment
  const raw = moment ? (h.campaign ? `${moment}-${h.campaign}` : moment) : (h.campaign ?? null)
  const campaign = raw && CAMPAIGN.test(raw.slice(0, 60)) ? raw.slice(0, 60) : null
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

/** The public map of the universe (apps + moments), as the database holds it. */
export function universe(client: SharedClient | null | undefined) {
  return call<{ apps: { id: AppId; role: AppRole; name: string; url: string; promise: string; status: string }[]; moments: { from: AppId; to: AppId; moment: Moment; label: string }[] }>(client, 'universe')
}

/** The usual sequence once a session is known: touch, then claim. */
export async function arrived(client: SharedClient | null | undefined, app: AppId) {
  const t = await touchApp(client, app)
  const c = await claimHandoff(client, app)
  return { touch: t, claim: c }
}

/** The exact ids of a FAN LIFE club across the universe (core.teams uuid + provider refs). */
export function clubIdentity(client: SharedClient | null | undefined, slug: string) {
  return call<{ club: string; team_id: string; name_en: string | null; name_he: string | null; refs: Record<string, string> }>(client, 'club_identity', { p_slug: slug })
}

/* ── SSO: one account across *.dubelteam.com ─────────────────────────────────
 * Every app on Football Master reads ONE session cookie on the parent domain,
 * in exactly the format @supabase/ssr writes ("base64-" + base64url(JSON),
 * chunked at 3180 chars as <name>.0, <name>.1 …). Next apps get it by giving
 * @supabase/ssr `cookieOptions: { domain: ssoCookieDomain(host) }`; a plain
 * supabase-js app (DUBID) passes `ssoStorage()` as `auth.storage`.
 *
 * Anonymous sessions are NEVER shared: a guest stays a guest of the app that
 * made it (in that app's localStorage). Only a real account crosses apps.
 * When a real account appears while the app still holds a local guest, the
 * guest session is parked under `<key>.guest` so the app can carry the guest's
 * progress over (DUBID: issue a merge token as the guest, claim it as the user).
 */
export const SSO_PARENT = '.dubelteam.com'
export const SSO_REF = 'afxpjfxwpdjvlmuoawda'
export const SSO_COOKIE = `sb-${SSO_REF}-auth-token`
const CHUNK = 3180
const B64 = 'base64-'

/** The cookie domain for this host: the parent domain in production, host-only elsewhere (localhost, previews). */
export function ssoCookieDomain(hostname: string): string | undefined {
  const h = hostname.toLowerCase()
  return h === 'dubelteam.com' || h.endsWith(SSO_PARENT) ? SSO_PARENT : undefined
}

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64urlDecode(s: string): string {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  const bin = atob(pad)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

type Jar = { read: () => Record<string, string>; write: (name: string, value: string, maxAge: number) => void }

function documentJar(domain: string | undefined): Jar {
  return {
    read() {
      const out: Record<string, string> = {}
      for (const part of (typeof document === 'undefined' ? '' : document.cookie).split(';')) {
        const i = part.indexOf('=')
        if (i < 1) continue
        const k = part.slice(0, i).trim()
        if (!(k in out)) { try { out[k] = decodeURIComponent(part.slice(i + 1).trim()) } catch { /* skip */ } }
      }
      return out
    },
    write(name, value, maxAge) {
      if (typeof document === 'undefined') return
      const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : ''
      document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${domain ? `; Domain=${domain}` : ''}${secure}`
    },
  }
}

/** The JSON of the shared session, or null. */
export function readSsoCookie(jar: Pick<Jar, 'read'>, name = SSO_COOKIE): string | null {
  const all = jar.read()
  let raw: string | null = all[name] ?? null
  if (!raw) {
    const parts: string[] = []
    for (let i = 0; ; i++) { const part = all[`${name}.${i}`]; if (!part) break; parts.push(part) }
    raw = parts.length ? parts.join('') : null
  }
  if (!raw) return null
  try { return raw.startsWith(B64) ? b64urlDecode(raw.slice(B64.length)) : raw } catch { return null }
}

function writeSsoCookie(jar: Jar, json: string | null, name = SSO_COOKIE) {
  const existing = Object.keys(jar.read()).filter((k) => k === name || k.startsWith(`${name}.`))
  const keep = new Set<string>()
  if (json) {
    const enc = B64 + b64urlEncode(json)
    if (enc.length <= CHUNK) { jar.write(name, enc, 400 * 864e2); keep.add(name) } else {
      for (let i = 0, n = 0; i < enc.length; i += CHUNK, n++) { jar.write(`${name}.${n}`, enc.slice(i, i + CHUNK), 400 * 864e2); keep.add(`${name}.${n}`) }
    }
  }
  for (const k of existing) if (!keep.has(k)) jar.write(k, '', 0)
}

function isRealSession(json: string | null): boolean {
  if (!json) return false
  try {
    const s = JSON.parse(json) as { access_token?: string; user?: { is_anonymous?: boolean } }
    return !!s?.access_token && !!s.user && s.user.is_anonymous !== true
  } catch { return false }
}

/**
 * supabase-js `auth.storage` for an app that is not on @supabase/ssr.
 * The app's own `storageKey` keeps guests and non-session values (PKCE
 * verifier) local; a real session lives in the shared cookie.
 */
export function ssoStorage(opts: { storageKey: string; hostname?: string; jar?: Jar; local?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null } ) {
  const host = opts.hostname ?? (typeof location !== 'undefined' ? location.hostname : '')
  const jar = opts.jar ?? documentJar(ssoCookieDomain(host))
  const local = opts.local !== undefined ? opts.local : storage()
  const key = opts.storageKey
  const guestKey = `${key}.guest`
  return {
    getItem(k: string): string | null {
      const mine = (() => { try { return local?.getItem(k) ?? null } catch { return null } })()
      if (k !== key) return mine
      const shared = readSsoCookie(jar)
      if (isRealSession(shared)) {
        if (mine && !isRealSession(mine)) { try { local?.setItem(guestKey, mine); local?.removeItem(k) } catch { /* */ } }
        return shared
      }
      return mine
    },
    setItem(k: string, v: string): void {
      if (k === key && isRealSession(v)) {
        writeSsoCookie(jar, v)
        try { local?.removeItem(k) } catch { /* */ }
        return
      }
      try { local?.setItem(k, v) } catch { /* */ }
    },
    removeItem(k: string): void {
      try { local?.removeItem(k) } catch { /* */ }
      if (k === key && isRealSession(readSsoCookie(jar))) writeSsoCookie(jar, null)
    },
  }
}

/** A guest session parked by `ssoStorage` when a real account arrived; read once, then forgotten. */
export function takeParkedGuest(storageKey: string): { access_token: string; refresh_token: string } | null {
  const s = storage()
  try {
    const raw = s?.getItem(`${storageKey}.guest`)
    s?.removeItem(`${storageKey}.guest`)
    const v = raw ? JSON.parse(raw) as { access_token?: string; refresh_token?: string } : null
    return v?.access_token && v.refresh_token ? { access_token: v.access_token, refresh_token: v.refresh_token } : null
  } catch { return null }
}
