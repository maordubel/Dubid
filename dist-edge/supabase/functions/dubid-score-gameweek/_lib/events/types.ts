/**
 * ⚠ נוצר אוטומטית — אל תערכו כאן.
 *
 * הועתק מ-src/lib/ על ידי scripts/sync-edge-shared.mjs.
 * כל שינוי כאן יימחק בפריסה הבאה. ערכו את המקור.
 */
/**
 * events/types.ts — אוצר המילים הקנוני של אירועי משחק.
 *
 * ★ הרעיון המרכזי
 *
 * לכל משחק שנפתח יש **לוג אחד** של אירועים גולמיים. הלוג לא יודע מה
 * זה "ניקוד", לא יודע מה זה "דוביד 5", ולא יודע מי הקפטן של אף אחד.
 * הוא יודע רק דבר אחד: *מה קרה במגרש, ומתי*.
 *
 *     שער בדקה 67 של שחקן X מקבוצה Y — זו עובדה.
 *     "השער הזה שווה 5 נקודות" — זו פרשנות.
 *
 * העובדות נשמרות פעם אחת. הפרשנות נעשית בכל מצב משחק בנפרד.
 * זה מה שמאפשר לדוביד 5 ולדוביד 11 לקרוא את אותו מחזור ולהגיע לשתי
 * תשובות שונות — ושתיהן נכונות — בלי שני מקורות נתונים ובלי שני מנועים.
 *
 *     ספק כדורגל → מתאם → ‎[ לוג האירועים ]‎ → הקרנה → מצב משחק → ניקוד
 *                              ↑                          ↓
 *                        מקור אמת אחד            כמה תשובות במקביל
 *
 * ★ הלוג הוא append-only
 *
 * אירוע שנרשם לא נמחק ולא משתנה — לעולם. תיקון הוא אירוע חדש שמבטל
 * או מחליף אירוע קודם (ראו `EventKind.Correction`). זה מה שהופך את
 * הניקוד לניתן לביקורת: אפשר לשחזר בדיוק מה ידענו בכל רגע נתון,
 * ולהסביר למשתמש למה הציון שלו השתנה שעה אחרי המשחק.
 */

/** אירועים אישיים — מתייחסים לשחקן מסוים. */
export const EventKind = {
  /* --- השתתפות --------------------------------------------------- */
  LineupStart: 'lineup_start',
  SubOn: 'sub_on',
  SubOff: 'sub_off',

  /* --- התקפה ------------------------------------------------------ */
  Goal: 'goal',
  Assist: 'assist',
  OwnGoal: 'own_goal',
  PenaltyScored: 'penalty_scored',
  PenaltyMissed: 'penalty_missed',
  Shot: 'shot',
  ShotOnTarget: 'shot_on_target',
  KeyPass: 'key_pass',
  Dribble: 'dribble',

  /* --- הגנה ------------------------------------------------------- */
  Save: 'save',
  PenaltySaved: 'penalty_saved',
  Tackle: 'tackle',
  Interception: 'interception',
  Clearance: 'clearance',
  Recovery: 'recovery',

  /* --- משמעת ------------------------------------------------------ */
  YellowCard: 'yellow_card',
  SecondYellow: 'second_yellow',
  RedCard: 'red_card',
  PenaltyConceded: 'penalty_conceded',

  /* --- אירועי משחק (קבוצתיים, בלי שחקן) --------------------------- */
  KickOff: 'kick_off',
  HalfTime: 'half_time',
  FullTime: 'full_time',
  MatchPostponed: 'match_postponed',
  MatchAbandoned: 'match_abandoned',

  /* --- מטא ------------------------------------------------------- */
  /** מבטל או מחליף אירוע קודם. לעולם לא מוחקים שורה מהלוג. */
  Correction: 'correction',
} as const;
export type EventKindValue = (typeof EventKind)[keyof typeof EventKind];

/**
 * שלב המשחק. חשוב לניקוד "שער מאוחר" ולחישוב דקות מדויק —
 * דקה 45 במחצית ראשונה ודקה 45 בשנייה הן לא אותו דבר.
 */
export type MatchPhase = '1H' | '2H' | 'ET1' | 'ET2' | 'PENS';

