-- =====================================================================
--  Dubid · מיגרציה 19 — כרטיס המנוי של האורח, ולכידת לידים
-- =====================================================================
--
--  ═══════════════════════════════════════════════════════════════
--  ★★★ הבעיה: זהות שאין לה מפתח ★★★
--  ═══════════════════════════════════════════════════════════════
--
--  אורח בדוביד הוא זהות מלאה — הוא בונה הרכב, מדורג, ומופיע
--  בטבלה. אבל הזהות הזו חיה **בדפדפן אחד**. מי שניקה היסטוריה,
--  החליף טלפון, או פתח בגלישה פרטית — איבד הכל, ובצדק חושב
--  שהמערכת מחקה לו את הקבוצה.
--
--  היה כבר פתרון: `access_codes` — קוד בן שש, חד־פעמי, שעה.
--  והוא **לא מתאים למה שהמשתמש באמת צריך**.
--
--  ★ למה שעה זה לא "קצת מדי" אלא הבעיה כולה
--
--  המשתמש ביקש לשמור תמונה עם הקוד ולשלוח אותה לעצמו בוואטסאפ.
--  זו לא בקשה קטנה — זו הגדרה של **מפתח**: משהו ששוכב בגלריה
--  ועובד כשצריך אותו, בעוד שבוע או בעוד חודשיים. קוד שפג אחרי
--  שעה בתמונה שמורה הוא לא מפתח; הוא צילום מסך של דלת נעולה.
--
--  ═══════════════════════════════════════════════════════════════
--  ★ שני סוגים באותה טבלה, ולא טבלה שנייה
--  ═══════════════════════════════════════════════════════════════
--
--    transfer  קוד בן 6, חד־פעמי, שעה.   "תעביר אותי עכשיו לטלפון"
--    pass      מפתח בן 10, חוזר, קבוע.   "זה הכרטיס שלי"
--
--  שניהם עוברים באותו נתיב פדיון, אותה טבלה, אותו hash. טבלה
--  שנייה הייתה מכפילה את לוגיקת הפדיון — ולוגיקת פדיון כפולה
--  היא הדרך הבטוחה לכך שתיקון אבטחה יגיע רק לאחת מהן.
--
--  ★★ ואיך מפתח קבוע נשאר בטוח ★★
--
--  קוד בן 6 מאלפבית של 32 = 30 ביט. זה מספיק כשהוא חי שעה, וזה
--  לא מספיק כשהוא חי לנצח.
--
--  לכן המפתח הוא בן **10** תווים = 50 ביט. עם המכסה שכבר קיימת
--  (`game.code_attempt_ok`, עשרה ניסיונות לרבע שעה לכל מנחש)
--  ניחוש של 50 ביט לוקח בערך פי מיליארד מגיל היקום. מה שהופך
--  אותו לבטוח זה לא האורך לבדו אלא **האורך כפול המכסה**.
--
--  אידמפוטנטי. אפשר להריץ שוב.
-- =====================================================================

SET search_path = game, core, public;

-- ---------------------------------------------------------------------
-- §1 · הרחבת הטבלה הקיימת
-- ---------------------------------------------------------------------

ALTER TABLE game.access_codes
  ADD COLUMN IF NOT EXISTS kind         TEXT NOT NULL DEFAULT 'transfer',
  ADD COLUMN IF NOT EXISTS uses         INT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_at   TIMESTAMPTZ;

-- ★ `expires_at` הופך לאופציונלי: מפתח קבוע אינו פג.
--   ה-CHECK מוודא שרק `pass` רשאי להיות בלי תפוגה — קוד העברה
--   בלי תפוגה הוא בדיוק הבאג שהעמודה הזו קיימת כדי למנוע.
DO $$
BEGIN
  ALTER TABLE game.access_codes ALTER COLUMN expires_at DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE game.access_codes DROP CONSTRAINT IF EXISTS access_codes_kind_ck;
  ALTER TABLE game.access_codes ADD CONSTRAINT access_codes_kind_ck
    CHECK (kind IN ('transfer', 'pass')
           AND (kind = 'pass' OR expires_at IS NOT NULL));
END $$;

-- ★★ מפתח פעיל אחד לכל משתמש ★★
--
--   בלי האילוץ הזה, כל לחיצה על "הראה לי את הכרטיס" הייתה
--   מייצרת מפתח נוסף — והמשתמש היה מחזיק בגלריה חמש תמונות עם
--   חמישה מפתחות שכולם עובדים. זה גם בלגן וגם משטח תקיפה
--   שגדל בכל ביקור.
CREATE UNIQUE INDEX IF NOT EXISTS access_codes_one_pass
  ON game.access_codes (user_id)
  WHERE kind = 'pass' AND revoked_at IS NULL;

COMMENT ON COLUMN game.access_codes.kind IS
  'transfer = קוד חד־פעמי לשעה. pass = מפתח הכניסה הקבוע.';

