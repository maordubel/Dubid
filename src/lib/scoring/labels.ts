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
import { DICT, tr, type DictKey } from '../i18n/dict.ts';

export interface ReasonLabel {
  he: string;
  /** קיבוץ למסך הסיכום — המשתמש רואה 7 שורות, לא 20. */
  group: ReasonGroup;
  /** אירוע שלילי. ה-UI צובע אותו אחרת. */
  negative?: boolean;
}

/**
 * שמות הסטטיסטיקות המנוקדות, בעברית.
 *
 * ★ `Reason.Action` הוא קוד אחד למשפחה שלמה, והסטטיסטיקה
 *   הספציפית מגיעה ב-`meta.stat`. המפה הזו היא מה שהופך
 *   `{stat:'keyPasses'}` ל"מסירות מפתח" במסך — בלי שהמנוע
 *   יכיר מילה אחת בעברית.
 */
export const ACTION_LABELS: Record<string, string> = {
  shots:             'בעיטות',
  shotsOnTarget:     'בעיטות למסגרת',
  keyPasses:         'מסירות מפתח',
  bigChancesCreated: 'הזדמנויות שנוצרו',
  dribblesWon:       'כיבושים',
  tacklesWon:        'חטיפות',
  interceptions:     'יירוטים',
  clearances:        'הרחקות',
  recoveries:        'ריבאונדים',
  aerialsWon:        'ניצחונות באוויר',
  savesInsideBox:    'הצלות מתוך הרחבה',
};

/** התווית המלאה לשורת ניקוד, כולל הסטטיסטיקה שמאחוריה. */
export function lineLabel(reason: ReasonCode, meta?: Record<string, unknown>): string {
  if (reason === Reason.Action && typeof meta?.stat === 'string') {
    const k = `score.act.${meta.stat}`;
    return k in DICT ? tr(k as DictKey) : (ACTION_LABELS[meta.stat] ?? meta.stat);
  }
  const rk = `score.reason.${reason}`;
  return rk in DICT ? tr(rk as DictKey) : (REASON_LABELS[reason]?.he ?? reason);
}

/** שם קבוצת הניקוד בשפה הפעילה. */
export function groupLabel(g: ReasonGroup): string {
  return tr(`score.group.${g}` as DictKey);
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
  [Reason.Action]:             { he: 'פעולות',           group: 'attack' },
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
export function lineText(reason: ReasonCode, count?: number, meta?: Record<string, unknown>): string {
  const label = lineLabel(reason, meta);
  return count && count > 1 ? `${label} ×${count}` : label;
}

/**
 * ★ תגיות אירוע ליד שחקן (שער, בישול, כרטיס…) — בהשראת פנטזי.
 * נגזר אך ורק משורות הניקוד, כלומר מאותו מקור שהניקוד עצמו; שום חישוב נוסף.
 * רק אירועים שאדם מזהה במבט: לא "בעיטות" ולא "דקות".
 */
export type EventKind = 'goal' | 'assist' | 'yellow' | 'red' | 'ownGoal' | 'penMissed' | 'save' | 'cleanSheet';
export interface EventBadge { kind: EventKind; count: number }

const BADGE_OF: Partial<Record<ReasonCode, EventKind>> = {
  [Reason.Goal]: 'goal', [Reason.Assist]: 'assist',
  [Reason.Yellow]: 'yellow', [Reason.Red]: 'red',
  [Reason.OwnGoal]: 'ownGoal', [Reason.PenaltyMissed]: 'penMissed',
  [Reason.PenaltySaved]: 'save', [Reason.CleanSheet]: 'cleanSheet',
};

const BADGE_ORDER: readonly EventKind[] =
  ['goal', 'assist', 'cleanSheet', 'save', 'penMissed', 'yellow', 'red', 'ownGoal'];

export function eventBadges(lines: ReadonlyArray<{ reason: ReasonCode; count?: number }>): EventBadge[] {
  const acc = new Map<EventKind, number>();
  for (const l of lines) {
    const k = BADGE_OF[l.reason];
    if (!k) continue;
    acc.set(k, (acc.get(k) ?? 0) + Math.max(1, l.count ?? 1));
  }
  return BADGE_ORDER.filter((k) => acc.has(k)).map((k) => ({ kind: k, count: acc.get(k)! }));
}
