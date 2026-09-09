'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

import { ControlDeck } from '@/components/life/ControlDeck'
import { ACTOR_BACK, actorPose, loadActor } from '@/lib/life/city/actor'
import { CITY_CAST } from '@/lib/life/generated/cityCast'
import { CITY_COPY } from '@/lib/life/city/copy'
import {
  branchFor, complete, isOpen, MISSIONS, type Mission, type MissionBeat, nearest,
  newMissionState, type MissionState,
} from '@/lib/life/city/mission'
import { buildPano, maxFovDeg, maxYawDeg, PANOS, PLACE_ORDER, walkLimit } from '@/lib/life/city/pano'
import { buildStreet, STREETS } from '@/lib/life/city/street'
import { actorBillboard, buildSlab, SLABS } from '@/lib/life/city/slab'
import { LIFE_PALETTE } from '@/lib/life/runtime/palette'
import { disposeThree, mountThree, resizeThree, shadowDecal } from '@/lib/life/runtime/three3d'

export type Shot = {
  /** `street`/`gate7` → רב־מישור; `panoTamar` וכו' → פנורמה גלילית */
  place: string
  /** הזזה לרוחב במטרים — זה מה שמייצר את הפרלקסה */
  x: number
  /** קדימה/אחורה במטרים */
  z: number
  /** סיבוב ראש במעלות, ימינה חיובי */
  yaw: number
  /** הטיית ראש במעלות, למטה שלילי */
  pitch: number
  /** שדה הראייה האנכי של המצלמה */
  fov: number
  /** להעמיד את פוגי מול המצלמה */
  actor: boolean
  /** הג׳ויסטיק והכפתורים — כבוי בצילומים האוטומטיים */
  deck: boolean
  /** דריסת שדה הראייה של הפנורמה, לכיול בלבד; אפס = מה שרשום בלוח */
  hfov: number
  /** רחוב שלם במקום מקום אחד — שרשרת תחנות, הליכה בלי גבול */
  street: string
  /** דמות להעמיד ברחוב, לפי מפתח מ-`CITY_CAST` */
  cast: string
  /** כמה מטרים לפנים היא עומדת */
  castAt: number
  /** משימה להריץ ברחוב, לפי מפתח מ-`MISSIONS`. היא קובעת גם את הרחוב. */
  mission: string
}

const RAD = Math.PI / 180
/** מטר וארבעים לשנייה — הליכה. B מכפיל. */
const WALK = 1.4
/** מעלות לשנייה בהטיית הג׳ויסטיק המלאה */
const TURN = 78

/**
 * העיר, ובתוכה מישהו שהולך.
 *
 * הפקד הוא **`ControlDeck` הקיים** ולא כפתור משלי, וזאת לא חסכנות: זה אותו ג׳ויסטיק ואותם
 * A/B שהמשחק כבר מלמד בכל מסך אחר, ועכשיו גם המגרש התלת־ממדי רץ עליו. שפת שליטה אחת לכל
 * המשחק. הכפתור שהיה כאן קודם דרש **החזקה**, ומאור הקיש עליו — שלוש מאות מילישניות הן
 * ארבעים סנטימטר, כלומר שום דבר שהעין רואה. ג׳ויסטיק לא סובל מזה.
 *
 *   מוט קדימה/אחורה — ללכת · מוט לצדדים — להסתובב · אצבע על התמונה — להביט · B — לרוץ
 */
