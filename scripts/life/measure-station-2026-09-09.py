#!/usr/bin/env python3
"""
קו האופק של תחנה — נמדד מארבע התמונות הריבועיות, לא מוצהר.

כל הקווים שמקבילים לרחוב במציאות נפגשים בתמונה בנקודה אחת, והנקודה הזאת יושבת בדיוק
בגובה העין של המצלמה. לכן ה-y שלה **הוא** קו האופק, ואין צורך להאמין לאף הצהרה.

בתמונת הצפון והדרום הרחוב בורח לתוך הפריים והמגוז נמצא בתוכה. בתמונות המזרח והמערב
הרחוב חוצה את השדה, והמגוז שלו נופל רחוק מחוץ לפריים — עדיין על אותו קו אופק. לכן
המדידה מחפשת גם בפנים וגם בחוץ, ומדווחת בנפרד על כל כיוון.

    python3 scripts/life/measure-station-2026-09-09.py <תיקייה> <תחילית>
"""
from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np


def segments(img: np.ndarray, min_len: float = 30.0) -> np.ndarray:
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    lsd = cv2.createLineSegmentDetector(cv2.LSD_REFINE_ADV)
    found, _, _, _ = lsd.detect(g)
    if found is None:
        return np.zeros((0, 4), np.float32)
    l = found.reshape(-1, 4)
    l = l[np.linalg.norm(l[:, 2:] - l[:, :2], axis=1) > min_len]
    ang = (np.degrees(np.arctan2(l[:, 3] - l[:, 1], l[:, 2] - l[:, 0])) + 180) % 180
    keep = ((ang < 55) | (ang > 125)) & (np.abs(np.sin(np.radians(ang))) > 0.010)
    return l[keep]


def lines(l: np.ndarray) -> np.ndarray:
    a = np.c_[l[:, 0], l[:, 1], np.ones(len(l))]
    b = np.c_[l[:, 2], l[:, 3], np.ones(len(l))]
    L = np.cross(a, b)
    return L / np.linalg.norm(L[:, :2], axis=1, keepdims=True)


def vanishing(L, seg, w, h, span, tol_deg=0.9):
    """כל הזוגות, בלי הגרלה. השארית זוויתית, במשקל אורך המקטע."""
    n = len(L)
    mid = (seg[:, :2] + seg[:, 2:]) / 2
    dirn = seg[:, 2:] - seg[:, :2]
    length = np.linalg.norm(dirn, axis=1)
    dirn = dirn / length[:, None]
    tol = np.radians(tol_deg)

    def score(v):
        to = v[None, :2] - mid
        d = np.linalg.norm(to, axis=1)
        to = to / np.maximum(d, 1e-6)[:, None]
        cos = np.abs((to * dirn).sum(1))
        m = np.arccos(np.clip(cos, -1, 1)) < tol
        return float(length[m].sum()), m

    best, mask, weight = None, None, -1.0
    for i in range(n):
        for j in range(i + 1, n):
            v = np.cross(L[i], L[j])
            if abs(v[2]) < 1e-9:
                continue
            v = v / v[2]
            if abs(v[0] - w / 2) > span * w or not (0.30 * h < v[1] < 0.90 * h):
                continue
            wgt, m = score(v)
            if wgt > weight:
                weight, best, mask = wgt, v[:2], m
    if best is None:
        return None, None, 0.0
    A = L[mask][:, :2] * length[mask][:, None]
    b = -L[mask][:, 2] * length[mask]
    x = np.linalg.lstsq(A, b, rcond=None)[0]
    return x, int(mask.sum()), weight


def main() -> int:
    folder, prefix = Path(sys.argv[1]), sys.argv[2]
    span = float(sys.argv[3]) if len(sys.argv) > 3 else 6.0
    print(f'{"view":>6}  {"VP x":>10} {"VP y":>8}  {"horizon":>8}  {"inliers":>7}  {"weight":>9}')
    rows = []
    for d in ('n', 'e', 's', 'w'):
        p = folder / f'{prefix}-{d}.png'
        if not p.exists():
            print(f'{d:>6}  (חסר)')
            continue
        img = cv2.imread(str(p))
        h, w = img.shape[:2]
        seg = segments(img)
        L = lines(seg)
        v, inl, wgt = vanishing(L, seg, w, h, span)
        if v is None:
            print(f'{d:>6}  ללא מגוז')
            continue
        print(f'{d:>6}  {v[0]:10.1f} {v[1]:8.1f}  {v[1]/h:8.4f}  {inl:7d}  {wgt:9.0f}')
        rows.append((d, v[1] / h, wgt))
    if rows:
        hz = np.array([r[1] for r in rows])
        wt = np.array([r[2] for r in rows])
        print()
        print(f'ממוצע פשוט   {hz.mean():.4f}   פיזור {np.ptp(hz):.4f}')
        print(f'ממוצע משוקלל {float((hz*wt).sum()/wt.sum()):.4f}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
