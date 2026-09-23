#!/usr/bin/env python3
"""
Compose the AppSource screenshots.

Partner Center wants PNGs at exactly 1366x768, at most 1024 KB each, and the
guidelines ask for text that explains what the reader is looking at. The plates
written by test/capture-appsource.mjs are the visual itself; this lays each one on
a titled canvas beside a rail of callouts.

The callouts sit in their own column rather than on top of the visual: a bubble
dropped over the chart hides the very control it is pointing at, which is the one
thing a screenshot must not do.
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
PLATES = os.path.join(HERE, "appsource-plates")
OUT = os.path.join(HERE, "appsource", "screenshots")
os.makedirs(OUT, exist_ok=True)

W, H = 1366, 768
BG = (243, 246, 250)
INK = (26, 26, 46)
MUTED = (90, 100, 114)
BRAND = (1, 131, 255)
CARD = (255, 255, 255)
EDGE = (226, 232, 240)

F = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
title_f = ImageFont.truetype(FB, 32)
sub_f = ImageFont.truetype(F, 17)
rail_h_f = ImageFont.truetype(FB, 16)
rail_f = ImageFont.truetype(F, 15)
tag_f = ImageFont.truetype(F, 14)

PLATE_X1, PLATE_Y1 = 48, 136
PLATE_X2, PLATE_Y2 = 1012, 706
RAIL_X1, RAIL_X2 = 1040, 1318


def fit(img, box_w, box_h):
    r = min(box_w / img.width, box_h / img.height)
    return img.resize((max(1, int(img.width * r)), max(1, int(img.height * r))), Image.LANCZOS)


def canvas(title, subtitle):
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.text((56, 38), title, font=title_f, fill=INK)
    d.text((58, 84), subtitle, font=sub_f, fill=MUTED)
    return im, d


def card(d, x1, y1, x2, y2):
    d.rounded_rectangle([x1, y1, x2, y2], radius=10, fill=CARD, outline=EDGE, width=1)


def wrap(d, text, font, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if d.textlength(trial, font=font) <= width:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def plate_on(im, d, name, x1=PLATE_X1, y1=PLATE_Y1, x2=PLATE_X2, y2=PLATE_Y2):
    card(d, x1, y1, x2, y2)
    p = fit(Image.open(os.path.join(PLATES, name + ".png")), (x2 - x1) - 24, (y2 - y1) - 24)
    im.paste(p, (x1 + ((x2 - x1) - p.width) // 2, y1 + ((y2 - y1) - p.height) // 2))


def rail(d, heading, items):
    y = PLATE_Y1 + 6
    d.text((RAIL_X1, y), heading, font=rail_h_f, fill=BRAND)
    y += 34
    for it in items:
        d.ellipse([RAIL_X1, y + 6, RAIL_X1 + 8, y + 14], fill=BRAND)
        for line in wrap(d, it, rail_f, RAIL_X2 - RAIL_X1 - 20):
            d.text((RAIL_X1 + 20, y), line, font=rail_f, fill=INK)
            y += 22
        y += 14


def save(im, name):
    path = os.path.join(OUT, name)
    im.save(path, "PNG", optimize=True)
    kb = os.path.getsize(path) / 1024
    assert im.size == (W, H), im.size
    assert kb < 1024, f"{name} exceeds the 1024 KB cap"
    print(f"{name}: {im.size[0]}x{im.size[1]}  {kb:.0f} KB")


# ---------------------------------------------------------------- 1. overview
im, d = canvas(
    "Every control the chart needs, inside the chart",
    "No bookmarks, no field-parameter slicers, no layered shapes to keep in sync.",
)
plate_on(im, d, "overview")
rail(
    d,
    "IN THE HEADER",
    [
        "A dimension dropdown readers use themselves - Department, Location, Band - with no edit rights and no re-query.",
        "Monthly / Quarterly / Annual buttons that re-bucket a date column in place.",
        "A chart / table toggle on the same visual, so one object serves both views.",
        "Every part of it restyles: font, size, colour, alignment, order.",
    ],
)
save(im, "01-controls-in-the-visual.png")

# ------------------------------------------------------------- 2. chart types
im, d = canvas(
    "Fifteen chart types, one visual",
    "Chart type is a setting. The field wells and the table view are identical for every type, so switching costs one click.",
)
names = [
    "type-stackedColumn",
    "type-line",
    "type-stackedArea",
    "type-donut",
    "type-scatter",
    "type-ribbon",
]
cols, rows = 3, 2
gap = 18
gw = (1270 - gap * (cols + 1)) // cols
gh = (566 - gap * (rows + 1)) // rows
for i, n in enumerate(names):
    cx = 48 + gap + (i % cols) * (gw + gap)
    cy = 140 + gap + (i // cols) * (gh + gap)
    card(d, cx, cy, cx + gw, cy + gh)
    p = fit(Image.open(os.path.join(PLATES, n + ".png")), gw - 16, gh - 16)
    im.paste(p, (cx + (gw - p.width) // 2, cy + (gh - p.height) // 2))
d.text(
    (56, 722),
    "Also: 100% stacked column, clustered column, bar, stacked bar, 100% stacked bar, area, 100% stacked area, and two line-and-column combos.",
    font=tag_f,
    fill=MUTED,
)
save(im, "02-fifteen-chart-types.png")

# -------------------------------------------------------------- 3. table view
im, d = canvas(
    "A full data table on the same visual",
    "Chart fields and table fields are separate wells, so the table lists employees while the chart aggregates departments.",
)
plate_on(im, d, "table")
rail(
    d,
    "IN THE TABLE",
    [
        "Search, column sort, expandable child rows, pagination and column totals.",
        "Export exactly the rows on screen, filtered and searched, not the whole model.",
        "Click a column in the chart, switch to table, and the grid shows the rows behind that column.",
        "Header, rows, borders and per-column formatting all follow the format pane.",
    ],
)
save(im, "03-table-view.png")

# ------------------------------------------------- 4. header sentence + insight
im, d = canvas(
    "A header that reads as a sentence",
    "Top N, a dimension and a second dimension in any order, with your own words between them.",
)
plate_on(im, d, "header")
rail(
    d,
    "HEADER AND INSIGHT",
    [
        'Write the sentence yourself: "Top [8] [Department] by headcount, split by [Location]".',
        "The N is an editable box - readers re-rank without opening the format pane.",
        "Three slots, any order, with configurable text before, between and after.",
        "The insight banner takes its text from a DAX measure, so it moves with the filters.",
    ],
)
save(im, "04-header-and-insight.png")

# --------------------------------------------------------------- 5. selection
im, d = canvas(
    "Cross-filtering that keeps up with the report",
    "A click paints immediately, then filters the page - so the rest of the report responds like it does to a native chart.",
)
plate_on(im, d, "selection")
rail(
    d,
    "ON SELECTION",
    [
        "The clicked mark stays lit and the rest dim, before Power BI has been told anything.",
        "The filter names the mark's coordinates instead of listing every row behind it.",
        "Ctrl / Shift click to add marks; click the plot background to clear.",
        "Right-click opens the Power BI context menu for drill-through and include / exclude.",
    ],
)
save(im, "05-cross-filtering.png")

print("done")
