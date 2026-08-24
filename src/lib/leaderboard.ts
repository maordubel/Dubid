/**
 * lib/leaderboard.ts — צינור הדירוג. מקור אחד.
 *
 * ★ למה הקובץ הזה קיים
 *
 * חישוב הדירוג הוא שלושה שלבים שחייבים לקרות בסדר הזה:
 *
 *      1. ניקוד כל הגשה בנפרד            (scoreLineup)
 *      2. בונוס נדירות — דורש את כולן יחד (selectionRates → applyDifferential)
 *      3. דירוג עם שוברי שוויון           (rankEntries)
 *
 * שלב 2 הוא הסיבה. הוא לא יכול לחיות במנוע, כי המנוע רואה הרכב
 * אחד. עד עכשיו הוא חי בתוך `Leaderboard.tsx`, ולכן כל מסך אחר
 * שרצה להציג "המקום שלי" היה חייב או לשכפל את שלושת השלבים או
 * לוותר. הלובי ויתר.
 *
 * עכשיו: מסך אחד קורא, כולם מקבלים את אותו מספר. אם מסך יראה
 * מקום שונה מהטבלה — זה באג בקובץ הזה, ולא בשני מסכים שנפרדו.
 *
 * הפונקציה טהורה: מקבלת הגשות ותוצאות, מחזירה שורות. אין כאן
 * localStorage, אין Supabase, ואין React. לכן היא נבדקת.
 */
import { scoreLineup } from './scoring/engine.ts';
import { applyDifferential, rankEntries, selectionRates, type TieBreakStage } from './scoring/ranking.ts';
import type { LineupScore, PlayerPerformance, TeamOutcome } from './scoring/types.ts';
import type { RuleSet } from './scoring/rules.ts';

/** ההגשה כפי שהדירוג צריך אותה. מכוון שאינו `LineupEntry` מלא —
 *  כך אותו קוד עובד גם על שורה מ-Supabase וגם על אחת מ-localStorage. */
export interface RankableEntry {
  id: string;
  userId: string;
  displayName: string;
  submittedAt: string;
  lineup: Parameters<typeof scoreLineup>[0];
}

export interface LeaderboardRow<E extends RankableEntry = RankableEntry> {
  rank: number;
  tied: boolean;
  brokenBy: TieBreakStage | null;
  entry: E;
  score: LineupScore;
  isMe: boolean;
}

export interface LeaderboardInput<E extends RankableEntry> {
  entries: E[];
  performances: Record<string, PlayerPerformance> | Map<string, PlayerPerformance>;
  outcomes: Record<string, TeamOutcome> | Map<string, TeamOutcome>;
  rules: RuleSet;
  /** מי אני — לסימון השורה. לא משפיע על הדירוג. */
  userId?: string;
}

function asMap<T>(v: Record<string, T> | Map<string, T>): Map<string, T> {
  return v instanceof Map ? v : new Map(Object.entries(v));
}

export function buildLeaderboard<E extends RankableEntry>(
  { entries, performances, outcomes, rules, userId }: LeaderboardInput<E>,
): Array<LeaderboardRow<E>> {
  const perf = asMap(performances);
  const outc = asMap(outcomes);

  // 1 — ניקוד בסיס.
  const scored: Array<{ entry: E; score: LineupScore }> = [];
  for (const entry of entries) {
    try {
      scored.push({
        entry,
        score: scoreLineup(entry.lineup, perf, outc, rules, { validate: false }),
      });
    } catch {
      /* הרכב שנשמר תחת חוקים ישנים — לא נכנס לדירוג, ולא מפיל את המסך */
    }
  }

  // 2 — נדירות. דורש את כל ההגשות יחד.
  const rates = selectionRates(
    scored.map((s) => ({ playerIds: s.entry.lineup.slots.map((x) => x.playerId) })),
  );
  const withDiff = scored.map((s) => ({
    ...s,
    score: applyDifferential(s.score, rates, scored.length),
  }));

  // 3 — דירוג דטרמיניסטי.
  return rankEntries(
    withDiff.map((s) => ({ entry: s, score: s.score, submittedAt: s.entry.submittedAt })),
  ).map((r) => ({
    rank: r.rank,
    tied: r.tied,
    brokenBy: r.brokenBy,
    entry: r.entry.entry,
    score: r.entry.score,
    isMe: !!userId && r.entry.entry.userId === userId,
  }));
}

/** אחוז המשתתפים שהמשתמש ניצח. 1 מתוך 1 הוא 100, לא 0. */
export function beatPercent(rank: number, total: number): number {
  if (total <= 1) return 100;
  return Math.round(((total - rank) / (total - 1)) * 100);
}
