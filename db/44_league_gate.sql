-- =====================================================================
--  db/44_league_gate.sql · מסך כניסה לליגות + הפרדת ארכיון המחזורים
--
--  · leagues_public(): מחזיר גם ליגה שהקליטה שלה פועלת אך עוד אין לה
--    מחזור נוכחי (live=false → כרטיס "בקרוב"), ומוסיף round / status /
--    lockAt / entrants לכרטיס הכניסה.
--  · history_summary(p_mode, p_limit, p_league): ארכיון המחזורים של ליגה
--    אחת בלבד (בלי פרמטר = הראשית). היה מערבב gw-N ו-gr-N.
--  · פרופיל נשאר אישי ומאוחד — לא משתנה.
--  אידמפוטנטי.
-- =====================================================================
BEGIN;

CREATE OR REPLACE FUNCTION game.leagues_public()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'primary') DESC, x->>'code'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'code',     l.code,
      'country',  l.country_code,
      'locale',   l.default_locale,
      'dir',      l.text_direction,
      'timezone', l.timezone,
      'names',    l.names,
      'primary',  (l.id = (SELECT id FROM core.leagues ORDER BY created_at, code LIMIT 1)),
      'currentGameweek', cur.code,
      'live',     (cur.code IS NOT NULL),
      'round',    cur.number,
      'status',   cur.status,
      'lockAt',   to_char(cur.lock_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'entrants', CASE WHEN cur.id IS NULL THEN 0 ELSE
                    (SELECT count(*) FROM game.user_lineups ul
                      WHERE ul.gameweek_id = cur.id AND ul.status <> 'draft') END
    ) AS x
    FROM core.leagues l
    LEFT JOIN LATERAL (SELECT gw.id, gw.code, gw.number, gw.status, gw.lock_at
                         FROM game.gameweeks gw
                        WHERE gw.league_id = l.id AND gw.is_current
                        LIMIT 1) cur ON TRUE
   WHERE l.is_active
     AND (cur.id IS NOT NULL
          OR EXISTS (SELECT 1 FROM game.ingest_sources s
                      WHERE s.league_id = l.id AND s.enabled))
  ) q;
$$;
GRANT EXECUTE ON FUNCTION game.leagues_public() TO anon, authenticated;

/* ★ חתימה ישנה נמחקת — אחרת PostgREST רואה שתי עמוסות ומתבלבל. */
DROP FUNCTION IF EXISTS game.history_summary(TEXT, INT);

CREATE OR REPLACE FUNCTION game.history_summary(
  p_mode TEXT DEFAULT NULL, p_limit INT DEFAULT 20, p_league TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v JSONB; v_league UUID;
BEGIN
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
                     AND (p_mode IS NULL OR ul.formation IS NOT NULL)),
      'fixtures', (SELECT count(*) FROM core.weekly_matches m WHERE m.gameweek_id = gw.id),
      'topScore', (SELECT max(ls.total_points) FROM game.lineup_scores ls
                    JOIN game.user_lineups ul ON ul.id = ls.lineup_id
                   WHERE ul.gameweek_id = gw.id),
      'myPoints', (SELECT ls.total_points FROM game.lineup_scores ls
                    JOIN game.user_lineups ul ON ul.id = ls.lineup_id
                   WHERE ul.gameweek_id = gw.id AND ul.user_id = auth.uid() LIMIT 1),
      'myRank', (SELECT r.rank FROM (
                   SELECT ul.user_id,
                          RANK() OVER (ORDER BY ls.total_points DESC) AS rank
                     FROM game.lineup_scores ls
                     JOIN game.user_lineups ul ON ul.id = ls.lineup_id
                    WHERE ul.gameweek_id = gw.id) r
                  WHERE r.user_id = auth.uid() LIMIT 1)
    ) AS row
    FROM game.gameweeks gw
   WHERE gw.status IN ('published','archived')
     AND gw.league_id = v_league
   ORDER BY gw.number DESC
   LIMIT p_limit
  ) t;

  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION game.history_summary(TEXT, INT, TEXT) TO authenticated, anon;

UPDATE game.data_revision
   SET revision = revision + 1, scope = 'migration-44', updated_at = now()
 WHERE id = 1;

COMMIT;
