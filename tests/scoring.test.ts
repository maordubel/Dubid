/**
 * טסטים למנוע הניקוד — לפי מפרט הניקוד של המוצר:
 *   שער: שוער/מגן 6 · קשר 5 · חלוץ 4   |   בישול 3   |   קלין-שיט 4
 *   כרטיס: צהוב ‎-1‎ · אדום ‎-3‎
 *   בונוס תוצאה: ניצחון ‎+4‎ · תיקו ‎+1‎
 *   שער וירטואלי: כל 2 שערים של קבוצות ההרכב = ‎+5‎
 *   הקפטן הדובידי: ×3 · חסינות כרטיסים · העברה לסגן
 *
 *   node --experimental-strip-types --test tests/scoring.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scoreLineup, rankGameweek } from '../src/lib/scoring/engine.ts';
import { IL_PREMIER, EN_PREMIER, resolveRules, formationForSize,
         type RuleSet } from '../src/lib/scoring/rules.ts';
import { validateLineup, teamCoverage, teamBlock, checkLeagueCapacity,
         LineupInvalidError, formatIssue } from '../src/lib/scoring/validate.ts';
import { ErrorCode, Reason, type Lineup, type LineupSlot,
         type PlayerPerformance, type Position, type TeamOutcome } from '../src/lib/scoring/types.ts';

/* ---------------- עזרים ---------------- */
const POSITIONS: Position[] = ['GK','DEF','DEF','DEF','DEF','MID','MID','MID','FWD','FWD','FWD'];

function perf(n: number, pos: Position, o: Partial<PlayerPerformance> = {}): PlayerPerformance {
  return {
    playerId: `P${n}`, teamId: `T${n}`, position: pos,
    minutes: 90, goals: 0, assists: 0, ownGoals: 0, yellowCards: 0, redCards: 0,
    saves: 0, penaltiesSaved: 0, penaltiesMissed: 0, goalsConceded: 0,
    cleanSheet: false, played: true, ...o,
  };
}
const outcome = (n: number, result: 'W'|'D'|'L', gf: number, ga = 0): TeamOutcome =>
  ({ teamId: `T${n}`, result, goalsFor: gf, goalsAgainst: ga });

function lineup(opts: { teams?: string[]; captain?: number; vice?: number; formation?: string } = {}): Lineup {
  const slots: LineupSlot[] = POSITIONS.map((position, i) => ({
    slotNo: i + 1,
    playerId: `P${i + 1}`,
    teamId: opts.teams ? opts.teams[i] : `T${i + 1}`,
    position,
    isCaptain: (opts.captain ?? 9) === i + 1,
    isVice: opts.vice === i + 1,
  }));
  return { lineupId: 'L1', userId: 'U1', gameweekId: 'GW7',
           formation: opts.formation ?? '4-3-3', slots };
}

/** לבדיקות מתמטיקה טהורה: מדלגים על הוולידציה (יש לה טסטים משלה). */
const math = (lu: Lineup, perfs: any, outs: any = {}, rules: RuleSet = IL_PREMIER) =>
  scoreLineup(lu, perfs, outs, rules, { validate: false });

const line = (score: any, playerId: string, reason: string) =>
  score.players.find((p: any) => p.playerId === playerId)?.lines.find((l: any) => l.reason === reason);
const sub = (score: any, playerId: string) =>
  score.players.find((p: any) => p.playerId === playerId)!.subtotal;

/* =================================================================
   1 · ציון אינדיבידואלי — לפי המפרט
   ================================================================= */
test('שער: שוער 6 · מגן 6 · קשר 5 · חלוץ 4', () => {
  // עמדת הניקוד נקבעת לפי המשבצת בהרכב, ולכן בודקים דרך המשבצת המתאימה
  const bySlot: Array<[number, Position, number]> = [[1, 'GK', 6], [2, 'DEF', 6], [6, 'MID', 5], [9, 'FWD', 4]];
  for (const [n, pos, pts] of bySlot) {
    const s = math(lineup({ captain: 99 }), { [`P${n}`]: perf(n, pos, { goals: 1 }) });
    assert.equal(sub(s, `P${n}`), pts, `${pos} goal`);
  }
});

test('בישול = 3', () => {
  const s = math(lineup({ captain: 99 }), { P6: perf(6, 'MID', { assists: 2 }) }, {}, IL_PREMIER);
  assert.equal(sub(s, 'P6'), 6);
});

test('קלין-שיט = 4, אחיד לכל העמדות, ודורש 60 דקות', () => {
  const full = math(lineup({ captain: 99 }),
    { P1: perf(1, 'GK', { cleanSheet: true }), P2: perf(2, 'DEF', { cleanSheet: true }) });
  assert.equal(sub(full, 'P1'), 4);
  assert.equal(sub(full, 'P2'), 4);

  const short = math(lineup({ captain: 99 }),
    { P1: perf(1, 'GK', { minutes: 45, cleanSheet: true }) });
  assert.equal(line(short, 'P1', Reason.CleanSheet), undefined);
});

