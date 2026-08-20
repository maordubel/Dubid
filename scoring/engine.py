"""
scoring/engine.py — מנוע הניקוד.

חוזה:
    ScoringEngine(ruleset).score(lineup, performances, outcomes) -> LineupScore

טהור לחלוטין. אותם קלטים -> אותה תוצאה, תמיד. אפשר להריץ אותו על
מחזור מלפני שנה ולקבל בדיוק את אותו מספר.

שלושת רכיבי הניקוד:
    1. ציון אישי   — סכימת פעולות של כל שחקן בהרכב
    2. בונוס תוצאה — ניצחון של הקבוצה האמיתית (+4) / תיקו (+1)
    3. שער וירטואלי — כל 2 שערים קבוצתיים במציאות = +5
"""
from __future__ import annotations

import logging
from collections import defaultdict
from typing import Iterable, Mapping, Sequence

from .models import (
    Lineup, LineupScore, LineupSlot, PlayerPerformance, PlayerScore,
    Reason, ScoreLine, TeamOutcome,
)
from .rules import RuleSet
from .validation import assert_valid

log = logging.getLogger("scoring")


class ScoringEngine:
    """חסר-מצב (stateless) מעבר ל-ruleset. בטוח לשימוש חוזר ומקבילי."""

    def __init__(self, ruleset: RuleSet):
        self.rules = ruleset

    # ==================================================================
    # API ציבורי
    # ==================================================================
    def score(
        self,
        lineup: Lineup,
        performances: Mapping[str, PlayerPerformance],
        outcomes: Mapping[str, TeamOutcome],
        *,
        validate: bool = True,
    ) -> LineupScore:
        """
        performances : player_id -> ביצועים במחזור
        outcomes     : team_id   -> תוצאת הקבוצה במחזור
        """
        if validate:
            assert_valid(lineup, self.rules)

        result = LineupScore(
            lineup_id=lineup.lineup_id,
            gameweek_id=lineup.gameweek_id,
            ruleset_version=self.rules.version,
        )

        for slot in lineup.starters:
            perf = performances.get(slot.player_id)
            outcome = outcomes.get(slot.team_id)
            result.players.append(self._score_player(slot, perf, outcome))

        result.bonus_lines.extend(self._virtual_goals(lineup.starters, outcomes))
        return result

    # ==================================================================
    # 1 + 2. ציון אישי ובונוס תוצאה (נצברים על השחקן)
    # ==================================================================
    def _score_player(self, slot: LineupSlot,
                      perf: PlayerPerformance | None,
                      outcome: TeamOutcome | None) -> PlayerScore:
        ps = PlayerScore(player_id=slot.player_id, team_id=slot.team_id,
                         position=slot.position, is_captain=slot.is_captain)
        p = self.rules.personal
        pos = slot.position

        if perf is None or not perf.played:
            # שחקן שלא שיחק: 0 נקודות אישיות. בונוס התוצאה נשלט ב-require_minutes.
            log.debug("אין ביצועים לשחקן %s", slot.player_id)
        else:
            add = ps.lines.append

            # דקות משחק
            if perf.minutes > 0:
                pts = p.minutes_60_plus if perf.minutes >= 60 else p.minutes_played
                add(ScoreLine(Reason.MINUTES, pts, count=perf.minutes,
                              player_id=slot.player_id))

            # שערים — משוקללים לפי עמדה
            if perf.goals:
                unit = float(p.goal.get(pos, 0))
                add(ScoreLine(Reason.GOAL, unit * perf.goals, count=perf.goals,
                              player_id=slot.player_id, meta={"per_goal": unit}))

            if perf.assists:
                add(ScoreLine(Reason.ASSIST, p.assist * perf.assists,
                              count=perf.assists, player_id=slot.player_id))

            # קלין-שיט — רק למי ששיחק מספיק דקות
            if perf.clean_sheet and perf.minutes >= p.clean_sheet_min_minutes:
                unit = float(p.clean_sheet.get(pos, 0))
                if unit:
                    add(ScoreLine(Reason.CLEAN_SHEET, unit,
                                  player_id=slot.player_id))

            # ספיגות (שוערים ומגנים)
            if perf.goals_conceded >= p.goals_conceded_per:
                unit = float(p.goals_conceded.get(pos, 0))
                chunks = perf.goals_conceded // p.goals_conceded_per
                if unit:
                    add(ScoreLine(Reason.GOALS_CONCEDED, unit * chunks,
                                  count=perf.goals_conceded,
                                  player_id=slot.player_id))

            # הצלות
            if perf.saves >= p.saves_per:
                chunks = perf.saves // p.saves_per
                add(ScoreLine(Reason.SAVES, p.saves_points * chunks,
                              count=perf.saves, player_id=slot.player_id))

            if perf.penalties_saved:
                add(ScoreLine(Reason.PENALTY_SAVED,
                              p.penalty_saved * perf.penalties_saved,
                              count=perf.penalties_saved, player_id=slot.player_id))
            if perf.penalties_missed:
                add(ScoreLine(Reason.PENALTY_MISSED,
                              p.penalty_missed * perf.penalties_missed,
                              count=perf.penalties_missed, player_id=slot.player_id))

            # עונשין
            if perf.own_goals:
                add(ScoreLine(Reason.OWN_GOAL, p.own_goal * perf.own_goals,
                              count=perf.own_goals, player_id=slot.player_id))
            if perf.yellow_cards:
                add(ScoreLine(Reason.YELLOW, p.yellow_card * perf.yellow_cards,
                              count=perf.yellow_cards, player_id=slot.player_id))
            if perf.red_cards:
                add(ScoreLine(Reason.RED, p.red_card * perf.red_cards,
                              count=perf.red_cards, player_id=slot.player_id))

        # --- בונוס תוצאה של הקבוצה האמיתית ---
        bonus = self._result_bonus(perf, outcome)
        if bonus is not None:
            ps.lines.append(bonus)

        # --- קפטן: מכפיל על כל מה שהצטבר לשחקן הזה ---
        if slot.is_captain and self.rules.captain_multiplier != 1:
            base = ps.subtotal
            extra = base * (self.rules.captain_multiplier - 1)
            if extra:
                ps.lines.append(ScoreLine(
                    Reason.CAPTAIN, round(extra, 2), player_id=slot.player_id,
                    meta={"multiplier": self.rules.captain_multiplier, "base": base}))

        return ps

    def _result_bonus(self, perf: PlayerPerformance | None,
                      outcome: TeamOutcome | None) -> ScoreLine | None:
        if outcome is None:
            return None
        rb = self.rules.result_bonus
        if rb.require_minutes and (perf is None or perf.minutes < rb.require_minutes):
            return None
        points = {"W": rb.win, "D": rb.draw, "L": rb.loss}[outcome.result]
        if points == 0:
            return None
        return ScoreLine(Reason.RESULT_BONUS, float(points),
                         team_id=outcome.team_id, meta={"result": outcome.result})

    # ==================================================================
    # 3. שערי הרכב וירטואליים
    # ==================================================================
    def _virtual_goals(self, slots: Sequence[LineupSlot],
                       outcomes: Mapping[str, TeamOutcome]) -> list[ScoreLine]:
        """
        כל N שערים שכבשו הקבוצות שבהרכב = שער וירטואלי.

        pooled   : סוכמים הכל, מחלקים פעם אחת. שאריות נשמרות בין קבוצות.
        per_team : כל קבוצה לחוד, שאריות נזרקות.
        """
        v = self.rules.virtual_goal
        if v.goals_per_virtual <= 0:
            return []

        # קבוצות ייחודיות בלבד — גם אם החוקים יאפשרו בעתיד 2 מאותה קבוצה,
        # שערי הקבוצה לא ייספרו פעמיים.
        team_goals: dict[str, int] = {}
        for slot in slots:
            outcome = outcomes.get(slot.team_id)
            if outcome is not None:
                team_goals[slot.team_id] = outcome.goals_for

        if not team_goals:
            return []

        if v.aggregation == "per_team":
            lines: list[ScoreLine] = []
            for team_id, goals in sorted(team_goals.items()):
                count = goals // v.goals_per_virtual
                if count:
                    lines.append(ScoreLine(
                        Reason.VIRTUAL_GOAL, v.points * count, count=count,
                        team_id=team_id, meta={"team_goals": goals}))
            return lines

        total_goals = sum(team_goals.values())
        count = total_goals // v.goals_per_virtual
        if not count:
            return []
        return [ScoreLine(
            Reason.VIRTUAL_GOAL, v.points * count, count=count,
            meta={"team_goals_total": total_goals,
                  "remainder": total_goals % v.goals_per_virtual,
                  "per_team": team_goals})]


