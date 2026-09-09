"""
כמה רחוק כל דבר — פרופיל העומק של פנורמה, נמדד מהתמונה עצמה.

  python3 scripts/life/depth-profile-2026-09-07.py            # מדידה + תמונות בקרה
  python3 scripts/life/depth-profile-2026-09-07.py --write    # וגם כתיבה למניפסט

**למה זה קיים.** גליל ברדיוס אחד הוא ההנחה שכל מה שרואים נמצא באותו מרחק. זה נכון בנקודת
הצילום ורק בה, ולכן אפשר היה לזוז ממנה כמה מטרים ולא יותר: העץ שבשלושה מטר והמגדל שבמאה
זזים באותו קצב, והעין קוראת את זה מיד כ"התמונה מתקרבת" ולא כ"אני הולך". מאור, 7.9.2026:
*"הוא סתם עומד במקום בפועל."*

**מה שנמדד, ובלי רשת נוירונים.** בהטלה גלילית, השורה שבה דבר פוגש את הרצפה אומרת בדיוק
כמה הוא רחוק:

    r(θ) = eye · (aspect / hFov) / (py_base(θ) − horizon)

כלומר כל מה שדרוש הוא **קו המגע** — היכן, בכל עמודה, נגמרת הרצפה. זו לא הערכה: זו קריאה
של גיאומטריה שכבר נמצאת בתמונה, מאותו היפוך בדיוק שהרצפה כבר נבנית ממנו.

**שלוש דרכים נוסו. שתיים נכשלו, ושתיהן מלמדות.**

1. **שפות** — תכנות דינמי שמחפש את הקו הרציף בעל השפה האופקית החזקה ביותר. נעל על אבן
   שפה ועל פס חשמלית, כי לשניהם שפה חזקה בדיוק כמו לבסיס קיר. שפה לא מבדילה בין "כאן
   נגמרת הרצפה" לבין "כאן הרצפה משנה גוון".
2. **הליכה בעמודה עם מדד מבנה אנכי** — עצרה על סימני כביש, כי במבט משיק גם לאספלט יש
   שפות אנכיות.
3. **מה שעובד: לזהות את הרצפה עצמה, לפי צבע, ואז לחסום דליפה לפי רציפות בעמודה.**

הרצועה התחתונה של התמונה היא רצפה בהכרח — הצלם עמד עליה. ממנה נלמדים ארבעה צברי צבע
במרחב Lab (אבן שפה משנה גוון אבל נשארת רצפה, ולכן הצבע שלה נלמד עם השאר; חזית בניין לא).
פיקסל הוא רצפה אם הוא קרוב לאחד מהם ואם הוא מתחת לקו האופק. ואז — וזה מה שמנע את הכשל
בחדרים — לכל עמודה נלקח רק **הרצף הראשון מלמטה**: רצפת טרצו בהירה וקיר בהיר הם אותו צבע,
והאזור המחובר טיפס את הקיר דרך פינה אחת וכיסה חדר שלם. רצף בעמודה לא יכול לדלוף הצידה.

איפה שהרצפה מגיעה עד קו האופק — רחוב שנמשך — המרחק שואף לאינסוף והוא נחתך ב-`FAR`. זה
נכון ולא קירוב: שם באמת אין קיר.
"""
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, '..', '..', 'public', 'life', 'art')
GENERATED = os.path.join(HERE, '..', '..', 'lib', 'life', 'generated', 'cityDepth.ts')
SHOTS = os.environ.get('DEPTH_SHOTS', '/tmp/depth')

