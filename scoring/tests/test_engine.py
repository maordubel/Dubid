"""טסטים למנוע הניקוד. הרצה:  pytest -q  מתוך תיקיית השורש."""
from __future__ import annotations

import pytest

from scoring.engine import ScoringEngine, rank_gameweek
from scoring.models import Lineup, LineupSlot, PlayerPerformance, Reason, TeamOutcome
from scoring.rules import ConstraintRules, RuleSet, VirtualGoalRules
from scoring.validation import ErrorCode, LineupInvalid, validate_lineup

RULES = RuleSet(version=1, league_code="IL_PREMIER")


# --------------------------------------------------------------------------
# עזרים
# --------------------------------------------------------------------------
def slot(n: int, pos: str, captain: bool = False) -> LineupSlot:
    return LineupSlot(player_id=f"P{n}", team_id=f"T{n}",
                      position=pos, is_captain=captain)


def perf(n: int, pos: str, **kw) -> PlayerPerformance:
    kw.setdefault("minutes", 90)
    return PlayerPerformance(player_id=f"P{n}", team_id=f"T{n}",
                             position=pos, **kw)


def outcome(n: int, result: str, gf: int, ga: int = 0) -> TeamOutcome:
    return TeamOutcome(team_id=f"T{n}", result=result, goals_for=gf, goals_against=ga)


def make_lineup(slots, formation="4-3-3") -> Lineup:
    return Lineup(lineup_id="L1", user_id="U1", gameweek_id="GW7",
                  slots=tuple(slots), formation=formation)


# --------------------------------------------------------------------------
# 1. ציון אישי
# --------------------------------------------------------------------------
def test_forward_goal_and_assist():
    eng = ScoringEngine(RULES)
    ps = eng._score_player(slot(1, "FWD"),
                           perf(1, "FWD", goals=2, assists=1),
                           None)
    # 90 דקות=2 · 2 שערים לחלוץ=10 · בישול=3
    assert ps.subtotal == 15


def test_goalkeeper_is_worth_more_per_goal():
    eng = ScoringEngine(RULES)
    gk = eng._score_player(slot(1, "GK"), perf(1, "GK", goals=1), None)
    fw = eng._score_player(slot(2, "FWD"), perf(2, "FWD", goals=1), None)
    assert gk.subtotal > fw.subtotal          # 10 מול 5


def test_clean_sheet_requires_60_minutes():
    eng = ScoringEngine(RULES)
    full = eng._score_player(slot(1, "GK"), perf(1, "GK", minutes=90, clean_sheet=True), None)
    short = eng._score_player(slot(1, "GK"), perf(1, "GK", minutes=30, clean_sheet=True), None)
    assert any(l.reason is Reason.CLEAN_SHEET for l in full.lines)
    assert not any(l.reason is Reason.CLEAN_SHEET for l in short.lines)


def test_cards_are_negative():
    eng = ScoringEngine(RULES)
    ps = eng._score_player(slot(1, "MID"),
                           perf(1, "MID", yellow_cards=1, red_cards=1), None)
    assert ps.subtotal == 2 - 1 - 3 == -2


def test_player_who_did_not_play_scores_nothing_personal():
    eng = ScoringEngine(RULES)
    ps = eng._score_player(slot(1, "FWD"), perf(1, "FWD", minutes=0, played=False), None)
    assert ps.subtotal == 0


# --------------------------------------------------------------------------
# 2. בונוס תוצאה
# --------------------------------------------------------------------------
@pytest.mark.parametrize("result,expected", [("W", 4), ("D", 1), ("L", 0)])
def test_result_bonus(result, expected):
    eng = ScoringEngine(RULES)
    ps = eng._score_player(slot(1, "MID"), perf(1, "MID", minutes=0, played=False),
                           outcome(1, result, gf=1))
    assert ps.subtotal == expected


def test_result_bonus_can_require_minutes():
    rules = RuleSet(result_bonus=type(RULES.result_bonus)(require_minutes=1))
    eng = ScoringEngine(rules)
    ps = eng._score_player(slot(1, "MID"), perf(1, "MID", minutes=0, played=False),
                           outcome(1, "W", gf=2))
    assert ps.subtotal == 0


# --------------------------------------------------------------------------
# 3. שער הרכב וירטואלי
# --------------------------------------------------------------------------
def test_virtual_goals_pooled():
    eng = ScoringEngine(RULES)
    slots = [slot(1, "GK"), slot(2, "DEF"), slot(3, "DEF")]
    outcomes = {"T1": outcome(1, "W", 3), "T2": outcome(2, "D", 1), "T3": outcome(3, "W", 3)}
    lines = eng._virtual_goals(slots, outcomes)
    # 3+1+3 = 7 שערים -> 7//2 = 3 שערים וירטואליים -> 15 נקודות
    assert len(lines) == 1
    assert lines[0].count == 3
    assert lines[0].points == 15
    assert lines[0].meta["remainder"] == 1


def test_virtual_goals_per_team_discards_remainders():
    rules = RuleSet(virtual_goal=VirtualGoalRules(aggregation="per_team"))
    eng = ScoringEngine(rules)
    slots = [slot(1, "GK"), slot(2, "DEF"), slot(3, "DEF")]
    outcomes = {"T1": outcome(1, "W", 3), "T2": outcome(2, "D", 1), "T3": outcome(3, "W", 3)}
    lines = eng._virtual_goals(slots, outcomes)
    # כל קבוצה לחוד: 3//2=1, 1//2=0, 3//2=1  ->  2 שערים, 10 נקודות
    assert sum(l.points for l in lines) == 10


