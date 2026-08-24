#!/usr/bin/env python3
"""
offsides-banner.py — הפרסומת לאופסיידס כקובץ תמונה.

הפילוסופיה: docs/design/PHILOSOPHY-floodlight.md — "אור זרקורים".

    אצטדיון בלילה אינו מקום מואר. הוא מקום חשוך שבו נבחר משטח
    אחד לקבל אור.

הפורמט 1200×628 הוא כרטיס השיתוף הסטנדרטי — וואטסאפ, אופן־גרף,
טוויטר. זה הפורמט שבו הפרסומת באמת נוסעת.

הרצה:  python3 scripts/design/offsides-banner.py
פלט:   public/brand/offsides-ad.png
"""
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
FONTS = Path('/root/.claude/skills/synced/canvas-design/canvas-fonts')
HEB = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

W, H = 1200, 628
S = 3                                   # סופר-סמפלינג. כל קצה חלק בזכותו.

# ── הפלטה. צבע אחד, ותו לא. ─────────────────────────────────────────
NIGHT = (18, 17, 16)
CHALK = (246, 243, 235)
DIM   = (140, 133, 122)
GLOW  = (255, 91, 20)                   # toto

def font(name, size):
    return ImageFont.truetype(str(FONTS / name), size * S)

def heb(size):
    return ImageFont.truetype(HEB, size * S)


img = Image.new('RGB', (W * S, H * S), NIGHT)
d = ImageDraw.Draw(img, 'RGBA')

# ═══════════════════════════════════════════════════════════════════
#  1. האלומה — אירוע אחד, אלכסוני
# ═══════════════════════════════════════════════════════════════════
#  ★ האלומה נופלת על השליש השמאלי, לא על הטקסט.
#
#  בגרסה הראשונה היא ירדה מימין וצבעה את הטיפוגרפיה בחום עכור:
#  הלבן הפסיק להיות לבן, והסימן — שאמור לחיות *בתוך* האור —
#  נשאר בחושך. זה בדיוק ההפך מהעיקרון. האור בוחר משטח אחד;
#  כאן הוא בוחר את הסימן, והטקסט יושב על שחור נקי וקריא.
beam = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0))
bd = ImageDraw.Draw(beam)
ANGLE = math.radians(24)
SKEW = int(H * S * math.tan(ANGLE))
for i in range(320):
    t = i / 320
    alpha = int(64 * (1 - t) ** 1.9)
    if alpha <= 0:
        continue
    off = int(t * W * S * 0.72)
    left = 96 * S + off
    bd.polygon(
        [(left, 0), (left + 120 * S, 0),
         (left + 120 * S + SKEW, H * S), (left + SKEW, H * S)],
        fill=(*GLOW, alpha),
    )
beam = beam.filter(ImageFilter.GaussianBlur(46 * S))   # פסים = בנייה. טשטוש = אור.
img = Image.alpha_composite(img.convert('RGBA'), beam).convert('RGB')
d = ImageDraw.Draw(img, 'RGBA')

# ═══════════════════════════════════════════════════════════════════
#  2. רשת הנקודות — הדפס רשת של תוכנייה ישנה
# ═══════════════════════════════════════════════════════════════════
#  לא נראית ממרחק צפייה. זו בדיוק המטרה: היא הסיבה שהעין נשארת
#  על העבודה אחרי שהמסר כבר נקרא.
STEP = 9 * S
r = int(1.15 * S)
for y in range(0, H * S, STEP):
    for x in range(0, W * S, STEP):
        # הרשת חיה באור: צפופה יותר משמאל, דועכת ימינה
        k = max(0.0, 1 - (x / (W * S)) * 1.25)
        a = int(26 + 40 * k)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(*CHALK, a))

# ═══════════════════════════════════════════════════════════════════
#  3. הסימן — דגל הקו, מופשט לשלוש צורות
# ═══════════════════════════════════════════════════════════════════
#  מוט · משולש · שובל. השובל הוא ה-💨 של אופסיידס בלי לצייר אמוג׳י:
#  שלוש אלכסוניות שמתקצרות נראות כמו החלטה, אמוג׳י נראה כמו קיצור.
MX, MY = int(228 * S), int(296 * S)     # מרכז הסימן
SC = 4.15 * S                           # קנה מידה. גדול מאוד — אין ביניים.

def p(x, y):
    return (MX + (x - 20) * SC, MY + (y - 20) * SC)

# הילה צמודה, כדי שהסימן יישב "בתוך" האור ולא עליו
halo = Image.new('RGBA', img.size, (0, 0, 0, 0))
ImageDraw.Draw(halo).ellipse(
    [MX - 185 * S, MY - 185 * S, MX + 185 * S, MY + 185 * S], fill=(*GLOW, 54))
halo = halo.filter(ImageFilter.GaussianBlur(72 * S))
img = Image.alpha_composite(img.convert('RGBA'), halo).convert('RGB')
d = ImageDraw.Draw(img, 'RGBA')

