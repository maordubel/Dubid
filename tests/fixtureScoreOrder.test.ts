import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* ★ רגרסיה: `.num` מכריח direction:ltr, ולכן פלקס עם dir=rtl שנושא `.num` הציג את התוצאה הפוכה.
   הכלל: עטיפת התוצאה היא dir=rtl בלי `.num`; `.num` רק על הספרות. נמדד בדפדפן אמיתי (11.10.2026). */
test('fixture score wrapper is rtl and does not carry .num', () => {
  const src = readFileSync(new URL('../src/components/PublicBoard.tsx', import.meta.url), 'utf8');
  const m = src.match(/<span dir="rtl"\s+className=\{`([^`]*)`\}>/);
  assert.ok(m, 'score wrapper not found');
  assert.ok(!/\bnum\b/.test(m![1]), 'wrapper must not use .num (forces ltr)');
  assert.match(src, /<span className="num">\{f\.homeGoals\}<\/span>/);
  assert.match(src, /<span className="num">\{f\.awayGoals\}<\/span>/);
  const css = readFileSync(new URL('../src/styles/index.css', import.meta.url), 'utf8');
  assert.match(css, /\.num\s*\{[^}]*direction:\s*ltr/s);
});
