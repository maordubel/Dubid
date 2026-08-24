/**
 * lib/growth.ts — תוכנית השיווק הצולבת בין דוביד לאופסיידס.
 *
 * ═══════════════════════════════════════════════════════════════════
 *  הבעיה, בשורה אחת
 * ═══════════════════════════════════════════════════════════════════
 *
 * דוביד הוא משחק **שבועי**. אחרי שההרכב ננעל, המשתמש מחזיק שלושה
 * ימים של כלום. אין מה ללחוץ, אין מה לשנות, אין מה לראות.
 *
 * אופסיידס הוא משחק **של תשעים דקות**, בזמן אמת, על אותם משחקים
 * בדיוק שהמשתמש כבר עומד לראות.
 *
 * זה לא "עוד באנר". זה משבצת ריקה ביומן של המשתמש ומוצר שנכנס
 * בדיוק לתוכה. הצומת (Theory of Constraints) הוא **הרגע**, לא
 * המסר — ולכן כל התוכנית כאן בנויה סביב מתי, לא סביב מה.
 *
 * ═══════════════════════════════════════════════════════════════════
 *  חמשת הרגעים
 * ═══════════════════════════════════════════════════════════════════
 *
 *  1. `just-locked`   — רגע אחרי הנעילה. לולאה פתוחה (Zeigarnik):
 *                       המשתמש בדיוק השקיע מחשבה והמערכת אמרה לו
 *                       "עכשיו תחכה". זה הרגע עם הכוונה הכי גבוהה.
 *  2. `kickoff-soon`  — פחות משעתיים לשריקה. Timely במובן הצר:
 *                       הוא ממילא הולך לפתוח את המשחק.
 *  3. `beaten`        — התוצאות פורסמו והוא לא בפסגה. שנאת הפסד
 *                       (Loss Aversion) חזקה פי שניים משמחת רווח,
 *                       ובדוביד הריוונג׳ מגיע רק בעוד שבוע.
 *  4. `champion`      — התוצאות פורסמו והוא בפסגה. Peak-End:
 *                       הרגע הכי טוב שלו בשבוע. ההזמנה היא אתגר,
 *                       לא נחמה.
 *  5. `idle`          — ברירת מחדל שקטה. חשיפה בלבד
 *                       (Mere Exposure), בלי הבטחה ובלי לחץ.
 *
 * ═══════════════════════════════════════════════════════════════════
 *  מה התוכנית הזו *לא* עושה — וזה מכוון
 * ═══════════════════════════════════════════════════════════════════
 *
 * · **אין אקראיות.** הברִיף אוסר הכרעה אקראית, והכלל תקף גם כאן:
 *   אותו הקשר → אותו מסר, תמיד. אחרת אי אפשר למדוד ואי אפשר לבדוק.
 * · **אין רדיפה.** דחייה נשמרת לכל המחזור. תקרת חשיפות לכל וריאנט.
 *   אפקט הקוברה: באנר שרודף הורג את שני המוצרים, לא רק אחד.
 * · **אין הבטחות כוזבות.** אין "מיליון שחקנים" ואין ספירה לאחור
 *   מזויפת. דחיפות אמיתית בלבד — שעת פתיחה היא עובדה.
 * · **מקום אחד למסך.** לא שני באנרים באותו עמוד.
 *
 * הקובץ טהור: אין `Date.now()`, אין DOM, אין localStorage. הזמן
 * והמצב מוזרקים. אותו קוד נבדק במלואו בלי דפדפן.
 */

/**
 * ★ שם המוצר השני — נקודת אמת אחת.
 *
 * הוא נכתב במוצר בשלוש צורות שונות: "אופסיידס", "Offsides",
 * ו-"OFFSIDE BETS" (בתמונת הפרסומת). השלישית פשוט לא נכונה — שם
 * המוצר הוא **Offsides**. שם שגוי בנכס גרפי הוא הסוג שהכי קשה
 * לתפוס, כי אף בדיקה לא קוראת תמונות.
 *
 * מכאן: כל מקום שמזכיר את המוצר מייבא מהבלוק הזה. אין מחרוזת
 * חופשית, ואין שם באנגלית שנכתב ידנית פעמיים.
 *
 * ⚠ הדומיין נשאר `offsidebets.dubel.team` כי זה המארח החי. אם הוא
 *   יוחלף — שורה אחת כאן, ו-`tests/growth.test.ts` יתפוס אם מישהו
 *   שכח לעדכן את הבדיקה.
 */
