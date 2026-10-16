import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeRound, type RoundInput } from '../src/lib/roundPhase.ts';

const base: RoundInput = {
  number: 3, submissionOpen: false, published: false, nowMs: Date.parse('2026-10-17T12:00:00Z'),
  deadlineAt: '2026-10-17T10:00:00Z', firstKickoffAt: '2026-10-17T16:00:00Z', hasSubmitted: true,
  fixturesTotal: 8, fixturesFinal: 0, fixturesLive: 0,
};

test('open', () => {
  const b = describeRound({ ...base, submissionOpen: true });
  assert.equal(b.step, 'open'); assert.equal(b.stepIndex, 0);
});
test('locked before first kickoff', () => {
  assert.equal(describeRound(base).step, 'locked');
});
test('live: partial finals, live points flagged', () => {
  const b = describeRound({ ...base, fixturesFinal: 3, myPoints: 40, myRank: 2 });
  assert.equal(b.step, 'live'); assert.equal(b.pointsAreLive, true);
  assert.ok(b.facts.some((f) => f.value === '3 מתוך 8'));
});
test('scoring when all final but unpublished', () => {
  assert.equal(describeRound({ ...base, fixturesFinal: 8 }).step, 'scoring');
});
test('published: previous round shown, points final', () => {
  const b = describeRound({ ...base, published: true, myPoints: 55, previous: { number: 2, points: 61, rank: 4 } });
  assert.equal(b.step, 'published'); assert.equal(b.pointsAreLive, false);
  assert.ok(b.facts.some((f) => f.label === 'מחזור 2' && f.value === '61 · מקום 4'));
});
