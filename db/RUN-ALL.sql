-- =====================================================================
--  DUBID · הכל בקובץ אחד
--
--  ★ נוצר אוטומטית על ידי scripts/build-all-sql.mjs — לא לערוך.
--    לשינוי: לערוך את הקובץ המקורי תחת db/ ולהריץ את הסקריפט.
--
--  ═══════════════════════════════════════════════════════════════
--  איך מריצים
--  ═══════════════════════════════════════════════════════════════
--
--    1. Supabase → SQL Editor → New query
--    2. להדביק את **כל** הקובץ הזה
--    3. Run
--
--  זהו. אין סדר לטעות בו, ואפשר להריץ שוב כמה פעמים שרוצים.
--
--  ⚠ לוקח כ-10–30 שניות. אם העורך נתקע — לרענן ולהריץ שוב;
--    כל שלב מוגן ולא ייכשל על מה שכבר קיים.
--
--  ═══════════════════════════════════════════════════════════════
--  אחרי ההרצה — שלוש שאילתות שאומרות אם הכל תקין
--  ═══════════════════════════════════════════════════════════════
--
--    SELECT * FROM game.v_health;
--      → teams 14 · players 351 · matches 7 · id_mappings 366
--
--    SELECT * FROM game.v_arena_health;
--      → players_without_price = 0
--
--    SELECT * FROM game.v_admin_health;
--      → secrets = 1
--
--  ⚠ ואז, פעם אחת, בלוח הבקרה:
--    Settings → API → Exposed schemas →  public, core, game, shared
--    Authentication → Providers → Anonymous sign-ins →  להדליק
--
--    בלי שני אלה, המסד מוכן והאפליקציה עדיין לא תתחבר.
-- =====================================================================


-- =====================================================================
-- ▼▼▼  01_schema.sql  —  ליבה — ליגות, קבוצות, שחקנים, מחזורים
-- =====================================================================

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


-- =====================================================================
-- ▼▼▼  02_dubid_captain.sql  —  קפטן וסגן + פונקציות ניקוד
-- =====================================================================

-- =====================================================================
--  Dubid · מיגרציה 02 — הקפטן הדובידי, הדירוג, וה-RPC למנוע הניקוד
--  מריצים אחרי 01_schema.sql
-- =====================================================================

SET search_path = core, game, public;

-- ---------------------------------------------------------------------
-- 1. קפטן וסגן ברמת המשבצת (ולא כעמודה בודדת על ההרכב)
--    למה: הקפטן הוא תכונה של *הבחירה*, ומשם נגזרות שתי אכיפות
--    שאי אפשר לעשות עם captain_player_id: קפטן אחד בדיוק, וסגן
--    שהוא בהכרח שחקן שנמצא בהרכב.
-- ---------------------------------------------------------------------
ALTER TABLE game.user_lineup_slots
  ADD COLUMN IF NOT EXISTS is_captain BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_vice    BOOLEAN NOT NULL DEFAULT FALSE;

-- קפטן אחד לכל היותר, וסגן אחד לכל היותר
CREATE UNIQUE INDEX IF NOT EXISTS one_captain_per_lineup
  ON game.user_lineup_slots (lineup_id) WHERE is_captain;
CREATE UNIQUE INDEX IF NOT EXISTS one_vice_per_lineup
  ON game.user_lineup_slots (lineup_id) WHERE is_vice;

-- אותו שחקן לא יכול להיות גם קפטן וגם סגן
ALTER TABLE game.user_lineup_slots
  DROP CONSTRAINT IF EXISTS captain_is_not_vice;
ALTER TABLE game.user_lineup_slots
  ADD CONSTRAINT captain_is_not_vice CHECK (NOT (is_captain AND is_vice));

-- קפטן חייב להיות בהרכב הפותח, לא על הספסל
ALTER TABLE game.user_lineup_slots
  DROP CONSTRAINT IF EXISTS captain_not_on_bench;
ALTER TABLE game.user_lineup_slots
  ADD CONSTRAINT captain_not_on_bench CHECK (NOT (is_bench AND (is_captain OR is_vice)));

