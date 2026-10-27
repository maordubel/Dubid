/**
 * components/PublicBoard.tsx — «מה קורה בליגה».
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ למי המסך הזה נכתב
 * ═══════════════════════════════════════════════════════════════
 *
 * למי ש**לא** הגיש. עד היום הוא פתח את האפליקציה ומצא מסך שאומר
 * לו, בעקיפין, שאין לו מה לעשות כאן — וזה בדיוק האדם שהכי כדאי
 * להחזיר בשבוע הבא.
 *
 * לכן הכל כאן פתוח: לוח המחזור עם תוצאות חיות, טבלת הליגה
 * האמיתית, ומי מוביל בתחרות. בלי הרשמה, בלי הגשה.
 *
 * ★ ולמי שכן הגיש — אותו מסך נפתח בסיכום האישי: כמה, איפה, מי
 *   הייתה הבחירה הטובה, מי הגרועה, ומה עשה הקפטן. הברִיף אוסר
 *   להציג ציון סופי בלבד.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ שתי החלטות עיצוב
 * ═══════════════════════════════════════════════════════════════
 *
 * **המשחק החי הוא היחיד עם צבע.** כשהכל מודגש, שום דבר לא
 * מודגש. משחק שרץ מקבל נקודה פועמת ופס אדום; כל השאר שקט.
 *
 * **הטבלה היא כרטיסים בנייד וטבלה בדסקטופ** — אותו `Table.tsx`
 * ששאר המוצר משתמש בו. גלילה אופקית בטבלת ליגה בנייד היא הדרך
 * להבטיח שאיש לא יראה את עמודת הנקודות.
 */
import { onRevision } from '../lib/revisionBus.ts';
import { Fragment, useEffect, useState, type ReactNode } from 'react';

import {
  publicBoard, gameweekRecap, errorMessageHe,
  type PublicBoard as Board, type BoardFixture, type Recap,
} from '../lib/store.ts';
import { Leaderboard } from './Leaderboard.tsx';
import type { RuleSet } from '../lib/scoring/rules.ts';
import { TeamCrest } from './TeamCrest.tsx';
import { NIGHT_PRESS as NP, MISREGISTER } from '../lib/pressPalette.ts';
import { useI18n } from '../lib/i18n/index.tsx';
import { leagueTimezone } from '../lib/leagueTz.ts';
import { LOCALE_META, type Locale } from '../lib/i18n/locales.ts';
import { TEAM_BY_ID, PLAYERS } from '../data/squads.ts';
import { GAMEWEEK } from '../data/fixtures.ts';
import type { DictKey } from '../lib/i18n/dict.ts';
import { displayName } from '../lib/i18n/names.ts';
import { leagueName, selectedLeague } from '../lib/league.ts';
import { useLeagues } from './LeagueGate.tsx';
import { LeagueFlag, leagueAccent } from './LeagueIdentity.tsx';
import type { I18nNames, LeagueStandings, StandingsRow } from '../lib/store.ts';

/** ממלא {placeholders} בצמתי React — כדי לשמור על עיצוב חלקי משפט. */
function fill(text: string, parts: Record<string, ReactNode>): ReactNode[] {
  return text.split(/(\{\w+\})/).map((seg, i) => {
    const m = /^\{(\w+)\}$/.exec(seg);
    return m && m[1] in parts ? <Fragment key={i}>{parts[m[1]]}</Fragment> : seg;
  });
}

/* ------------------------------------------------------------------ */

/** שם קבוצה בשפת המשתמש: הסגל החי → השמות מהשרת → עברית. */
function teamLabel(code: string, names: I18nNames | undefined, he: string | undefined, locale: Locale): string {
  const tm = TEAM_BY_ID.get(code);
  if (tm) return displayName({ he: tm.nameHe, en: tm.nameEn, el: tm.nameEl }, locale);
  return displayName({ he: names?.he ?? he, en: names?.en, el: names?.el }, locale) || code;
}

let playerIndex: Map<string, (typeof PLAYERS)[number]> | null = null;
function playerLabel(code: string, he: string | null, locale: Locale): string {
  if (!playerIndex || playerIndex.size !== PLAYERS.length) {
    playerIndex = new Map(PLAYERS.map((p) => [p.id, p]));
  }
  const p = playerIndex.get(code);
  if (p) return displayName({ he: p.nameHe, en: p.nameEn, el: p.nameEl }, locale);
  return he ?? code;
}

function kickoffLabel(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(LOCALE_META[locale].intl, {
    weekday: 'short', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', timeZone: leagueTimezone(),
  });
}

