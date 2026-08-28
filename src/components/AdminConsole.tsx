/**
 * components/AdminConsole.tsx — הלוח שמשחרר מהקוד.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ ארבע לשוניות, וכל אחת מחליפה משהו שהיה דורש פריסה
 * ═══════════════════════════════════════════════════════════════
 *
 *   מחזורים  →  פתיחת מחזור, קליטת לוח, והחלפת המחזור הפעיל
 *   חוקים    →  איזון ניקוד, עם היסטוריה
 *   תוכן     →  כל מחרוזת שיווקית במוצר
 *   ניתוח    →  מי משחק, מה בוחרים, ומי חוזר
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ העיקרון שחוזר בכל אחת מהן
 * ═══════════════════════════════════════════════════════════════
 *
 * **כל פעולה מסתיימת במשוב שאומר מה קרה בפועל.** לא "נשמר" —
 * אלא "נקלטו 7 משחקים, הדדליין נקבע לשבת 20:00, שתי שורות
 * נדחו". התלונה שהולידה את כל הסבב הזה הייתה "זה לא שומר
 * ומשנה באמת", והיא נבעה בדיוק מזה: פעולות שהצליחו ולא הראו
 * שום דבר.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  gameweeksList, adminCreateGameweek, adminSetCurrentGameweek, adminDeleteGameweek,
  adminImportFixtures, adminSetRule, adminClearRule,
  adminContentList, adminSetContent, adminDeleteContent,
  adminAnalytics, adminDataQuality, adminAudit,
  adminAddBots, adminRemoveBots, adminActivity, adminActivityStats,
  adminAds, adminUpsertAd, adminSetAdEnabled, adminDeleteAd, adminAdStats,
  adminLeads, adminFunnel, adminDaily, adminLeadsCsv,
  errorMessageHe,
  type GameweekRow, type ImportReport, type ContentRow,
  type BotResult, type ActivityRow, type ActivityStats,
  type Analytics, type DataIssue, type AuditRow,
  type AdminAd, type AdStats, type LeadRow, type Funnel, type DailyRow,
} from '../lib/store.ts';
import { adIssues, BRANDS, BRAND_IDS, type HouseAd } from '../lib/houseAds.ts';
import { googleCallbackUrl, offsidesCallbackUrl } from '../lib/identity.ts';
import type { Placement } from '../lib/growth.ts';
import { BrandWord, HouseAdPreview } from './HouseAds.tsx';
import { ruleOverrides, currentGameweekCode, liveDataVersion } from '../lib/liveData.ts';
import { RULE_KEYS, readRule } from '../lib/ruleOverrides.ts';
import { CONTENT_KEYS } from '../lib/content.ts';
import { resolveRules, DUBID_5X5 } from '../lib/scoring/rules.ts';
import { TEAMS } from '../data/squads.ts';
import { GAMEWEEK, leagueLocalToIso } from '../data/fixtures.ts';

/* ================================================================== */
/* עזרים משותפים                                                       */
/* ================================================================== */

/**
 * ★ הוק אחד לכל פעולה כותבת.
 *
 * חמישה מסכים שכל אחד מנהל `busy` / `error` / `message` בעצמו הם
 * חמישה מקומות לשכוח לכבות ספינר. כאן: מקום אחד, וכל פעולה
 * מסתיימת בהודעה — גם כשהיא הצליחה.
 */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  /**
   * ★ מונה, ולא ההודעה, הוא מה שמפעיל רענון.
   *
   * הרשימות למטה האזינו ל-`[act.msg, act.bad]`. פעולה שחוזרת
   * על עצמה מייצרת את **אותה מחרוזת**, React מדלג על עדכון
   * המצב, ה-effect לא רץ, והרשימה לא נטענת מחדש — כלומר
   * שמירה שנייה של אותו ערך השאירה את התג "טיוטה/מוצג" ישן.
   *
   * מונה שעולה תמיד לא יכול להיתקע ככה.
   */
  const [done, setDone] = useState(0);

  const run = (fn: () => Promise<string | void>) => {
    setBusy(true);
    setMsg(null);
    setBad(false);
    void fn()
      .then((ok) => { setMsg(typeof ok === 'string' ? ok : 'נשמר'); setBad(false); })
      .catch((e: unknown) => {
        setMsg(errorMessageHe(e instanceof Error ? e.message : 'NETWORK'));
        setBad(true);
      })
      .finally(() => { setBusy(false); setDone((n) => n + 1); });
  };

  return { busy, msg, bad, done, run, clear: () => setMsg(null) };
}

function Note({ msg, bad }: { msg: string | null; bad: boolean }) {
  if (!msg) return null;
  return (
    <p
      role={bad ? 'alert' : 'status'}
      className={`mt-3 rounded-xl border px-3 py-2 text-[12.5px] leading-snug ${
        bad ? 'border-flare/40 bg-flare/10 text-flare'
            : 'border-gold/30 bg-gold/5 text-chalk-2'}`}
    >
      {msg}
    </p>
  );
}

function Card({ title, hint, children }: {
  title: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-gold/15 bg-night-2 p-4">
      <h3 className="text-sm font-black text-chalk">{title}</h3>
      {hint && <p className="mb-3 mt-1 text-[11.5px] leading-snug text-chalk-dim">{hint}</p>}
      {!hint && <div className="mb-3" />}
      {children}
    </section>
  );
}

const input =
  'w-full rounded-lg border border-gold/25 bg-night px-2.5 py-2 text-[13px] ' +
  'text-chalk outline-none focus:border-gold disabled:opacity-50';
const primary =
  'tap shrink-0 rounded-lg bg-gradient-to-b from-gold-light to-gold px-4 ' +
  'text-[12.5px] font-black text-gold-ink disabled:opacity-40';
const ghost =
  'tap shrink-0 rounded-lg border border-gold/25 px-3 py-1.5 text-[11.5px] ' +
  'font-bold text-chalk-2 disabled:opacity-35';

/* ================================================================== */
/* 1 · מחזורים                                                         */
/* ================================================================== */

