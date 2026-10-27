/**
 * components/LeagueGate.tsx — שער הליגות.
 *
 * ★ כל ליגה היא משחק נפרד (מחזורים, טבלה, דירוג, היסטוריה). המסך הזה הוא
 *   הדלת: מופיע פעם אחת למי שעוד לא בחר (כשיש יותר מליגה אחת), ונפתח מחדש
 *   מהשבב שבלובי. החלפת ליגה = רענון דף (ראו lib/league.ts), ולכן שום שריד
 *   של ליגה אחת לא נשאר על מסך של השנייה.
 * ★ ליגה בלי מחזור נוכחי מוצגת כ«בקרוב» ואינה לחיצה.
 */
import { useEffect, useState } from 'react';
import { Logo } from './Logo.tsx';
import { LanguagePicker } from './LanguagePicker.tsx';
import {
  chooseLeague, fetchLeagues, hasChosenLeague, leagueEnterable, leagueName, markLeagueChosen,
  selectedLeague, type PublicLeague,
} from '../lib/league.ts';
import { useI18n } from '../lib/i18n/index.tsx';
import { LeagueFlag as Flag, leagueAccent } from './LeagueIdentity.tsx';

const OPEN_EVENT = 'dubid:league-gate';
export const openLeagueGate = () => window.dispatchEvent(new Event(OPEN_EVENT));

function fmtDur(ms: number, tt: (k: any, v?: any) => string): string {
  const m = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d > 0) return tt('gate.dur.d', { d, h });
  if (h > 0) return tt('gate.dur.h', { h, m: mm });
  return tt('gate.dur.m', { m: mm });
}

export function useLeagues(): PublicLeague[] {
  const [leagues, setLeagues] = useState<PublicLeague[]>([]);
  useEffect(() => {
    let alive = true;
    void fetchLeagues().then((l) => { if (alive) setLeagues(l); });
    return () => { alive = false; };
  }, []);
  return leagues;
}

