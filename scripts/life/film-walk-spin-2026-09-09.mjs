/**
 * הליכה **וגם** סיבוב, ברצף אחד, בלי טעינה מחדש באמצע.
 *
 * שני הדברים נבדקים יחד ולא כל אחד לחוד, מפני שהתקלות שנשארו הן בדיוק במעבר ביניהם:
 * קרקע שקופצת ברגע שעוברים מתחנה לתחנה, וקיר שנעלם ברגע שמסתובבים אליו. סרטון שבו
 * הולכים, נעצרים, מסתובבים סביב הציר במעגל שלם וממשיכים ללכת — מראה את שניהם.
 *
 *   node scripts/life/film-walk-spin-2026-09-09.mjs 'street=bloomfield360' /tmp/ws
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const query = process.argv[2] ?? 'street=bloomfield360'
const out = process.argv[3] ?? '/tmp/cityws'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true })
page.on('console', (m) => { if (m.type() === 'error' && !/TUNNEL|googl|pagead/.test(m.text())) console.log('C', m.text().slice(0, 160)) })
await page.goto(`http://localhost:3311/city?${query}`, { waitUntil: 'networkidle' })
await page.waitForSelector('[data-ready="1"]', { timeout: 25000 }).catch(() => console.log('NOT READY'))
await page.waitForTimeout(1200)

// המוט נתפס במרכזו המדויק — תפיסה בקירוב מוסיפה רכיב קבוע, והמצלמה נסחפת לאורך כל הסרטון.
const stick = await page.evaluate(() => {
  const deck = document.querySelector('[data-life="deck"]')
  if (!deck) return null
  const pads = [...deck.querySelectorAll('*')].filter((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 70 && r.height > 70 && Math.abs(r.width - r.height) < 24
  })
  const pad = pads.sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x)[0]
  if (!pad) return null
  const r = pad.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
const sx = stick?.x ?? 70
const sy = stick?.y ?? 760
console.log('stick at', sx.toFixed(0), sy.toFixed(0))

// כל קטע: לאן דוחפים את המוט וכמה פריימים. הדחיפה נשארת מוחזקת בין הפריימים.
const BEATS = [
  { he: 'הליכה קדימה', dx: 0, dy: -58, n: 46 },
  { he: 'עצירה', dx: 0, dy: 0, n: 6 },
  { he: 'סיבוב שלם', dx: 58, dy: 0, n: 74 },
  { he: 'עצירה', dx: 0, dy: 0, n: 6 },
  { he: 'הליכה והסתכלות', dx: 24, dy: -52, n: 38 },
]

let i = 0
await page.mouse.move(sx, sy)
await page.mouse.down()
for (const beat of BEATS) {
  await page.mouse.move(sx + beat.dx, sy + beat.dy, { steps: 4 })
  for (let k = 0; k < beat.n; k += 1, i += 1) {
    await page.screenshot({ path: `${out}/${String(i).padStart(3, '0')}.png` })
    if (k === 0 || k === beat.n - 1) {
      const s = await page.evaluate(() => {
        const el = document.querySelector('[data-along]')
        return { along: el?.getAttribute('data-along'), yaw: el?.getAttribute('data-yaw') }
      })
      console.log(`${String(i).padStart(3, '0')}  ${beat.he.padEnd(16)}  along ${s.along}  yaw ${s.yaw}`)
    }
  }
}
await page.mouse.up()
console.log(`frames: ${i}`)
await browser.close()
