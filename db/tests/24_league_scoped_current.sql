-- db/tests/24_league_scoped_current.sql — מחזור נוכחי לכל ליגה בנפרד
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;
\ir _shared_gameweek.sql

DELETE FROM auth.users WHERE id::TEXT LIKE 'f3800000-%';
INSERT INTO auth.users (id, email, is_anonymous) VALUES
  ('f3800000-0000-0000-0000-000000000001', 'leaguecur@dubid.test', FALSE);
SET dubid.test_uid = 'f3800000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('בודק ליגות');
SELECT game.claim_admin('test-admin-pass');

DO $$
DECLARE
  l2 UUID; s2 UUID; g2 UUID; il_cur UUID; n INT;
BEGIN
  /* ליגה שנייה (יוון) עם עונה נוכחית ומחזור פתוח */
  INSERT INTO core.leagues (code, country_code, default_locale, text_direction, timezone, names)
  VALUES ('GR_TEST', 'GR', 'el', 'ltr', 'Europe/Athens',
          '{"he":{"full":"סופר ליג"},"en":{"full":"Super League"},"el":{"full":"Super League"}}')
  ON CONFLICT (code) DO UPDATE SET is_active = TRUE RETURNING id INTO l2;
  INSERT INTO core.seasons (league_id, label, starts_on, ends_on, is_current)
  VALUES (l2, '2026/27', '2026-08-15', '2027-05-30', TRUE)
  ON CONFLICT (league_id, label) DO UPDATE SET is_current = TRUE RETURNING id INTO s2;

  SELECT id INTO il_cur FROM game.gameweeks WHERE is_current AND league_id <> l2 LIMIT 1;

  INSERT INTO game.gameweeks (season_id, number, code, lock_at, first_kickoff_at, status)
  VALUES (s2, 1, 'gr-test-1', now() + INTERVAL '2 days', now() + INTERVAL '2 days', 'open')
  ON CONFLICT (season_id, number) DO UPDATE SET status = 'open' RETURNING id INTO g2;

  IF (SELECT league_id FROM game.gameweeks WHERE id = g2) <> l2 THEN
    RAISE EXCEPTION 'FAIL 1: league_id לא נגזר מהעונה';
  END IF;

  PERFORM game.sync_current_gameweek();

  IF NOT EXISTS (SELECT 1 FROM game.gameweeks WHERE id = g2 AND is_current) THEN
    RAISE EXCEPTION 'FAIL 2: המחזור של יוון לא הפך לנוכחי';
  END IF;
  IF il_cur IS NOT NULL AND NOT EXISTS (SELECT 1 FROM game.gameweeks WHERE id = il_cur AND is_current) THEN
    RAISE EXCEPTION 'FAIL 3: פתיחת מחזור ביוון כיבתה את הנוכחי בישראל';
  END IF;
  SELECT count(*) INTO n FROM game.gameweeks WHERE is_current GROUP BY league_id ORDER BY 1 DESC LIMIT 1;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 4: יותר מנוכחי אחד בליגה (%)', n; END IF;

  /* אינדקס: שני נוכחיים באותה ליגה נחסמים */
  BEGIN
    INSERT INTO game.gameweeks (season_id, number, code, lock_at, first_kickoff_at, status, is_current)
    VALUES (s2, 2, 'gr-test-2', now() + INTERVAL '9 days', now() + INTERVAL '9 days', 'draft', TRUE);
    RAISE EXCEPTION 'FAIL 5: האינדקס לא חסם שני נוכחיים באותה ליגה';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  /* auto_advance: מחזור קודם פתוח בישראל לא חוסם פתיחה ביוון */
  UPDATE game.ingest_config SET enabled = TRUE, auto_open_next = TRUE;
  PERFORM game.auto_advance();
  IF NOT EXISTS (SELECT 1 FROM game.gameweeks WHERE id = g2 AND is_current) THEN
    RAISE EXCEPTION 'FAIL 6: auto_advance פגע בנוכחי של יוון';
  END IF;

  /* ניקוי */
  DELETE FROM game.gameweeks WHERE season_id = s2;
  DELETE FROM core.seasons WHERE id = s2;
  DELETE FROM core.leagues WHERE id = l2;
END $$;
\echo '  ✓ 24  מחזור נוכחי נפרד לכל ליגה'
