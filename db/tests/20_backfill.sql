-- =====================================================================
--  db/tests/20_backfill.sql — מחזור שנפל חוזר לתור
-- =====================================================================
--
--  ★ מה זה מגן עליו
--
--  מחזור 4 נגמר עם תוצאה לכל שבעת המשחקים ובלי ולו שורת
--  סטטיסטיקה אחת, והקליטה המשיכה הלאה. אף מנגנון לא היה חוזר
--  אליו: `ingest_tick` שואלת את הספק מה המחזור הנוכחי ומקבלת 5.
--  הדרך היחידה הייתה אדם שמריץ פקודה ביד.
--
--  הבדיקה כאן אינה שואלת «האם הפונקציה רצה» אלא «האם מחזור
--  שנפל באמת מזוהה, ובאמת נשלח שוב, ובאמת לא בלולאה».
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

\ir _shared_gameweek.sql

DELETE FROM auth.users WHERE id::TEXT LIKE 'f3400000-%';
INSERT INTO auth.users (id, email, is_anonymous) VALUES
  ('f3400000-0000-0000-0000-000000000001', 'backfill@dubid.test', FALSE);
SET dubid.test_uid = 'f3400000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('מנהל ההשלמה');
SELECT game.claim_admin('hapoelTA14!');

/* ★ בלי נקודת קצה `lifecycle_tick` חוזרת מוקדם עם
   `endpoint_not_configured` ואינה מגיעה כלל לשלב ההשלמה —
   כלומר הבדיקה הייתה «עוברת» בלי לבדוק דבר. */
INSERT INTO game.ingest_secrets (id, function_url, token)
VALUES (TRUE, 'https://example.test/dubid-ingest', 'test-token')
ON CONFLICT (id) DO UPDATE
  SET function_url = EXCLUDED.function_url, token = EXCLUDED.token;

-- =====================================================================
-- 1 — מחזור שנגמר בלי סטטיסטיקה מזוהה
-- =====================================================================
DO $$
DECLARE v_gw UUID;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'gw-2';

  UPDATE game.gameweeks SET status = 'live', lock_at = now() - INTERVAL '2 days'
   WHERE id = v_gw;
  UPDATE core.weekly_matches
     SET status = 'finished', kickoff_at = now() - INTERVAL '2 days',
         home_goals = 1, away_goals = 0
   WHERE gameweek_id = v_gw;
  DELETE FROM core.player_match_stats s
   USING core.weekly_matches m
   WHERE m.id = s.match_id AND m.gameweek_id = v_gw;

  IF NOT EXISTS (SELECT 1 FROM game.gameweek_needs_backfill() WHERE code = 'gw-2') THEN
    RAISE EXCEPTION 'FAIL 1: מחזור שנגמר בלי סטטיסטיקה לא זוהה';
  END IF;
END $$;
\echo '  ✓ 1  מחזור שנגמר בלי שורת סטטיסטיקה אחת מזוהה'

-- =====================================================================
-- 2 — ★ מחזור עם ולו שורה אחת אינו «נפל»
--
--     כיסוי חלקי הוא החלטה של `ingest_check_coverage` ושל
--     האדמין. סריקה חוזרת על מחזור שנקלט היא בזבוז חלון הרצה,
--     ועל ספק שכבר חסם אותנו — גם סיכון.
-- =====================================================================
DO $$
DECLARE v_gw UUID; v_match UUID; v_player UUID; v_team UUID;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'gw-2';
  SELECT id, home_team_id INTO v_match, v_team
    FROM core.weekly_matches WHERE gameweek_id = v_gw LIMIT 1;
  SELECT player_id INTO v_player FROM core.squads
   WHERE team_id = v_team AND valid_to IS NULL LIMIT 1;

  INSERT INTO core.player_match_stats (match_id, player_id, team_id, minutes)
  VALUES (v_match, v_player, v_team, 90)
  ON CONFLICT DO NOTHING;

  IF EXISTS (SELECT 1 FROM game.gameweek_needs_backfill() WHERE code = 'gw-2') THEN
    RAISE EXCEPTION 'FAIL 2: מחזור עם סטטיסטיקה סומן כנפל';
  END IF;

  DELETE FROM core.player_match_stats WHERE match_id = v_match AND player_id = v_player;
END $$;
\echo '  ✓ 2  שורה אחת מספיקה כדי שלא ייחשב שנפל'

-- =====================================================================
-- 3 — ★ ויסות: ניסיון אחד לחצי שעה
--
--     בלעדיו זו לולאה שמפציצה בדיוק את הספק שחסם אותנו — הדרך
--     הבטוחה להפוך חסימה זמנית לקבועה.
-- =====================================================================
DO $$
DECLARE v JSONB;
BEGIN
  DELETE FROM game.ingest_dispatches WHERE origin = 'backfill';
  INSERT INTO game.ingest_dispatches (request_id, origin, requested_at)
  VALUES (-999, 'backfill', now() - INTERVAL '2 minutes')
  ON CONFLICT (request_id) DO UPDATE SET requested_at = EXCLUDED.requested_at;

  v := game.lifecycle_tick();
  IF v #>> '{backfill,held}' IS DISTINCT FROM 'throttled' THEN
    RAISE EXCEPTION 'FAIL 3: ניסיון חוזר לא נחסם על ידי הוויסות (%)', v;
  END IF;

  /* ניסיון ישן — כבר לא חוסם */
  UPDATE game.ingest_dispatches SET requested_at = now() - INTERVAL '2 hours'
   WHERE origin = 'backfill';

  v := game.lifecycle_tick();
  IF v #>> '{backfill,held}' = 'throttled' THEN
    RAISE EXCEPTION 'FAIL 3b: הוויסות חוסם גם אחרי שעתיים';
  END IF;
END $$;
\echo '  ✓ 3  ניסיון אחד לחצי שעה, ולא לולאה'

-- =====================================================================
-- 4 — מחזור שפורסם אינו חוזר לתור
-- =====================================================================
DO $$
BEGIN
  UPDATE game.gameweeks SET status = 'published' WHERE code = 'gw-2';
  IF EXISTS (SELECT 1 FROM game.gameweek_needs_backfill() WHERE code = 'gw-2') THEN
    RAISE EXCEPTION 'FAIL 4: מחזור שפורסם נשלח לסריקה חוזרת';
  END IF;
END $$;
\echo '  ✓ 4  מחזור שפורסם אינו חוזר לתור'

-- =====================================================================
-- 5 — ★ הפונקציה שהוגדרה מחדש נשארה סגורה
--
--     `db/34` כותב מחדש את `lifecycle_tick`, ופונקציה שנוצרת
--     מחדש מקבלת את ברירת המחדל של `db/07` — כלומר `anon`.
--     זו בדיוק הדרך שבה חור נסגר ואז נפתח בלי שאיש שם לב.
-- =====================================================================
DO $$
DECLARE v_open TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    RAISE NOTICE 'אין anon — דילגתי'; RETURN;
  END IF;

  SELECT string_agg(p.proname, ', ') INTO v_open
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'game' AND p.proname = 'lifecycle_tick'
     AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 5: lifecycle_tick נפתחה מחדש ל-anon';
  END IF;
END $$;
\echo '  ✓ 5  ההגדרה מחדש לא פתחה את הפונקציה בחזרה'

\echo ''
\echo '  ✔ 20_backfill — הכל עבר'