export function Proof({ shot }: { shot: Shot }) {
  const boxRef = useRef<HTMLDivElement>(null)
  // הפקדים כותבים לכאן, והלולאה קוראת. אין `setState` בלולאה — ששים פריימים בשנייה של
  // רינדור מחדש ב-React הם בדיוק איך שמשחק בטלפון מתחיל לגמגם.
  const input = useRef({ x: 0, y: 0, run: false })
  const [deck, setDeck] = useState({ top: 0, band: 0 })

  const onAxis = useCallback((x: number, y: number) => {
    input.current.x = x
    input.current.y = y
  }, [])
  const onCancel = useCallback((down: boolean) => {
    input.current.run = down
  }, [])
  // ---- המשימה. שלוש חתיכות מצב, וכולן חיות ב-React ולא בלולאה: הן משתנות פעם בכמה
  // שניות ולא שישים פעם בשנייה, ולכן `setState` הוא בדיוק הכלי הנכון להן.
  const mission = MISSIONS[shot.mission] ?? null
  const [quest, setQuest] = useState<MissionState>(() => newMissionState())
  const [near, setNear] = useState<MissionBeat | null>(null)
  const [saying, setSaying] = useState<{ beat: MissionBeat; line: number } | null>(null)
  const [note, setNote] = useState<string | null>(mission?.openHe ?? null)
  // הלולאה קוראת מכאן בלי לגרום ל-effect להיבנות מחדש בכל שיחה
  const questRef = useRef(quest)
  questRef.current = quest
  const sayingRef = useRef(saying)
  sayingRef.current = saying
  const nearRef = useRef<MissionBeat | null>(null)
  // האם הפנורמה מקיפה. האצבע על התמונה קוראת מכאן, כי היא חיה מחוץ ללולאה.
  const yawFree = useRef(false)

  const advance = useCallback(() => {
    const open = sayingRef.current
    if (open) {
      const branch = branchFor(open.beat.talk, questRef.current)
      const lines = branch?.lines ?? []
      if (open.line + 1 < lines.length) {
        setSaying({ beat: open.beat, line: open.line + 1 })
        return
      }
      // סוף השיחה. הדגל שהענף מרים הוא מה שסוגר את הביט — אותו דגל בדיוק שיסגור אותו
      // גם כשהמסך ירוץ בתוך המשחק המלא, ולכן אין כאן שני מקורות אמת.
      const raised = (branch?.then ?? []).find((e) => e.e === 'flag') as { flag: string } | undefined
      const id = raised?.flag.replace(/^city:/, '') ?? open.beat.id
      setSaying(null)
      setQuest((was) => {
        const next: MissionState = { done: new Set(was.done), seen: new Set(was.seen) }
        next.done.add(id)
        return next
      })
      return
    }
    const here = nearRef.current
    if (here) setSaying({ beat: here, line: 0 })
  }, [])

  const onAction = useCallback(() => {
    advance()
  }, [advance])

  // מה נכתב על המסך. השורה משתנה בדיוק פעמיים: כשביט חדש נפתח, וכשהאחרון נסגר. אחרי
  // שש שניות היא נעלמת מעצמה — היא לא רשימת משימות, זאת כבר בראש המסך.
  useEffect(() => {
    if (!mission) return
    if (complete(mission, quest)) {
      setNote(mission.doneHe)
      return
    }
    const fresh = mission.beats.find((beat) => isOpen(beat, quest) && !quest.seen.has(beat.id) && beat.openHe)
    if (!fresh) return
    setNote(fresh.openHe ?? null)
    quest.seen.add(fresh.id)
    const timer = window.setTimeout(() => setNote(null), 6000)
    return () => window.clearTimeout(timer)
  }, [mission, quest])

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    // שדה הראייה נחתך למה שהתמונה באמת מכסה. מצלמה שפותחת יותר מהכיסוי האנכי של הפנורמה
    // מראה חור מעל או מתחת, וזה מה שהשחיר את המסך מתחת ליציע בבלומפילד.
    const cap = PANOS[shot.place] ? maxFovDeg(PANOS[shot.place] as (typeof PANOS)[string]) : 180
    // מישור החיתוך הרחוק: ברירת המחדל של `mountThree` היא מאה מטר, וזה היה נכון לשני
    // מיני־המשחקים שהיא נכתבה בשבילם. כאן הקיר בעל הצורה מציב רצועות "פתוח" ב-140 מטר,
    // והן נחתכו לגמרי — מה שנראה על המסך כלוחות שחורים ענקיים מתחת ליציע ובאוסישקין.
    const three = mountThree(box, Math.min(shot.fov, cap * 0.96), 600)
    three.scene.background = new THREE.Color(LIFE_PALETTE.night)
    const loader = new THREE.TextureLoader()

    let dispose = () => {}
    let eye = 1.7
    let walk: ReturnType<typeof buildStreet> | null = null

    const road = STREETS[mission?.street ?? shot.street]
    const listed = PANOS[shot.place]
    const panoSpec = listed && shot.hfov > 0 ? { ...listed, hFovDeg: shot.hfov } : listed
    if (road) {
      walk = buildStreet(road, loader)
      three.scene.add(walk.group)
      eye = walk.eye
      dispose = walk.dispose
    } else if (panoSpec) {
      const pano = buildPano(panoSpec, loader)
      three.scene.add(pano.group)
      eye = pano.eye
      dispose = pano.dispose
    } else {
      const slabSpec = SLABS[shot.place] ?? SLABS.street
      if (!slabSpec) return
      const slab = buildSlab(slabSpec, loader)
      three.scene.add(slab.group)
      eye = slab.eye
      dispose = slab.dispose
    }

    const view = { x: shot.x, z: shot.z, yaw: shot.yaw, pitch: shot.pitch, moved: 0, lateral: 0, moving: false }
    const firstSpec = road ? PANOS[road.stops[0]?.pano ?? ''] : panoSpec
    // כמה מותר להסתובב: פנורמה של 360 מעלות פותחת את הכל, תצלום נעצר בקצה הפריים,
    // וציור רב־מישורי נשאר על השבעים הישנים.
    const yawCap = firstSpec
      ? maxYawDeg(firstSpec, Math.min(shot.fov, cap * 0.96), box.clientWidth / Math.max(1, box.clientHeight))
      : 70
    // ברחוב אין כיס: הגבול הוא אורך הרחוב, והתחנות מוסרות זו לזו לאורכו.
    const limit = walk ? Infinity : panoSpec ? walkLimit(panoSpec) : 2.2

    let pugi: THREE.Sprite | null = null
    let shadow: THREE.Mesh | null = null
    let frames: Record<string, THREE.Texture> = {}
    if (shot.actor) {
      // התצלומים, לא הילד המצויר. מאור, 7.9.2026: *"תשתמש בהכל ריאלי."*
      frames = loadActor(loader)
      pugi = actorBillboard(frames[ACTOR_BACK] as THREE.Texture, 1.68)
      // הרצפה שקופה (בגלל המסירה בין תחנות), ולכן היא נצבעת במעבר השקוף — ובלי סדר מפורש
      // היא נצבעה מעל פוגי וחתכה אותו מהמותניים ומטה. הוא תמיד שלושה מטר וחצי לפנים ואף
      // קיר לא קרוב יותר, אז לצבוע אותו אחרון זה גם הפשוט וגם הנכון.
      pugi.renderOrder = 10
      three.scene.add(pugi)
      // הצל הוא מה שמדביק אותו לכביש. בלעדיו הוא תמונה שהודבקה על רקע.
      shadow = shadowDecal(0.34)
      shadow.renderOrder = 9
      shadow.scale.set(0.92, 0.44, 1)
      three.scene.add(shadow)
    }

    // דמות מהצוות, בגובה האמיתי שלה במטרים. אין כאן שום מספר לכוונן: הגובה נמדד בקליטה,
    // והמנוע גוזר ממנו את הגודל על המסך לפי המרחק. ככה כל אדם עומד ברחוב ולא מודבק עליו.
    const member = CITY_CAST[shot.cast]
    if (member) {
      const map = loader.load(`/life/art/${shot.cast}.png`)
      const figure = actorBillboard(map, member.metres)
      figure.position.set(-0.9, -eye + member.metres / 2, -shot.castAt)
      figure.renderOrder = 8
      three.scene.add(figure)
      const cast = shadowDecal(0.36)
      cast.renderOrder = 7
      cast.scale.set(1, 0.42, 1)
      cast.position.set(-0.9, -eye + 0.005, -shot.castAt + 0.02)
      three.scene.add(cast)
    }

    // אנשי המשימה. הגובה מגיע מ-`CITY_CAST` — נמדד בקליטה — ולכן אף אחד מהם לא צריך
    // מספר גודל משלו. הצל הוא מה שמעמיד אותם על הכביש ולא מדביק אותם עליו.
    const people = new Map<string, { figure: THREE.Sprite; shade: THREE.Mesh }>()
    if (mission) {
      for (const beat of mission.beats) {
        const m = CITY_CAST[beat.cast]
        if (!m) continue
        const map = loader.load(`/life/art/${beat.cast}.png`)
        const figure = actorBillboard(map, m.metres)
        figure.position.set(beat.side, -eye + m.metres / 2, -beat.at)
        // רחוק נצבע לפני קרוב, כדי שמי שקרוב יכסה את מי שמאחוריו
        figure.renderOrder = 4 + (100 - beat.at) / 100
        if (beat.flip) figure.scale.x = -Math.abs(figure.scale.x)
        three.scene.add(figure)
        const shade = shadowDecal(0.36)
        shade.renderOrder = 3
        shade.scale.set(m.metres * 0.55, m.metres * 0.24, 1)
        shade.position.set(beat.side, -eye + 0.005, -beat.at + 0.02)
        three.scene.add(shade)
        people.set(beat.id, { figure, shade })
      }
    }

    yawFree.current = yawCap >= 180

    let raf = 0
    let last = performance.now()
    const frame = () => {
      const now = performance.now()
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now

      const stick = input.current
      // תצלום רגיל נגמר בקצה הפריים, ומעבר לו אין תמונה — ולכן הסיבוב נעצר שם. פנורמה
      // גלילית מקיפה, ולה נשאר הגבול הישן.
      view.yaw += stick.x * TURN * dt
      // ‎180‎ פירושו בלי גבול: הזווית מתגלגלת סביב הציר במקום להיעצר בקיר.
      view.yaw = yawCap >= 180
        ? ((view.yaw + 180) % 360 + 360) % 360 - 180
        : Math.max(-yawCap, Math.min(yawCap, view.yaw))
      const speed = -stick.y * WALK * (stick.run ? 1.9 : 1)
      view.moving = Math.abs(speed) > 0.05
      if (view.moving) {
        const step = speed * dt
        view.x += Math.sin(view.yaw * RAD) * step
        view.z -= Math.cos(view.yaw * RAD) * step
        view.moved += Math.abs(step)
        if (walk) {
          view.z = Math.max(-walk.length, Math.min(0, view.z))
          view.x = Math.max(-4, Math.min(4, view.x))
        } else {
          const away = Math.hypot(view.x, view.z)
          if (away > limit) {
            view.x = (view.x / away) * limit
            view.z = (view.z / away) * limit
          }
        }
      }
      // כמה מהתנועה היא לרוחב הפריים: המוט לצדדים מסובב, ולכן זה בעצם קצב הסיבוב
      view.lateral = view.moving ? stick.x : 0

      walk?.update(-view.z)
      // **חצי מטר לאחור תמיד, גם בלי פוגי.** מצלמה שיושבת בדיוק בנקודת הצילום היא מקרה
      // מנוון: היא במרכז המניפה של הקיר בעל הצורה, והרצפה מפסיקה להיצבע מעל הרקע הרחוק —
      // מה שנראה על המסך כפסים אנכיים שטוחים בגוון חול מתחת לקו האופק. חצי מטר פותר את
      // זה לגמרי, והוא גם ממילא המקום שממנו מסתכלים כשפוגי בפריים.
      three.camera.position.set(view.x, shot.actor ? 0.22 : 0, view.z + 0.5)
      three.camera.rotation.set(view.pitch * RAD, -view.yaw * RAD, 0, 'YXZ')

      if (pugi && shadow) {
        const pose = actorPose(view.lateral, view.moved, view.moving)
        const map = frames[pose.key]
        const material = pugi.material as THREE.SpriteMaterial
        if (map && material.map !== map) {
          material.map = map
          material.needsUpdate = true
          const w = map.image?.width ?? 0
          const h = map.image?.height ?? 0
          if (w > 0 && h > 0) pugi.scale.set((1.68 * w) / h, 1.68, 1)
        }
        pugi.material.rotation = 0
        pugi.scale.x = Math.abs(pugi.scale.x) * (pose.flip ? -1 : 1)
        // כיוון המבט של three הוא `(sin yaw, 0, −cos yaw)` — פוגי תמיד שלושה מטר וחצי לפנים
        // **חמישה מטר לפנים, לא שלושה וחצי.** בפריים אנכי צר, ילד בשלושה מטר תופס שליש
        // מהמסך ומכסה בדיוק את מה שהולכים אליו. בחמישה הוא עדיין הגיבור של התמונה, והרחוב
        // מאחוריו נפתח.
        const AHEAD = 5
        const ax = Math.sin(view.yaw * RAD) * AHEAD
        const az = Math.cos(view.yaw * RAD) * -AHEAD
        pugi.position.set(view.x + ax + 0.34, -eye + 0.84 + pose.bob, view.z + az)
        shadow.position.set(pugi.position.x, -eye + 0.006, pugi.position.z + 0.02)
      }
      // מי בטווח דיבור. הבדיקה רצה כל פריים אבל כותבת ל-React רק כשהתשובה משתנה.
      if (mission) {
        const found = sayingRef.current ? null : nearest(mission, questRef.current, view.x, -view.z)
        if (found?.id !== nearRef.current?.id) {
          nearRef.current = found
          setNear(found)
        }
        for (const beat of mission.beats) {
          const body = people.get(beat.id)
          if (body) body.figure.material.opacity = questRef.current.done.has(beat.id) ? 0.92 : 1
        }
      }
      // כמה נהלך בפועל ולאן מסתכלים — הצילום האוטומטי קורא את שניהם. בלי המספרים האלה
      // "לא זז" ו"זז קצת" נראים אותו דבר, וסיבוב של שמונים מעלות נראה כמו סיבוב שלם.
      box.dataset.along = (-view.z).toFixed(2)
      box.dataset.yaw = view.yaw.toFixed(1)
      three.renderer.render(three.scene, three.camera)
      raf = requestAnimationFrame(frame)
    }
    frame()

    // הדגל שהצילום האוטומטי מחכה לו — בלעדיו הוא מצלם מסך ריק וקורא לזה תוצאה
    const ready = window.setTimeout(() => box.setAttribute('data-ready', '1'), 1500)

    let finger: { id: number; x: number; y: number } | null = null
    const down = (e: PointerEvent) => {
      finger = { id: e.pointerId, x: e.clientX, y: e.clientY }
    }
    const move = (e: PointerEvent) => {
      if (!finger || finger.id !== e.pointerId) return
      const swung = view.yaw + (e.clientX - finger.x) * 0.16
      view.yaw = yawFree.current
        ? ((swung + 180) % 360 + 360) % 360 - 180
        : Math.max(-70, Math.min(70, swung))
      view.pitch = Math.max(-20, Math.min(20, view.pitch - (e.clientY - finger.y) * 0.1))
      finger = { id: e.pointerId, x: e.clientX, y: e.clientY }
    }
    const up = () => {
      finger = null
    }
    box.addEventListener('pointerdown', down)
    box.addEventListener('pointermove', move)
    box.addEventListener('pointerup', up)
    box.addEventListener('pointercancel', up)

    // **הקנבס נמדד לפי הקופסה, בכל פעם שהיא משתנה.** בלי זה יש סדר פעולות שבור: ה-effect
    // רץ כשהפס של הפקד עוד אפס, הקנבס נבנה בגובה המסך המלא, ואז ה-state מקטין את הקופסה —
    // והקנבס נשאר בגודל הישן. על המסך זה נראה כמו רצועה של נייר מתחת לתמונה, ואצלי זה נראה
    // שעתיים כמו באג ברצפה. `ResizeObserver` מסתכל על הקופסה עצמה ולכן לא יכול לפספס.
    const watcher = new ResizeObserver(() => resizeThree(three, box))
    watcher.observe(box)

    const onResize = () => {
      resizeThree(three, box)
      // הפס שנשאר לפקד. `ControlDeck` בונה את עצמו לפי הגובה הזה — עם אפס הוא מתקפל
      // לגרסה צפה וקטנה, ועם מאה שלושים הוא הארון עצמו, כמו בכל מסך אחר במשחק.
      const band = Math.round(Math.min(148, Math.max(112, window.innerHeight * 0.16)))
      setDeck({ top: window.innerHeight - band, band })
    }
    onResize()

    window.addEventListener('resize', onResize)
    return () => {
      window.clearTimeout(ready)
      cancelAnimationFrame(raf)
      watcher.disconnect()
      window.removeEventListener('resize', onResize)
      box.removeEventListener('pointerdown', down)
      box.removeEventListener('pointermove', move)
      box.removeEventListener('pointerup', up)
      box.removeEventListener('pointercancel', up)
      for (const map of Object.values(frames)) map.dispose()
      for (const { figure, shade } of people.values()) {
        ;(figure.material as THREE.SpriteMaterial).map?.dispose()
        figure.material.dispose()
        shade.geometry.dispose()
        ;(shade.material as THREE.Material).dispose()
      }
      dispose()
      disposeThree(three, box)
    }
  }, [shot, mission])

  return (
    <main className="fixed inset-0 z-[80] bg-ink">
      <div
        ref={boxRef}
        className="absolute inset-x-0 top-0 touch-none"
        style={{ bottom: shot.deck ? deck.band : 0 }}
      />
      {mission && (
        // **מה עושים כאן.** שורה אחת בראש המסך, ומתחתיה שלוש הנקודות — מלאה למה שנעשה,
        // ריקה למה שנשאר, ואפורה למה שעוד לא נפתח. זאת כל רשימת המשימות: אין תפריט,
        // אין מסך נפרד, ואי אפשר לאבד אותה כי היא תמיד שם.
        <div dir="rtl" className="pointer-events-none absolute inset-x-0 top-0 z-50 px-3 pt-[max(10px,env(safe-area-inset-top))]">
          <div className="mx-auto max-w-[26rem] border-hair border-sheet/25 bg-ink/75 px-3 py-2 backdrop-blur-sm">
            <p className="font-display text-[13px] leading-tight text-sheet">
              <bdi>{mission.titleHe}</bdi>
            </p>
            <ol className="mt-1.5 flex gap-2">
              {mission.beats.map((beat) => {
                const isDone = quest.done.has(beat.id)
                const open = isOpen(beat, quest)
                return (
                  <li key={beat.id} className="flex items-center gap-1.5">
                    <span
                      className={`inline-block h-1.5 w-1.5 ${
                        isDone ? 'bg-red' : open ? 'bg-sheet/80' : 'bg-sheet/25'
                      }`}
                    />
                    <span
                      className={`font-body text-[11px] leading-none ${
                        isDone ? 'text-sheet/45 line-through' : open ? 'text-sheet/90' : 'text-sheet/35'
                      }`}
                    >
                      <bdi>{beat.nameHe}</bdi>
                    </span>
                  </li>
                )
              })}
            </ol>
          </div>
        </div>
      )}
      {mission && note && !saying && (
        // מה שנאמר בהגעה, ובכל פעם שנפתח משהו חדש. נעלם ברגע שמדברים.
        <p
          dir="rtl"
          className="pointer-events-none absolute inset-x-0 z-40 px-6 text-center font-body text-[13px] leading-snug text-sheet/80"
          style={{ top: '22%' }}
        >
          <bdi>{note}</bdi>
        </p>
      )}
      {saying && (
        // תיבת הדיבור. שורה אחת בכל פעם, השם מעליה, וכל נגיעה מתקדמת — אותה מחווה בדיוק
        // כמו בכל שיחה אחרת במשחק. נרטיב (בלי דובר) נכתב באלכסון, כי זה לא מישהו שמדבר
        // אלא מה שהילד רואה.
        <button
          type="button"
          onClick={advance}
          dir="rtl"
          className="absolute inset-x-0 z-50 w-full px-3"
          style={{ bottom: (shot.deck ? deck.band : 0) + 14 }}
        >
          <span className="mx-auto block max-w-[30rem] border-hair border-sheet/30 bg-ink/90 px-4 py-3 backdrop-blur-sm">
            {(() => {
              const branch = branchFor(saying.beat.talk, quest)
              const line = branch?.lines[saying.line]
              if (!line) return null
              return (
                <>
                  {line.who && (
                    <span className="mb-1 block font-display text-[12px] leading-none text-red">
                      <bdi>{line.who}</bdi>
                    </span>
                  )}
                  <span
                    className={`block font-body text-[15px] leading-snug ${
                      line.who ? 'text-sheet' : 'italic text-sheet/75'
                    }`}
                  >
                    <bdi>{line.text}</bdi>
                  </span>
                  <span className="mt-2 block font-body text-[10px] leading-none text-sheet/40">
                    <bdi>{CITY_COPY.saidHe(saying.line + 1, branch?.lines.length ?? 1)}</bdi>
                  </span>
                </>
              )
            })()}
          </span>
        </button>
      )}
      {shot.deck && (
        // בורר המקומות. הוא לא HUD של המשחק — הוא קיים כדי שאפשר יהיה לעבור בין המקומות
        // בלי להקליד כתובת, וייעלם ברגע שהמקומות מחוברים זה לזה בדרך הליכה.
        <nav
          dir="rtl"
          className="absolute inset-x-0 top-0 z-40 flex gap-1 overflow-x-auto bg-gradient-to-b from-ink/80 to-transparent px-2 pb-6 pt-[max(8px,env(safe-area-inset-top))]"
        >
          {PLACE_ORDER.map((key) => (
            <a
              key={key}
              href={`/city?place=${key}`}
              className={`min-h-tap shrink-0 border-hair px-2.5 py-1.5 text-[12px] leading-none ${
                key === shot.place ? 'border-red bg-red text-sheet' : 'border-sheet/40 bg-ink/60 text-sheet/85'
              }`}
            >
              <bdi>{PANOS[key]?.nameHe}</bdi>
            </a>
          ))}
        </nav>
      )}
      {shot.deck && !saying && !near && (
        // שורה אחת, בפינה, פעם אחת. הכפתור הקודם דרש החזקה ומאור הקיש עליו — שלוש מאות
        // מילישניות הן ארבעים סנטימטר, כלומר שום דבר שהעין רואה. עכשיו יש מוט, וכתוב מה הוא.
        <p
          dir="rtl"
          className="pointer-events-none absolute inset-x-0 z-40 px-3 text-center font-body text-[11px] leading-none text-sheet/70"
          style={{ bottom: deck.band + 10 }}
        >
          {CITY_COPY.hintHe}
        </p>
      )}
      {shot.deck && (
        <ControlDeck
          top={deck.top}
          height={deck.band}
          touch
          verb={saying || near ? 'talk' : null}
          label={saying ? CITY_COPY.nextHe : near ? CITY_COPY.talkToHe(near.nameHe) : null}
          onAxis={onAxis}
          onAction={onAction}
          onCancel={onCancel}
        />
      )}
    </main>
  )
}
