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
import { supabase, DUBID_PROJECT, OFFSIDES_PROJECT } from './supabase.ts';
/* ★ כתובת אחת לכל המוצר. קבוע שני היה נשאר מאחור ביום שהדומיין
   ישתנה, וכל הכרטיסים שכבר שמורים אצל משתמשים היו מצביעים לשם. */
import { DUBID_URL } from './growth.ts';

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
  /**
   * איך הוא מחובר: `'google'`, `'email'`, או `null` לאורח.
   *
   * ★ "מחובר" זו הפשטה. "מחובר עם גוגל" היא עובדה שאפשר להראות —
   *   וזה ההבדל בין מסך שמרגיש מחובר לבין מסך שטוען שהוא מחובר.
   */
  provider: string | null;
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
    offsidesUserId: null, provider: null, online: false,
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
  provider?: string | null;
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
    provider: profile?.provider ?? null,
    online: true,
  };
}

/* ================================================================== */
/* ★★★ ההאזנה שהייתה חסרה ★★★                                          */
/* ================================================================== */

/**
 * ═══════════════════════════════════════════════════════════════
 * ★ הבאג: "לחצתי על גוגל וזה פשוט טען את הדף מחדש"
 * ═══════════════════════════════════════════════════════════════
 *
 * זרימת OAuth היא **ניווט מלא**: הדפדפן עוזב את האתר, חוזר, וכל
 * האפליקציה עולה מחדש. הסשן החדש נקלט על ידי `detectSessionInUrl`
 * — אבל זה קורה **אסינכרונית**, אחרי שהמודול כבר נטען.
 *
 * ובלי מאזין, אף אחד לא מספר לאפליקציה שזה קרה.
 *
 * התוצאה: המשתמש חוזר, רואה בדיוק את אותו מסך, ומסיק — בצדק —
 * שההתחברות לא עבדה. היא כן עבדה. פשוט אף מסך לא הסתכל שוב.
 *
 * ★★ ולמה זה גם באג של **אובדן זהות** ★★
 *
 * `ensureIdentity` קוראת ל-`getSession()`, וכשאין סשן היא יוצרת
 * משתמש אנונימי **חדש**. כל מקום שבו הסשן האמיתי מגיע באיחור
 * הוא מקום שבו נוצר אורח חדש וריק — וההיסטוריה של המשתמש
 * נשארת תלויה על מזהה שאיש כבר לא מחזיק.
 *
 * המאזין סוגר את שניהם: הוא מרענן את הזהות בכל שינוי אמיתי,
 * ומודיע לכל המסכים.
 */
export function watchAuth(): () => void {
  try {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      /* ★ `TOKEN_REFRESHED` לא נכנס לכאן בכוונה: הוא קורה כל שעה
         והוא לא משנה **מי** המשתמש. רענון זהות בכל חידוש טוקן
         היה שולח קריאת רשת מיותרת לכל לשונית פתוחה, לנצח. */
      if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT'
          && event !== 'USER_UPDATED') return;

      void (async () => {
        if (!session?.user) { current = null; ensuring = null; emit(); return; }

        /* ★ `ensure_profile` **לפני** קריאת הזהות.
           אחרי חיבור גוגל, `game.users.is_guest` עדיין TRUE עד
           שמישהו יעדכן אותו. קריאה בסדר ההפוך הייתה מחזירה
           "אורח" בדיוק ברגע שבו המשתמש סיים להתחבר. */
        /* ★★ המיזוג **לפני** קריאת הזהות.
           האורח בנה הרכבים, ואנחנו בדיוק נחתנו בחשבון האמיתי.
           אם נקרא את הזהות קודם, המסך יצייר חשבון ריק — ורק
           הרענון הבא יראה את ההרכבים. המשתמש יראה את הריק. */
        try { await finishPendingMerge(); } catch { /* לא חוסם */ }

        try {
          await supabase.rpc('ensure_profile', { p_display_name: null });
        } catch { /* לא חוסם */ }

        current = await fromSession(session.user.id);
        ensuring = Promise.resolve(current);
        emit();
      })();
    });
    return () => data?.subscription?.unsubscribe?.();
  } catch {
    return () => {};
  }
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

