-- =====================================================================
--  db/tests/39_league_tables.sql — טבלה ותוצאות לכל ליגה בנפרד
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

-- =====================================================================
-- 1 — league_table() אינה מערבבת ליגות
-- =====================================================================
DO $$
DECLARE v_season UUID; v_gw UUID; t UUID[]; v JSONB;
BEGIN
  SELECT s.id INTO v_season FROM core.seasons s JOIN core.leagues l ON l.id = s.league_id
   WHERE l.code = 'EN_PL' ORDER BY s.is_current DESC LIMIT 1;
  SELECT array_agg(DISTINCT team_id) INTO t FROM (
    SELECT team_id FROM core.squads WHERE season_id = v_season LIMIT 100) x;
  DELETE FROM game.gameweeks WHERE season_id = v_season AND number = 4;
  INSERT INTO game.gameweeks (season_id, number, code, lock_at, status)
  VALUES (v_season, 4, 'en-4', now() - INTERVAL '20 days', 'published') RETURNING id INTO v_gw;
  INSERT INTO core.weekly_matches (gameweek_id, home_team_id, away_team_id, kickoff_at, status, home_goals, away_goals)
  VALUES (v_gw, t[1], t[2], now() - INTERVAL '20 days', 'finished', 3, 1);

  v := game.league_table();
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v) r
              WHERE r->>'team' IN (core.ext_code('team', t[1]), core.ext_code('team', t[2]))) THEN
    RAISE EXCEPTION 'FAIL 1: קבוצה אנגלית בטבלת הליגה הראשית';
  END IF;
END $$;
\echo '  ✓ 1  league_table() — רק הליגה הראשית'

-- =====================================================================
-- 2 — טבלה רשמית: לא ממופה / לא תקינה → נדחית; שלמה → נכתבת
-- =====================================================================
DO $$
DECLARE rows JSONB; r JSONB; n INT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);

  SELECT jsonb_agg(jsonb_build_object(
           'teamProviderId', x.external_id, 'position', x.pos,
           'played', 8, 'won', 4, 'drawn', 2, 'lost', 2,
           'goalsFor', 20 - x.pos, 'goalsAgainst', 5 + x.pos, 'points', 40 - x.pos,
           'form', 'WWDLW'))
    INTO rows
    FROM (SELECT r.external_id, row_number() OVER (ORDER BY r.external_id)::int AS pos
            FROM core.external_refs r
            JOIN core.squads sq ON sq.team_id = r.entity_id AND sq.valid_to IS NULL
            JOIN core.seasons s ON s.id = sq.season_id AND s.is_current
            JOIN core.leagues l ON l.id = s.league_id AND l.code = 'GR_SUPER'
           WHERE r.provider = 'scores365' AND r.entity_type = 'team'
           GROUP BY r.external_id) x;
  n := jsonb_array_length(rows);
  IF n < 10 THEN RAISE EXCEPTION 'SETUP: רק % קבוצות יווניות ממופות', n; END IF;

  r := game.ingest_set_standings('GR_SUPER', 'scores365',
         rows || jsonb_build_array(jsonb_build_object('teamProviderId', 'nope', 'position', 99,
           'played', 1, 'won', 1, 'drawn', 0, 'lost', 0, 'goalsFor', 1, 'goalsAgainst', 0, 'points', 3)));
  IF (r->>'ok')::boolean OR r->>'reason' <> 'unmapped' THEN
    RAISE EXCEPTION 'FAIL 2a: שורה לא ממופה התקבלה (%)', r;
  END IF;

  r := game.ingest_set_standings('GR_SUPER', 'scores365',
         jsonb_set(rows, '{0,won}', '7'));
  IF (r->>'ok')::boolean THEN RAISE EXCEPTION 'FAIL 2b: ניצחונות+תיקו+הפסד ≠ משחקים התקבל'; END IF;

  r := game.ingest_set_standings('GR_SUPER', 'scores365', rows);
  IF NOT (r->>'ok')::boolean OR NOT (r->>'changed')::boolean THEN
    RAISE EXCEPTION 'FAIL 2c: טבלה תקינה נדחתה (%)', r;
  END IF;

  r := game.ingest_set_standings('GR_SUPER', 'scores365', rows);
  IF (r->>'changed')::boolean THEN RAISE EXCEPTION 'FAIL 2d: אותה טבלה סומנה כשינוי'; END IF;
END $$;
\echo '  ✓ 2  טבלה רשמית: חלקית/שגויה נדחית, שלמה נכתבת, זהה — בלי רעש'

-- =====================================================================
-- 3 — הקריאה: ליגה אחת, לפי מיקום, עם שמות
-- =====================================================================
DO $$
DECLARE v JSONB;
BEGIN
  v := game.league_standings('GR_SUPER');
  IF v->>'league' <> 'GR_SUPER' OR jsonb_array_length(v->'rows') < 10 THEN
    RAISE EXCEPTION 'FAIL 3: %', v;
  END IF;
  IF (v #>> '{rows,0,position}')::int <> 1 OR v #>> '{rows,0,names,en}' IS NULL THEN
    RAISE EXCEPTION 'FAIL 3b: סדר/שמות %', v #> '{rows,0}';
  END IF;
  IF jsonb_array_length(game.league_standings('EN_PL')->'rows') <> 0 THEN
    RAISE EXCEPTION 'FAIL 3c: טבלה לליגה בלי נתונים רשמיים';
  END IF;
END $$;
\echo '  ✓ 3  league_standings — ליגה אחת, ממוינת, שמות בשלוש שפות; אין רשמי → ריק'

-- =====================================================================
-- 4 — public_board של מחזור יווני = ליגה יוונית
-- =====================================================================
DO $$
DECLARE v JSONB; v_code TEXT;
BEGIN
  SELECT g.code INTO v_code FROM game.gameweeks g JOIN core.leagues l ON l.id = g.league_id
   WHERE l.code = 'GR_SUPER' ORDER BY g.number LIMIT 1;
  v := game.public_board(v_code);
  IF v->>'league' <> 'GR_SUPER' OR jsonb_array_length(v #> '{standings,rows}') < 10 THEN
    RAISE EXCEPTION 'FAIL 4: %', v - 'fixtures';
  END IF;
  IF jsonb_array_length(v->'table') <> 0 THEN
    RAISE EXCEPTION 'FAIL 4b: טבלה מחושבת של הליגה הראשית הוצמדה למחזור יווני';
  END IF;
  v := game.public_board(NULL);
  IF v->>'league' IS NULL THEN RAISE EXCEPTION 'FAIL 4c: בלי קוד — אין ליגה'; END IF;
END $$;
\echo '  ✓ 4  public_board(gr-*) — תוצאות וטבלה של יוון בלבד'

-- =====================================================================
-- 5 — הרשאות
-- =====================================================================
DO $$
BEGIN
  IF NOT has_function_privilege('anon', 'game.league_standings(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 5a: טבלה ציבורית סגורה לאורח';
  END IF;
  IF has_function_privilege('anon', 'game.ingest_set_standings(text,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'game.ingest_set_standings(text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 5b: כתיבת טבלה פתוחה';
  END IF;
  IF has_table_privilege('anon', 'core.league_standings', 'SELECT')
     OR has_table_privilege('authenticated', 'core.league_standings', 'INSERT') THEN
    RAISE EXCEPTION 'FAIL 5c: גישה ישירה לטבלה';
  END IF;
END $$;
\echo '  ✓ 5  קריאה ציבורית, כתיבה רק למערכת, אין גישה ישירה'

DELETE FROM core.league_standings;
DELETE FROM game.gameweeks WHERE code = 'en-4';
