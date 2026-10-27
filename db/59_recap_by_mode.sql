-- =====================================================================
--  db/59_recap_by_mode.sql · סיכום מחזור באוכלוסייה מוגדרת (D12)
--
--  הבאג: gameweek_recap(code) בלי פורמט דירגה את DUBID 5 ו-DUBID 11 יחד
--  ("מקום 3 מתוך 40" כשבחמישייה היו 12), בחרה הגשה שרירותית (LIMIT 1) למי
--  שהגיש בשניהם, וחישבה מקום ב-count(*)+1 — בלי שוברי השוויון של הדירוג
--  הרשמי. ובנוסף "המוביל" נבחר בלי שוברי שוויון, עם שם עברי קשיח.
--
--  התיקון:
--   · אין p_mode → הפורמט של ההגשה שלך (full לפני five, דטרמיניסטי); אין
--     הגשה → הפורמט עם יותר הגשות מנוקדות (שוויון → full). תמיד מוחזר 'mode'.
--   · מקום = lineup_scores.rank (הרשמי); נפילה ל-count+1 רק אם חסר.
--   · prevRank = המקום הרשמי במחזור הקודם שפורסם, באותה ליגה ובאותו פורמט.
--   · המוביל = rank 1 הרשמי; שם חסר → NULL (הלקוח מתרגם), לא 'אלמוני'.
--  חתימה ותבנית תשובה תואמות לאחור (שדות נוספים בלבד).
-- =====================================================================
SET search_path = game, core, public;

BEGIN;

