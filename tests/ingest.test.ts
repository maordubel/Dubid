/**
 * tests/ingest.test.ts — המתאמים, בלי רשת.
 *
 * ★ כל בדיקה כאן היא תשובה לשאלה "מה קורה כשהנתון לא מושלם":
 *   שער עצמי, מחליף שנכנס בדקה 60, כרטיס שבוטל, שני מקורות
 *   שחולקים, ושדה שהספק שינה את שמו.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  mapSofaStatus, mapFixture, goalMinutesBySide, onPitchWindows,
  cardsByPlayer, ownGoalsByPlayer, unknownEventKinds, mapMatchStats,
} from '../src/lib/ingest/sofascore.ts';
import { map365Status, parseKickoff, mapGame } from '../src/lib/ingest/scores365.ts';
import { reconcileFixtures } from '../src/lib/ingest/reconcile.ts';
import { concededWhileOn, toPosition, toShirt, isoFromUnix } from '../src/lib/ingest/derive.ts';
import type { Fixture } from '../src/lib/ingest/types.ts';

/* ------------------------------------------------------------------ */
test('סטטוס: משחק שהופסק אינו חי ואינו סופי', () => {
  assert.equal(mapSofaStatus('finished'), 'finished');
  assert.equal(mapSofaStatus('inprogress'), 'live');
  assert.equal(mapSofaStatus('postponed'), 'postponed');
  assert.equal(mapSofaStatus('suspended'), 'abandoned');
  assert.equal(mapSofaStatus('canceled'), 'abandoned');
  // ★ סטטוס שהספק המציא מחר — נחשב "טרם התחיל", לא "הסתיים".
  assert.equal(mapSofaStatus('brand_new_status'), 'scheduled');
});

test('שעה לא מפורסמת נשארת null ולא מומצאת', () => {
  assert.equal(isoFromUnix(null), null);
  assert.equal(isoFromUnix(0), null);
  assert.equal(isoFromUnix(1789407000), '2026-09-14T17:30:00.000Z');
});

test('עמדה לא מוכרת מחזירה null במקום ניחוש', () => {
  assert.equal(toPosition('G'), 'GK');
  assert.equal(toPosition('m'), 'MID');
  assert.equal(toPosition('שוער'), 'GK');
  assert.equal(toPosition('winger'), null);
  assert.equal(toPosition(undefined), null);
});

test('מספר חולצה: 0 וריק אינם מספרים', () => {
  assert.equal(toShirt(77), 77);
  assert.equal(toShirt('9'), 9);
  assert.equal(toShirt(0), null);
  assert.equal(toShirt(''), null);
  assert.equal(toShirt(123), null);
});

/* ------------------------------------------------------------------ */
test('שער עצמי נזקף לצד שהתוצאה שלו עלתה, לא לדגל הצד', () => {
  const incidents = [
    { incidentType: 'goal', time: 10, homeScore: 1, awayScore: 0, isHome: true },
    // שער עצמי של הבית → התוצאה של החוץ עולה
    { incidentType: 'goal', incidentClass: 'ownGoal', time: 40,
      homeScore: 1, awayScore: 1, isHome: true, player: { id: 5 } },
    { incidentType: 'goal', time: 70, homeScore: 1, awayScore: 2, isHome: false },
  ];
  const { home, away } = goalMinutesBySide(incidents);
  assert.deepEqual(home, [10]);
  assert.deepEqual(away, [40, 70], 'השער העצמי נספר כשער של היריבה');
  assert.equal(ownGoalsByPlayer(incidents).get('5'), 1);
});

test('ספיגות נספרות רק בזמן שהשחקן על המגרש', () => {
  const incidents = [
    { incidentType: 'substitution', time: 60, playerIn: { id: 2 }, playerOut: { id: 1 } },
  ];
  const windows = onPitchWindows(incidents, new Set(['1']));
  const opponentGoals = [15, 75];

  assert.equal(concededWhileOn(windows.get('1')!, opponentGoals), 1, 'הפותח ספג רק את ה-15');
  assert.equal(concededWhileOn(windows.get('2')!, opponentGoals), 1, 'המחליף ספג רק את ה-75');
});

test('שער בדקת ההחלפה נספר לשניהם — הגבול סגור', () => {
  const windows = onPitchWindows(
    [{ incidentType: 'substitution', time: 45, playerIn: { id: 2 }, playerOut: { id: 1 } }],
    new Set(['1']),
  );
  assert.equal(concededWhileOn(windows.get('1')!, [45]), 1);
  assert.equal(concededWhileOn(windows.get('2')!, [45]), 1);
});

test('כרטיס שבוטל אינו נספר', () => {
  const cards = cardsByPlayer([
    { incidentType: 'card', incidentClass: 'yellow', player: { id: 7 }, rescinded: false },
    { incidentType: 'card', incidentClass: 'red',    player: { id: 8 }, rescinded: true },
    { incidentType: 'card', incidentClass: 'yellowRed', player: { id: 9 } },
  ]);
  assert.deepEqual(cards.get('7'), { yellow: 1, red: 0 });
  assert.equal(cards.get('8'), undefined, 'כרטיס מבוטל לא הופיע כלל');
  assert.deepEqual(cards.get('9'), { yellow: 1, red: 1 });
});

test('אירוע שהמתאם לא מכיר מדווח ולא נבלע', () => {
  const kinds = unknownEventKinds([
    { incidentType: 'goal' }, { incidentType: 'somethingNew' }, { incidentType: 'card' },
  ]);
  assert.deepEqual(kinds, ['somethingNew']);
});

