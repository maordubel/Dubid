/**
 * tests/events.test.ts — הלוג, ההקרנה, והשיגור לשני מצבי המשחק.
 *
 * הבדיקה החשובה ביותר כאן היא האחרונה: אותו לוג בדיוק מייצר תשובה
 * לדוביד 5 ותשובה לדוביד 11, ושתיהן נגזרות מהקרנה אחת.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EventKind } from '../src/lib/events/types.ts';
import { append, appendMany, createLog, effectiveEvents, fingerprint, voidEvent, auditTrail, EventLogError } from '../src/lib/events/log.ts';
import { project, mergeProjections } from '../src/lib/events/project.ts';
import type { RosterEntry } from '../src/lib/events/project.ts';
import type { Position } from '../src/lib/scoring/types.ts';

const HOME = 'T1';
const AWAY = 'T2';

const roster = new Map<string, RosterEntry>([
  ['P1', { playerId: 'P1', teamId: HOME, position: 'GK' as Position }],
  ['P2', { playerId: 'P2', teamId: HOME, position: 'DEF' as Position }],
  ['P3', { playerId: 'P3', teamId: HOME, position: 'FWD' as Position }],
  ['P4', { playerId: 'P4', teamId: HOME, position: 'MID' as Position }],
  ['P9', { playerId: 'P9', teamId: AWAY, position: 'FWD' as Position }],
  ['P8', { playerId: 'P8', teamId: AWAY, position: 'GK' as Position }],
]);

function base() {
  return createLog({ fixtureId: 'F1', gameweekId: 'GW1', homeTeamId: HOME, awayTeamId: AWAY });
}

const start = (playerId: string, teamId: string) =>
  ({ kind: EventKind.LineupStart, phase: '1H', minute: 0, teamId, playerId,
     source: 'provider', confidence: 'verified' }) as const;

test('הלוג הוא append-only ומקצה seq עולה', () => {
  let log = base();
  log = append(log, start('P1', HOME));
  log = append(log, start('P9', AWAY));
  assert.equal(log.events.length, 2);
  assert.deepEqual(log.events.map((e) => e.seq), [1, 2]);
  assert.equal(log.nextSeq, 3);
});

test('אירוע אישי בלי playerId נפסל', () => {
  const log = base();
  assert.throws(
    () => append(log, { kind: EventKind.Goal, phase: '1H', minute: 10, teamId: HOME,
                        source: 'provider', confidence: 'verified' } as any),
    (e: unknown) => e instanceof EventLogError && (e as EventLogError).code === 'player_required',
  );
});

test('קבוצה שלא במשחק נפסלת', () => {
  const log = base();
  assert.throws(
    () => append(log, start('P1', 'T99') as any),
    (e: unknown) => (e as EventLogError).code === 'team_not_in_fixture',
  );
});

test('ביטול שער לא מוחק אותו מהלוג אבל מוציא אותו מהתוצאה', () => {
  let log = base();
  log = appendMany(log, [
    start('P3', HOME),
    { kind: EventKind.Goal, phase: '1H', minute: 20, teamId: HOME, playerId: 'P3',
      source: 'provider', confidence: 'verified' },
  ]);
  const goalSeq = log.events.find((e) => e.kind === EventKind.Goal)!.seq;

  const before = project(log, roster);
  assert.equal(before.outcomes.get(HOME)!.goalsFor, 1);

  log = voidEvent(log, goalSeq, 'נפסל בוואר — עבירה בהתחלת המהלך');

  // ההיסטוריה נשמרה
  assert.equal(log.events.length, 3);
  assert.equal(auditTrail(log).length, 1);
  assert.equal(auditTrail(log)[0].reason, 'נפסל בוואר — עבירה בהתחלת המהלך');

  // אבל האמת האפקטיבית השתנתה
  const after = project(log, roster);
  assert.equal(after.outcomes.get(HOME)!.goalsFor, 0);
  assert.equal(after.performances.get('P3')!.goals, 0);
  assert.equal(effectiveEvents(log).length, 1);
});

test('שער עצמי נזקף ליריבה', () => {
  let log = base();
  log = appendMany(log, [
    start('P2', HOME),
    { kind: EventKind.OwnGoal, phase: '2H', minute: 70, teamId: HOME, playerId: 'P2',
      source: 'provider', confidence: 'verified' },
  ]);
  const p = project(log, roster);
  assert.equal(p.outcomes.get(AWAY)!.goalsFor, 1);
  assert.equal(p.outcomes.get(HOME)!.goalsFor, 0);
  assert.equal(p.outcomes.get(AWAY)!.result, 'W');
  assert.equal(p.performances.get('P2')!.ownGoals, 1);
});

test('ספיגה אחרי שהמגן יצא לא שוללת ממנו קלין-שיט', () => {
  let log = base();
  log = appendMany(log, [
    start('P2', HOME),
    { kind: EventKind.SubOff, phase: '2H', minute: 60, teamId: HOME, playerId: 'P2',
      source: 'provider', confidence: 'verified' },
    { kind: EventKind.Goal, phase: '2H', minute: 85, teamId: AWAY, playerId: 'P9',
      source: 'provider', confidence: 'verified' },
  ]);
  const p = project(log, roster);
  const def = p.performances.get('P2')!;
  assert.equal(def.minutes, 60);
  assert.equal(def.goalsConceded, 0, 'השער נכבש אחרי שיצא');
  assert.equal(def.cleanSheet, true);
});

test('כרטיס אדום עוצר את שעון הדקות', () => {
  let log = base();
  log = appendMany(log, [
    start('P4', HOME),
    { kind: EventKind.RedCard, phase: '1H', minute: 30, teamId: HOME, playerId: 'P4',
      source: 'provider', confidence: 'verified' },
  ]);
  const p = project(log, roster);
  assert.equal(p.performances.get('P4')!.minutes, 30);
  assert.equal(p.performances.get('P4')!.redCards, 1);
});

test('מחליף מקבל דקות מרגע הכניסה בלבד', () => {
  let log = base();
  log = appendMany(log, [
    { kind: EventKind.SubOn, phase: '2H', minute: 75, teamId: HOME, playerId: 'P3',
      source: 'provider', confidence: 'verified' },
  ]);
  const p = project(log, roster);
  assert.equal(p.performances.get('P3')!.minutes, 15);
  assert.equal(p.extended.get('P3')!.cameOffBench, true);
});

test('משחק שנזנח לא מייצר תוצאה', () => {
  let log = base();
  log = appendMany(log, [
    start('P3', HOME),
    { kind: EventKind.Goal, phase: '1H', minute: 10, teamId: HOME, playerId: 'P3',
      source: 'provider', confidence: 'verified' },
    { kind: EventKind.MatchAbandoned, phase: '1H', minute: 40, teamId: HOME,
      source: 'admin', confidence: 'verified' },
  ]);
  const p = project(log, roster);
  assert.equal(p.outcomes.size, 0, 'אין ניחוש תוצאה למשחק שלא הסתיים');
});

test('ההקרנה דטרמיניסטית — אותו לוג, אותה טביעת אצבע', () => {
  let a = base();
  let b = base();
  const evts = [
    start('P3', HOME),
    { kind: EventKind.Goal, phase: '1H', minute: 12, teamId: HOME, playerId: 'P3',
      source: 'provider', confidence: 'verified' } as const,
    { kind: EventKind.Assist, phase: '1H', minute: 12, teamId: HOME, playerId: 'P4',
      source: 'provider', confidence: 'verified' } as const,
  ];
  a = appendMany(a, evts);
  b = appendMany(b, evts);
  assert.equal(fingerprint(a), fingerprint(b));
  assert.deepEqual(
    [...project(a, roster).performances.entries()],
    [...project(b, roster).performances.entries()],
  );
});

test('מיזוג שני משחקים במחזור צובר נתונים', () => {
  const mk = (fixtureId: string, minute: number) => {
    let l = createLog({ fixtureId, gameweekId: 'GW1', homeTeamId: HOME, awayTeamId: AWAY });
    return appendMany(l, [
      start('P3', HOME),
      { kind: EventKind.Goal, phase: '1H', minute, teamId: HOME, playerId: 'P3',
        source: 'provider', confidence: 'verified' },
    ]);
  };
  const merged = mergeProjections([
    project(mk('F1', 10), roster),
    project(mk('F2', 20), roster),
  ]);
  assert.equal(merged.performances.get('P3')!.goals, 2);
  assert.equal(merged.outcomes.get(HOME)!.goalsFor, 2);
});
