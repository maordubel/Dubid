-- =====================================================================
--  db/57_league_tables.sql · טבלת ליגה ותוצאות — לכל ליגה בנפרד
--
--  הבאג: game.league_table() צברה את **כל** המשחקים בכל הליגות לטבלה אחת
--  (ישראל + אנגליה + ספרד + יוון), ו-public_board() בלי קוד החזירה תמיד את
--  המחזור של הליגה הראשית — גם למשתמש שמשחק ביוון.
--  ובנוסף: טבלה מחושבת מהמשחקים שלנו חלקית מטבעה — המסד מכיר רק מחזורים
--  מאז שהליגה חוברה (אנגליה ממחזור 8). "שוחקו: 2" לצד קבוצה שמשחקה 9 היא
--  טבלה שגויה, לא חסרה.
--
--  התיקון:
--   1. core.league_standings — הטבלה הרשמית של הספק, שורה לכל קבוצה בליגה.
--      נכתבת רק דרך game.ingest_set_standings (זהות מערכת), שמסרבת לכתוב
--      טבלה שלא מופתה במלואה. החלפה אטומית של כל שורות הליגה.
--   2. game.league_standings(p_league) — קריאה ציבורית: {source, updatedAt,
--      rows[]} עם שמות he/en/el וקוד קבוצה. אין טבלה רשמית → rows ריק
--      (המסך מסתיר את המדור), לא טבלה מחושבת חלקית.
--   3. game.league_table() — תואם לאחור, אבל רק הליגה הראשית.
--   4. game.public_board(code) — בלי קוד = הליגה הראשית (כמו קודם); עם קוד =
--      הליגה של אותו מחזור. מחזיר גם `league` ו-`standings` של אותה ליגה,
--      ושמות קבוצה בשלוש שפות.
-- =====================================================================
SET search_path = game, core, public;

BEGIN;

CREATE TABLE IF NOT EXISTS core.league_standings (
  league_id     UUID NOT NULL REFERENCES core.leagues(id) ON DELETE CASCADE,
  team_id       UUID NOT NULL REFERENCES core.teams(id),
  position      SMALLINT NOT NULL CHECK (position > 0),
  played        SMALLINT NOT NULL CHECK (played >= 0),
  won           SMALLINT NOT NULL CHECK (won >= 0),
  drawn         SMALLINT NOT NULL CHECK (drawn >= 0),
  lost          SMALLINT NOT NULL CHECK (lost >= 0),
  goals_for     SMALLINT NOT NULL CHECK (goals_for >= 0),
  goals_against SMALLINT NOT NULL CHECK (goals_against >= 0),
  points        SMALLINT NOT NULL,
  form          TEXT,
  source        TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, team_id)
);
ALTER TABLE core.league_standings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON core.league_standings FROM PUBLIC, anon, authenticated;

