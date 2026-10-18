-- =====================================================================
--  db/39_league_scoped_current.sql — מחזור נוכחי אחד **לכל ליגה**
-- =====================================================================
--  הכנה לליגה היוונית (ובכלל לכל ליגה נוספת). עד עכשיו `is_current`
--  היה דגל יחיד במערכת כולה (`gameweeks_one_current`). מרגע שיש
--  יותר מליגה אחת פעילה זה היה גורם לכך שפתיחת מחזור ביוון מכבה את
--  המחזור הנוכחי בישראל.
--
--  מה משתנה (תוספתי, ללא שינוי התנהגות כל עוד יש ליגה אחת):
--   1. `gameweeks.league_id` — עמודה נגזרת מהעונה (טריגר), לצורך
--      אינדקס ייחודי חלקי.
--   2. האינדקס הייחודי `gameweeks_one_current` מוחלף ב-
--      `gameweeks_one_current_per_league`.
--   3. `sync_current_gameweek()` עובד לכל ליגה בנפרד.
--   4. `auto_advance()`: «המחזור הקודם עדיין באוויר» נבדק באותה
--      עונה בלבד; פתיחת מחזור לא נוגעת ב-`is_current` (זה תפקיד
--      הסנכרון, פר-ליגה).
--
--  ⚠ סדר פריסה: **לא** להזין מחזורי יוון לפני שהקוראים שמסתמכים על
--  «המחזור הנוכחי היחיד» (admin_console / live_data / ingest status)
--  מקבלים פרמטר ליגה. עד אז הם מחזירים את הליגה הראשונה לפי
--  `created_at` — דטרמיניסטי, אבל עיוור ליוון.
-- =====================================================================
BEGIN;

ALTER TABLE game.gameweeks ADD COLUMN IF NOT EXISTS league_id UUID REFERENCES core.leagues(id);

UPDATE game.gameweeks gw SET league_id = s.league_id
  FROM core.seasons s WHERE s.id = gw.season_id AND gw.league_id IS DISTINCT FROM s.league_id;

CREATE OR REPLACE FUNCTION game.gameweek_set_league()
RETURNS TRIGGER LANGUAGE plpgsql AS $t$
BEGIN
  SELECT league_id INTO NEW.league_id FROM core.seasons WHERE id = NEW.season_id;
  RETURN NEW;
END;
$t$;

DROP TRIGGER IF EXISTS gameweeks_set_league ON game.gameweeks;
CREATE TRIGGER gameweeks_set_league
  BEFORE INSERT OR UPDATE OF season_id ON game.gameweeks
  FOR EACH ROW EXECUTE FUNCTION game.gameweek_set_league();

DROP INDEX IF EXISTS game.gameweeks_one_current;
CREATE UNIQUE INDEX IF NOT EXISTS gameweeks_one_current_per_league
  ON game.gameweeks (league_id) WHERE is_current;

CREATE OR REPLACE FUNCTION game.sync_current_gameweek()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $f$
DECLARE l RECORD; v_id UUID;
BEGIN
  FOR l IN SELECT DISTINCT league_id FROM game.gameweeks WHERE league_id IS NOT NULL LOOP
    SELECT id INTO v_id FROM game.gameweeks
     WHERE league_id = l.league_id AND status IN ('open','locked','live','scoring')
     ORDER BY number DESC LIMIT 1;
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM game.gameweeks
       WHERE league_id = l.league_id AND status = 'published'
       ORDER BY number DESC LIMIT 1;
    END IF;
    CONTINUE WHEN v_id IS NULL;
    CONTINUE WHEN EXISTS (SELECT 1 FROM game.gameweeks WHERE id = v_id AND is_current)
              AND (SELECT count(*) FROM game.gameweeks
                    WHERE league_id = l.league_id AND is_current) = 1;
    UPDATE game.gameweeks SET is_current = FALSE
     WHERE league_id = l.league_id AND is_current AND id <> v_id;
    UPDATE game.gameweeks SET is_current = TRUE WHERE id = v_id;
    INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
    SELECT game.actor_label(), 'sync_current_gameweek', 'gameweek', code, '{}'::jsonb
      FROM game.gameweeks WHERE id = v_id;
  END LOOP;
END;
$f$;
REVOKE ALL ON FUNCTION game.sync_current_gameweek() FROM PUBLIC, anon, authenticated;

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
    SELECT gw.id, gw.code, gw.number, gw.status, gw.lock_at, gw.season_id
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
       /* ★ חוק יום שני: מחזור נפתח למשחק רק מיום שני 09:00 (אתונה) של
          השבוע שבו נפתח המשחק הראשון שלו. לא מוקדם יותר. */
       AND now() >= game.gameweek_publish_at(g.lock_at)
       /* רק אחרי שהקודם כבר לא תלוי באוויר */
       AND NOT EXISTS (SELECT 1 FROM game.gameweeks p
                        WHERE p.number < g.number
                          AND p.season_id = g.season_id   -- ★ רק אותה עונה/ליגה
                          AND p.status IN ('open','locked','live','scoring'))
    THEN
      UPDATE game.gameweeks SET status = 'open' WHERE id = g.id;
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

  PERFORM game.sync_current_gameweek();
  SELECT gw.code INTO v_current FROM game.gameweeks gw
    JOIN core.seasons s ON s.id = gw.season_id
    JOIN core.leagues l ON l.id = s.league_id
   WHERE gw.is_current ORDER BY l.created_at, l.code LIMIT 1;

  RETURN jsonb_build_object(
    'actions', v_actions,
    'readyToPublish', v_ready,
    'current', v_current,
    'at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
END;
$$;

COMMIT;

SELECT game.sync_current_gameweek() WHERE game.can_write_data();

INSERT INTO game.schema_migrations (version, note) VALUES
  ('39', '★ מחזור נוכחי אחד לכל ליגה (הכנה ליוון)')
ON CONFLICT (version) DO NOTHING;
