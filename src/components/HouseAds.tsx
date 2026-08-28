/**
 * components/HouseAds.tsx — יחידות הפרסום הפנימי של דובל טים.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ שתי יחידות בלבד, ובכוונה
 * ═══════════════════════════════════════════════════════════════
 *
 *   HouseBanner  רצועה מלאה עם איור מותג. למסכים שיש בהם אוויר.
 *   HouseStrip   שורה אחת, בגובה של הערת שוליים. לכל השאר.
 *
 * שתיהן מציגות את **אותו** מאגר מודעות ומתחלפות באותו קצב.
 * ההבדל הוא כמה מקום הן לוקחות, לא מה הן אומרות.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★★ מה מונע מזה להיקרא כפרסומת ★★
 * ═══════════════════════════════════════════════════════════════
 *
 * ארבע החלטות, וכל אחת מהן מוותרת על משהו:
 *
 * 1. **"גם שלנו" ולא "מודעה".** התווית אומרת את האמת — זה מוצר
 *    של אותה חברה. מוצר אחות נקרא כהמלצה; מודעה נקראת כרעש.
 *    (עיקרון האחדות: "אחד משלנו" משכנע יותר מכל טיעון.)
 *
 * 2. **בלי הבהוב, בלי קפיצה, בלי פופ־אפ.** ההחלפה היא הצלבה
 *    רכה במקום. יחידה שזזה גונבת תשומת לב פעם אחת ואז
 *    מאומנת להתעלמות לתמיד.
 *
 * 3. **המשפט לפני המותג.** קודם השאלה, אחר כך מי שואל. הפוך —
 *    והעין מזהה לוגו זר ומדלגת לפני שקראה מילה.
 *
 * 4. **תמיד ניתן להתעלמות.** היחידה אף פעם לא חוסמת פעולה, אף
 *    פעם לא מעל תוכן, ואף פעם לא באמצע משימה.
 *
 * ★ ההחלפה עוצרת כשהלשונית ברקע.
 *   סבב שרץ בטאב מוסתר שורף חשיפות שאיש לא ראה, והופך את
 *   מדידת ה-CTR לחסרת ערך.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  BRANDS, ROTATE_MS, adAt, eligibleAds, houseUrl, seedOf,
  type Brand, type HouseAd,
} from '../lib/houseAds.ts';
import { adsAll, trackAd } from '../lib/adsStore.ts';
import type { Placement } from '../lib/growth.ts';

/** `noopener` הוא אבטחה ולא נימוס: בלעדיו הדף הנפתח מקבל גישה
 *  ל-`window.opener` שלנו. */
const LINK_REL = 'noopener noreferrer';

/* ================================================================== */
/* הסבב                                                                */
/* ================================================================== */

/**
 * בוחר את המודעה הנוכחית ומחליף אותה בקצב קבוע.
 *
 * ★ `tick` הוא מונה ולא `Math.random()` — ראו את ההסבר המלא
 *   ב-`lib/houseAds.ts`. בקצרה: אקראיות בתוך רינדור מחליפה את
 *   המודעה בזמן שהמשתמש קורא אותה.
 */
