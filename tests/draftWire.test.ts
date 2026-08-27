/**
 * tests/draftWire.test.ts — התרגום בין המסך למסד.
 *
 * ★ למה זה שווה בדיקה
 *
 * טעות כאן לא מפילה כלום. היא מחזירה הרכב **מעוות**: קפטן
 * שנעלם, שחקן במשבצת של שוער, או מזהה `PP305`. המשתמש רואה
 * את זה רק כשהוא פותח את הטלפון — ואז זה נראה כמו "האפליקציה
 * איבדה לי את ההרכב".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toWire, fromWire } from '../src/lib/draftWire.ts';
import { createEmptyLineup } from '../src/lib/lineup.ts';
import type { Lineup } from '../src/lib/scoring/types.ts';

const META = { lineupId: 'draft-5x5', userId: 'u1', gameweekId: 'gw-2' };

/* דוביד 5 = '2-1-1', ו-`parseFormation` מוסיף שוער תמיד:
   1 + 2 + 1 + 1 = חמש משבצות. */
const FIVE = '2-1-1';

function filled(): Lineup {
  const lu = createEmptyLineup(FIVE, META);
  lu.slots[0] = { ...lu.slots[0], playerId: 'P101', teamId: 'T1', isCaptain: true };
  lu.slots[1] = { ...lu.slots[1], playerId: 'P205', teamId: 'T2', isVice: true };
  lu.slots[2] = { ...lu.slots[2], playerId: 'P301', teamId: 'T3' };
  return lu;
}

test('★ הקידומת P יורדת — המסד מדבר מספרים', () => {
  const wire = toWire(filled());
  assert.deepEqual(wire.map((w) => w.ext_player_id), ['101', '205', '301']);
});

test('★ רק משבצות מלאות נשלחות', () => {
  const lu = filled();
  assert.equal(lu.slots.length, 5, 'שוער + 2 + 1 + 1 = חמש');
  assert.equal(toWire(lu).length, 3, 'שלוש מלאות — שתי הריקות לא נשלחות');
});

test('★ קפטן וסגן שורדים את הנסיעה', () => {
  const back = fromWire(createEmptyLineup(FIVE, META), {
    formation: FIVE, slots: toWire(filled()), updatedAt: '',
  });
  assert.equal(back.slots.find((s) => s.isCaptain)?.playerId, 'P101');
  assert.equal(back.slots.find((s) => s.isVice)?.playerId, 'P205');
});

test('★ הלוך-חזור מחזיר בדיוק את מה שנשלח', () => {
  const before = filled();
  const after = fromWire(createEmptyLineup(FIVE, META), {
    formation: FIVE, slots: toWire(before), updatedAt: '',
  });
  assert.deepEqual(
    after.slots.map((s) => [s.slotNo, s.playerId, s.teamId, !!s.isCaptain]),
    before.slots.map((s) => [s.slotNo, s.playerId, s.teamId, !!s.isCaptain]),
  );
});

test('★ מזהה שכבר נושא P לא מקבל P כפולה', () => {
  // המסד אמור להחזיר '305'. אם מישהו יחזיר 'P305' — לא נוצר 'PP305'.
  const back = fromWire(createEmptyLineup(FIVE, META), {
    formation: FIVE,
    slots: [{ slot_no: 1, ext_player_id: 'P305' }],
    updatedAt: '',
  });
  assert.equal(back.slots[0].playerId, 'P305');
});

test('★ משבצת שאין לה מקום במערך פשוט נופלת, ולא מפילה', () => {
  // טיוטה של 11 שנטענת לתוך מבנה של 5: המשבצות 6–11 לא קיימות.
  const back = fromWire(createEmptyLineup(FIVE, META), {
    formation: FIVE,
    slots: [
      { slot_no: 1, ext_player_id: '101' },
      { slot_no: 9, ext_player_id: '901' },
    ],
    updatedAt: '',
  });
  assert.equal(back.slots.length, 5);
  assert.equal(back.slots[0].playerId, 'P101');
  assert.ok(!back.slots.some((s) => s.playerId === 'P901'));
});

test('המערך שנשמר מנצח את זה שהועבר', () => {
  const back = fromWire(createEmptyLineup(FIVE, META), {
    formation: '1-2-1', slots: [], updatedAt: '',
  });
  assert.equal(back.formation, '1-2-1');
});

test('טיוטה ריקה חוקית — היא באמצע עריכה', () => {
  assert.deepEqual(toWire(createEmptyLineup('4-3-3', META)), []);
});
