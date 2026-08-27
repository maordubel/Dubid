/**
 * lib/liveData.ts — דאטת הכדורגל מגיעה מהשרת.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★★ הבאג שהמודול הזה קיים כדי לתקן ★★
 * ═══════════════════════════════════════════════════════════════
 *
 * לוח הניהול **כתב** למסד. אף מסך לא **קרא** ממנו.
 *
 * 14 הקבוצות ו-351 השחקנים חיו ב-`src/data/squads.ts` — קובץ
 * TypeScript שנארז לתוך ה-JavaScript בזמן בנייה. לוח המשחקים
 * חי ב-`src/data/fixtures.ts`. האדמין שינה מחיר, הפונקציה רצה,
 * השורה השתנתה — והמסך המשיך להראות את המספר מהקובץ.
 *
 * זה נראה בדיוק כמו "האדמין לא שומר". הוא שמר.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ למה מוטציה במקום, ולא מודול חדש שכולם עוברים אליו
 * ═══════════════════════════════════════════════════════════════
 *
 * `TEAMS`, `PLAYERS`, `TEAM_BY_ID` ו-`PLAYERS_BY_TEAM` מיובאים
 * בשמונה קבצים, וכל קריאה אליהם היא סינכרונית בתוך רינדור.
 * להפוך אותם ל-`async` פירושו לכתוב מחדש כל מסך במוצר, עם עשרות
 * מצבי טעינה חדשים — כל אחד עם באג משלו.
 *
 * במקום זה: **אותם אובייקטים בדיוק, תוכן חדש.** ייבוא ב-ES
 * מחזיק הפניה לאותו מערך; `splice` ו-`Map.set` משנים את מה
 * שכולם רואים, בלי שאף קובץ ידע שמשהו קרה.
 *
 * זו בדיוק השיטה של `lib/store.ts` להגשות ולתוצאות, ומאותה
 * סיבה. אין כאן ארכיטקטורה שנייה.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ הקובץ הסטטי לא נמחק, והוא לא מקור אמת
 * ═══════════════════════════════════════════════════════════════
 *
 * `src/data/squads.ts` נשאר בתפקיד אחד: **הפריים הראשון.** הוא
 * מה שנראה במאיות השנייה שבין פתיחת הדף לתשובת השרת, והוא מה
 * שנשאר על המסך אם הרשת נופלת באמצע.
 *
 * ⚠ הוא **לא** משמש כגיבוי אחרי שהשרת ענה. ברגע שהגיעה תשובה,
 *   היא מחליפה הכל. ליגה חצי-מהשרת-חצי-מהקובץ היא בדיוק סוג
 *   חוסר-העקביות שקשה לאתר: המחיר החדש והשחקן הישן, באותו מסך.
 */
import { supabase } from './supabase.ts';
import {
  TEAMS, PLAYERS, TEAM_BY_ID, PLAYERS_BY_TEAM,
  type TeamRow, type PlayerRow,
} from '../data/squads.ts';
import { applyLiveFixtures, type LiveFixturePayload } from '../data/fixtures.ts';
import type { Position } from './scoring/types.ts';

/* ================================================================== */
/* מה שהשרת מחזיר                                                      */
/* ================================================================== */

interface SquadsPayload {
  teams?: Array<{
    id: string; externalId: string; nameHe: string; nameEn: string;
    short: string; city: string | null; stadium: string | null;
  }>;
  players?: Array<{
    id: string; externalId: string; teamId: string; position: string;
    nameHe: string; nameEn: string; shirt: number | null;
    tier: number; price: number; overallRank: number | null; rated: boolean;
    nationality: string | null; isClubCaptain: boolean; status: string;
  }>;
  revision?: number;
}

/** זמינות שחקן. הקובץ הסטטי לא הכיר את המושג — המסד כן. */
export type PlayerStatus = 'active' | 'injured' | 'suspended' | 'loaned_out' | 'left';

/**
 * ★ סטטוס יושב במפה נפרדת ולא בתוך `PlayerRow`.
 *
 * `PlayerRow` נוצר אוטומטית מ-`scripts/build-squads.mjs`. הוספת
 * שדה שם הייתה נמחקת בבנייה הבאה של הקובץ. מפה צדדית שורדת.
 */
