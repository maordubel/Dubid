/**
 * טסטים לטיפוגרפיה — הכלל שמחזיק את המוצר כעיתון אחד.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ הכלל
 * ═══════════════════════════════════════════════════════════════
 *
 * `font-press` (Frank Ruhl Libre, סריפי) הוא הגופן של **כותרות**.
 * `font-sans` הוא גוף הטקסט. `font-poster` (Anton) הוא מספרים.
 *
 * הכלל המדויק: כל `<h1>`/`<h2>`/`<h3>` שמגדיר משפחת גופן — מגדיר
 * `font-press`. לא `font-display`, לא `font-poster`.
 *
 * ★ למה זו בדיקה ולא הנחיה בקובץ עיצוב
 *
 * כי הכלל הזה נשבר **בשקט**. מסך חדש שנכתב בהעתקה ממסך ישן
 * מביא איתו `font-display`, הכותרת נראית "בסדר", ואיש לא שם לב
 * שהיא הגופן היחיד במוצר שלא שייך לעיתון. אחרי חמישה מסכים
 * כאלה האווירה נעלמה ואי אפשר להצביע על השינוי שגרם לזה.
 *
 *   node --experimental-strip-types --test tests/typography.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return name.endsWith('.tsx') ? [full] : [];
  });
}

const FILES = tsxFiles('src');

test('כל כותרת שמגדירה גופן מגדירה font-press', () => {
  const offenders: string[] = [];

  for (const file of FILES) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/font-(display|poster)\b/.test(line)) return;
      /* הכותרת יכולה להיפתח בשורה הקודמת: <h2\n  className=... */
      const near = line + (i > 0 ? lines[i - 1] : '');
      if (/<h[123]\b/.test(near)) offenders.push(`${file}:${i + 1}`);
    });
  }

  assert.deepEqual(offenders, [], `כותרות שאינן font-press: ${offenders.join(', ')}`);
});

test('font-press אכן מוגדר בקונפיג של Tailwind', () => {
  const cfg = readFileSync('tailwind.config.ts', 'utf8');
  assert.match(cfg, /press:\s*\[/, 'חסרה משפחת press');
  assert.match(cfg, /Frank\+?\s?Ruhl\s?Libre/i, 'הגופן עצמו לא מופיע');
});

test('הגופן נטען בפועל מ-index.html', () => {
  /* ★ קונפיג בלי טעינה = fallback שקט. הכותרות היו נראות
     כמו Georgia, וזה לא היה מפיל שום בדיקה אחרת. */
  const html = readFileSync('index.html', 'utf8');
  assert.match(html, /fonts\.googleapis\.com[^"]*Frank\+Ruhl\+Libre/);
  assert.match(html, /display=swap/, 'בלי swap הטקסט נעלם עד שהגופן נטען');
});

test('הפלטה הכהה של העיתון קיימת ומוגדרת במלואה', () => {
  const src = readFileSync('src/lib/pressPalette.ts', 'utf8');
  for (const key of ['paper', 'ink', 'rule', 'gold', 'red', 'grass']) {
    assert.match(src, new RegExp(`NIGHT_PRESS[\\s\\S]*\\b${key}:`), key);
  }
});
