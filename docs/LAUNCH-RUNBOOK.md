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
