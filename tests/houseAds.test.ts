/**
 * tests/houseAds.test.ts — מנוע הפרסום הפנימי.
 *
 * ★ שלוש קטגוריות של באגים נשמרות כאן:
 *   · מודעה שמוצגת כשאסור (חלון, כיבוי, מסך)
 *   · סבב שחוזר על עצמו או שאינו יציב
 *   · קישור שמאבד את שיוך המקור
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BRANDS, DEFAULT_ADS, adAt, adIssues, eligibleAds, houseUrl, inWindow,
  rotation, seedOf, type HouseAd,
} from '../src/lib/houseAds.ts';

const NOW = Date.parse('2026-09-01T12:00:00Z');

function ad(over: Partial<HouseAd> = {}): HouseAd {
  return {
    id: 'a', brand: 'offsides', enabled: true, weight: 5,
    headline: 'כותרת', body: 'גוף', cta: 'קדימה',
    url: 'https://offsides.dubelteam.com',
    placements: [], startsAt: null, endsAt: null, ...over,
  };
}

/* ---------------- כשירות ---------------- */

test('ברירות המחדל תקינות — כולן', () => {
  for (const a of DEFAULT_ADS) {
    assert.deepEqual(adIssues(a), [], `${a.id}: ${adIssues(a).join(', ')}`);
  }
  assert.equal(new Set(DEFAULT_ADS.map((a) => a.id)).size, DEFAULT_ADS.length);
});

test('★ שני המותגים מיוצגים — אחרת הסבב הוא מותג אחד עם שני ניסוחים', () => {
  const brands = new Set(DEFAULT_ADS.map((a) => a.brand));
  assert.ok(brands.has('takemeout'), 'אין מודעת טייק מי אאוט');
  assert.ok(brands.has('offsides'), 'אין מודעת אופסיידס');
});

test('★★ חלון תצוגה — כולל תאריך פגום', () => {
  /*
   * ★ הבאג: תאריך שלא נפרס.
   *
   * `Date.parse('מחר')` מחזיר NaN, וכל השוואה עם NaN היא `false`.
   * מימוש נאיבי (`nowMs < NaN` → false → "בתוך החלון") היה מציג
   * לנצח מודעה שהוגדרה לחלון פגום — כלומר קמפיין שפג תוקפו
   * ממשיך לרוץ, וזה סוג התקלה שאיש לא מבחין בה חודשיים.
   *
   * הכלל: תאריך פגום = לא מוצג.
   */
  assert.equal(inWindow(ad(), NOW), true);
  assert.equal(inWindow(ad({ startsAt: '2026-10-01T00:00:00Z' }), NOW), false);
  assert.equal(inWindow(ad({ endsAt: '2026-08-01T00:00:00Z' }), NOW), false);
  assert.equal(inWindow(ad({ startsAt: 'לא תאריך' }), NOW), false);
  assert.equal(inWindow(ad({ endsAt: '???' }), NOW), false);
});

test('מודעה מכובה או במשקל אפס לא מוצגת', () => {
  assert.equal(eligibleAds([ad({ enabled: false })], 'lobby', NOW).length, 0);
  assert.equal(eligibleAds([ad({ weight: 0 })], 'lobby', NOW).length, 0);
});

test('★ רשימת מסכים ריקה = בכל מקום, ולא בשום מקום', () => {
  /* ההיפוך הזה הוא באג של תו אחד (`includes` בלי בדיקת אורך),
     והוא היה מכבה את **כל** הפרסום בבת אחת. */
  assert.equal(eligibleAds([ad({ placements: [] })], 'rules', NOW).length, 1);
  assert.equal(eligibleAds([ad({ placements: ['lobby'] })], 'rules', NOW).length, 0);
  assert.equal(eligibleAds([ad({ placements: ['rules'] })], 'rules', NOW).length, 1);
});

test('הסדר יציב גם כשהשרת מחזיר שורות בסדר אחר', () => {
  const a = ad({ id: 'b' });
  const b = ad({ id: 'a' });
  assert.deepEqual(eligibleAds([a, b], 'lobby', NOW).map((x) => x.id), ['a', 'b']);
  assert.deepEqual(eligibleAds([b, a], 'lobby', NOW).map((x) => x.id), ['a', 'b']);
});

/* ---------------- הסבב ---------------- */

test('★★ הסבב לא מציג את אותה מודעה פעמיים ברצף — במאגר האמיתי', () => {
  /*
   * ★ הבאג שזה תופס: פרישת משקלים נאיבית.
   *
   * `[...Array(weight)].fill(ad)` מייצרת [א,א,א,א,א,ב,ב,ב]. עם
   * החלפה כל תשע שניות, המשתמש רואה את אותה מודעה 45 שניות
   * ברצף — כלומר בדיוק החשיפה החוזרת שהסבב נועד למנוע, ובנוסף
   * זה נראה כמו תקלה.
   *
   * ★★ והבדיקה כוללת את המעבר מסוף הרשימה לתחילתה.
   *   הסבב מחזורי. רשימה שנגמרת ב-א ומתחילה ב-א היא חזרה
   *   צמודה שקורית פעם בכל סבב מלא — כלומר הבאג היחיד כאן
   *   שאי אפשר לראות בבדיקה שבודקת רק זוגות סמוכים.
   */
  const seq = rotation(DEFAULT_ADS);
  for (let i = 1; i < seq.length; i++) {
    assert.notEqual(seq[i].id, seq[i - 1].id, `חזרה ברצף במקום ${i}: ${seq.map((x) => x.id)}`);
  }
  assert.notEqual(seq[0].id, seq[seq.length - 1].id, 'חזרה בגלישה מסוף הסבב לתחילתו');
});