# key → (שדה ראייה אופקי, קו האופק, גובה עין) — אותם מספרים שב-`lib/life/city/pano.ts`
JOBS = {
    'panoJaffa': (128, 0.700, 1.7),
    'panoBloomFacade': (150, 0.575, 1.7),
    'panoBloomGate': (120, 0.615, 1.7),
    'panoUssOutside': (124, 0.745, 1.7),
    'panoTamar': (128, 0.735, 1.7),
    'panoCinema': (130, 0.735, 1.7),
    'panoPromenade': (132, 0.720, 1.7),
    'panoRoomBed': (140, 0.500, 1.1),
    'panoRoomKitchen': (140, 0.500, 1.1),
    'panoRoomLiving': (140, 0.500, 1.1),
    'panoRoomGrocery': (140, 0.500, 1.1),
    # חמש תחנות חזית בלומפילד — תצלומים רגילים, ולכן ההטלה הרביעית
    'panoBloom24': (360, 0.60, 1.7),
    'panoBloom18': (360, 0.60, 1.7),
    'panoBloomWalk1': (96, 0.5964, 1.7, 'rect', 'bloomWalk'),
    'panoBloomWalk2': (96, 0.5784, 1.7, 'rect', 'bloomWalk'),
    'panoBloomWalk3': (96, 0.5918, 1.7, 'rect', 'bloomWalk'),
    'panoBloomWalk4': (96, 0.6404, 1.7, 'rect', 'bloomWalk'),
    'panoBloomWalk5': (96, 0.5914, 1.7, 'rect', 'bloomWalk'),
}

SAMPLES = 192      # דגימות אזימוט — כמעלה אחת, מתחת למה שהעין מבחינה בו כשקיר מתעקם
FAR = 140.0        # "אין כאן קיר", במטרים
NEAR_FLOOR = 2.0   # שום קיר לא נצמד לפנים של המצלמה בגלל רעש בקו המגע


def _rows_at(small: np.ndarray, centres: np.ndarray, threshold: float, horizon: float) -> np.ndarray:
    sh, sw, _ = small.shape
    distance = np.min(np.linalg.norm(small[:, :, None, :] - centres[None, None, :, :], axis=3), axis=2)
    floor = distance < threshold
    limit = int(sh * (horizon + 0.004))
    floor[:limit] = False
    floor = ndimage.binary_closing(floor, np.ones((5, 5)))
    floor = ndimage.binary_opening(floor, np.ones((3, 3)))
    # הפתיחה המורפולוגית מכרסמת את שולי התמונה, והשורה התחתונה יצאה ממנה כבויה — ואז ההליכה
    # מלמטה נעצרה בצעד הראשון וכל עמודה החזירה את קצה התמונה. הרצועה התחתונה היא רצפה
    # בהכרח; מחזירים אותה במפורש.
    floor[int(sh * 0.97):] = True

    # העלייה נעצרת רק על **הפסקה מתמשכת**, לא על שורה בודדת. פס חשמלית הוא קו מתכת דק
    # שחוצה את הכביש לרוחבו, ומספיק פיקסל אחד ממנו כדי לעצור הליכה נאיבית — וזה מה שנתן
    # לשדרות ירושלים קיר בעשרה מטר במרכזה. שלוש שורות ברבע רזולוציה הן שנים־עשר פיקסלים
    # בתמונה המלאה: מעל כל פס, מתחת לכל בסיס קיר.
    # העלייה נעצרת רק על **הפסקה מתמשכת**, לא על שורה בודדת. פס חשמלית הוא קו מתכת דק
    # שחוצה את הכביש לרוחבו, ומספיק פיקסל אחד ממנו כדי לעצור הליכה נאיבית. שלוש שורות
    # ברבע רזולוציה הן שנים־עשר פיקסלים בתמונה המלאה: מעל כל פס, מתחת לכל בסיס קיר.
    #
    # נוסתה גם הגישה ההפוכה — לקחת את הגבול העליון של אזור הרצפה המחובר, בהנחה שרצפה
    # שממשיכה מעבר לחפץ מוכיחה שהוא לא קיר. היא נכשלה הפוך: אזור מחובר מטפס קירות דרך
    # פינה אחת, וכל אחת־עשרה הפנורמות יצאו "פתוחות" עד מאה וארבעים מטר. מה שנשאר הוא
    # המדידה השמרנית — המכשול הקרוב ביותר — ולצידה **גבול הליכה שנגזר ממנה**, כך שאי אפשר
    # להיתקל בקיר שנמדד קרוב מדי.
    BREAK = 3
    rows = np.full(sw, sh - 1)
    for x in range(sw):
        y = sh - 1
        gap = 0
        stop = limit
        while y > limit:
            if floor[y, x]:
                gap = 0
            else:
                gap += 1
                if gap >= BREAK:
                    stop = y + BREAK
                    break
            y -= 1
        rows[x] = stop
    return ndimage.median_filter(rows, size=11)


