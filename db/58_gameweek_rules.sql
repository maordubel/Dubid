-- =====================================================================
--  db/58_gameweek_rules.sql · חוקי הניקוד מוקפאים לכל מחזור (D02 / F09)
--
--  הבעיה: dubid-score-gameweek קרא את ה-ruleset בעל הגרסה האחרונה של
--  הליגה + את ה-overrides **של היום**. שינוי איזון באמצע מחזור (או ניקוד
--  מחדש של מחזור ישן) היה מנקד הרכבים לפי חוקים שלא היו בתוקף כשהוגשו.
--  והקליינט הציג ניקוד זמני לפי ה-overrides של היום — שני מספרים לאותו מחזור.
--
--  התיקון:
--   1. game.gameweek_rules — תמונת חוקים אחת לכל מחזור: ruleset (id+גרסה),
--      ה-overrides שהיו בתוקף, hash דטרמיניסטי של התוכן המנורמל, מקור.
--   2. טריגר: מחזור שעובר ל-open/locked/live/scoring בלי תמונה → מוקפא עכשיו.
--      תופס כל נתיב (אוטומטי, אדמין, SQL ידני). לא נדרס לעולם.
--   3. מחזורים שכבר פעילים מוקפאים במיגרציה עם source='backfill' (החוקים
--      של היום — לא השתנו מאז שנפתחו). מחזור שפורסם **לא** מקבל תמונה: אין
--      לנו מידע אמין מה היה בתוקף, ואין מנקדים אותו מחדש.
--   4. game.gameweek_rules_for(code) — קריאה ציבורית. הניקוד הרשמי והתצוגה
--      החיה קוראים ממנה; אין תמונה → ההתנהגות הקודמת.
--   5. תיקון חריג באמצע מחזור: game.admin_refreeze_gameweek_rules(code, reason)
--      — אדמין בלבד, רק לפני פרסום, נרשם ביומן הביקורת עם הסיבה.
-- =====================================================================
SET search_path = game, core, public;

BEGIN;

CREATE TABLE IF NOT EXISTS game.gameweek_rules (
  gameweek_id     UUID PRIMARY KEY REFERENCES game.gameweeks(id) ON DELETE CASCADE,
  ruleset_id      UUID REFERENCES game.scoring_rulesets(id),
  ruleset_version INT,
  overrides       JSONB NOT NULL DEFAULT '{}'::jsonb,
  rules_hash      TEXT NOT NULL,
  source          TEXT NOT NULL CHECK (source IN ('open','backfill','amended')),
  frozen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  note            TEXT
);
ALTER TABLE game.gameweek_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON game.gameweek_rules FROM PUBLIC, anon, authenticated;

/* hash דטרמיניסטי: jsonb ממיין מפתחות בעצמו, אז ::text יציב לאותו תוכן */
CREATE OR REPLACE FUNCTION game.rules_hash(p_ruleset_id UUID, p_overrides JSONB)
RETURNS TEXT
LANGUAGE sql STABLE
SET search_path = game, public
AS $$
  SELECT md5(jsonb_build_object(
           'ruleset',   (SELECT jsonb_build_object('version', r.version, 'rules', r.rules)
                           FROM game.scoring_rulesets r WHERE r.id = p_ruleset_id),
           'overrides', COALESCE(p_overrides, '{}'::jsonb))::text);
$$;

