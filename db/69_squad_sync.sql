-- =====================================================================
--  db/69_squad_sync.sql — יישור סגלים מול סגלי הספק (365scores), מבוקר
-- =====================================================================
--  ★ למה: סגלי IL נבנו מקובץ ידני. מספרי חולצה ישנים גרמו לקליטה למפות
--    שחקני ספק לשחקן הלא נכון ("matchedBy: shirt") — סטטיסטיקה של אלי דסה
--    נרשמה לזוהר זסנו. שחקנים שעברו קבוצה, עזבו או הצטרפו לא עודכנו.
--  ★ איך: שני שלבים, תמיד.
--    1. game.squad_sync_plan(league)  — קריאה בלבד מול הנתונים החיים: מייצר
--       ריצה + רשימת פריטים (מה ישתנה ולמה). שום שינוי בסגל.
--    2. game.squad_sync_apply(run_id) — מבצע את הריצה, כל פריט נרשם ב-audit_logs.
--  ★ זיהוי שחקן ↔ אתלט של הספק (לפי סדר):
--      a. קישור קודם (provider 'scores365_athlete')
--      b. שם זהה (אנגלית בלי סימנים / עברית בלי רווחים-גרשים / אותן מילים בסדר
--         אחר) — ייחודי בשני הצדדים, בכל הליגה (כך מתגלים מעברים)
--      c. באותה קבוצה: דמיון שם ≥0.5 עם פער ≥0.1, או אותה חולצה+עמדה כזוג יחיד בשני הצדדים
--    מה שלא זוהה לא "מנוחש".
--  ★ מה מתבצע:
--      link        קישור שחקן↔אתלט (לעתיד: הקליטה לא תסתמך על חולצה)
--      transfer    עבר קבוצה → נסגרת שורת הסגל הישנה, נפתחת חדשה (מחיר/דרג נשמרים)
--      duplicate   שורת סגל פעילה כפולה לאותו שחקן → נסגרת
--      shirt       מספר חולצה מהספק
--      name_en     שם אנגלי חסר
--      left        לא בסגל הספק → נסגר (valid_to, status='left'). השחקן לא נמחק.
--      new         בסגל הספק ולא אצלנו → שחקן חדש, לא מדורג; מחיר/דרג = חציון אותה קבוצה+עמדה
--                  (נפילה: חציון העמדה בליגה). לא 1.0 — שחקן נבחרת ב-1M הוא פרצה.
--      ref_fix     מיפוי קליטה (member id) שמצביע על שחקן אחר → מתוקן, וסטטיסטיקה
--                  שנרשמה לשחקן הלא נכון עוברת לנכון (רשימת מחזורים לניקוד מחדש)
--      ref_drop    מיפוי שגוי בלי שחקן נכון אצלנו → מוסר (הקליטה תמפה מחדש)
--      position    עמדה שונה מהספק — **דיווח בלבד** (עמדה היא החלטת משחק)
--  ★ לא נוגע: הרכבים שהוגשו, ניקוד שפורסם, מחירים/דרגים קיימים, מחיקת שחקנים.
-- =====================================================================
BEGIN;
SET search_path = game, core, public;

CREATE TABLE IF NOT EXISTS game.squad_sync_runs (
  id          BIGSERIAL PRIMARY KEY,
  league_code TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT,
  applied_at  TIMESTAMPTZ,
  summary     JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS game.squad_sync_items (
  run_id     BIGINT NOT NULL REFERENCES game.squad_sync_runs(id) ON DELETE CASCADE,
  seq        INT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('link','transfer','duplicate','shirt','name_en','left','new','ref_fix','ref_drop','position')),
  player_id  UUID,
  athlete_id TEXT,
  team_from  UUID,
  team_to    UUID,
  detail     JSONB NOT NULL DEFAULT '{}'::jsonb,
  applied    BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (run_id, seq)
);
ALTER TABLE game.squad_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE game.squad_sync_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON game.squad_sync_runs, game.squad_sync_items FROM anon, authenticated;

