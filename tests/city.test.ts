import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { isYellow } from '@/lib/isYellow'
import { CITY_DEPTH } from '@/lib/life/generated/cityDepth'
import { DIALOGUE } from '@/lib/life/content/dialogue'
import { CITY_CAST } from '@/lib/life/generated/cityCast'
import { heightOf } from '@/lib/life/world/heights'
import { branchFor, isOpen, MISSIONS, newMissionState, REACH } from '@/lib/life/city/mission'
import {
  DISC_FACTOR, focal, maxFovDeg, maxYawDeg, nearEdge, PANOS, PLACE_ORDER, walkLimit,
} from '@/lib/life/city/pano'
import { STREETS } from '@/lib/life/city/street'
import { SLABS } from '@/lib/life/city/slab'

const ART = join(process.cwd(), 'public', 'life', 'art')
const manifest = JSON.parse(readFileSync(join(ART, 'manifest.json'), 'utf8')) as {
  panoramas?: Record<
    string,
    {
      w: number; h: number; horizon: number; nearRgb: number[]; yellowLeft: number; source: string
      tile?: { key: string; wide: number; deep: number }
      // פרופיל העומק נכתב על ידי `depth-profile` רק לפנורמות שבמשחק. שורות ישנות שכבר
      // אינן ב-PANOS נשארו בלעדיו, ולכן הוא אופציונלי כאן — והבדיקה עצמה היא זו שדורשת
      // אותו לכל מפתח שכן נמצא ב-PANOS. בלי הסימן הזה TS מסיק את הצורה מהקובץ, מוצא שם
      // שורה בלי `depth`, ונופל על שדה שקיים בכל שורה שהמשחק באמת קורא.
      depth?: { fromDeg: number; toDeg: number; far: number; metres: number[] }
      proj?: string; hFovDeg?: number; whatHe?: string; yellowIn?: number; bytes?: number
    }
  >
}

/**
 * העיר — השומרים.
 *
 * שלב 1 נשען על שרשרת קצרה של מספרים שכולם נמדדו מהתמונה: קו האופק, שדה הראייה, וצבע
 * הכביש. אם אחד מהם ייצא מסנכרון עם הקובץ שנשמר, שום דבר לא ייפול — הרחוב פשוט יתעקם
 * קצת, וזה בדיוק סוג הבאג שאף אחד לא רואה עד שמסתכלים על צילום מסך חודש אחר כך. לכן
 * המספרים נבדקים מול המניפסט שכתב סקריפט הקליטה, ולא מול עצמם.
 */
