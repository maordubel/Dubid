-- =====================================================================
--  db/tests/38_ingest_targets.sql — המסד בוחר מחזור לסריקה, לכל ליגה
--
--  ★ מה זה מגן עליו (ייצור, 27.10.2026): הספק קידם את "המחזור הנוכחי"
--    לפני שהמשחק האחרון נגמר, והקליטה נטשה את en-8 / es-10 עם משחק
--    שתקוע 'live'. ההשלמה נשלחה בלי ליגה → נסרק מחזור ישראלי במקום.
--    gr-8 פורסם עם סטטיסטיקה ל-4 מתוך 7 משחקים.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

/* ── תשתית: ליגה אנגלית, שלושה מחזורים, ו-pg_net מדומה שרושם בקשות ── */
CREATE SCHEMA IF NOT EXISTS net;
CREATE TABLE IF NOT EXISTS net._t38_calls (id BIGSERIAL PRIMARY KEY, body JSONB);
CREATE OR REPLACE FUNCTION net.http_post(url TEXT, headers JSONB, body JSONB,
                                         timeout_milliseconds INT DEFAULT 5000)
RETURNS BIGINT LANGUAGE sql AS $$
  INSERT INTO net._t38_calls (body) VALUES (body) RETURNING id + 900000;
$$;

INSERT INTO game.ingest_secrets (id, function_url, token)
VALUES (TRUE, 'https://example.test/dubid-ingest', 'test-token')
ON CONFLICT (id) DO UPDATE SET function_url = EXCLUDED.function_url, token = EXCLUDED.token;

DO $$
DECLARE v_season UUID; v_league UUID; t UUID[]; p UUID[]; v_gw UUID; i INT;
BEGIN
  SELECT id INTO v_league FROM core.leagues WHERE code = 'EN_PL';
  SELECT id INTO v_season FROM core.seasons WHERE league_id = v_league
   ORDER BY is_current DESC, starts_on DESC NULLS LAST LIMIT 1;
  IF v_season IS NULL THEN RAISE EXCEPTION 'SETUP: אין עונה אנגלית'; END IF;

  DELETE FROM game.gameweeks WHERE season_id = v_season AND number BETWEEN 3 AND 8;

  SELECT array_agg(DISTINCT team_id) INTO t FROM (
    SELECT team_id FROM core.squads WHERE season_id = v_season LIMIT 200) x;
  IF array_length(t, 1) < 4 THEN RAISE EXCEPTION 'SETUP: חסרות קבוצות'; END IF;

  INSERT INTO game.gameweeks (season_id, number, code, lock_at, first_kickoff_at, status, published_at)
  VALUES (v_season, 5, 'en-5', now() - INTERVAL '9 days', now() - INTERVAL '9 days', 'published', now() - INTERVAL '6 days'),
         (v_season, 6, 'en-6', now() - INTERVAL '3 days', now() - INTERVAL '3 days', 'live', NULL),
         (v_season, 7, 'en-7', now() + INTERVAL '3 days', now() + INTERVAL '3 days', 'draft', NULL),
         (v_season, 8, 'en-8', now() + INTERVAL '1 year', now() + INTERVAL '1 year', 'draft', NULL);

  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'en-6';
  INSERT INTO core.weekly_matches (gameweek_id, home_team_id, away_team_id, kickoff_at, status, home_goals, away_goals)
  VALUES (v_gw, t[1], t[2], now() - INTERVAL '3 days', 'finished', 1, 0),
         (v_gw, t[3], t[4], now() - INTERVAL '40 hours', 'live', 0, 0);   -- ← תקוע

  /* סטטיסטיקה מלאה (11+11) למשחק הראשון */
  SELECT array_agg(id) INTO p FROM (SELECT id FROM core.players LIMIT 22) x;
  FOR i IN 1..22 LOOP
    INSERT INTO core.player_match_stats (match_id, player_id, team_id, minutes)
    SELECT m.id, p[i], CASE WHEN i <= 11 THEN t[1] ELSE t[2] END, 90
      FROM core.weekly_matches m WHERE m.gameweek_id = v_gw AND m.home_team_id = t[1];
  END LOOP;
END $$;

-- =====================================================================
-- 1 — המחזור לסריקה = הוותיק שלא פורסם, לא מה שהספק אומר
-- =====================================================================
DO $$
DECLARE r RECORD; v_league UUID;
BEGIN
  SELECT id INTO v_league FROM core.leagues WHERE code = 'EN_PL';
  SELECT * INTO r FROM game.ingest_target(v_league);
  IF r.code IS DISTINCT FROM 'en-6' THEN
    RAISE EXCEPTION 'FAIL 1: מחזור עם משחק תקוע לא נבחר (קיבלנו %)', r.code;
  END IF;
END $$;
\echo '  ✓ 1  מחזור עם משחק תקוע הוא היעד, גם כשהבא כבר בלוח'

