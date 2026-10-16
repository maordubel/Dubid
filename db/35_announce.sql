-- =====================================================================
--  db/35_announce.sql — הודעות מחזור (טלגרם) מתוך מחזור החיים
--
--  ★ מה זה
--  תור יוצא (outbox) אחד. `announce_scan()` מסתכל על מצב המחזורים
--  ומכניס שורה לכל אירוע שהמשתמשים צריכים לדעת עליו:
--
--    opened    מחזור נפתח להגשות (משחקים + דדליין)
--    reminder  שלוש שעות לפני הנעילה
--    locked    ההגשות ננעלו (כמה הגישו)
--    published תוצאות המחזור + טבלת המחזור + הטבלה המצטברת
--    alert     התרעה חוסמת פתוחה בקליטה (למנהל)
--    stuck     מחזור שתקוע ב-scoring
--
--  ★ הכלל: שורה אחת לאירוע. `dedupe_key` ייחודי, ולכן אין משמעות
--    לכמה פעמים הפעימה רצה — לא יוצאת הודעה כפולה.
--  ★ שליחה לא קורית כאן. מסד נתונים לא שולח הודעות: ה-runner
--    (GitHub Actions) לוקח שורות, מצייר כרטיס, שולח, ומסמן.
--    כישלון שליחה לא מחזיר שום דבר אחורה במחזור החיים.
--  ★ שורה שנשלחה לא נשלחת שוב. שורה שאי אפשר לדעת אם נשלחה
--    (`unknown`) נשארת לבדיקת אדם — לא נשלחת אוטומטית.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS game.announce_outbox (
  id          BIGSERIAL PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('opened','reminder','locked','published','alert','stuck')),
  gw_code     TEXT,
  audience    TEXT NOT NULL DEFAULT 'owner' CHECK (audience IN ('owner','players')),
  dedupe_key  TEXT NOT NULL UNIQUE,
  payload     JSONB NOT NULL,
  state       TEXT NOT NULL DEFAULT 'pending'
              CHECK (state IN ('pending','sending','sent','failed','unknown')),
  attempts    INT NOT NULL DEFAULT 0,
  lease_until TIMESTAMPTZ,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS announce_outbox_pending ON game.announce_outbox (state, created_at);

DO $rls$
BEGIN
  ALTER TABLE game.announce_outbox ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON game.announce_outbox FROM anon, authenticated;
EXCEPTION WHEN OTHERS THEN NULL;
END
$rls$;

-- ---------------------------------------------------------------------
--  §1 · סריקה — מכניסה אירועים, לא שולחת
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION game.announce_scan()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  g RECORD;
  n INT := 0;
  c INT;
  v_matches JSONB;
