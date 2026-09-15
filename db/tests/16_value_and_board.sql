-- =====================================================================
--  db/tests/16_value_and_board.sql — שווי, זמינות, טבלאות
-- =====================================================================
--
--  ★ מה הבדיקות האלה מגנות עליו
--
--  תמחור אוטומטי נוגע בכל שחקן בליגה בכל סריקה. באג בו אינו
--  קורס — הוא מייצר תקציב שלא מגביל, או מוחק כוונון ידני
--  שמישהו עשה בכוונה. שני המצבים נראים תקינים לגמרי במסך.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

\ir _shared_gameweek.sql

DELETE FROM auth.users WHERE id::TEXT LIKE 'a3000000-%';
INSERT INTO auth.users (id, email, is_anonymous) VALUES
  ('a3000000-0000-0000-0000-000000000001', 'value@dubid.test', FALSE);

SET dubid.test_uid = 'a3000000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('מנהל השווי');
SELECT game.claim_admin('hapoelTA14!');

-- =====================================================================
-- 1 — תמחור: חמש מדרגות, ודירוג יחסי ולא ערך מוחלט
-- =====================================================================
DO $$
DECLARE r JSONB; v_bands JSONB; v_min NUMERIC; v_max NUMERIC;
BEGIN
  /* שווי סינתטי לכל הסגל הפעיל: פיזור מעוות בכוונה — הרבה זולים
     ומעט יקרים, בדיוק כמו ליגת העל האמיתית. */
  UPDATE core.squads s
     SET market_value = CASE
           WHEN (('x' || substr(md5(s.player_id::TEXT), 1, 8))::BIT(32)::BIGINT % 100) > 95
           THEN 2500000 + (('x' || substr(md5(s.player_id::TEXT), 1, 8))::BIT(32)::BIGINT % 500000)
           ELSE 50000 + (('x' || substr(md5(s.player_id::TEXT), 1, 8))::BIT(32)::BIGINT % 600000)
         END
   WHERE s.valid_to IS NULL AND s.status <> 'left';

  r := game.admin_reprice_from_market(FALSE);
  v_bands := r->'bands';

  /* ★ כל חמש המדרגות מאוכלסות. מדרגה ריקה פירושה שהתקציב
     אינו מגביל — ואז אין החלטה בבחירת ההרכב. */
  FOR i IN 1..5 LOOP
    IF (v_bands->>(i::TEXT)) IS NULL THEN
      RAISE EXCEPTION 'FAIL 1a: מדרגה % ריקה · %', i, v_bands;
    END IF;
  END LOOP;

  SELECT min(fantasy_price), max(fantasy_price) INTO v_min, v_max
    FROM core.squads WHERE valid_to IS NULL AND status <> 'left' AND market_value > 0;
  IF v_min <> 1 OR v_max <> 5 THEN
    RAISE EXCEPTION 'FAIL 1b: טווח מחירים % עד %', v_min, v_max;
  END IF;

  /* ★ יקר יותר ≠ זול יותר. מונוטוניות היא כל מה שהמיפוי מבטיח,
     והיא מה שהופך אותו להוגן. */
  IF EXISTS (
    SELECT 1 FROM core.squads a JOIN core.squads b ON TRUE
     WHERE a.valid_to IS NULL AND b.valid_to IS NULL
       AND a.market_value > b.market_value
       AND a.fantasy_price < b.fantasy_price
       AND NOT a.price_locked AND NOT b.price_locked)
  THEN RAISE EXCEPTION 'FAIL 1c: שחקן יקר יותר קיבל מחיר נמוך יותר'; END IF;
END $$;
\echo '  ✓ 1  חמש מדרגות מאוכלסות, והמיפוי מונוטוני'

-- =====================================================================
-- 2 — מחיר ידני נועל, ותמחור אוטומטי לא נוגע בו
-- =====================================================================
DO $$
DECLARE v_ext TEXT; v_player UUID; v_price NUMERIC;
BEGIN
  SELECT core.ext_code('player', s.player_id) INTO v_ext
    FROM core.squads s
   WHERE s.valid_to IS NULL AND s.status <> 'left' AND s.market_value > 0
     AND NOT s.price_locked
   LIMIT 1;

  PERFORM game.admin_set_price(v_ext, 4.5);
  v_player := core.player_by_ext(v_ext);

  IF NOT (SELECT price_locked FROM core.squads
           WHERE player_id = v_player AND valid_to IS NULL LIMIT 1) THEN
    RAISE EXCEPTION 'FAIL 2a: תמחור ידני לא נעל';
  END IF;

  PERFORM game.admin_reprice_from_market(FALSE);

  SELECT fantasy_price INTO v_price FROM core.squads
   WHERE player_id = v_player AND valid_to IS NULL LIMIT 1;

  /* ★ 4.5 ולא מספר שלם: אם התמחור האוטומטי נגע בו, הערך היה
     הופך ל-1..5 עגול, והבדיקה הייתה עוברת בטעות. שבר הוא
     חתימה שאי אפשר לזייף. */
  IF v_price IS DISTINCT FROM 4.5 THEN
    RAISE EXCEPTION 'FAIL 2b: התמחור האוטומטי דרס מחיר נעול (%)', v_price;
  END IF;

  PERFORM game.admin_unlock_price(v_ext);
  PERFORM game.admin_reprice_from_market(FALSE);

  SELECT fantasy_price INTO v_price FROM core.squads
   WHERE player_id = v_player AND valid_to IS NULL LIMIT 1;
  IF v_price = 4.5 THEN RAISE EXCEPTION 'FAIL 2c: שחרור הנעילה לא החזיר אותו לתמחור'; END IF;
