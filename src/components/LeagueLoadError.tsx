/**
 * components/LeagueLoadError.tsx — כשל טעינה של ליגה לא-ראשית.
 *
 * ★ לא מחליפים ליגה בשקט: המשתמש בחר ליגה, והכשל (רשת/שרת) לא הופך אותה לראשית.
 *   שתי פעולות מפורשות: לנסות שוב, או לבחור ליגה אחרת (שער הליגות).
 */
import { useI18n } from '../lib/i18n/index.tsx';
import { openLeagueGate } from './LeagueGate.tsx';

export function LeagueLoadError({ onRetry, busy }: { onRetry: () => void; busy: boolean }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-5 bg-[var(--bg,#0b0b0b)] px-6 text-center">
      <h1 className="text-2xl font-extrabold">{t('gate.loadFail.title')}</h1>
      <p className="max-w-sm text-sm opacity-80">{t('gate.loadFail.sub')}</p>
      <div className="flex w-full max-w-xs flex-col gap-3">
        <button type="button" disabled={busy} onClick={onRetry}
          className="min-h-[44px] rounded-xl bg-[var(--accent,#c6ff3d)] px-4 font-bold text-black disabled:opacity-60">
          {t('gate.loadFail.retry')}
        </button>
        <button type="button" onClick={openLeagueGate}
          className="min-h-[44px] rounded-xl border border-white/30 px-4 font-semibold">
          {t('gate.loadFail.other')}
        </button>
      </div>
    </div>
  );
}