/** מפתחות השוואה לשם */
CREATE OR REPLACE FUNCTION core.key_en(p TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(regexp_replace(lower(public.unaccent(COALESCE(CASE WHEN core.usable_en(p) THEN p END, ''))), '[^a-z]', '', 'g'), '')
$$;
CREATE OR REPLACE FUNCTION core.key_he(p TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(regexp_replace(COALESCE(p, ''), '[^א-ת]', '', 'g'), '')
$$;
/** אותן מילים בסדר אחר: "סדריק דון" ≡ "דון סדריק" */
CREATE OR REPLACE FUNCTION core.key_he_tokens(p TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(string_agg(w, ' ' ORDER BY w), '')
    FROM unnest(regexp_split_to_array(regexp_replace(COALESCE(p, ''), '[^א-ת ]', '', 'g'), '\s+')) w
   WHERE w <> ''
$$;

-- ---------------------------------------------------------------------
-- תכנון (קריאה בלבד מול הסגל)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION game.squad_sync_plan(p_league TEXT, p_min_athletes INT DEFAULT 100)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  v_run BIGINT; v_season UUID; v_pending INT; v_prov INT; v_sum JSONB;
BEGIN
  IF to_regclass('net._http_response') IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'pg_net missing'); END IF;
  SELECT se.id INTO v_season FROM core.seasons se JOIN core.leagues l ON l.id = se.league_id
   WHERE l.code = p_league AND se.is_current;
  IF v_season IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'no current season'); END IF;

  SELECT count(*) FILTER (WHERE h.id IS NULL OR h.status_code IS DISTINCT FROM 200) INTO v_pending
    FROM game.name_fetch_requests q LEFT JOIN net._http_response h ON h.id = q.request_id
   WHERE q.league_code = p_league;
  IF v_pending > 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'provider responses missing — run names_fetch and wait', 'pending', v_pending);
  END IF;

  DROP TABLE IF EXISTS _prov, _ours, _link, _it, _mem;
  -- סגלי הספק (עברית+אנגלית לאותו אתלט)
  CREATE TEMP TABLE _prov ON COMMIT DROP AS
  WITH resp AS (
    SELECT q.team_id, q.lang, a
      FROM game.name_fetch_requests q
      JOIN net._http_response h ON h.id = q.request_id AND h.status_code = 200
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE((h.content::jsonb) #> '{squads,0,athletes}', '[]'::jsonb)) a
     WHERE q.league_code = p_league)
  SELECT DISTINCT ON (en.a->>'id')
         he.team_id, en.a->>'id' AS aid, he.a->>'name' AS he, en.a->>'name' AS en,
         NULLIF(NULLIF((en.a->>'jerseyNum')::INT, -1), 0) AS shirt,
         CASE en.a #>> '{position,name}' WHEN 'Goalkeeper' THEN 'GK' WHEN 'Defender' THEN 'DEF'
              WHEN 'Midfielder' THEN 'MID' WHEN 'Attacker' THEN 'FWD' END AS pos
    FROM resp he JOIN resp en ON en.team_id = he.team_id AND en.lang = 1 AND en.a->>'id' = he.a->>'id'
   WHERE he.lang = 2 AND en.a #>> '{position,name}' IN ('Goalkeeper','Defender','Midfielder','Attacker')
   ORDER BY en.a->>'id';
  SELECT count(*) INTO v_prov FROM _prov;
  IF v_prov < p_min_athletes THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'provider squads look incomplete', 'athletes', v_prov); END IF;

  -- הסגל שלנו
  CREATE TEMP TABLE _ours ON COMMIT DROP AS
  SELECT s.id AS sq_id, s.player_id, s.team_id, s.shirt_number, s.position::TEXT AS pos,
         pl.name_he, pl.name_en
    FROM core.squads s JOIN core.players pl ON pl.id = s.player_id
   WHERE s.season_id = v_season AND s.valid_to IS NULL;

  CREATE TEMP TABLE _link (player_id UUID PRIMARY KEY, aid TEXT UNIQUE, how TEXT) ON COMMIT DROP;

  -- a. קישור קודם
  INSERT INTO _link
  SELECT DISTINCT ON (x.entity_id) x.entity_id, x.external_id, 'prior'
    FROM core.external_refs x
   WHERE x.provider = 'scores365_athlete' AND x.entity_type = 'player'
     AND x.entity_id IN (SELECT player_id FROM _ours) AND x.external_id IN (SELECT aid FROM _prov)
  ON CONFLICT DO NOTHING;

  -- b. שם זהה, ייחודי בשני הצדדים, בכל הליגה
  WITH o AS (SELECT DISTINCT player_id, core.key_en(name_en) ken, core.key_he(name_he) khe, core.key_he_tokens(name_he) ktk
               FROM _ours WHERE player_id NOT IN (SELECT player_id FROM _link)),
       p AS (SELECT aid, core.key_en(en) ken, core.key_he(he) khe, core.key_he_tokens(he) ktk
               FROM _prov WHERE aid NOT IN (SELECT aid FROM _link)),
       c AS (SELECT DISTINCT o.player_id, p.aid FROM o JOIN p
               ON (o.ken IS NOT NULL AND o.ken = p.ken) OR (o.khe IS NOT NULL AND o.khe = p.khe)
               OR (o.ktk IS NOT NULL AND o.ktk = p.ktk)),
       u AS (SELECT c.* FROM c
              WHERE (SELECT count(*) FROM c c2 WHERE c2.player_id = c.player_id) = 1
                AND (SELECT count(*) FROM c c3 WHERE c3.aid = c.aid) = 1)
  INSERT INTO _link SELECT player_id, aid, 'name' FROM u ON CONFLICT DO NOTHING;

  -- c. באותה קבוצה: דמיון, עם פער; או חולצה+עמדה
  WITH o AS (SELECT * FROM _ours WHERE player_id NOT IN (SELECT player_id FROM _link)),
       p AS (SELECT * FROM _prov WHERE aid NOT IN (SELECT aid FROM _link)),
       sc AS (SELECT o.player_id, p.aid,
                     similarity(COALESCE(o.name_he, ''), COALESCE(p.he, '')) AS sim,
                     (o.shirt_number IS NOT NULL AND o.shirt_number = p.shirt AND o.pos = p.pos) AS shirt_pos
                FROM o JOIN p ON p.team_id = o.team_id),
       r AS (SELECT sc.*,
                    row_number() OVER (PARTITION BY player_id ORDER BY sim DESC) AS rp,
                    lead(sim) OVER (PARTITION BY player_id ORDER BY sim DESC) AS next_p,
                    row_number() OVER (PARTITION BY aid ORDER BY sim DESC) AS ra,
                    lead(sim) OVER (PARTITION BY aid ORDER BY sim DESC) AS next_a,
                    count(*) FILTER (WHERE shirt_pos) OVER (PARTITION BY player_id) AS sp_p,
                    count(*) FILTER (WHERE shirt_pos) OVER (PARTITION BY aid) AS sp_a
               FROM sc),
       ok AS (SELECT player_id, aid FROM r
               WHERE (rp = 1 AND ra = 1 AND sim >= 0.5 AND sim - COALESCE(next_p, 0) >= 0.1 AND sim - COALESCE(next_a, 0) >= 0.1)
                  -- ★ אותה קבוצה+חולצה+עמדה, והזוג היחיד כזה בשני הצדדים ("סמואל סילבה" = "Samu")
                  OR (shirt_pos AND sp_p = 1 AND sp_a = 1))
  INSERT INTO _link SELECT DISTINCT ON (player_id) player_id, aid, 'similar' FROM ok ON CONFLICT DO NOTHING;

  INSERT INTO game.squad_sync_runs (league_code, created_by) VALUES (p_league, COALESCE(auth.uid()::TEXT, 'system'))
  RETURNING id INTO v_run;

  CREATE TEMP SEQUENCE IF NOT EXISTS _seq; PERFORM setval('_seq', 1, FALSE);
  CREATE TEMP TABLE _it (LIKE game.squad_sync_items INCLUDING DEFAULTS) ON COMMIT DROP;

  -- link
  INSERT INTO _it (run_id, seq, kind, player_id, athlete_id, detail)
  SELECT v_run, nextval('_seq'), 'link', l.player_id, l.aid,
         jsonb_build_object('how', l.how, 'ours', (SELECT name_he FROM _ours WHERE player_id = l.player_id LIMIT 1),
                            'provider', p.en, 'providerHe', p.he)
    FROM _link l JOIN _prov p ON p.aid = l.aid
   WHERE NOT EXISTS (SELECT 1 FROM core.external_refs x WHERE x.provider = 'scores365_athlete' AND x.entity_type = 'player'
                      AND x.external_id = l.aid AND x.entity_id = l.player_id);

  -- transfer: אין שורה פעילה בקבוצת הספק
  INSERT INTO _it (run_id, seq, kind, player_id, athlete_id, team_from, team_to, detail)
  SELECT v_run, nextval('_seq'), 'transfer', l.player_id, l.aid,
         (SELECT o.team_id FROM _ours o WHERE o.player_id = l.player_id ORDER BY o.sq_id LIMIT 1), p.team_id,
         jsonb_build_object('name', p.en, 'shirt', p.shirt)
    FROM _link l JOIN _prov p ON p.aid = l.aid
   WHERE NOT EXISTS (SELECT 1 FROM _ours o WHERE o.player_id = l.player_id AND o.team_id = p.team_id);

  -- duplicate: שורות פעילות נוספות לאותו שחקן
  INSERT INTO _it (run_id, seq, kind, player_id, team_from, detail)
  SELECT v_run, nextval('_seq'), 'duplicate', o.player_id, o.team_id, jsonb_build_object('squadId', o.sq_id, 'position', o.pos)
    FROM _ours o
    LEFT JOIN _link l ON l.player_id = o.player_id
    LEFT JOIN _prov p ON p.aid = l.aid
   WHERE l.player_id IS NOT NULL
     AND (SELECT count(*) FROM _ours o2 WHERE o2.player_id = o.player_id) > 1
     AND o.sq_id <> (SELECT o3.sq_id FROM _ours o3 WHERE o3.player_id = o.player_id
                      ORDER BY (o3.team_id = p.team_id) DESC NULLS LAST, (o3.pos = p.pos) DESC NULLS LAST, o3.sq_id LIMIT 1)
     AND NOT EXISTS (SELECT 1 FROM _it t WHERE t.kind = 'transfer' AND t.player_id = o.player_id);

  -- shirt / name_en / position
  INSERT INTO _it (run_id, seq, kind, player_id, athlete_id, team_to, detail)
  SELECT v_run, nextval('_seq'), 'shirt', l.player_id, l.aid, p.team_id,
         jsonb_build_object('from', o.shirt_number, 'to', p.shirt)
    FROM _link l JOIN _prov p ON p.aid = l.aid JOIN _ours o ON o.player_id = l.player_id AND o.team_id = p.team_id
   WHERE o.shirt_number IS DISTINCT FROM p.shirt;
  INSERT INTO _it (run_id, seq, kind, player_id, athlete_id, detail)
  SELECT DISTINCT ON (l.player_id) v_run, nextval('_seq'), 'name_en', l.player_id, l.aid, jsonb_build_object('to', p.en)
    FROM _link l JOIN _prov p ON p.aid = l.aid JOIN _ours o ON o.player_id = l.player_id
   WHERE NOT core.usable_en(o.name_en) AND core.usable_en(p.en);
  INSERT INTO _it (run_id, seq, kind, player_id, athlete_id, detail)
  SELECT DISTINCT ON (l.player_id) v_run, nextval('_seq'), 'position', l.player_id, l.aid,
         jsonb_build_object('ours', o.pos, 'provider', p.pos, 'name', p.en)
    FROM _link l JOIN _prov p ON p.aid = l.aid JOIN _ours o ON o.player_id = l.player_id
   WHERE o.pos IS DISTINCT FROM p.pos;

  -- left: לא זוהה בסגל הספק
  INSERT INTO _it (run_id, seq, kind, player_id, team_from, detail)
  SELECT v_run, nextval('_seq'), 'left', o.player_id, o.team_id, jsonb_build_object('squadId', o.sq_id, 'name', o.name_he)
    FROM _ours o WHERE o.player_id NOT IN (SELECT player_id FROM _link);

  -- new: בסגל הספק ולא אצלנו
  INSERT INTO _it (run_id, seq, kind, athlete_id, team_to, detail)
  SELECT v_run, nextval('_seq'), 'new', p.aid, p.team_id,
         jsonb_build_object('he', p.he, 'en', p.en, 'shirt', p.shirt, 'position', p.pos)
    FROM _prov p WHERE p.aid NOT IN (SELECT aid FROM _link);

  -- מיפויי קליטה (member id → athleteId) מתוך משחקי הספק שנקלטו
  CREATE TEMP TABLE _mem ON COMMIT DROP AS
  SELECT DISTINCT ON (m->>'id') m->>'id' AS mid, m->>'athleteId' AS aid, m->>'name' AS nm
    FROM (SELECT DISTINCT ON (r.external_id) r.payload FROM core.ingest_raw r
           WHERE r.kind = 'game' AND r.source = 'scores365'
             AND (r.payload #>> '{game,homeCompetitor,id}' IN (SELECT team_ext FROM game.name_fetch_requests WHERE league_code = p_league)
               OR r.payload #>> '{game,awayCompetitor,id}' IN (SELECT team_ext FROM game.name_fetch_requests WHERE league_code = p_league))
           ORDER BY r.external_id, r.fetched_at DESC) g
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(g.payload #> '{game,members}', '[]'::jsonb)) m
   WHERE m ? 'athleteId'
   ORDER BY m->>'id';

  -- ref_fix: הקליטה מצביעה על שחקן אחר מזה שזוהה לאותו אתלט
  INSERT INTO _it (run_id, seq, kind, player_id, athlete_id, detail)
  SELECT v_run, nextval('_seq'), 'ref_fix', l.player_id, m.aid,
         jsonb_build_object('member', x.external_id, 'wrongPlayer', x.entity_id,
                            'wrongName', (SELECT COALESCE(NULLIF(name_en,'TBD'), name_he) FROM core.players WHERE id = x.entity_id),
                            'rightName', (SELECT en FROM _prov WHERE aid = m.aid))
    FROM core.external_refs x
    JOIN _mem m ON m.mid = x.external_id
    JOIN _link l ON l.aid = m.aid
   WHERE x.provider = 'scores365' AND x.entity_type = 'player' AND x.entity_id <> l.player_id;

  -- ref_drop: הקליטה מצביעה על שחקן שלנו שזוהה לאתלט אחר, ולאתלט של ה-member אין שחקן
  INSERT INTO _it (run_id, seq, kind, player_id, athlete_id, detail)
  SELECT v_run, nextval('_seq'), 'ref_drop', x.entity_id, m.aid,
         jsonb_build_object('member', x.external_id, 'memberName', m.nm,
                            'wrongName', (SELECT COALESCE(NULLIF(name_en,'TBD'), name_he) FROM core.players WHERE id = x.entity_id))
    FROM core.external_refs x
    JOIN _mem m ON m.mid = x.external_id
    JOIN _link mine ON mine.player_id = x.entity_id AND mine.aid <> m.aid
   WHERE x.provider = 'scores365' AND x.entity_type = 'player'
     AND m.aid NOT IN (SELECT aid FROM _link)
     AND NOT EXISTS (SELECT 1 FROM _it t WHERE t.kind = 'new' AND t.athlete_id = m.aid);

  -- ref ל-new: יקושר באפליקציה אחרי יצירת השחקן (מסומן כאן)
  INSERT INTO _it (run_id, seq, kind, player_id, athlete_id, detail)
  SELECT v_run, nextval('_seq'), 'ref_fix', NULL, m.aid,
         jsonb_build_object('member', x.external_id, 'wrongPlayer', x.entity_id, 'toNew', TRUE,
                            'wrongName', (SELECT COALESCE(NULLIF(name_en,'TBD'), name_he) FROM core.players WHERE id = x.entity_id),
                            'rightName', (SELECT en FROM _prov WHERE aid = m.aid))
    FROM core.external_refs x
    JOIN _mem m ON m.mid = x.external_id
   WHERE x.provider = 'scores365' AND x.entity_type = 'player'
     AND EXISTS (SELECT 1 FROM _it t WHERE t.kind = 'new' AND t.athlete_id = m.aid);

  INSERT INTO game.squad_sync_items SELECT * FROM _it;

  SELECT jsonb_build_object(
    'ok', TRUE, 'runId', v_run, 'league', p_league,
    'ours', (SELECT count(DISTINCT player_id) FROM _ours), 'provider', v_prov,
    'matched', (SELECT count(*) FROM _link),
    'byHow', (SELECT jsonb_object_agg(how, n) FROM (SELECT how, count(*) n FROM _link GROUP BY 1) z),
    'items', (SELECT jsonb_object_agg(kind, n) FROM (SELECT kind, count(*) n FROM _it GROUP BY 1) z))
  INTO v_sum;
  UPDATE game.squad_sync_runs SET summary = v_sum WHERE id = v_run;
  RETURN v_sum;
END;
$$;
REVOKE ALL ON FUNCTION game.squad_sync_plan(TEXT, INT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- ביצוע
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION game.squad_sync_apply(p_run BIGINT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  v_r game.squad_sync_runs; v_season UUID; it RECORD; v_pid UUID; v_ext TEXT; v_old core.squads;
  v_actor TEXT := COALESCE(auth.uid()::TEXT, 'system:squad_sync');
  v_moved INT := 0; v_n INT; v_gws JSONB; v_matches UUID[];
BEGIN
  SELECT * INTO v_r FROM game.squad_sync_runs WHERE id = p_run FOR UPDATE;
  IF v_r.id IS NULL THEN RAISE EXCEPTION 'RUN_NOT_FOUND'; END IF;
  IF v_r.applied_at IS NOT NULL THEN RAISE EXCEPTION 'RUN_ALREADY_APPLIED'; END IF;
  IF v_r.created_at < now() - INTERVAL '6 hours' THEN RAISE EXCEPTION 'RUN_STALE — plan again'; END IF;
  SELECT se.id INTO v_season FROM core.seasons se JOIN core.leagues l ON l.id = se.league_id
   WHERE l.code = v_r.league_code AND se.is_current;

  -- 1. new — שחקן + שורת סגל + מזהה תצוגה (40M + athleteId) + קישור אתלט
  FOR it IN SELECT * FROM game.squad_sync_items WHERE run_id = p_run AND kind = 'new' ORDER BY seq LOOP
    v_ext := (40000000 + it.athlete_id::BIGINT)::TEXT;
    SELECT entity_id INTO v_pid FROM core.external_refs WHERE provider = 'manual_json' AND entity_type = 'player' AND external_id = v_ext;
    IF v_pid IS NULL THEN
      INSERT INTO core.players (names, primary_position)
      VALUES (jsonb_build_object('he', jsonb_build_object('full', it.detail->>'he'), 'en', jsonb_build_object('full', it.detail->>'en')),
              (it.detail->>'position')::core.position)
      RETURNING id INTO v_pid;
      INSERT INTO core.external_refs (provider, entity_type, external_id, entity_id, payload)
      VALUES ('manual_json', 'player', v_ext, v_pid, jsonb_build_object('source', 'squad_sync', 'athleteId', it.athlete_id));
    END IF;
    PERFORM core.provider_link('scores365_athlete', 'player', it.athlete_id, v_pid, jsonb_build_object('run', p_run));
    INSERT INTO core.squads (season_id, team_id, player_id, shirt_number, position, fantasy_price, tier, rated, valid_from, status, value_source, value_at)
    SELECT v_season, it.team_to, v_pid, (it.detail->>'shirt')::SMALLINT, (it.detail->>'position')::core.position,
           COALESCE(
             (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY s.fantasy_price))::NUMERIC FROM core.squads s
               WHERE s.season_id = v_season AND s.team_id = it.team_to AND s.position = (it.detail->>'position')::core.position
                 AND s.valid_to IS NULL AND s.fantasy_price IS NOT NULL),
             (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY s.fantasy_price))::NUMERIC FROM core.squads s
               WHERE s.season_id = v_season AND s.position = (it.detail->>'position')::core.position
                 AND s.valid_to IS NULL AND s.fantasy_price IS NOT NULL),
             1.0),
           COALESCE(
             (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY s.tier))::SMALLINT FROM core.squads s
               WHERE s.season_id = v_season AND s.team_id = it.team_to AND s.position = (it.detail->>'position')::core.position
                 AND s.valid_to IS NULL AND s.tier IS NOT NULL),
             5),
           FALSE, current_date, 'active', 'squad_sync', now()
     WHERE NOT EXISTS (SELECT 1 FROM core.squads s WHERE s.season_id = v_season AND s.team_id = it.team_to
                        AND s.player_id = v_pid AND s.valid_to IS NULL);
    UPDATE game.squad_sync_items SET applied = TRUE, player_id = v_pid WHERE run_id = p_run AND seq = it.seq;
    INSERT INTO game.audit_logs (actor, entity, entity_id, action, new_value, reason)
    VALUES (v_actor, 'player', v_pid::TEXT, 'squad_sync_new', it.detail || jsonb_build_object('team', it.team_to), 'db/69 run ' || p_run);
  END LOOP;

  -- 2. link
  FOR it IN SELECT * FROM game.squad_sync_items WHERE run_id = p_run AND kind = 'link' ORDER BY seq LOOP
    PERFORM core.provider_link('scores365_athlete', 'player', it.athlete_id, it.player_id, jsonb_build_object('run', p_run, 'how', it.detail->>'how'));
    UPDATE game.squad_sync_items SET applied = TRUE WHERE run_id = p_run AND seq = it.seq;
  END LOOP;

  -- 3. transfer — סגירה + פתיחה בקבוצה החדשה, אותם מחיר/דרג/עמדה
  FOR it IN SELECT * FROM game.squad_sync_items WHERE run_id = p_run AND kind = 'transfer' ORDER BY seq LOOP
    SELECT * INTO v_old FROM core.squads s WHERE s.season_id = v_season AND s.player_id = it.player_id AND s.valid_to IS NULL
     ORDER BY s.id LIMIT 1;
    UPDATE core.squads SET valid_to = current_date, status = 'left', status_note = 'squad_sync transfer run ' || p_run
     WHERE season_id = v_season AND player_id = it.player_id AND valid_to IS NULL;
    INSERT INTO core.squads (season_id, team_id, player_id, shirt_number, position, market_value, fantasy_price, tier, overall_rank,
                             rated, valid_from, status, value_source, value_at, price_locked)
    VALUES (v_season, it.team_to, it.player_id, (it.detail->>'shirt')::SMALLINT, v_old.position, v_old.market_value, v_old.fantasy_price, v_old.tier,
            v_old.overall_rank, v_old.rated, current_date + 0, 'active', COALESCE(v_old.value_source, 'squad_sync'), now(), v_old.price_locked)
    ON CONFLICT (season_id, team_id, player_id, valid_from) DO UPDATE SET valid_to = NULL, status = 'active';
    UPDATE game.squad_sync_items SET applied = TRUE WHERE run_id = p_run AND seq = it.seq;
    INSERT INTO game.audit_logs (actor, entity, entity_id, action, old_value, new_value, reason)
    VALUES (v_actor, 'player', it.player_id::TEXT, 'squad_sync_transfer', jsonb_build_object('team', it.team_from),
            jsonb_build_object('team', it.team_to), 'db/69 run ' || p_run);
  END LOOP;

  -- 4. duplicate / left — סגירת שורה (השחקן נשאר; הרכבים שהוגשו לא משתנים)
  FOR it IN SELECT * FROM game.squad_sync_items WHERE run_id = p_run AND kind IN ('duplicate','left') ORDER BY seq LOOP
    UPDATE core.squads SET valid_to = current_date, status = 'left', status_note = 'squad_sync ' || it.kind || ' run ' || p_run
     WHERE id = (it.detail->>'squadId')::UUID AND valid_to IS NULL;
    UPDATE game.squad_sync_items SET applied = TRUE WHERE run_id = p_run AND seq = it.seq;
    INSERT INTO game.audit_logs (actor, entity, entity_id, action, old_value, reason)
    VALUES (v_actor, 'player', it.player_id::TEXT, 'squad_sync_' || it.kind, it.detail, 'db/69 run ' || p_run);
  END LOOP;

  -- 5. shirt
  FOR it IN SELECT * FROM game.squad_sync_items WHERE run_id = p_run AND kind = 'shirt' ORDER BY seq LOOP
    UPDATE core.squads SET shirt_number = (it.detail->>'to')::SMALLINT
     WHERE season_id = v_season AND player_id = it.player_id AND team_id = it.team_to AND valid_to IS NULL;
    UPDATE game.squad_sync_items SET applied = TRUE WHERE run_id = p_run AND seq = it.seq;
  END LOOP;

  -- 6. name_en
  FOR it IN SELECT * FROM game.squad_sync_items WHERE run_id = p_run AND kind = 'name_en' ORDER BY seq LOOP
    UPDATE core.players p
       SET names = jsonb_set(COALESCE(p.names, '{}'::jsonb), '{en}', COALESCE(p.names->'en', '{}'::jsonb) || jsonb_build_object('full', it.detail->>'to')),
           updated_at = now()
     WHERE p.id = it.player_id AND NOT core.usable_en(p.name_en);
    UPDATE game.squad_sync_items SET applied = TRUE WHERE run_id = p_run AND seq = it.seq;
    INSERT INTO game.audit_logs (actor, entity, entity_id, action, new_value, reason)
    VALUES (v_actor, 'player', it.player_id::TEXT, 'name_en_fill', it.detail, 'db/69 run ' || p_run);
  END LOOP;

  -- 7. ref_fix — מיפוי הקליטה + סטטיסטיקה שנרשמה לשחקן הלא נכון
  DROP TABLE IF EXISTS _gw;
  CREATE TEMP TABLE _gw (gameweek_id UUID PRIMARY KEY) ON COMMIT DROP;
  FOR it IN SELECT * FROM game.squad_sync_items WHERE run_id = p_run AND kind = 'ref_fix' ORDER BY seq LOOP
    v_pid := COALESCE(it.player_id,
                      (SELECT entity_id FROM core.external_refs WHERE provider = 'scores365_athlete' AND entity_type = 'player' AND external_id = it.athlete_id));
    IF v_pid IS NULL THEN CONTINUE; END IF;
    UPDATE core.external_refs
       SET entity_id = v_pid, synced_at = now(),
           payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('matchedBy', 'squad_sync', 'run', p_run, 'previous', it.detail->>'wrongPlayer')
     WHERE provider = 'scores365' AND entity_type = 'player' AND external_id = it.detail->>'member';

    -- המשחקים שבהם ה-member שיחק (לפי הגולמי) → שורות הסטטיסטיקה של השחקן הלא נכון עוברות
    SELECT array_agg(DISTINCT xm.entity_id) INTO v_matches
      FROM core.ingest_raw r
      JOIN core.external_refs xm ON xm.provider = 'scores365' AND xm.entity_type = 'match' AND xm.external_id = r.external_id
     WHERE r.kind = 'game' AND r.source = 'scores365'
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(r.payload #> '{game,members}', '[]'::jsonb)) m WHERE m->>'id' = it.detail->>'member');
    IF v_matches IS NOT NULL THEN
      INSERT INTO _gw SELECT DISTINCT wm.gameweek_id FROM core.weekly_matches wm
       WHERE wm.id = ANY (v_matches) AND EXISTS (SELECT 1 FROM core.player_match_stats s WHERE s.match_id = wm.id AND s.player_id = (it.detail->>'wrongPlayer')::UUID)
      ON CONFLICT DO NOTHING;
      UPDATE core.player_match_stats s SET player_id = v_pid, updated_at = now()
       WHERE s.match_id = ANY (v_matches) AND s.player_id = (it.detail->>'wrongPlayer')::UUID
         AND NOT EXISTS (SELECT 1 FROM core.player_match_stats s2 WHERE s2.match_id = s.match_id AND s2.player_id = v_pid);
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_moved := v_moved + v_n;
    END IF;
    UPDATE game.squad_sync_items SET applied = TRUE, player_id = v_pid, detail = detail || jsonb_build_object('statsMoved', COALESCE(v_n, 0))
     WHERE run_id = p_run AND seq = it.seq;
    INSERT INTO game.audit_logs (actor, entity, entity_id, action, old_value, new_value, reason)
    VALUES (v_actor, 'player_ref', it.detail->>'member', 'squad_sync_ref_fix',
            jsonb_build_object('player', it.detail->>'wrongPlayer', 'name', it.detail->>'wrongName'),
            jsonb_build_object('player', v_pid, 'name', it.detail->>'rightName', 'statsMoved', COALESCE(v_n, 0)), 'db/69 run ' || p_run);
    v_n := 0;
  END LOOP;

  -- 8. ref_drop — מיפוי שגוי בלי שחקן נכון: מוסר (נשמר ביומן), הקליטה תמפה מחדש לפי שם
  FOR it IN SELECT * FROM game.squad_sync_items WHERE run_id = p_run AND kind = 'ref_drop' ORDER BY seq LOOP
    INSERT INTO game.audit_logs (actor, entity, entity_id, action, old_value, reason)
    SELECT v_actor, 'player_ref', x.external_id, 'squad_sync_ref_drop', to_jsonb(x), 'db/69 run ' || p_run
      FROM core.external_refs x WHERE x.provider = 'scores365' AND x.entity_type = 'player' AND x.external_id = it.detail->>'member';
    DELETE FROM core.external_refs WHERE provider = 'scores365' AND entity_type = 'player' AND external_id = it.detail->>'member';
    UPDATE game.squad_sync_items SET applied = TRUE WHERE run_id = p_run AND seq = it.seq;
  END LOOP;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('code', g.code, 'status', g.status) ORDER BY g.lock_at), '[]'::jsonb) INTO v_gws
    FROM _gw JOIN game.gameweeks g ON g.id = _gw.gameweek_id;

  UPDATE game.squad_sync_runs
     SET applied_at = now(),
         summary = summary || jsonb_build_object('applied', (SELECT jsonb_object_agg(kind, n) FROM (
                     SELECT kind, count(*) n FROM game.squad_sync_items WHERE run_id = p_run AND applied GROUP BY 1) z),
                   'statsMoved', v_moved, 'rescore', v_gws)
   WHERE id = p_run;
  PERFORM game.bump_revision_manual('squads');
  RETURN (SELECT summary FROM game.squad_sync_runs WHERE id = p_run);
