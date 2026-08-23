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
import { Reason, type LineupScore, type ScoreLine } from './types.ts';

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

const round2 = (n: number) => Math.round(n * 100) / 100;
