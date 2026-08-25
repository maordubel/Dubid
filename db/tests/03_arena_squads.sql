-- =====================================================================
--  db/tests/03_arena_squads.sql — זירות, סגלים, ותקציב
--
--  שלושת הדברים שנוספו ב-`db/11`. שני הראשונים היו קיימים במסד
--  ולא היו מחוברים; השלישי לא היה קיים בכלל.
--
--  הרצה (אחרי 00_supabase_shim + 01→11):
--    psql -d dubid_test -v ON_ERROR_STOP=1 -f db/tests/03_arena_squads.sql
-- =====================================================================

\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

-- ★ ניקוי — כדי שהקובץ ירוץ שוב ושוב, ובכל סדר.
DELETE FROM auth.users WHERE id::TEXT LIKE 'e0000000-%';

-- ★ וגם שחקני הבדיקה. בלי זה, הרצה שנייה יוצרת "שחקן בדיקה"
--   שני, ו-`SELECT ... INTO` בשלב 9 בוחר שרירותית בין השניים —
--   לפעמים את זה שכבר סומן "עזב", ואז הבדיקה נופלת על
--   PLAYER_NOT_IN_SQUAD בלי שום קשר למה שהיא בודקת.
DELETE FROM core.players WHERE name_he = 'שחקן בדיקה';

INSERT INTO auth.users (id, email, is_anonymous) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'owner@x.com',  FALSE),
  ('e0000000-0000-0000-0000-000000000002', 'friend@x.com', FALSE),
  ('e0000000-0000-0000-0000-000000000003', 'nosy@x.com',   FALSE);

SET dubid.test_uid = 'e0000000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('המייסד');
SET dubid.test_uid = 'e0000000-0000-0000-0000-000000000002';
SELECT game.ensure_profile('החבר');
SET dubid.test_uid = 'e0000000-0000-0000-0000-000000000003';
SELECT game.ensure_profile('הסקרן');

-- ---------------------------------------------------------------------
-- 1. יצירה — המייסד מצורף באותה טרנזקציה
-- ---------------------------------------------------------------------
SET dubid.test_uid = 'e0000000-0000-0000-0000-000000000001';
SELECT game.create_league('זירת הבדיקה', 'five', 10);

DO $$
DECLARE r JSONB; n INT;
BEGIN
  r := game.my_leagues();
  n := jsonb_array_length(r->'leagues');
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 1: expected 1 league, got %', n; END IF;

  -- ★ זירה בלי מייסד היא זירה שאף אחד לא יכול לנהל.
  n := jsonb_array_length(r->'members');
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 1b: המייסד לא צורף'; END IF;

  IF (r->'members'->0->>'displayName') <> 'המייסד' THEN
    RAISE EXCEPTION 'FAIL 1c: שם לא הוחזר — %', r->'members'->0;
  END IF;
END $$;
\echo '  ✓ 1  יצירת זירה — המייסד מצורף, והשם חוזר לתצוגה'

-- ---------------------------------------------------------------------
-- 2. ★★ הצטרפות משתמש שני — הבאג שלא היה נראה ★★
-- ---------------------------------------------------------------------
--  ב-localStorage שני אנשים עם אותו קוד הצטרפו לשתי זירות שונות,
--  כל אחת בדפדפן שלו, כל אחת עם טבלה של איש אחד. הכל נראה תקין
--  בכל מכשיר בנפרד — וזו הסיבה שהבאג שרד.
DO $$
DECLARE v_code TEXT; n INT;
BEGIN
  SELECT code INTO v_code FROM game.leagues WHERE name = 'זירת הבדיקה';

  PERFORM set_config('dubid.test_uid', 'e0000000-0000-0000-0000-000000000002', TRUE);
  PERFORM game.join_league(v_code);

  n := jsonb_array_length(game.my_leagues()->'members');
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL 2: החבר רואה % חברים במקום 2', n; END IF;

  -- ואותו דבר בדיוק מהצד של המייסד — **אותה זירה**.
  PERFORM set_config('dubid.test_uid', 'e0000000-0000-0000-0000-000000000001', TRUE);
  n := jsonb_array_length(game.my_leagues()->'members');
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL 2b: המייסד רואה % חברים במקום 2', n; END IF;
END $$;
\echo '  ✓ 2  שני משתמשים, קוד אחד — ושניהם באותה זירה'

