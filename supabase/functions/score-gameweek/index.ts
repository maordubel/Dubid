/**
 * Supabase Edge Function — חישוב הניקוד הרשמי של מחזור.
 *
 *   POST /functions/v1/score-gameweek  { "gameweekId": "..." }
 *
 * מריצה את *אותו* מנוע בדיוק שרץ בדפדפן (app/src/lib/scoring).
 * זה לא נוחות — זו דרישה: אם החישוב היה מיושם פעמיים, בוקר אחד
 * המספר במסך היה שונה מהמספר בטבלה, ואין דבר שהורג אמון מהר יותר
 * במשחק שכולו מספרים.
 *
 * פריסה:
 *   supabase functions deploy score-gameweek --no-verify-jwt=false
 * הרשאות: service_role בלבד. אין חישוב ניקוד מהקליינט.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { scoreLineup, buildInputs, toBreakdown, rankGameweek } from '../../../src/lib/scoring/engine.ts';
import { ruleSetFromJson, IL_PREMIER } from '../../../src/lib/scoring/rules.ts';
import { LineupInvalidError } from '../../../src/lib/scoring/validate.ts';
import type { Lineup } from '../../../src/lib/scoring/types.ts';

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

  const rules = rulesetRow
    ? ruleSetFromJson({ ...rulesetRow.rules, version: rulesetRow.version })
    : IL_PREMIER;

  /* -------- 2. קלטי המנוע: סטטיסטיקות ותוצאות המחזור -------- */
  const [{ data: statRows }, { data: matchRows }] = await Promise.all([
    supabase.rpc('gameweek_player_stats', { p_gameweek_id: gameweekId }),
    supabase.rpc('gameweek_team_results', { p_gameweek_id: gameweekId }),
  ]);

  const { performances, outcomes } = buildInputs(statRows ?? [], matchRows ?? []);

  /* -------- 3. כל ההרכבים הנעולים -------- */
  const { data: lineupRows } = await supabase
    .from('user_lineups')
    .select('id, user_id, formation, status, user_lineup_slots(slot_no, player_id, team_id, position, is_captain, is_vice, is_bench)')
    .eq('gameweek_id', gameweekId)
    .in('status', ['locked', 'scored']);

  const scores = [];
  const failures: Array<{ lineupId: string; issues: unknown }> = [];

  for (const row of lineupRows ?? []) {
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
      scores.push(scoreLineup(lineup, performances, outcomes, rules));
    } catch (error) {
      if (error instanceof LineupInvalidError) {
        failures.push({ lineupId: lineup.lineupId, issues: error.issues });
        continue;
      }
      throw error;
    }
  }

  /* -------- 4. כתיבה + דירוג -------- */
  const ranked = rankGameweek(scores);
  const rows = ranked.map(({ rank, score }) => ({
    lineup_id: score.lineupId,
    gameweek_id: gameweekId,
    personal_points: score.personalPoints,
    result_points: score.resultPoints,
    captain_points: score.captainPoints,
    virtual_points: score.virtualPoints,
    total_points: score.totalPoints,
    rank,
    breakdown: toBreakdown(score),
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

  await supabase.from('gameweeks').update({ status: 'settled' }).eq('id', gameweekId);

  return json({
    gameweekId,
    scored: rows.length,
    failures,
    rulesetVersion: rules.version,
    top: ranked.slice(0, 3).map(({ rank, score }) => ({
      rank, lineupId: score.lineupId, total: score.totalPoints,
    })),
  });
});
