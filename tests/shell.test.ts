/**
 * tests/shell.test.ts — המעטפת והניווט התחתון.
 *
 * ★ הבאג שהבדיקות האלה שומרות עליו
 *
 * הניווט התחתון הוא `fixed bottom-0`. הוא לא בזרימת המסמך, ולכן
 * שום דבר לא משאיר לו מקום מעצמו — צריך לעשות את זה במפורש.
 *
 * במצב `fill` (מסך בניית ההרכב) הריפוד הזה הוסר, מתוך הנחה
 * ש"הילד מנהל גובה בעצמו". אבל הילד מודד `h-full` מול תיבת התוכן
 * של `main`, ותיבת התוכן הגיעה עד תחתית המסך. התוצאה: כפתור
 * "נעילת ההרכב" ישב מתחת לניווט, והמסך לא נגלל כדי להגיע אליו.
 *
 * **אי אפשר היה לשלוח הרכב מהטלפון.** באג חוסם, לא באג נוי.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shell = readFileSync('src/components/AppShell.tsx', 'utf8');
const nav = readFileSync('src/components/BottomNav.tsx', 'utf8');
const picker = readFileSync('src/components/SquadPicker.tsx', 'utf8');

/** מסיר הערות, כדי שהסבר על הבאג לא ייחשב כתיקון שלו. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//'))
    .join('\n');
}

const CLEARANCE = 'pb-[calc(var(--nav-h)+env(safe-area-inset-bottom))]';

test('★ אזור התוכן משאיר מקום לניווט — גם במצב fill', () => {
  const src = code(shell);
  const main = src.slice(src.indexOf('<main'), src.indexOf('</main>'));

  assert.ok(main.includes(CLEARANCE), 'חסר ריפוד תחתון בגובה הניווט');

  // הריפוד חייב להיות מחוץ לתנאי ה-fill. אם הוא בתוך ענף אחד
  // בלבד, הענף השני חוזר בדיוק לבאג המקורי.
  const fillBranch = main.slice(main.indexOf('fill'), main.indexOf('].join'));
  assert.ok(
    !fillBranch.includes(CLEARANCE),
    'הריפוד מותנה ב-fill — זה בדיוק המבנה שהוליד את הבאג',
  );
});

test('הריפוד מתבטל בדסקטופ, שם אין ניווט תחתון', () => {
  assert.ok(code(shell).includes('lg:pb-0'), 'בדסקטופ הריפוד מיותר');
  assert.ok(code(nav).includes('lg:hidden'), 'הניווט התחתון מוסתר בדסקטופ');
});

test('גובה הניווט מגיע ממקור אחד', () => {
  // מספר קסם בשני מקומות = יום אחד הם נפרדים והכפתור נעלם שוב.
  assert.ok(nav.includes('export const NAV_HEIGHT_PX'), 'הגובה חייב להיות מיוצא');
  assert.ok(
    shell.includes('NAV_HEIGHT_PX'),
    'המעטפת חייבת לייבא את הגובה ולא להעתיק מספר',
  );
  const literals = code(shell).match(/pb-\[\s*\d+px/g);
  assert.equal(literals, null, `ריפוד תחתון קשיח במעטפת: ${literals}`);
});

test('★ ההודעה במסך ההרכב עוגנת ל-CTA ולא למרחק קסם מהמסך', () => {
  const src = code(picker);
  assert.ok(
    !/bottom-\[\d/.test(src),
    'מרחק קסם מתחתית המסך — נשבר בכל שינוי גובה של הניווט',
  );
  assert.ok(src.includes('bottom-full'), 'ההודעה צריכה לשבת מעל הכפתור');
});

test('כפתור הנעילה נשאר אחרון בזרימה ולא נגלל', () => {
  const src = code(picker);
  const cta = src.indexOf('נעילת ההרכב');
  assert.ok(cta > 0, 'כפתור הנעילה נעלם מהמסך');

  // הכפתור יושב ב-shrink-0 בתחתית עמודה בגובה מלא. אם הוא היה
  // בתוך אזור flex-1, המגרש היה דוחף אותו החוצה.
  assert.ok(
    /relative shrink-0 border-t/.test(src),
    'עוטף ה-CTA חייב להיות shrink-0 (וגם relative, בשביל ההודעה)',
  );

  // המגרש הוא זה שלוקח את מה שנשאר — לא הכפתור.
  assert.ok(src.includes('min-h-0 flex-1'), 'המגרש חייב להיות flex-1 min-h-0');
});
