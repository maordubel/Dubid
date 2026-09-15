/**
 * ⚠ נוצר אוטומטית — אל תערכו כאן.
 *
 * נבנה על ידי scripts/bundle-edge.mjs מתוך:
 *   src/lib/scoring/types.ts
 *   src/lib/scoring/rules.ts
 *   src/lib/scoring/validate.ts
 *   src/lib/scoring/engine.ts
 *   src/lib/scoring/ranking.ts
 *   src/lib/ruleOverrides.ts
 *   supabase/functions/dubid-score-gameweek/_src/index.ts
 *
 * ★ קובץ אחד בכוונה. פריסה דרך ה-Dashboard היא הדבקה אחת:
 *   Edge Functions → dubid-score-gameweek → index.ts → להחליף הכל.
 *   עורך ה-Dashboard לא יוצר תיקיות, וכל קובץ נוסף הוא עוד
 *   נקודת כשל שקטה. כבר היו שלוש.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/* ── src/lib/scoring/types.ts ──────────────────────── */

/**
 * scoring/types.ts — הטיפוסים של מנוע הניקוד.
 *
 * המנוע חי גם בדפדפן (תצוגה מקדימה חיה של הניקוד) וגם ב-Supabase Edge
 * Function (החישוב הרשמי). אותו קוד בדיוק בשני המקומות — כך אי אפשר
 * שהמספר שהמשתמש רואה בזמן אמת יהיה שונה מהמספר שנשמר ב-DB.
 */

export type Position = 'GK' | 'DEF' | 'MID' | 'FWD';
export type MatchResult = 'W' | 'D' | 'L';

/**
 * עיגול לשתי ספרות.
 *
 * ★ היה מוגדר פעמיים — ב-`engine.ts` וב-`ranking.ts`. שתי
 *   הגדרות זהות אינן בעיה עד שמאחדים את הקבצים לקובץ אחד
 *   לפריסה, ואז הן שתי הצהרות `const` באותו סקופ והמודול לא
 *   נטען. נתפס על ידי בודק ההתנגשויות ב-bundle-edge.mjs.
 */
export const round2 = (n: number) => Math.round(n * 100) / 100;

/** קודי סיבה. ה-UI מתרגם אותם — אין מחרוזות תצוגה במנוע. */
export const Reason = {
  Minutes: 'minutes',
  Goal: 'goal',
  Assist: 'assist',
  CleanSheet: 'clean_sheet',
  Saves: 'saves',
  PenaltySaved: 'penalty_saved',
  PenaltyMissed: 'penalty_missed',
  GoalsConceded: 'goals_conceded',
  OwnGoal: 'own_goal',
  Yellow: 'yellow_card',
  Red: 'red_card',
  ResultBonus: 'result_bonus',
  VirtualGoal: 'virtual_goal',
  /** בונוס בחירה נדירה שהצליחה. מחושב ב-ranking.ts, לא ב-engine.ts. */
  Differential: 'differential',
  CaptainMultiplier: 'captain_multiplier',
  CaptainImmunity: 'captain_immunity',
  CaptainTransferred: 'captain_transferred',
} as const;
export type ReasonCode = (typeof Reason)[keyof typeof Reason];

/** ביצועי שחקן במחזור (מצטבר על פני כל משחקיו במחזור). */
export interface PlayerPerformance {
  playerId: string;
  teamId: string;
  position: Position;
  minutes: number;
  goals: number;
  assists: number;
  ownGoals: number;
  yellowCards: number;
  redCards: number;
  saves: number;
  penaltiesSaved: number;
  penaltiesMissed: number;
  goalsConceded: number;
  cleanSheet: boolean;
  played: boolean;
}

/** תוצאת הקבוצה האמיתית במחזור. */
export interface TeamOutcome {
  teamId: string;
  result: MatchResult;
  goalsFor: number;
  goalsAgainst: number;
}

export interface LineupSlot {
  slotNo: number;
  playerId: string;
  /** snapshot מרגע ההגשה — הסגל משתנה, ההרכב לא. */
  teamId: string;
  position: Position;
  /**
   * ★ שווי השחקן ברגע ההגשה, קפוא.
   *
   * מחירים משתנים במהלך העונה. בלי ההקפאה, הרכב מלפני חודש
   * "מתייקר" רטרואקטיבית ופתאום נראה כאילו חרג מהתקציב —
   * למרות שבזמן אמת הוא היה חוקי לגמרי.
   *
   * אופציונלי כי טיוטה עוד לא הגישה כלום. מתמלא ב-`saveEntry`.
   */
  price?: number;
  isCaptain?: boolean;
  isVice?: boolean;
  isBench?: boolean;
}

export interface Lineup {
  lineupId: string;
  userId: string;
  gameweekId: string;
  formation: string;
  slots: LineupSlot[];
}

export interface ScoreLine {
  reason: ReasonCode;
  points: number;
  count?: number;
  playerId?: string;
  teamId?: string;
  meta?: Record<string, unknown>;
}

export interface PlayerScore {
  playerId: string;
  teamId: string;
  position: Position;
  isCaptain: boolean;
  lines: ScoreLine[];
  subtotal: number;
}

export interface LineupScore {
  lineupId: string;
  gameweekId: string;
  rulesetVersion: number;
  players: PlayerScore[];
  bonusLines: ScoreLine[];
  /** סכימת פעולות אישיות בלבד */
  personalPoints: number;
  /** בונוס תוצאה קבוצתית */
  resultPoints: number;
  /** התוספת שנבעה מהקפטן הדובידי */
  captainPoints: number;
  /** שערי הרכב וירטואליים */
  virtualPoints: number;
  /**
   * בונוס דיפרנציאל. אופציונלי כי הוא נוסף בשלב הדירוג, אחרי שידועות
   * כל ההגשות — `scoreLineup` לבדו לא יכול לדעת אחוזי בחירה.
   */
  differentialPoints?: number;
  totalPoints: number;
}

/** מזהי שגיאות ולידציה. ה-UI מתרגם. */
export const ErrorCode = {
  LineupSize: 'lineup_size',
  DuplicateTeam: 'duplicate_team',
  DuplicatePlayer: 'duplicate_player',
  FormationInvalid: 'formation_invalid',
  FormationMismatch: 'formation_mismatch',
  CaptainMissing: 'captain_missing',
  CaptainDuplicate: 'captain_duplicate',
  NoGoalkeeper: 'no_goalkeeper',
  NotEnoughTeams: 'not_enough_teams',
} as const;
export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ValidationIssue {
  code: ErrorCodeValue;
  params: Record<string, string | number>;
}

/* ── src/lib/scoring/rules.ts ──────────────────────── */

/**
 * scoring/rules.ts — חוקי הניקוד כדאטה.
 *
 * ליגה חדשה או שינוי איזון = שורה חדשה בטבלת scoring_rulesets.
 * לא commit, לא deploy, ולא `if (league === 'IL')` בשום מקום.
 */

export interface PersonalRules {
  goal: Record<Position, number>;
  assist: number;
  cleanSheet: Record<Position, number>;
  cleanSheetMinMinutes: number;
  minutesPlayed: number;
  minutes60Plus: number;
  yellowCard: number;
  redCard: number;
  ownGoal: number;
  savesPer: number;
  savesPoints: number;
  penaltySaved: number;
  penaltyMissed: number;
  goalsConcededPer: number;
  goalsConceded: Record<Position, number>;
}

export interface ResultBonusRules {
  W: number;
  D: number;
  L: number;
  /** 0 = גם מי שלא שיחק מקבל. 1+ = רק מי ששיחק לפחות כך דקות. */
  requireMinutes: number;
}

export interface VirtualGoalRules {
  goalsPerVirtual: number;
  points: number;
  /**
   * 'pooled'   – כל שערי 11 הקבוצות לקופה אחת, חלוקה אחת. שאריות נשמרות.
   * 'perTeam'  – כל קבוצה לחוד, שאריות נזרקות.
   * ההבדל הוא ~35 נק׳ מול ~12 נק׳ למחזור ממוצע. זו החלטת איזון מוצר.
   */
  aggregation: 'pooled' | 'perTeam';
}

/**
 * ★ הקפטן הדובידי
 *
 * שלושה מנגנונים, וכל אחד מהם קיים כדי לפתור בעיה אמיתית:
 *
 *  1. multiplier ×3 — הימור גדול. פי 2 זה סטנדרט משעמם; פי 3 הופך את
 *     בחירת הקפטן להחלטה המשמעותית ביותר במחזור.
 *
 *  2. חסינות כרטיסים — הכפלה פי 3 של עונש היא רצחנית. לכן הקפטן חסין
 *     לכרטיסים צהובים כשהוא "הרוויח" את זה: שיחק לפחות X דקות
 *     והקבוצה שלו לא הפסידה. כרטיס אדום אף פעם לא נסלח — אחרת
 *     המשתמשים ילמדו לבחור קפטן אגרסיבי ולא קפטן טוב.
 *
 *  3. העברה לסגן — קפטן שלא ירד למגרש הורס מחזור שלם בגלל מידע
 *     שלמשתמש לא היה בזמן הנעילה. במקרה כזה הכפולה עוברת לסגן.
 *     בלי המנגנון הזה, פי 3 הוא הימור לא הוגן ולא כיף.
 *
 *  applyToNegative=false: אם הציון האישי של הקפטן שלילי, לא מכפילים.
 *  ההימור מגדיל רווח, לא הפסד.
 */
