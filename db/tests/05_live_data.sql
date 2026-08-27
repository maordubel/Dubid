-- =====================================================================
--  db/tests/05_live_data.sql — הדאטה באמת יושבת בשרת
-- =====================================================================
--
--  ★ מה הבדיקה הזו מגנה עליו
--
--  התלונה שהולידה את מיגרציה 13 הייתה: "הכניסה לאדמין עובדת,
--  אבל זה לא שומר ומשנה באמת את הנתונים". היא הייתה נכונה
--  למחצה — הכתיבה הצליחה, הקריאה מעולם לא קרתה.
--
--  לכן כל בדיקה כאן היא **מעגל סגור**: כותבים דרך פונקציית
--  אדמין, ואז קוראים דרך הפונקציה שהמסך קורא לה, ומוודאים
--  שהערך החדש חזר. בדיקה שרק מוודאת שה-UPDATE לא נפל הייתה
--  עוברת גם בגרסה השבורה.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

-- ---------------------------------------------------------------- הכנה
DELETE FROM auth.users WHERE id::TEXT LIKE 'd1000000-%';
INSERT INTO auth.users (id, email, is_anonymous) VALUES
  ('d1000000-0000-0000-0000-000000000001', 'boss@dubid.test',  FALSE),
  ('d1000000-0000-0000-0000-000000000002', 'plain@dubid.test', FALSE);

SET dubid.test_uid = 'd1000000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('מנהל הבדיקה');
SELECT game.claim_admin('hapoelTA14!');

SET dubid.test_uid = 'd1000000-0000-0000-0000-000000000002';
SELECT game.ensure_profile('שחקן רגיל');
SET dubid.test_uid = 'd1000000-0000-0000-0000-000000000001';

-- ★ החזרת המחזור למצב נקי.
--
--   `01_live_flow` מזיז את הדדליין לעבר כדי לבדוק דחייה, ו-
--   `04_admin_access` משנה סטטוס. הבדיקה הזו רצה **אחריהן**
--   באותו מסד, ובלי איפוס היא נופלת על מצב שבדיקה אחרת השאירה
--   — כלומר על עצמה, לא על המוצר.
SELECT game.admin_set_status('gw-2', 'open');
SELECT game.admin_resync_deadline('gw-2');

-- =====================================================================
-- 1 — הסגל שהמסך מקבל שלם, ובשפה שלו
-- =====================================================================
DO $$
DECLARE s JSONB; t JSONB; p JSONB;
BEGIN
  s := game.squads();

  IF jsonb_array_length(s->'teams')   < 14  THEN RAISE EXCEPTION 'FAIL 1a: פחות מ-14 קבוצות'; END IF;
  IF jsonb_array_length(s->'players') < 300 THEN RAISE EXCEPTION 'FAIL 1b: הסגל חסר'; END IF;

  t := s->'teams'->0;
  IF t->>'id' !~ '^T[0-9]+$' THEN RAISE EXCEPTION 'FAIL 1c: מזהה קבוצה לא בפורמט T<n>: %', t; END IF;
  -- ★ הקיצור העברי. `left(name_en,3)` היה נותן 'Hap' לחמש קבוצות.
  IF t->>'short' ~ '^[A-Za-z]{3}$' THEN
    RAISE EXCEPTION 'FAIL 1d: הקיצור נשאר לטיני — המילוי מ-payload לא רץ: %', t->>'short';
  END IF;

  p := s->'players'->0;
  IF p->>'id' !~ '^P[0-9]+$'     THEN RAISE EXCEPTION 'FAIL 1e: מזהה שחקן: %', p; END IF;
  IF p->>'teamId' !~ '^T[0-9]+$' THEN RAISE EXCEPTION 'FAIL 1f: קבוצת השחקן: %', p; END IF;

  -- ★ הטיפוס בקליינט הוא `1|2|3|4|5` ו-`price: number`. NULL כאן
  --   הוא כרטיס שחקן שבור על המסך, לא שגיאה בקונסול.
  IF (p->>'tier') IS NULL OR (p->>'tier')::INT NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'FAIL 1g: דרג לא חוקי: %', p;
  END IF;
  IF (p->>'price') IS NULL THEN RAISE EXCEPTION 'FAIL 1h: מחיר NULL: %', p; END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(s->'players') x
              WHERE (x.value->>'price') IS NULL OR (x.value->>'tier') IS NULL) THEN
    RAISE EXCEPTION 'FAIL 1i: יש שחקנים בלי מחיר או דרג';
  END IF;
