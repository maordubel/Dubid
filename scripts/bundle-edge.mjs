/**
 * scripts/bundle-edge.mjs — מאחד את `dubid-ingest` לקובץ אחד.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ למה
 * ═══════════════════════════════════════════════════════════════
 *
 * שתי פריסות נכשלו לפני שהקובץ הזה נכתב:
 *
 *   `./_lib/ingest/x.ts`   →  "Module not found" בזמן bundle.
 *                             עורך ה-Dashboard לא יוצר תיקיות.
 *   שישה קבצים שטוחים      →  500 בכל קריאה, בלי שורה ביומן.
 *                             קובץ שלא נשמר נראה בדיוק כמו קובץ
 *                             שנשמר, ואי אפשר לאמת מהעורך.
 *
 * הפריסה היחידה שאי אפשר לטעות בה היא הדבקה אחת של קובץ אחד.
 *
 * ★ מקור האמת לא זז: `src/lib/ingest/*.ts` (נבדקים ב-npm test)
 *   ו-`supabase/functions/dubid-ingest/_src/handler.ts`.
 *   הקובץ הנפרס הוא תוצר בנייה, ומסומן ככזה.
 *
 * ★ למה concat ולא bundler אמיתי: אין תלויות npm, אין שלב
 *   התקנה, והתוצאה קריאה לאדם. השמות בין המודולים כבר אינם
 *   מתנגשים (`mapSofaStatus` / `map365Status`), וזה נבדק כאן.
 *
 * הרצה:  node scripts/bundle-edge.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** סדר תלות. types ראשון, המנהל אחרון. */
const MODULES = [
  'src/lib/ingest/types.ts',
  'src/lib/ingest/derive.ts',
  'src/lib/ingest/reconcile.ts',
  'src/lib/ingest/sofascore.ts',
  'src/lib/ingest/scores365.ts',
];
const HANDLER = 'supabase/functions/dubid-ingest/_src/handler.ts';
const OUT = 'supabase/functions/dubid-ingest/index.ts';

/**
 * מסיר ייבוא יחסי (כולל רב־שורתי) ומשאיר ייבוא מרוחק.
 *
 * ★ `esm.sh` נשאר ועולה לראש הקובץ: הוא התלות היחידה, והוא
 *   חייב להופיע לפני כל שימוש.
 */
function strip(source) {
  const remote = [];
  const out = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^\s*import\b/.test(line)) { out.push(line); continue; }

    /* ייבוא רב־שורתי: אוספים עד השורה שמסתיימת ב-';' */
    let block = line;
    while (!/;\s*$/.test(block) && i + 1 < lines.length) block += '\n' + lines[++i];

    if (/from\s+['"]\.{1,2}\//.test(block)) continue;      // יחסי → נמחק
    remote.push(block);                                     // מרוחק → נשמר
  }
  return { body: out.join('\n').trim(), remote };
}

const remoteImports = new Set();
const parts = [];

for (const rel of [...MODULES, HANDLER]) {
  const { body, remote } = strip(readFileSync(join(ROOT, rel), 'utf8'));
  remote.forEach((r) => remoteImports.add(r.trim()));
  parts.push(`/* ── ${rel} ──────────────────────────────────── */\n\n${body}`);
}

/* ★ בדיקת התנגשות שמות. מודול שמגדיר שם שכבר קיים היה יוצר
   קובץ ש"נראה תקין" ונופל בטעינה — בדיוק סוג הכשל שהקובץ הזה
   בא למנוע. נכשל כאן, לא בייצור. */
const declared = new Map();
const DECL = /^export\s+(?:const|function|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)|^(?:const|function|class)\s+([A-Za-z_$][\w$]*)/gm;
parts.forEach((part, idx) => {
  const where = [...MODULES, HANDLER][idx];
  for (const m of part.matchAll(DECL)) {
    const name = m[1] ?? m[2];
    if (declared.has(name)) {
      console.error(`✗ התנגשות שם: "${name}" מוגדר גם ב-${declared.get(name)} וגם ב-${where}`);
      process.exit(1);
    }
    declared.set(name, where);
  }
});

const banner = `/**
 * ⚠ נוצר אוטומטית — אל תערכו כאן.
 *
 * נבנה על ידי scripts/bundle-edge.mjs מתוך:
 *   src/lib/ingest/*.ts
 *   supabase/functions/dubid-ingest/_src/handler.ts
 *
 * ★ קובץ אחד בכוונה. פריסה דרך ה-Dashboard היא הדבקה אחת:
 *   Edge Functions → dubid-ingest → index.ts → להחליף הכל.
 *   כל קובץ נוסף הוא עוד נקודת כשל שקטה, וכבר היו שתיים.
 */
`;

writeFileSync(
  join(ROOT, OUT),
  [banner, [...remoteImports].join('\n'), '', parts.join('\n\n')].join('\n') + '\n',
);

const lines = readFileSync(join(ROOT, OUT), 'utf8').split('\n').length;
console.log(`✓ ${OUT}  (${lines} שורות, ${declared.size} הגדרות, אפס ייבוא יחסי)`);
