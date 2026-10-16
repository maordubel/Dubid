-- db/tests/21_announce.sql — הודעות מחזור: שורה אחת לאירוע, ולא שולחים פעמיים
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;
\ir _shared_gameweek.sql

DELETE FROM game.announce_outbox;
UPDATE game.gameweeks SET status='open', lock_at = now() + INTERVAL '2 days' WHERE code='gw-2';
DELETE FROM game.user_lineups WHERE id = 'f3500000-0000-0000-0000-0000000000a1';
DELETE FROM game.ingest_alerts WHERE gw_code = 'gw-2';

DO $t$
DECLARE n INT; r RECORD; v_gw UUID; v_u UUID; v_l UUID;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'gw-2';

  /* 1 · מחזור פתוח → opened בלבד */
  PERFORM game.announce_scan();
  SELECT count(*) INTO n FROM game.announce_outbox WHERE gw_code='gw-2' AND kind='opened';
  IF n <> 1 THEN RAISE EXCEPTION 'opened expected 1, got %', n; END IF;
  IF EXISTS (SELECT 1 FROM game.announce_outbox WHERE kind IN ('reminder','locked','published')) THEN
    RAISE EXCEPTION 'too early: reminder/locked/published must not exist yet'; END IF;

  /* 2 · הרצה חוזרת לא מכפילה */
  PERFORM game.announce_scan(); PERFORM game.announce_scan();
  SELECT count(*) INTO n FROM game.announce_outbox WHERE gw_code='gw-2';
  IF n <> 1 THEN RAISE EXCEPTION 'rescan duplicated: %', n; END IF;

  /* 3 · שעתיים לנעילה → reminder */
  UPDATE game.gameweeks SET lock_at = now() + INTERVAL '2 hours' WHERE id = v_gw;
  PERFORM game.announce_scan();
  SELECT count(*) INTO n FROM game.announce_outbox WHERE kind='reminder' AND gw_code='gw-2';
  IF n <> 1 THEN RAISE EXCEPTION 'reminder expected, got %', n; END IF;

  /* 4 · נעילה → locked */
  UPDATE game.gameweeks SET status='locked', lock_at = now() - INTERVAL '1 minute' WHERE id = v_gw;
  PERFORM game.announce_scan();
  SELECT count(*) INTO n FROM game.announce_outbox WHERE kind='locked' AND gw_code='gw-2';
  IF n <> 1 THEN RAISE EXCEPTION 'locked expected, got %', n; END IF;

  /* 5 · התרעה חוסמת → alert, פעם אחת */
  INSERT INTO game.ingest_alerts (gw_code, kind, severity, detail) VALUES ('gw-2','var','block','{"x":1}');
  PERFORM game.announce_scan(); PERFORM game.announce_scan();
  SELECT count(*) INTO n FROM game.announce_outbox WHERE kind='alert';
  IF n <> 1 THEN RAISE EXCEPTION 'alert expected once, got %', n; END IF;

  /* 6 · פרסום → published עם טבלה */
  INSERT INTO game.users (id, display_name) VALUES ('f3500000-0000-0000-0000-000000000001','אלון')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO game.user_lineups (id, user_id, gameweek_id, status)
    VALUES ('f3500000-0000-0000-0000-0000000000a1','f3500000-0000-0000-0000-000000000001', v_gw, 'scored')
    ON CONFLICT DO NOTHING;
  INSERT INTO game.lineup_scores (lineup_id, gameweek_id, total_points, rank)
    VALUES ('f3500000-0000-0000-0000-0000000000a1', v_gw, 61.5, 1)
    ON CONFLICT (lineup_id) DO UPDATE SET total_points = 61.5, rank = 1;
  UPDATE game.gameweeks SET status='published' WHERE id = v_gw;
  PERFORM game.announce_scan();
  SELECT * INTO r FROM game.announce_outbox WHERE kind='published' AND gw_code='gw-2';
  IF r.id IS NULL THEN RAISE EXCEPTION 'published expected'; END IF;
  IF r.payload #>> '{round,0,name}' <> 'אלון' OR (r.payload #>> '{round,0,points}')::numeric <> 61.5 THEN
    RAISE EXCEPTION 'round table wrong: %', r.payload->'round'; END IF;
  IF jsonb_array_length(r.payload->'season') < 1 THEN RAISE EXCEPTION 'season table empty'; END IF;

  /* 7 · claim לוקח, ולא לוקח פעמיים */
  SELECT count(*) INTO n FROM game.announce_claim(10);
  IF n < 5 THEN RAISE EXCEPTION 'claim should take the pending rows, got %', n; END IF;
  SELECT count(*) INTO n FROM game.announce_claim(10);
  IF n <> 0 THEN RAISE EXCEPTION 'second claim must be empty, got %', n; END IF;

  /* 8 · mark; חכירה שפגה → unknown ולא נשלח שוב */
  PERFORM game.announce_mark(r.id, 'sent');
  IF (SELECT state FROM game.announce_outbox WHERE id = r.id) <> 'sent' THEN RAISE EXCEPTION 'mark failed'; END IF;
  UPDATE game.announce_outbox SET state='sending', lease_until = now() - INTERVAL '1 minute'
   WHERE kind='opened';
  PERFORM game.announce_claim(10);
  IF (SELECT state FROM game.announce_outbox WHERE kind='opened') <> 'unknown' THEN
    RAISE EXCEPTION 'expired lease must become unknown'; END IF;

  /* 9 · אין גישה לאנונימי */
  IF has_function_privilege('anon', 'game.announce_claim(int)', 'execute')
     OR has_function_privilege('authenticated', 'game.announce_scan()', 'execute') THEN
    RAISE EXCEPTION 'outbox functions must not be callable by clients'; END IF;

  RAISE NOTICE '✓ announce: 9 checks';
END
$t$;