d.rounded_rectangle([p(9, 4), p(11.6, 34)], radius=1.3 * SC, fill=CHALK)
d.polygon([p(12.6, 5.2), p(31.5, 12.4), p(12.6, 19.6)], fill=GLOW)
# ★ השובל: שלוש אלכסוניות שמתקצרות ודוהות.
#
#   הגרסה הראשונה ציירה שלושה קווים אופקיים באורך יורד — והם
#   נקראו כמו תרשים עמודות, לא כמו תנועה. הטיה קלה כלפי מטה
#   ודהייה מדורגת הופכות אותם לשובל: העין קוראת כיוון, לא ערכים.
for (x0, x1, y0, y1, a, w) in (
        (13.0, 30.5, 24.2, 25.6, 150, 2.0),
        (13.0, 25.5, 28.6, 30.4, 104, 1.7),
        (13.0, 21.0, 32.8, 34.8,  62, 1.4)):
    d.line([p(x0, y0), p(x1, y1)], fill=(*CHALK, a),
           width=int(w * SC), joint='curve')

# ═══════════════════════════════════════════════════════════════════
#  4. הטיפוגרפיה — שני גדלים בלבד. הביניים הוא מה שהורג את המתח.
# ═══════════════════════════════════════════════════════════════════
RIGHT = W * S - 74 * S                  # שוליים ימניים. RTL: כאן מתחיל הכל.

f_word = font('BigShoulders-Bold.ttf', 108)
f_kick = font('GeistMono-Regular.ttf', 15)
f_heb1 = heb(40)
f_heb2 = heb(21)
f_cta  = heb(23)
f_mark = font('GeistMono-Regular.ttf', 13)

# תווית קלינית מעל השם — סימן ייחוס, לא כותרת
d.text((RIGHT, 118 * S), 'LIVE · IN-MATCH PREDICTION', font=f_kick,
       fill=DIM, anchor='rt')

# השם. גדול מאוד. נקרא ראשון, ואין ויכוח.
d.text((RIGHT, 142 * S), 'OFFSIDES', font=f_word, fill=CHALK, anchor='rt')

# קו האור מתחת לשם — דק, והוא מה שהופך טקסט לשלט
_, _, wl, _ = d.textbbox((0, 0), 'OFFSIDES', font=f_word)
d.line([(RIGHT - wl, 258 * S), (RIGHT, 258 * S)], fill=GLOW, width=int(2.4 * S))

# עברית — שתי שורות, ולא פסקה
d.text((RIGHT, 288 * S), 'ההרכב שלך נעול.', font=f_heb1, fill=CHALK, anchor='rt')
d.text((RIGHT, 336 * S), 'המשחק עוד לא התחיל.', font=f_heb1, fill=GLOW, anchor='rt')
d.text((RIGHT, 398 * S), 'תשעים דקות של ניחושים חיים, מול החברים.',
       font=f_heb2, fill=DIM, anchor='rt')
d.text((RIGHT, 428 * S), 'אותם משחקים. אותו חשבון.',
       font=f_heb2, fill=DIM, anchor='rt')

# ה-CTA — גלולה. פעולה אחת במסך.
label = 'לפתוח זירה'
tb = d.textbbox((0, 0), label, font=f_cta)
tw, th = tb[2] - tb[0], tb[3] - tb[1]
PX, PY = 26 * S, 15 * S
d.rounded_rectangle(
    [RIGHT - tw - PX * 2, 478 * S, RIGHT, 478 * S + th + PY * 2],
    radius=(th + PY * 2) / 2, fill=GLOW)
d.text((RIGHT - PX, 478 * S + PY - tb[1]), label, font=f_cta, fill=NIGHT, anchor='ra')

# ═══════════════════════════════════════════════════════════════════
#  5. סימני הייחוס — לא מוסיפים מידע. מוסיפים רצינות.
# ═══════════════════════════════════════════════════════════════════
BASE = H * S - 40 * S
for i in range(41):
    x = 74 * S + i * ((W * S - 148 * S) / 40)
    tall = (i % 10 == 0)
    d.line([(x, BASE), (x, BASE - (12 if tall else 5) * S)],
           fill=(*CHALK, 70 if tall else 34), width=int(1.1 * S))

d.text((74 * S, BASE + 12 * S), 'OFFSIDEBETS.DUBEL.TEAM',
       font=f_mark, fill=DIM, anchor='lt')
d.text((W * S - 74 * S, BASE + 12 * S), 'FIG. 01 — FLOODLIGHT',
       font=f_mark, fill=(90, 85, 78), anchor='rt')

# ═══════════════════════════════════════════════════════════════════
out = ROOT / 'public' / 'brand' / 'offsides-ad.png'
out.parent.mkdir(parents=True, exist_ok=True)
img.resize((W, H), Image.LANCZOS).save(out, optimize=True)
print(f'✓ {out.relative_to(ROOT)}  ({out.stat().st_size // 1024} KB)')
