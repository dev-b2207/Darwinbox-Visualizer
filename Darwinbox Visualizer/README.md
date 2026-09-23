# Darwinbox Visualizer

A Power BI custom visual that carries its own **dimension selector**, **Monthly / Quarterly / Annual switch** and **chart ↔ table toggle**. Each control changes the state of *this visual only*, so a report page no longer needs field-parameter slicers, bookmark navigators, or the layers of shapes and transparent buttons that currently sit on top of the Headcount and Attrition pages.

One visual, eleven chart types. **Format → Chart → Chart type** switches between stacked / 100% / clustered columns, the three bars, line, the two combos, ribbon and donut; the header controls, the field wells and the whole table half are identical for every one of them, so a report author learns them once.

Built for Darwinbox People Analytics. Visual GUID `dbxStackedColumnE4A17C2B9D3F4A16B0C8D5E7F1A2B3C4` — unchanged from v1, so existing report instances upgrade in place and keep rendering as stacked columns.

---

## What it replaces

Taken from `HeadcountSnapshotView_Persona.pbix`, the Summary page alone holds ~157 visual containers. A single "Headcount by <dimension>" chart today needs:

| Today | With this visual |
| --- | --- |
| `Personal Attributes` field-parameter table + slicer | fields dropped into the **Dimensions** bucket |
| `Time Slicer.Text` slicer + bookmarks per granularity | built-in **Monthly / Quarterly / Annual** switch |
| A second table visual + `bookmarkNavigator` + 2 bookmarks | built-in **chart ↔ table** toggle |
| Shape + transparent `actionButton` + image pairs for the tab strip | native buttons, fully stylable from the format pane |

Nothing in the header is a floating overlay, so moving or resizing the visual can't break the alignment of its controls.

---

## Chart types

*Format → Chart → Chart type.*

| Type | What it draws | Its own format cards |
| --- | --- | --- |
| **Stacked column** (default) | Stacked columns, one band per category, outside-end total above the bar. | Columns and bars |
| **100% stacked column** | The same, normalised to 100%; the value axis switches to a percentage. | Columns and bars |
| **Clustered column** | One column per series, side by side inside the band. | Columns and bars |
| **Bar** | Clustered and horizontal: categories down the left, values along the bottom. | Columns and bars |
| **Stacked bar** | Horizontal stack with the row total at the right-hand end. | Columns and bars |
| **100% stacked bar** | Horizontal, normalised to 100%. | Columns and bars |
| **Line** | One line per series with markers and optional area fill; straight, stepped or smooth. | Lines |
| **Area** | One line per series with the area under it filled, every series measured from zero, so overlaps show through. | Lines · Areas |
| **Stacked area** | The same bands stacked, so the top edge of the last series is the category total. | Lines · Areas |
| **100% stacked area** | Stacked and normalised per category; the value axis switches to a percentage and each band is labelled with its share. | Lines · Areas |
| **Scatter** | One point per dimension value at (**X axis**, **Y axis**), sized by **Size** when that well is mapped. Both axes numeric. | Scatter |
| **Line and clustered column** | Combo: clustered columns from **Values**, a line from **Line values** on the secondary axis. | Columns and bars · Lines · Combo line · Secondary value axis |
| **Line and stacked column** | The same with the columns stacked. | Columns and bars · Lines · Combo line · Secondary value axis |
| **Ribbon** | Stacked columns plus bands connecting each series to itself in the next category. | Columns and bars · Ribbons |
| **Donut** | A ring with leader-line labels, one slice per dimension value, and an optional total in the centre. | Donut |

Every type reads **the same field wells** — Dimensions, Date, Legend, Values, Tooltips, plus **Line values** which only the combos read and **X axis / Y axis / Size** which only the scatter reads — so switching type never asks the author to re-map anything, and a chart built as columns becomes a trend line, a bar chart or a donut in one click. Only the type-specific cards change: the pane shows the cards listed above for the active type and hides the rest, so there are no dead slices. The donut hides both axis cards too, since it has no axes.

Everything shared lives in one place: axes, gridlines, legend, data labels, plot area, colours, the roll-up rules, the header controls and the table view are common to every type.

### Adding a type later

The renderer is a registry, so a new type is one file plus one line - and a *variant* of a type that already exists is just the line:

1. `src/charts/<type>.ts` exporting `render()` - the marks only. It is handed the shared cartesian frame (`src/charts/frame.ts`: scales, ticks, both axes, a secondary axis, gridlines, legend, labels, scrolling in either direction, selection, tooltips, keyboard) and the shared mark drawing (`src/charts/marks.ts`: columns and bars in three stack modes, lines, areas, markers, label placement).
2. A `CHART_TYPES` entry in `src/charts/registry.ts` naming its label and its settings cards.

Nine of the fifteen types have no file of their own at all: the three bars are the column renderer with `orientation: "horizontal"`, the 100% and clustered variants are the same renderer with a different stack mode, the two combos differ only by `mode`, and the three area types are one `AreaSpec` each.

Two of the fifteen genuinely needed new field wells - the scatter's **X axis**, **Y axis** and **Size**. New wells are additive: an optional well sits unused by the other types, since a field well nothing is dropped into costs nothing in the query. That is the reason for one merged visual rather than one per type: `dataRoles` are static, so a separate visual per type would mean re-mapping every field each time the author changes their mind about the chart.

Waterfall and gauge / KPI (Target / Min / Max) would follow the same pattern.

---

## Field wells

