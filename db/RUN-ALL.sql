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
$$מבנה rules — הערכים כאן הם **ערכי המוצר בפועל**, כפי שהם
ב-src/lib/scoring/rules.ts (IL_PREMIER):
{
  "personal": {
    "goal":        {"GK":6,"DEF":6,"MID":5,"FWD":4},
    "assist":      3,
    "clean_sheet": {"GK":4,"DEF":4,"MID":4,"FWD":4},
    "clean_sheet_min_minutes": 60,
    "minutes_played": 0, "minutes_60": 0,
    "yellow":     -1, "red": -3, "own_goal": -2,
    "save_per_3":  0, "penalty_saved": 0, "penalty_missed": 0,
    "goals_conceded_per_2": {"GK":0,"DEF":0}
  },
  "result_bonus": {"W": 4, "D": 1, "L": 0, "require_minutes": 0},
  "virtual_goal": {"team_goals_per_virtual": 2, "points": 5},
  "captain_multiplier": 3,
  "constraints": {"lineup_size": 11, "max_players_per_team": 1}
}

★ ההערה הזו הייתה שגויה, וזה לא היה תמים.
  היא תיארה שער של שוער כ-10 (בפועל 6), קלין-שיט מדורג
  (בפועל אחיד 4), וקפטן ×2 (בפועל ×3). מי שמילא את הטבלה
  לפיה היה יוצר ליגה שמנקדת אחרת מהמוצר — בלי שום שגיאה,
  כי המבנה תקין. הערה שקרית על טבלת חוקים גרועה מהיעדר הערה.

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
  payload  JSONB := $json${"league":{"id":1,"name_he":"ליגת העל בישראל","name_en":"Israeli Premier League","season":"2026/2027"},"teams":[{"team_id":1,"name_he":"הפועל באר שבע","name_en":"Hapoel Beer Sheva","short":"ב״ש","city":"באר שבע","stadium":null,"players":[{"id":101,"name_he":"אופיר מרציאנו","name_en":"TBD","position":"GK","number":1,"tier":2,"price":3,"overall_rank":28,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":102,"name_he":"גיא מזרחי","name_en":"TBD","position":"DF","number":2,"tier":2,"price":4,"overall_rank":29,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":103,"name_he":"מתן בלטקסה","name_en":"TBD","position":"DF","number":3,"tier":2,"price":4,"overall_rank":36,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":104,"name_he":"מיגל ויטור","name_en":"TBD","position":"DF","number":4,"tier":2,"price":4,"overall_rank":33,"rated":true,"nationality":"פורטוגל","is_club_captain":true},{"id":105,"name_he":"פדרו אמאדור","name_en":"TBD","position":"DF","number":5,"tier":2,"price":4,"overall_rank":37,"rated":true,"nationality":"פורטוגל","is_club_captain":false},{"id":106,"name_he":"אליאל פרץ","name_en":"TBD","position":"MF","number":7,"tier":1,"price":5,"overall_rank":10,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":107,"name_he":"חמודי כנעאן","name_en":"TBD","position":"MF","number":8,"tier":2,"price":3,"overall_rank":38,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":108,"name_he":"זאהי אחמד","name_en":"TBD","position":"FW","number":9,"tier":2,"price":3,"overall_rank":39,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":109,"name_he":"דן ביטון","name_en":"TBD","position":"MF","number":10,"tier":1,"price":5,"overall_rank":2,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":110,"name_he":"אמיר גנאח","name_en":"TBD","position":"MF","number":11,"tier":2,"price":3,"overall_rank":40,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":111,"name_he":"איתי רוטמן","name_en":"TBD","position":"DF","number":12,"tier":2,"price":3,"overall_rank":41,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":112,"name_he":"אופיר דוידזאדה","name_en":"TBD","position":"DF","number":13,"tier":2,"price":4,"overall_rank":42,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":113,"name_he":"יונס מלדה","name_en":"TBD","position":"FW","number":14,"tier":2,"price":3,"overall_rank":43,"rated":true,"nationality":"בלגיה/ישראל","is_club_captain":false},{"id":114,"name_he":"רועי ליוי","name_en":"TBD","position":"DF","number":18,"tier":2,"price":4,"overall_rank":44,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":115,"name_he":"ג'בון איסט","name_en":"TBD","position":"FW","number":20,"tier":2,"price":4,"overall_rank":45,"rated":true,"nationality":"גמייקה","is_club_captain":false},{"id":116,"name_he":"יואב קורן","name_en":"TBD","position":"FW","number":21,"tier":2,"price":4,"overall_rank":46,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":117,"name_he":"איתי חזות","name_en":"TBD","position":"MF","number":23,"tier":2,"price":4,"overall_rank":47,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":118,"name_he":"לוקאס ונטורה","name_en":"TBD","position":"MF","number":25,"tier":2,"price":4,"overall_rank":17,"rated":true,"nationality":"ברזיל","is_club_captain":false},{"id":119,"name_he":"יוני סטויאנוב","name_en":"TBD","position":"MF","number":27,"tier":2,"price":4,"overall_rank":48,"rated":true,"nationality":"בולגריה","is_club_captain":false},{"id":120,"name_he":"ניב יהושע","name_en":"TBD","position":"MF","number":28,"tier":2,"price":3,"overall_rank":49,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":121,"name_he":"מרקו וולף","name_en":"TBD","position":"GK","number":34,"tier":2,"price":3,"overall_rank":50,"rated":true,"nationality":"ארגנטינה","is_club_captain":false},{"id":122,"name_he":"יונתן שני","name_en":"TBD","position":"GK","number":36,"tier":2,"price":2,"overall_rank":51,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":123,"name_he":"ג'יבריל דיופ","name_en":"TBD","position":"DF","number":44,"tier":2,"price":4,"overall_rank":52,"rated":true,"nationality":"סנגל","is_club_captain":false},{"id":124,"name_he":"מוחמד אבו רומי","name_en":"TBD","position":"FW","number":45,"tier":2,"price":4,"overall_rank":53,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":125,"name_he":"ניב אליאסי","name_en":"TBD","position":"GK","number":55,"tier":2,"price":2,"overall_rank":54,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":126,"name_he":"איגור זלאטנוביץ'","name_en":"TBD","position":"FW","number":66,"tier":1,"price":5,"overall_rank":9,"rated":true,"nationality":"סרביה","is_club_captain":false},{"id":127,"name_he":"ז'ואאו ויקטור","name_en":"TBD","position":"FW","number":70,"tier":2,"price":4,"overall_rank":55,"rated":true,"nationality":"ברזיל","is_club_captain":false}]},{"team_id":2,"name_he":"הפועל ירושלים","name_en":"Hapoel Jerusalem","short":"ה·י-ם","city":"ירושלים","stadium":null,"players":[{"id":201,"name_he":"נועם מלמוד","name_en":"TBD","position":"DF","number":3,"tier":2,"price":3,"overall_rank":56,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":202,"name_he":"יונתן לייש","name_en":"TBD","position":"DF","number":4,"tier":2,"price":3,"overall_rank":57,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":203,"name_he":"עומר אבוהב","name_en":"TBD","position":"MF","number":5,"tier":2,"price":3,"overall_rank":58,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":204,"name_he":"לי און מזרחי","name_en":"TBD","position":"DF","number":null,"tier":2,"price":3,"overall_rank":59,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":205,"name_he":"איליאי מדמון","name_en":"TBD","position":"MF","number":8,"tier":2,"price":3,"overall_rank":60,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":206,"name_he":"עידן כהן","name_en":"TBD","position":"DF","number":15,"tier":2,"price":3,"overall_rank":61,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":207,"name_he":"עומר אגבדיש","name_en":"TBD","position":"DF","number":16,"tier":2,"price":3,"overall_rank":62,"rated":true,"nationality":"ישראל","is_club_captain":true},{"id":208,"name_he":"ינאי דיסטפלד","name_en":"TBD","position":"MF","number":17,"tier":2,"price":3,"overall_rank":63,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":209,"name_he":"אופק נדיר","name_en":"TBD","position":"DF","number":20,"tier":2,"price":4,"overall_rank":64,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":210,"name_he":"איינאו פרדה","name_en":"TBD","position":"MF","number":21,"tier":2,"price":3,"overall_rank":65,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":211,"name_he":"תמיר חיימוביץ'","name_en":"TBD","position":"DF","number":22,"tier":2,"price":2,"overall_rank":66,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":212,"name_he":"נתי שפראו","name_en":"TBD","position":"FW","number":23,"tier":2,"price":3,"overall_rank":67,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":213,"name_he":"הילאי מלמן","name_en":"TBD","position":"DF","number":null,"tier":2,"price":2,"overall_rank":68,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":214,"name_he":"אנדרו אידוקו","name_en":"TBD","position":"FW","number":25,"tier":2,"price":3,"overall_rank":69,"rated":true,"nationality":"ניגריה","is_club_captain":false},{"id":215,"name_he":"עומר בן גורדין","name_en":"TBD","position":"GK","number":28,"tier":2,"price":2,"overall_rank":70,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":216,"name_he":"ישראל דאפה","name_en":"TBD","position":"FW","number":33,"tier":2,"price":4,"overall_rank":71,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":217,"name_he":"נדב זמיר","name_en":"TBD","position":"GK","number":55,"tier":2,"price":3,"overall_rank":72,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":218,"name_he":"אוהד אלמגור","name_en":"TBD","position":"MF","number":77,"tier":2,"price":3,"overall_rank":73,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":219,"name_he":"ויט ליייה דאמאשקאן","name_en":"TBD","position":"FW","number":null,"tier":2,"price":4,"overall_rank":74,"rated":true,"nationality":"מולדובה","is_club_captain":false}]},{"team_id":3,"name_he":"מכבי תל אביב","name_en":"Maccabi Tel Aviv","short":"מ·ת״א","city":"תל אביב","stadium":null,"players":[{"id":301,"name_he":"רוי רביבו","name_en":"TBD","position":"DF","number":3,"tier":1,"price":5,"overall_rank":6,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":302,"name_he":"מוחמד עלי קמארה","name_en":"TBD","position":"DF","number":5,"tier":2,"price":4,"overall_rank":75,"rated":true,"nationality":"גינאה","is_club_captain":false},{"id":303,"name_he":"טייריס אסאנטה","name_en":"TBD","position":"DF","number":6,"tier":2,"price":4,"overall_rank":27,"rated":true,"nationality":"הולנד","is_club_captain":false},{"id":304,"name_he":"קרווין אנדרדה","name_en":"TBD","position":"MF","number":10,"tier":2,"price":4,"overall_rank":76,"rated":true,"nationality":"ונצואלה","is_club_captain":false},{"id":305,"name_he":"שגיב יחזקאל","name_en":"TBD","position":"DF","number":11,"tier":2,"price":4,"overall_rank":11,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":306,"name_he":"רז שלמה","name_en":"TBD","position":"DF","number":13,"tier":2,"price":4,"overall_rank":77,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":307,"name_he":"דני גרופר","name_en":"TBD","position":"DF","number":14,"tier":2,"price":4,"overall_rank":78,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":308,"name_he":"יונס מלדה","name_en":"TBD","position":"FW","number":15,"tier":2,"price":3,"overall_rank":43,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":309,"name_he":"כריסטיאן בליץ'","name_en":"TBD","position":"MF","number":17,"tier":2,"price":4,"overall_rank":79,"rated":true,"nationality":"סרביה","is_club_captain":false},{"id":310,"name_he":"אלעד מדמון","name_en":"TBD","position":"FW","number":19,"tier":2,"price":4,"overall_rank":80,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":311,"name_he":"נועם בן הרוש","name_en":"TBD","position":"DF","number":21,"tier":2,"price":4,"overall_rank":81,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":312,"name_he":"אופק מליקה","name_en":"TBD","position":"GK","number":22,"tier":2,"price":4,"overall_rank":34,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":313,"name_he":"איסוף סיסוקו","name_en":"TBD","position":"MF","number":28,"tier":2,"price":4,"overall_rank":82,"rated":true,"nationality":"מאלי","is_club_captain":false},{"id":314,"name_he":"הליו וארלה","name_en":"TBD","position":"MF","number":29,"tier":2,"price":4,"overall_rank":35,"rated":true,"nationality":"כף ורדה","is_club_captain":false},{"id":315,"name_he":"איתמר נוי","name_en":"TBD","position":"MF","number":30,"tier":2,"price":4,"overall_rank":83,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":316,"name_he":"סייד אבו פרחי","name_en":"TBD","position":"FW","number":34,"tier":2,"price":4,"overall_rank":13,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":317,"name_he":"עידו שחר","name_en":"TBD","position":"MF","number":36,"tier":2,"price":4,"overall_rank":16,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":318,"name_he":"איתי בן חמו","name_en":"TBD","position":"DF","number":41,"tier":4,"price":2,"overall_rank":84,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":319,"name_he":"דור פרץ","name_en":"TBD","position":"MF","number":42,"tier":1,"price":5,"overall_rank":1,"rated":true,"nationality":"ישראל","is_club_captain":true},{"id":320,"name_he":"שליו סעדיה","name_en":"TBD","position":"GK","number":51,"tier":4,"price":2,"overall_rank":85,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":321,"name_he":"עידן וינברג","name_en":"TBD","position":"MF","number":52,"tier":4,"price":2,"overall_rank":87,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":322,"name_he":"רועי מגור","name_en":"TBD","position":"MF","number":53,"tier":4,"price":2,"overall_rank":99,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":323,"name_he":"לוטם אסרס","name_en":"TBD","position":"MF","number":59,"tier":4,"price":2,"overall_rank":111,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":324,"name_he":"עילאי בן סימון","name_en":"TBD","position":"FW","number":60,"tier":4,"price":2,"overall_rank":123,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":325,"name_he":"אמיר סאחיטי","name_en":"TBD","position":"FW","number":70,"tier":5,"price":1,"overall_rank":135,"rated":true,"nationality":"קוסובו","is_club_captain":false},{"id":326,"name_he":"אושר דוידה","name_en":"TBD","position":"FW","number":77,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":327,"name_he":"רועי משפתי","name_en":"TBD","position":"GK","number":90,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":328,"name_he":"יון ניקולאescu","name_en":"TBD","position":"FW","number":98,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"מולדובה","is_club_captain":false}]},{"team_id":4,"name_he":"מכבי חיפה","name_en":"Maccabi Haifa","short":"מ·חיפה","city":"חיפה","stadium":"סמי עופר","players":[{"id":401,"name_he":"זוהר זסנו","name_en":"TBD","position":"DF","number":2,"tier":4,"price":3,"overall_rank":88,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":402,"name_he":"שון גולדברג","name_en":"TBD","position":"DF","number":3,"tier":4,"price":3,"overall_rank":100,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":403,"name_he":"עלי מוחמד","name_en":"TBD","position":"MF","number":4,"tier":4,"price":4,"overall_rank":112,"rated":true,"nationality":"ניזר","is_club_captain":false},{"id":404,"name_he":"גוני נאור","name_en":"TBD","position":"MF","number":5,"tier":4,"price":1,"overall_rank":124,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":405,"name_he":"ירין לוי","name_en":"TBD","position":"MF","number":7,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":406,"name_he":"אנדרייה נובאקוביץ'","name_en":"TBD","position":"FW","number":9,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ארצות הברית","is_club_captain":false},{"id":407,"name_he":"ברוניניו","name_en":"TBD","position":"MF","number":10,"tier":2,"price":5,"overall_rank":32,"rated":true,"nationality":"ברזיל","is_club_captain":false},{"id":408,"name_he":"קנג'י חורה","name_en":"TBD","position":"MF","number":11,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"נורווגיה","is_club_captain":true},{"id":409,"name_he":"מנואל בנסון","name_en":"TBD","position":"MF","number":14,"tier":2,"price":4,"overall_rank":15,"rated":true,"nationality":"אנגולה","is_club_captain":false},{"id":410,"name_he":"ליאור קאסה","name_en":"TBD","position":"MF","number":15,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":411,"name_he":"קני סייף","name_en":"TBD","position":"MF","number":16,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":412,"name_he":"ינון פיינגזיכט","name_en":"TBD","position":"DF","number":17,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":413,"name_he":"גיא מלמד","name_en":"TBD","position":"FW","number":18,"tier":2,"price":4,"overall_rank":12,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":414,"name_he":"איתן אזולאי","name_en":"TBD","position":"MF","number":19,"tier":1,"price":4,"overall_rank":8,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":415,"name_he":"נייג'ל האוסייק","name_en":"TBD","position":"DF","number":21,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"סורינאם","is_club_captain":false},{"id":416,"name_he":"יילה בטאייה","name_en":"TBD","position":"DF","number":25,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"בלגיה","is_club_captain":false},{"id":417,"name_he":"סילבה קאני","name_en":"TBD","position":"MF","number":26,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"טוגו","is_club_captain":false},{"id":418,"name_he":"פייר קורנו","name_en":"TBD","position":"DF","number":27,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"צרפת","is_club_captain":false},{"id":419,"name_he":"אייאד חלאילי","name_en":"TBD","position":"MF","number":29,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":420,"name_he":"עמית ארזי","name_en":"TBD","position":"MF","number":31,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":421,"name_he":"נועם שטייפמן","name_en":"TBD","position":"DF","number":35,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":422,"name_he":"נבות רטנר","name_en":"TBD","position":"MF","number":36,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":423,"name_he":"אלעד אמיר","name_en":"TBD","position":"DF","number":37,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":424,"name_he":"אדם גרימברג","name_en":"TBD","position":"FW","number":38,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":425,"name_he":"ארד גייסט","name_en":"TBD","position":"DF","number":39,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":426,"name_he":"שריף כיוף","name_en":"TBD","position":"GK","number":40,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":427,"name_he":"ליאם לוסקי","name_en":"TBD","position":"FW","number":42,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":428,"name_he":"פדראו","name_en":"TBD","position":"DF","number":44,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ברזיל","is_club_captain":false},{"id":429,"name_he":"סדריק דון","name_en":"TBD","position":"MF","number":45,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"חוף השנהב","is_club_captain":false},{"id":430,"name_he":"עומרי גלזר","name_en":"TBD","position":"GK","number":55,"tier":2,"price":3,"overall_rank":20,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":431,"name_he":"אנדרסון צונאמי","name_en":"TBD","position":"DF","number":66,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ברזיל","is_club_captain":false},{"id":432,"name_he":"יאיר מרדכי","name_en":"TBD","position":"MF","number":77,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":433,"name_he":"גלן אלון","name_en":"TBD","position":"GK","number":90,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":434,"name_he":"עומר ניראון","name_en":"TBD","position":"GK","number":99,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false}]},{"team_id":5,"name_he":"בית\"ר ירושלים","name_en":"Beitar Jerusalem","short":"בית״ר","city":"ירושלים","stadium":null,"players":[{"id":501,"name_he":"בריאן קרבאלי","name_en":"TBD","position":"DF","number":4,"tier":4,"price":3,"overall_rank":89,"rated":true,"nationality":"קולומביה","is_club_captain":false},{"id":502,"name_he":"גיל כהן","name_en":"TBD","position":"DF","number":5,"tier":4,"price":3,"overall_rank":101,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":503,"name_he":"זיו בן שימול","name_en":"TBD","position":"MF","number":6,"tier":4,"price":3,"overall_rank":113,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":504,"name_he":"ירדן שועה","name_en":"TBD","position":"FW","number":7,"tier":1,"price":5,"overall_rank":4,"rated":true,"nationality":"ישראל","is_club_captain":true},{"id":505,"name_he":"נועם מוצ'ה","name_en":"TBD","position":"MF","number":30,"tier":4,"price":3,"overall_rank":125,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":506,"name_he":"ג'ונבוסקו קאלו","name_en":"TBD","position":"FW","number":9,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ניגריה","is_club_captain":false},{"id":507,"name_he":"עדי יונה","name_en":"TBD","position":"MF","number":10,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":508,"name_he":"טימוטי מוזי","name_en":"TBD","position":"FW","number":11,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":509,"name_he":"רועי אלימלך","name_en":"TBD","position":"DF","number":14,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":510,"name_he":"דגאץ' וורקו","name_en":"TBD","position":"MF","number":77,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":511,"name_he":"ירדן כהן","name_en":"TBD","position":"DF","number":16,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":512,"name_he":"אורי דהן","name_en":"TBD","position":"DF","number":20,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":513,"name_he":"יהונתן עוזר","name_en":"TBD","position":"GK","number":22,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":514,"name_he":"יובל שלו","name_en":"TBD","position":"DF","number":25,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":515,"name_he":"עילאי חג'ג'","name_en":"TBD","position":"MF","number":28,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":516,"name_he":"אריאל מנדי","name_en":"TBD","position":"DF","number":29,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"סנגל","is_club_captain":false},{"id":517,"name_he":"בוריס אינו","name_en":"TBD","position":"MF","number":40,"tier":2,"price":3,"overall_rank":18,"rated":true,"nationality":"קמרון","is_club_captain":false},{"id":518,"name_he":"איילסון טבארש","name_en":"TBD","position":"MF","number":42,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"כף ורדה","is_club_captain":false},{"id":519,"name_he":"לוקה גדראני","name_en":"TBD","position":"DF","number":44,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"גאורגיה","is_club_captain":false},{"id":520,"name_he":"מיגל סילבה","name_en":"TBD","position":"GK","number":55,"tier":2,"price":3,"overall_rank":23,"rated":true,"nationality":"פורטוגל","is_club_captain":true},{"id":521,"name_he":"עומר אצילי","name_en":"TBD","position":"MF","number":null,"tier":1,"price":5,"overall_rank":3,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":522,"name_he":"תומר יוספי","name_en":"TBD","position":"MF","number":null,"tier":2,"price":4,"overall_rank":19,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":523,"name_he":"יוג'ין אנסה","name_en":"TBD","position":"FW","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"גאנה","is_club_captain":false},{"id":547,"name_he":"פטריק טוומאסי","name_en":"TBD","position":"FW","number":null,"tier":2,"price":4,"overall_rank":14,"rated":true,"nationality":"גאנה","is_club_captain":false}]},{"team_id":6,"name_he":"הפועל תל אביב","name_en":"Hapoel Tel Aviv","short":"ה·ת״א","city":"תל אביב","stadium":null,"players":[{"id":601,"name_he":"דור בנימיני","name_en":"TBD","position":"GK","number":1,"tier":4,"price":2,"overall_rank":90,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":602,"name_he":"שיקו","name_en":"TBD","position":"DF","number":4,"tier":1,"price":5,"overall_rank":7,"rated":true,"nationality":"ברזיל","is_club_captain":false},{"id":603,"name_he":"פרנאן מאיימבו","name_en":"TBD","position":"DF","number":5,"tier":2,"price":4,"overall_rank":25,"rated":true,"nationality":"קונגו","is_club_captain":true},{"id":604,"name_he":"אנדריאן קרייב","name_en":"TBD","position":"MF","number":6,"tier":4,"price":3,"overall_rank":102,"rated":true,"nationality":"בולגריה","is_club_captain":false},{"id":605,"name_he":"רוי קורין","name_en":"TBD","position":"FW","number":7,"tier":4,"price":2,"overall_rank":114,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":606,"name_he":"יונתן פרבר","name_en":"TBD","position":"MF","number":8,"tier":4,"price":2,"overall_rank":126,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":607,"name_he":"עמנואל בואטנג","name_en":"TBD","position":"FW","number":9,"tier":2,"price":4,"overall_rank":30,"rated":true,"nationality":"גאנה","is_club_captain":false},{"id":608,"name_he":"שאנדה סילבה","name_en":"TBD","position":"FW","number":10,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"פורטוגל","is_club_captain":false},{"id":609,"name_he":"סתיו טוריאל","name_en":"TBD","position":"MF","number":11,"tier":1,"price":5,"overall_rank":5,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":610,"name_he":"אל ים קנצפולסקי","name_en":"TBD","position":"MF","number":14,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":611,"name_he":"רועי אלקוקין","name_en":"TBD","position":"MF","number":15,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":612,"name_he":"דורון ליידנר","name_en":"TBD","position":"DF","number":16,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":613,"name_he":"טל ארצ'ל","name_en":"TBD","position":"DF","number":18,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":614,"name_he":"אנס מחאמיד","name_en":"TBD","position":"FW","number":19,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":615,"name_he":"שחר פיבן","name_en":"TBD","position":"DF","number":21,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":616,"name_he":"אסף צור","name_en":"TBD","position":"GK","number":22,"tier":2,"price":4,"overall_rank":21,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":617,"name_he":"עמית למקין","name_en":"TBD","position":"DF","number":23,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":618,"name_he":"מור בוסקילה","name_en":"TBD","position":"MF","number":27,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":619,"name_he":"דאגלס אווסו","name_en":"TBD","position":"FW","number":35,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"גאנה","is_club_captain":false},{"id":620,"name_he":"רון תלמי","name_en":"TBD","position":"FW","number":38,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":621,"name_he":"דניאל דאפה","name_en":"TBD","position":"FW","number":44,"tier":2,"price":4,"overall_rank":31,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":622,"name_he":"עומרי אלטמן","name_en":"TBD","position":"FW","number":51,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":623,"name_he":"ישי ברוש","name_en":"TBD","position":"MF","number":66,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":624,"name_he":"עופר גלברד","name_en":"TBD","position":"DF","number":92,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":625,"name_he":"מרקוס קוקו","name_en":"TBD","position":"DF","number":97,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"צרפת","is_club_captain":false},{"id":626,"name_he":"לוקאס פלקאו","name_en":"TBD","position":"MF","number":98,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ברזיל","is_club_captain":false},{"id":627,"name_he":"איתי שביט","name_en":"TBD","position":"MF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false}]},{"team_id":7,"name_he":"מכבי נתניה","name_en":"Maccabi Netanya","short":"נתניה","city":"נתניה","stadium":null,"players":[{"id":701,"name_he":"ניב אנטמן","name_en":"TBD","position":"GK","number":1,"tier":4,"price":3,"overall_rank":91,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":702,"name_he":"גריגורי מורוזוב","name_en":"TBD","position":"DF","number":2,"tier":4,"price":3,"overall_rank":103,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":703,"name_he":"איתי בן שבת","name_en":"TBD","position":"DF","number":4,"tier":4,"price":2,"overall_rank":115,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":704,"name_he":"דניס קוליקוב","name_en":"TBD","position":"DF","number":5,"tier":4,"price":2,"overall_rank":127,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":705,"name_he":"בפארי קונאטה","name_en":"TBD","position":"DF","number":6,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"גינאה","is_club_captain":false},{"id":706,"name_he":"דולב חזיזה","name_en":"TBD","position":"MF","number":8,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":707,"name_he":"עוז בילו","name_en":"TBD","position":"MF","number":10,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":708,"name_he":"דור חוגי","name_en":"TBD","position":"FW","number":11,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":709,"name_he":"אלון אזוגי","name_en":"TBD","position":"DF","number":12,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":710,"name_he":"נדב נידם","name_en":"TBD","position":"MF","number":13,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":712,"name_he":"ליאם כהן","name_en":"TBD","position":"MF","number":14,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":713,"name_he":"מאור לוי","name_en":"TBD","position":"MF","number":15,"tier":2,"price":4,"overall_rank":26,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":714,"name_he":"בסאם זערורה","name_en":"TBD","position":"MF","number":75,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":715,"name_he":"מתאוס דאבו","name_en":"TBD","position":"FW","number":83,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ברזיל","is_club_captain":false},{"id":716,"name_he":"ירדן אבוחצירא","name_en":"TBD","position":"FW","number":17,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":717,"name_he":"עמרי שמיר","name_en":"TBD","position":"MF","number":18,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":718,"name_he":"סאהר תאג'י","name_en":"TBD","position":"MF","number":19,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":719,"name_he":"אלכס טלפה","name_en":"TBD","position":"MF","number":21,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":720,"name_he":"סמואל דה סילבה","name_en":"TBD","position":"GK","number":22,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"פורטוגל","is_club_captain":false},{"id":721,"name_he":"ליאם כהן","name_en":"TBD","position":"FW","number":23,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":722,"name_he":"עמית כהן","name_en":"TBD","position":"DF","number":24,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":723,"name_he":"ווילאן סיפריאן","name_en":"TBD","position":"MF","number":25,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":724,"name_he":"כרם ג'אבר","name_en":"TBD","position":"DF","number":26,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":true},{"id":725,"name_he":"עזיז וואטרה","name_en":"TBD","position":"MF","number":32,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"חוף השנהב","is_club_captain":false},{"id":726,"name_he":"סאבה חוואדזאני","name_en":"TBD","position":"DF","number":40,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"גאורגיה","is_club_captain":false},{"id":727,"name_he":"בני פלדמן","name_en":"TBD","position":"DF","number":44,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":754,"name_he":"דניאל כהן","name_en":"TBD","position":"GK","number":75,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false}]},{"team_id":8,"name_he":"בני סכנין","name_en":"Bnei Sakhnin","short":"סכנין","city":"סכנין","stadium":null,"players":[{"id":801,"name_he":"דוד בן לולו","name_en":"TBD","position":"GK","number":1,"tier":4,"price":2,"overall_rank":92,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":802,"name_he":"מארון גנטוס","name_en":"TBD","position":"DF","number":2,"tier":4,"price":3,"overall_rank":104,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":803,"name_he":"קרלו ברוצ'יץ'","name_en":"TBD","position":"DF","number":3,"tier":4,"price":3,"overall_rank":116,"rated":true,"nationality":"קרואטיה","is_club_captain":false},{"id":804,"name_he":"מוסטפא שייח' יוסף","name_en":"TBD","position":"MF","number":7,"tier":4,"price":2,"overall_rank":128,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":805,"name_he":"מייקום דויד","name_en":"TBD","position":"MF","number":8,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ברזיל","is_club_captain":false},{"id":807,"name_he":"ארתור מיראניאן","name_en":"TBD","position":"FW","number":9,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ארמניה","is_club_captain":false},{"id":808,"name_he":"מתיו קודג'ו","name_en":"TBD","position":"MF","number":10,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"גאנה","is_club_captain":false},{"id":810,"name_he":"אבראהימה דרמה","name_en":"TBD","position":"FW","number":11,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"מאלי","is_club_captain":false},{"id":811,"name_he":"שאקר אבו חוסיין","name_en":"TBD","position":"FW","number":16,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":812,"name_he":"חסן חילו","name_en":"TBD","position":"DF","number":17,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":813,"name_he":"עומר אבוהב","name_en":"TBD","position":"MF","number":18,"tier":2,"price":3,"overall_rank":58,"rated":true,"nationality":"אנגולה","is_club_captain":false},{"id":814,"name_he":"מוחמד גנאמה","name_en":"TBD","position":"DF","number":20,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":815,"name_he":"ג'ובייר בושאנק","name_en":"TBD","position":"FW","number":21,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":816,"name_he":"מוחמד אבו ניל","name_en":"TBD","position":"GK","number":22,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":817,"name_he":"עדן שמיר","name_en":"TBD","position":"MF","number":23,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":818,"name_he":"עומר קורסיה","name_en":"TBD","position":"DF","number":26,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":819,"name_he":"אחמד סלמן","name_en":"TBD","position":"FW","number":29,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":820,"name_he":"מג'ד סלימאן","name_en":"TBD","position":"MF","number":32,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":821,"name_he":"מקס גרצ'קין","name_en":"TBD","position":"DF","number":55,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":822,"name_he":"יואאן אנדי","name_en":"TBD","position":"DF","number":75,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"גינאה ביסאו","is_club_captain":false},{"id":823,"name_he":"ג'יימס אדני","name_en":"TBD","position":"FW","number":77,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ניגריה","is_club_captain":false},{"id":824,"name_he":"דורל אבונו","name_en":"TBD","position":"MF","number":92,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"קונגו","is_club_captain":false}]},{"team_id":9,"name_he":"הפועל חיפה","name_en":"Hapoel Haifa","short":"ה·חיפה","city":"חיפה","stadium":null,"players":[{"id":901,"name_he":"יואב ג'ראפי","name_en":"TBD","position":"GK","number":1,"tier":2,"price":3,"overall_rank":22,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":902,"name_he":"תמיר ארבל","name_en":"TBD","position":"DF","number":3,"tier":4,"price":2,"overall_rank":93,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":903,"name_he":"דור מלול","name_en":"TBD","position":"DF","number":4,"tier":2,"price":4,"overall_rank":24,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":904,"name_he":"איוואן קריצ'אק","name_en":"TBD","position":"DF","number":5,"tier":4,"price":2,"overall_rank":105,"rated":true,"nationality":"קרואטיה","is_club_captain":false},{"id":905,"name_he":"איתי בוגנים","name_en":"TBD","position":"MF","number":7,"tier":4,"price":2,"overall_rank":117,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":906,"name_he":"והיב חביבאללה","name_en":"TBD","position":"FW","number":24,"tier":5,"price":3,"overall_rank":129,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":907,"name_he":"רותם חטואל","name_en":"TBD","position":"FW","number":9,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":908,"name_he":"סער פדידה","name_en":"TBD","position":"MF","number":10,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":909,"name_he":"אניס פורת עיאש","name_en":"TBD","position":"MF","number":11,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":910,"name_he":"אורן ביטון","name_en":"TBD","position":"DF","number":12,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":911,"name_he":"דריו די'ופריץ'","name_en":"TBD","position":"DF","number":13,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"קרואטיה","is_club_captain":false},{"id":912,"name_he":"רוי נאווי","name_en":"TBD","position":"MF","number":14,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":913,"name_he":"יעד גונן","name_en":"TBD","position":"MF","number":15,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":914,"name_he":"נפתלי בלאי","name_en":"TBD","position":"DF","number":16,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":915,"name_he":"חיים מקונן","name_en":"TBD","position":"MF","number":17,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":916,"name_he":"אופק ביטון","name_en":"TBD","position":"MF","number":18,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":917,"name_he":"רוי זיקרי","name_en":"TBD","position":"FW","number":21,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":918,"name_he":"מתן עמבר","name_en":"TBD","position":"GK","number":23,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":919,"name_he":"טל נעים","name_en":"TBD","position":"DF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":920,"name_he":"לירן סרדל","name_en":"TBD","position":"MF","number":24,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":921,"name_he":"ג'ורג' דיבה","name_en":"TBD","position":"DF","number":25,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":922,"name_he":"ברונו רמירס","name_en":"TBD","position":"DF","number":33,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ברזיל","is_club_captain":false},{"id":923,"name_he":"נאור סבג","name_en":"TBD","position":"MF","number":55,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":924,"name_he":"רז'י אנדו","name_en":"TBD","position":"MF","number":77,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"בורקינה פאסו","is_club_captain":false},{"id":925,"name_he":"סלאם זיידון","name_en":"TBD","position":"MF","number":88,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"מאלי","is_club_captain":false},{"id":926,"name_he":"שי בלסון","name_en":"TBD","position":"MF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":927,"name_he":"ליאם נחום","name_en":"TBD","position":"MF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":928,"name_he":"סאלי פחימה","name_en":"TBD","position":"MF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":null,"is_club_captain":false},{"id":929,"name_he":"איתי צפרני","name_en":"TBD","position":"FW","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":930,"name_he":"אריאל מנדי","name_en":"TBD","position":"DF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"סנגל","is_club_captain":false}]},{"team_id":10,"name_he":"עירוני קרית שמונה","name_en":"Ironi Kiryat Shmona","short":"קר״ש","city":"קרית שמונה","stadium":null,"players":[{"id":1001,"name_he":"מתן זלמנוביץ'","name_en":"TBD","position":"GK","number":1,"tier":4,"price":2,"overall_rank":94,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":1002,"name_he":"עמית גלזר","name_en":"TBD","position":"DF","number":4,"tier":4,"price":1,"overall_rank":106,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":1003,"name_he":"אופיר בנבנישתי","name_en":"TBD","position":"DF","number":6,"tier":4,"price":2,"overall_rank":118,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":1004,"name_he":"פרננדו פאצ'קו","name_en":"TBD","position":"MF","number":8,"tier":5,"price":3,"overall_rank":130,"rated":true,"nationality":"פרו","is_club_captain":false},{"id":1005,"name_he":"אדריאן אוגריסה","name_en":"TBD","position":"FW","number":9,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"פרו","is_club_captain":false},{"id":1006,"name_he":"אריאל שרצקי","name_en":"TBD","position":"MF","number":10,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1007,"name_he":"מור סימן טוב","name_en":"TBD","position":"MF","number":11,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1008,"name_he":"ג'ואן חלבי","name_en":"TBD","position":"FW","number":12,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1009,"name_he":"הראל גולדנברג","name_en":"TBD","position":"MF","number":14,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1010,"name_he":"איציק שולמייסטר","name_en":"TBD","position":"DF","number":17,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1011,"name_he":"אורי שנפר","name_en":"TBD","position":"FW","number":18,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1012,"name_he":"דניאל טננבאום","name_en":"TBD","position":"GK","number":19,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1013,"name_he":"עובדיה דרויש","name_en":"TBD","position":"DF","number":20,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1014,"name_he":"אביב אברהם","name_en":"TBD","position":"MF","number":21,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1015,"name_he":"ואלה מוסא עלי","name_en":"TBD","position":"MF","number":22,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ניגריה","is_club_captain":false},{"id":1016,"name_he":"יואב כראדי","name_en":"TBD","position":"MF","number":25,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1017,"name_he":"נמניה ליוביסבלייביץ'","name_en":"TBD","position":"DF","number":26,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"סרביה","is_club_captain":false},{"id":1018,"name_he":"עידו וייר","name_en":"TBD","position":"DF","number":28,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1019,"name_he":"יונתן מלכה","name_en":"TBD","position":"MF","number":29,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1020,"name_he":"שי בן דוד","name_en":"TBD","position":"DF","number":32,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1021,"name_he":"ליאל דרעי","name_en":"TBD","position":"DF","number":44,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1022,"name_he":"כריסטיאן מרטינס","name_en":"TBD","position":"MF","number":70,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"פנמה","is_club_captain":false},{"id":1023,"name_he":"רוי שדו","name_en":"TBD","position":"GK","number":77,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1024,"name_he":"יאו אקה","name_en":"TBD","position":"MF","number":79,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"גאנה","is_club_captain":false},{"id":1025,"name_he":"בילאל שאאין","name_en":"TBD","position":"FW","number":91,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false}]},{"team_id":11,"name_he":"עירוני טבריה","name_en":"Ironi Tiberias","short":"טבריה","city":"טבריה","stadium":null,"players":[{"id":1101,"name_he":"גד עמוס","name_en":"TBD","position":"GK","number":1,"tier":4,"price":3,"overall_rank":95,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":1102,"name_he":"אימרי אוזן","name_en":"TBD","position":"DF","number":2,"tier":4,"price":1,"overall_rank":107,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":1103,"name_he":"דוד קלטינס","name_en":"TBD","position":"MF","number":3,"tier":4,"price":1,"overall_rank":119,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":1104,"name_he":"סמביניה","name_en":"TBD","position":"DF","number":4,"tier":5,"price":2,"overall_rank":131,"rated":true,"nationality":"גינאה ביסאו","is_club_captain":false},{"id":1105,"name_he":"נהוראי חן","name_en":"TBD","position":"DF","number":5,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1106,"name_he":"גיא חדרידה","name_en":"TBD","position":"MF","number":7,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1107,"name_he":"ארי כהן","name_en":"TBD","position":"MF","number":8,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1108,"name_he":"איתמר שבירו","name_en":"TBD","position":"FW","number":9,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1109,"name_he":"בר כהן","name_en":"TBD","position":"MF","number":10,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1110,"name_he":"ניב גוטליב","name_en":"TBD","position":"MF","number":11,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1111,"name_he":"קייס גאנם","name_en":"TBD","position":"FW","number":12,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1112,"name_he":"גיא סנקור","name_en":"TBD","position":"DF","number":14,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1113,"name_he":"רון אונגר","name_en":"TBD","position":"DF","number":17,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1114,"name_he":"עדן שמיר","name_en":"TBD","position":"MF","number":18,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1115,"name_he":"גל מעתוק","name_en":"TBD","position":"DF","number":19,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1116,"name_he":"עידו שרון","name_en":"TBD","position":"GK","number":22,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1117,"name_he":"כריס קואקו","name_en":"TBD","position":"MF","number":23,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"חוף השנהב","is_club_captain":false},{"id":1118,"name_he":"ירין שיביץ'","name_en":"TBD","position":"MF","number":24,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1119,"name_he":"רועי שחר","name_en":"TBD","position":"MF","number":25,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1120,"name_he":"ירין סוויסה","name_en":"TBD","position":"MF","number":27,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1121,"name_he":"ננה גבמבל","name_en":"TBD","position":"MF","number":29,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"חוף השנהב","is_club_captain":false},{"id":1122,"name_he":"מנסור באדג'י","name_en":"TBD","position":"FW","number":30,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"גמביה","is_club_captain":false},{"id":1123,"name_he":"אונדז'יי באצ'ה","name_en":"TBD","position":"DF","number":37,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"צכיה","is_club_captain":false},{"id":1124,"name_he":"ג'ונס אבו גנימה","name_en":"TBD","position":"GK","number":55,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1125,"name_he":"אגם יהודה","name_en":"TBD","position":"FW","number":77,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false}]},{"team_id":12,"name_he":"מכבי פתח תקווה","name_en":"Maccabi Petah Tikva","short":"מ·פ״ת","city":"פתח תקווה","stadium":null,"players":[{"id":1201,"name_he":"אופיר בתוש / עומרי לוזון","name_en":"TBD","position":"DF","number":22,"tier":4,"price":2,"overall_rank":96,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":1202,"name_he":"גיא דזנט","name_en":"TBD","position":"DF","number":26,"tier":4,"price":1,"overall_rank":108,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":1203,"name_he":"מוחמד הינדי","name_en":"TBD","position":"DF","number":32,"tier":4,"price":3,"overall_rank":120,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":1204,"name_he":"דור חברון","name_en":"TBD","position":"GK","number":null,"tier":5,"price":1,"overall_rank":132,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":1205,"name_he":"מאור ארליך","name_en":"TBD","position":"GK","number":39,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1206,"name_he":"עומר שירי","name_en":"TBD","position":"DF","number":53,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1207,"name_he":"אביב סלם","name_en":"TBD","position":"DF","number":77,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"קולומביה/ישראל","is_club_captain":false},{"id":1208,"name_he":"פרנק ריבולייה","name_en":"TBD","position":"FW","number":91,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"צרפת","is_club_captain":false},{"id":1209,"name_he":"עידו כהן","name_en":"TBD","position":"MF","number":20,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1210,"name_he":"אור דדיה","name_en":"TBD","position":"DF","number":21,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1211,"name_he":"פבליו קוראנה","name_en":"TBD","position":"DF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"קפריסין","is_club_captain":false},{"id":1212,"name_he":"איתן טיבי","name_en":"TBD","position":"DF","number":81,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1213,"name_he":"סמואל אואוסו","name_en":"TBD","position":"FW","number":9,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"גאנה","is_club_captain":false},{"id":1214,"name_he":"אריאל לוגסי","name_en":"TBD","position":"FW","number":10,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1215,"name_he":"אדר רטנר","name_en":"TBD","position":"FW","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1216,"name_he":"אייל אינברום","name_en":"TBD","position":"MF","number":99,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1217,"name_he":"קייל ספנס","name_en":"TBD","position":"MF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"אנגליה","is_club_captain":false},{"id":1218,"name_he":"לי-ים דן","name_en":"TBD","position":"MF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1219,"name_he":"איברהימה סומה","name_en":"TBD","position":"MF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"גאנה","is_club_captain":false}]},{"team_id":13,"name_he":"הפועל רמת גן","name_en":"Hapoel Ramat Gan","short":"ר״ג","city":"רמת גן","stadium":null,"players":[{"id":1301,"name_he":"גטאוצ'ו יבלו","name_en":"TBD","position":"DF","number":2,"tier":4,"price":2,"overall_rank":97,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":1302,"name_he":"דניאל טישלר","name_en":"TBD","position":"DF","number":3,"tier":4,"price":1,"overall_rank":109,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":1303,"name_he":"ז'וטה","name_en":"TBD","position":"DF","number":5,"tier":4,"price":3,"overall_rank":121,"rated":true,"nationality":"פורטוגל","is_club_captain":false},{"id":1304,"name_he":"משה מאיר","name_en":"TBD","position":"MF","number":6,"tier":5,"price":1,"overall_rank":133,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":1305,"name_he":"מקסים פלקושצ'נקו","name_en":"TBD","position":"MF","number":7,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1306,"name_he":"עידן ברנס","name_en":"TBD","position":"FW","number":8,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1307,"name_he":"משה סמל","name_en":"TBD","position":"MF","number":10,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1308,"name_he":"דוד אסנקה","name_en":"TBD","position":"FW","number":11,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1309,"name_he":"הוד מסיקה","name_en":"TBD","position":"MF","number":14,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1310,"name_he":"עמית צור","name_en":"TBD","position":"FW","number":15,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1311,"name_he":"עומר יצחק","name_en":"TBD","position":"DF","number":17,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1312,"name_he":"אולי ברגמן","name_en":"TBD","position":"GK","number":18,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1313,"name_he":"כריסטופר בוניפייס","name_en":"TBD","position":"MF","number":20,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"בלגיה","is_club_captain":false},{"id":1314,"name_he":"עידו עולי","name_en":"TBD","position":"MF","number":21,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1315,"name_he":"סרג'אן מיאיולוביץ'","name_en":"TBD","position":"MF","number":22,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"סרביה","is_club_captain":false},{"id":1316,"name_he":"תמיר גלזר","name_en":"TBD","position":"MF","number":24,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1317,"name_he":"אופק עובדיה","name_en":"TBD","position":"MF","number":27,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1318,"name_he":"פארד אברהם","name_en":"TBD","position":"DF","number":33,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"גאנה","is_club_captain":false},{"id":1319,"name_he":"דודי טויטו","name_en":"TBD","position":"DF","number":36,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1320,"name_he":"עידו מזרחי","name_en":"TBD","position":"MF","number":37,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1321,"name_he":"מרסיו סילבה","name_en":"TBD","position":"DF","number":44,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ברזיל","is_club_captain":false},{"id":1322,"name_he":"עמית רייף","name_en":"TBD","position":"GK","number":55,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1323,"name_he":"ליאם אלוק","name_en":"TBD","position":"MF","number":77,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1324,"name_he":"תומר הרן","name_en":"TBD","position":"GK","number":98,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1325,"name_he":"לואן קמפוס","name_en":"TBD","position":"FW","number":99,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ברזיל","is_club_captain":false},{"id":1326,"name_he":"מתן חוזז","name_en":"TBD","position":"MF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1327,"name_he":"מריוס נוביסי","name_en":"TBD","position":"FW","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"קמרון","is_club_captain":false}]},{"team_id":14,"name_he":"הפועל פתח תקווה","name_en":"Hapoel Petah Tikva","short":"ה·פ״ת","city":"פתח תקווה","stadium":null,"players":[{"id":1401,"name_he":"עומר כץ","name_en":"TBD","position":"GK","number":1,"tier":4,"price":2,"overall_rank":98,"rated":true,"nationality":"ישראל","is_club_captain":true},{"id":1402,"name_he":"אבישי כהן","name_en":"TBD","position":"DF","number":null,"tier":4,"price":2,"overall_rank":110,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":1403,"name_he":"אלכס מוקטו-מוסונדה","name_en":"TBD","position":"DF","number":5,"tier":4,"price":2,"overall_rank":122,"rated":true,"nationality":"זימבבואה","is_club_captain":false},{"id":1404,"name_he":"שביט מזל","name_en":"TBD","position":"FW","number":7,"tier":5,"price":1,"overall_rank":134,"rated":true,"nationality":"ישראל","is_club_captain":false},{"id":1405,"name_he":"תומר אלטמן","name_en":"TBD","position":"MF","number":8,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1406,"name_he":"רוי דוד","name_en":"TBD","position":"MF","number":16,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1407,"name_he":"ציפיקה סонגה","name_en":"TBD","position":"FW","number":17,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"זמביה","is_club_captain":false},{"id":1408,"name_he":"עמית משוח","name_en":"TBD","position":"GK","number":18,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1409,"name_he":"קארים קิมבדי","name_en":"TBD","position":"MF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"הרפובליקה הדמוקרטית של קונגו","is_club_captain":false},{"id":1410,"name_he":"סתיו ישראלי","name_en":"TBD","position":"DF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1411,"name_he":"רוי ששון","name_en":"TBD","position":"GK","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1412,"name_he":"יער זמברובסקי","name_en":"TBD","position":"DF","number":26,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1413,"name_he":"בוני אמיאן","name_en":"TBD","position":"MF","number":29,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"אירלנד","is_club_captain":false},{"id":1414,"name_he":"גיא בדש","name_en":"TBD","position":"MF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1415,"name_he":"יזן נסאר","name_en":"TBD","position":"DF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false},{"id":1416,"name_he":"אוקלידס אנדרדה","name_en":"TBD","position":"FW","number":77,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"כף ורדה","is_club_captain":false},{"id":1417,"name_he":"הראל שלום","name_en":"TBD","position":"DF","number":null,"tier":5,"price":1,"overall_rank":null,"rated":false,"nationality":"ישראל","is_club_captain":false}]}]}$json$;
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
      --
      --   ★★ והתיקון הזה נדרס פעם אחת: הוא נעשה ידנית ב-
      --      db/03_seed_squads.sql, בזמן שהקובץ הזה **מייצר** אותו.
      --      ההרצה הבאה של הסקריפט החזירה את הבאג. לכן הוא חי
      --      כאן עכשיו, במחולל, ולא בתוצר.
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
  /* ★ הרשימה הזו חייבת להיות זהה ל-CHECK על `game.gameweeks`.
     היא לא הייתה: db/01 הגדיר 'upcoming'/'settled', ו-db/09
     הרחיב את ה-CHECK ל-'draft'/'scoring'/'published'/'archived'
     בלי שהפונקציה הזו ידעה. התוצאה: `admin_set_status('published')`
     היה נדחה, ו-`admin_set_status('settled')` היה עובר את
     הבדיקה כאן ואז נופל על ה-CHECK — שתי שגיאות הפוכות באותה
     שורה. */
  IF p_status NOT IN ('draft','open','locked','live','scoring','published','archived') THEN
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
-- ▼▼▼  14_admin_console.sql  —  מחזורים, קליטת לוח, חוקי ניקוד, תוכן וניתוח
-- =====================================================================

-- =====================================================================
--  Dubid · מיגרציה 14 — לוח ניהול מלא, בלי תלות בקוד
-- =====================================================================
--
--  ★ הבקשה, כלשונה
--
--  "אני רוצה שתבנה לי לוח אדמין מלא שלא אצטרך אותך בכל פעם שאני
--   רוצה להוסיף / לשנות משהו."
--
--  ★ מה עמד בדרך
--
--  שלושה דברים היו **קבועים בקוד**, וכל שינוי בהם דרש פריסה:
--
--    1. **המחזור הנוכחי.** `src/data/fixtures.ts` הכריז
--       `GAMEWEEK.id = 'gw-2'`. מחזור 3 היה דורש עריכת קובץ.
--    2. **חוקי הניקוד.** `src/lib/scoring/rules.ts` — קוד.
--       איזון של נקודה אחת = פריסה.
--    3. **כל טקסט שיווקי במוצר.** מחרוזות בתוך קומפוננטות.
--
--  ═══════════════════════════════════════════════════════════════
--  ★ מה נוסף כאן
--  ═══════════════════════════════════════════════════════════════
--
--    §1  מחזורים — יצירה, רשימה, ו**המחזור הנוכחי כדגל במסד**.
--        זה השינוי היחיד שבאמת פותח את השאר: כל עוד הקליינט
--        יודע 'gw-2' בעל פה, שום לוח ניהול לא ישחרר אותך.
--
--    §2  קליטת לוח משחקים מ-JSON — נתיב אחד, ידני והיום, ו-API
--        מחר. ★ אידמפוטנטי: אותה קליטה פעמיים = אותה תוצאה.
--
--    §3  חוקי ניקוד כדאטה, עם היסטוריית גרסאות.
--
--    §4  תוכן ושיווק — כל מחרוזת שאפשר לערוך בלי פריסה.
--
--    §5  ניתוח — מי משחק, מה בוחרים, ומי חוזר.
--
--    §6  בריאות הנתונים — הדברים שנכשלים **בשקט**.
--
--  ═══════════════════════════════════════════════════════════════
--  ★ מה **לא** נעשה כאן, ובכוונה
--  ═══════════════════════════════════════════════════════════════
--
--  · אין כאן מפתח API של שום ספק. מפתח במסד הוא מפתח שדולף עם
--    גיבוי. מקומו היחיד: Supabase Edge Function Secrets.
--  · אין כאן "עריכת ניקוד ידנית" של משתמש. אדמין שיכול לשנות
--    נקודות של מישהו יכול לשבור תחרות — והאמון לא חוזר.
--  · שום פונקציה כאן לא מוחקת הגשה או תוצאה שכבר פורסמה.
--
--  אידמפוטנטי. אפשר להריץ שוב, בכל סדר.
-- =====================================================================

SET search_path = core, game, public;

-- =====================================================================
-- §1 מחזורים — והמחזור הנוכחי
-- =====================================================================
--
--  ★ למה דגל ולא "האחרון לפי תאריך"
--
--  "האחרון" נכון עד הרגע הראשון שבו הוא לא: מחזור עתידי שנבנה
--  מראש, מחזור שנדחה, או שניים שנפתחו בטעות. חוק נגזר שנשבר
--  פעם אחת בשנה הוא חוק שאי אפשר לסמוך עליו, ואי אפשר לדבג.
--
--  דגל מפורש הוא גם מה שנותן לאדמין את השליטה: "המחזור שהמשתמשים
--  רואים" הופך לכפתור, ולא למשהו שקורה מעצמו.

ALTER TABLE game.gameweeks ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT FALSE;

/* ★ אינדקס חלקי ייחודי: **בדיוק אחד** יכול להיות נוכחי.
   בלעדיו, שני מחזורים נוכחיים הם שתי תחרויות מקבילות שאף אחד
   לא התכוון אליהן, והמסך היה בוחר אחד מהם באקראי. */
CREATE UNIQUE INDEX IF NOT EXISTS gameweeks_one_current
  ON game.gameweeks ((TRUE)) WHERE is_current;

/* מי שכבר קיים במסד: אם אין אף נוכחי, המאוחר ביותר נבחר. */
DO $bootstrap$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM game.gameweeks WHERE is_current) THEN
    UPDATE game.gameweeks SET is_current = TRUE
     WHERE id = (SELECT id FROM game.gameweeks
                  WHERE code IS NOT NULL
                  ORDER BY number DESC LIMIT 1);
  END IF;
END
$bootstrap$;

/**
 * המחזור שהמשתמשים רואים עכשיו.
 *
 * ★ זו הפונקציה שמשחררת את הקליינט מ-'gw-2'.
 */
CREATE OR REPLACE FUNCTION game.current_gameweek()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
  SELECT code FROM game.gameweeks
   WHERE is_current AND code IS NOT NULL
   LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION game.current_gameweek() TO anon, authenticated;

/** רשימת המחזורים — לתפריט הנפתח בלוח הניהול. */
CREATE OR REPLACE FUNCTION game.gameweeks_list()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
  SELECT COALESCE(jsonb_agg(g ORDER BY (g->>'number')::INT DESC), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'code',      gw.code,
      'number',    gw.number,
      'label',     COALESCE(gw.names #>> '{he,full}', 'מחזור ' || gw.number),
      'status',    gw.status,
      'isCurrent', gw.is_current,
      'lockAt',    to_char(gw.lock_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'fixtures',  (SELECT count(*) FROM core.weekly_matches m WHERE m.gameweek_id = gw.id),
      'entries',   (SELECT count(*) FROM game.user_lineups ul
                     WHERE ul.gameweek_id = gw.id AND ul.status <> 'draft'),
      -- ★ אין עמודה `published`. הפרסום הוא **מצב**: `status='published'`.
      'published', (gw.status = 'published')
    ) AS g
    FROM game.gameweeks gw
    WHERE gw.code IS NOT NULL
  ) q;
$$;
GRANT EXECUTE ON FUNCTION game.gameweeks_list() TO anon, authenticated;

/**
 * מחזור חדש.
 *
 * ★ `p_code` נגזר מהמספר ולא מוקלד: 'gw-3'. פורמט חופשי היה
 *   מייצר 'GW3', 'gw3' ו-'gw-03' באותו מסד, וכל אחד מהם היה
 *   מחזור אחר מבחינת הקליינט.
 *
 * ★ הדדליין: אם לא נמסר, הוא **לא** מומצא. הוא נקבע רגע אחרי
 *   שנכנס המשחק הראשון (`admin_resync_deadline`). דדליין מומצא
 *   הוא בדיוק סוג הנתון שאף אחד לא בודק ושסוגר הגשות מוקדם.
 */
CREATE OR REPLACE FUNCTION game.admin_create_gameweek(
  p_number  SMALLINT,
  p_lock_at TIMESTAMPTZ DEFAULT NULL,
  p_label   TEXT DEFAULT NULL,
  p_make_current BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  v_season UUID;
  v_code   TEXT := 'gw-' || p_number::TEXT;
  v_id     UUID;
  v_lock   TIMESTAMPTZ;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF p_number IS NULL OR p_number < 1 OR p_number > 60 THEN
    RAISE EXCEPTION 'BAD_NUMBER: %', p_number;
  END IF;

  SELECT s.id INTO v_season FROM core.seasons s
   ORDER BY s.is_current DESC, s.starts_on DESC NULLS LAST LIMIT 1;
  IF v_season IS NULL THEN RAISE EXCEPTION 'NO_SEASON'; END IF;

  /* ★ בלי דדליין אמיתי — רחוק בעתיד, לא "עכשיו".
     `now()` היה יוצר מחזור **נעול ברגע שנוצר**, והאדמין היה
     מגלה את זה רק כשמשתמש מתלונן שאי אפשר להגיש. */
  v_lock := COALESCE(p_lock_at, now() + INTERVAL '365 days');

  INSERT INTO game.gameweeks (season_id, number, code, names, lock_at,
                              first_kickoff_at, status)
  VALUES (v_season, p_number, v_code,
          jsonb_build_object(
            'he', jsonb_build_object('full',
                    COALESCE(NULLIF(btrim(p_label), ''), 'מחזור ' || p_number)),
            'en', jsonb_build_object('full', 'Gameweek ' || p_number)),
          v_lock, v_lock, 'draft')
  ON CONFLICT (season_id, number) DO UPDATE
    SET code  = EXCLUDED.code,
        names = EXCLUDED.names
  RETURNING id INTO v_id;

  IF p_make_current THEN PERFORM game.admin_set_current_gameweek(v_code); END IF;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (auth.uid()::TEXT, 'admin_create_gameweek', 'gameweek', v_code,
          jsonb_build_object('number', p_number, 'lockAt', v_lock));

  RETURN jsonb_build_object('code', v_code, 'number', p_number, 'lockAt', v_lock);
END;
$$;

/**
 * החלפת המחזור הפעיל.
 *
 * ★ הפעולה הכי משמעותית בלוח כולו: היא מה שכל המשתמשים רואים.
 *   לכן היא גם היחידה שמסרבת למחזור בלי משחקים — מחזור ריק
 *   שהופך לפעיל הוא מסך בית ריק לכל מי שפותח את האפליקציה.
 */
CREATE OR REPLACE FUNCTION game.admin_set_current_gameweek(p_gw_code TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v_id UUID; v_fixtures INT;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  SELECT id INTO v_id FROM game.gameweeks WHERE code = p_gw_code;
  IF v_id IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND: %', p_gw_code; END IF;

  SELECT count(*) INTO v_fixtures FROM core.weekly_matches WHERE gameweek_id = v_id;
  IF v_fixtures = 0 THEN RAISE EXCEPTION 'NO_FIXTURES'; END IF;

  /* שתי פקודות ולא UPDATE אחד עם CASE: האינדקס הייחודי החלקי
     נבדק אחרי כל פקודה, ולכן צריך לכבות לפני שמדליקים. */
  UPDATE game.gameweeks SET is_current = FALSE WHERE is_current;
  UPDATE game.gameweeks SET is_current = TRUE  WHERE id = v_id;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (auth.uid()::TEXT, 'admin_set_current_gameweek', 'gameweek', p_gw_code,
          jsonb_build_object('code', p_gw_code));
END;
$$;

/**
 * מחיקת מחזור — רק אם אף אחד לא שיחק בו.
 *
 * ★ הגבול הזה אינו זהירות יתר. מחזור עם הגשות הוא תחרות
 *   שהתקיימה; מחיקה שלו מוחקת את התוצאה של אנשים אמיתיים,
 *   ואין ממה לשחזר.
 */
CREATE OR REPLACE FUNCTION game.admin_delete_gameweek(p_gw_code TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v_id UUID; v_entries INT;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  SELECT id INTO v_id FROM game.gameweeks WHERE code = p_gw_code;
  IF v_id IS NULL THEN RETURN; END IF;

  SELECT count(*) INTO v_entries FROM game.user_lineups
   WHERE gameweek_id = v_id AND status <> 'draft';
  IF v_entries > 0 THEN RAISE EXCEPTION 'HAS_ENTRIES: %', v_entries; END IF;

  IF EXISTS (SELECT 1 FROM game.gameweeks WHERE id = v_id AND is_current) THEN
    RAISE EXCEPTION 'IS_CURRENT';
  END IF;

  DELETE FROM game.gameweeks WHERE id = v_id;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, old_value)
  VALUES (auth.uid()::TEXT, 'admin_delete_gameweek', 'gameweek', p_gw_code, '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION
  game.admin_create_gameweek(SMALLINT,TIMESTAMPTZ,TEXT,BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION game.admin_set_current_gameweek(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION game.admin_delete_gameweek(TEXT)      TO authenticated;

-- =====================================================================
-- §2 קליטת לוח משחקים — נתיב אחד, ידני והיום, API מחר
-- =====================================================================
--
--  ★ העיקרון (מתוך ניסיון עם דאטת כדורגל): **קובץ אחד יודע מי
--    הספק. שום דבר אחר לא.**
--
--  הפונקציה כאן מקבלת מבנה **מנורמל** — לא את מה ש-API-Football
--  מחזיר. מי שמתרגם הוא ה-Edge Function (מחר) או האדמין שמדביק
--  JSON (היום). כך היום שבו הספק מתחלף נוגע בקובץ אחד, ולא
--  בכל שאילתה במסד.
--
--  המבנה:
--
--      [{ "home": "3", "away": "4", "kickoff": "2026-09-05T20:00:00+03:00" },
--       { "home": "1", "away": "2", "kickoff": "2026-09-05T20:00:00+03:00" }]
--
--  `home`/`away` הם המזהים החיצוניים של הקבוצות (בלי 'T').
--
--  ★ אידמפוטנטי לפי מפתח טבעי (מחזור + בית + חוץ). הרצה שנייה
--    של אותו JSON מעדכנת שעה ולא יוצרת כפילות. זה חשוב במיוחד
--    לספק: cron שרץ פעמיים, webhook שנשלח שוב.
--
--  ★ ולעולם לא ממציא שעה. משחק בלי `kickoff` תקין **נדחה
--    ומדווח**, ולא נכנס עם ברירת מחדל — כי הדדליין נגזר מהשעות,
--    ושעה מומצאת סוגרת הגשות ברגע הלא נכון.

CREATE OR REPLACE FUNCTION game.admin_import_fixtures(
  p_gw_code TEXT,
  p_payload JSONB,
  /** `TRUE` = משחקים שלא ברשימה נמחקים. לוח מלא מספק. */
  p_replace BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  v_gw       UUID;
  r          JSONB;
  v_home     UUID;
  v_away     UUID;
  v_kick     TIMESTAMPTZ;
  v_id       UUID;
  v_keep     UUID[] := '{}';
  v_added    INT := 0;
  v_updated  INT := 0;
  v_removed  INT := 0;
  v_problems JSONB := '[]'::jsonb;
  v_i        INT := 0;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF jsonb_typeof(p_payload) <> 'array' THEN RAISE EXCEPTION 'PAYLOAD_NOT_ARRAY'; END IF;

  SELECT id INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND: %', p_gw_code; END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_payload) LOOP
    v_i := v_i + 1;

    /* ★ שום שורה לא נופלת בשקט.
       כל בעיה נרשמת עם מספר השורה ומוחזרת לקורא. שורה שנעלמת
       בלי דיווח היא משחק שלא יתקיים ואף אחד לא ידע למה. */
    BEGIN
      v_home := core.team_by_ext(r->>'home');
      v_away := core.team_by_ext(r->>'away');
      v_kick := NULLIF(btrim(COALESCE(r->>'kickoff', '')), '')::TIMESTAMPTZ;

      IF v_home IS NULL THEN
        v_problems := v_problems || jsonb_build_object(
          'row', v_i, 'issue', 'קבוצה ביתית לא נמצאה', 'value', r->>'home');
        CONTINUE;
      END IF;
      IF v_away IS NULL THEN
        v_problems := v_problems || jsonb_build_object(
          'row', v_i, 'issue', 'קבוצה אורחת לא נמצאה', 'value', r->>'away');
        CONTINUE;
      END IF;
      IF v_home = v_away THEN
        v_problems := v_problems || jsonb_build_object(
          'row', v_i, 'issue', 'אותה קבוצה בשני הצדדים', 'value', r->>'home');
        CONTINUE;
      END IF;
      IF v_kick IS NULL THEN
        v_problems := v_problems || jsonb_build_object(
          'row', v_i, 'issue', 'שעת פתיחה חסרה או לא תקינה', 'value', r->>'kickoff');
        CONTINUE;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_problems := v_problems || jsonb_build_object(
        'row', v_i, 'issue', 'שורה פגומה', 'value', SQLERRM);
      CONTINUE;
    END;

    SELECT m.id INTO v_id FROM core.weekly_matches m
     WHERE m.gameweek_id = v_gw AND m.home_team_id = v_home AND m.away_team_id = v_away;

    IF v_id IS NULL THEN
      INSERT INTO core.weekly_matches
        (gameweek_id, home_team_id, away_team_id, kickoff_at, status)
      VALUES (v_gw, v_home, v_away, v_kick, 'scheduled')
      RETURNING id INTO v_id;
      v_added := v_added + 1;
    ELSE
      UPDATE core.weekly_matches SET kickoff_at = v_kick WHERE id = v_id;
      v_updated := v_updated + 1;
    END IF;

    v_keep := v_keep || v_id;
  END LOOP;

  IF p_replace THEN
    /* ★ מחיקה רק של משחקים **בלי תוצאה**. משחק שכבר הוזנו לו
       שערים הוא היסטוריה, וספק ששלח לוח חלקי לא אמור למחוק
       אותה. */
    DELETE FROM core.weekly_matches m
     WHERE m.gameweek_id = v_gw
       AND NOT (m.id = ANY(v_keep))
       AND m.home_goals IS NULL AND m.away_goals IS NULL;
    GET DIAGNOSTICS v_removed = ROW_COUNT;
  END IF;

  IF v_added + v_updated > 0 THEN
    PERFORM game.admin_resync_deadline(p_gw_code);
  END IF;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (auth.uid()::TEXT, 'admin_import_fixtures', 'gameweek', p_gw_code,
          jsonb_build_object('added', v_added, 'updated', v_updated,
                             'removed', v_removed,
                             'problems', jsonb_array_length(v_problems)));

  /* ★ דוח כיסוי, לא רק ספירת שגיאות.
     "0 שגיאות" מסתיר "נקלטו 3 מתוך 7". */
  RETURN jsonb_build_object(
    'received', v_i,
    'added',    v_added,
    'updated',  v_updated,
    'removed',  v_removed,
    'problems', v_problems,
    'lockAt',   (SELECT to_char(lock_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                   FROM game.gameweeks WHERE id = v_gw)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_import_fixtures(TEXT,JSONB,BOOLEAN) TO authenticated;

-- =====================================================================
-- §3 חוקי ניקוד כדאטה
-- =====================================================================
--
--  ★ למה זה לא "פשוט טבלה"
--
--  שינוי חוק ניקוד באמצע עונה משנה **רטרואקטיבית** את התוצאה של
--  כל מחזור שכבר נוקד — אם הניקוד מחושב מחדש. לכן:
--
--    · לכל שינוי יש **גרסה**.
--    · מחזור נועל את מספר הגרסה שלו ברגע הנעילה.
--    · הגרסה נשמרת בהיסטוריה ולא נדרסת.
--
--  ככה אפשר לאזן בלי לשכתב את העבר, ואפשר גם להסביר למשתמש
--  למה מחזור 3 ניקד אחרת ממחזור 2.

CREATE TABLE IF NOT EXISTS game.scoring_overrides (
  rule_key   TEXT PRIMARY KEY,
  points     NUMERIC(6,2) NOT NULL,
  version    INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);
GRANT SELECT ON game.scoring_overrides TO anon, authenticated;

CREATE TABLE IF NOT EXISTS game.scoring_history (
  id         BIGSERIAL PRIMARY KEY,
  rule_key   TEXT NOT NULL,
  old_points NUMERIC(6,2),
  new_points NUMERIC(6,2) NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by TEXT
);

/**
 * שינוי חוק.
 *
 * ★ `rule_key` לא נבדק מול רשימה סגורה, ובכוונה: המנוע בקליינט
 *   הוא זה שמכיר את המפתחות, והוא מתעלם ממפתח שאינו מוכר. רשימה
 *   כפולה כאן הייתה נשארת מאחור ביום שיתווסף חוק.
 *
 * ⚠ הטווח כן נבדק. חוק של 9,999 נקודות הוא לא איזון — הוא תקלה.
 */
CREATE OR REPLACE FUNCTION game.admin_set_rule(p_key TEXT, p_points NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_old NUMERIC; v_ver INT;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF btrim(COALESCE(p_key, '')) = '' THEN RAISE EXCEPTION 'KEY_REQUIRED'; END IF;
  IF p_points IS NULL OR p_points < -50 OR p_points > 50 THEN
    RAISE EXCEPTION 'POINTS_RANGE';
  END IF;

  SELECT points INTO v_old FROM game.scoring_overrides WHERE rule_key = p_key;
  SELECT COALESCE(MAX(version), 0) + 1 INTO v_ver FROM game.scoring_overrides;

  INSERT INTO game.scoring_overrides (rule_key, points, version, updated_by)
  VALUES (p_key, p_points, v_ver, auth.uid()::TEXT)
  ON CONFLICT (rule_key) DO UPDATE
    SET points = EXCLUDED.points, version = EXCLUDED.version,
        updated_at = now(), updated_by = EXCLUDED.updated_by;

  INSERT INTO game.scoring_history (rule_key, old_points, new_points, changed_by)
  VALUES (p_key, v_old, p_points, auth.uid()::TEXT);

  RETURN jsonb_build_object('key', p_key, 'points', p_points, 'version', v_ver);
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_set_rule(TEXT,NUMERIC) TO authenticated;

/** ביטול override — חזרה לברירת המחדל שבקוד. */
CREATE OR REPLACE FUNCTION game.admin_clear_rule(p_key TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_old NUMERIC;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  SELECT points INTO v_old FROM game.scoring_overrides WHERE rule_key = p_key;
  DELETE FROM game.scoring_overrides WHERE rule_key = p_key;
  IF v_old IS NOT NULL THEN
    INSERT INTO game.scoring_history (rule_key, old_points, new_points, changed_by)
    VALUES (p_key, v_old, 0, auth.uid()::TEXT);
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_clear_rule(TEXT) TO authenticated;

/** כל ה-overrides, לקליינט. קריאה פומבית — חוקי המשחק גלויים. */
CREATE OR REPLACE FUNCTION game.scoring_rules()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
  SELECT COALESCE(jsonb_object_agg(rule_key, points), '{}'::jsonb)
    FROM game.scoring_overrides;
$$;
GRANT EXECUTE ON FUNCTION game.scoring_rules() TO anon, authenticated;

-- =====================================================================
-- §4 תוכן ושיווק — כל מחרוזת שאפשר לשנות בלי פריסה
-- =====================================================================
--
--  ★ מה נכנס לכאן ומה לא
--
--  נכנס: כותרות, משפטי שיווק, הודעת מערכת, באנרים, וקישורי
--  קמפיין. כלומר כל דבר שהוא **החלטה שיווקית** ולא מבנה.
--
--  לא נכנס: תוויות של כפתורים ומסכי שגיאה. תרגום שנשבר בגלל
--  שמישהו ניקה שורה בטבלה הוא מוצר שבור, ולא קמפיין שהשתנה.
--
--  ★ לכל מפתח יש ברירת מחדל **בקוד**. הטבלה היא override בלבד,
--    ולכן מחיקה של שורה תמיד חוזרת למשהו תקין. טבלה שהיא מקור
--    יחיד לטקסט היא מסך ריק שמחכה לקרות.

CREATE TABLE IF NOT EXISTS game.content (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  note       TEXT,
  /** `FALSE` = שמור אבל לא מוצג. טיוטה של קמפיין. */
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);
GRANT SELECT ON game.content TO anon, authenticated;

ALTER TABLE game.content ENABLE ROW LEVEL SECURITY;
DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN RETURN; END IF;
  DROP POLICY IF EXISTS content_read ON game.content;
  /* רק מה שפעיל נקרא. טיוטת קמפיין לא אמורה לדלוף למי שיפתח
     DevTools לפני שהיא עולה. */
  CREATE POLICY content_read ON game.content FOR SELECT USING (active);
END
$c$;

CREATE OR REPLACE FUNCTION game.admin_set_content(
  p_key TEXT, p_value JSONB, p_note TEXT DEFAULT NULL, p_active BOOLEAN DEFAULT TRUE
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF btrim(COALESCE(p_key, '')) = '' THEN RAISE EXCEPTION 'KEY_REQUIRED'; END IF;

  INSERT INTO game.content (key, value, note, active, updated_by)
  VALUES (p_key, p_value, p_note, p_active, auth.uid()::TEXT)
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, note = COALESCE(EXCLUDED.note, game.content.note),
        active = EXCLUDED.active, updated_at = now(), updated_by = EXCLUDED.updated_by;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (auth.uid()::TEXT, 'admin_set_content', 'content', p_key, p_value);
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_set_content(TEXT,JSONB,TEXT,BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION game.admin_delete_content(p_key TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  DELETE FROM game.content WHERE key = p_key;
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_delete_content(TEXT) TO authenticated;

/** כל התוכן הפעיל, בקריאה אחת. הקליינט ממזג מעל ברירות המחדל. */
CREATE OR REPLACE FUNCTION game.content_all()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
  SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
    FROM game.content WHERE active;
$$;
GRANT EXECUTE ON FUNCTION game.content_all() TO anon, authenticated;

/** לאדמין: גם הלא-פעילים, עם המטא. */
CREATE OR REPLACE FUNCTION game.admin_content_list()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'key', key, 'value', value, 'note', note, 'active', active,
      'updatedAt', to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
      ORDER BY key)
    FROM game.content), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_content_list() TO authenticated;

-- =====================================================================
-- §5 ניתוח — מי משחק, מה בוחרים, ומי חוזר
-- =====================================================================
--
--  ★ שלוש שאלות, ולא עשרים מדדים.
--
--  לוח מחוונים עם עשרים מספרים הוא לוח שלא מסתכלים עליו. שלוש
--  שאלות שאפשר לפעול לפיהן:
--
--    1. **כמה אנשים משחקים, ומאיפה הם.**
--    2. **מה כולם בוחרים** — כי בחירה של 80% היא בחירה שלא
--       מבדילה, וזה בדיוק מה שהמשחק אמור למנוע.
--    3. **מי חוזר.** מוצר שבועי חי או מת על זה.

CREATE OR REPLACE FUNCTION game.admin_analytics(p_gw_code TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v_gw UUID; v_code TEXT;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  v_code := COALESCE(p_gw_code, game.current_gameweek());
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = v_code;

  RETURN jsonb_build_object(
    'gameweek', v_code,

    /* ---- 1 · קהל ---- */
    'audience', jsonb_build_object(
      'users',      (SELECT count(*) FROM game.users),
      'registered', (SELECT count(*) FROM game.users WHERE NOT COALESCE(is_guest, TRUE)),
      'guests',     (SELECT count(*) FROM game.users WHERE COALESCE(is_guest, TRUE)),
      'withOffsides',(SELECT count(*) FROM game.users WHERE offsides_user_id IS NOT NULL),
      'admins',     (SELECT count(*) FROM game.users WHERE is_admin),
      'leagues',    (SELECT count(*) FROM game.leagues)
    ),

    /* ---- 2 · השתתפות במחזור ---- */
    'entries', COALESCE((
      SELECT jsonb_object_agg(mode, n) FROM (
        SELECT ul.mode, count(*) AS n FROM game.user_lineups ul
         WHERE ul.gameweek_id = v_gw AND ul.status <> 'draft'
         GROUP BY ul.mode) q
    ), '{}'::jsonb),

    'drafts', COALESCE((
      SELECT jsonb_object_agg(mode, n) FROM (
        SELECT d.mode, count(*) AS n FROM game.lineup_drafts d
         WHERE d.gameweek_id = v_gw GROUP BY d.mode) q
    ), '{}'::jsonb),

    /* ★ שיעור ההשלמה: כמה טיוטות הפכו להגשה.
       זה המדד היחיד שמצביע ישירות על חיכוך במסך הבנייה. */
    'conversion', (
      SELECT CASE WHEN d.n = 0 THEN NULL
                  ELSE round(100.0 * e.n / d.n) END
        FROM (SELECT count(DISTINCT user_id) n FROM game.lineup_drafts
               WHERE gameweek_id = v_gw) d,
             (SELECT count(DISTINCT user_id) n FROM game.user_lineups
               WHERE gameweek_id = v_gw AND status <> 'draft') e
    ),

    /* ---- 3 · מה בוחרים ---- */
    /* ★ אחוז הבחירה. מעל 60% = שחקן שלא מבדיל בין מתחרים,
       כלומר מחיר שלא מאוזן. זה המספר שבאמת מזיז את המשחק. */
    'topPicks', COALESCE((
      SELECT jsonb_agg(p ORDER BY (p->>'picks')::INT DESC)
      FROM (
        SELECT jsonb_build_object(
          'player', pl.name_he,
          'team',   COALESCE(tm.short_code, tm.name_he),
          'picks',  count(*),
          'pct',    round(100.0 * count(*) / NULLIF((
                      SELECT count(*) FROM game.user_lineups ul2
                       WHERE ul2.gameweek_id = v_gw AND ul2.status <> 'draft'), 0))
        ) AS p
        FROM game.user_lineup_slots uls
        JOIN game.user_lineups ul ON ul.id = uls.lineup_id
        JOIN core.players pl ON pl.id = uls.player_id
        JOIN core.teams   tm ON tm.id = uls.team_id
        WHERE ul.gameweek_id = v_gw AND ul.status <> 'draft'
        GROUP BY pl.name_he, tm.short_code, tm.name_he
        ORDER BY count(*) DESC
        LIMIT 12
      ) q), '[]'::jsonb),

    'topCaptains', COALESCE((
      SELECT jsonb_agg(p ORDER BY (p->>'picks')::INT DESC)
      FROM (
        SELECT jsonb_build_object(
          'player', pl.name_he,
          'picks',  count(*)
        ) AS p
        FROM game.user_lineup_slots uls
        JOIN game.user_lineups ul ON ul.id = uls.lineup_id
        JOIN core.players pl ON pl.id = uls.player_id
        WHERE ul.gameweek_id = v_gw AND ul.status <> 'draft' AND uls.is_captain
        GROUP BY pl.name_he
        ORDER BY count(*) DESC
        LIMIT 8
      ) q), '[]'::jsonb),

    /* ---- 4 · חזרה ---- */
    /* ★ כמה מחזורים שיחק כל אחד. `1` = ניסה פעם אחת ולא חזר. */
    'retention', COALESCE((
      SELECT jsonb_object_agg(weeks::TEXT, people) FROM (
        SELECT weeks, count(*) AS people FROM (
          SELECT user_id, count(DISTINCT gameweek_id) AS weeks
            FROM game.user_lineups WHERE status <> 'draft'
           GROUP BY user_id) u
        GROUP BY weeks) q
    ), '{}'::jsonb),

    'generatedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_analytics(TEXT) TO authenticated;

-- =====================================================================
-- §6 בריאות הנתונים — מה שנכשל בשקט
-- =====================================================================
--
--  ★ הרשימה הזו אינה גנרית. כל שורה בה היא תקלה שקרתה, או
--    שיודעים שהיא קורית בדאטת כדורגל:
--
--    · מחזור שעבר את הדדליין ועדיין פתוח → האוטומציה נעצרה,
--      והמערכת ממשיכה לקבל הגשות אחרי שהכדור מתגלגל.
--    · שחקן בסגל בלי מחיר → הוא מתומחר ברצפה, וכולם לוקחים אותו.
--    · מספרי חולצה כפולים באותה קבוצה → שני אנשים התמזגו לאחד.
--    · מחזור פעיל בלי משחקים → מסך בית ריק לכל המשתמשים.

CREATE OR REPLACE FUNCTION game.admin_data_quality()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v_out JSONB := '[]'::jsonb;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  /* מחזור פתוח שהדדליין שלו עבר */
  v_out := v_out || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'level', 'error', 'code', 'GW_OPEN_PAST_DEADLINE',
      'title', 'מחזור פתוח אחרי הדדליין',
      'detail', gw.code || ' — הדדליין עבר, והמחזור עדיין מקבל הגשות',
      'fix', 'לשונית מחזור → מצב → נעול'))
    FROM game.gameweeks gw
    WHERE gw.status IN ('open', 'draft') AND now() >= gw.lock_at), '[]'::jsonb);

  /* מחזור פעיל בלי משחקים */
  v_out := v_out || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'level', 'error', 'code', 'CURRENT_GW_NO_FIXTURES',
      'title', 'המחזור הפעיל בלי לוח משחקים',
      'detail', gw.code || ' — אין לו אף משחק',
      'fix', 'לשונית מחזור → קליטת לוח'))
    FROM game.gameweeks gw
    WHERE gw.is_current
      AND NOT EXISTS (SELECT 1 FROM core.weekly_matches m WHERE m.gameweek_id = gw.id)),
    '[]'::jsonb);

  /* שחקנים בלי מחיר */
  v_out := v_out || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'level', 'error', 'code', 'PLAYERS_NO_PRICE',
      'title', 'שחקנים בלי מחיר',
      'detail', n || ' שחקנים בסגל בלי מחיר — כולם מתומחרים ברצפה',
      'fix', 'לשונית סגלים → להשלים מחיר'))
    FROM (SELECT count(*) n FROM core.squads
           WHERE valid_to IS NULL AND fantasy_price IS NULL) q
    WHERE n > 0), '[]'::jsonb);

  /* שחקנים בלי דרג */
  v_out := v_out || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'level', 'warn', 'code', 'PLAYERS_NO_TIER',
      'title', 'שחקנים בלי דרג',
      'detail', n || ' שחקנים יופיעו עם דרג ברירת מחדל',
      'fix', 'לשונית סגלים → דרג'))
    FROM (SELECT count(*) n FROM core.squads
           WHERE valid_to IS NULL AND tier IS NULL) q
    WHERE n > 0), '[]'::jsonb);

  /* מספרי חולצה כפולים באותה קבוצה */
  /* ★ `GROUP BY` בתוך תת-שאילתה סקלרית מחזיר **שורה לכל קבוצה**,
     ואז `jsonb_agg` מצטבר בתוך כל קבוצה בנפרד — כלומר מספר
     שורות, ו-PostgreSQL נופל על
     "more than one row returned by a subquery".
     הצבירה חייבת לעטוף את הקיבוץ, לא להיות בתוכו. */
  v_out := v_out || COALESCE((
    SELECT jsonb_agg(d)
    FROM (
      SELECT jsonb_build_object(
        'level', 'warn', 'code', 'DUPLICATE_SHIRT',
        'title', 'מספר חולצה כפול',
        'detail', tm.name_he || ' — מספר ' || sq.shirt_number || ' מופיע פעמיים',
        'fix', 'לשונית סגלים → לתקן מספר') AS d
      FROM core.squads sq JOIN core.teams tm ON tm.id = sq.team_id
      WHERE sq.valid_to IS NULL AND sq.shirt_number IS NOT NULL
      GROUP BY tm.name_he, sq.team_id, sq.shirt_number
      HAVING count(*) > 1
    ) q), '[]'::jsonb);

  /* קבוצה בלי אף שחקן */
  v_out := v_out || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'level', 'error', 'code', 'TEAM_NO_PLAYERS',
      'title', 'קבוצה בלי סגל',
      'detail', tm.name_he || ' — אין לה אף שחקן פעיל',
      'fix', 'לשונית סגלים → הוספת שחקנים'))
    FROM core.teams tm
    WHERE EXISTS (SELECT 1 FROM core.external_refs x
                   WHERE x.provider='manual_json' AND x.entity_type='team'
                     AND x.entity_id = tm.id)
      AND NOT EXISTS (SELECT 1 FROM core.squads sq
                       WHERE sq.team_id = tm.id AND sq.valid_to IS NULL)),
    '[]'::jsonb);

  /* קבוצה שאין לה משחק במחזור הפעיל */
  v_out := v_out || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'level', 'warn', 'code', 'TEAM_NO_FIXTURE',
      'title', 'קבוצה בלי משחק במחזור',
      'detail', tm.name_he || ' — לא משחקת. השחקנים שלה ייבחרו ולא יצברו נקודות',
      'fix', 'לשונית מחזור → להוסיף את המשחק החסר'))
    FROM core.teams tm
    JOIN core.external_refs x ON x.provider='manual_json' AND x.entity_type='team'
                             AND x.entity_id = tm.id
    WHERE EXISTS (SELECT 1 FROM core.squads sq
                   WHERE sq.team_id = tm.id AND sq.valid_to IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM core.weekly_matches m
        JOIN game.gameweeks gw ON gw.id = m.gameweek_id AND gw.is_current
        WHERE m.home_team_id = tm.id OR m.away_team_id = tm.id)),
    '[]'::jsonb);

  RETURN v_out;
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_data_quality() TO authenticated;

