-- =====================================================================
--  db/66_honest_counts_next_round.sql — מונים שאומרים מה הם סופרים (H01)
--                                       + המחזור הבא באותה עונה בלבד (H05)
-- =====================================================================
--  H01 · עד עכשיו: "{n} managers already in" ספר *הרכבים* (משתמש שהגיש בשני
--        המצבים נספר פעמיים) וכלל משתתפי בית. "players" בשער ספר הרכבים, ובלובי
--        ספר משתמשים ייחודיים. שלושה מספרים, שלוש הגדרות, תווית אחת.
--        עכשיו ההגדרות אחידות (docs/LAUNCH-RUNBOOK.md §"מונים"):
--          managers = זהויות ייחודיות (user_id) עם הגשה תקפה
--          lineups  = שורות הגשה תקפות (משתמש בשני המצבים = 2)
--          הגשה תקפה = status IN ('submitted','locked','scored') — טיוטה לא נספרת;
--          הגשה שנמשכה חוזרת ל-draft/נמחקת ולכן יוצאת מהמונה.
--        ★ החלטת בעלים (27.10): בציבור אין הבחנה בין משתתפי בית לאחרים —
--          כל משתתף נספר ומוצג אותו דבר. הפיצול אנושי/בית קיים רק באדמין
--          (admin_leagues_overview, admin_house_report).
--        תאימות לאחור: total/five/full/last24h/lastHour/recent נשארים כמו שהם
--        (ספירת הרכבים); נוספו schemaVersion=2, overall, byMode, window24h.
--        gameweek_state / leagues_public: נוספו managers + lineups (entrants נשאר).
--  H05 · next_round: רק מאותה עונה. סוף עונה = NULL ("לא הוכרז"), לא קפיצה
--        שקטה למחזור של עונה אחרת בגלל מספר גדול יותר.
--  ללא שינוי חוקים, ניקוד או נתונים.
-- =====================================================================
BEGIN;
SET search_path = game, core, public;

