/**
 * scripts/bundle-edge.mjs — מאחד כל Edge Function לקובץ אחד.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ למה
 * ═══════════════════════════════════════════════════════════════
 *
 * עורך ה-Dashboard לא יוצר תיקיות. "Add File" מוסיף קובץ אחד
 * בשורש הפונקציה, ותו לא. שלוש פריסות נכשלו לפני שזו הייתה
 * המסקנה:
 *
 *   `./_lib/ingest/x.ts`       →  Module not found
 *   שישה קבצים שטוחים          →  500 בלי שורה ביומן
 *   `./_lib/scoring/engine.ts` →  Module not found (שוב, בפונקציה השנייה)
 *
 * הפריסה היחידה שאי אפשר לטעות בה היא הדבקה אחת של קובץ אחד.
 *
 * ★ מקור האמת לא זז: `src/lib/**` (נבדק ב-npm test) ו-
 *   `<function>/_src/`. הקובץ הנפרס הוא תוצר בנייה.
 *
 * ★ התלויות נפתרות לבד. רשימה ידנית של מודולים הייתה נשברת
 *   בשקט ברגע שמישהו מוסיף ייבוא — והתוצאה היא קובץ שנראה
 *   תקין ונופל בטעינה.
 *
 * הרצה:  node scripts/bundle-edge.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const FUNCTIONS = [
  { name: 'dubid-ingest',         entry: '_src/handler.ts' },
  { name: 'dubid-score-gameweek', entry: '_src/index.ts'   },
];

/** מפריד ייבוא יחסי (נמחק, התוכן מוטמע) ממרוחק (נשמר). */
function parse(file) {
  const source = readFileSync(file, 'utf8');
  const lines = source.split('\n');
  const body = [];
  const local = [];
  const remote = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^\s*import\b/.test(line)) { body.push(line); continue; }

    let block = line;
    while (!/;\s*$/.test(block) && i + 1 < lines.length) block += '\n' + lines[++i];

    const m = block.match(/from\s+['"](\.{1,2}\/[^'"]+)['"]/);
    if (m) { local.push(resolve(dirname(file), m[1])); continue; }
    remote.push(block.trim());
  }
  return { body: body.join('\n').trim(), local, remote };
}

/** סדר טופולוגי: תלות לפני מי שתלוי בה. */
function collect(entry, seen = new Map(), order = []) {
  if (seen.has(entry)) return order;
  seen.set(entry, true);
  const parsed = parse(entry);
  for (const dep of parsed.local) collect(dep, seen, order);
  order.push({ file: entry, ...parsed });
  return order;
}

const BANNER = (name, sources) => `/**
 * ⚠ נוצר אוטומטית — אל תערכו כאן.
 *
 * נבנה על ידי scripts/bundle-edge.mjs מתוך:
${sources.map((s) => ` *   ${s}`).join('\n')}
 *
 * ★ קובץ אחד בכוונה. פריסה דרך ה-Dashboard היא הדבקה אחת:
 *   Edge Functions → ${name} → index.ts → להחליף הכל.
 *   עורך ה-Dashboard לא יוצר תיקיות, וכל קובץ נוסף הוא עוד
 *   נקודת כשל שקטה. כבר היו שלוש.
 */
`;

let failed = false;

for (const fn of FUNCTIONS) {
  const entry = join(ROOT, 'supabase/functions', fn.name, fn.entry);
  const modules = collect(entry);

  /* ★ התנגשות שם בין מודולים שמוטמעים יחד יוצרת קובץ שנראה
     תקין ונופל בטעינה. נכשל כאן, לא בייצור. */
  const declared = new Map();
  const DECL = /^export\s+(?:const|function|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)|^(?:const|function|class)\s+([A-Za-z_$][\w$]*)/gm;

  for (const m of modules) {
    for (const hit of m.body.matchAll(DECL)) {
      const name = hit[1] ?? hit[2];
      if (declared.has(name)) {
        console.error(`✗ ${fn.name}: התנגשות שם "${name}" — ` +
          `${relative(ROOT, declared.get(name))} מול ${relative(ROOT, m.file)}`);
        failed = true;
      }
      declared.set(name, m.file);
    }
  }

  const remote = [...new Set(modules.flatMap((m) => m.remote))];
  const sources = modules.map((m) => relative(ROOT, m.file));
  const parts = modules.map((m) =>
    `/* ── ${relative(ROOT, m.file)} ──────────────────────── */\n\n${m.body}`);

  const out = join(ROOT, 'supabase/functions', fn.name, 'index.ts');
  writeFileSync(out, [BANNER(fn.name, sources), remote.join('\n'), '', parts.join('\n\n')]
    .join('\n') + '\n');

  const lines = readFileSync(out, 'utf8').split('\n').length;
  console.log(`✓ ${relative(ROOT, out)}  (${lines} שורות · ${modules.length} מודולים · ` +
              `${declared.size} הגדרות)`);
}

if (failed) process.exit(1);