export interface DubidCaptainRules {
  multiplier: number;
  /**
   * על מה חל המכפיל:
   *  'personal'        – רק פעולות אישיות (שערים, בישולים, קלין-שיט).
   *  'personalAndResult' – גם בונוס התוצאה הקבוצתית (ברירת מחדל).
   * ברירת המחדל מחזקת את ה-DNA של המשחק: לא מספיק לבחור שחקן טוב,
   * צריך לבחור שחקן טוב מקבוצה שתנצח.
   */
  appliesTo: 'personal' | 'personalAndResult';
  applyToNegative: boolean;
  immunity: {
    yellowCards: boolean;
    redCards: boolean;
    minMinutes: number;
    /** תוצאות שבהן החסינות חלה */
    requireResultIn: Array<'W' | 'D' | 'L'>;
  };
  transferToViceIfMinutesBelow: number;
}

export interface ConstraintRules {
  lineupSize: number;
  maxPlayersPerTeam: number;
  benchSize: number;
  formationAllowed: string[];
  requireCaptain: boolean;
}

export interface RuleSet {
  version: number;
  leagueCode: string | null;
  personal: PersonalRules;
  resultBonus: ResultBonusRules;
  virtualGoal: VirtualGoalRules;
  captain: DubidCaptainRules;
  constraints: ConstraintRules;
}

/* -------------------------------------------------------------------
   ערכי הניקוד לפי המפרט שהוגדר למוצר:
     שער   — שוער/מגן 6 · קשר 5 · חלוץ 4
     בישול — 3
     קלין-שיט — 4 (אחיד, דורש 60 דקות)
     כרטיס — צהוב ‎-1‎ · אדום ‎-3‎
   ------------------------------------------------------------------- */
const GOAL: Record<Position, number> = { GK: 6, DEF: 6, MID: 5, FWD: 4 };
const CLEAN: Record<Position, number> = { GK: 4, DEF: 4, MID: 4, FWD: 4 };
const CONCEDED: Record<Position, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };

/** ליגת העל הישראלית — ברירת המחדל של המוצר. */
export const IL_PREMIER: RuleSet = {
  version: 1,
  leagueCode: 'IL_PREMIER',
  personal: {
    goal: GOAL,
    assist: 3,
    cleanSheet: CLEAN,
    cleanSheetMinMinutes: 60,

    // ★ אין נקודות על עצם ההשתתפות — לפי המפרט.
    //   שימו לב לתוצאה: מגן ששיחק 90 דקות בלי קלין-שיט ובלי שער מקבל 0.
    //   אם תרצו "נקודות הופעה" (סטנדרט מקובל בפנטזי, מרכך את המזל):
    //   minutesPlayed: 1, minutes60Plus: 2  — שינוי של שורה אחת.
    minutesPlayed: 0,
    minutes60Plus: 0,

    yellowCard: -1,
    redCard: -3,

    // תוספת מעבר למפרט: שער עצמי. אפשר לאפס אם לא רוצים.
    ownGoal: -2,

    // מנוטרלים כברירת מחדל כדי להיצמד למפרט. השדות קיימים —
    // הדלקה = שינוי ערך, לא שינוי קוד.
    savesPer: 3,
    savesPoints: 0,
    penaltySaved: 0,
    penaltyMissed: 0,
    goalsConcededPer: 2,
    goalsConceded: CONCEDED,
  },
  resultBonus: { W: 4, D: 1, L: 0, requireMinutes: 0 },
  // סכימת שערי כל 11 הקבוצות לקופה אחת; כל 2 שערים = שער וירטואלי של 5 נק׳.
  virtualGoal: { goalsPerVirtual: 2, points: 5, aggregation: 'pooled' },
  captain: {
    multiplier: 3,
    appliesTo: 'personalAndResult',
    applyToNegative: false,
    immunity: {
      yellowCards: true,
      redCards: false,
      minMinutes: 60,
      requireResultIn: ['W', 'D'],
    },
    transferToViceIfMinutesBelow: 1,
  },
  constraints: {
    lineupSize: 11,
    maxPlayersPerTeam: 1,
    benchSize: 0,
    formationAllowed: ['4-3-3', '4-4-2', '3-5-2', '4-2-3-1', '5-3-2', '3-4-3'],
    requireCaptain: true,
  },
};

/**
 * דוגמה להרחבה לליגה זרה — 15 שחקנים, עד 2 מאותה קבוצה, קפטן ×2.
 * שימו לב: אין כאן שום קוד חדש. רק ערכים.
 */
export const EN_PREMIER: RuleSet = {
  ...IL_PREMIER,
  leagueCode: 'EN_PL',
  virtualGoal: { goalsPerVirtual: 3, points: 6, aggregation: 'perTeam' },
  captain: { ...IL_PREMIER.captain, multiplier: 2 },
  constraints: {
    ...IL_PREMIER.constraints,
    lineupSize: 15,
    maxPlayersPerTeam: 2,
    benchSize: 4,
  },
};

/**
 * דוביד 5 על 5 — הפורמט המהיר מהמשחק המקורי, חי עכשיו בתוך אותו מנוע.
 * 5 שחקנים (שוער + 4 שחקני שדה), תקציב 15 מיליון יורו, שחקן אחד מכל
 * קבוצה, שני מערכים בדיוק כמו במקור: 2-1-1 ו-1-2-1 (הגנה-קישור-התקפה,
 * שוער תמיד בנפרד). אותו `scoreLineup`, אותו `validateLineup` —
 * הפורמט הקטן לא צריך קוד חדש, רק ערכים אחרים.
 */
export const DUBID_5X5: RuleSet = {
  ...IL_PREMIER,
  version: 1,
  constraints: {
    ...IL_PREMIER.constraints,
    lineupSize: 5,
    maxPlayersPerTeam: 1,
    formationAllowed: ['2-1-1', '1-2-1'],
  },
};

/** תקציב 5 על 5, במיליוני יורו — אילוץ UI, לא חלק מהמנוע הגנרי. */
export const DUBID_5X5_BUDGET = 15;


export function ruleSetFromJson(
  data: Partial<RuleSet> & Record<string, unknown>,
  base: RuleSet = IL_PREMIER,
): RuleSet {
  return {
    ...base,
    ...data,
    personal: { ...base.personal, ...(data.personal ?? {}) },
    resultBonus: { ...base.resultBonus, ...(data.resultBonus ?? {}) },
    virtualGoal: { ...base.virtualGoal, ...(data.virtualGoal ?? {}) },
    captain: {
      ...base.captain,
      ...(data.captain ?? {}),
      immunity: { ...base.captain.immunity, ...(data.captain?.immunity ?? {}) },
    },
    constraints: { ...base.constraints, ...(data.constraints ?? {}) },
  } as RuleSet;
}

/* =================================================================== */
/* התאמת החוקים לכמות הקבוצות שבפועל יש בליגה                          */
/* =================================================================== */

/**
 * ★ אריתמטיקה שאי אפשר לעקוף:
 *   עם `maxPlayersPerTeam = 1`, מספר השחקנים בהרכב לא יכול לעלות על
 *   מספר הקבוצות בליגה. 11 שחקנים דורשים 11 קבוצות שונות.
 *
 * כשהדאטה חלקי (למשל 6 קבוצות מתוך 14), יש שתי אפשרויות גרועות
 * ואחת טובה:
 *   ✗ להגדיל את maxPlayersPerTeam — שובר את חוק הליבה של המשחק
 *   ✗ להשאיר 11 ולתת למשתמש להיתקע במסך חצי-ריק
 *   ✓ להריץ מצב הדגמה עם הרכב מוקטן, ולומר את זה במפורש
 *
 * הפונקציה מחזירה את החוקים המותאמים + דגל שה-UI חייב להציג.
 */
export interface ResolvedRules {
  rules: RuleSet;
  isDemo: boolean;
  teamsAvailable: number;
  teamsRequired: number;
  missingTeams: number;
}

/** מערך מתאים לגודל הרכב נתון (כולל שוער). */
export function formationForSize(size: number): string {
  const table: Record<number, string> = {
    5: '2-1-1', 6: '2-2-1', 7: '3-2-1', 8: '3-3-1',
    9: '3-3-2', 10: '4-3-2', 11: '4-3-3',
  };
  return table[size] ?? '4-3-3';
}

export function resolveRules(teamsAvailable: number, base: RuleSet = IL_PREMIER): ResolvedRules {
  const required = base.constraints.lineupSize * base.constraints.maxPlayersPerTeam;
  if (teamsAvailable >= required) {
    return { rules: base, isDemo: false, teamsAvailable, teamsRequired: required, missingTeams: 0 };
  }

  const size = Math.max(5, Math.floor(teamsAvailable / base.constraints.maxPlayersPerTeam));
  return {
    rules: {
      ...base,
      constraints: {
        ...base.constraints,
        lineupSize: size,
        formationAllowed: [formationForSize(size)],
      },
    },
    isDemo: true,
    teamsAvailable,
    teamsRequired: required,
    missingTeams: required - teamsAvailable,
  };
}

/* ── src/lib/scoring/validate.ts ──────────────────────── */

/**
 * scoring/validate.ts — ולידציית הרכב.
 *
 * ★ "שחקן אחד מכל קבוצה" נאכף בשלוש שכבות, ואף אחת מהן לא סומכת על השנייה:
 *     1. UI  — teamsUsed() נועל קבוצות תפוסות במסך הבחירה
 *     2. כאן — לפני כל כתיבה, עם קודי שגיאה מתורגמים
 *     3. DB  — UNIQUE (lineup_id, team_id)
 */

