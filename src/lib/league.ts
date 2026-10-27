/**
 * lib/league.ts — איזו ליגה המשתמש משחק.
 *
 * ★ ערך שמור = ליגה **לא-ראשית** בלבד. בחירה בליגה הראשית (ישראל) מוחקת
 *   את המפתח, ולכן משתמש קיים לא רואה שום שינוי והשרת ממשיך לענות
 *   «בלי פרמטר = הראשית».
 * ★ המפתח `ui.league` בלי הקידומת `dubid.` — כדי שלא יימחק ב-purge.
 * ★ החלפת ליגה = רענון דף. מצב המשחק במודולים (סגלים, לוח, הרכב) הוא
 *   סינגלטון; ריענון הוא הדרך היחידה שמבטיחה שאף שריד של ליגה אחת לא נשאר
 *   על מסך של השנייה.
 */
import { supabase } from './supabase.ts';
import { track } from './analytics.ts';
import type { Locale } from './i18n/locales.ts';
import { setLeagueTimezone } from './leagueTz.ts';

const KEY = 'ui.league';
const CHOSEN = 'ui.league.chosen';   // ★ הבחירה הוצגה פעם אחת — לא מציגים שוב את שער הליגות

export function selectedLeague(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    return v && /^[A-Z0-9_]{2,32}$/.test(v) ? v : null;
  } catch { return null; }
}

export function hasChosenLeague(): boolean {
  try { return localStorage.getItem(CHOSEN) === '1'; } catch { return true; }
}

export function markLeagueChosen(): void {
  try { localStorage.setItem(CHOSEN, '1'); } catch { /* מצב פרטי */ }
}

export function chooseLeague(code: string | null, primary: boolean): void {
  markLeagueChosen();
  track('league_selected', { league_code: code ?? 'primary', source: 'gate' });
  try {
    if (!code || primary) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, code);
  } catch { /* מצב פרטי */ }
  window.location.reload();
}

export type ReadinessState = 'ready' | 'degraded' | 'blocked' | 'unknown';
/** כשירות פורמט — מחושב בשרת (game.format_readiness). unknown = הלקוח לא הצליח לקרוא. */
export interface FormatReadiness {
  mode: 'five' | 'full';
  state: ReadinessState;
  canSubmit: boolean;
  reasons: string[];
  checkedAt: string;
  dataUpdatedAt: string | null;
}

export interface PublicLeague {
  code: string;
  country: string;
  locale: Locale;
  dir: 'rtl' | 'ltr';
  timezone: string;
  names: Partial<Record<Locale, { full?: string }>>;
  primary: boolean;
  currentGameweek: string | null;
  /** יש מחזור נוכחי → אפשר להיכנס. אחרת כרטיס «בקרוב». */
  live?: boolean;
  round?: number | null;
  status?: string | null;
  lockAt?: string | null;
  entrants?: number;
  formats?: { five: FormatReadiness; full: FormatReadiness } | null;
}

/** CF-07: an error is not an empty catalog. `ok:false` = we could not ask; `ok:true, leagues:[]` = DUBID runs none. */
export type LeaguesResult = { ok: true; leagues: PublicLeague[] } | { ok: false };
export async function fetchLeaguesResult(): Promise<LeaguesResult> {
  try {
    const { data, error } = await supabase.rpc('leagues_public');
    if (error || !Array.isArray(data)) return { ok: false };
    return { ok: true, leagues: data as PublicLeague[] };
  } catch { return { ok: false }; }
}

export async function fetchLeagues(): Promise<PublicLeague[]> {
  const r = await fetchLeaguesResult();
  return r.ok ? r.leagues : [];
}

export function leagueName(l: Pick<PublicLeague, 'names'>, locale: Locale): string {
  return l.names?.[locale]?.full ?? l.names?.en?.full ?? l.names?.he?.full ?? '';
}

/** טוען את אזור הזמן של הליגה שנבחרה (או הראשית). כשל = נשארים על הקיים. */
export async function primeLeagueTimezone(): Promise<void> {
  try {
    const all = await fetchLeagues();
    const sel = selectedLeague();
    const l = sel ? all.find((x) => x.code === sel) : all.find((x) => x.primary);
    if (l) setLeagueTimezone(l.timezone);
  } catch { /* תצוגה בלבד */ }
}

/** האם הליגה ניתנת להכנסה: יש מחזור, ולא שני הפורמטים חסומים. unknown/חסר = לא חוסמים. */
export function leagueEnterable(l: Pick<PublicLeague, 'live' | 'currentGameweek' | 'formats'>): boolean {
  if (l.live === false || !l.currentGameweek) return false;
  const f = l.formats;
  if (!f) return true;
  return !(f.five?.state === 'blocked' && f.full?.state === 'blocked');
}


