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
  ['03_seed_squads.sql',       '14 קבוצות · סגלי 2026/27 · מחירים'],
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
  ['19_guest_pass.sql',        'כרטיס המנוי של האורח, לכידת לידים, ומשפך'],
  ['20_pass_sql_only.sql',     '★ כרטיס המנוי בלי Edge Functions — הכל ב-SQL'],
  ['21_coach_profile.sql',     'פרופיל המאמן — היסטוריה, שיאים ואווטאר'],
  ['22_account_status.sql',    '★ "התחברתי ולא קרה כלום" — זיהוי נכון של חשבון מחובר'],
  ['23_merge_on_signin.sql',   '★ "החשבון כבר קיים" — נכנסים, ואז גוררים את מה שנבנה'],
  ['24_live_gameweek.sql',     '★ המחזור חי — ניקוד זורם בין הנעילה ל"סיום מחזור"'],
  ['25_gameweek_4.sql',        '★ מחזור 4 — שבעה משחקים, 13–15/09, פתוח למשחק'],
  ['26_ingest.sql',            '★ קליטה אוטומטית ממקורות חינמיים + מחזור חיים אוטומטי'],
  ['27_cron.sql',              '★ המתזמן — pg_cron מעיר את הקליטה, שער SQL מחליט אם לפעול'],
  ['28_dispatch_visibility.sql','★ נראות הפעימה — קוד התשובה של כל קריאה, במסך'],
  ['29_squad_repair.sql',      '★ עמדה בלוח הניהול + שחקן שפתוח ביותר מקבוצה אחת'],
  ['30_value_and_depth.sql',   '★ שווי שוק → תמחור 1–5, זמינות, טבלאות פומביות, סיכום מחזור'],
  ['31_lifecycle.sql',         '★ מחזור החיים מסתובב לבד — נעילה, «חי», ופעימה נפרדת מהקליטה'],
  ['32_internal_grants.sql',   '★ פונקציות המערכת נסגרות ל-PUBLIC; המסכים נשארים פתוחים'],
  ['33_anon_grants.sql',       '★ …וגם מ-anon ומ-authenticated — שם ההרשאה באמת ישבה'],
  ['34_backfill.sql',          '★ מחזור שנגמר בלי שורת סטטיסטיקה אחת חוזר לתור מעצמו'],
  ['35_announce.sql',          '★ הודעות מחזור — outbox לטלגרם, סריקה, claim/mark'],
  ['36_publish_gate.sql',      '★ שער פרסום אטומי, משחק שנדחה לא חוסם, מחזור חלקי חוזר להשלמה'],
  ['37_weekly_cadence.sql',    '★ קצב שבועי: פתיחה ביום שני 09:00 אתונה, סגירה מיד עם המשחק האחרון'],
  ['38_current_sync.sql',      '★ המחזור הנוכחי נגזר אוטומטית מסטטוס המחזורים'],
  ['39_league_scoped_current.sql', '★ מחזור נוכחי אחד לכל ליגה (הכנה ליוון)'],
  ['40_league_reads.sql',      '★ squads / current_gameweek לפי ליגה + leagues_public'],
  ['41_seed_greece.sql',       '★ סגלי הליגה היוונית 2026/27 (457 שחקנים, 14 קבוצות)'],
  ['42_ingest_leagues.sql',    '★ קליטה לפי ליגה: ingest_sources + ingest_snapshot(league) + tick לכל מקור'],
  ['43_league_safe_readers.sql','★ קוראי מחזור נוכחי בטוחים לשתי ליגות'],
  ['44_league_gate.sql','★ מסך כניסה לליגות + ארכיון מופרד'],
  ['45_seed_england.sql','★ סגלי הפרמיירליג 2026/27 (599 שחקנים, 20 קבוצות)'],
  ['46_seed_spain.sql','★ סגלי לה ליגה 2026/27 (566 שחקנים, 20 קבוצות)'],
  ['47_ingest_eng_esp.sql','★ קליטת אנגליה וספרד: ingest_sources + קישור 365scores'],
  ['48_league_worlds.sql','★ כל ליגה עולם משלה: זירות פרטיות לפי ליגה + מחירים זמניים לשחקנים בלי דירוג'],
  ['49_dnp_autofill.sql','★ שחקן שלא שיחק (ממופה, דף משחק נקלט) מקבל DNP ולא חוסם מחזור'],
  ['49_publish_fixtures.sql','★ דוביד מפרסם את המשחקים ל-core.fixtures (אקוסיסטם 0004) — הרשימה הנייטרלית של כל האפליקציות'],
  ['50_ops_hardening.sql','★ statement_timeout 60s לפונקציות כבדות + ניקוי התראות מיושנות אוטומטי בכל lifecycle_tick'],
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
--      → teams 14 · matches 14 · players/id_mappings לפי scripts/squads.report.md
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