const statusById = new Map<string, PlayerStatus>();

export function playerStatus(playerId: string): PlayerStatus {
  return statusById.get(playerId) ?? 'active';
}

/** האם השחקן זמין למשחק. פצוע/מורחק — כן לבחירה, עם סימון. */
export function isPlayerAvailable(playerId: string): boolean {
  const s = playerStatus(playerId);
  return s !== 'left' && s !== 'loaned_out';
}

export const STATUS_HE: Record<PlayerStatus, string> = {
  active: '',
  injured: 'פצוע',
  suspended: 'מורחק',
  loaned_out: 'בהשאלה',
  left: 'עזב',
};

/* ================================================================== */
/* מצב                                                                 */
/* ================================================================== */

interface LiveState {
  /** מונה הגרסה של המסד. עולה בכל שינוי דאטה, בכל מקור. */
  revision: number;
  /** מונה מקומי — עולה בכל החלפה בפועל. יעד ל-`useMemo`. */
  version: number;
  /** `true` = מה שעל המסך הגיע מהשרת. `false` = הזרע הסטטי. */
  fromServer: boolean;
  loading: boolean;
  error: string | null;
}

const state: LiveState = {
  revision: 0,
  version: 0,
  fromServer: false,
  loading: false,
  error: null,
};

export function liveDataVersion(): number {
  return state.version;
}

export function liveDataStatus(): { fromServer: boolean; loading: boolean; error: string | null } {
  return { fromServer: state.fromServer, loading: state.loading, error: state.error };
}

const EVENT = 'dubid:livedata';

function notify() {
  state.version += 1;
  try {
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* SSR / לא בדפדפן */
  }
}

export function subscribeToLiveData(cb: () => void): () => void {
  try {
    window.addEventListener(EVENT, cb);
    return () => window.removeEventListener(EVENT, cb);
  } catch {
    return () => {};
  }
}

/* ================================================================== */
/* החלפת התוכן                                                         */
/* ================================================================== */

const POSITIONS: Position[] = ['GK', 'DEF', 'MID', 'FWD'];

function toPosition(raw: string): Position {
  return (POSITIONS as string[]).includes(raw) ? (raw as Position) : 'MID';
}

/** דרג הוא `1|2|3|4|5` בטיפוס. כל דבר אחר הוא כרטיס שבור. */
function toTier(raw: unknown): 1 | 2 | 3 | 4 | 5 {
  const n = Math.round(Number(raw));
  return (n >= 1 && n <= 5 ? n : 3) as 1 | 2 | 3 | 4 | 5;
}

/**
 * ★ הלב: אותם אובייקטים, תוכן חדש.
 *
 * `splice(0, length, …items)` ולא השמה. השמה הייתה יוצרת מערך
 * חדש שרק המודול הזה מכיר, וכל שאר המוצר היה ממשיך להצביע על
 * הישן — כלומר בדיוק הבאג שאנחנו מתקנים, רק במקום אחר.
 */
