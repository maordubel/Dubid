-- =====================================================================
--  db/34_backfill.sql — מחזור שנגמר בלי סטטיסטיקה חוזר לתור
--
--  ═══════════════════════════════════════════════════════════════
--  ★ מה זה פותר
--  ═══════════════════════════════════════════════════════════════
--
--  מחזור 4 נגמר, ולכל שבעת המשחקים יש תוצאה סופית — ו**אפס
--  שורות** ב-`core.player_match_stats`. המקור החזיר 403 בדיוק
--  בחלון שבו נאספת הסטטיסטיקה, והקליטה המשיכה הלאה למחזור 5.
--  אף אחד לא חזר למחזור 4, ואף אחד לא היה חוזר אליו לעולם:
--  `ingest_tick` שואלת את הספק «מה המחזור הנוכחי» ומקבלת 5.
--
--  התיקון היחיד שהיה זמין הוא אדם שמריץ `admin_ingest_round(4)`
--  ביד. זה בדיוק מה שהברִיף אוסר — «ללא התערבות אדם, אלא רק
--  יכולת עריכה ותיקונים במקרה הצורך».
--
--  ═══════════════════════════════════════════════════════════════
--  ★ הכלל
--  ═══════════════════════════════════════════════════════════════
--
--  מחזור שלא פורסם, שכל משחקיו הסתיימו, ושאין לו ולו שורת
--  סטטיסטיקה אחת — **אינו מחזור שממתין. הוא מחזור שנפל.**
--  הפעימה מזמינה סריקה חוזרת שלו, במפורש לפי מספרו.
--
--  ★ שלוש החלטות:
--
--   1. **ויסות.** ניסיון אחד לכל חצי שעה לכל היותר. בלעדיו זו
--      לולאה שמפציצה את הספק שחסם אותנו מלכתחילה — והדרך
--      הבטוחה להפוך חסימה זמנית לקבועה.
--   2. **הישן קודם.** מחזור אחד בכל פעימה, לפי סדר. שתי סריקות
--      במקביל מתחרות על אותו חלון של 55 שניות.
--   3. **«אין ולו שורה אחת» ולא «חסרות שורות».** כיסוי חלקי הוא
--      החלטה של `ingest_check_coverage` ושל האדמין. כאן מדובר
--      במחזור שלא נקלט בכלל — מצב שאין עליו ויכוח.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION game.gameweek_needs_backfill()
RETURNS TABLE (code TEXT, number INT)
LANGUAGE sql STABLE
SET search_path = game, core, public
AS $$
  SELECT g.code, g.number
    FROM game.gameweeks g
   WHERE g.status NOT IN ('published','archived','draft')
     AND EXISTS (SELECT 1 FROM core.weekly_matches m WHERE m.gameweek_id = g.id)
     /* כל המשחקים נגמרו — או שהאחרון שבהם התחיל לפני יותר משלוש
        שעות, כדי לתפוס גם מחזור שתקוע ב-'live' כי הסטטוס עצמו
        לא התעדכן. */
     AND NOT EXISTS (
           SELECT 1 FROM core.weekly_matches m
            WHERE m.gameweek_id = g.id
              AND m.status NOT IN ('finished','postponed','abandoned')
              AND m.kickoff_at > now() - INTERVAL '3 hours')
     /* ואין ולו שורת סטטיסטיקה אחת */
     AND NOT EXISTS (
           SELECT 1 FROM core.player_match_stats s
             JOIN core.weekly_matches m ON m.id = s.match_id
            WHERE m.gameweek_id = g.id)
   ORDER BY g.number;
$$;

COMMENT ON FUNCTION game.gameweek_needs_backfill() IS
  'מחזורים שנגמרו ואין להם ולו שורת סטטיסטיקה אחת — כלומר נפלו, לא ממתינים.';

/* ---------------------------------------------------------------- */
/* הפעימה מקבלת את השלב הזה. הכול נשאר כפי שהיה, ובסוף נוסף
   ניסיון השלמה אחד — אחרי `auto_advance` ואחרי הפרסום, כדי
   שמחזור שבשל לפרסום ייגש לפרסום ולא יידחק על ידי השלמה. */