export const MESSAGES: Record<string, { he: string; en: string }> = {
  [ErrorCode.LineupSize]: {
    he: 'ההרכב חייב לכלול בדיוק {expected} שחקנים (יש {actual}).',
    en: 'Lineup must contain exactly {expected} players (got {actual}).',
  },
  [ErrorCode.DuplicateTeam]: {
    he: 'מותר עד {max} שחקנים מכל קבוצה. יש חריגה ב: {teams}.',
    en: 'At most {max} player(s) per team. Violating: {teams}.',
  },
  [ErrorCode.DuplicatePlayer]: {
    he: 'אותו שחקן נבחר יותר מפעם אחת.',
    en: 'The same player was selected more than once.',
  },
  [ErrorCode.FormationInvalid]: {
    he: 'המערך {formation} אינו נתמך.',
    en: 'Formation {formation} is not supported.',
  },
  [ErrorCode.FormationMismatch]: {
    he: 'חלוקת העמדות אינה תואמת ל־{formation}.',
    en: 'Positions do not match formation {formation}.',
  },
  [ErrorCode.CaptainMissing]: { he: 'יש לבחור קפטן.', en: 'A captain must be selected.' },
  [ErrorCode.CaptainDuplicate]: {
    he: 'אפשר לבחור קפטן אחד בלבד.',
    en: 'Only one captain may be selected.',
  },
  [ErrorCode.NoGoalkeeper]: {
    he: 'ההרכב חייב לכלול שוער.',
    en: 'Lineup must include a goalkeeper.',
  },
  [ErrorCode.NotEnoughTeams]: {
    he: 'צריך {required} קבוצות כדי לבנות הרכב של {size} שחקנים (יש {available}). חסרות {missing}.',
    en: 'Need {required} teams for a {size}-player lineup (have {available}). Missing {missing}.',
  },
};

/**
 * ★ הבדיקה שחוסמת מראש: אי אפשר להרכיב 11 שחקנים מ-11 קבוצות שונות
 * כשבליגה יש פחות מ-11 קבוצות. זו אריתמטיקה, לא העדפה.
 */
export function checkLeagueCapacity(
  teamsAvailable: number,
  rules: RuleSet,
): ValidationIssue | null {
  const required = rules.constraints.lineupSize * rules.constraints.maxPlayersPerTeam;
  if (teamsAvailable >= required) return null;
  return {
    code: ErrorCode.NotEnoughTeams,
    params: {
      required,
      size: rules.constraints.lineupSize,
      available: teamsAvailable,
      missing: required - teamsAvailable,
    },
  };
}

export function formatIssue(issue: ValidationIssue, locale: 'he' | 'en' = 'he'): string {
  const tpl = MESSAGES[issue.code]?.[locale] ?? issue.code;
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String(issue.params[k] ?? ''));
}

export class LineupInvalidError extends Error {
  issues: ValidationIssue[];
  constructor(issues: ValidationIssue[], locale: 'he' | 'en' = 'he') {
    super(issues.map((i) => formatIssue(i, locale)).join(' | '));
    this.name = 'LineupInvalidError';
    this.issues = issues;
  }
}

export function parseFormation(formation: string): Record<Position, number> {
  const parts = formation.split('-').map(Number);
  if (parts.some(Number.isNaN)) throw new Error(`bad formation: ${formation}`);
  let def: number, mid: number, fwd: number;
  if (parts.length === 3) [def, mid, fwd] = parts;
  else if (parts.length === 4) {
    const [d, m1, m2, f] = parts;
    def = d; mid = m1 + m2; fwd = f;
  } else throw new Error(`bad formation: ${formation}`);
  return { GK: 1, DEF: def, MID: mid, FWD: fwd };
}

export function starters(lineup: Lineup) {
  return lineup.slots.filter((s) => !s.isBench);
}

/**
 * משבצות פותחות שכבר אוישו.
 * ההפרדה חשובה: מבנה המערך נבדק על כל המשבצות (הן נוצרו מהמערך),
 * אבל גודל ההרכב, כפילויות והקפטן נבדקים רק על מה שבאמת נבחר —
 * אחרת הרכב ריק היה "עובר" את בדיקת הגודל, ו-11 משבצות ריקות היו
 * נספרות כ-11 שחקנים מאותה "קבוצה" ריקה.
 */
export function filledStarters(lineup: Lineup) {
  return starters(lineup).filter((s) => s.playerId && s.teamId);
}

/** מחזיר רשימת בעיות. ריקה = ההרכב תקין. */
export function validateLineup(lineup: Lineup, rules: RuleSet): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const structure = starters(lineup);
  const xi = filledStarters(lineup);
  const c = rules.constraints;

  if (xi.length !== c.lineupSize) {
    issues.push({
      code: ErrorCode.LineupSize,
      params: { expected: c.lineupSize, actual: xi.length },
    });
  }

  // ★ האילוץ המרכזי
  const perTeam = new Map<string, number>();
  for (const s of xi) perTeam.set(s.teamId, (perTeam.get(s.teamId) ?? 0) + 1);
  const over = [...perTeam.entries()]
    .filter(([, n]) => n > c.maxPlayersPerTeam)
    .map(([t]) => t);
  if (over.length) {
    issues.push({
      code: ErrorCode.DuplicateTeam,
      params: { max: c.maxPlayersPerTeam, teams: over.join(', ') },
    });
  }

  const perPlayer = new Set<string>();
  for (const s of xi) {
    if (perPlayer.has(s.playerId)) {
      issues.push({ code: ErrorCode.DuplicatePlayer, params: {} });
      break;
    }
    perPlayer.add(s.playerId);
  }

  if (!c.formationAllowed.includes(lineup.formation)) {
    issues.push({ code: ErrorCode.FormationInvalid, params: { formation: lineup.formation } });
  } else {
    // מבנה המערך נבדק על המשבצות, לא על מה שאויש
    const want = parseFormation(lineup.formation);
    const got: Record<string, number> = {};
    for (const s of structure) got[s.position] = (got[s.position] ?? 0) + 1;
    const mismatch = (Object.keys(want) as Position[]).some((p) => (got[p] ?? 0) !== want[p]);
    if (mismatch) {
      issues.push({ code: ErrorCode.FormationMismatch, params: { formation: lineup.formation } });
    }
  }

  if (!structure.some((s) => s.position === 'GK')) {
    issues.push({ code: ErrorCode.NoGoalkeeper, params: {} });
  }

  const captains = xi.filter((s) => s.isCaptain);
  if (c.requireCaptain && captains.length === 0) {
    issues.push({ code: ErrorCode.CaptainMissing, params: {} });
  }
  if (captains.length > 1) {
    issues.push({ code: ErrorCode.CaptainDuplicate, params: {} });
  }

  return issues;
}

export function assertValidLineup(lineup: Lineup, rules: RuleSet, locale: 'he' | 'en' = 'he'): void {
  const issues = validateLineup(lineup, rules);
  if (issues.length) throw new LineupInvalidError(issues, locale);
}

/* ------------------------------------------------------------------ */
/* עזרים ל-UI — זה מה שמונע מהמשתמש להיתקל בשגיאה מלכתחילה             */
/* ------------------------------------------------------------------ */

/** כמה שחקנים כבר נבחרו מכל קבוצה. */
export function teamsUsed(lineup: Lineup): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of filledStarters(lineup)) m.set(s.teamId, (m.get(s.teamId) ?? 0) + 1);
  return m;
}

/** האם מותר עדיין לבחור שחקן מהקבוצה הזו. */
export function isTeamAvailable(lineup: Lineup, teamId: string, rules: RuleSet): boolean {
  return (teamsUsed(lineup).get(teamId) ?? 0) < rules.constraints.maxPlayersPerTeam;
}

/** מפת כיסוי לתצוגה: אילו קבוצות אוישו ואילו עוד פנויות. */
export interface TeamCoverage {
  teamId: string;
  used: number;
  max: number;
  filled: boolean;
}

export function teamCoverage(
  lineup: Lineup,
  allTeamIds: string[],
  rules: RuleSet,
): TeamCoverage[] {
  const used = teamsUsed(lineup);
  const max = rules.constraints.maxPlayersPerTeam;
  return allTeamIds.map((teamId) => {
    const n = used.get(teamId) ?? 0;
    return { teamId, used: n, max, filled: n >= max };
  });
}


/* ------------------------------------------------------------------ */
/* חיווי מיידי ל-UI                                                    */
/* ------------------------------------------------------------------ */

export interface TeamBlock {
  blocked: boolean;
  /** מזהה השחקן שכבר תופס את הקבוצה — ה-UI מציע להחליף אותו */
  occupiedBy?: string;
  reasonHe?: string;
  reasonEn?: string;
}

/**
 * למה קבוצה חסומה, ומי חוסם אותה.
 * מחזיר גם את מזהה השחקן התופס, כדי שה-UI יוכל להציע "החלף את X"
 * במקום רק להאפיר ולהשאיר את המשתמש לנחש.
 */
export function teamBlock(lineup: Lineup, teamId: string, rules: RuleSet): TeamBlock {
  const occupants = filledStarters(lineup).filter((s) => s.teamId === teamId);
  if (occupants.length < rules.constraints.maxPlayersPerTeam) return { blocked: false };
  return {
    blocked: true,
    occupiedBy: occupants[0]?.playerId,
    reasonHe: 'כבר יש לך שחקן מהקבוצה הזו',
    reasonEn: 'You already have a player from this team',
  };
}

/* ── src/lib/scoring/engine.ts ──────────────────────── */

/**
 * scoring/engine.ts — מנוע הניקוד של דוביד.
 *
 *   scoreLineup(lineup, performances, outcomes, rules) -> LineupScore
 *
 * טהור לחלוטין: אין DB, אין fetch, אין Date.now(). אותם קלטים מחזירים
 * תמיד אותו מספר — אפשר לחשב מחדש מחזור מלפני שנה ולקבל בדיוק אותו ציון.
 * זה מה שמאפשר להריץ אותו גם בדפדפן (תצוגה חיה) וגם ב-Edge Function
 * (החישוב הרשמי) בלי סיכון לפער בין המספרים.
 *
 * ארבעת רכיבי הניקוד:
 *   1. ציון אישי       — פעולות השחקן, משוקללות לפי עמדה
 *   2. בונוס תוצאה     — ניצחון הקבוצה האמיתית +4 / תיקו +1
 *   3. שער וירטואלי    — כל 2 שערים של קבוצות ההרכב = +5
 *   4. הקפטן הדובידי   — ×3, חסינות כרטיסים, והעברה לסגן
 */