test('כרטיסים: צהוב ‎-1‎ · אדום ‎-3‎', () => {
  const s = math(lineup({ captain: 99 }),
    { P6: perf(6, 'MID', { yellowCards: 1, redCards: 1 }) });
  assert.equal(sub(s, 'P6'), -4);
});

test('אין נקודות על עצם ההשתתפות (לפי המפרט)', () => {
  const s = math(lineup({ captain: 99 }), { P3: perf(3, 'DEF') }, {}, IL_PREMIER);
  assert.equal(sub(s, 'P3'), 0);
});

test('שחקן שלא שיחק — אפס', () => {
  const s = math(lineup({ captain: 99 }),
    { P10: perf(10, 'FWD', { minutes: 0, played: false }) });
  assert.equal(sub(s, 'P10'), 0);
});

/* =================================================================
   2 · בונוס תוצאה קבוצתית
   ================================================================= */
test('בונוס תוצאה: ניצחון ‎+4‎ · תיקו ‎+1‎ · הפסד 0', () => {
  for (const [result, pts] of [['W', 4], ['D', 1], ['L', 0]] as const) {
    const s = math(lineup({ captain: 99 }),
      { P3: perf(3, 'DEF') }, { T3: outcome(3, result, 1) });
    assert.equal(sub(s, 'P3'), pts, `result ${result}`);
  }
});

/* =================================================================
   3 · שער ההרכב הווירטואלי
   ================================================================= */
test('כל 2 שערים של קבוצות ההרכב = שער וירטואלי של 5 נקודות', () => {
  const outcomes: Record<string, TeamOutcome> = {};
  [2,1,0,0,3,2,1,0,2,0,3].forEach((g, i) => { outcomes[`T${i+1}`] = outcome(i+1, 'D', g); });
  const s = math(lineup({ captain: 99 }), {}, outcomes, IL_PREMIER);
  // 14 שערים -> 7 שערים וירטואליים -> 35 נקודות
  assert.equal(s.virtualPoints, 35);
  assert.equal(s.bonusLines[0].count, 7);
  assert.equal((s.bonusLines[0].meta as any).teamGoalsTotal, 14);
});

test('שער בודד לא מייצר שער וירטואלי (שארית נשמרת בפירוט)', () => {
  const outcomes: Record<string, TeamOutcome> = { T1: outcome(1, 'W', 1) };
  const s = math(lineup({ captain: 99 }), {}, outcomes, IL_PREMIER);
  assert.equal(s.virtualPoints, 0);
});

test('קבוצה בלי משחק לא נספרת', () => {
  const s = math(lineup({ captain: 99 }), {}, {}, IL_PREMIER);
  assert.equal(s.virtualPoints, 0);
});

/* =================================================================
   4 · ★ אכיפת מגבלת ההרכב — Distinct Team ID per 11
   ================================================================= */
test('הרכב תקין: 11 שחקנים מ-11 קבוצות שונות', () => {
  assert.deepEqual(validateLineup(lineup(), IL_PREMIER), []);
});

test('שני שחקנים מאותה קבוצה נחסמים, וההודעה מציינת את הקבוצה', () => {
  const teams = Array.from({ length: 11 }, (_, i) => `T${i + 1}`);
  teams[5] = teams[0];
  const issues = validateLineup(lineup({ teams }), IL_PREMIER);
  const dup = issues.find((i) => i.code === ErrorCode.DuplicateTeam);
  assert.ok(dup);
  assert.equal(dup!.params.teams, 'T1');
  assert.match(formatIssue(dup!, 'he'), /T1/);
});

test('המנוע מסרב לנקד הרכב שמפר את האילוץ', () => {
  const teams = Array.from({ length: 11 }, (_, i) => `T${i + 1}`);
  teams[3] = teams[2];
  assert.throws(() => scoreLineup(lineup({ teams }), {}, {}), LineupInvalidError);
});

test('teamBlock מחזיר ל-UI מי תופס את הקבוצה', () => {
  const lu = lineup();
  const free = teamBlock(lu, 'T99', IL_PREMIER);
  assert.equal(free.blocked, false);

  const taken = teamBlock(lu, 'T1', IL_PREMIER);
  assert.equal(taken.blocked, true);
  assert.equal(taken.occupiedBy, 'P1');
  assert.match(taken.reasonHe!, /כבר יש לך שחקן/);
});

