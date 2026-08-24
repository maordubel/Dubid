/**
 * sync-edge-shared.mjs — מעתיק את הקוד המשותף אל תיקיית ה-Edge Functions.
 *
 * ★ הבעיה
 *
 * הפריסה נכשלה עם:
 *   Module not found "file:///src/lib/scoring/engine.ts"
 *
 * ה-bundler של Supabase רואה **רק** את תיקיית הפונקציה. ייבוא כמו
 * `../../../src/lib/scoring/engine.ts` עובד מקומית ונשבר בפריסה.
 *
 * ★ שתי דרכים גרועות ואחת טובה
 *
 *   ✗ להעתיק את המנוע ידנית — שני עותקים שיתפצלו תוך שבועיים
 *   ✗ לפרסם חבילה ל-npm — תקורה ענקית לשלושה קבצים
 *   ✓ להעתיק אוטומטית לפני כל פריסה, ולסמן את היעד כ"נוצר אוטומטית"
 *
 * מקור האמת נשאר `src/lib/`. התיקייה `supabase/functions/_shared/`
 * היא תוצר בנייה — לא עורכים אותה, והיא ב-.gitignore.
 *
 * הרצה:  npm run sync:edge     (רץ אוטומטית לפני deploy:edge)
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = join(ROOT, 'supabase/functions/_shared');

/** מה מועתק. הנתיבים יחסיים ל-src/lib. */
const SHARED = ['scoring', 'events'];

const BANNER = `/**
 * ⚠ נוצר אוטומטית — אל תערכו כאן.
 *
 * הועתק מ-src/lib/ על ידי scripts/sync-edge-shared.mjs.
 * כל שינוי כאן יימחק בפריסה הבאה. ערכו את המקור.
 */
`;

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });

let count = 0;
for (const dir of SHARED) {
  cpSync(join(ROOT, 'src/lib', dir), join(DEST, dir), { recursive: true });
}

/** מוסיף את הבאנר לכל קובץ שהועתק, כדי שאיש לא יערוך אותו בטעות. */
function stamp(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { stamp(full); continue; }
    if (!entry.name.endsWith('.ts')) continue;
    writeFileSync(full, BANNER + readFileSync(full, 'utf8'));
    count += 1;
  }
}
stamp(DEST);

console.log(`✓ supabase/functions/_shared  (${count} קבצים מ-${SHARED.join(', ')})`);
console.log('  מקור האמת: src/lib/ — אל תערכו את היעד.');