| Well | Kind | Notes |
| --- | --- | --- |
| **Dimensions 2 (series)** | Grouping, up to 10 | *Optional.* The fields the second dropdown offers. Leave it empty and that dropdown falls back to the Dimensions bucket, which is what v4.0 did. |
| **Dimensions** | Grouping, up to 10 | Every field the user should be able to switch between (Department, Gender, Location, Band…). These populate the header dropdown. |
| **Date** | Grouping, 1 | A single date column. The visual derives Month / Quarter / Fiscal Year itself — no date hierarchy needed. Also appears as an option in the dimension dropdown, which is how you reproduce the "Headcount Trend" chart. |
| **Table rows** | Grouping, up to 5 | *Table view only, optional.* The field the table lists by — Employee Name in the Employee Data table. Extra levels become expandable child rows. Leave empty and the table falls back to showing the chart's data. |
| **Table columns** | Grouping, up to 20 | *Table view only, optional.* Attribute columns shown against each row: Department, Designation, Date of Joining, L1 Manager. Rendered with the model's own format string, so a long-date column reads "Tuesday, January 1, 2019". |
| **Legend** | Grouping, 1 | Splits each column into stacked segments. |
| **Values** | Measure, up to 10 | The measure(s) to plot. Shared by every chart type: with no Legend field, multiple values stack against each other as columns, or draw as one line each. |
| **Annual label** | Grouping, 1 | *Optional.* Column whose values label the axis while the Annual button is active, and define the bucket the roll-up collapses into. Mapping it also makes that button available with no Date field at all. |
| **Quarterly label** | Grouping, 1 | *Optional.* The same for Quarterly — this is where `Q1 Jan-Mar 26-27` comes from. |
| **Monthly label** | Grouping, 1 | *Optional.* The same for Monthly. |
| **Insight text** | Measure, 1 | *Optional.* A measure returning the sentence for the insight banner. Write it at total level (`REMOVEFILTERS` / `ALLSELECTED` over the axis fields). |
| **Line values** | Measure, up to 10 | *Combo types only, optional.* Measures drawn as a line over the columns, on the secondary axis, yellow by default. Ignored by every other type, and it costs nothing in the query when nothing is dropped into it. |
| **X axis (scatter)** | Measure, 1 | *Scatter only.* The measure along the horizontal axis. Ignored by every other type. |
| **Y axis (scatter)** | Measure, 1 | *Scatter only.* The measure up the vertical axis. With nothing in **Values**, this one measure is enough to build the chart. |
| **Size (scatter)** | Measure, 1 | *Scatter only, optional.* Sizes each bubble, area-proportional between *Smallest bubble* and *Largest bubble*. Leave it empty for equal-sized points. |
| **Tooltips** | Measure | Extra measures shown on hover only. Report-page tooltips (your `TT …` pages) are supported too. |

### Suggested mapping for the Headcount Snapshot page

```
Dimensions : Function Mapping.Department
             Function Mapping.Business Unit
             Employee Attributes.Location
             Employee Attributes.Gender
             Employee Attributes.Employement Type
             Employee Attributes.grade
Date       : Calendar.Date            (month-grain column recommended, see Performance)
Legend     : Employee Attributes.Gender
Values     : Calculations.Ending Headcount
Tooltips   : Calculations.Added Employees, Calculations.Exited Employees
```

To reproduce the **Employee Data** table in the same visual, add:

```
Table rows    : Employee Attributes.Employee Name (Employee ID)
Table columns : Function Mapping.Department
                Employee Attributes.Designation
                Employee Attributes.Date of Joining
                Employee Attributes.Date of Exit
                Employee Attributes.L1 Manager
```

---

## How aggregation works (read this once)

The visual receives **one** categorical query containing all Dimensions fields plus Date, then re-groups client-side. That is what makes switching instant. To keep non-additive measures honest, roll-up happens in three stages:

1. Dimensions that are **not** on the axis are collapsed with **SUM** — they partition the population, so summing is always safe.
2. Raw dates are collapsed into the selected time bucket using **Data handling → Combine values using**.
3. When a *dimension* is on the axis, time buckets are collapsed with the same setting.

Each of those three stages is a pure function of the data, not of the order Power BI
returns the rows in. That matters because the **Table rows / Table columns** wells
re-shape the query and change that order: stage 1's raw-date groups are keyed and
sorted by the raw date itself, so `First` and `Last` mean the earliest and latest
date in the period rather than whichever row happened to arrive last. `test/shootRowOrder.mjs`
holds the invariant: every roll-up must read identically across eleven different
query shapes and row orderings.

**Set the roll-up to match the measure:**

| Measure type | Setting |
| --- | --- |
| Added / Exited Employees, Promotion count, any flow measure | `Sum` |
| Ending Headcount, Starting Headcount, any point-in-time stock measure | `Last` (or `First` for Starting Headcount) |
| Average Headcount, Attrition %, ratios | `Average` — or bind a single date so no time collapse occurs |

This is the one place where the client-side approach differs from a DAX re-query, so it is exposed rather than guessed.

---

## Different fields for the chart and the table

The chart and the table can show completely different fields. Drop `Employee Name` into **Table rows** and the attribute columns into **Table columns**, and the table becomes a row-level employee list — frozen primary column, one row per employee, paginated — while the chart carries on showing Headcount by Department.

### Why they share one query

