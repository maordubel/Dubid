/**
 * events/providers/apiFootball.ts — מתאם API-Football → לוג האירועים.
 *
 * ★ הגבול
 *
 * זה **הקובץ היחיד** במערכת שמכיר שמות שדות של ספק חיצוני.
 * `e.detail === 'Own Goal'` מופיע כאן ורק כאן. שאר המוצר מדבר
 * `EventKind.OwnGoal` ולא יודע מאיפה זה הגיע.
 *
 * הברִיף מנסח את זה כך: "אין לפזר שמות שדות של הספק ברחבי
 * האפליקציה. הספק חייב להישאר בר-החלפה." להחליף ספק = לכתוב
 * קובץ אחיד נוסף ליד זה, ולא לגעת בשום מקום אחר.
 *
 * ★ מה זה לא עושה
 *
 * לא ניקוד, לא DB, לא fetch. פונקציה טהורה מ-JSON של הספק אל
 * `DraftEvent[]`. מי שמביא את ה-JSON הוא Edge Function עם המפתח
 * הסודי — המפתח לעולם לא מגיע לדפדפן.
 */
import { EventKind, type DraftEvent, type MatchPhase } from '../types.ts';

/* ------------------------------------------------------------------ */
/* צורת הנתונים של הספק                                                */
/* ------------------------------------------------------------------ */

export interface ApiFootballEvent {
  time?: { elapsed?: number | null; extra?: number | null };
  team?: { id?: number | string; name?: string };
  player?: { id?: number | string; name?: string };
  assist?: { id?: number | string; name?: string };
  /** "Goal" | "Card" | "subst" | "Var" */
  type?: string;
  /** "Normal Goal" | "Own Goal" | "Penalty" | "Missed Penalty" | "Yellow Card" | ... */
  detail?: string;
  comments?: string | null;
}

/** מיפוי מזהי הספק למזהים הפנימיים. בלעדיו אין קשר לסגל שלנו. */
export interface IdMaps {
  team: (externalId: string) => string | undefined;
  player: (externalId: string) => string | undefined;
}

export interface AdaptOptions {
  ids: IdMaps;
  /**
   * אירועים שלא הצלחנו למפות. ברירת המחדל: לדלג ולדווח.
   * ★ לא ממציאים מזהה. אירוע ששויך לשחקן הלא נכון גרוע בהרבה
   *   מאירוע חסר — הראשון משקר, השני רק חסר.
   */
  onUnmapped?: (event: ApiFootballEvent, reason: string) => void;
}

/* ------------------------------------------------------------------ */

const lower = (s: unknown) => String(s ?? '').toLowerCase();

/** דקה 45+2 מגיעה כ-elapsed:45, extra:2. שומרים את ההפרדה. */
function timing(e: ApiFootballEvent): { minute: number; stoppage: number; phase: MatchPhase } {
  const minute = Math.max(0, Math.min(130, e.time?.elapsed ?? 0));
  const stoppage = Math.max(0, e.time?.extra ?? 0);
  // הספק לא מחזיר מחצית במפורש — נגזר מהדקה. 105 ומעלה = הארכה שנייה.
  const phase: MatchPhase =
    minute > 105 ? 'ET2' : minute > 90 ? 'ET1' : minute > 45 ? '2H' : '1H';
  return { minute, stoppage, phase };
}

/**
 * ממיר אירוע בודד. מחזיר מערך כי אירוע אחד אצל הספק יכול להיות
 * שניים אצלנו: שער עם בישול, או חילוף (יוצא + נכנס).
 */
