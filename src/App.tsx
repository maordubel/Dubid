/**
 * App.tsx — חיווט האפליקציה.
 *
 * מקור הדאטה כרגע הוא `src/data/squads.ts` (נוצר מקובץ הסגלים), כדי
 * שהאפליקציה תעלה על Vercel ותעבוד גם לפני שיש Supabase מחובר.
 * החלפה ל-API אמיתי = החלפת שני ה-hooks למטה, בלי לגעת בקומפוננטות.
 */
import { useMemo, useState, type ReactNode } from 'react';

import { AppShell, AppHeader } from './components/AppShell.tsx';
import type { NavItem } from './components/BottomNav.tsx';
import { SquadPicker, type PoolPlayer, type TeamMeta } from './components/SquadPicker.tsx';
import { ShareCard } from './components/ShareCard.tsx';

import { LEAGUE, TEAMS, PLAYERS, shortName } from './data/squads.ts';
import { resolveRules } from './lib/scoring/rules.ts';
import { scoreLineup } from './lib/scoring/engine.ts';
import { checkLeagueCapacity, formatIssue } from './lib/scoring/validate.ts';
import { useLineup } from './state/useLineup.ts';
import type { PlayerPerformance, TeamOutcome } from './lib/scoring/types.ts';
import type { ShareCardData } from './lib/shareCard.ts';

const SITE_URL = 'https://dubid.dubelteam.com';
const GAMEWEEK = { id: 'gw-7', label: 'מחזור 7' };
const USER = { id: 'demo-user', name: 'מאור' };

const NAV: NavItem[] = [
  { id: 'lineup', label: 'ההרכב', icon: '◎' },
  { id: 'card', label: 'הכרטיס', icon: '◐' },
  { id: 'rules', label: 'החוקים', icon: '⚑' },
];

export function App() {
  const [tab, setTab] = useState('lineup');

  /* ---- חוקים מותאמים לכמות הקבוצות שבפועל יש בדאטה ---- */
  const resolved = useMemo(() => resolveRules(TEAMS.length), []);
  const rules = resolved.rules;
  const formation = rules.constraints.formationAllowed[0];
  const capacityIssue = useMemo(
    () => checkLeagueCapacity(TEAMS.length, { ...rules, constraints: { ...rules.constraints, lineupSize: 11 } }),
    [rules],
  );

  const teams: TeamMeta[] = useMemo(
    () => TEAMS.map((t) => ({ id: t.id, short: t.short, name: t.nameHe })),
    [],
  );
  const pool: PoolPlayer[] = useMemo(
    () => PLAYERS.map((p) => ({
      id: p.id,
      teamId: p.teamId,
      position: p.position,
      name: p.nameHe,
      nameShort: shortName(p.nameHe),
    })),
    [],
  );

  const lu = useLineup(formation, rules, {
    lineupId: 'draft-1', userId: USER.id, gameweekId: GAMEWEEK.id,
  });

  const screens: Record<string, ReactNode> = {
    lineup: (
      <>
        {resolved.isDemo && capacityIssue && (
          <DemoBanner message={formatIssue(capacityIssue, 'he')} size={rules.constraints.lineupSize} />
        )}
        <SquadPicker
          lineup={lu.lineup}
          pool={pool}
          teams={teams}
          rules={rules}
          onAssign={(slotNo, player) => lu.assign(slotNo, player)}
          onClear={lu.clear}
          onCaptain={lu.setCaptain}
          onSubmit={() => setTab('card')}
        />
      </>
    ),
    card: <CardScreen lineup={lu.lineup} pool={pool} teams={teams} rules={rules} ready={lu.isComplete} />,
    rules: <RulesScreen />,
  };

  return (
    <AppShell
      items={NAV}
      activeId={tab}
      onSelect={setTab}
      header={
        <AppHeader
          title={GAMEWEEK.label}
          subtitle={
            <>
              {LEAGUE.nameHe} · נעילה בעוד{' '}
              <span className="num text-flare">02:14:38</span>
            </>
          }
          right={
            <div className="text-end">
              <div className="num text-2xl text-toto">
                {lu.filled}/{rules.constraints.lineupSize}
              </div>
              <div className="text-[11px] text-chalk-dim">שחקנים</div>
            </div>
          }
        />
      }
    >
      {screens[tab]}
    </AppShell>
  );
}