-- ---------------------------------------------------------------------
-- §1 · ספירה אחת, הגדרה אחת
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION game.round_counts(p_gameweek_id UUID, p_mode TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
  WITH e AS (
    SELECT ul.user_id
      FROM game.user_lineups ul
     WHERE ul.gameweek_id = p_gameweek_id
       AND ul.status IN ('submitted','locked','scored')
       AND (p_mode IS NULL OR ul.mode = p_mode)
  )
  SELECT jsonb_build_object(
    'managers', count(DISTINCT user_id),
    'lineups',  count(*))
  FROM e;
$$;
REVOKE ALL ON FUNCTION game.round_counts(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- §2 · round_pulse v2 (תואם לאחור)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION game.round_pulse(p_gw_code TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
  WITH g AS (SELECT id, code, lock_at FROM game.gameweeks WHERE code = p_gw_code),
  e AS (
    SELECT ul.user_id, ul.mode, ul.submitted_at, ul.team_name, u.display_name
      FROM game.user_lineups ul
      JOIN g ON g.id = ul.gameweek_id
      LEFT JOIN game.users u ON u.id = ul.user_id
     WHERE ul.status IN ('submitted','locked','scored')
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM g) THEN NULL ELSE jsonb_build_object(
    'schemaVersion', 2,
    'code', p_gw_code,
    -- ★ v1 (הרכבים) — לקוחות ישנים
    'total', (SELECT count(*) FROM e),
    'five',  (SELECT count(*) FROM e WHERE mode = 'five'),
    'full',  (SELECT count(*) FROM e WHERE mode = 'full'),
    'last24h', (SELECT count(*) FROM e WHERE submitted_at > now() - INTERVAL '24 hours'),
    'lastHour', (SELECT count(*) FROM e WHERE submitted_at > now() - INTERVAL '1 hour'),
    -- ★ v2
    'overall', game.round_counts((SELECT id FROM g), NULL),
    'byMode', jsonb_build_object(
      'five', game.round_counts((SELECT id FROM g), 'five'),
      'full', game.round_counts((SELECT id FROM g), 'full')),
    'window24h', jsonb_build_object(
      'managers', (SELECT count(DISTINCT user_id) FROM e WHERE submitted_at > now() - INTERVAL '24 hours'),
      'lineups',  (SELECT count(*) FROM e WHERE submitted_at > now() - INTERVAL '24 hours')),
    'recent', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'name', COALESCE(NULLIF(btrim(x.team_name), ''), NULLIF(btrim(x.display_name), '')),
               'mode', x.mode,
               'at', to_char(x.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
               'submittedAt', to_char(x.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
             ORDER BY x.submitted_at DESC)
        FROM (SELECT * FROM e WHERE COALESCE(NULLIF(btrim(team_name), ''), NULLIF(btrim(display_name), '')) IS NOT NULL
               ORDER BY submitted_at DESC LIMIT 4) x), '[]'::jsonb),
    'at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  ) END;
$$;
GRANT EXECUTE ON FUNCTION game.round_pulse(TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- §3 · gameweek_state + leagues_public: managers/lineups לצד entrants
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION game.gameweek_state(p_gw_code TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
  SELECT jsonb_build_object(
    'code',           gw.code,
    'number',         gw.number,
    'status',         gw.status,
    'lockAt',         to_char(gw.lock_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'firstKickoffAt', to_char(COALESCE(gw.first_kickoff_at, gw.lock_at) AT TIME ZONE 'UTC',
                              'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'serverNow',      (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT,
    'entrants',       (SELECT count(DISTINCT user_id) FROM game.user_lineups
                        WHERE gameweek_id = gw.id AND status <> 'draft'),
    'managers',       (c->>'managers')::INT,
    'lineups',        (c->>'lineups')::INT,
    'locked',         (now() >= gw.lock_at),
    'published',      (gw.status = 'published'),
    'fixturesTotal',  (SELECT count(*) FROM core.weekly_matches m
                        WHERE m.gameweek_id = gw.id),
    'fixturesFinal',  (SELECT count(*) FROM core.weekly_matches m
                        WHERE m.gameweek_id = gw.id AND m.status = 'finished'),
    'fixturesLive',   (SELECT count(*) FROM core.weekly_matches m
                        WHERE m.gameweek_id = gw.id AND m.status = 'live'),
    'lastEventAt',    to_char(game.gameweek_last_event(gw.id) AT TIME ZONE 'UTC',
                              'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  )
  FROM game.gameweeks gw
  CROSS JOIN LATERAL game.round_counts(gw.id, NULL) c
  WHERE gw.code = p_gw_code;
$$;
GRANT EXECUTE ON FUNCTION game.gameweek_state(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION game.leagues_public()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'primary') DESC, x->>'code'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'code',     l.code,
      'country',  l.country_code,
      'locale',   l.default_locale,
      'dir',      l.text_direction,
      'timezone', l.timezone,
      'names',    l.names,
      'primary',  (l.id = (SELECT id FROM core.leagues ORDER BY created_at, code LIMIT 1)),
      'currentGameweek', cur.code,
      'live',     (cur.code IS NOT NULL),
      'round',    cur.number,
      'status',   cur.status,
      'lockAt',   to_char(cur.lock_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'entrants', CASE WHEN cur.id IS NULL THEN 0 ELSE
                    (SELECT count(*) FROM game.user_lineups ul
                      WHERE ul.gameweek_id = cur.id AND ul.status <> 'draft') END,
      'lineups',  CASE WHEN cur.id IS NULL THEN 0 ELSE (game.round_counts(cur.id, NULL)->>'lineups')::INT END,
      'managers', CASE WHEN cur.id IS NULL THEN 0 ELSE (game.round_counts(cur.id, NULL)->>'managers')::INT END,
      'formats',  CASE WHEN cur.id IS NULL THEN NULL ELSE jsonb_build_object(
                    'five', game.format_readiness(cur.id, 'five'),
                    'full', game.format_readiness(cur.id, 'full')) END
    ) AS x
    FROM core.leagues l
    LEFT JOIN LATERAL (SELECT gw.id, gw.code, gw.number, gw.status, gw.lock_at
                         FROM game.gameweeks gw
                        WHERE gw.league_id = l.id AND gw.is_current
                        LIMIT 1) cur ON TRUE
   WHERE l.is_active
     AND (cur.id IS NOT NULL
          OR EXISTS (SELECT 1 FROM game.ingest_sources s
                      WHERE s.league_id = l.id AND s.enabled))
  ) q;
$$;
GRANT EXECUTE ON FUNCTION game.leagues_public() TO anon, authenticated;

-- ---------------------------------------------------------------------
-- §4 · next_round — אותה עונה בלבד (H05)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION game.next_round(p_gw_code TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
  SELECT jsonb_build_object(
           'code', n.code, 'number', n.number, 'status', n.status,
           'lockAt', n.lock_at, 'firstKickoffAt', n.first_kickoff_at,
           'seasonId', n.season_id,
           'fixturesTotal', (SELECT count(*) FROM core.weekly_matches m WHERE m.gameweek_id = n.id))
    FROM game.gameweeks c
    JOIN LATERAL (
      SELECT g.* FROM game.gameweeks g
       WHERE g.season_id = c.season_id
         AND g.number > c.number
         AND g.lock_at > c.lock_at
         AND g.status NOT IN ('published','archived')
       ORDER BY g.number, g.lock_at
       LIMIT 1) n ON TRUE
   WHERE c.code = p_gw_code;
$$;
GRANT EXECUTE ON FUNCTION game.next_round(TEXT) TO anon, authenticated;

INSERT INTO game.schema_migrations (version, note) VALUES
  ('66', 'מונים מוגדרים (managers/lineups), next_round באותה עונה')
ON CONFLICT (version) DO NOTHING;

COMMIT;