-- ---------------------------------------------------------------------
-- 3. מי שלא חבר — לא רואה
-- ---------------------------------------------------------------------
SET dubid.test_uid = 'e0000000-0000-0000-0000-000000000003';
DO $$
DECLARE n INT;
BEGIN
  n := jsonb_array_length(game.my_leagues()->'leagues');
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 3: לא-חבר רואה % זירות', n; END IF;
END $$;
\echo '  ✓ 3  מי שאינו חבר לא רואה את הזירה'

-- ---------------------------------------------------------------------
-- 4. הצצה בקוד — שם ומספר בלבד, בלי שמות החברים
-- ---------------------------------------------------------------------
DO $$
DECLARE v_code TEXT; p JSONB;
BEGIN
  SELECT code INTO v_code FROM game.leagues WHERE name = 'זירת הבדיקה';
  p := game.league_by_code(v_code);
  IF (p->>'name') <> 'זירת הבדיקה' THEN RAISE EXCEPTION 'FAIL 4: שם שגוי'; END IF;
  IF (p->>'members')::INT <> 2 THEN RAISE EXCEPTION 'FAIL 4b: מספר חברים שגוי'; END IF;
  -- מי שיש לו קוד תקף עדיין אינו חבר.
  IF p ? 'memberNames' OR p ? 'ownerId' THEN
    RAISE EXCEPTION 'FAIL 4c: ההצצה חושפת יותר מדי';
  END IF;
END $$;
\echo '  ✓ 4  הצצה לפי קוד — בלי לחשוף מי בפנים'

-- ---------------------------------------------------------------------
-- 5. המייסד לא יכול לצאת
-- ---------------------------------------------------------------------
SET dubid.test_uid = 'e0000000-0000-0000-0000-000000000001';
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM game.leagues WHERE name = 'זירת הבדיקה';
  BEGIN
    PERFORM game.leave_league(v_id);
    RAISE EXCEPTION 'FAIL 5: המייסד יצא';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%OWNER_CANNOT_LEAVE%' THEN RAISE; END IF;
  END;
END $$;
\echo '  ✓ 5  מייסד לא יכול לצאת — אין זירות יתומות'

-- ---------------------------------------------------------------------
-- 6. ★★ התקציב — האילוץ שהיה קיים רק בדפדפן ★★
-- ---------------------------------------------------------------------
UPDATE game.gameweeks SET status='open', lock_at = now() + interval '2 days' WHERE code='gw-2';

DO $$
DECLARE ids TEXT[]; slots JSONB; i INT; total NUMERIC;
BEGIN
  -- חמישה שחקנים ב-5 מיליון, כל אחד מקבוצה אחרת = 25 > 15
  SELECT array_agg(x.ext), sum(x.p) INTO ids, total FROM (
    SELECT DISTINCT ON (sq.team_id) xp.external_id AS ext, sq.fantasy_price AS p
    FROM core.squads sq
    JOIN core.v_ext xp ON xp.entity_type='player' AND xp.entity_id=sq.player_id
    WHERE sq.valid_to IS NULL AND sq.fantasy_price = 5
    ORDER BY sq.team_id, xp.external_id LIMIT 5) x;

  IF array_length(ids,1) <> 5 THEN
    RAISE EXCEPTION 'FAIL 6: לא נמצאו 5 שחקנים ב-5 מיליון — המחירים לא בסיד?';
  END IF;

  slots := '[]'::jsonb;
  FOR i IN 1..5 LOOP
    slots := slots || jsonb_build_array(jsonb_build_object(
      'slot_no', i, 'ext_player_id', ids[i],
      'is_captain', i = 1, 'is_vice', FALSE, 'is_bench', FALSE));
  END LOOP;

  PERFORM set_config('dubid.test_uid', 'e0000000-0000-0000-0000-000000000003', TRUE);
  BEGIN
    PERFORM game.submit_entry('gw-2','five','2-1-1', slots);
    RAISE EXCEPTION 'FAIL 6b: הרכב של % מיליון התקבל מול תקציב 15', total;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%OVER_BUDGET%' THEN RAISE; END IF;
  END;