CREATE OR REPLACE FUNCTION game.freeze_gameweek_rules(p_gw UUID, p_source TEXT DEFAULT 'open')
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v_league UUID; v_rs game.scoring_rulesets; v_ov JSONB;
BEGIN
  SELECT league_id INTO v_league FROM game.gameweeks WHERE id = p_gw;
  SELECT * INTO v_rs FROM game.scoring_rulesets
   WHERE league_id IS NOT DISTINCT FROM v_league
   ORDER BY version DESC LIMIT 1;
  SELECT COALESCE(jsonb_object_agg(rule_key, points), '{}'::jsonb) INTO v_ov
    FROM game.scoring_overrides;

  INSERT INTO game.gameweek_rules (gameweek_id, ruleset_id, ruleset_version, overrides, rules_hash, source)
  VALUES (p_gw, v_rs.id, v_rs.version, v_ov, game.rules_hash(v_rs.id, v_ov), p_source)
  ON CONFLICT (gameweek_id) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION game.freeze_gameweek_rules(UUID, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION game.trg_freeze_gameweek_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
BEGIN
  IF NEW.status IN ('open','locked','live','scoring')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM game.freeze_gameweek_rules(NEW.id, 'open');
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS freeze_rules ON game.gameweeks;
CREATE TRIGGER freeze_rules AFTER INSERT OR UPDATE OF status ON game.gameweeks
  FOR EACH ROW EXECUTE FUNCTION game.trg_freeze_gameweek_rules();

/* מחזורים פעילים היום — מוקפאים עכשיו. פורסמו → לא נוגעים. */
SELECT game.freeze_gameweek_rules(g.id, 'backfill')
  FROM game.gameweeks g
 WHERE g.status IN ('open','locked','live','scoring')
   AND NOT EXISTS (SELECT 1 FROM game.gameweek_rules r WHERE r.gameweek_id = g.id);

/* ── קריאה ─────────────────────────────────────────────────────────────── */
CREATE OR REPLACE FUNCTION game.gameweek_rules_for(p_gw_code TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
  SELECT jsonb_build_object(
           'gw',             g.code,
           'rulesetId',      r.ruleset_id,
           'rulesetVersion', r.ruleset_version,
           'rules',          (SELECT s.rules FROM game.scoring_rulesets s WHERE s.id = r.ruleset_id),
           'overrides',      r.overrides,
           'hash',           r.rules_hash,
           'source',         r.source,
           'frozenAt',       r.frozen_at)
    FROM game.gameweeks g
    JOIN game.gameweek_rules r ON r.gameweek_id = g.id
   WHERE g.code = p_gw_code;
$$;
REVOKE ALL ON FUNCTION game.gameweek_rules_for(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION game.gameweek_rules_for(TEXT) TO anon, authenticated, service_role;

/* ── תיקון חריג: אדמין, לפני פרסום, עם סיבה, ביומן ──────────────────── */
CREATE OR REPLACE FUNCTION game.admin_refreeze_gameweek_rules(p_gw_code TEXT, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v_gw game.gameweeks; v_old JSONB;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'NOT_ADMIN'; END IF;
  IF COALESCE(length(trim(p_reason)), 0) < 5 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  SELECT * INTO v_gw FROM game.gameweeks WHERE code = p_gw_code;
  IF v_gw.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_gw.status IN ('published','archived') THEN RAISE EXCEPTION 'ALREADY_PUBLISHED'; END IF;

  v_old := game.gameweek_rules_for(p_gw_code);
  DELETE FROM game.gameweek_rules WHERE gameweek_id = v_gw.id;
  PERFORM game.freeze_gameweek_rules(v_gw.id, 'amended');
  UPDATE game.gameweek_rules SET note = p_reason WHERE gameweek_id = v_gw.id;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, old_value, new_value, reason)
  VALUES (game.actor_label(), 'refreeze_gameweek_rules', 'gameweek', p_gw_code,
          v_old, game.gameweek_rules_for(p_gw_code), p_reason);

  RETURN game.gameweek_rules_for(p_gw_code);
END;
$$;
REVOKE ALL ON FUNCTION game.admin_refreeze_gameweek_rules(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION game.admin_refreeze_gameweek_rules(TEXT, TEXT) TO authenticated;

COMMIT;

INSERT INTO game.schema_migrations (version, note) VALUES
  ('58', '★ חוקי ניקוד מוקפאים לכל מחזור (gameweek_rules), נקראים בניקוד הרשמי ובתצוגה החיה')
ON CONFLICT (version) DO NOTHING;
