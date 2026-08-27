/**
 * revealCard.ts — "ההרכב השבועי". הכרטיס שלפני המחזור.
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
 * ★ למה עיתון ולא כרטיס אפליקציה
 * ═══════════════════════════════════════════════════════════════
 *
 * הגרסה הראשונה של הכרטיס הזה הייתה רשימת שמות על רקע כהה —
 * יפה, נקייה, ונראית **בדיוק כמו כל כרטיס שיתוף אחר בסטורי.**
 * צילום מסך של אפליקציה גולל הלאה.
 *
 * מה שלא גוללים הלאה זה **עמוד ספורט משנות התשעים**: נייר
 * מצהיב, פס כותרת אדום, מגרש מודפס בנקודות, ואחת־עשרה דמויות
 * מצוירות עומדות עליו. זה לא "עיצוב רטרו" — זו הצורה שבה כל
 * אוהד כדורגל בישראל ראה הרכב בפעם הראשונה בחיים שלו.
 *
 * וזו הסיבה שהכרטיס עובד: הוא לא נראה כמו פרסומת למוצר. הוא
 * נראה כמו **גזיר עיתון עם ההרכב שלך**.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ שלושת המרכיבים, לפי סדר החשיבות
 * ═══════════════════════════════════════════════════════════════
 *
 *   1. **המגרש.** השמות על עמדות, לא ברשימה. עמדה היא החלטה.
 *   2. **הקפטן.** ההחלטה היחידה שמכפילה — כלומר ההימור הכי גלוי.
 *      עיגול אדום וסרט על הזרוע, כמו במגרש.
 *   3. **שם המאמן.** בתחתית, עם קו חתימה. הכרטיס שייך למישהו.
 *
 * ★ מה **אין** כאן, ובכוונה: ניקוד. אין עדיין. מספר מומצא ברגע
 *   הזה היה הורס בדיוק את מה שהופך את הכרטיס למעניין.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ זהות המצב, בלי לשבור את העיתון
 * ═══════════════════════════════════════════════════════════════
 *
 * פס הכותרת נשאר אדום בשני המצבים — הוא ה"מאסטהד" של
 * "ההרכב השבועי", וזה מה שהופך שני כרטיסים שונים לאותו מוצר.
 * ההבדל בין המצבים הוא **חותמת המדור** בפינה: מסגרת מוטה קלות
 * בצבע המצב, עם הסמל של המצב ושם הקוד שלו. בדיוק כמו חותמת
 * מדור בעיתון — ומאותו מקור נתונים כמו הלובי (`lib/modeTheme.ts`),
 * כך שאין hex כתוב פעמיים.
 */
import {
  CARD_W, CARD_H, F_DISPLAY, F_POSTER, F_UI, clip,
} from './shareCard.ts';
import { modeTheme, type ModeId } from './modeTheme.ts';
import { teamColor, type TeamColor } from '../data/teamColors.ts';
import type { Position } from './scoring/types.ts';

export interface RevealPlayer {
  name: string;        // שם קצר: 'אצילי'
  teamShort: string;   // 'מ.חיפה'
  /**
   * מזהה הקבוצה. ממנו נגזרת ערכת הצבעים של הדמות המצוירת.
   *
   * ★ אופציונלי בכוונה: כרטיס בלי מזהה עדיין מצויר — בערכה
   *   ניטרלית — במקום להיכשל. שיתוף שלא נוצר גרוע מחולצה אפורה.
   */
  teamId?: string;
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
   * מכפיל הקפטן, מתוך חוקי המצב **החיים** (כולל שינויי אדמין).
   *
   * ★ למה זה פרמטר ולא הקבוע 3: עד עכשיו היה כאן `'x3'` כתוב
   *   ביד. ברגע שהאדמין משנה את המכפיל, הכרטיס היה ממשיך להבטיח
   *   מספר שהמערכת כבר לא מחשבת — וזה הסוג היחיד של באג שאף
   *   בדיקה לא תופסת, כי אף בדיקה לא קוראת תמונות.
   */
  captainMultiplier?: number;
  /**
   * שורת הקריאה לפעולה. ריק = ברירת המחדל.
   *
   * ★ מוזרקת פנימה ולא נקראת כאן: המחולל טהור — הוא מצייר,
   *   הוא לא יודע מה זה לוח ניהול. אותה הפרדה כמו בכל שאר
   *   הכרטיס.
   */
  ctaLine?: string;
}

