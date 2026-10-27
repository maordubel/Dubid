-- =====================================================================
--  db/36_publish_gate.sql — פרסום אטומי, מדיניות דחיות, והשלמה שחוזרת
--
--  ═══════════════════════════════════════════════════════════════
--  ★ מה זה פותר (ביקורת האוטומציה 17.10.2026 · A01, A03)
--  ═══════════════════════════════════════════════════════════════
--
--  1. **פרסום בלי שער (A01).** `dubid-score-gameweek` כתבה `published`
--     בעצמה, גם כשלא נוקד אף הרכב, וה-ingest הסתפק ב-HTTP 200.
--     עכשיו יש נתיב פרסום יחיד: `game.publish_scored_gameweek`. הוא
--     בודק במסד — לא בקליינט, שהוא זה שיכול לטעות — שמספר הציונים
--     תואם את מספר ההגשות, שלא היו כשלי ולידציה, שאין התרעה חוסמת,
--     ושהנתונים לא זזו מאז החישוב. כישלון חוזר כ**ערך**, לא כשגיאה.
--
--  2. **מחזור חלקי לא חזר להשלמה (A03).** `gameweek_needs_backfill`
--     דרשה «אפס שורות סטטיסטיקה בכל המחזור». מחזור 5 נתקע עם
--     משחק אחד שנקלט ושישה בסטטוס `live` ישן — והתור לא ראה אותו.
--     עכשיו: משחק שהסתיים בלי שורת נתונים אחת, או משחק שהסטטוס שלו
--     ישן מעבר לשלוש שעות, מחזיר את המחזור לתור. עם תקרה של 10
--     ניסיונות ל-24 שעות לכל מחזור, כדי שמקור שחסם אותנו לא יספוג
--     עוד הפצצה.
--
--  3. **משחק שנדחה חסם את המחזור (מדיניות שהוכרעה: «המחזור
--     מתפרסם בלעדיו»).** `v_final = v_total` ספר גם משחק שנדחה,
--     ולכן מחזור כזה לא הגיע ל-`scoring` לעולם. משחק `postponed`/
--     `abandoned` יוצא מהספירה. הוא לא מנוקד ולא נמחק: «אין תוצאה»
--     אינה «תיקו».
--
--  4. **מחזור שהדדליין שלו עבר בטיוטה (A03, חלק שני).** פתיחה דורשת
--     דדליין עתידי, כך שמחזור שפספס אותו נשאר `draft` לנצח. עכשיו
--     הוא נועל ומתקדם. אין הגשה מאוחרת: `submit_lineup` בודק את
--     השעון בשרת, לא את הסטטוס.
--
--  ★ הפונקציה החדשה נסגרת מ-anon/authenticated ונפתחת רק ל-service_role.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
--  §1 · תור ההשלמות
-- ---------------------------------------------------------------------
/* ★ db/56 מוסיף league_id לטבלת ההחזרה — DROP כדי שהרצה חוזרת של RUN-ALL לא תיפול */
DROP FUNCTION IF EXISTS game.gameweek_needs_backfill();
CREATE OR REPLACE FUNCTION game.gameweek_needs_backfill()
RETURNS TABLE (code TEXT, number INT)
LANGUAGE sql STABLE
SET search_path = game, core, public
AS $$
  SELECT g.code, g.number
    FROM game.gameweeks g
   WHERE g.status NOT IN ('published','archived')
     AND EXISTS (SELECT 1 FROM core.weekly_matches m WHERE m.gameweek_id = g.id)
     /* שום משחק לא נמצא עדיין בחלון המשחק: או שהסתיים/נדחה, או
        שהתחיל לפני יותר משלוש שעות (ואז הסטטוס הוא שישן, לא המשחק) */
     AND NOT EXISTS (
           SELECT 1 FROM core.weekly_matches m
            WHERE m.gameweek_id = g.id
              AND m.status NOT IN ('finished','postponed','abandoned')
              AND m.kickoff_at > now() - INTERVAL '3 hours')
     AND (
           /* א. משחק שהסתיים ואין לו ולו שורת נתונים אחת */
           EXISTS (SELECT 1 FROM core.weekly_matches m
                    WHERE m.gameweek_id = g.id AND m.status = 'finished'
                      AND NOT EXISTS (SELECT 1 FROM core.player_match_stats s
                                       WHERE s.match_id = m.id))
           /* ב. סטטוס ישן: המשחק נגמר מזמן והמקור עוד לא אמר */
        OR EXISTS (SELECT 1 FROM core.weekly_matches m
                    WHERE m.gameweek_id = g.id
                      AND m.status NOT IN ('finished','postponed','abandoned'))
         )
     /* תקרה: עשרה ניסיונות ב-24 שעות לכל מחזור */
     AND (SELECT count(*) FROM game.audit_logs a
           WHERE a.action = 'lifecycle_backfill' AND a.entity = 'gameweek'
             AND a.entity_id = g.code
             AND a.created_at > now() - INTERVAL '24 hours') < 10
   ORDER BY g.number;