/* ------------------------------------------------------------------ *
 * Connected Football (FAN LIFE, 27.10.2026). A FAN LIFE card links here as
 *   /?league=<CODE>&format=<five|full|any>&gw=<id>&from=fanlife&club=<slug>&lang=<en|he|el>&src=<hub|club|gate>
 * (old links carry only league/from/club, and keep working). The params are
 * taken off the address at once (the hash and the rest stay) and kept in
 * memory AND for this tab — storage may be blocked, so every access is
 * guarded and memory is the source of truth for this page.
 *  · the league is decided by `resolveIncoming()` against the live catalog,
 *    BEFORE the app hydrates another league's data (App.bootOnce waits on it,
 *    with a short ceiling). A failed read keeps the intent and offers a retry
 *    (CF-07) — never a silent switch for someone who plays another league.
 *  · format/gw are a landing hint (`planLanding`, CF-04): never a reason to fail.
 *  · from/club/lang/src are the way back (`backLink`).
 * ------------------------------------------------------------------ */
const INCOMING = 'ui.league.incoming';
const LANDING = 'ui.league.landing';
const CODE = /^[A-Z][A-Z0-9_]{1,31}$/;
const GW = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/;
/** `?from=fanlife&club=<slug>&lang=&src=` — where the visitor came from on FAN LIFE (back_to_story, ecosystem contract). */
const BACK = 'ui.fanlife.back';
const CLUB = /^[a-z0-9][a-z0-9-]{1,59}$/;
export const FANLIFE_SITE = 'https://fanlife.dubelteam.com';
export type FanLifeLang = 'en' | 'he' | 'el';
export type FanLifeSrc = 'hub' | 'club' | 'gate';
export type LandingFormat = 'five' | 'full' | 'any';
export interface BackContext { club: string | null; lang: FanLifeLang; src: FanLifeSrc | null }
/** `league` = the league the card was about (null: not named) — the landing applies only there. */
export interface Landing { league: string | null; format: LandingFormat | null; gw: string | null }
export interface ParsedLink { league: string | null; landing: Landing | null; back: BackContext | null; any: boolean }

const LANGS: readonly FanLifeLang[] = ['en', 'he', 'el'];
const SRCS: readonly FanLifeSrc[] = ['hub', 'club', 'gate'];
const FORMATS: readonly LandingFormat[] = ['five', 'full', 'any'];
const PARAMS = ['league', 'format', 'gw', 'from', 'club', 'lang', 'src'] as const;

/** Pure: what a FAN LIFE link asked for. Anything invalid is simply dropped. */
export function parseIncomingLink(q: URLSearchParams): ParsedLink {
  const any = PARAMS.some((k) => q.get(k) !== null);
  const code = q.get('league');
  const league = code !== null && CODE.test(code) ? code : null;
  const f = q.get('format') as LandingFormat | null;
  const format = f && FORMATS.includes(f) ? f : null;
  const g = q.get('gw');
  const gw = g !== null && GW.test(g) ? g : null;
  const landing = format || gw ? { league, format, gw } : null;
  let back: BackContext | null = null;
  if (q.get('from') === 'fanlife') {
    const c = q.get('club');
    const l = q.get('lang') as FanLifeLang | null;
    const s = q.get('src') as FanLifeSrc | null;
    back = {
      club: c !== null && CLUB.test(c) ? c : null,
      lang: l && LANGS.includes(l) ? l : 'en',
      src: s && SRCS.includes(s) ? s : null,
    };
  }
  return { league, landing, back, any };
}

/* memory first (undefined = not read yet), storage as the tab's copy */
let memIncoming: string | null | undefined;
let memLanding: Landing | null | undefined;
let memBack: BackContext | null | undefined;
function sGet(k: string): string | null { try { return sessionStorage.getItem(k); } catch { return null; } }
function sSet(k: string, v: string | null): void {
  try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* blocked store: memory holds it */ }
}

