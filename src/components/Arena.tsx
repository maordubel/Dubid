/**
 * Arena.tsx — הזירות. ליגה פרטית מול חברים.
 *
 * ═══════════════════════════════════════════════════════════════════
 *  למה המסך הזה נבנה עכשיו
 * ═══════════════════════════════════════════════════════════════════
 *
 * הלוגיקה הייתה קיימת במלואה: `lib/leagues.ts` עם קודי הצטרפות,
 * בדיקות הצטרפות, טבלה, שיא ניצחונות ורצף — הכל בדוק. גם המיגרציה
 * במסד קיימת (`db/06_private_leagues.sql`). **חסר היה רק מסך.**
 *
 * כלומר: פיצ׳ר שלם, כתוב ובדוק, שאף משתמש לא יכול היה להגיע אליו.
 * הלובי אפילו הצביע על "ליגות פרטיות" — והכפתור שלח לדירוג הכללי.
 *
 * ═══════════════════════════════════════════════════════════════════
 *  ההחלטות
 * ═══════════════════════════════════════════════════════════════════
 *
 * · **בלי קופה.** בעל המוצר היה מפורש: ניקוד בלבד, אין פרס שמתחלק.
 *   תחושת הניצחון מגיעה מהטבלה ומהרצף, לא ממטבע.
 * · **פעולה ראשית אחת בכל מצב.** אין זירות → "להצטרף בקוד" הוא
 *   הכפתור הגדול, ו"לפתוח זירה" משני. יש זירות → הטבלה היא המסך.
 * · **הקוד הוא המוצר.** בזירה פעילה, הדבר שהכי קל ללחוץ עליו הוא
 *   העתקת ההזמנה. זירה בלי חברים היא לא זירה.
 * · **הטבלה היא `Table`** — אותו קומפוננט של הדירוג הראשי, ולכן
 *   אותה התנהגות במובייל ובדסקטופ. אין כאן טבלה שנייה.
 */
import { useEffect, useMemo, useState } from 'react';

import { standings, inviteUrl, JOIN_ERROR_HE, type MemberGameweek, type StandingRow }
  from '../lib/leagues.ts';
import { createLeague, joinByCode, listMembers, myLeagues } from '../lib/leagueStore.ts';
import { listEntries, getResults, subscribeToStore } from '../lib/store.ts';
import { scoreLineup } from '../lib/scoring/engine.ts';
import type { RuleSet } from '../lib/scoring/rules.ts';
import { GAMEWEEK } from '../data/fixtures.ts';
import { Table, type Column } from './Table.tsx';
import { ShadesDivider } from './Shades.tsx';

const MODE_LABEL: Record<'full' | 'five', string> = { full: 'דוביד 11', five: 'דוביד 5' };

export interface ArenaProps {
  userId: string;
  displayName: string;
  rulesByMode: Record<'full' | 'five', RuleSet>;
  origin: string;
}

export function Arena({ userId, displayName, rulesByMode, origin }: ArenaProps) {
  const [, force] = useState(0);
  useEffect(() => subscribeToStore(() => force((n) => n + 1)), []);

  const leagues = myLeagues(userId);
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = leagues.find((l) => l.id === activeId) ?? leagues[0];

  if (leagues.length === 0) {
    return <ArenaEmpty userId={userId} displayName={displayName} />;
  }

  return (
    <div className="mx-auto max-w-lg px-4 pb-8 pt-3 lg:max-w-3xl">
      {leagues.length > 1 && (
        <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
          {leagues.map((l) => (
            <button
              key={l.id}
              onClick={() => setActiveId(l.id)}
              className={`tap shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-black
                          transition-colors duration-200 ease-brand ${
                            l.id === active?.id ? 'bg-gold text-night' : 'bg-night-2 text-chalk-dim'
                          }`}
            >
              {l.name}
            </button>
          ))}
        </div>
      )}

      {active && (
        <ArenaTable
          key={active.id}
          userId={userId}
          league={active}
          rules={rulesByMode[active.mode as 'full' | 'five']}
          origin={origin}
        />
      )}

      <ShadesDivider className="my-6 px-8" />
      <ArenaActions userId={userId} displayName={displayName} onDone={setActiveId} compact />
    </div>
  );
}

/* ================================================================== */
/* מצב ריק                                                             */
/* ================================================================== */

function ArenaEmpty({ userId, displayName }: { userId: string; displayName: string }) {
  return (
    <div className="mx-auto max-w-lg px-4 pb-8 pt-6 lg:max-w-3xl">
      <div className="rounded-3xl border border-gold/15 bg-night-2 p-6 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-night">
          <svg viewBox="0 0 28 20" width="26" height="19" aria-hidden="true" className="text-gold">
            <rect x="10" y="2" width="8" height="18" rx="1.5" fill="currentColor" />
            <rect x="1" y="8" width="8" height="12" rx="1.5" fill="currentColor" opacity=".6" />
            <rect x="19" y="12" width="8" height="8" rx="1.5" fill="currentColor" opacity=".4" />
          </svg>
        </div>
        <h2 className="mt-3 font-display text-xl font-black text-chalk">זירה</h2>
        <p className="mx-auto mt-1.5 max-w-xs text-[13px] leading-snug text-chalk-2">
          טבלה פרטית מול החברים. אותו ניקוד, אותם שוברי שוויון —
          רק שכאן אתה יודע בדיוק את מי ניצחת.
        </p>
      </div>

      <ArenaActions userId={userId} displayName={displayName} onDone={() => {}} />
    </div>
  );
}

