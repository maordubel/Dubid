/**
 * lib/passCard.ts — "כרטיס המנוי". התמונה שהמשתמש שומר.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ מה זה, ולמה זה תמונה ולא מסך
 * ═══════════════════════════════════════════════════════════════
 *
 * אורח בדוביד בנה קבוצה בלי להירשם. הזהות שלו חיה בדפדפן אחד,
 * ואם הדפדפן הזה ייעלם — היא תיעלם איתו.
 *
 * הפתרון הוא מפתח. השאלה היא **איפה המשתמש ישמור אותו**, ויש
 * לזה תשובה אחת מעשית: איפה שהוא כבר שומר דברים חשובים —
 * בגלריה, ובצ׳אט עם עצמו.
 *
 * לכן זו לא הודעה עם קוד להעתקה. זו **תמונה**:
 *
 *   · אפשר לשמור אותה בלחיצה אחת, בלי חשבון ובלי הרשאה.
 *   · אפשר לשלוח אותה לעצמך בוואטסאפ ולמצוא אותה בחיפוש.
 *   · היא שורדת ניקוי דפדפן, החלפת טלפון, וגלישה פרטית —
 *     שלושת המקרים שבגללם המפתח קיים מלכתחילה.
 *   · יש בה QR, ולכן אין צורך להקליד עשרה תווים.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★★ למה זה נראה כמו כרטיס למגרש ★★
 * ═══════════════════════════════════════════════════════════════
 *
 * אותה שפה של כרטיס הסטורי ושל הלובי — נייר, דיו, חותם. וזו לא
 * עקביות לשמה:
 *
 * "קוד גיבוי" הוא משהו טכני שמאבדים. **כרטיס מנוי** הוא חפץ
 * ששייך למישהו, עם שם עליו, ואנשים לא זורקים כאלה. אותו מידע
 * בדיוק, שני יחסים שונים אליו לגמרי.
 *
 * ★ מה שאין כאן בכוונה: אזהרות.
 *   "שמור במקום בטוח!" ו"אל תשתף עם אף אחד!" הופכים מתנה
 *   לאחריות, ואחריות נדחית. יש שורה אחת שקטה בתחתית, וזהו.
 *
 * 1080×1920 — אותה מידה כמו כרטיס הסטורי, ולכן היא נכנסת
 * לסטטוס וואטסאפ ולסטורי אינסטגרם בלי חיתוך.
 */
import {
  CARD_W, CARD_H, F_DISPLAY, F_POSTER, F_UI,
  PALETTE, roundRect, halftone, clip,
} from './shareCard.ts';
import { PRESS } from './pressPalette.ts';
import { encodeQr, drawQrToCanvas } from './qr.ts';

export interface PassCardData {
  /** המפתח כפי שהוא מוצג — עם מקפים. */
  pretty: string;
  /** הקישור שנכנס ל-QR. כולל את המפתח ב-fragment. */
  link: string;
  /** שם המאמן. הכרטיס שייך למישהו. */
  userName: string;
  /** שם הקבוצה, אם יש. */
  teamName?: string | null;
  /** לתחתית: "הונפק 28.08.2026". */
  issuedLabel: string;
  urlLabel: string;
}

/* ================================================================== */
/* עזרים                                                              */
/* ================================================================== */

/**
 * ★ הדפסה לא מדויקת — אותו טריק כמו בכל שאר המוצר.
 *
 * טקסט שחור נקי נראה כמו PDF. שתי שכבות בהיסט של פיקסל, אדומה
 * וכחלחלה, נראות כמו דפוס זול משנות התשעים — וזה כל ההבדל בין
 * "מסמך" לבין "כרטיס".
 */
function misprint(ctx: CanvasRenderingContext2D, draw: () => void, ink: string) {
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = 'rgba(196,52,47,.75)';
  ctx.translate(2, 0); draw();
  ctx.fillStyle = 'rgba(80,150,190,.45)';
  ctx.translate(-4, 0); draw();
  ctx.restore();

  ctx.fillStyle = ink;
  draw();
}

