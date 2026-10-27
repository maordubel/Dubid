-- =====================================================================
--  db/60_house_players.sql — משתתפי הבית: 6–13 מתמודדים קבועים בכל ליגה ומצב
-- =====================================================================
--
--  ★ מה זה
--    לכל ליגה (ישראל / יוון / אנגליה / ספרד) יש סגל קבוע של 18 משתתפים
--    (`game.house_players`). בכל מחזור ובכל מצב (5 / 11) משתתפים 6–13 מהם.
--    הזהות קבועה — שם, שם קבוצה, סגנון, קבוצה אהודה — וכך הם צוברים
--    היסטוריה ודירוג עונתי כמו כל משתתף. ההרכב שונה בכל מחזור.
--
--  ★ איך זה נראה אמיתי
--    · ההרכב נבנה מנתוני אמת: מחיר, שחקנים שפתחו ב-3 המחזורים האחרונים,
--      שערים, בישולים ושערים נקיים. שחקן ספסל כמעט לא ייבחר.
--    · חמישה סגנונות: «פייבוריטים», «ערך», «דיפרנציאל», «אוהד» (קבוצה
--      אהודה + קפטן ממנה), «מזדמן». רעש לכל מחזור → שונה בכל מחזור.
--    · מערך מועדף לכל משתתף, ובחמישית מהמחזורים — מערך אחר.
--    · ההגשה מתפזרת על פני חלון המחזור (רובם ביום-יומיים האחרונים,
--      לא באמצע הלילה), דרך `pg_cron` כל 5 דקות.
--    · לא כולם מגיעים לכל מחזור: נוכחות 55%–95% לכל משתתף.
--
--  ★ מה לא משתנה (הגינות)
--    · אותם חוקים בדיוק: אותו טריגר ולידציה (`assert_lineup_valid`),
--      שחקן אחד ממועדון, תקציב 15 בדוביד 5, שחקנים פעילים בלבד ממשחקי
--      המחזור, ורק כשמשתמש אמיתי יכול להגיש (`format_readiness`).
--    · לא רואים הרכבים של אחרים — הבנייה קוראת רק נתוני כדורגל.
--    · אין קופה במשחק (ניקוד בלבד). `is_bot` נשאר במסד ולא יוצא החוצה
--      (db/30), ומדדי האדמין ממשיכים לנכות אותם.
--    · מתג כיבוי: `game.house_config.enabled` (לוח הניהול).
--
--  ★ דטרמיניסטי: אין `random()`. הכול נגזר מ-md5 של קוד מחזור + משתתף.
-- =====================================================================
BEGIN;
SET search_path = game, core, public;

-- ---------------------------------------------------------------------
-- §1 · טבלאות
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game.house_config (
  id            SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled       BOOLEAN  NOT NULL DEFAULT TRUE,
  min_per_round SMALLINT NOT NULL DEFAULT 6,
  max_per_round SMALLINT NOT NULL DEFAULT 13,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (min_per_round >= 0 AND max_per_round >= min_per_round AND max_per_round <= 15)
);
INSERT INTO game.house_config (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS game.house_players (
  user_id        UUID PRIMARY KEY REFERENCES game.users(id) ON DELETE CASCADE,
  league_id      UUID NOT NULL REFERENCES core.leagues(id) ON DELETE CASCADE,
  slot           SMALLINT NOT NULL,
  plays_five     BOOLEAN NOT NULL,
  plays_full     BOOLEAN NOT NULL,
  style          TEXT NOT NULL CHECK (style IN ('chalk','value','differential','homer','casual')),
  attendance     NUMERIC(3,2) NOT NULL,
  fav_team_id    UUID REFERENCES core.teams(id) ON DELETE SET NULL,
  formation_full TEXT NOT NULL,
  formation_five TEXT NOT NULL,
  team_name      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, slot)
);

