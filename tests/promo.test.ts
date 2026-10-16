import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eligible, pageOf, outbound } from '../src/lib/promo/rules.ts';
import { SEED_DOC } from '../src/lib/promo/seed.ts';

const page = pageOf(null, '/dubid');
const now = Date.parse('2026-10-17T12:00:00Z');

test('DUBID never advertises itself, shows the other apps and the FAN LIFE features', () => {
  const ids = eligible(SEED_DOC, page, now, { israel: true }).map((b) => b.id).sort();
  assert.ok(!ids.includes('dubid'));
  for (const id of ['offsides', 'takemeout', 'fuckyou', 'manager', 'market', 'life']) assert.ok(ids.includes(id), id);
});
test('links carry dubid as the source', () => {
  const b = SEED_DOC.banners.find((x) => x.id === 'offsides')!;
  assert.match(outbound(b, page), /utm_source=dubid/);
});
test('the control-room kill switch is honoured', () => {
  assert.deepEqual(eligible({ ...SEED_DOC, settings: { ...SEED_DOC.settings, enabled: false } }, page, now, { israel: true }), []);
});
test('every banner image ships with the app', async () => {
  const { existsSync } = await import('node:fs');
  for (const b of SEED_DOC.banners) for (const i of [b.img1x, b.img2x]) assert.ok(existsSync(`public${i}`), i);
});
