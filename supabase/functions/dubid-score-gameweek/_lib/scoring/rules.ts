/**
 * ⚠ נוצר אוטומטית — אל תערכו כאן.
 *
 * הועתק מ-src/lib/ על ידי scripts/sync-edge-shared.mjs.
 * כל שינוי כאן יימחק בפריסה הבאה. ערכו את המקור.
 */
/**
 * scoring/rules.ts — חוקי הניקוד כדאטה.
 *
 * ליגה חדשה או שינוי איזון = שורה חדשה בטבלת scoring_rulesets.
 * לא commit, לא deploy, ולא `if (league === 'IL')` בשום מקום.
 */
import type { Position } from './types.ts';

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
