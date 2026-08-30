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
import { PRESS } from './pressPalette.ts';
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
  /**
   * מכפיל הקפטן, מתוך חוקי המצב **החיים** (כולל שינויי אדמין).
   *
   * ★ עד עכשיו היה כאן `×3` כתוב ביד בשני מקומות. ברגע שהאדמין
   *   משנה את המכפיל, הכרטיס היה ממשיך להצהיר מספר שהמערכת כבר
   *   לא מחשבת — באג שאף בדיקה לא תופסת, כי אף בדיקה לא קוראת
   *   תמונות. ברירת המחדל 3 שומרת על כרטיסים קיימים.
   */
  captainMultiplier?: number;
  /**
   * ★ הניקוד עדיין יכול לזוז — המחזור נעול אבל לא נסגר.
   *
   * מוסיף חותמת "לא סופי" על הכרטיס. תמונה שנשלחה לוואטסאפ
   * אינה יכולה לתקן את עצמה, ולכן היא חייבת לומר את זה בעצמה.
   */
  live?: boolean;
  /** 'דוביד 11' / 'דוביד 5'. שני המצבים הם אותו מוצר, ולא אותו משחק. */
  modeLabel?: string;
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
/* הכרטיס — עמוד התוצאות                                                */
/* =================================================================== */
/**
 * ═══════════════════════════════════════════════════════════════
 * ★★ למה הכרטיס הזה נכתב מחדש ★★
 * ═══════════════════════════════════════════════════════════════
 *
 * `revealCard.ts` — הכרטיס שלפני המחזור — הוא **גזיר עיתון**:
 * נייר מצהיב, פס כותרת אדום, מגרש מודפס בנקודות, מסגרת כפולה.
 * זה המיתוג של דוביד, וזה מה שגורם לאנשים לא לגלול הלאה.
 *
 * הכרטיס שאחרי המחזור — זה שנכנס לסטורי ביום ראשון בבוקר — נשאר
 * בשפה הישנה: רקע שחור, זהב, פינות מעוגלות. כלומר **המוצר נראה
 * כמו שני מוצרים**, ודווקא בכרטיס שנשלח לחברים.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ למה טבלת דירוגים ולא מגרש
 * ═══════════════════════════════════════════════════════════════
 *
 * זו לא התפשרות — זו הצורה הנכונה. עיתון ספורט מדפיס **הרכב על
 * מגרש לפני המשחק**, ו**טבלת ציונים אחרי המשחק**. שני הכרטיסים
 * חולקים את אותו נייר, אותה מסגרת, אותו מאסטהד ואותו פס אדום,
 * ונבדלים בדיוק בהבדל שקורא לו אוהד כדורגל מצפה:
 *
 *      לפני  →  איפה כולם עומדים
 *      אחרי  →  כמה כל אחד קיבל
 *
 * בונוס מעשי: אין כאן שכפול של קוד המגרש והדמויות המצוירות.
 * מגרש שני שמצויר בשני מקומות הוא מגרש שיום אחד ייראה אחרת.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ החותמת "לא סופי"
 * ═══════════════════════════════════════════════════════════════
 *
 * מרגע שהניקוד חי, אפשר לשתף כרטיס באמצע המחזור. תמונה בלי
 * סימון הייתה מציגה מספר זמני כאילו הוא סופי — ומי שקיבל אותה
 * בוואטסאפ לא יכול לדעת. חותמת אדומה מוטה, כמו "טיוטה" על
 * מסמך, פותרת את זה בשורה אחת ולא מקלקלת את הכרטיס.
 */

export function drawShareCard(
  ctx: CanvasRenderingContext2D,
  d: ShareCardData,
  logo?: CanvasImageSource | null,
): void {
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textBaseline = 'alphabetic';
  ctx.clearRect(0, 0, CARD_W, CARD_H);

  drawPaper(ctx);
  drawMasthead(ctx, d, logo);
  drawScoreBlock(ctx, d);
  drawBreakdown(ctx, d);
  const table = drawRatings(ctx, d);
  drawCoach(ctx, d, table.bottom + 40);
  drawStub(ctx, d);
  if (d.live) drawProvisionalStamp(ctx);

  ctx.restore();
}

