-- =====================================================================
--  db/tests/13_live_gameweek.sql — המחזור החי
-- =====================================================================
--
--  ★ מה הבדיקה הזו מגנה עליו
--
--  התלונה שהולידה את `db/24` הייתה: "מחזור נפרס על כמה ימים, וכל
--  עדכון בכל משחק צריך להתעדכן בניקוד ובדירוג — אבל צריך כפתור
--  נפרד לסיום מחזור".
--
--  שני הצדדים של המשפט הזה הם שני באגים הפוכים, ושניהם קלים
--  להחזיר בטעות:
--
--   1. הניקוד **לא** מוצג באמצע המחזור  → המוצר מת בין שבת לראשון.
--   2. הניקוד מוצג כ**סופי** באמצע המחזור → הדירוג משקר.
--
--  לכן כל בדיקה כאן בודקת **זוג** דגלים ולא אחד: `live` ו-`final`.
--  בדיקה שמסתכלת רק על `published` הייתה עוברת גם בגרסה שבה
--  `live` תמיד TRUE.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

-- ---------------------------------------------------------------- הכנה
DELETE FROM auth.users WHERE id::TEXT LIKE 'd2400000-%';
INSERT INTO auth.users (id, email, is_anonymous) VALUES
  ('d2400000-0000-0000-0000-000000000001', 'live-boss@dubid.test', FALSE);

SET dubid.test_uid = 'd2400000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('מנהל המחזור החי');
SELECT game.claim_admin('hapoelTA14!');

-- מצב פתיחה נקי: מחזור פתוח, דדליין בעתיד.
SELECT game.admin_set_status('gw-2', 'open');
SELECT game.admin_resync_deadline('gw-2');
SELECT game.admin_set_deadline('gw-2', now() + INTERVAL '2 days');

-- =====================================================================
-- 1 — לפני הנעילה: לא חי, לא סופי
-- =====================================================================
DO $$
DECLARE r JSONB;
BEGIN
  r := game.results('gw-2');

  IF (r->>'live')::BOOLEAN THEN
    RAISE EXCEPTION 'FAIL 1a: המחזור מסומן חי לפני הנעילה';
  END IF;
  IF (r->>'final')::BOOLEAN OR (r->>'published')::BOOLEAN THEN
    RAISE EXCEPTION 'FAIL 1b: המחזור מסומן סופי לפני שנסגר';
  END IF;

  -- ★ תאימות לאחור: כל מסך קיים קורא `published`, והוא חייב
  --   להישאר בדיוק אותו שדה עם אותה משמעות.
  IF (r->>'published') IS NULL THEN
    RAISE EXCEPTION 'FAIL 1c: השדה published נעלם — מסכים קיימים יישברו';
  END IF;
END $$;
\echo '  ✓ 1  לפני הנעילה: live=false, final=false'

-- =====================================================================
-- 2 — אחרי הנעילה: חי, ועדיין לא סופי
-- =====================================================================
SELECT game.admin_set_deadline('gw-2', now() - INTERVAL '1 hour');

DO $$
DECLARE r JSONB;
BEGIN
  r := game.results('gw-2');

  -- ★ הנקודה המרכזית: `live` נגזר מהשעון, לא מעמודת הסטטוס.
  --   הסטטוס כאן עדיין 'open' — אף אחד לא לחץ "נעילה" — והמחזור
  --   בכל זאת חי, כי זה בדיוק התנאי שדוחה הגשות.
  IF NOT (r->>'live')::BOOLEAN THEN
    RAISE EXCEPTION 'FAIL 2a: המחזור נעול ולא מסומן חי (status=%)',
      (SELECT status FROM game.gameweeks WHERE code = 'gw-2');
  END IF;
  IF (r->>'final')::BOOLEAN THEN
    RAISE EXCEPTION 'FAIL 2b: מחזור חי מסומן סופי';
  END IF;
END $$;
\echo '  ✓ 2  אחרי הנעילה: live=true גם כשהסטטוס נשאר open'

