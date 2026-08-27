-- =====================================================================
--  Dubid · מיגרציה 13 — הדאטה עוברת לשרת, במלואה
-- =====================================================================
--
--  ★ הבעיה שהמיגרציה הזו פותרת
--
--  עד כאן, לוח הניהול **כתב** למסד — ואף אחד לא **קרא** ממנו.
--
--  14 הקבוצות ו-351 השחקנים חיו ב-`src/data/squads.ts`: קובץ
--  TypeScript של 5,460 שורות שנארז לתוך ה-JavaScript בזמן בנייה.
--  לוח המשחקים חי ב-`src/data/fixtures.ts`. כלומר האדמין שינה
--  מחיר, הפונקציה רצה, ה-audit log נרשם — ואז המסך המשיך להציג
--  את המספר מהקובץ, כי הוא מעולם לא שאל את השרת.
--
--  זה נראה בדיוק כמו "האדמין לא שומר". הוא שמר. פשוט אף מסך
--  בעולם לא הסתכל.
--
--  ★ מה נוסף כאן
--
--    §1  עמודות שהיו קיימות רק ב-JSON של הסיד (tier, דירוג,
--        עיר, אצטדיון) הופכות לעמודות אמיתיות, וממולאות ממנו.
--        בלעדיהן `game.squads()` לא יכולה להחזיר את מה שהמסך
--        צריך, והמעבר לשרת היה מוריד מידע מהמוצר.
--
--    §2  `game.data_revision` — מונה אחד שעולה בכל שינוי דאטה.
--        זה מה ש-Realtime משדר, ולכן כל מכשיר שפתוח מגלה תוך
--        שנייה שהאדמין שינה משהו. בלי זה "און ליין" פירושו
--        "נכון לרגע שבו טענת את הדף".
--
--    §3  `game.squads()`   — הסגלים, בשפת הקליינט (T3 / P305).
--    §4  `game.fixtures()` — לוח המשחקים, אותה שפה.
--
--    §5  טיוטות. עד כאן ההרכב שבנייה חי ב-`localStorage`: מי
--        שהתחיל בטלפון והמשיך במחשב התחיל מאפס, ומי שניקה
--        דפדפן איבד הכל. עכשיו הטיוטה יושבת בשרת.
--
--    §6  ניהול: קבוצות, משחקים, דדליין, וסטטוס מחזור.
--
--  ★ מה **לא** נעשה כאן, בכוונה
--
--  `core.squads` לא מקבל UPDATE הרסני, שום שורה לא נמחקת, ושום
--  פונקציה קיימת לא משנה חתימה חוץ מאחת (`admin_upsert_player`,
--  §6.4 — עם DROP מפורש ולא overload, כי שתי גרסאות עם פרמטרים
--  אופציונליים הן קריאה דו-משמעית שנופלת ב-runtime).
--
--  אידמפוטנטי. אפשר להריץ שוב, בכל סדר.
-- =====================================================================

SET search_path = core, game, public;

-- =====================================================================
-- §1 העמודות שחסרו
-- =====================================================================
--
--  ★ למה זה לא היה חסר עד היום
--
--  הסיד (`db/03`) שמר את ה-JSON המקורי של כל שחקן וקבוצה בתוך
--  `core.external_refs.payload`. שם יש דרג, דירוג כללי, לאום,
--  קפטנות מועדון, עיר ואצטדיון — הכל. פשוט אף אחד לא מיפה אותם
--  לעמודות, כי אף שאילתה לא היה צריכה אותם: המסך קרא מהקובץ.
--
--  ברגע שהמסך קורא מהמסד, מה שאין בעמודה — לא קיים.
--
--  ⚠ `payload` הוא צילום של הסיד ולא מתעדכן מהאדמין. לכן הוא
--    משמש כאן **למילוי ראשוני בלבד**: כל UPDATE כאן מותנה ב-
--    `IS NULL`, ולכן ערך שהאדמין קבע לא נדרס בהרצה חוזרת.

ALTER TABLE core.teams   ADD COLUMN IF NOT EXISTS city    TEXT;
ALTER TABLE core.teams   ADD COLUMN IF NOT EXISTS stadium TEXT;

ALTER TABLE core.players ADD COLUMN IF NOT EXISTS is_club_captain BOOLEAN NOT NULL DEFAULT FALSE;
-- `nationality` הוא CHAR(2) לפי תקן; המסך מציג "ישראל" ולא "IL".
ALTER TABLE core.players ADD COLUMN IF NOT EXISTS nationality_he  TEXT;

