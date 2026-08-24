# Frontend — Mobile First + RTL מלא

## הסטאק המומלץ

| שכבה | בחירה | למה דווקא זה |
|---|---|---|
| Build | **Vite + React 19 + TypeScript** | הכי מהיר ל-DX, אין SSR שאתם צריכים כרגע |
| עיצוב | **Tailwind CSS 3.4+** | logical properties נייטיב (`ps/pe/ms/me/start/end`) — RTL בלי plugin |
| קומפוננטות | **shadcn/ui** (Radix) | קוד אצלכם, לא ספרייה. Radix תומך RTL דרך `DirectionProvider` |
| Bottom sheets | **Vaul** | תבנית המובייל הנכונה. מודאלים מרכזיים הם דפוס דסקטופ |
| Server state | **TanStack Query** | polling חכם לניקוד חי, cache, retry |
| Draft state | **Zustand** + `persist` | ההרכב נשמר מקומית עד להגשה |
| רשימות | **@tanstack/react-virtual** | 400 שחקנים ברשימה = חובה virtualization |
| תרגום | **i18next + i18next-icu** | ICU נדרש לרבים/יחיד ולמין דקדוקי בעברית |
| אנימציה | **Framer Motion** | easing אחיד `cubic-bezier(.22,1,.36,1)` |
| פונטים | **@fontsource-variable/heebo** | subset עברית בלבד, `font-display: swap` |
| אריזה | **Capacitor** (בהמשך) | אותו קוד → App Store, בלי React Native |

**מה לא לקחת:** Next.js (אין לכם צורך ב-SSR, וזה מסבך את ה-Capacitor), MUI (RTL שביר וכבד), CSS-in-JS ריצת-זמן (עלות ביצועים במובייל).

---

## RTL — הכללים שלא נשברים

1. **אין `left` / `right` בקוד. בכלל.**
   `ps-4 pe-2 ms-auto text-start border-s rounded-s-lg inset-inline-start`.
   הגדירו ESLint rule שמכשיל build על `left-`/`right-`/`ml-`/`mr-`/`pl-`/`pr-`.

2. **`<html lang="he" dir="rtl">`** — ולא `dir` על ה-body או על div פנימי.
   מעבר שפה = החלפת `lang` + `dir` ברמת המסמך, ו-`<DirectionProvider dir>` ל-Radix.

3. **מספרים לא מתהפכים.** כל מספר, שעון, ניקוד ותוצאה:
   ```tsx
   <span dir="ltr" className="font-num tabular-nums">2:14:38</span>
   ```
   בלי `tabular-nums` טבלת הליגה תרעד בכל רענון.

4. **טקסט מעורב → `<bdi>`.** `"Omer Atzili"` בתוך משפט עברי בלי בידוד
   ישבור את סדר המילים. `<bdi>` פותר את זה בלי JS.

5. **מה כן להפוך ומה לא.** חיצים, chevrons ו-back מתהפכים.
   **המגרש, סמלי קבוצות, לוגו וכיוון המשחק — לא.**
   ```css
   .icon-directional { transform: scaleX(1); }
   [dir="rtl"] .icon-directional { transform: scaleX(-1); }
   ```

6. **`text-align: start`**, לא `right`. ברגע שתוסיפו אנגלית זה יעבוד מעצמו.

7. **בדיקה:** snapshot של כל מסך ב-`dir=rtl` וב-`dir=ltr` ב-Playwright.
   באג RTL תמיד מתגלה מאוחר מדי.

---

## Mobile First — הכללים

1. **בסיס 360×740.** כל class בלי prefix הוא מובייל; `xs:` / `md:` הם תוספת בלבד.
2. **`100dvh`, לא `100vh`** — אחרת סרגל הכתובות של ספארי אוכל את ה-CTA.
3. **`env(safe-area-inset-*)`** על כל אלמנט צף. יש טוקן `safe-b` ב-tailwind config.
4. **יעד מגע 44px מינימום** (`h-tap`). כפתור "הסר שחקן" של 24px = תלונות.
5. **בחירה = bottom sheet**, לא מודאל. אגודל מגיע לתחתית המסך, לא למרכזו.
6. **אין hover כאפשרות יחידה.** כל מידע שמתגלה ב-hover חייב מסלול מגע.
7. **`grid-cols-[repeat(auto-fit,minmax(84px,1fr))]`** במקום breakpoints ידניות למגרש.
8. **`overscroll-contain`** על גלילה פנימית — אחרת הדף שמאחורי הגיליון זז.
9. **תקציב ביצועים:** LCP < 2.5s ב-4G, bundle ראשוני < 180KB gzip.
   ה-pool של השחקנים נטען lazy, לא ב-initial bundle.
10. **אופליין קל:** ה-draft של ההרכב ב-`localStorage` דרך Zustand `persist`.
    משתמש שנוסע ברכבת ומאבד רשת לא מאבד את ההרכב.

---

## מבנה תיקיות מוצע

```
src/
├── app/                  # routing + providers (Query, Direction, i18n)
├── components/
│   ├── LineupBuilder.tsx # ← מצורף כאן
│   ├── PlayerSheet.tsx
│   └── ui/               # shadcn
├── features/
│   ├── lineup/           # store, hooks, validation מקומית
│   ├── scoring/          # תצוגת breakdown
│   └── leaderboard/
├── lib/
│   ├── api.ts            # שולח Accept-Language, מקבל שמות מתורגמים מהשרת
│   └── format.ts         # מספרים, תאריכים, Intl.NumberFormat('he-IL')
└── locales/{he,en}/*.json
```

## הערה חשובה על i18n בין השרת לקליינט

**אל תשלחו את כל אובייקט השמות לקליינט.** ה-API שולח `Accept-Language`,
השרת בוחר את הווריאנט הנכון מ-`core.i18n_name` (עם fallback לאנגלית)
ומחזיר `name` ו-`nameShort` שטוחים. הקליינט לא צריך לדעת שקיימות שתי שפות.

הודעות ולידציה מגיעות כ-**קוד** (`duplicate_team`) + `params`, והקליינט
מתרגם. ככה הודעת "יש לך כבר שחקן מהקבוצה הזו" מתורגמת פעם אחת ולא בשני מקומות.
