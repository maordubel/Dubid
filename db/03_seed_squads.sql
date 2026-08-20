-- =====================================================================
--  Dubid · מיגרציה 03 — סיד סגלי ליגת העל
--  נוצר אוטומטית מ-scripts/squads.source.json (npm run build:squads).
--  אידמפוטנטי: אפשר להריץ שוב אחרי עדכון הקובץ, ורק מה שהשתנה יתעדכן.
--  המיפוי לישויות נשמר ב-core.external_refs עם provider='manual_json',
--  כך שסנכרון עתידי מ-API לא ייצור כפילויות.
-- =====================================================================

SET search_path = core, game, public;

DO $seed$
DECLARE
  payload  JSONB := $json${"league":{"id":1,"name_he":"ליגת העל בישראל","name_en":"Israeli Premier League","season":"2026/2027"},"teams":[{"team_id":1,"name_he":"מכבי חיפה","name_en":"Maccabi Haifa","city":"חיפה","stadium":"סמי עופר","players":[{"id":101,"name_he":"שריף כיוף","name_en":"Shareef Kayouf","position":"GK","number":40},{"id":102,"name_he":"עומרי גלזר","name_en":"Omri Glazer","position":"GK","number":55},{"id":103,"name_he":"שון גולדברג","name_en":"Sean Goldberg","position":"DF","number":3},{"id":104,"name_he":"פדראו","name_en":"Pedrao","position":"DF","number":44},{"id":105,"name_he":"פייר קורנו","name_en":"Pierre Cornud","position":"DF","number":27},{"id":106,"name_he":"זוהר זסנו","name_en":"Zohar Zasano","position":"DF","number":2},{"id":107,"name_he":"עלי מוחמד","name_en":"Ali Mohamed","position":"MF","number":4},{"id":108,"name_he":"אתאן אזולאי","name_en":"Ethan Azoulay","position":"MF","number":19},{"id":109,"name_he":"ברוניניו","name_en":"Bruninho","position":"MF","number":10},{"id":110,"name_he":"מנואל בנסון","name_en":"Manuel Benson","position":"FW","number":14},{"id":111,"name_he":"גיא מלמד","name_en":"Guy Melamed","position":"FW","number":18}]},{"team_id":2,"name_he":"מכבי תל אביב","name_en":"Maccabi Tel Aviv","city":"תל אביב","stadium":"בלומפילד","players":[{"id":201,"name_he":"רועי משפתי","name_en":"Roi Mishpati","position":"GK","number":22},{"id":202,"name_he":"אופיר דוידזאדה","name_en":"Ofir Davidzada","position":"DF","number":4},{"id":203,"name_he":"רז שלמה","name_en":"Raz Shlomo","position":"DF","number":3},{"id":204,"name_he":"עידו שחר","name_en":"Ido Shahar","position":"MF","number":14},{"id":205,"name_he":"דור פרץ","name_en":"Dor Peretz","position":"MF","number":42},{"id":206,"name_he":"גבי קניקובסקי","name_en":"Gabi Kanichowsky","position":"MF","number":16},{"id":207,"name_he":"אייסון פטאצ'י","name_en":"Issouf Sissokho","position":"MF","number":26},{"id":208,"name_he":"דור תורג'מן","name_en":"Dor Turgeman","position":"FW","number":7},{"id":209,"name_he":"ערן זהבי","name_en":"Eran Zahavi","position":"FW","number":77},{"id":210,"name_he":"הנרי אדו","name_en":"Henry Addo","position":"FW","number":11}]},{"team_id":3,"name_he":"הפועל באר שבע","name_en":"Hapoel Beer Sheva","city":"באר שבע","stadium":"טרנר","players":[{"id":301,"name_he":"ניב אליאסי","name_en":"Niv Eliasi","position":"GK","number":55},{"id":302,"name_he":"איתן טיבי","name_en":"Eitan Tibi","position":"DF","number":5},{"id":303,"name_he":"מיגל ויטור","name_en":"Miguel Vitor","position":"DF","number":4},{"id":304,"name_he":"לוקאס ברטו","name_en":"Lucas Barreto","position":"MF","number":8},{"id":305,"name_he":"קינגס קנגווה","name_en":"Kings Kangwa","position":"MF","number":22},{"id":306,"name_he":"אליאל פרץ","name_en":"Eliel Peretz","position":"MF","number":15},{"id":307,"name_he":"אמוראן ששון","name_en":"Amran Sasson","position":"FW","number":9},{"id":308,"name_he":"חالد זייד","name_en":"Alon Turgeman","position":"FW","number":99}]},{"team_id":4,"name_he":"בית\"ר ירושלים","name_en":"Beitar Jerusalem","city":"ירושלים","stadium":"טדי","players":[{"id":401,"name_he":"מיגל סילבה","name_en":"Miguel Silva","position":"GK","number":1},{"id":402,"name_he":"אורי דהן","name_en":"Uri Dahan","position":"DF","number":5},{"id":403,"name_he":"גיל כהן","name_en":"Gil Cohen","position":"DF","number":4},{"id":404,"name_he":"ירדן שועה","name_en":"Yarden Shua","position":"MF","number":7},{"id":405,"name_he":"איסמעילה סורו","name_en":"Ismaila Soro","position":"MF","number":6},{"id":406,"name_he":"דור מיכה","name_en":"Dor Micha","position":"MF","number":15},{"id":407,"name_he":"פטריק טוומאסי","name_en":"Patrick Twumasi","position":"FW","number":11},{"id":408,"name_he":"מיירון ג'ורג'","name_en":"Mayron George","position":"FW","number":99}]},{"team_id":5,"name_he":"הפועל תל אביב","name_en":"Hapoel Tel Aviv","city":"תל אביב","stadium":"בלומפילד","players":[{"id":501,"name_he":"רובי לבקוביץ'","name_en":"Rubi Levkovich","position":"GK","number":1},{"id":502,"name_he":"דגלאס אווסו","name_en":"Douglas Owusu","position":"DF","number":2},{"id":503,"name_he":"זיו מורגן","name_en":"Ziv Morgan","position":"DF","number":25},{"id":504,"name_he":"רן בנימין","name_en":"Ran Binyamin","position":"MF","number":6},{"id":505,"name_he":"אלן אוז'בולט","name_en":"Alen Ozbolt","position":"FW","number":9}]},{"team_id":6,"name_he":"מכבי נתניה","name_en":"Maccabi Netanya","city":"נתניה","stadium":"נתניה","players":[{"id":601,"name_he":"עומר ניראון","name_en":"Omer Niron","position":"GK","number":55},{"id":602,"name_he":"פטריק פטוצי","name_en":"Matan Baltaxa","position":"DF","number":3},{"id":603,"name_he":"ג'אבר קארם","name_en":"Karem Jaber","position":"DF","number":2},{"id":604,"name_he":"מקסים פלקושצ'נקו","name_en":"Maxim Plakuschenko","position":"MF","number":10},{"id":605,"name_he":"איגור זלאטנוביץ'","name_en":"Igor Zlatanovic","position":"FW","number":9}]}]}$json$;
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

      INSERT INTO core.squads (season_id, team_id, player_id, shirt_number, position, valid_from)
      VALUES (v_season, v_team, v_player, (p->>'number')::smallint, v_pos, DATE '2026-08-01')
      ON CONFLICT (season_id, team_id, player_id, valid_from)
      DO UPDATE SET shirt_number = EXCLUDED.shirt_number,
                    position     = EXCLUDED.position,
                    status       = 'active',
                    valid_to     = NULL;
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
