/**
 * components/RoundTracker.tsx — "איפה אנחנו במחזור".
 * חמישה שלבים, השלב הנוכחי מודגש; מתחת — מה עושים עכשיו והעובדות.
 */
import { STEPS, type RoundBrief } from '../lib/roundPhase.ts';
import { NIGHT_PRESS as NP } from '../lib/pressPalette.ts';
import { useI18n } from '../lib/i18n/index.tsx';

export function RoundTracker({ brief }: { brief: RoundBrief }) {
  const { t } = useI18n();
  return (
    <section className="relative z-[2] mx-3 mt-2 border px-3 py-3"
             style={{ borderColor: NP.rule }} aria-label={t('shell.round.aria')} data-round-step={brief.step}>
      <ol className="flex items-center justify-between gap-1" aria-label={t('shell.round.stepsAria')}>
        {STEPS.map((s, idx) => {
          const done = idx < brief.stepIndex;
          const now = idx === brief.stepIndex;
          return (
            <li key={s.id} className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center"
                aria-current={now ? 'step' : undefined}>
              <span className="h-2 w-full" style={{
                background: now ? NP.goldLight : done ? NP.goldDeep : NP.rule,
              }} />
              <span className="text-[10.5px] leading-tight" style={{
                color: now ? NP.ink : NP.inkFaint, fontWeight: now ? 800 : 500,
              }}>{s.label}</span>
            </li>
          );
        })}
      </ol>

      <p className="mt-3 text-[15px] font-black leading-snug" style={{ color: NP.ink }}>
        {brief.headline}
      </p>
      <p className="mt-0.5 text-[12.5px] leading-snug" style={{ color: NP.inkFaint }}>
        {brief.doNow}
      </p>

      {brief.facts.length > 0 && (
        <dl className="mt-2.5 space-y-1">
          {brief.facts.map((f) => (
            <div key={f.label} className="flex items-baseline justify-between gap-3 text-[12px]">
              <dt style={{ color: NP.inkFaint }}>{f.label}</dt>
              <dd className="num font-bold" style={{ color: NP.ink }}>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
