-- =====================================================================
--  db/26_ingest.sql · קליטה אוטומטית ממקורות חינמיים
--
--  מה הקובץ הזה עושה, בשורה אחת:
--  נותן למערכת דרך אחת לכתוב דאטת כדורגל שהגיעה מהאינטרנט,
--  ולסובב את המחזור קדימה בלי שאף אדם ילחץ על כלום.
--
--  ═══════════════════════════════════════════════════════════════
--  ★ ההחלטה המרכזית: נתיב כתיבה אחד, ולא שניים
--  ═══════════════════════════════════════════════════════════════
--
--  ה-Edge Function לא כותב לטבלאות. הוא שולח JSON קנוני אחד
--  ל-`game.ingest_snapshot`, וזו הפונקציה היחידה שנוגעת בדאטה.
--  לכן:
--    · כל קליטה היא טרנזקציה אחת — או הכל נכנס, או כלום
--    · אותם חוקים (שער נקי, ספיגות) חלים על קליטה אוטומטית
--      ועל תיקון ידני של אדמין, כי שניהם עוברים ב-
--      `core.apply_player_stat`
--    · להחליף ספק = לכתוב מתאם חדש. המסד לא משתנה בכלל.
--
--  ★ שמות שדות של ספק לא מופיעים בקובץ הזה. אף פעם.
--    אם 'onTargetScoringAttempt' יופיע כאן, הספק הפך לבלתי
--    ניתן להחלפה — וזה בדיוק מה שהמסמך הזה בא למנוע.
--
--  ═══════════════════════════════════════════════════════════════
--  ★ למה אוטומציה מלאה ובכל זאת בלמים
--  ═══════════════════════════════════════════════════════════════
--
--  אין לחיצה ידנית. יש **תנאי סף** לפרסום: כל המשחקים הסתיימו,
--  טביעת האצבע של הנתונים לא זזה כמה דקות, ואין התרעה פתוחה.
--  התרעה = שחקן בהרכב של מישהו שלא מופה, החלטת VAR, כרטיס
--  שבוטל, משחק שנדחה. במצב כזה המערכת **מחכה ומסבירה**, ולא
--  מפרסמת ניקוד שגוי. אדמין יכול לשחרר בקליק.
--
--  זה לא "התערבות אדם" — זה חגורת בטיחות שברוב המחזורים
--  לא נוגעים בה.
-- =====================================================================

BEGIN;

-- =====================================================================
--  §0 · מי מורשה לכתוב דאטה
-- =====================================================================
--
--  שלוש זהויות נוגעות בדאטה, ולכל אחת סיבה:
--
--    אדמין        — בן אדם מחובר, מתקן ידנית
--    service_role — ה-Edge Function, מריץ את הקליטה
--    pg_cron      — המתזמן בתוך המסד, מסובב את המחזור
--
--  ★ סימן זיהוי אחד בלבד: תביעת ה-JWT. לא `current_user` ולא
--    `session_user`.
--
--    `SECURITY DEFINER` מחליף את `current_user` לבעלים (postgres),
--    ולכן בדיקה לפיו הייתה הופכת כל משתמש מחובר למערכת.
--    `session_user = 'postgres'` נשמע בטוח — הוא נכון ל-pg_cron
--    ולא לבקשת PostgREST — אבל הוא גם נכון לכל הרצה מה-SQL
--    Editor ומכלי בדיקה, וכך **הבדיקות שמוודאות שמשתמש רגיל
--    חסום הפסיקו לבדוק משהו**. זו התראה אמיתית שנתפסה בשער.
--
--    לכן pg_cron מצהיר על עצמו במפורש, שורה אחת לפני הקריאה:
--        SELECT set_config('request.jwt.claims','{"role":"service_role"}',TRUE);
--    (ראו db/27_cron.sql). מי שלא הצהיר — אינו מערכת.

CREATE OR REPLACE FUNCTION game.is_system()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
      NULLIF(current_setting('request.jwt.claims', TRUE), '')::jsonb ->> 'role',
      ''
    ) = 'service_role';
$$;
COMMENT ON FUNCTION game.is_system() IS
  'TRUE ל-Edge Function (service_role) ול-pg_cron שמצהיר על התפקיד. לא לבן אדם מחובר.';

CREATE OR REPLACE FUNCTION game.can_write_data()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT game.is_admin() OR game.is_system();
$$;

/* מי ביצע את הפעולה — ליומן הביקורת. */
CREATE OR REPLACE FUNCTION game.actor_label()
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT COALESCE(auth.uid()::TEXT,
                  CASE WHEN game.is_system() THEN 'system:ingest' ELSE 'unknown' END);
$$;

-- =====================================================================
--  §1 · טבלאות
-- =====================================================================

/* הגדרות הקליטה. שורה אחת. מי שרוצה לכבות מקור — מעדכן פה,
   לא מוחק פונקציה ולא מבטל cron. */
