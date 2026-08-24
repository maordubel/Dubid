-- =====================================================================
--  Dubid · מיגרציה 05 — מחזור מלא + נעילה סמכותית בצד שרת
--
--  ★ זו המיגרציה שהופכת את דוביד למשחק תחרותי הוגן.
--
--  עד כה הנעילה הייתה בקליינט בלבד. משמעות מעשית: מי שהזיז את
--  שעון המכשיר, או שלח בקשה ישירות ל-API, יכול היה להגיש הרכב
--  אחרי שראה את ההרכבים של האחרים. זו לא "בעיית UX" — זו פרצה
--  שמבטלת את התחרות.
--
--  הדפוס לקוח מ-OFFSIDES (`submit_bet` ב-patch-v18.9.69): פונקציית
--  SECURITY DEFINER היא **נתיב הכתיבה היחיד**. הקליינט לא כותב
--  לטבלה ישירות — לא כי הוא מנומס, אלא כי RLS לא מרשה לו.
--
--  אידמפוטנטי. additive בלבד. אפשר להריץ על production חי.
-- =====================================================================

SET search_path = core, game, public;

-- ---------------------------------------------------------------------
-- 1. מחזור: מחזור חיים מלא
-- ---------------------------------------------------------------------
--   DRAFT → OPEN → LOCKED → LIVE → SCORING → PUBLISHED → ARCHIVED
--
-- הערכים הישנים ממופים: upcoming → draft, settled → published.
-- מרחיבים את ה-CHECK *לפני* המיפוי, אחרת העדכון עצמו ייפסל.

ALTER TABLE game.gameweeks DROP CONSTRAINT IF EXISTS gameweeks_status_check;
ALTER TABLE game.gameweeks ADD CONSTRAINT gameweeks_status_check
  CHECK (status IN (
    'upcoming','settled',                                   -- ישן, בדרך החוצה
    'draft','open','locked','live','scoring','published','archived'
  ));

UPDATE game.gameweeks SET status = 'draft'     WHERE status = 'upcoming';
UPDATE game.gameweeks SET status = 'published' WHERE status = 'settled';

-- עכשיו אפשר לצמצם לערכים החוקיים בלבד.
ALTER TABLE game.gameweeks DROP CONSTRAINT IF EXISTS gameweeks_status_check;
ALTER TABLE game.gameweeks ADD CONSTRAINT gameweeks_status_check
  CHECK (status IN ('draft','open','locked','live','scoring','published','archived'));

ALTER TABLE game.gameweeks
  -- `lock_at` נשאר מקור האמת לדדליין. העמודה הזו היא נוחות קריאה.
  ADD COLUMN IF NOT EXISTS first_kickoff_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_at     TIMESTAMPTZ;

-- ---------------------------------------------------------------------
-- 2. הרכב: מצב משחק + snapshot מלא
-- ---------------------------------------------------------------------
ALTER TABLE game.user_lineups
  -- ★ בלי זה אי אפשר להחזיק שני מצבי משחק לאותו משתמש באותו מחזור.
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'five'
    CHECK (mode IN ('five','full'));

-- הרכב אחד למשתמש **לכל מצב** — לא אחד למחזור.
ALTER TABLE game.user_lineups DROP CONSTRAINT IF EXISTS user_lineups_user_id_gameweek_id_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_lineups_user_gw_mode_key'
  ) THEN
    ALTER TABLE game.user_lineups
      ADD CONSTRAINT user_lineups_user_gw_mode_key UNIQUE (user_id, gameweek_id, mode);
  END IF;
END $$;

-- ★ §10 — snapshot של השחקן ברגע ההגשה.
--   שווי שחקן משתנה במהלך העונה. בלי הקפאה, הרכב מלפני חודש
--   "יתייקר" רטרואקטיבית ויֵראה כאילו חרג מהתקציב. ההיסטוריה
--   חייבת להישאר נכונה לרגע שבו היא נוצרה.
ALTER TABLE game.user_lineup_slots
  ADD COLUMN IF NOT EXISTS price NUMERIC(5,1) NOT NULL DEFAULT 0;

COMMENT ON COLUMN game.user_lineup_slots.price IS
  'שווי השחקן ברגע ההגשה. קפוא. שינוי מחיר מאוחר לא נוגע בהרכב היסטורי.';

-- ---------------------------------------------------------------------
-- 3. זמן שרת — ל-serverTime.ts בקליינט
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.server_now()
RETURNS BIGINT LANGUAGE sql STABLE AS $$
  SELECT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT;
$$;

