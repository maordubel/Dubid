import type { Config } from 'tailwindcss';

/**
 * טוקנים של DUBID. אין hex בשום קומפוננטה — רק שמות מכאן.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ סבב הלוגו החדש — מה השתנה ולמה זה נעשה כך
 * ═══════════════════════════════════════════════════════════════
 *
 * הלוגו החדש הוא קו זהב על שחור. זו לא החלפת תמונה — זו החלפת
 * **צבע ראשי**. הכתום (`toto`) שהוביל את הממשק עד היום מתחרה עם
 * הזהב ומוזיל אותו.
 *
 * הדרך הזולה הייתה למצוא־ולהחליף `toto` ב-`gold` ב-40 קבצים.
 * הדרך הנכונה: הטוקן הוא הפשטה, ולכן משנים את **הערך** ולא את
 * השם. `toto` נשאר קיים ומצביע על אותו זהב, ולכן:
 *
 *   · כל מסך במוצר התחלף לשפה החדשה בבת אחת, בלי diff של 2000
 *     שורות שאי אפשר לבדוק.
 *   · אין רגע ביניים שבו חצי מהמסכים כתומים וחצי זהובים.
 *   · קוד חדש כותב `gold` — השם הנכון. קוד קיים ממשיך לעבוד.
 *
 * `toto` הוא היום כינוי היסטורי. אל תשתמשו בו בקוד חדש.
 *
 * ═══════════════════════════════════════════════════════════════
 * הפלטה
 * ═══════════════════════════════════════════════════════════════
 *
 * הכהים חמים ולא ניטרליים (יש בהם אדום), כי זהב על אפור־כחלחל
 * נראה ירקרק. שינוי של שתי יחידות ב-R הוא ההבדל בין "עץ כהה"
 * לבין "מסך כבוי".
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /* משטחים — מהעמוק לרדוד */
        night:    { DEFAULT: '#0C0A08', 2: '#16120D', 3: '#211A13', 4: '#2E251A' },

        /* ★ הצבע הראשי. נלקח מהקו של הלוגו עצמו, לא מפלטה גנרית. */
        gold:     { DEFAULT: '#D8B25C', light: '#F0D693', deep: '#A9822F', ink: '#241A06' },

        /* כינוי היסטורי — ראו הערה למעלה. אותם ערכים בדיוק. */
        toto:     { DEFAULT: '#D8B25C', deep: '#A9822F' },

        /* טקסט. קרם ולא לבן — לבן על שחור חם נראה כחול. */
        chalk:    { DEFAULT: '#F4ECDC', 2: '#C6B99F', dim: '#8B7F6A' },

        pitch:    { DEFAULT: '#12301F', 2: '#1B4630' },
        tekhelet: '#4A9BD8',
        armband:  '#FFCE4D',
        flare:    '#E4453B',

        /* פלטת הדפוס של הלוגו — נייר קרם ודיו. */
        ink:      { DEFAULT: '#14181C', 2: '#24395F', deep: '#0B0E11' },
        paper:    { DEFAULT: '#F5EFE9', 2: '#EBE2CB', dim: '#C9BFA4' },
        tartan:   { red: '#C8332F', green: '#2E7D4F' },
      },
      fontFamily: {
        /*
         * ★ ארבע משפחות, ולכל אחת תפקיד אחד.
         *
         *   press   — עיתון. כותרות, מאסטהד, שמות מצבים, כותרות
         *             מדור. סריפי, וזה מה שהופך מסך לעמוד מודפס.
         *   display — כותרות ממשק שאינן "עיתון": מודלים, גיליונות.
         *   poster  — מספרים בלבד. אנטון, צר וכבד, כמו מספרי חולצה.
         *   sans    — גוף הטקסט. נקרא היטב בגדלים קטנים.
         *
         * הגבול בין `press` ל-`display` אינו קפריזה: כותרת סריפית
         * בתוך גיליון בחירת שחקן נראית כמו טעות, וכותרת סאנס
         * בעמוד הראשי הורסת את כל האווירה.
         */
        press:   ['"Frank Ruhl Libre"', '"David Libre"', 'Georgia', 'serif'],
        display: ['"Narkiss Block"', 'Heebo', 'system-ui', 'sans-serif'],
        poster:  ['Anton', 'Heebo', 'system-ui', 'sans-serif'],
        sans:    ['"Almoni Neue"', 'Assistant', 'Heebo', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        /* ★ הקצה הזהוב. קו פנימי דק + הילה רכה מתחת.
           זה מה שגורם לכרטיס להיראות מוטבע ולא מצויר. */
        edge:  'inset 0 1px 0 0 rgba(240,214,147,.14), 0 1px 0 0 rgba(0,0,0,.6)',
        lift:  '0 18px 40px -22px rgba(0,0,0,.9)',
        halo:  '0 0 0 1px rgba(216,178,92,.30), 0 20px 60px -24px rgba(216,178,92,.45)',
      },
      transitionTimingFunction: { brand: 'cubic-bezier(.2,.9,.3,1)' },
      zIndex: { nav: '40', sheet: '60', toast: '80' },
      keyframes: {
        slideUp: { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
        sheen: {
          '0%':   { transform: 'translateX(-120%)' },
          '100%': { transform: 'translateX(220%)' },
        },
      },
      animation: {
        slideUp: 'slideUp 240ms cubic-bezier(.2,.9,.3,1)',
        sheen: 'sheen 2.6s cubic-bezier(.4,0,.2,1) infinite',
      },
    },
  },
  plugins: [
    // אין plugin ל-RTL בכוונה: משתמשים רק ב-logical properties
    // (ps/pe/ms/me/text-start/border-s/inset-inline-*) שנתמכים נייטיב.
    function ({ addUtilities }: any) {
      addUtilities({
        '.tap': { minHeight: '44px', minWidth: '44px' },
        '.num': {
          fontFamily: 'Anton, Archivo, ui-monospace, monospace',
          fontVariantNumeric: 'tabular-nums',
          direction: 'ltr',
          unicodeBidi: 'isolate',
        },
        // הטקסטורות (.tex-wood / .tex-turf / .tex-halftone) מוגדרות
        // ב-src/styles/index.css כדי שיהיו במקום אחד בלבד.
      });
    },
  ],
} satisfies Config;
