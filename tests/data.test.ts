/**
 * טסטים לדאטה של הסגלים — הדברים שנשברים בשקט כשמעדכנים את הקובץ.
 *   node --experimental-strip-types --test tests/data.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LEAGUE, TEAMS, PLAYERS, TEAM_BY_ID, shortName,
         LEAGUE_TEAM_COUNT_REAL } from '../src/data/squads.ts';
import { resolveRules, IL_PREMIER } from '../src/lib/scoring/rules.ts';
import { checkLeagueCapacity } from '../src/lib/scoring/validate.ts';
import { createEmptyLineup } from '../src/lib/lineup.ts';
import { validateLineup, teamCoverage } from '../src/lib/scoring/validate.ts';
import type { Position } from '../src/lib/scoring/types.ts';

test('הליגה והעונה נטענו', () => {
  assert.equal(LEAGUE.code, 'IL_PREMIER');
  assert.match(LEAGUE.season, /^\d{4}\/\d{4}$/);
});

test('כל שחקן משויך לקבוצה קיימת ולעמדה חוקית', () => {
  const valid: Position[] = ['GK', 'DEF', 'MID', 'FWD'];
  for (const p of PLAYERS) {
    assert.ok(TEAM_BY_ID.has(p.teamId), `${p.nameHe}: קבוצה לא קיימת ${p.teamId}`);
    assert.ok(valid.includes(p.position), `${p.nameHe}: עמדה לא חוקית ${p.position}`);
    assert.ok(p.nameHe.length > 1 && p.nameEn.length > 1);
  }
});

test('אין מזהי שחקן או קבוצה כפולים', () => {
  assert.equal(new Set(PLAYERS.map((p) => p.id)).size, PLAYERS.length);
  assert.equal(new Set(TEAMS.map((t) => t.id)).size, TEAMS.length);
});

test('לכל קבוצה יש קיצור ייחודי לתצוגה', () => {
  const shorts = TEAMS.map((t) => t.short);
  assert.equal(new Set(shorts).size, shorts.length, `קיצורים כפולים: ${shorts}`);
  for (const s of shorts) assert.ok(s.length <= 4, `קיצור ארוך מדי: ${s}`);
});

test('shortName מחזיר שם משפחה', () => {
  assert.equal(shortName('עומר גלזר'), 'גלזר');
  assert.equal(shortName('פדראו'), 'פדראו');
});

test('כל 14 הקבוצות עלו — ההרכב המלא של 11 פעיל, לא מצב הדגמה', () => {
  // הטסט הישן כאן תיעד במפורש שחסרות קבוצות ("★ אזהרה"). מאז עלו כל
  // 14 קבוצות ליגת העל האמיתיות, וזה בדיוק הרגע שהאזהרה ניבאה: הטסט
  // הזה מוודא שהמעבר למצב המלא קרה בפועל ולא נשאר תקוע ב"הדגמה".
  assert.equal(TEAMS.length, LEAGUE_TEAM_COUNT_REAL,
    `יש ${TEAMS.length} קבוצות, ליגת העל האמיתית מונה ${LEAGUE_TEAM_COUNT_REAL}`);

  const issue = checkLeagueCapacity(TEAMS.length, IL_PREMIER);
  assert.equal(issue, null, 'עם 14 קבוצות ומקסימום שחקן אחד לקבוצה, 11 שחקנים אפשריים בלי מצב הדגמה');
});

test('ההרכב המלא: 11 שחקנים, שחקן אחד מכל קבוצה, בלי מצב הדגמה', () => {
  const r = resolveRules(TEAMS.length);
  assert.equal(r.isDemo, false);
  assert.equal(r.rules.constraints.maxPlayersPerTeam, 1);
  assert.equal(r.rules.constraints.lineupSize, 11);
});

test('לכל קבוצה יש לפחות שוער אחד ומספיק שחקנים לכל עמדה', () => {
  for (const t of TEAMS) {
    const squad = PLAYERS.filter((p) => p.teamId === t.id);
    assert.ok(squad.some((p) => p.position === 'GK'), `${t.nameHe}: אין שוער בסגל`);
    assert.ok(squad.length >= 11, `${t.nameHe}: סגל קטן מדי (${squad.length})`);
  }
});

test('אפשר להרכיב הרכב חוקי מהדאטה שקיים', () => {
  const r = resolveRules(TEAMS.length);
  const formation = r.rules.constraints.formationAllowed[0];
  const lineup = createEmptyLineup(formation, {
    lineupId: 'L', userId: 'U', gameweekId: 'GW1',
  });

  // מילוי חמדני: לכל משבצת, השחקן הראשון בעמדה מקבוצה שעוד לא נלקחה
  const taken = new Set<string>();
  for (const slot of lineup.slots) {
    const pick = PLAYERS.find((p) => p.position === slot.position && !taken.has(p.teamId));
    assert.ok(pick, `אין שחקן פנוי לעמדה ${slot.position}`);
    taken.add(pick!.teamId);
    slot.playerId = pick!.id;
    slot.teamId = pick!.teamId;
  }
  lineup.slots[0].isCaptain = true;

  assert.deepEqual(validateLineup(lineup, r.rules), []);

  const cov = teamCoverage(lineup, TEAMS.map((t) => t.id), r.rules);
  assert.equal(cov.filter((c) => c.filled).length, r.rules.constraints.lineupSize);
});

test('הרכב ריק לא עובר ולידציה (משבצות ריקות אינן שחקנים)', () => {
  const r = resolveRules(TEAMS.length);
  const empty = createEmptyLineup(r.rules.constraints.formationAllowed[0], {
    lineupId: 'L', userId: 'U', gameweekId: 'GW1',
  });
  const issues = validateLineup(empty, r.rules);
  assert.ok(issues.length > 0);
  assert.ok(issues.some((i) => i.code === 'lineup_size'));
});
