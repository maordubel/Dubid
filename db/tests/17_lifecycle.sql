-- =====================================================================
--  db/tests/17_lifecycle.sql — מחזור החיים מסתובב לבד
-- =====================================================================
--
--  ★ מה הבדיקה הזו מגנה עליו
--
--  מחזור חיים נכשל בשקט, וזו הצורה הגרועה ביותר של כישלון:
--  אין מסך שנשבר, אין שגיאה — יש רק מחזור שנגמר ולא זז, ומחזור
--  הבא שלא נפתח, ואיש לא יודע למה. בדיוק זה קרה למחזור 4.
--
--  לכן כל בדיקה כאן שואלת «האם הסטטוס באמת מסתובב», ולא «האם
--  הפונקציה רצה בלי שגיאה».
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

\ir _shared_gameweek.sql

-- ---------------------------------------------------------------- הכנה
DELETE FROM auth.users WHERE id::TEXT LIKE 'f3100000-%';
INSERT INTO auth.users (id, email, is_anonymous) VALUES
  ('f3100000-0000-0000-0000-000000000001', 'lifecycle@dubid.test', FALSE);

SET dubid.test_uid = 'f3100000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('מנהל מחזור החיים');
SELECT game.claim_admin('hapoelTA14!');

-- מנקים שאריות
DELETE FROM game.ingest_alerts WHERE gw_code = 'gw-2';
UPDATE game.ingest_config SET enabled = TRUE, auto_publish = TRUE,
                              auto_open_next = TRUE, stable_minutes = 45;

-- =====================================================================
-- 1 — open → locked כשעבר הדדליין
-- =====================================================================
DO $$
DECLARE v_gw UUID; v_status TEXT;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'gw-2';

  /* הדדליין עבר לפני שעה. המשחקים עוד לא התחילו. */
  UPDATE game.gameweeks SET status = 'open', lock_at = now() - INTERVAL '1 hour'
   WHERE id = v_gw;
  UPDATE core.weekly_matches SET status = 'scheduled' WHERE gameweek_id = v_gw;

  PERFORM game.auto_advance();

  SELECT status INTO v_status FROM game.gameweeks WHERE id = v_gw;
  IF v_status <> 'locked' THEN
    RAISE EXCEPTION 'FAIL 1: הסטטוס % ולא locked', v_status;
  END IF;
END $$;
\echo '  ✓ 1  דדליין שעבר נועל את המחזור'

-- =====================================================================
-- 2 — הגשות שנעולות יחד עם המחזור
-- =====================================================================
DO $$
DECLARE v_gw UUID; n INT; r RECORD; i INT := 0; slots JSONB := '[]'::jsonb;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'gw-2';

  /* מחזירים לפתוח, מייצרים הגשה, ונועלים שוב */
  UPDATE game.gameweeks SET status = 'open', lock_at = now() + INTERVAL '1 day'
   WHERE id = v_gw;

  /* ★ הגשה אמיתית דרך נתיב הכתיבה היחיד. הכנסה ישירה
     ל-`user_lineups` נדחית על ידי `assert_lineup_valid`, וטוב
     שכך — הרכב בלי משבצות אינו הרכב. */
  FOR r IN
    SELECT ext FROM (
      SELECT DISTINCT ON (sq.team_id)
             xp.external_id AS ext, COALESCE(sq.fantasy_price, 0) AS price
        FROM core.squads sq
        JOIN core.v_ext xp ON xp.entity_type='player' AND xp.entity_id=sq.player_id
       WHERE sq.valid_to IS NULL AND sq.status = 'active'
       ORDER BY sq.team_id, COALESCE(sq.fantasy_price, 0), xp.external_id
    ) q ORDER BY q.price, q.ext LIMIT 5
  LOOP
    i := i + 1;
    slots := slots || jsonb_build_array(jsonb_build_object(
      'slot_no', i, 'ext_player_id', r.ext,
      'is_captain', i = 1, 'is_vice', i = 2, 'is_bench', FALSE));
  END LOOP;

  PERFORM game.submit_entry('gw-2', 'five', '2-1-1', slots, 'בודק', 'מחזור החיים');

  UPDATE game.gameweeks SET lock_at = now() - INTERVAL '1 minute' WHERE id = v_gw;
  PERFORM game.auto_advance();

  SELECT count(*) INTO n FROM game.user_lineups
   WHERE gameweek_id = v_gw AND status = 'submitted';
  IF n > 0 THEN
    RAISE EXCEPTION 'FAIL 2: % הגשות נשארו submitted אחרי הנעילה', n;
  END IF;
END $$;
\echo '  ✓ 2  ההגשות ננעלות יחד עם המחזור'

