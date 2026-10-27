/**
 * tests/connectedLanding.test.ts — Connected Football audit (27.10.2026): CF-07 (a failed read keeps the intent),
 * CF-04 (format / gw are a landing hint, never a failure), the way back (lang + src) and the outcome report.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  __resetIncomingForTests, backContext, backLink, incomingLanding, incomingLeague, parseIncomingLink, planLanding,
  resolveIncoming, retryIncoming, stayInCurrentLeague, takeIncomingLeague, waitForIncoming, type PublicLeague, type FormatReadiness,
} from '../src/lib/league.ts';

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const L = (code: string, o: Partial<PublicLeague> = {}): PublicLeague => ({ code, country: 'XX', locale: 'en', dir: 'ltr', timezone: 'UTC', names: { en: { full: code } }, primary: code === 'IL_PREMIER', currentGameweek: 'gw-1', live: true, ...o });
const F = (canSubmit: boolean, state: FormatReadiness['state'] = canSubmit ? 'ready' : 'blocked'): FormatReadiness => ({ mode: 'five', state, canSubmit, reasons: [], checkedAt: '', dataUpdatedAt: null });
const all = [L('IL_PREMIER'), L('GR_SUPER', { currentGameweek: 'gr-gw-8', round: 8, status: 'open' })];

/* a browser-ish stage: an address, a history, and a session store that may be blocked */
function stage(url: string, blocked = false) {
  const store = new Map<string, string>();
  const ss = {
    getItem: (k: string) => { if (blocked) throw new Error('blocked'); return store.get(k) ?? null; },
    setItem: (k: string, v: string) => { if (blocked) throw new Error('blocked'); store.set(k, v); },
    removeItem: (k: string) => { if (blocked) throw new Error('blocked'); store.delete(k); },
  };
  const loc = { href: url };
  (globalThis as any).sessionStorage = ss;
  (globalThis as any).window = { location: loc, history: { state: null, replaceState: (_s: unknown, _t: string, u: string) => { loc.href = new URL(u, url).href; } } };
  return { store, loc };
}
beforeEach(() => __resetIncomingForTests());

test('parse: the new contract, every param validated', () => {
  const p = parseIncomingLink(new URLSearchParams('league=GR_SUPER&format=five&gw=gr-gw-8&from=fanlife&club=olympiacos&lang=el&src=club'));
  assert.equal(p.league, 'GR_SUPER');
  assert.deepEqual(p.landing, { league: 'GR_SUPER', format: 'five', gw: 'gr-gw-8' });
  assert.deepEqual(p.back, { club: 'olympiacos', lang: 'el', src: 'club' });
  const bad = parseIncomingLink(new URLSearchParams('league=gr&format=seven&gw=<x>&from=fanlife&club=Bad_Club&lang=fr&src=evil'));
  assert.equal(bad.league, null);
  assert.equal(bad.landing, null);
  assert.deepEqual(bad.back, { club: null, lang: 'en', src: null });
  assert.equal(parseIncomingLink(new URLSearchParams('club=aek')).back, null, 'no from=fanlife, no way back');
});

test('old links (league/from/club only) keep working', () => {
  const { loc } = stage('https://dubid.dubelteam.com/?league=GR_SUPER&from=fanlife&club=aek-athens#x');
  takeIncomingLeague();
  assert.equal(loc.href, 'https://dubid.dubelteam.com/#x', 'stripped, hash kept');
  assert.equal(incomingLeague(), 'GR_SUPER');
  assert.equal(incomingLanding(), null);
  assert.deepEqual(backLink(backContext()), { href: 'https://fanlife.dubelteam.com/clubs/aek-athens?lang=en', club: 'aek-athens' });
});

test('an old plain-slug back value in the tab store is still read', () => {
  const { store } = stage('https://dubid.dubelteam.com/');
  store.set('ui.fanlife.back', 'hapoel-tel-aviv');
  assert.equal(backContext()?.club, 'hapoel-tel-aviv');
});

test('blocked storage: the intent lives in memory', () => {
  stage('https://dubid.dubelteam.com/?league=GR_SUPER&format=full&gw=gr-gw-8&from=fanlife&src=hub&lang=he', true);
  takeIncomingLeague();
  assert.equal(incomingLeague(), 'GR_SUPER');
  assert.equal(incomingLanding()?.format, 'full');
  assert.deepEqual(backLink(backContext()), { href: 'https://fanlife.dubelteam.com/?lang=he', club: null });
});

test('back link: club page with lang; hub (or no club) goes home', () => {
  assert.equal(backLink(null), null);
  assert.equal(backLink({ club: 'celtic', lang: 'en', src: 'gate' })?.href, 'https://fanlife.dubelteam.com/clubs/celtic?lang=en');
  assert.equal(backLink({ club: 'celtic', lang: 'he', src: 'hub' })?.href, 'https://fanlife.dubelteam.com/?lang=he');
  assert.equal(backLink({ club: null, lang: 'el', src: null })?.href, 'https://fanlife.dubelteam.com/?lang=el');
});

