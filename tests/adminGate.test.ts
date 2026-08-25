/**
 * tests/adminGate.test.ts — השער של לוח הניהול.
 *
 * הבדיקות כאן קיימות בגלל באג אמיתי: דגל מקומי ודגל במסד לא
 * הסכימו, והמשתמש נכנס למסך שבו שום פעולה לא עובדת.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveGate, gateFromCheck } from '../src/lib/adminGate.ts';

test('לפני שהמסד ענה — לא מציגים כלום', () => {
  assert.equal(resolveGate({ isDatabaseAdmin: null, checked: false }), 'checking');
  // גם אם במקרה כבר יש תשובה, כל עוד לא סיימנו — checking.
  assert.equal(resolveGate({ isDatabaseAdmin: true, checked: false }), 'checking');
});

test('המסד אמר כן — פתוח', () => {
  assert.equal(resolveGate({ isDatabaseAdmin: true, checked: true }), 'ready');
});

test('המסד אמר לא — נעול', () => {
  assert.equal(resolveGate({ isDatabaseAdmin: false, checked: true }), 'locked');
});

test('★ המסד לא ענה — נעול, לא פתוח', () => {
  // "לא הצלחתי לבדוק" אינו "כן". ברירת המחדל בספק היא המחמירה.
  assert.equal(resolveGate({ isDatabaseAdmin: null, checked: true }), 'locked');
  assert.equal(gateFromCheck(new Error('network')), 'locked');
  assert.equal(gateFromCheck(false), 'locked');
});

test('★★ אין דרך להיכנס בלי שהמסד אישר ★★', () => {
  // הבאג המקורי: סיסמה נכונה בדפדפן פתחה את המסך גם כשהשרת נכשל.
  // המכונה הזו לא מקבלת שום קלט מקומי, ולכן זה בלתי אפשרי מבנית.
  const everyInput: Array<boolean | null> = [true, false, null];
  for (const db of everyInput) {
    for (const checked of [true, false]) {
      const gate = resolveGate({ isDatabaseAdmin: db, checked });
      if (gate === 'ready') {
        assert.equal(db, true, 'ready הושג בלי אישור המסד');
        assert.equal(checked, true, 'ready הושג לפני שהבדיקה הסתיימה');
      }
    }
  }
});
