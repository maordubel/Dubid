-- =====================================================================
--  Dubid · מיגרציה 14 — לוח ניהול מלא, בלי תלות בקוד
-- =====================================================================
--
--  ★ הבקשה, כלשונה
--
--  "אני רוצה שתבנה לי לוח אדמין מלא שלא אצטרך אותך בכל פעם שאני
--   רוצה להוסיף / לשנות משהו."
--
--  ★ מה עמד בדרך
--
--  שלושה דברים היו **קבועים בקוד**, וכל שינוי בהם דרש פריסה:
--
--    1. **המחזור הנוכחי.** `src/data/fixtures.ts` הכריז
--       `GAMEWEEK.id = 'gw-2'`. מחזור 3 היה דורש עריכת קובץ.
--    2. **חוקי הניקוד.** `src/lib/scoring/rules.ts` — קוד.
--       איזון של נקודה אחת = פריסה.
--    3. **כל טקסט שיווקי במוצר.** מחרוזות בתוך קומפוננטות.
--
--  ═══════════════════════════════════════════════════════════════
--  ★ מה נוסף כאן
--  ═══════════════════════════════════════════════════════════════
--
--    §1  מחזורים — יצירה, רשימה, ו**המחזור הנוכחי כדגל במסד**.
--        זה השינוי היחיד שבאמת פותח את השאר: כל עוד הקליינט
--        יודע 'gw-2' בעל פה, שום לוח ניהול לא ישחרר אותך.
--
--    §2  קליטת לוח משחקים מ-JSON — נתיב אחד, ידני והיום, ו-API
--        מחר. ★ אידמפוטנטי: אותה קליטה פעמיים = אותה תוצאה.
--
--    §3  חוקי ניקוד כדאטה, עם היסטוריית גרסאות.
--
--    §4  תוכן ושיווק — כל מחרוזת שאפשר לערוך בלי פריסה.
--
--    §5  ניתוח — מי משחק, מה בוחרים, ומי חוזר.
--
--    §6  בריאות הנתונים — הדברים שנכשלים **בשקט**.
--
--  ═══════════════════════════════════════════════════════════════
--  ★ מה **לא** נעשה כאן, ובכוונה
--  ═══════════════════════════════════════════════════════════════
--
--  · אין כאן מפתח API של שום ספק. מפתח במסד הוא מפתח שדולף עם
--    גיבוי. מקומו היחיד: Supabase Edge Function Secrets.
--  · אין כאן "עריכת ניקוד ידנית" של משתמש. אדמין שיכול לשנות
--    נקודות של מישהו יכול לשבור תחרות — והאמון לא חוזר.
--  · שום פונקציה כאן לא מוחקת הגשה או תוצאה שכבר פורסמה.
--
--  אידמפוטנטי. אפשר להריץ שוב, בכל סדר.
-- =====================================================================

SET search_path = core, game, public;

-- =====================================================================
-- §1 מחזורים — והמחזור הנוכחי
-- =====================================================================
--
--  ★ למה דגל ולא "האחרון לפי תאריך"
--
--  "האחרון" נכון עד הרגע הראשון שבו הוא לא: מחזור עתידי שנבנה
--  מראש, מחזור שנדחה, או שניים שנפתחו בטעות. חוק נגזר שנשבר
--  פעם אחת בשנה הוא חוק שאי אפשר לסמוך עליו, ואי אפשר לדבג.
--
--  דגל מפורש הוא גם מה שנותן לאדמין את השליטה: "המחזור שהמשתמשים
--  רואים" הופך לכפתור, ולא למשהו שקורה מעצמו.

ALTER TABLE game.gameweeks ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT FALSE;

/* ★ אינדקס חלקי ייחודי: **בדיוק אחד** יכול להיות נוכחי.
   בלעדיו, שני מחזורים נוכחיים הם שתי תחרויות מקבילות שאף אחד
   לא התכוון אליהן, והמסך היה בוחר אחד מהם באקראי. */
CREATE UNIQUE INDEX IF NOT EXISTS gameweeks_one_current
  ON game.gameweeks ((TRUE)) WHERE is_current;

/* מי שכבר קיים במסד: אם אין אף נוכחי, המאוחר ביותר נבחר. */
DO $bootstrap$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM game.gameweeks WHERE is_current) THEN
    UPDATE game.gameweeks SET is_current = TRUE
     WHERE id = (SELECT id FROM game.gameweeks
                  WHERE code IS NOT NULL
                  ORDER BY number DESC LIMIT 1);
  END IF;
END
$bootstrap$;

/**
 * המחזור שהמשתמשים רואים עכשיו.
 *
 * ★ זו הפונקציה שמשחררת את הקליינט מ-'gw-2'.
 */
CREATE OR REPLACE FUNCTION game.current_gameweek()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
  SELECT code FROM game.gameweeks
   WHERE is_current AND code IS NOT NULL
   LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION game.current_gameweek() TO anon, authenticated;