END $$;
\echo '  ✓ 1  game.squads() מחזירה 14 קבוצות ו-351 שחקנים בשפת הקליינט'

-- =====================================================================
-- 2 — לוח המשחקים והדדליין מגיעים מאותו מקום
-- =====================================================================
DO $$
DECLARE f JSONB; v_first TIMESTAMPTZ;
BEGIN
  -- ★ `admin_resync_deadline` נבדקת כאן במפורש: היא הפונקציה
  --   שמחזיקה את הכלל "הדדליין = הבעיטה המוקדמת ביותר", והיא
  --   רצה גם בכל הזזת משחק.
  PERFORM game.admin_resync_deadline('gw-2');
  f := game.fixtures('gw-2');
  IF jsonb_array_length(f->'fixtures') <> 7 THEN
    RAISE EXCEPTION 'FAIL 2a: % משחקים במקום 7', jsonb_array_length(f->'fixtures');
  END IF;
  IF f->'gameweek'->>'id' <> 'gw-2' THEN RAISE EXCEPTION 'FAIL 2b: %', f->'gameweek'; END IF;

  -- הדדליין הוא הבעיטה המוקדמת ביותר, לא המאוחרת.
  SELECT min((x.value->>'kickoff')::TIMESTAMPTZ) INTO v_first
    FROM jsonb_array_elements(f->'fixtures') x;
  IF (f->'gameweek'->>'lockAt')::TIMESTAMPTZ <> v_first THEN
    RAISE EXCEPTION 'FAIL 2c: הדדליין % אינו הבעיטה הראשונה %',
      f->'gameweek'->>'lockAt', v_first;
  END IF;
END $$;
\echo '  ✓ 2  game.fixtures() מחזירה את הלוח, והדדליין נגזר מהבעיטה הראשונה'

-- =====================================================================
-- 3 — ★ המעגל הסגור: שינוי מחיר באדמין נראה במסך
-- =====================================================================
DO $$
DECLARE v_before NUMERIC; v_after NUMERIC; v_rev_before BIGINT; v_rev_after BIGINT;
BEGIN
  SELECT (x.value->>'price')::NUMERIC INTO v_before
    FROM jsonb_array_elements(game.squads()->'players') x
   WHERE x.value->>'id' = 'P101';
  IF v_before IS NULL THEN RAISE EXCEPTION 'FAIL 3a: P101 לא נמצא'; END IF;

  v_rev_before := game.data_revision_now();

  PERFORM game.admin_set_price('101', v_before + 1);

  SELECT (x.value->>'price')::NUMERIC INTO v_after
    FROM jsonb_array_elements(game.squads()->'players') x
   WHERE x.value->>'id' = 'P101';

  -- זו השורה שכל המיגרציה נכתבה בשבילה.
  IF v_after <> v_before + 1 THEN
    RAISE EXCEPTION 'FAIL 3b: המחיר נכתב אבל הקריאה מחזירה % במקום %', v_after, v_before + 1;
  END IF;

  v_rev_after := game.data_revision_now();
  IF v_rev_after <= v_rev_before THEN
    RAISE EXCEPTION 'FAIL 3c: מונה הגרסה לא עלה — מכשירים פתוחים לא יידעו';
  END IF;

  PERFORM game.admin_set_price('101', v_before);      -- החזרה
END $$;
\echo '  ✓ 3  שינוי מחיר באדמין חוזר מיד מ-game.squads() ומעלה את מונה הגרסה'

