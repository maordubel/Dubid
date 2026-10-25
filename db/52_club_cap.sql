-- =====================================================================
--  db/52_club_cap.sql · מכסת שחקנים למועדון נקבעת לפי המחזור (פלייאוף = 2)
--
--  הבעיה: האילוץ הקשיח one_player_per_team UNIQUE (lineup_id, team_id)
--  (db/01) ו-assert_lineup_valid (v_teams <> v_actual) אוסרים שני שחקנים
--  מאותו מועדון בכל מחזור — כלל הפלייאוף ("עד שניים למועדון") לא יכול
--  היה לעבוד בשרת, גם אחרי תיקון הלקוח.
--
--  התיקון (תואם לאחור, ברירת מחדל = 1 = ההתנהגות הקיימת):
--   1. game.gameweeks.max_players_per_team SMALLINT DEFAULT 1 (1..3).
--   2. האילוץ הייחודי מוחלף בטריגר טרנזקציוני שנועל את שורת ההרכב ואוכף את
--      המכסה של המחזור על כל כתיבה (גם ישירה, עוקפת UI). אותה הודעת שגיאה
--      (one_player_per_team) כדי שהמיפוי בלקוח ימשיך לעבוד.
--   3. assert_lineup_valid בודק max-per-team <= מכסה, לא "הכול שונה".
--   4. game.club_cap(gw_code) קריאה ציבורית; admin_set_club_cap(gw, cap)
--      לאדמין בלבד, רק במחזור draft/open, ולא מתחת למכסה שכבר בשימוש.
-- =====================================================================
SET search_path = game, core, public;

ALTER TABLE game.gameweeks
  ADD COLUMN IF NOT EXISTS max_players_per_team SMALLINT NOT NULL DEFAULT 1;
DO $$ BEGIN
  ALTER TABLE game.gameweeks ADD CONSTRAINT gameweeks_club_cap_range
    CHECK (max_players_per_team BETWEEN 1 AND 3);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

/* אילוץ ייחודי → אכיפה טרנזקציונית לפי מכסת המחזור */
ALTER TABLE game.user_lineup_slots DROP CONSTRAINT IF EXISTS one_player_per_team;
CREATE INDEX IF NOT EXISTS user_lineup_slots_lineup_team_idx
  ON game.user_lineup_slots (lineup_id, team_id);

CREATE OR REPLACE FUNCTION game.enforce_club_cap()
RETURNS trigger LANGUAGE plpgsql
SET search_path = game, core, public
AS $$
DECLARE v_cap SMALLINT; v_n INT;
BEGIN
  /* נעילת שורת ההרכב: שתי הגשות מקבילות לאותו הרכב מסתדרות בתור */
  PERFORM 1 FROM game.user_lineups WHERE id = NEW.lineup_id FOR UPDATE;
  SELECT gw.max_players_per_team INTO v_cap
    FROM game.user_lineups ul JOIN game.gameweeks gw ON gw.id = ul.gameweek_id
   WHERE ul.id = NEW.lineup_id;
  v_cap := COALESCE(v_cap, 1);

  SELECT count(*) INTO v_n FROM game.user_lineup_slots
   WHERE lineup_id = NEW.lineup_id AND team_id = NEW.team_id
     AND NOT (TG_OP = 'UPDATE' AND slot_no = OLD.slot_no AND lineup_id = OLD.lineup_id);
  IF v_n >= v_cap THEN
    RAISE EXCEPTION 'one_player_per_team: max % per club in this gameweek', v_cap
      USING ERRCODE = 'unique_violation', CONSTRAINT = 'one_player_per_team';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_club_cap ON game.user_lineup_slots;
CREATE TRIGGER trg_enforce_club_cap
  BEFORE INSERT OR UPDATE OF team_id, lineup_id ON game.user_lineup_slots
  FOR EACH ROW EXECUTE FUNCTION game.enforce_club_cap();

