/**
 * lib/store.ts — מקור האמת.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ מה השתנה: Supabase החליף את localStorage
 * ═══════════════════════════════════════════════════════════════
 *
 * עד הסבב הזה כל ההגשות והתוצאות חיו ב-localStorage. זה עבד
 * מצוין להדגמה ולא עובד בכלל למשחק: כל מכשיר ראה דירוג אחר, שתי
 * לשוניות אצל אותו אדם היו שתי תחרויות נפרדות, והאדמין הזין
 * תוצאות שאף אחד חוץ ממנו לא ראה.
 *
 * עכשיו: **Supabase הוא מקור האמת.** localStorage נשאר, אבל
 * בתפקיד אחר לגמרי — מטמון לקריאה בלבד, כדי שהמסך לא יהיה ריק
 * בשנייה הראשונה ושהאפליקציה לא תמות ברשת גרועה.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ למה הקריאות נשארו סינכרוניות
 * ═══════════════════════════════════════════════════════════════
 *
 * `listEntries()` ו-`getResults()` נקראות בתוך רינדור, בשמונה
 * מקומות. להפוך אותן ל-`async` היה אומר לכתוב מחדש כל מסך במוצר
 * — עשרות מצבי טעינה חדשים, כל אחד עם באג משלו.
 *
 * במקום זה יש **תמונת מצב בזיכרון**. היא מתמלאת מ-Supabase
 * (`hydrate`), מתעדכנת בזמן אמת, ומודיעה ל-React דרך אותו
 * `subscribeToStore` שכבר היה. הקריאות נשארות מיידיות, והנתונים
 * מגיעים מהשרת. אף קומפוננטה לא ידעה שמשהו השתנה.
 *
 * **הכתיבות, לעומת זאת, נהיו אסינכרוניות בכוונה.** הגשת הרכב
 * יכולה להידחות על ידי השרת (עבר הדדליין, שני שחקנים מאותה
 * קבוצה). עדכון אופטימי היה מראה למשתמש "נשמר" ואז מוחק לו את
 * ההרכב. במשחק תחרותי זה בלתי נסלח — ולכן המסך מחכה לתשובה.
 */
import type { Lineup, PlayerPerformance, TeamOutcome } from './scoring/types.ts';
import { supabase } from './supabase.ts';
import { ensureIdentity, currentIdentity } from './identity.ts';

const KEYS = {
  entries: 'dubid.entries.v1',
  results: 'dubid.results.v1',
  adminSession: 'dubid.admin.session.v1',
} as const;

export interface LineupEntry {
  id: string;
  /** נשאר לתאימות. במצב מקוון הזהות היא הסשן, לא קוד. */
  magicCode: string;
  displayName: string;
  gameweekId: string;
  mode: 'full' | 'five';
  userId: string;
  lineup: Lineup;
  submittedAt: string;
}

export interface FixtureScore {
  fixtureId: string;
  homeGoals: number;
  awayGoals: number;
  final: boolean;
}

export interface GameweekResults {
  gameweekId: string;
  performances: Record<string, PlayerPerformance>;
  outcomes: Record<string, TeamOutcome>;
  fixtureScores: Record<string, FixtureScore>;
  published: boolean;
  updatedAt: string;
}

export interface GameweekState {
  code: string;
  number: number;
  status: string;
  lockAt: string;
  firstKickoffAt: string;
  entrants: number;
}

/* ================================================================== */
/* תמונת המצב                                                          */
/* ================================================================== */

interface Snapshot {
  entries: LineupEntry[];
  results: Record<string, GameweekResults>;
  gameweek: GameweekState | null;
  /** `false` = עובדים מהמטמון בלבד. המסך יכול להגיד את זה למשתמש. */
  live: boolean;
  loading: boolean;
  /** קוד השגיאה האחרונה מהשרת, אם יש. */
  lastError: string | null;
}

const snapshot: Snapshot = {
  entries: [],
  results: {},
  gameweek: null,
  live: false,
  loading: true,
  lastError: null,
};

function notify() {
  try {
    window.dispatchEvent(new Event('dubid:store'));
  } catch {
    /* SSR / לא בדפדפן */
  }
}

export function storeStatus(): { live: boolean; loading: boolean; error: string | null } {
  return { live: snapshot.live, loading: snapshot.loading, error: snapshot.lastError };
}

/* ------------------------------------------------------------------ */
/* מטמון מקומי — קריאה מהירה, לא מקור אמת                              */
/* ------------------------------------------------------------------ */

function readCache<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeCache<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* מצב פרטי / חריגה ממכסה — לא שוברים את האפליקציה */
  }
}

/* ------------------------------------------------------------------ */
/* מעבר ממצב הדגמה למשחק אמיתי                                          */
/* ------------------------------------------------------------------ */