/* ---------------- 1 · הנייר ---------------- */
/** זהה ל-`revealCard`, ובכוונה: אותו נייר, אותה מסגרת כפולה. */
function drawPaper(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = PRESS.paper;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  const wash = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  wash.addColorStop(0, '#00000000');
  wash.addColorStop(1, '#8a6a3a18');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  grain(ctx, 0, 0, CARD_W, CARD_H, '#7d6a4a', 0.16);

  ctx.strokeStyle = PRESS.ink;
  ctx.lineWidth = 7;
  ctx.strokeRect(32, 32, CARD_W - 64, CARD_H - 64);
  ctx.lineWidth = 2;
  ctx.strokeRect(50, 50, CARD_W - 100, CARD_H - 100);
}

/* ---------------- 2 · המאסטהד ---------------- */
function drawMasthead(
  ctx: CanvasRenderingContext2D, d: ShareCardData, logo?: CanvasImageSource | null,
) {
  if (logo) {
    ctx.drawImage(logo, CARD_W / 2 - 108, 74, 216, 216);
  } else {
    /* ★ בלי לוגו — לא משאירים חור. שם המוצר, בקו הדיו. */
    ctx.textAlign = 'center';
    ctx.fillStyle = PRESS.ink;
    ctx.font = `900 116px ${F_DISPLAY}`;
    ctx.fillText('דוביד', CARD_W / 2, 232);
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = PRESS.ink;
  ctx.font = `400 26px ${F_POSTER}`;
  withSpacing(ctx, '2px', () => {
    ctx.fillText(spaced(d.urlLabel ?? 'DUBID.DUBELTEAM.COM'), CARD_W / 2, 322);
  });

  perforation(ctx, 364);

  /* ── פס הכותרת האדום ── */
  const bx = 60, by = 396, bw = CARD_W - 120, bh = 100;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(bx - 5, by - 5, bw + 10, bh + 10);
  ctx.fillStyle = PRESS.red;
  ctx.fillRect(bx, by, bw, bh);
  dots(ctx, bx, by, bw, bh, PRESS.redDeep, 7, 1.3, 0.3);
  ctx.strokeStyle = PRESS.ink;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(bx, by, bw, bh);

  ctx.fillStyle = PRESS.ink;
  ctx.font = `900 70px ${F_DISPLAY}`;
  withSpacing(ctx, '6px', () => {
    ctx.fillText('תוצאות המחזור', CARD_W / 2, by + 71);
  });

  ctx.font = `700 31px ${F_UI}`;
  ctx.fillStyle = PRESS.ink;
  ctx.fillText(
    clip(ctx,
      [d.modeLabel, d.gameweekLabel, d.leagueLabel ?? 'ליגת העל']
        .filter(Boolean).join('  ·  '),
      bw - 40),
    CARD_W / 2, by + bh + 40,
  );
}

/* ---------------- 3 · המספר ---------------- */
/**
 * ★ המספר הוא הכותרת, ולכן הוא מודפס ולא זוהר.
 *
 * בגרסה הקודמת ישב מאחוריו `radialGradient` כתום. זוהר הוא
 * אפקט של מסך; על נייר הוא נראה כמו כתם. מה שנשאר במקומו הוא
 * **אי־התאמת לוחות הדפוס** — אותה שפה בדיוק כמו הכותרות בלובי.
 */
function drawScoreBlock(ctx: CanvasRenderingContext2D, d: ShareCardData) {
  const cx = CARD_W / 2;
  const label = formatPoints(d.totalPoints);

  ctx.textAlign = 'center';
  ctx.direction = 'ltr';
  ctx.font = `400 240px ${F_POSTER}`;

  /* מישרג: אדום מצד אחד, כחלחל מהשני. 3 פיקסלים בגודל הזה. */
  ctx.fillStyle = 'rgba(217,59,59,.55)';
  ctx.fillText(label, cx + 3, 745);
  ctx.fillStyle = 'rgba(80,150,190,.30)';
  ctx.fillText(label, cx - 3, 745);
  ctx.fillStyle = PRESS.ink;
  ctx.fillText(label, cx, 742);
  ctx.direction = 'rtl';

  ctx.font = `900 42px ${F_DISPLAY}`;
  ctx.fillStyle = PRESS.ink;
  withSpacing(ctx, '4px', () => ctx.fillText('נקודות במחזור', cx, 794));

  /* ── חותמת המקום ──
     מוטה, כמו חותמת שהוטבעה על הנייר. ישרה היא רכיב ממשק. */
  if (d.rank && d.totalPlayers) {
    const w = 430, h = 84, y = 822;
    ctx.save();
    ctx.translate(cx, y + h / 2);
    ctx.rotate((-1.6 * Math.PI) / 180);

    const top3 = d.rank <= 3;
    ctx.strokeStyle = top3 ? PRESS.red : PRESS.ink;
    ctx.lineWidth = 4;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.lineWidth = 1.6;
    ctx.strokeRect(-w / 2 + 7, -h / 2 + 7, w - 14, h - 14);

    ctx.textAlign = 'center';
    ctx.fillStyle = top3 ? PRESS.red : PRESS.ink;
    ctx.font = `900 40px ${F_DISPLAY}`;
    ctx.fillText(`מקום ${d.rank} מתוך ${d.totalPlayers}`, 0, 14);
    ctx.restore();
  }
}

/* ---------------- 4 · פירוק הניקוד ---------------- */
function fmtMultiplier(n: number | undefined): string {
  const m = typeof n === 'number' && n > 0 ? n : 3;
  return Number.isInteger(m) ? String(m) : m.toFixed(1);
}

/**
 * ארבע תיבות מקרא, כמו מסגרת נתונים בשולי כתבה.
 * נייר־תיבה (`PRESS.card`) על נייר, וקו דיו סביב. בלי פינות
 * מעוגלות: דפוס לא מעגל פינות.
 */
function drawBreakdown(ctx: CanvasRenderingContext2D, d: ShareCardData) {
  const items: Array<[string, number]> = [
    ['אישי', d.breakdown.personal],
    ['תוצאה', d.breakdown.result],
    [`קפטן ×${fmtMultiplier(d.captainMultiplier)}`, d.breakdown.captain],
    ['וירטואלי', d.breakdown.virtual],
  ];
  const gap = 14;
  const total = CARD_W - 128;
  const w = (total - gap * 3) / 4;
  const y = 926, h = 116;

  items.forEach(([label, value], i) => {
    // RTL: הפריט הראשון בימין.
    const x = CARD_W - 64 - w - i * (w + gap);

    ctx.fillStyle = PRESS.card;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = PRESS.ink;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    ctx.textAlign = 'center';
    ctx.direction = 'ltr';
    ctx.font = `400 50px ${F_POSTER}`;
    ctx.fillStyle = PRESS.ink;
    ctx.fillText(formatPoints(value), x + w / 2, y + 66);
    ctx.direction = 'rtl';

    ctx.font = `700 23px ${F_UI}`;
    ctx.fillStyle = 'rgba(18,16,14,.62)';
    ctx.fillText(clip(ctx, label, w - 14), x + w / 2, y + 100);
  });
}

/* ---------------- 5 · טבלת הציונים ---------------- */
const ROW_ORDER: Position[] = ['GK', 'DEF', 'MID', 'FWD'];

const POS_HE: Record<Position, string> = {
  GK: 'שוער', DEF: 'הגנה', MID: 'קישור', FWD: 'חלוץ',
};

/**
 * ★ טבלה בשתי עמודות, ובכוונה.
 *
 * אחת־עשרה שורות ברוחב מלא הן עמוד ריק משני צדדיו. שתי עמודות
 * הן בדיוק הצורה שבה עיתון מדפיס ציוני שחקנים — וזה גם מה
 * שמאפשר לכרטיס להחזיק 11 שחקנים בלי להתכווץ לטקסט זעיר.
 *
 * דוביד 5 מקבל אותה טבלה עם חמש שורות. היא לא "נראית חסרה":
 * העמודה השנייה פשוט לא נפתחת.
 */
function drawRatings(ctx: CanvasRenderingContext2D, d: ShareCardData): { bottom: number } {
  const players = [...d.lineup].sort((a, b) => {
    const pa = ROW_ORDER.indexOf(a.position);
    const pb = ROW_ORDER.indexOf(b.position);
    // עמדה, ואז ניקוד יורד, ואז שם — מיון יציב לחלוטין.
    return pa - pb || b.points - a.points || a.name.localeCompare(b.name, 'he');
  });

  const x = 64, y = 1094, w = CARD_W - 128;
  const twoCols = players.length > 6;
  const colGap = 22;
  const colW = twoCols ? (w - colGap) / 2 : w;
  const rowH = 56;
  const perCol = twoCols ? Math.ceil(players.length / 2) : players.length;
  const bodyH = perCol * rowH;

  /* כותרת הטבלה — פס דיו דק עם שתי מילים. */
  ctx.fillStyle = PRESS.ink;
  ctx.fillRect(x, y - 44, w, 34);
  ctx.textAlign = 'right';
  ctx.fillStyle = PRESS.paper;
  ctx.font = `700 22px ${F_UI}`;
  withSpacing(ctx, '3px', () => ctx.fillText('הציונים', x + w - 12, y - 20));
  ctx.textAlign = 'left';
  ctx.font = `700 20px ${F_UI}`;
  ctx.fillText('POINTS', x + 12, y - 20);

  players.forEach((p, i) => {
    const col = twoCols && i >= perCol ? 1 : 0;
    const row = twoCols ? i % perCol : i;
    // RTL: העמודה הראשונה בימין.
    const cx = col === 0 ? x + w - colW : x;
    const cy = y + row * rowH;
    drawRatingRow(ctx, cx, cy, colW, rowH, p);
  });

  return { bottom: y + bodyH };
}

function drawRatingRow(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  p: ShareLineupEntry,
) {
  const cap = !!p.isCaptain;

  /* פס הקפטן — אדום מלא. ההחלטה היחידה שמכפילה היא גם
     ההחלטה היחידה שמקבלת צבע. */
  if (cap) {
    ctx.fillStyle = PRESS.red;
    ctx.fillRect(x, y + 4, w, h - 10);
    dots(ctx, x, y + 4, w, h - 10, PRESS.redDeep, 6, 1.1, 0.26);
  } else {
    // פסי זברה עדינים — נייר תיבה על נייר.
    ctx.fillStyle = 'rgba(246,243,234,.55)';
    ctx.fillRect(x, y + 4, w, h - 10);
  }
  ctx.strokeStyle = PRESS.ink;
  ctx.lineWidth = cap ? 2.4 : 1.2;
  ctx.strokeRect(x, y + 4, w, h - 10);

  const ink = cap ? PRESS.ink : PRESS.ink;
  const dim = cap ? 'rgba(18,16,14,.72)' : 'rgba(18,16,14,.55)';

  /* תג העמדה — ריבוע קטן בקצה. */
  ctx.textAlign = 'center';
  ctx.font = `700 17px ${F_UI}`;
  ctx.fillStyle = dim;
  ctx.fillText(POS_HE[p.position], x + w - 34, y + 36);

  /* השם. */
  ctx.textAlign = 'right';
  ctx.font = `700 27px ${F_UI}`;
  ctx.fillStyle = ink;
  const nameMax = w - 190;
  ctx.fillText(clip(ctx, p.name, nameMax), x + w - 66, y + 33);

  /* הקבוצה, שורה שנייה קטנה. */
  ctx.font = `700 18px ${F_UI}`;
  ctx.fillStyle = dim;
  ctx.fillText(clip(ctx, p.teamShort, nameMax), x + w - 66, y + 52);

  /* הניקוד, בקצה השני. */
  ctx.textAlign = 'left';
  ctx.direction = 'ltr';
  ctx.font = `400 40px ${F_POSTER}`;
  ctx.fillStyle = ink;
  ctx.fillText(formatPoints(p.points), x + 14, y + 44);
  ctx.direction = 'rtl';
}

/* ---------------- 6 · שם המאמן ---------------- */
/**
 * ★ קו חתימה, כמו בכרטיס שלפני המחזור.
 *   הכרטיס שייך למישהו — ובלי השורה הזו הוא סתם דף תוצאות.
 */
function drawCoach(ctx: CanvasRenderingContext2D, d: ShareCardData, y: number) {
  ctx.textAlign = 'center';

  ctx.strokeStyle = PRESS.ink;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(CARD_W / 2 - 240, y);
  ctx.lineTo(CARD_W / 2 + 240, y);
  ctx.stroke();

  ctx.fillStyle = 'rgba(18,16,14,.6)';
  ctx.font = `700 20px ${F_UI}`;
  withSpacing(ctx, '2px', () => ctx.fillText(spaced('המאמן'), CARD_W / 2, y + 28));

  ctx.fillStyle = PRESS.ink;
  ctx.font = `900 44px ${F_DISPLAY}`;
  ctx.fillText(clip(ctx, d.userName, CARD_W - 220), CARD_W / 2, y + 74);
}

/* ---------------- 7 · הספח ---------------- */
/**
 * ★ הספח התחתון — QR, שורת הזמנה, ורצועת הכתובת.
 *
 * הקריאה לפעולה היא **שאלה** ולא הכרזה: "תשחק מולי במחזור
 * הבא". הכרטיס נשלח לקבוצת וואטסאפ, וההזמנה היא כל הסיבה
 * שהוא נשלח.
 */
function drawStub(ctx: CanvasRenderingContext2D, d: ShareCardData) {
  const y = 1602;
  perforation(ctx, y - 36);

  const qr = encodeQr(d.url, 'H');
  const qrSize = 178;
  const qrX = CARD_W - 84 - qrSize;
  drawQrToCanvas(ctx, qr, qrX, y, qrSize, {
    dark: PRESS.ink, light: PRESS.card, margin: 2,
  });
  ctx.strokeStyle = PRESS.ink;
  ctx.lineWidth = 2;
  ctx.strokeRect(qrX, y, qrSize, qrSize);

  ctx.textAlign = 'right';
  ctx.fillStyle = PRESS.ink;
  ctx.font = `900 44px ${F_DISPLAY}`;
  ctx.fillText('תשחק מולי במחזור הבא', qrX - 34, y + 54);

  ctx.font = `700 27px ${F_UI}`;
  ctx.fillStyle = 'rgba(18,16,14,.66)';
  ctx.fillText(`סרוק, בחר ${d.lineup.length} שחקנים —`, qrX - 34, y + 100);
  ctx.fillText('אחד מכל קבוצה. זהו הכלל.', qrX - 34, y + 138);

  /* רצועת הכתובת — אדומה, כמו המאסטהד. */
  const barY = CARD_H - 112, barH = 62;
  ctx.fillStyle = PRESS.red;
  ctx.fillRect(50, barY, CARD_W - 100, barH);
  dots(ctx, 50, barY, CARD_W - 100, barH, PRESS.redDeep, 7, 1.3, 0.28);
  ctx.strokeStyle = PRESS.ink;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(50, barY, CARD_W - 100, barH);

  ctx.textAlign = 'center';
  ctx.direction = 'ltr';
  ctx.font = `400 42px ${F_POSTER}`;
  ctx.fillStyle = PRESS.ink;
  ctx.fillText(d.urlLabel ?? 'DUBID.DUBELTEAM.COM', CARD_W / 2, barY + 45);
  ctx.direction = 'rtl';
}

/* ---------------- 8 · "לא סופי" ---------------- */
function drawProvisionalStamp(ctx: CanvasRenderingContext2D) {
  /* ★ פינה, ולא אלכסון על הכרטיס.
     חותמת שחוצה את המספר הופכת את הכרטיס לבלתי קריא — ואז
     אף אחד לא משתף אותו, וגם הסימון עצמו הולך לאיבוד. */
  const w = 300, h = 76;
  ctx.save();
  ctx.translate(238, 196);
  ctx.rotate((-7 * Math.PI) / 180);
  ctx.globalAlpha = 0.92;

  ctx.fillStyle = PRESS.card;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.strokeStyle = PRESS.red;
  ctx.lineWidth = 5;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.lineWidth = 1.8;
  ctx.strokeRect(-w / 2 + 8, -h / 2 + 8, w - 16, h - 16);

  ctx.textAlign = 'center';
  ctx.fillStyle = PRESS.red;
  ctx.font = `900 29px ${F_DISPLAY}`;
  withSpacing(ctx, '2px', () => ctx.fillText('לא סופי', 0, -2));
  ctx.font = `700 18px ${F_UI}`;
  ctx.fillText('המחזור עדיין חי', 0, 24);

  ctx.restore();
}

/* =================================================================== */
/* עזרי הדפוס — משותפים לכל כרטיס על נייר                               */
/* =================================================================== */

/** גרעיני הנייר. רעש עדין, אחרת הנייר נראה כמו מלבן בז׳. */
export function grain(
  ctx: CanvasRenderingContext2D, x: number, y: number,
  w: number, h: number, color: string, alpha: number,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  /* צעד 3 ולא 1: מיליון נקודות הן שנייה שלמה של רינדור, ובעין
     ההבדל אפסי. */
  for (let i = 0; i < w * h * 0.0016; i++) {
    const px = x + Math.random() * w;
    const py = y + Math.random() * h;
    ctx.fillRect(px, py, 1.2, 1.2);
  }
  ctx.restore();
}

/** נקודות הדפוס בתוך שטח צבעוני. */
export function dots(
  ctx: CanvasRenderingContext2D, x: number, y: number,
  w: number, h: number, color: string, step: number, r: number, alpha: number,
) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (let row = 0; row < h; row += step) {
    for (let col = 0; col < w; col += step) {
      ctx.beginPath();
      ctx.arc(x + col + ((row / step) % 2 ? step / 2 : 0), y + row, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** קו ניקוב — מה שהופך דף לשני חלקים שאפשר לתלוש. */
export function perforation(ctx: CanvasRenderingContext2D, y: number) {
  ctx.save();
  ctx.strokeStyle = PRESS.ink;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 2;
  ctx.setLineDash([9, 11]);
  ctx.beginPath();
  ctx.moveTo(72, y);
  ctx.lineTo(CARD_W - 72, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * `letterSpacing` על הקנבס, עם נפילה חיננית.
 * ★ Safari הוסיף אותו מאוחר. בלי ה-try הכרטיס כולו היה נכשל
 *   בגלל מרווח אותיות.
 */
export function withSpacing(ctx: CanvasRenderingContext2D, value: string, draw: () => void) {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  const prev = c.letterSpacing;
  try { c.letterSpacing = value; } catch { /* דפדפן ישן */ }
  draw();
  try { if (prev !== undefined) c.letterSpacing = prev; } catch { /* noop */ }
}

/** אותיות מרווחות — גיבוי ל-`letterSpacing` בדפדפן ישן. */
export function spaced(s: string): string {
  return s.split('').join(' ');
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
/**
 * ★ הלוגו נטען פעם אחת לכל חיי העמוד.
 *
 * מטמון משלו ולא ייבוא מ-`revealCard.ts`: השניים כבר קשורים
 * בכיוון אחד (revealCard מייבא מכאן), וייבוא הפוך היה סוגר
 * מעגל. `null` הוא תוצאה תקפה — הכרטיס מדפיס את שם המוצר
 * במקום, ושיתוף שנכשל גרוע מלוגו חסר.
 */
let logoPromise: Promise<HTMLImageElement | null> | null = null;

const LOGO_SRC = '/brand/dubid-logo-ink.png';

function loadLogo(): Promise<HTMLImageElement | null> {
  if (logoPromise) return logoPromise;
  if (typeof Image === 'undefined') return Promise.resolve(null);

  logoPromise = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = LOGO_SRC;
  });
  return logoPromise;
}

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
    await (document as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready;
  }
  const logo = await loadLogo();

  ctx.scale(scale, scale);
  drawShareCard(ctx, data, logo);
  return canvas;
}
