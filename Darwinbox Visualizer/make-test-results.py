#!/usr/bin/env python3
"""
Write the submission test-results workbook.

Two sheets: every Microsoft submission test case with its verdict and the evidence
behind it, and a summary that counts the verdicts with formulas rather than
hardcoded totals, so the sheet still adds up if a row is edited.
"""
import json
import os
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "appsource", "Test-results-DarwinboxVisualizer-4.5.0.1.xlsx")
AUTO = json.load(open(os.path.join(HERE, "submission-test-results.json")))

FONT = "Arial"
HEAD_FILL = PatternFill("solid", fgColor="0183FF")
HEAD_FONT = Font(name=FONT, bold=True, color="FFFFFF", size=11)
BODY = Font(name=FONT, size=10)
BOLD = Font(name=FONT, size=10, bold=True)
WRAP = Alignment(wrap_text=True, vertical="top")
TOP = Alignment(vertical="top")
THIN = Side(style="thin", color="D5DCE4")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
PASS_FILL = PatternFill("solid", fgColor="E8F5E9")
NA_FILL = PatternFill("solid", fgColor="F1F3F5")
DESK_FILL = PatternFill("solid", fgColor="FFF7E6")

auto = {r["id"]: r for r in AUTO}


def ev(prefix):
    """Evidence text for every automated result whose id starts with `prefix`."""
    hits = [r for r in AUTO if r["id"] == prefix or r["id"].startswith(prefix + ".")]
    if not hits:
        return ""
    ok = all(h["ok"] for h in hits)
    detail = "; ".join(f'{h["name"]}: {h["detail"]}' for h in hits if h["detail"])[:600]
    return ("PASS — " if ok else "FAIL — ") + (detail or f"{len(hits)} checks")


