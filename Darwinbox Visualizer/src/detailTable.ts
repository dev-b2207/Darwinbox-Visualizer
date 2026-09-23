/*
 *  Detail table model.
 *
 *  Power BI serves only one query per visual ("Each valid mapping produces a data
 *  view, but we currently support performing only one query per visual"), so the
 *  table cannot have a data mapping of its own. Instead the Table rows / Table
 *  columns wells join the same categorical query as the chart.
 *
 *  The row field sets the query grain (one row per employee, times any dates).
 *  The Table columns fields are attributes OF that row field, so they add
 *  essentially no rows to the cross-join - only the row field's own cardinality
 *  costs anything. The chart is unaffected: it re-groups the same rows by the
 *  selected dimension and sums, which is exactly what it already did.
 */
import powerbi from "powerbi-visuals-api";

import DataView = powerbi.DataView;
import DataViewCategoryColumn = powerbi.DataViewCategoryColumn;
import ISelectionId = powerbi.visuals.ISelectionId;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;

import { Rollup, hasRole } from "./dataModel";
import { createSimpleFormatter } from "./utils";

export interface DetailColumn {
    /** field name used as the Tabulator column field */
    key: string;
    label: string;
    queryName?: string;
    isMeasure: boolean;
    isNumeric: boolean;
    format?: string;
}

export interface DetailNode {
    key: string;
    label: string;
    /** attributes as display strings (so search matches what the user sees),
     *  measures as raw numbers (so bar formatters and totals still work) */
    values: { [field: string]: powerbi.PrimitiveValue };
    /** underlying attribute values, used for sorting dates and numbers properly */
    raw: { [field: string]: powerbi.PrimitiveValue };
    children: DetailNode[];
    selectionIds: ISelectionId[];
    /**
     * Source rows behind this node. Used to line the table up with a chart
     * selection: a mark's identity carries the series scope and a table row's does
     * not, so the two identity lists never compare equal - but the rows they were
     * built from do.
     */
    rowIndices: number[];
}

export interface DetailModel {
    /** Table rows fields in order; [0] is the frozen primary column, the rest nest */
    rowLevels: DetailColumn[];
    attributeColumns: DetailColumn[];
    measureColumns: DetailColumn[];
    nodes: DetailNode[];
    totalRows: number;
    truncated: boolean;
    totalNodeCount: number;
}

export interface DetailOptions {
    rollup: Rollup;
    blankLabel: string;
    maxRows: number;
    /**
     * Whether measures from the Values well become table columns. Off by design:
     * once Table rows is mapped the table is a detail list defined entirely by
     * Table rows + Table columns, and a chart measure like Ending Headcount has
     * no meaning against a single employee row.
     */
    includeMeasures: boolean;
}

/* ------------------------------------------------------------------ */

export function hasDetailRows(dataView: DataView): boolean {
    const cats = dataView && dataView.categorical && dataView.categorical.categories;
    if (!cats) {
        return false;
    }
    return cats.some((c) => hasRole(c.source, "tableRows"));
}

/*
 * Same de-duplication as getAxisOptions: a field in two wells is projected once
 * per well and both copies carry both roles, so without this the table would
 * repeat a column (Group Company twice) for a field that is also a Dimension.
 */
function columnsForRole(dataView: DataView, role: string): { col: DataViewCategoryColumn; index: number }[] {
    const cats = dataView.categorical.categories;
    const out: { col: DataViewCategoryColumn; index: number }[] = [];
    const seen: { [key: string]: boolean } = {};
    cats.forEach((c, i) => {
        if (!hasRole(c.source, role)) {
            return;
        }
        const key = c.source.queryName || c.source.displayName;
        if (seen[key]) {
            return;
        }
        seen[key] = true;
        out.push({ col: c, index: i });
    });
    return out;
}

function toColumn(source: powerbi.DataViewMetadataColumn, isMeasure: boolean): DetailColumn {
    return {
        /*
         * Key on queryName, not displayName: two different model fields can share
         * a display name (Department from two tables), and a shared key would make
         * one column silently overwrite the other in the row object.
         */
        key: source.queryName || source.displayName,
        label: source.displayName,
        queryName: source.queryName,
        isMeasure,
        isNumeric: !!(source.type && (source.type.numeric || source.type.integer)),
        format: source.format
    };
}