/* =================================================================== */
/* פלטת הדפוס                                                          */
/* =================================================================== */

/**
 * ★ פלטה מקומית, ולא `PALETTE` של `shareCard`.
 *
 * `PALETTE` הוא עולם כהה — לילה, זהב, גיר. הכרטיס הזה הוא עולם
 * הפוך: נייר מצהיב ודיו. לכפות עליו את הפלטה הכהה היה מחייב
 * להוסיף לה עוד עשרה צבעים שאיש מלבד הקובץ הזה לא צורך.
 */
const PAPER = '#EFE7D5';
const INK = '#12100E';
const RED = '#D93B3B';
const RED_D = '#B22A2A';
const GRASS = '#8FBE63';
const GRASS_D = '#7DAE52';
const LINE = '#F7F4EC';
const SKIN = '#D9A06B';
const HAIR = '#2B211A';
/** הילת הקריאות מאחורי שמות על הדשא. */
const HALO = '#EFF3E6';

const NEUTRAL_KIT: TeamColor = {
  primary: '#9AA0A6', secondary: '#9AA0A6', trim: '#FFFFFF',
  pattern: 'plain', ink: '#111111',
};

/** סדר השורות מהשוער ומעלה. */
const ROW_ORDER: Position[] = ['GK', 'DEF', 'MID', 'FWD'];

/* =================================================================== */

export function drawRevealCard(
  ctx: CanvasRenderingContext2D,
  d: RevealCardData,
  logo?: CanvasImageSource | null,
): void {
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textBaseline = 'alphabetic';
  ctx.clearRect(0, 0, CARD_W, CARD_H);

  drawPaper(ctx);
  drawMasthead(ctx, d, logo);
  const pitch = drawPitch(ctx, d);
  drawCoach(ctx, d, pitch.bottom + 72);
  drawStub(ctx, d);

  ctx.restore();
}

/* ---------------- 1 · הנייר ---------------- */
function drawPaper(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  /* כתם חום עדין באלכסון — נייר שהצהיב לא מצהיב אחיד. */
  const wash = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  wash.addColorStop(0, '#00000000');
  wash.addColorStop(1, '#8a6a3a18');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  grain(ctx, 0, 0, CARD_W, CARD_H, '#7d6a4a', 0.16);

  /* מסגרת כפולה — הקו הדק הפנימי הוא מה שהופך מלבן לכרטיס. */
  ctx.strokeStyle = INK;
  ctx.lineWidth = 7;
  ctx.strokeRect(32, 32, CARD_W - 64, CARD_H - 64);
  ctx.lineWidth = 2;
  ctx.strokeRect(50, 50, CARD_W - 100, CARD_H - 100);
}

