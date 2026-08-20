# דוביד שווייצר — תשתית המוצר

פנטזי-ליג מחזורי (Daily Fantasy) על ליגת העל הישראלית, בנוי מהיום הראשון
כך שהוספת ליגה זרה תהיה **שורה בטבלה, לא ענף קוד**.

```
.
├── brand/                     מיתוג
│   ├── concept-1-hamachzor.svg        המחזור — סמל מועדון מצומצם
│   ├── concept-2-dash-monogram.svg    ד״ש — מונוגרמה (המומלץ)
│   ├── concept-3-hakartis.svg         הכרטיס — ספח הרכב
│   └── brand-board.html               פלטה, טיפוגרפיה, כללי מערכת
├── db/schema.sql              PostgreSQL 15+ — מאומת, רץ נקי
├── ingestion/                 שליפת נתונים
│   ├── i18n.py                        נרמול שמות עברית/אנגלית
│   ├── providers/base.py              החוזה שכל ספק מממש
│   ├── providers/api_football.py      מימוש לדוגמה
│   └── sync.py                        מנוע הסנכרון (idempotent)
├── scoring/                   מנוע הניקוד (טהור, 20 טסטים עוברים)
│   ├── models.py  rules.py  validation.py  engine.py
│   └── tests/
└── frontend/                  Mobile First + RTL
    ├── README.md              הסטאק והכללים
    ├── tailwind.config.ts     טוקנים של המותג
    └── src/components/LineupBuilder.tsx
```

---

## שלוש החלטות הארכיטקטורה שקובעות הכול

### 1. ליגה היא דאטה, לא קוד
`core.leagues` מחזיקה `default_locale`, `text_direction`, `timezone`
ו-`squad_size`. `game.scoring_rulesets` מחזיקה את חוקי הניקוד כ-JSONB
עם `version`. ליגה אנגלית עם 15 שחקנים ועד 2 מאותה קבוצה = שתי שורות INSERT.
ראו `scoring/rules.py::EXAMPLE_FOREIGN` — אפס קוד חדש.

### 2. שם הוא אובייקט, לא מחרוזת
```json
{"he": {"full": "עומר אצילי", "short": "אצילי"},
 "en": {"full": "Omer Atzili", "short": "O. Atzili"}}
```
אנגלית היא העוגן (זה מה שה-API מחזיר), עברית היא שכבת התצוגה.
בנוסף: `core.entity_aliases` שומרת כל כתיב חלופי, ו-`core.external_refs`
ממפה מזהי ספקים. שלושתם יחד פותרים את הבעיה האמיתית — ש"Maccabi Tel Aviv",
"מכבי ת״א" ו-"מכבי תל אביב" הם אותה ישות.

עדכון שמות משתמש ב-`names || '{...}'::jsonb` (מיזוג) ולא בדריסה, כדי
שעברית שהוזנה ידנית לא תימחק בסנכרון הבא.

### 3. האילוץ נאכף בשלוש שכבות
"שחקן אחד מכל קבוצה" הוא **כלל המוצר**, ולכן הוא לא סומך על שכבה אחת:

| שכבה | מנגנון | מטרה |
|---|---|---|
| UI | `usedTeamIds` — שחקנים מקבוצה תפוסה מוצגים נעולים | חוויה |
| שירות | `scoring/validation.py` — קודי שגיאה מתורגמים | הגנה |
| DB | `UNIQUE (lineup_id, team_id)` | אמת מוחלטת |

בנוסף, טריגר `game.trg_validate_on_submit` מוודא בהגשה שגודל ההרכב
תואם ל-`squad_size` של הליגה.

---

## מנוע הניקוד

```python
from scoring.engine import ScoringEngine
from scoring.rules import ISRAELI_PREMIER

score = ScoringEngine(ISRAELI_PREMIER).score(lineup, performances, outcomes)
score.total_points        # 122.0
score.to_jsonb()          # ישר ל-game.lineup_scores.breakdown ומשם ל-UI
```

המנוע **טהור** — בלי DB, בלי HTTP. אותם קלטים תמיד מחזירים אותה תוצאה,
כך שאפשר לחשב מחדש מחזור מלפני שנה ולקבל בדיוק את אותו מספר.

