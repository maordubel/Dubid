/**
 * revealCard.ts — "הנה ההרכב שלי". הכרטיס שלפני המחזור.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ למה צריך כרטיס שני, כשכבר יש אחד
 * ═══════════════════════════════════════════════════════════════
 *
 * `shareCard.ts` הוא כרטיס של **אחרי**: ניקוד, מקום, פירוק.
 * הוא נהדר, והוא מגיע ביום ראשון בבוקר — כשהמחזור נגמר ואי
 * אפשר לעשות עם זה כלום.
 *
 * הרגע החזק ביותר בשבוע של המוצר הוא אחר לגמרי: **השנייה שבה
 * מישהו לוחץ "הגש".** הוא בדיוק קיבל אחת־עשרה החלטות, יש לו
 * דעה על כל אחת מהן, והוא רוצה שיראו.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ הכרטיס הזה לא מתפאר. הוא מתגרה.
 * ═══════════════════════════════════════════════════════════════
 *
 * כרטיס שמתפאר ("ניצחתי!") מקבל לייק. כרטיס שמראה **בחירות
 * לפני שידוע אם הן נכונות** מקבל תשובה — כי לכל אוהד כדורגל יש
 * דעה, והדעה הזו מגרדת לצאת.
 *
 * לכן שלושת המרכיבים כאן, לפי סדר החשיבות:
 *
 *   1. **השמות.** גדולים, קריאים, ניתנים להתווכחות.
 *   2. **הקפטן.** ההחלטה היחידה שמכפילה פי שלוש — כלומר
 *      ההימור הכי גלוי שיש.
 *   3. **הדדליין.** "עוד יומיים" הופך צפייה למשתתף. בלי זה
 *      הכרטיס הוא הודעה; איתו הוא הזמנה.
 *
 * ★ מה **אין** כאן, ובכוונה: ניקוד. אין עדיין. מספר מומצא
 *   ברגע הזה היה הורס בדיוק את מה שהופך את הכרטיס למעניין.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ זהות המצב היא חצי מהכרטיס
 * ═══════════════════════════════════════════════════════════════
 *
 * דוביד 5 ודוביד 11 מקבלים כרטיסים שנראים אחרת: צבע, סמל, ושם
 * קוד. מי שרואה שני כרטיסים בסטורי צריך לדעת שאלה שני משחקים,
 * בלי לקרוא. אותה החלטה בדיוק כמו בלובי (`lib/modeTheme.ts`),
 * ומאותו מקור נתונים — אין hex כתוב פעמיים.
 */
import { encodeQr, drawQrToCanvas } from './qr.ts';
import {
  CARD_W, CARD_H, PALETTE, F_DISPLAY, F_POSTER, F_UI,
  roundRect, halftone, clip, drawSeal,
} from './shareCard.ts';
import { modeTheme, type ModeId } from './modeTheme.ts';
import type { Position } from './scoring/types.ts';

export interface RevealPlayer {
  name: string;        // שם קצר: 'אצילי'
  teamShort: string;   // 'מ״ח'
  position: Position;
  shirt?: number | null;
  price?: number;
  isCaptain?: boolean;
}

export interface RevealCardData {
  mode: ModeId;
  gameweekLabel: string;      // 'מחזור 2'
  leagueLabel?: string;       // 'ליגת העל'
  userName: string;
  lineup: RevealPlayer[];
  formation?: string;         // '4-3-3' — רק לדוביד 11
  /** סך המחירים. רק לדוביד 5, שבו יש תקציב. */
  spent?: number;
  /** מתי נסגר. מוצג כטקסט מוכן — הכרטיס לא מפרמט תאריכים. */
  deadlineLabel?: string;     // 'שבת 20:00'
  entrants?: number;
  url: string;
  urlLabel?: string;
  /**
   * שורת הקריאה לפעולה. ריק = ברירת המחדל.
   *
   * ★ מוזרקת פנימה ולא נקראת כאן: המחולל טהור — הוא מצייר,
   *   הוא לא יודע מה זה לוח ניהול. אותה הפרדה כמו בכל שאר
   *   הכרטיס.
   */
  ctaLine?: string;
}