test('מפת כיסוי: 11 אוישו, 3 פנויות מתוך 14', () => {
  const all = Array.from({ length: 14 }, (_, i) => `T${i + 1}`);
  const cov = teamCoverage(lineup(), all, IL_PREMIER);
  assert.equal(cov.filter((c) => c.filled).length, 11);
  assert.equal(cov.filter((c) => !c.filled).length, 3);
});

test('ליגה עם פחות מ-11 קבוצות נחסמת בהודעה מפורשת', () => {
  const issue = checkLeagueCapacity(6, IL_PREMIER);
  assert.ok(issue);
  assert.equal(issue!.code, ErrorCode.NotEnoughTeams);
  assert.equal(issue!.params.missing, 5);
  assert.match(formatIssue(issue!, 'he'), /חסרות 5/);

  assert.equal(checkLeagueCapacity(11, IL_PREMIER), null);
});

test('resolveRules: 6 קבוצות -> מצב הדגמה עם הרכב של 6', () => {
  const r = resolveRules(6, IL_PREMIER);
  assert.equal(r.isDemo, true);
  assert.equal(r.missingTeams, 5);
  assert.equal(r.rules.constraints.lineupSize, 6);
  assert.equal(r.rules.constraints.maxPlayersPerTeam, 1);   // הכלל לא נשבר
  assert.deepEqual(r.rules.constraints.formationAllowed, ['2-2-1']);
  assert.equal(formationForSize(6), '2-2-1');

  const full = resolveRules(14, IL_PREMIER);
  assert.equal(full.isDemo, false);
  assert.equal(full.rules.constraints.lineupSize, 11);
});

test('ליגה זרה יכולה להתיר 2 מאותה קבוצה — בלי שינוי קוד', () => {
  const teams = Array.from({ length: 11 }, (_, i) => `T${i + 1}`);
  teams[5] = teams[0];
  const rules: RuleSet = { ...EN_PREMIER,
    constraints: { ...EN_PREMIER.constraints, lineupSize: 11, benchSize: 0 } };
  assert.deepEqual(validateLineup(lineup({ teams }), rules), []);
});

test('מערך לא תואם לעמדות נדחה', () => {
  const issues = validateLineup(lineup({ formation: '4-4-2' }), IL_PREMIER);
  assert.ok(issues.some((i) => i.code === ErrorCode.FormationMismatch));
});

/* =================================================================
   5 · ★ הקפטן הדובידי
   ================================================================= */
test('הקפטן מכפיל פי 3', () => {
  const s = scoreLineup(lineup(), { P9: perf(9, 'FWD', { goals: 1 }) }, {}, IL_PREMIER);
  assert.equal(line(s, 'P9', Reason.CaptainMultiplier).points, 8);  // בסיס 4 ×3
  assert.equal(sub(s, 'P9'), 12);
});

test('חסינות: צהוב מבוטל אחרי 60 דקות כשלא הפסידו', () => {
  const s = scoreLineup(lineup(),
    { P9: perf(9, 'FWD', { goals: 1, yellowCards: 1 }) },
    { T9: outcome(9, 'W', 1) }, IL_PREMIER);
  assert.equal(line(s, 'P9', Reason.Yellow).points, -1);        // הכרטיס נשאר בפירוט
  assert.equal(line(s, 'P9', Reason.CaptainImmunity).points, 1); // והזיכוי לידו
  // 4 שער + 4 ניצחון - 1 צהוב + 1 חסינות = 8 ; ×3 => 24
  assert.equal(sub(s, 'P9'), 24);
});

test('אין חסינות בהפסד', () => {
  const s = scoreLineup(lineup(),
    { P9: perf(9, 'FWD', { goals: 1, yellowCards: 1 }) },
    { T9: outcome(9, 'L', 0, 2) }, IL_PREMIER);
  assert.equal(line(s, 'P9', Reason.CaptainImmunity), undefined);
});

test('אין חסינות מתחת ל-60 דקות', () => {
  const s = scoreLineup(lineup(),
    { P9: perf(9, 'FWD', { minutes: 40, goals: 1, yellowCards: 1 }) },
    { T9: outcome(9, 'W', 1) }, IL_PREMIER);
  assert.equal(line(s, 'P9', Reason.CaptainImmunity), undefined);
});

test('כרטיס אדום אף פעם לא נסלח', () => {
  const s = scoreLineup(lineup(),
    { P9: perf(9, 'FWD', { goals: 2, redCards: 1 }) },
    { T9: outcome(9, 'W', 2) }, IL_PREMIER);
  assert.equal(line(s, 'P9', Reason.Red).points, -3);
  assert.equal(line(s, 'P9', Reason.CaptainImmunity), undefined);
  // 8 שערים + 4 ניצחון - 3 אדום = 9 ; ×3 => 27
  assert.equal(sub(s, 'P9'), 27);
});

