-- =====================================================================
--  db/68_previous_lineup.sql — "Use last round's lineup" (H04), קריאה בלבד
-- =====================================================================
--  ההרכב האחרון שהזהות הנוכחית הגישה רשמית, לפני מחזור היעד:
--    · אותה ליגה ואותה עונה (מעבר עונה לא מעתיק סגל ישן)
--    · אותו מצב (five/full)
--    · מחזור שננעל לפני היעד — לפי lock_at, לא number-1
--    · status IN ('submitted','locked','scored') — לא טיוטה, לא הגשה שנמשכה
--  ★ רק auth.uid(); אין פרמטר userId. ההרכב המקורי לא משתנה — אין כאן כתיבה.
--    ההעתקה עצמה היא טיוטה בצד הלקוח (save_draft הקיים), לא submit.
-- =====================================================================
BEGIN;
SET search_path = game, core, public;

CREATE OR REPLACE FUNCTION game.my_previous_lineup(p_gw_code TEXT, p_mode TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  v_auth UUID := auth.uid();
  v_gw   game.gameweeks;
  v_src  RECORD;
BEGIN
  IF v_auth IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_mode NOT IN ('five', 'full') THEN RAISE EXCEPTION 'BAD_MODE'; END IF;
  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw.id IS NULL THEN RETURN NULL; END IF;

  SELECT ul.id, ul.formation, g.code, g.number
    INTO v_src
    FROM game.user_lineups ul
    JOIN game.gameweeks g ON g.id = ul.gameweek_id
   WHERE ul.user_id = v_auth
     AND ul.mode = p_mode
     AND ul.status IN ('submitted','locked','scored')
     AND g.season_id = v_gw.season_id
     AND g.id <> v_gw.id
     AND g.lock_at < v_gw.lock_at
   ORDER BY g.lock_at DESC, g.number DESC
   LIMIT 1;
  IF v_src.id IS NULL THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'sourceCode',   v_src.code,
    'sourceNumber', v_src.number,
    'mode',         p_mode,
    'formation',    v_src.formation,
    'slots', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'slotNo',    s.slot_no,
               'playerId',  'P' || xp.external_id,
               'teamId',    'T' || xt.external_id,
               'position',  s.position,
               'isCaptain', s.is_captain,
               'isVice',    s.is_vice) ORDER BY s.slot_no)
        FROM game.user_lineup_slots s
        JOIN core.v_ext xp ON xp.entity_type = 'player' AND xp.entity_id = s.player_id
        JOIN core.v_ext xt ON xt.entity_type = 'team'   AND xt.entity_id = s.team_id
       WHERE s.lineup_id = v_src.id AND NOT COALESCE(s.is_bench, FALSE)), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION game.my_previous_lineup(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION game.my_previous_lineup(TEXT, TEXT) TO authenticated;

INSERT INTO game.schema_migrations (version, note) VALUES
  ('68', 'ההרכב האחרון שלי לאותה ליגה/עונה/מצב — לקריאה בלבד, להעתקה לטיוטה')
ON CONFLICT (version) DO NOTHING;

COMMIT;
