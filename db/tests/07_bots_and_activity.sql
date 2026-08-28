-- =====================================================================
--  db/tests/07_bots_and_activity.sql — בוטים, יומן פעילות, שם קבוצה
-- =====================================================================
--
--  ★ מה נבדק כאן, ולמה דווקא זה
--
--  שלוש היכולות שנוספו ב-db/16 חולקות סיכון אחד: כולן כותבות
--  לטבלאות שהמשתמש רואה. בוט שנכנס בלי סימון, יומן שמדליף
--  הרכבים, או שם קבוצה שלא נשמר — כולם נראים "עובדים" במסך
--  ונשברים רק כשמסתכלים מקרוב.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

DELETE FROM auth.users WHERE id::TEXT LIKE 'd1000000-%';
INSERT INTO auth.users (id, email, is_anonymous) VALUES
  ('d1000000-0000-0000-0000-000000000001', 'admin7@x.test', FALSE),
  ('d1000000-0000-0000-0000-000000000002', 'human7@x.test', FALSE);

SET dubid.test_uid = 'd1000000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('מנהל שבע');
SELECT game.claim_admin('hapoelTA14!');

-- מחזור פתוח לבדיקה
SELECT game.admin_set_status('gw-2', 'open');
SELECT game.admin_set_deadline('gw-2', now() + interval '2 days');

-- ---------------------------------------------------------------------
-- 1. בוטים — נוספים, מסומנים, ומשחקים לפי החוקים
-- ---------------------------------------------------------------------
DO $$
DECLARE r JSONB; n INT; bad INT;
BEGIN
  r := game.admin_add_bots('gw-2', 'full', 4);

  IF (r->>'added')::INT <> 4 THEN
    RAISE EXCEPTION 'FAIL 1: נוספו % בוטים במקום 4 (%)', r->>'added', r;
  END IF;

  /* ★ החוק המרכזי של המשחק חל גם עליהם: שחקן אחד מכל קבוצה.
     בוט שפטור מהחוק הוא בוט שמנצח בגלל שהוא בוט. */
  SELECT count(*) INTO bad FROM (
    SELECT ul.id FROM game.user_lineups ul
     JOIN game.users u ON u.id = ul.user_id AND u.is_bot
     JOIN game.user_lineup_slots s ON s.lineup_id = ul.id
    GROUP BY ul.id, s.team_id HAVING count(*) > 1
  ) q;
  IF bad > 0 THEN RAISE EXCEPTION 'FAIL 1a: בוט עם שני שחקנים מאותה קבוצה'; END IF;

  SELECT count(*) INTO n FROM game.user_lineup_slots s
   JOIN game.user_lineups ul ON ul.id = s.lineup_id
   JOIN game.users u ON u.id = ul.user_id AND u.is_bot
   WHERE ul.mode = 'full';
  IF n <> 44 THEN RAISE EXCEPTION 'FAIL 1b: % משבצות במקום 44', n; END IF;

  /* ★ מסומנים. הסתרה של זה הופכת כלי לגיטימי להטעיה. */
  SELECT count(*) INTO n FROM game.users WHERE is_bot;
  IF n < 4 THEN RAISE EXCEPTION 'FAIL 1c: בוטים לא מסומנים'; END IF;
END $$;
\echo '  ✓ 1  בוטים נוספים, מסומנים, ומצייתים לחוק "אחד מכל קבוצה"'

-- ---------------------------------------------------------------------
-- 2. הרצה חוזרת אינה מכפילה
-- ---------------------------------------------------------------------
DO $$
DECLARE r JSONB;
BEGIN
  r := game.admin_add_bots('gw-2', 'full', 4);
  IF (r->>'added')::INT <> 0 OR (r->>'skipped')::INT <> 4 THEN
    RAISE EXCEPTION 'FAIL 2: הרצה חוזרת יצרה בוטים כפולים (%)', r;
  END IF;
END $$;
\echo '  ✓ 2  הרצה חוזרת מדלגת — אין בוטים כפולים'

-- ---------------------------------------------------------------------
-- 3. דטרמיניזם — אותו מחזור, אותו הרכב
-- ---------------------------------------------------------------------
DO $$
DECLARE a TEXT; b TEXT;
BEGIN
  SELECT string_agg(s.player_id::TEXT, ',' ORDER BY s.slot_no) INTO a
    FROM game.user_lineups ul
    JOIN game.users u ON u.id = ul.user_id
    JOIN game.user_lineup_slots s ON s.lineup_id = ul.id
   WHERE u.username = 'bot_gw-2_full_1';

  PERFORM game.admin_remove_bots('gw-2', 'full');
  PERFORM game.admin_add_bots('gw-2', 'full', 4);

  SELECT string_agg(s.player_id::TEXT, ',' ORDER BY s.slot_no) INTO b
    FROM game.user_lineups ul
    JOIN game.users u ON u.id = ul.user_id
    JOIN game.user_lineup_slots s ON s.lineup_id = ul.id
   WHERE u.username = 'bot_gw-2_full_1';

  /* ★ `random()` היה הופך כל הרצה חוזרת לתוצאה אחרת — ואת
     הבדיקה הזו לחסרת ערך. הזרע נגזר מקוד המחזור ומהאינדקס. */
  IF a IS DISTINCT FROM b THEN
    RAISE EXCEPTION 'FAIL 3: הבוט בחר הרכב אחר בהרצה שנייה';
  END IF;
