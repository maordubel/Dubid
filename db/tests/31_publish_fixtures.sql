-- db/tests/31_publish_fixtures.sql — DUBID's matches reach core.fixtures, with signals
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;
\ir _shared_gameweek.sql

DO $$
DECLARE v_wm UUID; v_n INT; v_kinds TEXT;
BEGIN
  IF to_regprocedure('core.publish_fixture(uuid,uuid,uuid,uuid,uuid,timestamptz,text,text,smallint,smallint)') IS NULL THEN
    RAISE EXCEPTION 'FAIL 0: ecosystem 0004 missing';
  END IF;
  -- backfill: every complete weekly match is a fixture
  SELECT count(*) INTO v_n FROM core.weekly_matches wm
   WHERE wm.home_team_id <> wm.away_team_id AND NOT EXISTS (SELECT 1 FROM core.fixtures f WHERE f.id = wm.id);
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL 1: % weekly matches not published', v_n; END IF;

  SELECT id INTO v_wm FROM core.weekly_matches ORDER BY kickoff_at NULLS LAST LIMIT 1;
  UPDATE core.weekly_matches SET status = 'finished', home_goals = 2, away_goals = 1 WHERE id = v_wm;
  IF (SELECT (status, home_goals, away_goals) FROM core.fixtures WHERE id = v_wm) IS DISTINCT FROM ('finished'::TEXT, 2::SMALLINT, 1::SMALLINT)
    THEN RAISE EXCEPTION 'FAIL 2: fixture not updated'; END IF;
  SELECT string_agg(kind, ',' ORDER BY id) INTO v_kinds FROM core.fixture_signals WHERE fixture_id = v_wm AND kind IN ('status','score');
  IF v_kinds IS NULL OR v_kinds NOT LIKE '%status%' OR v_kinds NOT LIKE '%score%' THEN RAISE EXCEPTION 'FAIL 3: %', v_kinds; END IF;

  -- a no-op update raises no new signal
  SELECT count(*) INTO v_n FROM core.fixture_signals;
  UPDATE core.weekly_matches SET status = 'finished' WHERE id = v_wm;
  IF (SELECT count(*) FROM core.fixture_signals) <> v_n THEN RAISE EXCEPTION 'FAIL 4: no-op signalled'; END IF;
END $$;

-- the browser can neither read nor write the neutral tables
SET ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM 1 FROM core.fixtures LIMIT 1; RAISE EXCEPTION 'FAIL 5: anon reads core.fixtures';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'ok 31_publish_fixtures';
