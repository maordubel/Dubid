-- =====================================================================
--  db/28_dispatch_visibility.sql · לראות את הפעימה, לא רק את התוצאה
--
--  ═══════════════════════════════════════════════════════════════
--  ★ החור שהקובץ הזה סוגר
--  ═══════════════════════════════════════════════════════════════
--
--  `pg_net` שולח בקשה ולא ממתין לתשובה. זו התכונה שלו — כך הוא
--  לא תוקע את המסד — אבל היא יצרה מצב שאי אפשר לחיות איתו:
--
--    · הפונקציה מחזירה 500        → אף אחד לא יודע
--    · הטוקן שגוי, 403            → אף אחד לא יודע
--    · הפונקציה לא נפרסה, 404     → אף אחד לא יודע
--
--  בכל שלושת המקרים `ingest_runs` נשארת **ריקה**, כי רק קוד
--  שרץ בתוך ה-Edge Function כותב אליה. מסך הקליטה הראה
--  "עוד לא רצה קליטה" בזמן שהמסד קרא לפונקציה כל עשר דקות.
--
--  "עוד לא רצה" ו"רצה ונפלה" הם שתי בעיות שונות לחלוטין, והמסך
--  לא ידע להבדיל ביניהן. זו הייתה שגיאה בתכנון, לא באג בקוד.
--
--  ★ התיקון: כל פעימה נרשמת ברגע השליחה, עם מזהה הבקשה של
--    `pg_net`. קוד התשובה נשלף מ-`net._http_response` בזמן
--    קריאה. אין העתקה, אין סנכרון, ואין מה שיכול להישבר.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS game.ingest_dispatches (
  request_id    BIGINT PRIMARY KEY,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  origin        TEXT NOT NULL DEFAULT 'cron'      -- 'cron' | 'admin'
);
CREATE INDEX IF NOT EXISTS ingest_dispatches_recent
  ON game.ingest_dispatches (requested_at DESC);

DO $rls$
BEGIN
  ALTER TABLE game.ingest_dispatches ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN NULL;
END
$rls$;

/* ★ מחיקה לפני יצירה, ולא `CREATE OR REPLACE`.
   ל-`ingest_tick` מ-db/27 אין ארגומנטים; לחדשה יש אחד עם ברירת
   מחדל. PostgreSQL רואה בהן **שתי פונקציות** ולא גרסה חדשה,
   וקריאה `game.ingest_tick()` נופלת על
   "function is not unique" — כלומר ה-cron מפסיק לעבוד בשקט.
   נתפס בבדיקה מקומית לפני שהגיע לייצור. */
DROP FUNCTION IF EXISTS game.ingest_tick();

/**
 * הפעימה — עכשיו נרשמת.
 *
 * ★ `p_origin` מבדיל בין cron לבין לחיצה ידנית. כשמישהו לוחץ
 *   "הרץ עכשיו" ולא קורה כלום, השאלה הראשונה היא "בכלל יצאה
 *   בקשה?", והתשובה חייבת להיות במסך.
 */
CREATE OR REPLACE FUNCTION game.ingest_tick(p_origin TEXT DEFAULT 'cron')
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

  INSERT INTO game.ingest_dispatches (request_id, origin)
  VALUES (v_req, COALESCE(p_origin, 'cron'))
  ON CONFLICT (request_id) DO NOTHING;

  RETURN jsonb_build_object('requested', v_req, 'at', now());
END;
$$;

/**
 * מה החזירה כל פעימה.
 *
 * ★ `LEFT JOIN` ולא `JOIN`: בקשה שיצאה לפני שנייה עדיין אין לה
 *   תשובה, וזה מצב תקין. `status_code` ריק פירושו "בדרך".
 *
 * ★ עטוף בחריגה כי `net._http_response` קיימת רק אם pg_net
 *   מותקן — והמסך חייב להיטען גם כשהוא לא.
 */
CREATE OR REPLACE FUNCTION game.admin_ingest_dispatches(p_limit INT DEFAULT 10)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public, extensions, net
AS $$
DECLARE v JSONB;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  BEGIN
    EXECUTE format($q$
      SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'requestedAt') DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
                 'requestId',  d.request_id,
                 'requestedAt', d.requested_at,
                 'origin',      d.origin,
                 'status',      r.status_code,
                 'timedOut',    r.timed_out,
                 'error',       r.error_msg,
                 'body',        left(COALESCE(r.content, ''), 400)) AS x
          FROM game.ingest_dispatches d
          LEFT JOIN net._http_response r ON r.id = d.request_id
         ORDER BY d.requested_at DESC
         LIMIT %s
      ) t $q$, GREATEST(COALESCE(p_limit, 10), 1))
    INTO v;
  EXCEPTION WHEN undefined_table OR invalid_schema_name OR insufficient_privilege THEN
    /* pg_net לא מותקן, או שהתשובות לא נגישות — עדיין מראים
       שהבקשה יצאה. "יצאה ואין תשובה" הוא מידע, לא כלום. */
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'requestId', d.request_id, 'requestedAt', d.requested_at,
             'origin', d.origin, 'status', NULL, 'body', 'תשובות pg_net אינן נגישות')
           ORDER BY d.requested_at DESC), '[]'::jsonb)
      INTO v
      FROM (SELECT * FROM game.ingest_dispatches
             ORDER BY requested_at DESC LIMIT GREATEST(COALESCE(p_limit, 10), 1)) d;
  END;

  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_ingest_dispatches(INT) TO authenticated;

/* "הרץ עכשיו" מסמן את עצמו כידני. */
CREATE OR REPLACE FUNCTION game.admin_ingest_now()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v JSONB;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  v := game.ingest_tick('admin');
  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (game.actor_label(), 'admin_ingest_now', 'ingest', 'manual', v);
  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_ingest_now() TO authenticated;

COMMIT;

-- ---------------------------------------------------------------------
--  רישום מחדש של המשימות — הן קוראות ל-ingest_tick() בלי ארגומנט
-- ---------------------------------------------------------------------
--  ★ החתימה השתנתה (נוסף `p_origin` עם ברירת מחדל), ולכן
--    הקריאה הישנה עדיין תקפה. הרישום מחדש כאן הוא ליתר ביטחון
--    ולמקרה ש-db/27 רץ לפני שהתוספים הודלקו — מצב שקורה, וקרה.
DO $cron$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron אינו מותקן — דלגתי.';
    RETURN;
  END IF;

  PERFORM cron.unschedule('dubid-ingest-tick')  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'dubid-ingest-tick');
  PERFORM cron.unschedule('dubid-ingest-daily') WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'dubid-ingest-daily');

  PERFORM cron.schedule('dubid-ingest-tick',  '*/10 * * * *', $j$SELECT game.ingest_tick('cron');$j$);
  PERFORM cron.schedule('dubid-ingest-daily', '0 3 * * *',    $j$SELECT game.ingest_tick('cron');$j$);

  RAISE NOTICE 'שתי המשימות נרשמו מחדש.';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'רישום המשימות נכשל: %', SQLERRM;
END
$cron$;

INSERT INTO game.schema_migrations (version, note) VALUES
  ('28', '★ נראות הפעימה — קוד התשובה של כל קריאה, במסך')
ON CONFLICT (version) DO NOTHING;