def ladder_of(rgb: np.ndarray, horizon: float) -> dict:
    """כל קווי המגע האפשריים לתמונה אחת, סף אחר סף. משמש גם לבחירה בתוך תמונה וגם
    לבחירה משותפת לקבוצה של תחנות שצולמו באותו רחוב."""
    h, w, _ = rgb.shape
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    small = cv2.resize(lab, (w // 4, h // 4), interpolation=cv2.INTER_AREA)
    sh, sw, _ = small.shape
    seed = np.float32(small[int(sh * 0.98):].reshape(-1, 3))
    _, _, centres = cv2.kmeans(
        seed, 3, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0), 4,
        cv2.KMEANS_PP_CENTERS,
    )
    return {t: _rows_at(small, centres, t, horizon).astype(float) for t in range(8, 19)}


def plateau(tried: dict) -> tuple[int, float]:
    """הסף שבו התוצאה משתנה הכי פחות בין שכניו — מישור בעקומה, ולא נקודה שנבחרה."""
    ladder = sorted(tried)
    best, score = ladder[0], None
    for i, th in enumerate(ladder):
        neighbours = [tried[ladder[j]] for j in (i - 1, i + 1) if 0 <= j < len(ladder)]
        change = float(np.mean([np.abs(tried[th] - n).mean() for n in neighbours]))
        if score is None or change < score:
            best, score = th, change
    return best, float(score or 0)


def contact_rows(rgb: np.ndarray, horizon: float) -> tuple[np.ndarray, float]:
    """לכל עמודה: השורה שבה הרצפה נגמרת, ובאיזה סף היא נמצאה.

    **הסף לא נבחר ביד.** רצפת אספלט כהה מול חזית בהירה נפרדת בסף גדול; מדרכת אבן בהירה
    מול בניין מאותה אבן — שדרות ירושלים — דורשת סף קטן, ובסף הגדול היא מטפסת עד קו האופק
    וכל הרחוב יוצא "פתוח". סף אחד לכל התמונות לא קיים.

    מה שכן קיים הוא **מבחן יציבות**: סורקים את הסף מ-8 עד 18, ובוחרים את הערך שבו התוצאה
    משתנה הכי פחות בין שכניו. מישור כזה אומר שהגבול הוא שפה אמיתית במרחב הצבע ולא תוצר של
    היכן הונח הכפתור. זה כיול, לא טעם.
    """
    h, w, _ = rgb.shape
    tried = ladder_of(rgb, horizon)
    best, _ = plateau(tried)
    rows = tried[best]
    sw = len(rows)
    return np.interp(np.arange(w), np.arange(sw) * 4 + 2, rows * 4 + 2).astype(int), float(best)


def profile(key: str, hfovdeg: float, horizon: float, eye: float, proj: str = 'cyl',
            force: int | None = None):  # noqa: C901
    im = Image.open(os.path.join(ART, f'{key}.png')).convert('RGB')
    rgb = np.asarray(im)
    h, w, _ = rgb.shape
    aspect = w / h
    hfov = np.deg2rad(hfovdeg)

    if force is None:
        top, threshold = contact_rows(rgb, horizon)
    else:
        # סף שנקבע לקבוצה. חמש תחנות של אותו רחוב חייבות סף אחד — אחרת שתיים מהן
        # קוראות סימני כביש כקיר בשמונה מטר, ושלוש קוראות את אותו רחוב כפתוח. הבחירה
        # היא אותו מבחן יציבות בדיוק, רק שהוא מסוכם על כל התחנות יחד.
        rows = ndimage.median_filter(ladder_of(rgb, horizon)[force], size=11)
        sw = len(rows)
        top = np.interp(np.arange(w), np.arange(sw) * 4 + 2, rows * 4 + 2).astype(int)
        threshold = float(force)
    py = top / (h - 1)
    # אורך הקרן אל כל עמודה, ביחידות של גובה התמונה. בפנורמה גלילית הוא קבוע; בתצלום
    # רגיל הוא נמתח לכיוון הקצוות, ולכן אותה שורה בקצה הפריים מסמנת מרחק **גדול יותר**.
    rect = proj == 'rect'
    fN = aspect / 2 / np.tan(hfov / 2) if rect else aspect / hfov
    if rect:
        theta = np.arctan(((np.arange(w) / (w - 1)) - 0.5) * aspect / fN)
        k = fN / np.cos(theta)
    else:
        theta = ((np.arange(w) / (w - 1)) - 0.5) * hfov
        k = np.full(w, fN)
    r = np.where(py - horizon > 1e-3, eye * k / np.maximum(py - horizon, 1e-3), FAR)

    theta = np.rad2deg(theta)
    edges = np.linspace(theta[0], theta[-1], SAMPLES + 1)
    centres = (edges[:-1] + edges[1:]) / 2
    out = np.empty(SAMPLES)
    for i in range(SAMPLES):
        sel = (theta >= edges[i]) & (theta < edges[i + 1])
        # חציון ולא ממוצע: עמוד תאורה או אדם בודד לא אמורים למשוך קיר שלם אליהם
        out[i] = np.median(r[sel]) if sel.any() else FAR
    out = np.clip(out, NEAR_FLOOR, FAR)
    # **חשמלית היא לא קיר.** קו המגע נעצר בכל דבר שעומד על הרצפה, וזה נכון — אבל עמוד,
    # עץ, מכונית או חשמלית הם *חפצים*, ורוחבם בזווית הוא כמה מעלות. חזית בניין רחבה
    # עשרות מעלות. סגירה מורפולוגית על אות המרחק (הרחבה ואז כיווץ) ממלאת בדיוק את
    # השקעים הצרים מהשכנים שלהם ומשאירה את המישורים הרחבים כמו שהם. בלי זה השדרה, שפתוחה
    # עד מגדל השעון, קיבלה קיר בשמונה מטר במרכזה — כי החשמלית עמדה שם.
    OBJECT = 13                       # ≈ שמונה מעלות; מעל זה כבר לא חפץ אלא חזית
    out = ndimage.grey_closing(out, size=OBJECT, mode='nearest')
    # החלקה רחבה, ובכוונה. שני מדפים שכנים במרחקים רחוקים מאוד יוצרים מרובע שנמתח ביניהם,
    # וברגע שהמצלמה זזה הצידה המתיחה הזאת נראית כמריחה — עץ קרוב שנמרח על הרחוב שמאחוריו.
    # חלון של עשר מעלות מרכך את המצוקים ומשאיר את החזיתות. זה מוותר על מעט דיוק בפרלקסה
    # תמורת שלא יהיו מריחות, וזה הוויתור הנכון: מריחה נראית כתקלה, פרלקסה מעט רכה לא.
    WIDE = 15
    pad = np.r_[out[:WIDE][::-1], out, out[-WIDE:][::-1]]
    out = np.convolve(pad, np.ones(WIDE) / WIDE, mode='same')[WIDE:-WIDE]

    check = im.copy()
    draw = ImageDraw.Draw(check)
    draw.line([(x, int(top[x])) for x in range(0, w, 4)], fill=(255, 40, 40), width=5)
    return centres, out, check, threshold


def main() -> None:
    os.makedirs(SHOTS, exist_ok=True)
    manifest_path = os.path.join(ART, 'manifest.json')
    manifest = json.load(open(manifest_path, encoding='utf-8'))
    write = '--write' in sys.argv
    # --- סף משותף לכל קבוצה. זה המקום היחיד שבו תחנות מדברות זו עם זו: חמש תמונות של
    # אותו רחוב חייבות סף אחד, אחרת שתיים מהן קוראות סימני כביש כקיר בשמונה מטר בעוד
    # שלוש קוראות בדיוק את אותו רחוב כפתוח. המבחן הוא אותו מבחן יציבות, מסוכם על כולן.
    shared: dict[str, int] = {}
    groups: dict[str, list[str]] = {}
    for key, job in JOBS.items():
        if len(job) > 4 and os.path.exists(os.path.join(ART, f'{key}.png')):
            groups.setdefault(job[4], []).append(key)
    for name, keys in groups.items():
        pooled: dict = {}
        for key in keys:
            rgb = np.asarray(Image.open(os.path.join(ART, f'{key}.png')).convert('RGB'))
            for th, rows in ladder_of(rgb, JOBS[key][1]).items():
                pooled.setdefault(th, []).append(rows)
        merged = {th: np.concatenate(v) for th, v in pooled.items()}
        shared[name], _ = plateau(merged)
        print(f'group {name}: {len(keys)} stations share threshold {shared[name]}')

    for key, job in JOBS.items():
        hfovdeg, horizon, eye = job[0], job[1], job[2]
        proj = job[3] if len(job) > 3 else 'cyl'
        force = shared.get(job[4]) if len(job) > 4 else None
        if not os.path.exists(os.path.join(ART, f'{key}.png')):
            print(f'{key}: missing')
            continue
        centres, r, check, threshold = profile(key, hfovdeg, horizon, eye, proj, force)
        check.resize((900, int(900 * check.size[1] / check.size[0]))).save(os.path.join(SHOTS, f'{key}.png'))
        print(f'{key:16s} {r.min():6.1f}–{r.max():6.1f} m   median {np.median(r):6.1f}   '
              f'open {(r > FAR * 0.9).mean() * 100:3.0f}%   (threshold {threshold:.0f})')
        if write:
            manifest['panoramas'].setdefault(key, {})['depth'] = {
                'fromDeg': round(float(centres[0]), 3),
                'toDeg': round(float(centres[-1]), 3),
                'far': FAR,
                'metres': [round(float(v), 2) for v in r],
            }
    if write:
        json.dump(manifest, open(manifest_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        write_generated(manifest)
        print('manifest + lib/life/generated/cityDepth.ts updated')


HEADER = '''/**
 * נוצר אוטומטית — do not edit. `python3 scripts/life/depth-profile-2026-09-07.py --write`
 * כותב אותו מחדש.
 *
 * כמה רחוק כל דבר בכל פנורמה, לפי אזימוט. המספרים נמדדים מהתמונה עצמה: בהטלה גלילית
 * השורה שבה דבר פוגש את הרצפה אומרת בדיוק כמה הוא רחוק, ולכן `r(θ)` הוא קריאה של
 * גיאומטריה ולא הערכה. הסקריפט מסביר איך קו המגע נמצא, ולמה שתי שיטות אחרות נזרקו.
 *
 * זה מה שהופך גליל ברדיוס אחד — שבו העץ שבשלושה מטר והמגדל שבמאה זזים באותו קצב — לקיר
 * עם צורה, שבו כל דבר זז בקצב שלו. כלומר: הליכה.
 */
export type CityDepth = {
  /** הזווית של הדגימה הראשונה, במעלות מהמרכז */
  fromDeg: number
  /** הזווית של האחרונה */
  toDeg: number
  /** המרחק שמעליו "אין כאן קיר" */
  far: number
  /** מרחק במטרים, בדגימות אחידות בין `fromDeg` ל-`toDeg` */
  metres: number[]
}

export const CITY_DEPTH: Record<string, CityDepth> = {
'''


def write_generated(manifest: dict) -> None:
    rows = []
    for key, row in manifest.get('panoramas', {}).items():
        depth = row.get('depth')
        if not depth:
            continue
        metres = ', '.join(f'{v:g}' for v in depth['metres'])
        rows.append(
            f"  {key}: {{ fromDeg: {depth['fromDeg']:g}, toDeg: {depth['toDeg']:g}, "
            f"far: {depth['far']:g}, metres: [{metres}] }},"
        )
    with open(GENERATED, 'w', encoding='utf-8') as handle:
        handle.write(HEADER + '\n'.join(rows) + '\n}\n')


if __name__ == '__main__':
    main()