/* ★ יומן הביקורת, לתצוגה. מי עשה מה, מתי. */
CREATE OR REPLACE FUNCTION game.admin_audit(p_limit INT DEFAULT 40)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(a ORDER BY (a->>'at') DESC)
    FROM (
      SELECT jsonb_build_object(
        'action', l.action,
        'entity', l.entity,
        'id',     l.entity_id,
        'value',  l.new_value,
        'at',     to_char(l.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'who',    COALESCE(u.display_name, left(l.actor, 8))
      ) AS a
      FROM game.audit_logs l
      LEFT JOIN game.users u ON u.id::TEXT = l.actor
      ORDER BY l.created_at DESC
      LIMIT GREATEST(1, LEAST(p_limit, 200))
    ) q), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_audit(INT) TO authenticated;

/* מונה הגרסה מכיר גם את הטבלאות החדשות. */
DO $trg$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['game.scoring_overrides', 'game.content'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS bump_data_revision ON %s', t);
    EXECUTE format(
      'CREATE TRIGGER bump_data_revision AFTER INSERT OR UPDATE OR DELETE ON %s '
      'FOR EACH STATEMENT EXECUTE FUNCTION game.bump_revision()', t);
  END LOOP;
END
$trg$;

UPDATE game.data_revision SET revision = revision + 1, scope = 'migration-14' WHERE id = 1;


-- =====================================================================
-- ▼▼▼  15_team_names.sql  —  קיצורי הקבוצות — ב״ש, מ·ת״א, קר״ש
-- =====================================================================

-- =====================================================================
--  Dubid · מיגרציה 15 — קיצורי הקבוצות
-- =====================================================================
--
--  ★ הבעיה
--
--  הקיצורים היו בפורמט הגרשיים: `הב״ש`, `מ״ח`, `מפ״ת`, `הפ״ת`.
--  הם קצרים, והם **לא קריאים**: `מפ״ת` ו-`הפ״ת` נבדלים באות אחת
--  בתוך רצף שנראה כמעט זהה, ו-`מ״ח` יכול להיות מכבי חיפה או
--  מכבי חדרה. בכרטיס שחקן בגודל 11px זה הופך לניחוש.
--
--  ★ הפורמט
--
--      עיר חד־משמעית  →  שם העיר לבדו
--      עיר עם שתי קבוצות →  אות המועדון · העיר
--
--      ב״ש     הפועל באר שבע      נתניה   מכבי נתניה
--      סכנין   בני סכנין          טבריה   עירוני טבריה
--      קר״ש    עירוני קרית שמונה  ר״ג     הפועל רמת גן
--      בית״ר   בית"ר ירושלים  ← המועדון היחיד בשם הזה בליגה
--
--      מ·ת״א / ה·ת״א      מ·חיפה / ה·חיפה
--      מ·פ״ת / ה·פ״ת      ה·י-ם
--
--  ★ למה זה השתנה מ-`ה.תא` / `ע.קש`
--
--  הפורמט הקודם היה `<אות>.<עיר>` בכל הקבוצות, וזה יצר מילים:
--  `ה.ים` נקרא "הים", `ע.קש` נקרא "עקש", ו-`מ.תא` נקרא "מתא".
--  נקודה בין שתי אותיות עבריות אינה מפריד חזק מספיק, והעין
--  קוראת את הרצף כמילה אחת לפני שהיא מגיעה לנקודה.
--
--  שני תיקונים:
--    · הפרדה ב-`·` ולא בנקודה — מפריד ויזואלי שאינו סימן פיסוק
--      ולכן לא נבלע לתוך המילה.
--    · **רוב הקבוצות לא צריכות אות מועדון בכלל.** יש ליגה אחת
--      ובה שש ערים עם קבוצה יחידה; "נתניה" ו"סכנין" הם השמות
--      שאוהד באמת אומר, והם קצרים וברורים יותר מכל קיצור.
--      אות המועדון נשמרת רק לארבע הערים שבהן היא מכריעה.
--
--  ★ למה טבלה מפורשת ולא כלל שנגזר מהשם
--
--  כלל היה נשבר על ירושלים (`ים`, לא `ירושלים`), על "בני סכנין"
--  (אין בה מילת מועדון סטנדרטית), ועל כל קבוצה שתעלה מהליגה עם
--  שם שלא חשבנו עליו. ארבע-עשרה שורות שנכתבו ביד לא יורות לרוחב,
--  ואפשר לקרוא אותן ולוודא בעין.
--
--  ★ למה זה לא מספיק לעדכן את הסיד
--
--  `db/03` מעדכן `names` אבל **לא** `short_code`, ו-`db/13`
--  ממלא אותו רק כשהוא NULL או עדיין בברירת המחדל הלטינית
--  (`left(name_en,3)`). מסד שכבר רץ מחזיק את הקיצור הישן, והוא
--  לא ישתנה משום הרצה חוזרת. לכן עדכון מפורש, כאן.
--
--  אידמפוטנטי. אפשר להריץ שוב.
-- =====================================================================

SET search_path = core, game, public;

DO $names$
DECLARE
  r        RECORD;
  v_team   UUID;
  v_hit    INT := 0;
  v_miss   INT := 0;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('1',  'ב״ש',     'הפועל באר שבע'),
      ('2',  'ה·י-ם',   'הפועל ירושלים'),
      ('3',  'מ·ת״א',   'מכבי תל אביב'),
      ('4',  'מ·חיפה',  'מכבי חיפה'),
      ('5',  'בית״ר',   'בית"ר ירושלים'),
      ('6',  'ה·ת״א',   'הפועל תל אביב'),
      ('7',  'נתניה',   'מכבי נתניה'),
      ('8',  'סכנין',   'בני סכנין'),
      ('9',  'ה·חיפה',  'הפועל חיפה'),
      ('10', 'קר״ש',    'עירוני קרית שמונה'),
      ('11', 'טבריה',   'עירוני טבריה'),
      ('12', 'מ·פ״ת',   'מכבי פתח תקווה'),
      ('13', 'ר״ג',     'הפועל רמת גן'),
      ('14', 'ה·פ״ת',   'הפועל פתח תקווה')
    ) AS t(ext, short, expect_he)
  LOOP
    v_team := core.team_by_ext(r.ext);

    /* ★ קבוצה שלא נמצאה מדווחת, ולא נבלעת.
       מסד בלי סיד, או מזהים שהשתנו — שניהם מצבים שצריך לראות. */
    IF v_team IS NULL THEN
      RAISE WARNING 'קבוצה % (%) לא נמצאה — הקיצור לא עודכן', r.ext, r.expect_he;
      v_miss := v_miss + 1;
      CONTINUE;
    END IF;

    UPDATE core.teams SET short_code = r.short WHERE id = v_team;
    v_hit := v_hit + 1;

    /* גם ה-payload של הסיד, כדי שהמילוי ב-`db/13` יסכים איתנו
       אם מישהו יריץ אותו שוב על מסד נקי. */
    UPDATE core.external_refs
       SET payload = jsonb_set(COALESCE(payload, '{}'::jsonb), '{short}', to_jsonb(r.short))
     WHERE provider = 'manual_json' AND entity_type = 'team' AND external_id = r.ext;
  END LOOP;

  RAISE NOTICE 'קיצורים: % עודכנו, % לא נמצאו', v_hit, v_miss;
