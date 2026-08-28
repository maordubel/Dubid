-- =====================================================================
--  Dubid · מיגרציה 23 — "החשבון כבר קיים"
-- =====================================================================
--
--  ═══════════════════════════════════════════════════════════════
--  ★★★ הטעות בתכנון, ולא באג נקודתי ★★★
--  ═══════════════════════════════════════════════════════════════
--
--  המוצר ניסה **לקשר** את חשבון גוגל לאורח הנוכחי
--  (`linkIdentity`). זה עובד בדיוק במקרה אחד: כשחשבון הגוגל
--  הזה עוד לא מוכר למערכת.
--
--  אבל המקרה השכיח הוא ההפוך — לאדם **כבר יש** חשבון. ואז
--  הקישור נכשל עם "החשבון כבר קיים", והמשתמש נתקע: הוא לא
--  נכנס, לא נרשם, ולא מבין מה הוא עשה לא נכון.
--
--  ★ והוא לא עשה שום דבר לא נכון. הוא לחץ "התחבר עם גוגל".
--
--  ═══════════════════════════════════════════════════════════════
--  ★★ הגישה הנכונה: להיכנס, ואז לגרור את מה שנבנה ★★
--  ═══════════════════════════════════════════════════════════════
--
--  במקום לנסות להדביק זהות חדשה על האורח, פשוט **נכנסים
--  רגיל** — וזה עובד תמיד, גם למי שיש חשבון וגם למי שאין.
--  אחר כך מעבירים את מה שהאורח בנה אל החשבון שנכנסנו אליו.
--
--  ואת זה כבר יודעים לעשות: `claim_pass`, מאותה מיגרציה שבנתה
--  את כרטיס המנוי. אותו קוד, אותן בדיקות.
--
--  הפונקציה כאן מנפיקה אסימון חד־פעמי וקצר־מועד שמשמש **רק**
--  להעברה הזו.
--
--  ★ ומה זה מבטל בדרך:
--    · אין יותר `linkIdentity`, ולכן אין יותר צורך להפעיל
--      "Manual linking" בלוח הבקרה. מתג פחות.
--    · אין יותר "החשבון כבר קיים". הודעת שגיאה שנעלמה כי
--      המצב שיצר אותה כבר לא קיים.
--
--  אידמפוטנטי. אפשר להריץ שוב.
-- =====================================================================

SET search_path = game, core, public;

/**
 * אסימון העברה חד־פעמי, לרגע ההתחברות.
 *
 * ★★ למה `transfer` ולא `pass` ★★
 *
 * הנפקת `pass` **מבטלת את הקודם**. אורח ששמר את כרטיס המנוי
 * שלו בגלריה היה מאבד אותו בכל לחיצה על "התחבר עם גוגל", בלי
 * לדעת — והתמונה ששמרנו לו הייתה מפסיקה לעבוד.
 *
 * אסימון העברה הוא דבר אחר לגמרי: חמש עשרה דקות, שימוש אחד,
 * ואינו נוגע בכרטיס.
 */
CREATE OR REPLACE FUNCTION game.issue_merge_token()
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_code TEXT; v_uid UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  IF NOT game.rate_ok('merge_token', 20, INTERVAL '1 hour') THEN
    RAISE EXCEPTION 'TOO_MANY_ATTEMPTS';
  END IF;

  /* ★ אסימונים קודמים שלא נפדו מבוטלים.
     משתמש שלחץ "התחבר" שלוש פעמים ונטש באמצע השאיר שלושה
     אסימונים חיים. אחד מספיק, והשאר הם רק משטח תקיפה. */
  UPDATE game.access_codes SET revoked_at = now()
   WHERE user_id = v_uid AND kind = 'transfer'
     AND redeemed_at IS NULL AND revoked_at IS NULL;

  v_code := game.gen_pass_code(10);

  INSERT INTO game.access_codes (code_hash, user_id, kind, expires_at)
  VALUES (encode(digest(v_code, 'sha256'), 'hex'), v_uid, 'transfer',
          now() + INTERVAL '15 minutes');

  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION game.issue_merge_token() TO authenticated;

/**
 * ★ האם לאורח הזה יש בכלל מה להעביר.
 *
 * בלי הבדיקה הזו היינו מנפיקים אסימון בכל התחברות, כולל של
 * מישהו שנכנס לפני שנייה ולא עשה כלום — כלומר שורה מיותרת
 * בטבלה בכל לחיצה, ומיזוג שאין בו שום דבר.
 */
CREATE OR REPLACE FUNCTION game.has_anything()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
  SELECT EXISTS (SELECT 1 FROM game.user_lineups
                  WHERE user_id = auth.uid() AND status <> 'draft')
      OR EXISTS (SELECT 1 FROM game.lineup_drafts WHERE user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM game.league_members WHERE user_id = auth.uid());
$$;

GRANT EXECUTE ON FUNCTION game.has_anything() TO authenticated;

UPDATE game.data_revision
   SET revision = revision + 1, scope = 'migration-23', updated_at = now()
 WHERE id = 1;
