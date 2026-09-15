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
 * ★★ `dubid-ingest` אינה כאן ★★
 *
 * גם `_lib/` וגם שישה קבצים שטוחים נכשלו בפריסה דרך הדפדפן.
 * היא נבנית לקובץ **אחד** על ידי `scripts/bundle-edge.mjs`.
 * ראו את ההסבר המלא שם.
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

/**
 * כל פונקציה שצריכה את הקוד המשותף, ומה היא צריכה.
 *
 * ★ למה מפה ולא רשימה אחת: `dubid-ingest` לא צריכה את מנוע
 *   הניקוד, ו-`dubid-score-gameweek` לא צריכה את המתאמים.
 *   העתקה "ליתר ביטחון" מנפחת כל פריסה ומכניסה תלות בין שתי
 *   פונקציות שאין ביניהן קשר.
 */
const FUNCTIONS = {
    /* ★ `ruleOverrides.ts` נמצא כאן כי בלעדיו היו **שני מקורות
     חוקים**: הקליינט קרא ל-`game.scoring_rules()` והחיל
     override-ים, והפונקציה קראה טבלה אחרת לגמרי. האדמין היה
     משנה בישול ל-4, המסך היה מראה 4, והניקוד הרשמי היה נשאר 3. */
  'dubid-score-gameweek': { dirs: ['scoring', 'events'], files: ['ruleOverrides.ts'] },
};

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

for (const [fn, what] of Object.entries(FUNCTIONS)) {
  const root = join(ROOT, 'supabase/functions', fn);

  const dest = join(root, '_lib');
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });

  for (const dir of what.dirs) {
    cpSync(join(ROOT, 'src/lib', dir), join(dest, dir), { recursive: true });
  }
  for (const file of what.files) {
    cpSync(join(ROOT, 'src/lib', file), join(dest, file));
  }
  console.log(`✓ ${relative(ROOT, dest)}  (${stamp(dest)} קבצים)`);
}

console.log('\nמקור האמת: src/lib/ — אל תערכו את היעד.');
console.log('פריסה: dubid-score-gameweek — כל התיקייה כולל _lib/.  dubid-ingest — node scripts/bundle-edge.mjs.');
