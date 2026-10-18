-- =====================================================================
--  db/40_league_reads.sql — קריאות ציבוריות לפי ליגה
-- =====================================================================
--  `game.squads()` ו-`game.current_gameweek()` היו עיוורות-ליגה: הן
--  החזירו את העונה/המחזור «הראשונים». עם ליגה שנייה הקליינט חייב
--  להגיד איזו ליגה הוא רוצה.
--
--  ★ תאימות לאחור: בלי פרמטר = הליגה הראשית (הוותיקה ביותר, ישראל)
--    — אותה תשובה כמו קודם. קליינט ישן ממשיך לעבוד.
--  ★ `DROP` של הגרסה בלי פרמטרים: אחרת `squads()` ו-
--    `squads(p_league DEFAULT NULL)` מתנגשות כ-ambiguous ב-PostgREST.
--  ★ `leagues_public()` מציג רק ליגה פעילה שיש לה מחזור נוכחי —
--    כך ליגה שנטענה אבל עוד לא נפתחה לא מופיעה בבורר.
-- =====================================================================
BEGIN;

DROP FUNCTION IF EXISTS game.squads();
DROP FUNCTION IF EXISTS game.current_gameweek();
DROP FUNCTION IF EXISTS game.admin_squads();

CREATE OR REPLACE FUNCTION game.squads(p_league TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_season UUID; v_out JSONB;
BEGIN
  /* ★ ליגה מפורשת → העונה הנוכחית שלה. בלי פרמטר → הליגה הראשית
     (הוותיקה ביותר), בדיוק כמו שהמערכת התנהגה עד עכשיו. */
  SELECT s.id INTO v_season
    FROM core.seasons s JOIN core.leagues l ON l.id = s.league_id
   WHERE p_league IS NULL OR l.code = p_league
   ORDER BY (p_league IS NULL) DESC, l.created_at, l.code,
            s.is_current DESC, s.starts_on DESC NULLS LAST
   LIMIT 1;
  IF v_season IS NULL THEN
    RETURN jsonb_build_object('teams', '[]'::jsonb, 'players', '[]'::jsonb);
  END IF;

  SELECT jsonb_build_object(
    'season', (SELECT jsonb_build_object(
                 'code',   l.code,
                 'nameHe', l.names #>> '{he,full}',
                 'nameEn', l.names #>> '{en,full}',
                 'label',  s.label)
                 FROM core.seasons s JOIN core.leagues l ON l.id = s.league_id
                WHERE s.id = v_season),

    'teams', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id',         'T' || xt.external_id,
               'externalId', xt.external_id,
               'nameHe',     COALESCE(tm.name_he, tm.name_en),
               'nameEn',     tm.name_en,
               'nameEl',     tm.names #>> '{el,full}',
               'short',      COALESCE(NULLIF(tm.short_code, ''), tm.name_he, tm.name_en),
               'city',       tm.city,
               'stadium',    tm.stadium
             ) ORDER BY xt.external_id::INT)
        FROM core.teams tm
        JOIN core.v_ext xt ON xt.entity_type = 'team' AND xt.entity_id = tm.id
        JOIN core.team_seasons ts ON ts.team_id = tm.id AND ts.season_id = v_season
        -- מזהה חיצוני לא-מספרי היה מפיל את המיון. אין כזה היום,
        -- ואם יהיה — עדיף לסנן אותו מאשר להפיל את כל הליגה.
       WHERE xt.external_id ~ '^[0-9]+$'
    ), '[]'::jsonb),

    'players', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id',            'P' || xp.external_id,
               'externalId',    xp.external_id,
               'teamId',        'T' || xt.external_id,
               'position',      sq.position,
               'nameHe',        COALESCE(pl.name_he, pl.name_en),
               'nameEn',        pl.name_en,
               'nameEl',        pl.names #>> '{el,full}',
               'shirt',         sq.shirt_number,
               'tier',          COALESCE(sq.tier, 3),
               'price',         COALESCE(sq.fantasy_price, 1)::FLOAT8,
               'overallRank',   sq.overall_rank,
               'rated',         sq.rated,
               'nationality',   COALESCE(pl.nationality_he, pl.nationality::TEXT),
               'isClubCaptain', pl.is_club_captain,
               'status',        sq.status
             ) ORDER BY xt.external_id::INT, sq.position, COALESCE(pl.name_he, pl.name_en))
        FROM core.squads sq
        JOIN core.players pl ON pl.id = sq.player_id
        JOIN core.teams   tm ON tm.id = sq.team_id
        JOIN core.v_ext   xp ON xp.entity_type = 'player' AND xp.entity_id = pl.id
        JOIN core.v_ext   xt ON xt.entity_type = 'team'   AND xt.entity_id = tm.id
       WHERE sq.season_id = v_season
         AND sq.valid_to IS NULL
         -- ★ פצוע/מורחק **כן** מופיע, עם `status`. שחקן שנעלם
         --   מהרשימה נראה כמו באג; שחקן מסומן הוא מידע.
         AND sq.status <> 'left'
         AND xp.external_id ~ '^[0-9]+$' AND xt.external_id ~ '^[0-9]+$'
    ), '[]'::jsonb),

    'revision', (SELECT revision FROM game.data_revision WHERE id = 1)
  ) INTO v_out;

  RETURN v_out;
