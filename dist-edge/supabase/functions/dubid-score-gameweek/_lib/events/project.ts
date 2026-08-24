/**
 * ⚠ נוצר אוטומטית — אל תערכו כאן.
 *
 * הועתק מ-src/lib/ על ידי scripts/sync-edge-shared.mjs.
 * כל שינוי כאן יימחק בפריסה הבאה. ערכו את המקור.
 */
/**
 * events/project.ts — הקרנה: מלוג אירועים לקלט של מנוע הניקוד.
 *
 * ★ נקודת החיבור לארכיטקטורה הקיימת
 *
 * הפונקציה כאן מחזירה בדיוק את שני המבנים ש-`scoreLineup` כבר מקבל
 * היום — `PlayerPerformance` ו-`TeamOutcome`. לא נגענו במנוע, לא
 * שכפלנו אותו, ולא הוספנו מנוע שני. הלוג פשוט נעשה מקור הקלט שלו.
 *
 *     לוג אירועים ──project──▶ PlayerPerformance / TeamOutcome
 *                                        │
 *                                        ▼
 *                                  scoreLineup()   ← הקוד הקיים, ללא שינוי
 *
 * ההקרנה טהורה לחלוטין: אין DB, אין fetch, אין `Date.now()`. אותו לוג
 * מחזיר תמיד בדיוק את אותה תוצאה — גם בעוד שנה, גם בשרת אחר.
 */
import type { PlayerPerformance, Position, TeamOutcome } from '../scoring/types.ts';
import { EventKind, type MatchEvent, type MatchLog } from './types.ts';
import { effectiveEvents } from './log.ts';

/** מי משחק איפה. בא מ-snapshot הסגל, לא מהלוג — הלוג לא מחזיק עמדות. */
export interface RosterEntry {
  playerId: string;
  teamId: string;
  position: Position;
}
export type Roster = Map<string, RosterEntry> | Record<string, RosterEntry>;

/** אורך משחק תקני. מוחלף אם יש אירוע FullTime עם דקה מפורשת. */
const REGULATION = 90;

export interface Projection {
  performances: Map<string, PlayerPerformance>;
  outcomes: Map<string, TeamOutcome>;
  /** סטטיסטיקות מורחבות שהמנוע הבסיסי לא צורך — לכרטיס השחקן ולשוברי שוויון. */
  extended: Map<string, ExtendedStats>;
}

/**
 * נתונים שהברִיף מבקש להציג ("למה שאבחר בשחקן הזה?") ולהשתמש בהם
 * כשוברי שוויון. הם נאספים מאותו לוג — לא ממקור נתונים שני.
 */
export interface ExtendedStats {
  playerId: string;
  shots: number;
  shotsOnTarget: number;
  keyPasses: number;
  dribbles: number;
  tackles: number;
  interceptions: number;
  clearances: number;
  recoveries: number;
  penaltiesScored: number;
  /** דקת השער האחרון. מאפשר כלל "שער מאוחר" בלי נתון חיצוני. */
  lastGoalMinute: number | null;
  /** האם נכנס מהספסל — לכלל "השפעת חילוף". */
  cameOffBench: boolean;
}

/* =================================================================== */

