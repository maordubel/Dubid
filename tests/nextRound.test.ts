/** H05 — המחזור הבא: מצבים נפרדים, TTL, בקשה משותפת, כשל ≠ ריק. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  __setNextRoundRpcForTests, loadNextRound, peekNextRound, invalidateNextRounds, NEXT_ROUND_TTL_MS,
} from '../src/lib/roundContext.ts';

type R = { data: unknown; error: unknown };
function fakeRpc(next: () => R, fixtures: () => R = () => ({ data: { fixtures: [] }, error: null })) {
  const calls: string[] = [];
  __setNextRoundRpcForTests(async (fn) => { calls.push(fn); return fn === 'next_round' ? next() : fixtures(); });
  return calls;
}
const NR = { code: 'gw-10', number: 10, status: 'draft', lockAt: '2026-11-07T17:00:00Z', firstKickoffAt: null, fixturesTotal: 0 };

test('error is not empty (P14)', async () => {
  fakeRpc(() => ({ data: null, error: { message: 'boom' } }));
  const s = await loadNextRound('gw-9');
  assert.equal(s.status, 'error');
  fakeRpc(() => ({ data: null, error: null }));
  assert.equal((await loadNextRound('gw-9', true)).status, 'empty');
});

test('two consumers share one request (P16)', async () => {
  const calls = fakeRpc(() => ({ data: NR, error: null }));
  const [a, b] = await Promise.all([loadNextRound('gw-9'), loadNextRound('gw-9')]);
  assert.equal(a.status, 'ready'); assert.equal(b.status, 'ready');
  assert.equal(calls.filter((c) => c === 'next_round').length, 1);
  await loadNextRound('gw-9');                      // בתוך TTL — מהמטמון
  assert.equal(calls.filter((c) => c === 'next_round').length, 1);
});

test('invalidation marks stale and a load refreshes (P15)', async () => {
  let lock = '2026-11-07T17:00:00Z';
  const calls = fakeRpc(() => ({ data: { ...NR, lockAt: lock }, error: null }));
  await loadNextRound('gw-9');
  lock = '2026-11-08T15:00:00Z';
  invalidateNextRounds();
  const p = peekNextRound('gw-9');
  assert.equal(p.status === 'ready' && p.stale, true);
  const s = await loadNextRound('gw-9');
  assert.equal(s.status === 'ready' && s.data.lockAt, lock);
  assert.equal(calls.filter((c) => c === 'next_round').length, 2);
});

test('failure after success keeps the old data, marked (no fake fresh)', async () => {
  let fail = false;
  fakeRpc(() => (fail ? { data: null, error: { m: 'x' } } : { data: NR, error: null }));
  await loadNextRound('gw-9');
  fail = true;
  const s = await loadNextRound('gw-9', true);
  assert.equal(s.status, 'error');
  assert.equal(s.status === 'error' && s.cached?.code, 'gw-10');
});

test('TTL is 60s', () => { assert.equal(NEXT_ROUND_TTL_MS, 60_000); });
