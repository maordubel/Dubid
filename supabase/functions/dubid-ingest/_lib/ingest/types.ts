/**
 * ⚠ נוצר אוטומטית — אל תערכו כאן.
 *
 * הועתק מ-src/lib/ על ידי scripts/sync-edge-shared.mjs.
 * כל שינוי כאן יימחק בפריסה הבאה. ערכו את המקור.
 */
/**
 * src/lib/ingest/types.ts — החוזה הקנוני של הקליטה.
 *
 * ★ הכלל היחיד של הקובץ הזה: **שום שם שדה של ספק לא מופיע בו.**
 *
 * מתאם מחזיר `Snapshot`. `game.ingest_snapshot` במסד מקבל בדיוק
 * את המבנה הזה. להחליף ספק = לכתוב קובץ מתאם חדש, בלי לגעת
 * במסד, בלי לגעת במנוע הניקוד, ובלי לגעת בשום מסך.
 */

export type FixtureStatus =
  | 'scheduled' | 'live' | 'finished' | 'postponed' | 'abandoned';

export type Position = 'GK' | 'DEF' | 'MID' | 'FWD';

export interface TeamRef {
  /** המזהה אצל הספק. המסד קושר אותו פעם אחת ומאז זה חיפוש מפתח. */
  id: string;
  nameEn?: string | null;
  nameHe?: string | null;
}

export interface PlayerRef {
  id: string;
  nameEn?: string | null;
  nameHe?: string | null;
  shirt?: number | null;
  position?: Position | null;
}

export interface Fixture {
  providerId: string;
  home: TeamRef;
  away: TeamRef;
  /** ISO-8601. null = שעה לא פורסמה. לעולם לא ממציאים אחת. */
  kickoff: string | null;
  status: FixtureStatus;
  homeGoals?: number | null;
  awayGoals?: number | null;
}

/** ביצועי שחקן במשחק אחד — בדיוק השדות שמנוע הניקוד צורך. */
export interface PlayerStat {
  matchProviderId: string;
  team: TeamRef;
  player: PlayerRef;
  minutes: number;
  started: boolean;
  goals: number;
  assists: number;
  ownGoals: number;
  yellowCards: number;
  redCards: number;
  saves: number;
  penaltiesSaved: number;
  penaltiesMissed: number;
  /** ספיגות **בזמן שהיה על המגרש**. ראו derive.ts. */
  goalsConceded: number;
  /**
   * כל השאר. נשמר ב-`core.player_match_stats.extra` ואינו משפיע
   * על ניקוד — עד שיוחלט שכן, וזה יהיה שינוי חוק ולא מיגרציה.
   */
  extra?: Record<string, unknown>;
}

export interface Alert {
  kind:
    | 'var'                  // החלטת VAR — הספק לא אומר איזה שער בוטל
    | 'card_rescinded'       // כרטיס שבוטל — נקודות שצריך להחזיר
    | 'unknown_event'        // אירוע שהמתאם לא ידע למפות
    | 'source_disagreement'  // שני מקורות, שתי תוצאות
    | 'source_down'
    | 'fixture_not_final';
  severity: 'block' | 'warn';
  detail: Record<string, unknown>;
}

export interface RawBlob {
  kind: string;
  externalId?: string | null;
  payload: unknown;
}

export interface Snapshot {
  phase: 'fixtures' | 'live' | 'final' | 'sweep' | 'squads';
  gameweek: { number: number };
  fixtures: Fixture[];
  stats: PlayerStat[];
  alerts: Alert[];
  raw: RawBlob[];
}

/** מה שכל מתאם חייב לספק. */
export interface Provider {
  readonly name: string;
  /** מספר המחזור הנוכחי אצל הספק. */
  currentRound(): Promise<number>;
  /** לוח המשחקים של מחזור — בלי סטטיסטיקה. */
  round(n: number): Promise<{ fixtures: Fixture[]; raw: RawBlob[] }>;
  /** סטטיסטיקה אישית לכל משחק ברשימה. */
  stats(fixtures: Fixture[]): Promise<{
    stats: PlayerStat[];
    alerts: Alert[];
    raw: RawBlob[];
  }>;
}

export const emptySnapshot = (round: number, phase: Snapshot['phase']): Snapshot => ({
  phase,
  gameweek: { number: round },
  fixtures: [],
  stats: [],
  alerts: [],
  raw: [],
});
