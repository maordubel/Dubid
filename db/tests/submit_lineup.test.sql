-- בדיקות נתיב ההגשה. ראו db/tests/README.md.
-- ON_ERROR_STOP כבוי בכוונה: חלק מהמקרים *אמורים* להיכשל.
\set ON_ERROR_STOP off
INSERT INTO auth.users (id) VALUES ('11111111-1111-1111-1111-111111111111') ON CONFLICT DO NOTHING;
SELECT set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
INSERT INTO game.users (id, auth_id, display_name)
  VALUES ('11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','בודק')
  ON CONFLICT DO NOTHING;
INSERT INTO game.gameweeks (id, season_id, number, status, lock_at)
SELECT '22222222-2222-2222-2222-222222222222', s.id, 99, 'open', now() - interval '1 second'
  FROM core.seasons s LIMIT 1
ON CONFLICT (id) DO UPDATE SET status='open', lock_at = now() - interval '1 second';

-- הרכב חוקי: חמישה שחקנים, כל אחד מקבוצה אחרת
CREATE OR REPLACE VIEW pg_temp.valid_slots AS
WITH picked AS (
  SELECT DISTINCT ON (sq.team_id) pl.id, sq.team_id FROM core.squads sq
    JOIN core.players pl ON pl.id = sq.player_id ORDER BY sq.team_id, pl.id LIMIT 5),
n AS (SELECT id, row_number() OVER (ORDER BY id) rn FROM picked)
SELECT jsonb_agg(jsonb_build_object('slot_no',rn,'player_id',id,
       'is_captain',rn=1,'is_vice',rn=2,'is_bench',false)) AS slots FROM n;

-- הרכב פסול: חמישה מאותה קבוצה
CREATE OR REPLACE VIEW pg_temp.same_team_slots AS
WITH picked AS (
  SELECT pl.id FROM core.squads sq JOIN core.players pl ON pl.id = sq.player_id
   WHERE sq.team_id = (SELECT team_id FROM core.squads ORDER BY team_id LIMIT 1) LIMIT 5),
n AS (SELECT id, row_number() OVER (ORDER BY id) rn FROM picked)
SELECT jsonb_agg(jsonb_build_object('slot_no',rn,'player_id',id,
       'is_captain',rn=1,'is_vice',rn=2,'is_bench',false)) AS slots FROM n;

\echo '### 1. הגשה אחרי הדדליין — חייבת להיכשל'
SELECT game.submit_lineup('22222222-2222-2222-2222-222222222222','five','2-1-1',
       (SELECT slots FROM pg_temp.valid_slots));

\echo '### 2. אותה הגשה, דדליין בעתיד — חייבת להצליח'
UPDATE game.gameweeks SET lock_at = now() + interval '1 hour'
 WHERE id = '22222222-2222-2222-2222-222222222222';
SELECT (game.submit_lineup('22222222-2222-2222-2222-222222222222','five','2-1-1',
       (SELECT slots FROM pg_temp.valid_slots))).status AS status;

\echo '### 3. חמישה מאותה קבוצה — חייבת להיכשל'
SELECT game.submit_lineup('22222222-2222-2222-2222-222222222222','five','2-1-1',
       (SELECT slots FROM pg_temp.same_team_slots));

\echo '### 4. מחזור שהאדמין נעל ידנית — חייבת להיכשל'
UPDATE game.gameweeks SET status='locked' WHERE id='22222222-2222-2222-2222-222222222222';
SELECT game.submit_lineup('22222222-2222-2222-2222-222222222222','five','2-1-1',
       (SELECT slots FROM pg_temp.valid_slots));
