-- =====================================================================
--  db/67_player_names_en.sql — שמות שחקנים באנגלית ממקור מאומת (H02)
-- =====================================================================
--  ★ הבעיה: ב-IL כל 402 השחקנים בסגל הפעיל נשאו name_en = 'TBD' (ייבוא ידני
--    בעברית). במסך אנגלי הם הופיעו בעברית, ובחיפוש באנגלית לא נמצאו.
--  ★ המקור: סגלי 365scores (אותו ספק של הקליטה), באותו מזהה שחקן, פעמיים —
--    langId=2 (עברית) ו-langId=1 (אנגלית). זוג (עברית, אנגלית) של אותו
--    אתלט הוא עובדה של הספק, לא תעתיק.
--  ★ ההתאמה לשחקן שלנו: רק בתוך אותה קבוצה, רק לפי השם העברי המנורמל, ורק
--    כשיש בדיוק התאמה אחת בכל צד. אין ניחוש, אין fuzzy. מה שלא הותאם נשאר
--    עם הנפילה הקיימת (en → he) ומופיע בדוח החוסרים באדמין.
--  ★ לא נוגע ב-id, external refs, מועדון, מחיר, עמדה או תוצאות.
--    כותב רק names.en.full (name_en נגזר ממנו), ורק כשחסר (ריק / TBD / עברית).
--  זרימה (אסינכרונית, pg_net):
--    game.names_fetch(league)  → שולח בקשות, נשמרות ב-game.name_fetch_requests
--    game.names_apply(league)  → (אחרי כמה שניות) קורא תשובות, ממלא, מחזיר סיכום
--    game.name_gaps(league)    → מי עדיין בלי שם אנגלי
--  לאדמין: admin_names_fetch / admin_names_apply / admin_name_gaps (is_admin).
-- =====================================================================
BEGIN;
SET search_path = game, core, public;

