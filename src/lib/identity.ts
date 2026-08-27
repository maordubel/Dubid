/**
 * lib/identity.ts — מי המשתמש.
 *
 * ═══════════════════════════════════════════════════════════════
 * שלוש דרכים להיות מישהו בדוביד
 * ═══════════════════════════════════════════════════════════════
 *
 *  1. **אורח** (ברירת מחדל) — `signInAnonymously()`. אין טופס, אין
 *     אימייל, אין סיסמה. המשתמש נכנס ומשחק. זה הכלל הראשון במוצר,
 *     והוא נשאר.
 *
 *  2. **קוד חד־פעמי** — האורח מבקש קוד בן שש תווים, מקליד אותו
 *     במכשיר שני, וממשיך מאותו מקום. זה מה שהופך "אורח" מ"זהות
 *     של דפדפן" ל"זהות של אדם".
 *
 *  3. **חשבון אופסיידס** — למי שכבר יש. ראו למטה.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ איך "אותו משתמש" עובד בין שני פרויקטים נפרדים
 * ═══════════════════════════════════════════════════════════════
 *
 * לשני הפרויקטים יש `auth.users` נפרד. אין "אותו משתמש" ברמת
 * המסד, ואי אפשר להעמיד פנים שיש. מה שכן אפשר:
 *
 *      אופסיידס  =  ספק הזהות   (הוא זה שיש לו את המשתמשים)
 *      דוביד     =  מחזיק מיפוי  (offsides_user_id → dubid auth_id)
 *
 * הזרימה, וכולה בלי לגעת בקוד של אופסיידס:
 *
 *   1. המשתמש מקליד את המייל שלו בדוביד.
 *   2. דוביד קורא ל-`signInWithOtp` **על פרויקט אופסיידס**, עם
 *      `shouldCreateUser: false`. משתמש שאינו קיים שם — נדחה.
 *      זה בדיוק מה שביקשנו: לא נרשמים מחדש.
 *   3. אופסיידס שולח קוד למייל. המשתמש מקליד אותו בדוביד.
 *   4. דוביד מאמת מול אופסיידס ומקבל טוקן.
 *   5. הטוקן נשלח ל-Edge Function `link-offsides` בדוביד. השרת —
 *      ולא הדפדפן — מוודא אותו מול אופסיידס, שומר את המיפוי,
 *      ומחזיר סשן של דוביד.
 *
 * ★ למה שלב 5 חייב להיות בשרת: הדפדפן יכול לשלוח כל טוקן שירצה.
 *   רק צד שרת יכול לשאול את אופסיידס "הטוקן הזה באמת שלך?".
 *
 * ★ מה קורה להיסטוריה של האורח: אם זו הפעם הראשונה שהחשבון הזה
 *   מקושר — הוא נצמד למשתמש האורח הנוכחי, וכל מה שנבנה נשמר.
 *   אם הוא כבר מקושר למשתמש דוביד אחר — **אותו** משתמש מנצח,
 *   כי בו יש ההיסטוריה האמיתית.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ נפילה חיננית
 * ═══════════════════════════════════════════════════════════════
 *
 * אם הרשת נופלת או Supabase לא זמין, `ensureIdentity` מחזיר זהות
 * זמנית עם `online: false`. שום מסך לא נשבר — אבל שום דבר גם לא
 * נספר, וזה בדיוק מה שהמסך צריך לומר. זהות "מקומית" שנראית
 * אמיתית היא הבטחה שהמוצר לא יכול לקיים.
 */
import { supabase, offsidesAuthClient } from './supabase.ts';

export interface Identity {
  /** מזהה ה-auth. זה ה-userId שכל שאר המוצר מכיר. */
  id: string;
  displayName: string;
  /**
   * ★ אורח = נכנס בלי הרשמה.
   *
   * זה **לא** סוג משתמש נחות. אורח משחק, מדורג, ומופיע בטבלה
   * בדיוק כמו כולם. הדגל משפיע רק על מה שהמוצר *מציע* לו —
   * ובעיקר על ההצעה לשמור את מה שהוא בנה.
   */
  isGuest: boolean;
  username: string | null;
  avatar: string | null;
  referralCode: string | null;
  offsidesUserId: string | null;
  /** `false` = זהות מקומית בלבד, בלי שרת. אין סנכרון בין מכשירים. */
  online: boolean;
}

