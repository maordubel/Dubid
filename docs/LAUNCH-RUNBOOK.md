# DUBID · נוהל הפעלה אחד (מעודכן 27.10.2026)

> זה מקור ההוראות היחיד. `GO-LIVE.md` (התקנה ראשונה), `INGEST.md` ו-`AUTOMATION-P0.md`
> הם רקע היסטורי — כשיש סתירה, המסמך הזה קובע.

## 1. מה רץ לבד (בלי אדם)

```
pg_cron */10  game.ingest_tick()      → לכל ליגה פעילה: המסד בוחר מחזור (db/56)
                                         → dubid-ingest { league, round } → 365scores
                                         → ingest_snapshot · טבלת ליגה רשמית (db/57)
pg_cron */5   game.lifecycle_tick()   → draft→open→locked→live→scoring→published
                                         → פרסום: dubid-score-gameweek → publish_scored_gameweek
                                         → :05 — מחזור חופף; השלמה לליגה הנכונה
pg_cron 2-59/5 game.house_tick()      → משתתפי בית (db/60): מתכנן 6–13 לכל ליגה ומצב
                                         במחזור פתוח, ומגיש כל אחד בזמן שלו
```

**מי בוחר איזה מחזור נסרק:** המסד, לא הספק. המחזור הוותיק ביותר שלא פורסם בכל
ליגה (`game.ingest_target`). הספק נשאל רק כשאין מחזור כזה (תחילת עונה).

**שערים לפני פרסום** (כולם אוטומטיים):
- כל המשחקים נגמרו (נדחה/הופסק — לא נספר, ומוצג למשתמש כ"לא נספר").
- שחקן נבחר בלי נתונים → DNP אוטומטי אם הספק מכיר אותו; אחרת חוסם.
- משחק שנגמר בלי סטטיסטיקה לאחד הצדדים → חוסם 14 שעות מהבעיטה, ואז warn.
- טביעת אצבע יציבה 45 דקות; אפס התראות חוסמות; ספירת ציונים = ספירת הגשות.

**חוקי ניקוד:** מוקפאים לכל מחזור ברגע שהוא נפתח (`game.gameweek_rules`, db/58).
שינוי איזון בלוח הניהול חל מהמחזור הבא.

## 2. בדיקת בריאות — שאילתה אחת לכל שאלה

```sql
SELECT game.ingest_targets_report();              -- מה כל ליגה תסרוק עכשיו
SELECT * FROM game.v_ingest_health;               -- מיפויים, חוסמים, ריצה אחרונה
SELECT gw_code, kind, severity, detail
  FROM game.ingest_alerts WHERE cleared_at IS NULL ORDER BY created_at DESC;
SELECT code, status, is_current, lock_at FROM game.gameweeks
 WHERE status NOT IN ('published','archived') ORDER BY league_id, number;
```

## 3. מתי צריך אדם

| התרעה | משמעות | פעולה |
|---|---|---|
| `stale_match_status` | משחק לא נסגר 36 שעות אחרי הבעיטה | לבדוק את המשחק באתר רשמי; אם נדחה — לסמן `postponed` בלוח הניהול |
| `unmapped_in_lineup` | שחקן שנבחר לא ממופה לספק | מסך "שחקנים שלא מופו" → אישור בקליק |
| `source_disagreement` | שני מקורות חולקים על תוצאה | לבדוק ידנית; המחזור מחכה |
| `changed_after_publish` | נתון זז אחרי פרסום | לא משנה ניקוד לבד. תיקון — רק במכוון |
| `stuck_in_scoring` | 24 שעות ב-scoring | לקרוא את ההתרעה החוסמת שמעליה |
| באנר Supabase "read-only mode" | תוכנית Free: מסד > 500MB או דיסק > 95% — **אין הגשות, אין קליטה** | `SELECT pg_size_pretty(pg_database_size('postgres'));` אם מתחת ל-500MB: ב-SQL Editor `set session characteristics as transaction read write; set default_transaction_read_only = 'off';` · אחרת לפנות נתונים או לשדרג ל-Pro |

