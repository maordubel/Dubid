# DUBID · התקנה, אימות, ותפעול

**מסמך אחד. עוברים עליו מלמעלה למטה, ואחרי כל שלב יש בדיקה
שאומרת אם הוא עבד.**

עודכן: אוגוסט 2026 · פרויקט דוביד: `afxpjfxwpdjvlmuoawda`

---

## איך לקרוא את המסמך

| סימן | מה זה |
|---|---|
| ▸ | פעולה שצריך לעשות |
| ✔ | **הבדיקה** — איך יודעים שזה עבד |
| ⚠ | טעות נפוצה, או משהו שאי אפשר לתקן אחר כך בקלות |

הסדר לא שרירותי. שלב 4 יכשל אם שלב 2 לא הושלם, וכן הלאה.

---

# שלב 0 · לפני הכל

▸ להריץ מקומית ולוודא שהאפליקציה עולה:

```bash
npm install
npm run dev
```

✔ נפתח `http://localhost:5173`, רואים את הלובי עם הלוגו. **אין
מסך לבן.**

⚠ אם יש מסך לבן — לפתוח DevTools → Console. שגיאה אדומה שם היא
באג בקוד, ואין טעם להמשיך לשלבים הבאים לפני שהיא נפתרת.

▸ בנייה לייצור — הבדיקה שאני **לא** יכולתי להריץ:

```bash
npm run build
```

✔ מסתיים ב-`built in …` בלי שגיאות, ונוצרת תיקיית `dist/`.

⚠ זו הבדיקה היחידה במסמך שלא רצה אצלי (הסביבה שלי חוסמת את
`registry.npmjs.org`). אם היא נכשלת — זה המקום היחיד שבו סביר
שתמצא בעיה שלא נתפסה.

---

# שלב 1 · המסד

## 1.1 סדר ההרצה

ב-Supabase → **SQL Editor**, קובץ אחרי קובץ, לפי הסדר:

| # | קובץ | מה הוא עושה |
|---|---|---|
| 1 | `db/01_schema.sql` | ליבה: ליגות, קבוצות, שחקנים, מחזורים |
| 2 | `db/02_dubid_captain.sql` | קפטן/סגן + פונקציות ניקוד |
| 3 | `db/03_seed_squads.sql` | 14 קבוצות · 351 שחקנים · **מחירים** |
| 4 | `db/04_ranking_and_events.sql` | לוג אירועים, דירוג, יומן ביקורת |
| 5 | `db/05_gameweek_lock.sql` | נעילה סמכותית + `server_now` |
| 6 | `db/06_private_leagues.sql` | טבלאות הזירות |
| 7 | `db/07_shared_supabase.sql` | הרשאות + פרופיל |
| 8 | `db/09_live_mvp.sql` | הגשות, תוצאות, אדמין, RLS |
| 9 | `db/10_accounts.sql` | הרשמה, אורחים, שמות משתמש |
| 10 | `db/11_arena_and_squads.sql` | זירות בשרת + עריכת סגלים + **תקציב** |
| 11 | `db/12_admin_access.sql` | **כניסת אדמין בסיסמה אחת** |

⚠ **אין `db/08`.** הוא נכתב לארכיטקטורה של פרויקט משותף שכבר לא
קיימת. לדלג.

⚠ **אין יותר `db/schema.sql`.** הוא היה עותק ישן ולא־אידמפוטנטי
של `01`, והוא זה שנתן את השגיאה:

```
ERROR: 42710: type "i18n_name" already exists
```

הקובץ נמחק מהחבילה. **אם כבר הרצת אותו — לא נגרם נזק.** פשוט
להמשיך מ-`01_schema.sql`; הוא בנוי לרוץ מעל מצב חלקי ולסיים אותו.
בדקתי בדיוק את התרחיש הזה.

## 1.2 הבדיקות

```sql
SELECT * FROM game.v_health;
```

✔ מצופה:

```
teams  players  active_squad_rows  coded_gameweeks  matches  id_mappings
  14      351          351                1             7        366
```

```sql
SELECT * FROM game.v_accounts_health;
```

✔ `missing_username = 0` · `duplicate_usernames = 0`

```sql
SELECT * FROM game.v_arena_health;
```

✔ `orphan_leagues = 0` · **`players_without_price = 0`**

⚠ אם `players_without_price` גדול מ-0 — התקציב של דוביד 5 לא
נאכף בשרת. להריץ שוב את `db/03_seed_squads.sql` (הוא אידמפוטנטי).

## 1.3 חשיפת הסכימות

▸ **Settings → API → Exposed schemas** → להוסיף:

