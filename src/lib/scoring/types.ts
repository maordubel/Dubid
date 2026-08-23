/**
 * scoring/types.ts — הטיפוסים של מנוע הניקוד.
 *
 * המנוע חי גם בדפדפן (תצוגה מקדימה חיה של הניקוד) וגם ב-Supabase Edge
 * Function (החישוב הרשמי). אותו קוד בדיוק בשני המקומות — כך אי אפשר
 * שהמספר שהמשתמש רואה בזמן אמת יהיה שונה מהמספר שנשמר ב-DB.
 */

export type Position = 'GK' | 'DEF' | 'MID' | 'FWD';
export type MatchResult = 'W' | 'D' | 'L';

/** קודי סיבה. ה-UI מתרגם אותם — אין מחרוזות תצוגה במנוע. */
export const Reason = {
  Minutes: 'minutes',
  Goal: 'goal',
  Assist: 'assist',
  CleanSheet: 'clean_sheet',
  Saves: 'saves',
  PenaltySaved: 'penalty_saved',
  PenaltyMissed: 'penalty_missed',
  GoalsConceded: 'goals_conceded',
  OwnGoal: 'own_goal',
  Yellow: 'yellow_card',
  Red: 'red_card',
  ResultBonus: 'result_bonus',
  VirtualGoal: 'virtual_goal',
  /** בונוס בחירה נדירה שהצליחה. מחושב ב-ranking.ts, לא ב-engine.ts. */
  Differential: 'differential',
  CaptainMultiplier: 'captain_multiplier',
  CaptainImmunity: 'captain_immunity',
  CaptainTransferred: 'captain_transferred',
} as const;
export type ReasonCode = (typeof Reason)[keyof typeof Reason];

/** ביצועי שחקן במחזור (מצטבר על פני כל משחקיו במחזור). */
export interface PlayerPerformance {
  playerId: string;
  teamId: string;
  position: Position;
  minutes: number;
  goals: number;
  assists: number;
  ownGoals: number;
  yellowCards: number;
  redCards: number;
  saves: number;
  penaltiesSaved: number;
  penaltiesMissed: number;
  goalsConceded: number;
  cleanSheet: boolean;
  played: boolean;
}

/** תוצאת הקבוצה האמיתית במחזור. */
export interface TeamOutcome {
  teamId: string;
  result: MatchResult;
  goalsFor: number;
  goalsAgainst: number;
}

export interface LineupSlot {
  slotNo: number;
  playerId: string;
  /** snapshot מרגע ההגשה — הסגל משתנה, ההרכב לא. */
  teamId: string;
  position: Position;
  isCaptain?: boolean;
  isVice?: boolean;
  isBench?: boolean;
}

export interface Lineup {
  lineupId: string;
  userId: string;
  gameweekId: string;
  formation: string;
  slots: LineupSlot[];
}

export interface ScoreLine {
  reason: ReasonCode;
  points: number;
  count?: number;
  playerId?: string;
  teamId?: string;
  meta?: Record<string, unknown>;
}

export interface PlayerScore {
  playerId: string;
  teamId: string;
  position: Position;
  isCaptain: boolean;
  lines: ScoreLine[];
  subtotal: number;
}

export interface LineupScore {
  lineupId: string;
  gameweekId: string;
  rulesetVersion: number;
  players: PlayerScore[];
  bonusLines: ScoreLine[];
  /** סכימת פעולות אישיות בלבד */
  personalPoints: number;
  /** בונוס תוצאה קבוצתית */
  resultPoints: number;
  /** התוספת שנבעה מהקפטן הדובידי */
  captainPoints: number;
  /** שערי הרכב וירטואליים */
  virtualPoints: number;
  /**
   * בונוס דיפרנציאל. אופציונלי כי הוא נוסף בשלב הדירוג, אחרי שידועות
   * כל ההגשות — `scoreLineup` לבדו לא יכול לדעת אחוזי בחירה.
   */
  differentialPoints?: number;
  totalPoints: number;
}

/** מזהי שגיאות ולידציה. ה-UI מתרגם. */
export const ErrorCode = {
  LineupSize: 'lineup_size',
  DuplicateTeam: 'duplicate_team',
  DuplicatePlayer: 'duplicate_player',
  FormationInvalid: 'formation_invalid',
  FormationMismatch: 'formation_mismatch',
  CaptainMissing: 'captain_missing',
  CaptainDuplicate: 'captain_duplicate',
  NoGoalkeeper: 'no_goalkeeper',
  NotEnoughTeams: 'not_enough_teams',
} as const;
export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ValidationIssue {
  code: ErrorCodeValue;
  params: Record<string, string | number>;
}
