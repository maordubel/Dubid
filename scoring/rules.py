"""
scoring/rules.py — חוקי הניקוד כדאטה.

הכלל החשוב ביותר בארכיטקטורה הזאת:
    ליגה חדשה או שינוי חוקים = שורה חדשה ב-game.scoring_rulesets.
    לא commit. לא deploy. לא if league == 'IL'.

כל RuleSet נושא version. ניקוד היסטורי נשמר עם ה-version שבו חושב,
כך ששינוי חוקים באמצע העונה לא משנה תוצאות עבר.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping

from .models import Position

# מכפילי שער לפי עמדה — שוער שמבקיע שווה יותר מחלוץ. קלאסיקה של פנטזי.
DEFAULT_GOAL_POINTS: dict[Position, float] = {"GK": 10, "DEF": 8, "MID": 6, "FWD": 5}
DEFAULT_CLEAN_SHEET: dict[Position, float] = {"GK": 5, "DEF": 4, "MID": 1, "FWD": 0}
DEFAULT_CONCEDED: dict[Position, float] = {"GK": -1, "DEF": -1, "MID": 0, "FWD": 0}


@dataclass(frozen=True, slots=True)
class PersonalRules:
    goal: Mapping[Position, float] = field(default_factory=lambda: dict(DEFAULT_GOAL_POINTS))
    assist: float = 3
    clean_sheet: Mapping[Position, float] = field(default_factory=lambda: dict(DEFAULT_CLEAN_SHEET))
    clean_sheet_min_minutes: int = 60
    minutes_played: float = 1          # על עצם ההשתתפות
    minutes_60_plus: float = 2         # במקום, לא בנוסף
    yellow_card: float = -1
    red_card: float = -3
    own_goal: float = -2
    saves_per: int = 3                 # כל 3 הצלות
    saves_points: float = 1
    penalty_saved: float = 5
    penalty_missed: float = -2
    goals_conceded_per: int = 2
    goals_conceded: Mapping[Position, float] = field(default_factory=lambda: dict(DEFAULT_CONCEDED))


@dataclass(frozen=True, slots=True)
class ResultBonusRules:
    """בונוס תוצאה — ניתן פר שחקן, על סמך תוצאת הקבוצה האמיתית שלו."""
    win: float = 4
    draw: float = 1
    loss: float = 0
    require_minutes: int = 0     # 0 = גם ספסלן מקבל; 1+ = רק מי ששיחק


@dataclass(frozen=True, slots=True)
class VirtualGoalRules:
    """
    "כל 2 שערים קבוצתיים במציאות = שער וירטואלי (+5)".

    aggregation קובע איך סופרים, וזו החלטת מוצר אמיתית:
      · 'pooled'   – סוכמים את כל שערי הקבוצות שבהרכב לקופה אחת, ומחלקים ב-2.
                     נדיב, מייצר הרבה נקודות, מתגמל בחירת קבוצות מתקפיות.
      · 'per_team' – כל קבוצה נספרת לחוד, שאריות לא מצטברות.
                     קמצני יותר, מתגמל בחירה של קבוצה שכבשה 2+ בבודדת.
    ברירת המחדל היא pooled כי היא מייצרת עקומת ניקוד חלקה יותר בין משתמשים.
    """
    goals_per_virtual: int = 2
    points: float = 5
    aggregation: str = "pooled"        # 'pooled' | 'per_team'
    count_only_starters: bool = True


@dataclass(frozen=True, slots=True)
class ConstraintRules:
    lineup_size: int = 11
    max_players_per_team: int = 1      # ★ האילוץ המרכזי של המשחק
    bench_size: int = 0
    formation_allowed: tuple[str, ...] = ("4-3-3", "4-4-2", "3-5-2", "4-2-3-1", "5-3-2", "3-4-3")
    require_captain: bool = True


@dataclass(frozen=True, slots=True)
class RuleSet:
    version: int = 1
    league_code: str | None = None      # None = ברירת מחדל גלובלית
    personal: PersonalRules = field(default_factory=PersonalRules)
    result_bonus: ResultBonusRules = field(default_factory=ResultBonusRules)
    virtual_goal: VirtualGoalRules = field(default_factory=VirtualGoalRules)
    constraints: ConstraintRules = field(default_factory=ConstraintRules)
    captain_multiplier: float = 2.0

    # ---- טעינה מ-JSONB של game.scoring_rulesets ------------------------
    @classmethod
    def from_jsonb(cls, data: Mapping[str, Any], *, version: int = 1,
                   league_code: str | None = None) -> "RuleSet":
        p = data.get("personal", {})
        r = data.get("result_bonus", {})
        v = data.get("virtual_goal", {})
        c = data.get("constraints", {})
        return cls(
            version=version,
            league_code=league_code,
            personal=PersonalRules(
                goal={**DEFAULT_GOAL_POINTS, **(p.get("goal") or {})},
                assist=p.get("assist", 3),
                clean_sheet={**DEFAULT_CLEAN_SHEET, **(p.get("clean_sheet") or {})},
                clean_sheet_min_minutes=p.get("clean_sheet_min_minutes", 60),
                minutes_played=p.get("minutes_played", 1),
                minutes_60_plus=p.get("minutes_60", 2),
                yellow_card=p.get("yellow", -1),
                red_card=p.get("red", -3),
                own_goal=p.get("own_goal", -2),
                saves_per=p.get("save_per", 3),
                saves_points=p.get("save_points", 1),
                penalty_saved=p.get("penalty_saved", 5),
                penalty_missed=p.get("penalty_missed", -2),
                goals_conceded_per=p.get("goals_conceded_per", 2),
                goals_conceded={**DEFAULT_CONCEDED, **(p.get("goals_conceded") or {})},
            ),
            result_bonus=ResultBonusRules(
                win=r.get("W", 4), draw=r.get("D", 1), loss=r.get("L", 0),
                require_minutes=r.get("require_minutes", 0),
            ),
            virtual_goal=VirtualGoalRules(
                goals_per_virtual=v.get("team_goals_per_virtual", 2),
                points=v.get("points", 5),
                aggregation=v.get("aggregation", "pooled"),
                count_only_starters=v.get("count_only_starters", True),
            ),
            constraints=ConstraintRules(
                lineup_size=c.get("lineup_size", 11),
                max_players_per_team=c.get("max_players_per_team", 1),
                bench_size=c.get("bench_size", 0),
                formation_allowed=tuple(c.get("formation_allowed",
                                              ConstraintRules.formation_allowed)),
                require_captain=c.get("require_captain", True),
            ),
            captain_multiplier=data.get("captain_multiplier", 2.0),
        )


# ליגת העל הישראלית — ברירת המחדל של המוצר.
ISRAELI_PREMIER = RuleSet(version=1, league_code="IL_PREMIER")

# דוגמה להרחבה עתידית: ליגה זרה עם 15 שחקנים ועד 2 מאותה קבוצה.
# אין כאן שום קוד חדש — רק ערכים.
EXAMPLE_FOREIGN = RuleSet(
    version=1,
    league_code="EN_PL",
    constraints=ConstraintRules(lineup_size=15, max_players_per_team=2, bench_size=4),
    virtual_goal=VirtualGoalRules(goals_per_virtual=3, points=6, aggregation="per_team"),
)
