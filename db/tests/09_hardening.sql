-- =====================================================================
--  db/tests/09_hardening.sql — ההקשחה, מנקודת המבט של התוקף
-- =====================================================================
--
--  ★★ הבדיקה הזו מתחזה ל-anon ולא בודקת קטלוגים ★★
--
--  אפשר היה לבדוק את `information_schema.role_table_grants`
--  ולספור הרשאות. זו בדיקה חלשה: היא בודקת שהכוונה נרשמה, לא
--  שהדלת נעולה. RLS, הרשאות עמודה, ותפקידים שיורשים זה מזה —
--  כל אחד מהם יכול להפוך "אין GRANT" ל"בכל זאת אפשר".
--
--  לכן `SET ROLE anon` והרצת ההתקפה עצמה. אם השורה נכתבת,
--  הבדיקה נופלת.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

-- ---------------------------------------------------------------------
-- 1. ★★★ ההתקפה שהמיגרציה נכתבה בשבילה ★★★
--
--    `game.scoring_overrides` נוצרה ב-db/14, כלומר **אחרי**
--    השלילה שב-db/09. היא ירשה `GRANT ALL` מ-`ALTER DEFAULT
--    PRIVILEGES` שב-db/07, ולכן כל אנונימי יכול היה לשכתב את
--    חוקי הניקוד של המשחק ישירות — בלי לעבור דרך
--    `admin_set_rule` ובלי לעבור את `is_admin()`.
--
--    37 פונקציות אדמין ששומרות על עצמן, וקיר פתוח לידן.
-- ---------------------------------------------------------------------
DO $$
DECLARE t TEXT; ok INT := 0; total INT := 0;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'game.scoring_overrides',   -- חוקי הניקוד החיים
    'game.scoring_history',     -- שובל השינויים בהם
    'game.activity_log',        -- יומן הפעילות
    'game.mode_config',         -- תקציב וגודל הרכב
    'game.house_ads',           -- מה שכתוב למשתמשים
    'game.user_lineups',        -- ההרכבים עצמם
    'game.users'                -- כולל is_admin
  ] LOOP
    total := total + 1;
    BEGIN
      SET LOCAL ROLE anon;
      EXECUTE format('DELETE FROM %s', t);
      RESET ROLE;
      RAISE EXCEPTION 'FAIL 1: anon מחק שורות מ-%', t;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RESET ROLE; ok := ok + 1;
      WHEN OTHERS THEN
        RESET ROLE;
        -- כל שגיאה שאינה "אין הרשאה" עדיין אומרת שהכתיבה לא עברה,
        -- אבל היא לא הסיבה שרצינו. נדווח כדי שלא נירגע בטעות.
        RAISE EXCEPTION 'FAIL 1b: % נחסמה מסיבה לא צפויה: %', t, SQLERRM;
    END;
  END LOOP;

  IF ok <> total THEN
    RAISE EXCEPTION 'FAIL 1c: רק % מתוך % טבלאות חסומות', ok, total;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. גם קריאה ישירה סגורה — הממשק היחיד הוא הפונקציות
-- ---------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM 1 FROM game.users LIMIT 1;
    RESET ROLE;
    RAISE EXCEPTION 'FAIL 2: anon קורא את טבלת המשתמשים ישירות';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
  END;
END $$;

-- ---------------------------------------------------------------------
-- 3. ★ ומה שכן צריך לעבוד — עדיין עובד
--
--    הקשחה שמשביתה את המוצר היא הקשחה שתבוטל בשבוע הבא. זו
--    הבדיקה שמונעת את זה: אורח חייב להמשיך לראות מודעות,
--    מחזור, סגלים ולוח משחקים.
-- ---------------------------------------------------------------------
DO $$
DECLARE v JSONB;
BEGIN
  SET LOCAL ROLE anon;

  IF jsonb_array_length(game.house_ads()) = 0 THEN
    RESET ROLE; RAISE EXCEPTION 'FAIL 3a: אורח לא מקבל מודעות';
  END IF;

  v := game.squads();
  IF v IS NULL OR jsonb_array_length(v->'teams') = 0 THEN
    RESET ROLE; RAISE EXCEPTION 'FAIL 3b: אורח לא מקבל סגלים';
  END IF;

  IF game.current_gameweek() IS NULL THEN
    RESET ROLE; RAISE EXCEPTION 'FAIL 3c: אורח לא מקבל מחזור';
  END IF;

  RESET ROLE;
END $$;

