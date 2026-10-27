import { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n/index.tsx';
import { tr } from '../lib/i18n/dict.ts';
import { chooseLeague, clearIncomingLeague, fetchLeagues, hasChosenLeague, incomingDecision, incomingLeague, leagueName, selectedLeague, type PublicLeague } from '../lib/league.ts';

/**
 * Connected Football (FAN LIFE, 27.10.2026). A FAN LIFE card sent the visitor for a league. A first visit takes it;
 * a player of another league is asked — switch or stay. Nothing changes silently, and nothing shows without a link.
 */
export function IncomingLeague() {
  const { locale } = useI18n();
  const [ask, setAsk] = useState<PublicLeague | null>(null);
  useEffect(() => {
    const code = incomingLeague();
    if (!code) return;
    let dead = false;
    void fetchLeagues().then((all) => {
      if (dead) return;
      const d = incomingDecision(code, all, hasChosenLeague(), selectedLeague());
      if (d.kind === 'none') { clearIncomingLeague(); return; }
      if (d.kind === 'choose') { clearIncomingLeague(); chooseLeague(d.league.code, d.league.primary); return; }
      setAsk(d.league);
    }).catch(() => clearIncomingLeague());
    return () => { dead = true; };
  }, []);
  if (!ask) return null;
  const stay = () => { clearIncomingLeague(); setAsk(null); };
  return (
    <div role="status" className="incoming-league" style={{ position: 'fixed', insetInline: 12, insetBlockStart: 'calc(env(safe-area-inset-top, 0px) + 10px)', zIndex: 70, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'center', padding: '10px 12px', background: 'var(--ink, #111)', color: 'var(--paper, #fff)', maxWidth: 460, marginInline: 'auto', borderRadius: 12 }}>
      <span>{tr('incoming.came', { league: leagueName(ask, locale) })}</span>
      <button type="button" style={{ minHeight: 44, minWidth: 44 }} onClick={() => { clearIncomingLeague(); chooseLeague(ask.code, ask.primary); }}>{tr('incoming.switch')}</button>
      <button type="button" style={{ minHeight: 44, minWidth: 44 }} onClick={stay}>{tr('incoming.stay')}</button>
    </div>
  );
}