/* ================================================================== */
/* פעולות: הצטרפות ופתיחה                                              */
/* ================================================================== */

function ArenaActions({
  userId, displayName, onDone, compact = false,
}: {
  userId: string;
  displayName: string;
  onDone: (id: string) => void;
  compact?: boolean;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'full' | 'five'>('five');

  const submitJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const res = joinByCode(code, userId, displayName || 'אנונימי');
    if (!res.ok) {
      setError(res.error ? JOIN_ERROR_HE[res.error] : 'לא הצלחנו לצרף');
      return;
    }
    setError(null);
    setCode('');
    if (res.league) onDone(res.league.id);
  };

  return (
    <div className={compact ? '' : 'mt-4'}>
      {/* ── הצטרפות: הפעולה הראשית. רוב האנשים מגיעים עם קוד ── */}
      <form onSubmit={submitJoin} className="rounded-2xl border border-gold/15 bg-night-2 p-4">
        <label htmlFor="arena-code" className="block text-[12px] font-black text-chalk">
          יש לך קוד זירה?
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="arena-code"
            value={code}
            onChange={(e) => { setCode(e.target.value); setError(null); }}
            placeholder="AB3K9Z"
            // ★ `dir="ltr"` + `text-center`: הקוד לטיני, והוא נקרא
            //   הפוך בשדה RTL. מירכוז מונע את הריקוד של הסמן.
            dir="ltr"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={12}
            className="num h-12 min-w-0 flex-1 rounded-xl bg-night px-3 text-center text-lg
                       tracking-[0.3em] text-chalk placeholder:text-chalk-dim
                       focus:outline-none focus:ring-2 focus:ring-gold"
          />
          <button
            type="submit"
            className="tap h-12 shrink-0 rounded-xl bg-gold px-5 font-poster text-base text-night
                       transition-transform duration-200 ease-brand active:scale-[.98]"
          >
            להצטרף
          </button>
        </div>
        {error && <p role="alert" className="mt-2 text-[12px] font-bold text-flare">{error}</p>}
      </form>

      {/* ── פתיחה: משני, ונפתח רק כשמבקשים ── */}
      {!creating ? (
        <button
          onClick={() => setCreating(true)}
          className="tap mt-2.5 w-full rounded-2xl border border-gold/15 px-4 py-3
                     text-[13px] font-black text-chalk-2 transition-colors duration-200
                     ease-brand hover:border-gold/25 hover:text-chalk"
        >
          או לפתוח זירה חדשה
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const lg = createLeague({
              name, mode, ownerId: userId, ownerName: displayName || 'אנונימי',
            });
            setCreating(false);
            setName('');
            onDone(lg.id);
          }}
          className="mt-2.5 rounded-2xl border border-gold/15 bg-night-2 p-4"
        >
          <label htmlFor="arena-name" className="block text-[12px] font-black text-chalk">
            שם הזירה
          </label>
          <input
            id="arena-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="הקבוצה של העבודה"
            maxLength={40}
            className="mt-2 h-12 w-full rounded-xl bg-night px-3 text-[15px] text-chalk
                       placeholder:text-chalk-dim focus:outline-none focus:ring-2 focus:ring-gold"
          />

          <div className="mt-3 flex gap-1.5 rounded-full bg-night p-1">
            {(['five', 'full'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`tap flex-1 rounded-full py-1.5 text-[13px] font-black
                            transition-colors duration-200 ease-brand ${
                              mode === m ? 'bg-gold text-night' : 'text-chalk-dim'
                            }`}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
          {/* ★ למה מצב אחד לזירה: הברִיף אוסר למזג ניקוד של דוביד 5
              ודוביד 11 לטבלה תחרותית אחת. הרכב של 5 והרכב של 11
              לא צוברים באותו סולם. */}
          <p className="mt-1.5 text-[11px] text-chalk-dim">
            זירה שייכת למצב אחד. אי אפשר להשוות ניקוד של 5 מול 11.
          </p>

          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              className="tap h-11 flex-1 rounded-xl bg-gold font-poster text-base text-night"
            >
              לפתוח
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="tap h-11 rounded-xl px-4 text-[13px] font-black text-chalk-dim"
            >
              ביטול
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/* ================================================================== */
/* הטבלה                                                               */
/* ================================================================== */

function ArenaTable({
  userId, league, rules, origin,
}: {
  userId: string;
  league: ReturnType<typeof myLeagues>[number];
  rules: RuleSet;
  origin: string;
}) {
  const members = listMembers(league.id);
  const results = getResults(GAMEWEEK.id);

  /**
   * ★ ההיסטוריה נבנית מההגשות הקיימות, ולא מטבלה נפרדת.
   *
   * שכפול תוצאות לטבלת "היסטוריית זירה" היה יוצר מקור אמת שני,
   * ויום אחד המספר בזירה היה שונה מהמספר בדירוג הכללי. אותה
   * הגשה, אותו מנוע, אותו מספר.
   */
  const history: MemberGameweek[] = useMemo(() => {
    if (!results.published) return [];
    const memberIds = new Set(members.map((m) => m.userId));
    return listEntries(GAMEWEEK.id, league.mode as 'full' | 'five')
      .filter((e) => memberIds.has(e.userId))
      .map((e) => ({
        userId: e.userId,
        gameweekId: GAMEWEEK.id,
        score: scoreLineup(e.lineup, results.performances, results.outcomes, rules,
                           { validate: false }),
        submittedAt: e.submittedAt,
      }));
  }, [members, results, league.mode, rules]);

  const rows = useMemo(
    () => standings(members, history, [GAMEWEEK.id]),
    [members, history],
  );

  const columns: Column<StandingRow>[] = [
    {
      key: 'rank', header: '#', primary: true, numeric: true, width: '2.5rem',
      render: (r) => (
        <span className="flex items-baseline gap-1">
          <span className="num text-base">{r.rank}</span>
          <Movement value={r.movement} />
        </span>
      ),
    },
    {
      key: 'name', header: 'שחקן', primary: true,
      render: (r) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-bold">{r.displayName}</span>
          {r.userId === userId && (
            <span className="shrink-0 rounded bg-gold/20 px-1.5 py-0.5 text-[9px]
                             font-black text-gold">
              אתה
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'record', header: 'מאזן', numeric: true,
      render: (r) => (
        <span dir="ltr" className="num text-[13px] text-chalk-2">
          {r.record.wins}-{r.record.losses}
        </span>
      ),
    },
    {
      key: 'total', header: 'נק׳', primary: true, numeric: true, width: '3.5rem',
      render: (r) => <span className="num text-base text-gold">{r.totalPoints}</span>,
    },
  ];

  return (
    <>
      <InviteCard league={league} origin={origin} memberCount={members.length} />

      <div className="mt-3">
        <Table
          columns={columns}
          rows={rows}
          rowKey={(r) => r.userId}
          highlight={(r) => r.userId === userId}
          caption={`טבלת ${league.name}`}
          empty={
            <p className="px-4 py-8 text-center text-[13px] text-chalk-dim">
              עוד אין תוצאות. הטבלה תתמלא ברגע שהמחזור ינוקד.
            </p>
          }
        />
      </div>

      {!results.published && (
        <p className="mt-2.5 text-center text-[11.5px] text-chalk-dim">
          המחזור עוד לא נוקד. עד אז כולם באותו מקום.
        </p>
      )}
    </>
  );
}

/** חץ תנועה. `null` = אין מחזור קודם, ולכן אין מה להשוות. */
function Movement({ value }: { value: number | null }) {
  if (value === null || value === 0) return null;
  const up = value > 0;
  return (
    <span
      className={`text-[10px] font-black ${up ? 'text-tartan-green' : 'text-flare'}`}
      aria-label={up ? `עלה ${value}` : `ירד ${-value}`}
    >
      {up ? '▲' : '▼'}
      <span className="num">{Math.abs(value)}</span>
    </span>
  );
}

/**
 * כרטיס ההזמנה.
 *
 * ★ זה הכפתור הכי חשוב במסך. זירה עם חבר אחד היא לא זירה, ולכן
 *   ההעתקה חייבת להיות לחיצה אחת ובלי חשיבה. הקוד מוצג בגדול —
 *   הרבה אנשים פשוט מקריאים אותו בקול.
 */
function InviteCard({
  league, origin, memberCount,
}: {
  league: ReturnType<typeof myLeagues>[number];
  origin: string;
  memberCount: number;
}) {
  const [copied, setCopied] = useState(false);
  const url = inviteUrl(origin, league.code);

  const copy = async () => {
    const text = `בוא לזירה "${league.name}" בדוביד — קוד ${league.code}\n${url}`;
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ביטול שיתוף על ידי המשתמש הוא לא שגיאה — לא מציגים כלום.
    }
  };

  return (
    <div className="rounded-2xl border border-gold/15 bg-night-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-display text-lg font-black text-chalk">{league.name}</h2>
          <p className="text-[11px] text-chalk-dim">
            {MODE_LABEL[league.mode as 'full' | 'five']} ·{' '}
            <span className="num">{memberCount}</span> משתתפים
          </p>
        </div>
        <div className="shrink-0 text-end">
          <div className="text-[9px] uppercase tracking-[0.18em] text-chalk-dim">קוד</div>
          <div dir="ltr" className="num text-xl tracking-[0.18em] text-gold">{league.code}</div>
        </div>
      </div>

      <button
        onClick={copy}
        className="tap mt-3 h-11 w-full rounded-xl bg-night font-black text-[13px] text-chalk
                   transition-colors duration-200 ease-brand hover:bg-night-3"
      >
        {copied ? 'הועתק ✓' : 'לשלוח הזמנה'}
      </button>
    </div>
  );
}
