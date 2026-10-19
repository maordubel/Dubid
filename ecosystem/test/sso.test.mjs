// node --experimental-strip-types ecosystem/test/sso.test.mjs  (from a repo that has @supabase/ssr)
// Proves the shared session cookie is byte-compatible with @supabase/ssr in both directions.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const sdk = await import('../sdk.ts')
const require = createRequire(import.meta.url)
let ssr = null
try { ssr = require(require.resolve('@supabase/ssr/dist/main/utils/index.js', { paths: [process.cwd()] })) } catch { /* optional */ }

function jar() {
  const c = {}
  return { c, read: () => ({ ...c }), write: (n, v, age) => { if (age === 0) delete c[n]; else c[n] = v } }
}
function mem() { const m = new Map(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) } }

const real = (n = 10) => JSON.stringify({ access_token: 'a'.repeat(n), refresh_token: 'r', user: { id: 'u1', is_anonymous: false, user_metadata: { name: 'מאור' } } })
const anon = JSON.stringify({ access_token: 'g', refresh_token: 'gr', user: { id: 'g1', is_anonymous: true } })

assert.equal(sdk.ssoCookieDomain('dubid.dubelteam.com'), '.dubelteam.com')
assert.equal(sdk.ssoCookieDomain('hapoel.fanlife.dubelteam.com'), '.dubelteam.com')
assert.equal(sdk.ssoCookieDomain('localhost'), undefined)
assert.equal(sdk.ssoCookieDomain('x.vercel.app'), undefined)

// guest stays local, never in the cookie
{ const j = jar(), l = mem(); const s = sdk.ssoStorage({ storageKey: 'k', jar: j, local: l })
  s.setItem('k', anon); assert.deepEqual(j.c, {}); assert.equal(s.getItem('k'), anon) }

// real session goes to the cookie, local copy removed; small and chunked
for (const size of [10, 9000]) {
  const j = jar(), l = mem(); const s = sdk.ssoStorage({ storageKey: 'k', jar: j, local: l })
  s.setItem('k', real(size)); assert.equal(l.getItem('k'), null); assert.equal(s.getItem('k'), real(size))
  const names = Object.keys(j.c); assert.ok(size > 3000 ? names.every((n) => /\.\d$/.test(n)) && names.length > 1 : names.length === 1)
  assert.ok(Object.values(j.c).every((v) => v.length <= 3180))
  if (ssr) { // @supabase/ssr decodes what we wrote
    const joined = names.length === 1 ? j.c[sdk.SSO_COOKIE] : names.sort().map((n) => j.c[n]).join('')
    assert.equal(ssr.stringFromBase64URL(joined.slice('base64-'.length)), real(size))
  }
  // shrinking removes stale chunks
  s.setItem('k', real(10)); assert.deepEqual(Object.keys(j.c), [sdk.SSO_COOKIE])
  s.removeItem('k'); assert.deepEqual(j.c, {})
}

// we read what @supabase/ssr wrote
if (ssr) { const j = jar(); j.c[sdk.SSO_COOKIE] = 'base64-' + ssr.stringToBase64URL(real()); assert.equal(sdk.readSsoCookie(j), real()) }

// a real account elsewhere parks the local guest
{ const j = jar(), l = mem(); const s = sdk.ssoStorage({ storageKey: 'k', jar: j, local: l })
  s.setItem('k', anon); j.c[sdk.SSO_COOKIE] = 'base64-' + Buffer.from(real()).toString('base64url')
  assert.equal(s.getItem('k'), real()); assert.equal(l.getItem('k'), null); assert.equal(l.getItem('k.guest'), anon)
  // PKCE verifier and other keys stay local
  s.setItem('k-code-verifier', 'v'); assert.equal(l.getItem('k-code-verifier'), 'v') }

console.log('sso: ok' + (ssr ? ' (cross-checked with @supabase/ssr)' : ''))
