-- =====================================================================
--  db/29_squad_repair.sql · עמדה, ושחקן שנמצא בשתי קבוצות
--
--  ═══════════════════════════════════════════════════════════════
--  ★ הבאג: שחקן אחד מופיע בכל ארבע עשרה הקבוצות
--  ═══════════════════════════════════════════════════════════════
--
--  `core.squads` נעולה על `(עונה, קבוצה, שחקן, מתאריך)`. המפתח
--  הזה נכון — הוא מה שמאפשר לשמור היסטוריה של מעברי קבוצה —
--  אבל הוא גם אומר ששורה חדשה בקבוצה אחרת **אינה מתנגשת**
--  בשורה הישנה. מי שלא סוגר את הישנה מקבל שחקן בשתי קבוצות,
--  ומי שחוזר על זה מקבל אותו בארבע עשרה.
--
--  db/03 סוגר את זה בסיד. אבל כל נתיב אחר שכותב סגל — קליטה,
--  לוח ניהול, תיקון ידני ב-SQL — לא סגר, וזה נצבר בשקט.
--
--  ★ ולמה זה לא רק "מכוער": `submit_entry` אוכף «שחקן אחד מכל
--    קבוצה». שחקן שפתוח בשתי קבוצות שובר את האילוץ הזה — הוא
--    יכול להיבחר כנציג של קבוצה אחת ולהיספר כשנייה. זהו באג
--    תחרותי, לא באג תצוגה.
--
--  הקובץ הזה נותן שלושה דברים:
--    1. זיהוי — מי פתוח ביותר מקבוצה אחת, ואיפה
--    2. תיקון בקליק — «להשאיר רק כאן»
--    3. מניעה — עריכת שחקן מלוח הניהול נוגעת רק בקבוצה שנערכת
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
--  §1 · עמדה — הפעולה שחסרה בלוח
-- ---------------------------------------------------------------------
--  ★ פונקציה קטנה ונפרדת, כמו `admin_set_price` ו-
--    `admin_set_player_status`, ולא שדה נוסף בטופס הגדול.
--    שינוי עמדה הוא פעולה של קליק אחד על שורה קיימת; טופס
--    מלא בשביל זה הוא שלושה קליקים ומקום לטעות.
--
--  ★ משנה גם את `core.players.primary_position` וגם את שורת
--    הסגל. הראשון הוא מי השחקן, השני הוא איך הוא משוחק העונה.
--    ניקוד קורא את השני; מסכים קוראים את שניהם. עדכון של אחד
--    בלבד מייצר שחקן שמופיע בהגנה ומנוקד כחלוץ.
CREATE OR REPLACE FUNCTION game.admin_set_player_position(
  p_ext_player TEXT,
  p_position   TEXT,
  /* NULL = כל שורות הסגל הפתוחות שלו. ערך = רק הקבוצה הזו. */
  p_ext_team   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE
  v_player UUID;
  v_team   UUID;
  v_pos    core."position";
  v_rows   INT;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  v_player := core.player_by_ext(p_ext_player);
  IF v_player IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND: %', p_ext_player; END IF;

  IF p_position NOT IN ('GK','DEF','MID','FWD') THEN
    RAISE EXCEPTION 'BAD_POSITION: %', p_position;
  END IF;
  v_pos := p_position::core."position";

  IF p_ext_team IS NOT NULL THEN
    v_team := core.team_by_ext(p_ext_team);
    IF v_team IS NULL THEN RAISE EXCEPTION 'TEAM_NOT_FOUND: %', p_ext_team; END IF;
  END IF;

  UPDATE core.squads
     SET position = v_pos
   WHERE player_id = v_player
     AND valid_to IS NULL
     AND (v_team IS NULL OR team_id = v_team);
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN RAISE EXCEPTION 'NO_OPEN_SQUAD_ROW'; END IF;

  UPDATE core.players SET primary_position = v_pos, updated_at = now()
   WHERE id = v_player;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (game.actor_label(), 'admin_set_player_position', 'player', p_ext_player,
          jsonb_build_object('position', p_position, 'team', p_ext_team, 'rows', v_rows));

  RETURN jsonb_build_object('ok', TRUE, 'position', p_position, 'rows', v_rows);
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_set_player_position(TEXT,TEXT,TEXT) TO authenticated;

-- ---------------------------------------------------------------------
--  §2 · מי פתוח ביותר מקבוצה אחת
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION game.admin_squad_conflicts()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v JSONB;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player',  core.ext_code('player', x.player_id),
           'nameHe',  x.name_he,
           'teams',   x.teams) ORDER BY x.name_he), '[]'::jsonb)
    INTO v
  FROM (
    SELECT s.player_id, pl.name_he,
           jsonb_agg(jsonb_build_object(
             'team',   core.ext_code('team', s.team_id),
             'nameHe', tm.name_he,
             'shirt',  s.shirt_number,
             'status', s.status) ORDER BY tm.name_he) AS teams
      FROM core.squads s
      JOIN core.players pl ON pl.id = s.player_id
      JOIN core.teams   tm ON tm.id = s.team_id
     WHERE s.valid_to IS NULL
     GROUP BY s.player_id, pl.name_he
    HAVING count(DISTINCT s.team_id) > 1
  ) x;

  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_squad_conflicts() TO authenticated;