/* ------------------------------------------------------------------ */
const FIXTURE: Fixture = {
  providerId: 'M1',
  home: { id: 'H', nameEn: 'Maccabi Tel Aviv' },
  away: { id: 'A', nameEn: 'Hapoel Tel Aviv' },
  kickoff: '2026-09-14T17:30:00.000Z',
  status: 'finished',
  homeGoals: 2, awayGoals: 1,
};

test('משחק שלם → שורות שחקנים, כולל VAR כהתרעה חוסמת', () => {
  const lineups = {
    home: { players: [
      { player: { id: 100, name: 'Keeper One' }, shirtNumber: 1, position: 'G',
        substitute: false, statistics: { minutesPlayed: 90, saves: 4, rating: 7.1 } },
      { player: { id: 101, name: 'Scorer Two' }, shirtNumber: 9, position: 'F',
        substitute: false, statistics: { minutesPlayed: 90, goals: 2, goalAssist: 1,
          totalShots: 5, onTargetScoringAttempt: 3, keyPass: 2 } },
    ] },
    away: { players: [
      { player: { id: 200, name: 'Away Back' }, shirtNumber: 4, position: 'D',
        substitute: false, statistics: { minutesPlayed: 90 } },
      // ★ שחקן בלי דקות ובלי סטטיסטיקה = ספסל שלא נכנס. לא שורה.
      { player: { id: 201, name: 'Bench Guy' }, shirtNumber: 21, position: 'M',
        substitute: true, statistics: {} },
    ] },
  };
  const incidents = { incidents: [
    { incidentType: 'goal', time: 20, homeScore: 1, awayScore: 0, player: { id: 101 } },
    { incidentType: 'goal', time: 55, homeScore: 1, awayScore: 1, player: { id: 200 } },
    { incidentType: 'goal', time: 80, homeScore: 2, awayScore: 1, player: { id: 101 } },
    { incidentType: 'card', incidentClass: 'yellow', time: 30, player: { id: 200 } },
    { incidentType: 'varDecision', time: 62 },
  ] };

  const { stats, alerts } = mapMatchStats(FIXTURE, lineups, incidents);

  assert.equal(stats.length, 3, 'ספסלי שלא נכנס אינו שורה');

  const scorer = stats.find((s) => s.player.id === '101')!;
  assert.equal(scorer.goals, 2);
  assert.equal(scorer.assists, 1);
  assert.equal(scorer.goalsConceded, 1, 'הבית ספג אחד');
  assert.equal(scorer.extra?.shotsOnTarget, 3);
  assert.equal(scorer.extra?.providerRating, null, 'דירוג הספק אינו מגיע כשהוא לא קיים');

  const keeper = stats.find((s) => s.player.id === '100')!;
  assert.equal(keeper.saves, 4);
  assert.equal(keeper.extra?.providerRating, 7.1, 'הדירוג נשמר כמטא־דאטה בלבד');

  const back = stats.find((s) => s.player.id === '200')!;
  assert.equal(back.yellowCards, 1);
  assert.equal(back.goalsConceded, 2, 'החוץ ספגה שניים');

  assert.equal(alerts.filter((a) => a.kind === 'var' && a.severity === 'block').length, 1);
});

/* ------------------------------------------------------------------ */
test('מקור גיבוי: כל מה שלא ודאי "הסתיים" נשאר scheduled', () => {
  assert.equal(map365Status({ statusGroup: 4 }), 'finished');
  assert.equal(map365Status({ winner: 1 }), 'finished');
  assert.equal(map365Status({ statusGroup: 3 }), 'live');
  assert.equal(map365Status({ statusGroup: 99 }), 'scheduled');
  assert.equal(map365Status({}), 'scheduled');
});

test('מקור גיבוי: שם עברי נשמר, שעה לא קריאה היא null', () => {
  const f = mapGame({
    id: 55, startTime: 'לא תאריך',
    homeCompetitor: { id: 1, name: 'מכבי תל אביב', score: 2 },
    awayCompetitor: { id: 2, name: 'הפועל תל אביב', score: 1 },
    statusGroup: 4,
  })!;
  assert.equal(f.home.nameHe, 'מכבי תל אביב');
  assert.equal(f.kickoff, null);
  assert.equal(f.status, 'finished');
  assert.equal(parseKickoff('2026-09-14T17:30:00Z'), '2026-09-14T17:30:00.000Z');
});

test('שני מקורות שחולקים על תוצאה — התרעה חוסמת', () => {
  const primary: Fixture[] = [FIXTURE];
  const backup: Fixture[] = [{ ...FIXTURE, providerId: 'X9', homeGoals: 3 }];

  const rec = reconcileFixtures(primary, backup);
  assert.equal(rec.compared, 1);
  assert.equal(rec.agreed, 0);
  assert.equal(rec.alerts[0].kind, 'source_disagreement');
  assert.equal(rec.alerts[0].severity, 'block');
});

test('מקור שעדיין מציג משחק חי אינו "חולק"', () => {
  const rec = reconcileFixtures([FIXTURE], [{ ...FIXTURE, status: 'live', homeGoals: 1 }]);
  assert.equal(rec.compared, 0);
  assert.equal(rec.alerts.length, 0);
});

test('mapFixture מוותר על אירוע בלי מזהה', () => {
  assert.equal(mapFixture({}), null);
  const f = mapFixture({
    id: 16364245, startTimestamp: 1789407000,
    status: { type: 'finished' },
    homeTeam: { id: 5198, name: 'Maccabi Tel Aviv' },
    awayTeam: { id: 5197, name: 'Hapoel Tel Aviv' },
    homeScore: { current: 4 }, awayScore: { current: 1 },
  })!;
  assert.equal(f.providerId, '16364245');
  assert.equal(f.home.id, '5198');
  assert.equal(f.homeGoals, 4);
});
