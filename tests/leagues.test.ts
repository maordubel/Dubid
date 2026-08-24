/**
 * tests/leagues.test.ts — ליגות פרטיות.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JoinError, canJoin, inviteUrl, isValidCode, makeInviteCode,
  normalizeCode, standings,
  type LeagueMember, type MemberGameweek, type PrivateLeague,
} from '../src/lib/leagues.ts';
import type { LineupScore } from '../src/lib/scoring/types.ts';

const league = (over: Partial<PrivateLeague> = {}): PrivateLeague => ({
  id: 'L1', name: 'המשרד', code: 'ABC234', ownerId: 'u1',
  mode: 'five', createdAt: '2026-08-01T00:00:00Z', status: 'active',
  maxMembers: null, ...over,
});

const member = (userId: string, name = userId): LeagueMember => ({
  leagueId: 'L1', userId, displayName: name, joinedAt: '2026-08-01T00:00:00Z',
});

const score = (total: number, over: Partial<LineupScore> = {}): LineupScore => ({
  lineupId: 'x', gameweekId: 'GW1', rulesetVersion: 1,
  players: [], bonusLines: [],
  personalPoints: 0, resultPoints: 0, captainPoints: 0, virtualPoints: 0,
  totalPoints: total, ...over,
});

const gw = (userId: string, gameweekId: string, total: number, over: Partial<LineupScore> = {}): MemberGameweek => ({
  userId, gameweekId,
  score: score(total, { ...over, gameweekId }),
  submittedAt: '2026-08-01T09:00:00Z',
});

/* ---------------- קודים ---------------- */

test('קוד תקין הוא 6 תווים מהאלפבית', () => {
  const code = makeInviteCode(() => 0.5);
  assert.equal(code.length, 6);
  assert.equal(isValidCode(code), true);
});

test('★ האלפבית לא מכיל תווים מתחזים', () => {
  // קוד שמוקרא בקול בקבוצת וואטסאפ חייב להיות חד-משמעי.
  let all = '';
  for (let i = 0; i < 200; i++) all += makeInviteCode(() => i / 200);
  for (const bad of ['0', 'O', '1', 'I', 'L']) {
    assert.ok(!all.includes(bad), `הקוד מכיל ${bad}`);
  }
});

test('נרמול סובלני לרווחים, מקפים ואותיות קטנות', () => {
  assert.equal(normalizeCode('abc-234'), 'ABC234');
  assert.equal(normalizeCode(' ABC 234 '), 'ABC234');
  assert.equal(normalizeCode('abc_234'), 'ABC234');
});

test('★ נרמול לא "מתקן" תווים לא חוקיים לניחוש', () => {
  // O ו-0 לא קיימים באלפבית. מיפוי שלהם היה ניחוש שעלול לשלוח
  // משתמש לליגה של מישהו אחר — עדיף לדחות בבירור.
  assert.equal(isValidCode(normalizeCode('OOO000')), false);
  assert.equal(normalizeCode('ABCD2O'), 'ABCD2');
});

test('קישור הזמנה לא מכפיל לוכסן', () => {
  assert.equal(inviteUrl('https://dubid.app/', 'ABC234'), 'https://dubid.app/l/ABC234');
  assert.equal(inviteUrl('https://dubid.app', 'ABC234'), 'https://dubid.app/l/ABC234');
});

/* ---------------- הצטרפות ---------------- */

test('הצטרפות תקינה', () => {
  assert.deepEqual(canJoin(league(), [member('u1')], 'u2'), { ok: true });
});

test('כל סיבות הדחייה מזוהות בנפרד', () => {
  assert.equal(canJoin(undefined, [], 'u2').error, JoinError.NotFound);
  assert.equal(canJoin(league({ status: 'closed' }), [], 'u2').error, JoinError.Closed);
  assert.equal(canJoin(league(), [member('u2')], 'u2').error, JoinError.AlreadyMember);
  assert.equal(
    canJoin(league({ maxMembers: 2 }), [member('a'), member('b')], 'u2').error,
    JoinError.Full,
  );
});

test('ליגה בלי תקרה לא מתמלאת', () => {
  const many = Array.from({ length: 500 }, (_, i) => member(`u${i}`));
  assert.equal(canJoin(league({ maxMembers: null }), many, 'new').ok, true);
});

/* ---------------- טבלה ---------------- */

test('טבלה מסכמת נקודות על פני מחזורים', () => {
  const rows = standings(
    [member('a', 'אבי'), member('b', 'בני')],
    [gw('a', 'GW1', 40), gw('a', 'GW2', 30), gw('b', 'GW1', 20), gw('b', 'GW2', 60)],
    ['GW1', 'GW2'],
  );
  assert.equal(rows[0].userId, 'b');
  assert.equal(rows[0].totalPoints, 80);
  assert.equal(rows[1].totalPoints, 70);
  assert.equal(rows[0].gameweekPoints, 60, 'נקודות המחזור האחרון');
  assert.equal(rows[0].played, 2);
});