END
$names$;

-- ---------------------------------------------------------------------
-- ★ שער: אין שני קיצורים זהים.
--
--   `ה.ים` ו-`ב.ים` נבדלים באות אחת, וזה בסדר — הם מועדונים
--   שונים באותה עיר. שני קיצורים **זהים** הם משהו אחר לגמרי:
--   שתי קבוצות שהמשתמש לא יכול להבחין ביניהן בשום מסך.
-- ---------------------------------------------------------------------
DO $guard$
DECLARE v_dupe TEXT;
BEGIN
  SELECT string_agg(short_code, ', ') INTO v_dupe
    FROM (SELECT short_code FROM core.teams
           WHERE short_code IS NOT NULL
           GROUP BY short_code HAVING count(*) > 1) q;

  IF v_dupe IS NOT NULL THEN
    RAISE EXCEPTION 'קיצור כפול: % — שתי קבוצות שאי אפשר להבחין ביניהן', v_dupe;
  END IF;
END
$guard$;

UPDATE game.data_revision SET revision = revision + 1, scope = 'migration-15' WHERE id = 1;


-- =====================================================================
-- ▼▼▼  16_team_names_bots_activity.sql  —  שם קבוצה, משתתפים גלויים, בוטים, יומן פעילות
-- =====================================================================

