/**
 * components/AdminIngest.tsx — מסך הקליטה.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ מה המסך הזה, ומה הוא לא
 * ═══════════════════════════════════════════════════════════════
 *
 * הוא **לא** מסך הפעלה. המערכת רצה לבד: cron מעיר אותה, היא
 * מושכת, ממפה, מנקדת ומפרסמת. אף כפתור כאן אינו חלק מהמסלול
 * הרגיל.
 *
 * הוא מסך **חריגות**. שלוש שאלות, לפי סדר החשיבות:
 *
 *   1. מה חוסם עכשיו?              → התרעות, באדום, למעלה
 *   2. מי לא מופה?                 → הרשימה היחידה שדורשת אדם
 *   3. האם זה בכלל עובד?           → דופק, ריצות, טביעות אצבע
 *
 * ★ הסדר הזה הוא ההחלטה העיצובית. מסך ניהול שמתחיל ב"הגדרות"
 *   מכריח לגלול בכל פעם שמשהו נשבר. הדבר שדורש טיפול יושב
 *   במקום שהעין נופלת עליו ראשונה, וההגדרות בתחתית — נוגעים
 *   בהן פעם בחיים.
 *
 * ★ נייד קודם: שורת מיפוי היא כרטיס, לא טור בטבלה. טבלה עם
 *   שבע עמודות ברוחב 390px היא גלילה אופקית, וגלילה אופקית
 *   בלוח ניהול פירושה שלא ילחצו על הכפתור הימני.
 */
import { useEffect, useState } from 'react';

import {
  ingestState, ingestUnmapped, ingestMapPlayer, ingestClearAlert,
  ingestSetConfig, ingestSetEndpoint, ingestNow,
  type IngestState, type UnmappedRow,
} from '../lib/store.ts';
import { Card, Note, useAction, input, primary, ghost } from './AdminConsole.tsx';
import { PLAYERS, TEAMS } from '../data/squads.ts';

/* ------------------------------------------------------------------ */
/* עזרים                                                               */
/* ------------------------------------------------------------------ */

const ALERT_HE: Record<string, string> = {
  unmapped_in_lineup: 'שחקן שנבחר בהרכב ואין לו נתונים',
  var: 'החלטת VAR — הספק לא אומר איזה שער בוטל',
  card_rescinded: 'כרטיס שבוטל',
  fixture_not_final: 'משחק שלא הסתיים (נדחה או נזנח)',
  changed_after_publish: 'הנתונים זזו אחרי הפרסום',
  source_disagreement: 'שני המקורות חולקים על התוצאה',
  source_down: 'מקור לא הגיב',
  unknown_event: 'אירוע שהמתאם לא מכיר',
};

const STATUS_HE: Record<string, string> = {
  draft: 'טיוטה', open: 'פתוח', locked: 'נעול', live: 'חי',
  scoring: 'בניקוד', published: 'פורסם', archived: 'ארכיון',
};

function when(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'עכשיו';
  if (mins < 60) return `לפני ${mins} דק׳`;
  if (mins < 60 * 24) return `לפני ${Math.round(mins / 60)} ש׳`;
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
}

/* ------------------------------------------------------------------ */
/* 1 · הדופק                                                           */
/* ------------------------------------------------------------------ */