/**
 * ★ ניקוי חד-פעמי לקראת המשחק האמיתי.
 *
 * במהלך הפיתוח נצברו במכשירים הגשות ותוצאות של מחזור 1 — נתוני
 * הדגמה. קבוצת הניסוי חייבת להתחיל מדף חלק.
 *
 * העלאת `DATA_EPOCH` = ניקוי נוסף בכניסה הבאה. הועלה עכשיו, כי
 * המטמון מהגרסה הקודמת מכיל הגשות שמעולם לא הגיעו לשרת.
 *
 * ★ מה נשמר בכוונה: השם ומזהה המשתמש.
 */
const DATA_EPOCH = 'gw2-supabase-1';
const EPOCH_KEY = 'dubid.epoch.v1';

export function purgeDemoDataOnce(): boolean {
  try {
    if (localStorage.getItem(EPOCH_KEY) === DATA_EPOCH) return false;

    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k === KEYS.entries || k === KEYS.results || k.startsWith('dubid.lineup.draft.')) {
        doomed.push(k);
      }
    }
    for (const k of doomed) localStorage.removeItem(k);

    localStorage.setItem(EPOCH_KEY, DATA_EPOCH);
    notify();
    return doomed.length > 0;
  } catch {
    return false;   // מצב פרטי — לא שוברים את האפליקציה בשביל ניקיון
  }
}

/* ================================================================== */
/* טעינה מהשרת                                                         */
/* ================================================================== */

function emptyResults(gameweekId: string): GameweekResults {
  return {
    gameweekId,
    performances: {},
    outcomes: {},
    fixtureScores: {},
    published: false,
    updatedAt: new Date(0).toISOString(),
  };
}

let hydrating: Promise<void> | null = null;
let activeGameweek = '';

/**
 * מביא הכל מהשרת. קריאות מקבילות מתאחדות.
 *
 * ★ כישלון כאן אינו קטלני. התמונה נשארת מה שהייתה (מטמון או ריק),
 *   `live` נופל ל-`false`, והמסך יכול להגיד "לא מחובר" במקום
 *   להציג דירוג ישן כאילו הוא נכון.
 */
export function hydrate(gameweekId: string, force = false): Promise<void> {
  if (hydrating && !force) return hydrating;
  activeGameweek = gameweekId;

  hydrating = (async () => {
    snapshot.loading = true;
    notify();
    try {
      await ensureIdentity();

      const [entriesRes, resultsRes, stateRes] = await Promise.all([
        supabase.rpc('entries', { p_gw_code: gameweekId }),
        supabase.rpc('results', { p_gw_code: gameweekId }),
        supabase.rpc('gameweek_state', { p_gw_code: gameweekId }),
      ]);

      if (entriesRes.error || resultsRes.error) {
        throw entriesRes.error ?? resultsRes.error;
      }

      snapshot.entries = (entriesRes.data ?? []) as LineupEntry[];
      const r = (resultsRes.data ?? emptyResults(gameweekId)) as GameweekResults;
      snapshot.results = { ...snapshot.results, [gameweekId]: r };
      snapshot.gameweek = (stateRes.data ?? null) as GameweekState | null;
      snapshot.live = true;
      snapshot.lastError = null;

      writeCache(KEYS.entries, snapshot.entries);
      writeCache(KEYS.results, snapshot.results);
    } catch (err) {
      snapshot.live = false;
      snapshot.lastError = errorCode(err);
      // מטמון — עדיף מסך עם נתון ישן מאשר מסך ריק.
      if (snapshot.entries.length === 0) {
        snapshot.entries = readCache<LineupEntry[]>(KEYS.entries, []);
      }
      if (Object.keys(snapshot.results).length === 0) {
        snapshot.results = readCache<Record<string, GameweekResults>>(KEYS.results, {});
      }
    } finally {
      snapshot.loading = false;
      hydrating = null;
      notify();
    }
  })();

  return hydrating;
}

/** רענון יזום — אחרי כתיבה, או כשהטאב חוזר לפוקוס. */
export function refresh(): Promise<void> {
  return activeGameweek ? hydrate(activeGameweek, true) : Promise.resolve();
}

/**
 * ★ זמן אמת.
 *
 * בלי זה, משתמש שהאדמין פרסם לו תוצאות היה צריך לרענן את הדף
 * כדי לראות אותן. עם זה, הדירוג נפתח על המסך שלו בזמן שהוא
 * מסתכל עליו — וזה בדיוק הרגע שהמוצר קיים בשבילו.
 *
 * `postgres_changes` על שלוש טבלאות בלבד. כל אירוע גורר רענון
 * מלא ולא עדכון חלקי: הרענון הוא שלוש שאילתות זולות, ועדכון
 * חלקי הוא מקור לחוסר עקביות שקשה לאתר.
 */