const sum = (lines: ScoreLine[]) => lines.reduce((a, l) => a + l.points, 0);

export interface ScoreOptions {
  /** ברירת מחדל true. כבו רק לחישובי "מה היה קורה אם". */
  validate?: boolean;
  locale?: 'he' | 'en';
}

export function scoreLineup(
  lineup: Lineup,
  performances: Map<string, PlayerPerformance> | Record<string, PlayerPerformance>,
  outcomes: Map<string, TeamOutcome> | Record<string, TeamOutcome>,
  rules: RuleSet = IL_PREMIER,
  options: ScoreOptions = {},
): LineupScore {
  const { validate = true, locale = 'he' } = options;

  // ★ שכבת ההגנה: אין ניקוד להרכב לא חוקי. גם לא "בערך".
  if (validate) assertValidLineup(lineup, rules, locale);

  const perf = toMap(performances);
  const out = toMap(outcomes);
  const xi = starters(lineup);

  // --- 1+2. ציון אישי ובונוס תוצאה, לכל שחקן ---
  const players: PlayerScore[] = xi.map((slot) =>
    scorePlayer(slot, perf.get(slot.playerId), out.get(slot.teamId), rules),
  );

  // --- 4. הקפטן הדובידי (משנה את השחקן הרלוונטי במקום) ---
  applyDubidCaptain(xi, players, perf, out, rules);

  // --- 3. שערי הרכב וירטואליים ---
  const bonusLines = virtualGoals(xi, out, rules);

  const allPlayerLines = players.flatMap((p) => p.lines);
  const byReason = (...codes: string[]) =>
    round2(sum(allPlayerLines.filter((l) => codes.includes(l.reason))));

  const captainPoints = byReason(
    Reason.CaptainMultiplier,
    Reason.CaptainImmunity,
  );
  const resultPoints = byReason(Reason.ResultBonus);
  const personalPoints = round2(
    sum(
      allPlayerLines.filter(
        (l) =>
          l.reason !== Reason.ResultBonus &&
          l.reason !== Reason.CaptainMultiplier &&
          l.reason !== Reason.CaptainImmunity &&
          l.reason !== Reason.CaptainTransferred,
      ),
    ),
  );
  const virtualPoints = round2(sum(bonusLines));

  return {
    lineupId: lineup.lineupId,
    gameweekId: lineup.gameweekId,
    rulesetVersion: rules.version,
    players,
    bonusLines,
    personalPoints,
    resultPoints,
    captainPoints,
    virtualPoints,
    totalPoints: round2(
      players.reduce((a, p) => a + p.subtotal, 0) + sum(bonusLines),
    ),
  };
}

/* =================================================================== */
/* 1 + 2 · ציון אישי ובונוס תוצאה                                       */
/* =================================================================== */

function scorePlayer(
  slot: LineupSlot,
  perf: PlayerPerformance | undefined,
  outcome: TeamOutcome | undefined,
  rules: RuleSet,
): PlayerScore {
  const p = rules.personal;
  const pos = slot.position;
  const lines: ScoreLine[] = [];
  const add = (
    reason: ScoreLine['reason'],
    points: number,
    count?: number,
    meta?: Record<string, unknown>,
  ) => {
    if (points !== 0) lines.push({ reason, points: round2(points), count, playerId: slot.playerId, meta });
  };

  if (perf && perf.played) {
    if (perf.minutes > 0) {
      add(Reason.Minutes, perf.minutes >= 60 ? p.minutes60Plus : p.minutesPlayed, perf.minutes);
    }
    if (perf.goals) add(Reason.Goal, p.goal[pos] * perf.goals, perf.goals, { perGoal: p.goal[pos] });
    if (perf.assists) add(Reason.Assist, p.assist * perf.assists, perf.assists);
    if (perf.cleanSheet && perf.minutes >= p.cleanSheetMinMinutes) {
      add(Reason.CleanSheet, p.cleanSheet[pos]);
    }
    if (perf.goalsConceded >= p.goalsConcededPer) {
      add(
        Reason.GoalsConceded,
        p.goalsConceded[pos] * Math.floor(perf.goalsConceded / p.goalsConcededPer),
        perf.goalsConceded,
      );
    }
    if (perf.saves >= p.savesPer) {
      add(Reason.Saves, p.savesPoints * Math.floor(perf.saves / p.savesPer), perf.saves);
    }
    if (perf.penaltiesSaved) add(Reason.PenaltySaved, p.penaltySaved * perf.penaltiesSaved, perf.penaltiesSaved);
    if (perf.penaltiesMissed) add(Reason.PenaltyMissed, p.penaltyMissed * perf.penaltiesMissed, perf.penaltiesMissed);
    if (perf.ownGoals) add(Reason.OwnGoal, p.ownGoal * perf.ownGoals, perf.ownGoals);
    if (perf.yellowCards) add(Reason.Yellow, p.yellowCard * perf.yellowCards, perf.yellowCards);
    if (perf.redCards) add(Reason.Red, p.redCard * perf.redCards, perf.redCards);
  }

  // בונוס תוצאה — שייך לשחקן כי הוא נובע מהקבוצה שהוא מייצג בהרכב
  if (outcome) {
    const rb = rules.resultBonus;
    const eligible = rb.requireMinutes === 0 || (perf?.minutes ?? 0) >= rb.requireMinutes;
    const pts = rb[outcome.result];
    if (eligible && pts !== 0) {
      lines.push({
        reason: Reason.ResultBonus,
        points: pts,
        playerId: slot.playerId,
        teamId: outcome.teamId,
        meta: { result: outcome.result },
      });
    }
  }

  return {
    playerId: slot.playerId,
    teamId: slot.teamId,
    position: pos,
    isCaptain: !!slot.isCaptain,
    lines,
    subtotal: round2(sum(lines)),
  };
}

/* =================================================================== */
/* 4 · ★ הקפטן הדובידי                                                  */
/* =================================================================== */

function applyDubidCaptain(
  xi: LineupSlot[],
  players: PlayerScore[],
  perf: Map<string, PlayerPerformance>,
  outcomes: Map<string, TeamOutcome>,
  rules: RuleSet,
): void {
  const c = rules.captain;
  const captainSlot = xi.find((s) => s.isCaptain);
  if (!captainSlot) return;

  // -- שלב א׳: קפטן שלא ירד למגרש -> הכפולה עוברת לסגן --------------
  let effectiveSlot = captainSlot;
  let transferred = false;
  const captainMinutes = perf.get(captainSlot.playerId)?.minutes ?? 0;

  if (captainMinutes < c.transferToViceIfMinutesBelow) {
    const vice = xi.find((s) => s.isVice && s.playerId !== captainSlot.playerId);
    const viceMinutes = vice ? (perf.get(vice.playerId)?.minutes ?? 0) : 0;
    if (vice && viceMinutes >= c.transferToViceIfMinutesBelow) {
      effectiveSlot = vice;
      transferred = true;
    } else {
      return; // אין קפטן פעיל ואין סגן פעיל — אין מכפיל. תיעוד בלבד.
    }
  }

  const target = players.find((p) => p.playerId === effectiveSlot.playerId);
  if (!target) return;

  if (transferred) {
    target.lines.push({
      reason: Reason.CaptainTransferred,
      points: 0,
      playerId: target.playerId,
      meta: { from: captainSlot.playerId, reason: 'captain_did_not_play' },
    });
    target.isCaptain = true;
  }

  // -- שלב ב׳: חסינות כרטיסים ---------------------------------------
  const result = outcomes.get(target.teamId)?.result;
  const minutes = perf.get(target.playerId)?.minutes ?? 0;
  const immunityEarned =
    minutes >= c.immunity.minMinutes &&
    (result === undefined || c.immunity.requireResultIn.includes(result));

  if (immunityEarned) {
    const forgiven: string[] = [];
    if (c.immunity.yellowCards) forgiven.push(Reason.Yellow);
    if (c.immunity.redCards) forgiven.push(Reason.Red);

    const penalty = sum(target.lines.filter((l) => forgiven.includes(l.reason)));
    if (penalty < 0) {
      // הקו המקורי נשאר בפירוט (המשתמש רוצה לראות שהיה כרטיס),
      // והזיכוי מופיע לידו כשורה נפרדת. שקיפות > קיצור.
      target.lines.push({
        reason: Reason.CaptainImmunity,
        points: round2(-penalty),
        playerId: target.playerId,
        meta: { forgiven, minutes, result },
      });
    }
  }

  // -- שלב ג׳: המכפיל -----------------------------------------------
  const multiplied = target.lines.filter((l) =>
    c.appliesTo === 'personalAndResult'
      ? l.reason !== Reason.CaptainMultiplier && l.reason !== Reason.CaptainTransferred
      : l.reason !== Reason.ResultBonus &&
        l.reason !== Reason.CaptainMultiplier &&
        l.reason !== Reason.CaptainTransferred,
  );
  const base = round2(sum(multiplied));

  if (base > 0 || (c.applyToNegative && base !== 0)) {
    const extra = round2(base * (c.multiplier - 1));
    if (extra !== 0) {
      target.lines.push({
        reason: Reason.CaptainMultiplier,
        points: extra,
        playerId: target.playerId,
        meta: { multiplier: c.multiplier, base, appliesTo: c.appliesTo },
      });
    }
  }

  target.subtotal = round2(sum(target.lines));
}