test('★ תנועת מקומות מחושבת מול המחזור הקודם', () => {
  const rows = standings(
    [member('a'), member('b')],
    // אחרי GW1: a=40 ראשון, b=20 שני. אחרי GW2: b=80 ראשון, a=70 שני.
    [gw('a', 'GW1', 40), gw('a', 'GW2', 30), gw('b', 'GW1', 20), gw('b', 'GW2', 60)],
    ['GW1', 'GW2'],
  );
  const b = rows.find((r) => r.userId === 'b')!;
  const a = rows.find((r) => r.userId === 'a')!;
  assert.equal(b.movement, 1, 'עלה מקום');
  assert.equal(a.movement, -1, 'ירד מקום');
});

test('מחזור ראשון — אין תנועה, ולא אפס מטעה', () => {
  const rows = standings([member('a'), member('b')], [gw('a', 'GW1', 10)], ['GW1']);
  assert.equal(rows[0].movement, null);
  assert.equal(rows[0].previousRank, null);
});

test('חבר שלא שיחק מופיע בטבלה עם 0 ולא נעלם', () => {
  const rows = standings([member('a'), member('ghost')], [gw('a', 'GW1', 10)], ['GW1']);
  assert.equal(rows.length, 2);
  const ghost = rows.find((r) => r.userId === 'ghost')!;
  assert.equal(ghost.totalPoints, 0);
  assert.equal(ghost.played, 0);
});

test('★ שוויון בליגה פרטית נשבר באותה היררכיה כמו בדירוג הראשי', () => {
  const rows = standings(
    [member('a'), member('b')],
    [
      gw('a', 'GW1', 50, { captainPoints: 6 }),
      gw('b', 'GW1', 50, { captainPoints: 18 }),
    ],
    ['GW1'],
  );
  assert.equal(rows[0].userId, 'b', 'הקפטן החזק יותר מנצח');
  assert.equal(rows[0].brokenBy, null);
  assert.equal(rows[1].brokenBy, 'captain', 'המסך יכול לומר "הוכרע לפי הקפטן"');
});

test('ליגה ריקה לא מפילה את המסך', () => {
  assert.deepEqual(standings([], [], ['GW1']), []);
});

test('הדירוג יציב — סדר החברים בקלט לא משנה תוצאה', () => {
  const h = [gw('a', 'GW1', 30), gw('b', 'GW1', 50), gw('c', 'GW1', 40)];
  const one = standings([member('a'), member('b'), member('c')], h, ['GW1']).map((r) => r.userId);
  const two = standings([member('c'), member('b'), member('a')], h, ['GW1']).map((r) => r.userId);
  assert.deepEqual(one, two);
  assert.deepEqual(one, ['b', 'c', 'a']);
});

test('★ אלפבית הקודים ב-SQL זהה לזה שב-TypeScript', async () => {
  // אלפבית שונה בין הצדדים = קוד שנוצר בשרת ונדחה בקליינט, או להפך.
  const fs = await import('node:fs/promises');
  const sql = await fs.readFile('db/06_private_leagues.sql', 'utf8');

  const expand = (cls: string) => {
    let out = '';
    for (let i = 0; i < cls.length; ) {
      if (cls[i + 1] === '-' && cls[i + 2]) {
        for (let c = cls.charCodeAt(i); c <= cls.charCodeAt(i + 2); c++) {
          out += String.fromCharCode(c);
        }
        i += 3;
      } else {
        out += cls[i];
        i += 1;
      }
    }
    return out;
  };

  // האלפבית של הקליינט נגזר מהקוד עצמו, לא מועתק לכאן ביד.
  const seen = new Set<string>();
  for (let i = 0; i < 400; i++) {
    for (const ch of makeInviteCode(() => i / 400)) seen.add(ch);
  }
  const tsAlphabet = [...seen].sort().join('');
  assert.ok(tsAlphabet.length > 25, 'הדגימה לא כיסתה את האלפבית');

  // 1. מחלקת התווים ב-CHECK חייבת להיות זהה לאלפבית של הקליינט.
  const check = sql.match(/code ~ '\^\[([^\]]+)\]\{6\}\$'/);
  assert.ok(check, 'לא נמצא CHECK על code');
  assert.equal([...new Set(expand(check![1]))].sort().join(''), tsAlphabet);

  // 2. גם מחלקת הנרמול ב-join_league.
  const strip = sql.match(/regexp_replace\([^,]+, '\[\^([^\]]+)\]'/);
  assert.ok(strip, 'לא נמצא נרמול קוד ב-join_league');
  assert.equal([...new Set(expand(strip![1]))].sort().join(''), tsAlphabet);

  // 3. והמחרוזת שממנה השרת מגריל.
  const gen = sql.match(/substr\('([2-9A-Z]+)'/);
  assert.ok(gen, 'לא נמצאה מחרוזת ההגרלה');
  assert.equal([...gen![1]].sort().join(''), tsAlphabet);
});
