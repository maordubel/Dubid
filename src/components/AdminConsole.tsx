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
  errorMessageHe,
  type GameweekRow, type ImportReport, type ContentRow,
  type Analytics, type DataIssue, type AuditRow,
} from '../lib/store.ts';
import { ruleOverrides, currentGameweekCode } from '../lib/liveData.ts';
import { RULE_KEYS, readRule } from '../lib/ruleOverrides.ts';
import { CONTENT_KEYS } from '../lib/content.ts';
import { resolveRules, DUBID_5X5 } from '../lib/scoring/rules.ts';
import { TEAMS } from '../data/squads.ts';
import { GAMEWEEK } from '../data/fixtures.ts';

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
      .finally(() => setBusy(false));
  };

  return { busy, msg, bad, run, clear: () => setMsg(null) };
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
  useEffect(() => { if (act.msg && !act.bad) load(); }, [act.msg, act.bad]);

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

  useEffect(() => { setTarget(current); }, [current]);

  const teamHelp = useMemo(
    () => TEAMS.map((t) => `${t.externalId} = ${t.nameHe}`).join(' · '), []);

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

    act.run(async () => {
      const r = await adminImportFixtures(
        target, parsed as Array<{ home: string; away: string; kickoff: string }>, replace);
      setReport(r);
      const bits = [`נקלטו ${r.added + r.updated} מתוך ${r.received}`];
      if (r.removed) bits.push(`${r.removed} הוסרו`);
      if (r.lockAt) bits.push(`הדדליין: ${fmt(r.lockAt)}`);
      if (r.problems.length) bits.push(`${r.problems.length} שורות נדחו`);
      return bits.join(' · ');
    });
  };

  return (
    <Card
      title="קליטת לוח משחקים"
      hint="הדבק JSON. אותו נתיב בדיוק ישמש את ה-API כשיתחבר — היום ידני, מחר אוטומטי."
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
  const base = useMemo(() => resolveRules(TEAMS.length).rules, []);

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
          const n = Number(value);
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
  useEffect(() => { if (act.msg && !act.bad) load(); }, [act.msg, act.bad]);

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
