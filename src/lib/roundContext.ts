/**
 * lib/roundContext.ts — "לאיזה מחזור אני בונה, עד מתי, ומה אחריו" (U01/U04/5.5).
 *
 * ★ תצוגה בלבד. הנעילה נאכפת בשרת (`game.gameweeks.lock_at`); כאן רק איך מציגים
 *   אותה: תאריך+שעה+אזור זמן של הליגה תמיד, וספירה לאחור כחיזוק — לא כתחליף.
 * ★ המחזור הבא מגיע מהשרת (`game.next_round`), לא מ"מספר+1".
 */
import { supabase } from './supabase.ts';
import { tr, activeLocale } from './i18n/dict.ts';
import { LOCALE_META } from './i18n/locales.ts';
import { leagueTimezone } from './leagueTz.ts';
import { onRevision } from './revisionBus.ts';

const CITY: Record<string, { he: string; en: string; el: string }> = {
  'Asia/Jerusalem': { he: 'ישראל', en: 'Israel', el: 'Ισραήλ' },
  'Europe/Athens':  { he: 'יוון', en: 'Greece', el: 'Ελλάδας' },
  'Europe/London':  { he: 'לונדון', en: 'UK', el: 'Λονδίνου' },
  'Europe/Madrid':  { he: 'ספרד', en: 'Spain', el: 'Ισπανίας' },
};

/** "שעון ישראל" / "Athens time". אזור לא מוכר → שם העיר מתוך ה-IANA. */
export function tzLabel(tz = leagueTimezone()): string {
  const l = activeLocale();
  const known = CITY[tz]?.[l];
  const city = known ?? (tz.split('/').pop() ?? tz).replace(/_/g, ' ');
  return tr('round.tz', { city });
}

/** "שבת 31.10 · 19:00" / "Sat 31 Oct · 19:00" — באזור הזמן של הליגה. */
export function deadlineLabel(iso: string, tz = leagueTimezone()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const intl = LOCALE_META[activeLocale()].intl;
  const day = d.toLocaleDateString(intl, { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz });
  const time = d.toLocaleTimeString(intl, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz });
  return `${day} · ${time}`;
}

/** "4d 3h" / "5h 12m" / "12m" / "<1m". שלילי → null. */
export function countdownShort(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  if (d > 0) return tr('round.cd.dh', { d, h });
  if (h > 0) return tr('round.cd.hm', { h, m: mm });
  return mm > 0 ? tr('round.cd.m', { m: mm }) : tr('round.cd.lt1');
}

/** מפתח יום (YYYY-MM-DD) באזור הזמן של הליגה — לקיבוץ לפי יום. */
export function dayKey(iso: string, tz = leagueTimezone()): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });
}

export function dayHeading(iso: string, tz = leagueTimezone()): string {
  return new Date(iso).toLocaleDateString(LOCALE_META[activeLocale()].intl, {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: tz,
  });
}

export function timeOnly(iso: string, tz = leagueTimezone()): string {
  return new Date(iso).toLocaleTimeString(LOCALE_META[activeLocale()].intl, {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz,
  });
}

/* ------------------------------------------------------------------ */
/* המחזור הבא                                                          */
/* ------------------------------------------------------------------ */

export interface RoundFixtureLite {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  kickoff: string;
  status: string;
}

export interface NextRound {
  code: string;
  number: number;
  status: string;
  lockAt: string | null;
  firstKickoffAt: string | null;
  fixturesTotal: number;
  fixtures: RoundFixtureLite[];
}

/**
 * ★ H05 — מצבי טעינה נפרדים. `null` היה גם "אין מחזור הבא" וגם "הרשת נפלה",
 *   והתוצאה נשמרה עד סגירת העמוד: שינוי נעילה/לוח לא הגיע בלי רענון.
 */
export type NextRoundLoadState =
  | { status: 'loading' }
  | { status: 'empty'; checkedAt: number }
  | { status: 'ready'; data: NextRound; fetchedAt: number; stale: boolean }
  | { status: 'error'; errorCode: string; cached?: NextRound; cachedAt?: number };

/** TTL של תוצאה מוצלחת — החלטת מימוש, לא חוק משחק. */
export const NEXT_ROUND_TTL_MS = 60_000;
/** אחרי כשל, נתון ישן יותר מזה לא מוצג כאילו הוא תקף. */
export const NEXT_ROUND_STALE_MAX_MS = 5 * 60_000;

type Entry = {
  state: NextRoundLoadState;
  at: number;                  // מתי נקבע המצב
  invalid: boolean;            // סומן ע"י revisionBus
  inflight: Promise<NextRoundLoadState> | null;
  token: number;               // בקשה אחרונה — תשובה ישנה לא דורסת חדשה
};
const entries = new Map<string, Entry>();
const watchers = new Map<string, Set<(s: NextRoundLoadState) => void>>();

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
let rpc: Rpc = (fn, args) => supabase.rpc(fn, args) as unknown as Promise<{ data: unknown; error: unknown }>;
/** לבדיקות בלבד. */
export function __setNextRoundRpcForTests(fn: Rpc | null, reset = true): void {
  rpc = fn ?? ((f, a) => supabase.rpc(f, a) as unknown as Promise<{ data: unknown; error: unknown }>);
  if (reset) { entries.clear(); watchers.clear(); }
}

function emit(code: string, st: NextRoundLoadState) {
  watchers.get(code)?.forEach((fn) => fn(st));
}

