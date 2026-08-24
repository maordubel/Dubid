-- =====================================================================
--  db/tests/00_supabase_shim.sql — Supabase מזויף, לבדיקות בלבד
--
--  ★ למה זה קיים
--
--  המיגרציות משתמשות ב-`auth.uid()`, ב-`auth.users`, ובתפקידים
--  `anon` / `authenticated` / `service_role`. אלה קיימים רק בענן.
--  בלי חיקוי מקומי, הדרך היחידה לגלות שגיאת תחביר או עמודה חסרה
--  היא להריץ על המסד החי — כלומר לגלות אותה על משתמשים.
--
--  הקובץ הזה נותן מסד ריק שמתנהג מספיק כמו Supabase כדי שכל
--  01→09 יעברו, ואפשר להריץ עליו את מסלול המשחק המלא.
--
--  ⚠ לעולם לא להריץ על production. הוא יוצר `auth.uid()` שאפשר
--    לזייף בקלות — זו בדיוק המטרה שלו, וזו בדיוק הסיבה שאסור.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT
);

/* המשתמש ה"מחובר" בבדיקה. נקבע ב-`SET dubid.test_uid`. */
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('dubid.test_uid', TRUE), '')::UUID;
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT
LANGUAGE sql STABLE AS $$ SELECT 'authenticated'::TEXT $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
