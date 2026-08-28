-- =====================================================================
--  Dubid · מיגרציה 20 — כרטיס המנוי בלי Edge Functions
-- =====================================================================
--
--  ═══════════════════════════════════════════════════════════════
--  ★★★ למה זה נכתב מחדש ★★★
--  ═══════════════════════════════════════════════════════════════
--
--  הגרסה הקודמת עבדה דרך Edge Function, והיא דרשה התקנת CLI
--  ופקודת `supabase functions deploy`. זה תפעול שאי אפשר לעשות
--  מ-SQL Editor, ולכן בפועל הוא לא נעשה — והתכונה לא עבדה.
--
--  ★ תכונה שדורשת צעד תפעולי שלא מבוצע היא תכונה שלא קיימת.
--
--  אז השאלה הנכונה היא: **למה בכלל היה צריך שרת שם?**
--
--  ═══════════════════════════════════════════════════════════════
--  ★★ התובנה: אין צורך להעביר סשן. צריך להעביר דאטה. ★★
--  ═══════════════════════════════════════════════════════════════
--
--  הגישה הישנה: המכשיר החדש צריך להיכנס **בתור** המשתמש הישן.
--  לשם כך צריך להנפיק לו טוקן של מישהו אחר — וזה דורש מפתח
--  `service_role`, שאסור לו להיות בדפדפן. מכאן ה-Edge Function.
--
--  הגישה החדשה: לכל דפדפן **כבר יש** משתמש אנונימי משלו
--  (`signInAnonymously`). אז במקום להתחזות למשתמש הישן, המכשיר
--  החדש פשוט **לוקח אליו את הדאטה**: ההרכבים, שם הקבוצה,
--  הזירות, הכל.
--
--  התוצאה זהה לחלוטין מבחינת המשתמש — הוא רואה את הקבוצה שלו —
--  אבל אין העברת סשן, אין `service_role`, ואין שרת.
--  **הכל פונקציה אחת ב-SQL.**
--
--  ★ ומה זה מבטל: פריסת פונקציות, CORS, סודות של פונקציות
--    קצה, ולוגים נפרדים. כל המוצר רץ עכשיו מ-`RUN-ALL.sql`.
--
--  ═══════════════════════════════════════════════════════════════
--  ★ שלוש החלטות אבטחה שהמיגרציה הזו אוכפת
--  ═══════════════════════════════════════════════════════════════
--
--   1. **המפתח לא נשמר, רק ה-hash.** כמו סיסמה.
--   2. **`is_admin` לעולם לא עובר.** מפתח שנופל לידיים לא נכונות
--      נותן גישה לחשבון משחק — לא ללוח הניהול. ראו §3.
--   3. **מכסת ניחושים.** 50 ביט כפול עשרה ניסיונות לרבע שעה.
--
--  אידמפוטנטי. אפשר להריץ שוב.
-- =====================================================================

SET search_path = game, core, public;

-- ---------------------------------------------------------------------
-- §1 · סימון מיזוג
-- ---------------------------------------------------------------------
--
--  ★ המשתמש המקורי לא נמחק — הוא מסומן.
--
--  מחיקה הייתה מפילה שורות ביומן הפעילות ובביקורת, ובעיקר: היא
--  הייתה הופכת "מה קרה כאן" לשאלה בלי תשובה. שורה מסומנת עולה
--  כלום ומשאירה שובל.
-- ---------------------------------------------------------------------

ALTER TABLE game.users
  ADD COLUMN IF NOT EXISTS merged_into UUID REFERENCES game.users(id),
  ADD COLUMN IF NOT EXISTS merged_at   TIMESTAMPTZ;

COMMENT ON COLUMN game.users.merged_into IS
  'המשתמש שאליו הדאטה עברה בפדיון כרטיס. NULL = משתמש פעיל.';

CREATE INDEX IF NOT EXISTS users_merged_idx ON game.users (merged_into)
  WHERE merged_into IS NOT NULL;

