import { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n/index.tsx';
import { tr } from '../lib/i18n/dict.ts';
import { chooseLeague, clearIncomingLeague, incomingState, leagueName, resolveIncoming, retryIncoming, stayInCurrentLeague, subscribeIncoming, type IncomingState } from '../lib/league.ts';

/**
 * Connected Football (FAN LIFE, 27.10.2026). A FAN LIFE card sent the visitor for a league. A first visit takes it;
 * a player of another league is asked — switch or stay. Nothing changes silently, and nothing shows without a link.
 * CF-07: a failed read of the catalog keeps the intent and offers a retry of the same intent — never "no such league".
 * The decision itself lives in lib/league.ts `resolveIncoming()`, shared with the boot so it lands BEFORE live data.
 */
export function IncomingLeague() {
  const { locale } = useI18n();
  const [st, setSt] = useState<IncomingState>(incomingState());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const off = subscribeIncoming(() => setSt(incomingState()));
    void resolveIncoming();
    setSt(incomingState());
    return off;
  }, []);
  const box = { position: 'fixed', insetInline: 12, insetBlockStart: 'calc(env(safe-area-inset-top, 0px) + 10px)', zIndex: 70, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'center', padding: '10px 12px', background: 'var(--ink, #111)', color: 'var(--paper, #fff)', maxWidth: 460, marginInline: 'auto', borderRadius: 12 } as const;
  const btn = { minHeight: 44, minWidth: 44 } as const;
  if (st.kind === 'error') {
    return (
      <div role="alert" className="incoming-league" style={box}>
        <span>{tr('incoming.failed')}</span>
        <button type="button" style={btn} disabled={busy}
          onClick={() => { setBusy(true); void retryIncoming().finally(() => setBusy(false)); }}>{tr('incoming.retry')}</button>
        <button type="button" style={btn} onClick={stayInCurrentLeague}>{tr('incoming.dismiss')}</button>
      </div>
    );
  }
  if (st.kind !== 'ask') return null;
  const ask = st.league;
  return (
    <div role="status" className="incoming-league" style={box}>
      <span>{tr('incoming.came', { league: leagueName(ask, locale) })}</span>
      <button type="button" style={btn} onClick={() => { clearIncomingLeague(); chooseLeague(ask.code, ask.primary); }}>{tr('incoming.switch')}</button>
      <button type="button" style={btn} onClick={stayInCurrentLeague}>{tr('incoming.stay')}</button>
    </div>
  );
}
