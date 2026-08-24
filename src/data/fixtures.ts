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
 * ★ מחזור 2 — הלוח הרשמי.
 *
 * חמישה משחקים בשבת 29/08, אחד בראשון 30/08, ואחד בשני 31/08.
 * כל השעות אושרו מול הלוח שסופק — `timeConfirmed: true`.
 *
 * ★ למה זה משנה לנעילה
 *
 * הדדליין נגזר מבעיטת הפתיחה **המוקדמת ביותר** (שבת 20:00), ולא
 * מהמאוחרת. אחרת מי שמחכה עד ראשון היה בוחר שחקן אחרי שכבר ראה
 * חמישה משחקים — יתרון מידע שהורס את התחרות.
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

/**
 * ★ אזור הזמן ננעל על ישראל, ולא נגזר מהמכשיר.
 *
 * באג שנתפס: `toLocaleTimeString('he-IL')` בלי `timeZone` משתמש
 * באזור הזמן של המכשיר. משחק ב-20:00 שעון ישראל הוצג כ-17:00
 * לכל מי שהמכשיר שלו ב-UTC — וגם בכל רינדור בצד שרת.
 *
 * הליגה משחקת בישראל. השעה שמוצגת היא שעת המשחק, נקודה — גם
 * למשתמש שיושב בניו יורק.
 */
const LEAGUE_TZ = 'Asia/Jerusalem';

export function kickoffTimeLabel(iso: string, confirmed = true): string {
  if (!confirmed) return 'שעה תיקבע';
  return new Date(iso).toLocaleTimeString('he-IL', {
    hour: '2-digit', minute: '2-digit', timeZone: LEAGUE_TZ,
  });
}

/** האם יש ולו משחק אחד בלי שעה מאושרת. מוצג כאזהרה באדמין. */
export const HAS_UNCONFIRMED_TIMES = FIXTURES.some((f) => !f.timeConfirmed);

export function kickoffDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('he-IL', {
    day: '2-digit', month: '2-digit', timeZone: LEAGUE_TZ,
  });
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
