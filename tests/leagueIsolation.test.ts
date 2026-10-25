import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* D03: כשל טעינה של ליגה לא-ראשית לא מחליף אותה בשקט לראשית. */
test('App.tsx לא קורא ל-chooseLeague בכשל טעינה', () => {
  const src = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.ok(!/chooseLeague\(/.test(src), 'chooseLeague לא אמור להיקרא מ-App.tsx');
  assert.ok(/setLoadFailed\(true\)/.test(src));
});
