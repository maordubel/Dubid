"""
providers/api_football.py — מימוש לדוגמה מעל API-Football (RapidAPI).

הנחה: יש לכם מפתח. אם תחליפו ספק (Sportmonks / Opta / SofaScore) —
זה הקובץ היחיד שצריך להיכתב מחדש.

עיקר העבודה כאן היא לא ה-HTTP. היא ה-i18n:
API-Football מחזיר שמות לטיניים בלבד. אנחנו מזריקים עברית משכבת
ה-overrides, ומייצרים aliases לכל וריאנט כדי שהחיפוש יעבוד.
"""
from __future__ import annotations

import os
import time
from datetime import date, datetime, timezone
from typing import Any, Iterator

import requests

from ..i18n import LocalizedName, hebrew_for_team
from .base import (
    FootballDataProvider, RawMatch, RawPlayer, RawPlayerStats, RawSquad,
    RawTeam, register,
)

_POS_MAP = {
    "Goalkeeper": "GK", "Defender": "DEF",
    "Midfielder": "MID", "Attacker": "FWD",
    # וריאנטים שראיתי בפועל
    "G": "GK", "D": "DEF", "M": "MID", "F": "FWD",
}


@register
class ApiFootballProvider(FootballDataProvider):
    name = "api_football"
    supports_locales = ("en",)

    BASE = "https://v3.football.api-sports.io"

    def __init__(self, api_key: str | None = None, *,
                 rate_limit_per_min: int = 30, timeout: int = 20,
                 hebrew_overrides: bool = True):
        self.api_key = api_key or os.environ["API_FOOTBALL_KEY"]
        self._min_interval = 60.0 / rate_limit_per_min
        self._last_call = 0.0
        self.timeout = timeout
        self.hebrew_overrides = hebrew_overrides
        self._session = requests.Session()
        self._session.headers.update({"x-apisports-key": self.api_key})

    # -- תשתית -------------------------------------------------------------
    def _get(self, path: str, **params: Any) -> list[dict]:
        wait = self._min_interval - (time.monotonic() - self._last_call)
        if wait > 0:
            time.sleep(wait)

        for attempt in range(4):
            resp = self._session.get(f"{self.BASE}/{path}",
                                     params=params, timeout=self.timeout)
            self._last_call = time.monotonic()
            if resp.status_code == 429:              # rate limited
                time.sleep(2 ** attempt)
                continue
            resp.raise_for_status()
            body = resp.json()
            if body.get("errors"):
                raise RuntimeError(f"{path}: {body['errors']}")
            return body.get("response", [])
        raise RuntimeError(f"{path}: מוצו הניסיונות (429)")

    # -- i18n --------------------------------------------------------------
    def localize(self, names: LocalizedName, entity_type: str) -> LocalizedName:
        """מזריק עברית לשמות קבוצות. שחקנים – מטופלים בטבלת aliases/אדמין."""
        if not self.hebrew_overrides or entity_type != "team":
            return names
        he = hebrew_for_team(names.get("en"))
        if he:
            names.set("he", full=he)
        return names

    # -- קבוצות וסגלים ------------------------------------------------------
    def fetch_teams(self, league_ext_id: str, season: str) -> Iterator[RawTeam]:
        for row in self._get("teams", league=league_ext_id, season=season):
            t = row["team"]
            names = LocalizedName.of(en=t["name"])
            yield RawTeam(
                external_id=str(t["id"]),
                names=self.localize(names, "team"),
                country_code=_country_code(t.get("country")),
                short_code=t.get("code"),
                crest_url=t.get("logo"),
            )

    def fetch_squad(self, team_ext_id: str, season: str) -> RawSquad:
        # /players/squads מחזיר את הסגל הנוכחי; /players מחזיר גם סטטיסטיקות.
        squads = self._get("players/squads", team=team_ext_id)
        if not squads:
            raise LookupError(f"אין סגל לקבוצה {team_ext_id}")

        block = squads[0]
        team = RawTeam(
            external_id=str(block["team"]["id"]),
            names=self.localize(LocalizedName.of(en=block["team"]["name"]), "team"),
            country_code=_country_code(block["team"].get("country")),
            crest_url=block["team"].get("logo"),
        )

        players: list[RawPlayer] = []
        for p in block.get("players", []):
            names = LocalizedName.of(en=p["name"])
            players.append(RawPlayer(
                external_id=str(p["id"]),
                names=self.localize(names, "player"),
                position=_POS_MAP.get(p.get("position"), "MID"),
                shirt_number=p.get("number"),
                birth_date=_parse_date(p.get("birth", {}).get("date")) if isinstance(p.get("birth"), dict) else None,
                photo_url=p.get("photo"),
            ))
        return RawSquad(team=team, players=players)

    # -- משחקים -------------------------------------------------------------
    def fetch_fixtures(self, league_ext_id: str, season: str,
                       gameweek: int | None = None) -> Iterator[RawMatch]:
        params: dict[str, Any] = {"league": league_ext_id, "season": season}
        if gameweek is not None:
            params["round"] = f"Regular Season - {gameweek}"

        for row in self._get("fixtures", **params):
            fx, teams, goals = row["fixture"], row["teams"], row["goals"]
            yield RawMatch(
                external_id=str(fx["id"]),
                gameweek_number=gameweek if gameweek is not None
                                else _round_number(row["league"].get("round")),
                home_external_id=str(teams["home"]["id"]),
                away_external_id=str(teams["away"]["id"]),
                kickoff_at=datetime.fromtimestamp(fx["timestamp"], tz=timezone.utc),
                status=_STATUS_MAP.get(fx["status"]["short"], "scheduled"),
                home_goals=goals.get("home"),
                away_goals=goals.get("away"),
            )

    def fetch_match_stats(self, match_ext_id: str) -> Iterator[RawPlayerStats]:
        for team_block in self._get("fixtures/players", fixture=match_ext_id):
            team_id = str(team_block["team"]["id"])
            for entry in team_block["players"]:
                s = entry["statistics"][0]
                yield RawPlayerStats(
                    match_external_id=str(match_ext_id),
                    player_external_id=str(entry["player"]["id"]),
                    team_external_id=team_id,
                    minutes=s["games"].get("minutes") or 0,
                    started=bool(s["games"].get("substitute") is False),
                    goals=s["goals"].get("total") or 0,
                    assists=s["goals"].get("assists") or 0,
                    goals_conceded=s["goals"].get("conceded") or 0,
                    saves=s["goals"].get("saves") or 0,
                    yellow_cards=s["cards"].get("yellow") or 0,
                    red_cards=s["cards"].get("red") or 0,
                    penalties_saved=s.get("penalty", {}).get("saved") or 0,
                    penalties_missed=s.get("penalty", {}).get("missed") or 0,
                    extra={"rating": s["games"].get("rating")},
                )


# --- עזרי המרה ---------------------------------------------------------------

_STATUS_MAP = {
    "NS": "scheduled", "1H": "live", "HT": "live", "2H": "live", "ET": "live",
    "FT": "finished", "AET": "finished", "PEN": "finished",
    "PST": "postponed", "ABD": "abandoned", "CANC": "postponed",
}

_COUNTRIES = {"Israel": "IL", "England": "GB", "Spain": "ES", "Italy": "IT",
              "Germany": "DE", "France": "FR", "Portugal": "PT"}


def _country_code(name: str | None) -> str:
    return _COUNTRIES.get(name or "", "XX")


def _parse_date(value: str | None) -> date | None:
    try:
        return date.fromisoformat(value) if value else None
    except ValueError:
        return None


def _round_number(round_label: str | None) -> int:
    """'Regular Season - 7' -> 7"""
    if not round_label:
        return 0
    tail = round_label.rsplit("-", 1)[-1].strip()
    return int(tail) if tail.isdigit() else 0
