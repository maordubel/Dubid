-- =====================================================================
--  db/42_ingest_leagues.sql · קליטה לפי ליגה
--
--  מה זה עושה: מאפשר לצינור הקליטה להזין יותר מליגה אחת.
--    · game.ingest_sources — לכל ליגה: מזהה תחרות ב-365scores,
--      קידומת קוד מחזור ('gw-' לישראל, 'gr-' ליוון), ודגל enabled.
--    · ingest_snapshot — מקבל `league` בגוף (ללא = הליגה הראשית,
--      בדיוק כמו קודם). עונה ומחזור נבחרים לפי הליגה.
--    · ingest_tick — פעימה אחת לכל מקור פעיל.
--    · קישור 365scores ל-14 מועדוני סופרליגה יוון (מזהים מאומתים
--      מדף הטבלה של תחרות 84).
--
--  ★ יוון מוזרמת כבויה (enabled = FALSE). הפעלה = החלטה של מאור:
--    game.admin_set_ingest_source('GR_SUPER', TRUE). רק אז ייווצרו
--    מחזורי gr-N, ורק כשמחזור נפתח יופיע בורר הליגות.
--  אידמפוטנטי.
-- =====================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS game.ingest_sources (
  league_id       UUID PRIMARY KEY REFERENCES core.leagues(id),
  gw_prefix       TEXT NOT NULL CHECK (gw_prefix ~ '^[a-z]{2,4}-$'),
  competition_365 INT  NOT NULL,
  enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gw_prefix)
);
DO $rls$ BEGIN
  ALTER TABLE game.ingest_sources ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON game.ingest_sources FROM anon, authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $rls$;

INSERT INTO game.ingest_sources (league_id, gw_prefix, competition_365, enabled)
SELECT l.id, 'gw-', 42, TRUE FROM core.leagues l WHERE l.code = 'IL_PREMIER'
ON CONFLICT (league_id) DO NOTHING;
INSERT INTO game.ingest_sources (league_id, gw_prefix, competition_365, enabled)
SELECT l.id, 'gr-', 84, FALSE FROM core.leagues l WHERE l.code = 'GR_SUPER'
ON CONFLICT (league_id) DO NOTHING;

/* ── קישור קבוצות יוון ל-365scores (מזהים מדף הטבלה, תחרות 84) ── */
DO $link$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      (8563,'1024'),(8239,'1025'),(80654,'1026'),(10187,'1031'),(8675,'1033'),
      (1585,'1066'),(488099,'15266'),(4493,'1034'),(7753,'1032'),(8638,'1023'),
      (8619,'1029'),(10200,'1022'),(162386,'6206'),(885256,'54421')
    ) AS v(fotmob, s365)
  LOOP
    PERFORM core.provider_link('scores365', 'team', r.s365,
      (SELECT e.entity_id FROM core.external_refs e
        WHERE e.entity_type = 'team' AND e.external_id = (20000 + r.fotmob)::TEXT
          AND e.provider = 'manual_json' LIMIT 1));
  END LOOP;
EXCEPTION WHEN not_null_violation THEN
  RAISE NOTICE 'db/42: קבוצות יוון לא נמצאו (db/41 לא רץ?) — דילוג על קישור 365scores';
END $link$;

