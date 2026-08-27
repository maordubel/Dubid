/**
 * tests/purge.test.ts — המכשיר מפסיק להחזיק דאטה של המשחק.
 *
 * ★ מה השתנה מהגרסה הקודמת של הבדיקה הזו
 *
 * קודם היא ווידאה שהניקוי **משאיר** את השם והמזהה במכשיר, כי
 * אז הם היו מקור האמת שלהם. עכשיו הם יושבים ב-`game.users`,
 * ועותק מקומי הוא בדיוק הבאג: מי ששינה שם בטלפון היה רואה
 * במחשב את הישן, לנצח.
 *
 * ★ מה כן חייב לשרוד: סשן ההזדהות של Supabase (`sb-*`).
 *   הוא לא נתון של המשחק — הוא ההוכחה מי אתה. מחיקה שלו הייתה
 *   מנתקת את המשתמש מכל מה שהגיש.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/** localStorage מינימלי — הבדיקות רצות ב-Node בלי דפדפן. */
class MemStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

const store = new MemStorage();
(globalThis as Record<string, unknown>).localStorage = store;
(globalThis as Record<string, unknown>).window = {
  dispatchEvent() { return true; },
  addEventListener() {},
  removeEventListener() {},
};

const { purgeLocalGameData } = await import('../src/lib/store.ts');

beforeEach(() => store.clear());

/** מכשיר שנשארו עליו שאריות מכל הגרסאות הקודמות. */
function seedLeftovers() {
  store.setItem('dubid.entries.v1', '[{"id":"old"}]');
  store.setItem('dubid.results.v1', '{"gw-1":{"published":true}}');
  store.setItem('dubid.lineup.draft.draft-full.v1', '{"formation":"4-3-3"}');
  store.setItem('dubid.lineup.draft.draft-5x5.v1', '{"formation":"2-1-1"}');
  store.setItem('dubid.displayname.v1', 'מאור');
  store.setItem('dubid.username.v1', 'guest-123');
  store.setItem('dubid.leagues.cache.v2', '{"leagues":[]}');
}

test('★ כל דאטת המשחק נמחקת מהמכשיר', () => {
  seedLeftovers();
  assert.equal(purgeLocalGameData(), 7, 'שבעה מפתחות נמחקו');
  for (const k of [
    'dubid.entries.v1', 'dubid.results.v1',
    'dubid.lineup.draft.draft-full.v1', 'dubid.lineup.draft.draft-5x5.v1',
    'dubid.leagues.cache.v2',
  ]) {
    assert.equal(store.getItem(k), null, k);
  }
});

test('★ גם השם והמזהה — הם חיים בשרת עכשיו', () => {
  seedLeftovers();
  purgeLocalGameData();
  // ★ ההיפך היה הבאג: שם מקומי שמנצח את השרת נשאר ישן לתמיד.
  assert.equal(store.getItem('dubid.displayname.v1'), null);
  assert.equal(store.getItem('dubid.username.v1'), null);
});

test('★ סשן ההזדהות שורד — אחרת המשתמש מאבד את ההגשות שלו', () => {
  seedLeftovers();
  store.setItem('sb-afxpjfxwpdjvlmuoawda-auth-token', '{"access_token":"x"}');
  purgeLocalGameData();
  assert.equal(
    store.getItem('sb-afxpjfxwpdjvlmuoawda-auth-token'),
    '{"access_token":"x"}',
    'מחיקת הסשן = ניתוק המשתמש מכל מה שהגיש',
  );
});

test('הניקוי רץ פעם אחת בלבד', () => {
  seedLeftovers();
  assert.ok(purgeLocalGameData() > 0);
  assert.equal(purgeLocalGameData(), 0, 'ריצה שנייה לא עושה כלום');
});

test('סמן ה-epoch עצמו לא נמחק — אחרת הניקוי רץ בכל טעינה', () => {
  seedLeftovers();
  purgeLocalGameData();
  assert.notEqual(store.getItem('dubid.epoch.v1'), null);
});

test('מכשיר נקי לא מדווח על מחיקה', () => {
  assert.equal(purgeLocalGameData(), 0);
});
