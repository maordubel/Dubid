/**
 * Leaderboard.tsx — דירוג חכמים.
 *
 * מה השתנה מהגרסה הקודמת, ולמה:
 *
 *  1. **דירוג דטרמיניסטי.** קודם המיון היה לפי ניקוד בלבד, ושני
 *     משתמשים עם אותו ציון קיבלו סדר שתלוי בסדר ההגשה במערך.
 *     עכשיו רצה היררכיית שוברי השוויון המלאה (`rankEntries`), והמסך
 *     גם *אומר* מה שבר את השוויון. הברִיף אוסר הכרעה אקראית.
 *
 *  2. **בונוס דיפרנציאל.** מחושב כאן ולא במנוע, כי הוא תלוי בכל
 *     ההגשות יחד ולא בהרכב בודד.
 *
 *  3. **המשתמש תמיד רואה את עצמו.** גם במקום 127 מתוך 400. זו
 *     דרישה מפורשת בברִיף, והיא ההבדל בין "לוח תוצאות" לבין
 *     "התחרות שלי".
 *
 *  4. **טבלה במקום רשימה.** אותו קומפוננט נותן כרטיסים במובייל
 *     וטבלה בדסקטופ (`Table.tsx`).
 *
 * שני מצבי המשחק חולקים תשתית אחת לגמרי — כל אחד רק עם ה-RuleSet
 * שלו, ולכן שני לוחות דירוג נפרדים. הברִיף אוסר למזג אותם.
 */
import { useMemo, useState, useEffect } from 'react';

import { buildLeaderboard, beatPercent, type LeaderboardRow } from '../lib/leaderboard.ts';
import type { TieBreakStage } from '../lib/scoring/ranking.ts';
import { TEAM_BY_ID } from '../data/squads.ts';
import { OffsidesInline, OffsidesRail } from './OffsidesAds.tsx';
import { HouseBanner } from './HouseAds.tsx';
import { GAMEWEEK } from '../data/fixtures.ts';
import { listEntries, getResults, subscribeToStore, scoringVisible, scoringIsLive,
         type LineupEntry } from '../lib/store.ts';
import { RivalLineup } from './RivalLineup.tsx';
import type { PoolPlayer, TeamMeta } from './SquadPicker.tsx';
import type { LineupScore } from '../lib/scoring/types.ts';
import type { RuleSet } from '../lib/scoring/rules.ts';
import { Table, type Column } from './Table.tsx';
import { modeTheme } from '../lib/modeTheme.ts';
import { NIGHT_PRESS as NP, MISREGISTER } from '../lib/pressPalette.ts';

const MODE_LABEL: Record<'full' | 'five', string> = { full: 'דוביד 11', five: 'דוביד 5' };

/** מה שבר את השוויון — בשפה שמסבירה, לא בקוד. */
const TIEBREAK_LABEL: Record<TieBreakStage, string> = {
  total:        '',
  captain:      'הוכרע לפי הקפטן',
  differential: 'הוכרע לפי בחירות נדירות',
  goals:        'הוכרע לפי שערים',
  assists:      'הוכרע לפי בישולים',
  clean_sheets: 'הוכרע לפי שערים נקיים',
  other:        'הוכרע לפי תרומה נוספת',
  submitted_at: 'הוכרע לפי זמן ההגשה',
};

type Row = LeaderboardRow<LineupEntry>;