CREATE OR REPLACE FUNCTION game.admin_set_ingest_source(p_league TEXT, p_enabled BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  UPDATE game.ingest_sources s SET enabled = p_enabled, updated_at = now()
    FROM core.leagues l WHERE l.id = s.league_id AND l.code = p_league;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_LEAGUE'; END IF;
  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (game.actor_label(), 'admin_set_ingest_source', 'league', p_league,
          jsonb_build_object('enabled', p_enabled));
  RETURN jsonb_build_object('league', p_league, 'enabled', p_enabled);
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_set_ingest_source(TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION game.ingest_snapshot(p_source TEXT, p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE
  v_run      UUID;
  v_phase    TEXT := COALESCE(p_payload->>'phase', 'sweep');
  v_number   SMALLINT := NULLIF(p_payload#>>'{gameweek,number}', '')::SMALLINT;
  v_gw       UUID;
  v_code     TEXT;
  v_season   UUID;
  r          JSONB;
  v_home     UUID; v_away UUID; v_team UUID; v_player UUID; v_match UUID;
  v_kick     TIMESTAMPTZ;
  v_status   TEXT;
  v_lock     TIMESTAMPTZ;
  v_gw_status TEXT;
  n_fix      INT := 0;
  n_seen     INT := 0;
  n_mapped   INT := 0;
  n_changed  INT := 0;
  n_unmapped INT := 0;
  v_problems JSONB := '[]'::jsonb;
  v_fp       TEXT;
  v_league   UUID;
  v_prefix   TEXT := 'gw-';
BEGIN
  IF NOT game.can_write_data() THEN RAISE EXCEPTION 'SYSTEM_OR_ADMIN_REQUIRED'; END IF;
  IF NOT COALESCE((SELECT enabled FROM game.ingest_config WHERE id), TRUE) THEN
    RETURN jsonb_build_object('skipped', 'ingest_disabled');
  END IF;
  IF v_number IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NUMBER_REQUIRED'; END IF;

  /* ★ ליגה: ללא `league` בגוף = הליגה הראשית (הוותיקה ביותר), כמו תמיד. */
  SELECT l.id INTO v_league FROM core.leagues l WHERE l.code = p_payload->>'league';
  IF v_league IS NULL THEN
    IF p_payload ? 'league' AND NULLIF(p_payload->>'league','') IS NOT NULL THEN
      RAISE EXCEPTION 'UNKNOWN_LEAGUE';
    END IF;
    SELECT l.id INTO v_league FROM core.leagues l ORDER BY l.created_at, l.code LIMIT 1;
  END IF;
  SELECT COALESCE(s.gw_prefix, 'gw-') INTO v_prefix
    FROM game.ingest_sources s WHERE s.league_id = v_league;
  v_prefix := COALESCE(v_prefix, 'gw-');

  v_code := v_prefix || v_number::TEXT;

  INSERT INTO game.ingest_runs (source, phase, gw_code)
  VALUES (p_source, v_phase, v_code) RETURNING id INTO v_run;

  /* ── הגולמי נשמר לפני שנוגעים בכלום ─────────────────────── */
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'raw', '[]'::jsonb)) LOOP
    INSERT INTO core.ingest_raw (run_id, source, kind, external_id, sha256, payload)
    VALUES (v_run, p_source, COALESCE(r->>'kind','unknown'), r->>'externalId',
            encode(sha256(convert_to((r->'payload')::TEXT, 'UTF8')), 'hex'),
            COALESCE(r->'payload', '{}'::jsonb))
    ON CONFLICT DO NOTHING;
  END LOOP;

  /* ── המחזור: נמצא או נוצר ────────────────────────────────── */
  SELECT id, status INTO v_gw, v_gw_status FROM game.gameweeks WHERE code = v_code;

  IF v_gw IS NULL THEN
    SELECT s.id INTO v_season FROM core.seasons s
     WHERE s.league_id = v_league
     ORDER BY s.is_current DESC, s.starts_on DESC NULLS LAST LIMIT 1;
    IF v_season IS NULL THEN RAISE EXCEPTION 'NO_SEASON'; END IF;

    /* ★ הדדליין לא מומצא. עד שיגיע משחק ראשון הוא רחוק בעתיד,
       בדיוק כמו ב-`admin_create_gameweek`. מחזור שנולד נעול
       הוא מחזור שאף אחד לא יכול להגיש אליו ואיש לא יֵדע למה. */
    INSERT INTO game.gameweeks (season_id, number, code, names, lock_at, first_kickoff_at, status)
    VALUES (v_season, v_number, v_code,
            jsonb_build_object('he', jsonb_build_object('full', 'מחזור ' || v_number),
                               'en', jsonb_build_object('full', 'Gameweek ' || v_number),
                               'el', jsonb_build_object('full', 'Αγωνιστική ' || v_number)),
            now() + INTERVAL '365 days', NULL, 'draft')
    ON CONFLICT (season_id, number) DO UPDATE SET code = EXCLUDED.code
    RETURNING id, status INTO v_gw, v_gw_status;

    INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
    VALUES (game.actor_label(), 'ingest_create_gameweek', 'gameweek', v_code,
            jsonb_build_object('number', v_number, 'source', p_source, 'league', p_payload->>'league'));
  END IF;

  /* ── משחקים ──────────────────────────────────────────────── */
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'fixtures', '[]'::jsonb)) LOOP
    v_home := game.ingest_resolve_team(p_source, r#>>'{home,id}', r#>>'{home,nameEn}', r#>>'{home,nameHe}');
    v_away := game.ingest_resolve_team(p_source, r#>>'{away,id}', r#>>'{away,nameEn}', r#>>'{away,nameHe}');

    IF v_home IS NULL OR v_away IS NULL THEN
      v_problems := v_problems || jsonb_build_object(
        'issue', 'קבוצה לא מופתה', 'home', r#>>'{home,nameEn}', 'away', r#>>'{away,nameEn}');
      CONTINUE;
    END IF;

    v_kick   := NULLIF(r->>'kickoff','')::TIMESTAMPTZ;
    v_status := COALESCE(r->>'status', 'scheduled');
    IF v_status NOT IN ('scheduled','live','finished','postponed','abandoned') THEN
      v_status := 'scheduled';
    END IF;

    INSERT INTO core.weekly_matches
      (gameweek_id, home_team_id, away_team_id, kickoff_at, status, home_goals, away_goals)
    VALUES (v_gw, v_home, v_away, COALESCE(v_kick, now() + INTERVAL '365 days'),
            v_status,
            NULLIF(r->>'homeGoals','')::SMALLINT, NULLIF(r->>'awayGoals','')::SMALLINT)
    ON CONFLICT (gameweek_id, home_team_id, away_team_id) DO UPDATE SET
      /* ★ שעת פתיחה מתעדכנת רק כל עוד אפשר להגיש. אחרי הנעילה
         שינוי שעה הוא שינוי דדליין רטרואקטיבי — כלומר פסילת
         הגשות שהיו חוקיות. */
      kickoff_at = CASE WHEN v_gw_status IN ('draft','open') AND v_kick IS NOT NULL
                        THEN v_kick ELSE core.weekly_matches.kickoff_at END,
      status     = EXCLUDED.status,
      home_goals = COALESCE(EXCLUDED.home_goals, core.weekly_matches.home_goals),
      away_goals = COALESCE(EXCLUDED.away_goals, core.weekly_matches.away_goals)
    RETURNING id INTO v_match;

    IF r->>'providerId' IS NOT NULL THEN
      PERFORM core.provider_link(p_source, 'match', r->>'providerId', v_match, NULL);
    END IF;

    /* משחק שנדחה או נזנח אינו תוצאה. */
    IF v_status IN ('postponed','abandoned') THEN
      INSERT INTO game.ingest_alerts (gw_code, kind, severity, detail)
      VALUES (v_code, 'fixture_not_final', 'block',
              jsonb_build_object('match', r->>'providerId', 'status', v_status))
      ON CONFLICT DO NOTHING;
    END IF;

    n_fix := n_fix + 1;
  END LOOP;

  /* ── דדליין = פתיחת המשחק הראשון ─────────────────────────── */
  IF v_gw_status IN ('draft','open') THEN
    SELECT min(kickoff_at) INTO v_lock FROM core.weekly_matches
     WHERE gameweek_id = v_gw AND status <> 'postponed';

    IF v_lock IS NOT NULL AND v_lock > now() THEN
      UPDATE game.gameweeks
         SET lock_at = v_lock, first_kickoff_at = v_lock
       WHERE id = v_gw AND lock_at IS DISTINCT FROM v_lock;
    END IF;
  END IF;

  /* ── שער נקי נגזר מחדש כשמצב המשחק זז ───────────────────────
     ★ באג שנתפס בבדיקה 5: סטטיסטיקה שנקלטת בזמן אמת נכתבת
       כשהמשחק עדיין 'live', ולכן `clean_sheet` יוצא FALSE.
       אם אחר כך מגיע רק עדכון תוצאה — בלי שורות שחקנים —
       השער הנקי היה נשאר שקרי לנצח, וכל מגן במשחק 0:2 היה
       מפסיד 4 נקודות בשקט.
       החוק אחד, והוא נאכף על כל השורות של המחזור. */
  UPDATE core.player_match_stats s
     SET clean_sheet = (m.status = 'finished' AND s.goals_conceded = 0 AND s.minutes > 0),
         updated_at  = now()
    FROM core.weekly_matches m
   WHERE m.id = s.match_id
     AND m.gameweek_id = v_gw
     AND s.clean_sheet IS DISTINCT FROM
         (m.status = 'finished' AND s.goals_conceded = 0 AND s.minutes > 0);

  /* ── סטטיסטיקה אישית ─────────────────────────────────────── */
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'stats', '[]'::jsonb)) LOOP
    n_seen := n_seen + 1;

    v_match := core.entity_by_provider(p_source, 'match', r->>'matchProviderId');
    IF v_match IS NULL THEN
      v_problems := v_problems || jsonb_build_object(
        'issue', 'משחק לא מופה', 'match', r->>'matchProviderId');
      CONTINUE;
    END IF;

    v_team := game.ingest_resolve_team(p_source, r#>>'{team,id}', r#>>'{team,nameEn}', r#>>'{team,nameHe}');
    IF v_team IS NULL THEN CONTINUE; END IF;

    v_player := game.ingest_resolve_player(
      p_source, r#>>'{player,id}', v_team,
      r#>>'{player,nameEn}', r#>>'{player,nameHe}',
      NULLIF(r#>>'{player,shirt}','')::SMALLINT, r#>>'{player,position}');

    IF v_player IS NULL THEN
      n_unmapped := n_unmapped + 1;
      CONTINUE;
    END IF;

    n_mapped := n_mapped + 1;
    IF core.apply_player_stat(v_match, v_player, v_team, r, game.actor_label(), 'ingest:' || p_source) THEN
      n_changed := n_changed + 1;
    END IF;
  END LOOP;

  /* ★ ריפוי עצמי (A05): התרעת `source_disagreement` של אותו מקור,
     על משחק שהמטען הזה בדק מחדש, נסגרת. אם המחלוקת עדיין קיימת —
     ההתרעה מוזרקת שוב מיד למטה (האינדקס חלקי על cleared_at IS NULL).
     כך התרעה שנוצרה מתקלה זמנית לא חוסמת מחזור לנצח ואין צורך באדמין. */
  WITH healed AS (
    UPDATE game.ingest_alerts a
       SET cleared_at = now(), cleared_by = 'auto:reverified'
     WHERE a.cleared_at IS NULL
       AND a.kind = 'source_disagreement'
       AND a.detail->>'source' = p_source
       AND a.detail->>'match' IN (
             SELECT DISTINCT e->>'matchProviderId'
               FROM jsonb_array_elements(COALESCE(p_payload->'stats','[]'::jsonb)) e)
    RETURNING a.id
  )
  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  SELECT game.actor_label(), 'auto_clear_alert', 'alert', string_agg(id::TEXT, ','),
         jsonb_build_object('reason', 'reverified', 'source', p_source)
    FROM healed HAVING count(*) > 0;

  /* ── התרעות מהמתאם (VAR, כרטיס שבוטל, מקור שנפל) ────────── */
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'alerts', '[]'::jsonb)) LOOP
    INSERT INTO game.ingest_alerts (gw_code, kind, severity, detail)
    VALUES (v_code, COALESCE(r->>'kind','unknown'),
            CASE WHEN r->>'severity' = 'warn' THEN 'warn' ELSE 'block' END,
            COALESCE(r->'detail','{}'::jsonb))
    ON CONFLICT DO NOTHING;
  END LOOP;

  /* ── טביעת אצבע ───────────────────────────────────────────── */
  v_fp := game.gameweek_fingerprint(v_code);

  INSERT INTO game.gameweek_fingerprints (gameweek_id, fingerprint, since, checked_at)
  VALUES (v_gw, v_fp, now(), now())
  ON CONFLICT (gameweek_id) DO UPDATE SET
    since       = CASE WHEN game.gameweek_fingerprints.fingerprint IS DISTINCT FROM EXCLUDED.fingerprint
                       THEN now() ELSE game.gameweek_fingerprints.since END,
    fingerprint = EXCLUDED.fingerprint,
    checked_at  = now();

  /* ★ שינוי אחרי פרסום — לא משנים ניקוד לבד, מתריעים. */
  IF EXISTS (SELECT 1 FROM game.gameweek_fingerprints f
              WHERE f.gameweek_id = v_gw
                AND f.published_fingerprint IS NOT NULL
                AND f.published_fingerprint <> v_fp)
  THEN
    INSERT INTO game.ingest_alerts (gw_code, kind, severity, detail)
    VALUES (v_code, 'changed_after_publish', 'warn',
            jsonb_build_object('fingerprint', v_fp))
    ON CONFLICT DO NOTHING;
  END IF;

  UPDATE game.ingest_runs SET
    finished_at = now(),
    status = CASE WHEN jsonb_array_length(v_problems) > 0 OR n_unmapped > 0
                  THEN 'partial' ELSE 'ok' END,
    fixtures_seen = n_fix, players_seen = n_seen,
    players_mapped = n_mapped, unmapped_count = n_unmapped,
    report = jsonb_build_object('changed', n_changed, 'problems', v_problems,
                                'fingerprint', v_fp)
  WHERE id = v_run;

  RETURN jsonb_build_object(
    'runId', v_run, 'gw', v_code, 'league', v_league, 'phase', v_phase,
    'fixtures', n_fix, 'playersSeen', n_seen, 'playersMapped', n_mapped,
    'unmapped', n_unmapped, 'changed', n_changed,
    'fingerprint', v_fp, 'problems', v_problems);

/* ★ אין כאן `EXCEPTION WHEN OTHERS`.
   בלוק חריגה ב-plpgsql מגלגל אחורה את **כל** עבודת הפונקציה,
   כולל את שורת הכישלון שהוא עצמו מנסה לכתוב. כלומר "רישום
   הכישלון" היה נמחק יחד עם הכישלון. הרישום נעשה מבחוץ, בקריאה
   נפרדת: `game.ingest_log_failure`. */
END;
$$;

/* ── הפעימה: בקשה אחת לכל מקור פעיל ── */
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
    SELECT l.code, i.competition_365, i.gw_prefix,
           (l.created_at = (SELECT min(created_at) FROM core.leagues)) AS is_primary
      FROM game.ingest_sources i JOIN core.leagues l ON l.id = i.league_id
     WHERE i.enabled
     ORDER BY l.created_at, l.code
  LOOP
    BEGIN
      SELECT net.http_post(
               url     := v_url,
               headers := jsonb_build_object(
                            'content-type',   'application/json',
                            'x-ingest-token', v_token),
               body    := jsonb_build_object('phase', 'auto', 'league', s.code,
                                             'competition365', s.competition_365,
                                             'gwPrefix', s.gw_prefix,
                                             'primary', s.is_primary),
               timeout_milliseconds := 55000
             ) INTO v_req;
    EXCEPTION WHEN undefined_function OR undefined_table OR invalid_schema_name THEN
      RETURN jsonb_build_object('skipped', 'pg_net_missing');
    END;

    INSERT INTO game.ingest_dispatches (request_id, origin)
    VALUES (v_req, COALESCE(p_origin, 'cron'))
    ON CONFLICT (request_id) DO NOTHING;

    v_reqs := v_reqs || jsonb_build_object('league', s.code, 'requested', v_req);
  END LOOP;

  RETURN jsonb_build_object('requests', v_reqs, 'at', now());
END;
$$;

INSERT INTO game.schema_migrations (version, note) VALUES ('42', '★ קליטה לפי ליגה: ingest_sources, ingest_snapshot(league), ingest_tick לכל מקור')
ON CONFLICT (version) DO NOTHING;

COMMIT;
