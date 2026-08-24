/**
 * tests/purge.test.ts — מעבר ממצב הדגמה למשחק אמיתי.
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

const { purgeDemoDataOnce } = await import('../src/lib/store.ts');

beforeEach(() => store.clear());

function seedDemo() {
  store.setItem('dubid.entries.v1', '[{"id":"old"}]');
  store.setItem('dubid.results.v1', '{"gw-1":{"published":true}}');
  store.setItem('dubid.lineup.draft.draft-full.v1', '{"formation":"4-3-3"}');
  store.setItem('dubid.lineup.draft.draft-5x5.v1', '{"formation":"2-1-1"}');
  store.setItem('dubid.displayname.v1', 'מאור');
  store.setItem('dubid.user.v1', 'guest-123');
}

test('★ הגשות, תוצאות וטיוטות ישנות נמחקות', () => {
  seedDemo();
  assert.equal(purgeDemoDataOnce(), true);
  assert.equal(store.getItem('dubid.entries.v1'), null);
  assert.equal(store.getItem('dubid.results.v1'), null);
  assert.equal(store.getItem('dubid.lineup.draft.draft-full.v1'), null);
  assert.equal(store.getItem('dubid.lineup.draft.draft-5x5.v1'), null);
});

test('★ השם והזהות של המשתמש נשמרים', () => {
  seedDemo();
  purgeDemoDataOnce();
  assert.equal(store.getItem('dubid.displayname.v1'), 'מאור', 'אין סיבה להכריח הקלדה מחדש');
  assert.equal(store.getItem('dubid.user.v1'), 'guest-123');
});

test('הניקוי רץ פעם אחת בלבד', () => {
  seedDemo();
  assert.equal(purgeDemoDataOnce(), true);
  store.setItem('dubid.entries.v1', '[{"id":"new"}]');   // הגשה אמיתית חדשה
  assert.equal(purgeDemoDataOnce(), false, 'ריצה שנייה לא עושה כלום');
  assert.equal(store.getItem('dubid.entries.v1'), '[{"id":"new"}]', 'ההגשה החדשה שרדה');
});

test('מכשיר נקי לא מדווח על מחיקה', () => {
  store.setItem('dubid.displayname.v1', 'מאור');
  assert.equal(purgeDemoDataOnce(), false);
});
