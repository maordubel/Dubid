-- =====================================================================
--  OFFSIDES · מיגרציה 01 — הגשר לדוביד
--
--  ★ מה זה, ומה זה לא
--
--  זו המיגרציה **היחידה** שדוביד מבקש מאופסיידס. היא לא נוגעת
--  בשום טבלה קיימת חוץ מהוספת עמודות ל-`profiles`, והיא בטוחה
--  להרצה על מסד חי.
--
--  מה שהיא **לא** עושה, בכוונה:
--    · לא מייבאת טבלאות של דוביד
--    · לא משנה `auth.users`
--    · לא נוגעת בהימורים, בזירות, או ביתרות
--
--  ═══════════════════════════════════════════════════════════════
--  למה בכלל צריך משהו כאן
--  ═══════════════════════════════════════════════════════════════
--
--  לזהות — לא צריך. דוביד מאמת משתמש אופסיידס דרך
--  `GET /auth/v1/user` של הפרויקט הזה, וזה עובד בלי שום שינוי.
--  ⚠ מה שכן נדרש: **Email OTP מופעל** ב-Authentication → Providers.
--
--  לפרסים — כן. דוביד מעניק ("מגיע לו"), אופסיידס מחליט כמה זה
--  שווה ומזכה. שני מסדים נפרדים, ולכן דוביד **דוחף** לטבלה כאן
--  במקום שאופסיידס ימשוך משם. הכיוון הזה נבחר כי הוא משאיר את
--  אופסיידס עצמאי: הוא קורא רק מטבלה של עצמו, וגם אם דוביד
--  למטה — כלום לא נשבר.
--
--  אידמפוטנטי.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. שיוך: מי הגיע מדוביד
-- ---------------------------------------------------------------------
--  דוביד שולח משתמשים עם שיוך מלא בכתובת:
--    https://offsides.dubelteam.com/?ref=dubid&src=<מסך>&v=<רגע>&gw=<מחזור>
--
--  ★ אין בכתובת שום מזהה אישי. יש בדיקה בצד דוביד שמוודאת את זה
--    (`tests/growth.test.ts`). אל תוסיפו אחד.
--
--  מה שכדאי לעשות כאן: לשמור את שלושת הפרמטרים בכניסה ראשונה,
--  ולהתאים את מסך הנחיתה. משתמש שהגיע עם `v=beaten` בא עם הפסד
--  טרי — כדאי שהמסך הראשון יציע לו זירה שמתחילה בקרוב, ולא הסבר
--  על המשחק.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'profiles') THEN
    ALTER TABLE public.profiles
      ADD COLUMN IF NOT EXISTS campaign_ref    TEXT,
      ADD COLUMN IF NOT EXISTS campaign_src    TEXT,
      ADD COLUMN IF NOT EXISTS campaign_variant TEXT,
      ADD COLUMN IF NOT EXISTS campaign_at     TIMESTAMPTZ,
      -- מיפוי הפוך: מי מהמשתמשים כאן מקושר לדוביד. נכתב על ידי
      -- דוביד, ומשמש כאן רק לתצוגה ("החשבון שלך מחובר לדוביד").
      ADD COLUMN IF NOT EXISTS dubid_user_id   UUID;
    RAISE NOTICE 'profiles: עמודות שיוך נוספו';
  ELSE
    RAISE NOTICE 'אין public.profiles — דילוג על עמודות השיוך';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. פרסים נכנסים מדוביד
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dubid_rewards (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- המשתמש **כאן**. דוביד יודע את המזהה הזה כי הוא זה שקישר.
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL,          -- 'smoke_grenade', 'boost', …
  amount           INT  NOT NULL DEFAULT 1 CHECK (amount > 0),
  reason           TEXT,                   -- 'gameweek_win', 'arena_win', …
  -- ★ מפתח האידמפוטנטיות. retry של cron או לחיצה כפולה מחזירים
  --   את אותה הענקה בדיוק, לא שתיים. UNIQUE ברמת המסד ולא בקוד.
  idempotency_key  TEXT NOT NULL UNIQUE,
  granted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at       TIMESTAMPTZ,
  claimed_note     TEXT
);

CREATE INDEX IF NOT EXISTS dubid_rewards_pending
  ON public.dubid_rewards (user_id) WHERE claimed_at IS NULL;

