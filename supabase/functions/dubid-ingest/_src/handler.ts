/**
 * Supabase Edge Function — dubid-ingest
 *
 *   POST /functions/v1/dubid-ingest
 *   x-ingest-token: <INGEST_TOKEN>
 *   { "phase": "auto" | "fixtures" | "live" | "final" | "sweep", "round": 5 }
 *
 * ═══════════════════════════════════════════════════════════════
 *  מה הפונקציה הזו עושה
 * ═══════════════════════════════════════════════════════════════
 *
 *   1. שואלת את המקור הראשי מהו המחזור הנוכחי
 *   2. מושכת לוח + סטטיסטיקה, ומושכת גם את לוח **המחזור הבא**
 *   3. מצליבה מול מקור גיבוי — אי־הסכמה על תוצאה חוסמת פרסום
 *   4. שולחת JSON קנוני אחד ל-`game.ingest_snapshot`
 *   5. מריצה `game.auto_advance()`
 *   6. אם מחזור בשל: מריצה את **מנוע הניקוד הקיים** ואז מפרסמת
 *
 * ★ שלב 6 הוא הסיבה שהפונקציה הזו לא מחשבת ניקוד בעצמה. הניקוד
 *   הרשמי רץ ב-`dubid-score-gameweek`, שמריץ את אותו מנוע TS
 *   שרץ בדפדפן. מימוש שני היה יוצר שני מספרים לאותו מחזור.
 *
 * ★ הפונקציה לא כותבת לשום טבלה. נתיב הכתיבה היחיד הוא ה-RPC.
 *
 * ═══════════════════════════════════════════════════════════════
 *  פריסה — קובץ אחד. אחד.
 * ═══════════════════════════════════════════════════════════════
 *
 * ★ שתי פריסות נכשלו לפני שהמסקנה הזו התקבלה:
 *
 *     `./_lib/ingest/x.ts`  →  Module not found בזמן bundle
 *     שישה קבצים שטוחים      →  500 בכל קריאה, בלי שורה ביומן
 *
 *   עורך ה-Dashboard מוסיף קובץ אחד בשורש בלבד, ואין דרך לוודא
 *   ממנו שכל הקבצים נשמרו ושכל ייבוא נפתר. כל קובץ נוסף הוא
 *   עוד נקודת כשל שקטה.
 *
 *   לכן `index.ts` שנפרס הוא **קובץ בודד ומלא**, בלי שום ייבוא
 *   יחסי. מקור האמת נשאר `ecosystem/feed/` + הקובץ הזה, וה-
 *   `index.ts` נבנה מהם על ידי `scripts/bundle-edge.mjs`.
 *
 * ★ `phase: "ping"` — בדיקה שלא נוגעת ברשת ולא במסד. אם היא
 *   מחזירה 200, הפונקציה נטענה כראוי והבעיה בהמשך. אם גם היא
 *   מחזירה 500, הקובץ לא נטען בכלל. שאלה אחת, תשובה חד־משמעית.
 *
 * ═══════════════════════════════════════════════════════════════
 *  סודות (Settings → Edge Functions)
 * ═══════════════════════════════════════════════════════════════
 *
 *   INGEST_TOKEN            מחרוזת אקראית. מי שלא שולח אותה — נדחה.
 *   SOFASCORE_TOURNAMENT    266   (ליגת העל)
 *   SOFASCORE_SEASON        96740 (עונת 2026/27)
 *   SCORES365_COMPETITION   42
 *
 * `SUPABASE_URL` ו-`SUPABASE_SERVICE_ROLE_KEY` מוזרקים אוטומטית.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/* ★ הייבוא הזה נמחק בבנייה (`scripts/bundle-edge.mjs`) והמודולים
   מוטמעים בקובץ אחד. הוא נשאר כאן כדי שאפשר יהיה לקרוא את
   הקובץ ולעקוב אחרי המקור. */
