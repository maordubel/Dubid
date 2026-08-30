-- =====================================================================
--  db/24_live_gameweek.sql — המחזור חי בין הנעילה לסיום
-- =====================================================================
--
--  ★ הבעיה שהקובץ הזה פותר
--
--  מחזור נפרס על שלושה־ארבעה ימים. עד עכשיו היו למוצר שני מצבים
--  בלבד: "לא פורסם" ו"פורסם". כלומר: מרגע הנעילה ועד שהאדמין לחץ
--  "פרסום", המשתמש ראה **אפס**. משחק הסתיים בשבת בערב, הניקוד
--  שלו כבר יושב במסד — והמסך המשיך להגיד "הדירוג ייפתח כשהמחזור
--  יסתיים".
--
--  זה הרג בדיוק את החוליה שמחזירה אנשים: WATCH. מי שאין לו מה
--  לראות בין שבת לראשון לא פותח את האפליקציה בשבת.
--
--  ★ המצב השלישי: חי
--
--      OPEN            → אין ניקוד. אין מה להראות.
--      LOCKED / LIVE   → ★ ניקוד **זורם**. הטבלה זזה עם כל עדכון.
--      PUBLISHED       → ניקוד **סופי**. נעול, לתמיד.
--
--  שני דגלים ולא אחד:
--
--      live   = ההרכבים נעולים והמחזור עוד לא נסגר → מספרים חיים
--      final  = האדמין לחץ "סיום מחזור"            → מספרים סופיים
--
--  ★ למה `live` נגזר מהשעון ולא מהסטטוס
--
--  אילו `live` היה `status IN ('locked','live')`, המוצר היה תלוי
--  בכך שמישהו יזכור ללחוץ "נעילה" בלוח הניהול. הוא לא יזכור —
--  ואז מחזור שכבר ננעל בפועל (`now() >= lock_at`, וזו השורה
--  שאוכפת את הנעילה ב-`submit_entry`) היה מציג מסך ריק כי עמודת
--  סטטוס נשארה 'open'.
--
--  הכלל היחיד: **אותו תנאי שנועל את ההגשות פותח את הניקוד.**
--
--  ★ מה **לא** משתנה
--
--   · `published` נשאר בדיוק כפי שהיה (`status = 'published'`).
--     כל מסך שקורא אותו ממשיך לעבוד בלי שינוי.
--   · תוצאות קבוצה (`outcomes`) ממשיכות להגיע רק ממשחקים
--     שהסתיימו — `core.v_team_match_results` מסנן
--     `status = 'finished'`. כלומר משחק בעיצומו נותן נקודות
--     אישיות, ולא נותן נקודות ניצחון. זה נכון, וזה גם מונע
--     "ניצחון" שנעלם בדקה 90.
--   · `admin_set_published` נשאר נתיב הכתיבה **היחיד** לסיום
--     מחזור. לא נוצרה כאן פונקציית סיום שנייה.
--
--  אידמפוטנטי. אפשר להריץ שוב.
-- =====================================================================

SET search_path = game, core, public;

-- =====================================================================
-- §1 הדופק — כל עדכון תוצאה מגיע לכל מכשיר פתוח
-- =====================================================================
--
--  ★ למה כאן ולא ערוץ Realtime נוסף
--
--  `db/13` כבר בנה את המנגנון: טבלה אחת (`game.data_revision`),
--  מונה אחד, טריגר `FOR EACH STATEMENT` על כל טבלה שמעניינת את
--  המסך, וערוץ Realtime יחיד שכל מכשיר מאזין לו.
--
--  שתי הטבלאות שהניקוד החי תלוי בהן **לא היו ברשימה**:
--
--      core.player_match_stats   ← הסטטיסטיקה עצמה
--      game.user_lineups         ← מי הגיש
--
--  הקליינט אמנם ניסה להאזין להן ישירות, אבל טבלה שאינה בפרסום
--  ובלי מדיניות SELECT פשוט לא משדרת — כלומר האזנה שנראית
--  עובדת ואף פעם לא יורה. הוספה לרשימה הקיימת פותרת את זה
--  במקום אחד, בלי לחשוף אף שורה למאזינים.
--
--  ⚠ סיכון שנשקל: `player_match_stats` מתעדכן בקליטה המונית של
--    ספק הדאטה. `FOR EACH STATEMENT` הופך קליטה של 300 שורות
--    לבאמפ אחד — לא 300. זו בדיוק הסיבה שהטריגר הזה הוא
--    STATEMENT ולא ROW.

