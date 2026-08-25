-- =====================================================================
--  DUBID · מיגרציה 09 — המשחק החי
--
--  ★ מה המיגרציה הזו עושה
--
--  היא הופכת את דוביד ממוצר שרץ על localStorage למוצר שרץ על
--  Supabase, בלי לגעת בסכימה שכבר קיימת. כל מה שנוסף כאן הוא
--  שכבה דקה מעל 01–08:
--
--     · תיקון שני באגים שחוסמים כתיבה (ראו §1, §2)
--     · פאסאדה של RPC שמדברת בשפת הקליינט (מזהים חיצוניים)
--     · אדמין: הזנת תוצאות ידנית ופרסום
--     · קודי גישה חד־פעמיים
--     · RLS אמיתי במקום GRANT ALL לכולם
--     · סיד של מחזור 2 והמשחקים שלו
--
--  אידמפוטנטי. additive בלבד. אפשר להריץ על מסד חי.
--
--  הרצה: db/01 → 02 → 03 → 04 → 05 → 06 → 07 → 09
--  (08 היה על דו־קיום בפרויקט משותף. הוא לא רלוונטי יותר —
--   לכל מוצר יש פרויקט משלו. ראו docs/SUPABASE.md.)
-- =====================================================================

SET search_path = core, game, public;

-- =====================================================================
-- §1 ★ הבאג שמנע מכל הרכב להישמר
-- =====================================================================
--
--  `game.user_lineups.user_id` הוא FK ל-`game.users(id)`.
--  מדיניות ה-RLS ב-02 בודקת `user_id = auth.uid()`.
--  `submit_lineup` ב-05 כותב `auth.uid()` ל-`user_id`.
--
--  שלושתם מניחים ש-`game.users.id = auth.uid()`.
--  `ensure_profile` ב-07 יוצר שורה עם `id = gen_random_uuid()`
--  ו-`auth_id` נפרד — כלומר ההנחה **לא** מתקיימת, וכל הגשה
--  נופלת על הפרה של מפתח זר.
--
--  התיקון: הפרופיל נוצר עם `id = auth.uid()`. זה מיישר את
--  שלושת המקומות בלי לשנות אף אחד מהם.
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

  SELECT * INTO v_user FROM game.users WHERE id = v_auth OR auth_id = v_auth;

  IF v_user.id IS NOT NULL THEN
    -- שם חדש מנצח שם ישן, אבל ריק לא מוחק שם קיים.
    IF NULLIF(btrim(p_display_name), '') IS NOT NULL
       AND v_user.display_name IS DISTINCT FROM btrim(p_display_name) THEN
      UPDATE game.users SET display_name = btrim(p_display_name)
       WHERE id = v_user.id RETURNING * INTO v_user;
    END IF;
    RETURN v_user;
  END IF;

  INSERT INTO game.users (id, auth_id, display_name)
  VALUES (v_auth, v_auth, COALESCE(NULLIF(btrim(p_display_name), ''), 'שחקן דוביד'))
  RETURNING * INTO v_user;

  RETURN v_user;
END;
$$;

GRANT EXECUTE ON FUNCTION game.ensure_profile(TEXT) TO authenticated;

-- =====================================================================
-- §2 עמודות זהות
-- =====================================================================
ALTER TABLE game.users
  ADD COLUMN IF NOT EXISTS offsides_user_id TEXT,
  ADD COLUMN IF NOT EXISTS offsides_email   TEXT,
  ADD COLUMN IF NOT EXISTS linked_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_admin         BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS users_offsides_uid
  ON game.users (offsides_user_id) WHERE offsides_user_id IS NOT NULL;

COMMENT ON COLUMN game.users.offsides_user_id IS
  'auth.users.id בפרויקט אופסיידס. זה כל הקשר בין שני המסדים — '
  'אין FK, כי הם לא באותו מסד. המיפוי נכתב אך ורק על ידי '
  'Edge Function שאימתה טוקן מול אופסיידס.';

-- =====================================================================
-- §3 קוד המחזור — כדי שהקליינט לא יצטרך להכיר UUID
-- =====================================================================
ALTER TABLE game.gameweeks ADD COLUMN IF NOT EXISTS code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS gameweeks_code ON game.gameweeks (code)
  WHERE code IS NOT NULL;

COMMENT ON COLUMN game.gameweeks.code IS
  'המזהה שהקליינט מכיר: ''gw-2''. UUID הוא פרט פנימי של המסד, '
  'ואין סיבה שהדפדפן יחזיק אותו.';