import { createSofascore } from '../../../../ecosystem/feed/sofascore.ts';
import { createScores365 } from '../../../../ecosystem/feed/scores365.ts';
import { reconcileFixtures } from '../../../../ecosystem/feed/reconcile.ts';
import type { Alert, Fixture, RawBlob, Snapshot, SquadMeta } from '../../../../ecosystem/feed/types.ts';
import { parse365Standings, standingsUrl } from './standings.ts';

/** מזהה בנייה — מופיע ב-ping, כדי לדעת איזו גרסה באמת פרוסה. */
const BUILD = 'dubid-ingest/4';

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? 'https://dubid.dubelteam.com',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-ingest-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
  });

/**
 * רישום כישלון שאינו יכול להיכשל בעצמו.
 *
 * ★★ הבאג שהפונקציה הזו קיימת כדי שלא יחזור ★★
 *
 * הקוד היה `supabase.rpc(...).catch(() => {})`. ב-supabase-js v2
 * הבנאי שמוחזר מ-`rpc()` הוא **thenable בלבד**: יש לו `then`,
 * ואין לו `catch`. כלומר השורה הזו זרקה
 *
 *     TypeError: supabase.rpc(...).catch is not a function
 *
 * **מתוך בלוק ה-catch עצמו.** התוצאה הייתה הגרועה מכולן:
 * השגיאה המקורית נבלעה, הפונקציה קרסה מחוץ לכל טיפול, והפלטפורמה
 * החזירה "Internal Server Error" חלק — בלי גוף, בלי שורה ביומן
 * הריצות, ובלי שום דרך לדעת מה באמת נפל. שלוש שעות של איתור
 * הלכו על שגיאה שהייתה **במטפל בשגיאות**.
 *
 * הכלל: מטפל שגיאות לא מריץ שום דבר שיכול לזרוק, ואם הוא כן —
 * הוא עטוף בעצמו.
 */
async function logFailure(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => unknown },
  args: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.rpc('ingest_log_failure', args);
  } catch {
    /* אין לאן לדווח מכאן. הגוף של התשובה עדיין נושא את השגיאה. */
  }
}

/* ------------------------------------------------------------------ *
 *  HTTP אל הספקים
 * ------------------------------------------------------------------ */
/**
 * ★ שלוש החלטות, וכל אחת נובעת מכישלון אמיתי שקורה בשטח:
 *
 *   · User-Agent של דפדפן — בקשה בלי אחד נחסמת על ידי שכבת
 *     ההגנה של האתר, וזה נראה כמו "הספק נפל".
 *   · מרווח בין בקשות — עשרים בקשות ברצף מ-IP של שרת נראות
 *     כמו סריקה. שנייה אחת עולה בכלום ומונעת חסימה.
 *   · ניסיון חוזר פעמיים, ואז ויתור — לא לולאה. פונקציה
 *     שמנסה לנצח תיגמר בטיים־אאוט בלי שום דיווח.
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/**
 * ★★ המראות — התיקון ל-403 ★★
 *
 * `api.sofascore.com` החזיר 403 לכל קריאה מה-Edge Function.
 * User-Agent של דפדפן כבר היה כאן ולא הספיק: החסימה היא על
 * מארח ה-API הישיר מכתובות של ספקי ענן, לא על הכותרות.
 *
 * אותו API מוגש גם מ-`www.sofascore.com` (המארח שהאתר עצמו
 * קורא לו) ומ-`api.sofascore.app` (המארח של האפליקציה). שלושתם
 * מחזירים את אותו JSON.
 *
 * לכן: 403/451 אינו כישלון — הוא סיבה לנסות את המראה הבאה
 * עם אותו נתיב בדיוק. הכתובת שעבדה מוחזרת בדיווח, כדי שנדע
 * מה באמת קרה ולא ננחש בפעם הבאה.
 */
const MIRRORS: Record<string, string[]> = {
  'https://api.sofascore.com': [
    'https://api.sofascore.com',
    'https://www.sofascore.com',
    'https://api.sofascore.app',
  ],
};

/** לאיזו מראה עברנו בפועל — מדווח בתשובה. */
const mirrorInUse: Record<string, string> = {};