export function project(log: MatchLog, roster: Roster): Projection {
  const R = roster instanceof Map ? roster : new Map(Object.entries(roster));
  const events = effectiveEvents(log);

  const fullTime = finalWhistle(events);
  const teams = [log.homeTeamId, log.awayTeamId];

  /* -- שלב א׳: זמני כניסה ויציאה ------------------------------------ */
  // נבנה קודם את "מי היה על המגרש ומתי", כי בלי זה אי אפשר לחשב
  // לא דקות, לא ספיגות, ולא קלין-שיט. הכול תלוי בחלון הזמן.
  const onPitch = new Map<string, { from: number; to: number }>();
  for (const e of events) {
    if (!e.playerId) continue;
    const at = absoluteMinute(e);
    switch (e.kind) {
      case EventKind.LineupStart:
        onPitch.set(e.playerId, { from: 0, to: fullTime });
        break;
      case EventKind.SubOn: {
        onPitch.set(e.playerId, { from: at, to: fullTime });
        break;
      }
      case EventKind.SubOff: {
        const w = onPitch.get(e.playerId);
        if (w) w.to = Math.min(w.to, at);
        break;
      }
      case EventKind.RedCard:
      case EventKind.SecondYellow: {
        const w = onPitch.get(e.playerId);
        if (w) w.to = Math.min(w.to, at);
        break;
      }
    }
  }

  /* -- שלב ב׳: שערים לפי דקה, לכל קבוצה ----------------------------- */
  // שער עצמי נזקף לזכות היריבה. זה נשמע טריוויאלי ובדיוק בגלל זה
  // כדאי שיהיה כתוב פעם אחת, כאן, ולא בכל מקום שסופר שערים.
  const goalsByTeam = new Map<string, number[]>(teams.map((t) => [t, []]));
  for (const e of events) {
    const at = absoluteMinute(e);
    if (e.kind === EventKind.Goal || e.kind === EventKind.PenaltyScored) {
      goalsByTeam.get(e.teamId)?.push(at);
    } else if (e.kind === EventKind.OwnGoal) {
      const other = teams.find((t) => t !== e.teamId);
      if (other) goalsByTeam.get(other)?.push(at);
    }
  }

  /* -- שלב ג׳: תוצאות הקבוצות --------------------------------------- */
  const outcomes = new Map<string, TeamOutcome>();
  const abandoned = events.some(
    (e) => e.kind === EventKind.MatchAbandoned || e.kind === EventKind.MatchPostponed,
  );
  if (!abandoned) {
    for (const teamId of teams) {
      const other = teams.find((t) => t !== teamId)!;
      const gf = goalsByTeam.get(teamId)!.length;
      const ga = goalsByTeam.get(other)!.length;
      outcomes.set(teamId, {
        teamId,
        result: gf > ga ? 'W' : gf < ga ? 'L' : 'D',
        goalsFor: gf,
        goalsAgainst: ga,
      });
    }
  }
  // משחק שנזנח או נדחה לא מייצר תוצאה. הברִיף דורש דטרמיניזם, ו"תיקו"
  // למשחק שלא הסתיים הוא ניחוש שמחלק נקודות שאף אחד לא הרוויח.

  /* -- שלב ד׳: ביצועי שחקנים ---------------------------------------- */
  const perf = new Map<string, PlayerPerformance>();
  const ext = new Map<string, ExtendedStats>();

  const touch = (playerId: string, teamId: string): PlayerPerformance => {
    let p = perf.get(playerId);
    if (!p) {
      const r = R.get(playerId);
      p = {
        playerId,
        teamId: r?.teamId ?? teamId,
        position: r?.position ?? 'MID',
        minutes: 0, goals: 0, assists: 0, ownGoals: 0,
        yellowCards: 0, redCards: 0, saves: 0,
        penaltiesSaved: 0, penaltiesMissed: 0, goalsConceded: 0,
        cleanSheet: false, played: false,
      };
      perf.set(playerId, p);
      ext.set(playerId, {
        playerId, shots: 0, shotsOnTarget: 0, keyPasses: 0, dribbles: 0,
        tackles: 0, interceptions: 0, clearances: 0, recoveries: 0,
        penaltiesScored: 0, lastGoalMinute: null, cameOffBench: false,
      });
    }
    return p;
  };

  for (const e of events) {
    if (!e.playerId) continue;
    const p = touch(e.playerId, e.teamId);
    const x = ext.get(e.playerId)!;
    const at = absoluteMinute(e);

    switch (e.kind) {
      case EventKind.SubOn:            x.cameOffBench = true; break;
      case EventKind.Goal:
      case EventKind.PenaltyScored:
        p.goals += 1;
        x.lastGoalMinute = at;
        if (e.kind === EventKind.PenaltyScored) x.penaltiesScored += 1;
        break;
      case EventKind.Assist:           p.assists += 1; break;
      case EventKind.OwnGoal:          p.ownGoals += 1; break;
      case EventKind.PenaltyMissed:    p.penaltiesMissed += 1; break;
      case EventKind.PenaltySaved:     p.penaltiesSaved += 1; p.saves += 1; break;
      case EventKind.Save:             p.saves += 1; break;
      case EventKind.YellowCard:       p.yellowCards += 1; break;
      case EventKind.SecondYellow:     p.yellowCards += 1; p.redCards += 1; break;
      case EventKind.RedCard:          p.redCards += 1; break;
      case EventKind.Shot:             x.shots += 1; break;
      case EventKind.ShotOnTarget:     x.shots += 1; x.shotsOnTarget += 1; break;
      case EventKind.KeyPass:          x.keyPasses += 1; break;
      case EventKind.Dribble:          x.dribbles += 1; break;
      case EventKind.Tackle:           x.tackles += 1; break;
      case EventKind.Interception:     x.interceptions += 1; break;
      case EventKind.Clearance:        x.clearances += 1; break;
      case EventKind.Recovery:         x.recoveries += 1; break;
    }
  }

  /* -- שלב ה׳: דקות, ספיגות וקלין-שיט ------------------------------- */
  for (const [playerId, window] of onPitch) {
    const p = touch(playerId, R.get(playerId)?.teamId ?? '');
    p.minutes = Math.max(0, Math.round(window.to - window.from));
    p.played = p.minutes > 0;

    const other = teams.find((t) => t !== p.teamId);
    const conceded = other ? goalsByTeam.get(other) ?? [] : [];
    // ★ ספיגות נספרות רק בזמן שהשחקן היה על המגרש. מגן שיצא בדקה 60
    //   בתוצאה 0:0 לא "אשם" בשער של דקה 85 — וגם לא מפסיד את הקלין-שיט.
    p.goalsConceded = conceded.filter((m) => m > window.from && m <= window.to).length;
    p.cleanSheet = p.played && p.goalsConceded === 0;
  }

  return { performances: perf, outcomes, extended: ext };
}

