import type { Config } from "tailwindcss";

/**
 * טוקנים של המותג. הצבעים כאן הם מקור האמת היחיד -
 * אין hex בשום קומפוננטה.
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink:     { DEFAULT: "#0B1420", 2: "#12202F", 3: "#1B2E42" },
        cream:   "#F2E9D8",
        gold:    { DEFAULT: "#C9A227", soft: "rgba(201,162,39,.16)" },
        kalanit: "#D7263D",
        turf:    "#16B37E",
        foul:    "#E4572E",
        terrace: "#7B8A9B",
      },
      fontFamily: {
        // Heebo כברירת מחדל; Ploni/Almoni נטענים כ-@font-face אם יש רישיון
        sans:    ['"Almoni Neue"', "Heebo", "system-ui", "sans-serif"],
        display: ['"Ploni ML"', "Heebo", "system-ui", "sans-serif"],
        num:     ["Archivo", "Heebo", "ui-monospace", "monospace"],
      },
      borderRadius: { card: "20px", chip: "999px" },
      transitionTimingFunction: { brand: "cubic-bezier(.22,1,.36,1)" },
      spacing: {
        // safe-area למכשירים עם notch - חובה במסך בניית הרכב
        "safe-b": "env(safe-area-inset-bottom, 0px)",
        "safe-t": "env(safe-area-inset-top, 0px)",
        tap: "44px", // גודל מינימלי ליעד מגע
      },
      screens: {
        // Mobile First: ברירת המחדל היא 360px. אלה תוספות, לא בסיס.
        xs: "380px",
        // הרבה מסכי פנטזי נשברים במסכים נמוכים - נקודת שבירה לפי גובה:
        short: { raw: "(max-height: 700px)" },
      },
      keyframes: {
        lock: { "0%": { transform: "rotate(0deg)" }, "100%": { transform: "rotate(360deg)" } },
      },
      animation: { lock: "lock 1.6s linear infinite" },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    // אין צורך ב-plugin ל-RTL: משתמשים אך ורק ב-logical properties
    // (ps-/pe-/ms-/me-/border-s/text-start) שנתמכים נייטיב מ-Tailwind 3.3.
  ],
} satisfies Config;