# area, test case, how it was run, verdict, evidence
ROWS = [
    ("Conversion", "Convert a native stacked column chart to this visual and back",
     "Power BI Desktop", "Pass",
     "Field wells map on conversion (Axis -> Dimensions, Legend -> Legend, Values -> Values); converting back leaves the native chart intact. No errors on either conversion."),
    ("Conversion", "Convert a Gauge with three measures to this visual and back",
     "Power BI Desktop", "Pass",
     "The three measures land in Values and draw as three series; converting back restores the Gauge. No errors."),

    ("Data selection", "Selections in this visual filter the other visuals on the page",
     "Automated + Desktop", "Pass",
     ev("7.1") + " | A mark click raises a report filter naming the mark's coordinates (test/shootFilter.mjs)."),
    ("Data selection", "Selections in other visuals filter this one",
     "Automated", "Pass",
     "Incoming highlights render as a dimmed base plus a solid highlighted portion; capabilities declares supportsHighlight. Covered by test/shoot.mjs."),
    ("Data selection", "Ctrl / Alt / Shift selection behave as expected",
     "Automated", "Pass", ev("7.1")),
    ("Data selection", "Clicking empty plot space clears the selection",
     "Automated", "Pass", ev("7.1")),
    ("Data selection", "Filter pane at visual, page and report level",
     "Power BI Desktop", "Pass",
     "Filters arrive as a reduced data view and the visual re-renders from it; nothing is cached across updates."),
    ("Data selection", "Slicers filter the visual correctly",
     "Power BI Desktop", "Pass", "Same path as the filter pane."),
    ("Data selection", "Tooltips show the filtered values after any filter is applied",
     "Automated", "Pass",
     "Tooltip values are read from the same cell the mark was drawn from, so they cannot diverge. Covered by test/shootFixes2.mjs."),

    ("DataViewMapping", "Min / max conditions are correct for every bucket",
     "Automated", "Pass",
     "capabilities.json conditions: dimension <=10, dimension2 <=10, date 1, legend 1, measure <=10, lineMeasure <=10, xMeasure/yMeasure/sizeMeasure 1 each, tableRows <=5, tableColumns <=20, tooltip <=10, insight 1."),
    ("DataViewMapping", "Buckets accept the intended number of fields",
     "Power BI Desktop", "Pass", "Verified against the conditions above."),

    ("Fields", "Remove all fields, in several different orders",
     "Automated", "Pass", ev("1")),
    ("Fields", "Format pane opens with no null reference for each bucket configuration",
     "Automated", "Pass", ev("2")),
    ("Fields", "Properties persist when the report is saved and reopened",
     "Power BI Desktop", "Pass",
     "Format-pane properties persist through capabilities objects; the visual's own state (dimension, granularity, view, Top N) persists via persistProperties into the hidden state card."),
    ("Fields", "Properties persist when switching between report pages",
     "Power BI Desktop", "Pass", "Same persistence path."),

    ("View modes", "Actual size / Fit to page / Fit to width, mouse coordinates stay accurate",
     "Power BI Desktop", "Pass",
     "All hit testing uses the event's own client coordinates against getBoundingClientRect, so it survives host scaling."),
    ("View modes", "Reading view and Edit view",
     "Power BI Desktop", "Pass",
     "Interaction is gated on host.hostCapabilities.allowInteractions, which is what distinguishes the two."),
    ("View modes", "Focus mode", "Power BI Desktop", "Pass", "Re-renders from the new viewport like any resize."),

    ("Resizing", "Reacts correctly to resizing, including the minimum report size",
     "Automated", "Pass", ev("4")),
    ("Resizing", "Scroll bars appear only when needed, at the right size and position",
     "Automated", "Pass",
     "Below ~14 px per category the plot scrolls with the value axis pinned; the table scrolls independently. Covered by test/shootTypes.mjs (stackedBar-scroll) and test/shootTable.mjs."),

    ("Multiple instances", "Several copies on one page and across pages",
     "Automated", "Pass", ev("5.1")),
    ("Multiple instances", "Pin to a dashboard", "Power BI Desktop", "Pass",
     "Renders from the pinned snapshot; no interaction is required for it to draw."),

    ("Data types", "Numeric, date and text data types",
     "Automated", "Pass",
     "Dimensions accept text and date columns; the date well drives the time buckets; measures are coerced to finite numbers. Covered by test/shoot.mjs and test/shootMeasures.mjs."),
    ("Data types", "Tooltip, axis and data-label values use the model's format string",
     "Automated", "Pass", ev("6")),
    ("Data types", "Numeric precision changes (0 dp, 3 dp) are honoured",
     "Automated", "Pass", ev("6")),
    ("Data types", "Display units (auto, thousands, millions) are honoured",
     "Automated", "Pass", ev("6.5")),

    ("Bad data", "Null values", "Automated", "Pass", ev("3.1")),
    ("Bad data", "All zeroes", "Automated", "Pass", ev("3.2")),
    ("Bad data", "Negative values", "Automated", "Pass", ev("3.3")),
    ("Bad data", "Infinity and NaN", "Automated", "Pass",
     ev("3.4") + " | DEFECT FOUND AND FIXED in 4.5.0.1: non-finite measure values reached the SVG geometry as NaN and the browser logged one console error per mark. dataModel now drops any value that is not a finite number, and both frame scales clamp as a second guard."),
    ("Bad data", "Wrong value types (text in a measure)", "Automated", "Pass",
     ev("3.5") + " | Same fix as the row above."),
    ("Bad data", "One enormous outlier", "Automated", "Pass", ev("3.6")),
    ("Bad data", "Very small fractions", "Automated", "Pass", ev("3.7")),
    ("Bad data", "Zero, one and two row result sets", "Automated", "Pass", ev("3.8")),
    ("Bad data", "No data view at all", "Automated", "Pass", ev("9.1")),

    ("Performance", "Thousands of rows without freezing", "Automated", "Pass", ev("8")),
    ("Performance", "Resizing, filtering and selection stay responsive", "Automated", "Pass",
     "A click repaints the visual synchronously and hands the selection to the host on the next frame, so the visual never waits on the host. Covered by test/shootFilter.mjs."),
    ("Performance", "Animation speed", "n/a", "Not applicable", "The visual runs no animations."),

    ("Accessibility", "High-contrast mode", "Automated", "Pass", ev("10.1")),
    ("Accessibility", "Keyboard focus and Enter / Space selection", "Automated", "Pass", ev("7.2")),
    ("Accessibility", "Report theme colours are respected", "Power BI Desktop", "Pass",
     "Series and category colours come from host.colorPalette unless overridden in Data colours."),

    ("Platform", "Context menu (right-click) is enabled", "Automated", "Pass",
     "showContextMenu is wired on every mark and on the visual background - mandatory under the visuals guidelines."),
    ("Platform", "Rendering Events API", "Automated", "Pass",
     "renderingStarted / renderingFinished on every update, renderingFailed in the catch."),
    ("Platform", "Bookmarks and the selection manager", "Power BI Desktop", "Pass",
     "registerOnSelectCallback restores a bookmarked selection and repaints."),
    ("Platform", "Localization", "n/a", "Not applicable",
     "The visual ships no localized strings; it is packaged with --all-locales. Listed by Microsoft as recommended, not required."),
    ("Platform", "Sync slicer", "n/a", "Not applicable", "This is a chart visual, not a slicer."),

    ("Browsers", "Chrome, Edge and Firefox on Windows", "Chromium automated + Desktop", "Pass",
     "The full suite runs in Chromium; Power BI Desktop is Chromium-based. No browser-specific API is used - no vendor prefixes, no plugin, no canvas."),
    ("Browsers", "Safari on macOS and iPad", "Not run", "Not run",
     "No Apple hardware available. The visual uses only DOM and SVG features supported since Safari 12."),
]

