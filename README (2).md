# בדיקות SQL

הבדיקות כאן רצות על PostgreSQL אמיתי, לא על הנחות.

## למה זה קיים

`game.submit_lineup` הוא **נתיב הכתיבה היחיד** של הרכבים. הוא היה
שבור: שתי עמודות בשמות לא נכונים (`v_player.position` במקום
`primary_position`, ו-`squads.price` במקום `fantasy_price`).

הנעילה עצמה עבדה מצוין — הגשה אחרי הדדליין נדחתה כמו שצריך —
ולכן כל בדיקה שבודקת רק את מקרה הכישלון הייתה עוברת. **אף הרכב
תקין לא יכול היה להישמר.**

הלקח: בדיקה שבודקת רק שהשער נעול לא מגלה ששום דבר לא עובר בו.

## הרצה

צריך PostgreSQL 14+ מקומי. אין תלות ב-Supabase.

```bash
initdb -D /tmp/pgdata -U postgres -A trust
pg_ctl -D /tmp/pgdata -o "-k /tmp/pgrun -p 5433" start
createdb -h /tmp/pgrun -p 5433 -U postgres dubid_test

PSQL="psql -h /tmp/pgrun -p 5433 -U postgres -d dubid_test -v ON_ERROR_STOP=1"
$PSQL -f db/tests/00_supabase_stub.sql   # חיקוי auth.users / auth.uid()
for f in db/0*.sql; do $PSQL -f "$f"; done
$PSQL -f db/tests/submit_lineup.test.sql
```

## מה נבדק

| # | מקרה | ציפייה |
|---|---|---|
| 1 | הגשה אחרי הדדליין | `DEADLINE_PASSED` |
| 2 | הרכב תקין לפני הדדליין | `submitted` |
| 3 | חמישה שחקנים מאותה קבוצה | `one_player_per_team` |
| 4 | מחזור שנעול בסטטוס | `GAMEWEEK_LOCKED` |

בנוסף: כל שמונת קובצי ה-SQL הורצו שלוש פעמים ברצף על מסד נקי
כדי להוכיח אידמפוטנטיות. שלוש הצהרות DDL לא היו אידמפוטנטיות
(`CREATE DOMAIN`, `CREATE TYPE`, `CREATE TRIGGER`) ותוקנו.
