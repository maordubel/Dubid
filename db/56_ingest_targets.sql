-- =====================================================================
--  db/56_ingest_targets.sql · המסד בוחר איזה מחזור נסרק, לא הספק
--
--  הבאג (נמצא בייצור, 27.10.2026):
--   ingest_tick שלחה `phase:auto` בלי מספר מחזור, וה-Edge שאל את 365scores
--   "מה המחזור הנוכחי". הספק מקדם את המחזור **לפני** שהמשחק האחרון נגמר:
--    · en-8 — Sunderland–Leeds (25.10 16:30) נסרק לאחרונה ב-18:20 בעודו חי,
--      ומאז הקליטה עברה ל-en-9. המשחק תקוע 'live' כבר 40 שעות, en-8 לא
--      מגיע ל-scoring, ולכן en-9 לא נפתח (פתיחה מחכה לפרסום הקודם).
--    · es-10 — Sevilla–Osasuna, אותו דבר בדיוק.
--    · gr — הספק תקוע על מחזור 7 (משחק נדחה), כך שמשחקי gr-8 נסרקו רק
--      בשלב 'fixtures' (בלי סטטיסטיקה). gr-8 פורסם עם סטטיסטיקה ל-4 מתוך 7
--      משחקים, כי אף שער לא דרש כיסוי למשחק שאין בו שחקן נבחר.
--   ובנוסף lifecycle_tick שלחה השלמות (backfill) **בלי ליגה** — כלומר
--   מחזור יווני/אנגלי שנפל היה נסרק כמחזור ישראלי באותו מספר.
--
--  התיקון — דטרמיניסטי, בשרת, בלי אדם:
--   1. game.ingest_target(league): המחזור הוותיק ביותר שלא פורסם (כולל
--      טיוטה קרובה; מצייני מקום רחוקים לא). מחזור תקוע הוא בדיוק המחזור
--      הזה, כי הבא לא נפתח לפני שהוא מתפרסם. אין כזה → NULL → ה-Edge
--      שואל את הספק (אתחול עונה). ingest_overlap_target: מחזור חדש יותר
--      שכבר רץ בזמן שהפעיל תקוע — נסרק מ-lifecycle_tick בדקות :05.
--   2. game.ingest_request_body(league, phase, round): גוף בקשה אחד לכל
--      מקום ששולח ל-Edge — ingest_tick, פרסום, השלמה. ליגה תמיד מפורשת.
--   3. שער כיסוי: משחק שנגמר ולאחד הצדדים פחות מ-11 שורות סטטיסטיקה →
--      התרעה חוסמת 'match_stats_missing' — עד 14 שעות מהבעיטה, ואז
--      יורדת ל-warn (ספק שלא מפרסם סטטיסטיקה למשחק לא יתקע עונה).
--   4. משחק שסטטוסו לא נסגר 36 שעות אחרי הבעיטה → warn 'stale_match_status'.
--      לא מנחשים תוצאה; ההתרעה מופיעה במסך הקליטה.
-- =====================================================================
SET search_path = game, core, public;

BEGIN;

