/*
 *  Chart-type registry.
 *
 *  Adding a chart type: write a file next to this one that exports
 *  render(root, model, settings, width, height, cb, theme) - build the frame with
 *  buildFrame(), draw your marks (marks.ts already has columns, bars and lines),
 *  then call finishFrame() - and add an entry here plus a member in capabilities'
 *  chartSettings.chartType enumeration.
 *
 *  Variants of an existing renderer need no new file at all: pass a spec, the way
 *  the bar and 100% entries below do.
 *
 *  `settingsCards` lists the format-pane cards that only apply to this type;
 *  everything not listed for the active type is hidden in getFormattingModel().
 */
import { VisualSettings } from "./../settings";
import { ChartModel } from "./../dataModel";
import { ChartCallbacks, Theme } from "./frame";

import * as area from "./area";
import * as column from "./column";
import * as line from "./line";
import * as combo from "./combo";
import * as ribbon from "./ribbon";
import * as donut from "./donut";
import * as scatter from "./scatter";

export type RenderFn = (
    root: HTMLElement,
    model: ChartModel,
    settings: VisualSettings,
    width: number,
    height: number,
    cb: ChartCallbacks,
    theme: Theme
) => void;

export interface ChartTypeDef {
    key: string;
    label: string;
    render: RenderFn;
    /** cards that belong to this type alone */
    settingsCards: string[];
}

/** every type-specific card, so the dispatcher can hide the ones not in use */
export const TYPE_SPECIFIC_CARDS = [
    "columnSettings",
    "lineSettings",
    "ribbonSettings",
    "donutSettings",
    "comboSettings",
    "areaSettings",
    "scatterSettings",
    "secondaryAxis"
];

const columnWith = (spec: column.ColumnSpec): RenderFn => (r, m, s, w, h, c, t) =>
    column.render(r, m, s, w, h, c, t, spec);

const areaWith = (spec: area.AreaSpec): RenderFn => (r, m, s, w, h, c, t) =>
    area.render(r, m, s, w, h, c, t, spec);

const comboWith = (spec: combo.ComboSpec): RenderFn => (r, m, s, w, h, c, t) =>
    combo.render(r, m, s, w, h, c, t, spec);

export const CHART_TYPES: ChartTypeDef[] = [
    {
        key: "stackedColumn",
        label: "Stacked column",
        render: columnWith({ orientation: "vertical", mode: "stacked", legacyPercent: true }),
        settingsCards: ["columnSettings"]
    },
    {
        key: "percentColumn",
        label: "100% stacked column",
        render: columnWith({ orientation: "vertical", mode: "percent" }),
        settingsCards: ["columnSettings"]
    },
    {
        key: "clusteredColumn",
        label: "Clustered column",
        render: columnWith({ orientation: "vertical", mode: "cluster" }),
        settingsCards: ["columnSettings"]
    },
    {
        key: "bar",
        label: "Bar",
        render: columnWith({ orientation: "horizontal", mode: "cluster" }),
        settingsCards: ["columnSettings"]
    },
    {
        key: "stackedBar",
        label: "Stacked bar",
        render: columnWith({ orientation: "horizontal", mode: "stacked" }),
        settingsCards: ["columnSettings"]
    },
    {
        key: "percentBar",
        label: "100% stacked bar",
        render: columnWith({ orientation: "horizontal", mode: "percent" }),
        settingsCards: ["columnSettings"]
    },
    {
        key: "line",
        label: "Line",
        render: line.render,
        settingsCards: ["lineSettings"]
    },
    {
        key: "area",
        label: "Area",
        render: areaWith({ mode: "overlap" }),
        settingsCards: ["lineSettings", "areaSettings"]
    },
    {
        key: "stackedArea",
        label: "Stacked area",
        render: areaWith({ mode: "stacked" }),
        settingsCards: ["lineSettings", "areaSettings"]
    },
    {
        key: "percentArea",
        label: "100% stacked area",
        render: areaWith({ mode: "percent" }),
        settingsCards: ["lineSettings", "areaSettings"]
    },
    {
        key: "scatter",
        label: "Scatter",
        render: scatter.render,
        settingsCards: ["scatterSettings"]
    },
    {
        key: "combo",
        label: "Line and clustered column",
        render: comboWith({ mode: "cluster" }),
        settingsCards: ["columnSettings", "lineSettings", "comboSettings", "secondaryAxis"]
    },
    {
        key: "stackedCombo",
        label: "Line and stacked column",
        render: comboWith({ mode: "stacked" }),
        settingsCards: ["columnSettings", "lineSettings", "comboSettings", "secondaryAxis"]
    },
    {
        key: "ribbon",
        label: "Ribbon",
        render: ribbon.render,
        settingsCards: ["columnSettings", "ribbonSettings"]
    },
    {
        key: "donut",
        label: "Donut",
        render: donut.render,
        settingsCards: ["donutSettings"]
    }
];

export function chartTypeFor(key: string): ChartTypeDef {
    return CHART_TYPES.filter((t) => t.key === key)[0] || CHART_TYPES[0];
}

/** the donut has no axes, so those cards are hidden for it as well */
export function isCartesian(key: string): boolean {
    return key !== "donut";
}

/**
 * The scatter's category axis is numeric, so the label-rotation and label-area
 * slices on that card have nothing to rotate. Everything else on it - the font,
 * the colour, the title, the gridlines - applies exactly as it does elsewhere.
 */
export function hasBandAxis(key: string): boolean {
    return key !== "donut" && key !== "scatter";
}
