/**
 * components/AdminLeagues.tsx — לוח הניהול וארבע הליגות (db/62).
 *
 * ★ עד כאן הלוח עבד בשקט על "הליגה שהדפדפן בחר" — בלי לומר איזו, ובלי דרך
 *   לעבור. מחזור, סגלים, תוצאות ובוטים נגעו בליגה אחת בלי שהאדמין ידע איזו.
 * ★ עכשיו:
 *   · `AdminLeagueBar` — בראש הלוח: על איזו ליגה עובדים, ומעבר בלחיצה.
 *   · `AdminLeaguesOverview` — כל הליגות במבט אחד: מחזור, נעילה, משחקים,
 *     הגשות (אנשים / בית בנפרד), התראות קליטה, טבלה, ריצה אחרונה.
 */
import { useEffect, useState } from 'react';
import { chooseLeague, fetchLeagues, selectedLeague, type PublicLeague } from '../lib/league.ts';
import { adminLeaguesOverview, adminNameGaps, adminNamesApply, adminNamesFetch, adminSquadSyncApply, adminSquadSyncPlan, adminSquadSyncReport, adminStorageReport, errorMessageHe, type LeagueOverviewRow, type NameGaps, type SquadSyncReport, type StorageReport } from '../lib/store.ts';
import { LeagueFlag } from './LeagueIdentity.tsx';
import { Card } from './AdminConsole.tsx';

/** קוד הליגה שהלוח עובד עליה: הבחירה המקומית, או הראשית. */
export function useAdminLeague(): { code: string | null; leagues: PublicLeague[] } {
  const [leagues, setLeagues] = useState<PublicLeague[]>([]);
  useEffect(() => { void fetchLeagues().then(setLeagues); }, []);
  const code = selectedLeague() ?? leagues.find((l) => l.primary)?.code ?? null;
  return { code, leagues };
}

const HE_NAME: Record<string, string> = {
  IL_PREMIER: 'ליגת העל', GR_SUPER: 'יוון', EN_PL: 'אנגליה', ES_LALIGA: 'ספרד',
};

function Flag({ code }: { code: string }) {
  return (
    <span className="inline-block h-[14px] w-[21px] shrink-0 overflow-hidden rounded-[2px] ring-1 ring-white/25 align-middle">
      <LeagueFlag country={code} />
    </span>
  );
}

