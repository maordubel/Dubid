-- =====================================================================
--  db/tests/04_admin_access.sql — כניסת אדמין בסיסמה אחת
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

DELETE FROM auth.users WHERE id::TEXT LIKE 'f0000000-%';
INSERT INTO auth.users (id, email, is_anonymous)
VALUES ('f0000000-0000-0000-0000-000000000001', 'admin@x.com', FALSE);
SET dubid.test_uid = 'f0000000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('מנהל');

-- 1 — סיסמה שגויה
DO $$
DECLARE r JSONB;
BEGIN
  r := game.claim_admin('לא-נכון');
  IF (r->>'ok')::BOOLEAN THEN RAISE EXCEPTION 'FAIL 1: סיסמה שגויה התקבלה'; END IF;
  IF (r->>'error') <> 'BAD_SECRET' THEN RAISE EXCEPTION 'FAIL 1b: %', r; END IF;
  IF game.is_admin() THEN RAISE EXCEPTION 'FAIL 1c: קיבל הרשאה בטעות'; END IF;
END $$;
\echo '  ✓ 1  סיסמה שגויה נדחית ולא מעניקה הרשאה'

-- 2 — הסיסמה הנכונה מעניקה הרשאה
DO $$
DECLARE r JSONB;
BEGIN
  r := game.claim_admin('hapoelTA14!');
  IF NOT (r->>'ok')::BOOLEAN THEN RAISE EXCEPTION 'FAIL 2: %', r; END IF;
  -- ★ זה הלב: אותה פעולה גם פתחה את המסך וגם נתנה הרשאה במסד.
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'FAIL 2b: לא קיבל is_admin'; END IF;
END $$;
\echo '  ✓ 2  הסיסמה הנכונה מעניקה is_admin — בלי SQL Editor'

-- 3 — ומיד אפשר לעבוד
DO $$
BEGIN
  PERFORM game.admin_squads();
  PERFORM game.admin_set_published('gw-2', FALSE);
END $$;
\echo '  ✓ 3  פונקציות האדמין עובדות מיד אחרי הכניסה'

-- 4 — יציאה מכבה את הדגל
DO $$
BEGIN
  PERFORM game.release_admin();
  IF game.is_admin() THEN RAISE EXCEPTION 'FAIL 4: הדגל נשאר דלוק אחרי יציאה'; END IF;
END $$;
\echo '  ✓ 4  יציאה מכבה את ההרשאה במסד, לא רק במסך'

-- 5 — הסוד לא נגיש לקריאה
DO $$
DECLARE v TEXT;
BEGIN
  SELECT secret_hash INTO v FROM game.admin_secrets WHERE id='primary';
  IF v IS NULL THEN RAISE EXCEPTION 'FAIL 5: אין סוד מוגדר'; END IF;
  -- ★ הבדיקה כאן רצה כ-superuser ולכן רואה. מה שחשוב הוא
  --   שאין GRANT ל-anon/authenticated — כלומר PostgREST לא חושף.
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema='game' AND table_name='admin_secrets'
       AND grantee IN ('anon','authenticated')
  ) THEN RAISE EXCEPTION 'FAIL 5b: טבלת הסודות חשופה ל-anon/authenticated'; END IF;
END $$;
\echo '  ✓ 5  טבלת הסודות אינה נגישה מהדפדפן'

-- 6 — נעילה אחרי חמישה ניסיונות
DELETE FROM auth.users WHERE id = 'f0000000-0000-0000-0000-000000000002';
INSERT INTO auth.users (id, email, is_anonymous)
VALUES ('f0000000-0000-0000-0000-000000000002', 'guess@x.com', FALSE);
SET dubid.test_uid = 'f0000000-0000-0000-0000-000000000002';
SELECT game.ensure_profile('מנחש');

DO $$
DECLARE r JSONB; i INT;
BEGIN
  FOR i IN 1..5 LOOP r := game.claim_admin('נחש-' || i); END LOOP;
  IF (r->>'error') <> 'LOCKED' THEN
    RAISE EXCEPTION 'FAIL 6: אחרי 5 ניסיונות לא ננעל — %', r;
  END IF;

  -- ★ ננעל גם מול הסיסמה **הנכונה**. אחרת הנעילה חסרת ערך:
  --   תוקף שמנחש היה פשוט ממשיך.
  r := game.claim_admin('hapoelTA14!');
  IF (r->>'ok')::BOOLEAN THEN RAISE EXCEPTION 'FAIL 6b: הנעילה נעקפה'; END IF;
END $$;
\echo '  ✓ 6  חמישה ניסיונות → נעילה, גם מול הסיסמה הנכונה'

\echo ''
\echo '════════════════════════════════════════════'
\echo '  PASS — כניסת אדמין'
\echo '════════════════════════════════════════════'