CREATE OR REPLACE FUNCTION game.assert_lineup_valid(p_lineup_id UUID)
RETURNS VOID LANGUAGE plpgsql
SET search_path = game, core, public
AS $$
DECLARE
  v_required SMALLINT; v_actual SMALLINT; v_maxteam SMALLINT; v_captains SMALLINT; v_cap SMALLINT;
BEGIN
  SELECT COALESCE(mc.lineup_size, l.squad_size), gw.max_players_per_team INTO v_required, v_cap
    FROM game.user_lineups ul
    JOIN game.gameweeks gw ON gw.id = ul.gameweek_id
    JOIN core.seasons  s   ON s.id  = gw.season_id
    JOIN core.leagues  l   ON l.id  = s.league_id
    LEFT JOIN game.mode_config mc ON mc.mode = ul.mode
   WHERE ul.id = p_lineup_id;

  SELECT COALESCE(max(c), 0) INTO v_maxteam FROM (
    SELECT team_id, count(*) AS c FROM game.user_lineup_slots
     WHERE lineup_id = p_lineup_id AND NOT is_bench GROUP BY team_id) t;

  SELECT count(*), count(*) FILTER (WHERE is_captain) INTO v_actual, v_captains
    FROM game.user_lineup_slots WHERE lineup_id = p_lineup_id AND NOT is_bench;

  IF v_actual <> v_required THEN
    RAISE EXCEPTION 'LINEUP_SIZE_INVALID: expected %, got %', v_required, v_actual
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_maxteam > COALESCE(v_cap, 1) THEN
    RAISE EXCEPTION 'DISTINCT_TEAM_CONSTRAINT_VIOLATED: % players from one club, max %', v_maxteam, COALESCE(v_cap, 1)
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_captains <> 1 THEN
    RAISE EXCEPTION 'CAPTAIN_REQUIRED: expected exactly 1 captain, got %', v_captains
      USING ERRCODE = 'check_violation';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION game.club_cap(p_gw_code TEXT)
RETURNS SMALLINT LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$ SELECT COALESCE((SELECT max_players_per_team FROM game.gameweeks WHERE code = p_gw_code), 1)::smallint $$;
GRANT EXECUTE ON FUNCTION game.club_cap(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION game.admin_set_club_cap(p_gw_code TEXT, p_cap SMALLINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE g game.gameweeks%ROWTYPE; v_used INT;
BEGIN
  IF NOT game.can_write_data() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF p_cap IS NULL OR p_cap < 1 OR p_cap > 3 THEN RAISE EXCEPTION 'CAP_RANGE'; END IF;
  SELECT * INTO g FROM game.gameweeks WHERE code = p_gw_code FOR UPDATE;
  IF g.id IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND'; END IF;
  IF g.status NOT IN ('draft','open') THEN RAISE EXCEPTION 'BAD_STATUS'; END IF;
  /* אסור להוריד מתחת למכסה שכבר בשימוש בהגשות קיימות */
  SELECT COALESCE(max(c), 0) INTO v_used FROM (
    SELECT s.lineup_id, s.team_id, count(*) c
      FROM game.user_lineup_slots s JOIN game.user_lineups ul ON ul.id = s.lineup_id
     WHERE ul.gameweek_id = g.id GROUP BY 1, 2) t;
  IF p_cap < v_used THEN RAISE EXCEPTION 'CAP_BELOW_SUBMITTED: % already used', v_used; END IF;
  UPDATE game.gameweeks SET max_players_per_team = p_cap WHERE id = g.id;
  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (game.actor_label(), 'set_club_cap', 'gameweek', g.code,
          jsonb_build_object('from', g.max_players_per_team, 'to', p_cap));
  RETURN jsonb_build_object('gw', g.code, 'cap', p_cap);
END $$;
REVOKE ALL ON FUNCTION game.admin_set_club_cap(TEXT, SMALLINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION game.admin_set_club_cap(TEXT, SMALLINT) TO authenticated;
