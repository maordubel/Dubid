/**
 * lib/gameStatus.ts — מכונת המצבים של הרכב יחיד (מצב אחד, מחזור אחד).
 *
 *   DRAFT  →  SUBMIT  →  LOCKED LINEUP  →  SCORING
 *
 * "טיוטה" זו העריכה החופשית לפני הגשה — אפשר לשחק איתה כמה שרוצים.
 * ברגע שהוגשה (`store.saveEntry`), היא *לא* אותו אובייקט שממשיכים
 * לערוך: זה סנאפשוט נפרד (`LineupEntry`) שהופך רשמי למחזור. המסך
 * לא מציג יותר את ה-SquadPicker אלא תצוגת "הרכב נעול" — זו בדיוק
 * המשמעות של השכבה הזו: אחרי הגשה, אין יותר "טיוטה שרירה".
 */
import { type DictKey } from './i18n/dict.ts';
import { lazyRec } from './i18n/lazy.ts';

export type GameStatus = 'not_started' | 'draft' | 'ready' | 'locked' | 'finished';

export function computeGameStatus(params: {
  hasSubmission: boolean;
  resultsPublished: boolean;
  filled: number;
  isComplete: boolean;
}): GameStatus {
  const { hasSubmission, resultsPublished, filled, isComplete } = params;
  if (hasSubmission) return resultsPublished ? 'finished' : 'locked';
  if (filled === 0) return 'not_started';
  return isComplete ? 'ready' : 'draft';
}

const IDS = ['not_started', 'draft', 'ready', 'locked', 'finished'] as const;
const cap = (id: GameStatus) => id === 'not_started' ? 'NotStarted' : id[0].toUpperCase() + id.slice(1);

export const STATUS_LABEL: Record<GameStatus, string> = lazyRec(IDS, (id) => `shell.gs.${id === 'not_started' ? 'notStarted' : id}` as DictKey);

/** הפעולה הבאה שהמשתמש אמור לעשות, לפי המצב הנוכחי. */
export const STATUS_ACTION: Record<GameStatus, string> = lazyRec(IDS, (id) => `shell.gs.act${cap(id)}` as DictKey);

/** הסבר קצר, לתת-כותרת מתחת לתג הסטטוס. */
export const STATUS_HINT: Record<GameStatus, string> = lazyRec(IDS, (id) => `shell.gs.hint${cap(id)}` as DictKey);
