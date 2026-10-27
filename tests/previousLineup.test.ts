/** H04 — העתקת הרכב קודם: מול נתוני היעד, בלי החלפה אוטומטית. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCopy, type PoolInfo, type PreviousLineup } from '../src/lib/previousLineup.ts';
import { DUBID_5X5 } from '../src/lib/scoring/rules.ts';

const pool = new Map<string, PoolInfo>([
  ['P1', { id: 'P1', teamId: 'T1', position: 'GK', price: 3, name: 'Keeper' }],
  ['P2', { id: 'P2', teamId: 'T2', position: 'DEF', price: 3, name: 'Back One' }],
  ['P3', { id: 'P3', teamId: 'T3', position: 'DEF', price: 3, name: 'Back Two', status: 'injured' }],
  ['P4', { id: 'P4', teamId: 'T4', position: 'MID', price: 4, name: 'Mid' }],
  ['P5', { id: 'P5', teamId: 'T5', position: 'FWD', price: 2, name: 'Striker' }],
]);
const target = { lineupId: 'L', userId: 'U', gameweekId: 'gw-10', currentFormation: '2-1-1' };
const src = (over: Partial<PreviousLineup> = {}): PreviousLineup => ({
  sourceCode: 'gw-9', sourceNumber: 9, mode: 'five', formation: '2-1-1',
  slots: [
    { slotNo: 1, playerId: 'P1', teamId: 'T1', position: 'GK', isCaptain: false, isVice: false },
    { slotNo: 2, playerId: 'P2', teamId: 'T2', position: 'DEF', isCaptain: true, isVice: false },
    { slotNo: 3, playerId: 'P3', teamId: 'T3', position: 'DEF', isCaptain: false, isVice: true },
    { slotNo: 4, playerId: 'P4', teamId: 'T4', position: 'MID', isCaptain: false, isVice: false },
    { slotNo: 5, playerId: 'P5', teamId: 'T5', position: 'FWD', isCaptain: false, isVice: false },
  ],
  ...over,
});

test('valid source → full draft, captain kept, injury only warns (P09)', () => {
  const r = planCopy(src(), target, pool, DUBID_5X5, 15);
  assert.equal(r.kept, 5);
  assert.deepEqual(r.needs, []);
  assert.equal(r.warnings.length, 1);
  assert.equal(r.lineup.gameweekId, 'gw-10');           // יעד, לא מקור
  assert.equal(r.lineup.slots.find((s) => s.isCaptain)?.playerId, 'P2');
});

test('changed club / position / price use target data (P10)', () => {
  const moved = new Map(pool);
  moved.set('P4', { ...pool.get('P4')!, teamId: 'T2', price: 10 });   // עבר ל-T2, התייקר
  moved.set('P5', { ...pool.get('P5')!, position: 'MID' });          // עמדה השתנתה
  moved.delete('P1');                                                // לא בסגל
  const r = planCopy(src(), target, moved, DUBID_5X5, 15);
  const reasons = r.needs.map((n) => n.reason).sort();
  assert.deepEqual(reasons, ['budget', 'club', 'gone', 'position']);
  assert.equal(r.lineup.slots.find((s) => s.playerId === 'P4')?.teamId, 'T2');
  assert.ok((r.overBudget ?? 0) > 0);
});

test('captain removed → needs captain; unsupported formation is reported', () => {
  const r = planCopy(src({ formation: '3-1-0' as string,
    slots: src().slots.map((s) => (s.playerId === 'P2' ? { ...s, playerId: 'PX' } : s)) }), target, pool, DUBID_5X5, 15);
  assert.ok(r.needs.some((n) => n.reason === 'captain'));
  assert.ok(r.needs.some((n) => n.reason === 'formation'));
  assert.equal(r.lineup.formation, '2-1-1');
});
