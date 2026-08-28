# דוביד · סבב G — מה יש בחבילה

הקבצים כאן הם **רק מה שהשתנה או נוסף** בסבב G. מבנה התיקיות זהה
לפרויקט: להעתיק מעל הקיים.

## סדר ההתקנה

1. **קוד** — להעתיק את `src/`, `tests/`, `scripts/`, `index.html`,
   `public/manifest.webmanifest` מעל הקיים.
2. **מסד הנתונים** — להריץ ב-SQL Editor של Supabase, לפי הסדר:
   - `db/15_team_names.sql` (שמות הקבוצות החדשים)
   - `db/03_seed_squads.sql` (הסגלים, כולל המחירים)
   - `db/16_team_names_bots_activity.sql` ← **החדש והחשוב**
   כל הקבצים idempotent: אפשר להריץ פעמיים בלי נזק.
3. `npm test` ו-`npx tsc --noEmit` כדי לוודא שהכול נקי.

## מה `16_team_names_bots_activity.sql` מוסיף

| אובייקט | תפקיד |
|---|---|
| `user_lineups.team_name` | שם הקבוצה שהמתמודד בחר |
| `game.set_entry_team_name` | שינוי שם קבוצה עד הנעילה |
| `game.entries` (נכתבה מחדש) | מחזירה **כל** מי שהגיש; לפני הנעילה `slots: []` ו-`hidden: true` לכל מי שאינו אתה |
| `users.is_bot`, `game.bot_identity` | זהות בוט |
| `game.admin_add_bots` / `admin_remove_bots` | הוספה והסרה של בוטים למחזור |
| `game.activity_log`, `log_activity` | יומן פעולות |
| `game.admin_activity`, `admin_activity_stats` | היומן והסטטיסטיקה ללוח האדמין |
| `submit_entry` / `withdraw_entry` | עטיפות מעל `*_core`, שרושמות ליומן |

★ **הסתרת ההרכבים היא בשרת ולא בדפדפן.** לפני הנעילה השרת פשוט לא
שולח את המשבצות של אחרים. הסתרה בצד הלקוח הייתה דליפה.

## מה נבדק כאן, ומה לא

נבדק: 319 בדיקות יחידה · 68 בדיקות SQL על מסד PostgreSQL 16 נקי,
בשתי ריצות רצופות (idempotency) · `tsc --noEmit` נקי · שני smoke של
רינדור שרת · צילומי מסך של הלובי, בורר ההרכב, מודל ההגשה, רשימת
המשתתפים, מסך החוקים ויומן האדמין.

לא ניתן לבדוק כאן: `npm run build` (אין גישה ל-npm registry
בסביבה), Edge Functions, התחברות Google, וחיבור Offsides.
