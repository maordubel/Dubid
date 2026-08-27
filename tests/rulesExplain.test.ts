/**
 * טסטים ל-`rulesExplain` — השכבה שמתרגמת חוקים לטקסט שהמשתמש קורא.
 *
 * ★ למה דווקא זה נבדק בקפדנות
 *
 * מסך החוקים הוא המקום היחיד במוצר שיכול לשקר בלי שאף בדיקה
 * תרגיש. ניקוד שגוי נופל בטסט; **הסבר** שגוי פשוט מוצג. עד
 * עכשיו המסך הכריז על ערכים שנכתבו ביד — ומרגע שהאדמין שינה
 * חוק אחד, המערכת חישבה מספר אחד והמסך הבטיח אחר.
 *
 *   node --experimental-strip-types --test tests/rulesExplain.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { IL_PREMIER, type RuleSet } from '../src/lib/scoring/rules.ts';
import {
  scoringRows, captainRows, differentialRows, tiebreakSteps,
} from '../src/lib/rulesExplain.ts';
import { applyOverrides } from '../src/lib/ruleOverrides.ts';

const labels = (rows: Array<{ label: string }>) => rows.map((r) => r.label);
const find = (rows: Array<{ label: string; value: string; note?: string }>, needle: string) =>
  rows.find((r) => r.label.includes(needle));

test('טבלת הניקוד נגזרת מהחוקים ולא מרשימה קבועה', () => {
  const rows = scoringRows(IL_PREMIER);
  assert.equal(find(rows, 'בישול')?.value, '3');
  assert.equal(find(rows, 'כרטיס צהוב')?.value, '-1');
  assert.equal(find(rows, 'כרטיס אדום')?.value, '-3');
});

test('שערים מקובצים לפי ערך — שוער ומגן באותה שורה', () => {
  const rows = scoringRows(IL_PREMIER);
  const goals = labels(rows).filter((l) => l.startsWith('שער — '));
  assert.deepEqual(goals, ['שער — שוער / מגן', 'שער — קשר', 'שער — חלוץ']);
});

test('שינוי של האדמין משנה את המסך — זו כל הנקודה', () => {
  const changed = applyOverrides(IL_PREMIER, { assist: 4, 'goal.FWD': 7 });
  const rows = scoringRows(changed);
  assert.equal(find(rows, 'בישול')?.value, '4');
  /* חלוץ עלה ל-7 ולכן הוא כבר לא בקבוצה של 4 — והשורה נפרדת. */
  assert.equal(find(rows, 'שער — חלוץ')?.value, '7');
});

test('חוק מכובה לא מוצג כפעיל', () => {
  /* `savesPoints` ו-`minutesPlayed` מכוונים ל-0 בברירת המחדל.
     הצגתם הייתה מבטיחה נקודות שלא קיימות. */
  const rows = labels(scoringRows(IL_PREMIER));
  assert.ok(!rows.includes('הצלות'));
  assert.ok(!rows.includes('הופעה במשחק'));

  const on = applyOverrides(IL_PREMIER, { savesPoints: 1 });
  assert.ok(labels(scoringRows(on)).includes('הצלות'));
});

test('שער עצמי מופיע — המנוע קורא אותו והמסך התעלם', () => {
  assert.equal(find(scoringRows(IL_PREMIER), 'שער עצמי')?.value, '-2');
});

test('בונוס התוצאה מצהיר שגם מי שלא שיחק מקבל אותו', () => {
  assert.equal(IL_PREMIER.resultBonus.requireMinutes, 0);
  const note = find(scoringRows(IL_PREMIER), 'ניצחון')?.note ?? '';
  assert.match(note, /גם אם לא שיחק/);
});

test('בונוס תוצאה עם דרישת דקות אומר את המספר', () => {
  const strict: RuleSet = {
    ...IL_PREMIER,
    resultBonus: { ...IL_PREMIER.resultBonus, requireMinutes: 45 },
  };
  assert.match(find(scoringRows(strict), 'ניצחון')?.note ?? '', /45/);
});

test('מכפיל הקפטן מגיע מהחוקים', () => {
  assert.equal(captainRows(IL_PREMIER)[0].label, '×3');
  const doubled = applyOverrides(IL_PREMIER, { 'captain.multiplier': 2 });
  assert.equal(captainRows(doubled)[0].label, '×2');
  assert.match(captainRows(doubled)[0].note ?? '', /פי 2/);
});

test('שוברי שוויון: שלב מת לא נספר', () => {
  /* "שאר התרומה המאומתת" בנוי מהצלות/פנדלים/דקות — כולם 0,
     ולכן השלב לעולם לא יכול להכריע. המסך הבטיח שמונה. */
  const steps = tiebreakSteps(IL_PREMIER);
  assert.equal(steps.length, 7);
  assert.ok(!steps.includes('שאר התרומה המאומתת'));
  assert.equal(steps[0], 'ניקוד כולל');
  assert.equal(steps.at(-1), 'זמן ההגשה הרשמי — מי שהגיש קודם');

  const withSaves = applyOverrides(IL_PREMIER, { savesPoints: 1 });
  assert.equal(tiebreakSteps(withSaves).length, 8);
});

test('בחירה נדירה: התנאי הוא נקודות, לא הופעה', () => {
  const rows = differentialRows();
  const cond = find(rows, 'תנאי')?.note ?? '';
  assert.match(cond, /נקודות ומעלה/);
  assert.ok(!/הופיע/.test(cond));
  /* המדרגות והתקרה — שני הפרטים שקובעים אם כדאי להמר. */
  assert.ok(labels(rows).some((l) => /מהמשתתפים בחרו/.test(l)));
  assert.ok(find(rows, 'תקרה'));
});