function Pulse({ state }: { state: IngestState }) {
  const last = state.runs[0];
  const failing = last?.status === 'failed';
  const off = state.config?.enabled === false;

  /* ★ נקודה אחת שצובעת את כל השורה. אדום = משהו חוסם, ענבר =
     כבוי בכוונה, זהב = רץ. שלושה מצבים ולא חמישה: לוח שמראה
     חמישה גוונים לא נקרא במבט. */
  const tone = state.blockingCount > 0 || failing
    ? { dot: 'bg-flare', ring: 'border-flare/40 bg-flare/5' }
    : off
      ? { dot: 'bg-chalk-dim', ring: 'border-gold/15 bg-night-2' }
      : { dot: 'bg-gold', ring: 'border-gold/30 bg-gold/5' };

  return (
    <section className={`rounded-2xl border p-4 ${tone.ring}`}>
      <div className="flex items-center gap-2">
        <span className={`size-2.5 rounded-full ${tone.dot}`} />
        <h3 className="text-sm font-black text-chalk">
          {off ? 'הקליטה כבויה'
            : state.blockingCount > 0 ? `${state.blockingCount} חסימות`
            : failing ? 'הריצה האחרונה נכשלה'
            : 'הקליטה פעילה'}
        </h3>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[12px] sm:grid-cols-4">
        {([
          ['ריצה אחרונה', when(last?.startedAt ?? null)],
          ['מקור', last?.source ?? '—'],
          ['לא מופו', String(state.unmappedCount)],
          ['מחזור נוכחי', state.gameweeks.find((g) => g.isCurrent)?.code ?? '—'],
        ] as const).map(([k, v]) => (
          <div key={k}>
            <dt className="text-[10.5px] text-chalk-dim">{k}</dt>
            <dd className="num font-black text-chalk">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 2 · התרעות                                                          */
/* ------------------------------------------------------------------ */

function Alerts({ state, onChange }: { state: IngestState; onChange: () => void }) {
  const act = useAction();
  if (state.alerts.length === 0) return null;

  return (
    <Card
      title="דורש הכרעה"
      hint="כל עוד יש כאן חסימה אחת, המחזור לא יתפרסם לבד. זה מכוון."
    >
      <ul className="space-y-2">
        {state.alerts.map((a) => (
          <li
            key={a.id}
            className={`rounded-xl border px-3 py-2 ${
              a.severity === 'block'
                ? 'border-flare/40 bg-flare/5'
                : 'border-gold/20 bg-night'}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[12.5px] font-bold text-chalk">
                  {ALERT_HE[a.kind] ?? a.kind}
                </p>
                <p dir="ltr" className="mt-0.5 truncate text-[11px] text-chalk-dim">
                  {a.gw ? `${a.gw} · ` : ''}{JSON.stringify(a.detail)}
                </p>
              </div>
              <button
                disabled={act.busy}
                className={ghost}
                onClick={() => act.run(async () => {
                  await ingestClearAlert(a.id);
                  onChange();
                  return 'ההתרעה שוחררה';
                })}
              >
                שחרור
              </button>
            </div>
          </li>
        ))}
      </ul>
      <Note msg={act.msg} bad={act.bad} />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* 3 · מיפוי — המסך היחיד שדורש אדם                                    */
/* ------------------------------------------------------------------ */

/**
 * ★ למה יש כאן גם חיפוש חופשי וגם מועמדים
 *
 * המועמדים מגיעים מהשרת עם ציון דמיון, והם פותרים את הרוב.
 * אבל שחקן שעבר קבוצה באמצע העונה לא יופיע ביניהם לעולם —
 * כי החיפוש מוגבל לסגל של הקבוצה הנוכחית. בלי חיפוש חופשי,
 * המקרה הזה היה מגיע לקצה מסך ונתקע.
 */
function MapRow({ row, onDone }: { row: UnmappedRow; onDone: () => void }) {
  const act = useAction();
  const [q, setQ] = useState('');

  const hits = q.trim().length >= 2
    ? PLAYERS.filter((p) => p.nameHe.includes(q.trim())).slice(0, 6)
    : [];

  const teamExt = row.team;
  const teamName = teamExt
    ? TEAMS.find((t) => t.externalId === teamExt.replace(/^T/, ''))?.nameHe ?? teamExt
    : null;

  const pick = (extPlayer: string) => act.run(async () => {
    await ingestMapPlayer(row.source, row.externalId, extPlayer);
    onDone();
    return 'מופה';
  });

  return (
    <li className={`rounded-xl border px-3 py-2.5 ${
      row.blocking ? 'border-flare/40 bg-flare/5' : 'border-gold/20 bg-night'}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span dir="ltr" className="text-[13px] font-black text-chalk">
          {row.name ?? row.nameHe ?? row.externalId}
        </span>
        {row.shirt !== null && <span className="num text-[11px] text-gold">#{row.shirt}</span>}
        {teamName && <span className="text-[11px] text-chalk-dim">{teamName}</span>}
        {row.blocking && (
          <span className="rounded-full bg-flare/20 px-1.5 text-[10px] font-bold text-flare">
            חוסם פרסום
          </span>
        )}
      </div>

      {row.candidates.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {row.candidates.map((c) => (
            <button
              key={c.extPlayer}
              disabled={act.busy}
              onClick={() => pick(c.extPlayer)}
              className="tap rounded-full border border-gold/30 bg-gold/5 px-2.5 py-1
                         text-[11.5px] text-chalk disabled:opacity-40"
            >
              {c.nameHe}
              {c.shirt !== null && <span className="num text-gold"> #{c.shirt}</span>}
              <span className="num text-[10px] text-chalk-dim"> {Math.round(c.score * 100)}%</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <input
          value={q}
          disabled={act.busy}
          placeholder="חיפוש שחקן בשם עברי"
          onChange={(e) => setQ(e.target.value)}
          className={input}
        />
      </div>

      {hits.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {hits.map((p) => (
            <button
              key={p.externalId}
              disabled={act.busy}
              onClick={() => pick(p.externalId)}
              className="tap rounded-full border border-gold/20 px-2.5 py-1
                         text-[11.5px] text-chalk-2 disabled:opacity-40"
            >
              {p.nameHe}
            </button>
          ))}
        </div>
      )}

      <Note msg={act.msg} bad={act.bad} />
    </li>
  );
}

function Mapping({ rows, onChange }: { rows: UnmappedRow[]; onChange: () => void }) {
  if (rows.length === 0) {
    return (
      <Card title="מיפוי שחקנים" hint="הרשימה ריקה — כל מי שהספק שלח מזוהה.">
        <p className="text-[12.5px] text-chalk-2">אין מה לעשות כאן. ✓</p>
      </Card>
    );
  }

  return (
    <Card
      title={`מיפוי שחקנים · ${rows.length}`}
      hint="המערכת ממפה לפי מספר חולצה ושם. מה שנשאר כאן היא סירבה לנחש —
            מיפוי שגוי נותן נקודות לשחקן הלא נכון, ואף אחד לא מבחין."
    >
      <ul className="space-y-2">
        {rows.map((r) => <MapRow key={r.id} row={r} onDone={onChange} />)}
      </ul>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* 4 · מחזורים                                                          */
/* ------------------------------------------------------------------ */

function Gameweeks({ state }: { state: IngestState }) {
  return (
    <Card
      title="מחזורים"
      hint="«יציב מאז» הוא מה שקובע פרסום: נתונים שלא זזו מספיק זמן."
    >
      <ul className="space-y-1.5">
        {state.gameweeks.map((g) => (
          <li
            key={g.code}
            className="flex items-center justify-between gap-2 rounded-lg border
                       border-gold/15 bg-night px-2.5 py-2"
          >
            <div className="min-w-0">
              <p className="text-[12.5px] font-bold text-chalk">
                {g.code}
                {g.isCurrent && <span className="mr-1.5 text-[10px] text-gold">נוכחי</span>}
                {g.movedAfterPublish && (
                  <span className="mr-1.5 text-[10px] text-flare">זז אחרי פרסום</span>
                )}
              </p>
              <p className="text-[11px] text-chalk-dim">
                {STATUS_HE[g.status] ?? g.status} ·{' '}
                <span className="num">{g.final}/{g.fixtures}</span> הסתיימו
              </p>
            </div>
            <span className="num shrink-0 text-[11px] text-chalk-dim">
              {when(g.stableSince)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* 5 · ריצות                                                            */
/* ------------------------------------------------------------------ */

function Runs({ state }: { state: IngestState }) {
  return (
    <Card title="ריצות אחרונות" hint="עשרים האחרונות. ריצה שנכשלה מופיעה עם הסיבה.">
      <ul className="space-y-1">
        {state.runs.map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between gap-2 border-b border-gold/10
                       py-1.5 text-[11.5px] last:border-0"
          >
            <span className="shrink-0 text-chalk-dim">{when(r.startedAt)}</span>
            <span className="min-w-0 flex-1 truncate text-chalk-2">
              {r.source} · {r.phase} · {r.gw ?? '—'}
              {r.error && <span className="text-flare"> · {r.error}</span>}
            </span>
            <span className={`num shrink-0 font-bold ${
              r.status === 'failed' ? 'text-flare'
                : r.status === 'partial' ? 'text-gold' : 'text-chalk-dim'}`}
            >
              {r.playersMapped}/{r.playersSeen}
            </span>
          </li>
        ))}
        {state.runs.length === 0 && (
          <li className="py-2 text-[12px] text-chalk-dim">עוד לא רצה קליטה.</li>
        )}
      </ul>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* 6 · הגדרות                                                           */
/* ------------------------------------------------------------------ */

function Settings({ state, onChange }: { state: IngestState; onChange: () => void }) {
  const act = useAction();
  const cfg = state.config;
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');

  const toggle = (key: string, value: boolean) => act.run(async () => {
    await ingestSetConfig({ [key]: value });
    onChange();
    return 'עודכן';
  });

  return (
    <Card
      title="הגדרות"
      hint="נוגעים בהן פעם אחת. ברירות המחדל הן מה שרץ בפועל."
    >
      <div className="space-y-2">
        {([
          ['enabled', 'קליטה פעילה', cfg?.enabled],
          ['autoPublish', 'פרסום אוטומטי בסוף מחזור', cfg?.auto_publish],
          ['autoOpenNext', 'פתיחה אוטומטית של המחזור הבא', cfg?.auto_open_next],
          ['autoMapPlayers', 'מיפוי שחקנים אוטומטי', cfg?.auto_map_players],
        ] as const).map(([key, label, on]) => (
          <label key={key} className="flex items-center justify-between gap-2 text-[12.5px]">
            <span className="text-chalk-2">{label}</span>
            <input
              type="checkbox"
              checked={on === true}
              disabled={act.busy}
              onChange={(e) => toggle(key, e.target.checked)}
              className="size-4 accent-[#D8B25C]"
            />
          </label>
        ))}

        <label className="flex items-center justify-between gap-2 text-[12.5px]">
          <span className="text-chalk-2">דקות יציבות לפני פרסום</span>
          <input
            type="number"
            min={5}
            max={720}
            defaultValue={cfg?.stable_minutes ?? 45}
            disabled={act.busy}
            onBlur={(e) => act.run(async () => {
              await ingestSetConfig({ stableMinutes: Number(e.target.value) });
              onChange();
              return 'עודכן';
            })}
            className={`num w-20 ${input}`}
          />
        </label>
      </div>

      {/* ★ כתובת וטוקן ולא "מפתח API": זה היעד שה-cron מעיר.
          הטוקן לעולם לא חוזר מהשרת — שדה ריק פירושו "לא משנים". */}
      <div className="mt-4 space-y-2 border-t border-gold/15 pt-3">
        <p className="text-[11.5px] text-chalk-dim">
          יעד הפעימה. הטוקן נשמר ואינו מוצג שוב.
        </p>
        <input
          dir="ltr"
          value={url}
          placeholder="https://<project>.supabase.co/functions/v1/dubid-ingest"
          disabled={act.busy}
          onChange={(e) => setUrl(e.target.value)}
          className={input}
        />
        <input
          dir="ltr"
          value={token}
          placeholder="INGEST_TOKEN"
          disabled={act.busy}
          onChange={(e) => setToken(e.target.value)}
          className={input}
        />
        <div className="flex gap-2">
          <button
            disabled={act.busy || (!url && !token)}
            className={`${primary} py-2`}
            onClick={() => act.run(async () => {
              await ingestSetEndpoint(url, token);
              setToken('');
              onChange();
              return 'נשמר';
            })}
          >
            שמירה
          </button>
          <button
            disabled={act.busy}
            className={ghost}
            onClick={() => act.run(async () => {
              const r = await ingestNow();
              onChange();
              return `הפעימה נשלחה · ${JSON.stringify(r)}`;
            })}
          >
            הרץ עכשיו
          </button>
        </div>
      </div>

      <Note msg={act.msg} bad={act.bad} />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* המסך                                                                */
/* ------------------------------------------------------------------ */

export function AdminIngest() {
  const [state, setState] = useState<IngestState | null>(null);
  const [rows, setRows] = useState<UnmappedRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = () => setTick((n) => n + 1);

  useEffect(() => {
    let alive = true;
    void Promise.all([ingestState(), ingestUnmapped(200)])
      .then(([s, u]) => { if (alive) { setState(s); setRows(u); setErr(null); } })
      .catch((e: unknown) => { if (alive) setErr(e instanceof Error ? e.message : 'שגיאה'); });
    return () => { alive = false; };
  }, [tick]);

  /* ★ רענון כל 30 שניות, ורק כשהטאב גלוי — אותו כלל של
     `startLivePolling`. לוח ניהול פתוח בטאב אחורי במשך יום
     הוא בקשה כל חצי דקה על כלום. */
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  if (err) {
    return (
      <Card title="קליטה" hint="המסך לא נטען.">
        <p className="text-[12.5px] text-flare">{err}</p>
        <p className="mt-1 text-[11.5px] text-chalk-dim">
          אם זה <span dir="ltr">404</span> — db/26 ו-db/27 עוד לא רצו במסד.
        </p>
      </Card>
    );
  }

  if (!state) {
    return <Card title="קליטה"><p className="text-[12.5px] text-chalk-dim">טוען…</p></Card>;
  }

  return (
    <div className="space-y-3">
      <Pulse state={state} />
      <Alerts state={state} onChange={refresh} />
      <Mapping rows={rows} onChange={refresh} />
      <Gameweeks state={state} />
      <Runs state={state} />
      <Settings state={state} onChange={refresh} />
    </div>
  );
}