const ROW_ORDER: Position[] = ['GK', 'DEF', 'MID', 'FWD'];
const POS_HE: Record<Position, string> = {
  GK: 'שוער', DEF: 'הגנה', MID: 'קישור', FWD: 'חלוץ',
};

/* =================================================================== */

export function drawRevealCard(ctx: CanvasRenderingContext2D, d: RevealCardData): void {
  const t = modeTheme(d.mode);

  ctx.save();
  ctx.direction = 'rtl';
  ctx.textBaseline = 'alphabetic';
  ctx.clearRect(0, 0, CARD_W, CARD_H);

  /* ---- הרקע: המשטח של המצב, לא שחור גנרי ---- */
  ctx.fillStyle = t.surface;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  const wash = ctx.createRadialGradient(CARD_W * 0.5, 260, 40, CARD_W * 0.5, 260, 900);
  wash.addColorStop(0, `${t.accent}2e`);
  wash.addColorStop(1, `${t.accent}00`);
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, CARD_W, 1200);

  drawHeader(ctx, d, t.accent, t.accentLight, t.codeName, t.name);
  drawClaim(ctx, d, t.accentLight, t.atmosphere);
  drawRoster(ctx, d, t.accent, t.accentLight);
  drawMeta(ctx, d, t.accent, t.accentLight);
  drawFooter(ctx, d, t.accent);

  ctx.restore();
}

/* ---------------- 1 · כותרת ---------------- */
function drawHeader(
  ctx: CanvasRenderingContext2D, d: RevealCardData,
  accent: string, accentLight: string, codeName: string, modeName: string,
) {
  const H = 252;

  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, CARD_W, H);
  /* ★ ההלפטון מתחיל אחרי שורת הטקסט האחרונה (214), אחרת
     הנקודות רצות מתחת לאותיות והשורה נראית מלוכלכת. */
  halftone(ctx, 0, H - 52, CARD_W, 52, PALETTE.night, 16, 'denserDown', 0.75);

  /* סמל המצב, בקו — אותה שפה גרפית כמו בממשק. */
  drawModeMark(ctx, d.mode, CARD_W - 148, 108, 128, PALETTE.night);

  ctx.textAlign = 'right';
  ctx.font = `400 96px ${F_POSTER}`;
  ctx.fillStyle = PALETTE.night;
  ctx.fillText(modeName, CARD_W - 250, 128);

  /* ★ שם הקוד באותיות מרווחות — חותמת, לא כותרת. */
  ctx.font = `400 30px ${F_POSTER}`;
  ctx.fillStyle = 'rgba(18,17,16,.62)';
  ctx.fillText(spaced(codeName), CARD_W - 250, 176);

  ctx.font = `700 32px ${F_UI}`;
  ctx.fillStyle = 'rgba(18,17,16,.72)';
  ctx.fillText(`${d.gameweekLabel} · ${d.leagueLabel ?? 'ליגת העל'}`, CARD_W - 250, 214);

  void accentLight;
}

/* ---------------- 2 · ההצהרה ---------------- */
function drawClaim(
  ctx: CanvasRenderingContext2D, d: RevealCardData,
  accentLight: string, atmosphere: string,
) {
  ctx.textAlign = 'center';

  ctx.font = `900 104px ${F_DISPLAY}`;
  ctx.fillStyle = PALETTE.chalk;
  ctx.fillText('הנה ההרכב שלי', CARD_W / 2, 400);

  ctx.font = `700 42px ${F_UI}`;
  ctx.fillStyle = accentLight;
  ctx.fillText(d.userName, CARD_W / 2, 462);

  /* קו הפרדה דק — סוגר את ההצהרה לפני שמתחילה הרשימה. */
  ctx.strokeStyle = `${accentLight}44`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(CARD_W / 2 - 120, 500);
  ctx.lineTo(CARD_W / 2 + 120, 500);
  ctx.stroke();

  /* ★ משפט האווירה — רק כשיש מקום.
     בהרכב של חמישה נשארת רצועה ריקה של כמעט 400 פיקסלים.
     שטח לבן הוא בסדר; שטח לבן שנראה כמו כרטיס שנקטע אינו.
     בהרכב של אחת־עשרה אין מקום, והמשפט פשוט לא מצויר —
     במקום להידחס ולהתנגש בשורה הראשונה. */
  if (d.lineup.length <= 6) {
    ctx.font = `700 32px ${F_UI}`;
    ctx.fillStyle = PALETTE.chalkDim;
    ctx.fillText(clip(ctx, atmosphere, CARD_W - 160), CARD_W / 2, 556);
  }
}