/* ── 1. גוף בקשה אחד לכל שליחה ל-Edge ─────────────────────────────── */
CREATE OR REPLACE FUNCTION game.ingest_request_body(
  p_league_id UUID, p_phase TEXT DEFAULT 'auto', p_round INT DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
  SELECT jsonb_build_object(
           'phase',          COALESCE(p_phase, 'auto'),
           'league',         l.code,
           'competition365', i.competition_365,
           'gwPrefix',       i.gw_prefix,
           'primary',        (l.created_at = (SELECT min(created_at) FROM core.leagues)))
         || CASE WHEN p_round IS NULL THEN '{}'::jsonb
                 ELSE jsonb_build_object('round', p_round) END
    FROM core.leagues l
    JOIN game.ingest_sources i ON i.league_id = l.id
   WHERE l.id = p_league_id;
$$;
REVOKE ALL ON FUNCTION game.ingest_request_body(UUID, TEXT, INT) FROM PUBLIC, anon, authenticated;

/* ── 2. איזה מחזור לסרוק ───────────────────────────────────────────── */
/* ★ "פעיל" = המחזור הוותיק ביותר שעוד לא פורסם (כולל טיוטה קרובה).
   מחזור שתקוע עם משחק חי הוא בדיוק המחזור הזה — כי הבא לא נפתח לפני
   שהוא מתפרסם — ולכן כלל אחד מכסה גם "השלמה" וגם "המחזור הנוכחי".
   ה-Edge מושך בכל פעימה גם את לוח המחזור הבא (round+1). */
CREATE OR REPLACE FUNCTION game.ingest_target(p_league_id UUID)
RETURNS TABLE (code TEXT, number INT, reason TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
  SELECT g.code, g.number, 'active'::text
    FROM game.gameweeks g
   WHERE g.league_id = p_league_id
     AND g.status IN ('draft','open','locked','live','scoring')
     AND g.number > COALESCE((SELECT max(p.number) FROM game.gameweeks p
                               WHERE p.league_id = p_league_id
                                 AND p.status = 'published'), 0)
     /* ★ מצייני מקום של קליטה (טיוטה עם דדליין בעוד שנה) אינם מחזור פעיל */
     AND g.lock_at < now() + INTERVAL '21 days'
   ORDER BY g.number
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION game.ingest_target(UUID) FROM PUBLIC, anon, authenticated;

/* ★ מחזור חדש יותר שכבר רץ בזמן שהפעיל עוד לא פורסם (פעיל תקוע שבוע) —
   נסרק בנפרד מתוך lifecycle_tick, בדקות שבהן ingest_tick לא רצה, כדי
   ששתי קליטות לא יתחרו על אותן שורות. */
CREATE OR REPLACE FUNCTION game.ingest_overlap_target(p_league_id UUID)
RETURNS TABLE (code TEXT, number INT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
  SELECT g.code, g.number
    FROM game.gameweeks g
   WHERE g.league_id = p_league_id
     AND g.status IN ('locked','live','scoring')
     AND g.number > COALESCE((SELECT t.number FROM game.ingest_target(p_league_id) t), 2147483647)
     AND EXISTS (
           SELECT 1 FROM core.weekly_matches m
            WHERE m.gameweek_id = g.id
              AND m.kickoff_at <= now()
              AND m.kickoff_at >  now() - INTERVAL '14 hours')
   ORDER BY g.number DESC
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION game.ingest_overlap_target(UUID) FROM PUBLIC, anon, authenticated;

/* ── 3. הפעימה: בקשה אחת לכל מקור פעיל, עם מחזור שהמסד בחר ─────────── */
CREATE OR REPLACE FUNCTION game.ingest_tick(p_origin TEXT DEFAULT 'cron')
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public, extensions
AS $$
DECLARE
  v_url   TEXT;
  v_token TEXT;
  v_req   BIGINT;
  v_reqs  JSONB := '[]'::jsonb;
  s       RECORD;
  t       RECORD;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);

  IF NOT game.ingest_should_run() THEN
    RETURN jsonb_build_object('skipped', 'nothing_to_do');
  END IF;

  SELECT function_url, token INTO v_url, v_token FROM game.ingest_secrets WHERE id;
  IF v_url IS NULL OR v_token IS NULL THEN
    RETURN jsonb_build_object('skipped', 'endpoint_not_configured');
  END IF;

  FOR s IN
    SELECT l.id, l.code
      FROM game.ingest_sources i JOIN core.leagues l ON l.id = i.league_id
     WHERE i.enabled
     ORDER BY l.created_at, l.code
  LOOP
    SELECT * INTO t FROM game.ingest_target(s.id);

    BEGIN
      SELECT net.http_post(
               url     := v_url,
               headers := jsonb_build_object(
                            'content-type',   'application/json',
                            'x-ingest-token', v_token),
               body    := game.ingest_request_body(s.id, 'auto', t.number),
               timeout_milliseconds := 55000
             ) INTO v_req;
    EXCEPTION WHEN undefined_function OR undefined_table OR invalid_schema_name THEN
      RETURN jsonb_build_object('skipped', 'pg_net_missing');
    END;

    INSERT INTO game.ingest_dispatches (request_id, origin)
    VALUES (v_req, COALESCE(p_origin, 'cron'))
    ON CONFLICT (request_id) DO NOTHING;

    v_reqs := v_reqs || jsonb_build_object(
      'league', s.code, 'requested', v_req,
      'gw', t.code, 'round', t.number, 'reason', COALESCE(t.reason, 'provider'));
  END LOOP;

  RETURN jsonb_build_object('requests', v_reqs, 'at', now());
END;
$$;
REVOKE ALL ON FUNCTION game.ingest_tick(TEXT) FROM PUBLIC, anon, authenticated;

/* ── 4. השלמה (כלל db/36 ללא שינוי) — מחזיר גם את הליגה ──────────────── */
DROP FUNCTION IF EXISTS game.gameweek_needs_backfill();
CREATE FUNCTION game.gameweek_needs_backfill()
RETURNS TABLE (code TEXT, number INT, league_id UUID)
LANGUAGE sql STABLE
SET search_path = game, core, public
AS $$
  SELECT g.code, g.number, g.league_id
    FROM game.gameweeks g
   WHERE g.status NOT IN ('published','archived')
     AND g.league_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM core.weekly_matches m WHERE m.gameweek_id = g.id)
     AND NOT EXISTS (
           SELECT 1 FROM core.weekly_matches m
            WHERE m.gameweek_id = g.id
              AND m.status NOT IN ('finished','postponed','abandoned')
              AND m.kickoff_at > now() - INTERVAL '3 hours')
     AND (
           EXISTS (SELECT 1 FROM core.weekly_matches m
                    WHERE m.gameweek_id = g.id AND m.status = 'finished'
                      AND NOT EXISTS (SELECT 1 FROM core.player_match_stats s
                                       WHERE s.match_id = m.id))
        OR EXISTS (SELECT 1 FROM core.weekly_matches m
                    WHERE m.gameweek_id = g.id
                      AND m.status NOT IN ('finished','postponed','abandoned'))
         )
     AND (SELECT count(*) FROM game.audit_logs a
           WHERE a.action = 'lifecycle_backfill' AND a.entity = 'gameweek'
             AND a.entity_id = g.code
             AND a.created_at > now() - INTERVAL '24 hours') < 10
   ORDER BY g.lock_at, g.number;
$$;
COMMENT ON FUNCTION game.gameweek_needs_backfill() IS
  'מחזורים שיש בהם משחק שנגמר בלי נתונים או משחק עם סטטוס ישן. מחזיר league_id — ההשלמה נשלחת לליגה הנכונה. תקרה: 10 ניסיונות ל-24 שעות.';
REVOKE ALL ON FUNCTION game.gameweek_needs_backfill() FROM PUBLIC, anon, authenticated;

/* ── 5. מחזור החיים: פרסום והשלמה נשלחים עם הליגה של המחזור ────────── */
CREATE OR REPLACE FUNCTION game.lifecycle_tick()
RETURNS jsonb
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
  v_gw     RECORD;
  v_body   JSONB;
  v_src    RECORD;
  v_ov     RECORD;
  v_over   JSONB := '[]'::jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);

  BEGIN PERFORM game.ingest_housekeeping();
  EXCEPTION WHEN OTHERS THEN NULL; END;

  v := game.auto_advance();
  v_ready := v->>'readyToPublish';

  SELECT function_url, token INTO v_url, v_token FROM game.ingest_secrets WHERE id;
  IF v_url IS NULL OR v_token IS NULL THEN
    RETURN v || jsonb_build_object('dispatch', 'endpoint_not_configured');
  END IF;

  IF v_ready IS NOT NULL THEN
    SELECT g.league_id, g.number INTO v_gw FROM game.gameweeks g WHERE g.code = v_ready;
    v_body := COALESCE(game.ingest_request_body(v_gw.league_id, 'auto', v_gw.number),
                       jsonb_build_object('phase', 'auto'));
    BEGIN
      SELECT net.http_post(
               url     := v_url,
               headers := jsonb_build_object('content-type','application/json',
                                             'x-ingest-token', v_token),
               body    := v_body,
               timeout_milliseconds := 55000) INTO v_req;
    EXCEPTION WHEN undefined_function OR undefined_table OR invalid_schema_name THEN
      RETURN v || jsonb_build_object('publish', 'pg_net_missing');
    END;

    INSERT INTO game.ingest_dispatches (request_id, origin)
    VALUES (v_req, 'lifecycle') ON CONFLICT DO NOTHING;

    RETURN v || jsonb_build_object('publish', jsonb_build_object('requested', v_req, 'gw', v_ready));
  END IF;

  /* ── מחזור חופף: חדש יותר שכבר רץ בזמן שהפעיל תקוע. רק בדקות :05–:09,
        כש-ingest_tick (:00, :10 …) לא רצה — שתי קליטות לא מתחרות. ── */
  IF (extract(minute FROM now())::int % 10) >= 5 THEN
    FOR v_src IN
      SELECT i.league_id FROM game.ingest_sources i
        JOIN core.leagues l ON l.id = i.league_id
       WHERE i.enabled ORDER BY l.created_at, l.code
    LOOP
      SELECT * INTO v_ov FROM game.ingest_overlap_target(v_src.league_id);
      CONTINUE WHEN v_ov.number IS NULL;
      BEGIN
        SELECT net.http_post(
                 url     := v_url,
                 headers := jsonb_build_object('content-type','application/json',
                                               'x-ingest-token', v_token),
                 body    := game.ingest_request_body(v_src.league_id, 'sweep', v_ov.number),
                 timeout_milliseconds := 55000) INTO v_req;
      EXCEPTION WHEN undefined_function OR undefined_table OR invalid_schema_name THEN
        EXIT;
      END;
      INSERT INTO game.ingest_dispatches (request_id, origin)
      VALUES (v_req, 'overlap') ON CONFLICT DO NOTHING;
      v_over := v_over || jsonb_build_object('gw', v_ov.code, 'requested', v_req);
    END LOOP;
    IF jsonb_array_length(v_over) > 0 THEN
      v := v || jsonb_build_object('overlap', v_over);
    END IF;
  END IF;

  SELECT * INTO v_fill FROM game.gameweek_needs_backfill() LIMIT 1;
  IF v_fill.code IS NULL THEN
    RETURN v;
  END IF;

  SELECT max(requested_at) INTO v_gap
    FROM game.ingest_dispatches WHERE origin = 'backfill';
  IF v_gap IS NOT NULL AND v_gap > now() - INTERVAL '30 minutes' THEN
    RETURN v || jsonb_build_object('backfill',
             jsonb_build_object('gw', v_fill.code, 'held', 'throttled'));
  END IF;

  v_body := game.ingest_request_body(v_fill.league_id, 'sweep', v_fill.number);
  IF v_body IS NULL THEN
    RETURN v || jsonb_build_object('backfill',
             jsonb_build_object('gw', v_fill.code, 'held', 'no_ingest_source'));
  END IF;

  BEGIN
    SELECT net.http_post(
             url     := v_url,
             headers := jsonb_build_object('content-type','application/json',
                                           'x-ingest-token', v_token),
             body    := v_body,
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
REVOKE ALL ON FUNCTION game.lifecycle_tick() FROM PUBLIC, anon, authenticated;

/* ── 6. שער כיסוי: משחק שנגמר בלי סטטיסטיקה לא מתפרסם בשקט ─────────── */
CREATE OR REPLACE FUNCTION game.ingest_check_match_coverage(p_gw_code TEXT)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_gw UUID; v_block JSONB; v_warn JSONB; v_stale JSONB; v_nb INT;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw IS NULL THEN RETURN 0; END IF;

  WITH cov AS (
    SELECT m.id, m.kickoff_at,
           core.ext_code('team', m.home_team_id) AS home,
           core.ext_code('team', m.away_team_id) AS away,
           (SELECT count(*) FROM core.player_match_stats s
             WHERE s.match_id = m.id AND s.team_id = m.home_team_id) AS h,
           (SELECT count(*) FROM core.player_match_stats s
             WHERE s.match_id = m.id AND s.team_id = m.away_team_id) AS a
      FROM core.weekly_matches m
     WHERE m.gameweek_id = v_gw AND m.status = 'finished'
  ), gaps AS (
    SELECT * FROM cov WHERE h < 11 OR a < 11
  )
  SELECT
    jsonb_agg(jsonb_build_object('home', home, 'away', away, 'homeRows', h, 'awayRows', a)
              ORDER BY kickoff_at)
      FILTER (WHERE kickoff_at + INTERVAL '14 hours' > now()),
    jsonb_agg(jsonb_build_object('home', home, 'away', away, 'homeRows', h, 'awayRows', a)
              ORDER BY kickoff_at)
      FILTER (WHERE kickoff_at + INTERVAL '14 hours' <= now())
    INTO v_block, v_warn
    FROM gaps;

  v_nb := COALESCE(jsonb_array_length(v_block), 0);

  /* פתוח קודם את מה שכבר לא נכון — הדה-דופ לפי detail, אז ניסוח חדש = שורה חדשה */
  UPDATE game.ingest_alerts
     SET cleared_at = now(), cleared_by = 'auto:coverage'
   WHERE gw_code = p_gw_code AND cleared_at IS NULL
     AND kind = 'match_stats_missing'
     AND (   (severity = 'block' AND detail IS DISTINCT FROM jsonb_build_object('matches', v_block))
          OR (severity = 'warn'  AND detail IS DISTINCT FROM jsonb_build_object('matches', v_warn)));

  IF v_nb > 0 THEN
    INSERT INTO game.ingest_alerts (gw_code, kind, severity, detail)
    VALUES (p_gw_code, 'match_stats_missing', 'block', jsonb_build_object('matches', v_block))
    ON CONFLICT DO NOTHING;
  END IF;
  IF v_warn IS NOT NULL THEN
    INSERT INTO game.ingest_alerts (gw_code, kind, severity, detail)
    VALUES (p_gw_code, 'match_stats_missing', 'warn', jsonb_build_object('matches', v_warn))
    ON CONFLICT DO NOTHING;
  END IF;

  /* משחק שלא נסגר 36 שעות אחרי הבעיטה — לא מנחשים, מתריעים */
  SELECT jsonb_agg(jsonb_build_object(
           'home', core.ext_code('team', m.home_team_id),
           'away', core.ext_code('team', m.away_team_id),
           'status', m.status, 'kickoff', m.kickoff_at) ORDER BY m.kickoff_at)
    INTO v_stale
    FROM core.weekly_matches m
   WHERE m.gameweek_id = v_gw
     AND m.status IN ('scheduled','live')
     AND m.kickoff_at < now() - INTERVAL '36 hours';

  UPDATE game.ingest_alerts
     SET cleared_at = now(), cleared_by = 'auto:coverage'
   WHERE gw_code = p_gw_code AND cleared_at IS NULL AND kind = 'stale_match_status'
     AND detail IS DISTINCT FROM jsonb_build_object('matches', v_stale);
  IF v_stale IS NOT NULL THEN
    INSERT INTO game.ingest_alerts (gw_code, kind, severity, detail)
    VALUES (p_gw_code, 'stale_match_status', 'warn', jsonb_build_object('matches', v_stale))
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_nb;
END;
$$;
ALTER FUNCTION game.ingest_check_match_coverage(TEXT) SET statement_timeout = '60s';
REVOKE ALL ON FUNCTION game.ingest_check_match_coverage(TEXT) FROM PUBLIC, anon, authenticated;

/* ingest_check_coverage (db/49) נשארת כפי שהיא, ועוטפים אותה: auto_advance
   קורא לה בכל בדיקת פרסום, אז השער החדש רץ באותה נקודה בדיוק. */
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'game' AND p.proname = 'ingest_check_lineup_coverage') THEN
    ALTER FUNCTION game.ingest_check_coverage(TEXT) RENAME TO ingest_check_lineup_coverage;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION game.ingest_check_coverage(p_gw_code TEXT)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_n INT;
