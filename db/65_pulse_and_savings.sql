-- =====================================================================
--  db/65_pulse_and_savings.sql — דופק המחזור (FOMO) + חיסכון לתוכנית החינם
-- =====================================================================
--  1. `game.round_pulse(code)` — כמה כבר בפנים (לפי מצב), כמה ב-24 שעות ובשעה
--     האחרונה, ומי האחרונים שנעלו. בלי הרכבים — אלה נחשפים רק בנעילה.
--  2. `entries()` — גם המערך מוסתר עד הנעילה (עד עכשיו רק השחקנים).
--  3. `bump_revision` — לא יותר מהודעה אחת בשנייה לכל תחום. ריצת קליטה אחת
--     העלתה את המונה מאות פעמים, וכל העלאה = הודעת realtime לכל מכשיר פתוח.
--  4. יומן ביקורת: עדכוני הקליטה ל-player_match_stats נרשמו פעמיים — ב-audit_logs
--     (שורה מלאה לפני/אחרי, 29MB) וב-core.stat_corrections. מעכשיו רק השני;
--     עריכה של אדם (auth.uid) ממשיכה להירשם כמו קודם.
--  5. `admin_add_bots` — ברירת מחדל: מפוזר על פני השעות הקרובות, לא באותה שנייה.
--  6. `admin_storage_report()` — גודל הטבלאות הגדולות מול מכסת 500MB.
-- =====================================================================
BEGIN;
SET search_path = game, core, public;

-- ---------------------------------------------------------------------
-- §1 · דופק המחזור
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION game.round_pulse(p_gw_code TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
  WITH g AS (SELECT id, code, lock_at FROM game.gameweeks WHERE code = p_gw_code),
  e AS (
    SELECT ul.mode, ul.submitted_at, ul.team_name, u.display_name
      FROM game.user_lineups ul
      JOIN g ON g.id = ul.gameweek_id
      LEFT JOIN game.users u ON u.id = ul.user_id
     WHERE ul.status IN ('submitted','locked','scored')
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM g) THEN NULL ELSE jsonb_build_object(
    'code', p_gw_code,
    'total', (SELECT count(*) FROM e),
    'five',  (SELECT count(*) FROM e WHERE mode = 'five'),
    'full',  (SELECT count(*) FROM e WHERE mode = 'full'),
    'last24h', (SELECT count(*) FROM e WHERE submitted_at > now() - INTERVAL '24 hours'),
    'lastHour', (SELECT count(*) FROM e WHERE submitted_at > now() - INTERVAL '1 hour'),
    'recent', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'name', COALESCE(NULLIF(btrim(x.team_name), ''), NULLIF(btrim(x.display_name), '')),
               'mode', x.mode,
               'at', to_char(x.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
             ORDER BY x.submitted_at DESC)
        FROM (SELECT * FROM e WHERE COALESCE(NULLIF(btrim(team_name), ''), NULLIF(btrim(display_name), '')) IS NOT NULL
               ORDER BY submitted_at DESC LIMIT 4) x), '[]'::jsonb),
    'at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  ) END;
