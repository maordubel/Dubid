import { useEffect, useState } from 'react';
import { chooseLeague, fetchLeagues, leagueName, selectedLeague, type PublicLeague } from '../lib/league.ts';
import { useI18n } from '../lib/i18n/index.tsx';

const FLAG: Record<string, string> = { IL: '🇮🇱', GR: '🇬🇷' };

/**
 * בורר ליגה. מופיע רק כשיש יותר מליגה אחת עם מחזור פעיל — לפני כן הוא
 * לא קיים, ולכן משתמש ישראלי לא רואה שום שינוי עד שיוון נפתחת.
 */
export function LeaguePicker({ className = '' }: { className?: string }) {
  const { locale, t } = useI18n();
  const [leagues, setLeagues] = useState<PublicLeague[]>([]);
  const active = selectedLeague();

  useEffect(() => {
    let alive = true;
    void fetchLeagues().then((l) => { if (alive) setLeagues(l); });
    return () => { alive = false; };
  }, []);

  if (leagues.length < 2) return null;
  const current = leagues.find((l) => (active ? l.code === active : l.primary)) ?? leagues[0];

  return (
    <label className={`inline-flex items-center gap-1 ${className}`}>
      <span className="sr-only">{t('league.pick')}</span>
      <select
        value={current.code}
        onChange={(e) => {
          const next = leagues.find((l) => l.code === e.target.value);
          if (next && next.code !== current.code) chooseLeague(next.code, next.primary);
        }}
        className="tap rounded-md border border-gold/30 bg-night-2 px-2 py-1 text-[12px] font-bold text-chalk"
      >
        {leagues.map((l) => (
          <option key={l.code} value={l.code}>
            {FLAG[l.country] ?? '⚽'} {leagueName(l, locale)}
          </option>
        ))}
      </select>
    </label>
  );
}
