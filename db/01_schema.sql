-- =====================================================================
--  דוביד שווייצר · Daily Fantasy · PostgreSQL 15+
--  עקרונות:
--    1. שום דבר לא מקודד-קשיח לליגת העל. ליגה = שורה, לא ענף קוד.
--    2. i18n: JSONB קנוני + עמודות generated לקריאה מהירה + טבלת aliases להתאמת ספקים.
--    3. חוקי ניקוד = דאטה מגורסת (versioned), לא קוד.
--    4. אילוץ "שחקן אחד מכל קבוצה" נאכף ברמת ה-DB, לא רק ב-API.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- gen_random_uuid
CREATE EXTENSION IF NOT EXISTS "pg_trgm";     -- התאמת שמות מטושטשת
CREATE EXTENSION IF NOT EXISTS "unaccent";    -- נרמול לטיני
CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE EXTENSION IF NOT EXISTS "citext";

CREATE SCHEMA IF NOT EXISTS core;   -- דאטה של העולם האמיתי
CREATE SCHEMA IF NOT EXISTS game;   -- דאטה של המשחק שלנו
SET search_path = core, game, public;

-- =====================================================================
-- 0. תשתית i18n
-- =====================================================================

-- כל שם ישות נשמר במבנה אחיד:
--   {"he": {"full":"עומר אצילי","short":"אצילי"},
--    "en": {"full":"Omer Atzili","short":"Atzili"}}
-- שפת ברירת המחדל נגזרת מהליגה; חסר תרגום => fallback ל-en.

-- ★ גם ל-CREATE DOMAIN אין IF NOT EXISTS.
DO $do$ BEGIN
  CREATE DOMAIN core.i18n_name AS JSONB
    CHECK (
      VALUE IS NULL                                -- עמודות nullable מותרות
      OR (
        jsonb_typeof(VALUE) = 'object'
        AND VALUE ? 'en'                           -- אנגלית תמיד חובה (עוגן)
        AND (VALUE #>> '{en,full}') IS NOT NULL
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- נרמול שם עברי/לטיני לצורך מפתח חיפוש והתאמה בין ספקים.
-- שימו לב: unaccent(text) הוא STABLE ולכן אסור בעמודה GENERATED.
-- הצורה הדו-ארגומנטית unaccent(regdictionary, text) היא IMMUTABLE - בה משתמשים.
CREATE OR REPLACE FUNCTION core.normalize_name(txt TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT NULLIF(
    trim(regexp_replace(
      lower(
        translate(
          -- 1) unaccent לטיני  2) הסרת ניקוד עברי  3) הסרת גרש/גרשיים
          regexp_replace(
            regexp_replace(
              public.unaccent('public.unaccent'::regdictionary, txt),
              '[֑-ׇ]', '', 'g'
            ),
            '[״"''`׳’“”]', '', 'g'
          ),
          -- 4) מקפים -> רווח
          '־-–—', '    '
        )
      ),
      '\s+', ' ', 'g'
    )), '');
$$;

-- דוגמאות: normalize_name('מ.ס. אשדוד') -> 'מ.ס. אשדוד'
--          normalize_name('Omer  Atzili') -> 'omer atzili'

-- =====================================================================
-- 1. ליגות ועונות
-- =====================================================================

