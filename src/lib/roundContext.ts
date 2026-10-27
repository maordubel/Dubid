/**
 * lib/roundContext.ts — "לאיזה מחזור אני בונה, עד מתי, ומה אחריו" (U01/U04/5.5).
 *
 * ★ תצוגה בלבד. הנעילה נאכפת בשרת (`game.gameweeks.lock_at`); כאן רק איך מציגים
 *   אותה: תאריך+שעה+אזור זמן של הליגה תמיד, וספירה לאחור כחיזוק — לא כתחליף.
 * ★ המחזור הבא מגיע מהשרת (`game.next_round`), לא מ"מספר+1".
 */
import { supabase } from './supabase.ts';
import { tr, activeLocale } from './i18n/dict.ts';
import { LOCALE_META } from './i18n/locales.ts';
import { leagueTimezone } from './leagueTz.ts';

const CITY: Record<string, { he: string; en: string; el: string }> = {
  'Asia/Jerusalem': { he: 'ישראל', en: 'Israel', el: 'Ισραήλ' },
  'Europe/Athens':  { he: 'יוון', en: 'Greece', el: 'Ελλάδας' },
  'Europe/London':  { he: 'לונדון', en: 'UK', el: 'Λονδίνου' },
  'Europe/Madrid':  { he: 'ספרד', en: 'Spain', el: 'Ισπανίας' },
};

/** "שעון ישראל" / "Athens time". אזור לא מוכר → שם העיר מתוך ה-IANA. */
export function tzLabel(tz = leagueTimezone()): string {
  const l = activeLocale();
  const known = CITY[tz]?.[l];
  const city = known ?? (tz.split('/').pop() ?? tz).replace(/_/g, ' ');
  return tr('round.tz', { city });
}

/** "שבת 31.10 · 19:00" / "Sat 31 Oct · 19:00" — באזור הזמן של הליגה. */
export function deadlineLabel(iso: string, tz = leagueTimezone()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const intl = LOCALE_META[activeLocale()].intl;
  const day = d.toLocaleDateString(intl, { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz });
  const time = d.toLocaleTimeString(intl, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz });
  return `${day} · ${time}`;
}

/** "4d 3h" / "5h 12m" / "12m" / "<1m". שלילי → null. */
export function countdownShort(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  if (d > 0) return tr('round.cd.dh', { d, h });
  if (h > 0) return tr('round.cd.hm', { h, m: mm });
  return mm > 0 ? tr('round.cd.m', { m: mm }) : tr('round.cd.lt1');
}

/** מפתח יום (YYYY-MM-DD) באזור הזמן של הליגה — לקיבוץ לפי יום. */
export function dayKey(iso: string, tz = leagueTimezone()): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });
}

export function dayHeading(iso: string, tz = leagueTimezone()): string {
  return new Date(iso).toLocaleDateString(LOCALE_META[activeLocale()].intl, {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: tz,
  });
}

export function timeOnly(iso: string, tz = leagueTimezone()): string {
  return new Date(iso).toLocaleTimeString(LOCALE_META[activeLocale()].intl, {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz,
  });
}

/* ------------------------------------------------------------------ */
/* המחזור הבא                                                          */
/* ------------------------------------------------------------------ */

export interface RoundFixtureLite {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  kickoff: string;
  status: string;
}

export interface NextRound {
  code: string;
  number: number;
  status: string;
  lockAt: string | null;
  firstKickoffAt: string | null;
  fixturesTotal: number;
  fixtures: RoundFixtureLite[];
}

const cache = new Map<string, Promise<NextRound | null>>();

/** המחזור שאחרי `code` + הלוח שלו. נשמר בזיכרון לפי קוד; כשל → null (המסך פשוט לא מציג). */
export function fetchNextRound(code: string): Promise<NextRound | null> {
  if (!code) return Promise.resolve(null);
  const hit = cache.get(code);
  if (hit) return hit;
  const p = (async () => {
    try {
      const { data, error } = await supabase.rpc('next_round', { p_gw_code: code });
      if (error || !data || typeof data !== 'object') return null;
      const n = data as Omit<NextRound, 'fixtures'>;
      if (!n.code) return null;
      const fx = await supabase.rpc('fixtures', { p_gw_code: n.code });
      const rows = (!fx.error && (fx.data as { fixtures?: RoundFixtureLite[] } | null)?.fixtures) || [];
      return { ...n, fixtures: rows.map((f) => ({
        id: f.id, homeTeamId: f.homeTeamId, awayTeamId: f.awayTeamId, kickoff: f.kickoff, status: f.status,
      })) };
    } catch {
      return null;
    }
  })();
  cache.set(code, p);
  p.then((v) => { if (v === null) cache.delete(code); }, () => cache.delete(code));
  return p;
}