-- =====================================================================
-- 3 — locked → live רק כשמשחק באמת יצא לדרך
-- =====================================================================
DO $$
DECLARE v_gw UUID; v_match UUID; v_status TEXT;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'gw-2';

  /* השעה עברה, אבל אף משחק לא התחיל — נשאר נעול.
     ★ משחק שנדחה בחצי שעה לא אמור להדליק «חי» על מסך ריק. */
  UPDATE game.gameweeks SET status = 'locked' WHERE id = v_gw;
  UPDATE core.weekly_matches SET status = 'scheduled' WHERE gameweek_id = v_gw;
  PERFORM game.auto_advance();

  SELECT status INTO v_status FROM game.gameweeks WHERE id = v_gw;
  IF v_status <> 'locked' THEN
    RAISE EXCEPTION 'FAIL 3a: «חי» נדלק בלי משחק שהתחיל (%)', v_status;
  END IF;

  /* עכשיו משחק אחד חי */
  SELECT id INTO v_match FROM core.weekly_matches WHERE gameweek_id = v_gw LIMIT 1;
  UPDATE core.weekly_matches SET status = 'live' WHERE id = v_match;
  PERFORM game.auto_advance();

  SELECT status INTO v_status FROM game.gameweeks WHERE id = v_gw;
  IF v_status <> 'live' THEN
    RAISE EXCEPTION 'FAIL 3b: הסטטוס % ולא live', v_status;
  END IF;
END $$;
\echo '  ✓ 3  «חי» נדלק ממצב המשחקים, לא מהשעון בלבד'

-- =====================================================================
-- 4 — live → scoring כשהכל נגמר
-- =====================================================================
DO $$
DECLARE v_gw UUID; v_status TEXT;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'gw-2';
  UPDATE core.weekly_matches
     SET status = 'finished', home_goals = COALESCE(home_goals, 1),
         away_goals = COALESCE(away_goals, 0)
   WHERE gameweek_id = v_gw;

  PERFORM game.auto_advance();

  SELECT status INTO v_status FROM game.gameweeks WHERE id = v_gw;
  IF v_status <> 'scoring' THEN
    RAISE EXCEPTION 'FAIL 4: הסטטוס % ולא scoring', v_status;
  END IF;
END $$;
\echo '  ✓ 4  כל המשחקים הסתיימו → scoring'

-- =====================================================================
-- 5 — ★ שער היציבות נפתח בלי הקליטה
--
--     זה הבאג שהחזיק את מחזור 4: `since` נקרא מטבלה שרק
--     `ingest_snapshot` כתבה אליה. בלי שורה שם המחזור נתקע לנצח.
-- =====================================================================
DO $$
DECLARE v_gw UUID; v JSONB; v_since TIMESTAMPTZ;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'gw-2';

  /* אין שורת טביעת אצבע כלל — בדיוק המצב שיצר את התקע */
  DELETE FROM game.gameweek_fingerprints WHERE gameweek_id = v_gw;
  DELETE FROM game.ingest_alerts WHERE gw_code = 'gw-2';

  v := game.auto_advance();

  /* דגימה ראשונה: הנתונים «זזו עכשיו», ולכן מחזיקים — נכון. */
  IF v->>'readyToPublish' IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 5a: פרסם בלי להמתין ליציבות';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM game.gameweek_fingerprints WHERE gameweek_id = v_gw) THEN
    RAISE EXCEPTION 'FAIL 5b: מחזור החיים לא דגם טביעת אצבע בעצמו';
  END IF;

  /* מיישנים את הדגימה — ועכשיו זה בשל, בלי שהקליטה נגעה בכלום */
  UPDATE game.gameweek_fingerprints SET since = now() - INTERVAL '90 minutes'
   WHERE gameweek_id = v_gw;

  v := game.auto_advance();
  IF v->>'readyToPublish' <> 'gw-2' THEN
    RAISE EXCEPTION 'FAIL 5c: לא הגיע לפרסום גם אחרי 90 דקות יציבות (%)', v;
  END IF;
END $$;
\echo '  ✓ 5  היציבות נמדדת בלי תלות בקליטה'

-- =====================================================================
-- 6 — ★ דגימה חוזרת אינה מאפסת את השעון
--
--     `since = now()` בכל בדיקה היה הופך את שער היציבות למכונה
--     שלעולם לא מגיעה ל-45 דקות. הפעימה רצה כל 5 דקות, ולכן
--     זו לא דקדקנות אלא ההבדל בין «מתפרסם» ל«לא מתפרסם לעולם».
-- =====================================================================
DO $$
DECLARE v_gw UUID; v_before TIMESTAMPTZ; v_after TIMESTAMPTZ;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'gw-2';

  SELECT since INTO v_before FROM game.gameweek_fingerprints WHERE gameweek_id = v_gw;
  PERFORM game.touch_fingerprint('gw-2');
  SELECT since INTO v_after FROM game.gameweek_fingerprints WHERE gameweek_id = v_gw;

  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 'FAIL 6a: דגימה בלי שינוי נתונים אִפסה את השעון';
  END IF;

  /* שינוי אמיתי — כן מאפס */
  UPDATE core.weekly_matches SET home_goals = COALESCE(home_goals,0) + 1
   WHERE gameweek_id = v_gw;
  PERFORM game.touch_fingerprint('gw-2');
  SELECT since INTO v_after FROM game.gameweek_fingerprints WHERE gameweek_id = v_gw;

  IF v_after <= v_before THEN
    RAISE EXCEPTION 'FAIL 6b: נתון שהשתנה לא אִפס את שעון היציבות';
  END IF;
