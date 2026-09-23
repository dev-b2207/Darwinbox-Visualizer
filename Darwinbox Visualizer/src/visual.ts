/*
 *  Darwinbox - Stacked Column (Interactive Controls)
 *
 *  A stacked column chart that carries its own dimension selector,
 *  Monthly/Quarterly/Annual switch and chart/table toggle. Each control mutates
 *  the state of this visual only, so a report no longer needs field-parameter
 *  slicers, bookmark navigators or stacked shape/button layers to fake the same
 *  behaviour - and nothing breaks when the page layout changes.
 */
"use strict";

import powerbi from "powerbi-visuals-api";
import "./../style/visual.less";

import DataView = powerbi.DataView;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;

import { FormattingSettingsService, formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import { COMBO_LINE_COLOR, VisualSettings, colorOf, enumOf } from "./settings";
import {
    ChartModel,
    Granularity,
    Rollup,
    SeriesInfo,
    ViewMode,
    getAxisOptions,
    getDimension2Options,
    granularityAvailability,
    hasRole,
    transform
} from "./dataModel";
import { FILTER_MERGE, FILTER_REMOVE, MarkRef, buildCrossFilter } from "./crossFilter";
import { renderControls } from "./controls";
import { renderChart, ChartCallbacks, Theme } from "./chart";
import { TYPE_SPECIFIC_CARDS, chartTypeFor, hasBandAxis, isCartesian } from "./charts/registry";
import { slicesAreCategories } from "./charts/donut";
import { renderTable, TableColumnMeta, TableHost, TableInstance } from "./table";
import { DetailModel, buildDetailModel, hasDetailRows } from "./detailTable";
import { clearNode } from "./utils";

const MAX_SEGMENT_FETCHES = 20;

export class Visual implements IVisual {
    private host: IVisualHost;
    private selectionManager: ISelectionManager;
    private events: powerbi.extensibility.IVisualEventService;
    private formattingService: FormattingSettingsService;

    private root: HTMLElement;
    private controlsEl: HTMLElement;
    private contentEl: HTMLElement;
    private noticeEl: HTMLElement;

    private settings: VisualSettings;
    private dataView: DataView;
    private model: ChartModel;

    private axisKey: string = null;
    private dimension2Key: string = null;
    private topN: number = null;
    private granularity: Granularity = "annual";
    private viewMode: ViewMode = "chart";

    private tableInstance: TableInstance = null;
    private detail: DetailModel = null;
    private columnMeta: TableColumnMeta = { columnWidth: [], columnSort: [] };

    private segmentFetches = 0;
    private width = 0;
    private height = 0;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.selectionManager = this.host.createSelectionManager();
        this.events = this.host.eventService;
        this.formattingService = new FormattingSettingsService();

        this.root = document.createElement("div");
        this.root.className = "dbx-root";
        options.element.appendChild(this.root);

        this.controlsEl = document.createElement("div");
        this.controlsEl.className = "dbx-controls";
        this.root.appendChild(this.controlsEl);

        this.contentEl = document.createElement("div");
        this.contentEl.className = "dbx-content";
        this.root.appendChild(this.contentEl);

        this.noticeEl = document.createElement("div");
        this.noticeEl.className = "dbx-notice";
        this.root.appendChild(this.noticeEl);

        /*
         * Keep the visual in sync when a bookmark or another visual changes the
         * selection. Our own select() calls come back through here too, and acting on
         * them meant every click rebuilt the body a second time - with a detail-grain
         * table that is thousands of rows torn down and rebuilt for nothing, which is
         * what made a click on a column feel like a hang. renderAll() already redraws
         * for our own changes, so skip the echo.
         */
        this.selectionManager.registerOnSelectCallback(() => {
            if (this.selfSelecting) {
                return;
            }
            this.selectionFromChart = false;
            this.selectedRows = null;
            this.localKeys = [];
            this.localMarks = [];
            this.localActive = false;
            this.renderBody();
        });

        this.root.addEventListener("contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            this.selectionManager.showContextMenu({}, { x: e.clientX, y: e.clientY });
        });
    }

    /* ------------------------------------------------------------ */

    public update(options: VisualUpdateOptions): void {
        try {
            this.events.renderingStarted(options);

            this.width = options.viewport.width;
            this.height = options.viewport.height;
            this.root.style.width = `${this.width}px`;
            this.root.style.height = `${this.height}px`;

            const dataView = options.dataViews && options.dataViews[0];
            this.dataView = dataView;

            this.settings = this.formattingService.populateFormattingSettingsModel(
                VisualSettings,
                dataView
            );

            if (options.operationKind === powerbi.VisualDataChangeOperationKind.Create) {
                this.segmentFetches = 0;
            }

            if (!dataView || !dataView.categorical) {
                this.showLandingPage();
                this.events.renderingFinished(options);
                return;
            }

            /* pull the rest of a segmented result set before drawing */
            if (
                dataView.metadata &&
                dataView.metadata.segment &&
                this.segmentFetches < MAX_SEGMENT_FETCHES
            ) {
                this.segmentFetches++;
                if (this.host.fetchMoreData(true)) {
                    this.events.renderingFinished(options);
                    return;
                }
            }

            if (options.jsonFilters && options.jsonFilters.length) {
                this.filterOn = true;
            }
            if (this.onDataChanged(options, dataView)) {
                this.events.renderingFinished(options);
                return;
            }

            this.restoreState(dataView);
            this.renderAll();
            this.events.renderingFinished(options);
        } catch (e) {
            this.events.renderingFailed(options, String(e));
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        if (!this.settings) {
            this.settings = new VisualSettings();
        }
        this.buildColorSlices();
        this.buildCellFormattingGroups();
        // the hidden state card must never surface in the pane
        this.settings.state.visible = false;
        /* only the active chart type's own cards belong in the pane */
        const active = chartTypeFor(enumOf(this.settings.chartSettings.chartType));
        TYPE_SPECIFIC_CARDS.forEach((name) => {
            const card = (this.settings as unknown as { [k: string]: { visible?: boolean } })[name];
            if (card) {
                card.visible = active.settingsCards.indexOf(name) !== -1;
            }
        });

        /* the donut has no axes and no plot bands */
        const cartesian = isCartesian(active.key);
        this.settings.categoryAxis.visible = cartesian;
        this.settings.valueAxis.visible = cartesian;
        /*
         * The scatter's category axis is numeric, so there is nothing for the
         * rotation and label-area slices to act on. The rest of the card - font,
         * colour, title, gridlines, axis line - applies to it unchanged.
         */
        const band = hasBandAxis(active.key);
        this.settings.categoryAxis.labelRotation.visible = band;
        this.settings.categoryAxis.maxLabelHeight.visible = band;

        this.settings.granularitySwitch.visible = !this.model || this.model.dateFieldPresent;
        this.settings.timeSettings.visible = !this.model || this.model.dateFieldPresent;
        return this.formattingService.buildFormattingModel(this.settings);
    }

    /* ------------------------------------------------------------ */
    /* state                                                         */
    /* ------------------------------------------------------------ */

    private restoreState(dataView: DataView): void {
        this.columnMeta = this.readColumnMetadata();
        const s = this.settings.state;
        const options = getAxisOptions(dataView);
        const persistedAxis = s.selectedDimension.value;

        if (this.axisKey === null) {
            this.axisKey = persistedAxis || (options.length ? options[0].key : null);
        } else if (persistedAxis && persistedAxis !== this.axisKey && !this.pendingLocal) {
            this.axisKey = persistedAxis;
        }
        if (!options.filter((o) => o.key === this.axisKey).length && options.length) {
            this.axisKey = options[0].key;
        }

        /* second dimension: "" is a real choice (None), so only an unset field falls
           back to whatever was persisted */
        if (this.dimension2Key === null) {
            this.dimension2Key = s.selectedDimension2.value || "";
        } else if (!this.pendingLocal && s.selectedDimension2.value !== undefined) {
            this.dimension2Key = s.selectedDimension2.value || "";
        }
        const d2Options = getDimension2Options(dataView);
        if (this.dimension2Key && !d2Options.filter((o) => o.key === this.dimension2Key).length) {
            this.dimension2Key = "";
        }
        /* the two dropdowns can never land on the same field */
        if (this.dimension2Key && this.dimension2Key === this.axisKey) {
            this.dimension2Key = "";
        }

        const persistedN = parseInt(s.topNValue.value, 10);
        if (this.topN === null) {
            this.topN = isFinite(persistedN) && persistedN > 0 ? persistedN : null;
        } else if (!this.pendingLocal && isFinite(persistedN) && persistedN > 0) {
            this.topN = persistedN;
        }

        if (s.granularity.value && !this.pendingLocal) {
            this.granularity = s.granularity.value as Granularity;
        } else if (!s.granularity.value && !this.touchedGranularity) {
            this.granularity = this.defaultGranularity();
        }
        /* a persisted granularity whose button this dataview cannot offer */
        const avail = granularityAvailability(dataView);
        if (!avail[this.granularity]) {
            this.granularity = this.defaultGranularity(avail);
        }

        if (s.viewMode.value && !this.pendingLocal) {
            this.viewMode = s.viewMode.value as ViewMode;
        }
        this.pendingLocal = false;
    }

    /** true while we are pushing our own selection, so the echo can be ignored */
    private selfSelecting = false;
    /** true when the live selection was made by clicking a mark in chart view */
    private selectionFromChart = false;
    /** source rows behind that mark, which is what the table half filters on */
    private selectedRows: number[] = null;

    /*
     * The visual paints its own selection rather than waiting to be told what is
     * selected. Handing the host a click used to be the first thing a click did and
     * repainting the second, so nothing on screen moved until Power BI had finished
     * re-querying every other visual on the page - seconds, at detail grain. These
     * three fields are the local answer to "what is selected", so the repaint can
     * happen first and the host can be told afterwards.
     */
    /** mark handles (the key of each mark's first identity) currently selected here */
    private localKeys: string[] = [];
    /** the same marks, as coordinates, for building a report filter */
    private localMarks: MarkRef[] = [];
    /** true while the selection on screen is one this visual made */
    private localActive = false;
    /** true when a report filter of ours is live and needs removing before the next one */
    private filterOn = false;
    /** set when the grid is currently trimmed to the chart selection */
    private tableWasFiltered = false;
    private hostPush: number = null;
    /** true between applying a filter and the next data fetch, for the check below */
    private awaitingFilterEcho = false;
    private rowsBeforeFilter = 0;
    /** the host turned our own filter back on us, so the fast path is off */
    private selfFiltering = false;

    /** what the tooltip is currently showing, so move() can re-send it */
    private shownTooltip: { items: VisualTooltipDataItem[]; ids: ISelectionId[] } = {
        items: [],
        ids: []
    };

    private pendingLocal = false;
    private touchedGranularity = false;

    private defaultGranularity(
        avail?: { annual: boolean; quarterly: boolean; monthly: boolean }
    ): Granularity {
        const gs = this.settings.granularitySwitch;
        const ok = (g: Granularity) => !avail || avail[g];
        if (gs.showAnnual.value && ok("annual")) {
            return "annual";
        }
        if (gs.showQuarterly.value && ok("quarterly")) {
            return "quarterly";
        }
        if (gs.showMonthly.value && ok("monthly")) {
            return "monthly";
        }
        return avail && avail.annual ? "annual" : avail && avail.quarterly ? "quarterly" : "monthly";
    }

    /** the runtime N: what the user typed, else the card's default */
    private topNValue(): number {
        return this.topN !== null && this.topN > 0
            ? this.topN
            : this.settings.topN.defaultValue.value || 10;
    }

    private topNActive(): boolean {
        if (!this.settings.topN.show.value) {
            return false;
        }
        /* the table can be left showing everything while the chart is trimmed */
        if (this.viewMode === "table" && !this.settings.topN.applyToTable.value) {
            return false;
        }
        return true;
    }

    /*
     * Banner text. A measure in the Insight text well wins, because it re-reads with
     * the data; the static property is the fallback (and is also where the pane's fx
     * button writes a resolved value). The measure is evaluated per query row, so it
     * has to be written at total level - every row then carries the same sentence and
     * the first non-empty one is it.
     */
    private insightText(): string {
        const values = this.dataView && this.dataView.categorical && this.dataView.categorical.values;
        if (values) {
            for (let i = 0; i < values.length; i++) {
                if (!hasRole(values[i].source, "insight")) {
                    continue;
                }
                const col = values[i].values || [];
                for (let r = 0; r < col.length; r++) {
                    const v = col[r];
                    if (v !== null && v !== undefined && String(v).length) {
                        return String(v);
                    }
                }
            }
        }
        return this.settings.insight.insightText.value || "";
    }

    private persistState(): void {
        this.host.persistProperties({
            merge: [
                {
                    objectName: "state",
                    selector: null,
                    properties: {
                        selectedDimension: this.axisKey || "",
                        selectedDimension2: this.dimension2Key || "",
                        granularity: this.granularity,
                        viewMode: this.viewMode,
                        topNValue: this.topN !== null ? String(this.topN) : ""
                    }
                }
            ]
        });
    }

    /* ------------------------------------------------------------ */
    /* rendering                                                     */
    /* ------------------------------------------------------------ */

    private get theme(): Theme {
        const p = this.host.colorPalette;
        const hc = !!p.isHighContrast;
        return {
            isHighContrast: hc,
            foreground: hc ? p.foreground.value : "#252423",
            background: hc ? p.background.value : "#FFFFFF",
            foregroundSelected: hc ? p.foregroundSelected.value : "#0B6BCB"
        };
    }

    private buildModel(): ChartModel {
        const grouped =
            this.dataView.categorical.values && this.dataView.categorical.values.grouped
                ? this.dataView.categorical.values.grouped()
                : [];
        const valueCols = this.dataView.categorical.values || ([] as unknown as powerbi.DataViewValueColumns);
        const palette = this.host.colorPalette;

        const colorForSeries = (info: SeriesInfo): string => {
            let persisted: string = null;
            if (info.identity) {
                const g = grouped.filter((x) => x.identity === info.identity)[0];
                const objs = g && (g.objects as powerbi.DataViewObjects);
                persisted = this.readFill(objs);
            } else {
                for (let i = 0; i < valueCols.length; i++) {
                    if (valueCols[i].source.queryName === info.queryName) {
                        persisted = this.readFill(valueCols[i].source.objects);
                        break;
                    }
                }
            }
            if (persisted) {
                return persisted;
            }
            /* a combo's line reads as the accent over the columns - yellow by default */
            return info.isLine ? COMBO_LINE_COLOR : palette.getColor(info.key).value;
        };

        /*
         * The donut colours by slice, not by series, so each category needs its own
         * colour. Power BI stores a per-datapoint override on the category column's
         * objects; anything else comes from the report theme's data colours.
         */
        const colorForCategory = (
            key: string,
            index: number,
            objects: powerbi.DataViewObjects
        ): string => {
            const persisted = this.readFill(objects);
            void index;
            return persisted || palette.getColor(`cat:${key}`).value;
        };

        const ds = this.settings.dataSettings;
        return transform(this.dataView, this.host, {
            axisKey: this.axisKey,
            granularity: this.granularity,
            rollup: enumOf(ds.rollup) as Rollup,
            fiscalYearStartMonth: parseInt(enumOf(this.settings.timeSettings.fiscalYearStartMonth), 10),
            yearLabelStyle: enumOf(this.settings.timeSettings.yearLabelStyle),
            quarterLabelStyle: enumOf(this.settings.timeSettings.quarterLabelStyle),
            monthLabelStyle: enumOf(this.settings.timeSettings.monthLabelStyle),
            sortBy: enumOf(ds.sortBy),
            sortDirection: enumOf(ds.sortDirection),
            sortNumeric: ds.sortNumeric.value,
            maxSelectionIds: ds.maxSelectionIds.value,
            hideBlank: ds.hideBlank.value,
            blankLabel: ds.blankLabel.value || "(Blank)",
            maxCategories: ds.maxCategories.value,
            dimension2Key: this.settings.dimension2.show.value ? this.dimension2Key || "" : "",
            topN: this.topNActive() ? this.topNValue() : null,
            topNMode: enumOf(this.settings.topN.mode),
            colorForSeries,
            colorForCategory
        });
    }

    /*
     * Only one query per visual is possible, so the Table rows / Table columns
     * wells ride along in the chart's categorical query. When they are empty the
     * table falls back to the chart-derived view.
     */
    private buildDetail(): DetailModel {
        if (!this.dataView || !hasDetailRows(this.dataView)) {
            return null;
        }
        const ds = this.settings.dataSettings;
        return buildDetailModel(this.dataView, this.host, {
            rollup: enumOf(ds.rollup) as Rollup,
            blankLabel: ds.blankLabel.value || "(Blank)",
            maxRows: 30000,
            includeMeasures: this.settings.tableSetting.showMeasureColumns.value
        });
    }

    /** default table heading: the row field in detail mode, else the measure */
    private tableTitleFallback(): string {
        if (this.detailActive()) {
            return this.detail.rowLevels[0].label;
        }
        return this.model ? this.model.measureName : "";
    }

    private detailActive(): boolean {
        return !!(this.detail && this.detail.rowLevels.length && this.detail.nodes.length);
    }

    private readFill(objects: powerbi.DataViewObjects): string {
        if (!objects || !objects.dataPoint) {
            return null;
        }
        const fill = objects.dataPoint.fill as powerbi.Fill;
        return fill && fill.solid ? (fill.solid.color as string) : null;
    }

    private renderAll(): void {
        this.model = this.buildModel();
        this.detail = this.buildDetail();

        /* a report can map only the table wells - then there is no chart to draw */
        const chartAvailable = this.model.axisOptions.length > 0 && this.model.series.length > 0;
        if (!chartAvailable && !this.detailActive()) {
            this.showLandingPage();
            return;
        }
        if (!chartAvailable) {
            this.viewMode = "table";
        }
        this.noticeEl.className = "dbx-notice";
        this.noticeEl.style.display = "none";

        const theme = this.theme;
        const activeD2Key = this.model.activeDimension2 ? this.model.activeDimension2.key : "";
        renderControls(
            this.controlsEl,
            this.settings,
            {
                /*
                 * Each dropdown hides what the other one is showing, so the axis and
                 * the series can never be the same field.
                 */
                axisOptions: this.model.axisOptions.filter(
                    (o) => !activeD2Key || o.key !== activeD2Key
                ),
                activeAxisKey: this.model.activeAxis ? this.model.activeAxis.key : null,
                dimension2Options: this.model.dimension2Options.filter(
                    (o) => !this.model.activeAxis || o.key !== this.model.activeAxis.key
                ),
                activeDimension2Key: this.model.activeDimension2
                    ? this.model.activeDimension2.key
                    : "",
                topN: this.topNValue(),
                granularity: this.granularity,
                viewMode: this.viewMode,
                granularityEnabled:
                    this.model.granularityAvailable.annual ||
                    this.model.granularityAvailable.quarterly ||
                    this.model.granularityAvailable.monthly,
                granularityAvailable: this.model.granularityAvailable,
                tableTitleFallback: this.tableTitleFallback(),
                insightText: this.insightText()
            },
            {
                onAxisChange: (key) => {
                    this.axisKey = key;
                    /* the series split can never be the axis as well */
                    if (this.dimension2Key === key) {
                        this.dimension2Key = "";
                    }
                    this.pendingLocal = true;
                    this.renderAll();
                    this.persistState();
                },
                onDimension2Change: (key) => {
                    this.dimension2Key = key;
                    this.pendingLocal = true;
                    this.renderAll();
                    this.persistState();
                },
                onTopNChange: (n) => {
                    this.topN = n;
                    this.pendingLocal = true;
                    this.renderAll();
                    this.persistState();
                },
                onGranularityChange: (g) => {
                    this.granularity = g;
                    this.touchedGranularity = true;
                    this.pendingLocal = true;
                    this.renderAll();
                    this.persistState();
                },
                onViewChange: (v) => {
                    this.viewMode = v;
                    this.pendingLocal = true;
                    this.renderAll();
                    this.persistState();
                }
            },
            theme.isHighContrast,
            theme.foreground,
            theme.background
        );
        if (!chartAvailable) {
            this.controlsEl.style.display = "none";
        }

        this.root.style.flexDirection =
            enumOf(this.settings.controlBar.position) === "bottom" ? "column-reverse" : "column";

        this.renderBody();
        this.renderNotice();
    }

    /**
     * True when the grid should show only the rows behind the current chart
     * selection: the setting is on, something is selected, and that selection came
     * from clicking a mark rather than from clicking a row in this very grid.
     */
    private filterTableBySelection(): number[] {
        if (
            !this.settings ||
            !this.settings.tableSetting.filterBySelection.value ||
            !this.selectionFromChart ||
            !this.selectedRows ||
            !this.selectedRows.length
        ) {
            return null;
        }
        return this.selectedRows;
    }

    private renderBody(): void {
        if (!this.model || !this.settings) {
            return;
        }
        const controlsH = this.settings.controlBar.show.value
            ? this.controlsEl.getBoundingClientRect().height
            : 0;
        const noticeH = this.noticeEl.style.display === "none" ? 0 : this.noticeEl.getBoundingClientRect().height;
        const bodyH = Math.max(20, this.height - controlsH - noticeH);
        const theme = this.theme;

        if (this.tableInstance) {
            this.tableInstance.destroy();
            this.tableInstance = null;
        }

        if (this.viewMode === "table") {
            const rowFilter = this.filterTableBySelection();
            this.tableWasFiltered = !!rowFilter;
            this.tableInstance = renderTable(
                this.contentEl,
                this.model,
                this.settings,
                this.width,
                bodyH,
                this.callbacks(),
                theme,
                this.tableHost(),
                this.detail,
                rowFilter
            );
        } else {
            this.tableWasFiltered = false;
            renderChart(this.contentEl, this.model, this.settings, this.width, bodyH, this.callbacks(), theme);
        }
    }

    private get allowInteractions(): boolean {
        const caps = this.host.hostCapabilities;
        return !caps || caps.allowInteractions !== false;
    }

    /* ------------------------------------------------------------ */
    /* selection                                                     */
    /* ------------------------------------------------------------ */

    private static rowCount(dataView: DataView): number {
        const cats = dataView && dataView.categorical && dataView.categorical.categories;
        return cats && cats.length && cats[0].values ? cats[0].values.length : 0;
    }

    /**
     * A report filter applied by a visual is meant to filter the OTHER visuals on
     * the page and leave the one that raised it alone - that is what lets a slicer
     * keep showing every option after you pick one. This visual leans on that: the
     * chart must keep all of its bars when one is clicked.
     *
     * Rather than trust it, prove it once. If the fetch that follows our own filter
     * comes back smaller than the one before it, the host is filtering us with our
     * own filter; drop the filter, remember it, and cross-filter with identities
     * from then on. Removing it re-queries, so the bars come straight back and the
     * user sees at worst one flicker.
     *
     * Returns true when this update was consumed by that recovery.
     */
    private onDataChanged(options: VisualUpdateOptions, dataView: DataView): boolean {
        const isData = !options.type || (options.type & powerbi.VisualUpdateType.Data) !== 0;
        if (!isData) {
            return false;
        }
        const rows = Visual.rowCount(dataView);

        if (this.awaitingFilterEcho) {
            this.awaitingFilterEcho = false;
            if (this.rowsBeforeFilter > 0 && rows > 0 && rows < this.rowsBeforeFilter) {
                this.selfFiltering = true;
                this.clearReportFilter();
                return true;
            }
            return false;
        }

        /* somebody else changed the data underneath us: our row indices are stale */
        this.localKeys = [];
        this.localMarks = [];
        this.localActive = false;
        this.selectionFromChart = false;
        this.selectedRows = null;
        return false;
    }

    /** stable handle for one identity, used to compare marks without the host */
    private static keyOf(id: ISelectionId): string {
        const k = (id as unknown as { getKey?: () => string }).getKey;
        return k ? (id as unknown as { getKey: () => string }).getKey() : JSON.stringify(id);
    }

    /**
     * A click on a mark, in three steps and in this order:
     *
     *   1. record what is selected here, locally;
     *   2. repaint, so the dimming and the grid answer immediately;
     *   3. tell the host, on a later frame.
     *
     * Step 3 used to be step 1, with the repaint hanging off its promise. That is
     * why a click felt like a freeze: the promise does not settle until Power BI has
     * pushed the selection through every other visual's query, and until then this
     * visual could not even be switched to table view.
     */
    private applySelection(
        ids: ISelectionId[],
        multi: boolean,
        rows?: number[],
        seriesIndex?: number
    ): void {
        const fromChart = this.viewMode !== "table";

        if (!ids || !ids.length) {
            this.localKeys = [];
            this.localMarks = [];
        } else {
            const key = Visual.keyOf(ids[0]);
            const mark: MarkRef = {
                rows: rows ? rows.slice() : [],
                seriesIndex: seriesIndex === undefined || seriesIndex === null ? -1 : seriesIndex
            };
            const at = this.localKeys.indexOf(key);
            if (multi && at >= 0) {
                this.localKeys.splice(at, 1);
                this.localMarks.splice(at, 1);
            } else if (multi) {
                this.localKeys.push(key);
                this.localMarks.push(mark);
            } else {
                this.localKeys = [key];
                this.localMarks = [mark];
            }
        }

        this.localActive = this.localKeys.length > 0;
        /*
         * A selection made on a mark is what the table filters by; one made on a
         * table row is not, or clicking a row would collapse the grid to that row
         * alone.
         */
        this.selectionFromChart = this.localActive && fromChart;
        this.selectedRows = null;
        if (this.selectionFromChart) {
            const union: number[] = [];
            const seen: { [k: string]: boolean } = {};
            this.localMarks.forEach((m) =>
                m.rows.forEach((r) => {
                    if (seen[String(r)]) {
                        return;
                    }
                    seen[String(r)] = true;
                    union.push(r);
                })
            );
            this.selectedRows = union.length ? union : null;
        }

        /*
         * The grid paints its own selected rows, so rebuilding it on a row click
         * would throw away scroll position, the current page and the search box for
         * no gain. It only needs rebuilding when the set of rows it shows changed.
         */
        const filtered = !!this.filterTableBySelection();
        if (this.viewMode !== "table" || filtered || this.tableWasFiltered) {
            this.renderBody();
        }

        this.pushToHost(ids, multi);
    }

    /**
     * Hand the selection to Power BI after the repaint has landed. Coalesced, so a
     * burst of clicks costs one round trip rather than one each.
     */
    private pushToHost(ids: ISelectionId[], multi: boolean): void {
        if (this.hostPush !== null) {
            clearTimeout(this.hostPush);
        }
        const run = () => {
            this.hostPush = null;
            this.sendSelection(ids, multi);
        };
        const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : null;
        this.hostPush = window.setTimeout(() => (raf ? raf(run) : run()), 0);
    }

    private clearReportFilter(): void {
        if (!this.filterOn) {
            return;
        }
        this.filterOn = false;
        this.host.applyJsonFilter([], "general", "filter", FILTER_REMOVE);
    }

    private sendSelection(ids: ISelectionId[], multi: boolean): void {
        const settle = () => {
            this.selfSelecting = false;
        };

        if (!this.localActive) {
            this.clearReportFilter();
            this.selfSelecting = true;
            this.selectionManager.clear().then(settle, settle);
            return;
        }

        /*
         * The fast path. See src/crossFilter.ts: two conditions describing where the
         * mark sits, instead of one identity per source row behind it.
         */
        const mode = enumOf(this.settings.dataSettings.crossFilter);
        const filters =
            mode === "highlight" || this.selfFiltering
                ? null
                : buildCrossFilter(this.dataView, this.model, this.localMarks);

        if (filters && filters.length) {
            if (this.selectionManager.getSelectionIds().length) {
                this.selfSelecting = true;
                this.selectionManager.clear().then(settle, settle);
            }
            this.filterOn = true;
            this.awaitingFilterEcho = true;
            this.rowsBeforeFilter = Visual.rowCount(this.dataView);
            /* no fetch came back, so the host did not filter us: stop watching */
            window.setTimeout(() => (this.awaitingFilterEcho = false), 4000);
            this.host.applyJsonFilter(filters, "general", "filter", FILTER_MERGE);
            return;
        }

        this.clearReportFilter();
        this.selfSelecting = true;
        this.selectionManager.select(ids, multi).then(settle, settle);
    }

    private callbacks(): ChartCallbacks {
        const interactive = this.allowInteractions;
        const currentKeys = new Set<string>();
        if (this.localActive) {
            this.localKeys.forEach((k) => currentKeys.add(k));
        } else {
            const current = this.selectionManager.getSelectionIds() as ISelectionId[];
            current.forEach((c) => currentKeys.add(Visual.keyOf(c)));
        }

        return {
            onSelect: (ids, multi, rows, seriesIndex) => {
                if (!interactive) {
                    return;
                }
                this.applySelection(ids, multi, rows, seriesIndex);
            },
            onContextMenu: (id, x, y) => {
                if (!interactive) {
                    return;
                }
                this.selectionManager.showContextMenu(id ? id : {}, { x, y });
            },
            onTooltip: (items: VisualTooltipDataItem[], ids, x, y) => {
                this.shownTooltip = { items, ids: ids || [] };
                this.host.tooltipService.show({
                    coordinates: [x, y],
                    dataItems: items,
                    identities: ids || [],
                    isTouchEvent: false
                });
            },
            /*
             * move() replaces the tooltip's contents with whatever it is handed, so
             * passing an empty dataItems array - as this did - blanked the tooltip on
             * the first mousemove after it opened. It has to re-send what is on show.
             */
            onTooltipMove: (x, y) => {
                if (!this.shownTooltip.items.length) {
                    return;
                }
                this.host.tooltipService.move({
                    coordinates: [x, y],
                    dataItems: this.shownTooltip.items,
                    identities: this.shownTooltip.ids,
                    isTouchEvent: false
                });
            },
            onTooltipHide: () => {
                this.shownTooltip = { items: [], ids: [] };
                this.host.tooltipService.hide({ immediately: false, isTouchEvent: false });
            },
            isSelected: (ids) => {
                if (!currentKeys.size) {
                    return false;
                }
                return ids.some((i) => {
                    const g = (i as unknown as { getKey?: () => string }).getKey;
                    return currentKeys.has(g ? (i as unknown as { getKey: () => string }).getKey() : JSON.stringify(i));
                });
            },
            hasSelection: () => currentKeys.size > 0
        };
    }

    private renderNotice(): void {
        if (this.detailActive() && this.detail.truncated) {
            this.noticeEl.style.display = "block";
            this.noticeEl.textContent = `Showing the first ${this.detail.nodes.length} of ${this.detail.totalNodeCount} rows. Filter the visual to narrow the list.`;
            return;
        }
        if (this.model && this.model.truncated) {
            this.noticeEl.style.display = "block";
            this.noticeEl.textContent = `Showing the first ${this.model.categories.length} of ${this.model.totalCategoryCount} categories. Raise "Max categories shown" under Data handling, or filter the visual.`;
        } else {
            this.noticeEl.style.display = "none";
        }
    }

    /*
     * Shown before any field is mapped, and while a segmented result set is still
     * being fetched. A spinner rather than the field-by-field explanation that used
     * to live here: on a report page full of these, the explanation read as an error.
     */
    private showLandingPage(): void {
        clearNode(this.contentEl);
        clearNode(this.controlsEl);
        this.noticeEl.style.display = "block";
        this.noticeEl.className = "dbx-notice dbx-landing";
        clearNode(this.noticeEl);

        const inner = document.createElement("div");
        inner.className = "dbx-landing-inner";
        const spinner = document.createElement("div");
        spinner.className = "dbx-spinner";
        spinner.setAttribute("role", "status");
        spinner.setAttribute("aria-label", "Loading");
        inner.appendChild(spinner);
        this.noticeEl.appendChild(inner);
    }

    /* ------------------------------------------------------------ */
    /* per-series colour pickers                                     */
    /* ------------------------------------------------------------ */

    private buildColorSlices(): void {
        const card = this.settings.dataPoint;
        card.slices = [];
        if (!this.model || !this.model.series.length) {
            card.visible = false;
            return;
        }
        card.visible = true;

        /*
         * Two shapes of picker. Per category for the types that colour by category -
         * the donut always, the scatter when "Colour points by category" is on -
         * and per series for everything else.
         */
        const type = enumOf(this.settings.chartSettings.chartType);
        const perCategory =
            (type === "donut" && slicesAreCategories(this.model)) ||
            (type === "scatter" && this.settings.scatterSettings.colorByCategory.value);
        if (perCategory) {
            this.model.categories.forEach((c) => {
                const sel = c.selectionId
                    ? (c.selectionId as unknown as {
                          getSelector: () => powerbi.data.Selector;
                      }).getSelector()
                    : null;
                card.slices.push(
                    new formattingSettings.ColorPicker({
                        name: "fill",
                        displayName: c.label,
                        value: { value: c.color },
                        selector: sel
                    })
                );
            });
            return;
        }

        this.model.series.forEach((s) => {
            const picker = new formattingSettings.ColorPicker({
                name: "fill",
                displayName: s.label,
                value: { value: s.color },
                selector: this.selectorFor(s)
            });
            card.slices.push(picker);
        });
    }

    private selectorFor(s: SeriesInfo): powerbi.data.Selector {
        if (s.identity && s.selectionId) {
            const sel = (s.selectionId as unknown as {
                getSelector: () => powerbi.data.Selector;
            }).getSelector();
            return sel;
        }
        return { metadata: s.queryName } as unknown as powerbi.data.Selector;
    }

    /* ------------------------------------------------------------ */
    /* table view plumbing                                           */
    /* ------------------------------------------------------------ */

    /** the value columns the table renders, in render order */
    private tableValueFields(): { field: string; queryName?: string; isTotal: boolean }[] {
        const out: { field: string; queryName?: string; isTotal: boolean }[] = [];

        /* detail mode: the table's own attribute + measure columns */
        if (this.detailActive()) {
            this.detail.attributeColumns.forEach((a) =>
                out.push({ field: a.key, queryName: a.queryName, isTotal: false })
            );
            this.detail.measureColumns.forEach((m) =>
                out.push({ field: m.key, queryName: m.queryName, isTotal: false })
            );
            return out;
        }

        if (!this.model) {
            return out;
        }
        this.model.series.forEach((s) =>
            out.push({ field: s.label, queryName: s.queryName, isTotal: false })
        );
        if (this.settings.tableSetting.showTotalColumn.value && this.model.series.length > 1) {
            out.push({
                field: this.settings.tableSetting.totalLabel.value || "Total",
                queryName: undefined,
                isTotal: true
            });
        }
        return out;
    }

    private readColumnMetadata(): TableColumnMeta {
        let meta: TableColumnMeta = { columnWidth: [], columnSort: [] };
        const raw = this.settings.saveState.columnMetadata.value;
        if (raw) {
            try {
                meta = JSON.parse(raw) as TableColumnMeta;
            } catch {
                meta = { columnWidth: [], columnSort: [] };
            }
        }
        if (!meta || !Array.isArray(meta.columnWidth)) {
            meta = { columnWidth: [], columnSort: Array.isArray(meta && meta.columnSort) ? meta.columnSort : [] };
        }
        if (!Array.isArray(meta.columnSort)) {
            meta.columnSort = [];
        }
        return meta;
    }

    private tableHost(): TableHost {
        return {
            persistProperties: (changes) => this.host.persistProperties(changes),
            getColumnMetadata: () => this.columnMeta,
            setColumnMetadata: (meta) => {
                this.columnMeta = meta;
                this.host.persistProperties({
                    merge: [
                        {
                            objectName: "saveState",
                            selector: null,
                            properties: { columnMetadata: JSON.stringify(meta) }
                        }
                    ]
                });
            },
            canExport: () => {
                const d = (this.host as unknown as { downloadService?: { exportVisualsContent?: unknown } })
                    .downloadService;
                return !!(d && typeof d.exportVisualsContent === "function");
            },
            exportCsv: (csv, fileName) => {
                const d = (this.host as unknown as {
                    downloadService?: {
                        exportVisualsContent: (
                            c: string,
                            f: string,
                            t: string,
                            desc: string
                        ) => unknown;
                    };
                }).downloadService;
                if (!d || typeof d.exportVisualsContent !== "function") {
                    return false;
                }
                try {
                    /* the host prompts the user; a tenant that has not granted the
                       ExportContent privilege simply declines */
                    d.exportVisualsContent(csv, fileName, "csv", "Table data");
                    return true;
                } catch {
                    return false;
                }
            },
            cellFormatFor: (field) => {
                /* a true master switch: off means no in-cell bars or links at all,
                   whatever the per-column values still say */
                if (!this.settings.cellFormatting.show.value) {
                    return { bar: false, url: false };
                }
                const entry = this.tableValueFields().filter((f) => f.field === field)[0];
                if (!entry) {
                    return { bar: false, url: false };
                }
                const objects = this.cellFormatObjectsFor(entry);
                return {
                    bar: this.readBool(objects, "bar"),
                    url: this.readBool(objects, "url")
                };
            }
        };
    }

    /*
     * The reference table visual hangs Bar/URL off each measure's metadata via a
     * { metadata: queryName } selector. Measure-driven series here do the same.
     * Legend-driven series all share one measure, so they share one group instead.
     */
    private cellFormatObjectsFor(entry: {
        field: string;
        queryName?: string;
        isTotal: boolean;
    }): powerbi.DataViewObjects {
        if (!this.dataView || !this.dataView.categorical) {
            return null;
        }
        const values = this.dataView.categorical.values;
        if (!values) {
            return null;
        }
        /* detail columns map straight onto their own source column metadata */
        if (entry.queryName && this.detailActive()) {
            const cats = this.dataView.categorical.categories || [];
            for (let i = 0; i < cats.length; i++) {
                if (cats[i].source.queryName === entry.queryName) {
                    return cats[i].source.objects;
                }
            }
            for (let i = 0; i < values.length; i++) {
                if (values[i].source.queryName === entry.queryName) {
                    return values[i].source.objects;
                }
            }
        }

        if (entry.queryName && !this.legendDriven()) {
            for (let i = 0; i < values.length; i++) {
                if (values[i].source.queryName === entry.queryName) {
                    return values[i].source.objects;
                }
            }
        }
        /* legend-driven or the Total column: fall back to the object-level default */
        return this.dataView.metadata ? this.dataView.metadata.objects : null;
    }

    private legendDriven(): boolean {
        const values = this.dataView && this.dataView.categorical && this.dataView.categorical.values;
        return !!(values && values.source && values.source.roles && values.source.roles.legend);
    }

    private readBool(objects: powerbi.DataViewObjects, prop: string): boolean {
        if (!objects || !objects.cellFormatting) {
            return false;
        }
        return !!objects.cellFormatting[prop];
    }

    private buildCellFormattingGroups(): void {
        const card = this.settings.cellFormatting;
        card.groups = [];

        const fields = this.tableValueFields().filter((f) => !f.isTotal);
        if (!fields.length) {
            card.visible = false;
            return;
        }
        card.visible = true;
        /* the per-column groups only appear once the card is switched on */
        if (!card.show.value) {
            return;
        }

        const legend = this.legendDriven() && !this.detailActive();

        if (legend) {
            /* one shared group: every column is the same measure split by legend */
            const objects = this.dataView && this.dataView.metadata ? this.dataView.metadata.objects : null;
            const bar = this.readBool(objects, "bar");
            const group = new formattingSettings.Group({
                name: "cellFormatting_all",
                displayName: this.model ? this.model.measureName : "Values",
                collapsible: true,
                slices: [
                    new formattingSettings.ToggleSwitch({ name: "bar", displayName: "Bar", value: bar })
                ]
            });
            if (bar) {
                group.slices.push(
                    new formattingSettings.ColorPicker({
                        name: "backColor",
                        displayName: "Background Color",
                        value: { value: colorOf(card.backColor) }
                    })
                );
            }
            card.groups.push(group);
            return;
        }

        /*
         * The pane selector for these toggles is the column's queryName, so several
         * columns that share one measure - a legend split, or a Dimension 2 split -
         * are one setting, not several. Emitting a group each produced the repeated
         * identical cards; keep the first and drop the rest.
         */
        const seenSelector: { [k: string]: boolean } = {};
        fields.forEach((f) => {
            const selectorKey = f.queryName || f.field;
            if (seenSelector[selectorKey]) {
                return;
            }
            seenSelector[selectorKey] = true;
            const objects = this.cellFormatObjectsFor(f);
            const bar = this.readBool(objects, "bar");
            const url = this.readBool(objects, "url");
            const selector = { metadata: f.queryName } as unknown as powerbi.data.Selector;
            const isNumeric = this.isNumericField(f.queryName);

            const group = new formattingSettings.Group({
                name: `cellFormatting_${f.queryName || f.field}`,
                displayName: f.field,
                collapsible: true,
                slices: []
            });

            if (isNumeric) {
                group.slices.push(
                    new formattingSettings.ToggleSwitch({
                        name: "bar",
                        displayName: "Bar",
                        value: bar,
                        selector
                    })
                );
                if (bar) {
                    group.slices.push(
                        new formattingSettings.ColorPicker({
                            name: "backColor",
                            displayName: "Background Color",
                            value: { value: colorOf(card.backColor) }
                        })
                    );
                }
            } else {
                group.slices.push(
                    new formattingSettings.ToggleSwitch({
                        name: "url",
                        displayName: "URL",
                        value: url,
                        selector
                    })
                );
            }

            card.groups.push(group);
        });
    }

    private isNumericField(queryName: string): boolean {
        if (!queryName || !this.dataView || !this.dataView.metadata) {
            return true;
        }
        const cols = this.dataView.metadata.columns || [];
        for (let i = 0; i < cols.length; i++) {
            if (cols[i].queryName === queryName) {
                return !!(cols[i].type && cols[i].type.numeric);
            }
        }
        return true;
    }
}
