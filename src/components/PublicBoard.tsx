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
import { Fragment, useEffect, useState, type ReactNode } from 'react';

import {
  publicBoard, gameweekRecap, errorMessageHe,
  type PublicBoard as Board, type BoardFixture, type Recap,
} from '../lib/store.ts';
import { Leaderboard } from './Leaderboard.tsx';
import type { RuleSet } from '../lib/scoring/rules.ts';
import { TeamCrest } from './TeamCrest.tsx';
import { NIGHT_PRESS as NP } from '../lib/pressPalette.ts';
import { useI18n } from '../lib/i18n/index.tsx';
import { LOCALE_META, type Locale } from '../lib/i18n/locales.ts';
import { TEAM_BY_ID } from '../data/squads.ts';
import type { DictKey } from '../lib/i18n/dict.ts';

/** ממלא {placeholders} בצמתי React — כדי לשמור על עיצוב חלקי משפט. */
function fill(text: string, parts: Record<string, ReactNode>): ReactNode[] {
  return text.split(/(\{\w+\})/).map((seg, i) => {
    const m = /^\{(\w+)\}$/.exec(seg);
    return m && m[1] in parts ? <Fragment key={i}>{parts[m[1]]}</Fragment> : seg;
  });
}

/* ------------------------------------------------------------------ */

function kickoffLabel(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(LOCALE_META[locale].intl, {
    weekday: 'short', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
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
  const homeName = TEAM_BY_ID.get(f.home)?.nameHe ?? f.homeNameHe;
  const awayName = TEAM_BY_ID.get(f.away)?.nameHe ?? f.awayNameHe;
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
  const { t } = useI18n();
  /* ★ מי שלא הגיש מקבל תוכן, לא ריק. */
  if (!recap.hasEntry) {
    if (!recap.top) return null;
    return (
      <section className="rounded-2xl border border-gold/15 bg-night-2 p-4">
        <h3 className="text-sm font-black text-chalk">{t('board.pb.thisRound')}</h3>
        <p className="mt-1.5 text-[12.5px] leading-snug text-chalk-2">
          {fill(t('board.pb.recapLine', { n: '{n}', name: '{name}', pts: '{pts}' }), {
            n: <span className="num font-black text-gold">{recap.entries}</span>,
            name: <b className="text-chalk">{recap.top.name}</b>,
            pts: <span className="num font-black text-gold">{recap.top.points}</span>,
          })}
        </p>
        <p className="mt-1 text-[11.5px] text-chalk-dim">
          {t('board.pb.notSubmitted')}
        </p>
      </section>
    );
  }

  const cells: Array<[string, string, string | null]> = [
    [t('board.pb.yourScore'), String(recap.points ?? 0), null],
    [t('lobby.rank'), recap.rank ? `#${recap.rank}` : '—', t('board.pb.outOf', { n: recap.entries })],
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
              <bdi>{pick.nameHe ?? pick.player}</bdi>
            </span>
            <span className="num shrink-0 font-black text-gold">{pick.points}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* המסך                                                                */
/* ------------------------------------------------------------------ */

export function PublicBoard({ rulesByMode, userId }: {
  rulesByMode: Record<'full' | 'five', RuleSet>;
  userId?: string;
}) {
  const { t } = useI18n();
  const [board, setBoard] = useState<Board | null>(null);
  const [recap, setRecap] = useState<Recap | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    const load = () => {
      void publicBoard()
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
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 60_000);
    return () => { alive = false; clearInterval(id); };
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

  return (
    <div className="space-y-3">
      {recap && <RecapCard recap={recap} />}

      {/* ★ הטבלה כאן היא טבלת המתמודדים בתחרות שלנו — לא טבלת ליגת העל. */}
      <section className="-mx-4">
        <Leaderboard rulesByMode={rulesByMode} userId={userId} />
      </section>
      {gw && (
        <section>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h3 className="font-press text-base font-black text-chalk">
              {t('board.pb.results')} · {gw.label ?? `${t('common.round')} ${gw.number}`}
            </h3>
            {gw.live && (
              <span className="flex items-center gap-1 text-[11px] font-black text-flare">
                <span className="inline-block size-1.5 animate-pulse rounded-full bg-flare" />
                {t('board.pb.liveRound')}
              </span>
            )}
          </div>
          <ul className="space-y-1.5">
            {board.fixtures.map((f) => (
              <Fixture key={`${f.home}-${f.away}`} f={f} />
            ))}
          </ul>
        </section>
      )}

    </div>
  );
}
