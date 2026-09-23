/*
 *  Data transform layer.
 *
 *  Power BI hands us one categorical dataview containing every field dropped into
 *  the Dimensions bucket plus the Date field, cross-joined at their combined grain.
 *  The visual then re-groups that single result set client-side, so switching the
 *  dimension dropdown or the Monthly/Quarterly/Annual switch needs no re-query and
 *  no bookmark.
 *
 *  Aggregation is deliberately staged so a non-additive measure (Ending Headcount,
 *  a DISTINCTCOUNT, a ratio) is not silently summed across time:
 *
 *    stage 1  collapse the dimensions that are NOT on the axis     -> always SUM
 *             (they partition the population, so summing is safe)
 *    stage 2  collapse raw dates into the selected time bucket     -> user rollup
 *    stage 3  collapse time buckets when a dimension is on the axis-> user rollup
 */
import powerbi from "powerbi-visuals-api";

import DataView = powerbi.DataView;
import DataViewCategoryColumn = powerbi.DataViewCategoryColumn;
import DataViewValueColumn = powerbi.DataViewValueColumn;
import DataViewMetadataColumn = powerbi.DataViewMetadataColumn;
import ISelectionId = powerbi.visuals.ISelectionId;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;

export type Granularity = "monthly" | "quarterly" | "annual";
export type ViewMode = "chart" | "table";
export type Rollup = "sum" | "avg" | "min" | "max" | "first" | "last";

export interface AxisFieldOption {
    /** stable key persisted in the visual state */
    key: string;
    label: string;
    /** index into dataView.categorical.categories, or -1 for the date field */
    categoryIndex: number;
    isDate: boolean;
}

export interface SeriesInfo {
    key: string;
    label: string;
    index: number;
    color: string;
    /** identity of the legend group (undefined when series come from measures) */
    identity?: powerbi.visuals.CustomVisualOpaqueIdentity;
    /**
     * The legend column's own value for this series, kept raw. The label is a
     * formatted string and blanks are relabelled, neither of which a report
     * filter can match on; this is what the fast cross-filter path filters by.
     */
    rawValue?: powerbi.PrimitiveValue;
    selectionId?: ISelectionId;
    queryName?: string;
    /** came from the Line values well - drawn as a line by the combo types */
    isLine?: boolean;
    /** this series' own format string (a combo line is often a % against counts) */
    format?: string;
    /** came from the Dimension 2 dropdown: the value of that field this series is */
    d2Key?: string;
}

export interface CellDatum {
    categoryIndex: number;
    seriesIndex: number;
    value: number;
    highlight: number;
    hasHighlight: boolean;
    /** all source-row selection ids that roll into this cell */
    selectionId: ISelectionId;
    tooltipValues: { name: string; value: number }[];
    /**
     * Source rows behind this mark. The table half matches on these rather than on
     * identities: a mark's identity carries the series scope and a table row's does
     * not, so the identity lists never compare equal even though both were built
     * from the same rows. Never capped - it is local bookkeeping, not a host filter.
     */
    rowIndices?: number[];
    /**
     * Measures that are not the cell's own value, keyed by well: "__x", "__y" and
     * "__size" from the X axis / Y axis / Size wells. They travel through exactly
     * the same three-stage roll-up as the value, so a scatter point respects
     * "Combine values using" the way every other mark does. Only the scatter type
     * reads them; the other eleven ignore them and they are absent when the wells
     * are empty.
     */
    extras?: { [key: string]: number };
}

export interface CategoryDatum {
    key: string;
    label: string;
    /** slice colour, used when a chart type colours by category (donut) */
    color?: string;
    sortKey: number;
    total: number;
    highlightTotal: number;
    selectionId: ISelectionId;
    cells: CellDatum[];
    /** source rows behind the whole category; see CellDatum.rowIndices */
    rowIndices?: number[];
}

export interface ChartModel {
    axisOptions: AxisFieldOption[];
    activeAxis: AxisFieldOption;
    /** what the second dropdown can offer */
    dimension2Options: AxisFieldOption[];
    /** the field currently splitting the chart into series, when one is chosen */
    activeDimension2: AxisFieldOption;
    categories: CategoryDatum[];
    series: SeriesInfo[];
    hasHighlights: boolean;
    truncated: boolean;
    totalCategoryCount: number;
    measureName: string;
    measureFormat: string;
    /** name / format of the first Line values measure, for the secondary axis */
    secondaryName: string;
    secondaryFormat: string;
    dateFieldPresent: boolean;
    /** which granularity buttons this dataview can offer */
    granularityAvailable: { annual: boolean; quarterly: boolean; monthly: boolean };
    /** true when Top N trimmed the category list (not the same as `truncated`) */
    topNApplied: boolean;
    valueColumnMeta: DataViewMetadataColumn;
    /** the X axis / Y axis / Size wells, for the scatter type's axis titles and formats */
    xMeta?: DataViewMetadataColumn;
    yMeta?: DataViewMetadataColumn;
    sizeMeta?: DataViewMetadataColumn;
}