export function startRealtime(gameweekId: string): () => void {
  const channel = supabase
    .channel('dubid-live')
    .on('postgres_changes', { event: '*', schema: 'game', table: 'user_lineups' },
        () => { void hydrate(gameweekId, true); })
    .on('postgres_changes', { event: '*', schema: 'game', table: 'gameweeks' },
        () => { void hydrate(gameweekId, true); })
    .on('postgres_changes', { event: '*', schema: 'core', table: 'player_match_stats' },
        () => { void hydrate(gameweekId, true); })
    .subscribe();

  return () => { void supabase.removeChannel(channel); };
}

/**
 * ★ למה זה לא מחזיר סתם "NETWORK".
 *
 * "אין חיבור לשרת" היא ההודעה הכי מתסכלת שאפשר לתת, כי היא
 * נכונה בכל מקרה ולא עוזרת באף אחד. ברוב המקרים אין שום בעיית
 * רשת: המיגרציה לא רצה, הסכימה לא חשופה, או כניסת אורחים כבויה.
 * שלוש בעיות שונות, שלושה תיקונים שונים, ואותה הודעה.
 *
 * PostgREST מבדיל ביניהן — הוא רק לא עושה את זה בעברית:
 *
 *   PGRST202 / 404   הפונקציה לא קיימת    → המיגרציה לא רצה
 *   PGRST106         הסכימה לא חשופה      → Exposed schemas
 *   401 / 403        אין הרשאה            → GRANT או RLS
 *   TypeError        באמת אין רשת
 */
function errorCode(err: unknown): string {
  const e = (err ?? {}) as { message?: unknown; code?: unknown; status?: unknown; name?: unknown };
  const msg = err instanceof Error ? err.message
    : e.message !== undefined ? String(e.message)
    : String(err);
  const code = e.code !== undefined ? String(e.code) : '';
  const status = Number(e.status ?? 0);

  const known = [
    'DEADLINE_PASSED', 'GAMEWEEK_LOCKED', 'GAMEWEEK_NOT_FOUND', 'CAPTAIN_REQUIRED',
    'LINEUP_SIZE', 'PLAYER_NOT_FOUND', 'PLAYER_NOT_IN_SQUAD', 'ADMIN_REQUIRED',
    'AUTH_REQUIRED', 'ALREADY_PUBLISHED', 'OVER_BUDGET',
    'NAME_REQUIRED', 'TEAM_NOT_FOUND', 'PRICE_RANGE', 'BAD_STATUS', 'NO_SEASON',
  ].find((c) => msg.includes(c));
  if (known) return known;

  if (msg.includes('one_player_per_team')) return 'DUPLICATE_TEAM';
  if (msg.includes('no_duplicate_player')) return 'DUPLICATE_PLAYER';

  // --- אבחון תשתית ---
  if (code === 'PGRST106' || msg.includes('not exposed') || msg.includes('schema must be one of')) {
    return 'SCHEMA_NOT_EXPOSED';
  }
  if (code === 'PGRST202' || code === '42883'
      || msg.includes('Could not find the function')
      || msg.includes('does not exist')) {
    return 'MIGRATION_MISSING';
  }
  if (msg.includes('Anonymous sign-ins are disabled') || msg.includes('anonymous_provider_disabled')) {
    return 'ANON_DISABLED';
  }
  if (status === 401 || status === 403 || code === '42501') return 'NO_PERMISSION';
  if (msg.includes('Invalid API key') || msg.includes('JWSError')) return 'BAD_KEY';
  if (msg.includes('Failed to fetch') || e.name === 'TypeError') return 'OFFLINE';

  return 'NETWORK';
}