test('קפטן שלא שיחק — הכפולה עוברת לסגן', () => {
  const s = scoreLineup(lineup({ captain: 9, vice: 11 }),
    { P9: perf(9, 'FWD', { minutes: 0, played: false }), P11: perf(11, 'FWD', { goals: 1 }) },
    {}, IL_PREMIER);
  assert.ok(line(s, 'P11', Reason.CaptainTransferred));
  assert.equal(line(s, 'P11', Reason.CaptainMultiplier).points, 8);
  assert.equal(line(s, 'P9', Reason.CaptainMultiplier), undefined);
});

test('קפטן שלא שיחק ואין סגן פעיל — אין מכפיל', () => {
  const s = scoreLineup(lineup({ captain: 9 }),
    { P9: perf(9, 'FWD', { minutes: 0, played: false }) }, {}, IL_PREMIER);
  assert.equal(s.captainPoints, 0);
});

test('ציון שלילי לא מוכפל — ההימור מגדיל רווח, לא הפסד', () => {
  const s = scoreLineup(lineup(),
    { P9: perf(9, 'FWD', { ownGoals: 2, redCards: 1 }) },
    { T9: outcome(9, 'L', 0, 3) }, IL_PREMIER);
  assert.equal(line(s, 'P9', Reason.CaptainMultiplier), undefined);
  assert.equal(sub(s, 'P9'), -7);   // -4 שערים עצמיים, -3 אדום
});

test('המכפיל חל גם על בונוס התוצאה (ברירת המחדל)', () => {
  const s = scoreLineup(lineup(), { P9: perf(9, 'FWD', { goals: 1 }) },
    { T9: outcome(9, 'W', 1) }, IL_PREMIER);
  assert.equal(line(s, 'P9', Reason.CaptainMultiplier).points, 16); // (4+4)×2
});

test("appliesTo='personal' מחריג את בונוס התוצאה", () => {
  const rules: RuleSet = { ...IL_PREMIER, captain: { ...IL_PREMIER.captain, appliesTo: 'personal' } };
  const s = scoreLineup(lineup(), { P9: perf(9, 'FWD', { goals: 1 }) },
    { T9: outcome(9, 'W', 1) }, rules);
  assert.equal(line(s, 'P9', Reason.CaptainMultiplier).points, 8);  // רק השער ×2
});

/* =================================================================
   6 · תרחיש מחזור מלא — כל המספרים מחושבים ביד
   ================================================================= */
test('מחזור מלא: אישי 32 · תוצאה 23 · קפטן 25 · וירטואלי 35 = 115', () => {
  const lu = lineup({ captain: 9 });

  const performances: Record<string, PlayerPerformance> = {
    P1:  perf(1, 'GK',  { cleanSheet: true }),
    P2:  perf(2, 'DEF', { goals: 1 }),
    P3:  perf(3, 'DEF'),
    P4:  perf(4, 'DEF', { cleanSheet: true }),
    P5:  perf(5, 'DEF', { yellowCards: 1 }),
    P6:  perf(6, 'MID', { assists: 2 }),
    P7:  perf(7, 'MID', { goals: 1 }),
    P8:  perf(8, 'MID', { redCards: 1 }),
    P9:  perf(9, 'FWD', { goals: 2, yellowCards: 1 }),   // הקפטן
    P10: perf(10, 'FWD', { minutes: 0, played: false }),
    P11: perf(11, 'FWD', { goals: 1 }),
  };
  const outcomes: Record<string, TeamOutcome> = {
    T1: outcome(1,'W',2), T2: outcome(2,'D',1), T3: outcome(3,'L',0),
    T4: outcome(4,'D',0), T5: outcome(5,'W',3), T6: outcome(6,'W',2),
    T7: outcome(7,'D',1), T8: outcome(8,'L',0), T9: outcome(9,'W',2),
    T10: outcome(10,'L',0), T11: outcome(11,'W',3),
  };

  const s = scoreLineup(lu, performances, outcomes, IL_PREMIER);

  assert.equal(s.personalPoints, 32);
  assert.equal(s.resultPoints, 23);
  assert.equal(s.captainPoints, 25);   // חסינות +1, מכפיל +24
  assert.equal(s.virtualPoints, 35);   // 14 שערי קבוצות -> 7 וירטואליים
  assert.equal(s.totalPoints, 115);
  assert.equal(sub(s, 'P9'), 36);      // בסיס 12 ×3
});

test('דירוג מטפל בשוויון', () => {
  const mk = (total: number, id: string): any => ({
    lineupId: id, gameweekId: 'GW7', rulesetVersion: 1, players: [], bonusLines: [],
    personalPoints: 0, resultPoints: 0, captainPoints: 0, virtualPoints: 0, totalPoints: total,
  });
  assert.deepEqual(rankGameweek([mk(50,'a'), mk(70,'b'), mk(50,'c')]).map((r) => r.rank), [1, 2, 2]);
});