export function adaptEvent(e: ApiFootballEvent, opts: AdaptOptions): DraftEvent[] {
  const { ids, onUnmapped } = opts;

  const teamId = e.team?.id !== undefined ? ids.team(String(e.team.id)) : undefined;
  if (!teamId) {
    onUnmapped?.(e, 'team_not_mapped');
    return [];
  }

  const playerId = e.player?.id !== undefined ? ids.player(String(e.player.id)) : undefined;
  const assistId = e.assist?.id !== undefined ? ids.player(String(e.assist.id)) : undefined;
  const { minute, stoppage, phase } = timing(e);

  const base = {
    phase, minute, stoppage, teamId,
    source: 'provider' as const,
    confidence: 'verified' as const,
  };

  const type = lower(e.type);
  const detail = lower(e.detail);
  const out: DraftEvent[] = [];

  /* -------------------------------- שערים -------------------------- */
  if (type === 'goal') {
    if (!playerId) { onUnmapped?.(e, 'player_not_mapped'); return []; }

    if (detail.includes('own')) {
      out.push({ ...base, kind: EventKind.OwnGoal, playerId });
      return out; // שער עצמי אין לו בישול
    }
    if (detail.includes('missed')) {
      out.push({ ...base, kind: EventKind.PenaltyMissed, playerId });
      return out;
    }

    out.push({
      ...base,
      kind: detail.includes('penalty') ? EventKind.PenaltyScored : EventKind.Goal,
      playerId,
      relatedPlayerId: assistId,
    });

    // ★ פנדל לא מזכה בבישול. הספק לפעמים ממלא assist גם שם.
    if (assistId && !detail.includes('penalty')) {
      out.push({ ...base, kind: EventKind.Assist, playerId: assistId, relatedPlayerId: playerId });
    }
    return out;
  }

  /* -------------------------------- כרטיסים ------------------------ */
  if (type === 'card') {
    if (!playerId) { onUnmapped?.(e, 'player_not_mapped'); return []; }
    // הסדר חשוב: "Second Yellow card" מכיל גם "yellow" וגם מוביל לאדום.
    if (detail.includes('second yellow')) {
      out.push({ ...base, kind: EventKind.SecondYellow, playerId });
    } else if (detail.includes('red')) {
      out.push({ ...base, kind: EventKind.RedCard, playerId });
    } else if (detail.includes('yellow')) {
      out.push({ ...base, kind: EventKind.YellowCard, playerId });
    } else {
      onUnmapped?.(e, 'unknown_card_detail');
    }
    return out;
  }

  /* -------------------------------- חילופים ------------------------ */
  if (type === 'subst') {
    // ★ אצל API-Football ב-subst: `player` הוא הנכנס ו-`assist` היוצא.
    //   התיעוד לא עקבי בין ליגות, ולכן שני האירועים נרשמים בנפרד
    //   וכל אחד עומד בזכות עצמו — אם אחד חסר, השני עדיין נכון.
    if (playerId) out.push({ ...base, kind: EventKind.SubOn, playerId, relatedPlayerId: assistId });
    if (assistId) out.push({ ...base, kind: EventKind.SubOff, playerId: assistId, relatedPlayerId: playerId });
    if (!playerId && !assistId) onUnmapped?.(e, 'player_not_mapped');
    return out;
  }

  /* -------------------------------- VAR ---------------------------- */
  if (type === 'var') {
    // ★ VAR לא מתורגם לאירוע אוטומטית, בכוונה.
    //   "Goal cancelled" של הספק לא אומר *איזה* שער בוטל, וניחוש
    //   כאן ימחק שער אמיתי. הזרימה הנכונה: הספק מדווח, האדמין
    //   מאשר, ו-`voidEvent` מבטל את ה-seq הנכון עם סיבה כתובה.
    onUnmapped?.(e, 'var_requires_admin_review');
    return [];
  }

  onUnmapped?.(e, 'unknown_event_type');
  return [];
}

/**
 * ממיר משחק שלם.
 *
 * הסדר נשמר כפי שהספק החזיר אותו, אחרי מיון יציב לפי דקה — כך
 * שני סנכרונים של אותו משחק מייצרים בדיוק את אותו לוג.
 */
export function adaptFixture(
  events: readonly ApiFootballEvent[],
  opts: AdaptOptions,
): DraftEvent[] {
  return [...events]
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const ta = timing(a.e);
      const tb = timing(b.e);
      return (
        ta.minute - tb.minute ||
        ta.stoppage - tb.stoppage ||
        a.i - b.i // יציבות: סדר הספק שובר שוויון, אף פעם לא מיון מקרי
      );
    })
    .flatMap(({ e }) => adaptEvent(e, opts));
}