/**
 * ★★ אין כאן יותר `localStorage`. ★★
 *
 * עד הסבב הזה שם התצוגה ישב גם במכשיר, ו-`fromSession` העדיף
 * אותו על פני מה שהשרת החזיר. התוצאה: מי ששינה שם בטלפון ראה
 * במחשב את השם הישן — לנצח, כי המכשיר תמיד ניצח.
 *
 * עכשיו השם חי ב-`game.users.display_name` בלבד. עד שהשרת עונה
 * הוא ריק, וזה נכון: שם ריק לרגע עדיף על שם שגוי לתמיד.
 *
 * ⚠ מה שכן יושב במכשיר, ואין ברירה: **סשן ההזדהות של Supabase.**
 *   הוא לא נתון של המשחק — הוא המפתח שמוכיח מי אתה מול השרת,
 *   בדיוק כמו עוגיית התחברות בכל אתר. בלעדיו כל רענון היה
 *   יוצר משתמש חדש.
 */

let current: Identity | null = null;
const listeners = new Set<(id: Identity) => void>();

function emit() {
  if (current) for (const cb of listeners) cb(current);
}

export function subscribeToIdentity(cb: (id: Identity) => void): () => void {
  listeners.add(cb);
  if (current) cb(current);
  return () => listeners.delete(cb);
}

/** הזהות הנוכחית, סינכרונית. `null` עד ש-`ensureIdentity` הסתיים. */
export function currentIdentity(): Identity | null {
  return current;
}

/**
 * שם התצוגה הידוע כרגע. סינכרוני, כי הוא נקרא בתוך רינדור.
 *
 * מגיע מהזהות שנטענה מהשרת. ריק עד שהיא מגיעה — ואז
 * `subscribeToIdentity` מרנדר מחדש.
 */
export function storedDisplayName(): string {
  return current?.displayName ?? '';
}

/**
 * שינוי שם.
 *
 * ★ המסך מתעדכן מיד, אבל הכתיבה היא לשרת בלבד.
 *
 * אם הכתיבה נכשלת, השם **חוזר**. קודם הוא היה נשמר מקומית
 * וממשיך להיראות "שמור" — ואז מופיע בטבלת הדירוג של כולם בשם
 * הישן, כי שם יושב מה שבמסד. עדיף להחזיר ולתת לנסות שוב.
 */
export async function setDisplayName(name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) return;

  const before = current?.displayName ?? '';
  if (current) { current = { ...current, displayName: clean }; emit(); }

  try {
    const { error } = await supabase.rpc('ensure_profile', { p_display_name: clean });
    if (error) throw error;
  } catch (err) {
    if (current) { current = { ...current, displayName: before }; emit(); }
    throw err;
  }
}

/**
 * ★ זהות מקומית — רשת הביטחון.
 *
 * אותו מפתח ואותו פורמט שהמוצר השתמש בהם עד היום, כדי שמי שכבר
 * שיחק לא יאבד את הטיוטות שלו במעבר.
 */
function localFallback(): Identity {
  /* ★ מזהה קבוע, ולא אקראי-ונשמר.
     מזהה אקראי שנשמר במכשיר נראה כמו זהות אמיתית ואינו כזה:
     הוא לא קיים בשרת, שום הגשה שלו לא תיספר, והוא לא יופיע
     בשום דירוג. `online: false` הוא מה שהמסך צריך לדעת, ומזהה
     שנראה אמיתי רק מסתיר את זה. */
  const id = 'offline';
  return {
    id, displayName: current?.displayName ?? '', isGuest: true,
    username: null, avatar: null, referralCode: null,
    offsidesUserId: null, online: false,
  };
}

/** מה ש-`game.me()` מחזיר. משקף את db/10 §4. */
interface MeRow {
  displayName?: string | null;
  username?: string | null;
  avatar?: string | null;
  isGuest?: boolean | null;
  referralCode?: string | null;
  offsidesUserId?: string | null;
  isAdmin?: boolean | null;
}