/**
 * ★ קוד ההעברה הקצר ירד מהמוצר.
 *
 * הוא היה בן שש, חד־פעמי, ותקף לשעה — והוא דרש Edge Function
 * כדי להנפיק סשן של משתמש אחר. הכרטיס עושה את אותה עבודה
 * בדיוק: אפשר לשמור אותו כתמונה, ואפשר פשוט להקליד את המפתח
 * במכשיר שביד.
 *
 * שני מנגנונים לאותה בעיה הם עוד החלטה שהמשתמש צריך לקבל
 * במסך שכל תפקידו הוא לא לאבד את החשבון.
 *
 * ⚠ `claim_pass` במסד **עדיין מקבל** קודים מסוג `transfer`, כדי
 *   שקוד שהונפק לפני השינוי לא יישבר באמצע.
 */

/**
 * ═══════════════════════════════════════════════════════════════
 * ★★★ הפדיון: מעבירים דאטה, לא סשן ★★★
 * ═══════════════════════════════════════════════════════════════
 *
 * הגרסה הקודמת ניסתה להיכנס **בתור** המשתמש הישן: היא ביקשה
 * מ-Edge Function להנפיק טוקן של מישהו אחר, וזה דורש מפתח
 * `service_role` שאסור לו להיות בדפדפן. מכאן כל התלות בשרת.
 *
 * ★ אבל לדפדפן הזה **כבר יש** משתמש אנונימי משלו.
 *
 * אז במקום להתחזות, הוא פשוט לוקח אליו את הדאטה: ההרכבים, שם
 * הקבוצה, הזירות, הפרופיל. `game.claim_pass` עושה את זה בשאילתה
 * אחת, כ-`SECURITY DEFINER`, בלי טוקנים ובלי שרת.
 *
 * מבחינת המשתמש התוצאה זהה לחלוטין — הוא רואה את הקבוצה שלו.
 *
 * ★ מה ש**לא** עובר: `is_admin`. מפתח נשלח בוואטסאפ ומצולם
 *   מהמסך; אילו הוא היה גורר הרשאת ניהול, כל צילום מסך של
 *   אדמין היה מפתח ללוח הניהול.
 */
export interface ClaimResult {
  ok: boolean;
  /** כמה הרכבים עברו. 0 עם `ok` = זה כבר החשבון שלך. */
  moved: number;
  sameUser: boolean;
  displayName?: string | null;
  error?: 'INVALID_CODE' | 'TOO_MANY_ATTEMPTS';
}

export async function redeemAccessCode(code: string): Promise<ClaimResult> {
  /* ★ הזהות חייבת להיות קיימת לפני הפדיון.
     `claim_pass` מעבירה דאטה **אל** המשתמש הנוכחי, ולכן אם אין
     עדיין סשן אנונימי — אין לאן להעביר. */
  await ensureIdentity();

  const { data, error } = await supabase.rpc('claim_pass', { p_key: code });
  if (error) throw new Error('ACCESS_CODE_INVALID');

  const res = (data ?? { ok: false, moved: 0, sameUser: false }) as ClaimResult;

  if (res.ok && !res.sameUser) {
    /* הזהות עצמה לא השתנתה — רק מה שתלוי עליה. אבל השם כן,
       ולכן צריך לקרוא אותה מחדש. */
    const id = currentIdentity();
    if (id) {
      current = await fromSession(id.id);
      emit();
    }
  }
  return res;
}

/* ================================================================== */
/* כרטיס המנוי — המפתח הקבוע של האורח                                  */
/* ================================================================== */

