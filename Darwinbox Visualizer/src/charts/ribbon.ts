/*
 *  Ribbon chart: a stacked column chart where each series is also connected to
 *  itself in the neighbouring category by a curved band, so a series that moves
 *  up or down the stack is easy to follow.
 *
 *  Header, axes, legend and element placement are the column chart's - the only
 *  additions are the bands and the per-category re-ordering (largest series on
 *  top), which is what makes a ribbon chart a ribbon chart.
 */
import { VisualSettings, colorOf } from "./../settings";
import { CategoryDatum, CellDatum, ChartModel } from "./../dataModel";
import { attrs, svgEl } from "./../utils";
import { ChartCallbacks, Frame, Rect, Theme, buildFrame, buildLegend, finishFrame } from "./frame";
import { columnSeries, columnValueRange, drawColumns } from "./marks";
import { frameRequest as columnFrameRequest } from "./column";

export function render(
    root: HTMLElement,
    model: ChartModel,
    settings: VisualSettings,
    width: number,
    height: number,
    cb: ChartCallbacks,
    theme: Theme
): void {
    const rs = settings.ribbonSettings;
    const series = columnSeries(model);

    const frame: Frame = buildFrame(
        root,
        model,
        settings,
        width,
        height,
        cb,
        theme,
        columnFrameRequest(model, settings, { orientation: "vertical", mode: "stacked" }),
        columnValueRange(model, series, "stacked"),
        buildLegend
    );

    /* geometry of every drawn segment, keyed category -> series */
    const rects: { [key: string]: Rect } = {};
    const key = (ci: number, si: number) => `${ci}|${si}`;

    const orderCells = rs.sortWithinCategory.value
        ? (cat: CategoryDatum): CellDatum[] =>
              cat.cells.slice().sort((a, b) => b.value - a.value || a.seriesIndex - b.seriesIndex)
        : undefined;

    const childCountBefore = frame.svg.childNodes.length;
    drawColumns(frame, model, settings, theme, cb, {
        mode: "stacked",
        series,
        orderCells,
        collect: (ci, si, rect) => {
            rects[key(ci, si)] = rect;
        }
    });

    /* --- ribbons, inserted under the columns --------------------- */
    const ribbonsG = svgEl("g");
    const opacity = (100 - (rs.transparency.value || 0)) / 100;
    const anySelection = cb.hasSelection();

    for (let ci = 0; ci + 1 < model.categories.length; ci++) {
        series.forEach((s) => {
            const a = rects[key(ci, s.index)];
            const b = rects[key(ci + 1, s.index)];
            if (!a || !b) {
                return;
            }
            const x1 = a.x + a.width;
            const x2 = b.x;
            if (x2 <= x1) {
                return;
            }
            const cx = (x1 + x2) / 2;
            const d = [
                `M${x1},${a.y}`,
                `C${cx},${a.y} ${cx},${b.y} ${x2},${b.y}`,
                `L${x2},${b.y + b.height}`,
                `C${cx},${b.y + b.height} ${cx},${a.y + a.height} ${x1},${a.y + a.height}`,
                "Z"
            ].join(" ");
            const path = svgEl("path");
            attrs(path, {
                d,
                fill: theme.isHighContrast ? theme.background : s.color,
                "fill-opacity": anySelection ? opacity * 0.4 : opacity,
                stroke:
                    rs.borderWidth.value > 0
                        ? theme.isHighContrast
                            ? theme.foreground
                            : colorOf(rs.borderColor)
                        : null,
                "stroke-width": rs.borderWidth.value || null,
                "pointer-events": "none"
            });
            ribbonsG.appendChild(path);
        });
    }

    const barsNode = frame.svg.childNodes[childCountBefore];
    if (barsNode) {
        frame.svg.insertBefore(ribbonsG, barsNode);
    } else {
        frame.svg.appendChild(ribbonsG);
    }

    finishFrame(frame, model, settings, theme, cb);
}
