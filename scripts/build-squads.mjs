/**
 * build-squads.mjs — הופך את קובץ הסגלים ל-3 תוצרים:
 *
 *   src/data/squads.ts        — הדאטה שהאפליקציה עובדת מולו (בלי DB)
 *   db/03_seed_squads.sql     — סיד אידמפוטנטי ל-PostgreSQL/Supabase
 *   scripts/squads.report.md  — דוח איכות נתונים
 *
 * הרצה:  npm run build:squads
 *
 * הקובץ הזה קיים כדי שהסגלים לא יהיו "מודבקים" בקוד. מעדכנים את
 * squads.source.json, מריצים, וכל התוצרים מסונכרנים.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const POSITION_MAP = { GK: 'GK', DF: 'DEF', MF: 'MID', FW: 'FWD' };

/** קיצורים לתצוגה ברצועת כיסוי הקבוצות (רוחב 42px במובייל) */
const SHORT = {
  'Maccabi Haifa': 'מ״ח',
  'Maccabi Tel Aviv': 'מת״א',
  'Hapoel Beer Sheva': 'הב״ש',
  'Beitar Jerusalem': 'בי״ר',
  'Hapoel Tel Aviv': 'הת״א',
  'Maccabi Netanya': 'מ״נ',
  'Bnei Sakhnin': 'סכ',
  'Hapoel Haifa': 'ה״ח',
  'Ironi Kiryat Shmona': 'ק״ש',
  'Ironi Tiberias': 'טב',
  'Hapoel Hadera': 'חד',
  'Hapoel Petah Tikva': 'פ״ת',
  'Maccabi Bnei Reina': 'רי',
  'FC Ashdod': 'אש',
};

const HEBREW = /[֐-׿]/;
const ARABIC = /[؀-ۿ]/;
const LATIN = /[A-Za-z]/;

const src = JSON.parse(readFileSync(join(HERE, 'squads.source.json'), 'utf8'));

/* שחקנים שמדורגים בקובץ העבודה אך לא מופיעים באף סגל. נכתב על ידי
   import-ratings.py. לא שגיאה קטלנית — אבל חייב להיות גלוי. */
let orphanRatings = [];
try {
  orphanRatings = JSON.parse(readFileSync(join(HERE, 'ratings.orphans.json'), 'utf8'));
} catch { /* הסקריפט לא רץ עדיין */ }

/* ------------------------------------------------------------------ */
/* 1. בדיקות איכות — מדווחות, לא "מתוקנות" בשקט                        */
/* ------------------------------------------------------------------ */
const issues = [];
const seenPlayerIds = new Set();
const MIN_PER_POSITION = { GK: 1, DEF: 2, MID: 2, FWD: 1 };

for (const team of src.teams) {
  const counts = { GK: 0, DEF: 0, MID: 0, FWD: 0 };

  for (const p of team.players) {
    const pos = POSITION_MAP[p.position];
    if (!pos) issues.push(`עמדה לא מוכרת "${p.position}" · ${p.name_he} (#${p.id})`);
    else counts[pos]++;

    if (seenPlayerIds.has(p.id)) issues.push(`מזהה שחקן כפול: ${p.id}`);
    seenPlayerIds.add(p.id);

    if (ARABIC.test(p.name_he)) {
      issues.push(`אותיות ערביות בתוך name_he: "${p.name_he}" (#${p.id}) — כנראה שגיאת קלט`);
    }
    if (!HEBREW.test(p.name_he)) issues.push(`name_he ללא עברית: "${p.name_he}" (#${p.id})`);
    if (!LATIN.test(p.name_en)) issues.push(`name_en ללא לטינית: "${p.name_en}" (#${p.id})`);
  }

  const numbers = team.players.map((p) => p.number).filter((n) => n != null);
  const dupes = numbers.filter((n, i) => numbers.indexOf(n) !== i);
  if (dupes.length) issues.push(`${team.name_he}: מספרי חולצה כפולים ${[...new Set(dupes)].join(', ')}`);

  for (const [pos, min] of Object.entries(MIN_PER_POSITION)) {
    if (counts[pos] < min) {
      issues.push(`${team.name_he}: רק ${counts[pos]} ב-${pos} (מינימום סביר ${min})`);
    }
  }
  if (team.players.length < 11) {
    issues.push(`${team.name_he}: ${team.players.length} שחקנים בלבד — סגל חלקי`);
  }
}

