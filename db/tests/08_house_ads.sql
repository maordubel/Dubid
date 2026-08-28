-- =====================================================================
--  db/tests/08_house_ads.sql — פרסום פנימי
-- =====================================================================
--
--  ★ מה נבדק כאן, ולמה דווקא זה
--
--  לפרסום הפנימי יש שלושה סיכונים אמיתיים, וכולם שקטים:
--
--    1. מודעה שמוצגת כשאסור — קמפיין שפג, מודעה מכובה, חלון
--       שעוד לא נפתח. אף אחד לא מדווח על זה; זה פשוט רץ.
--    2. `ad_event` פתוחה לאנונימי. בלי תקרה זו דלת להצפה.
--    3. `admin_*` בלי הרשאה — כלומר כל אחד עורך את מה שכתוב
--       למשתמשים שלנו.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

DELETE FROM auth.users WHERE id::TEXT LIKE 'd2000000-%';
INSERT INTO auth.users (id, email, is_anonymous) VALUES
  ('d2000000-0000-0000-0000-000000000001', 'admin8@x.test', FALSE),
  ('d2000000-0000-0000-0000-000000000002', 'plain8@x.test', FALSE);

SET dubid.test_uid = 'd2000000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('מנהל שמונה');
SELECT game.claim_admin('hapoelTA14!');

-- ---------------------------------------------------------------------
-- 1. הזרעים עלו, והם תקינים
-- ---------------------------------------------------------------------
DO $$
DECLARE n INT; brands INT;
BEGIN
  SELECT count(*) INTO n FROM game.house_ads;
  IF n < 4 THEN RAISE EXCEPTION 'FAIL 1: רק % מודעות זרע', n; END IF;

  SELECT count(DISTINCT brand) INTO brands FROM game.house_ads;
  IF brands < 2 THEN
    RAISE EXCEPTION 'FAIL 1b: % מותגים — צריך גם טייק מי אאוט וגם אופסיידס', brands;
  END IF;

  -- ★ כל קישור חייב להצביע לדומיין של החברה. מודעה פנימית
  --   שמפנה החוצה היא בדיוק מה שהמערכת הזו לא אמורה לאפשר.
  IF EXISTS (SELECT 1 FROM game.house_ads WHERE url !~ '^https://[a-z]+\.dubelteam\.com') THEN
    RAISE EXCEPTION 'FAIL 1c: מודעה מפנה מחוץ ל-dubelteam.com';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. ★★ הסינון קורה בשרת ★★
--
--    מודעה מכובה, מודעה שטרם נפתחה ומודעה שפגה — אף אחת מהן
--    לא נשלחת לדפדפן בכלל. סינון בקליינט היה אומר שכל קמפיין
--    עתידי, כולל הכותרות שלו, יושב ב-JSON שכל אחד פותח.
-- ---------------------------------------------------------------------
INSERT INTO game.house_ads (id, brand, enabled, headline, body, cta, url, starts_at, ends_at)
VALUES
  ('t-off',    'offsides',  FALSE, 'כבויה',  '', 'x', 'https://offsides.dubelteam.com', NULL, NULL),
  ('t-future', 'offsides',  TRUE,  'עתידית', '', 'x', 'https://offsides.dubelteam.com',
   now() + interval '10 days', NULL),
  ('t-past',   'takemeout', TRUE,  'שפגה',   '', 'x', 'https://takemeout.dubelteam.com',
   NULL, now() - interval '1 day')
ON CONFLICT (id) DO UPDATE SET enabled = EXCLUDED.enabled,
  starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at;

DO $$
DECLARE v JSONB; ids TEXT;
BEGIN
  v := game.house_ads();
  SELECT string_agg(x->>'id', ',') INTO ids FROM jsonb_array_elements(v) x;

  IF ids LIKE '%t-off%'    THEN RAISE EXCEPTION 'FAIL 2a: מודעה מכובה נשלחה (%)', ids; END IF;
  IF ids LIKE '%t-future%' THEN RAISE EXCEPTION 'FAIL 2b: מודעה עתידית נשלחה (%)', ids; END IF;
  IF ids LIKE '%t-past%'   THEN RAISE EXCEPTION 'FAIL 2c: מודעה שפגה נשלחה (%)', ids; END IF;
  IF ids NOT LIKE '%ofs-live%' THEN RAISE EXCEPTION 'FAIL 2d: מודעה פעילה חסרה (%)', ids; END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3. חלון הפוך נחסם במסד, לא רק בטופס