תיקון חוקים חריג למחזור פתוח: `game.admin_refreeze_gameweek_rules(code, reason)` —
אדמין בלבד, לפני פרסום, נרשם ביומן עם הסיבה.

**לוח הניהול (db/62):** לשונית «ליגות» = מצב ארבע הליגות (אנשים / בית בנפרד). הפס בראש הלוח
קובע על איזו ליגה עובדים — מחזורים, סגלים, תוצאות ויצירת מחזור (קידומת הליגה).

## 4. פריסה

- **מסד:** מיגרציה חדשה → `node scripts/build-all-sql.mjs` → `db/RUN-ALL.sql`.
  בייצור מריצים רק את הקבצים החדשים (לא את RUN-ALL כולו — יש בו זרעים).
- **Edge Functions:** המקור ב-`supabase/functions/*/_src/` + `ecosystem/feed/`.
  `node scripts/bundle-edge.mjs` מפיק `index.ts` אחד לכל פונקציה; פורסים אותו.
- **אתר:** Vercel מ-`main`.

## 5. נסיגה

| רכיב | איך |
|---|---|
| בחירת מחזור (db/56) | אין צורך בנסיגה: בלי מחזור פעיל → נופל לספק כמו קודם |
| טבלת ליגה (db/57) | `DELETE FROM core.league_standings WHERE league_id = …` → המדור מוסתר |
| חוקים מוקפאים (db/58) | לא מוחקים תמונות. מחזור בלי תמונה ננקד כמו קודם |
| משתתפי בית (db/60) | `SELECT game.admin_house_set(false);` (או כפתור בלוח הניהול) — מפסיק הגשות חדשות; קיימות נשארות |
| מסכים | גרסת Vercel קודמת — ה-API תואם לאחור |

## Connected Football — links from FAN LIFE (27.10.2026)

FAN LIFE sends players here as
`/?league=<CODE>&format=<five|full|any>&gw=<gameweekId>&from=fanlife&club=<slug>&lang=<en|he|el>&src=<hub|club|gate>`
(+ `eh=` handoff token). Old links with only `league/from/club` still work. All params are stripped from the address
on load (`src/lib/league.ts → takeIncomingLeague`) and kept in memory + sessionStorage for the tab.

- **League** is decided before live data hydrates (`resolveIncoming`, boot waits ≤2.5 s). If `leagues_public` fails,
  the intent is kept and the visitor sees "We couldn't load the league you came for · Try again" — it is never read as
  "no such league". A first visit switches (one reload); a player of another league is asked.
- **format/gw** (`planLanding`): `five`/`full` open that builder; a format that cannot submit lands on the open one
  with one line; a `gw` that is no longer current lands on the current round with one line ("Round N is now open/locked").
  These never fail a landing.
- **Back link** (Lobby): `fanlife.dubelteam.com/clubs/<club>?lang=<lang>`, or the FAN LIFE home for `src=hub` / no club.
- **Outcome**: after a confirmed line-up DUBID calls `shared.handoff_outcome('dubid','lineup_submitted')`
  (ecosystem/sql/0006, contract v9 — applied centrally, not from this repo). Fire-and-forget; a missing function or
  no handoff is harmless. Read it in `shared.v_handoff_outcome` (service role).
- No admin control is needed: nothing here writes DUBID tables; the switch-off is FAN LIFE not sending the params.

## מונים והמחזור הבא (db/66, 27.10.2026)

**הגדרות (אחידות בכל המסכים ובשלוש השפות):**
- **managers / מאמנים** — זהויות ייחודיות (`user_id`) עם הגשה תקפה במחזור.
- **lineups / הרכבים** — שורות הגשה תקפות (מי שהגיש בשני המצבים = 2).
- הגשה תקפה = `status IN ('submitted','locked','scored')`; טיוטה לא נספרת; הגשה שנמשכה יוצאת מהמונה.
- ★ החלטת בעלים: בציבור כל המשתתפים נספרים ומוצגים אותו דבר. הפיצול אנושי/בית — רק באדמין (מבט-על הליגות, דוח משתתפי בית).