-- ---------------------------------------------------------------------
-- 2. ולידציית הגשה מעודכנת: גודל + קבוצה ייחודית + קפטן
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION game.assert_lineup_valid(p_lineup_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_required SMALLINT;
  v_actual   SMALLINT;
  v_teams    SMALLINT;
  v_captains SMALLINT;
BEGIN
  SELECT l.squad_size INTO v_required
  FROM game.user_lineups ul
  JOIN game.gameweeks gw ON gw.id = ul.gameweek_id
  JOIN core.seasons  s  ON s.id  = gw.season_id
  JOIN core.leagues  l  ON l.id  = s.league_id
  WHERE ul.id = p_lineup_id;

  SELECT count(*), count(DISTINCT team_id), count(*) FILTER (WHERE is_captain)
    INTO v_actual, v_teams, v_captains
  FROM game.user_lineup_slots
  WHERE lineup_id = p_lineup_id AND NOT is_bench;

  IF v_actual <> v_required THEN
    RAISE EXCEPTION 'LINEUP_SIZE_INVALID: expected %, got %', v_required, v_actual
      USING ERRCODE = 'check_violation';
  END IF;

  -- ★ שחקן אחד מכל קבוצה. שכבת האמת האחרונה.
  IF v_teams <> v_actual THEN
    RAISE EXCEPTION 'DISTINCT_TEAM_CONSTRAINT_VIOLATED: % players from % teams', v_actual, v_teams
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_captains <> 1 THEN
    RAISE EXCEPTION 'CAPTAIN_REQUIRED: expected exactly 1 captain, got %', v_captains
      USING ERRCODE = 'check_violation';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3. תוצאות הניקוד — פירוק לארבעת הרכיבים + דירוג
-- ---------------------------------------------------------------------
ALTER TABLE game.lineup_scores
  ADD COLUMN IF NOT EXISTS captain_points NUMERIC(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rank           INTEGER;

CREATE INDEX IF NOT EXISTS lineup_scores_rank ON game.lineup_scores (gameweek_id, rank);

-- ---------------------------------------------------------------------
-- 4. RPC — בדיוק שתי השאילתות שה-Edge Function צורכת.
--    למה RPC ולא select מהקליינט: זה מקבע את חוזה הקלט של המנוע
--    ומונע מצב שבו שינוי בשאילתה בצד אחד משנה ניקוד בצד השני.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION game.gameweek_player_stats(p_gameweek_id UUID)
RETURNS TABLE (
  -- "position" מצריך מרכאות: זו מילה שמורה ב-SQL (הפונקציה POSITION(x IN y))
  player_id UUID, team_id UUID, "position" core.position,
  minutes SMALLINT, goals SMALLINT, assists SMALLINT, own_goals SMALLINT,
  yellow_cards SMALLINT, red_cards SMALLINT, saves SMALLINT,
  penalties_saved SMALLINT, penalties_missed SMALLINT,
  goals_conceded SMALLINT, clean_sheet BOOLEAN
)
LANGUAGE sql STABLE AS $$
  SELECT s.player_id, s.team_id,
         COALESCE(sq.position, p.primary_position, 'MID'::core.position),
         s.minutes, s.goals, s.assists, s.own_goals,
         s.yellow_cards, s.red_cards, s.saves,
         s.penalties_saved, s.penalties_missed,
         s.goals_conceded, s.clean_sheet
  FROM core.player_match_stats s
  JOIN core.weekly_matches m ON m.id = s.match_id
  JOIN core.players p        ON p.id = s.player_id
  LEFT JOIN LATERAL (
    SELECT position FROM core.squads
    WHERE player_id = s.player_id AND team_id = s.team_id AND valid_to IS NULL
    LIMIT 1
  ) sq ON TRUE
  WHERE m.gameweek_id = p_gameweek_id;
$$;

CREATE OR REPLACE FUNCTION game.gameweek_team_results(p_gameweek_id UUID)
RETURNS TABLE (team_id UUID, result TEXT, goals_for SMALLINT, goals_against SMALLINT)
LANGUAGE sql STABLE AS $$
  SELECT v.team_id, v.result, v.goals_for, v.goals_against
  FROM core.v_team_match_results v
  WHERE v.gameweek_id = p_gameweek_id;
$$;

-- ---------------------------------------------------------------------
-- 5. RLS — משתמש רואה ועורך רק את ההרכב שלו, ורק לפני הנעילה.
--    הניקוד נכתב אך ורק על ידי service_role.
-- ---------------------------------------------------------------------
-- auth.uid() קיים רק ב-Supabase. הבלוק מדלג בשקט על Postgres רגיל
-- כדי שאותו קובץ ירוץ גם בסביבת פיתוח מקומית וגם בענן.
DO $rls$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    RAISE NOTICE 'דילוג על RLS: הסכמה auth לא קיימת (לא Supabase)';
    RETURN;
  END IF;

  ALTER TABLE game.user_lineups      ENABLE ROW LEVEL SECURITY;
  ALTER TABLE game.user_lineup_slots ENABLE ROW LEVEL SECURITY;
  ALTER TABLE game.lineup_scores     ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS lineups_own ON game.user_lineups;
  CREATE POLICY lineups_own ON game.user_lineups
    FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

  DROP POLICY IF EXISTS slots_own_before_lock ON game.user_lineup_slots;
  CREATE POLICY slots_own_before_lock ON game.user_lineup_slots
    FOR ALL
    USING (EXISTS (
      SELECT 1 FROM game.user_lineups ul
      WHERE ul.id = lineup_id AND ul.user_id = auth.uid()
    ))
    WITH CHECK (EXISTS (
      SELECT 1 FROM game.user_lineups ul
      JOIN game.gameweeks gw ON gw.id = ul.gameweek_id
      WHERE ul.id = lineup_id
        AND ul.user_id = auth.uid()
        AND gw.lock_at > now()          -- אחרי הנעילה אי אפשר לגעת
    ));

  -- טבלת התוצאות גלויה לכולם (זו טבלת הליגה) אבל לקריאה בלבד
  DROP POLICY IF EXISTS scores_readable ON game.lineup_scores;
  CREATE POLICY scores_readable ON game.lineup_scores FOR SELECT USING (TRUE);
END
$rls$;


-- =====================================================================
-- ▼▼▼  03_seed_squads.sql  —  14 קבוצות · 351 שחקנים · מחירים
-- =====================================================================

-- =====================================================================
--  Dubid · מיגרציה 03 — סיד סגלי ליגת העל
--  נוצר אוטומטית מ-scripts/squads.source.json (npm run build:squads).
--  אידמפוטנטי: אפשר להריץ שוב אחרי עדכון הקובץ, ורק מה שהשתנה יתעדכן.
--  המיפוי לישויות נשמר ב-core.external_refs עם provider='manual_json',
--  כך שסנכרון עתידי מ-API לא ייצור כפילויות.
-- =====================================================================

SET search_path = core, game, public;

DO $seed$
DECLARE
  payload  JSONB := $json${"league":{"id":1,"name_he":"ליגת העל בישראל","name_en":"Israeli Premier League","season":"2026/2027"},"teams":[{"team_id":1,"name_he":"הפועל באר שבע","name_en":"Hapoel Beer Sheva","short":"הב״ש","city":"באר שבע","stadium":null,"players":[{"id":101,"name_he":"אופיר מרציאנו","name_en":"TBD","position":"GK","number":1,"tier":2,"price":3,"overall_rank":28,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":102,"name_he":"גיא מזרחי","name_en":"TBD","position":"DF","number":2,"tier":2,"price":4,"overall_rank":29,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":103,"name_he":"מתן בלטקסה","name_en":"TBD","position":"DF","number":3,"tier":2,"price":4,"overall_rank":36,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":104,"name_he":"מיגל ויטור","name_en":"TBD","position":"DF","number":4,"tier":2,"price":4,"overall_rank":33,"rated":true,"nationality":"פורטוגל","is_club_captain":true},{"id":105,"name_he":"פדרו אמאדור","name_en":"TBD","position":"DF","number":5,"tier":2,"price":4,"overall_rank":37,"rated":true,"nationality":"פורטוגל","is_club_captain":false},{"id":106,"name_he":"אליאל פרץ","name_en":"TBD","position":"MF","number":7,"tier":1,"price":5,"overall_rank":10,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":107,"name_he":"חמודי כנעאן","name_en":"TBD","position":"MF","number":8,"tier":2,"price":3,"overall_rank":38,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":108,"name_he":"זאהי אחמד","name_en":"TBD","position":"FW","number":9,"tier":2,"price":3,"overall_rank":39,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":109,"name_he":"דן ביטון","name_en":"TBD","position":"MF","number":10,"tier":1,"price":5,"overall_rank":2,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":110,"name_he":"אמיר גנאח","name_en":"TBD","position":"MF","number":11,"tier":2,"price":3,"overall_rank":40,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":111,"name_he":"איתי רוטמן","name_en":"TBD","position":"DF","number":12,"tier":2,"price":3,"overall_rank":41,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":112,"name_he":"אופיר דוידזאדה","name_en":"TBD","position":"DF","number":13,"tier":2,"price":4,"overall_rank":42,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":113,"name_he":"יונס מלדה","name_en":"TBD","position":"FW","number":14,"tier":2,"price":3,"overall_rank":43,"rated":true,"nationality":"בלגיה/ישראל","is_club_captain":false},{"id":114,"name_he":"רועי ליוי","name_en":"TBD","position":"DF","number":18,"tier":2,"price":4,"overall_rank":44,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":115,"name_he":"ג'בון איסט","name_en":"TBD","position":"FW","number":20,"tier":2,"price":4,"overall_rank":45,"rated":true,"nationality":"גמייקה","is_club_captain":false},{"id":116,"name_he":"יואב קורן","name_en":"TBD","position":"FW","number":21,"tier":2,"price":4,"overall_rank":46,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":117,"name_he":"איתי חזות","name_en":"TBD","position":"MF","number":23,"tier":2,"price":4,"overall_rank":47,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":118,"name_he":"לוקאס ונטורה","name_en":"TBD","position":"MF","number":25,"tier":2,"price":4,"overall_rank":17,"rated":true,"nationality":"ברזיל","is_club_captain":false},{"id":119,"name_he":"יוני סטויאנוב","name_en":"TBD","position":"MF","number":27,"tier":2,"price":4,"overall_rank":48,"rated":true,"nationality":"בולגריה","is_club_captain":false},{"id":120,"name_he":"ניב יהושע","name_en":"TBD","position":"MF","number":28,"tier":2,"price":3,"overall_rank":49,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":121,"name_he":"מרקו וולף","name_en":"TBD","position":"GK","number":34,"tier":2,"price":3,"overall_rank":50,"rated":true,"nationality":"ארגנטינה","is_club_captain":false},{"id":122,"name_he":"יונתן שני","name_en":"TBD","position":"GK","number":36,"tier":2,"price":2,"overall_rank":51,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":123,"name_he":"ג'יבריל דיופ","name_en":"TBD","position":"DF","number":44,"tier":2,"price":4,"overall_rank":52,"rated":true,"nationality":"סנגל","is_club_captain":false},{"id":124,"name_he":"מוחמד אבו רומי","name_en":"TBD","position":"FW","number":45,"tier":2,"price":4,"overall_rank":53,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":125,"name_he":"ניב אליאסי","name_en":"TBD","position":"GK","number":55,"tier":2,"price":2,"overall_rank":54,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":126,"name_he":"איגור זלאטנוביץ'","name_en":"TBD","position":"FW","number":66,"tier":1,"price":5,"overall_rank":9,"rated":true,"nationality":"סרביה","is_club_captain":false},{"id":127,"name_he":"ז'ואאו ויקטור","name_en":"TBD","position":"FW","number":70,"tier":2,"price":4,"overall_rank":55,"rated":true,"nationality":"ברזיל","is_club_captain":false}]},{"team_id":2,"name_he":"הפועל ירושלים","name_en":"Hapoel Jerusalem","short":"הי״ם","city":"ירושלים","stadium":null,"players":[{"id":201,"name_he":"נועם מלמוד","name_en":"TBD","position":"DF","number":3,"tier":2,"price":3,"overall_rank":56,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":202,"name_he":"יונתן לייש","name_en":"TBD","position":"DF","number":4,"tier":2,"price":3,"overall_rank":57,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":203,"name_he":"עומר אבוהב","name_en":"TBD","position":"MF","number":5,"tier":2,"price":3,"overall_rank":58,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":204,"name_he":"לי און מזרחי","name_en":"TBD","position":"DF","number":null,"tier":2,"price":3,"overall_rank":59,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":205,"name_he":"איליאי מדמון","name_en":"TBD","position":"MF","number":8,"tier":2,"price":3,"overall_rank":60,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":206,"name_he":"עידן כהן","name_en":"TBD","position":"DF","number":15,"tier":2,"price":3,"overall_rank":61,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":207,"name_he":"עומר אגבדיש","name_en":"TBD","position":"DF","number":16,"tier":2,"price":3,"overall_rank":62,"rated":true,"nationality":"ישראל","is_club_captain":true},{"id":208,"name_he":"ינאי דיסטפלד","name_en":"TBD","position":"MF","number":17,"tier":2,"price":3,"overall_rank":63,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":209,"name_he":"אופק נדיר","name_en":"TBD","position":"DF","number":20,"tier":2,"price":4,"overall_rank":64,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":210,"name_he":"איינאו פרדה","name_en":"TBD","position":"MF","number":21,"tier":2,"price":3,"overall_rank":65,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":211,"name_he":"תמיר חיימוביץ'","name_en":"TBD","position":"DF","number":22,"tier":2,"price":2,"overall_rank":66,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":212,"name_he":"נתי שפראו","name_en":"TBD","position":"FW","number":23,"tier":2,"price":3,"overall_rank":67,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":213,"name_he":"הילאי מלמן","name_en":"TBD","position":"DF","number":null,"tier":2,"price":2,"overall_rank":68,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":214,"name_he":"אנדרו אידוקו","name_en":"TBD","position":"FW","number":25,"tier":2,"price":3,"overall_rank":69,"rated":true,"nationality":"ניגריה","is_club_captain":false},{"id":215,"name_he":"עומר בן גורדין","name_en":"TBD","position":"GK","number":28,"tier":2,"price":2,"overall_rank":70,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":216,"name_he":"ישראל דאפה","name_en":"TBD","position":"FW","number":33,"tier":2,"price":4,"overall_rank":71,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":217,"name_he":"נדב זמיר","name_en":"TBD","position":"GK","number":55,"tier":2,"price":3,"overall_rank":72,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":218,"name_he":"אוהד אלמגור","name_en":"TBD","position":"MF","number":77,"tier":2,"price":3,"overall_rank":73,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":219,"name_he":"ויט ליייה דאמאשקאן","name_en":"TBD","position":"FW","number":null,"tier":2,"price":4,"overall_rank":74,"rated":true,"nationality":"מולדובה","is_club_captain":false}]},{"team_id":3,"name_he":"מכבי תל אביב","name_en":"Maccabi Tel Aviv","short":"מת״א","city":"תל אביב","stadium":null,"players":[{"id":301,"name_he":"רוי רביבו","name_en":"TBD","position":"DF","number":3,"tier":1,"price":5,"overall_rank":6,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":302,"name_he":"מוחמד עלי קמארה","name_en":"TBD","position":"DF","number":5,"tier":2,"price":4,"overall_rank":75,"rated":true,"nationality":"גינאה","is_club_captain":false},{"id":303,"name_he":"טייריס אסאנטה","name_en":"TBD","position":"DF","number":6,"tier":2,"price":4,"overall_rank":27,"rated":true,"nationality":"הולנד","is_club_captain":false},{"id":304,"name_he":"קרווין אנדרדה","name_en":"TBD","position":"MF","number":10,"tier":2,"price":4,"overall_rank":76,"rated":true,"nationality":"ונצואלה","is_club_captain":false},{"id":305,"name_he":"שגיב יחזקאל","name_en":"TBD","position":"DF","number":11,"tier":2,"price":4,"overall_rank":11,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":306,"name_he":"רז שלמה","name_en":"TBD","position":"DF","number":13,"tier":2,"price":4,"overall_rank":77,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":307,"name_he":"דני גרופר","name_en":"TBD","position":"DF","number":14,"tier":2,"price":4,"overall_rank":78,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":308,"name_he":"יונס מלדה","name_en":"TBD","position":"FW","number":15,"tier":2,"price":3,"overall_rank":43,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":309,"name_he":"כריסטיאן בליץ'","name_en":"TBD","position":"MF","number":17,"tier":2,"price":4,"overall_rank":79,"rated":true,"nationality":"סרביה","is_club_captain":false},{"id":310,"name_he":"אלעד מדמון","name_en":"TBD","position":"FW","number":19,"tier":2,"price":4,"overall_rank":80,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":311,"name_he":"נועם בן הרוש","name_en":"TBD","position":"DF","number":21,"tier":2,"price":4,"overall_rank":81,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":312,"name_he":"אופק מליקה","name_en":"TBD","position":"GK","number":22,"tier":2,"price":4,"overall_rank":34,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":313,"name_he":"איסוף סיסוקו","name_en":"TBD","position":"MF","number":28,"tier":2,"price":4,"overall_rank":82,"rated":true,"nationality":"מאלי","is_club_captain":false},{"id":314,"name_he":"הליו וארלה","name_en":"TBD","position":"MF","number":29,"tier":2,"price":4,"overall_rank":35,"rated":true,"nationality":"כף ורדה","is_club_captain":false},{"id":315,"name_he":"איתמר נוי","name_en":"TBD","position":"MF","number":30,"tier":2,"price":4,"overall_rank":83,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":316,"name_he":"סייד אבו פרחי","name_en":"TBD","position":"FW","number":34,"tier":2,"price":4,"overall_rank":13,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":317,"name_he":"עידו שחר","name_en":"TBD","position":"MF","number":36,"tier":2,"price":4,"overall_rank":16,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":318,"name_he":"איתי בן חמו","name_en":"TBD","position":"DF","number":41,"tier":4,"price":2,"overall_rank":84,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":319,"name_he":"דור פרץ","name_en":"TBD","position":"MF","number":42,"tier":1,"price":5,"overall_rank":1,"rated":true,"nationality":"ישראל","is_club_captain":true},{"id":320,"name_he":"שליו סעדיה","name_en":"TBD","position":"GK","number":51,"tier":4,"price":2,"overall_rank":85,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":321,"name_he":"עידן וינברג","name_en":"TBD","position":"MF","number":52,"tier":4,"price":2,"overall_rank":87,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":322,"name_he":"רועי מגור","name_en":"TBD","position":"MF","number":53,"tier":4,"price":2,"overall_rank":99,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":323,"name_he":"לוטם אסרס","name_en":"TBD","position":"MF","number":59,"tier":4,"price":2,"overall_rank":111,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":324,"name_he":"עילאי בן סימון","name_en":"TBD","position":"FW","number":60,"tier":4,"price":2,"overall_rank":123,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":325,"name_he":"אמיר סאחיטי","name_en":"TBD","position":"FW","number":70,"tier":5,"price":1,"overall_rank":135,"rated":true,"nationality":"קוסובו","is_club_captain":false},{"id":326,"name_he":"אושר דוידה","name_en":"TBD","position":"FW","number":77,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":327,"name_he":"רועי משפתי","name_en":"TBD","position":"GK","number":90,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":328,"name_he":"יון ניקולאescu","name_en":"TBD","position":"FW","number":98,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"מולדובה","is_club_captain":false}]},{"team_id":4,"name_he":"מכבי חיפה","name_en":"Maccabi Haifa","short":"מ״ח","city":"חיפה","stadium":"סמי עופר","players":[{"id":401,"name_he":"זוהר זסנו","name_en":"TBD","position":"DF","number":2,"tier":4,"price":3,"overall_rank":88,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":402,"name_he":"שון גולדברג","name_en":"TBD","position":"DF","number":3,"tier":4,"price":3,"overall_rank":100,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":403,"name_he":"עלי מוחמד","name_en":"TBD","position":"MF","number":4,"tier":4,"price":4,"overall_rank":112,"rated":true,"nationality":"ניזר","is_club_captain":false},{"id":404,"name_he":"גוני נאור","name_en":"TBD","position":"MF","number":5,"tier":4,"price":1,"overall_rank":124,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":405,"name_he":"ירין לוי","name_en":"TBD","position":"MF","number":7,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":406,"name_he":"אנדרייה נובאקוביץ'","name_en":"TBD","position":"FW","number":9,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ארצות הברית","is_club_captain":false},{"id":407,"name_he":"ברוניניו","name_en":"TBD","position":"MF","number":10,"tier":2,"price":5,"overall_rank":32,"rated":true,"nationality":"ברזיל","is_club_captain":false},{"id":408,"name_he":"קנג'י חורה","name_en":"TBD","position":"MF","number":11,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"נורווגיה","is_club_captain":true},{"id":409,"name_he":"מנואל בנסון","name_en":"TBD","position":"MF","number":14,"tier":2,"price":4,"overall_rank":15,"rated":true,"nationality":"אנגולה","is_club_captain":false},{"id":410,"name_he":"ליאור קאסה","name_en":"TBD","position":"MF","number":15,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":411,"name_he":"קני סייף","name_en":"TBD","position":"MF","number":16,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":412,"name_he":"ינון פיינגזיכט","name_en":"TBD","position":"DF","number":17,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":413,"name_he":"גיא מלמד","name_en":"TBD","position":"FW","number":18,"tier":2,"price":4,"overall_rank":12,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":414,"name_he":"איתן אזולאי","name_en":"TBD","position":"MF","number":19,"tier":1,"price":4,"overall_rank":8,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":415,"name_he":"נייג'ל האוסייק","name_en":"TBD","position":"DF","number":21,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"סורינאם","is_club_captain":false},{"id":416,"name_he":"יילה בטאייה","name_en":"TBD","position":"DF","number":25,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"בלגיה","is_club_captain":false},{"id":417,"name_he":"סילבה קאני","name_en":"TBD","position":"MF","number":26,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"טוגו","is_club_captain":false},{"id":418,"name_he":"פייר קורנו","name_en":"TBD","position":"DF","number":27,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"צרפת","is_club_captain":false},{"id":419,"name_he":"אייאד חלאילי","name_en":"TBD","position":"MF","number":29,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":420,"name_he":"עמית ארזי","name_en":"TBD","position":"MF","number":31,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":421,"name_he":"נועם שטייפמן","name_en":"TBD","position":"DF","number":35,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":422,"name_he":"נבות רטנר","name_en":"TBD","position":"MF","number":36,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":423,"name_he":"אלעד אמיר","name_en":"TBD","position":"DF","number":37,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":424,"name_he":"אדם גרימברג","name_en":"TBD","position":"FW","number":38,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":425,"name_he":"ארד גייסט","name_en":"TBD","position":"DF","number":39,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":426,"name_he":"שריף כיוף","name_en":"TBD","position":"GK","number":40,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":427,"name_he":"ליאם לוסקי","name_en":"TBD","position":"FW","number":42,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":428,"name_he":"פדראו","name_en":"TBD","position":"DF","number":44,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ברזיל","is_club_captain":false},{"id":429,"name_he":"סדריק דון","name_en":"TBD","position":"MF","number":45,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"חוף השנהב","is_club_captain":false},{"id":430,"name_he":"עומרי גלזר","name_en":"TBD","position":"GK","number":55,"tier":2,"price":3,"overall_rank":20,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":431,"name_he":"אנדרסון צונאמי","name_en":"TBD","position":"DF","number":66,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ברזיל","is_club_captain":false},{"id":432,"name_he":"יאיר מרדכי","name_en":"TBD","position":"MF","number":77,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":433,"name_he":"גלן אלון","name_en":"TBD","position":"GK","number":90,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":434,"name_he":"עומר ניראון","name_en":"TBD","position":"GK","number":99,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false}]},{"team_id":5,"name_he":"בית\"ר ירושלים","name_en":"Beitar Jerusalem","short":"בי״ר","city":"ירושלים","stadium":null,"players":[{"id":501,"name_he":"בריאן קרבאלי","name_en":"TBD","position":"DF","number":4,"tier":4,"price":3,"overall_rank":89,"rated":true,"nationality":"קולומביה","is_club_captain":false},{"id":502,"name_he":"גיל כהן","name_en":"TBD","position":"DF","number":5,"tier":4,"price":3,"overall_rank":101,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":503,"name_he":"זיו בן שימול","name_en":"TBD","position":"MF","number":6,"tier":4,"price":3,"overall_rank":113,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":504,"name_he":"ירדן שועה","name_en":"TBD","position":"FW","number":7,"tier":1,"price":5,"overall_rank":4,"rated":true,"nationality":"ישראל","is_club_captain":true},{"id":505,"name_he":"נועם מוצ'ה","name_en":"TBD","position":"MF","number":30,"tier":4,"price":3,"overall_rank":125,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":506,"name_he":"ג'ונבוסקו קאלו","name_en":"TBD","position":"FW","number":9,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ניגריה","is_club_captain":false},{"id":507,"name_he":"עדי יונה","name_en":"TBD","position":"MF","number":10,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":508,"name_he":"טימוטי מוזי","name_en":"TBD","position":"FW","number":11,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":509,"name_he":"רועי אלימלך","name_en":"TBD","position":"DF","number":14,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":510,"name_he":"דגאץ' וורקו","name_en":"TBD","position":"MF","number":77,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":511,"name_he":"ירדן כהן","name_en":"TBD","position":"DF","number":16,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":512,"name_he":"אורי דהן","name_en":"TBD","position":"DF","number":20,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":513,"name_he":"יהונתן עוזר","name_en":"TBD","position":"GK","number":22,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":514,"name_he":"יובל שלו","name_en":"TBD","position":"DF","number":25,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":515,"name_he":"עילאי חג'ג'","name_en":"TBD","position":"MF","number":28,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":516,"name_he":"אריאל מנדי","name_en":"TBD","position":"DF","number":29,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"סנגל","is_club_captain":false},{"id":517,"name_he":"בוריס אינו","name_en":"TBD","position":"MF","number":40,"tier":2,"price":3,"overall_rank":18,"rated":true,"nationality":"קמרון","is_club_captain":false},{"id":518,"name_he":"איילסון טבארש","name_en":"TBD","position":"MF","number":42,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"כף ורדה","is_club_captain":false},{"id":519,"name_he":"לוקה גדראני","name_en":"TBD","position":"DF","number":44,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"גאורגיה","is_club_captain":false},{"id":520,"name_he":"מיגל סילבה","name_en":"TBD","position":"GK","number":55,"tier":2,"price":3,"overall_rank":23,"rated":true,"nationality":"פורטוגל","is_club_captain":true},{"id":521,"name_he":"עומר אצילי","name_en":"TBD","position":"MF","number":null,"tier":1,"price":5,"overall_rank":3,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":522,"name_he":"תומר יוספי","name_en":"TBD","position":"MF","number":null,"tier":2,"price":4,"overall_rank":19,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":523,"name_he":"יוג'ין אנסה","name_en":"TBD","position":"FW","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"גאנה","is_club_captain":false},{"id":547,"name_he":"פטריק טוומאסי","name_en":"TBD","position":"FW","number":null,"tier":2,"price":4,"overall_rank":14,"rated":true,"nationality":"גאנה","is_club_captain":false}]},{"team_id":6,"name_he":"הפועל תל אביב","name_en":"Hapoel Tel Aviv","short":"הת״א","city":"תל אביב","stadium":null,"players":[{"id":601,"name_he":"דור בנימיני","name_en":"TBD","position":"GK","number":1,"tier":4,"price":2,"overall_rank":90,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":602,"name_he":"שיקו","name_en":"TBD","position":"DF","number":4,"tier":1,"price":5,"overall_rank":7,"rated":true,"nationality":"ברזיל","is_club_captain":false},{"id":603,"name_he":"פרנאן מאיימבו","name_en":"TBD","position":"DF","number":5,"tier":2,"price":4,"overall_rank":25,"rated":true,"nationality":"קונגו","is_club_captain":true},{"id":604,"name_he":"אנדריאן קרייב","name_en":"TBD","position":"MF","number":6,"tier":4,"price":3,"overall_rank":102,"rated":true,"nationality":"בולגריה","is_club_captain":false},{"id":605,"name_he":"רוי קורין","name_en":"TBD","position":"FW","number":7,"tier":4,"price":2,"overall_rank":114,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":606,"name_he":"יונתן פרבר","name_en":"TBD","position":"MF","number":8,"tier":4,"price":2,"overall_rank":126,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":607,"name_he":"עמנואל בואטנג","name_en":"TBD","position":"FW","number":9,"tier":2,"price":4,"overall_rank":30,"rated":true,"nationality":"גאנה","is_club_captain":false},{"id":608,"name_he":"שאנדה סילבה","name_en":"TBD","position":"FW","number":10,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"פורטוגל","is_club_captain":false},{"id":609,"name_he":"סתיו טוריאל","name_en":"TBD","position":"MF","number":11,"tier":1,"price":5,"overall_rank":5,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":610,"name_he":"אל ים קנצפולסקי","name_en":"TBD","position":"MF","number":14,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":611,"name_he":"רועי אלקוקין","name_en":"TBD","position":"MF","number":15,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":612,"name_he":"דורון ליידנר","name_en":"TBD","position":"DF","number":16,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":613,"name_he":"טל ארצ'ל","name_en":"TBD","position":"DF","number":18,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":614,"name_he":"אנס מחאמיד","name_en":"TBD","position":"FW","number":19,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":615,"name_he":"שחר פיבן","name_en":"TBD","position":"DF","number":21,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":616,"name_he":"אסף צור","name_en":"TBD","position":"GK","number":22,"tier":2,"price":4,"overall_rank":21,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":617,"name_he":"עמית למקין","name_en":"TBD","position":"DF","number":23,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":618,"name_he":"מור בוסקילה","name_en":"TBD","position":"MF","number":27,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":619,"name_he":"דאגלס אווסו","name_en":"TBD","position":"FW","number":35,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"גאנה","is_club_captain":false},{"id":620,"name_he":"רון תלמי","name_en":"TBD","position":"FW","number":38,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":621,"name_he":"דניאל דאפה","name_en":"TBD","position":"FW","number":44,"tier":2,"price":4,"overall_rank":31,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":622,"name_he":"עומרי אלטמן","name_en":"TBD","position":"FW","number":51,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":623,"name_he":"ישי ברוש","name_en":"TBD","position":"MF","number":66,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":624,"name_he":"עופר גלברד","name_en":"TBD","position":"DF","number":92,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":625,"name_he":"מרקוס קוקו","name_en":"TBD","position":"DF","number":97,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"צרפת","is_club_captain":false},{"id":626,"name_he":"לוקאס פלקאו","name_en":"TBD","position":"MF","number":98,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ברזיל","is_club_captain":false},{"id":627,"name_he":"איתי שביט","name_en":"TBD","position":"MF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false}]},{"team_id":7,"name_he":"מכבי נתניה","name_en":"Maccabi Netanya","short":"מ״נ","city":"נתניה","stadium":null,"players":[{"id":701,"name_he":"ניב אנטמן","name_en":"TBD","position":"GK","number":1,"tier":4,"price":3,"overall_rank":91,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":702,"name_he":"גריגורי מורוזוב","name_en":"TBD","position":"DF","number":2,"tier":4,"price":3,"overall_rank":103,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":703,"name_he":"איתי בן שבת","name_en":"TBD","position":"DF","number":4,"tier":4,"price":2,"overall_rank":115,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":704,"name_he":"דניס קוליקוב","name_en":"TBD","position":"DF","number":5,"tier":4,"price":2,"overall_rank":127,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":705,"name_he":"בפארי קונאטה","name_en":"TBD","position":"DF","number":6,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"גינאה","is_club_captain":false},{"id":706,"name_he":"דולב חזיזה","name_en":"TBD","position":"MF","number":8,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":707,"name_he":"עוז בילו","name_en":"TBD","position":"MF","number":10,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":708,"name_he":"דור חוגי","name_en":"TBD","position":"FW","number":11,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":709,"name_he":"אלון אזוגי","name_en":"TBD","position":"DF","number":12,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":710,"name_he":"נדב נידם","name_en":"TBD","position":"MF","number":13,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":712,"name_he":"ליאם כהן","name_en":"TBD","position":"MF","number":14,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":713,"name_he":"מאור לוי","name_en":"TBD","position":"MF","number":15,"tier":2,"price":4,"overall_rank":26,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":714,"name_he":"בסאם זערורה","name_en":"TBD","position":"MF","number":75,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":715,"name_he":"מתאוס דאבו","name_en":"TBD","position":"FW","number":83,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ברזיל","is_club_captain":false},{"id":716,"name_he":"ירדן אבוחצירא","name_en":"TBD","position":"FW","number":17,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":717,"name_he":"עמרי שמיר","name_en":"TBD","position":"MF","number":18,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":718,"name_he":"סאהר תאג'י","name_en":"TBD","position":"MF","number":19,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":719,"name_he":"אלכס טלפה","name_en":"TBD","position":"MF","number":21,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":720,"name_he":"סמואל דה סילבה","name_en":"TBD","position":"GK","number":22,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"פורטוגל","is_club_captain":false},{"id":721,"name_he":"ליאם כהן","name_en":"TBD","position":"FW","number":23,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":722,"name_he":"עמית כהן","name_en":"TBD","position":"DF","number":24,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":723,"name_he":"ווילאן סיפריאן","name_en":"TBD","position":"MF","number":25,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":724,"name_he":"כרם ג'אבר","name_en":"TBD","position":"DF","number":26,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":true},{"id":725,"name_he":"עזיז וואטרה","name_en":"TBD","position":"MF","number":32,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"חוף השנהב","is_club_captain":false},{"id":726,"name_he":"סאבה חוואדזאני","name_en":"TBD","position":"DF","number":40,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"גאורגיה","is_club_captain":false},{"id":727,"name_he":"בני פלדמן","name_en":"TBD","position":"DF","number":44,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":754,"name_he":"דניאל כהן","name_en":"TBD","position":"GK","number":75,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false}]},{"team_id":8,"name_he":"בני סכנין","name_en":"Bnei Sakhnin","short":"ב״ס","city":"סכנין","stadium":null,"players":[{"id":801,"name_he":"דוד בן לולו","name_en":"TBD","position":"GK","number":1,"tier":4,"price":2,"overall_rank":92,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":802,"name_he":"מארון גנטוס","name_en":"TBD","position":"DF","number":2,"tier":4,"price":3,"overall_rank":104,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":803,"name_he":"קרלו ברוצ'יץ'","name_en":"TBD","position":"DF","number":3,"tier":4,"price":3,"overall_rank":116,"rated":true,"nationality":"קרואטיה","is_club_captain":false},{"id":804,"name_he":"מוסטפא שייח' יוסף","name_en":"TBD","position":"MF","number":7,"tier":4,"price":2,"overall_rank":128,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":805,"name_he":"מייקום דויד","name_en":"TBD","position":"MF","number":8,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ברזיל","is_club_captain":false},{"id":807,"name_he":"ארתור מיראניאן","name_en":"TBD","position":"FW","number":9,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ארמניה","is_club_captain":false},{"id":808,"name_he":"מתיו קודג'ו","name_en":"TBD","position":"MF","number":10,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"גאנה","is_club_captain":false},{"id":810,"name_he":"אבראהימה דרמה","name_en":"TBD","position":"FW","number":11,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"מאלי","is_club_captain":false},{"id":811,"name_he":"שאקר אבו חוסיין","name_en":"TBD","position":"FW","number":16,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":812,"name_he":"חסן חילו","name_en":"TBD","position":"DF","number":17,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":813,"name_he":"עומר אבוהב","name_en":"TBD","position":"MF","number":18,"tier":2,"price":3,"overall_rank":58,"rated":true,"nationality":"אנגולה","is_club_captain":false},{"id":814,"name_he":"מוחמד גנאמה","name_en":"TBD","position":"DF","number":20,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":815,"name_he":"ג'ובייר בושאנק","name_en":"TBD","position":"FW","number":21,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":816,"name_he":"מוחמד אבו ניל","name_en":"TBD","position":"GK","number":22,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":817,"name_he":"עדן שמיר","name_en":"TBD","position":"MF","number":23,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":818,"name_he":"עומר קורסיה","name_en":"TBD","position":"DF","number":26,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":819,"name_he":"אחמד סלמן","name_en":"TBD","position":"FW","number":29,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":820,"name_he":"מג'ד סלימאן","name_en":"TBD","position":"MF","number":32,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":821,"name_he":"מקס גרצ'קין","name_en":"TBD","position":"DF","number":55,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":822,"name_he":"יואאן אנדי","name_en":"TBD","position":"DF","number":75,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"גינאה ביסאו","is_club_captain":false},{"id":823,"name_he":"ג'יימס אדני","name_en":"TBD","position":"FW","number":77,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ניגריה","is_club_captain":false},{"id":824,"name_he":"דורל אבונו","name_en":"TBD","position":"MF","number":92,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"קונגו","is_club_captain":false}]},{"team_id":9,"name_he":"הפועל חיפה","name_en":"Hapoel Haifa","short":"הפ״ח","city":"חיפה","stadium":null,"players":[{"id":901,"name_he":"יואב ג'ראפי","name_en":"TBD","position":"GK","number":1,"tier":2,"price":3,"overall_rank":22,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":902,"name_he":"תמיר ארבל","name_en":"TBD","position":"DF","number":3,"tier":4,"price":2,"overall_rank":93,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":903,"name_he":"דור מלול","name_en":"TBD","position":"DF","number":4,"tier":2,"price":4,"overall_rank":24,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":904,"name_he":"איוואן קריצ'אק","name_en":"TBD","position":"DF","number":5,"tier":4,"price":2,"overall_rank":105,"rated":true,"nationality":"קרואטיה","is_club_captain":false},{"id":905,"name_he":"איתי בוגנים","name_en":"TBD","position":"MF","number":7,"tier":4,"price":2,"overall_rank":117,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":906,"name_he":"והיב חביבאללה","name_en":"TBD","position":"FW","number":24,"tier":5,"price":3,"overall_rank":129,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":907,"name_he":"רותם חטואל","name_en":"TBD","position":"FW","number":9,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":908,"name_he":"סער פדידה","name_en":"TBD","position":"MF","number":10,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":909,"name_he":"אניס פורת עיאש","name_en":"TBD","position":"MF","number":11,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":910,"name_he":"אורן ביטון","name_en":"TBD","position":"DF","number":12,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":911,"name_he":"דריו די'ופריץ'","name_en":"TBD","position":"DF","number":13,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"קרואטיה","is_club_captain":false},{"id":912,"name_he":"רוי נאווי","name_en":"TBD","position":"MF","number":14,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":913,"name_he":"יעד גונן","name_en":"TBD","position":"MF","number":15,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":914,"name_he":"נפתלי בלאי","name_en":"TBD","position":"DF","number":16,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":915,"name_he":"חיים מקונן","name_en":"TBD","position":"MF","number":17,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":916,"name_he":"אופק ביטון","name_en":"TBD","position":"MF","number":18,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":917,"name_he":"רוי זיקרי","name_en":"TBD","position":"FW","number":21,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":918,"name_he":"מתן עמבר","name_en":"TBD","position":"GK","number":23,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":919,"name_he":"טל נעים","name_en":"TBD","position":"DF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":920,"name_he":"לירן סרדל","name_en":"TBD","position":"MF","number":24,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":921,"name_he":"ג'ורג' דיבה","name_en":"TBD","position":"DF","number":25,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":922,"name_he":"ברונו רמירס","name_en":"TBD","position":"DF","number":33,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ברזיל","is_club_captain":false},{"id":923,"name_he":"נאור סבג","name_en":"TBD","position":"MF","number":55,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":924,"name_he":"רז'י אנדו","name_en":"TBD","position":"MF","number":77,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"בורקינה פאסו","is_club_captain":false},{"id":925,"name_he":"סלאם זיידון","name_en":"TBD","position":"MF","number":88,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"מאלי","is_club_captain":false},{"id":926,"name_he":"שי בלסון","name_en":"TBD","position":"MF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":927,"name_he":"ליאם נחום","name_en":"TBD","position":"MF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":928,"name_he":"סאלי פחימה","name_en":"TBD","position":"MF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":null,"is_club_captain":false},{"id":929,"name_he":"איתי צפרני","name_en":"TBD","position":"FW","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":930,"name_he":"אריאל מנדי","name_en":"TBD","position":"DF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"סנגל","is_club_captain":false}]},{"team_id":10,"name_he":"עירוני קרית שמונה","name_en":"Ironi Kiryat Shmona","short":"עק״ש","city":"קרית שמונה","stadium":null,"players":[{"id":1001,"name_he":"מתן זלמנוביץ'","name_en":"TBD","position":"GK","number":1,"tier":4,"price":2,"overall_rank":94,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":1002,"name_he":"עמית גלזר","name_en":"TBD","position":"DF","number":4,"tier":4,"price":1,"overall_rank":106,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":1003,"name_he":"אופיר בנבנישתי","name_en":"TBD","position":"DF","number":6,"tier":4,"price":2,"overall_rank":118,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":1004,"name_he":"פרננדו פאצ'קו","name_en":"TBD","position":"MF","number":8,"tier":5,"price":3,"overall_rank":130,"rated":true,"nationality":"פרו","is_club_captain":false},{"id":1005,"name_he":"אדריאן אוגריסה","name_en":"TBD","position":"FW","number":9,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"פרו","is_club_captain":false},{"id":1006,"name_he":"אריאל שרצקי","name_en":"TBD","position":"MF","number":10,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1007,"name_he":"מור סימן טוב","name_en":"TBD","position":"MF","number":11,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1008,"name_he":"ג'ואן חלבי","name_en":"TBD","position":"FW","number":12,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1009,"name_he":"הראל גולדנברג","name_en":"TBD","position":"MF","number":14,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1010,"name_he":"איציק שולמייסטר","name_en":"TBD","position":"DF","number":17,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1011,"name_he":"אורי שנפר","name_en":"TBD","position":"FW","number":18,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1012,"name_he":"דניאל טננבאום","name_en":"TBD","position":"GK","number":19,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1013,"name_he":"עובדיה דרויש","name_en":"TBD","position":"DF","number":20,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1014,"name_he":"אביב אברהם","name_en":"TBD","position":"MF","number":21,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1015,"name_he":"ואלה מוסא עלי","name_en":"TBD","position":"MF","number":22,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ניגריה","is_club_captain":false},{"id":1016,"name_he":"יואב כראדי","name_en":"TBD","position":"MF","number":25,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1017,"name_he":"נמניה ליוביסבלייביץ'","name_en":"TBD","position":"DF","number":26,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"סרביה","is_club_captain":false},{"id":1018,"name_he":"עידו וייר","name_en":"TBD","position":"DF","number":28,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1019,"name_he":"יונתן מלכה","name_en":"TBD","position":"MF","number":29,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1020,"name_he":"שי בן דוד","name_en":"TBD","position":"DF","number":32,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1021,"name_he":"ליאל דרעי","name_en":"TBD","position":"DF","number":44,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1022,"name_he":"כריסטיאן מרטינס","name_en":"TBD","position":"MF","number":70,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"פנמה","is_club_captain":false},{"id":1023,"name_he":"רוי שדו","name_en":"TBD","position":"GK","number":77,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1024,"name_he":"יאו אקה","name_en":"TBD","position":"MF","number":79,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"גאנה","is_club_captain":false},{"id":1025,"name_he":"בילאל שאאין","name_en":"TBD","position":"FW","number":91,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false}]},{"team_id":11,"name_he":"עירוני טבריה","name_en":"Ironi Tiberias","short":"עי״ט","city":"טבריה","stadium":null,"players":[{"id":1101,"name_he":"גד עמוס","name_en":"TBD","position":"GK","number":1,"tier":4,"price":3,"overall_rank":95,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":1102,"name_he":"אימרי אוזן","name_en":"TBD","position":"DF","number":2,"tier":4,"price":1,"overall_rank":107,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":1103,"name_he":"דוד קלטינס","name_en":"TBD","position":"MF","number":3,"tier":4,"price":1,"overall_rank":119,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":1104,"name_he":"סמביניה","name_en":"TBD","position":"DF","number":4,"tier":5,"price":2,"overall_rank":131,"rated":true,"nationality":"גינאה ביסאו","is_club_captain":false},{"id":1105,"name_he":"נהוראי חן","name_en":"TBD","position":"DF","number":5,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1106,"name_he":"גיא חדרידה","name_en":"TBD","position":"MF","number":7,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1107,"name_he":"ארי כהן","name_en":"TBD","position":"MF","number":8,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1108,"name_he":"איתמר שבירו","name_en":"TBD","position":"FW","number":9,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1109,"name_he":"בר כהן","name_en":"TBD","position":"MF","number":10,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1110,"name_he":"ניב גוטליב","name_en":"TBD","position":"MF","number":11,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1111,"name_he":"קייס גאנם","name_en":"TBD","position":"FW","number":12,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1112,"name_he":"גיא סנקור","name_en":"TBD","position":"DF","number":14,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1113,"name_he":"רון אונגר","name_en":"TBD","position":"DF","number":17,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1114,"name_he":"עדן שמיר","name_en":"TBD","position":"MF","number":18,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1115,"name_he":"גל מעתוק","name_en":"TBD","position":"DF","number":19,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1116,"name_he":"עידו שרון","name_en":"TBD","position":"GK","number":22,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1117,"name_he":"כריס קואקו","name_en":"TBD","position":"MF","number":23,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"חוף השנהב","is_club_captain":false},{"id":1118,"name_he":"ירין שיביץ'","name_en":"TBD","position":"MF","number":24,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1119,"name_he":"רועי שחר","name_en":"TBD","position":"MF","number":25,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1120,"name_he":"ירין סוויסה","name_en":"TBD","position":"MF","number":27,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1121,"name_he":"ננה גבמבל","name_en":"TBD","position":"MF","number":29,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"חוף השנהב","is_club_captain":false},{"id":1122,"name_he":"מנסור באדג'י","name_en":"TBD","position":"FW","number":30,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"גמביה","is_club_captain":false},{"id":1123,"name_he":"אונדז'יי באצ'ה","name_en":"TBD","position":"DF","number":37,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"צכיה","is_club_captain":false},{"id":1124,"name_he":"ג'ונס אבו גנימה","name_en":"TBD","position":"GK","number":55,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1125,"name_he":"אגם יהודה","name_en":"TBD","position":"FW","number":77,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false}]},{"team_id":12,"name_he":"מכבי פתח תקווה","name_en":"Maccabi Petah Tikva","short":"מפ״ת","city":"פתח תקווה","stadium":null,"players":[{"id":1201,"name_he":"אופיר בתוש / עומרי לוזון","name_en":"TBD","position":"DF","number":22,"tier":4,"price":2,"overall_rank":96,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":1202,"name_he":"גיא דזנט","name_en":"TBD","position":"DF","number":26,"tier":4,"price":1,"overall_rank":108,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":1203,"name_he":"מוחמד הינדי","name_en":"TBD","position":"DF","number":32,"tier":4,"price":3,"overall_rank":120,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":1204,"name_he":"דור חברון","name_en":"TBD","position":"GK","number":null,"tier":5,"price":1,"overall_rank":132,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":1205,"name_he":"מאור ארליך","name_en":"TBD","position":"GK","number":39,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1206,"name_he":"עומר שירי","name_en":"TBD","position":"DF","number":53,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1207,"name_he":"אביב סלם","name_en":"TBD","position":"DF","number":77,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"קולומביה/ישראל","is_club_captain":false},{"id":1208,"name_he":"פרנק ריבולייה","name_en":"TBD","position":"FW","number":91,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"צרפת","is_club_captain":false},{"id":1209,"name_he":"עידו כהן","name_en":"TBD","position":"MF","number":20,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1210,"name_he":"אור דדיה","name_en":"TBD","position":"DF","number":21,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1211,"name_he":"פבליו קוראנה","name_en":"TBD","position":"DF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"קפריסין","is_club_captain":false},{"id":1212,"name_he":"איתן טיבי","name_en":"TBD","position":"DF","number":81,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1213,"name_he":"סמואל אואוסו","name_en":"TBD","position":"FW","number":9,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"גאנה","is_club_captain":false},{"id":1214,"name_he":"אריאל לוגסי","name_en":"TBD","position":"FW","number":10,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1215,"name_he":"אדר רטנר","name_en":"TBD","position":"FW","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1216,"name_he":"אייל אינברום","name_en":"TBD","position":"MF","number":99,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1217,"name_he":"קייל ספנס","name_en":"TBD","position":"MF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"אנגליה","is_club_captain":false},{"id":1218,"name_he":"לי-ים דן","name_en":"TBD","position":"MF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1219,"name_he":"איברהימה סומה","name_en":"TBD","position":"MF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"גאנה","is_club_captain":false}]},{"team_id":13,"name_he":"הפועל רמת גן","name_en":"Hapoel Ramat Gan","short":"הר״ג","city":"רמת גן","stadium":null,"players":[{"id":1301,"name_he":"גטאוצ'ו יבלו","name_en":"TBD","position":"DF","number":2,"tier":4,"price":2,"overall_rank":97,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":1302,"name_he":"דניאל טישלר","name_en":"TBD","position":"DF","number":3,"tier":4,"price":1,"overall_rank":109,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":1303,"name_he":"ז'וטה","name_en":"TBD","position":"DF","number":5,"tier":4,"price":3,"overall_rank":121,"rated":true,"nationality":"פורטוגל","is_club_captain":false},{"id":1304,"name_he":"משה מאיר","name_en":"TBD","position":"MF","number":6,"tier":5,"price":1,"overall_rank":133,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":1305,"name_he":"מקסים פלקושצ'נקו","name_en":"TBD","position":"MF","number":7,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1306,"name_he":"עידן ברנס","name_en":"TBD","position":"FW","number":8,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1307,"name_he":"משה סמל","name_en":"TBD","position":"MF","number":10,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1308,"name_he":"דוד אסנקה","name_en":"TBD","position":"FW","number":11,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1309,"name_he":"הוד מסיקה","name_en":"TBD","position":"MF","number":14,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1310,"name_he":"עמית צור","name_en":"TBD","position":"FW","number":15,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1311,"name_he":"עומר יצחק","name_en":"TBD","position":"DF","number":17,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1312,"name_he":"אולי ברגמן","name_en":"TBD","position":"GK","number":18,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1313,"name_he":"כריסטופר בוניפייס","name_en":"TBD","position":"MF","number":20,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"בלגיה","is_club_captain":false},{"id":1314,"name_he":"עידו עולי","name_en":"TBD","position":"MF","number":21,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1315,"name_he":"סרג'אן מיאיולוביץ'","name_en":"TBD","position":"MF","number":22,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"סרביה","is_club_captain":false},{"id":1316,"name_he":"תמיר גלזר","name_en":"TBD","position":"MF","number":24,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1317,"name_he":"אופק עובדיה","name_en":"TBD","position":"MF","number":27,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1318,"name_he":"פארד אברהם","name_en":"TBD","position":"DF","number":33,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"גאנה","is_club_captain":false},{"id":1319,"name_he":"דודי טויטו","name_en":"TBD","position":"DF","number":36,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1320,"name_he":"עידו מזרחי","name_en":"TBD","position":"MF","number":37,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1321,"name_he":"מרסיו סילבה","name_en":"TBD","position":"DF","number":44,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ברזיל","is_club_captain":false},{"id":1322,"name_he":"עמית רייף","name_en":"TBD","position":"GK","number":55,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1323,"name_he":"ליאם אלוק","name_en":"TBD","position":"MF","number":77,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1324,"name_he":"תומר הרן","name_en":"TBD","position":"GK","number":98,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1325,"name_he":"לואן קמפוס","name_en":"TBD","position":"FW","number":99,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ברזיל","is_club_captain":false},{"id":1326,"name_he":"מתן חוזז","name_en":"TBD","position":"MF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1327,"name_he":"מריוס נוביסי","name_en":"TBD","position":"FW","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"קמרון","is_club_captain":false}]},{"team_id":14,"name_he":"הפועל פתח תקווה","name_en":"Hapoel Petah Tikva","short":"הפ״ת","city":"פתח תקווה","stadium":null,"players":[{"id":1401,"name_he":"עומר כץ","name_en":"TBD","position":"GK","number":1,"tier":4,"price":2,"overall_rank":98,"rated":true,"nationality":"ישראל","is_club_captain":true},{"id":1402,"name_he":"אבישי כהן","name_en":"TBD","position":"DF","number":null,"tier":4,"price":2,"overall_rank":110,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":1403,"name_he":"אלכס מוקטו-מוסונדה","name_en":"TBD","position":"DF","number":5,"tier":4,"price":2,"overall_rank":122,"rated":true,"nationality":"זימבבואה","is_club_captain":false},{"id":1404,"name_he":"שביט מזל","name_en":"TBD","position":"FW","number":7,"tier":5,"price":1,"overall_rank":134,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":1405,"name_he":"תומר אלטמן","name_en":"TBD","position":"MF","number":8,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1406,"name_he":"רוי דוד","name_en":"TBD","position":"MF","number":16,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1407,"name_he":"ציפיקה סонגה","name_en":"TBD","position":"FW","number":17,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"זמביה","is_club_captain":false},{"id":1408,"name_he":"עמית משוח","name_en":"TBD","position":"GK","number":18,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1409,"name_he":"קארים קิมבדי","name_en":"TBD","position":"MF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"הרפובליקה הדמוקרטית של קונגו","is_club_captain":false},{"id":1410,"name_he":"סתיו ישראלי","name_en":"TBD","position":"DF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1411,"name_he":"רוי ששון","name_en":"TBD","position":"GK","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1412,"name_he":"יער זמברובסקי","name_en":"TBD","position":"DF","number":26,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1413,"name_he":"בוני אמיאן","name_en":"TBD","position":"MF","number":29,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"אירלנד","is_club_captain":false},{"id":1414,"name_he":"גיא בדש","name_en":"TBD","position":"MF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1415,"name_he":"יזן נסאר","name_en":"TBD","position":"DF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1416,"name_he":"אוקלידס אנדרדה","name_en":"TBD","position":"FW","number":77,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"כף ורדה","is_club_captain":false},{"id":1417,"name_he":"הראל שלום","name_en":"TBD","position":"DF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false}]}]}$json$;
  v_league UUID;
  v_season UUID;
  t        JSONB;
  p        JSONB;
  v_team   UUID;
  v_player UUID;
  v_pos    core.position;
BEGIN
  ----------------------------------------------------------------- ליגה
  INSERT INTO core.leagues (code, country_code, default_locale, timezone, names, squad_size)
  VALUES ('IL_PREMIER', 'IL', 'he', 'Asia/Jerusalem',
          jsonb_build_object(
            'he', jsonb_build_object('full', payload->'league'->>'name_he'),
            'en', jsonb_build_object('full', payload->'league'->>'name_en')),
          11)
  ON CONFLICT (code) DO UPDATE SET names = EXCLUDED.names
  RETURNING id INTO v_league;

  INSERT INTO core.external_refs (provider, entity_type, external_id, entity_id)
  VALUES ('manual_json', 'league', payload->'league'->>'id', v_league)
  ON CONFLICT (provider, entity_type, external_id)
  DO UPDATE SET entity_id = EXCLUDED.entity_id, synced_at = now();

  ----------------------------------------------------------------- עונה
  INSERT INTO core.seasons (league_id, label, starts_on, ends_on, is_current)
  VALUES (v_league, payload->'league'->>'season', DATE '2026-08-01', DATE '2027-05-30', TRUE)
  ON CONFLICT (league_id, label) DO UPDATE SET is_current = TRUE
  RETURNING id INTO v_season;

  ---------------------------------------------------------------- קבוצות
  FOR t IN SELECT * FROM jsonb_array_elements(payload->'teams') LOOP
    SELECT entity_id INTO v_team FROM core.external_refs
     WHERE provider = 'manual_json' AND entity_type = 'team'
       AND external_id = t->>'team_id';

    IF v_team IS NULL THEN
      INSERT INTO core.teams (country_code, names, short_code)
      VALUES ('IL',
              jsonb_build_object(
                'he', jsonb_build_object('full', t->>'name_he'),
                'en', jsonb_build_object('full', t->>'name_en')),
              left(t->>'name_en', 3))
      RETURNING id INTO v_team;

      INSERT INTO core.external_refs (provider, entity_type, external_id, entity_id, payload)
      VALUES ('manual_json', 'team', t->>'team_id', v_team, t - 'players');
    ELSE
      -- מיזוג ולא דריסה: עברית שהוזנה ידנית לא נמחקת
      UPDATE core.teams
         SET names = names || jsonb_build_object(
               'he', jsonb_build_object('full', t->>'name_he'),
               'en', jsonb_build_object('full', t->>'name_en'))
       WHERE id = v_team;
    END IF;

    INSERT INTO core.team_seasons (team_id, season_id)
    VALUES (v_team, v_season) ON CONFLICT DO NOTHING;

    INSERT INTO core.entity_aliases (entity_type, entity_id, locale, alias, source)
    VALUES ('team', v_team, 'he', t->>'name_he', 'manual_json'),
           ('team', v_team, 'en', t->>'name_en', 'manual_json')
    ON CONFLICT DO NOTHING;

    -------------------------------------------------------------- שחקנים
    FOR p IN SELECT * FROM jsonb_array_elements(t->'players') LOOP
      v_pos := CASE p->>'position'
                 WHEN 'GK' THEN 'GK'
                 WHEN 'DF' THEN 'DEF'
                 WHEN 'MF' THEN 'MID'
                 WHEN 'FW' THEN 'FWD'
                 ELSE 'MID'
               END::core.position;

      SELECT entity_id INTO v_player FROM core.external_refs
       WHERE provider = 'manual_json' AND entity_type = 'player'
         AND external_id = p->>'id';

      IF v_player IS NULL THEN
        INSERT INTO core.players (names, nationality, primary_position)
        VALUES (jsonb_build_object(
                  'he', jsonb_build_object('full', p->>'name_he'),
                  'en', jsonb_build_object('full', p->>'name_en')),
                'IL', v_pos)
        RETURNING id INTO v_player;

        INSERT INTO core.external_refs (provider, entity_type, external_id, entity_id, payload)
        VALUES ('manual_json', 'player', p->>'id', v_player, p);
      ELSE
        UPDATE core.players
           SET names = names || jsonb_build_object(
                 'he', jsonb_build_object('full', p->>'name_he'),
                 'en', jsonb_build_object('full', p->>'name_en')),
               primary_position = v_pos,
               updated_at = now()
         WHERE id = v_player;
      END IF;

      INSERT INTO core.entity_aliases (entity_type, entity_id, locale, alias, source)
      VALUES ('player', v_player, 'he', p->>'name_he', 'manual_json'),
             ('player', v_player, 'en', p->>'name_en', 'manual_json')
      ON CONFLICT DO NOTHING;

      -- ★ `fantasy_price` — היה חסר, וזה ביטל את התקציב בשרת.
      --
      --   ה-payload תמיד הכיל `price`, אבל ה-INSERT לא מיפה אותו.
      --   התוצאה: `fantasy_price` היה NULL ל-351 השחקנים, ו-
      --   `submit_entry` שקורא `COALESCE(sq.fantasy_price, 0)`
      --   תמחר כל הרכב ב-0. כלומר תקציב דוביד 5 נאכף **רק
      --   בדפדפן** — ומי ששלח בקשה ישירות יכול היה לקחת חמישה
      --   שחקנים במחיר מלא.
      --
      --   הבאג לא נראה בשום מסך: הממשק מחשב מחיר מ-`data/squads.ts`
      --   ומציג את הפס הנכון. רק השרת לא ידע.
      INSERT INTO core.squads (season_id, team_id, player_id, shirt_number, position,
                               fantasy_price, valid_from)
      VALUES (v_season, v_team, v_player, (p->>'number')::smallint, v_pos,
              NULLIF(p->>'price', '')::NUMERIC, DATE '2026-08-01')
      ON CONFLICT (season_id, team_id, player_id, valid_from)
      DO UPDATE SET shirt_number  = EXCLUDED.shirt_number,
                    position      = EXCLUDED.position,
                    -- מחיר שנקבע ידנית באדמין מנצח את הסיד.
                    fantasy_price = COALESCE(core.squads.fantasy_price,
                                             EXCLUDED.fantasy_price),
                    status        = 'active',
                    valid_to      = NULL;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'סיד הושלם: % קבוצות, % שחקנים',
    jsonb_array_length(payload->'teams'),
    (SELECT count(*) FROM core.squads WHERE season_id = v_season);
END
$seed$;

-- ---------------------------------------------------------------------
-- בדיקת שפיות: כמה קבוצות יש, וכמה צריך כדי להרכיב 11 עם שחקן אחד לקבוצה
-- ---------------------------------------------------------------------
DO $check$
DECLARE
  v_teams SMALLINT;
  v_need  SMALLINT;
BEGIN
  SELECT count(*) INTO v_teams
  FROM core.team_seasons ts
  JOIN core.seasons s ON s.id = ts.season_id AND s.is_current
  JOIN core.leagues l ON l.id = s.league_id AND l.code = 'IL_PREMIER';

  SELECT squad_size INTO v_need FROM core.leagues WHERE code = 'IL_PREMIER';

  IF v_teams < v_need THEN
    RAISE WARNING
      'יש % קבוצות בעונה הנוכחית אבל ההרכב דורש % שחקנים משוֹנות. חסרות % קבוצות.',
      v_teams, v_need, v_need - v_teams;
  END IF;
END
$check$;


-- =====================================================================
-- ▼▼▼  04_ranking_and_events.sql  —  לוג אירועים, דירוג, יומן ביקורת
-- =====================================================================

-- =====================================================================
--  Dubid · מיגרציה 04 — דירוג דטרמיניסטי + לוג אירועים
--
--  שני שינויים, שניהם additive. אין DROP, אין שינוי טיפוס, ואין
--  נגיעה בעמודה קיימת — מיגרציה שאפשר להריץ על production חי.
--
--  1. lineup_scores — נקודות דיפרנציאל ותיעוד שובר השוויון.
--  2. core.match_events — הלוג הקנוני, append-only.
-- =====================================================================

SET search_path = core, game, public;

-- ---------------------------------------------------------------------
-- 1. דירוג
-- ---------------------------------------------------------------------
ALTER TABLE game.lineup_scores
  ADD COLUMN IF NOT EXISTS differential_points NUMERIC(8,2) NOT NULL DEFAULT 0,
  -- האם השוויון נשאר בלתי פתור גם אחרי כל שוברי השוויון.
  ADD COLUMN IF NOT EXISTS tied                BOOLEAN NOT NULL DEFAULT FALSE,
  -- באיזה שלב נשבר השוויון. NULL = לא היה שוויון.
  -- נשמר כדי שהמסך יוכל לומר "הוכרע לפי הקפטן" ולא להשאיר את
  -- המשתמש בלי הסבר למה הוא מתחת למישהו עם אותו ניקוד בדיוק.
  ADD COLUMN IF NOT EXISTS tie_broken_by       TEXT;

ALTER TABLE game.lineup_scores
  DROP CONSTRAINT IF EXISTS lineup_scores_tie_broken_by_check;
ALTER TABLE game.lineup_scores
  ADD CONSTRAINT lineup_scores_tie_broken_by_check
  CHECK (tie_broken_by IS NULL OR tie_broken_by IN (
    'total','captain','differential','goals',
    'assists','clean_sheets','other','submitted_at'
  ));

-- דירוג נקרא הרבה יותר משהוא נכתב.
CREATE INDEX IF NOT EXISTS lineup_scores_gw_rank_idx
  ON game.lineup_scores (gameweek_id, rank);

-- ---------------------------------------------------------------------
-- 2. לוג האירועים
-- ---------------------------------------------------------------------
-- ★ הטבלה הזו היא מקור האמת של "מה קרה במגרש".
--   כל מצב משחק קורא ממנה ומפרש בעצמו. אין טבלה שנייה.
CREATE TABLE IF NOT EXISTS core.match_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id    UUID NOT NULL REFERENCES core.weekly_matches(id) ON DELETE CASCADE,
  gameweek_id   UUID NOT NULL REFERENCES game.gameweeks(id) ON DELETE CASCADE,

  -- ★ הסדר הקנוני. ייחודי למשחק, ולא תלוי בשעון.
  seq           INTEGER NOT NULL,

  kind          TEXT NOT NULL,
  phase         TEXT NOT NULL CHECK (phase IN ('1H','2H','ET1','ET2','PENS')),
  minute        SMALLINT NOT NULL CHECK (minute BETWEEN 0 AND 130),
  stoppage      SMALLINT NOT NULL DEFAULT 0,

  team_id       UUID NOT NULL REFERENCES core.teams(id),
  player_id     UUID REFERENCES core.players(id),
  related_player_id UUID REFERENCES core.players(id),

  source        TEXT NOT NULL CHECK (source IN ('provider','admin','correction','derived')),
  confidence    TEXT NOT NULL DEFAULT 'verified'
                CHECK (confidence IN ('verified','provisional')),

  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- תיקונים: מצביעים על אירוע קודם. לעולם לא מוחקים שורה.
  target_seq    INTEGER,
  correction    TEXT CHECK (correction IN ('void','replace')),
  reason        TEXT,

  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (fixture_id, seq),

  -- אירוע תיקון חייב מטרה; אירוע רגיל אסור לו מטרה.
  CONSTRAINT match_events_correction_shape CHECK (
    (kind = 'correction' AND target_seq IS NOT NULL AND correction IS NOT NULL)
    OR
    (kind <> 'correction' AND target_seq IS NULL AND correction IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS match_events_fixture_seq_idx
  ON core.match_events (fixture_id, seq);
CREATE INDEX IF NOT EXISTS match_events_gameweek_idx
  ON core.match_events (gameweek_id);
CREATE INDEX IF NOT EXISTS match_events_player_idx
  ON core.match_events (player_id) WHERE player_id IS NOT NULL;

-- ★ append-only, נאכף במסד ולא בנימוס.
--   בלי זה, "ההיסטוריה נשמרת" היא הבטחה ולא תכונה.
CREATE OR REPLACE FUNCTION core.match_events_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'core.match_events היא append-only. לביטול אירוע יש להוסיף שורת correction.';
END;
$$;

DROP TRIGGER IF EXISTS match_events_no_update ON core.match_events;
CREATE TRIGGER match_events_no_update
  BEFORE UPDATE OR DELETE ON core.match_events
  FOR EACH ROW EXECUTE FUNCTION core.match_events_append_only();

-- ---------------------------------------------------------------------
-- 3. יומן ביקורת לשינויי אדמין
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game.audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor       TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   TEXT,
  action      TEXT NOT NULL,
  old_value   JSONB,
  new_value   JSONB,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_entity_idx
  ON game.audit_logs (entity, entity_id, created_at DESC);


-- =====================================================================
-- ▼▼▼  05_gameweek_lock.sql  —  נעילה סמכותית + שעון שרת
-- =====================================================================

-- =====================================================================
--  Dubid · מיגרציה 05 — מחזור מלא + נעילה סמכותית בצד שרת
--
--  ★ זו המיגרציה שהופכת את דוביד למשחק תחרותי הוגן.
--
--  עד כה הנעילה הייתה בקליינט בלבד. משמעות מעשית: מי שהזיז את
--  שעון המכשיר, או שלח בקשה ישירות ל-API, יכול היה להגיש הרכב
--  אחרי שראה את ההרכבים של האחרים. זו לא "בעיית UX" — זו פרצה
--  שמבטלת את התחרות.
--
--  הדפוס לקוח מ-OFFSIDES (`submit_bet` ב-patch-v18.9.69): פונקציית
--  SECURITY DEFINER היא **נתיב הכתיבה היחיד**. הקליינט לא כותב
--  לטבלה ישירות — לא כי הוא מנומס, אלא כי RLS לא מרשה לו.
--
--  אידמפוטנטי. additive בלבד. אפשר להריץ על production חי.
-- =====================================================================

SET search_path = core, game, public;

-- ---------------------------------------------------------------------
-- 1. מחזור: מחזור חיים מלא
-- ---------------------------------------------------------------------
--   DRAFT → OPEN → LOCKED → LIVE → SCORING → PUBLISHED → ARCHIVED
--
-- הערכים הישנים ממופים: upcoming → draft, settled → published.
-- מרחיבים את ה-CHECK *לפני* המיפוי, אחרת העדכון עצמו ייפסל.

ALTER TABLE game.gameweeks DROP CONSTRAINT IF EXISTS gameweeks_status_check;
ALTER TABLE game.gameweeks ADD CONSTRAINT gameweeks_status_check
  CHECK (status IN (
    'upcoming','settled',                                   -- ישן, בדרך החוצה
    'draft','open','locked','live','scoring','published','archived'
  ));

UPDATE game.gameweeks SET status = 'draft'     WHERE status = 'upcoming';
UPDATE game.gameweeks SET status = 'published' WHERE status = 'settled';

-- עכשיו אפשר לצמצם לערכים החוקיים בלבד.
ALTER TABLE game.gameweeks DROP CONSTRAINT IF EXISTS gameweeks_status_check;
ALTER TABLE game.gameweeks ADD CONSTRAINT gameweeks_status_check
  CHECK (status IN ('draft','open','locked','live','scoring','published','archived'));

ALTER TABLE game.gameweeks
  -- `lock_at` נשאר מקור האמת לדדליין. העמודה הזו היא נוחות קריאה.
  ADD COLUMN IF NOT EXISTS first_kickoff_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_at     TIMESTAMPTZ;

-- ---------------------------------------------------------------------
-- 2. הרכב: מצב משחק + snapshot מלא
-- ---------------------------------------------------------------------
ALTER TABLE game.user_lineups
  -- ★ בלי זה אי אפשר להחזיק שני מצבי משחק לאותו משתמש באותו מחזור.
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'five'
    CHECK (mode IN ('five','full'));

-- הרכב אחד למשתמש **לכל מצב** — לא אחד למחזור.
ALTER TABLE game.user_lineups DROP CONSTRAINT IF EXISTS user_lineups_user_id_gameweek_id_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_lineups_user_gw_mode_key'
  ) THEN
    ALTER TABLE game.user_lineups
      ADD CONSTRAINT user_lineups_user_gw_mode_key UNIQUE (user_id, gameweek_id, mode);
  END IF;
END $$;

-- ★ §10 — snapshot של השחקן ברגע ההגשה.
--   שווי שחקן משתנה במהלך העונה. בלי הקפאה, הרכב מלפני חודש
--   "יתייקר" רטרואקטיבית ויֵראה כאילו חרג מהתקציב. ההיסטוריה
--   חייבת להישאר נכונה לרגע שבו היא נוצרה.
ALTER TABLE game.user_lineup_slots
  ADD COLUMN IF NOT EXISTS price NUMERIC(5,1) NOT NULL DEFAULT 0;

COMMENT ON COLUMN game.user_lineup_slots.price IS
  'שווי השחקן ברגע ההגשה. קפוא. שינוי מחיר מאוחר לא נוגע בהרכב היסטורי.';

-- ---------------------------------------------------------------------
-- 3. זמן שרת — ל-serverTime.ts בקליינט
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.server_now()
RETURNS BIGINT LANGUAGE sql STABLE AS $$
  SELECT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT;
$$;

GRANT EXECUTE ON FUNCTION public.server_now() TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. ★ הגשת הרכב — נתיב הכתיבה היחיד
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION game.submit_lineup(
  p_gameweek_id UUID,
  p_mode        TEXT,
  p_formation   TEXT,
  -- [{slot_no, player_id, is_captain, is_vice, is_bench}, ...]
  p_slots       JSONB
)
RETURNS game.user_lineups
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE
  v_user     UUID := auth.uid();
  v_gw       game.gameweeks;
  v_lineup   game.user_lineups;
  v_slot     JSONB;
  v_player   core.players;
  v_team     UUID;
  v_position core."position";
  v_price    NUMERIC(5,1);
  v_captains INT;
  v_vices    INT;
  v_count    INT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_mode NOT IN ('five','full') THEN RAISE EXCEPTION 'INVALID_MODE'; END IF;
  IF jsonb_typeof(p_slots) <> 'array' THEN RAISE EXCEPTION 'INVALID_SLOTS'; END IF;

  -- ★★ הנעילה. שתי בדיקות, ושתיהן חייבות לעבור. ★★
  --
  --  1. הסטטוס — אדמין יכול לנעול מוקדם.
  --  2. `now()` של המסד מול lock_at — cron יכול לאחר בדקה, ובדקה
  --     הזו אסור שתתקבל הגשה. שעון המסד הוא היחיד שקובע.
  --
  --  שום דבר מהקליינט לא משתתף בהחלטה הזו.
  SELECT * INTO v_gw FROM game.gameweeks WHERE id = p_gameweek_id FOR UPDATE;
  IF v_gw.id IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND'; END IF;
  IF v_gw.status <> 'open' THEN RAISE EXCEPTION 'GAMEWEEK_LOCKED'; END IF;
  IF now() >= v_gw.lock_at THEN RAISE EXCEPTION 'DEADLINE_PASSED'; END IF;

  v_count := jsonb_array_length(p_slots);
  IF p_mode = 'five' AND v_count <> 5  THEN RAISE EXCEPTION 'LINEUP_SIZE'; END IF;
  IF p_mode = 'full' AND v_count <> 11 THEN RAISE EXCEPTION 'LINEUP_SIZE'; END IF;

  -- קפטן אחד בדיוק; סגן אחד לכל היותר.
  SELECT count(*) FILTER (WHERE (s->>'is_captain')::BOOLEAN),
         count(*) FILTER (WHERE (s->>'is_vice')::BOOLEAN)
    INTO v_captains, v_vices
    FROM jsonb_array_elements(p_slots) s;
  IF v_captains <> 1 THEN RAISE EXCEPTION 'CAPTAIN_REQUIRED'; END IF;
  IF v_vices > 1     THEN RAISE EXCEPTION 'VICE_DUPLICATE'; END IF;

  -- upsert ההרכב עצמו
  INSERT INTO game.user_lineups (user_id, gameweek_id, mode, formation, status, submitted_at)
  VALUES (v_user, p_gameweek_id, p_mode, p_formation, 'submitted', now())
  ON CONFLICT (user_id, gameweek_id, mode) DO UPDATE
    SET formation    = EXCLUDED.formation,
        status       = 'submitted',
        -- ★ החותמת מתעדכנת בכל הגשה מחדש. היא שובר השוויון האחרון,
        --   ולכן חייבת לשקף את ההגשה שנספרת בפועל ולא את הראשונה.
        submitted_at = now()
  RETURNING * INTO v_lineup;

  -- משבצות נכתבות מאפס בכל הגשה
  DELETE FROM game.user_lineup_slots WHERE lineup_id = v_lineup.id;

  FOR v_slot IN SELECT * FROM jsonb_array_elements(p_slots) LOOP
    SELECT * INTO v_player FROM core.players WHERE id = (v_slot->>'player_id')::UUID;
    IF v_player.id IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND: %', v_slot->>'player_id'; END IF;

    -- ★ הקבוצה, העמדה והשווי נלקחים מהמסד — לא מהקליינט.
    --   קליינט שישלח price=0 לא יקבל שחקן בחינם.
    --
    -- ★★ תוקן אחרי הרצה על מסד אמיתי ★★
    --
    --  הגרסה הקודמת קראה ל-`v_player.position` ול-`squads.price`.
    --  שתי העמודות לא קיימות: בשחקן העמודה היא `primary_position`,
    --  ובסגל היא `position`; המחיר הוא `fantasy_price`.
    --
    --  התוצאה הייתה ש**נתיב הכתיבה היחיד של הרכבים קרס תמיד**:
    --    ERROR: record "v_player" has no field "position"
    --
    --  הנעילה עצמה עבדה (הגשה אחרי הדדליין נדחתה כראוי), ולכן
    --  הבדיקה השטחית עברה — אבל אף הרכב תקין לא יכול היה להישמר.
    --  בדיקה שבודקת רק את מקרה הכישלון מפספסת בדיוק את זה.
    --
    --  העמדה נלקחת מ**שורת הסגל** ולא מהשחקן, וזה גם נכון יותר:
    --  שחקן יכול לשחק בעמדה אחת בקבוצה אחת ובאחרת במקום אחר.
    --  שורת הסגל היא האמת לעונה הזו.
    SELECT sq.team_id, sq.position, COALESCE(sq.fantasy_price, 0)
      INTO v_team, v_position, v_price
      FROM core.squads sq
     WHERE sq.player_id = v_player.id
       AND sq.season_id = (SELECT season_id FROM game.gameweeks WHERE id = p_gameweek_id)
       AND sq.valid_to IS NULL          -- שורת הסגל הפעילה בלבד
       AND sq.status   = 'active'
     ORDER BY sq.valid_from DESC
     LIMIT 1;
    IF v_team IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_IN_SQUAD: %', v_player.id; END IF;

    INSERT INTO game.user_lineup_slots
      (lineup_id, slot_no, player_id, team_id, position, price,
       is_captain, is_vice, is_bench)
    VALUES (
      v_lineup.id,
      (v_slot->>'slot_no')::SMALLINT,
      v_player.id,
      v_team,
      v_position,
      v_price,
      COALESCE((v_slot->>'is_captain')::BOOLEAN, FALSE),
      COALESCE((v_slot->>'is_vice')::BOOLEAN, FALSE),
      COALESCE((v_slot->>'is_bench')::BOOLEAN, FALSE)
    );
  END LOOP;

  -- האילוצים one_player_per_team / no_duplicate_player נאכפים
  -- על ידי המסד עצמו ויזרקו כאן אם הופרו. שכבת הגנה שלישית.

  RETURN v_lineup;
END;
$$;

GRANT EXECUTE ON FUNCTION game.submit_lineup(UUID, TEXT, TEXT, JSONB) TO authenticated;

-- ---------------------------------------------------------------------
-- 5. מעבר מצב מבוקר — לאדמין ול-cron
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION game.set_gameweek_status(
  p_gameweek_id UUID,
  p_status      TEXT,
  p_actor       TEXT DEFAULT 'system',
  p_reason      TEXT DEFAULT NULL
)
RETURNS game.gameweeks
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE
  v_gw  game.gameweeks;
  v_ok  BOOLEAN;
BEGIN
  SELECT * INTO v_gw FROM game.gameweeks WHERE id = p_gameweek_id FOR UPDATE;
  IF v_gw.id IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND'; END IF;

  -- ★ אותה מפת מעברים בדיוק שב-`src/lib/gameweek.ts`.
  --   שתי רשימות שאמורות להיות זהות הן חוב טכני מוכר; הן קטנות,
  --   יציבות, ומכוסות בבדיקה שמשווה ביניהן.
  v_ok := CASE v_gw.status
    WHEN 'draft'     THEN p_status = 'open'
    WHEN 'open'      THEN p_status IN ('locked','draft')
    WHEN 'locked'    THEN p_status IN ('live','open')
    WHEN 'live'      THEN p_status = 'scoring'
    WHEN 'scoring'   THEN p_status IN ('published','live')
    WHEN 'published' THEN p_status IN ('archived','scoring')
    ELSE FALSE
  END;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: % -> %', v_gw.status, p_status;
  END IF;

  UPDATE game.gameweeks
     SET status = p_status,
         published_at = CASE WHEN p_status = 'published' THEN now() ELSE published_at END
   WHERE id = p_gameweek_id
   RETURNING * INTO v_gw;

  INSERT INTO game.audit_logs (actor, entity, entity_id, action, old_value, new_value, reason)
  VALUES (p_actor, 'gameweek', p_gameweek_id::TEXT, 'status_change',
          jsonb_build_object('status', v_gw.status),
          jsonb_build_object('status', p_status),
          p_reason);

  RETURN v_gw;
END;
$$;

-- ---------------------------------------------------------------------
-- 6. RLS — הקליינט קורא, רק הפונקציות כותבות
-- ---------------------------------------------------------------------
ALTER TABLE game.user_lineups      ENABLE ROW LEVEL SECURITY;
ALTER TABLE game.user_lineup_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lineups_owner_read ON game.user_lineups;
CREATE POLICY lineups_owner_read ON game.user_lineups
  FOR SELECT USING (
    user_id = auth.uid()
    -- הרכב של אחרים נחשף רק אחרי הנעילה. לפני כן זו העתקה.
    OR EXISTS (
      SELECT 1 FROM game.gameweeks g
       WHERE g.id = gameweek_id
         AND g.status IN ('locked','live','scoring','published','archived')
    )
  );

-- ★ אין policy ל-INSERT/UPDATE/DELETE — בכוונה.
--   הדרך היחידה לכתוב היא `submit_lineup`, שהיא SECURITY DEFINER
--   ולכן עוקפת RLS אחרי שהיא בדקה את הדדליין. זו הנעילה.

DROP POLICY IF EXISTS slots_read ON game.user_lineup_slots;
CREATE POLICY slots_read ON game.user_lineup_slots
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM game.user_lineups l WHERE l.id = lineup_id)
  );

NOTIFY pgrst, 'reload schema';


-- =====================================================================
-- ▼▼▼  06_private_leagues.sql  —  טבלאות הזירות
-- =====================================================================

-- =====================================================================
--  Dubid · מיגרציה 06 — ליגות פרטיות
--
--  MVP בלבד, לפי הברִיף: יצירה, הצטרפות, חברים, טבלה.
--  ★ מה שבמפורש *לא* נבנה כאן: צ׳אט, פיד, הודעות.
--    המטרה היא תחרות בין חברים, לא רשת חברתית.
--
--  אידמפוטנטי. additive בלבד.
-- =====================================================================

SET search_path = core, game, public;

CREATE TABLE IF NOT EXISTS game.leagues (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 40),
  -- קוד ההצטרפות. ייחודי גלובלית, אחרת קוד אחד יוביל לשתי ליגות.
  code        TEXT NOT NULL UNIQUE
              CHECK (code ~ '^[2-9A-HJKMNP-Z]{6}$'),
  owner_id    UUID NOT NULL REFERENCES game.users(id) ON DELETE CASCADE,
  -- ★ זירה פרטית (קוד) מול ליגה ציבורית (פתוחה לכולם).
  --   אותה טבלה, אותם שוברי שוויון, בלי קופה בשני המקרים.
  kind        TEXT NOT NULL DEFAULT 'arena' CHECK (kind IN ('arena','open')),
  -- ★ ליגה שייכת למצב משחק אחד. הברִיף אוסר למזג ניקוד של
  --   דוביד 5 ודוביד 11 לטבלה תחרותית אחת.
  mode        TEXT NOT NULL CHECK (mode IN ('five','full')),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  max_members INT CHECK (max_members IS NULL OR max_members BETWEEN 2 AND 10000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN game.leagues.code IS
  'אלפבית ללא 0/O/1/I/L — קוד שמוקרא בקול חייב להיות חד-משמעי.';

CREATE TABLE IF NOT EXISTS game.league_members (
  league_id   UUID NOT NULL REFERENCES game.leagues(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES game.users(id) ON DELETE CASCADE,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, user_id)     -- הצטרפות כפולה בלתי אפשרית במסד
);

CREATE INDEX IF NOT EXISTS league_members_user_idx ON game.league_members (user_id);

-- ---------------------------------------------------------------------
-- יצירה והצטרפות — RPC בלבד, כמו כל כתיבה תחרותית
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.create_league(
  p_name        TEXT,
  p_mode        TEXT,
  p_max_members INT DEFAULT NULL
)
RETURNS game.leagues
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE
  v_user   UUID := auth.uid();
  v_league game.leagues;
  v_code   TEXT;
  v_try    INT := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_mode NOT IN ('five','full') THEN RAISE EXCEPTION 'INVALID_MODE'; END IF;

  -- הגרלת קוד עד שנמצא פנוי. עם 31^6 ≈ 887 מיליון צירופים,
  -- התנגשות היא נדירה; הלולאה קיימת כדי שגם הנדיר לא ייכשל.
  LOOP
    v_try := v_try + 1;
    IF v_try > 10 THEN RAISE EXCEPTION 'CODE_GENERATION_FAILED'; END IF;

    SELECT string_agg(
             substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ',
                    (floor(random() * 31) + 1)::INT, 1), '')
      INTO v_code
      FROM generate_series(1, 6);

    EXIT WHEN NOT EXISTS (SELECT 1 FROM game.leagues WHERE code = v_code);
  END LOOP;

  INSERT INTO game.leagues (name, code, owner_id, mode, max_members)
  VALUES (btrim(p_name), v_code, v_user, p_mode, p_max_members)
  RETURNING * INTO v_league;

  -- היוצר הוא חבר. ליגה בלי היוצר שלה היא באג מחכה לקרות.
  INSERT INTO game.league_members (league_id, user_id)
  VALUES (v_league.id, v_user);

  RETURN v_league;
END;
$$;

CREATE OR REPLACE FUNCTION game.join_league(p_code TEXT)
RETURNS game.leagues
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE
  v_user   UUID := auth.uid();
  v_league game.leagues;
  v_count  INT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  -- נרמול זהה ל-`normalizeCode` בקליינט: אותיות גדולות, בלי
  -- מפרידים, ושומרים רק תווים מהאלפבית.
  p_code := regexp_replace(upper(btrim(p_code)), '[^2-9A-HJKMNP-Z]', '', 'g');
  IF length(p_code) <> 6 THEN RAISE EXCEPTION 'INVALID_CODE'; END IF;

  SELECT * INTO v_league FROM game.leagues WHERE code = p_code FOR UPDATE;
  IF v_league.id IS NULL       THEN RAISE EXCEPTION 'LEAGUE_NOT_FOUND'; END IF;
  IF v_league.status <> 'active' THEN RAISE EXCEPTION 'LEAGUE_CLOSED'; END IF;

  IF EXISTS (SELECT 1 FROM game.league_members
              WHERE league_id = v_league.id AND user_id = v_user) THEN
    RAISE EXCEPTION 'ALREADY_MEMBER';
  END IF;

  IF v_league.max_members IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM game.league_members WHERE league_id = v_league.id;
    IF v_count >= v_league.max_members THEN RAISE EXCEPTION 'LEAGUE_FULL'; END IF;
  END IF;

  INSERT INTO game.league_members (league_id, user_id) VALUES (v_league.id, v_user);
  RETURN v_league;
END;
$$;

GRANT EXECUTE ON FUNCTION game.create_league(TEXT, TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION game.join_league(TEXT)              TO authenticated;

-- ---------------------------------------------------------------------
-- RLS — רואים רק ליגות שאתם בהן
-- ---------------------------------------------------------------------
ALTER TABLE game.leagues        ENABLE ROW LEVEL SECURITY;
ALTER TABLE game.league_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leagues_member_read ON game.leagues;
CREATE POLICY leagues_member_read ON game.leagues
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM game.league_members m
             WHERE m.league_id = id AND m.user_id = auth.uid())
  );
-- ★ שימו לב מה *אין* כאן: חיפוש ליגות. ליגה פרטית מתגלה דרך קוד
--   בלבד, ולכן `join_league` (SECURITY DEFINER) היא הדרך היחידה
--   להגיע אליה בלי להיות חבר בה.

DROP POLICY IF EXISTS league_members_read ON game.league_members;
CREATE POLICY league_members_read ON game.league_members
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM game.league_members m
             WHERE m.league_id = league_id AND m.user_id = auth.uid())
  );