-- ---------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    INSERT INTO game.house_ads (id, brand, headline, cta, url, starts_at, ends_at)
    VALUES ('t-bad-window', 'offsides', 'הפוך', 'x', 'https://offsides.dubelteam.com',
            now() + interval '5 days', now() + interval '1 day');
    RAISE EXCEPTION 'FAIL 3: חלון הפוך התקבל';
  EXCEPTION WHEN check_violation THEN
    NULL;   -- זה מה שצריך לקרות
  END;
END $$;

-- ---------------------------------------------------------------------
-- 4. קישור שאינו https נחסם
-- ---------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    INSERT INTO game.house_ads (id, brand, headline, cta, url)
    VALUES ('t-http', 'offsides', 'לא בטוח', 'x', 'http://offsides.dubelteam.com');
    RAISE EXCEPTION 'FAIL 4: קישור http התקבל';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END $$;

-- ---------------------------------------------------------------------
-- 5. ניהול — יצירה, כיבוי, מחיקה, ונרמול המזהה
-- ---------------------------------------------------------------------
DO $$
DECLARE v JSONB; n INT;
BEGIN
  PERFORM game.admin_upsert_ad(
    'Test Ad!! שלום', 'takemeout', 'כותרת בדיקה', 'גוף', 'קדימה',
    'https://takemeout.dubelteam.com', 7, TRUE, ARRAY['lobby','rules']);

  /* ★ המזהה מנורמל: הוא מופיע בכתובת URL ובדוחות, ולכן רווחים
     ועברית בתוכו הופכים כל דוח לתווים מקודדים. */
  SELECT count(*) INTO n FROM game.house_ads WHERE id = 'test-ad';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL 5a: המזהה לא נורמל (%)',
      (SELECT string_agg(id, ',') FROM game.house_ads WHERE headline = 'כותרת בדיקה');
  END IF;

  SELECT weight INTO n FROM game.house_ads WHERE id = 'test-ad';
  IF n <> 7 THEN RAISE EXCEPTION 'FAIL 5b: משקל % במקום 7', n; END IF;

  -- עדכון של אותו מזהה לא מייצר שורה שנייה
  PERFORM game.admin_upsert_ad(
    'test-ad', 'takemeout', 'כותרת מעודכנת', 'גוף', 'קדימה',
    'https://takemeout.dubelteam.com', 3, TRUE, ARRAY['lobby']);
  SELECT count(*) INTO n FROM game.house_ads WHERE id = 'test-ad';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 5c: העדכון יצר שורה כפולה'; END IF;

  PERFORM game.admin_set_ad_enabled('test-ad', FALSE);
  IF (SELECT enabled FROM game.house_ads WHERE id = 'test-ad') THEN
    RAISE EXCEPTION 'FAIL 5d: הכיבוי לא נשמר';
  END IF;

  v := game.admin_ads();
  /* האדמין רואה גם מכובות — אחרת אי אפשר להדליק בחזרה. */
  IF NOT (v::TEXT LIKE '%test-ad%') THEN
    RAISE EXCEPTION 'FAIL 5e: מודעה מכובה לא מופיעה באדמין';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 6. ★★ מדידה — נספרת, מפולחת, ועם תקרה ★★
-- ---------------------------------------------------------------------
DO $$
DECLARE imp INT; clk INT; v JSONB;
BEGIN
  DELETE FROM game.ad_events WHERE ad_id = 'ofs-live';

  PERFORM game.ad_event('ofs-live', 'lobby', 'impression');
  PERFORM game.ad_event('ofs-live', 'lobby', 'impression');
  PERFORM game.ad_event('ofs-live', 'lobby', 'click');

  SELECT count(*) FILTER (WHERE event = 'impression'),
         count(*) FILTER (WHERE event = 'click')
    INTO imp, clk
  FROM game.ad_events WHERE ad_id = 'ofs-live';

  IF imp <> 2 OR clk <> 1 THEN
    RAISE EXCEPTION 'FAIL 6a: % חשיפות, % קליקים', imp, clk;
  END IF;

  /* אירוע לא מוכר נבלע בשקט ולא נכתב — ולא מפיל את הקריאה. */
  PERFORM game.ad_event('ofs-live', 'lobby', 'hack');
  SELECT count(*) INTO imp FROM game.ad_events WHERE ad_id = 'ofs-live';
  IF imp <> 3 THEN RAISE EXCEPTION 'FAIL 6b: אירוע לא מוכר נכתב'; END IF;

  v := game.admin_ad_stats(30);
  IF (v->>'clicks')::INT < 1 THEN RAISE EXCEPTION 'FAIL 6c: הדוח לא סופר קליקים'; END IF;
  IF NOT (v->'byPlacement')::TEXT LIKE '%lobby%' THEN
    RAISE EXCEPTION 'FAIL 6d: אין פילוח לפי מסך';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 7. ★★ התקרה — הדלת שפתוחה לאנונימי ★★
