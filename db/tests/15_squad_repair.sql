-- =====================================================================
--  db/tests/15_squad_repair.sql — עמדה ושחקן בשתי קבוצות
-- =====================================================================
--
--  ★ מה הבדיקה הזו מגנה עליו
--
--  שחקן שפתוח בשתי קבוצות אינו באג תצוגה. `submit_entry` אוכף
--  «שחקן אחד מכל קבוצה», והשחקן הזה יכול להיבחר כנציג של קבוצה
--  אחת ולהיספר כשנייה — כלומר האילוץ התחרותי המרכזי של המוצר
--  נשבר בשקט.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

\ir _shared_gameweek.sql

DELETE FROM auth.users WHERE id::TEXT LIKE 'f2900000-%';
INSERT INTO auth.users (id, email, is_anonymous) VALUES
  ('f2900000-0000-0000-0000-000000000001', 'squads@dubid.test', FALSE);

SET dubid.test_uid = 'f2900000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('מנהל הסגלים');
SELECT game.claim_admin('hapoelTA14!');

-- =====================================================================
-- 1 — שינוי עמדה נוגע גם בסגל וגם בשחקן
-- =====================================================================
DO $$
DECLARE v_ext TEXT; v_player UUID; v_sq TEXT; v_pl TEXT;
BEGIN
  SELECT core.ext_code('player', s.player_id) INTO v_ext
    FROM core.squads s
   WHERE s.team_id = core.team_by_ext('3') AND s.valid_to IS NULL
     AND s.status <> 'left' AND s.position = 'DEF'
   LIMIT 1;
  IF v_ext IS NULL THEN RAISE EXCEPTION 'FAIL 1a: אין מגן לבדיקה'; END IF;

  PERFORM game.admin_set_player_position(v_ext, 'FWD');

  v_player := core.player_by_ext(v_ext);
  SELECT position::TEXT INTO v_sq FROM core.squads
   WHERE player_id = v_player AND valid_to IS NULL LIMIT 1;
  SELECT primary_position::TEXT INTO v_pl FROM core.players WHERE id = v_player;

  IF v_sq <> 'FWD' THEN RAISE EXCEPTION 'FAIL 1b: שורת הסגל לא השתנתה (%)', v_sq; END IF;

  /* ★ שניהם. עדכון של אחד בלבד מייצר שחקן שמופיע בהגנה
     ומנוקד כחלוץ — וזה נראה תקין בשני המסכים בנפרד. */
  IF v_pl <> 'FWD' THEN RAISE EXCEPTION 'FAIL 1c: השחקן עצמו לא השתנה (%)', v_pl; END IF;

  BEGIN
    PERFORM game.admin_set_player_position(v_ext, 'STRIKER');
    RAISE EXCEPTION 'FAIL 1d: עמדה לא חוקית התקבלה';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%BAD_POSITION%' THEN RAISE; END IF;
  END;
END $$;
\echo '  ✓ 1  עמדה משתנה בסגל ובשחקן, וערך לא חוקי נדחה'

-- =====================================================================
-- 2 — שחקן שנפתח בקבוצה שנייה מזוהה
-- =====================================================================
DO $$
DECLARE v_ext TEXT; v_player UUID; v_season UUID; v_list JSONB; v_n INT;
BEGIN
  SELECT core.ext_code('player', s.player_id) INTO v_ext
    FROM core.squads s
   WHERE s.team_id = core.team_by_ext('1') AND s.valid_to IS NULL
     AND s.status <> 'left'
   LIMIT 1;
  v_player := core.player_by_ext(v_ext);
  SELECT id INTO v_season FROM core.seasons ORDER BY is_current DESC LIMIT 1;

  /* מדמים בדיוק את מה שקרה בייצור: שורה חדשה בקבוצה אחרת,
     בלי לסגור את הישנה. */
  INSERT INTO core.squads (season_id, team_id, player_id, position, valid_from, status)
  VALUES (v_season, core.team_by_ext('7'), v_player, 'MID', DATE '2026-09-01', 'active')
  ON CONFLICT DO NOTHING;

  v_list := game.admin_squad_conflicts();
  SELECT count(*) INTO v_n
    FROM jsonb_array_elements(v_list) e WHERE e->>'player' = v_ext;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL 2a: ההתנגשות לא זוהתה'; END IF;

  IF jsonb_array_length((SELECT e->'teams' FROM jsonb_array_elements(v_list) e
                          WHERE e->>'player' = v_ext)) <> 2 THEN
    RAISE EXCEPTION 'FAIL 2b: לא שתי קבוצות';
  END IF;
