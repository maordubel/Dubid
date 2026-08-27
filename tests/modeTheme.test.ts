/**
 * tests/modeTheme.test.ts — לכל מצב יש זהות, והיא עקבית.
 *
 * ★ למה זה שווה בדיקה
 *
 * הפלטה של המצבים חיה בשלושה מנועי ציור: Tailwind (הממשק),
 * canvas (כרטיס השיתוף), ו-SVG (הסמלים). hex שנכתב פעמיים
 * מתפצל בשקט — ואף בדיקה לא קוראת תמונות.
 *
 * הבדיקות כאן שומרות על מה שאפשר לשמור עליו בקוד: שהערכים
 * קיימים, שהם חוקיים, ושהמצבים באמת **שונים** זה מזה.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MODE_THEME, modeTheme, modeVars, modeTexture, modeConstraintLabel,
} from '../src/lib/modeTheme.ts';

const HEX = /^#[0-9a-fA-F]{6}$/;

test('★ כל צבע הוא hex בן שש ספרות', () => {
  for (const t of Object.values(MODE_THEME)) {
    for (const key of ['accent', 'accentDeep', 'accentLight', 'surface'] as const) {
      assert.match(t[key], HEX, `${t.id}.${key}`);
    }
  }
});

test('★★ שני המצבים באמת נראים אחרת', () => {
  const a = modeTheme('five');
  const b = modeTheme('full');
  // זו כל הנקודה של הקובץ. אם מישהו "מאחד" את הפלטה — כאן זה נופל.
  assert.notEqual(a.accent, b.accent);
  assert.notEqual(a.surface, b.surface);
  assert.notEqual(a.codeName, b.codeName);
  assert.notEqual(a.name, b.name);
});

test('המבנה תואם לחוקי המשחק', () => {
  assert.equal(modeTheme('five').lineupSize, 5);
  assert.equal(modeTheme('full').lineupSize, 11);
  // ★ תקציב קיים רק במצב שבו הוא אילוץ. `0` היה נראה כמו תקציב אפס.
  assert.equal(modeTheme('five').budget, 15);
  assert.equal(modeTheme('full').budget, null);
});

test('★ הצבע שנשלח לקנבס חוקי גם עם שקיפות מודבקת', () => {
  // הכרטיס בונה `${accent}2a`. hex בן 4 או 8 ספרות היה יוצר
  // מחרוזת בת 6 או 10 — כלומר צבע שקנבס מתעלם ממנו בשקט.
  for (const t of Object.values(MODE_THEME)) {
    assert.equal(`${t.accent}2a`.length, 9);
  }
});

test('משתני ה-CSS מכילים את כל מה שהמסכים משתמשים בו', () => {
  const v = modeVars('five');
  for (const k of ['--mode-accent', '--mode-accent-deep', '--mode-accent-light',
                   '--mode-surface', '--mode-wash', '--mode-glow']) {
    assert.ok(v[k], k);
  }
});

test('המרקם הוא CSS טהור — בלי בקשת רשת', () => {
  for (const id of ['five', 'full'] as const) {
    const tex = modeTexture(id);
    assert.ok(tex.backgroundImage);
    // ★ `url(` כאן פירושו שחזרנו לתמונות, וזה בדיוק מה שהוסר.
    assert.ok(!tex.backgroundImage.includes('url('), id);
    assert.match(tex.backgroundColor, HEX);
  }
});

test('תווית האילוץ סופרת קבוצות, לא שחקנים', () => {
  // ★ "5 מתוך 14 קבוצות" — מה שוויתרת, לא מה שבחרת.
  assert.equal(modeConstraintLabel('five', 14), '5 מתוך 14 קבוצות');
  assert.equal(modeConstraintLabel('full', 14), '11 מתוך 14 קבוצות');
});