function mirrorsFor(url: string): string[] {
  try {
    const origin = new URL(url).origin;
    return MIRRORS[origin] ?? [origin];
  } catch {
    return [];
  }
}

function swapOrigin(url: string, origin: string): string {
  try {
    const u = new URL(url);
    const o = new URL(origin);
    u.protocol = o.protocol; u.host = o.host;
    return u.toString();
  } catch {
    return url;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** כותרות של דפדפן אמיתי, כולל Referer — בלעדיו נחסמים. */
function browserHeaders(target: string): HeadersInit {
  let site = 'https://www.sofascore.com';
  try { site = new URL(target).origin.replace('api.', 'www.'); } catch { /* ignore */ }
  return {
    'user-agent': UA,
    accept: 'application/json, text/plain, */*',
    'accept-language': 'en-US,en;q=0.9,he;q=0.8',
    referer: site + '/',
    origin: site,
    'cache-control': 'no-cache',
  };
}

/** ניסיון יחיד, בלי מראות ובלי ניסיון חוזר. מחזיר גם קוד ומצב. */
export async function probeOnce(
  url: string,
  sampleBytes = 220,
): Promise<{ url: string; status: number; ok: boolean; sample?: string; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: browserHeaders(url) });
    clearTimeout(timer);
    const text = await res.text();
    return { url, status: res.status, ok: res.ok, sample: text.slice(0, sampleBytes) };
  } catch (err) {
    clearTimeout(timer);
    return { url, status: 0, ok: false, error: String(err) };
  }
}

