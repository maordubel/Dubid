-- =====================================================================
--  db/tests/01_live_flow.sql — המסלול המלא, מקצה לקצה
--
--  זו הבדיקה שאומרת אם "Definition of Done" מתקיים:
--
--    משתמש → הרכב → הגשה → נעילת שרת → תוצאות אדמין → פרסום
--          → ניקוד → דירוג משותף
--
--  הרצה (אחרי 00_supabase_shim + 01→09):
--    psql -d dubid_test -v ON_ERROR_STOP=1 -f db/tests/01_live_flow.sql
--
--  כל שלב עוצר בשגיאה מפורשת. "PASS" בסוף = הכל עבר.
-- =====================================================================

\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

-- ---------------------------------------------------------------------
-- ניקוי — כדי שהקובץ ירוץ שוב ושוב, ובכל סדר
-- ---------------------------------------------------------------------
--  ★ בדיקה שאפשר להריץ רק פעם אחת על מסד נקי היא בדיקה שלא
--    מריצים. המשתמשים כאן נמחקים בתחילת הריצה, וה-CASCADE מוריד
--    איתם את ההרכבים והפרופילים.
DELETE FROM auth.users WHERE id::TEXT LIKE '%-0000-0000-0000-%'
                          OR id IN ('11111111-1111-1111-1111-111111111111',
                                    '22222222-2222-2222-2222-222222222222');

-- ---------------------------------------------------------------------
-- שני שחקנים
-- ---------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'maor@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'dana@example.com')
ON CONFLICT DO NOTHING;

-- המחזור פתוח, הדדליין בעתיד.
UPDATE game.gameweeks SET status = 'open', lock_at = now() + interval '2 days'
 WHERE code = 'gw-2';

-- ---------------------------------------------------------------------
-- 1. הגשה תקינה — שני משתמשים, דוביד 5
-- ---------------------------------------------------------------------
SET dubid.test_uid = '11111111-1111-1111-1111-111111111111';
SELECT game.submit_entry('gw-2', 'five', '2-1-1', $$[
  {"slot_no":1,"ext_player_id":"101", "is_captain":false,"is_vice":false,"is_bench":false},
  {"slot_no":2,"ext_player_id":"1301","is_captain":false,"is_vice":true, "is_bench":false},
  {"slot_no":3,"ext_player_id":"1201","is_captain":true, "is_vice":false,"is_bench":false},
  {"slot_no":4,"ext_player_id":"801", "is_captain":false,"is_vice":false,"is_bench":false},
  {"slot_no":5,"ext_player_id":"1101","is_captain":false,"is_vice":false,"is_bench":false}
]$$::jsonb, 'מאור');

SET dubid.test_uid = '22222222-2222-2222-2222-222222222222';
SELECT game.submit_entry('gw-2', 'five', '2-1-1', $$[
  {"slot_no":1,"ext_player_id":"101", "is_captain":true, "is_vice":false,"is_bench":false},
  {"slot_no":2,"ext_player_id":"201", "is_captain":false,"is_vice":false,"is_bench":false},
  {"slot_no":3,"ext_player_id":"1201","is_captain":false,"is_vice":true, "is_bench":false},
  {"slot_no":4,"ext_player_id":"801", "is_captain":false,"is_vice":false,"is_bench":false},
  {"slot_no":5,"ext_player_id":"1101","is_captain":false,"is_vice":false,"is_bench":false}
]$$::jsonb, 'דנה');

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM game.user_lineups WHERE status = 'submitted';
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL 1: expected 2 lineups, got %', n; END IF;
  SELECT count(*) INTO n FROM game.user_lineup_slots;
  IF n <> 10 THEN RAISE EXCEPTION 'FAIL 1b: expected 10 slots, got %', n; END IF;
END $$;
\echo '  ✓ 1  הגשה נשמרת — שני משתמשים, עשר משבצות'

-- ---------------------------------------------------------------------
-- 2. ★ הכלל היחיד: שחקן אחד מכל קבוצה
-- ---------------------------------------------------------------------
DO $$
BEGIN
  PERFORM game.submit_entry('gw-2', 'five', '2-1-1', $j$[
    {"slot_no":1,"ext_player_id":"101","is_captain":true, "is_vice":false,"is_bench":false},
    {"slot_no":2,"ext_player_id":"102","is_captain":false,"is_vice":false,"is_bench":false},
    {"slot_no":3,"ext_player_id":"1201","is_captain":false,"is_vice":false,"is_bench":false},
    {"slot_no":4,"ext_player_id":"801","is_captain":false,"is_vice":false,"is_bench":false},
    {"slot_no":5,"ext_player_id":"1101","is_captain":false,"is_vice":false,"is_bench":false}
  ]$j$::jsonb);
  RAISE EXCEPTION 'FAIL 2: שני שחקנים מאותה קבוצה התקבלו';
EXCEPTION WHEN unique_violation THEN NULL;
END $$;
\echo '  ✓ 2  שני שחקנים מאותה קבוצה נדחים — על ידי המסד עצמו'