# ======================================================================
# מצרפים: טבלת המחזור
# ======================================================================
def rank_gameweek(scores: Iterable[LineupScore]) -> list[tuple[int, LineupScore]]:
    """דירוג עם טיפול בשוויון (אותו ניקוד = אותו מקום)."""
    ordered = sorted(scores, key=lambda s: s.total_points, reverse=True)
    ranked: list[tuple[int, LineupScore]] = []
    last_points, last_rank = None, 0
    for idx, score in enumerate(ordered, start=1):
        if score.total_points != last_points:
            last_rank, last_points = idx, score.total_points
        ranked.append((last_rank, score))
    return ranked


# ======================================================================
# גשר ל-DB (השכבה היחידה שיודעת על SQL)
# ======================================================================
def build_inputs_from_rows(
    perf_rows: Iterable[Mapping],
    match_rows: Iterable[Mapping],
) -> tuple[dict[str, PlayerPerformance], dict[str, TeamOutcome]]:
    """
    ממיר תוצאות שאילתה למבני הקלט של המנוע.
    perf_rows  : core.player_match_stats מסונן למחזור
    match_rows : core.v_team_match_results מסונן למחזור
    שחקן ששיחק שני משחקים באותו מחזור (דחייה שהושלמה) — נצבר.
    """
    perfs: dict[str, PlayerPerformance] = {}
    acc: dict[str, dict] = defaultdict(lambda: defaultdict(int))

    for r in perf_rows:
        a = acc[r["player_id"]]
        a["team_id"] = r["team_id"]
        a["position"] = r["position"]
        for k in ("minutes", "goals", "assists", "own_goals", "yellow_cards",
                  "red_cards", "saves", "penalties_saved", "penalties_missed",
                  "goals_conceded"):
            a[k] += r.get(k, 0) or 0
        a["clean_sheets"] += 1 if r.get("clean_sheet") else 0

    for player_id, a in acc.items():
        perfs[player_id] = PlayerPerformance(
            player_id=player_id, team_id=a["team_id"], position=a["position"],
            minutes=a["minutes"], goals=a["goals"], assists=a["assists"],
            own_goals=a["own_goals"], yellow_cards=a["yellow_cards"],
            red_cards=a["red_cards"], saves=a["saves"],
            penalties_saved=a["penalties_saved"],
            penalties_missed=a["penalties_missed"],
            goals_conceded=a["goals_conceded"],
            clean_sheet=a["clean_sheets"] > 0 and a["goals_conceded"] == 0,
            played=a["minutes"] > 0,
        )

    outcomes: dict[str, TeamOutcome] = {}
    for r in match_rows:
        team_id = r["team_id"]
        prev = outcomes.get(team_id)
        # מחזור עם שני משחקים לאותה קבוצה: צוברים שערים, התוצאה הטובה קובעת
        if prev is None:
            outcomes[team_id] = TeamOutcome(team_id, r["result"],
                                            r["goals_for"], r["goals_against"])
        else:
            best = max(prev.result, r["result"], key=lambda x: {"W": 2, "D": 1, "L": 0}[x])
            outcomes[team_id] = TeamOutcome(
                team_id, best,
                prev.goals_for + r["goals_for"],
                prev.goals_against + r["goals_against"])
    return perfs, outcomes