export function Leaderboard({
  rulesByMode, userId, pool = [], teams = [],
}: {
  rulesByMode: Record<'full' | 'five', RuleSet>;
  /** מי אני — כדי להדגיש ולעגן את השורה שלי. */
  userId?: string;
  /**
   * ★ הסגל והקבוצות — כדי שאפשר יהיה לפתוח הרכב של יריב.
   *
   * מגיעים מ-`App` ולא נבנים כאן: הם כבר קיימים שם, ובנייה שנייה
   * שלהם הייתה מפה חדשה של 350 שחקנים בכל רינדור של הטבלה.
   * ברירת מחדל ריקה שומרת על תאימות לקורא שעדיין לא מעביר אותם.
   */
  pool?: PoolPlayer[];
  teams?: TeamMeta[];
}) {
  const [, tick] = useState(0);
  useEffect(() => subscribeToStore(() => tick((n) => n + 1)), []);
  const [mode, setMode] = useState<'full' | 'five'>('five');
  /** ההרכב שנפתח לצפייה. `null` = הטבלה. */
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);

  const entries = listEntries(GAMEWEEK.id, mode);
  const results = getResults(GAMEWEEK.id);
  const rules = rulesByMode[mode];

  /* ★★ השינוי המרכזי במסך הזה ★★

     הטבלה נבנתה עד עכשיו רק כש-`results.published`. כלומר: מרגע
     הנעילה ועד שהאדמין לחץ "סיום מחזור" — ארבעה ימים — היא הייתה
     ריקה, גם כשמשחקים שלמים כבר הסתיימו.

     `scoringVisible` פותח אותה ברגע שיש מספרים. `live` אומר
     שהמספרים עוד יכולים לזוז, וזה נאמר במפורש בפס שמעל הטבלה —
     דירוג שנראה סופי ומשתנה אחר כך הוא דירוג ששורף אמון. */
  const visible = scoringVisible(results);
  const live = scoringIsLive(results);

  const rows = useMemo<Row[]>(
    () => (visible
      ? buildLeaderboard({
          entries, performances: results.performances, outcomes: results.outcomes, rules, userId,
        })
      : []),
    [visible, entries, results, rules, userId],
  );

  /* ★ ההרכב הפתוח נגזר מהמזהה ולא נשמר כאובייקט.
     אילו שמרנו את השורה עצמה, רענון חי (וזה קורה כל 45 שניות)
     היה משאיר על המסך ניקוד מלפני שתי דקות בזמן שהטבלה מאחוריו
     כבר זזה. */
  const openRow = openEntryId ? rows.find((r) => r.entry.id === openEntryId) ?? null : null;
  const myRow = rows.find((r) => r.isMe) ?? null;
  const canOpen = (r: Row) => !r.entry.hidden && r.entry.lineup.slots.length > 0;

  const me = rows.find((r) => r.isMe);
  // ★ אם אני מחוץ ל-20 הראשונים, אני עדיין רואה את עצמי — מעוגן בנפרד.
  const top = rows.slice(0, 20);
  const meOutsideTop = me && !top.some((r) => r.isMe) ? me : null;

  const columns: Column<Row>[] = [
    {
      key: 'rank',
      header: '#',
      width: '3.5rem',
      primary: true,
      render: (r) => <RankBadge rank={r.rank} tied={r.tied} />,
    },
    {
      key: 'name',
      header: 'שחקן',
      primary: true,
      render: (r) => (
        <div className="min-w-0">
          {/* ★ שם הקבוצה בשורה הראשונה ושם המאמן מתחתיו.
              טבלה של שמות פרטיים היא רשימת אנשים; טבלה של שמות
              קבוצות היא ליגה. כשאין שם קבוצה, שם המאמן עולה
              לשורה הראשונה — שורה ריקה גרועה משתי שורות. */}
          <div className="font-press truncate text-[15px] font-black text-chalk">
            {r.entry.teamName || r.entry.displayName}
            {r.isMe && (
              <span className="ms-1.5 rounded bg-gold px-1.5 py-px text-[10px] font-black text-night">
                אני
              </span>
            )}
            {r.entry.isBot && <BotTag />}
          </div>
          <div className="truncate text-[11px] text-chalk-dim">
            {r.entry.teamName ? `${r.entry.displayName} · ` : ''}
            {captainLabel(r.score)}
            {r.tied && r.brokenBy && r.brokenBy !== 'total'
              ? ` · ${TIEBREAK_LABEL[r.brokenBy]}`
              : ''}
          </div>
        </div>
      ),
    },
    {
      key: 'captain',
      header: 'קפטן',
      primary: false,
      numeric: true,
      width: '4.5rem',
      render: (r) => <span className="text-chalk-dim">{r.score.captainPoints}</span>,
    },
    {
      key: 'diff',
      header: 'נדיר',
      primary: false,
      numeric: true,
      width: '4.5rem',
      render: (r) =>
        (r.score.differentialPoints ?? 0) > 0 ? (
          <span className="text-tekhelet">+{r.score.differentialPoints}</span>
        ) : (
          <span className="text-chalk-dim">—</span>
        ),
    },
    {
      key: 'total',
      header: 'נק׳',
      primary: true,
      numeric: true,
      width: '4.5rem',
      render: (r) => (
        <span className="text-lg font-black text-gold">{r.score.totalPoints}</span>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-5">
      {/* ★ כותרת מדור, כמו בעמוד פנימי של עיתון: קו כפול מעל,
          קו דק מתחת, ותת-כותרת בשורת פוליו. אותה שפה כמו הלובי
          ולא "כותרת של אפליקציה". */}
      <header className="mb-4">
        <div aria-hidden="true"
             style={{ borderTop: `3px solid ${NP.ruleStrong}`, borderBottom: `1px solid ${NP.rule}`, height: 4 }} />
        <div className="flex items-baseline justify-between gap-3 py-2">
          <h2 className="font-press text-[26px] font-black leading-none"
              style={{ color: NP.ink, textShadow: MISREGISTER }}>
            דירוג חכמים
          </h2>
          <span className="press-folio">
            {GAMEWEEK.label} · <span className="num">{entries.length}</span> הרכבים
          </span>
        </div>
        <div aria-hidden="true" style={{ borderTop: `1px solid ${NP.rule}` }} />
      </header>

      <div className="mb-4 flex gap-2">
        {(['five', 'full'] as const).map((m) => {
          const on = mode === m;
          const mt = modeTheme(m);
          return (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="font-press tap flex-1 py-1.5 text-[14px] font-black transition-colors
                         duration-200 ease-brand"
              style={on
                ? { background: mt.accent, color: NP.paper }
                : { border: `1px solid ${NP.rule}`, color: NP.inkFaint }}
            >
              {MODE_LABEL[m]}
            </button>
          );
        })}
      </div>

      {/* ★ פס "חי" — מעל הטבלה, ורק כשהיא באמת זזה. */}
      {visible && live && <LiveBar updatedAt={results.updatedAt}
                                   done={results.fixturesFinal}
                                   total={results.fixturesTotal} />}

      {!visible ? (
        /*
         * ★★ מה שהיה כאן, ולמה זה פגע ★★
         *
         * מסך אחד שאומר "הדירוג ייפתח כשהמחזור יסתיים". נכון,
         * ריק, וחסר תועלת: משתמש שהגיש ובא לבדוק מה קורה ראה
         * הודעה ולא ראה **אף אחד**. מחזור שנראה ריק אינו תחרות,
         * וזה בדיוק הרגע שבו הוא מפסיק לחכות לו.
         *
         * עכשיו הוא רואה את כל מי שכבר בפנים. ההרכבים עצמם
         * מוסתרים בשרת (`game.entries` מחזירה `hidden` ו-
         * `slots: []` לפני הנעילה), ולכן אי אפשר להעתיק בחירות
         * דקה לפני הסגירה — וזה בדיוק האיזון הנכון.
         */
        <ParticipantList entries={entries} userId={userId} mode={mode} />
      ) : (
        <>
          {/* ★ הכרטיס שלי — לפני הטבלה, תמיד נראה */}
          {me && (
            <div className="mb-3 flex items-center gap-3 rounded-2xl border border-gold/40
                            bg-gold/10 px-4 py-3">
              <RankBadge rank={me.rank} tied={me.tied} />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-black uppercase tracking-wide text-gold">
                  {live ? 'התוצאה שלך · חי' : 'התוצאה שלך'}
                </div>
                <div className="truncate text-sm font-bold text-chalk">
                  ניצחת {beatPercent(me.rank, rows.length)}% מהשחקנים
                </div>
              </div>
              <div className="num text-2xl font-black text-gold" dir="ltr">
                {me.score.totalPoints}
              </div>
            </div>
          )}

          <Table
            columns={columns}
            rows={top}
            rowKey={(r) => r.entry.id}
            highlight={(r) => r.isMe}
            onRowClick={(r) => { if (canOpen(r)) setOpenEntryId(r.entry.id); }}
            caption={`${MODE_LABEL[mode]} · ${rows.length} משתתפים · הקישו על שורה לראות את ההרכב`}
            empty={`עדיין אין הרכבים מוגשים ב"${MODE_LABEL[mode]}".`}
          />

          {/* ★ מתחת לטבלה ולא מעליה.
              מי שפתח דירוג בא לראות מספר אחד: שלו. שורת פרסום
              מעל הטבלה דוחפת אותו מטה בדיוק ברגע שהוא מחפש. */}
          {meOutsideTop && (
            <>
              <div className="py-2 text-center text-chalk-dim" aria-hidden="true">⋯</div>
              <Table
                columns={columns}
                rows={[meOutsideTop]}
                rowKey={(r) => r.entry.id}
                highlight={() => true}
                onRowClick={(r) => { if (canOpen(r)) setOpenEntryId(r.entry.id); }}
              />
            </>
          )}
        </>
      )}
      {/* ★ ההרכב של מי שנלחץ. מסך מלא ולא מודל קטן: מגרש בתוך
          חלון של 300 פיקסלים אינו מגרש. */}
      {openRow && (
        <RivalLineup
          entry={openRow.entry}
          score={openRow.score}
          rank={openRow.rank}
          live={live}
          mine={myRow && myRow.entry.id !== openRow.entry.id ? myRow.entry : undefined}
          mineScore={myRow && myRow.entry.id !== openRow.entry.id ? myRow.score : undefined}
          pool={pool}
          teams={teams}
          mode={mode}
          onClose={() => setOpenEntryId(null)}
        />
      )}

      {/* ★ הטבלה היא המסך שנקרא הכי לאט — המשתמש מחפש את עצמו
          ברשימה. רצועה מלאה כאן נקראת, ולכן היא כאן ולא שורה. */}
      <HouseBanner
        placement="leaderboard"
        gameweekNumber={GAMEWEEK.number}
        className="mt-6"
      />
      <OffsidesInline
        placement="leaderboard"
        gameweekNumber={GAMEWEEK.number}
        className="mt-4"
      />
      <OffsidesRail
        placement="leaderboard"
        gameweekNumber={GAMEWEEK.number}
        className="mt-3"
      />
    </div>
  );
}

/**
 * ★ תג הבוט.
 *
 * בוטים הם כלי מוצר לגיטימי — מחזור ראשון עם שני משתתפים אינו
 * תחרות. הם לגיטימיים **בתנאי אחד**: שהם מסומנים. הדגל מגיע
 * מהשרת (`game.users.is_bot`), והמסך רק מציג אותו. הסתרה כאן
 * הייתה הופכת כלי לגיטימי להטעיה.
 */
/**
 * פס ה"חי".
 *
 * ★ שלוש עובדות ולא אחת
 *
 * "חי" לבד הוא הבטחה בלי כיסוי. מה שהופך אותו לאמין הוא מה
 * שלידו: כמה משחקים כבר נגמרו מתוך כמה, ומתי היה העדכון האחרון.
 * משתמש שרואה "3 מתוך 7 · עודכן לפני 4 דקות" יודע בדיוק כמה
 * מהתמונה בידו — ולכן הוא גם יודע מתי כדאי לו לחזור.
 *
 * ★ `updatedAt` יכול להיות ריק, ואז לא ממציאים זמן. "טרם נכנסו
 *   תוצאות" הוא מידע; "עודכן לפני 0 דקות" הוא שקר קטן שמלמד
 *   לא להאמין לשורה.
 */
function LiveBar({
  updatedAt, done, total,
}: { updatedAt: string | null; done: number; total: number }) {
  const [, tick] = useState(0);
  // דקה. הפס מדבר בדקות, ולכן אין טעם לרנדר אותו כל שנייה.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      role="status"
      className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2"
      style={{ border: `1px solid ${NP.rule}`, background: NP.card }}
    >
      <span className="inline-flex items-center gap-1.5 text-[11.5px] font-black"
            style={{ color: NP.goldLight }}>
        <span aria-hidden="true"
              className="inline-block size-[7px] animate-pulse rounded-full"
              style={{ background: NP.goldLight }} />
        המחזור חי
      </span>

      <span className="text-[11.5px]" style={{ color: NP.inkDim }}>
        · הדירוג מתעדכן מעצמו עם כל משחק
      </span>

      {total > 0 && (
        <span className="text-[11.5px]" style={{ color: NP.inkFaint }}>
          · <span className="num">{done}</span>/<span className="num">{total}</span> משחקים הסתיימו
        </span>
      )}

      <span className="ms-auto text-[11px]" style={{ color: NP.inkFaint }}>
        {updatedAt ? `עודכן ${sinceLabel(updatedAt)}` : 'טרם נכנסו תוצאות'}
      </span>
    </div>
  );
}

