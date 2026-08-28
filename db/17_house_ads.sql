-- =====================================================================
--  Dubid · מיגרציה 17 — פרסום פנימי (House Ads)
-- =====================================================================
--
--  לחברה שלושה מוצרים על אותו דומיין: דוביד, טייק מי אאוט
--  ואופסיידס. המשתמש שנמצא באחד מהם הוא הקהל הכי זול והכי חם
--  שיש לשניים האחרים — אין עלות רכישה, והאמון כבר קיים.
--
--  המיגרציה הזו נותנת לאדמין שליטה מלאה על מה מוצג, איפה, מתי,
--  ובאיזה משקל — בלי לגעת בקוד.
--
--  ★★ העיקרון: המסד הוא override, לא מקור ★★
--
--  ברירות המחדל חיות בקוד (`lib/houseAds.ts`). טבלה ריקה =
--  בדיוק המוצר של היום. זו אותה החלטה כמו ב-`content` וב-
--  `scoring_rules`, ומאותה סיבה: מיגרציה שלא רצה, או מחיקה
--  בטעות, לא יכולה להשאיר מסך ריק.
--
--  אידמפוטנטי. אפשר להריץ שוב.
-- =====================================================================

SET search_path = game, core, public;

-- ---------------------------------------------------------------------
-- §1 · הטבלה
-- ---------------------------------------------------------------------
--
--  ★ `id` הוא TEXT ולא UUID.
--
--  המזהה נשמר באנליטיקס ומופיע בכתובת שאליה המשתמש לוחץ
--  (`?v=tmo-landed`). מזהה קריא הופך דוח קליקים למשהו שאפשר
--  להסתכל עליו בלי טבלת תרגום. הוא גם מה שמאפשר ל-DEFAULT_ADS
--  שבקוד ולשורות שבמסד לחלוק את אותם מזהים.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS game.house_ads (
  id           TEXT PRIMARY KEY,
  brand        TEXT NOT NULL CHECK (brand IN ('takemeout', 'offsides')),
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  weight       SMALLINT NOT NULL DEFAULT 5 CHECK (weight BETWEEN 1 AND 10),
  headline     TEXT NOT NULL CHECK (length(headline) BETWEEN 1 AND 60),
  body         TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 120),
  cta          TEXT NOT NULL DEFAULT 'להעיף מבט' CHECK (length(cta) BETWEEN 1 AND 24),
  url          TEXT NOT NULL CHECK (url ~ '^https://'),
  -- מערך ריק = בכל המסכים. זה הרוב, ולכן זו ברירת המחדל.
  placements   TEXT[] NOT NULL DEFAULT '{}',
  starts_at    TIMESTAMPTZ,
  ends_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ★ חלון הפוך נחסם במסד ולא רק בטופס.
  --   קמפיין עם תאריכים הפוכים פשוט לא היה מוצג לעולם, וזה
  --   סוג התקלה שמתגלה חודשיים אחרי שהקמפיין "רץ".
  CONSTRAINT house_ads_window CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

COMMENT ON TABLE game.house_ads IS
  'פרסום פנימי בין מוצרי דובל טים. ריק = ברירות המחדל שבקוד.';

ALTER TABLE game.house_ads ENABLE ROW LEVEL SECURITY;

-- ★ אין POLICY בכלל, בכוונה.
--   הגישה עוברת רק דרך הפונקציות שלמטה (SECURITY DEFINER).
--   טבלה עם RLS ובלי מדיניות היא סגורה לחלוטין לכל תפקיד שאינו
--   הבעלים — וזה בדיוק מה שאנחנו רוצים: קריאה מסוננת דרך
--   `house_ads()`, כתיבה רק דרך `admin_*`.