-- ---------------------------------------------------------------------
-- 4. ★★ הגבלת הקצב — האורקלים ★★
--
--    `league_by_code` עונה כן/לא על ניחוש בן שש תווים. בלי
--    תקרה זו רשימה שאפשר להריץ עד שנכנסים לזירה פרטית של
--    מישהו אחר.
--
--    ★ ההתנהגות תחת חסימה היא NULL — בדיוק כמו קוד שלא קיים.
--      הודעת "יותר מדי ניסיונות" הייתה מאשרת לתוקף שהוא
--      מתקרב, ומאפשרת לו לכייל קצב.
-- ---------------------------------------------------------------------
DO $$
DECLARE i INT; blocked BOOLEAN := FALSE;
BEGIN
  DELETE FROM game.probe_attempts;

  FOR i IN 1..40 LOOP
    IF game.league_by_code('ZZZZ' || lpad(i::TEXT, 2, '0')) IS NULL AND i > 30 THEN
      blocked := TRUE;
    END IF;
  END LOOP;

  IF NOT blocked THEN
    RAISE EXCEPTION 'FAIL 4: 40 ניחושי קוד זירה עברו בלי חסימה';
  END IF;

  IF (SELECT count(*) FROM game.probe_attempts WHERE bucket = 'league_code') < 30 THEN
    RAISE EXCEPTION 'FAIL 4b: הניסיונות לא נרשמו';
  END IF;
END $$;

DO $$
DECLARE i INT;
BEGIN
  DELETE FROM game.probe_attempts;

  /* ★ שם קצר מדי נדחה **לפני** המונה.
     טופס הרשמה בודק זמינות בכל הקלדה; אילו כל תו נספר, משתמש
     אמיתי אחד היה נחסם תוך חצי דקה של הקלדה. */
  FOR i IN 1..50 LOOP
    PERFORM game.username_available('ab');
  END LOOP;

  IF (SELECT count(*) FROM game.probe_attempts WHERE bucket = 'username') > 0 THEN
    RAISE EXCEPTION 'FAIL 4c: בדיקות זולות נספרות במונה הקצב';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 5. ★★ שובל הביקורת — הפעולה שהכי קל להכחיש ★★
--
--    `admin_upsert_player_stat` כותבת את הדקות והשערים שמהם
--    נגזר כל הניקוד של כולם. היא הייתה הפעולה היחידה במוצר
--    שמשנה תוצאות ולא משאירה שורה בשום יומן.
-- ---------------------------------------------------------------------
DELETE FROM auth.users WHERE id::TEXT LIKE 'd3000000-%';
INSERT INTO auth.users (id, email, is_anonymous)
VALUES ('d3000000-0000-0000-0000-000000000001', 'admin9@x.test', FALSE);

SET dubid.test_uid = 'd3000000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('מנהל תשע');
SELECT game.claim_admin('hapoelTA14!');