NOTIFY pgrst, 'reload schema';


-- =====================================================================
-- ▼▼▼  07_shared_supabase.sql  —  הרשאות ופרופיל
-- =====================================================================

-- =====================================================================
--  Dubid · מיגרציה 07 — פרויקט Supabase משותף עם אופסיידס
--
--  ★ התשובה הקצרה: כן, זה עובד, וזה בדיוק מה ש-schemas נועדו לו.
--
--  פרויקט אחד. חשבון אחד למשתמש. הפרדה מלאה בין המוצרים.
--
--     auth.users        ← זהות משותפת. חשבון אחד, שתי אפליקציות.
--     public.*          ← אופסיידס  (arenas, bets, matches, profiles)
--     core.*            ← דאטת כדורגל משותפת (teams, players, events)
--     game.*            ← דוביד     (lineups, scores, leagues)
--     shared.*          ← הגשר: פרסים חוצי־אפליקציות בלבד
--
--  ההפרדה נאכפת בארבע שכבות בלתי תלויות:
--    1. Schemas   — `game.leagues` ו-`public.arenas` לא יכולים להתנגש
--    2. Exposed schemas — PostgREST חושף רק את מה שברשימה
--    3. db.schema — הקליינט של דוביד מכוון ל-`game` ולא רואה `public`
--    4. RLS       — גם אם שכבה 1-3 נכשלו, השורה עדיין מוגנת
--
--  אידמפוטנטי.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. הרשאות לסכימות של דוביד
-- ---------------------------------------------------------------------
-- בלי אלה PostgREST יחזיר 404 גם כשהסכימה חשופה בהגדרות.
DO $$
DECLARE s TEXT;
BEGIN
  FOREACH s IN ARRAY ARRAY['core','game'] LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO anon, authenticated, service_role', s);
    EXECUTE format('GRANT ALL ON ALL TABLES    IN SCHEMA %I TO anon, authenticated, service_role', s);
    EXECUTE format('GRANT ALL ON ALL ROUTINES  IN SCHEMA %I TO anon, authenticated, service_role', s);
    EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA %I TO anon, authenticated, service_role', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA %I
                    GRANT ALL ON TABLES TO anon, authenticated, service_role', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA %I
                    GRANT ALL ON ROUTINES TO anon, authenticated, service_role', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA %I
                    GRANT ALL ON SEQUENCES TO anon, authenticated, service_role', s);
  END LOOP;