CREATE TABLE IF NOT EXISTS game.house_schedule (
  gameweek_id UUID NOT NULL REFERENCES game.gameweeks(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL CHECK (mode IN ('five','full')),
  user_id     UUID NOT NULL REFERENCES game.users(id) ON DELETE CASCADE,
  due_at      TIMESTAMPTZ NOT NULL,
  done_at     TIMESTAMPTZ,
  lineup_id   UUID REFERENCES game.user_lineups(id) ON DELETE SET NULL,
  problem     TEXT,
  PRIMARY KEY (gameweek_id, mode, user_id)
);
CREATE INDEX IF NOT EXISTS house_schedule_due_idx
  ON game.house_schedule (due_at) WHERE done_at IS NULL;

ALTER TABLE game.house_config   ENABLE ROW LEVEL SECURITY;
ALTER TABLE game.house_players  ENABLE ROW LEVEL SECURITY;
ALTER TABLE game.house_schedule ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON game.house_config, game.house_players, game.house_schedule FROM PUBLIC;
DO $g$ BEGIN
  EXECUTE 'REVOKE ALL ON game.house_config, game.house_players, game.house_schedule FROM anon, authenticated';
EXCEPTION WHEN undefined_object THEN NULL; END $g$;

-- ---------------------------------------------------------------------
-- §2 · עזרים דטרמיניסטיים
-- ---------------------------------------------------------------------
/** מספר קבוע ב-[0,1) מתוך מחרוזת. */
CREATE OR REPLACE FUNCTION game.house_u(p TEXT)
RETURNS DOUBLE PRECISION LANGUAGE sql IMMUTABLE AS $$
  SELECT ('x' || substr(md5(p), 1, 8))::bit(32)::bigint / 4294967296.0;
$$;

/**
 * זהויות. שמות כמו שאנשים באמת כותבים: שם פרטי, שם + אות, כינוי;
 * חלקם בלי שם קבוצה. בליגות הזרות — תערובת מקומיים, ישראלים ויוונים.
 * כל שם קבוצה ≤ 24 תווים (המגבלה של `set_entry_team_name`).
 */
CREATE OR REPLACE FUNCTION game.house_identity(p_league TEXT, p_slot INT)
RETURNS TABLE (display_name TEXT, team_name TEXT, locale TEXT)
LANGUAGE sql IMMUTABLE AS $$
  WITH pool(lg, slot, dn, tn, loc) AS (VALUES
    ('IL_PREMIER', 1,'נדב ל.','FC פלורנטין','he'),   ('IL_PREMIER', 2,'Tomer_10',NULL,'he'),
    ('IL_PREMIER', 3,'עידו','הפועל ספה','he'),         ('IL_PREMIER', 4,'שחר מ','Shachar XI','he'),
    ('IL_PREMIER', 5,'yoni.k','יוני והחברים','he'),    ('IL_PREMIER', 6,'רועי',NULL,'he'),
    ('IL_PREMIER', 7,'גל ב.','ליגת השישי','he'),       ('IL_PREMIER', 8,'מתן','אתלטיקו גבעתיים','he'),
    ('IL_PREMIER', 9,'Itay92',NULL,'he'),              ('IL_PREMIER',10,'דניאל ש','הזאבים מהשכונה','he'),
    ('IL_PREMIER',11,'אלון','Alon FC','he'),           ('IL_PREMIER',12,'ליאור','קישור יציב','he'),
    ('IL_PREMIER',13,'Omer S',NULL,'he'),              ('IL_PREMIER',14,'עמית','Underdogs TLV','he'),
    ('IL_PREMIER',15,'בן','ספסל חם','he'),             ('IL_PREMIER',16,'איתי ר','שבת בבוקר FC','he'),
    ('IL_PREMIER',17,'nir_f',NULL,'he'),               ('IL_PREMIER',18,'אביב','הבית של אביב','he'),

    ('GR_SUPER', 1,'Giorgos P.','Exarchia United','el'),  ('GR_SUPER', 2,'nikos_k',NULL,'el'),
    ('GR_SUPER', 3,'Kostas','Ta Paidia tis Thyras','el'), ('GR_SUPER', 4,'Δημήτρης','Δημήτρης FC','el'),
    ('GR_SUPER', 5,'Panos M',NULL,'el'),                  ('GR_SUPER', 6,'Thanos7','Kifisia Boys','el'),
    ('GR_SUPER', 7,'Σπύρος Κ.','Ouzo Athletic','el'),     ('GR_SUPER', 8,'Vasilis',NULL,'el'),
    ('GR_SUPER', 9,'Alex T','Piraeus Night Shift','el'),  ('GR_SUPER',10,'Manos','Καναπές United','el'),
    ('GR_SUPER',11,'Christos B',NULL,'el'),               ('GR_SUPER',12,'stelios88','Stelios XI','el'),
    ('GR_SUPER',13,'Μιχάλης',NULL,'el'),                  ('GR_SUPER',14,'Petros','Kalimera FC','el'),
    ('GR_SUPER',15,'Lefteris','Freddo Espresso FC','el'), ('GR_SUPER',16,'אורן',NULL,'he'),
    ('GR_SUPER',17,'Fotis D','Thyra 13','el'),            ('GR_SUPER',18,'Γιάννης','Η ομάδα του Γιάννη','el'),

    ('EN_PL', 1,'Jamie R','Crouch Potatoes','en'),     ('EN_PL', 2,'tom_b',NULL,'en'),
    ('EN_PL', 3,'Callum','Absolute Units FC','en'),    ('EN_PL', 4,'Ryan M',NULL,'en'),
    ('EN_PL', 5,'Lewis','Back of the Net','en'),       ('EN_PL', 6,'Sam_88','Tekkers XI','en'),
    ('EN_PL', 7,'Chris P',NULL,'en'),                  ('EN_PL', 8,'Josh','Dog & Duck FC','en'),
    ('EN_PL', 9,'עומר',NULL,'he'),                     ('EN_PL',10,'Matt H','Row Z Rovers','en'),
    ('EN_PL',11,'Ollie',NULL,'en'),                    ('EN_PL',12,'Kieran','Sunday League Legends','en'),
    ('EN_PL',13,'Giorgos L','Expected Goals FC','el'), ('EN_PL',14,'Ben T',NULL,'en'),
    ('EN_PL',15,'Liam W','Pint & Pressing','en'),      ('EN_PL',16,'Harry','Harry''s Heroes','en'),
    ('EN_PL',17,'דור',NULL,'he'),                      ('EN_PL',18,'Nathan','Inverted Fullbacks','en'),

    ('ES_LALIGA', 1,'Javi M','Real Sofá CF','en'),        ('ES_LALIGA', 2,'pablo_9',NULL,'en'),
    ('ES_LALIGA', 3,'Sergio','Atlético Bar Manolo','en'), ('ES_LALIGA', 4,'Álvaro',NULL,'en'),
    ('ES_LALIGA', 5,'Dani G','Los del Barrio','en'),      ('ES_LALIGA', 6,'Carlos','Tiki Taka FC','en'),
    ('ES_LALIGA', 7,'Iker',NULL,'en'),                    ('ES_LALIGA', 8,'Rubén T','Deportivo Siesta','en'),
    ('ES_LALIGA', 9,'Adri','Peña La Caña','en'),          ('ES_LALIGA',10,'Marcos L',NULL,'en'),
    ('ES_LALIGA',11,'Hugo','Hugo FC','en'),               ('ES_LALIGA',12,'Nacho','Cantera XI','en'),
    ('ES_LALIGA',13,'שגיא',NULL,'he'),                    ('ES_LALIGA',14,'Raúl','Falso Nueve','en'),
    ('ES_LALIGA',15,'Pepe',NULL,'en'),                    ('ES_LALIGA',16,'Kostas M','Panenka FC','el'),
    ('ES_LALIGA',17,'Mario B','Rayo de Barrio','en'),     ('ES_LALIGA',18,'Jorge',NULL,'en')
  )
  SELECT dn, tn, loc FROM pool WHERE lg = p_league AND slot = p_slot
  UNION ALL
  -- ליגה עתידית שאין לה עדיין מאגר: שמות ניטרליים, לעולם לא "Bot".
  SELECT (ARRAY['Alex','Sam','Chris','Dani','Nico','Max','Leo','Tom','Ari','Gal','Noa','Eli',
                'Jo','Rafa','Theo','Lior','Mika','Yan'])[1 + ((p_slot - 1) % 18)], NULL, 'en'
   WHERE NOT EXISTS (SELECT 1 FROM pool WHERE lg = p_league);
$$;

-- ---------------------------------------------------------------------
-- §3 · הסגל של ליגה
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION game.house_ensure_roster(p_league_id UUID)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  v_code  TEXT;
  v_made  INT := 0;
  v_user  UUID;
  v_key   TEXT;
  v_id    RECORD;
  v_fav   UUID;
  u1 DOUBLE PRECISION; u2 DOUBLE PRECISION; u3 DOUBLE PRECISION; u4 DOUBLE PRECISION;
  i INT;
BEGIN
  SELECT code INTO v_code FROM core.leagues WHERE id = p_league_id;
  IF v_code IS NULL THEN RETURN 0; END IF;
  IF (SELECT count(*) FROM game.house_players WHERE league_id = p_league_id) >= 18 THEN RETURN 0; END IF;

  FOR i IN 1..18 LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM game.house_players WHERE league_id = p_league_id AND slot = i);
    v_key := 'house:' || v_code || ':' || i;
    u1 := game.house_u(v_key || ':style');
    u2 := game.house_u(v_key || ':att');
    u3 := game.house_u(v_key || ':f11');
    u4 := game.house_u(v_key || ':f5');
    SELECT * INTO v_id FROM game.house_identity(v_code, i) LIMIT 1;

    SELECT sq.team_id INTO v_fav
      FROM core.squads sq JOIN core.seasons s ON s.id = sq.season_id AND s.is_current
     WHERE s.league_id = p_league_id AND sq.valid_to IS NULL
     GROUP BY sq.team_id ORDER BY md5(sq.team_id::TEXT || v_key) LIMIT 1;

    INSERT INTO game.users (display_name, username, locale, is_guest, is_bot, created_at)
    VALUES (v_id.display_name,
            ('player_' || upper(substr(md5(v_key), 1, 8)))::CITEXT,
            v_id.locale, TRUE, TRUE,
            now() - make_interval(days => 3 + floor(game.house_u(v_key || ':age') * 40)::INT,
                                  mins => floor(game.house_u(v_key || ':min') * 1440)::INT))
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_user;
    IF v_user IS NULL THEN
      SELECT id INTO v_user FROM game.users WHERE username = ('player_' || upper(substr(md5(v_key), 1, 8)))::CITEXT;
    END IF;

    INSERT INTO game.house_players
      (user_id, league_id, slot, plays_five, plays_full, style, attendance, fav_team_id,
       formation_full, formation_five, team_name)
    VALUES (v_user, p_league_id, i,
            i <= 15, i <= 12 OR i >= 16,
            (ARRAY['chalk','value','differential','homer','casual','chalk'])[1 + floor(u1 * 6)::INT],
            round((0.55 + 0.40 * u2)::NUMERIC, 2),
            v_fav,
            CASE WHEN u3 < 0.30 THEN '4-3-3' WHEN u3 < 0.50 THEN '4-4-2' WHEN u3 < 0.65 THEN '3-5-2'
                 WHEN u3 < 0.80 THEN '4-2-3-1' WHEN u3 < 0.92 THEN '3-4-3' ELSE '5-3-2' END,
            CASE WHEN u4 < 0.55 THEN '2-1-1' ELSE '1-2-1' END,
            v_id.team_name)
    ON CONFLICT DO NOTHING;
    v_made := v_made + 1;
  END LOOP;
  RETURN v_made;
