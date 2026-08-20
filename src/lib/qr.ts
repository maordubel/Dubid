/**
 * qr.ts — מחולל QR ללא שום תלות חיצונית.
 *
 * למה לכתוב את זה ולא להתקין ספרייה?
 * כרטיס השיתוף חייב להיווצר גם כשהמשתמש באצטדיון בלי קליטה, וכל
 * תלות חיצונית בכרטיס הזה היא נקודת כשל בדיוק ברגע הכי ויראלי.
 * 6KB של קוד מול שרשרת תלויות — הבחירה קלה.
 *
 * תמיכה: Byte mode (UTF-8), גרסאות 1–10, כל ארבע רמות ה-ECC.
 * זה מספיק בנוחות לכתובת כמו https://dubid.dubelteam.com/c/AB12CD.
 *
 * ל-QR שיושב במרכזו לוגו — השתמשו ב-ECC 'Q' או 'H'.
 */

export type EccLevel = 'L' | 'M' | 'Q' | 'H';

export interface QrResult {
  size: number;
  /** modules[row][col] — true = מודול כהה */
  modules: boolean[][];
  version: number;
  ecc: EccLevel;
  mask: number;
}

/* ------------------------------------------------------------------ */
/* טבלאות                                                              */
/* ------------------------------------------------------------------ */

/** סך קודוורדים לגרסה (1–10) */
const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

/** [ecPerBlock, blocksG1, dataPerBlockG1, blocksG2, dataPerBlockG2] */
const EC_TABLE: Record<EccLevel, number[][]> = {
  L: [
    [7, 1, 19, 0, 0], [10, 1, 34, 0, 0], [15, 1, 55, 0, 0], [20, 1, 80, 0, 0],
    [26, 1, 108, 0, 0], [18, 2, 68, 0, 0], [20, 2, 78, 0, 0], [24, 2, 97, 0, 0],
    [30, 2, 116, 0, 0], [18, 2, 68, 2, 69],
  ],
  M: [
    [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0],
    [24, 2, 43, 0, 0], [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39],
    [22, 3, 36, 2, 37], [26, 4, 43, 1, 44],
  ],
  Q: [
    [13, 1, 13, 0, 0], [22, 1, 22, 0, 0], [18, 2, 17, 0, 0], [26, 2, 24, 0, 0],
    [18, 2, 15, 2, 16], [24, 4, 19, 0, 0], [18, 2, 14, 4, 15], [22, 4, 18, 2, 19],
    [20, 4, 16, 4, 17], [24, 6, 19, 2, 20],
  ],
  H: [
    [17, 1, 9, 0, 0], [28, 1, 16, 0, 0], [22, 2, 13, 0, 0], [16, 4, 9, 0, 0],
    [22, 2, 11, 2, 12], [28, 4, 15, 0, 0], [26, 4, 13, 1, 14], [26, 4, 14, 2, 15],
    [24, 4, 12, 4, 13], [28, 6, 15, 2, 16],
  ],
};

/** מרכזי דפוסי היישור לפי גרסה */
const ALIGN_CENTERS: number[][] = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

const ECC_BITS: Record<EccLevel, number> = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

/* ------------------------------------------------------------------ */
/* אריתמטיקה בשדה גלואה GF(256)                                        */
/* ------------------------------------------------------------------ */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initGf() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // הפולינום הפרימיטיבי של QR
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const gfMul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** פולינום הגנרטור של Reed–Solomon בדרגה `degree` */
function rsGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** קודוורדי תיקון שגיאות לבלוק נתונים */
export function rsEncode(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGenerator(ecLen);
  const res = new Uint8Array(data.length + ecLen);
  res.set(data);
  for (let i = 0; i < data.length; i++) {
    const factor = res[i];
    if (factor === 0) continue;
    for (let j = 0; j < gen.length; j++) res[i + j] ^= gfMul(gen[j], factor);
  }
  return res.slice(data.length);
}

/* ------------------------------------------------------------------ */
/* זרם הביטים                                                          */
/* ------------------------------------------------------------------ */