/* =================================================================== */
/* 3 · שערי הרכב וירטואליים                                             */
/* =================================================================== */

function virtualGoals(
  xi: LineupSlot[],
  outcomes: Map<string, TeamOutcome>,
  rules: RuleSet,
): ScoreLine[] {
  const v = rules.virtualGoal;
  if (v.goalsPerVirtual <= 0) return [];

  // קבוצות ייחודיות: גם אם ליגה עתידית תאפשר 2 מאותה קבוצה,
  // השערים שלה לא ייספרו פעמיים.
  const teamGoals = new Map<string, number>();
  for (const slot of xi) {
    const o = outcomes.get(slot.teamId);
    if (o) teamGoals.set(slot.teamId, o.goalsFor);
  }
  if (teamGoals.size === 0) return [];

  if (v.aggregation === 'perTeam') {
    const lines: ScoreLine[] = [];
    for (const [teamId, goals] of [...teamGoals].sort()) {
      const count = Math.floor(goals / v.goalsPerVirtual);
      if (count > 0) {
        lines.push({
          reason: Reason.VirtualGoal,
          points: round2(v.points * count),
          count,
          teamId,
          meta: { teamGoals: goals },
        });
      }
    }
    return lines;
  }

  const total = [...teamGoals.values()].reduce((a, b) => a + b, 0);
  const count = Math.floor(total / v.goalsPerVirtual);
  if (count === 0) return [];
  return [
    {
      reason: Reason.VirtualGoal,
      points: round2(v.points * count),
      count,
      meta: {
        teamGoalsTotal: total,
        remainder: total % v.goalsPerVirtual,
        perTeam: Object.fromEntries(teamGoals),
      },
    },
  ];
}

/* =================================================================== */
/* מצרפים ועזרים                                                        */
/* =================================================================== */

/** דירוג עם טיפול בשוויון: אותו ניקוד = אותו מקום. */
export function rankGameweek(scores: LineupScore[]): Array<{ rank: number; score: LineupScore }> {
  const ordered = [...scores].sort((a, b) => b.totalPoints - a.totalPoints);
  const out: Array<{ rank: number; score: LineupScore }> = [];
  let lastPoints: number | null = null;
  let lastRank = 0;
  ordered.forEach((score, i) => {
    if (score.totalPoints !== lastPoints) {
      lastRank = i + 1;
      lastPoints = score.totalPoints;
    }
    out.push({ rank: lastRank, score });
  });
  return out;
}

/** פירוט לשמירה ב-DB ולתצוגה ב-UI. */
export function toBreakdown(score: LineupScore) {
  return {
    total: score.totalPoints,
    personal: score.personalPoints,
    result: score.resultPoints,
    captain: score.captainPoints,
    virtual: score.virtualPoints,
    rulesetVersion: score.rulesetVersion,
    players: score.players.map((p) => ({
      playerId: p.playerId,
      teamId: p.teamId,
      position: p.position,
      isCaptain: p.isCaptain,
      subtotal: p.subtotal,
      lines: p.lines.map((l) => ({ reason: l.reason, points: l.points, count: l.count, meta: l.meta })),
    })),
    bonuses: score.bonusLines,
  };
}

function toMap<T>(input: Map<string, T> | Record<string, T>): Map<string, T> {
  return input instanceof Map ? input : new Map(Object.entries(input));
}

/**
 * המרת שורות מה-DB לקלט המנוע.
 * שחקן ששיחק שני משחקים במחזור (השלמת משחק דחוי) — הנתונים נצברים.
 */
export function buildInputs(
  statRows: Array<Record<string, any>>,
  matchRows: Array<Record<string, any>>,
): { performances: Map<string, PlayerPerformance>; outcomes: Map<string, TeamOutcome> } {
  const acc = new Map<string, PlayerPerformance>();
  for (const r of statRows) {
    const cur =
      acc.get(r.player_id) ??
      ({
        playerId: r.player_id,
        teamId: r.team_id,
        position: r.position,
        minutes: 0, goals: 0, assists: 0, ownGoals: 0, yellowCards: 0, redCards: 0,
        saves: 0, penaltiesSaved: 0, penaltiesMissed: 0, goalsConceded: 0,
        cleanSheet: false, played: false,
      } as PlayerPerformance);
    cur.minutes += r.minutes ?? 0;
    cur.goals += r.goals ?? 0;
    cur.assists += r.assists ?? 0;
    cur.ownGoals += r.own_goals ?? 0;
    cur.yellowCards += r.yellow_cards ?? 0;
    cur.redCards += r.red_cards ?? 0;
    cur.saves += r.saves ?? 0;
    cur.penaltiesSaved += r.penalties_saved ?? 0;
    cur.penaltiesMissed += r.penalties_missed ?? 0;
    cur.goalsConceded += r.goals_conceded ?? 0;
    cur.played = cur.minutes > 0;
    cur.cleanSheet = cur.goalsConceded === 0 && cur.minutes > 0;
    acc.set(r.player_id, cur);
  }

  const outcomes = new Map<string, TeamOutcome>();
  const rank = { W: 2, D: 1, L: 0 } as const;
  for (const r of matchRows) {
    const prev = outcomes.get(r.team_id);
    if (!prev) {
      outcomes.set(r.team_id, {
        teamId: r.team_id,
        result: r.result,
        goalsFor: r.goals_for ?? 0,
        goalsAgainst: r.goals_against ?? 0,
      });
    } else {
      outcomes.set(r.team_id, {
        teamId: r.team_id,
        result: rank[r.result as 'W'] > rank[prev.result] ? r.result : prev.result,
        goalsFor: prev.goalsFor + (r.goals_for ?? 0),
        goalsAgainst: prev.goalsAgainst + (r.goals_against ?? 0),
      });
    }
  }

  return { performances: acc, outcomes };
}

/* ── src/lib/scoring/ranking.ts ──────────────────────── */

/**
 * scoring/ranking.ts — דירוג דטרמיניסטי ושוברי שוויון.
 *
 * ★ למה זה קובץ נפרד מ-engine.ts
 *
 * `scoreLineup` הוא פונקציה של הרכב **אחד**. הוא לא יכול לדעת מה
 * אחוז הבחירה של שחקן, כי זה תלוי בכל שאר המשתתפים. דירוג ובונוס
 * דיפרנציאל הם תמיד פעולה על *קבוצת* הגשות — ולכן הם כאן, ולא שם.
 *
 * ★ אין אקראיות. בשום מקום.
 *
 * שני משתמשים עם אותו ניקוד יקבלו תמיד את אותו סדר, בכל הרצה, בכל
 * שרת. `Math.random()` לא מופיע בקובץ הזה, וגם `Date.now()` לא —
 * חותמת ההגשה מגיעה מהנתונים, לא מהשעון של המכונה שמריצה.
 */

/* =================================================================== */
/* בונוס דיפרנציאל                                                     */
/* =================================================================== */

/**
 * ★ העיקרון: בחירה נדירה **+ ביצוע טוב** = תגמול.
 *
 * הברִיף מדגיש את זה במפורש, וזה לא ניסוח יפה אלא הגנה מפני ניצול:
 * בלי דרישת הביצוע, המשחק האופטימלי הוא לבחור את השחקן הכי אנונימי
 * בליגה ולקטוף בונוס על כלום. עם הדרישה, דיפרנציאל הוא הימור אמיתי:
 * מי שמצא שחקן זול שהתפוצץ מקבל יתרון — ומי שירה באפלה לא מקבל דבר.
 */
export interface DifferentialRules {
  enabled: boolean;
  /**
   * מדרגות נדירות. הראשונה שמתאימה זוכה. `maxSelectionPct` הוא
   * אחוז המשתתפים *באותו מצב משחק* שבחרו בשחקן.
   */
  tiers: ReadonlyArray<{ maxSelectionPct: number; points: number }>;
  /** מתחת לזה השחקן פשוט לא הופיע. אין בונוס על נדירות בלבד. */
  minPlayerPoints: number;
  /** תקרה להרכב. מונע מחזור שבו דיפרנציאל מכריע יותר מכדורגל. */
  maxPerLineup: number;
  /**
   * מתחת לכמות הגשות כזו אחוזי הבחירה חסרי משמעות (3 משתתפים =
   * כל שחקן הוא 33%). במקרה כזה הבונוס כבוי לגמרי, ולא "בערך".
   */
  minEntriesForStats: number;
}

export const DEFAULT_DIFFERENTIAL: DifferentialRules = {
  enabled: true,
  tiers: [
    { maxSelectionPct: 5, points: 3 },
    { maxSelectionPct: 10, points: 2 },
    { maxSelectionPct: 20, points: 1 },
  ],
  minPlayerPoints: 5,
  maxPerLineup: 6,
  minEntriesForStats: 20,
};

/** כמה מההגשות בחרו בכל שחקן. */
export function selectionRates(
  lineups: ReadonlyArray<{ playerIds: readonly string[] }>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const l of lineups) {
    // Set: שחקן שמופיע פעמיים בהרכב לא ינפח את הסטטיסטיקה.
    for (const id of new Set(l.playerIds)) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const total = lineups.length;
  const rates = new Map<string, number>();
  if (total === 0) return rates;
  for (const [id, n] of counts) rates.set(id, (n / total) * 100);
  return rates;
}

/**
 * מוסיף שורות דיפרנציאל לציון קיים ומחזיר ציון חדש.
 * לא משנה את הקלט — אותה גישה כמו בשאר המנוע.
 */