```
public, core, game, shared
```

✔ בדיקה מהדפדפן — פותחים את האפליקציה, ובקונסול:

```js
await (await fetch('https://afxpjfxwpdjvlmuoawda.supabase.co/rest/v1/rpc/gameweek_state', {
  method: 'POST',
  headers: {
    apikey: 'sb_publishable_0p3GNCau1Qlcw5jE1pHwqg_btD7458V',
    'Content-Type': 'application/json',
    'Content-Profile': 'game', 'Accept-Profile': 'game',
  },
  body: JSON.stringify({ p_gw_code: 'gw-2' }),
})).json()
```

✔ חוזר אובייקט עם `code: "gw-2"` ו-`serverNow`.

⚠ אם חוזר `404` — הסכימות לא חשופות. זו הטעות שגוזלת הכי הרבה
זמן, כי היא נראית כמו באג בקוד.

---

# שלב 2 · זהות

## 2.1 ספקים

▸ **Authentication → Providers**

| ספק | מצב | למה |
|---|---|---|
| **Anonymous sign-ins** | **דלוק** | ⚠ בלעדיו אין אורחים, ואין מוצר |
| Email | דלוק | הרשמה עם סיסמה |
| Google | דלוק + Client ID/Secret | שלב 2.3 |

## 2.2 כתובות

▸ **Authentication → URL Configuration**

| שדה | ערך |
|---|---|
| Site URL | `https://dubid.dubelteam.com` |
| Additional Redirect URLs | `https://dubid.dubelteam.com`<br>`http://localhost:5173` |

## 2.3 גוגל

**גוגל לא מכירה את הדומיין שלך — היא מכירה רק את Supabase.**

▸ Google Cloud Console → Credentials → **OAuth client ID (Web)**:

| שדה | ערך |
|---|---|
| Authorized redirect URIs | `https://afxpjfxwpdjvlmuoawda.supabase.co/auth/v1/callback` — **רק זה** |
| Authorized JavaScript origins | `https://dubid.dubelteam.com` · `http://localhost:5173` |

▸ להדביק Client ID + Secret ב-Supabase → Providers → Google.

⚠ **לאופסיידס צריך לקוח OAuth נפרד**, כי ה-callback שלו מצביע
לפרויקט אחר.

## 2.4 אישור מייל — החלטה

▸ **Authentication → Providers → Email → Confirm email**

| | דלוק | כבוי |
|---|---|---|
| חוויה | נרשם → בודק מייל → חוזר | נרשם → בפנים |
| למחזור 2 | חיכוך מיותר | **מומלץ** |

הקוד תומך בשניהם בלי שינוי.

## 2.5 הבדיקות

✔ פותחים את האפליקציה בחלון פרטי → **נכנסים בלי טופס**, רואים
"אורח" בראש הלובי.

```sql
SELECT id, is_guest, username FROM game.users ORDER BY created_at DESC LIMIT 3;
```

✔ יש שורה, `is_guest = true`, ו-`username` לא ריק.

✔ לוחצים על שורת הזהות → "החשבון" → "המשך עם גוגל" → חוזרים
מחוברים, ו-`is_guest` הפך ל-`false`.

---

# שלב 3 · אדמין

## 3.1 הכתובת

```
https://dubid.dubelteam.com/admin
```

בפיתוח: `http://localhost:5173/admin`

**סיסמה:** `hapoelTA14!`

הכתובת הישנה `#admin` ממשיכה לעבוד — לא שברתי אותה.

⚠ הנתיב `/admin` עובד כי `vercel.json` מפנה **כל** נתיב
ל-`index.html`. בלי ה-rewrite הזה הוא היה עובד בפיתוח ונשבר
בייצור — הסוג הגרוע ביותר של תקלה.

## 3.2 מה השתנה, ולמה זה חשוב

**לפני:** שני שלבים שלא קשורים זה לזה — קוד במסך שפתח אותו, ו-
`UPDATE game.users SET is_admin = TRUE` ידני ב-SQL Editor שנתן
הרשאה לשמור. מי שעשה רק את הראשון קיבל לוח מלא שבו **כל לחיצה
נכשלת**, וזה נראה כמו באג ולא כמו שלב שנשכח.

**עכשיו:** הסיסמה נשלחת ל-`game.claim_admin` בשרת. אם היא נכונה
— אתה גם נכנס וגם מקבל את ההרשאה. **אין SQL Editor, אין שלב שני.**