GRANT EXECUTE ON FUNCTION public.server_now() TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. ★ הגשת הרכב — נתיב הכתיבה היחיד
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION game.submit_lineup(
  p_gameweek_id UUID,
  p_mode        TEXT,
  p_formation   TEXT,
  -- [{slot_no, player_id, is_captain, is_vice, is_bench}, ...]
  p_slots       JSONB
)
RETURNS game.user_lineups
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE
  v_user     UUID := auth.uid();
  v_gw       game.gameweeks;
  v_lineup   game.user_lineups;
  v_slot     JSONB;
  v_player   core.players;
  v_team     UUID;
  v_position core."position";
  v_price    NUMERIC(5,1);
  v_captains INT;
  v_vices    INT;
  v_count    INT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_mode NOT IN ('five','full') THEN RAISE EXCEPTION 'INVALID_MODE'; END IF;
  IF jsonb_typeof(p_slots) <> 'array' THEN RAISE EXCEPTION 'INVALID_SLOTS'; END IF;

  -- ★★ הנעילה. שתי בדיקות, ושתיהן חייבות לעבור. ★★
  --
  --  1. הסטטוס — אדמין יכול לנעול מוקדם.
  --  2. `now()` של המסד מול lock_at — cron יכול לאחר בדקה, ובדקה
  --     הזו אסור שתתקבל הגשה. שעון המסד הוא היחיד שקובע.
  --
  --  שום דבר מהקליינט לא משתתף בהחלטה הזו.
  SELECT * INTO v_gw FROM game.gameweeks WHERE id = p_gameweek_id FOR UPDATE;
  IF v_gw.id IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND'; END IF;
  IF v_gw.status <> 'open' THEN RAISE EXCEPTION 'GAMEWEEK_LOCKED'; END IF;
  IF now() >= v_gw.lock_at THEN RAISE EXCEPTION 'DEADLINE_PASSED'; END IF;

  v_count := jsonb_array_length(p_slots);
  IF p_mode = 'five' AND v_count <> 5  THEN RAISE EXCEPTION 'LINEUP_SIZE'; END IF;
  IF p_mode = 'full' AND v_count <> 11 THEN RAISE EXCEPTION 'LINEUP_SIZE'; END IF;

  -- קפטן אחד בדיוק; סגן אחד לכל היותר.
  SELECT count(*) FILTER (WHERE (s->>'is_captain')::BOOLEAN),
         count(*) FILTER (WHERE (s->>'is_vice')::BOOLEAN)
    INTO v_captains, v_vices
    FROM jsonb_array_elements(p_slots) s;
  IF v_captains <> 1 THEN RAISE EXCEPTION 'CAPTAIN_REQUIRED'; END IF;
  IF v_vices > 1     THEN RAISE EXCEPTION 'VICE_DUPLICATE'; END IF;

  -- upsert ההרכב עצמו
  INSERT INTO game.user_lineups (user_id, gameweek_id, mode, formation, status, submitted_at)
  VALUES (v_user, p_gameweek_id, p_mode, p_formation, 'submitted', now())
  ON CONFLICT (user_id, gameweek_id, mode) DO UPDATE
    SET formation    = EXCLUDED.formation,
        status       = 'submitted',
        -- ★ החותמת מתעדכנת בכל הגשה מחדש. היא שובר השוויון האחרון,
        --   ולכן חייבת לשקף את ההגשה שנספרת בפועל ולא את הראשונה.
        submitted_at = now()
  RETURNING * INTO v_lineup;

  -- משבצות נכתבות מאפס בכל הגשה
  DELETE FROM game.user_lineup_slots WHERE lineup_id = v_lineup.id;

  FOR v_slot IN SELECT * FROM jsonb_array_elements(p_slots) LOOP
    SELECT * INTO v_player FROM core.players WHERE id = (v_slot->>'player_id')::UUID;
    IF v_player.id IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND: %', v_slot->>'player_id'; END IF;

    -- ★ הקבוצה, העמדה והשווי נלקחים מהמסד — לא מהקליינט.
    --   קליינט שישלח price=0 לא יקבל שחקן בחינם.
    --
    -- ★★ תוקן אחרי הרצה על מסד אמיתי ★★
    --
    --  הגרסה הקודמת קראה ל-`v_player.position` ול-`squads.price`.
    --  שתי העמודות לא קיימות: בשחקן העמודה היא `primary_position`,
    --  ובסגל היא `position`; המחיר הוא `fantasy_price`.
    --
    --  התוצאה הייתה ש**נתיב הכתיבה היחיד של הרכבים קרס תמיד**:
    --    ERROR: record "v_player" has no field "position"
    --
    --  הנעילה עצמה עבדה (הגשה אחרי הדדליין נדחתה כראוי), ולכן
    --  הבדיקה השטחית עברה — אבל אף הרכב תקין לא יכול היה להישמר.
    --  בדיקה שבודקת רק את מקרה הכישלון מפספסת בדיוק את זה.
    --
    --  העמדה נלקחת מ**שורת הסגל** ולא מהשחקן, וזה גם נכון יותר:
    --  שחקן יכול לשחק בעמדה אחת בקבוצה אחת ובאחרת במקום אחר.
    --  שורת הסגל היא האמת לעונה הזו.
    SELECT sq.team_id, sq.position, COALESCE(sq.fantasy_price, 0)
      INTO v_team, v_position, v_price
      FROM core.squads sq
     WHERE sq.player_id = v_player.id
       AND sq.season_id = (SELECT season_id FROM game.gameweeks WHERE id = p_gameweek_id)
       AND sq.valid_to IS NULL          -- שורת הסגל הפעילה בלבד
       AND sq.status   = 'active'
     ORDER BY sq.valid_from DESC
     LIMIT 1;
    IF v_team IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_IN_SQUAD: %', v_player.id; END IF;

    INSERT INTO game.user_lineup_slots
      (lineup_id, slot_no, player_id, team_id, position, price,
       is_captain, is_vice, is_bench)
    VALUES (
      v_lineup.id,
      (v_slot->>'slot_no')::SMALLINT,
      v_player.id,
      v_team,
      v_position,
      v_price,
      COALESCE((v_slot->>'is_captain')::BOOLEAN, FALSE),
      COALESCE((v_slot->>'is_vice')::BOOLEAN, FALSE),
      COALESCE((v_slot->>'is_bench')::BOOLEAN, FALSE)
    );
  END LOOP;

  -- האילוצים one_player_per_team / no_duplicate_player נאכפים
  -- על ידי המסד עצמו ויזרקו כאן אם הופרו. שכבת הגנה שלישית.

  RETURN v_lineup;
