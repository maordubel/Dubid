/**
 * state/usePromo.ts — החיבור בין תוכנית השיווק לבין המסך.
 *
 * ★ למה זו שכבה נפרדת
 *
 * `lib/growth.ts` הוא טהור: בלי דפדפן, בלי אחסון, בלי שעון. אפשר
 * לבדוק אותו במלואו. כאן — ורק כאן — הוא נפגש עם `localStorage`
 * ועם המצב האמיתי של המשתמש.
 *
 * ההפרדה הזו היא מה שמאפשר לבדוק "מה קורה אחרי שלוש חשיפות" בלי
 * לפתוח דפדפן, ולשנות מסר בלי לגעת באחסון.
 *
 * ★ אחסון שלא מפיל את האפליקציה
 *
 * גלישה פרטית זורקת ב-`localStorage`. כל גישה עטופה, וכישלון
 * מתורגם ל"אין היסטוריה" — הבאנר יוצג, ולא יקרוס דבר.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  emptyFrequency, pickPromo, recordDismiss, recordImpression, rollGameweek,
  shouldShow, type FrequencyState, type GrowthContext, type Promo,
} from '../lib/growth.ts';

const KEY = 'dubid.promo.v1';

function read(gameweek: number): FrequencyState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyFrequency(gameweek);
    const parsed = JSON.parse(raw) as FrequencyState;
    // מבנה זר באחסון (גרסה ישנה, עריכה ידנית) לא יפיל את המסך.
    if (typeof parsed?.gameweek !== 'number' || typeof parsed?.impressions !== 'object') {
      return emptyFrequency(gameweek);
    }
    return rollGameweek(parsed, gameweek);
  } catch {
    return emptyFrequency(gameweek);
  }
}

function write(state: FrequencyState): void {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

export interface UsePromoResult {
  /** מה להציג, או `null` אם אין. */
  promo: Promo | null;
  dismiss: () => void;
  /** נקרא בלחיצה. כרגע רק לצורך הרחבה עתידית לאנליטיקס. */
  open: (promo: Promo) => void;
}

export function usePromo(ctx: GrowthContext, gameweekNumber: number): UsePromoResult {
  const [freq, setFreq] = useState<FrequencyState>(() => read(gameweekNumber));

  // המסר עצמו נגזר מההקשר בלבד — דטרמיניסטי, בלי אקראיות.
  const candidate = useMemo(() => pickPromo(ctx), [ctx]);
  const visible = shouldShow(freq, candidate.id, gameweekNumber);

  /*
   * ★ החשיפה נרשמת פעם אחת לכל מסר, ולא בכל רינדור.
   *
   * הבאנר יושב בלובי, והלובי מרנדר מחדש כל שנייה בגלל השעון.
   * ספירה בכל רינדור הייתה שורפת את תקרת החשיפות תוך שלוש שניות
   * והבאנר היה נעלם לנצח. התלות היא במזהה המסר, לא באובייקט.
   */
  useEffect(() => {
    if (!visible) return;
    setFreq((prev) => {
      const next = recordImpression(prev, candidate.id, gameweekNumber);
      write(next);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate.id, gameweekNumber, visible]);

  const dismiss = useCallback(() => {
    setFreq((prev) => {
      const next = recordDismiss(prev, gameweekNumber);
      write(next);
      return next;
    });
  }, [gameweekNumber]);

  const open = useCallback((_promo: Promo) => {
    // הניווט עצמו נעשה על ידי ה-`<a>` בקומפוננטה. כאן רק נקודת
    // חיבור עתידית — בלי לשלוח כלום בינתיים.
  }, []);

  return { promo: visible ? candidate : null, dismiss, open };
}
