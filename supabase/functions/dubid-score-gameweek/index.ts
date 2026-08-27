/**
 * Supabase Edge Function — חישוב הניקוד הרשמי של מחזור.
 *
 *   POST /functions/v1/dubid-score-gameweek  { "gameweekId": "..." }
 *
 * מריצה את *אותו* מנוע בדיוק שרץ בדפדפן (app/src/lib/scoring).
 * זה לא נוחות — זו דרישה: אם החישוב היה מיושם פעמיים, בוקר אחד
 * המספר במסך היה שונה מהמספר בטבלה, ואין דבר שהורג אמון מהר יותר
 * במשחק שכולו מספרים.
 *
 * ═══════════════════════════════════════════════════════════════
 *  פריסה — והמלכוד שהפיל אותה
 * ═══════════════════════════════════════════════════════════════
 *
 * ★ למה השם `dubid-score-gameweek` ולא `score-gameweek`
 *
 * פרויקט ה-Supabase מחובר ל-GIT של **אופסיידס**, ובאותו ריפו כבר
 * יושבות פונקציות (`match-autopilot`, `sync-fixtures`). שם גנרי
 * כמו `score-gameweek` בריפו משותף הוא התנגשות שמחכה לקרות —
 * לשני המוצרים יש ניקוד, ויום אחד לאופסיידס תהיה פונקציה כזו.
 *
 * תחילית לפי מוצר היא הכלל בפרויקט משותף, בדיוק כמו שהטבלאות
 * יושבות ב-`game.*` ולא ב-`public.*`.
 *
 * ★ למה `./_lib/` ולא `../_shared/` ולא `../../src/`
 *
 * הפריסה נכשלה עם "Module not found file:///src/lib/scoring/engine.ts"
 * כי ה-bundler רואה **רק** את תיקיית הפונקציה. גם `../_shared/`
 * לא פותר — עורך ה-Dashboard לא מאפשר קבצים מעל שורש הפונקציה,
 * ואינטגרציית ה-GIT מעלה תיקייה אחת בכל פעם.
 *
 * לכן התיקייה הזו **עומדת בפני עצמה לחלוטין**: היחיד שהיא מייבאת
 * מבחוץ הוא `esm.sh`. אפשר להעתיק אותה כמו שהיא לכל ריפו, והיא
 * תעבוד. `_lib/` נוצר מ-`src/lib/` על ידי `npm run sync:edge`,
 * ומקור האמת נשאר `src/lib/`.
 *
 * ★ שלוש דרכי פריסה, וכולן עובדות
 *
 *  א. GIT של אופסיידס:  npm run export:edge  →  להעתיק את התיקייה
 *                       שנוצרה אל `supabase/functions/` בריפו של
 *                       אופסיידס, ולדחוף. זו הדרך הנכונה כאן.
 *  ב. CLI:              npm run deploy:edge
 *  ג. Dashboard:        npm run sync:edge, ואז להעלות את **כל**
 *                       התיקייה — index.ts + _lib/, לא רק index.ts
 *
 * הרשאות: service_role בלבד. אין חישוב ניקוד מהקליינט.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { scoreLineup, buildInputs, toBreakdown } from './_lib/scoring/engine.ts';
// ★ אותה היררכיית דירוג בדיוק שרצה בקליינט. הברִיף דורש שהיא תהיה
//   זהה בשני הצדדים — ולכן היא מיובאת, לא ממומשת כאן מחדש.
import { rankEntries, applyDifferential, selectionRates }
  from './_lib/scoring/ranking.ts';
import { ruleSetFromJson, IL_PREMIER, DUBID_5X5 } from './_lib/scoring/rules.ts';
import { applyOverrides } from './_lib/ruleOverrides.ts';
import { LineupInvalidError } from './_lib/scoring/validate.ts';
import type { Lineup } from './_lib/scoring/types.ts';

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? 'https://dubid.dubelteam.com',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const { gameweekId } = await req.json().catch(() => ({}));
  if (!gameweekId) return json({ error: 'gameweekId_required' }, 400);

  /* -------- 1. חוקי הניקוד של הליגה, בגרסה שהייתה בתוקף -------- */
  const { data: gw, error: gwErr } = await supabase
    .from('gameweeks')
    .select('id, number, season_id, seasons(league_id, leagues(code))')
    .eq('id', gameweekId)
    .single();
  if (gwErr || !gw) return json({ error: 'gameweek_not_found' }, 404);

  const leagueId = (gw as any).seasons?.league_id;
  const { data: rulesetRow } = await supabase
    .from('scoring_rulesets')
    .select('id, version, rules')
    .eq('league_id', leagueId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  const base = rulesetRow
    ? ruleSetFromJson({ ...rulesetRow.rules, version: rulesetRow.version })
    : IL_PREMIER;

  /* ★ מקור חוקים אחד, ולא שניים.
     הקליינט קורא ל-`game.scoring_rules()` ומחיל את מה שהאדמין
     שינה. הפונקציה הזו קראה רק את `scoring_rulesets` — טבלה
     אחרת לגמרי. כלומר האדמין היה משנה את הבישול ל-4, המסך היה
     מראה 4 והמשתמש היה סופר לפי 4 — והניקוד **הרשמי** היה
     נשאר 3. שני מספרים על אותו מחזור, ואף שגיאה בשום מקום.

     ה-override-ים מוחלים אחרונים, מעל הגרסה ההיסטורית: הם
     ה"עכשיו" של האיזון, וה-ruleset הוא הבסיס. */
  const { data: overrideRows } = await supabase.rpc('scoring_rules');
  const overrides: Record<string, number> = {};
  if (overrideRows && typeof overrideRows === 'object') {
    for (const [k, v] of Object.entries(overrideRows as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n)) overrides[k] = n;
    }
  }

  /* ★ חוקים **לכל מצב**, ולא אחד לכולם.
     דוביד 5 חולק את טבלת הניקוד עם דוביד 11 אבל לא את
     האילוצים: חמישה שחקנים, מערכים אחרים. עד עכשיו הפונקציה
     ניקדה את הכול לפי `IL_PREMIER` — כלומר כל הרכב של דוביד 5
     נפל בוולידציה על `lineupSize` ונחת ב-`failures`. המחזור
     היה נסגר, המשתמשים היו רואים "אין תוצאות", ושום דבר
     בלוגים לא היה אומר "מצב". */
  const rulesFor = {
    full: applyOverrides(base, overrides),
    five: applyOverrides(
      { ...DUBID_5X5, ...base, constraints: DUBID_5X5.constraints },
      overrides,
    ),
  } as const;

  /* -------- 2. קלטי המנוע: סטטיסטיקות ותוצאות המחזור -------- */
  const [{ data: statRows }, { data: matchRows }] = await Promise.all([
    supabase.rpc('gameweek_player_stats', { p_gameweek_id: gameweekId }),
    supabase.rpc('gameweek_team_results', { p_gameweek_id: gameweekId }),
  ]);

  const { performances, outcomes } = buildInputs(statRows ?? [], matchRows ?? []);

  /* -------- 3. כל ההרכבים הנעולים -------- */
  const { data: lineupRows } = await supabase
    .from('user_lineups')
    .select('id, user_id, mode, formation, status, submitted_at, user_lineup_slots(slot_no, player_id, team_id, position, is_captain, is_vice, is_bench)')
    .eq('gameweek_id', gameweekId)
    .in('status', ['locked', 'scored']);

  type Scored = {
    mode: 'five' | 'full';
    lineup: Lineup;
    submittedAt: string;
    score: ReturnType<typeof scoreLineup>;
  };
  const scores: Scored[] = [];
  const failures: Array<{ lineupId: string; mode: string; issues: unknown }> = [];

  for (const row of lineupRows ?? []) {
    const mode: 'five' | 'full' = (row as any).mode === 'five' ? 'five' : 'full';
    const rules = rulesFor[mode];
    const lineup: Lineup = {
      lineupId: row.id,
      userId: row.user_id,
      gameweekId,
      formation: row.formation,
      slots: (row as any).user_lineup_slots.map((s: any) => ({
        slotNo: s.slot_no,
        playerId: s.player_id,
        teamId: s.team_id,
        position: s.position,
        isCaptain: s.is_captain,
        isVice: s.is_vice,
        isBench: s.is_bench,
      })),
    };

    try {
      // ולידציה נשארת דלוקה גם כאן. הרכב שעבר את ה-DB ואת ה-API
      // ובכל זאת נופל כאן = באג שאסור לו לעבור בשקט לטבלת התוצאות.
      scores.push({
        mode,
        lineup,
        // חותמת ההגשה היא שובר השוויון האחרון. הגשה בלי חותמת
        // נדחקת לסוף התור ולא מזכה ביתרון מקרי.
        submittedAt: (row as any).submitted_at ?? '',
        score: scoreLineup(lineup, performances, outcomes, rules),
      });
    } catch (error) {
      if (error instanceof LineupInvalidError) {
        failures.push({ lineupId: lineup.lineupId, mode, issues: error.issues });
        continue;
      }
      throw error;
    }
  }

  /* -------- 4. דיפרנציאל, דירוג, כתיבה -------- */

  /* ★ כל מצב מדורג בנפרד, ואין דרך אחרת.
     דוביד 5 ודוביד 11 הם שתי תחרויות, לא אחת: הרכב של חמישה
     לעולם לא יגיע לניקוד של אחת־עשרה, ודירוג משותף היה הופך
     את דוביד 5 לתחתית קבועה של הטבלה.

     וגם בונוס הנדירות: "אחוז מהמשתתפים שבחרו את השחקן" הוא
     מספר חסר משמעות אם המונה סופר משתתפים ממשחק אחר. שני
     המצבים בוחרים מאותו מאגר שחקנים, ולכן בלי ההפרדה כל שחקן
     בדוביד 5 היה נראה "נדיר" רק כי רוב המשתתפים משחקים 11. */
  const byMode = new Map<'five' | 'full', Scored[]>();
  for (const s of scores) {
    const list = byMode.get(s.mode);
    if (list) list.push(s); else byMode.set(s.mode, [s]);
  }

  const ranked = [...byMode.values()].flatMap((group) => {
    const rates = selectionRates(
      group.map((s) => ({ playerIds: s.lineup.slots.map((x) => x.playerId) })),
    );
    const withDifferential = group.map((s) => ({
      ...s,
      score: applyDifferential(s.score, rates, group.length),
    }));
    return rankEntries(
      withDifferential.map((s) => ({ entry: s, score: s.score, submittedAt: s.submittedAt })),
    );
  });

  const rows = ranked.map(({ rank, tied, brokenBy, entry }) => ({
    lineup_id: entry.score.lineupId,
    gameweek_id: gameweekId,
    personal_points: entry.score.personalPoints,
    result_points: entry.score.resultPoints,
    captain_points: entry.score.captainPoints,
    virtual_points: entry.score.virtualPoints,
    differential_points: entry.score.differentialPoints ?? 0,
    total_points: entry.score.totalPoints,
    rank,
    // נשמר כדי שהמסך יוכל לומר "הוכרע לפי הקפטן" במקום להסתיר
    // מהמשתמש למה הוא מתחת למישהו עם אותו ניקוד.
    tied,
    tie_broken_by: brokenBy,
    breakdown: toBreakdown(entry.score),
    ruleset_id: rulesetRow?.id ?? null,
    computed_at: new Date().toISOString(),
  }));

  if (rows.length) {
    const { error } = await supabase.from('lineup_scores').upsert(rows, { onConflict: 'lineup_id' });
    if (error) return json({ error: 'write_failed', detail: error.message }, 500);

    await supabase.from('user_lineups')
      .update({ status: 'scored' })
      .eq('gameweek_id', gameweekId)
      .eq('status', 'locked');
  }

  /* ★ 'published' ולא 'settled'.
     ה-CHECK על `game.gameweeks.status` צומצם ב-db/05 לערכים
     draft/open/locked/live/scoring/published/archived — ו-'settled'
     מופה ל-'published' באותה מיגרציה. הכתיבה הזו נפסלה על ידי
     המסד, והשגיאה **לא נבדקה** — כלומר הניקוד נכתב בהצלחה,
     הפונקציה החזירה 200, והמחזור נשאר לנצח במצב 'locked'.
     תקלה שנראית בדיוק כמו "הניקוד לא עבד". */
  const { error: statusErr } = await supabase
    .from('gameweeks')
    .update({ status: 'published', published_at: new Date().toISOString() })
    .eq('id', gameweekId);
  if (statusErr) return json({ error: 'publish_failed', detail: statusErr.message }, 500);

  return json({
    gameweekId,
    scored: rows.length,
    byMode: [...byMode.entries()].map(([mode, list]) => ({ mode, count: list.length })),
    failures,
    rulesetVersion: base.version,
    top: ranked.slice(0, 3).map(({ rank, entry }) => ({
      rank, lineupId: entry.score.lineupId, total: entry.score.totalPoints,
    })),
  });
});