/** הודעה בעברית לקוד שגיאה. מקום אחד — לא ניסוח לכל מסך. */
export const ERROR_HE: Record<string, string> = {
  DEADLINE_PASSED: 'הדדליין עבר. ההרכבים נעולים למחזור הזה.',
  GAMEWEEK_LOCKED: 'המחזור נעול. אי אפשר להגיש עכשיו.',
  GAMEWEEK_NOT_FOUND: 'המחזור לא נמצא במסד. פנו לאדמין.',
  CAPTAIN_REQUIRED: 'צריך לבחור קפטן אחד.',
  LINEUP_SIZE: 'מספר השחקנים בהרכב לא תקין.',
  PLAYER_NOT_FOUND: 'אחד השחקנים לא קיים במסד.',
  PLAYER_NOT_IN_SQUAD: 'אחד השחקנים לא רשום בסגל פעיל.',
  DUPLICATE_TEAM: 'שני שחקנים מאותה קבוצה. הכלל היחיד — אחד מכל קבוצה.',
  DUPLICATE_PLAYER: 'אותו שחקן נבחר פעמיים.',
  ADMIN_REQUIRED: 'הפעולה דורשת הרשאת ניהול.',
  AUTH_REQUIRED: 'צריך זהות פעילה. רעננו את הדף.',
  ALREADY_PUBLISHED: 'המחזור כבר פורסם.',
  NAME_REQUIRED: 'צריך שם לשחקן.',
  TEAM_NOT_FOUND: 'הקבוצה לא נמצאה.',
  PRICE_RANGE: 'מחיר חייב להיות בין 0 ל-99.',
  BAD_STATUS: 'מצב זמינות לא חוקי.',
  NO_SEASON: 'אין עונה פעילה במסד. הריצו את db/03.',
  OVER_BUDGET: 'ההרכב חורג מהתקציב.',
  NETWORK: 'השרת לא ענה. נסו שוב בעוד רגע.',
  OFFLINE: 'אין חיבור לאינטרנט.',
  // ★ שלוש ההודעות האלה אומרות **מה לעשות**, לא רק שמשהו נכשל.
  MIGRATION_MISSING: 'המסד לא הוגדר עדיין — חסרות מיגרציות. ראו docs/INSTALL.md שלב 1.',
  SCHEMA_NOT_EXPOSED: 'הסכימות לא חשופות ב-Supabase. Settings → API → Exposed schemas: public, core, game, shared.',
  ANON_DISABLED: 'כניסת אורחים כבויה. Authentication → Providers → Anonymous sign-ins.',
  NO_PERMISSION: 'אין הרשאה לקרוא מהמסד. בדקו GRANT ו-RLS (db/09 §9).',
  BAD_KEY: 'מפתח ה-API לא תקין. בדקו VITE_SUPABASE_PUBLISHABLE_KEY.',
};

export function errorMessageHe(code: string): string {
  return ERROR_HE[code] ?? ERROR_HE.NETWORK;
}

/* ================================================================== */
/* קריאה — סינכרונית, מהתמונה                                          */
/* ================================================================== */

export function listEntries(gameweekId?: string, mode?: 'full' | 'five'): LineupEntry[] {
  return snapshot.entries.filter(
    (e) => (!gameweekId || e.gameweekId === gameweekId) && (!mode || e.mode === mode),
  );
}

/**
 * ההגשה שלי למצב ולמחזור הזה — אם קיימת.
 * זה מה שהופך "טיוטה" ל"הרכב נעול".
 */
export function findMyEntry(
  gameweekId: string, mode: 'full' | 'five', userId: string,
): LineupEntry | undefined {
  const me = currentIdentity()?.id ?? userId;
  return listEntries(gameweekId, mode).find((e) => e.userId === me || e.userId === userId);
}

export function getResults(gameweekId: string): GameweekResults {
  return snapshot.results[gameweekId] ?? emptyResults(gameweekId);
}

export function getGameweekState(): GameweekState | null {
  return snapshot.gameweek;
}

/* ================================================================== */
/* כתיבה — אסינכרונית, דרך השרת                                        */
/* ================================================================== */

/**
 * הגשת הרכב.
 *
 * ★ שימו לב מה **לא** נשלח: מחיר, קבוצה, עמדה. השרת קורא אותם
 *   מהסגל. קליינט ששולח `price: 0` לא מקבל שחקן בחינם.
 */
export async function saveEntry(
  displayName: string,
  gameweekId: string,
  mode: 'full' | 'five',
  _userId: string,
  lineup: Lineup,
  _priceById?: Map<string, number> | Record<string, number>,
): Promise<LineupEntry> {
  const id = await ensureIdentity();

  const slots = lineup.slots
    .filter((s) => s.playerId)
    .map((s) => ({
      slot_no: s.slotNo,
      // המסד מכיר '101'; הקליינט מכיר 'P101'. התרגום כאן, במקום אחד.
      ext_player_id: s.playerId.replace(/^P/, ''),
      is_captain: !!s.isCaptain,
      is_vice: !!s.isVice,
      is_bench: !!s.isBench,
    }));

  const { error } = await supabase.rpc('submit_entry', {
    p_gw_code: gameweekId,
    p_mode: mode,
    p_formation: lineup.formation,
    p_slots: slots,
    p_display_name: displayName.trim() || null,
  });
  if (error) throw new Error(errorCode(error));

  await refresh();

  const mine = findMyEntry(gameweekId, mode, id.id);
  if (mine) return mine;

  // השרת קיבל אבל הרענון לא הספיק. מחזירים ייצוג עקבי כדי שהמסך
  // יתקדם; הרענון הבא יחליף אותו בשורה האמיתית.
  return {
    id: `pending-${Date.now()}`,
    magicCode: '',
    displayName: displayName.trim(),
    gameweekId, mode, userId: id.id,
    lineup, submittedAt: new Date().toISOString(),
  };
}