export function AdminGameweeks() {
  const [rows, setRows] = useState<GameweekRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const act = useAction();

  const load = () => {
    gameweeksList()
      .then((r) => { setRows(r); setErr(null); })
      .catch((e: unknown) =>
        setErr(errorMessageHe(e instanceof Error ? e.message : 'NETWORK')));
  };
  useEffect(load, []);
  useEffect(() => { if (act.done && !act.bad) load(); }, [act.done, act.bad]);

  const next = useMemo(
    () => (rows?.length ? Math.max(...rows.map((r) => r.number)) + 1 : 1), [rows]);

  return (
    <div className="space-y-4">
      <NewGameweek next={next} act={act} />
      <ImportFixtures rows={rows} act={act} />

      <Card
        title="כל המחזורים"
        hint="הכוכב מסמן את המחזור שכל המשתמשים רואים כרגע."
      >
        {err && <p className="text-[12px] text-flare">{err}</p>}
        {!rows && !err && <p className="text-[12px] text-chalk-dim">טוען…</p>}

        <div className="space-y-2">
          {rows?.map((g) => (
            <div
              key={g.code}
              className={`rounded-xl border px-3 py-2.5 ${
                g.isCurrent ? 'border-gold/50 bg-gold/5' : 'border-gold/12 bg-night'}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-poster text-[15px] text-chalk">
                  {g.isCurrent && <span className="text-gold">★ </span>}
                  {g.label}
                </span>
                <span className="num text-[11px] text-chalk-dim">{g.code}</span>
                <span className="rounded-full bg-night-3 px-2 py-0.5 text-[10px] text-chalk-2">
                  {g.status}
                </span>
                {g.published && (
                  <span className="rounded-full bg-gold px-2 py-0.5 text-[10px]
                                   font-black text-gold-ink">פורסם</span>
                )}
              </div>

              <p className="mt-1 text-[11px] text-chalk-dim">
                <span className="num">{g.fixtures}</span> משחקים ·{' '}
                <span className="num">{g.entries}</span> הגשות ·{' '}
                נעילה <span className="num">{fmt(g.lockAt)}</span>
              </p>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {!g.isCurrent && (
                  <button
                    disabled={act.busy}
                    className={ghost}
                    onClick={() => act.run(async () => {
                      await adminSetCurrentGameweek(g.code);
                      return `${g.label} הוא עכשיו המחזור הפעיל. כל המשתמשים רואים אותו.`;
                    })}
                  >
                    הפוך לפעיל
                  </button>
                )}
                {/* ★ מחיקה מוצעת רק כשהיא אפשרית. כפתור שתמיד
                    נכשל הוא כפתור שמלמד לא לסמוך על המסך. */}
                {!g.isCurrent && g.entries === 0 && (
                  <button
                    disabled={act.busy}
                    className={`${ghost} border-flare/30 text-flare`}
                    onClick={() => {
                      if (!window.confirm(`למחוק את ${g.label}?`)) return;
                      act.run(async () => {
                        await adminDeleteGameweek(g.code);
                        return `${g.label} נמחק.`;
                      });
                    }}
                  >
                    מחיקה
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <Note msg={act.msg} bad={act.bad} />
      </Card>
    </div>
  );
}

function NewGameweek({ next, act }: { next: number; act: ReturnType<typeof useAction> }) {
  const [number, setNumber] = useState(next);
  const [label, setLabel] = useState('');
  const touched = useRef(false);

  useEffect(() => { if (!touched.current) setNumber(next); }, [next]);

  return (
    <Card
      title="מחזור חדש"
      hint="המזהה נגזר מהמספר (gw-3). הדדליין נקבע אוטומטית מהמשחק המוקדם ביותר, אחרי שקולטים לוח."
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number" min={1} max={60}
          value={number}
          disabled={act.busy}
          onChange={(e) => { touched.current = true; setNumber(Number(e.target.value)); }}
          className={`num w-20 text-center ${input}`}
        />
        <input
          value={label}
          disabled={act.busy}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={`מחזור ${number}`}
          className={`min-w-0 flex-1 ${input}`}
        />
        <button
          disabled={act.busy || !number}
          className={`${primary} py-2`}
          onClick={() => act.run(async () => {
            const r = await adminCreateGameweek({ number, label });
            setLabel('');
            return `${r.code} נוצר. השלב הבא: לקלוט לו לוח משחקים.`;
          })}
        >
          יצירה
        </button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */

export interface DraftFixture { home: string; away: string; kickoff: string }

/**
 * ★ למה בורר ולא רק הדבקה.
 *
 * `"home":"3"` הוא מזהה חיצוני. מי שמקליד אותו ביד צריך לזכור
 * ש-3 היא מכבי תל אביב — וטעות של ספרה אחת יוצרת מחזור שבו
 * הקבוצה הלא נכונה משחקת, בלי שום שגיאה: המבנה תקין.
 *
 * הבורר הופך את זה לבלתי אפשרי. הוא גם אוכף שני כללים שהמסד
 * לא יכול לאכוף לבדו:
 *
 *   1. קבוצה לא משחקת נגד עצמה.
 *   2. קבוצה מופיעה **פעם אחת** במחזור. זו לא קפריזה: חוק
 *      הליבה של המשחק הוא שחקן אחד מכל קבוצה, ולכן קבוצה
 *      שמופיעה פעמיים במחזור שוברת את ההיגיון של הבחירה.
 *
 * ההדבקה נשארת, בלי שינוי, בלשונית שנייה — היא הנתיב של ה-API.
 */
function FixturePicker({
  list, onChange, disabled,
}: {
  list: DraftFixture[];
  onChange: (next: DraftFixture[]) => void;
  disabled: boolean;
}) {
  const [home, setHome] = useState('');
  const [away, setAway] = useState('');
  const [when, setWhen] = useState('');

  const used = useMemo(() => {
    const set = new Set<string>();
    for (const f of list) { set.add(f.home); set.add(f.away); }
    return set;
  }, [list]);

  const nameOf = (ext: string) =>
    TEAMS.find((t) => t.externalId === ext)?.nameHe ?? ext;

  const problem =
    !home || !away ? 'בחר שתי קבוצות'
      : home === away ? 'קבוצה לא משחקת נגד עצמה'
        : used.has(home) ? `${nameOf(home)} כבר משחקת במחזור`
          : used.has(away) ? `${nameOf(away)} כבר משחקת במחזור`
            : !when ? 'בחר תאריך ושעת פתיחה'
              : '';

  const add = () => {
    if (problem) return;
    onChange([...list, { home, away, kickoff: leagueLocalToIso(when) }]);
    setHome(''); setAway('');
    /* ★ השעה **לא** מתאפסת: רוב המשחקים במחזור באותו יום,
       ולעיתים קרובות באותה שעה. איפוס היה מכריח לבחור תאריך
       מחדש שבע פעמים ברצף. */
  };

  const teamOptions = (exclude: string) => TEAMS.map((t) => (
    <option
      key={t.id}
      value={t.externalId}
      disabled={t.externalId === exclude || used.has(t.externalId)}
    >
      {t.nameHe} ({t.short}){used.has(t.externalId) ? ' — כבר במחזור' : ''}
    </option>
  ));

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-chalk-dim">
          מארחת
          <select
            value={home}
            disabled={disabled}
            onChange={(e) => setHome(e.target.value)}
            className={`mt-1 ${input}`}
          >
            <option value="">— בחר —</option>
            {teamOptions(away)}
          </select>
        </label>

        <label className="text-[11px] text-chalk-dim">
          אורחת
          <select
            value={away}
            disabled={disabled}
            onChange={(e) => setAway(e.target.value)}
            className={`mt-1 ${input}`}
          >
            <option value="">— בחר —</option>
            {teamOptions(home)}
          </select>
        </label>
      </div>

      <label className="mt-2 block text-[11px] text-chalk-dim">
        פתיחה (שעון ישראל)
        <input
          type="datetime-local"
          value={when}
          disabled={disabled}
          onChange={(e) => setWhen(e.target.value)}
          className={`num mt-1 ${input}`}
        />
      </label>

      <div className="mt-2 flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={disabled || !!problem}
          onClick={add}
          className={`${primary} py-2`}
        >
          הוספת משחק
        </button>
        {problem && <span className="text-[11px] text-chalk-dim">{problem}</span>}
      </div>

      {list.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {list.map((f, i) => (
            <li
              key={`${f.home}-${f.away}-${i}`}
              className="flex items-center gap-2 rounded-xl border border-gold/15 px-2.5 py-1.5"
            >
              <span className="num shrink-0 text-[11px] text-chalk-dim">{i + 1}.</span>
              <span className="flex-1 text-[12.5px]">
                {nameOf(f.home)} <span className="text-chalk-dim">—</span> {nameOf(f.away)}
              </span>
              <span className="num text-[11px] text-chalk-dim">{fmt(f.kickoff)}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(list.filter((_, j) => j !== i))}
                className="tap text-[11px] text-flare"
                aria-label="הסרה"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* ★ כיסוי, לא רק ספירה.
          "6 משחקים" נראה תקין; "12 מתוך 14 קבוצות" מגלה שנשכחו
          שתיים — וזו בדיוק הטעות שמגיעה למחזור חי. */}
      <p className="mt-2 text-[11px] text-chalk-dim">
        <span className="num">{list.length}</span> משחקים ·{' '}
        <span className="num">{used.size}</span> מתוך{' '}
        <span className="num">{TEAMS.length}</span> קבוצות
        {used.size < TEAMS.length && (
          <span className="text-chalk-2">
            {' '}— חסרות: {TEAMS.filter((t) => !used.has(t.externalId))
              .map((t) => t.short).join(', ')}
          </span>
        )}
      </p>
    </div>
  );
}

/**
 * ★ תיבת ההדבקה — זה מה שהופך "ידני היום, API מחר" לאמיתי.
 *
 * הפונקציה בשרת מקבלת מבנה **מנורמל**, ולא את מה שספק מסוים
 * מחזיר. היום מי שמנרמל הוא אתה, עם הדבקה; מחר זו פונקציית
 * שרת שמדברת עם API-Football. **נתיב הכניסה זהה**, ולכן היום
 * שבו הספק מתחבר לא ידרוש לכתוב את זה מחדש.
 */
function ImportFixtures({
  rows, act,
}: { rows: GameweekRow[] | null; act: ReturnType<typeof useAction> }) {
  const current = currentGameweekCode() || GAMEWEEK.id;
  const [target, setTarget] = useState(current);
  const [raw, setRaw] = useState('');
  const [replace, setReplace] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  /* ★ 'pick' היא ברירת המחדל, ו-'json' נשארת במקומה המלא.
     ההדבקה היא נתיב ה-API; הבורר הוא הנתיב האנושי. אף אחד
     מהם לא מחליף את השני. */
  const [how, setHow] = useState<'pick' | 'json'>('pick');
  const [picked, setPicked] = useState<DraftFixture[]>([]);

  useEffect(() => { setTarget(current); }, [current]);

  /* ★ החלפת מחזור מנקה את הטיוטה.
     בלי זה, לוח שנבנה למחזור 3 היה נקלט למחזור 4 בלחיצה אחת,
     בלי שום אזהרה — כי המבנה תקין לשניהם. */
  useEffect(() => { setPicked([]); setReport(null); }, [target]);

  const teamHelp = useMemo(
    () => TEAMS.map((t) => `${t.externalId} = ${t.nameHe}`).join(' · '), []);

  const send = (list: Array<{ home: string; away: string; kickoff: string }>) => {
    act.run(async () => {
      const r = await adminImportFixtures(target, list, replace);
      setReport(r);
      const bits = [`נקלטו ${r.added + r.updated} מתוך ${r.received}`];
      if (r.removed) bits.push(`${r.removed} הוסרו`);
      if (r.lockAt) bits.push(`הדדליין: ${fmt(r.lockAt)}`);
      if (r.problems.length) bits.push(`${r.problems.length} שורות נדחו`);
      /* ★ טיוטה שנקלטה נמחקת. אחרת לחיצה שנייה בטעות הייתה
         שולחת את אותו לוח פעם נוספת — היא אמנם אידמפוטנטית
         בשרת, אבל המסך היה נראה כאילו כלום לא קרה. */
      if (!r.problems.length) setPicked([]);
      return bits.join(' · ');
    });
  };

  const submit = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      /* ★ הודעה שאומרת מה לא בסדר, לא "שגיאה". */
      act.run(async () => { throw new Error('BAD_JSON'); });
      return;
    }
    if (!Array.isArray(parsed)) {
      act.run(async () => { throw new Error('BAD_JSON'); });
      return;
    }
    send(parsed as Array<{ home: string; away: string; kickoff: string }>);
  };

  return (
    <Card
      title="קליטת לוח משחקים"
      hint="בחר קבוצות מהרשימה, או הדבק JSON. שני הנתיבים מגיעים לאותה
            פונקציה בשרת — היום ידני, מחר API."
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <select
          value={target}
          disabled={act.busy}
          onChange={(e) => setTarget(e.target.value)}
          className={`w-auto ${input}`}
        >
          {(rows ?? []).map((g) => (
            <option key={g.code} value={g.code}>{g.label} ({g.code})</option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 text-[11.5px] text-chalk-2">
          <input
            type="checkbox"
            checked={replace}
            disabled={act.busy}
            onChange={(e) => setReplace(e.target.checked)}
            className="size-4 accent-[#D8B25C]"
          />
          להחליף את הלוח כולו
        </label>
      </div>

      <div role="tablist" className="mb-3 flex gap-2">
        {([['pick', 'בחירה מרשימה'], ['json', 'הדבקת JSON']] as const).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={how === id}
            disabled={act.busy}
            onClick={() => setHow(id)}
            className={`tap flex-1 rounded-full border px-3 py-1.5 text-[12px]
                        ${how === id
              ? 'border-gold/60 bg-gold/10 text-gold'
              : 'border-gold/20 text-chalk-dim'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {how === 'pick' ? (
        <>
          <FixturePicker list={picked} onChange={setPicked} disabled={act.busy} />
          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              disabled={act.busy || picked.length === 0}
              className={`${primary} py-2`}
              onClick={() => send(picked)}
            >
              {act.busy ? 'קולט…' : `קליטת ${picked.length} משחקים`}
            </button>
            {picked.length > 0 && (
              <button
                type="button"
                disabled={act.busy}
                className="text-[11px] text-chalk-dim underline"
                onClick={() => setPicked([])}
              >
                ניקוי
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <textarea
            dir="ltr"
            rows={6}
            value={raw}
            disabled={act.busy}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={'[\n  {"home":"3","away":"4","kickoff":"2026-09-05T20:00:00+03:00"}\n]'}
            className={`num text-start ${input}`}
          />

          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              disabled={act.busy || !raw.trim()}
              className={`${primary} py-2`}
              onClick={submit}
            >
              {act.busy ? 'קולט…' : 'קליטה'}
            </button>
            <button
              type="button"
              className="text-[11px] text-chalk-dim underline"
              onClick={() => setRaw(sampleFixtures())}
            >
              דוגמה
            </button>
          </div>
        </>
      )}

      <Note msg={act.msg} bad={act.bad} />

      {/* ★ דוח כיסוי, לא רק שגיאות.
          "0 שגיאות" מסתיר "נקלטו 3 מתוך 7". */}
      {report && report.problems.length > 0 && (
        <div className="mt-3 rounded-xl border border-flare/30 bg-flare/5 p-3">
          <p className="text-[12px] font-black text-flare">שורות שנדחו</p>
          <ul className="mt-1.5 space-y-1">
            {report.problems.map((p, i) => (
              <li key={i} className="text-[11.5px] text-chalk-2">
                <span className="num">#{p.row}</span> — {p.issue}
                {p.value && <span className="num text-chalk-dim"> ({p.value})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-[11px] text-chalk-dim">
          מזהי הקבוצות
        </summary>
        <p className="num mt-1.5 text-[10.5px] leading-relaxed text-chalk-dim" dir="rtl">
          {teamHelp}
        </p>
      </details>
    </Card>
  );
}

function sampleFixtures(): string {
  const ids = TEAMS.slice(0, 6).map((t) => t.externalId);
  const rows: string[] = [];
  for (let i = 0; i + 1 < ids.length; i += 2) {
    rows.push(
      `  {"home":"${ids[i]}","away":"${ids[i + 1]}","kickoff":"2026-09-05T20:00:00+03:00"}`,
    );
  }
  return `[\n${rows.join(',\n')}\n]`;
}

/* ================================================================== */
/* 2 · חוקי ניקוד                                                      */
/* ================================================================== */

export function AdminRules() {
  const act = useAction();
  const overrides = ruleOverrides();
  /* ★ `liveDataVersion()` בתלות: `TEAMS` מוחלף במקום כשהסגלים
     מגיעים מהשרת, ו-`useMemo` עם `[]` היה נועל את ברירות המחדל
     על הזרע המצורף לבנייה. אותו דפוס בדיוק שהמעבר לשרת בא לבטל. */
  const base = useMemo(
    () => resolveRules(TEAMS.length).rules, [liveDataVersion()]);

  const groups = useMemo(() => {
    const by = new Map<string, typeof RULE_KEYS>();
    for (const r of RULE_KEYS) {
      const list = by.get(r.group) ?? [];
      list.push(r);
      by.set(r.group, list);
    }
    return [...by.entries()];
  }, []);

  return (
    <div className="space-y-4">
      <Card
        title="איזון הניקוד"
        hint="שינוי נשמר מיד ומשפיע על כל המשתמשים. ערך ריק = ברירת המחדל של המשחק."
      >
        {/* ★ האזהרה הזו חייבת להיות כאן ולא בתיעוד.
            הדירוג מחושב מחדש מהחוקים הנוכחיים, ולכן שינוי אחרי
            פרסום משנה מספרים שאנשים כבר ראו. */}
        <p className="mb-3 rounded-xl border border-armband/30 bg-armband/5 px-3 py-2
                      text-[11.5px] leading-snug text-chalk-2">
          שינוי אחרי שהתוצאות פורסמו מחשב את הדירוג מחדש — כולל
          מחזורים שאנשים כבר ראו. עדיף לאזן בין מחזורים.
        </p>

        {groups.map(([group, items]) => (
          <div key={group} className="mb-4 last:mb-0">
            <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.16em]
                          text-chalk-dim">{group}</p>
            <div className="space-y-1.5">
              {items.map((r) => (
                <RuleRow
                  key={r.key}
                  ruleKey={r.key}
                  label={r.label}
                  hint={r.hint}
                  fiveValue={readRule(DUBID_5X5, r.key)}
                  defaultValue={readRule(base, r.key)}
                  override={overrides[r.key]}
                  act={act}
                />
              ))}
            </div>
          </div>
        ))}

        <Note msg={act.msg} bad={act.bad} />
      </Card>
    </div>
  );
}

function RuleRow({
  ruleKey, label, hint, defaultValue, fiveValue, override, act,
}: {
  ruleKey: string;
  label: string;
  hint?: string;
  defaultValue: number | undefined;
  fiveValue: number | undefined;
  override: number | undefined;
  act: ReturnType<typeof useAction>;
}) {
  const effective = override ?? defaultValue ?? 0;
  const [value, setValue] = useState(String(effective));
  const [touched, setTouched] = useState(false);

  useEffect(() => { if (!touched) setValue(String(effective)); }, [effective, touched]);

  const changed = override !== undefined;
  /* ★ מוצג רק כשהוא שונה: "5 בדוביד 11 · 6 בדוביד 5" הוא מידע.
     "5 · 5" הוא רעש. */
  const differs = fiveValue !== undefined && fiveValue !== defaultValue;

  return (
    <div className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${
      changed ? 'border-gold/40 bg-gold/5' : 'border-gold/10 bg-night'}`}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] text-chalk">{label}</span>
        {hint && <span className="block text-[10px] text-chalk-dim">{hint}</span>}
        {differs && (
          <span className="num block text-[10px] text-chalk-dim">
            דוביד 5: {fiveValue}
          </span>
        )}
      </span>

      <input
        type="number"
        step={0.5}
        value={value}
        disabled={act.busy}
        onChange={(e) => { setTouched(true); setValue(e.target.value); }}
        onBlur={() => {
          /* ★★ שדה ריק אינו אפס. ★★
             `Number('') === 0`, והוא סופי — ולכן ניקוי השדה
             ולחיצה על Tab שלחו `admin_set_rule(key, 0)` לכל
             המשתמשים, בשידור חי. במכפיל הקפטן זה הפך את
             ההחלטה המרכזית במשחק לחסרת ערך, בלי שאף אחד התכוון. */
          const raw = value.trim();
          if (raw === '') { setValue(String(effective)); setTouched(false); return; }
          const n = Number(raw);
          if (!touched || !Number.isFinite(n) || n === effective) { setTouched(false); return; }
          act.run(async () => {
            await adminSetRule(ruleKey, n);
            setTouched(false);
            return `${label}: ${n}`;
          });
        }}
        className={`num w-16 shrink-0 text-center ${input}`}
      />

      {changed && (
        <button
          disabled={act.busy}
          title="חזרה לברירת המחדל"
          className={ghost}
          onClick={() => act.run(async () => {
            await adminClearRule(ruleKey);
            setTouched(false);
            return `${label} חזר לברירת המחדל (${defaultValue})`;
          })}
        >
          איפוס
        </button>
      )}
    </div>
  );
}

/* ================================================================== */
/* 3 · תוכן ושיווק                                                     */
/* ================================================================== */

export function AdminContent() {
  const act = useAction();
  const [rows, setRows] = useState<ContentRow[] | null>(null);

  const load = () => { void adminContentList().then(setRows).catch(() => setRows([])); };
  useEffect(load, []);
  useEffect(() => { if (act.done && !act.bad) load(); }, [act.done, act.bad]);

  const byKey = useMemo(() => {
    const m = new Map<string, ContentRow>();
    for (const r of rows ?? []) m.set(r.key, r);
    return m;
  }, [rows]);

  const groups = useMemo(() => {
    const by = new Map<string, typeof CONTENT_KEYS>();
    for (const c of CONTENT_KEYS) {
      const list = by.get(c.group) ?? [];
      list.push(c);
      by.set(c.group, list);
    }
    return [...by.entries()];
  }, []);

  return (
    <div className="space-y-4">
      <Card
        title="תוכן ושיווק"
        hint="כל טקסט כאן נשמר מיד ומופיע אצל כולם. מחיקה מחזירה לברירת המחדל שבקוד."
      >
        {groups.map(([group, items]) => (
          <div key={group} className="mb-4 last:mb-0">
            <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.16em]
                          text-chalk-dim">{group}</p>
            <div className="space-y-2">
              {items.map((c) => (
                <ContentRowEditor key={c.key} spec={c} row={byKey.get(c.key)} act={act} />
              ))}
            </div>
          </div>
        ))}
        <Note msg={act.msg} bad={act.bad} />
      </Card>
    </div>
  );
}

function ContentRowEditor({
  spec, row, act,
}: {
  spec: (typeof CONTENT_KEYS)[number];
  row: ContentRow | undefined;
  act: ReturnType<typeof useAction>;
}) {
  const stored = typeof row?.value === 'string' ? row.value : '';
  const [value, setValue] = useState(stored);
  const [touched, setTouched] = useState(false);

  useEffect(() => { if (!touched) setValue(stored); }, [stored, touched]);

  const overridden = row !== undefined;

  return (
    <div className={`rounded-xl border px-2.5 py-2 ${
      overridden ? 'border-gold/35 bg-gold/5' : 'border-gold/10 bg-night'}`}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-chalk">
          {spec.label}
        </span>
        {overridden && !row?.active && (
          <span className="shrink-0 rounded-full bg-night-3 px-2 py-0.5 text-[9.5px]
                           font-black text-chalk-dim">טיוטה</span>
        )}
      </div>

      {spec.hint && <p className="mt-0.5 text-[10.5px] text-chalk-dim">{spec.hint}</p>}

      {spec.long ? (
        <textarea
          rows={3}
          value={value}
          disabled={act.busy}
          onChange={(e) => { setTouched(true); setValue(e.target.value); }}
          placeholder={spec.fallback || '(ריק)'}
          className={`mt-1.5 ${input}`}
        />
      ) : (
        <input
          value={value}
          disabled={act.busy}
          onChange={(e) => { setTouched(true); setValue(e.target.value); }}
          placeholder={spec.fallback || '(ריק)'}
          className={`mt-1.5 ${input}`}
        />
      )}

      {touched && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <button
            disabled={act.busy}
            className={ghost}
            onClick={() => act.run(async () => {
              await adminSetContent(spec.key, value, undefined, true);
              setTouched(false);
              return `"${spec.label}" עודכן ומוצג.`;
            })}
          >
            שמירה ופרסום
          </button>
          {/* ★ טיוטה: נשמר, לא מוצג. מאפשר להכין קמפיין מראש
              בלי שהוא ידלוף למי שיפתח DevTools. */}
          <button
            disabled={act.busy}
            className={ghost}
            onClick={() => act.run(async () => {
              await adminSetContent(spec.key, value, undefined, false);
              setTouched(false);
              return `"${spec.label}" נשמר כטיוטה — לא מוצג עדיין.`;
            })}
          >
            שמירה כטיוטה
          </button>
          <button
            className={ghost}
            onClick={() => { setValue(stored); setTouched(false); }}
          >
            ביטול
          </button>
        </div>
      )}

      {overridden && !touched && (
        <button
          disabled={act.busy}
          className={`${ghost} mt-1.5 border-flare/25 text-flare`}
          onClick={() => act.run(async () => {
            await adminDeleteContent(spec.key);
            setTouched(false);
            return `"${spec.label}" חזר לברירת המחדל.`;
          })}
        >
          חזרה לברירת המחדל
        </button>
      )}
    </div>
  );
}

/* ================================================================== */
/* 4 · ניתוח                                                           */
/* ================================================================== */

export function AdminAnalytics() {
  const [a, setA] = useState<Analytics | null>(null);
  const [issues, setIssues] = useState<DataIssue[] | null>(null);
  const [audit, setAudit] = useState<AuditRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([adminAnalytics(), adminDataQuality(), adminAudit(25)])
      .then(([x, q, l]) => { setA(x); setIssues(q); setAudit(l); setErr(null); })
      .catch((e: unknown) =>
        setErr(errorMessageHe(e instanceof Error ? e.message : 'NETWORK')));
  }, []);

  if (err) {
    return <p className="rounded-xl border border-flare/30 bg-flare/5 px-4 py-3
                         text-[13px] text-flare">{err}</p>;
  }
  if (!a) return <p className="text-[12px] text-chalk-dim">טוען…</p>;

  const entriesTotal = Object.values(a.entries ?? {}).reduce((s, n) => s + n, 0);

  return (
    <div className="space-y-4">
      {/* ★ בריאות הנתונים ראשונה, ולא אחרונה.
          אלה הדברים שנכשלים בשקט — ואם הם לא בראש המסך, אף אחד
          לא גולל אליהם. */}
      {issues && issues.length > 0 && (
        <Card title="דורש טיפול" hint="דברים שנכשלים בלי להודיע.">
          <div className="space-y-2">
            {issues.map((it, i) => (
              <div
                key={i}
                className={`rounded-xl border px-3 py-2 ${
                  it.level === 'error'
                    ? 'border-flare/35 bg-flare/5'
                    : 'border-armband/30 bg-armband/5'}`}
              >
                <p className={`text-[12.5px] font-black ${
                  it.level === 'error' ? 'text-flare' : 'text-armband'}`}>
                  {it.title}
                </p>
                <p className="mt-0.5 text-[11.5px] text-chalk-2">{it.detail}</p>
                {it.fix && <p className="mt-0.5 text-[11px] text-chalk-dim">← {it.fix}</p>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {issues && issues.length === 0 && (
        <p className="rounded-xl border border-gold/25 bg-gold/5 px-4 py-2.5
                      text-[12.5px] text-chalk-2">
          הנתונים תקינים. אין מה לטפל.
        </p>
      )}

      <Card title="קהל">
        <Stats items={[
          ['משתמשים', a.audience.users],
          ['רשומים', a.audience.registered],
          ['אורחים', a.audience.guests],
          ['זירות', a.audience.leagues],
        ]} />
      </Card>

      <Card
        title={`השתתפות · ${a.gameweek}`}
        hint="שיעור ההשלמה הוא כמה טיוטות הפכו להגשה — המדד היחיד שמצביע ישירות על חיכוך במסך הבנייה."
      >
        <Stats items={[
          ['הגשות', entriesTotal],
          ['דוביד 5', a.entries?.five ?? 0],
          ['דוביד 11', a.entries?.full ?? 0],
          ['שיעור השלמה', a.conversion === null ? '—' : `${a.conversion}%`],
        ]} />
      </Card>

      {a.topPicks?.length > 0 && (
        <Card
          title="הבחירות הנפוצות"
          hint="מעל 60% = שחקן שלא מבדיל בין מתחרים, כלומר מחיר שלא מאוזן."
        >
          <div className="space-y-1">
            {a.topPicks.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-chalk">
                  <bdi>{p.player}</bdi>
                  <span className="ms-1.5 text-[10.5px] text-chalk-dim">{p.team}</span>
                </span>
                <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-night-3">
                  <span
                    className={`block h-full ${p.pct >= 60 ? 'bg-flare' : 'bg-gold'}`}
                    style={{ width: `${Math.min(100, p.pct)}%` }}
                  />
                </span>
                <span className="num w-10 shrink-0 text-end text-[11.5px] text-chalk-2">
                  {p.pct}%
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {a.topCaptains?.length > 0 && (
        <Card title="קפטנים">
          <div className="flex flex-wrap gap-1.5">
            {a.topCaptains.map((c, i) => (
              <span key={i} className="rounded-full bg-night-3 px-2.5 py-1 text-[11.5px]
                                       text-chalk-2">
                <bdi>{c.player}</bdi>
                <span className="num ms-1.5 text-gold">{c.picks}</span>
              </span>
            ))}
          </div>
        </Card>
      )}

      <Card
        title="חזרה"
        hint="כמה מחזורים שיחק כל אדם. 1 = ניסה פעם אחת ולא חזר."
      >
        <Stats items={Object.entries(a.retention ?? {})
          .sort((x, y) => Number(x[0]) - Number(y[0]))
          .map(([weeks, people]) => [`${weeks} מחזורים`, people])} />
      </Card>

      {audit && audit.length > 0 && (
        <Card title="יומן פעולות" hint="מי שינה מה, ומתי.">
          <div className="space-y-1">
            {audit.map((l, i) => (
              <div key={i} className="flex items-baseline gap-2 text-[11.5px]">
                <span className="num shrink-0 text-chalk-dim">{fmtShort(l.at)}</span>
                <span className="min-w-0 flex-1 truncate text-chalk-2">
                  {ACTION_HE[l.action] ?? l.action}
                  {l.id && <span className="num ms-1.5 text-chalk-dim">{l.id}</span>}
                </span>
                <span className="shrink-0 text-chalk-dim"><bdi>{l.who}</bdi></span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <p className="text-center text-[10.5px] text-chalk-dim">
        עודכן <span className="num">{fmt(a.generatedAt)}</span>
      </p>
    </div>
  );
}

function Stats({ items }: { items: Array<[string, number | string]> }) {
  if (items.length === 0) {
    return <p className="text-[12px] text-chalk-dim">אין נתונים עדיין.</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map(([label, value], i) => (
        <div key={i} className="rounded-xl border border-gold/12 bg-night px-3 py-2.5">
          <div className="num text-[19px] leading-none text-gold-light">{value}</div>
          <div className="mt-1 text-[10.5px] text-chalk-dim">{label}</div>
        </div>
      ))}
    </div>
  );
}

/* ================================================================== */

const ACTION_HE: Record<string, string> = {
  admin_create_gameweek: 'מחזור נוצר',
  admin_set_current_gameweek: 'המחזור הפעיל הוחלף',
  admin_delete_gameweek: 'מחזור נמחק',
  admin_import_fixtures: 'לוח משחקים נקלט',
  admin_upsert_fixture: 'משחק עודכן',
  admin_delete_fixture: 'משחק הוסר',
  admin_set_deadline: 'דדליין שונה',
  admin_set_status: 'סטטוס מחזור שונה',
  admin_set_published: 'פרסום דירוג',
  admin_upsert_player: 'שחקן נוסף/עודכן',
  admin_move_player: 'שחקן עבר קבוצה',
  admin_set_price: 'מחיר שונה',
  admin_set_player_status: 'זמינות שחקן',
  admin_upsert_team: 'קבוצה עודכנה',
  admin_set_content: 'תוכן עודכן',
  admin_upsert_match: 'תוצאה הוזנה',
  admin_upsert_player_stat: 'סטטיסטיקה הוזנה',
};

/** ★ שעון ישראל, כמו בכל מקום אחר במוצר. */
function fmt(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('he-IL', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      timeZone: 'Asia/Jerusalem',
    });
  } catch { return '—'; }
}

function fmtShort(iso: string): string {
  try {
    return new Date(iso).toLocaleString('he-IL', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      timeZone: 'Asia/Jerusalem',
    });
  } catch { return ''; }
}

/* ================================================================== */
/* פעילות · יומן, סטטיסטיקה ובוטים                                    */
/* ================================================================== */

/**
 * ═══════════════════════════════════════════════════════════════
 * ★ למה יומן פעילות הוא לא "נחמד שיהיה"
 * ═══════════════════════════════════════════════════════════════
 *
 * הבקשה הייתה "שאדע מה קורה — שחר שלח הרכב דוביד 5". מאחורי
 * הניסוח הזה יש שאלה אמיתית שאין לה תשובה היום: **האם המחזור
 * הזה עובד?**
 *
 * מספר המשתתפים לבדו לא עונה עליה. שמונה הגשות ביום ראשון ושמונה
 * בשעה האחרונה הם שני מוצרים שונים לגמרי, ורק הפילוח לפי שעה
 * מבדיל ביניהם — וזה גם המספר היחיד כאן שמשנה החלטה, כי הוא
 * קובע מתי לשלוח תזכורת.
 *
 * ★ ומה שאין כאן, בכוונה: הרכבים.
 *
 * היומן מציג מי הגיש, לא **מה** הוא הגיש. אילו היה מציג, הוא
 * היה דלת אחורית לצפייה בהרכבים לפני הנעילה — בדיוק מה שהשרת
 * סוגר ב-`game.entries`.
 */
export function AdminActivity() {
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [scope, setScope] = useState<'gw' | 'all'>('gw');
  const act = useAction();

  const gw = currentGameweekCode() || GAMEWEEK.id;
  const target = scope === 'gw' ? gw : undefined;

  const load = () => {
    Promise.all([adminActivity(80, target), adminActivityStats(target)])
      .then(([a, s]) => { setRows(a); setStats(s); setErr(null); })
      .catch((e: unknown) =>
        setErr(errorMessageHe(e instanceof Error ? e.message : 'NETWORK')));
  };

  useEffect(load, [scope, gw, act.done]);

  return (
    <div className="space-y-4">
      <Card
        title="פעילות במחזור"
        hint="מי הגיש, מתי, ובאיזה מצב. ההרכבים עצמם אינם ביומן — הוא לא דלת אחורית."
      >
        <div className="mb-3 flex gap-2">
          {([['gw', `המחזור הנוכחי (${gw})`], ['all', 'הכל']] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setScope(id)}
              className={`tap shrink-0 rounded-lg px-3 py-1.5 text-[11.5px] font-black ${
                scope === id ? 'bg-gold text-gold-ink' : 'border border-gold/25 text-chalk-dim'}`}
            >
              {label}
            </button>
          ))}
          <button onClick={load} className={ghost}>רענון</button>
        </div>

        {stats && <StatGrid stats={stats} />}
        {err && <Note msg={err} bad />}
      </Card>

      {stats && stats.byHour.length > 0 && <HourChart data={stats.byHour} />}

      <Card title="היומן" hint="שמונים הרשומות האחרונות.">
        <ActivityLog rows={rows} />
      </Card>

    </div>
  );
}

/**
 * היומן עצמו — שלושת המצבים שלו במקום אחד.
 *
 * ★ הופרד מ-`AdminActivity` כדי שאפשר יהיה לרנדר אותו עם שורות
 *   נתונות: הטעינה יושבת ב-`useEffect`, ורינדור סטטי (תצוגה,
 *   בדיקה) היה מראה לנצח "טוען…" ולא את הצורה האמיתית.
 */
export function ActivityLog({ rows }: { rows: ActivityRow[] | null }) {
  if (rows === null) return <p className="text-[12px] text-chalk-dim">טוען…</p>;
  if (rows.length === 0) {
    return <p className="text-[12px] text-chalk-dim">אין עדיין פעילות במחזור הזה.</p>;
  }
  return (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li
          key={r.id}
          className="flex items-baseline gap-2 border-b border-gold/10 py-1.5 last:border-0"
        >
          <span
            aria-hidden="true"
            className="mt-1 size-1.5 shrink-0 rounded-full"
            style={{ background: dotColor(r.action) }}
          />
          <span className="min-w-0 flex-1 text-[12.5px] text-chalk">
            {r.text}
            {r.detail && r.detail !== r.who && (
              <span className="text-chalk-dim"> · {r.detail}</span>
            )}
          </span>
          <span className="num shrink-0 text-[10.5px] text-chalk-dim">{fmt(r.at)}</span>
        </li>
      ))}
    </ul>
  );
}

function dotColor(action: string): string {
  if (action === 'withdraw') return '#E4453B';
  if (action === 'bot_submit') return '#8B7F6A';
  return '#D8B25C';
}

export function StatGrid({ stats }: { stats: ActivityStats }) {
  const items: Array<[string, number]> = [
    ['הגשות', stats.total],
    ['אנשים', stats.humans],
    ['בוטים', stats.bots],
    ['היום', stats.today],
    ['דוביד 5', stats.five],
    ['דוביד 11', stats.full],
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map(([label, n]) => (
        <div key={label} className="rounded-lg bg-night px-2 py-2 text-center">
          <div className="num text-[17px] font-black leading-none text-gold-light" dir="ltr">{n}</div>
          <div className="mt-1 text-[10px] text-chalk-dim">{label}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * ★ הפילוח לפי שעה — המספר היחיד כאן שמשנה החלטה.
 *
 * הוא עונה על "מתי לשלוח תזכורת". גרף עמודות פשוט ולא ספרייה:
 * עשרים וארבעה מספרים לא דורשים 40kb של קוד.
 */
export function HourChart({ data }: { data: Array<{ hour: number; n: number }> }) {
  const byHour = new Map(data.map((d) => [d.hour, d.n]));
  const max = Math.max(1, ...data.map((d) => d.n));

  return (
    <Card title="באיזו שעה מגישים" hint="שעון ישראל. זה מה שקובע מתי לשלוח תזכורת.">
      <div className="flex items-end gap-[2px]" style={{ height: 92 }}>
        {Array.from({ length: 24 }, (_, h) => {
          const n = byHour.get(h) ?? 0;
          return (
            <div key={h} className="flex flex-1 flex-col items-center gap-1" title={`${h}:00 — ${n}`}>
              <div
                className="w-full rounded-t-[2px]"
                style={{
                  height: `${(n / max) * 72}px`,
                  minHeight: n > 0 ? 3 : 1,
                  background: n > 0 ? '#D8B25C' : 'rgba(216,178,92,.18)',
                }}
              />
              {h % 6 === 0 && (
                <span className="num text-[8.5px] text-chalk-dim" dir="ltr">{h}</span>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════
 * ★ בוטים
 * ═══════════════════════════════════════════════════════════════
 *
 * מחזור ראשון עם שני משתתפים אינו תחרות, וטבלה עם שתי שורות
 * אומרת למשתמש החדש "אין כאן אף אחד". בוטים פותרים בעיית השקה
 * אמיתית — ובתנאי אחד: **שהם מסומנים.**
 *
 * הם חוזרים לכל מסך עם `isBot`, ומופיעים בטבלה עם תג "בוט".
 * הסתרה של זה הייתה הופכת כלי לגיטימי להטעיה, ולכן אין כאן
 * מתג "בוטים סמויים" — לא כי שכחנו.
 *
 * ★ והם משחקים לפי אותם חוקים: שחקן אחד מכל קבוצה, גודל הרכב,
 *   ותקציב בדוביד 5. בוט פטור מהתקציב היה מנצח בגלל שהוא בוט.
 */
export function AdminBots({ act: outer }: { act?: ReturnType<typeof useAction> }) {
  /* ★ הקומפוננטה מחזיקה `useAction` משלה כשלא קיבלה אחת.
     היא הייתה תלויה בזו של מסך הפעילות, ולכן לא הייתה יכולה
     לעמוד בפני עצמה — וזו בדיוק הסיבה שהיא הייתה קבורה שם. */
  const own = useAction();
  const act = outer ?? own;
  const [mode, setMode] = useState<'five' | 'full'>('five');
  const [count, setCount] = useState(8);
  const [report, setReport] = useState<BotResult | null>(null);
  const gw = currentGameweekCode() || GAMEWEEK.id;

  return (
    <Card
      title="הוספת בוטים למחזור"
      hint="בוט מגיש הרכב בדיוק כמו משתתף רגיל: שם מאמן, שם קבוצה, שחקן אחד מכל קבוצה, ותקציב בדוביד 5. הוא מסומן בתג «בוט» בכל מקום שבו הוא מופיע."
    >
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={mode}
          disabled={act.busy}
          onChange={(e) => setMode(e.target.value as 'five' | 'full')}
          className={`w-auto ${input}`}
        >
          <option value="five">דוביד 5</option>
          <option value="full">דוביד 11</option>
        </select>

        <label className="flex items-center gap-1.5 text-[11.5px] text-chalk-2">
          כמה
          <input
            type="number"
            min={1}
            max={60}
            value={count}
            disabled={act.busy}
            onChange={(e) => setCount(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
            className={`num w-16 ${input}`}
          />
        </label>

        <button
          disabled={act.busy}
          className={`${primary} py-2`}
          onClick={() => act.run(async () => {
            const r = await adminAddBots(gw, mode, count);
            setReport(r);
            const bits = [`נוספו ${r.added}`];
            if (r.skipped) bits.push(`${r.skipped} כבר היו`);
            if (r.problems.length) bits.push(`${r.problems.length} נדחו`);
            return bits.join(' · ');
          })}
        >
          {act.busy ? 'מוסיף…' : `הוספה ל-${gw}`}
        </button>

        <button
          disabled={act.busy}
          className={ghost}
          onClick={() => act.run(async () => {
            const n = await adminRemoveBots(gw);
            setReport(null);
            return `הוסרו ${n} בוטים`;
          })}
        >
          הסרת כל הבוטים
        </button>
      </div>

      <Note msg={act.msg} bad={act.bad} />

      {/* ★ דוח דחיות, לא רק ספירה. "נוספו 6" מסתיר "ושניים נדחו". */}
      {report && report.problems.length > 0 && (
        <div className="mt-3 rounded-xl border border-flare/30 bg-flare/5 p-3">
          <p className="text-[12px] font-black text-flare">בוטים שלא נוספו</p>
          <ul className="mt-1.5 space-y-1">
            {report.problems.map((p, i) => (
              <li key={i} className="text-[11.5px] text-chalk-2">
                <span className="num">#{p.bot}</span> — {p.issue}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/* ================================================================== */
/* 9 · פרסום פנימי                                                     */
/* ================================================================== */

/**
 * ★★ למה זה מסך ניהול ולא קבוע בקוד ★★
 *
 * מודעה היא **החלטה שיווקית**, ולהחלטה שיווקית יש קצב אחר מאשר
 * לקוד. ניסוח שלא עובד צריך להיות ניתן להחלפה בשתי דקות, לא
 * בפריסה. קמפיין לחג צריך להיכבות מעצמו בליל שבת, לא כשמישהו
 * נזכר ביום שלישי.
 *
 * לכן כל מה שכאן: מותג, ניסוח, משקל, מסכים, וחלון תאריכים.
 * ולכן גם המספרים — חשיפות וקליקים לצד כל מודעה. בלעדיהם
 * "איזה ניסוח עובד" הוא ויכוח, ואיתם הוא שאלה עם תשובה.
 *
 * ★ הכפתור הכי חשוב כאן הוא **המתג**, לא "שמור".
 *   הדבר שקורה הכי הרבה בלוח פרסום הוא כיבוי מהיר של משהו
 *   שנראה לא טוב. הוא לא מסתתר בתוך טופס עריכה.
 */
export function AdminAds() {
  const [rows, setRows] = useState<AdminAd[] | null>(null);
  const [stats, setStats] = useState<AdStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<HouseAd | null>(null);
  const act = useAction();

  const load = () => {
    Promise.all([adminAds(), adminAdStats(30)])
      .then(([a, s]) => { setRows(a); setStats(s); setErr(null); })
      .catch((e: unknown) =>
        setErr(errorMessageHe(e instanceof Error ? e.message : 'NETWORK')));
  };

  useEffect(load, [act.done]);

  return (
    <div className="space-y-4">
      <Card
        title="פרסום פנימי"
        hint="מודעות בין המוצרים של דובל טים. מוצגות ברצועה מתחלפת בתוך האפליקציה — לובי, דירוג, הרכב נעול, כרטיס, זירה וחוקים."
      >
        {stats && (
          <div className="mb-3 grid grid-cols-3 gap-2">
            <Stat label="חשיפות · 30 יום" value={stats.impressions} />
            <Stat label="קליקים" value={stats.clicks} />
            <Stat
              label="שיעור הקלקה"
              value={stats.impressions > 0
                ? `${((stats.clicks / stats.impressions) * 100).toFixed(1)}%`
                : '—'}
            />
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button className={`${primary} py-2`} onClick={() => setEditing(blankAd())}>
            מודעה חדשה
          </button>
          <button className={ghost} onClick={load}>רענון</button>
        </div>

        <Note msg={act.msg} bad={act.bad} />
        {err && <Note msg={err} bad />}
      </Card>

      {editing && (
        <AdEditor
          ad={editing}
          onCancel={() => setEditing(null)}
          onSave={(next) => {
            act.run(async () => {
              await adminUpsertAd(next);
              setEditing(null);
              return 'המודעה נשמרה';
            });
          }}
          busy={act.busy}
        />
      )}

      <Card title="המודעות" hint="הסדר בתצוגה נקבע לפי משקל, לא לפי הרשימה הזו.">
        {rows === null ? (
          <p className="text-[12px] text-chalk-dim">טוען…</p>
        ) : rows.length === 0 ? (
          /* ★ ריק כאן **אינו** ריק במסך.
             בלי שורות במסד האפליקציה מציגה את ברירות המחדל
             שבקוד. אם לא נאמר את זה כאן, האדמין יחשוב שהפרסום
             כבוי — ויתחיל לחפש תקלה שלא קיימת. */
          <p className="text-[12px] leading-snug text-chalk-dim">
            אין מודעות במסד. האפליקציה מציגה כרגע את ארבע מודעות ברירת
            המחדל שבקוד. הרצה של <span className="num">db/17</span> מזריעה אותן לכאן.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li
                key={r.id}
                className="rounded-xl border border-gold/12 bg-night p-3"
              >
                <div className="flex items-start gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <BrandWord brand={r.brand} size={11} />
                      <span className="num text-[10px] text-chalk-dim">×{r.weight}</span>
                      {!r.enabled && (
                        <span className="rounded bg-flare/15 px-1.5 text-[9.5px] font-black text-flare">
                          כבוי
                        </span>
                      )}
                      {r.placements.length > 0 && (
                        <span className="truncate text-[9.5px] text-chalk-dim">
                          {r.placements.join(' · ')}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[13px] font-black text-chalk">
                      {r.headline}
                    </span>
                    <span className="mt-0.5 block text-[10.5px] text-chalk-dim">
                      <span className="num">{r.impressions}</span> חשיפות ·{' '}
                      <span className="num">{r.clicks}</span> קליקים
                      {r.impressions > 0 && (
                        <> · <span className="num">
                          {((r.clicks / r.impressions) * 100).toFixed(1)}%
                        </span></>
                      )}
                      {(r.startsAt || r.endsAt) && (
                        <> · חלון: {r.startsAt?.slice(0, 10) ?? '—'} → {r.endsAt?.slice(0, 10) ?? '—'}</>
                      )}
                    </span>
                  </span>

                  <span className="flex shrink-0 flex-col gap-1">
                    <button
                      disabled={act.busy}
                      className={ghost}
                      onClick={() => act.run(async () => {
                        await adminSetAdEnabled(r.id, !r.enabled);
                        return r.enabled ? 'המודעה כובתה' : 'המודעה הודלקה';
                      })}
                    >
                      {r.enabled ? 'כיבוי' : 'הדלקה'}
                    </button>
                    <button
                      disabled={act.busy}
                      className={ghost}
                      onClick={() => setEditing({ ...r })}
                    >
                      עריכה
                    </button>
                    <button
                      disabled={act.busy}
                      className={ghost}
                      onClick={() => act.run(async () => {
                        await adminDeleteAd(r.id);
                        return 'המודעה נמחקה';
                      })}
                    >
                      מחיקה
                    </button>
                  </span>
                </div>

                <div className="mt-2">
                  <HouseAdPreview ad={r} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {stats && stats.byPlacement.length > 0 && (
        <Card title="לפי מסך" hint="איפה המודעות באמת נלחצות.">
          <ul className="space-y-1">
            {stats.byPlacement.map((p) => (
              <li key={p.placement}
                  className="flex items-baseline gap-2 border-b border-gold/10 py-1.5 last:border-0">
                <span className="flex-1 text-[12px] text-chalk">{PLACEMENT_HE[p.placement] ?? p.placement}</span>
                <span className="num text-[11px] text-chalk-dim">{p.impressions}</span>
                <span className="num w-10 text-end text-[11px] text-gold">{p.clicks}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

const PLACEMENT_HE: Record<string, string> = {
  lobby: 'לובי', locked: 'הרכב נעול', result: 'תוצאה', card: 'כרטיס',
  leaderboard: 'דירוג', rules: 'חוקים', arena: 'זירה', unknown: 'לא ידוע',
};

const ALL_PLACEMENTS: Placement[] =
  ['lobby', 'locked', 'result', 'card', 'leaderboard', 'rules', 'arena'];

function blankAd(): HouseAd {
  return {
    id: '', brand: 'takemeout', enabled: true, weight: 5,
    headline: '', body: '', cta: 'להעיף מבט',
    url: BRANDS.takemeout.url, placements: [], startsAt: null, endsAt: null,
  };
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-gold/12 bg-night px-2 py-2 text-center">
      <div className="num text-[17px] leading-none text-gold">{value}</div>
      <div className="mt-1 text-[9.5px] leading-tight text-chalk-dim">{label}</div>
    </div>
  );
}

/**
 * טופס העריכה.
 *
 * ★ התצוגה המקדימה מעל השדות ולא מתחתם.
 *   מי שמקליד כותרת רוצה לראות איך היא נראית **בזמן** שהוא
 *   מקליד. מתחת לטופס היא נמצאת מחוץ למסך ברוב המכשירים,
 *   וכאילו לא קיימת.
 */
function AdEditor({
  ad, onSave, onCancel, busy,
}: {
  ad: HouseAd;
  onSave: (ad: HouseAd) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [d, setD] = useState<HouseAd>(ad);
  const issues = adIssues(d);
  const set = <K extends keyof HouseAd>(k: K, v: HouseAd[K]) =>
    setD((x) => ({ ...x, [k]: v }));

  return (
    <Card title={ad.id ? `עריכה · ${ad.id}` : 'מודעה חדשה'}
          hint="הכותרת היא מה שנקרא. הגוף הוא מה שמסביר. שניהם נחתכים אם הם ארוכים מדי — לכן המונים.">
      <div className="mb-3">
        <HouseAdPreview ad={d} />
      </div>

      <div className="space-y-2">
        <div className="flex gap-2">
          {(BRAND_IDS).map((b) => (
            <button
              key={b}
              onClick={() => setD((x) => ({
                ...x, brand: b,
                /* ★ הכתובת עוברת עם המותג — אבל רק אם היא לא
                   שונתה ידנית. אחרת החלפת מותג הייתה מוחקת קישור
                   קמפיין שמישהו הדביק. */
                url: x.url === BRANDS[x.brand].url ? BRANDS[b].url : x.url,
              }))}
              className={`tap flex-1 rounded-lg border px-3 py-2 text-[12px] font-black ${
                d.brand === b ? 'border-gold text-gold' : 'border-gold/20 text-chalk-dim'}`}
            >
              {BRANDS[b].name}
            </button>
          ))}
        </div>

        <label className="block">
          <span className="text-[11px] text-chalk-dim">
            כותרת <span className="num">{d.headline.length}/60</span>
          </span>
          <input className={input} value={d.headline} maxLength={60} disabled={busy}
                 onChange={(e) => set('headline', e.target.value)} />
        </label>

        <label className="block">
          <span className="text-[11px] text-chalk-dim">
            גוף <span className="num">{d.body.length}/120</span>
          </span>
          <input className={input} value={d.body} maxLength={120} disabled={busy}
                 onChange={(e) => set('body', e.target.value)} />
        </label>

        <div className="flex gap-2">
          <label className="min-w-0 flex-1">
            <span className="text-[11px] text-chalk-dim">קריאה לפעולה</span>
            <input className={input} value={d.cta} maxLength={24} disabled={busy}
                   onChange={(e) => set('cta', e.target.value)} />
          </label>
          <label className="w-24 shrink-0">
            <span className="text-[11px] text-chalk-dim">משקל 1–10</span>
            <input type="number" min={1} max={10} className={`num ${input}`}
                   value={d.weight} disabled={busy}
                   onChange={(e) => set('weight',
                     Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />
          </label>
        </div>

        <label className="block">
          <span className="text-[11px] text-chalk-dim">קישור</span>
          <input className={input} dir="ltr" value={d.url} disabled={busy}
                 onChange={(e) => set('url', e.target.value)} />
        </label>

        <label className="block">
          <span className="text-[11px] text-chalk-dim">
            מזהה (באנליטיקס ובכתובת). ריק = נוצר אוטומטית
          </span>
          <input className={input} dir="ltr" value={d.id} disabled={busy || !!ad.id}
                 onChange={(e) => set('id', e.target.value)} />
        </label>

        {/* ★ "בכל המסכים" הוא מצב מפורש ולא רשימה מלאה.
            רשימה עם כל שבעת המסכים מסומנים נראית זהה למצב
            "בכל מקום", אבל היא לא: מסך חדש שייווסף בעתיד לא
            ייכלל בה, והמודעה תיעלם ממנו בשקט. */}
        <div>
          <span className="text-[11px] text-chalk-dim">מסכים</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <button
              onClick={() => set('placements', [])}
              className={`tap rounded-lg border px-2.5 py-1.5 text-[11px] font-bold ${
                d.placements.length === 0
                  ? 'border-gold text-gold' : 'border-gold/20 text-chalk-dim'}`}
            >
              בכל המסכים
            </button>
            {ALL_PLACEMENTS.map((p) => {
              const on = d.placements.includes(p);
              return (
                <button
                  key={p}
                  onClick={() => set('placements',
                    on ? d.placements.filter((x) => x !== p) : [...d.placements, p])}
                  className={`tap rounded-lg border px-2.5 py-1.5 text-[11px] font-bold ${
                    on ? 'border-gold text-gold' : 'border-gold/20 text-chalk-dim'}`}
                >
                  {PLACEMENT_HE[p]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex gap-2">
          <label className="min-w-0 flex-1">
            <span className="text-[11px] text-chalk-dim">מתאריך</span>
            <input type="date" className={input} disabled={busy}
                   value={d.startsAt?.slice(0, 10) ?? ''}
                   onChange={(e) => set('startsAt',
                     e.target.value ? new Date(`${e.target.value}T00:00:00`).toISOString() : null)} />
          </label>
          <label className="min-w-0 flex-1">
            <span className="text-[11px] text-chalk-dim">עד תאריך</span>
            <input type="date" className={input} disabled={busy}
                   value={d.endsAt?.slice(0, 10) ?? ''}
                   onChange={(e) => set('endsAt',
                     e.target.value ? new Date(`${e.target.value}T23:59:59`).toISOString() : null)} />
          </label>
        </div>

        {issues.length > 0 && (
          <ul className="rounded-xl border border-flare/30 bg-flare/5 p-2.5">
            {issues.map((i) => (
              <li key={i} className="text-[11.5px] text-flare">· {i}</li>
            ))}
          </ul>
        )}

        <div className="flex gap-2 pt-1">
          <button
            className={`${primary} py-2`}
            disabled={busy || issues.length > 0}
            onClick={() => onSave(d)}
          >
            {busy ? 'שומר…' : 'שמירה'}
          </button>
          <button className={ghost} disabled={busy} onClick={onCancel}>ביטול</button>
        </div>
      </div>
    </Card>
  );
}

/* ================================================================== */
/* 10 · המשפך והלידים                                                  */
/* ================================================================== */

/**
 * ★★ מה המסך הזה עונה עליו, ומה הוא מסרב לענות ★★
 *
 * שאלה אחת: **איפה אנשים נעצרים.**
 *
 * נכנסו → שיחקו → שמרו כרטיס → השאירו מייל → נרשמו. חמישה
 * מספרים, וכל מעבר ביניהם הוא מקום שאפשר לתקן. מספר שישי לא
 * מוסיף תובנה — הוא מוסיף עוד דבר להסתכל עליו במקום להחליט.
 *
 * ★ מה שאין כאן בכוונה: שיוך אישי.
 *   אין "מי המשתמש שנטש", אין מסע לקוח, אין טיימליין אישי. אנחנו
 *   סופרים מעברים, לא עוקבים אחרי אנשים — וההבדל הזה הוא מה
 *   שמאפשר לומר למשתמש בפנים ישרות שהוא לא על החכה.
 */
export function AdminFunnel() {
  const [f, setF] = useState<Funnel | null>(null);
  const [rows, setRows] = useState<LeadRow[] | null>(null);
  const [days, setDays] = useState<DailyRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    Promise.all([adminFunnel(), adminLeads(200), adminDaily(14)])
      .then(([a, b, c]) => { setF(a); setRows(b); setDays(c); setErr(null); })
      .catch((e: unknown) =>
        setErr(errorMessageHe(e instanceof Error ? e.message : 'NETWORK')));
  };

  /**
   * ★ ההורדה נבנית ונמחקת באותה פעולה.
   *
   * `URL.revokeObjectURL` הוא לא נימוס: בלעדיו כל לחיצה על
   * "ייצוא" משאירה את כל הקובץ בזיכרון של הלשונית עד לרענון.
   */
  const exportCsv = () => {
    void adminLeadsCsv().then((csv) => {
      /* ★ BOM בתחילת הקובץ. אקסל בעברית פותח UTF-8 בלי BOM
         כג׳יבריש, וזה הדבר הראשון שנשבר בייצוא בעברית. */
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dubid-leads-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }).catch((e: unknown) =>
      setErr(errorMessageHe(e instanceof Error ? e.message : 'NETWORK')));
  };

  useEffect(load, []);

  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');

  return (
    <div className="space-y-4">
      <Card title="המשפך" hint="איפה אנשים נעצרים. כל שלב הוא אחוז מהשלב שלפניו.">
        {err && <Note msg={err} bad />}
        {f && (
          <>
            <ul className="space-y-1.5">
              <Step label="נכנסו" n={f.users} of={f.users} pct={pct} first />
              <Step label="שיחקו — הגישו הרכב" n={f.played} of={f.users} pct={pct} />
              <Step label="שמרו כרטיס מנוי" n={f.withPass} of={f.played} pct={pct} />
              <Step label="השאירו מייל" n={f.leads} of={f.played} pct={pct} />
              <Step label="הפכו לחשבון קבוע" n={f.registered} of={f.played} pct={pct} />
            </ul>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <Stat label="אורחים" value={f.guests} />
              <Stat label="כרטיסים ששימשו" value={f.passUsed} />
              <Stat label="אישרו תזכורות" value={f.leadsOptIn} />
            </div>

            {/* ★ המספר היחיד שמעניין באמת בשלב הזה.
                כרטיס שאיש לא השתמש בו הוא כרטיס שלא הוכיח את
                עצמו — או שאף אחד לא איבד מכשיר, או שהכרטיס לא
                עובד. שתי מסקנות שונות מאוד מאותו מספר. */}
            {f.withPass > 0 && f.passUsed === 0 && (
              <p className="mt-3 rounded-xl border border-armband/30 bg-armband/10 px-3 py-2
                            text-[11.5px] leading-snug text-armband">
                הונפקו <span className="num">{f.withPass}</span> כרטיסים ואף אחד עוד לא
                שימש. זה תקין בשבועות הראשונים — כרטיס נועד לרגע שבו מחליפים מכשיר.
              </p>
            )}
          </>
        )}
        <button onClick={load} className={`${ghost} mt-3`}>רענון</button>
      </Card>

      {days.length > 0 && <DailyChart rows={days} />}

      <Card
        title="לידים"
        hint="רק מה שאנשים הקלידו והגישו בעצמם. «תזכורות» = אישרו במפורש."
      >
        <button onClick={exportCsv} className={`${ghost} mb-3`}>
          ייצוא ל-CSV
        </button>
        {rows === null ? (
          <p className="text-[12px] text-chalk-dim">טוען…</p>
        ) : rows.length === 0 ? (
          <p className="text-[12px] leading-snug text-chalk-dim">
            אין עדיין לידים. השדה מופיע בכרטיס המנוי, אחרי ההגשה הראשונה.
          </p>
        ) : (
          <ul className="space-y-1">
            {rows.map((r) => (
              <li key={r.email + r.at}
                  className="flex items-baseline gap-2 border-b border-gold/10 py-1.5 last:border-0">
                <span className="min-w-0 flex-1">
                  <bdi dir="ltr" className="block truncate text-[12.5px] text-chalk">
                    {r.email}
                  </bdi>
                  <span className="text-[10.5px] text-chalk-dim">
                    {r.name} · {r.source}
                    {r.entries > 0 && <> · <span className="num">{r.entries}</span> הגשות</>}
                    {!r.isGuest && ' · רשום'}
                  </span>
                </span>
                {r.consent && (
                  <span className="shrink-0 rounded bg-gold/15 px-1.5 py-px text-[9.5px]
                                   font-black text-gold">
                    תזכורות
                  </span>
                )}
                <span className="num shrink-0 text-[10.5px] text-chalk-dim">
                  {r.at.slice(5, 10)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Step({
  label, n, of, pct, first = false,
}: {
  label: string; n: number; of: number;
  pct: (a: number, b: number) => string; first?: boolean;
}) {
  const share = of > 0 ? Math.min(100, Math.round((n / of) * 100)) : 0;
  return (
    <li>
      <div className="flex items-baseline gap-2">
        <span className="flex-1 text-[12.5px] text-chalk">{label}</span>
        <span className="num text-[13px] text-gold">{n}</span>
        {!first && <span className="num w-10 text-end text-[11px] text-chalk-dim">{pct(n, of)}</span>}
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-night">
        <div className="h-full rounded-full bg-gold/70" style={{ width: `${share}%` }} />
      </div>
    </li>
  );
}

/**
 * ארבעה עשר ימים אחורה — הגרף היחיד שצריך כאן.
 *
 * ★ ארבעה קווים ולא ארבעה גרפים.
 *
 * השאלה היא "האם המוצר גדל, ואיפה", והתשובה עליה נמצאת
 * **ביחסים** בין הסדרות: אם ההגשות עולות והכרטיסים לא, המשמעות
 * שונה לגמרי מזה ששניהם עולים. ארבעה גרפים נפרדים היו מסתירים
 * בדיוק את מה שמעניין.
 *
 * ★ העמודות ולא קווים חלקים: המספרים כאן קטנים ובדידים (שלוש
 *   הגשות ביום זה מספר אמיתי), וקו חלק מעליהם מרמז על מגמה
 *   שאין לה מספיק דאטה מאחוריה.
 */
function DailyChart({ rows }: { rows: DailyRow[] }) {
  const series: Array<[keyof DailyRow, string, string]> = [
    ['newUsers', 'נכנסו', '#8B7F6A'],
    ['entries', 'הגשות', '#D8B25C'],
    ['passes', 'כרטיסים', '#2E9E6B'],
    ['leads', 'לידים', '#E4453B'],
  ];

  const max = Math.max(
    1,
    ...rows.flatMap((r) => series.map(([k]) => Number(r[k]) || 0)),
  );

  return (
    <Card title="ארבעה עשר יום" hint="כל עמודה היא יום. הגובה יחסי ליום החזק ביותר.">
      <div className="flex items-end gap-[3px]" dir="ltr" style={{ height: 92 }}>
        {rows.map((r) => (
          <div key={r.day} className="flex h-full flex-1 items-end gap-[1px]"
               title={`${r.day} · נכנסו ${r.newUsers} · הגשות ${r.entries} · כרטיסים ${r.passes} · לידים ${r.leads}`}>
            {series.map(([k, , color]) => {
              const v = Number(r[k]) || 0;
              return (
                <span
                  key={String(k)}
                  className="flex-1 rounded-t-[2px]"
                  style={{
                    background: color,
                    /* ★ מינימום פיקסל אחד לערך אפס: עמודה שנעלמת
                       לגמרי נראית כמו יום שלא נטען, ולא כמו יום
                       שבו לא קרה כלום. */
                    height: v === 0 ? 1 : `${Math.max(3, (v / max) * 100)}%`,
                    opacity: v === 0 ? 0.3 : 1,
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {series.map(([k, label, color]) => (
          <span key={String(k)} className="flex items-center gap-1 text-[10.5px] text-chalk-dim">
            <span className="size-2 rounded-sm" style={{ background: color }} />
            {label}
          </span>
        ))}
        <span className="num ms-auto text-[10px] text-chalk-dim">שיא {max}</span>
      </div>
    </Card>
  );
}

/* ================================================================== */
/* 11 · חיבורים — מה צריך להיות מוגדר, ואיפה                           */
/* ================================================================== */

/**
 * ═══════════════════════════════════════════════════════════════
 * ★★★ למה מסך כזה קיים בכלל ★★★
 * ═══════════════════════════════════════════════════════════════
 *
 * `redirect_uri_mismatch` היא השגיאה הכי מתסכלת שיש: היא נכונה,
 * היא מדויקת, והיא לא אומרת **איזו** כתובת חסרה. המפתח מנחש,
 * מדביק משהו דומה, ומקבל את אותה שגיאה שוב.
 *
 * המסך הזה מדפיס את המחרוזות **המדויקות** — נגזרות מכתובת
 * הפרויקט החי, לא מוקלדות ביד — עם כפתור העתקה. זה הופך תקלה
 * של חצי שעה לפעולה של שלוש שניות.
 *
 * ★ למה זה לא רק בתיעוד
 *
 * מחרוזת שכתובה בקובץ תיעוד היא מחרוזת שתהיה שגויה ביום
 * שהפרויקט יוחלף, ואף אחד לא יזכור לעדכן אותה. כאן היא תמיד
 * נכונה, כי היא נבנית מהחיבור עצמו.
 */
export function AdminConnections() {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (label: string, value: string) => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1800);
    }).catch(() => { /* דפדפן ישן — הערך ממילא מוצג ואפשר לסמן ידנית */ });
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  /*
   * ═══════════════════════════════════════════════════════════════
   * ★★★ מזהה לקוח אחד, שני מוצרים ★★★
   * ═══════════════════════════════════════════════════════════════
   *
   * דוביד ואופסיידס חולקים **OAuth client אחד** בגוגל. זו החלטה
   * נכונה: מסך הסכמה אחד, שם אחד, והמשתמש לא נשאל פעמיים.
   *
   * אבל היא מחייבת דבר אחד שקל לפספס: אותו client חייב להכיר את
   * **שתי** כתובות ההחזרה — אחת לכל פרויקט Supabase. גוגל מפנה
   * אל Supabase, לא אל האתר, ולשני הפרויקטים יש כתובות שונות.
   *
   * אם רק אחת רשומה, המוצר השני מקבל `redirect_uri_mismatch` —
   * וזו בדיוק התקלה שהמסך הזה נועד לסגור אחת ולתמיד.
   */
  const rows: Array<{
    label: string; value: string; where: string; why: string; must: boolean;
  }> = [
    {
      label: 'כתובת החזרה · דוביד',
      value: googleCallbackUrl(),
      where: 'Google Cloud → Credentials → OAuth client → Authorized redirect URIs',
      why: 'בלעדיה: Error 400 · redirect_uri_mismatch בכניסה לדוביד.',
      must: true,
    },
    {
      label: 'כתובת החזרה · אופסיידס',
      value: offsidesCallbackUrl(),
      where: 'אותו מסך בדיוק — שורה שנייה ברשימה. לא להחליף, להוסיף.',
      why: 'בלעדיה אופסיידס יישבר ברגע שתעביר אותו למזהה הלקוח החדש.',
      must: true,
    },
    {
      label: 'מקור JavaScript',
      value: origin,
      where: 'אותו מסך, בשדה Authorized JavaScript origins',
      why: 'מומלץ. נדרש רק אם יתווסף בעתיד One Tap, אבל עדיף מראש.',
      must: false,
    },
    {
      label: 'Supabase · Site URL',
      value: origin,
      where: 'Supabase (דוביד) → Authentication → URL Configuration',
      why: 'לאן Supabase מחזירה את המשתמש אחרי שגוגל אישרה.',
      must: true,
    },
    {
      label: 'Supabase · Redirect URL',
      value: `${origin}/**`,
      where: 'אותו מסך, ברשימת Redirect URLs',
      why: 'בלי זה ההחזרה נחסמת גם כשגוגל אישרה.',
      must: true,
    },
  ];

  return (
    <div className="space-y-4">
      <Card
        title="חיבור גוגל"
        hint="להעתיק כל מחרוזת למקום שכתוב לידה. שתי כתובות ההחזרה הן חובה — אחת לכל מוצר."
      >
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.label} className="rounded-xl border border-gold/12 bg-night p-3">
              <div className="flex items-baseline gap-2">
                <span className="flex-1 text-[12px] font-black text-chalk">
                  {r.label}
                  {!r.must && (
                    <span className="ms-1.5 text-[9.5px] font-bold text-chalk-dim">
                      לא חובה
                    </span>
                  )}
                </span>
                <button onClick={() => copy(r.label, r.value)} className={ghost}>
                  {copied === r.label ? 'הועתק ✓' : 'העתקה'}
                </button>
              </div>
              <code
                dir="ltr"
                className="mt-1.5 block overflow-x-auto whitespace-nowrap rounded-lg
                           bg-night-2 px-2.5 py-2 text-[12px] text-gold-light"
              >
                {r.value}
              </code>
              <p className="mt-1.5 text-[11px] leading-snug text-chalk-dim">{r.where}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-chalk-dim/80">{r.why}</p>
            </li>
          ))}
        </ul>

        {/*
          ★★ ההבהרה שחוסכת ויכוח מאוחר ★★

          שיתוף מזהה הלקוח של גוגל בין שני פרויקטים **לא** מאחד
          את המשתמשים. לכל פרויקט Supabase יש `auth.users` משלו.
          מה שמשותף הוא מסך ההסכמה — ומה שמזהה את אותו אדם הוא
          המייל.
        */}
        <div className="mt-3 rounded-xl border border-armband/30 bg-armband/10 px-3 py-2.5">
          <p className="text-[11.5px] font-black text-armband">
            מזהה לקוח משותף — מה זה כן נותן, ומה לא
          </p>
          <p className="mt-1 text-[11.5px] leading-snug text-chalk-2">
            <b>כן:</b> מסך הסכמה אחד, שם אפליקציה אחד, והמשתמש לא נשאל
            פעמיים כשהוא עובר בין המוצרים.
          </p>
          <p className="mt-1 text-[11.5px] leading-snug text-chalk-2">
            <b>לא:</b> זה <b>אינו</b> מאחד את המשתמשים. לכל פרויקט
            Supabase יש טבלת <span className="num">auth.users</span> משלו.
            מה שמזהה את אותו אדם בשני המוצרים הוא <b>המייל</b>.
          </p>
        </div>

        {/* ★ שני המחסומים הבאים אחרי ה-redirect URI.
            שניהם נראים כמו "זה לא עובד" ושניהם לא קשורים לקוד,
            ולכן הם כתובים כאן ולא בתיעוד שאיש לא פותח. */}
        <div className="mt-2 rounded-xl border border-gold/20 bg-night px-3 py-2.5">
          <p className="text-[11.5px] font-black text-chalk">
            שתי מלכודות במסך ההסכמה
          </p>
          <p className="mt-1 text-[11.5px] leading-snug text-chalk-2">
            <b>1 · מצב Testing.</b> פרויקט חדש בגוגל מתחיל במצב בדיקה:
            רק מיילים שהוספת ל-Test users יכולים להיכנס, עד 100.
            מי שלא ברשימה מקבל שגיאה. לפני השקה —
            <b> Publish app</b>.
          </p>
          <p className="mt-1 text-[11.5px] leading-snug text-chalk-2">
            <b>2 · שם האפליקציה.</b> זה מה שכתוב במסך ההסכמה שהמשתמש
            רואה. פרויקט חדש נוצר עם שם אוטומטי מכוער — כדאי לשנות
            ל־<b>DubelTeam</b> ולהעלות לוגו.
          </p>
        </div>
      </Card>

      <Card
        title="קוד במייל במקום קישור"
        hint="לא חובה. בלי זה המוצר עובד עם קישור, וזה תקין לגמרי."
      >
        <p className="text-[12px] leading-snug text-chalk-2">
          תבנית המייל של Supabase שולחת כברירת מחדל <b>קישור בלבד</b>.
          כדי שיישלח גם קוד בן שש ספרות, להוסיף שורה אחת לתבנית:
        </p>
        <code
          dir="ltr"
          className="mt-2 block overflow-x-auto whitespace-nowrap rounded-lg bg-night px-2.5 py-2
                     text-[12px] text-gold-light"
        >
          {'<p>הקוד שלך: {{ .Token }}</p>'}
        </code>
        <p className="mt-1.5 text-[11px] leading-snug text-chalk-dim">
          Supabase → Authentication → Email Templates → Magic Link (וגם
          Change Email Address).
        </p>
        <button
          onClick={() => copy('token', '<p>הקוד שלך: {{ .Token }}</p>')}
          className={`${ghost} mt-2`}
        >
          {copied === 'token' ? 'הועתק ✓' : 'העתקה'}
        </button>
      </Card>

      {/* ★ הסוד לא מופיע כאן ולא בשום מקום בקוד.
          מפתח שנכנס פעם אחת לריפו נשאר בהיסטוריה שלו לנצח, גם
          אחרי שמוחקים את הקובץ. מקומו היחיד הוא שדה בלוח
          הבקרה של Supabase. */}
      <Card
        title="איפה שמים את המפתחות"
        hint="הסוד לא נמצא בקוד, ולא צריך להיות. הוא נכנס ידנית לשני מקומות."
      >
        <ol className="space-y-2 text-[12px] leading-snug text-chalk-2">
          <li>
            <b className="text-chalk">Supabase של דוביד</b> → Authentication →
            Providers → Google → להדביק Client ID ו-Client Secret.
          </li>
          <li>
            <b className="text-chalk">Supabase של אופסיידס</b> → אותו מסך →
            להדביק את <b>אותם</b> שני ערכים.
          </li>
        </ol>
        <p className="mt-2 rounded-lg border border-flare/25 bg-flare/5 px-2.5 py-2
                      text-[11px] leading-snug text-chalk-2">
          ⚠ ה-Client Secret הוא סוד אמיתי. אם קובץ ה-JSON שהורדת
          מגוגל נשלח במייל או בצ׳אט — כדאי ליצור סוד חדש
          (<span dir="ltr">Reset secret</span>) ולעדכן בשני המקומות.
        </p>
      </Card>

      <Card title="מה לא צריך" hint="כדי שלא תחפש.">
        <ul className="space-y-1.5 text-[12px] leading-snug text-chalk-2">
          <li>· אין צורך ב-Supabase CLI.</li>
          <li>· אין צורך לפרוס Edge Functions — אף מסך לא קורא להן.</li>
          <li>· אין צורך במפתח <span className="num">service_role</span> בשום מקום.</li>
        </ul>
      </Card>
    </div>
  );
}
