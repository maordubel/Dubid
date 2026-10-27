-- =====================================================================
--  db/61_next_round.sql — "המחזור הבא" למסך הבנייה (תצוגה בלבד)
-- =====================================================================
--  המחזור שאחרי מחזור נתון, באותה ליגה: הקטן ביותר שמספרו גדול יותר
--  ושננעל אחריו — לא מספר+1 (מחזור דחוי/מפוצל אינו בהכרח הבא בתור,
--  ומחזורי זומבי ישנים עם נעילה רחוקה לא נבחרים).
--  ללא שינוי חוקים, ללא כתיבה. לוח המשחקים עצמו — `game.fixtures(code)`.
-- =====================================================================
BEGIN;
SET search_path = game, core, public;

CREATE OR REPLACE FUNCTION game.next_round(p_gw_code TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
  SELECT jsonb_build_object(
           'code', n.code, 'number', n.number, 'status', n.status,
           'lockAt', n.lock_at, 'firstKickoffAt', n.first_kickoff_at,
           'fixturesTotal', (SELECT count(*) FROM core.weekly_matches m WHERE m.gameweek_id = n.id))
    FROM game.gameweeks c
    JOIN core.seasons cs ON cs.id = c.season_id
    JOIN LATERAL (
      SELECT g.* FROM game.gameweeks g
        JOIN core.seasons s ON s.id = g.season_id
       WHERE s.league_id = cs.league_id
         AND g.number > c.number
         AND g.lock_at > c.lock_at
         AND g.status NOT IN ('published','archived')
       ORDER BY g.number, g.lock_at
       LIMIT 1) n ON TRUE
   WHERE c.code = p_gw_code;
$$;

GRANT EXECUTE ON FUNCTION game.next_round(TEXT) TO anon, authenticated;

INSERT INTO game.schema_migrations (version, note) VALUES
  ('61', 'המחזור הבא למסך הבנייה (next_round)')
ON CONFLICT (version) DO NOTHING;

COMMIT;
