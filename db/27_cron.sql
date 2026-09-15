-- =====================================================================
--  db/27_cron.sql · המתזמן
--
--  מה זה עושה: מריץ את הקליטה לבד, בלי שאף אחד יפתח דפדפן.
--
--  ═══════════════════════════════════════════════════════════════
--  ★ למה שער SQL ולא פשוט "כל עשר דקות"
--  ═══════════════════════════════════════════════════════════════
--
--  cron כל עשר דקות = 144 ריצות ביום, ~1,000 בקשות לספק
--  חיצוני — רובן המכריע כשאין בכלל משחק. זו הדרך המהירה
--  ביותר להיחסם, וגם שריפת מכסה על כלום.
--
--  לכן המתזמן מעיר **פונקציית SQL**, והיא מחליטה אם יש בכלל
--  מה לעשות:
--
--    · משחק חי עכשיו, או הסתיים בארבע השעות האחרונות  → כן
--    · המחזור נעול והניקוד עוד לא סופי                → כן
--    · לא רצה קליטה שש שעות                           → כן (דופק)
--    · אחרת                                            → לא
--
--  בשבוע ממוצע זה יוצא כמה עשרות קריאות במקום אלף.
--
--  ═══════════════════════════════════════════════════════════════
--  ★ הקובץ בטוח להרצה גם בלי pg_cron ו-pg_net
--  ═══════════════════════════════════════════════════════════════
--
--  מסד הבדיקות המקומי לא מכיר אותן. כל חלק שתלוי בהן עטוף
--  ונכשל בהודעה, לא בשגיאה — כי `RUN-ALL.sql` חייב להישאר
--  ניתן להרצה בכל סביבה.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
--  §1 · הסוד
-- ---------------------------------------------------------------------
--  ★ הטוקן לא יושב בקוד ולא ב-URL של ה-cron. טבלה אחת, בלי
--    GRANT לאיש, נקראת רק מתוך SECURITY DEFINER.
CREATE TABLE IF NOT EXISTS game.ingest_secrets (
  id           BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  function_url TEXT,
  token        TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO game.ingest_secrets (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

DO $rls$
BEGIN
  ALTER TABLE game.ingest_secrets ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON game.ingest_secrets FROM anon, authenticated;
EXCEPTION WHEN OTHERS THEN NULL;
END
$rls$;

/* האדמין מזין אותם פעם אחת מלוח הבקרה — לא מ-SQL. */
CREATE OR REPLACE FUNCTION game.admin_set_ingest_endpoint(p_url TEXT, p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  UPDATE game.ingest_secrets
     SET function_url = COALESCE(NULLIF(btrim(p_url), ''), function_url),
         token        = COALESCE(NULLIF(btrim(p_token), ''), token),
         updated_at   = now()
   WHERE id;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (game.actor_label(), 'admin_set_ingest_endpoint', 'config', 'ingest',
          jsonb_build_object('url', p_url, 'tokenSet', p_token IS NOT NULL));

  /* ★ הטוקן עצמו לא חוזר. מסך שמציג סוד הוא סוד בצילום מסך. */
  RETURN jsonb_build_object('url', (SELECT function_url FROM game.ingest_secrets WHERE id),
                            'tokenSet', (SELECT token IS NOT NULL FROM game.ingest_secrets WHERE id));
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_set_ingest_endpoint(TEXT,TEXT) TO authenticated;

-- ---------------------------------------------------------------------
--  §2 · האם יש בכלל מה לעשות
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION game.ingest_should_run()
RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path = game, core, public
AS $$
  SELECT
    COALESCE((SELECT enabled FROM game.ingest_config WHERE id), FALSE)
    AND (
      /* משחק חי או שהסתיים ממש עכשיו */
      EXISTS (
        SELECT 1 FROM core.weekly_matches m
         WHERE m.kickoff_at <= now()
           AND m.kickoff_at >  now() - INTERVAL '4 hours'
      )
      /* מחזור שנעול וטרם פורסם — כולל סריקת התיקונים המאוחרת */
      OR EXISTS (
        SELECT 1 FROM game.gameweeks g
         WHERE g.status IN ('locked','live','scoring')
            OR (g.status = 'open' AND g.lock_at <= now())
      )
      /* דופק: שש שעות בלי קליטה מוצלחת */
      OR COALESCE(
           (SELECT max(started_at) FROM game.ingest_runs WHERE status IN ('ok','partial')),
           '-infinity'::TIMESTAMPTZ
         ) < now() - INTERVAL '6 hours'
    );
$$;

-- ---------------------------------------------------------------------
--  §3 · הפעימה
-- ---------------------------------------------------------------------
/**
 * ★ `set_config('request.jwt.claims', ...)` היא ההצהרה שהופכת
 *   את ההרצה הזו ל"מערכת" (ראו db/26 §0). בלעדיה pg_cron הוא
 *   סתם עוד סשן, ו-`ingest_snapshot` תדחה אותו — וזה בדיוק
 *   ההתנהגות הרצויה: זהות מערכת מוצהרת, לא נגזרת.
 */
CREATE OR REPLACE FUNCTION game.ingest_tick()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public, extensions
AS $$
DECLARE
  v_url   TEXT;
  v_token TEXT;
  v_req   BIGINT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);

  IF NOT game.ingest_should_run() THEN
    RETURN jsonb_build_object('skipped', 'nothing_to_do');
  END IF;

  SELECT function_url, token INTO v_url, v_token FROM game.ingest_secrets WHERE id;
  IF v_url IS NULL OR v_token IS NULL THEN
    RETURN jsonb_build_object('skipped', 'endpoint_not_configured');
  END IF;

  BEGIN
    SELECT net.http_post(
             url     := v_url,
             headers := jsonb_build_object(
                          'content-type',   'application/json',
                          'x-ingest-token', v_token),
             body    := jsonb_build_object('phase', 'auto'),
             timeout_milliseconds := 55000
           ) INTO v_req;
  EXCEPTION WHEN undefined_function OR undefined_table OR invalid_schema_name THEN
    RETURN jsonb_build_object('skipped', 'pg_net_missing');
  END;

  RETURN jsonb_build_object('requested', v_req, 'at', now());
END;
$$;

/* ידנית מלוח הבקרה: "הרץ קליטה עכשיו". */
CREATE OR REPLACE FUNCTION game.admin_ingest_now()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v JSONB;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  v := game.ingest_tick();
  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (game.actor_label(), 'admin_ingest_now', 'ingest', 'manual', v);
  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_ingest_now() TO authenticated;

COMMIT;

-- ---------------------------------------------------------------------
--  §4 · רישום המשימות
-- ---------------------------------------------------------------------
--  ★ שתי משימות ולא אחת:
--
--    · `dubid-ingest-tick` כל 10 דקות — השער מחליט אם לפעול.
--      זה מה שנותן ניקוד חי בזמן משחק.
--    · `dubid-ingest-daily` ב-03:00 UTC (06:00 בארץ) — סריקה
--      יומית שתופסת תיקונים מאוחרים של הספק ואת לוח המחזור
--      הבא, גם בשבוע בלי משחקים.
DO $cron$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron אינו מותקן — דלגתי על רישום המשימות. הפעילו אותו ב-Database → Extensions והריצו שוב.';
    RETURN;
  END IF;

  PERFORM cron.unschedule('dubid-ingest-tick')  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'dubid-ingest-tick');
  PERFORM cron.unschedule('dubid-ingest-daily') WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'dubid-ingest-daily');

  PERFORM cron.schedule('dubid-ingest-tick',  '*/10 * * * *', 'SELECT game.ingest_tick();');
  PERFORM cron.schedule('dubid-ingest-daily', '0 3 * * *',    'SELECT game.ingest_tick();');

  RAISE NOTICE 'נרשמו שתי משימות: dubid-ingest-tick (כל 10 דק׳) ו-dubid-ingest-daily (03:00 UTC)';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'רישום המשימות נכשל: % — אפשר לרשום ידנית מ-Database → Cron Jobs', SQLERRM;
END
$cron$;

INSERT INTO game.schema_migrations (version, note) VALUES
  ('27', '★ מתזמן — pg_cron מעיר את הקליטה, שער SQL מחליט אם לפעול')
ON CONFLICT (version) DO NOTHING;