export function applyDifferential(
  score: LineupScore,
  rates: Map<string, number>,
  entryCount: number,
  rules: DifferentialRules = DEFAULT_DIFFERENTIAL,
): LineupScore {
  if (!rules.enabled || entryCount < rules.minEntriesForStats) return score;

  // מיון יורד לפי תרומת השחקן: אם התקרה נוגסת, היא נוגסת מלמטה.
  // כך התקרה חותכת את הבונוסים הפחות משמעותיים ולא את המשמעותי ביותר.
  const candidates = [...score.players]
    .map((p) => {
      const pct = rates.get(p.playerId);
      if (pct === undefined || p.subtotal < rules.minPlayerPoints) return null;
      const tier = rules.tiers.find((t) => pct <= t.maxSelectionPct);
      return tier ? { player: p, pct, points: tier.points } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) =>
      b.points - a.points ||
      b.player.subtotal - a.player.subtotal ||
      // שובר שוויון אחרון וקבוע: מזהה שחקן. אף פעם לא סדר מקרי.
      a.player.playerId.localeCompare(b.player.playerId),
    );

  let budget = rules.maxPerLineup;
  const players = score.players.map((p) => ({ ...p, lines: [...p.lines] }));
  let added = 0;

  for (const c of candidates) {
    if (budget <= 0) break;
    const points = Math.min(c.points, budget);
    budget -= points;
    added += points;
    const target = players.find((p) => p.playerId === c.player.playerId)!;
    const line: ScoreLine = {
      reason: Reason.Differential,
      points,
      playerId: c.player.playerId,
      // ה-meta הוא מה שה-UI מציג: "רק 6% בחרו בו".
      meta: { selectionPct: Math.round(c.pct * 10) / 10, capped: points < c.points },
    };
    target.lines.push(line);
    target.subtotal = round2(target.subtotal + points);
  }

  return {
    ...score,
    players,
    differentialPoints: round2(added),
    totalPoints: round2(score.totalPoints + added),
  };
}

/* =================================================================== */
/* שוברי שוויון                                                        */
/* =================================================================== */

/**
 * ההיררכיה מהברִיף, לפי הסדר. כל שלב הוא "מי תרם יותר כדורגל".
 *
 *   1. ניקוד כולל
 *   2. ביצועי הקפטן
 *   3. נקודות דיפרנציאל
 *   4. שערים של שחקני ההרכב
 *   5. בישולים של שחקני ההרכב
 *   6. תרומת קלין-שיט
 *   7. שאר התרומה האישית המאומתת
 *   8. חותמת ההגשה הרשמית — מוקדם יותר מנצח
 *
 * ★ שוברי שוויון לא מייצרים נקודות. הם רק קובעים סדר.
 *   הניקוד שמוצג למשתמש לא משתנה בגללם, אף פעם.
 */
export interface TieBreakVector {
  totalPoints: number;
  captainPoints: number;
  differentialPoints: number;
  goals: number;
  assists: number;
  cleanSheets: number;
  otherPersonal: number;
  /** מספר: מוקדם יותר = קטן יותר. נגזר מהחותמת, לא מהשעון. */
  submittedAtMs: number;
}

export function tieBreakVector(score: LineupScore, submittedAt: string): TieBreakVector {
  const lines = score.players.flatMap((p) => p.lines);
  const countOf = (reason: string) =>
    lines.filter((l) => l.reason === reason).reduce((a, l) => a + (l.count ?? 1), 0);

  const parsed = Date.parse(submittedAt);

  return {
    totalPoints: score.totalPoints,
    captainPoints: score.captainPoints,
    differentialPoints: score.differentialPoints ?? 0,
    goals: countOf(Reason.Goal),
    assists: countOf(Reason.Assist),
    cleanSheets: countOf(Reason.CleanSheet),
    otherPersonal: round2(
      lines
        .filter((l) =>
          l.reason === Reason.Saves ||
          l.reason === Reason.PenaltySaved ||
          l.reason === Reason.Minutes,
        )
        .reduce((a, l) => a + l.points, 0),
    ),
    // חותמת לא תקינה לא מזכה ביתרון: היא נדחקת לסוף התור.
    submittedAtMs: Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER,
  };
}

/** סדר ההשוואה. שינוי כאן משנה את הדירוג בכל המוצר — בכוונה. */
const COMPARATORS: ReadonlyArray<(v: TieBreakVector) => number> = [
  (v) => v.totalPoints,
  (v) => v.captainPoints,
  (v) => v.differentialPoints,
  (v) => v.goals,
  (v) => v.assists,
  (v) => v.cleanSheets,
  (v) => v.otherPersonal,
  (v) => -v.submittedAtMs, // מוקדם יותר = טוב יותר
];

export function compareForRank(a: TieBreakVector, b: TieBreakVector): number {
  for (const get of COMPARATORS) {
    const diff = get(b) - get(a);
    if (diff !== 0) return diff;
  }
  return 0;
}

export interface RankedEntry<T> {
  rank: number;
  /** האם השוויון נשאר בלתי פתור גם אחרי כל שוברי השוויון. */
  tied: boolean;
  /** באיזה שלב נשבר השוויון. null = לא היה שוויון. לתצוגה ולביקורת. */
  brokenBy: TieBreakStage | null;
  entry: T;
  vector: TieBreakVector;
}

export type TieBreakStage =
  | 'total' | 'captain' | 'differential' | 'goals'
  | 'assists' | 'clean_sheets' | 'other' | 'submitted_at';

const STAGES: readonly TieBreakStage[] = [
  'total', 'captain', 'differential', 'goals',
  'assists', 'clean_sheets', 'other', 'submitted_at',
];

/**
 * מדרג רשימת הגשות.
 *
 * שוויון אמיתי (כל שמונת השלבים זהים) מקבל את אותו מקום — לא מקום
 * שרירותי. `tied: true` מאפשר ל-UI להציג "מקום 7 (שווה)" בכנות.
 */
export function rankEntries<T>(
  items: ReadonlyArray<{ entry: T; score: LineupScore; submittedAt: string }>,
): Array<RankedEntry<T>> {
  const withVectors = items.map((i) => ({
    entry: i.entry,
    vector: tieBreakVector(i.score, i.submittedAt),
  }));

  const ordered = [...withVectors].sort((a, b) => compareForRank(a.vector, b.vector));

  const out: Array<RankedEntry<T>> = [];
  let lastRank = 0;

  ordered.forEach((item, i) => {
    const prev = i > 0 ? ordered[i - 1] : null;
    const identical = prev !== null && compareForRank(prev.vector, item.vector) === 0;
    if (!identical) lastRank = i + 1;

    const next = ordered[i + 1] ?? null;
    const tied =
      identical || (next !== null && compareForRank(item.vector, next.vector) === 0);

    out.push({
      rank: lastRank,
      tied,
      brokenBy: prev === null ? null : stageThatBroke(prev.vector, item.vector),
      entry: item.entry,
      vector: item.vector,
    });
  });

  return out;
}

/** באיזה שלב נפרדו שני הווקטורים. null = זהים לגמרי. */
export function stageThatBroke(a: TieBreakVector, b: TieBreakVector): TieBreakStage | null {
  for (let i = 0; i < COMPARATORS.length; i++) {
    if (COMPARATORS[i](b) !== COMPARATORS[i](a)) return STAGES[i];
  }
  return null;
}

/* ── src/lib/ruleOverrides.ts ──────────────────────── */

/**
 * lib/ruleOverrides.ts — איזון ניקוד בלי פריסה.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ הבעיה
 * ═══════════════════════════════════════════════════════════════
 *
 * `scoring/rules.ts` הוא קוד. שינוי של נקודה אחת — "בישול שווה 3
 * או 4?" — דרש עריכת קובץ, בנייה ופריסה. כלומר: איזון של משחק
 * תחרותי היה תלוי במפתח.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ הפתרון: מפה שטוחה של override-ים
 * ═══════════════════════════════════════════════════════════════
 *
 * המסד מחזיק `{ "assist": 4, "goal.FWD": 5 }` — **רק** מה שהאדמין
 * שינה בפועל. כל השאר נשאר ברירת המחדל שבקוד.
 *
 * ★ למה לא להעביר את כל ה-RuleSet למסד
 *
 * שלוש סיבות:
 *
 *  1. שורה שנמחקה בטעות מטבלה הופכת את המשחק לחסר חוק. עם
 *     override-ים, טבלה ריקה = בדיוק ההתנהגות של היום.
 *  2. חוק חדש שנוסף בקוד עובד מיד, בלי הגירה של דאטה.
 *  3. ה-`RuleSet` הוא מבנה מקונן עם `Record<Position, number>`
 *     ומדיניות קפטן. JSON חופשי במסד היה מזמין מבנה לא תקין
 *     שמפיל את המנוע בזמן ריצה.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ מה **לא** ניתן לשינוי מכאן, ובכוונה
 * ═══════════════════════════════════════════════════════════════
 *
 * גודל ההרכב, המערכים המותרים, ו"שחקן אחד מכל קבוצה". אלה לא
 * איזון — הם **המשחק**. שינוי שלהם באמצע מחזור היה פוסל הרכבים
 * שכבר הוגשו כחוקיים, וזה לא דבר שצריך להיות מרחק לחיצה.
 *
 * ★ הקובץ טהור: אין רשת, אין DOM. הוא מקבל מפה ומחזיר RuleSet.
 */

/** מפה שטוחה, כפי שהיא חוזרת מ-`game.scoring_rules()`. */
export type RuleOverrides = Record<string, number>;

const POSITIONS: Position[] = ['GK', 'DEF', 'MID', 'FWD'];

/**
 * ★ המפתחות שמותר לשנות — רשימה סגורה.
 *
 * מפתח שלא כאן פשוט **מתעלמים** ממנו. זה לא קפדנות: מפתח עם
 * שגיאת כתיב שנשמר במסד היה מוצג לאדמין כאילו הוא פועל, בזמן
 * שהוא לא עושה כלום — והוא היה מגלה את זה רק כשהניקוד יוצא
 * שגוי.
 *
 * התווית היא מה שמוצג בלוח הניהול. עברית, כי זה הקהל.
 */
