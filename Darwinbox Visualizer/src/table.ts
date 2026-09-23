/*
 *  Table view - Tabulator grid.
 *
 *  This is a port of the existing Darwinbox `tableDarwinbox` custom visual so the
 *  table half of this visual looks and behaves identically to the tables already
 *  used across the Headcount / Attrition reports:
 *    - debounced search bar with tree auto-expand at 3+ characters
 *    - frozen first column, checkbox row header, tree chevrons
 *    - custom pagination footer: zero-padded pages, "..." overflow, last-page
 *      button, "N of M records" counter and the "Rows per page" popup selector
 *    - column widths and sort persisted into saveState.columnMetadata
 *    - per-column "Bar" (in-cell progress) and "URL" cell formatters
 *
 *  Differences from the reference are only where the data shape differs: this
 *  visual is categorical rather than matrix, so the tree is two levels -
 *  selected dimension -> legend series.
 */
import powerbi from "powerbi-visuals-api";
import ISelectionId = powerbi.visuals.ISelectionId;
import VisualObjectInstance = powerbi.VisualObjectInstance;

/*
 * Tabulator, assembled from the modules this grid actually uses rather than the
 * TabulatorFull bundle.
 *
 * TabulatorFull carries the Ajax module and the remote list-editor, and both call
 * `fetch`. Nothing here ever reaches them - the grid is handed its rows directly
 * and has no editable cells - but their code still landed in the compiled bundle,
 * where `pbiviz package --certification-audit` counted two external requests and
 * failed. Microsoft's certification rules forbid `fetch` outright, so the fix is to
 * leave those modules out of the build instead of shipping unreachable code that
 * looks like a network call.
 *
 * Also left out: Persistence (it writes to localStorage), Download / Export /
 * Print / Clipboard (this visual exports through the host's own download service,
 * see exportCsv), and the grouping, row-move, history, range-select and
 * spreadsheet modules, none of which this grid turns on. Everything the grid does
 * use is registered below.
 */
import {
    Tabulator as TabulatorCore,
    ColumnCalcsModule,
    DataTreeModule,
    FilterModule,
    FormatModule,
    FrozenColumnsModule,
    InteractionModule,
    KeybindingsModule,
    PageModule,
    ResizeColumnsModule,
    ResizeTableModule,
    ResponsiveLayoutModule,
    SelectRowModule,
    SortModule,
    TooltipModule
} from "tabulator-tables";

TabulatorCore.registerModule([
    ColumnCalcsModule,
    DataTreeModule,
    FilterModule,
    FormatModule,
    FrozenColumnsModule,
    InteractionModule,
    KeybindingsModule,
    PageModule,
    ResizeColumnsModule,
    ResizeTableModule,
    ResponsiveLayoutModule,
    SelectRowModule,
    SortModule,
    TooltipModule
]);

const Tabulator = TabulatorCore;

import { VisualSettings, colorOf } from "./settings";
import { CategoryDatum, ChartModel } from "./dataModel";
import { DetailModel, DetailNode } from "./detailTable";
import { clearNode, createFormatter, cssFont, IValueFormatter } from "./utils";
import { ChartCallbacks, Theme } from "./chart";

/* icons: inline SVG rather than FontAwesome, so the package carries no webfont */
const SVG_NS = "http://www.w3.org/2000/svg";
const PATH_SEARCH =
    "M11.3 10.3a5 5 0 1 0-1 1l3.2 3.2a.7.7 0 1 0 1-1l-3.2-3.2zM7 10.5A3.5 3.5 0 1 1 7 3.5a3.5 3.5 0 0 1 0 7z";

function iconElement(pathData: string, size: number): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("d", pathData);
    svg.appendChild(path);
    return svg;
}
const ICON_CHEVRON_DOWN =
    '<svg class="dbx-tree-chevron" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M2.6 5.2a.8.8 0 0 1 1.1 0L8 9.4l4.3-4.2a.8.8 0 1 1 1.1 1.1l-4.8 4.8a.8.8 0 0 1-1.1 0L2.6 6.3a.8.8 0 0 1 0-1.1z"/></svg>';
const ICON_CHEVRON_UP =
    '<svg class="dbx-tree-chevron" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M13.4 10.8a.8.8 0 0 1-1.1 0L8 6.6l-4.3 4.2a.8.8 0 1 1-1.1-1.1l4.8-4.8a.8.8 0 0 1 1.1 0l4.9 4.8a.8.8 0 0 1 0 1.1z"/></svg>';

export interface TableColumnMeta {
    columnWidth: { id: string; width: number }[];
    columnSort: { column: string; dir: string }[];
}

export interface TableHost {
    persistProperties: (changes: powerbi.VisualObjectInstancesToPersist) => void;
    getColumnMetadata: () => TableColumnMeta;
    setColumnMetadata: (meta: TableColumnMeta) => void;
    /** "Bar" / "URL" flags resolved per value column, keyed by column field */
    cellFormatFor: (field: string) => { bar: boolean; url: boolean };
    /**
     * Hand a CSV of what the grid is showing to the host's download service.
     * Returns false when the host has not granted the export privilege, in which
     * case the button is not drawn at all.
     */
    exportCsv?: (csv: string, fileName: string) => boolean;
    canExport?: () => boolean;
}

const NAME_FIELD = "name";

