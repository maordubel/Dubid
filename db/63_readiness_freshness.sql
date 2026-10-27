-- =====================================================================
--  db/63_readiness_freshness.sql — "Data is delayed" בלי סיבה
-- =====================================================================
--  ★ התקלה: `format_readiness` דרש קליטה בשעה האחרונה לכל מחזור במצב open.
--    אבל הקליטה (`ingest_should_run`) נחה בין מחזורים — דופק כל 6 שעות —
--    ולכן שעה אחרי כל פרסום כל הליגות הוצגו "Data is delayed" למשתמשים.
--  ★ התיקון: סף "חי" (60 דק׳) רק כשהקליטה אמורה לרוץ צפוף — מחזור נעול/חי/
--    בניקוד, או מחזור פתוח שמשחק בו כבר התחיל. אחרת סף הדופק (36 שעות).
--  ★ שינוי שורה אחת בגוף החי (לא שכתוב): קוראים את ההגדרה מהמסד ומחליפים.
-- =====================================================================
DO $fix$
DECLARE d TEXT; old TEXT := $o$v_fresh := CASE WHEN g.status IN ('open', 'locked', 'live', 'scoring')$o$;
BEGIN
  d := pg_get_functiondef('game.format_readiness(uuid,text)'::regprocedure);
  IF position(old IN d) = 0 THEN
    RAISE NOTICE 'db/63: כבר מתוקן או שונה — דלגתי';
    RETURN;
  END IF;
  d := replace(d, old,
    $n$v_fresh := CASE WHEN g.status IN ('locked', 'live', 'scoring')
                    OR (g.status = 'open' AND EXISTS (
                          SELECT 1 FROM core.weekly_matches m
                           WHERE m.gameweek_id = g.id AND m.kickoff_at <= now()))$n$);
  EXECUTE d;
  REVOKE ALL ON FUNCTION game.format_readiness(UUID, TEXT) FROM PUBLIC, anon, authenticated;
END
$fix$;

INSERT INTO game.schema_migrations (version, note) VALUES
  ('63', 'כשירות: "נתונים באיחור" רק כשהקליטה אמורה לרוץ צפוף')
ON CONFLICT (version) DO NOTHING;