-- ---------------------------------------------------------------------
-- §2 · הנפקת מפתח — ב-SQL, בלי שרת
-- ---------------------------------------------------------------------
--
--  ★ אלפבית בלי אותיות מתבלבלות: **אין 0, O, 1, I**.
--    משתמש שמקליד קוד שגוי כי הפונט דו־משמעי מנסה שוב, ושלושה
--    ניסיונות כאלה נראים בדיוק כמו ניחוש בכוח גס.
--
--  ★★ למה L כן נשאר, למרות שהוא דומה ל-1
--
--  כי 32 תווים מחלקים את 256 בדיוק (256 = 32 × 8), ולכן `% 32`
--  על בית אקראי אינו מטה את ההתפלגות. אלפבית בן 31 היה דורש
--  דחיית ערכים ולא רק מודולו — וזו בדיוק הטעות שהופכת מפתח בן
--  50 ביט למפתח בן 47, בשקט.
--
--  וזה בטוח: `1` **לא קיים** באלפבית. מי שיקרא L ויקליד 1 יקבל
--  "מפתח לא תקין" מיד, ולא יתחזה בטעות למישהו אחר. הסיכון
--  היחיד שנשאר הוא הקלדה חוזרת, לא התנגשות.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.gen_pass_code(p_len INT DEFAULT 10)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE
SET search_path = game, public
AS $$
DECLARE
  c_alphabet CONSTANT TEXT := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_bytes BYTEA;
  v_out   TEXT := '';
  i INT;