Power BI serves **one query per visual**. The docs are explicit: *"Each valid mapping produces a data view, but we currently support performing only one query per visual,"* and a Microsoft engineer confirms on the community forum that there are ["No plans to support multi-data mapping"](https://community.fabric.microsoft.com/t5/Developer/DataViewMappings-with-both-table-and-categorical/m-p/511744). A second `matrix` mapping read from `dataViews[1]` is therefore not possible.

So the Table rows / Table columns fields ride along in the chart's categorical query. That works out well:

- The **row field sets the grain** — one row per employee, times any dates. This is the only real cost: 782 rows instead of 12.
- The **Table columns fields are free**. They are attributes *of* the row field, so they add no combinations to the cross-join.
- The **chart is unaffected**. It re-groups those employee-grain rows by the selected dimension and sums, which is what it already did for every other non-axis dimension. Verified against the harness: Finance/Accounts reads 796 / 309 both with and without the detail wells mapped.

### Behaviour

| Table rows | What the table shows |
| --- | --- |
| empty | The chart's data — categories as parent rows, legend series as child rows (v1.1 behaviour). |
| one field | A flat row-level grid: primary column, attribute columns, measure columns. Matches the Employee Data table. |
| several fields | The same, nested — first field is the frozen primary column, the rest become expandable levels. |

**Measures from the Values well do not appear in the detail table.** Once Table rows is mapped, the grid is defined entirely by Table rows + Table columns — a chart measure like Ending Headcount has no meaning against a single employee row. Put a field in **Table columns** if you want it as a column. *Table Setting → Table Actions → Show measures from Values* brings them back if you ever need them. The Total strip is suppressed when nothing numeric is on show, so it can't render as an empty band; a numeric Table column is totalled from its underlying values, not its formatted text.

In the chart-derived fallback (Table rows empty) the measures **are** the columns — that mode is showing the chart's own data.

Measure columns are aggregated to the table's grain using **Data handling → Combine values using**, the same setting the chart uses, so a stock measure like Ending Headcount still needs `Last` rather than `Sum`. Attribute columns take the first non-null value per row, which is what `Min()` gives you for text in the reference visual.

Only the table wells mapped and no Dimensions? The visual renders as a plain table and hides the header controls, since there is no chart to switch to.

## Table view

The table half of this visual is a port of the existing **`tableDarwinbox`** custom visual, so it looks and behaves like the tables already in use across the Headcount and Attrition reports. It is built on Tabulator (same library, v6) and carries across:

- **Search bar** above the grid — 400 ms debounce, matches across every column, and at 3+ characters auto-expands matching branches (and their parents and children) while collapsing everything else. Below 3 characters it collapses back.
- **Frozen first column** with the selected dimension's name, plus a frozen **checkbox row header** (`Hide CheckBox` turns it off).
- **Tree rows** with the same chevron up/down controls, 20 px child indent and `parent-row` / `lastChild-row` classes.
- **Pagination footer** exactly as the reference builds it: zero-padded page buttons (`01`), `<` / `>`, the `...` overflow marker, a last-page button, an `N of M records` counter, and the custom **Rows per page** popup (10 / 20 / 50 / 100) that opens upward. The chosen page size is written back with `persistProperties`.
- **Column resize and sort persisted** into `saveState.columnMetadata`, same JSON shape (`{ columnWidth: [{id,width}], columnSort: [{column,dir}] }`), restored as `initialSort` and per-column widths on reload.
- **Cell formatting** — per-column **Bar** (in-cell progress bar scaled to the column max, grey track, 0.6-opacity fill, value right-aligned on top) and **URL** formatters.
- **Row selection** drives Power BI cross-filtering, with the reference's `#98E7E6` selected-row colour (now a format-pane option).

Row shape: the reference is a matrix, this visual is categorical, so the tree is two levels — **selected dimension → legend series**. Parent rows carry the category total per series; child rows carry one series each. With no Legend field mapped the grid is flat, as there is nothing to nest.

Two deliberate departures from the reference source:

| Reference | Here | Why |
| --- | --- | --- |
| `@fortawesome/fontawesome-free` for the search and chevron icons | inline SVG | A webfont would add ~80 KB per format to the package and needs loader config; the glyphs are identical. |
| Imports full `bootstrap` alongside `tabulator_bootstrap5` | only `tabulator_bootstrap5` | Bootstrap's global resets would restyle this visual's chart header controls. The Tabulator bootstrap5 theme is self-contained for `.tabulator*`. |

## Format pane

Every control and chart element is independently stylable — font family, size, bold/italic/underline, colours, borders, corner radius, height and padding.

**Every font control starts at Arial 14**, so a new chart matches the Darwinbox dashboards without restyling each element. Size is in points, the same unit the native visuals use. Four places ship at their own size instead, matching the charts and tables already in the reports:

| Element | Default |
| --- | --- |
| Axis values and axis titles — category, value and secondary | Arial 10, black |
| Table column header | Arial 12, `#0183FF` |
| Table row text | Arial 10, black |
| Everything else (titles, legend, data labels, controls) | Arial 14 |

- **Chart** — **Chart type**, all eleven of them. First card in the pane, since it decides which type-specific cards appear below.
- **Header controls** — show/hide, top or bottom, alignment, spacing, background, border.
- **Header layout** — which control sits in each of the three slots, and the four pieces of text around them, with their own font and colour.
- **Top N** — show/hide, default N, Top or Bottom, whether it applies in table view, whether the box shows there, plus box width, height, font, colours and border.
- **Dimension 2 (series)** — show/hide, whether to offer a *(None)* option and what to call it, show in table view. Styling comes from the Dimension selector card.
- **Insight banner** — show/hide, static text (with the fx button), icon on/off + colour + size, both gradient stops, text font and colour, corner radius, padding, space above, whether the view toggle rides on this row, show in table view.
- **Dimension selector** — dropdown (bordered box + radio list) or pills, prefix label text ("Overall Attrition % by"), `Show in table view` (off by default), list max height, list background / hover / selected-radio colours, full typography.
- **Time granularity switch** — `Position` (its own row below, or the same row as the dimension selector), alignment, space above, minimum segment width, segmented / pills / dropdown, which of the three options to show, custom labels, selected vs unselected colours, `Show in table view` (off by default).
- **Chart / table toggle** — icons (ascending bars / grid) or text, sizes, selected colours, plus the shared rounded **Group background**, corner radius and padding that hold the two buttons.
- **Time axis** — fiscal year start month, and label formats (`2024-2025`, `2024-25`, `FY25`, `Q1 2025`, `Jan 25`, …).
- **Data handling** — roll-up method, sort by value / category / model order, direction, blank handling, max categories.
- **Columns and bars** *(every column, bar, ribbon and combo type)* — **Column width** (Auto or Fixed), **Bar width**, **Space between columns**, **Space within a cluster**, **Min column width before scrolling**, max width, **Max category label width** (the bar types' left gutter), corner radius, segment gaps, borders.
- **Lines** *(Line and the combos)* — line width, line style (solid / dashed / dotted), **Line shape** (straight / smooth / stepped), markers on/off with shape (diamond / circle / square / triangle) and size, **Join across gaps**, **Fill area below line** with transparency, and **Point spacing** (Auto-then-scroll or Fixed) with min spacing before scrolling.
- **Combo line** *(the two combos)* — **Plot the line on a secondary axis** (on by default), **Draw as** (line with markers, or **markers only** — a diamond centred on each category band, as in the Ending Headcount by Tenure chart), and the rounded **badge behind the line labels** with its own fill, text colour and corner radius. The grey badge with white text matches the Leave % reference; for the paler tenure-chart look set the badge to `#DCE9F7` with `#1B3A93` text.
- **Ribbons** *(Ribbon)* — ribbon transparency, border width and colour, and **Largest series on top**, the per-category re-ordering that makes a ribbon chart readable.
- **Donut** *(Donut)* — *Shape* (inner radius, slice border, start angle) · *Centre total* (**Show total in centre**, an optional caption under it, font, colour, display units, decimals) · *Slice labels* (content: value / share / value and share / category / combinations, inside or outside the ring, leader lines and their colour, and a **Hide labels below x%** threshold).
- **Colours** — per-series colour picker; for the donut it becomes one picker per slice.
- **Legend** — position (**top left by default**, matching the reference charts), alignment, marker shape (including the reference diamond) and size, title, typography.
- **Data labels** — position (**Auto** places each label clear of its own line; **Outside end** puts the column total above the bar, as in the reference chart; plus above / below / left / right and inside center / end / base), auto-contrast, display units, precision, overlap handling, plus separate total labels with their own font and background.
- **Category axis / Value axis** — values, title, axis line, gridlines (colour, width, solid/dashed/dotted), rotation, start/end, display units, precision, max gridlines. Named for what they carry rather than X and Y, because on a bar chart the category axis is the vertical one: the same two cards drive both orientations.
- **Secondary value axis** *(the two combos)* — show/hide, start/end, font, colour, display units, decimals, title. Its interval count is copied from the primary axis so the two scales share gridlines.
- **Plot area** — background, border, corner radius, padding.

Table-view cards use the same names, groups and defaults as `tableDarwinbox`, so report authors find them where they expect:

- **Search Bar Setting** — show, placeholder, width, font, text colour, background, border colour.
- **Column Setting** — font, text colour, background, text alignment, border colour (the 2.5 px header underline, default `#67B5FF`).
- **Row Setting** — *Row* (row height, default 38) · *Style* (font, text colour, background, selected-row colour, banded rows, alternate colour, alignment) · *Values* (display units, decimals).
- **Table Setting** — *Header* (Show Title, Title text, font, colour — the "Employee Data" heading shown at the top-left of table view; leave the text blank and it falls back to the Table rows field name) · *Table Actions* (**Hide CheckBox, on by default**, Show Pagination, Page Size, Start Expanded, Show measures from Values, Filter rows by the chart selection, Show export button) · *Totals* (total row, total column, total label).
- **Cell Formatting** — **off by default.** Switched on, it gives each value column a **Bar** toggle (numeric columns: an in-cell progress bar scaled to the column maximum, drawn in the bar colour, default `#0183FF`) or a **URL** toggle (text columns: render the value as a link). Off means no bars and no links regardless of what the per-column values still hold.

  The pane selector for these toggles is the column's `queryName`, so columns that share one measure — a legend split, or a Dimension 2 split — are **one** setting and get **one** group. Emitting a group per column produced a stack of identical cards all driving the same property; they are deduplicated now.

The visual honours the report theme, Power BI's high-contrast mode, and the "Edit interactions" setting.

---

## The header sentence: Top N, Dimension 1, Dimension 2

*Format — Header layout.*

The header reads as a sentence made of up to three controls with free text around them:

```
[Text before]  [slot 1]  [Text after the first]  [slot 2]  [Text after the second]  [slot 3]  [Text after the last]
```

Each slot holds **the Top N box**, **Dimension 1** (the axis) or **Dimension 2** (the series), in any order, so both reference headers come out of the same three slots:

| Wanted | Slots | Text |
| --- | --- | --- |
| `Top [10] [Department] by attrition %` | Top N box, Dimension 1 | before: "Top" — after the last: "by attrition %" |
| `Attrition % variation by [Gender] across [Department]` | Dimension 2, Dimension 1 | before: "Attrition % variation by" — after the first: "across" |

Rules that keep it readable:

- A slot set to *(nothing)*, or whose control is switched off or hidden in this view, is skipped **together with its text** — turning Top N off never leaves a dangling "by attrition %". With no control on screen at all — table view, where all three are hidden by default — the whole sentence goes with them.
- The text that follows the **last** control on screen is always *Text after the last*, whichever slot it came from, so the sentence still ends properly when a control is hidden.
- Naming the same control in two slots draws it once, in the first.
- Leaving *Text before the first* empty falls back to the Dimension selector's own **Prefix label**, so reports built before v4 keep their "Headcount by" with nothing to re-enter.

### Top N

An editable number box, not a format-pane setting: the report *reader* types into it, and the value persists with the report the way the dimension and the granularity do. `Default N` seeds it.

Top N runs **after** the sort, so "top" means whichever end *Data handling — Sort by* and *Direction* put first — by default the largest measure value. `Keep` switches to Bottom N. It is a deliberate trim, so unlike the Max-categories safety cap it raises no "showing the first N of M" banner. *Apply in table view too* is on by default; turn it off to let the table list every category while the chart shows only the leading N.

### Dimension 2 (the series)

The second dropdown chooses **which field splits the chart into series** — the runtime equivalent of the Legend well, fed by the same Dimensions bucket. Pick Location and every column becomes one column per location; pick *(None)* and the chart falls back to the mapped Legend field.

- It offers whatever is in the **Dimensions 2** well; with that well empty it offers the Dimensions bucket instead.
- Both dropdowns take their styling from the **Dimension selector** card, so they match without configuring twice.
- **The two lists are mutually exclusive.** Whatever Dimension 1 is showing disappears from Dimension 2's list and vice versa, so the axis and the series can never be the same field. Picking a new axis field that is currently the series clears the series back to *(None)*.
- With Dimension 2 active it is the series split and a mapped **Legend** field steps aside; the first **Values** measure is the one split (a legend splits one measure — the same rule the native charts follow).
- Choosing the **Date** field splits by time bucket, so the series read "2024-2025" rather than raw date values.
- A **Line values** measure stays a single line across all of the series, which is what keeps a combo readable.

---

## Time granularity: one field per button

*Annual label / Quarterly label / Monthly label field wells.*

The three buttons no longer depend on the Date field alone. Map a column into a button's label well and that column takes over two jobs while the button is active:

1. **It labels the axis** — `Q1 Jan-Mar 26-27` from your own column instead of the `Q1 26` the visual would derive.
2. **It defines the time bucket** the roll-up collapses into, so the measure is aggregated to exactly the periods those labels describe.

| Mapped | What the buttons do |
| --- | --- |
| Date only | All three buttons, buckets derived as before (v3 behaviour, unchanged). |
| Date + some label columns | All three buttons; a button with a label column uses it, the others derive. |
| Label columns only, no Date | Only the buttons whose label column is mapped. The dimension dropdown gains one time entry that follows the active button. |
| Neither | No granularity switch, as before. |

Order is chronological wherever it can be: with a Date field mapped alongside, each label is sorted by the earliest date it covers, so `Q1 Jan-Mar 26-27` lands before `Q2 Apr-Jun 26-27` however the labels happen to sort alphabetically. With no Date field they keep the order the query returns.

A granularity the data can no longer serve — a saved report set to Quarterly, then the Quarterly label unmapped — falls back to the first available button rather than rendering empty.

---

## Insight banner

*Format — Insight banner.* The gradient strip from the reference screens: the atom marker, the sentence, and the chart/table toggle inline at its right-hand end.

The text is dynamic. There are two ways in, and the banner renders whichever it finds first:

1. **The `Insight text` measure well** — the tested route. Drop in a measure returning the sentence and it re-reads whenever the data or a cross-filter changes.
2. **The `Text` property on the card**, which also carries the fx (conditional formatting) button, so it can be bound to a field the way the native tooltip-text property is.

One constraint on the measure: a measure in a categorical query is evaluated **per row**, so write the insight at total level — `REMOVEFILTERS` / `ALLSELECTED` over the axis fields — and every row then carries the same sentence, which is the one shown. A measure left in row context would show the first category's version of it.

Everything about the strip is stylable: icon on/off, colour and size, both gradient stops, text font and colour, corner radius, padding, the space above it, and whether it appears in table view. *Keep the view toggle on this row* (on by default) is what puts the chart/table icons inline with the banner as in the reference; switch it off and they stay up on the first row.

---

## Header layout and column scrolling

**Header rows.** Row one holds the prefix label, the dimension dropdown and the chart/table icons. The Monthly/Quarterly/Annual switch sits on **its own row below**, left-aligned, by default — set *Time granularity switch → Position* to "Same row as the dimension selector" to put it back inline.

**Table view.** The dimension selector and the granularity switch are hidden in table view, leaving the table heading on the left and the chart/table icons on the right. Each control has a `Show in table view` toggle if you want it back.

**Fields in more than one well.** A field dropped into both **Dimensions** and **Table columns** is projected into the query once per well, and Power BI puts *both* roles on every copy. Walking those copies naively listed the field once per projection — "Group Company, Department, Group Company, Department" in the dropdown, with two options sharing one key. Options and table columns are therefore keyed by `queryName`, which collapses the copies. Table columns are keyed by `queryName` too rather than display name, so two genuinely different fields that happen to share a name (Department from two tables) stay separate columns.

**The dimension dropdown** is a custom control, not a native `<select>`: a bordered box with a chevron that flips up when open, and a radio-button list that overlays the chart. It closes on selection, on outside click and on Escape; arrow keys move between options.

**Column width and scrolling.** Under *Columns* (stacked column) or *Lines* (line):

| Setting | Effect |
| --- | --- |
| `Column width` = **Auto** | Bars shrink to fit the visual, but never below `Min column width before scrolling` (default 14 px). Past that the plot scrolls. |
| `Column width` = **Fixed** | Bars always render at `Bar width` (default 28 px) and the plot scrolls as soon as the categories no longer fit. |
| `Point spacing` = **Auto** | Points compress to fit, but never below `Min spacing before scrolling` (default 40 px). Past that the plot scrolls. |
| `Point spacing` = **Fixed** | Points sit `Spacing between points` apart (default 90 px) and the plot scrolls once they no longer fit. |

When the plot scrolls, the value axis stays pinned, the category axis title stays centred below the scrollbar, and category labels flip to vertical so they are never clipped at the left edge. The scrollbar is drawn by the visual rather than left to the browser, because Chromium's overlay scrollbars take no layout space and ignore CSS styling — this way it looks the same in Power BI Desktop, the service and in tests.

**Bar charts scroll the other way.** The three horizontal types put the categories down the left and the values along the bottom, so too many rows scrolls *vertically*, with its own drawn scrollbar on the right, the value axis pinned below and the rotated category-axis title pinned to the left. Row height obeys the same `Column width` / `Bar width` / `Min column width before scrolling` settings — they measure across the band either way. Category labels are truncated to **Max category label width** (default 160 px) with the full text on hover.

## Areas and the scatter

**The three area types are the line chart with a fill**, so the frame, the markers,
the labels, the tooltips, the curve setting (straight / stepped / smooth), the point
spacing and the selection behaviour are the line chart's - and the **Lines** card
drives all of them. What is added is the baseline each fill sits on:

- **Area** measures every series from zero and draws the fills transparent, so a
  series behind a taller one still reads. This is Power BI's plain area chart.
- **Stacked area** puts each series on the running total of the ones below it, in the
  same series order the stacked column uses, so switching between the two keeps the
  same series at the bottom.
- **100% stacked area** normalises that per category, on a 0-100% value axis.

In both stacked modes the band is drawn at the running total but its **label and its
tooltip read that series' own value** - the band's thickness is the value - and the
label sits centred inside its own band, dropping out when the band is too thin to hold
it. *Areas → Fill transparency* has one figure for the stacked pair (20% by default,
near-solid) and one for the overlapping type (65%, see-through), because the two shapes
of chart want opposite things and neither should move when you change the other.

**The scatter is the one type that does not use the shared frame.** Every other chart
has a band scale on one axis - one evenly spaced slot per category - and the frame is
built around measuring label room per band, wrapping or rotating those labels and
scrolling when the bands get narrow. A scatter has two numeric axes and no bands, so it
draws its own pair rather than bending a band scale into a continuous one. It still
shares the legend, the plot-area padding, the tick maths, the colours, the data labels
and the whole tooltip / selection / cross-filter path, so it behaves like the others.

- **One point per dimension value**, which is the analogue of Power BI's Details well:
  a Department scatter gives one point per department, and the header dropdown switches
  it to Group Company or Location without a re-query.
- A **Legend** field splits each category into one point per series. Without one, every
  point is a single colour, as in Power BI; *Scatter → Colour points by category* gives
  each category its own colour from the **Data colours** card instead, which is what you
  want when the points *are* the categories.
- **Both axes auto-scale to the data** rather than starting at zero - two measures
  rarely both reach it - with *X axis includes zero* / *Y axis includes zero* to force it.
  The Y axis reads Start / End / Display units / Decimals / Max gridlines from the
  **Value axis** card; the X axis has the same set of its own on the **Scatter** card.
- Point labels are the **category name**, not the value: the axes already say the value.
  A label is placed above its point, flips below when that would clip, and is dropped
  when it would land on one already drawn.
- **Size** sizes bubbles by area, not by radius, so a value twice as large draws a
  bubble of twice the area. The biggest bubbles are drawn first so a small point is
  never buried under a large one.

One thing to know about a scatter of two measures: both go through the same three-stage
roll-up as any other mark (see *How aggregation works*), so a **ratio** - Attrition %,
conversion % - must be aggregated in DAX rather than left to *Combine values using*,
or it will be summed across the locations and dates a department spans. That is the
same caveat that already applies to a ratio on a column chart, and *Combine values
using → Average* is the quick fix.

---

## Interactivity

- Click a segment to cross-filter; Ctrl/Cmd/Shift-click to multi-select; click empty plot space to clear.
- The click repaints this visual first and tells Power BI afterwards, so the chart, the header and the view toggle all stay usable while the rest of the page catches up.
- Incoming highlights from other visuals render as a dimmed base plus a solid highlighted portion.
- Legend items are clickable and keyboard operable.
- Right-click opens the Power BI context menu (drill-through, include/exclude).
- Every column is focusable via keyboard; Enter/Space selects, and focus shows a tooltip.
- Selected dimension, granularity and view mode persist with the report, so a saved bookmark or a reopened report comes back in the same state.

---

## Performance and limits

The single cross-joined query is the trade-off for instant switching.

- Power BI returns only the combinations that actually exist, not a full cross product, but cardinality still multiplies. Keep the **Dimensions** bucket to roughly 6 fields.
- **Table rows** sets the query grain for the whole visual, chart included. A field with employee-level cardinality is fine (that is what the existing Employee Data table already queries); a field with millions of distinct values is not.
- Map a **month-grain** date column (or a date table filtered to month starts) rather than a raw daily date — a daily date multiplies row count by ~30 for no visual benefit.
- Data is fetched in 30,000-row windows, up to 20 segments.
- **Data handling → Max categories shown** caps the rendered category count (default 200). When it bites, the visual says so in a banner rather than silently truncating.
- Below ~14 px per column the plot scrolls horizontally with the Y axis pinned, matching the native column chart.

### Why clicking a bar used to stall the report, and what changed

A native chart runs a query grouped exactly at axis + legend grain, so one mark is one
row of its result. Clicking it hands Power BI a single identity, the host turns that
into one condition, and every other visual re-queries at once.

This visual cannot work that way. It runs **one** query for the chart half and the table
half together, so with Employee Name in **Table rows** the query grain is the employee
and a single bar is an aggregate of hundreds or thousands of source rows. Worse,
`withCategory` scopes on the *whole* row - every category column at once - so a bar's
identity list is one entry per employee behind it. Handing the host 300 identities makes
it build a 300-way filter for every other visual on the page. That is the stall.

*Data handling → Cross-filtering* picks how a click is expressed:

| | What the host is told | Speed | Other visuals |
|---|---|---|---|
| **Fast (filter other visuals)** – default | `Department = "Engineering" AND Employment Type = "Permanent"` – one condition per coordinate | Native | Filtered: their bars shrink |
| **Highlight (slower)** | one selection identity per source row behind the mark | Slow at detail grain | Highlighted: a shaded portion of the full bar, the native look |

Fast falls back to Highlight on its own, per click, whenever the mark cannot be written
as a filter: a model measure or an unnamed projection on the axis, a blank category,
several date buckets picked at once (a range filter has only two conditions), or a whole
category / donut slice that spans every series. A table-row click always uses identities,
which is cheap - a row is one employee.

Two details worth knowing:

- **The chart keeps all of its bars.** A filter raised by a visual filters the other
  visuals and not the one that raised it - that is what lets a slicer keep showing every
  option after you pick one. The visual checks rather than trusts: if the fetch that
  follows its own filter comes back smaller than the one before it, it drops the filter,
  reverts to identities for the rest of the session, and you see at worst one flicker.
- **A fast-path filter persists like any report filter.** Click empty plot space to lift
  it, the same gesture that clears a selection.

The header, the granularity buttons and the chart/table toggle no longer wait on any of
this. A click updates this visual synchronously and only then hands the selection to
Power BI, so switching to table view right after clicking a column works immediately.

---

## Install

1. Power BI Desktop → **Insert → More visuals → Import a visual from a file**.
2. Choose `dist/dbxStackedColumnE4A17C2B9D3F4A16B0C8D5E7F1A2B3C4.4.5.0.1.pbiviz`.

Importing v4 over an existing instance upgrades it in place — same GUID, same field wells, same saved state. Existing charts keep the **Stacked column** type, which is the default, and a v2 chart whose *Stack type* was set to 100% keeps rendering as 100% stacked (that slice is now a chart type of its own, and the old value is still honoured).

For org-wide rollout, upload the same file to the **Organizational visuals** section of the Fabric admin portal.

## Develop

`powerbi-visuals-tools` is installed **globally**, not as a devDependency:

```bash
npm i -g powerbi-visuals-tools@7.2.1
```

That is how Microsoft documents it, and it is also what keeps `npm audit` at zero -
the tool depends on `webpack-dev-server`, which carries moderate and high advisories,
and certification fails on any advisory at that level. Playwright, which only the
test harness needs, is out of `package.json` for the same reason; install it with
`npm i playwright --no-save` when you want to run the suites.

```bash
npm install
npm run package                    # pbiviz package --all-locales -> dist/*.pbiviz
npm run eslint                     # the rule set certification runs
npm run typecheck
npx pbiviz start --all-locales     # dev server, then enable Developer Visual in Power BI
npx pbiviz package --all-locales --certification-audit   # must report no external requests
node test/shoot.mjs                # headless render check, chart view -> shots/*.png
node test/shootTable.mjs           # headless render check, table view -> shots/*.png
node test/shootDetail.mjs          # headless render check, detail table -> shots/*.png
node test/shootImages.mjs          # headless render check, header + scrolling -> shots/*.png
node test/shootFixes.mjs           # headless render check, duplicate fields + icons
node test/shootMeasures.mjs        # headless render check, detail-table columns
node test/shootLine.mjs            # headless render check, line chart -> shots/*.png
node test/shootBoth.mjs            # two chart types + table view from one visual
node test/shootTypes.mjs           # all eleven types -> shots/41..53-*.png
node test/shootDefaults.mjs        # the shipped defaults, with no overrides set
node test/shootHeader.mjs          # header slots, Top N, dimension 2, insight, labels
node test/shootV4.mjs              # format pane builds, Top N trims, dimension 2 persists
node test/shootFixes2.mjs          # table-view text, tooltip move, cell formatting, dim 2 well
node test/shootRowOrder.mjs        # every roll-up is row-order and grain invariant
node test/shootFixes3.mjs          # bucket sort, toggle position, table filter, spinner
node test/shootCounts.mjs          # the bar and the table agree, and export matches
node test/shootAreaScatter.mjs     # the three area types and the scatter
node test/shootFilter.mjs          # cross-filter path: paint first, filter not identities
node test/shootSubmission.mjs      # Microsoft's submission test cases, 67 checks
```

### Listing assets

```bash
node test/capture-appsource.mjs    # render the plates -> appsource-plates/
python3 compose-screenshots.py     # 1366x768 screenshots -> appsource/screenshots/
python3 make-logo.py               # 300x300 listing logo
python3 make-sample-data.py        # sample dataset + Power Query for the sample .pbix
python3 make-test-results.py       # the test-results workbook from the harness output
```

`--all-locales` is required with `powerbi-visuals-tools@7.2.1`: its localization loader `eval`s an ESM file shipped by `powerbi-visuals-utils-formattingutils@7`, which throws without the flag.

### Source layout

```
capabilities.json   data roles, dataview mapping, format objects
src/settings.ts     format-pane model (cards, groups, slices)
src/dataModel.ts    dataview -> chart model, time bucketing, staged roll-up
src/controls.ts     header strip (dropdown, granularity switch, view toggle)
src/chart.ts        dispatcher - picks the renderer for the selected chart type
src/charts/frame.ts shared frame, both orientations: scales, ticks, primary and
                    secondary axes, gridlines, legend, labels, scrolling,
                    selection, tooltips, keyboard
src/charts/marks.ts shared marks: columns and bars (stacked / 100% / clustered,
                    either orientation), lines, areas, markers, label placement
src/charts/column.ts the column and bar family - six types, one renderer
src/charts/line.ts   line chart wiring
src/charts/combo.ts  columns plus a Line values line on the secondary axis
src/charts/ribbon.ts stacked columns plus the connecting bands
src/charts/donut.ts  the one non-cartesian type: arcs, leader lines, centre total
src/charts/registry.ts one entry per chart type -> label, renderer, format cards
src/table.ts        table view - Tabulator grid ported from tableDarwinbox
src/detailTable.ts  Table rows / Table columns model for the row-level grid
src/visual.ts       lifecycle, state persistence, selection, tooltips
test/harness.html   Power BI host stub + synthetic Headcount dataview
test/shoot.mjs      Playwright screenshot / assertion run - chart view
test/shootTable.mjs Playwright run - table view: tree, search, pagination, bars
test/shootDetail.mjs Playwright run - detail table driven by Table rows / columns
test/shootImages.mjs Playwright run - header layout, radio dropdown, bar width, scrolling
test/shootFixes.mjs  Playwright run - duplicate-role fields, toggle icons, table heading
test/shootMeasures.mjs Playwright run - Values measures excluded from the detail table
test/shootLine.mjs   Playwright run - line chart against both reference layouts
test/shootBoth.mjs   Playwright run - two types + table view from the merged visual
test/shootTypes.mjs  Playwright run - every registered chart type, incl. bar
                     scrolling and the donut centre total
test/shootDefaults.mjs Playwright run - axis and table defaults with nothing set
test/shootHeader.mjs Playwright run - one case per v4 reference screenshot
test/shootV4.mjs     Playwright run - pane builds, Top N trims, dimension 2 persists
test/shootFixes2.mjs Playwright run - the four v4.1 fixes
test/shootRowOrder.mjs Playwright run - roll-ups must not follow the row order
test/shootFixes3.mjs Playwright run - bucket sort, toggle position, table filter, spinner
test/shootCounts.mjs Playwright run - mark rows, table count, CSV export
```

---

## What a mark is made of

A bar is not "every row the query paired with that category" - it is the rows the
roll-up actually read, and only the ones that put something into it. Two rules follow
from that, and they are what makes the table agree with the chart:

- **Only the slots the roll-up reads.** `Sum` and `Average` are made of every date in
  the period; `First`, `Last`, `Min` and `Max` are made of exactly one. A `Last`
  chart of Ending Headcount showing 222 people at the latest date is made of those
  222 rows, not of the 297 people who appeared at some point in the period.
- **A zero is not a contribution.** A point-in-time measure returns 1 for the people
  active at a date and 0 for everyone else, and those zeros are rows in the query.
  They add nothing to the bar, so they are not rows behind it.

Two row sets are therefore kept per mark, deliberately:

| | What it is | What it drives |
| --- | --- | --- |
| identities | every row of the cell | the host's cross-filter, so clicking a bar filters the report to that category the way a native chart does |
| mark rows | the rows the roll-up read, zeros excluded | the table half, so the grid lists what the number is made of |

### Exporting

Power BI's own **Export data** returns the *query* behind the visual, not the grid:
every date for every row, zeros included, and no notion of a chart selection. A custom
visual cannot change that - the query is what the host exports. The table therefore
carries its own **Export** button (*Table Setting → Table Actions → Show export
button*), which writes exactly the rows on screen, in the columns on screen, honouring
the chart selection. It needs the host's `ExportContent` privilege; where a tenant has
not granted it, the button is not drawn.

---

## Bucket axes, selection and the table

**Sorting bucket labels.** *Data handling → Sort labels by the numbers in them*, on
by default, applies when *Sort by* is **Category**. Digit runs in a label compare as
numbers and everything else as text, so age buckets (`18-25`, `25-40`, `40+`) and
tenure buckets (`0-1`, `1-2`, `2-5`, `5-10`, `10-20`, `30+`) land in their real order
instead of the text order that puts `10-20` before `2-5`. Labels with no digits in
them compare exactly as before, which is why this is safe to leave on; switch it off
for a strict A-Z axis.

**A chart selection filters the table.** *Table Setting → Table Actions → Filter rows
by the chart selection*, on by default. Click a column, switch to table view, and the
grid shows the rows behind that column.

The two halves cannot be matched on selection identities: a mark's identity carries
the series scope and a table row's does not, so the two lists never compare equal even
though both were built from the same query rows. Each half therefore carries the
source rows it was built from, and the filter is their intersection - which also means
it stays exact even when the identity cap below has trimmed what the host was told.
A selection made by clicking a *row* does not filter the grid, or clicking a row would
collapse the grid to that row alone. A selection that matches nothing in the grid
leaves it as it was rather than emptying it.

**Identity cap.** On the Highlight path each mark carries one selection identity per
source row behind it. At detail grain - Table rows mapped to Employee Name - that can
be thousands. Identities are de-duplicated by key, and *Data handling → Max identities
per selection* (default 1000) bounds what is left. The table-side filter is unaffected,
since it works on rows rather than identities. The fast path below sends no identities
at all, so the cap does not apply to it.

**The header reads as one phrase.** The controls in the header stay packed together;
the alignment setting positions that whole group, and "Space between" describes the gap
between the group and the view toggle. It briefly meant space *inside* the group, which
pushed "Headcount by" and its dropdown to opposite ends of the header.

**The view toggle's position.** The toggle sits at the end of the header row, whatever
the header alignment is set to and whether or not anything else is in the row - with no
dimension mapped it used to follow an empty cluster wherever the alignment put it. The
alignment setting now positions the header's own contents. When the insight banner is
showing, *Insight banner → Keep the view toggle on this row* (on by default) moves the
toggle onto that row instead.

**Before any data arrives** the visual shows a spinner. It used to print a page
explaining every field well, which on a report page full of these read as an error.

---

## Certification

The package is built to pass Microsoft's certification review, and four things in the
source exist only because of it:

- **No `fetch` in the bundle.** `pbiviz package --certification-audit` counts external
  requests in the *compiled output*, not in your code. `TabulatorFull` bundles an Ajax
  module and a remote list-editor, and both call `fetch` - unreachable here, since the
  grid is handed its rows directly and has no editable cells, but present, and the
  audit failed on them. `src/table.ts` now registers the fourteen Tabulator modules the
  grid uses instead of taking the full build. It also leaves out Persistence, which
  writes to `localStorage`. The bundle got 122 KB smaller.
- **No HTML built from data.** A Tabulator formatter that returns a string has that
  string written in with `innerHTML`. The in-cell bar formatter used to return markup
  wrapped around a formatted cell value; it builds DOM nodes now. The link formatter
  already did, with a scheme allow-list so a `javascript:` value can never reach an
  `href`.
- **Non-finite values never reach the DOM.** Infinity, NaN, or a text column dropped
  into Values used to produce `NaN` SVG coordinates and one browser console error per
  mark. `dataModel` drops anything that is not a finite number - which is what a native
  chart does with it - and both frame scales clamp as a second guard. A console error
  on any input data is an automatic certification failure.
- **`npm audit` is clean**, because the build tool is a global install rather than a
  devDependency. See *Develop* above.

The one privilege declared is `ExportContent`, for the table's CSV export through the
host download service. `WebAccess` - the privilege certification forbids - is not
declared, and the visual makes no network call of any kind.

---

## New in v4.5

**Four more chart types**: Area, Stacked area, 100% stacked area and Scatter, bringing
the list to fifteen. Three new field wells - **X axis**, **Y axis**, **Size** - which
only the scatter reads, and two new format cards, **Areas** and **Scatter**, which only
show for the types that use them. See *Chart types* and *Areas and the scatter* above.

Nothing about the existing eleven types changed: same defaults, same cards, same field
wells, same behaviour. The area types reuse the line renderer and the scatter's measures
ride through the same three-stage roll-up as every other mark, so there is no second
aggregation path that could disagree with the first.

---

## Fixed after v4.5.0.0

**A measure that is not a finite number no longer breaks the render.** `DIVIDE` without
a guard returns Infinity, a broken measure returns NaN, and a text column dropped into
Values is a string - and each of them, summed and run through a scale, became `NaN` in
an SVG coordinate, which the browser rejects with a console error per mark. Found by the
bad-data cases in `test/shootSubmission.mjs`. Such values are now treated as missing.

**Scatter axis labels no longer repeat.** Both scatter axes auto-range off the data
rather than anchoring at zero, so the gap between ticks is often less than 1 - and
whole-number formatting printed "29, 29, 30, 30". The decimals now follow the tick step,
but never fall below what the format pane asks for.

---

## Fixed after v4.3

**The yellow "max identities per selection" banner is gone.** It reported an internal
cap on a mechanism that the default path no longer uses.

**Clicking a mark no longer freezes the report.** Two causes, both fixed: the visual
waited on `selectionManager.select()` before repainting itself, so nothing on screen
moved until Power BI had pushed the selection through every other visual's query; and
the selection it pushed was one identity per source row behind the mark. The repaint now
happens first and the cross-filter is expressed as a report filter naming the mark's
coordinates. See *Performance and limits* above.

---

## Fixed after v4.1

**Table rows / Table columns changed the chart.** With a Date field mapped, adding a
field to either table well moved the chart's numbers. Cause: stage 1 groups the rows
of a time bucket by raw date, and every one of those groups was stamped with the
*bucket's* sort key rather than its own date. All the keys being equal, `First` and
`Last` fell through to insertion order - the order the rows arrived in - and the table
wells change that order, because they change the shape of the query. Raw-date groups
now carry the raw date's own key, which also makes `Last` actually mean the latest
date in the period. The same key now orders the tooltip measures, which collapse the
same way.

The one thing no code can undo: **Table rows sets the query grain for the whole
visual**, so a measure that is not additive over that grain (a ratio, or a
department-level measure that returns the same value on every employee row) will read
differently once the grain is employee-level, because the numbers the visual is handed
are different. Additive measures - counts, headcounts, sums - are unaffected: summing
over employees and summing over locations give the same total. For a ratio, aggregate
it in DAX rather than leaving it to the client-side roll-up.

Dimension 2's series are also sorted by label now, rather than in discovery order, so
the legend order, the stacking order and the colours no longer shift when an unrelated
field joins the query.

---

## Fixed after v4.0

- Header slot text no longer follows the controls into table view.
- The tooltip no longer blanks on the first mouse move: `move()` re-sends the items it is showing, where it used to hand the host an empty `dataItems` array (which is a request to replace the contents with nothing).
- Cell Formatting no longer repeats one column as several identical groups.

---

## Not in v4

Deliberately out of scope for now, easy to add next:

- More chart types — area, waterfall, scatter, gauge / KPI (see *Adding a type later*).
- A fourth header slot, or more than one Top N box.
- An "Others" bucket for what Top N trims away.
- Ribbon and donut in the horizontal / scrolling variants the cartesian types have (a ribbon is vertical by definition; a donut has nothing to scroll).
- The native charts' zoom sliders. The visual scrolls instead, with its own drawn scrollbar.
- Top N + "Others" bucketing (the 221-department chart currently relies on sort + max categories).
- Small multiples.
- Drill-down through a dimension hierarchy (the dropdown is a flat switch, not a drill path).
- Localisation of the built-in control labels — the label text is editable in the format pane instead.