export const OFFSIDES = {
  /** השם באנגלית. לא "Offside", לא "Offside Bets". */
  name: 'Offsides',
  nameHe: 'אופסיידס',
  url: 'https://offsidebets.dubel.team',
  /** לתצוגה בתוך נכסים גרפיים — אותיות גדולות, בלי פרוטוקול. */
  domainLabel: 'OFFSIDEBETS.DUBEL.TEAM',
} as const;

/** לאן הקישור מוביל. שם היסטורי; המקור הוא `OFFSIDES.url`. */
export const OFFSIDES_URL = OFFSIDES.url;

/** איפה במוצר הבאנר יושב. משמש גם לשיוך המקור. */
export type Placement = 'lobby' | 'locked' | 'result';

/** מזהה הרגע. יציב לנצח — הוא נשמר בשיוך ובאנליטיקס. */
export type PromoId = 'just-locked' | 'kickoff-soon' | 'beaten' | 'champion' | 'idle';

/**
 * הטון קובע צבע ומשקל, לא רק ניסוח.
 *   urgent  — משהו קורה עכשיו
 *   revenge — הפסד טרי
 *   crown   — ניצחון טרי
 *   calm    — נוכחות שקטה
 */
export type PromoTone = 'urgent' | 'revenge' | 'crown' | 'calm';

export interface Promo {
  id: PromoId;
  /** שורה ראשית. קצרה. נקראת בחצי שנייה. */
  headline: string;
  /** משפט אחד שמסביר למה דווקא עכשיו. */
  body: string;
  /** הפעולה. פועל, לא שם עצם. */
  cta: string;
  tone: PromoTone;
}

/**
 * ההקשר שהמסך מספק. כל שדה כאן הוא עובדה שהמוצר כבר יודע —
 * אין כאן שום דבר שדורש מעקב חדש אחרי המשתמש.
 */
export interface GrowthContext {
  /** האם ההגשה עדיין פתוחה. */
  submissionOpen: boolean;
  /** האם המשתמש כבר נעל הרכב במחזור הזה. */
  hasSubmitted: boolean;
  /** האם התוצאות פורסמו. */
  resultsPublished: boolean;
  /** מילישניות עד פתיחת המשחק הראשון. שלילי = כבר התחיל. */
  msToKickoff: number;
  /** מקום המשתמש בדירוג, אם פורסם. */
  rank?: number;
  /** מספר המשתתפים, אם ידוע. */
  entrants?: number;
}

/* ================================================================== */
/* בחירת הרגע                                                          */
/* ================================================================== */

/** פחות משעתיים לשריקה = "עכשיו". מעל זה זו עדיין המתנה. */
const KICKOFF_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * בוחר את המסר. **דטרמיניסטי לחלוטין** — אותו הקשר מחזיר תמיד
 * את אותו מזהה. סדר התנאים הוא סדר העדיפות, ולכן הוא מפורש
 * ולא מפוזר ב-`if`-ים.
 */
export function pickPromo(ctx: GrowthContext): Promo {
  // 1. התוצאות פורסמו — מה שקרה גובר על מה שיקרה.
  if (ctx.resultsPublished && ctx.rank !== undefined) {
    return ctx.rank === 1 ? PROMOS.champion : PROMOS.beaten;
  }

  // 2. השריקה מיד. רלוונטי גם למי שלא הגיש — הוא ממילא צופה.
  if (ctx.msToKickoff > 0 && ctx.msToKickoff <= KICKOFF_WINDOW_MS) {
    return PROMOS['kickoff-soon'];
  }

  // 3. נעל הרכב וההגשות עוד פתוחות = הוא בדיוק סיים והתחיל לחכות.
  //    זו הלולאה הפתוחה, והיא הרגע החזק ביותר בתוכנית.
  if (ctx.hasSubmitted && ctx.submissionOpen) return PROMOS['just-locked'];

  // 4. שקט.
  return PROMOS.idle;
}

/**
 * הטקסטים. מרוכזים כאן ולא פזורים ב-JSX, כדי שאפשר יהיה לשנות
 * ניסוח בלי לגעת בקומפוננטה — ולבדוק אותו.
 */
