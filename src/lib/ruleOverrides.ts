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
import type { RuleSet } from './scoring/rules.ts';
import type { Position } from './scoring/types.ts';

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
