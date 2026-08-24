# סנכרון דוביד ↔ אופסיידס

**למי זה נכתב:** לעצמי, בפעם הבאה שאני נכנס לפרויקט אופסיידס.
כל מה שצריך כדי לחבר את שני המוצרים בלי לגזור מסקנות מחדש.

**תאריך:** אוגוסט 2026 · **פרויקט Supabase:** `afxpjfxwpdjvlmuoawda`

---

## 0. תקציר בעשר שניות

פרויקט Supabase אחד. `auth.users` משותף. הפרדה מלאה בסכימות.
אופסיידס ב-`public`, דוביד ב-`core`/`game`, גשר צר ב-`shared`.

הצד של דוביד **כבר רץ ונבדק על PostgreSQL אמיתי**. הצד של
אופסיידס עדיין לא הועבר. הפרויקט מחובר ל-GIT של אופסיידס.

---

## 1. מפת הסכימות

```
auth.users        ← זהות משותפת. חשבון אחד, שתי אפליקציות.
public.*          ← אופסיידס:  profiles, matches, arenas, bets,
                    flash_questions, question_bank, friendships…
core.*            ← דאטת כדורגל משותפת:  leagues, seasons, teams,
                    players, squads, weekly_matches, match_events
game.*            ← דוביד:     gameweeks, user_lineups, lineup_scores,
                    leagues (זירות), audit_logs
shared.*          ← הגשר:      reward_grants + שתי פונקציות. זהו.
```

ההפרדה נאכפת בארבע שכבות בלתי תלויות: סכימות · Exposed schemas ·
`db.schema` בקליינט · RLS. גם אם שלוש נכשלות, השורה מוגנת.

---

## 2. ★ `public.server_now()` — קראו את זה לפני שנוגעים

**שני המוצרים קוראים לאותה פונקציה.**

| | קורא | מצפה ל |
|---|---|---|
| דוביד | `src/lib/serverTime.ts` | `bigint`, epoch ms |
| אופסיידס | `src/lib/serverTime.js` → `Number(data)` | epoch ms |

הם **כבר מסכימים**. אין מה לתקן.

### הבור שכמעט נפלתי לתוכו

הגרסה הראשונה של `db/08` "קיבעה" אותה כ-`TIMESTAMPTZ`. PostgreSQL
עצר את זה:

```
ERROR: cannot change return type of existing function
```

אילו הוספתי `DROP FUNCTION` לפני — זה היה עובר בשקט, ואופסיידס היה
מקבל `Number("2026-08-24 12:00:00+00")` = **NaN**. השעון שלו היה
נשאר על היסט 0, בלי אף שגיאה, וכל ספירה לאחור — נעילת הימורים,
תפוגת boost, ריסט יומי — הייתה זזה לפי שעון המכשיר של המשתמש.

`db/08` היום רק **בודק**. אם מישהו יחליף את טיפוס ההחזרה, הוא
נכשל בהודעה שמסבירה בדיוק את זה.

**כלל:** לא לגעת ב-`public.server_now()`. אף פעם. משום צד.

---

## 3. סדר ההרצה בפרויקט הנקי

```
db/01_schema.sql              ליבה: ליגות, קבוצות, שחקנים, מחזורים
db/02_dubid_captain.sql       קפטן/סגן + עמודות ניקוד
db/03_seed_squads.sql         14 קבוצות, 351 שחקנים
db/04_ranking_and_events.sql  לוג אירועים + דירוג + יומן ביקורת
db/05_gameweek_lock.sql       נעילה סמכותית + server_now
db/06_private_leagues.sql     זירות
db/07_shared_supabase.sql     הרשאות + זהות + גשר פרסים
db/08_offsides_coexistence.sql  בדיקות דו־קיום + pending_rewards
```

ואז: **Settings → API → Exposed schemas** → `public, core, game, shared`.
בלי זה כל שאילתה מחזירה 404.

בדיקה אחת שאומרת הכל:

```sql
SELECT * FROM shared.integration_health;
```

