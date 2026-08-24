/**
 * ⚠ נוצר אוטומטית — אל תערכו כאן.
 *
 * הועתק מ-src/lib/ על ידי scripts/sync-edge-shared.mjs.
 * כל שינוי כאן יימחק בפריסה הבאה. ערכו את המקור.
 */
/**
 * scoring/engine.ts — מנוע הניקוד של דוביד.
 *
 *   scoreLineup(lineup, performances, outcomes, rules) -> LineupScore
 *
 * טהור לחלוטין: אין DB, אין fetch, אין Date.now(). אותם קלטים מחזירים
 * תמיד אותו מספר — אפשר לחשב מחדש מחזור מלפני שנה ולקבל בדיוק אותו ציון.
 * זה מה שמאפשר להריץ אותו גם בדפדפן (תצוגה חיה) וגם ב-Edge Function
 * (החישוב הרשמי) בלי סיכון לפער בין המספרים.
 *
 * ארבעת רכיבי הניקוד:
 *   1. ציון אישי       — פעולות השחקן, משוקללות לפי עמדה
 *   2. בונוס תוצאה     — ניצחון הקבוצה האמיתית +4 / תיקו +1
 *   3. שער וירטואלי    — כל 2 שערים של קבוצות ההרכב = +5
 *   4. הקפטן הדובידי   — ×3, חסינות כרטיסים, והעברה לסגן
 */
import {
  Reason,
  type Lineup,
  type LineupScore,
  type LineupSlot,
  type PlayerPerformance,
  type PlayerScore,
  type ScoreLine,
  type TeamOutcome,
} from './types.ts';
import { IL_PREMIER, type RuleSet } from './rules.ts';
import { assertValidLineup, starters } from './validate.ts';

const round2 = (n: number) => Math.round(n * 100) / 100;
const sum = (lines: ScoreLine[]) => lines.reduce((a, l) => a + l.points, 0);

export interface ScoreOptions {
  /** ברירת מחדל true. כבו רק לחישובי "מה היה קורה אם". */
  validate?: boolean;
  locale?: 'he' | 'en';
}

export function scoreLineup(
  lineup: Lineup,
  performances: Map<string, PlayerPerformance> | Record<string, PlayerPerformance>,
  outcomes: Map<string, TeamOutcome> | Record<string, TeamOutcome>,
  rules: RuleSet = IL_PREMIER,
  options: ScoreOptions = {},
): LineupScore {
  const { validate = true, locale = 'he' } = options;

  // ★ שכבת ההגנה: אין ניקוד להרכב לא חוקי. גם לא "בערך".
  if (validate) assertValidLineup(lineup, rules, locale);

  const perf = toMap(performances);
  const out = toMap(outcomes);
  const xi = starters(lineup);

  // --- 1+2. ציון אישי ובונוס תוצאה, לכל שחקן ---
  const players: PlayerScore[] = xi.map((slot) =>
    scorePlayer(slot, perf.get(slot.playerId), out.get(slot.teamId), rules),
  );

  // --- 4. הקפטן הדובידי (משנה את השחקן הרלוונטי במקום) ---
  applyDubidCaptain(xi, players, perf, out, rules);

  // --- 3. שערי הרכב וירטואליים ---
  const bonusLines = virtualGoals(xi, out, rules);

  const allPlayerLines = players.flatMap((p) => p.lines);
  const byReason = (...codes: string[]) =>
    round2(sum(allPlayerLines.filter((l) => codes.includes(l.reason))));

  const captainPoints = byReason(
    Reason.CaptainMultiplier,
    Reason.CaptainImmunity,
  );
  const resultPoints = byReason(Reason.ResultBonus);
  const personalPoints = round2(
    sum(
      allPlayerLines.filter(
        (l) =>
          l.reason !== Reason.ResultBonus &&
          l.reason !== Reason.CaptainMultiplier &&
          l.reason !== Reason.CaptainImmunity &&
          l.reason !== Reason.CaptainTransferred,
      ),
    ),
  );
  const virtualPoints = round2(sum(bonusLines));

  return {
    lineupId: lineup.lineupId,
    gameweekId: lineup.gameweekId,
    rulesetVersion: rules.version,
    players,
    bonusLines,
    personalPoints,
    resultPoints,
    captainPoints,
    virtualPoints,
    totalPoints: round2(
      players.reduce((a, p) => a + p.subtotal, 0) + sum(bonusLines),
    ),
  };
}