END;
$$;
GRANT EXECUTE ON FUNCTION game.squads(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION game.current_gameweek(p_league TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
  SELECT gw.code
    FROM game.gameweeks gw
    JOIN core.leagues l ON l.id = gw.league_id
   WHERE gw.is_current AND gw.code IS NOT NULL
     AND (p_league IS NULL OR l.code = p_league)
   ORDER BY l.created_at, l.code
   LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION game.current_gameweek(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION game.leagues_public()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'primary') DESC, x->>'code'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'code',        l.code,
      'country',     l.country_code,
      'locale',      l.default_locale,
      'dir',         l.text_direction,
      'timezone',    l.timezone,
      'names',       l.names,
      'primary',     (l.id = (SELECT id FROM core.leagues ORDER BY created_at, code LIMIT 1)),
      'currentGameweek', (SELECT gw.code FROM game.gameweeks gw
                           WHERE gw.league_id = l.id AND gw.is_current LIMIT 1)
    ) AS x
    FROM core.leagues l
   WHERE l.is_active
     AND EXISTS (SELECT 1 FROM game.gameweeks gw WHERE gw.league_id = l.id AND gw.is_current)
  ) q;
$$;
GRANT EXECUTE ON FUNCTION game.leagues_public() TO anon, authenticated;

CREATE OR REPLACE FUNCTION game.admin_squads(p_league TEXT DEFAULT NULL)
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
        'nameHe', COALESCE(tm.name_he, tm.name_en),
        'short',  COALESCE(NULLIF(tm.short_code, ''), tm.name_he),
        'city',   tm.city,
        'stadium', tm.stadium,
        'players', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id',       'P' || xp.external_id,
            'nameHe',   COALESCE(pl.name_he, pl.name_en),
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
          ) ORDER BY sq.position, COALESCE(pl.name_he, pl.name_en))
          FROM core.squads sq
          JOIN core.players pl  ON pl.id = sq.player_id
          JOIN core.v_ext  xp   ON xp.entity_type = 'player' AND xp.entity_id = sq.player_id
          WHERE sq.team_id = tm.id AND sq.valid_to IS NULL
        ), '[]'::jsonb)
      ) AS t
      FROM core.teams tm
      JOIN core.v_ext xt ON xt.entity_type = 'team' AND xt.entity_id = tm.id
     WHERE xt.external_id ~ '^[0-9]+$'
       /* ★ ליגה מפורשת, או (בלי פרמטר) הליגה הראשית — כמו עד היום. */
       AND tm.id IN (
         SELECT ts.team_id FROM core.team_seasons ts
           JOIN core.seasons se ON se.id = ts.season_id AND se.is_current
           JOIN core.leagues l  ON l.id = se.league_id
          WHERE (p_league IS NOT NULL AND l.code = p_league)
             OR (p_league IS NULL AND l.id = (SELECT id FROM core.leagues ORDER BY created_at, code LIMIT 1)))
    ) q
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_squads(TEXT) TO authenticated;

UPDATE game.data_revision
   SET revision = revision + 1, scope = 'migration-40', updated_at = now()
 WHERE id = 1;

COMMIT;

INSERT INTO game.schema_migrations (version, note) VALUES
  ('40', '★ squads / current_gameweek לפי ליגה + leagues_public')
ON CONFLICT (version) DO NOTHING;
