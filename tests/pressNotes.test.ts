/**
 * טסטים להערות הדפוס.
 *
 *   node --experimental-strip-types --test tests/pressNotes.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PRESS_NOTES, IMPRINT, pressNote } from '../src/lib/pressNotes.ts';

test('אותו מחזור מחזיר תמיד את אותה הערה', () => {
  /* ★ זו כל הנקודה: בדיחה משותפת. אם שני משתמשים רואים שורות
     שונות באותו מחזור, אין על מה לדבר. */
  for (const gw of [1, 2, 7, 34]) {
    assert.equal(pressNote(gw), pressNote(gw), `מחזור ${gw}`);
  }
});

test('מחזורים עוקבים מקבלים הערות שונות', () => {
  const seen = new Set(Array.from({ length: PRESS_NOTES.length }, (_, i) => pressNote(i + 1)));
  assert.equal(seen.size, PRESS_NOTES.length, 'כל ההערות מופיעות במחזור אחד שלם');
});

test('קלט לא תקין לא מחזיר שורה ריקה', () => {
  /* ★ מחזור 0, שלילי, או NaN — כולם קורים בפועל: מחזור הדגמה,
     ייבוא חלקי, שדה שלא נטען עדיין. שורה ריקה בתחתית העמוד
     נראית כמו תקלת עימוד. */
  for (const bad of [0, -3, Number.NaN, 1.7]) {
    const note = pressNote(bad as number);
    assert.ok(typeof note === 'string' && note.length > 0, `קלט ${bad}`);
  }
});

test('כל ההערות אינן ריקות ומסתיימות בנקודה', () => {
  for (const n of PRESS_NOTES) {
    assert.ok(n.trim().length > 10, n);
    assert.match(n, /[.!?]$/, n);
  }
});

test('שורת בית הדפוס מזכירה את החברה ואת העיר הנכונה', () => {
  assert.match(IMPRINT, /Dubel\s?Team/);
  /* ★ אתונה, לא תל אביב. טעות עובדתית בקרדיט של החברה עצמה
     היא הפרט היחיד בעמוד שקורא יכול לתפוס בו את המוצר בשקר. */
  assert.match(IMPRINT, /אתונה/);
  assert.match(IMPRINT, /יוון/);
  assert.ok(!/תל אביב/.test(IMPRINT), 'העיר הישנה נשארה בשורה');
});
