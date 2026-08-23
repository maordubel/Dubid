/**
 * events/bus.ts — שיגור הלוג לכל מצבי המשחק במקביל.
 *
 * ★ מקור אחד, כמה תשובות
 *
 * זו הנקודה שבה "מה קרה במגרש" הופך ל"כמה נקודות יש לך".
 * הלוג לא יודע מה זה דוביד 5. דוביד 5 לא יודע מה זה לוג. ה-bus
 * מחזיק את שניהם ולא מחזיק דעה משלו:
 *
 *      ┌──────────────── לוגי המחזור ────────────────┐
 *      │  משחק 1   משחק 2   משחק 3   …   משחק 7      │
 *      └───────────────────┬─────────────────────────┘
 *                          │  project + merge  (פעם אחת)
 *                          ▼
 *              PlayerPerformance / TeamOutcome
 *                          │
 *            ┌─────────────┴─────────────┐
 *            ▼                           ▼
 *      ┌───────────┐               ┌───────────┐
 *      │  דוביד 5  │               │  דוביד 11 │   ← כל מצב מפרש בעצמו
 *      │  RuleSet  │               │  RuleSet  │      תקציב, גודל הרכב,
 *      └───────────┘               └───────────┘      מכפיל קפטן, דירוג
 *
 * ההקרנה רצה **פעם אחת** לכל המצבים. אם היא הייתה רצה פעמיים, שני
 * המצבים היו יכולים להיפרד — וזה בדיוק הבאג שהארכיטקטורה הזו מונעת.
 */
import { scoreLineup } from '../scoring/engine.ts';
import { DUBID_5X5, DUBID_5X5_BUDGET, IL_PREMIER, type RuleSet } from '../scoring/rules.ts';
import type { Lineup, LineupScore } from '../scoring/types.ts';
import { mergeProjections, project, type Projection, type Roster } from './project.ts';
import { fingerprint } from './log.ts';
import type { MatchLog } from './types.ts';

/** מזהי מצבי המשחק. אותם ערכים שכבר בשימוש ב-`LineupEntry.mode`. */
export type ModeId = 'five' | 'full';

/**
 * הגדרת מצב משחק. שימו לב מה *אין* כאן: פונקציית ניקוד.
 * מצב משחק הוא צירוף של חוקים ואילוצים, לא מנוע נפרד.
 */
export interface GameMode {
  id: ModeId;
  /** מה המשתמש רואה. אין כאן מונחים טכניים כמו RuleSet. */
  labelHe: string;
  taglineHe: string;
  rules: RuleSet;
  /** תקציב במיליוני יורו. null = אין אילוץ תקציב במצב הזה. */
  budget: number | null;
}

export const MODES: Record<ModeId, GameMode> = {
  five: {
    id: 'five',
    labelHe: 'דוביד 5',
    taglineHe: 'בחרו 5. נצחו את כולם.',
    rules: DUBID_5X5,
    budget: DUBID_5X5_BUDGET,
  },
  full: {
    id: 'full',
    labelHe: 'דוביד 11',
    taglineHe: 'בנו הרכב. שלטו בליגה.',
    rules: IL_PREMIER,
    budget: null,
  },
};

export const MODE_LIST: readonly GameMode[] = [MODES.five, MODES.full];

/* =================================================================== */

export interface ScoredEntry {
  entryId: string;
  userId: string;
  displayName: string;
  /** חותמת ההגשה הרשמית — שובר השוויון האחרון. ISO-8601. */
  submittedAt: string;
  score: LineupScore;
}

export interface ModeResult {
  mode: GameMode;
  entries: ScoredEntry[];
  /** הרכבים שנפסלו בוולידציה, עם הסיבה. לא נעלמים בשקט. */
  rejected: Array<{ entryId: string; error: string }>;
}

export interface BroadcastInput {
  entryId: string;
  userId: string;
  displayName: string;
  submittedAt: string;
  mode: ModeId;
  lineup: Lineup;
}

export interface BroadcastResult {
  gameweekId: string;
  /** טביעת אצבע של כל לוגי המחזור. משתנה רק אם הנתונים השתנו. */
  fingerprint: string;
  projection: Projection;
  byMode: Record<ModeId, ModeResult>;
}

/**
 * מריץ מחזור שלם: מהלוגים הגולמיים ועד ציון לכל הרכב, בכל מצב.
 *
 * `logs` הם כל המשחקים של המחזור. `entries` הם כל ההגשות, מכל
 * המצבים, מעורבבות — הפונקציה ממיינת אותן לפי `mode`.
 */
export function broadcast(
  gameweekId: string,
  logs: readonly MatchLog[],
  roster: Roster,
  entries: readonly BroadcastInput[],
): BroadcastResult {
  // ★ הקרנה אחת לכל המצבים. זו כל הנקודה.
  const projection = mergeProjections(logs.map((l) => project(l, roster)));

  const byMode = {} as Record<ModeId, ModeResult>;
  for (const mode of MODE_LIST) {
    const mine = entries.filter((e) => e.mode === mode.id);
    const scored: ScoredEntry[] = [];
    const rejected: ModeResult['rejected'] = [];

    for (const e of mine) {
      try {
        scored.push({
          entryId: e.entryId,
          userId: e.userId,
          displayName: e.displayName,
          submittedAt: e.submittedAt,
          score: scoreLineup(
            e.lineup,
            projection.performances,
            projection.outcomes,
            mode.rules,
            // ההרכב כבר עבר ולידציה בהגשה. כאן מדובר בהיסטוריה —
            // שינוי חוקים בדיעבד לא אמור למחוק הגשה חוקית של משתמש.
            { validate: false },
          ),
        });
      } catch (err) {
        rejected.push({ entryId: e.entryId, error: (err as Error).message });
      }
    }

    byMode[mode.id] = { mode, entries: scored, rejected };
  }

  return {
    gameweekId,
    fingerprint: combinedFingerprint(logs),
    projection,
    byMode,
  };
}

/** טביעת אצבע יציבה של המחזור כולו, ללא תלות בסדר שבו הגיעו הלוגים. */
export function combinedFingerprint(logs: readonly MatchLog[]): string {
  return [...logs]
    .map((l) => `${l.fixtureId}:${fingerprint(l)}`)
    .sort()
    .join('|');
}