export function AdminLeagueBar() {
  const { code, leagues } = useAdminLeague();
  if (leagues.length < 2) return null;
  return (
    <div className="px-4 pt-3" style={{ direction: 'rtl' }}>
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-gold/20 bg-night-2 p-1.5">
        <span className="px-1.5 text-[11px] font-black text-chalk-dim">הלוח עובד על:</span>
        {leagues.map((l) => {
          const on = l.code === code;
          return (
            <button
              key={l.code}
              type="button"
              aria-pressed={on}
              onClick={() => { if (!on) chooseLeague(l.code, Boolean(l.primary)); }}
              className={`tap flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-black ${
                on ? 'bg-gradient-to-b from-gold-light to-gold text-gold-ink' : 'text-chalk-2'}`}
            >
              <Flag code={l.code} />
              {HE_NAME[l.code] ?? l.code}
              <span className="num text-[10.5px] opacity-75">{l.currentGameweek ?? ''}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const STATUS_HE: Record<string, string> = {
  draft: 'טיוטה', open: 'פתוח להגשה', locked: 'נעול', live: 'חי', scoring: 'בניקוד', published: 'פורסם', archived: 'בארכיון',
};

const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('he-IL', {
  weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
}) : '—');

export function AdminLeaguesOverview() {
  const [rows, setRows] = useState<LeagueOverviewRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { code: active, leagues } = useAdminLeague();

  const load = () => {
    adminLeaguesOverview().then((r) => { setRows(r); setErr(null); },
      (e: unknown) => setErr(errorMessageHe(e instanceof Error ? e.message : 'NETWORK')));
  };
  useEffect(load, []);

  return (
    <Card title="כל הליגות" hint="מצב המחזור בכל ליגה. «בית» = משתתפי הבית; נספרים בנפרד ואינם במדדי האנשים.">
      {err && <p className="text-[12px] text-flare">{err}</p>}
      {!rows && !err && <p className="text-[12px] text-chalk-dim">טוען…</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {rows?.map((r) => {
          const g = r.round;
          const e = g?.entries;
          const lg = leagues.find((l) => l.code === r.league);
          return (
            <div key={r.league}
                 className={`rounded-xl border px-3 py-2.5 ${r.league === active ? 'border-gold/55 bg-gold/5' : 'border-gold/12 bg-night'}`}>
              <div className="flex items-center gap-2">
                <Flag code={r.league} />
                <span className="text-[13px] font-black text-chalk">{HE_NAME[r.league] ?? r.name}</span>
                {g && <span className="num text-[11px] text-chalk-dim">{g.code}</span>}
                {g && (
                  <span className="rounded-full bg-night-3 px-2 py-0.5 text-[10px] text-chalk-2">{STATUS_HE[g.status] ?? g.status}</span>
                )}
                {!r.ingest && <span className="rounded-full bg-flare/15 px-2 py-0.5 text-[10px] font-black text-flare">קליטה כבויה</span>}
              </div>
              {g ? (
                <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                  <dt className="text-chalk-dim">נעילה</dt><dd className="num text-chalk">{fmt(g.lockAt)}</dd>
                  <dt className="text-chalk-dim">משחקים</dt><dd className="num text-chalk">{g.fixturesFinal}/{g.fixtures} הסתיימו</dd>
                  <dt className="text-chalk-dim">דוביד 5</dt><dd className="num text-chalk">{e?.fiveHuman ?? 0} אנשים · {e?.fiveHouse ?? 0} בית</dd>
                  <dt className="text-chalk-dim">דוביד 11</dt><dd className="num text-chalk">{e?.fullHuman ?? 0} אנשים · {e?.fullHouse ?? 0} בית</dd>
                  <dt className="text-chalk-dim">התראות</dt>
                  <dd className={`num ${g.alertsBlock ? 'font-black text-flare' : 'text-chalk'}`}>
                    {g.alertsBlock} חוסמות · {g.alertsWarn} אזהרות
                  </dd>
                  <dt className="text-chalk-dim">טבלה רשמית</dt>
                  <dd className="num text-chalk">{r.standings.rows ? `${r.standings.rows} קבוצות · ${fmt(r.standings.updatedAt)}` : '—'}</dd>
                  <dt className="text-chalk-dim">קליטה אחרונה</dt>
                  <dd className="num text-chalk">{r.lastRun ? `${fmt(r.lastRun.at)} · ${r.lastRun.status}` : '—'}</dd>
                </dl>
              ) : (
                <p className="mt-1.5 text-[11px] text-chalk-dim">אין מחזור</p>
              )}
              {r.league !== active && lg && (
                <button type="button" onClick={() => chooseLeague(lg.code, Boolean(lg.primary))}
                        className="tap mt-2 rounded-lg border border-gold/25 px-3 py-1 text-[11.5px] font-bold text-chalk-2">
                  לעבוד על הליגה הזו
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button type="button" onClick={load} className="tap mt-3 text-[11.5px] font-bold text-gold">רענון</button>
      {active && <NamesBox league={active} />}
      {active && <SquadSyncBox league={active} />}
      <StorageBox />
    </Card>
  );
}

/**
 * ★ db/67: שמות שחקנים באנגלית. מקור: זוג עברית/אנגלית של 365scores לאותו אתלט,
 *   התאמה ייחודית בתוך הקבוצה. מה שלא הותאם — כאן, לתיקון ידני (שחקני סגל).
 */
function NamesBox({ league }: { league: string }) {
  const [g, setG] = useState<NameGaps | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => adminNameGaps(league).then(setG, () => setG(null));
  useEffect(() => { void load(); }, [league]);
  const run = async () => {
    setBusy(true); setMsg('');
    try {
      const f = await adminNamesFetch(league);
      if (!f.ok) { setMsg(`לא נשלח: ${f.reason ?? ''}`); return; }
      setMsg(`נשלחו ${f.requests} בקשות לספק… מחכה לתשובות`);
      await new Promise((r) => setTimeout(r, 8000));
      const a = await adminNamesApply(league);
      setMsg(`מולאו ${a.filled ?? 0} · חסרים ${a.gaps ?? '?'}${a.pending ? ` · ${a.pending} תשובות עוד לא הגיעו — לחצו שוב` : ''}`);
      await load();
    } catch (e) { setMsg(errorMessageHe(e instanceof Error ? e.message : 'NETWORK')); } finally { setBusy(false); }
  };
  if (!g) return null;
  return (
    <div className="mt-3 rounded-xl border border-gold/15 bg-night px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-black text-chalk">שמות שחקנים באנגלית · {league}</span>
        <span className={`num text-[12px] font-black ${g.missing ? 'text-amber-300' : 'text-gold'}`}>
          {g.total - g.missing} / {g.total}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-chalk-dim">
        חסר שם אנגלי → המסך האנגלי מציג את השם העברי (אין TBD). המקור: סגלי 365scores בעברית ובאנגלית, התאמה ייחודית בתוך הקבוצה.
      </p>
      <button type="button" disabled={busy} onClick={() => void run()}
              className="tap mt-2 rounded-lg border border-gold/30 px-3 py-1 text-[11.5px] font-bold text-gold disabled:opacity-50">
        {busy ? 'עובד…' : 'משיכה מהספק והשלמה'}
      </button>
      {msg && <p className="mt-1.5 text-[11px] text-chalk-2" role="status">{msg}</p>}
      {g.missing > 0 && (
        <details className="mt-2 text-[11px] text-chalk-dim">
          <summary className="cursor-pointer font-bold text-chalk-2">{g.missing} בלי שם אנגלי</summary>
          <ul className="mt-1 max-h-48 overflow-y-auto">
            {g.rows.map((r) => <li key={r.playerId}><bdi>{r.nameHe}</bdi> · {r.team}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

const SYNC_KIND_HE: Record<string, string> = {
  transfer: 'מעבר קבוצה', left: 'עזב (נסגר בסגל)', new: 'שחקן חדש', duplicate: 'שורה כפולה',
  shirt: 'מספר חולצה', name_en: 'שם אנגלי', ref_fix: 'תיקון מיפוי קליטה', ref_drop: 'מיפוי שגוי הוסר',
  position: 'עמדה שונה מהספק (דיווח בלבד)',
};

/**
 * ★ db/69: יישור הסגל מול סגלי 365scores. שני שלבים: "תכנון" לא משנה כלום ומציג
 *   מה ישתנה; "ביצוע" מחיל את הריצה האחרונה. עמדות — דיווח בלבד.
 */
function SquadSyncBox({ league }: { league: string }) {
  const [r, setR] = useState<SquadSyncReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = () => adminSquadSyncReport(league).then(setR, () => setR(null));
  useEffect(() => { void load(); }, [league]);
  const plan = async () => {
    setBusy(true); setMsg('');
    try {
      const f = await adminNamesFetch(league);
      if (!f.ok) { setMsg(`לא נשלח: ${f.reason ?? ''}`); return; }
      setMsg('מושך סגלים מהספק…');
      await new Promise((res) => setTimeout(res, 9000));
      const p = await adminSquadSyncPlan(league);
      setMsg(p.ok ? `תכנון #${p.runId} מוכן — עברו על הרשימה ואז "ביצוע"` : `לא נוצר: ${p.reason ?? ''}`);
      await load();
    } catch (e) { setMsg(errorMessageHe(e instanceof Error ? e.message : 'NETWORK')); } finally { setBusy(false); }
  };
  const apply = async () => {
    if (!r) return;
    setBusy(true); setMsg('');
    try {
      const a = await adminSquadSyncApply(r.runId);
      setMsg(`בוצע. סטטיסטיקות שהועברו: ${a.statsMoved ?? 0}${a.rescore?.length ? ` · לניקוד מחדש: ${a.rescore.map((g) => g.code).join(', ')}` : ''}`);
      await load();
    } catch (e) { setMsg(errorMessageHe(e instanceof Error ? e.message : 'NETWORK')); } finally { setBusy(false); }
  };
  const items = r?.summary.applied ?? r?.summary.items ?? {};
  return (
    <div className="mt-3 rounded-xl border border-gold/15 bg-night px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-black text-chalk">יישור סגל מול הספק · {league}</span>
        {r && <span className="text-[11px] text-chalk-dim">#{r.runId} · {r.appliedAt ? 'בוצע' : 'תכנון'}</span>}
      </div>
      <p className="mt-1 text-[11px] text-chalk-dim">
        מעברים, עזיבות, שחקנים חדשים, מספרי חולצה ומיפויי קליטה — מול סגלי 365scores. הרכבים שהוגשו וניקוד שפורסם לא משתנים.
      </p>
      {r && (
        <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-chalk-2">
          {Object.entries(items).filter(([k]) => k !== 'link').map(([k, n]) => <li key={k}>{SYNC_KIND_HE[k] ?? k}: <span className="num">{n}</span></li>)}
        </ul>
      )}
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={busy} onClick={() => void plan()}
                className="tap rounded-lg border border-gold/30 px-3 py-1 text-[11.5px] font-bold text-gold disabled:opacity-50">
          {busy ? 'עובד…' : 'תכנון (בלי שינוי)'}
        </button>
        {r && !r.appliedAt && (
          <button type="button" disabled={busy} onClick={() => void apply()}
                  className="tap rounded-lg bg-gold px-3 py-1 text-[11.5px] font-black text-night disabled:opacity-50">
            ביצוע #{r.runId}
          </button>
        )}
      </div>
      {msg && <p className="mt-1.5 text-[11px] text-chalk-2" role="status">{msg}</p>}
      {r && r.items.length > 0 && (
        <details className="mt-2 text-[11px] text-chalk-dim">
          <summary className="cursor-pointer font-bold text-chalk-2">פירוט ({r.items.length})</summary>
          <ul className="mt-1 max-h-64 overflow-y-auto">
            {r.items.map((i, k) => (
              <li key={k}>
                <span className="text-gold/80">{SYNC_KIND_HE[i.kind] ?? i.kind}</span> · <bdi>{i.name ?? String(i.detail.rightName ?? '')}</bdi>
                {i.from ? <> · {i.from}</> : null}{i.to ? <> → {i.to}</> : null}
                {i.kind === 'ref_fix' ? <> · <bdi>{String(i.detail.wrongName ?? '')} → {String(i.detail.rightName ?? '')}</bdi></> : null}
                {i.kind === 'position' ? <> · {String(i.detail.ours)} / ספק {String(i.detail.provider)}</> : null}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(b > 100 * 1024 * 1024 ? 0 : 1)}MB`;

/** ★ db/65: המסד המשותף (DUBID+OFFSIDES+FAN LIFE) מול מכסת החינם — 500MB ואז "קריאה בלבד". */
function StorageBox() {
  const [r, setR] = useState<StorageReport | null>(null);
  useEffect(() => { adminStorageReport().then(setR, () => setR(null)); }, []);
  if (!r) return null;
  const pct = Math.round((r.databaseBytes / r.quotaBytes) * 100);
  return (
    <div className="mt-3 rounded-xl border border-gold/15 bg-night px-3 py-2.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] font-black text-chalk">אחסון המסד המשותף</span>
        <span className={`num text-[12px] font-black ${pct >= 80 ? 'text-flare' : 'text-gold'}`}>
          {mb(r.databaseBytes)} / {mb(r.quotaBytes)} · {pct}%
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-night-3">
        <div className={`h-full ${pct >= 80 ? 'bg-flare' : 'bg-gold'}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-x-3 text-[10.5px] text-chalk-dim">
        {r.tables.slice(0, 6).map((x) => (
          <li key={x.table} className="flex justify-between gap-2"><bdi className="truncate">{x.table}</bdi><span className="num">{mb(x.bytes)}</span></li>
        ))}
      </ul>
      {pct >= 80 && <p className="mt-2 text-[11px] font-bold text-flare">מעל 500MB המסד עובר ל"קריאה בלבד" — אין הגשות. שדרוג ל-Pro או פינוי.</p>}
    </div>
  );
}

