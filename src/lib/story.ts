/**
 * lib/story.ts — הסיפור של המחזור.
 *
 * ★ הברִיף: PLAY → WATCH → RESULT → COMPARE → RETURN
 *
 * החוליה שנשברת הכי בקלות היא COMPARE. מסך שמראה "64 נקודות"
 * מסיים את החוויה. מסך שמראה "64 נקודות, עלית 31 מקומות, הקפטן
 * שלך נתן 18, ניצחת 81% מהשחקנים" — מייצר את RETURN.
 *
 * הלוגיקה כאן טהורה ונבדקת בנפרד מה-UI, כי "הבחירה הכי טובה שלך"
 * היא קביעה תחרותית — היא חייבת להיות דטרמיניסטית בדיוק כמו הניקוד.
 */
import type { LineupScore, PlayerScore } from './scoring/types.ts';

export interface StoryPick {
  playerId: string;
  teamId: string;
  points: number;
  isCaptain: boolean;
}

export interface GameweekStory {
  gameweekId: string;
  totalPoints: number;
  rank: number;
  entrants: number;
  /** תנועה מול המחזור הקודם. חיובי = עלייה. null = מחזור ראשון. */
  rankDelta: number | null;
  /** אחוז המשתתפים שהמשתמש ניצח. מעוגל למספר שלם. */
  beatPct: number;
  bestPick: StoryPick | null;
  worstPick: StoryPick | null;
  captain: StoryPick | null;
  /** הקפטן לא ירד למגרש והסרט עבר לסגן. */
  captainTransferred: boolean;
  differentialPoints: number;
}

export function buildStory(input: {
  score: LineupScore;
  rank: number;
  entrants: number;
  previousRank?: number | null;
}): GameweekStory {
  const { score, rank, entrants, previousRank = null } = input;

  const ranked = [...score.players].sort(
    // מיון יציב: ניקוד, ואז מזהה. שני שחקנים עם אותו ניקוד לא
    // יתחלפו ביניהם בין רינדורים — "הבחירה הכי טובה" היא לא הגרלה.
    (a, b) => b.subtotal - a.subtotal || a.playerId.localeCompare(b.playerId),
  );

  const toPick = (p: PlayerScore | undefined): StoryPick | null =>
    p ? { playerId: p.playerId, teamId: p.teamId, points: p.subtotal, isCaptain: p.isCaptain } : null;

  // "הבחירה הגרועה" מוצגת רק אם היא באמת גרועה. אין ערך בלהצביע
  // על השחקן שהביא 2 נקודות כשכולם הביאו 2.
  const worst = ranked[ranked.length - 1];
  const worthShowing = worst && ranked.length > 1 && worst.subtotal < (ranked[0]?.subtotal ?? 0);

  return {
    gameweekId: score.gameweekId,
    totalPoints: score.totalPoints,
    rank,
    entrants,
    rankDelta: previousRank === null ? null : previousRank - rank,
    beatPct: entrants > 1 ? Math.round(((entrants - rank) / (entrants - 1)) * 100) : 100,
    bestPick: toPick(ranked[0]),
    worstPick: worthShowing ? toPick(worst) : null,
    captain: toPick(score.players.find((p) => p.isCaptain)),
    captainTransferred: score.players.some((p) =>
      p.lines.some((l) => l.reason === 'captain_transferred'),
    ),
    differentialPoints: score.differentialPoints ?? 0,
  };
}