-- =====================================================================
-- §3b ★ שעון שרת בסכימת `game`
-- =====================================================================
--
--  הלקוח מוגדר `db: { schema: 'game' }`, ולכן `supabase.rpc(...)`
--  מחפש **תמיד** ב-`game` — גם עבור `server_now`, שיושבת
--  ב-`public`. התוצאה הייתה 404 שקט: `syncServerTime` נכשל בכל
--  דגימה, ההיסט נשאר 0, והספירה לאחור בלובי רצה על שעון המכשיר.
--
--  באג שלא מפיל שום מסך ומבטל בדיוק את התכונה שבגללה הפונקציה
--  קיימת. עטיפה של שורה אחת, ולא שינוי של מקור האמת ב-`public`
--  (שאסור לגעת בו — ראו docs/OFFSIDES-SYNC.md §5).
CREATE OR REPLACE FUNCTION game.server_now()
RETURNS BIGINT LANGUAGE sql STABLE AS $$ SELECT public.server_now() $$;
GRANT EXECUTE ON FUNCTION game.server_now() TO anon, authenticated;

-- =====================================================================
-- §3c הפרופיל שלי
-- =====================================================================
--
--  ★ למה RPC ולא `select` על `game.users`.
--
--  מדיניות הקריאה על הטבלה היא `USING (TRUE)` — היא חייבת להיות,
--  כי שם התצוגה מופיע בדירוג של כולם. אבל באותה שורה יושבים גם
--  `offsides_email` ו-`offsides_user_id`. `select *` מהדפדפן היה
--  מחזיר את המייל של כל משתמש אחר.
--
--  הפונקציה מחזירה **רק את השורה של הקורא**, ורק את השדות שהוא
--  צריך. הטבלה נשארת קריאה לשם התצוגה בלבד, דרך הפונקציות.
CREATE OR REPLACE FUNCTION game.me()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, public AS $$
  SELECT jsonb_build_object(
    'id',              u.id,
    'displayName',     u.display_name,
    'offsidesUserId',  u.offsides_user_id,
    'isAdmin',         u.is_admin
  )
  FROM game.users u WHERE u.id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION game.me() TO authenticated;

-- =====================================================================
-- §4 תרגום מזהים — חיצוני ↔ פנימי
-- =====================================================================
--
--  ★ למה פונקציות ולא JOIN בכל שאילתה
--
--  הקליינט מכיר 'T3' ו-'P305'. המסד מכיר UUID. המיפוי כבר קיים
--  ב-`core.external_refs` (provider='manual_json'), אבל אם כל
--  שאילתה תעשה אותו JOIN בעצמה, מספיק מקום אחד שישכח את התנאי
--  `provider=` כדי לקבל שחקן שגוי בשקט.
--
--  שתי פונקציות, שתי שורות, ואי אפשר לטעות.

CREATE OR REPLACE FUNCTION core.player_by_ext(p_ext TEXT)
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT entity_id FROM core.external_refs
   WHERE provider = 'manual_json' AND entity_type = 'player' AND external_id = p_ext;
$$;

CREATE OR REPLACE FUNCTION core.team_by_ext(p_ext TEXT)
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT entity_id FROM core.external_refs
   WHERE provider = 'manual_json' AND entity_type = 'team' AND external_id = p_ext;
$$;

/* הכיוון ההפוך, כ-view — כדי שאפשר יהיה לצרף אותו בשאילתה. */
-- ★ `DROP` ולא `CREATE OR REPLACE`.
--
--   PostgreSQL לא מרשה ל-`CREATE OR REPLACE VIEW` לשנות את
--   רשימת העמודות — רק להוסיף בסוף. מיגרציה מאוחרת שהרחיבה
--   תצוגה, ואז הרצה חוזרת של המיגרציה המוקדמת שמצמצמת אותה
--   בחזרה, נופלת על:
--
--       ERROR: 42P16: cannot drop columns from view
--
--   וזה קורה בפועל: הקבצים אידמפוטנטיים, ולכן טבעי להריץ אותם
--   שוב בסדר כלשהו. `DROP` הופך את הסדר ללא רלוונטי.
DROP VIEW IF EXISTS core.v_ext;
CREATE VIEW core.v_ext AS
  SELECT entity_type, entity_id, external_id
    FROM core.external_refs WHERE provider = 'manual_json';

-- =====================================================================
-- §5 הגשת הרכב — נתיב הכתיבה היחיד, בשפת הקליינט
-- =====================================================================
--
--  עוטף את `game.submit_lineup` הקיים? לא. הוא מקבל UUID של מחזור
--  ושל שחקנים, וגם התיקון ב-§1 לא הופך אותו לנוח לקליינט. במקום
--  להוסיף שכבת תרגום בדפדפן — שם היא יכולה לשקר — התרגום קורה כאן,
--  וכל הבדיקות של 05 (נעילה, קפטן, גודל) חוזרות במלואן.
--
--  ★ הנעילה: שתי בדיקות, ושתיהן חייבות לעבור.
--     1. סטטוס המחזור — אדמין יכול לנעול מוקדם.
--     2. `now()` של המסד מול `lock_at` — cron יכול לאחר בדקה,
--        ובדקה הזו אסור שתתקבל הגשה.
--  שום דבר מהקליינט לא משתתף בהחלטה הזו.