END $$;
\echo '  ✓ 3  הבוט דטרמיניסטי — אותו מחזור, אותו הרכב'

-- ---------------------------------------------------------------------
-- 4. בוט בדוביד 5 עומד בתקציב
-- ---------------------------------------------------------------------
DO $$
DECLARE r JSONB; over INT;
BEGIN
  r := game.admin_add_bots('gw-2', 'five', 3);
  IF (r->>'added')::INT < 1 THEN
    RAISE EXCEPTION 'FAIL 4: לא נוסף אף בוט לדוביד 5 (%)', r;
  END IF;

  SELECT count(*) INTO over FROM (
    SELECT ul.id, sum(s.price) AS spent
      FROM game.user_lineups ul
      JOIN game.users u ON u.id = ul.user_id AND u.is_bot
      JOIN game.user_lineup_slots s ON s.lineup_id = ul.id
     WHERE ul.mode = 'five'
     GROUP BY ul.id
  ) q WHERE spent > 15;

  /* ★ בן אדם שחורג מהתקציב נדחה. בוט שפטור הוא באג בתחרות. */
  IF over > 0 THEN RAISE EXCEPTION 'FAIL 4a: % בוטים חרגו מהתקציב', over; END IF;
END $$;
\echo '  ✓ 4  בוט בדוביד 5 עומד בתקציב — כמו בן אדם'

-- ---------------------------------------------------------------------
-- 5. שם קבוצה נשמר בהגשה
-- ---------------------------------------------------------------------
SET dubid.test_uid = 'd1000000-0000-0000-0000-000000000002';
SELECT game.ensure_profile('שחר');

DO $$
DECLARE slots JSONB := '[]'::jsonb; i INT := 0; r RECORD; e JSONB; mine JSONB;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (sq.team_id) xp.external_id AS ext
      FROM core.squads sq
      JOIN core.v_ext xp ON xp.entity_type='player' AND xp.entity_id=sq.player_id
     WHERE sq.valid_to IS NULL
     ORDER BY sq.team_id, xp.external_id
     LIMIT 5
  LOOP
    i := i + 1;
    slots := slots || jsonb_build_array(jsonb_build_object(
      'slot_no', i, 'ext_player_id', r.ext,
      'is_captain', i = 1, 'is_vice', i = 2, 'is_bench', FALSE));
  END LOOP;

  PERFORM game.submit_entry('gw-2', 'five', '2-1-1', slots, 'שחר', 'שכונת התקווה');

  e := game.entries('gw-2');
  SELECT x INTO mine FROM jsonb_array_elements(e) x
   WHERE x->>'userId' = 'd1000000-0000-0000-0000-000000000002';

  IF mine IS NULL THEN RAISE EXCEPTION 'FAIL 5: ההגשה לא חזרה'; END IF;
  IF mine->>'teamName' <> 'שכונת התקווה' THEN
    RAISE EXCEPTION 'FAIL 5a: שם הקבוצה לא נשמר: %', mine->>'teamName';
  END IF;
  IF mine->>'displayName' <> 'שחר' THEN
    RAISE EXCEPTION 'FAIL 5b: שם המאמן לא נשמר: %', mine->>'displayName';
  END IF;
END $$;
\echo '  ✓ 5  שם קבוצה ושם מאמן נשמרים בהגשה'

-- ---------------------------------------------------------------------
-- 6. שם ארוך נחתך ולא מפיל
-- ---------------------------------------------------------------------
DO $$
DECLARE v TEXT;
BEGIN
  PERFORM game.set_entry_team_name('gw-2', 'five', repeat('א', 200));
  SELECT team_name INTO v FROM game.user_lineups ul
   WHERE ul.user_id = 'd1000000-0000-0000-0000-000000000002' AND ul.mode = 'five';
  /* ★ שם של מאתיים תווים לא "נראה רע" — הוא שובר כל שורה
     בטבלה ובכל כרטיס שיתוף. */
  IF length(v) <> 24 THEN RAISE EXCEPTION 'FAIL 6: שם באורך % ולא 24', length(v); END IF;
  PERFORM game.set_entry_team_name('gw-2', 'five', 'שכונת התקווה');
