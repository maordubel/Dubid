"""
scoring/models.py — טיפוסי הליבה של מנוע הניקוד.

המנוע כולו טהור (pure): מקבל מבנים, מחזיר מבנים. אין בו גישה ל-DB
ואין בו HTTP. זה מה שמאפשר לבדוק אותו ב-pytest בלי תשתית,
ולהריץ אותו גם בבדיקה חיה וגם בסימולציה של "מה היה קורה אם".
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Literal

Position = Literal["GK", "DEF", "MID", "FWD"]
MatchResult = Literal["W", "D", "L"]


class Reason(str, Enum):
    """קודי סיבה — ה-UI מתרגם אותם לעברית/אנגלית. אין מחרוזות תצוגה בקוד."""
    GOAL = "goal"
    ASSIST = "assist"
    CLEAN_SHEET = "clean_sheet"
    MINUTES = "minutes"
    YELLOW = "yellow_card"
    RED = "red_card"
    OWN_GOAL = "own_goal"
    SAVES = "saves"
    PENALTY_SAVED = "penalty_saved"
    PENALTY_MISSED = "penalty_missed"
    GOALS_CONCEDED = "goals_conceded"
    RESULT_BONUS = "result_bonus"
    VIRTUAL_GOAL = "virtual_goal"
    CAPTAIN = "captain_multiplier"


@dataclass(frozen=True, slots=True)
class PlayerPerformance:
    """ביצועי שחקן בודד במחזור (מצטבר על פני כל משחקיו באותו מחזור)."""
    player_id: str
    team_id: str
    position: Position
    minutes: int = 0
    goals: int = 0
    assists: int = 0
    own_goals: int = 0
    yellow_cards: int = 0
    red_cards: int = 0
    saves: int = 0
    penalties_saved: int = 0
    penalties_missed: int = 0
    goals_conceded: int = 0
    clean_sheet: bool = False
    played: bool = True          # False = לא היה בסגל / לא שיחק כלל


@dataclass(frozen=True, slots=True)
class TeamOutcome:
    """תוצאת הקבוצה האמיתית במחזור. מקור לבונוס התוצאה ולשער הווירטואלי."""
    team_id: str
    result: MatchResult
    goals_for: int
    goals_against: int


@dataclass(frozen=True, slots=True)
class LineupSlot:
    player_id: str
    team_id: str          # snapshot מרגע ההגשה
    position: Position
    is_captain: bool = False
    is_bench: bool = False


@dataclass(frozen=True, slots=True)
class Lineup:
    lineup_id: str
    user_id: str
    gameweek_id: str
    slots: tuple[LineupSlot, ...]
    formation: str = "4-3-3"

    @property
    def starters(self) -> tuple[LineupSlot, ...]:
        return tuple(s for s in self.slots if not s.is_bench)


# --- פירוט הניקוד -----------------------------------------------------------

@dataclass(slots=True)
class ScoreLine:
    """שורת ניקוד בודדת — הבסיס לתצוגת ה-breakdown באפליקציה."""
    reason: Reason
    points: float
    count: int = 1
    player_id: str | None = None
    team_id: str | None = None
    meta: dict = field(default_factory=dict)


@dataclass(slots=True)
class PlayerScore:
    player_id: str
    team_id: str
    position: Position
    lines: list[ScoreLine] = field(default_factory=list)
    is_captain: bool = False

    @property
    def subtotal(self) -> float:
        return round(sum(line.points for line in self.lines), 2)


@dataclass(slots=True)
class LineupScore:
    lineup_id: str
    gameweek_id: str
    ruleset_version: int
    players: list[PlayerScore] = field(default_factory=list)
    bonus_lines: list[ScoreLine] = field(default_factory=list)

    def _sum(self, *reasons: Reason) -> float:
        return round(sum(
            line.points
            for line in (l for p in self.players for l in p.lines)
            if line.reason in reasons), 2)

    @property
    def personal_points(self) -> float:
        """סכימת פעולות אישיות בלבד — בלי בונוס תוצאה ובלי מכפיל קפטן."""
        excluded = {Reason.RESULT_BONUS, Reason.CAPTAIN}
        return round(sum(
            line.points
            for line in (l for p in self.players for l in p.lines)
            if line.reason not in excluded), 2)

    @property
    def result_points(self) -> float:
        return self._sum(Reason.RESULT_BONUS)

    @property
    def captain_points(self) -> float:
        return self._sum(Reason.CAPTAIN)

    @property
    def virtual_points(self) -> float:
        return round(sum(l.points for l in self.bonus_lines
                         if l.reason is Reason.VIRTUAL_GOAL), 2)

    @property
    def total_points(self) -> float:
        return round(sum(p.subtotal for p in self.players)
                     + sum(l.points for l in self.bonus_lines), 2)

    def to_jsonb(self) -> dict:
        """נכנס ל-game.lineup_scores.breakdown ומשם ישר ל-UI."""
        return {
            "total": self.total_points,
            "personal": self.personal_points,
            "result": self.result_points,
            "captain": self.captain_points,
            "virtual": self.virtual_points,
            "ruleset_version": self.ruleset_version,
            "players": [
                {
                    "player_id": p.player_id,
                    "team_id": p.team_id,
                    "position": p.position,
                    "is_captain": p.is_captain,
                    "subtotal": p.subtotal,
                    "lines": [
                        {"reason": l.reason.value, "points": l.points,
                         "count": l.count, **({"meta": l.meta} if l.meta else {})}
                        for l in p.lines
                    ],
                }
                for p in self.players
            ],
            "bonuses": [
                {"reason": l.reason.value, "points": l.points, "count": l.count,
                 "team_id": l.team_id, **({"meta": l.meta} if l.meta else {})}
                for l in self.bonus_lines
            ],
        }
