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

export async function fetchLeagues(): Promise<PublicLeague[]> {
  const { data, error } = await supabase.rpc('leagues_public');
  if (error || !Array.isArray(data)) return [];
  return data as PublicLeague[];
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
 * Connected Football (FAN LIFE, 27.10.2026): `?league=CODE` from a FAN LIFE
 * card. Taken off the address at once (the hash and the rest stay), kept for
 * this tab only, and decided by <IncomingLeague/> against the live catalog —
 * never a silent switch for someone who already plays another league.
 * ------------------------------------------------------------------ */
const INCOMING = 'ui.league.incoming';
const CODE = /^[A-Z][A-Z0-9_]{1,31}$/;
/** `?from=fanlife&club=<slug>` — the FAN LIFE club page the visitor came from (back_to_story, ecosystem contract). */
const BACK = 'ui.fanlife.back';
const CLUB = /^[a-z0-9][a-z0-9-]{1,59}$/;
export const FANLIFE_SITE = 'https://fanlife.dubelteam.com';
/** The club the visitor came from on FAN LIFE this tab, or null. */
export function backToClub(): string | null {
  try { const v = sessionStorage.getItem(BACK); return v && CLUB.test(v) ? v : null; } catch { return null; }
}
/** `hapoel-tel-aviv` → `Hapoel Tel Aviv` (the slug is the only thing the link carries). */
export function clubLabel(slug: string): string {
  return slug.split('-').map((w) => (w === 'aek' ? 'AEK' : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}

/** Read and strip `?league=` before the first render. Never throws. */
export function takeIncomingLeague(): void {
  try {
    const u = new URL(window.location.href);
    const code = u.searchParams.get('league');
    const from = u.searchParams.get('from');
    const club = u.searchParams.get('club');
    if (code === null && from === null && club === null) return;
    for (const k of ['league', 'from', 'club']) u.searchParams.delete(k);
    window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash);
    if (code !== null && CODE.test(code)) sessionStorage.setItem(INCOMING, code);
    if (from === 'fanlife' && club !== null && CLUB.test(club)) sessionStorage.setItem(BACK, club);
  } catch { /* a blocked store simply ignores the link */ }
}
export function incomingLeague(): string | null {
  try { const v = sessionStorage.getItem(INCOMING); return v && CODE.test(v) ? v : null; } catch { return null; }
}
export function clearIncomingLeague(): void {
  try { sessionStorage.removeItem(INCOMING); } catch { /* nothing to clear */ }
}
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