/* כיסוי דירוגים — לא "בעיה", אבל חייב להיות גלוי: שחקן לא מדורג
   מתומחר ברצפת הקובץ (1M), ולכן זול מדי או יקר מדי בהכרח. */
const ratedCount = src.teams.reduce(
  (n, t) => n + t.players.filter((p) => p.rated).length, 0);
const totalCount = src.teams.reduce((n, t) => n + t.players.length, 0);

for (const name of orphanRatings) {
  issues.push(`מדורג בקובץ העבודה אך לא נמצא באף סגל: ${name}`);
}

const IL_PREMIER_FULL = 14;
if (src.teams.length < IL_PREMIER_FULL) {
  issues.unshift(
    `בקובץ ${src.teams.length} קבוצות מתוך ${IL_PREMIER_FULL} בליגת העל. ` +
    `עם הכלל "שחקן אחד מכל קבוצה" אי אפשר להרכיב 11 — צריך לפחות 11 קבוצות.`,
  );
}

/* ------------------------------------------------------------------ */
/* 2. src/data/squads.ts                                              */
/* ------------------------------------------------------------------ */
const teams = src.teams.map((t) => ({
  id: `T${t.team_id}`,
  externalId: String(t.team_id),
  nameHe: t.name_he,
  nameEn: t.name_en,
  short: t.short ?? SHORT[t.name_en] ?? t.name_he.split(' ').map((w) => w[0]).join(''),
  city: t.city ?? null,
  stadium: t.stadium ?? null,
}));

const players = src.teams.flatMap((t) =>
  t.players.map((p) => ({
    id: `P${p.id}`,
    externalId: String(p.id),
    teamId: `T${t.team_id}`,
    position: POSITION_MAP[p.position] ?? 'MID',
    nameHe: p.name_he,
    nameEn: p.name_en,
    shirt: p.number ?? null,
    // דרג ושווי משחק — אופציונליים במקור; ברירת מחדל ניטרלית אם חסר.
    tier: p.tier ?? 5,
    price: p.price ?? 1,
    // מקור: גיליון "דירוגים" בקובץ העבודה של הליגה.
    // overallRank = null אומר "לא מדורג בקובץ", לא "גרוע".
    overallRank: p.overall_rank ?? null,
    rated: p.rated === true,
    nationality: p.nationality ?? null,
    isClubCaptain: p.is_club_captain === true,
  })),
);

const ts = `/**
 * src/data/squads.ts — נוצר אוטומטית מ-scripts/squads.source.json.
 * אל תערכו ידנית. עדכנו את ה-JSON והריצו: npm run build:squads
 *
 * נוצר: מ-${src.teams.length} קבוצות · ${players.length} שחקנים · עונת ${src.league.season}
 */
import type { Position } from '../lib/scoring/types.ts';

export interface TeamRow {
  id: string;
  externalId: string;
  nameHe: string;
  nameEn: string;
  short: string;
  city: string | null;
  stadium: string | null;
}

export interface PlayerRow {
  id: string;
  externalId: string;
  teamId: string;
  position: Position;
  nameHe: string;
  nameEn: string;
  shirt: number | null;
  /** דרג 1 (עילית) עד 5 — לתצוגה וסינון בלבד, לא משפיע על הניקוד. */
  tier: 1 | 2 | 3 | 4 | 5;
  /**
   * שווי משחק במיליוני יורו (1–5), נאמן לגיליון "דירוגים".
   * ★ בדוביד 5 זהו אילוץ חוסם: 5 שחקנים בתקציב DUBID_5X5_BUDGET.
   */
  price: number;
  /** מיקום בדירוג הכולל של הליגה (1 = הטוב ביותר). null = לא מדורג בקובץ. */
  overallRank: number | null;
  /** האם השחקן מופיע בגיליון הדירוגים. false = תומחר ברצפת הקובץ. */
  rated: boolean;
  nationality: string | null;
  /** קפטן המועדון במציאות — טעם ורקע, לא קשור לקפטן הדובידי. */
  isClubCaptain: boolean;
}

export const LEAGUE = ${JSON.stringify(
  { code: 'IL_PREMIER', nameHe: src.league.name_he, nameEn: src.league.name_en, season: src.league.season },
  null, 2,
)} as const;

/** מספר הקבוצות בליגת העל במציאות. מכאן נגזר החסם על גודל ההרכב. */
export const LEAGUE_TEAM_COUNT_REAL = ${IL_PREMIER_FULL};

export const TEAMS: TeamRow[] = ${JSON.stringify(teams, null, 2)};

export const PLAYERS: PlayerRow[] = ${JSON.stringify(players, null, 2)};

/** שם קצר לתצוגה בכרטיס שחקן: שם משפחה בלבד. */
export function shortName(nameHe: string): string {
  const parts = nameHe.trim().split(/\\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : nameHe;
}

export const TEAM_BY_ID = new Map(TEAMS.map((t) => [t.id, t]));
export const PLAYERS_BY_TEAM = TEAMS.map((t) => ({
  team: t,
  players: PLAYERS.filter((p) => p.teamId === t.id),
}));
`;

