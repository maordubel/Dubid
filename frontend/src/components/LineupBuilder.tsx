/**
 * LineupBuilder.tsx
 *
 * מסך בניית ההרכב — הלב של המוצר.
 * שלושה עקרונות שמנחים כל שורה כאן:
 *
 *  1. Mobile First אמיתי: הכל נבנה לרוחב 360px ולמגע. אין hover כאפשרות
 *     יחידה, יעדי מגע 44px, בחירה דרך bottom-sheet ולא דרך מודאל מרכזי.
 *  2. RTL אמיתי: אך ורק logical properties (ps/pe/ms/me/start/end).
 *     אין left/right בשום מקום. מספרים עטופים ב-dir="ltr" כדי שלא יתהפכו.
 *  3. האילוץ הוא UI, לא שגיאה: קבוצה שכבר נבחרה מוצגת נעולה מראש.
 *     המשתמש לא אמור לגלות את החוק דרך הודעת שגיאה.
 */
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

// ---------------------------------------------------------------------------
// טיפוסים (משקפים 1:1 את ה-DTO של ה-API)
// ---------------------------------------------------------------------------
type Position = "GK" | "DEF" | "MID" | "FWD";

export interface Player {
  id: string;
  teamId: string;
  position: Position;
  /** שמות מגיעים כבר מותאמים לשפת המשתמש מה-API (Accept-Language) */
  name: string;
  nameShort: string;
  teamName: string;
  crestUrl?: string;
  form?: number;
}

export interface Slot {
  slotNo: number;
  position: Position;
  player?: Player;
}

const FORMATIONS: Record<string, Position[]> = {
  "4-3-3": ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "FWD", "FWD", "FWD"],
  "4-4-2": ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "MID", "FWD", "FWD"],
  "3-5-2": ["GK", "DEF", "DEF", "DEF", "MID", "MID", "MID", "MID", "MID", "FWD", "FWD"],
};

const POSITION_LABEL: Record<Position, string> = {
  GK: "שוער", DEF: "הגנה", MID: "קישור", FWD: "התקפה",
};

