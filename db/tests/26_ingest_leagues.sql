-- db/tests/26_ingest_leagues.sql — קליטה לפי ליגה
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

DELETE FROM auth.users WHERE id::TEXT LIKE 'f3900000-%';
INSERT INTO auth.users (id, email, is_anonymous) VALUES
  ('f3900000-0000-0000-0000-000000000001', 'ingleague@dubid.test', FALSE);
SET dubid.test_uid = 'f3900000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('בודק קליטה');
SELECT game.claim_admin('test-admin-pass');

DO $$
DECLARE r JSONB; r2 JSONB; v_gw RECORD; n_il INT; n_before INT; p JSONB;
BEGIN
  /* 1. מקורות: ישראל פעילה, יוון כבויה */
  IF NOT (SELECT enabled FROM game.ingest_sources s JOIN core.leagues l ON l.id = s.league_id WHERE l.code='IL_PREMIER')
  THEN RAISE EXCEPTION 'FAIL 1a: ישראל כבויה'; END IF;
  IF (SELECT enabled FROM game.ingest_sources s JOIN core.leagues l ON l.id = s.league_id WHERE l.code='GR_SUPER')
  THEN RAISE EXCEPTION 'FAIL 1b: יוון פעילה כברירת מחדל'; END IF;

  /* 2. 14 קבוצות יווניות מקושרות ל-365scores */
  IF (SELECT count(*) FROM core.external_refs WHERE provider='scores365' AND entity_type='team'
        AND external_id IN ('1022','1023','1024','1025','1026','1029','1031','1032','1033','1034','1066','6206','15266','54421')
        AND entity_id IN (SELECT t.id FROM core.teams t WHERE t.country_code='GR')) <> 14
  THEN RAISE EXCEPTION 'FAIL 2: קישורי 365 חסרים'; END IF;

  SELECT count(*) INTO n_before FROM game.gameweeks;

  /* 3. קליטה ליוון: gr-1, עונה ויוון, שלוש שפות בשם */
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  p := jsonb_build_object('phase','sweep','league','GR_SUPER','gameweek',jsonb_build_object('number',1),
    'fixtures', jsonb_build_array(
      jsonb_build_object('providerId','g1','home',jsonb_build_object('id','1022','nameEn','Panathinaikos'),
        'away',jsonb_build_object('id','1023','nameEn','Olympiacos'),
        'kickoff','2026-12-01T19:00:00Z','status','scheduled'),
      jsonb_build_object('providerId','g2','home',jsonb_build_object('id','1024','nameEn','AEK Athens'),
        'away',jsonb_build_object('id','1029','nameEn','PAOK'),
        'kickoff','2026-12-02T19:00:00Z','status','postponed')),
    'stats','[]'::jsonb,'alerts','[]'::jsonb,'raw','[]'::jsonb);
  r := game.ingest_snapshot('scores365', p);
  IF r->>'gw' <> 'gr-1' THEN RAISE EXCEPTION 'FAIL 3a: %', r; END IF;
  IF (r->>'fixtures')::INT <> 2 THEN RAISE EXCEPTION 'FAIL 3b: %', r; END IF;
  IF jsonb_array_length(r->'problems') <> 0 THEN RAISE EXCEPTION 'FAIL 3c: %', r->'problems'; END IF;
  SELECT g.*, l.code AS lcode INTO v_gw FROM game.gameweeks g
    JOIN core.leagues l ON l.id = g.league_id WHERE g.code = 'gr-1';
  IF v_gw.lcode <> 'GR_SUPER' THEN RAISE EXCEPTION 'FAIL 3d: %', v_gw.lcode; END IF;
  IF v_gw.names#>>'{el,full}' <> 'Αγωνιστική 1' THEN RAISE EXCEPTION 'FAIL 3e: %', v_gw.names; END IF;
  IF (SELECT count(*) FROM core.weekly_matches WHERE gameweek_id = v_gw.id) <> 2 THEN RAISE EXCEPTION 'FAIL 3f'; END IF;
  IF v_gw.is_current THEN RAISE EXCEPTION 'FAIL 3g: מחזור יווני נוצר כנוכחי'; END IF;

  /* 4. אידמפוטנטי */
  r2 := game.ingest_snapshot('scores365', p);
  IF (SELECT count(*) FROM core.weekly_matches WHERE gameweek_id = v_gw.id) <> 2 THEN RAISE EXCEPTION 'FAIL 4a'; END IF;
  IF r->>'fingerprint' <> r2->>'fingerprint' THEN RAISE EXCEPTION 'FAIL 4b: טביעת אצבע השתנתה'; END IF;

  /* 5. בלי league = ישראל, gw-N כמקודם */
  r := game.ingest_snapshot('scores365', jsonb_build_object('phase','fixtures','gameweek',jsonb_build_object('number',77),
        'fixtures','[]'::jsonb,'stats','[]'::jsonb,'alerts','[]'::jsonb,'raw','[]'::jsonb));
  IF r->>'gw' <> 'gw-77' THEN RAISE EXCEPTION 'FAIL 5a: %', r; END IF;
  IF (SELECT l.code FROM game.gameweeks g JOIN core.leagues l ON l.id=g.league_id WHERE g.code='gw-77') <> 'IL_PREMIER'
  THEN RAISE EXCEPTION 'FAIL 5b'; END IF;

  /* 6. ליגה לא ידועה נדחית */
  BEGIN
    PERFORM game.ingest_snapshot('scores365', jsonb_build_object('league','XX_NONE','gameweek',jsonb_build_object('number',1)));
    RAISE EXCEPTION 'FAIL 6: ליגה לא ידועה התקבלה';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'UNKNOWN_LEAGUE' THEN RAISE; END IF;
  END;

  /* 7. משחק נדחה מייצר התרעה חוסמת על gr-1 בלבד */
  IF NOT EXISTS (SELECT 1 FROM game.ingest_alerts WHERE gw_code='gr-1' AND kind='fixture_not_final')
  THEN RAISE EXCEPTION 'FAIL 7'; END IF;
END $$;

/* 8. הפעלה/כיבוי רק לאדמין, ונרשם בביקורת */
SET dubid.test_uid = 'f3900000-0000-0000-0000-000000000001';
SELECT game.admin_set_ingest_source('GR_SUPER', TRUE);
DO $$ BEGIN
  IF NOT (SELECT enabled FROM game.ingest_sources s JOIN core.leagues l ON l.id=s.league_id WHERE l.code='GR_SUPER')
  THEN RAISE EXCEPTION 'FAIL 8a'; END IF;
  IF NOT EXISTS (SELECT 1 FROM game.audit_logs WHERE action='admin_set_ingest_source' AND entity_id='GR_SUPER')
  THEN RAISE EXCEPTION 'FAIL 8b'; END IF;
END $$;
SELECT game.admin_set_ingest_source('GR_SUPER', FALSE);
