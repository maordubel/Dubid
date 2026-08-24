"""
sync.py — מנוע הסנכרון. ספק דאטה  ->  בסיס הנתונים.

תכונות שחשובות יותר ממה שנראה בהתחלה:
  · idempotent  — הרצה חוזרת לא יוצרת כפילויות (external_refs + ON CONFLICT)
  · resolvable  — שחקן שכבר קיים מזוהה לפי external_id, ואם אין - לפי דמיון שם
  · bilingual   — כל וריאנט שם נכתב ל-entity_aliases כדי שהחיפוש יעבוד בשתי השפות
  · historical  — סגל לא נמחק. שחקן שעזב מקבל valid_to. אין איבוד היסטוריה.

הרצה:
    python -m ingestion.sync --league IL_PREMIER --season 2026 --what squads
"""
from __future__ import annotations

import argparse
import logging
from dataclasses import dataclass
from datetime import date
from typing import Any, Iterable

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .i18n import LocalizedName, normalize
from .providers.base import (
    FootballDataProvider, RawMatch, RawPlayer, RawPlayerStats, RawTeam,
    get_provider,
)
from .providers import api_football  # noqa: F401  — רישום הספק

log = logging.getLogger("sync")


@dataclass(slots=True)
class LeagueBinding:
    """קושר ליגה אצלנו לליגה אצל הספק. שורה אחת = ליגה נתמכת."""
    league_code: str          # 'IL_PREMIER'
    league_id: str            # UUID אצלנו
    season_id: str            # UUID אצלנו
    provider: str             # 'api_football'
    league_ext_id: str        # '383'
    season_ext: str           # '2026'


