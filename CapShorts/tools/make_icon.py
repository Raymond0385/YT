"""
Generates the Kadr app icon and logo from one set of proportions.

    python tools/make_icon.py

Writes (relative to the CapShorts folder):
    tools/icon-1024.png          source for `cargo tauri icon` (rounded square, transparent corners)
    frontend/public/logo.png     512 px logo used inside the app
    frontend/public/logo.svg     the same mark as vector
    frontend/public/favicon.ico  16/32/48 px

The mark: a vertical 9:16 viewfinder frame (the "kadr", Russian for frame/shot) with a letter K inside.
Needs Pillow (pip install pillow).
"""

import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# ---- proportions, as a fraction of the icon size S ---------------------------------------------------------
RADIUS = 0.225                 # corner radius of the rounded square
FRAME_W, FRAME_H = 0.36, 0.64  # viewfinder frame, 9:16
BRACKET = 0.13                 # length of each bracket arm
STROKE = 0.048                 # bracket stroke
K_STEM_X = -0.075              # K stem, relative to the center
K_ARM_X = 0.095                # where the K's arms end
K_HALF_H = 0.165               # half height of the K
K_STROKE = 0.056

BG_TOP, BG_BOTTOM = (27, 31, 82), (8, 52, 86)          # deep indigo -> deep teal
MARK_A, MARK_B = (150, 156, 255), (34, 211, 238)       # light indigo -> cyan
FRAME_A, FRAME_B = (255, 255, 255), (186, 230, 253)    # white -> pale cyan


def hexcol(c):
    return '#%02x%02x%02x' % c


def segments(S):
    """All strokes of the mark as ((x1, y1), (x2, y2), width), in pixels for icon size S."""
    cx = cy = S / 2
    fw, fh, b = FRAME_W * S, FRAME_H * S, BRACKET * S
    x0, x1, y0, y1 = cx - fw / 2, cx + fw / 2, cy - fh / 2, cy + fh / 2
    w = STROKE * S
    brackets = []
    for (px, py, dx, dy) in ((x0, y0, 1, 1), (x1, y0, -1, 1), (x0, y1, 1, -1), (x1, y1, -1, -1)):
        brackets.append(((px, py), (px + dx * b, py), w))
        brackets.append(((px, py), (px, py + dy * b), w))
    kw = K_STROKE * S
    sx, ax, hh = cx + K_STEM_X * S, cx + K_ARM_X * S, K_HALF_H * S
    k = [((sx, cy - hh), (sx, cy + hh), kw), ((sx, cy), (ax, cy - hh), kw), ((sx, cy), (ax, cy + hh), kw)]
    return brackets, k


def gradient(size, a, b, diagonal=True):
    """RGB image fading from color a (top-left) to b (bottom-right / bottom)."""
    img = Image.new('RGB', (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = ((x + y) / (2 * (size - 1))) if diagonal else (y / (size - 1))
            px[x, y] = tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))
    return img


def stroke_mask(size, segs):
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    for (p1, p2, w) in segs:
        d.line([p1, p2], fill=255, width=int(round(w)))
        r = w / 2
        for (x, y) in (p1, p2):                      # round caps and joins
            d.ellipse([x - r, y - r, x + r, y + r], fill=255)
    return m


def render(S=1024, scale=2):
    """Icon at S px. Drawn at `scale`x and reduced for smooth edges."""
    N = S * scale
    bg = gradient(N, BG_TOP, BG_BOTTOM, diagonal=False).convert('RGBA')

    brackets, k = segments(N)
    frame = Image.composite(gradient(N, FRAME_A, FRAME_B), Image.new('RGB', (N, N)), stroke_mask(N, brackets))
    kmark = Image.composite(gradient(N, MARK_A, MARK_B), Image.new('RGB', (N, N)), stroke_mask(N, k))
    bg.paste(frame, (0, 0), stroke_mask(N, brackets))
    bg.paste(kmark, (0, 0), stroke_mask(N, k))

    corner = Image.new('L', (N, N), 0)
    ImageDraw.Draw(corner).rounded_rectangle([0, 0, N - 1, N - 1], radius=int(RADIUS * N), fill=255)
    bg.putalpha(corner)
    return bg.resize((S, S), Image.LANCZOS)


def svg(S=1024):
    brackets, k = segments(S)

    def line(seg, stroke):
        (x1, y1), (x2, y2), w = seg
        return f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{stroke}" stroke-width="{w:.1f}" stroke-linecap="round"/>'

    b = '\n    '.join(line(s, 'url(#frame)') for s in brackets)
    kk = '\n    '.join(line(s, 'url(#mark)') for s in k)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}" viewBox="0 0 {S} {S}" role="img" aria-label="Kadr">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{hexcol(BG_TOP)}"/><stop offset="1" stop-color="{hexcol(BG_BOTTOM)}"/>
    </linearGradient>
    <linearGradient id="frame" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="{S}" y2="{S}">
      <stop offset="0" stop-color="{hexcol(FRAME_A)}"/><stop offset="1" stop-color="{hexcol(FRAME_B)}"/>
    </linearGradient>
    <linearGradient id="mark" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="{S}" y2="{S}">
      <stop offset="0" stop-color="{hexcol(MARK_A)}"/><stop offset="1" stop-color="{hexcol(MARK_B)}"/>
    </linearGradient>
  </defs>
  <rect width="{S}" height="{S}" rx="{RADIUS * S:.0f}" fill="url(#bg)"/>
  <g>
    {b}
  </g>
  <g>
    {kk}
  </g>
</svg>
'''


def main():
    big = render(1024, 2)
    big.save(os.path.join(HERE, 'icon-1024.png'))
    pub = os.path.join(ROOT, 'frontend', 'public')
    render(512, 2).save(os.path.join(pub, 'logo.png'))
    open(os.path.join(pub, 'logo.svg'), 'w', encoding='utf-8').write(svg())
    big.resize((256, 256), Image.LANCZOS).save(os.path.join(pub, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)])
    print('icon written')


if __name__ == '__main__':
    main()