END;
$$;
REVOKE ALL ON FUNCTION game.squad_sync_apply(BIGINT) FROM PUBLIC, anon, authenticated;

/** בלי טריגר על הטבלאות שנגענו בהן ישירות — מודיעים ללקוחות לרענן סגלים. */
CREATE OR REPLACE FUNCTION game.bump_revision_manual(p_scope TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = game, public AS $$
  UPDATE game.data_revision SET revision = revision + 1, scope = p_scope, updated_at = clock_timestamp() WHERE id = 1;
$$;
REVOKE ALL ON FUNCTION game.bump_revision_manual(TEXT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- אדמין
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION game.admin_squad_sync_plan(p_league TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = game, core, public AS $$
BEGIN IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF; RETURN game.squad_sync_plan(p_league); END; $$;
CREATE OR REPLACE FUNCTION game.admin_squad_sync_apply(p_run BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = game, core, public AS $$
BEGIN IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF; RETURN game.squad_sync_apply(p_run); END; $$;
CREATE OR REPLACE FUNCTION game.admin_squad_sync_report(p_league TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = game, core, public AS $$
DECLARE v_run game.squad_sync_runs;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  SELECT * INTO v_run FROM game.squad_sync_runs WHERE league_code = p_league ORDER BY id DESC LIMIT 1;
  IF v_run.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('runId', v_run.id, 'createdAt', v_run.created_at, 'appliedAt', v_run.applied_at, 'summary', v_run.summary,
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', i.kind, 'applied', i.applied,
              'name', COALESCE((SELECT COALESCE(NULLIF(p.name_en, 'TBD'), p.name_he) FROM core.players p WHERE p.id = i.player_id), i.detail->>'en', i.detail->>'name'),
              'from', (SELECT COALESCE(t.name_en, t.name_he) FROM core.teams t WHERE t.id = i.team_from),
              'to', (SELECT COALESCE(t.name_en, t.name_he) FROM core.teams t WHERE t.id = i.team_to),
              'detail', i.detail) ORDER BY i.kind, i.seq)
            FROM game.squad_sync_items i WHERE i.run_id = v_run.id AND i.kind <> 'link'), '[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION game.admin_squad_sync_plan(TEXT), game.admin_squad_sync_apply(BIGINT), game.admin_squad_sync_report(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION game.admin_squad_sync_plan(TEXT), game.admin_squad_sync_apply(BIGINT), game.admin_squad_sync_report(TEXT) TO authenticated;

INSERT INTO game.schema_migrations (version, note) VALUES
  ('69', 'יישור סגלים מול סגלי הספק: תכנון→ביצוע, קישור אתלט, מעברים, עזיבות, חדשים, תיקון מיפויי קליטה וסטטיסטיקה')
ON CONFLICT (version) DO NOTHING;

COMMIT;