END $$;
\echo '  ✓ 6  חריגה מתקציב נדחית בשרת — לא רק בפס במסך'

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM game.user_lineups
   WHERE user_id = 'e0000000-0000-0000-0000-000000000003';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 6c: נשאר הרכב חלקי אחרי הדחייה'; END IF;
END $$;
\echo '  ✓ 6b הטרנזקציה מתגלגלת — אין הרכב חלקי במסד'

-- ---------------------------------------------------------------------
-- 7. סגלים — אדמין בלבד
-- ---------------------------------------------------------------------
DO $$
BEGIN
  PERFORM game.admin_squads();
  RAISE EXCEPTION 'FAIL 7: משתמש רגיל קרא סגלים';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%ADMIN_REQUIRED%' THEN RAISE; END IF;
END $$;
\echo '  ✓ 7  סגלים דורשים הרשאת ניהול'

UPDATE game.users SET is_admin = TRUE WHERE id = 'e0000000-0000-0000-0000-000000000001';
SET dubid.test_uid = 'e0000000-0000-0000-0000-000000000001';

-- ★ ולוודא שהיא באמת **עובדת**, לא רק נדחית.
--   הגרסה הראשונה של הבדיקה בדקה רק את הדחייה, ולכן באג אמיתי
--   בגוף הפונקציה (עמודה בשם שגוי) שרד עד שנכתבה בדיקה אחרת.
DO $$
DECLARE r JSONB; n INT;
BEGIN
  r := game.admin_squads();
  n := jsonb_array_length(r);
  IF n <> 14 THEN RAISE EXCEPTION 'FAIL 7b: % קבוצות במקום 14', n; END IF;
  IF (r->0->>'short') IS NULL THEN RAISE EXCEPTION 'FAIL 7c: אין קיצור קבוצה'; END IF;
  IF jsonb_array_length(r->0->'players') = 0 THEN
    RAISE EXCEPTION 'FAIL 7d: קבוצה בלי שחקנים';
  END IF;
  IF (r->0->'players'->0->>'id') NOT LIKE 'P%' THEN
    RAISE EXCEPTION 'FAIL 7e: מזהה שחקן לא בשפת הקליינט';
  END IF;
END $$;
\echo '  ✓ 7b סגלים חוזרים — 14 קבוצות, קיצורים, ומזהים בשפת הקליינט'

-- ---------------------------------------------------------------------
-- 8. שחקן חדש
-- ---------------------------------------------------------------------
DO $$
DECLARE v_ext TEXT; v_before INT; v_after INT;
BEGIN
  SELECT count(*) INTO v_before FROM core.squads WHERE valid_to IS NULL;

  v_ext := game.admin_upsert_player('3', 'שחקן בדיקה', NULL, 'Test Player', 'FWD', 4.5);

  SELECT count(*) INTO v_after FROM core.squads WHERE valid_to IS NULL;
  IF v_after <> v_before + 1 THEN RAISE EXCEPTION 'FAIL 8: לא נוסף לסגל'; END IF;

  -- ★ המזהה חייב להיות במרחב של הקבוצה (3xx), אחרת הקליינט
  --   לא ידע לאיזו קבוצה הוא שייך.
  IF v_ext::INT / 100 <> 3 THEN
    RAISE EXCEPTION 'FAIL 8b: מזהה % לא במרחב של קבוצה 3', v_ext;
  END IF;
  IF core.player_by_ext(v_ext) IS NULL THEN
    RAISE EXCEPTION 'FAIL 8c: אין מיפוי חיצוני לשחקן החדש';
  END IF;
END $$;
\echo '  ✓ 8  הוספת שחקן — כולל מזהה חיצוני במרחב הנכון'

