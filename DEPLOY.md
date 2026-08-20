# פריסה: GitHub → Vercel

## למה זה לא עבד עד עכשיו

הקוד היה תקין. מה שחסר היה **פרויקט שאפשר לבנות**. ל-Vercel לא הייתה שום
דרך לדעת מה לעשות עם התיקייה, כי לא היו בה:

| חסר | מה זה גרם |
|---|---|
| `package.json` בשורש | Vercel לא מזהה framework, לא מריץ `npm install`, לא בונה כלום |
| `index.html` + `src/main.tsx` | לא הייתה נקודת כניסה — רק קומפוננטות שאף אחד לא טוען |
| `vite.config.ts` | אין תהליך בנייה |
| הקוד היה תחת `app/` | גם אם היה `package.json`, Vercel חיפש אותו בשורש ולא מצא |
| `vercel.json` עם rewrites | רענון בכתובת פנימית היה מחזיר 404 |

בגרסה הזאת **הריפו עצמו הוא הפרויקט** — `package.json` יושב בשורש,
וזה הפתרון לבעיה הכי נפוצה בפריסות Vercel (Root Directory שגוי).

---

## 1. העלאה ל-GitHub

```bash
cd dubid-web
git init
git add .
git commit -m "Dubid: PWA + מנוע ניקוד + סגלי ליגת העל"
git branch -M main
git remote add origin https://github.com/<user>/dubid.git
git push -u origin main
```

לפני הפוש, ודאו שזה עובר מקומית — זה בדיוק מה ש-Vercel יריץ:

```bash
npm install
npm test        # 60 טסטים
npm run build   # אמור לייצר dist/
```

---

## 2. חיבור ל-Vercel

**Add New → Project → Import** את הריפו, ואז:

| הגדרה | ערך | הערה |
|---|---|---|
| Framework Preset | **Vite** | מזוהה אוטומטית |
| **Root Directory** | **`./`** | ⚠️ הכי חשוב. אם זה מצביע על תת-תיקייה — הבנייה תיכשל |
| Build Command | `npm run build` | מ-`vercel.json` |
| Output Directory | `dist` | מ-`vercel.json` |
| Install Command | `npm ci` | דורש `package-lock.json` בריפו |
| Node.js Version | **22.x** | Settings → General. נדרש בשביל הטסטים |

`package-lock.json` **חייב** להיות ב-git. בלעדיו `npm ci` נכשל.
הוא נוצר ב-`npm install` הראשון — ודאו שהוא לא ב-`.gitignore`
(בקובץ שלנו הוא לא).

---

## 3. הדומיין

ב-Vercel: **Settings → Domains → Add** → `dubid.dubelteam.com`

אצל ספק ה-DNS של `dubelteam.com`:

```
CNAME   dubid   cname.vercel-dns.com
```

תת-דומיין = תמיד `CNAME`. רשומת `A` לשורש היא סיפור אחר ולא נדרשת כאן.
התעודה נוצרת אוטומטית תוך כמה דקות.

---

## 4. משתני סביבה

**Settings → Environment Variables**. כרגע האפליקציה עובדת מהדאטה
הסטטי ולא דורשת אף אחד מהם — הם נחוצים כשמחברים Supabase:

```
VITE_SUPABASE_URL        = https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY   = eyJhbGciOi...
```

⚠️ **רק משתנים עם קידומת `VITE_` נחשפים לדפדפן.**
`SUPABASE_SERVICE_ROLE_KEY` לעולם לא מקבל `VITE_` ולעולם לא נכנס
ל-Vercel — מקומו ב-Supabase Secrets, לשימוש ה-Edge Function בלבד.

```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=... APP_ORIGIN=https://dubid.dubelteam.com
```

---

## 5. בסיס הנתונים

```bash
psql "$DATABASE_URL" -f db/01_schema.sql
psql "$DATABASE_URL" -f db/02_dubid_captain.sql
psql "$DATABASE_URL" -f db/03_seed_squads.sql
```

הסיד **אידמפוטנטי** — אחרי עדכון `scripts/squads.source.json` מריצים
`npm run build:squads` ואז את הקובץ שוב, ורק ההפרש מתעדכן.

פריסת מנוע הניקוד:

```bash
supabase functions deploy score-gameweek
```

---

## 6. תקלות נפוצות ומה באמת גורם להן

| מה רואים | הסיבה | התיקון |
|---|---|---|
| `No Output Directory named "dist"` | Root Directory מצביע על תת-תיקייה | Settings → General → Root Directory = `./` |
| `npm ci can only install with an existing package-lock.json` | ה-lock לא ב-git | `git add package-lock.json` |
| `Cannot find module '.../x.ts'` | הריצו tsc בלי `allowImportingTsExtensions` | הוא כבר מוגדר ב-`tsconfig.json` — אל תסירו |
| 404 ברענון של `/card` | אין rewrite ל-SPA | מטופל ב-`vercel.json` |
| הפריסה עברה אבל המסך ישן | Service Worker שמור במטמון | ה-header `no-cache` על `/sw.js` ב-`vercel.json` פותר; פעם אחת נקו דרך DevTools → Application → Unregister |
| הכפתור התחתון נחתך באייפון | חסר `viewport-fit=cover` | קיים ב-`index.html`; בלעדיו `env(safe-area-inset-*)` מחזיר 0 |
| הפונטים לא נטענים | חסימת Google Fonts | הורידו את Heebo/Anton ל-`public/fonts` והחליפו ל-`@font-face` מקומי |
| הטסטים נכשלים ב-CI | Node < 22.6 | `--experimental-strip-types` דורש 22.6+ |

---

## 7. מה קורה בכל push

`.github/workflows/ci.yml` מריץ, לפני ש-Vercel בכלל מתחיל:

1. **`npm run build:squads` + `git diff --exit-code`** — נכשל אם מישהו
   ערך ידנית את `src/data/squads.ts` במקום את ה-JSON. זה מונע מצב
   שהדאטה בקוד וה-SQL מתפצלים.
2. `npm run typecheck`
3. `npm test` — 60 טסטים
4. `npm run build`

Vercel בונה במקביל. אם רוצים ש-CI יחסום פריסה: Settings → Git →
Ignored Build Step, או Deployment Protection.