/** ביטול הגשה — חזרה לעריכה. מותר רק לפני הנעילה ולפני פרסום. */
export async function deleteEntry(entryId: string): Promise<void> {
  const entry = snapshot.entries.find((e) => e.id === entryId);
  if (!entry) return;
  const { error } = await supabase.rpc('withdraw_entry', {
    p_gw_code: entry.gameweekId, p_mode: entry.mode,
  });
  if (error) throw new Error(errorCode(error));
  await refresh();
}

/* ------------------------------------------------------------------ */
/* אדמין                                                               */
/* ------------------------------------------------------------------ */

export async function upsertPerformance(
  gameweekId: string, perf: PlayerPerformance,
): Promise<void> {
  const { error } = await supabase.rpc('admin_upsert_player_stat', {
    p_gw_code: gameweekId,
    p_ext_player: perf.playerId.replace(/^P/, ''),
    p_stats: {
      minutes: perf.minutes, goals: perf.goals, assists: perf.assists,
      ownGoals: perf.ownGoals, yellowCards: perf.yellowCards, redCards: perf.redCards,
      saves: perf.saves, penaltiesSaved: perf.penaltiesSaved,
      penaltiesMissed: perf.penaltiesMissed, goalsConceded: perf.goalsConceded,
      cleanSheet: perf.cleanSheet,
    },
  });
  if (error) throw new Error(errorCode(error));
  await refresh();
}

/**
 * תוצאת משחק. ה-`outcomesForFixture` שהקורא מחשב אינו נשלח —
 * המסד גוזר W/D/L מהשערים בעצמו (`core.v_team_match_results`).
 * שני מקורות לאותה עובדה הם שני מקורות שיכולים לא להסכים.
 */
export async function upsertFixtureScore(
  gameweekId: string,
  score: FixtureScore,
  outcomesForFixture: TeamOutcome[],
): Promise<void> {
  const [home, away] = outcomesForFixture;
  if (!home || !away) throw new Error('FIXTURE_TEAMS_MISSING');

  const { error } = await supabase.rpc('admin_upsert_match', {
    p_gw_code: gameweekId,
    p_ext_home: home.teamId.replace(/^T/, ''),
    p_ext_away: away.teamId.replace(/^T/, ''),
    p_home_goals: score.homeGoals,
    p_away_goals: score.awayGoals,
    p_final: score.final,
  });
  if (error) throw new Error(errorCode(error));
  await refresh();
}

export async function setPublished(gameweekId: string, published: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_set_published', {
    p_gw_code: gameweekId, p_published: published,
  });
  if (error) throw new Error(errorCode(error));
  await refresh();
}

/** נשמר לתאימות עם קוד שקורא לו. הכתיבה עצמה עוברת בפונקציות למעלה. */
export async function saveResults(results: GameweekResults): Promise<void> {
  await setPublished(results.gameweekId, results.published);
}

/* ================================================================== */
/* מפגש ניהול                                                          */
/* ================================================================== */

/**
 * ★★ אזהרת אבטחה — לקרוא לפני שנוגעים ★★
 *
 * ה-PIN כאן הוא **נוחות UI בלבד**. הוא מונע ממי שנתקל ב-`#admin`
 * בטעות לפתוח את המסך. הוא לא מגן על כלום: מי שמריץ את הקוד
 * בדפדפן יכול לדלג עליו.
 *
 * ההגנה האמיתית עברה למסד. כל פונקציית אדמין
 * (`admin_upsert_match`, `admin_upsert_player_stat`,
 * `admin_set_published`) בודקת `game.is_admin()` בשורה הראשונה,
 * וזורקת `ADMIN_REQUIRED` אחרת. מסך פתוח בלי הרשאה במסד לא יכול
 * לשנות דבר.
 *
 * הפיכת משתמש לאדמין, פעם אחת, מה-SQL Editor:
 *     UPDATE game.users SET is_admin = TRUE WHERE id = '<auth uid>';
 */
const ADMIN_PIN_HASH =
  '15a4edaa167df3c9656a9d3dacb527f795dfd2007bc2e0247a27eaeefc8343bf';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;
const ATTEMPTS_KEY = 'dubid.admin.attempts.v1';

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readAttempts(): { count: number; until: number } {
  try {
    return JSON.parse(sessionStorage.getItem(ATTEMPTS_KEY) ?? '') as { count: number; until: number };
  } catch {
    return { count: 0, until: 0 };
  }
}

