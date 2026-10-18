-- db/tests/25_greece_league.sql — ליגה שנייה: סגלים, בורר, תאימות לאחור
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

DO $$
DECLARE d JSONB; n_def INT; n_gr INT; pl JSONB; l JSONB;
BEGIN
  /* 1. בלי פרמטר = ישראל, בדיוק כמו קודם */
  d := game.squads();
  IF d->'season'->>'code' <> 'IL_PREMIER' THEN RAISE EXCEPTION 'FAIL 1: ברירת המחדל אינה ישראל (%)', d->'season'->>'code'; END IF;
  n_def := jsonb_array_length(d->'players');

  /* 2. יוון: 14 קבוצות, 457 שחקנים */
  d := game.squads('GR_SUPER');
  IF d->'season'->>'code' <> 'GR_SUPER' THEN RAISE EXCEPTION 'FAIL 2a: %', d->'season'; END IF;
  IF jsonb_array_length(d->'teams') <> 14 THEN RAISE EXCEPTION 'FAIL 2b: % קבוצות', jsonb_array_length(d->'teams'); END IF;
  n_gr := jsonb_array_length(d->'players');
  IF n_gr <> 457 THEN RAISE EXCEPTION 'FAIL 2c: % שחקנים', n_gr; END IF;

  /* 3. אין זליגה: אף שחקן ישראלי ביוון ולהפך */
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(game.squads()->'players') x
              WHERE (x->>'externalId')::INT >= 30000000) THEN RAISE EXCEPTION 'FAIL 3a: שחקן יווני בישראל'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(d->'players') x
              WHERE (x->>'externalId')::INT < 30000000) THEN RAISE EXCEPTION 'FAIL 3b: שחקן ישראלי ביוון'; END IF;

  /* 4. מחירים 1–5, שם תצוגה לא ריק, כל שחקן שייך לקבוצה בליגה */
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(d->'players') x
              WHERE (x->>'price')::NUMERIC NOT BETWEEN 1 AND 5
                 OR COALESCE(x->>'nameHe','') = '' OR COALESCE(x->>'nameEn','') = '')
  THEN RAISE EXCEPTION 'FAIL 4: מחיר/שם לא תקין'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(d->'players') x
              WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d->'teams') t WHERE t->>'id' = x->>'teamId'))
  THEN RAISE EXCEPTION 'FAIL 4b: שחקן בלי קבוצה'; END IF;

  /* 5. שמות הקבוצות בשלוש שפות */
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(d->'teams') t
              WHERE COALESCE(t->>'nameHe','')='' OR COALESCE(t->>'nameEn','')='' OR COALESCE(t->>'nameEl','')='')
  THEN RAISE EXCEPTION 'FAIL 5: קבוצה בלי שם בשלוש שפות'; END IF;

  /* 6. הבורר: יוון נסתרת עד שיש לה מחזור נוכחי */
  l := game.leagues_public();
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(l) x WHERE x->>'code' = 'GR_SUPER') THEN
    RAISE EXCEPTION 'FAIL 6a: יוון בבורר בלי מחזור נוכחי'; END IF;
  IF game.current_gameweek('GR_SUPER') IS NOT NULL THEN RAISE EXCEPTION 'FAIL 6b'; END IF;

  /* 7. עם מחזור נוכחי — מופיעה, והמחזור הנוכחי של ישראל לא נפגע */
  INSERT INTO game.gameweeks (season_id, number, code, lock_at, first_kickoff_at, status)
  SELECT s.id, 1, 'gr-test-1', now() + INTERVAL '3 days', now() + INTERVAL '3 days', 'open'
    FROM core.seasons s JOIN core.leagues x ON x.id = s.league_id WHERE x.code = 'GR_SUPER'
  ON CONFLICT (season_id, number) DO UPDATE SET status = 'open';
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  PERFORM game.sync_current_gameweek();
  IF game.current_gameweek('GR_SUPER') <> 'gr-test-1' THEN RAISE EXCEPTION 'FAIL 7a'; END IF;
  IF game.current_gameweek() = 'gr-test-1' THEN RAISE EXCEPTION 'FAIL 7b: ברירת המחדל קפצה ליוון'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(game.leagues_public()) x WHERE x->>'code' = 'GR_SUPER') THEN
    RAISE EXCEPTION 'FAIL 7c: יוון לא בבורר'; END IF;
  IF game.leagues_public()->0->>'code' <> 'IL_PREMIER' THEN RAISE EXCEPTION 'FAIL 7d: ישראל לא ראשונה'; END IF;

  DELETE FROM game.gameweeks WHERE code = 'gr-test-1';
  PERFORM game.sync_current_gameweek();
END $$;
\echo '  ✓ 25  הליגה היוונית: סגלים, בורר, תאימות לאחור'
