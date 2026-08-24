# חיבור דוביד לסופבייס — מה לעשות ומה חסר לי

הפרויקט: `afxpjfxwpdjvlmuoawda`

> **הערת אבטחה לפני הכול.** המפתח ה־`sb_publishable_...` ששלחת
> מיועד לדפדפן ולכן אין בעיה שהוא נחשף — ההגנה היא RLS, לא סודיות
> המפתח. **אבל אל תשלח בצ׳אט את `service_role` ואת סיסמת המסד.**
> שניהם עוקפים RLS לגמרי. אם הם כבר נשלחו למישהו — סובב אותם
> ב-Settings → API → Rotate.

---

## מה שאני צריך ממך

| # | פריט | איפה |
|---|---|---|
| 1 | ✅ URL + publishable key | התקבל |
| 2 | ⬜ **להריץ 4 מיגרציות** | SQL Editor — ראו למטה |
| 3 | ⬜ **Exposed schemas** | Settings → API |
| 4 | ⬜ **`API_FOOTBALL_KEY`** כ-secret | Edge Functions → Secrets |
| 5 | ⬜ **משתני סביבה ב-Vercel** | Settings → Environment Variables |
| 6 | ⬜ להחליט: אופסיידס עובר לאותו פרויקט או נשאר | החלטה שלך |

---

## 1. מיגרציות — בסדר הזה

SQL Editor → הדבק → Run. כל אחת אידמפוטנטית (אפשר להריץ שוב).

```
db/01_schema.sql            ← ליבה: ליגות, קבוצות, שחקנים, מחזורים
db/02_dubid_captain.sql     ← קפטן/סגן + עמודות ניקוד
db/03_seed_squads.sql       ← 14 קבוצות, 351 שחקנים
db/04_ranking_and_events.sql← לוג אירועים + דירוג + יומן ביקורת
db/05_gameweek_lock.sql     ← ★ נעילה סמכותית + snapshot
db/06_private_leagues.sql   ← זירות וליגות
db/07_shared_supabase.sql   ← הרשאות + זהות + פרסים
```

**07 חייבת לרוץ אחרונה** — היא נותנת ל-PostgREST גישה לסכימות.

## 2. Exposed schemas

Settings → API → **Exposed schemas**, להוסיף:

```
public, core, game, shared
```

בלי זה כל שאילתה תחזיר 404 גם אחרי שהמיגרציות רצו.

## 3. Secrets ל-Edge Functions

Edge Functions → Secrets:

| שם | ערך |
|---|---|
| `API_FOOTBALL_KEY` | המפתח שלך מ-api-sports (אותו אחד שאופסיידס משתמש בו) |
| `APP_ORIGIN` | `https://dubid.dubelteam.com` |

`SUPABASE_URL` ו-`SUPABASE_SERVICE_ROLE_KEY` מוזרקים אוטומטית — אל תגדיר אותם ידנית.

## 4. Vercel

Settings → Environment Variables:

```
VITE_SUPABASE_URL              = https://afxpjfxwpdjvlmuoawda.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY  = sb_publishable_...   (זה ששלחת)
```

ואז Redeploy. **בלי זה האפליקציה ממשיכה לעבוד על localStorage** —
היא לא תתרסק, אבל גם לא תתחבר.

## 5. ה-Edge Function שנכשל — תוקן

השגיאה שקיבלת:

```
Module not found "file:///src/lib/scoring/engine.ts"
```

**הסיבה:** ה-bundler של סופבייס רואה רק את `supabase/functions/`.
הייבוא היה `../../../src/lib/scoring/engine.ts` — יוצא מהתיקייה,
עובד מקומית, נשבר בפריסה.

**התיקון:** סקריפט שמעתיק את הקוד המשותף פנימה לפני כל פריסה.

```bash
npm run deploy:edge      # מסנכרן ואז פורס
```

מקור האמת נשאר `src/lib/`. התיקייה `supabase/functions/_shared/`
היא תוצר בנייה, מסומנת "נוצר אוטומטית", ונמצאת ב-`.gitignore`.

אם אתה פורס דרך ה-Dashboard במקום ה-CLI: להריץ `npm run sync:edge`
קודם, ואז להעלות את **כל** תיקיית `supabase/functions/` — לא רק
`index.ts`. זו הסיבה שהעלאת קובץ בודד נכשלה.

---

## סנכרון חכם בין שני המוצרים

```
פרויקט אחד
├── auth.users     ← זהות משותפת. חשבון אחד, שתי אפליקציות.
├── core.*         ← קבוצות · שחקנים · משחקים · אירועים   [משותף]
├── game.*         ← דוביד
├── public.*       ← אופסיידס
└── shared.*       ← פרסים חוצי-אפליקציות (טבלה אחת)
```

**מי כותב ל-`core`?** רק אחד. אם שני המוצרים יסנכרנו משחקים
במקביל, הם ידרסו זה את זה. ההמלצה: **אופסיידס הוא הכותב** —
יש לו כבר `sync-fixtures` עובד — ודוביד קורא בלבד.

**מה שאסור:** דוביד לא קורא ל-`public.*`, אופסיידס לא קורא
ל-`game.*`. הקליינט של דוביד מוגדר `db: { schema: 'game' }`
כדי שזה לא יקרה בטעות.

### מה שצריך לקרות בצד אופסיידס

1. משתני הסביבה שלו מצביעים לפרויקט החדש
2. הסכימה שלו מיובאת ל-`public` בפרויקט החדש
3. `sync-fixtures` כותב גם ל-`core.weekly_matches` (לא רק ל-`public.matches`)

**סעיף 3 הוא העבודה האמיתית.** כשתרצה — שלח לי את
`sync-fixtures/index.ts` העדכני ואכתוב את שכבת הכתיבה הכפולה.

---

## אזהרה אחת

פרויקט אחד = **רדיוס פגיעה אחד**. מיגרציה גרועה בדוביד יכולה
להפיל את אופסיידס, ושחזור מגיבוי הוא הכול-או-כלום.

לאופסיידס יש 272 קובצי `patch-*.sql` שאתה מריץ ידנית. זה עבד
כשהוא היה לבד. **לפני שאתה מעביר אותו לפרויקט המשותף — תרצה
סביבת staging.** דוביד לבד על הפרויקט החדש הוא סיכון נמוך;
שניהם יחד בלי staging הוא לא.