CREATE TABLE IF NOT EXISTS game.ingest_config (
  id                  BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  enabled             BOOLEAN NOT NULL DEFAULT TRUE,
  /* כמה דקות הנתונים צריכים לא לזוז לפני פרסום אוטומטי.
     ★ 45 ולא 5: סטטיסטיקה מאוחרת מגיעה עשרות דקות אחרי השריקה. */
  stable_minutes      SMALLINT NOT NULL DEFAULT 45,
  /* פרסום אוטומטי בכלל. כיבוי = המערכת עוצרת ב-scoring ומחכה. */
  auto_publish        BOOLEAN NOT NULL DEFAULT TRUE,
  /* פתיחה אוטומטית של המחזור הבא. */
  auto_open_next      BOOLEAN NOT NULL DEFAULT TRUE,
  /* מיפוי אוטומטי של שחקן חדש כשהביטחון מספיק. */
  auto_map_players    BOOLEAN NOT NULL DEFAULT TRUE,
  /* סף דמיון שמות (0–1). מתחתיו — לא ממפים, שולחים לאדמין.
     ★ 0.62 הוא סף שמרני בכוונה: מיפוי שגוי נותן נקודות לשחקן
       הלא נכון ואף אחד לא מבחין. חוסר מיפוי צועק. */
  name_threshold      NUMERIC(3,2) NOT NULL DEFAULT 0.62,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO game.ingest_config (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

/* ריצה אחת של הקליטה. */
CREATE TABLE IF NOT EXISTS game.ingest_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source       TEXT NOT NULL,                 -- 'sofascore' | 'scores365' | ...
  phase        TEXT NOT NULL,                 -- 'fixtures' | 'live' | 'final' | 'squads' | 'sweep'
  gw_code      TEXT,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'running'
               CHECK (status IN ('running','ok','partial','failed')),
  fixtures_seen  INT NOT NULL DEFAULT 0,
  players_seen   INT NOT NULL DEFAULT 0,
  players_mapped INT NOT NULL DEFAULT 0,
  unmapped_count INT NOT NULL DEFAULT 0,
  report       JSONB NOT NULL DEFAULT '{}'::jsonb,
  error        TEXT
);
CREATE INDEX IF NOT EXISTS ingest_runs_recent ON game.ingest_runs (started_at DESC);

/* ה-JSON הגולמי כפי שהגיע. append-only.
   ★ בלי זה, "למה השחקן קיבל 3 נקודות בשבוע שעבר" היא שאלה
     שאי אפשר לענות עליה אחרי שהספק עדכן את עצמו. */
CREATE TABLE IF NOT EXISTS core.ingest_raw (
  id           BIGSERIAL PRIMARY KEY,
  run_id       UUID REFERENCES game.ingest_runs(id) ON DELETE SET NULL,
  source       TEXT NOT NULL,
  kind         TEXT NOT NULL,                 -- 'round' | 'lineups' | 'incidents' | 'squad'
  external_id  TEXT,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  sha256       TEXT NOT NULL,
  payload      JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS ingest_raw_lookup ON core.ingest_raw (source, kind, external_id, fetched_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ingest_raw_dedupe ON core.ingest_raw (source, kind, COALESCE(external_id,''), sha256);

CREATE OR REPLACE FUNCTION core.append_only_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY: % אינה מקבלת % — תיקון הוא שורה חדשה',
        TG_TABLE_NAME, TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS ingest_raw_append_only ON core.ingest_raw;
CREATE TRIGGER ingest_raw_append_only
  BEFORE UPDATE OR DELETE ON core.ingest_raw
  FOR EACH ROW EXECUTE FUNCTION core.append_only_guard();

/* ישות של ספק שלא הצלחנו למפות. זו רשימת העבודה של האדמין. */
CREATE TABLE IF NOT EXISTS game.ingest_unmapped (
  id            BIGSERIAL PRIMARY KEY,
  source        TEXT NOT NULL,
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('team','player','match')),
  external_id   TEXT NOT NULL,
  name_raw      TEXT,
  name_he       TEXT,
  team_ext      TEXT,                          -- 'T3' אם ידוע
  shirt_number  SMALLINT,
  position      TEXT,
  /* מועמדים מדורגים — מה שהאדמין רואה ככפתורים */
  candidates    JSONB NOT NULL DEFAULT '[]'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  seen_count    INT NOT NULL DEFAULT 1,
  /* TRUE כשהשחקן הזה מופיע בהרכב מוגש — אז זה חוסם פרסום */
  blocking      BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at   TIMESTAMPTZ,
  resolved_to   UUID,
  UNIQUE (source, entity_type, external_id)
);
CREATE INDEX IF NOT EXISTS ingest_unmapped_open ON game.ingest_unmapped (source, entity_type)
  WHERE resolved_at IS NULL;

/* תיקונים. append-only, כמו לוג האירועים. */
CREATE TABLE IF NOT EXISTS core.stat_corrections (
  id           BIGSERIAL PRIMARY KEY,
  match_id     UUID NOT NULL REFERENCES core.weekly_matches(id) ON DELETE CASCADE,
  player_id    UUID NOT NULL REFERENCES core.players(id) ON DELETE CASCADE,
  actor        TEXT NOT NULL,
  reason       TEXT,
  before_value JSONB,
  after_value  JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stat_corrections_match ON core.stat_corrections (match_id, created_at DESC);

DROP TRIGGER IF EXISTS stat_corrections_append_only ON core.stat_corrections;
CREATE TRIGGER stat_corrections_append_only
  BEFORE UPDATE OR DELETE ON core.stat_corrections
  FOR EACH ROW EXECUTE FUNCTION core.append_only_guard();

/* טביעת אצבע למחזור + מתי השתנתה. זה מה שקובע יציבות. */
CREATE TABLE IF NOT EXISTS game.gameweek_fingerprints (
  gameweek_id  UUID PRIMARY KEY REFERENCES game.gameweeks(id) ON DELETE CASCADE,
  fingerprint  TEXT NOT NULL,
  since        TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  /* טביעת האצבע ברגע הפרסום. שינוי אחריה = התרעה. */
  published_fingerprint TEXT
);

/* התרעות שחוסמות פרסום אוטומטי. */
CREATE TABLE IF NOT EXISTS game.ingest_alerts (
  id           BIGSERIAL PRIMARY KEY,
  gw_code      TEXT,
  kind         TEXT NOT NULL,                  -- 'unmapped_in_lineup'|'var'|'card_rescinded'|
                                               -- 'fixture_not_final'|'changed_after_publish'|'source_down'
  severity     TEXT NOT NULL DEFAULT 'block' CHECK (severity IN ('block','warn')),
  detail       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  cleared_at   TIMESTAMPTZ,
  cleared_by   TEXT
);
/* ★ אינדקס ולא CHECK/UNIQUE רגיל: המפתח כולל ביטוי (`md5`),
   ואילוץ UNIQUE לא מקבל ביטויים. חלקי על `cleared_at IS NULL`
   בכוונה — אחרי ששחררו התרעה, הופעה חדשה שלה צריכה להתריע שוב. */
CREATE UNIQUE INDEX IF NOT EXISTS ingest_alerts_dedupe
  ON game.ingest_alerts (COALESCE(gw_code, ''), kind, md5(detail::TEXT))
  WHERE cleared_at IS NULL;
CREATE INDEX IF NOT EXISTS ingest_alerts_open ON game.ingest_alerts (gw_code)
  WHERE cleared_at IS NULL;

/* RLS: אף אחת מהטבלאות האלה לא נקראת ישירות מהדפדפן.
   הכל עובר בפונקציות SECURITY DEFINER, כמו db/18. */
DO $rls$
BEGIN
  ALTER TABLE game.ingest_config          ENABLE ROW LEVEL SECURITY;
  ALTER TABLE game.ingest_runs            ENABLE ROW LEVEL SECURITY;
  ALTER TABLE core.ingest_raw             ENABLE ROW LEVEL SECURITY;
  ALTER TABLE game.ingest_unmapped        ENABLE ROW LEVEL SECURITY;
  ALTER TABLE core.stat_corrections       ENABLE ROW LEVEL SECURITY;
  ALTER TABLE game.gameweek_fingerprints  ENABLE ROW LEVEL SECURITY;
  ALTER TABLE game.ingest_alerts          ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'RLS לא הופעל (הרשאות) — לא קריטי במסד בדיקות';
END
$rls$;

COMMIT;

BEGIN;

-- =====================================================================
--  §2 · מיפוי ספקים — איפה שהכי קל לטעות
-- =====================================================================
--
--  ★ הבעיה, במספרים: בקובץ הסגלים יש 457 שחקנים, לכולם שם
--    עברי בלבד (`name_en` = "TBD"), ול-101 מהם אין מספר חולצה.
--    לספק הזר יש שם לטיני ומספר חולצה. אין שדה משותף אחד
--    שמספיק לבדו.
--
--  ★ לכן: לא התאמה מטושטשת על הכל. שלוש דרגות ביטחון, לפי סדר,
--    וכל מה שלא עבר — לא מנוחש. הוא עולה לרשימה של האדמין.
--
--      1. מספר חולצה בתוך הקבוצה, כשהוא יחיד וגם העמדה מתאימה
--      2. שם מנורמל זהה (עברית מול עברית, או לטינית מול לטינית)
--      3. דמיון שם מעל סף, עם **פער** ברור מהמועמד הבא
--
--    שלב 3 בלי בדיקת פער היה בוחר בין שני אחים באותה קבוצה
--    לפי הפרש של 0.01. הפער הוא מה שהופך את זה לבטוח.

/* קישור ישות לספק. */
CREATE OR REPLACE FUNCTION core.provider_link(
  p_source TEXT, p_type TEXT, p_ext TEXT, p_entity UUID, p_payload JSONB DEFAULT NULL
)
RETURNS VOID LANGUAGE sql
SET search_path = core, public AS $$
  INSERT INTO core.external_refs (provider, entity_type, external_id, entity_id, payload, synced_at)
  VALUES (p_source, p_type, p_ext, p_entity, p_payload, now())
  ON CONFLICT (provider, entity_type, external_id) DO UPDATE
    SET entity_id = EXCLUDED.entity_id,
        payload   = COALESCE(EXCLUDED.payload, core.external_refs.payload),
        synced_at = now();
$$;

CREATE OR REPLACE FUNCTION core.entity_by_provider(p_source TEXT, p_type TEXT, p_ext TEXT)
RETURNS UUID LANGUAGE sql STABLE
SET search_path = core, public AS $$
  SELECT entity_id FROM core.external_refs
   WHERE provider = p_source AND entity_type = p_type AND external_id = p_ext;
$$;

/* הקוד הפנימי ('T3' / 'P305') של ישות — לתצוגה ולתאימות. */
CREATE OR REPLACE FUNCTION core.ext_code(p_type TEXT, p_entity UUID)
RETURNS TEXT LANGUAGE sql STABLE
SET search_path = core, public AS $$
  SELECT external_id FROM core.external_refs
   WHERE provider = 'manual_json' AND entity_type = p_type AND entity_id = p_entity;
$$;

-- ---------------------------------------------------------------------
--  כינויי הקבוצות — 14 שורות כתובות ביד
-- ---------------------------------------------------------------------
--  ★ למה ביד ולא אלגוריתם: ארבע עשרה שורות שלא טועות לעולם,
--    מול התאמה מטושטשת שתחליף יום אחד בין "מכבי פתח תקווה"
--    ל"הפועל פתח תקווה" ותיתן לקבוצה אחת את התוצאות של השנייה.
--    הכתיבים כאן הם מה שהמקורות מחזירים בפועל.
DO $aliases$
DECLARE
  r RECORD;
  v_team UUID;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('T1',  'Hapoel Be''er Sheva',          'הפועל באר שבע'),
      ('T2',  'Hapoel Jerusalem',             'הפועל ירושלים'),
      ('T3',  'Maccabi Tel Aviv',             'מכבי תל אביב'),
      ('T4',  'Maccabi Haifa',                'מכבי חיפה'),
      ('T5',  'Beitar Jerusalem',             'בית״ר ירושלים'),
      ('T6',  'Hapoel Tel Aviv',              'הפועל תל אביב'),
      ('T7',  'Maccabi Netanya',              'מכבי נתניה'),
      ('T8',  'Bnei Sakhnin',                 'בני סכנין'),
      ('T9',  'Hapoel Haifa',                 'הפועל חיפה'),
      ('T10', 'Hapoel Ironi Kiryat Shmona',   'עירוני קרית שמונה'),
      ('T11', 'Ironi Dorot Tiberias',         'עירוני טבריה'),
      ('T12', 'Maccabi Petach Tikva',         'מכבי פתח תקווה'),
      ('T13', 'Hapoel Ramat Gan Givataim',    'הפועל רמת גן'),
      ('T14', 'Hapoel Petach Tikva',          'הפועל פתח תקווה'),
      -- כתיבים נוספים שנראו בשטח
      ('T10', 'Ironi Kiryat Shmona',          'עירוני קריית שמונה'),
      ('T11', 'Ironi Tiberias',               'עירוני טבריה מ.ס'),
      ('T12', 'Maccabi Petah Tikva',          'מכבי פ״ת'),
      ('T14', 'Hapoel Petah Tikva',           'הפועל פ״ת'),
      ('T13', 'Hapoel Ramat Gan',             'הפועל רמת גן גבעתיים'),
      ('T8',  'Bnei Sakhnin FC',              'איחוד בני סכנין'),
      ('T1',  'Hapoel Beer Sheva',            'הפועל ב״ש'),
      ('T5',  'Beitar Jerusalem FC',          'ביתר ירושלים')
    ) AS t(ext, name_en, name_he)
  LOOP
    v_team := core.team_by_ext(r.ext);
    CONTINUE WHEN v_team IS NULL;

    INSERT INTO core.entity_aliases (entity_type, entity_id, locale, alias, source)
    VALUES ('team', v_team, 'en', r.name_en, 'ingest_seed')
    ON CONFLICT (entity_type, entity_id, locale, alias) DO NOTHING;

    INSERT INTO core.entity_aliases (entity_type, entity_id, locale, alias, source)
    VALUES ('team', v_team, 'he', r.name_he, 'ingest_seed')
    ON CONFLICT (entity_type, entity_id, locale, alias) DO NOTHING;
  END LOOP;
END
$aliases$;

/**
 * פתרון קבוצה. מקשר בפעם הראשונה שרואים אותה, ומאז זה חיפוש מפתח.
 */
CREATE OR REPLACE FUNCTION game.ingest_resolve_team(
  p_source TEXT, p_ext TEXT, p_name_en TEXT DEFAULT NULL, p_name_he TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = core, game, public
AS $$
DECLARE v_team UUID;
BEGIN
  v_team := core.entity_by_provider(p_source, 'team', p_ext);
  IF v_team IS NOT NULL THEN RETURN v_team; END IF;

  /* שם מנורמל — כינוי או שם הקבוצה עצמה */
  SELECT a.entity_id INTO v_team
    FROM core.entity_aliases a
   WHERE a.entity_type = 'team'
     AND a.alias_norm IN (core.normalize_name(p_name_en), core.normalize_name(p_name_he))
   LIMIT 1;

  IF v_team IS NULL THEN
    SELECT t.id INTO v_team FROM core.teams t
     WHERE core.normalize_name(t.name_en) = core.normalize_name(p_name_en)
        OR core.normalize_name(t.name_he) = core.normalize_name(p_name_he)
     LIMIT 1;
  END IF;

  IF v_team IS NOT NULL THEN
    PERFORM core.provider_link(p_source, 'team', p_ext, v_team,
              jsonb_build_object('nameEn', p_name_en, 'nameHe', p_name_he));
    RETURN v_team;
  END IF;

  INSERT INTO game.ingest_unmapped (source, entity_type, external_id, name_raw, name_he)
  VALUES (p_source, 'team', p_ext, p_name_en, p_name_he)
  ON CONFLICT (source, entity_type, external_id) DO UPDATE
    SET last_seen_at = now(), seen_count = game.ingest_unmapped.seen_count + 1;

  RETURN NULL;
END;
$$;

/**
 * פתרון שחקן. הלב של המיפוי.
 *
 * מחזיר UUID כשהביטחון מספיק, ו-NULL כשלא — ואז השחקן נרשם
 * ברשימת המיפוי של האדמין עם עד שלושה מועמדים.
 */
CREATE OR REPLACE FUNCTION game.ingest_resolve_player(
  p_source   TEXT,
  p_ext      TEXT,
  p_team     UUID,
  p_name_raw TEXT DEFAULT NULL,
  p_name_he  TEXT DEFAULT NULL,
  p_shirt    SMALLINT DEFAULT NULL,
  p_position TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = core, game, public
AS $$
DECLARE
  v_player   UUID;
  v_cfg      game.ingest_config%ROWTYPE;
  v_how      TEXT;
  v_n        INT;
  v_best     NUMERIC;
  v_second   NUMERIC;
  v_cands    JSONB := '[]'::jsonb;
BEGIN
  v_player := core.entity_by_provider(p_source, 'player', p_ext);
  IF v_player IS NOT NULL THEN RETURN v_player; END IF;

  SELECT * INTO v_cfg FROM game.ingest_config WHERE id;

  IF p_team IS NOT NULL AND COALESCE(v_cfg.auto_map_players, TRUE) THEN

    /* ── 1. מספר חולצה בתוך הקבוצה ─────────────────────────────
       ★ רק כשהוא **יחיד**. שני שחקנים עם אותו מספר בסגל הם
         באג ידוע בקבצי סגלים, ובמקרה כזה המספר לא ראיה. */
    IF p_shirt IS NOT NULL THEN
      SELECT count(*) INTO v_n
        FROM core.squads s
       WHERE s.team_id = p_team AND s.valid_to IS NULL
         AND s.status <> 'left' AND s.shirt_number = p_shirt;

      IF v_n = 1 THEN
        SELECT s.player_id INTO v_player
          FROM core.squads s
         WHERE s.team_id = p_team AND s.valid_to IS NULL
           AND s.status <> 'left' AND s.shirt_number = p_shirt;
        v_how := 'shirt';
      END IF;
    END IF;

    /* ── 2. שם מנורמל זהה בתוך הקבוצה ──────────────────────── */
    IF v_player IS NULL THEN
      SELECT count(*) INTO v_n
        FROM core.squads s JOIN core.players pl ON pl.id = s.player_id
       WHERE s.team_id = p_team AND s.valid_to IS NULL AND s.status <> 'left'
         AND (core.normalize_name(pl.name_he) = core.normalize_name(p_name_he)
           OR core.normalize_name(pl.name_en) = core.normalize_name(p_name_raw));

      IF v_n = 1 THEN
        SELECT s.player_id INTO v_player
          FROM core.squads s JOIN core.players pl ON pl.id = s.player_id
         WHERE s.team_id = p_team AND s.valid_to IS NULL AND s.status <> 'left'
           AND (core.normalize_name(pl.name_he) = core.normalize_name(p_name_he)
             OR core.normalize_name(pl.name_en) = core.normalize_name(p_name_raw));
        v_how := 'name_exact';
      END IF;
    END IF;

    /* ── 3. דמיון שם, עם פער ─────────────────────────────────── */
    IF v_player IS NULL AND COALESCE(p_name_he, p_name_raw) IS NOT NULL THEN
      WITH scored AS (
        SELECT s.player_id,
               GREATEST(
                 similarity(core.normalize_name(pl.name_he), core.normalize_name(COALESCE(p_name_he, ''))),
                 similarity(core.normalize_name(COALESCE(pl.name_en, '')), core.normalize_name(COALESCE(p_name_raw, '')))
               ) AS score,
               pl.name_he, pl.name_en, s.shirt_number, s.position
          FROM core.squads s JOIN core.players pl ON pl.id = s.player_id
         WHERE s.team_id = p_team AND s.valid_to IS NULL AND s.status <> 'left'
         ORDER BY score DESC
         LIMIT 3
      )
      SELECT jsonb_agg(jsonb_build_object(
               'extPlayer', core.ext_code('player', player_id),
               'nameHe', name_he, 'shirt', shirt_number,
               'position', position, 'score', round(score::NUMERIC, 3)))
        INTO v_cands FROM scored;

      SELECT (v_cands->0->>'score')::NUMERIC, (v_cands->1->>'score')::NUMERIC
        INTO v_best, v_second;

      /* ★ שני תנאים, לא אחד: מעל הסף **וגם** פער של 0.12
         מהמועמד הבא. בלי הפער, שני שמות דומים בתוך אותה
         קבוצה הם הגרלה. */
      IF v_best IS NOT NULL
         AND v_best >= v_cfg.name_threshold
         AND (v_second IS NULL OR v_best - v_second >= 0.12)
      THEN
        SELECT core.player_by_ext(v_cands->0->>'extPlayer') INTO v_player;
        v_how := 'name_similar';
      END IF;
    END IF;
  END IF;

  IF v_player IS NOT NULL THEN
    PERFORM core.provider_link(p_source, 'player', p_ext, v_player,
              jsonb_build_object('nameRaw', p_name_raw, 'shirt', p_shirt,
                                 'matchedBy', v_how));

    INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
    VALUES (game.actor_label(), 'ingest_automap', 'player', p_ext,
            jsonb_build_object('source', p_source, 'by', v_how,
                               'name', p_name_raw, 'shirt', p_shirt,
                               'player', core.ext_code('player', v_player)));
    RETURN v_player;
  END IF;

  /* לא מופה — רשימת העבודה של האדמין, לא שקט */
  INSERT INTO game.ingest_unmapped
    (source, entity_type, external_id, name_raw, name_he, team_ext, shirt_number, position, candidates)
  VALUES (p_source, 'player', p_ext, p_name_raw, p_name_he,
          core.ext_code('team', p_team), p_shirt, p_position, COALESCE(v_cands, '[]'::jsonb))
  ON CONFLICT (source, entity_type, external_id) DO UPDATE
    SET last_seen_at = now(),
        seen_count   = game.ingest_unmapped.seen_count + 1,
        candidates   = EXCLUDED.candidates,
        team_ext     = COALESCE(EXCLUDED.team_ext, game.ingest_unmapped.team_ext),
        shirt_number = COALESCE(EXCLUDED.shirt_number, game.ingest_unmapped.shirt_number);

  RETURN NULL;
END;
$$;

COMMIT;

BEGIN;

-- =====================================================================
--  §3 · הרחבת ההרשאה — שינוי אחד במקום עשרים
-- =====================================================================
--
--  ★ הקליטה צריכה להריץ את אותן פונקציות אדמין שקיימות מאז db/09:
--    יצירת מחזור, קליטת לוח, פרסום. שלוש אפשרויות היו על השולחן:
--
--      א. להעתיק כל פונקציה עם בדיקה אחרת → עשרים עותקים שיסטו
--      ב. לתת ל-Edge Function טוקן של אדמין אמיתי → סוד בקוד
--      ג. להרחיב את `is_admin()` עצמה                  ← זה
--
--    ג' משנה שורה אחת, ואין שום פונקציה כפולה במסד.
--    `is_system()` נכון רק ל-service_role ול-pg_cron — שניהם
--    כבר עוקפים RLS ממילא, ולכן לא נפתחה כאן שום דלת חדשה.

CREATE OR REPLACE FUNCTION game.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, public AS $$
  SELECT COALESCE((SELECT is_admin FROM game.users WHERE id = auth.uid()), FALSE)
      OR game.is_system();
$$;

-- =====================================================================
--  §4 · כתיבת סטטיסטיקה — מקום אחד, חוק אחד
-- =====================================================================
--
--  ★ גם הקליטה האוטומטית וגם תיקון ידני של אדמין עוברים כאן.
--    אחרת "שער נקי" היה מחושב אחרת בשני המסלולים, ואף אחד לא
--    היה מגלה עד שמישהו יתלונן על ארבע נקודות.
--
--  ★ `clean_sheet` **נגזר**, לא מתקבל מהספק: המשחק הסתיים,
--    הוא ספג אפס, והוא היה על המגרש. סף הדקות (60) הוא חוק
--    ניקוד ויושב ב-ruleset — לא כאן.

CREATE OR REPLACE FUNCTION core.apply_player_stat(
  p_match  UUID,
  p_player UUID,
  p_team   UUID,
  p_stats  JSONB,
  p_actor  TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN            -- TRUE אם משהו באמת השתנה
LANGUAGE plpgsql
SET search_path = core, game, public
AS $$
DECLARE
  v_before   JSONB;
  v_finished BOOLEAN;
  v_minutes  SMALLINT := COALESCE((p_stats->>'minutes')::SMALLINT, 0);
  v_conceded SMALLINT := COALESCE((p_stats->>'goalsConceded')::SMALLINT, 0);
  v_clean    BOOLEAN;
  v_changed  BOOLEAN;
BEGIN
  SELECT (status = 'finished') INTO v_finished
    FROM core.weekly_matches WHERE id = p_match;

  v_clean := COALESCE(v_finished, FALSE) AND v_conceded = 0 AND v_minutes > 0;

  SELECT to_jsonb(s) INTO v_before
    FROM core.player_match_stats s
   WHERE s.match_id = p_match AND s.player_id = p_player;

  INSERT INTO core.player_match_stats (
    match_id, player_id, team_id, minutes, started, goals, assists, own_goals,
    yellow_cards, red_cards, saves, penalties_saved, penalties_missed,
    goals_conceded, clean_sheet, extra, updated_at)
  VALUES (
    p_match, p_player, p_team, v_minutes,
    COALESCE((p_stats->>'started')::BOOLEAN, FALSE),
    COALESCE((p_stats->>'goals')::SMALLINT, 0),
    COALESCE((p_stats->>'assists')::SMALLINT, 0),
    COALESCE((p_stats->>'ownGoals')::SMALLINT, 0),
    COALESCE((p_stats->>'yellowCards')::SMALLINT, 0),
    COALESCE((p_stats->>'redCards')::SMALLINT, 0),
    COALESCE((p_stats->>'saves')::SMALLINT, 0),
    COALESCE((p_stats->>'penaltiesSaved')::SMALLINT, 0),
    COALESCE((p_stats->>'penaltiesMissed')::SMALLINT, 0),
    v_conceded, v_clean,
    COALESCE(p_stats->'extra', '{}'::jsonb),
    now())
  ON CONFLICT (match_id, player_id) DO UPDATE SET
    team_id = EXCLUDED.team_id, minutes = EXCLUDED.minutes,
    started = EXCLUDED.started, goals = EXCLUDED.goals,
    assists = EXCLUDED.assists, own_goals = EXCLUDED.own_goals,
    yellow_cards = EXCLUDED.yellow_cards, red_cards = EXCLUDED.red_cards,
    saves = EXCLUDED.saves, penalties_saved = EXCLUDED.penalties_saved,
    penalties_missed = EXCLUDED.penalties_missed,
    goals_conceded = EXCLUDED.goals_conceded, clean_sheet = EXCLUDED.clean_sheet,
    extra = EXCLUDED.extra, updated_at = now();

  /* השתנה? משווים רק את השדות שמשפיעים על ניקוד — `extra`
     ו-`updated_at` זזים כל קליטה ואינם שינוי אמיתי. */
  SELECT (v_before IS NULL) OR (
      (v_before->>'minutes')          IS DISTINCT FROM (p_stats->>'minutes')
   OR (v_before->>'goals')            IS DISTINCT FROM COALESCE(p_stats->>'goals','0')
   OR (v_before->>'assists')          IS DISTINCT FROM COALESCE(p_stats->>'assists','0')
   OR (v_before->>'own_goals')        IS DISTINCT FROM COALESCE(p_stats->>'ownGoals','0')
   OR (v_before->>'yellow_cards')     IS DISTINCT FROM COALESCE(p_stats->>'yellowCards','0')
   OR (v_before->>'red_cards')        IS DISTINCT FROM COALESCE(p_stats->>'redCards','0')
   OR (v_before->>'saves')            IS DISTINCT FROM COALESCE(p_stats->>'saves','0')
   OR (v_before->>'goals_conceded')   IS DISTINCT FROM COALESCE(p_stats->>'goalsConceded','0')
   OR (v_before->>'clean_sheet')::BOOLEAN IS DISTINCT FROM v_clean
  ) INTO v_changed;

  /* תיקון על נתון שכבר היה — נרשם. לא נדרס בשקט. */
  IF v_before IS NOT NULL AND v_changed THEN
    INSERT INTO core.stat_corrections (match_id, player_id, actor, reason, before_value, after_value)
    VALUES (p_match, p_player, COALESCE(p_actor, game.actor_label()),
            COALESCE(p_reason, 'ingest'), v_before, p_stats);
  END IF;

  RETURN v_changed;
END;
$$;

/* התיקון הידני של האדמין עובר עכשיו באותה פונקציה בדיוק. */
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
   WHERE player_id = v_player AND valid_to IS NULL AND status <> 'left' LIMIT 1;
  IF v_team IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_IN_SQUAD'; END IF;

  SELECT id INTO v_match FROM core.weekly_matches
   WHERE gameweek_id = v_gw AND (home_team_id = v_team OR away_team_id = v_team) LIMIT 1;
  IF v_match IS NULL THEN RAISE EXCEPTION 'MATCH_NOT_FOUND_FOR_TEAM'; END IF;

  PERFORM core.apply_player_stat(v_match, v_player, v_team, p_stats,
                                 game.actor_label(), 'admin_manual');
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_upsert_player_stat(TEXT,TEXT,JSONB) TO authenticated;

COMMIT;

BEGIN;

-- =====================================================================
--  §5 · הקליטה — נתיב הכתיבה היחיד
-- =====================================================================
--
--  מבנה ה-JSON שהמתאם שולח (קנוני, בלי שום שדה של ספק):
--
--  {
--    "phase": "fixtures|live|final|sweep",
--    "gameweek": { "number": 5 },
--    "fixtures": [{ "providerId", "home":{id,nameEn,nameHe}, "away":{...},
--                   "kickoff", "status", "homeGoals", "awayGoals" }],
--    "stats":    [{ "matchProviderId", "team":{id,nameEn},
--                   "player":{id,nameEn,nameHe,shirt,position},
--                   "minutes","started","goals","assists","ownGoals",
--                   "yellowCards","redCards","saves","penaltiesSaved",
--                   "penaltiesMissed","goalsConceded","extra" }],
--    "alerts":   [{ "kind", "severity", "detail" }],
--    "raw":      [{ "kind", "externalId", "payload" }]
--  }
--
--  ★ אידמפוטנטי לחלוטין. להריץ אותו JSON פעמיים = אפס שינויים,
--    אפס שורות תיקון, ואותה טביעת אצבע.

CREATE OR REPLACE FUNCTION game.ingest_snapshot(p_source TEXT, p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE
  v_run      UUID;
  v_phase    TEXT := COALESCE(p_payload->>'phase', 'sweep');
  v_number   SMALLINT := NULLIF(p_payload#>>'{gameweek,number}', '')::SMALLINT;
  v_gw       UUID;
  v_code     TEXT;
  v_season   UUID;
  r          JSONB;
  v_home     UUID; v_away UUID; v_team UUID; v_player UUID; v_match UUID;
  v_kick     TIMESTAMPTZ;
  v_status   TEXT;
  v_lock     TIMESTAMPTZ;
  v_gw_status TEXT;
  n_fix      INT := 0;
  n_seen     INT := 0;
  n_mapped   INT := 0;
  n_changed  INT := 0;
  n_unmapped INT := 0;
  v_problems JSONB := '[]'::jsonb;
  v_fp       TEXT;
BEGIN
  IF NOT game.can_write_data() THEN RAISE EXCEPTION 'SYSTEM_OR_ADMIN_REQUIRED'; END IF;
  IF NOT COALESCE((SELECT enabled FROM game.ingest_config WHERE id), TRUE) THEN
    RETURN jsonb_build_object('skipped', 'ingest_disabled');
  END IF;
  IF v_number IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NUMBER_REQUIRED'; END IF;

  v_code := 'gw-' || v_number::TEXT;

  INSERT INTO game.ingest_runs (source, phase, gw_code)
  VALUES (p_source, v_phase, v_code) RETURNING id INTO v_run;

  /* ── הגולמי נשמר לפני שנוגעים בכלום ─────────────────────── */
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'raw', '[]'::jsonb)) LOOP
    INSERT INTO core.ingest_raw (run_id, source, kind, external_id, sha256, payload)
    VALUES (v_run, p_source, COALESCE(r->>'kind','unknown'), r->>'externalId',
            encode(sha256(convert_to((r->'payload')::TEXT, 'UTF8')), 'hex'),
            COALESCE(r->'payload', '{}'::jsonb))
    ON CONFLICT DO NOTHING;
  END LOOP;

  /* ── המחזור: נמצא או נוצר ────────────────────────────────── */
  SELECT id, status INTO v_gw, v_gw_status FROM game.gameweeks WHERE code = v_code;

  IF v_gw IS NULL THEN
    SELECT s.id INTO v_season FROM core.seasons s
     ORDER BY s.is_current DESC, s.starts_on DESC NULLS LAST LIMIT 1;
    IF v_season IS NULL THEN RAISE EXCEPTION 'NO_SEASON'; END IF;

    /* ★ הדדליין לא מומצא. עד שיגיע משחק ראשון הוא רחוק בעתיד,
       בדיוק כמו ב-`admin_create_gameweek`. מחזור שנולד נעול
       הוא מחזור שאף אחד לא יכול להגיש אליו ואיש לא יֵדע למה. */
    INSERT INTO game.gameweeks (season_id, number, code, names, lock_at, first_kickoff_at, status)
    VALUES (v_season, v_number, v_code,
            jsonb_build_object('he', jsonb_build_object('full', 'מחזור ' || v_number),
                               'en', jsonb_build_object('full', 'Gameweek ' || v_number)),
            now() + INTERVAL '365 days', NULL, 'draft')
    ON CONFLICT (season_id, number) DO UPDATE SET code = EXCLUDED.code
    RETURNING id, status INTO v_gw, v_gw_status;

    INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
    VALUES (game.actor_label(), 'ingest_create_gameweek', 'gameweek', v_code,
            jsonb_build_object('number', v_number, 'source', p_source));
  END IF;

  /* ── משחקים ──────────────────────────────────────────────── */
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'fixtures', '[]'::jsonb)) LOOP
    v_home := game.ingest_resolve_team(p_source, r#>>'{home,id}', r#>>'{home,nameEn}', r#>>'{home,nameHe}');
    v_away := game.ingest_resolve_team(p_source, r#>>'{away,id}', r#>>'{away,nameEn}', r#>>'{away,nameHe}');

    IF v_home IS NULL OR v_away IS NULL THEN
      v_problems := v_problems || jsonb_build_object(
        'issue', 'קבוצה לא מופתה', 'home', r#>>'{home,nameEn}', 'away', r#>>'{away,nameEn}');
      CONTINUE;
    END IF;

    v_kick   := NULLIF(r->>'kickoff','')::TIMESTAMPTZ;
    v_status := COALESCE(r->>'status', 'scheduled');
    IF v_status NOT IN ('scheduled','live','finished','postponed','abandoned') THEN
      v_status := 'scheduled';
    END IF;

    INSERT INTO core.weekly_matches
      (gameweek_id, home_team_id, away_team_id, kickoff_at, status, home_goals, away_goals)
    VALUES (v_gw, v_home, v_away, COALESCE(v_kick, now() + INTERVAL '365 days'),
            v_status,
            NULLIF(r->>'homeGoals','')::SMALLINT, NULLIF(r->>'awayGoals','')::SMALLINT)
    ON CONFLICT (gameweek_id, home_team_id, away_team_id) DO UPDATE SET
      /* ★ שעת פתיחה מתעדכנת רק כל עוד אפשר להגיש. אחרי הנעילה
         שינוי שעה הוא שינוי דדליין רטרואקטיבי — כלומר פסילת
         הגשות שהיו חוקיות. */
      kickoff_at = CASE WHEN v_gw_status IN ('draft','open') AND v_kick IS NOT NULL
                        THEN v_kick ELSE core.weekly_matches.kickoff_at END,
      status     = EXCLUDED.status,
      home_goals = COALESCE(EXCLUDED.home_goals, core.weekly_matches.home_goals),
      away_goals = COALESCE(EXCLUDED.away_goals, core.weekly_matches.away_goals)
    RETURNING id INTO v_match;

    IF r->>'providerId' IS NOT NULL THEN
      PERFORM core.provider_link(p_source, 'match', r->>'providerId', v_match, NULL);
    END IF;

    /* משחק שנדחה או נזנח אינו תוצאה. */
    IF v_status IN ('postponed','abandoned') THEN
      INSERT INTO game.ingest_alerts (gw_code, kind, severity, detail)
      VALUES (v_code, 'fixture_not_final', 'block',
              jsonb_build_object('match', r->>'providerId', 'status', v_status))
      ON CONFLICT DO NOTHING;
    END IF;

    n_fix := n_fix + 1;
  END LOOP;

  /* ── דדליין = פתיחת המשחק הראשון ─────────────────────────── */
  IF v_gw_status IN ('draft','open') THEN
    SELECT min(kickoff_at) INTO v_lock FROM core.weekly_matches
     WHERE gameweek_id = v_gw AND status <> 'postponed';

    IF v_lock IS NOT NULL AND v_lock > now() THEN
      UPDATE game.gameweeks
         SET lock_at = v_lock, first_kickoff_at = v_lock
       WHERE id = v_gw AND lock_at IS DISTINCT FROM v_lock;
    END IF;
  END IF;

  /* ── שער נקי נגזר מחדש כשמצב המשחק זז ───────────────────────
     ★ באג שנתפס בבדיקה 5: סטטיסטיקה שנקלטת בזמן אמת נכתבת
       כשהמשחק עדיין 'live', ולכן `clean_sheet` יוצא FALSE.
       אם אחר כך מגיע רק עדכון תוצאה — בלי שורות שחקנים —
       השער הנקי היה נשאר שקרי לנצח, וכל מגן במשחק 0:2 היה
       מפסיד 4 נקודות בשקט.
       החוק אחד, והוא נאכף על כל השורות של המחזור. */
  UPDATE core.player_match_stats s
     SET clean_sheet = (m.status = 'finished' AND s.goals_conceded = 0 AND s.minutes > 0),
         updated_at  = now()
    FROM core.weekly_matches m
   WHERE m.id = s.match_id
     AND m.gameweek_id = v_gw
     AND s.clean_sheet IS DISTINCT FROM
         (m.status = 'finished' AND s.goals_conceded = 0 AND s.minutes > 0);

  /* ── סטטיסטיקה אישית ─────────────────────────────────────── */
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'stats', '[]'::jsonb)) LOOP
    n_seen := n_seen + 1;

    v_match := core.entity_by_provider(p_source, 'match', r->>'matchProviderId');
    IF v_match IS NULL THEN
      v_problems := v_problems || jsonb_build_object(
        'issue', 'משחק לא מופה', 'match', r->>'matchProviderId');
      CONTINUE;
    END IF;

    v_team := game.ingest_resolve_team(p_source, r#>>'{team,id}', r#>>'{team,nameEn}', r#>>'{team,nameHe}');
    IF v_team IS NULL THEN CONTINUE; END IF;

    v_player := game.ingest_resolve_player(
      p_source, r#>>'{player,id}', v_team,
      r#>>'{player,nameEn}', r#>>'{player,nameHe}',
      NULLIF(r#>>'{player,shirt}','')::SMALLINT, r#>>'{player,position}');

    IF v_player IS NULL THEN
      n_unmapped := n_unmapped + 1;
      CONTINUE;
    END IF;

    n_mapped := n_mapped + 1;
    IF core.apply_player_stat(v_match, v_player, v_team, r, game.actor_label(), 'ingest:' || p_source) THEN
      n_changed := n_changed + 1;
    END IF;
  END LOOP;

  /* ── התרעות מהמתאם (VAR, כרטיס שבוטל, מקור שנפל) ────────── */
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'alerts', '[]'::jsonb)) LOOP
    INSERT INTO game.ingest_alerts (gw_code, kind, severity, detail)
    VALUES (v_code, COALESCE(r->>'kind','unknown'),
            CASE WHEN r->>'severity' = 'warn' THEN 'warn' ELSE 'block' END,
            COALESCE(r->'detail','{}'::jsonb))
    ON CONFLICT DO NOTHING;
  END LOOP;

  /* ── טביעת אצבע ───────────────────────────────────────────── */
  v_fp := game.gameweek_fingerprint(v_code);

  INSERT INTO game.gameweek_fingerprints (gameweek_id, fingerprint, since, checked_at)
  VALUES (v_gw, v_fp, now(), now())
  ON CONFLICT (gameweek_id) DO UPDATE SET
    since       = CASE WHEN game.gameweek_fingerprints.fingerprint IS DISTINCT FROM EXCLUDED.fingerprint
                       THEN now() ELSE game.gameweek_fingerprints.since END,
    fingerprint = EXCLUDED.fingerprint,
    checked_at  = now();

  /* ★ שינוי אחרי פרסום — לא משנים ניקוד לבד, מתריעים. */
  IF EXISTS (SELECT 1 FROM game.gameweek_fingerprints f
              WHERE f.gameweek_id = v_gw
                AND f.published_fingerprint IS NOT NULL
                AND f.published_fingerprint <> v_fp)
  THEN
    INSERT INTO game.ingest_alerts (gw_code, kind, severity, detail)
    VALUES (v_code, 'changed_after_publish', 'warn',
            jsonb_build_object('fingerprint', v_fp))
    ON CONFLICT DO NOTHING;
  END IF;

  UPDATE game.ingest_runs SET
    finished_at = now(),
    status = CASE WHEN jsonb_array_length(v_problems) > 0 OR n_unmapped > 0
                  THEN 'partial' ELSE 'ok' END,
    fixtures_seen = n_fix, players_seen = n_seen,
    players_mapped = n_mapped, unmapped_count = n_unmapped,
    report = jsonb_build_object('changed', n_changed, 'problems', v_problems,
                                'fingerprint', v_fp)
  WHERE id = v_run;

  RETURN jsonb_build_object(
    'runId', v_run, 'gw', v_code, 'phase', v_phase,
    'fixtures', n_fix, 'playersSeen', n_seen, 'playersMapped', n_mapped,
    'unmapped', n_unmapped, 'changed', n_changed,
    'fingerprint', v_fp, 'problems', v_problems);

/* ★ אין כאן `EXCEPTION WHEN OTHERS`.
   בלוק חריגה ב-plpgsql מגלגל אחורה את **כל** עבודת הפונקציה,
   כולל את שורת הכישלון שהוא עצמו מנסה לכתוב. כלומר "רישום
   הכישלון" היה נמחק יחד עם הכישלון. הרישום נעשה מבחוץ, בקריאה
   נפרדת: `game.ingest_log_failure`. */
END;
$$;

/* רישום כישלון — נקראת מה-Edge Function אחרי שהקליטה זרקה. */
CREATE OR REPLACE FUNCTION game.ingest_log_failure(
  p_source TEXT, p_phase TEXT, p_gw_code TEXT, p_error TEXT
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_run UUID;
BEGIN
  IF NOT game.can_write_data() THEN RAISE EXCEPTION 'SYSTEM_OR_ADMIN_REQUIRED'; END IF;

  INSERT INTO game.ingest_runs (source, phase, gw_code, finished_at, status, error)
  VALUES (p_source, p_phase, p_gw_code, now(), 'failed', left(p_error, 2000))
  RETURNING id INTO v_run;

  INSERT INTO game.ingest_alerts (gw_code, kind, severity, detail)
  VALUES (p_gw_code, 'source_down', 'warn',
          jsonb_build_object('source', p_source, 'error', left(p_error, 500)))
  ON CONFLICT DO NOTHING;

  RETURN v_run;
END;
$$;

COMMIT;

BEGIN;

-- =====================================================================
--  §6 · טביעת אצבע, כיסוי, ומחזור החיים האוטומטי
-- =====================================================================

/**
 * טביעת אצבע של המחזור: hash על כל מה שמשפיע על ניקוד.
 *
 * ★ למה זה קיים: כשמספר של משתמש משתנה, השאלה הראשונה היא
 *   "הדאטה זזה או המנוע?". טביעת אצבע עונה עליה בשנייה.
 *   היא גם התנאי לפרסום: נתונים שלא זזו 45 דקות הם נתונים
 *   שהספק סיים לעדכן.
 */
CREATE OR REPLACE FUNCTION game.gameweek_fingerprint(p_gw_code TEXT)
RETURNS TEXT LANGUAGE sql STABLE
SET search_path = core, game, public
AS $$
  SELECT md5(COALESCE(string_agg(x, '|' ORDER BY x), 'empty'))
  FROM (
    SELECT m.id::TEXT || ':' || m.status || ':' ||
           COALESCE(m.home_goals, -1)::TEXT || ':' || COALESCE(m.away_goals, -1)::TEXT AS x
      FROM core.weekly_matches m
      JOIN game.gameweeks g ON g.id = m.gameweek_id
     WHERE g.code = p_gw_code
    UNION ALL
    SELECT s.match_id::TEXT || ':' || s.player_id::TEXT || ':' || s.minutes || ':' ||
           s.goals || ':' || s.assists || ':' || s.own_goals || ':' ||
           s.yellow_cards || ':' || s.red_cards || ':' || s.saves || ':' ||
           s.penalties_saved || ':' || s.penalties_missed || ':' ||
           s.goals_conceded || ':' || s.clean_sheet::TEXT
      FROM core.player_match_stats s
      JOIN core.weekly_matches m ON m.id = s.match_id
      JOIN game.gameweeks g ON g.id = m.gameweek_id
     WHERE g.code = p_gw_code
  ) t;
$$;

/**
 * כיסוי: מי שנבחר בהרכב, המשחק שלו נגמר, ואין לו שורת נתונים.
 *
 * ★ זו הבדיקה שמונעת את התרחיש הגרוע ביותר — מחזור מתפרסם,
 *   ומשתמש מגלה שהשחקן שלו קיבל אפס כי אף אחד לא מיפה אותו.
 *   כל שורה כזו היא התרעה חוסמת.
 */
CREATE OR REPLACE FUNCTION game.ingest_check_coverage(p_gw_code TEXT)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_gw UUID; v_missing JSONB; v_n INT;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw IS NULL THEN RETURN 0; END IF;

  WITH picked AS (
    SELECT DISTINCT sl.player_id, sl.team_id
      FROM game.user_lineups ul
      JOIN game.user_lineup_slots sl ON sl.lineup_id = ul.id
     WHERE ul.gameweek_id = v_gw AND ul.status IN ('submitted','locked','scored')
  ),
  their_match AS (
    SELECT p.player_id, m.id AS match_id
      FROM picked p
      JOIN core.weekly_matches m
        ON m.gameweek_id = v_gw
       AND (m.home_team_id = p.team_id OR m.away_team_id = p.team_id)
     WHERE m.status = 'finished'
  )
  SELECT jsonb_agg(jsonb_build_object(
           'player', core.ext_code('player', tm.player_id),
           'nameHe', pl.name_he)), count(*)
    INTO v_missing, v_n
    FROM their_match tm
    JOIN core.players pl ON pl.id = tm.player_id
   WHERE NOT EXISTS (
     SELECT 1 FROM core.player_match_stats s
      WHERE s.match_id = tm.match_id AND s.player_id = tm.player_id);

  v_n := COALESCE(v_n, 0);

  IF v_n > 0 THEN
    INSERT INTO game.ingest_alerts (gw_code, kind, severity, detail)
    VALUES (p_gw_code, 'unmapped_in_lineup', 'block',
            jsonb_build_object('count', v_n, 'players', v_missing))
    ON CONFLICT DO NOTHING;

    /* מסמן ברשימת המיפוי מה חוסם — זה מה שהאדמין יראה קודם */
    UPDATE game.ingest_unmapped SET blocking = TRUE
     WHERE resolved_at IS NULL AND entity_type = 'player';
  END IF;

  RETURN v_n;
END;
$$;

/**
 * פרסום — הרחבה של הפונקציה מ-db/09, לא עותק שני.
 *
 * שני שינויים, שניהם נדרשים לאוטומציה:
 *   · `game.actor_label()` במקום `auth.uid()` — למערכת אין uid,
 *     והיומן היה מקבל שורה בלי מבצע.
 *   · שמירת טביעת האצבע ברגע הפרסום — זה מה שמאפשר להתריע
 *     אחר כך "הדאטה זזה אחרי שפרסמנו".
 */
CREATE OR REPLACE FUNCTION game.admin_set_published(p_gw_code TEXT, p_published BOOLEAN)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
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

  INSERT INTO game.gameweek_fingerprints (gameweek_id, fingerprint, published_fingerprint)
  VALUES (v_gw.id, game.gameweek_fingerprint(p_gw_code),
          CASE WHEN p_published THEN game.gameweek_fingerprint(p_gw_code) END)
  ON CONFLICT (gameweek_id) DO UPDATE
    SET published_fingerprint = CASE WHEN p_published
                                     THEN game.gameweek_fingerprint(p_gw_code)
                                     ELSE NULL END;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (game.actor_label(), 'admin_set_published', 'gameweek', v_gw.id::TEXT,
          jsonb_build_object('code', p_gw_code, 'published', p_published));

  RETURN v_next;
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_set_published(TEXT, BOOLEAN) TO authenticated;

/**
 * מחזור החיים האוטומטי.
 *
 * ★ הפונקציה הזו **לא מחשבת ניקוד ולא מפרסמת**. היא מסובבת
 *   סטטוסים ומחזירה רשימת פעולות. הניקוד הרשמי רץ במנוע ה-TS
 *   (`dubid-score-gameweek`) — אותו מנוע שרץ בדפדפן. לממש אותו
 *   שוב ב-SQL היה יוצר שני מספרים לאותו מחזור, וזה בדיוק מה
 *   שהמוצר לא יכול להרשות לעצמו.
 *
 *   לכן: כשמחזור בשל לפרסום, הפונקציה מחזירה `readyToPublish`,
 *   וה-Edge Function מריץ ניקוד ואז קורא ל-`admin_set_published`.
 *
 * מעברי הסטטוס:
 *     draft  → open      כשיש משחקים והדדליין עוד לפנינו
 *     open   → scoring   כשכל המשחקים הסתיימו
 *     scoring→ published  (דרך ה-Edge Function, אחרי ניקוד)
 */
CREATE OR REPLACE FUNCTION game.auto_advance()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  v_cfg      game.ingest_config%ROWTYPE;
  g          RECORD;
  v_actions  JSONB := '[]'::jsonb;
  v_ready    TEXT;
  v_total    INT; v_final INT; v_blocks INT; v_missing INT;
  v_stable   BOOLEAN;
  v_current  TEXT;
BEGIN
  IF NOT game.can_write_data() THEN RAISE EXCEPTION 'SYSTEM_OR_ADMIN_REQUIRED'; END IF;
  SELECT * INTO v_cfg FROM game.ingest_config WHERE id;
  IF NOT COALESCE(v_cfg.enabled, TRUE) THEN
    RETURN jsonb_build_object('skipped', 'ingest_disabled');
  END IF;

  FOR g IN
    SELECT gw.id, gw.code, gw.number, gw.status, gw.lock_at
      FROM game.gameweeks gw
     WHERE gw.status NOT IN ('published','archived')
     ORDER BY gw.number
  LOOP
    SELECT count(*), count(*) FILTER (WHERE status = 'finished')
      INTO v_total, v_final
      FROM core.weekly_matches WHERE gameweek_id = g.id;

    CONTINUE WHEN v_total = 0;           -- מחזור בלי משחקים אינו מחזור

    /* ── draft → open ─────────────────────────────────────── */
    IF g.status = 'draft' AND COALESCE(v_cfg.auto_open_next, TRUE)
       AND g.lock_at > now()
       /* רק אחרי שהקודם כבר לא תלוי באוויר */
       AND NOT EXISTS (SELECT 1 FROM game.gameweeks p
                        WHERE p.number < g.number
                          AND p.status IN ('open','locked','live','scoring'))
    THEN
      UPDATE game.gameweeks SET status = 'open' WHERE id = g.id;
      UPDATE game.gameweeks SET is_current = FALSE WHERE is_current AND id <> g.id;
      UPDATE game.gameweeks SET is_current = TRUE  WHERE id = g.id;
      g.status := 'open';
      v_actions := v_actions || jsonb_build_object('gw', g.code, 'action', 'opened');

      INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
      VALUES (game.actor_label(), 'auto_open_gameweek', 'gameweek', g.code,
              jsonb_build_object('lockAt', g.lock_at, 'fixtures', v_total));
    END IF;

    /* ── הכל נגמר → scoring ───────────────────────────────── */
    IF g.status IN ('open','locked','live') AND v_final = v_total THEN
      UPDATE game.gameweeks SET status = 'scoring' WHERE id = g.id;
      g.status := 'scoring';
      v_actions := v_actions || jsonb_build_object('gw', g.code, 'action', 'scoring');
    END IF;

    /* ── בשל לפרסום? ──────────────────────────────────────── */
    IF g.status = 'scoring' AND COALESCE(v_cfg.auto_publish, TRUE) THEN
      v_missing := game.ingest_check_coverage(g.code);

      SELECT count(*) INTO v_blocks FROM game.ingest_alerts
       WHERE gw_code = g.code AND cleared_at IS NULL AND severity = 'block';

      SELECT COALESCE(now() - f.since >= make_interval(mins => v_cfg.stable_minutes), FALSE)
        INTO v_stable
        FROM game.gameweek_fingerprints f WHERE f.gameweek_id = g.id;

      IF v_blocks = 0 AND COALESCE(v_stable, FALSE) THEN
        v_ready := g.code;
        v_actions := v_actions || jsonb_build_object('gw', g.code, 'action', 'readyToPublish');
      ELSE
        v_actions := v_actions || jsonb_build_object(
          'gw', g.code, 'action', 'holding',
          'reason', CASE WHEN v_blocks > 0 THEN 'alerts' ELSE 'not_stable' END,
          'blocks', v_blocks, 'missingStats', v_missing);
      END IF;
    END IF;
  END LOOP;

  SELECT code INTO v_current FROM game.gameweeks WHERE is_current;

  RETURN jsonb_build_object(
    'actions', v_actions,
    'readyToPublish', v_ready,
    'current', v_current,
    'at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
END;
$$;

COMMIT;

BEGIN;

-- =====================================================================
--  §7 · מה שהאדמין רואה, ומה שהמשתמש זוכר
-- =====================================================================

/* מצב הקליטה — מסך אחד שאומר הכל. */
CREATE OR REPLACE FUNCTION game.admin_ingest_state()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v JSONB;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  SELECT jsonb_build_object(
    'config', (SELECT to_jsonb(c) FROM game.ingest_config c WHERE c.id),
    'runs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', r.id, 'source', r.source, 'phase', r.phase, 'gw', r.gw_code,
               'status', r.status, 'startedAt', r.started_at, 'finishedAt', r.finished_at,
               'fixtures', r.fixtures_seen, 'playersSeen', r.players_seen,
               'playersMapped', r.players_mapped, 'unmapped', r.unmapped_count,
               'error', r.error) ORDER BY r.started_at DESC)
        FROM (SELECT * FROM game.ingest_runs ORDER BY started_at DESC LIMIT 20) r
    ), '[]'::jsonb),
    'alerts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', a.id, 'gw', a.gw_code, 'kind', a.kind,
               'severity', a.severity, 'detail', a.detail, 'createdAt', a.created_at)
             ORDER BY a.created_at DESC)
        FROM game.ingest_alerts a WHERE a.cleared_at IS NULL
    ), '[]'::jsonb),
    'unmappedCount', (SELECT count(*) FROM game.ingest_unmapped WHERE resolved_at IS NULL),
    'blockingCount', (SELECT count(*) FROM game.ingest_unmapped WHERE resolved_at IS NULL AND blocking),
    'gameweeks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'code', gw.code, 'number', gw.number, 'status', gw.status,
               'isCurrent', gw.is_current, 'lockAt', gw.lock_at,
               'fixtures', (SELECT count(*) FROM core.weekly_matches m WHERE m.gameweek_id = gw.id),
               'final', (SELECT count(*) FROM core.weekly_matches m
                          WHERE m.gameweek_id = gw.id AND m.status = 'finished'),
               'fingerprint', f.fingerprint,
               'stableSince', f.since,
               'movedAfterPublish', (f.published_fingerprint IS NOT NULL
                                     AND f.published_fingerprint <> f.fingerprint))
             ORDER BY gw.number DESC)
        FROM game.gameweeks gw
        LEFT JOIN game.gameweek_fingerprints f ON f.gameweek_id = gw.id
       WHERE gw.number >= (SELECT COALESCE(max(number), 0) - 5 FROM game.gameweeks)
    ), '[]'::jsonb)
  ) INTO v;

  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_ingest_state() TO authenticated;