ALTER TABLE core.squads  ADD COLUMN IF NOT EXISTS tier         SMALLINT
  CONSTRAINT squads_tier_range CHECK (tier IS NULL OR tier BETWEEN 1 AND 5);
ALTER TABLE core.squads  ADD COLUMN IF NOT EXISTS overall_rank INT;
ALTER TABLE core.squads  ADD COLUMN IF NOT EXISTS rated        BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------- מילוי
DO $backfill$
DECLARE v_teams INT := 0; v_players INT := 0;
BEGIN
  ------------------------------------------------------------- קבוצות
  UPDATE core.teams t SET
    city       = COALESCE(t.city,    NULLIF(x.payload->>'city', '')),
    stadium    = COALESCE(t.stadium, NULLIF(x.payload->>'stadium', '')),
    -- ★ `short_code` נזרע כ-`left(name_en,3)` — כלומר 'Hap' ו-'Mac'
    --   לחמש קבוצות שונות. הקיצור העברי ('הב״ש') היה ב-payload
    --   כל הזמן. בלי התיקון הזה הטבלאות והכרטיסים היו מציגים
    --   שלוש אותיות לטיניות זהות לחצי מהליגה.
    short_code = CASE
                   WHEN NULLIF(x.payload->>'short', '') IS NOT NULL
                        AND (t.short_code IS NULL OR t.short_code = left(t.name_en, 3))
                     THEN x.payload->>'short'
                   ELSE t.short_code
                 END
  FROM core.external_refs x
  WHERE x.provider = 'manual_json' AND x.entity_type = 'team' AND x.entity_id = t.id
    AND x.payload IS NOT NULL;
  GET DIAGNOSTICS v_teams = ROW_COUNT;

  ------------------------------------------------------------- שחקנים
  UPDATE core.players p SET
    is_club_captain = COALESCE(p.is_club_captain, FALSE)
                      OR COALESCE((x.payload->>'is_club_captain')::BOOLEAN, FALSE),
    nationality_he  = COALESCE(p.nationality_he, NULLIF(x.payload->>'nationality', ''))
  FROM core.external_refs x
  WHERE x.provider = 'manual_json' AND x.entity_type = 'player' AND x.entity_id = p.id
    AND x.payload IS NOT NULL;
  GET DIAGNOSTICS v_players = ROW_COUNT;

  UPDATE core.squads sq SET
    tier         = COALESCE(sq.tier,         NULLIF(x.payload->>'tier', '')::SMALLINT),
    overall_rank = COALESCE(sq.overall_rank, NULLIF(x.payload->>'overall_rank', '')::INT),
    rated        = sq.rated OR COALESCE((x.payload->>'rated')::BOOLEAN, FALSE)
  FROM core.external_refs x
  WHERE x.provider = 'manual_json' AND x.entity_type = 'player'
    AND x.entity_id = sq.player_id AND x.payload IS NOT NULL
    AND sq.valid_to IS NULL;

  RAISE NOTICE 'מילוי: % קבוצות, % שחקנים', v_teams, v_players;
END
$backfill$;

-- =====================================================================
-- §2 מונה הגרסה — הדופק של "און ליין"
-- =====================================================================
--
--  ★ למה טבלה ולא Realtime ישירות על `core.squads`
--
--  אפשר היה לשדר את `core.squads` עצמה. שלוש סיבות לא לעשות את זה:
--
--   1. שינוי מחיר אחד באדמין נוגע ב-3 טבלאות (players, squads,
--      audit_logs). המסך היה מקבל שלושה אירועים ומרענן שלוש פעמים.
--   2. `ALTER PUBLICATION` על טבלה עם RLS חושף שורות מלאות
--      למאזינים. מונה חושף מספר.
--   3. מונה אחד = מקום אחד להאזין לו, במקום רשימה שתגדל.
--
--  שורה אחת. מספר אחד. מי שרואה מספר גדול מזה שבידו — טוען מחדש.