**מקורות:** `round_pulse` (v2: `overall`, `byMode`, `window24h`; שדות v1 נשמרו), `gameweek_state.managers/lineups`, `leagues_public.managers/lineups`. פונקציית העזר `round_counts` סגורה ל-anon.

**המחזור הבא:** `next_round` מחזיר רק מאותה עונה; סוף עונה = "Next round not announced yet". הלקוח (`roundContext.ts`) שומר תוצאה 60 שניות, בקשה אחת לכל מחזור, מתבטל כש-`gameweeks`/`weekly_matches` משתנים, ומבחין בין loading / empty / error. אחרי כשל מוצג הנתון הקודם עם "Could not refresh"; אחרי 5 דקות — רק שגיאה + Retry.

**בדיקה:** `SELECT game.round_pulse('<code>')->'overall';` מול `SELECT count(DISTINCT user_id), count(*) FROM game.user_lineups WHERE gameweek_id=… AND status<>'draft';`

**נסיגה:** הלקוח הקודם עובד מול db/66 (השדות הישנים קיימים). להחזרת next_round לגרסה הקודמת — להריץ מחדש את db/61.

## שמות שחקנים באנגלית (db/67, 27.10.2026)

- **מקור:** סגלי 365scores לאותו אתלט בעברית (langId=2) ובאנגלית (langId=1). מילוי רק בתוך אותה קבוצה, לפי שם עברי מנורמל, ורק בהתאמה ייחודית. לא נוגע ב-id, מועדון, מחיר, עמדה או תוצאות; כותב `names.en.full` רק כשחסר. כל מילוי נרשם ב-`audit_logs` (`name_en_fill`).
- **אדמין → כל הליגות → "שמות שחקנים באנגלית":** כיסוי, רשימת החוסרים, וכפתור "משיכה מהספק והשלמה" (pg_net; ~10 שניות). להריץ אחרי כל עדכון סגל.
- **ידני (SQL):** `SELECT game.names_fetch('IL_PREMIER');` → כמה שניות → `SELECT game.names_apply('IL_PREMIER');`
- **מצב 27.10:** IL — 304 מתוך 402 מולאו; 98 נשארו (כתיב שונה בין המקורות / שחקן שלא בסגל הספק). במסך אנגלי הם מוצגים בעברית (אין TBD), ומופיעים בדוח.
- **חיפוש בבורר:** לפי כל השמות (he/en/el), מנורמל. שם קצר: משפחה; כפילות במאגר → "N. Cohen"; עדיין כפול → שם מלא.
- **תצוגת רשימה:** מתג מגרש/רשימה בשורת הבקרה; אותה טיוטה, העדפה נשמרת מקומית בלבד.

## "Use last round's lineup" (db/68, 27.10.2026)

- `game.my_previous_lineup(code, mode)` — קריאה בלבד, רק `auth.uid()`, אותה ליגה+עונה+מצב, המחזור האחרון שננעל לפני היעד, רק הגשה רשמית.
- ההעתקה נבדקת בלקוח מול נתוני היעד (מועדון/עמדה/מחיר של היום), ונשמרת **כטיוטה** דרך `save_draft`. אין submit. Undo מחזיר את הטיוטה הקודמת (15 שניות).
- סטטוס השמירה בפס המחזור מתייחס לגרסה האחרונה: "…" שומר, "✓" רק כשהגרסה הנוכחית אושרה, "Could not save · Retry" בכשל.
- כיבוי בלי אובדן נתונים: להסיר את `copyFromGw` ב-App (הכפתור נעלם; אין טבלה חדשה).
