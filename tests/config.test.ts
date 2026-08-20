/**
 * טסטים לקבצי התצורה של הפריסה.
 *
 * הטסטים האלה נולדו מבאג אמיתי: הכנסתי מפתח `"//"` בתור הערה בתוך
 * `headers[0]` ב-vercel.json, ו-Vercel דחה את כל הפריסה עם
 * `headers[0] should NOT have additional property '//'`.
 * JSON לא תומך בהערות, ולסכמה של Vercel אין סובלנות למפתחות זרים.
 *
 *   node --experimental-strip-types --test tests/config.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

/* ------------------------------------------------------------------ */
/* vercel.json                                                         */
/* ------------------------------------------------------------------ */

/** מפתחות שהסכמה של Vercel מכירה ברמה העליונה. */
const TOP_LEVEL = new Set([
  '$schema', 'buildCommand', 'cleanUrls', 'crons', 'devCommand', 'framework',
  'functions', 'git', 'headers', 'ignoreCommand', 'images', 'installCommand',
  'outputDirectory', 'public', 'redirects', 'regions', 'rewrites',
  'trailingSlash',
]);

const HEADER_ENTRY = new Set(['source', 'headers', 'has', 'missing']);
const HEADER_PAIR = new Set(['key', 'value']);
const ROUTE_ENTRY = new Set(['source', 'destination', 'permanent', 'statusCode', 'has', 'missing']);

test('vercel.json הוא JSON תקין', () => {
  assert.ok(existsSync(join(ROOT, 'vercel.json')), 'vercel.json חסר');
  assert.doesNotThrow(() => read('vercel.json'));
});

test('vercel.json מכיל רק מפתחות שהסכמה מכירה', () => {
  const cfg = read('vercel.json');
  for (const key of Object.keys(cfg)) {
    assert.ok(TOP_LEVEL.has(key), `מפתח לא מוכר ברמה העליונה: "${key}"`);
  }
});

test('★ אין מפתחות-הערה בתוך headers — זה מה ששבר את הפריסה', () => {
  const cfg = read('vercel.json');
  for (const [i, entry] of (cfg.headers ?? []).entries()) {
    for (const key of Object.keys(entry)) {
      assert.ok(
        HEADER_ENTRY.has(key),
        `headers[${i}] מכיל מפתח לא חוקי "${key}". ` +
        'ל-JSON אין הערות — כתבו את ההסבר ב-DEPLOY.md.',
      );
    }
    for (const [j, pair] of (entry.headers ?? []).entries()) {
      for (const key of Object.keys(pair)) {
        assert.ok(HEADER_PAIR.has(key), `headers[${i}].headers[${j}]: מפתח לא חוקי "${key}"`);
      }
      assert.equal(typeof pair.key, 'string');
      assert.equal(typeof pair.value, 'string');
    }
  }
});

test('rewrites ו-redirects מכילים רק מפתחות חוקיים', () => {
  const cfg = read('vercel.json');
  for (const group of ['rewrites', 'redirects'] as const) {
    for (const [i, entry] of (cfg[group] ?? []).entries()) {
      for (const key of Object.keys(entry)) {
        assert.ok(ROUTE_ENTRY.has(key), `${group}[${i}]: מפתח לא חוקי "${key}"`);
      }
    }
  }
});

test('יש fallback ל-SPA, אחרת רענון בכתובת פנימית מחזיר 404', () => {
  const cfg = read('vercel.json');
  const fallback = (cfg.rewrites ?? []).some(
    (r: { destination: string }) => r.destination === '/index.html',
  );
  assert.ok(fallback, 'חסר rewrite ל-/index.html');
});

test('Service Worker לא נשמר במטמון', () => {
  const cfg = read('vercel.json');
  const sw = (cfg.headers ?? []).find((h: { source: string }) => h.source === '/sw.js');
  assert.ok(sw, 'חסר header ל-/sw.js');
  const cacheControl = sw.headers.find((h: { key: string }) => h.key === 'Cache-Control');
  assert.match(cacheControl.value, /no-store|no-cache/);
});

/* ------------------------------------------------------------------ */
/* package.json                                                        */
/* ------------------------------------------------------------------ */

test('הפרויקט נבנה מהשורש עם הסקריפטים שהפריסה מצפה להם', () => {
  const pkg = read('package.json');
  assert.equal(pkg.type, 'module');
  for (const script of ['dev', 'build', 'test', 'typecheck', 'build:squads']) {
    assert.ok(pkg.scripts?.[script], `חסר script: ${script}`);
  }
  // הבנייה לא חוסמת על טיפוסים — בדיקת הטיפוסים רצה ב-CI.
  // אחרת שגיאת טיפוס אחת מפילה פריסה לפרודקשן.
  assert.equal(pkg.scripts.build, 'vite build');
  assert.ok(pkg.dependencies?.react, 'react חייב להיות ב-dependencies ולא ב-devDependencies');
});

/* ------------------------------------------------------------------ */
/* manifest + index.html                                               */
/* ------------------------------------------------------------------ */

test('ה-manifest תקין ומצביע על אייקונים שקיימים', () => {
  const m = read('public/manifest.webmanifest');
  assert.equal(m.display, 'standalone');
  assert.equal(m.dir, 'rtl');
  assert.equal(m.lang, 'he');
  for (const icon of m.icons) {
    const path = join(ROOT, 'public', icon.src);
    assert.ok(existsSync(path), `אייקון חסר: ${icon.src}`);
  }
  assert.ok(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable'),
    'חסר אייקון maskable — באנדרואיד הוא ייחתך');
});

test('index.html כולל viewport-fit=cover, אחרת safe-area מחזיר 0', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /<html lang="he" dir="rtl">/);
  assert.match(html, /\/src\/main\.tsx/);
});