/* ── כתיבה: רק מערכת, רק טבלה שלמה ומופתה ─────────────────────────────── */
CREATE OR REPLACE FUNCTION game.ingest_set_standings(
  p_league TEXT, p_source TEXT, p_rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  v_league UUID; v_total INT; v_mapped INT; v_changed BOOLEAN; v_teams INT;
BEGIN
  IF NOT game.can_write_data() THEN RAISE EXCEPTION 'SYSTEM_OR_ADMIN_REQUIRED'; END IF;
  SELECT id INTO v_league FROM core.leagues WHERE code = p_league;
  IF v_league IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'unknown_league'); END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'empty');
  END IF;

  DROP TABLE IF EXISTS _st;
  CREATE TEMP TABLE _st ON COMMIT DROP AS
  SELECT r.entity_id AS team_id,
         (x->>'position')::INT     AS position,
         (x->>'played')::INT       AS played,
         (x->>'won')::INT          AS won,
         (x->>'drawn')::INT        AS drawn,
         (x->>'lost')::INT         AS lost,
         (x->>'goalsFor')::INT     AS goals_for,
         (x->>'goalsAgainst')::INT AS goals_against,
         (x->>'points')::INT       AS points,
         NULLIF(x->>'form', '')    AS form
    FROM jsonb_array_elements(p_rows) x
    LEFT JOIN core.external_refs r
      ON r.provider = p_source AND r.entity_type = 'team'
     AND r.external_id = x->>'teamProviderId';

  SELECT count(*), count(team_id) INTO v_total, v_mapped FROM _st;

  /* ★ טבלה חלקית היא טבלה שגויה. כל שורה חייבת להיות ממופה ותקינה. */
  IF v_mapped < v_total THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'unmapped', 'rows', v_total, 'mapped', v_mapped);
  END IF;
  IF EXISTS (SELECT 1 FROM _st WHERE position IS NULL OR played IS NULL OR points IS NULL
                                   OR won IS NULL OR drawn IS NULL OR lost IS NULL
                                   OR goals_for IS NULL OR goals_against IS NULL
                                   OR won + drawn + lost <> played OR position < 1)
     OR (SELECT count(DISTINCT team_id) FROM _st) <> v_total
     OR (SELECT count(DISTINCT position) FROM _st) <> v_total THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'invalid_rows');
  END IF;

  /* מספר הקבוצות בעונה הנוכחית של הליגה (אם ידוע) חייב להתאים */
  SELECT count(DISTINCT sq.team_id) INTO v_teams
    FROM core.squads sq JOIN core.seasons s ON s.id = sq.season_id
   WHERE s.league_id = v_league AND s.is_current AND sq.valid_to IS NULL;
  IF COALESCE(v_teams, 0) > 0 AND v_teams <> v_total THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'team_count', 'rows', v_total, 'teams', v_teams);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM _st n
     FULL JOIN (SELECT * FROM core.league_standings WHERE league_id = v_league) o
       ON o.team_id = n.team_id
     WHERE o.team_id IS NULL OR n.team_id IS NULL
        OR (o.position, o.played, o.won, o.drawn, o.lost, o.goals_for, o.goals_against, o.points, o.form)
           IS DISTINCT FROM
           (n.position, n.played, n.won, n.drawn, n.lost, n.goals_for, n.goals_against, n.points, n.form))
    INTO v_changed;

  IF NOT v_changed THEN
    RETURN jsonb_build_object('ok', TRUE, 'changed', FALSE, 'rows', v_total);
  END IF;

  DELETE FROM core.league_standings WHERE league_id = v_league;
  INSERT INTO core.league_standings (league_id, team_id, position, played, won, drawn, lost,
                                     goals_for, goals_against, points, form, source, updated_at)
  SELECT v_league, team_id, position, played, won, drawn, lost,
         goals_for, goals_against, points, form, p_source, now()
    FROM _st;

  RETURN jsonb_build_object('ok', TRUE, 'changed', TRUE, 'rows', v_total);