async function fromSession(userId: string): Promise<Identity> {
  let profile: MeRow | null = null;

  try {
    // `game.me()` ולא `select` על הטבלה: הטבלה מחזיקה גם
    // `offsides_email`, והפונקציה מחזירה רק את השורה של הקורא
    // ורק את השדות שהוא צריך.
    const { data } = await supabase.rpc('me');
    profile = (data ?? null) as MeRow | null;
  } catch { /* פרופיל ייווצר בהגשה הראשונה */ }

  return {
    id: userId,
    // ★ השרת מנצח. ההיפך היה מקפיא שם ישן על מכשיר אחד לנצח.
    displayName: profile?.displayName || '',
    // ★ ברירת המחדל היא "אורח" ולא "רשום".
    //   אם השרת לא ענה, עדיף להציע למשתמש רשום להירשם (מטרד קטן)
    //   מאשר לא להציע לאורח (איבוד הזהות שלו — נזק אמיתי).
    isGuest: profile?.isGuest !== false && !profile?.offsidesUserId,
    username: profile?.username ?? null,
    avatar: profile?.avatar ?? null,
    referralCode: profile?.referralCode ?? null,
    offsidesUserId: profile?.offsidesUserId ?? null,
    online: true,
  };
}

let ensuring: Promise<Identity> | null = null;

/**
 * מבטיח שיש זהות. קריאות מקבילות מתאחדות — אחרת עלייה של
 * האפליקציה יוצרת שני משתמשים אנונימיים, וההגשה נשמרת על אחד
 * בזמן שהמסך מציג את השני.
 */
export function ensureIdentity(): Promise<Identity> {
  if (ensuring) return ensuring;

  ensuring = (async (): Promise<Identity> => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        current = await fromSession(session.user.id);
      } else {
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error || !data.user) throw error ?? new Error('anon sign-in failed');
        current = await fromSession(data.user.id);
      }
      // הפרופיל נוצר מיד, לא בהגשה. משתמש בלי שורה ב-`game.users`
      // הוא משתמש שהדירוג לא יכול להציג לו שם.
      try {
        await supabase.rpc('ensure_profile', { p_display_name: current.displayName || null });
      } catch { /* לא חוסם */ }
    } catch {
      current = localFallback();
    }
    emit();
    return current;
  })();

  return ensuring;
}

/* ================================================================== */
/* קוד חד־פעמי — העברת זהות בין מכשירים                                */
/* ================================================================== */

export interface AccessCode {
  code: string;
  /** ISO. אחרי זה הקוד לא תקף. */
  expiresAt: string;
}

/**
 * מנפיק קוד חדש ומבטל את הקודם.
 *
 * ★ הקוד עצמו לא נשמר במסד — רק ה-hash שלו. מי שמשיג גישה לטבלה
 *   לא יכול להתחזות לאף אחד. אותו עיקרון בדיוק כמו סיסמה.
 */
export async function issueAccessCode(): Promise<AccessCode> {
  const { data, error } = await supabase.functions.invoke<AccessCode>('access-code', {
    body: { action: 'issue' },
  });
  if (error || !data) throw new Error('ACCESS_CODE_ISSUE_FAILED');
  return data;
}

/**
 * פודה קוד ומחליף את הזהות הנוכחית בזו שהקוד מצביע עליה.
 *
 * ★ הפדיון קורה בשרת, כי הוא צריך להנפיק סשן למשתמש **אחר**.
 *   דפדפן לא יכול לעשות את זה, ובצדק.
 */
export async function redeemAccessCode(code: string): Promise<Identity> {
  const clean = code.trim().toUpperCase().replace(/\s+/g, '');
  const { data, error } = await supabase.functions.invoke<{
    access_token: string; refresh_token: string; display_name: string | null;
  }>('access-code', { body: { action: 'redeem', code: clean } });

  if (error || !data?.access_token) throw new Error('ACCESS_CODE_INVALID');

  const { data: sess, error: sErr } = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });
  if (sErr || !sess.user) throw new Error('ACCESS_CODE_SESSION_FAILED');

  /* השם מגיע מהשרת דרך `fromSession` — הוא כבר נכתב ל-
     `game.users` בצד ה-Edge Function. אין מה לשכפל למכשיר. */
  current = await fromSession(sess.user.id);
  emit();
  return current;
}

