-- =====================================================================
--  DUBID · מיגרציה 11 — הזירה עוברת לשרת, והאדמין מקבל סגלים
--
--  שני חלקים שאין ביניהם קשר, באותה מיגרציה כי שניהם "מה שנשאר
--  פתוח אחרי 10":
--
--     §1–§4   הזירה — הטבלאות כבר קיימות מ-06, חסרה הפאסאדה
--     §5–§9   סגלים — הוספה, העברה, תמחור, זמינות
--
--  אידמפוטנטי. additive בלבד.
-- =====================================================================

SET search_path = core, game, public;

-- =====================================================================
-- §1 ★ למה הזירה הייתה שבורה בלי שאף אחד ראה
-- =====================================================================
--
--  `db/06` יצר את `game.leagues`, את `game.league_members`, ואת
--  `create_league` / `join_league`. הכל היה שם, מוכן, ועובד.
--
--  והקליינט מעולם לא קרא לו. `src/lib/leagueStore.ts` כתב
--  ל-`localStorage`.
--
--  המשמעות המעשית: זירה שנפתחה בטלפון **לא קיימת** במחשב. שני
--  אנשים שהקלידו את אותו קוד הצטרפו לשתי זירות שונות, כל אחת
--  בדפדפן שלו, כל אחת עם טבלה של איש אחד. זה בדיוק הבאג שתוקן
--  להרכבים ב-09 — הוא פשוט נשאר חי בטאב אחד.
--
--  מה שחסר כדי לסגור אותו הוא לא לוגיקה אלא **קריאה**: שלוש
--  פונקציות שמחזירות את מה שהמסך צריך, בשפה שהוא מדבר.

/**
 * כל הזירות שלי, עם החברים שלהן, בקריאה אחת.
 *
 * ★ למה גם החברים ולא רק הזירות: המסך מציג טבלה, וטבלה בלי
 *   שמות היא רשימת מזהים. שתי קריאות היו יוצרות רגע שבו הזירה
 *   כבר על המסך והחברים עוד לא — כלומר "אין משתתפים" מהבהב.
 */
CREATE OR REPLACE FUNCTION game.my_leagues()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('leagues', '[]'::jsonb, 'members', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'leagues', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',         l.id,
        'name',       l.name,
        'code',       l.code,
        'kind',       l.kind,
        'mode',       l.mode,
        'status',     l.status,
        'ownerId',    l.owner_id,
        'maxMembers', l.max_members,
        'createdAt',  to_char(l.created_at AT TIME ZONE 'UTC',
                              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) ORDER BY l.created_at)
      FROM game.leagues l
      WHERE EXISTS (SELECT 1 FROM game.league_members m
                     WHERE m.league_id = l.id AND m.user_id = v_user)
    ), '[]'::jsonb),

    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'leagueId',    m.league_id,
        'userId',      m.user_id,
        'displayName', COALESCE(u.display_name, 'אלמוני'),
        'joinedAt',    to_char(m.joined_at AT TIME ZONE 'UTC',
                               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) ORDER BY m.joined_at)
      FROM game.league_members m
      LEFT JOIN game.users u ON u.id = m.user_id
      WHERE m.league_id IN (
        SELECT league_id FROM game.league_members WHERE user_id = v_user
      )
    ), '[]'::jsonb)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION game.my_leagues() TO authenticated;

