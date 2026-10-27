-- =====================================================================
--  db/tests/42_house_players.sql — משתתפי הבית (db/60)
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

\ir _shared_gameweek.sql

-- מצב נקי למחזור הבדיקות
DELETE FROM game.user_lineups ul USING game.gameweeks g
 WHERE g.id = ul.gameweek_id AND g.code = 'gw-2'
   AND ul.user_id IN (SELECT user_id FROM game.house_players);
DELETE FROM game.house_schedule hs USING game.gameweeks g WHERE g.id = hs.gameweek_id AND g.code = 'gw-2';
UPDATE game.house_config SET enabled = TRUE, min_per_round = 6, max_per_round = 13;

-- ★ במסד הבדיקות רק 7 מהקבוצות עם סגל משחקות ב-gw-2. משלימים משחקים כך
--   שכל קבוצה עם סגל משחקת — אחרת הבנייה נאלצת (בצדק) לקחת קבוצה בלי משחק,
--   והבדיקה תלויה במזל של ה-UUID-ים (כך נכשל CI ב-0feec22).
DO $$
DECLARE v_gw UUID; v_season UUID; t UUID[]; i INT := 1;
BEGIN
  SELECT id, season_id INTO v_gw, v_season FROM game.gameweeks WHERE code = 'gw-2';
  SELECT array_agg(team_id ORDER BY team_id) INTO t FROM (
    SELECT DISTINCT sq.team_id FROM core.squads sq
     WHERE sq.season_id = v_season AND sq.valid_to IS NULL AND sq.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM core.weekly_matches m WHERE m.gameweek_id = v_gw
                         AND sq.team_id IN (m.home_team_id, m.away_team_id))) x;
  WHILE i + 1 <= COALESCE(array_length(t, 1), 0) LOOP
    INSERT INTO core.weekly_matches (gameweek_id, home_team_id, away_team_id, kickoff_at, status)
    VALUES (v_gw, t[i], t[i + 1], now() + INTERVAL '2 days', 'scheduled');
    i := i + 2;
  END LOOP;
END $$;

-- =====================================================================
-- 1 — סגל: 18 לכל ליגה, שמות אמינים, אף אחד לא "bot"
-- =====================================================================
DO $$
DECLARE n INT; bad INT;
BEGIN
  SELECT min(c), count(*) INTO n, bad FROM (
    SELECT league_id, count(*) c FROM game.house_players GROUP BY league_id) x;
  IF n < 18 OR bad < (SELECT count(*) FROM core.leagues) THEN
    RAISE EXCEPTION 'FAIL 1: סגל חסר (min %, ליגות %)', n, bad;
  END IF;
  SELECT count(*) INTO bad FROM game.house_players hp JOIN game.users u ON u.id = hp.user_id
   WHERE u.display_name ~* 'bot|בוט' OR u.username::TEXT ~* 'bot' OR NOT u.is_bot
      OR length(COALESCE(hp.team_name, '')) > 24 OR u.username::TEXT !~ '^player_[0-9A-F]{8}$';
  IF bad > 0 THEN RAISE EXCEPTION 'FAIL 1b: % זהויות חשודות', bad; END IF;
  IF (SELECT count(*) FROM game.house_players WHERE plays_five) < 13 * (SELECT count(*) FROM core.leagues)
     OR (SELECT count(*) FROM game.house_players WHERE plays_full) < 13 * (SELECT count(*) FROM core.leagues) THEN
    RAISE EXCEPTION 'FAIL 1c: פחות מ-13 זמינים למצב';
  END IF;
END $$;
\echo '  ✓ 1  18 משתתפי בית לכל ליגה, שמות רגילים, מסומנים רק במסד'

-- =====================================================================
-- 2 — תכנון: 6–13 לכל מצב, זמנים לפני הנעילה, ריצה חוזרת לא מכפילה
-- =====================================================================
DO $$
DECLARE r JSONB; n5 INT; n11 INT; late INT;
BEGIN
  r := game.house_tick();
  SELECT count(*) FILTER (WHERE mode = 'five'), count(*) FILTER (WHERE mode = 'full')
    INTO n5, n11 FROM game.house_schedule hs JOIN game.gameweeks g ON g.id = hs.gameweek_id AND g.code = 'gw-2';
  IF n5 NOT BETWEEN 6 AND 13 OR n11 NOT BETWEEN 6 AND 13 THEN
    RAISE EXCEPTION 'FAIL 2: תוכננו % / %', n5, n11;
  END IF;
  SELECT count(*) INTO late FROM game.house_schedule hs JOIN game.gameweeks g ON g.id = hs.gameweek_id
   WHERE g.code = 'gw-2' AND (hs.due_at >= g.lock_at - INTERVAL '19 minutes' OR hs.due_at < now());
  IF late > 0 THEN RAISE EXCEPTION 'FAIL 2b: % זמנים מחוץ לחלון', late; END IF;
  IF (SELECT count(DISTINCT due_at) FROM game.house_schedule hs JOIN game.gameweeks g ON g.id = hs.gameweek_id
       WHERE g.code = 'gw-2') < n5 THEN
    RAISE EXCEPTION 'FAIL 2c: כולם באותה שנייה';
  END IF;
  PERFORM game.house_tick();
  IF (SELECT count(*) FROM game.house_schedule hs JOIN game.gameweeks g ON g.id = hs.gameweek_id
       WHERE g.code = 'gw-2') <> n5 + n11 THEN
    RAISE EXCEPTION 'FAIL 2d: פעימה שנייה שינתה תכנון';
  END IF;
  IF EXISTS (SELECT 1 FROM game.user_lineups ul JOIN game.gameweeks g ON g.id = ul.gameweek_id
              JOIN game.house_players hp ON hp.user_id = ul.user_id WHERE g.code = 'gw-2') THEN
    RAISE EXCEPTION 'FAIL 2e: הוגש לפני הזמן';
  END IF;
