/**
 * src/data/fixtures.ts — לוח המשחקים.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ מה השתנה: הלוח מגיע מהשרת
 * ═══════════════════════════════════════════════════════════════
 *
 * עד כאן הקובץ הזה **היה** הלוח: שבע שורות מוקלדות, שנארזו לתוך
 * ה-JavaScript בזמן בנייה. אדמין שהזיז משחק היה צריך שמישהו
 * יערוך קובץ, יבנה, ויפרוס — כלומר הלוח שעל המסך של המשתמשים לא
 * היה קשור ללוח שבמסד.
 *
 * עכשיו: `game.fixtures('gw-2')` היא מקור האמת, ו-`applyLiveFixtures`
 * מחליפה את התוכן כאן. הערכים שנשארו בקובץ הם **הזרע** — מה
 * שנראה בפריים הראשון ומה שנשאר אם הרשת נופלת.
 *
 * ★ למה `let` ולא `const`
 *
 * `GAMEWEEK_DEADLINE` ו-`FIRST_KICKOFF` הם מחרוזות. אי אפשר
 * "לשנות מחרוזת במקום" כמו שמשנים מערך. ייבוא ב-ES הוא **קישור
 * חי**: מי שמייבא `GAMEWEEK_DEADLINE` רואה את הערך העדכני, כל
 * עוד ההשמה נעשית **בתוך הקובץ הזה**. לכן `applyLiveFixtures`
 * גרה כאן, ולא ב-`lib/liveData.ts`.
 *
 * הערת נורמליזציה היסטורית: הלוח שסופק ידנית כתב "הפועל קריית
 * שמונה", והקבוצה הרשומה בסגלים היא "עירוני קריית שמונה" (T10).
 * אותה קבוצה. מאז המיפוי חי במסד ולא כאן.
 */
import { TEAM_BY_ID } from './squads.ts';

export interface Fixture {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  /** ISO, שעון ישראל */
  kickoff: string;
  dayLabel: string;
  /**
   * האם שעת הפתיחה אושרה מול הלוח הרשמי.
   * false = מוצג "שעה תיקבע" במקום שעה מומצאת.
   */
  timeConfirmed: boolean;
}

/**
 * ★ אובייקט ולא קבוע: `applyLiveFixtures` מעדכנת את השדות שלו
 *   במקום. כל מי שמייבא `GAMEWEEK` ממשיך להצביע על אותו אובייקט.
 */
export const GAMEWEEK = {
  id: 'gw-2',
  number: 2,
  label: 'מחזור 2',
  seasonLabel: 'ליגת העל 2026/27',
};

/**
 * ★ הזרע — מחזור 2 כפי שהוא במסד.
 *
 * ★ למה זה עדיין כאן אחרי שהשרת הוא מקור האמת
 *
 * המסך הראשון. בין פתיחת הדף לתשובת השרת עוברות מאות מילישניות,
 * ובהן הלובי כבר מרנדר. לובי בלי לוח משחקים בפריים הראשון נראה
 * כמו מוצר ריק.
 *
 * ★ הדדליין נגזר מבעיטת הפתיחה **המוקדמת ביותר**, ולא מהמאוחרת.
 *   אחרת מי שמחכה עד ראשון בוחר שחקן אחרי שכבר ראה חמישה
 *   משחקים — יתרון מידע שהורס את התחרות. השרת גוזר אותו באותה
 *   דרך בדיוק (`game.admin_resync_deadline`).
 */