/** The FAN LIFE context the visitor came with this tab, or null. Reads the old plain-slug form too. */
export function backContext(): BackContext | null {
  if (memBack !== undefined) return memBack;
  const raw = sGet(BACK);
  memBack = null;
  if (!raw) return null;
  if (CLUB.test(raw)) return (memBack = { club: raw, lang: 'en', src: null });
  try {
    const o = JSON.parse(raw) as Partial<BackContext>;
    memBack = {
      club: typeof o.club === 'string' && CLUB.test(o.club) ? o.club : null,
      lang: o.lang && LANGS.includes(o.lang) ? o.lang : 'en',
      src: o.src && SRCS.includes(o.src) ? o.src : null,
    };
  } catch { memBack = null; }
  return memBack;
}
/** The club the visitor came from on FAN LIFE this tab, or null. */
export function backToClub(): string | null { return backContext()?.club ?? null; }
/** `hapoel-tel-aviv` → `Hapoel Tel Aviv` (the slug is the only thing the link carries). */
export function clubLabel(slug: string): string {
  return slug.split('-').map((w) => (w === 'aek' ? 'AEK' : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}
/** Pure: where "back" goes. A club page with the visitor's language, or the FAN LIFE home for `src=hub` / no club. */
export function backLink(ctx: BackContext | null): { href: string; club: string | null } | null {
  if (!ctx) return null;
  const lang = LANGS.includes(ctx.lang) ? ctx.lang : 'en';
  if (ctx.src === 'hub' || !ctx.club) return { href: `${FANLIFE_SITE}/?lang=${lang}`, club: null };
  return { href: `${FANLIFE_SITE}/clubs/${ctx.club}?lang=${lang}`, club: ctx.club };
}

/** Read and strip the FAN LIFE params before the first render. Never throws. */
export function takeIncomingLeague(): void {
  try {
    const u = new URL(window.location.href);
    const p = parseIncomingLink(u.searchParams);
    if (!p.any) return;
    for (const k of PARAMS) u.searchParams.delete(k);
    try { window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash); } catch { /* the address keeps them */ }
    if (p.league) { memIncoming = p.league; sSet(INCOMING, p.league); }
    if (p.landing) { memLanding = p.landing; sSet(LANDING, JSON.stringify(p.landing)); }
    if (p.back) { memBack = p.back; sSet(BACK, JSON.stringify(p.back)); }
  } catch { /* a broken URL simply ignores the link */ }
}
export function incomingLeague(): string | null {
  if (memIncoming !== undefined) return memIncoming;
  const v = sGet(INCOMING);
  return (memIncoming = v && CODE.test(v) ? v : null);
}
export function clearIncomingLeague(): void { memIncoming = null; sSet(INCOMING, null); }
/** The format/round the card was about, or null. Survives the one reload a league switch costs. */
export function incomingLanding(): Landing | null {
  if (memLanding !== undefined) return memLanding;
  memLanding = null;
  const raw = sGet(LANDING);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<Landing>;
    const format = o.format && FORMATS.includes(o.format) ? o.format : null;
    const gw = typeof o.gw === 'string' && GW.test(o.gw) ? o.gw : null;
    const league = typeof o.league === 'string' && CODE.test(o.league) ? o.league : null;
    memLanding = format || gw ? { league, format, gw } : null;
  } catch { memLanding = null; }
  return memLanding;
}
export function clearIncomingLanding(): void { memLanding = null; sSet(LANDING, null); }

/**
 * What to do with a league a link asked for:
 *  · `none`   — not a league DUBID runs now, or it is the one already played → forget it
 *  · `choose` — a first visit that has not picked a league → take it (one reload, so no data of another league shows)
 *  · `ask`    — a player of another league → ask: switch or stay
 */
export function incomingDecision(code: string | null, all: PublicLeague[], chosen: boolean, selected: string | null): {kind: 'none'} | {kind: 'choose' | 'ask'; league: PublicLeague} {
  const l = code ? all.find((x) => x.code === code) : undefined;
  if (!l || !leagueEnterable(l)) return { kind: 'none' };
  const current = selected ?? all.find((x) => x.primary)?.code ?? null;
  if (current === l.code) return { kind: 'none' };
  return { kind: chosen ? 'ask' : 'choose', league: l };
}

/* ---- the resolver: one answer per page, shared by the boot and <IncomingLeague/> ---- */
export type IncomingState =
  | { kind: 'pending' }
  | { kind: 'none' }                      // nothing to do (no link, or already this league)
  | { kind: 'switching' }                 // a first visit: the page reloads into the league
  | { kind: 'ask'; league: PublicLeague } // a player of another league: switch or stay
  | { kind: 'error' };                    // could not read the catalog: the intent is kept, retry offered
export interface IncomingDeps {
  fetch?: () => Promise<LeaguesResult>;
  choose?: (code: string | null, primary: boolean) => void;
  chosen?: () => boolean;
  selected?: () => string | null;
}
let incomingNow: IncomingState = { kind: 'pending' };
let resolving: Promise<IncomingState> | null = null;
let catalog: PublicLeague[] | null = null;
const incomingSubs = new Set<() => void>();
function setIncoming(s: IncomingState): IncomingState { incomingNow = s; for (const f of incomingSubs) f(); return s; }
export function incomingState(): IncomingState { return incomingNow; }
export function subscribeIncoming(f: () => void): () => void { incomingSubs.add(f); return () => { incomingSubs.delete(f); }; }
/** The catalog the resolver read (null if it never did) — so the landing does not ask twice. */
export function knownLeagues(): PublicLeague[] | null { return catalog; }