describe('העיר — הפנורמות מדויקות מול מה שנשמר', () => {
  it('רושמת כל פנורמה במניפסט, עם המקור שלה', () => {
    for (const key of Object.keys(PANOS)) {
      const row = manifest.panoramas?.[key]
      expect(row, `${key} is not registered in the art manifest`).toBeDefined()
      expect(row?.source, `${key} has no provenance`).toBeTruthy()
    }
  })

  it('נושאת בדיוק את קו האופק ואת יחס התמונה שנמדדו', () => {
    for (const [key, spec] of Object.entries(PANOS)) {
      const row = manifest.panoramas?.[key]
      if (!row) continue
      expect(spec.horizon, `${key} horizon drifted from the measured value`).toBeCloseTo(row.horizon, 3)
      expect(spec.aspect, `${key} aspect does not match the saved file`).toBeCloseTo(row.w / row.h, 3)
    }
  })

  it('נושאת את צבע הכביש הנמדד, ולא צבע שנבחר', () => {
    // Rule 11 applies to a colour exactly as it applies to a name: this one is the median
    // of the saved file's bottom band, and the ingest script is what measured it.
    for (const [key, spec] of Object.entries(PANOS)) {
      const row = manifest.panoramas?.[key]
      if (!row) continue
      expect(spec.nearRgb, `${key} near colour is not the measured one`).toEqual(row.nearRgb)
    }
  })

  it('לא נושאת צהוב — נמדד על הבייטים שנשמרו', () => {
    for (const [key] of Object.entries(PANOS)) {
      expect(manifest.panoramas?.[key]?.yellowLeft, `${key} still carries yellow`).toBe(0)
    }
  })

  it('נושאת מרצף מיושר לכל פנורמה, בקנה המידה שנמדד', () => {
    // המרצף הוא מה שמכסה את המרחק הקצר, שבו הקרן משיקה לרצפה וההיטל מותח חמישה פיקסלים על
    // עשרה מטר. אם המידות שלו יסטו ממה שהסקריפט ייצר, הרצפה תזוז מתחת לרגליים בקצב הלא נכון
    // — וזה בדיוק סוג הבאג שלא נראה בתמונה סטטית.
    for (const [key, spec] of Object.entries(PANOS)) {
      const row = manifest.panoramas?.[key]
      expect(spec.tile, `${key} has no rectified ground`).toBeDefined()
      expect(spec.tile?.wide, `${key} tile width drifted`).toBeCloseTo(row?.tile?.wide ?? -1, 2)
      expect(spec.tile?.deep, `${key} tile depth drifted`).toBeCloseTo(row?.tile?.deep ?? -1, 2)
    }
  })

  it('שומרת את הכיס בתוך הדיסקה', () => {
    // The pocket is how far the player may walk from the point the panorama was shot. The
    // floor under him is the disc, and if he can reach its rim the frame shows the void —
    // which is exactly what the first screenshot of a five-metre walk showed. The margin is
    // doubled rather than exact: he walks to the rim of the pocket and then looks AROUND
    // from there, and the far side of the disc has to still be under the picture.
    for (const [key, spec] of Object.entries(PANOS)) {
      expect(nearEdge(spec) * DISC_FACTOR, `${key} can walk to the rim of its own floor`).toBeGreaterThan(
        walkLimit(spec) * 2,
      )
      expect(walkLimit(spec), `${key} allows no walk at all`).toBeGreaterThan(1)
    }
  })

  it('מציגה כל מקום בבורר, ואף מקום שאינו קיים', () => {
    // הבורר הוא הדרך היחידה של מאור להגיע למקום בלי להקליד כתובת. מקום שנקלט ולא נרשם בו
    // פשוט לא קיים בשבילו, ומקום שנרשם ואין לו תמונה נותן מסך שחור.
    for (const key of PLACE_ORDER) {
      expect(PANOS[key], `${key} is in the chooser but not in the table`).toBeDefined()
    }
    for (const key of Object.keys(PANOS)) {
      expect(PLACE_ORDER, `${key} exists but the chooser never shows it`).toContain(key)
    }
  })

  it('בונה כל רחוב מתחנות שקיימות, בסדר עולה', () => {
    // תחנה שיושבת לפני קודמתה שוברת את המסירה: הדעיכה מחושבת על הקטע, וקטע שלילי הופך
    // את השקיפות לשלילית — כלומר תחנה שנעלמת בדיוק כשצריך להיכנס.
    for (const [key, street] of Object.entries(STREETS)) {
      expect(street.stops.length, `${key} is not a chain`).toBeGreaterThan(1)
      let previous = -Infinity
      for (const stop of street.stops) {
        expect(PANOS[stop.pano], `${key} stops at ${stop.pano}, which does not exist`).toBeDefined()
        expect(stop.at, `${key} stops are out of order`).toBeGreaterThan(previous)
        previous = stop.at
      }
    }
  })

  it('נושאת פרופיל עומק לכל מקום, וסנכרן מול המניפסט', () => {
    // הפרופיל הוא קובץ נוצר, והוא נכתב יחד עם המניפסט. אם מישהו יערוך אחד מהם ביד הם
    // ייפרדו בשקט — והרחוב ייראה נכון בעוד שהקירות יעמדו במקום הלא נכון.
    for (const key of Object.keys(PANOS)) {
      const depth = CITY_DEPTH[key]
      expect(depth, `${key} has no measured depth`).toBeDefined()
      const row = manifest.panoramas?.[key]?.depth
      expect(depth?.metres.length, `${key} depth length drifted from the manifest`).toBe(row?.metres.length)
      expect(depth?.far, `${key} far distance drifted`).toBe(row?.far)
    }
  })

  it('לא נותנת ללכת לתוך קיר שנמדד', () => {
    // קו המגע נמדד שמרנית: הוא נעצר על כל דבר שעומד על הכביש, ולכן מותר לו להיות קרוב
    // מדי. מה שאסור הוא שההליכה תיכנס לתוכו — ולכן הגבול נגזר מאותה מדידה בעצמה.
    for (const [key, spec] of Object.entries(PANOS)) {
      const nearest = Math.min(...(CITY_DEPTH[key]?.metres ?? [Infinity]))
      expect(walkLimit(spec), `${key} lets the player walk into its nearest wall`).toBeLessThan(nearest)
    }
  })

  it('לא פותחת מצלמה רחבה ממה שהתמונה מכסה', () => {
    // מעל הכיסוי האנכי של הפנורמה אין תמונה, ומה שנראה שם הוא חור. מתחת לאופק אין בעיה
    // לעולם, כי הרצפה מכסה עד לרגליים — ולכן רק הצד העליון נספר.
    for (const [key, spec] of Object.entries(PANOS)) {
      expect(maxFovDeg(spec), `${key} covers almost nothing above the horizon`).toBeGreaterThan(24)
      expect(maxFovDeg(spec), `${key} claims more coverage than a picture can have`).toBeLessThan(150)
    }
  })

  it('לא צובעת בצבע גולמי — הכל בייטים נמדדים', () => {
    for (const file of ['lib/life/city/pano.ts', 'lib/life/city/slab.ts', 'lib/life/city/street.ts']) {
      const text = readFileSync(join(process.cwd(), file), 'utf8')
      expect(/#[0-9a-fA-F]{6}\b/.test(text), `${file} contains a raw hex`).toBe(false)
      expect([...text.matchAll(/0x[0-9a-fA-F]{6}/g)].map((m) => m[0]), `${file} contains a raw colour`).toEqual([])
    }
  })

  it('בונה כל מישור מציור שקיים, ובסדר מהרחוק לקרוב', () => {
    for (const [key, spec] of Object.entries(SLABS)) {
      let previous = -Infinity
      for (const plane of spec.planes) {
        expect(plane.z, `${key} planes are not ordered far to near`).toBeGreaterThan(previous)
        previous = plane.z
      }
      expect(spec.planes[0]?.opaque, `${key} has no opaque backdrop`).toBe(true)
      expect(spec.horizon, `${key} horizon is outside the picture`).toBeGreaterThan(0.3)
      expect(spec.horizon, `${key} horizon is outside the picture`).toBeLessThan(0.9)
    }
  })

  it('מכסה את הפריים האנכי בשדה הראייה שהוכרז', () => {
    // A 2.56:1 painting filling an upright phone is necessarily wide horizontally. When the
    // declared field of view is too narrow the planes simply do not reach the edge of the
    // frame and black bands appear above and below — which is what the first slab shot did.
    for (const [key, spec] of Object.entries(SLABS)) {
      const vertical = 2 * Math.atan(Math.tan((spec.hFovDeg * Math.PI) / 360) / spec.aspect)
      expect((vertical * 180) / Math.PI, `${key} cannot fill an upright frame`).toBeGreaterThan(52)
    }
  })

  // ---------------------------------------------------------------- ההטלה --------
  it('מכריזה על ההטלה שהמניפסט מדד, ולא מנחשת אותה', () => {
    // תצלום רגיל ופנורמה גלילית נראים אותו דבר בקובץ ונבדלים לגמרי בגיאומטריה. אם הלוח
    // יכריז על אחת והתמונה תהיה השנייה, שום דבר לא ייפול — הרחוב פשוט יתעקם, וזה סוג
    // הבאג שרואים רק בצילום מסך חודש אחר כך.
    for (const [key, spec] of Object.entries(PANOS)) {
      const row = manifest.panoramas?.[key] as { proj?: string; hFovDeg?: number } | undefined
      if (!row?.proj) continue
      expect(spec.proj ?? 'cyl', `${key} declares a projection the manifest does not`).toBe(row.proj)
      if (row.hFovDeg) expect(spec.hFovDeg, `${key} field of view drifted`).toBe(row.hFovDeg)
    }
  })

  it('לא נותנת למצלמה להסתובב אל מחוץ לפריים של תצלום', () => {
    // לגליל אין קצה; לתצלום יש, ומעבר לו אין תמונה בכלל. הגבול חייב להיות בתוך חצי
    // שדה הראייה, אחרת נפתח פס ריק בצד המסך ברגע שמזיזים את האגודל.
    for (const [key, spec] of Object.entries(PANOS)) {
      if (spec.proj !== 'rect') continue
      const cap = maxYawDeg(spec, 56, 0.55)
      expect(cap, `${key} lets the camera turn past its own frame`).toBeLessThan(spec.hFovDeg / 2)
      expect(cap, `${key} cannot be turned at all`).toBeGreaterThan(4)
    }
  })

  it('גוזרת אורך מוקד שמסכים עם המידות של הקובץ', () => {
    for (const [key, spec] of Object.entries(PANOS)) {
      const f = focal(spec)
      expect(f, `${key} focal length is not a number`).toBeGreaterThan(0.2)
      // גם בגליל וגם בתצלום, `y = f·tan ε` — ולכן קצה התמונה חייב לפגוש את הכביש במרחק
      // סביר, לא בשני סנטימטר ולא במאה מטר.
      expect(nearEdge(spec), `${key} bottom edge meets the road too close`).toBeGreaterThan(1)
      expect(nearEdge(spec), `${key} bottom edge meets the road too far`).toBeLessThan(30)
    }
  })

  // ---------------------------------------------------------------- המשימה --------
  describe('המשימה ברחוב', () => {
    it('עומדת על רחוב שקיים, ועל אנשים שיש להם גובה נמדד', () => {
      for (const [id, mission] of Object.entries(MISSIONS)) {
        expect(STREETS[mission.street], `${id} runs on a street that does not exist`).toBeTruthy()
        for (const beat of mission.beats) {
          expect(CITY_CAST[beat.cast], `${id}/${beat.id} has no measured height`).toBeTruthy()
        }
      }
    })

    it('מדברת דרך מאגר השיחות של המשחק ולא דרך מילים משלה', () => {
      for (const [id, mission] of Object.entries(MISSIONS)) {
        for (const beat of mission.beats) {
          expect(DIALOGUE[beat.talk], `${id}/${beat.id} points at no conversation`).toBeTruthy()
        }
      }
    })

    it('מרימה בכל שיחה את הדגל שסוגר את הביט שלה', () => {
      // בלי זה השיחה נגמרת והמשימה לא מתקדמת — הביט נשאר פתוח וחוזר על עצמו לנצח.
      for (const [id, mission] of Object.entries(MISSIONS)) {
        for (const beat of mission.beats) {
          const flags = (DIALOGUE[beat.talk]?.branches ?? [])
            .flatMap((branch) => branch.then ?? [])
            .filter((e) => e.e === 'flag')
            .map((e) => (e as { flag: string }).flag.replace(/^city:/, ''))
          expect(flags, `${id}/${beat.id} raises no flag that closes it`).toContain(beat.id)
        }
      }
    })

    it('נגמרת — כל ביט נפתח בסופו של דבר, ואין תלות מעגלית', () => {
      for (const [id, mission] of Object.entries(MISSIONS)) {
        const state = newMissionState()
        for (let round = 0; round < mission.beats.length + 1; round += 1) {
          for (const beat of mission.beats) if (isOpen(beat, state)) state.done.add(beat.id)
        }
        for (const beat of mission.beats) {
          expect(state.done.has(beat.id), `${id}/${beat.id} can never be reached`).toBe(true)
        }
      }
    })

    it('מעמידה כל אחד בטווח הליכה, ובלי שניים על אותה נקודה', () => {
      for (const [id, mission] of Object.entries(MISSIONS)) {
        const street = STREETS[mission.street]!
        const length = street.stops[street.stops.length - 1]?.at ?? 0
        for (const beat of mission.beats) {
          expect(beat.at, `${id}/${beat.id} stands before the street starts`).toBeGreaterThanOrEqual(0)
          expect(beat.at, `${id}/${beat.id} stands past the end of the street`).toBeLessThanOrEqual(length)
          expect(Math.abs(beat.side), `${id}/${beat.id} stands off the road`).toBeLessThanOrEqual(4)
        }
        for (const a of mission.beats) {
          for (const b of mission.beats) {
            if (a.id >= b.id) continue
            const gap = Math.hypot(a.side - b.side, a.at - b.at)
            expect(gap, `${id}: ${a.id} and ${b.id} share one spot`).toBeGreaterThan(REACH)
          }
        }
      }
    })

    it('אומרת משהו אחר אחרי שהביט נסגר', () => {
      // שיחה שחוזרת על עצמה מילה במילה אחרי שמסרת את השקית הופכת אדם לרהיט.
      for (const [id, mission] of Object.entries(MISSIONS)) {
        for (const beat of mission.beats) {
          const before = branchFor(beat.talk, newMissionState())
          const after = newMissionState()
          after.done.add(beat.id)
          const said = branchFor(beat.talk, after)
          expect(said?.lines[0]?.text, `${id}/${beat.id} repeats itself once it is done`)
            .not.toBe(before?.lines[0]?.text)
        }
      }
    })

    it('מספרת את הגובה של כל אדם פעם אחת בלבד', () => {
      // `heights.ts` הוא הבית של גובה של אדם. אם שתי טבלאות יחזיקו את אותו מספר, אחת
      // מהן תתיישן — ואז אותו סדרן יהיה בגובה אחר בשני מסכים.
      for (const [key, member] of Object.entries(CITY_CAST)) {
        const canonical = heightOf(key)
        if (canonical === 1.75) continue // ברירת המחדל: אין לו שורה משלו, ואין מה לסתור
        expect(member.metres, `${key} height disagrees with heights.ts`).toBeCloseTo(canonical, 2)
      }
    })
  })

  it('נותנת לשתי תחנות גליליות של אותו רחוב בדיוק אותה מצלמה', () => {
    // **מה שנשבר כאן בשקט.** שתי פנורמות שנתפרו באופק שונה, או מגובה עין שונה, נראות כל
    // אחת בסדר לחוד; הפגם מופיע רק בצעד שביניהן, כשהקרקע קופצת תחת הרגליים באמצע הליכה.
    // ולא לזה מסתכלים כשבודקים תמונה אחת. לכן הבדיקה היא על **הזוג**.
    //
    // למה רק על גלילים: תחנה גלילית נתפרת כאן מארבעה ריבועים, ולכן אני זה שקובע לה את
    // האופק ואת גובה העין — ומה שאני קובע אני יכול לשמור זהה. רחוב שבנוי מתצלומים
    // בודדים מקבל את מה שיש בכל תצלום, ושם הפיזור הוא נתון ולא החלטה: חמש תחנות
    // `bloomfieldWalk` נמדדו בפיזור של ארבעה אחוזים באופק, ושתי תחנות `bloomfield` צולמו
    // בכלל בשתי עדשות שונות. זאת בדיוק השיטה שהתפירה הגלילית באה להחליף, והבדיקה שומרת
    // שהחדשה לא תידרדר אליה בלי שמישהו ישים לב.
    for (const [id, street] of Object.entries(STREETS)) {
      const specs = street.stops.map((stop) => PANOS[stop.pano]).filter(Boolean)
      const rings = specs.filter((spec) => spec!.hFovDeg >= 359)
      if (rings.length < 2) continue
      const first = rings[0]!
      for (const spec of rings.slice(1)) {
        expect(spec!.horizon, `${id}: ${spec!.key} sits at a different horizon`).toBeCloseTo(first.horizon, 4)
        expect(spec!.eye, `${id}: ${spec!.key} was shot from a different height`).toBeCloseTo(first.eye, 3)
        // יחס צלעות, ביחס ולא בהפרש: כמה פיקסלים הפרש בין קבצי מקור הם שברירי אחוז ואי
        // אפשר לראות אותם. אחוז שלם כבר מותח את הרחוב לרוחב בתחנה אחת ולא באחרת — וזה כן.
        expect(Math.abs(spec!.aspect / first.aspect - 1), `${id}: ${spec!.key} has a different aspect`)
          .toBeLessThan(0.01)
      }
    }
  })

  it('לא מכריזה על צהוב בלוח', () => {
    for (const [key, spec] of Object.entries(PANOS)) {
      const [r, g, b] = spec.nearRgb
      expect(isYellow(r, g, b), `${key}'s road colour landed inside the yellow band`).toBe(false)
    }
  })
})