/**
 * ═══════════════════════════════════════════════════════════════
 * ★★★ למה זה קיים בנפרד מ-`issueAccessCode` ★★★
 * ═══════════════════════════════════════════════════════════════
 *
 * שתי משימות שנשמעות זהות ואינן:
 *
 *   קוד העברה  "תעביר אותי עכשיו לטלפון שבידי"
 *              → קצר, חד־פעמי, שעה. הקיים, ונשאר.
 *
 *   מפתח כניסה "זה הכרטיס שלי, אני שומר אותו"
 *              → ארוך, חוזר, קבוע.
 *
 * ★ מפתח שפג אחרי שעה בתוך תמונה שמורה אינו מפתח.
 *   המוצר מבקש מהמשתמש לשמור צילום מסך ולשלוח אותו לעצמו
 *   בוואטסאפ. אם הקוד מת אחרי שעה, התמונה הזו היא צילום של
 *   דלת נעולה — והמשתמש יגלה את זה ברגע הכי גרוע: כשהוא
 *   מחליף טלפון וכבר אין לו את הישן.
 *
 * ★★ אין "הצג לי את המפתח הקיים" ★★
 *
 * במסד יושב רק ה-hash. זו החלטה ולא מגבלה: מי שמשיג גישה
 * לטבלה לא יכול להתחזות לאיש. לכן בקשה שנייה **מנפיקה מפתח
 * חדש ומבטלת את הקודם** — וזו גם ההתנהגות הנכונה, כי מי
 * שמבקש את הכרטיס שוב בדרך כלל איבד אותו.
 *
 * המסך מזהיר על זה מראש דרך `passState()`.
 */
export interface GuestPass {
  /** המפתח כפי שנשלח לשרת. בלי מקפים. */
  code: string;
  /** `AB34-CD67-KM` — כפי שמוצג ומודפס. */
  pretty: string;
  displayName: string | null;
  issuedAt: string;
}

export async function issueGuestPass(): Promise<GuestPass> {
  /*
   * ★★ RPC, ולא Edge Function ★★
   *
   * הגרסה הקודמת קראה ל-`functions.invoke('access-code')`, ולכן
   * דרשה `supabase functions deploy` — צעד שאי אפשר לעשות
   * מ-SQL Editor. תכונה שדורשת צעד תפעולי שלא מבוצע היא תכונה
   * שלא קיימת.
   *
   * עכשיו הכל ב-SQL: `game.issue_pass()` מייצרת את המפתח,
   * שומרת רק את ה-hash, ומחזירה את הטקסט פעם אחת.
   */
  const { data, error } = await supabase.rpc('issue_pass');
  if (error || !data) throw new Error('PASS_ISSUE_FAILED');
  return data as GuestPass;
}

export interface PassState {
  has: boolean;
  createdAt?: string;
  lastUsedAt?: string | null;
  uses?: number;
}

/**
 * האם כבר יש מפתח, ומתי שימש.
 *
 * ★ לא מחזיר את המפתח עצמו — ראו למעלה. הוא קיים כדי שהמסך
 *   יוכל להגיד "כבר יש לך כרטיס" במקום להנפיק חדש בשקט
 *   ולהרוג את זה ששמור בגלריה.
 */
export async function passState(): Promise<PassState> {
  try {
    const { data, error } = await supabase.rpc('my_pass_state');
    if (error || !data) return { has: false };
    return data as PassState;
  } catch {
    return { has: false };
  }
}

/**
 * הקישור שנכנס לתוך ה-QR ולתוך הודעת הוואטסאפ.
 *
 * ★★ המפתח יושב ב-**fragment** (`#k=`) ולא ב-query (`?k=`) ★★
 *
 * זה לא סגנון. fragment לא נשלח לשרת: הוא לא מופיע בלוגים של
 * ה-CDN, לא ב-`Referer` כשהמשתמש לוחץ משם על קישור חיצוני,
 * ולא בכל שכבת ניטור שיושבת בדרך.
 *
 * המשתמש שולח את הקישור הזה לעצמו בוואטסאפ. ההבדל בין `?`
 * ל-`#` הוא ההבדל בין מפתח שעובר בשרתים לבין מפתח שנשאר
 * בין המכשיר שלו לבין הדפדפן שלו.
 */
export function passLink(code: string, base = DUBID_URL): string {
  return `${base}/#k=${encodeURIComponent(code.replace(/-/g, ''))}`;
}

/**
 * קורא מפתח מהכתובת ומנקה אותה מיד.
 *
 * ★ הניקוי חיוני: בלעדיו המפתח נשאר בשורת הכתובת, נכנס
 *   להיסטוריית הדפדפן, ומופיע בצילום מסך של המסך הראשי.
 */
