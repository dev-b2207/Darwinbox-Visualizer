#!/usr/bin/env python3
"""
Draw the 300x300 listing logo Partner Center asks for.

Same motif as the 20x20 icon that ships inside the package - a header strip above
a stacked column chart, which is what the visual is - so the tile in AppSource and
the icon in the Visualizations pane read as the same product. Drawn at 4x and
downsampled, because a 300px PNG of hard edges wants real antialiasing.

The AppSource logo is the listing tile and may be in colour; the grey #C8C8C8 rule
in the visuals guidelines applies to a commercial logo drawn *inside* the visual,
which this one does not do.
"""
import os
from PIL import Image, ImageDraw

S = 1200          # working size, 4x the 300px output
M = 40            # white margin at output scale -> 160 here
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "appsource", "logo-300x300.png")

BLUE = (1, 131, 255)
DARK = (28, 31, 42)
GOLD = (255, 192, 0)
WHITE = (255, 255, 255)

im = Image.new("RGB", (S, S), WHITE)
d = ImageDraw.Draw(im)

# the badge
pad = 120
d.rounded_rectangle([pad, pad, S - pad, S - pad], radius=180, fill=BLUE)

# header strip: the controls that live inside this visual
bar_x1, bar_x2 = pad + 130, S - pad - 130
bar_y1 = pad + 150
d.rounded_rectangle([bar_x1, bar_y1, bar_x2, bar_y1 + 86], radius=26, fill=DARK)
# the three granularity buttons, one of them active
seg = (bar_x2 - bar_x1 - 24) / 3
for i in range(3):
    x = bar_x1 + 12 + i * seg
    d.rounded_rectangle(
        [x + 6, bar_y1 + 16, x + seg - 6, bar_y1 + 70],
        radius=14,
        fill=WHITE if i == 0 else (78, 84, 100),
    )

# the stacked columns
base = S - pad - 150
cols = [(0.62, 0.26), (0.40, 0.18), (0.78, 0.14)]   # (blue height, gold height) as a share
cw = 150
gap = 62
total = len(cols) * cw + (len(cols) - 1) * gap
x = (S - total) / 2
span = base - (bar_y1 + 190)
for lower, upper in cols:
    h1 = span * lower
    h2 = span * upper
    d.rounded_rectangle([x, base - h1, x + cw, base], radius=10, fill=WHITE)
    d.rounded_rectangle([x, base - h1 - h2, x + cw, base - h1 + 8], radius=10, fill=GOLD)
    x += cw + gap

# baseline
d.rounded_rectangle([(S - total) / 2 - 30, base + 6, (S + total) / 2 + 30, base + 18], radius=6, fill=WHITE)

im.resize((300, 300), Image.LANCZOS).save(OUT, "PNG", optimize=True)
print(OUT, Image.open(OUT).size, f"{os.path.getsize(OUT)/1024:.0f} KB")