BEGIN
  v_bytes := gen_random_bytes(p_len);
  FOR i IN 0 .. p_len - 1 LOOP
    v_out := v_out || substr(c_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  END LOOP;
  RETURN v_out;
END;
$$;

/**
 * מנפיק מפתח חדש ומבטל את הקודם.
 *
 * ★★ המפתח מוחזר **פעם אחת** ולעולם לא שוב. ★★
 *
 * במסד יושב רק ה-hash שלו, וזו ההחלטה ולא מגבלה: מי שמשיג גישה
 * לטבלה לא יכול להתחזות לאיש. מי שאיבד את הכרטיס מנפיק חדש.
 */
CREATE OR REPLACE FUNCTION game.issue_pass()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_code TEXT; v_uid UUID; v_name TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  -- ★ מכסה גם על ההנפקה, לא רק על הפדיון.
  --   בלעדיה אפשר לייצר אלפי שורות בטבלה בלולאה אחת.
  IF NOT game.rate_ok('issue_pass', 10, INTERVAL '1 hour') THEN
    RAISE EXCEPTION 'TOO_MANY_ATTEMPTS';
  END IF;

  v_code := game.gen_pass_code(10);

  /* ★ ביטול הישן **לפני** הכנסת החדש.
     יש אינדקס ייחודי על "מפתח פעיל אחד למשתמש"; הסדר ההפוך
     היה נכשל על עצמו. */
  UPDATE game.access_codes SET revoked_at = now()
   WHERE user_id = v_uid AND kind = 'pass' AND revoked_at IS NULL;

  INSERT INTO game.access_codes (code_hash, user_id, kind, expires_at)
  VALUES (encode(digest(v_code, 'sha256'), 'hex'), v_uid, 'pass', NULL);

  SELECT display_name INTO v_name FROM game.users WHERE id = v_uid;

  RETURN jsonb_build_object(
    'code',        v_code,
    'pretty',      substr(v_code,1,4) || '-' || substr(v_code,5,4) || '-' || substr(v_code,9),
    'displayName', v_name,
    'issuedAt',    to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION game.issue_pass() TO authenticated;
GRANT EXECUTE ON FUNCTION game.gen_pass_code(INT) TO authenticated;

-- ---------------------------------------------------------------------
-- §3 · פדיון — העברת הדאטה
-- ---------------------------------------------------------------------
--
--  ═══════════════════════════════════════════════════════════════
--  ★★★ מה עובר, ומה בכוונה לא ★★★
--  ═══════════════════════════════════════════════════════════════
--
--  **עובר:** הרכבים, טיוטות, שמות קבוצה, חברות בזירות, בעלות על
--  זירות, שם המאמן, שם המשתמש, האווטאר, קוד ההפניה, וסטטוס
--  ההרשמה. כלומר: כל מה שהמשתמש היה קורא לו "החשבון שלי".
--
--  **לא עובר — `is_admin`.**
--
--  ★ זו השורה החשובה ביותר בקובץ.
--
--  מפתח כרטיס נשלח בוואטסאפ, נשמר בגלריה, ומצולם מהמסך. אם הוא
--  היה גורר איתו הרשאת ניהול, כל צילום מסך של אדמין היה מפתח
--  ללוח הניהול — כולל שינוי חוקי ניקוד ופרסום תוצאות.
--
--  הרשאת ניהול ניתנת רק דרך `claim_admin` עם הסוד, ורק שם.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.claim_pass(p_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE
  v_me     UUID;
  v_src    UUID;
  v_hash   TEXT;
  v_clean  TEXT;
  v_moved  INT := 0;
  v_name   TEXT;
BEGIN
  v_me := auth.uid();
  IF v_me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  /* ★ המקפים שהמשתמש רואה בכרטיס נשלפים כאן.
     הוא מקליד "AB34-CD67-KM" כי ככה זה כתוב אצלו. */
  v_clean := upper(regexp_replace(COALESCE(p_key, ''), '[^A-Za-z0-9]', '', 'g'));

  /*
   * ═══════════════════════════════════════════════════════════
   * ★★★ למה כישלון כאן **מוחזר** ולא נזרק ★★★
   * ═══════════════════════════════════════════════════════════
   *
   * הגרסה הראשונה עשתה `RAISE EXCEPTION 'INVALID_CODE'`, וזה
   * נראה נכון לגמרי — עד שמסתכלים על מונה הניסיונות.
   *
   * `RAISE` **מגלגל אחורה את הטרנזקציה**, וביחד איתה את השורה
   * ש-`rate_ok` בדיוק הכניסה ל-`probe_attempts`. כלומר: כל
   * ניחוש שגוי מחק את הרישום של עצמו.
   *
   * התוצאה: המכסה עבדה בדיוק על מי שהקליד **נכון**, ולא עבדה
   * בכלל על מי שמנחש — כלומר על המקרה היחיד שבשבילו היא קיימת.
   * מנחש אוטומטי היה מקבל אינסוף ניסיונות, וכל בדיקה שסופרת
   * "האם יש מכסה" הייתה עוברת.
   *
   * לכן: `AUTH_REQUIRED` עדיין נזרק (הוא לא נספר ממילא), וכל
   * השאר חוזר כערך. הקריאה מצליחה, השורה נשארת, והמונה סופר.
   */
  IF length(v_clean) NOT IN (6, 10) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'INVALID_CODE');
  END IF;

  /* ★ המכסה **לפני** החיפוש, לא אחריו. אחרת כל ניסיון שגוי
     הוא שאילתה, ומנחש אוטומטי מקבל קצב חינם. */
  IF NOT game.rate_ok('claim_pass', 10, INTERVAL '15 minutes') THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'TOO_MANY_ATTEMPTS');
  END IF;

  v_hash := encode(digest(v_clean, 'sha256'), 'hex');

  SELECT user_id INTO v_src
  FROM game.access_codes
  WHERE code_hash = v_hash
    AND revoked_at IS NULL
    AND (kind = 'pass' OR (kind = 'transfer' AND redeemed_at IS NULL AND expires_at > now()))
  LIMIT 1;

  IF v_src IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'INVALID_CODE');
  END IF;

  /* אותו משתמש — אין מה להעביר, וזו לא שגיאה. */
  IF v_src = v_me THEN
    RETURN jsonb_build_object('ok', TRUE, 'moved', 0, 'sameUser', TRUE);
  END IF;

  /* ★ מפתח של משתמש שכבר מוזג מוביל ליעד האמיתי.
     בלי זה, מי שסרק כרטיס ישן היה מגיע לחשבון ריק. */
  SELECT COALESCE(u.merged_into, v_src) INTO v_src
  FROM game.users u WHERE u.id = v_src;

  IF v_src = v_me THEN
    RETURN jsonb_build_object('ok', TRUE, 'moved', 0, 'sameUser', TRUE);
  END IF;

  /* ------------------------------------------------------------
     1. הרכבים — המקור מנצח בהתנגשות
     ------------------------------------------------------------
     ★ למה המקור ולא היעד.

     היעד הוא כמעט תמיד מכשיר חדש וריק. אבל אם מישהו כן שיחק
     בו במקביל, ההרכב שהוא **שמר בכרטיס** הוא זה שהוא מזהה
     כשלו — הוא זה שהופיע בטבלה ושאותו הוא שיתף.
  */
  DELETE FROM game.user_lineups t
   WHERE t.user_id = v_me
     AND EXISTS (SELECT 1 FROM game.user_lineups s
                  WHERE s.user_id = v_src
                    AND s.gameweek_id = t.gameweek_id
                    AND s.mode = t.mode);

  UPDATE game.user_lineups SET user_id = v_me WHERE user_id = v_src;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  /* 2. טיוטות */
  DELETE FROM game.lineup_drafts t
   WHERE t.user_id = v_me
     AND EXISTS (SELECT 1 FROM game.lineup_drafts s
                  WHERE s.user_id = v_src
                    AND s.gameweek_id = t.gameweek_id
                    AND s.mode = t.mode);
  UPDATE game.lineup_drafts SET user_id = v_me WHERE user_id = v_src;

  /* 3. זירות — חברות ובעלות */
  DELETE FROM game.league_members t
   WHERE t.user_id = v_me
     AND EXISTS (SELECT 1 FROM game.league_members s
                  WHERE s.user_id = v_src AND s.league_id = t.league_id);
  UPDATE game.league_members SET user_id = v_me WHERE user_id = v_src;
  UPDATE game.leagues       SET owner_id = v_me WHERE owner_id = v_src;

  /* 4. ליד — אחד לכל משתמש */
  DELETE FROM game.leads WHERE user_id = v_me
     AND EXISTS (SELECT 1 FROM game.leads s WHERE s.user_id = v_src);
  UPDATE game.leads SET user_id = v_me WHERE user_id = v_src;

  /* 5. יומן הפעילות נשאר על המקור.
     ★ זו החלטה: היומן מתאר **מה קרה מתי**, ולא "למי הדאטה
       שייכת עכשיו". שכתוב שלו היה הופך אותו לחסר ערך. */

  /* ------------------------------------------------------------
     6. הפרופיל
     ------------------------------------------------------------
     ★ `username` הוא UNIQUE — חייבים לשחרר אותו מהמקור לפני
       שמציבים אותו על היעד, אחרת העדכון נכשל על עצמו.
  */
  UPDATE game.users SET username = NULL WHERE id = v_src RETURNING display_name INTO v_name;

  UPDATE game.users t SET
    display_name  = COALESCE(NULLIF(btrim(s.display_name), ''), t.display_name),
    username      = COALESCE(t.username, s.username),
    avatar        = COALESCE(s.avatar, t.avatar),
    referral_code = COALESCE(t.referral_code, s.referral_code),
    email         = COALESCE(t.email, s.email),
    /* ★ מי שהיה רשום נשאר רשום. `is_guest` יורד ל-FALSE אם
       אחד מהשניים כבר לא אורח. */
    is_guest      = (t.is_guest AND s.is_guest),
    registered_at = COALESCE(t.registered_at, s.registered_at),
    offsides_user_id = COALESCE(t.offsides_user_id, s.offsides_user_id),
    offsides_email   = COALESCE(t.offsides_email, s.offsides_email)
    /* ★★ `is_admin` **לא** ברשימה. ראו הכותרת של §3. */
  FROM game.users s
  WHERE t.id = v_me AND s.id = v_src;

  /* ------------------------------------------------------------
     7. הכרטיס עצמו עובר ליעד
     ------------------------------------------------------------
     ★ ככה התמונה ששמורה בגלריה ממשיכה לעבוד גם אחרי הפדיון.
       זו כל הנקודה של מפתח חוזר.
  */
  UPDATE game.access_codes SET revoked_at = now()
   WHERE user_id = v_me AND kind = 'pass' AND revoked_at IS NULL;

  UPDATE game.access_codes
     SET user_id = v_me, uses = uses + 1, last_used_at = now(),
         redeemed_at = CASE WHEN kind = 'transfer' THEN now() ELSE redeemed_at END
   WHERE code_hash = v_hash;

  /* שאר הקודים של המקור מבוטלים — הם מצביעים לחשבון שכבר ריק. */
  UPDATE game.access_codes SET revoked_at = now()
   WHERE user_id = v_src AND revoked_at IS NULL;

  /* 8. סימון */
  UPDATE game.users SET merged_into = v_me, merged_at = now() WHERE id = v_src;

  PERFORM game.log_activity(v_me, 'pass_claim', NULL, NULL, v_name);

  RETURN jsonb_build_object(
    'ok', TRUE, 'moved', v_moved, 'sameUser', FALSE, 'displayName', v_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION game.claim_pass(TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- §4 · תוויות ליומן
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'game' AND p.proname = 'admin_activity') THEN
    NULL;   -- התווית עצמה נוספת ב-16; כאן רק מוודאים שהפעולה קיימת
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- §5 · ייצוא לידים — כדי שיהיה אפשר לעבוד עם המידע בחוץ
-- ---------------------------------------------------------------------
--
--  ★ CSV ולא JSON.
--
--  זה מידע שהולך לאקסל, לגיליון, או למערכת דיוור — ולא לקוד.
--  JSON היה מחייב המרה בכל פעם מחדש.
--
--  ★ הפסיקים בתוך שדות: `quote_nullable` עוטף ומכפיל מרכאות
--    לפי RFC 4180. שם עם פסיק בלי זה שובר את כל השורה.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.admin_leads_csv()
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v TEXT;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  SELECT 'email,name,consent,source,gameweek,entries,registered,created_at' || E'\n' ||
         COALESCE(string_agg(
           quote_nullable(l.email::TEXT) || ',' ||
           quote_nullable(COALESCE(NULLIF(btrim(u.display_name), ''), 'אורח')) || ',' ||
           CASE WHEN l.consent THEN 'yes' ELSE 'no' END || ',' ||
           quote_nullable(l.source) || ',' ||
           quote_nullable(COALESCE(l.gw_code, '')) || ',' ||
           (SELECT count(*) FROM game.user_lineups ul
             WHERE ul.user_id = l.user_id AND ul.status <> 'draft')::TEXT || ',' ||
           CASE WHEN COALESCE(u.is_guest, TRUE) THEN 'no' ELSE 'yes' END || ',' ||
           to_char(l.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'),
           E'\n' ORDER BY l.created_at DESC), '')
    INTO v
  FROM game.leads l
  LEFT JOIN game.users u ON u.id = l.user_id;

  RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_leads_csv() TO authenticated;

-- ---------------------------------------------------------------------
-- §6 · תמונת מצב יומית — "מה קרה אתמול"
-- ---------------------------------------------------------------------
--
--  ★ שאלה אחת: **האם המוצר גדל השבוע, ואיפה.**
--
--  ארבעה עשר ימים אחורה, יום-יום. זה מספיק כדי לראות מגמה
--  ולזהות יום חריג, וקצר מספיק כדי להיקרא במבט.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.admin_daily(p_days INT DEFAULT 14)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v JSONB; v_days INT;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  v_days := GREATEST(1, LEAST(90, COALESCE(p_days, 14)));

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'day'), '[]'::jsonb) INTO v
  FROM (
    SELECT jsonb_build_object(
      'day',      to_char(d.day, 'YYYY-MM-DD'),
      'newUsers', (SELECT count(*) FROM game.users u
                    WHERE u.created_at::DATE = d.day
                      AND NOT COALESCE(u.is_bot, FALSE)
                      AND u.merged_into IS NULL),
      'entries',  (SELECT count(*) FROM game.user_lineups ul
                    WHERE ul.submitted_at::DATE = d.day AND ul.status <> 'draft'),
      'passes',   (SELECT count(*) FROM game.access_codes ac
                    WHERE ac.kind = 'pass' AND ac.created_at::DATE = d.day),
      'leads',    (SELECT count(*) FROM game.leads l WHERE l.created_at::DATE = d.day)
    ) AS x
    FROM generate_series(
      (now() - (v_days || ' days')::INTERVAL)::DATE, now()::DATE, '1 day'
    ) AS d(day)
  ) t;

  RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_daily(INT) TO authenticated;

