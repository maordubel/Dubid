/**
 * events/log.ts — הלוג עצמו: הוספה, תיקון, וקריאה דטרמיניסטית.
 *
 * שלושה כללים שלא נשברים:
 *
 *  1. **Append-only.** `append` מחזיר לוג חדש. אף פונקציה כאן לא
 *     משנה מערך קיים ולא מוחקת אירוע.
 *  2. **סדר לפי seq, לא לפי שעון.** `Date.now()` לא משתתף בשום
 *     החלטה. אותם אירועים באותו סדר = אותה תוצאה, תמיד.
 *  3. **תיקון הוא אירוע.** ביטול שער שנפסל בוואר לא מוחק את השער —
 *     הוא מוסיף שורת Correction שמצביעה עליו. ההיסטוריה נשמרת.
 */
import {
  EventKind,
  PLAYER_EVENTS,
  type DraftEvent,
  type MatchEvent,
  type MatchLog,
} from './types.ts';

/* =================================================================== */
/* יצירה והוספה                                                        */
/* =================================================================== */

export function createLog(init: {
  fixtureId: string;
  gameweekId: string;
  homeTeamId: string;
  awayTeamId: string;
  status?: MatchLog['status'];
}): MatchLog {
  return {
    fixtureId: init.fixtureId,
    gameweekId: init.gameweekId,
    homeTeamId: init.homeTeamId,
    awayTeamId: init.awayTeamId,
    status: init.status ?? 'scheduled',
    events: Object.freeze([]),
    nextSeq: 1,
  };
}

export class EventLogError extends Error {
  // שדה מפורש ולא parameter property: הבדיקות רצות ב-strip-only של Node,
  // שלא תומך בתחביר הקיצור. הקוד חייב לרוץ בדיוק כמו שהוא נכתב.
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'EventLogError';
    this.code = code;
  }
}

/**
 * מוסיף אירוע ומחזיר לוג חדש.
 *
 * הוולידציה כאן היא שכבת ההגנה האחרונה לפני שהאירוע הופך ל"עובדה".
 * עדיף לזרוק על אירוע פגום מאשר לתת לו לזלוג לניקוד של כולם.
 */
export function append(log: MatchLog, draft: DraftEvent): MatchLog {
  const event: MatchEvent = Object.freeze({
    ...draft,
    fixtureId: log.fixtureId,
    gameweekId: log.gameweekId,
    seq: log.nextSeq,
    recordedAt: draft.recordedAt ?? new Date(0).toISOString(),
  });

  validate(log, event);

  return {
    ...log,
    events: Object.freeze([...log.events, event]),
    nextSeq: log.nextSeq + 1,
  };
}

/** הוספת כמה אירועים ברצף. הסדר בקלט הוא הסדר בלוג. */
export function appendMany(log: MatchLog, drafts: readonly DraftEvent[]): MatchLog {
  return drafts.reduce(append, log);
}

function validate(log: MatchLog, e: MatchEvent): void {
  if (PLAYER_EVENTS.has(e.kind) && !e.playerId) {
    throw new EventLogError('player_required', `אירוע ${e.kind} מחייב playerId.`);
  }
  if (e.teamId !== log.homeTeamId && e.teamId !== log.awayTeamId) {
    throw new EventLogError(
      'team_not_in_fixture',
      `הקבוצה ${e.teamId} לא משתתפת במשחק ${log.fixtureId}.`,
    );
  }
  if (e.minute < 0 || e.minute > 130) {
    throw new EventLogError('minute_out_of_range', `דקה ${e.minute} מחוץ לטווח.`);
  }
  if (e.kind === EventKind.Correction) {
    if (e.targetSeq === undefined) {
      throw new EventLogError('correction_target_required', 'תיקון מחייב targetSeq.');
    }
    const target = log.events.find((x) => x.seq === e.targetSeq);
    if (!target) {
      throw new EventLogError('correction_target_missing', `אין אירוע ${e.targetSeq} בלוג.`);
    }
    if (target.kind === EventKind.Correction) {
      // תיקון של תיקון מייצר שרשרת שאי אפשר להסביר למשתמש.
      // מבטלים את המקורי מחדש במקום.
      throw new EventLogError('correction_of_correction', 'אין לתקן שורת תיקון.');
    }
  }
}

/* =================================================================== */
/* תיקונים                                                             */
/* =================================================================== */

/**
 * מבטל אירוע קיים (שער שנפסל, כרטיס שבוטל, נתון שגוי מהספק).
 * לא מוחק כלום — מוסיף שורת ביטול שמצביעה על האירוע המקורי.
 */
export function voidEvent(
  log: MatchLog,
  targetSeq: number,
  reason: string,
  source: MatchEvent['source'] = 'correction',
): MatchLog {
  const target = log.events.find((e) => e.seq === targetSeq);
  if (!target) throw new EventLogError('correction_target_missing', `אין אירוע ${targetSeq}.`);
  return append(log, {
    kind: EventKind.Correction,
    correction: 'void',
    targetSeq,
    reason,
    phase: target.phase,
    minute: target.minute,
    teamId: target.teamId,
    playerId: target.playerId,
    source,
    confidence: 'verified',
  });
}

/**
 * ה"תמונה" האפקטיבית של הלוג: אירועים שלא בוטלו, בסדר קנוני.
 *
 * ★ זו הפונקציה היחידה שמותר לקרוא ממנה כשמחשבים ניקוד.
 *   כל מי שיקרא ישירות מ-`log.events` יספור גם שערים שנפסלו.
 */
export function effectiveEvents(log: MatchLog): readonly MatchEvent[] {
  const voided = new Set<number>();
  for (const e of log.events) {
    if (e.kind === EventKind.Correction && e.correction === 'void' && e.targetSeq !== undefined) {
      voided.add(e.targetSeq);
    }
  }
  return log.events
    .filter((e) => e.kind !== EventKind.Correction && !voided.has(e.seq))
    .sort(canonicalOrder);
}

/**
 * הסדר הקנוני: דקה, ואז תוספת זמן, ואז seq.
 * seq בסוף מבטיח שגם אירועים באותה דקה בדיוק לא "רוקדים" בין הרצות.
 */
export function canonicalOrder(a: MatchEvent, b: MatchEvent): number {
  if (a.minute !== b.minute) return a.minute - b.minute;
  const sa = a.stoppage ?? 0;
  const sb = b.stoppage ?? 0;
  if (sa !== sb) return sa - sb;
  return a.seq - b.seq;
}

/* =================================================================== */
/* ביקורת                                                              */
/* =================================================================== */

/** שורות התיקון בלבד — למסך הביקורת של האדמין. */
export function auditTrail(log: MatchLog): readonly MatchEvent[] {
  return log.events.filter((e) => e.kind === EventKind.Correction);
}

/**
 * טביעת אצבע של הלוג האפקטיבי.
 *
 * שני שרתים שמחזיקים את אותם אירועים יפיקו את אותה טביעה. אם ציון
 * של משתמש השתנה, אפשר להראות בדיוק שהלוג הוא שהשתנה — ולא המנוע.
 * hash קצר ויציב (FNV-1a), לא קריפטוגרפי ולא צריך להיות.
 */
export function fingerprint(log: MatchLog): string {
  let h = 0x811c9dc5;
  for (const e of effectiveEvents(log)) {
    const line = `${e.seq}|${e.kind}|${e.minute}|${e.stoppage ?? 0}|${e.teamId}|${e.playerId ?? ''}|${e.relatedPlayerId ?? ''}`;
    for (let i = 0; i < line.length; i++) {
      h ^= line.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, '0');
}
