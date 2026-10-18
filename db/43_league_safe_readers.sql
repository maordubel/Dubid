-- =====================================================================
--  db/43_league_safe_readers.sql · קוראי "המחזור הנוכחי" בטוחים לשתי ליגות
--
--  · public_board() בלי קוד: המחזור הנוכחי של הליגה הראשית (היה LIMIT 1 שרירותי).
--  · admin_data_quality(): "קבוצה בלי משחק" רק לליגה שיש לה מחזור נוכחי.
--  · v_ingest_health.current_gw: של הליגה הראשית (תת-שאילתה סקלרית הייתה
--    נופלת עם "more than one row" ברגע שלשתי ליגות יש מחזור נוכחי)
--    + current_gw_by_league לפירוט.
--  אידמפוטנטי.
-- =====================================================================
BEGIN;

CREATE OR REPLACE FUNCTION game.admin_data_quality()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v_out JSONB := '[]'::jsonb;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  /* מחזור פתוח שהדדליין שלו עבר */
  v_out := v_out || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'level', 'error', 'code', 'GW_OPEN_PAST_DEADLINE',
      'title', 'מחזור פתוח אחרי הדדליין',
      'detail', gw.code || ' — הדדליין עבר, והמחזור עדיין מקבל הגשות',
      'fix', 'לשונית מחזור → מצב → נעול'))
    FROM game.gameweeks gw
    WHERE gw.status IN ('open', 'draft') AND now() >= gw.lock_at), '[]'::jsonb);

  /* מחזור פעיל בלי משחקים */
  v_out := v_out || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'level', 'error', 'code', 'CURRENT_GW_NO_FIXTURES',
      'title', 'המחזור הפעיל בלי לוח משחקים',
      'detail', gw.code || ' — אין לו אף משחק',
      'fix', 'לשונית מחזור → קליטת לוח'))
    FROM game.gameweeks gw
    WHERE gw.is_current
      AND NOT EXISTS (SELECT 1 FROM core.weekly_matches m WHERE m.gameweek_id = gw.id)),
    '[]'::jsonb);

  /* שחקנים בלי מחיר */
  v_out := v_out || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'level', 'error', 'code', 'PLAYERS_NO_PRICE',
      'title', 'שחקנים בלי מחיר',
      'detail', n || ' שחקנים בסגל בלי מחיר — כולם מתומחרים ברצפה',
      'fix', 'לשונית סגלים → להשלים מחיר'))
    FROM (SELECT count(*) n FROM core.squads
           WHERE valid_to IS NULL AND fantasy_price IS NULL) q
    WHERE n > 0), '[]'::jsonb);

  /* שחקנים בלי דרג */
  v_out := v_out || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'level', 'warn', 'code', 'PLAYERS_NO_TIER',
      'title', 'שחקנים בלי דרג',
      'detail', n || ' שחקנים יופיעו עם דרג ברירת מחדל',
      'fix', 'לשונית סגלים → דרג'))
    FROM (SELECT count(*) n FROM core.squads
           WHERE valid_to IS NULL AND tier IS NULL) q
    WHERE n > 0), '[]'::jsonb);

  /* מספרי חולצה כפולים באותה קבוצה */
  /* ★ `GROUP BY` בתוך תת-שאילתה סקלרית מחזיר **שורה לכל קבוצה**,
     ואז `jsonb_agg` מצטבר בתוך כל קבוצה בנפרד — כלומר מספר
     שורות, ו-PostgreSQL נופל על
     "more than one row returned by a subquery".
     הצבירה חייבת לעטוף את הקיבוץ, לא להיות בתוכו. */
  v_out := v_out || COALESCE((
    SELECT jsonb_agg(d)
    FROM (
      SELECT jsonb_build_object(
        'level', 'warn', 'code', 'DUPLICATE_SHIRT',
        'title', 'מספר חולצה כפול',
        'detail', tm.name_he || ' — מספר ' || sq.shirt_number || ' מופיע פעמיים',
        'fix', 'לשונית סגלים → לתקן מספר') AS d
      FROM core.squads sq JOIN core.teams tm ON tm.id = sq.team_id
      WHERE sq.valid_to IS NULL AND sq.shirt_number IS NOT NULL
      GROUP BY tm.name_he, sq.team_id, sq.shirt_number
      HAVING count(*) > 1
    ) q), '[]'::jsonb);

  /* קבוצה בלי אף שחקן */
  v_out := v_out || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'level', 'error', 'code', 'TEAM_NO_PLAYERS',
      'title', 'קבוצה בלי סגל',
      'detail', tm.name_he || ' — אין לה אף שחקן פעיל',
      'fix', 'לשונית סגלים → הוספת שחקנים'))
    FROM core.teams tm
    WHERE EXISTS (SELECT 1 FROM core.external_refs x
                   WHERE x.provider='manual_json' AND x.entity_type='team'
                     AND x.entity_id = tm.id)
      AND NOT EXISTS (SELECT 1 FROM core.squads sq
                       WHERE sq.team_id = tm.id AND sq.valid_to IS NULL)),
    '[]'::jsonb);

  /* קבוצה שאין לה משחק במחזור הפעיל */
  v_out := v_out || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'level', 'warn', 'code', 'TEAM_NO_FIXTURE',
      'title', 'קבוצה בלי משחק במחזור',
      'detail', tm.name_he || ' — לא משחקת. השחקנים שלה ייבחרו ולא יצברו נקודות',
      'fix', 'לשונית מחזור → להוסיף את המשחק החסר'))
    FROM core.teams tm
    JOIN core.external_refs x ON x.provider='manual_json' AND x.entity_type='team'
                             AND x.entity_id = tm.id
    WHERE EXISTS (SELECT 1 FROM core.squads sq
                   WHERE sq.team_id = tm.id AND sq.valid_to IS NULL)
      /* ★ רק קבוצות של ליגה שיש לה מחזור נוכחי — אחרת כל קבוצה יוונית
         "לא משחקת" כל עוד יוון עוד לא נפתחה. */
      AND EXISTS (SELECT 1 FROM core.team_seasons ts
                    JOIN game.gameweeks cg ON cg.season_id = ts.season_id AND cg.is_current
                   WHERE ts.team_id = tm.id)
      AND NOT EXISTS (
        SELECT 1 FROM core.weekly_matches m
        JOIN game.gameweeks gw ON gw.id = m.gameweek_id AND gw.is_current
        WHERE m.home_team_id = tm.id OR m.away_team_id = tm.id)),
    '[]'::jsonb);

  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION game.public_board(p_gw_code TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_gw game.gameweeks; v JSONB;
BEGIN
  IF p_gw_code IS NULL THEN
    /* ★ בלי קוד = המחזור הנוכחי של הליגה הראשית (תאימות לאחור). ליגה אחרת: להעביר קוד. */
    SELECT g.* INTO v_gw FROM game.gameweeks g
      JOIN core.leagues l ON l.id = g.league_id
     WHERE g.is_current ORDER BY l.created_at, l.code LIMIT 1;
  ELSE
    SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  END IF;

  SELECT jsonb_build_object(
    'gameweek', CASE WHEN v_gw.id IS NULL THEN NULL ELSE jsonb_build_object(
      'code',   v_gw.code,
      'number', v_gw.number,
      'label',  v_gw.names #>> '{he,full}',
      'status', v_gw.status,
      'lockAt', v_gw.lock_at,
      'live',   (now() >= v_gw.lock_at AND v_gw.status NOT IN ('published','archived')),
      'entries', (SELECT count(*) FROM game.user_lineups ul
                   WHERE ul.gameweek_id = v_gw.id
                     AND ul.status IN ('submitted','locked','scored'))
    ) END,
    'fixtures', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'home',      core.ext_code('team', m.home_team_id),
               'homeNameHe', h.name_he,
               'away',      core.ext_code('team', m.away_team_id),
               'awayNameHe', a.name_he,
               'kickoff',   m.kickoff_at,
               'status',    m.status,
               'homeGoals', m.home_goals,
               'awayGoals', m.away_goals) ORDER BY m.kickoff_at)
        FROM core.weekly_matches m
        JOIN core.teams h ON h.id = m.home_team_id
        JOIN core.teams a ON a.id = m.away_team_id
       WHERE m.gameweek_id = v_gw.id), '[]'::jsonb),
    'table', game.league_table()
  ) INTO v;

  RETURN v;