END;
$$;

-- ---------------------------------------------------------------------
-- §4 · בניית הרכב והגשה
-- ---------------------------------------------------------------------
/**
 * בונה ומגיש הרכב למשתתף בית. מחזיר את מזהה ההרכב.
 * חריגה (אין מספיק שחקנים / תקציב / ולידציה) → EXCEPTION, ושום דבר לא נכתב.
 */
CREATE OR REPLACE FUNCTION game.house_submit(p_user UUID, p_gw UUID, p_mode TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  hp        game.house_players;
  g         game.gameweeks;
  v_key     TEXT;
  v_form    TEXT;
  v_rows    INT[];
  v_need    JSONB;
  v_budget  NUMERIC;
  v_size    INT;
  v_spent   NUMERIC := 0;
  v_left    INT;
  v_minp    NUMERIC;
  v_hist    BOOLEAN;
  v_teams   UUID[] := '{}';
  v_pid     UUID[] := '{}';
  v_tid     UUID[] := '{}';
  v_pos     TEXT[] := '{}';
  v_price   NUMERIC[] := '{}';
  v_q       DOUBLE PRECISION[] := '{}';
  v_lineup  UUID;
  v_cap     INT := 1;
  v_vice    INT := NULL;
  v_best    DOUBLE PRECISION;
  v_sc      DOUBLE PRECISION;
  v_pass    INT;
  r         RECORD;
  i         INT;
  v_order   INT;
  v_alt     TEXT[];
BEGIN
  SELECT * INTO hp FROM game.house_players WHERE user_id = p_user;
  IF hp.user_id IS NULL THEN RAISE EXCEPTION 'NOT_HOUSE_PLAYER'; END IF;
  SELECT * INTO g FROM game.gameweeks WHERE id = p_gw;
  IF g.id IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND'; END IF;
  IF g.status NOT IN ('open','draft') OR now() >= g.lock_at THEN RAISE EXCEPTION 'GAMEWEEK_LOCKED'; END IF;

  IF EXISTS (SELECT 1 FROM game.user_lineups WHERE user_id = p_user AND gameweek_id = p_gw
                AND mode = p_mode AND status IN ('submitted','locked','scored')) THEN
    RETURN (SELECT id FROM game.user_lineups WHERE user_id = p_user AND gameweek_id = p_gw AND mode = p_mode);
  END IF;

  v_key  := g.code || ':' || p_mode || ':' || p_user::TEXT;
  v_size := COALESCE((SELECT lineup_size FROM game.mode_config WHERE mode = p_mode),
                     CASE p_mode WHEN 'five' THEN 5 ELSE 11 END);
  v_budget := (SELECT budget FROM game.mode_config WHERE mode = p_mode);

  /* מערך: המועדף, ובחמישית מהמחזורים — אחר. */
  v_form := CASE p_mode WHEN 'five' THEN hp.formation_five ELSE hp.formation_full END;
  IF game.house_u(v_key || ':switch') < 0.20 THEN
    v_alt := CASE p_mode WHEN 'five' THEN ARRAY['2-1-1','1-2-1']
             ELSE ARRAY['4-3-3','4-4-2','3-5-2','4-2-3-1','3-4-3','5-3-2'] END;
    v_form := v_alt[1 + floor(game.house_u(v_key || ':alt') * array_length(v_alt, 1))::INT];
  END IF;
  v_rows := string_to_array(v_form, '-')::INT[];
  v_need := jsonb_build_object(
    'GK', 1, 'DEF', v_rows[1], 'FWD', v_rows[array_length(v_rows, 1)],
    'MID', (SELECT COALESCE(sum(x), 0) FROM unnest(v_rows[2:array_length(v_rows, 1) - 1]) x));
  IF 1 + (SELECT sum(x) FROM unnest(v_rows) x) <> v_size THEN
    RAISE EXCEPTION 'FORMATION_SIZE: % for %', v_form, p_mode;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM core.player_match_stats pms
      JOIN core.weekly_matches m ON m.id = pms.match_id
      JOIN game.gameweeks pg ON pg.id = m.gameweek_id
     WHERE pg.season_id = g.season_id AND pg.status = 'published') INTO v_hist;

  SELECT COALESCE(min(GREATEST(COALESCE(fantasy_price, 1), 0)), 0) INTO v_minp
    FROM core.squads WHERE season_id = g.season_id AND valid_to IS NULL AND status = 'active';

  /* שני מעברים: לפי הטעם, ואם התקציב חנק — מהזול. */
  FOR v_pass IN 1..2 LOOP
    EXIT WHEN array_length(v_pid, 1) = v_size;
    FOR r IN
  WITH fx AS (
    SELECT home_team_id AS t FROM core.weekly_matches
     WHERE gameweek_id = g.id AND COALESCE(status, '') NOT IN ('postponed','cancelled','abandoned')
    UNION
    SELECT away_team_id FROM core.weekly_matches
     WHERE gameweek_id = g.id AND COALESCE(status, '') NOT IN ('postponed','cancelled','abandoned')
  ), recent AS (
    SELECT id FROM game.gameweeks
     WHERE season_id = g.season_id AND status = 'published' AND id <> g.id
     ORDER BY number DESC LIMIT 3
  ), form AS (
    SELECT pms.player_id,
           count(*) AS apps,
           count(*) FILTER (WHERE pms.started) AS starts,
           COALESCE(sum(pms.minutes), 0) AS mins,
           COALESCE(sum(pms.goals), 0) AS goals,
           COALESCE(sum(pms.assists), 0) AS assists,
           count(*) FILTER (WHERE pms.clean_sheet) AS cs
      FROM core.player_match_stats pms
      JOIN core.weekly_matches m ON m.id = pms.match_id
     WHERE m.gameweek_id IN (SELECT id FROM recent)
     GROUP BY pms.player_id
  ), c AS (
    SELECT DISTINCT ON (sq.player_id)
           sq.player_id, sq.team_id, sq.position::TEXT AS position,
           GREATEST(COALESCE(sq.fantasy_price, 1), 0) AS price,
           f.apps, f.starts, f.mins, f.goals, f.assists, f.cs,
           (fx.t IS NOT NULL) AS plays
      FROM core.squads sq
      LEFT JOIN fx ON fx.t = sq.team_id
      LEFT JOIN form f ON f.player_id = sq.player_id
     WHERE sq.season_id = g.season_id AND sq.valid_to IS NULL AND sq.status = 'active'
     ORDER BY sq.player_id, sq.valid_from DESC
  ), q AS (
    SELECT c.*,
           LEAST(c.price / 5.0, 1.0) AS pn,
           CASE
             WHEN c.apps IS NULL AND v_hist THEN 0.10                 -- לא שיחק לאחרונה
             WHEN c.apps IS NULL THEN 0.50                            -- אין עדיין היסטוריה
             WHEN c.mins = 0 THEN 0.05                                -- ספסל
             ELSE LEAST(1.0, (c.starts + c.mins / 90.0 + 1.5 * c.goals + c.assists
                              + CASE WHEN c.position IN ('GK','DEF') THEN 0.7 * c.cs ELSE 0 END)
                             / (2.6 * c.apps))
           END AS fn,
           game.house_u(v_key || ':' || c.player_id::TEXT) AS nz
      FROM c
  )
  SELECT q.player_id, q.team_id, q.position, q.price,
         0.5 * q.pn + 0.5 * q.fn AS qual,
         (CASE hp.style
            WHEN 'chalk'        THEN (0.5 * q.pn + 0.5 * q.fn) + 0.15 * q.nz
            WHEN 'value'        THEN (0.5 * q.pn + 0.5 * q.fn) - 0.30 * q.pn + 0.20 * q.nz
            WHEN 'differential' THEN (0.5 * q.pn + 0.5 * q.fn) - CASE WHEN q.price >= 4 THEN 0.22 ELSE 0 END + 0.30 * q.nz
            WHEN 'homer'        THEN (0.5 * q.pn + 0.5 * q.fn) + CASE WHEN q.team_id = hp.fav_team_id THEN 0.45 ELSE 0 END + 0.20 * q.nz
            ELSE                     0.6 * (0.5 * q.pn + 0.5 * q.fn) + 0.50 * q.nz
          END)
         + CASE WHEN q.team_id = hp.fav_team_id THEN 0.08 ELSE 0 END
         -- קבוצה בלי משחק במחזור (נדחה) — רק אם אין ברירה.
         - CASE WHEN q.plays THEN 0 ELSE 5 END AS score
    FROM q
   ORDER BY CASE WHEN v_pass = 1 THEN 0 WHEN q.plays THEN q.price ELSE 100 + q.price END,
            score DESC, q.player_id
    LOOP
      EXIT WHEN COALESCE(array_length(v_pid, 1), 0) = v_size;
      CONTINUE WHEN r.team_id = ANY (v_teams) OR r.player_id = ANY (v_pid);
      CONTINUE WHEN COALESCE((v_need->>r.position)::INT, 0) <= 0;
      v_left := v_size - COALESCE(array_length(v_pid, 1), 0);
      CONTINUE WHEN v_budget IS NOT NULL AND v_spent + r.price + (v_left - 1) * v_minp > v_budget;
      v_pid   := v_pid   || r.player_id;
      v_tid   := v_tid   || r.team_id;
      v_teams := v_teams || r.team_id;
      v_pos   := v_pos   || r.position;
      v_price := v_price || r.price;
      v_q     := v_q     || r.qual;
      v_spent := v_spent + r.price;
      v_need  := jsonb_set(v_need, ARRAY[r.position], to_jsonb((v_need->>r.position)::INT - 1));
    END LOOP;
  END LOOP;

  IF COALESCE(array_length(v_pid, 1), 0) <> v_size THEN
    RAISE EXCEPTION 'HOUSE_NOT_ENOUGH_PLAYERS: % of %', COALESCE(array_length(v_pid, 1), 0), v_size;
  END IF;
  IF v_budget IS NOT NULL AND v_spent > v_budget THEN
    RAISE EXCEPTION 'OVER_BUDGET: % > %', v_spent, v_budget;
  END IF;

  /* קפטן: הכי טוב בהתקפה/קישור, עם קצת טעם אישי. אוהד — מהקבוצה שלו. */
  v_best := -1;
  FOR i IN 1..v_size LOOP
    v_sc := v_q[i]
          + CASE v_pos[i] WHEN 'FWD' THEN 0.15 WHEN 'MID' THEN 0.08 WHEN 'GK' THEN -0.4 ELSE 0 END
          + 0.20 * game.house_u(v_key || ':cap:' || v_pid[i]::TEXT)
          + CASE WHEN hp.style = 'homer' AND v_tid[i] = hp.fav_team_id AND v_pos[i] IN ('MID','FWD')
                 THEN 0.6 ELSE 0 END;
    IF v_sc > v_best THEN v_best := v_sc; v_cap := i; END IF;
  END LOOP;
  IF game.house_u(v_key || ':vice') < 0.5 THEN
    v_best := -1;
    FOR i IN 1..v_size LOOP
      CONTINUE WHEN i = v_cap OR v_pos[i] = 'GK';
      IF v_q[i] > v_best THEN v_best := v_q[i]; v_vice := i; END IF;
    END LOOP;
  END IF;

  DELETE FROM game.user_lineups WHERE user_id = p_user AND gameweek_id = p_gw AND mode = p_mode;
  INSERT INTO game.user_lineups (user_id, gameweek_id, mode, formation, status, submitted_at, team_name)
  VALUES (p_user, p_gw, p_mode, v_form, 'draft', now(), hp.team_name)
  RETURNING id INTO v_lineup;

  /* מספור כמו בקליינט: שוער, הגנה, קישור, התקפה. */
  v_order := 0;
  FOR r IN
    SELECT x.i FROM generate_subscripts(v_pid, 1) AS x(i)
     ORDER BY array_position(ARRAY['GK','DEF','MID','FWD'], v_pos[x.i]), v_q[x.i] DESC
  LOOP
    v_order := v_order + 1;
    INSERT INTO game.user_lineup_slots
      (lineup_id, slot_no, player_id, team_id, position, price, is_captain, is_vice, is_bench)
    VALUES (v_lineup, v_order, v_pid[r.i], v_tid[r.i], v_pos[r.i]::core.position, v_price[r.i],
            r.i = v_cap, COALESCE(r.i = v_vice, FALSE), FALSE);
  END LOOP;

  /* אותו שער כמו בן אדם: הטריגר מריץ את `assert_lineup_valid`. */
  UPDATE game.user_lineups SET status = 'submitted', submitted_at = now() WHERE id = v_lineup;

  PERFORM game.log_activity(p_user, 'bot_submit', p_mode, g.code,
            COALESCE(hp.team_name, (SELECT display_name FROM game.users WHERE id = p_user)));
  RETURN v_lineup;