CREATE TABLE IF NOT EXISTS game.data_revision (
  id         SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  revision   BIGINT NOT NULL DEFAULT 1,
  scope      TEXT   NOT NULL DEFAULT 'boot',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO game.data_revision (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON game.data_revision TO anon, authenticated;

/* ★ RLS דלוקה עם מדיניות פתוחה, ולא כבויה.
 *
 * זה נראה מיותר — הטבלה מחזיקה מספר אחד — אבל Realtime של
 * Supabase **לא משדר** אירועי `postgres_changes` מטבלה שאין
 * למאזין מדיניות SELECT עליה. בלי שתי השורות האלה הכל עובד
 * חוץ מהדבר היחיד שהטבלה קיימת בשבילו: שינוי אצל האדמין לא
 * מגיע למכשירים שפתוחים, והמשתמש צריך לרענן ידנית.
 *
 * `USING (TRUE)` נכון כאן: מספר גרסה אינו סוד. */
DO $rev_rls$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN RETURN; END IF;
  ALTER TABLE game.data_revision ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS data_revision_read ON game.data_revision;
  CREATE POLICY data_revision_read ON game.data_revision FOR SELECT USING (TRUE);
END
$rev_rls$;

CREATE OR REPLACE FUNCTION game.bump_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = game, public
AS $$
BEGIN
  UPDATE game.data_revision
     SET revision = revision + 1, scope = TG_TABLE_NAME, updated_at = now()
   WHERE id = 1;
  RETURN NULL;                                   -- AFTER … FOR EACH STATEMENT
END;
$$;

/* ★ FOR EACH STATEMENT ולא ROW.
   עדכון של 25 שחקנים בבת אחת הוא **שינוי אחד** מבחינת המסך.
   טריגר ROW היה מקפיץ את המונה 25 פעמים ומייצר 25 רענונים. */
DO $trg$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'core.squads', 'core.players', 'core.teams',
    'core.weekly_matches', 'game.gameweeks', 'game.mode_config'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS bump_data_revision ON %s', t);
    EXECUTE format(
      'CREATE TRIGGER bump_data_revision AFTER INSERT OR UPDATE OR DELETE ON %s '
      'FOR EACH STATEMENT EXECUTE FUNCTION game.bump_revision()', t);
  END LOOP;
END
$trg$;

/** קריאה זולה: מה הגרסה עכשיו. */
CREATE OR REPLACE FUNCTION game.data_revision_now()
RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$ SELECT revision FROM game.data_revision WHERE id = 1 $$;
GRANT EXECUTE ON FUNCTION game.data_revision_now() TO anon, authenticated;

/* Realtime. הפרסום קיים רק על Supabase, ולכן הכל עטוף. */
DO $pub$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE game.data_revision;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END
$pub$;

-- =====================================================================
-- §3 הסגלים, כפי שכל משתמש רואה אותם
-- =====================================================================
--
--  ★ למה `anon` ולא רק `authenticated`
--
--  המסך הראשון של אורח מציג את הליגה לפני שהוא לחץ על שום דבר.
--  אם הסגל דורש סשן, יש חלון של כמה מאות מילישניות שבו המוצר
--  נראה ריק. דאטת כדורגל היא פומבית ממילא.
--
--  ★ למה קריאה אחת ולא אחת לקבוצה
--
--  14 קבוצות × 25 שחקנים ≈ 40kb. פחות מתמונה אחת, ובמחיר של
--  הלוך-ושוב אחד במקום 14.
--
--  ★ שדות התצוגה (`tier`, `overallRank`, `rated`) יוצאים עם
--    ברירות מחדל ולא NULL: הטיפוס בקליינט הוא `1|2|3|4|5`, וכל
--    NULL שיחמוק לשם הופך לכרטיס שחקן שבור.

CREATE OR REPLACE FUNCTION game.squads()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_season UUID; v_out JSONB;
BEGIN
  SELECT s.id INTO v_season
    FROM core.seasons s
   ORDER BY s.is_current DESC, s.starts_on DESC NULLS LAST
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
               'nameHe',     tm.name_he,
               'nameEn',     tm.name_en,
               'short',      COALESCE(NULLIF(tm.short_code, ''), tm.name_he),
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
               'nameHe',        pl.name_he,
               'nameEn',        pl.name_en,
               'shirt',         sq.shirt_number,
               'tier',          COALESCE(sq.tier, 3),
               'price',         COALESCE(sq.fantasy_price, 1)::FLOAT8,
               'overallRank',   sq.overall_rank,
               'rated',         sq.rated,
               'nationality',   pl.nationality_he,
               'isClubCaptain', pl.is_club_captain,
               'status',        sq.status
             ) ORDER BY xt.external_id::INT, sq.position, pl.name_he)
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
GRANT EXECUTE ON FUNCTION game.squads() TO anon, authenticated;