/* =================================================================== */
/* 1 + 2 · ציון אישי ובונוס תוצאה                                       */
/* =================================================================== */

function scorePlayer(
  slot: LineupSlot,
  perf: PlayerPerformance | undefined,
  outcome: TeamOutcome | undefined,
  rules: RuleSet,
): PlayerScore {
  const p = rules.personal;
  const pos = slot.position;
  const lines: ScoreLine[] = [];
  const add = (
    reason: ScoreLine['reason'],
    points: number,
    count?: number,
    meta?: Record<string, unknown>,
  ) => {
    if (points !== 0) lines.push({ reason, points: round2(points), count, playerId: slot.playerId, meta });
  };

  if (perf && perf.played) {
    if (perf.minutes > 0) {
      add(Reason.Minutes, perf.minutes >= 60 ? p.minutes60Plus : p.minutesPlayed, perf.minutes);
    }
    if (perf.goals) add(Reason.Goal, p.goal[pos] * perf.goals, perf.goals, { perGoal: p.goal[pos] });
    if (perf.assists) add(Reason.Assist, p.assist * perf.assists, perf.assists);
    if (perf.cleanSheet && perf.minutes >= p.cleanSheetMinMinutes) {
      add(Reason.CleanSheet, p.cleanSheet[pos]);
    }
    if (perf.goalsConceded >= p.goalsConcededPer) {
      add(
        Reason.GoalsConceded,
        p.goalsConceded[pos] * Math.floor(perf.goalsConceded / p.goalsConcededPer),
        perf.goalsConceded,
      );
    }
    if (perf.saves >= p.savesPer) {
      add(Reason.Saves, p.savesPoints * Math.floor(perf.saves / p.savesPer), perf.saves);
    }
    if (perf.penaltiesSaved) add(Reason.PenaltySaved, p.penaltySaved * perf.penaltiesSaved, perf.penaltiesSaved);
    if (perf.penaltiesMissed) add(Reason.PenaltyMissed, p.penaltyMissed * perf.penaltiesMissed, perf.penaltiesMissed);
    if (perf.ownGoals) add(Reason.OwnGoal, p.ownGoal * perf.ownGoals, perf.ownGoals);
    if (perf.yellowCards) add(Reason.Yellow, p.yellowCard * perf.yellowCards, perf.yellowCards);
    if (perf.redCards) add(Reason.Red, p.redCard * perf.redCards, perf.redCards);
  }

  // בונוס תוצאה — שייך לשחקן כי הוא נובע מהקבוצה שהוא מייצג בהרכב
  if (outcome) {
    const rb = rules.resultBonus;
    const eligible = rb.requireMinutes === 0 || (perf?.minutes ?? 0) >= rb.requireMinutes;
    const pts = rb[outcome.result];
    if (eligible && pts !== 0) {
      lines.push({
        reason: Reason.ResultBonus,
        points: pts,
        playerId: slot.playerId,
        teamId: outcome.teamId,
        meta: { result: outcome.result },
      });
    }
  }

  return {
    playerId: slot.playerId,
    teamId: slot.teamId,
    position: pos,
    isCaptain: !!slot.isCaptain,
    lines,
    subtotal: round2(sum(lines)),
  };
}

/* =================================================================== */
/* 4 · ★ הקפטן הדובידי                                                  */
/* =================================================================== */

