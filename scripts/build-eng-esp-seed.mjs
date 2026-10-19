#!/usr/bin/env node
/**
 * scripts/build-eng-esp-seed.mjs — מחולל db/45_seed_england.sql ו-db/46_seed_spain.sql
 *
 * מקור: scripts/eng-esp.source.json (חבילת המחקר 19.10.2026: 1,165 שחקנים,
 * 40 קבוצות, מחיר 1–5 לפי אחוזון שווי שוק לכל ליגה בנפרד). אידמפוטנטי.
 *
 * מזהים חיצוניים (provider='manual_json'), אותה שיטה כמו יוון:
 *   קבוצה  = 20000 + מזהה FotMob של המועדון
 *   שחקן   = 30_000_000 + מזהה FotMob; למי שאין לו — 35_000_000 + crc32(player_id) % 4M
 * שמות שחקנים: אנגלית בלבד (לא ממציאים תעתיק). שמות מועדונים: שלוש שפות.
 * מחיר שנקבע ידנית באדמין מנצח את הסיד (COALESCE בעדכון).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const rows = JSON.parse(readFileSync(join(here, 'eng-esp.source.json'), 'utf8'));
const greece = JSON.parse(readFileSync(join(here, 'greece.source.json'), 'utf8'));

const LEAGUES = {
  EN_PL: {
    file: '45_seed_england.sql', num: '45', country: 'GB', tz: 'Europe/London', season: '2026/27',
    he: 'הפרמיירליג', en: 'Premier League', el: 'Πρέμιερ Λιγκ', label: 'England',
    clubs: {
      'afc-bournemouth':     [8678,  'בורנמות\'',        'Μπόρνμουθ',              'BOU'],
      'arsenal':             [9825,  'ארסנל',            'Άρσεναλ',                'ARS'],
      'aston-villa':         [10252, 'אסטון וילה',       'Άστον Βίλα',             'AVL'],
      'brentford':           [9937,  'ברנטפורד',         'Μπρέντφορντ',            'BRE'],
      'brighton-hove-albion':[10204, 'ברייטון',          'Μπράιτον',               'BHA'],
      'chelsea':             [8455,  'צ\'לסי',           'Τσέλσι',                 'CHE'],
      'coventry-city':       [8669,  'קובנטרי סיטי',     'Κόβεντρι Σίτι',          'COV'],
      'crystal-palace':      [9826,  'קריסטל פאלאס',     'Κρίσταλ Πάλας',          'CRY'],
      'everton':             [8668,  'אברטון',           'Έβερτον',                'EVE'],
      'fulham':              [9879,  'פולהאם',           'Φούλαμ',                 'FUL'],
      'hull-city':           [8667,  'האל סיטי',         'Χαλ Σίτι',               'HUL'],
      'ipswich-town':        [9902,  'איפסוויץ\' טאון',  'Ίπσουιτς Τάουν',         'IPS'],
      'leeds-united':        [8463,  'לידס יונייטד',     'Λιντς Γιουνάιτεντ',      'LEE'],
      'liverpool':           [8650,  'ליברפול',          'Λίβερπουλ',              'LIV'],
      'manchester-city':     [8456,  'מנצ\'סטר סיטי',    'Μάντσεστερ Σίτι',        'MCI'],
      'manchester-united':   [10260, 'מנצ\'סטר יונייטד', 'Μάντσεστερ Γιουνάιτεντ', 'MUN'],
      'newcastle-united':    [10261, 'ניוקאסל יונייטד',  'Νιούκαστλ Γιουνάιτεντ',  'NEW'],
      'nottingham-forest':   [10203, 'נוטינגהאם פורסט',  'Νότιγχαμ Φόρεστ',        'NFO'],
      'sunderland':          [8472,  'סנדרלנד',          'Σάντερλαντ',             'SUN'],
      'tottenham-hotspur':   [8586,  'טוטנהאם',          'Τότεναμ',                'TOT'],
    },
  },
  ES_LALIGA: {
    file: '46_seed_spain.sql', num: '46', country: 'ES', tz: 'Europe/Madrid', season: '2026/27',
    he: 'לה ליגה', en: 'La Liga', el: 'Λα Λίγκα', label: 'Spain',
    clubs: {
      'barcelona':         [8634,  'ברצלונה',            'Μπαρσελόνα',            'BAR'],
      'atl-tico-madrid':   [9906,  'אתלטיקו מדריד',      'Ατλέτικο Μαδρίτης',     'ATM'],
      'real-madrid':       [8633,  'ריאל מדריד',         'Ρεάλ Μαδρίτης',         'RMA'],
      'real-betis':        [8603,  'ריאל בטיס',          'Ρεάλ Μπέτις',           'BET'],
      'real-sociedad':     [8560,  'ריאל סוסיאדד',       'Ρεάλ Σοσιεδάδ',         'RSO'],
      'sevilla':           [8302,  'סביליה',             'Σεβίλλη',               'SEV'],
      'deportivo-alav-s':  [9866,  'דפורטיבו אלאבס',     'Αλαβές',                'ALA'],
      'celta-vigo':        [9910,  'סלטה ויגו',          'Θέλτα Βίγκο',           'CEL'],
      'deportivo-a-coru-a':[9783,  'דפורטיבו לה קורוניה','Ντεπορτίβο Λα Κορούνια','DEP'],
      'osasuna':           [8371,  'אוסאסונה',           'Οσασούνα',              'OSA'],
      'athletic-club':     [8315,  'אתלטיק בילבאו',      'Αθλέτικ Μπιλμπάο',      'ATH'],
      'villarreal':        [10205, 'ויאריאל',            'Βιγιαρρεάλ',            'VIL'],
      'espanyol':          [8558,  'אספניול',            'Εσπανιόλ',              'ESP'],
      'rayo-vallecano':    [8370,  'ראיו ואייקאנו',      'Ράγιο Βαγεκάνο',        'RAY'],
      'getafe':            [8305,  'חטאפה',              'Χετάφε',                'GET'],
      'racing-santander':  [8696,  'ראסינג סנטאנדר',     'Ρασίνγκ Σανταντέρ',     'RAC'],
      'levante':           [8581,  'לבאנטה',             'Λεβάντε',               'LVT'],
      'elche':             [10268, 'אלצ\'ה',             'Έλτσε',                 'ELC'],
      'valencia':          [10267, 'ולנסיה',             'Βαλένθια',              'VAL'],
      'm-laga':            [9864,  'מלגה',               'Μάλαγα',                'MAL'],
    },
  },
};

/** שמות אנגליים של המועדונים — כפי שבחבילה. */
const EN_NAME = {
  'afc-bournemouth': 'AFC Bournemouth', 'brighton-hove-albion': 'Brighton & Hove Albion',
  'coventry-city': 'Coventry City', 'hull-city': 'Hull City', 'ipswich-town': 'Ipswich Town',
  'leeds-united': 'Leeds United', 'manchester-city': 'Manchester City', 'manchester-united': 'Manchester United',
  'newcastle-united': 'Newcastle United', 'nottingham-forest': 'Nottingham Forest',
  'tottenham-hotspur': 'Tottenham Hotspur', 'aston-villa': 'Aston Villa', 'crystal-palace': 'Crystal Palace',
  'atl-tico-madrid': 'Atlético Madrid', 'deportivo-alav-s': 'Deportivo Alavés',
  'deportivo-a-coru-a': 'Deportivo A Coruña', 'm-laga': 'Málaga', 'athletic-club': 'Athletic Club',
  'real-madrid': 'Real Madrid', 'real-betis': 'Real Betis', 'real-sociedad': 'Real Sociedad',
  'celta-vigo': 'Celta Vigo', 'rayo-vallecano': 'Rayo Vallecano', 'racing-santander': 'Racing Santander',
};
const enName = (k) => EN_NAME[k] ?? k.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

