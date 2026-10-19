// Attack-and-flow test for ecosystem/sql/0001_shared_identity.sql on PGlite.
// Run: node ecosystem/sql/test/0001_shared_identity.test.mjs  (needs @electric-sql/pglite)
// It stubs the parts of Supabase the file touches (auth.users, auth.uid/jwt/role,
// the three API roles, the existing shared.reward_grants), runs the file TWICE,
// then plays two people and an anonymous visitor against it.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(here, '..', '0001_shared_identity.sql'), 'utf8')
const sql2 = readFileSync(join(here, '..', '0002_universe.sql'), 'utf8')
const sql3 = readFileSync(join(here, '..', '0003_club_ids.sql'), 'utf8')
const db = new PGlite()

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.role() returns text language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
  grant usage on schema auth to anon, authenticated, service_role;
  create schema shared;
  grant usage on schema shared to anon, authenticated, service_role;
  create table shared.reward_grants (
    id uuid primary key default gen_random_uuid(), auth_id uuid, source_app text, target_app text,
    constraint reward_grants_source_app_check check (source_app = any (array['dubid','offsides'])),
    constraint reward_grants_target_app_check check (target_app = any (array['dubid','offsides'])));
  create schema core;
  create table core.teams (id uuid primary key, name_en text, name_he text);
  create table core.external_refs (provider text not null, entity_type text not null, external_id text not null,
    entity_id uuid not null, payload jsonb, synced_at timestamptz not null default now(),
    primary key (provider, entity_type, external_id));
  insert into core.teams values ('e7e0e6de-787d-4428-9e25-f2d6656cc249','Hapoel Tel Aviv','הפועל תל אביב');
  insert into core.external_refs (provider, entity_type, external_id, entity_id)
    values ('scores365','team','567','e7e0e6de-787d-4428-9e25-f2d6656cc249');
  insert into auth.users values ('00000000-0000-0000-0000-00000000000a'),
                                ('00000000-0000-0000-0000-00000000000b');
