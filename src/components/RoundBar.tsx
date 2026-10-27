/**
 * components/RoundBar.tsx — המחזור בתוך מסך בניית ההרכב (U01/U03/U04/5.5).
 *
 * ★ מה היה: הכותרת אמרה "Round 9" — ולא עד מתי, נגד מי, ומה אחריו. הדדליין
 *   הופיע רק ב-12 השעות האחרונות, ולוח המשחקים ירד מהמסך כדי לשמור גובה למגרש.
 * ★ מה עכשיו:
 *   · פס "דייטליין" אחד (≈46px): לאיזה מחזור בונים · מתי ננעל (תאריך+שעה+שעון
 *     הליגה, תמיד) · ספירה לאחור · כפתור "7 משחקים".
 *   · לוח המשחקים בגיליון (נייד) או בעמודה לצד המגרש (דסקטופ): לפי יום, עם
 *     השחקנים שלי בכל משחק, ולשונית "הבא" עם המחזור שאחריו — מהשרת, לא +1.
 * ★ תצוגה בלבד: הנעילה נאכפת בשרת. אין כאן כפתור שמגיש למחזור אחר.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { TEAM_BY_ID } from '../data/squads.ts';
import { fixtureStatus, type Fixture } from '../data/fixtures.ts';
import { TeamCrest } from './TeamCrest.tsx';
import { useI18n } from '../lib/i18n/index.tsx';
import {
  countdownShort, dayHeading, dayKey, deadlineLabel, loadNextRound, NEXT_ROUND_TTL_MS, peekNextRound,
  retainNextRoundBus, timeOnly, tzLabel, watchNextRound,
  type NextRound, type NextRoundLoadState, type RoundFixtureLite,
} from '../lib/roundContext.ts';
import { track } from '../lib/analytics.ts';
import { useDialog } from '../lib/useDialog.ts';
import { selectedLeague } from '../lib/league.ts';

export type RoundUse = 'build' | 'submitted' | 'locked' | 'live' | 'scoring' | 'published';

/** בחירות שלי לפי קבוצה — לסימון במשחקים. */
export type PicksByTeam = Record<string, string[]>;

/* ================================================================== */
/* הפס                                                                 */
/* ================================================================== */

