/**
 * tests/scoring-actions.test.ts — עומק הניקוד.
 *
 * ★ שתי טענות, והשנייה חשובה מהראשונה:
 *
 *   1. כשמדליקים פעולות — הן מנוקדות נכון, כל אחת בשורה משלה.
 *   2. **כשלא מדליקים — שום ציון לא זז.** זו הדרישה שמאפשרת
 *      לשחרר את התשתית מבלי לשנות מחזור אחד שכבר שוחק. שדרוג
 *      שמשנה תוצאות בשקט הוא שכתוב של תחרות שנגמרה.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scoreLineup } from '../src/lib/scoring/engine.ts';
import { IL_PREMIER, RECOMMENDED_ACTIONS, ACTION_STATS,
         type RuleSet } from '../src/lib/scoring/rules.ts';
import { lineLabel, ACTION_LABELS } from '../src/lib/scoring/labels.ts';
import { Reason, type Lineup, type LineupSlot,
         type PlayerPerformance, type Position } from '../src/lib/scoring/types.ts';

const POSITIONS: Position[] = ['GK','DEF','DEF','DEF','DEF','MID','MID','MID','FWD','FWD','FWD'];

function perf(n: number, pos: Position, o: Partial<PlayerPerformance> = {}): PlayerPerformance {
  return {
    playerId: `P${n}`, teamId: `T${n}`, position: pos,
    minutes: 90, goals: 0, assists: 0, ownGoals: 0, yellowCards: 0, redCards: 0,
    saves: 0, penaltiesSaved: 0, penaltiesMissed: 0, goalsConceded: 0,
    cleanSheet: false, played: true, ...o,
  };
}

function lineup(): Lineup {
  const slots: LineupSlot[] = POSITIONS.map((position, i) => ({
    slotNo: i + 1, playerId: `P${i + 1}`, teamId: `T${i + 1}`, position,
    isCaptain: i + 1 === 9,
  }));
  return { lineupId: 'L1', userId: 'U1', gameweekId: 'GW7', formation: '4-3-3', slots };
}

const math = (perfs: any, rules: RuleSet = IL_PREMIER) =>
  scoreLineup(lineup(), perfs, {}, rules, { validate: false });

const sub = (score: any, playerId: string) =>
  score.players.find((p: any) => p.playerId === playerId)!.subtotal;

const withActions = (points: Partial<Record<string, number>>): RuleSet => ({
  ...IL_PREMIER,
  personal: { ...IL_PREMIER.personal, actions: points as Record<string, number> },
});

/* ================================================================= */

test('★ בלי חוקי פעולות — הציון זהה לחלוטין, גם כשיש נתונים', () => {
  const bare = perf(2, 'DEF', { goals: 1 });
  const rich = perf(2, 'DEF', {
    goals: 1,
    actions: { tacklesWon: 9, interceptions: 7, clearances: 12, keyPasses: 3 },
  });

  const a = math({ P2: bare });
  const b = math({ P2: rich });

  assert.equal(sub(a, 'P2'), 6);
  assert.equal(sub(b, 'P2'), 6, 'נתונים קיימים אך לא מנוקדים — הציון לא זז');
  assert.equal(a.totalPoints, b.totalPoints);
});

test('פעולה מנוקדת מופיעה כשורה נפרדת עם כמות ומחיר ליחידה', () => {
  const s = math(
    { P2: perf(2, 'DEF', { actions: { tacklesWon: 6 } }) },
    withActions({ tacklesWon: 0.25 }),
  );

  const lines = s.players.find((p: any) => p.playerId === 'P2')!.lines
    .filter((l: any) => l.reason === Reason.Action);

  assert.equal(lines.length, 1);
  assert.equal(lines[0].points, 1.5, '6 × 0.25');
  assert.equal(lines[0].count, 6, 'הכמות נשמרת — המסך מציג "6 חטיפות"');
  assert.equal(lines[0].meta?.stat, 'tacklesWon');
  assert.equal(lines[0].meta?.per, 0.25, 'המחיר ליחידה נשמר — "0.25 לכל אחת"');
  assert.equal(sub(s, 'P2'), 1.5);
});

