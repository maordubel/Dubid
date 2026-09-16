/**
 * tests/edge-handler.test.ts — הפונקציה שנפרסת, על מסלולי הכישלון שלה.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★★ למה הקובץ הזה קיים ★★
 * ═══════════════════════════════════════════════════════════════
 *
 * הפונקציה החזירה `500 Internal Server Error` בכל קריאה, שעות.
 * בלי גוף, בלי שורה ביומן הריצות, ובלי שום קצה חוט. הסיבה, כפי
 * שהתבררה מיומן ה-Edge Function:
 *
 *     TypeError: supabase.rpc(...).catch is not a function
 *
 * `rpc()` ב-supabase-js v2 מחזיר **thenable בלבד** — יש `then`,
 * אין `catch`. הקריאה ל-`.catch` נעשתה **בתוך בלוק ה-catch**,
 * ולכן היא בלעה את השגיאה המקורית והפילה את הפונקציה מחוץ לכל
 * טיפול.
 *
 * מסלול ההצלחה היה תקין לגמרי, ולכן שום בדיקה קודמת לא נגעה בזה.
 *
 * ★ הבדיקות כאן טוענות את **הקובץ שנפרס בפועל** (`index.ts`
 *   שנבנה), לא את המקור — כי זה מה שרץ בייצור.
 *
 * ★ ה-stub של supabase הוא thenable **בלי** `catch`, בכוונה
 *   מדויקת. stub נדיב יותר היה עובר, והבאג היה חוזר.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const BUNDLE = new URL('../supabase/functions/dubid-ingest/index.ts', import.meta.url);

/** בדיוק כמו PostgrestBuilder: `then` ותו לא. */
function pgBuilder(result: unknown) {
  return {
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(ok, bad),
  };
}

/** נשמר כדי שאפשר יהיה לבדוק איך הלקוח הוגדר. */
let lastClientOptions: any = null;

function stubSupabase(onRpc?: (fn: string) => void) {
  return (_url?: string, _key?: string, options?: unknown) => ({
    rpc: (fn: string) => {
      onRpc?.(fn);
      return pgBuilder({ data: { readyToPublish: null }, error: null });
    },
    from: () => ({
      select: () => ({ eq: () => ({ single: () => pgBuilder({ data: { id: 'gw' } }) }) }),
    }),
    __options: (lastClientOptions = options),
  });
}

const ENV: Record<string, string> = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  INGEST_TOKEN: 'secret',
  SOFASCORE_TOURNAMENT: '266',
  SOFASCORE_SEASON: '96740',
  SCORES365_COMPETITION: '42',
};

/** טוען את הבאנדל פעם אחת ומחזיר את ה-handler שנרשם ב-Deno.serve. */
async function loadHandler(): Promise<(req: Request) => Promise<Response>> {
  const g = globalThis as Record<string, any>;
  if (g.__dubidHandler) return g.__dubidHandler;

  const src = readFileSync(BUNDLE, 'utf8').replace(
    /import \{ createClient \} from 'https:\/\/esm\.sh\/@supabase\/supabase-js@2';/,
    /* ★ הפניה עקיפה ולא הצמדה: `const createClient = stub` היה
       נלכד ברגע הטעינה, וכל החלפה של ה-stub בבדיקה מאוחרת לא
       הייתה משפיעה — כלומר בדיקה שנראית עוברת ולא בודקת כלום.
       זה בדיוק קרה כאן, ולכן הקריאה נפתרת בכל פעם מחדש. */
    'const createClient = (...a: unknown[]) => (globalThis as any).__createClient(...a);',
  );
  const dir = mkdtempSync(join(tmpdir(), 'dubid-edge-'));
  const file = join(dir, 'bundle.ts');
  writeFileSync(file, src);

  g.Deno = {
    env: { get: (k: string) => ENV[k] ?? null },
    serve: (h: (req: Request) => Promise<Response>) => { g.__dubidHandler = h; },
  };
  g.__createClient = stubSupabase();

  await import(file);
  return g.__dubidHandler;
}