function lastGood(e: Entry | undefined): { data: NextRound; at: number } | null {
  if (!e) return null;
  if (e.state.status === 'ready') return { data: e.state.data, at: e.state.fetchedAt };
  if (e.state.status === 'error' && e.state.cached && e.state.cachedAt) return { data: e.state.cached, at: e.state.cachedAt };
  return null;
}

async function request(code: string): Promise<NextRoundLoadState> {
  const n = await rpc('next_round', { p_gw_code: code });
  if (n.error) return { status: 'error', errorCode: 'next_round' };
  const d = n.data as Omit<NextRound, 'fixtures'> | null;
  if (!d || typeof d !== 'object' || !d.code) return { status: 'empty', checkedAt: Date.now() };
  const fx = await rpc('fixtures', { p_gw_code: d.code });
  if (fx.error) return { status: 'error', errorCode: 'fixtures' };
  const rows = (fx.data as { fixtures?: RoundFixtureLite[] } | null)?.fixtures || [];
  return {
    status: 'ready', fetchedAt: Date.now(), stale: false,
    data: { ...d, fixtures: rows.map((f) => ({
      id: f.id, homeTeamId: f.homeTeamId, awayTeamId: f.awayTeamId, kickoff: f.kickoff, status: f.status,
    })) },
  };
}

/** המצב הנוכחי בזיכרון, בלי לשלוח בקשה. */
export function peekNextRound(code: string): NextRoundLoadState {
  const e = entries.get(code);
  if (!e) return { status: 'loading' };
  if (e.state.status === 'ready') {
    const stale = e.invalid || Date.now() - e.state.fetchedAt > NEXT_ROUND_TTL_MS;
    return stale === e.state.stale ? e.state : { ...e.state, stale };
  }
  if (e.state.status === 'error' && e.state.cachedAt && Date.now() - e.state.cachedAt > NEXT_ROUND_STALE_MAX_MS) {
    return { status: 'error', errorCode: e.state.errorCode };
  }
  return e.state;
}

/**
 * טוען (או מחזיר מהמטמון) את המחזור שאחרי `code`.
 * · בקשה אחת באוויר לכל מפתח — צרכנים שונים חולקים אותה.
 * · תוצאה טרייה (< TTL, לא בוטלה) לא נשלחת שוב, אלא אם `force`.
 * · כשל אחרי הצלחה → error עם הנתון הקודם (מסומן ישן), לא empty.
 * ★ `code` ייחודי גלובלית (UNIQUE על game.gameweeks.code), ולכן הוא מפתח מספיק.
 */
export function loadNextRound(code: string, force = false): Promise<NextRoundLoadState> {
  if (!code) return Promise.resolve({ status: 'empty', checkedAt: Date.now() });
  let e = entries.get(code);
  if (e?.inflight) return e.inflight;
  if (e && !force && !e.invalid && e.state.status !== 'error' && Date.now() - e.at < NEXT_ROUND_TTL_MS) {
    return Promise.resolve(peekNextRound(code));
  }
  if (!e) { e = { state: { status: 'loading' }, at: 0, invalid: false, inflight: null, token: 0 }; entries.set(code, e); }
  const entry = e;
  const token = ++entry.token;
  const p = (async (): Promise<NextRoundLoadState> => {
    let st: NextRoundLoadState;
    try { st = await request(code); } catch { st = { status: 'error', errorCode: 'network' }; }
    if (st.status === 'error') {
      const good = lastGood(entry);
      if (good) st = { ...st, cached: good.data, cachedAt: good.at };
    }
    if (token !== entry.token) return peekNextRound(code);   // נדרסה ע"י בקשה חדשה יותר
    entry.state = st; entry.at = Date.now(); entry.invalid = false;
    emit(code, peekNextRound(code));
    return peekNextRound(code);
  })();
  entry.inflight = p;
  void p.finally(() => { if (entry.inflight === p) entry.inflight = null; });
  return p;
}

/** סימון כל המטמון כלא-תקף (gameweeks/weekly_matches השתנו). הטעינה — רק אצל מי שגלוי. */
export function invalidateNextRounds(): void {
  for (const [code, e] of entries) {
    e.invalid = true;
    emit(code, peekNextRound(code));
  }
}

export function watchNextRound(code: string, fn: (s: NextRoundLoadState) => void): () => void {
  let s = watchers.get(code);
  if (!s) { s = new Set(); watchers.set(code, s); }
  s.add(fn);
  return () => { s!.delete(fn); };
}

/**
 * מנוי אחד לכל האפליקציה (לא לכל RoundBar/FixturesBoard): שינוי במחזורים או
 * בלוח → המטמון לא תקף. ספירת הפניות — המנוי יורד כשאין צופים.
 */
let busRefs = 0;
let busStop: (() => void) | null = null;
export function retainNextRoundBus(): () => void {
  busRefs += 1;
  if (!busStop) busStop = onRevision(['gameweeks', 'weekly_matches'], invalidateNextRounds, 3000);
  let done = false;
  return () => {
    if (done) return; done = true;
    busRefs -= 1;
    if (busRefs === 0 && busStop) { busStop(); busStop = null; }
  };
}

/** תאימות: הצרכן הישן קיבל NextRound | null. */
export async function fetchNextRound(code: string): Promise<NextRound | null> {
  const st = await loadNextRound(code);
  return st.status === 'ready' ? st.data : st.status === 'error' ? st.cached ?? null : null;
}