-- =====================================================================
-- 4 — שחקן חדש נבחר מיד, עם דרג ומחיר
-- =====================================================================
DO $$
DECLARE v_ext TEXT; p JSONB;
BEGIN
  v_ext := game.admin_upsert_player(
             p_ext_team => '1', p_name_he => 'שחקן בדיקה',
             p_position => 'FWD', p_price => 4, p_tier => 2::SMALLINT,
             p_overall_rank => 55, p_nationality => 'ישראל');

  SELECT x.value INTO p
    FROM jsonb_array_elements(game.squads()->'players') x
   WHERE x.value->>'id' = 'P' || v_ext;

  IF p IS NULL THEN RAISE EXCEPTION 'FAIL 4a: שחקן שנוסף לא מופיע בסגל'; END IF;
  IF (p->>'tier')::INT <> 2      THEN RAISE EXCEPTION 'FAIL 4b: דרג: %', p; END IF;
  IF (p->>'price')::NUMERIC <> 4 THEN RAISE EXCEPTION 'FAIL 4c: מחיר: %', p; END IF;
  IF (p->>'rated')::BOOLEAN IS NOT TRUE THEN RAISE EXCEPTION 'FAIL 4d: לא סומן כמדורג: %', p; END IF;
  IF p->>'teamId' <> 'T1' THEN RAISE EXCEPTION 'FAIL 4e: קבוצה: %', p; END IF;

  -- מעבר קבוצה נראה גם הוא
  PERFORM game.admin_move_player(v_ext, '3');
  SELECT x.value INTO p
    FROM jsonb_array_elements(game.squads()->'players') x
   WHERE x.value->>'id' = 'P' || v_ext;
  IF p->>'teamId' <> 'T3' THEN RAISE EXCEPTION 'FAIL 4f: המעבר לא נראה: %', p; END IF;

  -- פציעה: נשאר ברשימה, מסומן
  PERFORM game.admin_set_player_status(v_ext, 'injured');
  SELECT x.value INTO p
    FROM jsonb_array_elements(game.squads()->'players') x
   WHERE x.value->>'id' = 'P' || v_ext;
  IF p IS NULL THEN RAISE EXCEPTION 'FAIL 4g: שחקן פצוע נעלם מהרשימה'; END IF;
  IF p->>'status' <> 'injured' THEN RAISE EXCEPTION 'FAIL 4h: %', p; END IF;

  -- עזיבה: יורד מהרשימה
  PERFORM game.admin_set_player_status(v_ext, 'left');
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(game.squads()->'players') x
              WHERE x.value->>'id' = 'P' || v_ext) THEN
    RAISE EXCEPTION 'FAIL 4i: שחקן שעזב עדיין ניתן לבחירה';
  END IF;
END $$;
\echo '  ✓ 4  הוספה / מעבר / פציעה / עזיבה — כולם נראים בקריאה של המסך'

-- =====================================================================
-- 5 — עריכת קבוצה
-- =====================================================================
DO $$
DECLARE t JSONB;
BEGIN
  PERFORM game.admin_upsert_team('1', 'הפועל באר שבע', NULL, 'הב״ש', 'באר שבע', 'טרנר');
  SELECT x.value INTO t FROM jsonb_array_elements(game.squads()->'teams') x
   WHERE x.value->>'id' = 'T1';
  IF t->>'stadium' <> 'טרנר' THEN RAISE EXCEPTION 'FAIL 5: האצטדיון לא נשמר: %', t; END IF;
END $$;
\echo '  ✓ 5  עריכת קבוצה נשמרת ונקראת'

-- =====================================================================
-- 6 — הזזת משחק מזיזה את הדדליין
-- =====================================================================
DO $$
DECLARE v_lock_before TIMESTAMPTZ; v_lock_after TIMESTAMPTZ; v_match UUID;
BEGIN
  SELECT (game.fixtures('gw-2')->'gameweek'->>'lockAt')::TIMESTAMPTZ INTO v_lock_before;

  -- משחק חדש, מוקדם משעה שעתיים מכולם
  v_match := game.admin_upsert_fixture('gw-2', '1', '2',
               v_lock_before - INTERVAL '2 hours');

  SELECT (game.fixtures('gw-2')->'gameweek'->>'lockAt')::TIMESTAMPTZ INTO v_lock_after;
  IF v_lock_after <> v_lock_before - INTERVAL '2 hours' THEN
    RAISE EXCEPTION 'FAIL 6a: הדדליין לא זז — % במקום %',
      v_lock_after, v_lock_before - INTERVAL '2 hours';
  END IF;

  -- ומסירה מחזירה אותו
  PERFORM game.admin_delete_fixture(v_match);
  SELECT (game.fixtures('gw-2')->'gameweek'->>'lockAt')::TIMESTAMPTZ INTO v_lock_after;
  IF v_lock_after <> v_lock_before THEN
    RAISE EXCEPTION 'FAIL 6b: הדדליין לא חזר: % במקום %', v_lock_after, v_lock_before;
  END IF;
