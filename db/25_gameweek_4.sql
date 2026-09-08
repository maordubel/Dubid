-- =====================================================================
--  db/25_gameweek_4.sql — מחזור 4 נכנס ונפתח למשחק
-- =====================================================================
--
--  ★ מה הקובץ הזה עושה
--
--  מכניס את שבעת משחקי מחזור 4 בליגת העל (13–15/09/2026), פותח
--  את המחזור להגשות, והופך אותו למחזור שהמשתמשים רואים.
--
--  ★ הדדליין הוא בעיטת הפתיחה **המוקדמת ביותר** — 13/09 בשעה
--    20:30. לא המאוחרת. מי שמחכה עד שלישי בוחר אחרי שכבר ראה
--    חמישה משחקים, וזה יתרון מידע שהורס את התחרות.
--
--  ★ שלוש עובדות על המחזור הזה שכדאי לדעת
--
--   · הוא נפרש על ראשון–שלישי ולא שבת–שני, כי 12/09 הוא ראש
--     השנה. לכן `dayLabel` בקליינט נגזר מהתאריך ולא מוקלד.
--   · הוא כולל את דרבי תל אביב הראשון של העונה — מכבי נגד
--     הפועל בבלומפילד, 14/09 20:30.
--   · שלוש שעות פתיחה שונות באותו ערב (19:30 / 20:00 / 20:30).
--     שעת ההגשה נסגרת על המוקדמת מכולן.
--
--  ★ מה הקובץ **לא** עושה
--
--   · לא נוגע במחזורים קיימים חוץ מהעברת הדגל `is_current`.
--     הגשות, ניקוד ותוצאות של מחזורים קודמים נשארים בדיוק
--     כפי שהם, וממשיכים להיות קריאים — `game.results` ו-
--     `game.entries` עובדות לפי קוד המחזור ולא לפי `is_current`.
--   · לא ממציא שעה לאף משחק. כל השבע מאושרות מול לוח מנהלת
--     הליגות (13–15/09/2026).
--
--  אידמפוטנטי. אפשר להריץ שוב, וגם אחרי שהאדמין כבר יצר את
--  המחזור מלוח הבקרה — ההרצה תעדכן שעות ולא תיצור כפילות.
-- =====================================================================

SET search_path = game, core, public;

DO $gw4$
DECLARE
  v_season UUID;
  v_gw     UUID;
  v_home   UUID;
  v_away   UUID;
  v_lock   TIMESTAMPTZ;
  v_count  INT;
  f        RECORD;
