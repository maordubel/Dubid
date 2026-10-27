/**
 * lib/pulse.ts — דופק המחזור: כמה כבר בפנים ומי נעל לאחרונה (db/65 round_pulse).
 *
 * ★ FOMO אמיתי ולא מומצא: רק מספרים שהשרת סופר. ההרכבים עצמם נחשפים
 *   רק בנעילה (`entries`), כאן אין אותם בכלל.
 * ★ זול: בקשה אחת קטנה, מטמון לפי מחזור, רענון כשמישהו הגיש (ערוץ מנותב,
 *   מרוסן) ורשת ביטחון של 2 דקות — רק כשהטאב גלוי.
 */
import { useEffect, useState } from 'react';
import { supabase } from './supabase.ts';
import { onRevision } from './revisionBus.ts';

/** ★ db/66: managers = זהויות ייחודיות עם הגשה תקפה; lineups = הגשות (משתמש בשני המצבים = 2). */
export interface PulseCounts { managers: number; lineups: number }

export interface RoundPulse {
  schemaVersion?: number;
  code: string;
  overall?: PulseCounts;
  byMode?: { five: PulseCounts; full: PulseCounts };
  window24h?: PulseCounts;
  total: number;
  five: number;
  full: number;
  last24h: number;
  lastHour: number;
  recent: Array<{ name: string; mode: 'five' | 'full'; at: string }>;
  at: string;
}

/**
 * המונה בהגדרה אחת: כולל או לפי מצב. מסד ישן (v1) → הרכבים בלבד, ו-managers
 * רק לפי מצב (אילוץ הרכב אחד למשתמש למצב) — לא ממציאים ספירת אנשים כוללת.
 */
export function pulseCounts(p: RoundPulse | null | undefined, mode?: 'five' | 'full'): PulseCounts | null {
  if (!p) return null;
  if (mode) {
    const v2 = p.byMode?.[mode];
    if (v2) return v2;
    const n = mode === 'five' ? p.five : p.full;
    return { managers: n, lineups: n };
  }
  return p.overall ?? null;
}

const cache = new Map<string, { at: number; value: RoundPulse | null }>();
const listeners = new Map<string, Set<(p: RoundPulse | null) => void>>();
const inflight = new Map<string, Promise<RoundPulse | null>>();

async function load(code: string, force = false): Promise<RoundPulse | null> {
  const hit = cache.get(code);
  if (!force && hit && Date.now() - hit.at < 30_000) return hit.value;
  const running = inflight.get(code);
  if (running) return running;
  const p = (async () => {
    try {
      const { data, error } = await supabase.rpc('round_pulse', { p_gw_code: code });
      const value = !error && data && typeof data === 'object' ? (data as RoundPulse) : (hit?.value ?? null);
      cache.set(code, { at: Date.now(), value });
      listeners.get(code)?.forEach((fn) => fn(value));
      return value;
    } catch {
      return hit?.value ?? null;
    } finally {
      inflight.delete(code);
    }
  })();
  inflight.set(code, p);
  return p;
}

export function usePulse(code: string | null | undefined): RoundPulse | null {
  const [pulse, setPulse] = useState<RoundPulse | null>(code ? cache.get(code)?.value ?? null : null);
  useEffect(() => {
    if (!code) { setPulse(null); return; }
    let alive = true;
    const set = (p: RoundPulse | null) => { if (alive) setPulse(p); };
    let ls = listeners.get(code);
    if (!ls) { ls = new Set(); listeners.set(code, ls); }
    ls.add(set);
    void load(code).then(set);
    const stop = onRevision(['user_lineups'], () => { void load(code, true); }, 4000);
    const id = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void load(code, true);
    }, 120_000);
    return () => { alive = false; ls!.delete(set); stop(); clearInterval(id); };
  }, [code]);
  return pulse;
}

/** "לפני 4 דק׳" / "4 min ago" — בשפה הפעילה. */
export function ago(iso: string, intl: string, nowMs = Date.now()): string {
  const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  const rtf = new Intl.RelativeTimeFormat(intl, { numeric: 'auto', style: 'short' });
  if (s < 60) return rtf.format(0, 'minute');
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  return rtf.format(-Math.round(s / 86400), 'day');
}