END $$;
\echo '  ✓ 6  הוספת/הסרת משחק מזיזה את הדדליין אוטומטית'

-- =====================================================================
-- 7 — טיוטות: נשמרות בשרת, ולא נראות לאף אחד אחר
-- =====================================================================
DO $$
DECLARE d JSONB;
BEGIN
  PERFORM game.save_draft('gw-2', 'five', '1-2-2', jsonb_build_array(
    jsonb_build_object('slot_no', 1, 'ext_player_id', '101', 'is_captain', TRUE),
    jsonb_build_object('slot_no', 2, 'ext_player_id', '301', 'is_captain', FALSE)));

  d := game.my_drafts('gw-2');
  IF d->'five' IS NULL THEN RAISE EXCEPTION 'FAIL 7a: הטיוטה לא נשמרה'; END IF;
  IF jsonb_array_length(d->'five'->'slots') <> 2 THEN RAISE EXCEPTION 'FAIL 7b: %', d; END IF;
  IF d->'five'->>'formation' <> '1-2-2' THEN RAISE EXCEPTION 'FAIL 7c: %', d; END IF;

  -- שמירה חוזרת דורסת ולא מכפילה
  PERFORM game.save_draft('gw-2', 'five', '1-2-2', jsonb_build_array(
    jsonb_build_object('slot_no', 1, 'ext_player_id', '102', 'is_captain', TRUE)));
  d := game.my_drafts('gw-2');
  IF jsonb_array_length(d->'five'->'slots') <> 1 THEN RAISE EXCEPTION 'FAIL 7d: %', d; END IF;

  -- ★ טיוטה חלקית מותרת. זו כל הנקודה שלה.
  PERFORM game.save_draft('gw-2', 'full', '4-3-3', '[]'::jsonb);
  d := game.my_drafts('gw-2');
  IF d->'full' IS NULL THEN RAISE EXCEPTION 'FAIL 7e: טיוטה ריקה נדחתה'; END IF;
END $$;
\echo '  ✓ 7  טיוטה נשמרת בשרת, נדרסת בשמירה חוזרת, ומותרת חלקית'

DO $$
DECLARE d JSONB;
BEGIN
  SET LOCAL dubid.test_uid = 'd1000000-0000-0000-0000-000000000002';
  d := game.my_drafts('gw-2');
  -- ★ טיוטה של יריב היא בדיוק המידע שהורס תחרות.
  IF d->'five' IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 7f: משתמש אחר רואה טיוטה שאינה שלו: %', d;
  END IF;
END $$;
\echo '  ✓ 7b משתמש אחר לא רואה את הטיוטה'

-- =====================================================================
-- 8 — הטיוטה לא נוגעת בהגשה הרשמית
-- =====================================================================
--
--  ★ זה היה הפיתוי: לשמור טיוטה ב-`game.user_lineups` עם
--    status='draft'. `UNIQUE (user_id, gameweek_id, mode)` היה
--    הופך כל הקלדה בטיוטה להורדת ההגשה החתומה חזרה ל-'draft'.
DO $$
DECLARE v_status TEXT; v_slots INT; v_slots_json JSONB;
BEGIN
  -- ★ ההרכב נבנה מהזול ביותר בכל קבוצה ולא מרשימה מוקלדת.
  --   רשימה קשיחה עלתה 17 מתוך תקציב של 15 — כלומר הבדיקה
  --   נפלה על אילוץ אמיתי, וזו בדיוק הסיבה שהוא קיים.
  SELECT jsonb_agg(jsonb_build_object(
           'slot_no', rn, 'ext_player_id', ext, 'is_captain', rn = 1))
    INTO v_slots_json
    FROM (
      SELECT row_number() OVER (ORDER BY price, ext) AS rn, ext
        FROM (
          SELECT DISTINCT ON (x.value->>'teamId')
                 x.value->>'externalId' AS ext,
                 (x.value->>'price')::NUMERIC AS price
            FROM jsonb_array_elements(game.squads()->'players') x
           WHERE x.value->>'status' = 'active'
           ORDER BY x.value->>'teamId', (x.value->>'price')::NUMERIC
        ) cheapest
       ORDER BY price, ext
       LIMIT 5
    ) five;

  PERFORM game.submit_entry('gw-2', 'five', '1-2-2', v_slots_json, 'מנהל הבדיקה');

  -- ועכשיו ממשיכים לערוך את הטיוטה
  PERFORM game.save_draft('gw-2', 'five', '1-2-2', jsonb_build_array(
    jsonb_build_object('slot_no', 1, 'ext_player_id', '601', 'is_captain', TRUE)));

  SELECT ul.status, count(uls.*) INTO v_status, v_slots
    FROM game.user_lineups ul
    LEFT JOIN game.user_lineup_slots uls ON uls.lineup_id = ul.id
   WHERE ul.user_id = auth.uid() AND ul.mode = 'five'
   GROUP BY ul.status;

  IF v_status <> 'submitted' THEN
    RAISE EXCEPTION 'FAIL 8a: ההגשה ירדה ל-% אחרי עריכת טיוטה', v_status;
  END IF;
  IF v_slots <> 5 THEN RAISE EXCEPTION 'FAIL 8b: ההגשה איבדה סלוטים: %', v_slots; END IF;