/* ================================================================== */

function DemoBanner({ message, size }: { message: string; size: number }) {
  return (
    <div
      role="status"
      className="mx-3 mt-3 rounded-2xl border border-armband/30 bg-armband/10 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-sm font-black text-armband">
        <span aria-hidden>▲</span> מצב הדגמה
      </div>
      <p className="mt-1 text-[13px] leading-snug text-chalk-2">
        {message} עד שיעלו הסגלים החסרים, ההרכב מוקטן ל-
        <span className="num">{size}</span> שחקנים — הכלל של שחקן אחד מכל קבוצה
        נשמר במלואו.
      </p>
    </div>
  );
}

/* ================================================================== */

function CardScreen({
  lineup, pool, teams, rules, ready,
}: {
  lineup: ReturnType<typeof useLineup>['lineup'];
  pool: PoolPlayer[];
  teams: TeamMeta[];
  rules: ReturnType<typeof resolveRules>['rules'];
  ready: boolean;
}) {
  const [showDemo, setShowDemo] = useState(false);

  const data: ShareCardData | null = useMemo(() => {
    if (!ready || !showDemo) return null;

    const { performances, outcomes } = demoGameweek(lineup);
    const score = scoreLineup(lineup, performances, outcomes, rules);

    const teamById = new Map(teams.map((t) => [t.id, t]));
    const poolById = new Map(pool.map((p) => [p.id, p]));

    return {
      gameweekLabel: GAMEWEEK.label,
      leagueLabel: LEAGUE.nameHe,
      userName: USER.name,
      totalPoints: score.totalPoints,
      rank: 3,
      totalPlayers: 128,
      breakdown: {
        personal: score.personalPoints,
        result: score.resultPoints,
        captain: score.captainPoints,
        virtual: score.virtualPoints,
      },
      url: `${SITE_URL}/c/GW7`,
      urlLabel: 'DUBID.DUBELTEAM.COM',
      lineup: score.players.map((p) => ({
        name: poolById.get(p.playerId)?.nameShort ?? p.playerId,
        teamShort: teamById.get(p.teamId)?.short ?? '',
        position: p.position,
        points: p.subtotal,
        isCaptain: p.isCaptain,
      })),
    };
  }, [ready, showDemo, lineup, pool, teams, rules]);

  if (data) return <ShareCard data={data} />;

  return (
    <div className="grid h-full place-items-center px-6 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-4 h-1 w-16 rounded-full bg-toto" />
        <h2 className="font-display text-2xl font-black">עוד אין תוצאות למחזור</h2>
        <p className="mt-2 text-sm text-chalk-dim">
          {ready
            ? 'הכרטיס ייווצר אוטומטית ברגע שהמחזור ייסגר והניקוד יחושב.'
            : 'קודם השלימו את ההרכב — הכרטיס נבנה ממנו.'}
        </p>
        {ready && (
          <button
            onClick={() => setShowDemo(true)}
            className="tap mt-6 rounded-full bg-toto px-6 font-poster text-lg text-night
                       transition-transform duration-200 ease-brand active:scale-[.98]"
          >
            הצג כרטיס לדוגמה
          </button>
        )}
        <p className="mt-3 text-[11px] text-chalk-dim">
          כרטיס לדוגמה מייצר תוצאות מחזור מומצאות כדי להראות איך זה נראה.
        </p>
      </div>
    </div>
  );
}

/**
 * מחולל מחזור לדוגמה. **הנתונים כאן מומצאים** ומשמשים רק לתצוגה
 * מקדימה של הכרטיס לפני שיש נתוני אמת. דטרמיניסטי לפי מזהה השחקן,
 * כדי שאותו הרכב ייתן תמיד את אותו כרטיס.
 */