-- ---------------------------------------------------------------------
-- §2 · מי מחזיק מפתח, ומתי השתמש בו
-- ---------------------------------------------------------------------
--
--  ★ הפונקציה הזו לא מחזירה את המפתח, ולא יכולה.
--
--  במסד יושב רק ה-hash. זו לא מגבלה אלא ההחלטה: מי שמשיג גישה
--  לטבלה לא יכול להתחזות לאף אחד. המשתמש מקבל את המפתח פעם
--  אחת, ברגע ההנפקה, מפונקציית הקצה — ואם איבד אותו, מנפיקים
--  חדש. בדיוק כמו סיסמה.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.my_pass_state()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('has', FALSE); END IF;

  SELECT created_at, last_used_at, uses INTO v
  FROM game.access_codes
  WHERE user_id = auth.uid() AND kind = 'pass' AND revoked_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN RETURN jsonb_build_object('has', FALSE); END IF;

  RETURN jsonb_build_object(
    'has', TRUE,
    'createdAt', to_char(v.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'lastUsedAt', CASE WHEN v.last_used_at IS NULL THEN NULL ELSE
      to_char(v.last_used_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END,
    'uses', v.uses
  );
END;
$$;

GRANT EXECUTE ON FUNCTION game.my_pass_state() TO authenticated;

-- ---------------------------------------------------------------------
-- §3 · לכידת לידים
-- ---------------------------------------------------------------------
--
--  ═══════════════════════════════════════════════════════════════
--  ★★ מה מותר לתפוס, ומה זה עושה למוצר ★★
--  ═══════════════════════════════════════════════════════════════
--
--  הבקשה הייתה "מערכת לכידת לידים שהמשתמש לא ירגיש שהוא על
--  החכה". יש רק דרך אחת אחת לעשות את זה, והיא לא ניסוח חכם:
--  **שהוא באמת לא יהיה על החכה.**
--
--  לכן שלושה כללים שהטבלה הזו אוכפת:
--
--   1. **הסכמה מפורשת נשמרת כשדה.** לא "המשך = הסכמת". אם
--      `consent = FALSE`, השורה קיימת לצורך המשלוח שהמשתמש
--      ביקש ותו לא.
--
--   2. **המקור נשמר.** `source` אומר באיזה מסך זה נלכד. בלי זה
--      אי אפשר לדעת איזו נקודה מייצרת לידים שמתחרטים.
--
--   3. **מחיקה היא פעולה של המשתמש, לא בקשה לתמיכה.**
--      `game.forget_me()` מוחקת את הליד. חוק — וגם הדבר היחיד
--      שהופך "השארתי מייל" להחלטה הפיכה, ולכן קלה.
--
--  ★ מה **לא** נשמר כאן: שום דבר שהמשתמש לא הקליד בעצמו. אין
--    IP, אין user-agent, אין טביעת אצבע של דפדפן.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS game.leads (
  user_id     UUID PRIMARY KEY REFERENCES game.users(id) ON DELETE CASCADE,
  email       CITEXT,
  phone       TEXT,
  /** האם הסכים לקבל תזכורות. FALSE = רק מה שביקש עכשיו. */
  consent     BOOLEAN NOT NULL DEFAULT FALSE,
  /** באיזה מסך נלכד. 'pass' | 'nudge' | 'result' | 'account' */
  source      TEXT NOT NULL DEFAULT 'unknown',
  gw_code     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT leads_has_contact CHECK (email IS NOT NULL OR phone IS NOT NULL),
  CONSTRAINT leads_email_shape CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

ALTER TABLE game.leads ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS leads_created_idx ON game.leads (created_at DESC);

/**
 * שומר ליד.
 *
 * ★ `ON CONFLICT DO UPDATE` ולא שורה חדשה: המשתמש הוא המפתח.
 *   אדם שהקליד מייל פעמיים הוא ליד אחד ששינה דעתו, לא שניים.
 */
CREATE OR REPLACE FUNCTION game.capture_lead(
  p_email TEXT, p_consent BOOLEAN DEFAULT FALSE,
  p_source TEXT DEFAULT 'unknown', p_gw TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_email CITEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  v_email := NULLIF(btrim(lower(p_email)), '')::CITEXT;
  IF v_email IS NULL THEN RAISE EXCEPTION 'EMAIL_REQUIRED'; END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'EMAIL_INVALID'; END IF;

  -- ★ מכסה: זו פונקציה שכל משתמש מחובר יכול לקרוא לה, וקל
  --   להשיג `authenticated` (`signInAnonymously` הוא חינם).
  IF NOT game.rate_ok('lead', 5, INTERVAL '10 minutes') THEN
    RAISE EXCEPTION 'TOO_MANY_ATTEMPTS';
  END IF;

  INSERT INTO game.leads (user_id, email, consent, source, gw_code)
  VALUES (auth.uid(), v_email, COALESCE(p_consent, FALSE),
          COALESCE(NULLIF(left(p_source, 24), ''), 'unknown'), p_gw)
  ON CONFLICT (user_id) DO UPDATE SET
    email      = EXCLUDED.email,
    consent    = EXCLUDED.consent,
    source     = EXCLUDED.source,
    gw_code    = COALESCE(EXCLUDED.gw_code, game.leads.gw_code),
    updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION game.capture_lead(TEXT, BOOLEAN, TEXT, TEXT) TO authenticated;

/**
 * ★ "תשכחו אותי" — פעולה של המשתמש, לא פנייה לתמיכה.
 *
 * זה מה שהופך את השארת המייל להחלטה **הפיכה**. החלטה הפיכה
 * מתקבלת בקלות, והיא גם ההבדל בין מוצר שאוסף לבין מוצר שלוכד.
 */
CREATE OR REPLACE FUNCTION game.forget_me()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  DELETE FROM game.leads WHERE user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION game.forget_me() TO authenticated;

/** מה נשמר עליי. מוצג במסך החשבון, בלי שצריך לבקש. */
CREATE OR REPLACE FUNCTION game.my_lead()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
  SELECT COALESCE((
    SELECT jsonb_build_object('email', l.email, 'consent', l.consent)
    FROM game.leads l WHERE l.user_id = auth.uid()
  ), jsonb_build_object('email', NULL, 'consent', FALSE));
$$;

GRANT EXECUTE ON FUNCTION game.my_lead() TO authenticated;

-- ---------------------------------------------------------------------
-- §4 · הצד של האדמין
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.admin_leads(p_limit INT DEFAULT 200)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v JSONB;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'at' DESC), '[]'::jsonb) INTO v
  FROM (
    SELECT jsonb_build_object(
      'email',   l.email,
      'consent', l.consent,
      'source',  l.source,
      'gw',      l.gw_code,
      'name',    COALESCE(NULLIF(btrim(u.display_name), ''), 'אורח'),
      'isGuest', COALESCE(u.is_guest, TRUE),
      'entries', (SELECT count(*) FROM game.user_lineups ul
                   WHERE ul.user_id = l.user_id AND ul.status <> 'draft'),
      'at',      to_char(l.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ) AS x
    FROM game.leads l
    LEFT JOIN game.users u ON u.id = l.user_id
    ORDER BY l.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 1000))
  ) t;

  RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_leads(INT) TO authenticated;

/**
 * המשפך.
 *
 * ★ ארבעה מספרים, ולא לוח מחוונים.
 *
 * השאלה היחידה שמעניינת כאן היא "איפה אנשים נעצרים": כמה
 * נכנסו, כמה שיחקו, כמה שמרו מפתח, וכמה הפכו לקבועים. כל
 * מספר נוסף הוא מספר שמסיח מהשאלה הזו.
 */
CREATE OR REPLACE FUNCTION game.admin_funnel()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v JSONB;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  SELECT jsonb_build_object(
    'users',      (SELECT count(*) FROM game.users),
    'guests',     (SELECT count(*) FROM game.users WHERE COALESCE(is_guest, TRUE) AND NOT COALESCE(is_bot, FALSE)),
    'registered', (SELECT count(*) FROM game.users WHERE NOT COALESCE(is_guest, TRUE)),
    'played',     (SELECT count(DISTINCT user_id) FROM game.user_lineups WHERE status <> 'draft'),
    'withPass',   (SELECT count(*) FROM game.access_codes WHERE kind = 'pass' AND revoked_at IS NULL),
    'passUsed',   (SELECT count(*) FROM game.access_codes WHERE kind = 'pass' AND uses > 0),
    'leads',      (SELECT count(*) FROM game.leads),
    'leadsOptIn', (SELECT count(*) FROM game.leads WHERE consent)
  ) INTO v;

  RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_funnel() TO authenticated;

-- ---------------------------------------------------------------------
-- §5 · הקשחה — הטבלאות החדשות נולדות סגורות
-- ---------------------------------------------------------------------
--
--  ★ זו לא זהירות יתר, זה בדיוק מה שקרה קודם.
--
--  `db/07` הגדירה `ALTER DEFAULT PRIVILEGES ... GRANT ALL`, וכל
--  טבלה שנוצרה אחריה נולדה פתוחה לאנונימי. `db/18` ביטלה את
--  ברירת המחדל — והשורות כאן הן החגורה השנייה, למקרה שמישהו
--  יריץ את הקבצים בסדר אחר.
-- ---------------------------------------------------------------------

REVOKE ALL ON game.leads FROM anon, authenticated;
REVOKE ALL ON game.access_codes FROM anon, authenticated;

UPDATE game.data_revision
   SET revision = revision + 1, scope = 'migration-19', updated_at = now()
 WHERE id = 1;
