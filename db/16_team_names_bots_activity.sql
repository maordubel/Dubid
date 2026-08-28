-- =====================================================================
--  Dubid · מיגרציה 16 — שם קבוצה, משתתפים גלויים, בוטים, ויומן פעילות
-- =====================================================================
--
--  ארבעה שינויים שנראים לא קשורים, ויש להם מכנה משותף אחד:
--  **המחזור צריך להרגיש מאוכלס לפני שהוא מתחיל.**
--
--    1. לכל הרכב יש שם קבוצה ושם מאמן — לא רק "אלמוני".
--    2. כל מי שהגיש נראה בטבלה עוד לפני הנעילה.
--    3. אדמין יכול להוסיף בוטים למחזור ריק.
--    4. אדמין רואה יומן פעילות חי של מי הגיש מה.
--
--  אידמפוטנטי. אפשר להריץ שוב.
-- =====================================================================

SET search_path = game, core, public;

-- ---------------------------------------------------------------------
-- §1 · שם הקבוצה
-- ---------------------------------------------------------------------
--
--  ★ למה שם קבוצה **בנוסף** לשם המאמן, ולא במקומו
--
--  שם המאמן הוא הזהות של האדם ("מאור"). שם הקבוצה הוא הזהות של
--  ה**הרכב** ("שכונת התקווה יונייטד"), והוא מה שהופך טבלה של
--  שמות פרטיים לליגה. בכל משחק פנטזי מוצלח יש את שניהם, וזה
--  לא במקרה: השם הפרטי מזהה, שם הקבוצה **משתתף**.
--
--  ★ הוא יושב על ההרכב ולא על המשתמש
--
--  כי אותו אדם משחק גם דוביד 5 וגם דוביד 11, ואולי ירצה שם אחר
--  לכל אחד. וגם: שם שנקבע בהגשה נשאר קפוא באותו מחזור גם אם
--  המשתמש שינה אותו אחר כך — בדיוק כמו הסגל וכמו המחיר.
-- ---------------------------------------------------------------------

ALTER TABLE game.user_lineups
  ADD COLUMN IF NOT EXISTS team_name TEXT;

COMMENT ON COLUMN game.user_lineups.team_name IS
  'שם הקבוצה של המתמודד באותו מחזור. NULL = טרם נבחר.';

