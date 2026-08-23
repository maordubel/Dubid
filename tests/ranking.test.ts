/**
 * tests/ranking.test.ts — שוברי שוויון, דיפרנציאל, ושיגור רב-מצבי.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_DIFFERENTIAL, applyDifferential, compareForRank,
  rankEntries, selectionRates, tieBreakVector,
} from '../src/lib/scoring/ranking.ts';
import { Reason, type LineupScore, type PlayerScore } from '../src/lib/scoring/types.ts';
import { EventKind } from '../src/lib/events/types.ts';
import { appendMany, createLog } from '../src/lib/events/log.ts';
import { broadcast, MODES } from '../src/lib/events/bus.ts';
import type { RosterEntry } from '../src/lib/events/project.ts';

/* ---------- עוזרים ---------- */
function player(id: string, subtotal: number, lines: PlayerScore['lines'] = []): PlayerScore {
  return { playerId: id, teamId: 'T1', position: 'MID', isCaptain: false, lines, subtotal };
}
function score(over: Partial<LineupScore> = {}): LineupScore {
  return {
    lineupId: 'L', gameweekId: 'GW1', rulesetVersion: 1,
    players: [], bonusLines: [],
    personalPoints: 0, resultPoints: 0, captainPoints: 0, virtualPoints: 0,
    totalPoints: 0, ...over,
  };
}

/* =================== שוברי שוויון =================== */

test('ניקוד גבוה יותר תמיד מנצח', () => {
  const a = tieBreakVector(score({ totalPoints: 60 }), '2026-08-01T10:00:00Z');
  const b = tieBreakVector(score({ totalPoints: 59 }), '2026-08-01T09:00:00Z');
  assert.ok(compareForRank(a, b) < 0, 'a לפני b');
});

test('בשוויון ניקוד — הקפטן מכריע', () => {
  const a = tieBreakVector(score({ totalPoints: 60, captainPoints: 18 }), '2026-08-01T10:00:00Z');
  const b = tieBreakVector(score({ totalPoints: 60, captainPoints: 12 }), '2026-08-01T09:00:00Z');
  assert.ok(compareForRank(a, b) < 0);
});

test('שוויון מלא — הגשה מוקדמת מנצחת', () => {
  const mk = (t: string) => tieBreakVector(score({ totalPoints: 60 }), t);
  const early = mk('2026-08-01T09:00:00Z');
  const late = mk('2026-08-01T10:00:00Z');
  assert.ok(compareForRank(early, late) < 0);
});

test('הדירוג דטרמיניסטי — סדר הקלט לא משנה את התוצאה', () => {
  const items = [
    { entry: 'a', score: score({ totalPoints: 50, captainPoints: 9 }), submittedAt: '2026-08-01T10:00:00Z' },
    { entry: 'b', score: score({ totalPoints: 50, captainPoints: 9 }), submittedAt: '2026-08-01T08:00:00Z' },
    { entry: 'c', score: score({ totalPoints: 71 }), submittedAt: '2026-08-01T11:00:00Z' },
  ];
  const one = rankEntries(items).map((r) => r.entry);
  const two = rankEntries([...items].reverse()).map((r) => r.entry);
  assert.deepEqual(one, two);
  assert.deepEqual(one, ['c', 'b', 'a']);
});

test('שוויון בלתי פתור מקבל אותו מקום ומסומן', () => {
  const same = { totalPoints: 40 };
  const ranked = rankEntries([
    { entry: 'x', score: score(same), submittedAt: '2026-08-01T09:00:00Z' },
    { entry: 'y', score: score(same), submittedAt: '2026-08-01T09:00:00Z' },
    { entry: 'z', score: score({ totalPoints: 10 }), submittedAt: '2026-08-01T09:00:00Z' },
  ]);
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].rank, 1, 'שוויון אמיתי = אותו מקום');
  assert.equal(ranked[0].tied, true);
  assert.equal(ranked[2].rank, 3, 'המקום הבא מדלג');
  assert.equal(ranked[2].tied, false);
});

