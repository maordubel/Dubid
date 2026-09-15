-- =====================================================================
--  db/tests/_shared_gameweek.sql — מחזור הבדיקות
-- =====================================================================
--
--  ★ למה הקובץ הזה נולד
--
--  שבע בדיקות היו מקודדות על `gw-2`, ושלוש מהן גם על כך
--  שהדדליין שלו בעתיד. `db/25` הכניס את מחזור 4 והוריד את
--  מחזור 2, וממילא כל דדליין אמיתי הופך לעבר תוך ימים.
--  התוצאה: חבילת הבדיקות נצבעה אדום על מסד תקין לחלוטין,
--  ואז הפסיקו להסתכל עליה.
--
--  הקליטה האוטומטית מחריפה את זה: מעכשיו המחזורים מתקדמים
--  לבד, ואף מספר מחזור אינו יציב.
--
--  לכן: לבדיקות יש מחזור משלהן — `gw-2` — שנוצר כאן ולא תלוי
--  בשום מיגרציה, עם דדליין שתמיד בעתיד. הוא לא נוגע במחזור
--  האמיתי ולא הופך לנוכחי.
--
--  שימוש, בראש כל בדיקה:   \ir _shared_gameweek.sql
--  (`\ir` פותר יחסית לקובץ עצמו — עובד מכל תיקייה)
-- =====================================================================

DO $test_gw$
DECLARE
  v_season UUID;
  v_gw     UUID;
  v_lock   TIMESTAMPTZ := now() + INTERVAL '2 days';
  v_teams  UUID[];
  i        INT;
BEGIN
  SELECT id INTO v_season FROM core.seasons
   ORDER BY is_current DESC, starts_on DESC NULLS LAST LIMIT 1;
  IF v_season IS NULL THEN RAISE EXCEPTION 'אין עונה — הרצתם את db/RUN-ALL.sql?'; END IF;

  INSERT INTO game.gameweeks (season_id, number, code, names, lock_at, first_kickoff_at, status)
  VALUES (v_season, 2, 'gw-2',
          jsonb_build_object('he', jsonb_build_object('full', 'מחזור 2'),
                             'en', jsonb_build_object('full', 'Gameweek 2')),
          v_lock, v_lock, 'open')
  ON CONFLICT (season_id, number) DO UPDATE
    SET code = 'gw-2', lock_at = v_lock, first_kickoff_at = v_lock,
        status = CASE WHEN game.gameweeks.status IN ('published','archived')
                      THEN game.gameweeks.status ELSE 'open' END
  RETURNING id INTO v_gw;

  /* ★ שבעה משחקים, ותמיד בדיוק שבעה.
     הבדיקות רצות ברצף על אותו מסד, ואחדות מהן מוסיפות משחקים
     משלהן. בלי איפוס, בדיקה שסופרת "7" מקבלת 10 ונכשלת על
     זבל של קודמתה ולא על באג. מחיקה ואז יצירה = מצב פתיחה
     זהה לכל בדיקה, בכל סדר הרצה. */
  DELETE FROM core.weekly_matches WHERE gameweek_id = v_gw;

  SELECT array_agg(entity_id ORDER BY external_id) INTO v_teams
    FROM core.external_refs
   WHERE provider = 'manual_json' AND entity_type = 'team';

  IF array_length(v_teams, 1) >= 14 THEN
    FOR i IN 0..6 LOOP
      INSERT INTO core.weekly_matches
        (gameweek_id, home_team_id, away_team_id, kickoff_at, status)
      VALUES (v_gw, v_teams[i*2 + 1], v_teams[i*2 + 2],
              v_lock + (i || ' hours')::INTERVAL, 'scheduled');
    END LOOP;
  END IF;

END
$test_gw$;