/** רשימת המחזורים — לתפריט הנפתח בלוח הניהול. */
CREATE OR REPLACE FUNCTION game.gameweeks_list()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
  SELECT COALESCE(jsonb_agg(g ORDER BY (g->>'number')::INT DESC), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'code',      gw.code,
      'number',    gw.number,
      'label',     COALESCE(gw.names #>> '{he,full}', 'מחזור ' || gw.number),
      'status',    gw.status,
      'isCurrent', gw.is_current,
      'lockAt',    to_char(gw.lock_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'fixtures',  (SELECT count(*) FROM core.weekly_matches m WHERE m.gameweek_id = gw.id),
      'entries',   (SELECT count(*) FROM game.user_lineups ul
                     WHERE ul.gameweek_id = gw.id AND ul.status <> 'draft'),
      -- ★ אין עמודה `published`. הפרסום הוא **מצב**: `status='published'`.
      'published', (gw.status = 'published')
    ) AS g
    FROM game.gameweeks gw
    WHERE gw.code IS NOT NULL
  ) q;
$$;
GRANT EXECUTE ON FUNCTION game.gameweeks_list() TO anon, authenticated;

/**
 * מחזור חדש.
 *
 * ★ `p_code` נגזר מהמספר ולא מוקלד: 'gw-3'. פורמט חופשי היה
 *   מייצר 'GW3', 'gw3' ו-'gw-03' באותו מסד, וכל אחד מהם היה
 *   מחזור אחר מבחינת הקליינט.
 *
 * ★ הדדליין: אם לא נמסר, הוא **לא** מומצא. הוא נקבע רגע אחרי
 *   שנכנס המשחק הראשון (`admin_resync_deadline`). דדליין מומצא
 *   הוא בדיוק סוג הנתון שאף אחד לא בודק ושסוגר הגשות מוקדם.
 */
CREATE OR REPLACE FUNCTION game.admin_create_gameweek(
  p_number  SMALLINT,
  p_lock_at TIMESTAMPTZ DEFAULT NULL,
  p_label   TEXT DEFAULT NULL,
  p_make_current BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  v_season UUID;
  v_code   TEXT := 'gw-' || p_number::TEXT;
  v_id     UUID;
  v_lock   TIMESTAMPTZ;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF p_number IS NULL OR p_number < 1 OR p_number > 60 THEN
    RAISE EXCEPTION 'BAD_NUMBER: %', p_number;
  END IF;

  SELECT s.id INTO v_season FROM core.seasons s
   ORDER BY s.is_current DESC, s.starts_on DESC NULLS LAST LIMIT 1;
  IF v_season IS NULL THEN RAISE EXCEPTION 'NO_SEASON'; END IF;

  /* ★ בלי דדליין אמיתי — רחוק בעתיד, לא "עכשיו".
     `now()` היה יוצר מחזור **נעול ברגע שנוצר**, והאדמין היה
     מגלה את זה רק כשמשתמש מתלונן שאי אפשר להגיש. */
  v_lock := COALESCE(p_lock_at, now() + INTERVAL '365 days');

  INSERT INTO game.gameweeks (season_id, number, code, names, lock_at,
                              first_kickoff_at, status)
  VALUES (v_season, p_number, v_code,
          jsonb_build_object(
            'he', jsonb_build_object('full',
                    COALESCE(NULLIF(btrim(p_label), ''), 'מחזור ' || p_number)),
            'en', jsonb_build_object('full', 'Gameweek ' || p_number)),
          v_lock, v_lock, 'draft')
  ON CONFLICT (season_id, number) DO UPDATE
    SET code  = EXCLUDED.code,
        names = EXCLUDED.names
  RETURNING id INTO v_id;

  IF p_make_current THEN PERFORM game.admin_set_current_gameweek(v_code); END IF;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (auth.uid()::TEXT, 'admin_create_gameweek', 'gameweek', v_code,
          jsonb_build_object('number', p_number, 'lockAt', v_lock));

  RETURN jsonb_build_object('code', v_code, 'number', p_number, 'lockAt', v_lock);
END;
$$;

/**
 * החלפת המחזור הפעיל.
 *
 * ★ הפעולה הכי משמעותית בלוח כולו: היא מה שכל המשתמשים רואים.
 *   לכן היא גם היחידה שמסרבת למחזור בלי משחקים — מחזור ריק
 *   שהופך לפעיל הוא מסך בית ריק לכל מי שפותח את האפליקציה.
 */
CREATE OR REPLACE FUNCTION game.admin_set_current_gameweek(p_gw_code TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v_id UUID; v_fixtures INT;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  SELECT id INTO v_id FROM game.gameweeks WHERE code = p_gw_code;
  IF v_id IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND: %', p_gw_code; END IF;

  SELECT count(*) INTO v_fixtures FROM core.weekly_matches WHERE gameweek_id = v_id;
  IF v_fixtures = 0 THEN RAISE EXCEPTION 'NO_FIXTURES'; END IF;

  /* שתי פקודות ולא UPDATE אחד עם CASE: האינדקס הייחודי החלקי
     נבדק אחרי כל פקודה, ולכן צריך לכבות לפני שמדליקים. */
  UPDATE game.gameweeks SET is_current = FALSE WHERE is_current;
  UPDATE game.gameweeks SET is_current = TRUE  WHERE id = v_id;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (auth.uid()::TEXT, 'admin_set_current_gameweek', 'gameweek', p_gw_code,
          jsonb_build_object('code', p_gw_code));
END;
$$;

/**
 * מחיקת מחזור — רק אם אף אחד לא שיחק בו.
 *
 * ★ הגבול הזה אינו זהירות יתר. מחזור עם הגשות הוא תחרות
 *   שהתקיימה; מחיקה שלו מוחקת את התוצאה של אנשים אמיתיים,
 *   ואין ממה לשחזר.
 */
CREATE OR REPLACE FUNCTION game.admin_delete_gameweek(p_gw_code TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v_id UUID; v_entries INT;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  SELECT id INTO v_id FROM game.gameweeks WHERE code = p_gw_code;
  IF v_id IS NULL THEN RETURN; END IF;

  SELECT count(*) INTO v_entries FROM game.user_lineups
   WHERE gameweek_id = v_id AND status <> 'draft';
  IF v_entries > 0 THEN RAISE EXCEPTION 'HAS_ENTRIES: %', v_entries; END IF;

  IF EXISTS (SELECT 1 FROM game.gameweeks WHERE id = v_id AND is_current) THEN
    RAISE EXCEPTION 'IS_CURRENT';
  END IF;

  DELETE FROM game.gameweeks WHERE id = v_id;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, old_value)
  VALUES (auth.uid()::TEXT, 'admin_delete_gameweek', 'gameweek', p_gw_code, '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION
  game.admin_create_gameweek(SMALLINT,TIMESTAMPTZ,TEXT,BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION game.admin_set_current_gameweek(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION game.admin_delete_gameweek(TEXT)      TO authenticated;

-- =====================================================================
-- §2 קליטת לוח משחקים — נתיב אחד, ידני והיום, API מחר
-- =====================================================================
--
--  ★ העיקרון (מתוך ניסיון עם דאטת כדורגל): **קובץ אחד יודע מי
--    הספק. שום דבר אחר לא.**
--
--  הפונקציה כאן מקבלת מבנה **מנורמל** — לא את מה ש-API-Football
--  מחזיר. מי שמתרגם הוא ה-Edge Function (מחר) או האדמין שמדביק
--  JSON (היום). כך היום שבו הספק מתחלף נוגע בקובץ אחד, ולא
--  בכל שאילתה במסד.
--
--  המבנה:
--
--      [{ "home": "3", "away": "4", "kickoff": "2026-09-05T20:00:00+03:00" },
--       { "home": "1", "away": "2", "kickoff": "2026-09-05T20:00:00+03:00" }]
--
--  `home`/`away` הם המזהים החיצוניים של הקבוצות (בלי 'T').
--
--  ★ אידמפוטנטי לפי מפתח טבעי (מחזור + בית + חוץ). הרצה שנייה
--    של אותו JSON מעדכנת שעה ולא יוצרת כפילות. זה חשוב במיוחד
--    לספק: cron שרץ פעמיים, webhook שנשלח שוב.
--
--  ★ ולעולם לא ממציא שעה. משחק בלי `kickoff` תקין **נדחה
--    ומדווח**, ולא נכנס עם ברירת מחדל — כי הדדליין נגזר מהשעות,
--    ושעה מומצאת סוגרת הגשות ברגע הלא נכון.

CREATE OR REPLACE FUNCTION game.admin_import_fixtures(
  p_gw_code TEXT,
  p_payload JSONB,
  /** `TRUE` = משחקים שלא ברשימה נמחקים. לוח מלא מספק. */
  p_replace BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  v_gw       UUID;
  r          JSONB;
  v_home     UUID;
  v_away     UUID;
  v_kick     TIMESTAMPTZ;
  v_id       UUID;
  v_keep     UUID[] := '{}';
  v_added    INT := 0;
  v_updated  INT := 0;
  v_removed  INT := 0;
  v_problems JSONB := '[]'::jsonb;
  v_i        INT := 0;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF jsonb_typeof(p_payload) <> 'array' THEN RAISE EXCEPTION 'PAYLOAD_NOT_ARRAY'; END IF;

  SELECT id INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND: %', p_gw_code; END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_payload) LOOP
    v_i := v_i + 1;

    /* ★ שום שורה לא נופלת בשקט.
       כל בעיה נרשמת עם מספר השורה ומוחזרת לקורא. שורה שנעלמת
       בלי דיווח היא משחק שלא יתקיים ואף אחד לא ידע למה. */
    BEGIN
      v_home := core.team_by_ext(r->>'home');
      v_away := core.team_by_ext(r->>'away');
      v_kick := NULLIF(btrim(COALESCE(r->>'kickoff', '')), '')::TIMESTAMPTZ;

      IF v_home IS NULL THEN
        v_problems := v_problems || jsonb_build_object(
          'row', v_i, 'issue', 'קבוצה ביתית לא נמצאה', 'value', r->>'home');
        CONTINUE;
      END IF;
      IF v_away IS NULL THEN
        v_problems := v_problems || jsonb_build_object(
          'row', v_i, 'issue', 'קבוצה אורחת לא נמצאה', 'value', r->>'away');
        CONTINUE;
      END IF;
      IF v_home = v_away THEN
        v_problems := v_problems || jsonb_build_object(
          'row', v_i, 'issue', 'אותה קבוצה בשני הצדדים', 'value', r->>'home');
        CONTINUE;
      END IF;
      IF v_kick IS NULL THEN
        v_problems := v_problems || jsonb_build_object(
          'row', v_i, 'issue', 'שעת פתיחה חסרה או לא תקינה', 'value', r->>'kickoff');
        CONTINUE;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_problems := v_problems || jsonb_build_object(
        'row', v_i, 'issue', 'שורה פגומה', 'value', SQLERRM);
      CONTINUE;
    END;

    SELECT m.id INTO v_id FROM core.weekly_matches m
     WHERE m.gameweek_id = v_gw AND m.home_team_id = v_home AND m.away_team_id = v_away;

    IF v_id IS NULL THEN
      INSERT INTO core.weekly_matches
        (gameweek_id, home_team_id, away_team_id, kickoff_at, status)
      VALUES (v_gw, v_home, v_away, v_kick, 'scheduled')
      RETURNING id INTO v_id;
      v_added := v_added + 1;
    ELSE
      UPDATE core.weekly_matches SET kickoff_at = v_kick WHERE id = v_id;
      v_updated := v_updated + 1;
    END IF;

    v_keep := v_keep || v_id;
  END LOOP;

  IF p_replace THEN
    /* ★ מחיקה רק של משחקים **בלי תוצאה**. משחק שכבר הוזנו לו
       שערים הוא היסטוריה, וספק ששלח לוח חלקי לא אמור למחוק
       אותה. */
    DELETE FROM core.weekly_matches m
     WHERE m.gameweek_id = v_gw
       AND NOT (m.id = ANY(v_keep))
       AND m.home_goals IS NULL AND m.away_goals IS NULL;
    GET DIAGNOSTICS v_removed = ROW_COUNT;
  END IF;

  IF v_added + v_updated > 0 THEN
    PERFORM game.admin_resync_deadline(p_gw_code);
  END IF;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (auth.uid()::TEXT, 'admin_import_fixtures', 'gameweek', p_gw_code,
          jsonb_build_object('added', v_added, 'updated', v_updated,
                             'removed', v_removed,
                             'problems', jsonb_array_length(v_problems)));

  /* ★ דוח כיסוי, לא רק ספירת שגיאות.
     "0 שגיאות" מסתיר "נקלטו 3 מתוך 7". */
  RETURN jsonb_build_object(
    'received', v_i,
    'added',    v_added,
    'updated',  v_updated,
    'removed',  v_removed,
    'problems', v_problems,
    'lockAt',   (SELECT to_char(lock_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                   FROM game.gameweeks WHERE id = v_gw)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_import_fixtures(TEXT,JSONB,BOOLEAN) TO authenticated;

-- =====================================================================
-- §3 חוקי ניקוד כדאטה
-- =====================================================================
--
--  ★ למה זה לא "פשוט טבלה"
--
--  שינוי חוק ניקוד באמצע עונה משנה **רטרואקטיבית** את התוצאה של
--  כל מחזור שכבר נוקד — אם הניקוד מחושב מחדש. לכן:
--
--    · לכל שינוי יש **גרסה**.
--    · מחזור נועל את מספר הגרסה שלו ברגע הנעילה.
--    · הגרסה נשמרת בהיסטוריה ולא נדרסת.
--
--  ככה אפשר לאזן בלי לשכתב את העבר, ואפשר גם להסביר למשתמש
--  למה מחזור 3 ניקד אחרת ממחזור 2.

CREATE TABLE IF NOT EXISTS game.scoring_overrides (
  rule_key   TEXT PRIMARY KEY,
  points     NUMERIC(6,2) NOT NULL,
  version    INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);
GRANT SELECT ON game.scoring_overrides TO anon, authenticated;

CREATE TABLE IF NOT EXISTS game.scoring_history (
  id         BIGSERIAL PRIMARY KEY,
  rule_key   TEXT NOT NULL,
  old_points NUMERIC(6,2),
  new_points NUMERIC(6,2) NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by TEXT
);

/**
 * שינוי חוק.
 *
 * ★ `rule_key` לא נבדק מול רשימה סגורה, ובכוונה: המנוע בקליינט
 *   הוא זה שמכיר את המפתחות, והוא מתעלם ממפתח שאינו מוכר. רשימה
 *   כפולה כאן הייתה נשארת מאחור ביום שיתווסף חוק.
 *
 * ⚠ הטווח כן נבדק. חוק של 9,999 נקודות הוא לא איזון — הוא תקלה.
 */
CREATE OR REPLACE FUNCTION game.admin_set_rule(p_key TEXT, p_points NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_old NUMERIC; v_ver INT;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF btrim(COALESCE(p_key, '')) = '' THEN RAISE EXCEPTION 'KEY_REQUIRED'; END IF;
  IF p_points IS NULL OR p_points < -50 OR p_points > 50 THEN
    RAISE EXCEPTION 'POINTS_RANGE';
  END IF;

  SELECT points INTO v_old FROM game.scoring_overrides WHERE rule_key = p_key;
  SELECT COALESCE(MAX(version), 0) + 1 INTO v_ver FROM game.scoring_overrides;

  INSERT INTO game.scoring_overrides (rule_key, points, version, updated_by)
  VALUES (p_key, p_points, v_ver, auth.uid()::TEXT)
  ON CONFLICT (rule_key) DO UPDATE
    SET points = EXCLUDED.points, version = EXCLUDED.version,
        updated_at = now(), updated_by = EXCLUDED.updated_by;

  INSERT INTO game.scoring_history (rule_key, old_points, new_points, changed_by)
  VALUES (p_key, v_old, p_points, auth.uid()::TEXT);

  RETURN jsonb_build_object('key', p_key, 'points', p_points, 'version', v_ver);
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_set_rule(TEXT,NUMERIC) TO authenticated;

/** ביטול override — חזרה לברירת המחדל שבקוד. */
CREATE OR REPLACE FUNCTION game.admin_clear_rule(p_key TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_old NUMERIC;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  SELECT points INTO v_old FROM game.scoring_overrides WHERE rule_key = p_key;
  DELETE FROM game.scoring_overrides WHERE rule_key = p_key;
  IF v_old IS NOT NULL THEN
    INSERT INTO game.scoring_history (rule_key, old_points, new_points, changed_by)
    VALUES (p_key, v_old, 0, auth.uid()::TEXT);
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_clear_rule(TEXT) TO authenticated;

/** כל ה-overrides, לקליינט. קריאה פומבית — חוקי המשחק גלויים. */
CREATE OR REPLACE FUNCTION game.scoring_rules()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
  SELECT COALESCE(jsonb_object_agg(rule_key, points), '{}'::jsonb)
    FROM game.scoring_overrides;
$$;
GRANT EXECUTE ON FUNCTION game.scoring_rules() TO anon, authenticated;

-- =====================================================================
-- §4 תוכן ושיווק — כל מחרוזת שאפשר לשנות בלי פריסה
-- =====================================================================
--
--  ★ מה נכנס לכאן ומה לא
--
--  נכנס: כותרות, משפטי שיווק, הודעת מערכת, באנרים, וקישורי
--  קמפיין. כלומר כל דבר שהוא **החלטה שיווקית** ולא מבנה.
--
--  לא נכנס: תוויות של כפתורים ומסכי שגיאה. תרגום שנשבר בגלל
--  שמישהו ניקה שורה בטבלה הוא מוצר שבור, ולא קמפיין שהשתנה.
--
--  ★ לכל מפתח יש ברירת מחדל **בקוד**. הטבלה היא override בלבד,
--    ולכן מחיקה של שורה תמיד חוזרת למשהו תקין. טבלה שהיא מקור
--    יחיד לטקסט היא מסך ריק שמחכה לקרות.

CREATE TABLE IF NOT EXISTS game.content (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  note       TEXT,
  /** `FALSE` = שמור אבל לא מוצג. טיוטה של קמפיין. */
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);
GRANT SELECT ON game.content TO anon, authenticated;

ALTER TABLE game.content ENABLE ROW LEVEL SECURITY;
DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN RETURN; END IF;
  DROP POLICY IF EXISTS content_read ON game.content;
  /* רק מה שפעיל נקרא. טיוטת קמפיין לא אמורה לדלוף למי שיפתח
     DevTools לפני שהיא עולה. */
  CREATE POLICY content_read ON game.content FOR SELECT USING (active);
END
$c$;

CREATE OR REPLACE FUNCTION game.admin_set_content(
  p_key TEXT, p_value JSONB, p_note TEXT DEFAULT NULL, p_active BOOLEAN DEFAULT TRUE
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF btrim(COALESCE(p_key, '')) = '' THEN RAISE EXCEPTION 'KEY_REQUIRED'; END IF;

  INSERT INTO game.content (key, value, note, active, updated_by)
  VALUES (p_key, p_value, p_note, p_active, auth.uid()::TEXT)
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, note = COALESCE(EXCLUDED.note, game.content.note),
        active = EXCLUDED.active, updated_at = now(), updated_by = EXCLUDED.updated_by;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (auth.uid()::TEXT, 'admin_set_content', 'content', p_key, p_value);
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_set_content(TEXT,JSONB,TEXT,BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION game.admin_delete_content(p_key TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  DELETE FROM game.content WHERE key = p_key;
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_delete_content(TEXT) TO authenticated;

/** כל התוכן הפעיל, בקריאה אחת. הקליינט ממזג מעל ברירות המחדל. */
CREATE OR REPLACE FUNCTION game.content_all()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
  SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
    FROM game.content WHERE active;
$$;
GRANT EXECUTE ON FUNCTION game.content_all() TO anon, authenticated;

/** לאדמין: גם הלא-פעילים, עם המטא. */
CREATE OR REPLACE FUNCTION game.admin_content_list()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'key', key, 'value', value, 'note', note, 'active', active,
      'updatedAt', to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
      ORDER BY key)
    FROM game.content), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_content_list() TO authenticated;

-- =====================================================================
-- §5 ניתוח — מי משחק, מה בוחרים, ומי חוזר
-- =====================================================================
--
--  ★ שלוש שאלות, ולא עשרים מדדים.
--
--  לוח מחוונים עם עשרים מספרים הוא לוח שלא מסתכלים עליו. שלוש
--  שאלות שאפשר לפעול לפיהן:
--
--    1. **כמה אנשים משחקים, ומאיפה הם.**
--    2. **מה כולם בוחרים** — כי בחירה של 80% היא בחירה שלא
--       מבדילה, וזה בדיוק מה שהמשחק אמור למנוע.
--    3. **מי חוזר.** מוצר שבועי חי או מת על זה.

CREATE OR REPLACE FUNCTION game.admin_analytics(p_gw_code TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v_gw UUID; v_code TEXT;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  v_code := COALESCE(p_gw_code, game.current_gameweek());
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = v_code;

  RETURN jsonb_build_object(
    'gameweek', v_code,

    /* ---- 1 · קהל ---- */
    'audience', jsonb_build_object(
      'users',      (SELECT count(*) FROM game.users),
      'registered', (SELECT count(*) FROM game.users WHERE NOT COALESCE(is_guest, TRUE)),
      'guests',     (SELECT count(*) FROM game.users WHERE COALESCE(is_guest, TRUE)),
      'withOffsides',(SELECT count(*) FROM game.users WHERE offsides_user_id IS NOT NULL),
      'admins',     (SELECT count(*) FROM game.users WHERE is_admin),
      'leagues',    (SELECT count(*) FROM game.leagues)
    ),

    /* ---- 2 · השתתפות במחזור ---- */
    'entries', COALESCE((
      SELECT jsonb_object_agg(mode, n) FROM (
        SELECT ul.mode, count(*) AS n FROM game.user_lineups ul
         WHERE ul.gameweek_id = v_gw AND ul.status <> 'draft'
         GROUP BY ul.mode) q
    ), '{}'::jsonb),

    'drafts', COALESCE((
      SELECT jsonb_object_agg(mode, n) FROM (
        SELECT d.mode, count(*) AS n FROM game.lineup_drafts d
         WHERE d.gameweek_id = v_gw GROUP BY d.mode) q
    ), '{}'::jsonb),

    /* ★ שיעור ההשלמה: כמה טיוטות הפכו להגשה.
       זה המדד היחיד שמצביע ישירות על חיכוך במסך הבנייה. */
    'conversion', (
      SELECT CASE WHEN d.n = 0 THEN NULL
                  ELSE round(100.0 * e.n / d.n) END
        FROM (SELECT count(DISTINCT user_id) n FROM game.lineup_drafts
               WHERE gameweek_id = v_gw) d,
             (SELECT count(DISTINCT user_id) n FROM game.user_lineups
               WHERE gameweek_id = v_gw AND status <> 'draft') e
    ),

    /* ---- 3 · מה בוחרים ---- */
    /* ★ אחוז הבחירה. מעל 60% = שחקן שלא מבדיל בין מתחרים,
       כלומר מחיר שלא מאוזן. זה המספר שבאמת מזיז את המשחק. */
    'topPicks', COALESCE((
      SELECT jsonb_agg(p ORDER BY (p->>'picks')::INT DESC)
      FROM (
        SELECT jsonb_build_object(
          'player', pl.name_he,
          'team',   COALESCE(tm.short_code, tm.name_he),
          'picks',  count(*),
          'pct',    round(100.0 * count(*) / NULLIF((
                      SELECT count(*) FROM game.user_lineups ul2
                       WHERE ul2.gameweek_id = v_gw AND ul2.status <> 'draft'), 0))
        ) AS p
        FROM game.user_lineup_slots uls
        JOIN game.user_lineups ul ON ul.id = uls.lineup_id
        JOIN core.players pl ON pl.id = uls.player_id
        JOIN core.teams   tm ON tm.id = uls.team_id
        WHERE ul.gameweek_id = v_gw AND ul.status <> 'draft'
        GROUP BY pl.name_he, tm.short_code, tm.name_he
        ORDER BY count(*) DESC
        LIMIT 12
      ) q), '[]'::jsonb),

    'topCaptains', COALESCE((
      SELECT jsonb_agg(p ORDER BY (p->>'picks')::INT DESC)
      FROM (
        SELECT jsonb_build_object(
          'player', pl.name_he,
          'picks',  count(*)
        ) AS p
        FROM game.user_lineup_slots uls
        JOIN game.user_lineups ul ON ul.id = uls.lineup_id
        JOIN core.players pl ON pl.id = uls.player_id
        WHERE ul.gameweek_id = v_gw AND ul.status <> 'draft' AND uls.is_captain
        GROUP BY pl.name_he
        ORDER BY count(*) DESC
        LIMIT 8
      ) q), '[]'::jsonb),

    /* ---- 4 · חזרה ---- */
    /* ★ כמה מחזורים שיחק כל אחד. `1` = ניסה פעם אחת ולא חזר. */
    'retention', COALESCE((
      SELECT jsonb_object_agg(weeks::TEXT, people) FROM (
        SELECT weeks, count(*) AS people FROM (
          SELECT user_id, count(DISTINCT gameweek_id) AS weeks
            FROM game.user_lineups WHERE status <> 'draft'
           GROUP BY user_id) u
        GROUP BY weeks) q
    ), '{}'::jsonb),

    'generatedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_analytics(TEXT) TO authenticated;

-- =====================================================================
-- §6 בריאות הנתונים — מה שנכשל בשקט
-- =====================================================================
--
--  ★ הרשימה הזו אינה גנרית. כל שורה בה היא תקלה שקרתה, או
--    שיודעים שהיא קורית בדאטת כדורגל:
--
--    · מחזור שעבר את הדדליין ועדיין פתוח → האוטומציה נעצרה,
--      והמערכת ממשיכה לקבל הגשות אחרי שהכדור מתגלגל.
--    · שחקן בסגל בלי מחיר → הוא מתומחר ברצפה, וכולם לוקחים אותו.
--    · מספרי חולצה כפולים באותה קבוצה → שני אנשים התמזגו לאחד.
--    · מחזור פעיל בלי משחקים → מסך בית ריק לכל המשתמשים.

CREATE OR REPLACE FUNCTION game.admin_data_quality()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v_out JSONB := '[]'::jsonb;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  /* מחזור פתוח שהדדליין שלו עבר */
  v_out := v_out || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'level', 'error', 'code', 'GW_OPEN_PAST_DEADLINE',
      'title', 'מחזור פתוח אחרי הדדליין',
      'detail', gw.code || ' — הדדליין עבר, והמחזור עדיין מקבל הגשות',
      'fix', 'לשונית מחזור → מצב → נעול'))
    FROM game.gameweeks gw
    WHERE gw.status IN ('open', 'draft') AND now() >= gw.lock_at), '[]'::jsonb);

  /* מחזור פעיל בלי משחקים */
  v_out := v_out || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'level', 'error', 'code', 'CURRENT_GW_NO_FIXTURES',
      'title', 'המחזור הפעיל בלי לוח משחקים',
      'detail', gw.code || ' — אין לו אף משחק',
      'fix', 'לשונית מחזור → קליטת לוח'))
    FROM game.gameweeks gw
    WHERE gw.is_current
      AND NOT EXISTS (SELECT 1 FROM core.weekly_matches m WHERE m.gameweek_id = gw.id)),
    '[]'::jsonb);

  /* שחקנים בלי מחיר */
  v_out := v_out || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'level', 'error', 'code', 'PLAYERS_NO_PRICE',
      'title', 'שחקנים בלי מחיר',
      'detail', n || ' שחקנים בסגל בלי מחיר — כולם מתומחרים ברצפה',
      'fix', 'לשונית סגלים → להשלים מחיר'))
    FROM (SELECT count(*) n FROM core.squads
           WHERE valid_to IS NULL AND fantasy_price IS NULL) q
    WHERE n > 0), '[]'::jsonb);

  /* שחקנים בלי דרג */
  v_out := v_out || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'level', 'warn', 'code', 'PLAYERS_NO_TIER',
      'title', 'שחקנים בלי דרג',
      'detail', n || ' שחקנים יופיעו עם דרג ברירת מחדל',
      'fix', 'לשונית סגלים → דרג'))
    FROM (SELECT count(*) n FROM core.squads
           WHERE valid_to IS NULL AND tier IS NULL) q
    WHERE n > 0), '[]'::jsonb);

  /* מספרי חולצה כפולים באותה קבוצה */
  /* ★ `GROUP BY` בתוך תת-שאילתה סקלרית מחזיר **שורה לכל קבוצה**,
     ואז `jsonb_agg` מצטבר בתוך כל קבוצה בנפרד — כלומר מספר
     שורות, ו-PostgreSQL נופל על
     "more than one row returned by a subquery".
     הצבירה חייבת לעטוף את הקיבוץ, לא להיות בתוכו. */
  v_out := v_out || COALESCE((
    SELECT jsonb_agg(d)
    FROM (
      SELECT jsonb_build_object(
        'level', 'warn', 'code', 'DUPLICATE_SHIRT',
        'title', 'מספר חולצה כפול',
        'detail', tm.name_he || ' — מספר ' || sq.shirt_number || ' מופיע פעמיים',
        'fix', 'לשונית סגלים → לתקן מספר') AS d
      FROM core.squads sq JOIN core.teams tm ON tm.id = sq.team_id
      WHERE sq.valid_to IS NULL AND sq.shirt_number IS NOT NULL
      GROUP BY tm.name_he, sq.team_id, sq.shirt_number
      HAVING count(*) > 1
    ) q), '[]'::jsonb);

  /* קבוצה בלי אף שחקן */
  v_out := v_out || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'level', 'error', 'code', 'TEAM_NO_PLAYERS',
      'title', 'קבוצה בלי סגל',
      'detail', tm.name_he || ' — אין לה אף שחקן פעיל',
      'fix', 'לשונית סגלים → הוספת שחקנים'))
    FROM core.teams tm
    WHERE EXISTS (SELECT 1 FROM core.external_refs x
                   WHERE x.provider='manual_json' AND x.entity_type='team'
                     AND x.entity_id = tm.id)
      AND NOT EXISTS (SELECT 1 FROM core.squads sq
                       WHERE sq.team_id = tm.id AND sq.valid_to IS NULL)),
    '[]'::jsonb);

  /* קבוצה שאין לה משחק במחזור הפעיל */
  v_out := v_out || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'level', 'warn', 'code', 'TEAM_NO_FIXTURE',
      'title', 'קבוצה בלי משחק במחזור',
      'detail', tm.name_he || ' — לא משחקת. השחקנים שלה ייבחרו ולא יצברו נקודות',
      'fix', 'לשונית מחזור → להוסיף את המשחק החסר'))
    FROM core.teams tm
    JOIN core.external_refs x ON x.provider='manual_json' AND x.entity_type='team'
                             AND x.entity_id = tm.id
    WHERE EXISTS (SELECT 1 FROM core.squads sq
                   WHERE sq.team_id = tm.id AND sq.valid_to IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM core.weekly_matches m
        JOIN game.gameweeks gw ON gw.id = m.gameweek_id AND gw.is_current
        WHERE m.home_team_id = tm.id OR m.away_team_id = tm.id)),
    '[]'::jsonb);

  RETURN v_out;
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_data_quality() TO authenticated;

