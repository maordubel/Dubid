-- =====================================================================
--  Dubid · מיגרציה 18 — הקשחה (PHASE 2)
-- =====================================================================
--
--  ═══════════════════════════════════════════════════════════════
--  ★★★ החור שהמיגרציה הזו סוגרת ★★★
--  ═══════════════════════════════════════════════════════════════
--
--  `db/07` מריצה, לכל אחת מהסכימות `core` ו-`game`:
--
--      GRANT ALL ON ALL TABLES ... TO anon, authenticated;
--      ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES
--                                   TO anon, authenticated;
--
--  `db/09` שוללת אחר כך `INSERT, UPDATE, DELETE` — אבל **רק על
--  הטבלאות שקיימות באותו רגע**. השורה השנייה, `ALTER DEFAULT
--  PRIVILEGES`, ממשיכה לחיות: כל טבלה שנוצרת אחר כך נולדת עם
--  `GRANT ALL` לאנונימי.
--
--  התוצאה בפועל, במסד שרץ היום:
--
--    · `game.scoring_overrides` — **כל אנונימי יכול לשכתב את
--      חוקי הניקוד של המשחק**, ישירות דרך PostgREST, בלי לעבור
--      דרך `admin_set_rule` ובלי לעבור את `is_admin()`.
--    · `game.mode_config`      — התקציב וגודל ההרכב, שמהם
--      `submit_entry` קורא. כלומר גם בדיקת התקציב בשרת שווה
--      בדיוק כמו הטבלה שהיא קוראת ממנה.
--    · `game.activity_log`     — יומן שאפשר למחוק ולזייף.
--    · `game.scoring_history`  — שובל הביקורת של שינויי הניקוד.
--
--  זה מבטל את כל שכבת ההגנה של 37 פונקציות `admin_*` שכל אחת
--  מהן בודקת `is_admin()` בשורה הראשונה. השער נעול והקיר פתוח.
--
--  ═══════════════════════════════════════════════════════════════
--  ★ העמדה החדשה: הכל עובר דרך פונקציות
--  ═══════════════════════════════════════════════════════════════
--
--  הקליינט לא קורא **אף טבלה** ישירות — אימתנו: אין ולו קריאת
--  `.from()` אחת בכל `src/`. הכל עובר דרך RPC-ים של
--  `SECURITY DEFINER`, שכל אחד מהם מחליט בעצמו מה לחשוף.
--
--  לכן העמדה הנכונה היא הפוכה מזו של `db/07`: **אפס גישה ישירה
--  לטבלאות**, והפונקציות הן הממשק היחיד. זה גם מה שהופך את
--  הבדיקה "האם X חשוף" לשאלה עם תשובה אחת במקום 40.
--
--  אידמפוטנטי. אפשר להריץ שוב.
-- =====================================================================

SET search_path = game, core, public;

-- ---------------------------------------------------------------------
-- §1 · ביטול ברירות המחדל שממשיכות להעניק הרשאות
-- ---------------------------------------------------------------------
--
--  ★ זה השלב שבלעדיו כל השאר זמני.
--
--  בלי ביטול `ALTER DEFAULT PRIVILEGES`, כל טבלה שתיווצר
--  במיגרציה 19 ואילך תיוולד שוב פתוחה — והתיקון הזה היה נכון
--  ליום אחד.
-- ---------------------------------------------------------------------

DO $$
DECLARE s TEXT;
BEGIN
  FOREACH s IN ARRAY ARRAY['core', 'game'] LOOP
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA %I
         REVOKE ALL ON TABLES FROM anon, authenticated', s);
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA %I
         REVOKE ALL ON SEQUENCES FROM anon, authenticated', s);

    -- ★ ROUTINES נשארות: זו בדיוק הדרך שבה הקליינט **כן** אמור
    --   לעבוד. פונקציה בלי GRANT EXECUTE אינה קיימת עבורו.
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- §2 · שלילת גישה ישירה לטבלאות — הפעם על מה שקיים באמת
-- ---------------------------------------------------------------------

