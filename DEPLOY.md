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
npm test        # 69 טסטים
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
| Install Command | *(השאירו ריק)* | Vercel יבחר לבד: `npm ci` אם יש lockfile, אחרת `npm install` |
| Node.js Version | **22.x** | Settings → General. נדרש בשביל הטסטים |

### ⚠️ בדיקה שלוקחת 10 שניות וחוסכת שעה

פתחו את הריפו ב-GitHub. **בשורש** אתם חייבים לראות ישירות:

```
package.json   index.html   vite.config.ts   vercel.json   src/
```

אם אתם רואים במקום זה **תיקייה אחת** בשם `dubid-web/` — זה מה שנכשל.
זה קורה כשמעלים את התיקייה דרך *Add file → Upload files* בממשק של GitHub.
שתי דרכים לתקן:

* **עדיף:** למחוק את התוכן ולהעלות מחדש את *הקבצים שבתוך* התיקייה, לא את התיקייה.
* **מהיר:** ב-Vercel → Settings → General → **Root Directory** → `dubid-web`.

`package-lock.json` נוצר ב-`npm install` הראשון. אם העליתם דרך הדפדפן
הוא כנראה לא שם — וזה בסדר, כי הסרנו את `installCommand` ו-Vercel
נופל אוטומטית ל-`npm install`. ברגע שתעבדו עם git, הוסיפו אותו:
`git add package-lock.json`.

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
| **`headers[0] should NOT have additional property '//'`** | היה מפתח `"//"` בתור הערה בתוך `vercel.json`. **ל-JSON אין הערות**, ולסכמה של Vercel אין סובלנות למפתח לא מוכר — היא דוחה את כל הפריסה | תוקן. `tests/config.test.ts` מוודא שזה לא יחזור |
| `No Output Directory named "dist"` | Root Directory מצביע על תת-תיקייה, או שהעליתם את התיקייה במקום את תוכנה | ראו "בדיקה שלוקחת 10 שניות" למעלה |
| `npm ci can only install with an existing package-lock.json` | ה-lock לא ב-git | הסרנו את `installCommand` — Vercel יבחר `npm install`. עדיף בכל זאת `git add package-lock.json` |
| הבנייה נכשלת על שגיאת טיפוס | `build` הריץ `tsc` | `build` הוא כעת `vite build` בלבד. בדיקת הטיפוסים רצה ב-CI ולא חוסמת פרודקשן |
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
3. `npm test` — 69 טסטים
4. `npm run build`

Vercel בונה במקביל. אם רוצים ש-CI יחסום פריסה: Settings → Git →
Ignored Build Step, או Deployment Protection.


---

## 8. שני כללים ל-`vercel.json`

1. **אין הערות.** זה JSON, לא JSONC. מפתח כמו `"//"` או `"comment"`
   גורם ל-Vercel לדחות את הפריסה כולה עם
   `should NOT have additional property`. ההסברים חיים כאן, בקובץ הזה.

2. **רק מפתחות מהסכמה.** `headers[]` מקבל אך ורק
   `source` · `headers` · `has` · `missing`, וכל זוג בפנים רק
   `key` · `value`.

`npm test` מריץ את `tests/config.test.ts` שבודק את שני הכללים האלה
על הקובץ האמיתי — כולל שיש fallback ל-SPA, שה-Service Worker לא
נשמר במטמון, ושכל אייקון ב-manifest באמת קיים על הדיסק.