function Card({ l, active, onPick }: { l: PublicLeague; active: boolean; onPick: () => void }) {
  const { locale, t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(i); }, []);

  const live = leagueEnterable(l);
  const fm = l.formats;
  const formatNote = !live || !fm ? null
    : fm.five.state === 'blocked' ? t('gate.onlyFull')
    : fm.full.state === 'blocked' ? t('gate.onlyFive')
    : (fm.five.state === 'degraded' || fm.full.state === 'degraded') ? t('gate.delayed') : null;
  const accent = leagueAccent(l.code);
  const st = l.status ?? '';
  const lockMs = l.lockAt ? Date.parse(l.lockAt) - now : NaN;
  const statusLabel =
    !live ? t('gate.soon')
    : st === 'open' ? t('gate.open')
    : st === 'live' ? t('gate.live')
    : st === 'locked' || st === 'scoring' ? t('gate.locked')
    : st === 'published' || st === 'archived' ? t('gate.final')
    : t('gate.prep');

  return (
    <button
      type="button"
      disabled={!live}
      onClick={onPick}
      aria-current={active ? 'true' : undefined}
      className={`group relative isolate block w-full overflow-hidden rounded-2xl border text-start transition active:scale-[0.99] ${
        live ? 'cursor-pointer' : 'cursor-default opacity-80'
      } ${active ? 'border-gold shadow-[0_0_0_1px_#D8B25C,0_18px_50px_-18px_#D8B25C66]' : 'border-white/10 hover:border-gold/50'}`}
      style={{ minHeight: 176, background: '#100d09' }}
    >
      {/* הדגל כרצועה מטושטשת שנשפכת אל הכרטיס */}
      <div aria-hidden="true" className="absolute inset-y-0 end-0 w-[62%] opacity-[0.55] transition group-hover:opacity-75"
           style={{ WebkitMaskImage: 'linear-gradient(to left,#000 30%,transparent)', maskImage: 'linear-gradient(to left,#000 30%,transparent)' }}>
        <div className="h-full w-full scale-125 blur-[2px]"><Flag country={l.code} /></div>
      </div>
      <div aria-hidden="true" className="absolute inset-0"
           style={{ background: `linear-gradient(115deg, #0C0A08 38%, ${accent}22 100%)` }} />
      {/* מסגרת דגל קטנה וחדה */}
      <div className="relative z-[1] flex h-full flex-col justify-between gap-5 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="h-[34px] w-[51px] overflow-hidden rounded-[5px] ring-1 ring-white/40 shadow-lg">
            <Flag country={l.code} />
          </div>
          <span className="rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-wider"
                style={{ background: live ? `${accent}33` : '#ffffff14', color: live ? '#BFD6FF' : '#C6B99F', border: `1px solid ${live ? accent : '#ffffff22'}` }}>
            {live && (st === 'live') ? <span className="me-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> : null}
            {statusLabel}
          </span>
        </div>

        <div>
          <div className="font-press text-[26px] font-black leading-[1.05] tracking-tight text-chalk">
            {leagueName(l, locale)}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-chalk-2">
            {live && l.round ? <b className="text-chalk">{t('gate.round', { n: l.round })}</b> : <span>{t('gate.soonNote')}</span>}
            {live && st === 'open' && Number.isFinite(lockMs) && lockMs > 0
              ? <span className="text-gold-light">{t('gate.locksIn', { t: fmtDur(lockMs, t) })}</span> : null}
            {formatNote ? <span className="text-amber-300">{formatNote}</span> : null}
            {/* ★ H01: מאמנים ייחודיים כשהשרת יודע; אחרת — הגשות, בתווית הנכונה. */}
            {live && (l.managers ?? 0) > 0 ? <span className="text-chalk-dim">{t('gate.entrants', { n: l.managers! })}</span>
              : live && l.entrants ? <span className="text-chalk-dim">{t('gate.lineups', { n: l.entrants })}</span> : null}
          </div>
        </div>

        <div className="flex items-center justify-between">
          {active ? <span className="text-[12px] font-bold text-gold">● {t('gate.here')}</span> : <span />}
          {live ? (
            <span className="rounded-full bg-gold px-4 py-1.5 text-[13px] font-black text-night transition group-hover:bg-gold-light">
              {t('gate.play')} ›
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

function Overlay({ leagues, onClose }: { leagues: PublicLeague[]; onClose: (() => void) | null }) {
  const { t, dir } = useI18n();
  const cur = selectedLeague();
  const activeCode = cur ?? leagues.find((l) => l.primary)?.code ?? null;

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div role="dialog" aria-modal="true" aria-label={t('gate.title')} dir={dir}
         className="fixed inset-0 z-[80] overflow-y-auto"
         style={{ background: 'radial-gradient(120% 70% at 50% 0%, #2a1f12 0%, #0C0A08 60%)' }}>
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 pb-8 pt-[calc(1rem+env(safe-area-inset-top))]">
        <div className="flex items-center justify-between">
          <LanguagePicker />
          {onClose ? (
            <button type="button" onClick={onClose} aria-label={t('gate.close')}
                    className="tap rounded-full border border-white/15 px-3 py-1 text-[13px] font-bold text-chalk-2 hover:text-chalk">✕</button>
          ) : <span />}
        </div>

        <div className="mt-4 flex flex-col items-center text-center">
          <Logo size={120} outline glow />
          <h1 className="font-press mt-3 text-[30px] font-black leading-tight text-chalk sm:text-[38px]">{t('gate.title')}</h1>
          <p className="mt-2 max-w-md text-[14px] leading-snug text-chalk-2">{t('gate.sub')}</p>
        </div>

        <div className="mt-6 grid flex-1 content-start gap-3 sm:grid-cols-2">
          {leagues.map((l) => (
            <Card key={l.code} l={l} active={l.code === activeCode}
                  onPick={() => {
                    if (l.code === activeCode) { markLeagueChosen(); onClose?.(); if (!onClose) window.location.reload(); return; }
                    chooseLeague(l.code, l.primary);
                  }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** מוּנט פעם אחת באפליקציה: פותח את השער אוטומטית בביקור הראשון, ובאירוע מהשבב. */
export function LeagueGateHost() {
  const leagues = useLeagues();
  const [open, setOpen] = useState(false);
  const [auto, setAuto] = useState(false);

  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, h);
    return () => window.removeEventListener(OPEN_EVENT, h);
  }, []);

  useEffect(() => {
    if (leagues.length >= 2 && !hasChosenLeague()) setAuto(true);
  }, [leagues]);

  /* ★ ההדגשה על <html data-league> — רצועת הצבע בראש המסך (index.css). */
  useEffect(() => {
    const code = selectedLeague();
    const l = leagues.find((x) => (code ? x.code === code : x.primary));
    if (l) document.documentElement.dataset.league = l.code; else delete document.documentElement.dataset.league;
  }, [leagues]);

  if (leagues.length < 2) return null;
  if (auto) return <Overlay leagues={leagues} onClose={null} />;
  if (open) return <Overlay leagues={leagues} onClose={() => setOpen(false)} />;
  return null;
}
