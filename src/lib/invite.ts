/**
 * lib/invite.ts — קישור הזמנה לזירה (`/l/CODE`).
 *
 * ★ הקישור נקלט פעם אחת בעלייה, נשמר לזמן קצוב (30 דק׳) ב-sessionStorage,
 *   והנתיב מנוקה ל-`/`. כך הכוונה שורדת החלפת ליגה (שמרעננת את הדף), אבל
 *   לא נשארת לנצח. אין טוקן ואין זהות בקישור — רק קוד הזירה.
 * ★ הליגה והפורמט אינם בקישור: השרת (`league_by_code`) הוא מקור האמת.
 */
import { normalizeCode, isValidCode } from './leagues.ts';

const KEY = 'dubid.invite';
const TTL_MS = 30 * 60_000;

export function captureInviteFromUrl(): void {
  try {
    const m = /^\/l\/([A-Za-z0-9]{4,12})\/?$/.exec(window.location.pathname);
    if (!m) return;
    const code = normalizeCode(m[1]);
    if (isValidCode(code)) {
      sessionStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() }));
    }
    window.history.replaceState(null, '', '/' + window.location.search + window.location.hash);
  } catch { /* מצב פרטי / SSR */ }
}

export function pendingInvite(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { code?: string; at?: number };
    if (!v.code || !v.at || Date.now() - v.at > TTL_MS) { sessionStorage.removeItem(KEY); return null; }
    return v.code;
  } catch { return null; }
}

export function clearInvite(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