END;
$$;

-- ---------------------------------------------------------------------
-- §5 · תכנון מחזור ופעימה
-- ---------------------------------------------------------------------
/** מתכנן מי מגיע ומתי. פעם אחת לכל מחזור ומצב. מחזיר כמה תוכננו. */
CREATE OR REPLACE FUNCTION game.house_plan(p_gw UUID, p_mode TEXT)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  g      game.gameweeks;
  cfg    game.house_config;
  v_lg   UUID;
  v_lgc  TEXT;
  v_n    INT;
  v_from TIMESTAMPTZ;
  v_to   TIMESTAMPTZ;
  v_tz   INT;
  v_made INT := 0;
  r      RECORD;
  u5 DOUBLE PRECISION; u6 DOUBLE PRECISION;
  v_frac DOUBLE PRECISION;
  v_due  TIMESTAMPTZ;
  v_h    INT;
BEGIN
  SELECT * INTO cfg FROM game.house_config WHERE id = 1;
  SELECT * INTO g FROM game.gameweeks WHERE id = p_gw;
  IF g.id IS NULL THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM game.house_schedule WHERE gameweek_id = p_gw AND mode = p_mode) THEN RETURN 0; END IF;

  SELECT s.league_id, l.code INTO v_lg, v_lgc
    FROM core.seasons s JOIN core.leagues l ON l.id = s.league_id WHERE s.id = g.season_id;
  PERFORM game.house_ensure_roster(v_lg);

  v_n := cfg.min_per_round
       + floor(game.house_u(g.code || ':' || p_mode || ':n') * (cfg.max_per_round - cfg.min_per_round + 1))::INT;

  v_from := now() + INTERVAL '5 minutes';
  v_to   := g.lock_at - INTERVAL '20 minutes';
  IF v_to < v_from THEN v_to := v_from; END IF;
  -- שעון מקומי גס, רק כדי לא להגיש באמצע הלילה.
  v_tz := CASE v_lgc WHEN 'EN_PL' THEN 0 WHEN 'ES_LALIGA' THEN 1 ELSE 2 END;

  FOR r IN
    SELECT hp.user_id
      FROM game.house_players hp
     WHERE hp.league_id = v_lg
       AND CASE p_mode WHEN 'five' THEN hp.plays_five ELSE hp.plays_full END
     ORDER BY power(GREATEST(game.house_u(g.code || ':' || p_mode || ':' || hp.user_id::TEXT), 1e-9),
                    1.0 / hp.attendance::DOUBLE PRECISION) DESC
     LIMIT v_n
  LOOP
    u5 := game.house_u(g.code || ':' || p_mode || ':' || r.user_id::TEXT || ':t1');
    u6 := game.house_u(g.code || ':' || p_mode || ':' || r.user_id::TEXT || ':t2');
    v_frac := CASE WHEN u5 < 0.30 THEN 0.25 * u6 ELSE 0.25 + 0.75 * sqrt(u6) END;
    v_due := v_from + (v_to - v_from) * v_frac;
    v_h := extract(hour FROM v_due + make_interval(hours => v_tz))::INT;
    IF v_h BETWEEN 1 AND 6 AND v_due + make_interval(hours => 7 - v_h) < v_to THEN
      v_due := v_due + make_interval(hours => 7 - v_h);
    END IF;
    INSERT INTO game.house_schedule (gameweek_id, mode, user_id, due_at)
    VALUES (p_gw, p_mode, r.user_id, v_due) ON CONFLICT DO NOTHING;
    v_made := v_made + 1;
  END LOOP;
  RETURN v_made;
