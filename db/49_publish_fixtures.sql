-- =====================================================================
--  db/49_publish_fixtures.sql · DUBID publishes its matches to the universe
--
--  core.weekly_matches is DUBID's gameweek schedule. Every other app
--  (FAN LIFE, THE WORKER, OFFSIDES) reads the neutral list, core.fixtures
--  (ecosystem/sql/0004_fixtures.sql), which has no gameweek in it.
--
--  This trigger is the bridge, and it points the right way: game → core.
--  It calls core.publish_fixture() — the one write path — so signals
--  (created / kickoff_moved / status / score / removed) are raised by the
--  shared layer, never by DUBID.
--
--  ★ Nothing in DUBID changes: no function reads core.fixtures, and a
--    failure here never blocks a DUBID write (it only raises a WARNING).
--  ★ Needs ecosystem 0004. Without it (fresh test DB before the shared
--    SQL), the file does nothing and says so.
--  Idempotent.
-- =====================================================================
BEGIN;

DO $guard$
BEGIN
  IF to_regprocedure('core.publish_fixture(uuid,uuid,uuid,uuid,uuid,timestamptz,text,text,smallint,smallint)') IS NULL THEN
    RAISE NOTICE '49_publish_fixtures: ecosystem 0004 not applied yet — skipped';
    RETURN;
  END IF;

  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION game.publish_fixture() RETURNS TRIGGER
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $body$
    DECLARE v_league uuid; v_season uuid;
    BEGIN
      BEGIN
        IF TG_OP = 'DELETE' THEN
          PERFORM core.unpublish_fixture(OLD.id);
          RETURN OLD;
        END IF;
        SELECT gw.league_id, gw.season_id INTO v_league, v_season
          FROM game.gameweeks gw WHERE gw.id = NEW.gameweek_id;
        PERFORM core.publish_fixture(NEW.id, v_league, v_season, NEW.home_team_id, NEW.away_team_id,
                                     NEW.kickoff_at, NEW.venue, NEW.status, NEW.home_goals, NEW.away_goals);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'publish_fixture % skipped: %', COALESCE(NEW.id, OLD.id), SQLERRM;
      END;
      RETURN COALESCE(NEW, OLD);
    END $body$
  $fn$;
  EXECUTE 'REVOKE ALL ON FUNCTION game.publish_fixture() FROM PUBLIC, anon, authenticated';

  EXECUTE 'CREATE OR REPLACE TRIGGER publish_fixture AFTER INSERT OR UPDATE OR DELETE ON core.weekly_matches
           FOR EACH ROW EXECUTE FUNCTION game.publish_fixture()';

  -- backfill: every match DUBID already holds (publish is a no-op when nothing changed)
  PERFORM core.publish_fixture(wm.id, gw.league_id, gw.season_id, wm.home_team_id, wm.away_team_id,
                               wm.kickoff_at, wm.venue, wm.status, wm.home_goals, wm.away_goals)
     FROM core.weekly_matches wm
     LEFT JOIN game.gameweeks gw ON gw.id = wm.gameweek_id
    WHERE wm.home_team_id IS NOT NULL AND wm.away_team_id IS NOT NULL
      AND wm.home_team_id <> wm.away_team_id;
END $guard$;

COMMIT;