-- ---------------------------------------------------------------------
-- §7 · המשפך מדלג על משתמשים שמוזגו
-- ---------------------------------------------------------------------
--
--  ★ בלי זה כל פדיון כרטיס היה מנפח את מספר "הנכנסו" באחד,
--    ומוריד את שיעור ההמרה בלי שקרה שום דבר.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.admin_funnel()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v JSONB;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  SELECT jsonb_build_object(
    'users',      (SELECT count(*) FROM game.users
                    WHERE merged_into IS NULL AND NOT COALESCE(is_bot, FALSE)),
    'guests',     (SELECT count(*) FROM game.users
                    WHERE COALESCE(is_guest, TRUE) AND NOT COALESCE(is_bot, FALSE)
                      AND merged_into IS NULL),
    'registered', (SELECT count(*) FROM game.users
                    WHERE NOT COALESCE(is_guest, TRUE) AND merged_into IS NULL),
    'played',     (SELECT count(DISTINCT user_id) FROM game.user_lineups
                    WHERE status <> 'draft'),
    'withPass',   (SELECT count(*) FROM game.access_codes
                    WHERE kind = 'pass' AND revoked_at IS NULL),
    'passUsed',   (SELECT count(*) FROM game.access_codes
                    WHERE kind = 'pass' AND uses > 0),
    'leads',      (SELECT count(*) FROM game.leads),
    'leadsOptIn', (SELECT count(*) FROM game.leads WHERE consent),
    'merges',     (SELECT count(*) FROM game.users WHERE merged_into IS NOT NULL)
  ) INTO v;

  RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_funnel() TO authenticated;

UPDATE game.data_revision
   SET revision = revision + 1, scope = 'migration-20', updated_at = now()
 WHERE id = 1;