END $$;

-- ⚠ שלב ידני שאי אפשר לעשות ב-SQL:
--    Dashboard → Settings → API → Exposed schemas
--    להוסיף:  core, game, shared      (ולהשאיר את public לאופסיידס)

-- ---------------------------------------------------------------------
-- 2. זהות משותפת
-- ---------------------------------------------------------------------
-- ★ `game.users` הופך לפרופיל של דוביד ולא ל"טבלת משתמשים".
--   המשתמש עצמו חי ב-`auth.users`, ולשני המוצרים יש פרופיל משלהם
--   שמצביע עליו. אותו אדם, שני פרופילים, אפס צימוד:
--
--     auth.users.id ──┬── public.profiles   (אופסיידס: יתרה, 💨, אווטאר)
--                     └── game.users        (דוביד: שם תצוגה, העדפות)
--
--   כך אופסיידס יכול לשנות את מבנה הפרופיל שלו בלי לגעת בדוביד.
ALTER TABLE game.users
  ADD COLUMN IF NOT EXISTS auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS users_auth_idx ON game.users (auth_id);

COMMENT ON COLUMN game.users.auth_id IS
  'הזהות המשותפת. NULL = משתמש אורח שעדיין לא נרשם.';

-- פרופיל דוביד נוצר אוטומטית בכניסה ראשונה, בלי מסך הרשמה.
CREATE OR REPLACE FUNCTION game.ensure_profile(p_display_name TEXT DEFAULT NULL)
RETURNS game.users
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE
  v_auth UUID := auth.uid();
  v_user game.users;
BEGIN
  IF v_auth IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  SELECT * INTO v_user FROM game.users WHERE auth_id = v_auth;
  IF v_user.id IS NOT NULL THEN RETURN v_user; END IF;

  INSERT INTO game.users (auth_id, display_name)
  VALUES (v_auth, COALESCE(NULLIF(btrim(p_display_name), ''), 'שחקן דוביד'))
  RETURNING * INTO v_user;

  RETURN v_user;
END;
$$;