-- =====================================================================
-- §4 לוח המשחקים
-- =====================================================================
--
--  ★ הדדליין נגזר מהמשחק המוקדם ביותר, ומוחזר יחד עם הלוח.
--    שדה נפרד היה מתיישן ביום שבו האדמין מזיז משחק — והמשחק
--    היה ממשיך לקבל הרכבים אחרי שהכדור מתגלגל.

CREATE OR REPLACE FUNCTION game.fixtures(p_gw_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_gw game.gameweeks; v_list JSONB;
BEGIN
  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw.id IS NULL THEN
    RETURN jsonb_build_object('gameweek', NULL, 'fixtures', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(f ORDER BY f->>'kickoff', f->>'id'), '[]'::jsonb)
    INTO v_list
    FROM (
      SELECT jsonb_build_object(
        'id',         m.id::TEXT,
        'homeTeamId', 'T' || xh.external_id,
        'awayTeamId', 'T' || xa.external_id,
        'kickoff',    to_char(m.kickoff_at AT TIME ZONE 'UTC',
                              'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'status',     m.status,
        'homeGoals',  m.home_goals,
        'awayGoals',  m.away_goals
      ) AS f
      FROM core.weekly_matches m
      JOIN core.v_ext xh ON xh.entity_type = 'team' AND xh.entity_id = m.home_team_id
      JOIN core.v_ext xa ON xa.entity_type = 'team' AND xa.entity_id = m.away_team_id
     WHERE m.gameweek_id = v_gw.id
    ) q;

  RETURN jsonb_build_object(
    'gameweek', jsonb_build_object(
      'id',     v_gw.code,
      'number', v_gw.number,
      'label',  COALESCE(v_gw.names #>> '{he,full}', 'מחזור ' || v_gw.number),
      'status', v_gw.status,
      'lockAt', to_char(v_gw.lock_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'firstKickoffAt', to_char(COALESCE(v_gw.first_kickoff_at, v_gw.lock_at)
                                AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
    'fixtures', v_list,
    'revision', (SELECT revision FROM game.data_revision WHERE id = 1)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION game.fixtures(TEXT) TO anon, authenticated;

-- =====================================================================
-- §5 טיוטות — ההרכב שבבנייה, בשרת
-- =====================================================================
--
--  ★ למה טבלה נפרדת ולא `game.user_lineups` עם status='draft'
--
--  ל-`user_lineups` יש `UNIQUE (user_id, gameweek_id, mode)`, ובה
--  יושבת ההגשה הרשמית. במוצר, הטיוטה וההגשה **חיות במקביל**: אחרי
--  שהגשת אתה עדיין יכול לערוך ולהגיש שוב. כתיבת טיוטה לאותה שורה
--  הייתה מורידה הגשה חתומה חזרה ל-'draft' בכל הקלדה.
--
--  ★ ולמה JSONB ולא שורות סלוטים
--
--  טיוטה היא חלקית מעצם הגדרתה. `user_lineup_slots` דורש
--  `player_id NOT NULL` ואוכף "שחקן אחד מכל קבוצה" — אילוצים
--  נכונים להגשה שנספרת, ומזיקים למשהו שנמצא באמצע עריכה. טיוטה
--  אינה דאטה תחרותית: היא לא נספרת, לא מדורגת, ולא מנוקדת.
--  **כל אילוץ תחרותי נאכף ב-`submit_entry`, ורק שם.**

CREATE TABLE IF NOT EXISTS game.lineup_drafts (
  user_id     UUID NOT NULL REFERENCES game.users(id) ON DELETE CASCADE,
  gameweek_id UUID NOT NULL REFERENCES game.gameweeks(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL CHECK (mode IN ('five','full')),
  formation   TEXT NOT NULL,
  slots       JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, gameweek_id, mode)
);

ALTER TABLE game.lineup_drafts ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON game.lineup_drafts FROM anon, authenticated;

DO $rls$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    RAISE NOTICE 'דילוג על מדיניות הטיוטות: הסכמה auth לא קיימת';
    RETURN;
  END IF;
  DROP POLICY IF EXISTS drafts_own ON game.lineup_drafts;
  -- ★ טיוטה של מישהו אחר היא בדיוק המידע שהורס תחרות: מי שרואה
  --   את ההרכב שבבנייה של יריב יודע מה לא לבחור. `id = auth.uid()`
  --   ולא `TRUE`.
  CREATE POLICY drafts_own ON game.lineup_drafts FOR SELECT USING (user_id = auth.uid());
END
$rls$;

/**
 * שמירת טיוטה. נקראת בהשהיה מהמסך, ולכן היא חייבת להיות זולה
 * ולעולם לא להיכשל על תוכן חלקי.
 */
CREATE OR REPLACE FUNCTION game.save_draft(
  p_gw_code   TEXT,
  p_mode      TEXT,
  p_formation TEXT,
  p_slots     JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_auth UUID := auth.uid(); v_gw UUID;
BEGIN
  IF v_auth IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_mode NOT IN ('five','full') THEN RAISE EXCEPTION 'INVALID_MODE'; END IF;
  IF jsonb_typeof(p_slots) <> 'array' THEN RAISE EXCEPTION 'INVALID_SLOTS'; END IF;
  -- תקרה שפויה: טיוטה היא 5–15 סלוטים, לא מקום לאחסון שרירותי.
  IF jsonb_array_length(p_slots) > 32 THEN RAISE EXCEPTION 'SLOTS_TOO_MANY'; END IF;

  PERFORM game.ensure_profile(NULL);

  SELECT id INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND: %', p_gw_code; END IF;

  INSERT INTO game.lineup_drafts (user_id, gameweek_id, mode, formation, slots)
  VALUES (v_auth, v_gw, p_mode, p_formation, p_slots)
  ON CONFLICT (user_id, gameweek_id, mode) DO UPDATE
    SET formation = EXCLUDED.formation,
        slots     = EXCLUDED.slots,
        updated_at = now();

  RETURN jsonb_build_object('saved', TRUE, 'mode', p_mode);
END;
$$;
GRANT EXECUTE ON FUNCTION game.save_draft(TEXT,TEXT,TEXT,JSONB) TO authenticated;

/**
 * הטיוטות שלי למחזור — שתי המצבים בקריאה אחת.
 *
 * ★ מחזירה גם את ההגשה הרשמית אם קיימת, כי המסך צריך לדעת
 *   בשנייה הראשונה אם הוא במצב עריכה או במצב "נעול".
 */
CREATE OR REPLACE FUNCTION game.my_drafts(p_gw_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_auth UUID := auth.uid(); v_gw UUID;
BEGIN
  IF v_auth IS NULL THEN RETURN '{}'::jsonb; END IF;
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw IS NULL THEN RETURN '{}'::jsonb; END IF;

  RETURN COALESCE((
    SELECT jsonb_object_agg(d.mode, jsonb_build_object(
             'formation', d.formation,
             'slots',     d.slots,
             'updatedAt', to_char(d.updated_at AT TIME ZONE 'UTC',
                                  'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
      FROM game.lineup_drafts d
     WHERE d.user_id = v_auth AND d.gameweek_id = v_gw
  ), '{}'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION game.my_drafts(TEXT) TO authenticated;

/** מחיקת טיוטה — "התחל מחדש" במסך. */
CREATE OR REPLACE FUNCTION game.discard_draft(p_gw_code TEXT, p_mode TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_auth UUID := auth.uid(); v_gw UUID;
BEGIN
  IF v_auth IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw IS NULL THEN RETURN; END IF;
  DELETE FROM game.lineup_drafts
   WHERE user_id = v_auth AND gameweek_id = v_gw AND mode = p_mode;
END;
$$;
GRANT EXECUTE ON FUNCTION game.discard_draft(TEXT,TEXT) TO authenticated;

-- =====================================================================
-- §6 ניהול — מה שאפשר לשנות, ומי רואה את זה
-- =====================================================================

-- ---------------------------------------------------------------- §6.1
/** קבוצה: שם, קיצור, עיר, אצטדיון. */
CREATE OR REPLACE FUNCTION game.admin_upsert_team(
  p_ext_team TEXT,
  p_name_he  TEXT,
  p_name_en  TEXT DEFAULT NULL,
  p_short    TEXT DEFAULT NULL,
  p_city     TEXT DEFAULT NULL,
  p_stadium  TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_team UUID; v_season UUID; v_ext TEXT := NULLIF(btrim(COALESCE(p_ext_team,'')), '');
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF btrim(COALESCE(p_name_he,'')) = '' THEN RAISE EXCEPTION 'NAME_REQUIRED'; END IF;

  SELECT s.id INTO v_season FROM core.seasons s
   ORDER BY s.is_current DESC, s.starts_on DESC NULLS LAST LIMIT 1;
  IF v_season IS NULL THEN RAISE EXCEPTION 'NO_SEASON'; END IF;

  IF v_ext IS NULL THEN
    -- מזהה חדש: הבא בתור במרחב המספרי הקיים.
    SELECT COALESCE(MAX(external_id::INT), 0) + 1 INTO v_ext
      FROM core.external_refs
     WHERE provider = 'manual_json' AND entity_type = 'team' AND external_id ~ '^[0-9]+$';

    INSERT INTO core.teams (country_code, names, short_code, city, stadium)
    VALUES ('IL',
            jsonb_build_object(
              'he', jsonb_build_object('full', btrim(p_name_he)),
              'en', jsonb_build_object('full',
                      COALESCE(NULLIF(btrim(p_name_en),''), btrim(p_name_he)))),
            COALESCE(NULLIF(btrim(p_short),''), btrim(p_name_he)),
            NULLIF(btrim(p_city),''), NULLIF(btrim(p_stadium),''))
    RETURNING id INTO v_team;

    INSERT INTO core.external_refs (provider, entity_type, external_id, entity_id)
    VALUES ('manual_json', 'team', v_ext, v_team);

    INSERT INTO core.team_seasons (team_id, season_id)
    VALUES (v_team, v_season) ON CONFLICT DO NOTHING;
  ELSE
    v_team := core.team_by_ext(v_ext);
    IF v_team IS NULL THEN RAISE EXCEPTION 'TEAM_NOT_FOUND: %', v_ext; END IF;

    UPDATE core.teams SET
      names = names || jsonb_build_object(
                'he', jsonb_build_object('full', btrim(p_name_he)),
                'en', jsonb_build_object('full',
                        COALESCE(NULLIF(btrim(p_name_en),''), names #>> '{en,full}',
                                 btrim(p_name_he)))),
      short_code = COALESCE(NULLIF(btrim(p_short),''),   short_code),
      city       = COALESCE(NULLIF(btrim(p_city),''),    city),
      stadium    = COALESCE(NULLIF(btrim(p_stadium),''), stadium)
    WHERE id = v_team;
  END IF;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (auth.uid()::TEXT, 'admin_upsert_team', 'team', v_ext,
          jsonb_build_object('nameHe', p_name_he, 'short', p_short,
                             'city', p_city, 'stadium', p_stadium));

  RETURN v_ext;
END;
$$;
GRANT EXECUTE ON FUNCTION
  game.admin_upsert_team(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO authenticated;

-- ---------------------------------------------------------------- §6.2
/**
 * משחק: הוספה או הזזה של שעה.
 *
 * ★ הזזת משחק מזיזה את הדדליין, אוטומטית.
 *   `lock_at` נגזר מחדש מהבעיטה המוקדמת ביותר במחזור. אחרת
 *   אדמין שדוחה משחק לשעה מוקדמת יותר משאיר חלון שבו אפשר
 *   להגיש הרכב אחרי שהוא כבר התחיל.
 */
CREATE OR REPLACE FUNCTION game.admin_upsert_fixture(
  p_gw_code  TEXT,
  p_ext_home TEXT,
  p_ext_away TEXT,
  p_kickoff  TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_gw UUID; v_home UUID; v_away UUID; v_match UUID;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  SELECT id INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND: %', p_gw_code; END IF;

  v_home := core.team_by_ext(p_ext_home);
  v_away := core.team_by_ext(p_ext_away);
  IF v_home IS NULL THEN RAISE EXCEPTION 'TEAM_NOT_FOUND: %', p_ext_home; END IF;
  IF v_away IS NULL THEN RAISE EXCEPTION 'TEAM_NOT_FOUND: %', p_ext_away; END IF;
  IF v_home = v_away THEN RAISE EXCEPTION 'SAME_TEAM'; END IF;

  INSERT INTO core.weekly_matches (gameweek_id, home_team_id, away_team_id, kickoff_at, status)
  VALUES (v_gw, v_home, v_away, p_kickoff, 'scheduled')
  ON CONFLICT (gameweek_id, home_team_id, away_team_id) DO UPDATE
    SET kickoff_at = EXCLUDED.kickoff_at
  RETURNING id INTO v_match;

  PERFORM game.admin_resync_deadline(p_gw_code);

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (auth.uid()::TEXT, 'admin_upsert_fixture', 'match', v_match::TEXT,
          jsonb_build_object('gw', p_gw_code, 'home', p_ext_home,
                             'away', p_ext_away, 'kickoff', p_kickoff));
  RETURN v_match;
END;
$$;

/** הסרת משחק מהלוח (נדחה, בוטל). */
CREATE OR REPLACE FUNCTION game.admin_delete_fixture(p_match_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_gw_code TEXT;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  SELECT gw.code INTO v_gw_code
    FROM core.weekly_matches m JOIN game.gameweeks gw ON gw.id = m.gameweek_id
   WHERE m.id = p_match_id;
  IF v_gw_code IS NULL THEN RAISE EXCEPTION 'MATCH_NOT_FOUND'; END IF;

  DELETE FROM core.weekly_matches WHERE id = p_match_id;
  PERFORM game.admin_resync_deadline(v_gw_code);

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, old_value)
  VALUES (auth.uid()::TEXT, 'admin_delete_fixture', 'match', p_match_id::TEXT,
          jsonb_build_object('gw', v_gw_code));
END;
$$;

-- ---------------------------------------------------------------- §6.3
/**
 * הדדליין = הבעיטה המוקדמת ביותר במחזור.
 *
 * ★ פונקציה ולא שדה שמוקלד: המידע כבר קיים בלוח, ושדה שני
 *   שמחזיק את אותה עובדה הוא שדה שיום אחד יסתור אותו.
 *
 * מוגדרת אחרי המשתמשות בה — ב-plpgsql זה חוקי, הקישור נעשה
 * בזמן ריצה.
 */
CREATE OR REPLACE FUNCTION game.admin_resync_deadline(p_gw_code TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_gw UUID; v_first TIMESTAMPTZ;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  SELECT id INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND: %', p_gw_code; END IF;

  SELECT min(kickoff_at) INTO v_first FROM core.weekly_matches WHERE gameweek_id = v_gw;
  IF v_first IS NULL THEN RETURN NULL; END IF;      -- מחזור בלי משחקים: לא נוגעים

  UPDATE game.gameweeks
     SET lock_at = v_first, first_kickoff_at = v_first
   WHERE id = v_gw;

  RETURN v_first;
END;
$$;

/** דדליין ידני — כשצריך לסגור מוקדם, או לפתוח שוב אחרי דחייה. */
CREATE OR REPLACE FUNCTION game.admin_set_deadline(p_gw_code TEXT, p_lock_at TIMESTAMPTZ)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF p_lock_at IS NULL THEN RAISE EXCEPTION 'LOCK_AT_REQUIRED'; END IF;

  UPDATE game.gameweeks SET lock_at = p_lock_at WHERE code = p_gw_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND: %', p_gw_code; END IF;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (auth.uid()::TEXT, 'admin_set_deadline', 'gameweek', p_gw_code,
          jsonb_build_object('lockAt', p_lock_at));
END;
$$;

/** סטטוס מחזור בשפת הקליינט (`gw-2`), לא ב-UUID. */
CREATE OR REPLACE FUNCTION game.admin_set_status(p_gw_code TEXT, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  /* ★ הרשימה הזו חייבת להיות זהה ל-CHECK על `game.gameweeks`.
     היא לא הייתה: db/01 הגדיר 'upcoming'/'settled', ו-db/09
     הרחיב את ה-CHECK ל-'draft'/'scoring'/'published'/'archived'
     בלי שהפונקציה הזו ידעה. התוצאה: `admin_set_status('published')`
     היה נדחה, ו-`admin_set_status('settled')` היה עובר את
     הבדיקה כאן ואז נופל על ה-CHECK — שתי שגיאות הפוכות באותה
     שורה. */
  IF p_status NOT IN ('draft','open','locked','live','scoring','published','archived') THEN
    RAISE EXCEPTION 'BAD_STATUS: %', p_status;
  END IF;

  UPDATE game.gameweeks SET status = p_status WHERE code = p_gw_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND: %', p_gw_code; END IF;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (auth.uid()::TEXT, 'admin_set_status', 'gameweek', p_gw_code,
          jsonb_build_object('status', p_status));
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_upsert_fixture(TEXT,TEXT,TEXT,TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION game.admin_delete_fixture(UUID)                       TO authenticated;
GRANT EXECUTE ON FUNCTION game.admin_resync_deadline(TEXT)                      TO authenticated;
GRANT EXECUTE ON FUNCTION game.admin_set_deadline(TEXT,TIMESTAMPTZ)             TO authenticated;
GRANT EXECUTE ON FUNCTION game.admin_set_status(TEXT,TEXT)                      TO authenticated;

-- ---------------------------------------------------------------- §6.4
--
--  ★ `admin_upsert_player` — חתימה חדשה, ולא overload.
--
--  הגרסה מ-`db/11` לא ידעה על `tier` / `overall_rank` / לאום /
--  קפטן מועדון, כי הם לא היו עמודות. עכשיו הם כן, ושחקן שנוסף
--  בלעדיהם היה מקבל דרג 3 ולא מדורג — כלומר נראה שונה מכל
--  שאר הליגה בלי שאף אחד ביקש.
--
--  ⚠ DROP מפורש. שתי גרסאות שנבדלות רק בפרמטרים עם DEFAULT הן
--    קריאה דו-משמעית: PostgREST היה בוחר אחת מהן, ולא בהכרח את
--    זו שהמסך התכוון אליה. עדיף להסיר.
DROP FUNCTION IF EXISTS game.admin_upsert_player(TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC,SMALLINT,TEXT);

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
    ------------------------------------------------------ שחקן חדש
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
    -------------------------------------------------------- עריכה
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
    WHERE player_id = v_player AND valid_to IS NULL;
  END IF;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (auth.uid()::TEXT, 'admin_upsert_player', 'player', v_ext,
          jsonb_build_object('team', p_ext_team, 'name', p_name_he,
                             'pos', p_position, 'price', p_price, 'status', p_status,
                             'tier', p_tier, 'rank', p_overall_rank));

  RETURN v_ext;
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_upsert_player(
  TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC,SMALLINT,TEXT,SMALLINT,INT,TEXT,BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------- §6.5
--
--  `admin_squads()` מורחבת: אותם שדות שהמסך הראשי מקבל, כדי
--  שמסך הניהול יערוך **בדיוק** את מה שהמשתמש רואה. שתי צורות
--  של אותה ישות הן שתי אמיתות שיתפצלו.
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
            'nationality', pl.nationality_he
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

-- =====================================================================
-- §7 בדיקת בריאות — עכשיו היא גם אומרת אם הדאטה **נקראת**
-- =====================================================================
DROP VIEW IF EXISTS game.v_live_health;
CREATE VIEW game.v_live_health AS
SELECT
  -- ★ `core.external_refs` ולא `core.v_ext`.
  --
  --   התצוגה `v_ext` נמחקת ונוצרת מחדש ב-`db/09` בכל הרצה. תצוגה
  --   שתלויה בה הופכת את `db/09` ללא-ניתן-להרצה-מחדש:
  --
  --       ERROR: cannot drop view v_ext because other objects
  --              depend on it
  --
  --   פונקציה שקוראת ל-`v_ext` לא יוצרת תלות כזו (הקישור הוא
  --   בזמן ריצה), ולכן `game.squads()` כן משתמשת בה. תצוגה כן.
  (SELECT count(*) FROM core.teams tm
     JOIN core.external_refs x ON x.provider = 'manual_json'
      AND x.entity_type = 'team' AND x.entity_id = tm.id)               AS mapped_teams,
  (SELECT count(*) FROM core.squads WHERE valid_to IS NULL)             AS active_players,
  (SELECT count(*) FROM core.squads
    WHERE valid_to IS NULL AND fantasy_price IS NULL)                   AS players_without_price,
  (SELECT count(*) FROM core.squads WHERE valid_to IS NULL AND tier IS NULL) AS players_without_tier,
  (SELECT count(*) FROM core.teams WHERE short_code IS NULL)            AS teams_without_short,
  (SELECT count(*) FROM core.weekly_matches)                            AS matches,
  (SELECT count(*) FROM game.lineup_drafts)                             AS drafts,
  (SELECT revision FROM game.data_revision WHERE id = 1)                AS revision;

GRANT SELECT ON game.v_live_health TO authenticated;

/* ★ הגרסה עלתה ב-DDL של הקובץ הזה (הטריגרים נוצרו אחרי המילוי),
   וזה בדיוק מה שצריך: לקוח שהיה פתוח בזמן המיגרציה יגלה שהעולם
   השתנה וימשוך מחדש. */
UPDATE game.data_revision SET revision = revision + 1, scope = 'migration-13' WHERE id = 1;
