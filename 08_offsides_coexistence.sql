-- =====================================================================
--  Dubid · מיגרציה 08 — דו־קיום עם אופסיידס בפרויקט אחד
--
--  ═══════════════════════════════════════════════════════════════════
--   קראו את זה לפני שמריצים
--  ═══════════════════════════════════════════════════════════════════
--
--  השאלה שנשאלה: "איזה SQL צריך להריץ בשם אופסיידס כדי שהכל יעבוד,
--  בהנחה שזה סופרבייס נקי שיש בו רק את ה-SQL של דוביד."
--
--  ★ התשובה הכנה, בשתי שורות:
--
--    הקובץ הזה **לא יוצר את אופסיידס**. אי אפשר — הסכמה של
--    אופסיידס (profiles, matches, arenas, bets, flash_questions,
--    question_bank, ועשרות פונקציות וטריגרים) לא קיימת בשום קובץ
--    שיש לי. המיגרציות שיושבות בריפו של אופסיידס תחת
--    `supabase/migrations/` הן **של פרויקט אחר לגמרי** — הן יוצרות
--    `cities`, `venues`, `bookings`, `experiences`. אם יריצו אותן
--    על הפרויקט החדש, ייווצרו שם טבלאות זרות.
--
--    לכן: את הסכמה של אופסיידס חייבים להביא מהפרויקט **החי** שלו,
--    ב-pg_dump. הפקודות המדויקות בסוף הקובץ הזה.
--
--  ═══════════════════════════════════════════════════════════════════
--   מה כן עושה הקובץ הזה
--  ═══════════════════════════════════════════════════════════════════
--
--    1. בודק שהצד של דוביד באמת שלם (01–07), ונכשל בהודעה ברורה
--       אם לא — במקום להיכשל מאוחר יותר בשגיאה שלא אומרת כלום.
--    2. **מגלה התנגשויות שמות** בין דוביד לאופסיידס לפני שהן
--       הופכות לנזק. זה הסעיף החשוב בקובץ.
--    3. מקבע את `public.server_now()` בחוזה שאופסיידס כבר מצפה לו.
--    4. פותח את צד־אופסיידס של גשר הפרסים.
--    5. משאיר תצוגת בריאות אחת, `shared.integration_health`,
--       שאומרת במבט אחד אם ההרכבה תקינה.
--
--  אידמפוטנטי. אפשר להריץ שוב אחרי שחזור הדאמפ של אופסיידס —
--  ואפילו רצוי: אז בדיקת ההתנגשויות באמת יש לה מה לבדוק.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. בדיקת מוקדמות
-- ---------------------------------------------------------------------
DO $$
DECLARE missing TEXT := '';
BEGIN
  IF to_regnamespace('core')  IS NULL THEN missing := missing || ' core';  END IF;
  IF to_regnamespace('game')  IS NULL THEN missing := missing || ' game';  END IF;
  IF to_regnamespace('shared') IS NULL THEN missing := missing || ' shared'; END IF;

  IF missing <> '' THEN
    RAISE EXCEPTION
      'חסרות סכימות:%. להריץ קודם את db/01 עד db/07 לפי הסדר.', missing;
  END IF;

  IF to_regprocedure('game.submit_lineup(uuid,text,jsonb)') IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'game' AND p.proname = 'submit_lineup')
  THEN
    RAISE EXCEPTION 'game.submit_lineup חסרה — db/05 לא רצה.';
  END IF;

  RAISE NOTICE 'צד דוביד שלם. ממשיכים.';
END $$;


-- ---------------------------------------------------------------------
-- 2. ★ גלאי ההתנגשויות
-- ---------------------------------------------------------------------
--
--  אופסיידס חי ב-`public`. דוביד חי ב-`core`/`game`/`shared`.
--  ההפרדה הזו היא כל הביטחון, ולכן שווה **להוכיח** אותה ולא להניח.
--
--  הסיכון האמיתי היחיד הוא `public`: דוביד יצר שם אובייקט אחד
--  בלבד (`server_now`), ושם — כפי שמתברר בסעיף 3 — שני המוצרים
--  כבר משתמשים באותה פונקציה בכוונה. מה שמסוכן הוא **עומס יתר**:
--  שחזור הדאמפ של אופסיידס עלול להוסיף גרסה שנייה עם חתימה
--  אחרת, ואז אחד משני המוצרים יתחיל לקבל זמן בטיפוס שהוא לא
--  מצפה לו — בשקט, בלי שגיאה.
--
--  התצוגה נשארת בפרויקט. כדאי להריץ עליה SELECT אחרי כל שחזור.
CREATE OR REPLACE VIEW shared.name_collisions AS
WITH dubid_public AS (
  -- כל מה שדוביד יצר ב-public. נכון להיום: server_now בלבד.
  SELECT 'server_now'::TEXT AS obj_name, 'function'::TEXT AS obj_kind
)
SELECT d.obj_name,
       d.obj_kind,
       EXISTS (
         SELECT 1 FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = d.obj_name
       ) AS exists_in_public,
       (SELECT count(*) FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = d.obj_name) AS overload_count
  FROM dubid_public d;