function makeHttp(gapMs = 900) {
  let last = 0;

  return async function http(url: string): Promise<any> {
    const mirrors = mirrorsFor(url);
    /* המראה שכבר הוכיחה את עצמה בריצה הזו עולה לראש התור. */
    const origin0 = mirrors[0] ?? '';
    const preferred = mirrorInUse[origin0];
    const order = preferred
      ? [preferred, ...mirrors.filter((m) => m !== preferred)]
      : mirrors;

    let lastErr: unknown = new Error(`אין מארח לכתובת ${url}`);

    for (const origin of order.length ? order : ['']) {
      const target = origin ? swapOrigin(url, origin) : url;

      for (let attempt = 0; attempt < 3; attempt++) {
        const wait = last + gapMs - Date.now();
        if (wait > 0) await sleep(wait);
        last = Date.now();

        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15_000);
        try {
          const res = await fetch(target, {
            signal: ctrl.signal,
            headers: browserHeaders(target),
          });
          clearTimeout(timer);

          if (res.status === 429 || res.status >= 500) {
            await sleep(1500 * (attempt + 1));
            continue;
          }
          /* ★ חסימה אינה תקלה זמנית — אין טעם לנסות שוב את אותו
             מארח. עוברים למראה הבאה מיד. */
          if (res.status === 403 || res.status === 451) {
            lastErr = new Error(`HTTP ${res.status} ${target}`);
            break;
          }
          if (!res.ok) throw new Error(`HTTP ${res.status} ${target}`);

          if (origin && origin0) mirrorInUse[origin0] = origin;
          return await res.json();
        } catch (err) {
          clearTimeout(timer);
          lastErr = err;
          if (attempt === 2) break;
          await sleep(1200 * (attempt + 1));
        }
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  };
}

/** מה המראות שנבחרו בפועל — נכנס לדיווח של כל ריצה. */
function mirrorReport(): Record<string, string> {
  return { ...mirrorInUse };
}

/* ------------------------------------------------------------------ *
 *  הריצה
 * ------------------------------------------------------------------ */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  /* ★ טוקן משלו ולא רק service_role: את הפונקציה קורא pg_cron
     דרך pg_net, ואסור ש-URL שדלף יריץ קליטה. */
  const expected = Deno.env.get('INGEST_TOKEN');
  const given = req.headers.get('x-ingest-token');
  if (!expected || given !== expected) return json({ error: 'forbidden' }, 403);

  /**
   * ★★ `db: { schema: 'game' }` — הדבר היחיד שהפיל את הקליטה ★★
   *
   * כל הפונקציות והטבלאות של המוצר יושבות בסכימת `game`.
   * PostgREST מגיש כמה סכימות, אבל **ברירת המחדל היא הראשונה
   * ברשימה** — `public`. לקוח בלי `db.schema` מחפש שם, ומקבל:
   *
   *     Could not find the function public.ingest_snapshot(...)
   *     in the schema cache
   *
   * הקליינט (`src/lib/supabase.ts`) מגדיר את זה מהיום הראשון.
   * ה-Edge Functions לא — ולכן הן נכשלו בקריאה הראשונה למסד.
   */
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { db: { schema: 'game' }, auth: { persistSession: false } },
  );

  const body = await req.json().catch(() => ({} as any));
  const phase: Snapshot['phase'] | 'auto' | 'ping' | 'probe' = body?.phase ?? 'auto';

  /* ★ דופק. בלי רשת, בלי מסד, בלי תלות בשום ספק.
     זו הבדיקה שאומרת "הקובץ נטען והסודות קיימים" — והיא מפרידה
     בין תקלת פריסה לתקלת ריצה בשאלה אחת. */
  if (phase === 'ping') {
    return json({
      ok: true,
      pong: true,
      version: BUILD,
      env: {
        supabaseUrl: Boolean(Deno.env.get('SUPABASE_URL')),
        serviceRole: Boolean(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')),
        tournament: Deno.env.get('SOFASCORE_TOURNAMENT') ?? null,
        season: Deno.env.get('SOFASCORE_SEASON') ?? null,
        competition: Deno.env.get('SCORES365_COMPETITION') ?? null,
      },
    });
  }

  /**
   * ★ בדיקת קווים — `phase: 'probe'`
   *
   * כשמקור נופל, השאלה היחידה שחשובה היא «מה בדיוק הוא מחזיר,
   * מכאן». את זה אי אפשר לבדוק משום מקום אחר: ה-Edge Function
   * היא היחידה שיושבת ברשת שממנה הקריאות באמת יוצאות.
   *
   * לכן היא בודקת בעצמה ומדווחת קודים, בלי לכתוב למסד ובלי
   * לגעת במחזור. `urls` בגוף הבקשה מאפשר לבדוק כתובת חדשה
   * בלי פריסה מחדש.
   */
  if (phase === 'probe') {
    const t = Deno.env.get('SOFASCORE_TOURNAMENT') ?? '266';
    const se = Deno.env.get('SOFASCORE_SEASON') ?? '96740';
    const comp = Deno.env.get('SCORES365_COMPETITION') ?? '42';
    const r = Number.isInteger(body?.round) ? body.round : 4;

    const targets: string[] = Array.isArray(body?.urls) && body.urls.length
      ? body.urls.slice(0, 12).map(String)
      : [
          `https://api.sofascore.com/api/v1/unique-tournament/${t}/season/${se}/rounds`,
          `https://www.sofascore.com/api/v1/unique-tournament/${t}/season/${se}/rounds`,
          `https://api.sofascore.app/api/v1/unique-tournament/${t}/season/${se}/rounds`,
          `https://www.sofascore.com/api/v1/unique-tournament/${t}/season/${se}/events/round/${r}`,
          `https://api.sofascore.app/api/v1/unique-tournament/${t}/season/${se}/events/round/${r}`,
          `https://webws.365scores.com/web/games/results/?appTypeId=5&langId=2&competitions=${comp}`,
          `https://webws.365scores.com/web/games/fixtures/?appTypeId=5&langId=2&competitions=${comp}`,
        ];

    /* ★ דגימה ארוכה (עד 60KB) כדי לאמת מבנה תשובה חדש לפני שכותבים לו מתאם. */
    const sampleBytes = Math.min(Math.max(Number(body?.sampleBytes) || 220, 220), 60_000);
    const results = [];
    for (const u of targets) {
      results.push(await probeOnce(u, sampleBytes));
      await sleep(400);
    }
    return json({ ok: true, version: BUILD, probe: results });
  }

  /* ★ ליגה: ללא `league` = הליגה הראשית (ישראל), בדיוק כמו קודם.
     ליגה משנית (יוון) רצה על 365scores בלבד — אין לה מקור ראשי. */
  const league: string | null = typeof body?.league === 'string' && body.league ? body.league : null;
  /* ★ sofascore מחזיר 403 מכל ה-Edge (נבדק) — כל טיק נכשל ויצר רעש והתראות.
     כבוי כברירת מחדל; 365scores הוא המקור. להפעלה חוזרת: SOFASCORE_ENABLED=1. */
  const isPrimary = Deno.env.get('SOFASCORE_ENABLED') === '1' && (league === null || body?.primary === true);
  const gwPrefix: string = typeof body?.gwPrefix === 'string' && body.gwPrefix ? body.gwPrefix : 'gw-';
  const gwCode = (n: number) => `${gwPrefix}${n}`;
  const leaguePart = league ? { league } : {};

  const http = makeHttp();
  const primary = createSofascore(http, {
    tournamentId: Number(Deno.env.get('SOFASCORE_TOURNAMENT') ?? 266),
    seasonId: Number(Deno.env.get('SOFASCORE_SEASON') ?? 96740),
  });
  const backup = createScores365(http, {
    competitionId: Number(body?.competition365 ?? Deno.env.get('SCORES365_COMPETITION') ?? 42),
  });

  let round: number | null = Number.isInteger(body?.round) ? body.round : null;
  const done: unknown[] = [];

  try {
    /* ── 1. איזה מחזור ─────────────────────────────────────── */
    let source = primary;
    let usedBackup = false;

    if (!isPrimary) {
      usedBackup = true;
      source = backup as unknown as typeof primary;
      if (round === null) round = await backup.currentRound();
    } else if (round === null) {
      try {
        round = await primary.currentRound();
      } catch (err) {
        /* ★ המקור הראשי נפל — המחזור עדיין צריך להתקדם. */
        usedBackup = true;
        source = backup as unknown as typeof primary;
        round = await backup.currentRound();
        await logFailure(supabase, {
          p_source: 'sofascore', p_phase: 'fixtures',
          p_gw_code: null, p_error: String(err),
        });
      }
    }

    /* ── 2. לוח + סטטיסטיקה ──────────────────────────────────
       ★ גם כשהמחזור התבקש במפורש (השלמה) — מקור ראשי שנחסם לא
         עוצר את הריצה. עוברים לגיבוי, שהוא כבר מקור סטטיסטיקה. */
    let fixtures: Fixture[];
    let raw: RawBlob[];
    try {
      ({ fixtures, raw } = await source.round(round!));
    } catch (err) {
      if (usedBackup) throw err;
      usedBackup = true;
      source = backup as unknown as typeof primary;
      await logFailure(supabase, {
        p_source: 'sofascore', p_phase: 'fixtures',
        p_gw_code: gwCode(round!), p_error: String(err),
      });
      ({ fixtures, raw } = await backup.round(round!));
    }
    const alerts: Alert[] = [];

    const wantStats = phase === 'auto' || phase === 'live'
      || phase === 'final' || phase === 'sweep';

    let stats: Snapshot['stats'] = [];
    let meta: SquadMeta | undefined;
    if (wantStats) {
      const got = await source.stats(fixtures);
      stats = got.stats;
      alerts.push(...got.alerts);
      raw.push(...got.raw);
      meta = (got as { meta?: SquadMeta }).meta;
    }

    /* ★ המקור הראשי ענה על הלוח אבל לא נתן סטטיסטיקה (חסימה חלקית):
       משחק שהתחיל ואין לו ולו שורה אחת → משלימים מהגיבוי, כקליטה
       נפרדת תחת שמו. אותם משחקים בדיוק (מפתח: מחזור + בית + חוץ),
       אז אין כפילות. */
    const started = fixtures.filter((f) => f.status === 'live' || f.status === 'finished');
    if (wantStats && !usedBackup && started.length > 0 && stats.length === 0) {
      try {
        const b = await backup.round(round!);
        const bs = await backup.stats(b.fixtures);
        const { data: fb, error: fbErr } = await supabase.rpc('ingest_snapshot', {
          p_source: backup.name,
          p_payload: {
            phase: 'sweep', ...leaguePart, gameweek: { number: round! },
            fixtures: b.fixtures, stats: bs.stats, alerts: bs.alerts,
            raw: [...b.raw, ...bs.raw],
          } satisfies Snapshot,
        });
        if (fbErr) throw new Error(fbErr.message);
        done.push({ statsFallback: { source: backup.name, players: bs.stats.length, report: fb } });
      } catch (err) {
        await logFailure(supabase, {
          p_source: 'scores365', p_phase: 'sweep',
          p_gw_code: gwCode(round!), p_error: `stats fallback: ${String(err)}`,
        });
      }
    }

    /* ── 3. הצלבה מול הגיבוי ───────────────────────────────── */
    if (!usedBackup) {
      try {
        const b = await backup.round(round!);
        const rec = reconcileFixtures(fixtures, b.fixtures);
        alerts.push(...rec.alerts);
        done.push({ reconciled: rec.compared, agreed: rec.agreed });
      } catch (err) {
        alerts.push({
          kind: 'source_down', severity: 'warn',
          detail: { source: 'scores365', error: String(err) },
        });
      }
    }

    /* ── 4. כתיבה — קריאה אחת, טרנזקציה אחת ────────────────── */
    const snapshot: Snapshot = {
      phase: phase === 'auto' ? 'sweep' : (phase as Snapshot['phase']),
      ...leaguePart,
      gameweek: { number: round! },
      fixtures, stats, alerts, raw,
    };

    const { data: report, error } = await supabase.rpc('ingest_snapshot', {
      p_source: usedBackup ? backup.name : primary.name,
      p_payload: snapshot,
    });
    if (error) throw new Error(`ingest_snapshot: ${error.message}`);
    done.push({ ingest: report });

    /* ── 4b. מטא־דאטה של הסגל: שווי שוק וזמינות ─────────────
       ★ אחרי הקליטה ולא לפניה: המיפוי בין מזהה הספק לשחקן
         נוצר בתוך `ingest_snapshot`, ובלעדיו כל שורה כאן
         הייתה נופלת על "שחקן לא מופה". */
    if (meta && (meta.marketValues.length > 0 || meta.availability.length > 0)) {
      const source = primary.name;

      const { data: valueReport } = await supabase.rpc('ingest_set_market_values', {
        p_rows: meta.marketValues.map((v) => ({ ...v, source })),
      });
      const { data: availReport } = await supabase.rpc('ingest_set_availability', {
        p_rows: meta.availability.map((a) => ({ ...a, source })),
      });
      done.push({ marketValues: valueReport, availability: availReport });

      /* ★ תמחור מחדש רק כששווי באמת זז. הפעימה רצה כל עשר
         דקות; תמחור מחדש בכל אחת מהן הוא עומס על כלום, והוא
         גם היה מייצר רעש ביומן הביקורת. */
      if ((valueReport as any)?.updated > 0) {
        const { data: priceReport } = await supabase.rpc('admin_reprice_from_market', {
          p_dry_run: false,
        });
        done.push({ reprice: priceReport });
      }
    }

    /* ── 4c. טבלת הליגה הרשמית ────────────────────────────────
       ★ בקשה אחת לליגה. המסד מסרב לטבלה חלקית/לא ממופה, כך שמבנה
         תשובה שהשתנה = אין טבלה במסך, לעולם לא טבלה שגויה. כישלון כאן
         לא מפיל את הקליטה. */
    if (league) {
      try {
        const comp = Number(body?.competition365 ?? Deno.env.get('SCORES365_COMPETITION') ?? 42);
        const rows = parse365Standings(await http(standingsUrl(comp)), comp);
        if (rows.length > 0) {
          const { data: st, error: stErr } = await supabase.rpc('ingest_set_standings', {
            p_league: league, p_source: 'scores365', p_rows: rows,
          });
          done.push({ standings: stErr ? `error: ${stErr.message}` : st });
        } else {
          done.push({ standings: 'no_rows' });
        }
      } catch (err) {
        done.push({ standings: `error: ${String(err)}` });
      }
    }

    /* ── 5. המחזור הבא — לוח בלבד, כדי שייווצר בזמן ───────── */
    //  ★ בלי זה, המחזור הבא נולד רק אחרי שהנוכחי פורסם, והמשתמש
    //    מגלה את המשחקים שלו יום לפני הדדליין.
    try {
      const next = await source.round(round! + 1);
      if (next.fixtures.length > 0) {
        const { data: nextReport } = await supabase.rpc('ingest_snapshot', {
          p_source: usedBackup ? backup.name : primary.name,
          p_payload: {
            phase: 'fixtures',
            ...leaguePart,
            gameweek: { number: round! + 1 },
            fixtures: next.fixtures,
            stats: [], alerts: [], raw: next.raw,
          } satisfies Snapshot,
        });
        done.push({ nextRound: nextReport });
      }
    } catch {
      /* המחזור הבא עוד לא פורסם — מצב תקין לחלוטין */
    }

    /* ── 6. מחזור החיים ────────────────────────────────────── */
    const { data: advance, error: advErr } = await supabase.rpc('auto_advance');
    if (advErr) throw new Error(`auto_advance: ${advErr.message}`);
    done.push({ advance });

    /* ── 7. ניקוד רשמי ואז פרסום ───────────────────────────── */
    const ready = (advance as any)?.readyToPublish as string | null;
    if (ready) {
      const { data: gw } = await supabase
        .from('gameweeks').select('id').eq('code', ready).single();

      if (gw?.id) {
        const scored = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/dubid-score-gameweek`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            },
            body: JSON.stringify({ gameweekId: gw.id }),
          },
        );

        /* ★ הדוח, לא קוד ה-HTTP. «200» אינו «נוקדו כולם»: בעבר
           פרסום קרה גם כשלא נוקד אף הרכב. השער האטומי במסד
           (`publish_scored_gameweek`) משווה את הדוח למה שהוא סופר. */
        let report: any = null;
        try { report = await scored.json(); } catch { /* נבדק מיד */ }

        if (!scored.ok || !report || typeof report.fingerprint !== 'string') {
          await logFailure(supabase, {
            p_source: 'scoring', p_phase: 'final',
            p_gw_code: ready,
            p_error: `score-gameweek ${scored.status}${report?.error ? ` ${report.error}` : ''}`,
          });
          done.push({ publish: 'skipped_scoring_failed' });
        } else {
          const failures = Array.isArray(report.failures) ? report.failures.length : 0;
          const { data: gate, error: pubErr } = await supabase.rpc('publish_scored_gameweek', {
            p_gw_code: ready,
            p_scored: Number(report.scored ?? 0),
            p_fingerprint: report.fingerprint,
            p_failures: failures,
          });
          if (pubErr) {
            done.push({ publish: `failed: ${pubErr.message}` });
          } else if (gate && gate.ok === false) {
            /* סירוב הוא ערך, לא חריגה: ההתראה והביקורת כבר נכתבו
               במסד, והפעימה הבאה תנסה שוב. */
            done.push({ publish: `refused: ${gate.reason}` });
          } else {
            done.push({ publish: ready });
          }
        }
      }
    }

    return json({ ok: true, round, source: usedBackup ? 'backup' : 'primary',
                  mirrors: mirrorReport(), done });

  } catch (err) {
    /* ★ התשובה נבנית **לפני** הרישום. אם הרישום ייפול, המשתמש
       עדיין מקבל את השגיאה האמיתית בגוף התשובה — וזה מה
       שמופיע בכרטיס "פעימות" במסך הקליטה. */
    const response = json({ ok: false, error: String(err), round,
                            mirrors: mirrorReport() }, 500);

    await logFailure(supabase, {
      p_source: 'dubid-ingest',
      p_phase: phase === 'auto' ? 'sweep' : String(phase),
      p_gw_code: round ? gwCode(round) : null,
      p_error: String(err),
    });

    return response;
  }
});