-- =====================================================================
--  Dubid · מיגרציה 16 — שם קבוצה, משתתפים גלויים, בוטים, ויומן פעילות
-- =====================================================================
--
--  ארבעה שינויים שנראים לא קשורים, ויש להם מכנה משותף אחד:
--  **המחזור צריך להרגיש מאוכלס לפני שהוא מתחיל.**
--
--    1. לכל הרכב יש שם קבוצה ושם מאמן — לא רק "אלמוני".
--    2. כל מי שהגיש נראה בטבלה עוד לפני הנעילה.
--    3. אדמין יכול להוסיף בוטים למחזור ריק.
--    4. אדמין רואה יומן פעילות חי של מי הגיש מה.
--
--  אידמפוטנטי. אפשר להריץ שוב.
-- =====================================================================

SET search_path = game, core, public;

-- ---------------------------------------------------------------------
-- §1 · שם הקבוצה
-- ---------------------------------------------------------------------
--
--  ★ למה שם קבוצה **בנוסף** לשם המאמן, ולא במקומו
--
--  שם המאמן הוא הזהות של האדם ("מאור"). שם הקבוצה הוא הזהות של
--  ה**הרכב** ("שכונת התקווה יונייטד"), והוא מה שהופך טבלה של
--  שמות פרטיים לליגה. בכל משחק פנטזי מוצלח יש את שניהם, וזה
--  לא במקרה: השם הפרטי מזהה, שם הקבוצה **משתתף**.
--
--  ★ הוא יושב על ההרכב ולא על המשתמש
--
--  כי אותו אדם משחק גם דוביד 5 וגם דוביד 11, ואולי ירצה שם אחר
--  לכל אחד. וגם: שם שנקבע בהגשה נשאר קפוא באותו מחזור גם אם
--  המשתמש שינה אותו אחר כך — בדיוק כמו הסגל וכמו המחיר.
-- ---------------------------------------------------------------------

ALTER TABLE game.user_lineups
  ADD COLUMN IF NOT EXISTS team_name TEXT;

COMMENT ON COLUMN game.user_lineups.team_name IS
  'שם הקבוצה של המתמודד באותו מחזור. NULL = טרם נבחר.';

