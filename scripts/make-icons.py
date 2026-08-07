#!/usr/bin/env python3
"""Generate Oscar Arena icons from the user-supplied Rangers logo EXACTLY as-is.

The user explicitly asked: use the transparent-background logo directly as the
favicon and as the app icon/logo — NO added background, no tile, no ring. Just
resize (with a little breathing-room padding) so it looks clean at every size.

Outputs in client/public/icons/:
  favicon-16.png favicon-32.png favicon-48.png   (browser tab)
  icon-192.png icon-512.png                       (PWA / home screen)
  icon-maskable-512.png                           (same logo, safe-zone padded)
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, 'client', 'public')
OUT = os.path.join(PUB, 'icons')
LOGO = os.path.join(PUB, 'rangers-logo.png')   # user-supplied, bg removed
os.makedirs(OUT, exist_ok=True)


def load_logo():
    im = Image.open(LOGO).convert('RGBA')
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    return im


def logo_on_canvas(canvas_size, logo_fraction=0.92):
    """Center the logo on a transparent square canvas, scaled to logo_fraction
    of the canvas (the rest is breathing room)."""
    logo = load_logo()
    target = int(canvas_size * logo_fraction)
    logo.thumbnail((target, target), Image.LANCZOS)
    canvas = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
    x = (canvas_size - logo.size[0]) // 2
    y = (canvas_size - logo.size[1]) // 2
    canvas.alpha_composite(logo, (x, y))
    return canvas


def main():
    # Favicons: logo as-is, transparent background (keep alpha — flattening to
    # RGB would turn the transparent areas black, which is the exact artifact
    # the user complained about).
    for s in (16, 32, 48):
        img = logo_on_canvas(s, 0.94 if s >= 32 else 0.9)
        img.save(os.path.join(OUT, f'favicon-{s}.png'))

    # App icons: logo as-is, transparent background.
    logo_on_canvas(192, 0.92).save(os.path.join(OUT, 'icon-192.png'))
    logo_on_canvas(512, 0.92).save(os.path.join(OUT, 'icon-512.png'))

    # Maskable: same logo but smaller (safe zone) so launcher masks don't crop it.
    logo_on_canvas(512, 0.72).save(os.path.join(OUT, 'icon-maskable-512.png'))

    print('icons:', ', '.join(sorted(os.listdir(OUT))))


if __name__ == '__main__':
    main()