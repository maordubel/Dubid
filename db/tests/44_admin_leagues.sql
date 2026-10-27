-- db/tests/44_admin_leagues.sql — לוח הניהול וריבוי ליגות (db/62)
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;
\ir _shared_gameweek.sql

DELETE FROM auth.users WHERE id::TEXT LIKE 'd4400000-%';
INSERT INTO auth.users (id, email, is_anonymous) VALUES ('d4400000-0000-0000-0000-000000000001', 'admin44@x.test', FALSE);
SET dubid.test_uid = 'd4400000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('מנהל 44');
SELECT game.claim_admin('test-admin-pass');

DO $$
DECLARE r JSONB; v_en UUID; v_il_cur TEXT; v JSONB;
BEGIN
  -- 1. יצירת מחזור לאנגליה: קידומת en-, עונה אנגלית
  r := game.admin_create_gameweek(30::SMALLINT, now() + INTERVAL '30 days', NULL, FALSE, 'EN_PL');
  IF r->>'code' <> 'en-30' THEN RAISE EXCEPTION 'FAIL 1: %', r; END IF;
  SELECT s.league_id INTO v_en FROM game.gameweeks g JOIN core.seasons s ON s.id = g.season_id WHERE g.code = 'en-30';
  IF v_en IS DISTINCT FROM (SELECT id FROM core.leagues WHERE code = 'EN_PL') THEN RAISE EXCEPTION 'FAIL 1b: עונה לא אנגלית'; END IF;
  -- בלי ליגה — כמו קודם (הראשית, gw-)
  r := game.admin_create_gameweek(31::SMALLINT);
  IF r->>'code' <> 'gw-31' THEN RAISE EXCEPTION 'FAIL 1c: %', r; END IF;

  -- 2. מחזור נוכחי באנגליה לא מכבה את ישראל
  SELECT g.code INTO v_il_cur FROM game.gameweeks g JOIN core.seasons s ON s.id = g.season_id
    JOIN core.leagues l ON l.id = s.league_id WHERE l.code = 'IL_PREMIER' AND g.is_current LIMIT 1;
  INSERT INTO core.weekly_matches (gameweek_id, home_team_id, away_team_id, kickoff_at, status)
  SELECT g.id, t[1], t[2], now() + INTERVAL '30 days', 'scheduled'
    FROM game.gameweeks g, (SELECT array_agg(DISTINCT team_id) t FROM (SELECT sq.team_id FROM core.squads sq
         JOIN core.seasons s ON s.id = sq.season_id JOIN core.leagues l ON l.id = s.league_id
        WHERE l.code = 'EN_PL' LIMIT 50) x) tt
   WHERE g.code = 'en-30';
  PERFORM game.admin_set_current_gameweek('en-30');
  IF v_il_cur IS NOT NULL AND NOT (SELECT is_current FROM game.gameweeks WHERE code = v_il_cur) THEN
    RAISE EXCEPTION 'FAIL 2: מחזור נוכחי באנגליה כיבה את ישראל (%)', v_il_cur;
  END IF;
  IF NOT (SELECT is_current FROM game.gameweeks WHERE code = 'en-30') THEN RAISE EXCEPTION 'FAIL 2b'; END IF;

  -- 3. מבט-על: כל הליגות, עם מחזור והפרדת אנשים/בית
  v := game.admin_leagues_overview();
  IF jsonb_array_length(v) <> (SELECT count(*) FROM core.leagues) THEN RAISE EXCEPTION 'FAIL 3: %', v; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) x WHERE x->>'league' = 'EN_PL' AND x #>> '{round,code}' = 'en-30') THEN
    RAISE EXCEPTION 'FAIL 3b: %', v;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) x WHERE x #> '{round,entries}' ? 'fiveHouse') THEN
    RAISE EXCEPTION 'FAIL 3c';
  END IF;

  DELETE FROM game.gameweeks WHERE code IN ('en-30', 'gw-31');
END $$;

-- 4. רק אדמין
SET dubid.test_uid = 'd1000000-0000-0000-0000-000000000002';
DO $$ BEGIN
  BEGIN PERFORM game.admin_leagues_overview(); RAISE EXCEPTION 'FAIL 4';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%ADMIN_REQUIRED%' THEN RAISE; END IF; END;
END $$;
\echo '  ✓✓ 44 — לוח ניהול: מחזור לליגה, נוכחי לפי ליגה, מבט-על'
