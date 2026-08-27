/**
 * shareCard.ts — מחולל כרטיס השיתוף שאחרי המחזור.
 *
 * ★ הקובץ הזה הוא גם ארגז הכלים.
 *
 * `revealCard.ts` (הכרטיס שלפני המחזור) מצייר על אותו קנבס
 * ובאותה שפה גרפית, ולכן הוא מייבא מכאן את הפלטה, הפונטים,
 * והפרימיטיבים (`roundRect`, `halftone`, `turf`). שני מחוללים
 * עם שני עותקים של אותה פלטה הם שני כרטיסים שיום אחד ייראו
 * אחרת — ואף בדיקה לא קוראת תמונות.
 *
 * 1080×1920 (9:16) — המידה של Instagram Stories, TikTok וסטטוס וואטסאפ.
 *
 * למה קנבס ולא html-to-image?
 *   · אפס תלויות — הכרטיס נוצר גם באצטדיון בלי קליטה
 *   · פיקסל מדויק ולא "בערך כמו ה-DOM", בכל דפדפן
 *   · אין בעיות CORS / tainted canvas שהורגות את toBlob בדיוק ברגע השיתוף
 *   · ‎~40ms‎ לרינדור מלא במקום ‎~800ms‎ של serialization
 *
 * הפונקציה טהורה מבחינת אפליקציה: מקבלת ctx ודאטה, מציירת. אין בה
 * fetch, אין state, ואפשר להריץ אותה גם ב-OffscreenCanvas בתוך worker.
 */
import { encodeQr, drawQrToCanvas } from './qr.ts';
import type { Position } from './scoring/types.ts';

export const CARD_W = 1080;
export const CARD_H = 1920;

/**
 * ★ הפלטה כאן היא עותק, וזה מכוון.
 *
 * הכרטיס מצויר על `<canvas>`, ולקנבס אין גישה למחלקות Tailwind.
 * שמות המפתחות זהים לטוקנים ב-`tailwind.config.ts`, והערכים
 * חייבים להישאר זהים להם. שינוי שם — כאן ושם.
 *
 * `toto` נשמר כשם היסטורי, בדיוק כמו בטוקנים, כדי שלא יהיה רגע
 * שבו הקנפיג והקנבס לא מסכימים על שם צבע.
 */
export const PALETTE = {
  night: '#0C0A08',
  night2: '#16120D',
  night3: '#211A13',
  pitch: '#12301F',
  pitch2: '#1B4630',
  toto: '#D8B25C',        // = gold
  totoDeep: '#A9822F',    // = gold.deep
  goldLight: '#F0D693',
  chalk: '#F4ECDC',
  chalkDim: '#8B7F6A',
  tekhelet: '#4A9BD8',
  armband: '#FFCE4D',
  flare: '#E4453B',
} as const;

export const F_DISPLAY = '"Narkiss Block", "Heebo", system-ui, sans-serif';
export const F_POSTER = '"Anton", "Heebo", system-ui, sans-serif';
export const F_UI = '"Almoni Neue", "Assistant", "Heebo", system-ui, sans-serif';

export interface ShareLineupEntry {
  name: string;          // שם קצר: 'אצילי'
  teamShort: string;     // 'מ״ח'
  position: Position;
  points: number;
  shirt?: number | null;
  isCaptain?: boolean;
}

export interface ShareCardData {
  gameweekLabel: string;                 // 'מחזור 7'
  leagueLabel?: string;                  // 'ליגת העל'
  userName: string;                      // 'מאור'
  totalPoints: number;
  rank?: number;
  totalPlayers?: number;
  breakdown: { personal: number; result: number; captain: number; virtual: number };
  lineup: ShareLineupEntry[];
  virtualGoals?: number;
  url: string;                           // הקישור שנכנס ל-QR
  urlLabel?: string;                     // 'DUBID.DUBELTEAM.COM'
}

/* =================================================================== */
/* עזרי ציור                                                            */
/* =================================================================== */

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number,
                   w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** נקודות הלפטון — הטקסטורה שהופכת את הכרטיס לחפץ מודפס */
export type HalftoneMode = 'solid' | 'denserDown' | 'denserUp';