export const FIXTURES: Fixture[] = [
  // שבת 29/08
  { id: 'gw2-1', homeTeamId: 'T8',  awayTeamId: 'T12', kickoff: '2026-08-29T20:00:00+03:00', dayLabel: 'שבת',   timeConfirmed: true },
  { id: 'gw2-2', homeTeamId: 'T5',  awayTeamId: 'T7',  kickoff: '2026-08-29T20:00:00+03:00', dayLabel: 'שבת',   timeConfirmed: true },
  { id: 'gw2-3', homeTeamId: 'T13', awayTeamId: 'T1',  kickoff: '2026-08-29T20:00:00+03:00', dayLabel: 'שבת',   timeConfirmed: true },
  { id: 'gw2-4', homeTeamId: 'T14', awayTeamId: 'T2',  kickoff: '2026-08-29T20:00:00+03:00', dayLabel: 'שבת',   timeConfirmed: true },
  { id: 'gw2-5', homeTeamId: 'T10', awayTeamId: 'T11', kickoff: '2026-08-29T20:00:00+03:00', dayLabel: 'שבת',   timeConfirmed: true },
  // ראשון 30/08
  { id: 'gw2-6', homeTeamId: 'T9',  awayTeamId: 'T6',  kickoff: '2026-08-30T20:00:00+03:00', dayLabel: 'ראשון', timeConfirmed: true },
  // שני 31/08
  { id: 'gw2-7', homeTeamId: 'T3',  awayTeamId: 'T4',  kickoff: '2026-08-31T20:00:00+03:00', dayLabel: 'שני',   timeConfirmed: true },
];

/** מפה: מזהה קבוצה → היריבה שלה במחזור הנוכחי (או null אם אין לה משחק). */
export const OPPONENT_BY_TEAM: Record<string, { opponentId: string; isHome: boolean; fixture: Fixture } | undefined> = {};

/** בונה מחדש את מפת היריבות מ-`FIXTURES`. נקראת בטעינה ובכל עדכון. */
function rebuildOpponents() {
  for (const k of Object.keys(OPPONENT_BY_TEAM)) delete OPPONENT_BY_TEAM[k];
  for (const f of FIXTURES) {
    OPPONENT_BY_TEAM[f.homeTeamId] = { opponentId: f.awayTeamId, isHome: true, fixture: f };
    OPPONENT_BY_TEAM[f.awayTeamId] = { opponentId: f.homeTeamId, isHome: false, fixture: f };
  }
}
rebuildOpponents();

export function fixtureLabel(f: Fixture): string {
  const home = TEAM_BY_ID.get(f.homeTeamId)?.nameHe ?? f.homeTeamId;
  const away = TEAM_BY_ID.get(f.awayTeamId)?.nameHe ?? f.awayTeamId;
  return `${home} – ${away}`;
}

/**
 * ★ אזור הזמן ננעל על ישראל, ולא נגזר מהמכשיר.
 *
 * באג שנתפס: `toLocaleTimeString('he-IL')` בלי `timeZone` משתמש
 * באזור הזמן של המכשיר. משחק ב-20:00 שעון ישראל הוצג כ-17:00
 * לכל מי שהמכשיר שלו ב-UTC — וגם בכל רינדור בצד שרת.
 *
 * הליגה משחקת בישראל. השעה שמוצגת היא שעת המשחק, נקודה — גם
 * למשתמש שיושב בניו יורק.
 *
 * ★ זה קריטי כפליים מאז שהלוח מגיע מהמסד: `game.fixtures()`
 *   מחזירה UTC (`…Z`). בלי `timeZone` מפורש, אותו משחק היה
 *   מוצג בשעה אחרת לכל משתמש.
 */
const LEAGUE_TZ = 'Asia/Jerusalem';

export function kickoffTimeLabel(iso: string, confirmed = true): string {
  if (!confirmed) return 'שעה תיקבע';
  return new Date(iso).toLocaleTimeString('he-IL', {
    hour: '2-digit', minute: '2-digit', timeZone: LEAGUE_TZ,
  });
}

export function kickoffDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('he-IL', {
    day: '2-digit', month: '2-digit', timeZone: LEAGUE_TZ,
  });
}

/** יום בשבוע בעברית, לפי שעון ישראל. נגזר ולא מוקלד. */
function dayLabelOf(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('he-IL', {
      weekday: 'long', timeZone: LEAGUE_TZ,
    }).replace(/^יום\s+/, '');
  } catch {
    return '';
  }
}

/** האם יש ולו משחק אחד בלי שעה מאושרת. מוצג כאזהרה באדמין. */
export let HAS_UNCONFIRMED_TIMES: boolean = FIXTURES.some((f) => !f.timeConfirmed);

/**
 * ★ נגזר מהמשחקים ולא מוקלד בנפרד.
 *
 * אילו זה היה שדה נפרד, יום אחד מישהו היה מזיז משחק ושוכח
 * לעדכן אותו — והמשחק היה ממשיך לקבל הרכבים אחרי שהכדור כבר
 * מתגלגל.
 *
 * זהו ערך תצוגה בלבד. האכיפה היא `game.gameweeks.lock_at` בשרת.
 */