/* רשימת המיפוי — מה שנשאר לאדם, אחרי שהמכונה עשתה כל מה שיכלה. */
CREATE OR REPLACE FUNCTION game.admin_unmapped(p_limit INT DEFAULT 200)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v JSONB;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', u.id, 'source', u.source, 'type', u.entity_type,
           'externalId', u.external_id, 'name', u.name_raw, 'nameHe', u.name_he,
           'team', u.team_ext, 'shirt', u.shirt_number, 'position', u.position,
           'candidates', u.candidates, 'blocking', u.blocking,
           'seen', u.seen_count, 'lastSeenAt', u.last_seen_at)
         ORDER BY u.blocking DESC, u.seen_count DESC, u.last_seen_at DESC), '[]'::jsonb)
    INTO v
    FROM (SELECT * FROM game.ingest_unmapped
           WHERE resolved_at IS NULL
           ORDER BY blocking DESC, seen_count DESC LIMIT p_limit) u;

  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_unmapped(INT) TO authenticated;

/**
 * מיפוי ידני — קליק אחד.
 *
 * ★ קושר גם את מה שהיה **לפני** המיפוי: אם הספק כבר שלח
 *   סטטיסטיקה לשחקן הזה במחזור שעדיין לא פורסם, היא נכנסת
 *   עכשיו מהגולמי. בלי זה, מיפוי אחרי המשחק לא היה עוזר
 *   לאף אחד.
 */