export function halftone(ctx: CanvasRenderingContext2D, x: number, y: number,
                  w: number, h: number, color: string,
                  step = 16, mode: HalftoneMode = 'denserDown', maxAlpha = 0.7) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = color;
  for (let r = 0; r < h; r += step) {
    const p = h <= step ? 1 : r / (h - step);
    const t = mode === 'solid' ? 1 : mode === 'denserDown' ? p : 1 - p;
    const radius = 3.8 * t;
    if (radius < 0.4) { continue; }
    ctx.globalAlpha = maxAlpha * t;
    for (let c = 0; c < w; c += step) {
      ctx.beginPath();
      ctx.arc(x + c + ((r / step) % 2 ? step / 2 : 0), y + r, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** פסי כיסוח הדשא */
export function turf(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.save();
  roundRect(ctx, x, y, w, h, 36); ctx.clip();
  ctx.fillStyle = PALETTE.pitch; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = PALETTE.pitch2;
  const band = 84;
  for (let i = -h; i < w + h; i += band * 2) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + band, y + h);
    ctx.lineTo(x + i + band + h * 0.32, y);
    ctx.lineTo(x + i + h * 0.32, y);
    ctx.closePath(); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(246,243,235,.22)'; ctx.lineWidth = 4;
  roundRect(ctx, x + 22, y + 22, w - 44, h - 44, 22); ctx.stroke();
  ctx.restore();
}

/** סימן החותם — אותם path-ים בדיוק כמו קובץ ה-SVG */
export function drawSeal(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 512, size / 512);

  ctx.fillStyle = PALETTE.tekhelet;
  ctx.beginPath(); ctx.arc(249, 249, 228, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PALETTE.toto;
  ctx.beginPath(); ctx.arc(256, 256, 228, 0, Math.PI * 2); ctx.fill();

  ctx.save();
  ctx.beginPath(); ctx.arc(256, 256, 228, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = PALETTE.chalk;
  ctx.fill(new Path2D('M112 484 C144 410 196 380 256 380 C316 380 368 410 400 484 Z'));
  ctx.fillStyle = PALETTE.tekhelet;
  ctx.fillRect(146, 424, 220, 17);
  ctx.fillRect(126, 458, 260, 17);
  ctx.restore();

  ctx.fillStyle = PALETTE.chalk;
  ctx.beginPath(); ctx.arc(256, 268, 97, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = PALETTE.night;
  ctx.fill(new Path2D('M158 250 C158 164 354 164 354 250 Z'));
  ctx.save();
  ctx.translate(185, 245); ctx.rotate((-7 * Math.PI) / 180); ctx.translate(-185, -245);
  roundRect(ctx, 92, 232, 186, 26, 13); ctx.fill();
  ctx.restore();

  ctx.fillStyle = PALETTE.toto;
  ctx.beginPath(); ctx.arc(256, 176, 11, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = PALETTE.night;
  ctx.beginPath(); ctx.arc(222, 288, 10, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(292, 288, 10, 0, Math.PI * 2); ctx.fill();
  ctx.fill(new Path2D(
    'M162 320 C198 304 234 310 256 324 C278 310 314 304 350 320 ' +
    'C344 358 298 366 270 346 C263 341 249 341 242 346 C214 366 168 358 162 320 Z'));

  ctx.strokeStyle = PALETTE.night; ctx.lineWidth = 11;
  ctx.beginPath(); ctx.arc(256, 256, 228, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 4; ctx.setLineDash([4, 17]); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(256, 256, 207, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/* =================================================================== */
/* הכרטיס                                                              */
/* =================================================================== */

export function drawShareCard(ctx: CanvasRenderingContext2D, d: ShareCardData): void {
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textBaseline = 'alphabetic';
  ctx.clearRect(0, 0, CARD_W, CARD_H);

  ctx.fillStyle = PALETTE.night;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  drawHeader(ctx, d);
  drawScore(ctx, d);
  drawBreakdown(ctx, d);
  drawLineup(ctx, d);
  drawFooter(ctx, d);

  ctx.restore();
}

/* ---------------- כותרת ---------------- */
function drawHeader(ctx: CanvasRenderingContext2D, d: ShareCardData) {
  const H = 356;
  ctx.fillStyle = PALETTE.toto;
  ctx.fillRect(0, 0, CARD_W, H);
  // הדפוס מתעבה כלפי מטה — מעבר מודפס בין הכתום לדיו, לא קו חד
  halftone(ctx, 0, H - 84, CARD_W, 84, PALETTE.night, 17, 'denserDown', 0.8);

  drawSeal(ctx, 892, 152, 190);

  // המילה "דוביד" עם המישרג — הטעות המכוונת שהיא חלק מהמותג
  ctx.textAlign = 'right';
  ctx.font = `900 132px ${F_DISPLAY}`;
  ctx.fillStyle = PALETTE.tekhelet;
  ctx.fillText('דוביד', 764, 172);
  ctx.fillStyle = PALETTE.night;
  ctx.fillText('דוביד', 758, 166);

  ctx.font = `700 40px ${F_UI}`;
  ctx.fillStyle = 'rgba(18,17,16,.72)';
  ctx.fillText(`${d.gameweekLabel} · ${d.leagueLabel ?? 'ליגת העל'}`, 758, 228);

  ctx.font = `700 34px ${F_UI}`;
  ctx.fillStyle = PALETTE.night;
  ctx.fillText(`ההרכב של ${d.userName}`, 758, 276);
}

/* ---------------- הציון ---------------- */
function drawScore(ctx: CanvasRenderingContext2D, d: ShareCardData) {
  const cx = CARD_W / 2;

  ctx.textAlign = 'center';
  ctx.font = `${'400'} 300px ${F_POSTER}`;
  ctx.direction = 'ltr';

  // זוהר מאחורי המספר
  const glow = ctx.createRadialGradient(cx, 600, 20, cx, 600, 400);
  glow.addColorStop(0, 'rgba(255,91,20,.30)');
  glow.addColorStop(1, 'rgba(255,91,20,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(cx - 420, 380, 840, 440);

  const label = formatPoints(d.totalPoints);
  ctx.fillStyle = PALETTE.totoDeep;
  ctx.fillText(label, cx + 7, 707);
  ctx.fillStyle = PALETTE.toto;
  ctx.fillText(label, cx, 700);
  ctx.direction = 'rtl';

  ctx.font = `900 52px ${F_DISPLAY}`;
  ctx.fillStyle = PALETTE.chalk;
  ctx.fillText('נקודות במחזור', cx, 772);

  if (d.rank && d.totalPlayers) {
    const text = `מקום ${d.rank} מתוך ${d.totalPlayers}`;
    ctx.font = `700 38px ${F_UI}`;
    const w = ctx.measureText(text).width + 76;
    ctx.fillStyle = d.rank <= 3 ? PALETTE.armband : PALETTE.night3;
    roundRect(ctx, cx - w / 2, 806, w, 74, 37);
    ctx.fill();
    ctx.fillStyle = d.rank <= 3 ? PALETTE.night : PALETTE.chalk;
    ctx.fillText(text, cx, 855);
  }
}

/* ---------------- פירוק הניקוד ---------------- */
function drawBreakdown(ctx: CanvasRenderingContext2D, d: ShareCardData) {
  const items: Array<[string, number, string]> = [
    ['אישי', d.breakdown.personal, PALETTE.chalk],
    ['תוצאה', d.breakdown.result, PALETTE.tekhelet],
    ['קפטן ×3', d.breakdown.captain, PALETTE.armband],
    ['וירטואלי', d.breakdown.virtual, PALETTE.toto],
  ];
  const gap = 18;
  const total = CARD_W - 120;
  const w = (total - gap * 3) / 4;
  const y = 916;

  items.forEach(([label, value, color], i) => {
    // RTL: הפריט הראשון בימין
    const x = CARD_W - 60 - w - i * (w + gap);
    ctx.fillStyle = PALETTE.night2;
    roundRect(ctx, x, y, w, 132, 22); ctx.fill();
    ctx.strokeStyle = PALETTE.night3; ctx.lineWidth = 2;
    roundRect(ctx, x, y, w, 132, 22); ctx.stroke();

    ctx.textAlign = 'center';
    ctx.direction = 'ltr';
    ctx.font = `400 52px ${F_POSTER}`;
    ctx.fillStyle = color;
    ctx.fillText(formatPoints(value), x + w / 2, y + 74);
    ctx.direction = 'rtl';
    ctx.font = `700 25px ${F_UI}`;
    ctx.fillStyle = PALETTE.chalkDim;
    ctx.fillText(label, x + w / 2, y + 110);
  });
}

/* ---------------- ההרכב ---------------- */
const ROW_ORDER: Position[] = ['GK', 'DEF', 'MID', 'FWD'];

function drawLineup(ctx: CanvasRenderingContext2D, d: ShareCardData) {
  const x = 60, y = 1068, w = CARD_W - 120, h = 512;
  turf(ctx, x, y, w, h);

  const rows = ROW_ORDER
    .map((pos) => d.lineup.filter((p) => p.position === pos))
    .filter((r) => r.length > 0);

  const pad = 46;
  const rowH = (h - pad * 2) / Math.max(rows.length, 1);
  const chipH = 94;
  rows.forEach((row, ri) => {
    const cy = y + pad + rowH * ri + rowH / 2;
    const chipW = Math.min(148, (w - 72) / row.length - 12);
    const totalW = row.length * chipW + (row.length - 1) * 12;
    let cursor = x + (w + totalW) / 2;      // RTL: מתחילים מימין

    for (const p of row) {
      cursor -= chipW;
      drawPlayerChip(ctx, cursor, cy - chipH / 2, chipW, chipH, p);
      cursor -= 12;
    }
  });
}

function drawPlayerChip(ctx: CanvasRenderingContext2D, x: number, y: number,
                        w: number, h: number, p: ShareLineupEntry) {
  const cap = !!p.isCaptain;
  ctx.fillStyle = cap ? PALETTE.armband : PALETTE.chalk;
  roundRect(ctx, x, y, w, h, 18); ctx.fill();

  if (cap) {
    ctx.strokeStyle = PALETTE.night; ctx.lineWidth = 5;
    roundRect(ctx, x - 5, y - 5, w + 10, h + 10, 22); ctx.stroke();
  }

  ctx.textAlign = 'center';
  ctx.direction = 'ltr';
  ctx.font = `400 42px ${F_POSTER}`;
  ctx.fillStyle = PALETTE.night;
  ctx.fillText(formatPoints(p.points), x + w / 2, y + 46);
  ctx.direction = 'rtl';

  ctx.font = `700 23px ${F_UI}`;
  ctx.fillStyle = 'rgba(18,17,16,.78)';
  ctx.fillText(clip(ctx, p.name, w - 18), x + w / 2, y + 72);

  ctx.font = `700 18px ${F_UI}`;
  ctx.fillStyle = 'rgba(18,17,16,.5)';
  ctx.fillText(p.teamShort, x + w / 2, y + 90);

  if (cap) {
    ctx.fillStyle = PALETTE.night;
    roundRect(ctx, x + w - 46, y - 16, 52, 32, 10); ctx.fill();
    ctx.fillStyle = PALETTE.armband;
    ctx.font = `400 22px ${F_POSTER}`;
    ctx.direction = 'ltr';
    ctx.fillText('x3', x + w - 20, y + 7);
    ctx.direction = 'rtl';
  }
}

/* ---------------- QR ותחתית ---------------- */
function drawFooter(ctx: CanvasRenderingContext2D, d: ShareCardData) {
  const y = 1602;

  // ECC גבוה כי במרכז ה-QR יושב הסימן
  const qr = encodeQr(d.url, 'H');
  const qrSize = 186;
  const qrX = CARD_W - 60 - qrSize;
  drawQrToCanvas(ctx, qr, qrX, y, qrSize, {
    dark: PALETTE.night, light: PALETTE.chalk, margin: 2, logoHole: 0.26,
  });
  drawSeal(ctx, qrX + qrSize / 2, y + qrSize / 2, qrSize * 0.235);

  ctx.textAlign = 'right';
  ctx.font = `900 46px ${F_DISPLAY}`;
  ctx.fillStyle = PALETTE.chalk;
  ctx.fillText('תשחק מולי במחזור הבא', qrX - 44, y + 58);

  ctx.font = `700 29px ${F_UI}`;
  ctx.fillStyle = PALETTE.chalkDim;
  ctx.fillText(`סרוק, בחר ${d.lineup.length} שחקנים —`, qrX - 44, y + 106);
  ctx.fillText('אחד מכל קבוצה. זהו הכלל.', qrX - 44, y + 146);

  // רצועת הכתובת
  const barY = CARD_H - 118;
  ctx.fillStyle = PALETTE.toto;
  ctx.fillRect(0, barY, CARD_W, 118);
  halftone(ctx, 0, barY, CARD_W, 40, PALETTE.night, 14, 'denserUp', 0.55);

  ctx.textAlign = 'center';
  ctx.direction = 'ltr';
  ctx.font = `400 56px ${F_POSTER}`;
  ctx.fillStyle = PALETTE.night;
  ctx.fillText(d.urlLabel ?? 'DUBID.DUBELTEAM.COM', CARD_W / 2, barY + 80);
  ctx.direction = 'rtl';
}

/* ---------------- עזרים ---------------- */
export function formatPoints(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function clip(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(out + '…').width > maxWidth) out = out.slice(0, -1);
  return out + '…';
}

/* =================================================================== */
/* יצירת הקנבס                                                          */
/* =================================================================== */

/**
 * מייצר קנבס מוכן לשיתוף.
 * scale=1 -> 1080×1920 (מספיק לכל הרשתות). scale=2 להדפסה.
 */
export async function renderShareCard(
  data: ShareCardData,
  opts: { scale?: number; canvas?: HTMLCanvasElement } = {},
): Promise<HTMLCanvasElement> {
  const { scale = 1, canvas = document.createElement('canvas') } = opts;
  canvas.width = CARD_W * scale;
  canvas.height = CARD_H * scale;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('הדפדפן לא תומך ב-Canvas 2D');

  // קריטי: בלי זה הפונטים עלולים לא להיות טעונים והכרטיס ייצא ב-fallback
  if (typeof document !== 'undefined' && 'fonts' in document) {
    await (document as any).fonts.ready;
  }

  ctx.scale(scale, scale);
  drawShareCard(ctx, data);
  return canvas;
}