mkdirSync(join(ROOT, 'src/data'), { recursive: true });
writeFileSync(join(ROOT, 'src/data/squads.ts'), ts);

/* ------------------------------------------------------------------ */
/* 3. db/03_seed_squads.sql                                           */
/* ------------------------------------------------------------------ */
const sql = `-- =====================================================================
--  Dubid · מיגרציה 03 — סיד סגלי ליגת העל
--  נוצר אוטומטית מ-scripts/squads.source.json (npm run build:squads).
--  אידמפוטנטי: אפשר להריץ שוב אחרי עדכון הקובץ, ורק מה שהשתנה יתעדכן.
--  המיפוי לישויות נשמר ב-core.external_refs עם provider='manual_json',
--  כך שסנכרון עתידי מ-API לא ייצור כפילויות.
-- =====================================================================

SET search_path = core, game, public;

DO $seed$
DECLARE
  payload  JSONB := $json$${JSON.stringify(src)}$json$;
  v_league UUID;
  v_season UUID;
  t        JSONB;
  p        JSONB;
  v_team   UUID;
  v_player UUID;
  v_pos    core.position;
BEGIN
  ----------------------------------------------------------------- ליגה
  INSERT INTO core.leagues (code, country_code, default_locale, timezone, names, squad_size)
  VALUES ('IL_PREMIER', 'IL', 'he', 'Asia/Jerusalem',
          jsonb_build_object(
            'he', jsonb_build_object('full', payload->'league'->>'name_he'),
            'en', jsonb_build_object('full', payload->'league'->>'name_en')),
          11)
  ON CONFLICT (code) DO UPDATE SET names = EXCLUDED.names
  RETURNING id INTO v_league;

  INSERT INTO core.external_refs (provider, entity_type, external_id, entity_id)
  VALUES ('manual_json', 'league', payload->'league'->>'id', v_league)
  ON CONFLICT (provider, entity_type, external_id)
  DO UPDATE SET entity_id = EXCLUDED.entity_id, synced_at = now();

  ----------------------------------------------------------------- עונה
  INSERT INTO core.seasons (league_id, label, starts_on, ends_on, is_current)
  VALUES (v_league, payload->'league'->>'season', DATE '2026-08-01', DATE '2027-05-30', TRUE)
  ON CONFLICT (league_id, label) DO UPDATE SET is_current = TRUE
  RETURNING id INTO v_season;

  ---------------------------------------------------------------- קבוצות
  FOR t IN SELECT * FROM jsonb_array_elements(payload->'teams') LOOP
    SELECT entity_id INTO v_team FROM core.external_refs
     WHERE provider = 'manual_json' AND entity_type = 'team'
       AND external_id = t->>'team_id';

    IF v_team IS NULL THEN
      INSERT INTO core.teams (country_code, names, short_code)
      VALUES ('IL',
              jsonb_build_object(
                'he', jsonb_build_object('full', t->>'name_he'),
                'en', jsonb_build_object('full', t->>'name_en')),
              left(t->>'name_en', 3))
      RETURNING id INTO v_team;

      INSERT INTO core.external_refs (provider, entity_type, external_id, entity_id, payload)
      VALUES ('manual_json', 'team', t->>'team_id', v_team, t - 'players');
    ELSE
      -- מיזוג ולא דריסה: עברית שהוזנה ידנית לא נמחקת
      UPDATE core.teams
         SET names = names || jsonb_build_object(
               'he', jsonb_build_object('full', t->>'name_he'),
               'en', jsonb_build_object('full', t->>'name_en'))
       WHERE id = v_team;
    END IF;

    INSERT INTO core.team_seasons (team_id, season_id)
    VALUES (v_team, v_season) ON CONFLICT DO NOTHING;

    INSERT INTO core.entity_aliases (entity_type, entity_id, locale, alias, source)
    VALUES ('team', v_team, 'he', t->>'name_he', 'manual_json'),
           ('team', v_team, 'en', t->>'name_en', 'manual_json')
    ON CONFLICT DO NOTHING;

    -------------------------------------------------------------- שחקנים
    FOR p IN SELECT * FROM jsonb_array_elements(t->'players') LOOP
      v_pos := CASE p->>'position'
                 WHEN 'GK' THEN 'GK'
                 WHEN 'DF' THEN 'DEF'
                 WHEN 'MF' THEN 'MID'
                 WHEN 'FW' THEN 'FWD'
                 ELSE 'MID'
               END::core.position;

      SELECT entity_id INTO v_player FROM core.external_refs
       WHERE provider = 'manual_json' AND entity_type = 'player'
         AND external_id = p->>'id';

      IF v_player IS NULL THEN
        INSERT INTO core.players (names, nationality, primary_position)
        VALUES (jsonb_build_object(
                  'he', jsonb_build_object('full', p->>'name_he'),
                  'en', jsonb_build_object('full', p->>'name_en')),
                'IL', v_pos)
        RETURNING id INTO v_player;

        INSERT INTO core.external_refs (provider, entity_type, external_id, entity_id, payload)
        VALUES ('manual_json', 'player', p->>'id', v_player, p);
      ELSE
        UPDATE core.players
           SET names = names || jsonb_build_object(
                 'he', jsonb_build_object('full', p->>'name_he'),
                 'en', jsonb_build_object('full', p->>'name_en')),
               primary_position = v_pos,
               updated_at = now()
         WHERE id = v_player;
      END IF;

      INSERT INTO core.entity_aliases (entity_type, entity_id, locale, alias, source)
      VALUES ('player', v_player, 'he', p->>'name_he', 'manual_json'),
             ('player', v_player, 'en', p->>'name_en', 'manual_json')
      ON CONFLICT DO NOTHING;

      -- ★ \`fantasy_price\` — היה חסר, וזה ביטל את התקציב בשרת.
      --
      --   ה-payload תמיד הכיל \`price\`, אבל ה-INSERT לא מיפה אותו.
      --   התוצאה: \`fantasy_price\` היה NULL ל-351 השחקנים, ו-
      --   \`submit_entry\` שקורא \`COALESCE(sq.fantasy_price, 0)\`
      --   תמחר כל הרכב ב-0. כלומר תקציב דוביד 5 נאכף **רק
      --   בדפדפן** — ומי ששלח בקשה ישירות יכול היה לקחת חמישה
      --   שחקנים במחיר מלא.
      --
      --   הבאג לא נראה בשום מסך: הממשק מחשב מחיר מ-\`data/squads.ts\`
      --   ומציג את הפס הנכון. רק השרת לא ידע.
      --
      --   ★★ והתיקון הזה נדרס פעם אחת: הוא נעשה ידנית ב-
      --      db/03_seed_squads.sql, בזמן שהקובץ הזה **מייצר** אותו.
      --      ההרצה הבאה של הסקריפט החזירה את הבאג. לכן הוא חי
      --      כאן עכשיו, במחולל, ולא בתוצר.
      INSERT INTO core.squads (season_id, team_id, player_id, shirt_number, position,
                               fantasy_price, valid_from)
      VALUES (v_season, v_team, v_player, (p->>'number')::smallint, v_pos,
              NULLIF(p->>'price', '')::NUMERIC, DATE '2026-08-01')
      ON CONFLICT (season_id, team_id, player_id, valid_from)
      DO UPDATE SET shirt_number  = EXCLUDED.shirt_number,
                    position      = EXCLUDED.position,
                    -- מחיר שנקבע ידנית באדמין מנצח את הסיד.
                    fantasy_price = COALESCE(core.squads.fantasy_price,
                                             EXCLUDED.fantasy_price),
                    status        = 'active',
                    valid_to      = NULL;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'סיד הושלם: % קבוצות, % שחקנים',
    jsonb_array_length(payload->'teams'),
    (SELECT count(*) FROM core.squads WHERE season_id = v_season);
END
$seed$;

-- ---------------------------------------------------------------------
-- בדיקת שפיות: כמה קבוצות יש, וכמה צריך כדי להרכיב 11 עם שחקן אחד לקבוצה
-- ---------------------------------------------------------------------
DO $check$
DECLARE
  v_teams SMALLINT;
  v_need  SMALLINT;
BEGIN
  SELECT count(*) INTO v_teams
  FROM core.team_seasons ts
  JOIN core.seasons s ON s.id = ts.season_id AND s.is_current
  JOIN core.leagues l ON l.id = s.league_id AND l.code = 'IL_PREMIER';

  SELECT squad_size INTO v_need FROM core.leagues WHERE code = 'IL_PREMIER';

  IF v_teams < v_need THEN
    RAISE WARNING
      'יש % קבוצות בעונה הנוכחית אבל ההרכב דורש % שחקנים משוֹנות. חסרות % קבוצות.',
      v_teams, v_need, v_need - v_teams;
  END IF;
END
$check$;
`;