END;
$$;

/**
 * הפעימה (pg_cron כל 5 דקות). מתכננת מחזורים פתוחים חדשים ומגישה את מי
 * שהגיע זמנו. כישלון של משתתף אחד נרשם ב-`problem` ולא עוצר אחרים.
 */
CREATE OR REPLACE FUNCTION game.house_tick()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  cfg    game.house_config;
  g      RECORD;
  m      TEXT;
  s      RECORD;
  v_planned INT := 0;
  v_done    INT := 0;
  v_fail    INT := 0;
  v_lid     UUID;
BEGIN
  SELECT * INTO cfg FROM game.house_config WHERE id = 1;
  IF NOT COALESCE(cfg.enabled, FALSE) THEN RETURN jsonb_build_object('enabled', false); END IF;

  FOR g IN
    SELECT id FROM game.gameweeks
     WHERE status = 'open' AND now() < lock_at - INTERVAL '10 minutes'
  LOOP
    FOREACH m IN ARRAY ARRAY['five','full'] LOOP
      v_planned := v_planned + game.house_plan(g.id, m);
    END LOOP;
  END LOOP;

  FOR s IN
    SELECT hs.gameweek_id, hs.mode, hs.user_id
      FROM game.house_schedule hs
      JOIN game.gameweeks gw ON gw.id = hs.gameweek_id
     WHERE hs.done_at IS NULL AND hs.problem IS NULL AND hs.due_at <= now()
       AND gw.status = 'open' AND now() < gw.lock_at - INTERVAL '5 minutes'
     ORDER BY hs.due_at
     LIMIT 60
  LOOP
    -- רק כשבן אדם יכול להגיש.
    CONTINUE WHEN NOT COALESCE((game.format_readiness(s.gameweek_id, s.mode)->>'canSubmit')::BOOLEAN, FALSE);
    BEGIN
      v_lid := game.house_submit(s.user_id, s.gameweek_id, s.mode);
      UPDATE game.house_schedule SET done_at = now(), lineup_id = v_lid
       WHERE gameweek_id = s.gameweek_id AND mode = s.mode AND user_id = s.user_id;
      v_done := v_done + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE game.house_schedule SET problem = left(SQLERRM, 300)
       WHERE gameweek_id = s.gameweek_id AND mode = s.mode AND user_id = s.user_id;
      v_fail := v_fail + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('enabled', true, 'planned', v_planned, 'submitted', v_done, 'failed', v_fail);
