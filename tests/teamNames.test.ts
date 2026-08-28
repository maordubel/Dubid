/**
 * טסטים להצעות שם הקבוצה.
 *
 *   node --experimental-strip-types --test tests/teamNames.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  pickName, cleanTeamName, TEAM_NAME_MAX, TEAM_NAME_POOL_SIZE,
} from '../src/lib/teamNames.ts';

test('אותו זרע מחזיר תמיד את אותו שם', () => {
  /* ★ הפונקציה נקראת מתוך רינדור. `Math.random()` שם היה מחליף
     את ההצעה בכל פעימת שעון — כלומר בזמן שהמשתמש קורא אותה. */
  for (const seed of [0, 1, 7, 41, 9999]) {
    assert.equal(pickName(seed), pickName(seed), `seed ${seed}`);
  }
});

test('לחיצות עוקבות מחזירות שמות שונים', () => {
  const seen = new Set(Array.from({ length: 12 }, (_, i) => pickName(i)));
  assert.ok(seen.size >= 10, `רק ${seen.size} שמות שונים מתוך 12`);
});

test('כל שם נכנס בתקרה של השרת', () => {
  /* ★ השרת חותך ל-24. שם שנוצר כאן וארוך יותר היה נשמר חתוך,
     והמשתמש היה רואה משהו אחר ממה שבחר. */
  for (let i = 0; i < 400; i++) {
    const name = pickName(i);
    assert.ok(name.length <= TEAM_NAME_MAX, `${name} (${name.length})`);
    assert.ok(name.trim().length > 3, name);
  }
});

test('קלט לא תקין לא מחזיר שם ריק', () => {
  for (const bad of [0, -3, Number.NaN, 1.9]) {
    assert.ok(pickName(bad as number).length > 3, String(bad));
  }
});

test('cleanTeamName מכווץ רווחים ושומר על התקרה', () => {
  assert.equal(cleanTeamName('  שכונת   התקווה  '), 'שכונת התקווה ');
  assert.equal(cleanTeamName('א'.repeat(80)).length, TEAM_NAME_MAX);
  /* ★ `trimStart` ולא `trim`: מי שמקליד "שכונת " ועוד לא סיים
     לא צריך שהרווח ייעלם מתחת לאצבע שלו. */
  assert.equal(cleanTeamName('שכונת '), 'שכונת ');
});

test('המאגר גדול מספיק כדי לא לחזור על עצמו בליגה', () => {
  assert.ok(TEAM_NAME_POOL_SIZE > 200, String(TEAM_NAME_POOL_SIZE));
});