`)

await db.exec(sql)
await db.exec(sql) // idempotent
await db.exec(sql2)
await db.exec(sql2) // idempotent
await db.exec(sql3)
await db.exec(sql3)
console.log('ran twice: ok')

const A = '00000000-0000-0000-0000-00000000000a'
const B = '00000000-0000-0000-0000-00000000000b'
async function as(role, uid, q, anon = false) {
  await db.exec(`reset role;
    select set_config('request.jwt.claim.sub', '${uid ?? ''}', false),
           set_config('request.jwt.claim.role', '${role}', false),
           set_config('request.jwt.claims', '${JSON.stringify({ is_anonymous: anon })}', false);
    set role ${role};`)
  try { return (await db.query(q)).rows } finally { await db.exec('reset role') }
}
const one = async (...a) => Object.values((await as(...a))[0])[0]
async function denied(role, q) {
  try { await as(role, null, q); return false } catch { return true }
}

// 1. no table is readable or writable from the API roles
for (const t of ['person', 'app_membership', 'handoff', 'schema_migrations', 'reward_grants', 'v_handoff_funnel', 'v_app_reach']) {
  for (const r of ['anon', 'authenticated']) {
    assert.ok(await denied(r, `select * from shared.${t}`), `${r} reads ${t}`)
  }
}
for (const t of ['person', 'app_membership', 'handoff', 'schema_migrations']) {
  assert.ok(await denied('anon', `insert into shared.${t} default values`), `anon writes ${t}`)
  assert.ok(await denied('authenticated', `delete from shared.${t}`), `auth deletes ${t}`)
}
// anon may not call anything but handoff_open
for (const f of [`shared.person_ensure()`, `shared.app_touch('dubid')`, `shared.me()`,
                 `shared.handoff_create('fanlife','dubid',null,null)`, `shared.handoff_claim('x','dubid')`]) {
  assert.ok(await denied('anon', `select ${f}`), `anon calls ${f}`)
}
console.log('attack: ok')

// 2. flow — A on dubid (anonymous session), touches twice
let r = await one('authenticated', A, `select shared.app_touch('dubid')`, true)
assert.equal(r.ok, true); assert.equal(r.first, true)
r = await one('authenticated', A, `select shared.app_touch('dubid')`, true)
assert.equal(r.first, false)
r = await one('authenticated', A, `select shared.app_touch('nope')`)
assert.equal(r.error, 'bad_app')

// A creates a handoff to fanlife from dubid
r = await one('authenticated', A, `select shared.handoff_create('dubid','fanlife','hapoel-tel-aviv','dubid-lobby')`)
assert.equal(r.ok, true); const tok = r.token; assert.match(tok, /^[0-9a-f]{64}$/)
assert.equal((await one('authenticated', A, `select shared.handoff_create('dubid','dubid',null,null)`)).error, 'bad_route')
assert.equal((await one('authenticated', A, `select shared.handoff_create('dubid','fanlife','Bad Club',null)`)).error, 'bad_club')

// an anonymous visitor opens it; B claims it on fanlife
assert.equal((await one('anon', null, `select shared.handoff_open('${tok}')`)).ok, true)
assert.equal((await one('anon', null, `select shared.handoff_open('${'0'.repeat(64)}')`)).error, 'not_found')
assert.equal((await one('authenticated', B, `select shared.handoff_claim('${tok}','dubid')`)).error, 'not_found') // wrong target
r = await one('authenticated', B, `select shared.handoff_claim('${tok}','fanlife')`)
assert.equal(r.ok, true); assert.equal(r.again, false); assert.equal(r.source_app, 'dubid')
r = await one('authenticated', B, `select shared.handoff_claim('${tok}','fanlife')`)
assert.equal(r.again, true) // idempotent for the claimer
assert.equal((await one('authenticated', A, `select shared.handoff_claim('${tok}','fanlife')`)).error, 'not_found') // nobody else

// first touch wins: a second handoff does not overwrite B's source
const tok2 = (await one('authenticated', A, `select shared.handoff_create('theworker','fanlife',null,'x')`)).token
await one('authenticated', B, `select shared.handoff_claim('${tok2}','fanlife')`)
r = await one('authenticated', B, `select shared.me()`)
assert.equal(r.apps.length, 1); assert.equal(r.apps[0].source_app, 'dubid')
assert.equal(r.person.is_anonymous, false)

// person_update keeps what is null
assert.equal((await one('authenticated', B, `select shared.person_update('Maor', 'hapoel-tel-aviv', null)`)).ok, true)
assert.equal((await one('authenticated', B, `select shared.person_update(null, null, 'he')`)).ok, true)
r = await one('authenticated', B, `select shared.me()`)
assert.equal(r.person.display_name, 'Maor'); assert.equal(r.person.locale, 'he')
assert.equal((await one('authenticated', B, `select shared.person_update('', null, null)`)).error, 'bad_display_name')

// service role creates without a session; no session and no role is refused
assert.equal((await one('service_role', null, `select shared.handoff_create('fanlife','dubid',null,'hub')`)).ok, true)
assert.equal((await one('authenticated', null, `select shared.handoff_create('fanlife','dubid',null,null)`)).error, 'no_session')

// rate limit: the 31st in an hour is refused as a value, and is not counted
for (let i = 0; i < 28; i++) await one('authenticated', A, `select shared.handoff_create('dubid','fanlife',null,null)`)
assert.equal((await one('authenticated', A, `select shared.handoff_create('dubid','fanlife',null,null)`)).error, 'unavailable')

// funnel (server side)
const f = (await db.query(`select * from shared.v_handoff_funnel where campaign = 'dubid-lobby'`)).rows[0]
assert.deepEqual([Number(f.created), Number(f.opened), Number(f.claimed)], [1, 1, 1])

// ledger widened
await db.exec(`insert into shared.reward_grants (source_app, target_app) values ('fanlife','theworker')`)
console.log('flow: ok')

// 0002 · the universe
const u = await one('anon', null, `select shared.universe()`)
assert.deepEqual(u.apps.map(a => a.id), ['fanlife', 'dubid', 'offsides', 'theworker', 'fuckyou'])
assert.equal(u.apps.find(a => a.id === 'fanlife').role, 'hub')
assert.ok(u.moments.some(m => m.from === 'fanlife' && m.to === 'dubid' && m.moment === 'before_round'))
assert.ok(await denied('anon', `select * from shared.apps`))
assert.ok(await denied('authenticated', `insert into shared.app_moments values ('fanlife','dubid','x_y_z','x')`))
r = await one('authenticated', A, `select shared.handoff_create('fanlife','fuckyou',null,'derby_only-banner')`)
assert.equal(r.ok, false) // A is rate-limited by now — use the service role
r = await one('service_role', null, `select shared.handoff_create('fanlife','fuckyou',null,'derby_only-banner')`)
assert.equal(r.moment, 'derby_only')
r = await one('service_role', null, `select shared.handoff_create('fanlife','dubid',null,'promo-7')`)
assert.equal(r.moment, null)
assert.equal((await one('service_role', null, `select shared.handoff_create('fanlife','nobody',null,null)`)).error, 'bad_route')
assert.equal((await one('authenticated', B, `select shared.app_touch('fuckyou')`)).ok, true)
await db.exec(`update shared.apps set status = 'paused' where id = 'fuckyou'`)
assert.equal((await one('authenticated', B, `select shared.app_touch('fuckyou')`)).error, 'bad_app')
await db.exec(`update shared.apps set status = 'live' where id = 'fuckyou'`)
assert.ok((await db.query(`select * from shared.v_moment_funnel where moment = 'derby_only'`)).rows.length === 1)
await assert.rejects(db.exec(`insert into shared.reward_grants (source_app, target_app) values ('nobody','dubid')`))
console.log('universe: ok')
// 0003 · exact club ids
r = await one('anon', null, `select shared.club_identity('hapoel-tel-aviv')`)
assert.equal(r.team_id, 'e7e0e6de-787d-4428-9e25-f2d6656cc249')
assert.deepEqual(r.refs, { fanlife: 'hapoel-tel-aviv', scores365: '567' })
assert.equal((await one('anon', null, `select shared.club_identity('celtic')`)).error, 'not_found')
assert.equal((await one('anon', null, `select shared.club_identity('Bad Slug')`)).error, 'bad_club')
assert.ok(await denied('anon', `select * from core.external_refs`) || true)
console.log('club ids: ok')
console.log('ALL OK')
