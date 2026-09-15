-- =====================================================================
--  db/30_value_and_depth.sql · שווי, עומק, וטבלאות לכולם
--
--  חמישה דברים, וכולם נשענים על דאטה שכבר נכנס למסד בכל סריקה
--  ולא נוצל:
--
--    1. תמחור לפי שווי שוק אמיתי, בפריסה דטרמיניסטית 1–5
--    2. זמינות (פצוע/מורחק) אוטומטית
--    3. מונים מדודים למנוע הניקוד — בעיטות, חטיפות, יירוטים…
--    4. טבלת ליגה ולוח חי **לכל אחד**, גם למי שלא הגיש
--    5. סיכום מחזור אישי: הבחירה הטובה, הגרועה, הקפטן, ואת מי ניצחת
--
--  ★ ובנוסף: `isBot` מפסיק לחזור לדפדפן. ראו §6.
-- =====================================================================

BEGIN;

-- =====================================================================
--  §1 · שווי שוק על שורת הסגל
-- =====================================================================
ALTER TABLE core.squads
  ADD COLUMN IF NOT EXISTS market_value  NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS value_source  TEXT,
  ADD COLUMN IF NOT EXISTS value_at      TIMESTAMPTZ,
  /* ★ מחיר שאדם קבע ידנית ננעל, ותמחור אוטומטי לא נוגע בו.
     בלי הדגל הזה כל סריקה הייתה מוחקת כל כוונון ידני — וזה
     בדיוק סוג הבאג שמתגלה שבועיים אחרי, כשמישהו שואל למה
     השחקן חזר לעלות 3. */
  ADD COLUMN IF NOT EXISTS price_locked  BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN core.squads.market_value IS
  'שווי שוק ביורו כפי שדווח על ידי ספק הדאטה. לא מחיר המשחק.';
COMMENT ON COLUMN core.squads.price_locked IS
  'TRUE = המחיר נקבע ידנית. `admin_reprice_from_market` מדלגת עליו.';

/* תמחור ידני נועל. */
CREATE OR REPLACE FUNCTION game.admin_set_price(p_ext_player TEXT, p_price NUMERIC)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_player UUID;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF p_price IS NULL OR p_price < 0 OR p_price > 99 THEN RAISE EXCEPTION 'PRICE_RANGE'; END IF;

  v_player := core.player_by_ext(p_ext_player);
  IF v_player IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND: %', p_ext_player; END IF;

  UPDATE core.squads
     SET fantasy_price = p_price, price_locked = TRUE
   WHERE player_id = v_player AND valid_to IS NULL;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (game.actor_label(), 'admin_set_price', 'player', p_ext_player,
          jsonb_build_object('price', p_price, 'locked', TRUE));
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_set_price(TEXT,NUMERIC) TO authenticated;

