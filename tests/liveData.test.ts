/**
 * tests/liveData.test.ts — הדאטה מהשרת באמת מחליפה את הקובץ.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ מה נשמר כאן
 * ═══════════════════════════════════════════════════════════════
 *
 * `applyLiveSquads` משנה מערכים **במקום** (`splice`), ולא מחליפה
 * אותם. זה הלב של כל המעבר: שמונה קבצים מייבאים את `TEAMS`
 * ו-`PLAYERS`, וכולם מצביעים על אותו אובייקט. השמה (`TEAMS = …`)
 * הייתה יוצרת מערך חדש שרק מודול אחד מכיר, וכל השאר היו ממשיכים
 * להציג את הקובץ הישן — כלומר בדיוק הבאג, במקום אחר.
 *
 * הבדיקות כאן מחזיקות **הפניה** למערך לפני העדכון ובודקות אותה
 * אחריו. אם מישהו יחליף `splice` בהשמה, הן ייפלו.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

(globalThis as Record<string, unknown>).window = {
  dispatchEvent() { return true; },
  addEventListener() {},
  removeEventListener() {},
};
(globalThis as Record<string, unknown>).localStorage = {
  getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0,
};

const { TEAMS, PLAYERS, TEAM_BY_ID, PLAYERS_BY_TEAM } =
  await import('../src/data/squads.ts');
const { applyLiveSquads, playerStatus, isPlayerAvailable } =
  await import('../src/lib/liveData.ts');
const fixtures = await import('../src/data/fixtures.ts');

const SEED_TEAMS = TEAMS.map((t) => ({ ...t }));
const SEED_PLAYERS = PLAYERS.map((p) => ({ ...p }));

/** מחזיר את הזרע, כדי שסדר הבדיקות לא ישנה. */
function restore() {
  applyLiveSquads({
    teams: SEED_TEAMS.map((t) => ({
      id: t.id, externalId: t.externalId, nameHe: t.nameHe, nameEn: t.nameEn,
      short: t.short, city: t.city, stadium: t.stadium,
    })),
    players: SEED_PLAYERS.map((p) => ({
      id: p.id, externalId: p.externalId, teamId: p.teamId, position: p.position,
      nameHe: p.nameHe, nameEn: p.nameEn, shirt: p.shirt, tier: p.tier,
      price: p.price, overallRank: p.overallRank, rated: p.rated,
      nationality: p.nationality, isClubCaptain: p.isClubCaptain, status: 'active',
    })),
  });
}

beforeEach(restore);

const PAYLOAD = {
  teams: [
    { id: 'T1', externalId: '1', nameHe: 'קבוצה א', nameEn: 'A',
      short: 'א', city: 'תל אביב', stadium: 'בלומפילד' },
    { id: 'T2', externalId: '2', nameHe: 'קבוצה ב', nameEn: 'B',
      short: 'ב', city: null, stadium: null },
  ],
  players: [
    { id: 'P101', externalId: '101', teamId: 'T1', position: 'GK', nameHe: 'שוער',
      nameEn: 'K', shirt: 1, tier: 2, price: 3, overallRank: 10, rated: true,
      nationality: 'ישראל', isClubCaptain: false, status: 'active' },
    { id: 'P201', externalId: '201', teamId: 'T2', position: 'FWD', nameHe: 'חלוץ',
      nameEn: 'F', shirt: 9, tier: 1, price: 5, overallRank: 2, rated: true,
      nationality: 'ברזיל', isClubCaptain: true, status: 'injured' },
  ],
  revision: 42,
};

test('★★ אותו מערך, תוכן חדש — לא מערך חדש', () => {
  const sameArray = TEAMS;              // ההפניה שכל שאר המוצר מחזיק
  const sameMap = TEAM_BY_ID;
  applyLiveSquads(PAYLOAD);

  assert.equal(sameArray, TEAMS, 'ההפניה חייבת להישאר זהה');
  assert.equal(sameArray.length, 2, 'והתוכן חייב להתחלף');
  assert.equal(sameMap.get('T1')?.nameHe, 'קבוצה א');
});

test('★ הנגזרת מתעדכנת גם היא', () => {
  const same = PLAYERS_BY_TEAM;
  applyLiveSquads(PAYLOAD);
  assert.equal(same, PLAYERS_BY_TEAM);
  assert.equal(same.length, 2);
  assert.deepEqual(same.map((g) => g.players.length), [1, 1]);
  assert.equal(same[0].team.nameHe, 'קבוצה א');
});

test('★ שדות התצוגה עוברים במלואם', () => {
  applyLiveSquads(PAYLOAD);
  const p = PLAYERS.find((x) => x.id === 'P201');
  assert.equal(p?.tier, 1);
  assert.equal(p?.price, 5);
  assert.equal(p?.nationality, 'ברזיל');
  assert.equal(p?.isClubCaptain, true);
  assert.equal(TEAMS[0].stadium, 'בלומפילד');
});

test('★ דרג לא חוקי נופל ל-3 ולא ל-NaN', () => {
  applyLiveSquads({
    ...PAYLOAD,
    players: [{ ...PAYLOAD.players[0], tier: 99 as unknown as number }],
  });
  assert.equal(PLAYERS[0].tier, 3, 'הטיפוס הוא 1..5; כרטיס עם NaN הוא כרטיס שבור');
});