class BitBuffer {
  bits: number[] = [];
  put(value: number, length: number) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
  get length() { return this.bits.length; }
  toBytes(): Uint8Array {
    const out = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((b, i) => { if (b) out[i >> 3] |= 0x80 >> (i & 7); });
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

export function encodeQr(text: string, ecc: EccLevel = 'Q'): QrResult {
  const data = new TextEncoder().encode(text);

  // 1. הגרסה הקטנה ביותר שמכילה את המידע
  let version = -1;
  for (let v = 1; v <= 10; v++) {
    const [ecPer, g1, d1, g2, d2] = EC_TABLE[ecc][v - 1];
    const dataCapacity = g1 * d1 + g2 * d2;
    const lenBits = v < 10 ? 8 : 16;
    if (4 + lenBits + data.length * 8 <= dataCapacity * 8) { version = v; break; }
    void ecPer;
  }
  if (version < 0) {
    throw new Error(`QR: הטקסט ארוך מדי לגרסאות 1–10 ברמת ${ecc} (${data.length} בייטים)`);
  }

  const [ecPerBlock, blocksG1, dataG1, blocksG2, dataG2] = EC_TABLE[ecc][version - 1];
  const totalData = blocksG1 * dataG1 + blocksG2 * dataG2;

  // 2. זרם הביטים: מצב + אורך + נתונים + סיום + ריפוד
  const bb = new BitBuffer();
  bb.put(0b0100, 4);                              // Byte mode
  bb.put(data.length, version < 10 ? 8 : 16);
  for (const byte of data) bb.put(byte, 8);
  const capacityBits = totalData * 8;
  bb.put(0, Math.min(4, capacityBits - bb.length)); // terminator
  while (bb.length % 8 !== 0) bb.put(0, 1);
  const bytes = Array.from(bb.toBytes());
  const PAD = [0xec, 0x11];
  for (let i = 0; bytes.length < totalData; i++) bytes.push(PAD[i % 2]);

  // 3. חלוקה לבלוקים + ECC לכל בלוק
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (let i = 0; i < blocksG1 + blocksG2; i++) {
    const len = i < blocksG1 ? dataG1 : dataG2;
    const block = bytes.slice(offset, offset + len);
    offset += len;
    dataBlocks.push(block);
    ecBlocks.push(Array.from(rsEncode(Uint8Array.from(block), ecPerBlock)));
  }

  // 4. שזירה (interleaving)
  const interleaved: number[] = [];
  const maxData = Math.max(dataG1, dataG2);
  for (let i = 0; i < maxData; i++) {
    for (const block of dataBlocks) if (i < block.length) interleaved.push(block[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of ecBlocks) interleaved.push(block[i]);
  }
  if (interleaved.length !== TOTAL_CODEWORDS[version - 1]) {
    throw new Error(
      `QR: אי-התאמה בטבלאות — ${interleaved.length} קודוורדים במקום ${TOTAL_CODEWORDS[version - 1]}`,
    );
  }

  // 5. בניית המטריצה + בחירת מסכה
  const size = version * 4 + 17;
  const reserved = buildReserved(size, version);
  const base = buildFunctionPatterns(size, version);

  let best: { mask: number; modules: boolean[][]; penalty: number } | null = null;
  for (let mask = 0; mask < 8; mask++) {
    const modules = base.map((row) => row.slice());
    placeData(modules, reserved, interleaved, size, mask);
    placeFormat(modules, size, ecc, mask);
    if (version >= 7) placeVersion(modules, size, version);
    const penalty = scorePenalty(modules, size);
    if (!best || penalty < best.penalty) best = { mask, modules, penalty };
  }

  return { size, modules: best!.modules, version, ecc, mask: best!.mask };
}

/* ------------------------------------------------------------------ */
/* דפוסי פונקציה                                                       */
/* ------------------------------------------------------------------ */

function buildReserved(size: number, version: number): boolean[][] {
  const r: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (row: number, col: number, w: number, h: number) => {
    for (let i = 0; i < h; i++)
      for (let j = 0; j < w; j++) {
        const rr = row + i, cc = col + j;
        if (rr >= 0 && rr < size && cc >= 0 && cc < size) r[rr][cc] = true;
      }
  };

  // עינית + מפריד + פורמט, בשלוש הפינות
  mark(0, 0, 9, 9);
  mark(0, size - 8, 8, 9);
  mark(size - 8, 0, 9, 8);
  // תזמון
  for (let i = 0; i < size; i++) { r[6][i] = true; r[i][6] = true; }
  // יישור
  const centers = ALIGN_CENTERS[version - 1];
  for (const rowC of centers)
    for (const colC of centers) {
      if ((rowC === 6 && colC === 6) ||
          (rowC === 6 && colC === size - 7) ||
          (rowC === size - 7 && colC === 6)) continue;
      mark(rowC - 2, colC - 2, 5, 5);
    }
  // מידע גרסה
  if (version >= 7) {
    mark(size - 11, 0, 6, 3);
    mark(0, size - 11, 3, 6);
  }
  return r;
}

function buildFunctionPatterns(size: number, version: number): boolean[][] {
  const m: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));

  const finder = (row: number, col: number) => {
    for (let i = -1; i <= 7; i++)
      for (let j = -1; j <= 7; j++) {
        const rr = row + i, cc = col + j;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const inRing = (i >= 0 && i <= 6 && (j === 0 || j === 6)) ||
                       (j >= 0 && j <= 6 && (i === 0 || i === 6));
        const inCore = i >= 2 && i <= 4 && j >= 2 && j <= 4;
        m[rr][cc] = inRing || inCore;
      }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    m[6][i] = i % 2 === 0;
    m[i][6] = i % 2 === 0;
  }

  const centers = ALIGN_CENTERS[version - 1];
  for (const rowC of centers)
    for (const colC of centers) {
      if ((rowC === 6 && colC === 6) ||
          (rowC === 6 && colC === size - 7) ||
          (rowC === size - 7 && colC === 6)) continue;
      for (let i = -2; i <= 2; i++)
        for (let j = -2; j <= 2; j++) {
          m[rowC + i][colC + j] = Math.max(Math.abs(i), Math.abs(j)) !== 1;
        }
    }

  m[size - 8][8] = true; // המודול הכהה הקבוע
  return m;
}

/** תבנית הזיגזג — משותפת לכתיבה ולקריאה (זה מה שמאפשר לאמת את המחולל) */
export function dataPath(size: number, reserved: boolean[][]): Array<[number, number]> {
  const path: Array<[number, number]> = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // עמודת התזמון מדולגת
    for (let v = 0; v < size; v++) {
      const row = upward ? size - 1 - v : v;
      for (let c = 0; c < 2; c++) {
        const col = right - c;
        if (!reserved[row][col]) path.push([row, col]);
      }
    }
    upward = !upward;
  }
  return path;
}