/** "לפני 4 דקות" / "לפני שעתיים". בלי ספריית תאריכים. */
function sinceLabel(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return 'עכשיו';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'עכשיו';
  if (min === 1) return 'לפני דקה';
  if (min < 60) return `לפני ${min} דקות`;
  const h = Math.floor(min / 60);
  if (h === 1) return 'לפני שעה';
  if (h === 2) return 'לפני שעתיים';
  if (h < 24) return `לפני ${h} שעות`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'אתמול' : `לפני ${d} ימים`;
}

function BotTag() {
  return (
    <span className="ms-1.5 rounded px-1.5 py-px text-[9.5px] font-black"
          style={{ background: 'rgba(216,178,92,.18)', color: '#D8B25C' }}>
      בוט
    </span>
  );
}

/**
 * רשימת המשתתפים — לפני שיש תוצאות.
 *
 * ★ למה זו לא טבלה
 *
 * טבלה בלי מספרים מזמינה את העין לחפש עמודה שאין. כאן אין מה
 * לדרג עדיין, ולכן זו **רשימה** לפי סדר ההגשה — וסדר ההגשה
 * הוא בדיוק מה שמעניין ברגע הזה: מי הספיק.
 */
export function ParticipantList({
  entries, userId, mode,
}: { entries: LineupEntry[]; userId?: string; mode: 'full' | 'five' }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-2xl border border-gold/15 bg-night-2 px-4 py-8 text-center">
        <div className="mx-auto mb-3 h-1 w-12 rounded-full bg-gold" />
        <p className="font-bold text-chalk">אף אחד עוד לא הגיש</p>
        <p className="mt-1 text-sm text-chalk-dim">
          תהיה הראשון ב{MODE_LABEL[mode]} — השם שלך יופיע כאן מיד.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-gold/15 bg-night-2">
      <div className="flex items-baseline justify-between border-b border-gold/15 px-4 py-2.5">
        <span className="text-[11px] font-black tracking-[2px] text-gold">
          כבר בפנים
        </span>
        <span className="text-[11px] text-chalk-dim">
          {/* ★ ההבטחה הישנה ("עם פרסום התוצאות") שלחה אנשים
              לחכות ליום ראשון. הדירוג נפתח בנעילה. */}
          הדירוג נפתח עם נעילת ההרכבים
        </span>
      </div>
      <ul>
        {entries.map((e, i) => {
          const isMe = !!userId && e.userId === userId;
          return (
            <li
              key={e.id}
              className={`flex items-center gap-3 border-b border-gold/10 px-4 py-2.5 last:border-0
                          ${isMe ? 'bg-gold/10' : ''}`}
            >
              <span className="num w-6 shrink-0 text-[12px] text-chalk-dim">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="font-press block truncate text-[15px] font-black text-chalk">
                  {e.teamName || e.displayName}
                  {isMe && (
                    <span className="ms-1.5 rounded bg-gold px-1.5 py-px text-[10px]
                                     font-black text-night">אני</span>
                  )}
                  {e.isBot && <BotTag />}
                </span>
                {e.teamName && (
                  <span className="block truncate text-[11px] text-chalk-dim">
                    {e.displayName}
                  </span>
                )}
              </span>
              {/* ★ "מוכן" ולא ניקוד. אין עדיין ניקוד, ומספר מומצא
                  ברגע הזה היה הופך רשימה כנה לטבלה משקרת. */}
              <span className="shrink-0 text-[11px] font-bold text-chalk-dim">
                {e.hidden ? 'ההרכב סגור' : 'ההרכב שלך'}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RankBadge({ rank, tied }: { rank: number; tied: boolean }) {
  return (
    <div
      title={tied ? 'שוויון' : undefined}
      className={`num flex h-8 w-8 shrink-0 items-center justify-center rounded-full
                  text-sm font-black ${
                    rank === 1
                      ? 'bg-armband text-night'
                      : rank <= 3
                        ? 'bg-gold text-night'
                        : 'bg-chalk/10 text-chalk-dim'
                  }`}
    >
      {rank}
      {tied && <span className="ms-px text-[9px]">=</span>}
    </div>
  );
}

function captainLabel(score: LineupScore): string {
  const c = score.players.find((p) => p.isCaptain);
  return c ? `קפטן: ${TEAM_BY_ID.get(c.teamId)?.short ?? ''} · ${c.subtotal}` : '';
}