GRANT EXECUTE ON FUNCTION game.ensure_profile(TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. הגשר: פרסים חוצי־אפליקציות
-- ---------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS shared;

-- ★ זו הטבלה **היחידה** ששני המוצרים נוגעים בה.
--   דוביד כותב "מגיע ל-X פרס על ניצחון במחזור 7". אופסיידס קורא
--   וממש. אף אחד מהם לא נוגע בטבלאות של השני.
CREATE TABLE IF NOT EXISTS shared.reward_grants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  source_app    TEXT NOT NULL CHECK (source_app IN ('dubid','offsides')),
  target_app    TEXT NOT NULL CHECK (target_app IN ('dubid','offsides')),

  kind          TEXT NOT NULL,          -- 'smoke_grenade' | 'boost' | ...
  amount        INT  NOT NULL CHECK (amount > 0),
  reason        TEXT NOT NULL,          -- 'gameweek_win' | 'league_win' | ...

  -- ★ הגנה מפני כפילות, ברמת המסד ולא ברמת "נזהר בקוד".
  --   מפתח טבעי: מי · על מה · באיזה אירוע. ניסיון שני נדחה.
  idempotency_key TEXT NOT NULL UNIQUE,

  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','claimed','void')),
  claimed_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reward_grants_pending_idx
  ON shared.reward_grants (auth_id, target_app) WHERE status = 'pending';

GRANT USAGE ON SCHEMA shared TO anon, authenticated, service_role;
GRANT SELECT ON shared.reward_grants TO authenticated;

ALTER TABLE shared.reward_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rewards_own_read ON shared.reward_grants;
CREATE POLICY rewards_own_read ON shared.reward_grants
  FOR SELECT USING (auth_id = auth.uid());

-- ★ אין policy לכתיבה. הענקה ומימוש עוברים דרך הפונקציות למטה
--   בלבד — אחרת כל לקוח יכול להעניק לעצמו פרסים.

CREATE OR REPLACE FUNCTION shared.grant_reward(
  p_auth_id UUID, p_source TEXT, p_target TEXT,
  p_kind TEXT, p_amount INT, p_reason TEXT, p_key TEXT
)
RETURNS shared.reward_grants
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = shared, public
AS $$
DECLARE v_row shared.reward_grants;
BEGIN
  INSERT INTO shared.reward_grants
    (auth_id, source_app, target_app, kind, amount, reason, idempotency_key)
  VALUES (p_auth_id, p_source, p_target, p_kind, p_amount, p_reason, p_key)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING * INTO v_row;

  -- הענקה חוזרת מחזירה את הקיימת ולא נכשלת: מי שקורא פעמיים
  -- (retry של cron, לחיצה כפולה) מקבל את אותה תוצאה בדיוק.
  IF v_row.id IS NULL THEN
    SELECT * INTO v_row FROM shared.reward_grants WHERE idempotency_key = p_key;
  END IF;

  RETURN v_row;
END;
$$;

-- מימוש — נקרא מהאפליקציה **המקבלת**, אחרי שזיכתה את המשתמש.
CREATE OR REPLACE FUNCTION shared.claim_reward(p_id UUID)
RETURNS shared.reward_grants
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = shared, public
AS $$
DECLARE v_row shared.reward_grants;
BEGIN
  SELECT * INTO v_row FROM shared.reward_grants WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL           THEN RAISE EXCEPTION 'REWARD_NOT_FOUND'; END IF;
  IF v_row.auth_id <> auth.uid() THEN RAISE EXCEPTION 'NOT_YOURS'; END IF;
  IF v_row.status <> 'pending'   THEN RAISE EXCEPTION 'ALREADY_CLAIMED'; END IF;

  UPDATE shared.reward_grants
     SET status = 'claimed', claimed_at = now()
   WHERE id = p_id
   RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION shared.claim_reward(UUID) TO authenticated;
-- ★ `grant_reward` מכוון: **לא** ניתן ל-authenticated.
--   רק service_role (Edge Function) מעניק פרסים.

NOTIFY pgrst, 'reload schema';


-- =====================================================================
-- ▼▼▼  09_live_mvp.sql  —  הגשות, תוצאות, אדמין, RLS
-- =====================================================================

-- =====================================================================
--  DUBID · מיגרציה 09 — המשחק החי
--
--  ★ מה המיגרציה הזו עושה
--
--  היא הופכת את דוביד ממוצר שרץ על localStorage למוצר שרץ על
--  Supabase, בלי לגעת בסכימה שכבר קיימת. כל מה שנוסף כאן הוא
--  שכבה דקה מעל 01–08:
--
--     · תיקון שני באגים שחוסמים כתיבה (ראו §1, §2)
--     · פאסאדה של RPC שמדברת בשפת הקליינט (מזהים חיצוניים)
--     · אדמין: הזנת תוצאות ידנית ופרסום
--     · קודי גישה חד־פעמיים
--     · RLS אמיתי במקום GRANT ALL לכולם
--     · סיד של מחזור 2 והמשחקים שלו
--
--  אידמפוטנטי. additive בלבד. אפשר להריץ על מסד חי.
--
--  הרצה: db/01 → 02 → 03 → 04 → 05 → 06 → 07 → 09
--  (08 היה על דו־קיום בפרויקט משותף. הוא לא רלוונטי יותר —
--   לכל מוצר יש פרויקט משלו. ראו docs/SUPABASE.md.)
-- =====================================================================

SET search_path = core, game, public;

-- =====================================================================
-- §1 ★ הבאג שמנע מכל הרכב להישמר
-- =====================================================================
--
--  `game.user_lineups.user_id` הוא FK ל-`game.users(id)`.
--  מדיניות ה-RLS ב-02 בודקת `user_id = auth.uid()`.
--  `submit_lineup` ב-05 כותב `auth.uid()` ל-`user_id`.
--
--  שלושתם מניחים ש-`game.users.id = auth.uid()`.
--  `ensure_profile` ב-07 יוצר שורה עם `id = gen_random_uuid()`
--  ו-`auth_id` נפרד — כלומר ההנחה **לא** מתקיימת, וכל הגשה
--  נופלת על הפרה של מפתח זר.
--
--  התיקון: הפרופיל נוצר עם `id = auth.uid()`. זה מיישר את
--  שלושת המקומות בלי לשנות אף אחד מהם.
CREATE OR REPLACE FUNCTION game.ensure_profile(p_display_name TEXT DEFAULT NULL)
RETURNS game.users
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE
  v_auth UUID := auth.uid();
  v_user game.users;
BEGIN
  IF v_auth IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  SELECT * INTO v_user FROM game.users WHERE id = v_auth OR auth_id = v_auth;

  IF v_user.id IS NOT NULL THEN
    -- שם חדש מנצח שם ישן, אבל ריק לא מוחק שם קיים.
    IF NULLIF(btrim(p_display_name), '') IS NOT NULL
       AND v_user.display_name IS DISTINCT FROM btrim(p_display_name) THEN
      UPDATE game.users SET display_name = btrim(p_display_name)
       WHERE id = v_user.id RETURNING * INTO v_user;
    END IF;
    RETURN v_user;
  END IF;

  INSERT INTO game.users (id, auth_id, display_name)
  VALUES (v_auth, v_auth, COALESCE(NULLIF(btrim(p_display_name), ''), 'שחקן דוביד'))
  RETURNING * INTO v_user;

  RETURN v_user;
END;
$$;

GRANT EXECUTE ON FUNCTION game.ensure_profile(TEXT) TO authenticated;

-- =====================================================================
-- §2 עמודות זהות
-- =====================================================================
ALTER TABLE game.users
  ADD COLUMN IF NOT EXISTS offsides_user_id TEXT,
  ADD COLUMN IF NOT EXISTS offsides_email   TEXT,
  ADD COLUMN IF NOT EXISTS linked_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_admin         BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS users_offsides_uid
  ON game.users (offsides_user_id) WHERE offsides_user_id IS NOT NULL;

COMMENT ON COLUMN game.users.offsides_user_id IS
  'auth.users.id בפרויקט אופסיידס. זה כל הקשר בין שני המסדים — '
  'אין FK, כי הם לא באותו מסד. המיפוי נכתב אך ורק על ידי '
  'Edge Function שאימתה טוקן מול אופסיידס.';

-- =====================================================================
-- §3 קוד המחזור — כדי שהקליינט לא יצטרך להכיר UUID
-- =====================================================================
ALTER TABLE game.gameweeks ADD COLUMN IF NOT EXISTS code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS gameweeks_code ON game.gameweeks (code)
  WHERE code IS NOT NULL;

COMMENT ON COLUMN game.gameweeks.code IS
  'המזהה שהקליינט מכיר: ''gw-2''. UUID הוא פרט פנימי של המסד, '
  'ואין סיבה שהדפדפן יחזיק אותו.';


-- =====================================================================
-- §3b ★ שעון שרת בסכימת `game`
-- =====================================================================
--
--  הלקוח מוגדר `db: { schema: 'game' }`, ולכן `supabase.rpc(...)`
--  מחפש **תמיד** ב-`game` — גם עבור `server_now`, שיושבת
--  ב-`public`. התוצאה הייתה 404 שקט: `syncServerTime` נכשל בכל
--  דגימה, ההיסט נשאר 0, והספירה לאחור בלובי רצה על שעון המכשיר.
--
--  באג שלא מפיל שום מסך ומבטל בדיוק את התכונה שבגללה הפונקציה
--  קיימת. עטיפה של שורה אחת, ולא שינוי של מקור האמת ב-`public`
--  (שאסור לגעת בו — ראו docs/OFFSIDES-SYNC.md §5).
CREATE OR REPLACE FUNCTION game.server_now()
RETURNS BIGINT LANGUAGE sql STABLE AS $$ SELECT public.server_now() $$;
GRANT EXECUTE ON FUNCTION game.server_now() TO anon, authenticated;

-- =====================================================================
-- §3c הפרופיל שלי
-- =====================================================================
--
--  ★ למה RPC ולא `select` על `game.users`.
--
--  מדיניות הקריאה על הטבלה היא `USING (TRUE)` — היא חייבת להיות,
--  כי שם התצוגה מופיע בדירוג של כולם. אבל באותה שורה יושבים גם
--  `offsides_email` ו-`offsides_user_id`. `select *` מהדפדפן היה
--  מחזיר את המייל של כל משתמש אחר.
--
--  הפונקציה מחזירה **רק את השורה של הקורא**, ורק את השדות שהוא
--  צריך. הטבלה נשארת קריאה לשם התצוגה בלבד, דרך הפונקציות.
CREATE OR REPLACE FUNCTION game.me()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, public AS $$
  SELECT jsonb_build_object(
    'id',              u.id,
    'displayName',     u.display_name,
    'offsidesUserId',  u.offsides_user_id,
    'isAdmin',         u.is_admin
  )
  FROM game.users u WHERE u.id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION game.me() TO authenticated;

-- =====================================================================
-- §4 תרגום מזהים — חיצוני ↔ פנימי
-- =====================================================================
--
--  ★ למה פונקציות ולא JOIN בכל שאילתה
--
--  הקליינט מכיר 'T3' ו-'P305'. המסד מכיר UUID. המיפוי כבר קיים
--  ב-`core.external_refs` (provider='manual_json'), אבל אם כל
--  שאילתה תעשה אותו JOIN בעצמה, מספיק מקום אחד שישכח את התנאי
--  `provider=` כדי לקבל שחקן שגוי בשקט.
--
--  שתי פונקציות, שתי שורות, ואי אפשר לטעות.

CREATE OR REPLACE FUNCTION core.player_by_ext(p_ext TEXT)
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT entity_id FROM core.external_refs
   WHERE provider = 'manual_json' AND entity_type = 'player' AND external_id = p_ext;
$$;

CREATE OR REPLACE FUNCTION core.team_by_ext(p_ext TEXT)
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT entity_id FROM core.external_refs
   WHERE provider = 'manual_json' AND entity_type = 'team' AND external_id = p_ext;
$$;

/* הכיוון ההפוך, כ-view — כדי שאפשר יהיה לצרף אותו בשאילתה. */
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
DROP VIEW IF EXISTS core.v_ext;
CREATE VIEW core.v_ext AS
  SELECT entity_type, entity_id, external_id
    FROM core.external_refs WHERE provider = 'manual_json';

-- =====================================================================
-- §5 הגשת הרכב — נתיב הכתיבה היחיד, בשפת הקליינט
-- =====================================================================
--
--  עוטף את `game.submit_lineup` הקיים? לא. הוא מקבל UUID של מחזור
--  ושל שחקנים, וגם התיקון ב-§1 לא הופך אותו לנוח לקליינט. במקום
--  להוסיף שכבת תרגום בדפדפן — שם היא יכולה לשקר — התרגום קורה כאן,
--  וכל הבדיקות של 05 (נעילה, קפטן, גודל) חוזרות במלואן.
--
--  ★ הנעילה: שתי בדיקות, ושתיהן חייבות לעבור.
--     1. סטטוס המחזור — אדמין יכול לנעול מוקדם.
--     2. `now()` של המסד מול `lock_at` — cron יכול לאחר בדקה,
--        ובדקה הזו אסור שתתקבל הגשה.
--  שום דבר מהקליינט לא משתתף בהחלטה הזו.

CREATE OR REPLACE FUNCTION game.submit_entry(
  p_gw_code   TEXT,
  p_mode      TEXT,
  p_formation TEXT,
  -- [{"slot_no":1,"ext_player_id":"101","is_captain":true,"is_vice":false,"is_bench":false}, ...]
  p_slots     JSONB,
  p_display_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE
  v_auth     UUID := auth.uid();
  v_gw       game.gameweeks;
  v_lineup   game.user_lineups;
  v_slot     JSONB;
  v_player   UUID;
  v_team     UUID;
  v_position core."position";
  v_price    NUMERIC(5,1);
  v_captains INT;
  v_vices    INT;
  v_count    INT;
BEGIN
  IF v_auth IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_mode NOT IN ('five','full') THEN RAISE EXCEPTION 'INVALID_MODE'; END IF;
  IF jsonb_typeof(p_slots) <> 'array' THEN RAISE EXCEPTION 'INVALID_SLOTS'; END IF;

  PERFORM game.ensure_profile(p_display_name);

  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code FOR UPDATE;
  IF v_gw.id IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND: %', p_gw_code; END IF;
  IF v_gw.status NOT IN ('open','draft') THEN RAISE EXCEPTION 'GAMEWEEK_LOCKED'; END IF;
  IF now() >= v_gw.lock_at THEN RAISE EXCEPTION 'DEADLINE_PASSED'; END IF;

  v_count := jsonb_array_length(p_slots);
  IF p_mode = 'five' AND v_count <> 5  THEN RAISE EXCEPTION 'LINEUP_SIZE'; END IF;
  IF p_mode = 'full' AND v_count NOT BETWEEN 5 AND 11 THEN RAISE EXCEPTION 'LINEUP_SIZE'; END IF;

  SELECT count(*) FILTER (WHERE (s->>'is_captain')::BOOLEAN),
         count(*) FILTER (WHERE (s->>'is_vice')::BOOLEAN)
    INTO v_captains, v_vices
    FROM jsonb_array_elements(p_slots) s;
  IF v_captains <> 1 THEN RAISE EXCEPTION 'CAPTAIN_REQUIRED'; END IF;
  IF v_vices > 1     THEN RAISE EXCEPTION 'VICE_DUPLICATE'; END IF;

  INSERT INTO game.user_lineups (user_id, gameweek_id, mode, formation, status, submitted_at)
  VALUES (v_auth, v_gw.id, p_mode, p_formation, 'submitted', now())
  ON CONFLICT (user_id, gameweek_id, mode) DO UPDATE
    SET formation    = EXCLUDED.formation,
        status       = 'submitted',
        -- ★ החותמת מתעדכנת בכל הגשה מחדש. היא שובר השוויון האחרון,
        --   ולכן חייבת לשקף את ההגשה שנספרת בפועל.
        submitted_at = now()
  RETURNING * INTO v_lineup;

  DELETE FROM game.user_lineup_slots WHERE lineup_id = v_lineup.id;

  FOR v_slot IN SELECT * FROM jsonb_array_elements(p_slots) LOOP
    v_player := core.player_by_ext(v_slot->>'ext_player_id');
    IF v_player IS NULL THEN
      RAISE EXCEPTION 'PLAYER_NOT_FOUND: %', v_slot->>'ext_player_id';
    END IF;

    -- ★ הקבוצה, העמדה והשווי נלקחים מהמסד — לא מהקליינט.
    --   קליינט שישלח price=0 לא יקבל שחקן בחינם.
    SELECT sq.team_id, sq.position, COALESCE(sq.fantasy_price, 0)
      INTO v_team, v_position, v_price
      FROM core.squads sq
     WHERE sq.player_id = v_player
       AND sq.season_id = v_gw.season_id
       AND sq.valid_to IS NULL
       AND sq.status   = 'active'
     ORDER BY sq.valid_from DESC
     LIMIT 1;
    IF v_team IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_IN_SQUAD: %', v_player; END IF;

    INSERT INTO game.user_lineup_slots
      (lineup_id, slot_no, player_id, team_id, position, price, is_captain, is_vice, is_bench)
    VALUES (
      v_lineup.id, (v_slot->>'slot_no')::SMALLINT, v_player, v_team, v_position, v_price,
      COALESCE((v_slot->>'is_captain')::BOOLEAN, FALSE),
      COALESCE((v_slot->>'is_vice')::BOOLEAN, FALSE),
      COALESCE((v_slot->>'is_bench')::BOOLEAN, FALSE)
    );
  END LOOP;

  -- one_player_per_team / no_duplicate_player נאכפים על ידי המסד
  -- עצמו ויזרקו כאן אם הופרו. שכבת הגנה שלישית.

  RETURN jsonb_build_object(
    'id', v_lineup.id, 'gameweek', p_gw_code, 'mode', p_mode,
    'submitted_at', v_lineup.submitted_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION game.submit_entry(TEXT, TEXT, TEXT, JSONB, TEXT) TO authenticated;

/* ביטול הגשה — מותר רק כל עוד לא פורסמו תוצאות ולא עבר הדדליין. */
CREATE OR REPLACE FUNCTION game.withdraw_entry(p_gw_code TEXT, p_mode TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_auth UUID := auth.uid(); v_gw game.gameweeks;
BEGIN
  IF v_auth IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw.id IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND'; END IF;
  IF v_gw.status = 'published' THEN RAISE EXCEPTION 'ALREADY_PUBLISHED'; END IF;
  IF now() >= v_gw.lock_at THEN RAISE EXCEPTION 'DEADLINE_PASSED'; END IF;

  DELETE FROM game.user_lineups
   WHERE user_id = v_auth AND gameweek_id = v_gw.id AND mode = p_mode;
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION game.withdraw_entry(TEXT, TEXT) TO authenticated;

-- =====================================================================
-- §6 קריאה — הרכבים ותוצאות, בשפת הקליינט
-- =====================================================================
--
--  ★ למה כל ההגשות גלויות לכולם *אחרי* הנעילה, ורק אז.
--
--  לפני הנעילה, הרכב גלוי הוא העתקה. אחרי הנעילה, הרכב מוסתר הוא
--  לוח תוצאות בלי שקיפות. הפונקציה מחזירה מערך ריק כל עוד המחזור
--  פתוח — וזה מה שגורם לדירוג להיות ריק, נכון, ולא שקרי.

CREATE OR REPLACE FUNCTION game.entries(p_gw_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v_gw game.gameweeks; v_auth UUID := auth.uid();
BEGIN
  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw.id IS NULL THEN RETURN '[]'::jsonb; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(e ORDER BY e->>'submittedAt')
    FROM (
      SELECT jsonb_build_object(
        'id',          ul.id,
        'userId',      ul.user_id,
        'displayName', COALESCE(u.display_name, 'אלמוני'),
        'gameweekId',  p_gw_code,
        'mode',        ul.mode,
        'submittedAt', to_char(ul.submitted_at AT TIME ZONE 'UTC',
                               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'lineup', jsonb_build_object(
          'lineupId',   ul.id,
          'userId',     ul.user_id,
          'gameweekId', p_gw_code,
          'formation',  ul.formation,
          'slots', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'slotNo',    s.slot_no,
              'playerId',  'P' || xp.external_id,
              'teamId',    'T' || xt.external_id,
              'position',  s.position,
              'price',     s.price,
              'isCaptain', s.is_captain,
              'isVice',    s.is_vice,
              'isBench',   s.is_bench
            ) ORDER BY s.slot_no)
            FROM game.user_lineup_slots s
            JOIN core.v_ext xp ON xp.entity_type = 'player' AND xp.entity_id = s.player_id
            JOIN core.v_ext xt ON xt.entity_type = 'team'   AND xt.entity_id = s.team_id
            WHERE s.lineup_id = ul.id
          ), '[]'::jsonb)
        )
      ) AS e
      FROM game.user_lineups ul
      LEFT JOIN game.users u ON u.id = ul.user_id
      WHERE ul.gameweek_id = v_gw.id
        AND ul.status IN ('submitted','locked','scored')
        -- לפני הנעילה: רק ההגשה שלי. אחרי: הכל.
        AND (now() >= v_gw.lock_at OR ul.user_id = v_auth)
    ) q
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION game.entries(TEXT) TO anon, authenticated;

/**
 * התוצאות, בדיוק בצורה שמנוע הניקוד בקליינט מצפה לה.
 * ★ `published=false` מחזיר מבנה ריק ולא NULL — מסך שמקבל NULL
 *   צריך ענף נוסף, ומסך עם ענף נוסף הוא מסך עם באג נוסף.
 */
CREATE OR REPLACE FUNCTION game.results(p_gw_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v_gw game.gameweeks; v_published BOOLEAN;
BEGIN
  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw.id IS NULL THEN
    RETURN jsonb_build_object('gameweekId', p_gw_code, 'published', FALSE,
                              'performances', '{}'::jsonb, 'outcomes', '{}'::jsonb,
                              'fixtureScores', '{}'::jsonb);
  END IF;
  v_published := (v_gw.status = 'published');

  RETURN jsonb_build_object(
    'gameweekId', p_gw_code,
    'published',  v_published,
    'updatedAt',  to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),

    'performances', COALESCE((
      SELECT jsonb_object_agg('P' || xp.external_id, jsonb_build_object(
        'playerId',        'P' || xp.external_id,
        'teamId',          'T' || xt.external_id,
        'position',        st.position,
        'minutes',         st.minutes,
        'goals',           st.goals,
        'assists',         st.assists,
        'ownGoals',        st.own_goals,
        'yellowCards',     st.yellow_cards,
        'redCards',        st.red_cards,
        'saves',           st.saves,
        'penaltiesSaved',  st.penalties_saved,
        'penaltiesMissed', st.penalties_missed,
        'goalsConceded',   st.goals_conceded,
        'cleanSheet',      st.clean_sheet,
        'played',          st.minutes > 0
      ))
      FROM game.gameweek_player_stats(v_gw.id) st
      JOIN core.v_ext xp ON xp.entity_type = 'player' AND xp.entity_id = st.player_id
      JOIN core.v_ext xt ON xt.entity_type = 'team'   AND xt.entity_id = st.team_id
    ), '{}'::jsonb),

    'outcomes', COALESCE((
      SELECT jsonb_object_agg('T' || xt.external_id, jsonb_build_object(
        'teamId',       'T' || xt.external_id,
        'result',       r.result,
        'goalsFor',     r.goals_for,
        'goalsAgainst', r.goals_against
      ))
      FROM game.gameweek_team_results(v_gw.id) r
      JOIN core.v_ext xt ON xt.entity_type = 'team' AND xt.entity_id = r.team_id
    ), '{}'::jsonb),

    /* ★ המפתח הוא זוג הקבוצות, לא ה-UUID של המשחק.
       לקליינט אין את ה-UUID — הוא מכיר את לוח המשחקים שלו לפי
       'T13' מול 'T1'. מפתח שהקליינט לא יכול לחשב הוא מפתח שהוא
       לא יכול לחפש לפיו, ומסך הניהול היה מציג תיבות ריקות מעל
       תוצאות ששמורות במסד. */
    'fixtureScores', COALESCE((
      SELECT jsonb_object_agg('T' || xh.external_id || '-T' || xa.external_id,
        jsonb_build_object(
          'fixtureId',  'T' || xh.external_id || '-T' || xa.external_id,
          'homeGoals',  COALESCE(m.home_goals, 0),
          'awayGoals',  COALESCE(m.away_goals, 0),
          'final',      m.status = 'finished'
        ))
      FROM core.weekly_matches m
      JOIN core.v_ext xh ON xh.entity_type = 'team' AND xh.entity_id = m.home_team_id
      JOIN core.v_ext xa ON xa.entity_type = 'team' AND xa.entity_id = m.away_team_id
      WHERE m.gameweek_id = v_gw.id AND m.home_goals IS NOT NULL
    ), '{}'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION game.results(TEXT) TO anon, authenticated;

/** מצב המחזור — סטטוס, דדליין, ומספר משתתפים. שאילתה אחת ללובי. */
CREATE OR REPLACE FUNCTION game.gameweek_state(p_gw_code TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, public
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
                        WHERE gameweek_id = gw.id AND status <> 'draft')
  )
  FROM game.gameweeks gw WHERE gw.code = p_gw_code;
$$;

GRANT EXECUTE ON FUNCTION game.gameweek_state(TEXT) TO anon, authenticated;

-- =====================================================================
-- §7 אדמין — הזנת תוצאות ופרסום
-- =====================================================================
--
--  ★ ההרשאה נבדקת במסד, לא במסך.
--
--  מסך הניהול בקליינט מגן על עצמו ב-hash של PIN. זו נוחות, לא
--  אבטחה: מי שמריץ את הקוד יכול לדלג עליה. לכן כל פונקציה כאן
--  בודקת `game.is_admin()` בשורה הראשונה. מסך הניהול הוא UI;
--  ההרשאה היא כאן.
--
--  איך הופכים משתמש לאדמין (פעם אחת, מה-SQL Editor):
--      UPDATE game.users SET is_admin = TRUE WHERE id = '<auth uid>';

CREATE OR REPLACE FUNCTION game.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, public AS $$
  SELECT COALESCE((SELECT is_admin FROM game.users WHERE id = auth.uid()), FALSE);
$$;
GRANT EXECUTE ON FUNCTION game.is_admin() TO authenticated;

CREATE OR REPLACE FUNCTION game.admin_upsert_match(
  p_gw_code TEXT, p_ext_home TEXT, p_ext_away TEXT,
  p_home_goals SMALLINT, p_away_goals SMALLINT, p_final BOOLEAN
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_gw UUID; v_home UUID; v_away UUID; v_match UUID;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  SELECT id INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND'; END IF;

  v_home := core.team_by_ext(p_ext_home);
  v_away := core.team_by_ext(p_ext_away);
  IF v_home IS NULL OR v_away IS NULL THEN RAISE EXCEPTION 'TEAM_NOT_FOUND'; END IF;

  INSERT INTO core.weekly_matches
    (gameweek_id, home_team_id, away_team_id, kickoff_at, status, home_goals, away_goals)
  VALUES (v_gw, v_home, v_away,
          (SELECT lock_at FROM game.gameweeks WHERE id = v_gw),
          CASE WHEN p_final THEN 'finished' ELSE 'live' END,
          p_home_goals, p_away_goals)
  ON CONFLICT (gameweek_id, home_team_id, away_team_id) DO UPDATE
    SET home_goals = EXCLUDED.home_goals,
        away_goals = EXCLUDED.away_goals,
        status     = EXCLUDED.status
  RETURNING id INTO v_match;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (auth.uid()::TEXT, 'admin_upsert_match', 'weekly_match', v_match::TEXT,
          jsonb_build_object('gw', p_gw_code, 'home', p_ext_home, 'away', p_ext_away,
                             'score', p_home_goals || '-' || p_away_goals, 'final', p_final));

  RETURN v_match;
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_upsert_match(TEXT,TEXT,TEXT,SMALLINT,SMALLINT,BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION game.admin_upsert_player_stat(
  p_gw_code TEXT, p_ext_player TEXT, p_stats JSONB
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_gw UUID; v_player UUID; v_team UUID; v_match UUID;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  SELECT id INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  v_player := core.player_by_ext(p_ext_player);
  IF v_gw IS NULL OR v_player IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  SELECT team_id INTO v_team FROM core.squads
   WHERE player_id = v_player AND valid_to IS NULL AND status = 'active' LIMIT 1;
  IF v_team IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_IN_SQUAD'; END IF;

  -- המשחק שבו הקבוצה שלו שיחקה במחזור הזה.
  SELECT id INTO v_match FROM core.weekly_matches
   WHERE gameweek_id = v_gw AND (home_team_id = v_team OR away_team_id = v_team) LIMIT 1;
  IF v_match IS NULL THEN RAISE EXCEPTION 'MATCH_NOT_FOUND_FOR_TEAM'; END IF;

  INSERT INTO core.player_match_stats (
    match_id, player_id, team_id, minutes, goals, assists, own_goals,
    yellow_cards, red_cards, saves, penalties_saved, penalties_missed,
    goals_conceded, clean_sheet, updated_at)
  VALUES (
    v_match, v_player, v_team,
    COALESCE((p_stats->>'minutes')::SMALLINT, 0),
    COALESCE((p_stats->>'goals')::SMALLINT, 0),
    COALESCE((p_stats->>'assists')::SMALLINT, 0),
    COALESCE((p_stats->>'ownGoals')::SMALLINT, 0),
    COALESCE((p_stats->>'yellowCards')::SMALLINT, 0),
    COALESCE((p_stats->>'redCards')::SMALLINT, 0),
    COALESCE((p_stats->>'saves')::SMALLINT, 0),
    COALESCE((p_stats->>'penaltiesSaved')::SMALLINT, 0),
    COALESCE((p_stats->>'penaltiesMissed')::SMALLINT, 0),
    COALESCE((p_stats->>'goalsConceded')::SMALLINT, 0),
    COALESCE((p_stats->>'cleanSheet')::BOOLEAN, FALSE),
    now())
  ON CONFLICT (match_id, player_id) DO UPDATE SET
    minutes = EXCLUDED.minutes, goals = EXCLUDED.goals, assists = EXCLUDED.assists,
    own_goals = EXCLUDED.own_goals, yellow_cards = EXCLUDED.yellow_cards,
    red_cards = EXCLUDED.red_cards, saves = EXCLUDED.saves,
    penalties_saved = EXCLUDED.penalties_saved,
    penalties_missed = EXCLUDED.penalties_missed,
    goals_conceded = EXCLUDED.goals_conceded, clean_sheet = EXCLUDED.clean_sheet,
    updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_upsert_player_stat(TEXT,TEXT,JSONB) TO authenticated;

/**
 * פרסום. שינוי סטטוס אחד — וכל המוצר משתנה יחד: הדירוג נפתח,
 * הכרטיסים נוצרים, וההגשות ננעלות לצמיתות.
 *
 * ★ ביטול פרסום מותר בכוונה. טעות בהזנת תוצאה היא תרחיש ודאי,
 *   ו"אי אפשר לחזור" הופך טעות קטנה לאסון. הפעולה נרשמת ביומן.
 */
CREATE OR REPLACE FUNCTION game.admin_set_published(p_gw_code TEXT, p_published BOOLEAN)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_gw game.gameweeks; v_next TEXT;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw.id IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND'; END IF;

  v_next := CASE WHEN p_published THEN 'published' ELSE 'scoring' END;

  UPDATE game.gameweeks
     SET status = v_next,
         published_at = CASE WHEN p_published THEN now() ELSE NULL END
   WHERE id = v_gw.id;

  UPDATE game.user_lineups SET status = CASE WHEN p_published THEN 'scored' ELSE 'locked' END
   WHERE gameweek_id = v_gw.id AND status IN ('submitted','locked','scored');

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (auth.uid()::TEXT, 'admin_set_published', 'gameweek', v_gw.id::TEXT,
          jsonb_build_object('code', p_gw_code, 'published', p_published));

  RETURN v_next;
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_set_published(TEXT, BOOLEAN) TO authenticated;

-- =====================================================================
-- §8 קודי גישה חד־פעמיים
-- =====================================================================
--
--  ★ הקוד עצמו לא נשמר. רק ה-hash.
--
--  קוד שנשמר כטקסט הוא סיסמה שנשמרה כטקסט. מי שמשיג גישה לטבלה
--  יכול להתחזות לכל משתמש. ה-hash עולה שורה אחת ומבטל את זה.
--
--  ה-Edge Function `access-code` היא היחידה שנוגעת בטבלה — היא
--  צריכה `service_role` כדי להנפיק סשן למשתמש אחר, ולכן אין כאן
--  שום GRANT ל-anon או ל-authenticated.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS game.access_codes (
  code_hash   TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES game.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  redeemed_at TIMESTAMPTZ,
  -- כמה פעמים ניסו לפדות. הגנה מפני ניחוש בכוח גס.
  attempts    SMALLINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS access_codes_user ON game.access_codes (user_id);

ALTER TABLE game.access_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON game.access_codes FROM anon, authenticated;

-- =====================================================================
-- §9 ★ RLS — סגירת הדלת שנשארה פתוחה
-- =====================================================================
--
--  מיגרציה 07 עשתה `GRANT ALL ON ALL TABLES IN SCHEMA game TO anon`.
--  זה היה נכון כשהמסד היה ריק ואף אחד לא שיחק. במשחק תחרותי חי
--  זה אומר שכל מי שפותח את ה-DevTools יכול לכתוב תוצאות, למחוק
--  הרכבים של אחרים, ולשנות ניקוד.
--
--  כאן זה נסגר. הכלל: **כתיבה עוברת אך ורק דרך פונקציות
--  SECURITY DEFINER.** לטבלאות עצמן יש קריאה בלבד, ורק למה
--  שצריך להיות גלוי.

DO $rls$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    RAISE NOTICE 'דילוג על RLS: הסכמה auth לא קיימת (לא Supabase)';
    RETURN;
  END IF;

  -- --- כתיבה ישירה נשללת מכולם ---
  REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA game FROM anon, authenticated;
  REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core FROM anon, authenticated;

  -- --- קריאה: דאטת כדורגל פומבית ---
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA core TO anon, authenticated';

  -- --- הרכבים ---
  ALTER TABLE game.user_lineups      ENABLE ROW LEVEL SECURITY;
  ALTER TABLE game.user_lineup_slots ENABLE ROW LEVEL SECURITY;
  ALTER TABLE game.users             ENABLE ROW LEVEL SECURITY;
  ALTER TABLE game.gameweeks         ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS lineups_own ON game.user_lineups;
  DROP POLICY IF EXISTS lineups_read ON game.user_lineups;
  CREATE POLICY lineups_read ON game.user_lineups FOR SELECT
    USING (
      user_id = auth.uid()
      OR EXISTS (SELECT 1 FROM game.gameweeks gw
                  WHERE gw.id = gameweek_id AND now() >= gw.lock_at)
    );

  DROP POLICY IF EXISTS slots_own_before_lock ON game.user_lineup_slots;
  DROP POLICY IF EXISTS slots_read ON game.user_lineup_slots;
  CREATE POLICY slots_read ON game.user_lineup_slots FOR SELECT
    USING (EXISTS (
      SELECT 1 FROM game.user_lineups ul JOIN game.gameweeks gw ON gw.id = ul.gameweek_id
       WHERE ul.id = lineup_id AND (ul.user_id = auth.uid() OR now() >= gw.lock_at)
    ));

  DROP POLICY IF EXISTS users_read ON game.users;
  -- ★ רק השורה שלי.
  --
  -- שם התצוגה של אחרים מגיע דרך `game.entries()`, שבוחרת אותו
  -- במפורש. הטבלה עצמה מחזיקה גם `offsides_email`, ומדיניות
  -- `USING (TRUE)` הייתה מאפשרת לכל דפדפן למשוך את רשימת
  -- המיילים של כל המשתמשים בבקשה אחת.
  CREATE POLICY users_read ON game.users FOR SELECT USING (id = auth.uid());

  DROP POLICY IF EXISTS gameweeks_read ON game.gameweeks;
  CREATE POLICY gameweeks_read ON game.gameweeks FOR SELECT USING (TRUE);
END
$rls$;

-- =====================================================================
-- §10 סיד — מחזור 2
-- =====================================================================
--
--  ★ הדדליין הוא בעיטת הפתיחה **המוקדמת ביותר**, לא המאוחרת.
--  אחרת מי שמחכה עד ראשון בוחר אחרי שכבר ראה חמישה משחקים —
--  יתרון מידע שהורס את התחרות.

DO $seed$
DECLARE
  v_season UUID;
  v_gw     UUID;
  v_home   UUID;
  v_away   UUID;
  f        RECORD;
BEGIN
  SELECT s.id INTO v_season
    FROM core.seasons s JOIN core.leagues l ON l.id = s.league_id
   ORDER BY s.starts_on DESC NULLS LAST LIMIT 1;
  IF v_season IS NULL THEN
    RAISE NOTICE 'אין עונה במסד — הריצו קודם db/03_seed_squads.sql';
    RETURN;
  END IF;

  INSERT INTO game.gameweeks (season_id, number, code, names, lock_at, first_kickoff_at, status)
  VALUES (v_season, 2, 'gw-2',
          -- `core.i18n_name` הוא DOMAIN מעל JSONB, לא composite:
          -- הוא דורש `{en:{full:…}}`, ו-`ROW(...)` לא מתקמפל אליו.
          jsonb_build_object('he', jsonb_build_object('full', 'מחזור 2'),
                             'en', jsonb_build_object('full', 'Gameweek 2')),
          TIMESTAMPTZ '2026-08-29 20:00:00+03',
          TIMESTAMPTZ '2026-08-29 20:00:00+03',
          'open')
  ON CONFLICT (season_id, number) DO UPDATE
    SET code = 'gw-2',
        lock_at = EXCLUDED.lock_at,
        first_kickoff_at = EXCLUDED.first_kickoff_at
  RETURNING id INTO v_gw;

  FOR f IN
    SELECT * FROM (VALUES
      ('8','12',  TIMESTAMPTZ '2026-08-29 20:00:00+03'),
      ('5','7',   TIMESTAMPTZ '2026-08-29 20:00:00+03'),
      ('13','1',  TIMESTAMPTZ '2026-08-29 20:00:00+03'),
      ('14','2',  TIMESTAMPTZ '2026-08-29 20:00:00+03'),
      ('10','11', TIMESTAMPTZ '2026-08-29 20:00:00+03'),
      ('9','6',   TIMESTAMPTZ '2026-08-30 20:00:00+03'),
      ('3','4',   TIMESTAMPTZ '2026-08-31 20:00:00+03')
    ) AS t(home_ext, away_ext, kickoff)
  LOOP
    v_home := core.team_by_ext(f.home_ext);
    v_away := core.team_by_ext(f.away_ext);
    CONTINUE WHEN v_home IS NULL OR v_away IS NULL;

    INSERT INTO core.weekly_matches (gameweek_id, home_team_id, away_team_id, kickoff_at, status)
    VALUES (v_gw, v_home, v_away, f.kickoff, 'scheduled')
    ON CONFLICT (gameweek_id, home_team_id, away_team_id) DO UPDATE
      SET kickoff_at = EXCLUDED.kickoff_at;
  END LOOP;

  RAISE NOTICE 'מחזור 2 מוכן: %', v_gw;
END
$seed$;

-- =====================================================================
-- בדיקת שפיות אחת שאומרת אם הכל עלה
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
DROP VIEW IF EXISTS game.v_health;
CREATE VIEW game.v_health AS
SELECT
  (SELECT count(*) FROM core.teams)                                   AS teams,
  (SELECT count(*) FROM core.players)                                 AS players,
  (SELECT count(*) FROM core.squads WHERE valid_to IS NULL)           AS active_squad_rows,
  (SELECT count(*) FROM game.gameweeks WHERE code IS NOT NULL)        AS coded_gameweeks,
  (SELECT count(*) FROM core.weekly_matches)                          AS matches,
  (SELECT count(*) FROM game.user_lineups)                            AS lineups,
  (SELECT count(*) FROM game.users WHERE is_admin)                    AS admins,
  (SELECT count(*) FROM core.external_refs WHERE provider='manual_json') AS id_mappings;

GRANT SELECT ON game.v_health TO authenticated;


-- =====================================================================
-- ▼▼▼  10_accounts.sql  —  הרשמה, אורחים, שמות משתמש
-- =====================================================================

-- =====================================================================
--  DUBID · מיגרציה 10 — חשבונות
--
--  ★ מה זה מוסיף, ומה זה בכוונה לא משנה
--
--  עד עכשיו כל משתמש בדוביד היה אנונימי. זה נשאר — **אורח הוא
--  עדיין אזרח מן המניין**, והוא יכול לשחק מחזור שלם בלי להשאיר
--  כתובת מייל. מה שנוסף הוא האפשרות להירשם, ולהפוך את הזהות
--  ממשהו שחי בדפדפן למשהו שחי בחשבון.
--
--  המבנה נגזר מטופס ההרשמה של אופסיידס (`DUBIDAUTHSYNC.md` §5),
--  כדי ששני המוצרים יבקשו את אותם שדות ויכתבו אותו מטא־דאטה.
--
--  ═══════════════════════════════════════════════════════════════
--  ★ הערה על ההנחה במסמך המקור
--  ═══════════════════════════════════════════════════════════════
--
--  `DUBIDAUTHSYNC.md` נכתב תחת ההנחה של **פרויקט Supabase אחד**
--  לשני המוצרים ("אין מה לסנכרן — אותה שורה *היא* המשתמש").
--  ההחלטה בפועל הייתה אחרת: שני פרויקטים נפרדים.
--
--  לכן מה שרלוונטי מהמסמך ומיושם כאן הוא כל מה שאינו תלוי במסד
--  משותף — חוזה הטופס, שדות המטא־דאטה, `emailRedirectTo`,
--  `detectSessionInUrl`, ובעיקר **פאץ' התנגשות שמות המשתמש**
--  (§8), שהוא באג אמיתי ומשוחזר וחל בדיוק אותו דבר גם כאן.
--
--  מה ש**לא** מיושם, כי אין לו משמעות בשני מסדים: `auth.users`
--  משותף, ולקוח OAuth יחיד שנותן אותו `auth.users.id`. בדוביד
--  Google יוצר משתמש דוביד; החיבור לחשבון אופסיידס נשאר דרך
--  `link-offsides` (מיגרציה 09 + Edge Function).
--
--  אידמפוטנטי. additive בלבד. בטוח על מסד חי.
-- =====================================================================

SET search_path = core, game, public;

CREATE EXTENSION IF NOT EXISTS citext;

-- =====================================================================
-- §1 עמודות הפרופיל
-- =====================================================================
ALTER TABLE game.users
  -- ★ `citext` ולא `text`. "מאור" ו-"Maor" הם שמות שונים; "maor"
  --   ו-"MAOR" הם אותו שם, ומשתמש שמגלה את זה רק כשהוא מנסה
  --   להתחבר — מגלה את זה מאוחר מדי.
  ADD COLUMN IF NOT EXISTS username         CITEXT,
  ADD COLUMN IF NOT EXISTS avatar           TEXT,
  ADD COLUMN IF NOT EXISTS referral_code    TEXT,
  ADD COLUMN IF NOT EXISTS referred_by_code TEXT,
  ADD COLUMN IF NOT EXISTS email            TEXT,
  -- ★ הדגל הזה הוא לב העניין: "אורח" אינו סוג משתמש נפרד, אלא
  --   מצב של אותו משתמש. שדרוג מאורח לרשום לא מעביר שום דאטה —
  --   הוא מוריד דגל. לכן אין מסלול הגירה שיכול להיכשל באמצע.
  ADD COLUMN IF NOT EXISTS is_guest         BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS registered_at    TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_key
  ON game.users (username) WHERE username IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_key
  ON game.users (referral_code) WHERE referral_code IS NOT NULL;

COMMENT ON COLUMN game.users.is_guest IS
  'TRUE = נכנס בלי הרשמה. אורח משחק, מדורג ומופיע בטבלה בדיוק '
  'כמו כולם. הדגל משפיע רק על מה שהמוצר מציע לו, לא על מה שמותר לו.';

-- =====================================================================
-- §2 ★★ התנגשות שמות משתמש — הבאג מ-§8 של מסמך המקור ★★
-- =====================================================================
--
--  ★ מה נשבר, ולמה זה לא תיאורטי
--
--  ברגע ש-`username` הוא `UNIQUE`, כל מסלול שיוצר פרופיל בלי שם
--  מפורש נופל לגיבוי שנגזר מהמייל — `split_part(email,'@',1)`
--  ועוד ארבעה תווים מה-UUID. במסמך המקור שוחזר בדיוק זה:
--
--      info@alpha.com   id 4336d23f…  →  info_4336   ✓
--      info@beta.com    id 11111111…  →  info_1111   ✓
--      info@gamma.com   id 1111aaaa…  →  info_1111   ✗ duplicate key
--
--  ההרשמה השלישית **נכשלת ברמת השרת** והמשתמש רואה
--  "Database error saving new user". עם `info@` / `contact@` /
--  `hello@` זה קורה בעולם האמיתי.
--
--  ★ הפתרון: טריגר BEFORE INSERT על הטבלה, לא תיקון בפונקציה.
--
--  יש שלושה מסלולים שיוצרים פרופיל — `ensure_profile`, קישור
--  אופסיידס, ואדמין. תיקון באחד מהם משאיר את השניים האחרים
--  שבורים. טריגר על הטבלה תופס את שלושתם.
--
--  ★ הסיומת נגזרת מהמפתח הראשי של השורה עצמה, ולא מלולאת
--    "ספור עד שפנוי". לולאה כזו היא תחרות: שתי הרשמות מקבילות
--    יכולות שתיהן לראות ש-`x_2` פנוי. מזהה השורה ייחודי מעצם
--    היותו מפתח ראשי, ולכן אין תחרות בכלל.
--
--  ★★ אזהרה למי שמיישם את אותו פאץ' בצד אופסיידס ★★
--
--  מסמך המקור (§8) מתאר סיומת של **ארבעה** תווים מה-UUID —
--  אותו אורך כמו הגיבוי השבור שהוא בא לתקן. הבדיקה כאן תפסה
--  שזה לא מספיק:
--
--      11111111-…  →  info_1111
--      1111aaaa-…  →  info_1111   ✗ duplicate key
--
--  זה בדיוק התרחיש שהמסמך עצמו הביא כהוכחה לבאג — הפאץ' רק
--  הזיז אותו שלב אחד אחורה. ארבעה תווים הקסדצימליים הם 65,536
--  אפשרויות; בפרדוקס יום ההולדת מספיק כמה מאות משתמשים עם אותו
--  חלק־מייל כדי לפגוש התנגשות.
--
--  כאן: שלוש דרגות, והשלישית **לא יכולה** להתנגש —
--
--      1.  base                    אם פנוי, נשמר תו-בתו
--      2.  base_XXXXXXXX           שמונה תווים
--      3.  base_<32 תווים מלאים>   ה-UUID השלם = ייחודי בהגדרה
--
--  אין לולאה, אין ספירה, ואין תרחיש שנופל.
CREATE OR REPLACE FUNCTION game.users_username_dedupe()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = game, public
AS $$
DECLARE
  v_base TEXT;
  v_hex  TEXT;
  v_try  CITEXT;
BEGIN
  -- שם ריק או חסר → נגזר מהמייל, ואם גם הוא חסר → 'player'.
  v_base := NULLIF(btrim(COALESCE(NEW.username::TEXT, '')), '');
  IF v_base IS NULL THEN
    v_base := NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), '');
  END IF;
  IF v_base IS NULL THEN
    v_base := 'player';
  END IF;

  -- ★ אין סינון תווים. שם בעברית שורד תו-בתו, וזו החלטה: מוצר
  --   שמדבר עברית ומכריח האנדל לטיני הוא מוצר שלא מדבר עברית.
  v_try := v_base::CITEXT;

  IF NOT EXISTS (SELECT 1 FROM game.users WHERE username = v_try AND id <> NEW.id) THEN
    NEW.username := v_try;      -- פנוי — נשמר תו-בתו
    RETURN NEW;
  END IF;

  -- דרגה 2 — שמונה תווים מה-PK.
  v_hex := upper(replace(NEW.id::TEXT, '-', ''));
  v_try := (v_base || '_' || left(v_hex, 8))::CITEXT;
  IF NOT EXISTS (SELECT 1 FROM game.users WHERE username = v_try AND id <> NEW.id) THEN
    NEW.username := v_try;
    RETURN NEW;
  END IF;

  -- דרגה 3 — ה-UUID המלא. ייחודי בהגדרה, ולכן זו התחנה האחרונה.
  NEW.username := (v_base || '_' || v_hex)::CITEXT;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_username_dedupe ON game.users;
-- ★ INSERT בלבד, בכוונה.
--   משתמש מחובר שמנסה לשנות את שמו לשם תפוס צריך לקבל שגיאה
--   אמיתית — לא שינוי שקט לשם אחר שהוא לא ביקש.
CREATE TRIGGER users_username_dedupe
  BEFORE INSERT ON game.users
  FOR EACH ROW EXECUTE FUNCTION game.users_username_dedupe();

/**
 * בדיקת זמינות לטופס.
 *
 * ★ למה זה לא חושף מידע: שמות המשתמש מופיעים ממילא בכל טבלת
 *   דירוג במוצר. הפונקציה לא מגלה דבר שאי אפשר לראות במסך הדירוג.
 */
CREATE OR REPLACE FUNCTION game.username_available(p_username TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, public AS $$
  SELECT CASE
    WHEN btrim(COALESCE(p_username, '')) = '' THEN FALSE
    WHEN length(btrim(p_username)) < 3       THEN FALSE
    ELSE NOT EXISTS (
      SELECT 1 FROM game.users WHERE username = btrim(p_username)::CITEXT
    )
  END;
$$;
GRANT EXECUTE ON FUNCTION game.username_available(TEXT) TO anon, authenticated;

-- =====================================================================
-- §3 יצירת הפרופיל — קוראת את מה שהטופס שלח
-- =====================================================================
--
--  ★ המטא־דאטה של ההרשמה היא מקור אמת, ולא הצעה.
--
--  `supabase.auth.signUp({ options: { data: {...} } })` כותב
--  ל-`auth.users.raw_user_meta_data`. הפונקציה קוראת משם, ולכן
--  שם המשתמש והאווטאר שהמשתמש בחר בטופס שורדים גם אם הקליינט
--  נסגר מיד אחרי ההרשמה ולפני שהספיק לקרוא לפונקציה בעצמו.
--
--  ★ למה גם `email` נשמר כאן: הוא נדרש לגיבוי שם המשתמש (§2).
--    הוא **לא** מוחזר לאף קליינט — ראו `game.me()`.
CREATE OR REPLACE FUNCTION game.ensure_profile(p_display_name TEXT DEFAULT NULL)
RETURNS game.users
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE
  v_auth  UUID := auth.uid();
  v_user  game.users;
  v_meta  JSONB;
  v_email TEXT;
  v_anon  BOOLEAN;
  v_name  TEXT;
BEGIN
  IF v_auth IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  SELECT u.raw_user_meta_data,
         u.email,
         COALESCE(u.is_anonymous, FALSE)
    INTO v_meta, v_email, v_anon
    FROM auth.users u WHERE u.id = v_auth;

  -- עדיפות: מה שהקליינט שלח עכשיו > מה שהיה בטופס ההרשמה.
  v_name := COALESCE(
    NULLIF(btrim(p_display_name), ''),
    NULLIF(btrim(v_meta->>'username'), ''),
    NULLIF(btrim(v_meta->>'display_name'), '')
  );

  SELECT * INTO v_user FROM game.users WHERE id = v_auth OR auth_id = v_auth;

  IF v_user.id IS NOT NULL THEN
    UPDATE game.users SET
      display_name = COALESCE(v_name, display_name),
      avatar       = COALESCE(avatar, NULLIF(v_meta->>'avatar', '')),
      email        = COALESCE(v_email, email),
      -- ★ המעבר מאורח לרשום קורה כאן, ורק בכיוון אחד.
      --   משתמש רשום לא חוזר להיות אורח בגלל רענון דף.
      is_guest      = (v_anon AND v_user.offsides_user_id IS NULL),
      registered_at = CASE
                        WHEN v_user.registered_at IS NOT NULL THEN v_user.registered_at
                        WHEN NOT v_anon THEN now()
                        ELSE NULL
                      END
    WHERE id = v_user.id
    RETURNING * INTO v_user;
    RETURN v_user;
  END IF;

  INSERT INTO game.users (
    id, auth_id, display_name, username, avatar, email,
    referred_by_code, referral_code, is_guest, registered_at
  )
  VALUES (
    v_auth, v_auth,
    COALESCE(v_name, 'שחקן דוביד'),
    v_name,                                   -- הטריגר ידאג לייחודיות
    NULLIF(v_meta->>'avatar', ''),
    v_email,
    NULLIF(v_meta->>'referred_by_code', ''),
    upper(left(replace(v_auth::TEXT, '-', ''), 8)),
    v_anon,
    CASE WHEN v_anon THEN NULL ELSE now() END
  )
  RETURNING * INTO v_user;

  RETURN v_user;
END;
$$;
GRANT EXECUTE ON FUNCTION game.ensure_profile(TEXT) TO authenticated;

-- =====================================================================
-- §4 `game.me()` — עכשיו עם מצב החשבון
-- =====================================================================
--
--  ★ `email` לא מוחזר. הוא נשמר בשורה כי הגיבוי של שם המשתמש
--    צריך אותו, ואין שום מסך שצריך להציג אותו. שדה שלא יוצא
--    החוצה הוא שדה שלא ידלוף.
CREATE OR REPLACE FUNCTION game.me()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, public AS $$
  SELECT jsonb_build_object(
    'id',             u.id,
    'displayName',    u.display_name,
    'username',       u.username,
    'avatar',         u.avatar,
    'isGuest',        u.is_guest,
    'referralCode',   u.referral_code,
    'offsidesUserId', u.offsides_user_id,
    'isAdmin',        u.is_admin,
    'registeredAt',   u.registered_at
  )
  FROM game.users u WHERE u.id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION game.me() TO authenticated;

-- =====================================================================
-- §5 שם משתמש מוצע
-- =====================================================================
--
--  ★ למה הטופס מציע שם במקום לבקש אחד.
--
--  "בחר שם משתמש" הוא השדה שהכי הרבה אנשים נתקעים בו, והוא לא
--  שדה חשוב. הצעה שאפשר להחליף מורידה את המחסום לאפס בלי לקחת
--  מאף אחד את הבחירה.
--
--  שתי מילים עבריות מרשימה קטנה + מספר. עברית ולא לטינית, כי
--  המוצר בעברית והשם מופיע בטבלת דירוג עברית.
CREATE OR REPLACE FUNCTION game.suggest_username()
RETURNS TEXT
LANGUAGE plpgsql VOLATILE
SET search_path = game, public AS $$
DECLARE
  v_adj  TEXT[] := ARRAY['מהיר','חד','קר','זהוב','שקט','ערמומי','ברזל','חופשי','אחרון','ראשון'];
  v_noun TEXT[] := ARRAY['חלוץ','בלם','קפטן','מאמן','שוער','כנף','קשר','שופט','אלוף','טוטו'];
  v_try  TEXT;
  i      INT;
BEGIN
  FOR i IN 1..12 LOOP
    v_try := v_noun[1 + floor(random() * array_length(v_noun, 1))::INT] || '_' ||
             v_adj [1 + floor(random() * array_length(v_adj , 1))::INT] || '_' ||
             lpad(floor(random() * 1000)::TEXT, 3, '0');
    IF game.username_available(v_try) THEN RETURN v_try; END IF;
  END LOOP;
  -- 12 ניסיונות נכשלו (כמעט בלתי אפשרי) — נופלים לערך שתמיד פנוי.
  RETURN 'player_' || upper(left(replace(gen_random_uuid()::TEXT, '-', ''), 6));
END;
$$;
GRANT EXECUTE ON FUNCTION game.suggest_username() TO anon, authenticated;

-- =====================================================================
-- §6 יישור שורות קיימות
-- =====================================================================
--  משתמשים שנוצרו לפני המיגרציה: להשלים `referral_code`, ולסמן
--  מי מהם באמת אורח. בלי זה, כל מי שכבר נרשם היה נדחף להירשם שוב.
DO $backfill$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    UPDATE game.users u SET
      referral_code = COALESCE(u.referral_code, upper(left(replace(u.id::TEXT, '-', ''), 8))),
      email         = COALESCE(u.email, a.email),
      is_guest      = COALESCE(a.is_anonymous, TRUE) AND u.offsides_user_id IS NULL,
      registered_at = CASE
                        WHEN u.registered_at IS NOT NULL THEN u.registered_at
                        WHEN COALESCE(a.is_anonymous, TRUE) = FALSE THEN now()
                        ELSE NULL
                      END
    FROM auth.users a
    WHERE a.id = u.id;

    -- שם משתמש לכל מי שאין לו, דרך הטריגר של §2 (UPDATE לא מפעיל
    -- אותו, ולכן הגזירה חוזרת כאן במפורש).
    UPDATE game.users SET username = NULL WHERE btrim(COALESCE(username::TEXT, '')) = '';
    -- ה-UUID המלא ולא קיצור: שורות קיימות מקבלות שם ייחודי מובטח,
    -- והמשתמש יכול לשנות אותו אחר כך למשהו יפה.
    UPDATE game.users u SET
      username = (COALESCE(NULLIF(btrim(u.display_name), ''), 'player')
                  || '_' || upper(replace(u.id::TEXT, '-', '')))::CITEXT
    WHERE u.username IS NULL;
  END IF;
END
$backfill$;

-- =====================================================================
-- בדיקת בריאות
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
DROP VIEW IF EXISTS game.v_accounts_health;
CREATE VIEW game.v_accounts_health AS
SELECT
  count(*)                                        AS users_total,
  count(*) FILTER (WHERE is_guest)                AS guests,
  count(*) FILTER (WHERE NOT is_guest)            AS registered,
  count(*) FILTER (WHERE offsides_user_id IS NOT NULL) AS linked_to_offsides,
  count(*) FILTER (WHERE username IS NULL)        AS missing_username,
  count(*) - count(DISTINCT username)             AS duplicate_usernames
FROM game.users;

GRANT SELECT ON game.v_accounts_health TO authenticated;


-- =====================================================================
-- ▼▼▼  11_arena_and_squads.sql  —  זירות בשרת, עריכת סגלים, תקציב
-- =====================================================================

-- =====================================================================
--  DUBID · מיגרציה 11 — הזירה עוברת לשרת, והאדמין מקבל סגלים
--
--  שני חלקים שאין ביניהם קשר, באותה מיגרציה כי שניהם "מה שנשאר
--  פתוח אחרי 10":
--
--     §1–§4   הזירה — הטבלאות כבר קיימות מ-06, חסרה הפאסאדה
--     §5–§9   סגלים — הוספה, העברה, תמחור, זמינות
--
--  אידמפוטנטי. additive בלבד.
-- =====================================================================

SET search_path = core, game, public;

-- =====================================================================
-- §1 ★ למה הזירה הייתה שבורה בלי שאף אחד ראה
-- =====================================================================
--
--  `db/06` יצר את `game.leagues`, את `game.league_members`, ואת
--  `create_league` / `join_league`. הכל היה שם, מוכן, ועובד.
--
--  והקליינט מעולם לא קרא לו. `src/lib/leagueStore.ts` כתב
--  ל-`localStorage`.
--
--  המשמעות המעשית: זירה שנפתחה בטלפון **לא קיימת** במחשב. שני
--  אנשים שהקלידו את אותו קוד הצטרפו לשתי זירות שונות, כל אחת
--  בדפדפן שלו, כל אחת עם טבלה של איש אחד. זה בדיוק הבאג שתוקן
--  להרכבים ב-09 — הוא פשוט נשאר חי בטאב אחד.
--
--  מה שחסר כדי לסגור אותו הוא לא לוגיקה אלא **קריאה**: שלוש
--  פונקציות שמחזירות את מה שהמסך צריך, בשפה שהוא מדבר.

/**
 * כל הזירות שלי, עם החברים שלהן, בקריאה אחת.
 *
 * ★ למה גם החברים ולא רק הזירות: המסך מציג טבלה, וטבלה בלי
 *   שמות היא רשימת מזהים. שתי קריאות היו יוצרות רגע שבו הזירה
 *   כבר על המסך והחברים עוד לא — כלומר "אין משתתפים" מהבהב.
 */
CREATE OR REPLACE FUNCTION game.my_leagues()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('leagues', '[]'::jsonb, 'members', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'leagues', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',         l.id,
        'name',       l.name,
        'code',       l.code,
        'kind',       l.kind,
        'mode',       l.mode,
        'status',     l.status,
        'ownerId',    l.owner_id,
        'maxMembers', l.max_members,
        'createdAt',  to_char(l.created_at AT TIME ZONE 'UTC',
                              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) ORDER BY l.created_at)
      FROM game.leagues l
      WHERE EXISTS (SELECT 1 FROM game.league_members m
                     WHERE m.league_id = l.id AND m.user_id = v_user)
    ), '[]'::jsonb),

    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'leagueId',    m.league_id,
        'userId',      m.user_id,
        'displayName', COALESCE(u.display_name, 'אלמוני'),
        'joinedAt',    to_char(m.joined_at AT TIME ZONE 'UTC',
                               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) ORDER BY m.joined_at)
      FROM game.league_members m
      LEFT JOIN game.users u ON u.id = m.user_id
      WHERE m.league_id IN (
        SELECT league_id FROM game.league_members WHERE user_id = v_user
      )
    ), '[]'::jsonb)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION game.my_leagues() TO authenticated;

-- =====================================================================
-- §2 הצצה לפי קוד — לפני ההצטרפות
-- =====================================================================
--
--  ★ למה זו פונקציה נפרדת ולא פשוט `join_league`.
--
--  משתמש שמקליד קוד רוצה לדעת לאן הוא נכנס **לפני** שהוא נכנס.
--  "הצטרפת לזירה של אנשים שלא הכרת" הוא לא מצב שאפשר לבטל בנוחות
--  — המייסד כבר רואה אותך בטבלה.
--
--  הפונקציה מחזירה רק שם, מצב ומספר משתתפים. לא שמות, לא הרכבים,
--  ולא מי המייסד: מי שיש לו קוד תקף עוד אינו חבר.
CREATE OR REPLACE FUNCTION game.league_by_code(p_code TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, public AS $$
  SELECT jsonb_build_object(
    'name',       l.name,
    'mode',       l.mode,
    'kind',       l.kind,
    'status',     l.status,
    'members',    (SELECT count(*) FROM game.league_members WHERE league_id = l.id),
    'maxMembers', l.max_members
  )
  FROM game.leagues l
  WHERE l.code = upper(btrim(p_code));
$$;
GRANT EXECUTE ON FUNCTION game.league_by_code(TEXT) TO anon, authenticated;

-- =====================================================================
-- §3 יציאה מזירה
-- =====================================================================
--
--  ★ המייסד לא יכול לצאת.
--
--  זירה בלי מייסד היא זירה שאף אחד לא יכול לסגור, לנהל, או
--  להסביר. הכלל הזה כבר קיים בקליינט (`leaveLeague`), והוא חוזר
--  כאן כי כלל שנאכף רק בדפדפן אינו כלל.
CREATE OR REPLACE FUNCTION game.leave_league(p_league_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_user UUID := auth.uid(); v_owner UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  SELECT owner_id INTO v_owner FROM game.leagues WHERE id = p_league_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'LEAGUE_NOT_FOUND'; END IF;
  IF v_owner = v_user THEN RAISE EXCEPTION 'OWNER_CANNOT_LEAVE'; END IF;

  DELETE FROM game.league_members
   WHERE league_id = p_league_id AND user_id = v_user;
  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION game.leave_league(UUID) TO authenticated;

-- =====================================================================
-- §4 RLS לזירות
-- =====================================================================
DO $rls$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN RETURN; END IF;

  ALTER TABLE game.leagues        ENABLE ROW LEVEL SECURITY;
  ALTER TABLE game.league_members ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS leagues_member_read ON game.leagues;
  -- ★ רואים רק זירות שאני חבר בהן. רשימת כל הזירות במוצר היא
  --   רשימת כל קבוצות החברים של כל המשתמשים.
  CREATE POLICY leagues_member_read ON game.leagues FOR SELECT
    USING (EXISTS (SELECT 1 FROM game.league_members m
                    WHERE m.league_id = id AND m.user_id = auth.uid()));

  DROP POLICY IF EXISTS league_members_read ON game.league_members;
  CREATE POLICY league_members_read ON game.league_members FOR SELECT
    USING (EXISTS (SELECT 1 FROM game.league_members mine
                    WHERE mine.league_id = league_id AND mine.user_id = auth.uid()));
END
$rls$;

-- =====================================================================
-- §5 ★ סגלים — מה האדמין באמת צריך
-- =====================================================================
--
--  עד עכשיו הסגלים היו קובץ: `src/data/squads.ts`, 112kb שנבנו
--  בסקריפט. זה עבד כל עוד אף אחד לא עבר קבוצה באמצע העונה.
--
--  ארבע הפעולות שקורות בעולם האמיתי, ואף אחת מהן לא הייתה אפשרית:
--
--     שחקן חדש נחתם          →  admin_upsert_player
--     שחקן עבר קבוצה         →  admin_move_player
--     המחיר לא מאוזן         →  admin_set_price
--     פציעה / הרחקה / עזיבה  →  admin_set_player_status
--
--  ★ שום פעולה לא מוחקת. `core.squads` הוא היסטוריה עם
--    `valid_from`/`valid_to`: מעבר קבוצה סוגר שורה ופותח חדשה.
--    הרכב שהוגש לפני המעבר עדיין יודע מאיזו קבוצה השחקן היה,
--    כי הוא שמר snapshot משלו (`user_lineup_slots.team_id`).
--    מחיקה אמיתית הייתה משכתבת היסטוריה של תחרות שכבר נגמרה.

/**
 * מזהה חיצוני חדש לשחקן.
 *
 * ★ הפורמט קיים ואי אפשר לשנות אותו: `src/data/squads.ts` בנוי
 *   מ-`T<n>` ו-`P<n>`, והקליינט חותך את האות. שחקן חדש חייב
 *   לקבל מספר באותו מרחב, אחרת הוא לא ניתן לבחירה.
 *
 * המספר הוא <קבוצה>×100 + הרץ, בדיוק כמו הסיד (T3 → 301, 302…).
 */
CREATE OR REPLACE FUNCTION core.next_player_ext(p_team_ext TEXT)
RETURNS TEXT
LANGUAGE sql STABLE
SET search_path = core, public AS $$
  SELECT (p_team_ext::INT * 100 + COALESCE(MAX(
            CASE WHEN x.external_id ~ '^[0-9]+$'
                 AND x.external_id::INT / 100 = p_team_ext::INT
                 THEN x.external_id::INT % 100 END), 0) + 1)::TEXT
  FROM core.external_refs x
  WHERE x.provider = 'manual_json' AND x.entity_type = 'player';
$$;

/**
 * הוספה או עריכה של שחקן.
 *
 * `p_ext_player = NULL` → שחקן חדש. אחרת עריכה של קיים.
 * מחזיר את המזהה החיצוני, כדי שהמסך יוכל לבחור אותו מיד.
 */
CREATE OR REPLACE FUNCTION game.admin_upsert_player(
  p_ext_team   TEXT,
  p_name_he    TEXT,
  p_ext_player TEXT DEFAULT NULL,
  p_name_en    TEXT DEFAULT NULL,
  p_position   TEXT DEFAULT 'MID',
  p_price      NUMERIC DEFAULT NULL,
  p_shirt      SMALLINT DEFAULT NULL,
  p_status     TEXT DEFAULT 'active'
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE
  v_team   UUID;
  v_player UUID;
  v_ext    TEXT := NULLIF(btrim(COALESCE(p_ext_player, '')), '');
  v_season UUID;
  v_pos    core."position";
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF btrim(COALESCE(p_name_he, '')) = '' THEN RAISE EXCEPTION 'NAME_REQUIRED'; END IF;

  v_team := core.team_by_ext(p_ext_team);
  IF v_team IS NULL THEN RAISE EXCEPTION 'TEAM_NOT_FOUND: %', p_ext_team; END IF;

  v_pos := p_position::core."position";

  SELECT s.id INTO v_season FROM core.seasons s ORDER BY s.starts_on DESC NULLS LAST LIMIT 1;
  IF v_season IS NULL THEN RAISE EXCEPTION 'NO_SEASON'; END IF;

  IF v_ext IS NULL THEN
    -- ------- שחקן חדש -------
    v_ext := core.next_player_ext(p_ext_team);

    INSERT INTO core.players (names, primary_position)
    VALUES (jsonb_build_object(
              'he', jsonb_build_object('full', btrim(p_name_he)),
              -- אנגלית חובה ב-DOMAIN. אם לא סופקה — העברית משמשת
              -- כעוגן, וזה עדיף על לחסום הוספת שחקן.
              'en', jsonb_build_object('full',
                      COALESCE(NULLIF(btrim(p_name_en), ''), btrim(p_name_he)))),
            v_pos)
    RETURNING id INTO v_player;

    INSERT INTO core.external_refs (provider, entity_type, external_id, entity_id)
    VALUES ('manual_json', 'player', v_ext, v_player);

    INSERT INTO core.squads
      (season_id, team_id, player_id, position, fantasy_price, shirt_number, status)
    VALUES (v_season, v_team, v_player, v_pos, p_price, p_shirt, p_status);

  ELSE
    -- ------- עריכה -------
    v_player := core.player_by_ext(v_ext);
    IF v_player IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND: %', v_ext; END IF;

    UPDATE core.players SET
      names = jsonb_build_object(
                'he', jsonb_build_object('full', btrim(p_name_he)),
                'en', jsonb_build_object('full',
                        COALESCE(NULLIF(btrim(p_name_en), ''),
                                 names #>> '{en,full}', btrim(p_name_he)))),
      primary_position = v_pos,
      updated_at = now()
    WHERE id = v_player;

    UPDATE core.squads SET
      position      = v_pos,
      fantasy_price = COALESCE(p_price, fantasy_price),
      shirt_number  = COALESCE(p_shirt, shirt_number),
      status        = p_status
    WHERE player_id = v_player AND valid_to IS NULL;
  END IF;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (auth.uid()::TEXT, 'admin_upsert_player', 'player', v_ext,
          jsonb_build_object('team', p_ext_team, 'name', p_name_he,
                             'pos', p_position, 'price', p_price, 'status', p_status));

  RETURN v_ext;
END;
$$;
GRANT EXECUTE ON FUNCTION
  game.admin_upsert_player(TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC,SMALLINT,TEXT) TO authenticated;

/**
 * העברת שחקן לקבוצה אחרת.
 *
 * ★ סוגר שורה ופותח חדשה — לא מעדכן במקום.
 *
 * `UPDATE squads SET team_id = …` היה משכתב את העבר: שאילתה על
 * מחזור 2 הייתה מחזירה את הקבוצה החדשה, וההרכבים היו נראים כאילו
 * הפרו את הכלל "אחד מכל קבוצה". שתי שורות עם תאריכים שומרות על
 * שתי האמיתות.
 */
CREATE OR REPLACE FUNCTION game.admin_move_player(p_ext_player TEXT, p_ext_team TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_player UUID; v_team UUID; v_old core.squads;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  v_player := core.player_by_ext(p_ext_player);
  v_team   := core.team_by_ext(p_ext_team);
  IF v_player IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND'; END IF;
  IF v_team   IS NULL THEN RAISE EXCEPTION 'TEAM_NOT_FOUND'; END IF;

  SELECT * INTO v_old FROM core.squads
   WHERE player_id = v_player AND valid_to IS NULL
   ORDER BY valid_from DESC LIMIT 1;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_IN_SQUAD'; END IF;
  IF v_old.team_id = v_team THEN RETURN; END IF;   -- כבר שם

  UPDATE core.squads SET valid_to = CURRENT_DATE WHERE id = v_old.id;

  INSERT INTO core.squads
    (season_id, team_id, player_id, position, fantasy_price, shirt_number, status,
     valid_from)
  VALUES (v_old.season_id, v_team, v_player, v_old.position, v_old.fantasy_price,
          NULL, 'active', CURRENT_DATE)
  -- אותו יום, אותה קבוצה, פעמיים — למשל תיקון של טעות. לא נופלים.
  ON CONFLICT (season_id, team_id, player_id, valid_from) DO UPDATE
    SET valid_to = NULL, status = 'active';

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, old_value, new_value)
  VALUES (auth.uid()::TEXT, 'admin_move_player', 'player', p_ext_player,
          jsonb_build_object('team', v_old.team_id),
          jsonb_build_object('team', p_ext_team));
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_move_player(TEXT,TEXT) TO authenticated;

/** מחיר. הפעולה שהכי הרבה תיעשה, ולכן היא פונקציה משלה. */
CREATE OR REPLACE FUNCTION game.admin_set_price(p_ext_player TEXT, p_price NUMERIC)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_player UUID;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF p_price IS NULL OR p_price < 0 OR p_price > 99 THEN RAISE EXCEPTION 'PRICE_RANGE'; END IF;

  v_player := core.player_by_ext(p_ext_player);
  IF v_player IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND'; END IF;

  UPDATE core.squads SET fantasy_price = p_price
   WHERE player_id = v_player AND valid_to IS NULL;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (auth.uid()::TEXT, 'admin_set_price', 'player', p_ext_player,
          jsonb_build_object('price', p_price));
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_set_price(TEXT,NUMERIC) TO authenticated;

/**
 * זמינות: פציעה, הרחקה, השאלה, עזיבה.
 *
 * ★ `left` סוגר את שורת הסגל. השאר לא — שחקן פצוע הוא עדיין
 *   בסגל, והוא צריך להופיע בבחירה עם סימון ולא להיעלם. שחקן
 *   שנעלם מהרשימה נראה כמו באג בדאטה.
 */
CREATE OR REPLACE FUNCTION game.admin_set_player_status(p_ext_player TEXT, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_player UUID;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF p_status NOT IN ('active','injured','suspended','loaned_out','left') THEN
    RAISE EXCEPTION 'BAD_STATUS: %', p_status;
  END IF;

  v_player := core.player_by_ext(p_ext_player);
  IF v_player IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND'; END IF;

  UPDATE core.squads
     SET status   = p_status,
         valid_to = CASE WHEN p_status = 'left' THEN CURRENT_DATE ELSE NULL END
   WHERE player_id = v_player AND valid_to IS NULL;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (auth.uid()::TEXT, 'admin_set_player_status', 'player', p_ext_player,
          jsonb_build_object('status', p_status));
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_set_player_status(TEXT,TEXT) TO authenticated;

-- =====================================================================
-- §6 הסגל כפי שהאדמין רואה אותו
-- =====================================================================
--
--  ★ קריאה אחת לכל הליגה, ולא אחת לכל קבוצה.
--
--  14 קבוצות × 25 שחקנים = 350 שורות, כ-40kb. זה פחות מתמונה
--  אחת, והוא חוסך 14 הלוך-ושוב ו-14 מצבי טעינה במסך אחד.
CREATE OR REPLACE FUNCTION game.admin_squads()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = core, game, public
AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(t ORDER BY t->>'teamId')
    FROM (
      SELECT jsonb_build_object(
        'teamId', 'T' || xt.external_id,
        'nameHe', tm.name_he,
        -- ★ העמודה היא `short_code`, לא `short_name`.
        --   הבדיקה הראשונה של הפונקציה הזו (`db/tests/04`) היא
        --   שתפסה את זה: `db/tests/03` בדק רק שהיא **נדחית**
        --   למי שאינו אדמין, ולכן היא מעולם לא רצה בהצלחה.
        --   בדיקה שמוודאת רק שמשהו נכשל אינה בדיקה שהוא עובד.
        'short',  COALESCE(tm.short_code, tm.name_he),
        'players', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id',       'P' || xp.external_id,
            'nameHe',   pl.name_he,
            'nameEn',   pl.name_en,
            'position', sq.position,
            'price',    sq.fantasy_price,
            'shirt',    sq.shirt_number,
            'status',   sq.status
          ) ORDER BY sq.position, pl.name_he)
          FROM core.squads sq
          JOIN core.players pl  ON pl.id = sq.player_id
          JOIN core.v_ext  xp   ON xp.entity_type = 'player' AND xp.entity_id = sq.player_id
          WHERE sq.team_id = tm.id AND sq.valid_to IS NULL
        ), '[]'::jsonb)
      ) AS t
      FROM core.teams tm
      JOIN core.v_ext xt ON xt.entity_type = 'team' AND xt.entity_id = tm.id
    ) q
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_squads() TO authenticated;

-- =====================================================================
-- §7 בדיקת בריאות
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
DROP VIEW IF EXISTS game.v_arena_health;
CREATE VIEW game.v_arena_health AS
SELECT
  (SELECT count(*) FROM game.leagues)                          AS leagues,
  (SELECT count(*) FROM game.league_members)                   AS memberships,
  (SELECT count(*) FROM game.leagues l
    WHERE NOT EXISTS (SELECT 1 FROM game.league_members m
                       WHERE m.league_id = l.id AND m.user_id = l.owner_id))
                                                               AS orphan_leagues,
  (SELECT count(*) FROM core.squads WHERE valid_to IS NULL)    AS active_squad_rows,
  (SELECT count(*) FROM core.squads
    WHERE valid_to IS NULL AND fantasy_price IS NULL)          AS players_without_price;

GRANT SELECT ON game.v_arena_health TO authenticated;

-- =====================================================================
-- §8 ★★ התקציב — אילוץ שהיה קיים רק בדפדפן ★★
-- =====================================================================
--
--  ★ מה נמצא
--
--  דוביד 5 מוגבל ל-15 מיליון. הפס במסך עובד, המספר נכון, והכפתור
--  ננעל בחריגה. וזה **כל** מה שהיה: `submit_entry` לא בדק תקציב
--  בכלל, ו-`core.squads.fantasy_price` היה NULL ל-351 השחקנים
--  (הסיד הכיל `price` ולא מיפה אותו — תוקן ב-`db/03`).
--
--  כלומר: מי ששלח בקשה ישירות ל-API — לא צריך יותר מ-DevTools —
--  יכול היה להגיש חמישה שחקנים במחיר מלא ולנצח מחזור. באיזון של
--  1–5 מיליון, זה ההבדל בין הרכב חוקי לבין הרכב שאין מולו סיכוי.
--
--  ★ למה זה קריטי דווקא עכשיו
--
--  כל עוד הכל היה ב-localStorage, "לרמות" פירושו לשנות מספר
--  בדפדפן שלך ולראות אותו בדפדפן שלך. ברגע שיש דירוג משותף, אותה
--  פעולה משנה את הטבלה של כולם.
--
--  הכלל: **כל אילוץ תחרותי חייב להיאכף בשרת.** הפס במסך הוא
--  נוחות; זה כאן הוא החוק.

CREATE TABLE IF NOT EXISTS game.mode_config (
  mode        TEXT PRIMARY KEY CHECK (mode IN ('five','full')),
  budget      NUMERIC(6,2),        -- NULL = בלי תקציב
  lineup_size SMALLINT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ★ דאטה ולא קבוע בקוד: איזון מחדש הוא UPDATE, לא פריסה.
INSERT INTO game.mode_config (mode, budget, lineup_size) VALUES
  ('five', 15, 5),
  ('full', NULL, 11)
ON CONFLICT (mode) DO NOTHING;

GRANT SELECT ON game.mode_config TO anon, authenticated;

/**
 * `submit_entry` — אותה חתימה, פלוס בדיקת תקציב.
 *
 * מוגדרת מחדש כאן ולא נערכת ב-09: מיגרציות רצות בסדר, והגרסה
 * האחרונה מנצחת. עריכה של קובץ שכבר רץ על ייצור היא הדרך לקבל
 * שני מסדים שחושבים שהם זהים.
 */
CREATE OR REPLACE FUNCTION game.submit_entry(
  p_gw_code   TEXT,
  p_mode      TEXT,
  p_formation TEXT,
  p_slots     JSONB,
  p_display_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE
  v_auth     UUID := auth.uid();
  v_gw       game.gameweeks;
  v_lineup   game.user_lineups;
  v_slot     JSONB;
  v_player   UUID;
  v_team     UUID;
  v_position core."position";
  v_price    NUMERIC(6,2);
  v_captains INT;
  v_vices    INT;
  v_count    INT;
  v_cfg      game.mode_config;
  v_spent    NUMERIC(8,2) := 0;
BEGIN
  IF v_auth IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_mode NOT IN ('five','full') THEN RAISE EXCEPTION 'INVALID_MODE'; END IF;
  IF jsonb_typeof(p_slots) <> 'array' THEN RAISE EXCEPTION 'INVALID_SLOTS'; END IF;

  PERFORM game.ensure_profile(p_display_name);

  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code FOR UPDATE;
  IF v_gw.id IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND: %', p_gw_code; END IF;
  IF v_gw.status NOT IN ('open','draft') THEN RAISE EXCEPTION 'GAMEWEEK_LOCKED'; END IF;
  IF now() >= v_gw.lock_at THEN RAISE EXCEPTION 'DEADLINE_PASSED'; END IF;

  SELECT * INTO v_cfg FROM game.mode_config WHERE mode = p_mode;

  v_count := jsonb_array_length(p_slots);
  IF p_mode = 'five' AND v_count <> 5  THEN RAISE EXCEPTION 'LINEUP_SIZE'; END IF;
  IF p_mode = 'full' AND v_count NOT BETWEEN 5 AND 11 THEN RAISE EXCEPTION 'LINEUP_SIZE'; END IF;

  SELECT count(*) FILTER (WHERE (s->>'is_captain')::BOOLEAN),
         count(*) FILTER (WHERE (s->>'is_vice')::BOOLEAN)
    INTO v_captains, v_vices
    FROM jsonb_array_elements(p_slots) s;
  IF v_captains <> 1 THEN RAISE EXCEPTION 'CAPTAIN_REQUIRED'; END IF;
  IF v_vices > 1     THEN RAISE EXCEPTION 'VICE_DUPLICATE'; END IF;

  INSERT INTO game.user_lineups (user_id, gameweek_id, mode, formation, status, submitted_at)
  VALUES (v_auth, v_gw.id, p_mode, p_formation, 'submitted', now())
  ON CONFLICT (user_id, gameweek_id, mode) DO UPDATE
    SET formation    = EXCLUDED.formation,
        status       = 'submitted',
        submitted_at = now()
  RETURNING * INTO v_lineup;

  DELETE FROM game.user_lineup_slots WHERE lineup_id = v_lineup.id;

  FOR v_slot IN SELECT * FROM jsonb_array_elements(p_slots) LOOP
    v_player := core.player_by_ext(v_slot->>'ext_player_id');
    IF v_player IS NULL THEN
      RAISE EXCEPTION 'PLAYER_NOT_FOUND: %', v_slot->>'ext_player_id';
    END IF;

    -- ★ הקבוצה, העמדה והשווי נלקחים מהמסד — לא מהקליינט.
    SELECT sq.team_id, sq.position, COALESCE(sq.fantasy_price, 0)
      INTO v_team, v_position, v_price
      FROM core.squads sq
     WHERE sq.player_id = v_player
       AND sq.season_id = v_gw.season_id
       AND sq.valid_to IS NULL
       AND sq.status   = 'active'
     ORDER BY sq.valid_from DESC
     LIMIT 1;
    IF v_team IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_IN_SQUAD: %', v_player; END IF;

    v_spent := v_spent + v_price;

    INSERT INTO game.user_lineup_slots
      (lineup_id, slot_no, player_id, team_id, position, price, is_captain, is_vice, is_bench)
    VALUES (
      v_lineup.id, (v_slot->>'slot_no')::SMALLINT, v_player, v_team, v_position, v_price,
      COALESCE((v_slot->>'is_captain')::BOOLEAN, FALSE),
      COALESCE((v_slot->>'is_vice')::BOOLEAN, FALSE),
      COALESCE((v_slot->>'is_bench')::BOOLEAN, FALSE)
    );
  END LOOP;

  -- ★★ התקציב. אחרי שכל המחירים נקראו מהמסד, ולפני ההחזרה.
  --    ה-EXCEPTION מגלגל את כל הטרנזקציה — כולל ההרכב שכבר נכתב.
  IF v_cfg.budget IS NOT NULL AND v_spent > v_cfg.budget THEN
    RAISE EXCEPTION 'OVER_BUDGET: % > %', v_spent, v_cfg.budget;
  END IF;

  RETURN jsonb_build_object(
    'id', v_lineup.id, 'gameweek', p_gw_code, 'mode', p_mode,
    'spent', v_spent, 'budget', v_cfg.budget,
    'submitted_at', v_lineup.submitted_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION game.submit_entry(TEXT, TEXT, TEXT, JSONB, TEXT) TO authenticated;

-- =====================================================================
-- §9 ★★ אותו באג, בעמודה אחרת: `referral_code` ★★
-- =====================================================================
--
--  ★ איך זה נמצא
--
--  בדיקת הזירות (`db/tests/03`) יצרה שלושה משתמשים עם UUID
--  שמתחילים ב-`e0000000`. ההרשמה **השנייה נכשלה**:
--
--      ERROR: duplicate key value violates unique constraint
--             "users_referral_code_key"
--      Key (referral_code)=(E0000000) already exists.
--
--  ★ למה זה לא רק בעיה של הבדיקה
--
--  `referral_code` נגזר מ-`left(uuid, 8)` והוא `UNIQUE`. שמונה
--  תווים הקסדצימליים הם 2^32 אפשרויות, ובפרדוקס יום ההולדת
--  ההסתברות להתנגשות עוברת 50% סביב **77,000 משתמשים**. בעשרות
--  אלפים היא כבר לא זניחה.
--
--  וההתנגשות אינה "שני אנשים עם אותו קוד" — היא **ההרשמה
--  נכשלת לגמרי**, כי ה-INSERT נופל. אותו כשל בדיוק שתוקן לשמות
--  המשתמש ב-`db/10` §2, בעמודה שנשכחה.
--
--  ★ התיקון: אותה סולם שלוש־דרגות, ומאותה סיבה.
--     8 תווים → 12 תווים → ה-UUID המלא (ייחודי בהגדרה).
--
--  ⚠ קודים קיימים לא משתנים. מי שכבר שיתף את הקוד שלו ממשיך
--    לעבוד — שינוי רטרואקטיבי היה שובר קישורי הזמנה חיים.

CREATE OR REPLACE FUNCTION game.users_referral_dedupe()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = game, public
AS $$
DECLARE v_hex TEXT; v_try TEXT;
BEGIN
  v_hex := upper(replace(NEW.id::TEXT, '-', ''));

  v_try := COALESCE(NULLIF(btrim(NEW.referral_code), ''), left(v_hex, 8));
  IF NOT EXISTS (SELECT 1 FROM game.users
                  WHERE referral_code = v_try AND id <> NEW.id) THEN
    NEW.referral_code := v_try;
    RETURN NEW;
  END IF;

  v_try := left(v_hex, 12);
  IF NOT EXISTS (SELECT 1 FROM game.users
                  WHERE referral_code = v_try AND id <> NEW.id) THEN
    NEW.referral_code := v_try;
    RETURN NEW;
  END IF;

  NEW.referral_code := v_hex;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_referral_dedupe ON game.users;
-- INSERT בלבד, כמו הטריגר של שם המשתמש: קוד קיים לא זז.
CREATE TRIGGER users_referral_dedupe
  BEFORE INSERT ON game.users
  FOR EACH ROW EXECUTE FUNCTION game.users_referral_dedupe();

-- ---------------------------------------------------------------------
-- יישור שורות קיימות שנוצרו לפני הטריגר
-- ---------------------------------------------------------------------
DO $fix$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM game.users u
     WHERE u.referral_code IS NULL
        OR EXISTS (SELECT 1 FROM game.users o
                    WHERE o.referral_code = u.referral_code AND o.id < u.id)
  LOOP
    UPDATE game.users
       SET referral_code = upper(replace(r.id::TEXT, '-', ''))
     WHERE id = r.id;
  END LOOP;
END
$fix$;

-- ---------------------------------------------------------------------
-- בדיקת בריאות מורחבת
-- ---------------------------------------------------------------------
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
DROP VIEW IF EXISTS game.v_accounts_health;
CREATE VIEW game.v_accounts_health AS
SELECT
  count(*)                                             AS users_total,
  count(*) FILTER (WHERE is_guest)                     AS guests,
  count(*) FILTER (WHERE NOT is_guest)                 AS registered,
  count(*) FILTER (WHERE offsides_user_id IS NOT NULL) AS linked_to_offsides,
  count(*) FILTER (WHERE username IS NULL)             AS missing_username,
  count(*) - count(DISTINCT username)                  AS duplicate_usernames,
  count(*) FILTER (WHERE referral_code IS NULL)        AS missing_referral,
  count(*) - count(DISTINCT referral_code)             AS duplicate_referral
FROM game.users;

GRANT SELECT ON game.v_accounts_health TO authenticated;


-- =====================================================================
-- ▼▼▼  12_admin_access.sql  —  כניסת אדמין בסיסמה אחת
-- =====================================================================

-- =====================================================================
--  DUBID · מיגרציה 12 — כניסת אדמין בסיסמה אחת
--
--  ★ מה זה פותר
--
--  עד עכשיו כניסה לניהול דרשה **שני** דברים שלא קשורים זה לזה:
--
--     1. קוד גישה במסך  → פותח את המסך
--     2. `UPDATE game.users SET is_admin = TRUE` ב-SQL Editor
--        → מאפשר לשמור
--
--  מי שעשה רק את הראשון קיבל מסך מלא שבו כל לחיצה נכשלת. זה
--  לא "אבטחה בשתי שכבות" — זו שכחה שנראית כמו באג.
--
--  ★ הפתרון: אותה סיסמה עושה את שניהם.
--
--  המסך שולח את הסיסמה ל-`game.claim_admin`. השרת משווה מול
--  hash שמור, ואם היא נכונה — מסמן את הקורא כאדמין. אין שלב שני,
--  אין SQL Editor, ואין מצב ביניים.
--
--  ═══════════════════════════════════════════════════════════════
--  ★ מה זה כן, ומה זה לא, מבחינת אבטחה
--  ═══════════════════════════════════════════════════════════════
--
--  **כן:** הסיסמה נבדקת **בשרת**. הקליינט לא מחליט כלום — הוא
--  שולח מחרוזת ומקבל כן/לא. מי שיערוך את הקוד בדפדפן יוכל לפתוח
--  את המסך, ולא יוכל לשמור שום דבר.
--
--  **כן:** הסיסמה לא נשמרת. רק SHA-256 שלה, ועם `pgcrypto`.
--
--  **כן:** מוגבל בקצב. חמישה ניסיונות כושלים בחמש דקות → נעילה.
--  בלי זה, פונקציה ציבורית שמקבלת סיסמה היא הזמנה לניחוש בכוח גס.
--
--  **לא:** זו לא סיסמה חזקה, וזה לא ניהול הרשאות. זו **סיסמת
--  צוות אחת** לשלב שבו יש אדמין אחד. כשיהיו שניים — צריך
--  להעביר את זה לחשבונות אמיתיים, ו-`is_admin` כבר בנוי לזה.
--
--  ⚠ הסיסמה מגיעה למסד כטקסט על גבי TLS. זה תקין, וזה בדיוק מה
--    שקורה בכל טופס התחברות. מה שאסור הוא לשמור אותה כך.
--
--  אידמפוטנטי.
-- =====================================================================

SET search_path = game, public;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- 1. הסוד
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game.admin_secrets (
  id          TEXT PRIMARY KEY DEFAULT 'primary',
  secret_hash TEXT NOT NULL,
  label       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at  TIMESTAMPTZ
);

-- ★ אין GRANT. הטבלה נגישה אך ורק דרך `claim_admin`, שהיא
--   SECURITY DEFINER. שאילתה ישירה מהדפדפן מקבלת 404.
ALTER TABLE game.admin_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON game.admin_secrets FROM anon, authenticated;

/**
 * SHA-256 של `hapoelTA14!`.
 *
 * ★ למה ה-hash מופיע כאן ולא הסיסמה: כדי שהקובץ הזה יוכל לחיות
 *   ב-git. מי שקורא את הריפו לא מקבל את הסיסמה.
 *
 * ★ להחלפת סיסמה, בשורה אחת מה-SQL Editor:
 *
 *     UPDATE game.admin_secrets
 *        SET secret_hash = encode(digest('הסיסמה-החדשה','sha256'),'hex'),
 *            rotated_at  = now()
 *      WHERE id = 'primary';
 *
 *   ⚠ אחרי החלפה — לעדכן גם את `ADMIN_PIN_HASH` ב-`src/lib/store.ts`,
 *     אחרת השער המקומי ידחה סיסמה שהשרת מקבל.
 */
INSERT INTO game.admin_secrets (id, secret_hash, label)
VALUES ('primary',
        '15a4edaa167df3c9656a9d3dacb527f795dfd2007bc2e0247a27eaeefc8343bf',
        'סיסמת צוות · מחזור 2')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. הגבלת קצב
-- ---------------------------------------------------------------------
--  ★ המפתח הוא המשתמש, לא ה-IP.
--
--  אין לנו IP ברמת ה-RPC, ולכל מבקר יש זהות (גם אורח אנונימי).
--  זה לא מושלם — מי שמנקה עוגיות מקבל זהות חדשה — אבל הוא
--  מייקר ניחוש אוטומטי מספיק, והאלטרנטיבה היא כלום.
CREATE TABLE IF NOT EXISTS game.admin_attempts (
  user_id     UUID PRIMARY KEY,
  attempts    SMALLINT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE game.admin_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON game.admin_attempts FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. הפונקציה
-- ---------------------------------------------------------------------
/**
 * מקבל סיסמה, מחזיר את התוצאה, ובדרך הופך את הקורא לאדמין.
 *
 * מחזיר JSONB ולא BOOLEAN כי המסך צריך להבדיל בין "סיסמה
 * שגויה" לבין "נעול לשלוש דקות" — שתי הודעות שונות לגמרי
 * למשתמש, ואי אפשר לגזור אותן מ-`false`.
 */
CREATE OR REPLACE FUNCTION game.claim_admin(p_secret TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE
  v_user    UUID := auth.uid();
  v_hash    TEXT;
  v_stored  TEXT;
  v_row     game.admin_attempts;
  v_wait    INT;
  MAX_TRIES CONSTANT INT := 5;
  LOCK_MINS CONSTANT INT := 5;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'AUTH_REQUIRED');
  END IF;

  -- הפרופיל חייב להתקיים לפני שמסמנים אותו.
  PERFORM game.ensure_profile(NULL);

  SELECT * INTO v_row FROM game.admin_attempts WHERE user_id = v_user;

  IF v_row.locked_until IS NOT NULL AND v_row.locked_until > now() THEN
    v_wait := CEIL(EXTRACT(EPOCH FROM (v_row.locked_until - now())));
    RETURN jsonb_build_object('ok', FALSE, 'error', 'LOCKED', 'retryInSeconds', v_wait);
  END IF;

  v_hash := encode(digest(COALESCE(p_secret, ''), 'sha256'), 'hex');
  SELECT secret_hash INTO v_stored FROM game.admin_secrets WHERE id = 'primary';

  IF v_stored IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'NO_SECRET_CONFIGURED');
  END IF;

  -- ★ השוואה בזמן קבוע. `=` על טקסט יוצא מוקדם בתו הראשון
  --   שנבדל, ומדליף — תיאורטית — מידע דרך זמן התגובה. על
  --   מחרוזת hash באורך קבוע זה זניח, אבל זו שורה אחת.
  IF NOT (v_hash = v_stored) OR length(v_hash) <> length(v_stored) THEN
    INSERT INTO game.admin_attempts (user_id, attempts, last_at)
    VALUES (v_user, 1, now())
    ON CONFLICT (user_id) DO UPDATE
      SET attempts = game.admin_attempts.attempts + 1,
          last_at  = now(),
          locked_until = CASE
            WHEN game.admin_attempts.attempts + 1 >= MAX_TRIES
            THEN now() + (LOCK_MINS || ' minutes')::INTERVAL
            ELSE NULL END
    RETURNING * INTO v_row;

    IF v_row.locked_until IS NOT NULL THEN
      RETURN jsonb_build_object('ok', FALSE, 'error', 'LOCKED',
                                'retryInSeconds', LOCK_MINS * 60);
    END IF;
    RETURN jsonb_build_object('ok', FALSE, 'error', 'BAD_SECRET',
                              'triesLeft', MAX_TRIES - v_row.attempts);
  END IF;

  -- ------- נכון -------
  UPDATE game.users SET is_admin = TRUE WHERE id = v_user;
  DELETE FROM game.admin_attempts WHERE user_id = v_user;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (v_user::TEXT, 'claim_admin', 'user', v_user::TEXT,
          jsonb_build_object('at', now()));

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

GRANT EXECUTE ON FUNCTION game.claim_admin(TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 4. ויתור על הרשאה
-- ---------------------------------------------------------------------
--  ★ "יציאה" צריכה לכבות גם את הדגל במסד, לא רק את המסך.
--
--  אחרת כל מכשיר שהוקלדה בו הסיסמה פעם אחת נשאר אדמין לנצח —
--  כולל טלפון שהושאל למישהו לרגע.
CREATE OR REPLACE FUNCTION game.release_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN RETURN FALSE; END IF;
  UPDATE game.users SET is_admin = FALSE WHERE id = v_user AND is_admin;
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION game.release_admin() TO authenticated;

-- ---------------------------------------------------------------------
-- 5. בדיקת בריאות
-- ---------------------------------------------------------------------
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
DROP VIEW IF EXISTS game.v_admin_health;
CREATE VIEW game.v_admin_health AS
SELECT
  (SELECT count(*) FROM game.admin_secrets)                    AS secrets,
  (SELECT count(*) FROM game.users WHERE is_admin)             AS admins,
  (SELECT count(*) FROM game.admin_attempts
    WHERE locked_until > now())                                AS locked_now,
  (SELECT max(rotated_at) FROM game.admin_secrets)             AS last_rotation;

GRANT SELECT ON game.v_admin_health TO authenticated;


-- =====================================================================
-- ▼▼▼  13_live_data.sql  —  סגלים, לוח, טיוטות ומונה גרסה — הכל מהשרת
-- =====================================================================

-- =====================================================================
--  Dubid · מיגרציה 13 — הדאטה עוברת לשרת, במלואה
-- =====================================================================
--
--  ★ הבעיה שהמיגרציה הזו פותרת
--
--  עד כאן, לוח הניהול **כתב** למסד — ואף אחד לא **קרא** ממנו.
--
--  14 הקבוצות ו-351 השחקנים חיו ב-`src/data/squads.ts`: קובץ
--  TypeScript של 5,460 שורות שנארז לתוך ה-JavaScript בזמן בנייה.
--  לוח המשחקים חי ב-`src/data/fixtures.ts`. כלומר האדמין שינה
--  מחיר, הפונקציה רצה, ה-audit log נרשם — ואז המסך המשיך להציג
--  את המספר מהקובץ, כי הוא מעולם לא שאל את השרת.
--
--  זה נראה בדיוק כמו "האדמין לא שומר". הוא שמר. פשוט אף מסך
--  בעולם לא הסתכל.
--
--  ★ מה נוסף כאן
--
--    §1  עמודות שהיו קיימות רק ב-JSON של הסיד (tier, דירוג,
--        עיר, אצטדיון) הופכות לעמודות אמיתיות, וממולאות ממנו.
--        בלעדיהן `game.squads()` לא יכולה להחזיר את מה שהמסך
--        צריך, והמעבר לשרת היה מוריד מידע מהמוצר.
--
--    §2  `game.data_revision` — מונה אחד שעולה בכל שינוי דאטה.
--        זה מה ש-Realtime משדר, ולכן כל מכשיר שפתוח מגלה תוך
--        שנייה שהאדמין שינה משהו. בלי זה "און ליין" פירושו
--        "נכון לרגע שבו טענת את הדף".
--
--    §3  `game.squads()`   — הסגלים, בשפת הקליינט (T3 / P305).
--    §4  `game.fixtures()` — לוח המשחקים, אותה שפה.
--
--    §5  טיוטות. עד כאן ההרכב שבנייה חי ב-`localStorage`: מי
--        שהתחיל בטלפון והמשיך במחשב התחיל מאפס, ומי שניקה
--        דפדפן איבד הכל. עכשיו הטיוטה יושבת בשרת.
--
--    §6  ניהול: קבוצות, משחקים, דדליין, וסטטוס מחזור.
--
--  ★ מה **לא** נעשה כאן, בכוונה
--
--  `core.squads` לא מקבל UPDATE הרסני, שום שורה לא נמחקת, ושום
--  פונקציה קיימת לא משנה חתימה חוץ מאחת (`admin_upsert_player`,
--  §6.4 — עם DROP מפורש ולא overload, כי שתי גרסאות עם פרמטרים
--  אופציונליים הן קריאה דו-משמעית שנופלת ב-runtime).
--
--  אידמפוטנטי. אפשר להריץ שוב, בכל סדר.
-- =====================================================================

SET search_path = core, game, public;

-- =====================================================================
-- §1 העמודות שחסרו
-- =====================================================================
--
--  ★ למה זה לא היה חסר עד היום
--
--  הסיד (`db/03`) שמר את ה-JSON המקורי של כל שחקן וקבוצה בתוך
--  `core.external_refs.payload`. שם יש דרג, דירוג כללי, לאום,
--  קפטנות מועדון, עיר ואצטדיון — הכל. פשוט אף אחד לא מיפה אותם
--  לעמודות, כי אף שאילתה לא היה צריכה אותם: המסך קרא מהקובץ.
--
--  ברגע שהמסך קורא מהמסד, מה שאין בעמודה — לא קיים.
--
--  ⚠ `payload` הוא צילום של הסיד ולא מתעדכן מהאדמין. לכן הוא
--    משמש כאן **למילוי ראשוני בלבד**: כל UPDATE כאן מותנה ב-
--    `IS NULL`, ולכן ערך שהאדמין קבע לא נדרס בהרצה חוזרת.

ALTER TABLE core.teams   ADD COLUMN IF NOT EXISTS city    TEXT;
ALTER TABLE core.teams   ADD COLUMN IF NOT EXISTS stadium TEXT;

ALTER TABLE core.players ADD COLUMN IF NOT EXISTS is_club_captain BOOLEAN NOT NULL DEFAULT FALSE;
-- `nationality` הוא CHAR(2) לפי תקן; המסך מציג "ישראל" ולא "IL".
ALTER TABLE core.players ADD COLUMN IF NOT EXISTS nationality_he  TEXT;

ALTER TABLE core.squads  ADD COLUMN IF NOT EXISTS tier         SMALLINT
  CONSTRAINT squads_tier_range CHECK (tier IS NULL OR tier BETWEEN 1 AND 5);
ALTER TABLE core.squads  ADD COLUMN IF NOT EXISTS overall_rank INT;
ALTER TABLE core.squads  ADD COLUMN IF NOT EXISTS rated        BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------- מילוי
DO $backfill$
DECLARE v_teams INT := 0; v_players INT := 0;
BEGIN
  ------------------------------------------------------------- קבוצות
  UPDATE core.teams t SET
    city       = COALESCE(t.city,    NULLIF(x.payload->>'city', '')),
    stadium    = COALESCE(t.stadium, NULLIF(x.payload->>'stadium', '')),
    -- ★ `short_code` נזרע כ-`left(name_en,3)` — כלומר 'Hap' ו-'Mac'
    --   לחמש קבוצות שונות. הקיצור העברי ('הב״ש') היה ב-payload
    --   כל הזמן. בלי התיקון הזה הטבלאות והכרטיסים היו מציגים
    --   שלוש אותיות לטיניות זהות לחצי מהליגה.
    short_code = CASE
                   WHEN NULLIF(x.payload->>'short', '') IS NOT NULL
                        AND (t.short_code IS NULL OR t.short_code = left(t.name_en, 3))
                     THEN x.payload->>'short'
                   ELSE t.short_code
                 END
  FROM core.external_refs x
  WHERE x.provider = 'manual_json' AND x.entity_type = 'team' AND x.entity_id = t.id
    AND x.payload IS NOT NULL;
  GET DIAGNOSTICS v_teams = ROW_COUNT;

  ------------------------------------------------------------- שחקנים
  UPDATE core.players p SET
    is_club_captain = COALESCE(p.is_club_captain, FALSE)
                      OR COALESCE((x.payload->>'is_club_captain')::BOOLEAN, FALSE),
    nationality_he  = COALESCE(p.nationality_he, NULLIF(x.payload->>'nationality', ''))
  FROM core.external_refs x
  WHERE x.provider = 'manual_json' AND x.entity_type = 'player' AND x.entity_id = p.id
    AND x.payload IS NOT NULL;
  GET DIAGNOSTICS v_players = ROW_COUNT;

  UPDATE core.squads sq SET
    tier         = COALESCE(sq.tier,         NULLIF(x.payload->>'tier', '')::SMALLINT),
    overall_rank = COALESCE(sq.overall_rank, NULLIF(x.payload->>'overall_rank', '')::INT),
    rated        = sq.rated OR COALESCE((x.payload->>'rated')::BOOLEAN, FALSE)
  FROM core.external_refs x
  WHERE x.provider = 'manual_json' AND x.entity_type = 'player'
    AND x.entity_id = sq.player_id AND x.payload IS NOT NULL
    AND sq.valid_to IS NULL;

  RAISE NOTICE 'מילוי: % קבוצות, % שחקנים', v_teams, v_players;
END
$backfill$;

-- =====================================================================
-- §2 מונה הגרסה — הדופק של "און ליין"
-- =====================================================================
--
--  ★ למה טבלה ולא Realtime ישירות על `core.squads`
--
--  אפשר היה לשדר את `core.squads` עצמה. שלוש סיבות לא לעשות את זה:
--
--   1. שינוי מחיר אחד באדמין נוגע ב-3 טבלאות (players, squads,
--      audit_logs). המסך היה מקבל שלושה אירועים ומרענן שלוש פעמים.
--   2. `ALTER PUBLICATION` על טבלה עם RLS חושף שורות מלאות
--      למאזינים. מונה חושף מספר.
--   3. מונה אחד = מקום אחד להאזין לו, במקום רשימה שתגדל.
--
--  שורה אחת. מספר אחד. מי שרואה מספר גדול מזה שבידו — טוען מחדש.

CREATE TABLE IF NOT EXISTS game.data_revision (
  id         SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  revision   BIGINT NOT NULL DEFAULT 1,
  scope      TEXT   NOT NULL DEFAULT 'boot',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO game.data_revision (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON game.data_revision TO anon, authenticated;

/* ★ RLS דלוקה עם מדיניות פתוחה, ולא כבויה.
 *
 * זה נראה מיותר — הטבלה מחזיקה מספר אחד — אבל Realtime של
 * Supabase **לא משדר** אירועי `postgres_changes` מטבלה שאין
 * למאזין מדיניות SELECT עליה. בלי שתי השורות האלה הכל עובד
 * חוץ מהדבר היחיד שהטבלה קיימת בשבילו: שינוי אצל האדמין לא
 * מגיע למכשירים שפתוחים, והמשתמש צריך לרענן ידנית.
 *
 * `USING (TRUE)` נכון כאן: מספר גרסה אינו סוד. */
DO $rev_rls$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN RETURN; END IF;
  ALTER TABLE game.data_revision ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS data_revision_read ON game.data_revision;
  CREATE POLICY data_revision_read ON game.data_revision FOR SELECT USING (TRUE);
END
$rev_rls$;

CREATE OR REPLACE FUNCTION game.bump_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = game, public
AS $$
BEGIN
  UPDATE game.data_revision
     SET revision = revision + 1, scope = TG_TABLE_NAME, updated_at = now()
   WHERE id = 1;
  RETURN NULL;                                   -- AFTER … FOR EACH STATEMENT
END;
$$;

/* ★ FOR EACH STATEMENT ולא ROW.
   עדכון של 25 שחקנים בבת אחת הוא **שינוי אחד** מבחינת המסך.
   טריגר ROW היה מקפיץ את המונה 25 פעמים ומייצר 25 רענונים. */
DO $trg$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'core.squads', 'core.players', 'core.teams',
    'core.weekly_matches', 'game.gameweeks', 'game.mode_config'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS bump_data_revision ON %s', t);
    EXECUTE format(
      'CREATE TRIGGER bump_data_revision AFTER INSERT OR UPDATE OR DELETE ON %s '
      'FOR EACH STATEMENT EXECUTE FUNCTION game.bump_revision()', t);
  END LOOP;
END
$trg$;

/** קריאה זולה: מה הגרסה עכשיו. */
CREATE OR REPLACE FUNCTION game.data_revision_now()
RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$ SELECT revision FROM game.data_revision WHERE id = 1 $$;
GRANT EXECUTE ON FUNCTION game.data_revision_now() TO anon, authenticated;

/* Realtime. הפרסום קיים רק על Supabase, ולכן הכל עטוף. */
DO $pub$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE game.data_revision;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END
$pub$;

-- =====================================================================
-- §3 הסגלים, כפי שכל משתמש רואה אותם
-- =====================================================================
--
--  ★ למה `anon` ולא רק `authenticated`
--
--  המסך הראשון של אורח מציג את הליגה לפני שהוא לחץ על שום דבר.
--  אם הסגל דורש סשן, יש חלון של כמה מאות מילישניות שבו המוצר
--  נראה ריק. דאטת כדורגל היא פומבית ממילא.
--
--  ★ למה קריאה אחת ולא אחת לקבוצה
--
--  14 קבוצות × 25 שחקנים ≈ 40kb. פחות מתמונה אחת, ובמחיר של
--  הלוך-ושוב אחד במקום 14.
--
--  ★ שדות התצוגה (`tier`, `overallRank`, `rated`) יוצאים עם
--    ברירות מחדל ולא NULL: הטיפוס בקליינט הוא `1|2|3|4|5`, וכל
--    NULL שיחמוק לשם הופך לכרטיס שחקן שבור.

CREATE OR REPLACE FUNCTION game.squads()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_season UUID; v_out JSONB;
BEGIN
  SELECT s.id INTO v_season
    FROM core.seasons s
   ORDER BY s.is_current DESC, s.starts_on DESC NULLS LAST
   LIMIT 1;
  IF v_season IS NULL THEN
    RETURN jsonb_build_object('teams', '[]'::jsonb, 'players', '[]'::jsonb);
  END IF;

  SELECT jsonb_build_object(
    'season', (SELECT jsonb_build_object(
                 'code',   l.code,
                 'nameHe', l.names #>> '{he,full}',
                 'nameEn', l.names #>> '{en,full}',
                 'label',  s.label)
                 FROM core.seasons s JOIN core.leagues l ON l.id = s.league_id
                WHERE s.id = v_season),

    'teams', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id',         'T' || xt.external_id,
               'externalId', xt.external_id,
               'nameHe',     tm.name_he,
               'nameEn',     tm.name_en,
               'short',      COALESCE(NULLIF(tm.short_code, ''), tm.name_he),
               'city',       tm.city,
               'stadium',    tm.stadium
             ) ORDER BY xt.external_id::INT)
        FROM core.teams tm
        JOIN core.v_ext xt ON xt.entity_type = 'team' AND xt.entity_id = tm.id
        JOIN core.team_seasons ts ON ts.team_id = tm.id AND ts.season_id = v_season
        -- מזהה חיצוני לא-מספרי היה מפיל את המיון. אין כזה היום,
        -- ואם יהיה — עדיף לסנן אותו מאשר להפיל את כל הליגה.
       WHERE xt.external_id ~ '^[0-9]+$'
    ), '[]'::jsonb),

    'players', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id',            'P' || xp.external_id,
               'externalId',    xp.external_id,
               'teamId',        'T' || xt.external_id,
               'position',      sq.position,
               'nameHe',        pl.name_he,
               'nameEn',        pl.name_en,
               'shirt',         sq.shirt_number,
               'tier',          COALESCE(sq.tier, 3),
               'price',         COALESCE(sq.fantasy_price, 1)::FLOAT8,
               'overallRank',   sq.overall_rank,
               'rated',         sq.rated,
               'nationality',   pl.nationality_he,
               'isClubCaptain', pl.is_club_captain,
               'status',        sq.status
             ) ORDER BY xt.external_id::INT, sq.position, pl.name_he)
        FROM core.squads sq
        JOIN core.players pl ON pl.id = sq.player_id
        JOIN core.teams   tm ON tm.id = sq.team_id
        JOIN core.v_ext   xp ON xp.entity_type = 'player' AND xp.entity_id = pl.id
        JOIN core.v_ext   xt ON xt.entity_type = 'team'   AND xt.entity_id = tm.id
       WHERE sq.season_id = v_season
         AND sq.valid_to IS NULL
         -- ★ פצוע/מורחק **כן** מופיע, עם `status`. שחקן שנעלם
         --   מהרשימה נראה כמו באג; שחקן מסומן הוא מידע.
         AND sq.status <> 'left'
         AND xp.external_id ~ '^[0-9]+$' AND xt.external_id ~ '^[0-9]+$'
    ), '[]'::jsonb),

    'revision', (SELECT revision FROM game.data_revision WHERE id = 1)
  ) INTO v_out;

  RETURN v_out;
END;
$$;
GRANT EXECUTE ON FUNCTION game.squads() TO anon, authenticated;

-- =====================================================================
-- §4 לוח המשחקים
-- =====================================================================
--
--  ★ הדדליין נגזר מהמשחק המוקדם ביותר, ומוחזר יחד עם הלוח.
--    שדה נפרד היה מתיישן ביום שבו האדמין מזיז משחק — והמשחק
--    היה ממשיך לקבל הרכבים אחרי שהכדור מתגלגל.

CREATE OR REPLACE FUNCTION game.fixtures(p_gw_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_gw game.gameweeks; v_list JSONB;
BEGIN
  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw.id IS NULL THEN
    RETURN jsonb_build_object('gameweek', NULL, 'fixtures', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(f ORDER BY f->>'kickoff', f->>'id'), '[]'::jsonb)
    INTO v_list
    FROM (
      SELECT jsonb_build_object(
        'id',         m.id::TEXT,
        'homeTeamId', 'T' || xh.external_id,
        'awayTeamId', 'T' || xa.external_id,
        'kickoff',    to_char(m.kickoff_at AT TIME ZONE 'UTC',
                              'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'status',     m.status,
        'homeGoals',  m.home_goals,
        'awayGoals',  m.away_goals
      ) AS f
      FROM core.weekly_matches m
      JOIN core.v_ext xh ON xh.entity_type = 'team' AND xh.entity_id = m.home_team_id
      JOIN core.v_ext xa ON xa.entity_type = 'team' AND xa.entity_id = m.away_team_id
     WHERE m.gameweek_id = v_gw.id
    ) q;

  RETURN jsonb_build_object(
    'gameweek', jsonb_build_object(
      'id',     v_gw.code,
      'number', v_gw.number,
      'label',  COALESCE(v_gw.names #>> '{he,full}', 'מחזור ' || v_gw.number),
      'status', v_gw.status,
      'lockAt', to_char(v_gw.lock_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'firstKickoffAt', to_char(COALESCE(v_gw.first_kickoff_at, v_gw.lock_at)
                                AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
    'fixtures', v_list,
    'revision', (SELECT revision FROM game.data_revision WHERE id = 1)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION game.fixtures(TEXT) TO anon, authenticated;

-- =====================================================================
-- §5 טיוטות — ההרכב שבבנייה, בשרת
-- =====================================================================
--
--  ★ למה טבלה נפרדת ולא `game.user_lineups` עם status='draft'
--
--  ל-`user_lineups` יש `UNIQUE (user_id, gameweek_id, mode)`, ובה
--  יושבת ההגשה הרשמית. במוצר, הטיוטה וההגשה **חיות במקביל**: אחרי
--  שהגשת אתה עדיין יכול לערוך ולהגיש שוב. כתיבת טיוטה לאותה שורה
--  הייתה מורידה הגשה חתומה חזרה ל-'draft' בכל הקלדה.
--
--  ★ ולמה JSONB ולא שורות סלוטים
--
--  טיוטה היא חלקית מעצם הגדרתה. `user_lineup_slots` דורש
--  `player_id NOT NULL` ואוכף "שחקן אחד מכל קבוצה" — אילוצים
--  נכונים להגשה שנספרת, ומזיקים למשהו שנמצא באמצע עריכה. טיוטה
--  אינה דאטה תחרותית: היא לא נספרת, לא מדורגת, ולא מנוקדת.
--  **כל אילוץ תחרותי נאכף ב-`submit_entry`, ורק שם.**

CREATE TABLE IF NOT EXISTS game.lineup_drafts (
  user_id     UUID NOT NULL REFERENCES game.users(id) ON DELETE CASCADE,
  gameweek_id UUID NOT NULL REFERENCES game.gameweeks(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL CHECK (mode IN ('five','full')),
  formation   TEXT NOT NULL,
  slots       JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, gameweek_id, mode)
);

ALTER TABLE game.lineup_drafts ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON game.lineup_drafts FROM anon, authenticated;

DO $rls$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    RAISE NOTICE 'דילוג על מדיניות הטיוטות: הסכמה auth לא קיימת';
    RETURN;
  END IF;
  DROP POLICY IF EXISTS drafts_own ON game.lineup_drafts;
  -- ★ טיוטה של מישהו אחר היא בדיוק המידע שהורס תחרות: מי שרואה
  --   את ההרכב שבבנייה של יריב יודע מה לא לבחור. `id = auth.uid()`
  --   ולא `TRUE`.
  CREATE POLICY drafts_own ON game.lineup_drafts FOR SELECT USING (user_id = auth.uid());
END
$rls$;

/**
 * שמירת טיוטה. נקראת בהשהיה מהמסך, ולכן היא חייבת להיות זולה
 * ולעולם לא להיכשל על תוכן חלקי.
 */
CREATE OR REPLACE FUNCTION game.save_draft(
  p_gw_code   TEXT,
  p_mode      TEXT,
  p_formation TEXT,
  p_slots     JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_auth UUID := auth.uid(); v_gw UUID;
BEGIN
  IF v_auth IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_mode NOT IN ('five','full') THEN RAISE EXCEPTION 'INVALID_MODE'; END IF;
  IF jsonb_typeof(p_slots) <> 'array' THEN RAISE EXCEPTION 'INVALID_SLOTS'; END IF;
  -- תקרה שפויה: טיוטה היא 5–15 סלוטים, לא מקום לאחסון שרירותי.
  IF jsonb_array_length(p_slots) > 32 THEN RAISE EXCEPTION 'SLOTS_TOO_MANY'; END IF;

  PERFORM game.ensure_profile(NULL);

  SELECT id INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND: %', p_gw_code; END IF;

  INSERT INTO game.lineup_drafts (user_id, gameweek_id, mode, formation, slots)
  VALUES (v_auth, v_gw, p_mode, p_formation, p_slots)
  ON CONFLICT (user_id, gameweek_id, mode) DO UPDATE
    SET formation = EXCLUDED.formation,
        slots     = EXCLUDED.slots,
        updated_at = now();

  RETURN jsonb_build_object('saved', TRUE, 'mode', p_mode);
END;
$$;
GRANT EXECUTE ON FUNCTION game.save_draft(TEXT,TEXT,TEXT,JSONB) TO authenticated;

/**
 * הטיוטות שלי למחזור — שתי המצבים בקריאה אחת.
 *
 * ★ מחזירה גם את ההגשה הרשמית אם קיימת, כי המסך צריך לדעת
 *   בשנייה הראשונה אם הוא במצב עריכה או במצב "נעול".
 */
CREATE OR REPLACE FUNCTION game.my_drafts(p_gw_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_auth UUID := auth.uid(); v_gw UUID;
BEGIN
  IF v_auth IS NULL THEN RETURN '{}'::jsonb; END IF;
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw IS NULL THEN RETURN '{}'::jsonb; END IF;

  RETURN COALESCE((
    SELECT jsonb_object_agg(d.mode, jsonb_build_object(
             'formation', d.formation,
             'slots',     d.slots,
             'updatedAt', to_char(d.updated_at AT TIME ZONE 'UTC',
                                  'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
      FROM game.lineup_drafts d
     WHERE d.user_id = v_auth AND d.gameweek_id = v_gw
  ), '{}'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION game.my_drafts(TEXT) TO authenticated;

/** מחיקת טיוטה — "התחל מחדש" במסך. */
CREATE OR REPLACE FUNCTION game.discard_draft(p_gw_code TEXT, p_mode TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_auth UUID := auth.uid(); v_gw UUID;
BEGIN
  IF v_auth IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw IS NULL THEN RETURN; END IF;
  DELETE FROM game.lineup_drafts
   WHERE user_id = v_auth AND gameweek_id = v_gw AND mode = p_mode;
END;
$$;
GRANT EXECUTE ON FUNCTION game.discard_draft(TEXT,TEXT) TO authenticated;

-- =====================================================================
-- §6 ניהול — מה שאפשר לשנות, ומי רואה את זה
-- =====================================================================

-- ---------------------------------------------------------------- §6.1
/** קבוצה: שם, קיצור, עיר, אצטדיון. */
CREATE OR REPLACE FUNCTION game.admin_upsert_team(
  p_ext_team TEXT,
  p_name_he  TEXT,
  p_name_en  TEXT DEFAULT NULL,
  p_short    TEXT DEFAULT NULL,
  p_city     TEXT DEFAULT NULL,
  p_stadium  TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_team UUID; v_season UUID; v_ext TEXT := NULLIF(btrim(COALESCE(p_ext_team,'')), '');
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF btrim(COALESCE(p_name_he,'')) = '' THEN RAISE EXCEPTION 'NAME_REQUIRED'; END IF;

  SELECT s.id INTO v_season FROM core.seasons s
   ORDER BY s.is_current DESC, s.starts_on DESC NULLS LAST LIMIT 1;
  IF v_season IS NULL THEN RAISE EXCEPTION 'NO_SEASON'; END IF;

  IF v_ext IS NULL THEN
    -- מזהה חדש: הבא בתור במרחב המספרי הקיים.
    SELECT COALESCE(MAX(external_id::INT), 0) + 1 INTO v_ext
      FROM core.external_refs
     WHERE provider = 'manual_json' AND entity_type = 'team' AND external_id ~ '^[0-9]+$';

    INSERT INTO core.teams (country_code, names, short_code, city, stadium)
    VALUES ('IL',
            jsonb_build_object(
              'he', jsonb_build_object('full', btrim(p_name_he)),
              'en', jsonb_build_object('full',
                      COALESCE(NULLIF(btrim(p_name_en),''), btrim(p_name_he)))),
            COALESCE(NULLIF(btrim(p_short),''), btrim(p_name_he)),
            NULLIF(btrim(p_city),''), NULLIF(btrim(p_stadium),''))
    RETURNING id INTO v_team;

    INSERT INTO core.external_refs (provider, entity_type, external_id, entity_id)
    VALUES ('manual_json', 'team', v_ext, v_team);

    INSERT INTO core.team_seasons (team_id, season_id)
    VALUES (v_team, v_season) ON CONFLICT DO NOTHING;
  ELSE
    v_team := core.team_by_ext(v_ext);
    IF v_team IS NULL THEN RAISE EXCEPTION 'TEAM_NOT_FOUND: %', v_ext; END IF;

    UPDATE core.teams SET
      names = names || jsonb_build_object(
                'he', jsonb_build_object('full', btrim(p_name_he)),
                'en', jsonb_build_object('full',
                        COALESCE(NULLIF(btrim(p_name_en),''), names #>> '{en,full}',
                                 btrim(p_name_he)))),
      short_code = COALESCE(NULLIF(btrim(p_short),''),   short_code),
      city       = COALESCE(NULLIF(btrim(p_city),''),    city),
      stadium    = COALESCE(NULLIF(btrim(p_stadium),''), stadium)
    WHERE id = v_team;
  END IF;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (auth.uid()::TEXT, 'admin_upsert_team', 'team', v_ext,
          jsonb_build_object('nameHe', p_name_he, 'short', p_short,
                             'city', p_city, 'stadium', p_stadium));

  RETURN v_ext;
END;
$$;
GRANT EXECUTE ON FUNCTION
  game.admin_upsert_team(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO authenticated;

-- ---------------------------------------------------------------- §6.2
/**
 * משחק: הוספה או הזזה של שעה.
 *
 * ★ הזזת משחק מזיזה את הדדליין, אוטומטית.
 *   `lock_at` נגזר מחדש מהבעיטה המוקדמת ביותר במחזור. אחרת
 *   אדמין שדוחה משחק לשעה מוקדמת יותר משאיר חלון שבו אפשר
 *   להגיש הרכב אחרי שהוא כבר התחיל.
 */
CREATE OR REPLACE FUNCTION game.admin_upsert_fixture(
  p_gw_code  TEXT,
  p_ext_home TEXT,
  p_ext_away TEXT,
  p_kickoff  TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_gw UUID; v_home UUID; v_away UUID; v_match UUID;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  SELECT id INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND: %', p_gw_code; END IF;

  v_home := core.team_by_ext(p_ext_home);
  v_away := core.team_by_ext(p_ext_away);
  IF v_home IS NULL THEN RAISE EXCEPTION 'TEAM_NOT_FOUND: %', p_ext_home; END IF;
  IF v_away IS NULL THEN RAISE EXCEPTION 'TEAM_NOT_FOUND: %', p_ext_away; END IF;
  IF v_home = v_away THEN RAISE EXCEPTION 'SAME_TEAM'; END IF;

  INSERT INTO core.weekly_matches (gameweek_id, home_team_id, away_team_id, kickoff_at, status)
  VALUES (v_gw, v_home, v_away, p_kickoff, 'scheduled')
  ON CONFLICT (gameweek_id, home_team_id, away_team_id) DO UPDATE
    SET kickoff_at = EXCLUDED.kickoff_at
  RETURNING id INTO v_match;

  PERFORM game.admin_resync_deadline(p_gw_code);

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (auth.uid()::TEXT, 'admin_upsert_fixture', 'match', v_match::TEXT,
          jsonb_build_object('gw', p_gw_code, 'home', p_ext_home,
                             'away', p_ext_away, 'kickoff', p_kickoff));
  RETURN v_match;
END;
$$;

/** הסרת משחק מהלוח (נדחה, בוטל). */
CREATE OR REPLACE FUNCTION game.admin_delete_fixture(p_match_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_gw_code TEXT;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  SELECT gw.code INTO v_gw_code
    FROM core.weekly_matches m JOIN game.gameweeks gw ON gw.id = m.gameweek_id
   WHERE m.id = p_match_id;
  IF v_gw_code IS NULL THEN RAISE EXCEPTION 'MATCH_NOT_FOUND'; END IF;

  DELETE FROM core.weekly_matches WHERE id = p_match_id;
  PERFORM game.admin_resync_deadline(v_gw_code);

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, old_value)
  VALUES (auth.uid()::TEXT, 'admin_delete_fixture', 'match', p_match_id::TEXT,
          jsonb_build_object('gw', v_gw_code));
END;
$$;

-- ---------------------------------------------------------------- §6.3
/**
 * הדדליין = הבעיטה המוקדמת ביותר במחזור.
 *
 * ★ פונקציה ולא שדה שמוקלד: המידע כבר קיים בלוח, ושדה שני
 *   שמחזיק את אותה עובדה הוא שדה שיום אחד יסתור אותו.
 *
 * מוגדרת אחרי המשתמשות בה — ב-plpgsql זה חוקי, הקישור נעשה
 * בזמן ריצה.
 */
CREATE OR REPLACE FUNCTION game.admin_resync_deadline(p_gw_code TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_gw UUID; v_first TIMESTAMPTZ;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  SELECT id INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND: %', p_gw_code; END IF;

  SELECT min(kickoff_at) INTO v_first FROM core.weekly_matches WHERE gameweek_id = v_gw;
  IF v_first IS NULL THEN RETURN NULL; END IF;      -- מחזור בלי משחקים: לא נוגעים

  UPDATE game.gameweeks
     SET lock_at = v_first, first_kickoff_at = v_first
   WHERE id = v_gw;

  RETURN v_first;
END;
$$;

/** דדליין ידני — כשצריך לסגור מוקדם, או לפתוח שוב אחרי דחייה. */
CREATE OR REPLACE FUNCTION game.admin_set_deadline(p_gw_code TEXT, p_lock_at TIMESTAMPTZ)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF p_lock_at IS NULL THEN RAISE EXCEPTION 'LOCK_AT_REQUIRED'; END IF;

  UPDATE game.gameweeks SET lock_at = p_lock_at WHERE code = p_gw_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND: %', p_gw_code; END IF;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (auth.uid()::TEXT, 'admin_set_deadline', 'gameweek', p_gw_code,
          jsonb_build_object('lockAt', p_lock_at));
END;
$$;

/** סטטוס מחזור בשפת הקליינט (`gw-2`), לא ב-UUID. */
CREATE OR REPLACE FUNCTION game.admin_set_status(p_gw_code TEXT, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF p_status NOT IN ('upcoming','open','locked','live','settled') THEN
    RAISE EXCEPTION 'BAD_STATUS: %', p_status;
  END IF;

  UPDATE game.gameweeks SET status = p_status WHERE code = p_gw_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND: %', p_gw_code; END IF;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (auth.uid()::TEXT, 'admin_set_status', 'gameweek', p_gw_code,
          jsonb_build_object('status', p_status));
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_upsert_fixture(TEXT,TEXT,TEXT,TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION game.admin_delete_fixture(UUID)                       TO authenticated;
GRANT EXECUTE ON FUNCTION game.admin_resync_deadline(TEXT)                      TO authenticated;
GRANT EXECUTE ON FUNCTION game.admin_set_deadline(TEXT,TIMESTAMPTZ)             TO authenticated;
GRANT EXECUTE ON FUNCTION game.admin_set_status(TEXT,TEXT)                      TO authenticated;

-- ---------------------------------------------------------------- §6.4
--
--  ★ `admin_upsert_player` — חתימה חדשה, ולא overload.
--
--  הגרסה מ-`db/11` לא ידעה על `tier` / `overall_rank` / לאום /
--  קפטן מועדון, כי הם לא היו עמודות. עכשיו הם כן, ושחקן שנוסף
--  בלעדיהם היה מקבל דרג 3 ולא מדורג — כלומר נראה שונה מכל
--  שאר הליגה בלי שאף אחד ביקש.
--
--  ⚠ DROP מפורש. שתי גרסאות שנבדלות רק בפרמטרים עם DEFAULT הן
--    קריאה דו-משמעית: PostgREST היה בוחר אחת מהן, ולא בהכרח את
--    זו שהמסך התכוון אליה. עדיף להסיר.
DROP FUNCTION IF EXISTS game.admin_upsert_player(TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC,SMALLINT,TEXT);

CREATE OR REPLACE FUNCTION game.admin_upsert_player(
  p_ext_team    TEXT,
  p_name_he     TEXT,
  p_ext_player  TEXT     DEFAULT NULL,
  p_name_en     TEXT     DEFAULT NULL,
  p_position    TEXT     DEFAULT 'MID',
  p_price       NUMERIC  DEFAULT NULL,
  p_shirt       SMALLINT DEFAULT NULL,
  p_status      TEXT     DEFAULT 'active',
  p_tier        SMALLINT DEFAULT NULL,
  p_overall_rank INT     DEFAULT NULL,
  p_nationality TEXT     DEFAULT NULL,
  p_is_captain  BOOLEAN  DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE
  v_team   UUID;
  v_player UUID;
  v_ext    TEXT := NULLIF(btrim(COALESCE(p_ext_player, '')), '');
  v_season UUID;
  v_pos    core."position";
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF btrim(COALESCE(p_name_he, '')) = '' THEN RAISE EXCEPTION 'NAME_REQUIRED'; END IF;
  IF p_tier IS NOT NULL AND p_tier NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'TIER_RANGE'; END IF;
  IF p_price IS NOT NULL AND (p_price < 0 OR p_price > 99) THEN RAISE EXCEPTION 'PRICE_RANGE'; END IF;

  v_team := core.team_by_ext(p_ext_team);
  IF v_team IS NULL THEN RAISE EXCEPTION 'TEAM_NOT_FOUND: %', p_ext_team; END IF;

  v_pos := p_position::core."position";

  SELECT s.id INTO v_season FROM core.seasons s
   ORDER BY s.is_current DESC, s.starts_on DESC NULLS LAST LIMIT 1;
  IF v_season IS NULL THEN RAISE EXCEPTION 'NO_SEASON'; END IF;

  IF v_ext IS NULL THEN
    ------------------------------------------------------ שחקן חדש
    v_ext := core.next_player_ext(p_ext_team);

    INSERT INTO core.players (names, primary_position, nationality_he, is_club_captain)
    VALUES (jsonb_build_object(
              'he', jsonb_build_object('full', btrim(p_name_he)),
              'en', jsonb_build_object('full',
                      COALESCE(NULLIF(btrim(p_name_en), ''), btrim(p_name_he)))),
            v_pos, NULLIF(btrim(COALESCE(p_nationality,'')), ''),
            COALESCE(p_is_captain, FALSE))
    RETURNING id INTO v_player;

    INSERT INTO core.external_refs (provider, entity_type, external_id, entity_id)
    VALUES ('manual_json', 'player', v_ext, v_player);

    INSERT INTO core.squads
      (season_id, team_id, player_id, position, fantasy_price, shirt_number, status,
       tier, overall_rank, rated)
    VALUES (v_season, v_team, v_player, v_pos, p_price, p_shirt, p_status,
            COALESCE(p_tier, 3), p_overall_rank, p_overall_rank IS NOT NULL);

  ELSE
    -------------------------------------------------------- עריכה
    v_player := core.player_by_ext(v_ext);
    IF v_player IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND: %', v_ext; END IF;

    UPDATE core.players SET
      names = jsonb_build_object(
                'he', jsonb_build_object('full', btrim(p_name_he)),
                'en', jsonb_build_object('full',
                        COALESCE(NULLIF(btrim(p_name_en), ''),
                                 names #>> '{en,full}', btrim(p_name_he)))),
      primary_position = v_pos,
      nationality_he   = COALESCE(NULLIF(btrim(COALESCE(p_nationality,'')), ''), nationality_he),
      is_club_captain  = COALESCE(p_is_captain, is_club_captain),
      updated_at = now()
    WHERE id = v_player;

    UPDATE core.squads SET
      position      = v_pos,
      fantasy_price = COALESCE(p_price, fantasy_price),
      shirt_number  = COALESCE(p_shirt, shirt_number),
      status        = p_status,
      tier          = COALESCE(p_tier, tier),
      overall_rank  = COALESCE(p_overall_rank, overall_rank),
      rated         = rated OR p_overall_rank IS NOT NULL
    WHERE player_id = v_player AND valid_to IS NULL;
  END IF;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (auth.uid()::TEXT, 'admin_upsert_player', 'player', v_ext,
          jsonb_build_object('team', p_ext_team, 'name', p_name_he,
                             'pos', p_position, 'price', p_price, 'status', p_status,
                             'tier', p_tier, 'rank', p_overall_rank));

  RETURN v_ext;
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_upsert_player(
  TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC,SMALLINT,TEXT,SMALLINT,INT,TEXT,BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------- §6.5
--
--  `admin_squads()` מורחבת: אותם שדות שהמסך הראשי מקבל, כדי
--  שמסך הניהול יערוך **בדיוק** את מה שהמשתמש רואה. שתי צורות
--  של אותה ישות הן שתי אמיתות שיתפצלו.
CREATE OR REPLACE FUNCTION game.admin_squads()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = core, game, public
AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(t ORDER BY (t->>'sort')::INT)
    FROM (
      SELECT jsonb_build_object(
        'teamId', 'T' || xt.external_id,
        'sort',   xt.external_id::INT,
        'nameHe', tm.name_he,
        'short',  COALESCE(NULLIF(tm.short_code, ''), tm.name_he),
        'city',   tm.city,
        'stadium', tm.stadium,
        'players', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id',       'P' || xp.external_id,
            'nameHe',   pl.name_he,
            'nameEn',   pl.name_en,
            'position', sq.position,
            'price',    sq.fantasy_price,
            'shirt',    sq.shirt_number,
            'status',   sq.status,
            'tier',     sq.tier,
            'overallRank', sq.overall_rank,
            'nationality', pl.nationality_he
          ) ORDER BY sq.position, pl.name_he)
          FROM core.squads sq
          JOIN core.players pl  ON pl.id = sq.player_id
          JOIN core.v_ext  xp   ON xp.entity_type = 'player' AND xp.entity_id = sq.player_id
          WHERE sq.team_id = tm.id AND sq.valid_to IS NULL
        ), '[]'::jsonb)
      ) AS t
      FROM core.teams tm
      JOIN core.v_ext xt ON xt.entity_type = 'team' AND xt.entity_id = tm.id
     WHERE xt.external_id ~ '^[0-9]+$'
    ) q
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_squads() TO authenticated;

-- =====================================================================
-- §7 בדיקת בריאות — עכשיו היא גם אומרת אם הדאטה **נקראת**
-- =====================================================================
DROP VIEW IF EXISTS game.v_live_health;
CREATE VIEW game.v_live_health AS
SELECT
  -- ★ `core.external_refs` ולא `core.v_ext`.
  --
  --   התצוגה `v_ext` נמחקת ונוצרת מחדש ב-`db/09` בכל הרצה. תצוגה
  --   שתלויה בה הופכת את `db/09` ללא-ניתן-להרצה-מחדש:
  --
  --       ERROR: cannot drop view v_ext because other objects
  --              depend on it
  --
  --   פונקציה שקוראת ל-`v_ext` לא יוצרת תלות כזו (הקישור הוא
  --   בזמן ריצה), ולכן `game.squads()` כן משתמשת בה. תצוגה כן.
  (SELECT count(*) FROM core.teams tm
     JOIN core.external_refs x ON x.provider = 'manual_json'
      AND x.entity_type = 'team' AND x.entity_id = tm.id)               AS mapped_teams,
  (SELECT count(*) FROM core.squads WHERE valid_to IS NULL)             AS active_players,
  (SELECT count(*) FROM core.squads
    WHERE valid_to IS NULL AND fantasy_price IS NULL)                   AS players_without_price,
  (SELECT count(*) FROM core.squads WHERE valid_to IS NULL AND tier IS NULL) AS players_without_tier,
  (SELECT count(*) FROM core.teams WHERE short_code IS NULL)            AS teams_without_short,
  (SELECT count(*) FROM core.weekly_matches)                            AS matches,
  (SELECT count(*) FROM game.lineup_drafts)                             AS drafts,
  (SELECT revision FROM game.data_revision WHERE id = 1)                AS revision;

GRANT SELECT ON game.v_live_health TO authenticated;

/* ★ הגרסה עלתה ב-DDL של הקובץ הזה (הטריגרים נוצרו אחרי המילוי),
   וזה בדיוק מה שצריך: לקוח שהיה פתוח בזמן המיגרציה יגלה שהעולם
   השתנה וימשוך מחדש. */
UPDATE game.data_revision SET revision = revision + 1, scope = 'migration-13' WHERE id = 1;


-- =====================================================================
--  סיום
-- =====================================================================
DO $done$
DECLARE h RECORD;
BEGIN
  SELECT * INTO h FROM game.v_health;
  RAISE NOTICE '';
  RAISE NOTICE '  ✓ הושלם.  קבוצות % · שחקנים % · משחקים % · מיפויים %',
    h.teams, h.players, h.matches, h.id_mappings;
  RAISE NOTICE '';
  RAISE NOTICE '  נשאר בלוח הבקרה:';
  RAISE NOTICE '    Settings → API → Exposed schemas: public, core, game, shared';
  RAISE NOTICE '    Authentication → Providers → Anonymous sign-ins: ON';
  RAISE NOTICE '';
END
$done$;
