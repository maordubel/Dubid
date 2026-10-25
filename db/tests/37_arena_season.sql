-- db/tests/37_arena_season.sql — טבלה עונתית לזירה (db/55)
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;
\ir _shared_gameweek.sql

DELETE FROM auth.users WHERE id::TEXT LIKE 'f7000000-%';
INSERT INTO auth.users (id, email, is_anonymous) VALUES
  ('f7000000-0000-0000-0000-000000000001','as1@dubid.test',FALSE),
  ('f7000000-0000-0000-0000-000000000002','as2@dubid.test',FALSE),
  ('f7000000-0000-0000-0000-000000000003','as3@dubid.test',FALSE),
  ('f7000000-0000-0000-0000-000000000004','as4@dubid.test',FALSE);
SET dubid.test_uid = 'f7000000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('as1');
SET dubid.test_uid = 'f7000000-0000-0000-0000-000000000002';
SELECT game.ensure_profile('as2');
SET dubid.test_uid = 'f7000000-0000-0000-0000-000000000003';
SELECT game.ensure_profile('as3');
SET dubid.test_uid = 'f7000000-0000-0000-0000-000000000004';
SELECT game.ensure_profile('as4');   -- לא חבר בזירה
SET dubid.test_uid = 'f7000000-0000-0000-0000-000000000001';

DO $$
DECLARE
  v_world UUID; v_season UUID; v_arena UUID; g1 UUID; g2 UUID; l UUID; r JSONB;
  u1 UUID := 'f7000000-0000-0000-0000-000000000001';
  u2 UUID := 'f7000000-0000-0000-0000-000000000002';
  u3 UUID := 'f7000000-0000-0000-0000-000000000003';