BEGIN
  v_n := game.ingest_check_lineup_coverage(p_gw_code);
  PERFORM game.ingest_check_match_coverage(p_gw_code);
  RETURN v_n;
END;
$$;
ALTER FUNCTION game.ingest_check_coverage(TEXT) SET statement_timeout = '60s';
REVOKE ALL ON FUNCTION game.ingest_check_coverage(TEXT) FROM PUBLIC, anon, authenticated;

/* ── 7. בדיקת בריאות: מה כל ליגה תסרוק בפעימה הבאה ─────────────────── */
CREATE OR REPLACE FUNCTION game.ingest_targets_report()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'league', l.code, 'enabled', i.enabled,
           'gw', t.code, 'round', t.number, 'reason', COALESCE(t.reason, 'provider'))
           ORDER BY l.created_at, l.code), '[]'::jsonb)
    FROM game.ingest_sources i
    JOIN core.leagues l ON l.id = i.league_id
    LEFT JOIN LATERAL game.ingest_target(l.id) t ON TRUE;
$$;
REVOKE ALL ON FUNCTION game.ingest_targets_report() FROM PUBLIC, anon, authenticated;

COMMIT;

INSERT INTO game.schema_migrations (version, note) VALUES
  ('56', '★ המסד בוחר מחזור לסריקה לכל ליגה (הוותיק שלא פורסם → ספק); ליגה מפורשת בכל שליחה; שער כיסוי סטטיסטיקה למשחק')
ON CONFLICT (version) DO NOTHING;
