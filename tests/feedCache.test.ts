/**
 * tests/feedCache.test.ts — ecosystem/feed/cache.ts: one fetch for two apps, one budget, stale-if-error.
 * The store here is an in-memory twin of ecosystem/sql/0005_feed_cache.sql (the SQL itself is
 * tested on PGlite in ecosystem/sql/test/shared.test.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalKey, canonicalUrl, sharedHttp, type CachePolicy, type FeedStore } from '../ecosystem/feed/cache.ts';

function memStore(perMinuteCap = 1000) {
  const rows = new Map<string, { payload: unknown; at: number; ttl: number; claimed: number }>();
  let used = 0;
  let now = 0;
  const store: FeedStore = {
    async read(key) {
      const r = rows.get(key);
      if (!r || r.payload === undefined) return null;
      const age = (now - r.at) / 1000;
      return { payload: r.payload, age_s: age, fresh: age < r.ttl };
    },
    async begin(key) {
      const r = rows.get(key);
      if (r && r.claimed > now) return 'wait';
      if (used >= perMinuteCap) return 'over_budget';
      used++;
      rows.set(key, { payload: r?.payload, at: r?.at ?? 0, ttl: r?.ttl ?? 0, claimed: now + 8000 });
      return 'fetch';
    },
    async write(key, _s, payload, ttl) { rows.set(key, { payload, at: now, ttl, claimed: 0 }); },
  };
  return { store, tick: (ms: number) => { now += ms; }, used: () => used };
}

const policy: CachePolicy = { ttl: () => 20, perMinute: () => 1000, staleMaxSec: 3600 };
const GAME = 'https://webws.365scores.com/web/game/?appTypeId=5&langId=1&timezoneName=Asia/Jerusalem&gameId=7';
const GAME_OFFSIDES = 'https://webws.365scores.com/web/game/?gameId=7&langId=1&appTypeId=5&timezoneName=Europe/Athens';

test('the same request from two apps (different param order and time zone) is one key', () => {
  assert.equal(canonicalKey(GAME), canonicalKey(GAME_OFFSIDES));
  assert.equal(canonicalKey(GAME), 'webws.365scores.com/web/game?appTypeId=5&gameId=7&langId=1');
  assert.match(canonicalUrl(GAME), /timezoneName=UTC/);
});

test('a language is part of the key — names differ per language', () => {
  assert.notEqual(canonicalKey(GAME), canonicalKey(GAME.replace('langId=1', 'langId=2')));
});

test('two apps inside the TTL → one real request', async () => {
  const m = memStore();
  let calls = 0;
  const inner = async () => { calls++; return { game: { id: 7 } }; };
  const dubid = sharedHttp(inner, m.store, 'dubid', policy);
  const offsides = sharedHttp(inner, m.store, 'offsides', policy);
  assert.deepEqual(await dubid(GAME), { game: { id: 7 } });
  m.tick(5000);
  assert.deepEqual(await offsides(GAME_OFFSIDES), { game: { id: 7 } });
  assert.equal(calls, 1);
  m.tick(30_000);
  await offsides(GAME_OFFSIDES);
  assert.equal(calls, 2, 'after the TTL the copy is refreshed');
});

test('source down → the last good copy, not nothing', async () => {
  const m = memStore();
  let up = true;
  const inner = async () => { if (!up) throw new Error('HTTP 503'); return { game: { id: 7, v: 1 } }; };
  const http = sharedHttp(inner, m.store, 'offsides', policy);
  await http(GAME);
  m.tick(60_000); up = false;
  assert.deepEqual(await http(GAME), { game: { id: 7, v: 1 } });
});

test('budget spent → the last copy; nothing cached → a clear error', async () => {
  const m = memStore(1);
  const inner = async () => ({ ok: 1 });
  const http = sharedHttp(inner, m.store, 'dubid', policy);
  await http(GAME);
  m.tick(60_000);
  assert.deepEqual(await http(GAME), { ok: 1 });
  await assert.rejects(http(GAME.replace('gameId=7', 'gameId=8')), /budget/);
});

test('a broken store never blocks a read', async () => {
  const broken: FeedStore = {
    read: async () => { throw new Error('db down'); },
    begin: async () => { throw new Error('db down'); },
    write: async () => { throw new Error('db down'); },
  };
  const http = sharedHttp(async () => ({ ok: 2 }), broken, 'dubid', policy);
  assert.deepEqual(await http(GAME), { ok: 2 });
});