-- =====================================================================
-- 3 — עדכון תוצאה זורם החוצה מיד
-- =====================================================================
--
--  ★ מעגל סגור: כותבים דרך פונקציית האדמין, קוראים דרך הפונקציה
--    שהמסך קורא לה. בדיקה שרק מוודאת שה-INSERT לא נפל הייתה
--    עוברת גם כשהקריאה מסננת את השורה החוצה.
DO $$
DECLARE
  v_home TEXT; v_away TEXT; v_player TEXT; v_gw UUID;
  r JSONB; v_before BIGINT; v_after BIGINT;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'gw-2';

  -- משחק כלשהו מהמחזור, במזהים החיצוניים שהאדמין עובד איתם.
  SELECT xh.external_id, xa.external_id INTO v_home, v_away
  FROM core.weekly_matches m
  JOIN core.v_ext xh ON xh.entity_type = 'team' AND xh.entity_id = m.home_team_id
  JOIN core.v_ext xa ON xa.entity_type = 'team' AND xa.entity_id = m.away_team_id
  WHERE m.gameweek_id = v_gw
  LIMIT 1;
  IF v_home IS NULL THEN RAISE EXCEPTION 'FAIL 3a: אין משחקים ב-gw-2'; END IF;

  -- שחקן מהקבוצה הביתית.
  SELECT xp.external_id INTO v_player
  FROM core.squads s
  JOIN core.v_ext xp ON xp.entity_type = 'player' AND xp.entity_id = s.player_id
  WHERE s.team_id = core.team_by_ext(v_home)
    AND s.valid_to IS NULL AND s.status = 'active'
  LIMIT 1;
  IF v_player IS NULL THEN RAISE EXCEPTION 'FAIL 3b: אין שחקנים בקבוצה %', v_home; END IF;

  v_before := game.data_revision_now();

  -- ★ המשחק **בעיצומו**, לא הסתיים.
  PERFORM game.admin_upsert_match('gw-2', v_home, v_away, 1::SMALLINT, 0::SMALLINT, FALSE);
  PERFORM game.admin_upsert_player_stat('gw-2', v_player,
          jsonb_build_object('minutes', 62, 'goals', 1));

  v_after := game.data_revision_now();

  -- ★ הדופק. בלי הטריגר שנוסף ב-`db/24`, מכשיר פתוח לא יידע
  --   שנכנס גול — וזו בדיוק התלונה "לא מתעדכן לייב".
  IF v_after <= v_before THEN
    RAISE EXCEPTION 'FAIL 3c: מונה הגרסה לא עלה אחרי עדכון סטטיסטיקה (% → %)',
      v_before, v_after;
  END IF;

  r := game.results('gw-2');

  IF NOT (r->'performances') ? ('P' || v_player) THEN
    RAISE EXCEPTION 'FAIL 3d: הסטטיסטיקה לא חזרה ב-results עבור P%', v_player;
  END IF;
  IF ((r->'performances'->('P' || v_player)->>'goals')::INT) <> 1 THEN
    RAISE EXCEPTION 'FAIL 3e: הגול לא הגיע למסך';
  END IF;

  -- ★ משחק שלא הסתיים אינו נותן נקודות תוצאה. זה מונע "ניצחון"
  --   שנעלם בדקה 90, וזה גם מה שהופך ניקוד חי להוגן.
  IF (r->'outcomes') ? ('T' || v_home) THEN
    RAISE EXCEPTION 'FAIL 3f: משחק שלא הסתיים נספר כתוצאת קבוצה';
  END IF;

  -- ★ `updatedAt` הוא הזמן האמיתי של העדכון, ולא now() בכל קריאה.
  IF (r->>'updatedAt') IS NULL THEN
    RAISE EXCEPTION 'FAIL 3g: updatedAt ריק אחרי שנכנסה סטטיסטיקה';
  END IF;
END $$;
\echo '  ✓ 3  גול במשחק חי מגיע ל-results, מעלה את מונה הגרסה, ולא נותן נקודות תוצאה'

-- =====================================================================
-- 4 — התקדמות המחזור, כפי שכפתור "סיום מחזור" רואה אותה
-- =====================================================================
DO $$
DECLARE p JSONB; l JSONB; g JSONB;
BEGIN
  p := game.gameweek_progress('gw-2');

  IF (p->>'fixturesTotal')::INT < 1 THEN
    RAISE EXCEPTION 'FAIL 4a: fixturesTotal=% ', p->>'fixturesTotal';
  END IF;
  IF (p->>'fixturesLive')::INT < 1 THEN
    RAISE EXCEPTION 'FAIL 4b: המשחק החי לא נספר';
  END IF;
  IF NOT (p->>'locked')::BOOLEAN THEN
    RAISE EXCEPTION 'FAIL 4c: gameweek_progress לא מזהה שהמחזור נעול';
  END IF;
  IF (p->>'scoredPlayers')::INT < 1 THEN
    RAISE EXCEPTION 'FAIL 4d: scoredPlayers=0 אחרי שנכנסה סטטיסטיקה';
  END IF;

  -- אותם מספרים חייבים להופיע גם ברשימה שלוח הניהול מציג.
  l := game.gameweeks_list();
  SELECT x.value INTO g FROM jsonb_array_elements(l) x WHERE x.value->>'code' = 'gw-2';
  IF g IS NULL THEN RAISE EXCEPTION 'FAIL 4e: gw-2 חסר ב-gameweeks_list'; END IF;
  IF (g->>'fixturesFinal') IS NULL THEN
    RAISE EXCEPTION 'FAIL 4f: fixturesFinal חסר ברשימה — הכפתור יוצג בלי המספר שלידו';
  END IF;
  IF NOT (g->>'locked')::BOOLEAN THEN
    RAISE EXCEPTION 'FAIL 4g: הרשימה לא מסמנת את המחזור כנעול';
  END IF;
