"""
i18n.py — ניהול שמות דו-לשוניים (עברית/אנגלית) ומעלה.

הבעיה האמיתית בפרויקט הזה היא לא "לתרגם". היא ש-API של כדורגל יחזיר
"Maccabi Tel Aviv", האתר של ההתאחדות יכתוב "מכבי ת״א", והמשתמש יחפש
"מכבי תא". שלושתם אותה ישות. המודול הזה הופך את כולם למפתח אחד.

עקרונות:
  1. אנגלית היא העוגן (מגיעה מה-API), עברית היא שכבת התצוגה.
  2. כל שם נשמר עם וריאנטים: full / short / nickname.
  3. הנרמול חייב להיות דטרמיניסטי וזהה לזה שב-SQL (core.normalize_name).
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Iterable, Mapping

# ---------------------------------------------------------------------------
# נרמול
# ---------------------------------------------------------------------------

# ניקוד וטעמים עבריים: U+0591–U+05C7
_HEBREW_MARKS = re.compile(r"[֑-ׇ]")
# גרש/גרשיים בכל וריאציה — נמחקים לגמרי, כדי ש'מכבי ת״א' יתלכד עם 'מכבי תא'
_QUOTES = re.compile(r"[\"'`׳״‘’“”]")
# מקפים (כולל מקף עברי) — הופכים לרווח, כדי ש'תל-אביב' יתלכד עם 'תל אביב'
_HYPHENS = str.maketrans({c: " " for c in "־-–—"})
_WS = re.compile(r"\s+")
_HEBREW_RANGE = re.compile(r"[֐-׿]")

# תחיליות שלא נושאות מידע מזהה בשם קבוצה ישראלי
_TEAM_STOPWORDS_HE = ("מועדון", "כדורגל", "עמותת")
_TEAM_STOPWORDS_EN = ("fc", "f.c", "sc", "ac", "club", "football")


def is_hebrew(text: str) -> bool:
    return bool(_HEBREW_RANGE.search(text or ""))


def normalize(text: str | None) -> str:
    """
    נרמול תואם ל-core.normalize_name() ב-PostgreSQL.
    'מכבי ת״א'  -> 'מכבי ת א'
    'Omér  Atzili' -> 'omer atzili'
    """
    if not text:
        return ""
    # פירוק והסרה של כל סימני הצירוף — טעמים לטיניים וניקוד עברי כאחד
    # (שניהם בקטגוריה Mn), מקביל ל-unaccent + regexp ב-SQL.
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = unicodedata.normalize("NFC", text)
    text = _HEBREW_MARKS.sub("", text)   # רשת ביטחון לסימנים שאינם Mn
    text = _QUOTES.sub("", text)
    text = text.translate(_HYPHENS)
    text = text.lower()
    return _WS.sub(" ", text).strip()


def team_key(text: str | None) -> str:
    """נרמול אגרסיבי יותר לקבוצות: מסיר מילות מילוי כמו FC / מועדון."""
    norm = normalize(text)
    tokens = [
        t for t in norm.split(" ")
        if t not in _TEAM_STOPWORDS_EN and t not in _TEAM_STOPWORDS_HE
    ]
    return " ".join(tokens)


# ---------------------------------------------------------------------------
# מבנה השם
# ---------------------------------------------------------------------------

LOCALE_FALLBACK: Mapping[str, tuple[str, ...]] = {
    "he": ("he", "en"),
    "en": ("en", "he"),
    "ar": ("ar", "he", "en"),
    "ru": ("ru", "en", "he"),
}


@dataclass(slots=True)
class LocalizedName:
    """
    מייצג את עמודת core.i18n_name.
    ממופה ישירות ל-JSONB: {"he": {...}, "en": {...}}
    """
    values: dict[str, dict[str, str]] = field(default_factory=dict)

    # -- בנייה --------------------------------------------------------------
    @classmethod
    def of(cls, *, en: str, he: str | None = None, **extra: str) -> "LocalizedName":
        obj = cls()
        obj.set("en", full=en)
        if he:
            obj.set("he", full=he)
        for locale, full in extra.items():
            obj.set(locale, full=full)
        return obj

    def set(self, locale: str, *, full: str, short: str | None = None,
            nickname: str | None = None) -> "LocalizedName":
        entry = {"full": full.strip()}
        entry["short"] = (short or _auto_short(full, locale)).strip()
        if nickname:
            entry["nickname"] = nickname.strip()
        self.values[locale] = entry
        return self

    # -- קריאה --------------------------------------------------------------
    def get(self, locale: str = "he", variant: str = "full") -> str:
        for candidate in LOCALE_FALLBACK.get(locale, (locale, "en")):
            entry = self.values.get(candidate)
            if entry and entry.get(variant):
                return entry[variant]
        # מוצא אחרון: כל ערך שקיים
        for entry in self.values.values():
            if entry.get("full"):
                return entry["full"]
        return ""

    def to_jsonb(self) -> dict:
        if "en" not in self.values or not self.values["en"].get("full"):
            raise ValueError("i18n_name דורש שם אנגלי כעוגן (constraint ב-DB)")
        return self.values

    @property
    def aliases(self) -> list[tuple[str, str]]:
        """כל הווריאנטים כ-(locale, alias) — נכנסים ל-core.entity_aliases."""
        out: list[tuple[str, str]] = []
        for locale, entry in self.values.items():
            for value in entry.values():
                if value:
                    out.append((locale, value))
        return out


def _auto_short(full: str, locale: str) -> str:
    """
    שם קצר לתצוגה במובייל (רוחב כרטיס שחקן = 96px).
    עברית: שם משפחה בלבד.  אנגלית: 'O. Atzili'.
    """
    parts = [p for p in full.split() if p]
    if len(parts) < 2:
        return full
    if locale == "he" or is_hebrew(full):
        return parts[-1]
    return f"{parts[0][0]}. {parts[-1]}"


# ---------------------------------------------------------------------------
# מילון תרגום ידני — override על מה שה-API מחזיר
# ---------------------------------------------------------------------------
# ה-API כמעט תמיד יחזיר לטינית בלבד. הטבלה הזאת היא ה-seed לעברית.
# בפרודקשן: להעביר לטבלת core.entity_aliases ולנהל דרך פאנל אדמין.

ISRAELI_TEAMS_HE: dict[str, str] = {
    "maccabi tel aviv": "מכבי תל אביב",
    "maccabi haifa": "מכבי חיפה",
    "hapoel beer sheva": "הפועל באר שבע",
    "hapoel tel aviv": "הפועל תל אביב",
    "beitar jerusalem": "בית\"ר ירושלים",
    "maccabi netanya": "מכבי נתניה",
    "bnei sakhnin": "בני סכנין",
    "hapoel haifa": "הפועל חיפה",
    "maccabi bnei raina": "מכבי בני ריינה",
    "ashdod": "מ.ס. אשדוד",
    "hapoel hadera": "הפועל חדרה",
    "ironi kiryat shmona": "עירוני קרית שמונה",
    "ironi tiberias": "עירוני טבריה",
    "hapoel petah tikva": "הפועל פתח תקווה",
}

POSITION_HE: dict[str, str] = {
    "GK": "שוער", "DEF": "מגן", "MID": "קשר", "FWD": "חלוץ",
}


def hebrew_for_team(latin_name: str) -> str | None:
    return ISRAELI_TEAMS_HE.get(team_key(latin_name))


def best_match(query: str, candidates: Iterable[tuple[str, str]],
               threshold: float = 0.82) -> str | None:
    """
    התאמת שם לישות קיימת (entity resolution) כשאין external_id.
    candidates = [(entity_id, name), ...]
    ב-DB עצמו עדיף להשתמש ב-pg_trgm similarity(); זו גרסת ה-fallback בקוד.

    מגבלה שחשוב להכיר: התאמה מטושטשת **לא** פותרת ראשי תיבות.
    'מכבי ת״א' מול 'מכבי תל אביב' נותן ~0.73 ולכן ייפול מתחת לסף — וטוב שכך,
    כי הורדת הסף תייצר התאמות שגויות בין קבוצות דומות.
    ראשי תיבות חייבים להיכנס ידנית ל-core.entity_aliases. זה לא באג, זו החלטה:
    עדיף לפספס התאמה מאשר לשייך שחקן לקבוצה הלא נכונה.
    """
    from difflib import SequenceMatcher
    q = normalize(query)
    best_id, best_score = None, 0.0
    for entity_id, name in candidates:
        score = SequenceMatcher(None, q, normalize(name)).ratio()
        if score > best_score:
            best_id, best_score = entity_id, score
    return best_id if best_score >= threshold else None
