#!/usr/bin/env node
/**
 * scripts/build-greece-seed.mjs — מחולל db/41_seed_greece.sql
 *
 * מקור: scripts/greece.source.json (חבילת המחקר 18.10.2026: 457 שחקנים,
 * 14 קבוצות, מחיר 1–5M לפי אחוזון שווי שוק, FotMob). אידמפוטנטי.
 *
 * מזהים חיצוניים (provider='manual_json', מספריים כדי להתאים ל-v_ext
 * ול-`game.squads()`), ללא התנגשות עם ישראל (קבוצות 1–14, שחקנים 101+):
 *   קבוצה  = 20000 + מזהה FotMob של המועדון
 *   שחקן   = מזהה FotMob; למי שאין לו — 35_000_000 + crc32(player_id) % 4M
 * שמות יווניים לשחקנים לא נטענים (המקור באותיות גדולות בלי טונוס).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const rows = JSON.parse(readFileSync(join(here, 'greece.source.json'), 'utf8'));

const CLUBS = {
  aek:           { id: 8563,   en: 'AEK Athens',        he: 'איי אי קיי אתונה',   el: 'ΑΕΚ',                 short: 'AEK' },
  aris:          { id: 8239,   en: 'Aris Thessaloniki', he: 'אריס סלוניקי',       el: 'Άρης',                short: 'ARI' },
  asteras:       { id: 80654,  en: 'Asteras Aktor',     he: 'אסטרס אקטור',        el: 'Αστέρας Άκτορ',       short: 'AST' },
  atromitos:     { id: 10187,  en: 'Atromitos',         he: 'אטרומיטוס',          el: 'Ατρόμητος',           short: 'ATR' },
  iraklis:       { id: 8675,   en: 'Iraklis',           he: 'איראקליס',           el: 'Ηρακλής',             short: 'IRA' },
  kalamata:      { id: 1585,   en: 'Kalamata',          he: 'קלמטה',              el: 'Καλαμάτα',            short: 'KAL' },
  kifisia:       { id: 488099, en: 'Kifisia',           he: 'קיפיסיה',            el: 'Κηφισιά',             short: 'KIF' },
  levadiakos:    { id: 4493,   en: 'Levadiakos',        he: 'לבדיאקוס',           el: 'Λεβαδειακός',         short: 'LEV' },
  ofi:           { id: 7753,   en: 'OFI Crete',         he: 'או אף איי כרתים',    el: 'ΟΦΗ',                 short: 'OFI' },
  olympiacos:    { id: 8638,   en: 'Olympiacos',        he: 'אולימפיאקוס',        el: 'Ολυμπιακός',          short: 'OLY' },
  paok:          { id: 8619,   en: 'PAOK',              he: 'פאוק סלוניקי',       el: 'ΠΑΟΚ',                short: 'PAO' },
  panathinaikos: { id: 10200,  en: 'Panathinaikos',     he: 'פנאתינייקוס',        el: 'Παναθηναϊκός',        short: 'PAN' },
  panetolikos:   { id: 162386, en: 'Panetolikos',       he: 'פנטוליקוס',          el: 'Παναιτωλικός',        short: 'PTL' },
  volos:         { id: 885256, en: 'Volos NFC',         he: 'וולוס',              el: 'Βόλος',               short: 'VOL' },
};

function crc32(s) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < s.length; i++) {
    c = (crc ^ s.charCodeAt(i)) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const valued = rows.filter((r) => r.rated);
const maxRank = Math.max(...valued.map((r) => r.rank_ascending));
const seen = new Set();
const teams = Object.entries(CLUBS).map(([key, c]) => ({
  team_id: 20000 + c.id, name_en: c.en, name_he: c.he, name_el: c.el, short: c.short,
  players: rows.filter((r) => r.club_key === key).map((r) => {
    const id = r.fotmob_id != null ? 30_000_000 + r.fotmob_id : 35_000_000 + (crc32(r.player_id) % 4_000_000);
    if (seen.has(id)) throw new Error(`external id collision: ${id} (${r.player_id})`);
    seen.add(id);
    return {
      id, name_en: r.name_en, position: r.position, number: r.shirt ?? null,
      price: r.fantasy_price_m, tier: 6 - r.fantasy_price_m,
      overall_rank: r.rated ? maxRank - r.rank_ascending + 1 : null, rated: !!r.rated,
    };
  }),
}));
for (const t of teams) if (t.players.length === 0) throw new Error(`empty club ${t.name_en}`);

const payload = JSON.stringify({
  league: { id: 2, name_he: 'הסופר ליג היוונית', name_en: 'Greek Super League', name_el: 'Super League Ελλάδας', season: '2026/27' },
  teams,
}).replace(/\$/g, '\\u0024');

const sql = `-- =====================================================================
--  db/41_seed_greece.sql — סגלי הליגה היוונית 2026/27 (נוצר אוטומטית)
--  מקור: scripts/greece.source.json · מחולל: scripts/build-greece-seed.mjs
--  אידמפוטנטי. מחיר שנקבע ידנית באדמין מנצח את הסיד (כמו בישראל).
--  הליגה נטענת **לא-גלויה**: leagues_public() מציג אותה רק כשיש לה
--  מחזור נוכחי, כלומר אחרי שהקליטה היוונית פתחה מחזור.
-- =====================================================================
BEGIN;
SET LOCAL search_path = core, game, public;

DO $seed$
DECLARE
  payload  JSONB := $json$${payload}$json$;
  v_league UUID; v_season UUID; t JSONB; p JSONB; v_team UUID; v_player UUID;
  v_pos core.position;
BEGIN
  INSERT INTO core.leagues (code, country_code, default_locale, text_direction, timezone, names, squad_size)
  VALUES ('GR_SUPER', 'GR', 'el', 'ltr', 'Europe/Athens',
          jsonb_build_object(
            'he', jsonb_build_object('full', payload->'league'->>'name_he'),
            'en', jsonb_build_object('full', payload->'league'->>'name_en'),
            'el', jsonb_build_object('full', payload->'league'->>'name_el')), 11)
  ON CONFLICT (code) DO UPDATE SET names = EXCLUDED.names RETURNING id INTO v_league;

  /* ★ starts_on מוקדם מישראל במכוון: קוראים ישנים בוחרים עונה לפי
     "is_current ואז starts_on האחרון". ישראל חייבת להישאר ראשונה
     עד שכולם מקבלים פרמטר ליגה. */
  INSERT INTO core.seasons (league_id, label, starts_on, ends_on, is_current)
  VALUES (v_league, payload->'league'->>'season', DATE '2026-07-31', DATE '2027-05-30', TRUE)
  ON CONFLICT (league_id, label) DO UPDATE SET is_current = TRUE RETURNING id INTO v_season;

  FOR t IN SELECT * FROM jsonb_array_elements(payload->'teams') LOOP
    SELECT entity_id INTO v_team FROM core.external_refs
     WHERE provider = 'manual_json' AND entity_type = 'team' AND external_id = t->>'team_id';
    IF v_team IS NULL THEN
      INSERT INTO core.teams (country_code, names, short_code)
      VALUES ('GR', jsonb_build_object(
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
              (p->>'rated')::boolean, DATE '2026-07-31', 'active')
      ON CONFLICT (season_id, team_id, player_id, valid_from)
      DO UPDATE SET shirt_number = EXCLUDED.shirt_number, position = EXCLUDED.position,
                    fantasy_price = COALESCE(core.squads.fantasy_price, EXCLUDED.fantasy_price),
                    tier = EXCLUDED.tier, overall_rank = EXCLUDED.overall_rank, rated = EXCLUDED.rated;
    END LOOP;
  END LOOP;

END
$seed$;

UPDATE game.data_revision SET revision = revision + 1, scope = 'seed-greece', updated_at = now() WHERE id = 1;
COMMIT;

INSERT INTO game.schema_migrations (version, note) VALUES ('41', '★ סגלי הליגה היוונית 2026/27 (457 שחקנים, 14 קבוצות)')
ON CONFLICT (version) DO NOTHING;
`;
writeFileSync(join(here, '..', 'db', '41_seed_greece.sql'), sql);
console.log(`db/41_seed_greece.sql · ${teams.length} teams · ${seen.size} players`);
