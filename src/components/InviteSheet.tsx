/**
 * components/InviteSheet.tsx — הזמנה לזירה, לפני ההצטרפות.
 *
 * ★ מי שלוחץ על `/l/CODE` רואה **קודם** למה הוא מצטרף: שם הזירה, הליגה,
 *   הפורמט ומספר המשתתפים — מהשרת, לא מהקישור. רק אז «הצטרפות».
 * ★ זירה בליגה אחרת → «מעבר לליגה והצטרפות» (רענון; ההזמנה שורדת אותו).
 * ★ כל כישלון (מלאה/סגורה/כבר חבר/לא קיימת) מוסבר במקום, לא נבלע.
 */
import { useEffect, useState } from 'react';

import { peekByCode, joinByCode, type LeaguePeek } from '../lib/leagueStore.ts';
import { chooseLeague, fetchLeagues, leagueName, selectedLeague, type PublicLeague } from '../lib/league.ts';
import { clearInvite, pendingInvite } from '../lib/invite.ts';
import { useI18n } from '../lib/i18n/index.tsx';
import type { DictKey } from '../lib/i18n/dict.ts';
import { NIGHT_PRESS as NP, MISREGISTER } from '../lib/pressPalette.ts';
import { LeagueFlag, leagueAccent } from './LeagueIdentity.tsx';

export function InviteSheet({ ready, userId, displayName, onJoined }: {
  ready: boolean;
  userId: string;
  displayName: string;
  onJoined: (mode: 'five' | 'full') => void;
}) {
  const { t, locale } = useI18n();
  const [code, setCode] = useState<string | null>(null);
  const [peek, setPeek] = useState<LeaguePeek | null | 'missing'>(null);
  const [leagues, setLeagues] = useState<PublicLeague[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    const c = pendingInvite();
    if (!c) return;
    setCode(c);
    let alive = true;
    void Promise.all([peekByCode(c), fetchLeagues()]).then(([p, ls]) => {
      if (!alive) return;
      setPeek(p ?? 'missing');
      setLeagues(ls);
    });
    return () => { alive = false; };
  }, [ready]);

  if (!code || peek === null) return null;

  const close = () => { clearInvite(); setCode(null); };

  const current = selectedLeague() ?? leagues.find((l) => l.primary)?.code ?? null;
  const p = peek === 'missing' ? null : peek;
  const world = p?.world ?? leagues.find((l) => l.primary)?.code ?? null;
  const otherWorld = !!p && !!world && world !== current;
  const lg = leagues.find((l) => l.code === world);
  const accent = leagueAccent(world);
  const full = !!p && p.maxMembers !== null && p.members >= p.maxMembers;
  const closed = !!p && p.status === 'closed';

  const join = () => {
    if (!p || busy) return;
    if (otherWorld && world) { chooseLeague(world, Boolean(p.worldPrimary)); return; }
    setBusy(true);
    setError(null);
    void joinByCode(code, userId, displayName || t('arena.anon'))
      .then((res) => {
        if (res.ok || res.error === 'already_member') {
          clearInvite();
          setCode(null);
          onJoined(p.mode === 'full' ? 'full' : 'five');
          return;
        }
        setError(res.error ? t(`arena.join.${res.error}` as DictKey) : t('arena.joinFailed'));
      })
      .catch(() => setError(t('arena.joinFailed')))
      .finally(() => setBusy(false));
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="invite-title"
         className="fixed inset-0 z-[85] flex items-end justify-center bg-black/70 sm:items-center"
         onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="w-full max-w-md rounded-t-3xl border p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]
                      sm:rounded-3xl sm:pb-5"
           style={{ borderColor: NP.rule, background: `linear-gradient(160deg, #100D0A 60%, ${accent}22)` }}>
        <p className="text-[10.5px] font-black uppercase tracking-[0.2em] text-chalk-dim">{t('invite.kicker')}</p>

        {p ? (
          <>
            <h2 id="invite-title" className="mt-1 font-press text-[26px] font-black leading-tight text-chalk"
                style={{ textShadow: MISREGISTER }}>
              <bdi>{p.name}</bdi>
            </h2>
            <div className="mt-3 flex items-center gap-2.5">
              {world && (
                <span className="h-[22px] w-[33px] shrink-0 overflow-hidden rounded-[3px] ring-1 ring-white/30">
                  <LeagueFlag country={world} />
                </span>
              )}
              <span className="text-[13px] font-bold text-chalk-2">
                {lg ? leagueName(lg, locale) : world}
                {' · '}{t(p.mode === 'full' ? 'mode.full.title' : 'mode.five.title')}
              </span>
            </div>
            <p className="num mt-2 text-[12.5px] text-chalk-dim">
              {p.maxMembers !== null
                ? t('invite.membersOf', { n: p.members, max: p.maxMembers })
                : t('invite.members', { n: p.members })}
            </p>

            {otherWorld && <p className="mt-3 text-[12.5px] text-gold-light">{t('invite.otherLeague')}</p>}
            {(full || closed) && (
              <p role="alert" className="mt-3 text-[12.5px] font-bold text-flare">
                {t(full ? 'arena.join.league_full' : 'arena.join.league_closed')}
              </p>
            )}
            {error && <p role="alert" className="mt-3 text-[12.5px] font-bold text-flare">{error}</p>}

            <div className="mt-5 flex flex-col gap-2">
              <button type="button" onClick={join} disabled={busy || full || closed}
                      className="tap min-h-[48px] rounded-2xl bg-gradient-to-b from-gold-light to-gold
                                 font-poster text-[17px] text-gold-ink disabled:opacity-40">
                {busy ? '…' : otherWorld ? t('invite.switchJoin') : t('invite.join')}
              </button>
              <button type="button" onClick={close}
                      className="tap min-h-[44px] rounded-2xl border border-white/15 text-[13px] font-bold text-chalk-2">
                {t('invite.notNow')}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="invite-title" className="mt-1 font-press text-[22px] font-black text-chalk">
              {t('arena.join.league_not_found')}
            </h2>
            <button type="button" onClick={close}
                    className="tap mt-5 min-h-[44px] w-full rounded-2xl border border-white/15 text-[13px] font-bold text-chalk-2">
              {t('invite.notNow')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