-- =====================================================================
-- 2 — גוף הבקשה נושא ליגה, מתחרה ומספר מחזור
-- =====================================================================
DO $$
DECLARE b JSONB; v_league UUID;
BEGIN
  SELECT id INTO v_league FROM core.leagues WHERE code = 'EN_PL';
  b := game.ingest_request_body(v_league, 'sweep', 6);
  IF b->>'league' <> 'EN_PL' OR (b->>'round')::int <> 6 OR b->>'gwPrefix' <> 'en-'
     OR (b->>'competition365')::int <> 7 OR b->>'phase' <> 'sweep' THEN
    RAISE EXCEPTION 'FAIL 2: גוף בקשה שגוי %', b;
  END IF;
  IF game.ingest_request_body(v_league, 'auto', NULL) ? 'round' THEN
    RAISE EXCEPTION 'FAIL 2b: בלי מחזור — אין round בגוף';
  END IF;
END $$;
\echo '  ✓ 2  כל שליחה מפורשת: ליגה, מתחרה, קידומת ומחזור'

-- =====================================================================
-- 3 — הפעימה שולחת את המחזור שהמסד בחר
-- =====================================================================
DO $$
DECLARE v JSONB; c JSONB;
BEGIN
  UPDATE game.ingest_sources SET enabled = TRUE
   WHERE league_id = (SELECT id FROM core.leagues WHERE code = 'EN_PL');
  TRUNCATE net._t38_calls;
  v := game.ingest_tick('test');
  SELECT body INTO c FROM net._t38_calls WHERE body->>'league' = 'EN_PL';
  IF c IS NULL OR (c->>'round')::int IS DISTINCT FROM 6 THEN
    RAISE EXCEPTION 'FAIL 3: הפעימה לא שלחה את en-6 (%, %)', c, v;
  END IF;
END $$;
\echo '  ✓ 3  ingest_tick שולחת round=6 ל-EN, לא "מחזור נוכחי" של הספק'

-- =====================================================================
-- 4 — אחרי פרסום: הבא בתור; מציין מקום רחוק אינו יעד
-- =====================================================================
DO $$
DECLARE r RECORD; v_league UUID;
BEGIN
  SELECT id INTO v_league FROM core.leagues WHERE code = 'EN_PL';
  UPDATE game.gameweeks SET status = 'published', published_at = now() WHERE code = 'en-6';
  SELECT * INTO r FROM game.ingest_target(v_league);
  IF r.code IS DISTINCT FROM 'en-7' THEN
    RAISE EXCEPTION 'FAIL 4: אחרי פרסום en-6 היעד אמור להיות en-7 (קיבלנו %)', r.code;
  END IF;
  UPDATE game.gameweeks SET status = 'published', published_at = now() WHERE code = 'en-7';
  SELECT * INTO r FROM game.ingest_target(v_league);
  IF r.code = 'en-8' THEN
    RAISE EXCEPTION 'FAIL 4b: מציין מקום בעוד שנה נבחר כיעד';
  END IF;
  UPDATE game.gameweeks SET status = 'live', published_at = NULL WHERE code = 'en-6';
  UPDATE game.gameweeks SET status = 'draft', published_at = NULL WHERE code = 'en-7';
END $$;
\echo '  ✓ 4  אחרי פרסום — המחזור הבא; טיוטה רחוקה לא נסרקת'

-- =====================================================================
-- 5 — מחזור חופף: en-7 כבר רץ בזמן ש-en-6 תקוע
-- =====================================================================
DO $$
DECLARE r RECORD; v_league UUID; v_gw UUID; t UUID[];
BEGIN
  SELECT id INTO v_league FROM core.leagues WHERE code = 'EN_PL';
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'en-7';
  SELECT array_agg(DISTINCT x) INTO t FROM (
    SELECT home_team_id x FROM core.weekly_matches m JOIN game.gameweeks g ON g.id = m.gameweek_id
     WHERE g.code = 'en-6' UNION SELECT away_team_id FROM core.weekly_matches m
      JOIN game.gameweeks g ON g.id = m.gameweek_id WHERE g.code = 'en-6') q;
  UPDATE game.gameweeks SET status = 'live', lock_at = now() - INTERVAL '2 hours' WHERE id = v_gw;
  INSERT INTO core.weekly_matches (gameweek_id, home_team_id, away_team_id, kickoff_at, status)
  VALUES (v_gw, t[1], t[3], now() - INTERVAL '1 hour', 'live');

  SELECT * INTO r FROM game.ingest_overlap_target(v_league);
  IF r.code IS DISTINCT FROM 'en-7' THEN
    RAISE EXCEPTION 'FAIL 5: מחזור חופף לא זוהה (%)', r.code;
  END IF;
  /* והיעד הראשי עדיין en-6 */
  SELECT * INTO r FROM game.ingest_target(v_league);
  IF r.code IS DISTINCT FROM 'en-6' THEN RAISE EXCEPTION 'FAIL 5b: היעד זז (%)', r.code; END IF;

  DELETE FROM core.weekly_matches WHERE gameweek_id = v_gw;
  UPDATE game.gameweeks SET status = 'draft', lock_at = now() + INTERVAL '3 days' WHERE id = v_gw;