**שלושת הרכיבים:**

| רכיב | חישוב |
|---|---|
| ציון אישי | שערים משוקללים לפי עמדה (שוער 10 / מגן 8 / קשר 6 / חלוץ 5), בישול 3, קלין-שיט לפי עמדה (דורש 60 דקות), הצלות, כרטיסים |
| בונוס תוצאה | ניצחון הקבוצה האמיתית +4, תיקו +1 — פר שחקן |
| שער וירטואלי | כל 2 שערים של הקבוצות שבהרכב = +5 |

### נקודת החלטה שדורשת את דעתך

הכלל "כל 2 שערים קבוצתיים = שער וירטואלי" ניתן לשתי פרשנויות, ושתיהן
ממומשות ב-`VirtualGoalRules.aggregation`:

* **`pooled`** (ברירת מחדל) — סוכמים את שערי כל 11 הקבוצות לקופה אחת ומחלקים ב-2.
  11 קבוצות × ממוצע ~1.3 שערים ≈ 14 שערים ≈ **35 נקודות** למחזור.
  נדיב, עקומת ניקוד חלקה, מתגמל בחירת קבוצות מתקפיות.
* **`per_team`** — כל קבוצה לחוד, שאריות נזרקות. אותו מחזור ייתן ~10–15 נקודות.
  קמצני, מתגמל דיוק (בחירת הקבוצה שתכבוש 2+).

`pooled` יוצר משקל של ~30% מהניקוד הכולל לרכיב הזה. אם זה מרגיש לך יותר
מדי — `per_team` או `goals_per_virtual: 3` מאזנים את זה בלי לגעת בקוד.

---

## מה מאומת ומה עדיין לא

**אומת בפועל בסביבה הזאת:**

* `db/schema.sql` רץ נקי על PostgreSQL 16 — כולל דומיין ה-i18n,
  העמודות ה-generated וכל האינדקסים.
* `core.normalize_name('מכבי ת״א')` → `מכבי ת א`; `'Omér Atzili'` → `omer atzili`.
* ניסיון להכניס שני שחקנים מאותה קבוצה נכשל:
  `duplicate key value violates unique constraint "one_player_per_team"`.
* הגשה עם פחות מ-11: `LINEUP_SIZE_INVALID: expected 11, got 1`.
* 20 טסטים למנוע הניקוד עוברים, כולל תרחיש מחזור מלא שחושב ביד
  (אישי 52 · תוצאה 19 · קפטן 16 · וירטואלי 35 = **122**).

**לא אומת — דורש מפתח API אמיתי:**

* `providers/api_football.py` נכתב מול המבנה המתועד של API-Football v3.
  מיפוי השדות (`fixtures/players`, `players/squads`) צריך אימות מול תגובה חיה
  לפני שסומכים עליו. זה הקובץ היחיד שתלוי בספק — החלפת ספק לא נוגעת בשאר.
* `sync.py` דורש `psycopg[binary]`. הלוגיקה נכתבה idempotent אבל לא הורצה
  מול DB עם דאטה אמיתי.

---

## הרצה

```bash
# בסיס נתונים
createdb dovid && psql dovid -f db/schema.sql

# טסטים למנוע הניקוד
pytest -q                       # או: python scoring/tests/run_tests.py

# סנכרון סגלים
export API_FOOTBALL_KEY=...
python -m ingestion.sync --league IL_PREMIER --season 2026/27 --what squads
```

## הצעדים הבאים לפי סדר עדיפות

1. **לאמת את מיפוי ה-API** מול תגובה חיה של מחזור אחד. זו הנקודה
   הכי סבירה לשבירה, והיא חוסמת הכול.
2. **להזין את מילון השמות בעברית** — `ISRAELI_TEAMS_HE` ב-`i18n.py` הוא seed
   לקבוצות; שחקנים דורשים פאנל אדמין. תכננו לזה יומיים.
3. **להחליט על `aggregation`** של השער הווירטואלי — זו החלטת איזון מוצר.
4. **לבחור קונספט לוגו** ולהעביר למעצב/ת לחידוד. הווקטורים כאן הם בסיס עבודה.
5. **Playwright snapshots ב-RTL וב-LTR** לכל מסך, לפני שנכנס קוד UI נוסף.