BEGIN
  SELECT s.id INTO v_season
    FROM core.seasons s
    JOIN core.leagues l ON l.id = s.league_id AND l.code = 'IL_PREMIER'
   ORDER BY s.is_current DESC, s.starts_on DESC NULLS LAST
   LIMIT 1;

  IF v_season IS NULL THEN
    RAISE NOTICE 'אין עונה במסד — הריצו קודם db/03_seed_squads.sql';
    RETURN;
  END IF;

  --------------------------------------------------------------- המחזור
  --  ★ `ON CONFLICT (season_id, number)` ולא לפי `code`: המפתח
  --    הטבעי של מחזור הוא העונה והמספר. אם האדמין כבר יצר
  --    "מחזור 4" מלוח הבקרה, זו אותה שורה — לא שנייה.
  INSERT INTO game.gameweeks (season_id, number, code, names,
                              lock_at, first_kickoff_at, status)
  VALUES (v_season, 4, 'gw-4',
          jsonb_build_object('he', jsonb_build_object('full', 'מחזור 4'),
                             'en', jsonb_build_object('full', 'Gameweek 4')),
          TIMESTAMPTZ '2026-09-13 20:30:00+03',
          TIMESTAMPTZ '2026-09-13 20:30:00+03',
          'open')
  ON CONFLICT (season_id, number) DO UPDATE
    SET code             = 'gw-4',
        names            = EXCLUDED.names,
        lock_at          = EXCLUDED.lock_at,
        first_kickoff_at = EXCLUDED.first_kickoff_at
  RETURNING id INTO v_gw;

  --------------------------------------------------------------- הלוח
  --  ★ המפתח הטבעי הוא (מחזור, בית, חוץ). הרצה שנייה מעדכנת
  --    שעה ולא מוסיפה משחק.
  FOR f IN
    SELECT * FROM (VALUES
      -- ראשון 13/09
      ('14','1',  TIMESTAMPTZ '2026-09-13 20:30:00+03'),  -- הפועל פ״ת – הפועל ב״ש
      -- שני 14/09
      ('13','7',  TIMESTAMPTZ '2026-09-14 19:30:00+03'),  -- הפועל ר״ג – מכבי נתניה
      ('9', '8',  TIMESTAMPTZ '2026-09-14 19:30:00+03'),  -- הפועל חיפה – בני סכנין
      ('10','4',  TIMESTAMPTZ '2026-09-14 20:00:00+03'),  -- עירוני ק״ש – מכבי חיפה
      ('3', '6',  TIMESTAMPTZ '2026-09-14 20:30:00+03'),  -- ★ דרבי ת״א · בלומפילד
      -- שלישי 15/09
      ('11','2',  TIMESTAMPTZ '2026-09-15 19:30:00+03'),  -- עירוני טבריה – הפועל י-ם
      ('5', '12', TIMESTAMPTZ '2026-09-15 20:00:00+03')   -- בית״ר י-ם – מכבי פ״ת
    ) AS t(home_ext, away_ext, kickoff)
  LOOP
    v_home := core.team_by_ext(f.home_ext);
    v_away := core.team_by_ext(f.away_ext);
    CONTINUE WHEN v_home IS NULL OR v_away IS NULL;

    INSERT INTO core.weekly_matches (gameweek_id, home_team_id, away_team_id,
                                     kickoff_at, status)
    VALUES (v_gw, v_home, v_away, f.kickoff, 'scheduled')
    ON CONFLICT (gameweek_id, home_team_id, away_team_id) DO UPDATE
      SET kickoff_at = EXCLUDED.kickoff_at;
  END LOOP;

  SELECT count(*) INTO v_count FROM core.weekly_matches WHERE gameweek_id = v_gw;

  ------------------------------------------------ דדליין נגזר, לא מוקלד
  --  ★ אותו חישוב בדיוק כמו `game.admin_resync_deadline`.
  --    שני מקומות שגוזרים דדליין בשתי דרכים הם משתמש שלוחץ
  --    "הגש" ומקבל דחייה בלי להבין למה.
  SELECT min(kickoff_at) INTO v_lock
    FROM core.weekly_matches WHERE gameweek_id = v_gw;

  IF v_lock IS NOT NULL THEN
    UPDATE game.gameweeks
       SET lock_at = v_lock, first_kickoff_at = v_lock
     WHERE id = v_gw;
  END IF;

  --------------------------------------------------------- פתיחה למשחק
  --  ⚠ שני התנאים לפני שמסובבים את הדגל:
  --
  --    · מחזור בלי משחקים שהופך לפעיל = מסך בית ריק לכל מי
  --      שפותח את האפליקציה. זה בדיוק מה ש-
  --      `admin_set_current_gameweek` מסרב לעשות, ולכן אותה
  --      בדיקה חיה גם כאן.
  --    · הסטטוס חייב להיות 'open'. מחזור שנוצר מלוח הבקרה
  --      נולד 'draft', ו-`isVisibleToUsers` בקליינט מסתיר
  --      מחזור כזה — כלומר המשתמש היה רואה מסך ריק בזמן
  --      שהשרת דווקא מקבל הגשות.
  IF v_count = 0 THEN
    RAISE NOTICE 'מחזור 4 נוצר בלי משחקים — לא הופך לפעיל.';
    RETURN;
  END IF;

  UPDATE game.gameweeks SET status = 'open'
   WHERE id = v_gw AND status IN ('draft', 'open');

  /* שתי פקודות ולא CASE אחד: האינדקס `gameweeks_one_current`
     ייחודי וחלקי, ונבדק אחרי כל פקודה. צריך לכבות לפני
     שמדליקים. */
  UPDATE game.gameweeks SET is_current = FALSE WHERE is_current AND id <> v_gw;
  UPDATE game.gameweeks SET is_current = TRUE  WHERE id = v_gw;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES ('migration:25', 'admin_create_gameweek', 'gameweek', 'gw-4',
          jsonb_build_object('number', 4, 'fixtures', v_count, 'lockAt', v_lock));

  /* ★ אין כאן קריאה ל-`bump_revision` בכוונה: היא פונקציית
     טריגר, ו-`PERFORM` עליה נכשל ב-
     "trigger functions can only be called as triggers".
     ממילא `game.gameweeks` ו-`core.weekly_matches` נמצאות
     שתיהן ברשימת הטריגרים של db/13, ולכן כל מכשיר פתוח
     מרענן מעצמו אחרי ההרצה. */

  RAISE NOTICE 'מחזור 4 פתוח: % משחקים, דדליין %', v_count, v_lock;
END
$gw4$;

-- ---------------------------------------------------------------------
-- בדיקת שפיות אחת שאומרת אם המחזור באמת פתוח
-- ---------------------------------------------------------------------
--   SELECT * FROM game.v_gameweek_4;
--     → code gw-4 · status open · is_current true · fixtures 7
--       · lock_at 2026-09-13 17:30+00
DROP VIEW IF EXISTS game.v_gameweek_4;
CREATE VIEW game.v_gameweek_4 AS
SELECT gw.code, gw.number, gw.status, gw.is_current, gw.lock_at,
       (SELECT count(*) FROM core.weekly_matches m WHERE m.gameweek_id = gw.id) AS fixtures
  FROM game.gameweeks gw
 WHERE gw.code = 'gw-4';

GRANT SELECT ON game.v_gameweek_4 TO authenticated;
