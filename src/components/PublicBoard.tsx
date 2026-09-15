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
import { useEffect, useState } from 'react';

import {
  publicBoard, gameweekRecap, errorMessageHe,
  type PublicBoard as Board, type BoardFixture, type TableRow, type Recap,
} from '../lib/store.ts';
import { Table, type Column } from './Table.tsx';
import { TeamCrest } from './TeamCrest.tsx';
import { NIGHT_PRESS as NP } from '../lib/pressPalette.ts';

/* ------------------------------------------------------------------ */

function kickoffLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('he-IL', {
    weekday: 'short', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

const STATUS_HE: Record<BoardFixture['status'], string> = {
  scheduled: '', live: 'חי', finished: 'הסתיים',
  postponed: 'נדחה', abandoned: 'הופסק',
};

/* ------------------------------------------------------------------ */
/* המחזור                                                              */
/* ------------------------------------------------------------------ */

function Fixture({ f }: { f: BoardFixture }) {
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
        <TeamCrest teamId={f.home} short={f.homeNameHe} size={20} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-chalk">
          <bdi>{f.homeNameHe}</bdi>
        </span>
      </div>

      <div className="shrink-0 text-center">
        {hasScore ? (
          <span className={`num text-[15px] font-black ${live ? 'text-flare' : 'text-chalk'}`}>
            {f.homeGoals}<span className="mx-1 opacity-40">:</span>{f.awayGoals}
          </span>
        ) : (
          <span className="num text-[11px] text-chalk-dim">{kickoffLabel(f.kickoff)}</span>
        )}
        {(live || done || off) && (
          <span className={`block text-[9.5px] font-black ${
            live ? 'text-flare' : off ? 'text-armband' : 'text-chalk-dim'}`}>
            {live && <span className="me-1 inline-block size-1.5 animate-pulse rounded-full bg-flare" />}
            {STATUS_HE[f.status]}
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
        <span className="min-w-0 flex-1 truncate text-end text-[12.5px] font-bold text-chalk">
          <bdi>{f.awayNameHe}</bdi>
        </span>
        <TeamCrest teamId={f.away} short={f.awayNameHe} size={20} />
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* הסיכום האישי                                                        */
/* ------------------------------------------------------------------ */

function RecapCard({ recap }: { recap: Recap }) {
  /* ★ מי שלא הגיש מקבל תוכן, לא ריק. */
  if (!recap.hasEntry) {
    if (!recap.top) return null;
    return (
      <section className="rounded-2xl border border-gold/15 bg-night-2 p-4">
        <h3 className="text-sm font-black text-chalk">המחזור הזה</h3>
        <p className="mt-1.5 text-[12.5px] leading-snug text-chalk-2">
          <span className="num font-black text-gold">{recap.entries}</span> מאמנים הגישו.
          המוביל: <b className="text-chalk">{recap.top.name}</b> עם{' '}
          <span className="num font-black text-gold">{recap.top.points}</span> נקודות.
        </p>
        <p className="mt-1 text-[11.5px] text-chalk-dim">
          לא הגשת הפעם — המחזור הבא ייפתח מעצמו, ואפשר להיכנס מראש.
        </p>
      </section>
    );
  }

  const cells: Array<[string, string, string | null]> = [
    ['הניקוד שלך', String(recap.points ?? 0), null],
    ['מקום', recap.rank ? `#${recap.rank}` : '—', `מתוך ${recap.entries}`],
    ['ניצחת', recap.beatPercent !== null && recap.beatPercent !== undefined
      ? `${recap.beatPercent}%` : '—', 'מהמשתתפים'],
  ];

  const picks: Array<[string, Recap['best']]> = [
    ['הבחירה של המחזור', recap.best],
    ['הקפטן', recap.captain],
    ['שלא הצדיקה', recap.worst],
  ];

  return (
    <section
      className="rounded-2xl border p-4"
      style={{ borderColor: NP.rule, background: NP.paper }}
    >
      <h3 className="font-press text-base font-black" style={{ color: NP.ink }}>
        הסיכום שלך
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

export function PublicBoard() {
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
    return <p className="py-10 text-center text-sm text-chalk-dim">טוען…</p>;
  }

  const columns: Column<TableRow>[] = [
    {
      key: 'pos', header: '#', width: '2.2rem', numeric: true, primary: true,
      render: (_r, i) => <span className="num text-chalk-dim">{i + 1}</span>,
    },
    {
      key: 'team', header: 'קבוצה', primary: true,
      render: (r) => (
        <span className="flex items-center gap-1.5">
          <TeamCrest teamId={r.team} short={r.short} size={18} />
          <bdi className="truncate font-bold text-chalk">{r.nameHe}</bdi>
        </span>
      ),
    },
    { key: 'played', header: 'מש׳', numeric: true, primary: true, width: '2.6rem',
      render: (r) => <span className="num text-chalk-2">{r.played}</span> },
    { key: 'won', header: 'נצ׳', numeric: true, primary: false, width: '2.4rem',
      render: (r) => <span className="num text-chalk-2">{r.won}</span> },
    { key: 'drawn', header: 'תק׳', numeric: true, primary: false, width: '2.4rem',
      render: (r) => <span className="num text-chalk-2">{r.drawn}</span> },
    { key: 'lost', header: 'הפ׳', numeric: true, primary: false, width: '2.4rem',
      render: (r) => <span className="num text-chalk-2">{r.lost}</span> },
    { key: 'diff', header: 'הפרש', numeric: true, primary: false, width: '3.2rem',
      render: (r) => (
        <span className="num text-chalk-2">
          {r.goalDiff > 0 ? `+${r.goalDiff}` : r.goalDiff}
        </span>
      ) },
    { key: 'points', header: 'נק׳', numeric: true, primary: true, width: '2.8rem',
      render: (r) => <span className="num font-black text-gold">{r.points}</span> },
  ];

  const gw = board.gameweek;

  return (
    <div className="space-y-3">
      {recap && <RecapCard recap={recap} />}

      {gw && (
        <section>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h3 className="font-press text-base font-black text-chalk">
              {gw.label ?? `מחזור ${gw.number}`}
            </h3>
            {gw.live && (
              <span className="flex items-center gap-1 text-[11px] font-black text-flare">
                <span className="inline-block size-1.5 animate-pulse rounded-full bg-flare" />
                מחזור חי
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

      <section>
        <h3 className="mb-2 font-press text-base font-black text-chalk">טבלת הליגה</h3>
        <Table
          columns={columns}
          rows={board.table}
          rowKey={(r) => r.team}
          empty="הטבלה תתמלא אחרי המשחקים הראשונים."
        />
      </section>
    </div>
  );
}