BEGIN
  SELECT id, league_id INTO v_season, v_world FROM core.seasons ORDER BY is_current DESC, starts_on DESC NULLS LAST LIMIT 1;
  DELETE FROM game.gameweeks WHERE code IN ('as-1','as-2');
  INSERT INTO game.gameweeks (season_id, number, code, names, lock_at, first_kickoff_at, status)
  VALUES (v_season, 91, 'as-1', '{"he":{"full":"a"},"en":{"full":"a"}}'::jsonb, now() - interval '20 days', now() - interval '20 days', 'published') RETURNING id INTO g1;
  INSERT INTO game.gameweeks (season_id, number, code, names, lock_at, first_kickoff_at, status)
  VALUES (v_season, 92, 'as-2', '{"he":{"full":"b"},"en":{"full":"b"}}'::jsonb, now() - interval '10 days', now() - interval '10 days', 'published') RETURNING id INTO g2;

  INSERT INTO game.leagues (name, code, owner_id, kind, mode, world_id)
  VALUES ('Test Arena','ASAS22',u1,'arena','five',v_world) RETURNING id INTO v_arena;
  INSERT INTO game.league_members (league_id,user_id,joined_at) VALUES
    (v_arena,u1, now() - interval '30 days'),
    (v_arena,u2, now() - interval '30 days'),
    (v_arena,u3, now() - interval '15 days');   -- הצטרף אחרי מחזור 1

  /* מחזור 1: u1=10, u2=10 (שוויון → קפטן), u3 לא זכאי */
  INSERT INTO game.user_lineups (user_id,gameweek_id,mode,status,submitted_at) VALUES (u1,g1,'five','scored',now()-interval '21 days') RETURNING id INTO l;
  INSERT INTO game.lineup_scores (lineup_id,gameweek_id,total_points,captain_points,differential_points,rank) VALUES (l,g1,10,2,0,2);
  INSERT INTO game.user_lineups (user_id,gameweek_id,mode,status,submitted_at) VALUES (u2,g1,'five','scored',now()-interval '22 days') RETURNING id INTO l;
  INSERT INTO game.lineup_scores (lineup_id,gameweek_id,total_points,captain_points,differential_points,rank) VALUES (l,g1,10,6,0,1);
  /* מחזור 2: u1=5, u2 לא הגיש, u3=7 */
  INSERT INTO game.user_lineups (user_id,gameweek_id,mode,status,submitted_at) VALUES (u1,g2,'five','scored',now()-interval '11 days') RETURNING id INTO l;
  INSERT INTO game.lineup_scores (lineup_id,gameweek_id,total_points,captain_points,differential_points,rank) VALUES (l,g2,5,1,0,2);
  INSERT INTO game.user_lineups (user_id,gameweek_id,mode,status,submitted_at) VALUES (u3,g2,'five','scored',now()-interval '12 days') RETURNING id INTO l;
  INSERT INTO game.lineup_scores (lineup_id,gameweek_id,total_points,captain_points,differential_points,rank) VALUES (l,g2,7,1,0,1);
  /* הרכב בפורמט אחר (full) של u2 — אסור שייספר בזירת five */
  INSERT INTO game.user_lineups (user_id,gameweek_id,mode,status,submitted_at) VALUES (u2,g2,'full','scored',now()-interval '12 days') RETURNING id INTO l;
  INSERT INTO game.lineup_scores (lineup_id,gameweek_id,total_points,captain_points,differential_points,rank) VALUES (l,g2,99,0,0,1);

  r := game.arena_season_table(v_arena, 100, 0);
  IF jsonb_array_length(r) <> 3 THEN RAISE EXCEPTION 'FAIL 1: צפויים 3 חברים, התקבל %', r; END IF;
  /* סכומים: u1=15, u2=10, u3=7 */
  IF (r->0->>'userId')::uuid <> u1 OR (r->0->>'total')::numeric <> 15 THEN RAISE EXCEPTION 'FAIL 2: ראשון צריך להיות u1/15: %', r; END IF;
  IF (r->1->>'userId')::uuid <> u2 OR (r->1->>'total')::numeric <> 10 THEN RAISE EXCEPTION 'FAIL 3: שני u2/10 (בלי הרכב full): %', r; END IF;
  IF (r->2->>'userId')::uuid <> u3 OR (r->2->>'total')::numeric <> 7  THEN RAISE EXCEPTION 'FAIL 4: u3/7 (רק מחזור 2): %', r; END IF;
  IF (r->0->>'played')::int <> 2 OR (r->1->>'played')::int <> 1 OR (r->2->>'played')::int <> 1
    THEN RAISE EXCEPTION 'FAIL 5: played שגוי (אי-הגשה לא נספרת): %', r; END IF;
  /* תנועה: לפני מחזור 2 — u2 (קפטן 6) ראשון, u1 שני, u3 אחרון. אחרי: u1 ראשון */
  IF (r->0->>'movement')::int <> 1  THEN RAISE EXCEPTION 'FAIL 6: u1 עלה מקום אחד: %', r; END IF;
  IF (r->1->>'movement')::int <> -1 THEN RAISE EXCEPTION 'FAIL 7: u2 ירד מקום אחד: %', r; END IF;
  IF (r->0->>'bestRank')::int <> 1 AND (r->0->>'bestRank')::int <> 2 THEN RAISE EXCEPTION 'FAIL 8: bestRank חסר'; END IF;

  /* דטרמיניזם: שתי קריאות זהות */
  IF game.arena_season_table(v_arena, 100, 0) <> r THEN RAISE EXCEPTION 'FAIL 9: לא דטרמיניסטי'; END IF;
  /* החלוקה לעמודים */
  IF jsonb_array_length(game.arena_season_table(v_arena, 2, 0)) <> 2 THEN RAISE EXCEPTION 'FAIL 10: limit'; END IF;
  IF jsonb_array_length(game.arena_season_table(v_arena, 2, 2)) <> 1 THEN RAISE EXCEPTION 'FAIL 11: offset'; END IF;

  /* גישה: מי שאינו חבר נדחה */
  PERFORM set_config('dubid.test_uid','f7000000-0000-0000-0000-000000000004', true);
  BEGIN
    PERFORM game.arena_season_table(v_arena, 10, 0);
    RAISE EXCEPTION 'FAIL 12: לא-חבר קיבל טבלה';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'FORBIDDEN%' THEN RAISE; END IF;
  END;
END $$;