/* ---------------- 3 · הסגל ---------------- */
/**
 * ★ רשימה, לא מגרש.
 *
 * הכרטיס שאחרי המחזור מצייר מגרש עם צ׳יפים, כי שם המספר על כל
 * שחקן הוא העיקר. כאן אין מספרים — יש **שמות**, והם צריכים
 * להיות גדולים וקריאים בסטורי שרואים שתי שניות.
 *
 * שורה לכל שחקן, מסודרת לפי עמדה. הקפטן בולט. זהו.
 */
function drawRoster(
  ctx: CanvasRenderingContext2D, d: RevealCardData,
  accent: string, accentLight: string,
) {
  const bandTop = d.lineup.length <= 6 ? 600 : 546;
  const bandBottom = 1450;
  const x = 64;
  const w = CARD_W - 128;

  const ordered = ROW_ORDER.flatMap((pos) => d.lineup.filter((p) => p.position === pos));
  const n = Math.max(ordered.length, 1);

  /* ★ הגובה נגזר ממספר השחקנים, ועם תקרה.
     אחת־עשרה שורות ממלאות את הרצועה; חמש היו נמתחות לשורות
     ענקיות ומגוחכות, ולכן יש תקרה של 122. */
  const rowH = Math.min(122, (bandBottom - bandTop) / n);

  /* ★ ומה שקורה כשיש עודף מקום: **מרכוז**, לא חור.
     בלי זה, כרטיס של דוביד 5 היה מציג חמישה שמות בחצי העליון
     ושטח ריק של 300 פיקסלים מתחתיהם — מה שנראה כמו כרטיס
     שנקטע באמצע, לא כמו כרטיס של חמישה שחקנים. */
  const top = bandTop + Math.max(0, (bandBottom - bandTop - rowH * n) / 2);

  const fontMain = Math.min(52, rowH * 0.46);
  const fontSub = Math.min(28, rowH * 0.24);

  ordered.forEach((p, i) => {
    const y = top + i * rowH;
    const cap = !!p.isCaptain;

    ctx.fillStyle = cap ? `${accent}2a` : 'rgba(255,255,255,.035)';
    roundRect(ctx, x, y, w, rowH - 10, 20);
    ctx.fill();

    if (cap) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3;
      roundRect(ctx, x, y, w, rowH - 10, 20);
      ctx.stroke();
    }

    const mid = y + (rowH - 10) / 2;

    /* מספר החולצה בעיגול, בקצה ימין (RTL: ההתחלה) */
    ctx.beginPath();
    ctx.arc(x + w - 46, mid, 26, 0, Math.PI * 2);
    ctx.fillStyle = cap ? accent : 'rgba(255,255,255,.09)';
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.direction = 'ltr';
    ctx.font = `400 ${Math.round(fontSub * 1.05)}px ${F_POSTER}`;
    ctx.fillStyle = cap ? PALETTE.night : PALETTE.chalk;
    ctx.fillText(p.shirt ? String(p.shirt) : '—', x + w - 46, mid + fontSub * 0.36);
    ctx.direction = 'rtl';

    /* השם */
    ctx.textAlign = 'right';
    ctx.font = `900 ${Math.round(fontMain)}px ${F_DISPLAY}`;
    ctx.fillStyle = PALETTE.chalk;
    ctx.fillText(clip(ctx, p.name, w - 340), x + w - 92, mid + fontMain * 0.22);

    /* קבוצה + עמדה, בקצה שמאל */
    ctx.textAlign = 'left';
    ctx.font = `700 ${Math.round(fontSub)}px ${F_UI}`;
    ctx.fillStyle = PALETTE.chalkDim;
    ctx.fillText(`${POS_HE[p.position]} · ${p.teamShort}`, x + 26, mid + fontSub * 0.36);

    /* ★ תג הקפטן. `x3` ולא "קפטן": המספר הוא מה שמסביר למה
       הבחירה הזו שווה ויכוח. */
    if (cap) {
      const tagW = 78;
      ctx.fillStyle = accent;
      roundRect(ctx, x + 26 + 0, y - 2, tagW, 34, 12);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.direction = 'ltr';
      ctx.font = `400 24px ${F_POSTER}`;
      ctx.fillStyle = PALETTE.night;
      ctx.fillText('x3', x + 26 + tagW / 2, y + 24);
      ctx.direction = 'rtl';
    }
  });

  void accentLight;
}