/* ---------------- 2 · הלוגו, החותמת והכותרת ---------------- */
function drawMasthead(
  ctx: CanvasRenderingContext2D, d: RevealCardData, logo?: CanvasImageSource | null,
) {
  const t = modeTheme(d.mode);

  /* הלוגו. אם לא נטען — הסמל של המצב, בקו, באותו מקום. */
  if (logo) {
    ctx.drawImage(logo, CARD_W / 2 - 124, 68, 248, 248);
  } else {
    drawModeMark(ctx, d.mode, CARD_W / 2, 192, 190, INK);
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = INK;
  ctx.font = `400 28px ${F_POSTER}`;
  withSpacing(ctx, '2px', () => {
    ctx.fillText(spaced(d.urlLabel ?? 'DUBID.DUBELTEAM.COM'), CARD_W / 2, 344);
  });

  /* חותמת המדור — זהות המצב, בצבע שלו. */
  drawModeStamp(ctx, d.mode, 190, 214, t.accent, t.codeName);

  perforation(ctx, 392);

  /* ── פס הכותרת האדום ──
     בדיוק כמו בעמוד הספורט: מלבן אדום מקצה לקצה, אותיות שחורות
     כבדות ומרווחות, וקו לבן דק שמפריד אותו מהנייר. */
  const bx = 60, by = 424, bw = CARD_W - 120, bh = 104;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(bx - 5, by - 5, bw + 10, bh + 10);
  ctx.fillStyle = RED;
  ctx.fillRect(bx, by, bw, bh);
  dots(ctx, bx, by, bw, bh, RED_D, 7, 1.3, 0.3);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(bx, by, bw, bh);

  ctx.textAlign = 'center';
  ctx.fillStyle = INK;
  ctx.font = `900 74px ${F_DISPLAY}`;
  withSpacing(ctx, '6px', () => {
    ctx.fillText('ההרכב השבועי', CARD_W / 2, by + 74);
  });

  ctx.font = `700 32px ${F_UI}`;
  ctx.fillStyle = INK;
  ctx.fillText(
    `${t.name}  ·  ${d.gameweekLabel}  ·  ${d.leagueLabel ?? 'ליגת העל'}`,
    CARD_W / 2, by + bh + 44,
  );
}

/**
 * חותמת המדור. מסגרת מוטה קלות עם הסמל ושם הקוד של המצב.
 *
 * ★ למה מוטה: חותמת ישרה נראית כמו רכיב ממשק. חותמת שנטויה
 *   בשתי מעלות נראית כמו משהו שהוטבע על הנייר.
 */
function drawModeStamp(
  ctx: CanvasRenderingContext2D, mode: ModeId,
  cx: number, cy: number, color: string, codeName: string,
) {
  const w = 196, h = 92;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((-3.2 * Math.PI) / 180);

  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.lineWidth = 1.6;
  ctx.strokeRect(-w / 2 + 7, -h / 2 + 7, w - 14, h - 14);

  drawModeMark(ctx, mode, w / 2 - 40, 0, 46, color);

  ctx.textAlign = 'right';
  ctx.fillStyle = color;
  ctx.font = `700 26px ${F_UI}`;
  ctx.fillText(modeTheme(mode).name, w / 2 - 70, -2);
  ctx.font = `400 19px ${F_POSTER}`;
  ctx.globalAlpha = 0.8;
  withSpacing(ctx, '1px', () => {
    ctx.fillText(spaced(codeName), w / 2 - 70, 26);
  });

  ctx.restore();
}

/* ---------------- 3 · המגרש ---------------- */
function drawPitch(
  ctx: CanvasRenderingContext2D, d: RevealCardData,
): { bottom: number } {
  const px = 64, py = 600, pw = CARD_W - 128;

  /* ★ גובה קבוע לשני המצבים.
     בגרסה קודמת המגרש התכווץ לדוביד 5 — "חמישה על מגרש של
     אחת־עשרה נראים כמו הרכב חסר". התוצאה הייתה גרועה יותר:
     רצועת נייר ריקה של 140 פיקסלים מתחת למגרש, שנראתה כמו
     כרטיס שנקטע. מגרש מלא עם חמש דמויות פרושות נראה כמו
     הרכב של חמישה; מגרש קטן נראה כמו תקלת עימוד. */
  const ph = 940;

  ctx.fillStyle = GRASS;
  ctx.fillRect(px, py, pw, ph);

  /* פסי כיסוח רחבים ושטוחים — לא גרדיאנט. דפוס לא יודע לדהות. */
  ctx.fillStyle = GRASS_D;
  for (let i = 0; i < 7; i += 2) ctx.fillRect(px, py + i * (ph / 7), pw, ph / 7);

  /* נקודות הדפוס — זה מה שהופך ירוק ל"ירוק מודפס". */
  dots(ctx, px, py, pw, ph, '#3f6b2c', 7, 1.5, 0.34);
  grain(ctx, px, py, pw, ph, '#22401a', 0.1);

  /* קווי המגרש */
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 5;
  ctx.lineJoin = 'miter';
  ctx.strokeRect(px + 16, py + 16, pw - 32, ph - 32);
  ctx.strokeRect(px + pw / 2 - 200, py + 16, 400, 150);
  ctx.strokeRect(px + pw / 2 - 104, py + 16, 208, 62);
  ctx.beginPath();
  ctx.arc(px + pw / 2, py + 186, 58, 0.16 * Math.PI, 0.84 * Math.PI);
  ctx.stroke();

  /* קשת האמצע בתחתית — נחתכת בקו השוליים, כמו במגרש אמיתי. */
  ctx.save();
  ctx.beginPath();
  ctx.rect(px + 16, py + 16, pw - 32, ph - 32);
  ctx.clip();
  ctx.beginPath();
  ctx.arc(px + pw / 2, py + ph - 16, 92, Math.PI, 0);
  ctx.stroke();
  ctx.restore();

  /* קיילין שחור — הדשא נגמר בקו, לא בשפה מטושטשת. */
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.strokeRect(px, py, pw, ph);

  drawGoal(ctx, px + pw / 2, py - 26, 300);

  /* ---- השחקנים ---- */
  const rows = buildRows(d.lineup);
  const n = Math.max(rows.length, 1);
  const top = py + 236, bottom = py + ph - 104;

  rows.forEach((row, ri) => {
    const y = n === 1 ? bottom : bottom - ri * ((bottom - top) / (n - 1));
    row.forEach((p, i) => {
      const cx = px + pw * ((i + 1) / (row.length + 1));
      const kit = p.teamId ? teamColor(p.teamId) : NEUTRAL_KIT;
      const cap = !!p.isCaptain;

      footballer(ctx, cx, y, kit, 1.55, cap);

      /* מספר בעיגול — צהוב להרכב, אדום לקפטן. */
      const nx = cx + 34, ny = y - 42;
      ctx.beginPath();
      ctx.arc(nx, ny, 17, 0, Math.PI * 2);
      ctx.fillStyle = cap ? RED : '#F5C518';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.direction = 'ltr';
      ctx.font = `400 21px ${F_POSTER}`;
      ctx.fillStyle = cap ? '#fff' : INK;
      ctx.fillText(p.shirt ? String(p.shirt) : '', nx, ny + 8);
      ctx.direction = 'rtl';

      /* השם — שחור על הדשא, עם הילה בהירה לקריאות. */
      ctx.font = `900 27px ${F_DISPLAY}`;
      ctx.textAlign = 'center';
      const nm = clip(ctx, p.name, 210);
      ctx.lineWidth = 5;
      ctx.strokeStyle = HALO;
      ctx.lineJoin = 'round';
      ctx.strokeText(nm, cx, y + 64);
      ctx.fillStyle = INK;
      ctx.fillText(nm, cx, y + 64);

      /* הקבוצה */
      ctx.font = `400 20px ${F_POSTER}`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = HALO;
      ctx.strokeText(p.teamShort, cx, y + 88);
      ctx.fillStyle = '#2c3a25';
      ctx.fillText(p.teamShort, cx, y + 88);
    });
  });

  drawLegend(ctx, px + 14, py + ph - 78, d.captainMultiplier ?? 3);

  return { bottom: py + ph };
}

/** תיבת המקרא, בפינה השמאלית התחתונה של המגרש — כמו במקור. */
function drawLegend(
  ctx: CanvasRenderingContext2D, lx: number, ly: number, multiplier: number,
) {
  const lw = 214, lh = 64;
  ctx.fillStyle = '#F6F3EA';
  ctx.fillRect(lx, ly, lw, lh);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(lx, ly, lw, lh);

  ctx.textAlign = 'right';
  ctx.font = `700 19px ${F_UI}`;
  ctx.fillStyle = INK;
  ctx.fillText('הרכב פותח', lx + lw - 40, ly + 26);
  ctx.fillText(`קפטן ×${trim(multiplier)}`, lx + lw - 40, ly + 50);

  ctx.fillStyle = '#F5C518';
  ctx.beginPath(); ctx.arc(lx + lw - 20, ly + 20, 8, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
  ctx.fillStyle = RED;
  ctx.beginPath(); ctx.arc(lx + lw - 20, ly + 44, 8, 0, Math.PI * 2); ctx.fill();
  ctx.stroke();
}

/* ---------------- 4 · שם המאמן ---------------- */
/**
 * ★ למה זו השורה הכי חשובה בכרטיס אחרי המגרש.
 *
 * "הנה ההרכב" זה תוכן. "שם המאמן: מאור" זה **בעלות**. ברגע
 * שהשם מופיע מתחת להרכב, כל טענה נגד ההרכב היא טענה נגד מישהו —
 * וזה בדיוק מה שמייצר תגובה בסטורי במקום צפייה.
 */
function drawCoach(ctx: CanvasRenderingContext2D, d: RevealCardData, y: number) {
  const label = 'שם המאמן:';
  const name = d.userName || 'מאמן';

  ctx.font = `900 46px ${F_DISPLAY}`;
  const nameW = ctx.measureText(clip(ctx, name, 520)).width;
  ctx.font = `700 34px ${F_UI}`;
  const labelW = ctx.measureText(label).width;

  const gap = 18;
  let right = CARD_W / 2 + (labelW + gap + nameW) / 2;

  ctx.textAlign = 'right';
  ctx.fillStyle = '#00000099';
  ctx.fillText(label, right, y);

  right -= labelW + gap;
  ctx.font = `900 46px ${F_DISPLAY}`;
  ctx.fillStyle = INK;
  ctx.fillText(clip(ctx, name, 520), right, y + 2);

  /* קו החתימה — מתחת לשם בלבד, לא מתחת לתווית. */
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(right - nameW - 10, y + 16);
  ctx.lineTo(right + 10, y + 16);
  ctx.stroke();
}

/* ---------------- 5 · הספח ---------------- */
function drawStub(ctx: CanvasRenderingContext2D, d: RevealCardData) {
  perforation(ctx, CARD_H - 166);

  const meta: string[] = [];
  if (d.formation) meta.push(`מערך ${d.formation}`);
  if (typeof d.spent === 'number') meta.push(`תקציב ${trim(d.spent)}M`);
  if (d.deadlineLabel) meta.push(`נעילה ${d.deadlineLabel}`);
  if (d.entrants) meta.push(`${d.entrants} משתתפים`);

  ctx.textAlign = 'center';
  ctx.fillStyle = INK;
  ctx.font = `700 30px ${F_UI}`;
  if (meta.length) {
    ctx.fillText(clip(ctx, meta.join('  ·  '), CARD_W - 160), CARD_W / 2, CARD_H - 118);
  }

  /* ★ הקריאה לפעולה היא **אתגר**, לא הזמנה.
     "בוא תשחק" מבקש טובה. "חושב שאתה מבין יותר?" נותן לצד
     השני סיבה משלו. */
  ctx.font = `900 40px ${F_DISPLAY}`;
  ctx.fillStyle = RED_D;
  ctx.fillText(
    clip(ctx, d.ctaLine || 'חושב שאתה מבין יותר?', CARD_W - 160),
    CARD_W / 2, CARD_H - 68,
  );
}

/* =================================================================== */
/* פרימיטיבים                                                          */
/* =================================================================== */

/**
 * הדמות מהעיתון: ראש עם שיער, חולצה בצבע הקבוצה עם שרוולים,
 * מכנסיים כהים, ורגליים. קו מתאר שחור על הכל — זה מה שהופך
 * ציור לאיור מודפס ולא לצורה.
 */
function footballer(
  ctx: CanvasRenderingContext2D, x: number, y: number,
  kit: TeamColor, s: number, cap: boolean,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';

  /* רגליים */
  ctx.fillStyle = SKIN;
  for (const lx of [-6, 6]) {
    ctx.beginPath(); rr(ctx, lx - 4.2, 6, 8.4, 20, 3); ctx.fill(); ctx.stroke();
  }
  /* נעליים */
  ctx.fillStyle = INK;
  ctx.beginPath(); rr(ctx, -12, 24, 11, 5, 2); ctx.fill();
  ctx.beginPath(); rr(ctx, 1, 24, 11, 5, 2); ctx.fill();

  /* מכנסיים */
  ctx.fillStyle = INK;
  ctx.beginPath(); rr(ctx, -11, -3, 22, 12, 3); ctx.fill(); ctx.stroke();

  /* זרועות */
  ctx.fillStyle = SKIN;
  ctx.beginPath(); rr(ctx, -19, -19, 6.5, 17, 3); ctx.fill(); ctx.stroke();
  ctx.beginPath(); rr(ctx, 12.5, -19, 6.5, 17, 3); ctx.fill(); ctx.stroke();

  /* חולצה */
  const shirt = () => {
    ctx.beginPath();
    ctx.moveTo(-13, -22); ctx.lineTo(13, -22);
    ctx.lineTo(15, -4); ctx.lineTo(-15, -4);
    ctx.closePath();
  };
  ctx.fillStyle = kit.primary;
  shirt(); ctx.fill();

  if (kit.pattern === 'stripes') {
    ctx.save(); ctx.clip();
    ctx.fillStyle = kit.secondary;
    for (let i = -14; i < 16; i += 8) ctx.fillRect(i, -24, 4, 24);
    ctx.restore();
    shirt();
  } else if (kit.pattern === 'sash') {
    ctx.save(); ctx.clip();
    ctx.strokeStyle = kit.secondary;
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(-17, -24); ctx.lineTo(17, -2); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = INK; ctx.lineWidth = 2.6;
    shirt();
  }
  ctx.stroke();

  if (kit.pattern === 'sleeves') {
    ctx.fillStyle = kit.secondary;
    ctx.beginPath(); rr(ctx, -19, -19, 6.5, 10, 3); ctx.fill(); ctx.stroke();
    ctx.beginPath(); rr(ctx, 12.5, -19, 6.5, 10, 3); ctx.fill(); ctx.stroke();
  }

  /* צווארון */
  ctx.strokeStyle = kit.trim;
  ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.moveTo(-5, -22); ctx.lineTo(0, -18); ctx.lineTo(5, -22); ctx.stroke();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.6;

  /* ★ סרט הקפטן — על הזרוע, כמו במגרש.
     קודם היה תג מרחף מעל הראש; הוא התנגש בשורה שמעל ונראה
     כמו מדבקה שהודבקה על הציור. סרט הוא חלק מהשחקן. */
  if (cap) {
    ctx.fillStyle = RED;
    ctx.beginPath(); rr(ctx, -19.4, -16, 7.3, 5.5, 1.5); ctx.fill();
    ctx.lineWidth = 1.6; ctx.stroke(); ctx.lineWidth = 2.6;
  }

  /* ראש */
  ctx.fillStyle = SKIN;
  ctx.beginPath(); ctx.arc(0, -29, 7.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  /* שיער */
  ctx.fillStyle = HAIR;
  ctx.beginPath();
  ctx.arc(0, -30.5, 7.6, Math.PI * 1.08, Math.PI * 1.92);
  ctx.fill();

  ctx.restore();
}

/** שער בפרספקטיבה, בקצה העליון של המגרש. */
function drawGoal(ctx: CanvasRenderingContext2D, cx: number, y: number, w: number) {
  const h = w * 0.3, d = w * 0.16;
  ctx.save();

  ctx.fillStyle = '#e8ead9dd';
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, y + h); ctx.lineTo(cx - w / 2 + d, y);
  ctx.lineTo(cx + w / 2 - d, y); ctx.lineTo(cx + w / 2, y + h);
  ctx.closePath(); ctx.fill();

  ctx.strokeStyle = '#9aa39a';
  ctx.lineWidth = 1.2;
  for (let i = 1; i < 9; i++) {
    const t = i / 9;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2 + w * t, y + h);
    ctx.lineTo(cx - w / 2 + d + (w - 2 * d) * t, y);
    ctx.stroke();
  }
  for (let i = 1; i < 4; i++) {
    const t = i / 4;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2 + d * t, y + h * (1 - t));
    ctx.lineTo(cx + w / 2 - d * t, y + h * (1 - t));
    ctx.stroke();
  }

  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, y + h); ctx.lineTo(cx - w / 2 + d, y);
  ctx.lineTo(cx + w / 2 - d, y); ctx.lineTo(cx + w / 2, y + h);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, y + h); ctx.lineTo(cx + w / 2, y + h);
  ctx.stroke();

  ctx.restore();
}

