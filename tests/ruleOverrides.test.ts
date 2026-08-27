/**
 * tests/ruleOverrides.test.ts — איזון ניקוד בלי פריסה.
 *
 * ★ למה זה שווה בדיקה
 *
 * שינוי חוק ניקוד משנה את הדירוג של כולם. טעות כאן לא מפילה
 * כלום — היא פשוט נותנת מספרים אחרים, ואף אחד לא יידע שהם
 * שגויים עד שמישהו יספור ידנית.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyOverrides, readRule, RULE_KEYS } from '../src/lib/ruleOverrides.ts';
import { IL_PREMIER, DUBID_5X5 } from '../src/lib/scoring/rules.ts';

test('מפה ריקה מחזירה בדיוק את המקור', () => {
  // ★ טבלה ריקה = בדיוק המשחק של אתמול. זו כל ההצדקה לשיטת
  //   ה-override במקום להעביר את כל ה-RuleSet למסד.
  assert.equal(applyOverrides(IL_PREMIER, {}), IL_PREMIER);
});

test('★★ המקור לא משתנה — לעולם', () => {
  const before = IL_PREMIER.personal.assist;
  const next = applyOverrides(IL_PREMIER, { assist: 99 });
  // `IL_PREMIER` מיובא בשבעה מקומות. שינוי במקום היה מדליף
  // איזון של מצב אחד לשני, ורק בסדר טעינה מסוים.
  assert.equal(IL_PREMIER.personal.assist, before);
  assert.equal(next.personal.assist, 99);
});

test('שערים לפי עמדה', () => {
  const r = applyOverrides(IL_PREMIER, { 'goal.FWD': 7, 'goal.DEF': 9 });
  assert.equal(r.personal.goal.FWD, 7);
  assert.equal(r.personal.goal.DEF, 9);
  assert.equal(r.personal.goal.MID, IL_PREMIER.personal.goal.MID, 'לא נגענו במה שלא בוקש');
});

test('בונוס תוצאה, שער נקי, קפטן, ווירטואלי', () => {
  const r = applyOverrides(IL_PREMIER, {
    'result.W': 6, 'cleanSheet.GK': 8,
    'captain.multiplier': 2, 'virtualGoal.points': 9,
  });
  assert.equal(r.resultBonus.W, 6);
  assert.equal(r.personal.cleanSheet.GK, 8);
  assert.equal(r.captain.multiplier, 2);
  assert.equal(r.virtualGoal.points, 9);
});

test('★ מפתח לא מוכר מתעלמים ממנו', () => {
  // מפתח עם שגיאת כתיב שנשמר במסד היה מוצג לאדמין כאילו הוא
  // פועל, בזמן שהוא לא עושה כלום.
  const r = applyOverrides(IL_PREMIER, { 'lineupSize': 3, 'goal.STRIKER': 9 } as never);
  assert.equal(r.constraints.lineupSize, IL_PREMIER.constraints.lineupSize);
});

test('★★ גודל ההרכב לא ניתן לשינוי מכאן', () => {
  // זה לא איזון — זה המשחק. שינוי באמצע מחזור היה פוסל הרכבים
  // שהוגשו כחוקיים.
  assert.ok(!RULE_KEYS.some((r) => r.key.includes('lineupSize')));
  assert.ok(!RULE_KEYS.some((r) => r.key.includes('formation')));
});

test('★ מכפיל קפטן לא יורד מתחת ל-1', () => {
  // מכפיל 0 או שלילי הופך את הקפטן — ההחלטה המרכזית במשחק —
  // לעונש.
  assert.equal(applyOverrides(IL_PREMIER, { 'captain.multiplier': 0 }).captain.multiplier, 1);
  assert.equal(applyOverrides(IL_PREMIER, { 'captain.multiplier': -5 }).captain.multiplier, 1);
});

test('ערך לא מספרי לא הורס את החוק', () => {
  const r = applyOverrides(IL_PREMIER, { assist: NaN });
  assert.equal(r.personal.assist, IL_PREMIER.personal.assist);
});

test('הגרסה עולה — כדי שהיסטוריה תדע שהאיזון השתנה', () => {
  assert.equal(applyOverrides(IL_PREMIER, { assist: 4 }).version, IL_PREMIER.version + 1);
});

test('★ readRule מחזיר ערך לכל מפתח שהלוח מציג', () => {
  // אחרת הלוח מציג שדה ריק ליד תווית — ומי שיקליד בו יחשוב
  // שהוא משנה משהו שלא היה קיים.
  for (const r of RULE_KEYS) {
    const v = readRule(IL_PREMIER, r.key);
    assert.equal(typeof v, 'number', `${r.key} ב-IL_PREMIER`);
  }
});

test('החלה על דוביד 5 עובדת גם היא', () => {
  const r = applyOverrides(DUBID_5X5, { assist: 5 });
  assert.equal(r.personal.assist, 5);
  assert.equal(r.constraints.lineupSize, DUBID_5X5.constraints.lineupSize);
});

test('★ אין מפתח כפול ברשימה', () => {
  const keys = RULE_KEYS.map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length);
});
