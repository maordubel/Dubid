-- =====================================================================
--  db/49_dnp_autofill.sql · שחקן שלא שיחק לא חוסם מחזור
--
--  הבאג: שחקן בהרכב של משתמש, שהקבוצה שלו שיחקה ונגמרה והוא לא עלה
--  למגרש (לא בדף המשחק של הספק) — לא היה לו שורת סטטיסטיקה, ו-
--  ingest_check_coverage העלתה "unmapped_in_lineup" חוסמת. המחזור נתקע
--  ב-scoring עד התערבות אדמין (gw-7, 19.10.2026: גיא מזרחי).
--
--  התיקון (דטרמיניסטי, בלי אדמין): שחקן שנעדר מדף משחק שנגמר מקבל שורת
--  DNP (0 דקות, כל השאר 0) — רק אם
--    · לקבוצה שלו יש בדף המשחק לפחות 11 שורות (הדף נקלט), ו
--    · השחקן **ממופה** לספק (scores365) — כלומר הספק מכיר אותו והיעדרו
--      אמיתי. שחקן לא ממופה ממשיך לחסום: שם באמת ייתכן שהוא שיחק.
--  שורת DNP נדרסת בקליטה הבאה אם התברר שהוא כן שיחק. התרעה ישנה
--  נסגרת אוטומטית (cleared_by = 'auto:dnp'). אידמפוטנטי.
-- =====================================================================
SET search_path = core, game, public;

CREATE OR REPLACE FUNCTION game.ingest_check_coverage(p_gw_code TEXT)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_gw UUID; v_missing JSONB; v_n INT;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw IS NULL THEN RETURN 0; END IF;

  /* 1. DNP אוטומטי: ממופה לספק + דף המשחק של הקבוצה נקלט + לא מופיע בו */
  INSERT INTO core.player_match_stats (match_id, player_id, team_id, minutes, started, extra)
  SELECT m.id, sl.player_id, sl.team_id, 0, FALSE, jsonb_build_object('auto_dnp', TRUE)
    FROM (SELECT DISTINCT s.player_id, s.team_id
            FROM game.user_lineups ul
            JOIN game.user_lineup_slots s ON s.lineup_id = ul.id
           WHERE ul.gameweek_id = v_gw AND ul.status IN ('submitted','locked','scored')) sl
    JOIN core.weekly_matches m
      ON m.gameweek_id = v_gw AND m.status = 'finished'
     AND (m.home_team_id = sl.team_id OR m.away_team_id = sl.team_id)
   WHERE EXISTS (SELECT 1 FROM core.external_refs r
                  WHERE r.provider = 'scores365' AND r.entity_type = 'player'
                    AND r.entity_id = sl.player_id)
     AND (SELECT count(*) FROM core.player_match_stats x
           WHERE x.match_id = m.id AND x.team_id = sl.team_id) >= 11
     AND NOT EXISTS (SELECT 1 FROM core.player_match_stats x
                      WHERE x.match_id = m.id AND x.player_id = sl.player_id)
  ON CONFLICT (match_id, player_id) DO NOTHING;

  /* 2. מה שנשאר חסר — באמת לא ממופה / דף משחק חסר */
  WITH picked AS (
    SELECT DISTINCT sl.player_id, sl.team_id
      FROM game.user_lineups ul
      JOIN game.user_lineup_slots sl ON sl.lineup_id = ul.id
     WHERE ul.gameweek_id = v_gw AND ul.status IN ('submitted','locked','scored')
  ),
  their_match AS (
    SELECT p.player_id, m.id AS match_id
      FROM picked p
      JOIN core.weekly_matches m
        ON m.gameweek_id = v_gw
       AND (m.home_team_id = p.team_id OR m.away_team_id = p.team_id)
     WHERE m.status = 'finished'
  )
  SELECT jsonb_agg(jsonb_build_object(
           'player', core.ext_code('player', tm.player_id),
           'nameHe', pl.name_he)), count(*)
    INTO v_missing, v_n
    FROM their_match tm
    JOIN core.players pl ON pl.id = tm.player_id
   WHERE NOT EXISTS (
     SELECT 1 FROM core.player_match_stats s
      WHERE s.match_id = tm.match_id AND s.player_id = tm.player_id);

  v_n := COALESCE(v_n, 0);

  IF v_n > 0 THEN
    INSERT INTO game.ingest_alerts (gw_code, kind, severity, detail)
    VALUES (p_gw_code, 'unmapped_in_lineup', 'block',
            jsonb_build_object('count', v_n, 'players', v_missing))
    ON CONFLICT DO NOTHING;
    UPDATE game.ingest_unmapped SET blocking = TRUE
     WHERE resolved_at IS NULL AND entity_type = 'player';
  ELSE
    UPDATE game.ingest_alerts
       SET cleared_at = now(), cleared_by = 'auto:dnp'
     WHERE gw_code = p_gw_code AND kind = 'unmapped_in_lineup' AND cleared_at IS NULL;
  END IF;

  RETURN v_n;
END;
$$;

/* ───── התרעות חוסמות של מחזור טיוטה (placeholder של קליטה) אינן "תקלה" ─────
   מחזור שעוד לא נפתח לא מנוקד ולא מפורסם; ההתרעה נשארת בטבלה (ונבדקת כשהמחזור
   מתקדם), אבל לא נספרת בבריאות המערכת. */
DROP VIEW IF EXISTS game.v_ingest_health;
CREATE VIEW game.v_ingest_health AS
SELECT
  (SELECT count(*) FROM core.external_refs WHERE provider <> 'manual_json'
                                             AND entity_type = 'player')      AS mapped_players,
  (SELECT count(*) FROM game.ingest_unmapped WHERE resolved_at IS NULL)       AS unmapped_open,
  (SELECT count(*) FROM game.ingest_alerts a
    WHERE a.cleared_at IS NULL AND a.severity = 'block'
      AND NOT EXISTS (SELECT 1 FROM game.gameweeks g
                       WHERE g.code = a.gw_code AND g.status = 'draft'))       AS blocking_alerts,
  (SELECT max(started_at) FROM game.ingest_runs WHERE status IN ('ok','partial')) AS last_ok_run,
  (SELECT count(*) FROM game.ingest_runs
    WHERE status = 'failed' AND started_at > now() - INTERVAL '24 hours')     AS failures_24h,
  (SELECT g.code FROM game.gameweeks g JOIN core.leagues l ON l.id = g.league_id
    WHERE g.is_current ORDER BY l.created_at, l.code LIMIT 1)                 AS current_gw,
  (SELECT COALESCE(jsonb_object_agg(l.code, g.code), '{}'::jsonb)
     FROM game.gameweeks g JOIN core.leagues l ON l.id = g.league_id
    WHERE g.is_current)                                                        AS current_gw_by_league;
GRANT SELECT ON game.v_ingest_health TO authenticated;