CREATE TABLE IF NOT EXISTS core.player_name_sources (
  provider    TEXT NOT NULL,
  athlete_id  TEXT NOT NULL,
  team_id     UUID NOT NULL REFERENCES core.teams(id) ON DELETE CASCADE,
  name_he     TEXT,
  name_en     TEXT,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, athlete_id, team_id)
);
ALTER TABLE core.player_name_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON core.player_name_sources FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS game.name_fetch_requests (
  request_id  BIGINT PRIMARY KEY,
  league_code TEXT NOT NULL,
  team_id     UUID NOT NULL,
  team_ext    TEXT NOT NULL,
  lang        SMALLINT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE game.name_fetch_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON game.name_fetch_requests FROM anon, authenticated;

/** "איאד אבו-עביד" ≡ "איאד אבו עביד": בלי רווחים, מקפים, גרשים. */
CREATE OR REPLACE FUNCTION core.norm_name(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(lower(regexp_replace(COALESCE(p, ''), '[^[:alnum:]]+', '', 'g')), '')
$$;

/** שם אנגלי שימושי: לא ריק, לא TBD, בלי אותיות עבריות. */
CREATE OR REPLACE FUNCTION core.usable_en(p TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(btrim(p), '') <> '' AND upper(btrim(p)) <> 'TBD' AND p !~ '[א-ת]'
$$;

-- הקבוצות והשחקנים של הליגה בעונה הנוכחית
CREATE OR REPLACE FUNCTION game.league_active_players(p_league TEXT)
RETURNS TABLE (player_id UUID, team_id UUID, name_he TEXT, name_en TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
  SELECT DISTINCT pl.id, sq.team_id, pl.name_he, pl.name_en
    FROM core.squads sq
    JOIN core.seasons se ON se.id = sq.season_id AND se.is_current
    JOIN core.leagues l  ON l.id = se.league_id AND l.code = p_league
    JOIN core.players pl ON pl.id = sq.player_id
   WHERE sq.valid_to IS NULL
$$;
REVOKE ALL ON FUNCTION game.league_active_players(TEXT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- שליחה
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION game.names_fetch(p_league TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE r RECORD; n INT := 0; v_id BIGINT; l SMALLINT;
BEGIN
  IF to_regprocedure('net.http_get(text,jsonb,jsonb,integer)') IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'pg_net missing');
  END IF;
  DELETE FROM game.name_fetch_requests WHERE league_code = p_league;
  FOR r IN
    SELECT DISTINCT a.team_id, x.external_id
      FROM game.league_active_players(p_league) a
      JOIN core.external_refs x ON x.entity_type = 'team' AND x.entity_id = a.team_id AND x.provider = 'scores365'
  LOOP
    FOREACH l IN ARRAY ARRAY[1, 2]::SMALLINT[] LOOP
      v_id := net.http_get(
        url := format('https://webws.365scores.com/web/squads/?appTypeId=5&langId=%s&competitors=%s', l, r.external_id),
        timeout_milliseconds := 15000);
      INSERT INTO game.name_fetch_requests (request_id, league_code, team_id, team_ext, lang)
      VALUES (v_id, p_league, r.team_id, r.external_id, l);
      n := n + 1;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('ok', TRUE, 'requests', n);
END;
$$;
REVOKE ALL ON FUNCTION game.names_fetch(TEXT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- החלה
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION game.names_apply(p_league TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v_pending INT; v_pairs INT; v_filled INT := 0; v_gaps INT;
BEGIN
  IF to_regclass('net._http_response') IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'pg_net missing');
  END IF;

  SELECT count(*) INTO v_pending
    FROM game.name_fetch_requests q
    LEFT JOIN net._http_response h ON h.id = q.request_id
   WHERE q.league_code = p_league AND (h.id IS NULL OR h.status_code IS DISTINCT FROM 200);

  -- זוגות (עברית, אנגלית) לאותו אתלט, מתוך שתי התשובות של אותה קבוצה
  WITH resp AS (
    SELECT q.team_id, q.lang, a
      FROM game.name_fetch_requests q
      JOIN net._http_response h ON h.id = q.request_id AND h.status_code = 200
      CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE((h.content::jsonb) #> '{squads,0,athletes}', '[]'::jsonb)) a
     WHERE q.league_code = p_league
  ), pairs AS (
    SELECT he.team_id, he.a->>'id' AS athlete_id, he.a->>'name' AS name_he, en.a->>'name' AS name_en
      FROM resp he
      JOIN resp en ON en.team_id = he.team_id AND en.lang = 1 AND en.a->>'id' = he.a->>'id'
     WHERE he.lang = 2
  )
  INSERT INTO core.player_name_sources (provider, athlete_id, team_id, name_he, name_en, fetched_at)
  SELECT 'scores365', athlete_id, team_id, name_he, name_en, now() FROM pairs
  ON CONFLICT (provider, athlete_id, team_id) DO UPDATE
    SET name_he = EXCLUDED.name_he, name_en = EXCLUDED.name_en, fetched_at = now();
  GET DIAGNOSTICS v_pairs = ROW_COUNT;

  -- התאמה חד-חד-ערכית בתוך הקבוצה לפי עברית מנורמלת
  WITH ours AS (
    SELECT a.player_id, a.team_id, core.norm_name(a.name_he) AS k
      FROM game.league_active_players(p_league) a
     WHERE NOT core.usable_en(a.name_en)
  ), src AS (
    SELECT team_id, core.norm_name(name_he) AS k, min(name_en) AS name_en, count(*) AS c
      FROM core.player_name_sources
     WHERE provider = 'scores365' AND core.usable_en(name_en)
       AND team_id IN (SELECT team_id FROM ours)
     GROUP BY 1, 2
  ), ourc AS (
    SELECT team_id, k, count(*) AS c FROM ours GROUP BY 1, 2
  ), hit AS (
    SELECT o.player_id, s.name_en
      FROM ours o
      JOIN src s  ON s.team_id = o.team_id AND s.k = o.k AND s.c = 1
      JOIN ourc c ON c.team_id = o.team_id AND c.k = o.k AND c.c = 1
     WHERE o.k IS NOT NULL
  ), upd AS (
    UPDATE core.players p
       SET names   = jsonb_set(COALESCE(p.names, '{}'::jsonb), '{en}',
                       COALESCE(p.names->'en', '{}'::jsonb) || jsonb_build_object('full', h.name_en)),
           updated_at = now()
      FROM hit h
     WHERE p.id = h.player_id
    RETURNING p.id, h.name_en
  ), aud AS (
    INSERT INTO game.audit_logs (actor, entity, entity_id, action, old_value, new_value, reason)
    SELECT COALESCE(auth.uid()::TEXT, 'system:names'), 'player', u.id::TEXT, 'name_en_fill', NULL, jsonb_build_object('name_en', u.name_en),
           'db/67: 365scores squads he/en pair, same team, unique normalized Hebrew match'
      FROM upd u
    RETURNING 1
  )
  SELECT count(*) INTO v_filled FROM upd;

  SELECT count(*) INTO v_gaps FROM game.league_active_players(p_league) a WHERE NOT core.usable_en(a.name_en);
  RETURN jsonb_build_object('ok', TRUE, 'pending', v_pending, 'pairs', v_pairs, 'filled', v_filled, 'gaps', v_gaps);
END;
$$;
REVOKE ALL ON FUNCTION game.names_apply(TEXT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- דוח חוסרים
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION game.name_gaps(p_league TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
  SELECT jsonb_build_object(
    'league', p_league,
    'total', (SELECT count(*) FROM game.league_active_players(p_league)),
    'missing', (SELECT count(*) FROM game.league_active_players(p_league) a WHERE NOT core.usable_en(a.name_en)),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'playerId', a.player_id, 'nameHe', a.name_he,
               'team', COALESCE(t.name_en, t.name_he)) ORDER BY t.name_en, a.name_he)
        FROM (SELECT * FROM game.league_active_players(p_league) a WHERE NOT core.usable_en(a.name_en) LIMIT 200) a
        JOIN core.teams t ON t.id = a.team_id), '[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION game.name_gaps(TEXT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- עטיפות אדמין
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION game.admin_names_fetch(p_league TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = game, core, public AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  RETURN game.names_fetch(p_league);
END; $$;
CREATE OR REPLACE FUNCTION game.admin_names_apply(p_league TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = game, core, public AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  RETURN game.names_apply(p_league);
END; $$;
CREATE OR REPLACE FUNCTION game.admin_name_gaps(p_league TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = game, core, public AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  RETURN game.name_gaps(p_league);
END; $$;
REVOKE ALL ON FUNCTION game.admin_names_fetch(TEXT), game.admin_names_apply(TEXT), game.admin_name_gaps(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION game.admin_names_fetch(TEXT), game.admin_names_apply(TEXT), game.admin_name_gaps(TEXT) TO authenticated;

INSERT INTO game.schema_migrations (version, note) VALUES
  ('67', 'שמות שחקנים באנגלית מזוגות עברית/אנגלית של 365scores (התאמה ייחודית בתוך הקבוצה) + דוח חוסרים')
ON CONFLICT (version) DO NOTHING;

COMMIT;
