"""
providers/base.py — החוזה שכל ספק דאטה חייב לממש.

זה הקובץ שהופך את המערכת לרב-ליגתית. הוספת ליגה זרה =
מימוש מחלקה אחת + שורה ב-registry. אפס שינויים בשאר המערכת.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Iterator, Literal

from ..i18n import LocalizedName

Position = Literal["GK", "DEF", "MID", "FWD"]


# --- DTOs ניטרליים לספק ------------------------------------------------------
# כל ספק ממיר את ה-JSON שלו למבנים האלה. משם והלאה, המערכת לא יודעת
# ולא צריכה לדעת מאיפה הדאטה הגיע.

@dataclass(slots=True)
class RawTeam:
    external_id: str
    names: LocalizedName
    country_code: str
    short_code: str | None = None
    crest_url: str | None = None


@dataclass(slots=True)
class RawPlayer:
    external_id: str
    names: LocalizedName
    position: Position
    shirt_number: int | None = None
    birth_date: date | None = None
    nationality: str | None = None
    photo_url: str | None = None


@dataclass(slots=True)
class RawSquad:
    team: RawTeam
    players: list[RawPlayer] = field(default_factory=list)


@dataclass(slots=True)
class RawMatch:
    external_id: str
    gameweek_number: int
    home_external_id: str
    away_external_id: str
    kickoff_at: datetime
    status: str
    home_goals: int | None = None
    away_goals: int | None = None


@dataclass(slots=True)
class RawPlayerStats:
    match_external_id: str
    player_external_id: str
    team_external_id: str
    minutes: int = 0
    started: bool = False
    goals: int = 0
    assists: int = 0
    own_goals: int = 0
    yellow_cards: int = 0
    red_cards: int = 0
    saves: int = 0
    penalties_saved: int = 0
    penalties_missed: int = 0
    goals_conceded: int = 0
    extra: dict = field(default_factory=dict)


# --- הממשק -------------------------------------------------------------------

class FootballDataProvider(ABC):
    """
    ספק דאטה. כל מימוש אחראי על:
      · תרגום ה-API שלו ל-DTOs שלמעלה
      · rate limiting ו-retries
      · אספקת שמות לטיניים תמיד; שמות מקומיים אם יש
    """

    name: str                    # 'api_football'
    supports_locales: tuple[str, ...] = ("en",)

    @abstractmethod
    def fetch_teams(self, league_ext_id: str, season: str) -> Iterator[RawTeam]: ...

    @abstractmethod
    def fetch_squad(self, team_ext_id: str, season: str) -> RawSquad: ...

    @abstractmethod
    def fetch_fixtures(self, league_ext_id: str, season: str,
                       gameweek: int | None = None) -> Iterator[RawMatch]: ...

    @abstractmethod
    def fetch_match_stats(self, match_ext_id: str) -> Iterator[RawPlayerStats]: ...

    # -- hook אופציונלי: העשרת שמות מקומיים -------------------------------
    def localize(self, names: LocalizedName, entity_type: str) -> LocalizedName:
        """
        ברירת מחדל: לא נוגעים. ספק ישראלי יכול לדרוס ולהוסיף עברית.
        ה-SyncEngine קורא לזה על כל ישות לפני הכתיבה.
        """
        return names


# --- רישום ספקים -------------------------------------------------------------

_REGISTRY: dict[str, type[FootballDataProvider]] = {}


def register(cls: type[FootballDataProvider]) -> type[FootballDataProvider]:
    _REGISTRY[cls.name] = cls
    return cls


def get_provider(name: str, **kwargs) -> FootballDataProvider:
    if name not in _REGISTRY:
        raise KeyError(f"ספק לא מוכר: {name}. רשומים: {sorted(_REGISTRY)}")
    return _REGISTRY[name](**kwargs)
