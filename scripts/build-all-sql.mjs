/**
 * scripts/build-all-sql.mjs — מאחד את כל המיגרציות לקובץ אחד.
 *
 * ★ למה זה קיים
 *
 * "להריץ אחד־עשר קבצים לפי הסדר" הוא הוראה שנכשלת. מספיק לדלג
 * על אחד, או להריץ שניים בסדר הפוך, כדי לקבל שגיאה שנראית כמו
 * באג במוצר. שתי התקלות האחרונות היו בדיוק זה.
 *
 * קובץ אחד = הדבקה אחת = אין סדר לטעות בו.
 *
 * הרצה:  node scripts/build-all-sql.mjs
 * פלט:   db/RUN-ALL.sql
 */
import { readFileSync, writeFileSync } from 'node:fs';

/* ★ 08 לא ברשימה בכוונה — הוא נכתב לארכיטקטורה של פרויקט
   משותף שכבר לא קיימת. הוא לא מזיק, והוא גם לא נחוץ. */
const FILES = [
  ['01_schema.sql',            'ליבה — ליגות, קבוצות, שחקנים, מחזורים'],
  ['02_dubid_captain.sql',     'קפטן וסגן + פונקציות ניקוד'],
  ['03_seed_squads.sql',       '14 קבוצות · 351 שחקנים · מחירים'],
  ['04_ranking_and_events.sql','לוג אירועים, דירוג, יומן ביקורת'],
  ['05_gameweek_lock.sql',     'נעילה סמכותית + שעון שרת'],
  ['06_private_leagues.sql',   'טבלאות הזירות'],
  ['07_shared_supabase.sql',   'הרשאות ופרופיל'],
  ['09_live_mvp.sql',          'הגשות, תוצאות, אדמין, RLS'],
  ['10_accounts.sql',          'הרשמה, אורחים, שמות משתמש'],
  ['11_arena_and_squads.sql',  'זירות בשרת, עריכת סגלים, תקציב'],
  ['12_admin_access.sql',      'כניסת אדמין בסיסמה אחת'],
  ['13_live_data.sql',         'סגלים, לוח, טיוטות ומונה גרסה — הכל מהשרת'],
  ['14_admin_console.sql',     'מחזורים, קליטת לוח, חוקי ניקוד, תוכן וניתוח'],
  ['15_team_names.sql',        'קיצורי הקבוצות — ב״ש, מ·ת״א, קר״ש'],
  ['16_team_names_bots_activity.sql',
                               'שם קבוצה, משתתפים גלויים, בוטים, יומן פעילות'],
  ['17_house_ads.sql',         'פרסום פנימי — מודעות, מדידה ולוח ניהול'],
  ['18_hardening.sql',         '★ הקשחה — סגירת הגישה הישירה לטבלאות, RLS, קצב, ביקורת'],
];

const bar = '=' .repeat(69);
let out = `-- ${bar}
--  DUBID · הכל בקובץ אחד
--
--  ★ נוצר אוטומטית על ידי scripts/build-all-sql.mjs — לא לערוך.
--    לשינוי: לערוך את הקובץ המקורי תחת db/ ולהריץ את הסקריפט.
--
--  ═══════════════════════════════════════════════════════════════
--  איך מריצים
--  ═══════════════════════════════════════════════════════════════
--
--    1. Supabase → SQL Editor → New query
--    2. להדביק את **כל** הקובץ הזה
--    3. Run
--
--  זהו. אין סדר לטעות בו, ואפשר להריץ שוב כמה פעמים שרוצים.
--
--  ⚠ לוקח כ-10–30 שניות. אם העורך נתקע — לרענן ולהריץ שוב;
--    כל שלב מוגן ולא ייכשל על מה שכבר קיים.
--
--  ═══════════════════════════════════════════════════════════════
--  אחרי ההרצה — שלוש שאילתות שאומרות אם הכל תקין
--  ═══════════════════════════════════════════════════════════════
--
--    SELECT * FROM game.v_health;
--      → teams 14 · players 351 · matches 7 · id_mappings 366
--
--    SELECT * FROM game.v_arena_health;
--      → players_without_price = 0
--
--    SELECT * FROM game.v_admin_health;
--      → secrets = 1
--
--  ⚠ ואז, פעם אחת, בלוח הבקרה:
--    Settings → API → Exposed schemas →  public, core, game, shared
--    Authentication → Providers → Anonymous sign-ins →  להדליק
--
--    בלי שני אלה, המסד מוכן והאפליקציה עדיין לא תתחבר.
-- ${bar}

`;

for (const [file, why] of FILES) {
  const body = readFileSync(new URL(`../db/${file}`, import.meta.url), 'utf8');
  out += `\n-- ${bar}\n-- ▼▼▼  ${file}  —  ${why}\n-- ${bar}\n\n${body}\n`;
}

out += `
-- ${bar}
--  סיום
-- ${bar}
DO $done$
DECLARE h RECORD;
BEGIN
  SELECT * INTO h FROM game.v_health;
  RAISE NOTICE '';
  RAISE NOTICE '  ✓ הושלם.  קבוצות % · שחקנים % · משחקים % · מיפויים %',
    h.teams, h.players, h.matches, h.id_mappings;
  RAISE NOTICE '';
  RAISE NOTICE '  נשאר בלוח הבקרה:';
  RAISE NOTICE '    Settings → API → Exposed schemas: public, core, game, shared';
  RAISE NOTICE '    Authentication → Providers → Anonymous sign-ins: ON';
  RAISE NOTICE '';
END
$done$;
`;

writeFileSync(new URL('../db/RUN-ALL.sql', import.meta.url), out);
console.log(`db/RUN-ALL.sql · ${(out.length / 1024).toFixed(0)}kb · ${FILES.length} קבצים`);