/** RFC-4180 cell: quote when the text holds a comma, quote or newline */
function csvCell(text: string): string {
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

interface TabRow {
    [k: string]: unknown;
    name: string;
    _children?: TabRow[];
}

/* ------------------------------------------------------------------ */
/* row / column construction                                           */
/* ------------------------------------------------------------------ */

function buildRows(
    model: ChartModel,
    fmt: IValueFormatter,
    showTotalColumn: boolean,
    totalLabel: string
): TabRow[] {
    const multiSeries = model.series.length > 1;

    return model.categories.map((cat: CategoryDatum) => {
        const row: TabRow = { name: cat.label };

        model.series.forEach((s) => {
            const cell = cat.cells.filter((c) => c.seriesIndex === s.index)[0];
            row[s.label] = cell ? cell.value : null;
        });
        if (showTotalColumn && multiSeries) {
            row[totalLabel] = cat.total;
        }
        row.__selectionIds = (cat as unknown as { allSelectionIds: ISelectionId[] }).allSelectionIds || [
            cat.selectionId
        ];
        row.__uid = cat.key;
        row.__rowIndices = cat.rowIndices || [];
        row.driver = false;

        /* second level: one child row per legend segment */
        if (multiSeries) {
            row._children = model.series
                .map((s) => {
                    const cell = cat.cells.filter((c) => c.seriesIndex === s.index)[0];
                    if (!cell) {
                        return null;
                    }
                    const child: TabRow = { name: s.label };
                    model.series.forEach((s2) => {
                        child[s2.label] = s2.index === s.index ? cell.value : null;
                    });
                    if (showTotalColumn) {
                        child[totalLabel] = cell.value;
                    }
                    child.__selectionIds =
                        (cell as unknown as { allSelectionIds: ISelectionId[] }).allSelectionIds || [
                            cell.selectionId
                        ];
                    child.__uid = `${cat.key}~${s.label}`;
                    child.__rowIndices = cell.rowIndices || [];
                    child.driver = false;
                    return child;
                })
                .filter(Boolean) as TabRow[];
        }

        void fmt;
        return row;
    });
}

/*
 * Detail mode: the Table rows / Table columns wells drive the grid, so the row
 * field is the primary column exactly as `Rows` is in tableDarwinbox, and the
 * chart's dimension has nothing to do with it.
 */
function buildDetailRows(detail: DetailModel): TabRow[] {
    const walk = (nodes: DetailNode[]): TabRow[] =>
        nodes.map((n) => {
            const row: TabRow = { name: n.label };
            Object.keys(n.values).forEach((k) => (row[k] = n.values[k] as unknown));
            /* keep the underlying value so date / number columns sort correctly
               while the displayed (and searchable) text stays formatted */
            Object.keys(n.raw || {}).forEach((k) => (row[`__raw_${k}`] = n.raw[k] as unknown));
            row.__selectionIds = n.selectionIds;
            row.__rowIndices = n.rowIndices || [];
            row.__uid = n.key;
            row.driver = false;
            if (n.children && n.children.length) {
                row._children = walk(n.children);
            }
            return row;
        });
    return walk(detail.nodes);
}

/** date / number aware comparison, falling back to locale string compare */
function compareRaw(a: unknown, b: unknown): number {
    const nil = (v: unknown) => v === null || v === undefined || v === "";
    if (nil(a) && nil(b)) {
        return 0;
    }
    if (nil(a)) {
        return -1;
    }
    if (nil(b)) {
        return 1;
    }
    const da = a instanceof Date ? a.getTime() : null;
    const db = b instanceof Date ? b.getTime() : null;
    if (da !== null && db !== null) {
        return da - db;
    }
    if (typeof a === "number" && typeof b === "number") {
        return a - b;
    }
    return String(a).localeCompare(String(b));
}

function countTotalRows(rows: TabRow[]): number {
    let count = 0;
    rows.forEach((r) => {
        count += 1;
        if (r._children) {
            count += countTotalRows(r._children);
        }
    });
    return count;
}

/* ------------------------------------------------------------------ */
/* main render                                                         */
/* ------------------------------------------------------------------ */

export interface TableInstance {
    destroy: () => void;
}

export function renderTable(
    root: HTMLElement,
    model: ChartModel,
    settings: VisualSettings,
    width: number,
    height: number,
    cb: ChartCallbacks,
    theme: Theme,
    host: TableHost,
    detail: DetailModel | null,
    /** source rows of the clicked mark; null when the grid shows everything */
    selectedRows: number[] = null
): TableInstance {
    clearNode(root);
    root.style.width = `${width}px`;
    root.style.height = `${height}px`;
    root.style.overflow = "hidden";
    root.style.display = "flex";
    root.style.flexDirection = "column";
    root.style.position = "relative";

    const detailMode = !!(detail && detail.rowLevels.length && detail.nodes.length);
    if (!detailMode && (!model || !model.categories.length)) {
        return { destroy: () => undefined };
    }

    const searchSetting = settings.searchSetting;
    const columnSetting = settings.column;
    const rowSetting = settings.row;
    const tableSettings = settings.tableSetting;

    const rowBack = theme.isHighContrast ? theme.background : colorOf(rowSetting.backColor);
    const rowFore = theme.isHighContrast ? theme.foreground : colorOf(rowSetting.color);
    const colBack = theme.isHighContrast ? theme.background : colorOf(columnSetting.backColor);
    const colFore = theme.isHighContrast ? theme.foreground : colorOf(columnSetting.color);
    const selectedBack = theme.isHighContrast
        ? theme.foregroundSelected
        : colorOf(rowSetting.selectedBackColor);

    const measureFormat = detailMode
        ? (detail.measureColumns[0] ? detail.measureColumns[0].format : undefined)
        : model.measureFormat;
    const fmt = createFormatter(
        measureFormat,
        Number(rowSetting.unit.value) || 1,
        rowSetting.dataPrecision.value,
        !detailMode && model.categories[0] ? model.categories[0].total : 0
    );

    /* ------------------------------------------------ search bar */
    let searchText = "";
    let searchTimer: ReturnType<typeof setTimeout> = null;
    let searchInput: HTMLInputElement = null;

    if (searchSetting.show.value) {
        const bar = document.createElement("div");
        bar.className = "dbx-searchBar";
        bar.style.width = `${searchSetting.width.value}px`;
        bar.style.background = theme.isHighContrast ? theme.background : colorOf(searchSetting.backColor);
        bar.style.borderColor = theme.isHighContrast
            ? theme.foreground
            : colorOf(searchSetting.borderColor);

        const icon = document.createElement("div");
        icon.className = "dbx-searchIcon";
        icon.appendChild(iconElement(PATH_SEARCH, 16));
        icon.style.color = theme.isHighContrast ? theme.foreground : colorOf(searchSetting.color);
        icon.style.background = theme.isHighContrast
            ? theme.background
            : colorOf(searchSetting.backColor);
        bar.appendChild(icon);

        searchInput = document.createElement("input");
        searchInput.className = "dbx-searchInput";
        searchInput.type = "text";
        searchInput.placeholder = searchSetting.placeholder.value || "Search";
        searchInput.setAttribute("aria-label", searchSetting.placeholder.value || "Search");
        const f = cssFont(searchSetting.font);
        Object.keys(f).forEach((k) => searchInput.style.setProperty(k, f[k]));
        /* the reference visual sizes the search bar in px, not pt - keep that */
        searchInput.style.fontSize = `${searchSetting.font.fontSize.value}px`;
        searchInput.style.color = theme.isHighContrast ? theme.foreground : colorOf(searchSetting.color);
        searchInput.style.background = theme.isHighContrast
            ? theme.background
            : colorOf(searchSetting.backColor);
        searchInput.style.borderLeftColor = theme.isHighContrast
            ? theme.foreground
            : colorOf(searchSetting.borderColor);
        bar.appendChild(searchInput);

        root.appendChild(bar);
    }

    /* ------------------------------------------------ container */
    const container = document.createElement("div");
    container.className = "dbx-table-container";
    root.appendChild(container);

    /*
     * Export lives on the search row when there is one, so it costs no height; with
     * the search bar switched off it gets a thin strip of its own.
     */
    const wantExport =
        tableSettings.showExport.value && (!host.canExport || host.canExport());
    let exportHost: HTMLElement = null;
    if (wantExport) {
        const searchBar = root.querySelector(".dbx-searchBar") as HTMLElement;
        if (searchBar) {
            searchBar.style.display = "flex";
            searchBar.style.alignItems = "center";
            exportHost = searchBar;
        } else {
            const strip = document.createElement("div");
            strip.className = "dbx-table-actions";
            root.insertBefore(strip, container);
            exportHost = strip;
        }
    }

    /* ------------------------------------------------ columns */
    const savedMeta = host.getColumnMetadata();
    const getCustomWidth = (id: string): number => {
        const found = savedMeta.columnWidth.filter((c) => c.id === id)[0];
        return found ? found.width : undefined;
    };

    const barColor = colorOf(settings.cellFormatting.backColor) || "#0183FF";

    /** in-cell progress bar, same markup as the reference visual */
    const progressFormatter = (cell: {
        getValue: () => number;
        getField: () => string;
        getTable: () => { getData: () => Record<string, number>[] };
    }): Node => {
        const value = cell.getValue();
        const field = cell.getField();
        const data = cell.getTable().getData();
        /* use magnitude so an all-negative (or mixed-sign) column still scales sensibly
           instead of every bar collapsing to 0% because Math.max floors at 0 */
        const maxValue = data.reduce((max, r) => Math.max(max, Math.abs(Number(r[field]) || 0)), 0);
        const percentage = maxValue ? (Math.abs(Number(value)) / maxValue) * 100 : 0;
        const shown = value === null || value === undefined ? "" : fmt.format(Number(value));

        /*
         * Built as nodes rather than as an HTML string. A formatter that returns a
         * string has that string written into the cell with innerHTML, which would
         * put formatted cell values - user data - through an HTML parser. Setting
         * textContent and style properties instead means no markup is ever parsed,
         * which is what the certification rules ask for and what the link formatter
         * below already does.
         */
        const wrap = document.createElement("div");
        wrap.style.position = "relative";
        wrap.style.width = "100%";
        wrap.style.height = "100%";
        wrap.style.textAlign = "center";

        const track = document.createElement("div");
        track.style.width = "100%";
        track.style.height = "100%";
        track.style.backgroundColor = "#f4f4f4";

        const bar = document.createElement("div");
        bar.style.width = `${percentage}%`;
        bar.style.height = "100%";
        bar.style.opacity = "0.6";
        bar.style.backgroundColor = barColor;
        track.appendChild(bar);

        const label = document.createElement("div");
        label.style.position = "absolute";
        label.style.top = "0";
        label.style.left = "0";
        label.style.width = "100%";
        label.style.height = "100%";
        label.style.display = "flex";
        label.style.alignItems = "center";
        label.style.justifyContent = "flex-end";
        label.style.paddingRight = "8px";
        label.style.pointerEvents = "none";
        label.textContent = shown;

        wrap.appendChild(track);
        wrap.appendChild(label);
        return wrap;
    };

    /* URL scheme allow-list for the "link" cell formatter - a bare value like
       `javascript:...` must never reach an anchor's href */
    const SAFE_URL_SCHEME = /^(https?:|mailto:)/i;

    /** in-cell hyperlink; sanitizes the scheme instead of trusting Tabulator's
        built-in "link" formatter, which sets href directly from the cell value */
    const linkFormatter = (cell: { getValue: () => unknown }): string | Node => {
        const raw = cell.getValue();
        const text = raw === null || raw === undefined ? "" : String(raw);
        if (!text) {
            return "";
        }
        const trimmed = text.trim();
        if (!SAFE_URL_SCHEME.test(trimmed)) {
            return document.createTextNode(text);
        }
        const a = document.createElement("a");
        a.href = trimmed;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = text;
        return a;
    };

    /*
     * Columns carry a key (the Tabulator field, unique per model field) and a
     * label (the header text). They differ in detail mode, where two fields may
     * share a display name.
     */
    interface ColSpec {
        key: string;
        label: string;
    }
    const valueFields: ColSpec[] = detailMode
        ? detail.measureColumns.map((m) => ({ key: m.key, label: m.label }))
        : model.series.map((s) => ({ key: s.label, label: s.label }));
    if (!detailMode && tableSettings.showTotalColumn.value && model.series.length > 1) {
        const t = tableSettings.totalLabel.value || "Total";
        valueFields.push({ key: t, label: t });
    }
    /* attribute columns sit between the frozen row column and the measures */
    const attributeFields: ColSpec[] = detailMode
        ? detail.attributeColumns.map((a) => ({ key: a.key, label: a.label }))
        : [];

    /*
     * With measures excluded from the detail table there may be nothing numeric to
     * total, in which case the Total strip would render as an empty band.
     */
    const numericAttrKeys: string[] = detailMode
        ? detail.attributeColumns.filter((a) => a.isNumeric).map((a) => a.key)
        : [];
    const useTotals =
        tableSettings.showTotalRow.value && valueFields.length + numericAttrKeys.length > 0;

    const primaryTitle = detailMode
        ? detail.rowLevels[0].label
        : model.activeAxis
        ? model.activeAxis.label
        : "Category";

    const columns: Record<string, unknown>[] = [
        {
            title: primaryTitle,
            field: NAME_FIELD,
            frozen: true,
            formatter: null,
            width: getCustomWidth(NAME_FIELD),
            headerSort: true,
            hozAlign: rowSetting.textAlignment.value || "left",
            headerHozAlign: columnSetting.textAlignment.value || "left",
            sorter: (a: string, b: string) => String(a).localeCompare(String(b)),
            bottomCalc: useTotals ? () => tableSettings.totalLabel.value || "Total" : undefined
        }
    ];

    attributeFields.forEach((spec) => {
        const field = spec.key;
        const cf = host.cellFormatFor(field);
        const totalsThisColumn = useTotals && numericAttrKeys.indexOf(field) !== -1;
        columns.push({
            title: spec.label,
            field,
            frozen: false,
            formatter: cf.url ? linkFormatter : null,
            width: getCustomWidth(field),
            headerSort: true,
            hozAlign: rowSetting.textAlignment.value || "left",
            headerHozAlign: columnSetting.textAlignment.value || "left",
            /* only numeric attribute columns get a total, and only they get the
               number formatter - otherwise text columns would show "0" */
            bottomCalc: totalsThisColumn
                ? (values: unknown[], data: Record<string, unknown>[]) =>
                      data.reduce((sum, r) => sum + (Number(r[`__raw_${field}`]) || 0), 0)
                : undefined,
            bottomCalcFormatter: totalsThisColumn
                ? (cell: { getValue: () => number }) => fmt.format(Number(cell.getValue()) || 0)
                : undefined,
            sorter: (
                a: unknown,
                b: unknown,
                aRow: { getData: () => Record<string, unknown> },
                bRow: { getData: () => Record<string, unknown> }
            ) => {
                const ra = aRow ? aRow.getData()[`__raw_${field}`] : a;
                const rb = bRow ? bRow.getData()[`__raw_${field}`] : b;
                return compareRaw(ra, rb);
            }
        });
    });

    valueFields.forEach((spec) => {
        const field = spec.key;
        const cf = host.cellFormatFor(field);
        let formatter: unknown = (cell: { getValue: () => number }) => {
            const v = cell.getValue();
            return v === null || v === undefined ? "" : fmt.format(Number(v));
        };
        if (cf.bar) {
            formatter = progressFormatter;
        } else if (cf.url) {
            formatter = linkFormatter;
        }

        columns.push({
            title: spec.label,
            field,
            frozen: false,
            formatter,
            width: getCustomWidth(field),
            headerSort: true,
            hozAlign: cf.bar ? "left" : "right",
            headerHozAlign: columnSetting.textAlignment.value || "left",
            sorter: (a: number, b: number) => (Number(a) || 0) - (Number(b) || 0),
            bottomCalc: useTotals ? "sum" : undefined,
            bottomCalcFormatter: (cell: { getValue: () => number }) => fmt.format(Number(cell.getValue()) || 0)
        });
    });

    /* ------------------------------------------------ data */
    const allRows = detailMode
        ? buildDetailRows(detail)
        : buildRows(
              model,
              fmt,
              tableSettings.showTotalColumn.value,
              tableSettings.totalLabel.value || "Total"
          );

    /*
     * Clicking a column and switching to the table should land on the rows behind
     * that column. Identities cannot express that - a mark's identity carries the
     * series scope and a table row's does not, so the two lists never compare equal -
     * so both halves carry the source rows they were built from and the filter is
     * their intersection. A parent survives if it or any of its children do.
     */
    const wanted: { [row: number]: boolean } = {};
    (selectedRows || []).forEach((i) => (wanted[i] = true));
    const keepRow = (r: TabRow): boolean => {
        const rows = (r.__rowIndices as number[]) || [];
        for (let i = 0; i < rows.length; i++) {
            if (wanted[rows[i]]) {
                return true;
            }
        }
        return false;
    };
    const filterTree = (rows: TabRow[]): TabRow[] => {
        const out: TabRow[] = [];
        rows.forEach((r) => {
            if (keepRow(r)) {
                out.push(r);
                return;
            }
            const kids = r._children ? filterTree(r._children as TabRow[]) : [];
            if (kids.length) {
                const copy: TabRow = { name: r.name };
                Object.keys(r).forEach((k) => (copy[k] = r[k]));
                copy._children = kids;
                out.push(copy);
            }
        });
        return out;
    };

    const filterBySelection = !!(selectedRows && selectedRows.length);
    const filtered = filterBySelection ? filterTree(allRows) : allRows;
    /* a selection that matches nothing here leaves the grid as it was */
    const data = filterBySelection && !filtered.length ? allRows : filtered;
    const totalRowCount = countTotalRows(data);

    /*
     * Tabulator's row-selection module calls into the data-tree module when
     * dataTreeSelectPropagate is on. With a flat grid (single Table rows level,
     * or no legend) the tree module never initialises the row, so the propagate
     * flag has to follow dataTree exactly.
     */
    const useTree = detailMode ? detail.rowLevels.length > 1 : model.series.length > 1;

    const isSmallWidth = width < 550;
    const isHidePageSelector = width < 275;
    const usePagination = tableSettings.showPagination.value;

    /* click-outside handlers registered for the page-size popup, removed on destroy */
    const outsideHandlers: ((e: MouseEvent) => void)[] = [];

    /* ------------------------------------------------ tabulator */
    const tabulator = new Tabulator(container, {
        height: "100%",
        data,
        columns,
        dataTreeChildIndent: 20,
        responsiveLayoutCollapseUseFormatters: true,
        dataTree: useTree,
        dataTreeStartExpanded: !!tableSettings.startExpanded.value,
        dataTreeBranchElement: false,
        dataTreeSelectPropagate: useTree,
        dataTreeCollapseElement: ICON_CHEVRON_UP,
        dataTreeExpandElement: ICON_CHEVRON_DOWN,
        dataTreeElementColumn: NAME_FIELD,
        /* Tabulator 6 renamed rowSelection -> selectableRows; the reference visual
           still passes the old name, which silently disables selection */
        selectableRows: true,
        rowHeight: rowSetting.rowHeight.value,
        pagination: usePagination,
        paginationSize: tableSettings.paginationSize.value,
        paginationSizeSelector: false,
        paginationButtonCount: isSmallWidth ? 1 : 3,
        autoColumns: false,
        /*
         * Column fields are query names like "Function Mapping.Department", and
         * Tabulator would otherwise read the dots as a nested object path.
         */
        nestedFieldSeparator: false,
        columnCalcs: useTotals ? "both" : false,
        rowHeader: tableSettings.hideCheckBox.value
            ? false
            : {
                  headerSort: false,
                  resizable: false,
                  frozen: true,
                  headerHozAlign: "justify",
                  hozAlign: "left",
                  formatter: "rowSelection",
                  titleFormatter: "rowSelection",
                  cellClick: (e: Event, cell: { getRow: () => { toggleSelect: () => void } }) => {
                      cell.getRow().toggleSelect();
                  }
              },
        paginationCounter: (shown: number) => `${shown} of ${totalRowCount} records`,
        layout: "fitDataFill",
        rowFormatter: (row: {
            getElement: () => HTMLElement;
            getData: () => TabRow;
            getPosition: () => number;
        }) => {
            const el = row.getElement();
            const d = row.getData();
            el.style.height = `${rowSetting.rowHeight.value}px`;
            const banded = rowSetting.bandedRows.value && row.getPosition() % 2 === 0;
            el.style.backgroundColor = banded ? colorOf(rowSetting.alternateBackColor) : rowBack;
            if (d._children && d._children.length > 0) {
                el.classList.add("parent-row");
            } else {
                el.classList.add("lastChild-row");
            }
        },
        locale: "en-gb",
        langs: {
            "en-gb": {
                pagination: {
                    prev: "<",
                    prev_title: "<",
                    next: ">",
                    next_title: ">",
                    page_size: isSmallWidth ? "" : "Rows per page"
                }
            }
        },
        initialSort: savedMeta.columnSort.map((m) => ({ column: m.column, dir: m.dir }))
    } as unknown as Record<string, unknown>);

    /* ------------------------------------------------ export */
    /*
     * Power BI's own "Export data" returns the query behind the visual, which is
     * coarser than this grid: every date for every row, zeros included, and no idea
     * that a chart selection is in force. This exports exactly what is on screen.
     */
    const csvOfShownRows = (): string => {
        const cols = columns.filter((c) => !!(c as { field?: string }).field);
        const head = cols.map((c) => csvCell(String((c as { title?: string }).title || "")));
        const lines = [head.join(",")];
        const walk = (rows: TabRow[], depth: number): void => {
            rows.forEach((r) => {
                lines.push(
                    cols
                        .map((c, i) => {
                            const f = (c as { field: string }).field;
                            const v = r[f];
                            const text = v === null || v === undefined ? "" : String(v);
                            /* keep the nesting readable in a flat file */
                            return csvCell(i === 0 && depth ? `${new Array(depth + 1).join("  ")}${text}` : text);
                        })
                        .join(",")
                );
                if (r._children && r._children.length) {
                    walk(r._children as TabRow[], depth + 1);
                }
            });
        };
        walk(data, 0);
        return lines.join("\r\n");
    };

    if (exportHost) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "dbx-export-btn";
        btn.textContent = tableSettings.exportText.value || "Export";
        const f = cssFont(columnSetting.font);
        Object.keys(f).forEach((k) => btn.style.setProperty(k, f[k]));
        btn.style.color = theme.isHighContrast ? theme.foreground : colorOf(columnSetting.color);
        btn.onclick = () => {
            if (!host.exportCsv) {
                return;
            }
            const title = (tableSettings.titleText.value || "table").replace(/[^\w -]+/g, "");
            host.exportCsv(csvOfShownRows(), `${title || "table"}.csv`);
        };
        exportHost.appendChild(btn);
    }

    /* ------------------------------------------------ selection */
    let selectedIds: ISelectionId[] = [];
    /*
     * Destroying a Tabulator fires rowDeselected for every selected row. Without
     * this guard that feedback would clear the report-wide selection every time
     * the grid is rebuilt.
     */
    let destroyed = false;

    const idsOf = (row: { getData: () => TabRow }): ISelectionId[] =>
        (row.getData().__selectionIds as ISelectionId[]) || [];

    /*
     * selectedIds is the authoritative list for this table, so push it as a
     * replacement (multi = false). Unioning would make deselection impossible.
     */
    const pushSelection = (): void => {
        cb.onSelect(selectedIds, false);
    };

    const updateSelection = (row: { getData: () => TabRow; getElement: () => HTMLElement }, add: boolean): void => {
        if (destroyed) {
            return;
        }
        const ids = idsOf(row);
        if (add) {
            ids.forEach((id) => {
                if (selectedIds.indexOf(id) === -1) {
                    selectedIds.push(id);
                }
            });
            row.getElement().style.backgroundColor = selectedBack;
        } else {
            selectedIds = selectedIds.filter((id) => ids.indexOf(id) === -1);
            row.getElement().style.backgroundColor = rowBack;
        }
        pushSelection();
    };

    /*
     * Tabulator's own selectableRows handling already toggles a row on click and
     * on the checkbox cell, so rowSelected / rowDeselected are the single source
     * of truth here. Adding a rowClick toggle on top would double-toggle and the
     * row would never stay selected.
     */
    tabulator.on("rowSelected", (row) => updateSelection(row, true));
    tabulator.on("rowDeselected", (row) => updateSelection(row, false));

    tabulator.on("rowContext", (e: MouseEvent, row: { getData: () => TabRow }) => {
        e.preventDefault();
        const ids = idsOf(row);
        cb.onContextMenu(ids[0], e.clientX, e.clientY);
    });

    /* ------------------------------------------------ styling hooks */
    const applyStyles = (): void => {
        const q = (sel: string) => Array.from(container.querySelectorAll(sel)) as HTMLElement[];
        const colFontCss = cssFont(columnSetting.font);
        const rowFontCss = cssFont(rowSetting.font);

        q(".tabulator-header").forEach((el) => (el.style.background = colBack));
        q(".tabulator-col").forEach((el) => {
            el.style.background = colBack;
            el.style.color = colFore;
            Object.keys(colFontCss).forEach((k) => el.style.setProperty(k, colFontCss[k]));
            el.style.textAlign = columnSetting.textAlignment.value || "left";
        });
        q(".tabulator-col-content").forEach((el) => (el.style.background = colBack));
        q(".tabulator-header-contents").forEach((el) => {
            el.style.borderBottom = "solid";
            el.style.borderBottomWidth = "2.5px";
            el.style.borderBottomColor = theme.isHighContrast
                ? theme.foreground
                : colorOf(columnSetting.borderColor);
        });
        q(".tabulator-tableholder").forEach((el) => {
            el.style.color = rowFore;
            el.style.backgroundColor = rowBack;
            Object.keys(rowFontCss).forEach((k) => el.style.setProperty(k, rowFontCss[k]));
        });
        q(".tabulator-row").forEach((el) => {
            el.style.fontSize = `${rowSetting.font.fontSize.value}pt`;
        });
        q(".tabulator-row .tabulator-cell").forEach((el) => {
            el.style.textDecoration = rowSetting.font.underline.value ? "underline" : "none";
        });
        q(".tabulator-footer").forEach((el) => (el.style.background = rowBack));
        q(".tabulator-row-header").forEach((el) => (el.style.background = rowBack));
        q(".tabulator-calcs-bottom").forEach((el) => {
            el.style.background = colBack;
            el.style.color = colFore;
            el.style.fontWeight = "bold";
        });
        q(".tabulator-page-counter").forEach(
            (el) => (el.style.fontSize = isSmallWidth ? "10px" : "15px")
        );
        q(".tabulator-page-size").forEach((el) => (el.style.fontSize = isSmallWidth ? "9px" : "12px"));
        q(".tabulator-page").forEach((el) => (el.style.fontSize = isSmallWidth ? "7pt" : "9pt"));

        /* zero-pad the numbered page buttons and add the "..." overflow marker */
        const pages = q(".tabulator-page");
        pages.forEach((el) => {
            const p = el.getAttribute("data-page");
            if (p && /^\d+$/.test(p) && parseInt(p, 10) < 10) {
                el.textContent = `0${p}`;
            }
        });
        const maxPage = (tabulator as unknown as { getPageMax: () => number }).getPageMax
            ? (tabulator as unknown as { getPageMax: () => number }).getPageMax()
            : 1;
        q(".pageMore").forEach((el) => el.remove());
        const pagesHolder = container.querySelector(".tabulator-pages") as HTMLElement;
        if (pagesHolder) {
            const more = document.createElement("span");
            more.textContent = "...";
            more.className = "pageMore";
            more.style.display = maxPage < 4 || isSmallWidth ? "none" : "inline-block";
            pagesHolder.appendChild(more);
        }
    };

    tabulator.on("renderComplete", applyStyles);
    tabulator.on("scrollVertical", () => {
        const rows = Array.from(
            container.querySelectorAll(".tabulator-row .tabulator-cell")
        ) as HTMLElement[];
        rows.forEach((el) => {
            el.style.textDecoration = rowSetting.font.underline.value ? "underline" : "none";
        });
    });

    /* ------------------------------------------------ footer extras */
    tabulator.on("tableBuilt", () => {
        applyStyles();
        if (!usePagination) {
            return;
        }
        const t = tabulator as unknown as {
            getPageMax: () => number;
            getPageSize: () => number;
            setPageSize: (n: number) => void;
        };
        const maxPage = t.getPageMax();

        const lastBtn = Array.from(container.querySelectorAll(".tabulator-page")).filter(
            (el) => el.getAttribute("data-page") === "last"
        )[0] as HTMLElement;
        if (lastBtn) {
            lastBtn.textContent = maxPage < 10 ? `0${maxPage}` : String(maxPage);
            lastBtn.style.display = maxPage < 4 || isSmallWidth ? "none" : "inline-block";
        }
        const nextBtn = Array.from(container.querySelectorAll(".tabulator-page")).filter(
            (el) => el.getAttribute("data-page") === "next"
        )[0] as HTMLElement;
        if (nextBtn) {
            nextBtn.style.transform =
                maxPage < 4 || isSmallWidth ? "translateX(-10px)" : "translateX(45px)";
        }

        const footer = container.querySelector(".tabulator-paginator") as HTMLElement;
        if (footer && !footer.querySelector(".tabulator-page-size")) {
            const dropdownContainer = document.createElement("div");
            dropdownContainer.classList.add("tabulator-page-size");
            dropdownContainer.style.display = isHidePageSelector ? "none" : "block";

            const dropdownLabel = document.createElement("div");
            dropdownLabel.classList.add("select");
            dropdownLabel.style.position = "relative";
            dropdownLabel.style.cursor = "pointer";

            const labelText = document.createElement("span");
            labelText.classList.add("selectText");
            labelText.textContent = String(t.getPageSize());

            const dropdownIcon = document.createElement("span");
            dropdownIcon.classList.add("dropdown-icon");
            dropdownIcon.textContent = "▼";

            dropdownLabel.appendChild(labelText);
            dropdownLabel.appendChild(dropdownIcon);

            const dropdownOptions = document.createElement("div");
            dropdownOptions.classList.add("option");
            dropdownOptions.style.display = "none";

            [10, 20, 50, 100].forEach((option) => {
                const optionDiv = document.createElement("div");
                optionDiv.classList.add("custom-dropdown-option");
                optionDiv.textContent = String(option);
                optionDiv.addEventListener("click", () => {
                    t.setPageSize(option);
                    labelText.textContent = String(option);
                    dropdownOptions.style.display = "none";
                });
                dropdownOptions.appendChild(optionDiv);
            });

            dropdownLabel.appendChild(dropdownOptions);
            dropdownContainer.appendChild(dropdownLabel);

            dropdownLabel.addEventListener("click", (event) => {
                event.stopPropagation();
                dropdownOptions.style.display =
                    dropdownOptions.style.display === "none" ? "block" : "none";
            });
            const outsideClick = (event: MouseEvent) => {
                if (!dropdownContainer.contains(event.target as Node)) {
                    dropdownOptions.style.display = "none";
                }
            };
            document.addEventListener("click", outsideClick);
            outsideHandlers.push(outsideClick);

            const perPageText = document.createElement("span");
            perPageText.classList.add("label");
            perPageText.textContent = "Rows per page";
            perPageText.style.display = isSmallWidth ? "none" : "inline";
            footer.appendChild(perPageText);
            footer.appendChild(dropdownContainer);
        }
    });

    tabulator.on("pageSizeChanged", (newPageSize: number) => {
        const instance: VisualObjectInstance = {
            objectName: "tableSetting",
            selector: undefined,
            properties: { paginationSize: newPageSize }
        };
        host.persistProperties({ merge: [instance] });
    });

    /* ------------------------------------------------ persist widths / sort */
    tabulator.on("columnResized", (column: { getField: () => string; getWidth: () => number }) => {
        const field = column.getField();
        const updatedWidth = column.getWidth();
        const meta = host.getColumnMetadata();
        const idx = meta.columnWidth.findIndex((el) => el.id === field);
        if (idx === -1) {
            meta.columnWidth.push({ id: field, width: updatedWidth });
        } else {
            meta.columnWidth[idx].width = updatedWidth;
        }
        host.setColumnMetadata(meta);
    });

    let sortTimer: ReturnType<typeof setTimeout> = null;
    tabulator.on("dataSorted", (sorters: { field: string; dir: string }[]) => {
        clearTimeout(sortTimer);
        sortTimer = setTimeout(() => {
            if (!sorters || !sorters.length) {
                return;
            }
            const meta = host.getColumnMetadata();
            meta.columnSort = [{ column: sorters[0].field, dir: sorters[0].dir }];
            host.setColumnMetadata(meta);
        }, 1000);
    });

    /* ------------------------------------------------ search behaviour */
    const customFilter = (rowData: Record<string, unknown>): boolean => {
        if (!searchText) {
            delete rowData.driver;
            return true;
        }
        let found = false;
        const checkData = (item: unknown): boolean => {
            if (item === null || item === undefined) {
                return false;
            }
            if (typeof item === "string") {
                return item.toLowerCase().indexOf(searchText) !== -1;
            }
            if (typeof item === "number") {
                return String(item).indexOf(searchText) !== -1;
            }
            if (Array.isArray(item)) {
                return item.some(checkData);
            }
            if (typeof item === "object") {
                return Object.keys(item).some((k) => {
                    if (k.indexOf("__") === 0 || k === "driver") {
                        return false;
                    }
                    return checkData((item as Record<string, unknown>)[k]);
                });
            }
            return false;
        };
        found = checkData(rowData);
        if (found) {
            rowData.driver = true;
        } else {
            delete rowData.driver;
        }
        return found;
    };

    const expandParents = (row: {
        getTreeParent: () => unknown;
    }): void => {
        let parent = row.getTreeParent() as {
            isTreeExpanded: () => boolean;
            treeExpand: () => void;
            getTreeParent: () => unknown;
        } | false;
        while (parent) {
            if (!parent.isTreeExpanded()) {
                parent.treeExpand();
            }
            parent = parent.getTreeParent() as typeof parent;
        }
    };

    const expandChildren = (row: {
        getTreeChildren: () => { isTreeExpanded: () => boolean; treeExpand: () => void; getTreeChildren: () => unknown[] }[];
    }): void => {
        const children = row.getTreeChildren();
        if (children && children.length) {
            children.forEach((child) => {
                if (!child.isTreeExpanded()) {
                    child.treeExpand();
                }
                expandChildren(child as unknown as Parameters<typeof expandChildren>[0]);
            });
        }
    };

    const collapseAllRows = (): void => {
        if (!useTree) {
            return;
        }
        (tabulator.getRows() as { isTreeExpanded: () => boolean; treeCollapse: () => void }[]).forEach(
            (row) => {
                if (row.isTreeExpanded()) {
                    row.treeCollapse();
                }
            }
        );
    };

    if (searchInput) {
        searchInput.addEventListener("input", () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                searchText = searchInput.value.toLowerCase();
                tabulator.setFilter(customFilter as never);
                /* the expand/collapse pass only applies to a tree; on a flat grid
                   Tabulator's data-tree module is not initialised per row */
                if (!useTree) {
                    return;
                }
                if (searchText.length >= 3) {
                    (tabulator.getRows() as {
                        getData: () => TabRow;
                        isTreeExpanded: () => boolean;
                        treeExpand: () => void;
                        treeCollapse: () => void;
                    }[]).forEach((row) => {
                        if (row.getData().driver) {
                            if (!row.isTreeExpanded()) {
                                row.treeExpand();
                            }
                            expandParents(row as never);
                            expandChildren(row as never);
                        } else if (row.isTreeExpanded()) {
                            row.treeCollapse();
                        }
                    });
                } else {
                    collapseAllRows();
                }
            }, 400);
        });
    }

    return {
        destroy: () => {
            destroyed = true;
            clearTimeout(searchTimer);
            clearTimeout(sortTimer);
            outsideHandlers.forEach((h) => document.removeEventListener("click", h));
            try {
                (tabulator as unknown as { destroy: () => void }).destroy();
            } catch {
                /* tabulator already torn down with the DOM */
            }
        }
    };
}