test('שוברי שוויון לא מוסיפים ולו נקודה אחת', () => {
  const s = score({ totalPoints: 55, captainPoints: 12 });
  const ranked = rankEntries([{ entry: 'a', score: s, submittedAt: '2026-08-01T09:00:00Z' }]);
  assert.equal(ranked[0].vector.totalPoints, 55);
  assert.equal(s.totalPoints, 55, 'הציון המקורי לא שונה');
});

test('חותמת הגשה לא תקינה נדחקת לסוף ולא מזכה ביתרון', () => {
  const good = tieBreakVector(score({ totalPoints: 30 }), '2026-08-01T09:00:00Z');
  const bad = tieBreakVector(score({ totalPoints: 30 }), 'not-a-date');
  assert.ok(compareForRank(good, bad) < 0);
});

/* =================== דיפרנציאל =================== */

test('אחוזי בחירה מחושבים נכון', () => {
  const rates = selectionRates([
    { playerIds: ['P1', 'P2'] },
    { playerIds: ['P1', 'P3'] },
    { playerIds: ['P1', 'P4'] },
    { playerIds: ['P5', 'P6'] },
  ]);
  assert.equal(rates.get('P1'), 75);
  assert.equal(rates.get('P2'), 25);
});

test('דיפרנציאל דורש ביצוע — נדירות לבדה לא מספיקה', () => {
  const rates = new Map([['P1', 2]]);          // נדיר מאוד
  const s = score({ players: [player('P1', 1)], totalPoints: 1 }); // אבל לא הופיע
  const out = applyDifferential(s, rates, 100);
  assert.equal(out.differentialPoints ?? 0, 0);
  assert.equal(out.totalPoints, 1);
});

test('בחירה נדירה שהצליחה מקבלת בונוס עם הסבר', () => {
  const rates = new Map([['P1', 4]]);
  const s = score({ players: [player('P1', 14)], totalPoints: 14 });
  const out = applyDifferential(s, rates, 100);
  assert.equal(out.differentialPoints, 3);
  assert.equal(out.totalPoints, 17);
  const line = out.players[0].lines.find((l) => l.reason === Reason.Differential)!;
  assert.equal(line.points, 3);
  assert.equal(line.meta!.selectionPct, 4, 'ה-UI יכול להציג "רק 4% בחרו בו"');
});

test('הבונוס חסום בתקרה להרכב', () => {
  const rates = new Map(['P1', 'P2', 'P3'].map((id) => [id, 1] as const));
  const s = score({
    players: [player('P1', 20), player('P2', 18), player('P3', 16)],
    totalPoints: 54,
  });
  const out = applyDifferential(s, rates, 100, { ...DEFAULT_DIFFERENTIAL, maxPerLineup: 4 });
  assert.equal(out.differentialPoints, 4, 'לא יותר מהתקרה');
});

test('מעט מדי משתתפים — הדיפרנציאל כבוי לגמרי', () => {
  const rates = new Map([['P1', 4]]);
  const s = score({ players: [player('P1', 14)], totalPoints: 14 });
  const out = applyDifferential(s, rates, 5);
  assert.equal(out.differentialPoints ?? 0, 0, '5 משתתפים = אחוזים חסרי משמעות');
});

/* =================== שיגור לשני מצבי משחק =================== */