function crc32(s) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < s.length; i++) {
    c = (crc ^ s.charCodeAt(i)) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* מזהים תפוסים ביוון — כדי לתפוס התנגשות אמיתית (אותו שחקן בשתי ליגות = אותו מזהה, וזה בכוונה). */
const greekIds = new Map();
for (const r of greece) {
  const id = r.fotmob_id != null ? 30_000_000 + r.fotmob_id : 35_000_000 + (crc32(r.player_id) % 4_000_000);
  greekIds.set(id, r.player_id);
}
const seenTeams = new Map();
const seenPlayers = new Map();

for (const [code, L] of Object.entries(LEAGUES)) {
  const lr = rows.filter((r) => r.league === code);
  const valued = lr.filter((r) => r.rated);
  const maxRank = Math.max(...valued.map((r) => r.rank_ascending));
  const teams = Object.entries(L.clubs).map(([key, [fm, he, el, short]]) => {
    const team_id = 20000 + fm;
    if (seenTeams.has(team_id)) throw new Error(`team id collision ${team_id}`);
    seenTeams.set(team_id, key);
    const players = lr.filter((r) => r.club_key === key).map((r) => {
      const id = r.fotmob_id != null ? 30_000_000 + r.fotmob_id : 35_000_000 + (crc32(r.player_id) % 4_000_000);
      if (seenPlayers.has(id)) throw new Error(`external id collision: ${id} (${r.player_id} vs ${seenPlayers.get(id)})`);
      if (greekIds.has(id) && greekIds.get(id) !== r.player_id) throw new Error(`collision with Greece: ${id}`);
      seenPlayers.set(id, r.player_id);
      return {
        id, name_en: r.name_en, position: r.position, number: r.shirt ?? null,
        price: r.price, tier: 6 - r.price,
        overall_rank: r.rated ? maxRank - r.rank_ascending + 1 : null, rated: !!r.rated,
        status: r.status,
      };
    });
    if (players.length === 0) throw new Error(`empty club ${key}`);
    return { team_id, name_en: enName(key), name_he: he, name_el: el, short, players };
  });
  if (teams.length !== 20) throw new Error(`${code}: ${teams.length} teams`);
  const nPlayers = teams.reduce((n, t) => n + t.players.length, 0);
  if (nPlayers !== lr.length) throw new Error(`${code}: players ${nPlayers} vs ${lr.length} (club_key mismatch?)`);

  const payload = JSON.stringify({
    league: { name_he: L.he, name_en: L.en, name_el: L.el, season: L.season, country: L.country, tz: L.tz },
    teams,
  }).replace(/\$/g, '\\u0024');

  const sql = `-- =====================================================================
--  db/${L.file} — סגלי ${L.label} ${L.season} (נוצר אוטומטית)
--  מקור: scripts/eng-esp.source.json · מחולל: scripts/build-eng-esp-seed.mjs
--  אידמפוטנטי. מחיר שנקבע ידנית באדמין מנצח את הסיד (כמו בישראל).
--  הליגה נטענת **לא-גלויה**: leagues_public() מציג אותה רק כשיש לה מחזור
--  נוכחי או כשהקליטה שלה מופעלת (db/47).
-- =====================================================================
BEGIN;
SET LOCAL search_path = core, game, public;

DO $seed$
DECLARE
  payload  JSONB := $json$${payload}$json$::jsonb;
  v_league UUID; v_season UUID; t JSONB; p JSONB; v_team UUID; v_player UUID;
  v_pos core.position;
BEGIN
  INSERT INTO core.leagues (code, country_code, default_locale, text_direction, timezone, names, squad_size)
  VALUES ('${code}', '${L.country}', 'en', 'ltr', '${L.tz}',
          jsonb_build_object(
            'he', jsonb_build_object('full', payload->'league'->>'name_he'),
            'en', jsonb_build_object('full', payload->'league'->>'name_en'),
            'el', jsonb_build_object('full', payload->'league'->>'name_el')), 11)
  ON CONFLICT (code) DO UPDATE SET names = EXCLUDED.names RETURNING id INTO v_league;

  /* ★ starts_on מוקדם מישראל במכוון — ישראל נשארת "הראשית" לקוראים ישנים. */
  INSERT INTO core.seasons (league_id, label, starts_on, ends_on, is_current)
  VALUES (v_league, payload->'league'->>'season', DATE '2026-07-31', DATE '2027-05-30', TRUE)
  ON CONFLICT (league_id, label) DO UPDATE SET is_current = TRUE RETURNING id INTO v_season;

  FOR t IN SELECT * FROM jsonb_array_elements(payload->'teams') LOOP
    SELECT entity_id INTO v_team FROM core.external_refs
     WHERE provider = 'manual_json' AND entity_type = 'team' AND external_id = t->>'team_id';
    IF v_team IS NULL THEN
      INSERT INTO core.teams (country_code, names, short_code)
      VALUES (payload->'league'->>'country', jsonb_build_object(
                'he', jsonb_build_object('full', t->>'name_he'),
                'en', jsonb_build_object('full', t->>'name_en'),
                'el', jsonb_build_object('full', t->>'name_el')), t->>'short')
      RETURNING id INTO v_team;
      INSERT INTO core.external_refs (provider, entity_type, external_id, entity_id, payload)
      VALUES ('manual_json', 'team', t->>'team_id', v_team, t - 'players');
    ELSE
      UPDATE core.teams SET names = names || jsonb_build_object(
               'he', jsonb_build_object('full', t->>'name_he'),
               'en', jsonb_build_object('full', t->>'name_en'),
               'el', jsonb_build_object('full', t->>'name_el')) WHERE id = v_team;
    END IF;
    INSERT INTO core.team_seasons (team_id, season_id) VALUES (v_team, v_season) ON CONFLICT DO NOTHING;
    INSERT INTO core.entity_aliases (entity_type, entity_id, locale, alias, source)
    VALUES ('team', v_team, 'he', t->>'name_he', 'manual_json'),
           ('team', v_team, 'en', t->>'name_en', 'manual_json'),
           ('team', v_team, 'el', t->>'name_el', 'manual_json')
    ON CONFLICT DO NOTHING;
    FOR p IN SELECT * FROM jsonb_array_elements(t->'players') LOOP
      v_pos := (p->>'position')::core.position;
      SELECT entity_id INTO v_player FROM core.external_refs
       WHERE provider = 'manual_json' AND entity_type = 'player' AND external_id = p->>'id';
      IF v_player IS NULL THEN
        INSERT INTO core.players (names, nationality, primary_position)
        VALUES (jsonb_build_object('en', jsonb_build_object('full', p->>'name_en')), NULL, v_pos)
        RETURNING id INTO v_player;
        INSERT INTO core.external_refs (provider, entity_type, external_id, entity_id, payload)
        VALUES ('manual_json', 'player', p->>'id', v_player, p);
      ELSE
        UPDATE core.players SET names = names || jsonb_build_object('en', jsonb_build_object('full', p->>'name_en')),
               primary_position = v_pos, updated_at = now() WHERE id = v_player;
      END IF;
      INSERT INTO core.entity_aliases (entity_type, entity_id, locale, alias, source)
      VALUES ('player', v_player, 'en', p->>'name_en', 'manual_json') ON CONFLICT DO NOTHING;
      INSERT INTO core.squads (season_id, team_id, player_id, shirt_number, position, fantasy_price,
                               tier, overall_rank, rated, valid_from, status)
      VALUES (v_season, v_team, v_player, NULLIF(p->>'number','')::smallint, v_pos,
              (p->>'price')::NUMERIC, (p->>'tier')::smallint, NULLIF(p->>'overall_rank','')::int,
              (p->>'rated')::boolean, DATE '2026-07-31', p->>'status')
      ON CONFLICT (season_id, team_id, player_id, valid_from)
      DO UPDATE SET shirt_number = EXCLUDED.shirt_number, position = EXCLUDED.position,
                    fantasy_price = COALESCE(core.squads.fantasy_price, EXCLUDED.fantasy_price),
                    tier = EXCLUDED.tier, overall_rank = EXCLUDED.overall_rank, rated = EXCLUDED.rated;
    END LOOP;
  END LOOP;
END
$seed$;
UPDATE game.data_revision SET revision = revision + 1, scope = 'seed-${L.label.toLowerCase()}', updated_at = now() WHERE id = 1;
COMMIT;
INSERT INTO game.schema_migrations (version, note) VALUES ('${L.num}', '★ סגלי ${L.label} ${L.season} (${nPlayers} שחקנים, ${teams.length} קבוצות)')
ON CONFLICT (version) DO NOTHING;
`;
  writeFileSync(join(here, '..', 'db', L.file), sql);
  console.log(`db/${L.file}: ${teams.length} teams, ${nPlayers} players, ${(sql.length / 1024) | 0}kb`);
}
