/**
 * export-edge-to-offsides.mjs — מכין את הפונקציה להעתקה לריפו של אופסיידס.
 *
 * ═══════════════════════════════════════════════════════════════════
 *  הבעיה
 * ═══════════════════════════════════════════════════════════════════
 *
 * פרויקט ה-Supabase מחובר ל-GIT של אופסיידס. אינטגרציית ה-GIT
 * פורסת את מה שיש ב-`supabase/functions/` **של אותו ריפו** — ולא
 * את מה שיש בריפו של דוביד. לכן כל קריאה לפונקציה נכשלה: היא
 * פשוט לא הייתה שם.
 *
 * ═══════════════════════════════════════════════════════════════════
 *  הפתרון, ולמה דווקא הוא
 * ═══════════════════════════════════════════════════════════════════
 *
 * שקלתי שלוש דרכים:
 *
 *   א. **פרויקט Supabase שני לדוביד.** נפסל — בעל המוצר ביקש
 *      במפורש פרויקט אחד עם `auth.users` משותף.
 *   ב. **פריסה ב-CLI בלבד, בעקיפת ה-GIT.** עובד, אבל יוצר מצב שבו
 *      חלק מהפונקציות בפרויקט מגיעות מריפו וחלק מהמחשב של מישהו.
 *      זה נשבר בשקט ביום שבו מישהו אחר פורס.
 *   ג. **הפונקציה חיה בריפו של אופסיידס.** ✔
 *
 * ג׳ הוא הנכון כי הוא הופך את מצב הקצה למצב הרגיל: **הריפו של
 * אופסיידס הוא הריפו של הפרויקט**, ולכן כל מה שהפרויקט מריץ
 * צריך לחיות בו. דוביד נשאר עצמאי לחלוטין — הקוד המקורי כאן,
 * והתיקייה שנוצרת היא תוצר בנייה.
 *
 * ★ התנאי היחיד: התיקייה חייבת לעמוד בפני עצמה. שום ייבוא
 *   מחוץ לה. `sync:edge` כבר מבטיח את זה, והסקריפט הזה **בודק**
 *   אותו — ונכשל ברעש אם נשבר.
 *
 * הרצה:  npm run export:edge
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync }
  from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FN = 'dubid-score-gameweek';
const SRC = join(ROOT, 'supabase/functions', FN);
const OUT = join(ROOT, 'dist-edge', 'supabase', 'functions', FN);

/* ── 1. לוודא ש-_lib מעודכן ── */
execSync('node scripts/sync-edge-shared.mjs', { cwd: ROOT, stdio: 'inherit' });

/* ── 2. ★ הבדיקה שמונעת חזרה של הבאג ──────────────────────────────
 *
 * כל ייבוא בתיקייה חייב להיות אחד משניים:
 *   · יחסי, ובלי `..` שיוצא מהתיקייה
 *   · URL מלא (esm.sh)
 *
 * ייבוא כמו `../../src/lib/...` עובד מצוין מקומית ונכשל בפריסה
 * בשגיאה שלא מסבירה כלום. עדיף להיכשל כאן, ברעש, עם הסבר.
 */
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]{0,300}?from\s+['"]([^'"]+)['"]/g;
const problems = [];

function audit(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { audit(full); continue; }
    if (!entry.name.endsWith('.ts')) continue;

    const src = readFileSync(full, 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1];
      if (/^https?:\/\//.test(spec)) continue;                 // esm.sh — מותר
      if (spec.startsWith('.') && !spec.startsWith('..')) continue;
      // `..` מותר רק כל עוד הוא לא מטפס מעל שורש הפונקציה.
      if (spec.startsWith('..')) {
        const depth = relative(SRC, dirname(full)).split(/[\\/]/).filter(Boolean).length;
        const ups = spec.split('/').filter((p) => p === '..').length;
        if (ups <= depth) continue;
      }
      problems.push(`${relative(ROOT, full)}  →  ${spec}`);
    }
  }
}
audit(SRC);

if (problems.length) {
  console.error('\n✖ ייבוא שיוצא מתיקיית הפונקציה — הפריסה תיכשל:\n');
  for (const p of problems) console.error('   ' + p);
  console.error('\nכל הקוד המשותף חייב לעבור דרך _lib/ (npm run sync:edge).\n');
  process.exit(1);
}

/* ── 3. הפלט ── */
rmSync(join(ROOT, 'dist-edge'), { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(SRC, OUT, { recursive: true });

const README = `# ${FN} — להעתקה לריפו של אופסיידס

נוצר אוטומטית על ידי \`npm run export:edge\` בריפו של דוביד.
**לא לערוך כאן.** מקור האמת: \`src/lib/\` בריפו של דוביד.

## מה לעשות

1. להעתיק את התיקייה \`${FN}/\` אל:

       <offsides-repo>/supabase/functions/${FN}/

2. \`git add\` · \`git commit\` · \`git push\`

אינטגרציית ה-GIT של Supabase תפרוס אותה אוטומטית לפרויקט.

## למה זה עובד עכשיו וקודם לא

התיקייה עומדת בפני עצמה: היחיד שהיא מייבאת מבחוץ הוא \`esm.sh\`.
אין בה שום \`../../src/...\`, ולכן ה-bundler — שרואה רק את התיקייה
הזו — מוצא הכל.

## Secrets שצריך בפרויקט

| שם | ערך |
|---|---|
| \`API_FOOTBALL_KEY\` | המפתח מ-api-sports |
| \`APP_ORIGIN\` | \`https://dubid.dubelteam.com\` |

\`SUPABASE_URL\` ו-\`SUPABASE_SERVICE_ROLE_KEY\` מוזרקים אוטומטית.

## קריאה

    POST https://<project>.supabase.co/functions/v1/${FN}
    Authorization: Bearer <service_role>
    { "gameweekId": "..." }

## אזהרה לגבי הריפו של אופסיידס

בתיקייה \`supabase/migrations/\` שם יושבים \`0001_schema.sql\` ו-
\`0002_rls.sql\` שיוצרים טבלאות \`cities\`, \`venues\`, \`bookings\`,
\`experiences\` — **הם לא של אופסיידס ולא של דוביד.** אם אינטגרציית
ה-GIT מריצה מיגרציות, הן ייווצרו בפרויקט. כדאי למחוק או להעביר
אותן לפני שמחברים.
`;
writeFileSync(join(ROOT, 'dist-edge', 'README.md'), README);

let files = 0;
(function count(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) count(join(d, e.name));
    else files += 1;
  }
})(OUT);

console.log(`\n✓ ${relative(ROOT, OUT)}  (${files} קבצים, עצמאית לחלוטין)`);
console.log('  להעתיק אל <offsides-repo>/supabase/functions/ ולדחוף.\n');

if (!existsSync(join(SRC, '_lib'))) {
  console.error('✖ _lib חסר. להריץ npm run sync:edge.');
  process.exit(1);
}
