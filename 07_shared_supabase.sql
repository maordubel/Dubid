-- =====================================================================
--  Dubid · מיגרציה 07 — פרויקט Supabase משותף עם אופסיידס
--
--  ★ התשובה הקצרה: כן, זה עובד, וזה בדיוק מה ש-schemas נועדו לו.
--
--  פרויקט אחד. חשבון אחד למשתמש. הפרדה מלאה בין המוצרים.
--
--     auth.users        ← זהות משותפת. חשבון אחד, שתי אפליקציות.
--     public.*          ← אופסיידס  (arenas, bets, matches, profiles)
--     core.*            ← דאטת כדורגל משותפת (teams, players, events)
--     game.*            ← דוביד     (lineups, scores, leagues)
--     shared.*          ← הגשר: פרסים חוצי־אפליקציות בלבד
--
--  ההפרדה נאכפת בארבע שכבות בלתי תלויות:
--    1. Schemas   — `game.leagues` ו-`public.arenas` לא יכולים להתנגש
--    2. Exposed schemas — PostgREST חושף רק את מה שברשימה
--    3. db.schema — הקליינט של דוביד מכוון ל-`game` ולא רואה `public`
--    4. RLS       — גם אם שכבה 1-3 נכשלו, השורה עדיין מוגנת
--
--  אידמפוטנטי.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. הרשאות לסכימות של דוביד
-- ---------------------------------------------------------------------
-- בלי אלה PostgREST יחזיר 404 גם כשהסכימה חשופה בהגדרות.
DO $$
DECLARE s TEXT;
BEGIN
  FOREACH s IN ARRAY ARRAY['core','game'] LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO anon, authenticated, service_role', s);
    EXECUTE format('GRANT ALL ON ALL TABLES    IN SCHEMA %I TO anon, authenticated, service_role', s);
    EXECUTE format('GRANT ALL ON ALL ROUTINES  IN SCHEMA %I TO anon, authenticated, service_role', s);
    EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA %I TO anon, authenticated, service_role', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA %I
                    GRANT ALL ON TABLES TO anon, authenticated, service_role', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA %I
                    GRANT ALL ON ROUTINES TO anon, authenticated, service_role', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA %I
                    GRANT ALL ON SEQUENCES TO anon, authenticated, service_role', s);
  END LOOP;
END $$;

-- ⚠ שלב ידני שאי אפשר לעשות ב-SQL:
--    Dashboard → Settings → API → Exposed schemas
--    להוסיף:  core, game, shared      (ולהשאיר את public לאופסיידס)

-- ---------------------------------------------------------------------
-- 2. זהות משותפת
-- ---------------------------------------------------------------------
-- ★ `game.users` הופך לפרופיל של דוביד ולא ל"טבלת משתמשים".
--   המשתמש עצמו חי ב-`auth.users`, ולשני המוצרים יש פרופיל משלהם
--   שמצביע עליו. אותו אדם, שני פרופילים, אפס צימוד:
--
--     auth.users.id ──┬── public.profiles   (אופסיידס: יתרה, 💨, אווטאר)
--                     └── game.users        (דוביד: שם תצוגה, העדפות)
--
--   כך אופסיידס יכול לשנות את מבנה הפרופיל שלו בלי לגעת בדוביד.
ALTER TABLE game.users
  ADD COLUMN IF NOT EXISTS auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS users_auth_idx ON game.users (auth_id);

COMMENT ON COLUMN game.users.auth_id IS
  'הזהות המשותפת. NULL = משתמש אורח שעדיין לא נרשם.';

-- פרופיל דוביד נוצר אוטומטית בכניסה ראשונה, בלי מסך הרשמה.
CREATE OR REPLACE FUNCTION game.ensure_profile(p_display_name TEXT DEFAULT NULL)
RETURNS game.users
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE
  v_auth UUID := auth.uid();
  v_user game.users;
BEGIN
  IF v_auth IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  SELECT * INTO v_user FROM game.users WHERE auth_id = v_auth;
  IF v_user.id IS NOT NULL THEN RETURN v_user; END IF;

  INSERT INTO game.users (auth_id, display_name)
  VALUES (v_auth, COALESCE(NULLIF(btrim(p_display_name), ''), 'שחקן דוביד'))
  RETURNING * INTO v_user;

  RETURN v_user;