// ---------------------------------------------------------------------------
// הקומפוננטה
// ---------------------------------------------------------------------------
export function LineupBuilder({
  pool,
  formation = "4-3-3",
  onSubmit,
}: {
  pool: Player[];
  formation?: keyof typeof FORMATIONS;
  onSubmit: (slots: Slot[], captainId: string) => Promise<void>;
}) {
  const [slots, setSlots] = useState<Slot[]>(() =>
    FORMATIONS[formation].map((position, i) => ({ slotNo: i + 1, position })),
  );
  const [captainId, setCaptainId] = useState<string | null>(null);
  const [picking, setPicking] = useState<Slot | null>(null);

  /** ★ האילוץ: כל קבוצה שכבר מיוצגת בהרכב נחסמת. */
  const usedTeamIds = useMemo(
    () => new Set(slots.map((s) => s.player?.teamId).filter(Boolean) as string[]),
    [slots],
  );

  const filled = slots.filter((s) => s.player).length;
  const isComplete = filled === slots.length && captainId !== null;

  function assign(slotNo: number, player: Player) {
    setSlots((prev) =>
      prev.map((s) => (s.slotNo === slotNo ? { ...s, player } : s)),
    );
    setPicking(null);
  }

  function clear(slotNo: number) {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.slotNo !== slotNo) return s;
        if (s.player?.id === captainId) setCaptainId(null);
        return { ...s, player: undefined };
      }),
    );
  }

  return (
    // dir יורש מ-<html dir="rtl">. מציינים כאן רק לתיעוד/בידוד.
    <div dir="rtl" className="flex min-h-[100dvh] flex-col bg-ink text-cream">
      <Header filled={filled} total={slots.length} />

      {/* המגרש. יחס גובה-רוחב קבוע כדי שלא יזוז בין מכשירים */}
      <main className="flex-1 overflow-y-auto px-3 pb-[calc(96px+theme(spacing.safe-b))]">
        <div className="mx-auto w-full max-w-md">
          <Pitch slots={slots} captainId={captainId}
                 onPick={setPicking} onClear={clear} onCaptain={setCaptainId} />
        </div>
      </main>

      {/* CTA צף עם safe-area — לא נחתך על אייפון */}
      <div className="fixed inset-x-0 bottom-0 border-t border-cream/10 bg-ink/95
                      px-4 pb-[calc(12px+theme(spacing.safe-b))] pt-3 backdrop-blur">
        <button
          disabled={!isComplete}
          onClick={() => captainId && onSubmit(slots, captainId)}
          className="h-tap w-full rounded-chip bg-gold font-display text-lg font-black
                     text-ink transition-[opacity,transform] duration-200 ease-brand
                     active:scale-[.98] disabled:bg-ink-3 disabled:text-terrace"
        >
          {isComplete ? "נעילת הרכב" : `נותרו ${slots.length - filled} שחקנים`}
        </button>
      </div>

      <AnimatePresence>
        {picking && (
          <PlayerSheet
            slot={picking}
            pool={pool}
            usedTeamIds={usedTeamIds}
            onClose={() => setPicking(null)}
            onSelect={(p) => assign(picking.slotNo, p)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Header({ filled, total }: { filled: number; total: number }) {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-3
                       border-b border-cream/10 bg-ink/95 px-4 pt-[calc(12px+theme(spacing.safe-t))]
                       pb-3 backdrop-blur">
      <div>
        <h1 className="font-display text-xl font-black leading-tight">מחזור 7</h1>
        {/* מספרים תמיד LTR + tabular כדי שלא ירקדו ולא יתהפכו */}
        <p className="text-xs text-terrace">
          נעילה בעוד{" "}
          <span dir="ltr" className="font-num tabular-nums">02:14:38</span>
        </p>
      </div>
      <div className="text-end">
        <div dir="ltr" className="font-num text-2xl font-bold tabular-nums text-gold">
          {filled}/{total}
        </div>
        <div className="text-[11px] text-terrace">שחקנים</div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
function Pitch({
  slots, captainId, onPick, onClear, onCaptain,
}: {
  slots: Slot[];
  captainId: string | null;
  onPick: (s: Slot) => void;
  onClear: (n: number) => void;
  onCaptain: (id: string) => void;
}) {
  const rows: Position[] = ["GK", "DEF", "MID", "FWD"];
  return (
    <div className="mt-4 space-y-5 rounded-card bg-ink-2 p-3
                    ring-1 ring-inset ring-cream/10 short:space-y-3">
      {rows.map((row) => {
        const rowSlots = slots.filter((s) => s.position === row);
        if (!rowSlots.length) return null;
        return (
          <section key={row} aria-label={POSITION_LABEL[row]}>
            <h2 className="mb-2 ps-1 text-[11px] font-bold tracking-widest text-terrace">
              {POSITION_LABEL[row]}
            </h2>
            {/* auto-fit: 3 בשורה ב-360px, 4-5 במסך רחב. בלי media queries ידניות */}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(84px,1fr))] gap-2">
              {rowSlots.map((s) => (
                <SlotCard
                  key={s.slotNo} slot={s}
                  isCaptain={!!s.player && s.player.id === captainId}
                  onPick={() => onPick(s)}
                  onClear={() => onClear(s.slotNo)}
                  onCaptain={() => s.player && onCaptain(s.player.id)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function SlotCard({
  slot, isCaptain, onPick, onClear, onCaptain,
}: {
  slot: Slot; isCaptain: boolean;
  onPick: () => void; onClear: () => void; onCaptain: () => void;
}) {
  if (!slot.player) {
    return (
      <button
        onClick={onPick}
        aria-label={`הוסף ${POSITION_LABEL[slot.position]}`}
        className="flex aspect-[3/4] min-h-tap flex-col items-center justify-center
                   gap-1 rounded-xl border border-dashed border-cream/25
                   text-terrace transition-colors duration-200 ease-brand
                   active:border-gold active:text-gold"
      >
        <span className="text-2xl leading-none">+</span>
        <span className="text-[11px]">{POSITION_LABEL[slot.position]}</span>
      </button>
    );
  }

  const p = slot.player;
  return (
    <div className="relative flex aspect-[3/4] min-h-tap flex-col items-center
                    justify-center gap-1 rounded-xl bg-ink-3 p-1 text-center">
      {/* ה-badge יושב ב-start — מתהפך אוטומטית ב-LTR בלי קוד נוסף */}
      <button
        onClick={onCaptain}
        aria-pressed={isCaptain}
        aria-label={isCaptain ? "הסר קפטן" : "הפוך לקפטן"}
        className={`absolute start-1 top-1 grid size-6 place-items-center rounded-full
                    font-num text-[11px] font-bold transition-colors ease-brand
                    ${isCaptain ? "bg-gold text-ink" : "bg-ink/70 text-terrace"}`}
      >
        C
      </button>
      <button onClick={onClear} aria-label="הסר שחקן"
              className="absolute end-1 top-1 grid size-6 place-items-center
                         rounded-full bg-ink/70 text-terrace">×</button>

      {p.crestUrl && <img src={p.crestUrl} alt="" className="size-6" />}
      {/* bidi isolation: שם לטיני בתוך משפט עברי לא ישבור את הסדר */}
      <bdi className="line-clamp-2 text-[12px] font-bold leading-tight">
        {p.nameShort}
      </bdi>
      <span className="text-[10px] text-terrace">{p.teamName}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bottom sheet לבחירת שחקן — התבנית הנכונה למובייל, לא מודאל
// ---------------------------------------------------------------------------
function PlayerSheet({
  slot, pool, usedTeamIds, onClose, onSelect,
}: {
  slot: Slot; pool: Player[]; usedTeamIds: Set<string>;
  onClose: () => void; onSelect: (p: Player) => void;
}) {
  const [query, setQuery] = useState("");

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pool
      .filter((p) => p.position === slot.position)
      .filter((p) => !q || p.name.toLowerCase().includes(q) ||
                     p.teamName.toLowerCase().includes(q))
      // ★ שחקנים מקבוצה תפוסה יורדים לסוף ומוצגים נעולים
      .sort((a, b) =>
        Number(usedTeamIds.has(a.teamId)) - Number(usedTeamIds.has(b.teamId)) ||
        (b.form ?? 0) - (a.form ?? 0));
  }, [pool, slot.position, query, usedTeamIds]);

  return (
    <motion.div
      className="fixed inset-0 z-20 flex items-end bg-ink/70"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        role="dialog" aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        className="max-h-[85dvh] w-full overflow-hidden rounded-t-card bg-ink-2
                   pb-[theme(spacing.safe-b)]"
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-cream/25" />
        <div className="px-4 py-3">
          <h2 className="font-display text-lg font-black">
            בחירת {POSITION_LABEL[slot.position]}
          </h2>
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש שחקן או קבוצה…"
            /* inputMode + enterKeyHint = מקלדת מובייל נכונה */
            inputMode="search" enterKeyHint="search" autoComplete="off"
            className="mt-3 h-tap w-full rounded-chip bg-ink px-4 text-start
                       text-cream placeholder:text-terrace
                       focus:outline-none focus:ring-2 focus:ring-gold"
          />
        </div>

        <ul className="max-h-[60dvh] overflow-y-auto overscroll-contain px-2 pb-4">
          {candidates.map((p) => {
            const blocked = usedTeamIds.has(p.teamId);
            return (
              <li key={p.id}>
                <button
                  disabled={blocked}
                  onClick={() => onSelect(p)}
                  className="flex h-tap w-full items-center gap-3 rounded-xl px-2
                             text-start transition-colors ease-brand
                             active:bg-ink-3 disabled:opacity-40"
                >
                  {p.crestUrl && <img src={p.crestUrl} alt="" className="size-7 shrink-0" />}
                  <span className="min-w-0 flex-1">
                    <bdi className="block truncate text-sm font-bold">{p.name}</bdi>
                    <span className="block truncate text-[11px] text-terrace">
                      {p.teamName}
                      {blocked && " · כבר יש לך שחקן מהקבוצה הזו"}
                    </span>
                  </span>
                  {p.form !== undefined && (
                    <span dir="ltr" className="font-num text-sm tabular-nums text-gold">
                      {p.form.toFixed(1)}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </motion.div>
    </motion.div>
  );
}
