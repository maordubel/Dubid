/**
 * components/AdminSquads.tsx — עריכת סגלים.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ ארבע פעולות, כי אלה ארבע הפעולות שקורות
 * ═══════════════════════════════════════════════════════════════
 *
 *   שחקן חדש נחתם         →  הוספה
 *   שחקן עבר קבוצה        →  העברה
 *   המחיר לא מאוזן        →  תמחור
 *   פציעה / הרחקה / עזיבה →  זמינות
 *
 * עד עכשיו כל אחת מהן דרשה לערוך `src/data/squads.ts`, לבנות
 * מחדש, ולפרוס. כלומר: הן לא קרו.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ שתי החלטות עיצוב שנובעות מהשימוש האמיתי
 * ═══════════════════════════════════════════════════════════════
 *
 * **המחיר נשמר ב-blur, לא בכפתור.** איזון תמחור הוא עשרים
 * שדות ברצף. כפתור "שמור" ליד כל אחד הופך עבודה של דקה לעבודה
 * של רבע שעה, ומזמין את מי שממהר לשכוח אחד.
 *
 * **שום דבר לא נמחק.** "עזב" סוגר את שורת הסגל ולא מוחק אותה
 * (`valid_to`). הרכב שהוגש לפני שהשחקן עזב עדיין יודע מאיזו
 * קבוצה הוא היה — מחיקה אמיתית הייתה משכתבת תחרות שכבר נגמרה.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  fetchAdminSquads, adminUpsertPlayer, adminMovePlayer,
  adminSetPrice, adminSetPlayerStatus, errorMessageHe,
  type AdminTeamSquad, type AdminPlayerRow,
} from '../lib/store.ts';
import { TeamCrest } from './TeamCrest.tsx';

const POSITIONS: Array<AdminPlayerRow['position']> = ['GK', 'DEF', 'MID', 'FWD'];

const POSITION_HE: Record<AdminPlayerRow['position'], string> = {
  GK: 'שוער', DEF: 'הגנה', MID: 'קישור', FWD: 'התקפה',
};

const STATUS_HE: Record<AdminPlayerRow['status'], string> = {
  active: 'כשיר',
  injured: 'פצוע',
  suspended: 'מורחק',
  loaned_out: 'מושאל',
  left: 'עזב',
};

const STATUS_TONE: Record<AdminPlayerRow['status'], string> = {
  active: 'bg-night-3 text-chalk-dim',
  injured: 'bg-flare/15 text-flare',
  suspended: 'bg-armband/15 text-armband',
  loaned_out: 'bg-tekhelet/15 text-tekhelet',
  left: 'bg-night-3 text-chalk-dim line-through',
};

export function AdminSquads() {
  const [squads, setSquads] = useState<AdminTeamSquad[] | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');

  const load = () => {
    setError(null);
    void fetchAdminSquads()
      .then((rows) => {
        setSquads(rows);
        setTeamId((cur) => cur ?? rows[0]?.teamId ?? null);
      })
      .catch((e: unknown) =>
        setError(errorMessageHe(e instanceof Error ? e.message : 'NETWORK')));
  };

  useEffect(load, []);

  const team = useMemo(
    () => squads?.find((t) => t.teamId === teamId) ?? null,
    [squads, teamId],
  );

  /**
   * ★ חיפוש חוצה־קבוצות.
   *
   * "איפה השחקן הזה?" היא השאלה הראשונה כשמעבירים מישהו, ובלי
   * חיפוש התשובה דורשת לפתוח 14 קבוצות. כשיש טקסט — מציגים
   * תוצאות מכל הליגה, עם הקבוצה ליד כל שם.
   */
  const matches = useMemo(() => {
    const q = query.trim();
    if (q.length < 2 || !squads) return null;
    return squads.flatMap((t) =>
      t.players
        .filter((p) => p.nameHe.includes(q) || (p.nameEn ?? '').toLowerCase().includes(q.toLowerCase()))
        .map((p) => ({ team: t, player: p })),
    ).slice(0, 40);
  }, [query, squads]);

  if (error) {
    return (
      <div role="alert" className="rounded-2xl border border-flare/40 bg-flare/10 px-4 py-4">
        <p className="text-sm font-black text-flare">{error}</p>
        <button onClick={load} className="mt-2 text-[12px] text-chalk-2 underline">
          לנסות שוב
        </button>
      </div>
    );
  }

  if (!squads) {
    return <p className="py-8 text-center text-sm text-chalk-dim">טוען סגלים…</p>;
  }

  return (
    <div>
      {/* ── חיפוש ── */}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="חיפוש שחקן בכל הליגה…"
        className="mb-3 w-full rounded-xl border border-gold/25 bg-night px-3 py-2.5
                   text-chalk outline-none focus:border-gold"
      />

      {matches ? (
        <div className="space-y-1.5">
          <p className="text-[11px] text-chalk-dim">{matches.length} תוצאות</p>
          {matches.map(({ team: t, player: p }) => (
            <PlayerRow
              key={p.id}
              player={p}
              teams={squads}
              teamId={t.teamId}
              teamLabel={t.short}
              onChanged={load}
            />
          ))}
        </div>
      ) : (
        <>
          {/* ── בורר קבוצה ── */}
          <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1
                          [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {squads.map((t) => (
              <button
                key={t.teamId}
                onClick={() => setTeamId(t.teamId)}
                className={`tap flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5
                            text-[12px] font-bold ring-1 ring-inset transition-colors ${
                              t.teamId === teamId
                                ? 'bg-gold/15 text-gold-light ring-gold/40'
                                : 'bg-night-2 text-chalk-dim ring-gold/12'
                            }`}
              >
                <TeamCrest teamId={t.teamId} short={t.short} size={18} />
                {t.short}
                <span className="num text-[10px] opacity-60">{t.players.length}</span>
              </button>
            ))}
          </div>

          {team && (
            <>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-display text-base font-black text-chalk">{team.nameHe}</h3>
                <button
                  onClick={() => setAdding((v) => !v)}
                  className="tap rounded-full bg-gradient-to-b from-gold-light to-gold px-3 py-1.5
                             text-[12px] font-black text-gold-ink"
                >
                  {adding ? 'ביטול' : '+ שחקן חדש'}
                </button>
              </div>

              {adding && (
                <NewPlayerForm
                  teamId={team.teamId}
                  onDone={() => { setAdding(false); load(); }}
                />
              )}

              <div className="space-y-1.5">
                {POSITIONS.map((pos) => {
                  const rows = team.players.filter((p) => p.position === pos);
                  if (!rows.length) return null;
                  return (
                    <section key={pos}>
                      <h4 className="mb-1 mt-3 text-[10px] font-black uppercase
                                     tracking-[0.2em] text-chalk-dim">
                        {POSITION_HE[pos]}
                      </h4>
                      {rows.map((p) => (
                        <PlayerRow
                          key={p.id}
                          player={p}
                          teams={squads}
                          teamId={team.teamId}
                          onChanged={load}
                        />
                      ))}
                    </section>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ================================================================== */

function PlayerRow({
  player, teams, teamId, teamLabel, onChanged,
}: {
  player: AdminPlayerRow;
  teams: AdminTeamSquad[];
  teamId: string;
  teamLabel?: string;
  onChanged: () => void;
}) {
  const [price, setPrice] = useState(player.price ?? 0);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    void fn()
      .then(onChanged)
      .catch((e: unknown) => setErr(errorMessageHe(e instanceof Error ? e.message : 'NETWORK')))
      .finally(() => setBusy(false));
  };

  return (
    <div className={`rounded-xl border px-2.5 py-2 transition-colors ${
      err ? 'border-flare/40 bg-flare/5' : 'border-gold/12 bg-night-2'
    }`}>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="min-w-0 flex-1 truncate text-start text-[13px] font-bold text-chalk"
        >
          <bdi>{player.nameHe}</bdi>
          {teamLabel && <span className="ms-1.5 text-[11px] text-chalk-dim">{teamLabel}</span>}
        </button>

        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-black
                          ${STATUS_TONE[player.status]}`}>
          {STATUS_HE[player.status]}
        </span>

        {/* ★ המחיר נשמר ביציאה מהשדה. ראו הערת הראש. */}
        <input
          type="number"
          min={0}
          max={99}
          step={0.5}
          value={price}
          disabled={busy}
          onChange={(e) => setPrice(Number(e.target.value))}
          onBlur={() => {
            if (price !== (player.price ?? 0)) run(() => adminSetPrice(player.id, price));
          }}
          className="num w-14 shrink-0 rounded-lg border border-gold/25 bg-night px-1 py-1
                     text-center text-[12px] text-gold-light outline-none focus:border-gold
                     disabled:opacity-50"
        />
      </div>

      {err && <p className="mt-1 text-[11px] text-flare">{err}</p>}

      {open && (
        <div className="mt-2 space-y-2 border-t border-gold/10 pt-2">
          <div className="flex flex-wrap gap-1">
            {(Object.keys(STATUS_HE) as Array<AdminPlayerRow['status']>).map((st) => (
              <button
                key={st}
                disabled={busy || st === player.status}
                onClick={() => run(() => adminSetPlayerStatus(player.id, st))}
                className={`rounded-full px-2 py-1 text-[11px] font-bold transition-colors
                            disabled:opacity-40 ${
                              st === player.status
                                ? 'bg-gold text-gold-ink'
                                : 'bg-night-3 text-chalk-2'
                            }`}
              >
                {STATUS_HE[st]}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="text-[10px] font-black uppercase tracking-[0.16em] text-chalk-dim">
              העברה לקבוצה
            </span>
            <select
              disabled={busy}
              value={teamId}
              onChange={(e) => {
                const to = e.target.value;
                if (to !== teamId && window.confirm(
                  `להעביר את ${player.nameHe} ל${teams.find((t) => t.teamId === to)?.nameHe}?`,
                )) {
                  run(() => adminMovePlayer(player.id, to));
                }
              }}
              className="mt-1 w-full rounded-lg border border-gold/25 bg-night px-2 py-1.5
                         text-[12px] text-chalk outline-none focus:border-gold"
            >
              {teams.map((t) => (
                <option key={t.teamId} value={t.teamId}>{t.nameHe}</option>
              ))}
            </select>
          </label>

          <p className="num text-[10px] text-chalk-dim">{player.id}</p>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */

function NewPlayerForm({ teamId, onDone }: { teamId: string; onDone: () => void }) {
  const [nameHe, setNameHe] = useState('');
  const [position, setPosition] = useState<AdminPlayerRow['position']>('MID');
  const [price, setPrice] = useState(3);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (busy || !nameHe.trim()) return;
        setBusy(true);
        setErr(null);
        void adminUpsertPlayer({ teamId, nameHe, position, price })
          .then(() => { setNameHe(''); onDone(); })
          .catch((x: unknown) =>
            setErr(errorMessageHe(x instanceof Error ? x.message : 'NETWORK')))
          .finally(() => setBusy(false));
      }}
      className="mb-3 rounded-xl border border-gold/25 bg-night p-3"
    >
      <input
        autoFocus
        value={nameHe}
        onChange={(e) => setNameHe(e.target.value)}
        placeholder="שם השחקן בעברית"
        className="w-full rounded-lg border border-gold/25 bg-night-2 px-2.5 py-2
                   text-[13px] text-chalk outline-none focus:border-gold"
      />
      <div className="mt-2 flex gap-2">
        <select
          value={position}
          onChange={(e) => setPosition(e.target.value as AdminPlayerRow['position'])}
          className="flex-1 rounded-lg border border-gold/25 bg-night-2 px-2 py-1.5
                     text-[12px] text-chalk outline-none focus:border-gold"
        >
          {POSITIONS.map((p) => <option key={p} value={p}>{POSITION_HE[p]}</option>)}
        </select>
        <input
          type="number" min={0} max={99} step={0.5}
          value={price}
          onChange={(e) => setPrice(Number(e.target.value))}
          className="num w-16 rounded-lg border border-gold/25 bg-night-2 px-1 py-1.5
                     text-center text-[12px] text-gold-light outline-none focus:border-gold"
        />
        <button
          type="submit"
          disabled={busy || !nameHe.trim()}
          className="tap shrink-0 rounded-lg bg-gradient-to-b from-gold-light to-gold px-3
                     text-[12px] font-black text-gold-ink disabled:opacity-40"
        >
          {busy ? '…' : 'הוספה'}
        </button>
      </div>
      {err && <p className="mt-2 text-[11px] text-flare">{err}</p>}
      {/* ★ האזהרה חייבת להיות כאן ולא בתיעוד.
          מי שמוסיף שחקן ולא רואה אותו בבורר יחשוב שההוספה נכשלה. */}
      <p className="mt-2 text-[10.5px] leading-snug text-chalk-dim">
        השחקן ייכנס למסד מיד וההגשות יכירו אותו. הוא יופיע בבורר
        השחקנים רק אחרי בנייה מחדש של <code className="num">src/data/squads.ts</code>.
      </p>
    </form>
  );
}