END $$;
\echo '  ✓ 6  שם קבוצה ארוך נחתך ל-24 ולא שובר את הטבלה'

-- ---------------------------------------------------------------------
-- 7. יומן הפעילות רואה את ההגשות — ולא את ההרכבים
-- ---------------------------------------------------------------------
SET dubid.test_uid = 'd1000000-0000-0000-0000-000000000001';

DO $$
DECLARE a JSONB; first JSONB; stats JSONB;
BEGIN
  a := game.admin_activity(50, 'gw-2');
  IF jsonb_array_length(a) < 5 THEN
    RAISE EXCEPTION 'FAIL 7: ביומן % רשומות בלבד', jsonb_array_length(a);
  END IF;

  SELECT x INTO first FROM jsonb_array_elements(a) x
   WHERE x->>'action' = 'submit' LIMIT 1;
  IF first IS NULL THEN RAISE EXCEPTION 'FAIL 7a: אין רשומת הגשה אנושית'; END IF;

  /* ★ משפט מוכן ולא שדות גולמיים: הניסוח הוא החלטת מוצר,
     והוא חייב להיות זהה בהתראה, בייצוא ובדוח. */
  IF (first->>'text') NOT LIKE '%שלח הרכב%' THEN
    RAISE EXCEPTION 'FAIL 7b: הניסוח אינו משפט: %', first->>'text';
  END IF;
  IF (first->>'text') NOT LIKE '%דוביד 5%' THEN
    RAISE EXCEPTION 'FAIL 7c: המצב לא מופיע בשורה: %', first->>'text';
  END IF;

  /* ★ היומן אינו דלת אחורית להרכבים. */
  IF a::TEXT LIKE '%playerId%' OR a::TEXT LIKE '%slots%' THEN
    RAISE EXCEPTION 'FAIL 7d: ★ דליפה ★ היומן מכיל הרכבים';
  END IF;

  stats := game.admin_activity_stats('gw-2');
  IF (stats->>'humans')::INT < 1 THEN RAISE EXCEPTION 'FAIL 7e: אין הגשות אנושיות בסטטיסטיקה'; END IF;
  IF (stats->>'bots')::INT < 4 THEN RAISE EXCEPTION 'FAIL 7f: הבוטים לא נספרו'; END IF;
  IF jsonb_array_length(stats->'byHour') < 1 THEN
    RAISE EXCEPTION 'FAIL 7g: אין פילוח לפי שעה — זה המספר היחיד שמשנה החלטה';
  END IF;
END $$;
\echo '  ✓ 7  יומן הפעילות — משפטים מוכנים, סטטיסטיקה, ובלי הרכבים'

-- ---------------------------------------------------------------------
-- 8. משתמש רגיל אינו רואה את היומן ואינו יכול להוסיף בוטים
-- ---------------------------------------------------------------------
SET dubid.test_uid = 'd1000000-0000-0000-0000-000000000002';

DO $$
BEGIN
  BEGIN
    PERFORM game.admin_activity(10, NULL);
    RAISE EXCEPTION 'FAIL 8: משתמש רגיל קרא את יומן הפעילות';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%ADMIN_REQUIRED%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM game.admin_add_bots('gw-2', 'full', 1);
    RAISE EXCEPTION 'FAIL 8a: משתמש רגיל הוסיף בוטים';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%ADMIN_REQUIRED%' THEN RAISE; END IF;
  END;
END $$;
\echo '  ✓ 8  היומן והבוטים נעולים לאדמין בלבד'

-- ---------------------------------------------------------------------
-- 9. הסרת בוטים
-- ---------------------------------------------------------------------
SET dubid.test_uid = 'd1000000-0000-0000-0000-000000000001';

DO $$
DECLARE r JSONB; n INT;
BEGIN
  r := game.admin_remove_bots('gw-2', NULL);
  IF (r->>'removed')::INT < 4 THEN RAISE EXCEPTION 'FAIL 9: הוסרו % בוטים', r->>'removed'; END IF;

  SELECT count(*) INTO n FROM game.user_lineups ul
   JOIN game.users u ON u.id = ul.user_id AND u.is_bot;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 9a: נשארו % הרכבי בוט', n; END IF;

  /* ★ ההגשה של בן האדם שרדה. הסרת בוטים שמוחקת משתתפים
     אמיתיים היא הדבר הגרוע ביותר שהכפתור הזה יכול לעשות. */
  SELECT count(*) INTO n FROM game.user_lineups
   WHERE user_id = 'd1000000-0000-0000-0000-000000000002';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 9b: ההגשה האנושית נמחקה'; END IF;
END $$;
\echo '  ✓ 9  הסרת בוטים אינה נוגעת במשתתפים אמיתיים'

\echo ''
\echo '  ✓✓ 07 — בוטים, יומן פעילות ושם קבוצה'