export function maskBit(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0: return (row + col) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
}

function placeData(
  modules: boolean[][], reserved: boolean[][],
  codewords: number[], size: number, mask: number,
): void {
  const path = dataPath(size, reserved);
  path.forEach(([row, col], i) => {
    const byte = codewords[i >> 3] ?? 0;
    const bit = ((byte >>> (7 - (i & 7))) & 1) === 1;
    modules[row][col] = bit !== maskBit(mask, row, col);
  });
}

/* ------------------------------------------------------------------ */
/* מידע פורמט וגרסה (BCH)                                              */
/* ------------------------------------------------------------------ */

function formatBits(ecc: EccLevel, mask: number): number {
  const data = (ECC_BITS[ecc] << 3) | mask;      // 5 ביט
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function versionBits(version: number): number {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((rem >>> i) & 1) rem ^= 0x1f25 << (i - 12);
  }
  return (version << 12) | rem;
}

function placeFormat(modules: boolean[][], size: number, ecc: EccLevel, mask: number): void {
  const bits = formatBits(ecc, mask);
  const on = (i: number) => ((bits >>> i) & 1) === 1;

  // עותק ראשון — סביב העינית הראשית
  for (let i = 0; i <= 5; i++) modules[8][i] = on(i);
  modules[8][7] = on(6);
  modules[8][8] = on(7);
  modules[7][8] = on(8);
  for (let i = 9; i <= 14; i++) modules[14 - i][8] = on(i);

  // עותק שני — מפוצל בין שתי הפינות האחרות
  for (let i = 0; i <= 7; i++) modules[size - 1 - i][8] = on(i);
  for (let i = 8; i <= 14; i++) modules[8][size - 15 + i] = on(i);

  modules[size - 8][8] = true; // המודול הכהה נשאר כהה
}

function placeVersion(modules: boolean[][], size: number, version: number): void {
  const bits = versionBits(version);
  for (let i = 0; i < 18; i++) {
    const on = ((bits >>> i) & 1) === 1;
    const a = Math.floor(i / 3);
    const b = (i % 3) + size - 11;
    modules[a][b] = on;
    modules[b][a] = on;
  }
}

/* ------------------------------------------------------------------ */
/* ניקוד מסכות                                                          */
/* ------------------------------------------------------------------ */