CREATE OR REPLACE FUNCTION game.gameweek_recap(p_gw_code TEXT, p_mode TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  v_gw      game.gameweeks;
  v_auth    UUID := auth.uid();
  v_mode    TEXT := p_mode;
  v_mine    RECORD;
  v_total   INT;
  v_rank    INT;
  v_prev    INT;
  v_players JSONB;
  v_best    JSONB;
  v_worst   JSONB;
  v_cap     JSONB;
BEGIN
  IF p_mode IS NOT NULL AND p_mode NOT IN ('five','full') THEN RAISE EXCEPTION 'BAD_MODE'; END IF;
  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw.id IS NULL THEN RETURN jsonb_build_object('gw', p_gw_code, 'exists', FALSE); END IF;

  IF v_mode IS NULL THEN
    SELECT ul.mode INTO v_mode
      FROM game.lineup_scores ls JOIN game.user_lineups ul ON ul.id = ls.lineup_id
     WHERE ul.gameweek_id = v_gw.id AND ul.user_id = v_auth
     ORDER BY (ul.mode = 'full') DESC LIMIT 1;
  END IF;
  IF v_mode IS NULL THEN
    SELECT ul.mode INTO v_mode
      FROM game.lineup_scores ls JOIN game.user_lineups ul ON ul.id = ls.lineup_id
     WHERE ul.gameweek_id = v_gw.id
     GROUP BY ul.mode
     ORDER BY count(*) DESC, (ul.mode = 'full') DESC LIMIT 1;
  END IF;

  SELECT count(*) INTO v_total
    FROM game.lineup_scores ls JOIN game.user_lineups ul ON ul.id = ls.lineup_id
   WHERE ul.gameweek_id = v_gw.id AND ul.mode = v_mode;

  SELECT ls.total_points, ls.rank, ls.breakdown, ul.mode, ul.team_name
    INTO v_mine
    FROM game.lineup_scores ls JOIN game.user_lineups ul ON ul.id = ls.lineup_id
   WHERE ul.gameweek_id = v_gw.id AND ul.user_id = v_auth AND ul.mode = v_mode
   LIMIT 1;

  IF v_mine.total_points IS NOT NULL THEN
    v_rank := v_mine.rank;
    IF v_rank IS NULL THEN
      SELECT count(*) + 1 INTO v_rank
        FROM game.lineup_scores ls JOIN game.user_lineups ul ON ul.id = ls.lineup_id
       WHERE ul.gameweek_id = v_gw.id AND ul.mode = v_mode
         AND ls.total_points > v_mine.total_points;
    END IF;

    SELECT ls.rank INTO v_prev
      FROM game.lineup_scores ls
      JOIN game.user_lineups ul ON ul.id = ls.lineup_id
      JOIN game.gameweeks g ON g.id = ul.gameweek_id
     WHERE ul.user_id = v_auth AND ul.mode = v_mode
       AND g.league_id IS NOT DISTINCT FROM v_gw.league_id
       AND g.status = 'published' AND g.number < v_gw.number
     ORDER BY g.number DESC LIMIT 1;

    v_players := COALESCE(v_mine.breakdown -> 'players', '[]'::jsonb);

    SELECT jsonb_build_object(
             'player', e->>'playerId',
             'nameHe', (SELECT pl.name_he FROM core.players pl
                         WHERE pl.id = core.player_by_ext(ltrim(e->>'playerId','P'))),
             'points', (e->>'subtotal')::NUMERIC)
      INTO v_best
      FROM jsonb_array_elements(v_players) e
     ORDER BY (e->>'subtotal')::NUMERIC DESC, e->>'playerId' LIMIT 1;

    SELECT jsonb_build_object(
             'player', e->>'playerId',
             'nameHe', (SELECT pl.name_he FROM core.players pl
                         WHERE pl.id = core.player_by_ext(ltrim(e->>'playerId','P'))),
             'points', (e->>'subtotal')::NUMERIC)
      INTO v_worst
      FROM jsonb_array_elements(v_players) e
     ORDER BY (e->>'subtotal')::NUMERIC ASC, e->>'playerId' LIMIT 1;

    SELECT jsonb_build_object(
             'player', e->>'playerId',
             'nameHe', (SELECT pl.name_he FROM core.players pl
                         WHERE pl.id = core.player_by_ext(ltrim(e->>'playerId','P'))),
             'points', (e->>'subtotal')::NUMERIC,
             'bonus',  (v_mine.breakdown->>'captain')::NUMERIC)
      INTO v_cap
      FROM jsonb_array_elements(v_players) e
     WHERE (e->>'isCaptain')::BOOLEAN LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'gw',       p_gw_code,
    'exists',   TRUE,
    'status',   v_gw.status,
    'mode',     v_mode,
    'entries',  v_total,
    'hasEntry', v_mine.total_points IS NOT NULL,
    'teamName', v_mine.team_name,
    'points',   v_mine.total_points,
    'rank',     v_rank,
    'prevRank', v_prev,
    'beatPercent', CASE WHEN v_total > 1 AND v_rank IS NOT NULL
                        THEN floor((v_total - v_rank) * 100.0 / (v_total - 1))
                   END,
    'best',     v_best,
    'worst',    v_worst,
    'captain',  v_cap,
    'top', (SELECT jsonb_build_object(
                     'name',   COALESCE(NULLIF(btrim(ul.team_name), ''),
                                        NULLIF(btrim(u.display_name), '')),
                     'points', ls.total_points)
              FROM game.lineup_scores ls
              JOIN game.user_lineups ul ON ul.id = ls.lineup_id
              JOIN game.users u ON u.id = ul.user_id
             WHERE ul.gameweek_id = v_gw.id AND ul.mode = v_mode
             ORDER BY ls.rank NULLS LAST, ls.total_points DESC, ul.submitted_at, ul.id LIMIT 1)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION game.gameweek_recap(TEXT,TEXT) TO anon, authenticated;

COMMIT;

INSERT INTO game.schema_migrations (version, note) VALUES
  ('59', '★ סיכום מחזור לפי פורמט, מקום רשמי, מקום קודם, מוביל לפי דירוג רשמי')
ON CONFLICT (version) DO NOTHING;