function useRotatingAd(placement: Placement, gameweekNumber: number) {
  const all = adsAll();
  const nowMs = Date.now();
  const pool = eligibleAds(all, placement, nowMs);
  const [tick, setTick] = useState(0);

  const count = pool.length;
  useEffect(() => {
    if (count < 2) return undefined;
    const id = window.setInterval(() => {
      /* ★ לשונית ברקע לא צוברת חשיפות. */
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      if (!hidden) setTick((n) => n + 1);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [count]);

  const seed = seedOf(`${placement}:${gameweekNumber}`);
  const ad = adAt(pool, seed, tick);

  /* ★ חשיפה נספרת פעם אחת לכל מודעה־שהוצגה, ולא בכל רינדור.
     בלי ה-ref הזה React StrictMode לבדו היה מכפיל כל מספר. */
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (!ad) return;
    const key = `${placement}:${ad.id}:${tick}`;
    if (seen.current === key) return;
    seen.current = key;
    trackAd(ad.id, placement, 'impression');
  }, [ad, placement, tick]);

  return ad;
}

/* ================================================================== */
/* 1 · הרצועה המלאה                                                    */
/* ================================================================== */

export function HouseBanner({
  placement, gameweekNumber, className = '',
}: {
  placement: Placement;
  gameweekNumber: number;
  className?: string;
}) {
  const ad = useRotatingAd(placement, gameweekNumber);
  if (!ad) return null;

  const brand = BRANDS[ad.brand];

  return (
    <a
      href={houseUrl(ad, placement, gameweekNumber)}
      target="_blank"
      rel={LINK_REL}
      onClick={() => trackAd(ad.id, placement, 'click')}
      className={`group relative flex items-stretch gap-0 overflow-hidden rounded-xl
                  border transition-colors duration-200 ease-brand ${className}`}
      style={{ borderColor: 'rgba(216,178,92,.22)', background: 'rgba(216,178,92,.045)' }}
    >
      {/* ---- האיור. רוחב קבוע, כדי שהטקסט לא יזוז בהחלפה ---- */}
      <span
        className="relative grid w-[86px] shrink-0 place-items-center overflow-hidden"
        style={{ background: brand.tint }}
        aria-hidden="true"
      >
        <BrandArt brand={ad.brand} />
      </span>

      {/* ---- הטקסט ---- */}
      <span className="min-w-0 flex-1 px-3 py-2.5">
        <span className="flex items-center gap-1.5">
          <span className="text-[8.5px] font-black tracking-[0.2em] text-chalk-dim">
            גם שלנו
          </span>
          <span className="h-px flex-1" style={{ background: 'rgba(216,178,92,.25)' }} />
          <BrandWord brand={ad.brand} size={10} />
        </span>

        {/* ★ הצלבה רכה. `key` על המודעה הוא מה שמפעיל מחדש את
            האנימציה בכל החלפה — בלי לזיז שום דבר במסך. */}
        {/*
          ★ הגוף נגלש לשתי שורות, והקריאה לפעולה יורדת לשורה משלה.

          קודם שניהם ישבו על שורה אחת עם `truncate`, והתוצאה על
          מסך טלפון הייתה משפט שנחתך באמצע: "…ומה לדלג עליו —
          בעיר…". משפט קטוע לא מייצר סקרנות אלא רושם של תקלה,
          וזה בדיוק ההפך ממה שהיחידה הזו צריכה לעשות.

          שתי שורות ולא ללא הגבלה: מודעה שגדלה לפי אורך הטקסט
          הייתה מזיזה את כל מה שמתחתיה בכל החלפה.
        */}
        <span key={ad.id} className="block animate-[housefade_.5s_ease-out]">
          <span className="mt-1 block truncate font-press text-[14px] font-black text-chalk">
            {ad.headline}
          </span>
          <span
            className="mt-0.5 block text-[11px] leading-snug text-chalk-dim"
            style={{ display: '-webkit-box', WebkitLineClamp: 2,
                     WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
          >
            {ad.body}
          </span>
          <span
            className="mt-1 block text-[11.5px] font-black"
            style={{ color: brand.ink }}
          >
            {ad.cta} ›
          </span>
        </span>
      </span>
    </a>
  );
}

/* ================================================================== */
/* 2 · השורה                                                           */
/* ================================================================== */

/**
 * ★ הערת שוליים, לא באנר.
 *
 * גובה של שורת טקסט אחת, בלי מסגרת ובלי רקע. היא לא מתחרה על
 * תשומת לב עם שום דבר במסך — ולכן היא עדיין עובדת בחשיפה
 * החמישים, כשהבאנר כבר מזמן שקוף.
 */
export function HouseStrip({
  placement, gameweekNumber, className = '',
}: {
  placement: Placement;
  gameweekNumber: number;
  className?: string;
}) {
  const ad = useRotatingAd(placement, gameweekNumber);
  if (!ad) return null;

  const brand = BRANDS[ad.brand];

  return (
    <a
      href={houseUrl(ad, placement, gameweekNumber)}
      target="_blank"
      rel={LINK_REL}
      onClick={() => trackAd(ad.id, placement, 'click')}
      className={`flex items-center justify-center gap-1.5 text-[11px] leading-snug
                  text-chalk-dim ${className}`}
    >
      <span
        className="inline-block size-1.5 shrink-0 rounded-full"
        style={{ background: brand.ink }}
        aria-hidden="true"
      />
      <span key={ad.id} className="min-w-0 truncate animate-[housefade_.5s_ease-out]">
        {ad.headline}
        {' · '}
        <span className="font-black" style={{ color: brand.ink }}>
          {brand.name}
        </span>
      </span>
    </a>
  );
}

/* ================================================================== */
/* הנכסים הגרפיים                                                      */
/* ================================================================== */

/**
 * ★ הלוגוטיפ נבנה כאן ולא נטען כתמונה.
 *
 * שתי סיבות, ושתיהן מעשיות: קובץ שנכשל בטעינה משאיר חור במקום
 * מותג, ותמונה בגודל 86 פיקסלים על מסך רשתית היא או מטושטשת
 * או כבדה. SVG הוא תמיד חד ותמיד קיים.
 */
export function BrandWord({ brand, size = 12 }: { brand: Brand; size?: number }) {
  const b = BRANDS[brand];
  return (
    /*
     * ★★ `dir="ltr"` + `unicode-bidi: isolate` — ולא קישוט ★★
     *
     * הדף כולו RTL. בלי הבידוד, סימן הקריאה של TakeMeOut קופץ
     * לתחילת המילה והלוגו נקרא "!TakeMeOut" — כלומר בדיוק הפרט
     * היחיד שמזהה את המותג מופיע בצד הלא נכון, בכל מסך.
     */
    <span
      dir="ltr"
      className="font-press whitespace-nowrap font-black leading-none tracking-tight"
      style={{ fontSize: size, color: '#EDE4CE', unicodeBidi: 'isolate' }}
    >
      {b.name}
      {/* ★ סימן הקריאה בצבע המותג — הפרט היחיד שנשמר מהלוגו
          המלא. הוא מה שהופך "TakeMeOut" למותג ולא למילה. */}
      <span style={{ color: b.ink }}>{brand === 'takemeout' ? '!' : '.'}</span>
    </span>
  );
}

/**
 * האיור. קו אחד, בלי מילוי — אותה שפה גרפית של קו־מתאר שכבר
 * קיימת בלובי, בכרטיס ובמגרש.
 */
function BrandArt({ brand }: { brand: Brand }) {
  const b = BRANDS[brand];
  const stroke: CSSProperties = { stroke: b.ink, strokeWidth: 1.5, fill: 'none' };

  if (brand === 'takemeout') {
    /* קו רקיע: מקדש, מגדל, שער, כיפה — ארבעת הצלליות שמופיעות
       גם בכותרת של טייק מי אאוט עצמו. */
    return (
      <svg viewBox="0 0 76 40" width="72" height="38" aria-hidden="true">
        <circle cx="57" cy="9" r="5" style={{ fill: b.ink, opacity: 0.5 }} />
        {/* מקדש */}
        <g style={stroke} strokeLinecap="round">
          <path d="M6 30V19M11 30V19M16 30V19" />
          <path d="M3 19h16M2.5 31h18" />
          <path d="M4 19 11 13l7 6" />
          {/* מגדל */}
          <path d="M30 31 33 14M38 31 35 14M33 14h2M31.5 22h5M30.8 26h6.4" />
          {/* שער */}
          <path d="M47 31V20h12v11M47 20h12M50 31v-7h6v7" />
          {/* כיפה */}
          <path d="M64 31V24M72 31v-7M64 24a4 4 0 0 1 8 0" />
        </g>
        <path d="M1 34h74" style={{ stroke: b.ink, strokeWidth: 1, opacity: 0.35 }} />
      </svg>
    );
  }

  /* אופסיידס: הקו עצמו — דגלון, כדור, וקו הנבדל. */
  return (
    <svg viewBox="0 0 76 40" width="72" height="38" aria-hidden="true">
      <circle cx="57" cy="10" r="5" style={{ fill: b.ink, opacity: 0.5 }} />
      <g style={stroke} strokeLinecap="round" strokeLinejoin="round">
        {/* קו הנבדל */}
        <path d="M20 6v30" strokeDasharray="3 3" />
        {/* דגלון */}
        <path d="M9 33V13M9 13l9 4-9 4" />
        {/* כדור */}
        <circle cx="45" cy="24" r="8" />
        <path d="m45 18 3.6 2.6-1.4 4.3h-4.4l-1.4-4.3z" />
        {/* חלוץ שחצה */}
        <path d="M63 33v-8M63 25l-4-5M63 25l4-5M63 20v-3" />
        <circle cx="63" cy="15" r="2.4" />
      </g>
      <path d="M1 36h74" style={{ stroke: b.ink, strokeWidth: 1, opacity: 0.35 }} />
    </svg>
  );
}

/**
 * תצוגה מקדימה ללוח הניהול.
 *
 * ★ מקבלת מודעה במקום לשלוף אחת — כדי שהאדמין יראה בדיוק את
 *   מה שהוא מקליד עכשיו, כולל לפני שנשמר.
 */
export function HouseAdPreview({ ad }: { ad: HouseAd }) {
  const brand = BRANDS[ad.brand] ?? BRANDS.offsides;
  return (
    <div
      className="flex items-stretch overflow-hidden rounded-xl border"
      style={{ borderColor: 'rgba(216,178,92,.22)', background: 'rgba(216,178,92,.045)' }}
    >
      <span className="grid w-[86px] shrink-0 place-items-center" style={{ background: brand.tint }}>
        <BrandArt brand={ad.brand} />
      </span>
      <span className="min-w-0 flex-1 px-3 py-2.5">
        <span className="flex items-center gap-1.5">
          <span className="text-[8.5px] font-black tracking-[0.2em] text-chalk-dim">גם שלנו</span>
          <span className="h-px flex-1" style={{ background: 'rgba(216,178,92,.25)' }} />
          <BrandWord brand={ad.brand} size={10} />
        </span>
        <span className="mt-1 block truncate font-press text-[14px] font-black text-chalk">
          {ad.headline || 'כותרת המודעה'}
        </span>
        <span
          className="mt-0.5 block text-[11px] leading-snug text-chalk-dim"
          style={{ display: '-webkit-box', WebkitLineClamp: 2,
                   WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
        >
          {ad.body}
        </span>
        <span className="mt-1 block text-[11.5px] font-black" style={{ color: brand.ink }}>
          {ad.cta || 'לפעולה'} ›
        </span>
      </span>
    </div>
  );
}