export const RULE_KEYS: Array<{
  key: string;
  label: string;
  group: 'אישי' | 'עונשים' | 'שוער' | 'תוצאה' | 'קפטן' | 'וירטואלי';
  hint?: string;
}> = [
  { key: 'goal.GK',  label: 'שער · שוער',  group: 'אישי' },
  { key: 'goal.DEF', label: 'שער · מגן',   group: 'אישי' },
  { key: 'goal.MID', label: 'שער · קשר',   group: 'אישי' },
  { key: 'goal.FWD', label: 'שער · חלוץ',  group: 'אישי' },
  { key: 'assist',   label: 'בישול',       group: 'אישי' },
  { key: 'minutesPlayed', label: 'הופעה', group: 'אישי',
    hint: 'נקודות על עצם הכניסה למגרש. 0 = כבוי.' },
  { key: 'minutes60Plus', label: 'מעל 60 דקות', group: 'אישי' },

  { key: 'yellowCard', label: 'כרטיס צהוב', group: 'עונשים' },
  { key: 'redCard',    label: 'כרטיס אדום', group: 'עונשים' },
  { key: 'ownGoal',    label: 'שער עצמי',   group: 'עונשים' },

  { key: 'cleanSheet.GK',  label: 'שער נקי · שוער', group: 'שוער' },
  { key: 'cleanSheet.DEF', label: 'שער נקי · מגן',  group: 'שוער' },
  { key: 'cleanSheet.MID', label: 'שער נקי · קשר',  group: 'שוער' },
  { key: 'savesPoints',    label: 'הצלות',          group: 'שוער',
    hint: 'נקודות לכל שלוש הצלות. 0 = כבוי.' },
  { key: 'penaltySaved',   label: 'עצירת פנדל',     group: 'שוער' },
  { key: 'penaltyMissed',  label: 'החמצת פנדל',     group: 'עונשים' },

  { key: 'result.W', label: 'ניצחון הקבוצה', group: 'תוצאה' },
  { key: 'result.D', label: 'תיקו',          group: 'תוצאה' },
  { key: 'result.L', label: 'הפסד',          group: 'תוצאה' },

  { key: 'captain.multiplier', label: 'מכפיל הקפטן', group: 'קפטן',
    hint: '★ שינוי כאן משנה את כל אופי המשחק. פי 3 הוא האיזון הנוכחי.' },

  { key: 'virtualGoal.points', label: 'שער וירטואלי', group: 'וירטואלי' },
  { key: 'virtualGoal.goalsPerVirtual', label: 'שערים לכל וירטואלי', group: 'וירטואלי' },
];

const ALLOWED = new Set(RULE_KEYS.map((r) => r.key));

/**
 * מחזיר את הערך הנוכחי של מפתח, לפי RuleSet.
 * משמש את לוח הניהול כדי להראות "מה זה עכשיו".
 */
export function readRule(rules: RuleSet, key: string): number | undefined {
  const [head, tail] = key.split('.');

  if (head === 'goal' && tail) return rules.personal.goal[tail as Position];
  if (head === 'cleanSheet' && tail) return rules.personal.cleanSheet[tail as Position];
  if (head === 'result' && tail) {
    return rules.resultBonus[tail as 'W' | 'D' | 'L'];
  }
  if (head === 'captain' && tail === 'multiplier') return rules.captain.multiplier;
  if (head === 'virtualGoal' && tail) {
    return rules.virtualGoal[tail as 'points' | 'goalsPerVirtual'];
  }
  if (!tail) {
    const v = (rules.personal as unknown as Record<string, unknown>)[head];
    return typeof v === 'number' ? v : undefined;
  }
  return undefined;
}

/**
 * מחיל override-ים על RuleSet ומחזיר **חדש**.
 *
 * ★ אף פעם לא משנה את המקור. `IL_PREMIER` הוא קבוע מיובא בשבעה
 *   מקומות; שינוי שלו במקום היה מדליף איזון של מצב אחד לשני,
 *   ורק אחרי שמישהו פתח את המסך בסדר מסוים.
 */
