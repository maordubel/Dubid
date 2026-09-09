#!/usr/bin/env python3
"""
ארבע תמונות ריבועיות → פנורמה גלילית אחת של 360 מעלות.

**למה בכלל.** תצלום נגמר בקצה הפריים. מסובבים את האגודל, מגיעים לקצה, ומעבר לו אין
כלום — וזה מה שנראה על המסך כלוח חום ריק על חצי מסך. גליל שלם אין לו קצה: אפשר להסתובב
בו סביב הציר בלי לפגוש שום גבול, כי הפיקסל שאחרי המעלה ה-359 הוא המעלה הראשונה.

**מה הסקריפט עושה.** לכל פיקסל בפנורמה הוא מחשב לאיזה כיוון בעולם הוא מצביע, מסובב את
הכיוון הזה למערכת של כל אחת מארבע התמונות, ושואל אותה מה יש שם. שתי תמונות שכנות רואות
את אותה רצועה של עשר מעלות, ולכן החפיפה נמסכת בחלון קוסינוס — ולא נתפרת בקו, שנראה כתפר.

**מה שהוא לא עושה.** הוא לא מיישר הבדלים בין התמונות. אם חזית בתמונה אחת שונה מזו שבשנייה,
זה יישאר; הסקריפט לא ממציא. מה שהוא כן מבטיח הוא שהגיאומטריה נכונה: כיוון בעולם מקבל את
הפיקסל השייך לו, ולא פיקסל שנראה דומה.

    python3 scripts/life/stitch-station-2026-09-08.py <תיקיית station> <מפתח> [--horizon 0.60]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

OUT = Path(__file__).resolve().parents[2] / 'public' / 'life' / 'art'
MANIFEST = OUT / 'manifest.json'

# הכיוונים, ובאיזו זווית עולם כל אחד מהם מסתכל. אפס הוא כיוון ההליכה.
VIEWS = [('n', 0.0), ('e', 90.0), ('s', 180.0), ('w', 270.0)]


# ------------------------------------------------------------------ חוק הצהוב
def yellow_mask(rgb: np.ndarray) -> np.ndarray:
    a = rgb.astype(np.float32) / 255.0
    mx, mn = a.max(2), a.min(2)
    d = mx - mn
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    h = np.zeros_like(mx)
    m = d > 1e-6
    idx = (mx == r) & m
    h[idx] = ((g - b)[idx] / d[idx]) % 6
    idx = (mx == g) & m
    h[idx] = ((b - r)[idx] / d[idx]) + 2
    idx = (mx == b) & m
    h[idx] = ((r - g)[idx] / d[idx]) + 4
    h *= 60
    s = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0)
    return (h >= 38) & (h <= 70) & (s >= 0.35) & (mx >= 0.35)


def deyellow(rgb: np.ndarray) -> tuple[np.ndarray, int]:
    """
    מסיט כל פיקסל צהוב אל הכתום. ירידה בערוץ הירוק מזיזה את הגוון כלפי מטה ומשאירה את
    הבהירות; חוזרים על זה עד שלא נשאר אף פיקסל, כי לצהוב רווי פעם אחת לא מספיקה.
    """
    out = rgb.astype(np.float32)
    before = int(yellow_mask(rgb).sum())
    for _ in range(60):
        bad = yellow_mask(np.clip(out, 0, 255).astype(np.uint8))
        if not bad.any():
            break
        out[..., 1] = np.where(bad, out[..., 1] * 0.93 - 1.2, out[..., 1])
    return np.clip(out, 0, 255).astype(np.uint8), before


# ------------------------------------------------------------------ הדגימה
def sample(src: np.ndarray, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """דגימה דו־ליניארית. בלעדיה הפנורמה יוצאת מדורגת בדיוק במקום שהעין הכי רגישה בו."""
    h, w, _ = src.shape
    x = np.clip(x, 0, w - 1.001)
    y = np.clip(y, 0, h - 1.001)
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    x1, y1 = x0 + 1, y0 + 1
    fx, fy = (x - x0)[..., None], (y - y0)[..., None]
    return (src[y0, x0] * (1 - fx) * (1 - fy) + src[y0, x1] * fx * (1 - fy)
            + src[y1, x0] * (1 - fx) * fy + src[y1, x1] * fx * fy)


def stitch(folder: Path, key: str, horizon: float, hfov_deg: float, width: int):
    faces = {}
    yellow_in = 0
    for name, _ in VIEWS:
        path = next(folder.glob(f'*-{name}.png'))
        rgb = np.array(Image.open(path).convert('RGB'))
        rgb, had = deyellow(rgb)
        yellow_in += had
        faces[name] = rgb.astype(np.float32)
        print(f'  {name}: {rgb.shape[1]}x{rgb.shape[0]}  yellow in {had}')

    side = faces['n'].shape[0]
    f_px = (side / 2) / np.tan(np.radians(hfov_deg / 2))
    horizon_px = horizon * side

    # **הגובה של הפנורמה נגזר ולא נבחר.** הוא בדיוק הכיסוי האנכי שיש למקור: מהאופק
    # כלפי מעלה עד קצה הפריים, ומהאופק כלפי מטה עד קצהו התחתון. גדול מזה — שוליים ריקים.
    # **הכיסוי הבטוח, ולא הכיסוי במרכז.** בין שני מבטים שכנים יש אזימוט שנמצא ארבעים
    # וחמש מעלות מהמרכז של שניהם, ושם הקרן ארוכה פי ‎1/cos45‎ — כלומר הפינה העליונה של
    # הפריים נגמרת גבוה פחות. פנורמה שנבנית לפי הכיסוי במרכז מקבלת חורים בדיוק בתפרים,
    # ובריצה הראשונה הם היו עשירית מהתמונה.
    worst = np.cos(np.radians(45.0))
    eps_up = np.arctan(horizon_px * worst / f_px)
    eps_down = np.arctan((side - horizon_px) * worst / f_px)
    radius = width / (2 * np.pi)                      # רדיוס הגליל, בפיקסלים
    y_up = radius * np.tan(eps_up)
    y_down = radius * np.tan(eps_down)
    height = int(round(y_up + y_down))
    hz = y_up / (y_up + y_down)
    print(f'  cylinder: {width}x{height}  horizon {hz:.4f}  '
          f'covers +{np.degrees(eps_up):.1f}° / -{np.degrees(eps_down):.1f}°')

    xs = (np.arange(width) + 0.5) / width
    ys = (np.arange(height) + 0.5) / height
    U, V = np.meshgrid(xs, ys)
    theta = (U - 0.5) * 2 * np.pi                      # אזימוט עולם
    tan_eps = (hz - V) * (height / radius)             # גובה על הגליל → tan של הרום

    acc = np.zeros((height, width, 3), np.float32)
    wsum = np.zeros((height, width), np.float32)

    for name, yaw in VIEWS:
        local = theta - np.radians(yaw)
        local = (local + np.pi) % (2 * np.pi) - np.pi  # אל תוך ±180
        dx, dy, dz = np.sin(local), tan_eps, -np.cos(local)
        front = -dz > 1e-3
        with np.errstate(divide='ignore', invalid='ignore'):
            sx = f_px * dx / np.where(front, -dz, 1) + side / 2
            sy = horizon_px - f_px * dy / np.where(front, -dz, 1)
        inside = front & (sx >= 0) & (sx <= side - 1) & (sy >= 0) & (sy <= side - 1)
        # חלון קוסינוס על הזווית מהמרכז: במרכז המבט המשקל אחד, בקצה הוא אפס, והחפיפה
        # של עשר מעלות נמסכת בהדרגה במקום להיתפר בקו.
        w = np.cos(np.clip(local / np.radians(hfov_deg) * np.pi, -np.pi / 2, np.pi / 2)) ** 2
        w = np.where(inside, w, 0.0)
        acc += sample(faces[name], sx, sy) * w[..., None]
        wsum += w

    if (wsum <= 1e-6).any():
        holes = int((wsum <= 1e-6).sum())
        print(f'  WARNING: {holes} pixels ({holes / (width * height) * 100:.2f}%) '
              f'have no source — the four views do not close the circle')
    pano = acc / np.maximum(wsum, 1e-6)[..., None]
    # התפר עצמו יכול **ליצור** צהוב: פיקסל שהוא ממוצע של כתום ושל ירקרק נופל בדיוק
    # בפס האסור. לכן מודדים אחרי המסיכה ולא לפניה, ועל הבייטים שנשמרים.
    pano, made = deyellow(np.clip(pano, 0, 255).astype(np.uint8))
    left = int(yellow_mask(pano).sum())
    if left:
        raise SystemExit(f'{key}: {left} yellow pixels survived the stitch')
    print(f'  yellow: {made} in the seam, 0 shipped')

    Image.fromarray(pano).save(OUT / f'{key}.png', optimize=True)
    near = np.median(pano[int(height * 0.96):].reshape(-1, 3), axis=0).astype(int).tolist()
    return dict(w=width, h=height, horizon=round(float(hz), 4), nearRgb=near,
                yellowIn=yellow_in, yellowLeft=0,
                bytes=(OUT / f'{key}.png').stat().st_size)


def seamless(rgb: np.ndarray, feather: float = 0.16) -> np.ndarray:
    """
    מרצף שחוזר על עצמו כל ארבעה מטר, ושפתו הימנית לא נראית כמו שפתו השמאלית, מצייר קו
    ישר על הרצפה כל ארבעה מטר. מגלגלים את התמונה בחצי, וממסכים את **התפר** שנוצר במרכז
    עם התמונה המקורית — כך שתי השפתיים המקוריות נעשות זהות, והחדשה נמסכת ולא נחתכת.
    """
    h, w, _ = rgb.shape
    a = rgb.astype(np.float32)
    b = np.roll(np.roll(a, w // 2, axis=1), h // 2, axis=0)
    fx = np.clip((np.abs(np.arange(w) - w / 2) / (feather * w)), 0, 1)[None, :]
    fy = np.clip((np.abs(np.arange(h) - h / 2) / (feather * h)), 0, 1)[:, None]
    m = np.minimum(fx, fy)                       # 0 בדיוק על התפר, 1 הרחק ממנו
    m = (m * m * (3 - 2 * m))[..., None]
    return np.clip(np.roll(np.roll(b * m + a * (1 - m), -w // 2, axis=1), -h // 2, axis=0),
                   0, 255).astype(np.uint8)


def match_tone(tile: np.ndarray, target: list[int]) -> np.ndarray:
    """
    הצלחת והפנורמה מצלמות **את אותו אספלט**, ולכן כל הפרש גוון ביניהן הוא של המצלמה ולא
    של המקום. בלי היישור הזה נראית על המדרכה מדרגת גוון אופקית בדיוק במקום שבו האחת
    מוסרת לשנייה. מיישרים חציון לחציון, בערוצים בנפרד, ובכפל — כדי שהצללים יישארו צללים.
    """
    med = np.median(tile.reshape(-1, 3), axis=0)
    gain = np.array(target, np.float32) / np.maximum(med, 1e-3)
    gain = np.clip(gain, 0.75, 1.33)             # יישור, לא צביעה מחדש
    return np.clip(tile.astype(np.float32) * gain, 0, 255).astype(np.uint8)


def floor_tile(folder: Path, key: str, metres: float, near: list[int]):
    """צלחת הרצפה היא כבר מבט מלמעלה בקנה מידה ידוע — היא **המרצף עצמו**, בלי יישור."""
    path = next(folder.glob('*-floor.png'))
    rgb, _ = deyellow(np.array(Image.open(path).convert('RGB')))
    rgb = match_tone(seamless(rgb), near)
    rgb, _ = deyellow(rgb)                       # היישור עצמו יכול להסיט פיקסל אל תוך הפס
    left = int(yellow_mask(rgb).sum())
    if left:
        raise SystemExit(f'{key} floor: {left} yellow pixels survived')
    out = OUT / f'{key}--tile.png'
    Image.fromarray(rgb).save(out, optimize=True)
    return dict(key=f'{key}--tile', wide=metres, deep=metres, bytes=out.stat().st_size)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('folder')
    ap.add_argument('key')
    ap.add_argument('--horizon', type=float, default=0.60)
    ap.add_argument('--hfov', type=float, default=100.0)
    ap.add_argument('--width', type=int, default=4096)
    ap.add_argument('--floor-metres', type=float, default=4.0)
    ap.add_argument('--what', default='')
    ap.add_argument('--source', default='maor-2026-09-08-bloomfield-24m')
    a = ap.parse_args()

    folder = Path(a.folder)
    print(f'{a.key}:')
    row = stitch(folder, a.key, a.horizon, a.hfov, a.width)
    row['tile'] = floor_tile(folder, a.key, a.floor_metres, row['nearRgb'])
    row['source'] = a.source
    row['whatHe'] = a.what or a.key
    row['proj'] = 'cyl'
    row['hFovDeg'] = 360

    m = json.loads(MANIFEST.read_text(encoding='utf-8'))
    m.setdefault('panoramas', {})[a.key] = row
    MANIFEST.write_text(json.dumps(m, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'  written: {row["w"]}x{row["h"]}  {row["bytes"] // 1024} KB  '
          f'tile {row["tile"]["bytes"] // 1024} KB  road {row["nearRgb"]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