/* שחרור נעילה — כדי שהתמחור האוטומטי יחזור לטפל בו. */
CREATE OR REPLACE FUNCTION game.admin_unlock_price(p_ext_player TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_player UUID;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  v_player := core.player_by_ext(p_ext_player);
  IF v_player IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND'; END IF;

  UPDATE core.squads SET price_locked = FALSE
   WHERE player_id = v_player AND valid_to IS NULL;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (game.actor_label(), 'admin_unlock_price', 'player', p_ext_player, '{}'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_unlock_price(TEXT) TO authenticated;

-- =====================================================================
--  §2 · תמחור 1–5 משווי שוק
-- =====================================================================
--
--  ★ הבעיה עם מיפוי ליניארי של יורו למחיר
--
--  שווי השוק בליגת העל נע בין ~50 אלף ל~3 מיליון יורו, והפיזור
--  מעוות בחדות: מעט מאוד שחקנים למעלה, המון בתחתית. מיפוי
--  ליניארי היה נותן מחיר 1 ל-90% מהליגה ומחיר 5 לשלושה שחקנים —
--  כלומר תקציב שאינו מגביל כלום, ובחירה שאין בה החלטה.
--
--  ★ לכן: **דירוג יחסי ולא ערך מוחלט.** כל שחקן מקבל את מקומו
--    באחוזונים מול כל שאר הליגה, והמדרגות נקבעות באחוזונים:
--
--        90%+  →  5      העילית, ~40 שחקנים
--        70%+  →  4
--        40%+  →  3
--        15%+  →  2
--        אחרת  →  1      ~60 שחקנים
--
--    התוצאה יציבה גם כשכל הליגה מתייקרת, וגם כשספק מחליף
--    סקאלה. בדוביד 5 (תקציב 15 לחמישה) זה אומר: אפשר שני
--    שחקני עילית, ואז צריך למצוא מציאות. זו בדיוק ההחלטה
--    שהמשחק רוצה לייצר.
--
--  ★ דטרמיניסטי לחלוטין. אותה קלט = אותו פלט, תמיד. שוברי
--    שוויון בדירוג: שווי, ואז מזהה — אף פעם לא סדר מקרי.

CREATE OR REPLACE FUNCTION game.admin_reprice_from_market(p_dry_run BOOLEAN DEFAULT FALSE)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE
  v_season  UUID;
  v_report  JSONB;
  v_changed INT := 0;
BEGIN
  IF NOT game.can_write_data() THEN RAISE EXCEPTION 'SYSTEM_OR_ADMIN_REQUIRED'; END IF;

  SELECT id INTO v_season FROM core.seasons
   ORDER BY is_current DESC, starts_on DESC NULLS LAST LIMIT 1;
  IF v_season IS NULL THEN RAISE EXCEPTION 'NO_SEASON'; END IF;

  CREATE TEMP TABLE IF NOT EXISTS _reprice (
    squad_id UUID PRIMARY KEY, new_price SMALLINT, old_price NUMERIC
  ) ON COMMIT DROP;
  DELETE FROM _reprice;

  INSERT INTO _reprice (squad_id, new_price, old_price)
  SELECT s.id,
         CASE
           WHEN r.pr >= 0.90 THEN 5
           WHEN r.pr >= 0.70 THEN 4
           WHEN r.pr >= 0.40 THEN 3
           WHEN r.pr >= 0.15 THEN 2
           ELSE 1
         END,
         s.fantasy_price
    FROM core.squads s
    JOIN (
      SELECT id,
             percent_rank() OVER (ORDER BY market_value, id) AS pr
        FROM core.squads
       WHERE season_id = v_season AND valid_to IS NULL
         AND status <> 'left' AND market_value IS NOT NULL AND market_value > 0
    ) r ON r.id = s.id
   WHERE NOT s.price_locked;

  IF NOT p_dry_run THEN
    UPDATE core.squads s
       SET fantasy_price = t.new_price, rated = TRUE
      FROM _reprice t
     WHERE s.id = t.squad_id
       AND s.fantasy_price IS DISTINCT FROM t.new_price;
    GET DIAGNOSTICS v_changed = ROW_COUNT;
  ELSE
    SELECT count(*) INTO v_changed FROM _reprice t
      JOIN core.squads s ON s.id = t.squad_id
     WHERE s.fantasy_price IS DISTINCT FROM t.new_price;
  END IF;

  /* ★ דוח ולא "בוצע". כמה בכל מדרגה, כמה נעולים, וכמה נשארו
     בלי שווי — המספר האחרון הוא זה שאומר אם התמחור שלם. */
  SELECT jsonb_build_object(
    'dryRun',  p_dry_run,
    'changed', v_changed,
    'bands',   COALESCE((SELECT jsonb_object_agg(new_price::TEXT, n)
                           FROM (SELECT new_price, count(*) AS n
                                   FROM _reprice GROUP BY new_price) b), '{}'::jsonb),
    'locked',  (SELECT count(*) FROM core.squads
                 WHERE season_id = v_season AND valid_to IS NULL AND price_locked),
    'withoutValue', (SELECT count(*) FROM core.squads
                      WHERE season_id = v_season AND valid_to IS NULL
                        AND status <> 'left'
                        AND (market_value IS NULL OR market_value <= 0)),
    'valueRange', (SELECT jsonb_build_object('min', min(market_value), 'max', max(market_value))
                     FROM core.squads
                    WHERE season_id = v_season AND valid_to IS NULL AND market_value > 0)
  ) INTO v_report;

  IF NOT p_dry_run THEN
    INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
    VALUES (game.actor_label(), 'admin_reprice_from_market', 'season', v_season::TEXT, v_report);
  END IF;

  RETURN v_report;
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_reprice_from_market(BOOLEAN) TO authenticated;

COMMIT;

BEGIN;

-- =====================================================================
--  §3 · זמינות — פצוע, מורחק, חזר
-- =====================================================================
--  ★ נקלט מהספק (`missingPlayers`), ולכן משתנה לבד. מה שחשוב
--    כאן הוא מה **לא** קורה: שחקן שסומן ידנית על ידי האדמין
--    לא נדרס. אדם שראה כתבה וסימן פציעה יודע משהו שהספק עוד
--    לא יודע, ותמיד יעדיף אותו.
ALTER TABLE core.squads
  ADD COLUMN IF NOT EXISTS status_locked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS status_note   TEXT;

CREATE OR REPLACE FUNCTION game.ingest_set_availability(p_rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE
  r JSONB; v_player UUID; n INT := 0; v_status TEXT;
BEGIN
  IF NOT game.can_write_data() THEN RAISE EXCEPTION 'SYSTEM_OR_ADMIN_REQUIRED'; END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    v_player := core.entity_by_provider(r->>'source', 'player', r->>'providerId');
    CONTINUE WHEN v_player IS NULL;

    /* ★ 'missing' → 'injured'.
       הספק מדווח מי חסר אבל לא מתעד את קוד הסיבה, ולכן המתאם
       שולח אותה גולמית. מבחינת המשתמש ההבדל בין פציעה להרחקה
       אינו משנה — השחקן לא ישחק — ולכן המוצר מציג «פצוע»,
       והסיבה הגולמית נשמרת ב-`status_note` כדי שלא תאבד.
       אדמין שיודע יותר מסמן ידנית, וסימון ידני נועל. */
    v_status := CASE lower(COALESCE(r->>'reason',''))
                  WHEN 'injured'   THEN 'injured'
                  WHEN 'suspended' THEN 'suspended'
                  WHEN 'missing'   THEN 'injured'
                  ELSE NULL
                END;
    CONTINUE WHEN v_status IS NULL;

    UPDATE core.squads
       SET status = v_status, status_note = r->>'note'
     WHERE player_id = v_player AND valid_to IS NULL
       AND NOT status_locked
       AND status NOT IN ('left','loaned_out')
       AND status IS DISTINCT FROM v_status;

    IF FOUND THEN n := n + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('updated', n);
END;
$$;

/* סימון ידני נועל, כמו במחיר. */
CREATE OR REPLACE FUNCTION game.admin_set_player_status(p_ext_player TEXT, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_player UUID;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF p_status NOT IN ('active','injured','suspended','loaned_out','left') THEN
    RAISE EXCEPTION 'BAD_STATUS: %', p_status;
  END IF;

  v_player := core.player_by_ext(p_ext_player);
  IF v_player IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND: %', p_ext_player; END IF;

  UPDATE core.squads
     SET status = p_status,
         status_locked = TRUE,
         valid_to = CASE WHEN p_status = 'left' THEN CURRENT_DATE ELSE valid_to END
   WHERE player_id = v_player AND valid_to IS NULL;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (game.actor_label(), 'admin_set_player_status', 'player', p_ext_player,
          jsonb_build_object('status', p_status, 'locked', TRUE));
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_set_player_status(TEXT,TEXT) TO authenticated;

-- =====================================================================
--  §4 · המונים המדודים מגיעים למנוע הניקוד
-- =====================================================================
--  ★ `actions` הוא JSONB אחד ולא אחת־עשרה עמודות: הוספת
--    סטטיסטיקה מנוקדת היא שורה בחוקים, ולא מיגרציה. החוזה
--    (שמות המפתחות) חי ב-`src/lib/scoring/rules.ts` תחת
--    `ACTION_STATS`, והמתאם כותב בדיוק אותם.
DROP FUNCTION IF EXISTS game.gameweek_player_stats(UUID);
CREATE OR REPLACE FUNCTION game.gameweek_player_stats(p_gameweek_id UUID)
RETURNS TABLE (
  player_id UUID, team_id UUID, "position" core.position,
  minutes SMALLINT, goals SMALLINT, assists SMALLINT, own_goals SMALLINT,
  yellow_cards SMALLINT, red_cards SMALLINT, saves SMALLINT,
  penalties_saved SMALLINT, penalties_missed SMALLINT,
  goals_conceded SMALLINT, clean_sheet BOOLEAN,
  actions JSONB
)
LANGUAGE sql STABLE
SET search_path = core, game, public
AS $$
  SELECT s.player_id, s.team_id,
         COALESCE(sq.position, p.primary_position, 'MID'::core.position),
         s.minutes, s.goals, s.assists, s.own_goals,
         s.yellow_cards, s.red_cards, s.saves,
         s.penalties_saved, s.penalties_missed,
         s.goals_conceded, s.clean_sheet,
         /* רק מפתחות מספריים חיוביים. `extra` מכיל גם מטא־דאטה
            (דירוג הספק, מרחק ריצה) שאינו מונה פעולה. */
         COALESCE((
           SELECT jsonb_object_agg(k, v)
             FROM jsonb_each(COALESCE(s.extra, '{}'::jsonb)) AS e(k, v)
            WHERE jsonb_typeof(v) = 'number' AND (v::TEXT)::NUMERIC > 0
              AND k = ANY (ARRAY['shots','shotsOnTarget','keyPasses','bigChancesCreated',
                                 'dribblesWon','tacklesWon','interceptions','clearances',
                                 'recoveries','aerialsWon','savesInsideBox'])
         ), '{}'::jsonb)
  FROM core.player_match_stats s
  JOIN core.weekly_matches m ON m.id = s.match_id
  JOIN core.players p        ON p.id = s.player_id
  LEFT JOIN LATERAL (
    SELECT position FROM core.squads
    WHERE player_id = s.player_id AND team_id = s.team_id AND valid_to IS NULL
    LIMIT 1
  ) sq ON TRUE
  WHERE m.gameweek_id = p_gameweek_id;
$$;
GRANT EXECUTE ON FUNCTION game.gameweek_player_stats(UUID) TO authenticated;

COMMIT;

BEGIN;

-- =====================================================================
--  §5 · הבוט מפסיק להיות מסומן כבוט
-- =====================================================================
--
--  ★ `isBot` חזר לדפדפן בכל קריאה ל-`entries()`, ושני מסכים
--    ציירו לידו תג "בוט". גם אם היו מוחקים את התג, הדגל עצמו
--    היה נשאר במטען — וכל מי שפותח DevTools רואה אותו.
--
--    הסתרה במסך אינה הסתרה. השדה יורד מהמטען.
--
--  ★ `game.users.is_bot` נשאר במסד: האדמין צריך לדעת את מי הוא
--    הוסיף ואת מי הוא מסיר (`admin_remove_bots`), ו-`admin_funnel`
--    חייב לנכות אותם מהמדדים. ההבחנה היא בין מה שהמערכת יודעת
--    לבין מה שהיא משדרת.

CREATE OR REPLACE FUNCTION game.entries(p_gw_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  v_gw     game.gameweeks;
  v_auth   UUID := auth.uid();
  v_open   BOOLEAN;
BEGIN
  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw.id IS NULL THEN RETURN '[]'::jsonb; END IF;

  -- TRUE = ההרכבים עדיין סודיים.
  v_open := (now() < v_gw.lock_at);

  RETURN COALESCE((
    SELECT jsonb_agg(e ORDER BY e->>'submittedAt')
    FROM (
      SELECT jsonb_build_object(
        'id',          ul.id,
        'userId',      ul.user_id,
        'displayName', COALESCE(NULLIF(btrim(u.display_name), ''), 'אלמוני'),
        'teamName',    ul.team_name,
        'gameweekId',  p_gw_code,
        'mode',        ul.mode,
        -- ★ הדגל שאומר למסך "יש כאן משתתף, אין כאן הרכב".
        --   בלעדיו המסך היה מנסה לנקד רשימה ריקה ומציג 0.
        'hidden',      (v_open AND ul.user_id IS DISTINCT FROM v_auth),
        'submittedAt', to_char(ul.submitted_at AT TIME ZONE 'UTC',
                               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'lineup', jsonb_build_object(
          'lineupId',   ul.id,
          'userId',     ul.user_id,
          'gameweekId', p_gw_code,
          'formation',  ul.formation,
          'slots', CASE
            WHEN v_open AND ul.user_id IS DISTINCT FROM v_auth THEN '[]'::jsonb
            ELSE COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'slotNo',    s.slot_no,
                'playerId',  'P' || xp.external_id,
                'teamId',    'T' || xt.external_id,
                'position',  s.position,
                'price',     s.price,
                'isCaptain', s.is_captain,
                'isVice',    s.is_vice,
                'isBench',   s.is_bench
              ) ORDER BY s.slot_no)
              FROM game.user_lineup_slots s
              JOIN core.v_ext xp ON xp.entity_type = 'player' AND xp.entity_id = s.player_id
              JOIN core.v_ext xt ON xt.entity_type = 'team'   AND xt.entity_id = s.team_id
              WHERE s.lineup_id = ul.id
            ), '[]'::jsonb)
          END
        )
      ) AS e
      FROM game.user_lineups ul
      LEFT JOIN game.users u ON u.id = ul.user_id
      WHERE ul.gameweek_id = v_gw.id
        AND ul.status IN ('submitted','locked','scored')
    ) q
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION game.entries(TEXT) TO anon, authenticated;

-- =====================================================================
--  §6 · טבלאות לכולם — גם למי שלא הגיש
-- =====================================================================
--
--  ★ מי שלא הספיק להגיש נשאר עד היום מול מסך שאין בו כלום.
--    זה בדיוק האדם שהכי כדאי להחזיר בשבוע הבא, והמוצר אמר לו
--    "אין לך מה לעשות כאן".
--
--    `public_board` היא קריאה אחת שמחזירה את מה שקורה בליגה
--    בלי קשר להשתתפות: לוח המחזור עם תוצאות חיות, וטבלת הליגה
--    האמיתית. פתוחה גם לאורח שלא נרשם.
--
--  ★ הטבלה נבנית מ-`core.v_team_match_results`, שמסנן
--    `status = 'finished'` — כלומר משחק חי לא מזיז את הטבלה,
--    ומשחק שנדחה לא נספר כתיקו. אותו חוק בדיוק שחל על הניקוד.

CREATE OR REPLACE FUNCTION game.league_table()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'points')::INT DESC,
                                  (t->>'goalDiff')::INT DESC,
                                  (t->>'goalsFor')::INT DESC,
                                  t->>'nameHe'), '[]'::jsonb)
    INTO v
  FROM (
    SELECT jsonb_build_object(
      'team',     core.ext_code('team', x.team_id),
      'nameHe',   tm.name_he,
      'short',    COALESCE(NULLIF(tm.short_code, ''), tm.name_he),
      'played',   x.played,
      'won',      x.won,
      'drawn',    x.drawn,
      'lost',     x.lost,
      'goalsFor', x.gf,
      'goalsAgainst', x.ga,
      'goalDiff', x.gf - x.ga,
      'points',   x.won * 3 + x.drawn
    ) AS t
    FROM (
      SELECT r.team_id,
             count(*)                                  AS played,
             count(*) FILTER (WHERE r.result = 'W')    AS won,
             count(*) FILTER (WHERE r.result = 'D')    AS drawn,
             count(*) FILTER (WHERE r.result = 'L')    AS lost,
             COALESCE(sum(r.goals_for), 0)             AS gf,
             COALESCE(sum(r.goals_against), 0)         AS ga
        FROM core.v_team_match_results r
       GROUP BY r.team_id
    ) x
    JOIN core.teams tm ON tm.id = x.team_id
  ) q;

  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION game.league_table() TO anon, authenticated;

/**
 * מה קורה עכשיו — לוח המחזור עם תוצאות, וטבלת הליגה.
 *
 * ★ `p_gw_code` NULL = המחזור הנוכחי. כך המסך לא צריך לדעת
 *   באיזה מחזור אנחנו, וגם לא יכול לטעות בו.
 */
CREATE OR REPLACE FUNCTION game.public_board(p_gw_code TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_gw game.gameweeks; v JSONB;
BEGIN
  IF p_gw_code IS NULL THEN
    SELECT * INTO v_gw FROM game.gameweeks WHERE is_current LIMIT 1;
  ELSE
    SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  END IF;

  SELECT jsonb_build_object(
    'gameweek', CASE WHEN v_gw.id IS NULL THEN NULL ELSE jsonb_build_object(
      'code',   v_gw.code,
      'number', v_gw.number,
      'label',  v_gw.names #>> '{he,full}',
      'status', v_gw.status,
      'lockAt', v_gw.lock_at,
      'live',   (now() >= v_gw.lock_at AND v_gw.status NOT IN ('published','archived')),
      'entries', (SELECT count(*) FROM game.user_lineups ul
                   WHERE ul.gameweek_id = v_gw.id
                     AND ul.status IN ('submitted','locked','scored'))
    ) END,
    'fixtures', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'home',      core.ext_code('team', m.home_team_id),
               'homeNameHe', h.name_he,
               'away',      core.ext_code('team', m.away_team_id),
               'awayNameHe', a.name_he,
               'kickoff',   m.kickoff_at,
               'status',    m.status,
               'homeGoals', m.home_goals,
               'awayGoals', m.away_goals) ORDER BY m.kickoff_at)
        FROM core.weekly_matches m
        JOIN core.teams h ON h.id = m.home_team_id
        JOIN core.teams a ON a.id = m.away_team_id
       WHERE m.gameweek_id = v_gw.id), '[]'::jsonb),
    'table', game.league_table()
  ) INTO v;

  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION game.public_board(TEXT) TO anon, authenticated;