CREATE OR REPLACE FUNCTION game.lifecycle_tick()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public, extensions
AS $$
DECLARE
  v        JSONB;
  v_ready  TEXT;
  v_url    TEXT;
  v_token  TEXT;
  v_req    BIGINT;
  v_gap    TIMESTAMPTZ;
  v_fill   RECORD;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);

  v := game.auto_advance();
  v_ready := v->>'readyToPublish';

  SELECT function_url, token INTO v_url, v_token FROM game.ingest_secrets WHERE id;
  IF v_url IS NULL OR v_token IS NULL THEN
    RETURN v || jsonb_build_object('dispatch', 'endpoint_not_configured');
  END IF;

  /* ── בשל לפרסום: מזמנים את הקליטה, והיא מריצה ניקוד ומפרסמת ── */
  IF v_ready IS NOT NULL THEN
    BEGIN
      SELECT net.http_post(
               url     := v_url,
               headers := jsonb_build_object('content-type','application/json',
                                             'x-ingest-token', v_token),
               body    := jsonb_build_object('phase','auto'),
               timeout_milliseconds := 55000) INTO v_req;
    EXCEPTION WHEN undefined_function OR undefined_table OR invalid_schema_name THEN
      RETURN v || jsonb_build_object('publish', 'pg_net_missing');
    END;

    INSERT INTO game.ingest_dispatches (request_id, origin)
    VALUES (v_req, 'lifecycle') ON CONFLICT DO NOTHING;

    RETURN v || jsonb_build_object('publish', jsonb_build_object('requested', v_req));
  END IF;

  /* ── ★ השלמה: מחזור שנגמר ואין לו סטטיסטיקה בכלל ───────────── */
  SELECT * INTO v_fill FROM game.gameweek_needs_backfill() LIMIT 1;
  IF v_fill.code IS NULL THEN
    RETURN v;
  END IF;

  /* ויסות — ניסיון אחד לחצי שעה. הספק כבר חסם אותנו פעם אחת. */
  SELECT max(requested_at) INTO v_gap
    FROM game.ingest_dispatches WHERE origin = 'backfill';
  IF v_gap IS NOT NULL AND v_gap > now() - INTERVAL '30 minutes' THEN
    RETURN v || jsonb_build_object('backfill',
             jsonb_build_object('gw', v_fill.code, 'held', 'throttled'));
  END IF;

  BEGIN
    SELECT net.http_post(
             url     := v_url,
             headers := jsonb_build_object('content-type','application/json',
                                           'x-ingest-token', v_token),
             body    := jsonb_build_object('phase','sweep','round', v_fill.number),
             timeout_milliseconds := 55000) INTO v_req;
  EXCEPTION WHEN undefined_function OR undefined_table OR invalid_schema_name THEN
    RETURN v || jsonb_build_object('backfill', 'pg_net_missing');
  END;

  INSERT INTO game.ingest_dispatches (request_id, origin)
  VALUES (v_req, 'backfill') ON CONFLICT DO NOTHING;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (game.actor_label(), 'lifecycle_backfill', 'gameweek', v_fill.code,
          jsonb_build_object('round', v_fill.number, 'request', v_req));

  RETURN v || jsonb_build_object('backfill',
           jsonb_build_object('gw', v_fill.code, 'round', v_fill.number,
                              'requested', v_req));
END;
$$;

COMMIT;

/* ★ אחרי שהוגדרה מחדש — נשללת שוב. פונקציה שנוצרת מחדש מקבלת
   את ברירת המחדל של db/07, וזו בדיוק הדרך שבה חור נסגר ונפתח
   בלי שאיש שם לב. */
DO $relock$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::REGPROCEDURE AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'game' AND game.is_system_routine(p.proname)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
    END IF;
  END LOOP;
END
$relock$;

INSERT INTO game.schema_migrations (version, note) VALUES
  ('34', '★ מחזור שנגמר בלי שורת סטטיסטיקה אחת חוזר לתור מעצמו')
ON CONFLICT (version) DO NOTHING;