def test_virtual_goals_ignore_teams_without_a_match():
    eng = ScoringEngine(RULES)
    lines = eng._virtual_goals([slot(1, "GK")], {})   # מחזור דחוי
    assert lines == []


# --------------------------------------------------------------------------
# 4. אילוץ ההרכב — הכלל המרכזי של המשחק
# --------------------------------------------------------------------------
def full_lineup(team_ids: list[str] | None = None) -> Lineup:
    positions = ["GK"] + ["DEF"] * 4 + ["MID"] * 3 + ["FWD"] * 3
    slots = []
    for i, pos in enumerate(positions, start=1):
        team = team_ids[i - 1] if team_ids else f"T{i}"
        slots.append(LineupSlot(player_id=f"P{i}", team_id=team,
                                position=pos, is_captain=(i == 9)))
    return make_lineup(slots)


def test_valid_lineup_passes():
    assert validate_lineup(full_lineup(), RULES) == []


def test_two_players_from_same_team_is_rejected():
    teams = [f"T{i}" for i in range(1, 12)]
    teams[5] = teams[0]                       # שני שחקנים מ-T1
    issues = validate_lineup(full_lineup(teams), RULES)
    codes = {i.code for i in issues}
    assert ErrorCode.DUPLICATE_TEAM in codes
    msg = next(i for i in issues if i.code is ErrorCode.DUPLICATE_TEAM).message("he")
    assert "T1" in msg


def test_engine_refuses_to_score_invalid_lineup():
    teams = [f"T{i}" for i in range(1, 12)]
    teams[3] = teams[2]
    with pytest.raises(LineupInvalid):
        ScoringEngine(RULES).score(full_lineup(teams), {}, {})


def test_wrong_size_is_rejected():
    lineup = make_lineup(full_lineup().slots[:10])
    codes = {i.code for i in validate_lineup(lineup, RULES)}
    assert ErrorCode.LINEUP_SIZE in codes


def test_formation_mismatch_is_rejected():
    lineup = Lineup(lineup_id="L", user_id="U", gameweek_id="G",
                    slots=full_lineup().slots, formation="4-4-2")
    codes = {i.code for i in validate_lineup(lineup, RULES)}
    assert ErrorCode.FORMATION_MISMATCH in codes


def test_foreign_league_may_allow_two_per_team():
    rules = RuleSet(constraints=ConstraintRules(lineup_size=11, max_players_per_team=2))
    teams = [f"T{i}" for i in range(1, 12)]
    teams[5] = teams[0]
    assert validate_lineup(full_lineup(teams), rules) == []


# --------------------------------------------------------------------------
# 5. תרחיש מלא מקצה לקצה
# --------------------------------------------------------------------------
def test_full_gameweek_scenario():
    """
    מחזור מלא עם מספרים מחושבים ביד:
      אישי 52 · בונוס תוצאה 19 · קפטן 16 · וירטואלי 35  =  122
    """
    lineup = full_lineup()          # P9 (חלוץ, T9) הוא הקפטן

    performances = {
        "P1":  perf(1, "GK",  clean_sheet=True, saves=4),
        "P2":  perf(2, "DEF", goals=1, goals_conceded=1),
        "P3":  perf(3, "DEF"),
        "P4":  perf(4, "DEF"),
        "P5":  perf(5, "DEF"),
        "P6":  perf(6, "MID", assists=2),
        "P7":  perf(7, "MID", minutes=45),
        "P8":  perf(8, "MID", minutes=45),
        "P9":  perf(9, "FWD", goals=2),
        "P10": perf(10, "FWD", minutes=0, played=False),
        "P11": perf(11, "FWD", goals=1, yellow_cards=1),
    }
    outcomes = {
        "T1": outcome(1, "W", 2), "T2": outcome(2, "D", 1),
        "T3": outcome(3, "L", 0), "T4": outcome(4, "L", 0), "T5": outcome(5, "L", 0),
        "T6": outcome(6, "W", 3), "T7": outcome(7, "D", 1), "T8": outcome(8, "D", 1),
        "T9": outcome(9, "W", 2), "T10": outcome(10, "L", 0), "T11": outcome(11, "W", 4),
    }

    score = ScoringEngine(RULES).score(lineup, performances, outcomes)

    assert score.personal_points == 52
    assert score.result_points == 19
    assert score.captain_points == 16
    assert score.virtual_points == 35        # 14 שערי קבוצות -> 7 וירטואליים
    assert score.total_points == 122

    payload = score.to_jsonb()
    assert payload["total"] == 122
    assert len(payload["players"]) == 11
    captain = next(p for p in payload["players"] if p["is_captain"])
    assert captain["subtotal"] == 32         # 16 בסיס x2


def test_ranking_handles_ties():
    def fake(total: float, lid: str):
        from scoring.models import LineupScore, PlayerScore, ScoreLine
        s = LineupScore(lineup_id=lid, gameweek_id="GW7", ruleset_version=1)
        s.bonus_lines.append(ScoreLine(Reason.VIRTUAL_GOAL, total))
        return s

    ranked = rank_gameweek([fake(50, "a"), fake(70, "b"), fake(50, "c")])
    assert [r for r, _ in ranked] == [1, 2, 2]