END $$;
\echo '  ✓ 5  מחזור חדש שכבר רץ בזמן שהקודם תקוע — נסרק בנפרד'

-- =====================================================================
-- 6 — השלמה נשלחת לליגה של המחזור (לא לליגה הראשית)
-- =====================================================================
DO $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM game.gameweek_needs_backfill() WHERE code = 'en-6';
  IF r.league_id IS DISTINCT FROM (SELECT id FROM core.leagues WHERE code = 'EN_PL') THEN
    RAISE EXCEPTION 'FAIL 6: ההשלמה לא נושאת את הליגה';
  END IF;
END $$;
\echo '  ✓ 6  gameweek_needs_backfill מחזירה league_id'

-- =====================================================================
-- 7 — שער כיסוי: משחק שנגמר בלי סטטיסטיקה חוסם, ואז יורד ל-warn
-- =====================================================================
DO $$
DECLARE v_gw UUID; n INT;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'en-6';
  /* המשחק התקוע נגמר עכשיו — בלי סטטיסטיקה */
  UPDATE core.weekly_matches SET status = 'finished', home_goals = 2, away_goals = 2,
         kickoff_at = now() - INTERVAL '2 hours'
   WHERE gameweek_id = v_gw AND status = 'live';

  PERFORM game.ingest_check_coverage('en-6');
  SELECT count(*) INTO n FROM game.ingest_alerts
   WHERE gw_code = 'en-6' AND kind = 'match_stats_missing' AND severity = 'block' AND cleared_at IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 7: אין התרעה חוסמת (%)', n; END IF;

  /* 20 שעות אחרי — יורד ל-warn, החסימה נסגרת */
  UPDATE core.weekly_matches SET kickoff_at = now() - INTERVAL '20 hours'
   WHERE gameweek_id = v_gw AND home_goals = 2;
  PERFORM game.ingest_check_coverage('en-6');
  SELECT count(*) INTO n FROM game.ingest_alerts
   WHERE gw_code = 'en-6' AND kind = 'match_stats_missing' AND severity = 'block' AND cleared_at IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 7b: החסימה לא ירדה אחרי 14 שעות'; END IF;
  SELECT count(*) INTO n FROM game.ingest_alerts
   WHERE gw_code = 'en-6' AND kind = 'match_stats_missing' AND severity = 'warn' AND cleared_at IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 7c: אין warn'; END IF;
END $$;
\echo '  ✓ 7  משחק שנגמר בלי סטטיסטיקה חוסם 14 שעות, ואז warn'

-- =====================================================================
-- 8 — כיסוי מלא סוגר את ההתרעה
-- =====================================================================
DO $$
DECLARE v_gw UUID; m RECORD; p UUID[]; i INT; n INT;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'en-6';
  SELECT * INTO m FROM core.weekly_matches WHERE gameweek_id = v_gw AND home_goals = 2;
  SELECT array_agg(id) INTO p FROM (SELECT id FROM core.players OFFSET 100 LIMIT 22) x;
  FOR i IN 1..22 LOOP
    INSERT INTO core.player_match_stats (match_id, player_id, team_id, minutes)
    VALUES (m.id, p[i], CASE WHEN i <= 11 THEN m.home_team_id ELSE m.away_team_id END, 90);
  END LOOP;
  PERFORM game.ingest_check_coverage('en-6');
  SELECT count(*) INTO n FROM game.ingest_alerts
   WHERE gw_code = 'en-6' AND kind = 'match_stats_missing' AND cleared_at IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 8: ההתרעה לא נסגרה'; END IF;
END $$;
\echo '  ✓ 8  כיסוי מלא סוגר את ההתרעה אוטומטית'

-- =====================================================================
-- 9 — הפונקציות החדשות סגורות ל-anon/authenticated
-- =====================================================================
DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['game.ingest_target(uuid)','game.ingest_overlap_target(uuid)',
    'game.ingest_request_body(uuid,text,integer)','game.ingest_tick(text)','game.lifecycle_tick()',
    'game.ingest_check_match_coverage(text)','game.gameweek_needs_backfill()'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL 9: % פתוחה', f;
    END IF;
  END LOOP;
END $$;
\echo '  ✓ 9  כל הפונקציות החדשות סגורות'

/* ניקוי — שאר החבילות מניחות שאין pg_net */
UPDATE game.ingest_sources SET enabled = FALSE
 WHERE league_id = (SELECT id FROM core.leagues WHERE code = 'EN_PL');
DELETE FROM game.gameweeks WHERE code IN ('en-5','en-6','en-7','en-8');
DROP FUNCTION net.http_post(TEXT, JSONB, JSONB, INT);
DROP TABLE net._t38_calls;
