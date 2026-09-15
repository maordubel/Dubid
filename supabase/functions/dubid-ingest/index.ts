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

import { createSofascore } from './_lib/ingest/sofascore.ts';
import { createScores365 } from './_lib/ingest/scores365.ts';
import { reconcileFixtures } from './_lib/ingest/reconcile.ts';
import type { Alert, Fixture, Snapshot } from './_lib/ingest/types.ts';

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeHttp(gapMs = 900) {
  let last = 0;
  return async function http(url: string): Promise<any> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = last + gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15_000);
      try {
        const res = await fetch(url, {
          signal: ctrl.signal,
          headers: { 'user-agent': UA, accept: 'application/json' },
        });
        clearTimeout(timer);
        if (res.status === 429 || res.status >= 500) {
          await sleep(1500 * (attempt + 1));
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
        return await res.json();
      } catch (err) {
        clearTimeout(timer);
        if (attempt === 2) throw err;
        await sleep(1200 * (attempt + 1));
      }
    }
    throw new Error(`נכשל אחרי שלושה ניסיונות: ${url}`);
  };
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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const body = await req.json().catch(() => ({} as any));
  const phase: Snapshot['phase'] | 'auto' = body?.phase ?? 'auto';

  const http = makeHttp();
  const primary = createSofascore(http, {
    tournamentId: Number(Deno.env.get('SOFASCORE_TOURNAMENT') ?? 266),
    seasonId: Number(Deno.env.get('SOFASCORE_SEASON') ?? 96740),
  });
  const backup = createScores365(http, {
    competitionId: Number(Deno.env.get('SCORES365_COMPETITION') ?? 42),
  });

  let round: number | null = Number.isInteger(body?.round) ? body.round : null;
  const done: unknown[] = [];

  try {
    /* ── 1. איזה מחזור ─────────────────────────────────────── */
    let source = primary;
    let usedBackup = false;

    if (round === null) {
      try {
        round = await primary.currentRound();
      } catch (err) {
        /* ★ המקור הראשי נפל — המחזור עדיין צריך להתקדם. */
        usedBackup = true;
        source = backup as unknown as typeof primary;
        round = await backup.currentRound();
        await supabase.rpc('ingest_log_failure', {
          p_source: 'sofascore', p_phase: 'fixtures',
          p_gw_code: null, p_error: String(err),
        });
      }
    }

    /* ── 2. לוח + סטטיסטיקה ────────────────────────────────── */
    const { fixtures, raw } = await source.round(round!);
    const alerts: Alert[] = [];

    const wantStats = phase === 'auto' || phase === 'live'
      || phase === 'final' || phase === 'sweep';

    let stats: Snapshot['stats'] = [];
    if (wantStats && !usedBackup) {
      const got = await primary.stats(fixtures);
      stats = got.stats;
      alerts.push(...got.alerts);
      raw.push(...got.raw);
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
      phase: phase === 'auto' ? 'sweep' : phase,
      gameweek: { number: round! },
      fixtures, stats, alerts, raw,
    };

    const { data: report, error } = await supabase.rpc('ingest_snapshot', {
      p_source: usedBackup ? backup.name : primary.name,
      p_payload: snapshot,
    });
    if (error) throw new Error(`ingest_snapshot: ${error.message}`);
    done.push({ ingest: report });

    /* ── 5. המחזור הבא — לוח בלבד, כדי שייווצר בזמן ───────── */
    //  ★ בלי זה, המחזור הבא נולד רק אחרי שהנוכחי פורסם, והמשתמש
    //    מגלה את המשחקים שלו יום לפני הדדליין.
    try {
      const next = await primary.round(round! + 1);
      if (next.fixtures.length > 0) {
        const { data: nextReport } = await supabase.rpc('ingest_snapshot', {
          p_source: primary.name,
          p_payload: {
            phase: 'fixtures',
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

        if (!scored.ok) {
          /* ★ ניקוד שנכשל **לא** מפרסם. מחזור מפורסם בלי ניקוד
             הוא טבלה ריקה שכל המשתמשים רואים בבת אחת. */
          await supabase.rpc('ingest_log_failure', {
            p_source: 'scoring', p_phase: 'final',
            p_gw_code: ready, p_error: `score-gameweek ${scored.status}`,
          });
          done.push({ publish: 'skipped_scoring_failed' });
        } else {
          const { error: pubErr } = await supabase.rpc('admin_set_published', {
            p_gw_code: ready, p_published: true,
          });
          done.push({ publish: pubErr ? `failed: ${pubErr.message}` : ready });
        }
      }
    }

    return json({ ok: true, round, source: usedBackup ? 'backup' : 'primary', done });

  } catch (err) {
    await supabase.rpc('ingest_log_failure', {
      p_source: 'dubid-ingest',
      p_phase: phase === 'auto' ? 'sweep' : phase,
      p_gw_code: round ? `gw-${round}` : null,
      p_error: String(err),
    }).catch(() => {});

    return json({ ok: false, error: String(err), round }, 500);
  }
});