const post = (body: unknown, token = 'secret') =>
  new Request('https://fn.test/dubid-ingest', {
    method: 'POST',
    headers: { 'x-ingest-token': token, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/* ------------------------------------------------------------------ */
test('הקובץ הנפרס נטען ורושם handler', async () => {
  const handler = await loadHandler();
  assert.equal(typeof handler, 'function');
});

test('טוקן שגוי נדחה ב-403, בלי לגעת ברשת', async () => {
  const handler = await loadHandler();
  (globalThis as any).fetch = () => { throw new Error('לא אמור לקרות'); };

  const res = await handler(post({ phase: 'auto' }, 'wrong'));
  assert.equal(res.status, 403);
});

test('ping מחזיר 200 בלי רשת ובלי מסד', async () => {
  const handler = await loadHandler();
  (globalThis as any).fetch = () => { throw new Error('לא אמור לקרות'); };

  const res = await handler(post({ phase: 'ping' }));
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.equal(body.pong, true);
  assert.equal(body.env.supabaseUrl, true);
  assert.equal(body.env.season, '96740');
});

test('★ מסלול כישלון: מחזיר 500 עם השגיאה בגוף — ולא קורס', async () => {
  const handler = await loadHandler();

  /* כל קריאה לספק נכשלת. זה מפעיל את בלוק ה-catch — המקום
     שבו `.catch` על thenable הפיל את כל הפונקציה. */
  (globalThis as any).fetch = async () => { throw new Error('BOOM_PROVIDER'); };

  const logged: string[] = [];
  (globalThis as any).__createClient = stubSupabase((fn) => logged.push(fn));

  const res = await handler(post({ phase: 'auto' }));

  assert.equal(res.status, 500, 'הפונקציה החזירה תשובה במקום לקרוס');

  const body = await res.json() as any;
  assert.equal(body.ok, false);
  assert.ok(String(body.error).length > 0, 'יש שגיאה בגוף — זה מה שהמסך מציג');

  /* ★ הטענה המדויקת: השגיאה שחוזרת היא של **שכבת הספקים**,
     ולא TypeError של מטפל השגיאות עצמו. בדיוק זה קרה בייצור:
     "supabase.rpc(...).catch is not a function" בלע את הסיבה
     האמיתית, והפונקציה קרסה מחוץ לכל טיפול. */
  assert.doesNotMatch(String(body.error), /is not a function/,
    'מטפל השגיאות לא הוא זה שנפל');

  /* ★ והרישום כן נעשה. בלי זה "לא רצה" ו"רצה ונפלה" שוב זהים. */
  assert.ok(logged.includes('ingest_log_failure'),
    'הכישלון נרשם דרך ingest_log_failure');
});

test('★ מטפל השגיאות שורד גם כשהרישום עצמו זורק', async () => {
  const handler = await loadHandler();
  (globalThis as any).fetch = async () => { throw new Error('BOOM_PROVIDER'); };

  /* המסד לא נגיש בכלל — בדיוק המצב שבו הרישום נכשל. */
  (globalThis as any).__createClient = () => ({
    rpc: () => { throw new Error('DB_DOWN'); },
    from: () => { throw new Error('DB_DOWN'); },
  });

  const res = await handler(post({ phase: 'auto' }));
  assert.equal(res.status, 500);
  const body = await res.json() as any;
  assert.equal(body.ok, false);
  assert.doesNotMatch(String(body.error), /DB_DOWN|is not a function/,
    'השגיאה שחוזרת היא של העבודה, לא של הרישום שנכשל אחריה');
});

test('★ הלקוח מוגדר לסכימת game — לא ל-public', async () => {
  const handler = await loadHandler();
  (globalThis as any).fetch = () => { throw new Error('לא אמור לקרות'); };
  (globalThis as any).__createClient = stubSupabase();

  /* ping לא נוגע במסד, ולכן מספיק כדי ליצור את הלקוח. */
  await handler(post({ phase: 'ping' }));

  /* ★ הבאג בייצור:
       Could not find the function public.ingest_snapshot(...)
     PostgREST מגיש כמה סכימות, אבל ברירת המחדל היא הראשונה
     ברשימה — `public`. כל הפונקציות של המוצר ב-`game`. */
  assert.equal(lastClientOptions?.db?.schema, 'game',
    'בלי זה כל קריאה למסד נופלת על "schema cache"');
});

/* ================================================================== *
 *  dubid-score-gameweek — אותה פריסה, אותן מלכודות
 * ================================================================== */

/**
 * ★ הפונקציה הזו נפרסה עד היום כ-`index.ts` + `_lib/`, וזה נכשל
 *   ב-"Module not found .../_lib/scoring/engine.ts" באותו אופן
 *   בדיוק. היא מאוחדת עכשיו לקובץ אחד, והבדיקה כאן מוודאת
 *   שהקובץ המאוחד באמת נטען — ושהוא מדבר עם סכימת `game`.
 */
test('★ בונדל הניקוד נטען, ומוגדר לסכימת game', async () => {
  const src = readFileSync(
    new URL('../supabase/functions/dubid-score-gameweek/index.ts', import.meta.url),
    'utf8',
  ).replace(
    /import \{ createClient \} from 'https:\/\/esm\.sh\/@supabase\/supabase-js@2';/,
    'const createClient = (...a: unknown[]) => (globalThis as any).__createClient(...a);',
  );

  const dir = mkdtempSync(join(tmpdir(), 'dubid-score-'));
  const file = join(dir, 'bundle.ts');
  writeFileSync(file, src);

  const g = globalThis as Record<string, any>;
  let handler: ((req: Request) => Promise<Response>) | null = null;
  g.Deno = {
    env: { get: (k: string) => ENV[k] ?? null },
    serve: (h: (req: Request) => Promise<Response>) => { handler = h; },
  };
  g.__createClient = stubSupabase();
  lastClientOptions = null;

  await import(file);
  assert.equal(typeof handler, 'function', 'הבונדל נטען ורשם handler');

  /* בלי gameweekId היא נעצרת לפני המסד — מספיק כדי ליצור לקוח. */
  const res = await handler!(new Request('https://fn.test/score', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  }));
  assert.equal(res.status, 400);
  assert.equal(lastClientOptions?.db?.schema, 'game');
});

/* ================================================================== *
 *  ★★ המראות — התיקון ל-403 ★★
 *
 *  `api.sofascore.com` החזיר 403 לכל קריאה מה-Edge Function, וכל
 *  מחזור 4 נשאר בלי שורת סטטיסטיקה אחת. User-Agent של דפדפן כבר
 *  היה שם — החסימה הייתה על המארח, לא על הכותרות.
 *
 *  הבדיקות כאן טוענות שני דברים שאי אפשר לראות בעין:
 *    · 403 מעביר למראה הבאה **עם אותו נתיב בדיוק**;
 *    · 403 אינו גורר ניסיון חוזר על אותו מארח — חסימה אינה תקלה
 *      זמנית, ושלושה ניסיונות עליה הם רק בזבוז של חלון ההרצה.
 * ================================================================== */
test('★ 403 עובר למראה הבאה, ושומר על הנתיב', async () => {
  const handler = await loadHandler();

  const seen: string[] = [];
  (globalThis as any).fetch = async (url: string) => {
    seen.push(String(url));
    if (String(url).startsWith('https://api.sofascore.com')) {
      return new Response('blocked', { status: 403 });
    }
    return new Response(JSON.stringify({ rounds: [{ round: 4 }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  (globalThis as any).__createClient = stubSupabase();

  await handler(post({ phase: 'auto' }));

  const blocked = seen.filter((u) => u.startsWith('https://api.sofascore.com'));
  const mirrored = seen.filter(
    (u) => u.startsWith('https://www.sofascore.com') ||
           u.startsWith('https://api.sofascore.app'));

  assert.ok(blocked.length > 0, 'המארח החסום לא נוסה כלל');
  assert.ok(mirrored.length > 0, '403 לא הפעיל מראה חלופית');

  /* אותו נתיב, מארח אחר — אחרת קיבלנו כתובת אחרת ולא מראה. */
  const path = (u: string) => new URL(u).pathname + new URL(u).search;
  assert.ok(
    mirrored.some((m) => blocked.some((b) => path(b) === path(m))),
    'המראה נקראה בנתיב שונה מזה שנחסם',
  );
});

test('★ 403 אינו מנוסה שוב על אותו מארח', async () => {
  const handler = await loadHandler();

  const perHost: Record<string, number> = {};
  (globalThis as any).fetch = async (url: string) => {
    const host = new URL(String(url)).host;
    perHost[host] = (perHost[host] ?? 0) + 1;
    return new Response('blocked', { status: 403 });
  };
  (globalThis as any).__createClient = stubSupabase();

  await handler(post({ phase: 'auto' }));

  for (const [host, n] of Object.entries(perHost)) {
    assert.ok(n <= 2, `${host} נוסה ${n} פעמים — חסימה אינה תקלה זמנית`);
  }
});

test('★ probe מדווח קודים ואינו נוגע במסד', async () => {
  const handler = await loadHandler();

  (globalThis as any).fetch = async (url: string) =>
    String(url).startsWith('https://api.sofascore.com')
      ? new Response('nope', { status: 403 })
      : new Response('[]', { status: 200 });

  const rpcs: string[] = [];
  (globalThis as any).__createClient = stubSupabase((fn) => rpcs.push(fn));

  const res = await handler(post({ phase: 'probe', round: 4 }));
  assert.equal(res.status, 200);

  const body = await res.json() as any;
  assert.ok(Array.isArray(body.probe), 'probe לא החזיר רשימה');
  assert.ok(body.probe.length >= 5, 'probe בדק פחות מדי כתובות');
  assert.equal(body.probe.find((p: any) => p.url.startsWith('https://api.sofascore.com')).status, 403);
  assert.ok(body.probe.some((p: any) => p.ok), 'אף כתובת לא הצליחה');
  assert.deepEqual(rpcs, [], 'probe נגע במסד');
});
