/**
 * share.ts — שיתוף בלחיצה אחת.
 *
 * מסלול השיתוף במובייל הוא רגיש: המשתמש לוחץ פעם אחת, ואם לא קורה
 * כלום תוך חצי שנייה — הוא עוזב. לכן:
 *
 *  1. navigator.share עם קובץ — הדרך היחידה שפותחת ישירות סטטוס
 *     וואטסאפ / Instagram Stories עם התמונה. חייבת להיקרא בתוך
 *     user gesture, ולכן renderShareCard נקרא *לפני* ולא בתוך ה-await.
 *  2. אם אין תמיכה בשיתוף קבצים — שיתוף טקסט + קישור.
 *  3. אם אין Web Share בכלל (דסקטופ) — הורדה + העתקת קישור.
 *  4. וואטסאפ ישיר — כשהמשתמש בוחר במפורש "שלח לוואטסאפ".
 *
 * שימו לב: iOS דורש שה-Blob יהיה מוכן לפני navigator.share, אחרת
 * הדפדפן חוסם את הקריאה כ"לא מתוך אינטראקציה".
 */

export interface ShareResult {
  method: 'native-file' | 'native-text' | 'download' | 'whatsapp' | 'cancelled' | 'failed';
  error?: unknown;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality = 0.95): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob נכשל'))),
      type,
      quality,
    );
  });
}

function supportsFileShare(files: File[]): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files })
  );
}

export interface ShareOptions {
  blob: Blob;
  fileName?: string;
  title?: string;
  text?: string;
  url: string;
}

/** המסלול הראשי: תמונה + טקסט, ישר לבורר השיתוף של המערכת. */
export async function shareCardImage(opts: ShareOptions): Promise<ShareResult> {
  const {
    blob,
    fileName = 'dubid-gameweek.png',
    title = 'דוביד',
    text,
    url,
  } = opts;

  const file = new File([blob], fileName, { type: blob.type || 'image/png' });

  if (supportsFileShare([file])) {
    try {
      await navigator.share({ files: [file], title, text, url });
      return { method: 'native-file' };
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return { method: 'cancelled' };
      // ממשיכים לנפילה אחורה — עדיף לשתף טקסט מאשר לא כלום
    }
  }

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url });
      return { method: 'native-text' };
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return { method: 'cancelled' };
    }
  }

  try {
    downloadBlob(blob, fileName);
    await copyToClipboard(url);
    return { method: 'download' };
  } catch (error) {
    return { method: 'failed', error };
  }
}

/**
 * וואטסאפ ישיר. וואטסאפ לא מקבל תמונה דרך URL scheme, ולכן:
 * מורידים את התמונה, ופותחים שיחה עם הטקסט + הקישור.
 * המשתמש מצרף את התמונה מהגלריה — עדיין לחיצה אחת ועוד בחירה,
 * וזה המקסימום שהפלטפורמה מאפשרת.
 */
export function shareToWhatsApp(text: string, url: string, blob?: Blob): ShareResult {
  if (blob) downloadBlob(blob, 'dubid-gameweek.png');
  const message = `${text}\n${url}`;
  const href = `https://wa.me/?text=${encodeURIComponent(message)}`;
  window.open(href, '_blank', 'noopener,noreferrer');
  return { method: 'whatsapp' };
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // משחררים אחרי שהדפדפן הספיק להתחיל את ההורדה
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** טקסט השיתוף. קצר, מתגרה, ועם המספר — זה מה שגורם ללחוץ. */
export function buildShareText(opts: {
  userName: string;
  gameweekLabel: string;
  points: number;
  rank?: number;
  totalPlayers?: number;
}): string {
  const { gameweekLabel, points, rank, totalPlayers } = opts;
  const rankPart =
    rank && totalPlayers ? ` · מקום ${rank} מתוך ${totalPlayers}` : '';
  return `${points} נקודות ב${gameweekLabel}${rankPart}. בוא תנסה לעבור אותי 👇`;
}
