/**
 * lib/roundPhase.ts — באיזה שלב המחזור, ומה עושים עכשיו.
 *
 * ★ למה זה קיים: הסטטוס היה תג אחד ("נעול") ושעון. המשתמש שאל חמש שאלות
 *   והמסך ענה על אחת: באיזה שלב אנחנו, מה אני עושה עכשיו, מה הניקוד שלי
 *   עכשיו, מה היה בשבוע שעבר, ומתי זה מתחיל/נפתח הבא. הפונקציה הזו עונה על
 *   כולן, ממקור אחד, בלי להמציא זמן: הכל מגיע מבחוץ, כולל השעון.
 *
 * ★ חמישה שלבים, תמיד אותם חמישה, כדי שהמשתמש ילמד את המסלול:
 *     פתוח להגשה → נעול → בעיצומו → ניקוד → פורסם
 */
export type RoundStep = 'open' | 'locked' | 'live' | 'scoring' | 'published';
export const STEPS: readonly { id: RoundStep; label: string }[] = [
  { id: 'open', label: 'פתוח להגשה' },
  { id: 'locked', label: 'נעול' },
  { id: 'live', label: 'בעיצומו' },
  { id: 'scoring', label: 'ניקוד' },
  { id: 'published', label: 'פורסם' },
];

export interface RoundInput {
  number: number;
  /** סטטוס הלובי: Open / Locked / Published (כמו `Gameweek.status`). */
  submissionOpen: boolean;
  published: boolean;
  nowMs: number;
  deadlineAt: string;
  firstKickoffAt?: string;
  hasSubmitted: boolean;
  fixturesTotal?: number;
  fixturesFinal?: number;
  fixturesLive?: number;
  /** ניקוד שלי כרגע (חי או סופי), אם יש הגשה ויש נתונים. */
  myPoints?: number;
  myRank?: number;
  /** המחזור הקודם שהסתיים, מההיסטוריה של המשתמש. */
  previous?: { number: number; points: number | null; rank: number | null } | null;
}

export interface RoundBrief {
  step: RoundStep;
  stepIndex: number;
  headline: string;
  /** משפט אחד: מה עושים עכשיו. */
  doNow: string;
  /** שורות עובדה: שעון/ניקוד/הבא. כל אחת עם תווית. */
  facts: { label: string; value: string }[];
  /** האם הניקוד שמוצג הוא זמני. */
  pointsAreLive: boolean;
}

const TZ = 'Asia/Jerusalem';
const fmt = (ms: number) =>
  new Intl.DateTimeFormat('he-IL', {
    timeZone: TZ, weekday: 'long', day: 'numeric', month: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(ms));

function stepOf(i: RoundInput): RoundStep {
  if (i.published) return 'published';
  if (i.submissionOpen) return 'open';
  const total = i.fixturesTotal ?? 0;
  const done = i.fixturesFinal ?? 0;
  if (total > 0 && done >= total) return 'scoring';
  const started = (i.fixturesLive ?? 0) > 0 || done > 0 ||
    (i.firstKickoffAt ? i.nowMs >= Date.parse(i.firstKickoffAt) : false);
  return started ? 'live' : 'locked';
}

export function describeRound(i: RoundInput): RoundBrief {
  const step = stepOf(i);
  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const facts: RoundBrief['facts'] = [];
  const total = i.fixturesTotal ?? 0;
  const done = i.fixturesFinal ?? 0;
  let headline = '';
  let doNow = '';
  let pointsAreLive = false;

  switch (step) {
    case 'open':
      headline = `מחזור ${i.number} פתוח להגשה`;
      doNow = i.hasSubmitted
        ? 'ההרכב הוגש ונעול. נשאר לחכות לשריקה.'
        : 'בנו הרכב והגישו לפני הנעילה.';
      facts.push({ label: 'ההגשות נסגרות', value: fmt(Date.parse(i.deadlineAt)) });
      break;
    case 'locked':
      headline = `מחזור ${i.number} נעול`;
      doNow = i.hasSubmitted ? 'ההרכב שלכם נעול. ממתינים לשריקה הראשונה.' : 'לא הגשתם הרכב למחזור הזה. המחזור הבא יפתח אוטומטית.';
      if (i.firstKickoffAt) facts.push({ label: 'המחזור מתחיל', value: fmt(Date.parse(i.firstKickoffAt)) });
      break;
    case 'live':
      headline = `מחזור ${i.number} בעיצומו`;
      doNow = i.hasSubmitted ? 'הניקוד מתעדכן תוך כדי המשחקים.' : 'לא הגשתם הרכב למחזור הזה. אפשר לעקוב אחרי הדירוג.';
      if (total > 0) facts.push({ label: 'משחקים שהסתיימו', value: `${done} מתוך ${total}` });
      pointsAreLive = i.myPoints !== undefined;
      break;
    case 'scoring':
      headline = `מחזור ${i.number}: כל המשחקים הסתיימו`;
      doNow = 'הניקוד הסופי מתפרסם אוטומטית אחרי שהנתונים מתייצבים, בדרך כלל תוך פחות משעה.';
      if (total > 0) facts.push({ label: 'משחקים שהסתיימו', value: `${total} מתוך ${total}` });
      pointsAreLive = i.myPoints !== undefined;
      break;
    case 'published':
      headline = `מחזור ${i.number} הסתיים`;
      doNow = 'הניקוד סופי. המחזור הבא ייפתח אוטומטית כשהלוח שלו יתפרסם, וההרכב שלו מתחיל נקי.';
      break;
  }

  if (i.myPoints !== undefined) {
    facts.push({
      label: pointsAreLive ? 'הניקוד שלי כרגע (זמני)' : 'הניקוד שלי',
      value: i.myRank ? `${i.myPoints} · מקום ${i.myRank}` : String(i.myPoints),
    });
  } else if (step === 'live' || step === 'scoring') {
    facts.push({ label: 'הניקוד שלי', value: i.hasSubmitted ? 'ממתין לנתונים' : 'אין הרכב' });
  }

  if (i.previous && i.previous.number !== i.number) {
    facts.push({
      label: `מחזור ${i.previous.number}`,
      value: i.previous.points === null ? 'לא נוקד'
        : i.previous.rank ? `${i.previous.points} · מקום ${i.previous.rank}` : String(i.previous.points),
    });
  }

  return { step, stepIndex, headline, doNow, facts, pointsAreLive };
}
