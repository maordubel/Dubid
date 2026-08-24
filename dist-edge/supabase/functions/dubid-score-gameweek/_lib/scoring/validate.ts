/**
 * ⚠ נוצר אוטומטית — אל תערכו כאן.
 *
 * הועתק מ-src/lib/ על ידי scripts/sync-edge-shared.mjs.
 * כל שינוי כאן יימחק בפריסה הבאה. ערכו את המקור.
 */
/**
 * scoring/validate.ts — ולידציית הרכב.
 *
 * ★ "שחקן אחד מכל קבוצה" נאכף בשלוש שכבות, ואף אחת מהן לא סומכת על השנייה:
 *     1. UI  — teamsUsed() נועל קבוצות תפוסות במסך הבחירה
 *     2. כאן — לפני כל כתיבה, עם קודי שגיאה מתורגמים
 *     3. DB  — UNIQUE (lineup_id, team_id)
 */
import { ErrorCode, type Lineup, type Position, type ValidationIssue } from './types.ts';
import type { RuleSet } from './rules.ts';

export const MESSAGES: Record<string, { he: string; en: string }> = {
  [ErrorCode.LineupSize]: {
    he: 'ההרכב חייב לכלול בדיוק {expected} שחקנים (יש {actual}).',
    en: 'Lineup must contain exactly {expected} players (got {actual}).',
  },
  [ErrorCode.DuplicateTeam]: {
    he: 'מותר עד {max} שחקנים מכל קבוצה. יש חריגה ב: {teams}.',
    en: 'At most {max} player(s) per team. Violating: {teams}.',
  },
  [ErrorCode.DuplicatePlayer]: {
    he: 'אותו שחקן נבחר יותר מפעם אחת.',
    en: 'The same player was selected more than once.',
  },
  [ErrorCode.FormationInvalid]: {
    he: 'המערך {formation} אינו נתמך.',
    en: 'Formation {formation} is not supported.',
  },
  [ErrorCode.FormationMismatch]: {
    he: 'חלוקת העמדות אינה תואמת ל־{formation}.',
    en: 'Positions do not match formation {formation}.',
  },
  [ErrorCode.CaptainMissing]: { he: 'יש לבחור קפטן.', en: 'A captain must be selected.' },
  [ErrorCode.CaptainDuplicate]: {
    he: 'אפשר לבחור קפטן אחד בלבד.',
    en: 'Only one captain may be selected.',
  },
  [ErrorCode.NoGoalkeeper]: {
    he: 'ההרכב חייב לכלול שוער.',
    en: 'Lineup must include a goalkeeper.',
  },
  [ErrorCode.NotEnoughTeams]: {
    he: 'צריך {required} קבוצות כדי לבנות הרכב של {size} שחקנים (יש {available}). חסרות {missing}.',
    en: 'Need {required} teams for a {size}-player lineup (have {available}). Missing {missing}.',
  },
};

/**
 * ★ הבדיקה שחוסמת מראש: אי אפשר להרכיב 11 שחקנים מ-11 קבוצות שונות
 * כשבליגה יש פחות מ-11 קבוצות. זו אריתמטיקה, לא העדפה.
 */
export function checkLeagueCapacity(
  teamsAvailable: number,
  rules: RuleSet,
): ValidationIssue | null {
  const required = rules.constraints.lineupSize * rules.constraints.maxPlayersPerTeam;
  if (teamsAvailable >= required) return null;
  return {
    code: ErrorCode.NotEnoughTeams,
    params: {
      required,
      size: rules.constraints.lineupSize,
      available: teamsAvailable,
      missing: required - teamsAvailable,
    },
  };
}

export function formatIssue(issue: ValidationIssue, locale: 'he' | 'en' = 'he'): string {
  const tpl = MESSAGES[issue.code]?.[locale] ?? issue.code;
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String(issue.params[k] ?? ''));
}

export class LineupInvalidError extends Error {
  issues: ValidationIssue[];
  constructor(issues: ValidationIssue[], locale: 'he' | 'en' = 'he') {
    super(issues.map((i) => formatIssue(i, locale)).join(' | '));
    this.name = 'LineupInvalidError';
    this.issues = issues;
  }
}

export function parseFormation(formation: string): Record<Position, number> {
  const parts = formation.split('-').map(Number);
  if (parts.some(Number.isNaN)) throw new Error(`bad formation: ${formation}`);
  let def: number, mid: number, fwd: number;
  if (parts.length === 3) [def, mid, fwd] = parts;
  else if (parts.length === 4) {
    const [d, m1, m2, f] = parts;
    def = d; mid = m1 + m2; fwd = f;
  } else throw new Error(`bad formation: ${formation}`);
  return { GK: 1, DEF: def, MID: mid, FWD: fwd };
}

export function starters(lineup: Lineup) {
  return lineup.slots.filter((s) => !s.isBench);
}

/**
 * משבצות פותחות שכבר אוישו.
 * ההפרדה חשובה: מבנה המערך נבדק על כל המשבצות (הן נוצרו מהמערך),
 * אבל גודל ההרכב, כפילויות והקפטן נבדקים רק על מה שבאמת נבחר —
 * אחרת הרכב ריק היה "עובר" את בדיקת הגודל, ו-11 משבצות ריקות היו
 * נספרות כ-11 שחקנים מאותה "קבוצה" ריקה.
 */