★ **והאבטחה?** הבדיקה בשרת היא שקובעת. מי שיערוך את הקוד בדפדפן
יוכל לפתוח את המסך — ולא יוכל לשמור כלום, כי כל פונקציית אדמין
במסד בודקת `game.is_admin()` בשורה הראשונה.

★ **חמישה ניסיונות כושלים → נעילה לחמש דקות**, כולל מול הסיסמה
הנכונה. בלי זה, פונקציה ציבורית שמקבלת סיסמה היא הזמנה לניחוש
אוטומטי.

★ **"יציאה" מכבה גם את הדגל במסד**, לא רק את המסך — אחרת כל
מכשיר שהוקלדה בו הסיסמה נשאר אדמין לנצח.

## 3.3 להחליף סיסמה

```sql
UPDATE game.admin_secrets
   SET secret_hash = encode(digest('הסיסמה-החדשה','sha256'),'hex'),
       rotated_at  = now()
 WHERE id = 'primary';
```

⚠ לעדכן גם את `ADMIN_PIN_HASH` ב-`src/lib/store.ts`, אחרת השער
המקומי ידחה סיסמה שהשרת מקבל.

✔ בדיקה:

```sql
SELECT * FROM game.v_admin_health;
```

## 3.4 ★ בדיקת מערכת — הלשונית שפותרת "אין חיבור לשרת"

לוח הניהול → **"בדיקת מערכת"**. חמש חוליות, בסדר התלות:

| # | חוליה | אם נפלה |
|---|---|---|
| 1 | זהות (כניסת אורח) | Anonymous sign-ins כבוי |
| 2 | סכימה ומיגרציות | לא רצו, או Exposed schemas |
| 3 | תוצאות ונתוני מחזור | `db/09` לא רץ |
| 4 | שעון השרת | `db/09` §3b |
| 5 | הרשאת ניהול | להקליד את הסיסמה |

★ חוליה שתלויה באחת שנפלה מסומנת "—" ולא נבדקת — כדי שלא תרדוף
אחרי חמש שגיאות שכולן נובעות מאותו מקור.

## 3.5 מה אפשר לעשות בלוח

### "תוצאות"

| פעולה | איך |
|---|---|
| תוצאת משחק | שני שדות מספר → "שמירה" |
| סטטיסטיקת שחקן | "הזנת שחקנים" ליד המשחק |
| פרסום | "פרסם דירוג" בראש המסך |

### "סגלים"

| פעולה | איך |
|---|---|
| שינוי מחיר | מקלידים → **יוצאים מהשדה**. נשמר אוטומטית |
| פציעה / הרחקה / עזיבה | לוחצים על שם השחקן |
| העברת קבוצה | לוחצים על השם → "העברה לקבוצה" |
| שחקן חדש | "+ שחקן חדש" |
| חיפוש בכל הליגה | שדה החיפוש למעלה |

✔ כל שינוי נרשם:

```sql
SELECT created_at, action, entity_id, new_value
  FROM game.audit_logs ORDER BY created_at DESC LIMIT 10;
```

⚠ **שחקן חדש לא יופיע בבורר** עד בנייה מחדש של
`src/data/squads.ts`. הוא כן נכנס למסד וההגשות מכירות אותו.

⚠ **שום דבר לא נמחק.** "עזב" סוגר את שורת הסגל; מעבר קבוצה סוגר
שורה ופותח חדשה.

# שלב 4 · Edge Functions

▸ פריסה:

```bash
supabase functions deploy access-code
supabase functions deploy link-offsides
npm run deploy:edge          # dubid-score-gameweek
```

▸ **Settings → Edge Functions → Secrets**:

| שם | ערך |
|---|---|
| `OFFSIDES_URL` | `https://pqdzqpettxuuyngxbpxn.supabase.co` |
| `OFFSIDES_ANON_KEY` | ה-publishable של אופסיידס |
| `APP_ORIGIN` | `https://dubid.dubelteam.com` |

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
מוזרקים אוטומטית — **לא להגדיר אותם ידנית.**

✔ בדיקה: באפליקציה → "החשבון" → "מכשיר חדש" → "הנפקת קוד".
מופיע קוד בן שש תווים.

✔ במכשיר שני (או חלון פרטי) → אותו מסך → מקלידים את הקוד →
**ההרכבים והשם עוברים.**

⚠ זו החתיכה שאני לא יכולתי לבדוק בכלל. אם היא נכשלת, השגיאה
תהיה ב-Logs של ה-Edge Function ולא בדפדפן.

---

# שלב 5 · אופסיידס

▸ בפרויקט **אופסיידס** (`pqdzqpettxuuyngxbpxn`):

