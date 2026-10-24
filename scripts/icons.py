"""Generate app icons, iOS splash screens, PDF logo and a traced SVG mark from logo.png.

Run: python3 scripts/icons.py   (needs Pillow; potrace optional for the SVG)
Outputs are committed so CI doesn't need Python.
"""
import os, shutil, subprocess, tempfile
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'logo.png')
OUT = os.path.join(ROOT, 'public')
BG = (10, 15, 28)          # #0A0F1C
BLACK = (0, 0, 0)

src = Image.open(SRC).convert('RGB')

# Transparent mark: alpha from brightness (gold on black), colour un-premultiplied.
def to_transparent(img):
    rgba = Image.new('RGBA', img.size)
    px, out = img.load(), rgba.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            m = max(r, g, b)
            a = min(255, int(m * 1.45))
            if a < 10:
                out[x, y] = (0, 0, 0, 0)
            else:
                k = 255 / max(a, 1)
                out[x, y] = (min(255, int(r * k)), min(255, int(g * k)), min(255, int(b * k)), a)
    return rgba

mark = to_transparent(src)
bbox = mark.getbbox()
mark = mark.crop(bbox)

def square_mark(size, scale, bg):
    canvas = Image.new('RGBA', (size, size), bg + (255,))
    target = int(size * scale)
    m = mark.copy()
    m.thumbnail((target, target), Image.LANCZOS)
    canvas.alpha_composite(m, ((size - m.width) // 2, (size - m.height) // 2))
    return canvas.convert('RGB')

# Icons (black like the original artwork; maskable keeps the mark inside the 80% safe zone)
square_mark(180, 0.78, BLACK).save(os.path.join(OUT, 'icons', 'apple-touch-icon.png'), optimize=True)
square_mark(192, 0.78, BLACK).save(os.path.join(OUT, 'icons', 'icon-192.png'), optimize=True)
square_mark(512, 0.78, BLACK).save(os.path.join(OUT, 'icons', 'icon-512.png'), optimize=True)
square_mark(512, 0.62, BLACK).save(os.path.join(OUT, 'icons', 'icon-maskable-512.png'), optimize=True)
square_mark(64, 0.86, BLACK).save(os.path.join(OUT, 'icons', 'favicon-64.png'), optimize=True)

# Logo for PDFs (600px wide, transparent) and the in-app header (256px)
for w, name in ((600, 'logo-pdf.png'), (256, 'logo-256.png')):
    m = mark.copy(); m.thumbnail((w, w), Image.LANCZOS)
    m.quantize(colors=128, method=Image.Quantize.FASTOCTREE).save(os.path.join(OUT, 'brand', name), optimize=True)

# iOS splash screens: (width, height, css_w, css_h, dpr)
SPLASH = [
    (1320, 2868, 440, 956, 3), (1206, 2622, 402, 874, 3), (1290, 2796, 430, 932, 3),
    (1179, 2556, 393, 852, 3), (1284, 2778, 428, 926, 3), (1170, 2532, 390, 844, 3),
    (1125, 2436, 375, 812, 3), (1242, 2688, 414, 896, 3), (828, 1792, 414, 896, 2),
    (750, 1334, 375, 667, 2),
]
for (w, h, cw, ch, dpr) in SPLASH:
    canvas = Image.new('RGBA', (w, h), BG + (255,))
    m = mark.copy(); t = int(w * 0.36); m.thumbnail((t, t), Image.LANCZOS)
    canvas.alpha_composite(m, ((w - m.width) // 2, int(h * 0.42) - m.height // 2))
    canvas.convert('RGB').save(os.path.join(OUT, 'splash', f'splash-{w}x{h}.png'), optimize=True)

with open(os.path.join(ROOT, 'src', 'splash-links.json'), 'w') as f:
    import json
    json.dump([{'file': f'splash-{w}x{h}.png', 'w': cw, 'h': ch, 'dpr': dpr} for (w, h, cw, ch, dpr) in SPLASH], f, indent=1)

# Vector mark via potrace (optional)
if shutil.which('potrace'):
    with tempfile.TemporaryDirectory() as d:
        g = src.convert('L').point(lambda v: 0 if v > 70 else 255)  # gold → black for potrace
        g = g.crop(bbox)
        bmp = os.path.join(d, 'm.bmp'); g.save(bmp)
        svg = os.path.join(OUT, 'brand', 'logo-mark.svg')
        subprocess.run(['potrace', bmp, '-s', '-o', svg, '--color', '#D4A537', '-t', '8', '-O', '0.4'], check=True)
print('icons, splash, brand assets written')