/** קו ניקוב — מה שהופך מלבן לשובר שנתלש. */
function perforation(ctx: CanvasRenderingContext2D, y: number, x0: number, x1: number) {
  ctx.save();
  ctx.fillStyle = 'rgba(18,16,14,.38)';
  for (let x = x0; x < x1; x += 22) ctx.fillRect(x, y, 11, 3);
  ctx.restore();

  // חצאי העיגולים בקצוות — הסימן שהעין קוראת כ"כרטיס"
  ctx.save();
  ctx.fillStyle = PALETTE.night;
  ctx.beginPath(); ctx.arc(x0 - 26, y + 1.5, 26, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x1 + 26, y + 1.5, 26, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/* ================================================================== */
/* הציור                                                              */
/* ================================================================== */

export function drawPassCard(
  ctx: CanvasRenderingContext2D,
  d: PassCardData,
  logo: HTMLImageElement | null,
): void {
  /* ---------------- הרקע ---------------- */
  ctx.fillStyle = PALETTE.night;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  halftone(ctx, 0, 0, CARD_W, CARD_H, PALETTE.toto, 26, 'denserDown', 0.1);

  /* ---------------- גוף הכרטיס ---------------- */
  const M = 76;
  const cardX = M;
  const cardY = 210;
  const cardW = CARD_W - M * 2;
  /* ★ הגובה נגזר מהתוכן ולא מהמסך.
     אחרי שהחותם ירד נפתח רווח מת בין ה-QR לבין התחתית, והוא
     נראה כמו משהו שלא נטען. */
  const cardH = CARD_H - cardY - 322;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.55)';
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 22;
  ctx.fillStyle = PRESS.paper;
  roundRect(ctx, cardX, cardY, cardW, cardH, 26);
  ctx.fill();
  ctx.restore();

  halftone(ctx, cardX, cardY, cardW, cardH, '#8A7A5A', 9, 'solid', 0.12);

  /* מסגרת כפולה — קו עבה וקו דק, כמו בכל כותרת מדור במוצר */
  ctx.strokeStyle = PRESS.ink;
  ctx.lineWidth = 5;
  roundRect(ctx, cardX + 16, cardY + 16, cardW - 32, cardH - 32, 14); ctx.stroke();
  ctx.lineWidth = 1.6;
  roundRect(ctx, cardX + 27, cardY + 27, cardW - 54, cardH - 54, 8); ctx.stroke();

  /* ---------------- הלוגו מעל הכרטיס ---------------- */
  if (logo) {
    const lw = 300;
    const lh = lw * (logo.height / logo.width || 0.32);
    ctx.save();
    ctx.globalAlpha = 0.96;
    ctx.filter = 'brightness(0) invert(1)';
    ctx.drawImage(logo, (CARD_W - lw) / 2, cardY - lh - 46, lw, lh);
    ctx.restore();
  } else {
    ctx.fillStyle = PALETTE.chalk;
    ctx.font = `700 96px ${F_DISPLAY}`;
    ctx.textAlign = 'center';
    ctx.fillText('דוביד', CARD_W / 2, cardY - 60);
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = PALETTE.toto;
  ctx.font = `700 30px ${F_UI}`;
  ctx.fillText(d.urlLabel, CARD_W / 2, cardY - 24);

  /* ---------------- כותרת הכרטיס ---------------- */
  let y = cardY + 108;

  ctx.textAlign = 'center';
  ctx.fillStyle = '#6E6558';
  ctx.font = `700 27px ${F_UI}`;
  ctx.fillText('כ ר ט י ס   ה מ נ ו י', CARD_W / 2, y);

  y += 82;
  misprint(ctx, () => {
    ctx.textAlign = 'center';
    ctx.font = `700 78px ${F_DISPLAY}`;
    ctx.fillText('הכניסה שלך', CARD_W / 2, y);
  }, PRESS.ink);

  y += 46;
  ctx.fillStyle = '#5C5348';
  ctx.font = `400 30px ${F_UI}`;
  ctx.fillText('כל מכשיר · בלי סיסמה · בלי הרשמה', CARD_W / 2, y);

  /* ---------------- בעל הכרטיס ---------------- */
  y += 74;
  ctx.strokeStyle = 'rgba(18,16,14,.22)';
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(cardX + 70, y); ctx.lineTo(CARD_W - cardX - 70, y); ctx.stroke();

  y += 56;
  ctx.fillStyle = '#6E6558';
  ctx.font = `700 26px ${F_UI}`;
  ctx.fillText('שם המאמן', CARD_W / 2, y);

  y += 52;
  ctx.fillStyle = PRESS.ink;
  ctx.font = `700 54px ${F_DISPLAY}`;
  ctx.fillText(clip(ctx, d.userName || 'מאמן', cardW - 200), CARD_W / 2, y);

  if (d.teamName) {
    y += 42;
    ctx.fillStyle = '#5C5348';
    ctx.font = `700 32px ${F_UI}`;
    ctx.fillText(clip(ctx, d.teamName, cardW - 220), CARD_W / 2, y);
  }

  /* ---------------- קו הניקוב ---------------- */
  y += 66;
  perforation(ctx, y, cardX + 30, CARD_W - cardX - 30);

  /* ---------------- המפתח ---------------- */
  y += 78;
  ctx.fillStyle = '#6E6558';
  ctx.font = `700 26px ${F_UI}`;
  ctx.fillText('ה מ פ ת ח   ש ל ך', CARD_W / 2, y);

  y += 26;
  const keyH = 118;
  const keyW = cardW - 140;
  const keyX = (CARD_W - keyW) / 2;

  ctx.fillStyle = PRESS.ink;
  roundRect(ctx, keyX, y, keyW, keyH, 10);
  ctx.fill();

  /*
   * ★★ המפתח מצויר LTR בתוך עמוד RTL ★★
   *
   * `AB34-CD67-KM` הוא מחרוזת לטינית. קנבס לא מיישר טקסט לפי
   * כיוון, אבל **סדר התווים** בתוך המחרוזת כן נשמר — ולכן
   * הבעיה האמיתית כאן היא ריווח: מפתח בן עשרה תווים ברצף
   * צפוף אי אפשר להקליד מצילום מסך בלי לטעות.
   *
   * לכן ריווח אותיות גדול, פונט כבד, וקיבוץ במקפים.
   */
  ctx.textAlign = 'center';
  ctx.fillStyle = PALETTE.goldLight;
  ctx.font = `700 62px ${F_POSTER}`;
  const spaced = d.pretty.split('').join(' ');
  ctx.fillText(clip(ctx, spaced, keyW - 40), CARD_W / 2, y + keyH / 2 + 22);

  y += keyH + 54;

  /* ---------------- ה-QR ---------------- */
  /*
   * ★ ה-QR הוא הדרך הראשית, והמפתח המודפס הוא הגיבוי שלו.
   *
   * מי שסורק לא מקליד כלום ולא יכול לטעות. מי שסורק ממכשיר
   * אחר לא צריך אפילו לפתוח את האתר קודם.
   *
   * ECC ברמה 'Q' — הכרטיס עובר בוואטסאפ, נדחס, ולפעמים מצולם
   * מהמסך. תיקון שגיאות נמוך היה שורד את המסך ולא את הצילום.
   */
  const qrSize = 356;
  const qrX = (CARD_W - qrSize) / 2;

  try {
    const qr = encodeQr(d.link, 'Q');
    ctx.save();
    ctx.fillStyle = PRESS.card;
    roundRect(ctx, qrX - 16, y - 16, qrSize + 32, qrSize + 32, 12);
    ctx.fill();
    ctx.restore();
    drawQrToCanvas(ctx, qr, qrX, y, qrSize, {
      dark: PRESS.ink, light: PRESS.card, margin: 1,
    });
  } catch {
    /* ★ QR שנכשל לא מבטל את הכרטיס.
       המפתח המודפס למעלה עדיין עובד, וכרטיס בלי ריבוע עדיף
       על מסך שגיאה במקום כרטיס. */
    ctx.fillStyle = '#6E6558';
    ctx.font = `400 26px ${F_UI}`;
    ctx.fillText('הקלידו את המפתח באתר', CARD_W / 2, y + 40);
  }

  y += qrSize + 56;
  ctx.fillStyle = '#5C5348';
  ctx.font = `400 28px ${F_UI}`;
  ctx.fillText('סרקו — ותיכנסו ישירות', CARD_W / 2, y);

  /* ---------------- תחתית הכרטיס ---------------- */
  const footY = cardY + cardH - 54;
  ctx.fillStyle = '#7B7264';
  ctx.font = `400 24px ${F_UI}`;
  ctx.textAlign = 'right';
  ctx.fillText(d.issuedLabel, CARD_W - cardX - 56, footY);
  ctx.textAlign = 'left';
  ctx.fillText('שמרו לעצמכם', cardX + 56, footY);

  /*
   * ★ כאן ישב חותם, והוא ירד.
   *
   * `drawSeal` מצויר לרקע כהה; על נייר בהיר, בשקיפות נמוכה, הוא
   * לא נקרא כחותם אלא כ**כתם** — וכתם על כרטיס נראה כמו תקלת
   * הדפסה, לא כמו עיטור. הרווח שהוא תפס עבר ל-QR, שהוא הדבר
   * היחיד כאן שמישהו באמת ישתמש בו.
   */

  /* ---------------- מתחת לכרטיס ---------------- */
  ctx.textAlign = 'center';
  ctx.fillStyle = PALETTE.chalkDim;
  ctx.font = `400 28px ${F_UI}`;
  ctx.fillText('מי שיש לו את הכרטיס — נכנס לחשבון.', CARD_W / 2, CARD_H - 132);
  ctx.fillText('כדאי לשמור אותו רק אצלך.', CARD_W / 2, CARD_H - 92);
}

/* ================================================================== */
/* טעינת הלוגו + רינדור                                                */
/* ================================================================== */

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

export async function renderPassCard(
  data: PassCardData,
  opts: { scale?: number; canvas?: HTMLCanvasElement } = {},
): Promise<HTMLCanvasElement> {
  const { scale = 1, canvas = document.createElement('canvas') } = opts;
  canvas.width = CARD_W * scale;
  canvas.height = CARD_H * scale;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('הדפדפן לא תומך ב-Canvas 2D');

  if (typeof document !== 'undefined' && 'fonts' in document) {
    await (document as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready;
  }
  const logo = await loadLogo();

  ctx.scale(scale, scale);
  drawPassCard(ctx, data, logo);
  return canvas;
}

/**
 * הטקסט שנוסע עם התמונה בוואטסאפ.
 *
 * ★ הוא כתוב **בגוף ראשון, אל עצמי**.
 *
 * המשתמש שולח את זה לעצמו. הודעה שכתובה כמו הודעה מהמערכת
 * ("שלום! להלן קוד הגישה שלך") נקראת כספאם ונמחקת. הודעה
 * שנראית כמו פתק שהוא כתב לעצמו — נשמרת.
 *
 * ★ והקישור אחרון, בשורה נפרדת: ככה וואטסאפ מייצר לו תצוגה
 *   מקדימה, וככה הוא נמצא בחיפוש לפי המילה "דוביד".
 */
export function buildPassMessage(d: PassCardData): string {
  return [
    `הכרטיס שלי בדוביד ⚽ (${d.userName})`,
    `מפתח: ${d.pretty}`,
    '',
    d.link,
  ].join('\n');
}

/** שם הקובץ שנשמר. עברית בשם קובץ שוברת בחלק מהמכשירים. */
export function passFileName(): string {
  return `dubid-pass-${new Date().toISOString().slice(0, 10)}.png`;
}