DO $pulse$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['core.player_match_stats', 'game.user_lineups'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS bump_data_revision ON %s', t);
    EXECUTE format(
      'CREATE TRIGGER bump_data_revision AFTER INSERT OR UPDATE OR DELETE ON %s '
      'FOR EACH STATEMENT EXECUTE FUNCTION game.bump_revision()', t);
  END LOOP;
END
$pulse$;


-- =====================================================================
-- §2 מתי היה העדכון האחרון
-- =====================================================================
--
--  ★ למה זה לא `now()`
--
--  `game.results` החזירה עד עכשיו `updatedAt = now()` — כלומר
--  "עכשיו", תמיד, בכל קריאה. מסך שמציג "עודכן לפני 0 שניות"
--  בזמן שהמשחק האחרון הסתיים אתמול הוא מסך משקר, ומשתמש שלמד
--  שהוא משקר מפסיק להסתכל עליו.
--
--  הזמן האמיתי הוא החותמת האחרונה ב-`player_match_stats` של
--  המחזור. אם עוד לא נכנס דבר — NULL, והמסך אומר "טרם".

CREATE OR REPLACE FUNCTION game.gameweek_last_event(p_gameweek_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE
SET search_path = game, core, public
AS $$
  SELECT max(s.updated_at)
  FROM core.player_match_stats s
  JOIN core.weekly_matches m ON m.id = s.match_id
  WHERE m.gameweek_id = p_gameweek_id;
$$;

GRANT EXECUTE ON FUNCTION game.gameweek_last_event(UUID) TO anon, authenticated;


/**
 * התקדמות המחזור — כמה משחקים כבר נגמרו, וכמה עוד לא.
 *
 * ★ למה זו פונקציה ולא שדה בתוך `results`
 *
 * לוח הניהול צריך את המספרים האלה גם למחזור שהוא **לא** המחזור
 * הפעיל, ולפני שהוא פותח את מסך התוצאות. פונקציה קטנה נפרדת
 * זולה יותר מלמשוך את כל מפת הניקוד רק כדי לספור משחקים.
 *
 * קריאה בלבד. אין כאן שום כתיבה, ולכן היא פתוחה לכולם — ספירת
 * משחקים אינה סוד.
 */
CREATE OR REPLACE FUNCTION game.gameweek_progress(p_gw_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v_gw game.gameweeks;
BEGIN
  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw.id IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND: %', p_gw_code; END IF;

  RETURN jsonb_build_object(
    'code',           v_gw.code,
    'status',         v_gw.status,
    'locked',         (now() >= v_gw.lock_at),
    'published',      (v_gw.status = 'published'),
    'fixturesTotal',  (SELECT count(*) FROM core.weekly_matches m
                        WHERE m.gameweek_id = v_gw.id),
    'fixturesFinal',  (SELECT count(*) FROM core.weekly_matches m
                        WHERE m.gameweek_id = v_gw.id AND m.status = 'finished'),
    'fixturesLive',   (SELECT count(*) FROM core.weekly_matches m
                        WHERE m.gameweek_id = v_gw.id AND m.status = 'live'),
    'scoredPlayers',  (SELECT count(*) FROM core.player_match_stats s
                        JOIN core.weekly_matches m ON m.id = s.match_id
                        WHERE m.gameweek_id = v_gw.id),
    'entries',        (SELECT count(*) FROM game.user_lineups ul
                        WHERE ul.gameweek_id = v_gw.id AND ul.status <> 'draft'),
    'lastEventAt',    to_char(game.gameweek_last_event(v_gw.id) AT TIME ZONE 'UTC',
                              'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION game.gameweek_progress(TEXT) TO anon, authenticated;


-- =====================================================================
-- §3 `game.results` — אותה מפה בדיוק, ועוד ארבעה דגלים
-- =====================================================================
--
--  ⚠ הגוף זהה לזה שב-`db/09`, למעט:
--
--      + 'live'          חדש
--      + 'final'         חדש (שם נרדף מפורש ל-published)
--      + 'fixturesTotal' חדש
--      + 'fixturesFinal' חדש
--      ~ 'updatedAt'     עכשיו הזמן האמיתי ולא now()
--
--  לא שונה שום דבר במפות `performances` / `outcomes` /
--  `fixtureScores`, ולכן מנוע הניקוד בקליינט מקבל בדיוק את מה
--  שהוא קיבל אתמול. השינוי היחיד הוא **מתי מותר להראות אותו**.

CREATE OR REPLACE FUNCTION game.results(p_gw_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  v_gw        game.gameweeks;
  v_published BOOLEAN;
  v_live      BOOLEAN;
  v_last      TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw.id IS NULL THEN
    RETURN jsonb_build_object('gameweekId', p_gw_code,
                              'published', FALSE, 'final', FALSE, 'live', FALSE,
                              'fixturesTotal', 0, 'fixturesFinal', 0,
                              'updatedAt', NULL,
                              'performances', '{}'::jsonb, 'outcomes', '{}'::jsonb,
                              'fixtureScores', '{}'::jsonb);
  END IF;

  v_published := (v_gw.status = 'published');

  /* ★ אותו תנאי שנועל את ההגשות פותח את הניקוד.
     `archived` יוצא מהחישוב כי מחזור בארכיון סופי בהגדרה. */
  v_live := (now() >= v_gw.lock_at)
            AND v_gw.status NOT IN ('published', 'archived');

  v_last := game.gameweek_last_event(v_gw.id);

  RETURN jsonb_build_object(
    'gameweekId', p_gw_code,
    'published',  v_published,
    'final',      v_published,
    'live',       v_live,
    'status',     v_gw.status,
    'fixturesTotal', (SELECT count(*) FROM core.weekly_matches m
                       WHERE m.gameweek_id = v_gw.id),
    'fixturesFinal', (SELECT count(*) FROM core.weekly_matches m
                       WHERE m.gameweek_id = v_gw.id AND m.status = 'finished'),
    'updatedAt',  to_char(v_last AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),

    'performances', COALESCE((
      SELECT jsonb_object_agg('P' || xp.external_id, jsonb_build_object(
        'playerId',        'P' || xp.external_id,
        'teamId',          'T' || xt.external_id,
        'position',        st.position,
        'minutes',         st.minutes,
        'goals',           st.goals,
        'assists',         st.assists,
        'ownGoals',        st.own_goals,
        'yellowCards',     st.yellow_cards,
        'redCards',        st.red_cards,
        'saves',           st.saves,
        'penaltiesSaved',  st.penalties_saved,
        'penaltiesMissed', st.penalties_missed,
        'goalsConceded',   st.goals_conceded,
        'cleanSheet',      st.clean_sheet,
        'played',          st.minutes > 0
      ))
      FROM game.gameweek_player_stats(v_gw.id) st
      JOIN core.v_ext xp ON xp.entity_type = 'player' AND xp.entity_id = st.player_id
      JOIN core.v_ext xt ON xt.entity_type = 'team'   AND xt.entity_id = st.team_id
    ), '{}'::jsonb),

    /* ★ רק משחקים שהסתיימו. `core.v_team_match_results` מסנן
       `status = 'finished'`, ולכן ניצחון לא נספר בדקה 20 ואי
       אפשר שיילקח בדקה 90. */
    'outcomes', COALESCE((
      SELECT jsonb_object_agg('T' || xt.external_id, jsonb_build_object(
        'teamId',       'T' || xt.external_id,
        'result',       r.result,
        'goalsFor',     r.goals_for,
        'goalsAgainst', r.goals_against
      ))
      FROM game.gameweek_team_results(v_gw.id) r
      JOIN core.v_ext xt ON xt.entity_type = 'team' AND xt.entity_id = r.team_id
    ), '{}'::jsonb),

    'fixtureScores', COALESCE((
      SELECT jsonb_object_agg('T' || xh.external_id || '-T' || xa.external_id,
        jsonb_build_object(
          'fixtureId',  'T' || xh.external_id || '-T' || xa.external_id,
          'homeGoals',  COALESCE(m.home_goals, 0),
          'awayGoals',  COALESCE(m.away_goals, 0),
          'final',      m.status = 'finished',
          'live',       m.status = 'live'
        ))
      FROM core.weekly_matches m
      JOIN core.v_ext xh ON xh.entity_type = 'team' AND xh.entity_id = m.home_team_id
      JOIN core.v_ext xa ON xa.entity_type = 'team' AND xa.entity_id = m.away_team_id
      WHERE m.gameweek_id = v_gw.id AND m.home_goals IS NOT NULL
    ), '{}'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION game.results(TEXT) TO anon, authenticated;


-- =====================================================================
-- §4 `game.gameweek_state` — הלובי צריך לדעת כמה נשאר
-- =====================================================================
--
--  שדות חדשים בלבד. כל קורא קיים ממשיך לעבוד.

CREATE OR REPLACE FUNCTION game.gameweek_state(p_gw_code TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
  SELECT jsonb_build_object(
    'code',           gw.code,
    'number',         gw.number,
    'status',         gw.status,
    'lockAt',         to_char(gw.lock_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'firstKickoffAt', to_char(COALESCE(gw.first_kickoff_at, gw.lock_at) AT TIME ZONE 'UTC',
                              'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'serverNow',      (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT,
    'entrants',       (SELECT count(DISTINCT user_id) FROM game.user_lineups
                        WHERE gameweek_id = gw.id AND status <> 'draft'),
    -- ★ חדש: התקדמות המחזור, לפס ה"חי" בלובי ובדירוג.
    'locked',         (now() >= gw.lock_at),
    'published',      (gw.status = 'published'),
    'fixturesTotal',  (SELECT count(*) FROM core.weekly_matches m
                        WHERE m.gameweek_id = gw.id),
    'fixturesFinal',  (SELECT count(*) FROM core.weekly_matches m
                        WHERE m.gameweek_id = gw.id AND m.status = 'finished'),
    'fixturesLive',   (SELECT count(*) FROM core.weekly_matches m
                        WHERE m.gameweek_id = gw.id AND m.status = 'live'),
    'lastEventAt',    to_char(game.gameweek_last_event(gw.id) AT TIME ZONE 'UTC',
                              'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  )
  FROM game.gameweeks gw WHERE gw.code = p_gw_code;
$$;

GRANT EXECUTE ON FUNCTION game.gameweek_state(TEXT) TO anon, authenticated;


-- =====================================================================
-- §5 `game.gameweeks_list` — לוח הניהול רואה כמה משחקים נגמרו
-- =====================================================================
--
--  ★ למה זה חשוב דווקא כאן
--
--  "סיום מחזור" הוא כפתור שאי אפשר לבטל בלי שמישהו כבר ראה את
--  התוצאה. אדמין שלוחץ עליו כשעוד לא כל המשחקים הסתיימו סוגר
--  מחזור על ניקוד חלקי. הדרך היחידה למנוע את זה היא **להראות
--  לו את המספר** ליד הכפתור: 6 מתוך 7.

CREATE OR REPLACE FUNCTION game.gameweeks_list()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
  SELECT COALESCE(jsonb_agg(g ORDER BY (g->>'number')::INT DESC), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'code',      gw.code,
      'number',    gw.number,
      'label',     COALESCE(gw.names #>> '{he,full}', 'מחזור ' || gw.number),
      'status',    gw.status,
      'isCurrent', gw.is_current,
      'lockAt',    to_char(gw.lock_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'fixtures',  (SELECT count(*) FROM core.weekly_matches m WHERE m.gameweek_id = gw.id),
      'entries',   (SELECT count(*) FROM game.user_lineups ul
                     WHERE ul.gameweek_id = gw.id AND ul.status <> 'draft'),
      'published', (gw.status = 'published'),
      -- ★ חדש
      'locked',        (now() >= gw.lock_at),
      'fixturesFinal', (SELECT count(*) FROM core.weekly_matches m
                         WHERE m.gameweek_id = gw.id AND m.status = 'finished'),
      'fixturesLive',  (SELECT count(*) FROM core.weekly_matches m
                         WHERE m.gameweek_id = gw.id AND m.status = 'live'),
      'lastEventAt',   to_char(game.gameweek_last_event(gw.id) AT TIME ZONE 'UTC',
                                'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ) AS g
    FROM game.gameweeks gw
    WHERE gw.code IS NOT NULL
  ) q;
$$;

GRANT EXECUTE ON FUNCTION game.gameweeks_list() TO anon, authenticated;


/* ★ באמפ אחרון: כל מכשיר שפתוח כרגע ימשוך את הסכימה החדשה
   מיד אחרי המיגרציה, במקום להמשיך לעבוד מול הפונקציות הישנות
   עד הרענון הבא. */
UPDATE game.data_revision
   SET revision = revision + 1, scope = 'migration-24', updated_at = now()
 WHERE id = 1;


-- =====================================================================
--  סוף db/24
-- =====================================================================