/**
 * מקור האירוע. לא קישוט: כלל ניקוד רשאי לדרוש אמינות מינימלית.
 * הברִיף אומר במפורש "אל תפעיל אירוע רק כי ה-API מספק אותו" —
 * השדה הזה הוא איך אוכפים את זה בקוד ולא בכוונות טובות.
 */
export type EventSource =
  | 'provider'   // הגיע מספק הדאטה הרשמי
  | 'admin'      // הוזן ידנית בלוח הניהול
  | 'correction' // תיקון של אירוע קודם
  | 'derived';   // חושב מאירועים אחרים (למשל קלין-שיט)

/** רמת ודאות. אירוע לא ודאי לא אמור להזיז ניקוד רשמי. */
export type EventConfidence = 'verified' | 'provisional';

/**
 * אירוע בודד בלוג.
 *
 * `seq` הוא הסדר הקנוני. הוא נקבע ברגע ההוספה לפי מונה עולה, ולא
 * לפי שעון — כך ששני שרתים שמעבדים את אותם אירועים מגיעים לאותו סדר.
 * `minute` הוא זמן המשחק והוא לתצוגה ולכללים (למשל "שער מאוחר"),
 * אבל *לא* לסדר: שני אירועים באותה דקה נשארים בסדר שבו נרשמו.
 */
export interface MatchEvent {
  seq: number;
  fixtureId: string;
  gameweekId: string;
  kind: EventKindValue;
  phase: MatchPhase;
  /** דקת משחק (1–90+). לאירועי מטא אפשר 0. */
  minute: number;
  /** תוספת זמן בתוך המחצית, אם רלוונטי. */
  stoppage?: number;
  teamId: string;
  playerId?: string;
  /** מבשל לשער, שחקן שיוצא בחילוף, השחקן שהורד בעבירה. */
  relatedPlayerId?: string;
  source: EventSource;
  confidence: EventConfidence;
  /** נתונים ספציפיים לסוג האירוע. אין כאן שדות של ספק חיצוני. */
  payload?: Readonly<Record<string, unknown>>;
  /** מתי נרשם אצלנו. לתיעוד וביקורת בלבד — אף פעם לא לסדר או לניקוד. */
  recordedAt: string;
  /** לאירוע Correction: ה-seq של האירוע המטופל. */
  targetSeq?: number;
  /** לאירוע Correction: מה עושים איתו. */
  correction?: 'void' | 'replace';
  /** לאירוע Correction: הסבר לאדם. מופיע ביומן הביקורת. */
  reason?: string;
}

/** לוג של משחק אחד. אי-שינוי הוא לא מוסכמה — הטיפוסים אוכפים אותו. */
export interface MatchLog {
  fixtureId: string;
  gameweekId: string;
  homeTeamId: string;
  awayTeamId: string;
  /** מצב המשחק. משפיע על מה מותר לפרסם כסופי. */
  status: 'scheduled' | 'live' | 'finished' | 'postponed' | 'abandoned';
  events: readonly MatchEvent[];
  /** ה-seq הבא שיוקצה. */
  nextSeq: number;
}

/** אירוע חדש לפני שהלוג הקצה לו seq ו-recordedAt. */
export type DraftEvent = Omit<MatchEvent, 'seq' | 'recordedAt' | 'fixtureId' | 'gameweekId'> &
  Partial<Pick<MatchEvent, 'recordedAt'>>;

/** אירועים שדורשים שחקן. הוספה בלי playerId תיפסל. */
export const PLAYER_EVENTS: ReadonlySet<string> = new Set([
  EventKind.LineupStart, EventKind.SubOn, EventKind.SubOff,
  EventKind.Goal, EventKind.Assist, EventKind.OwnGoal,
  EventKind.PenaltyScored, EventKind.PenaltyMissed,
  EventKind.Shot, EventKind.ShotOnTarget, EventKind.KeyPass, EventKind.Dribble,
  EventKind.Save, EventKind.PenaltySaved, EventKind.Tackle,
  EventKind.Interception, EventKind.Clearance, EventKind.Recovery,
  EventKind.YellowCard, EventKind.SecondYellow, EventKind.RedCard,
  EventKind.PenaltyConceded,
]);

/** אירועים שמזיזים את התוצאה על הלוח. */
export const SCORING_EVENTS: ReadonlySet<string> = new Set([
  EventKind.Goal, EventKind.OwnGoal, EventKind.PenaltyScored,
]);
