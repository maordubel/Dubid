/**
 * tests/kits.test.ts — ערכות הקבוצות.
 *
 * הבדיקה החשובה: כל דיו על כל חולצה עובר תקן ניגודיות AA.
 * זו לא בדיקת "יופי" — טקסט לא קריא על חולצה הוא באג נגישות.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEAMS } from '../src/data/squads.ts';
import { contrastRatio, inkOn, teamColor, GK_KIT, TEAM_COLORS, DEFAULT_TEAM_COLOR } from '../src/data/teamColors.ts';

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

test('כל 14 קבוצות הסופר ליג היוונית מקבלות ערכה משלהן (לא ברירת המחדל האפורה)', () => {
  const ids = ['T30200','T28638','T28563','T28619','T28239','T100654','T30187','T27753',
               'T28675','T24493','T21585','T182386','T508099','T905256'];
  for (const id of ids) {
    assert.ok(TEAM_COLORS[id], `חסרה ערכה ל-${id}`);
    assert.notEqual(teamColor(id).primary, DEFAULT_TEAM_COLOR.primary);
  }
});