export function passFromUrl(): string | null {
  try {
    const m = /[#&]k=([A-Za-z0-9%-]+)/.exec(window.location.hash);
    if (!m) return null;

    const code = decodeURIComponent(m[1]).toUpperCase().replace(/[^A-Z0-9]/g, '');

    const clean = window.location.hash.replace(/[#&]k=[A-Za-z0-9%-]+/, '');
    window.history.replaceState(null, '',
      window.location.pathname + window.location.search + (clean === '#' ? '' : clean));

    return code.length >= 6 ? code : null;
  } catch {
    return null;
  }
}

/* ================================================================== */
/* קישור חשבון אופסיידס                                                */
/* ================================================================== */

/**
 * ★★ הקוד שהיה כאן הוסר, וזו הייתה ההחלטה הנכונה ★★
 *
 * היו כאן שתי פונקציות: `requestOffsidesCode` שביקשה קוד
 * מפרויקט אופסיידס, ו-`linkOffsidesAccount` ששלחה את הטוקן
 * ל-Edge Function בשם `link-offsides` כדי לאמת אותו בשרת.
 *
 * שתיהן לא עבדו בפועל:
 *
 *  · תבנית המייל של אופסיידס, כברירת מחדל, שולחת **קישור בלבד**.
 *    הקוד שהמסך ביקש פשוט לא היה במייל.
 *  · והפונקציה `link-offsides` לא נפרסה, ולכן גם הקוד הנכון
 *    היה נכשל בשלב האחרון.
 *
 * ★ מה החליף אותן, ולמה זה מספיק
 *
 * הזהות המשותפת בין שני המוצרים היא **המייל**, לא הסשן. שיתוף
 * מזהה הלקוח של גוגל בין הפרויקטים לא מאחד משתמשים — לכל
 * פרויקט יש `auth.users` משלו.
 *
 * ולכן: `upgradeStart` + `upgradeVerify` מאמתים את המייל מול
 * **דוביד עצמו**, ומאותו רגע שני המוצרים מכירים את אותו אדם.
 * בלי שרת, בלי פריסה, ובלי טוקן שאפשר לזייף מהדפדפן.
 *
 * ⚠ אם יום אחד יוחלט על סשן משותף אמיתי — הוא יחייב שרת, כי רק
 *   צד שרת יכול לשאול את אופסיידס "הטוקן הזה באמת שלך?".
 *   `docs/OFFSIDES-SYNC.md` מתעד את הגבול הזה.
 */

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

/* ================================================================== */
/* התחברות — מסלול אחד שעובד תמיד                                      */
/* ================================================================== */

/**
 * ═══════════════════════════════════════════════════════════════
 * ★★★ הטעות שתוקנה כאן ★★★
 * ═══════════════════════════════════════════════════════════════
 *
 * הגרסה הקודמת ניסתה **לקשר** את חשבון גוגל לאורח הנוכחי
 * (`linkIdentity`). זה עובד בדיוק במקרה אחד: כשחשבון הגוגל הזה
 * עוד לא מוכר למערכת.
 *
 * אבל המקרה השכיח הפוך — לאדם **כבר יש** חשבון. ואז הקישור
 * נכשל עם "החשבון כבר קיים", והמשתמש נתקע: לא נכנס, לא נרשם,
 * ולא מבין מה הוא עשה לא נכון.
 *
 * ★ והוא לא עשה שום דבר לא נכון. הוא לחץ "התחבר עם גוגל".
 *
 * ═══════════════════════════════════════════════════════════════
 * ★★ הגישה: להיכנס רגיל, ואז לגרור את מה שנבנה ★★
 * ═══════════════════════════════════════════════════════════════
 *
 * `signInWithOAuth` עובד **תמיד** — גם למי שיש חשבון וגם למי
 * שאין. אין מצב שבו הוא נכשל בגלל חשבון קיים; חשבון קיים הוא
 * בדיוק מה שהוא מחפש.
 *
 * ומה עם ההרכבים שהאורח בנה לפני שהתחבר? לפני היציאה לגוגל
 * מונפק **אסימון העברה**, ואחרי החזרה הוא נפדה אוטומטית — הדאטה
 * עוברת אל החשבון שנחתנו בו, בין אם הוא חדש ובין אם קיים.
 *
 * זה בדיוק אותו מנגנון של כרטיס המנוי (`claim_pass`), על אותו
 * קוד ועם אותן בדיקות. לא נבנתה כאן שום מכונה חדשה.
 *
 * ★ ומה שזה מבטל בדרך:
 *   · אין `linkIdentity` → אין צורך ב-"Manual linking" בלוח
 *     הבקרה. מתג פחות להגדיר, ואחד פחות לשכוח.
 *   · אין "החשבון כבר קיים" — לא כי הסתרנו את ההודעה, אלא כי
 *     המצב שיצר אותה כבר לא קיים.
 */

/** איפה נשמר אסימון ההעברה בין היציאה לגוגל לבין החזרה. */
const MERGE_KEY = 'dubid.merge.v1';

/**
 * ★★ ולמה יש גם עותק ב-`localStorage` ★★
 *
 * `sessionStorage` שורד ניווט באותה לשונית — וזה בדיוק מה
 * שקורה בגוגל. אבל **קישור במייל נפתח בלשונית חדשה**, ושם
 * `sessionStorage` ריק. בלי עותק שני, האורח היה נכנס לחשבון
 * שלו ומגלה אותו ריק, בזמן שההרכבים שלו תלויים על זהות
 * שאיש כבר לא מחזיק.
 *
 * העותק ב-`localStorage` נושא חותמת זמן וחי 15 דקות — בדיוק
 * כמו האסימון בשרת. אסימון שנשאר בדפדפן אחרי שפג הוא רק
 * זבל, ולכן הוא נמחק בקריאה הראשונה שרואה אותו.
 */
const MERGE_TTL_MS = 15 * 60 * 1000;

/**
 * מנפיק אסימון העברה — אבל רק אם יש מה להעביר.
 *
 * ★ `has_anything` חוסך שורה מיותרת בטבלה בכל לחיצה של מישהו
 *   שנכנס לפני שנייה ולא עשה כלום. וזה הרוב.
 */
async function stashMergeToken(): Promise<void> {
  try {
    const id = currentIdentity();
    if (id && !id.isGuest) return;

    const { data: has } = await supabase.rpc('has_anything');
    if (has !== true) return;

    const { data: token, error } = await supabase.rpc('issue_merge_token');
    if (error || typeof token !== 'string') return;

    try { sessionStorage.setItem(MERGE_KEY, token); } catch { /* מצב פרטי */ }
    try {
      localStorage.setItem(MERGE_KEY, JSON.stringify({ t: token, at: Date.now() }));
    } catch { /* מצב פרטי */ }
  } catch {
    /* ★ כישלון כאן לא מבטל את ההתחברות. עדיף להיכנס בלי למזג
       מאשר לא להיכנס בכלל — הדאטה עדיין ניתנת לשחזור דרך
       כרטיס המנוי. */
  }
}

/**
 * פודה אסימון שממתין, אם יש. נקרא אחרי כל התחברות מוצלחת.
 *
 * ★ `sessionStorage` ולא `localStorage`: האסימון תקף לרגע אחד
 *   וצריך למות עם הלשונית. אסימון ששורד סגירה הוא אסימון שאיש
 *   כבר לא מצפה לו.
 */
export async function finishPendingMerge(): Promise<number> {
  const token = peekMergeToken();
  if (!token) return 0;

  try {
    const { data } = await supabase.rpc('claim_pass', { p_key: token });
    const res = (data ?? {}) as { ok?: boolean; moved?: number; sameUser?: boolean };

    /*
     * ═══════════════════════════════════════════════════════════
     * ★★★ למה `sameUser` **לא** מוחק את האסימון ★★★
     * ═══════════════════════════════════════════════════════════
     *
     * הפונקציה הזו נקראת גם בעלייה של האפליקציה, והסשן של גוגל
     * נקלט **אסינכרונית** — יש חלון של כמה מאיות שנייה שבו
     * `auth.uid()` הוא עדיין האורח הישן.
     *
     * במצב הזה השרת מחזיר `sameUser: true` בצדק ("אין מה
     * להעביר"), והוא **לא** מסמן את האסימון כנפדה. אם היינו
     * מוחקים אותו כאן, המיזוג האמיתי — זה שקורה שנייה אחר כך
     * ב-`watchAuth` — היה מגיע בלי מפתח.
     *
     * ★ התוצאה הייתה בדיוק הבאג שהכי קשה לאתר: המשתמש מתחבר,
     *   הכל נראה תקין, וההרכבים שלו פשוט לא שם.
     *
     * האסימון חי 15 דקות ונמחק לבד כשפג. השארתו לרגע נוסף לא
     * עולה כלום; מחיקתו מוקדם עולה למשתמש את ההיסטוריה שלו.
     */
    if (res.sameUser === true) return 0;

    clearMergeToken();
    return res.ok ? (res.moved ?? 0) : 0;
  } catch {
    /* שגיאת רשת — האסימון נשאר, והניסיון הבא יתפוס אותו. */
    return 0;
  }
}

/**
 * קורא את האסימון **בלי** למחוק אותו. אסימון פג נמחק כאן.
 *
 * ★ הפרדה בין קריאה למחיקה היא מה שמאפשר לקרוא לפדיון פעמיים
 *   בלי סיכון: הפדיון הראשון (לפני שהסשן נקלט) לא הורס את
 *   המפתח בשביל השני.
 */
function peekMergeToken(): string | null {
  try {
    const t = sessionStorage.getItem(MERGE_KEY);
    if (t) return t;
  } catch { /* מצב פרטי */ }

  try {
    const raw = localStorage.getItem(MERGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { t?: string; at?: number };
    if (typeof saved.t === 'string'
        && typeof saved.at === 'number'
        && Date.now() - saved.at < MERGE_TTL_MS) {
      return saved.t;
    }
    localStorage.removeItem(MERGE_KEY);   // פג — אין למה לשמור
  } catch { /* מצב פרטי, או JSON פגום */ }

  return null;
}

/** מוחק את שני העותקים. נקרא רק אחרי תשובה סופית מהשרת. */
function clearMergeToken(): void {
  try { sessionStorage.removeItem(MERGE_KEY); } catch { /* מצב פרטי */ }
  try { localStorage.removeItem(MERGE_KEY); } catch { /* מצב פרטי */ }
}

/**
 * ★ כפתור אחד. תמיד עובד.
 *
 * גם למי שנרשם עכשיו, גם למי שחוזר אחרי חודש, וגם לאורח שבנה
 * הרכב לפני חמש דקות.
 */
export async function continueWithGoogle(): Promise<void> {
  await stashMergeToken();

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
      /* ★ בלעדיו גוגל נועלת על החשבון האחרון, ומי שיש לו שניים
         לא יכול לבחור. */
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) throw new Error(mapAuthError(error.message));
}

/**
 * אותו דבר במייל.
 *
 * ★ `shouldCreateUser: true` — במפורש.
 *
 * זה מה שהופך את הכפתור ל"התחברות **או** הרשמה" במקום לשניים.
 * המשתמש לא צריך לדעת מראש אם יש לו חשבון; ברוב המקרים הוא
 * באמת לא זוכר.
 */
export async function continueWithEmail(email: string): Promise<void> {
  const clean = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error('EMAIL_INVALID');

  await stashMergeToken();

  const { error } = await supabase.auth.signInWithOtp({
    email: clean,
    options: { shouldCreateUser: true, emailRedirectTo: window.location.origin },
  });
  if (error) throw new Error(mapAuthError(error.message));
}

/**
 * מאמת קוד שהגיע במייל — או קישור שהודבק.
 *
 * ★ `type: 'email'` ולא `'email_change'`. זו התחברות, לא שינוי
 *   כתובת. טיפוס שגוי מחזיר "הקוד פג או שגוי" על קוד תקין.
 */
export async function verifyEmailCode(email: string, token: string): Promise<Identity> {
  const raw = token.trim();
  const hash = extractTokenHash(raw);

  const { data, error } = hash
    ? await supabase.auth.verifyOtp({ token_hash: hash.token, type: hash.type })
    : await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: raw.replace(/\s+/g, ''),
      type: 'email',
    });
  if (error || !data.user) throw new Error(mapAuthError(error?.message ?? ''));

  await finishPendingMerge();
  try { await supabase.rpc('ensure_profile', { p_display_name: null }); } catch { /* לא חוסם */ }

  current = await fromSession(data.user.id);
  emit();
  return current;
}

/**
 * שולף `token_hash` מקישור אימות שהודבק.
 *
 * ★ תבנית המייל של Supabase, כברירת מחדל, מכילה **רק קישור**.
 *   מסך שמבקש "הקלידו את הקוד" שולח את המשתמש לחפש משהו שלא
 *   קיים במייל.
 */
export function extractTokenHash(
  input: string,
): { token: string; type: string } | null {
  if (!/token_hash=/.test(input)) return null;
  try {
    const q = input.slice(input.indexOf('token_hash='));
    const params = new URLSearchParams(q.replace(/^[?#]/, ''));
    const token = params.get('token_hash');
    if (!token) return null;
    return { token, type: params.get('type') || 'email' };
  } catch {
    return null;
  }
}

/**
 * בודק מחדש מול השרת אם ההתחברות הושלמה.
 *
 * ★ זה מה שמאפשר את המסלול "לחצתי על הקישור במייל": הקישור
 *   נפתח בלשונית אחרת ומאשר בשרת, והלשונית שבה המשתמש יושב
 *   מחזיקה עותק ישן.
 */
export async function refreshIdentity(): Promise<Identity | null> {
  try {
    await supabase.auth.refreshSession();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return current;

    await finishPendingMerge();
    try { await supabase.rpc('ensure_profile', { p_display_name: null }); } catch { /* לא חוסם */ }

    current = await fromSession(data.user.id);
    emit();
    return current;
  } catch {
    return current;
  }
}

/**
 * ═══════════════════════════════════════════════════════════════
 * ★★ שלוש פונקציות הוסרו מכאן, ובכוונה ★★
 * ═══════════════════════════════════════════════════════════════
 *
 *   signUpWithEmail   `auth.signUp` — נכשל על "כבר קיים"
 *   signInWithEmail   סיסמה — שדה שנשכח ואי אפשר לשחזר בלי מיילר
 *   signInWithGoogle  זהה ל-`continueWithGoogle`, בלי המיזוג
 *
 * כולן חלקו את אותה תקלה: הן הכריחו את המשתמש **לדעת מראש** אם
 * יש לו חשבון. הוא לא יודע, ובצדק — הוא נכנס לאתר כדורגל.
 *
 * מי שבחר לא נכון קיבל שגיאה שמאשימה אותו במשהו שהוא לא עשה,
 * ואז ניסה את השנייה, ובינתיים כבר לא היה בטוח שהוא במקום הנכון.
 *
 * `continueWithGoogle` ו-`continueWithEmail` מחליפות את שלושתן:
 * יש חשבון — נכנסים אליו. אין — נוצר. אותה לחיצה.
 *
 * ★ קוד מת של אימות הוא לא סתם רעש: הוא בדיוק סוג הדבר שמישהו
 *   מחבר בטעות חזרה בעוד חצי שנה, ואז הבאג חוזר.
 */

/* ================================================================== */
/* אבחון חיבורים — משמש את לוח הניהול                                  */
/* ================================================================== */

/**
 * שגיאת OAuth שחזרה בכתובת.
 *
 * ★ ספק שמסרב לא זורק — הוא **מחזיר** לכתובת עם `error=...`.
 *   בלי קריאה מפורשת המשתמש נוחת בלובי כאילו כלום לא קרה,
 *   מנסה שוב, ומקבל בדיוק אותו כלום.
 *
 * ⚠ `redirect_uri_mismatch` לא מגיע לכאן: שם גוגל עוצרת אצלה
 *   ולא מפנה בחזרה בכלל.
 */
export function oauthErrorFromUrl(): string | null {
  try {
    const from = (x: string) => new URLSearchParams(x.replace(/^[?#]/, ''));
    const q = from(window.location.search);
    const h = from(window.location.hash);
    const err = q.get('error') || h.get('error');
    if (!err) return null;

    const desc = q.get('error_description') || h.get('error_description') || '';
    window.history.replaceState(null, '', window.location.pathname);
    return desc || err;
  } catch {
    return null;
  }
}

/**
 * הכתובת שגוגל חייבת להכיר, נגזרת מהפרויקט החי.
 *
 * ★ מחרוזת שמוקלדת ביד בתיעוד תהיה שגויה ביום שהפרויקט יוחלף,
 *   ואף אחד לא יזכור לעדכן אותה.
 */
export function googleCallbackUrl(): string {
  return `${DUBID_PROJECT.url}/auth/v1/callback`;
}

/** אותה כתובת בצד של אופסיידס — אותו OAuth client מכיר את שתיהן. */
export function offsidesCallbackUrl(): string {
  return `${OFFSIDES_PROJECT.url}/auth/v1/callback`;
}

/**
 * ★ "אחרי גוגל זה שולח אותי ל-Vercel".
 *
 * Supabase מפנה ל-`redirectTo` רק אם הוא ברשימת ההיתר; אחרת
 * היא נופלת **בשקט** ל-Site URL. והסשן נשמר ב-`localStorage` של
 * המקור שאליו נחתת — ולכן חוזרים לדומיין האמיתי ונראים מנותקים.
 */
export function isCanonicalOrigin(): boolean {
  try {
    return window.location.origin === DUBID_URL;
  } catch {
    return true;
  }
}

export const CANONICAL_ORIGIN = DUBID_URL;

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
  /* ★ שלוש ההודעות של Supabase שהמשתמש הכי סביר לפגוש, ושכולן
     נשמעות כמו האשמה: "החשבון כבר קיים". הן ממופות כדי שהמסך
     יגיד מה **לעשות** ולא מה נכשל. */
  if (m.includes('identity is already linked')
      || m.includes('identity already exists')) return 'identity_already_exists';
  if (m.includes('user already exists')) return 'user_already_exists';
  if (m.includes('manual linking')) return 'manual_linking_disabled';
  return 'AUTH_FAILED';
}

export const AUTH_ERROR_HE: Record<string, string> = {
  /* ★ ההודעות האלה כמעט לא אמורות להופיע יותר — המסלול החדש
     נכנס לחשבון קיים במקום להיכשל עליו. הן נשארות כרשת ביטחון,
     ומנוסחות כהוראה ולא כהאשמה. */
  identity_already_exists:
    'החשבון הזה כבר מחובר. נסו שוב — הפעם ניכנס אליו ישירות.',
  user_already_exists:
    'כבר יש חשבון עם הכתובת הזו. אותו כפתור יכניס אתכם אליו.',
  manual_linking_disabled:
    'החיבור הזה לא פעיל בהגדרות. אפשר להיכנס עם גוגל או עם מייל.',
  OFFSIDES_NOT_ENABLED:
    'חיבור החשבון מאופסיידס עוד לא הופעל. אפשר להיכנס עם כרטיס המנוי או עם מייל.',
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

/* ================================================================== */
/* פרופיל המאמן                                                        */
/* ================================================================== */

/**
 * ★ מה שהמסד באמת יודע, ולא מה שנחמד להציג.
 *
 * שדות הניקוד הם `null` כשעוד לא נוקד מחזור — ולא אפס. אפס
 * נראה כמו כישלון; ריק נראה כמו "עוד לא". במסך שכל תפקידו
 * לגרום למישהו להרגיש שיש לו כאן משהו, ההבדל הזה הוא הכל.
 */
export interface CoachProfile {
  displayName: string;
  username: string | null;
  avatar: string | null;
  email: string | null;
  isGuest: boolean;
  referralCode: string | null;
  memberSince: string;
  played: number;
  playedFive: number;
  playedFull: number;
  totalPoints: number | null;
  bestPoints: number | null;
  bestRank: number | null;
  scored: number;
  hasPass: boolean;
  leagues: number;
  history: Array<{
    gw: string;
    gwNumber: number;
    gwLabel: string;
    mode: 'five' | 'full';
    teamName: string | null;
    submitted: string;
    points: number | null;
    rank: number | null;
  }>;
}

export async function myProfile(): Promise<CoachProfile | null> {
  try {
    const { data, error } = await supabase.rpc('my_profile');
    if (error || !data) return null;
    return data as CoachProfile;
  } catch {
    return null;
  }
}

export async function setAvatar(avatar: string): Promise<void> {
  const { error } = await supabase.rpc('set_avatar', { p_avatar: avatar });
  if (error) throw new Error('AVATAR_FAILED');
  if (current) {
    current = { ...current, avatar };
    emit();
  }
}
