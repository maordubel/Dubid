import { leagueName, selectedLeague } from '../lib/league.ts';
import { useI18n } from '../lib/i18n/index.tsx';
import { openLeagueGate, useLeagues } from './LeagueGate.tsx';

/**
 * שבב ליגה — מופיע רק כשיש יותר מליגה אחת. לחיצה פותחת את שער הליגות.
 * (לפני כן ישראלי לא רואה שום שינוי עד שיוון נפתחת.)
 */
export function LeaguePicker({ className = '' }: { className?: string }) {
  const { locale, t } = useI18n();
  const leagues = useLeagues();
  const active = selectedLeague();
  if (leagues.length < 2) return null;
  const cur = leagues.find((l) => (active ? l.code === active : l.primary)) ?? leagues[0];
  return (
    <button type="button" onClick={openLeagueGate} aria-label={t('gate.switch')}
            className={`tap inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-night-2 px-2.5 py-1 text-[12px] font-bold text-chalk ${className}`}>
      <span className="font-black text-gold">⇄</span>
      <span className="max-w-[9.5rem] truncate">{leagueName(cur, locale)}</span>
    </button>
  );
}
