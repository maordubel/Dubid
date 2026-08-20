"""
scoring/validation.py — ולידציית הרכב.

הכלל "לא יותר משחקן אחד מאותה קבוצה" נאכף בשלוש שכבות:
   1. UI      — שחקן מקבוצה שכבר נבחרה מוצג נעול (חוויה טובה)
   2. השכבה הזאת — לפני כתיבה ל-DB, עם הודעות שגיאה מתורגמות (הגנה)
   3. DB      — UNIQUE (lineup_id, team_id) (אמת מוחלטת)

אף פעם לא מסתמכים רק על אחת מהן.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from enum import Enum

from .models import Lineup, LineupSlot, Position
from .rules import RuleSet


class ErrorCode(str, Enum):
    LINEUP_SIZE = "lineup_size"
    DUPLICATE_TEAM = "duplicate_team"
    DUPLICATE_PLAYER = "duplicate_player"
    FORMATION_INVALID = "formation_invalid"
    FORMATION_MISMATCH = "formation_mismatch"
    CAPTAIN_MISSING = "captain_missing"
    CAPTAIN_NOT_IN_LINEUP = "captain_not_in_lineup"
    NO_GOALKEEPER = "no_goalkeeper"


# הודעות תצוגה. ה-frontend יכול לקחת אותן ישירות או להשתמש רק בקוד.
MESSAGES: dict[ErrorCode, dict[str, str]] = {
    ErrorCode.LINEUP_SIZE: {
        "he": "ההרכב חייב לכלול בדיוק {expected} שחקנים (יש {actual}).",
        "en": "Lineup must contain exactly {expected} players (got {actual}).",
    },
    ErrorCode.DUPLICATE_TEAM: {
        "he": "מותר עד {max} שחקנים מכל קבוצה. יש חריגה בקבוצות: {teams}.",
        "en": "At most {max} player(s) per team. Violating teams: {teams}.",
    },
    ErrorCode.DUPLICATE_PLAYER: {
        "he": "אותו שחקן נבחר יותר מפעם אחת.",
        "en": "The same player was selected more than once.",
    },
    ErrorCode.FORMATION_INVALID: {
        "he": "המערך {formation} אינו נתמך.",
        "en": "Formation {formation} is not supported.",
    },
    ErrorCode.FORMATION_MISMATCH: {
        "he": "חלוקת העמדות אינה תואמת למערך {formation}.",
        "en": "Position distribution does not match formation {formation}.",
    },
    ErrorCode.CAPTAIN_MISSING: {
        "he": "יש לבחור קפטן.", "en": "A captain must be selected.",
    },
    ErrorCode.CAPTAIN_NOT_IN_LINEUP: {
        "he": "הקפטן שנבחר אינו בהרכב.", "en": "Captain is not in the lineup.",
    },
    ErrorCode.NO_GOALKEEPER: {
        "he": "ההרכב חייב לכלול שוער אחד.", "en": "Lineup must include a goalkeeper.",
    },
}


@dataclass(frozen=True, slots=True)
class ValidationIssue:
    code: ErrorCode
    params: dict

    def message(self, locale: str = "he") -> str:
        template = MESSAGES[self.code].get(locale, MESSAGES[self.code]["en"])
        return template.format(**self.params)


class LineupInvalid(Exception):
    def __init__(self, issues: list[ValidationIssue], locale: str = "he"):
        self.issues = issues
        super().__init__(" | ".join(i.message(locale) for i in issues))


def parse_formation(formation: str) -> dict[Position, int]:
    """'4-3-3' -> {'GK':1,'DEF':4,'MID':3,'FWD':3}"""
    parts = [int(p) for p in formation.split("-")]
    if len(parts) == 3:
        d, m, f = parts
    elif len(parts) == 4:                      # 4-2-3-1
        d, m1, m2, f = parts
        m = m1 + m2
    else:
        raise ValueError(formation)
    return {"GK": 1, "DEF": d, "MID": m, "FWD": f}


def validate_lineup(lineup: Lineup, rules: RuleSet) -> list[ValidationIssue]:
    """מחזיר רשימת בעיות. ריקה = ההרכב תקין."""
    issues: list[ValidationIssue] = []
    starters: tuple[LineupSlot, ...] = lineup.starters
    c = rules.constraints

    # 1. גודל
    if len(starters) != c.lineup_size:
        issues.append(ValidationIssue(ErrorCode.LINEUP_SIZE,
                                      {"expected": c.lineup_size,
                                       "actual": len(starters)}))

    # 2. ★ שחקן אחד מכל קבוצה
    team_counts = Counter(s.team_id for s in starters)
    over = [t for t, n in team_counts.items() if n > c.max_players_per_team]
    if over:
        issues.append(ValidationIssue(ErrorCode.DUPLICATE_TEAM,
                                      {"max": c.max_players_per_team,
                                       "teams": ", ".join(sorted(over))}))

    # 3. שחקן כפול
    player_counts = Counter(s.player_id for s in starters)
    if any(n > 1 for n in player_counts.values()):
        issues.append(ValidationIssue(ErrorCode.DUPLICATE_PLAYER, {}))

    # 4. מערך ועמדות
    if lineup.formation not in c.formation_allowed:
        issues.append(ValidationIssue(ErrorCode.FORMATION_INVALID,
                                      {"formation": lineup.formation}))
    else:
        want = parse_formation(lineup.formation)
        got = Counter(s.position for s in starters)
        if any(got.get(pos, 0) != n for pos, n in want.items()):
            issues.append(ValidationIssue(ErrorCode.FORMATION_MISMATCH,
                                          {"formation": lineup.formation}))

    if not any(s.position == "GK" for s in starters):
        issues.append(ValidationIssue(ErrorCode.NO_GOALKEEPER, {}))

    # 5. קפטן
    captains = [s for s in starters if s.is_captain]
    if c.require_captain and not captains:
        issues.append(ValidationIssue(ErrorCode.CAPTAIN_MISSING, {}))

    return issues


def assert_valid(lineup: Lineup, rules: RuleSet, locale: str = "he") -> None:
    issues = validate_lineup(lineup, rules)
    if issues:
        raise LineupInvalid(issues, locale)


def available_teams(all_team_ids: set[str], lineup: Lineup,
                    rules: RuleSet) -> set[str]:
    """
    עבור ה-UI: אילו קבוצות עדיין פתוחות לבחירה.
    זה מה שמאפשר לנעול שחקנים במסך הבחירה במקום לזרוק שגיאה אחרי הלחיצה.
    """
    used = Counter(s.team_id for s in lineup.starters)
    limit = rules.constraints.max_players_per_team
    return {t for t in all_team_ids if used[t] < limit}
