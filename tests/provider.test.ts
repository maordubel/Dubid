/**
 * tests/provider.test.ts — מתאם API-Football.
 *
 * הבדיקות כאן מגנות על הגבול: אם מחר מישהו ישנה את המיפוי, אחת
 * מהן תיפול לפני שזה יגיע לניקוד של משתמשים אמיתיים.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adaptEvent, adaptFixture, type ApiFootballEvent } from '../src/lib/events/providers/apiFootball.ts';
import { EventKind } from '../src/lib/events/types.ts';
import { appendMany, createLog } from '../src/lib/events/log.ts';
import { project } from '../src/lib/events/project.ts';
import type { RosterEntry } from '../src/lib/events/project.ts';

const ids = {
  team: (x: string) => ({ '100': 'T1', '200': 'T2' })[x],
  player: (x: string) => ({ '1': 'P1', '2': 'P2', '3': 'P3' })[x],
};
const opts = { ids };

const ev = (o: Partial<ApiFootballEvent>): ApiFootballEvent => ({
  time: { elapsed: 30, extra: null }, team: { id: 100 }, ...o,
});

test('שער רגיל עם בישול נהיה שני אירועים', () => {
  const out = adaptEvent(
    ev({ type: 'Goal', detail: 'Normal Goal', player: { id: 1 }, assist: { id: 2 } }),
    opts,
  );
  assert.equal(out.length, 2);
  assert.equal(out[0].kind, EventKind.Goal);
  assert.equal(out[0].playerId, 'P1');
  assert.equal(out[1].kind, EventKind.Assist);
  assert.equal(out[1].playerId, 'P2');
});

test('פנדל לא מזכה בבישול', () => {
  const out = adaptEvent(
    ev({ type: 'Goal', detail: 'Penalty', player: { id: 1 }, assist: { id: 2 } }),
    opts,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, EventKind.PenaltyScored);
});

test('שער עצמי לא מזכה בבישול', () => {
  const out = adaptEvent(ev({ type: 'Goal', detail: 'Own Goal', player: { id: 1 }, assist: { id: 2 } }), opts);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, EventKind.OwnGoal);
});

test('פנדל שהוחמץ מזוהה ולא נספר כשער', () => {
  const out = adaptEvent(ev({ type: 'Goal', detail: 'Missed Penalty', player: { id: 1 } }), opts);
  assert.equal(out[0].kind, EventKind.PenaltyMissed);
});

test('★ צהוב שני לא מסווג כצהוב רגיל', () => {
  const second = adaptEvent(ev({ type: 'Card', detail: 'Second Yellow card', player: { id: 1 } }), opts);
  assert.equal(second[0].kind, EventKind.SecondYellow);

  const yellow = adaptEvent(ev({ type: 'Card', detail: 'Yellow Card', player: { id: 1 } }), opts);
  assert.equal(yellow[0].kind, EventKind.YellowCard);

  const red = adaptEvent(ev({ type: 'Card', detail: 'Red Card', player: { id: 1 } }), opts);
  assert.equal(red[0].kind, EventKind.RedCard);
});

test('חילוף מייצר כניסה ויציאה', () => {
  const out = adaptEvent(ev({ type: 'subst', player: { id: 3 }, assist: { id: 1 } }), opts);
  assert.deepEqual(out.map((x) => x.kind), [EventKind.SubOn, EventKind.SubOff]);
  assert.equal(out[0].playerId, 'P3');
  assert.equal(out[1].playerId, 'P1');
});

test('VAR לא מבטל שער אוטומטית — דורש אישור אדמין', () => {
  const reasons: string[] = [];
  const out = adaptEvent(
    ev({ type: 'Var', detail: 'Goal cancelled', player: { id: 1 } }),
    { ids, onUnmapped: (_e, r) => reasons.push(r) },
  );
  assert.equal(out.length, 0);
  assert.deepEqual(reasons, ['var_requires_admin_review']);
});

test('שחקן או קבוצה שלא ממופים — מדלגים ומדווחים, לא ממציאים', () => {
  const reasons: string[] = [];
  const o = { ids, onUnmapped: (_e: ApiFootballEvent, r: string) => reasons.push(r) };
  assert.equal(adaptEvent(ev({ type: 'Goal', team: { id: 999 }, player: { id: 1 } }), o).length, 0);
  assert.equal(adaptEvent(ev({ type: 'Goal', player: { id: 999 } }), o).length, 0);
  assert.deepEqual(reasons, ['team_not_mapped', 'player_not_mapped']);
});

test('דקה 45+2 שומרת על ההפרדה בין דקה לתוספת', () => {
  const out = adaptEvent(
    ev({ time: { elapsed: 45, extra: 2 }, type: 'Goal', detail: 'Normal Goal', player: { id: 1 } }),
    opts,
  );
  assert.equal(out[0].minute, 45);
  assert.equal(out[0].stoppage, 2);
  assert.equal(out[0].phase, '1H');
});

test('המרה של משחק שלם דטרמיניסטית', () => {
  const raw: ApiFootballEvent[] = [
    ev({ time: { elapsed: 70 }, type: 'Card', detail: 'Yellow Card', player: { id: 2 } }),
    ev({ time: { elapsed: 12 }, type: 'Goal', detail: 'Normal Goal', player: { id: 1 } }),
    ev({ time: { elapsed: 45, extra: 3 }, type: 'subst', player: { id: 3 }, assist: { id: 1 } }),
  ];
  const a = adaptFixture(raw, opts);
  const b = adaptFixture(raw, opts);
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((x) => x.minute), [12, 45, 45, 70]);
});

test('★ מקצה לקצה: JSON של הספק → לוג → הקרנה', () => {
  const roster = new Map<string, RosterEntry>([
    ['P1', { playerId: 'P1', teamId: 'T1', position: 'FWD' }],
    ['P2', { playerId: 'P2', teamId: 'T1', position: 'MID' }],
    ['P3', { playerId: 'P3', teamId: 'T1', position: 'FWD' }],
  ]);

  const drafts = adaptFixture(
    [
      ev({ time: { elapsed: 0 }, type: 'subst', player: { id: 1 } }),
      ev({ time: { elapsed: 12 }, type: 'Goal', detail: 'Normal Goal', player: { id: 1 }, assist: { id: 2 } }),
      ev({ time: { elapsed: 70 }, type: 'Card', detail: 'Yellow Card', player: { id: 2 } }),
    ],
    opts,
  );

  let log = createLog({ fixtureId: 'F1', gameweekId: 'GW1', homeTeamId: 'T1', awayTeamId: 'T2' });
  log = appendMany(log, drafts);

  const p = project(log, roster);
  assert.equal(p.performances.get('P1')!.goals, 1);
  assert.equal(p.performances.get('P2')!.assists, 1);
  assert.equal(p.performances.get('P2')!.yellowCards, 1);
  assert.equal(p.outcomes.get('T1')!.goalsFor, 1);
  assert.equal(p.outcomes.get('T1')!.result, 'W');
});
