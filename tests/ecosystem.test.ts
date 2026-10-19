import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('boot wires the shared layer once: receiveHandoff + arrived', () => {
  const eco = src('src/lib/ecosystem.ts');
  assert.match(eco, /from '\.\.\/\.\.\/ecosystem\/sdk\.ts'/);
  assert.match(eco, /receiveHandoff\(client\)/);
  assert.match(eco, /arrived\(client, 'dubid'\)/);
  assert.match(eco, /arrivedFor/, 'guarded per identity');
  assert.match(src('src/main.tsx'), /bootEcosystem\(\);/);
});

test('promos send tracked links through createHandoff', () => {
  assert.match(src('src/lib/ecosystem.ts'), /createHandoff\(client, \{ from: 'dubid'/);
  for (const f of ['PromoBanner', 'OffsidesBanner', 'OffsidesAds', 'HouseAds']) {
    const s = src(`src/components/${f}.tsx`);
    assert.match(s, /import \{ trackedClick \} from '\.\.\/lib\/ecosystem\.ts'/, f);
    assert.match(s, /trackedClick\(e,/, f);
  }
});

test('campaign slug and target detection', async () => {
  const { campaignSlug, ecosystemTarget } = await import('../src/lib/ecosystem.ts');
  assert.equal(campaignSlug('dubid-promo', 'Offsides Live!'), 'dubid-promo-offsides-live');
  assert.ok(campaignSlug('x'.repeat(90)).length <= 60);
  assert.equal(ecosystemTarget('https://fanlife.dubelteam.com/clubs/aek'), 'fanlife');
  assert.equal(ecosystemTarget('https://offsides.dubelteam.com/?ref=dubid'), 'offsides');
  assert.equal(ecosystemTarget('https://takemeout.dubelteam.com'), null);
});

test('SSO: real accounts live in the shared cookie, guests stay local and are carried over', async () => {
  assert.match(src('src/lib/supabase.ts'), /storage: typeof window === 'undefined' \? undefined : ssoStorage\(\{ storageKey: 'dubid\.auth\.v1' \}\)/);
  const id = src('src/lib/identity.ts');
  assert.match(id, /export async function finishPendingMerge\(\): Promise<number> \{\n  await carryParkedGuest\(\);/);
  assert.match(id, /takeParkedGuest\('dubid\.auth\.v1'\)/);
  assert.match(id, /asGuest\.rpc\('issue_merge_token'\)/);
  const sdk = await import('../ecosystem/sdk.ts');
  const c: Record<string, string> = {};
  const jar = { read: () => ({ ...c }), write: (n: string, v: string, a: number) => { if (a === 0) delete c[n]; else c[n] = v; } };
  const m = new Map<string, string>();
  const local = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
  const s = sdk.ssoStorage({ storageKey: 'dubid.auth.v1', jar, local });
  s.setItem('dubid.auth.v1', JSON.stringify({ access_token: 'g', refresh_token: 'r', user: { id: 'g', is_anonymous: true } }));
  assert.deepEqual(c, {}, 'guest never enters the shared cookie');
  s.setItem('dubid.auth.v1', JSON.stringify({ access_token: 'a', refresh_token: 'r', user: { id: 'u', is_anonymous: false } }));
  assert.ok(c[sdk.SSO_COOKIE]?.startsWith('base64-'));
});