test('CF-07: a failed read keeps the intent and a retry asks again for the same league', async () => {
  stage('https://dubid.dubelteam.com/?league=GR_SUPER');
  takeIncomingLeague();
  let calls = 0; let ok = false; const chosen: string[] = [];
  const deps = {
    fetch: async () => { calls++; return ok ? { ok: true as const, leagues: all } : { ok: false as const }; },
    choose: (c: string | null) => { chosen.push(String(c)); },
    chosen: () => false, selected: () => null,
  };
  assert.equal((await resolveIncoming(deps)).kind, 'error');
  assert.equal(incomingLeague(), 'GR_SUPER', 'the intent is not destroyed');
  ok = true;
  assert.equal((await retryIncoming(deps)).kind, 'switching');
  assert.deepEqual(chosen, ['GR_SUPER']);
  assert.equal(calls, 2);
});

test('CF-07: an empty catalog (a real answer) is not an error', async () => {
  stage('https://dubid.dubelteam.com/?league=GR_SUPER');
  takeIncomingLeague();
  const s = await resolveIncoming({ fetch: async () => ({ ok: true, leagues: [] }), choose: () => assert.fail('no switch') });
  assert.equal(s.kind, 'none');
  assert.equal(incomingLeague(), null);
});

test('CF-07: a hung read never holds the boot; a player of another league is asked', async () => {
  stage('https://dubid.dubelteam.com/?league=GR_SUPER');
  takeIncomingLeague();
  const hung = await waitForIncoming(20, { fetch: () => new Promise(() => {}) });
  assert.equal(hung.kind, 'pending');
  __resetIncomingForTests();
  stage('https://dubid.dubelteam.com/?league=GR_SUPER&format=five');
  takeIncomingLeague();
  const s = await waitForIncoming(1000, { fetch: async () => ({ ok: true, leagues: all }), chosen: () => true, selected: () => null });
  assert.equal(s.kind, 'ask');
  stayInCurrentLeague();
  assert.equal(incomingLeague(), null);
  assert.equal(incomingLanding(), null, 'staying drops the other league\'s format/round');
});

test('CF-07: the boot waits for the decision before hydrating', () => {
  const app = src('src/App.tsx');
  const i = app.indexOf('waitForIncoming(2500)');
  assert.ok(i > 0 && i < app.indexOf('await hydrateLiveData(force)'));
  assert.match(app, /if \(switching\) return;/);
});

test('CF-04: format opens its builder; a closed one lands on the open one, with one line', () => {
  const open = L('GR_SUPER', { formats: { five: F(true), full: F(true) } });
  assert.deepEqual(planLanding({ league: null, format: 'five', gw: null }, open), { mode: 'five', notes: [] });
  assert.deepEqual(planLanding({ league: null, format: 'full', gw: null }, open), { mode: 'full', notes: [] });
  assert.deepEqual(planLanding({ league: null, format: 'any', gw: 'gw-1' }, open), { mode: null, notes: [] });
  const fiveClosed = L('GR_SUPER', { formats: { five: F(false), full: F(true) } });
  assert.deepEqual(planLanding({ league: null, format: 'five', gw: null }, fiveClosed),
    { mode: 'full', notes: [{ key: 'landing.formatSwitched', wanted: 'five', open: 'full' }] });
  const unknown = L('GR_SUPER', { formats: { five: F(false, 'unknown'), full: F(true) } });
  assert.equal(planLanding({ league: null, format: 'five', gw: null }, unknown).mode, 'five', 'unknown is not closed');
  assert.equal(planLanding({ league: null, format: 'five', gw: null }, null).mode, 'five', 'no catalog: still lands');
});

test('CF-04: a changed round lands on the current one and says so — never invents a number', () => {
  const g = (o: Partial<PublicLeague>) => L('GR_SUPER', { currentGameweek: 'gr-gw-9', ...o });
  assert.deepEqual(planLanding({ league: null, format: null, gw: 'gr-gw-8' }, g({ round: 9, status: 'open' })).notes, [{ key: 'landing.roundOpen', round: 9 }]);
  assert.deepEqual(planLanding({ league: null, format: null, gw: 'gr-gw-8' }, g({ round: 9, status: 'locked' })).notes, [{ key: 'landing.roundLocked', round: 9 }]);
  assert.deepEqual(planLanding({ league: null, format: null, gw: 'gr-gw-8' }, g({ round: null, status: 'open' })).notes, [{ key: 'landing.roundChanged' }]);
  assert.deepEqual(planLanding({ league: null, format: null, gw: 'gr-gw-9' }, g({ round: 9, status: 'open' })).notes, []);
});

test('outcome: one fire-and-forget report after a confirmed line-up', () => {
  const app = src('src/App.tsx');
  const ok = app.indexOf("track('lineup_submitted', ctx)");
  const rep = app.indexOf("reportDubidOutcome('lineup_submitted')");
  assert.ok(ok > 0 && rep > ok && rep < app.indexOf('onSaved(saved)', ok));
  assert.match(src('src/lib/ecosystem.ts'), /reportOutcome\(client, 'dubid', outcome\)\)\.catch\(\(\) => \{\}\)/);
});

test('the shared layer copy carries reportOutcome', async () => {
  const sdk = await import('../ecosystem/sdk.ts');
  const calls: unknown[] = [];
  const client = { schema: () => ({ rpc: async (fn: string, args: unknown) => { calls.push([fn, args]); return { data: { ok: true, recorded: true }, error: null }; } }) };
  await sdk.reportOutcome(client as any, 'dubid', 'lineup_submitted');
  assert.deepEqual(calls, [['handoff_outcome', { p_app: 'dubid', p_outcome: 'lineup_submitted' }]]);
});
