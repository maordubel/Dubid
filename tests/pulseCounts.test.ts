/** H01 — מונה אחד, הגדרה אחת. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pulseCounts, type RoundPulse } from '../src/lib/pulse.ts';

const v1: RoundPulse = { code: 'gw-9', total: 4, five: 2, full: 2, last24h: 1, lastHour: 0, recent: [], at: '' };

test('v2: managers are unique, lineups are submissions', () => {
  const p: RoundPulse = { ...v1, schemaVersion: 2, overall: { managers: 3, lineups: 4 },
    byMode: { five: { managers: 2, lineups: 2 }, full: { managers: 2, lineups: 2 } } };
  assert.deepEqual(pulseCounts(p), { managers: 3, lineups: 4 });
  assert.deepEqual(pulseCounts(p, 'five'), { managers: 2, lineups: 2 });
});

test('v1: no invented total of people; per mode = one lineup per manager', () => {
  assert.equal(pulseCounts(v1), null);
  assert.deepEqual(pulseCounts(v1, 'full'), { managers: 2, lineups: 2 });
  assert.equal(pulseCounts(null), null);
});