END $$;
\echo '  ✓ 2  מחיר ידני נעול מפני התמחור האוטומטי, ושחרור מחזיר אותו'

-- =====================================================================
-- 3 — הרצה יבשה לא משנה דבר
-- =====================================================================
DO $$
DECLARE v_before NUMERIC; v_after NUMERIC; r JSONB;
BEGIN
  SELECT sum(fantasy_price) INTO v_before FROM core.squads WHERE valid_to IS NULL;
  r := game.admin_reprice_from_market(TRUE);
  SELECT sum(fantasy_price) INTO v_after FROM core.squads WHERE valid_to IS NULL;

  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 'FAIL 3: הרצה יבשה שינתה מחירים';
  END IF;
  IF (r->>'dryRun')::BOOLEAN IS NOT TRUE THEN RAISE EXCEPTION 'FAIL 3b'; END IF;
END $$;
\echo '  ✓ 3  הרצה יבשה מדווחת ולא כותבת'

-- =====================================================================
-- 4 — זמינות מהספק, וסימון ידני שגובר
-- =====================================================================
DO $$
DECLARE v_ext TEXT; v_player UUID; v_status TEXT; r JSONB;
BEGIN
  /* ★ בחירה דטרמיניסטית + איפוס.

     קודם נבחר "שחקן כלשהו שסטטוסו active" ב-LIMIT 1 בלי סדר.
     בסוף הבדיקה אותו שחקן יוצא **נעול** (`admin_set_player_status`
     נועל בכוונה), ולכן הרצה שנייה של הקובץ על אותו מסד בחרה
     שחקן נעול והבדיקה נפלה על שארית של עצמה ולא על באג.
     עכשיו הבחירה יציבה (`ORDER BY`) והמצב מאופס לפני הטענה. */
  SELECT core.ext_code('player', s.player_id) INTO v_ext
    FROM core.squads s
   WHERE s.valid_to IS NULL
   ORDER BY s.player_id
   LIMIT 1;
  v_player := core.player_by_ext(v_ext);

  UPDATE core.squads
     SET status = 'active', status_locked = FALSE, status_note = NULL
   WHERE player_id = v_player AND valid_to IS NULL;

  PERFORM core.provider_link('testsrc', 'player', 'SP-1', v_player, NULL);

  r := game.ingest_set_availability(jsonb_build_array(jsonb_build_object(
         'source','testsrc','providerId','SP-1','reason','missing','note','1/12')));

  SELECT status INTO v_status FROM core.squads
   WHERE player_id = v_player AND valid_to IS NULL LIMIT 1;
  IF v_status <> 'injured' THEN RAISE EXCEPTION 'FAIL 4a: הסטטוס %', v_status; END IF;

  IF (SELECT status_note FROM core.squads
       WHERE player_id = v_player AND valid_to IS NULL LIMIT 1) IS NULL THEN
    RAISE EXCEPTION 'FAIL 4b: הסיבה הגולמית לא נשמרה';
  END IF;

  /* אדם יודע יותר: מסמן כשיר, וזה ננעל */
  PERFORM game.admin_set_player_status(v_ext, 'active');
  PERFORM game.ingest_set_availability(jsonb_build_array(jsonb_build_object(
         'source','testsrc','providerId','SP-1','reason','missing')));

  SELECT status INTO v_status FROM core.squads
   WHERE player_id = v_player AND valid_to IS NULL LIMIT 1;
  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'FAIL 4c: הספק דרס סימון ידני (%)', v_status;
  END IF;
END $$;
\echo '  ✓ 4  חסר אצל הספק = לא זמין, וסימון ידני גובר עליו'

-- =====================================================================
-- 5 — ★ הבוט אינו מסומן כבוט
-- =====================================================================
DO $$
DECLARE v JSONB;
BEGIN
  v := game.entries('gw-2');

  /* ★ הטענה היא על **המטען**, לא על המסך. הסתרה ב-UI היא
     הסתרה מאדם שלא פותח DevTools. */
  IF v::TEXT LIKE '%isBot%' THEN
    RAISE EXCEPTION 'FAIL 5: השדה isBot עדיין חוזר לדפדפן';
  END IF;
END $$;
\echo '  ✓ 5  entries() אינה מסגירה מי בוט'