COMMENT ON VIEW shared.name_collisions IS
  'התנגשויות שמות אפשריות בין דוביד לאופסיידס ב-public. overload_count > 1 = לבדוק ידנית.';


-- ---------------------------------------------------------------------
-- 3. `public.server_now()` — החוזה המשותף
-- ---------------------------------------------------------------------
--
--  ★ הממצא, ולמה הוא חשוב
--
--  שני המוצרים קוראים לאותה פונקציה:
--
--     דוביד     — src/lib/serverTime.ts
--     אופסיידס  — src/lib/serverTime.js:  supabase.rpc("server_now")
--
--  ובדקתי מה כל אחד מהם עושה עם התשובה. אופסיידס מריץ
--  `Number(data)` ומתייחס לתוצאה כ-epoch במילישניות. דוביד יצר
--  את הפונקציה ב-db/05 כ-`RETURNS BIGINT` של epoch במילישניות.
--
--  **הם כבר מסכימים.** אין כאן מה לתקן, ואסור לגעת.
--
--  ★ הטעות שכמעט עשיתי כאן, ולמה היא שווה תיעוד
--
--  הגרסה הראשונה של הקובץ הזה "קיבעה" את הפונקציה כ-TIMESTAMPTZ,
--  מתוך הנחה שזה הטבעי יותר. הרצה על מסד אמיתי עצרה אותה:
--
--     ERROR: cannot change return type of existing function
--
--  ואילו הייתי מוסיף DROP לפני — היא הייתה עוברת בשקט, ואופסיידס
--  היה מקבל `Number("2026-08-24 12:00:00+00")` = NaN. השעון שלו
--  היה נשאר על היסט 0, בלי שום שגיאה, וכל ספירה לאחור הייתה
--  זזה לפי שעון המכשיר.
--
--  לכן כאן אין `CREATE OR REPLACE`. יש **בדיקה** בלבד.
DO $$
DECLARE v_ret TEXT; v_count INT;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'server_now';

  IF v_count = 0 THEN
    RAISE EXCEPTION 'public.server_now חסרה — db/05 לא רצה. שני המוצרים תלויים בה.';
  END IF;

  IF v_count > 1 THEN
    RAISE EXCEPTION
      'יש % גרסאות של public.server_now. שני המוצרים קוראים לה בלי פרמטרים — '
      'עומס יתר כאן הוא באג שקט. למחוק את המיותרות.', v_count;
  END IF;

  SELECT pg_catalog.format_type(p.prorettype, NULL) INTO v_ret
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'server_now';

  IF v_ret <> 'bigint' THEN
    RAISE EXCEPTION
      'public.server_now מחזירה % במקום bigint. אופסיידס מריץ Number() על '
      'התוצאה — כל טיפוס אחר נותן NaN, והשעון שלו נשאר על שעון המכשיר '
      'בלי שום שגיאה גלויה.', v_ret;
  END IF;

  RAISE NOTICE 'server_now: bigint (epoch ms) — שני המוצרים מסכימים.';
END $$;

-- service_role לא היה ברשימה ב-db/05. ה-Edge Function צריך אותה.
GRANT EXECUTE ON FUNCTION public.server_now() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.server_now() IS
  'שעון השרת, epoch במילישניות. משותף לדוביד ולאופסיידס — לא לשנות טיפוס החזרה.';