BEGIN
  FOR g IN
    SELECT gw.id, gw.code, gw.number, gw.status, gw.lock_at
      FROM game.gameweeks gw
     WHERE gw.status <> 'archived'
       AND gw.number >= COALESCE((SELECT max(number) FROM game.gameweeks WHERE status = 'published'), 0)
  LOOP
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'home', h.name_he, 'away', a.name_he, 'kickoff', m.kickoff_at,
             'status', m.status, 'homeGoals', m.home_goals, 'awayGoals', m.away_goals)
             ORDER BY m.kickoff_at), '[]'::jsonb)
      INTO v_matches
      FROM core.weekly_matches m
      JOIN core.teams h ON h.id = m.home_team_id
      JOIN core.teams a ON a.id = m.away_team_id
     WHERE m.gameweek_id = g.id;

    CONTINUE WHEN jsonb_array_length(v_matches) = 0;

    /* opened — כל מצב מעבר ל-open ואילך מוכיח שהמחזור נפתח */
    IF g.status IN ('open','locked','live','scoring','published') AND g.lock_at > now() - INTERVAL '2 days' THEN
      INSERT INTO game.announce_outbox (kind, gw_code, audience, dedupe_key, payload)
      VALUES ('opened', g.code, 'owner', 'opened:' || g.code,
              jsonb_build_object('number', g.number, 'lockAt', g.lock_at, 'matches', v_matches))
      ON CONFLICT (dedupe_key) DO NOTHING;
      GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
    END IF;

    /* reminder — בין 3 שעות לנעילה לנעילה עצמה */
    IF g.status = 'open' AND g.lock_at > now() AND g.lock_at <= now() + INTERVAL '3 hours' THEN
      INSERT INTO game.announce_outbox (kind, gw_code, audience, dedupe_key, payload)
      VALUES ('reminder', g.code, 'owner', 'reminder:' || g.code,
              jsonb_build_object('number', g.number, 'lockAt', g.lock_at,
                'submitted', (SELECT count(*) FROM game.user_lineups
                               WHERE gameweek_id = g.id AND status = 'submitted')))
      ON CONFLICT (dedupe_key) DO NOTHING;
      GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
    END IF;

    /* locked */
    IF g.status IN ('locked','live','scoring','published') AND g.lock_at > now() - INTERVAL '2 days' THEN
      INSERT INTO game.announce_outbox (kind, gw_code, audience, dedupe_key, payload)
      VALUES ('locked', g.code, 'owner', 'locked:' || g.code,
              jsonb_build_object('number', g.number, 'lockAt', g.lock_at,
                'submitted', (SELECT count(*) FROM game.user_lineups
                               WHERE gameweek_id = g.id AND status IN ('submitted','locked','scored'))))
      ON CONFLICT (dedupe_key) DO NOTHING;
      GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
    END IF;

    /* published — תוצאות + טבלת מחזור + טבלה מצטברת */
    IF g.status = 'published' THEN
      INSERT INTO game.announce_outbox (kind, gw_code, audience, dedupe_key, payload)
      VALUES ('published', g.code, 'owner', 'published:' || g.code,
        jsonb_build_object(
          'number', g.number,
          'matches', v_matches,
          'round', COALESCE((
            SELECT jsonb_agg(r ORDER BY r->>'rank' NULLS LAST, (r->>'points')::numeric DESC) FROM (
              SELECT jsonb_build_object('rank', ls.rank, 'name', u.display_name,
                                        'points', ls.total_points) AS r
                FROM game.lineup_scores ls
                JOIN game.user_lineups ul ON ul.id = ls.lineup_id
                JOIN game.users u ON u.id = ul.user_id
               WHERE ls.gameweek_id = g.id
               ORDER BY ls.rank NULLS LAST, ls.total_points DESC LIMIT 10) q), '[]'::jsonb),
          'season', COALESCE((
            SELECT jsonb_agg(r ORDER BY (r->>'points')::numeric DESC) FROM (
              SELECT jsonb_build_object('name', u.display_name, 'points', sum(ls.total_points),
                                        'rounds', count(*)) AS r
                FROM game.lineup_scores ls
                JOIN game.user_lineups ul ON ul.id = ls.lineup_id
                JOIN game.users u ON u.id = ul.user_id
                JOIN game.gameweeks gw ON gw.id = ls.gameweek_id AND gw.status = 'published'
               GROUP BY u.id, u.display_name
               ORDER BY sum(ls.total_points) DESC LIMIT 10) q), '[]'::jsonb),
          'players', (SELECT count(*) FROM game.lineup_scores WHERE gameweek_id = g.id)))
      ON CONFLICT (dedupe_key) DO NOTHING;
      GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
    END IF;
  END LOOP;

  /* alert — התרעה חוסמת פתוחה. מזהה ההתרעה הוא המפתח: אחת לכל התרעה. */
  INSERT INTO game.announce_outbox (kind, gw_code, audience, dedupe_key, payload)
  SELECT 'alert', a.gw_code, 'owner', 'alert:' || a.id,
         jsonb_build_object('kind', a.kind, 'severity', a.severity, 'detail', a.detail, 'at', a.created_at)
    FROM game.ingest_alerts a
   WHERE a.cleared_at IS NULL
     AND (a.severity = 'block' OR a.detail->>'issue' = 'stuck_in_scoring')
     AND a.created_at > now() - INTERVAL '3 days'
  ON CONFLICT (dedupe_key) DO NOTHING;
  GET DIAGNOSTICS c = ROW_COUNT; n := n + c;

  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION game.announce_scan() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
--  §2 · ה-runner לוקח, שולח, מסמן (service_role בלבד)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION game.announce_claim(p_limit INT DEFAULT 4)
RETURNS SETOF game.announce_outbox
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
BEGIN
  PERFORM game.announce_scan();
  /* שורה שנתקעה ב-sending מעבר לחכירה: לא ידוע אם יצאה. לא שולחים שוב. */
  UPDATE game.announce_outbox
     SET state = 'unknown', error = 'lease expired while sending; check Telegram before resending'
   WHERE state = 'sending' AND lease_until < now();

  RETURN QUERY
  WITH picked AS (
    SELECT id FROM game.announce_outbox
     WHERE state IN ('pending','failed') AND attempts < 5
     ORDER BY created_at
     LIMIT GREATEST(1, LEAST(p_limit, 10))
     FOR UPDATE SKIP LOCKED)
  UPDATE game.announce_outbox o
     SET state = 'sending', attempts = o.attempts + 1,
         lease_until = now() + INTERVAL '5 minutes'
    FROM picked WHERE o.id = picked.id
  RETURNING o.*;
END;
$$;

CREATE OR REPLACE FUNCTION game.announce_mark(p_id BIGINT, p_state TEXT, p_error TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER
SET search_path = game, public
AS $$
  UPDATE game.announce_outbox
     SET state = p_state,
         error = left(p_error, 300),
         lease_until = NULL,
         sent_at = CASE WHEN p_state = 'sent' THEN now() ELSE sent_at END
   WHERE id = p_id AND p_state IN ('sent','failed','unknown');
$$;

REVOKE ALL ON FUNCTION game.announce_claim(INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION game.announce_mark(BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
DO $g$
BEGIN
  GRANT EXECUTE ON FUNCTION game.announce_claim(INT) TO service_role;
  GRANT EXECUTE ON FUNCTION game.announce_mark(BIGINT, TEXT, TEXT) TO service_role;
EXCEPTION WHEN OTHERS THEN NULL;
END
$g$;

-- ---------------------------------------------------------------------
--  §3 · מבט לאדמין
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW game.v_announce_health AS
SELECT count(*) FILTER (WHERE state = 'pending')  AS pending,
       count(*) FILTER (WHERE state = 'failed')   AS failed,
       count(*) FILTER (WHERE state = 'unknown')  AS unknown,
       max(sent_at)                               AS last_sent
  FROM game.announce_outbox;

INSERT INTO game.schema_migrations (version, note) VALUES
  ('35', 'הודעות מחזור — outbox + סריקה + claim/mark ל-runner חיצוני')
ON CONFLICT (version) DO NOTHING;

COMMIT;
