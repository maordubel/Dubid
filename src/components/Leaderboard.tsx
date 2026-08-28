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
import { GAMEWEEK } from '../data/fixtures.ts';
import { listEntries, getResults, subscribeToStore, type LineupEntry } from '../lib/store.ts';
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
  rulesByMode, userId,
}: {
  rulesByMode: Record<'full' | 'five', RuleSet>;
  /** מי אני — כדי להדגיש ולעגן את השורה שלי. */
  userId?: string;
}) {
  const [, tick] = useState(0);
  useEffect(() => subscribeToStore(() => tick((n) => n + 1)), []);
  const [mode, setMode] = useState<'full' | 'five'>('five');

  const entries = listEntries(GAMEWEEK.id, mode);
  const results = getResults(GAMEWEEK.id);
  const rules = rulesByMode[mode];

  const rows = useMemo<Row[]>(
    () => (results.published
      ? buildLeaderboard({
          entries, performances: results.performances, outcomes: results.outcomes, rules, userId,
        })
      : []),
    [entries, results, rules, userId],
  );

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

      {!results.published ? (
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
                  התוצאה שלך
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
            caption={`${MODE_LABEL[mode]} · ${rows.length} משתתפים`}
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
              />
            </>
          )}
        </>
      )}
      <OffsidesInline
        placement="leaderboard"
        gameweekNumber={GAMEWEEK.number}
        className="mt-6"
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
          הדירוג ייפתח עם פרסום התוצאות
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