export function filledStarters(lineup: Lineup) {
  return starters(lineup).filter((s) => s.playerId && s.teamId);
}

/** מחזיר רשימת בעיות. ריקה = ההרכב תקין. */
export function validateLineup(lineup: Lineup, rules: RuleSet): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const structure = starters(lineup);
  const xi = filledStarters(lineup);
  const c = rules.constraints;

  if (xi.length !== c.lineupSize) {
    issues.push({
      code: ErrorCode.LineupSize,
      params: { expected: c.lineupSize, actual: xi.length },
    });
  }

  // ★ האילוץ המרכזי
  const perTeam = new Map<string, number>();
  for (const s of xi) perTeam.set(s.teamId, (perTeam.get(s.teamId) ?? 0) + 1);
  const over = [...perTeam.entries()]
    .filter(([, n]) => n > c.maxPlayersPerTeam)
    .map(([t]) => t);
  if (over.length) {
    issues.push({
      code: ErrorCode.DuplicateTeam,
      params: { max: c.maxPlayersPerTeam, teams: over.join(', ') },
    });
  }

  const perPlayer = new Set<string>();
  for (const s of xi) {
    if (perPlayer.has(s.playerId)) {
      issues.push({ code: ErrorCode.DuplicatePlayer, params: {} });
      break;
    }
    perPlayer.add(s.playerId);
  }

  if (!c.formationAllowed.includes(lineup.formation)) {
    issues.push({ code: ErrorCode.FormationInvalid, params: { formation: lineup.formation } });
  } else {
    // מבנה המערך נבדק על המשבצות, לא על מה שאויש
    const want = parseFormation(lineup.formation);
    const got: Record<string, number> = {};
    for (const s of structure) got[s.position] = (got[s.position] ?? 0) + 1;
    const mismatch = (Object.keys(want) as Position[]).some((p) => (got[p] ?? 0) !== want[p]);
    if (mismatch) {
      issues.push({ code: ErrorCode.FormationMismatch, params: { formation: lineup.formation } });
    }
  }

  if (!structure.some((s) => s.position === 'GK')) {
    issues.push({ code: ErrorCode.NoGoalkeeper, params: {} });
  }

  const captains = xi.filter((s) => s.isCaptain);
  if (c.requireCaptain && captains.length === 0) {
    issues.push({ code: ErrorCode.CaptainMissing, params: {} });
  }
  if (captains.length > 1) {
    issues.push({ code: ErrorCode.CaptainDuplicate, params: {} });
  }

  return issues;
}

export function assertValidLineup(lineup: Lineup, rules: RuleSet, locale: 'he' | 'en' = 'he'): void {
  const issues = validateLineup(lineup, rules);
  if (issues.length) throw new LineupInvalidError(issues, locale);
}

/* ------------------------------------------------------------------ */
/* עזרים ל-UI — זה מה שמונע מהמשתמש להיתקל בשגיאה מלכתחילה             */
/* ------------------------------------------------------------------ */

/** כמה שחקנים כבר נבחרו מכל קבוצה. */
export function teamsUsed(lineup: Lineup): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of filledStarters(lineup)) m.set(s.teamId, (m.get(s.teamId) ?? 0) + 1);
  return m;
}

/** האם מותר עדיין לבחור שחקן מהקבוצה הזו. */
export function isTeamAvailable(lineup: Lineup, teamId: string, rules: RuleSet): boolean {
  return (teamsUsed(lineup).get(teamId) ?? 0) < rules.constraints.maxPlayersPerTeam;
}

/** מפת כיסוי לתצוגה: אילו קבוצות אוישו ואילו עוד פנויות. */
export interface TeamCoverage {
  teamId: string;
  used: number;
  max: number;
  filled: boolean;
}

export function teamCoverage(
  lineup: Lineup,
  allTeamIds: string[],
  rules: RuleSet,
): TeamCoverage[] {
  const used = teamsUsed(lineup);
  const max = rules.constraints.maxPlayersPerTeam;
  return allTeamIds.map((teamId) => {
    const n = used.get(teamId) ?? 0;
    return { teamId, used: n, max, filled: n >= max };
  });
}


/* ------------------------------------------------------------------ */
/* חיווי מיידי ל-UI                                                    */
/* ------------------------------------------------------------------ */

export interface TeamBlock {
  blocked: boolean;
  /** מזהה השחקן שכבר תופס את הקבוצה — ה-UI מציע להחליף אותו */
  occupiedBy?: string;
  reasonHe?: string;
  reasonEn?: string;
}

/**
 * למה קבוצה חסומה, ומי חוסם אותה.
 * מחזיר גם את מזהה השחקן התופס, כדי שה-UI יוכל להציע "החלף את X"
 * במקום רק להאפיר ולהשאיר את המשתמש לנחש.
 */
export function teamBlock(lineup: Lineup, teamId: string, rules: RuleSet): TeamBlock {
  const occupants = filledStarters(lineup).filter((s) => s.teamId === teamId);
  if (occupants.length < rules.constraints.maxPlayersPerTeam) return { blocked: false };
  return {
    blocked: true,
    occupiedBy: occupants[0]?.playerId,
    reasonHe: 'כבר יש לך שחקן מהקבוצה הזו',
    reasonEn: 'You already have a player from this team',
  };
}
