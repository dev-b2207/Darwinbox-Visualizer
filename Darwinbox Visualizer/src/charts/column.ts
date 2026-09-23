/*
 *  The column and bar family: stacked, 100% stacked and clustered, drawn either
 *  vertically (columns) or horizontally (bars).
 *
 *  The frame (axes, gridlines, legend, scrolling) comes from frame.ts and the
 *  marks from marks.ts, so this file is only the wiring: how much room the marks
 *  need, what the value range is, and which mode to draw in.
 */
import { VisualSettings, enumOf } from "./../settings";
import { ChartModel } from "./../dataModel";
import { createFormatter, fontString, measureText, textHeight } from "./../utils";
import { ChartCallbacks, Frame, FrameRequest, Orientation, Theme, buildFrame, buildLegend, finishFrame } from "./frame";
import { StackMode, columnSeries, columnValueRange, drawColumns, labelIsOutside } from "./marks";

const MIN_BAND = 14;

export interface ColumnSpec {
    orientation: Orientation;
    mode: StackMode;
    /**
     * Set on the "Stacked column" entry only: a v2 report that used the old
     * Stack type = 100% stacked slice keeps rendering as 100% stacked after the
     * upgrade instead of silently turning into a plain stack.
     */
    legacyPercent?: boolean;
}

const DEFAULT_SPEC: ColumnSpec = { orientation: "vertical", mode: "stacked", legacyPercent: true };

export function modeFor(settings: VisualSettings, spec: ColumnSpec): StackMode {
    if (spec.legacyPercent && spec.mode === "stacked") {
        return enumOf(settings.columnSettings.stackType) === "percent" ? "percent" : "stacked";
    }
    return spec.mode;
}

/** room at the far end of the value axis for an outside-end label */
function labelGutter(
    model: ChartModel,
    settings: VisualSettings,
    spec: ColumnSpec,
    mode: StackMode
): number {
    const dl = settings.dataLabels;
    if (!dl.show.value || !labelIsOutside(settings)) {
        return 0;
    }
    if (spec.orientation === "vertical") {
        return textHeight(dl.font) + 6;
    }
    /* a bar's label runs along the value axis, so reserve its width */
    const fontStr = fontString(dl.font);
    if (mode === "percent") {
        return measureText("100%", fontStr) + 10;
    }
    const range = columnValueRange(model, columnSeries(model), mode);
    const fmt = createFormatter(
        model.measureFormat,
        parseInt(enumOf(dl.displayUnits), 10),
        dl.precision.value,
        Math.max(Math.abs(range.max), Math.abs(range.min))
    );
    let widest = 0;
    model.categories.forEach((c) => {
        const total =
            mode === "cluster"
                ? c.cells.reduce((m, x) => Math.max(m, x.value), 0)
                : c.cells.reduce((s, x) => s + (x.value > 0 ? x.value : 0), 0);
        widest = Math.max(widest, measureText(fmt.format(total), fontStr));
    });
    return widest + 12;
}

export function frameRequest(
    model: ChartModel,
    settings: VisualSettings,
    spec: ColumnSpec = DEFAULT_SPEC
): FrameRequest {
    const cs = settings.columnSettings;
    const mode = modeFor(settings, spec);
    const innerPad = Math.min(0.9, Math.max(0, (cs.innerPadding.value || 0) / 100));
    const denom = innerPad < 0.95 ? 1 - innerPad : 1;
    const fixed = enumOf(cs.widthMode) === "fixed";
    return {
        orientation: spec.orientation,
        minBandWidth: Math.max(1, cs.minColumnWidth.value || MIN_BAND) / denom,
        fixedBandWidth: fixed ? Math.max(1, cs.barWidth.value || 28) / denom : null,
        gutter: labelGutter(model, settings, spec, mode),
        /* a 100% chart plots 0..1, so the axis needs a percentage format */
        valueFormat: mode === "percent" ? "0%" : undefined,
        extendToNiceMax: true,
        includeZero: true
    };
}

export function render(
    root: HTMLElement,
    model: ChartModel,
    settings: VisualSettings,
    width: number,
    height: number,
    cb: ChartCallbacks,
    theme: Theme,
    spec: ColumnSpec = DEFAULT_SPEC
): void {
    const mode = modeFor(settings, spec);
    const series = columnSeries(model);

    const frame: Frame = buildFrame(
        root,
        model,
        settings,
        width,
        height,
        cb,
        theme,
        frameRequest(model, settings, spec),
        columnValueRange(model, series, mode),
        buildLegend
    );

    drawColumns(frame, model, settings, theme, cb, { mode, series });
    finishFrame(frame, model, settings, theme, cb);
}