$$;
GRANT EXECUTE ON FUNCTION game.round_pulse(TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- §2 · entries — המערך מוסתר עד הנעילה (שינוי שורה בגוף החי)
-- ---------------------------------------------------------------------
DO $fix$
DECLARE d TEXT;
  old TEXT := $o$'formation',  ul.formation,$o$;
BEGIN
  d := pg_get_functiondef('game.entries(text)'::regprocedure);
  IF position(old IN d) = 0 THEN RAISE NOTICE 'db/64 §2: כבר מתוקן — דלגתי'; RETURN; END IF;
  d := replace(d, old,
    $n$'formation',  CASE WHEN v_open AND ul.user_id IS DISTINCT FROM v_auth THEN NULL ELSE ul.formation END,$n$);
  EXECUTE d;
END
$fix$;

-- ---------------------------------------------------------------------
-- §3 · מונה השינויים — לכל היותר פעם בשנייה לכל תחום
-- ---------------------------------------------------------------------
--  ★ הלקוח (src/lib/revisionBus.ts) מחכה ≥2.5 שניות אחרי האירוע האחרון לפני
--    טעינה, ולכן כתיבה שנבלעה בחלון של שנייה כבר נראית בטעינה.
CREATE OR REPLACE FUNCTION game.bump_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = game, public
AS $$
BEGIN
  UPDATE game.data_revision
     SET revision = revision + 1, scope = TG_TABLE_NAME, updated_at = clock_timestamp()
   WHERE id = 1
     AND (scope IS DISTINCT FROM TG_TABLE_NAME
          OR updated_at < clock_timestamp() - INTERVAL '1 second');
  RETURN NULL;                                   -- AFTER … FOR EACH STATEMENT
END;
$$;

-- ---------------------------------------------------------------------
-- §4 · יומן הביקורת — בלי כפילות לקליטה
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS audit_player_match_stats ON core.player_match_stats;
CREATE TRIGGER audit_player_match_stats
  AFTER INSERT OR DELETE OR UPDATE ON core.player_match_stats
  FOR EACH ROW
  WHEN (auth.uid() IS NOT NULL)          -- אדם בלבד; הקליטה נרשמת ב-core.stat_corrections
  EXECUTE FUNCTION game.audit_row();

-- ---------------------------------------------------------------------
-- §5 · הוספה ידנית — מפוזרת
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS game.admin_add_bots(TEXT, TEXT, INT);
CREATE OR REPLACE FUNCTION game.admin_add_bots(p_gw_code TEXT, p_mode TEXT, p_count INT, p_spread BOOLEAN DEFAULT TRUE)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  v_gw game.gameweeks; v_lg UUID;
  v_added INT := 0; v_skipped INT := 0; v_problems JSONB := '[]'::jsonb;
  r RECORD; v_lid UUID; i INT := 0;
  v_from TIMESTAMPTZ; v_to TIMESTAMPTZ; v_due TIMESTAMPTZ;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF p_mode NOT IN ('five','full') THEN RAISE EXCEPTION 'INVALID_MODE'; END IF;
  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw.id IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND'; END IF;
  SELECT league_id INTO v_lg FROM core.seasons WHERE id = v_gw.season_id;
  PERFORM game.house_ensure_roster(v_lg);

  -- ★ החלון: מעכשיו ועד 6 שעות (או עד 20 דק׳ לפני הנעילה, המוקדם מביניהם).
  v_from := now() + INTERVAL '3 minutes';
  v_to   := LEAST(now() + INTERVAL '6 hours', v_gw.lock_at - INTERVAL '20 minutes');
  IF v_to < v_from THEN v_to := v_from; END IF;

  FOR r IN
    SELECT hp.user_id, hp.slot FROM game.house_players hp
     WHERE hp.league_id = v_lg AND CASE p_mode WHEN 'five' THEN hp.plays_five ELSE hp.plays_full END
       AND NOT EXISTS (SELECT 1 FROM game.user_lineups ul WHERE ul.user_id = hp.user_id
                         AND ul.gameweek_id = v_gw.id AND ul.mode = p_mode
                         AND ul.status IN ('submitted','locked','scored'))
       AND (p_spread IS FALSE OR NOT EXISTS (
             SELECT 1 FROM game.house_schedule hs WHERE hs.gameweek_id = v_gw.id AND hs.mode = p_mode
                AND hs.user_id = hp.user_id AND hs.done_at IS NULL AND hs.problem IS NULL))
     ORDER BY game.house_u(p_gw_code || ':' || p_mode || ':admin:' || hp.slot), hp.slot
     LIMIT GREATEST(1, LEAST(p_count, 15))
  LOOP
    i := i + 1;
    IF p_spread THEN
      v_due := v_from + (v_to - v_from) * game.house_u(p_gw_code || ':' || p_mode || ':due:' || r.user_id::TEXT);
      INSERT INTO game.house_schedule (gameweek_id, mode, user_id, due_at)
      VALUES (v_gw.id, p_mode, r.user_id, v_due)
      ON CONFLICT (gameweek_id, mode, user_id) DO UPDATE
        SET due_at = EXCLUDED.due_at, done_at = NULL, problem = NULL, lineup_id = NULL;
      v_added := v_added + 1;
    ELSE
      BEGIN
        v_lid := game.house_submit(r.user_id, v_gw.id, p_mode);
        INSERT INTO game.house_schedule (gameweek_id, mode, user_id, due_at, done_at, lineup_id)
        VALUES (v_gw.id, p_mode, r.user_id, now(), now(), v_lid)
        ON CONFLICT (gameweek_id, mode, user_id) DO UPDATE
          SET done_at = now(), lineup_id = EXCLUDED.lineup_id, problem = NULL;
        v_added := v_added + 1;
      EXCEPTION WHEN OTHERS THEN
        v_problems := v_problems || jsonb_build_object('bot', i, 'issue', left(SQLERRM, 200));
      END;
    END IF;
  END LOOP;

  -- כמה ביקשו ולא היה מי (כולם כבר בפנים / מתוכננים)
  v_skipped := GREATEST(0, LEAST(p_count, 15) - i);

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (COALESCE(auth.uid()::TEXT, 'admin'), 'admin_add_bots', 'gameweek', p_gw_code,
          jsonb_build_object('mode', p_mode, 'added', v_added, 'skipped', v_skipped, 'spread', p_spread,
                             'until', v_to));
  RETURN jsonb_build_object('added', v_added, 'skipped', v_skipped, 'problems', v_problems,
                            'spread', p_spread, 'until', v_to);
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_add_bots(TEXT, TEXT, INT, BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------------
-- §6 · דוח אחסון
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION game.admin_storage_report()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, core, public, pg_catalog
AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  RETURN jsonb_build_object(
    'databaseBytes', pg_database_size(current_database()),
    'quotaBytes', 500 * 1024 * 1024,
    'tables', (SELECT jsonb_agg(jsonb_build_object('table', t, 'bytes', b) ORDER BY b DESC)
                 FROM (SELECT n.nspname || '.' || c.relname AS t, pg_total_relation_size(c.oid) AS b
                         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                        WHERE c.relkind IN ('r','m') AND n.nspname NOT IN ('pg_catalog','information_schema')
                        ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 10) x),
    'revision', (SELECT revision FROM game.data_revision WHERE id = 1));
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_storage_report() TO authenticated;

INSERT INTO game.schema_migrations (version, note) VALUES
  ('65', 'דופק מחזור (FOMO), מערך מוסתר עד נעילה, חיסכון realtime/יומן, בוטים ידניים מפוזרים, דוח אחסון')
ON CONFLICT (version) DO NOTHING;

COMMIT;
