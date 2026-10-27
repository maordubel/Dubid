/**
 * tests/incomingLeague.test.ts — Connected Football (FAN LIFE, 27.10.2026): a link may name a league; nothing switches silently.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { incomingDecision, type PublicLeague } from '../src/lib/league.ts';

const L = (code: string, o: Partial<PublicLeague> = {}): PublicLeague => ({ code, country: 'XX', locale: 'en', dir: 'ltr', timezone: 'UTC', names: { en: { full: code } }, primary: code === 'IL_PREMIER', currentGameweek: 'gw-1', live: true, ...o });
const all = [L('IL_PREMIER'), L('GR_SUPER'), L('EN_PL', { live: false, currentGameweek: null })];

test('a first visit takes the league it came for', () => {
  assert.equal(incomingDecision('GR_SUPER', all, false, null).kind, 'choose');
});
test('a player of another league is asked, never switched', () => {
  assert.equal(incomingDecision('GR_SUPER', all, true, null).kind, 'ask');
});
test('the league already played, an unknown code, or a league without a round: nothing', () => {
  assert.equal(incomingDecision('GR_SUPER', all, true, 'GR_SUPER').kind, 'none');
  assert.equal(incomingDecision('IL_PREMIER', all, true, null).kind, 'none');
  assert.equal(incomingDecision('XX_NOPE', all, false, null).kind, 'none');
  assert.equal(incomingDecision('EN_PL', all, false, null).kind, 'none');
  assert.equal(incomingDecision(null, all, false, null).kind, 'none');
});
