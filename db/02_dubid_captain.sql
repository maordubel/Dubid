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
