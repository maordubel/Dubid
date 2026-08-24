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
}

export const GAMEWEEK = {
  id: 'gw-1',
  number: 1,
  label: 'מחזור 1',
  seasonLabel: 'ליגת העל 2026/27',
};

export const FIXTURES: Fixture[] = [
  { id: 'gw1-1', homeTeamId: 'T12', awayTeamId: 'T10', kickoff: '2026-08-22T20:00:00+03:00', dayLabel: 'שבת' },
  { id: 'gw1-2', homeTeamId: 'T11', awayTeamId: 'T14', kickoff: '2026-08-22T20:00:00+03:00', dayLabel: 'שבת' },
  { id: 'gw1-3', homeTeamId: 'T4', awayTeamId: 'T13', kickoff: '2026-08-22T20:30:00+03:00', dayLabel: 'שבת' },
  { id: 'gw1-4', homeTeamId: 'T2', awayTeamId: 'T3', kickoff: '2026-08-23T20:15:00+03:00', dayLabel: 'ראשון' },
  { id: 'gw1-5', homeTeamId: 'T7', awayTeamId: 'T8', kickoff: '2026-08-24T20:00:00+03:00', dayLabel: 'שני' },
  { id: 'gw1-6', homeTeamId: 'T1', awayTeamId: 'T9', kickoff: '2026-09-02T20:00:00+03:00', dayLabel: 'רביעי' },
  { id: 'gw1-7', homeTeamId: 'T6', awayTeamId: 'T5', kickoff: '2026-09-03T20:30:00+03:00', dayLabel: 'חמישי' },
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

export function kickoffTimeLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

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
