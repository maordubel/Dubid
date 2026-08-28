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

/* ================================================================== */
/* הפיכת אורח לחשבון קבוע                                              */
/* ================================================================== */

/**
 * ═══════════════════════════════════════════════════════════════
 * ★★★ הבאג שהיה כאן, והוא הגרוע ביותר במוצר ★★★
 * ═══════════════════════════════════════════════════════════════
 *
 * המסלול היחיד להירשם היה `signUpWithEmail`, שקורא ל-
 * `supabase.auth.signUp()`.
 *
 * כשהסשן הנוכחי הוא **אנונימי**, `signUp` לא משדרג אותו. הוא
 * יוצר משתמש **חדש לגמרי**, עם `auth.uid()` חדש.
 *
 * המשמעות: אורח שבנה הרכב, נעל אותו, קיבל דירוג — ואז לחץ
 * "שמור את החשבון שלי" — קיבל חשבון ריק. ההרכבים, שם הקבוצה,
 * הדירוג וההיסטוריה נשארו תלויים על משתמש שאין לו יותר דרך
 * להתחבר אליו.
 *
 * זה הרס בדיוק את מה שההרשמה הבטיחה להגן עליו, וזה קרה בשקט:
 * שום שגיאה, שום אזהרה. המשתמש פשוט ראה טבלה ריקה והסיק
 * שהמערכת מחקה לו הכל.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ מה נכון: `updateUser`, לא `signUp`
 * ═══════════════════════════════════════════════════════════════
 *
 * `updateUser({ email })` על סשן אנונימי **משדרג את אותו
 * משתמש** — אותו `uid`, אותה היסטוריה, אותו הכל. Supabase
 * שולחת קוד אימות לכתובת, והמשתמש מקליד אותו.
 *
 * ⚠ תלות בהגדרות הפרויקט: Authentication → "Manual linking"
 *   חייב להיות מופעל. בלעדיו הקריאה נדחית.
 *   (מתועד ב-README של הסבב.)
 *
 * ★ סיסמה — רק **אחרי** אימות המייל.
 *   זו דרישה של Supabase ולא בחירה שלנו, והיא גם הגיונית:
 *   סיסמה על כתובת לא מאומתת היא חשבון שאי אפשר לשחזר.
 */
export async function upgradeStart(email: string): Promise<void> {
  const clean = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error('EMAIL_INVALID');

  const { error } = await supabase.auth.updateUser(
    { email: clean },
    { emailRedirectTo: window.location.origin },
  );
  if (error) throw new Error(mapAuthError(error.message));
}

/**
 * מסיים את השדרוג עם הקוד שהגיע למייל.
 *
 * ★ `type: 'email_change'` ולא `'email'`.
 *   `'email'` הוא אימות של הרשמה חדשה. כאן מדובר בשינוי
 *   כתובת על משתמש קיים, וזה סוג אחר של אסימון — טעות כאן
 *   מחזירה "Token has expired or is invalid" על קוד תקין
 *   לחלוטין, וזו שעה שאי אפשר להחזיר.
 */
export async function upgradeVerify(email: string, token: string): Promise<Identity> {
  /*
   * ═══════════════════════════════════════════════════════════
   * ★★★ קוד **או** קישור — ולמה זה לא פינוק ★★★
   * ═══════════════════════════════════════════════════════════
   *
   * תבנית המייל של Supabase, כברירת מחדל, מכילה **רק קישור**:
   * `{{ .ConfirmationURL }}`. קוד בן שש ספרות מופיע רק אם מוסיפים
   * ידנית `{{ .Token }}` לתבנית.
   *
   * כלומר מסך שמבקש "הקלידו את הקוד מהמייל" מול תבנית ברירת
   * מחדל שולח את המשתמש לחפש משהו **שלא קיים במייל**. הוא יחפש,
   * לא ימצא, וינטוש — ויהיה בטוח שהוא עשה משהו לא נכון.
   *
   * לכן השדה כאן מקבל את שניהם: קוד, או הדבקה של הקישור המלא.
   * מהקישור נשלף `token_hash`, וזה בדיוק אותו אימות.
   *
   * ★ התוצאה: המוצר עובד **בלי לגעת בתבנית**, ועובד יפה יותר
   *   אם בכל זאת מוסיפים את `{{ .Token }}`.
   */
  const raw = token.trim();
  const hash = extractTokenHash(raw);

  const { data, error } = hash
    ? await supabase.auth.verifyOtp({ token_hash: hash.token, type: hash.type })
    : await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: raw.replace(/\s+/g, ''),
      type: 'email_change',
    });
  if (error || !data.user) throw new Error(mapAuthError(error?.message ?? ''));

  await supabase.rpc('ensure_profile', { p_display_name: null });
  current = await fromSession(data.user.id);
  emit();
  return current;
}