-- ---------------------------------------------------------------------
-- 9. מעבר קבוצה — סוגר שורה, פותח חדשה
-- ---------------------------------------------------------------------
DO $$
DECLARE v_ext TEXT; v_player UUID; v_open INT; v_closed INT;
BEGIN
  SELECT xp.external_id INTO v_ext
    FROM core.players pl
    JOIN core.v_ext xp ON xp.entity_type='player' AND xp.entity_id=pl.id
   WHERE pl.name_he = 'שחקן בדיקה';

  PERFORM game.admin_move_player(v_ext, '7');
  v_player := core.player_by_ext(v_ext);

  SELECT count(*) FILTER (WHERE valid_to IS NULL),
         count(*) FILTER (WHERE valid_to IS NOT NULL)
    INTO v_open, v_closed
    FROM core.squads WHERE player_id = v_player;

  IF v_open <> 1   THEN RAISE EXCEPTION 'FAIL 9: % שורות פתוחות', v_open; END IF;
  -- ★ ההיסטוריה נשמרת. הרכב שהוגש לפני המעבר עדיין מוסבר.
  IF v_closed <> 1 THEN RAISE EXCEPTION 'FAIL 9b: ההיסטוריה לא נשמרה'; END IF;

  IF (SELECT team_id FROM core.squads WHERE player_id = v_player AND valid_to IS NULL)
     <> core.team_by_ext('7') THEN
    RAISE EXCEPTION 'FAIL 9c: לא עבר לקבוצה הנכונה';
  END IF;
END $$;
\echo '  ✓ 9  מעבר קבוצה — שורה נסגרת, שורה נפתחת, ההיסטוריה חיה'

-- ---------------------------------------------------------------------
-- 10. מחיר וזמינות
-- ---------------------------------------------------------------------
DO $$
DECLARE v_ext TEXT; v_player UUID; v_price NUMERIC; v_status TEXT;
BEGIN
  SELECT xp.external_id INTO v_ext
    FROM core.players pl
    JOIN core.v_ext xp ON xp.entity_type='player' AND xp.entity_id=pl.id
   WHERE pl.name_he = 'שחקן בדיקה';
  v_player := core.player_by_ext(v_ext);

  PERFORM game.admin_set_price(v_ext, 2.5);
  SELECT fantasy_price INTO v_price FROM core.squads
   WHERE player_id = v_player AND valid_to IS NULL;
  IF v_price <> 2.5 THEN RAISE EXCEPTION 'FAIL 10: מחיר %', v_price; END IF;

  BEGIN
    PERFORM game.admin_set_price(v_ext, 500);
    RAISE EXCEPTION 'FAIL 10b: מחיר 500 התקבל';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%PRICE_RANGE%' THEN RAISE; END IF;
  END;

  PERFORM game.admin_set_player_status(v_ext, 'injured');
  SELECT status INTO v_status FROM core.squads
   WHERE player_id = v_player AND valid_to IS NULL;
  IF v_status <> 'injured' THEN RAISE EXCEPTION 'FAIL 10c: מצב %', v_status; END IF;

  -- ★ פצוע נשאר בסגל. שחקן שנעלם מהרשימה נראה כמו באג בדאטה.
  IF NOT EXISTS (SELECT 1 FROM core.squads
                  WHERE player_id = v_player AND valid_to IS NULL) THEN
    RAISE EXCEPTION 'FAIL 10d: פצוע נעלם מהסגל';
  END IF;

  -- 'עזב' כן סוגר.
  PERFORM game.admin_set_player_status(v_ext, 'left');
  IF EXISTS (SELECT 1 FROM core.squads
              WHERE player_id = v_player AND valid_to IS NULL) THEN
    RAISE EXCEPTION 'FAIL 10e: "עזב" לא סגר את שורת הסגל';
  END IF;
END $$;
\echo '  ✓ 10 מחיר, טווח, פציעה שנשארת בסגל, ועזיבה שסוגרת'

\echo ''
\echo '════════════════════════════════════════════'
\echo '  PASS — זירות, סגלים ותקציב'
\echo '════════════════════════════════════════════'