-- ---------------------------------------------------------------------
-- 3. קפטן חובה
-- ---------------------------------------------------------------------
DO $$
BEGIN
  PERFORM game.submit_entry('gw-2', 'five', '2-1-1', $j$[
    {"slot_no":1,"ext_player_id":"101", "is_captain":false,"is_vice":false,"is_bench":false},
    {"slot_no":2,"ext_player_id":"201", "is_captain":false,"is_vice":false,"is_bench":false},
    {"slot_no":3,"ext_player_id":"1201","is_captain":false,"is_vice":false,"is_bench":false},
    {"slot_no":4,"ext_player_id":"801", "is_captain":false,"is_vice":false,"is_bench":false},
    {"slot_no":5,"ext_player_id":"1101","is_captain":false,"is_vice":false,"is_bench":false}
  ]$j$::jsonb);
  RAISE EXCEPTION 'FAIL 3: הרכב בלי קפטן התקבל';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%CAPTAIN_REQUIRED%' THEN RAISE; END IF;
END $$;
\echo '  ✓ 3  הרכב בלי קפטן נדחה'

-- ---------------------------------------------------------------------
-- 4. ★★ הנעילה — הבדיקה שהכל תלוי בה
-- ---------------------------------------------------------------------
UPDATE game.gameweeks SET lock_at = now() - interval '1 minute' WHERE code = 'gw-2';

DO $$
BEGIN
  PERFORM game.submit_entry('gw-2', 'five', '2-1-1', $j$[
    {"slot_no":1,"ext_player_id":"101", "is_captain":true, "is_vice":false,"is_bench":false},
    {"slot_no":2,"ext_player_id":"201", "is_captain":false,"is_vice":false,"is_bench":false},
    {"slot_no":3,"ext_player_id":"1201","is_captain":false,"is_vice":false,"is_bench":false},
    {"slot_no":4,"ext_player_id":"801", "is_captain":false,"is_vice":false,"is_bench":false},
    {"slot_no":5,"ext_player_id":"1101","is_captain":false,"is_vice":false,"is_bench":false}
  ]$j$::jsonb);
  RAISE EXCEPTION 'FAIL 4: התקבלה הגשה אחרי הדדליין';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%DEADLINE_PASSED%' THEN RAISE; END IF;
END $$;
\echo '  ✓ 4  הגשה אחרי הדדליין נדחית — שעון המסד, לא שעון המכשיר'

DO $$
BEGIN
  PERFORM game.withdraw_entry('gw-2', 'five');
  RAISE EXCEPTION 'FAIL 4b: ביטול הגשה התאפשר אחרי הנעילה';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%DEADLINE_PASSED%' THEN RAISE; END IF;
END $$;
\echo '  ✓ 4b ביטול הגשה נחסם אחרי הנעילה'

-- ---------------------------------------------------------------------
-- 5. אדמין — ההרשאה נבדקת במסד
-- ---------------------------------------------------------------------
DO $$
BEGIN
  PERFORM game.admin_set_published('gw-2', TRUE);
  RAISE EXCEPTION 'FAIL 5: משתמש רגיל פרסם מחזור';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%ADMIN_REQUIRED%' THEN RAISE; END IF;
END $$;
\echo '  ✓ 5  משתמש רגיל לא יכול לפרסם'

UPDATE game.users SET is_admin = TRUE WHERE id = '11111111-1111-1111-1111-111111111111';
SET dubid.test_uid = '11111111-1111-1111-1111-111111111111';

-- ---------------------------------------------------------------------
-- 6. תוצאות ידניות
-- ---------------------------------------------------------------------
--  T1 (הפועל ב״ש) נגד T13 — 2:1 לביתית.  T12 נגד T8 — 0:0.
--  T11 שיחקה מול T10 — 3:1.
SELECT game.admin_upsert_match('gw-2', '13', '1',  2::SMALLINT, 1::SMALLINT, TRUE);
SELECT game.admin_upsert_match('gw-2', '8',  '12', 0::SMALLINT, 0::SMALLINT, TRUE);
SELECT game.admin_upsert_match('gw-2', '10', '11', 1::SMALLINT, 3::SMALLINT, TRUE);

SELECT game.admin_upsert_player_stat('gw-2', '101',
  '{"minutes":90,"goals":0,"assists":0,"saves":4,"goalsConceded":2}'::jsonb);
SELECT game.admin_upsert_player_stat('gw-2', '1301',
  '{"minutes":90,"goals":1,"assists":0,"cleanSheet":false}'::jsonb);
SELECT game.admin_upsert_player_stat('gw-2', '1201',
  '{"minutes":90,"goals":0,"assists":1,"cleanSheet":true}'::jsonb);
SELECT game.admin_upsert_player_stat('gw-2', '801',
  '{"minutes":90,"goals":0,"assists":0,"cleanSheet":true,"saves":2}'::jsonb);