/**
 * שולף `token_hash` מקישור אימות שהודבק.
 *
 * ★ מקבל גם כתובת מלאה וגם רק את החלק שאחרי הסימן — כי אנשים
 *   מדביקים את שניהם, ושניהם תקינים.
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
    /* ★ ברירת המחדל היא `email` ולא `email_change`: קישור שהגיע
       בלי `type` מגיע כמעט תמיד מ-Magic Link. */
    return { token, type: params.get('type') || 'email' };
  } catch {
    return null;
  }
}

/**
 * בודק מחדש מול השרת אם המייל כבר אומת.
 *
 * ★ זה מה שמאפשר את המסלול "לחצתי על הקישור במייל".
 *
 * הקישור נפתח בלשונית אחרת ומאשר את השינוי **בשרת**. הלשונית
 * שבה המשתמש יושב לא יודעת על זה כלום — היא מחזיקה עותק ישן של
 * המשתמש. רענון הסשן הוא מה שמביא את המצב האמיתי.
 */
export async function refreshIdentity(): Promise<Identity | null> {
  try {
    await supabase.auth.refreshSession();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return current;
    current = await fromSession(data.user.id);
    emit();
    return current;
  } catch {
    return current;
  }
}

/**
 * שגיאת OAuth שחזרה בכתובת.
 *
 * ★ ספק OAuth שמסרב לא זורק — הוא **מחזיר** לכתובת עם
 *   `error=...`. בלי קריאה מפורשת, המשתמש חוזר למסך הבית כאילו
 *   כלום לא קרה, מנסה שוב, ומקבל בדיוק אותו כלום.
 *
 * ⚠ `redirect_uri_mismatch` **לא** מגיע לכאן: במקרה הזה גוגל
 *   עוצרת אצלה ולא מפנה בחזרה בכלל. זו הסיבה שהיא מטופלת
 *   בלוח הניהול (`googleCallbackUrl`) ולא כאן.
 */
export function oauthErrorFromUrl(): string | null {
  try {
    const from = (s: string) => new URLSearchParams(s.replace(/^[?#]/, ''));
    const q = from(window.location.search);
    const h = from(window.location.hash);
    const err = q.get('error') || h.get('error');
    if (!err) return null;

    const desc = q.get('error_description') || h.get('error_description') || '';

    /* ניקוי הכתובת — אחרת רענון מציג את השגיאה שוב. */
    window.history.replaceState(null, '', window.location.pathname);

    return desc || err;
  } catch {
    return null;
  }
}

/**
 * הכתובת שגוגל **חייבת** להכיר.
 *
 * ★ היא נגזרת מכתובת הפרויקט החי ולא מוקלדת בשום מקום.
 *   מחרוזת שמוקלדת ביד בתיעוד היא מחרוזת שתהיה שגויה ביום
 *   שהפרויקט יוחלף — וזו בדיוק השגיאה שקשה לאתר.
 */
export function googleCallbackUrl(): string {
  return `${DUBID_PROJECT.url}/auth/v1/callback`;
}

/**
 * אותה כתובת, בצד של אופסיידס.
 *
 * ★★ למה היא מופיעה במסך של דוביד ★★
 *
 * כששני המוצרים חולקים **מזהה לקוח אחד** בגוגל, אותו OAuth
 * client חייב להכיר את **שתי** כתובות ההחזרה — אחת לכל פרויקט
 * Supabase. אם רק אחת רשומה, המוצר השני מקבל
 * `redirect_uri_mismatch`, וזה בדיוק מה שקרה.
 *
 * הצגת שתיהן יחד היא מה שהופך את ההגדרה לפעולה אחת במקום
 * לשתי חקירות נפרדות בהפרש של שבוע.
 */
export function offsidesCallbackUrl(): string {
  return `${OFFSIDES_PROJECT.url}/auth/v1/callback`;
}

/** סיסמה אופציונלית, אחרי שהמייל אומת. בלעדיה נכנסים בקוד למייל. */
export async function upgradeSetPassword(password: string): Promise<void> {
  if (password.length < 6) throw new Error('PASSWORD_TOO_SHORT');
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(mapAuthError(error.message));
  if (current) {
    current = await fromSession(current.id);
    emit();
  }
}

/**
 * גוגל — כקישור זהות, לא כהתחברות חדשה.
 *
 * ★ `linkIdentity` ולא `signInWithOAuth`.
 *
 * אותו באג בדיוק כמו למעלה: `signInWithOAuth` על סשן אנונימי
 * מחליף את המשתמש. `linkIdentity` **מוסיף** את גוגל למשתמש
 * הקיים ומשאיר את ה-uid — כלומר את ההרכבים ואת הדירוג.
 *
 * ⚠ גם זה דורש "Manual linking" מופעל בפרויקט.
 */
export async function upgradeWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.linkIdentity({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
  if (error) throw new Error(mapAuthError(error.message));
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
