/**
 * tests/standings365.test.ts — מתאם טבלת הליגה של 365scores.
 * ★ הכלל: שורה פגומה נזרקת; המסד דוחה טבלה חלקית → אין טבלה, לא טבלה שגויה.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse365Standings, standingsUrl } from '../supabase/functions/dubid-ingest/_src/standings.ts';

const row = (id: number, pos: number, w: number, d: number, l: number, pts: number) => ({
  competitor: { id, name: `T${id}` }, position: pos,
  gamePlayed: w + d + l, gamesWon: w, gamesEven: d, gamesLost: l,
  for: 10 + w, against: 5 + l, points: pts,
});

test('picks the table of the competition and maps fields', () => {
  const rows = parse365Standings({
    standings: [
      { competitionId: 84, rows: [row(1023, 2, 5, 2, 1, 17), row(1024, 1, 6, 1, 1, 19)] },
      { competitionId: 99, rows: [row(1, 1, 9, 0, 0, 27)] },
    ],
  }, 84);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.teamProviderId), ['1024', '1023']);
  assert.deepEqual(rows[0], {
    teamProviderId: '1024', position: 1, played: 8, won: 6, drawn: 1, lost: 1,
    goalsFor: 16, goalsAgainst: 6, points: 19, form: null,
  });
});

test('drops inconsistent or incomplete rows instead of guessing', () => {
  const bad = { ...row(5, 3, 2, 2, 2, 8), gamePlayed: 7 };
  const missing = { competitor: { id: 6 }, position: 4, gamesWon: 1 };
  const rows = parse365Standings({ standings: [{ rows: [row(4, 1, 3, 0, 0, 9), bad, missing] }] }, 84);
  assert.deepEqual(rows.map((r) => r.teamProviderId), ['4']);
});

test('unknown shape → empty (never a partial guess)', () => {
  assert.deepEqual(parse365Standings(null), []);
  assert.deepEqual(parse365Standings({ table: [] }), []);
  assert.deepEqual(parse365Standings({ standings: [{ competitionId: 1, rows: [] }] }, 84), []);
});

test('several groups → the largest table (split league yields a partial one the DB rejects)', () => {
  const rows = parse365Standings({ standings: [
    { competitionId: 84, rows: [row(1, 1, 1, 0, 0, 3)] },
    { competitionId: 84, rows: [row(2, 1, 1, 0, 0, 3), row(3, 2, 0, 0, 1, 0)] },
  ] }, 84);
  assert.equal(rows.length, 2);
});

test('standings url carries the competition', () => {
  assert.match(standingsUrl(7), /competitions=7$/);
});