/* ================================================================== */
/* קישור חשבון אופסיידס                                                */
/* ================================================================== */

/**
 * שולח קוד למייל — **דרך פרויקט אופסיידס**.
 *
 * `shouldCreateUser: false` הוא הלב: מי שאין לו חשבון באופסיידס
 * לא נרשם בטעות. הוא פשוט לא מקבל קוד, וזה הודעת השגיאה הנכונה.
 *
 * ⚠ דורש שספק המייל מוגדר בפרויקט אופסיידס. אם לא — הקריאה
 *   תיכשל, וזו התלות היחידה בצד שלהם.
 */
export async function requestOffsidesCode(email: string): Promise<void> {
  const { error } = await offsidesAuthClient.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: false },
  });
  if (error) throw new Error('OFFSIDES_OTP_FAILED');
}

/**
 * מאמת את הקוד מול אופסיידס, ואז מקשר בדוביד.
 * מחזיר את הזהות המקושרת.
 */
export async function linkOffsidesAccount(email: string, otp: string): Promise<Identity> {
  const { data: verified, error: vErr } = await offsidesAuthClient.auth.verifyOtp({
    email: email.trim(), token: otp.trim(), type: 'email',
  });
  if (vErr || !verified.session?.access_token) throw new Error('OFFSIDES_CODE_INVALID');

  const { data, error } = await supabase.functions.invoke<{
    access_token: string; refresh_token: string; offsides_user_id: string; display_name: string | null;
  }>('link-offsides', { body: { offsides_access_token: verified.session.access_token } });

  if (error || !data?.access_token) throw new Error('OFFSIDES_LINK_FAILED');

  const { data: sess, error: sErr } = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });
  if (sErr || !sess.user) throw new Error('OFFSIDES_LINK_SESSION_FAILED');

  /* השם מגיע מהשרת דרך `fromSession` — הוא כבר נכתב ל-
     `game.users` בצד ה-Edge Function. אין מה לשכפל למכשיר. */
  current = await fromSession(sess.user.id);
  emit();
  return current;
}


/* ================================================================== */
/* הרשמה                                                              */
/* ================================================================== */

/**
 * ═══════════════════════════════════════════════════════════════
 * ★ למה יש הרשמה בכלל במוצר ש"לא דורש הרשמה"
 * ═══════════════════════════════════════════════════════════════
 *
 * אורח הוא זהות של **דפדפן**. היא נעלמת כשמנקים נתוני גלישה,
 * כשמחליפים מכשיר, וכשהטלפון הולך לאיבוד. הקוד החד־פעמי
 * (`issueAccessCode`) פותר את המעבר בין מכשירים, אבל הוא לא פותר
 * את הדבר שבאמת קורה: אנשים לא מנפיקים קוד לפני שהם מאבדים משהו.
 *
 * הרשמה היא **ביטוח**, לא שער כניסה. לכן:
 *
 *   · אף מסך לא חוסם. אורח משחק מחזור שלם בלי לראות טופס.
 *   · ההצעה מופיעה אחרי שיש מה להגן עליו — לא לפני.
 *   · השדרוג הוא **אותה שורה במסד**. `id` לא זז, ההרכבים לא
 *     זזים, הדירוג לא זז. דגל אחד משתנה. אין מסלול הגירה שיכול
 *     להיכשל באמצע ולהשאיר מישהו בלי היסטוריה.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ החוזה מול אופסיידס
 * ═══════════════════════════════════════════════════════════════
 *
 * הטופס והמטא־דאטה זהים לאלה של אופסיידס (`DUBIDAUTHSYNC.md` §5):
 * `username`, `avatar`, `referred_by_code`, ו-`emailRedirectTo`.
 *
 * אבל ⚠ שני המוצרים על **פרויקטים נפרדים**, בניגוד להנחה של אותו
 * מסמך. לכן הרשמה בדוביד יוצרת משתמש דוביד — היא לא יוצרת חשבון
 * באופסיידס ולא מזהה אחד קיים. מי שכבר יש לו חשבון שם צריך את
 * `linkOffsidesAccount`, ולא את `signUpWithEmail`.
 *
 * המבנה הזהה עדיין משתלם: אם שני הפרויקטים יאוחדו בעתיד, אותה
 * שורת מטא־דאטה כבר תיצור פרופיל תקין בשני הצדדים בלי לגעת בטופס.
 */