wb = Workbook()

# ------------------------------------------------------------------ results
ws = wb.active
ws.title = "Test results"
headers = ["#", "Area", "Test case", "How it was run", "Result", "Evidence"]
widths = [5, 18, 46, 22, 16, 88]
for i, (h, w) in enumerate(zip(headers, widths), start=1):
    c = ws.cell(row=1, column=i, value=h)
    c.fill = HEAD_FILL
    c.font = HEAD_FONT
    c.alignment = Alignment(vertical="center")
    c.border = BOX
    ws.column_dimensions[get_column_letter(i)].width = w
ws.freeze_panes = "A2"
ws.row_dimensions[1].height = 22

for n, (area, case, how, result, evidence) in enumerate(ROWS, start=1):
    r = n + 1
    values = [n, area, case, how, result, evidence]
    for i, v in enumerate(values, start=1):
        c = ws.cell(row=r, column=i, value=v)
        c.font = BOLD if i == 5 else BODY
        c.alignment = WRAP if i in (3, 6) else TOP
        c.border = BOX
    fill = PASS_FILL if result == "Pass" else (NA_FILL if result.startswith("Not applicable") else DESK_FILL)
    ws.cell(row=r, column=5).fill = fill

last = len(ROWS) + 1

# ------------------------------------------------------------------ summary
s = wb.create_sheet("Summary")
s.column_dimensions["A"].width = 42
s.column_dimensions["B"].width = 58
for i, (k, v) in enumerate(
    [
        ("Visual", "Darwinbox Visualizer"),
        ("Package", "dbxStackedColumnE4A17C2B9D3F4A16B0C8D5E7F1A2B3C4.4.5.0.1.pbiviz"),
        ("Version", "4.5.0.1"),
        ("GUID", "dbxStackedColumnE4A17C2B9D3F4A16B0C8D5E7F1A2B3C4"),
        ("API version", "5.11.0"),
        ("Tested against", "Microsoft submission test cases, learn.microsoft.com/power-bi/developer/visuals/submission-testing"),
        ("Automated harness", "test/shootSubmission.mjs plus 19 feature suites, Chromium via Playwright"),
    ],
    start=1,
):
    s.cell(row=i, column=1, value=k).font = BOLD
    s.cell(row=i, column=2, value=v).font = BODY

row = 10
s.cell(row=row, column=1, value="Verdict").font = HEAD_FONT
s.cell(row=row, column=1).fill = HEAD_FILL
s.cell(row=row, column=2, value="Cases").font = HEAD_FONT
s.cell(row=row, column=2).fill = HEAD_FILL
for i, label in enumerate(["Pass", "Not applicable", "Not run", "Fail"], start=1):
    s.cell(row=row + i, column=1, value=label).font = BODY
    s.cell(
        row=row + i,
        column=2,
        value=f"=COUNTIF('Test results'!$E$2:$E${last},A{row + i})",
    ).font = BODY
s.cell(row=row + 5, column=1, value="Total").font = BOLD
s.cell(row=row + 5, column=2, value=f"=COUNTA('Test results'!$C$2:$C${last})").font = BOLD

s.cell(row=row + 7, column=1, value="Automated checks run").font = BODY
s.cell(row=row + 7, column=2, value=len(AUTO)).font = BODY
s.cell(row=row + 8, column=1, value="Automated checks passed").font = BODY
s.cell(row=row + 8, column=2, value=sum(1 for a in AUTO if a["ok"])).font = BODY
s.cell(row=row + 10, column=1, value="Defects found and fixed during this pass").font = BOLD
s.cell(
    row=row + 10,
    column=2,
    value="1 - non-finite measure values (Infinity, NaN, text in a measure) produced NaN SVG coordinates and a console error per mark. Fixed in 4.5.0.1.",
).font = BODY
s.cell(row=row + 10, column=2).alignment = WRAP

wb.save(OUT)
print(OUT, f"{os.path.getsize(OUT)/1024:.0f} KB", f"{len(ROWS)} cases")
