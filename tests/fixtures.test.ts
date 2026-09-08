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
  /* הבאג: בלי timeZone, משחק ב-20:00 הוצג כ-17:00 על מכשיר ב-UTC.
   *
   * ★ הבדיקה נגזרת מהמחרוזת ולא מוקלדת על שעה אחת.
   *
   *   קודם היא השוותה כל משחק ל-'20:00' — מה שהיה נכון כל עוד
   *   כל המחזור נבעט באותה שעה. מחזור 4 נבעט ב-19:30, 20:00
   *   ו-20:30, ולכן הבדיקה נפלה על **נתון תקין**. בדיקה
   *   שנשברת ממחזור חדש היא בדיקה שמישהו יכבה.
   *
   *   מה שנבדק הוא האינווריאנטה עצמה: התווית שווה לשעה שכתובה
   *   ב-ISO, שנושא את ההסטה של ישראל — ולכן זהה בכל מכשיר. */
  for (const f of FIXTURES) {
    const hhmm = f.kickoff.slice(11, 16);
    assert.equal(kickoffTimeLabel(f.kickoff), hhmm, f.id);
  }
  assert.equal(kickoffDateLabel(FIXTURES[0].kickoff), '13.09');
});

test('★ הדדליין הוא הפתיחה המוקדמת ביותר, לא המאוחרת', () => {
  // אחרת מי שמחכה לראשון בוחר אחרי שראה חמישה משחקים.
  const earliest = FIXTURES.map((f) => Date.parse(f.kickoff)).sort((a, b) => a - b)[0];
  assert.equal(Date.parse(GAMEWEEK_DEADLINE), earliest);
  assert.equal(kickoffTimeLabel(GAMEWEEK_DEADLINE), '20:30');
  assert.equal(kickoffDateLabel(GAMEWEEK_DEADLINE), '13.09', 'הדדליין בראשון');
});

test('המחזור מסומן כמחזור 4', () => {
  assert.equal(GAMEWEEK.number, 4);
  assert.equal(GAMEWEEK.id, 'gw-4');
});

test('משחקים פרושים על שלושה ימים', () => {
  /* ★ ראשון–שלישי ולא שבת–שני: 12/09/2026 הוא ראש השנה.
     ולכן `dayLabel` נגזר מהתאריך ולא מוקלד — מחזור שנדחה
     בגלל חג היה מציג "שבת" ליד משחק שמשוחק בשלישי. */
  assert.deepEqual([...new Set(FIXTURES.map((f) => f.dayLabel))], ['ראשון', 'שני', 'שלישי']);
  assert.equal(FIXTURES.filter((f) => f.dayLabel === 'שני').length, 4);
});

test('★ הדרבי התל אביבי נמצא בלוח', () => {
  const derby = FIXTURES.find((f) => f.homeTeamId === 'T3' && f.awayTeamId === 'T6');
  assert.ok(derby, 'מכבי ת״א – הפועל ת״א');
  assert.equal(kickoffTimeLabel(derby.kickoff), '20:30');
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