/** האווטארים. אותה רשימה כמו באופסיידס — כדי שאותו משתמש ייראה אותו דבר. */
export const AVATAR_POOL = [
  '⚽', '🏆', '🎯', '🥇', '🏅', '🥊', '🏀', '⛳', '🦁', '🐺', '🦅', '🐼',
  '🦊', '🐯', '🦈', '🐉', '🦂', '🐲', '🤖', '👽', '😎', '🤠', '🧙', '🥷',
  '🦸', '👑', '🃏', '💀', '🚀', '🔥', '⚡', '🎮', '💎', '⭐', '🌟', '💥',
  '🛡️', '🎲',
] as const;

export function randomAvatar(): string {
  return AVATAR_POOL[Math.floor(Math.random() * AVATAR_POOL.length)];
}

/** קוד ההפניה מהכתובת (`?ref=CODE`). נקרא פעם אחת בעליית המסך. */
export function referralFromUrl(): string {
  try {
    return (new URLSearchParams(window.location.search).get('ref') ?? '')
      .trim().toUpperCase().slice(0, 16);
  } catch {
    return '';
  }
}

/** שם משתמש מוצע מהשרת. נופל בשקט — הצעה אינה קריטית. */
export async function suggestUsername(): Promise<string> {
  try {
    const { data, error } = await supabase.rpc('suggest_username');
    if (!error && typeof data === 'string') return data;
  } catch { /* ignore */ }
  return '';
}

/**
 * בדיקת זמינות לפני השליחה.
 *
 * ★ למה לא פשוט לתת לשרת לדחות: כי מה שהמשתמש רואה אז הוא
 *   "Database error saving new user" בסוף טופס מלא. בדיקה מראש
 *   הופכת את זה להערה ליד השדה, לפני שהוא הקליד סיסמה.
 *
 * ★ נופל ל-`true` בשגיאת רשת, בכוונה. חסימת הרשמה בגלל בדיקה
 *   אופציונלית שנכשלה היא הדבר הגרוע ביותר שהיא יכולה לעשות —
 *   והשרת ממילא יטפל בהתנגשות (`db/10` §2).
 */
export async function isUsernameAvailable(username: string): Promise<boolean> {
  const clean = username.trim();
  if (clean.length < 3) return false;
  try {
    const { data, error } = await supabase.rpc('username_available', { p_username: clean });
    if (error) return true;
    return data !== false;
  } catch {
    return true;
  }
}

export interface SignUpInput {
  email: string;
  password: string;
  username: string;
  referralCode?: string;
}

export interface SignUpResult {
  /** `true` = נשלח מייל אימות והמשתמש עוד לא מחובר. */
  needsEmailConfirmation: boolean;
}

/**
 * הרשמה עם אימייל.
 *
 * ★ `emailRedirectTo` הוא לא פרט טכני.
 *
 * ה-Site URL בהגדרות הפרויקט הוא שדה **יחיד**, והוא ברירת המחדל
 * לקישורים במיילים. בלי `emailRedirectTo` מפורש, משתמש שנרשם
 * בדוביד לוחץ על קישור האימות ונוחת במוצר אחר. אותו כלל חל על
 * אופסיידס, וזו הסיבה ששניהם שולחים `window.location.origin`.
 */