END $$;
\echo '  ✓ 6  השעון מתאפס מנתון שזז, לא מדגימה'

-- =====================================================================
-- 7 — מחזור קודם שלא פורסם חוסם את פתיחת הבא
--
--     לא באג — החלטת מוצר. פתיחת הבא הייתה מזיזה את `is_current`
--     קדימה, ומסך הדירוג היה מתרוקן בדיוק כשהמשתמש בא לראות
--     את התוצאה שלו.
-- =====================================================================
DO $$
DECLARE v_season UUID; v_next UUID; v_status TEXT; v_saved JSONB; v_cur UUID;
BEGIN
  SELECT season_id INTO v_season FROM game.gameweeks WHERE code = 'gw-2';

  /* ★ בידוד: הכלל הנבדק הוא «אף מחזור קודם אינו באוויר», ולכן
     כל מחזור אחר שנשאר פתוח — או **טיוטה** שתיפתח לפניו,
     כי הלולאה רצה לפי מספר — היה הופך את הבדיקה לתלויה בסדר
     ההרצה. שומרים, מפנים, ומחזירים. */
  SELECT id INTO v_cur FROM game.gameweeks WHERE is_current;
  SELECT jsonb_agg(jsonb_build_object('id', id, 'status', status)) INTO v_saved
    FROM game.gameweeks
   WHERE status <> 'published' AND code <> 'gw-2';
  UPDATE game.gameweeks SET status = 'published'
   WHERE status <> 'published' AND code <> 'gw-2';

  INSERT INTO game.gameweeks (season_id, number, code, names, lock_at, status)
  VALUES (v_season, 97, 'gw-97',
          jsonb_build_object('he', jsonb_build_object('full','מחזור 97'),
                             'en', jsonb_build_object('full','Gameweek 97')),
          now() + INTERVAL '5 days', 'draft')
  ON CONFLICT (season_id, number) DO UPDATE
    SET status = 'draft', lock_at = now() + INTERVAL '5 days'
  RETURNING id INTO v_next;

  INSERT INTO core.weekly_matches (gameweek_id, home_team_id, away_team_id, kickoff_at, status)
  SELECT v_next, t1.id, t2.id, now() + INTERVAL '5 days', 'scheduled'
    FROM (SELECT id FROM core.teams ORDER BY id LIMIT 1) t1,
         (SELECT id FROM core.teams ORDER BY id DESC LIMIT 1) t2
  ON CONFLICT DO NOTHING;

  /* gw-2 עדיין ב-'scoring' */
  UPDATE game.gameweeks SET status = 'scoring' WHERE code = 'gw-2';
  PERFORM game.auto_advance();

  SELECT status INTO v_status FROM game.gameweeks WHERE id = v_next;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'FAIL 7a: נפתח מחזור בזמן שהקודם לא פורסם (%)', v_status;
  END IF;

  /* הקודם פורסם — עכשיו הבא נפתח */
  UPDATE game.gameweeks SET status = 'published' WHERE code = 'gw-2';
  PERFORM game.auto_advance();

  SELECT status INTO v_status FROM game.gameweeks WHERE id = v_next;
  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'FAIL 7b: הבא לא נפתח גם אחרי שהקודם פורסם (%)', v_status;
  END IF;

  IF NOT (SELECT is_current FROM game.gameweeks WHERE id = v_next) THEN
    RAISE EXCEPTION 'FAIL 7c: המחזור שנפתח אינו הנוכחי';
  END IF;

  /* ניקוי — לא משאירים מחזור מדומה נוכחי, ומחזירים את מה שפינינו */
  DELETE FROM core.weekly_matches WHERE gameweek_id = v_next;
  DELETE FROM game.gameweeks WHERE id = v_next;

  UPDATE game.gameweeks g SET status = x.status
    FROM jsonb_to_recordset(COALESCE(v_saved, '[]'::jsonb)) AS x(id UUID, status TEXT)
   WHERE g.id = x.id;

  UPDATE game.gameweeks SET is_current = (id = v_cur) WHERE is_current OR id = v_cur;
END $$;
\echo '  ✓ 7  הבא נפתח רק אחרי שהקודם פורסם'

-- =====================================================================
-- 8 — משתמש רגיל אינו מסובב מחזורים
-- =====================================================================
DO $$
DECLARE v_ok BOOLEAN := FALSE;
BEGIN
  SET LOCAL dubid.test_uid = '00000000-0000-0000-0000-0000000000ff';
  BEGIN
    PERFORM game.auto_advance();
  EXCEPTION WHEN OTHERS THEN
    v_ok := (SQLERRM LIKE '%SYSTEM_OR_ADMIN_REQUIRED%');
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 8: משתמש רגיל סובב את מחזור החיים'; END IF;
END $$;
\echo '  ✓ 8  רק מערכת או אדמין מסובבים מחזור'

\echo ''
\echo '  ✔ 17_lifecycle — הכל עבר'