export interface TransformOptions {
    axisKey: string;
    granularity: Granularity;
    rollup: Rollup;
    fiscalYearStartMonth: number;
    yearLabelStyle: string;
    quarterLabelStyle: string;
    monthLabelStyle: string;
    sortBy: string;
    sortDirection: string;
    /** read the numbers inside category labels when sorting by category */
    sortNumeric: boolean;
    /** cap on the identities one mark hands the host when it is selected */
    maxSelectionIds: number;
    hideBlank: boolean;
    blankLabel: string;
    maxCategories: number;
    /** key of the Dimensions field that splits the chart into series, or "" for none */
    dimension2Key: string;
    /** keep only this many categories after sorting; null for all */
    topN: number;
    topNMode: string;
    colorForSeries: (info: SeriesInfo) => string;
    /** per-category colour, for the types that colour by slice rather than series */
    colorForCategory: (key: string, index: number, objects: powerbi.DataViewObjects) => string;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

/* ------------------------------------------------------------------ */
/* field discovery                                                     */
/* ------------------------------------------------------------------ */

/** key of the synthetic time option used when only label columns are mapped */
export const TIME_AXIS_KEY = "__time";

/**
 * A stable key for a selection identity. Hosts expose getKey(); when they do not,
 * fall back to the row index so behaviour is unchanged.
 */
function keyOfSelection(id: ISelectionId, rowIndex: number): string {
    const g = (id as unknown as { getKey?: () => string }).getKey;
    return typeof g === "function" ? String(g.call(id)) : `r${rowIndex}`;
}

export function hasRole(col: DataViewMetadataColumn, role: string): boolean {
    return !!(col && col.roles && col.roles[role]);
}

/**
 * A measure value the chart can actually plot, or null when there is none.
 *
 * Power BI will hand over whatever the model produced. A DIVIDE with no guard
 * yields Infinity, a broken measure yields NaN, and a text column dropped into
 * Values yields a string - and any of the three, summed and then run through a
 * scale, ends up as `NaN` in an SVG coordinate. The browser then rejects the
 * attribute and logs an error per mark, which is both a visible defect and an
 * automatic certification failure ("no JavaScript errors in the console for any
 * input data"). Anything that is not a finite number is treated as missing, which
 * is what a native chart does with it.
 */
function finiteOrNull(v: powerbi.PrimitiveValue): number {
    if (v === null || v === undefined) {
        return null;
    }
    const n = typeof v === "number" ? v : Number(v);
    return isFinite(n) ? n : null;
}

/* --- the scatter wells ------------------------------------------- */

export const EXTRA_X = "__x";
export const EXTRA_Y = "__y";
export const EXTRA_SIZE = "__size";

const EXTRA_ROLES = [
    { role: "xMeasure", key: EXTRA_X },
    { role: "yMeasure", key: EXTRA_Y },
    { role: "sizeMeasure", key: EXTRA_SIZE }
];

function isExtraRole(col: DataViewMetadataColumn): boolean {
    return EXTRA_ROLES.some((r) => hasRole(col, r.role));
}

function metaOf(
    cols: { key: string; col: DataViewValueColumn }[],
    key: string
): DataViewMetadataColumn {
    const hit = cols.filter((c) => c.key === key)[0];
    return hit ? hit.col.source : undefined;
}

/** the value one well contributed to a mark, or null when that well is empty */
export function extraOf(cell: CellDatum, key: string): number {
    if (!cell || !cell.extras) {
        return null;
    }
    const v = cell.extras[key];
    return v === undefined || v === null ? null : v;
}

/**
 * A field dropped into two wells (say Group Company in both Dimensions and Table
 * columns) is projected into `categories` once per well, and Power BI puts BOTH
 * roles on each of those copies. Walking the array naively therefore yields the
 * field once per projection - which showed up as "Group Company, Department,
 * Group Company, Department" in the dropdown, with two options sharing one key.
 * Keying by queryName collapses the copies; they carry identical values, so any
 * one of them is as good as another.
 */
export function getAxisOptions(dataView: DataView): AxisFieldOption[] {
    const options: AxisFieldOption[] = [];
    const cats = dataView && dataView.categorical && dataView.categorical.categories;
    if (!cats) {
        return options;
    }
    const seen: { [key: string]: boolean } = {};

    const add = (c: DataViewCategoryColumn, i: number, isDate: boolean): void => {
        const key = c.source.queryName || c.source.displayName;
        if (seen[key]) {
            return;
        }
        seen[key] = true;
        options.push({ key, label: c.source.displayName, categoryIndex: i, isDate });
    };

    cats.forEach((c, i) => {
        if (hasRole(c.source, "dimension")) {
            add(c, i, false);
        }
    });
    let hasDateOption = false;
    cats.forEach((c, i) => {
        if (hasRole(c.source, "date")) {
            add(c, i, true);
            hasDateOption = true;
        }
    });

    /*
     * With no Date field but a per-granularity label column mapped, the time axis
     * is still available - it just reads its categories from whichever label column
     * belongs to the active granularity. One dropdown entry covers all three.
     */
    if (!hasDateOption) {
        for (let i = 0; i < cats.length; i++) {
            const src = cats[i].source;
            if (
                hasRole(src, "annualLabel") ||
                hasRole(src, "quarterlyLabel") ||
                hasRole(src, "monthlyLabel")
            ) {
                options.push({
                    key: TIME_AXIS_KEY,
                    label: src.displayName,
                    categoryIndex: i,
                    isDate: true
                });
                break;
            }
        }
    }
    return options;
}

/** category index of the label column for one granularity, or -1 */
export function getGranularityLabelIndex(dataView: DataView, granularity: Granularity): number {
    const role =
        granularity === "annual"
            ? "annualLabel"
            : granularity === "quarterly"
            ? "quarterlyLabel"
            : "monthlyLabel";
    const cats = dataView && dataView.categorical && dataView.categorical.categories;
    if (!cats) {
        return -1;
    }
    for (let i = 0; i < cats.length; i++) {
        if (hasRole(cats[i].source, role)) {
            return i;
        }
    }
    return -1;
}

/**
 * Which granularity buttons this dataview can offer. A button is available when
 * its own label column is mapped, or when a Date field is mapped and the visual
 * can derive the bucket itself.
 */
export function granularityAvailability(
    dataView: DataView
): { annual: boolean; quarterly: boolean; monthly: boolean } {
    const date = getDateCategoryIndex(dataView) >= 0;
    return {
        annual: date || getGranularityLabelIndex(dataView, "annual") >= 0,
        quarterly: date || getGranularityLabelIndex(dataView, "quarterly") >= 0,
        monthly: date || getGranularityLabelIndex(dataView, "monthly") >= 0
    };
}

/**
 * What the second dropdown offers. Fields in the dedicated "Dimensions 2" well
 * when there are any, otherwise the Dimensions bucket - so a report that has not
 * mapped the new well keeps the behaviour it had.
 */
export function getDimension2Options(dataView: DataView): AxisFieldOption[] {
    const options: AxisFieldOption[] = [];
    const cats = dataView && dataView.categorical && dataView.categorical.categories;
    if (!cats) {
        return options;
    }
    const seen: { [key: string]: boolean } = {};
    cats.forEach((c, i) => {
        if (!hasRole(c.source, "dimension2")) {
            return;
        }
        const key = c.source.queryName || c.source.displayName;
        if (seen[key]) {
            return;
        }
        seen[key] = true;
        options.push({ key, label: c.source.displayName, categoryIndex: i, isDate: false });
    });
    return options.length ? options : getAxisOptions(dataView);
}

export function getDateCategoryIndex(dataView: DataView): number {
    const cats = dataView && dataView.categorical && dataView.categorical.categories;
    if (!cats) {
        return -1;
    }
    for (let i = 0; i < cats.length; i++) {
        if (hasRole(cats[i].source, "date")) {
            return i;
        }
    }
    return -1;
}

/* ------------------------------------------------------------------ */
/* label ordering                                                      */
/* ------------------------------------------------------------------ */

/**
 * Compare two labels the way a person reads them: digit runs compare as numbers,
 * everything else as text. So the age buckets 18-25 / 25-40 / 40+ and the tenure
 * buckets 0-1 / 1-2 / 2-5 / 5-10 / 10-20 / 30+ land in their real order instead of
 * the text order that puts "10-20" before "2-5".
 *
 * Labels with no digits in them compare exactly as localeCompare would, so turning
 * this on cannot disturb a plain text axis.
 */
export function naturalCompare(a: string, b: string): number {
    const A = a === null || a === undefined ? "" : String(a);
    const B = b === null || b === undefined ? "" : String(b);
    const chunks = /(\d+(?:\.\d+)?)|(\D+)/g;
    const ca = A.match(chunks) || [];
    const cb = B.match(chunks) || [];
    const n = Math.min(ca.length, cb.length);
    for (let i = 0; i < n; i++) {
        const x = ca[i];
        const y = cb[i];
        const nx = parseFloat(x);
        const ny = parseFloat(y);
        const xIsNum = !isNaN(nx) && /^[\d.]/.test(x);
        const yIsNum = !isNaN(ny) && /^[\d.]/.test(y);
        if (xIsNum && yIsNum) {
            if (nx !== ny) {
                return nx - ny;
            }
        } else {
            const c = x.localeCompare(y);
            if (c !== 0) {
                return c;
            }
        }
    }
    return ca.length - cb.length;
}

/* ------------------------------------------------------------------ */
/* time bucketing                                                      */
/* ------------------------------------------------------------------ */

interface TimeBucket {
    key: string;
    label: string;
    sortKey: number;
}

function toDate(raw: powerbi.PrimitiveValue): Date {
    if (raw instanceof Date) {
        return raw;
    }
    if (raw === null || raw === undefined) {
        return null;
    }
    const d = new Date(raw as string);
    return isNaN(d.getTime()) ? null : d;
}

function fyLabel(startYear: number, style: string): string {
    const endYear = startYear + 1;
    switch (style) {
        case "rangeShort":
            return `${startYear}-${String(endYear).slice(2)}`;
        case "fyShort":
            return `FY${String(endYear).slice(2)}`;
        case "startYear":
            return String(startYear);
        case "endYear":
            return String(endYear);
        default:
            return `${startYear}-${endYear}`;
    }
}

export function bucketDate(
    raw: powerbi.PrimitiveValue,
    granularity: Granularity,
    fyStartMonth: number,
    opts: { yearLabelStyle: string; quarterLabelStyle: string; monthLabelStyle: string }
): TimeBucket {
    const d = toDate(raw);
    if (!d) {
        return { key: "__nodate__", label: String(raw === null || raw === undefined ? "" : raw), sortKey: Number.MAX_SAFE_INTEGER };
    }
    const y = d.getFullYear();
    const m = d.getMonth(); // 0-based
    const fyStart0 = Math.max(0, Math.min(11, (fyStartMonth || 1) - 1));
    // offset of this month within the fiscal year
    const offset = (m - fyStart0 + 12) % 12;
    const fyStartYear = m >= fyStart0 ? y : y - 1;
    const calendarFy = fyStart0 === 0;

    if (granularity === "monthly") {
        let label: string;
        switch (opts.monthLabelStyle) {
            case "mmmYYYY": label = `${MONTHS_SHORT[m]} ${y}`; break;
            case "mmm": label = MONTHS_SHORT[m]; break;
            case "mmmmYYYY": label = `${MONTHS_LONG[m]} ${y}`; break;
            case "mmYYYY": label = `${String(m + 1).padStart(2, "0")}-${y}`; break;
            default: label = `${MONTHS_SHORT[m]} ${String(y).slice(2)}`;
        }
        return { key: `M${y}-${String(m + 1).padStart(2, "0")}`, label, sortKey: y * 100 + m };
    }

    if (granularity === "quarterly") {
        const q = Math.floor(offset / 3) + 1;
        const yearForLabel = calendarFy ? y : fyStartYear;
        let label: string;
        switch (opts.quarterLabelStyle) {
            case "yearQ": label = `${yearForLabel} Q${q}`; break;
            case "qOnly": label = `Q${q}`; break;
            case "qFy": label = `Q${q} FY${String((calendarFy ? y : fyStartYear + 1)).slice(2)}`; break;
            default: label = `Q${q} ${yearForLabel}`;
        }
        return { key: `Q${fyStartYear}-${q}`, label, sortKey: fyStartYear * 10 + q };
    }

    // annual
    const label = calendarFy ? String(y) : fyLabel(fyStartYear, opts.yearLabelStyle);
    return { key: `Y${fyStartYear}`, label, sortKey: fyStartYear };
}

/* ------------------------------------------------------------------ */
/* aggregation helpers                                                 */
/* ------------------------------------------------------------------ */

interface TimeSlot {
    sortKey: number;
    value: number;
    highlight: number;
    hasHighlight: boolean;
    /**
     * Rows that actually put something into this slot - a row whose measure came
     * back as zero is not one of them. This is what the table half filters on, so
     * "the rows behind this bar" means the rows the bar is made of, not every row
     * the query happened to pair with that category.
     */
    rows?: number[];
}

/**
 * Which slots a roll-up actually reads. Sum and average are made of all of them;
 * first / last / min / max are made of exactly one, and the rows behind the mark
 * are that one's rows. Without this, a "Last" chart showing 222 people at the
 * latest date listed all 297 who ever appeared in the period.
 */
function slotsUsedBy(slots: TimeSlot[], rollup: Rollup): TimeSlot[] {
    const defined = slots.filter((s) => s.value !== null && s.value !== undefined);
    if (!defined.length) {
        return [];
    }
    switch (rollup) {
        case "first": {
            return [defined.slice().sort((a, b) => a.sortKey - b.sortKey)[0]];
        }
        case "last": {
            const sorted = defined.slice().sort((a, b) => a.sortKey - b.sortKey);
            return [sorted[sorted.length - 1]];
        }
        case "min": {
            let best = defined[0];
            defined.forEach((x) => {
                if (x.value < best.value) {
                    best = x;
                }
            });
            return [best];
        }
        case "max": {
            let best = defined[0];
            defined.forEach((x) => {
                if (x.value > best.value) {
                    best = x;
                }
            });
            return [best];
        }
        default:
            return defined;
    }
}

function rowsOf(slots: TimeSlot[]): number[] {
    const out: number[] = [];
    const seen: { [k: string]: boolean } = {};
    slots.forEach((s) =>
        (s.rows || []).forEach((r) => {
            if (seen[String(r)]) {
                return;
            }
            seen[String(r)] = true;
            out.push(r);
        })
    );
    return out;
}

function applyRollup(slots: TimeSlot[], rollup: Rollup, useHighlight: boolean): number {
    if (!slots.length) {
        return null;
    }
    const pick = (s: TimeSlot) => (useHighlight ? s.highlight : s.value);
    const defined = slots.filter((s) => pick(s) !== null && pick(s) !== undefined);
    if (!defined.length) {
        return null;
    }
    switch (rollup) {
        case "avg": {
            let sum = 0;
            defined.forEach((s) => (sum += pick(s)));
            return sum / defined.length;
        }
        case "min": {
            let v = Number.POSITIVE_INFINITY;
            defined.forEach((s) => (v = Math.min(v, pick(s))));
            return v;
        }
        case "max": {
            let v = Number.NEGATIVE_INFINITY;
            defined.forEach((s) => (v = Math.max(v, pick(s))));
            return v;
        }
        case "first": {
            const sorted = defined.slice().sort((a, b) => a.sortKey - b.sortKey);
            return pick(sorted[0]);
        }
        case "last": {
            const sorted = defined.slice().sort((a, b) => a.sortKey - b.sortKey);
            return pick(sorted[sorted.length - 1]);
        }
        default: {
            let sum = 0;
            defined.forEach((s) => (sum += pick(s)));
            return sum;
        }
    }
}

/* ------------------------------------------------------------------ */
/* main transform                                                      */
/* ------------------------------------------------------------------ */

interface WorkingCell {
    /** stage-1 buckets: rawDateKey -> summed value */
    byRawDate: { [k: string]: TimeSlot };
    /** row indices contributing, for selection ids */
    rowIndices: number[];
    tooltipsByRawDate: { [k: string]: { [name: string]: number } };
}

export function transform(
    dataView: DataView,
    host: IVisualHost,
    options: TransformOptions
): ChartModel {
    const empty: ChartModel = {
        axisOptions: [],
        activeAxis: null,
        dimension2Options: [],
        activeDimension2: null,
        categories: [],
        series: [],
        hasHighlights: false,
        truncated: false,
        totalCategoryCount: 0,
        measureName: "",
        measureFormat: undefined,
        secondaryName: "",
        secondaryFormat: undefined,
        dateFieldPresent: false,
        granularityAvailable: { annual: false, quarterly: false, monthly: false },
        topNApplied: false,
        valueColumnMeta: null
    };

    const categorical = dataView && dataView.categorical;
    if (!categorical || !categorical.categories || !categorical.categories.length || !categorical.values) {
        return empty;
    }

    const cats: DataViewCategoryColumn[] = categorical.categories;
    const axisOptions = getAxisOptions(dataView);
    if (!axisOptions.length) {
        return empty;
    }

    let activeAxis = axisOptions.filter((o) => o.key === options.axisKey)[0];
    if (!activeAxis) {
        activeAxis = axisOptions[0];
    }

    const dateIndex = getDateCategoryIndex(dataView);
    const dateFieldPresent = dateIndex >= 0;

    /* --- series definition -------------------------------------- */
    const valueColumns = categorical.values;
    const grouped = valueColumns.grouped ? valueColumns.grouped() : [];
    const hasLegend = !!(valueColumns.source && hasRole(valueColumns.source, "legend"));

    const measureCols: DataViewValueColumn[] = [];
    const lineCols: DataViewValueColumn[] = [];
    const tooltipCols: DataViewValueColumn[] = [];
    /*
     * The scatter wells. They ride along with the tooltip measures - same
     * projection, same stage-1 sum, same roll-up - and are pulled back out by name
     * when the cell is built, so no second aggregation path exists to disagree with
     * the first. `extraByName` is that lookup.
     */
    const extraCols: { key: string; col: DataViewValueColumn }[] = [];
    const extraByName: { [name: string]: string } = {};
    const alsoTooltip: { [name: string]: boolean } = {};
    valueColumns.forEach((v) => {
        EXTRA_ROLES.forEach((r) => {
            if (hasRole(v.source, r.role) && !extraCols.filter((e) => e.key === r.key).length) {
                extraCols.push({ key: r.key, col: v });
                extraByName[v.source.displayName] = r.key;
            }
        });
        if (hasRole(v.source, "measure")) {
            measureCols.push(v);
        } else if (hasRole(v.source, "lineMeasure")) {
            lineCols.push(v);
        } else if (hasRole(v.source, "tooltip")) {
            tooltipCols.push(v);
            alsoTooltip[v.source.displayName] = true;
        }
    });
    /* aggregate the scatter wells alongside the tooltip measures */
    extraCols.forEach((e) => {
        if (tooltipCols.indexOf(e.col) === -1) {
            tooltipCols.push(e.col);
        }
    });
    /* Line values on their own still deserve a chart */
    if (!measureCols.length && lineCols.length) {
        while (lineCols.length) {
            measureCols.push(lineCols.shift());
        }
    }
    /*
     * A scatter is often the only chart on the page, with nothing in Values at all -
     * Y axis alone (or X alone) has to be enough to build a model, or there would be
     * no categories and no cells for the points to come from.
     */
    if (!measureCols.length && extraCols.length) {
        const pick = extraCols.filter((e) => e.key === EXTRA_Y)[0] || extraCols[0];
        measureCols.push(pick.col);
    }
    if (!measureCols.length) {
        return empty;
    }

    const series: SeriesInfo[] = [];
    /** for each series, the value column used, plus its tooltip columns */
    const seriesValueColumn: DataViewValueColumn[] = [];
    const seriesTooltipColumns: DataViewValueColumn[][] = [];
    /** for each series, the legend group it belongs to (undefined when there is no legend) */
    const seriesGroup: (powerbi.DataViewValueColumnGroup | undefined)[] = [];

    if (hasLegend && grouped.length) {
        grouped.forEach((g, gi) => {
            const gMeasures = g.values.filter((v) => hasRole(v.source, "measure"));
            const gTooltips = g.values.filter(
                (v) => hasRole(v.source, "tooltip") || isExtraRole(v.source)
            );
            if (!gMeasures.length) {
                return;
            }
            const label = g.name === null || g.name === undefined ? options.blankLabel : String(g.name);
            const info: SeriesInfo = {
                key: `g:${label}`,
                label,
                index: series.length,
                color: null,
                identity: g.identity,
                rawValue: g.name,
                queryName: valueColumns.source ? valueColumns.source.queryName : undefined
            };
            info.selectionId = host
                .createSelectionIdBuilder()
                .withSeries(valueColumns, g)
                .createSelectionId();
            series.push(info);
            seriesValueColumn.push(gMeasures[0]);
            seriesTooltipColumns.push(gTooltips);
            seriesGroup.push(g);
            void gi;
        });
    } else {
        measureCols.forEach((m) => {
            const info: SeriesInfo = {
                key: `m:${m.source.queryName || m.source.displayName}`,
                label: m.source.displayName,
                index: series.length,
                color: null,
                queryName: m.source.queryName
            };
            info.selectionId = host
                .createSelectionIdBuilder()
                .withMeasure(m.source.queryName)
                .createSelectionId();
            series.push(info);
            seriesValueColumn.push(m);
            seriesTooltipColumns.push(tooltipCols);
            seriesGroup.push(undefined);
        });
    }

    /*
     * Measures in the Line values well become extra series flagged isLine. The
     * combo renderers draw those as a line on the secondary axis and leave them
     * out of the column stack; every other chart type ignores the flag and just
     * draws them like any other series.
     */
    if (lineCols.length) {
        const pushLine = (col: DataViewValueColumn, label: string, key: string, g?: powerbi.DataViewValueColumnGroup) => {
            const info: SeriesInfo = {
                key,
                label,
                index: series.length,
                color: null,
                queryName: col.source.queryName,
                isLine: true,
                format: col.source.format
            };
            let b = host.createSelectionIdBuilder();
            b = g ? b.withSeries(valueColumns, g) : b.withMeasure(col.source.queryName);
            info.selectionId = b.createSelectionId();
            if (g) {
                info.identity = g.identity;
                info.rawValue = g.name;
            }
            series.push(info);
            seriesValueColumn.push(col);
            seriesTooltipColumns.push([]);
            seriesGroup.push(g);
        };

        if (hasLegend && grouped.length) {
            grouped.forEach((g) => {
                const gName =
                    g.name === null || g.name === undefined ? options.blankLabel : String(g.name);
                g.values
                    .filter((v) => hasRole(v.source, "lineMeasure"))
                    .forEach((col) =>
                        pushLine(
                            col,
                            grouped.length > 1 ? `${gName} - ${col.source.displayName}` : col.source.displayName,
                            `l:${gName}:${col.source.queryName}`,
                            g
                        )
                    );
            });
        } else {
            lineCols.forEach((col) =>
                pushLine(col, col.source.displayName, `l:${col.source.queryName}`)
            );
        }
    }

    /*
     * Dimension 2: the user picked one of the Dimensions fields to split the chart
     * into series at runtime. That replaces the Legend well's grouping - the series
     * become the distinct values of that column, aggregated client-side exactly the
     * way the axis dimension is. Line-values series are left alone: a combo keeps
     * one line across all of them.
     */
    const labelOpts = {
        yearLabelStyle: options.yearLabelStyle,
        quarterLabelStyle: options.quarterLabelStyle,
        monthLabelStyle: options.monthLabelStyle
    };

    const dimension2Options = getDimension2Options(dataView);
    const d2Option = options.dimension2Key
        ? dimension2Options.filter(
              (o) => o.key === options.dimension2Key && o.key !== activeAxis.key
          )[0]
        : undefined;
    const d2Col = d2Option ? cats[d2Option.categoryIndex] : null;
    const d2SeriesIndex: { [key: string]: number } = {};
    /* splitting by the Date field means splitting by time bucket - raw date values
       would name the series "Mon Apr 01 2024 00:00:00 GMT+0000" */
    const d2IsDate = !!d2Col && hasRole(d2Col.source, "date");
    const d2At = (r: number): { key: string; label: string } => {
        const raw = d2Col.values[r];
        if (raw === null || raw === undefined || raw === "") {
            return { key: " blank", label: options.blankLabel };
        }
        if (d2IsDate) {
            const b = bucketDate(raw, options.granularity, options.fiscalYearStartMonth, labelOpts);
            return { key: `v:${b.key}`, label: b.label };
        }
        return { key: `v:${String(raw)}`, label: String(raw) };
    };

    if (d2Col) {
        /* the column-drawing series are replaced by one per distinct value */
        const lineOnly = series.filter((x) => x.isLine);
        const lineCols2 = lineOnly.map((x) => seriesValueColumn[series.indexOf(x)]);
        const lineTips = lineOnly.map((x) => seriesTooltipColumns[series.indexOf(x)]);
        const lineGroups = lineOnly.map((x) => seriesGroup[series.indexOf(x)]);
        const baseCol = measureCols[0];
        const baseTips = tooltipCols;

        series.length = 0;
        seriesValueColumn.length = 0;
        seriesTooltipColumns.length = 0;
        seriesGroup.length = 0;

        const seen: { [k: string]: boolean } = {};
        for (let r = 0; r < d2Col.values.length; r++) {
            const { key, label } = d2At(r);
            if (key === " blank" && options.hideBlank) {
                continue;
            }
            if (seen[key]) {
                continue;
            }
            seen[key] = true;
            const info: SeriesInfo = {
                key: `d2:${d2Option.key}:${key}`,
                label,
                index: series.length,
                color: null,
                queryName: baseCol.source.queryName,
                format: baseCol.source.format,
                d2Key: key
            };
            info.selectionId = host
                .createSelectionIdBuilder()
                .withCategory(d2Col, r)
                .createSelectionId();
            d2SeriesIndex[key] = series.length;
            series.push(info);
            seriesValueColumn.push(baseCol);
            seriesTooltipColumns.push(baseTips);
            seriesGroup.push(undefined);
        }

        /*
         * The series were discovered in row order, which changes whenever the query
         * changes shape. Sort them by label, keeping each one's column, tooltips and
         * group with it, so the legend order, the stacking order and the colours stay
         * put when something unrelated - a Table rows field, say - joins the query.
         */
        const sorted = series
            .map((info, i) => ({
                info,
                column: seriesValueColumn[i],
                tips: seriesTooltipColumns[i],
                group: seriesGroup[i]
            }))
            .sort((a, b) => String(a.info.label).localeCompare(String(b.info.label)));

        series.length = 0;
        seriesValueColumn.length = 0;
        seriesTooltipColumns.length = 0;
        seriesGroup.length = 0;
        sorted.forEach((entry, i) => {
            entry.info.index = i;
            d2SeriesIndex[entry.info.d2Key] = i;
            series.push(entry.info);
            seriesValueColumn.push(entry.column);
            seriesTooltipColumns.push(entry.tips);
            seriesGroup.push(entry.group);
        });

        /* re-append the line series after them so the combos still work */
        lineOnly.forEach((x, i) => {
            x.index = series.length;
            series.push(x);
            seriesValueColumn.push(lineCols2[i]);
            seriesTooltipColumns.push(lineTips[i]);
            seriesGroup.push(lineGroups[i]);
        });
    }

    if (!series.length) {
        return empty;
    }
    series.forEach((s, i) => {
        s.color = options.colorForSeries(s);
        if (!s.format && seriesValueColumn[i]) {
            s.format = seriesValueColumn[i].source.format;
        }
    });
    const firstLine = series.filter((s) => s.isLine)[0];

    /* --- walk rows ---------------------------------------------- */
    const rowCount = cats[0].values.length;
    const dateCol = dateIndex >= 0 ? cats[dateIndex] : null;
    const axisIsDate = activeAxis.isDate;

    /*
     * A label column mapped for the active granularity takes over two jobs: it
     * labels the time axis (so "Q1 Jan-Mar 26-27" replaces the derived "Q1 26"),
     * and it defines the time bucket the roll-up collapses into. Without one the
     * visual derives both from the Date field as before.
     */
    const labelIndex = getGranularityLabelIndex(dataView, options.granularity);
    const labelCol = labelIndex >= 0 ? cats[labelIndex] : null;
    const axisUsesLabel = axisIsDate && !!labelCol;
    const axisCol = axisUsesLabel
        ? labelCol
        : axisIsDate && dateCol
        ? dateCol
        : cats[activeAxis.categoryIndex];

    /* chronological order for label values: the earliest date each label covers */
    const labelSort: { [key: string]: number } = {};
    if (labelCol) {
        for (let r = 0; r < rowCount; r++) {
            const raw = labelCol.values[r];
            const key = raw === null || raw === undefined || raw === "" ? " blank" : `t:${String(raw)}`;
            const d = dateCol ? toDate(dateCol.values[r]) : null;
            const v = d ? d.getTime() : r;
            if (labelSort[key] === undefined || v < labelSort[key]) {
                labelSort[key] = v;
            }
        }
    }
    const labelKeyAt = (r: number): string => {
        const raw = labelCol.values[r];
        return raw === null || raw === undefined || raw === "" ? " blank" : `t:${String(raw)}`;
    };


    interface WorkingCategory {
        key: string;
        label: string;
        sortKey: number;
        rowIndices: number[];
        /** per-series -> per time bucket (granularity level) -> working cell */
        cells: { [timeKey: string]: WorkingCell }[];
        timeSortKeys: { [timeKey: string]: number };
    }

    const catMap: { [key: string]: WorkingCategory } = {};
    const catOrder: string[] = [];
    let hasHighlights = false;

    /*
     * Sort key for each raw date, taken from the date itself.
     *
     * Stage 1 groups the rows of a time bucket by their raw date, and stage 2 then
     * collapses those groups with the chosen roll-up. Every group used to be stamped
     * with the *bucket's* sort key, which made them all equal - so "First" and "Last"
     * fell back to insertion order, i.e. the order Power BI happened to return the
     * rows in. Adding fields to Table rows / Table columns re-shapes the query and
     * changes that order, which is why the chart moved when only the table's fields
     * had changed. Keying on the raw date makes "Last" mean the latest date in the
     * period, whatever order the rows arrive in and whatever else is in the query.
     */
    const rawDateSort: { [key: string]: number } = {};
    const rawDateSortFor = (key: string, r: number): number => {
        if (rawDateSort[key] === undefined) {
            const d = dateCol ? toDate(dateCol.values[r]) : null;
            /* a non-date value in the Date well: fall back to first-seen order */
            rawDateSort[key] = d ? d.getTime() : Object.keys(rawDateSort).length;
        }
        return rawDateSort[key];
    };

    const allSeriesIndices = series.map((_, i) => i);
    const lineSeriesIndices = series
        .map((x, i) => (x.isLine ? i : -1))
        .filter((i) => i >= 0);

    for (let r = 0; r < rowCount; r++) {
        /* axis category */
        let catKey: string;
        let catLabel: string;
        let catSort = 0;
        let timeKey = "_";
        let timeSort = 0;

        if (labelCol) {
            timeKey = labelKeyAt(r);
            timeSort = labelSort[timeKey] || 0;
        } else if (dateCol) {
            const b = bucketDate(dateCol.values[r], options.granularity, options.fiscalYearStartMonth, labelOpts);
            timeKey = b.key;
            timeSort = b.sortKey;
        }

        if (axisUsesLabel) {
            const raw = axisCol.values[r];
            const isBlank = raw === null || raw === undefined || raw === "";
            if (isBlank && options.hideBlank) {
                continue;
            }
            catKey = timeKey;
            catLabel = isBlank ? options.blankLabel : String(raw);
            catSort = timeSort;
        } else if (axisIsDate) {
            const b = bucketDate(axisCol.values[r], options.granularity, options.fiscalYearStartMonth, labelOpts);
            catKey = b.key;
            catLabel = b.label;
            catSort = b.sortKey;
        } else {
            const raw = axisCol.values[r];
            const isBlank = raw === null || raw === undefined || raw === "";
            if (isBlank && options.hideBlank) {
                continue;
            }
            catLabel = isBlank ? options.blankLabel : String(raw);
            /* key off the raw value, not the display label - a real category that
               happens to equal the configured "Blank label" text must not merge
               with actually-blank rows */
            catKey = isBlank ? " blank" : `v:${String(raw)}`;
            catSort = 0;
        }

        let wc = catMap[catKey];
        if (!wc) {
            wc = {
                key: catKey,
                label: catLabel,
                sortKey: catSort,
                rowIndices: [],
                cells: series.map(() => ({})),
                timeSortKeys: {}
            };
            catMap[catKey] = wc;
            catOrder.push(catKey);
        }
        wc.rowIndices.push(r);
        wc.timeSortKeys[timeKey] = timeSort;

        /* raw-date key for stage-1 grouping, plus its own chronological sort key */
        const rawDateKey = dateCol ? String(dateCol.values[r]) : "_";
        const rawSort = rawDateSortFor(rawDateKey, r);

        /* with Dimension 2 active a row belongs to exactly one column series */
        let rowSeries = allSeriesIndices;
        if (d2Col) {
            const d2 = d2At(r);
            if (d2.key === " blank" && options.hideBlank) {
                continue;
            }
            const idx = d2SeriesIndex[d2.key];
            rowSeries = idx === undefined ? lineSeriesIndices : lineSeriesIndices.concat([idx]);
        }

        for (let si = 0; si < rowSeries.length; si++) {
            const s = rowSeries[si];
            const col = seriesValueColumn[s];
            const rawValue = finiteOrNull(col.values ? col.values[r] : null);
            const rawHighlight =
                col.highlights !== undefined && col.highlights !== null
                    ? finiteOrNull(col.highlights[r])
                    : undefined;
            if (rawHighlight !== undefined) {
                hasHighlights = true;
            }
            if (rawValue === null || rawValue === undefined) {
                continue;
            }

            const timeMap = wc.cells[s];
            let cell = timeMap[timeKey];
            if (!cell) {
                cell = { byRawDate: {}, rowIndices: [], tooltipsByRawDate: {} };
                timeMap[timeKey] = cell;
            }
            cell.rowIndices.push(r);

            /* stage 1: sum across the dimensions that are not on the axis */
            let slot = cell.byRawDate[rawDateKey];
            if (!slot) {
                slot = { sortKey: rawSort, value: 0, highlight: 0, hasHighlight: false, rows: [] };
                cell.byRawDate[rawDateKey] = slot;
            }
            slot.value += rawValue;
            /* a zero adds nothing to the mark, so it is not one of its rows */
            if (rawValue) {
                slot.rows.push(r);
            }
            if (rawHighlight !== undefined && rawHighlight !== null) {
                slot.highlight += rawHighlight;
                slot.hasHighlight = true;
            }

            /* tooltips follow the same stage-1 sum */
            const tips = seriesTooltipColumns[s];
            if (tips && tips.length) {
                let tmap = cell.tooltipsByRawDate[rawDateKey];
                if (!tmap) {
                    tmap = {};
                    cell.tooltipsByRawDate[rawDateKey] = tmap;
                }
                tips.forEach((t) => {
                    const tv = finiteOrNull(t.values ? t.values[r] : null);
                    if (tv === null) {
                        return;
                    }
                    const n = t.source.displayName;
                    tmap[n] = (tmap[n] || 0) + tv;
                });
            }
        }
    }

    /* --- collapse to final categories ---------------------------- */
    const built: CategoryDatum[] = [];

    catOrder.forEach((key) => {
        const wc = catMap[key];
        const cells: CellDatum[] = [];
        let total = 0;
        let highlightTotal = 0;

        for (let s = 0; s < series.length; s++) {
            const timeMap = wc.cells[s];
            const timeKeys = Object.keys(timeMap);
            if (!timeKeys.length) {
                continue;
            }

            /* stage 2: raw dates -> the selected time bucket */
            const bucketSlots: TimeSlot[] = [];
            const rowIdx: number[] = [];
            const tooltipAcc: { [name: string]: TimeSlot[] } = {};

            timeKeys.forEach((tk) => {
                const cell = timeMap[tk];
                const raws = Object.keys(cell.byRawDate).map((k) => cell.byRawDate[k]);
                const v = applyRollup(raws, options.rollup, false);
                const hasH = raws.some((x) => x.hasHighlight);
                const h = hasH ? applyRollup(raws, options.rollup, true) : null;
                bucketSlots.push({
                    sortKey: wc.timeSortKeys[tk] || 0,
                    value: v,
                    highlight: h,
                    hasHighlight: hasH,
                    rows: rowsOf(slotsUsedBy(raws, options.rollup))
                });
                cell.rowIndices.forEach((i) => rowIdx.push(i));

                Object.keys(cell.tooltipsByRawDate).forEach((rk) => {
                    const tm = cell.tooltipsByRawDate[rk];
                    Object.keys(tm).forEach((n) => {
                        if (!tooltipAcc[n]) {
                            tooltipAcc[n] = [];
                        }
                        tooltipAcc[n].push({
                            sortKey: rawDateSort[rk] !== undefined ? rawDateSort[rk] : 0,
                            value: tm[n],
                            highlight: null,
                            hasHighlight: false
                        });
                    });
                });
            });

            /* stage 3: collapse time buckets when a dimension is on the axis */
            const value = applyRollup(bucketSlots, options.rollup, false);
            /*
             * Two different row sets, deliberately:
             *   rowIdx    every row of the cell, which is what the host is given to
             *             cross-filter on - clicking a bar filters the report to that
             *             category, the way a native chart does.
             *   markRows  only the rows the roll-up actually read, which is what the
             *             table half lists - the rows this number is made of.
             */
            const markRows = rowsOf(slotsUsedBy(bucketSlots, options.rollup));
            const anyH = bucketSlots.some((x) => x.hasHighlight);
            const highlight = anyH ? applyRollup(bucketSlots, options.rollup, true) : null;

            /*
             * One roll-up, two destinations: a name claimed by the X / Y / Size
             * wells becomes an extra on the cell, everything else is a tooltip row.
             * A field dropped into Tooltips *and* one of those wells is both.
             */
            const extras: { [k: string]: number } = {};
            const tooltipValues: { name: string; value: number }[] = [];
            Object.keys(tooltipAcc).forEach((n) => {
                const v = applyRollup(tooltipAcc[n], options.rollup, false);
                const key = extraByName[n];
                if (key) {
                    extras[key] = v === null ? 0 : v;
                }
                if (!key || alsoTooltip[n]) {
                    tooltipValues.push({ name: n, value: v });
                }
            });

            /*
             * Selection identity: every source row that feeds this cell. Two rows
             * that differ only in a column the host does not scope on produce the
             * same identity, so de-duplicate on the identity's own key rather than
             * on the row index - at detail grain that collapses thousands of ids to
             * the handful that actually differ, which is the difference between a
             * click that filters instantly and one that stalls the report.
             */
            const ids: ISelectionId[] = [];
            const seen: { [k: string]: boolean } = {};
            const capIds = Math.max(1, options.maxSelectionIds || 1000);
            for (let ri = 0; ri < rowIdx.length && ids.length < capIds; ri++) {
                const i = rowIdx[ri];
                let b = host.createSelectionIdBuilder().withCategory(axisCol, i);
                if (hasLegend && grouped.length && series[s].identity && seriesGroup[s]) {
                    b = b.withSeries(valueColumns, seriesGroup[s]);
                }
                const id = b.createSelectionId();
                const k = keyOfSelection(id, i);
                if (seen[k]) {
                    continue;
                }
                seen[k] = true;
                ids.push(id);
            }

            /*
             * A rendered bar is an aggregate of many source rows, so there is no single
             * identity for it. `selectionId` keeps the first row (used for the context
             * menu, which takes one id) and `allSelectionIds` carries the full set that
             * is handed to selectionManager.select() for cross-filtering.
             */
            const merged = ids[0];

            const datum: CellDatum = {
                categoryIndex: built.length,
                seriesIndex: s,
                rowIndices: markRows,
                value: value === null ? 0 : value,
                highlight: highlight === null ? 0 : highlight,
                hasHighlight: anyH,
                selectionId: merged,
                tooltipValues,
                extras
            };
            (datum as unknown as { allSelectionIds: ISelectionId[] }).allSelectionIds = ids;
            cells.push(datum);
            total += datum.value;
            highlightTotal += anyH ? datum.highlight : datum.value;
        }

        if (!cells.length) {
            return;
        }

        const catIds: ISelectionId[] = [];
        const seenRows: { [k: string]: boolean } = {};
        const capIds = Math.max(1, options.maxSelectionIds || 1000);
        for (let ri = 0; ri < wc.rowIndices.length && catIds.length < capIds; ri++) {
            const i = wc.rowIndices[ri];
            const id = host.createSelectionIdBuilder().withCategory(axisCol, i).createSelectionId();
            const k = keyOfSelection(id, i);
            if (seenRows[k]) {
                continue;
            }
            seenRows[k] = true;
            catIds.push(id);
        }

        /* union of what each series contributed, so a whole-category click lists the
           same rows its segments would */
        const catRows: number[] = [];
        const seenCatRow: { [k: string]: boolean } = {};
        cells.forEach((c) =>
            (c.rowIndices || []).forEach((i) => {
                if (seenCatRow[String(i)]) {
                    return;
                }
                seenCatRow[String(i)] = true;
                catRows.push(i);
            })
        );

        const cd: CategoryDatum = {
            key: wc.key,
            label: wc.label,
            rowIndices: catRows,
            color: options.colorForCategory(
                wc.key,
                built.length,
                axisCol.objects ? axisCol.objects[wc.rowIndices[0]] : null
            ),
            sortKey: wc.sortKey,
            total,
            highlightTotal,
            selectionId: catIds[0],
            cells
        };
        (cd as unknown as { allSelectionIds: ISelectionId[] }).allSelectionIds = catIds;
        built.push(cd);
    });

    /* --- sort ---------------------------------------------------- */
    const dir = options.sortDirection === "asc" ? 1 : -1;
    if (axisIsDate) {
        built.sort((a, b) => (a.sortKey - b.sortKey) * (options.sortDirection === "asc" ? 1 : 1));
    } else if (options.sortBy === "value") {
        built.sort((a, b) => (a.total - b.total) * dir);
    } else if (options.sortBy === "category") {
        const cmp = options.sortNumeric
            ? (a: CategoryDatum, b: CategoryDatum) => naturalCompare(a.label, b.label)
            : (a: CategoryDatum, b: CategoryDatum) => a.label.localeCompare(b.label);
        built.sort((a, b) => cmp(a, b) * (options.sortDirection === "asc" ? 1 : -1));
    }

    const totalCategoryCount = built.length;

    /*
     * Top N is a deliberate trim the user asked for in the header, so - unlike the
     * Max categories safety cap - it does not raise the "showing the first N of M"
     * banner. It runs on the sorted list, so "top" means whichever end Data
     * handling -> Sort by / Direction put first.
     */
    let ranked = built;
    let topNApplied = false;
    const n = options.topN;
    if (n !== null && n !== undefined && n > 0 && built.length > n) {
        ranked = options.topNMode === "bottom" ? built.slice(built.length - n) : built.slice(0, n);
        topNApplied = true;
    }

    const maxCats = Math.max(1, options.maxCategories || 200);
    const truncated = ranked.length > maxCats;
    const finalCats = truncated ? ranked.slice(0, maxCats) : ranked;
    finalCats.forEach((c, i) => c.cells.forEach((cell) => (cell.categoryIndex = i)));

    return {
        axisOptions,
        activeAxis,
        dimension2Options,
        activeDimension2: d2Option || null,
        categories: finalCats,
        series,
        hasHighlights,
        truncated,
        totalCategoryCount,
        measureName: seriesValueColumn[0] ? seriesValueColumn[0].source.displayName : "",
        measureFormat: seriesValueColumn[0] ? seriesValueColumn[0].source.format : undefined,
        secondaryName: firstLine ? firstLine.label : "",
        secondaryFormat: firstLine ? firstLine.format : undefined,
        dateFieldPresent,
        granularityAvailable: granularityAvailability(dataView),
        topNApplied,
        valueColumnMeta: seriesValueColumn[0] ? seriesValueColumn[0].source : null,
        xMeta: metaOf(extraCols, EXTRA_X),
        yMeta: metaOf(extraCols, EXTRA_Y),
        sizeMeta: metaOf(extraCols, EXTRA_SIZE)
    };
}