function demoGameweek(lineup: ReturnType<typeof useLineup>['lineup']) {
  const hash = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  };

  const performances = new Map<string, PlayerPerformance>();
  const outcomes = new Map<string, TeamOutcome>();

  for (const slot of lineup.slots) {
    if (!slot.playerId) continue;
    const h = hash(slot.playerId);
    const goals = h % 7 === 0 ? 2 : h % 3 === 0 ? 1 : 0;
    const played = h % 11 !== 0;

    performances.set(slot.playerId, {
      playerId: slot.playerId,
      teamId: slot.teamId,
      position: slot.position,
      minutes: played ? 90 : 0,
      goals: played ? goals : 0,
      assists: played && h % 5 === 0 ? 1 : 0,
      ownGoals: 0,
      yellowCards: h % 8 === 0 ? 1 : 0,
      redCards: 0,
      saves: 0,
      penaltiesSaved: 0,
      penaltiesMissed: 0,
      goalsConceded: 0,
      cleanSheet: played && h % 4 === 0,
      played,
    });

    const tg = hash(slot.teamId);
    const result = tg % 3 === 0 ? 'W' : tg % 3 === 1 ? 'D' : 'L';
    outcomes.set(slot.teamId, {
      teamId: slot.teamId,
      result,
      goalsFor: result === 'W' ? 2 + (tg % 2) : result === 'D' ? 1 : 0,
      goalsAgainst: result === 'L' ? 1 + (tg % 2) : result === 'D' ? 1 : 0,
    });
  }

  return { performances, outcomes };
}

/* ================================================================== */

function RulesScreen() {
  const rows: Array<[string, string]> = [
    ['שער — שוער / מגן', '6'],
    ['שער — קשר', '5'],
    ['שער — חלוץ', '4'],
    ['בישול', '3'],
    ['שער נקי (60 דקות ומעלה)', '4'],
    ['כרטיס צהוב', '-1'],
    ['כרטיס אדום', '-3'],
    ['ניצחון של הקבוצה האמיתית', '+4'],
    ['תיקו של הקבוצה האמיתית', '+1'],
    ['כל 2 שערים של קבוצות ההרכב', '+5'],
  ];

  return (
    <div className="mx-auto max-w-2xl px-4 py-5">
      <section className="rounded-2xl border border-toto/30 bg-toto/10 p-4">
        <h2 className="font-display text-xl font-black text-toto">הכלל היחיד שחשוב</h2>
        <p className="mt-1 text-sm text-chalk-2">
          שחקן אחד מכל קבוצה. אי אפשר לקחת שניים ממכבי חיפה, גם לא ליום אחד.
        </p>
      </section>

      <h2 className="mt-6 font-display text-lg font-black">טבלת הניקוד</h2>
      <table className="mt-2 w-full text-sm">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-b border-chalk/10">
              <td className="py-2.5 text-start">{label}</td>
              <td className="num py-2.5 text-end text-toto">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mt-6 font-display text-lg font-black">הקפטן הדובידי</h2>
      <ul className="mt-2 space-y-2 text-sm text-chalk-2">
        <li>
          <b className="text-armband">×3</b> — הציון של הקפטן מוכפל פי שלוש,
          כולל בונוס התוצאה של הקבוצה שלו.
        </li>
        <li>
          <b className="text-armband">חסינות</b> — כרטיס צהוב של הקפטן מבוטל,
          אם שיחק 60 דקות ומעלה והקבוצה שלו לא הפסידה. אדום לא נסלח.
        </li>
        <li>
          <b className="text-armband">סגן</b> — אם הקפטן לא ירד למגרש,
          הכפולה עוברת אוטומטית לסגן.
        </li>
        <li>ציון שלילי לא מוכפל. ההימור מגדיל רווח, לא הפסד.</li>
      </ul>
    </div>
  );
}