-- =====================================================================
-- 6 — טבלת ליגה: רק משחקים שהסתיימו
-- =====================================================================
DO $$
DECLARE v JSONB; v_rows INT; v_pts INT; v_home UUID; v_away UUID; v_match UUID;
BEGIN
  SELECT m.id, m.home_team_id, m.away_team_id INTO v_match, v_home, v_away
    FROM core.weekly_matches m JOIN game.gameweeks g ON g.id = m.gameweek_id
   WHERE g.code = 'gw-2' LIMIT 1;

  UPDATE core.weekly_matches SET status='finished', home_goals=3, away_goals=1
   WHERE id = v_match;

  v := game.league_table();
  SELECT (e->>'points')::INT INTO v_pts
    FROM jsonb_array_elements(v) e
   WHERE e->>'team' = core.ext_code('team', v_home);
  IF v_pts <> 3 THEN RAISE EXCEPTION 'FAIL 6a: מנצחת קיבלה % נקודות', v_pts; END IF;

  /* משחק חי לא מזיז את הטבלה.

     ★ הטענה ממוקדת בקבוצה של המשחק הזה ולא בגודל הטבלה כולה.
     הבדיקה הקודמת דרשה `count(*) = 0`, כלומר שאין בכל המסד אף
     משחק שהסתיים — טענה שנכונה רק כשקובץ הבדיקה רץ ראשון.
     בהרצה מלאה של החבילה קבצים קודמים כבר סיימו משחקים, והיא
     נפלה על רעש ולא על באג. */
  UPDATE core.weekly_matches SET status='live' WHERE id = v_match;
  v := game.league_table();
  SELECT count(*) INTO v_rows
    FROM jsonb_array_elements(v) e
   WHERE e->>'team' = core.ext_code('team', v_home);
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL 6b: משחק חי נספר בטבלה'; END IF;

  UPDATE core.weekly_matches SET status='finished' WHERE id = v_match;
END $$;
\echo '  ✓ 6  הטבלה נבנית רק ממשחקים שהסתיימו'

-- =====================================================================
-- 7 — לוח פומבי וסיכום — גם למי שלא הגיש
-- =====================================================================
DO $$
DECLARE v JSONB;
BEGIN
  v := game.public_board('gw-2');
  IF v->'gameweek' IS NULL THEN RAISE EXCEPTION 'FAIL 7a: אין מחזור בלוח'; END IF;
  IF jsonb_array_length(v->'fixtures') = 0 THEN RAISE EXCEPTION 'FAIL 7b: אין משחקים'; END IF;
  IF v->'table' IS NULL THEN RAISE EXCEPTION 'FAIL 7c: אין טבלה'; END IF;

  v := game.gameweek_recap('gw-2');
  IF (v->>'exists')::BOOLEAN IS NOT TRUE THEN RAISE EXCEPTION 'FAIL 7d'; END IF;

  /* ★ מי שלא הגיש מקבל תשובה, לא מסך ריק. */
  IF (v->>'hasEntry')::BOOLEAN IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL 7e: hasEntry אמור להיות false';
  END IF;
  IF (v->>'entries') IS NULL THEN RAISE EXCEPTION 'FAIL 7f: אין ספירת משתתפים'; END IF;
END $$;
\echo '  ✓ 7  לוח פומבי וסיכום עובדים גם בלי הגשה'

-- =====================================================================
-- 8 — המונים המדודים מגיעים למנוע, מסוננים
-- =====================================================================
DO $$
DECLARE v_gw UUID; v_match UUID; v_player UUID; v_team UUID; v_actions JSONB;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'gw-2';
  SELECT m.id, m.home_team_id INTO v_match, v_team
    FROM core.weekly_matches m WHERE m.gameweek_id = v_gw LIMIT 1;
  SELECT s.player_id INTO v_player FROM core.squads s
   WHERE s.team_id = v_team AND s.valid_to IS NULL LIMIT 1;

  PERFORM core.apply_player_stat(v_match, v_player, v_team, jsonb_build_object(
    'minutes', 90, 'goals', 0,
    'extra', jsonb_build_object(
      'tacklesWon', 6, 'keyPasses', 2, 'clearances', 0,
      'providerRating', 7.4, 'kilometersCovered', 9.2)));

  SELECT actions INTO v_actions FROM game.gameweek_player_stats(v_gw)
   WHERE player_id = v_player;

  IF (v_actions->>'tacklesWon')::INT <> 6 THEN RAISE EXCEPTION 'FAIL 8a: %', v_actions; END IF;
  IF v_actions ? 'clearances' THEN RAISE EXCEPTION 'FAIL 8b: אפס נכנס כמונה'; END IF;

  /* ★ דירוג הספק ומרחק ריצה אינם פעולות. אם הם היו נכנסים,
     חוק ניקוד על "kilometersCovered" היה מתגמל ריצה סרק — וזה
     בדיוק סוג הכלל שהבריף מזהיר מפניו. */
  IF v_actions ? 'providerRating' OR v_actions ? 'kilometersCovered' THEN
    RAISE EXCEPTION 'FAIL 8c: מטא־דאטה נכנסה כמונה פעולה · %', v_actions;
  END IF;
END $$;
\echo '  ✓ 8  רק מונים אמיתיים מגיעים למנוע — לא דירוג ולא מרחק ריצה'

\echo ''
\echo '  ══ 16_value_and_board: כל הבדיקות עברו ══'
