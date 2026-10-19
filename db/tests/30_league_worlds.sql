-- db/tests/30_league_worlds.sql — זירות פרטיות לפי ליגה + מחירים זמניים
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

DELETE FROM auth.users WHERE id::TEXT LIKE 'f4000000-%';
INSERT INTO auth.users (id, email, is_anonymous) VALUES
  ('f4000000-0000-0000-0000-000000000001', 'w1@dubid.test', FALSE),
  ('f4000000-0000-0000-0000-000000000002', 'w2@dubid.test', FALSE);
SET dubid.test_uid = 'f4000000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('עולם א');
SELECT game.create_league('Arena IL', 'five', NULL);
SELECT game.create_league('Arena EN', 'five', NULL, 'EN_PL');

DO $$
DECLARE r JSONB; v_code_en TEXT; v_code_il TEXT;
BEGIN
  r := game.my_leagues();
  IF jsonb_array_length(r->'leagues') <> 2 THEN RAISE EXCEPTION 'FAIL 1: %', r; END IF;
  IF NOT (SELECT bool_and((x->>'worldPrimary')::BOOLEAN = (x->>'world' = 'IL_PREMIER'))
            FROM jsonb_array_elements(r->'leagues') x) THEN RAISE EXCEPTION 'FAIL 2: %', r; END IF;
  SELECT code INTO v_code_en FROM game.leagues WHERE name = 'Arena EN';
  SELECT code INTO v_code_il FROM game.leagues WHERE name = 'Arena IL';
  IF (game.league_by_code(v_code_en))->>'world' <> 'EN_PL' THEN RAISE EXCEPTION 'FAIL 3'; END IF;
  PERFORM set_config('dubid.t_en', v_code_en, FALSE);
  PERFORM set_config('dubid.t_il', v_code_il, FALSE);
END $$;

SET dubid.test_uid = 'f4000000-0000-0000-0000-000000000002';
SELECT game.ensure_profile('עולם ב');
DO $$
BEGIN
  /* עולם שגוי נדחה */
  BEGIN PERFORM game.join_league(current_setting('dubid.t_en')); RAISE EXCEPTION 'FAIL 4a';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'WRONG_LEAGUE' THEN RAISE; END IF; END;
  BEGIN PERFORM game.join_league(current_setting('dubid.t_il'), 'ES_LALIGA'); RAISE EXCEPTION 'FAIL 4b';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'WRONG_LEAGUE' THEN RAISE; END IF; END;
  /* עולם נכון מתקבל */
  PERFORM game.join_league(current_setting('dubid.t_en'), 'EN_PL');
  PERFORM game.join_league(current_setting('dubid.t_il'));
  IF jsonb_array_length(game.my_leagues()->'leagues') <> 2 THEN RAISE EXCEPTION 'FAIL 5'; END IF;
  /* ליגה לא ידועה */
  BEGIN PERFORM game.create_league('x1', 'five', NULL, 'XX_NONE'); RAISE EXCEPTION 'FAIL 6';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'UNKNOWN_LEAGUE' THEN RAISE; END IF; END;
END $$;

/* מחירים: אין שחקן לא-מדורג של ליגה לא-ראשית עם מחיר מחוץ ל-1..3, ואף מדורג לא שונה */
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM core.squads s JOIN core.seasons se ON se.id = s.season_id
   WHERE NOT s.rated AND s.valid_to IS NULL AND NOT s.price_locked
     AND se.league_id <> (SELECT id FROM core.leagues ORDER BY created_at, code LIMIT 1)
     AND (s.fantasy_price IS NULL OR s.fantasy_price NOT BETWEEN 1 AND 3);
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 7: % מחירים מחוץ לטווח', n; END IF;
  SELECT count(*) INTO n FROM core.squads s JOIN core.seasons se ON se.id = s.season_id
   WHERE s.rated AND s.valid_to IS NULL AND s.fantasy_price NOT BETWEEN 1 AND 5;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 8'; END IF;
END $$;
