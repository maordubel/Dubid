/**
 * lib/leads.ts — מה שהמשתמש בחר למסור, ואיך אפשר לקחת בחזרה.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ הכלל היחיד שהקובץ הזה אוכף
 * ═══════════════════════════════════════════════════════════════
 *
 * **שום דבר לא נשמר בלי שהמשתמש הקליד אותו והגיש אותו.**
 *
 * אין כאן איסוף פסיבי: לא IP, לא user-agent, לא טביעת אצבע של
 * דפדפן, ולא "התחלת להקליד ולא סיימת". כל אלה טכנית אפשריים
 * וכולם היו הופכים את המשפט "אתה לא על החכה שלנו" למשפט שאי
 * אפשר לומר בפנים ישרות.
 *
 * ★ הוולידציה כאן זהה לזו שבמסד (`game.capture_lead`).
 *   טופס שמקבל מה שהשרת דוחה מייצר שגיאה שנראית כמו תקלה
 *   שלנו — והמשתמש מוותר במקום לתקן תו אחד.
 */
import { supabase } from './supabase.ts';

/** אותו ביטוי בדיוק כמו ה-CHECK במסד. */
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function emailLooksValid(email: string): boolean {
  return EMAIL_RE.test(email.trim().toLowerCase());
}

export interface CaptureInput {
  email: string;
  /** תזכורות. **כבוי כברירת מחדל, תמיד.** */
  consent: boolean;
  /** באיזה מסך נלכד. משמש כדי לדעת איזו נקודה עובדת. */
  source: string;
  gameweekCode?: string;
}

export async function captureLead(
  { email, consent, source, gameweekCode }: CaptureInput,
): Promise<void> {
  const clean = email.trim().toLowerCase();
  if (!emailLooksValid(clean)) throw new Error('EMAIL_INVALID');

  const { error } = await supabase.rpc('capture_lead', {
    p_email: clean,
    p_consent: !!consent,
    p_source: source,
    p_gw: gameweekCode ?? null,
  });
  if (error) throw new Error(error.message.includes('EMAIL') ? 'EMAIL_INVALID' : 'SAVE_FAILED');
}

/**
 * ★ "תשכחו אותי" חייבת להיות כפתור, לא פנייה לתמיכה.
 *
 * זה מה שהופך את השארת המייל להחלטה **הפיכה** — וזו הסיבה
 * המעשית שאנשים בכלל משאירים אותו. מנגנון שקשה לצאת ממנו
 * מוריד את שיעור הכניסה אליו הרבה יותר ממה שהוא מרוויח.
 */
export async function forgetMe(): Promise<void> {
  try {
    await supabase.rpc('forget_me');
  } catch {
    /* אם זה נכשל, המשתמש עדיין יכול לבקש שוב. לא מציגים לו שגיאה
       על פעולה שהיא ממילא ניקיון. */
  }
}

export interface MyLead {
  email: string | null;
  consent: boolean;
}

/** מה שמור עליי. מוצג במסך החשבון בלי שצריך לבקש. */
export async function myLead(): Promise<MyLead> {
  try {
    const { data, error } = await supabase.rpc('my_lead');
    if (error || !data) return { email: null, consent: false };
    return data as MyLead;
  } catch {
    return { email: null, consent: false };
  }
}