class SyncEngine:
    def __init__(self, conn: psycopg.Connection, provider: FootballDataProvider):
        self.conn = conn
        self.provider = provider

    # ==================================================================
    # 1. פתרון זהות (Entity Resolution)
    # ==================================================================
    def _resolve_ref(self, entity_type: str, external_id: str) -> str | None:
        row = self.conn.execute(
            """SELECT entity_id FROM core.external_refs
               WHERE provider = %s AND entity_type = %s AND external_id = %s""",
            (self.provider.name, entity_type, external_id),
        ).fetchone()
        return row["entity_id"] if row else None

    def _bind_ref(self, entity_type: str, external_id: str,
                  entity_id: str, payload: dict | None = None) -> None:
        self.conn.execute(
            """INSERT INTO core.external_refs
                   (provider, entity_type, external_id, entity_id, payload, synced_at)
               VALUES (%s, %s, %s, %s, %s, now())
               ON CONFLICT (provider, entity_type, external_id)
               DO UPDATE SET entity_id = EXCLUDED.entity_id,
                             payload   = EXCLUDED.payload,
                             synced_at = now()""",
            (self.provider.name, entity_type, external_id, entity_id,
             Jsonb(payload) if payload else None),
        )

    def _match_by_name(self, table: str, names: LocalizedName,
                       threshold: float = 0.86) -> str | None:
        """
        fallback כשאין external_id: התאמה מטושטשת דרך pg_trgm.
        מחפשים גם בשם הראשי וגם בכל ה-aliases, בשתי השפות.
        """
        latin = normalize(names.get("en"))
        hebrew = normalize(names.get("he"))
        row = self.conn.execute(
            f"""
            WITH candidates AS (
              SELECT id AS entity_id,
                     GREATEST(similarity(core.normalize_name(name_en), %(latin)s),
                              similarity(core.normalize_name(COALESCE(name_he,'')), %(heb)s)
                     ) AS score
              FROM core.{table}
              UNION ALL
              SELECT a.entity_id,
                     GREATEST(similarity(a.alias_norm, %(latin)s),
                              similarity(a.alias_norm, %(heb)s)) AS score
              FROM core.entity_aliases a
              WHERE a.entity_type = %(etype)s
            )
            SELECT entity_id FROM candidates
            WHERE score >= %(thr)s
            ORDER BY score DESC LIMIT 1
            """,
            {"latin": latin, "heb": hebrew, "thr": threshold,
             "etype": table.rstrip("s")},
        ).fetchone()
        return row["entity_id"] if row else None

    def _write_aliases(self, entity_type: str, entity_id: str,
                       names: LocalizedName) -> None:
        rows = [(entity_type, entity_id, locale, alias, self.provider.name)
                for locale, alias in names.aliases]
        if rows:
            self.conn.cursor().executemany(
                """INSERT INTO core.entity_aliases
                       (entity_type, entity_id, locale, alias, source)
                   VALUES (%s, %s, %s, %s, %s)
                   ON CONFLICT (entity_type, entity_id, locale, alias) DO NOTHING""",
                rows,
            )

    # ==================================================================
    # 2. Upserts
    # ==================================================================
    def upsert_team(self, raw: RawTeam) -> str:
        names = self.provider.localize(raw.names, "team")
        team_id = (self._resolve_ref("team", raw.external_id)
                   or self._match_by_name("teams", names))

        if team_id:
            self.conn.execute(
                """UPDATE core.teams
                      SET names = names || %s::jsonb,      -- מיזוג, לא דריסה:
                          crest_url  = COALESCE(%s, crest_url),
                          short_code = COALESCE(%s, short_code)
                    WHERE id = %s""",
                (Jsonb(names.to_jsonb()), raw.crest_url, raw.short_code, team_id),
            )
        else:
            team_id = self.conn.execute(
                """INSERT INTO core.teams (names, country_code, short_code, crest_url)
                   VALUES (%s, %s, %s, %s) RETURNING id""",
                (Jsonb(names.to_jsonb()), raw.country_code,
                 raw.short_code, raw.crest_url),
            ).fetchone()["id"]

        self._bind_ref("team", raw.external_id, team_id)
        self._write_aliases("team", team_id, names)
        return team_id

    def upsert_player(self, raw: RawPlayer) -> str:
        names = self.provider.localize(raw.names, "player")
        player_id = (self._resolve_ref("player", raw.external_id)
                     or self._match_by_name("players", names))

        if player_id:
            # מיזוג `||` שומר על עברית שהוזנה ידנית גם אם ה-API לא מכיר אותה,
            # ומעדכן רק את המפתחות שהגיעו עכשיו.
            self.conn.execute(
                """UPDATE core.players
                      SET names = names || %s::jsonb,
                          primary_position = COALESCE(%s::core.position, primary_position),
                          birth_date = COALESCE(%s, birth_date),
                          photo_url  = COALESCE(%s, photo_url),
                          updated_at = now()
                    WHERE id = %s""",
                (Jsonb(names.to_jsonb()), raw.position,
                 raw.birth_date, raw.photo_url, player_id),
            )
        else:
            player_id = self.conn.execute(
                """INSERT INTO core.players
                       (names, birth_date, nationality, primary_position, photo_url)
                   VALUES (%s, %s, %s, %s::core.position, %s) RETURNING id""",
                (Jsonb(names.to_jsonb()), raw.birth_date, raw.nationality,
                 raw.position, raw.photo_url),
            ).fetchone()["id"]

        self._bind_ref("player", raw.external_id, player_id)
        self._write_aliases("player", player_id, names)
        return player_id

    # ==================================================================
    # 3. סנכרון סגלים — הזרימה המרכזית
    # ==================================================================
    def sync_squads(self, binding: LeagueBinding) -> dict[str, int]:
        stats = {"teams": 0, "players": 0, "departures": 0}

        for raw_team in self.provider.fetch_teams(binding.league_ext_id,
                                                  binding.season_ext):
            team_id = self.upsert_team(raw_team)
            self.conn.execute(
                """INSERT INTO core.team_seasons (team_id, season_id)
                   VALUES (%s, %s) ON CONFLICT DO NOTHING""",
                (team_id, binding.season_id),
            )
            stats["teams"] += 1

            squad = self.provider.fetch_squad(raw_team.external_id,
                                              binding.season_ext)
            seen: list[str] = []

            for raw_player in squad.players:
                player_id = self.upsert_player(raw_player)
                seen.append(player_id)
                self.conn.execute(
                    """INSERT INTO core.squads
                           (season_id, team_id, player_id, shirt_number, position, valid_from)
                       VALUES (%s, %s, %s, %s, %s::core.position, CURRENT_DATE)
                       ON CONFLICT (season_id, team_id, player_id, valid_from)
                       DO UPDATE SET shirt_number = EXCLUDED.shirt_number,
                                     position     = EXCLUDED.position,
                                     status       = 'active'""",
                    (binding.season_id, team_id, player_id,
                     raw_player.shirt_number, raw_player.position),
                )
                stats["players"] += 1

            # מי שהיה בסגל ולא הופיע עכשיו — עזב. סוגרים תקופה, לא מוחקים.
            closed = self.conn.execute(
                """UPDATE core.squads
                      SET valid_to = CURRENT_DATE, status = 'left'
                    WHERE season_id = %s AND team_id = %s
                      AND valid_to IS NULL AND player_id <> ALL(%s)
                RETURNING player_id""",
                (binding.season_id, team_id, seen),
            ).fetchall()
            stats["departures"] += len(closed)

            self.conn.commit()
            log.info("סונכרן סגל: %s (%d שחקנים)",
                     raw_team.names.get("he"), len(squad.players))

        return stats

    # ==================================================================
    # 4. סנכרון משחקים וסטטיסטיקות
    # ==================================================================
    def sync_fixtures(self, binding: LeagueBinding,
                      gameweek: int | None = None) -> int:
        count = 0
        for raw in self.provider.fetch_fixtures(binding.league_ext_id,
                                                binding.season_ext, gameweek):
            gw_id = self._ensure_gameweek(binding, raw)
            home = self._resolve_ref("team", raw.home_external_id)
            away = self._resolve_ref("team", raw.away_external_id)
            if not (home and away):
                log.warning("דילוג על משחק %s — קבוצה לא ממופה", raw.external_id)
                continue

            match_id = self.conn.execute(
                """INSERT INTO core.weekly_matches
                       (gameweek_id, home_team_id, away_team_id, kickoff_at,
                        status, home_goals, away_goals)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (gameweek_id, home_team_id, away_team_id)
                   DO UPDATE SET kickoff_at = EXCLUDED.kickoff_at,
                                 status     = EXCLUDED.status,
                                 home_goals = EXCLUDED.home_goals,
                                 away_goals = EXCLUDED.away_goals
                   RETURNING id""",
                (gw_id, home, away, raw.kickoff_at, raw.status,
                 raw.home_goals, raw.away_goals),
            ).fetchone()["id"]
            self._bind_ref("match", raw.external_id, match_id)
            count += 1

        self.conn.commit()
        return count

    def sync_match_stats(self, match_ext_id: str) -> int:
        match_id = self._resolve_ref("match", match_ext_id)
        if not match_id:
            raise LookupError(f"משחק {match_ext_id} לא מסונכרן")

        rows = []
        for s in self.provider.fetch_match_stats(match_ext_id):
            player_id = self._resolve_ref("player", s.player_external_id)
            team_id = self._resolve_ref("team", s.team_external_id)
            if not (player_id and team_id):
                continue
            rows.append((
                match_id, player_id, team_id, s.minutes, s.started, s.goals,
                s.assists, s.own_goals, s.yellow_cards, s.red_cards, s.saves,
                s.penalties_saved, s.penalties_missed, s.goals_conceded,
                s.goals_conceded == 0 and s.minutes >= 60,   # clean sheet
                Jsonb(s.extra),
            ))

        self.conn.cursor().executemany(
            """INSERT INTO core.player_match_stats
                   (match_id, player_id, team_id, minutes, started, goals, assists,
                    own_goals, yellow_cards, red_cards, saves, penalties_saved,
                    penalties_missed, goals_conceded, clean_sheet, extra)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (match_id, player_id) DO UPDATE SET
                   minutes = EXCLUDED.minutes, goals = EXCLUDED.goals,
                   assists = EXCLUDED.assists, own_goals = EXCLUDED.own_goals,
                   yellow_cards = EXCLUDED.yellow_cards, red_cards = EXCLUDED.red_cards,
                   saves = EXCLUDED.saves, penalties_saved = EXCLUDED.penalties_saved,
                   penalties_missed = EXCLUDED.penalties_missed,
                   goals_conceded = EXCLUDED.goals_conceded,
                   clean_sheet = EXCLUDED.clean_sheet, extra = EXCLUDED.extra,
                   updated_at = now()""",
            rows,
        )
        self.conn.commit()
        return len(rows)

    # -- עזר ---------------------------------------------------------------
    def _ensure_gameweek(self, binding: LeagueBinding, raw: RawMatch) -> str:
        row = self.conn.execute(
            """INSERT INTO game.gameweeks (season_id, number, names, lock_at)
               VALUES (%s, %s, %s, %s)
               ON CONFLICT (season_id, number)
               DO UPDATE SET lock_at = LEAST(game.gameweeks.lock_at, EXCLUDED.lock_at)
               RETURNING id""",
            (binding.season_id, raw.gameweek_number,
             Jsonb(LocalizedName.of(en=f"Gameweek {raw.gameweek_number}",
                                    he=f"מחזור {raw.gameweek_number}").to_jsonb()),
             raw.kickoff_at),
        ).fetchone()
        return row["id"]