END $$;
\echo '  ✓ 2  שחקן שפתוח בשתי קבוצות מופיע ברשימת ההתנגשויות'

-- =====================================================================
-- 3 — «להשאיר רק כאן» סוגר ולא מוחק
-- =====================================================================
DO $$
DECLARE v_ext TEXT; v_player UUID; v_open INT; v_closed INT; r JSONB;
BEGIN
  SELECT e->>'player' INTO v_ext
    FROM jsonb_array_elements(game.admin_squad_conflicts()) e LIMIT 1;
  IF v_ext IS NULL THEN RAISE EXCEPTION 'FAIL 3a: אין התנגשות לבדוק'; END IF;

  v_player := core.player_by_ext(v_ext);
  r := game.admin_resolve_squad_conflict(v_ext, '1');

  SELECT count(*) INTO v_open  FROM core.squads
   WHERE player_id = v_player AND valid_to IS NULL;
  SELECT count(*) INTO v_closed FROM core.squads
   WHERE player_id = v_player AND valid_to IS NOT NULL;

  IF v_open <> 1 THEN RAISE EXCEPTION 'FAIL 3b: נשארו % שורות פתוחות', v_open; END IF;

  /* ★ נסגר, לא נמחק: הרכב שהוגש בזמן שהוא היה שם חייב עדיין
     לדעת מאיזו קבוצה הוא היה. */
  IF v_closed < 1 THEN RAISE EXCEPTION 'FAIL 3c: השורה נמחקה במקום להיסגר'; END IF;

  IF (SELECT count(*) FROM jsonb_array_elements(game.admin_squad_conflicts()) e
       WHERE e->>'player' = v_ext) <> 0 THEN
    RAISE EXCEPTION 'FAIL 3d: עדיין מופיע כהתנגשות';
  END IF;
END $$;
\echo '  ✓ 3  התיקון משאיר קבוצה אחת פתוחה ושומר את ההיסטוריה'

-- =====================================================================
-- 4 — עריכה נוגעת רק בקבוצה שנערכת
-- =====================================================================
DO $$
DECLARE v_ext TEXT; v_player UUID; v_season UUID; v_other NUMERIC;
BEGIN
  SELECT core.ext_code('player', s.player_id) INTO v_ext
    FROM core.squads s
   WHERE s.team_id = core.team_by_ext('4') AND s.valid_to IS NULL
     AND s.status <> 'left' LIMIT 1;
  v_player := core.player_by_ext(v_ext);
  SELECT id INTO v_season FROM core.seasons ORDER BY is_current DESC LIMIT 1;

  INSERT INTO core.squads (season_id, team_id, player_id, position, fantasy_price,
                           valid_from, status)
  VALUES (v_season, core.team_by_ext('9'), v_player, 'MID', 7, DATE '2026-09-02', 'active')
  ON CONFLICT DO NOTHING;

  PERFORM game.admin_upsert_player('4', 'שם לבדיקה', v_ext, NULL, 'GK', 3::NUMERIC);

  SELECT fantasy_price INTO v_other FROM core.squads
   WHERE player_id = v_player AND team_id = core.team_by_ext('9') AND valid_to IS NULL;

  /* ★ 7 ולא 3: העריכה נעשתה על קבוצה 4 בלבד. בלי הסינון,
     עריכה אחת הייתה מדביקה מחיר ועמדה על שתי הקבוצות ומקבעת
     את הבאג במקום לחשוף אותו. */
  IF v_other IS DISTINCT FROM 7 THEN
    RAISE EXCEPTION 'FAIL 4a: העריכה דלפה לקבוצה השנייה (%)', v_other;
  END IF;
END $$;
\echo '  ✓ 4  עריכת שחקן אינה דולפת לשורת סגל של קבוצה אחרת'

\echo ''
\echo '  ══ 15_squad_repair: כל הבדיקות עברו ══'