END $$;
\echo '  ✓ 4  gameweek_progress ו-gameweeks_list מחזירים את מצב ההתקדמות'

-- =====================================================================
-- 5 — "סיום מחזור" מקבע, ו"פתיחה מחדש" מחזיר
-- =====================================================================
DO $$
DECLARE r JSONB;
BEGIN
  PERFORM game.admin_set_published('gw-2', TRUE);

  r := game.results('gw-2');
  IF NOT (r->>'final')::BOOLEAN THEN RAISE EXCEPTION 'FAIL 5a: final נשאר false אחרי סיום'; END IF;
  IF NOT (r->>'published')::BOOLEAN THEN RAISE EXCEPTION 'FAIL 5b: published נשאר false'; END IF;

  -- ★ הדגל המכריע: מחזור סגור אינו חי. בלי זה המסך היה ממשיך
  --   להציג "חי · מתעדכן" על ניקוד שכבר לא זז.
  IF (r->>'live')::BOOLEAN THEN
    RAISE EXCEPTION 'FAIL 5c: מחזור שנסגר עדיין מסומן חי';
  END IF;

  -- ההגשות עברו ל-scored.
  IF EXISTS (
    SELECT 1 FROM game.user_lineups ul
    JOIN game.gameweeks gw ON gw.id = ul.gameweek_id
    WHERE gw.code = 'gw-2' AND ul.status IN ('submitted','locked')
  ) THEN
    RAISE EXCEPTION 'FAIL 5d: נשארו הגשות שלא עברו ל-scored';
  END IF;

  -- ★ הפיכות. טעות בהזנת תוצאה היא תרחיש ודאי.
  PERFORM game.admin_set_published('gw-2', FALSE);
  r := game.results('gw-2');
  IF (r->>'final')::BOOLEAN THEN RAISE EXCEPTION 'FAIL 5e: פתיחה מחדש לא ביטלה את הסופיות'; END IF;
  IF NOT (r->>'live')::BOOLEAN THEN
    RAISE EXCEPTION 'FAIL 5f: מחזור שנפתח מחדש לא חזר להיות חי';
  END IF;
END $$;
\echo '  ✓ 5  סיום מחזור מקבע, פתיחה מחדש מחזירה למצב חי'

-- =====================================================================
-- 6 — אחרי הנעילה כל ההרכבים גלויים, ולפניה לא
-- =====================================================================
--
--  ★ זו הדרישה "לאחר נעילת ההימורים צריך שיהיה ניתן לצפות בכל
--    הרכב של כל משתמש, להשוואה" — והיא כבר עמדה בשרת. הבדיקה
--    כאן קיימת כדי שהיא לא תיפול בטעות: מסך ההשוואה החדש בנוי
--    כולו על ההנחה הזו.
DO $$
DECLARE e JSONB; v_hidden INT;
BEGIN
  -- נעול (מ-§2 והלאה): שום הגשה לא מוסתרת.
  e := game.entries('gw-2');
  SELECT count(*) INTO v_hidden
  FROM jsonb_array_elements(e) x WHERE (x.value->>'hidden')::BOOLEAN;
  IF v_hidden > 0 THEN
    RAISE EXCEPTION 'FAIL 6a: % הרכבים עדיין מוסתרים אחרי הנעילה', v_hidden;
  END IF;

  -- פתוח: כל מה שאינו שלי מוסתר.
  PERFORM game.admin_set_deadline('gw-2', now() + INTERVAL '1 day');
  e := game.entries('gw-2');
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(e) x
    WHERE x.value->>'userId' <> 'd2400000-0000-0000-0000-000000000001'
      AND NOT (x.value->>'hidden')::BOOLEAN
  ) THEN
    RAISE EXCEPTION 'FAIL 6b: הרכב של משתמש אחר נחשף לפני הנעילה';
  END IF;
END $$;
\echo '  ✓ 6  ההרכבים נפתחים בנעילה, ולא לפניה'

-- ---------------------------------------------------------------- ניקוי
SELECT game.admin_set_deadline('gw-2', now() - INTERVAL '1 hour');
\echo ''
\echo '  ✅ db/tests/13_live_gameweek.sql — הכל עבר'