COMMENT ON TABLE public.dubid_rewards IS
  'פרסים שדוביד העניק. נכתב על ידי דוביד עם service_role בלבד. '
  'אופסיידס קורא, מזכה בטבלאות שלו, ומסמן claimed. '
  'אין כאן יתרה — היתרה היא של אופסיידס, וההחלטה כמה שווה כל '
  'פרס היא שלו בלבד.';

ALTER TABLE public.dubid_rewards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dubid_rewards_own ON public.dubid_rewards;
CREATE POLICY dubid_rewards_own ON public.dubid_rewards
  FOR SELECT USING (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 3. שתי הפונקציות שאופסיידס קורא
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pending_dubid_rewards()
RETURNS SETOF public.dubid_rewards
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT * FROM public.dubid_rewards
   WHERE user_id = auth.uid() AND claimed_at IS NULL
   ORDER BY granted_at;
$$;
GRANT EXECUTE ON FUNCTION public.pending_dubid_rewards() TO authenticated;

/**
 * מימוש. נקרא **אחרי** שאופסיידס כבר זיכה את המשתמש בטבלאות שלו.
 *
 * ★ מחזיר FALSE אם כבר מומש. זה לא שגיאה — זה בדיוק מה שקורה
 *   כשמשתמש לוחץ פעמיים, והקוד הקורא צריך להתייחס לזה כאל
 *   "אין מה לעשות" ולא כאל תקלה.
 */
CREATE OR REPLACE FUNCTION public.claim_dubid_reward(p_id UUID, p_note TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_ok BOOLEAN;
BEGIN
  UPDATE public.dubid_rewards
     SET claimed_at = now(), claimed_note = p_note
   WHERE id = p_id AND user_id = auth.uid() AND claimed_at IS NULL
  RETURNING TRUE INTO v_ok;
  RETURN COALESCE(v_ok, FALSE);
END $$;
GRANT EXECUTE ON FUNCTION public.claim_dubid_reward(UUID, TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 4. ★★ אל תיגעו ב-public.server_now() ★★
-- ---------------------------------------------------------------------
--  שני המוצרים קוראים לה, ושניהם מצפים ל-BIGINT (epoch ms):
--
--      אופסיידס  src/lib/serverTime.js  →  Number(data)
--      דוביד     src/lib/serverTime.ts  →  Number(data)
--
--  אם מישהו יחליף את טיפוס ההחזרה ל-TIMESTAMPTZ, אז
--  `Number("2026-08-24 12:00:00+00")` הוא **NaN**. השעון יישאר
--  על היסט 0 בלי אף שגיאה, וכל ספירה לאחור — נעילת הימורים,
--  תפוגת boost, ריסט יומי — תזוז לפי שעון המכשיר של המשתמש.
--
--  הבלוק הזה רק **בודק**, ונכשל בהודעה מפורשת.
DO $check$
DECLARE v_type TEXT;
BEGIN
  SELECT pg_catalog.format_type(p.prorettype, NULL) INTO v_type
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'server_now';

  IF v_type IS NULL THEN
    CREATE OR REPLACE FUNCTION public.server_now()
    RETURNS BIGINT LANGUAGE sql STABLE AS 'SELECT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT';
    GRANT EXECUTE ON FUNCTION public.server_now() TO anon, authenticated;
    RAISE NOTICE 'server_now() נוצרה';
  ELSIF v_type <> 'bigint' THEN
    RAISE EXCEPTION
      'public.server_now() מחזירה % במקום bigint. שני המוצרים עושים Number() '
      'על התוצאה, וכל ערך שאינו epoch-ms הופך ל-NaN בשקט. ראו סעיף 4.', v_type;
  ELSE
    RAISE NOTICE 'server_now() תקינה (bigint)';
  END IF;
END
$check$;

-- ---------------------------------------------------------------------
-- 5. בדיקת בריאות
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.dubid_bridge_health AS
SELECT
  (SELECT count(*) FROM public.dubid_rewards)                            AS grants_total,
  (SELECT count(*) FROM public.dubid_rewards WHERE claimed_at IS NULL)   AS grants_pending,
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname='server_now'
             AND pg_catalog.format_type(p.prorettype,NULL)='bigint')     AS server_now_ok,
  EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_schema='public' AND table_name='profiles'
             AND column_name='campaign_ref')                             AS attribution_ready;
