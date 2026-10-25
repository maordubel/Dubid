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
import { tr, activeLocale, type DictKey } from './i18n/dict.ts';
import { INTL_TAG } from './i18n/lazy.ts';
import { leagueTimezone } from './leagueTz.ts';

export type RoundStep = 'open' | 'locked' | 'live' | 'scoring' | 'published';
export const STEPS: readonly { id: RoundStep; label: string }[] =
  (['open', 'locked', 'live', 'scoring', 'published'] as const).map((id) => ({
    id,
    get label() { return tr(`shell.step.${id}` as DictKey); },
  }));

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

const fmt = (ms: number) =>
  new Intl.DateTimeFormat(INTL_TAG[activeLocale()], {
    timeZone: leagueTimezone(), weekday: 'long', day: 'numeric', month: 'numeric',
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
      headline = tr('shell.round.openH', { n: i.number });
      doNow = i.hasSubmitted
        ? tr('shell.round.openSub')
        : tr('shell.round.openTodo');
      facts.push({ label: tr('shell.round.closes'), value: fmt(Date.parse(i.deadlineAt)) });
      break;
    case 'locked':
      headline = tr('shell.round.lockedH', { n: i.number });
      doNow = i.hasSubmitted ? tr('shell.round.lockedSub') : tr('shell.round.lockedNone');
      if (i.firstKickoffAt) facts.push({ label: tr('shell.round.starts'), value: fmt(Date.parse(i.firstKickoffAt)) });
      break;
    case 'live':
      headline = tr('shell.round.liveH', { n: i.number });
      doNow = i.hasSubmitted ? tr('shell.round.liveSub') : tr('shell.round.liveNone');
      if (total > 0) facts.push({ label: tr('shell.round.finished'), value: tr('shell.round.ofTotal', { done, total }) });
      pointsAreLive = i.myPoints !== undefined;
      break;
    case 'scoring':
      headline = tr('shell.round.scoringH', { n: i.number });
      doNow = tr('shell.round.scoringSub');
      if (total > 0) facts.push({ label: tr('shell.round.finished'), value: tr('shell.round.ofTotal', { done: total, total }) });
      pointsAreLive = i.myPoints !== undefined;
      break;
    case 'published':
      headline = tr('shell.round.doneH', { n: i.number });
      doNow = tr('shell.round.doneSub');
      break;
  }

  if (i.myPoints !== undefined) {
    facts.push({
      label: pointsAreLive ? tr('shell.round.myPtsLive') : tr('shell.round.myPts'),
      value: i.myRank ? tr('shell.round.ptsRank', { pts: i.myPoints, rank: i.myRank }) : String(i.myPoints),
    });
  } else if (step === 'live' || step === 'scoring') {
    facts.push({ label: tr('shell.round.myPts'), value: i.hasSubmitted ? tr('shell.round.awaiting') : tr('shell.round.noLineup') });
  }

  if (i.previous && i.previous.number !== i.number) {
    facts.push({
      label: tr('shell.round.prev', { n: i.previous.number }),
      value: i.previous.points === null ? tr('shell.round.notScored')
        : i.previous.rank ? tr('shell.round.ptsRank', { pts: i.previous.points, rank: i.previous.rank }) : String(i.previous.points),
    });
  }

  return { step, stepIndex, headline, doNow, facts, pointsAreLive };
}