writeFileSync(join(ROOT, 'db/03_seed_squads.sql'), sql);

/* ------------------------------------------------------------------ */
/* 4. דוח                                                              */
/* ------------------------------------------------------------------ */
const byPos = players.reduce((acc, p) => ((acc[p.position] = (acc[p.position] ?? 0) + 1), acc), {});
const report = `# דוח איכות נתונים — סגלי ליגת העל

נוצר אוטומטית מ-\`scripts/squads.source.json\`.

| מדד | ערך |
|---|---|
| קבוצות בקובץ | ${src.teams.length} |
| קבוצות בליגת העל במציאות | ${IL_PREMIER_FULL} |
| שחקנים | ${players.length} |
| שוערים / מגנים / קשרים / חלוצים | ${byPos.GK ?? 0} / ${byPos.DEF ?? 0} / ${byPos.MID ?? 0} / ${byPos.FWD ?? 0} |
| עונה | ${src.league.season} |
| שחקנים מדורגים בקובץ העבודה | ${ratedCount} / ${totalCount} (${Math.round((ratedCount / totalCount) * 100)}%) |

## כיסוי תמחור

מקור השווי הוא גיליון **דירוגים** בקובץ העבודה של הליגה.
${totalCount - ratedCount} שחקנים אינם מופיעים שם ולכן תומחרו ברצפת הקובץ — דרג 5 · 1M€.
זו החלטה מודעת ולא ברירת מחדל שקטה: \`rated: false\` בכל אחד מהם, וה-Admin
יכול לעדכן שווי בלי לגעת בקוד.

| שווי (מ׳ €) | שחקנים |
|---|---|
${[...new Set(players.map((p) => p.price))].sort((a, b) => b - a).map((v) => `| ${v} | ${players.filter((p) => p.price === v).length} |`).join('\n')}

## ${issues.length} ממצאים

${issues.map((i) => `- ${i}`).join('\n') || '- אין'}

## קבוצות בקובץ

${src.teams.map((t) => `- **${t.name_he}** (${t.name_en}) — ${t.players.length} שחקנים · ${t.stadium ?? '—'}`).join('\n')}
`;

writeFileSync(join(HERE, 'squads.report.md'), report);

console.log(`✓ src/data/squads.ts        (${teams.length} קבוצות, ${players.length} שחקנים)`);
console.log(`✓ db/03_seed_squads.sql`);
console.log(`✓ scripts/squads.report.md  (${issues.length} ממצאים)`);
if (issues.length) {
  console.log('\nממצאים:');
  for (const i of issues) console.log('  · ' + i);
}