export let GAMEWEEK_DEADLINE: string = FIXTURES
  .map((f) => f.kickoff)
  .sort()[0] ?? new Date().toISOString();

export let FIRST_KICKOFF: string = GAMEWEEK_DEADLINE;

/* ================================================================== */
/* עדכון מהשרת                                                         */
/* ================================================================== */

export interface LiveFixturePayload {
  gameweek?: {
    id: string; number: number; label: string; status: string;
    lockAt: string; firstKickoffAt: string;
  } | null;
  fixtures?: Array<{
    id: string; homeTeamId: string; awayTeamId: string; kickoff: string;
    status: string; homeGoals: number | null; awayGoals: number | null;
  }>;
}

/** סטטוס המשחק כפי שהמסד מכיר אותו. לא בתוך `Fixture` — ראו למטה. */
export type FixtureStatus = 'scheduled' | 'live' | 'finished' | 'postponed' | 'abandoned';

/**
 * ★ מפה צדדית ולא שדה ב-`Fixture`.
 *
 * `Fixture` מיובא בארבעה מסכים ובבדיקות. הוספת שדה חובה הייתה
 * מפילה כל מקום שבונה `Fixture` ידנית — כולל הזרע שמעל. מפה
 * לפי מזהה עולה אפס, ולא נוגעת באף חתימה.
 */
const fixtureStatusById = new Map<string, FixtureStatus>();

export function fixtureStatus(id: string): FixtureStatus {
  return fixtureStatusById.get(id) ?? 'scheduled';
}

/**
 * מחליפה את הלוח בזה שהגיע מהשרת.
 *
 * מחזירה `true` אם משהו באמת השתנה — כדי שהקורא לא ידווח על
 * עדכון שלא היה ולא יפעיל רינדור מיותר.
 *
 * ⚠ תשובה בלי משחקים **לא** מוחקת את הלוח. מסך בלי לוח נראה
 *   כמו מוצר שבור, ומחזור שהמסד לא מכיר עדיין הוא מצב חוקי
 *   לגמרי (למשל בזמן שהאדמין בונה אותו).
 */
export function applyLiveFixtures(payload: LiveFixturePayload): boolean {
  const raw = payload.fixtures ?? [];
  if (raw.length === 0) return false;

  const next: Fixture[] = raw.map((f) => ({
    id: f.id,
    homeTeamId: f.homeTeamId,
    awayTeamId: f.awayTeamId,
    kickoff: f.kickoff,
    dayLabel: dayLabelOf(f.kickoff),
    // כל משחק שיושב במסד הוא משחק עם שעה. "שעה תיקבע" היה מצב
    // של קובץ ידני שחסרה בו שורה.
    timeConfirmed: true,
  }));

  FIXTURES.splice(0, FIXTURES.length, ...next);
  rebuildOpponents();

  fixtureStatusById.clear();
  for (const f of raw) fixtureStatusById.set(f.id, (f.status ?? 'scheduled') as FixtureStatus);

  HAS_UNCONFIRMED_TIMES = FIXTURES.some((f) => !f.timeConfirmed);

  const gw = payload.gameweek;
  if (gw) {
    GAMEWEEK.id = gw.id;
    GAMEWEEK.number = gw.number;
    GAMEWEEK.label = gw.label || `מחזור ${gw.number}`;
    // ★ הדדליין מהשרת מנצח את החישוב המקומי. השרת הוא זה שאוכף
    //   אותו, ושני מספרים שונים במסך ובאכיפה הם משתמש שלוחץ
    //   "הגש" ומקבל דחייה בלי להבין למה.
    if (gw.lockAt) GAMEWEEK_DEADLINE = gw.lockAt;
    FIRST_KICKOFF = gw.firstKickoffAt || GAMEWEEK_DEADLINE;
  } else {
    GAMEWEEK_DEADLINE = FIXTURES.map((f) => f.kickoff).sort()[0] ?? GAMEWEEK_DEADLINE;
    FIRST_KICKOFF = GAMEWEEK_DEADLINE;
  }

  return true;
}