-- ---------------------------------------------------------------------
-- §2 · הגשה עם שם קבוצה
-- ---------------------------------------------------------------------
--
--  ★ פרמטר חדש בסוף ועם DEFAULT — ולא חתימה חדשה.
--
--  קליינט ישן שעוד לא נפרס ממשיך לקרוא לפונקציה עם חמישה
--  ארגומנטים ולקבל בדיוק את מה שקיבל קודם. חתימה שנשברת באמצע
--  פריסה מפילה הגשות בזמן שהמחזור פתוח.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.set_entry_team_name(
  p_gw_code TEXT, p_mode TEXT, p_team_name TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  v_auth UUID := auth.uid();
  v_gw   game.gameweeks;
  v_name TEXT := NULLIF(btrim(p_team_name), '');
BEGIN
  IF v_auth IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  /* ★ תקרה על האורך. שם של מאתיים תווים לא "נראה רע" — הוא
     שובר כל שורה בטבלה ובכל כרטיס שיתוף. */
  IF v_name IS NOT NULL AND length(v_name) > 24 THEN
    v_name := left(v_name, 24);
  END IF;

  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw.id IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND'; END IF;

  UPDATE game.user_lineups
     SET team_name = v_name
   WHERE user_id = v_auth AND gameweek_id = v_gw.id AND mode = p_mode;
END;
$$;

GRANT EXECUTE ON FUNCTION game.set_entry_team_name(TEXT, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- §3 · המשתתפים נראים לפני הנעילה
-- ---------------------------------------------------------------------
--
--  ★★ מה שהיה, ולמה זה פגע במוצר ★★
--
--  `game.entries` החזירה לפני הנעילה **רק את ההגשה שלי**:
--
--      AND (now() >= v_gw.lock_at OR ul.user_id = v_auth)
--
--  כלומר משתמש שהגיש ראשון פתח את הטבלה וראה את עצמו לבד. מחזור
--  שנראה ריק הוא מחזור שלא מרגיש כמו תחרות, וזה בדיוק הרגע שבו
--  הוא מפסיק לחכות לו.
--
--  ★★ ולמה אי אפשר פשוט להסיר את השורה ★★
--
--  כי אז כל אחד יכול לפתוח את הטבלה, לראות את ההרכב של מי שהוא
--  חושב שמבין, ולהעתיק אותו דקה לפני הנעילה. זה הורג את המשחק.
--
--  ★ הפתרון: לחשוף את ה**משתתף**, להסתיר את ה**הרכב**.
--
--  לפני הנעילה כל הגשה חוזרת עם שם, שם קבוצה וחותמת זמן —
--  ובלי שחקנים (`slots: []`, `hidden: true`). אחרי הנעילה הכל
--  נפתח. ההסתרה היא בשרת, ולא במסך: קליינט הוא בקשת רשת, ומה
--  שהוא לא אמור לדעת פשוט לא נשלח אליו.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.entries(p_gw_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  v_gw     game.gameweeks;
  v_auth   UUID := auth.uid();
  v_open   BOOLEAN;
BEGIN
  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw.id IS NULL THEN RETURN '[]'::jsonb; END IF;

  -- TRUE = ההרכבים עדיין סודיים.
  v_open := (now() < v_gw.lock_at);

  RETURN COALESCE((
    SELECT jsonb_agg(e ORDER BY e->>'submittedAt')
    FROM (
      SELECT jsonb_build_object(
        'id',          ul.id,
        'userId',      ul.user_id,
        'displayName', COALESCE(NULLIF(btrim(u.display_name), ''), 'אלמוני'),
        'teamName',    ul.team_name,
        'isBot',       COALESCE(u.is_bot, FALSE),
        'gameweekId',  p_gw_code,
        'mode',        ul.mode,
        -- ★ הדגל שאומר למסך "יש כאן משתתף, אין כאן הרכב".
        --   בלעדיו המסך היה מנסה לנקד רשימה ריקה ומציג 0.
        'hidden',      (v_open AND ul.user_id IS DISTINCT FROM v_auth),
        'submittedAt', to_char(ul.submitted_at AT TIME ZONE 'UTC',
                               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'lineup', jsonb_build_object(
          'lineupId',   ul.id,
          'userId',     ul.user_id,
          'gameweekId', p_gw_code,
          'formation',  ul.formation,
          'slots', CASE
            WHEN v_open AND ul.user_id IS DISTINCT FROM v_auth THEN '[]'::jsonb
            ELSE COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'slotNo',    s.slot_no,
                'playerId',  'P' || xp.external_id,
                'teamId',    'T' || xt.external_id,
                'position',  s.position,
                'price',     s.price,
                'isCaptain', s.is_captain,
                'isVice',    s.is_vice,
                'isBench',   s.is_bench
              ) ORDER BY s.slot_no)
              FROM game.user_lineup_slots s
              JOIN core.v_ext xp ON xp.entity_type = 'player' AND xp.entity_id = s.player_id
              JOIN core.v_ext xt ON xt.entity_type = 'team'   AND xt.entity_id = s.team_id
              WHERE s.lineup_id = ul.id
            ), '[]'::jsonb)
          END
        )
      ) AS e
      FROM game.user_lineups ul
      LEFT JOIN game.users u ON u.id = ul.user_id
      WHERE ul.gameweek_id = v_gw.id
        AND ul.status IN ('submitted','locked','scored')
    ) q
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION game.entries(TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- §4 · בוטים
-- ---------------------------------------------------------------------
--
--  ★ למה בוטים הם כלי מוצר ולא רמאות
--
--  מחזור ראשון עם שני משתתפים אינו תחרות, וטבלה עם שתי שורות
--  אומרת למשתמש החדש "אין כאן אף אחד". בוטים פותרים בעיה
--  אמיתית של השקה — ובתנאי אחד: **שהם יהיו מסומנים.**
--
--  `is_bot` נשמר על המשתמש וחוזר לכל מסך. אף מסך לא חייב להציג
--  את זה, אבל אף מסך לא יכול לטעון שהוא לא ידע. הסתרה של זה
--  הייתה הופכת כלי לגיטימי להטעיה.
--
--  ★ הבוט משחק לפי אותם חוקים
--
--  הוא עובר דרך אותה ולידציה: שחקן אחד מכל קבוצה, גודל הרכב,
--  תקציב. אין כאן "הרכב שהוזרק" — יש הגשה שנבנית ונבדקת.
--
--  ★ והוא דטרמיניסטי
--
--  אותו מחזור + אותו אינדקס בוט = אותו הרכב, תמיד. `random()`
--  היה הופך כל הרצה חוזרת של המיגרציה לתוצאה אחרת, ואת הבדיקה
--  לחסרת ערך. הזרע נגזר מקוד המחזור ומהמספר הסידורי.
-- ---------------------------------------------------------------------

ALTER TABLE game.users
  ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN game.users.is_bot IS
  'משתתף שנוצר על ידי האדמין. חוזר לכל מסך — הסתרה הייתה הטעיה.';

CREATE INDEX IF NOT EXISTS users_is_bot_idx ON game.users (is_bot) WHERE is_bot;

/**
 * שמות הבוטים. שכונתיים, ולא "Bot 1".
 *
 * ★ בוט בשם "Bot 4" הורס את האווירה גם כשהוא מסומן. שם אמיתי
 *   הופך את הטבלה למאוכלסת; התג לידו הוא מה ששומר על ההגינות.
 */
CREATE OR REPLACE FUNCTION game.bot_identity(p_index INT)
RETURNS TABLE (coach TEXT, team TEXT)
LANGUAGE sql IMMUTABLE
AS $$
  WITH c(n) AS (
    SELECT * FROM unnest(ARRAY[
      'אבי','מוטי','שוקי','ג׳קי','רפי','חיים','ניסים','דודו',
      'אלי','יוסי','שמעון','מאיר','ציון','רוני','אמנון','גבי'
    ])
  ), t(n) AS (
    SELECT * FROM unnest(ARRAY[
      'שכונת התקווה','אצטדיון הסמטה','בני המרכזייה','מכבי הפנימייה',
      'הפועל הקיוסק','נבחרת הפלאפל','שער הכניסה','יוניון בית הקפה',
      'אלופי החניון','ספסל הרזרבה','מועדון הצהריים','ליגת המרפסת',
      'אחוזת הדשא','ועד השכונה','חלוצי הרחוב','גיבורי המגרש'
    ])
  )
  SELECT
    (SELECT n FROM c OFFSET (abs(p_index) % 16) LIMIT 1),
    (SELECT n FROM t OFFSET (abs(p_index) % 16) LIMIT 1);
$$;

/**
 * הוספת בוטים למחזור.
 *
 * מחזיר {added, skipped, problems[]}. `skipped` אינו שגיאה: בוט
 * שכבר הגיש למחזור הזה פשוט נשאר כמו שהוא, וזה מה שהופך את
 * הפונקציה לבטוחה להרצה חוזרת.
 */
CREATE OR REPLACE FUNCTION game.admin_add_bots(
  p_gw_code TEXT,
  p_mode    TEXT,
  p_count   INT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  v_gw       game.gameweeks;
  v_size     INT;
  v_budget   NUMERIC := 15;
  v_added    INT := 0;
  v_skipped  INT := 0;
  v_problems JSONB := '[]'::jsonb;
  i          INT;
  v_seed     INT;
  v_user     UUID;
  v_coach    TEXT;
  v_team     TEXT;
  v_lineup   UUID;
  v_slot_no  INT;
  v_spent    NUMERIC;
  r          RECORD;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF p_mode NOT IN ('five','full') THEN RAISE EXCEPTION 'INVALID_MODE'; END IF;

  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw.id IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND'; END IF;

  v_size := CASE WHEN p_mode = 'five' THEN 5 ELSE 11 END;

  FOR i IN 1..GREATEST(1, LEAST(p_count, 60)) LOOP
    /* ★ הזרע נגזר מקוד המחזור ומהאינדקס — ולא מ-`random()`.
       אותה הרצה, אותה תוצאה, תמיד. */
    v_seed := abs(hashtext(p_gw_code || ':' || p_mode || ':' || i));

    SELECT coach, team INTO v_coach, v_team FROM game.bot_identity(v_seed);
    v_coach := v_coach || ' ' || i::TEXT;

    /* המשתמש. `username` ייחודי ולכן הוא גם מפתח החיפוש. */
    SELECT id INTO v_user FROM game.users
     WHERE username = ('bot_' || p_gw_code || '_' || p_mode || '_' || i)::CITEXT;

    IF v_user IS NULL THEN
      INSERT INTO game.users (display_name, username, is_guest, is_bot)
      VALUES (v_coach,
              ('bot_' || p_gw_code || '_' || p_mode || '_' || i)::CITEXT,
              TRUE, TRUE)
      RETURNING id INTO v_user;
    END IF;

    /* כבר הגיש? מדלגים. */
    PERFORM 1 FROM game.user_lineups
     WHERE user_id = v_user AND gameweek_id = v_gw.id AND mode = p_mode
       AND status IN ('submitted','locked','scored');
    IF FOUND THEN v_skipped := v_skipped + 1; CONTINUE; END IF;

    DELETE FROM game.user_lineups
     WHERE user_id = v_user AND gameweek_id = v_gw.id AND mode = p_mode;

    INSERT INTO game.user_lineups
      (user_id, gameweek_id, mode, formation, status, submitted_at, team_name)
    VALUES (v_user, v_gw.id, p_mode,
            CASE WHEN p_mode = 'five' THEN '2-1-1' ELSE '4-3-3' END,
            'submitted', now(), v_team)
    RETURNING id INTO v_lineup;

    v_slot_no := 0;
    v_spent := 0;

    /*
     * ★ בחירת השחקנים.
     *
     *   · שחקן אחד מכל קבוצה — `DISTINCT ON (team_id)`, אותו
     *     חוק ליבה שחל על בני אדם.
     *   · הסדר נגזר מהזרע, כך שכל בוט בוחר אחרת אבל באופן קבוע.
     *   · במצב חמישה גם התקציב נאכף, ולכן ממיינים מהזול ליקר
     *     בתוך הערבוב — בוט שחרג בתקציב היה נדחה בהגשה של
     *     בן אדם, ואסור לו להיות פטור.
     */
    FOR r IN
      SELECT * FROM (
        SELECT DISTINCT ON (sq.team_id)
               sq.player_id, sq.team_id, sq.position,
               COALESCE(sq.fantasy_price, 0) AS price
          FROM core.squads sq
         WHERE sq.valid_to IS NULL AND sq.status = 'active'
         ORDER BY sq.team_id, md5(sq.player_id::TEXT || v_seed::TEXT)
      ) picks
      ORDER BY CASE WHEN p_mode = 'five' THEN picks.price ELSE 0 END,
               md5(picks.team_id::TEXT || v_seed::TEXT)
      LIMIT v_size
    LOOP
      v_slot_no := v_slot_no + 1;
      v_spent := v_spent + r.price;
      INSERT INTO game.user_lineup_slots
        (lineup_id, slot_no, player_id, team_id, position, price,
         is_captain, is_vice, is_bench)
      VALUES (v_lineup, v_slot_no, r.player_id, r.team_id, r.position, r.price,
              v_slot_no = 1, v_slot_no = 2, FALSE);
    END LOOP;

    IF v_slot_no < v_size THEN
      v_problems := v_problems || jsonb_build_object(
        'bot', i, 'issue', 'אין מספיק קבוצות פעילות בליגה');
      DELETE FROM game.user_lineups WHERE id = v_lineup;
      CONTINUE;
    END IF;

    IF p_mode = 'five' AND v_spent > v_budget THEN
      v_problems := v_problems || jsonb_build_object(
        'bot', i, 'issue', format('חריגה מתקציב: %s > %s', v_spent, v_budget));
      DELETE FROM game.user_lineups WHERE id = v_lineup;
      CONTINUE;
    END IF;

    v_added := v_added + 1;
    PERFORM game.log_activity(v_user, 'bot_submit', p_mode, p_gw_code, v_team);
  END LOOP;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (COALESCE(auth.uid()::TEXT, 'admin'), 'admin_add_bots', 'gameweek', p_gw_code,
          jsonb_build_object('mode', p_mode, 'added', v_added, 'skipped', v_skipped));

  /* ★ `bump_revision` הוא פונקציית טריגר ואי אפשר לקרוא לה
     ישירות — היא נורית ממילא מהטריגר על `user_lineups`. עדכון
     מפורש כאן היה מפיל את כל הפונקציה ב-
     "trigger functions can only be called as triggers". */
  UPDATE game.data_revision
     SET revision = revision + 1, scope = 'bots', updated_at = now()
   WHERE id = 1;

  RETURN jsonb_build_object(
    'added', v_added, 'skipped', v_skipped, 'problems', v_problems);
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_add_bots(TEXT, TEXT, INT) TO authenticated;

/** הסרת כל הבוטים ממחזור. שגיאה בהוספה לא צריכה להיות בלתי הפיכה. */
CREATE OR REPLACE FUNCTION game.admin_remove_bots(p_gw_code TEXT, p_mode TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v_gw game.gameweeks; v_n INT;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw.id IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND'; END IF;

  WITH gone AS (
    DELETE FROM game.user_lineups ul
     USING game.users u
     WHERE u.id = ul.user_id AND u.is_bot
       AND ul.gameweek_id = v_gw.id
       AND (p_mode IS NULL OR ul.mode = p_mode)
    RETURNING 1
  ) SELECT count(*) INTO v_n FROM gone;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (COALESCE(auth.uid()::TEXT, 'admin'), 'admin_remove_bots', 'gameweek', p_gw_code,
          jsonb_build_object('mode', p_mode, 'removed', v_n));

  UPDATE game.data_revision
     SET revision = revision + 1, scope = 'bots', updated_at = now()
   WHERE id = 1;
  RETURN jsonb_build_object('removed', v_n);
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_remove_bots(TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- §5 · יומן פעילות
-- ---------------------------------------------------------------------
--
--  ★ למה טבלה נפרדת מ-`audit_logs`
--
--  `audit_logs` הוא יומן **אדמין**: מי שינה חוק, מי פרסם מחזור.
--  הוא נועד לאחריות, הוא נדיר, והוא נשמר לנצח.
--
--  יומן הפעילות הוא משהו אחר לגמרי: הוא **תנועה** של משתמשים,
--  הוא תכוף, והוא בעיקר מעניין בשבועיים האחרונים. לערבב ביניהם
--  אומר שאלף הגשות קוברות את השורה האחת שבה מישהו שינה את
--  מכפיל הקפטן — כלומר להרוס את יומן האחריות בדיוק כשצריך אותו.
--
--  ★ מה שנשמר, ומה שלא
--
--  נשמר: מי, מה, מתי, ובאיזה מצב. **לא** נשמר: אילו שחקנים
--  נבחרו. יומן שמכיל הרכבים הוא דלת אחורית לצפייה בהרכבים לפני
--  הנעילה, וזה בדיוק מה ש-§3 סגר.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS game.activity_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID REFERENCES game.users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  mode       TEXT,
  gw_code    TEXT,
  detail     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_log_recent_idx
  ON game.activity_log (created_at DESC);
CREATE INDEX IF NOT EXISTS activity_log_gw_idx
  ON game.activity_log (gw_code, created_at DESC);

/**
 * רישום פעולה.
 *
 * ★ `SECURITY DEFINER` ובלי GRANT ל-anon: רק פונקציות אחרות
 *   בסכימה קוראות לזה. לו הקליינט היה יכול לכתוב ליומן, היומן
 *   היה מקור מידע שאי אפשר לסמוך עליו — וזה גרוע מאין יומן.
 */
CREATE OR REPLACE FUNCTION game.log_activity(
  p_user UUID, p_action TEXT, p_mode TEXT, p_gw TEXT, p_detail TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER
SET search_path = game, public
AS $$
  INSERT INTO game.activity_log (user_id, action, mode, gw_code, detail)
  VALUES (p_user, p_action, p_mode, p_gw, NULLIF(btrim(p_detail), ''));
$$;

-- ---------------------------------------------------------------------
--  ★ ההגשה והביטול רושמים ליומן.
--
--  הרישום נעשה **בתוך** הפונקציות הקיימות ולא בטריגר, בכוונה:
--  טריגר על `user_lineups` היה נורה גם על שמירת טיוטה, ואז
--  היומן היה מתמלא ב"שחר עדכן טיוטה" שלוש פעמים בדקה. מה
--  שמעניין הוא ה**אירוע**, לא השינוי בשורה.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
--  ★★ איך מוסיפים פרמטר לפונקציה שקליינטים כבר קוראים לה ★★
--
--  הפיתוי הוא להוסיף ארגומנט עם DEFAULT. זו טעות: PostgreSQL
--  היה מקבל **שתי** פונקציות בשם `submit_entry` — זו בת חמשת
--  הארגומנטים מ-db/09 וזו בת השישה — וכל קריאה עם חמישה
--  ארגומנטים הייתה נכשלת ב-`function is not unique`. כלומר כל
--  הגשה במוצר, בבת אחת.
--
--  לכן: המימוש המקורי **משנה שם** ל-`submit_entry_core`, והשם
--  `submit_entry` מקבל עטיפה. הלוגיקה נשארת במקום אחד — שכפול
--  שלה כאן היה יוצר שני מסלולי הגשה שיום אחד יתפצלו, וזה בדיוק
--  סוג הבאג שאי אפשר לאתר.
--
--  ★ ואידמפוטנטי: `DROP … IF EXISTS` לפני השינוי, כדי שהרצה
--    שנייה של RUN-ALL (שבה db/09 יוצר מחדש את בן החמישה) תעבוד.
-- ---------------------------------------------------------------------

DO $rename$
BEGIN
  /* ★ `pronargs` ולא `pg_get_function_identity_arguments`.
     הפונקציה השנייה מחזירה את שמות הפרמטרים יחד עם הטיפוסים
     ("p_gw_code text, ..."), ולכן ההשוואה לרשימת טיפוסים בלבד
     לעולם לא התאימה — השם `submit_entry_core` מעולם לא נוצר,
     והעטיפה קראה לפונקציה שאינה קיימת. הבדיקה תפסה את זה כ-
     `function is not unique`, כלומר שתי גרסאות חיו זו לצד זו. */
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'game' AND p.proname = 'submit_entry' AND p.pronargs = 5
  ) THEN
    DROP FUNCTION IF EXISTS game.submit_entry_core(TEXT, TEXT, TEXT, JSONB, TEXT);
    ALTER FUNCTION game.submit_entry(TEXT, TEXT, TEXT, JSONB, TEXT)
      RENAME TO submit_entry_core;
  END IF;
END
$rename$;

DO $rename2$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'game' AND p.proname = 'withdraw_entry' AND p.pronargs = 2
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'game' AND p.proname = 'withdraw_entry_core'
  ) THEN
    ALTER FUNCTION game.withdraw_entry(TEXT, TEXT) RENAME TO withdraw_entry_core;
  END IF;
END
$rename2$;

CREATE OR REPLACE FUNCTION game.submit_entry(
  p_gw_code   TEXT,
  p_mode      TEXT,
  p_formation TEXT,
  p_slots     JSONB,
  p_display_name TEXT DEFAULT NULL,
  p_team_name    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE
  v_result JSONB;
  v_auth   UUID := auth.uid();
  v_team   TEXT := NULLIF(btrim(p_team_name), '');
BEGIN
  v_result := game.submit_entry_core(p_gw_code, p_mode, p_formation, p_slots, p_display_name);

  IF v_team IS NOT NULL THEN
    PERFORM game.set_entry_team_name(p_gw_code, p_mode, v_team);
  END IF;

  PERFORM game.log_activity(
    v_auth, 'submit', p_mode, p_gw_code,
    COALESCE(v_team, (SELECT display_name FROM game.users WHERE id = v_auth)));

  RETURN v_result || jsonb_build_object('teamName', v_team);
END;
$$;

/* ★ `BOOLEAN` ולא `VOID` — זה טיפוס ההחזרה של המקור.
   `CREATE OR REPLACE` אינו יכול לשנות טיפוס החזרה, וניסיון
   כזה מפיל את כל המיגרציה. הקריאה מחזירה את מה שהמקור החזיר. */
CREATE OR REPLACE FUNCTION game.withdraw_entry(p_gw_code TEXT, p_mode TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v_auth UUID := auth.uid(); v_ok BOOLEAN;
BEGIN
  v_ok := game.withdraw_entry_core(p_gw_code, p_mode);
  IF v_ok THEN
    PERFORM game.log_activity(v_auth, 'withdraw', p_mode, p_gw_code, NULL);
  END IF;
  RETURN v_ok;
END;
$$;

GRANT EXECUTE ON FUNCTION game.withdraw_entry(TEXT, TEXT) TO authenticated;

GRANT EXECUTE ON FUNCTION game.submit_entry(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT)
  TO authenticated;

/**
 * ★ יומן פעילות לאדמין.
 *
 * מחזיר משפטים מוכנים ("שחר שלח הרכב · דוביד 5"), ולא שדות
 * גולמיים. הסיבה: הניסוח הוא החלטת מוצר, והוא צריך להיות זהה
 * בכל מקום שמציג את היומן — כולל התראה, ייצוא ודוח.
 */
CREATE OR REPLACE FUNCTION game.admin_activity(
  p_limit INT DEFAULT 60, p_gw_code TEXT DEFAULT NULL
)
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
        'id',     l.id,
        'action', l.action,
        'mode',   l.mode,
        'gw',     l.gw_code,
        'who',    COALESCE(NULLIF(btrim(u.display_name), ''), 'אורח'),
        'isBot',  COALESCE(u.is_bot, FALSE),
        'detail', l.detail,
        'at',     to_char(l.created_at AT TIME ZONE 'UTC',
                          'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'text',   CASE l.action
                    WHEN 'submit'     THEN COALESCE(NULLIF(btrim(u.display_name),''),'אורח')
                                           || ' שלח הרכב'
                    WHEN 'bot_submit' THEN COALESCE(NULLIF(btrim(u.display_name),''),'בוט')
                                           || ' (בוט) שלח הרכב'
                    WHEN 'withdraw'   THEN COALESCE(NULLIF(btrim(u.display_name),''),'אורח')
                                           || ' ביטל הרכב'
                    WHEN 'signup'     THEN COALESCE(NULLIF(btrim(u.display_name),''),'אורח')
                                           || ' נרשם'
                    ELSE COALESCE(NULLIF(btrim(u.display_name),''),'אורח') || ' · ' || l.action
                  END
                  || CASE WHEN l.mode = 'five' THEN ' · דוביד 5'
                          WHEN l.mode = 'full' THEN ' · דוביד 11'
                          ELSE '' END
      ) AS a
      FROM game.activity_log l
      LEFT JOIN game.users u ON u.id = l.user_id
      WHERE p_gw_code IS NULL OR l.gw_code = p_gw_code
      ORDER BY l.created_at DESC
      LIMIT GREATEST(1, LEAST(p_limit, 300))
    ) q), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_activity(INT, TEXT) TO authenticated;

/**
 * ★ הסטטיסטיקה שיוצאת מהיומן.
 *
 * לא "כמה שורות יש" — אלא שלוש שאלות שמנהל מוצר באמת שואל:
 *
 *   כמה הגישו היום · באיזו שעה מגישים · כמה מהם בוטים
 *
 * הפילוח לפי שעה הוא זה שקובע מתי לשלוח תזכורת, וזה המספר
 * היחיד כאן שמשנה החלטה.
 */
CREATE OR REPLACE FUNCTION game.admin_activity_stats(p_gw_code TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v JSONB;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  SELECT jsonb_build_object(
    'total',    count(*) FILTER (WHERE l.action IN ('submit','bot_submit')),
    'humans',   count(*) FILTER (WHERE l.action = 'submit'),
    'bots',     count(*) FILTER (WHERE l.action = 'bot_submit'),
    'withdraw', count(*) FILTER (WHERE l.action = 'withdraw'),
    'today',    count(*) FILTER (WHERE l.action IN ('submit','bot_submit')
                                   AND l.created_at >= date_trunc('day', now())),
    'five',     count(*) FILTER (WHERE l.action IN ('submit','bot_submit') AND l.mode = 'five'),
    'full',     count(*) FILTER (WHERE l.action IN ('submit','bot_submit') AND l.mode = 'full'),
    'byHour',   COALESCE((
      SELECT jsonb_agg(jsonb_build_object('hour', h, 'n', n) ORDER BY h)
      FROM (
        SELECT extract(hour FROM l2.created_at AT TIME ZONE 'Asia/Jerusalem')::INT AS h,
               count(*) AS n
        FROM game.activity_log l2
        WHERE l2.action IN ('submit','bot_submit')
          AND (p_gw_code IS NULL OR l2.gw_code = p_gw_code)
        GROUP BY 1
      ) hh), '[]'::jsonb)
  ) INTO v
  FROM game.activity_log l
  WHERE p_gw_code IS NULL OR l.gw_code = p_gw_code;

  RETURN COALESCE(v, '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_activity_stats(TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- §6 · הרשאות קריאה
-- ---------------------------------------------------------------------
GRANT SELECT ON game.activity_log TO authenticated;

UPDATE game.data_revision SET revision = revision + 1, scope = 'migration-16' WHERE id = 1;