END;
$$;

DROP VIEW IF EXISTS game.v_ingest_health;
CREATE VIEW game.v_ingest_health AS
SELECT
  (SELECT count(*) FROM core.external_refs WHERE provider <> 'manual_json'
                                             AND entity_type = 'player')      AS mapped_players,
  (SELECT count(*) FROM game.ingest_unmapped WHERE resolved_at IS NULL)       AS unmapped_open,
  (SELECT count(*) FROM game.ingest_alerts WHERE cleared_at IS NULL
                                             AND severity = 'block')          AS blocking_alerts,
  (SELECT max(started_at) FROM game.ingest_runs WHERE status IN ('ok','partial')) AS last_ok_run,
  (SELECT count(*) FROM game.ingest_runs
    WHERE status = 'failed' AND started_at > now() - INTERVAL '24 hours')     AS failures_24h,
  (SELECT g.code FROM game.gameweeks g JOIN core.leagues l ON l.id = g.league_id
    WHERE g.is_current ORDER BY l.created_at, l.code LIMIT 1)                 AS current_gw,
  (SELECT COALESCE(jsonb_object_agg(l.code, g.code), '{}'::jsonb)
     FROM game.gameweeks g JOIN core.leagues l ON l.id = g.league_id
    WHERE g.is_current)                                                        AS current_gw_by_league;
GRANT SELECT ON game.v_ingest_health TO authenticated;

INSERT INTO game.schema_migrations (version, note)
VALUES ('43', '★ קוראי מחזור נוכחי בטוחים לשתי ליגות') ON CONFLICT (version) DO NOTHING;

COMMIT;