/** one accumulator per (node, raw date) so time roll-up stays honest */
interface Slot {
    sortKey: number;
    value: number;
}

function rollupValues(slots: Slot[], rollup: Rollup): number {
    if (!slots.length) {
        return null;
    }
    switch (rollup) {
        case "avg": {
            let s = 0;
            slots.forEach((x) => (s += x.value));
            return s / slots.length;
        }
        case "min":
            return slots.reduce((m, x) => Math.min(m, x.value), Number.POSITIVE_INFINITY);
        case "max":
            return slots.reduce((m, x) => Math.max(m, x.value), Number.NEGATIVE_INFINITY);
        case "first": {
            const a = slots.slice().sort((x, y) => x.sortKey - y.sortKey);
            return a[0].value;
        }
        case "last": {
            const a = slots.slice().sort((x, y) => x.sortKey - y.sortKey);
            return a[a.length - 1].value;
        }
        default: {
            let s = 0;
            slots.forEach((x) => (s += x.value));
            return s;
        }
    }
}

interface WorkNode {
    key: string;
    label: string;
    rowIndices: number[];
    /** attribute field -> first non-null value seen */
    attributes: { [field: string]: powerbi.PrimitiveValue };
    /** measure field -> raw date key -> summed value (stage 1) */
    measures: { [field: string]: { [dateKey: string]: Slot } };
    children: { [key: string]: WorkNode };
    childOrder: string[];
}

function newWorkNode(key: string, label: string): WorkNode {
    return {
        key,
        label,
        rowIndices: [],
        attributes: {},
        measures: {},
        children: {},
        childOrder: []
    };
}

