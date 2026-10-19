-- db/tests/29_england_spain.sql — אנגליה וספרד: סגלים, הפרדה, קליטה, בורר
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

DO $$
DECLARE d JSONB; il JSONB; gr JSONB; n INT; s2 UUID; r JSONB; l JSONB;
BEGIN
  il := game.squads(); gr := game.squads('GR_SUPER');

  /* 1. אנגליה: 20 קבוצות, 599 שחקנים */
  d := game.squads('EN_PL');
  IF d->'season'->>'code' <> 'EN_PL' THEN RAISE EXCEPTION 'FAIL 1a: %', d->'season'; END IF;
  IF jsonb_array_length(d->'teams') <> 20 THEN RAISE EXCEPTION 'FAIL 1b: % קבוצות', jsonb_array_length(d->'teams'); END IF;
  IF jsonb_array_length(d->'players') <> 599 THEN RAISE EXCEPTION 'FAIL 1c: % שחקנים', jsonb_array_length(d->'players'); END IF;

  /* 2. ספרד: 20 קבוצות, 566 שחקנים */
  d := game.squads('ES_LALIGA');
  IF jsonb_array_length(d->'teams') <> 20 THEN RAISE EXCEPTION 'FAIL 2a'; END IF;
  IF jsonb_array_length(d->'players') <> 566 THEN RAISE EXCEPTION 'FAIL 2b: %', jsonb_array_length(d->'players'); END IF;

  /* 3. מחירים 1–5, שמות בשלוש שפות לקבוצות, שם אנגלי לשחקן, כל שחקן בקבוצה של הליגה */
  FOR r IN SELECT game.squads('EN_PL') UNION ALL SELECT game.squads('ES_LALIGA') LOOP
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(r->'players') x
                WHERE (x->>'price')::NUMERIC NOT BETWEEN 1 AND 5 OR COALESCE(x->>'nameEn','') = '')
    THEN RAISE EXCEPTION 'FAIL 3a: מחיר/שם'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(r->'teams') t
                WHERE COALESCE(t->>'nameHe','')='' OR COALESCE(t->>'nameEn','')='' OR COALESCE(t->>'nameEl','')='' OR COALESCE(t->>'short','')='')
    THEN RAISE EXCEPTION 'FAIL 3b: קבוצה בלי שם/קיצור'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(r->'players') x
                WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r->'teams') t WHERE t->>'id' = x->>'teamId'))
    THEN RAISE EXCEPTION 'FAIL 3c: שחקן בלי קבוצה'; END IF;
  END LOOP;

  /* 4. אין זליגה בין ליגות: קבוצות ושחקנים זרים */
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(game.squads('EN_PL')->'teams') a
              JOIN jsonb_array_elements(game.squads('ES_LALIGA')->'teams') b ON a->>'id' = b->>'id')
  THEN RAISE EXCEPTION 'FAIL 4a: קבוצה בשתי הליגות'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(game.squads()->'teams') a
              JOIN jsonb_array_elements(game.squads('EN_PL')->'teams') b ON a->>'id' = b->>'id')
  THEN RAISE EXCEPTION 'FAIL 4b: ישראל מכילה קבוצה אנגלית'; END IF;
  IF game.squads()->'season'->>'code' <> 'IL_PREMIER' THEN RAISE EXCEPTION 'FAIL 4c: ברירת המחדל זזה'; END IF;
  IF jsonb_array_length(game.squads('GR_SUPER')->'players') <> jsonb_array_length(gr->'players') THEN RAISE EXCEPTION 'FAIL 4d'; END IF;

  /* 5. ingest_sources: שתי שורות חדשות, כבויות, קידומות ייחודיות */
  IF (SELECT count(*) FROM game.ingest_sources s JOIN core.leagues l ON l.id = s.league_id
       WHERE (l.code, s.gw_prefix, s.competition_365, s.enabled) IN (('EN_PL','en-',7,FALSE),('ES_LALIGA','es-',11,FALSE))) <> 2
  THEN RAISE EXCEPTION 'FAIL 5: ingest_sources'; END IF;

  /* 6. 40 קישורי 365scores חדשים על הקבוצות הנכונות */
  SELECT count(*) INTO n FROM core.external_refs e
   WHERE e.provider = 'scores365' AND e.entity_type = 'team'
     AND e.external_id IN ('110','104','132','131','134','117','174','152');
  IF n <> 8 THEN RAISE EXCEPTION 'FAIL 6a: % קישורים', n; END IF;
  IF (SELECT count(*) FROM core.external_refs e
        JOIN core.team_seasons ts ON ts.team_id = e.entity_id
        JOIN core.seasons s ON s.id = ts.season_id JOIN core.leagues l ON l.id = s.league_id
       WHERE e.provider = 'scores365' AND e.entity_type = 'team' AND l.code IN ('EN_PL','ES_LALIGA')) <> 40
  THEN RAISE EXCEPTION 'FAIL 6b: לא 40 קישורים'; END IF;

  /* 7. קליטה: מחזור אנגלי נוצר עם קידומת en- ואינו מזהם את ישראל/יוון */
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  r := game.ingest_snapshot('scores365', jsonb_build_object('phase','sweep','league','EN_PL',
        'gameweek', jsonb_build_object('number', 9),
        'fixtures', jsonb_build_array(
          jsonb_build_object('providerId','pl1','home',jsonb_build_object('id','110','nameEn','Manchester City'),
            'away',jsonb_build_object('id','104','nameEn','Arsenal'),
            'kickoff', to_char(now() + INTERVAL '3 days','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'status','scheduled')),
        'stats','[]'::jsonb,'alerts','[]'::jsonb,'raw','[]'::jsonb));
  IF jsonb_array_length(r->'problems') <> 0 THEN RAISE EXCEPTION 'FAIL 7z: %', r->'problems'; END IF;
  IF NOT EXISTS (SELECT 1 FROM game.gameweeks g JOIN core.seasons s ON s.id = g.season_id
                  JOIN core.leagues l ON l.id = s.league_id WHERE g.code = 'en-9' AND l.code = 'EN_PL')
  THEN RAISE EXCEPTION 'FAIL 7a: en-9 לא נוצר (%)', r; END IF;
  IF EXISTS (SELECT 1 FROM game.gameweeks WHERE code = 'en-9' AND league_id IS DISTINCT FROM (SELECT id FROM core.leagues WHERE code='EN_PL'))
  THEN RAISE EXCEPTION 'FAIL 7b: league_id שגוי'; END IF;
  IF game.current_gameweek() LIKE 'en-%' THEN RAISE EXCEPTION 'FAIL 7c: ברירת המחדל קפצה לאנגליה'; END IF;

  /* 8. הבורר: אנגליה מופיעה כשהקליטה מופעלת או כשיש מחזור נוכחי; ספרד לא */
  l := game.leagues_public();
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(l) x WHERE x->>'code' IN ('EN_PL','ES_LALIGA'))
  THEN RAISE EXCEPTION 'FAIL 8a: ליגה כבויה בבורר'; END IF;
  UPDATE game.ingest_sources s SET enabled = TRUE FROM core.leagues x WHERE x.id = s.league_id AND x.code = 'ES_LALIGA';
  l := game.leagues_public();
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(l) x WHERE x->>'code' = 'ES_LALIGA' AND (x->>'live')::BOOLEAN = FALSE)
  THEN RAISE EXCEPTION 'FAIL 8b: ספרד לא "בקרוב"'; END IF;
  IF l->0->>'code' <> 'IL_PREMIER' THEN RAISE EXCEPTION 'FAIL 8c: ישראל לא ראשונה'; END IF;

  /* ניקוי של מה שהבדיקה יצרה */
  UPDATE game.ingest_sources s SET enabled = FALSE FROM core.leagues x WHERE x.id = s.league_id AND x.code = 'ES_LALIGA';
END $$;