END;
$$;

GRANT EXECUTE ON FUNCTION game.submit_lineup(UUID, TEXT, TEXT, JSONB) TO authenticated;

-- ---------------------------------------------------------------------
-- 5. מעבר מצב מבוקר — לאדמין ול-cron
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION game.set_gameweek_status(
  p_gameweek_id UUID,
  p_status      TEXT,
  p_actor       TEXT DEFAULT 'system',
  p_reason      TEXT DEFAULT NULL
)
RETURNS game.gameweeks
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE
  v_gw  game.gameweeks;
  v_ok  BOOLEAN;
BEGIN
  SELECT * INTO v_gw FROM game.gameweeks WHERE id = p_gameweek_id FOR UPDATE;
  IF v_gw.id IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND'; END IF;

  -- ★ אותה מפת מעברים בדיוק שב-`src/lib/gameweek.ts`.
  --   שתי רשימות שאמורות להיות זהות הן חוב טכני מוכר; הן קטנות,
  --   יציבות, ומכוסות בבדיקה שמשווה ביניהן.
  v_ok := CASE v_gw.status
    WHEN 'draft'     THEN p_status = 'open'
    WHEN 'open'      THEN p_status IN ('locked','draft')
    WHEN 'locked'    THEN p_status IN ('live','open')
    WHEN 'live'      THEN p_status = 'scoring'
    WHEN 'scoring'   THEN p_status IN ('published','live')
    WHEN 'published' THEN p_status IN ('archived','scoring')
    ELSE FALSE
  END;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: % -> %', v_gw.status, p_status;
  END IF;

  UPDATE game.gameweeks
     SET status = p_status,
         published_at = CASE WHEN p_status = 'published' THEN now() ELSE published_at END
   WHERE id = p_gameweek_id
   RETURNING * INTO v_gw;

  INSERT INTO game.audit_logs (actor, entity, entity_id, action, old_value, new_value, reason)
  VALUES (p_actor, 'gameweek', p_gameweek_id::TEXT, 'status_change',
          jsonb_build_object('status', v_gw.status),
          jsonb_build_object('status', p_status),
          p_reason);

  RETURN v_gw;
END;
$$;

-- ---------------------------------------------------------------------
-- 6. RLS — הקליינט קורא, רק הפונקציות כותבות
-- ---------------------------------------------------------------------
ALTER TABLE game.user_lineups      ENABLE ROW LEVEL SECURITY;
ALTER TABLE game.user_lineup_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lineups_owner_read ON game.user_lineups;
CREATE POLICY lineups_owner_read ON game.user_lineups
  FOR SELECT USING (
    user_id = auth.uid()
    -- הרכב של אחרים נחשף רק אחרי הנעילה. לפני כן זו העתקה.
    OR EXISTS (
      SELECT 1 FROM game.gameweeks g
       WHERE g.id = gameweek_id
         AND g.status IN ('locked','live','scoring','published','archived')
    )
  );

-- ★ אין policy ל-INSERT/UPDATE/DELETE — בכוונה.
--   הדרך היחידה לכתוב היא `submit_lineup`, שהיא SECURITY DEFINER
--   ולכן עוקפת RLS אחרי שהיא בדקה את הדדליין. זו הנעילה.

DROP POLICY IF EXISTS slots_read ON game.user_lineup_slots;
CREATE POLICY slots_read ON game.user_lineup_slots
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM game.user_lineups l WHERE l.id = lineup_id)
  );

NOTIFY pgrst, 'reload schema';
