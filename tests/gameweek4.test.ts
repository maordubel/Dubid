/**
 * tests/gameweek4.test.ts — הזרע בקליינט והסיד במסד מדברים על
 * אותו מחזור.
 *
 * ★ למה הבדיקה הזו קיימת
 *
 * לוח המשחקים חי בשני מקומות: `src/data/fixtures.ts` (מה שנראה
 * בפריים הראשון ומה שנשאר אם הרשת נופלת) ו-`db/25_gameweek_4.sql`
 * (מקור האמת). שניהם נכתבים ביד, ואין ביניהם שום קשר מכני.
 *
 * הכשל שזה מונע הוא שקט לחלוטין: מישהו מזיז משחק בקובץ אחד
 * ושוכח את השני, המסך מראה שעה אחת, השרת נועל בשעה אחרת, והמשתמש
 * לוחץ "הגש" ומקבל DEADLINE_PASSED בלי להבין למה. אף בדיקה
 * קיימת לא הייתה תופסת את זה, כי כל צד תקין בפני עצמו.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FIXTURES, GAMEWEEK, GAMEWEEK_DEADLINE } from '../src/data/fixtures.ts';

const sql = readFileSync(new URL('../db/25_gameweek_4.sql', import.meta.url), 'utf8');

/** שורות ה-VALUES של הלוח: ('14','1', TIMESTAMPTZ '2026-09-13 20:30:00+03') */
function sqlFixtures() {
  const re = /\('(\d+)',\s*'(\d+)',\s*TIMESTAMPTZ\s*'([\d-]+ [\d:]+\+\d{2})'\)/g;
  return [...sql.matchAll(re)].map((m) => ({
    homeTeamId: `T${m[1]}`,
    awayTeamId: `T${m[2]}`,
    /* '2026-09-13 20:30:00+03' → '2026-09-13T20:30:00+03:00' */
    kickoff: `${m[3].replace(' ', 'T')}:00`,
  }));
}

test('הסיד מכיל בדיוק שבעה משחקים', () => {
  assert.equal(sqlFixtures().length, 7);
  assert.equal(FIXTURES.length, 7);
});

test('★ אותם משחקים ואותן שעות בשני הקבצים', () => {
  const key = (f: { homeTeamId: string; awayTeamId: string; kickoff: string }) =>
    `${f.homeTeamId}-${f.awayTeamId}@${Date.parse(f.kickoff)}`;
  assert.deepEqual(sqlFixtures().map(key).sort(), FIXTURES.map(key).sort());
});

test('הסיד פותח את המחזור ומסמן אותו כנוכחי', () => {
  assert.match(sql, /'open'/, "status 'open' — אחרת המשתמש רואה מסך ריק");
  assert.match(sql, /SET is_current = TRUE/);
  assert.match(sql, /number, code[\s\S]{0,400}'gw-4'/);
  assert.equal(GAMEWEEK.id, 'gw-4');
});

test('★ הדדליין בקליינט זהה לזה שהסיד גוזר', () => {
  /* הסיד גוזר `min(kickoff_at)`. הקליינט גוזר את אותו דבר.
     שני חישובים שונים = מסך שאומר שעה אחת ושרת שנועל באחרת. */
  const earliestSql = Math.min(...sqlFixtures().map((f) => Date.parse(f.kickoff)));
  assert.equal(Date.parse(GAMEWEEK_DEADLINE), earliestSql);
  assert.equal(new Date(earliestSql).toISOString(), '2026-09-13T17:30:00.000Z');
});

test('כל קבוצה משחקת בדיוק פעם אחת', () => {
  const seen = FIXTURES.flatMap((f) => [f.homeTeamId, f.awayTeamId]);
  assert.equal(seen.length, 14);
  assert.equal(new Set(seen).size, 14, 'קבוצה שמופיעה פעמיים = לוח שגוי');
});