END;
$$;
ALTER FUNCTION game.ingest_set_standings(TEXT, TEXT, JSONB) SET statement_timeout = '30s';
REVOKE ALL ON FUNCTION game.ingest_set_standings(TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION game.ingest_set_standings(TEXT, TEXT, JSONB) TO service_role;

/* שינוי בטבלה → גרסת הנתונים זזה → מסכים פתוחים מתרעננים (מנגנון db/13) */
DROP TRIGGER IF EXISTS bump_data_revision ON core.league_standings;
CREATE TRIGGER bump_data_revision AFTER INSERT OR DELETE OR UPDATE ON core.league_standings
  FOR EACH STATEMENT EXECUTE FUNCTION game.bump_revision();

/* ── קריאה: הטבלה של ליגה אחת ─────────────────────────────────────────── */
CREATE OR REPLACE FUNCTION game.league_standings(p_league TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_league core.leagues; v JSONB;
BEGIN
  IF p_league IS NULL THEN
    SELECT * INTO v_league FROM core.leagues ORDER BY created_at, code LIMIT 1;
  ELSE
    SELECT * INTO v_league FROM core.leagues WHERE code = p_league;
  END IF;
  IF v_league.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  SELECT jsonb_build_object(
    'league',    v_league.code,
    'source',    (SELECT max(source) FROM core.league_standings WHERE league_id = v_league.id),
    'updatedAt', (SELECT max(updated_at) FROM core.league_standings WHERE league_id = v_league.id),
    'rows', COALESCE(jsonb_agg(jsonb_build_object(
        'position',     s.position,
        'team',         core.ext_code('team', s.team_id),
        'names',        jsonb_build_object('he', t.names #>> '{he,full}',
                                           'en', t.names #>> '{en,full}',
                                           'el', t.names #>> '{el,full}'),
        'short',        t.short_code,
        'played',       s.played,
        'won',          s.won,
        'drawn',        s.drawn,
        'lost',         s.lost,
        'goalsFor',     s.goals_for,
        'goalsAgainst', s.goals_against,
        'goalDiff',     s.goals_for - s.goals_against,
        'points',       s.points,
        'form',         s.form) ORDER BY s.position), '[]'::jsonb))
    INTO v
    FROM core.league_standings s
    JOIN core.teams t ON t.id = s.team_id
   WHERE s.league_id = v_league.id;

  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION game.league_standings(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION game.league_standings(TEXT) TO anon, authenticated;

/* ── תאימות לאחור: league_table() — רק הליגה הראשית, לא כל העולם ─────── */
CREATE OR REPLACE FUNCTION game.league_table()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v JSONB; v_league UUID;
BEGIN
  SELECT id INTO v_league FROM core.leagues ORDER BY created_at, code LIMIT 1;

  SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'points')::INT DESC,
                                  (t->>'goalDiff')::INT DESC,
                                  (t->>'goalsFor')::INT DESC,
                                  t->>'nameHe'), '[]'::jsonb)
    INTO v
  FROM (
    SELECT jsonb_build_object(
      'team',     core.ext_code('team', x.team_id),
      'nameHe',   tm.name_he,
      'short',    COALESCE(NULLIF(tm.short_code, ''), tm.name_he),
      'played',   x.played, 'won', x.won, 'drawn', x.drawn, 'lost', x.lost,
      'goalsFor', x.gf, 'goalsAgainst', x.ga, 'goalDiff', x.gf - x.ga,
      'points',   x.won * 3 + x.drawn
    ) AS t
    FROM (
      SELECT r.team_id,
             count(*)                                  AS played,
             count(*) FILTER (WHERE r.result = 'W')    AS won,
             count(*) FILTER (WHERE r.result = 'D')    AS drawn,
             count(*) FILTER (WHERE r.result = 'L')    AS lost,
             COALESCE(sum(r.goals_for), 0)             AS gf,
             COALESCE(sum(r.goals_against), 0)         AS ga
        FROM core.v_team_match_results r
        JOIN game.gameweeks g ON g.id = r.gameweek_id
       WHERE g.league_id = v_league
       GROUP BY r.team_id
    ) x
    JOIN core.teams tm ON tm.id = x.team_id
  ) q;

  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION game.league_table() TO anon, authenticated;

/* ── לוח המחזור — של הליגה של המחזור ───────────────────────────────────── */
CREATE OR REPLACE FUNCTION game.public_board(p_gw_code TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_gw game.gameweeks; v JSONB; v_league core.leagues;
BEGIN
  IF p_gw_code IS NULL THEN
    SELECT g.* INTO v_gw FROM game.gameweeks g
      JOIN core.leagues l ON l.id = g.league_id
     WHERE g.is_current ORDER BY l.created_at, l.code LIMIT 1;
  ELSE
    SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  END IF;

  IF v_gw.id IS NOT NULL THEN
    SELECT * INTO v_league FROM core.leagues WHERE id = v_gw.league_id;
  END IF;
  IF v_league.id IS NULL THEN
    SELECT * INTO v_league FROM core.leagues ORDER BY created_at, code LIMIT 1;
  END IF;

  SELECT jsonb_build_object(
    'league', v_league.code,
    'gameweek', CASE WHEN v_gw.id IS NULL THEN NULL ELSE jsonb_build_object(
      'code',   v_gw.code,
      'number', v_gw.number,
      'label',  v_gw.names #>> '{he,full}',
      'status', v_gw.status,
      'lockAt', v_gw.lock_at,
      'live',   (now() >= v_gw.lock_at AND v_gw.status NOT IN ('published','archived')),
      'entries', (SELECT count(*) FROM game.user_lineups ul
                   WHERE ul.gameweek_id = v_gw.id
                     AND ul.status IN ('submitted','locked','scored'))
    ) END,
    'fixtures', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'home',       core.ext_code('team', m.home_team_id),
               'homeNameHe', h.name_he,
               'homeNames',  jsonb_build_object('he', h.names #>> '{he,full}',
                                                'en', h.names #>> '{en,full}',
                                                'el', h.names #>> '{el,full}'),
               'away',       core.ext_code('team', m.away_team_id),
               'awayNameHe', a.name_he,
               'awayNames',  jsonb_build_object('he', a.names #>> '{he,full}',
                                                'en', a.names #>> '{en,full}',
                                                'el', a.names #>> '{el,full}'),
               'kickoff',   m.kickoff_at,
               'status',    m.status,
               'homeGoals', m.home_goals,
               'awayGoals', m.away_goals) ORDER BY m.kickoff_at)
        FROM core.weekly_matches m
        JOIN core.teams h ON h.id = m.home_team_id
        JOIN core.teams a ON a.id = m.away_team_id
       WHERE m.gameweek_id = v_gw.id), '[]'::jsonb),
    'table', CASE WHEN v_league.id = (SELECT id FROM core.leagues ORDER BY created_at, code LIMIT 1)
                  THEN game.league_table() ELSE '[]'::jsonb END,
    'standings', game.league_standings(v_league.code)
  ) INTO v;

  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION game.public_board(TEXT) TO anon, authenticated;

COMMIT;

INSERT INTO game.schema_migrations (version, note) VALUES
  ('57', '★ טבלת ליגה רשמית לכל ליגה (league_standings), league_table רק לראשית, public_board לפי ליגת המחזור')
ON CONFLICT (version) DO NOTHING;