--
--    600 אירועים לדקה למודעה. מעל זה — נבלע. בלי זה, לולאה של
--    שלוש שורות ממלאת את הטבלה במיליוני שורות: חשבון ענן
--    שמתנפח, ודוח קליקים שמשקר.
-- ---------------------------------------------------------------------
DO $$
DECLARE n INT;
BEGIN
  DELETE FROM game.ad_events WHERE ad_id = 'ofs-account';

  INSERT INTO game.ad_events (ad_id, placement, event)
  SELECT 'ofs-account', 'lobby', 'impression' FROM generate_series(1, 600);

  PERFORM game.ad_event('ofs-account', 'lobby', 'impression');

  SELECT count(*) INTO n FROM game.ad_events WHERE ad_id = 'ofs-account';
  IF n <> 600 THEN RAISE EXCEPTION 'FAIL 7: התקרה לא נאכפה (% שורות)', n; END IF;
END $$;

-- ---------------------------------------------------------------------
-- 8. ★★★ הרשאות — כל פונקציית ניהול, בלי יוצא מן הכלל ★★★
-- ---------------------------------------------------------------------
SET dubid.test_uid = 'd2000000-0000-0000-0000-000000000002';
SELECT game.ensure_profile('משתמש רגיל שמונה');

DO $$
DECLARE blocked INT := 0;
BEGIN
  BEGIN PERFORM game.admin_ads();
  EXCEPTION WHEN OTHERS THEN blocked := blocked + 1; END;

  BEGIN PERFORM game.admin_upsert_ad('evil', 'offsides', 'פריצה', '', 'x',
                                     'https://offsides.dubelteam.com');
  EXCEPTION WHEN OTHERS THEN blocked := blocked + 1; END;

  BEGIN PERFORM game.admin_set_ad_enabled('ofs-live', FALSE);
  EXCEPTION WHEN OTHERS THEN blocked := blocked + 1; END;

  BEGIN PERFORM game.admin_delete_ad('ofs-live');
  EXCEPTION WHEN OTHERS THEN blocked := blocked + 1; END;

  BEGIN PERFORM game.admin_ad_stats(30);
  EXCEPTION WHEN OTHERS THEN blocked := blocked + 1; END;

  IF blocked <> 5 THEN
    RAISE EXCEPTION 'FAIL 8: רק % מתוך 5 פונקציות ניהול חסומות למשתמש רגיל', blocked;
  END IF;

  IF EXISTS (SELECT 1 FROM game.house_ads WHERE id = 'evil') THEN
    RAISE EXCEPTION 'FAIL 8b: משתמש רגיל יצר מודעה';
  END IF;

  /* ★ אבל קריאה ציבורית **כן** עובדת — אחרת אין פרסום לאורחים,
     שהם רוב המשתמשים במוצר הזה. */
  IF jsonb_array_length(game.house_ads()) = 0 THEN
    RAISE EXCEPTION 'FAIL 8c: משתמש רגיל לא מקבל מודעות בכלל';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 9. מחיקה לא משכתבת היסטוריה
-- ---------------------------------------------------------------------
SET dubid.test_uid = 'd2000000-0000-0000-0000-000000000001';
DO $$
DECLARE n INT;
BEGIN
  PERFORM game.admin_delete_ad('test-ad');
  IF EXISTS (SELECT 1 FROM game.house_ads WHERE id = 'test-ad') THEN
    RAISE EXCEPTION 'FAIL 9: המודעה לא נמחקה';
  END IF;

  /* ★ האירועים נשארים. דוח של רבעון שעבר לא משתנה כי מודעה
     נמחקה היום — אחרת אי אפשר לסמוך על שום מספר היסטורי. */
  SELECT count(*) INTO n FROM game.ad_events WHERE ad_id = 'ofs-live';
  IF n = 0 THEN RAISE EXCEPTION 'FAIL 9b: מחיקת מודעה מחקה היסטוריה'; END IF;
END $$;

-- ---------------------------------------------------------------------
-- ניקוי
-- ---------------------------------------------------------------------
DELETE FROM game.house_ads WHERE id IN ('t-off', 't-future', 't-past', 'test-ad');
DELETE FROM game.ad_events WHERE ad_id IN ('ofs-account', 'test-ad');

SELECT '08_house_ads · OK' AS result;
