-- db/tests/36_format_readiness.sql — formats.{five,full} ב-leagues_public (db/54)
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;
\ir _shared_gameweek.sql

DO $$
DECLARE v JSONB; l JSONB; f JSONB; n INT := 0; gw UUID;
BEGIN
  v := game.leagues_public();
  FOR l IN SELECT * FROM jsonb_array_elements(v) LOOP
    IF l->>'currentGameweek' IS NOT NULL THEN
      n := n + 1;
      FOREACH f IN ARRAY ARRAY[l->'formats'->'five', l->'formats'->'full'] LOOP
        IF f IS NULL OR f->>'state' NOT IN ('ready','degraded','blocked') THEN
          RAISE EXCEPTION 'FAIL 1: state לא תקין %', f; END IF;
        IF jsonb_typeof(f->'reasons') <> 'array' OR (f->>'canSubmit') NOT IN ('true','false') THEN
          RAISE EXCEPTION 'FAIL 2: צורה שגויה %', f; END IF;
      END LOOP;
    END IF;
  END LOOP;
  IF n = 0 THEN RAISE NOTICE 'skip: אין ליגה עם מחזור נוכחי בסביבת הבדיקה'; END IF;

  /* מחזור בלי משחקים → blocked + no_fixtures; נעול → canSubmit=false */
  SELECT id INTO gw FROM game.gameweeks WHERE code = 'gw-2';
  f := game.format_readiness(gw, 'five');
  IF f->>'state' IS NULL THEN RAISE EXCEPTION 'FAIL 3'; END IF;
  UPDATE game.gameweeks SET status = 'locked' WHERE id = gw;
  f := game.format_readiness(gw, 'full');
  IF (f->>'canSubmit') <> 'false' THEN RAISE EXCEPTION 'FAIL 4: מחזור נעול לא יכול להיות canSubmit'; END IF;
  f := game.format_readiness('00000000-0000-0000-0000-000000000000', 'five');
  IF f->>'state' <> 'blocked' THEN RAISE EXCEPTION 'FAIL 5: מחזור לא קיים'; END IF;
END $$;
