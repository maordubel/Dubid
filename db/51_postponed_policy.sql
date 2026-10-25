-- =====================================================================
--  db/51_postponed_policy.sql · משחק שנדחה לא חוסם פרסום (המדיניות שהוכרעה)
--
--  db/36 קבע: "משחק שנדחה/הופסק לא מחזיק את המחזור — המחזור מתפרסם
--  בלעדיו". auto_advance אכן מוציא אותו מהספירה, אבל ingest_snapshot
--  המשיכה להעלות התרעה fixture_not_final בחומרה block, ו-
--  publish_scored_gameweek חוסם על כל block פתוח — כלומר מחזור חי עם
--  משחק נדחה היה נתקע ב-scoring עד התערבות אדמין, והקליטה החזירה את
--  ההתרעה אחרי כל ניקוי.
--
--  התיקון בלי לשכתב את ingest_snapshot: טריגר BEFORE INSERT שמוריד
--  fixture_not_final ל-warn (ההתרעה נשארת כמידע לאדמין), ושדרוג של
--  התרעות פתוחות קיימות. דטרמיניסטי, אידמפוטנטי.
-- =====================================================================
SET search_path = game, core, public;

CREATE OR REPLACE FUNCTION game.ingest_alert_policy()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'fixture_not_final' AND NEW.severity = 'block' THEN
    NEW.severity := 'warn';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ingest_alert_policy ON game.ingest_alerts;
CREATE TRIGGER trg_ingest_alert_policy
  BEFORE INSERT ON game.ingest_alerts
  FOR EACH ROW EXECUTE FUNCTION game.ingest_alert_policy();

UPDATE game.ingest_alerts SET severity = 'warn'
 WHERE kind = 'fixture_not_final' AND severity = 'block' AND cleared_at IS NULL;
