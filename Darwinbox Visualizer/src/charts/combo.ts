/*
 *  Line and column combo.
 *
 *  Columns come from the Values well, the line from the Line values well, and the
 *  line reads the secondary axis by default - the reference "Leave Count and
 *  Leave % Trend" chart plots a count against a percentage.
 */
import { VisualSettings, colorOf, enumOf } from "./../settings";
import { ChartModel } from "./../dataModel";
import { textHeight } from "./../utils";
import { ChartCallbacks, Frame, Theme, buildFrame, buildLegend, finishFrame } from "./frame";
import {
    StackMode,
    columnSeries,
    columnValueRange,
    drawColumns,
    drawLines,
    lineSeries,
    seriesValueRange
} from "./marks";
import { frameRequest as columnFrameRequest } from "./column";

export interface ComboSpec {
    /** how the column half stacks: "cluster" for combo, "stacked" for stacked combo */
    mode: StackMode;
}

export function render(
    root: HTMLElement,
    model: ChartModel,
    settings: VisualSettings,
    width: number,
    height: number,
    cb: ChartCallbacks,
    theme: Theme,
    spec: ComboSpec = { mode: "cluster" }
): void {
    const cols = columnSeries(model);
    const lines = lineSeries(model);
    const dl = settings.dataLabels;
    const combo = settings.comboSettings;

    const req = columnFrameRequest(model, settings, { orientation: "vertical", mode: spec.mode });
    /* the line and its labels sit above the columns, so keep more headroom */
    req.gutter = Math.max(req.gutter, textHeight(dl.font) + 8);
    req.secondary = lines.length && combo.onSecondaryAxis.value ? seriesValueRange(model, lines) : null;

    const frame: Frame = buildFrame(
        root,
        model,
        settings,
        width,
        height,
        cb,
        theme,
        req,
        columnValueRange(model, cols.length ? cols : model.series, spec.mode),
        buildLegend
    );

    drawColumns(frame, model, settings, theme, cb, {
        mode: spec.mode,
        series: cols.length ? cols : model.series
    });

    if (lines.length) {
        drawLines(frame, model, settings, theme, cb, {
            series: lines,
            mode: enumOf(combo.lineDisplay) === "markers" ? "markers" : "line",
            scale: frame.hasSecondary ? frame.value2At : frame.valueAt,
            badge: combo.labelBadge.value
                ? {
                      fill: theme.isHighContrast ? theme.background : colorOf(combo.badgeColor),
                      text: colorOf(combo.badgeTextColor),
                      radius: combo.badgeRadius.value || 0
                  }
                : null,
            format: model.secondaryFormat
        });
    }

    finishFrame(frame, model, settings, theme, cb);
}
