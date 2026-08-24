-- =====================================================================
--  Dubid · מיגרציה 06 — ליגות פרטיות
--
--  MVP בלבד, לפי הברִיף: יצירה, הצטרפות, חברים, טבלה.
--  ★ מה שבמפורש *לא* נבנה כאן: צ׳אט, פיד, הודעות.
--    המטרה היא תחרות בין חברים, לא רשת חברתית.
--
--  אידמפוטנטי. additive בלבד.
-- =====================================================================

SET search_path = core, game, public;

CREATE TABLE IF NOT EXISTS game.leagues (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 40),
  -- קוד ההצטרפות. ייחודי גלובלית, אחרת קוד אחד יוביל לשתי ליגות.
  code        TEXT NOT NULL UNIQUE
              CHECK (code ~ '^[2-9A-HJKMNP-Z]{6}$'),
  owner_id    UUID NOT NULL REFERENCES game.users(id) ON DELETE CASCADE,
  -- ★ ליגה שייכת למצב משחק אחד. הברִיף אוסר למזג ניקוד של
  --   דוביד 5 ודוביד 11 לטבלה תחרותית אחת.
  mode        TEXT NOT NULL CHECK (mode IN ('five','full')),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  max_members INT CHECK (max_members IS NULL OR max_members BETWEEN 2 AND 10000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN game.leagues.code IS
  'אלפבית ללא 0/O/1/I/L — קוד שמוקרא בקול חייב להיות חד-משמעי.';

CREATE TABLE IF NOT EXISTS game.league_members (
  league_id   UUID NOT NULL REFERENCES game.leagues(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES game.users(id) ON DELETE CASCADE,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, user_id)     -- הצטרפות כפולה בלתי אפשרית במסד
);

CREATE INDEX IF NOT EXISTS league_members_user_idx ON game.league_members (user_id);

-- ---------------------------------------------------------------------
-- יצירה והצטרפות — RPC בלבד, כמו כל כתיבה תחרותית
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.create_league(
  p_name        TEXT,
  p_mode        TEXT,
  p_max_members INT DEFAULT NULL
)
RETURNS game.leagues
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE
  v_user   UUID := auth.uid();
  v_league game.leagues;
  v_code   TEXT;
  v_try    INT := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_mode NOT IN ('five','full') THEN RAISE EXCEPTION 'INVALID_MODE'; END IF;

  -- הגרלת קוד עד שנמצא פנוי. עם 31^6 ≈ 887 מיליון צירופים,
  -- התנגשות היא נדירה; הלולאה קיימת כדי שגם הנדיר לא ייכשל.
  LOOP
    v_try := v_try + 1;
    IF v_try > 10 THEN RAISE EXCEPTION 'CODE_GENERATION_FAILED'; END IF;

    SELECT string_agg(
             substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ',
                    (floor(random() * 31) + 1)::INT, 1), '')
      INTO v_code
      FROM generate_series(1, 6);

    EXIT WHEN NOT EXISTS (SELECT 1 FROM game.leagues WHERE code = v_code);
  END LOOP;

  INSERT INTO game.leagues (name, code, owner_id, mode, max_members)
  VALUES (btrim(p_name), v_code, v_user, p_mode, p_max_members)
  RETURNING * INTO v_league;

  -- היוצר הוא חבר. ליגה בלי היוצר שלה היא באג מחכה לקרות.
  INSERT INTO game.league_members (league_id, user_id)
  VALUES (v_league.id, v_user);

  RETURN v_league;
END;
$$;

CREATE OR REPLACE FUNCTION game.join_league(p_code TEXT)
RETURNS game.leagues
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE
  v_user   UUID := auth.uid();
  v_league game.leagues;
  v_count  INT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  -- נרמול זהה ל-`normalizeCode` בקליינט: אותיות גדולות, בלי
  -- מפרידים, ושומרים רק תווים מהאלפבית.
  p_code := regexp_replace(upper(btrim(p_code)), '[^2-9A-HJKMNP-Z]', '', 'g');
  IF length(p_code) <> 6 THEN RAISE EXCEPTION 'INVALID_CODE'; END IF;

  SELECT * INTO v_league FROM game.leagues WHERE code = p_code FOR UPDATE;
  IF v_league.id IS NULL       THEN RAISE EXCEPTION 'LEAGUE_NOT_FOUND'; END IF;
  IF v_league.status <> 'active' THEN RAISE EXCEPTION 'LEAGUE_CLOSED'; END IF;

  IF EXISTS (SELECT 1 FROM game.league_members
              WHERE league_id = v_league.id AND user_id = v_user) THEN
    RAISE EXCEPTION 'ALREADY_MEMBER';
  END IF;

  IF v_league.max_members IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM game.league_members WHERE league_id = v_league.id;
    IF v_count >= v_league.max_members THEN RAISE EXCEPTION 'LEAGUE_FULL'; END IF;
  END IF;

  INSERT INTO game.league_members (league_id, user_id) VALUES (v_league.id, v_user);
  RETURN v_league;
END;
$$;

GRANT EXECUTE ON FUNCTION game.create_league(TEXT, TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION game.join_league(TEXT)              TO authenticated;

-- ---------------------------------------------------------------------
-- RLS — רואים רק ליגות שאתם בהן
-- ---------------------------------------------------------------------
ALTER TABLE game.leagues        ENABLE ROW LEVEL SECURITY;
ALTER TABLE game.league_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leagues_member_read ON game.leagues;
CREATE POLICY leagues_member_read ON game.leagues
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM game.league_members m
             WHERE m.league_id = id AND m.user_id = auth.uid())
  );
-- ★ שימו לב מה *אין* כאן: חיפוש ליגות. ליגה פרטית מתגלה דרך קוד
--   בלבד, ולכן `join_league` (SECURITY DEFINER) היא הדרך היחידה
--   להגיע אליה בלי להיות חבר בה.

DROP POLICY IF EXISTS league_members_read ON game.league_members;
CREATE POLICY league_members_read ON game.league_members
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM game.league_members m
             WHERE m.league_id = league_id AND m.user_id = auth.uid())
  );

NOTIFY pgrst, 'reload schema';
