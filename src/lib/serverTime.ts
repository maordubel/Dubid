/**
 * lib/serverTime.ts — שעון מסונכרן-שרת.
 *
 * ★ מקור: הדפוס לקוח מ-OFFSIDES (`src/lib/serverTime.js`), שכבר
 *   פתר את הבעיה הזו בפרודקשן. הותאם ל-TypeScript ונותק מתלות
 *   ישירה ב-Supabase — מזריקים פונקציה שמביאה זמן שרת, כך שאותו
 *   קוד עובד גם מול RPC וגם מול endpoint רגיל.
 *
 * ★ הבעיה
 *
 * ספירה לאחור שרצה על `Date.now()` סופרת לפי שעון המכשיר. משתמש
 * עם שעון שגוי (או שהוזז בכוונה) יראה "פתוח" אחרי הדדליין, ילחץ
 * להגיש, ויקבל דחייה מהשרת בלי להבין למה. זו לא פרצת אבטחה —
 * השרת עדיין דוחה — אבל זו חוויה גרועה ותחושת אי-הוגנות.
 *
 * ★ השיטה
 *
 * מדידה בסגנון NTP: מודדים הלוך-חזור ומניחים שהוא סימטרי, כך
 * שרגע השרת ממופה לאמצע חלון השליחה-קבלה. לוקחים כמה דגימות
 * ושומרים את זו עם ה-RTT הנמוך ביותר (הכי פחות רועשת).
 *
 * ★ כישלון שקט, בכוונה
 *
 * אם הסנכרון נכשל, ההיסט נשאר 0 והתנהגות זהה לשעון המכשיר.
 * סנכרון גרוע לעולם לא יכול להחמיר את המצב הקיים.
 */

let offsetMs = 0;
let synced = false;
let inFlight: Promise<number> | null = null;

/** מביא זמן שרת ב-epoch ms. מוזרק — הקובץ לא מכיר את Supabase. */
export type ServerTimeFetcher = () => Promise<number>;

/** תחליף ישיר ל-`Date.now()`, מתוקן להיסט השרת. */
export function serverNow(): number {
  return Date.now() + offsetMs;
}

export function serverDate(): Date {
  return new Date(serverNow());
}

export function clockOffsetMs(): number {
  return offsetMs;
}

export function isClockSynced(): boolean {
  return synced;
}

/**
 * ★ האם כדאי לסמוך על השעון.
 *
 * היסט גדול מדקה אומר שמשהו חריג — או שהמכשיר סוטה מאוד, או
 * שהרשת איטית מאוד. המסך יכול להשתמש בזה כדי להציג "הזמן
 * מתעדכן" במקום ספירה לאחור שנראית ודאית ואינה.
 */
export function isClockSuspect(): boolean {
  return Math.abs(offsetMs) > 60_000;
}

async function measureOnce(fetchServerMs: ServerTimeFetcher): Promise<{ offset: number; rtt: number }> {
  const t0 = Date.now();
  const serverMs = await fetchServerMs();
  const t1 = Date.now();
  if (!Number.isFinite(serverMs)) throw new Error('server time not numeric');
  // אמצע חלון ההלוך-חזור הוא ההערכה הטובה ביותר לרגע שבו השרת ענה.
  const midpoint = t0 + (t1 - t0) / 2;
  return { offset: serverMs - midpoint, rtt: t1 - t0 };
}

/** מסנכרן פעם אחת. קריאות מקבילות מתאחדות לאותה בקשה. */
export function syncServerTime(
  fetchServerMs: ServerTimeFetcher,
  samples = 3,
): Promise<number> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    let best: number | null = null;
    let bestRtt = Infinity;

    for (let i = 0; i < samples; i++) {
      try {
        const { offset, rtt } = await measureOnce(fetchServerMs);
        if (rtt < bestRtt) {
          bestRtt = rtt;
          best = offset;
        }
      } catch {
        /* ממשיכים לדגימה הבאה — כישלון בודד לא מפיל את הסנכרון */
      }
    }

    if (best !== null) {
      offsetMs = Math.round(best);
      synced = true;
    }
    inFlight = null;
    return offsetMs;
  })();

  return inFlight;
}

/**
 * מסנכרן ברקע: בעלייה, כל 5 דקות, וכשהטאב חוזר לפוקוס.
 * מחזיר פונקציית ניקוי.
 */
export function startClockSync(
  fetchServerMs: ServerTimeFetcher,
  intervalMs = 5 * 60_000,
): () => void {
  void syncServerTime(fetchServerMs);

  if (typeof window === 'undefined') return () => {};

  const timer = setInterval(() => void syncServerTime(fetchServerMs), intervalMs);
  // המכשיר יכול היה "לישון" שעה. חזרה לפוקוס = הזדמנות לתקן.
  const onVisible = () => {
    if (document.visibilityState === 'visible') void syncServerTime(fetchServerMs);
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/** לבדיקות בלבד — מאפס את המצב הגלובלי. */
export function __resetClockForTests(): void {
  offsetMs = 0;
  synced = false;
  inFlight = null;
}