END $$;
\echo '  ✓ 2  6–13 לכל מצב, מפוזרים בחלון, לא לפני הזמן, בלי כפילות'

-- =====================================================================
-- 3 — הגשה בזמן: אותם חוקים כמו בן אדם, מערך תקין, תקציב
-- =====================================================================
UPDATE game.house_schedule hs SET due_at = now() - INTERVAL '1 minute'
  FROM game.gameweeks g WHERE g.id = hs.gameweek_id AND g.code = 'gw-2';

DO $$
DECLARE r JSONB; bad INT; n INT; planned INT;
BEGIN
  r := game.house_tick();
  SELECT count(*) INTO planned FROM game.house_schedule hs JOIN game.gameweeks g ON g.id = hs.gameweek_id WHERE g.code = 'gw-2';
  SELECT count(*) INTO n FROM game.house_schedule hs JOIN game.gameweeks g ON g.id = hs.gameweek_id
   WHERE g.code = 'gw-2' AND hs.done_at IS NOT NULL;
  IF n <> planned THEN
    RAISE EXCEPTION 'FAIL 3: הוגשו % מתוך % (%) — %', n, planned, r,
      (SELECT string_agg(DISTINCT problem, ' | ') FROM game.house_schedule WHERE problem IS NOT NULL);
  END IF;

  -- גודל, קפטן אחד, מועדון אחד
  SELECT count(*) INTO bad FROM game.user_lineups ul
    JOIN game.house_players hp ON hp.user_id = ul.user_id
    JOIN game.gameweeks g ON g.id = ul.gameweek_id AND g.code = 'gw-2'
   WHERE ul.status <> 'submitted'
      OR (SELECT count(*) FROM game.user_lineup_slots s WHERE s.lineup_id = ul.id) <> CASE ul.mode WHEN 'five' THEN 5 ELSE 11 END
      OR (SELECT count(*) FROM game.user_lineup_slots s WHERE s.lineup_id = ul.id AND s.is_captain) <> 1
      OR (SELECT count(DISTINCT team_id) FROM game.user_lineup_slots s WHERE s.lineup_id = ul.id)
         <> (SELECT count(*) FROM game.user_lineup_slots s WHERE s.lineup_id = ul.id);
  IF bad > 0 THEN RAISE EXCEPTION 'FAIL 3b: % הרכבים לא תקינים', bad; END IF;

  -- המערך תואם לעמדות; שוער אחד; מספור לפי סדר הקליינט
  SELECT count(*) INTO bad FROM game.user_lineups ul
    JOIN game.house_players hp ON hp.user_id = ul.user_id
    JOIN game.gameweeks g ON g.id = ul.gameweek_id AND g.code = 'gw-2'
   WHERE (SELECT count(*) FROM game.user_lineup_slots s WHERE s.lineup_id = ul.id AND s.position = 'GK') <> 1
      OR (SELECT count(*) FROM game.user_lineup_slots s WHERE s.lineup_id = ul.id AND s.position = 'DEF')
         <> (string_to_array(ul.formation, '-'))[1]::INT
      OR (SELECT min(slot_no) FROM game.user_lineup_slots s WHERE s.lineup_id = ul.id AND s.position = 'GK') <> 1;
  IF bad > 0 THEN RAISE EXCEPTION 'FAIL 3c: % הרכבים לא תואמים למערך', bad; END IF;

  -- תקציב דוביד 5
  SELECT count(*) INTO bad FROM (
    SELECT ul.id FROM game.user_lineups ul
      JOIN game.house_players hp ON hp.user_id = ul.user_id
      JOIN game.gameweeks g ON g.id = ul.gameweek_id AND g.code = 'gw-2'
      JOIN game.user_lineup_slots s ON s.lineup_id = ul.id
     WHERE ul.mode = 'five' GROUP BY ul.id HAVING sum(s.price) > 15) x;
  IF bad > 0 THEN RAISE EXCEPTION 'FAIL 3d: % חרגו מהתקציב', bad; END IF;

  -- רק קבוצות שמשחקות במחזור
  SELECT count(*) INTO bad FROM game.user_lineup_slots s
    JOIN game.user_lineups ul ON ul.id = s.lineup_id
    JOIN game.house_players hp ON hp.user_id = ul.user_id
    JOIN game.gameweeks g ON g.id = ul.gameweek_id AND g.code = 'gw-2'
   WHERE NOT EXISTS (SELECT 1 FROM core.weekly_matches m WHERE m.gameweek_id = g.id
                       AND s.team_id IN (m.home_team_id, m.away_team_id));
  IF bad > 0 THEN RAISE EXCEPTION 'FAIL 3e: % שחקנים מקבוצה שלא משחקת', bad; END IF;
