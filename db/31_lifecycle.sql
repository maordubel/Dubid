-- =====================================================================
--  db/31_lifecycle.sql — מחזור החיים מסתובב לבד
--
--  ═══════════════════════════════════════════════════════════════
--  ★★ מה היה שבור ★★
--  ═══════════════════════════════════════════════════════════════
--
--  מחזור 4 נגמר במלואו, לא עבר ל«נעול», ומחזור 5 לא נפתח.
--  שלוש סיבות, וכולן אותה סיבה אחת.
--
--  1. **המעבר `open → locked` לא היה קיים בכלל.**
--     הסטטוסים 'locked' ו-'live' היו מוגדרים בסכימה, מופיעים
--     בשער ההגשה (`submit_lineup`) ובשער הקליטה
--     (`ingest_should_run`) — ואף שורת קוד לא כתבה אותם.
--     ההגשה אמנם נחסמה נכון, כי `submit_lineup` בודק גם
--     `lock_at` מול שעון השרת, ולכן לא נגרם נזק תחרותי.
--     אבל המוצר מעולם לא אמר «נעול», ו-`ingest_should_run`
--     מעולם לא ראה מחזור נעול — כלומר החלון שבו הקליטה אמורה
--     לעבוד הכי קשה פשוט לא נפתח.
--
--  2. **כל מחזור החיים היה תלוי בפונקציית Edge אחת.**
--     `auto_advance()` נקראה אך ורק מתוך `dubid-ingest`. פונקציה
--     שלא נפרסה, שנופלת, או שהטוקן שלה פג — ומחזור החיים עוצר
--     לגמרי, בשקט, בלי שאיש יֵדע. הברִיף דורש שכל כלל תחרותי
--     חשוב יהיה **סמכותי בשרת**; «בשרת» כאן פורש בטעות כ«בשרת
--     של ספק הענן», ולא במסד.
--
--  3. **שער היציבות לא יכול היה להיפתח בלי הקליטה.**
--     `auto_advance` בדקה יציבות מול `game.gameweek_fingerprints`,
--     וטבלה זו נכתבה **רק** על ידי `ingest_snapshot`. בלי שורה
--     שם, `v_stable` יוצא NULL → FALSE → המחזור תקוע ב-'scoring'
--     לנצח. ומחזור תקוע ב-'scoring' חוסם את פתיחת הבא אחריו,
--     כי התנאי לפתיחה הוא שאין מחזור קודם באוויר.
--
--  ═══════════════════════════════════════════════════════════════
--  ★ מה משתנה כאן
--  ═══════════════════════════════════════════════════════════════
--
--  · `auto_advance()` מקבלת את שני המעברים החסרים, ומתחזקת את
--    טביעת האצבע בעצמה — ולכן אינה תלויה עוד בקליטה.
--  · `game.lifecycle_tick()` — משימת cron **נפרדת**, כל 5 דקות,
--    SQL טהור. מחזור החיים מסתובב גם כשה-Edge Function מתה.
--  · מחזור שתקוע ב-'scoring' מעבר לסף מרים התרעה במקום להיתקע
--    בשקט.
--
--  ★ מה **לא** משתנה, בכוונה:
--
--  · הניקוד נשאר במנוע ה-TS. לממש אותו שוב ב-SQL היה יוצר שני
--    מספרים לאותו מחזור. כשמחזור בשל, ה-tick **מזמן** את
--    הקליטה, והיא מריצה ניקוד ומפרסמת — בדיוק כמו קודם.
--  · הכלל «מחזור נפתח רק אחרי שהקודם פורסם» נשאר. פתיחת 5 בזמן
--    ש-4 עדיין לא פורסם הייתה מזיזה את `is_current` קדימה,
--    ומסך הדירוג — שנשען על המחזור הנוכחי — היה מתרוקן בדיוק
--    ברגע שבו המשתמש בא לראות את התוצאה שלו.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
--  §1 · טביעת אצבע — מי מתחזק אותה
-- ---------------------------------------------------------------------
/**
 * ★ הפונקציה הזו אינה מערכת שנייה לצד `ingest_snapshot`.
 *   היא **אותה לוגיקה** שנשלפה החוצה כדי ששני הקוראים יחלקו
 *   אותה: הקליטה כשהיא כותבת נתונים, ומחזור החיים כשהוא בודק
 *   אם הם הפסיקו לזוז. שני מימושים היו יכולים לא להסכים, ואז
 *   מחזור אחד היה «יציב» לפי אחד ו«זז» לפי השני.
 *
 * מחזירה את `since` — הרגע שבו הנתונים הפסיקו להשתנות.
 */
