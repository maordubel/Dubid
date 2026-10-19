-- =====================================================================
--  db/47_ingest_eng_esp.sql · קליטת אנגליה וספרד (365scores)
--
--  · ingest_sources: EN_PL (תחרות 7, קידומת en-) ו-ES_LALIGA (תחרות 11, קידומת es-).
--    נוצרות **כבויות** — מפעילים בנפרד:
--      select game.admin_set_ingest_source('EN_PL', true);
--      select game.admin_set_ingest_source('ES_LALIGA', true);
--  · קישור 40 הקבוצות ל-365scores (מזהים מדף הטבלה של כל תחרות), על גבי
--    הקבוצות שנטענו ב-db/45/46 (manual_json team = 20000 + FotMob).
--  · אין שינוי בקוד הקליטה/הניקוד: אותו ingest_snapshot ואותם חוקי ניקוד
--    (scoring_rulesets חסר → ברירת המחדל IL_PREMIER + scoring_overrides).
--  אידמפוטנטי.
-- =====================================================================
BEGIN;

INSERT INTO game.ingest_sources (league_id, gw_prefix, competition_365, enabled)
SELECT l.id, 'en-', 7, FALSE FROM core.leagues l WHERE l.code = 'EN_PL'
ON CONFLICT (league_id) DO NOTHING;
INSERT INTO game.ingest_sources (league_id, gw_prefix, competition_365, enabled)
SELECT l.id, 'es-', 11, FALSE FROM core.leagues l WHERE l.code = 'ES_LALIGA'
ON CONFLICT (league_id) DO NOTHING;

DO $link$
DECLARE r RECORD; v_team UUID; n INT := 0;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      /* England — competition 7 */
      (8456,'110'),(9825,'104'),(10204,'38'),(8455,'106'),(8650,'108'),(9937,'63'),(8463,'36'),
      (8668,'107'),(8667,'11'),(9902,'9'),(10261,'116'),(10252,'109'),(10260,'105'),(9826,'10'),
      (8678,'50'),(8669,'24'),(9879,'120'),(10203,'29'),(8472,'117'),(8586,'114'),
      /* Spain — competition 11 */
      (8634,'132'),(9906,'134'),(8633,'131'),(8603,'146'),(8560,'154'),(8302,'135'),(9866,'168'),
      (9910,'158'),(9783,'148'),(8371,'143'),(8315,'144'),(10205,'133'),(8558,'136'),(8370,'174'),
      (8305,'140'),(8696,'137'),(8581,'150'),(10268,'156'),(10267,'139'),(9864,'152')
    ) AS v(fotmob, s365)
  LOOP
    SELECT e.entity_id INTO v_team FROM core.external_refs e
     WHERE e.entity_type = 'team' AND e.provider = 'manual_json'
       AND e.external_id = (20000 + r.fotmob)::TEXT LIMIT 1;
    IF v_team IS NULL THEN
      RAISE NOTICE 'db/47: קבוצה % לא נמצאה (db/45/46 לא רצו?) — דילוג', r.fotmob;
    ELSE
      PERFORM core.provider_link('scores365', 'team', r.s365, v_team);
      n := n + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'db/47: % קבוצות קושרו ל-365scores', n;
END $link$;

UPDATE game.data_revision SET revision = revision + 1, scope = 'ingest-eng-esp', updated_at = now() WHERE id = 1;
COMMIT;
INSERT INTO game.schema_migrations (version, note) VALUES ('47', '★ קליטת אנגליה וספרד: ingest_sources + קישור 365scores')
ON CONFLICT (version) DO NOTHING;
