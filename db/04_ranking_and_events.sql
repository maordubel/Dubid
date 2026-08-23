-- =====================================================================
--  Dubid · מיגרציה 04 — דירוג דטרמיניסטי + לוג אירועים
--
--  שני שינויים, שניהם additive. אין DROP, אין שינוי טיפוס, ואין
--  נגיעה בעמודה קיימת — מיגרציה שאפשר להריץ על production חי.
--
--  1. lineup_scores — נקודות דיפרנציאל ותיעוד שובר השוויון.
--  2. core.match_events — הלוג הקנוני, append-only.
-- =====================================================================

SET search_path = core, game, public;

-- ---------------------------------------------------------------------
-- 1. דירוג
-- ---------------------------------------------------------------------
ALTER TABLE game.lineup_scores
  ADD COLUMN IF NOT EXISTS differential_points NUMERIC(8,2) NOT NULL DEFAULT 0,
  -- האם השוויון נשאר בלתי פתור גם אחרי כל שוברי השוויון.
  ADD COLUMN IF NOT EXISTS tied                BOOLEAN NOT NULL DEFAULT FALSE,
  -- באיזה שלב נשבר השוויון. NULL = לא היה שוויון.
  -- נשמר כדי שהמסך יוכל לומר "הוכרע לפי הקפטן" ולא להשאיר את
  -- המשתמש בלי הסבר למה הוא מתחת למישהו עם אותו ניקוד בדיוק.
  ADD COLUMN IF NOT EXISTS tie_broken_by       TEXT;

ALTER TABLE game.lineup_scores
  DROP CONSTRAINT IF EXISTS lineup_scores_tie_broken_by_check;
ALTER TABLE game.lineup_scores
  ADD CONSTRAINT lineup_scores_tie_broken_by_check
  CHECK (tie_broken_by IS NULL OR tie_broken_by IN (
    'total','captain','differential','goals',
    'assists','clean_sheets','other','submitted_at'
  ));

-- דירוג נקרא הרבה יותר משהוא נכתב.
CREATE INDEX IF NOT EXISTS lineup_scores_gw_rank_idx
  ON game.lineup_scores (gameweek_id, rank);

-- ---------------------------------------------------------------------
-- 2. לוג האירועים
-- ---------------------------------------------------------------------
-- ★ הטבלה הזו היא מקור האמת של "מה קרה במגרש".
--   כל מצב משחק קורא ממנה ומפרש בעצמו. אין טבלה שנייה.
CREATE TABLE IF NOT EXISTS core.match_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id    UUID NOT NULL REFERENCES core.weekly_matches(id) ON DELETE CASCADE,
  gameweek_id   UUID NOT NULL REFERENCES game.gameweeks(id) ON DELETE CASCADE,

  -- ★ הסדר הקנוני. ייחודי למשחק, ולא תלוי בשעון.
  seq           INTEGER NOT NULL,

  kind          TEXT NOT NULL,
  phase         TEXT NOT NULL CHECK (phase IN ('1H','2H','ET1','ET2','PENS')),
  minute        SMALLINT NOT NULL CHECK (minute BETWEEN 0 AND 130),
  stoppage      SMALLINT NOT NULL DEFAULT 0,

  team_id       UUID NOT NULL REFERENCES core.teams(id),
  player_id     UUID REFERENCES core.players(id),
  related_player_id UUID REFERENCES core.players(id),

  source        TEXT NOT NULL CHECK (source IN ('provider','admin','correction','derived')),
  confidence    TEXT NOT NULL DEFAULT 'verified'
                CHECK (confidence IN ('verified','provisional')),

  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- תיקונים: מצביעים על אירוע קודם. לעולם לא מוחקים שורה.
  target_seq    INTEGER,
  correction    TEXT CHECK (correction IN ('void','replace')),
  reason        TEXT,

  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (fixture_id, seq),

  -- אירוע תיקון חייב מטרה; אירוע רגיל אסור לו מטרה.
  CONSTRAINT match_events_correction_shape CHECK (
    (kind = 'correction' AND target_seq IS NOT NULL AND correction IS NOT NULL)
    OR
    (kind <> 'correction' AND target_seq IS NULL AND correction IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS match_events_fixture_seq_idx
  ON core.match_events (fixture_id, seq);
CREATE INDEX IF NOT EXISTS match_events_gameweek_idx
  ON core.match_events (gameweek_id);
CREATE INDEX IF NOT EXISTS match_events_player_idx
  ON core.match_events (player_id) WHERE player_id IS NOT NULL;

-- ★ append-only, נאכף במסד ולא בנימוס.
--   בלי זה, "ההיסטוריה נשמרת" היא הבטחה ולא תכונה.
CREATE OR REPLACE FUNCTION core.match_events_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'core.match_events היא append-only. לביטול אירוע יש להוסיף שורת correction.';
END;
$$;

DROP TRIGGER IF EXISTS match_events_no_update ON core.match_events;
CREATE TRIGGER match_events_no_update
  BEFORE UPDATE OR DELETE ON core.match_events
  FOR EACH ROW EXECUTE FUNCTION core.match_events_append_only();

-- ---------------------------------------------------------------------
-- 3. יומן ביקורת לשינויי אדמין
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game.audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor       TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   TEXT,
  action      TEXT NOT NULL,
  old_value   JSONB,
  new_value   JSONB,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_entity_idx
  ON game.audit_logs (entity, entity_id, created_at DESC);