END;
$$;

-- ---------------------------------------------------------------------
-- §6 · אדמין
-- ---------------------------------------------------------------------
/**
 * ★ הכלי הישן מנותב למנוע החדש — מערכת אחת, לא שתיים.
 *   מגיש עכשיו את `p_count` משתתפי הבית הראשונים (בסדר קבוע) שעוד לא הגישו.
 */
CREATE OR REPLACE FUNCTION game.admin_add_bots(p_gw_code TEXT, p_mode TEXT, p_count INT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  v_gw game.gameweeks; v_lg UUID;
  v_added INT := 0; v_skipped INT := 0; v_problems JSONB := '[]'::jsonb;
  r RECORD; v_lid UUID; i INT := 0;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF p_mode NOT IN ('five','full') THEN RAISE EXCEPTION 'INVALID_MODE'; END IF;
  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw.id IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND'; END IF;
  SELECT league_id INTO v_lg FROM core.seasons WHERE id = v_gw.season_id;
  PERFORM game.house_ensure_roster(v_lg);

  FOR r IN
    SELECT hp.user_id FROM game.house_players hp
     WHERE hp.league_id = v_lg AND CASE p_mode WHEN 'five' THEN hp.plays_five ELSE hp.plays_full END
     ORDER BY game.house_u(p_gw_code || ':' || p_mode || ':admin:' || hp.slot), hp.slot
     LIMIT GREATEST(1, LEAST(p_count, 15))
  LOOP
    i := i + 1;
    IF EXISTS (SELECT 1 FROM game.user_lineups WHERE user_id = r.user_id AND gameweek_id = v_gw.id
                  AND mode = p_mode AND status IN ('submitted','locked','scored')) THEN
      v_skipped := v_skipped + 1; CONTINUE;
    END IF;
    BEGIN
      v_lid := game.house_submit(r.user_id, v_gw.id, p_mode);
      INSERT INTO game.house_schedule (gameweek_id, mode, user_id, due_at, done_at, lineup_id)
      VALUES (v_gw.id, p_mode, r.user_id, now(), now(), v_lid)
      ON CONFLICT (gameweek_id, mode, user_id) DO UPDATE
        SET done_at = now(), lineup_id = EXCLUDED.lineup_id, problem = NULL;
      v_added := v_added + 1;
    EXCEPTION WHEN OTHERS THEN
      v_problems := v_problems || jsonb_build_object('bot', i, 'issue', left(SQLERRM, 200));
    END;
  END LOOP;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (COALESCE(auth.uid()::TEXT, 'admin'), 'admin_add_bots', 'gameweek', p_gw_code,
          jsonb_build_object('mode', p_mode, 'added', v_added, 'skipped', v_skipped));
  RETURN jsonb_build_object('added', v_added, 'skipped', v_skipped, 'problems', v_problems);
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_add_bots(TEXT, TEXT, INT) TO authenticated;

/** מצב משתתפי הבית: הגדרות + לכל מחזור פתוח/נעול: מתוכננים, הוגשו, תקלות. */
CREATE OR REPLACE FUNCTION game.admin_house_report()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  RETURN jsonb_build_object(
    'config', (SELECT to_jsonb(c) - 'id' FROM game.house_config c WHERE id = 1),
    'roster', COALESCE((SELECT jsonb_object_agg(l.code, n) FROM (
                SELECT league_id, count(*) n FROM game.house_players GROUP BY league_id) x
                JOIN core.leagues l ON l.id = x.league_id), '{}'::jsonb),
    'rounds', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'code', gw.code, 'status', gw.status, 'mode', hs.mode,
                'planned', count(*),
                'submitted', count(*) FILTER (WHERE hs.done_at IS NOT NULL),
                'nextDue', min(hs.due_at) FILTER (WHERE hs.done_at IS NULL AND hs.problem IS NULL),
                'problems', COALESCE(jsonb_agg(hs.problem) FILTER (WHERE hs.problem IS NOT NULL), '[]'::jsonb))
                ORDER BY gw.code, hs.mode)
              FROM game.house_schedule hs JOIN game.gameweeks gw ON gw.id = hs.gameweek_id
             WHERE gw.status IN ('open','locked','live','scoring')
             GROUP BY gw.code, gw.status, hs.mode), '[]'::jsonb));
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_house_report() TO authenticated;

