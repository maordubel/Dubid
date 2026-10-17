# DUBID — Automation P0 (שער פרסום)

## מה השתנה
- `db/36_publish_gate.sql`: `game.publish_scored_gameweek` — פרסום אטומי. מסרב (כערך, לא חריגה) אם: כשלי הרכבים, מספר ציונים ≠ מספר הגשות, נתונים זזו (fingerprint), התראות חוסמות, המחזור לא ב-`scoring`.
- משחק `postponed`/`abandoned` לא חוסם מחזור; הוא מתפרסם בלעדיו.
- טיוטה שהדדליין שלה עבר ננעלת (`missedOpen` בביקורת).
- מחזור עם משחק גמור בלי סטטיסטיקה חוזר לתור ההשלמה (עד 10 ב-24 שעות).
- `dubid-score-gameweek`: דורש `Bearer service_role`; כל שגיאת קריאה = כישלון; כולל `submitted`; מעמוד הרכבים; **לא מפרסם**.
- `dubid-ingest`: מפרסם רק דרך השער.

## הפעלה (ללא CLI)
1. Supabase → SQL Editor: להריץ `db/RUN-ALL.sql` (אידמפוטנטי).
2. Edge Functions → להדביק `supabase/functions/dubid-score-gameweek/index.ts` ו-`dubid-ingest/index.ts` ולפרוס.
3. GitHub → Settings → Secrets → Actions: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`.

## בדיקות
`npm test`, `npm run typecheck`, `npm run build`, `scripts/test-sql.sh` — כולן רצות ב-CI (`.github/workflows/ci.yml`).