1. **Authentication → Providers → Email → Enable Email OTP**
2. להריץ `db/offsides/01_dubid_bridge.sql`

✔ בדיקה:

```sql
SELECT * FROM public.dubid_bridge_health;
```

מצופה: `server_now_ok = true` · `attribution_ready = true`

✔ באפליקציית דוביד → "החשבון" → "אופסיידס" → מקלידים מייל שיש
לו חשבון באופסיידס → מקבלים קוד במייל → מקלידים → מחוברים.

```sql
-- בדוביד:
SELECT display_name, offsides_user_id, linked_at FROM game.users
 WHERE offsides_user_id IS NOT NULL;
```

⚠ אם לא מגיע מייל — Email OTP לא דלוק בצד אופסיידס. זו התלות
היחידה שלנו בהם.

---

# שלב 6 · פריסה

▸ Vercel → **Settings → Domains** → `dubid.dubelteam.com`

▸ **Environment Variables** — כולם אופציונליים (יש ברירות מחדל
בקוד), אבל מומלץ להגדיר במפורש:

```
VITE_SUPABASE_URL=https://afxpjfxwpdjvlmuoawda.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_0p3GNCau1Qlcw5jE1pHwqg_btD7458V
VITE_OFFSIDES_SUPABASE_URL=https://pqdzqpettxuuyngxbpxn.supabase.co
VITE_OFFSIDES_PUBLISHABLE_KEY=sb_publishable_1_YcFqw8irBbV_GhACgX2w_gWMy3SZ1
```

⚠ **`service_role` לעולם לא נכנס ל-Vercel.** מקומו היחיד הוא
Edge Functions → Secrets.

▸ **redirect 301** מ-`offsidebets.dubel.team` ל-`offsides.dubelteam.com`,
אם הישן עדיין חי.

✔ Google Analytics: פותחים את האתר החי → GA4 → Reports →
Realtime. אמור להופיע משתמש אחד תוך 30 שניות.

---

# שלב 7 · המבחן החי

**זו הבדיקה היחידה שבאמת סופרת.** שני מכשירים לפחות, ועדיף שני
אנשים.

| # | פעולה | ✔ מה אמור לקרות |
|---|---|---|
| 1 | שני אנשים נכנסים | כל אחד רואה "אורח", בלי טופס |
| 2 | כל אחד בונה הרכב ומגיש | הכפתור אומר "שולח לשרת…" ואז ההרכב נעול |
| 3 | לרענן את שני המכשירים | ההרכב עדיין שם |
| 4 | להסתכל בדירוג לפני הדדליין | **כל אחד רואה רק את עצמו** |
| 5 | אדמין: להזיז את `lock_at` לעבר | ראו למטה |
| 6 | לנסות להגיש שוב | נדחה: "הדדליין עבר" |
| 7 | לרענן את הדירוג | **שניהם רואים את שתי ההגשות** |
| 8 | אדמין: להזין תוצאות ולפרסם | הדירוג נפתח **בלי לרענן** אצל שניהם |
| 9 | אחד פותח זירה, השני מצטרף בקוד | **שניהם רואים את אותה זירה** |
| 10 | להירשם באחד המכשירים | ההרכב לא נעלם; `is_guest` → `false` |

**שלב 5, בפועל:**

```sql
UPDATE game.gameweeks SET lock_at = now() - interval '1 minute' WHERE code = 'gw-2';
-- ולהחזיר:
UPDATE game.gameweeks SET lock_at = TIMESTAMPTZ '2026-08-29 20:00:00+03' WHERE code='gw-2';
```

⚠ שלב 9 הוא החדש בסבב הזה. עד עכשיו הזירות חיו ב-`localStorage`
ושני אנשים עם אותו קוד הצטרפו לשתי זירות שונות.

---

# תפעול שוטף

## לפני כל מחזור

```sql
-- 1. לפתוח את המחזור
UPDATE game.gameweeks SET status = 'open' WHERE code = 'gw-N';

-- 2. לוודא שהדדליין הוא בעיטת הפתיחה המוקדמת ביותר
SELECT code, status, lock_at FROM game.gameweeks ORDER BY number DESC LIMIT 3;
```

⚠ הדדליין הוא הבעיטה **המוקדמת**, לא המאוחרת. אחרת מי שמחכה
ליום ראשון בוחר אחרי שראה חמישה משחקים.

## אחרי המחזור

1. אדמין → "תוצאות המחזור" → תוצאה לכל משחק
2. "הזנת שחקנים" → דקות, שערים, בישולים, כרטיסים
3. "פרסם דירוג"