-- ---------------------------------------------------------------------
-- §2 · הגשה עם שם קבוצה
-- ---------------------------------------------------------------------
--
--  ★ פרמטר חדש בסוף ועם DEFAULT — ולא חתימה חדשה.
--
--  קליינט ישן שעוד לא נפרס ממשיך לקרוא לפונקציה עם חמישה
--  ארגומנטים ולקבל בדיוק את מה שקיבל קודם. חתימה שנשברת באמצע
--  פריסה מפילה הגשות בזמן שהמחזור פתוח.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.set_entry_team_name(
  p_gw_code TEXT, p_mode TEXT, p_team_name TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  v_auth UUID := auth.uid();
  v_gw   game.gameweeks;
  v_name TEXT := NULLIF(btrim(p_team_name), '');
BEGIN
  IF v_auth IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  /* ★ תקרה על האורך. שם של מאתיים תווים לא "נראה רע" — הוא
     שובר כל שורה בטבלה ובכל כרטיס שיתוף. */
  IF v_name IS NOT NULL AND length(v_name) > 24 THEN
    v_name := left(v_name, 24);
  END IF;

  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw.id IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND'; END IF;

  UPDATE game.user_lineups
     SET team_name = v_name
   WHERE user_id = v_auth AND gameweek_id = v_gw.id AND mode = p_mode;
END;
$$;

GRANT EXECUTE ON FUNCTION game.set_entry_team_name(TEXT, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- §3 · המשתתפים נראים לפני הנעילה
-- ---------------------------------------------------------------------
--
--  ★★ מה שהיה, ולמה זה פגע במוצר ★★
--
--  `game.entries` החזירה לפני הנעילה **רק את ההגשה שלי**:
--
--      AND (now() >= v_gw.lock_at OR ul.user_id = v_auth)
--
--  כלומר משתמש שהגיש ראשון פתח את הטבלה וראה את עצמו לבד. מחזור
--  שנראה ריק הוא מחזור שלא מרגיש כמו תחרות, וזה בדיוק הרגע שבו
--  הוא מפסיק לחכות לו.
--
--  ★★ ולמה אי אפשר פשוט להסיר את השורה ★★
--
--  כי אז כל אחד יכול לפתוח את הטבלה, לראות את ההרכב של מי שהוא
--  חושב שמבין, ולהעתיק אותו דקה לפני הנעילה. זה הורג את המשחק.
--
--  ★ הפתרון: לחשוף את ה**משתתף**, להסתיר את ה**הרכב**.
--
--  לפני הנעילה כל הגשה חוזרת עם שם, שם קבוצה וחותמת זמן —
--  ובלי שחקנים (`slots: []`, `hidden: true`). אחרי הנעילה הכל
--  נפתח. ההסתרה היא בשרת, ולא במסך: קליינט הוא בקשת רשת, ומה
--  שהוא לא אמור לדעת פשוט לא נשלח אליו.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.entries(p_gw_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  v_gw     game.gameweeks;
  v_auth   UUID := auth.uid();
  v_open   BOOLEAN;
BEGIN
  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw.id IS NULL THEN RETURN '[]'::jsonb; END IF;

  -- TRUE = ההרכבים עדיין סודיים.
  v_open := (now() < v_gw.lock_at);

  RETURN COALESCE((
    SELECT jsonb_agg(e ORDER BY e->>'submittedAt')
    FROM (
      SELECT jsonb_build_object(
        'id',          ul.id,
        'userId',      ul.user_id,
        'displayName', COALESCE(NULLIF(btrim(u.display_name), ''), 'אלמוני'),
        'teamName',    ul.team_name,
        'isBot',       COALESCE(u.is_bot, FALSE),
        'gameweekId',  p_gw_code,
        'mode',        ul.mode,
        -- ★ הדגל שאומר למסך "יש כאן משתתף, אין כאן הרכב".
        --   בלעדיו המסך היה מנסה לנקד רשימה ריקה ומציג 0.
        'hidden',      (v_open AND ul.user_id IS DISTINCT FROM v_auth),
        'submittedAt', to_char(ul.submitted_at AT TIME ZONE 'UTC',
                               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'lineup', jsonb_build_object(
          'lineupId',   ul.id,
          'userId',     ul.user_id,
          'gameweekId', p_gw_code,
          'formation',  ul.formation,
          'slots', CASE
            WHEN v_open AND ul.user_id IS DISTINCT FROM v_auth THEN '[]'::jsonb
            ELSE COALESCE((
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
          END
        )
      ) AS e
      FROM game.user_lineups ul
      LEFT JOIN game.users u ON u.id = ul.user_id
      WHERE ul.gameweek_id = v_gw.id
        AND ul.status IN ('submitted','locked','scored')
    ) q
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION game.entries(TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- §4 · בוטים
-- ---------------------------------------------------------------------
--
--  ★ למה בוטים הם כלי מוצר ולא רמאות
--
--  מחזור ראשון עם שני משתתפים אינו תחרות, וטבלה עם שתי שורות
--  אומרת למשתמש החדש "אין כאן אף אחד". בוטים פותרים בעיה
--  אמיתית של השקה — ובתנאי אחד: **שהם יהיו מסומנים.**
--
--  `is_bot` נשמר על המשתמש וחוזר לכל מסך. אף מסך לא חייב להציג
--  את זה, אבל אף מסך לא יכול לטעון שהוא לא ידע. הסתרה של זה
--  הייתה הופכת כלי לגיטימי להטעיה.
--
--  ★ הבוט משחק לפי אותם חוקים
--
--  הוא עובר דרך אותה ולידציה: שחקן אחד מכל קבוצה, גודל הרכב,
--  תקציב. אין כאן "הרכב שהוזרק" — יש הגשה שנבנית ונבדקת.
--
--  ★ והוא דטרמיניסטי
--
--  אותו מחזור + אותו אינדקס בוט = אותו הרכב, תמיד. `random()`
--  היה הופך כל הרצה חוזרת של המיגרציה לתוצאה אחרת, ואת הבדיקה
--  לחסרת ערך. הזרע נגזר מקוד המחזור ומהמספר הסידורי.
-- ---------------------------------------------------------------------

ALTER TABLE game.users
  ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN game.users.is_bot IS
  'משתתף שנוצר על ידי האדמין. חוזר לכל מסך — הסתרה הייתה הטעיה.';

CREATE INDEX IF NOT EXISTS users_is_bot_idx ON game.users (is_bot) WHERE is_bot;

/**
 * שמות הבוטים. שכונתיים, ולא "Bot 1".
 *
 * ★ בוט בשם "Bot 4" הורס את האווירה גם כשהוא מסומן. שם אמיתי
 *   הופך את הטבלה למאוכלסת; התג לידו הוא מה ששומר על ההגינות.
 */
CREATE OR REPLACE FUNCTION game.bot_identity(p_index INT)
RETURNS TABLE (coach TEXT, team TEXT)
LANGUAGE sql IMMUTABLE
AS $$
  WITH c(n) AS (
    SELECT * FROM unnest(ARRAY[
      'אבי','מוטי','שוקי','ג׳קי','רפי','חיים','ניסים','דודו',
      'אלי','יוסי','שמעון','מאיר','ציון','רוני','אמנון','גבי'
    ])
  ), t(n) AS (
    SELECT * FROM unnest(ARRAY[
      'שכונת התקווה','אצטדיון הסמטה','בני המרכזייה','מכבי הפנימייה',
      'הפועל הקיוסק','נבחרת הפלאפל','שער הכניסה','יוניון בית הקפה',
      'אלופי החניון','ספסל הרזרבה','מועדון הצהריים','ליגת המרפסת',
      'אחוזת הדשא','ועד השכונה','חלוצי הרחוב','גיבורי המגרש'
    ])
  )
  SELECT
    (SELECT n FROM c OFFSET (abs(p_index) % 16) LIMIT 1),
    (SELECT n FROM t OFFSET (abs(p_index) % 16) LIMIT 1);
$$;

/**
 * הוספת בוטים למחזור.
 *
 * מחזיר {added, skipped, problems[]}. `skipped` אינו שגיאה: בוט
 * שכבר הגיש למחזור הזה פשוט נשאר כמו שהוא, וזה מה שהופך את
 * הפונקציה לבטוחה להרצה חוזרת.
 */
CREATE OR REPLACE FUNCTION game.admin_add_bots(
  p_gw_code TEXT,
  p_mode    TEXT,
  p_count   INT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  v_gw       game.gameweeks;
  v_size     INT;
  v_budget   NUMERIC := 15;
  v_added    INT := 0;
  v_skipped  INT := 0;
  v_problems JSONB := '[]'::jsonb;
  i          INT;
  v_seed     INT;
  v_user     UUID;
  v_coach    TEXT;
  v_team     TEXT;
  v_lineup   UUID;
  v_slot_no  INT;
  v_spent    NUMERIC;
  r          RECORD;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF p_mode NOT IN ('five','full') THEN RAISE EXCEPTION 'INVALID_MODE'; END IF;

  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw.id IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND'; END IF;

  v_size := CASE WHEN p_mode = 'five' THEN 5 ELSE 11 END;

  FOR i IN 1..GREATEST(1, LEAST(p_count, 60)) LOOP
    /* ★ הזרע נגזר מקוד המחזור ומהאינדקס — ולא מ-`random()`.
       אותה הרצה, אותה תוצאה, תמיד. */
    v_seed := abs(hashtext(p_gw_code || ':' || p_mode || ':' || i));

    SELECT coach, team INTO v_coach, v_team FROM game.bot_identity(v_seed);
    v_coach := v_coach || ' ' || i::TEXT;

    /* המשתמש. `username` ייחודי ולכן הוא גם מפתח החיפוש. */
    SELECT id INTO v_user FROM game.users
     WHERE username = ('bot_' || p_gw_code || '_' || p_mode || '_' || i)::CITEXT;

    IF v_user IS NULL THEN
      INSERT INTO game.users (display_name, username, is_guest, is_bot)
      VALUES (v_coach,
              ('bot_' || p_gw_code || '_' || p_mode || '_' || i)::CITEXT,
              TRUE, TRUE)
      RETURNING id INTO v_user;
    END IF;

    /* כבר הגיש? מדלגים. */
    PERFORM 1 FROM game.user_lineups
     WHERE user_id = v_user AND gameweek_id = v_gw.id AND mode = p_mode
       AND status IN ('submitted','locked','scored');
    IF FOUND THEN v_skipped := v_skipped + 1; CONTINUE; END IF;

    DELETE FROM game.user_lineups
     WHERE user_id = v_user AND gameweek_id = v_gw.id AND mode = p_mode;

    INSERT INTO game.user_lineups
      (user_id, gameweek_id, mode, formation, status, submitted_at, team_name)
    VALUES (v_user, v_gw.id, p_mode,
            CASE WHEN p_mode = 'five' THEN '2-1-1' ELSE '4-3-3' END,
            'submitted', now(), v_team)
    RETURNING id INTO v_lineup;

    v_slot_no := 0;
    v_spent := 0;

    /*
     * ★ בחירת השחקנים.
     *
     *   · שחקן אחד מכל קבוצה — `DISTINCT ON (team_id)`, אותו
     *     חוק ליבה שחל על בני אדם.
     *   · הסדר נגזר מהזרע, כך שכל בוט בוחר אחרת אבל באופן קבוע.
     *   · במצב חמישה גם התקציב נאכף, ולכן ממיינים מהזול ליקר
     *     בתוך הערבוב — בוט שחרג בתקציב היה נדחה בהגשה של
     *     בן אדם, ואסור לו להיות פטור.
     */
    FOR r IN
      SELECT * FROM (
        SELECT DISTINCT ON (sq.team_id)
               sq.player_id, sq.team_id, sq.position,
               COALESCE(sq.fantasy_price, 0) AS price
          FROM core.squads sq
         WHERE sq.valid_to IS NULL AND sq.status = 'active'
         ORDER BY sq.team_id, md5(sq.player_id::TEXT || v_seed::TEXT)
      ) picks
      ORDER BY CASE WHEN p_mode = 'five' THEN picks.price ELSE 0 END,
               md5(picks.team_id::TEXT || v_seed::TEXT)
      LIMIT v_size
    LOOP
      v_slot_no := v_slot_no + 1;
      v_spent := v_spent + r.price;
      INSERT INTO game.user_lineup_slots
        (lineup_id, slot_no, player_id, team_id, position, price,
         is_captain, is_vice, is_bench)
      VALUES (v_lineup, v_slot_no, r.player_id, r.team_id, r.position, r.price,
              v_slot_no = 1, v_slot_no = 2, FALSE);
    END LOOP;

    IF v_slot_no < v_size THEN
      v_problems := v_problems || jsonb_build_object(
        'bot', i, 'issue', 'אין מספיק קבוצות פעילות בליגה');
      DELETE FROM game.user_lineups WHERE id = v_lineup;
      CONTINUE;
    END IF;

    IF p_mode = 'five' AND v_spent > v_budget THEN
      v_problems := v_problems || jsonb_build_object(
        'bot', i, 'issue', format('חריגה מתקציב: %s > %s', v_spent, v_budget));
      DELETE FROM game.user_lineups WHERE id = v_lineup;
      CONTINUE;
    END IF;

    v_added := v_added + 1;
    PERFORM game.log_activity(v_user, 'bot_submit', p_mode, p_gw_code, v_team);
  END LOOP;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (COALESCE(auth.uid()::TEXT, 'admin'), 'admin_add_bots', 'gameweek', p_gw_code,
          jsonb_build_object('mode', p_mode, 'added', v_added, 'skipped', v_skipped));

  /* ★ `bump_revision` הוא פונקציית טריגר ואי אפשר לקרוא לה
     ישירות — היא נורית ממילא מהטריגר על `user_lineups`. עדכון
     מפורש כאן היה מפיל את כל הפונקציה ב-
     "trigger functions can only be called as triggers". */
  UPDATE game.data_revision
     SET revision = revision + 1, scope = 'bots', updated_at = now()
   WHERE id = 1;

  RETURN jsonb_build_object(
    'added', v_added, 'skipped', v_skipped, 'problems', v_problems);
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_add_bots(TEXT, TEXT, INT) TO authenticated;

/** הסרת כל הבוטים ממחזור. שגיאה בהוספה לא צריכה להיות בלתי הפיכה. */
CREATE OR REPLACE FUNCTION game.admin_remove_bots(p_gw_code TEXT, p_mode TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v_gw game.gameweeks; v_n INT;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw.id IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND'; END IF;

  WITH gone AS (
    DELETE FROM game.user_lineups ul
     USING game.users u
     WHERE u.id = ul.user_id AND u.is_bot
       AND ul.gameweek_id = v_gw.id
       AND (p_mode IS NULL OR ul.mode = p_mode)
    RETURNING 1
  ) SELECT count(*) INTO v_n FROM gone;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (COALESCE(auth.uid()::TEXT, 'admin'), 'admin_remove_bots', 'gameweek', p_gw_code,
          jsonb_build_object('mode', p_mode, 'removed', v_n));

  UPDATE game.data_revision
     SET revision = revision + 1, scope = 'bots', updated_at = now()
   WHERE id = 1;
  RETURN jsonb_build_object('removed', v_n);
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_remove_bots(TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- §5 · יומן פעילות
-- ---------------------------------------------------------------------
--
--  ★ למה טבלה נפרדת מ-`audit_logs`
--
--  `audit_logs` הוא יומן **אדמין**: מי שינה חוק, מי פרסם מחזור.
--  הוא נועד לאחריות, הוא נדיר, והוא נשמר לנצח.
--
--  יומן הפעילות הוא משהו אחר לגמרי: הוא **תנועה** של משתמשים,
--  הוא תכוף, והוא בעיקר מעניין בשבועיים האחרונים. לערבב ביניהם
--  אומר שאלף הגשות קוברות את השורה האחת שבה מישהו שינה את
--  מכפיל הקפטן — כלומר להרוס את יומן האחריות בדיוק כשצריך אותו.
--
--  ★ מה שנשמר, ומה שלא
--
--  נשמר: מי, מה, מתי, ובאיזה מצב. **לא** נשמר: אילו שחקנים
--  נבחרו. יומן שמכיל הרכבים הוא דלת אחורית לצפייה בהרכבים לפני
--  הנעילה, וזה בדיוק מה ש-§3 סגר.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS game.activity_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID REFERENCES game.users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  mode       TEXT,
  gw_code    TEXT,
  detail     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_log_recent_idx
  ON game.activity_log (created_at DESC);
CREATE INDEX IF NOT EXISTS activity_log_gw_idx
  ON game.activity_log (gw_code, created_at DESC);

/**
 * רישום פעולה.
 *
 * ★ `SECURITY DEFINER` ובלי GRANT ל-anon: רק פונקציות אחרות
 *   בסכימה קוראות לזה. לו הקליינט היה יכול לכתוב ליומן, היומן
 *   היה מקור מידע שאי אפשר לסמוך עליו — וזה גרוע מאין יומן.
 */
CREATE OR REPLACE FUNCTION game.log_activity(
  p_user UUID, p_action TEXT, p_mode TEXT, p_gw TEXT, p_detail TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER
SET search_path = game, public
AS $$
  INSERT INTO game.activity_log (user_id, action, mode, gw_code, detail)
  VALUES (p_user, p_action, p_mode, p_gw, NULLIF(btrim(p_detail), ''));
$$;

-- ---------------------------------------------------------------------
--  ★ ההגשה והביטול רושמים ליומן.
--
--  הרישום נעשה **בתוך** הפונקציות הקיימות ולא בטריגר, בכוונה:
--  טריגר על `user_lineups` היה נורה גם על שמירת טיוטה, ואז
--  היומן היה מתמלא ב"שחר עדכן טיוטה" שלוש פעמים בדקה. מה
--  שמעניין הוא ה**אירוע**, לא השינוי בשורה.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
--  ★★ איך מוסיפים פרמטר לפונקציה שקליינטים כבר קוראים לה ★★
--
--  הפיתוי הוא להוסיף ארגומנט עם DEFAULT. זו טעות: PostgreSQL
--  היה מקבל **שתי** פונקציות בשם `submit_entry` — זו בת חמשת
--  הארגומנטים מ-db/09 וזו בת השישה — וכל קריאה עם חמישה
--  ארגומנטים הייתה נכשלת ב-`function is not unique`. כלומר כל
--  הגשה במוצר, בבת אחת.
--
--  לכן: המימוש המקורי **משנה שם** ל-`submit_entry_core`, והשם
--  `submit_entry` מקבל עטיפה. הלוגיקה נשארת במקום אחד — שכפול
--  שלה כאן היה יוצר שני מסלולי הגשה שיום אחד יתפצלו, וזה בדיוק
--  סוג הבאג שאי אפשר לאתר.
--
--  ★ ואידמפוטנטי: `DROP … IF EXISTS` לפני השינוי, כדי שהרצה
--    שנייה של RUN-ALL (שבה db/09 יוצר מחדש את בן החמישה) תעבוד.
-- ---------------------------------------------------------------------

DO $rename$
BEGIN
  /* ★ `pronargs` ולא `pg_get_function_identity_arguments`.
     הפונקציה השנייה מחזירה את שמות הפרמטרים יחד עם הטיפוסים
     ("p_gw_code text, ..."), ולכן ההשוואה לרשימת טיפוסים בלבד
     לעולם לא התאימה — השם `submit_entry_core` מעולם לא נוצר,
     והעטיפה קראה לפונקציה שאינה קיימת. הבדיקה תפסה את זה כ-
     `function is not unique`, כלומר שתי גרסאות חיו זו לצד זו. */
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'game' AND p.proname = 'submit_entry' AND p.pronargs = 5
  ) THEN
    DROP FUNCTION IF EXISTS game.submit_entry_core(TEXT, TEXT, TEXT, JSONB, TEXT);
    ALTER FUNCTION game.submit_entry(TEXT, TEXT, TEXT, JSONB, TEXT)
      RENAME TO submit_entry_core;
  END IF;
END
$rename$;

DO $rename2$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'game' AND p.proname = 'withdraw_entry' AND p.pronargs = 2
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'game' AND p.proname = 'withdraw_entry_core'
  ) THEN
    ALTER FUNCTION game.withdraw_entry(TEXT, TEXT) RENAME TO withdraw_entry_core;
  END IF;
END
$rename2$;

CREATE OR REPLACE FUNCTION game.submit_entry(
  p_gw_code   TEXT,
  p_mode      TEXT,
  p_formation TEXT,
  p_slots     JSONB,
  p_display_name TEXT DEFAULT NULL,
  p_team_name    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE
  v_result JSONB;
  v_auth   UUID := auth.uid();
  v_team   TEXT := NULLIF(btrim(p_team_name), '');
BEGIN
  v_result := game.submit_entry_core(p_gw_code, p_mode, p_formation, p_slots, p_display_name);

  IF v_team IS NOT NULL THEN
    PERFORM game.set_entry_team_name(p_gw_code, p_mode, v_team);
  END IF;

  PERFORM game.log_activity(
    v_auth, 'submit', p_mode, p_gw_code,
    COALESCE(v_team, (SELECT display_name FROM game.users WHERE id = v_auth)));

  RETURN v_result || jsonb_build_object('teamName', v_team);
END;
$$;

/* ★ `BOOLEAN` ולא `VOID` — זה טיפוס ההחזרה של המקור.
   `CREATE OR REPLACE` אינו יכול לשנות טיפוס החזרה, וניסיון
   כזה מפיל את כל המיגרציה. הקריאה מחזירה את מה שהמקור החזיר. */
CREATE OR REPLACE FUNCTION game.withdraw_entry(p_gw_code TEXT, p_mode TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v_auth UUID := auth.uid(); v_ok BOOLEAN;
BEGIN
  v_ok := game.withdraw_entry_core(p_gw_code, p_mode);
  IF v_ok THEN
    PERFORM game.log_activity(v_auth, 'withdraw', p_mode, p_gw_code, NULL);
  END IF;
  RETURN v_ok;
END;
$$;

GRANT EXECUTE ON FUNCTION game.withdraw_entry(TEXT, TEXT) TO authenticated;

GRANT EXECUTE ON FUNCTION game.submit_entry(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT)
  TO authenticated;

/**
 * ★ יומן פעילות לאדמין.
 *
 * מחזיר משפטים מוכנים ("שחר שלח הרכב · דוביד 5"), ולא שדות
 * גולמיים. הסיבה: הניסוח הוא החלטת מוצר, והוא צריך להיות זהה
 * בכל מקום שמציג את היומן — כולל התראה, ייצוא ודוח.
 */
CREATE OR REPLACE FUNCTION game.admin_activity(
  p_limit INT DEFAULT 60, p_gw_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(a ORDER BY (a->>'at') DESC)
    FROM (
      SELECT jsonb_build_object(
        'id',     l.id,
        'action', l.action,
        'mode',   l.mode,
        'gw',     l.gw_code,
        'who',    COALESCE(NULLIF(btrim(u.display_name), ''), 'אורח'),
        'isBot',  COALESCE(u.is_bot, FALSE),
        'detail', l.detail,
        'at',     to_char(l.created_at AT TIME ZONE 'UTC',
                          'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'text',   CASE l.action
                    WHEN 'submit'     THEN COALESCE(NULLIF(btrim(u.display_name),''),'אורח')
                                           || ' שלח הרכב'
                    WHEN 'bot_submit' THEN COALESCE(NULLIF(btrim(u.display_name),''),'בוט')
                                           || ' (בוט) שלח הרכב'
                    WHEN 'withdraw'   THEN COALESCE(NULLIF(btrim(u.display_name),''),'אורח')
                                           || ' ביטל הרכב'
                    WHEN 'signup'     THEN COALESCE(NULLIF(btrim(u.display_name),''),'אורח')
                                           || ' נרשם'
                    -- ★ פעולות ניהול מופיעות באותו יומן ולא ביומן שני.
                    --   "מי שינה את המודעה" ו"מי הגיש הרכב" הן שתי
                    --   שאלות על אותו ציר זמן; שני יומנים נפרדים היו
                    --   מחייבים להצליב אותם ידנית בכל בירור.
                    WHEN 'ad_upsert'  THEN 'מודעה נשמרה'
                    WHEN 'ad_on'      THEN 'מודעה הודלקה'
                    WHEN 'ad_off'     THEN 'מודעה כובתה'
                    WHEN 'ad_delete'  THEN 'מודעה נמחקה'
                    ELSE COALESCE(NULLIF(btrim(u.display_name),''),'אורח') || ' · ' || l.action
                  END
                  || CASE WHEN l.mode = 'five' THEN ' · דוביד 5'
                          WHEN l.mode = 'full' THEN ' · דוביד 11'
                          ELSE '' END
      ) AS a
      FROM game.activity_log l
      LEFT JOIN game.users u ON u.id = l.user_id
      WHERE p_gw_code IS NULL OR l.gw_code = p_gw_code
      ORDER BY l.created_at DESC
      LIMIT GREATEST(1, LEAST(p_limit, 300))
    ) q), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_activity(INT, TEXT) TO authenticated;

/**
 * ★ הסטטיסטיקה שיוצאת מהיומן.
 *
 * לא "כמה שורות יש" — אלא שלוש שאלות שמנהל מוצר באמת שואל:
 *
 *   כמה הגישו היום · באיזו שעה מגישים · כמה מהם בוטים
 *
 * הפילוח לפי שעה הוא זה שקובע מתי לשלוח תזכורת, וזה המספר
 * היחיד כאן שמשנה החלטה.
 */
CREATE OR REPLACE FUNCTION game.admin_activity_stats(p_gw_code TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v JSONB;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  SELECT jsonb_build_object(
    'total',    count(*) FILTER (WHERE l.action IN ('submit','bot_submit')),
    'humans',   count(*) FILTER (WHERE l.action = 'submit'),
    'bots',     count(*) FILTER (WHERE l.action = 'bot_submit'),
    'withdraw', count(*) FILTER (WHERE l.action = 'withdraw'),
    'today',    count(*) FILTER (WHERE l.action IN ('submit','bot_submit')
                                   AND l.created_at >= date_trunc('day', now())),
    'five',     count(*) FILTER (WHERE l.action IN ('submit','bot_submit') AND l.mode = 'five'),
    'full',     count(*) FILTER (WHERE l.action IN ('submit','bot_submit') AND l.mode = 'full'),
    'byHour',   COALESCE((
      SELECT jsonb_agg(jsonb_build_object('hour', h, 'n', n) ORDER BY h)
      FROM (
        SELECT extract(hour FROM l2.created_at AT TIME ZONE 'Asia/Jerusalem')::INT AS h,
               count(*) AS n
        FROM game.activity_log l2
        WHERE l2.action IN ('submit','bot_submit')
          AND (p_gw_code IS NULL OR l2.gw_code = p_gw_code)
        GROUP BY 1
      ) hh), '[]'::jsonb)
  ) INTO v
  FROM game.activity_log l
  WHERE p_gw_code IS NULL OR l.gw_code = p_gw_code;

  RETURN COALESCE(v, '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_activity_stats(TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- §6 · הרשאות קריאה
-- ---------------------------------------------------------------------
GRANT SELECT ON game.activity_log TO authenticated;

UPDATE game.data_revision SET revision = revision + 1, scope = 'migration-16' WHERE id = 1;


-- =====================================================================
-- ▼▼▼  17_house_ads.sql  —  פרסום פנימי — מודעות, מדידה ולוח ניהול
-- =====================================================================

-- =====================================================================
--  Dubid · מיגרציה 17 — פרסום פנימי (House Ads)
-- =====================================================================
--
--  לחברה שלושה מוצרים על אותו דומיין: דוביד, טייק מי אאוט
--  ואופסיידס. המשתמש שנמצא באחד מהם הוא הקהל הכי זול והכי חם
--  שיש לשניים האחרים — אין עלות רכישה, והאמון כבר קיים.
--
--  המיגרציה הזו נותנת לאדמין שליטה מלאה על מה מוצג, איפה, מתי,
--  ובאיזה משקל — בלי לגעת בקוד.
--
--  ★★ העיקרון: המסד הוא override, לא מקור ★★
--
--  ברירות המחדל חיות בקוד (`lib/houseAds.ts`). טבלה ריקה =
--  בדיוק המוצר של היום. זו אותה החלטה כמו ב-`content` וב-
--  `scoring_rules`, ומאותה סיבה: מיגרציה שלא רצה, או מחיקה
--  בטעות, לא יכולה להשאיר מסך ריק.
--
--  אידמפוטנטי. אפשר להריץ שוב.
-- =====================================================================

SET search_path = game, core, public;

-- ---------------------------------------------------------------------
-- §1 · הטבלה
-- ---------------------------------------------------------------------
--
--  ★ `id` הוא TEXT ולא UUID.
--
--  המזהה נשמר באנליטיקס ומופיע בכתובת שאליה המשתמש לוחץ
--  (`?v=tmo-landed`). מזהה קריא הופך דוח קליקים למשהו שאפשר
--  להסתכל עליו בלי טבלת תרגום. הוא גם מה שמאפשר ל-DEFAULT_ADS
--  שבקוד ולשורות שבמסד לחלוק את אותם מזהים.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS game.house_ads (
  id           TEXT PRIMARY KEY,
  brand        TEXT NOT NULL CHECK (brand IN ('takemeout', 'offsides')),
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  weight       SMALLINT NOT NULL DEFAULT 5 CHECK (weight BETWEEN 1 AND 10),
  headline     TEXT NOT NULL CHECK (length(headline) BETWEEN 1 AND 60),
  body         TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 120),
  cta          TEXT NOT NULL DEFAULT 'להעיף מבט' CHECK (length(cta) BETWEEN 1 AND 24),
  url          TEXT NOT NULL CHECK (url ~ '^https://'),
  -- מערך ריק = בכל המסכים. זה הרוב, ולכן זו ברירת המחדל.
  placements   TEXT[] NOT NULL DEFAULT '{}',
  starts_at    TIMESTAMPTZ,
  ends_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ★ חלון הפוך נחסם במסד ולא רק בטופס.
  --   קמפיין עם תאריכים הפוכים פשוט לא היה מוצג לעולם, וזה
  --   סוג התקלה שמתגלה חודשיים אחרי שהקמפיין "רץ".
  CONSTRAINT house_ads_window CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

COMMENT ON TABLE game.house_ads IS
  'פרסום פנימי בין מוצרי דובל טים. ריק = ברירות המחדל שבקוד.';

ALTER TABLE game.house_ads ENABLE ROW LEVEL SECURITY;

-- ★ אין POLICY בכלל, בכוונה.
--   הגישה עוברת רק דרך הפונקציות שלמטה (SECURITY DEFINER).
--   טבלה עם RLS ובלי מדיניות היא סגורה לחלוטין לכל תפקיד שאינו
--   הבעלים — וזה בדיוק מה שאנחנו רוצים: קריאה מסוננת דרך
--   `house_ads()`, כתיבה רק דרך `admin_*`.

-- ---------------------------------------------------------------------
-- §2 · יומן החשיפות והקליקים
-- ---------------------------------------------------------------------
--
--  ★ למה טבלת אירועים ולא שני מונים על השורה.
--
--  מונה עונה על "כמה". טבלה עונה גם על "איפה", "מתי" ו"באיזה
--  מחזור" — ובלי הפילוח הזה אי אפשר לדעת אם מודעה עובדת בכל
--  מקום או רק בטבלת הדירוג. ההפרש בעלות זניח; ההפרש במידע הוא
--  ההבדל בין דוח לבין מספר.
--
--  ★ בלי מזהה משתמש. בכוונה.
--
--  אנחנו סופרים חשיפות וקליקים, לא אנשים. שמירת `user_id` כאן
--  הייתה הופכת יומן פרסום ליומן מעקב אחרי אנשים, ובשביל שום
--  שאלה שאנחנו באמת שואלים.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS game.ad_events (
  id         BIGSERIAL PRIMARY KEY,
  ad_id      TEXT NOT NULL,
  placement  TEXT NOT NULL,
  event      TEXT NOT NULL CHECK (event IN ('impression', 'click')),
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE game.ad_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS ad_events_ad_at_idx ON game.ad_events (ad_id, at DESC);
CREATE INDEX IF NOT EXISTS ad_events_at_idx    ON game.ad_events (at DESC);

-- ---------------------------------------------------------------------
-- §3 · קריאה ציבורית
-- ---------------------------------------------------------------------
--
--  ★ הסינון קורה **בשרת**.
--
--  מודעה מכובה או מודעה שחלון התצוגה שלה נגמר לא נשלחת לדפדפן
--  בכלל. סינון בקליינט היה אומר שכל קמפיין עתידי — כולל
--  הכותרות שלו — יושב ב-JSON שכל אחד יכול לפתוח.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.house_ads()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',         a.id,
           'brand',      a.brand,
           'enabled',    a.enabled,
           'weight',     a.weight,
           'headline',   a.headline,
           'body',       a.body,
           'cta',        a.cta,
           'url',        a.url,
           'placements', to_jsonb(a.placements),
           'startsAt',   a.starts_at,
           'endsAt',     a.ends_at
         ) ORDER BY a.id), '[]'::jsonb)
  FROM game.house_ads a
  WHERE a.enabled
    AND (a.starts_at IS NULL OR a.starts_at <= now())
    AND (a.ends_at   IS NULL OR a.ends_at   >  now());
$$;

GRANT EXECUTE ON FUNCTION game.house_ads() TO anon, authenticated;

-- ---------------------------------------------------------------------
-- §4 · מדידה
-- ---------------------------------------------------------------------
--
--  ★★ תקרה לכל מודעה בכל דקה — ולמה היא חייבת להיות כאן ★★
--
--  זו פונקציה שכל אנונימי יכול לקרוא לה. בלי תקרה, לולאה של
--  שלוש שורות ממלאת את הטבלה במיליוני שורות תוך דקות: גם חשבון
--  ענן שמתנפח, וגם — הגרוע יותר — דוח קליקים שמשקר, ולכן
--  החלטות שיווקיות שמתקבלות על סמך רעש.
--
--  התקרה היא **לכל מודעה ולכל דקה**, לא גלובלית: מודעה אחת
--  שמוצפת לא משתיקה את המדידה של השאר.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.ad_event(
  p_ad_id TEXT, p_placement TEXT, p_event TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE
  v_recent INT;
  -- 600 חשיפות לדקה למודעה זה הרבה מעל כל תנועה אמיתית שתהיה
  -- לנו, וזה עדיין חוסם הצפה בשלושה סדרי גודל.
  c_cap CONSTANT INT := 600;
BEGIN
  IF p_event NOT IN ('impression', 'click') THEN RETURN; END IF;
  IF p_ad_id IS NULL OR length(p_ad_id) > 64 THEN RETURN; END IF;

  SELECT count(*) INTO v_recent
  FROM game.ad_events
  WHERE ad_id = p_ad_id AND at > now() - INTERVAL '1 minute';

  IF v_recent >= c_cap THEN RETURN; END IF;

  INSERT INTO game.ad_events (ad_id, placement, event)
  VALUES (p_ad_id, COALESCE(NULLIF(left(p_placement, 32), ''), 'unknown'), p_event);
END;
$$;

GRANT EXECUTE ON FUNCTION game.ad_event(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- §5 · ניהול
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.admin_ads()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v JSONB;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  -- ★ האדמין רואה גם מכובות וגם כאלה שמחוץ לחלון — אחרת אי
  --   אפשר להדליק מודעה שכבויה, וזו הפעולה הכי שכיחה כאן.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',         a.id,
           'brand',      a.brand,
           'enabled',    a.enabled,
           'weight',     a.weight,
           'headline',   a.headline,
           'body',       a.body,
           'cta',        a.cta,
           'url',        a.url,
           'placements', to_jsonb(a.placements),
           'startsAt',   a.starts_at,
           'endsAt',     a.ends_at,
           'impressions', COALESCE(s.impressions, 0),
           'clicks',      COALESCE(s.clicks, 0)
         ) ORDER BY a.brand, a.id), '[]'::jsonb)
  INTO v
  FROM game.house_ads a
  LEFT JOIN (
    SELECT ad_id,
           count(*) FILTER (WHERE event = 'impression') AS impressions,
           count(*) FILTER (WHERE event = 'click')      AS clicks
    FROM game.ad_events
    GROUP BY ad_id
  ) s ON s.ad_id = a.id;

  RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_ads() TO authenticated;

CREATE OR REPLACE FUNCTION game.admin_upsert_ad(
  p_id TEXT, p_brand TEXT, p_headline TEXT, p_body TEXT, p_cta TEXT,
  p_url TEXT, p_weight INT DEFAULT 5, p_enabled BOOLEAN DEFAULT TRUE,
  p_placements TEXT[] DEFAULT '{}', p_starts_at TIMESTAMPTZ DEFAULT NULL,
  p_ends_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_id TEXT;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  -- ★ מזהה נורמלי, ולא מה שהוקלד.
  --   הוא מופיע בכתובת URL ובדוחות. רווח או עברית בתוך
  --   `?v=` הופכים כל דוח לבלגן של תווים מקודדים.
  -- ★★ `lower` **לפני** ה-regex, ולא אחריו. ★★
  --
  --   הסדר ההפוך נראה זהה והוא באג: המחלקה `[^a-z0-9-]` לא
  --   כוללת אותיות גדולות, ולכן היא מחליפה אותן במקף. "Test Ad"
  --   הפך ל-"est-d" — מזהה קצוץ, בלי שום שגיאה, שנכנס לכתובת
  --   ולדוחות ונשאר שם.
  v_id := regexp_replace(lower(COALESCE(NULLIF(trim(p_id), ''), gen_random_uuid()::TEXT)),
                         '[^a-z0-9-]+', '-', 'g');
  v_id := left(trim(BOTH '-' FROM v_id), 40);
  IF v_id = '' THEN RAISE EXCEPTION 'BAD_AD_ID'; END IF;

  INSERT INTO game.house_ads
    (id, brand, enabled, weight, headline, body, cta, url, placements, starts_at, ends_at)
  VALUES
    (v_id, p_brand, COALESCE(p_enabled, TRUE), COALESCE(p_weight, 5),
     trim(p_headline), COALESCE(trim(p_body), ''), COALESCE(NULLIF(trim(p_cta), ''), 'להעיף מבט'),
     trim(p_url), COALESCE(p_placements, '{}'), p_starts_at, p_ends_at)
  ON CONFLICT (id) DO UPDATE SET
    brand      = EXCLUDED.brand,
    enabled    = EXCLUDED.enabled,
    weight     = EXCLUDED.weight,
    headline   = EXCLUDED.headline,
    body       = EXCLUDED.body,
    cta        = EXCLUDED.cta,
    url        = EXCLUDED.url,
    placements = EXCLUDED.placements,
    starts_at  = EXCLUDED.starts_at,
    ends_at    = EXCLUDED.ends_at,
    updated_at = now();

  PERFORM game.log_activity(auth.uid(), 'ad_upsert', NULL, NULL, v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_upsert_ad(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, BOOLEAN, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ
) TO authenticated;

CREATE OR REPLACE FUNCTION game.admin_set_ad_enabled(p_id TEXT, p_enabled BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  UPDATE game.house_ads SET enabled = p_enabled, updated_at = now() WHERE id = p_id;
  PERFORM game.log_activity(
    auth.uid(), CASE WHEN p_enabled THEN 'ad_on' ELSE 'ad_off' END, NULL, NULL, p_id);
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_set_ad_enabled(TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION game.admin_delete_ad(p_id TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  DELETE FROM game.house_ads WHERE id = p_id;

  -- ★ האירועים **לא** נמחקים.
  --   דוח של רבעון שעבר לא אמור להשתנות כי מודעה נמחקה היום.
  --   מחיקה שמשכתבת היסטוריה היא מחיקה שאי אפשר לסמוך על
  --   המספרים שאחריה.
  PERFORM game.log_activity(auth.uid(), 'ad_delete', NULL, NULL, p_id);
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_delete_ad(TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- §6 · דוח ביצועים
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.admin_ad_stats(p_days INT DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v JSONB; v_since TIMESTAMPTZ;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  v_since := now() - (GREATEST(1, LEAST(365, COALESCE(p_days, 30))) || ' days')::INTERVAL;

  SELECT jsonb_build_object(
    'days', GREATEST(1, LEAST(365, COALESCE(p_days, 30))),
    'impressions', COALESCE(count(*) FILTER (WHERE event = 'impression'), 0),
    'clicks',      COALESCE(count(*) FILTER (WHERE event = 'click'), 0),
    'byPlacement', COALESCE((
      SELECT jsonb_agg(x ORDER BY x->>'placement')
      FROM (
        SELECT jsonb_build_object(
                 'placement', placement,
                 'impressions', count(*) FILTER (WHERE event = 'impression'),
                 'clicks',      count(*) FILTER (WHERE event = 'click')
               ) AS x
        FROM game.ad_events WHERE at >= v_since
        GROUP BY placement
      ) t), '[]'::jsonb)
  ) INTO v
  FROM game.ad_events WHERE at >= v_since;

  RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_ad_stats(INT) TO authenticated;

-- ---------------------------------------------------------------------
-- §7 · זרעים
-- ---------------------------------------------------------------------
--
--  ★ `ON CONFLICT DO NOTHING`, ולא `DO UPDATE`.
--
--  אם האדמין ערך את הכותרת של מודעת ברירת המחדל, הרצה חוזרת של
--  המיגרציה **לא** תדרוס אותה. מיגרציה אידמפוטנטית שמשחזרת
--  טקסט שיווקי היא מיגרציה שמוחקת עבודה.
-- ---------------------------------------------------------------------

INSERT INTO game.house_ads (id, brand, weight, headline, body, cta, url) VALUES
  ('tmo-landed', 'takemeout', 5,
   'נחתתם בעיר זרה. עכשיו מה?',
   'מה לראות, מה לאכול ומה לדלג עליו — בעיר שאתם לא מכירים.',
   'לבחור עיר', 'https://takemeout.dubelteam.com'),
  ('tmo-locals', 'takemeout', 4,
   'התייר רואה חמישה מקומות. המקומי יודע חמישים',
   'אתונה, ברלין, פריז, סופיה — הרשימה שהמקומיים היו נותנים.',
   'לפתוח את הרשימה', 'https://takemeout.dubelteam.com'),
  ('ofs-live', 'offsides', 5,
   'כאן מחכים שבוע. שם — תשעים דקות',
   'אותם משחקים, ניחושים בזמן אמת, זירות מול החברים שלכם.',
   'להיכנס לזירה', 'https://offsides.dubelteam.com'),
  ('ofs-account', 'offsides', 4,
   'אותו חשבון. בלי הרשמה מחדש',
   'המוצר השני שלנו, על אותם משחקים — נכנסים ומתחילים.',
   'להעיף מבט', 'https://offsides.dubelteam.com')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- §8 · מונה הגרסה
-- ---------------------------------------------------------------------
--  כל שאר המסכים כבר מקשיבים לו; מודעה חדשה מגיעה לכל המכשירים
--  באותו מנגנון בדיוק, בלי ערוץ שני.
-- ---------------------------------------------------------------------

UPDATE game.data_revision
   SET revision = revision + 1, scope = 'migration-17', updated_at = now()
 WHERE id = 1;


-- =====================================================================
-- ▼▼▼  18_hardening.sql  —  ★ הקשחה — סגירת הגישה הישירה לטבלאות, RLS, קצב, ביקורת
-- =====================================================================

-- =====================================================================
--  Dubid · מיגרציה 18 — הקשחה (PHASE 2)
-- =====================================================================
--
--  ═══════════════════════════════════════════════════════════════
--  ★★★ החור שהמיגרציה הזו סוגרת ★★★
--  ═══════════════════════════════════════════════════════════════
--
--  `db/07` מריצה, לכל אחת מהסכימות `core` ו-`game`:
--
--      GRANT ALL ON ALL TABLES ... TO anon, authenticated;
--      ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES
--                                   TO anon, authenticated;
--
--  `db/09` שוללת אחר כך `INSERT, UPDATE, DELETE` — אבל **רק על
--  הטבלאות שקיימות באותו רגע**. השורה השנייה, `ALTER DEFAULT
--  PRIVILEGES`, ממשיכה לחיות: כל טבלה שנוצרת אחר כך נולדת עם
--  `GRANT ALL` לאנונימי.
--
--  התוצאה בפועל, במסד שרץ היום:
--
--    · `game.scoring_overrides` — **כל אנונימי יכול לשכתב את
--      חוקי הניקוד של המשחק**, ישירות דרך PostgREST, בלי לעבור
--      דרך `admin_set_rule` ובלי לעבור את `is_admin()`.
--    · `game.mode_config`      — התקציב וגודל ההרכב, שמהם
--      `submit_entry` קורא. כלומר גם בדיקת התקציב בשרת שווה
--      בדיוק כמו הטבלה שהיא קוראת ממנה.
--    · `game.activity_log`     — יומן שאפשר למחוק ולזייף.
--    · `game.scoring_history`  — שובל הביקורת של שינויי הניקוד.
--
--  זה מבטל את כל שכבת ההגנה של 37 פונקציות `admin_*` שכל אחת
--  מהן בודקת `is_admin()` בשורה הראשונה. השער נעול והקיר פתוח.
--
--  ═══════════════════════════════════════════════════════════════
--  ★ העמדה החדשה: הכל עובר דרך פונקציות
--  ═══════════════════════════════════════════════════════════════
--
--  הקליינט לא קורא **אף טבלה** ישירות — אימתנו: אין ולו קריאת
--  `.from()` אחת בכל `src/`. הכל עובר דרך RPC-ים של
--  `SECURITY DEFINER`, שכל אחד מהם מחליט בעצמו מה לחשוף.
--
--  לכן העמדה הנכונה היא הפוכה מזו של `db/07`: **אפס גישה ישירה
--  לטבלאות**, והפונקציות הן הממשק היחיד. זה גם מה שהופך את
--  הבדיקה "האם X חשוף" לשאלה עם תשובה אחת במקום 40.
--
--  אידמפוטנטי. אפשר להריץ שוב.
-- =====================================================================

SET search_path = game, core, public;

-- ---------------------------------------------------------------------
-- §1 · ביטול ברירות המחדל שממשיכות להעניק הרשאות
-- ---------------------------------------------------------------------
--
--  ★ זה השלב שבלעדיו כל השאר זמני.
--
--  בלי ביטול `ALTER DEFAULT PRIVILEGES`, כל טבלה שתיווצר
--  במיגרציה 19 ואילך תיוולד שוב פתוחה — והתיקון הזה היה נכון
--  ליום אחד.
-- ---------------------------------------------------------------------

DO $$
DECLARE s TEXT;
BEGIN
  FOREACH s IN ARRAY ARRAY['core', 'game'] LOOP
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA %I
         REVOKE ALL ON TABLES FROM anon, authenticated', s);
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA %I
         REVOKE ALL ON SEQUENCES FROM anon, authenticated', s);

    -- ★ ROUTINES נשארות: זו בדיוק הדרך שבה הקליינט **כן** אמור
    --   לעבוד. פונקציה בלי GRANT EXECUTE אינה קיימת עבורו.
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- §2 · שלילת גישה ישירה לטבלאות — הפעם על מה שקיים באמת
-- ---------------------------------------------------------------------

DO $$
BEGIN
  -- כתיבה: לאף אחד, בשום טבלה, בשתי הסכימות.
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE
    ON ALL TABLES IN SCHEMA game FROM anon, authenticated;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE
    ON ALL TABLES IN SCHEMA core FROM anon, authenticated;

  -- ★ גם קריאה. ראו את ההסבר בראש הקובץ: אין `.from()` בקליינט,
  --   ולכן `SELECT` ישיר הוא לא "נוחות" אלא רק משטח תקיפה.
  --
  --   מה שכן נשאר קריא נקבע מיד אחר כך, במפורש, טבלה-טבלה.
  REVOKE SELECT ON ALL TABLES IN SCHEMA game FROM anon, authenticated;
  REVOKE SELECT ON ALL TABLES IN SCHEMA core FROM anon, authenticated;
END $$;

-- ---------------------------------------------------------------------
-- §3 · RLS על כל טבלה בשתי הסכימות
-- ---------------------------------------------------------------------
--
--  ★ חגורה **וגם** כתפיות, ובכוונה.
--
--  §2 כבר שלל את ההרשאות, ובלי הרשאה אין גישה גם בלי RLS. אז
--  למה בכל זאת RLS על הכל?
--
--  כי `GRANT` הוא פעולה חד־פעמית ו-RLS הוא מאפיין של הטבלה. אם
--  מישהו יריץ בעתיד `GRANT SELECT` בשביל דיבוג ויישכח — RLS
--  היא מה שיעמוד שם. הגנה בשכבה אחת היא הגנה שנשענת על כך
--  שאף אחד לא יטעה פעם אחת.
-- ---------------------------------------------------------------------

DO $$
DECLARE r RECORD; n INT := 0;
BEGIN
  FOR r IN
    SELECT c.relname, n2.nspname
    FROM pg_class c
    JOIN pg_namespace n2 ON n2.oid = c.relnamespace
    WHERE n2.nspname IN ('game', 'core')
      AND c.relkind = 'r'
      AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.nspname, r.relname);
    n := n + 1;
  END LOOP;
  IF n > 0 THEN RAISE NOTICE 'RLS הופעלה על % טבלאות', n; END IF;
END $$;

-- ---------------------------------------------------------------------
-- §4 · טבלת גרסאות מיגרציה
-- ---------------------------------------------------------------------
--
--  ★ מה זה פותר, ומה זה **לא** פותר.
--
--  פותר: "מה רץ על המסד הזה?" — שאלה שעד עכשיו לא הייתה לה
--  תשובה, והדרך היחידה לענות עליה הייתה לחפש טבלה ולנחש.
--
--  לא פותר: זו לא מערכת מיגרציות. הקבצים נשארים אידמפוטנטיים
--  ונשארים ניתנים להרצה חוזרת — וזו תכונה, לא חוב: מסד שנתקע
--  באמצע נפתר בהרצה נוספת ולא בשחזור מגיבוי.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS game.schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note       TEXT
);

ALTER TABLE game.schema_migrations ENABLE ROW LEVEL SECURITY;

INSERT INTO game.schema_migrations (version, note) VALUES
  ('01', 'ליבה'),                      ('02', 'קפטן וניקוד'),
  ('03', 'סגלים'),                     ('04', 'לוג ודירוג'),
  ('05', 'נעילה'),                     ('06', 'זירות'),
  ('07', 'הרשאות'),                    ('09', 'הגשות ותוצאות'),
  ('10', 'חשבונות'),                   ('11', 'זירות בשרת'),
  ('12', 'כניסת אדמין'),               ('13', 'דאטה חיה'),
  ('14', 'לוח ניהול'),                 ('15', 'שמות קבוצות'),
  ('16', 'בוטים ויומן'),               ('17', 'פרסום פנימי'),
  ('18', 'הקשחה')
ON CONFLICT (version) DO NOTHING;

CREATE OR REPLACE FUNCTION game.admin_schema_state()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v JSONB;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  SELECT jsonb_agg(jsonb_build_object(
           'version', version, 'note', note,
           'appliedAt', to_char(applied_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
         ORDER BY version)
    INTO v FROM game.schema_migrations;
  RETURN COALESCE(v, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_schema_state() TO authenticated;

-- ---------------------------------------------------------------------
-- §5 · הגבלת קצב לנקודות הקצה שאפשר למנות עליהן
-- ---------------------------------------------------------------------
--
--  ★★ מה באמת אפשר למנות כאן ★★
--
--  שתי פונקציות אנונימיות הן **אורקל**: הן עונות כן/לא על ניחוש,
--  ולכן אפשר להריץ עליהן רשימה.
--
--    · `league_by_code` — קוד זירה בן שש. מי שמונה אותו נכנס
--      לזירות פרטיות של אנשים אחרים.
--    · `username_available` — מגלה אילו שמות משתמש תפוסים,
--      כלומר מי רשום במערכת.
--
--  ★ למה טבלה ולא משתנה בזיכרון: PostgREST רץ בכמה תהליכים,
--    ומונה בזיכרון היה נספר בנפרד בכל אחד מהם.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS game.probe_attempts (
  bucket   TEXT NOT NULL,
  actor    TEXT NOT NULL,
  at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE game.probe_attempts ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS probe_attempts_idx ON game.probe_attempts (bucket, actor, at DESC);

/**
 * מחזירה TRUE אם מותר להמשיך, ורושמת את הניסיון.
 *
 * ★ הזהות היא `auth.uid()` כשיש, ואחרת "אנונימי כללי".
 *   `signInAnonymously` נותן uid חדש בחינם, ולכן uid לבדו אינו
 *   מפתח מספיק — הדלי הכללי הוא מה שתופס תוקף שממחזר סשנים.
 *   הוא רחב יותר בכוונה: הוא לא אמור להפריע לשימוש אמיתי.
 */
CREATE OR REPLACE FUNCTION game.rate_ok(
  p_bucket TEXT, p_limit INT, p_window INTERVAL
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_actor TEXT; v_n INT;
BEGIN
  v_actor := COALESCE(auth.uid()::TEXT, 'anon');

  DELETE FROM game.probe_attempts WHERE at < now() - INTERVAL '1 hour';

  SELECT count(*) INTO v_n
  FROM game.probe_attempts
  WHERE bucket = p_bucket AND actor = v_actor AND at > now() - p_window;

  INSERT INTO game.probe_attempts (bucket, actor) VALUES (p_bucket, v_actor);

  RETURN v_n < p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION game.rate_ok(TEXT, INT, INTERVAL) TO anon, authenticated;

/**
 * ★ שתי הפונקציות נכתבות מחדש כאן, ולא במקום שבו הן נולדו.
 *
 * שתיהן היו `LANGUAGE sql STABLE`, ופונקציה STABLE אינה יכולה
 * לקרוא ל-`rate_ok` — שכותבת. שינוי במקום המקורי היה מפזר את
 * ההקשחה על פני שלושה קבצים; כאן היא נקראת ברצף אחד.
 *
 * ★★ ההתנהגות תחת חסימה: תשובה "שלילית", לא שגיאה. ★★
 *
 * `league_by_code` מחזירה NULL — בדיוק כמו קוד שלא קיים.
 * `username_available` מחזירה FALSE — בדיוק כמו שם תפוס.
 *
 * זו לא עצלנות אלא ההחלטה הנכונה: הודעת "יותר מדי ניסיונות"
 * מאשרת לתוקף שהוא מתקרב למשהו ומאפשרת לו לכייל קצב. תשובה
 * שנראית כמו "לא מצאתי" לא מלמדת אותו כלום.
 *
 * המחיר: משתמש אמיתי שיקליד שישים קודים בדקה יקבל "לא נמצא"
 * על קוד תקין. זה תרחיש שלא קורה — ובכל מקרה עדיף על אורקל
 * פתוח.
 */
CREATE OR REPLACE FUNCTION game.league_by_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public AS $$
DECLARE v JSONB;
BEGIN
  -- 30 ניחושים בדקה. הצטרפות אמיתית היא קוד אחד או שניים.
  IF NOT game.rate_ok('league_code', 30, INTERVAL '1 minute') THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'name',       l.name,
    'mode',       l.mode,
    'kind',       l.kind,
    'status',     l.status,
    'members',    (SELECT count(*) FROM game.league_members WHERE league_id = l.id),
    'maxMembers', l.max_members
  ) INTO v
  FROM game.leagues l
  WHERE l.code = upper(btrim(p_code));

  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION game.league_by_code(TEXT) TO anon, authenticated;

/**
 * ★★ ניסיונות פדיון של קוד גישה ★★
 *
 * הבאג: ב-`access-code` הוגדר `MAX_ATTEMPTS = 8`, השדה `attempts`
 * נקרא — ו**מעולם לא הוגדל**. כלומר לא הייתה שום הגנה על פדיון.
 *
 * ★ ולמה מונה על השורה לא היה עוזר גם אילו כן היה מוגדל.
 *
 * קוד שגוי לא מתאים לאף שורה. אין מה להגדיל. תוקף שמנחש קודים
 * בני שש (≈30 ביט) לא נוגע באף שורה קיימת עד שהוא פוגע —
 * והמונה "לכל קוד" סופר בדיוק את מי שכבר הצליח.
 *
 * לכן המונה חייב להיות על **המנחש** ולא על הקוד, והזהות שלו
 * מגיעה מפונקציית הקצה (גיבוב של כתובת ה-IP). היא רצה
 * ב-service_role, ולכן היא זו שמעבירה את הזהות — אין דרך
 * לזייף אותה מהדפדפן.
 */
CREATE OR REPLACE FUNCTION game.code_attempt_ok(p_actor TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_n INT; v_actor TEXT;
BEGIN
  v_actor := left(COALESCE(NULLIF(btrim(p_actor), ''), 'unknown'), 64);

  DELETE FROM game.probe_attempts WHERE at < now() - INTERVAL '1 hour';

  SELECT count(*) INTO v_n
  FROM game.probe_attempts
  WHERE bucket = 'access_code' AND actor = v_actor AND at > now() - INTERVAL '15 minutes';

  INSERT INTO game.probe_attempts (bucket, actor) VALUES ('access_code', v_actor);

  -- ★ עשרה ברבע שעה. שחזור חשבון אמיתי הוא ניסיון אחד או שניים;
  --   מי שמנסה עשרה בהצלחה נמוכה כזו אינו מקליד מהזיכרון.
  RETURN v_n < 10;
END;
$$;

-- ★ רק service_role. הדפדפן לא יכול לקרוא לזה, ולכן גם לא יכול
--   לשרוף לעצמו את המכסה או לזייף זהות של מישהו אחר.
REVOKE ALL ON FUNCTION game.code_attempt_ok(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION game.code_attempt_ok(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION game.username_available(p_username TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public AS $$
BEGIN
  -- ★ הבדיקות הזולות **לפני** מונה הקצב.
  --   טופס הרשמה בודק זמינות בכל הקלדה. אילו כל תו היה נספר,
  --   משתמש אמיתי אחד היה נחסם תוך חצי דקה של הקלדה.
  IF btrim(COALESCE(p_username, '')) = '' THEN RETURN FALSE; END IF;
  IF length(btrim(p_username)) < 3 THEN RETURN FALSE; END IF;

  IF NOT game.rate_ok('username', 120, INTERVAL '1 minute') THEN
    RETURN FALSE;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1 FROM game.users WHERE username = btrim(p_username)::CITEXT
  );
END;
$$;
GRANT EXECUTE ON FUNCTION game.username_available(TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- §6 · שובל ביקורת לפעולות שחסרו בו
-- ---------------------------------------------------------------------
--
--  ★ הפעולה שהכי חשוב לתעד היא זו שהכי קל להכחיש.
--
--  `admin_upsert_player_stat` כותבת את הדקות, השערים והבישולים
--  שמהם נגזר **כל** הניקוד של כולם. היא הייתה הפעולה היחידה
--  במוצר שמשנה תוצאות ולא משאירה שורה בשום יומן. אם מישהו
--  יטען שהניקוד שלו שונה בדיעבד, עד עכשיו לא הייתה דרך לענות.
-- ---------------------------------------------------------------------

/**
 * ★★ הרישום נעשה בטריגר על הטבלה, ולא בתוך הפונקציות ★★
 *
 * הדרך המתבקשת הייתה להוסיף `INSERT INTO audit_logs` לתוך
 * `admin_upsert_player_stat`, `admin_set_rule`, `admin_clear_rule`,
 * `admin_delete_content` ו-`admin_resync_deadline` — חמישה
 * עריכות בשלושה קבצים.
 *
 * טריגר על הטבלה עדיף משלוש סיבות:
 *
 *   · הוא תופס **כל** נתיב כתיבה, כולל UPDATE ידני מה-SQL
 *     Editor — וזה בדיוק הנתיב שהכי חשוב לתעד.
 *   · הוא לא יכול להישכח בפונקציה הבאה שתיכתב.
 *   · הוא לא נוגע בקוד שכבר עובד ונבדק.
 */
CREATE OR REPLACE FUNCTION game.audit_row()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
BEGIN
  -- ★ כישלון ברישום לא מבטל את הפעולה. אדמין שלא יכול לפרסם
  --   תוצאות כי היומן נכשל הוא תקלה גרועה יותר משורה חסרה.
  BEGIN
    INSERT INTO game.audit_logs (actor, entity, entity_id, action, old_value, new_value)
    VALUES (
      COALESCE(auth.uid()::TEXT, 'system'),
      TG_TABLE_NAME,
      CASE
        WHEN TG_OP = 'DELETE' THEN COALESCE(to_jsonb(OLD)->>'id', to_jsonb(OLD)->>'key')
        ELSE COALESCE(to_jsonb(NEW)->>'id', to_jsonb(NEW)->>'key')
      END,
      lower(TG_OP),
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
      CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

/**
 * הטבלאות שכל שינוי בהן חייב להשאיר עקבות.
 *
 * ★ הרשימה קצרה בכוונה: הן הטבלאות שמשנות **תוצאה או חוק**.
 *   טריגר על כל טבלה היה מייצר יומן שאי אפשר לקרוא, וזה בדיוק
 *   כמו לא לתעד בכלל.
 */
DO $$
DECLARE t TEXT; sch TEXT; tbl TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'core.player_match_stats',   -- הדקות והשערים שמהם נגזר כל הניקוד
    'core.weekly_matches',       -- תוצאות המשחקים
    'game.scoring_overrides',    -- חוקי הניקוד החיים
    'game.gameweeks'             -- דדליינים וסטטוס
  ] LOOP
    sch := split_part(t, '.', 1);
    tbl := split_part(t, '.', 2);

    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = sch AND c.relname = tbl) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_%s ON %I.%I', tbl, sch, tbl);
      EXECUTE format(
        'CREATE TRIGGER audit_%s AFTER INSERT OR UPDATE OR DELETE ON %I.%I
           FOR EACH ROW EXECUTE FUNCTION game.audit_row()', tbl, sch, tbl);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- §7 · אימות
-- ---------------------------------------------------------------------
--
--  ★ הבדיקה רצה כאן, בסוף המיגרציה, ולא רק בחבילת הבדיקות.
--
--  מי שמריץ את הקובץ הזה ב-SQL Editor של פרודקשן לא מריץ אחר
--  כך `db/tests`. הוא צריך לראות במו עיניו שהחור נסגר — ולכן
--  ההודעה הזו היא חלק מהמיגרציה.
-- ---------------------------------------------------------------------

DO $$
DECLARE v_open INT; v_norls INT;
BEGIN
  SELECT count(*) INTO v_open
  FROM information_schema.role_table_grants
  WHERE table_schema IN ('game', 'core')
    AND grantee IN ('anon', 'authenticated')
    AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');

  SELECT count(*) INTO v_norls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('game', 'core') AND c.relkind = 'r' AND NOT c.relrowsecurity;

  IF v_open > 0 THEN
    RAISE EXCEPTION 'הקשחה נכשלה: עדיין % הרשאות כתיבה ישירות', v_open;
  END IF;
  IF v_norls > 0 THEN
    RAISE EXCEPTION 'הקשחה נכשלה: % טבלאות בלי RLS', v_norls;
  END IF;

  RAISE NOTICE '✓ הקשחה: אפס כתיבה ישירה, אפס טבלאות בלי RLS';
END $$;

UPDATE game.data_revision
   SET revision = revision + 1, scope = 'migration-18', updated_at = now()
 WHERE id = 1;


-- =====================================================================
-- ▼▼▼  19_guest_pass.sql  —  כרטיס המנוי של האורח, לכידת לידים, ומשפך
-- =====================================================================

-- =====================================================================
--  Dubid · מיגרציה 19 — כרטיס המנוי של האורח, ולכידת לידים
-- =====================================================================
--
--  ═══════════════════════════════════════════════════════════════
--  ★★★ הבעיה: זהות שאין לה מפתח ★★★
--  ═══════════════════════════════════════════════════════════════
--
--  אורח בדוביד הוא זהות מלאה — הוא בונה הרכב, מדורג, ומופיע
--  בטבלה. אבל הזהות הזו חיה **בדפדפן אחד**. מי שניקה היסטוריה,
--  החליף טלפון, או פתח בגלישה פרטית — איבד הכל, ובצדק חושב
--  שהמערכת מחקה לו את הקבוצה.
--
--  היה כבר פתרון: `access_codes` — קוד בן שש, חד־פעמי, שעה.
--  והוא **לא מתאים למה שהמשתמש באמת צריך**.
--
--  ★ למה שעה זה לא "קצת מדי" אלא הבעיה כולה
--
--  המשתמש ביקש לשמור תמונה עם הקוד ולשלוח אותה לעצמו בוואטסאפ.
--  זו לא בקשה קטנה — זו הגדרה של **מפתח**: משהו ששוכב בגלריה
--  ועובד כשצריך אותו, בעוד שבוע או בעוד חודשיים. קוד שפג אחרי
--  שעה בתמונה שמורה הוא לא מפתח; הוא צילום מסך של דלת נעולה.
--
--  ═══════════════════════════════════════════════════════════════
--  ★ שני סוגים באותה טבלה, ולא טבלה שנייה
--  ═══════════════════════════════════════════════════════════════
--
--    transfer  קוד בן 6, חד־פעמי, שעה.   "תעביר אותי עכשיו לטלפון"
--    pass      מפתח בן 10, חוזר, קבוע.   "זה הכרטיס שלי"
--
--  שניהם עוברים באותו נתיב פדיון, אותה טבלה, אותו hash. טבלה
--  שנייה הייתה מכפילה את לוגיקת הפדיון — ולוגיקת פדיון כפולה
--  היא הדרך הבטוחה לכך שתיקון אבטחה יגיע רק לאחת מהן.
--
--  ★★ ואיך מפתח קבוע נשאר בטוח ★★
--
--  קוד בן 6 מאלפבית של 32 = 30 ביט. זה מספיק כשהוא חי שעה, וזה
--  לא מספיק כשהוא חי לנצח.
--
--  לכן המפתח הוא בן **10** תווים = 50 ביט. עם המכסה שכבר קיימת
--  (`game.code_attempt_ok`, עשרה ניסיונות לרבע שעה לכל מנחש)
--  ניחוש של 50 ביט לוקח בערך פי מיליארד מגיל היקום. מה שהופך
--  אותו לבטוח זה לא האורך לבדו אלא **האורך כפול המכסה**.
--
--  אידמפוטנטי. אפשר להריץ שוב.
-- =====================================================================

SET search_path = game, core, public;

-- ---------------------------------------------------------------------
-- §1 · הרחבת הטבלה הקיימת
-- ---------------------------------------------------------------------

ALTER TABLE game.access_codes
  ADD COLUMN IF NOT EXISTS kind         TEXT NOT NULL DEFAULT 'transfer',
  ADD COLUMN IF NOT EXISTS uses         INT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_at   TIMESTAMPTZ;

-- ★ `expires_at` הופך לאופציונלי: מפתח קבוע אינו פג.
--   ה-CHECK מוודא שרק `pass` רשאי להיות בלי תפוגה — קוד העברה
--   בלי תפוגה הוא בדיוק הבאג שהעמודה הזו קיימת כדי למנוע.
DO $$
BEGIN
  ALTER TABLE game.access_codes ALTER COLUMN expires_at DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE game.access_codes DROP CONSTRAINT IF EXISTS access_codes_kind_ck;
  ALTER TABLE game.access_codes ADD CONSTRAINT access_codes_kind_ck
    CHECK (kind IN ('transfer', 'pass')
           AND (kind = 'pass' OR expires_at IS NOT NULL));
END $$;

-- ★★ מפתח פעיל אחד לכל משתמש ★★
--
--   בלי האילוץ הזה, כל לחיצה על "הראה לי את הכרטיס" הייתה
--   מייצרת מפתח נוסף — והמשתמש היה מחזיק בגלריה חמש תמונות עם
--   חמישה מפתחות שכולם עובדים. זה גם בלגן וגם משטח תקיפה
--   שגדל בכל ביקור.
CREATE UNIQUE INDEX IF NOT EXISTS access_codes_one_pass
  ON game.access_codes (user_id)
  WHERE kind = 'pass' AND revoked_at IS NULL;

COMMENT ON COLUMN game.access_codes.kind IS
  'transfer = קוד חד־פעמי לשעה. pass = מפתח הכניסה הקבוע.';

-- ---------------------------------------------------------------------
-- §2 · מי מחזיק מפתח, ומתי השתמש בו
-- ---------------------------------------------------------------------
--
--  ★ הפונקציה הזו לא מחזירה את המפתח, ולא יכולה.
--
--  במסד יושב רק ה-hash. זו לא מגבלה אלא ההחלטה: מי שמשיג גישה
--  לטבלה לא יכול להתחזות לאף אחד. המשתמש מקבל את המפתח פעם
--  אחת, ברגע ההנפקה, מפונקציית הקצה — ואם איבד אותו, מנפיקים
--  חדש. בדיוק כמו סיסמה.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.my_pass_state()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('has', FALSE); END IF;

  SELECT created_at, last_used_at, uses INTO v
  FROM game.access_codes
  WHERE user_id = auth.uid() AND kind = 'pass' AND revoked_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN RETURN jsonb_build_object('has', FALSE); END IF;

  RETURN jsonb_build_object(
    'has', TRUE,
    'createdAt', to_char(v.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'lastUsedAt', CASE WHEN v.last_used_at IS NULL THEN NULL ELSE
      to_char(v.last_used_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END,
    'uses', v.uses
  );
END;
$$;

GRANT EXECUTE ON FUNCTION game.my_pass_state() TO authenticated;

-- ---------------------------------------------------------------------
-- §3 · לכידת לידים
-- ---------------------------------------------------------------------
--
--  ═══════════════════════════════════════════════════════════════
--  ★★ מה מותר לתפוס, ומה זה עושה למוצר ★★
--  ═══════════════════════════════════════════════════════════════
--
--  הבקשה הייתה "מערכת לכידת לידים שהמשתמש לא ירגיש שהוא על
--  החכה". יש רק דרך אחת אחת לעשות את זה, והיא לא ניסוח חכם:
--  **שהוא באמת לא יהיה על החכה.**
--
--  לכן שלושה כללים שהטבלה הזו אוכפת:
--
--   1. **הסכמה מפורשת נשמרת כשדה.** לא "המשך = הסכמת". אם
--      `consent = FALSE`, השורה קיימת לצורך המשלוח שהמשתמש
--      ביקש ותו לא.
--
--   2. **המקור נשמר.** `source` אומר באיזה מסך זה נלכד. בלי זה
--      אי אפשר לדעת איזו נקודה מייצרת לידים שמתחרטים.
--
--   3. **מחיקה היא פעולה של המשתמש, לא בקשה לתמיכה.**
--      `game.forget_me()` מוחקת את הליד. חוק — וגם הדבר היחיד
--      שהופך "השארתי מייל" להחלטה הפיכה, ולכן קלה.
--
--  ★ מה **לא** נשמר כאן: שום דבר שהמשתמש לא הקליד בעצמו. אין
--    IP, אין user-agent, אין טביעת אצבע של דפדפן.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS game.leads (
  user_id     UUID PRIMARY KEY REFERENCES game.users(id) ON DELETE CASCADE,
  email       CITEXT,
  phone       TEXT,
  /** האם הסכים לקבל תזכורות. FALSE = רק מה שביקש עכשיו. */
  consent     BOOLEAN NOT NULL DEFAULT FALSE,
  /** באיזה מסך נלכד. 'pass' | 'nudge' | 'result' | 'account' */
  source      TEXT NOT NULL DEFAULT 'unknown',
  gw_code     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT leads_has_contact CHECK (email IS NOT NULL OR phone IS NOT NULL),
  CONSTRAINT leads_email_shape CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

ALTER TABLE game.leads ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS leads_created_idx ON game.leads (created_at DESC);

/**
 * שומר ליד.
 *
 * ★ `ON CONFLICT DO UPDATE` ולא שורה חדשה: המשתמש הוא המפתח.
 *   אדם שהקליד מייל פעמיים הוא ליד אחד ששינה דעתו, לא שניים.
 */
CREATE OR REPLACE FUNCTION game.capture_lead(
  p_email TEXT, p_consent BOOLEAN DEFAULT FALSE,
  p_source TEXT DEFAULT 'unknown', p_gw TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_email CITEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  v_email := NULLIF(btrim(lower(p_email)), '')::CITEXT;
  IF v_email IS NULL THEN RAISE EXCEPTION 'EMAIL_REQUIRED'; END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'EMAIL_INVALID'; END IF;

  -- ★ מכסה: זו פונקציה שכל משתמש מחובר יכול לקרוא לה, וקל
  --   להשיג `authenticated` (`signInAnonymously` הוא חינם).
  IF NOT game.rate_ok('lead', 5, INTERVAL '10 minutes') THEN
    RAISE EXCEPTION 'TOO_MANY_ATTEMPTS';
  END IF;

  INSERT INTO game.leads (user_id, email, consent, source, gw_code)
  VALUES (auth.uid(), v_email, COALESCE(p_consent, FALSE),
          COALESCE(NULLIF(left(p_source, 24), ''), 'unknown'), p_gw)
  ON CONFLICT (user_id) DO UPDATE SET
    email      = EXCLUDED.email,
    consent    = EXCLUDED.consent,
    source     = EXCLUDED.source,
    gw_code    = COALESCE(EXCLUDED.gw_code, game.leads.gw_code),
    updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION game.capture_lead(TEXT, BOOLEAN, TEXT, TEXT) TO authenticated;

/**
 * ★ "תשכחו אותי" — פעולה של המשתמש, לא פנייה לתמיכה.
 *
 * זה מה שהופך את השארת המייל להחלטה **הפיכה**. החלטה הפיכה
 * מתקבלת בקלות, והיא גם ההבדל בין מוצר שאוסף לבין מוצר שלוכד.
 */
CREATE OR REPLACE FUNCTION game.forget_me()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  DELETE FROM game.leads WHERE user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION game.forget_me() TO authenticated;

/** מה נשמר עליי. מוצג במסך החשבון, בלי שצריך לבקש. */
CREATE OR REPLACE FUNCTION game.my_lead()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
  SELECT COALESCE((
    SELECT jsonb_build_object('email', l.email, 'consent', l.consent)
    FROM game.leads l WHERE l.user_id = auth.uid()
  ), jsonb_build_object('email', NULL, 'consent', FALSE));
$$;

GRANT EXECUTE ON FUNCTION game.my_lead() TO authenticated;

-- ---------------------------------------------------------------------
-- §4 · הצד של האדמין
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.admin_leads(p_limit INT DEFAULT 200)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v JSONB;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'at' DESC), '[]'::jsonb) INTO v
  FROM (
    SELECT jsonb_build_object(
      'email',   l.email,
      'consent', l.consent,
      'source',  l.source,
      'gw',      l.gw_code,
      'name',    COALESCE(NULLIF(btrim(u.display_name), ''), 'אורח'),
      'isGuest', COALESCE(u.is_guest, TRUE),
      'entries', (SELECT count(*) FROM game.user_lineups ul
                   WHERE ul.user_id = l.user_id AND ul.status <> 'draft'),
      'at',      to_char(l.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ) AS x
    FROM game.leads l
    LEFT JOIN game.users u ON u.id = l.user_id
    ORDER BY l.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 1000))
  ) t;

  RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_leads(INT) TO authenticated;

/**
 * המשפך.
 *
 * ★ ארבעה מספרים, ולא לוח מחוונים.
 *
 * השאלה היחידה שמעניינת כאן היא "איפה אנשים נעצרים": כמה
 * נכנסו, כמה שיחקו, כמה שמרו מפתח, וכמה הפכו לקבועים. כל
 * מספר נוסף הוא מספר שמסיח מהשאלה הזו.
 */
CREATE OR REPLACE FUNCTION game.admin_funnel()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v JSONB;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  SELECT jsonb_build_object(
    'users',      (SELECT count(*) FROM game.users),
    'guests',     (SELECT count(*) FROM game.users WHERE COALESCE(is_guest, TRUE) AND NOT COALESCE(is_bot, FALSE)),
    'registered', (SELECT count(*) FROM game.users WHERE NOT COALESCE(is_guest, TRUE)),
    'played',     (SELECT count(DISTINCT user_id) FROM game.user_lineups WHERE status <> 'draft'),
    'withPass',   (SELECT count(*) FROM game.access_codes WHERE kind = 'pass' AND revoked_at IS NULL),
    'passUsed',   (SELECT count(*) FROM game.access_codes WHERE kind = 'pass' AND uses > 0),
    'leads',      (SELECT count(*) FROM game.leads),
    'leadsOptIn', (SELECT count(*) FROM game.leads WHERE consent)
  ) INTO v;

  RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_funnel() TO authenticated;

-- ---------------------------------------------------------------------
-- §5 · הקשחה — הטבלאות החדשות נולדות סגורות
-- ---------------------------------------------------------------------
--
--  ★ זו לא זהירות יתר, זה בדיוק מה שקרה קודם.
--
--  `db/07` הגדירה `ALTER DEFAULT PRIVILEGES ... GRANT ALL`, וכל
--  טבלה שנוצרה אחריה נולדה פתוחה לאנונימי. `db/18` ביטלה את
--  ברירת המחדל — והשורות כאן הן החגורה השנייה, למקרה שמישהו
--  יריץ את הקבצים בסדר אחר.
-- ---------------------------------------------------------------------

REVOKE ALL ON game.leads FROM anon, authenticated;
REVOKE ALL ON game.access_codes FROM anon, authenticated;

UPDATE game.data_revision
   SET revision = revision + 1, scope = 'migration-19', updated_at = now()
 WHERE id = 1;


-- =====================================================================
-- ▼▼▼  20_pass_sql_only.sql  —  ★ כרטיס המנוי בלי Edge Functions — הכל ב-SQL
-- =====================================================================

-- =====================================================================
--  Dubid · מיגרציה 20 — כרטיס המנוי בלי Edge Functions
-- =====================================================================
--
--  ═══════════════════════════════════════════════════════════════
--  ★★★ למה זה נכתב מחדש ★★★
--  ═══════════════════════════════════════════════════════════════
--
--  הגרסה הקודמת עבדה דרך Edge Function, והיא דרשה התקנת CLI
--  ופקודת `supabase functions deploy`. זה תפעול שאי אפשר לעשות
--  מ-SQL Editor, ולכן בפועל הוא לא נעשה — והתכונה לא עבדה.
--
--  ★ תכונה שדורשת צעד תפעולי שלא מבוצע היא תכונה שלא קיימת.
--
--  אז השאלה הנכונה היא: **למה בכלל היה צריך שרת שם?**
--
--  ═══════════════════════════════════════════════════════════════
--  ★★ התובנה: אין צורך להעביר סשן. צריך להעביר דאטה. ★★
--  ═══════════════════════════════════════════════════════════════
--
--  הגישה הישנה: המכשיר החדש צריך להיכנס **בתור** המשתמש הישן.
--  לשם כך צריך להנפיק לו טוקן של מישהו אחר — וזה דורש מפתח
--  `service_role`, שאסור לו להיות בדפדפן. מכאן ה-Edge Function.
--
--  הגישה החדשה: לכל דפדפן **כבר יש** משתמש אנונימי משלו
--  (`signInAnonymously`). אז במקום להתחזות למשתמש הישן, המכשיר
--  החדש פשוט **לוקח אליו את הדאטה**: ההרכבים, שם הקבוצה,
--  הזירות, הכל.
--
--  התוצאה זהה לחלוטין מבחינת המשתמש — הוא רואה את הקבוצה שלו —
--  אבל אין העברת סשן, אין `service_role`, ואין שרת.
--  **הכל פונקציה אחת ב-SQL.**
--
--  ★ ומה זה מבטל: פריסת פונקציות, CORS, סודות של פונקציות
--    קצה, ולוגים נפרדים. כל המוצר רץ עכשיו מ-`RUN-ALL.sql`.
--
--  ═══════════════════════════════════════════════════════════════
--  ★ שלוש החלטות אבטחה שהמיגרציה הזו אוכפת
--  ═══════════════════════════════════════════════════════════════
--
--   1. **המפתח לא נשמר, רק ה-hash.** כמו סיסמה.
--   2. **`is_admin` לעולם לא עובר.** מפתח שנופל לידיים לא נכונות
--      נותן גישה לחשבון משחק — לא ללוח הניהול. ראו §3.
--   3. **מכסת ניחושים.** 50 ביט כפול עשרה ניסיונות לרבע שעה.
--
--  אידמפוטנטי. אפשר להריץ שוב.
-- =====================================================================

SET search_path = game, core, public;

-- ---------------------------------------------------------------------
-- §1 · סימון מיזוג
-- ---------------------------------------------------------------------
--
--  ★ המשתמש המקורי לא נמחק — הוא מסומן.
--
--  מחיקה הייתה מפילה שורות ביומן הפעילות ובביקורת, ובעיקר: היא
--  הייתה הופכת "מה קרה כאן" לשאלה בלי תשובה. שורה מסומנת עולה
--  כלום ומשאירה שובל.
-- ---------------------------------------------------------------------

ALTER TABLE game.users
  ADD COLUMN IF NOT EXISTS merged_into UUID REFERENCES game.users(id),
  ADD COLUMN IF NOT EXISTS merged_at   TIMESTAMPTZ;

COMMENT ON COLUMN game.users.merged_into IS
  'המשתמש שאליו הדאטה עברה בפדיון כרטיס. NULL = משתמש פעיל.';

CREATE INDEX IF NOT EXISTS users_merged_idx ON game.users (merged_into)
  WHERE merged_into IS NOT NULL;

-- ---------------------------------------------------------------------
-- §2 · הנפקת מפתח — ב-SQL, בלי שרת
-- ---------------------------------------------------------------------
--
--  ★ אלפבית בלי אותיות מתבלבלות: **אין 0, O, 1, I**.
--    משתמש שמקליד קוד שגוי כי הפונט דו־משמעי מנסה שוב, ושלושה
--    ניסיונות כאלה נראים בדיוק כמו ניחוש בכוח גס.
--
--  ★★ למה L כן נשאר, למרות שהוא דומה ל-1
--
--  כי 32 תווים מחלקים את 256 בדיוק (256 = 32 × 8), ולכן `% 32`
--  על בית אקראי אינו מטה את ההתפלגות. אלפבית בן 31 היה דורש
--  דחיית ערכים ולא רק מודולו — וזו בדיוק הטעות שהופכת מפתח בן
--  50 ביט למפתח בן 47, בשקט.
--
--  וזה בטוח: `1` **לא קיים** באלפבית. מי שיקרא L ויקליד 1 יקבל
--  "מפתח לא תקין" מיד, ולא יתחזה בטעות למישהו אחר. הסיכון
--  היחיד שנשאר הוא הקלדה חוזרת, לא התנגשות.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.gen_pass_code(p_len INT DEFAULT 10)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE
SET search_path = game, public
AS $$
DECLARE
  c_alphabet CONSTANT TEXT := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_bytes BYTEA;
  v_out   TEXT := '';
  i INT;
BEGIN
  v_bytes := gen_random_bytes(p_len);
  FOR i IN 0 .. p_len - 1 LOOP
    v_out := v_out || substr(c_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  END LOOP;
  RETURN v_out;
END;
$$;

/**
 * מנפיק מפתח חדש ומבטל את הקודם.
 *
 * ★★ המפתח מוחזר **פעם אחת** ולעולם לא שוב. ★★
 *
 * במסד יושב רק ה-hash שלו, וזו ההחלטה ולא מגבלה: מי שמשיג גישה
 * לטבלה לא יכול להתחזות לאיש. מי שאיבד את הכרטיס מנפיק חדש.
 */
CREATE OR REPLACE FUNCTION game.issue_pass()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_code TEXT; v_uid UUID; v_name TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  -- ★ מכסה גם על ההנפקה, לא רק על הפדיון.
  --   בלעדיה אפשר לייצר אלפי שורות בטבלה בלולאה אחת.
  IF NOT game.rate_ok('issue_pass', 10, INTERVAL '1 hour') THEN
    RAISE EXCEPTION 'TOO_MANY_ATTEMPTS';
  END IF;

  v_code := game.gen_pass_code(10);

  /* ★ ביטול הישן **לפני** הכנסת החדש.
     יש אינדקס ייחודי על "מפתח פעיל אחד למשתמש"; הסדר ההפוך
     היה נכשל על עצמו. */
  UPDATE game.access_codes SET revoked_at = now()
   WHERE user_id = v_uid AND kind = 'pass' AND revoked_at IS NULL;

  INSERT INTO game.access_codes (code_hash, user_id, kind, expires_at)
  VALUES (encode(digest(v_code, 'sha256'), 'hex'), v_uid, 'pass', NULL);

  SELECT display_name INTO v_name FROM game.users WHERE id = v_uid;

  RETURN jsonb_build_object(
    'code',        v_code,
    'pretty',      substr(v_code,1,4) || '-' || substr(v_code,5,4) || '-' || substr(v_code,9),
    'displayName', v_name,
    'issuedAt',    to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION game.issue_pass() TO authenticated;
GRANT EXECUTE ON FUNCTION game.gen_pass_code(INT) TO authenticated;

-- ---------------------------------------------------------------------
-- §3 · פדיון — העברת הדאטה
-- ---------------------------------------------------------------------
--
--  ═══════════════════════════════════════════════════════════════
--  ★★★ מה עובר, ומה בכוונה לא ★★★
--  ═══════════════════════════════════════════════════════════════
--
--  **עובר:** הרכבים, טיוטות, שמות קבוצה, חברות בזירות, בעלות על
--  זירות, שם המאמן, שם המשתמש, האווטאר, קוד ההפניה, וסטטוס
--  ההרשמה. כלומר: כל מה שהמשתמש היה קורא לו "החשבון שלי".
--
--  **לא עובר — `is_admin`.**
--
--  ★ זו השורה החשובה ביותר בקובץ.
--
--  מפתח כרטיס נשלח בוואטסאפ, נשמר בגלריה, ומצולם מהמסך. אם הוא
--  היה גורר איתו הרשאת ניהול, כל צילום מסך של אדמין היה מפתח
--  ללוח הניהול — כולל שינוי חוקי ניקוד ופרסום תוצאות.
--
--  הרשאת ניהול ניתנת רק דרך `claim_admin` עם הסוד, ורק שם.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.claim_pass(p_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE
  v_me     UUID;
  v_src    UUID;
  v_hash   TEXT;
  v_clean  TEXT;
  v_moved  INT := 0;
  v_name   TEXT;
BEGIN
  v_me := auth.uid();
  IF v_me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  /* ★ המקפים שהמשתמש רואה בכרטיס נשלפים כאן.
     הוא מקליד "AB34-CD67-KM" כי ככה זה כתוב אצלו. */
  v_clean := upper(regexp_replace(COALESCE(p_key, ''), '[^A-Za-z0-9]', '', 'g'));

  /*
   * ═══════════════════════════════════════════════════════════
   * ★★★ למה כישלון כאן **מוחזר** ולא נזרק ★★★
   * ═══════════════════════════════════════════════════════════
   *
   * הגרסה הראשונה עשתה `RAISE EXCEPTION 'INVALID_CODE'`, וזה
   * נראה נכון לגמרי — עד שמסתכלים על מונה הניסיונות.
   *
   * `RAISE` **מגלגל אחורה את הטרנזקציה**, וביחד איתה את השורה
   * ש-`rate_ok` בדיוק הכניסה ל-`probe_attempts`. כלומר: כל
   * ניחוש שגוי מחק את הרישום של עצמו.
   *
   * התוצאה: המכסה עבדה בדיוק על מי שהקליד **נכון**, ולא עבדה
   * בכלל על מי שמנחש — כלומר על המקרה היחיד שבשבילו היא קיימת.
   * מנחש אוטומטי היה מקבל אינסוף ניסיונות, וכל בדיקה שסופרת
   * "האם יש מכסה" הייתה עוברת.
   *
   * לכן: `AUTH_REQUIRED` עדיין נזרק (הוא לא נספר ממילא), וכל
   * השאר חוזר כערך. הקריאה מצליחה, השורה נשארת, והמונה סופר.
   */
  IF length(v_clean) NOT IN (6, 10) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'INVALID_CODE');
  END IF;

  /* ★ המכסה **לפני** החיפוש, לא אחריו. אחרת כל ניסיון שגוי
     הוא שאילתה, ומנחש אוטומטי מקבל קצב חינם. */
  IF NOT game.rate_ok('claim_pass', 10, INTERVAL '15 minutes') THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'TOO_MANY_ATTEMPTS');
  END IF;

  v_hash := encode(digest(v_clean, 'sha256'), 'hex');

  SELECT user_id INTO v_src
  FROM game.access_codes
  WHERE code_hash = v_hash
    AND revoked_at IS NULL
    AND (kind = 'pass' OR (kind = 'transfer' AND redeemed_at IS NULL AND expires_at > now()))
  LIMIT 1;

  IF v_src IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'INVALID_CODE');
  END IF;

  /* אותו משתמש — אין מה להעביר, וזו לא שגיאה. */
  IF v_src = v_me THEN
    RETURN jsonb_build_object('ok', TRUE, 'moved', 0, 'sameUser', TRUE);
  END IF;

  /* ★ מפתח של משתמש שכבר מוזג מוביל ליעד האמיתי.
     בלי זה, מי שסרק כרטיס ישן היה מגיע לחשבון ריק. */
  SELECT COALESCE(u.merged_into, v_src) INTO v_src
  FROM game.users u WHERE u.id = v_src;

  IF v_src = v_me THEN
    RETURN jsonb_build_object('ok', TRUE, 'moved', 0, 'sameUser', TRUE);
  END IF;

  /* ------------------------------------------------------------
     1. הרכבים — המקור מנצח בהתנגשות
     ------------------------------------------------------------
     ★ למה המקור ולא היעד.

     היעד הוא כמעט תמיד מכשיר חדש וריק. אבל אם מישהו כן שיחק
     בו במקביל, ההרכב שהוא **שמר בכרטיס** הוא זה שהוא מזהה
     כשלו — הוא זה שהופיע בטבלה ושאותו הוא שיתף.
  */
  DELETE FROM game.user_lineups t
   WHERE t.user_id = v_me
     AND EXISTS (SELECT 1 FROM game.user_lineups s
                  WHERE s.user_id = v_src
                    AND s.gameweek_id = t.gameweek_id
                    AND s.mode = t.mode);

  UPDATE game.user_lineups SET user_id = v_me WHERE user_id = v_src;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  /* 2. טיוטות */
  DELETE FROM game.lineup_drafts t
   WHERE t.user_id = v_me
     AND EXISTS (SELECT 1 FROM game.lineup_drafts s
                  WHERE s.user_id = v_src
                    AND s.gameweek_id = t.gameweek_id
                    AND s.mode = t.mode);
  UPDATE game.lineup_drafts SET user_id = v_me WHERE user_id = v_src;

  /* 3. זירות — חברות ובעלות */
  DELETE FROM game.league_members t
   WHERE t.user_id = v_me
     AND EXISTS (SELECT 1 FROM game.league_members s
                  WHERE s.user_id = v_src AND s.league_id = t.league_id);
  UPDATE game.league_members SET user_id = v_me WHERE user_id = v_src;
  UPDATE game.leagues       SET owner_id = v_me WHERE owner_id = v_src;

  /* 4. ליד — אחד לכל משתמש */
  DELETE FROM game.leads WHERE user_id = v_me
     AND EXISTS (SELECT 1 FROM game.leads s WHERE s.user_id = v_src);
  UPDATE game.leads SET user_id = v_me WHERE user_id = v_src;

  /* 5. יומן הפעילות נשאר על המקור.
     ★ זו החלטה: היומן מתאר **מה קרה מתי**, ולא "למי הדאטה
       שייכת עכשיו". שכתוב שלו היה הופך אותו לחסר ערך. */

  /* ------------------------------------------------------------
     6. הפרופיל
     ------------------------------------------------------------
     ★ `username` הוא UNIQUE — חייבים לשחרר אותו מהמקור לפני
       שמציבים אותו על היעד, אחרת העדכון נכשל על עצמו.
  */
  UPDATE game.users SET username = NULL WHERE id = v_src RETURNING display_name INTO v_name;

  UPDATE game.users t SET
    display_name  = COALESCE(NULLIF(btrim(s.display_name), ''), t.display_name),
    username      = COALESCE(t.username, s.username),
    avatar        = COALESCE(s.avatar, t.avatar),
    referral_code = COALESCE(t.referral_code, s.referral_code),
    email         = COALESCE(t.email, s.email),
    /* ★ מי שהיה רשום נשאר רשום. `is_guest` יורד ל-FALSE אם
       אחד מהשניים כבר לא אורח. */
    is_guest      = (t.is_guest AND s.is_guest),
    registered_at = COALESCE(t.registered_at, s.registered_at),
    offsides_user_id = COALESCE(t.offsides_user_id, s.offsides_user_id),
    offsides_email   = COALESCE(t.offsides_email, s.offsides_email)
    /* ★★ `is_admin` **לא** ברשימה. ראו הכותרת של §3. */
  FROM game.users s
  WHERE t.id = v_me AND s.id = v_src;

  /* ------------------------------------------------------------
     7. הכרטיס עצמו עובר ליעד
     ------------------------------------------------------------
     ★ ככה התמונה ששמורה בגלריה ממשיכה לעבוד גם אחרי הפדיון.
       זו כל הנקודה של מפתח חוזר.
  */
  UPDATE game.access_codes SET revoked_at = now()
   WHERE user_id = v_me AND kind = 'pass' AND revoked_at IS NULL;

  UPDATE game.access_codes
     SET user_id = v_me, uses = uses + 1, last_used_at = now(),
         redeemed_at = CASE WHEN kind = 'transfer' THEN now() ELSE redeemed_at END
   WHERE code_hash = v_hash;

  /* שאר הקודים של המקור מבוטלים — הם מצביעים לחשבון שכבר ריק. */
  UPDATE game.access_codes SET revoked_at = now()
   WHERE user_id = v_src AND revoked_at IS NULL;

  /* 8. סימון */
  UPDATE game.users SET merged_into = v_me, merged_at = now() WHERE id = v_src;

  PERFORM game.log_activity(v_me, 'pass_claim', NULL, NULL, v_name);

  RETURN jsonb_build_object(
    'ok', TRUE, 'moved', v_moved, 'sameUser', FALSE, 'displayName', v_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION game.claim_pass(TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- §4 · תוויות ליומן
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'game' AND p.proname = 'admin_activity') THEN
    NULL;   -- התווית עצמה נוספת ב-16; כאן רק מוודאים שהפעולה קיימת
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- §5 · ייצוא לידים — כדי שיהיה אפשר לעבוד עם המידע בחוץ
-- ---------------------------------------------------------------------
--
--  ★ CSV ולא JSON.
--
--  זה מידע שהולך לאקסל, לגיליון, או למערכת דיוור — ולא לקוד.
--  JSON היה מחייב המרה בכל פעם מחדש.
--
--  ★ הפסיקים בתוך שדות: `quote_nullable` עוטף ומכפיל מרכאות
--    לפי RFC 4180. שם עם פסיק בלי זה שובר את כל השורה.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.admin_leads_csv()
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v TEXT;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  SELECT 'email,name,consent,source,gameweek,entries,registered,created_at' || E'\n' ||
         COALESCE(string_agg(
           quote_nullable(l.email::TEXT) || ',' ||
           quote_nullable(COALESCE(NULLIF(btrim(u.display_name), ''), 'אורח')) || ',' ||
           CASE WHEN l.consent THEN 'yes' ELSE 'no' END || ',' ||
           quote_nullable(l.source) || ',' ||
           quote_nullable(COALESCE(l.gw_code, '')) || ',' ||
           (SELECT count(*) FROM game.user_lineups ul
             WHERE ul.user_id = l.user_id AND ul.status <> 'draft')::TEXT || ',' ||
           CASE WHEN COALESCE(u.is_guest, TRUE) THEN 'no' ELSE 'yes' END || ',' ||
           to_char(l.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'),
           E'\n' ORDER BY l.created_at DESC), '')
    INTO v
  FROM game.leads l
  LEFT JOIN game.users u ON u.id = l.user_id;

  RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_leads_csv() TO authenticated;

-- ---------------------------------------------------------------------
-- §6 · תמונת מצב יומית — "מה קרה אתמול"
-- ---------------------------------------------------------------------
--
--  ★ שאלה אחת: **האם המוצר גדל השבוע, ואיפה.**
--
--  ארבעה עשר ימים אחורה, יום-יום. זה מספיק כדי לראות מגמה
--  ולזהות יום חריג, וקצר מספיק כדי להיקרא במבט.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.admin_daily(p_days INT DEFAULT 14)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v JSONB; v_days INT;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  v_days := GREATEST(1, LEAST(90, COALESCE(p_days, 14)));

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'day'), '[]'::jsonb) INTO v
  FROM (
    SELECT jsonb_build_object(
      'day',      to_char(d.day, 'YYYY-MM-DD'),
      'newUsers', (SELECT count(*) FROM game.users u
                    WHERE u.created_at::DATE = d.day
                      AND NOT COALESCE(u.is_bot, FALSE)
                      AND u.merged_into IS NULL),
      'entries',  (SELECT count(*) FROM game.user_lineups ul
                    WHERE ul.submitted_at::DATE = d.day AND ul.status <> 'draft'),
      'passes',   (SELECT count(*) FROM game.access_codes ac
                    WHERE ac.kind = 'pass' AND ac.created_at::DATE = d.day),
      'leads',    (SELECT count(*) FROM game.leads l WHERE l.created_at::DATE = d.day)
    ) AS x
    FROM generate_series(
      (now() - (v_days || ' days')::INTERVAL)::DATE, now()::DATE, '1 day'
    ) AS d(day)
  ) t;

  RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_daily(INT) TO authenticated;

-- ---------------------------------------------------------------------
-- §7 · המשפך מדלג על משתמשים שמוזגו
-- ---------------------------------------------------------------------
--
--  ★ בלי זה כל פדיון כרטיס היה מנפח את מספר "הנכנסו" באחד,
--    ומוריד את שיעור ההמרה בלי שקרה שום דבר.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.admin_funnel()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v JSONB;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  SELECT jsonb_build_object(
    'users',      (SELECT count(*) FROM game.users
                    WHERE merged_into IS NULL AND NOT COALESCE(is_bot, FALSE)),
    'guests',     (SELECT count(*) FROM game.users
                    WHERE COALESCE(is_guest, TRUE) AND NOT COALESCE(is_bot, FALSE)
                      AND merged_into IS NULL),
    'registered', (SELECT count(*) FROM game.users
                    WHERE NOT COALESCE(is_guest, TRUE) AND merged_into IS NULL),
    'played',     (SELECT count(DISTINCT user_id) FROM game.user_lineups
                    WHERE status <> 'draft'),
    'withPass',   (SELECT count(*) FROM game.access_codes
                    WHERE kind = 'pass' AND revoked_at IS NULL),
    'passUsed',   (SELECT count(*) FROM game.access_codes
                    WHERE kind = 'pass' AND uses > 0),
    'leads',      (SELECT count(*) FROM game.leads),
    'leadsOptIn', (SELECT count(*) FROM game.leads WHERE consent),
    'merges',     (SELECT count(*) FROM game.users WHERE merged_into IS NOT NULL)
  ) INTO v;

  RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_funnel() TO authenticated;

UPDATE game.data_revision
   SET revision = revision + 1, scope = 'migration-20', updated_at = now()
 WHERE id = 1;


-- =====================================================================
-- ▼▼▼  21_coach_profile.sql  —  פרופיל המאמן — היסטוריה, שיאים ואווטאר
-- =====================================================================

-- =====================================================================
--  Dubid · מיגרציה 21 — פרופיל המאמן
-- =====================================================================
--
--  ═══════════════════════════════════════════════════════════════
--  ★★★ הבעיה: התחברת, ולא קרה כלום ★★★
--  ═══════════════════════════════════════════════════════════════
--
--  משתמש שנכנס עם גוגל ראה בדיוק את מה שראה קודם: אותו לובי,
--  אותו שם. אין תמונה, אין היסטוריה, אין שום סימן שמשהו השתנה.
--
--  ★ וזו לא בעיה קוסמטית. זו בעיה של **סיבה**.
--
--  אנחנו מבקשים מאדם לוותר על אנונימיות ולתת לנו זהות. אם מה
--  שהוא מקבל בתמורה בלתי נראה, הבקשה הבאה שלנו תיענה בפחות
--  נכונות — והוא צודק.
--
--  פרופיל הוא התמורה: מקום שבו מצטבר מה שעשית. ככל שיש בו יותר,
--  כך פחות רוצים לאבד אותו — וזה בדיוק מה שהופך חשבון מ"טופס
--  שמילאתי" ל"דבר ששייך לי".
--
--  ═══════════════════════════════════════════════════════════════
--  ★ מה הפונקציה הזו מחזירה, ומה במפורש לא
--  ═══════════════════════════════════════════════════════════════
--
--  **מחזירה:** רק מה שהמסד באמת יודע — כמה מחזורים שיחקת, אילו
--  שמות קבוצה, מתי הצטרפת, ומה הניקוד **שנשמר** בטבלת הניקוד.
--
--  **לא מחזירה:** שום מספר משוער. אם מחזור עוד לא נוקד, השדה
--  ריק ולא אפס. אפס נראה כמו כישלון; ריק נראה כמו "עוד לא".
--  ההבדל הזה הוא כל ההבדל במסך שאמור לגרום למישהו להרגיש טוב.
--
--  אידמפוטנטי. אפשר להריץ שוב.
-- =====================================================================

SET search_path = game, core, public;

/**
 * דרך ההתחברות: 'google' / 'email' / NULL לאורח.
 *
 * ★ פונקציה נפרדת, כי `auth.identities` לא קיימת בסביבת
 *   הבדיקות המקומית — והבידוד הזה מונע ממנה להפיל את כל
 *   הפרופיל שם.
 */
CREATE OR REPLACE FUNCTION game.my_provider()
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, auth, public
AS $$
DECLARE v TEXT := NULL;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'auth' AND table_name = 'identities') THEN
    EXECUTE $q$
      SELECT i.provider FROM auth.identities i
      WHERE i.user_id = $1 AND i.provider <> 'anonymous'
      ORDER BY i.last_sign_in_at DESC NULLS LAST LIMIT 1
    $q$ INTO v USING auth.uid();
  END IF;

  RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION game.my_provider() TO authenticated;

CREATE OR REPLACE FUNCTION game.my_profile()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_uid UUID; v JSONB;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  SELECT jsonb_build_object(
    /* ---------- מי אתה ---------- */
    'displayName',  COALESCE(NULLIF(btrim(u.display_name), ''), 'מאמן'),
    'username',     u.username,
    'avatar',       u.avatar,
    'email',        u.email,
    'provider',     game.my_provider(),
    'isGuest',      COALESCE(u.is_guest, TRUE),
    'referralCode', u.referral_code,
    'memberSince',  to_char(u.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),

    /* ---------- מה עשית ---------- */
    'played',       (SELECT count(*) FROM game.user_lineups ul
                      WHERE ul.user_id = v_uid AND ul.status <> 'draft'),
    'playedFive',   (SELECT count(*) FROM game.user_lineups ul
                      WHERE ul.user_id = v_uid AND ul.status <> 'draft' AND ul.mode = 'five'),
    'playedFull',   (SELECT count(*) FROM game.user_lineups ul
                      WHERE ul.user_id = v_uid AND ul.status <> 'draft' AND ul.mode = 'full'),

    /* ★ סכום, שיא, וממוצע — רק ממחזורים שבאמת נוקדו.
       `NULL` כשאין, ולא 0. */
    'totalPoints',  (SELECT round(sum(ls.total_points))::INT
                      FROM game.lineup_scores ls
                      JOIN game.user_lineups ul ON ul.id = ls.lineup_id
                      WHERE ul.user_id = v_uid),
    'bestPoints',   (SELECT round(max(ls.total_points))::INT
                      FROM game.lineup_scores ls
                      JOIN game.user_lineups ul ON ul.id = ls.lineup_id
                      WHERE ul.user_id = v_uid),
    'bestRank',     (SELECT min(ls.rank)
                      FROM game.lineup_scores ls
                      JOIN game.user_lineups ul ON ul.id = ls.lineup_id
                      WHERE ul.user_id = v_uid AND ls.rank IS NOT NULL),
    'scored',       (SELECT count(*)
                      FROM game.lineup_scores ls
                      JOIN game.user_lineups ul ON ul.id = ls.lineup_id
                      WHERE ul.user_id = v_uid),

    /* ---------- הזהות המשנית ---------- */
    'hasPass',      EXISTS (SELECT 1 FROM game.access_codes ac
                             WHERE ac.user_id = v_uid AND ac.kind = 'pass'
                               AND ac.revoked_at IS NULL),
    'leagues',      (SELECT count(*) FROM game.league_members lm WHERE lm.user_id = v_uid),

    /* ---------- ההיסטוריה ---------- */
    /*
     * ★ הסדר הוא מהחדש לישן, וזה לא שרירותי: מה שקרה עכשיו הוא
     *   מה שמעניין, ומה שלפני חצי שנה הוא רקע.
     *
     * ★★ ומגבלת 40: פרופיל אינו ארכיון. רשימה שממשיכה לנצח
     *   הופכת מסך של גאווה למסך של גלילה.
     */
    'history',      COALESCE((
      SELECT jsonb_agg(x ORDER BY x->>'gw' DESC)
      FROM (
        SELECT jsonb_build_object(
          'gw',        g.code,
          'gwNumber',  g.number,
          /* ★ `gameweeks.names` הוא דומיין מעל JSONB, לא טיפוס
             מורכב — הגישה היא `#>>` ולא `.he`. אותה צורה בדיוק
             כמו ב-`db/13`, ובכוונה: שתי דרכים לקרוא את אותו שדה
             הן שתי דרכים להישבר בנפרד. */
          'gwLabel',   COALESCE(g.names #>> '{he,full}',
                                'מחזור ' || g.number::TEXT),
          'mode',      ul.mode,
          'teamName',  ul.team_name,
          'submitted', to_char(ul.submitted_at AT TIME ZONE 'UTC',
                               'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          /* ריק = המחזור עוד לא נוקד. לא אפס. */
          'points',    CASE WHEN ls.total_points IS NULL THEN NULL
                            ELSE round(ls.total_points)::INT END,
          'rank',      ls.rank
        ) AS x
        FROM game.user_lineups ul
        JOIN game.gameweeks g ON g.id = ul.gameweek_id
        LEFT JOIN game.lineup_scores ls ON ls.lineup_id = ul.id
        WHERE ul.user_id = v_uid AND ul.status <> 'draft'
        ORDER BY g.number DESC, ul.mode
        LIMIT 40
      ) t), '[]'::jsonb)
  ) INTO v
  FROM game.users u
  WHERE u.id = v_uid;

  RETURN COALESCE(v, jsonb_build_object('displayName', 'מאמן', 'isGuest', TRUE));
END;
$$;

GRANT EXECUTE ON FUNCTION game.my_profile() TO authenticated;

/**
 * שינוי אווטאר.
 *
 * ★ למה זו פונקציה ולא כתיבה ישירה: מאז `db/18` אין כתיבה
 *   ישירה לאף טבלה. כל שינוי עובר דרך פונקציה שמחליטה מה מותר.
 *
 * ★ והאורך מוגבל ל-8: האווטאר הוא **אמוג׳י**, ושדה חופשי בפרופיל
 *   הוא בדיוק המקום שבו מישהו ידביק סקריפט או שם באורך אלף תווים
 *   שישבור את הטבלה של כולם.
 */
CREATE OR REPLACE FUNCTION game.set_avatar(p_avatar TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  UPDATE game.users
     SET avatar = NULLIF(left(btrim(COALESCE(p_avatar, '')), 8), '')
   WHERE id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION game.set_avatar(TEXT) TO authenticated;

UPDATE game.data_revision
   SET revision = revision + 1, scope = 'migration-21', updated_at = now()
 WHERE id = 1;


-- =====================================================================
-- ▼▼▼  22_account_status.sql  —  ★ "התחברתי ולא קרה כלום" — זיהוי נכון של חשבון מחובר
-- =====================================================================

-- =====================================================================
--  Dubid · מיגרציה 22 — "התחברתי, ולא קרה כלום"
-- =====================================================================
--
--  ═══════════════════════════════════════════════════════════════
--  ★★★ הבאג ★★★
--  ═══════════════════════════════════════════════════════════════
--
--  משתמש נכנס עם גוגל, חוזר לאתר — ועדיין רשום כ**אורח**.
--  הפרופיל מציג "אורח", הצעת ההרשמה ממשיכה להופיע, ושום דבר
--  לא מרגיש שונה. כאילו ההתחברות לא קרתה.
--
--  ★ הסיבה: `is_guest` נגזר משדה **אחד** — `auth.users.is_anonymous`.
--
--  והשדה הזה לא בהכרח מתעדכן כשמקשרים זהות לחשבון אנונימי קיים
--  (`linkIdentity`). כלומר: המשתמש **באמת** חיבר את גוגל, יש לו
--  שורה ב-`auth.identities`, אבל מבחינת המוצר הוא עדיין אורח.
--
--  ═══════════════════════════════════════════════════════════════
--  ★ התיקון: לשאול את השאלה הנכונה
--  ═══════════════════════════════════════════════════════════════
--
--  "האם המשתמש הזה יכול לחזור לחשבון שלו ממכשיר אחר?"
--
--  התשובה היא כן אם מתקיים **אחד** מהשלושה:
--    · יש לו כתובת מייל מאומתת, או
--    · יש לו זהות מספק חיצוני (גוגל), או
--    · `auth` עצמו כבר לא מחשיב אותו אנונימי.
--
--  שלוש בדיקות במקום אחת, ו-`OR` ביניהן. כל אחת מהן לבדה מספיקה,
--  ולכן אף מסלול המרה לא נופל בין הכיסאות — לא גוגל, לא אימייל,
--  ולא מה שיתווסף מחר.
--
--  אידמפוטנטי. אפשר להריץ שוב.
-- =====================================================================

SET search_path = game, core, public;

-- ---------------------------------------------------------------------
-- §1 · "האם זה עדיין אורח"
-- ---------------------------------------------------------------------
--
--  ★ הפונקציה עמידה בפני היעדר `auth.identities`.
--
--  בסביבת הבדיקות המקומית הסכימה `auth` היא חיקוי מצומצם ואין
--  בה טבלת `identities`. פונקציה שנשענת עליה בעיוורון הייתה
--  מפילה את כל חבילת הבדיקות — ואז הבאג הבא יתגלה רק בייצור.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.auth_is_guest(p_uid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, auth, public
AS $$
DECLARE
  v_anon    BOOLEAN;
  v_email   TEXT;
  v_linked  BOOLEAN := FALSE;
BEGIN
  SELECT COALESCE(u.is_anonymous, FALSE), NULLIF(btrim(u.email), '')
    INTO v_anon, v_email
    FROM auth.users u WHERE u.id = p_uid;

  IF NOT FOUND THEN RETURN TRUE; END IF;

  -- ★ זהות חיצונית — הסימן החזק ביותר, וזה שהיה חסר.
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'auth' AND table_name = 'identities') THEN
    EXECUTE $q$
      SELECT EXISTS (
        SELECT 1 FROM auth.identities i
        WHERE i.user_id = $1 AND i.provider <> 'anonymous'
      )
    $q$ INTO v_linked USING p_uid;
  END IF;

  RETURN NOT (v_linked OR v_email IS NOT NULL OR NOT v_anon);
END;
$$;

GRANT EXECUTE ON FUNCTION game.auth_is_guest(UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- §2 · `ensure_profile` שואלת את השאלה הנכונה
-- ---------------------------------------------------------------------

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
  v_guest BOOLEAN;
  v_name  TEXT;
BEGIN
  IF v_auth IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  SELECT u.raw_user_meta_data, u.email
    INTO v_meta, v_email
    FROM auth.users u WHERE u.id = v_auth;

  -- ★ כאן השינוי: שלוש בדיקות במקום `is_anonymous` לבדו.
  v_guest := game.auth_is_guest(v_auth);

  v_name := COALESCE(
    NULLIF(btrim(p_display_name), ''),
    NULLIF(btrim(v_meta->>'username'), ''),
    NULLIF(btrim(v_meta->>'display_name'), ''),
    NULLIF(btrim(v_meta->>'full_name'), ''),   -- ★ גוגל שולח את זה
    NULLIF(btrim(v_meta->>'name'), '')
  );

  SELECT * INTO v_user FROM game.users WHERE id = v_auth OR auth_id = v_auth;

  IF v_user.id IS NOT NULL THEN
    UPDATE game.users SET
      display_name = COALESCE(v_name, display_name),
      /* ★ תמונת הפרופיל של גוגל, אם המשתמש עוד לא בחר אווטאר. */
      avatar       = COALESCE(avatar, NULLIF(v_meta->>'avatar', '')),
      email        = COALESCE(v_email, email),
      /* ★★ בכיוון אחד בלבד: מי שכבר רשום לא חוזר להיות אורח
         בגלל רענון דף או תשובה חלקית מהשרת. */
      is_guest      = (v_guest AND v_user.is_guest AND v_user.offsides_user_id IS NULL),
      registered_at = CASE
                        WHEN v_user.registered_at IS NOT NULL THEN v_user.registered_at
                        WHEN NOT v_guest THEN now()
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
    v_name,
    NULLIF(v_meta->>'avatar', ''),
    v_email,
    NULLIF(v_meta->>'referred_by_code', ''),
    upper(left(replace(v_auth::TEXT, '-', ''), 8)),
    v_guest,
    CASE WHEN v_guest THEN NULL ELSE now() END
  )
  RETURNING * INTO v_user;

  RETURN v_user;
END;
$$;

GRANT EXECUTE ON FUNCTION game.ensure_profile(TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- §3 · `me()` מחזירה גם **איך** התחברת
-- ---------------------------------------------------------------------
--
--  ★ "מחובר" זו הפשטה. "מחובר עם גוגל" היא עובדה שאפשר לראות —
--    וזה ההבדל בין מסך שמרגיש מחובר לבין מסך שטוען שהוא מחובר.
--
--  ⚠ המייל עצמו **לא** חוזר כאן. `me()` רצה בכל עלייה של
--    האפליקציה; המייל שייך ל-`my_profile()`, שנקראת רק כשפותחים
--    את הפרופיל בפועל.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.me()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, auth, public
AS $$
DECLARE v JSONB; v_provider TEXT := NULL; v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'auth' AND table_name = 'identities') THEN
    EXECUTE $q$
      SELECT i.provider FROM auth.identities i
      WHERE i.user_id = $1 AND i.provider <> 'anonymous'
      ORDER BY i.last_sign_in_at DESC NULLS LAST LIMIT 1
    $q$ INTO v_provider USING v_uid;
  END IF;

  SELECT jsonb_build_object(
    'id',             u.id,
    'displayName',    u.display_name,
    'username',       u.username,
    'avatar',         u.avatar,
    'isGuest',        u.is_guest,
    /* ★ המייל **לא** חוזר כאן, וזו החלטה קיימת שנשמרת:
       `me()` היא קריאת הזהות הקלה שרצה בכל עלייה, והיא מחזירה
       רק מה שצריך כדי לצייר מסך. המייל חוזר ב-`my_profile()`,
       שנקראת רק כשפותחים את הפרופיל. יש בדיקה שנועלת את זה. */
    'provider',       v_provider,
    'referralCode',   u.referral_code,
    'offsidesUserId', u.offsides_user_id,
    'isAdmin',        u.is_admin,
    'registeredAt',   u.registered_at
  ) INTO v
  FROM game.users u WHERE u.id = v_uid;

  RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION game.me() TO authenticated;

-- ---------------------------------------------------------------------
-- §4 · תיקון למפרע
-- ---------------------------------------------------------------------
--
--  ★ מי שכבר חיבר גוגל לפני התיקון תקוע כ"אורח" במסד.
--    בלי השורה הזו הוא יישאר כך עד שיתחבר שוב — ואין לו סיבה
--    לעשות את זה, כי מבחינתו הוא כבר התחבר.
-- ---------------------------------------------------------------------

DO $$
DECLARE n INT := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'auth' AND table_name = 'identities') THEN
    EXECUTE $q$
      UPDATE game.users u SET
        is_guest = FALSE,
        registered_at = COALESCE(u.registered_at, now())
      WHERE u.is_guest
        AND EXISTS (SELECT 1 FROM auth.identities i
                     WHERE i.user_id = u.id AND i.provider <> 'anonymous')
    $q$;
    GET DIAGNOSTICS n = ROW_COUNT;
  END IF;

  UPDATE game.users u SET
    is_guest = FALSE,
    registered_at = COALESCE(u.registered_at, now())
  FROM auth.users a
  WHERE a.id = u.id AND u.is_guest AND NULLIF(btrim(a.email), '') IS NOT NULL;

  IF n > 0 THEN RAISE NOTICE 'תוקנו % משתמשים שהיו תקועים כאורחים', n; END IF;
END $$;

UPDATE game.data_revision
   SET revision = revision + 1, scope = 'migration-22', updated_at = now()
 WHERE id = 1;


-- =====================================================================
-- ▼▼▼  23_merge_on_signin.sql  —  ★ "החשבון כבר קיים" — נכנסים, ואז גוררים את מה שנבנה
-- =====================================================================

-- =====================================================================
--  Dubid · מיגרציה 23 — "החשבון כבר קיים"
-- =====================================================================
--
--  ═══════════════════════════════════════════════════════════════
--  ★★★ הטעות בתכנון, ולא באג נקודתי ★★★
--  ═══════════════════════════════════════════════════════════════
--
--  המוצר ניסה **לקשר** את חשבון גוגל לאורח הנוכחי
--  (`linkIdentity`). זה עובד בדיוק במקרה אחד: כשחשבון הגוגל
--  הזה עוד לא מוכר למערכת.
--
--  אבל המקרה השכיח הוא ההפוך — לאדם **כבר יש** חשבון. ואז
--  הקישור נכשל עם "החשבון כבר קיים", והמשתמש נתקע: הוא לא
--  נכנס, לא נרשם, ולא מבין מה הוא עשה לא נכון.
--
--  ★ והוא לא עשה שום דבר לא נכון. הוא לחץ "התחבר עם גוגל".
--
--  ═══════════════════════════════════════════════════════════════
--  ★★ הגישה הנכונה: להיכנס, ואז לגרור את מה שנבנה ★★
--  ═══════════════════════════════════════════════════════════════
--
--  במקום לנסות להדביק זהות חדשה על האורח, פשוט **נכנסים
--  רגיל** — וזה עובד תמיד, גם למי שיש חשבון וגם למי שאין.
--  אחר כך מעבירים את מה שהאורח בנה אל החשבון שנכנסנו אליו.
--
--  ואת זה כבר יודעים לעשות: `claim_pass`, מאותה מיגרציה שבנתה
--  את כרטיס המנוי. אותו קוד, אותן בדיקות.
--
--  הפונקציה כאן מנפיקה אסימון חד־פעמי וקצר־מועד שמשמש **רק**
--  להעברה הזו.
--
--  ★ ומה זה מבטל בדרך:
--    · אין יותר `linkIdentity`, ולכן אין יותר צורך להפעיל
--      "Manual linking" בלוח הבקרה. מתג פחות.
--    · אין יותר "החשבון כבר קיים". הודעת שגיאה שנעלמה כי
--      המצב שיצר אותה כבר לא קיים.
--
--  אידמפוטנטי. אפשר להריץ שוב.
-- =====================================================================

SET search_path = game, core, public;

/**
 * אסימון העברה חד־פעמי, לרגע ההתחברות.
 *
 * ★★ למה `transfer` ולא `pass` ★★
 *
 * הנפקת `pass` **מבטלת את הקודם**. אורח ששמר את כרטיס המנוי
 * שלו בגלריה היה מאבד אותו בכל לחיצה על "התחבר עם גוגל", בלי
 * לדעת — והתמונה ששמרנו לו הייתה מפסיקה לעבוד.
 *
 * אסימון העברה הוא דבר אחר לגמרי: חמש עשרה דקות, שימוש אחד,
 * ואינו נוגע בכרטיס.
 */
CREATE OR REPLACE FUNCTION game.issue_merge_token()
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_code TEXT; v_uid UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  IF NOT game.rate_ok('merge_token', 20, INTERVAL '1 hour') THEN
    RAISE EXCEPTION 'TOO_MANY_ATTEMPTS';
  END IF;

  /* ★ אסימונים קודמים שלא נפדו מבוטלים.
     משתמש שלחץ "התחבר" שלוש פעמים ונטש באמצע השאיר שלושה
     אסימונים חיים. אחד מספיק, והשאר הם רק משטח תקיפה. */
  UPDATE game.access_codes SET revoked_at = now()
   WHERE user_id = v_uid AND kind = 'transfer'
     AND redeemed_at IS NULL AND revoked_at IS NULL;

  v_code := game.gen_pass_code(10);

  INSERT INTO game.access_codes (code_hash, user_id, kind, expires_at)
  VALUES (encode(digest(v_code, 'sha256'), 'hex'), v_uid, 'transfer',
          now() + INTERVAL '15 minutes');

  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION game.issue_merge_token() TO authenticated;

/**
 * ★ האם לאורח הזה יש בכלל מה להעביר.
 *
 * בלי הבדיקה הזו היינו מנפיקים אסימון בכל התחברות, כולל של
 * מישהו שנכנס לפני שנייה ולא עשה כלום — כלומר שורה מיותרת
 * בטבלה בכל לחיצה, ומיזוג שאין בו שום דבר.
 */
CREATE OR REPLACE FUNCTION game.has_anything()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
  SELECT EXISTS (SELECT 1 FROM game.user_lineups
                  WHERE user_id = auth.uid() AND status <> 'draft')
      OR EXISTS (SELECT 1 FROM game.lineup_drafts WHERE user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM game.league_members WHERE user_id = auth.uid());
$$;

GRANT EXECUTE ON FUNCTION game.has_anything() TO authenticated;

UPDATE game.data_revision
   SET revision = revision + 1, scope = 'migration-23', updated_at = now()
 WHERE id = 1;


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