CREATE OR REPLACE FUNCTION game.admin_map_player(
  p_source TEXT, p_external_id TEXT, p_ext_player TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v_player UUID;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  v_player := core.player_by_ext(p_ext_player);
  IF v_player IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND: %', p_ext_player; END IF;

  PERFORM core.provider_link(p_source, 'player', p_external_id, v_player,
            jsonb_build_object('mappedBy', 'admin'));

  UPDATE game.ingest_unmapped
     SET resolved_at = now(), resolved_to = v_player, blocking = FALSE
   WHERE source = p_source AND entity_type = 'player' AND external_id = p_external_id;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (game.actor_label(), 'admin_map_player', 'player', p_external_id,
          jsonb_build_object('source', p_source, 'to', p_ext_player));

  RETURN jsonb_build_object('ok', TRUE, 'player', p_ext_player);
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_map_player(TEXT,TEXT,TEXT) TO authenticated;

/* ביטול מיפוי — טעות במיפוי היא נקודות אצל השחקן הלא נכון. */
CREATE OR REPLACE FUNCTION game.admin_unmap(p_source TEXT, p_external_id TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  DELETE FROM core.external_refs
   WHERE provider = p_source AND entity_type = 'player' AND external_id = p_external_id;

  UPDATE game.ingest_unmapped
     SET resolved_at = NULL, resolved_to = NULL
   WHERE source = p_source AND entity_type = 'player' AND external_id = p_external_id;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (game.actor_label(), 'admin_unmap', 'player', p_external_id,
          jsonb_build_object('source', p_source));
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_unmap(TEXT,TEXT) TO authenticated;

/* שחרור התרעה. נרשם — כי זו החלטה, לא ניקוי. */
CREATE OR REPLACE FUNCTION game.admin_clear_alert(p_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  UPDATE game.ingest_alerts
     SET cleared_at = now(), cleared_by = game.actor_label()
   WHERE id = p_id AND cleared_at IS NULL;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (game.actor_label(), 'admin_clear_alert', 'alert', p_id::TEXT, '{}'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_clear_alert(BIGINT) TO authenticated;

/* כוונון הקליטה מלוח הבקרה, בלי SQL. */
CREATE OR REPLACE FUNCTION game.admin_set_ingest_config(p_patch JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v JSONB;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  UPDATE game.ingest_config SET
    enabled          = COALESCE((p_patch->>'enabled')::BOOLEAN, enabled),
    stable_minutes   = COALESCE((p_patch->>'stableMinutes')::SMALLINT, stable_minutes),
    auto_publish     = COALESCE((p_patch->>'autoPublish')::BOOLEAN, auto_publish),
    auto_open_next   = COALESCE((p_patch->>'autoOpenNext')::BOOLEAN, auto_open_next),
    auto_map_players = COALESCE((p_patch->>'autoMapPlayers')::BOOLEAN, auto_map_players),
    name_threshold   = COALESCE((p_patch->>'nameThreshold')::NUMERIC, name_threshold),
    updated_at       = now()
  WHERE id RETURNING to_jsonb(game.ingest_config.*) INTO v;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (game.actor_label(), 'admin_set_ingest_config', 'config', 'ingest', p_patch);

  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_set_ingest_config(JSONB) TO authenticated;

/**
 * זיכרון המחזורים שעברו.
 *
 * ★ עד עכשיו מחזור נעלם מהמוצר ברגע שהבא הפך לנוכחי. הנתונים
 *   היו במסד (`game.results` עובדת לפי קוד), אבל שום מסך לא
 *   ביקש אותם — וזה חתך בדיוק את החוליה COMPARE → RETURN.
 *
 *   `p_mode` NULL = כל המצבים יחד.
 */
CREATE OR REPLACE FUNCTION game.history_summary(p_mode TEXT DEFAULT NULL, p_limit INT DEFAULT 20)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'number')::INT DESC), '[]'::jsonb)
    INTO v
  FROM (
    SELECT jsonb_build_object(
      'code', gw.code,
      'number', gw.number,
      'label', gw.names #>> '{he,full}',
      'publishedAt', gw.published_at,
      'lockAt', gw.lock_at,
      'entries', (SELECT count(*) FROM game.user_lineups ul
                   WHERE ul.gameweek_id = gw.id AND ul.status IN ('submitted','locked','scored')
                     AND (p_mode IS NULL OR ul.formation IS NOT NULL)),
      'fixtures', (SELECT count(*) FROM core.weekly_matches m WHERE m.gameweek_id = gw.id),
      'topScore', (SELECT max(ls.total_points) FROM game.lineup_scores ls
                    JOIN game.user_lineups ul ON ul.id = ls.lineup_id
                   WHERE ul.gameweek_id = gw.id),
      'myPoints', (SELECT ls.total_points FROM game.lineup_scores ls
                    JOIN game.user_lineups ul ON ul.id = ls.lineup_id
                   WHERE ul.gameweek_id = gw.id AND ul.user_id = auth.uid() LIMIT 1),
      'myRank', (SELECT r.rank FROM (
                   SELECT ul.user_id,
                          RANK() OVER (ORDER BY ls.total_points DESC) AS rank
                     FROM game.lineup_scores ls
                     JOIN game.user_lineups ul ON ul.id = ls.lineup_id
                    WHERE ul.gameweek_id = gw.id) r
                  WHERE r.user_id = auth.uid() LIMIT 1)
    ) AS row
    FROM game.gameweeks gw
   WHERE gw.status IN ('published','archived')
   ORDER BY gw.number DESC
   LIMIT p_limit
  ) t;

  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION game.history_summary(TEXT,INT) TO authenticated, anon;

/* בריאות הקליטה — שאילתה אחת שאומרת אם היא חיה. */
DROP VIEW IF EXISTS game.v_ingest_health;
CREATE VIEW game.v_ingest_health AS
SELECT
  (SELECT count(*) FROM core.external_refs WHERE provider <> 'manual_json'
                                             AND entity_type = 'player')      AS mapped_players,
  (SELECT count(*) FROM game.ingest_unmapped WHERE resolved_at IS NULL)       AS unmapped_open,
  (SELECT count(*) FROM game.ingest_alerts WHERE cleared_at IS NULL
                                             AND severity = 'block')          AS blocking_alerts,
  (SELECT max(started_at) FROM game.ingest_runs WHERE status IN ('ok','partial')) AS last_ok_run,
  (SELECT count(*) FROM game.ingest_runs
    WHERE status = 'failed' AND started_at > now() - INTERVAL '24 hours')     AS failures_24h,
  (SELECT code FROM game.gameweeks WHERE is_current)                          AS current_gw;

GRANT SELECT ON game.v_ingest_health TO authenticated;

INSERT INTO game.schema_migrations (version, note) VALUES
  ('19', 'כרטיס אורח'),  ('20', 'כרטיס ב-SQL'), ('21', 'פרופיל מאמן'),
  ('22', 'מצב חשבון'),   ('23', 'מיזוג בכניסה'), ('24', 'מחזור חי'),
  ('25', 'מחזור 4'),
  ('26', '★ קליטה אוטומטית ממקורות חינמיים + מחזור חיים אוטומטי')
ON CONFLICT (version) DO NOTHING;

COMMIT;

BEGIN;

-- =====================================================================
--  §8 · באג שנתפס בשער — ולידציית הרכב לא הכירה את דוביד 5
-- =====================================================================
--
--  `game.assert_lineup_valid` לקחה את הגודל הנדרש מ-
--  `core.leagues.squad_size` (11), בלי קשר למצב המשחק. הטריגר
--  `user_lineups_validate` רץ ב-UPDATE כשהסטטוס עובר ל-
--  'submitted' או 'locked'.
--
--  התוצאה, בייצור: **"פתיחה מחדש" של מחזור מתפוצצת** ברגע שיש
--  בו הגשה אחת של דוביד 5. `admin_set_published(code, FALSE)`
--  מעביר כל הרכב ל-'locked', הטריגר דורש 11, וההרכב מכיל 5:
--
--      ERROR: LINEUP_SIZE_INVALID: expected 11, got 5
--
--  זה לא נראה עד עכשיו כי ההגשה עצמה היא INSERT (הטריגר הוא
--  BEFORE UPDATE בלבד), ופרסום מעביר ל-'scored' שאינו ברשימה.
--  רק פתיחה מחדש נוגעת ב-'locked' — והיא בדיוק מה שהאוטומציה
--  תצטרך ביום שהספק יתקן תוצאה.
--
--  התיקון: הגודל מגיע מ-`game.mode_config`, שכבר מחזיקה אותו
--  כדאטה (five=5, full=11), עם נפילה חזרה ל-squad_size של הליגה
--  למצב שאינו רשום.

CREATE OR REPLACE FUNCTION game.assert_lineup_valid(p_lineup_id UUID)
RETURNS VOID LANGUAGE plpgsql
SET search_path = game, core, public
AS $$
DECLARE
  v_required SMALLINT;
  v_actual   SMALLINT;
  v_teams    SMALLINT;
  v_captains SMALLINT;
BEGIN
  SELECT COALESCE(mc.lineup_size, l.squad_size) INTO v_required
    FROM game.user_lineups ul
    JOIN game.gameweeks gw ON gw.id = ul.gameweek_id
    JOIN core.seasons  s   ON s.id  = gw.season_id
    JOIN core.leagues  l   ON l.id  = s.league_id
    LEFT JOIN game.mode_config mc ON mc.mode = ul.mode
   WHERE ul.id = p_lineup_id;

  SELECT count(*), count(DISTINCT team_id), count(*) FILTER (WHERE is_captain)
    INTO v_actual, v_teams, v_captains
    FROM game.user_lineup_slots
   WHERE lineup_id = p_lineup_id AND NOT is_bench;

  IF v_actual <> v_required THEN
    RAISE EXCEPTION 'LINEUP_SIZE_INVALID: expected %, got %', v_required, v_actual
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_teams <> v_actual THEN
    RAISE EXCEPTION 'DISTINCT_TEAM_CONSTRAINT_VIOLATED: % players from % teams', v_actual, v_teams
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_captains <> 1 THEN
    RAISE EXCEPTION 'CAPTAIN_REQUIRED: expected exactly 1 captain, got %', v_captains
      USING ERRCODE = 'check_violation';
  END IF;
END $$;

COMMIT;