/* ---------------- 4 · המידע שהופך צפייה למשתתף ---------------- */
function drawMeta(
  ctx: CanvasRenderingContext2D, d: RevealCardData,
  accent: string, accentLight: string,
) {
  const y = 1478;
  const items: Array<[string, string]> = [];

  if (d.formation) items.push(['מערך', d.formation]);
  if (typeof d.spent === 'number') items.push(['תקציב', `${trim(d.spent)}M`]);
  if (d.deadlineLabel) items.push(['נעילה', d.deadlineLabel]);
  if (d.entrants) items.push(['משתתפים', String(d.entrants)]);

  if (items.length === 0) return;

  const gap = 16;
  const total = CARD_W - 128;
  const w = (total - gap * (items.length - 1)) / items.length;

  items.forEach(([label, value], i) => {
    // RTL: הראשון מימין
    const x = CARD_W - 64 - w - i * (w + gap);

    ctx.fillStyle = 'rgba(255,255,255,.04)';
    roundRect(ctx, x, y, w, 116, 20);
    ctx.fill();
    ctx.strokeStyle = `${accent}33`;
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, w, 116, 20);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.direction = 'ltr';
    ctx.font = `400 44px ${F_POSTER}`;
    ctx.fillStyle = accentLight;
    ctx.fillText(clip(ctx, value, w - 20), x + w / 2, y + 62);

    ctx.direction = 'rtl';
    ctx.font = `700 24px ${F_UI}`;
    ctx.fillStyle = PALETTE.chalkDim;
    ctx.fillText(label, x + w / 2, y + 96);
  });
}

/* ---------------- 5 · תחתית ---------------- */
function drawFooter(ctx: CanvasRenderingContext2D, d: RevealCardData, accent: string) {
  /* ★ 1622 ולא 1676: ה-QR הוא 172, והרצועה התחתונה מתחילה
     ב-1814. חישוב שגוי כאן חותך את שורת הקריאה לפעולה —
     וזו השורה היחידה בכרטיס שמבקשת משהו. */
  const y = 1622;

  const qr = encodeQr(d.url, 'H');
  const qrSize = 172;
  const qrX = CARD_W - 64 - qrSize;
  drawQrToCanvas(ctx, qr, qrX, y, qrSize, {
    dark: PALETTE.night, light: PALETTE.chalk, margin: 2, logoHole: 0.26,
  });
  drawSeal(ctx, qrX + qrSize / 2, y + qrSize / 2, qrSize * 0.235);

  /* ★ הקריאה לפעולה היא **אתגר**, לא הזמנה.
     "בוא תשחק" מבקש טובה. "תראה שאתה יודע יותר טוב" נותן
     לצד השני סיבה משלו. */
  ctx.textAlign = 'right';
  ctx.font = `900 44px ${F_DISPLAY}`;
  ctx.fillStyle = PALETTE.chalk;
  ctx.fillText(clip(ctx, d.ctaLine || 'חושב שאתה מבין יותר?', qrX - 60), qrX - 40, y + 54);

  ctx.font = `700 28px ${F_UI}`;
  ctx.fillStyle = PALETTE.chalkDim;
  ctx.fillText(`סרקו, בחרו ${d.lineup.length} שחקנים —`, qrX - 40, y + 100);
  ctx.fillText('אחד מכל קבוצה. זהו הכלל.', qrX - 40, y + 138);

  const barY = CARD_H - 106;
  ctx.fillStyle = accent;
  ctx.fillRect(0, barY, CARD_W, 106);
  halftone(ctx, 0, barY, CARD_W, 36, PALETTE.night, 13, 'denserUp', 0.5);

  ctx.textAlign = 'center';
  ctx.direction = 'ltr';
  ctx.font = `400 52px ${F_POSTER}`;
  ctx.fillStyle = PALETTE.night;
  ctx.fillText(d.urlLabel ?? 'DUBID.DUBELTEAM.COM', CARD_W / 2, barY + 72);
  ctx.direction = 'rtl';
}