test('★ מחיר חסר נופל ל-1 ולא ל-0', () => {
  applyLiveSquads({
    ...PAYLOAD,
    players: [{ ...PAYLOAD.players[0], price: null as unknown as number }],
  });
  // 0 היה הופך את השחקן לחינם ושובר את התקציב של דוביד 5.
  assert.equal(PLAYERS[0].price, 1);
});

test('★★ תשובה ריקה לא מוחקת את הליגה', () => {
  const before = TEAMS.length;
  assert.equal(applyLiveSquads({ teams: [], players: [] }), false);
  assert.equal(TEAMS.length, before, 'מסך ריק גרוע ממסך עם נתון ישן');

  assert.equal(applyLiveSquads({}), false);
  assert.equal(TEAMS.length, before);
});

test('★ סטטוס זמינות נשמר לצד השחקן, לא בתוכו', () => {
  applyLiveSquads(PAYLOAD);
  assert.equal(playerStatus('P201'), 'injured');
  assert.equal(playerStatus('P101'), 'active');
  // ★ פצוע **כן** ניתן לבחירה, עם סימון. שחקן שנעלם נראה כמו באג.
  assert.equal(isPlayerAvailable('P201'), true);
  assert.equal(isPlayerAvailable('לא-קיים'), true, 'ברירת מחדל זמין');
});

test('★ שחקן לא ידוע לא מפיל את המפה', () => {
  applyLiveSquads(PAYLOAD);
  assert.equal(playerStatus('P999'), 'active');
});

/* ================================================================== */
/* לוח משחקים                                                          */
/* ================================================================== */

test('★★ הדדליין מהשרת מחליף את המקומי — קישור חי', () => {
  const before = fixtures.GAMEWEEK_DEADLINE;
  fixtures.applyLiveFixtures({
    gameweek: {
      id: 'gw-2', number: 2, label: 'מחזור 2', status: 'open',
      lockAt: '2026-09-05T17:00:00Z', firstKickoffAt: '2026-09-05T17:00:00Z',
    },
    fixtures: [
      { id: 'm1', homeTeamId: 'T1', awayTeamId: 'T2',
        kickoff: '2026-09-05T17:00:00Z', status: 'scheduled',
        homeGoals: null, awayGoals: null },
    ],
  });
  assert.notEqual(fixtures.GAMEWEEK_DEADLINE, before);
  assert.equal(fixtures.GAMEWEEK_DEADLINE, '2026-09-05T17:00:00Z');
  assert.equal(fixtures.FIRST_KICKOFF, '2026-09-05T17:00:00Z');
  assert.equal(fixtures.GAMEWEEK.number, 2);
});

test('★ מפת היריבות נבנית מחדש ולא מצטברת', () => {
  fixtures.applyLiveFixtures({
    gameweek: null,
    fixtures: [
      { id: 'm1', homeTeamId: 'T1', awayTeamId: 'T2',
        kickoff: '2026-09-05T17:00:00Z', status: 'scheduled',
        homeGoals: null, awayGoals: null },
    ],
  });
  assert.equal(Object.keys(fixtures.OPPONENT_BY_TEAM).length, 2,
    'יריבות מלוח קודם חייבות להימחק — אחרת קבוצה "משחקת" משחק שאינו קיים');
  assert.equal(fixtures.OPPONENT_BY_TEAM.T1?.opponentId, 'T2');
  assert.equal(fixtures.OPPONENT_BY_TEAM.T2?.isHome, false);
});

test('★ הדדליין נגזר מהמוקדם ביותר כשאין מחזור בתשובה', () => {
  fixtures.applyLiveFixtures({
    gameweek: null,
    fixtures: [
      { id: 'a', homeTeamId: 'T1', awayTeamId: 'T2', kickoff: '2026-09-06T17:00:00Z',
        status: 'scheduled', homeGoals: null, awayGoals: null },
      { id: 'b', homeTeamId: 'T3', awayTeamId: 'T4', kickoff: '2026-09-05T17:00:00Z',
        status: 'scheduled', homeGoals: null, awayGoals: null },
    ],
  });
  // ★ המוקדם, לא המאוחר: אחרת מי שמחכה בוחר אחרי שראה משחק.
  assert.equal(fixtures.GAMEWEEK_DEADLINE, '2026-09-05T17:00:00Z');
});

test('★ לוח ריק לא מוחק את הלוח הקיים', () => {
  const before = fixtures.FIXTURES.length;
  assert.equal(fixtures.applyLiveFixtures({ fixtures: [] }), false);
  assert.equal(fixtures.FIXTURES.length, before);
});

test('★ יום בשבוע נגזר מהתאריך ולא מוקלד', () => {
  fixtures.applyLiveFixtures({
    gameweek: null,
    fixtures: [
      { id: 'sat', homeTeamId: 'T1', awayTeamId: 'T2',
        // שבת, 29.08.2026, 20:00 שעון ישראל
        kickoff: '2026-08-29T17:00:00Z', status: 'scheduled',
        homeGoals: null, awayGoals: null },
    ],
  });
  assert.equal(fixtures.FIXTURES[0].dayLabel, 'שבת');
});

test('★ שעת המשחק מוצגת בשעון ישראל גם כשהמכשיר ב-UTC', () => {
  assert.equal(fixtures.kickoffTimeLabel('2026-08-29T17:00:00Z'), '20:00');
  assert.equal(fixtures.kickoffDateLabel('2026-08-29T17:00:00Z'), '29.08');
});
