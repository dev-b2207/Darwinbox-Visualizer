/*
 *  Fast cross-filtering.
 *
 *  Why this file exists
 *  --------------------
 *  A native Power BI chart runs a query grouped exactly at axis + legend grain, so
 *  one mark is one row of its result and clicking it hands the host a single
 *  selection identity. The host turns that into one condition and every other
 *  visual re-queries immediately.
 *
 *  This visual cannot do that. It runs ONE query for the chart half and the table
 *  half together, so when Table rows carries Employee Name the query grain is the
 *  employee, and a single bar is an aggregate of hundreds or thousands of source
 *  rows. `withCategory(col, i)` scopes on the whole row - every category column at
 *  once - so a bar's identity list is one entry per employee behind it. Handing the
 *  host 300 identities makes it build a 300-way filter for every other visual on
 *  the page, which is exactly the stall the report shows.
 *
 *  The fix is to stop describing the mark by enumerating its rows and describe it
 *  by its coordinates instead: "Department = Engineering", or
 *  "Department = Engineering AND Employment Type = Permanent". That is one or two
 *  conditions regardless of how many employees sit behind the bar, and it is what
 *  the filter API is for.
 *
 *  What is given up: the filter API filters other visuals rather than highlighting
 *  them, so their bars shrink instead of showing a shaded portion. Anyone who wants
 *  the native highlight look can switch Data handling -> Cross-filtering back to
 *  "Highlight". The source visual is not filtered by its own filter, so the chart
 *  keeps all of its bars either way.
 */
import powerbi from "powerbi-visuals-api";

import DataView = powerbi.DataView;
import DataViewCategoryColumn = powerbi.DataViewCategoryColumn;
import DataViewMetadataColumn = powerbi.DataViewMetadataColumn;
import PrimitiveValue = powerbi.PrimitiveValue;

import { ChartModel, hasRole } from "./dataModel";

/** powerbi.FilterAction is a const enum, which cannot be imported at runtime. */
export const FILTER_MERGE = 0;
export const FILTER_REMOVE = 1;

export interface FilterTarget {
    table: string;
    column: string;
}

/** One selected mark, as the chart reports it. */
export interface MarkRef {
    /** source rows behind the mark; empty for a legend click */
    rows: number[];
    /** index into model.series, or -1 when the click was not series-specific */
    seriesIndex: number;
}

/**
 * `queryName` is `Table.Column` for a projected column, sometimes wrapped in an
 * aggregate (`Sum(Table.Column)`) for a measure. Table names may contain dots, so
 * split at the last one. Anything that does not look like a column reference -
 * a measure defined in the model, a calculated projection - has no filter target
 * and sends the caller back to the identity path.
 */
export function targetOf(col: DataViewMetadataColumn): FilterTarget | null {
    if (!col || !col.queryName) {
        return null;
    }
    let qn = String(col.queryName);
    const agg = /^[A-Za-z]+\((.+)\)$/.exec(qn);
    if (agg) {
        qn = agg[1];
    }
    const dot = qn.lastIndexOf(".");
    if (dot <= 0 || dot >= qn.length - 1) {
        return null;
    }
    return { table: qn.slice(0, dot), column: qn.slice(dot + 1) };
}

function categories(dataView: DataView): DataViewCategoryColumn[] {
    const c = dataView && dataView.categorical && dataView.categorical.categories;
    return c && c.length ? c : [];
}

/** the column the axis dropdown is currently showing, date axis included */
export function axisColumn(dataView: DataView, model: ChartModel): DataViewCategoryColumn {
    const cats = categories(dataView);
    if (!model || !model.activeAxis) {
        return null;
    }
    if (model.activeAxis.isDate) {
        return cats.filter((c) => hasRole(c.source, "date"))[0] || null;
    }
    return cats[model.activeAxis.categoryIndex] || null;
}

/** the Dimension 2 column, when the second dropdown is splitting the chart */
function dimension2Column(dataView: DataView, model: ChartModel): DataViewCategoryColumn {
    const cats = categories(dataView);
    if (!model || !model.activeDimension2 || model.activeDimension2.isDate) {
        return null;
    }
    return cats[model.activeDimension2.categoryIndex] || null;
}

function isFilterable(v: PrimitiveValue): boolean {
    return v !== null && v !== undefined && (typeof v === "string" || typeof v === "number" || typeof v === "boolean");
}

function distinct(values: PrimitiveValue[]): PrimitiveValue[] {
    const out: PrimitiveValue[] = [];
    const seen: { [k: string]: boolean } = {};
    values.forEach((v) => {
        const k = `${typeof v}:${String(v)}`;
        if (seen[k]) {
            return;
        }
        seen[k] = true;
        out.push(v);
    });
    return out;
}

function basic(target: FilterTarget, values: PrimitiveValue[]): powerbi.IFilter {
    return {
        /* the filter API's own identifier for the shape below; not a URL that is fetched */
        // eslint-disable-next-line powerbi-visuals/no-http-string
        $schema: "http://powerbi.com/product/schema#basic",
        target,
        filterType: 1,
        operator: "In",
        values,
        requireSingleSelection: false
    } as unknown as powerbi.IFilter;
}

function between(target: FilterTarget, from: Date, to: Date): powerbi.IFilter {
    return {
        /* the filter API's own identifier for the shape below; not a URL that is fetched */
        // eslint-disable-next-line powerbi-visuals/no-http-string
        $schema: "http://powerbi.com/product/schema#advanced",
        target,
        filterType: 0,
        logicalOperator: "And",
        conditions: [
            { operator: "GreaterThanOrEqual", value: from.toISOString() },
            { operator: "LessThanOrEqual", value: to.toISOString() }
        ]
    } as unknown as powerbi.IFilter;
}

