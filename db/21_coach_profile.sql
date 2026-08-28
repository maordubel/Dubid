-- =====================================================================
--  Dubid · מיגרציה 21 — פרופיל המאמן
-- =====================================================================
--
--  ═══════════════════════════════════════════════════════════════
--  ★★★ הבעיה: התחברת, ולא קרה כלום ★★★
--  ═══════════════════════════════════════════════════════════════
--
--  משתמש שנכנס עם גוגל ראה בדיוק את מה שראה קודם: אותו לובי,
--  אותו שם. אין תמונה, אין היסטוריה, אין שום סימן שמשהו השתנה.
--
--  ★ וזו לא בעיה קוסמטית. זו בעיה של **סיבה**.
--
--  אנחנו מבקשים מאדם לוותר על אנונימיות ולתת לנו זהות. אם מה
--  שהוא מקבל בתמורה בלתי נראה, הבקשה הבאה שלנו תיענה בפחות
--  נכונות — והוא צודק.
--
--  פרופיל הוא התמורה: מקום שבו מצטבר מה שעשית. ככל שיש בו יותר,
--  כך פחות רוצים לאבד אותו — וזה בדיוק מה שהופך חשבון מ"טופס
--  שמילאתי" ל"דבר ששייך לי".
--
--  ═══════════════════════════════════════════════════════════════
--  ★ מה הפונקציה הזו מחזירה, ומה במפורש לא
--  ═══════════════════════════════════════════════════════════════
--
--  **מחזירה:** רק מה שהמסד באמת יודע — כמה מחזורים שיחקת, אילו
--  שמות קבוצה, מתי הצטרפת, ומה הניקוד **שנשמר** בטבלת הניקוד.
--
--  **לא מחזירה:** שום מספר משוער. אם מחזור עוד לא נוקד, השדה
--  ריק ולא אפס. אפס נראה כמו כישלון; ריק נראה כמו "עוד לא".
--  ההבדל הזה הוא כל ההבדל במסך שאמור לגרום למישהו להרגיש טוב.
--
--  אידמפוטנטי. אפשר להריץ שוב.
-- =====================================================================

SET search_path = game, core, public;

CREATE OR REPLACE FUNCTION game.my_profile()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_uid UUID; v JSONB;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  SELECT jsonb_build_object(
    /* ---------- מי אתה ---------- */
    'displayName',  COALESCE(NULLIF(btrim(u.display_name), ''), 'מאמן'),
    'username',     u.username,
    'avatar',       u.avatar,
    'email',        u.email,
    'isGuest',      COALESCE(u.is_guest, TRUE),
    'referralCode', u.referral_code,
    'memberSince',  to_char(u.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),

    /* ---------- מה עשית ---------- */
    'played',       (SELECT count(*) FROM game.user_lineups ul
                      WHERE ul.user_id = v_uid AND ul.status <> 'draft'),
    'playedFive',   (SELECT count(*) FROM game.user_lineups ul
                      WHERE ul.user_id = v_uid AND ul.status <> 'draft' AND ul.mode = 'five'),
    'playedFull',   (SELECT count(*) FROM game.user_lineups ul
                      WHERE ul.user_id = v_uid AND ul.status <> 'draft' AND ul.mode = 'full'),

    /* ★ סכום, שיא, וממוצע — רק ממחזורים שבאמת נוקדו.
       `NULL` כשאין, ולא 0. */
    'totalPoints',  (SELECT round(sum(ls.total_points))::INT
                      FROM game.lineup_scores ls
                      JOIN game.user_lineups ul ON ul.id = ls.lineup_id
                      WHERE ul.user_id = v_uid),
    'bestPoints',   (SELECT round(max(ls.total_points))::INT
                      FROM game.lineup_scores ls
                      JOIN game.user_lineups ul ON ul.id = ls.lineup_id
                      WHERE ul.user_id = v_uid),
    'bestRank',     (SELECT min(ls.rank)
                      FROM game.lineup_scores ls
                      JOIN game.user_lineups ul ON ul.id = ls.lineup_id
                      WHERE ul.user_id = v_uid AND ls.rank IS NOT NULL),
    'scored',       (SELECT count(*)
                      FROM game.lineup_scores ls
                      JOIN game.user_lineups ul ON ul.id = ls.lineup_id
                      WHERE ul.user_id = v_uid),

    /* ---------- הזהות המשנית ---------- */
    'hasPass',      EXISTS (SELECT 1 FROM game.access_codes ac
                             WHERE ac.user_id = v_uid AND ac.kind = 'pass'
                               AND ac.revoked_at IS NULL),
    'leagues',      (SELECT count(*) FROM game.league_members lm WHERE lm.user_id = v_uid),

    /* ---------- ההיסטוריה ---------- */
    /*
     * ★ הסדר הוא מהחדש לישן, וזה לא שרירותי: מה שקרה עכשיו הוא
     *   מה שמעניין, ומה שלפני חצי שנה הוא רקע.
     *
     * ★★ ומגבלת 40: פרופיל אינו ארכיון. רשימה שממשיכה לנצח
     *   הופכת מסך של גאווה למסך של גלילה.
     */
    'history',      COALESCE((
      SELECT jsonb_agg(x ORDER BY x->>'gw' DESC)
      FROM (
        SELECT jsonb_build_object(
          'gw',        g.code,
          'gwNumber',  g.number,
          'gwLabel',   g.label,
          'mode',      ul.mode,
          'teamName',  ul.team_name,
          'submitted', to_char(ul.submitted_at AT TIME ZONE 'UTC',
                               'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          /* ריק = המחזור עוד לא נוקד. לא אפס. */
          'points',    CASE WHEN ls.total_points IS NULL THEN NULL
                            ELSE round(ls.total_points)::INT END,
          'rank',      ls.rank
        ) AS x
        FROM game.user_lineups ul
        JOIN game.gameweeks g ON g.id = ul.gameweek_id
        LEFT JOIN game.lineup_scores ls ON ls.lineup_id = ul.id
        WHERE ul.user_id = v_uid AND ul.status <> 'draft'
        ORDER BY g.number DESC, ul.mode
        LIMIT 40
      ) t), '[]'::jsonb)
  ) INTO v
  FROM game.users u
  WHERE u.id = v_uid;

  RETURN COALESCE(v, jsonb_build_object('displayName', 'מאמן', 'isGuest', TRUE));
END;
$$;

GRANT EXECUTE ON FUNCTION game.my_profile() TO authenticated;

/**
 * שינוי אווטאר.
 *
 * ★ למה זו פונקציה ולא כתיבה ישירה: מאז `db/18` אין כתיבה
 *   ישירה לאף טבלה. כל שינוי עובר דרך פונקציה שמחליטה מה מותר.
 *
 * ★ והאורך מוגבל ל-8: האווטאר הוא **אמוג׳י**, ושדה חופשי בפרופיל
 *   הוא בדיוק המקום שבו מישהו ידביק סקריפט או שם באורך אלף תווים
 *   שישבור את הטבלה של כולם.
 */
CREATE OR REPLACE FUNCTION game.set_avatar(p_avatar TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  UPDATE game.users
     SET avatar = NULLIF(left(btrim(COALESCE(p_avatar, '')), 8), '')
   WHERE id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION game.set_avatar(TEXT) TO authenticated;

UPDATE game.data_revision
   SET revision = revision + 1, scope = 'migration-21', updated_at = now()
 WHERE id = 1;