const STATUS_KEY: Record<BoardFixture['status'], DictKey | null> = {
  scheduled: null, live: 'board.pb.live', finished: 'board.pb.finished',
  postponed: 'board.pb.postponed', abandoned: 'board.pb.abandoned',
};

/* ------------------------------------------------------------------ */
/* המחזור                                                              */
/* ------------------------------------------------------------------ */

function Fixture({ f }: { f: BoardFixture }) {
  const { t, locale } = useI18n();
  const homeName = teamLabel(f.home, f.homeNames, f.homeNameHe, locale);
  const awayName = teamLabel(f.away, f.awayNames, f.awayNameHe, locale);
  const live = f.status === 'live';
  const done = f.status === 'finished';
  const off = f.status === 'postponed' || f.status === 'abandoned';
  const hasScore = f.homeGoals !== null && f.awayGoals !== null;

  return (
    <li
      className={`relative flex items-center gap-2 overflow-hidden rounded-xl border px-3 py-2.5
                  ${live ? 'border-flare/45 bg-flare/[0.06]' : 'border-gold/12 bg-night-2'}`}
    >
      {/* ★ הפס האדום הוא הסימן היחיד שצריך מרחוק: המשחק הזה רץ עכשיו. */}
      {live && <span className="absolute inset-y-0 start-0 w-[3px] bg-flare" />}

      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <TeamCrest teamId={f.home} short={homeName} size={20} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-chalk">
          <bdi>{homeName}</bdi>
        </span>
      </div>

      <div className="shrink-0 text-center">
        {hasScore ? (
          /* ★ flex + dir=rtl על עטיפה **בלי** `.num` (שמכריח ltr) — `.num` רק על הספרות עצמן. flex ולא טקסט רץ: `1:0` כטקסט נפתר ע״י האלגוריתם הדו-כיווני
             כרצף ספרות שמוצג שמאל→ימין, והשער של הקבוצה הביתית (בצד ימין)
             הופיע בצד שמאל — כלומר התוצאה הפוכה. בפלקס הסדר נקבע לפי הכיוון. */
          <span dir="rtl"
                className={`inline-flex items-center gap-1 text-[15px] font-black ${live ? 'text-flare' : 'text-chalk'}`}>
            <span className="num">{f.homeGoals}</span><span className="opacity-40">:</span><span className="num">{f.awayGoals}</span>
          </span>
        ) : (
          <span className="num text-[11px] text-chalk-dim">{kickoffLabel(f.kickoff, locale)}</span>
        )}
        {(live || done || off) && (
          <span className={`block text-[9.5px] font-black ${
            live ? 'text-flare' : off ? 'text-armband' : 'text-chalk-dim'}`}>
            {live && <span className="me-1 inline-block size-1.5 animate-pulse rounded-full bg-flare" />}
            {STATUS_KEY[f.status] ? t(STATUS_KEY[f.status]!) : ''}
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
        <span className="min-w-0 flex-1 truncate text-end text-[12.5px] font-bold text-chalk">
          <bdi>{awayName}</bdi>
        </span>
        <TeamCrest teamId={f.away} short={awayName} size={20} />
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* הסיכום האישי                                                        */
/* ------------------------------------------------------------------ */

function RecapCard({ recap }: { recap: Recap }) {
  const { t, locale } = useI18n();
  /* ★ מי שלא הגיש מקבל תוכן, לא ריק. */
  if (!recap.hasEntry) {
    if (!recap.top) return null;
    return (
      <section className="rounded-2xl border border-gold/15 bg-night-2 p-4">
        <h3 className="text-sm font-black text-chalk">{t('board.pb.thisRound')}</h3>
        <p className="mt-1.5 text-[12.5px] leading-snug text-chalk-2">
          {fill(t('board.pb.recapLine', { n: '{n}', name: '{name}', pts: '{pts}' }), {
            n: <span className="num font-black text-gold">{recap.entries}</span>,
            name: <b className="text-chalk">{recap.top.name ?? t('board.pb.anon')}</b>,
            pts: <span className="num font-black text-gold">{recap.top.points}</span>,
          })}
        </p>
        <p className="mt-1 text-[11.5px] text-chalk-dim">
          {t('board.pb.notSubmitted')}
        </p>
      </section>
    );
  }

  /* ★ מספר חסר הוא '—', לא 0: אפס נראה כמו כישלון שלא קרה. */
  const move = recap.rank && recap.prevRank ? recap.prevRank - recap.rank : null;
  const modeName = recap.mode ? t(recap.mode === 'full' ? 'mode.full.title' : 'mode.five.title') : null;
  const cells: Array<[string, string, string | null]> = [
    [t('board.pb.yourScore'), recap.points !== null && recap.points !== undefined ? String(recap.points) : '—', modeName],
    [t('lobby.rank'), recap.rank ? `#${recap.rank}` : '—',
     move === null || move === 0 ? t('board.pb.outOf', { n: recap.entries })
       : move > 0 ? `▲ ${move} · ${t('board.pb.outOf', { n: recap.entries })}`
       : `▼ ${-move} · ${t('board.pb.outOf', { n: recap.entries })}`],
    [t('board.pb.youBeat'), recap.beatPercent !== null && recap.beatPercent !== undefined
      ? `${recap.beatPercent}%` : '—', t('board.pb.ofPlayers')],
  ];

  const picks: Array<[string, Recap['best']]> = [
    [t('board.pb.bestPick'), recap.best],
    [t('board.pb.captain'), recap.captain],
    [t('board.pb.worstPick'), recap.worst],
  ];

  return (
    <section
      className="rounded-2xl border p-4"
      style={{ borderColor: NP.rule, background: NP.paper }}
    >
      <h3 className="font-press text-base font-black" style={{ color: NP.ink }}>
        {t('board.pb.yourRecap')}
      </h3>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {cells.map(([label, value, sub]) => (
          <div key={label} className="rounded-xl bg-night/40 px-2 py-2 text-center">
            <div className="num text-[19px] font-black leading-none text-gold">{value}</div>
            <div className="mt-1 text-[10px] font-black text-chalk-2">{label}</div>
            {sub && <div className="text-[9.5px] text-chalk-dim">{sub}</div>}
          </div>
        ))}
      </div>

      <ul className="mt-3 space-y-1">
        {picks.map(([label, pick]) => pick && (
          <li key={label} className="flex items-baseline justify-between gap-2 text-[12px]">
            <span className="text-chalk-dim">{label}</span>
            <span className="min-w-0 flex-1 truncate text-end font-bold text-chalk">
              <bdi>{playerLabel(pick.player, pick.nameHe, locale)}</bdi>
            </span>
            <span className="num shrink-0 font-black text-gold">{pick.points}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* טבלת הליגה הרשמית                                                    */
/* ------------------------------------------------------------------ */

/**
 * ★ טבלה אמיתית גם בנייד: 5 עמודות שנכנסות ב-360px (מיקום, קבוצה, משחקים,
 *   הפרש, נקודות). נ-ת-ה מופיע מ-sm. אין גלילה אופקית ואין כרטיסים —
 *   טבלת ליגה נקראת בעמודות, וזו כל הסיבה שהיא טבלה.
 */
function Standings({ st, accent }: { st: LeagueStandings; accent: string }) {
  const { t, locale } = useI18n();
  if (st.rows.length === 0) {
    return (
      <p className="rounded-2xl border border-gold/12 bg-night-2 px-4 py-8 text-center text-[13px] text-chalk-dim">
        {t('board.st.none')}
      </p>
    );
  }
  const updated = st.updatedAt
    ? new Date(st.updatedAt).toLocaleString(LOCALE_META[locale].intl, {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: leagueTimezone(),
      })
    : null;
  const n = st.rows.length;

  return (
    <section aria-label={t('board.st.caption')}>
      <table className="w-full table-fixed border-collapse text-[12.5px]">
        <caption className="sr-only">{t('board.st.caption')}</caption>
        <thead>
          <tr className="border-b text-[10.5px] font-black uppercase tracking-wide text-chalk-dim"
              style={{ borderColor: NP.rule }}>
            <th scope="col" className="w-7 py-2 text-center">{t('board.st.pos')}</th>
            <th scope="col" className="py-2 text-start">{t('board.st.team')}</th>
            <th scope="col" className="w-8 py-2 text-center">{t('board.st.played')}</th>
            <th scope="col" className="hidden w-16 py-2 text-center sm:table-cell">{t('board.st.wdl')}</th>
            <th scope="col" className="w-10 py-2 text-center">{t('board.st.gd')}</th>
            <th scope="col" className="w-10 py-2 text-center">{t('board.st.pts')}</th>
          </tr>
        </thead>
        <tbody>
          {st.rows.map((r: StandingsRow) => {
            const name = teamLabel(r.team, r.names, r.names?.he ?? undefined, locale);
            /* ★ קווי מקום: פסגה ותחתית — בלי לנחש מקומות אירופה/ירידה, שמשתנים לפי ליגה. */
            const top = r.position === 1;
            const bottom = r.position === n;
            return (
              <tr key={r.team} className="border-b" style={{ borderColor: 'rgba(216,178,92,.10)' }}>
                <td className="py-2 text-center">
                  <span className="num inline-grid h-5 min-w-5 place-items-center rounded-sm px-1 text-[11px] font-black"
                        style={top ? { background: accent, color: '#fff' }
                             : bottom ? { boxShadow: 'inset 0 0 0 1px rgba(196,52,47,.6)', color: '#E0574F' }
                             : { color: '#BFB49A' }}>
                    {r.position}
                  </span>
                </td>
                <td className="py-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <TeamCrest teamId={r.team} short={name} size={18} />
                    <span className="min-w-0 truncate font-bold text-chalk"><bdi>{name}</bdi></span>
                  </div>
                </td>
                <td className="num py-2 text-center text-chalk-2">{r.played}</td>
                <td className="num hidden py-2 text-center text-chalk-dim sm:table-cell">
                  {r.won}-{r.drawn}-{r.lost}
                </td>
                {/* ★ הסימן בגופן רגיל: ב-Anton ה-"+" דק עד שהוא נקרא כ-"−" — הפרש חיובי נראה שלילי. */}
                <td className={`py-2 text-center ${r.goalDiff < 0 ? 'text-flare/80' : 'text-chalk-2'}`}>
                  <span dir="ltr" className="inline-flex items-baseline">
                    {r.goalDiff !== 0 && <span className="font-sans font-bold">{r.goalDiff > 0 ? '+' : '−'}</span>}
                    <span className="num">{Math.abs(r.goalDiff)}</span>
                  </span>
                </td>
                <td className="num py-2 text-center text-[14px] font-black text-gold">{r.points}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {updated && (
        <p className="mt-2 text-[10.5px] text-chalk-dim">{t('board.st.updated', { t: updated })}</p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* המסך — מרכז הליגה                                                   */
/* ------------------------------------------------------------------ */

type Section = 'ranking' | 'results' | 'table';

/**
 * ★ שלושה מדורים, מדור אחד גלוי. הדירוג (התחרות שלנו) ראשון — בשבילו
 *   באים. התוצאות והטבלה הן העולם האמיתי של אותה ליגה, ורק שלה: המחזור
 *   נשלח בקוד שלו, כך שמשתמש ביוון לא רואה את ליגת העל.
 * ★ בזמן מחזור חי, "תוצאות" נפתח ראשון — זה מה שאדם בודק באמצע משחק.
 */
export function PublicBoard({ rulesByMode, userId }: {
  rulesByMode: Record<'full' | 'five', RuleSet>;
  userId?: string;
}) {
  const { t, locale } = useI18n();
  const leagues = useLeagues();
  const [board, setBoard] = useState<Board | null>(null);
  const [recap, setRecap] = useState<Recap | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [section, setSection] = useState<Section | null>(null);

  useEffect(() => {
    let alive = true;
    /* ★ הקוד של המחזור הנוכחי בליגה שנבחרה. ריק (לפני הטעינה החיה) → השרת
       מחזיר את הליגה הראשית, כמו קודם. */
    const code = GAMEWEEK.id && GAMEWEEK.id !== 'gw-4' ? GAMEWEEK.id : undefined;

    const load = () => {
      void publicBoard(code)
        .then(async (b) => {
          if (!alive) return;
          setBoard(b);
          setErr(null);
          if (b.gameweek?.code) {
            const r = await gameweekRecap(b.gameweek.code).catch(() => null);
            if (alive) setRecap(r);
          }
        })
        .catch((e: unknown) =>
          alive && setErr(errorMessageHe(e instanceof Error ? e.message : 'NETWORK')));
    };

    load();

    /* ★ רענון כל 60 שניות, ורק כשהטאב גלוי — אותו כלל של שאר
       המוצר. מסך פתוח בטאב אחורי במשך יום הוא בקשה על כלום. */
    /* ★ חיסכון: טעינה כשמשהו רלוונטי באמת השתנה (תוצאות, טבלה, מחזור) —
       דרך הערוץ המנותב, מרוסן — ורשת ביטחון של 5 דקות. קודם: כל 60 שניות,
       גם כשהמחזור פתוח ואין שום משחק. */
    const stopRev = onRevision(['weekly_matches', 'player_match_stats', 'league_standings', 'gameweeks'], load, 8000);
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 5 * 60_000);
    return () => { alive = false; clearInterval(id); stopRev(); };
  }, []);

  if (err) {
    return (
      <div role="alert" className="rounded-2xl border border-flare/40 bg-flare/10 px-4 py-4">
        <p className="text-sm font-black text-flare">{err}</p>
      </div>
    );
  }
  if (!board) {
    return <p className="py-10 text-center text-sm text-chalk-dim">{t('board.pb.loading')}</p>;
  }

  const gw = board.gameweek;
  const code = board.league ?? selectedLeague() ?? leagues.find((l) => l.primary)?.code ?? '';
  const league = leagues.find((l) => l.code === code);
  const accent = leagueAccent(code);
  const active: Section = section ?? (gw?.live ? 'results' : 'ranking');
  const uncounted = board.fixtures.filter((f) => f.status === 'postponed' || f.status === 'abandoned').length;
  const standings: LeagueStandings = board.standings ?? { league: code, source: null, updatedAt: null, rows: [] };

  const tabs: Array<[Section, DictKey]> = [
    ['ranking', 'board.hub.ranking'],
    ['results', 'board.hub.results'],
    ['table', 'board.hub.table'],
  ];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3 px-3 pb-6 pt-3">
      {/* ── מאסטהד הליגה: דגל, שם, מחזור, חי ── */}
      <header className="relative overflow-hidden rounded-2xl border px-3 py-3"
              style={{ borderColor: NP.rule, background: `linear-gradient(110deg, #100D0A 55%, ${accent}26)` }}>
        <span aria-hidden="true" className="absolute inset-y-0 start-0 w-[3px]" style={{ background: accent }} />
        <div className="flex items-center gap-3">
          <span className="h-[26px] w-[39px] shrink-0 overflow-hidden rounded-[4px] ring-1 ring-white/30">
            <LeagueFlag country={code} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-press text-[19px] font-black leading-tight text-chalk"
                style={{ textShadow: MISREGISTER }}>
              {league ? leagueName(league, locale) : ''}
            </h2>
            {gw && (
              <p className="text-[11.5px] font-bold text-chalk-2">
                {t('board.hub.round', { n: gw.number })}
                {gw.entries > 0 && <span className="text-chalk-dim"> · {t('gate.lineups', { n: gw.entries })}</span>}
              </p>
            )}
          </div>
          {gw?.live && (
            <span className="flex shrink-0 items-center gap-1 text-[11px] font-black text-flare">
              <span className="inline-block size-1.5 animate-pulse rounded-full bg-flare" />
              {t('board.pb.liveRound')}
            </span>
          )}
        </div>
      </header>

      {/* ── מדורים ── */}
      <div role="tablist" aria-label={t('board.hub.aria')}
           className="grid grid-cols-3 gap-1 rounded-xl border p-1" style={{ borderColor: NP.rule }}>
        {tabs.map(([id, label]) => {
          const on = id === active;
          return (
            <button key={id} type="button" role="tab" aria-selected={on}
                    onClick={() => setSection(id)}
                    className={`tap min-h-[44px] rounded-lg text-[13px] font-black transition-colors
                                ${on ? 'text-night' : 'text-chalk-2 hover:text-chalk'}`}
                    style={on ? { background: '#D8B25C' } : undefined}>
              {t(label)}
            </button>
          );
        })}
      </div>

      {active === 'ranking' && (
        <div role="tabpanel" className="space-y-3">
          {recap && <RecapCard recap={recap} />}
          {/* ★ הטבלה כאן היא טבלת המתמודדים בתחרות שלנו — לא טבלת הליגה. */}
          <section className="-mx-4">
            <Leaderboard rulesByMode={rulesByMode} userId={userId} />
          </section>
        </div>
      )}

      {active === 'results' && (
        <div role="tabpanel">
          {gw && board.fixtures.length > 0 ? (
            <>
              <ul className="space-y-1.5">
                {board.fixtures.map((f) => (
                  <Fixture key={`${f.home}-${f.away}`} f={f} />
                ))}
              </ul>
              {uncounted > 0 && (
                <p className="mt-2 text-[11.5px] text-armband">{t('board.hub.uncounted', { n: uncounted })}</p>
              )}
            </>
          ) : (
            <p className="rounded-2xl border border-gold/12 bg-night-2 px-4 py-8 text-center text-[13px] text-chalk-dim">
              {t('board.hub.noFixtures')}
            </p>
          )}
        </div>
      )}

      {active === 'table' && (
        <div role="tabpanel">
          <Standings st={standings} accent={accent} />
        </div>
      )}
    </div>
  );
}
