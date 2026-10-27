-- =====================================================================
--  db/tests/41_recap_by_mode.sql — סיכום מחזור באוכלוסייה מוגדרת (D12)
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

DELETE FROM auth.users WHERE id::TEXT LIKE 'f4100000-%';
INSERT INTO auth.users (id, email, is_anonymous) VALUES
  ('f4100000-0000-0000-0000-000000000001', 'r1@dubid.test', FALSE),
  ('f4100000-0000-0000-0000-000000000002', 'r2@dubid.test', FALSE),
  ('f4100000-0000-0000-0000-000000000003', 'r3@dubid.test', FALSE);
SET dubid.test_uid = 'f4100000-0000-0000-0000-000000000002'; SELECT game.ensure_profile('שני');
SET dubid.test_uid = 'f4100000-0000-0000-0000-000000000003'; SELECT game.ensure_profile('שלישי');
SET dubid.test_uid = 'f4100000-0000-0000-0000-000000000001'; SELECT game.ensure_profile('ראשון');

DO $$
DECLARE v_season UUID; g7 UUID; g8 UUID; l UUID; u1 UUID := 'f4100000-0000-0000-0000-000000000001';
  u2 UUID := 'f4100000-0000-0000-0000-000000000002'; u3 UUID := 'f4100000-0000-0000-0000-000000000003';
BEGIN
  SELECT s.id INTO v_season FROM core.seasons s JOIN core.leagues lg ON lg.id = s.league_id
   WHERE lg.code = 'ES_LALIGA' ORDER BY s.is_current DESC LIMIT 1;
  DELETE FROM game.gameweeks WHERE season_id = v_season AND number IN (7, 8);
  INSERT INTO game.gameweeks (season_id, number, code, lock_at, status)
  VALUES (v_season, 7, 'es-7', now() - INTERVAL '10 days', 'published') RETURNING id INTO g7;
  INSERT INTO game.gameweeks (season_id, number, code, lock_at, status)
  VALUES (v_season, 8, 'es-8', now() - INTERVAL '3 days', 'published') RETURNING id INTO g8;

  /* es-7: u1 שלישי בחמישייה */
  INSERT INTO game.user_lineups (user_id, gameweek_id, mode) VALUES (u1, g7, 'five') RETURNING id INTO l;
  INSERT INTO game.lineup_scores (lineup_id, gameweek_id, total_points, rank) VALUES (l, g7, 10, 3);

  /* es-8: חמישייה — u2 ראשון (40), u1 שני (30), u3 שלישי (30, הוכרע בשובר שוויון) */
  INSERT INTO game.user_lineups (user_id, gameweek_id, mode, team_name) VALUES (u2, g8, 'five', 'Leader FC') RETURNING id INTO l;
  INSERT INTO game.lineup_scores (lineup_id, gameweek_id, total_points, rank) VALUES (l, g8, 40, 1);
  INSERT INTO game.user_lineups (user_id, gameweek_id, mode) VALUES (u1, g8, 'five') RETURNING id INTO l;
  INSERT INTO game.lineup_scores (lineup_id, gameweek_id, total_points, rank) VALUES (l, g8, 30, 2);
  INSERT INTO game.user_lineups (user_id, gameweek_id, mode) VALUES (u3, g8, 'five') RETURNING id INTO l;
  INSERT INTO game.lineup_scores (lineup_id, gameweek_id, total_points, rank) VALUES (l, g8, 30, 3);
  /* והרכב מלא: u1 לבד, 99 נק׳ */
  INSERT INTO game.user_lineups (user_id, gameweek_id, mode) VALUES (u1, g8, 'full') RETURNING id INTO l;
  INSERT INTO game.lineup_scores (lineup_id, gameweek_id, total_points, rank) VALUES (l, g8, 99, 1);
END $$;

DO $$
DECLARE v JSONB;
BEGIN
  v := game.gameweek_recap('es-8', 'five');
  IF (v->>'entries')::int <> 3 OR (v->>'rank')::int <> 2 OR v->>'mode' <> 'five' THEN
    RAISE EXCEPTION 'FAIL 1: חמישייה מעורבבת או מקום לא רשמי %', v;
  END IF;
  IF (v->>'prevRank')::int <> 3 THEN RAISE EXCEPTION 'FAIL 2: prevRank %', v->>'prevRank'; END IF;
  IF v #>> '{top,name}' <> 'Leader FC' THEN RAISE EXCEPTION 'FAIL 3: מוביל %', v->'top'; END IF;

  v := game.gameweek_recap('es-8');
  IF v->>'mode' <> 'full' OR (v->>'entries')::int <> 1 OR (v->>'points')::numeric <> 99 THEN
    RAISE EXCEPTION 'FAIL 4: בלי פורמט — הפורמט של המשתמש (full קודם) %', v;
  END IF;
END $$;
\echo '  ✓ 1  סיכום לפי פורמט, מקום רשמי, מקום קודם, מוביל רשמי'

SET dubid.test_uid = '00000000-0000-0000-0000-0000000000ff';
DO $$
DECLARE v JSONB;
BEGIN
  v := game.gameweek_recap('es-8');
  IF (v->>'hasEntry')::boolean OR v->>'mode' <> 'five' OR (v->>'entries')::int <> 3 THEN
    RAISE EXCEPTION 'FAIL 5: בלי הגשה — הפורמט הגדול, בלי ערבוב %', v;
  END IF;
END $$;
\echo '  ✓ 2  בלי הגשה: הפורמט עם הכי הרבה מתמודדים, לא ערבוב'

DELETE FROM game.gameweeks WHERE code IN ('es-7','es-8');