END $$;
\echo '  ✓ 3  הגשה בזמן: גודל, קפטן, מועדון אחד, מערך, תקציב, רק קבוצות המחזור'

-- =====================================================================
-- 4 — מגוון: לא שני הרכבים זהים, לא כולם אותו קפטן
-- =====================================================================
DO $$
DECLARE dup INT; caps INT; forms INT;
BEGIN
  SELECT count(*) - count(DISTINCT sig) INTO dup FROM (
    SELECT ul.mode, string_agg(s.player_id::TEXT, ',' ORDER BY s.player_id) sig
      FROM game.user_lineups ul JOIN game.house_players hp ON hp.user_id = ul.user_id
      JOIN game.gameweeks g ON g.id = ul.gameweek_id AND g.code = 'gw-2'
      JOIN game.user_lineup_slots s ON s.lineup_id = ul.id
     GROUP BY ul.id, ul.mode) x;
  IF dup > 0 THEN RAISE EXCEPTION 'FAIL 4: % הרכבים זהים', dup; END IF;

  SELECT count(DISTINCT s.player_id) INTO caps
    FROM game.user_lineups ul JOIN game.house_players hp ON hp.user_id = ul.user_id
    JOIN game.gameweeks g ON g.id = ul.gameweek_id AND g.code = 'gw-2'
    JOIN game.user_lineup_slots s ON s.lineup_id = ul.id AND s.is_captain;
  IF caps < 3 THEN RAISE EXCEPTION 'FAIL 4b: רק % קפטנים שונים', caps; END IF;

  SELECT count(DISTINCT ul.formation) INTO forms
    FROM game.user_lineups ul JOIN game.house_players hp ON hp.user_id = ul.user_id
    JOIN game.gameweeks g ON g.id = ul.gameweek_id AND g.code = 'gw-2' WHERE ul.mode = 'full';
  IF forms < 2 THEN RAISE EXCEPTION 'FAIL 4c: מערך אחד לכולם'; END IF;
END $$;
\echo '  ✓ 4  מגוון: הרכבים שונים, קפטנים שונים, מערכים שונים'

-- =====================================================================
-- 5 — שום דבר לא יוצא החוצה
-- =====================================================================
DO $$
DECLARE e JSONB;
BEGIN
  e := game.entries('gw-2');
  IF e::TEXT ~* 'isbot|is_bot|house' THEN RAISE EXCEPTION 'FAIL 5: דגל בוט במטען'; END IF;
  IF has_table_privilege('anon', 'game.house_players', 'SELECT')
     OR has_table_privilege('authenticated', 'game.house_schedule', 'SELECT')
     OR has_table_privilege('authenticated', 'game.house_config', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL 5b: טבלאות הבית פתוחות';
  END IF;
  IF has_function_privilege('authenticated', 'game.house_tick()', 'EXECUTE')
     OR has_function_privilege('anon', 'game.house_submit(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 5c: פונקציות פנימיות פתוחות';
  END IF;
END $$;
\echo '  ✓ 5  אין דגל במטען, אין גישה לטבלאות או לפונקציות'

-- =====================================================================
-- 6 — כיבוי ונעילה
-- =====================================================================
DO $$
DECLARE r JSONB;
BEGIN
  UPDATE game.house_config SET enabled = FALSE;
  r := game.house_tick();
  IF (r->>'enabled')::BOOLEAN THEN RAISE EXCEPTION 'FAIL 6: מתג כיבוי לא עובד'; END IF;
  UPDATE game.house_config SET enabled = TRUE;

  -- אחרי הנעילה — לא מגישים
  BEGIN
    PERFORM game.house_submit((SELECT user_id FROM game.house_players ORDER BY slot LIMIT 1),
                              (SELECT id FROM game.gameweeks WHERE code = 'en-4' LIMIT 1), 'five');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;
\echo '  ✓ 6  מתג כיבוי'

DELETE FROM game.house_schedule hs USING game.gameweeks g WHERE g.id = hs.gameweek_id AND g.code = 'gw-2';
DELETE FROM game.user_lineups ul USING game.gameweeks g
 WHERE g.id = ul.gameweek_id AND g.code = 'gw-2'
   AND ul.user_id IN (SELECT user_id FROM game.house_players);
\ir _shared_gameweek.sql
\echo '  ✓✓ 42 — משתתפי הבית'