CREATE OR REPLACE FUNCTION game.admin_house_set(p_enabled BOOLEAN, p_min INT DEFAULT NULL, p_max INT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v_old JSONB; v_new JSONB;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  SELECT to_jsonb(c) INTO v_old FROM game.house_config c WHERE id = 1;
  UPDATE game.house_config
     SET enabled = COALESCE(p_enabled, enabled),
         min_per_round = COALESCE(p_min, min_per_round),
         max_per_round = COALESCE(p_max, max_per_round),
         updated_at = now()
   WHERE id = 1;
  SELECT to_jsonb(c) INTO v_new FROM game.house_config c WHERE id = 1;
  INSERT INTO game.audit_logs (actor, action, entity, entity_id, old_value, new_value)
  VALUES (COALESCE(auth.uid()::TEXT, 'admin'), 'admin_house_set', 'house', 'config', v_old, v_new);
  RETURN v_new - 'id';
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_house_set(BOOLEAN, INT, INT) TO authenticated;

REVOKE ALL ON FUNCTION game.house_ensure_roster(UUID), game.house_submit(UUID, UUID, TEXT),
                       game.house_plan(UUID, TEXT), game.house_tick() FROM PUBLIC;
DO $g$ BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION game.house_ensure_roster(UUID), game.house_submit(UUID, UUID, TEXT),
           game.house_plan(UUID, TEXT), game.house_tick() FROM anon, authenticated';
EXCEPTION WHEN undefined_object THEN NULL; END $g$;

-- ---------------------------------------------------------------------
-- §7 · הבוטים הישנים («רפי 1», «אלי 3») → משתתפי הבית של הליגה
-- ---------------------------------------------------------------------
--  ההרכבים ההיסטוריים עוברים לזהויות הקבועות (רצף היסטוריה אמין),
--  משתמשי הבוט הישנים נמחקים. הניקוד והדירוג של המחזורים לא נוגעים.
DO $legacy$
DECLARE r RECORD; v_to UUID; v_tn TEXT;
BEGIN
  FOR r IN
    SELECT ul.id, ul.gameweek_id, ul.mode, ul.submitted_at, g.code, g.lock_at, s.league_id
      FROM game.user_lineups ul
      JOIN game.users u ON u.id = ul.user_id AND u.is_bot
      JOIN game.gameweeks g ON g.id = ul.gameweek_id
      JOIN core.seasons s ON s.id = g.season_id
     WHERE NOT EXISTS (SELECT 1 FROM game.house_players hp WHERE hp.user_id = u.id)
     ORDER BY g.number, ul.mode, u.username
  LOOP
    PERFORM game.house_ensure_roster(r.league_id);
    SELECT hp.user_id, hp.team_name INTO v_to, v_tn
      FROM game.house_players hp
     WHERE hp.league_id = r.league_id
       AND CASE r.mode WHEN 'five' THEN hp.plays_five ELSE hp.plays_full END
       AND NOT EXISTS (SELECT 1 FROM game.user_lineups x
                        WHERE x.user_id = hp.user_id AND x.gameweek_id = r.gameweek_id AND x.mode = r.mode)
     ORDER BY game.house_u(r.code || ':' || r.mode || ':legacy:' || hp.slot)
     LIMIT 1;
    CONTINUE WHEN v_to IS NULL;
    UPDATE game.user_lineups
       SET user_id = v_to, team_name = v_tn,
           submitted_at = CASE WHEN r.submitted_at >= r.lock_at
                               THEN r.lock_at - make_interval(hours => 2 + floor(game.house_u(r.id::TEXT) * 60)::INT)
                               ELSE r.submitted_at END
     WHERE id = r.id;
    v_to := NULL;
  END LOOP;

  DELETE FROM game.activity_log al USING game.users u
   WHERE al.user_id = u.id AND u.is_bot
     AND NOT EXISTS (SELECT 1 FROM game.house_players hp WHERE hp.user_id = u.id);
  DELETE FROM game.users u
   WHERE u.is_bot
     AND NOT EXISTS (SELECT 1 FROM game.house_players hp WHERE hp.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM game.user_lineups ul WHERE ul.user_id = u.id);
END
$legacy$;

-- סגל לכל ליגה קיימת כבר עכשיו.
DO $roster$
DECLARE l RECORD;
BEGIN
  FOR l IN SELECT id FROM core.leagues LOOP PERFORM game.house_ensure_roster(l.id); END LOOP;
END
$roster$;

INSERT INTO game.schema_migrations (version, note) VALUES
  ('60', 'משתתפי בית: 6–13 קבועים בכל ליגה ומצב, הרכב אמין ושונה בכל מחזור')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ---------------------------------------------------------------------
-- §8 · משימת cron (דקה 2, 7, 12… — לא מתנגשת עם מחזור החיים)
-- ---------------------------------------------------------------------
DO $cron$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron אינו מותקן — דלגתי.';
    RETURN;
  END IF;
  PERFORM cron.unschedule('dubid-house-tick') WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'dubid-house-tick');
  PERFORM cron.schedule('dubid-house-tick', '2-59/5 * * * *', 'SELECT game.house_tick();');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'רישום המשימה נכשל: %', SQLERRM;
END
$cron$;
