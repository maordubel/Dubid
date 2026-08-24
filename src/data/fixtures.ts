/**
 * src/data/fixtures.ts — לוח משחקים, מחזור נוכחי.
 *
 * מקור: לוח המשחקים שסופק ידנית. כשיחובר API כדורגל אמיתי, הקובץ הזה
 * הופך למטמון (cache) שמתעדכן ממנו — לא צריך לגעת בשום קומפוננטה,
 * כל מי שצורך `FIXTURES`/`GAMEWEEK` ימשיך לעבוד באותה צורה.
 *
 * הערת נורמליזציה: הלוח שסופק כתב "הפועל קריית שמונה", אך קבוצת הליגה
 * הרשומה בסגלים היא "עירוני קריית שמונה" (T10) — זו אותה קבוצה, תוקן כאן.
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

export const GAMEWEEK = {
  id: 'gw-2',
  number: 2,
  label: 'מחזור 2',
  seasonLabel: 'ליגת העל 2026/27',
};

/**
 * ★ מחזור 2 — שבת, 29 באוגוסט 2026.
 *
 * שבעת המשחקים סופקו על ידי בעל המוצר ומופיעים כאן כלשונם.
 *
 * ⚠ **שעות הפתיחה טרם אושרו.**
 *
 * הברִיף אומר מפורשות "אל תמציא שעות פתיחה", ולכן `kickoff` מסומן
 * `timeConfirmed: false` וכולם נושאים את אותה שעת בסיס בטוחה.
 * המשמעות המעשית:
 *   · לוח המשחקים מציג "שעה תיקבע" ולא שעה שקרית.
 *   · הדדליין נגזר משעת הבסיס, שהיא **לפני** כל בעיטת פתיחה
 *     סבירה בליגה — כך שאי אפשר להגיש אחרי שהמשחק התחיל.
 * ברגע שהשעות מתפרסמות: לעדכן `kickoff` ולהעביר ל-`true`.
 */
const MATCHDAY = '2026-08-29';
/** שעת בסיס שמרנית — מוקדמת מכל פתיחה ריאלית בליגת העל. */
const TBD_TIME = 'T16:00:00+03:00';

export const FIXTURES: Fixture[] = [
  { id: 'gw2-1', homeTeamId: 'T8',  awayTeamId: 'T12', kickoff: MATCHDAY + TBD_TIME, dayLabel: 'שבת', timeConfirmed: false },
  { id: 'gw2-2', homeTeamId: 'T5',  awayTeamId: 'T7',  kickoff: MATCHDAY + TBD_TIME, dayLabel: 'שבת', timeConfirmed: false },
  { id: 'gw2-3', homeTeamId: 'T9',  awayTeamId: 'T6',  kickoff: MATCHDAY + TBD_TIME, dayLabel: 'שבת', timeConfirmed: false },
  { id: 'gw2-4', homeTeamId: 'T13', awayTeamId: 'T1',  kickoff: MATCHDAY + TBD_TIME, dayLabel: 'שבת', timeConfirmed: false },
  { id: 'gw2-5', homeTeamId: 'T3',  awayTeamId: 'T4',  kickoff: MATCHDAY + TBD_TIME, dayLabel: 'שבת', timeConfirmed: false },
  { id: 'gw2-6', homeTeamId: 'T14', awayTeamId: 'T2',  kickoff: MATCHDAY + TBD_TIME, dayLabel: 'שבת', timeConfirmed: false },
  { id: 'gw2-7', homeTeamId: 'T10', awayTeamId: 'T11', kickoff: MATCHDAY + TBD_TIME, dayLabel: 'שבת', timeConfirmed: false },
];

/** מפה: מזהה קבוצה → היריבה שלה במחזור הנוכחי (או null אם אין לה משחק). */
export const OPPONENT_BY_TEAM: Record<string, { opponentId: string; isHome: boolean; fixture: Fixture } | undefined> = (() => {
  const map: Record<string, { opponentId: string; isHome: boolean; fixture: Fixture }> = {};
  for (const f of FIXTURES) {
    map[f.homeTeamId] = { opponentId: f.awayTeamId, isHome: true, fixture: f };
    map[f.awayTeamId] = { opponentId: f.homeTeamId, isHome: false, fixture: f };
  }
  return map;
})();

export function fixtureLabel(f: Fixture): string {
  const home = TEAM_BY_ID.get(f.homeTeamId)?.nameHe ?? f.homeTeamId;
  const away = TEAM_BY_ID.get(f.awayTeamId)?.nameHe ?? f.awayTeamId;
  return `${home} – ${away}`;
}

export function kickoffTimeLabel(iso: string, confirmed = true): string {
  if (!confirmed) return 'שעה תיקבע';
  const d = new Date(iso);
  return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

/** האם יש ולו משחק אחד בלי שעה מאושרת. מוצג כאזהרה באדמין. */
export const HAS_UNCONFIRMED_TIMES = FIXTURES.some((f) => !f.timeConfirmed);

export function kickoffDateLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
}

/**
 * ★ הדדליין נגזר מהמשחקים ולא מוקלד בנפרד.
 *
 * נעילת ההרכבים היא בעיטת הפתיחה הראשונה במחזור. אילו זה היה שדה
 * נפרד, יום אחד מישהו היה מזיז משחק ושוכח לעדכן אותו — והמשחק היה
 * ממשיך לקבל הרכבים אחרי שהכדור כבר מתגלגל.
 *
 * זהו ערך תצוגה בלבד. האכיפה היא `game.gameweeks.lock_at` בשרת.
 */
export const GAMEWEEK_DEADLINE: string = FIXTURES
  .map((f) => f.kickoff)
  .sort()[0] ?? new Date().toISOString();

export const FIRST_KICKOFF = GAMEWEEK_DEADLINE;
