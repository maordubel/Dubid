/**
 * ⚠ נוצר אוטומטית — אל תערכו כאן.
 *
 * הועתק מ-src/lib/ על ידי scripts/sync-edge-shared.mjs.
 * כל שינוי כאן יימחק בפריסה הבאה. ערכו את המקור.
 */
/**
 * scoring/labels.ts — תרגום קודי הסיבה לשפת אדם.
 *
 * המנוע מחזיר `ReasonCode` ולא מחרוזות תצוגה, בכוונה: אותו ציון
 * מוצג בעברית, ייצא ל-CSV, ויום אחד גם באנגלית — בלי לגעת בחישוב.
 * הקובץ הזה הוא הגשר, והוא היחיד שמותר לו להכיר את שתי השפות.
 *
 * ★ הברִיף: "לעולם לא להציג רק ציון סופי".
 *   בשביל זה כל שורה כאן קיימת.
 */
import { Reason, type ReasonCode } from './types.ts';

export interface ReasonLabel {
  he: string;
  /** קיבוץ למסך הסיכום — המשתמש רואה 7 שורות, לא 20. */
  group: ReasonGroup;
  /** אירוע שלילי. ה-UI צובע אותו אחרת. */
  negative?: boolean;
}

export type ReasonGroup =
  | 'attack' | 'defense' | 'minutes' | 'discipline'
  | 'team' | 'captain' | 'differential';

export const REASON_LABELS: Record<ReasonCode, ReasonLabel> = {
  [Reason.Goal]:               { he: 'שערים',            group: 'attack' },
  [Reason.Assist]:             { he: 'בישולים',          group: 'attack' },
  [Reason.PenaltyMissed]:      { he: 'פנדל שהוחמץ',      group: 'attack', negative: true },
  [Reason.CleanSheet]:         { he: 'שער נקי',          group: 'defense' },
  [Reason.Saves]:              { he: 'הצלות',            group: 'defense' },
  [Reason.PenaltySaved]:       { he: 'פנדל שנעצר',       group: 'defense' },
  [Reason.GoalsConceded]:      { he: 'ספיגות',           group: 'defense', negative: true },
  [Reason.OwnGoal]:            { he: 'שער עצמי',         group: 'defense', negative: true },
  [Reason.Minutes]:            { he: 'דקות משחק',        group: 'minutes' },
  [Reason.Yellow]:             { he: 'כרטיס צהוב',       group: 'discipline', negative: true },
  [Reason.Red]:                { he: 'כרטיס אדום',       group: 'discipline', negative: true },
  [Reason.ResultBonus]:        { he: 'תוצאת הקבוצה',     group: 'team' },
  [Reason.VirtualGoal]:        { he: 'שער הרכב',         group: 'team' },
  [Reason.CaptainMultiplier]:  { he: 'הקפטן',            group: 'captain' },
  [Reason.CaptainImmunity]:    { he: 'חסינות הקפטן',     group: 'captain' },
  [Reason.CaptainTransferred]: { he: 'הסרט עבר לסגן',    group: 'captain' },
  [Reason.Differential]:       { he: 'בחירה נדירה',      group: 'differential' },
};

export const GROUP_LABELS: Record<ReasonGroup, string> = {
  attack:       'התקפה',
  defense:      'הגנה',
  minutes:      'דקות',
  discipline:   'משמעת',
  team:         'קבוצה',
  captain:      'קפטן',
  differential: 'דיפרנציאל',
};

/** סדר קבוע במסך הסיכום. לא לפי ניקוד — כדי שהעין תלמד מקום אחד. */
export const GROUP_ORDER: readonly ReasonGroup[] = [
  'attack', 'defense', 'minutes', 'team', 'captain', 'differential', 'discipline',
];

export function labelFor(reason: ReasonCode): ReasonLabel {
  return REASON_LABELS[reason] ?? { he: reason, group: 'attack' };
}

/**
 * טקסט ההסבר לשורה בודדת.
 * "שערים ×2" קריא יותר מ-"goal, count: 2" — וזה כל ההבדל בין
 * לוח מחוונים למשחק.
 */
export function lineText(reason: ReasonCode, count?: number): string {
  const label = labelFor(reason).he;
  return count && count > 1 ? `${label} ×${count}` : label;
}