/* =================================================================== */
/* עזרים                                                               */
/* =================================================================== */

/** דקה מוחלטת ביחס לתחילת המשחק, כולל תוספת זמן. */
export function absoluteMinute(e: MatchEvent): number {
  return e.minute + (e.stoppage ?? 0);
}

function finalWhistle(events: readonly MatchEvent[]): number {
  const ft = [...events].reverse().find((e) => e.kind === EventKind.FullTime);
  if (ft) return absoluteMinute(ft);
  const last = events.reduce((m, e) => Math.max(m, absoluteMinute(e)), 0);
  return Math.max(REGULATION, last);
}

/**
 * מיזוג הקרנות של כמה משחקים למחזור אחד.
 *
 * שחקן ששיחק שני משחקים במחזור (השלמת משחק דחוי) — הנתונים נצברים,
 * בדיוק כמו ב-`buildInputs` הקיים. קבוצה עם שני משחקים מקבלת את
 * התוצאה הטובה יותר ואת סכום השערים — אותה סמנטיקה, מקור אחד.
 */
export function mergeProjections(parts: readonly Projection[]): Projection {
  const performances = new Map<string, PlayerPerformance>();
  const outcomes = new Map<string, TeamOutcome>();
  const extended = new Map<string, ExtendedStats>();
  const rank = { W: 2, D: 1, L: 0 } as const;

  for (const part of parts) {
    for (const [id, p] of part.performances) {
      const cur = performances.get(id);
      if (!cur) { performances.set(id, { ...p }); continue; }
      cur.minutes += p.minutes;
      cur.goals += p.goals;
      cur.assists += p.assists;
      cur.ownGoals += p.ownGoals;
      cur.yellowCards += p.yellowCards;
      cur.redCards += p.redCards;
      cur.saves += p.saves;
      cur.penaltiesSaved += p.penaltiesSaved;
      cur.penaltiesMissed += p.penaltiesMissed;
      cur.goalsConceded += p.goalsConceded;
      cur.played = cur.played || p.played;
      // קלין-שיט במחזור עם שני משחקים = לא ספג בכלל.
      cur.cleanSheet = cur.played && cur.goalsConceded === 0;
    }
    for (const [id, o] of part.outcomes) {
      const cur = outcomes.get(id);
      if (!cur) { outcomes.set(id, { ...o }); continue; }
      outcomes.set(id, {
        teamId: id,
        result: rank[o.result] > rank[cur.result] ? o.result : cur.result,
        goalsFor: cur.goalsFor + o.goalsFor,
        goalsAgainst: cur.goalsAgainst + o.goalsAgainst,
      });
    }
    for (const [id, x] of part.extended) {
      const cur = extended.get(id);
      if (!cur) { extended.set(id, { ...x }); continue; }
      cur.shots += x.shots;
      cur.shotsOnTarget += x.shotsOnTarget;
      cur.keyPasses += x.keyPasses;
      cur.dribbles += x.dribbles;
      cur.tackles += x.tackles;
      cur.interceptions += x.interceptions;
      cur.clearances += x.clearances;
      cur.recoveries += x.recoveries;
      cur.penaltiesScored += x.penaltiesScored;
      cur.lastGoalMinute = Math.max(cur.lastGoalMinute ?? -1, x.lastGoalMinute ?? -1) || null;
      cur.cameOffBench = cur.cameOffBench || x.cameOffBench;
    }
  }

  return { performances, outcomes, extended };
}