function scorePenalty(m: boolean[][], size: number): number {
  let penalty = 0;

  // כלל 1 — רצפים באותו צבע
  for (let i = 0; i < size; i++) {
    for (const isRow of [true, false]) {
      let run = 1;
      for (let j = 1; j < size; j++) {
        const cur = isRow ? m[i][j] : m[j][i];
        const prev = isRow ? m[i][j - 1] : m[j - 1][i];
        if (cur === prev) { run++; }
        else { if (run >= 5) penalty += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) penalty += 3 + (run - 5);
    }
  }

  // כלל 2 — ריבועים 2x2
  for (let r = 0; r < size - 1; r++)
    for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) penalty += 3;
    }

  // כלל 3 — תבנית דמוית-עינית
  const P1 = [true, false, true, true, true, false, true, false, false, false, false];
  const P2 = [false, false, false, false, true, false, true, true, true, false, true];
  const match = (get: (k: number) => boolean, start: number, pat: boolean[]) =>
    pat.every((p, k) => get(start + k) === p);
  for (let i = 0; i < size; i++)
    for (let j = 0; j <= size - 11; j++) {
      if (match((k) => m[i][k], j, P1) || match((k) => m[i][k], j, P2)) penalty += 40;
      if (match((k) => m[k][i], j, P1) || match((k) => m[k][i], j, P2)) penalty += 40;
    }

  // כלל 4 — איזון כהה/בהיר
  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark++;
  const ratio = (dark * 100) / (size * size);
  penalty += Math.floor(Math.abs(ratio - 50) / 5) * 10;

  return penalty;
}

/* ------------------------------------------------------------------ */
/* פלט                                                                 */
/* ------------------------------------------------------------------ */

export interface QrSvgOptions {
  moduleSize?: number;
  margin?: number;      // ביחידות מודול (הסטנדרט: 4)
  dark?: string;
  light?: string;
  /** חור במרכז ללוגו. דורש ECC 'Q' או 'H'. שיעור מהרוחב, למשל 0.22 */
  logoHole?: number;
  rounded?: boolean;
}

/** SVG כמחרוזת — מתאים ל-<img src="data:...">, ל-React ולקנבס. */
export function qrToSvg(qr: QrResult, opts: QrSvgOptions = {}): string {
  const {
    moduleSize = 8, margin = 4, dark = '#121110', light = '#F6F3EB',
    logoHole = 0, rounded = false,
  } = opts;

  const dim = (qr.size + margin * 2) * moduleSize;
  const hole = logoHole > 0
    ? { from: Math.floor(qr.size * (0.5 - logoHole / 2)), to: Math.ceil(qr.size * (0.5 + logoHole / 2)) }
    : null;

  let path = '';
  for (let r = 0; r < qr.size; r++)
    for (let c = 0; c < qr.size; c++) {
      if (!qr.modules[r][c]) continue;
      if (hole && r >= hole.from && r < hole.to && c >= hole.from && c < hole.to) continue;
      const x = (c + margin) * moduleSize;
      const y = (r + margin) * moduleSize;
      path += rounded
        ? `M${x + moduleSize / 2} ${y}a${moduleSize / 2} ${moduleSize / 2} 0 1 0 0.01 0z`
        : `M${x} ${y}h${moduleSize}v${moduleSize}h-${moduleSize}z`;
    }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges">`,
    `<rect width="${dim}" height="${dim}" fill="${light}"/>`,
    `<path d="${path}" fill="${dark}"/>`,
    `</svg>`,
  ].join('');
}

/** ציור ישיר לקנבס — זה מה שכרטיס השיתוף משתמש בו. */
export function drawQrToCanvas(
  ctx: CanvasRenderingContext2D,
  qr: QrResult,
  x: number, y: number, size: number,
  opts: { dark?: string; light?: string; margin?: number; logoHole?: number } = {},
): void {
  const { dark = '#121110', light = '#F6F3EB', margin = 2, logoHole = 0 } = opts;
  const total = qr.size + margin * 2;
  const unit = size / total;

  ctx.fillStyle = light;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = dark;

  const hole = logoHole > 0
    ? { from: Math.floor(qr.size * (0.5 - logoHole / 2)), to: Math.ceil(qr.size * (0.5 + logoHole / 2)) }
    : null;

  for (let r = 0; r < qr.size; r++)
    for (let c = 0; c < qr.size; c++) {
      if (!qr.modules[r][c]) continue;
      if (hole && r >= hole.from && r < hole.to && c >= hole.from && c < hole.to) continue;
      ctx.fillRect(
        x + (c + margin) * unit,
        y + (r + margin) * unit,
        Math.ceil(unit), Math.ceil(unit),
      );
    }
}

/* ------------------------------------------------------------------ */
/* מיוצא לצורכי אימות בלבד — הטסטים קוראים את הקוד חזרה ומוודאים        */
/* שהמחרוזת המקורית משוחזרת (ראו tests/qr.test.ts)                     */
/* ------------------------------------------------------------------ */

export const __internals = {
  buildReserved,
  rsEncode,
  blockLayout(version: number, ecc: EccLevel) {
    const [ecPerBlock, blocksG1, dataG1, blocksG2, dataG2] = EC_TABLE[ecc][version - 1];
    return { ecPerBlock, blocksG1, dataG1, blocksG2, dataG2,
             totalCodewords: TOTAL_CODEWORDS[version - 1] };
  },
};