$$;

COMMENT ON FUNCTION game.gameweek_needs_backfill() IS
  'מחזורים שיש בהם משחק שנגמר בלי נתונים או משחק עם סטטוס ישן — כלומר נפלו או נתקעו, לא ממתינים. תקרה: 10 ניסיונות ל-24 שעות.';

-- ---------------------------------------------------------------------
--  §2 · מחזור החיים: דחיות ודדליין שהוחמץ
-- ---------------------------------------------------------------------
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
  v_excluded INT;
  v_was_draft BOOLEAN := FALSE;
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
    /* ★ משחק שנדחה או הופסק **אינו מחזיק את המחזור**. הוא לא ייגמר
       בתוך המחזור הזה, ו«אין תוצאה» אינה «תיקו» — לכן הוא יוצא
       מהספירה, והמחזור מתפרסם בלעדיו. המשחק עצמו נשאר בטבלה
       (לא נמחק ולא מנוקד), והאדמין יכול להעביר אותו למחזור אחר. */
    SELECT count(*) FILTER (WHERE status NOT IN ('postponed','abandoned')),
           count(*) FILTER (WHERE status = 'finished'),
           count(*) FILTER (WHERE status IN ('live','finished')),
           count(*) FILTER (WHERE status IN ('postponed','abandoned'))
      INTO v_total, v_final, v_started, v_excluded
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
    IF g.status IN ('open','draft') AND g.lock_at <= now() THEN
      /* ★ `draft` כאן = מחזור שהדדליין שלו עבר בלי שנפתח. הוא נשאר
         טיוטה לנצח (פתיחה דורשת דדליין עתידי), ובכל התקופה הזו
         הוא לא יכול היה להתנקד ולא להפסיק לחסום. עכשיו הוא נועל
         ומתקדם כמו כל מחזור — ללא הגשה מאוחרת: `submit_lineup`
         ממשיך לבדוק `lock_at` מול שעון השרת. */
      v_was_draft := (g.status = 'draft');
      UPDATE game.gameweeks SET status = 'locked' WHERE id = g.id;
      UPDATE game.user_lineups SET status = 'locked'
       WHERE gameweek_id = g.id AND status = 'submitted';
      g.status := 'locked';
      v_actions := v_actions || jsonb_build_object('gw', g.code, 'action', 'locked');

      INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
      VALUES (game.actor_label(), 'auto_lock_gameweek', 'gameweek', g.code,
              jsonb_build_object('lockAt', g.lock_at, 'missedOpen', v_was_draft));
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
      v_actions := v_actions || jsonb_build_object('gw', g.code, 'action', 'scoring',
                                                   'excluded', v_excluded);
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

-- ---------------------------------------------------------------------
--  §3 · שער הפרסום
-- ---------------------------------------------------------------------
/**
 * הנתיב היחיד שבו ניקוד הופך ל«פורסם» אוטומטית.
 *
 * ★ המספרים נספרים **כאן**, מהמסד, ולא נלקחים מהקורא. הקורא
 *   מדווח כמה ציונים הוא חישב (`p_scored`) — והמסד משווה אותו
 *   למספר ההגשות שהוא עצמו סופר. כשקריאת ההרכבים ב-Edge Function
 *   נכשלת היא רואה אפס הרכבים ו«מצליחה» לנקד אפס; השוואה מול
 *   מסד היא מה שמזהה את זה.
 *
 * ★ כישלון חוזר כערך `{ok:false, reason}` ולא כשגיאה: שגיאה
 *   מגלגלת אחורה את הטרנזקציה ואיתה את רישום הסירוב.
 *
 * מחזור בלי אף הגשה מתפרסם במפורש (`entries = 0`): זה מצב חוקי —
 * מחזור 6 נחתך מבלי שאיש הגיש — והוא שונה מ«קריאה שנכשלה».
 */
