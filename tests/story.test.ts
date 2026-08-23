/**
 * tests/story.test.ts — סיפור המחזור.
 * "הבחירה הכי טובה" היא קביעה תחרותית ולכן חייבת להיות דטרמיניסטית.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStory } from '../src/lib/story.ts';
import type { LineupScore, PlayerScore } from '../src/lib/scoring/types.ts';

const p = (id: string, subtotal: number, isCaptain = false, lines: PlayerScore['lines'] = []): PlayerScore =>
  ({ playerId: id, teamId: 'T1', position: 'MID', isCaptain, lines, subtotal });

const mk = (players: PlayerScore[], over: Partial<LineupScore> = {}): LineupScore => ({
  lineupId: 'L', gameweekId: 'GW7', rulesetVersion: 1,
  players, bonusLines: [],
  personalPoints: 0, resultPoints: 0, captainPoints: 0, virtualPoints: 0,
  totalPoints: players.reduce((a, x) => a + x.subtotal, 0), ...over,
});

test('הסיפור מזהה את הבחירה הטובה, הגרועה והקפטן', () => {
  const s = buildStory({
    score: mk([p('A', 14), p('B', 6, true), p('C', -2)]),
    rank: 12, entrants: 100, previousRank: 43,
  });
  assert.equal(s.bestPick!.playerId, 'A');
  assert.equal(s.worstPick!.playerId, 'C');
  assert.equal(s.captain!.playerId, 'B');
  assert.equal(s.rankDelta, 31, 'עלה 31 מקומות');
  assert.equal(s.totalPoints, 18);
});

test('אחוז המנוצחים מחושב נכון', () => {
  assert.equal(buildStory({ score: mk([p('A', 1)]), rank: 1, entrants: 101 }).beatPct, 100);
  assert.equal(buildStory({ score: mk([p('A', 1)]), rank: 101, entrants: 101 }).beatPct, 0);
  assert.equal(buildStory({ score: mk([p('A', 1)]), rank: 51, entrants: 101 }).beatPct, 50);
});

test('משתתף יחיד לא מחלק באפס', () => {
  const s = buildStory({ score: mk([p('A', 5)]), rank: 1, entrants: 1 });
  assert.equal(s.beatPct, 100);
  assert.ok(Number.isFinite(s.beatPct));
});

test('מחזור ראשון — אין תנועת דירוג ולא אפס מטעה', () => {
  const s = buildStory({ score: mk([p('A', 5)]), rank: 4, entrants: 10 });
  assert.equal(s.rankDelta, null);
});

test('שוויון ניקוד — "הבחירה הכי טובה" יציבה בין הרצות', () => {
  const players = [p('Z', 10), p('A', 10), p('M', 10)];
  const one = buildStory({ score: mk(players), rank: 1, entrants: 9 });
  const two = buildStory({ score: mk([...players].reverse()), rank: 1, entrants: 9 });
  assert.equal(one.bestPick!.playerId, two.bestPick!.playerId);
  assert.equal(one.bestPick!.playerId, 'A', 'שובר שוויון קבוע: מזהה');
});

test('כשכולם שווים אין "בחירה שכאבה"', () => {
  const s = buildStory({ score: mk([p('A', 4), p('B', 4)]), rank: 1, entrants: 9 });
  assert.equal(s.worstPick, null, 'אין ערך בלהאשים שחקן שלא בלט לרעה');
});

test('העברת סרט הקפטן לסגן מסומנת', () => {
  const s = buildStory({
    score: mk([p('V', 9, true, [{ reason: 'captain_transferred', points: 0 }])]),
    rank: 1, entrants: 9,
  });
  assert.equal(s.captainTransferred, true);
});