export function RoundBar({
  use, roundNumber, roundCode, deadlineAt, nowMs, fixturesCount, saving, savedAt, picked = 0, entrants, onOpenFixtures,
}: {
  use: RoundUse;
  roundNumber: number;
  roundCode: string;
  deadlineAt: string;
  nowMs: number;
  fixturesCount: number;
  saving?: boolean;
  savedAt?: number | null;
  /** כמה שחקנים בטיוטה — "נשמר" מוצג רק כשיש מה לשמור. */
  picked?: number;
  /** ★ FOMO: כמה כבר הגישו במצב הזה. */
  entrants?: number;
  onOpenFixtures: () => void;
}) {
  const { t } = useI18n();
  const left = Date.parse(deadlineAt) - nowMs;
  const cd = countdownShort(left);
  const urgent = left > 0 && left < 24 * 3600_000;
  const open = use === 'build' || use === 'submitted';
  const nextSt = useNextRound(open ? '' : roundCode, true);
  const next = nextData(nextSt);

  const stateChip: Record<RoundUse, string | null> = {
    build: null,
    submitted: t('round.submitted'),
    locked: t('round.lockedNow'),
    live: t('round.inPlay'),
    scoring: t('round.scoring'),
    published: t('round.final'),
  };

  return (
    <div className="shrink-0 border-b border-gold/20 bg-night-2/80" data-round-bar={use}>
      <div className="mx-auto flex max-w-3xl items-stretch gap-2 px-2.5 py-1.5">
        {/* ---- המחזור ---- */}
        <div className="flex min-w-0 shrink-0 flex-col justify-center pe-2.5 [border-inline-end:1px_solid_rgba(216,178,92,.22)]">
          <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.12em] text-gold/80">
            {use === 'build' ? t('round.building') : t('round.viewing')}
            {entrants !== undefined && entrants > 0 && (
              <span className="normal-case tracking-normal text-flare">· {t('fomo.barIn', { n: entrants })}</span>
            )}
            {use === 'build' && picked > 0 && (saving || savedAt) && (
              <span aria-live="polite" title={saving ? t('round.saving') : t('round.saved')}
                    aria-label={saving ? t('round.saving') : t('round.saved')}
                    className="normal-case tracking-normal text-chalk-dim">
                {saving ? '…' : '✓'}
              </span>
            )}
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="font-press text-[17px] font-black leading-tight text-chalk">
              {t('round.n', { n: roundNumber })}
            </span>
            {stateChip[use] && (
              <span className={`rounded-sm px-1 py-px text-[9.5px] font-black ${
                use === 'submitted' ? 'bg-gold/20 text-gold-light' : 'bg-chalk/10 text-chalk-2'}`}>
                {use === 'submitted' ? '✓ ' : ''}{stateChip[use]}
              </span>
            )}
          </span>
        </div>

        {/* ---- הנעילה / הבא ---- */}
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          {open ? (
            <>
              <span className="truncate text-[10px] font-black uppercase tracking-[0.1em] text-chalk-dim">
                {t('round.locks')} · {tzLabel()}
              </span>
              <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
                <span className="num whitespace-nowrap text-[15px] font-black leading-tight text-chalk" dir="auto">
                  {deadlineLabel(deadlineAt)}
                </span>
                {cd && (
                  <span
                    role="timer"
                    className={`num shrink-0 rounded-sm px-1 py-px text-[11px] font-black ${
                      urgent ? 'bg-flare text-white' : 'border border-gold/40 text-gold'}`}
                    dir="auto"
                  >
                    {t('round.locksIn', { t: cd })}
                  </span>
                )}
              </span>
            </>
          ) : next ? (
            <>
              <span className="truncate text-[9px] font-black uppercase tracking-[0.12em] text-chalk-dim">
                {t('round.next')} · {t('round.n', { n: next.number })}
              </span>
              <span className="truncate text-[12px] font-bold text-chalk-2">
                {next.status === 'open' && next.lockAt
                  ? t('round.nextLocks', { when: deadlineLabel(next.lockAt) })
                  : t('round.nextOpens', { c: roundNumber })}
              </span>
            </>
          ) : nextSt.status === 'loading' ? (
            <span className="truncate text-[11.5px] text-chalk-dim">{t('round.nextLoading')}</span>
          ) : nextSt.status === 'error' ? (
            <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-chalk-dim">
              <span className="truncate">{t('round.nextError')}</span>
              <RetryButton code={roundCode} st={nextSt} />
            </span>
          ) : (
            <span className="truncate text-[11.5px] text-chalk-dim">{t('round.nextTba')}</span>
          )}
        </div>

        {/* ---- הלוח (נייד; בדסקטופ הוא עמודה קבועה) ---- */}
        <button
          type="button"
          onClick={onOpenFixtures}
          aria-label={t('round.matchesAria', { n: roundNumber })}
          className="tap flex shrink-0 flex-col items-center justify-center rounded-lg border border-gold/45
                     bg-gold/10 px-2.5 text-gold transition-colors duration-200 active:bg-gold/20 lg:hidden"
        >
          <span className="num text-[15px] font-black leading-none">{fixturesCount || '—'}</span>
          <span className="text-[9px] font-black leading-tight">{t('round.fixtures')}</span>
        </button>
      </div>
    </div>
  );
}

/* ================================================================== */
/* המחזור הבא                                                          */
/* ================================================================== */

const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/** הנתון להצגה: טרי, או ישן אחרי כשל (מסומן). */
function nextData(st: NextRoundLoadState): NextRound | null {
  return st.status === 'ready' ? st.data : st.status === 'error' ? st.cached ?? null : null;
}

/**
 * ★ H05: `live` = התצוגה העתידית גלויה עכשיו → רענון שקט לכל היותר פעם ב-TTL,
 *   רק בטאב גלוי, וחזרה לטאב מרעננת אם פג התוקף. לא גלוי → טעינה אחת (ומטמון).
 *   שינוי מחזור/לוח מבטל את המטמון דרך ערוץ אחד (retainNextRoundBus).
 *   תשובה למחזור הקודם (החלפת ליגה באמצע) לא נוגעת במסך — `alive` + מפתח.
 */
function useNextRound(code: string, live: boolean): NextRoundLoadState {
  const [st, setSt] = useState<NextRoundLoadState>(() => (code ? peekNextRound(code) : { status: 'empty', checkedAt: 0 }));
  useEffect(() => {
    if (!code) { setSt({ status: 'empty', checkedAt: Date.now() }); return; }
    let alive = true;
    setSt(peekNextRound(code));
    const apply = (s: NextRoundLoadState) => {
      if (!alive) return;
      setSt(s);
      if (live && s.status === 'ready' && s.stale && !hidden()) void loadNextRound(code);
    };
    const unwatch = watchNextRound(code, apply);
    const release = retainNextRoundBus();
    void loadNextRound(code).then(apply);
    const id = live ? setInterval(() => { if (!hidden()) void loadNextRound(code); }, NEXT_ROUND_TTL_MS) : null;
    const onVis = () => { if (live && !hidden()) void loadNextRound(code); };
    if (live) document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false; unwatch(); release();
      if (id) clearInterval(id);
      if (live) document.removeEventListener('visibilitychange', onVis);
    };
  }, [code, live]);
  return st;
}