/* =================================================================== */
/* סמל המצב, בקנבס                                                      */
/* =================================================================== */

/**
 * ★ אותם נתיבים כמו `components/ModeMark.tsx`, ב-viewBox 64.
 *
 * שני מנועי ציור, סמל אחד. אילו הקנבס היה מצייר צורה "דומה",
 * הכרטיס בסטורי היה נראה כמו מוצר אחר — ואף בדיקה לא קוראת
 * תמונות, ולכן זה היה חי לנצח.
 */
export function drawModeMark(
  ctx: CanvasRenderingContext2D, mode: ModeId,
  cx: number, cy: number, size: number, color: string,
) {
  const s = size / 64;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(s, s);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (mode === 'five') {
    ctx.stroke(new Path2D('M32 9 L54.4 25.3 L45.8 51.7 L18.2 51.7 L9.6 25.3 Z'));
    ctx.globalAlpha = 0.85;
    ctx.stroke(new Path2D(
      'M32 9 V3.4 M54.4 25.3 L59.7 23.6 M45.8 51.7 L49.1 56.3 ' +
      'M18.2 51.7 L14.9 56.3 M9.6 25.3 L4.3 23.6',
    ));
    ctx.globalAlpha = 1;
    ctx.stroke(new Path2D(
      'M36.6 22.6 H27.6 L26.4 31.4 C29.6 29.3 34.6 29.4 36.8 32.1 ' +
      'C39.4 35.3 38.6 40.6 34.8 42.6 C31.4 44.4 27.3 43.4 25.6 40.4',
    ));
  } else {
    /* ★ `Path2D.roundRect` הוא Safari 16.4+.
       בדפדפן ישן הוא זורק — ואז **כל הכרטיס** נכשל, בגלל
       פינה מעוגלת. מלבן חד הוא ויתור שאף אחד לא ישים לב אליו;
       כרטיס שלא נוצר הוא תקלה. */
    const board = new Path2D();
    if (typeof board.roundRect === 'function') {
      board.roundRect(5, 4, 54, 56, 5);
    } else {
      board.rect(5, 4, 54, 56);
    }
    ctx.stroke(board);

    ctx.globalAlpha = 0.55;
    ctx.stroke(new Path2D('M5 27.5 H59 M22 60 V52 H42 V60'));
    const circle = new Path2D();
    circle.arc(32, 27.5, 6.4, 0, Math.PI * 2);
    ctx.stroke(circle);
    ctx.globalAlpha = 1;

    const dots: Array<[number, number]> = [
      [32, 55], [12, 47], [24, 48], [40, 48], [52, 47],
      [18, 36], [32, 38], [46, 36], [16, 18], [32, 14.5], [48, 18],
    ];
    for (const [x, y] of dots) {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

/* =================================================================== */

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** אותיות מרווחות. `letter-spacing` לא קיים בקנבס. */
function spaced(s: string): string {
  return s.split('').join(' ');
}

/**
 * מייצר קנבס מוכן לשיתוף. אותה חתימה כמו `renderShareCard`.
 */
export async function renderRevealCard(
  data: RevealCardData,
  opts: { scale?: number; canvas?: HTMLCanvasElement } = {},
): Promise<HTMLCanvasElement> {
  const { scale = 1, canvas = document.createElement('canvas') } = opts;
  canvas.width = CARD_W * scale;
  canvas.height = CARD_H * scale;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('הדפדפן לא תומך ב-Canvas 2D');

  // בלי זה הפונטים עלולים לא להיות טעונים והכרטיס ייצא ב-fallback
  if (typeof document !== 'undefined' && 'fonts' in document) {
    await (document as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready;
  }

  ctx.scale(scale, scale);
  drawRevealCard(ctx, data);
  return canvas;
}