function tuple(targets: FilterTarget[], rows: PrimitiveValue[][]): powerbi.IFilter {
    return {
        /* the filter API's own identifier for the shape below; not a URL that is fetched */
        // eslint-disable-next-line powerbi-visuals/no-http-string
        $schema: "http://powerbi.com/product/schema#tuple",
        target: targets,
        filterType: 6,
        operator: "In",
        values: rows.map((r) => r.map((v) => ({ value: v })))
    } as unknown as powerbi.IFilter;
}

function toDate(v: PrimitiveValue): Date {
    if (v instanceof Date) {
        return v;
    }
    if (typeof v === "number") {
        return new Date(v);
    }
    if (typeof v === "string") {
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
}

/**
 * The value that identifies a mark's series for filtering, plus the column to
 * filter on. Series can come from three places and only two of them are a real
 * column: a legend grouping (filter on the legend column) and the Dimension 2
 * dropdown (filter on that dimension, read off the mark's own rows). Series that
 * come from several measures in the Values well are not a column at all, so a
 * click on one of them filters on the axis alone - which is what a native chart
 * does with a multi-measure legend too.
 */
function seriesFilter(
    dataView: DataView,
    model: ChartModel,
    marks: MarkRef[]
): { target: FilterTarget; values: PrimitiveValue[]; perMark: PrimitiveValue[] } | null {
    /*
     * A mark that is not series-specific - a whole donut slice, a whole category -
     * covers every series, so it must not be narrowed to one of them. Its rows
     * belong to all of them and reading a series value off row 0 would pick one at
     * random.
     */
    if (!marks.length || marks.some((m) => m.seriesIndex < 0)) {
        return null;
    }
    if (model.series.length <= 1) {
        return null;
    }

    const d2 = dimension2Column(dataView, model);
    if (d2) {
        const target = targetOf(d2.source);
        if (!target) {
            return null;
        }
        const perMark: PrimitiveValue[] = [];
        for (const m of marks) {
            if (!m.rows || !m.rows.length) {
                return null;
            }
            const v = d2.values[m.rows[0]];
            if (!isFilterable(v)) {
                return null;
            }
            perMark.push(v);
        }
        return { target, values: distinct(perMark), perMark };
    }

    const grouped =
        dataView.categorical && dataView.categorical.values && dataView.categorical.values.source
            ? dataView.categorical.values.source
            : null;
    if (!grouped) {
        return null;
    }
    const target = targetOf(grouped);
    if (!target) {
        return null;
    }
    const perMark: PrimitiveValue[] = [];
    for (const m of marks) {
        const s = m.seriesIndex >= 0 ? model.series[m.seriesIndex] : null;
        if (!s || !isFilterable(s.rawValue)) {
            return null;
        }
        perMark.push(s.rawValue);
    }
    return { target, values: distinct(perMark), perMark };
}

/**
 * Turn the current mark selection into report filters, or null when this
 * selection cannot be expressed as one - in which case the caller falls back to
 * handing the host selection identities.
 *
 * Deliberate refusals:
 *   - no filterable target on the axis column (a model measure, an unnamed
 *     projection)
 *   - a blank category, which "In" cannot express
 *   - several marks selected on a date axis, because a range filter takes two
 *     conditions and cannot describe two separated month buckets
 */
export function buildCrossFilter(dataView: DataView, model: ChartModel, marks: MarkRef[]): powerbi.IFilter[] | null {
    if (!dataView || !model || !marks || !marks.length) {
        return null;
    }
    const axisCol = axisColumn(dataView, model);
    if (!axisCol) {
        return null;
    }
    const axisTarget = targetOf(axisCol.source);
    if (!axisTarget) {
        return null;
    }

    const withRows = marks.filter((m) => m.rows && m.rows.length);
    if (withRows.length !== marks.length) {
        /* a legend click carries no rows: filter on the series alone */
        const only = seriesFilter(dataView, model, marks);
        return only ? [basic(only.target, only.values)] : null;
    }

    const series = seriesFilter(dataView, model, marks);

    if (model.activeAxis.isDate) {
        if (marks.length > 1) {
            return null;
        }
        let lo: Date = null;
        let hi: Date = null;
        for (const r of marks[0].rows) {
            const d = toDate(axisCol.values[r]);
            if (!d) {
                return null;
            }
            if (!lo || d.getTime() < lo.getTime()) {
                lo = d;
            }
            if (!hi || d.getTime() > hi.getTime()) {
                hi = d;
            }
        }
        if (!lo) {
            return null;
        }
        const out = [between(axisTarget, lo, hi)];
        if (series) {
            out.push(basic(series.target, series.values));
        }
        return out;
    }

    /* one axis value per mark - every row of a mark shares the category */
    const perMark: PrimitiveValue[] = [];
    for (const m of marks) {
        const v = axisCol.values[m.rows[0]];
        if (!isFilterable(v)) {
            return null;
        }
        perMark.push(v);
    }

    if (!series) {
        return [basic(axisTarget, distinct(perMark))];
    }
    if (marks.length === 1) {
        return [basic(axisTarget, distinct(perMark)), basic(series.target, series.values)];
    }
    /*
     * Two independent "In" lists would select their cross-product, which for
     * marks picked out of different categories AND different series is wider
     * than what was clicked. A tuple filter names the pairs exactly.
     */
    const pairs = marks.map((_, i) => [perMark[i], series.perMark[i]]);
    return [tuple([axisTarget, series.target], pairs)];
}