CREATE OR REPLACE FUNCTION game.touch_fingerprint(p_gw_code TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v_gw UUID; v_fp TEXT; v_since TIMESTAMPTZ;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw IS NULL THEN RETURN NULL; END IF;

  v_fp := game.gameweek_fingerprint(p_gw_code);

  INSERT INTO game.gameweek_fingerprints (gameweek_id, fingerprint)
  VALUES (v_gw, v_fp)
  ON CONFLICT (gameweek_id) DO UPDATE SET
    /* ★ `since` מתאפס **רק** כשהנתונים באמת השתנו. דגימה
       שמאפסת אותו בכל בדיקה הופכת את שער היציבות למכונה
       שלעולם לא תגיע ל-45 דקות. */
    since       = CASE WHEN game.gameweek_fingerprints.fingerprint IS DISTINCT FROM EXCLUDED.fingerprint
                       THEN now() ELSE game.gameweek_fingerprints.since END,
    fingerprint = EXCLUDED.fingerprint,
    checked_at  = now();

  SELECT since INTO v_since FROM game.gameweek_fingerprints WHERE gameweek_id = v_gw;
  RETURN v_since;
END;
$$;

COMMENT ON FUNCTION game.touch_fingerprint(TEXT) IS
  'דוגמת את טביעת האצבע של המחזור ומחזירה מאיזה רגע הנתונים לא זזו.';

-- ---------------------------------------------------------------------
--  §2 · מחזור החיים המלא
-- ---------------------------------------------------------------------
/**
 * מעברי הסטטוס — עכשיו כולם:
 *
 *     draft   → open      כשיש משחקים והדדליין עוד לפנינו
 *     open    → locked    ★ חדש — כשעבר הדדליין
 *     locked  → live      ★ חדש — כשהמשחק הראשון יצא לדרך
 *     live    → scoring   כשכל המשחקים הסתיימו
 *     scoring → published  (דרך מנוע ה-TS, אחרי ניקוד)
 *
 * הפונקציה אינה מחשבת ניקוד ואינה מפרסמת. היא מסובבת סטטוסים
 * ומחזירה `readyToPublish` כשמחזור בשל — והקורא הוא שמזמן את
 * הניקוד.
 */
CREATE OR REPLACE FUNCTION game.auto_advance()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  v_cfg      game.ingest_config%ROWTYPE;
  g          RECORD;
  v_actions  JSONB := '[]'::jsonb;
  v_ready    TEXT;
  v_total    INT; v_final INT; v_started INT; v_blocks INT; v_missing INT;
  v_since    TIMESTAMPTZ;
  v_stable   BOOLEAN;
  v_current  TEXT;
BEGIN
  IF NOT game.can_write_data() THEN RAISE EXCEPTION 'SYSTEM_OR_ADMIN_REQUIRED'; END IF;
  SELECT * INTO v_cfg FROM game.ingest_config WHERE id;
  IF NOT COALESCE(v_cfg.enabled, TRUE) THEN
    RETURN jsonb_build_object('skipped', 'ingest_disabled');
  END IF;

  FOR g IN
    SELECT gw.id, gw.code, gw.number, gw.status, gw.lock_at
      FROM game.gameweeks gw
     WHERE gw.status NOT IN ('published','archived')
     ORDER BY gw.number
  LOOP
    SELECT count(*),
           count(*) FILTER (WHERE status = 'finished'),
           count(*) FILTER (WHERE status IN ('live','finished'))
      INTO v_total, v_final, v_started
      FROM core.weekly_matches WHERE gameweek_id = g.id;

    CONTINUE WHEN v_total = 0;           -- מחזור בלי משחקים אינו מחזור

    /* ── draft → open ─────────────────────────────────────── */
    IF g.status = 'draft' AND COALESCE(v_cfg.auto_open_next, TRUE)
       AND g.lock_at > now()
       /* רק אחרי שהקודם כבר לא תלוי באוויר */
       AND NOT EXISTS (SELECT 1 FROM game.gameweeks p
                        WHERE p.number < g.number
                          AND p.status IN ('open','locked','live','scoring'))
    THEN
      UPDATE game.gameweeks SET status = 'open' WHERE id = g.id;
      UPDATE game.gameweeks SET is_current = FALSE WHERE is_current AND id <> g.id;
      UPDATE game.gameweeks SET is_current = TRUE  WHERE id = g.id;
      g.status := 'open';
      v_actions := v_actions || jsonb_build_object('gw', g.code, 'action', 'opened');

      INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
      VALUES (game.actor_label(), 'auto_open_gameweek', 'gameweek', g.code,
              jsonb_build_object('lockAt', g.lock_at, 'fixtures', v_total));
    END IF;

    /* ── ★ open → locked ──────────────────────────────────────
       הדדליין עבר. ההגשה כבר הייתה חסומה בפועל (`submit_lineup`
       בודק `lock_at` מול שעון השרת), אבל הסטטוס לא אמר את זה —
       ולכן גם `ingest_should_run` לא ידע שנפתח החלון שבו הקליטה
       צריכה לעבוד הכי צפוף. */
    IF g.status = 'open' AND g.lock_at <= now() THEN
      UPDATE game.gameweeks SET status = 'locked' WHERE id = g.id;
      UPDATE game.user_lineups SET status = 'locked'
       WHERE gameweek_id = g.id AND status = 'submitted';
      g.status := 'locked';
      v_actions := v_actions || jsonb_build_object('gw', g.code, 'action', 'locked');

      INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
      VALUES (game.actor_label(), 'auto_lock_gameweek', 'gameweek', g.code,
              jsonb_build_object('lockAt', g.lock_at));
    END IF;

    /* ── ★ locked → live ──────────────────────────────────────
       המשחק הראשון יצא לדרך. נגזר ממצב המשחקים ולא משעון בלבד:
       משחק שנדחה בחצי שעה לא אמור להדליק «חי» על מסך ריק. */
    IF g.status = 'locked' AND v_started > 0 THEN
      UPDATE game.gameweeks SET status = 'live' WHERE id = g.id;
      g.status := 'live';
      v_actions := v_actions || jsonb_build_object('gw', g.code, 'action', 'live');
    END IF;

    /* ── הכל נגמר → scoring ───────────────────────────────── */
    IF g.status IN ('open','locked','live') AND v_final = v_total THEN
      UPDATE game.gameweeks SET status = 'scoring' WHERE id = g.id;
      g.status := 'scoring';
      v_actions := v_actions || jsonb_build_object('gw', g.code, 'action', 'scoring');
    END IF;

    /* ── בשל לפרסום? ──────────────────────────────────────── */
    IF g.status = 'scoring' AND COALESCE(v_cfg.auto_publish, TRUE) THEN
      v_missing := game.ingest_check_coverage(g.code);

      SELECT count(*) INTO v_blocks FROM game.ingest_alerts
       WHERE gw_code = g.code AND cleared_at IS NULL AND severity = 'block';

      /* ★ כאן היה התקע. `since` נקרא מטבלה שרק הקליטה כתבה
         אליה; בלי שורה — NULL, ומחזור שתקוע לנצח. עכשיו
         מחזור החיים דוגם בעצמו. */
      v_since  := game.touch_fingerprint(g.code);
      v_stable := COALESCE(
        now() - v_since >= make_interval(mins => v_cfg.stable_minutes), FALSE);

      IF v_blocks = 0 AND v_stable THEN
        v_ready := g.code;
        v_actions := v_actions || jsonb_build_object('gw', g.code, 'action', 'readyToPublish');
      ELSE
        v_actions := v_actions || jsonb_build_object(
          'gw', g.code, 'action', 'holding',
          'reason', CASE WHEN v_blocks > 0 THEN 'alerts' ELSE 'not_stable' END,
          'blocks', v_blocks, 'missingStats', v_missing,
          'stableSince', v_since);

        /* ★ מחזור שתקוע ב-'scoring' יותר מ-24 שעות אינו «ממתין
           ליציבות» — הוא תקוע. התרעה, כדי שזה יופיע במסך
           הקליטה במקום להיעלם. */
        IF v_since IS NOT NULL AND now() - v_since >= INTERVAL '24 hours' THEN
          INSERT INTO game.ingest_alerts (gw_code, kind, severity, detail)
          VALUES (g.code, 'source_down', 'warn',
                  jsonb_build_object('issue', 'stuck_in_scoring',
                                     'since', v_since, 'blocks', v_blocks,
                                     'missingStats', v_missing))
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;
    END IF;
  END LOOP;

  SELECT code INTO v_current FROM game.gameweeks WHERE is_current;

  RETURN jsonb_build_object(
    'actions', v_actions,
    'readyToPublish', v_ready,
    'current', v_current,
    'at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
END;
$$;

COMMIT;

BEGIN;

-- ---------------------------------------------------------------------
--  §3 · הפעימה של מחזור החיים — נפרדת מהקליטה, בכוונה
-- ---------------------------------------------------------------------
/**
 * ★ למה משימה שנייה ולא הרחבה של `ingest_tick`
 *
 * `ingest_tick` נבנתה כדי **לחסוך** קריאות: היא רצה רק כשיש מה
 * לקלוט. זו החלטה נכונה לנתונים — ושגויה לחלוטין למחזור חיים,
 * שצריך להסתובב גם בשבוע בלי משחקים, וגם כשהקליטה מושבתת או
 * שבורה. שתי משימות עם שתי תדירויות ושתי סיבות קיום.
 *
 * הפעימה הזו לעולם אינה מחשבת ניקוד. כשמחזור בשל היא **מזמנת**
 * את הקליטה, וזו מריצה את מנוע ה-TS ומפרסמת. מספר אחד לכל
 * מחזור, ממקום אחד.
 */
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
BEGIN
  /* אותה הצהרה כמו ב-`ingest_tick`: זהות מערכת מוצהרת, לא נגזרת. */
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);

  v := game.auto_advance();
  v_ready := v->>'readyToPublish';

  IF v_ready IS NULL THEN
    RETURN v;
  END IF;

  SELECT function_url, token INTO v_url, v_token FROM game.ingest_secrets WHERE id;
  IF v_url IS NULL OR v_token IS NULL THEN
    RETURN v || jsonb_build_object('publish', 'endpoint_not_configured');
  END IF;

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
END;
$$;

/* ידנית מלוח הבקרה: "סובב מחזור עכשיו". */
CREATE OR REPLACE FUNCTION game.admin_lifecycle_now()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v JSONB;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  v := game.lifecycle_tick();
  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (game.actor_label(), 'admin_lifecycle_now', 'gameweek', 'manual', v);
  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_lifecycle_now() TO authenticated;

COMMIT;

-- ---------------------------------------------------------------------
--  §4 · רישום המשימה
-- ---------------------------------------------------------------------
DO $cron$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron אינו מותקן — דלגתי. Database → Extensions, ואז להריץ שוב.';
    RETURN;
  END IF;

  PERFORM cron.unschedule('dubid-lifecycle-tick') WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'dubid-lifecycle-tick');

  PERFORM cron.schedule('dubid-lifecycle-tick', '*/5 * * * *',
                        'SELECT game.lifecycle_tick();');

  RAISE NOTICE 'נרשמה משימה: dubid-lifecycle-tick (כל 5 דק׳)';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'רישום המשימה נכשל: % — אפשר לרשום ידנית מ-Database → Cron Jobs', SQLERRM;
END
$cron$;

INSERT INTO game.schema_migrations (version, note) VALUES
  ('31', '★ מחזור החיים מסתובב לבד — נעילה, «חי», ופעימה נפרדת מהקליטה')
ON CONFLICT (version) DO NOTHING;
