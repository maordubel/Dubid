import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventBadges, lineText } from '../src/lib/scoring/labels.ts';
import { Reason } from '../src/lib/scoring/types.ts';

test('eventBadges: goals, assists, cards in fixed order; ignores minor stats', () => {
  const b = eventBadges([
    { reason: Reason.Yellow }, { reason: Reason.Goal, count: 2 },
    { reason: Reason.Minutes }, { reason: Reason.Assist }, { reason: Reason.Action },
  ]);
  assert.deepEqual(b, [
    { kind: 'goal', count: 2 }, { kind: 'assist', count: 1 }, { kind: 'yellow', count: 1 },
  ]);
});

test('lineText uses the specific stat name for Action lines', () => {
  assert.equal(lineText(Reason.Action, 3, { stat: 'keyPasses' }), 'מסירות מפתח ×3');
});
