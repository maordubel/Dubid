-- =====================================================================
--  db/55_arena_season.sql · טבלה עונתית לזירה פרטית (D11 / F02)
--
--  הטבלה בלקוח חישבה רק את המחזור הנוכחי. כאן: צבירה עונתית **רשמית** מתוך
--  lineup_scores שפורסמו (אותו מקור של הדירוג, לא טבלת ניקוד נפרדת).
--
--  מדיניות (מהמפרט):
--   · רק עולם (world) + עונה + פורמט (mode) של הזירה.
--   · מחזורים שפורסמו בלבד; "Provisional" אינו נכנס לסכום.
--   · צבירה מהמחזור הראשון שדדליין ההגשה שלו (lock_at) אחרי joined_at של החבר.
--   · חבר שלא הגיש במחזור זכאי צובר 0 ולא נספר ב-played.
--   · דירוג עונתי: total ↓, captain_points ↓, differential_points ↓, הגשה ראשונה
--     מוקדמת, user_id — דטרמיניסטי, בלי אקראיות.
--   · דירוג מחזור בתוך הזירה: total_points ↓, rank רשמי ↑, submitted_at ↑, user_id.
--   · movement = דירוג קודם (בלי המחזור האחרון) − דירוג נוכחי. אין Won/Lost.
--  גישה: חבר בזירה בלבד. תשובה תחומה (limit/offset).
-- =====================================================================
SET search_path = game, core, public;

CREATE OR REPLACE FUNCTION game.arena_season_table(
  p_arena_id UUID, p_limit INT DEFAULT 100, p_offset INT DEFAULT 0)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE a game.leagues%ROWTYPE; v_season UUID; v_last UUID; v JSONB;
BEGIN
  SELECT * INTO a FROM game.leagues WHERE id = p_arena_id;
  IF a.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT EXISTS (SELECT 1 FROM game.league_members m
                  WHERE m.league_id = a.id AND m.user_id = auth.uid())
     AND NOT game.can_write_data() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF a.world_id IS NULL THEN RAISE EXCEPTION 'NO_WORLD'; END IF;

  /* עונה: של המחזור הנוכחי בעולם; אחרת של המחזור המפורסם האחרון */
  SELECT gw.season_id INTO v_season FROM game.gameweeks gw
   WHERE gw.league_id = a.world_id
   ORDER BY gw.is_current DESC, gw.number DESC LIMIT 1;
  IF v_season IS NULL THEN RETURN '[]'::jsonb; END IF;

  SELECT gw.id INTO v_last FROM game.gameweeks gw
   WHERE gw.league_id = a.world_id AND gw.season_id = v_season AND gw.status IN ('published','archived')
   ORDER BY gw.number DESC LIMIT 1;

  WITH rounds AS (
    SELECT gw.id, gw.number FROM game.gameweeks gw
     WHERE gw.league_id = a.world_id AND gw.season_id = v_season
       AND gw.status IN ('published','archived')
  ),
  eligible AS (   -- חבר × מחזור שדדליינו אחרי ההצטרפות
    SELECT m.user_id, r.id AS gw_id, r.number
      FROM game.league_members m
      CROSS JOIN rounds r
      JOIN game.gameweeks gw ON gw.id = r.id
     WHERE m.league_id = a.id AND gw.lock_at > m.joined_at
  ),
  scored AS (
    SELECT e.user_id, e.gw_id, e.number,
           ls.total_points, COALESCE(ls.captain_points, 0) cp, COALESCE(ls.differential_points, 0) dp,
           ls.rank AS official_rank, ul.submitted_at,
           (ls.lineup_id IS NOT NULL) AS played
      FROM eligible e
      LEFT JOIN game.user_lineups ul
             ON ul.user_id = e.user_id AND ul.gameweek_id = e.gw_id AND ul.mode = a.mode
      LEFT JOIN game.lineup_scores ls ON ls.lineup_id = ul.id
  ),
  round_rank AS (
    SELECT s.*, rank() OVER (PARTITION BY s.gw_id
             ORDER BY COALESCE(s.total_points, 0) DESC, s.official_rank ASC NULLS LAST,
                      s.submitted_at ASC NULLS LAST, s.user_id) AS arena_round_rank
      FROM scored s WHERE s.played
  ),
  totals AS (
    SELECT s.user_id,
           COALESCE(sum(s.total_points), 0)                          AS total,
           COALESCE(sum(s.total_points) FILTER (WHERE s.gw_id <> v_last), 0) AS total_prev,
           COALESCE(sum(s.cp), 0) cp, COALESCE(sum(s.cp) FILTER (WHERE s.gw_id <> v_last), 0) cp_prev,
           COALESCE(sum(s.dp), 0) dp, COALESCE(sum(s.dp) FILTER (WHERE s.gw_id <> v_last), 0) dp_prev,
           count(*) FILTER (WHERE s.played)                          AS played,
           min(s.submitted_at)                                       AS first_sub
      FROM scored s GROUP BY s.user_id
  ),
  members AS (
    SELECT m.user_id, COALESCE(t.total, 0) total, COALESCE(t.total_prev, 0) total_prev,
           COALESCE(t.cp, 0) cp, COALESCE(t.cp_prev, 0) cp_prev, COALESCE(t.dp, 0) dp, COALESCE(t.dp_prev, 0) dp_prev,
           COALESCE(t.played, 0) played, t.first_sub
      FROM game.league_members m LEFT JOIN totals t ON t.user_id = m.user_id
     WHERE m.league_id = a.id
  ),
  ranked AS (
    SELECT mb.*,
      rank() OVER (ORDER BY mb.total DESC, mb.cp DESC, mb.dp DESC, mb.first_sub ASC NULLS LAST, mb.user_id) AS rnk,
      rank() OVER (ORDER BY mb.total_prev DESC, mb.cp_prev DESC, mb.dp_prev DESC, mb.first_sub ASC NULLS LAST, mb.user_id) AS rnk_prev
      FROM members mb
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'userId', r.user_id, 'displayName', u.display_name,
           'total', r.total, 'played', r.played, 'rank', r.rnk,
           'previousRank', CASE WHEN v_last IS NULL THEN NULL ELSE r.rnk_prev END,
           'movement', CASE WHEN v_last IS NULL THEN NULL ELSE r.rnk_prev - r.rnk END,
           'bestRank', (SELECT min(rr.arena_round_rank) FROM round_rank rr WHERE rr.user_id = r.user_id)
         ) ORDER BY r.rnk, r.user_id), '[]'::jsonb)
    INTO v
    FROM (SELECT * FROM ranked ORDER BY rnk, user_id
           LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200) OFFSET GREATEST(COALESCE(p_offset, 0), 0)) r
    LEFT JOIN game.users u ON u.id = r.user_id;

  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION game.arena_season_table(UUID, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION game.arena_season_table(UUID, INT, INT) TO authenticated;
