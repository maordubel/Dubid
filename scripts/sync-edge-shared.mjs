/**
 * sync-edge-shared.mjs — מעתיק את הקוד המשותף אל תוך תיקיית הפונקציה.
 *
 * ★ הבעיה
 *
 * הפריסה נכשלה עם:
 *   Module not found "file:///src/lib/scoring/engine.ts"
 *
 * ה-bundler של Supabase רואה **רק** את תיקיית הפונקציה. ייבוא כמו
 * `../../../src/lib/scoring/engine.ts` עובד מקומית ונשבר בפריסה.
 *
 * ★ ולמה לא `_shared/`
 *
 * הניסיון הראשון העתיק ל-`supabase/functions/_shared/`. זה עובד
 * ב-CLI — אבל **לא בעורך ה-Dashboard**, שלא מאפשר קבצים מעל שורש
 * הפונקציה. מי שפורס דרך הדפדפן נשאר תקוע בדיוק באותה שגיאה.
 *
 * לכן היעד הוא `<function>/_lib/` — בתוך הפונקציה. עובד בשתי דרכי
 * הפריסה, בלי תנאים ובלי "תלוי איך אתה פורס".
 *
 * מקור האמת נשאר `src/lib/`. `_lib/` הוא תוצר בנייה: כל קובץ בו
 * מסומן "נוצר אוטומטית", והתיקייה ב-.gitignore.
 *
 * הרצה:  npm run sync:edge     (רץ אוטומטית לפני deploy:edge)
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** כל פונקציה שצריכה את הקוד המשותף. */
const FUNCTIONS = ['dubid-score-gameweek'];

/** מה מועתק. נתיבים יחסיים ל-src/lib. */
const SHARED = ['scoring', 'events'];

const BANNER = `/**
 * ⚠ נוצר אוטומטית — אל תערכו כאן.
 *
 * הועתק מ-src/lib/ על ידי scripts/sync-edge-shared.mjs.
 * כל שינוי כאן יימחק בפריסה הבאה. ערכו את המקור.
 */
`;

/** מוסיף באנר לכל קובץ, כדי שאיש לא יערוך תוצר בנייה בטעות. */
function stamp(dir) {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      n += stamp(full);
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    writeFileSync(full, BANNER + readFileSync(full, 'utf8'));
    n += 1;
  }
  return n;
}

for (const fn of FUNCTIONS) {
  const dest = join(ROOT, 'supabase/functions', fn, '_lib');
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });

  for (const dir of SHARED) {
    cpSync(join(ROOT, 'src/lib', dir), join(dest, dir), { recursive: true });
  }
  console.log(`✓ ${relative(ROOT, dest)}  (${stamp(dest)} קבצים)`);
}

console.log('\nמקור האמת: src/lib/ — אל תערכו את היעד.');
console.log('פריסה דרך ה-Dashboard: להעלות את כל תיקיית הפונקציה, כולל _lib/.');
