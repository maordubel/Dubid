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
