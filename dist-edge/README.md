# dubid-score-gameweek — להעתקה לריפו של אופסיידס

נוצר אוטומטית על ידי `npm run export:edge` בריפו של דוביד.
**לא לערוך כאן.** מקור האמת: `src/lib/` בריפו של דוביד.

## מה לעשות

1. להעתיק את התיקייה `dubid-score-gameweek/` אל:

       <offsides-repo>/supabase/functions/dubid-score-gameweek/

2. `git add` · `git commit` · `git push`

אינטגרציית ה-GIT של Supabase תפרוס אותה אוטומטית לפרויקט.

## למה זה עובד עכשיו וקודם לא

התיקייה עומדת בפני עצמה: היחיד שהיא מייבאת מבחוץ הוא `esm.sh`.
אין בה שום `../../src/...`, ולכן ה-bundler — שרואה רק את התיקייה
הזו — מוצא הכל.

## Secrets שצריך בפרויקט

| שם | ערך |
|---|---|
| `API_FOOTBALL_KEY` | המפתח מ-api-sports |
| `APP_ORIGIN` | `https://dubid.dubelteam.com` |

`SUPABASE_URL` ו-`SUPABASE_SERVICE_ROLE_KEY` מוזרקים אוטומטית.

## קריאה

    POST https://<project>.supabase.co/functions/v1/dubid-score-gameweek
    Authorization: Bearer <service_role>
    { "gameweekId": "..." }

## אזהרה לגבי הריפו של אופסיידס

בתיקייה `supabase/migrations/` שם יושבים `0001_schema.sql` ו-
`0002_rls.sql` שיוצרים טבלאות `cities`, `venues`, `bookings`,
`experiences` — **הם לא של אופסיידס ולא של דוביד.** אם אינטגרציית
ה-GIT מריצה מיגרציות, הן ייווצרו בפרויקט. כדאי למחוק או להעביר
אותן לפני שמחברים.
