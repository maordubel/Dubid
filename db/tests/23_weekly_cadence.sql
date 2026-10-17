-- db/tests/23_weekly_cadence.sql — חוק יום שני 09:00 (אתונה)
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;
\ir _shared_gameweek.sql

DELETE FROM auth.users WHERE id::TEXT LIKE 'f3700000-%';
INSERT INTO auth.users (id, email, is_anonymous) VALUES
  ('f3700000-0000-0000-0000-000000000001', 'cadence@dubid.test', FALSE);
SET dubid.test_uid = 'f3700000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('בודק קצב');
SELECT game.claim_admin('hapoelTA14!');

DO $$
DECLARE r TIMESTAMPTZ;
BEGIN
  -- שבת 17.10.2026 18:45 אתונה → יום שני 12.10 09:00 אתונה (06:00 UTC, קיץ UTC+3)
  r := game.gameweek_publish_at('2026-10-17 15:45+00');
  IF r <> '2026-10-12 06:00+00' THEN RAISE EXCEPTION 'FAIL 1: %', r; END IF;
  -- דדליין בשעה 08:00 ביום שני עצמו → שעה לפני הדדליין
  r := game.gameweek_publish_at('2026-10-19 05:00+00');
  IF r <> '2026-10-19 04:00+00' THEN RAISE EXCEPTION 'FAIL 2: %', r; END IF;
  -- אחרי מעבר לשעון חורף (UTC+2): 09:00 = 07:00 UTC
  r := game.gameweek_publish_at('2026-11-07 15:00+00');
  IF r <> '2026-11-02 07:00+00' THEN RAISE EXCEPTION 'FAIL 3: %', r; END IF;
END $$;
\echo '  ✓ 1-3  זמן הפרסום נגזר נכון, כולל שעון חורף'

DO $$
DECLARE v_gw UUID; v_status TEXT; v_pub TIMESTAMPTZ;
BEGIN
  UPDATE game.ingest_config SET enabled = TRUE, auto_open_next = TRUE;
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'gw-2';
  UPDATE game.gameweeks SET status = 'published' WHERE number < 99 AND id <> v_gw AND status <> 'archived';
  /* דדליין עתידי רחוק: זמן הפרסום עדיין לא הגיע → נשאר טיוטה */
  UPDATE game.gameweeks SET status = 'draft', lock_at = now() + INTERVAL '30 days' WHERE id = v_gw;
  UPDATE core.weekly_matches SET status = 'scheduled', home_goals = NULL, away_goals = NULL,
         kickoff_at = now() + INTERVAL '30 days' WHERE gameweek_id = v_gw;
  PERFORM game.auto_advance();
  SELECT status INTO v_status FROM game.gameweeks WHERE id = v_gw;
  IF v_status <> 'draft' THEN RAISE EXCEPTION 'FAIL 4: נפתח לפני זמנו (%)', v_status; END IF;

  /* דדליין בעוד שעתיים ו-publish_at כבר עבר → נפתח */
  UPDATE game.gameweeks SET lock_at = now() + INTERVAL '2 hours' WHERE id = v_gw;
  v_pub := game.gameweek_publish_at(now() + INTERVAL '2 hours');
  IF v_pub > now() THEN RAISE NOTICE 'skip 5: publish_at עדיין בעתיד (%)', v_pub; RETURN; END IF;
  PERFORM game.auto_advance();
  SELECT status INTO v_status FROM game.gameweeks WHERE id = v_gw;
  IF v_status <> 'open' THEN RAISE EXCEPTION 'FAIL 5: לא נפתח אחרי זמן הפרסום (%)', v_status; END IF;
END $$;
\echo '  ✓ 4-5  לא נפתח לפני יום שני 09:00; נפתח אחריו'