function writeAttempts(v: { count: number; until: number }) {
  try {
    sessionStorage.setItem(ATTEMPTS_KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

/** כמה שניות נותרו לנעילה. 0 = לא נעול. */
export function adminLockoutSeconds(): number {
  const { until } = readAttempts();
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

export async function tryAdminLogin(pin: string): Promise<boolean> {
  if (adminLockoutSeconds() > 0) return false;

  const ok = (await sha256Hex(pin.trim())) === ADMIN_PIN_HASH;

  if (ok) {
    writeAttempts({ count: 0, until: 0 });
    try {
      sessionStorage.setItem(KEYS.adminSession, '1');
    } catch {
      /* ignore */
    }
    return true;
  }

  const prev = readAttempts();
  const count = prev.count + 1;
  writeAttempts({
    count: count >= MAX_ATTEMPTS ? 0 : count,
    until: count >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0,
  });
  return false;
}

export function isAdminSession(): boolean {
  try {
    return sessionStorage.getItem(KEYS.adminSession) === '1';
  } catch {
    return false;
  }
}

export function adminLogout() {
  try {
    sessionStorage.removeItem(KEYS.adminSession);
  } catch {
    /* ignore */
  }
}

/** האם המשתמש הנוכחי אדמין **במסד**. זו הבדיקה שקובעת. */
export async function isDatabaseAdmin(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('is_admin');
    return !error && data === true;
  } catch {
    return false;
  }
}

/** הוק-עזר: מרענן קומפוננטה בכל פעם שהחנות משתנה. */
export function subscribeToStore(cb: () => void): () => void {
  window.addEventListener('dubid:store', cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener('dubid:store', cb);
    window.removeEventListener('storage', cb);
  };
}

/* ------------------------------------------------------------------ */
/* קודי קסם — נשאר לתאימות                                             */
/* ------------------------------------------------------------------ */

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function makeMagicCode(): string {
  return (
    'DB-' +
    Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('')
  );
}

/** שחזור לפי שם + קוד. במצב מקוון השחזור עובר ב-`identity.ts`. */
export function findEntry(displayName: string, magicCode: string): LineupEntry | undefined {
  const name = displayName.trim().toLowerCase();
  const code = magicCode.trim().toUpperCase();
  return snapshot.entries.find(
    (e) => e.displayName.trim().toLowerCase() === name && e.magicCode.toUpperCase() === code,
  );
}

/* ================================================================== */
/* אדמין · סגלים                                                       */
/* ================================================================== */

/**
 * ★ למה הסגלים לא היו ניתנים לעריכה עד עכשיו
 *
 * הם היו **קובץ**: `src/data/squads.ts`, 112kb שנבנו בסקריפט
 * מתוך גיליון. זה עבד מצוין כל עוד אף אחד לא עבר קבוצה, אף אחד
 * לא נפצע, ואף מחיר לא היה צריך איזון.
 *
 * ארבע הפעולות שקורות בעולם האמיתי — חתימה, מעבר, תמחור,
 * פציעה — דרשו עד עכשיו לערוך קובץ, לבנות מחדש, ולפרוס. כלומר
 * הן לא קרו.
 *
 * עכשיו הן RPC. הקובץ נשאר כמקור לבחירה בממשק; המסד הוא מקור
 * האמת לתמחור ולחוקיות ההגשה (`db/11` §5–§8).
 *
 * ⚠ **פער ידוע:** `src/data/squads.ts` לא מתעדכן אוטומטית משינוי
 *   באדמין. שחקן חדש ייכנס להגשות (השרת מכיר אותו) אבל לא יופיע
 *   בבורר עד שהקובץ ייבנה מחדש. הסנכרון המלא הוא הצעד הבא, ולא
 *   נבנה כאן כדי לא לשנות את מסלול הבחירה לפני המבחן החי.
 */

export interface AdminPlayerRow {
  id: string;
  nameHe: string;
  nameEn: string | null;
  position: 'GK' | 'DEF' | 'MID' | 'FWD';
  price: number | null;
  shirt: number | null;
  status: 'active' | 'injured' | 'suspended' | 'loaned_out' | 'left';
}

export interface AdminTeamSquad {
  teamId: string;
  nameHe: string;
  short: string;
  players: AdminPlayerRow[];
}

export async function fetchAdminSquads(): Promise<AdminTeamSquad[]> {
  const { data, error } = await supabase.rpc('admin_squads');
  if (error) throw new Error(errorCode(error));
  return (data ?? []) as AdminTeamSquad[];
}

export async function adminUpsertPlayer(input: {
  teamId: string;
  nameHe: string;
  /** ריק = שחקן חדש. */
  playerId?: string;
  nameEn?: string;
  position: AdminPlayerRow['position'];
  price?: number | null;
  shirt?: number | null;
  status?: AdminPlayerRow['status'];
}): Promise<string> {
  const { data, error } = await supabase.rpc('admin_upsert_player', {
    p_ext_team: input.teamId.replace(/^T/, ''),
    p_name_he: input.nameHe.trim(),
    p_ext_player: input.playerId ? input.playerId.replace(/^P/, '') : null,
    p_name_en: input.nameEn?.trim() || null,
    p_position: input.position,
    p_price: input.price ?? null,
    p_shirt: input.shirt ?? null,
    p_status: input.status ?? 'active',
  });
  if (error) throw new Error(errorCode(error));
  return `P${String(data)}`;
}

export async function adminMovePlayer(playerId: string, toTeamId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_move_player', {
    p_ext_player: playerId.replace(/^P/, ''),
    p_ext_team: toTeamId.replace(/^T/, ''),
  });
  if (error) throw new Error(errorCode(error));
}

export async function adminSetPrice(playerId: string, price: number): Promise<void> {
  const { error } = await supabase.rpc('admin_set_price', {
    p_ext_player: playerId.replace(/^P/, ''),
    p_price: price,
  });
  if (error) throw new Error(errorCode(error));
}

export async function adminSetPlayerStatus(
  playerId: string, status: AdminPlayerRow['status'],
): Promise<void> {
  const { error } = await supabase.rpc('admin_set_player_status', {
    p_ext_player: playerId.replace(/^P/, ''),
    p_status: status,
  });
  if (error) throw new Error(errorCode(error));
}

/* ================================================================== */
/* כניסת אדמין — סיסמה אחת                                             */
/* ================================================================== */

/**
 * ★ למה זה עבר לשרת.
 *
 * `tryAdminLogin` משווה hash **בדפדפן**. זה פתח את המסך ולא
 * נתן הרשאה לשמור — לזה נדרש `UPDATE game.users SET is_admin`
 * ידני ב-SQL Editor. מי שעשה רק את הראשון קיבל מסך מלא שבו כל
 * לחיצה נכשלת, וזה נראה כמו באג ולא כמו שלב שנשכח.
 *
 * `game.claim_admin` עושה את שניהם: משווה בשרת, ואם נכון —
 * מסמן את הקורא כאדמין. אין שלב שני.
 */
export interface AdminClaimResult {
  ok: boolean;
  error?: 'BAD_SECRET' | 'LOCKED' | 'AUTH_REQUIRED' | 'NO_SECRET_CONFIGURED' | 'NETWORK';
  triesLeft?: number;
  retryInSeconds?: number;
}

export async function claimAdmin(secret: string): Promise<AdminClaimResult> {
  try {
    await ensureIdentity();
    const { data, error } = await supabase.rpc('claim_admin', { p_secret: secret });
    if (error) {
      // הפונקציה לא קיימת = db/12 לא רץ. הודעה מדויקת עדיפה על
      // "סיסמה שגויה", שהיא שקר שישלח אותך לחפש במקום הלא נכון.
      return { ok: false, error: errorCode(error) === 'MIGRATION_MISSING'
        ? 'NO_SECRET_CONFIGURED' : 'NETWORK' };
    }
    return (data ?? { ok: false, error: 'NETWORK' }) as AdminClaimResult;
  } catch {
    return { ok: false, error: 'NETWORK' };
  }
}

export async function releaseAdmin(): Promise<void> {
  try { await supabase.rpc('release_admin'); } catch { /* יציאה לא נכשלת */ }
}

export const ADMIN_ERROR_HE: Record<string, string> = {
  BAD_SECRET: 'סיסמה שגויה.',
  LOCKED: 'יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.',
  AUTH_REQUIRED: 'אין זהות פעילה. רעננו את הדף.',
  NO_SECRET_CONFIGURED: 'הסיסמה לא הוגדרה במסד — צריך להריץ את db/12_admin_access.sql.',
  NETWORK: 'השרת לא ענה. בדקו חיבור ונסו שוב.',
};

/* ================================================================== */
/* בדיקת מערכת                                                         */
/* ================================================================== */

/**
 * ★ למה זה קיים.
 *
 * "אין חיבור לשרת" יכול לנבוע מחמישה דברים שונים, וכל אחד מהם
 * מתוקן במקום אחר בלוח הבקרה של Supabase. במקום לנחש — בודקים
 * כל חוליה בנפרד ואומרים איזו נפלה.
 *
 * הבדיקות רצות **בסדר התלות**: אין טעם לבדוק סגלים אם הסכימה
 * לא חשופה, כי התוצאה תהיה אותה שגיאה בדיוק ותסתיר את המקור.
 */
export interface HealthCheck {
  id: string;
  label: string;
  ok: boolean | null;      // null = לא נבדק (חוליה קודמת נפלה)
  detail: string;
  fix?: string;
}

export async function runHealthChecks(): Promise<HealthCheck[]> {
  const out: HealthCheck[] = [];
  const skip = (id: string, label: string, why: string): HealthCheck =>
    ({ id, label, ok: null, detail: why });

  /* 1 — זהות */
  let identityOk = false;
  try {
    const id = await ensureIdentity();
    identityOk = id.online;
    out.push({
      id: 'auth',
      label: 'זהות (כניסת אורח)',
      ok: identityOk,
      detail: identityOk ? `מחובר · ${id.id.slice(0, 8)}…` : 'לא הצלחנו ליצור זהות',
      fix: identityOk ? undefined
        : 'Authentication → Providers → Anonymous sign-ins → להדליק',
    });
  } catch {
    out.push({
      id: 'auth', label: 'זהות (כניסת אורח)', ok: false,
      detail: 'שגיאה ביצירת זהות',
      fix: 'Authentication → Providers → Anonymous sign-ins → להדליק',
    });
  }

  /* 2 — הסכימה חשופה + המיגרציות רצו */
  let schemaOk = false;
  try {
    const { data, error } = await supabase.rpc('gameweek_state', { p_gw_code: 'gw-2' });
    if (error) throw error;
    schemaOk = !!data;
    out.push({
      id: 'schema',
      label: 'מסד · סכימה ומיגרציות',
      ok: schemaOk,
      detail: schemaOk
        ? `מחזור ${(data as { number?: number }).number ?? '?'} נמצא`
        : 'המחזור gw-2 לא נמצא',
      fix: schemaOk ? undefined : 'להריץ db/09 ו-db/11, ואז לבדוק Exposed schemas',
    });
  } catch (err) {
    const c = errorCode(err);
    out.push({
      id: 'schema', label: 'מסד · סכימה ומיגרציות', ok: false,
      detail: errorMessageHe(c),
      fix: c === 'SCHEMA_NOT_EXPOSED'
        ? 'Settings → API → Exposed schemas → public, core, game, shared'
        : 'להריץ את המיגרציות לפי docs/INSTALL.md שלב 1',
    });
  }

  if (!schemaOk) {
    out.push(skip('squads', 'סגלים ומחירים', 'לא נבדק — הסכימה לא זמינה'));
    out.push(skip('clock', 'שעון השרת', 'לא נבדק — הסכימה לא זמינה'));
    out.push(skip('admin', 'הרשאת ניהול', 'לא נבדק — הסכימה לא זמינה'));
    return out;
  }

  /* 3 — סגלים ומחירים */
  try {
    const { data, error } = await supabase.rpc('results', { p_gw_code: 'gw-2' });
    if (error) throw error;
    out.push({
      id: 'squads', label: 'תוצאות ונתוני מחזור', ok: true,
      detail: (data as { published?: boolean })?.published
        ? 'המחזור פורסם' : 'המחזור עוד לא פורסם (תקין)',
    });
  } catch (err) {
    out.push({
      id: 'squads', label: 'תוצאות ונתוני מחזור', ok: false,
      detail: errorMessageHe(errorCode(err)),
      fix: 'להריץ db/09_live_mvp.sql',
    });
  }

  /* 4 — שעון */
  try {
    const { data, error } = await supabase.rpc('server_now');
    if (error) throw error;
    const drift = Math.abs(Number(data) - Date.now());
    out.push({
      id: 'clock', label: 'שעון השרת', ok: drift < 120_000,
      detail: `הפרש ${Math.round(drift / 1000)} שניות מהמכשיר`,
      fix: drift < 120_000 ? undefined : 'הפרש גדול — שעון המכשיר לא מדויק',
    });
  } catch {
    out.push({
      id: 'clock', label: 'שעון השרת', ok: false,
      detail: 'game.server_now() לא נמצאה',
      fix: 'להריץ db/09_live_mvp.sql (§3b)',
    });
  }

  /* 5 — הרשאה */
  try {
    const isAdmin = await isDatabaseAdmin();
    out.push({
      id: 'admin', label: 'הרשאת ניהול', ok: isAdmin,
      detail: isAdmin ? 'יש הרשאה' : 'אין הרשאה למשתמש הזה',
      fix: isAdmin ? undefined : 'להקליד את הסיסמה במסך הכניסה — היא מעניקה את ההרשאה',
    });
  } catch {
    out.push({ id: 'admin', label: 'הרשאת ניהול', ok: false, detail: 'לא ניתן לבדוק' });
  }

  return out;
}