test('★ לוג אחד מזין את שני מצבי המשחק מהקרנה אחת', () => {
  const TEAMS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];
  const roster = new Map<string, RosterEntry>();
  TEAMS.forEach((t, i) => {
    roster.set(`G${i}`, { playerId: `G${i}`, teamId: t, position: 'GK' });
    roster.set(`D${i}`, { playerId: `D${i}`, teamId: t, position: 'DEF' });
    roster.set(`M${i}`, { playerId: `M${i}`, teamId: t, position: 'MID' });
    roster.set(`F${i}`, { playerId: `F${i}`, teamId: t, position: 'FWD' });
  });

  const startAll = (teamIdx: number, teamId: string) =>
    (['G', 'D', 'M', 'F'] as const).map((p) => ({
      kind: EventKind.LineupStart, phase: '1H' as const, minute: 0,
      teamId, playerId: `${p}${teamIdx}`,
      source: 'provider' as const, confidence: 'verified' as const,
    }));

  // משחק אחד: T1 מנצח 1:0, F0 כובש, M0 מבשל.
  let log = createLog({ fixtureId: 'F1', gameweekId: 'GW1', homeTeamId: 'T1', awayTeamId: 'T2' });
  log = appendMany(log, [
    ...startAll(0, 'T1'), ...startAll(1, 'T2'),
    { kind: EventKind.Goal, phase: '2H', minute: 66, teamId: 'T1', playerId: 'F0',
      source: 'provider', confidence: 'verified' },
    { kind: EventKind.Assist, phase: '2H', minute: 66, teamId: 'T1', playerId: 'M0',
      source: 'provider', confidence: 'verified' },
    { kind: EventKind.FullTime, phase: '2H', minute: 90, teamId: 'T1',
      source: 'provider', confidence: 'verified' },
  ]);

  const five = {
    lineupId: 'L5', userId: 'u1', gameweekId: 'GW1', formation: '2-1-1',
    slots: [
      { slotNo: 1, playerId: 'G0', teamId: 'T1', position: 'GK' as const },
      { slotNo: 2, playerId: 'D1', teamId: 'T2', position: 'DEF' as const },
      { slotNo: 3, playerId: 'D2', teamId: 'T3', position: 'DEF' as const },
      { slotNo: 4, playerId: 'M3', teamId: 'T4', position: 'MID' as const, isCaptain: true },
      { slotNo: 5, playerId: 'F4', teamId: 'T5', position: 'FWD' as const },
    ],
  };
  // אותו משתמש, אותו מחזור, מצב אחר — והפעם F0 (הכובש) בהרכב.
  const eleven = {
    ...five, lineupId: 'L11', formation: '2-1-1',
    slots: [
      { slotNo: 1, playerId: 'G1', teamId: 'T2', position: 'GK' as const },
      { slotNo: 2, playerId: 'D2', teamId: 'T3', position: 'DEF' as const },
      { slotNo: 3, playerId: 'D3', teamId: 'T4', position: 'DEF' as const },
      { slotNo: 4, playerId: 'M4', teamId: 'T5', position: 'MID' as const },
      { slotNo: 5, playerId: 'F0', teamId: 'T1', position: 'FWD' as const, isCaptain: true },
    ],
  };

  const result = broadcast('GW1', [log], roster, [
    { entryId: 'e1', userId: 'u1', displayName: 'מאור', submittedAt: '2026-08-01T09:00:00Z',
      mode: 'five', lineup: five },
    { entryId: 'e2', userId: 'u2', displayName: 'דני', submittedAt: '2026-08-01T09:30:00Z',
      mode: 'full', lineup: eleven },
  ]);

  // שני המצבים קיבלו תשובה
  assert.equal(result.byMode.five.entries.length, 1);
  assert.equal(result.byMode.full.entries.length, 1);
  assert.equal(result.byMode.five.rejected.length, 0);
  assert.equal(result.byMode.full.rejected.length, 0);

  // ...מאותה הקרנה בדיוק
  assert.equal(result.projection.performances.get('F0')!.goals, 1);
  assert.equal(result.projection.performances.get('M0')!.assists, 1);
  assert.equal(result.projection.outcomes.get('T1')!.result, 'W');

  // ...וכל מצב פירש אותה לפי החוקים שלו
  const fullScore = result.byMode.full.entries[0].score;
  assert.ok(fullScore.totalPoints > 0, 'הכובש בהרכב — יש נקודות');
  assert.ok(fullScore.captainPoints > 0, 'והוא גם הקפטן');
  assert.equal(MODES.five.rules.constraints.lineupSize, 5);
  assert.equal(MODES.five.budget, 15);
  assert.equal(MODES.full.budget, null);

  // טביעת אצבע יציבה: אותם נתונים = אותה חתימה
  const again = broadcast('GW1', [log], roster, []);
  assert.equal(result.fingerprint, again.fingerprint);
});