DO $$
DECLARE n_before INT; n_after INT;
BEGIN
  SELECT count(*) INTO n_before FROM game.audit_logs WHERE entity = 'scoring_overrides';

  /* דרך הפונקציה האמיתית, כמו שהאדמין עושה. */
  PERFORM game.admin_set_rule('goal.forward', 6);

  SELECT count(*) INTO n_after FROM game.audit_logs WHERE entity = 'scoring_overrides';
  IF n_after <= n_before THEN
    RAISE EXCEPTION 'FAIL 5: שינוי חוק ניקוד לא נרשם ביומן הביקורת';
  END IF;

  /* ★ ומה נרשם, לא רק שנרשם: מי, ומה היה קודם.
     שורת ביקורת בלי הערך הישן עונה על "משהו השתנה" ולא על
     "מה השתנה" — וזו בדיוק השאלה שנשאלת אחרי ויכוח על ניקוד. */
  IF NOT EXISTS (
    SELECT 1 FROM game.audit_logs
    WHERE entity = 'scoring_overrides'
      AND actor = 'd3000000-0000-0000-0000-000000000001'
      AND new_value IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'FAIL 5b: היומן לא מזהה את המבצע או את הערך החדש';
  END IF;
END $$;

DO $$
DECLARE n_before INT; n_after INT; v_player UUID; v_match UUID;
BEGIN
  /* ★★ הכתיבה הידנית — הנתיב שהכי חשוב לתעד ★★

     טריגר על הטבלה תופס גם `INSERT` ישיר מה-SQL Editor, ולא רק
     קריאה לפונקציית אדמין. זה בדיוק ההבדל בין תיעוד שאפשר
     לעקוף לבין תיעוד שאי אפשר. */
  SELECT count(*) INTO n_before FROM game.audit_logs WHERE entity = 'player_match_stats';

  SELECT id INTO v_player FROM core.players LIMIT 1;

  INSERT INTO core.weekly_matches (gameweek_id, home_team_id, away_team_id, kickoff_at, status)
  SELECT g.id, t1.id, t2.id, g.lock_at, 'finished'
  FROM game.gameweeks g,
       LATERAL (SELECT id FROM core.teams ORDER BY id LIMIT 1) t1,
       LATERAL (SELECT id FROM core.teams ORDER BY id DESC LIMIT 1) t2
  WHERE g.code = 'gw-2'
  ON CONFLICT (gameweek_id, home_team_id, away_team_id) DO UPDATE SET status = 'finished'
  RETURNING id INTO v_match;

  IF v_match IS NULL THEN
    SELECT id INTO v_match FROM core.weekly_matches LIMIT 1;
  END IF;

  /* השיוך לקבוצה מגיע מהסגל, לא מהשחקן: שחקן יכול לעבור. */
  INSERT INTO core.player_match_stats (match_id, player_id, team_id, minutes, goals)
  SELECT v_match, s.player_id, s.team_id, 90, 2
  FROM core.squads s WHERE s.player_id = v_player LIMIT 1
  ON CONFLICT (match_id, player_id) DO UPDATE SET goals = 2;

  SELECT count(*) INTO n_after FROM game.audit_logs WHERE entity = 'player_match_stats';
  IF n_after <= n_before THEN
    RAISE EXCEPTION 'FAIL 5c: כתיבה ישירה לסטטיסטיקת שחקן לא נרשמה ביומן';
  END IF;

  IF (SELECT count(*) FROM game.audit_logs WHERE entity = 'weekly_matches') = 0 THEN
    RAISE EXCEPTION 'FAIL 5d: עדכון תוצאת משחק לא נרשם';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 6. טבלת הגרסאות
-- ---------------------------------------------------------------------
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM game.schema_migrations;
  IF n < 17 THEN RAISE EXCEPTION 'FAIL 6: רק % מיגרציות רשומות', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM game.schema_migrations WHERE version = '18') THEN
    RAISE EXCEPTION 'FAIL 6b: מיגרציה 18 לא רשומה בעצמה';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 7. אין טבלה בלי RLS — לא היום ולא אחרי המיגרציה הבאה
-- ---------------------------------------------------------------------
DO $$
DECLARE bad TEXT;
BEGIN
  SELECT string_agg(n.nspname || '.' || c.relname, ', ') INTO bad
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('game', 'core') AND c.relkind = 'r' AND NOT c.relrowsecurity;

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 7: טבלאות בלי RLS: %', bad;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- ניקוי
-- ---------------------------------------------------------------------
--
--  ★★ בדיקה שמשאירה שורות היא באג בחבילת הבדיקות ★★
--
--  הבדיקה הזו הכניסה משחק ושורת סטטיסטיקה כדי להוכיח שהטריגר
--  יורה. חבילה 01 סופרת שורות סטטיסטיקה במחזור 2 — ולכן
--  בהרצה **שנייה** על אותו מסד היא ראתה שש במקום חמש ונפלה.
--
--  התסמין הוא בדיקה שנכשלת; הסיבה היא שתי חבילות שחולקות מצב.
--  זה בדיוק סוג הכישלון שנראה כמו רגרסיה אמיתית ושורף שעה.
-- ---------------------------------------------------------------------

DELETE FROM core.player_match_stats
 WHERE match_id IN (
   SELECT m.id FROM core.weekly_matches m
   JOIN game.gameweeks g ON g.id = m.gameweek_id
   WHERE g.code = 'gw-2'
     AND m.home_team_id = (SELECT id FROM core.teams ORDER BY id LIMIT 1)
     AND m.away_team_id = (SELECT id FROM core.teams ORDER BY id DESC LIMIT 1)
 );

DELETE FROM core.weekly_matches m
 USING game.gameweeks g
 WHERE g.id = m.gameweek_id AND g.code = 'gw-2'
   AND m.home_team_id = (SELECT id FROM core.teams ORDER BY id LIMIT 1)
   AND m.away_team_id = (SELECT id FROM core.teams ORDER BY id DESC LIMIT 1);

DELETE FROM game.probe_attempts;

SELECT '09_hardening · OK' AS result;