function applyDubidCaptain(
  xi: LineupSlot[],
  players: PlayerScore[],
  perf: Map<string, PlayerPerformance>,
  outcomes: Map<string, TeamOutcome>,
  rules: RuleSet,
): void {
  const c = rules.captain;
  const captainSlot = xi.find((s) => s.isCaptain);
  if (!captainSlot) return;

  // -- שלב א׳: קפטן שלא ירד למגרש -> הכפולה עוברת לסגן --------------
  let effectiveSlot = captainSlot;
  let transferred = false;
  const captainMinutes = perf.get(captainSlot.playerId)?.minutes ?? 0;

  if (captainMinutes < c.transferToViceIfMinutesBelow) {
    const vice = xi.find((s) => s.isVice && s.playerId !== captainSlot.playerId);
    const viceMinutes = vice ? (perf.get(vice.playerId)?.minutes ?? 0) : 0;
    if (vice && viceMinutes >= c.transferToViceIfMinutesBelow) {
      effectiveSlot = vice;
      transferred = true;
    } else {
      return; // אין קפטן פעיל ואין סגן פעיל — אין מכפיל. תיעוד בלבד.
    }
  }

  const target = players.find((p) => p.playerId === effectiveSlot.playerId);
  if (!target) return;

  if (transferred) {
    target.lines.push({
      reason: Reason.CaptainTransferred,
      points: 0,
      playerId: target.playerId,
      meta: { from: captainSlot.playerId, reason: 'captain_did_not_play' },
    });
    target.isCaptain = true;
  }

  // -- שלב ב׳: חסינות כרטיסים ---------------------------------------
  const result = outcomes.get(target.teamId)?.result;
  const minutes = perf.get(target.playerId)?.minutes ?? 0;
  const immunityEarned =
    minutes >= c.immunity.minMinutes &&
    (result === undefined || c.immunity.requireResultIn.includes(result));

  if (immunityEarned) {
    const forgiven: string[] = [];
    if (c.immunity.yellowCards) forgiven.push(Reason.Yellow);
    if (c.immunity.redCards) forgiven.push(Reason.Red);

    const penalty = sum(target.lines.filter((l) => forgiven.includes(l.reason)));
    if (penalty < 0) {
      // הקו המקורי נשאר בפירוט (המשתמש רוצה לראות שהיה כרטיס),
      // והזיכוי מופיע לידו כשורה נפרדת. שקיפות > קיצור.
      target.lines.push({
        reason: Reason.CaptainImmunity,
        points: round2(-penalty),
        playerId: target.playerId,
        meta: { forgiven, minutes, result },
      });
    }
  }

  // -- שלב ג׳: המכפיל -----------------------------------------------
  const multiplied = target.lines.filter((l) =>
    c.appliesTo === 'personalAndResult'
      ? l.reason !== Reason.CaptainMultiplier && l.reason !== Reason.CaptainTransferred
      : l.reason !== Reason.ResultBonus &&
        l.reason !== Reason.CaptainMultiplier &&
        l.reason !== Reason.CaptainTransferred,
  );
  const base = round2(sum(multiplied));

  if (base > 0 || (c.applyToNegative && base !== 0)) {
    const extra = round2(base * (c.multiplier - 1));
    if (extra !== 0) {
      target.lines.push({
        reason: Reason.CaptainMultiplier,
        points: extra,
        playerId: target.playerId,
        meta: { multiplier: c.multiplier, base, appliesTo: c.appliesTo },
      });
    }
  }

  target.subtotal = round2(sum(target.lines));
}

/* =================================================================== */
/* 3 · שערי הרכב וירטואליים                                             */
/* =================================================================== */

function virtualGoals(
  xi: LineupSlot[],
  outcomes: Map<string, TeamOutcome>,
  rules: RuleSet,
): ScoreLine[] {
  const v = rules.virtualGoal;
  if (v.goalsPerVirtual <= 0) return [];

  // קבוצות ייחודיות: גם אם ליגה עתידית תאפשר 2 מאותה קבוצה,
  // השערים שלה לא ייספרו פעמיים.
  const teamGoals = new Map<string, number>();
  for (const slot of xi) {
    const o = outcomes.get(slot.teamId);
    if (o) teamGoals.set(slot.teamId, o.goalsFor);
  }
  if (teamGoals.size === 0) return [];

  if (v.aggregation === 'perTeam') {
    const lines: ScoreLine[] = [];
    for (const [teamId, goals] of [...teamGoals].sort()) {
      const count = Math.floor(goals / v.goalsPerVirtual);
      if (count > 0) {
        lines.push({
          reason: Reason.VirtualGoal,
          points: round2(v.points * count),
          count,
          teamId,
          meta: { teamGoals: goals },
        });
      }
    }
    return lines;
  }

  const total = [...teamGoals.values()].reduce((a, b) => a + b, 0);
  const count = Math.floor(total / v.goalsPerVirtual);
  if (count === 0) return [];
  return [
    {
      reason: Reason.VirtualGoal,
      points: round2(v.points * count),
      count,
      meta: {
        teamGoalsTotal: total,
        remainder: total % v.goalsPerVirtual,
        perTeam: Object.fromEntries(teamGoals),
      },
    },
  ];
}