test('כל סטטיסטיקה היא שורה משלה — לא סכום אחד מעורפל', () => {
  const s = math(
    { P2: perf(2, 'DEF', { actions: { tacklesWon: 4, interceptions: 4, clearances: 10 } }) },
    withActions({ tacklesWon: 0.25, interceptions: 0.25, clearances: 0.1 }),
  );

  const lines = s.players.find((p: any) => p.playerId === 'P2')!.lines
    .filter((l: any) => l.reason === Reason.Action);

  assert.equal(lines.length, 3);
  assert.equal(sub(s, 'P2'), 3, '1 + 1 + 1');
});

test('סטטיסטיקה בלי חוק, וחוק בלי סטטיסטיקה — שניהם אפס שורות', () => {
  const noRule = math(
    { P2: perf(2, 'DEF', { actions: { clearances: 20 } }) },
    withActions({ tacklesWon: 1 }),
  );
  assert.equal(sub(noRule, 'P2'), 0);

  const noStat = math(
    { P2: perf(2, 'DEF', { actions: { tacklesWon: 0 } }) },
    withActions({ tacklesWon: 1 }),
  );
  assert.equal(sub(noStat, 'P2'), 0, 'אפס פעולות אינו שורה של אפס נקודות');
});

test('שחקן שלא ירד למגרש לא מקבל נקודות פעולה', () => {
  const s = math(
    { P2: perf(2, 'DEF', { played: false, minutes: 0, actions: { tacklesWon: 5 } }) },
    withActions({ tacklesWon: 1 }),
  );
  assert.equal(sub(s, 'P2'), 0);
});

test('הקפטן מכפיל גם נקודות פעולה', () => {
  const s = math(
    { P9: perf(9, 'FWD', { actions: { shotsOnTarget: 4 } }) },
    withActions({ shotsOnTarget: 0.5 }),
  );
  /* 4 × 0.5 = 2, קפטן ×3 → 6 */
  assert.equal(s.captainPoints, 4, 'התוספת מעבר לבסיס');
  assert.equal(s.totalPoints, 6);
});

test('★ ההצעה המומלצת: מגן עובד מרוויח פחות משער', () => {
  const s = math(
    { P2: perf(2, 'DEF', { actions: { tacklesWon: 6, interceptions: 4, clearances: 5 } }) },
    withActions(RECOMMENDED_ACTIONS),
  );
  const points = sub(s, 'P2');

  assert.ok(points > 2, `מגן עובד מקבל משהו אמיתי (${points})`);
  assert.ok(points < IL_PREMIER.personal.goal.DEF,
    `ועדיין פחות משער (${points} < ${IL_PREMIER.personal.goal.DEF})`);
});

test('כל סטטיסטיקה ברשימה מתורגמת לעברית', () => {
  for (const stat of ACTION_STATS) {
    assert.ok(ACTION_LABELS[stat], `חסרה תווית ל-${stat}`);
  }
  assert.equal(lineLabel(Reason.Action, { stat: 'keyPasses' }), 'מסירות מפתח');
  assert.equal(lineLabel(Reason.Goal), 'שערים');
  assert.equal(lineLabel(Reason.Action, { stat: 'unknownStat' }), 'unknownStat',
    'סטטיסטיקה לא מוכרת מוצגת כמו שהיא ולא נעלמת');
});

/* ================================================================= */

test('buildInputs צובר מונים על פני משחקים ומתעלם מזבל', async () => {
  const { buildInputs } = await import('../src/lib/scoring/engine.ts');

  const { performances } = buildInputs([
    { player_id: 'P1', team_id: 'T1', position: 'MID', minutes: 90,
      goals: 1, actions: { keyPasses: 2, tacklesWon: 3 } },
    { player_id: 'P1', team_id: 'T1', position: 'MID', minutes: 45,
      goals: 0, actions: { keyPasses: 1, junk: 'x', negative: -4 } },
  ], []);

  const p = performances.get('P1')!;
  assert.equal(p.minutes, 135);
  assert.equal(p.actions?.keyPasses, 3, '2 + 1');
  assert.equal(p.actions?.tacklesWon, 3);
  assert.equal(p.actions?.junk, undefined, 'ערך לא מספרי נדחה');
  assert.equal(p.actions?.negative, undefined, 'ערך שלילי נדחה');
});

test('שורה בלי actions לא יוצרת מפה ריקה', async () => {
  const { buildInputs } = await import('../src/lib/scoring/engine.ts');
  const { performances } = buildInputs(
    [{ player_id: 'P1', team_id: 'T1', position: 'MID', minutes: 90, goals: 1 }], []);
  assert.equal(performances.get('P1')!.actions, undefined);
});