export function buildDetailModel(
    dataView: DataView,
    host: IVisualHost,
    options: DetailOptions
): DetailModel {
    const empty: DetailModel = {
        rowLevels: [],
        attributeColumns: [],
        measureColumns: [],
        nodes: [],
        totalRows: 0,
        truncated: false,
        totalNodeCount: 0
    };

    if (!dataView || !dataView.categorical || !dataView.categorical.categories) {
        return empty;
    }

    const rowCols = columnsForRole(dataView, "tableRows");
    if (!rowCols.length) {
        return empty;
    }
    const attrCols = columnsForRole(dataView, "tableColumns");
    const dateCols = columnsForRole(dataView, "date");
    const dateCol = dateCols.length ? dateCols[0].col : null;

    const rowLevels = rowCols.map((c) => toColumn(c.col.source, false));
    const attributeColumns = attrCols.map((c) => toColumn(c.col.source, false));

    /*
     * Attribute columns carry the model's own format string (long dates, currency,
     * percentages), exactly as tableDarwinbox does through valueFormatter.
     */
    const attrFormatters: { [key: string]: ReturnType<typeof createSimpleFormatter> } = {};
    attributeColumns.forEach((a) => {
        attrFormatters[a.key] = createSimpleFormatter(a.format, host.locale);
    });
    const formatAttribute = (key: string, v: powerbi.PrimitiveValue): powerbi.PrimitiveValue => {
        if (v === null || v === undefined) {
            return null;
        }
        const f = attrFormatters[key];
        try {
            return f ? f.format(v as never) : String(v);
        } catch {
            return String(v);
        }
    };

    /* measure columns: one per distinct measure, summed across legend groups */
    const values = dataView.categorical.values;
    const measureColumns: DetailColumn[] = [];
    const measureSources: { col: powerbi.DataViewValueColumn; field: string }[] = [];
    if (values && options.includeMeasures) {
        values.forEach((v) => {
            if (!hasRole(v.source, "measure")) {
                return;
            }
            const field = v.source.queryName || v.source.displayName;
            if (!measureColumns.filter((m) => m.key === field).length) {
                measureColumns.push(toColumn(v.source, true));
            }
            measureSources.push({ col: v, field });
        });
    }

    const root = newWorkNode("__root__", "");
    const rowCount = dataView.categorical.categories[0].values.length;

    for (let r = 0; r < rowCount; r++) {
        /* walk the Table rows hierarchy, creating nodes as needed */
        let node = root;
        let path = "";
        for (let l = 0; l < rowCols.length; l++) {
            const raw = rowCols[l].col.values[r];
            const blank = raw === null || raw === undefined || raw === "";
            const label = blank ? options.blankLabel : String(raw);
            path = path ? `${path}~${label}` : label;
            let child = node.children[path];
            if (!child) {
                child = newWorkNode(path, label);
                node.children[path] = child;
                node.childOrder.push(path);
            }
            node = child;
            node.rowIndices.push(r);

            /* attributes belong to the deepest level that carries them */
            attrCols.forEach((a, ai) => {
                const v = a.col.values[r];
                if (v !== null && v !== undefined && v !== "") {
                    const key = attributeColumns[ai].key;
                    if (node.attributes[key] === undefined) {
                        node.attributes[key] = v;
                    }
                }
            });

            /* measures: stage 1 sums across everything not in the row path */
            const dateKey = dateCol ? String(dateCol.values[r]) : "_";
            const sortKey = dateCol ? dateSortKey(dateCol.values[r]) : 0;
            measureSources.forEach((m) => {
                const raw2 = m.col.values ? (m.col.values[r] as number) : null;
                if (raw2 === null || raw2 === undefined) {
                    return;
                }
                let byDate = node.measures[m.field];
                if (!byDate) {
                    byDate = {};
                    node.measures[m.field] = byDate;
                }
                let slot = byDate[dateKey];
                if (!slot) {
                    slot = { sortKey, value: 0 };
                    byDate[dateKey] = slot;
                }
                slot.value += raw2;
            });
        }
    }

    /* materialise, applying the time roll-up and building selection ids */
    const primaryCol = rowCols[0].col;
    let nodeCount = 0;

    const materialise = (w: WorkNode): DetailNode => {
        nodeCount++;
        const values2: { [field: string]: powerbi.PrimitiveValue } = {};
        const raw2: { [field: string]: powerbi.PrimitiveValue } = {};
        attributeColumns.forEach((a) => {
            const v = w.attributes[a.key] === undefined ? null : w.attributes[a.key];
            raw2[a.key] = v;
            values2[a.key] = formatAttribute(a.key, v);
        });
        measureColumns.forEach((m) => {
            const byDate = w.measures[m.key];
            if (!byDate) {
                values2[m.key] = null;
                return;
            }
            const slots = Object.keys(byDate).map((k) => byDate[k]);
            values2[m.key] = rollupValues(slots, options.rollup);
        });

        const ids: ISelectionId[] = [];
        const seen: { [k: string]: boolean } = {};
        w.rowIndices.forEach((i) => {
            if (seen[String(i)]) {
                return;
            }
            seen[String(i)] = true;
            ids.push(host.createSelectionIdBuilder().withCategory(primaryCol, i).createSelectionId());
        });

        return {
            key: w.key,
            label: w.label,
            values: values2,
            raw: raw2,
            children: w.childOrder.map((k) => materialise(w.children[k])),
            selectionIds: ids,
            rowIndices: w.rowIndices.slice()
        };
    };

    const allNodes = root.childOrder.map((k) => materialise(root.children[k]));
    const totalNodeCount = allNodes.length;
    const maxRows = Math.max(1, options.maxRows || 30000);
    const truncated = totalNodeCount > maxRows;
    const nodes = truncated ? allNodes.slice(0, maxRows) : allNodes;

    return {
        rowLevels,
        attributeColumns,
        measureColumns,
        nodes,
        totalRows: nodeCount,
        truncated,
        totalNodeCount
    };
}

function dateSortKey(raw: powerbi.PrimitiveValue): number {
    if (raw instanceof Date) {
        return raw.getTime();
    }
    if (raw === null || raw === undefined) {
        return 0;
    }
    const d = new Date(raw as string);
    return isNaN(d.getTime()) ? 0 : d.getTime();
}