✔ `SELECT status, published_at FROM game.gameweeks WHERE code='gw-N';`

## אם טעית בתוצאה

מותר לבטל פרסום, לתקן, ולפרסם שוב — בכוונה. טעות בהזנה היא
תרחיש ודאי, ו"אי אפשר לחזור" הופך טעות קטנה לאסון. הפעולה
נרשמת ב-`game.audit_logs`.

---

# פתרון תקלות

| תסמין | סיבה סבירה | תיקון |
|---|---|---|
| `42710: type already exists` | הרצת `db/schema.sql` הישן | להמשיך מ-`01_schema.sql` |
| 404 על כל קריאה | סכימות לא חשופות | שלב 1.3 |
| הרכב לא נשמר | לא רצה `db/09` | להריץ 09 + 10 + 11 |
| "אין לך הרשאת ניהול" | לא רצה שלב 3.1 | `UPDATE game.users SET is_admin` |
| הרכב חורג מתקציב ומתקבל | `db/03` לא עודכן | `players_without_price` בשלב 1.2 |
| אין אורחים / מסך תקוע | Anonymous sign-ins כבוי | שלב 2.1 |
| מייל אימות מחזיר למקום הלא נכון | Site URL | שלב 2.2 |
| הזירה לא נראית במכשיר שני | לא רצה `db/11` | להריץ 11 |
| **"אין חיבור לשרת" בכניסה** | ראו למטה | `/admin` → "בדיקת מערכת" |
| "הסיסמה לא הוגדרה במסד" | לא רצה `db/12` | להריץ 12 |
| ספירה לאחור לא מדויקת | `server_now` | `SELECT game.server_now();` |

## ★ "אין חיבור לשרת" — מה זה באמת אומר

ההודעה הזו הוחלפה. עכשיו המסך אומר **מה** חסר ולא רק שמשהו
נכשל, כי בפועל כמעט אף פעם אין בעיית רשת:

| מה יוצג | הסיבה | התיקון |
|---|---|---|
| "המסד לא הוגדר עדיין — חסרות מיגרציות" | 09/11/12 לא רצו | שלב 1.1 |
| "הסכימות לא חשופות ב-Supabase" | Exposed schemas | שלב 1.3 |
| "כניסת אורחים כבויה" | Anonymous sign-ins | שלב 2.1 |
| "אין הרשאה לקרוא מהמסד" | GRANT / RLS | להריץ `db/09` |
| "מפתח ה-API לא תקין" | `VITE_SUPABASE_PUBLISHABLE_KEY` | שלב 6 |
| "אין חיבור לאינטרנט" | באמת אין רשת | — |

תקלת הגדרה מוצגת בצהוב ולא באדום: אדום אומר "משהו נשבר", וכאן
משהו פשוט עוד לא הוגדר. **המשחק ממשיך לעבוד מקומית בינתיים.**

📍 **הכי מהיר:** להיכנס ל-`/admin` → "בדיקת מערכת".

## בדיקה מקומית בלי לגעת בייצור

```bash
psql -d dubid_test -f db/tests/00_supabase_shim.sql
for f in db/0{1,2,3,4,5,6,7}_*.sql db/09_*.sql db/1{0,1,2}_*.sql; do
  psql -d dubid_test -v ON_ERROR_STOP=1 -f $f
done
psql -d dubid_test -v ON_ERROR_STOP=1 -f db/tests/01_live_flow.sql
psql -d dubid_test -v ON_ERROR_STOP=1 -f db/tests/02_accounts.sql
psql -d dubid_test -v ON_ERROR_STOP=1 -f db/tests/03_arena_squads.sql
psql -d dubid_test -v ON_ERROR_STOP=1 -f db/tests/04_admin_access.sql
```

⚠ **לעולם לא להריץ את ה-shim על ייצור.** הוא יוצר `auth.uid()`
שאפשר לזייף.

---

# מה עדיין לא נבדק על ידי

בכנות, כדי שתדע איפה להסתכל אם משהו נשבר:

| | למה |
|---|---|
| `npm run build` | הסביבה שלי חוסמת את `registry.npmjs.org` |
| שלוש ה-Edge Functions | דורשות Supabase חי |
| קישור חשבון אופסיידס | דורש את שני הפרויקטים |
| Google OAuth | דורש דומיין חי |
| המבחן הרב-מכשירי | דורש את כל מה שמעליו |

מה שכן נבדק: 222 בדיקות יחידה, `tsc` נקי, רינדור אמיתי של עץ
הקומפוננטות, וכל המיגרציות + שלוש חבילות בדיקת SQL על
PostgreSQL אמיתי.