/** קו ניקוב עם שני חורים — מה שהופך את הנייר לכרטיס שנתלש. */
function perforation(ctx: CanvasRenderingContext2D, y: number) {
  ctx.setLineDash([9, 11]);
  ctx.strokeStyle = '#00000055';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(64, y); ctx.lineTo(CARD_W - 64, y);
  ctx.stroke();
  ctx.setLineDash([]);

  for (const x of [32, CARD_W - 32]) {
    ctx.fillStyle = PAPER;
    ctx.beginPath(); ctx.arc(x, y, 21, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.arc(x, y, 21, 0, Math.PI * 2); ctx.stroke();
  }
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number,
            w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** גרעיניות נייר. */
function grain(ctx: CanvasRenderingContext2D, x: number, y: number,
               w: number, h: number, color: string, a: number) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = color;
  const n = Math.round((w * h) / 600);
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = a * Math.random();
    ctx.fillRect(x + Math.random() * w, y + Math.random() * h, 1.6, 1.6);
  }
  ctx.restore();
}

/** רשת נקודות דפוס אחידה. */
function dots(ctx: CanvasRenderingContext2D, x: number, y: number,
              w: number, h: number, color: string,
              step: number, r: number, a: number) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = color;
  ctx.globalAlpha = a;
  for (let ry = 0; ry < h; ry += step) {
    for (let rx = 0; rx < w; rx += step) {
      ctx.beginPath();
      ctx.arc(x + rx + ((ry / step) % 2 ? step / 2 : 0), y + ry, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * ★ `ctx.letterSpacing` הוא Chrome 99+ / Safari 17.4.
 *   בדפדפן ישן הוא פשוט לא קיים — הכתיבה אליו שקטה, אבל
 *   האיפוס אחריה היה זורק. לכן העטיפה, ולכן ה-finally.
 */
function withSpacing(ctx: CanvasRenderingContext2D, value: string, draw: () => void) {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  const had = typeof c.letterSpacing === 'string';
  if (had) c.letterSpacing = value;
  try { draw(); } finally { if (had) c.letterSpacing = '0px'; }
}

/**
 * מסדר את ההרכב לשורות מגרש: שוער למטה, חלוצים למעלה.
 * שורה ריקה נשמטת — כך אותו קוד משרת 11 ו-5 בלי תנאי מצב.
 */
function buildRows(lineup: RevealPlayer[]): RevealPlayer[][] {
  return ROW_ORDER
    .map((pos) => lineup.filter((p) => p.position === pos))
    .filter((row) => row.length > 0);
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

    const dotsAt: Array<[number, number]> = [
      [32, 55], [12, 47], [24, 48], [40, 48], [52, 47],
      [18, 36], [32, 38], [46, 36], [16, 18], [32, 14.5], [48, 18],
    ];
    for (const [x, y] of dotsAt) {
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

/** אותיות מרווחות. גיבוי ל-`letterSpacing` בדפדפן ישן. */
function spaced(s: string): string {
  return s.split('').join(' ');
}

/**
 * ★ הלוגו נטען פעם אחת לכל חיי העמוד.
 *
 * בלי המטמון, כל לחיצה על "שתף" הייתה מפעילה בקשת רשת נוספת;
 * ובמצב לא־מקוון הכרטיס היה נתקע. ההבטחה נשמרת גם כשהיא
 * נכשלת — `null` הוא תוצאה תקפה, והכרטיס מצייר את הסמל במקום.
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
  const logo = await loadLogo();

  ctx.scale(scale, scale);
  drawRevealCard(ctx, data, logo);
  return canvas;
}