# =====================================================================
# CLI
# =====================================================================
def load_binding(conn: psycopg.Connection, league_code: str,
                 season_label: str) -> LeagueBinding:
    row = conn.execute(
        """SELECT l.id AS league_id, s.id AS season_id,
                  r.provider, r.external_id AS league_ext_id
             FROM core.leagues l
             JOIN core.seasons s ON s.league_id = l.id AND s.label = %s
             JOIN core.external_refs r
               ON r.entity_type = 'league' AND r.entity_id = l.id
            WHERE l.code = %s""",
        (season_label, league_code),
    ).fetchone()
    if not row:
        raise LookupError(f"אין binding ל-{league_code}/{season_label}")
    return LeagueBinding(league_code=league_code, season_ext=season_label.split("/")[0],
                         **row)


def main() -> None:
    ap = argparse.ArgumentParser(description="סנכרון נתוני כדורגל")
    ap.add_argument("--league", required=True)
    ap.add_argument("--season", required=True)
    ap.add_argument("--what", choices=["squads", "fixtures", "stats"], default="squads")
    ap.add_argument("--gameweek", type=int)
    ap.add_argument("--dsn", default="postgresql:///dovid")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    with psycopg.connect(args.dsn, row_factory=dict_row) as conn:
        binding = load_binding(conn, args.league, args.season)
        engine = SyncEngine(conn, get_provider(binding.provider))
        if args.what == "squads":
            log.info("תוצאה: %s", engine.sync_squads(binding))
        elif args.what == "fixtures":
            log.info("סונכרנו %d משחקים", engine.sync_fixtures(binding, args.gameweek))


if __name__ == "__main__":
    main()
