/**
 * tests/kits.test.ts — ערכות הקבוצות.
 *
 * הבדיקה החשובה: כל דיו על כל חולצה עובר תקן ניגודיות AA.
 * זו לא בדיקת "יופי" — טקסט לא קריא על חולצה הוא באג נגישות.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEAMS } from '../src/data/squads.ts';
import { contrastRatio, inkOn, teamColor, GK_KIT } from '../src/data/teamColors.ts';

test('לכל קבוצה בליגה יש ערכה מוגדרת', () => {
  for (const t of TEAMS) {
    const kit = teamColor(t.id);
    assert.notEqual(kit.primary, '#3A3F4B', `${t.nameHe} (${t.id}) נופל לערכת ברירת המחדל`);
  }
});

test('כל ערכה עוברת ניגודיות AA (4.5:1)', () => {
  for (const t of TEAMS) {
    const kit = teamColor(t.id);
    const ratio = contrastRatio(kit.primary, kit.ink);
    assert.ok(ratio >= 4.5, `${t.nameHe}: ניגודיות ${ratio.toFixed(2)} מתחת ל-4.5`);
  }
});

test('ערכת השוער נבדלת מכל ערכת שדה', () => {
  for (const t of TEAMS) {
    assert.notEqual(teamColor(t.id).primary, GK_KIT.primary, `${t.nameHe} זהה לשוער`);
  }
});

test('הדיו נבחר לפי ניגודיות מדודה ולא לפי סף', () => {
  // תכלת — המקרה שסף בהירות קבוע נכשל עליו
  assert.equal(inkOn('#4FA3DC'), '#14120F');
  assert.equal(inkOn('#FFDD00'), '#14120F');
  assert.equal(inkOn('#00693E'), '#FFFFFF');
  assert.equal(inkOn('#1A1A1A'), '#FFFFFF');
});

test('קבוצה לא מוכרת מקבלת ערכה נייטרלית ולא קורסת', () => {
  const kit = teamColor('T999');
  assert.ok(kit.primary);
  assert.ok(contrastRatio(kit.primary, kit.ink) >= 4.5);
});
