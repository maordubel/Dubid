import { LOCALES, LOCALE_META } from '../lib/i18n/locales.ts';
import { useI18n } from '../lib/i18n/index.tsx';

/** בורר שפה קטן — שלוש אפשרויות, בלי תפריט. */
export function LanguagePicker({ className = '' }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <div role="group" aria-label={t('lang.aria')} className={`flex items-center gap-1 ${className}`}>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          aria-pressed={l === locale}
          lang={l}
          className={`tap rounded-md px-2 py-1 text-[12px] font-bold ${
            l === locale ? 'bg-gold text-night' : 'text-chalk-dim hover:text-chalk'
          }`}
        >
          {LOCALE_META[l].native}
        </button>
      ))}
    </div>
  );
}