-- =====================================================================
-- §2 הצצה לפי קוד — לפני ההצטרפות
-- =====================================================================
--
--  ★ למה זו פונקציה נפרדת ולא פשוט `join_league`.
--
--  משתמש שמקליד קוד רוצה לדעת לאן הוא נכנס **לפני** שהוא נכנס.
--  "הצטרפת לזירה של אנשים שלא הכרת" הוא לא מצב שאפשר לבטל בנוחות
--  — המייסד כבר רואה אותך בטבלה.
--
--  הפונקציה מחזירה רק שם, מצב ומספר משתתפים. לא שמות, לא הרכבים,
--  ולא מי המייסד: מי שיש לו קוד תקף עוד אינו חבר.
CREATE OR REPLACE FUNCTION game.league_by_code(p_code TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, public AS $$
  SELECT jsonb_build_object(
    'name',       l.name,
    'mode',       l.mode,
    'kind',       l.kind,
    'status',     l.status,
    'members',    (SELECT count(*) FROM game.league_members WHERE league_id = l.id),
    'maxMembers', l.max_members
  )
  FROM game.leagues l
  WHERE l.code = upper(btrim(p_code));
$$;
GRANT EXECUTE ON FUNCTION game.league_by_code(TEXT) TO anon, authenticated;

-- =====================================================================
-- §3 יציאה מזירה
-- =====================================================================
--
--  ★ המייסד לא יכול לצאת.
--
--  זירה בלי מייסד היא זירה שאף אחד לא יכול לסגור, לנהל, או
--  להסביר. הכלל הזה כבר קיים בקליינט (`leaveLeague`), והוא חוזר
--  כאן כי כלל שנאכף רק בדפדפן אינו כלל.
CREATE OR REPLACE FUNCTION game.leave_league(p_league_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_user UUID := auth.uid(); v_owner UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  SELECT owner_id INTO v_owner FROM game.leagues WHERE id = p_league_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'LEAGUE_NOT_FOUND'; END IF;
  IF v_owner = v_user THEN RAISE EXCEPTION 'OWNER_CANNOT_LEAVE'; END IF;

  DELETE FROM game.league_members
   WHERE league_id = p_league_id AND user_id = v_user;
  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION game.leave_league(UUID) TO authenticated;

-- =====================================================================
-- §4 RLS לזירות
-- =====================================================================
DO $rls$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN RETURN; END IF;

  ALTER TABLE game.leagues        ENABLE ROW LEVEL SECURITY;
  ALTER TABLE game.league_members ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS leagues_member_read ON game.leagues;
  -- ★ רואים רק זירות שאני חבר בהן. רשימת כל הזירות במוצר היא
  --   רשימת כל קבוצות החברים של כל המשתמשים.
  CREATE POLICY leagues_member_read ON game.leagues FOR SELECT
    USING (EXISTS (SELECT 1 FROM game.league_members m
                    WHERE m.league_id = id AND m.user_id = auth.uid()));

  DROP POLICY IF EXISTS league_members_read ON game.league_members;
  CREATE POLICY league_members_read ON game.league_members FOR SELECT
    USING (EXISTS (SELECT 1 FROM game.league_members mine
                    WHERE mine.league_id = league_id AND mine.user_id = auth.uid()));
END
$rls$;

-- =====================================================================
-- §5 ★ סגלים — מה האדמין באמת צריך
-- =====================================================================
--
--  עד עכשיו הסגלים היו קובץ: `src/data/squads.ts`, 112kb שנבנו
--  בסקריפט. זה עבד כל עוד אף אחד לא עבר קבוצה באמצע העונה.
--
--  ארבע הפעולות שקורות בעולם האמיתי, ואף אחת מהן לא הייתה אפשרית:
--
--     שחקן חדש נחתם          →  admin_upsert_player
--     שחקן עבר קבוצה         →  admin_move_player
--     המחיר לא מאוזן         →  admin_set_price
--     פציעה / הרחקה / עזיבה  →  admin_set_player_status
--
--  ★ שום פעולה לא מוחקת. `core.squads` הוא היסטוריה עם
--    `valid_from`/`valid_to`: מעבר קבוצה סוגר שורה ופותח חדשה.
--    הרכב שהוגש לפני המעבר עדיין יודע מאיזו קבוצה השחקן היה,
--    כי הוא שמר snapshot משלו (`user_lineup_slots.team_id`).
--    מחיקה אמיתית הייתה משכתבת היסטוריה של תחרות שכבר נגמרה.

/**
 * מזהה חיצוני חדש לשחקן.
 *
 * ★ הפורמט קיים ואי אפשר לשנות אותו: `src/data/squads.ts` בנוי
 *   מ-`T<n>` ו-`P<n>`, והקליינט חותך את האות. שחקן חדש חייב
 *   לקבל מספר באותו מרחב, אחרת הוא לא ניתן לבחירה.
 *
 * המספר הוא <קבוצה>×100 + הרץ, בדיוק כמו הסיד (T3 → 301, 302…).
 */
CREATE OR REPLACE FUNCTION core.next_player_ext(p_team_ext TEXT)
RETURNS TEXT
LANGUAGE sql STABLE
SET search_path = core, public AS $$
  SELECT (p_team_ext::INT * 100 + COALESCE(MAX(
            CASE WHEN x.external_id ~ '^[0-9]+$'
                 AND x.external_id::INT / 100 = p_team_ext::INT
                 THEN x.external_id::INT % 100 END), 0) + 1)::TEXT
  FROM core.external_refs x
  WHERE x.provider = 'manual_json' AND x.entity_type = 'player';
$$;

/**
 * הוספה או עריכה של שחקן.
 *
 * `p_ext_player = NULL` → שחקן חדש. אחרת עריכה של קיים.
 * מחזיר את המזהה החיצוני, כדי שהמסך יוכל לבחור אותו מיד.
 */
CREATE OR REPLACE FUNCTION game.admin_upsert_player(
  p_ext_team   TEXT,
  p_name_he    TEXT,
  p_ext_player TEXT DEFAULT NULL,
  p_name_en    TEXT DEFAULT NULL,
  p_position   TEXT DEFAULT 'MID',
  p_price      NUMERIC DEFAULT NULL,
  p_shirt      SMALLINT DEFAULT NULL,
  p_status     TEXT DEFAULT 'active'
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE
  v_team   UUID;
  v_player UUID;
  v_ext    TEXT := NULLIF(btrim(COALESCE(p_ext_player, '')), '');
  v_season UUID;
  v_pos    core."position";
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF btrim(COALESCE(p_name_he, '')) = '' THEN RAISE EXCEPTION 'NAME_REQUIRED'; END IF;

  v_team := core.team_by_ext(p_ext_team);
  IF v_team IS NULL THEN RAISE EXCEPTION 'TEAM_NOT_FOUND: %', p_ext_team; END IF;

  v_pos := p_position::core."position";

  SELECT s.id INTO v_season FROM core.seasons s ORDER BY s.starts_on DESC NULLS LAST LIMIT 1;
  IF v_season IS NULL THEN RAISE EXCEPTION 'NO_SEASON'; END IF;

  IF v_ext IS NULL THEN
    -- ------- שחקן חדש -------
    v_ext := core.next_player_ext(p_ext_team);

    INSERT INTO core.players (names, primary_position)
    VALUES (jsonb_build_object(
              'he', jsonb_build_object('full', btrim(p_name_he)),
              -- אנגלית חובה ב-DOMAIN. אם לא סופקה — העברית משמשת
              -- כעוגן, וזה עדיף על לחסום הוספת שחקן.
              'en', jsonb_build_object('full',
                      COALESCE(NULLIF(btrim(p_name_en), ''), btrim(p_name_he)))),
            v_pos)
    RETURNING id INTO v_player;

    INSERT INTO core.external_refs (provider, entity_type, external_id, entity_id)
    VALUES ('manual_json', 'player', v_ext, v_player);

    INSERT INTO core.squads
      (season_id, team_id, player_id, position, fantasy_price, shirt_number, status)
    VALUES (v_season, v_team, v_player, v_pos, p_price, p_shirt, p_status);

  ELSE
    -- ------- עריכה -------
    v_player := core.player_by_ext(v_ext);
    IF v_player IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND: %', v_ext; END IF;

    UPDATE core.players SET
      names = jsonb_build_object(
                'he', jsonb_build_object('full', btrim(p_name_he)),
                'en', jsonb_build_object('full',
                        COALESCE(NULLIF(btrim(p_name_en), ''),
                                 names #>> '{en,full}', btrim(p_name_he)))),
      primary_position = v_pos,
      updated_at = now()
    WHERE id = v_player;

    UPDATE core.squads SET
      position      = v_pos,
      fantasy_price = COALESCE(p_price, fantasy_price),
      shirt_number  = COALESCE(p_shirt, shirt_number),
      status        = p_status
    WHERE player_id = v_player AND valid_to IS NULL;
  END IF;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (auth.uid()::TEXT, 'admin_upsert_player', 'player', v_ext,
          jsonb_build_object('team', p_ext_team, 'name', p_name_he,
                             'pos', p_position, 'price', p_price, 'status', p_status));

  RETURN v_ext;
END;
$$;
GRANT EXECUTE ON FUNCTION
  game.admin_upsert_player(TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC,SMALLINT,TEXT) TO authenticated;

/**
 * העברת שחקן לקבוצה אחרת.
 *
 * ★ סוגר שורה ופותח חדשה — לא מעדכן במקום.
 *
 * `UPDATE squads SET team_id = …` היה משכתב את העבר: שאילתה על
 * מחזור 2 הייתה מחזירה את הקבוצה החדשה, וההרכבים היו נראים כאילו
 * הפרו את הכלל "אחד מכל קבוצה". שתי שורות עם תאריכים שומרות על
 * שתי האמיתות.
 */
CREATE OR REPLACE FUNCTION game.admin_move_player(p_ext_player TEXT, p_ext_team TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_player UUID; v_team UUID; v_old core.squads;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  v_player := core.player_by_ext(p_ext_player);
  v_team   := core.team_by_ext(p_ext_team);
  IF v_player IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND'; END IF;
  IF v_team   IS NULL THEN RAISE EXCEPTION 'TEAM_NOT_FOUND'; END IF;

  SELECT * INTO v_old FROM core.squads
   WHERE player_id = v_player AND valid_to IS NULL
   ORDER BY valid_from DESC LIMIT 1;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_IN_SQUAD'; END IF;
  IF v_old.team_id = v_team THEN RETURN; END IF;   -- כבר שם

  UPDATE core.squads SET valid_to = CURRENT_DATE WHERE id = v_old.id;

  INSERT INTO core.squads
    (season_id, team_id, player_id, position, fantasy_price, shirt_number, status,
     valid_from)
  VALUES (v_old.season_id, v_team, v_player, v_old.position, v_old.fantasy_price,
          NULL, 'active', CURRENT_DATE)
  -- אותו יום, אותה קבוצה, פעמיים — למשל תיקון של טעות. לא נופלים.
  ON CONFLICT (season_id, team_id, player_id, valid_from) DO UPDATE
    SET valid_to = NULL, status = 'active';

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, old_value, new_value)
  VALUES (auth.uid()::TEXT, 'admin_move_player', 'player', p_ext_player,
          jsonb_build_object('team', v_old.team_id),
          jsonb_build_object('team', p_ext_team));
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_move_player(TEXT,TEXT) TO authenticated;

/** מחיר. הפעולה שהכי הרבה תיעשה, ולכן היא פונקציה משלה. */
CREATE OR REPLACE FUNCTION game.admin_set_price(p_ext_player TEXT, p_price NUMERIC)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_player UUID;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF p_price IS NULL OR p_price < 0 OR p_price > 99 THEN RAISE EXCEPTION 'PRICE_RANGE'; END IF;

  v_player := core.player_by_ext(p_ext_player);
  IF v_player IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND'; END IF;

  UPDATE core.squads SET fantasy_price = p_price
   WHERE player_id = v_player AND valid_to IS NULL;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (auth.uid()::TEXT, 'admin_set_price', 'player', p_ext_player,
          jsonb_build_object('price', p_price));
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_set_price(TEXT,NUMERIC) TO authenticated;

/**
 * זמינות: פציעה, הרחקה, השאלה, עזיבה.
 *
 * ★ `left` סוגר את שורת הסגל. השאר לא — שחקן פצוע הוא עדיין
 *   בסגל, והוא צריך להופיע בבחירה עם סימון ולא להיעלם. שחקן
 *   שנעלם מהרשימה נראה כמו באג בדאטה.
 */
CREATE OR REPLACE FUNCTION game.admin_set_player_status(p_ext_player TEXT, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_player UUID;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF p_status NOT IN ('active','injured','suspended','loaned_out','left') THEN
    RAISE EXCEPTION 'BAD_STATUS: %', p_status;
  END IF;

  v_player := core.player_by_ext(p_ext_player);
  IF v_player IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND'; END IF;

  UPDATE core.squads
     SET status   = p_status,
         valid_to = CASE WHEN p_status = 'left' THEN CURRENT_DATE ELSE NULL END
   WHERE player_id = v_player AND valid_to IS NULL;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (auth.uid()::TEXT, 'admin_set_player_status', 'player', p_ext_player,
          jsonb_build_object('status', p_status));
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_set_player_status(TEXT,TEXT) TO authenticated;

-- =====================================================================
-- §6 הסגל כפי שהאדמין רואה אותו
-- =====================================================================
--
--  ★ קריאה אחת לכל הליגה, ולא אחת לכל קבוצה.
--
--  14 קבוצות × 25 שחקנים = 350 שורות, כ-40kb. זה פחות מתמונה
--  אחת, והוא חוסך 14 הלוך-ושוב ו-14 מצבי טעינה במסך אחד.
CREATE OR REPLACE FUNCTION game.admin_squads()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = core, game, public
AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(t ORDER BY t->>'teamId')
    FROM (
      SELECT jsonb_build_object(
        'teamId', 'T' || xt.external_id,
        'nameHe', tm.name_he,
        'short',  COALESCE(tm.short_name, tm.name_he),
        'players', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id',       'P' || xp.external_id,
            'nameHe',   pl.name_he,
            'nameEn',   pl.name_en,
            'position', sq.position,
            'price',    sq.fantasy_price,
            'shirt',    sq.shirt_number,
            'status',   sq.status
          ) ORDER BY sq.position, pl.name_he)
          FROM core.squads sq
          JOIN core.players pl  ON pl.id = sq.player_id
          JOIN core.v_ext  xp   ON xp.entity_type = 'player' AND xp.entity_id = sq.player_id
          WHERE sq.team_id = tm.id AND sq.valid_to IS NULL
        ), '[]'::jsonb)
      ) AS t
      FROM core.teams tm
      JOIN core.v_ext xt ON xt.entity_type = 'team' AND xt.entity_id = tm.id
    ) q
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_squads() TO authenticated;

-- =====================================================================
-- §7 בדיקת בריאות
-- =====================================================================
CREATE OR REPLACE VIEW game.v_arena_health AS
SELECT
  (SELECT count(*) FROM game.leagues)                          AS leagues,
  (SELECT count(*) FROM game.league_members)                   AS memberships,
  (SELECT count(*) FROM game.leagues l
    WHERE NOT EXISTS (SELECT 1 FROM game.league_members m
                       WHERE m.league_id = l.id AND m.user_id = l.owner_id))
                                                               AS orphan_leagues,
  (SELECT count(*) FROM core.squads WHERE valid_to IS NULL)    AS active_squad_rows,
  (SELECT count(*) FROM core.squads
    WHERE valid_to IS NULL AND fantasy_price IS NULL)          AS players_without_price;

GRANT SELECT ON game.v_arena_health TO authenticated;

-- =====================================================================
-- §8 ★★ התקציב — אילוץ שהיה קיים רק בדפדפן ★★
-- =====================================================================
--
--  ★ מה נמצא
--
--  דוביד 5 מוגבל ל-15 מיליון. הפס במסך עובד, המספר נכון, והכפתור
--  ננעל בחריגה. וזה **כל** מה שהיה: `submit_entry` לא בדק תקציב
--  בכלל, ו-`core.squads.fantasy_price` היה NULL ל-351 השחקנים
--  (הסיד הכיל `price` ולא מיפה אותו — תוקן ב-`db/03`).
--
--  כלומר: מי ששלח בקשה ישירות ל-API — לא צריך יותר מ-DevTools —
--  יכול היה להגיש חמישה שחקנים במחיר מלא ולנצח מחזור. באיזון של
--  1–5 מיליון, זה ההבדל בין הרכב חוקי לבין הרכב שאין מולו סיכוי.
--
--  ★ למה זה קריטי דווקא עכשיו
--
--  כל עוד הכל היה ב-localStorage, "לרמות" פירושו לשנות מספר
--  בדפדפן שלך ולראות אותו בדפדפן שלך. ברגע שיש דירוג משותף, אותה
--  פעולה משנה את הטבלה של כולם.
--
--  הכלל: **כל אילוץ תחרותי חייב להיאכף בשרת.** הפס במסך הוא
--  נוחות; זה כאן הוא החוק.

CREATE TABLE IF NOT EXISTS game.mode_config (
  mode        TEXT PRIMARY KEY CHECK (mode IN ('five','full')),
  budget      NUMERIC(6,2),        -- NULL = בלי תקציב
  lineup_size SMALLINT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ★ דאטה ולא קבוע בקוד: איזון מחדש הוא UPDATE, לא פריסה.
INSERT INTO game.mode_config (mode, budget, lineup_size) VALUES
  ('five', 15, 5),
  ('full', NULL, 11)
ON CONFLICT (mode) DO NOTHING;

GRANT SELECT ON game.mode_config TO anon, authenticated;

/**
 * `submit_entry` — אותה חתימה, פלוס בדיקת תקציב.
 *
 * מוגדרת מחדש כאן ולא נערכת ב-09: מיגרציות רצות בסדר, והגרסה
 * האחרונה מנצחת. עריכה של קובץ שכבר רץ על ייצור היא הדרך לקבל
 * שני מסדים שחושבים שהם זהים.
 */
CREATE OR REPLACE FUNCTION game.submit_entry(
  p_gw_code   TEXT,
  p_mode      TEXT,
  p_formation TEXT,
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
  v_price    NUMERIC(6,2);
  v_captains INT;
  v_vices    INT;
  v_count    INT;
  v_cfg      game.mode_config;
  v_spent    NUMERIC(8,2) := 0;
BEGIN
  IF v_auth IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_mode NOT IN ('five','full') THEN RAISE EXCEPTION 'INVALID_MODE'; END IF;
  IF jsonb_typeof(p_slots) <> 'array' THEN RAISE EXCEPTION 'INVALID_SLOTS'; END IF;

  PERFORM game.ensure_profile(p_display_name);

  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code FOR UPDATE;
  IF v_gw.id IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND: %', p_gw_code; END IF;
  IF v_gw.status NOT IN ('open','draft') THEN RAISE EXCEPTION 'GAMEWEEK_LOCKED'; END IF;
  IF now() >= v_gw.lock_at THEN RAISE EXCEPTION 'DEADLINE_PASSED'; END IF;

  SELECT * INTO v_cfg FROM game.mode_config WHERE mode = p_mode;

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
        submitted_at = now()
  RETURNING * INTO v_lineup;

  DELETE FROM game.user_lineup_slots WHERE lineup_id = v_lineup.id;

  FOR v_slot IN SELECT * FROM jsonb_array_elements(p_slots) LOOP
    v_player := core.player_by_ext(v_slot->>'ext_player_id');
    IF v_player IS NULL THEN
      RAISE EXCEPTION 'PLAYER_NOT_FOUND: %', v_slot->>'ext_player_id';
    END IF;

    -- ★ הקבוצה, העמדה והשווי נלקחים מהמסד — לא מהקליינט.
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

    v_spent := v_spent + v_price;

    INSERT INTO game.user_lineup_slots
      (lineup_id, slot_no, player_id, team_id, position, price, is_captain, is_vice, is_bench)
    VALUES (
      v_lineup.id, (v_slot->>'slot_no')::SMALLINT, v_player, v_team, v_position, v_price,
      COALESCE((v_slot->>'is_captain')::BOOLEAN, FALSE),
      COALESCE((v_slot->>'is_vice')::BOOLEAN, FALSE),
      COALESCE((v_slot->>'is_bench')::BOOLEAN, FALSE)
    );
  END LOOP;

  -- ★★ התקציב. אחרי שכל המחירים נקראו מהמסד, ולפני ההחזרה.
  --    ה-EXCEPTION מגלגל את כל הטרנזקציה — כולל ההרכב שכבר נכתב.
  IF v_cfg.budget IS NOT NULL AND v_spent > v_cfg.budget THEN
    RAISE EXCEPTION 'OVER_BUDGET: % > %', v_spent, v_cfg.budget;
  END IF;

  RETURN jsonb_build_object(
    'id', v_lineup.id, 'gameweek', p_gw_code, 'mode', p_mode,
    'spent', v_spent, 'budget', v_cfg.budget,
    'submitted_at', v_lineup.submitted_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION game.submit_entry(TEXT, TEXT, TEXT, JSONB, TEXT) TO authenticated;

-- =====================================================================
-- §9 ★★ אותו באג, בעמודה אחרת: `referral_code` ★★
-- =====================================================================
--
--  ★ איך זה נמצא
--
--  בדיקת הזירות (`db/tests/03`) יצרה שלושה משתמשים עם UUID
--  שמתחילים ב-`e0000000`. ההרשמה **השנייה נכשלה**:
--
--      ERROR: duplicate key value violates unique constraint
--             "users_referral_code_key"
--      Key (referral_code)=(E0000000) already exists.
--
--  ★ למה זה לא רק בעיה של הבדיקה
--
--  `referral_code` נגזר מ-`left(uuid, 8)` והוא `UNIQUE`. שמונה
--  תווים הקסדצימליים הם 2^32 אפשרויות, ובפרדוקס יום ההולדת
--  ההסתברות להתנגשות עוברת 50% סביב **77,000 משתמשים**. בעשרות
--  אלפים היא כבר לא זניחה.
--
--  וההתנגשות אינה "שני אנשים עם אותו קוד" — היא **ההרשמה
--  נכשלת לגמרי**, כי ה-INSERT נופל. אותו כשל בדיוק שתוקן לשמות
--  המשתמש ב-`db/10` §2, בעמודה שנשכחה.
--
--  ★ התיקון: אותה סולם שלוש־דרגות, ומאותה סיבה.
--     8 תווים → 12 תווים → ה-UUID המלא (ייחודי בהגדרה).
--
--  ⚠ קודים קיימים לא משתנים. מי שכבר שיתף את הקוד שלו ממשיך
--    לעבוד — שינוי רטרואקטיבי היה שובר קישורי הזמנה חיים.

CREATE OR REPLACE FUNCTION game.users_referral_dedupe()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = game, public
AS $$
DECLARE v_hex TEXT; v_try TEXT;
BEGIN
  v_hex := upper(replace(NEW.id::TEXT, '-', ''));

  v_try := COALESCE(NULLIF(btrim(NEW.referral_code), ''), left(v_hex, 8));
  IF NOT EXISTS (SELECT 1 FROM game.users
                  WHERE referral_code = v_try AND id <> NEW.id) THEN
    NEW.referral_code := v_try;
    RETURN NEW;
  END IF;

  v_try := left(v_hex, 12);
  IF NOT EXISTS (SELECT 1 FROM game.users
                  WHERE referral_code = v_try AND id <> NEW.id) THEN
    NEW.referral_code := v_try;
    RETURN NEW;
  END IF;

  NEW.referral_code := v_hex;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_referral_dedupe ON game.users;
-- INSERT בלבד, כמו הטריגר של שם המשתמש: קוד קיים לא זז.
CREATE TRIGGER users_referral_dedupe
  BEFORE INSERT ON game.users
  FOR EACH ROW EXECUTE FUNCTION game.users_referral_dedupe();

-- ---------------------------------------------------------------------
-- יישור שורות קיימות שנוצרו לפני הטריגר
-- ---------------------------------------------------------------------
DO $fix$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM game.users u
     WHERE u.referral_code IS NULL
        OR EXISTS (SELECT 1 FROM game.users o
                    WHERE o.referral_code = u.referral_code AND o.id < u.id)
  LOOP
    UPDATE game.users
       SET referral_code = upper(replace(r.id::TEXT, '-', ''))
     WHERE id = r.id;
  END LOOP;
END
$fix$;

-- ---------------------------------------------------------------------
-- בדיקת בריאות מורחבת
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW game.v_accounts_health AS
SELECT
  count(*)                                             AS users_total,
  count(*) FILTER (WHERE is_guest)                     AS guests,
  count(*) FILTER (WHERE NOT is_guest)                 AS registered,
  count(*) FILTER (WHERE offsides_user_id IS NOT NULL) AS linked_to_offsides,
  count(*) FILTER (WHERE username IS NULL)             AS missing_username,
  count(*) - count(DISTINCT username)                  AS duplicate_usernames,
  count(*) FILTER (WHERE referral_code IS NULL)        AS missing_referral,
  count(*) - count(DISTINCT referral_code)             AS duplicate_referral
FROM game.users;

GRANT SELECT ON game.v_accounts_health TO authenticated;