CREATE OR REPLACE FUNCTION game.publish_scored_gameweek(
  p_gw_code     TEXT,
  p_scored      INT,
  p_fingerprint TEXT,
  p_failures    INT DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  v_gw      game.gameweeks;
  v_entries INT; v_stored INT; v_blocks INT; v_fp TEXT;
  v_reason  TEXT; v_published TEXT;
BEGIN
  IF NOT game.is_system() THEN RAISE EXCEPTION 'SYSTEM_REQUIRED'; END IF;

  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw.id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'GAMEWEEK_NOT_FOUND');
  END IF;

  SELECT count(*) INTO v_entries FROM game.user_lineups
   WHERE gameweek_id = v_gw.id AND status IN ('submitted','locked','scored');

  SELECT count(*) INTO v_stored
    FROM game.lineup_scores ls
    JOIN game.user_lineups ul ON ul.id = ls.lineup_id
   WHERE ul.gameweek_id = v_gw.id AND ul.status IN ('submitted','locked','scored');

  SELECT count(*) INTO v_blocks FROM game.ingest_alerts
   WHERE gw_code = p_gw_code AND cleared_at IS NULL AND severity = 'block';

  v_fp := game.gameweek_fingerprint(p_gw_code);

  v_reason := CASE
    WHEN v_gw.status <> 'scoring'                    THEN 'NOT_IN_SCORING'
    WHEN COALESCE(p_failures, 0) > 0                 THEN 'LINEUP_FAILURES'
    WHEN COALESCE(p_scored, -1) <> v_entries         THEN 'SCORE_COUNT_MISMATCH'
    WHEN v_stored <> v_entries                       THEN 'STORED_COUNT_MISMATCH'
    WHEN v_blocks > 0                                THEN 'BLOCKING_ALERTS'
    WHEN p_fingerprint IS DISTINCT FROM v_fp         THEN 'DATA_MOVED'
    ELSE NULL END;

  IF v_reason IS NOT NULL THEN
    /* נרשם — וה-tick הבא ינסה שוב. 'warn' ולא 'block': התרעה חוסמת
       דורשת שחרור ידני, וזה בדיוק מה שהאוטומציה אמורה לחסוך. */
    INSERT INTO game.ingest_alerts (gw_code, kind, severity, detail)
    VALUES (p_gw_code, 'publish_refused', 'warn',
            jsonb_build_object('reason', v_reason, 'entries', v_entries,
                               'scored', p_scored, 'stored', v_stored,
                               'failures', COALESCE(p_failures, 0), 'blocks', v_blocks))
    ON CONFLICT DO NOTHING;

    INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
    VALUES (game.actor_label(), 'publish_refused', 'gameweek', p_gw_code,
            jsonb_build_object('reason', v_reason, 'entries', v_entries,
                               'scored', p_scored, 'stored', v_stored));

    RETURN jsonb_build_object('ok', FALSE, 'reason', v_reason,
                              'entries', v_entries, 'scored', p_scored,
                              'stored', v_stored, 'blocks', v_blocks);
  END IF;

  v_published := game.admin_set_published(p_gw_code, TRUE);

  UPDATE game.ingest_alerts
     SET cleared_at = now(), cleared_by = 'system:publish'
   WHERE gw_code = p_gw_code AND kind = 'publish_refused' AND cleared_at IS NULL;

  RETURN jsonb_build_object('ok', TRUE, 'status', v_published,
                            'entries', v_entries, 'noEntries', v_entries = 0);
END;
$$;

COMMENT ON FUNCTION game.publish_scored_gameweek(TEXT, INT, TEXT, INT) IS
  'הנתיב האוטומטי היחיד לפרסום ניקוד. בודק מספר ציונים, כשלים, התרעות וטביעת אצבע — ומחזיר ok/reason כערך.';

CREATE OR REPLACE FUNCTION game.is_system_routine(p_name TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT p_name LIKE 'ingest\_%'
      OR p_name IN (
           'lifecycle_tick','auto_advance','touch_fingerprint',
           'gameweek_fingerprint','can_write_data','is_system',
           'publish_scored_gameweek');
$$;

DO $lock$
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

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    FOR r IN
      SELECT p.oid::REGPROCEDURE AS sig
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'game'
         AND p.proname IN ('publish_scored_gameweek','auto_advance')
    LOOP
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    END LOOP;
  END IF;
END
$lock$;

COMMIT;

INSERT INTO game.schema_migrations (version, note) VALUES
  ('36', '★ שער פרסום אטומי, משחק שנדחה לא חוסם, מחזור חלקי חוזר להשלמה')
ON CONFLICT (version) DO NOTHING;
