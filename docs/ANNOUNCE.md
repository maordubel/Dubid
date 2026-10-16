# DUBID · הודעות מחזור בטלגרם

`db/35_announce.sql` — תור יוצא (`game.announce_outbox`). `announce_scan()` מכניס שורה אחת לכל אירוע:
opened · reminder (3 שעות לנעילה) · locked · published (תוצאות + טבלת מחזור + מצטברת) · alert · stuck.
`dedupe_key` ייחודי — אי אפשר לשלוח אותה הודעה פעמיים.

המסד לא שולח. `.github/workflows/announce.yml` רץ כל 15 דקות, `scripts/announce/run.mjs` לוקח שורות
(`announce_claim`), מצייר כרטיס 1080×1350 (opened, published) ושולח לטלגרם, ומסמן (`announce_mark`).
שליחה שלא ידוע אם יצאה → `unknown`, לא נשלחת שוב אוטומטית. בדיקה: `select * from game.v_announce_health`.

## מה צריך להגדיר (פעם אחת)
1. להריץ `db/35_announce.sql` ב-SQL Editor (או `RUN-ALL.sql` מחדש).
2. GitHub → Settings → Secrets → Actions של הריפו: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`
   (אותו בוט של FAN LIFE).
3. הצ'אט נקרא אוטומטית מ-Final Whistle (אותו פרויקט Supabase). אחרי Link Telegram שם — אין עוד צעד.
   לצ'אט אחר: secret `DUBID_TELEGRAM_CHAT_ID`.