END $$;
\echo '  ✓ 8  עריכת טיוטה אחרי הגשה לא נוגעת בהגשה'

-- =====================================================================
-- 9 — מי שאינו אדמין לא משנה כלום
-- =====================================================================
DO $$
DECLARE v_ok BOOLEAN;
BEGIN
  SET LOCAL dubid.test_uid = 'd1000000-0000-0000-0000-000000000002';
  IF game.is_admin() THEN RAISE EXCEPTION 'FAIL 9a: משתמש רגיל הוא אדמין'; END IF;

  FOR v_ok IN SELECT * FROM (VALUES (TRUE)) v LOOP
    BEGIN PERFORM game.admin_set_price('101', 99);
      RAISE EXCEPTION 'FAIL 9b: admin_set_price עבר בלי הרשאה';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%ADMIN_REQUIRED%' THEN RAISE; END IF;
    END;

    BEGIN PERFORM game.admin_upsert_team('1', 'נחטף');
      RAISE EXCEPTION 'FAIL 9c: admin_upsert_team עבר בלי הרשאה';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%ADMIN_REQUIRED%' THEN RAISE; END IF;
    END;

    BEGIN PERFORM game.admin_set_deadline('gw-2', now());
      RAISE EXCEPTION 'FAIL 9d: admin_set_deadline עבר בלי הרשאה';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%ADMIN_REQUIRED%' THEN RAISE; END IF;
    END;

    BEGIN PERFORM game.admin_set_status('gw-2', 'locked');
      RAISE EXCEPTION 'FAIL 9e: admin_set_status עבר בלי הרשאה';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%ADMIN_REQUIRED%' THEN RAISE; END IF;
    END;

    BEGIN PERFORM game.admin_upsert_fixture('gw-2','1','2', now());
      RAISE EXCEPTION 'FAIL 9f: admin_upsert_fixture עבר בלי הרשאה';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%ADMIN_REQUIRED%' THEN RAISE; END IF;
    END;
  END LOOP;
END $$;
\echo '  ✓ 9  כל פונקציות הניהול נדחות למי שאינו אדמין'

-- =====================================================================
-- 10 — הסגל נקרא גם בלי סשן (המסך הראשון של אורח)
-- =====================================================================
DO $$
DECLARE s JSONB;
BEGIN
  SET LOCAL dubid.test_uid = '';
  s := game.squads();
  IF jsonb_array_length(s->'teams') < 14 THEN
    RAISE EXCEPTION 'FAIL 10: אורח בלי סשן לא רואה את הליגה';
  END IF;
  IF game.my_drafts('gw-2') <> '{}'::jsonb THEN
    RAISE EXCEPTION 'FAIL 10b: my_drafts החזירה משהו בלי סשן';
  END IF;
END $$;
\echo '  ✓ 10 הסגל נטען גם בלי סשן; טיוטות לא'

\echo ''
\echo '  ══ 05_live_data: כל הבדיקות עברו ══'
