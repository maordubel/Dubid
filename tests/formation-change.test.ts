/**
 * tests/formation-change.test.ts — מעבר בין מערכים.
 * הדרישה: לשמר כל שחקן שאפשר, ולומר בבירור מי נפל.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeFormation, createEmptyLineup } from '../src/lib/lineup.ts';
import type { Lineup, Position } from '../src/lib/scoring/types.ts';

const meta = { lineupId: 'L', userId: 'u', gameweekId: 'gw-2' };

/** ממלא הרכב בשחקנים דמה, אחד לכל משבצת. */
function filled(formation: string, captainSlot = 1): Lineup {
  const lu = createEmptyLineup(formation, meta);
  return {
    ...lu,
    slots: lu.slots.map((s, i) => ({
      ...s,
      playerId: `P${i + 1}`,
      teamId: `T${i + 1}`,
      price: 3,
      isCaptain: s.slotNo === captainSlot,
      isVice: s.slotNo === captainSlot + 1,
    })),
  };
}

const ids = (l: Lineup) => l.slots.filter((s) => s.playerId).map((s) => s.playerId);
const countPos = (l: Lineup, p: Position) => l.slots.filter((s) => s.position === p).length;

test('4-3-3 → 3-4-3 שומר עשרה ומוריד מגן אחד', () => {
  const r = changeFormation(filled('4-3-3'), '3-4-3');
  assert.equal(r.dropped.length, 1);
  assert.equal(ids(r.lineup).length, 10);
  assert.equal(countPos(r.lineup, 'DEF'), 3);
  assert.equal(countPos(r.lineup, 'MID'), 4);
  assert.equal(r.empty, 1, 'משבצת קישור אחת פנויה');
});

test('★ שחקנים ששרדו נשארים באותה עמדה', () => {
  const before = filled('4-3-3');
  const r = changeFormation(before, '4-4-2');
  for (const s of r.lineup.slots) {
    if (!s.playerId) continue;
    const orig = before.slots.find((x) => x.playerId === s.playerId)!;
    assert.equal(s.position, orig.position, `${s.playerId} החליף עמדה`);
    assert.equal(s.teamId, orig.teamId);
  }
});

test('העודף שיורד הוא האחרון שנבחר, לא הראשון', () => {
  const before = filled('5-3-2');
  const r = changeFormation(before, '3-5-2');
  // חמישה מגנים → שלושה. הראשונים נשארים.
  const defs = before.slots.filter((s) => s.position === 'DEF').map((s) => s.playerId);
  assert.deepEqual(r.dropped, defs.slice(3));
  const kept = r.lineup.slots.filter((s) => s.position === 'DEF').map((s) => s.playerId);
  assert.deepEqual(kept, defs.slice(0, 3));
});

test('המעבר דטרמיניסטי', () => {
  const before = filled('4-2-3-1');
  assert.deepEqual(
    changeFormation(before, '4-4-2').lineup.slots,
    changeFormation(before, '4-4-2').lineup.slots,
  );
});

test('הקפטן נשמר כששרד את המעבר', () => {
  const before = filled('4-3-3', 1);   // השוער הוא הקפטן
  const r = changeFormation(before, '3-5-2');
  const cap = r.lineup.slots.find((s) => s.isCaptain);
  assert.ok(cap, 'הקפטן נעלם למרות שהשוער תמיד שורד');
  assert.equal(cap!.playerId, 'P1');
});

test('★ קפטן שנפל — הסגן לא נשאר תלוי באוויר', () => {
  const before = filled('5-3-2', 6);   // הקפטן הוא המגן החמישי
  const r = changeFormation(before, '3-5-2');
  assert.ok(r.dropped.includes('P6'), 'המגן החמישי אמור ליפול');
  assert.equal(r.lineup.slots.some((s) => s.isCaptain), false);
  assert.equal(r.lineup.slots.some((s) => s.isVice), false, 'סגן בלי קפטן הוא מצב לא תקין');
});

test('מעבר לאותו מערך לא משנה דבר', () => {
  const before = filled('4-3-3');
  const r = changeFormation(before, '4-3-3');
  assert.deepEqual(ids(r.lineup), ids(before));
  assert.deepEqual(r.dropped, []);
});

test('הרכב ריק עובר בלי ליפול', () => {
  const r = changeFormation(createEmptyLineup('4-3-3', meta), '4-4-2');
  assert.deepEqual(r.dropped, []);
  assert.equal(r.empty, 11);
});

test('מעבר בין מערכי 5 שומר את מה שאפשר', () => {
  const r = changeFormation(filled('2-1-1'), '1-2-1');
  assert.equal(r.dropped.length, 1, 'מגן אחד יורד');
  assert.equal(countPos(r.lineup, 'DEF'), 1);
  assert.equal(countPos(r.lineup, 'MID'), 2);
  assert.equal(ids(r.lineup).length, 4);
});

test('המחיר הקפוא עובר עם השחקן', () => {
  const r = changeFormation(filled('4-3-3'), '4-4-2');
  for (const s of r.lineup.slots) {
    if (s.playerId) assert.equal(s.price, 3, 'ה-snapshot אבד במעבר');
  }
});
