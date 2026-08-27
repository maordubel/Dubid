/**
 * tests/fixtures.test.ts — לוח המשחקים של מחזור 2.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIXTURES, GAMEWEEK, GAMEWEEK_DEADLINE, HAS_UNCONFIRMED_TIMES,
  kickoffDateLabel, kickoffTimeLabel, leagueLocalToIso,
} from '../src/data/fixtures.ts';
import { TEAMS } from '../src/data/squads.ts';

test('שבעה משחקים, כל 14 הקבוצות, בדיוק פעם אחת', () => {
  assert.equal(FIXTURES.length, 7);
  const ids = FIXTURES.flatMap((f) => [f.homeTeamId, f.awayTeamId]);
  assert.equal(new Set(ids).size, 14);
  assert.equal(ids.length, 14, 'קבוצה מופיעה פעמיים');
  for (const t of TEAMS) {
    assert.ok(ids.includes(t.id), `${t.nameHe} לא משחקת`);
  }
});

test('כל השעות אושרו', () => {
  assert.equal(HAS_UNCONFIRMED_TIMES, false);
  assert.ok(FIXTURES.every((f) => f.timeConfirmed));
});

test('★ השעה מוצגת בשעון ישראל ולא בשעון המכשיר', () => {
  // הבאג: בלי timeZone, משחק ב-20:00 הוצג כ-17:00 על מכשיר ב-UTC.
  for (const f of FIXTURES) {
    assert.equal(kickoffTimeLabel(f.kickoff), '20:00', f.id);
  }
  assert.equal(kickoffDateLabel(FIXTURES[0].kickoff), '29.08');
});

test('★ הדדליין הוא הפתיחה המוקדמת ביותר, לא המאוחרת', () => {
  // אחרת מי שמחכה לראשון בוחר אחרי שראה חמישה משחקים.
  const earliest = FIXTURES.map((f) => Date.parse(f.kickoff)).sort((a, b) => a - b)[0];
  assert.equal(Date.parse(GAMEWEEK_DEADLINE), earliest);
  assert.equal(kickoffTimeLabel(GAMEWEEK_DEADLINE), '20:00');
  assert.equal(kickoffDateLabel(GAMEWEEK_DEADLINE), '29.08', 'הדדליין בשבת');
});

test('המחזור מסומן כמחזור 2', () => {
  assert.equal(GAMEWEEK.number, 2);
  assert.equal(GAMEWEEK.id, 'gw-2');
});

test('משחקים פרושים על שלושה ימים', () => {
  assert.deepEqual([...new Set(FIXTURES.map((f) => f.dayLabel))], ['שבת', 'ראשון', 'שני']);
  assert.equal(FIXTURES.filter((f) => f.dayLabel === 'שבת').length, 5);
});

/* ================================================================== */
/* המרת שעה מקומית ל-ISO — הנתיב של קליטת לוח באדמין                   */
/* ================================================================== */

test('leagueLocalToIso: קיץ מקבל +03:00, חורף +02:00', () => {
  /* ★ זו לא קפדנות תיאורטית. אדמין שקולט מחזור בנובמבר עם
     `+03:00` קבוע סוגר את הדדליין שעה לפני מה שהוא ראה על
     המסך — והמשתתפים מפספסים את המחזור. */
  assert.equal(leagueLocalToIso('2026-09-05T20:00'), '2026-09-05T20:00:00+03:00');
  assert.equal(leagueLocalToIso('2026-12-05T20:00'), '2026-12-05T20:00:00+02:00');
});

test('leagueLocalToIso: הרגע שנוצר הוא באמת אותה שעה בישראל', () => {
  for (const local of ['2026-09-05T20:00', '2026-12-05T20:00', '2026-03-28T21:30']) {
    const label = new Date(leagueLocalToIso(local)).toLocaleTimeString('he-IL', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem',
    });
    assert.equal(label, local.slice(11), local);
  }
});

test('leagueLocalToIso: קלט לא תקין מחזיר ריק ולא NaN', () => {
  assert.equal(leagueLocalToIso(''), '');
  assert.equal(leagueLocalToIso('לא תאריך'), '');
});
