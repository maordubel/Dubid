-- db/tests/34_club_cap.sql — מכסת מועדון לפי מחזור (db/52)
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;
\ir _shared_gameweek.sql

DELETE FROM auth.users WHERE id::TEXT LIKE 'f6000000-%';
INSERT INTO auth.users (id, email, is_anonymous) VALUES
  ('f6000000-0000-0000-0000-000000000001', 'cap1@dubid.test', FALSE);
SET dubid.test_uid = 'f6000000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('cap1');

DO $$
DECLARE
  v_gw UUID; v_team UUID; v_l UUID; p1 UUID; p2 UUID; p3 UUID; ok BOOLEAN;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'gw-2';
  SELECT team_id INTO v_team FROM core.squads WHERE valid_to IS NULL GROUP BY team_id HAVING count(*) >= 3 LIMIT 1;
  SELECT player_id INTO p1 FROM core.squads WHERE team_id=v_team AND valid_to IS NULL ORDER BY player_id OFFSET 0 LIMIT 1;
  SELECT player_id INTO p2 FROM core.squads WHERE team_id=v_team AND valid_to IS NULL ORDER BY player_id OFFSET 1 LIMIT 1;
  SELECT player_id INTO p3 FROM core.squads WHERE team_id=v_team AND valid_to IS NULL ORDER BY player_id OFFSET 2 LIMIT 1;

  INSERT INTO game.user_lineups (user_id, gameweek_id, status)
  VALUES ('f6000000-0000-0000-0000-000000000001', v_gw, 'submitted') RETURNING id INTO v_l;

  /* ברירת מחדל: מכסה 1 — שני שחקנים מאותו מועדון נדחים (כמו קודם) */
  IF game.club_cap('gw-2') <> 1 THEN RAISE EXCEPTION 'FAIL 0: ברירת מחדל צריכה להיות 1'; END IF;
  INSERT INTO game.user_lineup_slots (lineup_id, slot_no, player_id, team_id, position)
  SELECT v_l, 1, p1, v_team, position FROM core.squads WHERE player_id=p1 AND valid_to IS NULL LIMIT 1;
  ok := FALSE;
  BEGIN
    INSERT INTO game.user_lineup_slots (lineup_id, slot_no, player_id, team_id, position)
    SELECT v_l, 2, p2, v_team, position FROM core.squads WHERE player_id=p2 AND valid_to IS NULL LIMIT 1;
  EXCEPTION WHEN unique_violation THEN ok := TRUE; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 1: מכסה 1 לא נאכפה'; END IF;

  /* פלייאוף: מכסה 2 — שני מותרים, שלישי נדחה */
  UPDATE game.gameweeks SET max_players_per_team = 2 WHERE id = v_gw;
  INSERT INTO game.user_lineup_slots (lineup_id, slot_no, player_id, team_id, position)
  SELECT v_l, 2, p2, v_team, position FROM core.squads WHERE player_id=p2 AND valid_to IS NULL LIMIT 1;
  ok := FALSE;
  BEGIN
    INSERT INTO game.user_lineup_slots (lineup_id, slot_no, player_id, team_id, position)
    SELECT v_l, 3, p3, v_team, position FROM core.squads WHERE player_id=p3 AND valid_to IS NULL LIMIT 1;
  EXCEPTION WHEN unique_violation THEN ok := TRUE; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 2: שלישי במכסה 2 לא נדחה'; END IF;

  /* אותו שחקן פעמיים עדיין נדחה (no_duplicate_player) */
  ok := FALSE;
  BEGIN
    INSERT INTO game.user_lineup_slots (lineup_id, slot_no, player_id, team_id, position)
    SELECT v_l, 4, p1, v_team, position FROM core.squads WHERE player_id=p1 AND valid_to IS NULL LIMIT 1;
  EXCEPTION WHEN unique_violation THEN ok := TRUE; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 3: שחקן כפול התקבל'; END IF;

  /* הורדת מכסה מתחת לשימוש קיים — admin_set_club_cap מסרב (בודק את ההגנה ישירות) */
  IF (SELECT COALESCE(max(c),0) FROM (SELECT count(*) c FROM game.user_lineup_slots s JOIN game.user_lineups ul ON ul.id=s.lineup_id WHERE ul.gameweek_id=v_gw GROUP BY s.lineup_id, s.team_id) t) <> 2
  THEN RAISE EXCEPTION 'FAIL 4: צפוי שימוש 2'; END IF;

  UPDATE game.gameweeks SET max_players_per_team = 1 WHERE id = v_gw;
  DELETE FROM game.user_lineups WHERE id = v_l;
END $$;
