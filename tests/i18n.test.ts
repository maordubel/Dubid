import test from 'node:test';
import assert from 'node:assert/strict';
import { DICT, translate } from '../src/lib/i18n/dict.ts';
import { LOCALES, dirOf, pickName, isLocale } from '../src/lib/i18n/locales.ts';

test('every dictionary key has non-empty text in all locales', () => {
  for (const [key, entry] of Object.entries(DICT)) {
    for (const l of LOCALES) {
      assert.ok((entry as Record<string, string>)[l]?.trim(), `${key} missing ${l}`);
    }
  }
});

test('direction follows the locale', () => {
  assert.equal(dirOf('he'), 'rtl');
  assert.equal(dirOf('en'), 'ltr');
  assert.equal(dirOf('el'), 'ltr');
});

test('translate returns the locale text', () => {
  assert.equal(translate('nav.home', 'he'), 'בית');
  assert.equal(translate('nav.home', 'en'), 'Home');
  assert.equal(translate('nav.home', 'el'), 'Αρχική');
});

test('pickName falls back en → he and never returns undefined', () => {
  assert.equal(pickName({ en: 'Olympiacos' }, 'el'), 'Olympiacos');
  assert.equal(pickName({ he: 'x' }, 'el'), 'x');
  assert.equal(pickName(null, 'he'), '');
});

test('isLocale rejects unknown values', () => {
  assert.ok(isLocale('el'));
  assert.ok(!isLocale('fr'));
  assert.ok(!isLocale(undefined));
});

import { displayName } from '../src/lib/i18n/names.ts';
import { deadlineView } from '../src/lib/gameweek.ts';

test('displayName never shows TBD and follows the locale', () => {
  const n = { he: 'אליאל פרץ', en: 'TBD', el: null };
  assert.equal(displayName(n, 'en'), 'אליאל פרץ');
  assert.equal(displayName({ he: null, en: 'Thomas Strakosha', el: null }, 'he'), 'Thomas Strakosha');
  assert.equal(displayName({ he: 'אולימפיאקוס', en: 'Olympiacos', el: 'Ολυμπιακός' }, 'el'), 'Ολυμπιακός');
  assert.equal(displayName({ he: 'x', en: 'Olympiacos', el: null }, 'el'), 'Olympiacos');
});

test('translate substitutes variables in every locale', () => {
  assert.equal(translate('status.draft', 'he', { filled: 3, size: 11 }), 'בטיוטה · 3/11');
  assert.equal(translate('status.draft', 'en', { filled: 3, size: 11 }), 'Draft · 3/11');
  assert.equal(translate('status.draft', 'el', { filled: 3, size: 11 }), 'Πρόχειρο · 3/11');
});

test('deadlineView is Hebrew by default and localised on request', () => {
  assert.equal(deadlineView(0).value, 'ההרכבים נעולים');
  assert.equal(deadlineView(0, 'en').value, 'Lineups locked');
  assert.equal(deadlineView(0, 'el').note, 'Η μπάλα κυλάει ήδη.');
  assert.equal(deadlineView(3 * 86_400_000 + 5 * 3_600_000, 'en').value, 'in 3 days');
});

test('placeholders in every dictionary entry match across locales', () => {
  for (const [key, entry] of Object.entries(DICT)) {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    const e = entry as Record<string, string>;
    assert.equal(vars(e.en), vars(e.he), `${key}: en/he placeholders differ`);
    assert.equal(vars(e.el), vars(e.he), `${key}: el/he placeholders differ`);
  }
});