END;
$$;

GRANT EXECUTE ON FUNCTION game.ensure_profile(TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. הגשר: פרסים חוצי־אפליקציות
-- ---------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS shared;

-- ★ זו הטבלה **היחידה** ששני המוצרים נוגעים בה.
--   דוביד כותב "מגיע ל-X פרס על ניצחון במחזור 7". אופסיידס קורא
--   וממש. אף אחד מהם לא נוגע בטבלאות של השני.
CREATE TABLE IF NOT EXISTS shared.reward_grants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  source_app    TEXT NOT NULL CHECK (source_app IN ('dubid','offsides')),
  target_app    TEXT NOT NULL CHECK (target_app IN ('dubid','offsides')),

  kind          TEXT NOT NULL,          -- 'smoke_grenade' | 'boost' | ...
  amount        INT  NOT NULL CHECK (amount > 0),
  reason        TEXT NOT NULL,          -- 'gameweek_win' | 'league_win' | ...

  -- ★ הגנה מפני כפילות, ברמת המסד ולא ברמת "נזהר בקוד".
  --   מפתח טבעי: מי · על מה · באיזה אירוע. ניסיון שני נדחה.
  idempotency_key TEXT NOT NULL UNIQUE,

  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','claimed','void')),
  claimed_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reward_grants_pending_idx
  ON shared.reward_grants (auth_id, target_app) WHERE status = 'pending';

GRANT USAGE ON SCHEMA shared TO anon, authenticated, service_role;
GRANT SELECT ON shared.reward_grants TO authenticated;

ALTER TABLE shared.reward_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rewards_own_read ON shared.reward_grants;
CREATE POLICY rewards_own_read ON shared.reward_grants
  FOR SELECT USING (auth_id = auth.uid());

-- ★ אין policy לכתיבה. הענקה ומימוש עוברים דרך הפונקציות למטה
--   בלבד — אחרת כל לקוח יכול להעניק לעצמו פרסים.

CREATE OR REPLACE FUNCTION shared.grant_reward(
  p_auth_id UUID, p_source TEXT, p_target TEXT,
  p_kind TEXT, p_amount INT, p_reason TEXT, p_key TEXT
)
RETURNS shared.reward_grants
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = shared, public
AS $$
DECLARE v_row shared.reward_grants;
BEGIN
  INSERT INTO shared.reward_grants
    (auth_id, source_app, target_app, kind, amount, reason, idempotency_key)
  VALUES (p_auth_id, p_source, p_target, p_kind, p_amount, p_reason, p_key)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING * INTO v_row;

  -- הענקה חוזרת מחזירה את הקיימת ולא נכשלת: מי שקורא פעמיים
  -- (retry של cron, לחיצה כפולה) מקבל את אותה תוצאה בדיוק.
  IF v_row.id IS NULL THEN
    SELECT * INTO v_row FROM shared.reward_grants WHERE idempotency_key = p_key;
  END IF;

  RETURN v_row;
END;
$$;

-- מימוש — נקרא מהאפליקציה **המקבלת**, אחרי שזיכתה את המשתמש.
CREATE OR REPLACE FUNCTION shared.claim_reward(p_id UUID)
RETURNS shared.reward_grants
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = shared, public
AS $$
DECLARE v_row shared.reward_grants;
BEGIN
  SELECT * INTO v_row FROM shared.reward_grants WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL           THEN RAISE EXCEPTION 'REWARD_NOT_FOUND'; END IF;
  IF v_row.auth_id <> auth.uid() THEN RAISE EXCEPTION 'NOT_YOURS'; END IF;
  IF v_row.status <> 'pending'   THEN RAISE EXCEPTION 'ALREADY_CLAIMED'; END IF;

  UPDATE shared.reward_grants
     SET status = 'claimed', claimed_at = now()
   WHERE id = p_id
   RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION shared.claim_reward(UUID) TO authenticated;
-- ★ `grant_reward` מכוון: **לא** ניתן ל-authenticated.
--   רק service_role (Edge Function) מעניק פרסים.

NOTIFY pgrst, 'reload schema';
