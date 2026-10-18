/**
 * components/LockCountdownStrip.tsx — "המחזור ננעל בעוד 05:12:09".
 *
 * דבוק לראש המסך מ-12 שעות לפני הנעילה ועד הנעילה עצמה. בלי X: זה לא
 * פרסומת אלא עובדה על המשחק, והיא מוצגת לכולם. השעון הוא שעון השרת
 * (`serverNow`), ושעת הנעילה היא של המחזור הנוכחי במסד — אותה שעה ש-FAN LIFE
 * קורא מאותו סופבייס לתזכורת בטלגרם. נעלם לבד ברגע הנעילה.
 */
import { useEffect, useState } from 'react';
import { getGameweekState, subscribeToStore } from '../lib/store.ts';
import { serverNow } from '../lib/serverTime.ts';
import { lockStripView } from '../lib/gameweek.ts';
import { useI18n } from '../lib/i18n/index.tsx';

export function LockCountdownStrip() {
  const { t } = useI18n();
  const [, tick] = useState(0);
  useEffect(() => subscribeToStore(() => tick((n) => n + 1)), []);
  const gw = getGameweekState();
  const view = lockStripView(gw?.lockAt, gw?.status, serverNow());

  const active = view !== null;
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    const vis = () => { if (!document.hidden) tick((n) => n + 1); };
    document.addEventListener('visibilitychange', vis);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [active]);

  /* כשמחוץ לחלון — עדיין בודקים אחת לדקה, כדי שהסטריפ יידלק לבד ב-T-12 */
  useEffect(() => {
    if (active) return;
    const t = window.setInterval(() => tick((n) => n + 1), 60_000);
    return () => window.clearInterval(t);
  }, [active]);

  if (!view) return null;
  return (
    <div
      role="timer"
      aria-live="off"
      data-lock-strip={view.urgent ? 'urgent' : 'on'}
      className={[
        'z-40 flex shrink-0 items-center justify-center gap-3 px-4 py-1.5 text-sm font-bold',
        'pt-[calc(0.375rem+env(safe-area-inset-top))]',
        view.urgent ? 'bg-red-700 text-white' : 'bg-night-2 text-chalk border-b border-gold/25',
      ].join(' ')}
    >
      <span>{t('shell.lockStrip')}</span>
      <span dir="ltr" className="num tabular-nums text-base">{view.clock}</span>
    </div>
  );
}