test('★ משקל דומיננטי — חזרה מותרת, אבל מינימלית', () => {
  /*
   * 5 מול 2: אין שום סידור של שבעה איברים בלי חזרה כשאחד מהם
   * מופיע חמש פעמים. זו מתמטיקה, לא באג — ראו את ההערה
   * ב-`rotation`. מה שכן נדרש: שהחזרות יהיו **המינימום
   * האפשרי**, כלומר max - (סכום השאר) - 1 = 2.
   */
  const seq = rotation([ad({ id: 'a', weight: 5 }), ad({ id: 'b', weight: 2 })]);
  let repeats = 0;
  for (let i = 1; i < seq.length; i++) if (seq[i].id === seq[i - 1].id) repeats++;
  assert.equal(repeats, 2, `${repeats} חזרות במקום 2: ${seq.map((x) => x.id)}`);
});

test('הסבב מכבד משקלים', () => {
  const seq = rotation([ad({ id: 'a', weight: 6 }), ad({ id: 'b', weight: 2 })]);
  const a = seq.filter((x) => x.id === 'a').length;
  const b = seq.filter((x) => x.id === 'b').length;
  assert.ok(a > b, `משקל 6 חייב להופיע יותר מ-2 (${a} מול ${b})`);
});

test('★ הבחירה דטרמיניסטית — אותו קלט, אותה מודעה', () => {
  const pool = eligibleAds(DEFAULT_ADS, 'lobby', NOW);
  const seed = seedOf('lobby:2');
  for (let t = 0; t < 12; t++) {
    assert.equal(adAt(pool, seed, t)?.id, adAt(pool, seed, t)?.id);
  }
  assert.equal(seedOf('lobby:2'), seedOf('lobby:2'));
  assert.notEqual(seedOf('lobby:2'), seedOf('rules:2'));
});

test('★ שני מסכים באותו ביקור לא פותחים באותה מודעה', () => {
  /* אחרת המשתמש שעובר מהלובי לדירוג רואה את אותה שורה פעמיים
     בעשר שניות, וזה נקרא כרדיפה. */
  const pool = eligibleAds(DEFAULT_ADS, 'lobby', NOW);
  const a = adAt(pool, seedOf('lobby:2'), 0)?.id;
  const b = adAt(pool, seedOf('leaderboard:2'), 0)?.id;
  assert.notEqual(a, b);
});

test('מאגר ריק מחזיר null ולא זורק', () => {
  assert.equal(adAt([], 1, 0), null);
  assert.equal(adAt([], 1, 99), null);
});

test('אינדקס שלילי או ענק לא יוצא מהמערך', () => {
  const pool = eligibleAds(DEFAULT_ADS, 'lobby', NOW);
  for (const seed of [0, 1, 999999, 2 ** 31]) {
    for (const tick of [0, 7, 1000]) {
      assert.ok(adAt(pool, seed, tick), `seed=${seed} tick=${tick}`);
    }
  }
});

/* ---------------- הקישור ---------------- */

test('★★ הקישור נושא שיוך מלא — ובלי שום מזהה אישי', () => {
  const u = new URL(houseUrl(DEFAULT_ADS[0], 'lobby', 7));
  assert.equal(u.searchParams.get('ref'), 'dubid');
  assert.equal(u.searchParams.get('src'), 'lobby');
  assert.equal(u.searchParams.get('v'), DEFAULT_ADS[0].id);
  assert.equal(u.searchParams.get('gw'), '7');
  /* ★ הבדיקה שהכי חשובה כאן: אין מזהה משתמש. אף פעם. */
  for (const key of ['uid', 'user', 'email', 'id', 'code']) {
    assert.equal(u.searchParams.get(key), null, `דלף ${key} לכתובת`);
  }
});

test('★ כתובת פגומה שהוקלדה בלוח הניהול לא מפילה את המסך', () => {
  const bad = ad({ url: 'לא כתובת' });
  const out = houseUrl(bad, 'lobby', 1);
  assert.equal(out, BRANDS.offsides.url);
});

test('הקישורים מצביעים לסאבדומיינים הנכונים', () => {
  assert.match(BRANDS.takemeout.url, /^https:\/\/takemeout\.dubelteam\.com$/);
  assert.match(BRANDS.offsides.url, /^https:\/\/offsides\.dubelteam\.com$/);
});

/* ---------------- ולידציה ---------------- */

test('★ ולידציה חוסמת בדיוק את מה שהמסד חוסם', () => {
  assert.ok(adIssues({ ...ad(), headline: '' }).length > 0);
  assert.ok(adIssues({ ...ad(), headline: 'x'.repeat(61) }).length > 0);
  assert.ok(adIssues({ ...ad(), body: 'x'.repeat(121) }).length > 0);
  assert.ok(adIssues({ ...ad(), weight: 0 }).length > 0);
  assert.ok(adIssues({ ...ad(), weight: 11 }).length > 0);
  assert.ok(adIssues({ ...ad(), url: 'http://x.com' }).length > 0, 'http חייב להיחסם');
  assert.ok(adIssues({ ...ad(), startsAt: '2026-09-02T00:00:00Z', endsAt: '2026-09-01T00:00:00Z' })
    .length > 0, 'חלון הפוך חייב להיחסם');
  assert.deepEqual(adIssues(ad()), []);
});
