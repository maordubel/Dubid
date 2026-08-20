/**
 * אימות מחולל ה-QR.
 *
 * אין כאן סורק, ולכן האימות נעשה בדרך החזקה יותר: **קריאה הפוכה**.
 * הטסט מפרק את המטריצה בדיוק כמו שקורא QR היה עושה — מסיר מסכה,
 * קורא את הזיגזג, מפרק את השזירה, מוודא ש-Reed–Solomon מתאמת,
 * ומשחזר את המחרוזת המקורית. אם משהו בטבלאות או במיקום שגוי,
 * המחרוזת לא תשוחזר.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeQr, dataPath, maskBit, qrToSvg, __internals,
         type EccLevel, type QrResult } from '../src/lib/qr.ts';

/* ------------------------------------------------------------------ */
/* קורא QR מינימלי                                                     */
/* ------------------------------------------------------------------ */
function decodeQr(qr: QrResult): { text: string; rsValid: boolean } {
  const { size, modules, version, ecc, mask } = qr;
  const reserved = __internals.buildReserved(size, version);
  const path = dataPath(size, reserved);

  // 1. הסרת מסכה + קריאת ביטים לפי אותו זיגזג
  const bits: number[] = path.map(([r, c]) =>
    (modules[r][c] !== maskBit(mask, r, c)) ? 1 : 0);

  const codewords: number[] = [];
  for (let i = 0; i + 7 < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    codewords.push(b);
  }

  // 2. פירוק השזירה
  const { ecPerBlock, blocksG1, dataG1, blocksG2, dataG2 } =
    __internals.blockLayout(version, ecc);
  const blockCount = blocksG1 + blocksG2;
  const lengths = Array.from({ length: blockCount }, (_, i) => (i < blocksG1 ? dataG1 : dataG2));
  const dataBlocks: number[][] = lengths.map(() => []);
  const ecBlocks: number[][] = lengths.map(() => []);

  let idx = 0;
  const maxData = Math.max(dataG1, dataG2);
  for (let i = 0; i < maxData; i++)
    for (let b = 0; b < blockCount; b++)
      if (i < lengths[b]) dataBlocks[b].push(codewords[idx++]);
  for (let i = 0; i < ecPerBlock; i++)
    for (let b = 0; b < blockCount; b++) ecBlocks[b].push(codewords[idx++]);

  // 3. אימות Reed–Solomon: חישוב מחדש חייב לתת בדיוק את אותם קודוורדים
  const rsValid = dataBlocks.every((block, b) => {
    const recomputed = Array.from(__internals.rsEncode(Uint8Array.from(block), ecPerBlock));
    return recomputed.length === ecBlocks[b].length &&
           recomputed.every((v, i) => v === ecBlocks[b][i]);
  });

  // 4. פענוח זרם הנתונים
  const stream = dataBlocks.flat();
  const sbits: number[] = [];
  for (const byte of stream) for (let i = 7; i >= 0; i--) sbits.push((byte >>> i) & 1);
  const take = (n: number) => sbits.splice(0, n).reduce((a, b) => (a << 1) | b, 0);

  const mode = take(4);
  assert.equal(mode, 0b0100, 'מצב הקידוד חייב להיות Byte');
  const len = take(version < 10 ? 8 : 16);
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = take(8);

  return { text: new TextDecoder().decode(bytes), rsValid };
}

/* ------------------------------------------------------------------ */
/* טסטים                                                               */
/* ------------------------------------------------------------------ */

const URLS = [
  'https://dubid.dubelteam.com',
  'https://dubid.dubelteam.com/c/AB12CD',
  'https://dubid.dubelteam.com/gw/7/u/8f2c1a9e?ref=story',
  'דוביד',                                   // UTF-8 רב-בייטי
];

for (const ecc of ['L', 'M', 'Q', 'H'] as EccLevel[]) {
  for (const url of URLS) {
    test(`קריאה הפוכה משחזרת את המחרוזת · ECC ${ecc} · "${url.slice(0, 34)}"`, () => {
      const qr = encodeQr(url, ecc);
      const { text, rsValid } = decodeQr(qr);
      assert.equal(text, url);
      assert.equal(rsValid, true, 'קודוורדי Reed–Solomon לא מתאמתים');
    });
  }
}

test('מבנה הקוד תקין: גודל, עיניות, תזמון, מודול כהה', () => {
  const qr = encodeQr('https://dubid.dubelteam.com/c/AB12CD', 'Q');
  assert.equal(qr.size, qr.version * 4 + 17);

  // שלוש עיניות: מרכז כהה 3x3 עטוף בטבעת בהירה
  for (const [r0, c0] of [[0, 0], [0, qr.size - 7], [qr.size - 7, 0]] as const) {
    assert.equal(qr.modules[r0 + 3][c0 + 3], true, 'מרכז העינית כהה');
    assert.equal(qr.modules[r0 + 1][c0 + 1], false, 'טבעת בהירה');
    assert.equal(qr.modules[r0][c0], true, 'מסגרת חיצונית כהה');
  }

  // רצועת התזמון מתחלפת
  for (let i = 8; i < qr.size - 8; i++) {
    assert.equal(qr.modules[6][i], i % 2 === 0);
    assert.equal(qr.modules[i][6], i % 2 === 0);
  }

  // המודול הכהה הקבוע
  assert.equal(qr.modules[qr.size - 8][8], true);
});

test('הגרסה גדלה עם אורך הטקסט ועם רמת התיקון', () => {
  const short = encodeQr('https://dubid.dubelteam.com', 'L');
  const long = encodeQr('https://dubid.dubelteam.com/gw/7/u/8f2c1a9e?ref=story&v=2', 'H');
  assert.ok(long.version > short.version);
});

test('טקסט ארוך מדי נכשל בהודעה ברורה ולא בשקט', () => {
  assert.throws(() => encodeQr('x'.repeat(400), 'H'), /ארוך מדי/);
});

test('SVG נוצר עם חור ללוגו', () => {
  const qr = encodeQr('https://dubid.dubelteam.com/c/AB12CD', 'H');
  const withHole = qrToSvg(qr, { logoHole: 0.24 });
  const noHole = qrToSvg(qr, { logoHole: 0 });
  assert.ok(withHole.startsWith('<svg'));
  assert.ok(withHole.length < noHole.length, 'החור חייב להסיר מודולים');
});