DO $$
BEGIN
  -- כתיבה: לאף אחד, בשום טבלה, בשתי הסכימות.
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE
    ON ALL TABLES IN SCHEMA game FROM anon, authenticated;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE
    ON ALL TABLES IN SCHEMA core FROM anon, authenticated;

  -- ★ גם קריאה. ראו את ההסבר בראש הקובץ: אין `.from()` בקליינט,
  --   ולכן `SELECT` ישיר הוא לא "נוחות" אלא רק משטח תקיפה.
  --
  --   מה שכן נשאר קריא נקבע מיד אחר כך, במפורש, טבלה-טבלה.
  REVOKE SELECT ON ALL TABLES IN SCHEMA game FROM anon, authenticated;
  REVOKE SELECT ON ALL TABLES IN SCHEMA core FROM anon, authenticated;
END $$;

-- ---------------------------------------------------------------------
-- §3 · RLS על כל טבלה בשתי הסכימות
-- ---------------------------------------------------------------------
--
--  ★ חגורה **וגם** כתפיות, ובכוונה.
--
--  §2 כבר שלל את ההרשאות, ובלי הרשאה אין גישה גם בלי RLS. אז
--  למה בכל זאת RLS על הכל?
--
--  כי `GRANT` הוא פעולה חד־פעמית ו-RLS הוא מאפיין של הטבלה. אם
--  מישהו יריץ בעתיד `GRANT SELECT` בשביל דיבוג ויישכח — RLS
--  היא מה שיעמוד שם. הגנה בשכבה אחת היא הגנה שנשענת על כך
--  שאף אחד לא יטעה פעם אחת.
-- ---------------------------------------------------------------------

DO $$
DECLARE r RECORD; n INT := 0;
BEGIN
  FOR r IN
    SELECT c.relname, n2.nspname
    FROM pg_class c
    JOIN pg_namespace n2 ON n2.oid = c.relnamespace
    WHERE n2.nspname IN ('game', 'core')
      AND c.relkind = 'r'
      AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.nspname, r.relname);
    n := n + 1;
  END LOOP;
  IF n > 0 THEN RAISE NOTICE 'RLS הופעלה על % טבלאות', n; END IF;
END $$;

-- ---------------------------------------------------------------------
-- §4 · טבלת גרסאות מיגרציה
-- ---------------------------------------------------------------------
--
--  ★ מה זה פותר, ומה זה **לא** פותר.
--
--  פותר: "מה רץ על המסד הזה?" — שאלה שעד עכשיו לא הייתה לה
--  תשובה, והדרך היחידה לענות עליה הייתה לחפש טבלה ולנחש.
--
--  לא פותר: זו לא מערכת מיגרציות. הקבצים נשארים אידמפוטנטיים
--  ונשארים ניתנים להרצה חוזרת — וזו תכונה, לא חוב: מסד שנתקע
--  באמצע נפתר בהרצה נוספת ולא בשחזור מגיבוי.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS game.schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note       TEXT
);

ALTER TABLE game.schema_migrations ENABLE ROW LEVEL SECURITY;

INSERT INTO game.schema_migrations (version, note) VALUES
  ('01', 'ליבה'),                      ('02', 'קפטן וניקוד'),
  ('03', 'סגלים'),                     ('04', 'לוג ודירוג'),
  ('05', 'נעילה'),                     ('06', 'זירות'),
  ('07', 'הרשאות'),                    ('09', 'הגשות ותוצאות'),
  ('10', 'חשבונות'),                   ('11', 'זירות בשרת'),
  ('12', 'כניסת אדמין'),               ('13', 'דאטה חיה'),
  ('14', 'לוח ניהול'),                 ('15', 'שמות קבוצות'),
  ('16', 'בוטים ויומן'),               ('17', 'פרסום פנימי'),
  ('18', 'הקשחה')
ON CONFLICT (version) DO NOTHING;