export async function signUpWithEmail(
  { email, password, username, referralCode }: SignUpInput,
): Promise<SignUpResult> {
  const handle = username.trim();
  // ★ trim לפני הבדיקה, לא אחריה.
  //   באג מוכר בטופס של אופסיידס: הבדיקה על המחרוזת הגולמית
  //   והשליחה על ה-trim, ולכן "  a" (אורך 3) עבר והגיע כ-"a".
  if (handle.length < 3) throw new Error('USERNAME_TOO_SHORT');
  if (password.length < 6) throw new Error('PASSWORD_TOO_SHORT');

  if (!(await isUsernameAvailable(handle))) throw new Error('USERNAME_TAKEN');

  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: {
        username: handle,
        avatar: randomAvatar(),
        ...(referralCode?.trim()
          ? { referred_by_code: referralCode.trim().toUpperCase() }
          : {}),
      },
      emailRedirectTo: window.location.origin,
    },
  });
  if (error) throw new Error(mapAuthError(error.message));

  // יש סשן ⇒ אישור מייל כבוי בפרויקט, והמשתמש כבר בפנים.
  if (data.session?.user) {
    await supabase.rpc('ensure_profile', { p_display_name: handle });
    current = await fromSession(data.session.user.id);
    emit();
    return { needsEmailConfirmation: false };
  }

  return { needsEmailConfirmation: true };
}

export async function signInWithEmail(email: string, password: string): Promise<Identity> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(), password,
  });
  if (error || !data.user) throw new Error(mapAuthError(error?.message ?? ''));

  await supabase.rpc('ensure_profile', { p_display_name: null });
  current = await fromSession(data.user.id);
  emit();
  return current;
}

/**
 * גוגל.
 *
 * ★ `prompt: 'select_account'` — בלעדיו גוגל נועלת על החשבון
 *   האחרון שהמשתמש נכנס איתו, ומי שיש לו שני חשבונות לא יכול
 *   לבחור. זהה לאופסיידס.
 *
 * הפונקציה לא מחזירה זהות: היא מנווטת החוצה. הסשן נקלט בחזרה
 * על ידי `detectSessionInUrl` בלקוח.
 */
export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) throw new Error(mapAuthError(error.message));
}

/**
 * יציאה.
 *
 * ★ מיד אחרי היציאה נוצרת זהות אורח חדשה, ולא מסך התחברות.
 *   מוצר שאפשר להיכנס אליו בלי חשבון חייב להישאר כזה גם אחרי
 *   שיוצאים ממנו — אחרת "יציאה" היא דלת נעולה.
 */
export async function signOut(): Promise<Identity> {
  try { await supabase.auth.signOut(); } catch { /* ignore */ }
  current = null;
  ensuring = null;
  return ensureIdentity();
}

/** קודי שגיאה בעברית. הודעות Supabase באנגלית ולא מובנות למשתמש. */
function mapAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('already registered') || m.includes('already been registered')) {
    return 'EMAIL_TAKEN';
  }
  if (m.includes('invalid login')) return 'BAD_CREDENTIALS';
  if (m.includes('email not confirmed')) return 'EMAIL_NOT_CONFIRMED';
  if (m.includes('password')) return 'PASSWORD_TOO_SHORT';
  if (m.includes('rate limit') || m.includes('too many')) return 'RATE_LIMIT';
  if (m.includes('provider is not enabled')) return 'PROVIDER_DISABLED';
  return 'AUTH_FAILED';
}

export const AUTH_ERROR_HE: Record<string, string> = {
  USERNAME_TOO_SHORT: 'שם משתמש — שלושה תווים לפחות.',
  USERNAME_TAKEN: 'השם הזה כבר תפוס. נסו אחר.',
  PASSWORD_TOO_SHORT: 'סיסמה — שישה תווים לפחות.',
  EMAIL_TAKEN: 'כבר יש חשבון עם המייל הזה. אפשר פשוט להתחבר.',
  BAD_CREDENTIALS: 'מייל או סיסמה לא נכונים.',
  EMAIL_NOT_CONFIRMED: 'צריך לאשר את המייל. בדקו את תיבת הדואר.',
  RATE_LIMIT: 'יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.',
  PROVIDER_DISABLED: 'הכניסה עם גוגל לא מופעלת עדיין בשרת.',
  AUTH_FAILED: 'משהו השתבש. נסו שוב.',
};

export function authMessageHe(code: string): string {
  return AUTH_ERROR_HE[code] ?? AUTH_ERROR_HE.AUTH_FAILED;
}