export function applyLiveSquads(payload: SquadsPayload): boolean {
  const rawTeams = payload.teams ?? [];
  const rawPlayers = payload.players ?? [];

  /* ⚠ שער שפיות. תשובה ריקה או חלקית מהשרת לא מוחקת את הליגה
     מהמסך — זו הייתה החלפה של "מידע ישן" ב"שום מידע", וזה גרוע
     יותר. הזרע הסטטי נשאר, `fromServer` נשאר false, והמסך יכול
     להגיד את זה. */
  if (rawTeams.length === 0 || rawPlayers.length === 0) return false;

  const teams: TeamRow[] = rawTeams.map((t) => ({
    id: t.id,
    externalId: t.externalId,
    nameHe: t.nameHe,
    nameEn: t.nameEn ?? t.nameHe,
    short: t.short || t.nameHe,
    city: t.city,
    stadium: t.stadium,
  }));

  const players: PlayerRow[] = rawPlayers.map((p) => ({
    id: p.id,
    externalId: p.externalId,
    teamId: p.teamId,
    position: toPosition(p.position),
    nameHe: p.nameHe,
    nameEn: p.nameEn ?? p.nameHe,
    shirt: p.shirt ?? null,
    tier: toTier(p.tier),
    price: Number(p.price) || 1,
    overallRank: p.overallRank ?? null,
    rated: !!p.rated,
    nationality: p.nationality ?? null,
    isClubCaptain: !!p.isClubCaptain,
  }));

  // ----- קבוצות -----
  TEAMS.splice(0, TEAMS.length, ...teams);
  TEAM_BY_ID.clear();
  for (const t of teams) TEAM_BY_ID.set(t.id, t);

  // ----- שחקנים -----
  PLAYERS.splice(0, PLAYERS.length, ...players);
  statusById.clear();
  for (const p of rawPlayers) statusById.set(p.id, (p.status ?? 'active') as PlayerStatus);

  // ----- הנגזרת -----
  PLAYERS_BY_TEAM.splice(
    0,
    PLAYERS_BY_TEAM.length,
    ...teams.map((t) => ({ team: t, players: players.filter((p) => p.teamId === t.id) })),
  );

  if (typeof payload.revision === 'number') state.revision = payload.revision;
  state.fromServer = true;
  return true;
}

/* ================================================================== */
/* טעינה                                                               */
/* ================================================================== */

let inFlight: Promise<void> | null = null;
let activeGameweek = '';

/**
 * מביא סגלים + לוח משחקים. קריאות מקבילות מתאחדות.
 *
 * ★ כישלון אינו קטלני: הזרע הסטטי נשאר על המסך והמוצר עובד.
 *   מה שכן קורה הוא ש-`fromServer` נשאר `false`, וזה מה שמסך
 *   הבריאות באדמין מציג.
 */
export function hydrateLiveData(gameweekId: string, force = false): Promise<void> {
  if (inFlight && !force) return inFlight;
  activeGameweek = gameweekId;

  inFlight = (async () => {
    state.loading = true;
    notify();
    try {
      const [squadsRes, fixturesRes] = await Promise.all([
        supabase.rpc('squads'),
        supabase.rpc('fixtures', { p_gw_code: gameweekId }),
      ]);

      if (squadsRes.error) throw squadsRes.error;

      let changed = applyLiveSquads((squadsRes.data ?? {}) as SquadsPayload);

      /* ★ הלוח נטען אחרי הסגלים, בכוונה.
         `applyLiveFixtures` בונה תוויות ("שבת", יריבה) שמסתמכות
         על `TEAM_BY_ID`. סדר הפוך היה מייצר לוח שמצביע על
         קבוצות מהקובץ הישן. */
      if (!fixturesRes.error && fixturesRes.data) {
        changed = applyLiveFixtures(fixturesRes.data as LiveFixturePayload) || changed;
      }

      state.error = null;
      if (changed) notify();
    } catch (err) {
      state.fromServer = false;
      state.error = err instanceof Error ? err.message : String(err);
    } finally {
      state.loading = false;
      inFlight = null;
      notify();
    }
  })();

  return inFlight;
}

export function refreshLiveData(): Promise<void> {
  return activeGameweek ? hydrateLiveData(activeGameweek, true) : Promise.resolve();
}

/**
 * ★ זמן אמת על **מונה אחד**, לא על שש טבלאות.
 *
 * שינוי מחיר אחד באדמין נוגע ב-3 טבלאות. האזנה לכולן הייתה
 * מביאה שלושה אירועים ושלושה רענונים לאותו שינוי. `data_revision`
 * הוא שורה אחת שעולה פעם אחת לכל פעולה (טריגר STATEMENT), ולכן
 * מכשיר שפתוח מגלה שינוי — פעם אחת.
 */
export function startLiveDataRealtime(gameweekId: string): () => void {
  const channel = supabase
    .channel('dubid-data')
    .on(
      'postgres_changes',
      { event: '*', schema: 'game', table: 'data_revision' },
      () => { void hydrateLiveData(gameweekId, true); },
    )
    .subscribe();

  return () => { void supabase.removeChannel(channel); };
}