/** Resolve the landing league once. Never rejects. */
export function resolveIncoming(deps: IncomingDeps = {}): Promise<IncomingState> {
  if (resolving) return resolving;
  const code = incomingLeague();
  if (!code) { resolving = Promise.resolve(setIncoming({ kind: 'none' })); return resolving; }
  setIncoming({ kind: 'pending' });
  const fetch = deps.fetch ?? fetchLeaguesResult;
  resolving = (async (): Promise<IncomingState> => {
    let r: LeaguesResult;
    try { r = await fetch(); } catch { r = { ok: false }; }
    if (!r.ok) {
      resolving = null;              // a retry asks again; the intent stays (CF-07)
      return setIncoming({ kind: 'error' });
    }
    catalog = r.leagues;
    const d = incomingDecision(code, r.leagues, (deps.chosen ?? hasChosenLeague)(), (deps.selected ?? selectedLeague)());
    if (d.kind === 'none') { clearIncomingLeague(); return setIncoming({ kind: 'none' }); }
    if (d.kind === 'choose') {
      clearIncomingLeague();
      setIncoming({ kind: 'switching' });
      (deps.choose ?? chooseLeague)(d.league.code, d.league.primary);
      return incomingNow;
    }
    return setIncoming({ kind: 'ask', league: d.league });
  })();
  return resolving;
}
/** Retry the same intent after a failed read. */
export function retryIncoming(deps: IncomingDeps = {}): Promise<IncomingState> {
  if (incomingNow.kind !== 'error') return resolving ?? resolveIncoming(deps);
  resolving = null;
  return resolveIncoming(deps);
}
/** The visitor answered the question: stay here (the card's format/round were about the other league). */
export function stayInCurrentLeague(): void {
  clearIncomingLeague(); clearIncomingLanding(); setIncoming({ kind: 'none' });
}
/** Wait for the resolver, but never longer than `ms`: a hung read must not hold the app (the retry stays). */
export function waitForIncoming(ms = 2500, deps: IncomingDeps = {}): Promise<IncomingState> {
  return Promise.race([
    resolveIncoming(deps),
    new Promise<IncomingState>((res) => setTimeout(() => res({ kind: 'pending' }), ms)),
  ]);
}
/** Tests only: forget everything this module remembers. */
export function __resetIncomingForTests(): void {
  memIncoming = undefined; memLanding = undefined; memBack = undefined;
  incomingNow = { kind: 'pending' }; resolving = null; catalog = null; incomingSubs.clear();
}

/* ---- CF-04: the format and round the card was about ---- */
export type LandingNote =
  | { key: 'landing.formatSwitched'; wanted: 'five' | 'full'; open: 'five' | 'full' }
  | { key: 'landing.formatClosed' }
  | { key: 'landing.roundOpen'; round: number }
  | { key: 'landing.roundLocked'; round: number }
  | { key: 'landing.roundChanged' };
export interface LandingPlan { mode: 'five' | 'full' | null; notes: LandingNote[] }

/**
 * Pure: where to land and what to say, from what the server says now. Never invents:
 * a round number is printed only when the catalog carries one.
 *  · format five/full → that builder; if it cannot submit and the other can → the other, one line
 *  · any/missing → no change (the picker / default)
 *  · gw differs from the league's current round → land on the current one, one line
 */
export function planLanding(landing: Landing | null, league: Pick<PublicLeague, 'currentGameweek' | 'round' | 'status' | 'formats'> | null): LandingPlan {
  const notes: LandingNote[] = [];
  if (!landing) return { mode: null, notes };
  const want = landing.format === 'five' || landing.format === 'full' ? landing.format : null;
  let mode: 'five' | 'full' | null = want;
  const f = league?.formats ?? null;
  const closed = (m: 'five' | 'full') => !!f && f[m]?.state !== 'unknown' && f[m]?.canSubmit === false;
  if (want && f) {
    const other = want === 'five' ? 'full' : 'five';
    if (closed(want) && !closed(other)) { mode = other; notes.push({ key: 'landing.formatSwitched', wanted: want, open: other }); }
    else if (closed(want) && closed(other)) notes.push({ key: 'landing.formatClosed' });
  }
  const cur = league?.currentGameweek ?? null;
  if (landing.gw && cur && landing.gw !== cur) {
    const n = typeof league?.round === 'number' ? league.round : null;
    const st = league?.status ?? null;
    if (n === null) notes.push({ key: 'landing.roundChanged' });
    else if (st === 'open') notes.push({ key: 'landing.roundOpen', round: n });
    else if (st && st !== 'draft') {
      notes.push({ key: 'landing.roundLocked', round: n });
      const i = notes.findIndex((x) => x.key === 'landing.formatClosed');
      if (i >= 0) notes.splice(i, 1);
    } else notes.push({ key: 'landing.roundChanged' });
  }
  return { mode, notes };
}