-- ---------------------------------------------------------------------
--  §3 · «להשאיר רק כאן»
-- ---------------------------------------------------------------------
--  ★ סוגר ולא מוחק. שורה עם `valid_to` היא הקבוצה שבה השחקן
--    היה כשהרכב הוגש, וניקוד היסטורי מסתמך עליה. מחיקה הייתה
--    משכתבת תחרות שכבר נגמרה.
CREATE OR REPLACE FUNCTION game.admin_resolve_squad_conflict(
  p_ext_player TEXT, p_ext_team TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_player UUID; v_team UUID; v_closed INT;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  v_player := core.player_by_ext(p_ext_player);
  v_team   := core.team_by_ext(p_ext_team);
  IF v_player IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND: %', p_ext_player; END IF;
  IF v_team   IS NULL THEN RAISE EXCEPTION 'TEAM_NOT_FOUND: %',   p_ext_team;   END IF;

  IF NOT EXISTS (SELECT 1 FROM core.squads
                  WHERE player_id = v_player AND team_id = v_team AND valid_to IS NULL) THEN
    RAISE EXCEPTION 'NOT_IN_TEAM';
  END IF;

  UPDATE core.squads
     SET valid_to = CURRENT_DATE, status = 'left'
   WHERE player_id = v_player AND valid_to IS NULL AND team_id <> v_team;
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (game.actor_label(), 'admin_resolve_squad_conflict', 'player', p_ext_player,
          jsonb_build_object('kept', p_ext_team, 'closed', v_closed));

  RETURN jsonb_build_object('ok', TRUE, 'kept', p_ext_team, 'closed', v_closed);
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_resolve_squad_conflict(TEXT,TEXT) TO authenticated;

-- ---------------------------------------------------------------------
--  §4 · מניעה — עריכה נוגעת רק בקבוצה שנערכת
-- ---------------------------------------------------------------------
--  ★ `admin_upsert_player` עדכן `WHERE player_id = ? AND valid_to IS NULL`
--    בלי לסנן קבוצה. לשחקן תקין זה זהה; לשחקן שכבר פתוח בשתי
--    קבוצות זה מפיץ את העריכה לשתיהן, ומקבע את הבאג במקום
--    לחשוף אותו.
CREATE OR REPLACE FUNCTION game.admin_upsert_player(
  p_ext_team    TEXT,
  p_name_he     TEXT,
  p_ext_player  TEXT     DEFAULT NULL,
  p_name_en     TEXT     DEFAULT NULL,
  p_position    TEXT     DEFAULT 'MID',
  p_price       NUMERIC  DEFAULT NULL,
  p_shirt       SMALLINT DEFAULT NULL,
  p_status      TEXT     DEFAULT 'active',
  p_tier        SMALLINT DEFAULT NULL,
  p_overall_rank INT     DEFAULT NULL,
  p_nationality TEXT     DEFAULT NULL,
  p_is_captain  BOOLEAN  DEFAULT NULL
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
  IF p_tier IS NOT NULL AND p_tier NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'TIER_RANGE'; END IF;
  IF p_price IS NOT NULL AND (p_price < 0 OR p_price > 99) THEN RAISE EXCEPTION 'PRICE_RANGE'; END IF;

  v_team := core.team_by_ext(p_ext_team);
  IF v_team IS NULL THEN RAISE EXCEPTION 'TEAM_NOT_FOUND: %', p_ext_team; END IF;

  v_pos := p_position::core."position";

  SELECT s.id INTO v_season FROM core.seasons s
   ORDER BY s.is_current DESC, s.starts_on DESC NULLS LAST LIMIT 1;
  IF v_season IS NULL THEN RAISE EXCEPTION 'NO_SEASON'; END IF;

  IF v_ext IS NULL THEN
    v_ext := core.next_player_ext(p_ext_team);

    INSERT INTO core.players (names, primary_position, nationality_he, is_club_captain)
    VALUES (jsonb_build_object(
              'he', jsonb_build_object('full', btrim(p_name_he)),
              'en', jsonb_build_object('full',
                      COALESCE(NULLIF(btrim(p_name_en), ''), btrim(p_name_he)))),
            v_pos, NULLIF(btrim(COALESCE(p_nationality,'')), ''),
            COALESCE(p_is_captain, FALSE))
    RETURNING id INTO v_player;

    INSERT INTO core.external_refs (provider, entity_type, external_id, entity_id)
    VALUES ('manual_json', 'player', v_ext, v_player);

    INSERT INTO core.squads
      (season_id, team_id, player_id, position, fantasy_price, shirt_number, status,
       tier, overall_rank, rated)
    VALUES (v_season, v_team, v_player, v_pos, p_price, p_shirt, p_status,
            COALESCE(p_tier, 3), p_overall_rank, p_overall_rank IS NOT NULL);

  ELSE
    v_player := core.player_by_ext(v_ext);
    IF v_player IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND: %', v_ext; END IF;

    UPDATE core.players SET
      names = jsonb_build_object(
                'he', jsonb_build_object('full', btrim(p_name_he)),
                'en', jsonb_build_object('full',
                        COALESCE(NULLIF(btrim(p_name_en), ''),
                                 names #>> '{en,full}', btrim(p_name_he)))),
      primary_position = v_pos,
      nationality_he   = COALESCE(NULLIF(btrim(COALESCE(p_nationality,'')), ''), nationality_he),
      is_club_captain  = COALESCE(p_is_captain, is_club_captain),
      updated_at = now()
    WHERE id = v_player;

    UPDATE core.squads SET
      position      = v_pos,
      fantasy_price = COALESCE(p_price, fantasy_price),
      shirt_number  = COALESCE(p_shirt, shirt_number),
      status        = p_status,
      tier          = COALESCE(p_tier, tier),
      overall_rank  = COALESCE(p_overall_rank, overall_rank),
      rated         = rated OR p_overall_rank IS NOT NULL
    WHERE player_id = v_player AND valid_to IS NULL
      AND team_id = v_team;              -- ★ התיקון
  END IF;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (game.actor_label(), 'admin_upsert_player', 'player', v_ext,
          jsonb_build_object('team', p_ext_team, 'name', p_name_he,
                             'pos', p_position, 'price', p_price, 'status', p_status,
                             'tier', p_tier, 'rank', p_overall_rank));

  RETURN v_ext;
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_upsert_player(
  TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC,SMALLINT,TEXT,SMALLINT,INT,TEXT,BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------------
--  §5 · הסימון במסך — כמה קבוצות פתוחות לכל שחקן
-- ---------------------------------------------------------------------
--  ★ שדה אחד בתשובה הקיימת ולא קריאה שנייה: המסך צריך לדעת
--    את זה בדיוק כשהוא מצייר את השורה, ושתי קריאות שמגיעות
--    בזמנים שונים הן שתי אמיתות.
CREATE OR REPLACE FUNCTION game.admin_squads()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = core, game, public
AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(t ORDER BY (t->>'sort')::INT)
    FROM (
      SELECT jsonb_build_object(
        'teamId', 'T' || xt.external_id,
        'sort',   xt.external_id::INT,
        'nameHe', tm.name_he,
        'short',  COALESCE(NULLIF(tm.short_code, ''), tm.name_he),
        'city',   tm.city,
        'stadium', tm.stadium,
        'players', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id',       'P' || xp.external_id,
            'nameHe',   pl.name_he,
            'nameEn',   pl.name_en,
            'position', sq.position,
            'price',    sq.fantasy_price,
            'shirt',    sq.shirt_number,
            'status',   sq.status,
            'tier',     sq.tier,
            'overallRank', sq.overall_rank,
            'nationality', pl.nationality_he,
            /* בכמה קבוצות הוא פתוח כרגע. 1 = תקין. */
            'openTeams', (SELECT count(DISTINCT s2.team_id)
                            FROM core.squads s2
                           WHERE s2.player_id = sq.player_id AND s2.valid_to IS NULL)
          ) ORDER BY sq.position, pl.name_he)
          FROM core.squads sq
          JOIN core.players pl  ON pl.id = sq.player_id
          JOIN core.v_ext  xp   ON xp.entity_type = 'player' AND xp.entity_id = sq.player_id
          WHERE sq.team_id = tm.id AND sq.valid_to IS NULL
        ), '[]'::jsonb)
      ) AS t
      FROM core.teams tm
      JOIN core.v_ext xt ON xt.entity_type = 'team' AND xt.entity_id = tm.id
     WHERE xt.external_id ~ '^[0-9]+$'
    ) q
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_squads() TO authenticated;

COMMIT;

INSERT INTO game.schema_migrations (version, note) VALUES
  ('29', '★ עמדה בלוח הניהול + שחקן שפתוח ביותר מקבוצה אחת')
ON CONFLICT (version) DO NOTHING;
