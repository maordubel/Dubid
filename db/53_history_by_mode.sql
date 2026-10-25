-- =====================================================================
--  db/53_history_by_mode.sql · היסטוריה לפי פורמט (D05 / F08)
--
--  הבעיה (db/44): p_mode סינן ב-`formation IS NOT NULL` ולא לפי ul.mode;
--  topScore/myPoints/myRank לא סוננו כלל; myPoints בא מ-LIMIT 1 שרירותי
--  כשלמשתמש שתי הגשות באותו מחזור (חמישייה + הרכב מלא); myRank חושב ב-RANK()
--  על total_points בלבד, בלי שוברי השוויון של הדירוג הרשמי.
--
--  התיקון:
--   · p_mode מסנן ul.mode בכל השדות (entries, topScore, myPoints, myRank).
--   · myRank = lineup_scores.rank — הדירוג **הרשמי שפורסם** (כולל שוברי שוויון).
--   · p_mode = NULL → מבט-על מפוצל: byMode.{five,full} לכל פורמט בנפרד; שדות
--     השורה העליונה (topScore/myPoints/myRank) NULL — לא משלבים שני פורמטים.
--   · אותו מבנה תשובה כמו קודם (תואם לאחור) + byMode.
-- =====================================================================
SET search_path = game, core, public;

CREATE OR REPLACE FUNCTION game.history_summary(
  p_mode TEXT DEFAULT NULL, p_limit INT DEFAULT 20, p_league TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v JSONB; v_league UUID;
BEGIN
  IF p_mode IS NOT NULL AND p_mode NOT IN ('five','full') THEN
    RAISE EXCEPTION 'BAD_MODE';
  END IF;
  IF p_league IS NULL THEN
    SELECT id INTO v_league FROM core.leagues ORDER BY created_at, code LIMIT 1;
  ELSE
    SELECT id INTO v_league FROM core.leagues WHERE code = p_league;
  END IF;

  SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'number')::INT DESC), '[]'::jsonb)
    INTO v
  FROM (
    SELECT jsonb_build_object(
      'code', gw.code,
      'number', gw.number,
      'label', gw.names #>> '{he,full}',
      'names', gw.names,
      'publishedAt', gw.published_at,
      'lockAt', gw.lock_at,
      'entries', (SELECT count(*) FROM game.user_lineups ul
                   WHERE ul.gameweek_id = gw.id AND ul.status IN ('submitted','locked','scored')
                     AND (p_mode IS NULL OR ul.mode = p_mode)),
      'fixtures', (SELECT count(*) FROM core.weekly_matches m WHERE m.gameweek_id = gw.id),
      'topScore', CASE WHEN p_mode IS NULL THEN NULL ELSE
                    (SELECT max(ls.total_points) FROM game.lineup_scores ls
                       JOIN game.user_lineups ul ON ul.id = ls.lineup_id
                      WHERE ul.gameweek_id = gw.id AND ul.mode = p_mode) END,
      'myPoints', CASE WHEN p_mode IS NULL THEN NULL ELSE
                    (SELECT ls.total_points FROM game.lineup_scores ls
                       JOIN game.user_lineups ul ON ul.id = ls.lineup_id
                      WHERE ul.gameweek_id = gw.id AND ul.user_id = auth.uid() AND ul.mode = p_mode
                      ORDER BY ul.submitted_at DESC NULLS LAST LIMIT 1) END,
      'myRank', CASE WHEN p_mode IS NULL THEN NULL ELSE
                    (SELECT ls.rank FROM game.lineup_scores ls
                       JOIN game.user_lineups ul ON ul.id = ls.lineup_id
                      WHERE ul.gameweek_id = gw.id AND ul.user_id = auth.uid() AND ul.mode = p_mode
                      ORDER BY ul.submitted_at DESC NULLS LAST LIMIT 1) END,
      'byMode', (SELECT COALESCE(jsonb_object_agg(m.mode, jsonb_build_object(
          'entries', (SELECT count(*) FROM game.user_lineups ul
                       WHERE ul.gameweek_id = gw.id AND ul.mode = m.mode
                         AND ul.status IN ('submitted','locked','scored')),
          'topScore', (SELECT max(ls.total_points) FROM game.lineup_scores ls
                         JOIN game.user_lineups ul ON ul.id = ls.lineup_id
                        WHERE ul.gameweek_id = gw.id AND ul.mode = m.mode),
          'myPoints', (SELECT ls.total_points FROM game.lineup_scores ls
                         JOIN game.user_lineups ul ON ul.id = ls.lineup_id
                        WHERE ul.gameweek_id = gw.id AND ul.user_id = auth.uid() AND ul.mode = m.mode
                        ORDER BY ul.submitted_at DESC NULLS LAST LIMIT 1),
          'myRank', (SELECT ls.rank FROM game.lineup_scores ls
                       JOIN game.user_lineups ul ON ul.id = ls.lineup_id
                      WHERE ul.gameweek_id = gw.id AND ul.user_id = auth.uid() AND ul.mode = m.mode
                      ORDER BY ul.submitted_at DESC NULLS LAST LIMIT 1))), '{}'::jsonb)
          FROM (VALUES ('five'), ('full')) AS m(mode))
    ) AS row
    FROM game.gameweeks gw
   WHERE gw.status IN ('published','archived')
     AND gw.league_id = v_league
   ORDER BY gw.number DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
  ) t;

  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION game.history_summary(TEXT, INT, TEXT) TO anon, authenticated;
