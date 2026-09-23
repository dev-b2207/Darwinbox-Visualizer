/*
 *  Line chart (optionally with an area fill).
 *  The frame comes from frame.ts, the marks from marks.ts - this file is the
 *  wiring: how much room the markers need and what the value range is.
 */
import { VisualSettings, enumOf } from "./../settings";
import { ChartModel } from "./../dataModel";
import { ChartCallbacks, Frame, FrameRequest, Theme, buildFrame, buildLegend, finishFrame } from "./frame";
import { drawLines, seriesValueRange } from "./marks";

const MIN_SPACING = 40;

export function frameRequest(settings: VisualSettings): FrameRequest {
    const ls = settings.lineSettings;
    const fixed = enumOf(ls.spacingMode) === "fixed";
    const markerR = ls.showMarkers.value ? (ls.markerSize.value || 7) / 2 : ls.lineWidth.value / 2;
    return {
        orientation: "vertical",
        minBandWidth: Math.max(4, ls.minPointSpacing.value || MIN_SPACING),
        fixedBandWidth: fixed ? Math.max(4, ls.pointSpacing.value || 90) : null,
        /*
         * Marker room only. Reserving label height as well would mean "auto" label
         * placement almost never flips below, and the reference trend charts put
         * labels below whenever the point sits near the top of the plot.
         */
        gutter: Math.ceil(markerR + 2),
        extendToNiceMax: false,
        includeZero: true
    };
}

export function valueRange(model: ChartModel): { min: number; max: number } {
    return seriesValueRange(model, model.series);
}

export function render(
    root: HTMLElement,
    model: ChartModel,
    settings: VisualSettings,
    width: number,
    height: number,
    cb: ChartCallbacks,
    theme: Theme
): void {
    const frame: Frame = buildFrame(
        root,
        model,
        settings,
        width,
        height,
        cb,
        theme,
        frameRequest(settings),
        valueRange(model),
        buildLegend
    );

    drawLines(frame, model, settings, theme, cb, {
        series: model.series,
        scale: frame.valueAt
    });
    finishFrame(frame, model, settings, theme, cb);
}
