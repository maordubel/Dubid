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
