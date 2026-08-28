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

  /*
   * ★ הכלל הוא "אין מרחק **מוחלט** מתחתית המסך", ולא "אין
   *   bottom" בכלל.
   *
   * הבאג המקורי היה `absolute bottom-[7.5rem]` בלי אב ממוקם —
   * כלומר מרחק קבוע מקצה ה-viewport, שנשבר בכל שינוי גובה של
   * הניווט או של סרגל הכתובות.
   *
   * מיקום באחוזים **בתוך כרטיס** הוא דבר אחר לגמרי: הוא יחסי
   * להורה, הוא מתכווץ איתו, ואין לו שום קשר לתחתית המסך. תג
   * המחיר וסמל המועדון על הדמות המצוירת משתמשים בו, ובצדק.
   */
  const magic = src.match(/bottom-\[\s*-?\d+(\.\d+)?(px|rem|em)\s*\]/g);
  assert.equal(
    magic, null,
    `מרחק קסם מתחתית המסך — נשבר בכל שינוי גובה של הניווט: ${magic}`,
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

/* ================================================================== */
/* סבב G — מסכים שנבדקו חזותית, והכללים שמחזיקים אותם                  */
/* ================================================================== */

const app = readFileSync('src/App.tsx', 'utf8');

test('★★ כפתור הצעת השם לא יכול להרחיב את מודל ההגשה', () => {
  /*
   * ★ הבאג שנתפס ברינדור.
   *
   * לכפתור ההצעה יש `flex-1`, ולפריט flex יש `min-width:auto` —
   * כלומר הוא **לא** מתכווץ מתחת לרוחב הטקסט שלו. שם קבוצה ארוך
   * מרחיב את הכפתור, הכפתור מרחיב את הטופס, והטופס יושב בתוך
   * `grid place-items-center` שנמדד לפי התוכן. התוצאה: החלון
   * כולו גולש מחוץ למסך הטלפון, בגלל שורת הצעה אחת.
   *
   * `min-w-0` + `truncate` הם התיקון, והבדיקה נועלת אותו: בלעדיהם
   * הבאג חוזר בשקט ברגע שמישהו מוסיף מילה למאגר השמות.
   */
  const src = code(app);
  const btn = src.slice(src.indexOf('קח את «'), src.indexOf('קח את «') + 40);
  assert.ok(btn.length > 0, 'כפתור ההצעה נעלם מהמודל');

  const row = src.slice(src.indexOf('onClick={() => setTeam(suggestion)}') - 400,
                        src.indexOf('קח את «'));
  assert.ok(row.includes('min-w-0'), 'כפתור ההצעה חייב min-w-0 (אחרת הוא מרחיב את המודל)');
  assert.ok(row.includes('truncate'), 'כפתור ההצעה חייב truncate');
});

test('★ מסך החוקים צובע את עצמו ולא סומך על המעטפת', () => {
  /*
   * תאי טבלת הניקוד לא נושאים צבע משלהם — הם יורשים אותו. כל עוד
   * הירושה מגיעה מהמעטפת זה עובד, אבל כל רינדור מחוץ למעטפת
   * (תצוגה, בדיקה, עמוד עצמאי) מקבל דיו כהה על רקע כהה, כלומר
   * טבלה בלתי קריאה. הצבע שייך למסך עצמו.
   */
  const src = code(app);
  const start = src.indexOf('function RulesScreen');
  const root = src.slice(src.indexOf('max-w-2xl', start), src.indexOf('max-w-2xl', start) + 60);
  assert.match(root, /text-chalk/, 'שורש מסך החוקים חייב צבע טקסט מפורש');
});

test('★ היומן ניתן לרינדור בלי טעינה — שלושת המצבים בקומפוננטה אחת', () => {
  /*
   * `AdminActivity` טוענת ב-`useEffect`. כשהיומן היה בתוכה, כל
   * רינדור סטטי הראה "טוען…" לנצח — כלומר אי אפשר היה לבדוק את
   * הצורה האמיתית שלו, לא בעין ולא בבדיקה.
   */
  const console_ = code(readFileSync('src/components/AdminConsole.tsx', 'utf8'));
  assert.ok(console_.includes('export function ActivityLog'),
    'היומן חייב להיות קומפוננטה עצמאית שמקבלת שורות');
  assert.ok(console_.includes('<ActivityLog rows={rows} />'),
    'AdminActivity חייבת להשתמש בקומפוננטה ולא להעתיק את הסימון');
});
