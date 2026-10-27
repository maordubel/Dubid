// ecosystem/feed — byte-identical in every repo of the universe; owned by the contract; no provider field name outside its adapter file
/**
 * ecosystem/feed/cache.ts — one shared read-through cache + one shared rate budget
 * for every app that reads a free football source (DUBID · OFFSIDES · FAN LIFE).
 *
 * Why: two apps polling the same free host for the same game burn the same free
 * allowance twice and invite a block. With this wrapper:
 *   1. The same request (canonical URL) is fetched ONCE; every app reads the copy
 *      from core.feed_cache until its TTL runs out.
 *   2. Only one caller refreshes a key at a time (a short claim); the others get the
 *      previous copy or wait a moment for the fresh one.
 *   3. All apps together stay under one per-host budget (requests / minute).
 *   4. When the source fails or the budget is spent, the last good copy is served
 *      (stale-if-error) instead of nothing — "late but correct" beats "missing".
 *
 * Pure TypeScript, no dependencies: the store is three RPCs on the shared schema
 * (ecosystem/sql/0005_feed_cache.sql), passed in by the app.
 */
import type { Http } from './types.ts';

/** The three shared RPCs. `rpc` is the app's own supabase client call on schema `shared`. */
export interface FeedStore {
  read(key: string): Promise<{ payload: unknown; age_s: number; fresh: boolean } | null>;
  begin(key: string, host: string, perMinute: number, app: string): Promise<'fetch' | 'wait' | 'over_budget'>;
  write(key: string, source: string, payload: unknown, ttlSec: number, app: string): Promise<void>;
}

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>;

/** FeedStore on top of the shared RPCs. */
export function supabaseFeedStore(rpc: Rpc): FeedStore {
  return {
    async read(key) {
      const { data, error } = await rpc('feed_cache_read', { p_key: key });
      if (error || !data || data.payload === undefined || data.payload === null) return null;
      return { payload: data.payload, age_s: Number(data.age_s ?? 0), fresh: data.fresh === true };
    },
    async begin(key, host, perMinute, app) {
      const { data, error } = await rpc('feed_cache_begin', { p_key: key, p_host: host, p_per_minute: perMinute, p_app: app });
      if (error) return 'fetch'; // the cache is an optimisation: never block a read on it
      return data === 'wait' || data === 'over_budget' ? data : 'fetch';
    },
    async write(key, source, payload, ttlSec, app) {
      await rpc('feed_cache_write', { p_key: key, p_source: source, p_payload: payload, p_ttl_s: Math.max(5, Math.round(ttlSec)), p_app: app });
    },
  };
}

/**
 * Same request = same key, whoever asks. Query params are sorted, and the time zone
 * is dropped (every adapter parses kick-offs as ISO with an offset, so the zone is
 * presentation only). The language stays: names differ per language.
 */
export function canonicalKey(raw: string): string {
  try {
    const u = new URL(raw);
    const ps = [...u.searchParams.entries()]
      .filter(([k]) => k.toLowerCase() !== 'timezonename')
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const q = ps.map(([k, v]) => `${k}=${v}`).join('&');
    return `${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}${q ? '?' + q : ''}`;
  } catch {
    return raw;
  }
}

/** The URL actually fetched: the canonical form, in UTC, so every app asks the exact same thing. */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.searchParams.has('timezoneName')) u.searchParams.set('timezoneName', 'UTC');
    return u.toString();
  } catch {
    return raw;
  }
}

export interface CachePolicy {
  /** seconds a copy is fresh; may look at the payload (a finished game never changes) */
  ttl(url: URL, payload: any): number;
  /** shared requests / minute allowed against this host, all apps together */
  perMinute(host: string): number;
  /** a copy older than this is never served, even as a fallback */
  staleMaxSec: number;
}

const finished365 = (g: any) => g && (Number(g.statusGroup) === 4 || g.gameTimeAndStatusDisplayType === 1);
const live365 = (g: any) => g && Number(g.statusGroup) === 3;

/** Defaults tuned for the free sources the universe uses today. */
export const DEFAULT_POLICY: CachePolicy = {
  ttl(url, p) {
    const path = url.pathname;
    if (url.host.includes('365scores')) {
      // Sportradar play-by-play relayed by 365scores (timed corners / offsides)
      if (url.host.startsWith('sportradarpbp.')) return /isfinished=true/i.test(url.search) ? 6 * 3600 : 60;
      if (/\/game\/stats\/?$/.test(path)) {
        const g = Array.isArray(p?.games) ? p.games[0] : null;
        return finished365(g) ? 6 * 3600 : live365(g) ? 45 : 300;
      }
      if (/\/game\/?$/.test(path)) {
        const g = p?.game;
        return finished365(g) ? 6 * 3600 : live365(g) ? 20 : 120;
      }
      if (/\/games\/(fixtures|results|current)\/?$/.test(path)) return 300;
      if (/\/standings\/?$/.test(path)) return 1800;
      if (/\/search\/?$/.test(path)) return 86400;
      return 120;
    }
    if (url.host.includes('espn.com')) {
      if (/\/summary\/?$/.test(path)) {
        const st = p?.header?.competitions?.[0]?.status?.type;
        return st?.completed ? 6 * 3600 : st?.state === 'in' ? 30 : 300;
      }
      if (/\/scoreboard\/?$/.test(path)) return 60;
      return 600;
    }
    return 60;
  },
  perMinute(host) {
    if (host.includes('365scores')) return 90;
    if (host.includes('espn.com')) return 60;
    if (host.includes('sofascore')) return 20;
    return 30;
  },
  staleMaxSec: 3 * 86400,
};

const cacheSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wrap an app's own Http with the shared cache. Same signature in, same out —
 * every adapter keeps working unchanged.
 */
export function sharedHttp(inner: Http, store: FeedStore, app: string, policy: CachePolicy = DEFAULT_POLICY): Http {
  return async function cached(raw: string): Promise<any> {
    const url = canonicalUrl(raw);
    const key = canonicalKey(url);
    let u: URL;
    try { u = new URL(url); } catch { return inner(raw); }

    let prev: { payload: unknown; age_s: number; fresh: boolean } | null = null;
    try { prev = await store.read(key); } catch { prev = null; }
    if (prev?.fresh) return prev.payload;

    let verdict: 'fetch' | 'wait' | 'over_budget' = 'fetch';
    try { verdict = await store.begin(key, u.host, policy.perMinute(u.host), app); } catch { verdict = 'fetch'; }

    if (verdict !== 'fetch') {
      const usable = prev && prev.age_s <= policy.staleMaxSec ? prev.payload : null;
      // someone else is refreshing this exact key right now: a recent copy is good enough
      if (verdict === 'wait' && usable !== null) return usable;
      if (verdict === 'wait') {
        // nothing to fall back on: give them a moment
        for (let i = 0; i < 4; i++) {
          await cacheSleep(700);
          try {
            const again = await store.read(key);
            if (again?.fresh) return again.payload;
          } catch { /* keep waiting */ }
        }
      }
      if (usable !== null) return usable;
      if (verdict === 'over_budget') throw new Error(`feed budget spent for ${u.host}`);
      // waited and nothing arrived: fetch ourselves
    }

    try {
      const payload = await inner(url);
      try { await store.write(key, u.host, payload, policy.ttl(u, payload), app); } catch { /* cache write is best-effort */ }
      return payload;
    } catch (err) {
      if (prev && prev.age_s <= policy.staleMaxSec) return prev.payload; // stale-if-error
      throw err;
    }
  };
}
