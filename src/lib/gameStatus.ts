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

export const STATUS_LABEL: Record<GameStatus, string> = {
  not_started: 'טרם התחיל',
  draft: 'טיוטה',
  ready: 'מוכן להגשה',
  locked: 'ננעל',
  finished: 'הסתיים',
};

/** הפעולה הבאה שהמשתמש אמור לעשות, לפי המצב הנוכחי. */
export const STATUS_ACTION: Record<GameStatus, string> = {
  not_started: 'בניית ההרכב',
  draft: 'המשך בנייה',
  ready: 'הגשת ההרכב',
  locked: 'המחזור בעיצומו',
  finished: 'צפייה בניקוד',
};

/** הסבר קצר, לתת-כותרת מתחת לתג הסטטוס. */
export const STATUS_HINT: Record<GameStatus, string> = {
  not_started: 'עדיין לא בחרתם אף שחקן',
  draft: 'ההרכב נשמר אוטומטית, אפשר להמשיך בכל רגע',
  ready: 'ההרכב מלא ותקין — מוכן להגשה רשמית',
  locked: 'ההרכב הוגש ונעול. התוצאות יתעדכנו בסיום המחזור',
  finished: 'המחזור הסתיים — הניקוד שלכם מוכן',
};