export const PROMOS: Record<PromoId, Promo> = {
  'just-locked': {
    id: 'just-locked',
    headline: 'ההרכב נעול. ומה עכשיו?',
    body: 'שלושה ימים עד השריקה. באופסיידס המשחק עצמו הוא המשחק.',
    cta: 'לפתוח זירה',
    tone: 'calm',
  },
  'kickoff-soon': {
    id: 'kickoff-soon',
    headline: 'עוד רגע שורקים',
    body: 'אותם משחקים, תשעים דקות, ניחושים חיים מול החברים.',
    cta: 'להיכנס לזירה',
    tone: 'urgent',
  },
  beaten: {
    id: 'beaten',
    headline: 'הריוונג׳ בדוביד הוא בעוד שבוע',
    body: 'באופסיידס הוא במשחק הבא. אותו חשבון, בלי הרשמה מחדש.',
    cta: 'לקחת ריוונג׳',
    tone: 'revenge',
  },
  champion: {
    id: 'champion',
    headline: 'מקום ראשון. עכשיו תוכיח שזה לא מזל',
    body: 'ניחושים בזמן אמת, בלי שבוע להתכונן. שם יודעים מי באמת מבין.',
    cta: 'לקבל את האתגר',
    tone: 'crown',
  },
  idle: {
    id: 'idle',
    headline: OFFSIDES.nameHe,
    body: 'חיזוי משחקים חי, זירות מול חברים. אותו חשבון בדיוק.',
    cta: 'להעיף מבט',
    tone: 'calm',
  },
};

/* ================================================================== */
/* שיוך מקור                                                           */
/* ================================================================== */

/**
 * בונה את הקישור עם שיוך מלא. אופסיידס יודע בדיוק מאיפה הגיע
 * המשתמש, מאיזה רגע ומאיזה מחזור — בלי קוקי צד־שלישי ובלי
 * מזהה אישי כלשהו בכתובת.
 */
export function offsidesUrl(
  promo: PromoId,
  placement: Placement,
  gameweekNumber: number,
  base = OFFSIDES_URL,
): string {
  const url = new URL(base);
  url.searchParams.set('ref', 'dubid');
  url.searchParams.set('src', placement);
  url.searchParams.set('v', promo);
  url.searchParams.set('gw', String(gameweekNumber));
  return url.toString();
}

/* ================================================================== */
/* תדירות — הכלל שמונע מהתוכנית להרוג את עצמה                          */
/* ================================================================== */

/** כמה פעמים מותר להראות וריאנט אחד באותו מחזור. */
export const IMPRESSION_CAP = 3;

export interface FrequencyState {
  /** מספר המחזור שבו נדחה הבאנר אחרונה. */
  dismissedGameweek?: number;
  /** חשיפות לפי וריאנט, במחזור הנוכחי. */
  impressions: Partial<Record<PromoId, number>>;
  /** המחזור שאליו הספירה שייכת. שינוי מחזור מאפס אותה. */
  gameweek: number;
}

export function emptyFrequency(gameweek: number): FrequencyState {
  return { gameweek, impressions: {} };
}

/**
 * מאפס את הספירה כשמתחלף מחזור. בלי זה תקרת החשיפות הופכת
 * לתקרה לכל החיים והבאנר נעלם לתמיד אחרי שבוע אחד.
 */
export function rollGameweek(state: FrequencyState, gameweek: number): FrequencyState {
  return state.gameweek === gameweek ? state : emptyFrequency(gameweek);
}

/** האם מותר להציג. דחייה גוברת על הכל. */
export function shouldShow(
  state: FrequencyState,
  promo: PromoId,
  gameweek: number,
): boolean {
  const s = rollGameweek(state, gameweek);
  if (s.dismissedGameweek === gameweek) return false;
  return (s.impressions[promo] ?? 0) < IMPRESSION_CAP;
}

export function recordImpression(
  state: FrequencyState,
  promo: PromoId,
  gameweek: number,
): FrequencyState {
  const s = rollGameweek(state, gameweek);
  return {
    ...s,
    impressions: { ...s.impressions, [promo]: (s.impressions[promo] ?? 0) + 1 },
  };
}

export function recordDismiss(state: FrequencyState, gameweek: number): FrequencyState {
  return { ...rollGameweek(state, gameweek), dismissedGameweek: gameweek };
}