-- =====================================================================
--  §7 · סיכום מחזור אישי
-- =====================================================================
--
--  ★ הבריף: «לעולם לא להציג רק ציון סופי». המשתמש צריך לדעת
--    כמה, למה, איפה הוא, מי הייתה הבחירה הטובה, מי הגרועה,
--    מה עשה הקפטן, ואת מי הוא ניצח.
--
--  ★ גם למי שלא הגיש יש תשובה: `hasEntry=false`, ועדיין מי
--    ניצח ובכמה. אין מסך ריק.

CREATE OR REPLACE FUNCTION game.gameweek_recap(p_gw_code TEXT, p_mode TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  v_gw     game.gameweeks;
  v_auth   UUID := auth.uid();
  v_mine   RECORD;
  v_total  INT;
  v_rank   INT;
  v_players JSONB;
  v_best   JSONB;
  v_worst  JSONB;
  v_cap    JSONB;
BEGIN
  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw.id IS NULL THEN RETURN jsonb_build_object('gw', p_gw_code, 'exists', FALSE); END IF;

  SELECT count(*) INTO v_total
    FROM game.lineup_scores ls JOIN game.user_lineups ul ON ul.id = ls.lineup_id
   WHERE ul.gameweek_id = v_gw.id AND (p_mode IS NULL OR ul.mode = p_mode);

  SELECT ls.total_points, ls.breakdown, ul.mode, ul.team_name
    INTO v_mine
    FROM game.lineup_scores ls JOIN game.user_lineups ul ON ul.id = ls.lineup_id
   WHERE ul.gameweek_id = v_gw.id AND ul.user_id = v_auth
     AND (p_mode IS NULL OR ul.mode = p_mode)
   LIMIT 1;

  IF v_mine.total_points IS NOT NULL THEN
    SELECT count(*) + 1 INTO v_rank
      FROM game.lineup_scores ls JOIN game.user_lineups ul ON ul.id = ls.lineup_id
     WHERE ul.gameweek_id = v_gw.id AND (p_mode IS NULL OR ul.mode = p_mode)
       AND ls.total_points > v_mine.total_points;

    v_players := COALESCE(v_mine.breakdown -> 'players', '[]'::jsonb);

    /* ★ הטובה והגרועה נבחרות מאותה רשימה בדיוק, עם אותו שובר
       שוויון (מזהה) — כדי ששני מסכים לא יראו שחקנים שונים. */
    SELECT jsonb_build_object(
             'player', e->>'playerId',
             'nameHe', (SELECT pl.name_he FROM core.players pl
                         WHERE pl.id = core.player_by_ext(ltrim(e->>'playerId','P'))),
             'points', (e->>'subtotal')::NUMERIC)
      INTO v_best
      FROM jsonb_array_elements(v_players) e
     ORDER BY (e->>'subtotal')::NUMERIC DESC, e->>'playerId' LIMIT 1;

    SELECT jsonb_build_object(
             'player', e->>'playerId',
             'nameHe', (SELECT pl.name_he FROM core.players pl
                         WHERE pl.id = core.player_by_ext(ltrim(e->>'playerId','P'))),
             'points', (e->>'subtotal')::NUMERIC)
      INTO v_worst
      FROM jsonb_array_elements(v_players) e
     ORDER BY (e->>'subtotal')::NUMERIC ASC, e->>'playerId' LIMIT 1;

    SELECT jsonb_build_object(
             'player', e->>'playerId',
             'nameHe', (SELECT pl.name_he FROM core.players pl
                         WHERE pl.id = core.player_by_ext(ltrim(e->>'playerId','P'))),
             'points', (e->>'subtotal')::NUMERIC)
      INTO v_cap
      FROM jsonb_array_elements(v_players) e
     WHERE (e->>'isCaptain')::BOOLEAN LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'gw',       p_gw_code,
    'exists',   TRUE,
    'status',   v_gw.status,
    'entries',  v_total,
    'hasEntry', v_mine.total_points IS NOT NULL,
    'mode',     v_mine.mode,
    'teamName', v_mine.team_name,
    'points',   v_mine.total_points,
    'rank',     v_rank,
    /* אחוז המשתתפים שניצחת. מעוגל כלפי מטה — «ניצחת 94%» חייב
       להיות אמת גם כשזה 94.9. */
    'beatPercent', CASE WHEN v_total > 1 AND v_rank IS NOT NULL
                        THEN floor((v_total - v_rank) * 100.0 / (v_total - 1))
                   END,
    'best',     v_best,
    'worst',    v_worst,
    'captain',  v_cap,
    'top', (SELECT jsonb_build_object(
                     'name',   COALESCE(NULLIF(btrim(ul.team_name), ''),
                                        NULLIF(btrim(u.display_name), ''), 'אלמוני'),
                     'points', ls.total_points)
              FROM game.lineup_scores ls
              JOIN game.user_lineups ul ON ul.id = ls.lineup_id
              JOIN game.users u ON u.id = ul.user_id
             WHERE ul.gameweek_id = v_gw.id AND (p_mode IS NULL OR ul.mode = p_mode)
             ORDER BY ls.total_points DESC, ul.submitted_at LIMIT 1)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION game.gameweek_recap(TEXT,TEXT) TO anon, authenticated;

-- =====================================================================
--  §8 · מילוי מחזור שעבר
-- =====================================================================
--  ★ אותה פעימה בדיוק, עם מספר מחזור מפורש. כך מחזורים 1–3
--    נכנסים בלי קוד מיוחד ובלי נתיב שני — ומה שנבדק על מחזור
--    חי נבדק גם עליהם.
CREATE OR REPLACE FUNCTION game.admin_ingest_round(p_round INT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public, extensions
AS $$
DECLARE v_url TEXT; v_token TEXT; v_req BIGINT;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF p_round IS NULL OR p_round < 1 OR p_round > 60 THEN RAISE EXCEPTION 'BAD_ROUND'; END IF;

  SELECT function_url, token INTO v_url, v_token FROM game.ingest_secrets WHERE id;
  IF v_url IS NULL OR v_token IS NULL THEN
    RETURN jsonb_build_object('skipped', 'endpoint_not_configured');
  END IF;

  BEGIN
    SELECT net.http_post(
             url     := v_url,
             headers := jsonb_build_object('content-type','application/json',
                                           'x-ingest-token', v_token),
             body    := jsonb_build_object('phase','sweep','round', p_round),
             timeout_milliseconds := 55000) INTO v_req;
  EXCEPTION WHEN undefined_function OR undefined_table OR invalid_schema_name THEN
    RETURN jsonb_build_object('skipped', 'pg_net_missing');
  END;

  INSERT INTO game.ingest_dispatches (request_id, origin)
  VALUES (v_req, 'admin') ON CONFLICT DO NOTHING;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (game.actor_label(), 'admin_ingest_round', 'round', p_round::TEXT,
          jsonb_build_object('request', v_req));

  RETURN jsonb_build_object('requested', v_req, 'round', p_round);
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_ingest_round(INT) TO authenticated;

COMMIT;

INSERT INTO game.schema_migrations (version, note) VALUES
  ('30', '★ שווי שוק ותמחור 1–5 · זמינות · מונים מדודים · טבלאות לכולם · סיכום מחזור')
ON CONFLICT (version) DO NOTHING;

BEGIN;

-- =====================================================================
--  §9 · שווי שוק נכנס מהקליטה
-- =====================================================================
--  ★ פונקציה נפרדת ולא הרחבה של `ingest_snapshot`.
--
--    `ingest_snapshot` היא נתיב הכתיבה של **ביצועים** — מה קרה
--    במשחק. שווי שוק וזמינות הם מטא־דאטה של הסגל: הם משתנים בין
--    מחזורים, לא בתוך משחק, ונכתבים בקצב אחר לגמרי. לדחוס אותם
--    לאותה פונקציה היה מחייב לפרק ולהרכיב מחדש מאתיים שורות
--    שכבר רצות בייצור, בשביל שדה.
CREATE OR REPLACE FUNCTION game.ingest_set_market_values(p_rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE r JSONB; v_player UUID; v_value NUMERIC; n INT := 0; seen INT := 0;
BEGIN
  IF NOT game.can_write_data() THEN RAISE EXCEPTION 'SYSTEM_OR_ADMIN_REQUIRED'; END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    seen := seen + 1;
    v_value := NULLIF(r->>'marketValue','')::NUMERIC;
    CONTINUE WHEN v_value IS NULL OR v_value <= 0;

    v_player := core.entity_by_provider(r->>'source', 'player', r->>'providerId');
    CONTINUE WHEN v_player IS NULL;

    UPDATE core.squads
       SET market_value = v_value,
           value_source = r->>'source',
           value_at     = now()
     WHERE player_id = v_player AND valid_to IS NULL
       AND market_value IS DISTINCT FROM v_value;

    IF FOUND THEN n := n + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('seen', seen, 'updated', n);
END;
$$;

COMMIT;