SELECT game.admin_upsert_player_stat('gw-2', '1101',
  '{"minutes":75,"goals":2,"assists":0,"yellowCards":1}'::jsonb);

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM core.player_match_stats;
  IF n <> 5 THEN RAISE EXCEPTION 'FAIL 6: expected 5 stat rows, got %', n; END IF;
END $$;
\echo '  ✓ 6  אדמין מזין תוצאות וסטטיסטיקות'

-- ---------------------------------------------------------------------
-- 7. פרסום
-- ---------------------------------------------------------------------
SELECT game.admin_set_published('gw-2', TRUE);

DO $$
DECLARE r JSONB; n INT;
BEGIN
  r := game.results('gw-2');
  IF (r->>'published')::BOOLEAN IS NOT TRUE THEN RAISE EXCEPTION 'FAIL 7: not published'; END IF;

  n := (SELECT count(*) FROM jsonb_object_keys(r->'performances'));
  IF n <> 5 THEN RAISE EXCEPTION 'FAIL 7b: expected 5 performances, got %', n; END IF;

  n := (SELECT count(*) FROM jsonb_object_keys(r->'outcomes'));
  IF n <> 6 THEN RAISE EXCEPTION 'FAIL 7c: expected 6 team outcomes, got %', n; END IF;

  -- המפתחות חייבים להיות בשפת הקליינט: 'P101', לא UUID.
  IF NOT (r->'performances') ? 'P101' THEN
    RAISE EXCEPTION 'FAIL 7d: performances not keyed by external id: %',
      (SELECT string_agg(k, ',') FROM jsonb_object_keys(r->'performances') k);
  END IF;
  IF NOT (r->'outcomes') ? 'T1' THEN RAISE EXCEPTION 'FAIL 7e: outcomes not keyed by T<ext>'; END IF;

  IF (r#>>'{outcomes,T1,result}') <> 'L' THEN
    RAISE EXCEPTION 'FAIL 7f: T1 lost 1-2, got %', (r#>>'{outcomes,T1,result}');
  END IF;
  IF (r#>>'{performances,P1101,goals}')::INT <> 2 THEN
    RAISE EXCEPTION 'FAIL 7g: P1101 should have 2 goals';
  END IF;
END $$;
\echo '  ✓ 7  פרסום — התוצאות חוזרות בשפת הקליינט (P101 / T1)'

-- ---------------------------------------------------------------------
-- 8. הדירוג — כולם רואים את אותן הגשות
-- ---------------------------------------------------------------------
DO $$
DECLARE e JSONB; n INT; slots INT;
BEGIN
  e := game.entries('gw-2');
  n := jsonb_array_length(e);
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL 8: expected 2 entries, got %', n; END IF;

  slots := jsonb_array_length(e->0->'lineup'->'slots');
  IF slots <> 5 THEN RAISE EXCEPTION 'FAIL 8b: expected 5 slots, got %', slots; END IF;

  IF (e->0->'lineup'->'slots'->0->>'playerId') NOT LIKE 'P%' THEN
    RAISE EXCEPTION 'FAIL 8c: slot playerId not external: %',
      (e->0->'lineup'->'slots'->0->>'playerId');
  END IF;
  IF (e->0->>'displayName') IS NULL THEN RAISE EXCEPTION 'FAIL 8d: missing displayName'; END IF;
END $$;
\echo '  ✓ 8  הדירוג — שתי הגשות גלויות לכולם אחרי הנעילה'

-- ---------------------------------------------------------------------
-- 9. לפני הנעילה — אני רואה רק את עצמי
-- ---------------------------------------------------------------------
UPDATE game.gameweeks SET lock_at = now() + interval '1 day' WHERE code = 'gw-2';
SET dubid.test_uid = '22222222-2222-2222-2222-222222222222';

DO $$
DECLARE n INT;
BEGIN
  n := jsonb_array_length(game.entries('gw-2'));
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 9: לפני הנעילה נראו % הגשות במקום אחת', n; END IF;
END $$;
\echo '  ✓ 9  לפני הנעילה — הרכב של אחר אינו גלוי'

-- ---------------------------------------------------------------------
-- 10. מצב המחזור ללובי
-- ---------------------------------------------------------------------
DO $$
DECLARE s JSONB;
BEGIN
  s := game.gameweek_state('gw-2');
  IF (s->>'code') <> 'gw-2' THEN RAISE EXCEPTION 'FAIL 10: bad code'; END IF;
  IF (s->>'entrants')::INT <> 2 THEN
    RAISE EXCEPTION 'FAIL 10b: expected 2 entrants, got %', s->>'entrants';
  END IF;
  IF (s->>'serverNow')::BIGINT < 1700000000000 THEN
    RAISE EXCEPTION 'FAIL 10c: serverNow not epoch-ms';
  END IF;
END $$;
\echo '  ✓ 10 מצב המחזור — סטטוס, דדליין, שעון שרת, מספר משתתפים'

\echo ''
\echo '════════════════════════════════════════════'
\echo '  PASS — המסלול המלא עובר מקצה לקצה'
\echo '════════════════════════════════════════════'