`offsides_restored = false` כל עוד חצי מהפרויקט חסר.

---

## 4. איך מביאים את אופסיידס

**את הסכמה של אופסיידס אי אפשר לכתוב מהזיכרון.** היא לא קיימת
באף קובץ שיש לי — לא ב-zip ולא בריפו.

> ⚠ המיגרציות שיושבות בריפו של אופסיידס תחת `supabase/migrations/`
> (`0001_schema.sql`, `0002_rls.sql`) הן **של פרויקט אחר**. הן
> יוצרות `cities`, `venues`, `bookings`, `experiences`. אם
> אינטגרציית ה-GIT מריצה מיגרציות — ייווצרו טבלאות זרות בפרויקט.
> **למחוק או להעביר אותן לפני שמחברים.**

```bash
# 1. דאמפ מהפרויקט החי
pg_dump "postgresql://postgres:<סיסמה>@db.<ישן>.supabase.co:5432/postgres" \
  --schema=public --no-owner --no-privileges -f offsides_public.sql

# 2. לבדוק התנגשות לפני השחזור
grep -nE 'FUNCTION public\.server_now' offsides_public.sql
#    יש תוצאה?  להשוות חתימות לפני שמריצים. ראו סעיף 2.

# 3. שחזור
psql "postgresql://postgres:<סיסמה>@db.afxpjfxwpdjvlmuoawda.supabase.co:5432/postgres" \
  -v ON_ERROR_STOP=1 -f offsides_public.sql

# 4. db/08 שוב — עכשיו יש לו מה לבדוק
```

מה **לא** מגיע בדאמפ הזה: cron jobs (`cron.job`), webhooks, ו-Storage
buckets. אם לאופסיידס יש כאלה — הגדרה מחדש ידנית.

---

## 5. ה-Edge Function

**הבעיה:** הפרויקט מחובר ל-GIT של אופסיידס. אינטגרציית ה-GIT פורסת
את `supabase/functions/` **של אותו ריפו**. הפונקציה של דוביד לא
הייתה שם, ולכן כל קריאה נכשלה.

**הפתרון:** הפונקציה חיה בריפו של אופסיידס, ועומדת בפני עצמה.

```bash
# בריפו של דוביד
npm run export:edge
# → dist-edge/supabase/functions/dubid-score-gameweek/
```

להעתיק אל `<offsides-repo>/supabase/functions/` ולדחוף.

### שלוש החלטות שכדאי לזכור

1. **השם `dubid-score-gameweek`** ולא `score-gameweek`. ריפו משותף,
   ולשני המוצרים יש ניקוד. תחילית לפי מוצר, בדיוק כמו הסכימות.
2. **`./_lib/`** ולא `../_shared/` ולא `../../src/`. ה-bundler רואה
   רק את תיקיית הפונקציה, ועורך ה-Dashboard לא מאפשר קבצים מעליה.
3. **`export:edge` נכשל אם מישהו יוסיף ייבוא שיוצא מהתיקייה.**
   הבדיקה הזו קיימת כי הבאג הזה כבר קרה, פעמיים.

Secrets: `API_FOOTBALL_KEY`, `APP_ORIGIN`.
`SUPABASE_URL` ו-`SUPABASE_SERVICE_ROLE_KEY` מוזרקים אוטומטית.

---

## 6. גשר הפרסים — החוזה

הטבלה **היחידה** ששני המוצרים נוגעים בה: `shared.reward_grants`.

```sql
-- דוביד מעניק (service_role בלבד — לא מהקליינט!)
SELECT shared.grant_reward(
  p_auth_id := '<uuid>',
  p_source  := 'dubid',
  p_target  := 'offsides',
  p_kind    := 'smoke_grenade',
  p_amount  := 1,
  p_reason  := 'gameweek_win',
  p_key     := 'dubid:gw2:win:<uuid>'   -- ★ מפתח אידמפוטנטיות
);

-- אופסיידס קורא
SELECT * FROM public.pending_rewards();

-- אופסיידס מממש, אחרי שזיכה את המשתמש בטבלאות שלו
SELECT shared.claim_reward('<grant-id>');
```