-- ---------------------------------------------------------------------
-- 4. גשר הפרסים — הצד של אופסיידס
-- ---------------------------------------------------------------------
--
--  db/07 בנה את `shared.reward_grants` ואת `grant_reward`/`claim_reward`.
--  מה שחסר הוא הקצה שאופסיידס קורא לו: "מה מחכה לי".
--
--  ★ למה פונקציה ולא SELECT ישיר
--    הקליינט של אופסיידס מכוון ל-`public`. פונקציה ב-`public`
--    שמחזירה מ-`shared` חוסכת ממנו לדעת שהסכימה קיימת בכלל.
--    הגבול נשמר: אופסיידס לא רואה אף טבלה של דוביד.
CREATE OR REPLACE FUNCTION public.pending_rewards()
RETURNS TABLE (
  id UUID, kind TEXT, amount INT, reason TEXT,
  source_app TEXT, created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = shared, public
AS $$
  SELECT g.id, g.kind, g.amount, g.reason, g.source_app, g.created_at
    FROM shared.reward_grants g
   WHERE g.auth_id = auth.uid()
     AND g.status  = 'pending'
   ORDER BY g.created_at;
$$;

GRANT EXECUTE ON FUNCTION public.pending_rewards() TO authenticated;

COMMENT ON FUNCTION public.pending_rewards() IS
  'לאופסיידס: הפרסים שדוביד העניק ועדיין לא מומשו. המימוש עצמו — shared.claim_reward(id).';

-- ★ שים לב מה **אין** כאן:
--   אין פונקציה שמזכה יתרת 💨. הזיכוי הוא של אופסיידס בלבד,
--   בטבלאות שלו, בקוד שלו. דוביד אומר "מגיע לו"; אופסיידס מחליט
--   כמה זה שווה ומתי. שני מוצרים, גבול אחד ברור.


-- ---------------------------------------------------------------------
-- 5. תצוגת בריאות
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW shared.integration_health AS
SELECT
  (to_regnamespace('core')   IS NOT NULL) AS core_schema,
  (to_regnamespace('game')   IS NOT NULL) AS game_schema,
  (to_regnamespace('shared') IS NOT NULL) AS shared_schema,
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'server_now') AS server_now_ok,
  EXISTS (SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'shared' AND table_name = 'reward_grants') AS reward_bridge_ok,
  -- הסימן שאופסיידס אכן שוחזר. כל עוד זה false — חצי מהפרויקט חסר.
  EXISTS (SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'arenas') AS offsides_restored,
  (SELECT count(*) FROM core.teams)   AS teams,
  (SELECT count(*) FROM core.players) AS players;

GRANT SELECT ON shared.integration_health TO service_role;

COMMENT ON VIEW shared.integration_health IS
  'בדיקה אחת: SELECT * FROM shared.integration_health;  כל עמודה false = משהו לא רץ.';

NOTIFY pgrst, 'reload schema';


-- =====================================================================
--  נספח — איך מביאים את אופסיידס לפרויקט הזה
-- =====================================================================
--
--  אי אפשר לכתוב את הסכמה של אופסיידס מהזיכרון. מביאים אותה
--  מהפרויקט החי:
--
--  1. דאמפ מהפרויקט הישן (סכימת public בלבד — auth נשארת בצד):
--
--       pg_dump "postgresql://postgres:<סיסמה>@db.<ישן>.supabase.co:5432/postgres" \
--         --schema=public --no-owner --no-privileges \
--         --exclude-schema='auth|storage|realtime|extensions|graphql*|supabase*' \
--         -f offsides_public.sql
--
--  2. ★ לפני השחזור — לבדוק התנגשות. הפקודה הזו מדפיסה כל שם
--     ב-public שדוביד כבר תפס:
--
--       grep -nE '^(CREATE (OR REPLACE )?FUNCTION|CREATE TABLE) public\.server_now' \
--         offsides_public.sql
--
--     אם יש תוצאה — לאופסיידס יש `server_now` משלו. להשוות חתימות
--     לפני שמריצים; אחרת השחזור ידרוס אותה בשקט.
--
--  3. שחזור לפרויקט החדש:
--
--       psql "postgresql://postgres:<סיסמה>@db.afxpjfxwpdjvlmuoawda.supabase.co:5432/postgres" \
--         -v ON_ERROR_STOP=1 -f offsides_public.sql
--
--  4. להריץ את הקובץ הזה **שוב**. עכשיו `shared.name_collisions`
--     ו-`shared.integration_health` באמת יש להם מה לבדוק:
--
--       SELECT * FROM shared.integration_health;
--       SELECT * FROM shared.name_collisions WHERE overload_count > 1;
--
--  5. Dashboard → Settings → API → Exposed schemas:
--       public, core, game, shared
--
--  ⚠ שני דברים שיישברו בשקט אם לא ישימו לב:
--
--    · `supabase/migrations/0001_schema.sql` ו-`0002_rls.sql` בריפו
--      של אופסיידס יוצרים `cities`/`venues`/`bookings`/`experiences`
--      — הם לא שייכים לאף אחד משני המוצרים. אם אינטגרציית ה-GIT
--      מריצה מיגרציות, למחוק או להעביר אותם לפני החיבור.
--
--    · טבלאות שלא ב-`public` לא מגיעות בדאמפ הזה. אם לאופסיידס יש
--      cron jobs (`cron.job`) או webhooks, הם צריכים הגדרה מחדש
--      ידנית בפרויקט החדש.
-- =====================================================================