/* =================================================================== */
/* מצרפים ועזרים                                                        */
/* =================================================================== */

/** דירוג עם טיפול בשוויון: אותו ניקוד = אותו מקום. */
export function rankGameweek(scores: LineupScore[]): Array<{ rank: number; score: LineupScore }> {
  const ordered = [...scores].sort((a, b) => b.totalPoints - a.totalPoints);
  const out: Array<{ rank: number; score: LineupScore }> = [];
  let lastPoints: number | null = null;
  let lastRank = 0;
  ordered.forEach((score, i) => {
    if (score.totalPoints !== lastPoints) {
      lastRank = i + 1;
      lastPoints = score.totalPoints;
    }
    out.push({ rank: lastRank, score });
  });
  return out;
}

/** פירוט לשמירה ב-DB ולתצוגה ב-UI. */
export function toBreakdown(score: LineupScore) {
  return {
    total: score.totalPoints,
    personal: score.personalPoints,
    result: score.resultPoints,
    captain: score.captainPoints,
    virtual: score.virtualPoints,
    rulesetVersion: score.rulesetVersion,
    players: score.players.map((p) => ({
      playerId: p.playerId,
      teamId: p.teamId,
      position: p.position,
      isCaptain: p.isCaptain,
      subtotal: p.subtotal,
      lines: p.lines.map((l) => ({ reason: l.reason, points: l.points, count: l.count, meta: l.meta })),
    })),
    bonuses: score.bonusLines,
  };
}

function toMap<T>(input: Map<string, T> | Record<string, T>): Map<string, T> {
  return input instanceof Map ? input : new Map(Object.entries(input));
}

/**
 * המרת שורות מה-DB לקלט המנוע.
 * שחקן ששיחק שני משחקים במחזור (השלמת משחק דחוי) — הנתונים נצברים.
 */
export function buildInputs(
  statRows: Array<Record<string, any>>,
  matchRows: Array<Record<string, any>>,
): { performances: Map<string, PlayerPerformance>; outcomes: Map<string, TeamOutcome> } {
  const acc = new Map<string, PlayerPerformance>();
  for (const r of statRows) {
    const cur =
      acc.get(r.player_id) ??
      ({
        playerId: r.player_id,
        teamId: r.team_id,
        position: r.position,
        minutes: 0, goals: 0, assists: 0, ownGoals: 0, yellowCards: 0, redCards: 0,
        saves: 0, penaltiesSaved: 0, penaltiesMissed: 0, goalsConceded: 0,
        cleanSheet: false, played: false,
      } as PlayerPerformance);
    cur.minutes += r.minutes ?? 0;
    cur.goals += r.goals ?? 0;
    cur.assists += r.assists ?? 0;
    cur.ownGoals += r.own_goals ?? 0;
    cur.yellowCards += r.yellow_cards ?? 0;
    cur.redCards += r.red_cards ?? 0;
    cur.saves += r.saves ?? 0;
    cur.penaltiesSaved += r.penalties_saved ?? 0;
    cur.penaltiesMissed += r.penalties_missed ?? 0;
    cur.goalsConceded += r.goals_conceded ?? 0;
    cur.played = cur.minutes > 0;
    cur.cleanSheet = cur.goalsConceded === 0 && cur.minutes > 0;
    acc.set(r.player_id, cur);
  }

  const outcomes = new Map<string, TeamOutcome>();
  const rank = { W: 2, D: 1, L: 0 } as const;
  for (const r of matchRows) {
    const prev = outcomes.get(r.team_id);
    if (!prev) {
      outcomes.set(r.team_id, {
        teamId: r.team_id,
        result: r.result,
        goalsFor: r.goals_for ?? 0,
        goalsAgainst: r.goals_against ?? 0,
      });
    } else {
      outcomes.set(r.team_id, {
        teamId: r.team_id,
        result: rank[r.result as 'W'] > rank[prev.result] ? r.result : prev.result,
        goalsFor: prev.goalsFor + (r.goals_for ?? 0),
        goalsAgainst: prev.goalsAgainst + (r.goals_against ?? 0),
      });
    }
  }

  return { performances: acc, outcomes };
}