-- ---------------------------------------------------------------------
-- §2 · יומן החשיפות והקליקים
-- ---------------------------------------------------------------------
--
--  ★ למה טבלת אירועים ולא שני מונים על השורה.
--
--  מונה עונה על "כמה". טבלה עונה גם על "איפה", "מתי" ו"באיזה
--  מחזור" — ובלי הפילוח הזה אי אפשר לדעת אם מודעה עובדת בכל
--  מקום או רק בטבלת הדירוג. ההפרש בעלות זניח; ההפרש במידע הוא
--  ההבדל בין דוח לבין מספר.
--
--  ★ בלי מזהה משתמש. בכוונה.
--
--  אנחנו סופרים חשיפות וקליקים, לא אנשים. שמירת `user_id` כאן
--  הייתה הופכת יומן פרסום ליומן מעקב אחרי אנשים, ובשביל שום
--  שאלה שאנחנו באמת שואלים.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS game.ad_events (
  id         BIGSERIAL PRIMARY KEY,
  ad_id      TEXT NOT NULL,
  placement  TEXT NOT NULL,
  event      TEXT NOT NULL CHECK (event IN ('impression', 'click')),
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE game.ad_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS ad_events_ad_at_idx ON game.ad_events (ad_id, at DESC);
CREATE INDEX IF NOT EXISTS ad_events_at_idx    ON game.ad_events (at DESC);

-- ---------------------------------------------------------------------
-- §3 · קריאה ציבורית
-- ---------------------------------------------------------------------
--
--  ★ הסינון קורה **בשרת**.
--
--  מודעה מכובה או מודעה שחלון התצוגה שלה נגמר לא נשלחת לדפדפן
--  בכלל. סינון בקליינט היה אומר שכל קמפיין עתידי — כולל
--  הכותרות שלו — יושב ב-JSON שכל אחד יכול לפתוח.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.house_ads()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',         a.id,
           'brand',      a.brand,
           'enabled',    a.enabled,
           'weight',     a.weight,
           'headline',   a.headline,
           'body',       a.body,
           'cta',        a.cta,
           'url',        a.url,
           'placements', to_jsonb(a.placements),
           'startsAt',   a.starts_at,
           'endsAt',     a.ends_at
         ) ORDER BY a.id), '[]'::jsonb)
  FROM game.house_ads a
  WHERE a.enabled
    AND (a.starts_at IS NULL OR a.starts_at <= now())
    AND (a.ends_at   IS NULL OR a.ends_at   >  now());
$$;

GRANT EXECUTE ON FUNCTION game.house_ads() TO anon, authenticated;

-- ---------------------------------------------------------------------
-- §4 · מדידה
-- ---------------------------------------------------------------------
--
--  ★★ תקרה לכל מודעה בכל דקה — ולמה היא חייבת להיות כאן ★★
--
--  זו פונקציה שכל אנונימי יכול לקרוא לה. בלי תקרה, לולאה של
--  שלוש שורות ממלאת את הטבלה במיליוני שורות תוך דקות: גם חשבון
--  ענן שמתנפח, וגם — הגרוע יותר — דוח קליקים שמשקר, ולכן
--  החלטות שיווקיות שמתקבלות על סמך רעש.
--
--  התקרה היא **לכל מודעה ולכל דקה**, לא גלובלית: מודעה אחת
--  שמוצפת לא משתיקה את המדידה של השאר.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.ad_event(
  p_ad_id TEXT, p_placement TEXT, p_event TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE
  v_recent INT;
  -- 600 חשיפות לדקה למודעה זה הרבה מעל כל תנועה אמיתית שתהיה
  -- לנו, וזה עדיין חוסם הצפה בשלושה סדרי גודל.
  c_cap CONSTANT INT := 600;
BEGIN
  IF p_event NOT IN ('impression', 'click') THEN RETURN; END IF;
  IF p_ad_id IS NULL OR length(p_ad_id) > 64 THEN RETURN; END IF;

  SELECT count(*) INTO v_recent
  FROM game.ad_events
  WHERE ad_id = p_ad_id AND at > now() - INTERVAL '1 minute';

  IF v_recent >= c_cap THEN RETURN; END IF;

  INSERT INTO game.ad_events (ad_id, placement, event)
  VALUES (p_ad_id, COALESCE(NULLIF(left(p_placement, 32), ''), 'unknown'), p_event);
END;
$$;

GRANT EXECUTE ON FUNCTION game.ad_event(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- §5 · ניהול
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.admin_ads()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v JSONB;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  -- ★ האדמין רואה גם מכובות וגם כאלה שמחוץ לחלון — אחרת אי
  --   אפשר להדליק מודעה שכבויה, וזו הפעולה הכי שכיחה כאן.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',         a.id,
           'brand',      a.brand,
           'enabled',    a.enabled,
           'weight',     a.weight,
           'headline',   a.headline,
           'body',       a.body,
           'cta',        a.cta,
           'url',        a.url,
           'placements', to_jsonb(a.placements),
           'startsAt',   a.starts_at,
           'endsAt',     a.ends_at,
           'impressions', COALESCE(s.impressions, 0),
           'clicks',      COALESCE(s.clicks, 0)
         ) ORDER BY a.brand, a.id), '[]'::jsonb)
  INTO v
  FROM game.house_ads a
  LEFT JOIN (
    SELECT ad_id,
           count(*) FILTER (WHERE event = 'impression') AS impressions,
           count(*) FILTER (WHERE event = 'click')      AS clicks
    FROM game.ad_events
    GROUP BY ad_id
  ) s ON s.ad_id = a.id;

  RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_ads() TO authenticated;