function RetryButton({ code, st }: { code: string; st: NextRoundLoadState }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={() => {
        track('next_round_retry', { league_code: selectedLeague(), error_code: st.status === 'error' ? st.errorCode : 'none' });
        void loadNextRound(code, true);
      }}
      className="tap shrink-0 rounded-full border border-gold/40 px-2 py-0.5 text-[11px] font-black text-gold"
    >
      {t('round.retry')}
    </button>
  );
}

/* ================================================================== */
/* לוח המשחקים                                                         */
/* ================================================================== */

export function FixturesBoard({
  roundNumber, roundCode, fixtures, picks, compact = false,
}: {
  roundNumber: number;
  roundCode: string;
  fixtures: Fixture[];
  picks: PicksByTeam;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'this' | 'next'>('this');
  const [mine, setMine] = useState(false);
  const nextSt = useNextRound(roundCode, tab === 'next');
  const next = nextData(nextSt);

  const myCount = Object.values(picks).reduce((n, a) => n + a.length, 0);

  const rows: RoundFixtureLite[] = useMemo(() => (
    tab === 'next'
      ? next?.fixtures ?? []
      : fixtures.map((f) => ({
          id: f.id, homeTeamId: f.homeTeamId, awayTeamId: f.awayTeamId,
          kickoff: f.kickoff, status: fixtureStatus(f.id),
        }))
  ), [tab, next, fixtures]);

  const shown = tab === 'this' && mine
    ? rows.filter((f) => picks[f.homeTeamId]?.length || picks[f.awayTeamId]?.length)
    : rows;

  const days = useMemo(() => {
    const m = new Map<string, RoundFixtureLite[]>();
    for (const f of [...shown].sort((a, b) => a.kickoff.localeCompare(b.kickoff))) {
      const k = dayKey(f.kickoff);
      m.set(k, [...(m.get(k) ?? []), f]);
    }
    return [...m.values()];
  }, [shown]);

  return (
    <div className={compact ? '' : 'px-4'}>
      {/* לשוניות: המחזור הזה / הבא */}
      <div className="flex items-center gap-1.5">
        <Seg active={tab === 'this'} onClick={() => setTab('this')}>{t('round.thisRound', { n: roundNumber })}</Seg>
        {/* ★ כשל זמני לא מעלים את הלשונית לתמיד */}
        {(next || nextSt.status === 'error') && (
          <Seg active={tab === 'next'} onClick={() => setTab('next')}>
            {next ? t('round.nextTab', { n: next.number }) : t('round.next')}
          </Seg>
        )}
        {tab === 'this' && (
          <button
            type="button"
            onClick={() => setMine((v) => !v)}
            aria-pressed={mine}
            className={`tap ms-auto rounded-full px-2.5 py-1 text-[11px] font-black ${
              mine ? 'bg-gold text-gold-ink' : 'bg-night-3 text-chalk-2'}`}
          >
            {t('round.myPlayers')} <span className="num" dir="ltr">{myCount}</span>
          </button>
        )}
      </div>

      <p className="mt-2 text-[12px] text-chalk-dim">
        {tab === 'next' && next
          ? <>{t('round.previewNote')}{next.lockAt ? <> · {t('round.nextLocks', { when: deadlineLabel(next.lockAt) })}</> : null}</>
          : tzLabel()}
      </p>
      {tab === 'next' && nextSt.status === 'error' && (
        <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-amber-300" role="status">
          {nextSt.cached && nextSt.cachedAt
            ? t('round.nextStale', { t: timeOnly(new Date(nextSt.cachedAt).toISOString()) })
            : t('round.nextError')}
          <RetryButton code={roundCode} st={nextSt} />
        </p>
      )}

      {days.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-chalk-dim">
          {tab === 'this' && mine ? t('round.noMine')
            : tab === 'next' && nextSt.status === 'loading' ? t('round.nextLoading')
            : tab === 'next' && nextSt.status === 'empty' ? t('round.nextTba')
            : tab === 'next' && nextSt.status === 'error' && !next ? ''
            : tab === 'next' && next ? t('round.fixturesTba')
            : t('round.noFixtures')}
        </p>
      ) : (
        <div className="mt-1">
          {days.map((list) => (
            <section key={list[0].id} className="mt-2.5">
              <h3 className="border-b border-gold/20 pb-1 text-[11.5px] font-black uppercase tracking-[0.1em] text-gold/80">
                {dayHeading(list[0].kickoff)}
              </h3>
              <ul>
                {list.map((f) => (
                  <FixtureRow key={f.id} f={f} picks={tab === 'this' ? picks : {}} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Seg({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`tap rounded-full px-3 py-1 font-press text-[12.5px] font-black ${
        active ? 'bg-chalk text-night' : 'bg-night-3 text-chalk-2'}`}
    >
      {children}
    </button>
  );
}

function FixtureRow({ f, picks }: { f: RoundFixtureLite; picks: PicksByTeam }) {
  const { t } = useI18n();
  const home = TEAM_BY_ID.get(f.homeTeamId);
  const away = TEAM_BY_ID.get(f.awayTeamId);
  const mineHome = picks[f.homeTeamId] ?? [];
  const mineAway = picks[f.awayTeamId] ?? [];
  const status =
    f.status === 'postponed' || f.status === 'abandoned' ? t('round.postponed')
    : f.status === 'live' ? t('round.live')
    : f.status === 'finished' ? t('round.ft')
    : null;

  return (
    <li className="border-b border-white/5 py-2">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <Side teamId={f.homeTeamId} name={home?.nameHe ?? f.homeTeamId} short={home?.short} picks={mineHome} align="end" />
        <span className="flex min-w-[3.25rem] flex-col items-center">
          <span className={`num text-[13px] font-black ${status === t('round.postponed') ? 'text-chalk-dim line-through' : 'text-gold'}`} dir="ltr">
            {timeOnly(f.kickoff)}
          </span>
          {status && (
            <span className={`text-[10.5px] font-black ${f.status === 'live' ? 'text-flare' : 'text-chalk-dim'}`}>{status}</span>
          )}
        </span>
        <Side teamId={f.awayTeamId} name={away?.nameHe ?? f.awayTeamId} short={away?.short} picks={mineAway} align="start" />
      </div>
    </li>
  );
}

function Side({
  teamId, name, short, picks, align,
}: { teamId: string; name: string; short?: string; picks: string[]; align: 'start' | 'end' }) {
  return (
    <span className={`flex min-w-0 items-center gap-1.5 ${align === 'end' ? 'flex-row-reverse text-end' : ''}`}>
      <TeamCrest teamId={teamId} short={short} size={24} className="shrink-0" />
      <span className="min-w-0">
        {/* ★ H03: שם ארוך נשבר לשתי שורות במקום להיחתך (hover לא קיים בנייד) */}
        <bdi className="line-clamp-2 break-words text-[13px] font-bold leading-tight text-chalk" title={name}>{name}</bdi>
        {picks.length > 0 && (
          <bdi className="block truncate text-[11.5px] font-black text-gold-light" title={picks.join(', ')}>● {picks.join(', ')}</bdi>
        )}
      </span>
    </span>
  );
}

/* ================================================================== */
/* הגיליון (נייד)                                                      */
/* ================================================================== */

export function FixturesSheet({
  onClose, ...board
}: Parameters<typeof FixturesBoard>[0] & { onClose: () => void }) {
  const { t } = useI18n();
  const ref = useDialog<HTMLDivElement>(onClose);

  return (
    <div className="fixed inset-0 z-sheet flex items-end bg-night/70 backdrop-blur-sm" onClick={onClose} role="presentation">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={t('round.fixtures')}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[80dvh] w-full overflow-y-auto overscroll-contain rounded-t-3xl bg-night-2
                   pb-[calc(1rem+env(safe-area-inset-bottom))] motion-safe:animate-slideUp
                   lg:mx-auto lg:mb-8 lg:max-w-lg lg:rounded-3xl"
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-chalk/25" />
        <div className="flex items-center justify-between px-4 pb-2 pt-3">
          <h2 className="font-press text-base font-black">{t('round.fixtures')}</h2>
          <button type="button" onClick={onClose} className="tap rounded-full px-3 py-1 text-[12px] font-bold text-chalk-dim">
            {t('round.close')}
          </button>
        </div>
        <FixturesBoard {...board} />
      </div>
    </div>
  );
}
