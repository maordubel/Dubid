import type { Config } from 'tailwindcss';

/**
 * טוקנים של Dubid. אין hex בשום קומפוננטה — רק שמות מכאן.
 * שימו לב לשמות הסמנטיים: `armband` ולא `yellow`, `toto` ולא `orange`.
 * מפתח שקורא `bg-armband` יודע שזה של הקפטן; `bg-yellow-400` לא אומר כלום.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        night:    { DEFAULT: '#121110', 2: '#1B1917', 3: '#262320', 4: '#35302B' },
        pitch:    { DEFAULT: '#0F3D2C', 2: '#16563E' },
        toto:     { DEFAULT: '#FF5B14', deep: '#C63A05' },
        chalk:    { DEFAULT: '#F6F3EB', 2: '#C9C3B7', dim: '#8C857A' },
        tekhelet: '#1F7FD1',
        armband:  '#FFC93C',
        flare:    '#E4002B',

        /* ★ פלטת הלוגו — הוספה, לא החלפה.
           הדיוקן צויר בדיו נייבי על נייר קרם, עם משבצות אדום/ירוק
           בחולצה. שלושת הצבעים האלה הם מה שיזהו אותנו, ולכן הם
           טוקנים ולא ערכים מקומיים בקומפוננטה כלשהי.

           `paper` הוא משטח ולא צבע טקסט: כרטיס על נייר קרם נותן את
           תחושת אלבום המדבקות בלי שנצייר אף מדבקה. */
        ink:      { DEFAULT: '#1A2B4C', 2: '#24395F', deep: '#111D33' },
        paper:    { DEFAULT: '#F5EEDC', 2: '#EBE2CB', dim: '#C9BFA4' },
        tartan:   { red: '#C8332F', green: '#2E7D4F' },
      },
      fontFamily: {
        display: ['"Narkiss Block"', 'Heebo', 'system-ui', 'sans-serif'],
        poster:  ['Anton', 'Heebo', 'system-ui', 'sans-serif'],
        sans:    ['"Almoni Neue"', 'Assistant', 'Heebo', 'system-ui', 'sans-serif'],
      },
      transitionTimingFunction: { brand: 'cubic-bezier(.2,.9,.3,1)' },
      zIndex: { nav: '40', sheet: '60', toast: '80' },
      keyframes: {
        slideUp: { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
      },
      animation: { slideUp: 'slideUp 240ms cubic-bezier(.2,.9,.3,1)' },
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
        // הטקסטורות (.tex-turf / .tex-halftone / .tex-misprint)
        // מוגדרות ב-src/styles/index.css כדי שיהיו במקום אחד בלבד.
      });
    },
  ],
} satisfies Config;