### מה שאין כאן, בכוונה

אין פונקציה שמזכה יתרת 💨. דוביד אומר "מגיע לו"; **אופסיידס** מחליט
כמה זה שווה ומתי לזכות, בטבלאות שלו ובקוד שלו. שני מוצרים, גבול אחד.

`idempotency_key` הוא `UNIQUE` ברמת המסד. retry של cron או לחיצה
כפולה מחזירים את אותה הענקה בדיוק, לא שתיים.

---

## 7. תוכנית השיווק הצולבת — מה אופסיידס צריך לקרוא

דוביד שולח משתמשים עם שיוך מלא בכתובת:

```
https://offsidebets.dubel.team/?ref=dubid&src=<placement>&v=<promo>&gw=<n>
```

| פרמטר | ערכים | מה זה אומר |
|---|---|---|
| `ref` | `dubid` | מאיזה מוצר |
| `src` | `lobby` · `locked` · `result` | מאיזה מסך |
| `v` | `just-locked` · `kickoff-soon` · `beaten` · `champion` · `idle` | איזה רגע |
| `gw` | מספר | איזה מחזור |

**אין בכתובת שום מזהה אישי.** יש בדיקה שמוודאת את זה
(`tests/growth.test.ts`).

מה שכדאי לעשות בצד אופסיידס: לשמור את השלושה האלה על הפרופיל
בכניסה ראשונה (`campaign_source`), ולהתאים את מסך הנחיתה. משתמש
שהגיע עם `v=beaten` בא עם הפסד טרי — כדאי שהמסך הראשון יציע לו
זירה שמתחילה בקרוב, לא הסבר על המשחק.

הצד של דוביד: `src/lib/growth.ts`. טהור, בלי DOM ובלי שעון, 16
בדיקות. הבחירה **דטרמיניסטית** — אותו הקשר נותן תמיד אותו מסר.

---

## 8. מה לא לעשות

| ✗ | למה |
|---|---|
| לשנות את טיפוס ההחזרה של `public.server_now()` | שובר את שעון אופסיידס בשקט (NaN) |
| ליצור טבלאות של דוביד ב-`public` | ההפרדה היא כל הביטחון |
| להריץ את `supabase/migrations/000*.sql` שבריפו של אופסיידס | הן של פרויקט אחר |
| לתת `grant_reward` ל-`authenticated` | כל לקוח יעניק לעצמו פרסים |
| לייבא מ-`../../src/` בתוך Edge Function | הפריסה נכשלת. `export:edge` יעצור |
| למזג את הניקוד של שני המוצרים | סולמות שונים, משחקים שונים |

---

## 9. מה שנשאר פתוח ודורש החלטה

1. **מתי דוביד מעניק פרס?** הגשר בנוי, אבל אף אחד לא קורא ל-
   `grant_reward` עדיין. צריך להחליט: ניצחון במחזור? ניצחון בזירה?
   רצף? וכמה 💨 כל אחד שווה — זו החלטה של אופסיידס, לא של דוביד.
2. **מיזוג זהויות.** משתמש שיש לו חשבון אופסיידס ואורח בדוביד —
   `game.users.auth_id` מוכן לזה, אבל אין עדיין מסך שמבצע את החיבור.
3. **האם `core.*` צריכה לשרת גם את אופסיידס.** לאופסיידס יש
   `matches` משלו ב-`public`. איחוד יחסוך סנכרון כפול של פיקסצ׳רים,
   אבל הוא שינוי גדול. **לא עכשיו** — כן לשמור על הגבול נקי.

---

## 10. הצעה לפתיחת הצ׳אט הבא

> "אני ממשיך על אופסיידס. הפרויקט עבר ל-Supabase המשותף עם דוביד.
> תקרא את `docs/OFFSIDES-SYNC.md` ותעדכן את עצמך לפני שאתה עונה."
