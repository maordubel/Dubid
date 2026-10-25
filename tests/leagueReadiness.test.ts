import test from 'node:test';
import assert from 'node:assert/strict';
import { leagueEnterable, type FormatReadiness } from '../src/lib/league.ts';

const f = (mode: 'five' | 'full', state: FormatReadiness['state']): FormatReadiness =>
  ({ mode, state, canSubmit: state !== 'blocked', reasons: [], checkedAt: '', dataUpdatedAt: null });

test('D04: ליגה ניתנת להכנסה כשלפחות פורמט אחד לא חסום', () => {
  assert.equal(leagueEnterable({ live: true, currentGameweek: 'gr-8', formats: { five: f('five', 'ready'), full: f('full', 'blocked') } }), true);
  assert.equal(leagueEnterable({ live: true, currentGameweek: 'gr-8', formats: { five: f('five', 'blocked'), full: f('full', 'blocked') } }), false);
});
test('D04: בלי מחזור או live=false — לא; formats חסר — לא חוסמים', () => {
  assert.equal(leagueEnterable({ live: true, currentGameweek: null, formats: null }), false);
  assert.equal(leagueEnterable({ live: false, currentGameweek: 'x', formats: null }), false);
  assert.equal(leagueEnterable({ live: true, currentGameweek: 'x' }), true);
});
test('D04: unknown לא נחשב חסום', () => {
  assert.equal(leagueEnterable({ live: true, currentGameweek: 'x', formats: { five: f('five', 'unknown'), full: f('full', 'unknown') } }), true);
});