/* ★ יומן הביקורת, לתצוגה. מי עשה מה, מתי. */
CREATE OR REPLACE FUNCTION game.admin_audit(p_limit INT DEFAULT 40)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(a ORDER BY (a->>'at') DESC)
    FROM (
      SELECT jsonb_build_object(
        'action', l.action,
        'entity', l.entity,
        'id',     l.entity_id,
        'value',  l.new_value,
        'at',     to_char(l.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'who',    COALESCE(u.display_name, left(l.actor, 8))
      ) AS a
      FROM game.audit_logs l
      LEFT JOIN game.users u ON u.id::TEXT = l.actor
      ORDER BY l.created_at DESC
      LIMIT GREATEST(1, LEAST(p_limit, 200))
    ) q), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_audit(INT) TO authenticated;

/* מונה הגרסה מכיר גם את הטבלאות החדשות. */
DO $trg$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['game.scoring_overrides', 'game.content'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS bump_data_revision ON %s', t);
    EXECUTE format(
      'CREATE TRIGGER bump_data_revision AFTER INSERT OR UPDATE OR DELETE ON %s '
      'FOR EACH STATEMENT EXECUTE FUNCTION game.bump_revision()', t);
  END LOOP;
END
$trg$;

UPDATE game.data_revision SET revision = revision + 1, scope = 'migration-14' WHERE id = 1;