export function applyOverrides(rules: RuleSet, overrides: RuleOverrides): RuleSet {
  const keys = Object.keys(overrides ?? {}).filter((k) => ALLOWED.has(k));
  if (keys.length === 0) return rules;

  const next: RuleSet = {
    ...rules,
    personal: {
      ...rules.personal,
      goal: { ...rules.personal.goal },
      cleanSheet: { ...rules.personal.cleanSheet },
      goalsConceded: { ...rules.personal.goalsConceded },
    },
    resultBonus: { ...rules.resultBonus },
    virtualGoal: { ...rules.virtualGoal },
    captain: { ...rules.captain, immunity: { ...rules.captain.immunity } },
    constraints: rules.constraints,
    /* ★ הגרסה עולה. היא נכתבת לתוך כל `LineupScore`, ולכן שתי
       תוצאות שחושבו תחת איזון שונה לא נראות זהות בהיסטוריה. */
    version: rules.version + 1,
  };

  for (const key of keys) {
    const value = overrides[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const [head, tail] = key.split('.');

    if (head === 'goal' && POSITIONS.includes(tail as Position)) {
      next.personal.goal[tail as Position] = value;
    } else if (head === 'cleanSheet' && POSITIONS.includes(tail as Position)) {
      next.personal.cleanSheet[tail as Position] = value;
    } else if (head === 'result' && (tail === 'W' || tail === 'D' || tail === 'L')) {
      next.resultBonus[tail] = value;
    } else if (head === 'captain' && tail === 'multiplier') {
      /* ★ מכפיל שלילי או אפס הופך את הקפטן לעונש. הטווח נאכף
         גם בשרת, אבל מספר אחד שחומק מפיל מחזור שלם. */
      next.captain.multiplier = Math.max(1, value);
    } else if (head === 'virtualGoal' && tail === 'points') {
      next.virtualGoal.points = value;
    } else if (head === 'virtualGoal' && tail === 'goalsPerVirtual') {
      next.virtualGoal.goalsPerVirtual = Math.max(1, Math.round(value));
    } else if (!tail) {
      (next.personal as unknown as Record<string, number>)[head] = value;
    }
  }

  return next;
}

/* ── supabase/functions/dubid-score-gameweek/_src/index.ts ──────────────────────── */

/**
 * Supabase Edge Function — חישוב הניקוד הרשמי של מחזור.
 *
 *   POST /functions/v1/dubid-score-gameweek  { "gameweekId": "..." }
 *
 * מריצה את *אותו* מנוע בדיוק שרץ בדפדפן (app/src/lib/scoring).
 * זה לא נוחות — זו דרישה: אם החישוב היה מיושם פעמיים, בוקר אחד
 * המספר במסך היה שונה מהמספר בטבלה, ואין דבר שהורג אמון מהר יותר
 * במשחק שכולו מספרים.
 *
 * ═══════════════════════════════════════════════════════════════
 *  פריסה — והמלכוד שהפיל אותה
 * ═══════════════════════════════════════════════════════════════
 *
 * ★ למה השם `dubid-score-gameweek` ולא `score-gameweek`
 *
 * פרויקט ה-Supabase מחובר ל-GIT של **אופסיידס**, ובאותו ריפו כבר
 * יושבות פונקציות (`match-autopilot`, `sync-fixtures`). שם גנרי
 * כמו `score-gameweek` בריפו משותף הוא התנגשות שמחכה לקרות —
 * לשני המוצרים יש ניקוד, ויום אחד לאופסיידס תהיה פונקציה כזו.
 *
 * תחילית לפי מוצר היא הכלל בפרויקט משותף, בדיוק כמו שהטבלאות
 * יושבות ב-`game.*` ולא ב-`public.*`.
 *
 * ★ למה `./_lib/` ולא `../_shared/` ולא `../../src/`
 *
 * הפריסה נכשלה עם "Module not found file:///src/lib/scoring/engine.ts"
 * כי ה-bundler רואה **רק** את תיקיית הפונקציה. גם `../_shared/`
 * לא פותר — עורך ה-Dashboard לא מאפשר קבצים מעל שורש הפונקציה,
 * ואינטגרציית ה-GIT מעלה תיקייה אחת בכל פעם.
 *
 * לכן התיקייה הזו **עומדת בפני עצמה לחלוטין**: היחיד שהיא מייבאת
 * מבחוץ הוא `esm.sh`. אפשר להעתיק אותה כמו שהיא לכל ריפו, והיא
 * תעבוד. `_lib/` נוצר מ-`src/lib/` על ידי `npm run sync:edge`,
 * ומקור האמת נשאר `src/lib/`.
 *
 * ★★ פריסה: קובץ אחד ★★
 *
 * הניסיון להעלות `index.ts` + `_lib/` דרך עורך ה-Dashboard נכשל
 * ב-"Module not found .../_lib/scoring/engine.ts" — העורך לא
 * יוצר תיקיות, ו-"Add File" מוסיף קובץ אחד בשורש בלבד.
 *
 * הקובץ הנפרס נבנה מהמקור הזה + `src/lib/` על ידי
 * `scripts/bundle-edge.mjs`, בדיוק כמו `dubid-ingest`. פריסה =
 * הדבקה אחת של `index.ts`.
 *
 * הרשאות: service_role בלבד. אין חישוב ניקוד מהקליינט.
 */

// ★ אותה היררכיית דירוג בדיוק שרצה בקליינט. הברִיף דורש שהיא תהיה
//   זהה בשני הצדדים — ולכן היא מיובאת, לא ממומשת כאן מחדש.

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? 'https://dubid.dubelteam.com',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  /* ★ `db: { schema: 'game' }` — ראו dubid-ingest. הפונקציה הזו
     קוראת ל-`gameweeks`, `user_lineups` ו-`lineup_scores`, וכולן
     ב-`game`. בלי השורה הזו PostgREST מחפש ב-`public` ומחזיר
     "schema cache". הבאג היה כאן מאז ומעולם ולא התגלה, כי אף
     אחד לא הריץ אותה מקצה לקצה — עד שהקליטה האוטומטית התחילה
     לקרוא לה לפני כל פרסום. */
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { db: { schema: 'game' }, auth: { persistSession: false } },
  );

  const { gameweekId } = await req.json().catch(() => ({}));
  if (!gameweekId) return json({ error: 'gameweekId_required' }, 400);

  /* -------- 1. חוקי הניקוד של הליגה, בגרסה שהייתה בתוקף -------- */
  const { data: gw, error: gwErr } = await supabase
    .from('gameweeks')
    .select('id, number, season_id, seasons(league_id, leagues(code))')
    .eq('id', gameweekId)
    .single();
  if (gwErr || !gw) return json({ error: 'gameweek_not_found' }, 404);

  const leagueId = (gw as any).seasons?.league_id;
  const { data: rulesetRow } = await supabase
    .from('scoring_rulesets')
    .select('id, version, rules')
    .eq('league_id', leagueId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  const base = rulesetRow
    ? ruleSetFromJson({ ...rulesetRow.rules, version: rulesetRow.version })
    : IL_PREMIER;

  /* ★ מקור חוקים אחד, ולא שניים.
     הקליינט קורא ל-`game.scoring_rules()` ומחיל את מה שהאדמין
     שינה. הפונקציה הזו קראה רק את `scoring_rulesets` — טבלה
     אחרת לגמרי. כלומר האדמין היה משנה את הבישול ל-4, המסך היה
     מראה 4 והמשתמש היה סופר לפי 4 — והניקוד **הרשמי** היה
     נשאר 3. שני מספרים על אותו מחזור, ואף שגיאה בשום מקום.

     ה-override-ים מוחלים אחרונים, מעל הגרסה ההיסטורית: הם
     ה"עכשיו" של האיזון, וה-ruleset הוא הבסיס. */
  const { data: overrideRows } = await supabase.rpc('scoring_rules');
  const overrides: Record<string, number> = {};
  if (overrideRows && typeof overrideRows === 'object') {
    for (const [k, v] of Object.entries(overrideRows as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n)) overrides[k] = n;
    }
  }

  /* ★ חוקים **לכל מצב**, ולא אחד לכולם.
     דוביד 5 חולק את טבלת הניקוד עם דוביד 11 אבל לא את
     האילוצים: חמישה שחקנים, מערכים אחרים. עד עכשיו הפונקציה
     ניקדה את הכול לפי `IL_PREMIER` — כלומר כל הרכב של דוביד 5
     נפל בוולידציה על `lineupSize` ונחת ב-`failures`. המחזור
     היה נסגר, המשתמשים היו רואים "אין תוצאות", ושום דבר
     בלוגים לא היה אומר "מצב". */
  const rulesFor = {
    full: applyOverrides(base, overrides),
    five: applyOverrides(
      { ...DUBID_5X5, ...base, constraints: DUBID_5X5.constraints },
      overrides,
    ),
  } as const;

  /* -------- 2. קלטי המנוע: סטטיסטיקות ותוצאות המחזור -------- */
  const [{ data: statRows }, { data: matchRows }] = await Promise.all([
    supabase.rpc('gameweek_player_stats', { p_gameweek_id: gameweekId }),
    supabase.rpc('gameweek_team_results', { p_gameweek_id: gameweekId }),
  ]);

  const { performances, outcomes } = buildInputs(statRows ?? [], matchRows ?? []);

  /* -------- 3. כל ההרכבים הנעולים -------- */
  const { data: lineupRows } = await supabase
    .from('user_lineups')
    .select('id, user_id, mode, formation, status, submitted_at, user_lineup_slots(slot_no, player_id, team_id, position, is_captain, is_vice, is_bench)')
    .eq('gameweek_id', gameweekId)
    .in('status', ['locked', 'scored']);

  type Scored = {
    mode: 'five' | 'full';
    lineup: Lineup;
    submittedAt: string;
    score: ReturnType<typeof scoreLineup>;
  };
  const scores: Scored[] = [];
  const failures: Array<{ lineupId: string; mode: string; issues: unknown }> = [];

  for (const row of lineupRows ?? []) {
    const mode: 'five' | 'full' = (row as any).mode === 'five' ? 'five' : 'full';
    const rules = rulesFor[mode];
    const lineup: Lineup = {
      lineupId: row.id,
      userId: row.user_id,
      gameweekId,
      formation: row.formation,
      slots: (row as any).user_lineup_slots.map((s: any) => ({
        slotNo: s.slot_no,
        playerId: s.player_id,
        teamId: s.team_id,
        position: s.position,
        isCaptain: s.is_captain,
        isVice: s.is_vice,
        isBench: s.is_bench,
      })),
    };

    try {
      // ולידציה נשארת דלוקה גם כאן. הרכב שעבר את ה-DB ואת ה-API
      // ובכל זאת נופל כאן = באג שאסור לו לעבור בשקט לטבלת התוצאות.
      scores.push({
        mode,
        lineup,
        // חותמת ההגשה היא שובר השוויון האחרון. הגשה בלי חותמת
        // נדחקת לסוף התור ולא מזכה ביתרון מקרי.
        submittedAt: (row as any).submitted_at ?? '',
        score: scoreLineup(lineup, performances, outcomes, rules),
      });
    } catch (error) {
      if (error instanceof LineupInvalidError) {
        failures.push({ lineupId: lineup.lineupId, mode, issues: error.issues });
        continue;
      }
      throw error;
    }
  }

  /* -------- 4. דיפרנציאל, דירוג, כתיבה -------- */

  /* ★ כל מצב מדורג בנפרד, ואין דרך אחרת.
     דוביד 5 ודוביד 11 הם שתי תחרויות, לא אחת: הרכב של חמישה
     לעולם לא יגיע לניקוד של אחת־עשרה, ודירוג משותף היה הופך
     את דוביד 5 לתחתית קבועה של הטבלה.

     וגם בונוס הנדירות: "אחוז מהמשתתפים שבחרו את השחקן" הוא
     מספר חסר משמעות אם המונה סופר משתתפים ממשחק אחר. שני
     המצבים בוחרים מאותו מאגר שחקנים, ולכן בלי ההפרדה כל שחקן
     בדוביד 5 היה נראה "נדיר" רק כי רוב המשתתפים משחקים 11. */
  const byMode = new Map<'five' | 'full', Scored[]>();
  for (const s of scores) {
    const list = byMode.get(s.mode);
    if (list) list.push(s); else byMode.set(s.mode, [s]);
  }

  const ranked = [...byMode.values()].flatMap((group) => {
    const rates = selectionRates(
      group.map((s) => ({ playerIds: s.lineup.slots.map((x) => x.playerId) })),
    );
    const withDifferential = group.map((s) => ({
      ...s,
      score: applyDifferential(s.score, rates, group.length),
    }));
    return rankEntries(
      withDifferential.map((s) => ({ entry: s, score: s.score, submittedAt: s.submittedAt })),
    );
  });

  const rows = ranked.map(({ rank, tied, brokenBy, entry }) => ({
    lineup_id: entry.score.lineupId,
    gameweek_id: gameweekId,
    personal_points: entry.score.personalPoints,
    result_points: entry.score.resultPoints,
    captain_points: entry.score.captainPoints,
    virtual_points: entry.score.virtualPoints,
    differential_points: entry.score.differentialPoints ?? 0,
    total_points: entry.score.totalPoints,
    rank,
    // נשמר כדי שהמסך יוכל לומר "הוכרע לפי הקפטן" במקום להסתיר
    // מהמשתמש למה הוא מתחת למישהו עם אותו ניקוד.
    tied,
    tie_broken_by: brokenBy,
    breakdown: toBreakdown(entry.score),
    ruleset_id: rulesetRow?.id ?? null,
    computed_at: new Date().toISOString(),
  }));

  if (rows.length) {
    const { error } = await supabase.from('lineup_scores').upsert(rows, { onConflict: 'lineup_id' });
    if (error) return json({ error: 'write_failed', detail: error.message }, 500);

    await supabase.from('user_lineups')
      .update({ status: 'scored' })
      .eq('gameweek_id', gameweekId)
      .eq('status', 'locked');
  }

  /* ★ 'published' ולא 'settled'.
     ה-CHECK על `game.gameweeks.status` צומצם ב-db/05 לערכים
     draft/open/locked/live/scoring/published/archived — ו-'settled'
     מופה ל-'published' באותה מיגרציה. הכתיבה הזו נפסלה על ידי
     המסד, והשגיאה **לא נבדקה** — כלומר הניקוד נכתב בהצלחה,
     הפונקציה החזירה 200, והמחזור נשאר לנצח במצב 'locked'.
     תקלה שנראית בדיוק כמו "הניקוד לא עבד". */
  const { error: statusErr } = await supabase
    .from('gameweeks')
    .update({ status: 'published', published_at: new Date().toISOString() })
    .eq('id', gameweekId);
  if (statusErr) return json({ error: 'publish_failed', detail: statusErr.message }, 500);

  return json({
    gameweekId,
    scored: rows.length,
    byMode: [...byMode.entries()].map(([mode, list]) => ({ mode, count: list.length })),
    failures,
    rulesetVersion: base.version,
    top: ranked.slice(0, 3).map(({ rank, entry }) => ({
      rank, lineupId: entry.score.lineupId, total: entry.score.totalPoints,
    })),
  });
});