CREATE OR REPLACE FUNCTION game.admin_schema_state()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v JSONB;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  SELECT jsonb_agg(jsonb_build_object(
           'version', version, 'note', note,
           'appliedAt', to_char(applied_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
         ORDER BY version)
    INTO v FROM game.schema_migrations;
  RETURN COALESCE(v, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_schema_state() TO authenticated;

-- ---------------------------------------------------------------------
-- §5 · הגבלת קצב לנקודות הקצה שאפשר למנות עליהן
-- ---------------------------------------------------------------------
--
--  ★★ מה באמת אפשר למנות כאן ★★
--
--  שתי פונקציות אנונימיות הן **אורקל**: הן עונות כן/לא על ניחוש,
--  ולכן אפשר להריץ עליהן רשימה.
--
--    · `league_by_code` — קוד זירה בן שש. מי שמונה אותו נכנס
--      לזירות פרטיות של אנשים אחרים.
--    · `username_available` — מגלה אילו שמות משתמש תפוסים,
--      כלומר מי רשום במערכת.
--
--  ★ למה טבלה ולא משתנה בזיכרון: PostgREST רץ בכמה תהליכים,
--    ומונה בזיכרון היה נספר בנפרד בכל אחד מהם.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS game.probe_attempts (
  bucket   TEXT NOT NULL,
  actor    TEXT NOT NULL,
  at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE game.probe_attempts ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS probe_attempts_idx ON game.probe_attempts (bucket, actor, at DESC);

/**
 * מחזירה TRUE אם מותר להמשיך, ורושמת את הניסיון.
 *
 * ★ הזהות היא `auth.uid()` כשיש, ואחרת "אנונימי כללי".
 *   `signInAnonymously` נותן uid חדש בחינם, ולכן uid לבדו אינו
 *   מפתח מספיק — הדלי הכללי הוא מה שתופס תוקף שממחזר סשנים.
 *   הוא רחב יותר בכוונה: הוא לא אמור להפריע לשימוש אמיתי.
 */
CREATE OR REPLACE FUNCTION game.rate_ok(
  p_bucket TEXT, p_limit INT, p_window INTERVAL
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_actor TEXT; v_n INT;
BEGIN
  v_actor := COALESCE(auth.uid()::TEXT, 'anon');

  DELETE FROM game.probe_attempts WHERE at < now() - INTERVAL '1 hour';

  SELECT count(*) INTO v_n
  FROM game.probe_attempts
  WHERE bucket = p_bucket AND actor = v_actor AND at > now() - p_window;

  INSERT INTO game.probe_attempts (bucket, actor) VALUES (p_bucket, v_actor);

  RETURN v_n < p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION game.rate_ok(TEXT, INT, INTERVAL) TO anon, authenticated;

/**
 * ★ שתי הפונקציות נכתבות מחדש כאן, ולא במקום שבו הן נולדו.
 *
 * שתיהן היו `LANGUAGE sql STABLE`, ופונקציה STABLE אינה יכולה
 * לקרוא ל-`rate_ok` — שכותבת. שינוי במקום המקורי היה מפזר את
 * ההקשחה על פני שלושה קבצים; כאן היא נקראת ברצף אחד.
 *
 * ★★ ההתנהגות תחת חסימה: תשובה "שלילית", לא שגיאה. ★★
 *
 * `league_by_code` מחזירה NULL — בדיוק כמו קוד שלא קיים.
 * `username_available` מחזירה FALSE — בדיוק כמו שם תפוס.
 *
 * זו לא עצלנות אלא ההחלטה הנכונה: הודעת "יותר מדי ניסיונות"
 * מאשרת לתוקף שהוא מתקרב למשהו ומאפשרת לו לכייל קצב. תשובה
 * שנראית כמו "לא מצאתי" לא מלמדת אותו כלום.
 *
 * המחיר: משתמש אמיתי שיקליד שישים קודים בדקה יקבל "לא נמצא"
 * על קוד תקין. זה תרחיש שלא קורה — ובכל מקרה עדיף על אורקל
 * פתוח.
 */
CREATE OR REPLACE FUNCTION game.league_by_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public AS $$
DECLARE v JSONB;
BEGIN
  -- 30 ניחושים בדקה. הצטרפות אמיתית היא קוד אחד או שניים.
  IF NOT game.rate_ok('league_code', 30, INTERVAL '1 minute') THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'name',       l.name,
    'mode',       l.mode,
    'kind',       l.kind,
    'status',     l.status,
    'members',    (SELECT count(*) FROM game.league_members WHERE league_id = l.id),
    'maxMembers', l.max_members
  ) INTO v
  FROM game.leagues l
  WHERE l.code = upper(btrim(p_code));

  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION game.league_by_code(TEXT) TO anon, authenticated;

/**
 * ★★ ניסיונות פדיון של קוד גישה ★★
 *
 * הבאג: ב-`access-code` הוגדר `MAX_ATTEMPTS = 8`, השדה `attempts`
 * נקרא — ו**מעולם לא הוגדל**. כלומר לא הייתה שום הגנה על פדיון.
 *
 * ★ ולמה מונה על השורה לא היה עוזר גם אילו כן היה מוגדל.
 *
 * קוד שגוי לא מתאים לאף שורה. אין מה להגדיל. תוקף שמנחש קודים
 * בני שש (≈30 ביט) לא נוגע באף שורה קיימת עד שהוא פוגע —
 * והמונה "לכל קוד" סופר בדיוק את מי שכבר הצליח.
 *
 * לכן המונה חייב להיות על **המנחש** ולא על הקוד, והזהות שלו
 * מגיעה מפונקציית הקצה (גיבוב של כתובת ה-IP). היא רצה
 * ב-service_role, ולכן היא זו שמעבירה את הזהות — אין דרך
 * לזייף אותה מהדפדפן.
 */
CREATE OR REPLACE FUNCTION game.code_attempt_ok(p_actor TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_n INT; v_actor TEXT;
BEGIN
  v_actor := left(COALESCE(NULLIF(btrim(p_actor), ''), 'unknown'), 64);

  DELETE FROM game.probe_attempts WHERE at < now() - INTERVAL '1 hour';

  SELECT count(*) INTO v_n
  FROM game.probe_attempts
  WHERE bucket = 'access_code' AND actor = v_actor AND at > now() - INTERVAL '15 minutes';

  INSERT INTO game.probe_attempts (bucket, actor) VALUES ('access_code', v_actor);

  -- ★ עשרה ברבע שעה. שחזור חשבון אמיתי הוא ניסיון אחד או שניים;
  --   מי שמנסה עשרה בהצלחה נמוכה כזו אינו מקליד מהזיכרון.
  RETURN v_n < 10;
END;
$$;

-- ★ רק service_role. הדפדפן לא יכול לקרוא לזה, ולכן גם לא יכול
--   לשרוף לעצמו את המכסה או לזייף זהות של מישהו אחר.
REVOKE ALL ON FUNCTION game.code_attempt_ok(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION game.code_attempt_ok(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION game.username_available(p_username TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public AS $$
BEGIN
  -- ★ הבדיקות הזולות **לפני** מונה הקצב.
  --   טופס הרשמה בודק זמינות בכל הקלדה. אילו כל תו היה נספר,
  --   משתמש אמיתי אחד היה נחסם תוך חצי דקה של הקלדה.
  IF btrim(COALESCE(p_username, '')) = '' THEN RETURN FALSE; END IF;
  IF length(btrim(p_username)) < 3 THEN RETURN FALSE; END IF;

  IF NOT game.rate_ok('username', 120, INTERVAL '1 minute') THEN
    RETURN FALSE;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1 FROM game.users WHERE username = btrim(p_username)::CITEXT
  );
END;
$$;
GRANT EXECUTE ON FUNCTION game.username_available(TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- §6 · שובל ביקורת לפעולות שחסרו בו
-- ---------------------------------------------------------------------
--
--  ★ הפעולה שהכי חשוב לתעד היא זו שהכי קל להכחיש.
--
--  `admin_upsert_player_stat` כותבת את הדקות, השערים והבישולים
--  שמהם נגזר **כל** הניקוד של כולם. היא הייתה הפעולה היחידה
--  במוצר שמשנה תוצאות ולא משאירה שורה בשום יומן. אם מישהו
--  יטען שהניקוד שלו שונה בדיעבד, עד עכשיו לא הייתה דרך לענות.
-- ---------------------------------------------------------------------

/**
 * ★★ הרישום נעשה בטריגר על הטבלה, ולא בתוך הפונקציות ★★
 *
 * הדרך המתבקשת הייתה להוסיף `INSERT INTO audit_logs` לתוך
 * `admin_upsert_player_stat`, `admin_set_rule`, `admin_clear_rule`,
 * `admin_delete_content` ו-`admin_resync_deadline` — חמישה
 * עריכות בשלושה קבצים.
 *
 * טריגר על הטבלה עדיף משלוש סיבות:
 *
 *   · הוא תופס **כל** נתיב כתיבה, כולל UPDATE ידני מה-SQL
 *     Editor — וזה בדיוק הנתיב שהכי חשוב לתעד.
 *   · הוא לא יכול להישכח בפונקציה הבאה שתיכתב.
 *   · הוא לא נוגע בקוד שכבר עובד ונבדק.
 */
CREATE OR REPLACE FUNCTION game.audit_row()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
BEGIN
  -- ★ כישלון ברישום לא מבטל את הפעולה. אדמין שלא יכול לפרסם
  --   תוצאות כי היומן נכשל הוא תקלה גרועה יותר משורה חסרה.
  BEGIN
    INSERT INTO game.audit_logs (actor, entity, entity_id, action, old_value, new_value)
    VALUES (
      COALESCE(auth.uid()::TEXT, 'system'),
      TG_TABLE_NAME,
      CASE
        WHEN TG_OP = 'DELETE' THEN COALESCE(to_jsonb(OLD)->>'id', to_jsonb(OLD)->>'key')
        ELSE COALESCE(to_jsonb(NEW)->>'id', to_jsonb(NEW)->>'key')
      END,
      lower(TG_OP),
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
      CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

/**
 * הטבלאות שכל שינוי בהן חייב להשאיר עקבות.
 *
 * ★ הרשימה קצרה בכוונה: הן הטבלאות שמשנות **תוצאה או חוק**.
 *   טריגר על כל טבלה היה מייצר יומן שאי אפשר לקרוא, וזה בדיוק
 *   כמו לא לתעד בכלל.
 */
DO $$
DECLARE t TEXT; sch TEXT; tbl TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'core.player_match_stats',   -- הדקות והשערים שמהם נגזר כל הניקוד
    'core.weekly_matches',       -- תוצאות המשחקים
    'game.scoring_overrides',    -- חוקי הניקוד החיים
    'game.gameweeks'             -- דדליינים וסטטוס
  ] LOOP
    sch := split_part(t, '.', 1);
    tbl := split_part(t, '.', 2);

    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = sch AND c.relname = tbl) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_%s ON %I.%I', tbl, sch, tbl);
      EXECUTE format(
        'CREATE TRIGGER audit_%s AFTER INSERT OR UPDATE OR DELETE ON %I.%I
           FOR EACH ROW EXECUTE FUNCTION game.audit_row()', tbl, sch, tbl);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- §7 · אימות
-- ---------------------------------------------------------------------
--
--  ★ הבדיקה רצה כאן, בסוף המיגרציה, ולא רק בחבילת הבדיקות.
--
--  מי שמריץ את הקובץ הזה ב-SQL Editor של פרודקשן לא מריץ אחר
--  כך `db/tests`. הוא צריך לראות במו עיניו שהחור נסגר — ולכן
--  ההודעה הזו היא חלק מהמיגרציה.
-- ---------------------------------------------------------------------

DO $$
DECLARE v_open INT; v_norls INT;
BEGIN
  SELECT count(*) INTO v_open
  FROM information_schema.role_table_grants
  WHERE table_schema IN ('game', 'core')
    AND grantee IN ('anon', 'authenticated')
    AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');

  SELECT count(*) INTO v_norls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('game', 'core') AND c.relkind = 'r' AND NOT c.relrowsecurity;

  IF v_open > 0 THEN
    RAISE EXCEPTION 'הקשחה נכשלה: עדיין % הרשאות כתיבה ישירות', v_open;
  END IF;
  IF v_norls > 0 THEN
    RAISE EXCEPTION 'הקשחה נכשלה: % טבלאות בלי RLS', v_norls;
  END IF;

  RAISE NOTICE '✓ הקשחה: אפס כתיבה ישירה, אפס טבלאות בלי RLS';
END $$;

UPDATE game.data_revision
   SET revision = revision + 1, scope = 'migration-18', updated_at = now()
 WHERE id = 1;
