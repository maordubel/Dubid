/** H02 — חיפוש רב-לשוני ושמות קצרים מובחנים. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distinctShortNames, matchesPlayer, normSearch, setPlayerSearch } from '../src/lib/playerNames.ts';

test('search finds a player by Hebrew and English (P04)', () => {
  setPlayerSearch('p1', ['מוחמד אבו ניל', 'Mohamed Abu-Neil', 'TBD']);
  assert.ok(matchesPlayer('p1', 'Mohamed Abu-Neil', 'abu neil'));
  assert.ok(matchesPlayer('p1', 'Mohamed Abu-Neil', 'אבו ניל'));
  assert.ok(matchesPlayer('p1', 'Mohamed Abu-Neil', '  ABU-NEIL '));
  assert.ok(!matchesPlayer('p1', 'Mohamed Abu-Neil', 'tbd'));
});

test('normalization strips accents and punctuation', () => {
  assert.equal(normSearch('Raul Bălbărău'), 'raul balbarau');
  assert.equal(normSearch("ג'בייר"), 'ג בייר');
});

test('same family name → distinguishable short names (P06)', () => {
  const m = distinctShortNames([
    { id: 'a', name: 'Noam Cohen' }, { id: 'b', name: 'Omri Cohen' },
    { id: 'c', name: 'Guy Melamed' }, { id: 'd', name: 'Nadav Cohen' }, { id: 'e', name: 'Saná' },
  ]);
  assert.equal(m.get('c'), 'Melamed');
  assert.equal(m.get('b'), 'O. Cohen');
  assert.equal(m.get('a'), 'Noam Cohen');   // N. Cohen תפוס פעמיים → שם מלא
  assert.equal(m.get('d'), 'Nadav Cohen');
  assert.equal(m.get('e'), 'Saná');
  assert.equal(new Set(m.values()).size, 5);
});