CREATE OR REPLACE FUNCTION game.submit_entry(
  p_gw_code   TEXT,
  p_mode      TEXT,
  p_formation TEXT,
  -- [{"slot_no":1,"ext_player_id":"101","is_captain":true,"is_vice":false,"is_bench":false}, ...]
  p_slots     JSONB,
  p_display_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE
  v_auth     UUID := auth.uid();
  v_gw       game.gameweeks;
  v_lineup   game.user_lineups;
  v_slot     JSONB;
  v_player   UUID;
  v_team     UUID;
  v_position core."position";
  v_price    NUMERIC(5,1);
  v_captains INT;
  v_vices    INT;
  v_count    INT;
BEGIN
  IF v_auth IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_mode NOT IN ('five','full') THEN RAISE EXCEPTION 'INVALID_MODE'; END IF;
  IF jsonb_typeof(p_slots) <> 'array' THEN RAISE EXCEPTION 'INVALID_SLOTS'; END IF;

  PERFORM game.ensure_profile(p_display_name);

  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code FOR UPDATE;
  IF v_gw.id IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND: %', p_gw_code; END IF;
  IF v_gw.status NOT IN ('open','draft') THEN RAISE EXCEPTION 'GAMEWEEK_LOCKED'; END IF;
  IF now() >= v_gw.lock_at THEN RAISE EXCEPTION 'DEADLINE_PASSED'; END IF;

  v_count := jsonb_array_length(p_slots);
  IF p_mode = 'five' AND v_count <> 5  THEN RAISE EXCEPTION 'LINEUP_SIZE'; END IF;
  IF p_mode = 'full' AND v_count NOT BETWEEN 5 AND 11 THEN RAISE EXCEPTION 'LINEUP_SIZE'; END IF;

  SELECT count(*) FILTER (WHERE (s->>'is_captain')::BOOLEAN),
         count(*) FILTER (WHERE (s->>'is_vice')::BOOLEAN)
    INTO v_captains, v_vices
    FROM jsonb_array_elements(p_slots) s;
  IF v_captains <> 1 THEN RAISE EXCEPTION 'CAPTAIN_REQUIRED'; END IF;
  IF v_vices > 1     THEN RAISE EXCEPTION 'VICE_DUPLICATE'; END IF;

  INSERT INTO game.user_lineups (user_id, gameweek_id, mode, formation, status, submitted_at)
  VALUES (v_auth, v_gw.id, p_mode, p_formation, 'submitted', now())
  ON CONFLICT (user_id, gameweek_id, mode) DO UPDATE
    SET formation    = EXCLUDED.formation,
        status       = 'submitted',
        -- ★ החותמת מתעדכנת בכל הגשה מחדש. היא שובר השוויון האחרון,
        --   ולכן חייבת לשקף את ההגשה שנספרת בפועל.
        submitted_at = now()
  RETURNING * INTO v_lineup;

  DELETE FROM game.user_lineup_slots WHERE lineup_id = v_lineup.id;

  FOR v_slot IN SELECT * FROM jsonb_array_elements(p_slots) LOOP
    v_player := core.player_by_ext(v_slot->>'ext_player_id');
    IF v_player IS NULL THEN
      RAISE EXCEPTION 'PLAYER_NOT_FOUND: %', v_slot->>'ext_player_id';
    END IF;

    -- ★ הקבוצה, העמדה והשווי נלקחים מהמסד — לא מהקליינט.
    --   קליינט שישלח price=0 לא יקבל שחקן בחינם.
    SELECT sq.team_id, sq.position, COALESCE(sq.fantasy_price, 0)
      INTO v_team, v_position, v_price
      FROM core.squads sq
     WHERE sq.player_id = v_player
       AND sq.season_id = v_gw.season_id
       AND sq.valid_to IS NULL
       AND sq.status   = 'active'
     ORDER BY sq.valid_from DESC
     LIMIT 1;
    IF v_team IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_IN_SQUAD: %', v_player; END IF;

    INSERT INTO game.user_lineup_slots
      (lineup_id, slot_no, player_id, team_id, position, price, is_captain, is_vice, is_bench)
    VALUES (
      v_lineup.id, (v_slot->>'slot_no')::SMALLINT, v_player, v_team, v_position, v_price,
      COALESCE((v_slot->>'is_captain')::BOOLEAN, FALSE),
      COALESCE((v_slot->>'is_vice')::BOOLEAN, FALSE),
      COALESCE((v_slot->>'is_bench')::BOOLEAN, FALSE)
    );
  END LOOP;

  -- one_player_per_team / no_duplicate_player נאכפים על ידי המסד
  -- עצמו ויזרקו כאן אם הופרו. שכבת הגנה שלישית.

  RETURN jsonb_build_object(
    'id', v_lineup.id, 'gameweek', p_gw_code, 'mode', p_mode,
    'submitted_at', v_lineup.submitted_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION game.submit_entry(TEXT, TEXT, TEXT, JSONB, TEXT) TO authenticated;

/* ביטול הגשה — מותר רק כל עוד לא פורסמו תוצאות ולא עבר הדדליין. */
CREATE OR REPLACE FUNCTION game.withdraw_entry(p_gw_code TEXT, p_mode TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_auth UUID := auth.uid(); v_gw game.gameweeks;
BEGIN
  IF v_auth IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw.id IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND'; END IF;
  IF v_gw.status = 'published' THEN RAISE EXCEPTION 'ALREADY_PUBLISHED'; END IF;
  IF now() >= v_gw.lock_at THEN RAISE EXCEPTION 'DEADLINE_PASSED'; END IF;

  DELETE FROM game.user_lineups
   WHERE user_id = v_auth AND gameweek_id = v_gw.id AND mode = p_mode;
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION game.withdraw_entry(TEXT, TEXT) TO authenticated;

-- =====================================================================
-- §6 קריאה — הרכבים ותוצאות, בשפת הקליינט
-- =====================================================================
--
--  ★ למה כל ההגשות גלויות לכולם *אחרי* הנעילה, ורק אז.
--
--  לפני הנעילה, הרכב גלוי הוא העתקה. אחרי הנעילה, הרכב מוסתר הוא
--  לוח תוצאות בלי שקיפות. הפונקציה מחזירה מערך ריק כל עוד המחזור
--  פתוח — וזה מה שגורם לדירוג להיות ריק, נכון, ולא שקרי.

CREATE OR REPLACE FUNCTION game.entries(p_gw_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v_gw game.gameweeks; v_auth UUID := auth.uid();
BEGIN
  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw.id IS NULL THEN RETURN '[]'::jsonb; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(e ORDER BY e->>'submittedAt')
    FROM (
      SELECT jsonb_build_object(
        'id',          ul.id,
        'userId',      ul.user_id,
        'displayName', COALESCE(u.display_name, 'אלמוני'),
        'gameweekId',  p_gw_code,
        'mode',        ul.mode,
        'submittedAt', to_char(ul.submitted_at AT TIME ZONE 'UTC',
                               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'lineup', jsonb_build_object(
          'lineupId',   ul.id,
          'userId',     ul.user_id,
          'gameweekId', p_gw_code,
          'formation',  ul.formation,
          'slots', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'slotNo',    s.slot_no,
              'playerId',  'P' || xp.external_id,
              'teamId',    'T' || xt.external_id,
              'position',  s.position,
              'price',     s.price,
              'isCaptain', s.is_captain,
              'isVice',    s.is_vice,
              'isBench',   s.is_bench
            ) ORDER BY s.slot_no)
            FROM game.user_lineup_slots s
            JOIN core.v_ext xp ON xp.entity_type = 'player' AND xp.entity_id = s.player_id
            JOIN core.v_ext xt ON xt.entity_type = 'team'   AND xt.entity_id = s.team_id
            WHERE s.lineup_id = ul.id
          ), '[]'::jsonb)
        )
      ) AS e
      FROM game.user_lineups ul
      LEFT JOIN game.users u ON u.id = ul.user_id
      WHERE ul.gameweek_id = v_gw.id
        AND ul.status IN ('submitted','locked','scored')
        -- לפני הנעילה: רק ההגשה שלי. אחרי: הכל.
        AND (now() >= v_gw.lock_at OR ul.user_id = v_auth)
    ) q
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION game.entries(TEXT) TO anon, authenticated;

/**
 * התוצאות, בדיוק בצורה שמנוע הניקוד בקליינט מצפה לה.
 * ★ `published=false` מחזיר מבנה ריק ולא NULL — מסך שמקבל NULL
 *   צריך ענף נוסף, ומסך עם ענף נוסף הוא מסך עם באג נוסף.
 */
CREATE OR REPLACE FUNCTION game.results(p_gw_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v_gw game.gameweeks; v_published BOOLEAN;
BEGIN
  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw.id IS NULL THEN
    RETURN jsonb_build_object('gameweekId', p_gw_code, 'published', FALSE,
                              'performances', '{}'::jsonb, 'outcomes', '{}'::jsonb,
                              'fixtureScores', '{}'::jsonb);
  END IF;
  v_published := (v_gw.status = 'published');

  RETURN jsonb_build_object(
    'gameweekId', p_gw_code,
    'published',  v_published,
    'updatedAt',  to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),

    'performances', COALESCE((
      SELECT jsonb_object_agg('P' || xp.external_id, jsonb_build_object(
        'playerId',        'P' || xp.external_id,
        'teamId',          'T' || xt.external_id,
        'position',        st.position,
        'minutes',         st.minutes,
        'goals',           st.goals,
        'assists',         st.assists,
        'ownGoals',        st.own_goals,
        'yellowCards',     st.yellow_cards,
        'redCards',        st.red_cards,
        'saves',           st.saves,
        'penaltiesSaved',  st.penalties_saved,
        'penaltiesMissed', st.penalties_missed,
        'goalsConceded',   st.goals_conceded,
        'cleanSheet',      st.clean_sheet,
        'played',          st.minutes > 0
      ))
      FROM game.gameweek_player_stats(v_gw.id) st
      JOIN core.v_ext xp ON xp.entity_type = 'player' AND xp.entity_id = st.player_id
      JOIN core.v_ext xt ON xt.entity_type = 'team'   AND xt.entity_id = st.team_id
    ), '{}'::jsonb),

    'outcomes', COALESCE((
      SELECT jsonb_object_agg('T' || xt.external_id, jsonb_build_object(
        'teamId',       'T' || xt.external_id,
        'result',       r.result,
        'goalsFor',     r.goals_for,
        'goalsAgainst', r.goals_against
      ))
      FROM game.gameweek_team_results(v_gw.id) r
      JOIN core.v_ext xt ON xt.entity_type = 'team' AND xt.entity_id = r.team_id
    ), '{}'::jsonb),

    /* ★ המפתח הוא זוג הקבוצות, לא ה-UUID של המשחק.
       לקליינט אין את ה-UUID — הוא מכיר את לוח המשחקים שלו לפי
       'T13' מול 'T1'. מפתח שהקליינט לא יכול לחשב הוא מפתח שהוא
       לא יכול לחפש לפיו, ומסך הניהול היה מציג תיבות ריקות מעל
       תוצאות ששמורות במסד. */
    'fixtureScores', COALESCE((
      SELECT jsonb_object_agg('T' || xh.external_id || '-T' || xa.external_id,
        jsonb_build_object(
          'fixtureId',  'T' || xh.external_id || '-T' || xa.external_id,
          'homeGoals',  COALESCE(m.home_goals, 0),
          'awayGoals',  COALESCE(m.away_goals, 0),
          'final',      m.status = 'finished'
        ))
      FROM core.weekly_matches m
      JOIN core.v_ext xh ON xh.entity_type = 'team' AND xh.entity_id = m.home_team_id
      JOIN core.v_ext xa ON xa.entity_type = 'team' AND xa.entity_id = m.away_team_id
      WHERE m.gameweek_id = v_gw.id AND m.home_goals IS NOT NULL
    ), '{}'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION game.results(TEXT) TO anon, authenticated;

/** מצב המחזור — סטטוס, דדליין, ומספר משתתפים. שאילתה אחת ללובי. */
CREATE OR REPLACE FUNCTION game.gameweek_state(p_gw_code TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
  SELECT jsonb_build_object(
    'code',           gw.code,
    'number',         gw.number,
    'status',         gw.status,
    'lockAt',         to_char(gw.lock_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'firstKickoffAt', to_char(COALESCE(gw.first_kickoff_at, gw.lock_at) AT TIME ZONE 'UTC',
                              'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'serverNow',      (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT,
    'entrants',       (SELECT count(DISTINCT user_id) FROM game.user_lineups
                        WHERE gameweek_id = gw.id AND status <> 'draft')
  )
  FROM game.gameweeks gw WHERE gw.code = p_gw_code;
$$;

GRANT EXECUTE ON FUNCTION game.gameweek_state(TEXT) TO anon, authenticated;

-- =====================================================================
-- §7 אדמין — הזנת תוצאות ופרסום
-- =====================================================================
--
--  ★ ההרשאה נבדקת במסד, לא במסך.
--
--  מסך הניהול בקליינט מגן על עצמו ב-hash של PIN. זו נוחות, לא
--  אבטחה: מי שמריץ את הקוד יכול לדלג עליה. לכן כל פונקציה כאן
--  בודקת `game.is_admin()` בשורה הראשונה. מסך הניהול הוא UI;
--  ההרשאה היא כאן.
--
--  איך הופכים משתמש לאדמין (פעם אחת, מה-SQL Editor):
--      UPDATE game.users SET is_admin = TRUE WHERE id = '<auth uid>';

CREATE OR REPLACE FUNCTION game.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, public AS $$
  SELECT COALESCE((SELECT is_admin FROM game.users WHERE id = auth.uid()), FALSE);
$$;
GRANT EXECUTE ON FUNCTION game.is_admin() TO authenticated;

CREATE OR REPLACE FUNCTION game.admin_upsert_match(
  p_gw_code TEXT, p_ext_home TEXT, p_ext_away TEXT,
  p_home_goals SMALLINT, p_away_goals SMALLINT, p_final BOOLEAN
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_gw UUID; v_home UUID; v_away UUID; v_match UUID;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  SELECT id INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND'; END IF;

  v_home := core.team_by_ext(p_ext_home);
  v_away := core.team_by_ext(p_ext_away);
  IF v_home IS NULL OR v_away IS NULL THEN RAISE EXCEPTION 'TEAM_NOT_FOUND'; END IF;

  INSERT INTO core.weekly_matches
    (gameweek_id, home_team_id, away_team_id, kickoff_at, status, home_goals, away_goals)
  VALUES (v_gw, v_home, v_away,
          (SELECT lock_at FROM game.gameweeks WHERE id = v_gw),
          CASE WHEN p_final THEN 'finished' ELSE 'live' END,
          p_home_goals, p_away_goals)
  ON CONFLICT (gameweek_id, home_team_id, away_team_id) DO UPDATE
    SET home_goals = EXCLUDED.home_goals,
        away_goals = EXCLUDED.away_goals,
        status     = EXCLUDED.status
  RETURNING id INTO v_match;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (auth.uid()::TEXT, 'admin_upsert_match', 'weekly_match', v_match::TEXT,
          jsonb_build_object('gw', p_gw_code, 'home', p_ext_home, 'away', p_ext_away,
                             'score', p_home_goals || '-' || p_away_goals, 'final', p_final));

  RETURN v_match;
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_upsert_match(TEXT,TEXT,TEXT,SMALLINT,SMALLINT,BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION game.admin_upsert_player_stat(
  p_gw_code TEXT, p_ext_player TEXT, p_stats JSONB
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_gw UUID; v_player UUID; v_team UUID; v_match UUID;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  SELECT id INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  v_player := core.player_by_ext(p_ext_player);
  IF v_gw IS NULL OR v_player IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  SELECT team_id INTO v_team FROM core.squads
   WHERE player_id = v_player AND valid_to IS NULL AND status = 'active' LIMIT 1;
  IF v_team IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_IN_SQUAD'; END IF;

  -- המשחק שבו הקבוצה שלו שיחקה במחזור הזה.
  SELECT id INTO v_match FROM core.weekly_matches
   WHERE gameweek_id = v_gw AND (home_team_id = v_team OR away_team_id = v_team) LIMIT 1;
  IF v_match IS NULL THEN RAISE EXCEPTION 'MATCH_NOT_FOUND_FOR_TEAM'; END IF;

  INSERT INTO core.player_match_stats (
    match_id, player_id, team_id, minutes, goals, assists, own_goals,
    yellow_cards, red_cards, saves, penalties_saved, penalties_missed,
    goals_conceded, clean_sheet, updated_at)
  VALUES (
    v_match, v_player, v_team,
    COALESCE((p_stats->>'minutes')::SMALLINT, 0),
    COALESCE((p_stats->>'goals')::SMALLINT, 0),
    COALESCE((p_stats->>'assists')::SMALLINT, 0),
    COALESCE((p_stats->>'ownGoals')::SMALLINT, 0),
    COALESCE((p_stats->>'yellowCards')::SMALLINT, 0),
    COALESCE((p_stats->>'redCards')::SMALLINT, 0),
    COALESCE((p_stats->>'saves')::SMALLINT, 0),
    COALESCE((p_stats->>'penaltiesSaved')::SMALLINT, 0),
    COALESCE((p_stats->>'penaltiesMissed')::SMALLINT, 0),
    COALESCE((p_stats->>'goalsConceded')::SMALLINT, 0),
    COALESCE((p_stats->>'cleanSheet')::BOOLEAN, FALSE),
    now())
  ON CONFLICT (match_id, player_id) DO UPDATE SET
    minutes = EXCLUDED.minutes, goals = EXCLUDED.goals, assists = EXCLUDED.assists,
    own_goals = EXCLUDED.own_goals, yellow_cards = EXCLUDED.yellow_cards,
    red_cards = EXCLUDED.red_cards, saves = EXCLUDED.saves,
    penalties_saved = EXCLUDED.penalties_saved,
    penalties_missed = EXCLUDED.penalties_missed,
    goals_conceded = EXCLUDED.goals_conceded, clean_sheet = EXCLUDED.clean_sheet,
    updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_upsert_player_stat(TEXT,TEXT,JSONB) TO authenticated;

/**
 * פרסום. שינוי סטטוס אחד — וכל המוצר משתנה יחד: הדירוג נפתח,
 * הכרטיסים נוצרים, וההגשות ננעלות לצמיתות.
 *
 * ★ ביטול פרסום מותר בכוונה. טעות בהזנת תוצאה היא תרחיש ודאי,
 *   ו"אי אפשר לחזור" הופך טעות קטנה לאסון. הפעולה נרשמת ביומן.
 */
CREATE OR REPLACE FUNCTION game.admin_set_published(p_gw_code TEXT, p_published BOOLEAN)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_gw game.gameweeks; v_next TEXT;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw.id IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND'; END IF;

  v_next := CASE WHEN p_published THEN 'published' ELSE 'scoring' END;

  UPDATE game.gameweeks
     SET status = v_next,
         published_at = CASE WHEN p_published THEN now() ELSE NULL END
   WHERE id = v_gw.id;

  UPDATE game.user_lineups SET status = CASE WHEN p_published THEN 'scored' ELSE 'locked' END
   WHERE gameweek_id = v_gw.id AND status IN ('submitted','locked','scored');

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (auth.uid()::TEXT, 'admin_set_published', 'gameweek', v_gw.id::TEXT,
          jsonb_build_object('code', p_gw_code, 'published', p_published));

  RETURN v_next;
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_set_published(TEXT, BOOLEAN) TO authenticated;

-- =====================================================================
-- §8 קודי גישה חד־פעמיים
-- =====================================================================
--
--  ★ הקוד עצמו לא נשמר. רק ה-hash.
--
--  קוד שנשמר כטקסט הוא סיסמה שנשמרה כטקסט. מי שמשיג גישה לטבלה
--  יכול להתחזות לכל משתמש. ה-hash עולה שורה אחת ומבטל את זה.
--
--  ה-Edge Function `access-code` היא היחידה שנוגעת בטבלה — היא
--  צריכה `service_role` כדי להנפיק סשן למשתמש אחר, ולכן אין כאן
--  שום GRANT ל-anon או ל-authenticated.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS game.access_codes (
  code_hash   TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES game.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  redeemed_at TIMESTAMPTZ,
  -- כמה פעמים ניסו לפדות. הגנה מפני ניחוש בכוח גס.
  attempts    SMALLINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS access_codes_user ON game.access_codes (user_id);

ALTER TABLE game.access_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON game.access_codes FROM anon, authenticated;

-- =====================================================================
-- §9 ★ RLS — סגירת הדלת שנשארה פתוחה
-- =====================================================================
--
--  מיגרציה 07 עשתה `GRANT ALL ON ALL TABLES IN SCHEMA game TO anon`.
--  זה היה נכון כשהמסד היה ריק ואף אחד לא שיחק. במשחק תחרותי חי
--  זה אומר שכל מי שפותח את ה-DevTools יכול לכתוב תוצאות, למחוק
--  הרכבים של אחרים, ולשנות ניקוד.
--
--  כאן זה נסגר. הכלל: **כתיבה עוברת אך ורק דרך פונקציות
--  SECURITY DEFINER.** לטבלאות עצמן יש קריאה בלבד, ורק למה
--  שצריך להיות גלוי.

DO $rls$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    RAISE NOTICE 'דילוג על RLS: הסכמה auth לא קיימת (לא Supabase)';
    RETURN;
  END IF;

  -- --- כתיבה ישירה נשללת מכולם ---
  REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA game FROM anon, authenticated;
  REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core FROM anon, authenticated;

  -- --- קריאה: דאטת כדורגל פומבית ---
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA core TO anon, authenticated';

  -- --- הרכבים ---
  ALTER TABLE game.user_lineups      ENABLE ROW LEVEL SECURITY;
  ALTER TABLE game.user_lineup_slots ENABLE ROW LEVEL SECURITY;
  ALTER TABLE game.users             ENABLE ROW LEVEL SECURITY;
  ALTER TABLE game.gameweeks         ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS lineups_own ON game.user_lineups;
  DROP POLICY IF EXISTS lineups_read ON game.user_lineups;
  CREATE POLICY lineups_read ON game.user_lineups FOR SELECT
    USING (
      user_id = auth.uid()
      OR EXISTS (SELECT 1 FROM game.gameweeks gw
                  WHERE gw.id = gameweek_id AND now() >= gw.lock_at)
    );

  DROP POLICY IF EXISTS slots_own_before_lock ON game.user_lineup_slots;
  DROP POLICY IF EXISTS slots_read ON game.user_lineup_slots;
  CREATE POLICY slots_read ON game.user_lineup_slots FOR SELECT
    USING (EXISTS (
      SELECT 1 FROM game.user_lineups ul JOIN game.gameweeks gw ON gw.id = ul.gameweek_id
       WHERE ul.id = lineup_id AND (ul.user_id = auth.uid() OR now() >= gw.lock_at)
    ));

  DROP POLICY IF EXISTS users_read ON game.users;
  -- ★ רק השורה שלי.
  --
  -- שם התצוגה של אחרים מגיע דרך `game.entries()`, שבוחרת אותו
  -- במפורש. הטבלה עצמה מחזיקה גם `offsides_email`, ומדיניות
  -- `USING (TRUE)` הייתה מאפשרת לכל דפדפן למשוך את רשימת
  -- המיילים של כל המשתמשים בבקשה אחת.
  CREATE POLICY users_read ON game.users FOR SELECT USING (id = auth.uid());

  DROP POLICY IF EXISTS gameweeks_read ON game.gameweeks;
  CREATE POLICY gameweeks_read ON game.gameweeks FOR SELECT USING (TRUE);
END
$rls$;

-- =====================================================================
-- §10 סיד — מחזור 2
-- =====================================================================
--
--  ★ הדדליין הוא בעיטת הפתיחה **המוקדמת ביותר**, לא המאוחרת.
--  אחרת מי שמחכה עד ראשון בוחר אחרי שכבר ראה חמישה משחקים —
--  יתרון מידע שהורס את התחרות.

DO $seed$
DECLARE
  v_season UUID;
  v_gw     UUID;
  v_home   UUID;
  v_away   UUID;
  f        RECORD;
BEGIN
  SELECT s.id INTO v_season
    FROM core.seasons s JOIN core.leagues l ON l.id = s.league_id
   ORDER BY s.starts_on DESC NULLS LAST LIMIT 1;
  IF v_season IS NULL THEN
    RAISE NOTICE 'אין עונה במסד — הריצו קודם db/03_seed_squads.sql';
    RETURN;
  END IF;

  INSERT INTO game.gameweeks (season_id, number, code, names, lock_at, first_kickoff_at, status)
  VALUES (v_season, 2, 'gw-2',
          -- `core.i18n_name` הוא DOMAIN מעל JSONB, לא composite:
          -- הוא דורש `{en:{full:…}}`, ו-`ROW(...)` לא מתקמפל אליו.
          jsonb_build_object('he', jsonb_build_object('full', 'מחזור 2'),
                             'en', jsonb_build_object('full', 'Gameweek 2')),
          TIMESTAMPTZ '2026-08-29 20:00:00+03',
          TIMESTAMPTZ '2026-08-29 20:00:00+03',
          'open')
  ON CONFLICT (season_id, number) DO UPDATE
    SET code = 'gw-2',
        lock_at = EXCLUDED.lock_at,
        first_kickoff_at = EXCLUDED.first_kickoff_at
  RETURNING id INTO v_gw;

  FOR f IN
    SELECT * FROM (VALUES
      ('8','12',  TIMESTAMPTZ '2026-08-29 20:00:00+03'),
      ('5','7',   TIMESTAMPTZ '2026-08-29 20:00:00+03'),
      ('13','1',  TIMESTAMPTZ '2026-08-29 20:00:00+03'),
      ('14','2',  TIMESTAMPTZ '2026-08-29 20:00:00+03'),
      ('10','11', TIMESTAMPTZ '2026-08-29 20:00:00+03'),
      ('9','6',   TIMESTAMPTZ '2026-08-30 20:00:00+03'),
      ('3','4',   TIMESTAMPTZ '2026-08-31 20:00:00+03')
    ) AS t(home_ext, away_ext, kickoff)
  LOOP
    v_home := core.team_by_ext(f.home_ext);
    v_away := core.team_by_ext(f.away_ext);
    CONTINUE WHEN v_home IS NULL OR v_away IS NULL;

    INSERT INTO core.weekly_matches (gameweek_id, home_team_id, away_team_id, kickoff_at, status)
    VALUES (v_gw, v_home, v_away, f.kickoff, 'scheduled')
    ON CONFLICT (gameweek_id, home_team_id, away_team_id) DO UPDATE
      SET kickoff_at = EXCLUDED.kickoff_at;
  END LOOP;

  RAISE NOTICE 'מחזור 2 מוכן: %', v_gw;
END
$seed$;

-- =====================================================================
-- בדיקת שפיות אחת שאומרת אם הכל עלה
-- =====================================================================
-- ★ `DROP` ולא `CREATE OR REPLACE`.
--
--   PostgreSQL לא מרשה ל-`CREATE OR REPLACE VIEW` לשנות את
--   רשימת העמודות — רק להוסיף בסוף. מיגרציה מאוחרת שהרחיבה
--   תצוגה, ואז הרצה חוזרת של המיגרציה המוקדמת שמצמצמת אותה
--   בחזרה, נופלת על:
--
--       ERROR: 42P16: cannot drop columns from view
--
--   וזה קורה בפועל: הקבצים אידמפוטנטיים, ולכן טבעי להריץ אותם
--   שוב בסדר כלשהו. `DROP` הופך את הסדר ללא רלוונטי.
DROP VIEW IF EXISTS game.v_health;
CREATE VIEW game.v_health AS
SELECT
  (SELECT count(*) FROM core.teams)                                   AS teams,
  (SELECT count(*) FROM core.players)                                 AS players,
  (SELECT count(*) FROM core.squads WHERE valid_to IS NULL)           AS active_squad_rows,
  (SELECT count(*) FROM game.gameweeks WHERE code IS NOT NULL)        AS coded_gameweeks,
  (SELECT count(*) FROM core.weekly_matches)                          AS matches,
  (SELECT count(*) FROM game.user_lineups)                            AS lineups,
  (SELECT count(*) FROM game.users WHERE is_admin)                    AS admins,
  (SELECT count(*) FROM core.external_refs WHERE provider='manual_json') AS id_mappings;

GRANT SELECT ON game.v_health TO authenticated;