CREATE TABLE IF NOT EXISTS core.leagues (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                TEXT NOT NULL UNIQUE,          -- 'IL_PREMIER', 'EN_PL'
  country_code        CHAR(2) NOT NULL,              -- ISO-3166 'IL'
  default_locale      TEXT NOT NULL DEFAULT 'he',    -- 'he' | 'en' | ...
  text_direction      TEXT NOT NULL DEFAULT 'rtl' CHECK (text_direction IN ('rtl','ltr')),
  timezone            TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
  names               core.i18n_name NOT NULL,
  squad_size          SMALLINT NOT NULL DEFAULT 11,  -- כמה שחקנים בהרכב פנטזי
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON COLUMN core.leagues.squad_size IS
  'גודל ההרכב הפנטזי. ליגה זרה עם חוקים אחרים = שינוי ערך, לא שינוי קוד.';

CREATE TABLE IF NOT EXISTS core.seasons (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id     UUID NOT NULL REFERENCES core.leagues(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,                        -- '2026/27'
  starts_on     DATE NOT NULL,
  ends_on       DATE NOT NULL,
  is_current    BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (league_id, label),
  CHECK (ends_on > starts_on)
);
-- עונה נוכחית אחת לכל ליגה
CREATE UNIQUE INDEX IF NOT EXISTS seasons_one_current_per_league
  ON core.seasons (league_id) WHERE is_current;

-- =====================================================================
-- 2. קבוצות ושחקנים
-- =====================================================================

CREATE TABLE IF NOT EXISTS core.teams (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code    CHAR(2) NOT NULL,
  names           core.i18n_name NOT NULL,
  short_code      TEXT,                                -- 'MHA', 'HTA'
  crest_url       TEXT,
  primary_color   TEXT,
  founded_year    SMALLINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- עמודות נגזרות לחיפוש מהיר; אין כפילות נתונים - הן generated
  name_he         TEXT GENERATED ALWAYS AS (names #>> '{he,full}') STORED,
  name_en         TEXT GENERATED ALWAYS AS (names #>> '{en,full}') STORED
);
CREATE INDEX IF NOT EXISTS teams_name_he_trgm ON core.teams USING gin (name_he gin_trgm_ops);
CREATE INDEX IF NOT EXISTS teams_name_en_trgm ON core.teams USING gin (name_en gin_trgm_ops);
CREATE INDEX IF NOT EXISTS teams_names_gin    ON core.teams USING gin (names jsonb_path_ops);

-- קבוצה משתתפת בליגה בעונה מסוימת (עלייה/ירידה מטופלת כאן)
CREATE TABLE IF NOT EXISTS core.team_seasons (
  team_id    UUID NOT NULL REFERENCES core.teams(id)   ON DELETE CASCADE,
  season_id  UUID NOT NULL REFERENCES core.seasons(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, season_id)
);

-- ★ ל-CREATE TYPE אין IF NOT EXISTS. בלי המעטפת הזו הרצה שנייה
--   של הקובץ נופלת ב-"type already exists", וכל מה שמתחתיה
--   לא רץ. הקובץ מוצהר כאידמפוטנטי — שיהיה.
DO $do$ BEGIN
  CREATE TYPE core.position AS ENUM ('GK','DEF','MID','FWD');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

CREATE TABLE IF NOT EXISTS core.players (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  names             core.i18n_name NOT NULL,
  birth_date        DATE,
  nationality       CHAR(2),
  primary_position  core.position,
  preferred_foot    TEXT CHECK (preferred_foot IN ('left','right','both')),
  photo_url         TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  name_he           TEXT GENERATED ALWAYS AS (names #>> '{he,full}') STORED,
  name_en           TEXT GENERATED ALWAYS AS (names #>> '{en,full}') STORED,
  -- מפתח דה-דופליקציה: שם לטיני מנורמל + שנת לידה
  -- (birth_date::TEXT אינו IMMUTABLE כי הוא תלוי DateStyle - לכן EXTRACT)
  dedupe_key        TEXT GENERATED ALWAYS AS
                      (core.normalize_name(names #>> '{en,full}') || '|' ||
                       COALESCE((EXTRACT(YEAR FROM birth_date))::TEXT, '?')) STORED
);
CREATE INDEX IF NOT EXISTS players_name_he_trgm ON core.players USING gin (name_he gin_trgm_ops);
CREATE INDEX IF NOT EXISTS players_name_en_trgm ON core.players USING gin (name_en gin_trgm_ops);
CREATE INDEX IF NOT EXISTS players_dedupe       ON core.players (dedupe_key);

-- כינויים/כתיבים חלופיים. זה מה שמציל אתכם כשספק אחד כותב
-- "Omer Atzili" והשני "Omer Acili", או "מכבי ת״א" מול "מכבי תל אביב".
CREATE TABLE IF NOT EXISTS core.entity_aliases (
  id           BIGSERIAL PRIMARY KEY,
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('player','team','league')),
  entity_id    UUID NOT NULL,
  locale       TEXT NOT NULL,                 -- 'he','en','ar','ru'
  alias        TEXT NOT NULL,
  alias_norm   TEXT GENERATED ALWAYS AS (core.normalize_name(alias)) STORED,
  source       TEXT,                          -- 'api_football','manual','opta'
  UNIQUE (entity_type, entity_id, locale, alias)
);
CREATE INDEX IF NOT EXISTS entity_aliases_norm_trgm ON core.entity_aliases USING gin (alias_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS entity_aliases_lookup    ON core.entity_aliases (entity_type, alias_norm);

-- מיפוי מזהים חיצוניים: מפריד בין המודל שלנו לבין כל ספק דאטה.
CREATE TABLE IF NOT EXISTS core.external_refs (
  provider      TEXT NOT NULL,                 -- 'api_football'
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('league','season','team','player','match')),
  external_id   TEXT NOT NULL,
  entity_id     UUID NOT NULL,
  payload       JSONB,                         -- raw אחרון, לדיבוג
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, entity_type, external_id)
);
CREATE INDEX IF NOT EXISTS external_refs_entity ON core.external_refs (entity_type, entity_id);

-- =====================================================================
-- 3. סגלים (Squads)
-- =====================================================================

CREATE TABLE IF NOT EXISTS core.squads (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id      UUID NOT NULL REFERENCES core.seasons(id) ON DELETE CASCADE,
  team_id        UUID NOT NULL REFERENCES core.teams(id)   ON DELETE CASCADE,
  player_id      UUID NOT NULL REFERENCES core.players(id) ON DELETE CASCADE,
  shirt_number   SMALLINT CHECK (shirt_number BETWEEN 1 AND 99),
  position       core.position NOT NULL,
  market_value   NUMERIC(12,2),
  fantasy_price  NUMERIC(6,2),                 -- מחיר בפנטזי, אם תרצו תקציב
  valid_from     DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to       DATE,                         -- NULL = בסגל כרגע
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','injured','suspended','loaned_out','left')),
  UNIQUE (season_id, team_id, player_id, valid_from)
);
-- שחקן לא יכול להיות בשתי קבוצות באותה עונה בו-זמנית
CREATE INDEX IF NOT EXISTS squads_active ON core.squads (season_id, team_id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS squads_player ON core.squads (player_id);

-- =====================================================================
-- 4. מחזורים ומשחקים
-- =====================================================================

CREATE TABLE IF NOT EXISTS game.gameweeks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id   UUID NOT NULL REFERENCES core.seasons(id) ON DELETE CASCADE,
  number      SMALLINT NOT NULL,
  names       core.i18n_name,                  -- 'מחזור 7' / 'Gameweek 7'
  lock_at     TIMESTAMPTZ NOT NULL,            -- נעילת הרכבים = פתיחת המשחק הראשון
  status      TEXT NOT NULL DEFAULT 'upcoming'
              CHECK (status IN ('upcoming','open','locked','live','settled')),
  UNIQUE (season_id, number)
);

CREATE TABLE IF NOT EXISTS core.weekly_matches (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gameweek_id    UUID NOT NULL REFERENCES game.gameweeks(id) ON DELETE CASCADE,
  home_team_id   UUID NOT NULL REFERENCES core.teams(id),
  away_team_id   UUID NOT NULL REFERENCES core.teams(id),
  kickoff_at     TIMESTAMPTZ NOT NULL,
  venue          TEXT,
  status         TEXT NOT NULL DEFAULT 'scheduled'
                 CHECK (status IN ('scheduled','live','finished','postponed','abandoned')),
  home_goals     SMALLINT,
  away_goals     SMALLINT,
  CHECK (home_team_id <> away_team_id),
  UNIQUE (gameweek_id, home_team_id, away_team_id)
);
CREATE INDEX IF NOT EXISTS weekly_matches_gw ON core.weekly_matches (gameweek_id, kickoff_at);

-- תוצאה מנקודת מבט של קבוצה - מייתר CASE כפול בכל שאילתה
-- ★ `DROP` ולא `CREATE OR REPLACE`.
--
--   PostgreSQL לא מרשה ל-`CREATE OR REPLACE VIEW` לשנות את
--   רשימת העמודות — רק להוסיף בסוף. מיגרציה מאוחרת שהרחיבה
--   תצוגה, ואז הרצה חוזרת של המיגרציה המוקדמת שמצמצמת אותה
--   בחזרה, נופלת על:
--
--       ERROR: 42P16: cannot drop columns from view
--
--   וזה קורה בפועל: הקבצים אידמפוטנטיים, ולכן טבעי להריץ אותם
--   שוב בסדר כלשהו. `DROP` הופך את הסדר ללא רלוונטי.
DROP VIEW IF EXISTS core.v_team_match_results;
CREATE VIEW core.v_team_match_results AS
SELECT m.id AS match_id, m.gameweek_id, m.status,
       m.home_team_id AS team_id, m.away_team_id AS opponent_id,
       m.home_goals AS goals_for, m.away_goals AS goals_against,
       CASE WHEN m.home_goals > m.away_goals THEN 'W'
            WHEN m.home_goals = m.away_goals THEN 'D' ELSE 'L' END AS result
FROM core.weekly_matches m WHERE m.status = 'finished'
UNION ALL
SELECT m.id, m.gameweek_id, m.status,
       m.away_team_id, m.home_team_id, m.away_goals, m.home_goals,
       CASE WHEN m.away_goals > m.home_goals THEN 'W'
            WHEN m.away_goals = m.home_goals THEN 'D' ELSE 'L' END
FROM core.weekly_matches m WHERE m.status = 'finished';

-- סטטיסטיקות אישיות למשחק. זה מקור האמת לניקוד.
CREATE TABLE IF NOT EXISTS core.player_match_stats (
  match_id        UUID NOT NULL REFERENCES core.weekly_matches(id) ON DELETE CASCADE,
  player_id       UUID NOT NULL REFERENCES core.players(id)        ON DELETE CASCADE,
  team_id         UUID NOT NULL REFERENCES core.teams(id),
  minutes         SMALLINT NOT NULL DEFAULT 0,
  started         BOOLEAN NOT NULL DEFAULT FALSE,
  goals           SMALLINT NOT NULL DEFAULT 0,
  assists         SMALLINT NOT NULL DEFAULT 0,
  own_goals       SMALLINT NOT NULL DEFAULT 0,
  yellow_cards    SMALLINT NOT NULL DEFAULT 0,
  red_cards       SMALLINT NOT NULL DEFAULT 0,
  saves           SMALLINT NOT NULL DEFAULT 0,
  penalties_saved SMALLINT NOT NULL DEFAULT 0,
  penalties_missed SMALLINT NOT NULL DEFAULT 0,
  goals_conceded  SMALLINT NOT NULL DEFAULT 0,
  clean_sheet     BOOLEAN NOT NULL DEFAULT FALSE,
  extra           JSONB NOT NULL DEFAULT '{}'::jsonb,  -- xG, dribbles, מה שיבוא
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, player_id)
);
CREATE INDEX IF NOT EXISTS pms_player ON core.player_match_stats (player_id);

-- =====================================================================
-- 5. חוקי ניקוד — דאטה, לא קוד
-- =====================================================================

CREATE TABLE IF NOT EXISTS game.scoring_rulesets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id    UUID REFERENCES core.leagues(id) ON DELETE CASCADE, -- NULL = גלובלי
  version      INT NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  rules        JSONB NOT NULL,
  UNIQUE (league_id, version)
);
COMMENT ON TABLE game.scoring_rulesets IS
$$דוגמה ל-rules:
{
  "personal": {
    "goal":        {"GK":10,"DEF":8,"MID":6,"FWD":5},
    "assist":      3,
    "clean_sheet": {"GK":5,"DEF":4,"MID":1,"FWD":0},
    "minutes_60":  2,
    "yellow":     -1, "red": -3, "own_goal": -2,
    "save_per_3":  1, "penalty_saved": 5, "penalty_missed": -2,
    "goals_conceded_per_2": {"GK":-1,"DEF":-1}
  },
  "result_bonus": {"W": 4, "D": 1, "L": 0},
  "virtual_goal": {"team_goals_per_virtual": 2, "points": 5},
  "captain_multiplier": 2,
  "constraints": {"lineup_size": 11, "max_players_per_team": 1}
}
שינוי חוקים = גרסה חדשה. ניקוד היסטורי לא משתנה למפרע.$$;

-- =====================================================================
-- 6. משתמשים והרכבים
-- =====================================================================

CREATE TABLE IF NOT EXISTS game.users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         CITEXT,
  display_name  TEXT NOT NULL,
  locale        TEXT NOT NULL DEFAULT 'he',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game.user_lineups (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES game.users(id) ON DELETE CASCADE,
  gameweek_id        UUID NOT NULL REFERENCES game.gameweeks(id) ON DELETE CASCADE,
  formation          TEXT NOT NULL DEFAULT '4-3-3',
  captain_player_id  UUID REFERENCES core.players(id),
  status             TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','submitted','locked','scored')),
  submitted_at       TIMESTAMPTZ,
  scoring_ruleset_id UUID REFERENCES game.scoring_rulesets(id), -- ננעל ברגע הנעילה
  UNIQUE (user_id, gameweek_id)          -- הרכב אחד למשתמש למחזור
);

CREATE TABLE IF NOT EXISTS game.user_lineup_slots (
  lineup_id   UUID NOT NULL REFERENCES game.user_lineups(id) ON DELETE CASCADE,
  slot_no     SMALLINT NOT NULL CHECK (slot_no BETWEEN 1 AND 15),
  player_id   UUID NOT NULL REFERENCES core.players(id),
  -- snapshot של הקבוצה ברגע ההגשה: הסגל עשוי להשתנות, ההרכב לא
  team_id     UUID NOT NULL REFERENCES core.teams(id),
  position    core.position NOT NULL,
  is_bench    BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (lineup_id, slot_no),

  -- ★ האילוץ המרכזי: שחקן אחד לכל היותר מכל קבוצה, בתוך אותו הרכב
  CONSTRAINT one_player_per_team UNIQUE (lineup_id, team_id),
  CONSTRAINT no_duplicate_player UNIQUE (lineup_id, player_id)
);

-- אכיפת גודל הרכב (11 מהליגה) ברגע ההגשה, לא בכל INSERT
CREATE OR REPLACE FUNCTION game.assert_lineup_valid(p_lineup_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_required SMALLINT;
  v_actual   SMALLINT;
  v_teams    SMALLINT;
BEGIN
  SELECT l.squad_size INTO v_required
  FROM game.user_lineups ul
  JOIN game.gameweeks gw ON gw.id = ul.gameweek_id
  JOIN core.seasons  s  ON s.id  = gw.season_id
  JOIN core.leagues  l  ON l.id  = s.league_id
  WHERE ul.id = p_lineup_id;

  SELECT count(*), count(DISTINCT team_id) INTO v_actual, v_teams
  FROM game.user_lineup_slots WHERE lineup_id = p_lineup_id AND NOT is_bench;

  IF v_actual <> v_required THEN
    RAISE EXCEPTION 'LINEUP_SIZE_INVALID: expected %, got %', v_required, v_actual
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_teams <> v_actual THEN
    RAISE EXCEPTION 'DISTINCT_TEAM_CONSTRAINT_VIOLATED: % players from % teams', v_actual, v_teams
      USING ERRCODE = 'check_violation';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION game.trg_validate_on_submit() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('submitted','locked') AND
     (OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM game.assert_lineup_valid(NEW.id);
  END IF;
  RETURN NEW;
END $$;

-- ל-CREATE TRIGGER אין IF NOT EXISTS. DROP קודם — אותו דפוס
-- שכבר קיים ב-db/04.
DROP TRIGGER IF EXISTS user_lineups_validate ON game.user_lineups;
CREATE TRIGGER user_lineups_validate
  BEFORE UPDATE ON game.user_lineups
  FOR EACH ROW EXECUTE FUNCTION game.trg_validate_on_submit();

-- =====================================================================
-- 7. תוצאות ניקוד
-- =====================================================================

CREATE TABLE IF NOT EXISTS game.lineup_scores (
  lineup_id       UUID PRIMARY KEY REFERENCES game.user_lineups(id) ON DELETE CASCADE,
  gameweek_id     UUID NOT NULL REFERENCES game.gameweeks(id) ON DELETE CASCADE,
  personal_points NUMERIC(8,2) NOT NULL DEFAULT 0,
  result_points   NUMERIC(8,2) NOT NULL DEFAULT 0,
  virtual_points  NUMERIC(8,2) NOT NULL DEFAULT 0,
  total_points    NUMERIC(8,2) NOT NULL DEFAULT 0,
  breakdown       JSONB NOT NULL DEFAULT '{}'::jsonb,  -- פירוט לכל שחקן, לתצוגה
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ruleset_id      UUID REFERENCES game.scoring_rulesets(id)
);
CREATE INDEX IF NOT EXISTS lineup_scores_leaderboard ON game.lineup_scores (gameweek_id, total_points DESC);

-- =====================================================================
-- 8. שאילתת עזר: סגל פעיל עם שמות בשתי השפות
-- =====================================================================
-- ★ `DROP` ולא `CREATE OR REPLACE`.
--
--   PostgreSQL לא מרשה ל-`CREATE OR REPLACE VIEW` לשנות את
--   רשימת העמודות — רק להוסיף בסוף. מיגרציה מאוחרת שהרחיבה
--   תצוגה, ואז הרצה חוזרת של המיגרציה המוקדמת שמצמצמת אותה
--   בחזרה, נופלת על:
--
--       ERROR: 42P16: cannot drop columns from view
--
--   וזה קורה בפועל: הקבצים אידמפוטנטיים, ולכן טבעי להריץ אותם
--   שוב בסדר כלשהו. `DROP` הופך את הסדר ללא רלוונטי.
DROP VIEW IF EXISTS core.v_active_squads;
CREATE VIEW core.v_active_squads AS
SELECT s.season_id, s.team_id,
       t.names #>> '{he,full}' AS team_he,
       t.names #>> '{en,full}' AS team_en,
       p.id AS player_id,
       COALESCE(p.names #>> '{he,full}', p.names #>> '{en,full}') AS player_he,
       p.names #>> '{en,full}' AS player_en,
       s.shirt_number, s.position, s.status
FROM core.squads s
JOIN core.teams   t ON t.id = s.team_id
JOIN core.players p ON p.id = s.player_id
WHERE s.valid_to IS NULL;