CREATE OR REPLACE FUNCTION game.admin_upsert_ad(
  p_id TEXT, p_brand TEXT, p_headline TEXT, p_body TEXT, p_cta TEXT,
  p_url TEXT, p_weight INT DEFAULT 5, p_enabled BOOLEAN DEFAULT TRUE,
  p_placements TEXT[] DEFAULT '{}', p_starts_at TIMESTAMPTZ DEFAULT NULL,
  p_ends_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_id TEXT;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  -- ★ מזהה נורמלי, ולא מה שהוקלד.
  --   הוא מופיע בכתובת URL ובדוחות. רווח או עברית בתוך
  --   `?v=` הופכים כל דוח לבלגן של תווים מקודדים.
  -- ★★ `lower` **לפני** ה-regex, ולא אחריו. ★★
  --
  --   הסדר ההפוך נראה זהה והוא באג: המחלקה `[^a-z0-9-]` לא
  --   כוללת אותיות גדולות, ולכן היא מחליפה אותן במקף. "Test Ad"
  --   הפך ל-"est-d" — מזהה קצוץ, בלי שום שגיאה, שנכנס לכתובת
  --   ולדוחות ונשאר שם.
  v_id := regexp_replace(lower(COALESCE(NULLIF(trim(p_id), ''), gen_random_uuid()::TEXT)),
                         '[^a-z0-9-]+', '-', 'g');
  v_id := left(trim(BOTH '-' FROM v_id), 40);
  IF v_id = '' THEN RAISE EXCEPTION 'BAD_AD_ID'; END IF;

  INSERT INTO game.house_ads
    (id, brand, enabled, weight, headline, body, cta, url, placements, starts_at, ends_at)
  VALUES
    (v_id, p_brand, COALESCE(p_enabled, TRUE), COALESCE(p_weight, 5),
     trim(p_headline), COALESCE(trim(p_body), ''), COALESCE(NULLIF(trim(p_cta), ''), 'להעיף מבט'),
     trim(p_url), COALESCE(p_placements, '{}'), p_starts_at, p_ends_at)
  ON CONFLICT (id) DO UPDATE SET
    brand      = EXCLUDED.brand,
    enabled    = EXCLUDED.enabled,
    weight     = EXCLUDED.weight,
    headline   = EXCLUDED.headline,
    body       = EXCLUDED.body,
    cta        = EXCLUDED.cta,
    url        = EXCLUDED.url,
    placements = EXCLUDED.placements,
    starts_at  = EXCLUDED.starts_at,
    ends_at    = EXCLUDED.ends_at,
    updated_at = now();

  PERFORM game.log_activity(auth.uid(), 'ad_upsert', NULL, NULL, v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_upsert_ad(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, BOOLEAN, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ
) TO authenticated;

CREATE OR REPLACE FUNCTION game.admin_set_ad_enabled(p_id TEXT, p_enabled BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  UPDATE game.house_ads SET enabled = p_enabled, updated_at = now() WHERE id = p_id;
  PERFORM game.log_activity(
    auth.uid(), CASE WHEN p_enabled THEN 'ad_on' ELSE 'ad_off' END, NULL, NULL, p_id);
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_set_ad_enabled(TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION game.admin_delete_ad(p_id TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  DELETE FROM game.house_ads WHERE id = p_id;

  -- ★ האירועים **לא** נמחקים.
  --   דוח של רבעון שעבר לא אמור להשתנות כי מודעה נמחקה היום.
  --   מחיקה שמשכתבת היסטוריה היא מחיקה שאי אפשר לסמוך על
  --   המספרים שאחריה.
  PERFORM game.log_activity(auth.uid(), 'ad_delete', NULL, NULL, p_id);
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_delete_ad(TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- §6 · דוח ביצועים
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.admin_ad_stats(p_days INT DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v JSONB; v_since TIMESTAMPTZ;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  v_since := now() - (GREATEST(1, LEAST(365, COALESCE(p_days, 30))) || ' days')::INTERVAL;

  SELECT jsonb_build_object(
    'days', GREATEST(1, LEAST(365, COALESCE(p_days, 30))),
    'impressions', COALESCE(count(*) FILTER (WHERE event = 'impression'), 0),
    'clicks',      COALESCE(count(*) FILTER (WHERE event = 'click'), 0),
    'byPlacement', COALESCE((
      SELECT jsonb_agg(x ORDER BY x->>'placement')
      FROM (
        SELECT jsonb_build_object(
                 'placement', placement,
                 'impressions', count(*) FILTER (WHERE event = 'impression'),
                 'clicks',      count(*) FILTER (WHERE event = 'click')
               ) AS x
        FROM game.ad_events WHERE at >= v_since
        GROUP BY placement
      ) t), '[]'::jsonb)
  ) INTO v
  FROM game.ad_events WHERE at >= v_since;

  RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION game.admin_ad_stats(INT) TO authenticated;

-- ---------------------------------------------------------------------
-- §7 · זרעים
-- ---------------------------------------------------------------------
--
--  ★ `ON CONFLICT DO NOTHING`, ולא `DO UPDATE`.
--
--  אם האדמין ערך את הכותרת של מודעת ברירת המחדל, הרצה חוזרת של
--  המיגרציה **לא** תדרוס אותה. מיגרציה אידמפוטנטית שמשחזרת
--  טקסט שיווקי היא מיגרציה שמוחקת עבודה.
-- ---------------------------------------------------------------------

INSERT INTO game.house_ads (id, brand, weight, headline, body, cta, url) VALUES
  ('tmo-landed', 'takemeout', 5,
   'נחתתם בעיר זרה. עכשיו מה?',
   'מה לראות, מה לאכול ומה לדלג עליו — בעיר שאתם לא מכירים.',
   'לבחור עיר', 'https://takemeout.dubelteam.com'),
  ('tmo-locals', 'takemeout', 4,
   'התייר רואה חמישה מקומות. המקומי יודע חמישים',
   'אתונה, ברלין, פריז, סופיה — הרשימה שהמקומיים היו נותנים.',
   'לפתוח את הרשימה', 'https://takemeout.dubelteam.com'),
  ('ofs-live', 'offsides', 5,
   'כאן מחכים שבוע. שם — תשעים דקות',
   'אותם משחקים, ניחושים בזמן אמת, זירות מול החברים שלכם.',
   'להיכנס לזירה', 'https://offsides.dubelteam.com'),
  ('ofs-account', 'offsides', 4,
   'אותו חשבון. בלי הרשמה מחדש',
   'המוצר השני שלנו, על אותם משחקים — נכנסים ומתחילים.',
   'להעיף מבט', 'https://offsides.dubelteam.com')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- §8 · מונה הגרסה
-- ---------------------------------------------------------------------
--  כל שאר המסכים כבר מקשיבים לו; מודעה חדשה מגיעה לכל המכשירים
--  באותו מנגנון בדיוק, בלי ערוץ שני.
-- ---------------------------------------------------------------------

UPDATE game.data_revision
   SET revision = revision + 1, scope = 'migration-17', updated_at = now()
 WHERE id = 1;
