/*
 *  Area, stacked area and 100% stacked area.
 *
 *  All three are the line chart with a fill, so the frame, the markers, the data
 *  labels, the tooltips and the selection behaviour are the line chart's - there is
 *  no second copy of any of that here. What this file adds is the baseline each
 *  fill sits on:
 *
 *    overlap  every series starts at zero and the fills are drawn transparent, so
 *             a series hidden behind a taller one still reads. Native Power BI's
 *             plain "Area chart".
 *    stacked  each series sits on the running total of the ones below it, so the
 *             top edge of the last series is the category total.
 *    percent  the same, normalised per category, on a 0-100% axis.
 *
 *  In both stacked modes the line is drawn at the running total but the label and
 *  the tooltip still read the series' own value, which is what Power BI does and
 *  what anyone reading the chart expects: the band's thickness is the value.
 */
import { VisualSettings, enumOf } from "./../settings";
import { CellDatum, ChartModel } from "./../dataModel";
import { ChartCallbacks, Frame, FrameRequest, Theme, buildFrame, buildLegend, finishFrame } from "./frame";
import { textHeight } from "./../utils";
import { columnValueRange, drawLines, inSeries, seriesValueRange } from "./marks";
import { frameRequest as lineFrameRequest } from "./line";

export type AreaMode = "overlap" | "stacked" | "percent";

export interface AreaSpec {
    mode: AreaMode;
}

export function frameRequest(settings: VisualSettings, spec: AreaSpec): FrameRequest {
    const base = lineFrameRequest(settings);
    return {
        ...base,
        /*
         * A filled chart reads as a solid block against its axis, so the axis has to
         * be complete underneath it - unlike a bare trend line, which the line chart
         * deliberately lets stop at the data maximum.
         */
        extendToNiceMax: spec.mode !== "percent",
        includeZero: true,
        valueFormat: spec.mode === "percent" ? "0%" : undefined
    };
}

export function valueRange(model: ChartModel, spec: AreaSpec): { min: number; max: number } {
    if (spec.mode === "overlap") {
        const r = seriesValueRange(model, model.series);
        return { min: Math.min(0, r.min), max: r.max };
    }
    return columnValueRange(model, model.series, spec.mode === "percent" ? "percent" : "stacked");
}

/**
 * Running totals, per category, in the order the series are stacked - which is the
 * cell order, exactly as the stacked column builds it, so a report that switches
 * between stacked column and stacked area sees the same series at the bottom.
 *
 * Positive and negative values stack away from zero independently, again matching
 * the column renderer.
 */
interface Band {
    top: number;
    base: number;
}

function bands(model: ChartModel, spec: AreaSpec): { [key: string]: Band } {
    const out: { [key: string]: Band } = {};
    model.categories.forEach((cat, ci) => {
        let pos = 0;
        let neg = 0;
        let total = 0;
        if (spec.mode === "percent") {
            cat.cells.forEach((cell) => {
                if (inSeries(model.series, cell)) {
                    total += Math.abs(cell.value);
                }
            });
        }
        cat.cells.forEach((cell) => {
            if (!inSeries(model.series, cell)) {
                return;
            }
            const v =
                spec.mode === "percent" ? (total ? cell.value / total : 0) : cell.value;
            if (v >= 0) {
                out[`${ci}|${cell.seriesIndex}`] = { base: pos, top: pos + v };
                pos += v;
            } else {
                out[`${ci}|${cell.seriesIndex}`] = { base: neg + v, top: neg };
                neg += v;
            }
        });
    });
    return out;
}

export function render(
    root: HTMLElement,
    model: ChartModel,
    settings: VisualSettings,
    width: number,
    height: number,
    cb: ChartCallbacks,
    theme: Theme,
    spec: AreaSpec
): void {
    const frame: Frame = buildFrame(
        root,
        model,
        settings,
        width,
        height,
        cb,
        theme,
        frameRequest(settings, spec),
        valueRange(model, spec),
        buildLegend
    );

    const as = settings.areaSettings;
    const stacked = spec.mode !== "overlap";
    const band = stacked ? bands(model, spec) : null;
    const at = (ci: number, cell: CellDatum): Band =>
        band[`${ci}|${cell.seriesIndex}`] || { top: 0, base: 0 };

    /*
     * Stacking order on screen: the first series has to be drawn last in overlap
     * mode or a big first series would bury the rest, and drawn first in stacked
     * mode so the bands read bottom-up. The bands do not overlap, so only the
     * overlap case actually needs the reversal.
     */
    const series = spec.mode === "overlap" ? model.series.slice().reverse() : model.series;

    /*
     * On a 100% chart the label is the share and the tooltip is the real number
     * plus that share - the same split the 100% stacked column uses, so the two
     * types read alike.
     */
    const share = (ci: number, cell: CellDatum): number => {
        const b = at(ci, cell);
        return b.top - b.base;
    };
    const percent = spec.mode === "percent";
    const dp = settings.dataLabels.precision.value || 0;

    /*
     * A stacked band's label belongs inside the band, centred - the band is the
     * value, so putting the label above its top edge would attach it to the wrong
     * one. A band with no room for the text gets no label rather than an
     * overlapping one.
     */
    const labelH = textHeight(settings.dataLabels.font);
    const labelY = (ci: number, cell: CellDatum): number => {
        const b = at(ci, cell);
        const yTop = frame.valueAt(b.top);
        const yBase = frame.valueAt(b.base);
        if (Math.abs(yBase - yTop) < labelH + 2) {
            return null;
        }
        return (yTop + yBase) / 2 + labelH / 3;
    };

    drawLines(frame, model, settings, theme, cb, {
        series,
        scale: frame.valueAt,
        labelText: percent ? (ci, cell) => `${(share(ci, cell) * 100).toFixed(dp)}%` : undefined,
        labelY: stacked ? labelY : undefined,
        tooltipExtra: percent
            ? (ci, cell) => [
                  { displayName: "% of total", value: `${(share(ci, cell) * 100).toFixed(1)}%` }
              ]
            : undefined,
        forceArea: {
            transparency: stacked
                ? as.transparency.value || 0
                : as.overlapTransparency.value || 0
        },
        stackTop: stacked ? (ci, cell) => at(ci, cell).top : undefined,
        stackBase: stacked ? (ci, cell) => at(ci, cell).base : undefined
    });

    finishFrame(frame, model, settings, theme, cb);
    void enumOf;
}
