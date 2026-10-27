-- =====================================================================
--  db/tests/40_gameweek_rules.sql — חוקי הניקוד מוקפאים לכל מחזור (D02)
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

DELETE FROM auth.users WHERE id::TEXT LIKE 'f4000000-%';
INSERT INTO auth.users (id, email, is_anonymous) VALUES
  ('f4000000-0000-0000-0000-000000000001', 'rules@dubid.test', FALSE);
SET dubid.test_uid = 'f4000000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('מנהל החוקים');
SELECT game.claim_admin('test-admin-pass');

DELETE FROM game.scoring_overrides WHERE rule_key = 'assist';

DO $$
DECLARE v_season UUID;
BEGIN
  SELECT s.id INTO v_season FROM core.seasons s JOIN core.leagues l ON l.id = s.league_id
   WHERE l.code = 'ES_LALIGA' ORDER BY s.is_current DESC LIMIT 1;
  DELETE FROM game.gameweeks WHERE season_id = v_season AND number IN (2, 3);
  INSERT INTO game.gameweeks (season_id, number, code, lock_at, status)
  VALUES (v_season, 2, 'es-2', now() + INTERVAL '2 days', 'draft'),
         (v_season, 3, 'es-3', now() + INTERVAL '9 days', 'draft');
END $$;

-- 1 — טיוטה אינה מוקפאת; פתיחה מקפיאה
DO $$
BEGIN
  IF game.gameweek_rules_for('es-2') IS NOT NULL THEN RAISE EXCEPTION 'FAIL 1a: טיוטה הוקפאה'; END IF;
  UPDATE game.gameweeks SET status = 'open' WHERE code = 'es-2';
  IF game.gameweek_rules_for('es-2') IS NULL THEN RAISE EXCEPTION 'FAIL 1b: פתיחה לא הקפיאה'; END IF;
  IF game.gameweek_rules_for('es-2') #> '{overrides}' ? 'assist' THEN
    RAISE EXCEPTION 'FAIL 1c: override שלא היה קיים בתמונה';
  END IF;
END $$;
\echo '  ✓ 1  פתיחת מחזור מקפיאה את החוקים; טיוטה לא'

-- 2 — שינוי איזון אחרי הפתיחה לא נוגע במחזור הפתוח, כן במחזור הבא
DO $$
DECLARE h1 TEXT; h2 TEXT;
BEGIN
  h1 := game.gameweek_rules_for('es-2')->>'hash';
  INSERT INTO game.scoring_overrides (rule_key, points) VALUES ('assist', 4);
  UPDATE game.gameweeks SET status = 'locked' WHERE code = 'es-2';
  IF game.gameweek_rules_for('es-2')->>'hash' <> h1 THEN RAISE EXCEPTION 'FAIL 2a: התמונה זזה'; END IF;
  IF game.gameweek_rules_for('es-2') #> '{overrides}' ? 'assist' THEN
    RAISE EXCEPTION 'FAIL 2b: override חדש חל על מחזור פתוח';
  END IF;
  UPDATE game.gameweeks SET status = 'open' WHERE code = 'es-3';
  h2 := game.gameweek_rules_for('es-3')->>'hash';
  IF h2 = h1 OR (game.gameweek_rules_for('es-3') #>> '{overrides,assist}')::numeric <> 4 THEN
    RAISE EXCEPTION 'FAIL 2c: המחזור הבא לא קיבל את האיזון החדש';
  END IF;
END $$;
\echo '  ✓ 2  שינוי איזון חל רק על מחזור שנפתח אחריו'

-- 3 — hash דטרמיניסטי: אותו תוכן → אותו hash
DO $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM game.gameweek_rules gr JOIN game.gameweeks g ON g.id = gr.gameweek_id WHERE g.code = 'es-3';
  IF game.rules_hash(r.ruleset_id, r.overrides) <> r.rules_hash THEN RAISE EXCEPTION 'FAIL 3'; END IF;
END $$;
\echo '  ✓ 3  hash יציב לאותו תוכן'

-- 4 — תיקון חריג: אדמין בלבד, עם סיבה, ביומן
DO $$
DECLARE n INT;
BEGIN
  BEGIN
    PERFORM game.admin_refreeze_gameweek_rules('es-2', 'x');
    RAISE EXCEPTION 'FAIL 4a: בלי סיבה התקבל';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%REASON_REQUIRED%' THEN RAISE; END IF;
  END;
  PERFORM game.admin_refreeze_gameweek_rules('es-2', 'assist was misconfigured before lock');
  IF (game.gameweek_rules_for('es-2') #>> '{overrides,assist}')::numeric <> 4
     OR game.gameweek_rules_for('es-2')->>'source' <> 'amended' THEN
    RAISE EXCEPTION 'FAIL 4b: התיקון לא נכנס';
  END IF;
  SELECT count(*) INTO n FROM game.audit_logs
   WHERE action = 'refreeze_gameweek_rules' AND entity_id = 'es-2' AND reason IS NOT NULL;
  IF n < 1 THEN RAISE EXCEPTION 'FAIL 4c: אין רישום ביומן'; END IF;

  UPDATE game.gameweeks SET status = 'published' WHERE code = 'es-2';
  BEGIN
    PERFORM game.admin_refreeze_gameweek_rules('es-2', 'too late to change this');
    RAISE EXCEPTION 'FAIL 4d: מחזור שפורסם תוקן';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%ALREADY_PUBLISHED%' THEN RAISE; END IF;
  END;
END $$;
\echo '  ✓ 4  תיקון חריג: אדמין + סיבה + יומן; לא אחרי פרסום'

-- 5 — הרשאות
DO $$
BEGIN
  IF NOT has_function_privilege('anon', 'game.gameweek_rules_for(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 5a';
  END IF;
  IF has_table_privilege('anon', 'game.gameweek_rules', 'SELECT')
     OR has_function_privilege('anon', 'game.admin_refreeze_gameweek_rules(text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'game.freeze_gameweek_rules(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 5b: גישה פתוחה מדי';
  END IF;
END $$;
\echo '  ✓ 5  קריאה ציבורית, כתיבה סגורה'

DELETE FROM game.scoring_overrides WHERE rule_key = 'assist';
DELETE FROM game.gameweeks WHERE code IN ('es-2','es-3');
