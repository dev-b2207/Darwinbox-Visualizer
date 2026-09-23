/*
 *  Scatter / bubble chart.
 *
 *  The one type that does not use frame.ts. Every other chart here has a band
 *  scale on one axis - one slot per category, evenly spaced - and frame.ts is
 *  built around that: it measures label room per band, decides when to wrap or
 *  rotate them, and scrolls horizontally when the bands get too narrow. A scatter
 *  has two numeric axes and no bands at all, so it draws its own pair of axes
 *  rather than bending a band scale into a continuous one. It still shares the
 *  legend, the plot-area padding, the tick maths, the tooltip/selection plumbing
 *  and the axis format cards with the rest, so it looks and behaves like the
 *  others.
 *
 *  One point per category - the value of whatever the header dropdown is showing -
 *  which is the analogue of native Power BI's Details well. A Legend field splits
 *  each category into one point per series, and Size turns the points into
 *  area-proportional bubbles.
 */
import powerbi from "powerbi-visuals-api";
import ISelectionId = powerbi.visuals.ISelectionId;

import { VisualSettings, colorOf, enumOf } from "./../settings";
import {
    CategoryDatum,
    CellDatum,
    ChartModel,
    EXTRA_SIZE,
    EXTRA_X,
    EXTRA_Y,
    SeriesInfo,
    extraOf
} from "./../dataModel";
import {
    attrs,
    contrastColor,
    createFormatter,
    dashArray,
    fontString,
    measureText,
    svgEl,
    textHeight,
    truncate,
    IValueFormatter
} from "./../utils";
import {
    ChartCallbacks,
    Theme,
    applySvgFont,
    attachMarkHandlers,
    buildLegend,
    markerShape,
    ticksFor
} from "./frame";

const TICK_PAD = 6;
const LABEL_GAP = 4;

interface Point {
    cat: CategoryDatum;
    cell: CellDatum;
    series: SeriesInfo;
    x: number;
    y: number;
    size: number;
    color: string;
    ids: ISelectionId[];
}

/**
 * Which measure feeds each axis. The X axis and Y axis wells win when they are
 * mapped; when they are not, the chart falls back to the measure the other eleven
 * types use, so dropping the type onto an existing chart still draws something
 * instead of an empty plot.
 */
function resolve(cell: CellDatum): { x: number; y: number; size: number } {
    const x = extraOf(cell, EXTRA_X);
    const y = extraOf(cell, EXTRA_Y);
    return {
        x: x === null ? cell.value : x,
        y: y === null ? cell.value : y,
        size: extraOf(cell, EXTRA_SIZE)
    };
}

function collect(model: ChartModel, settings: VisualSettings, theme: Theme): Point[] {
    const byCategory = settings.scatterSettings.colorByCategory.value;
    const out: Point[] = [];
    model.categories.forEach((cat, ci) => {
        cat.cells.forEach((cell) => {
            const series = model.series.filter((s) => s.index === cell.seriesIndex)[0];
            if (!series) {
                return;
            }
            const v = resolve(cell);
            if (!isFinite(v.x) || !isFinite(v.y)) {
                return;
            }
            out.push({
                cat,
                cell,
                series,
                x: v.x,
                y: v.y,
                size: v.size,
                color: theme.isHighContrast
                    ? theme.foreground
                    : byCategory
                    ? cat.color || series.color
                    : series.color,
                ids: (cell as unknown as { allSelectionIds: ISelectionId[] }).allSelectionIds || [
                    cell.selectionId
                ]
            });
            void ci;
        });
    });
    return out;
}

/** data range, padded so points do not sit on the axis line, or the fixed bounds */
function range(
    values: number[],
    start: number,
    end: number,
    includeZero: boolean
): { min: number; max: number } {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    values.forEach((v) => {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
    });
    if (!isFinite(lo)) {
        lo = 0;
        hi = 1;
    }
    if (includeZero) {
        lo = Math.min(0, lo);
        hi = Math.max(0, hi);
    }
    if (hi === lo) {
        /* a single distinct value would give a zero-span axis */
        const bump = Math.abs(hi) > 1 ? Math.abs(hi) * 0.1 : 1;
        lo -= bump;
        hi += bump;
    } else {
        const pad = (hi - lo) * 0.06;
        lo -= pad;
        hi += pad;
    }
    if (start !== null && start !== undefined) {
        lo = start;
    }
    if (end !== null && end !== undefined) {
        hi = end;
    }
    if (hi <= lo) {
        hi = lo + 1;
    }
    return { min: lo, max: hi };
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
    const pa = settings.plotArea;
    const ss = settings.scatterSettings;
    const ca = settings.categoryAxis;
    const va = settings.valueAxis;
    const dl = settings.dataLabels;

    const points = collect(model, settings, theme);
    if (!points.length) {
        return;
    }

    /* ---------------------------------------------- legend --------- */
    const legendPos = enumOf(settings.legend.position);
    const showLegend = settings.legend.show.value && model.series.length > 1;
    const legendNode = showLegend ? buildLegend(model, settings, theme, cb) : null;
    const horizontalLegend = legendPos === "top" || legendPos === "bottom";

    const outer = document.createElement("div");
    outer.style.display = "flex";
    outer.style.flex = "1 1 auto";
    outer.style.minHeight = "0";
    outer.style.flexDirection = horizontalLegend ? "column" : "row";
    root.appendChild(outer);

    const plotHost = document.createElement("div");
    plotHost.style.display = "flex";
    plotHost.style.flex = "1 1 auto";
    plotHost.style.minWidth = "0";
    plotHost.style.minHeight = "0";

    if (legendNode && (legendPos === "top" || legendPos === "left")) {
        outer.appendChild(legendNode);
    }
    outer.appendChild(plotHost);
    if (legendNode && (legendPos === "bottom" || legendPos === "right")) {
        outer.appendChild(legendNode);
    }

    const legendW = legendNode && !horizontalLegend ? legendNode.getBoundingClientRect().width : 0;
    const legendH = legendNode && horizontalLegend ? legendNode.getBoundingClientRect().height : 0;

    const padL = pa.paddingLeft.value;
    const padR = pa.paddingRight.value;
    const padT = pa.paddingTop.value;
    const padB = pa.paddingBottom.value;
    const border = pa.borderWidth.value;

    const availW = Math.max(60, width - legendW - padL - padR - 2 * border);
    const availH = Math.max(60, height - legendH - padT - padB - 2 * border);

    /* ---------------------------------------------- scales --------- */
    const xr = range(points.map((p) => p.x), ss.xStart.value, ss.xEnd.value, ss.xIncludeZero.value);
    const yr = range(points.map((p) => p.y), va.start.value, va.end.value, ss.yIncludeZero.value);

    const yTicks = ticksFor(yr.min, yr.max, Math.max(2, va.tickCount.value || 5), false);
    const xTicks = ticksFor(
        xr.min,
        xr.max,
        Math.max(2, Math.min(ss.xTickCount.value || 6, Math.round(availW / 90))),
        false
    );

    /*
     * Both scatter axes are auto-ranged off the data rather than anchored at zero,
     * so the gap between ticks is often less than 1 - and whole-number formatting
     * would then print the same label twice ("29, 29, 30, 30"). Take the decimals
     * the tick step actually needs, but never fewer than the author asked for.
     */
    const decimalsFor = (ticks: number[], asked: number): number => {
        const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 0;
        if (!step || step >= 1) {
            return asked;
        }
        return Math.max(asked, Math.min(6, Math.ceil(-Math.log(step) / Math.LN10)));
    };

    const yFmt: IValueFormatter = createFormatter(
        model.yMeta ? model.yMeta.format : model.measureFormat,
        parseInt(enumOf(va.displayUnits), 10),
        decimalsFor(yTicks, va.precision.value),
        Math.max(Math.abs(yr.min), Math.abs(yr.max))
    );
    const xFmt: IValueFormatter = createFormatter(
        model.xMeta ? model.xMeta.format : model.measureFormat,
        parseInt(enumOf(ss.xDisplayUnits), 10),
        decimalsFor(xTicks, ss.xPrecision.value),
        Math.max(Math.abs(xr.min), Math.abs(xr.max))
    );

    /* ---------------------------------------------- axis room ------ */
    const yFontStr = fontString(va.font);
    const xFontStr = fontString(ca.font);
    const yLabelH = textHeight(va.font);
    const xLabelH = textHeight(ca.font);

    let yAxisW = 0;
    if (va.show.value) {
        yTicks.forEach((t) => {
            yAxisW = Math.max(yAxisW, measureText(yFmt.format(t), yFontStr));
        });
        yAxisW += TICK_PAD;
        if (va.showTitle.value) {
            yAxisW += textHeight(va.titleFont) + 2;
        }
    }
    let xAxisH = 0;
    if (ca.show.value) {
        xAxisH = xLabelH + TICK_PAD;
        if (ca.showTitle.value) {
            xAxisH += textHeight(ca.titleFont) + 2;
        }
    }

    const svgW = Math.max(40, availW);
    const svgH = Math.max(40, availH);
    const plotW = Math.max(20, svgW - yAxisW);
    const plotH = Math.max(20, svgH - xAxisH);

    const xAt = (v: number): number => yAxisW + ((v - xr.min) / (xr.max - xr.min)) * plotW;
    const yAt = (v: number): number => plotH - ((v - yr.min) / (yr.max - yr.min)) * plotH;

    /* bubble radius: area-proportional, which is why the root is taken */
    const sizes = points.map((p) => p.size).filter((v) => v !== null && isFinite(v));
    const hasSize = !!sizes.length && !!model.sizeMeta;
    const sMin = hasSize ? Math.min.apply(null, sizes) : 0;
    const sMax = hasSize ? Math.max.apply(null, sizes) : 0;
    const rMin = Math.max(1, (ss.minBubbleSize.value || 8) / 2);
    const rMax = Math.max(rMin, (ss.maxBubbleSize.value || 40) / 2);
    const radiusOf = (p: Point): number => {
        if (!hasSize || p.size === null || !isFinite(p.size)) {
            return Math.max(1.5, (ss.markerSize.value || 10) / 2);
        }
        if (sMax === sMin) {
            return (rMin + rMax) / 2;
        }
        const t = (Math.abs(p.size) - sMin) / (sMax - sMin);
        return Math.sqrt(rMin * rMin + t * (rMax * rMax - rMin * rMin));
    };

    /* ---------------------------------------------- canvas --------- */
    const box = document.createElement("div");
    box.style.flex = "1 1 auto";
    box.style.minWidth = "0";
    box.style.minHeight = "0";
    box.style.margin = `${padT}px ${padR}px ${padB}px ${padL}px`;
    box.style.boxSizing = "border-box";
    box.style.overflow = "hidden";
    if (border > 0) {
        box.style.border = `${border}px solid ${colorOf(pa.borderColor)}`;
        box.style.borderRadius = `${pa.cornerRadius.value}px`;
    }
    const bg = colorOf(pa.background);
    if (bg && bg !== "transparent") {
        box.style.background = bg;
    }
    plotHost.appendChild(box);

    const svg = svgEl("svg");
    attrs(svg, {
        width: svgW,
        height: svgH,
        role: "group",
        "aria-label": `${model.yMeta ? model.yMeta.displayName : model.measureName} against ${
            model.xMeta ? model.xMeta.displayName : model.measureName
        }`
    });
    svg.style.display = "block";
    box.appendChild(svg);

    const gridG = svgEl("g");
    const axisG = svgEl("g");
    const pointsG = svgEl("g");
    const labelsG = svgEl("g");
    svg.appendChild(gridG);
    svg.appendChild(axisG);
    svg.appendChild(pointsG);
    svg.appendChild(labelsG);

    /* ---------------------------------------------- gridlines ------ */
    const grid = (
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        color: string,
        w: number,
        style: string
    ): void => {
        const l = svgEl("line");
        attrs(l, {
            x1,
            y1,
            x2,
            y2,
            stroke: color,
            "stroke-width": w,
            "stroke-dasharray": dashArray(style, w)
        });
        gridG.appendChild(l);
    };

    if (va.showGridlines.value && !theme.isHighContrast) {
        yTicks.forEach((t) =>
            grid(
                yAxisW,
                yAt(t),
                yAxisW + plotW,
                yAt(t),
                colorOf(va.gridlineColor),
                va.gridlineWidth.value,
                enumOf(va.gridlineStyle)
            )
        );
    }
    if (ca.showGridlines.value && !theme.isHighContrast) {
        xTicks.forEach((t) =>
            grid(
                xAt(t),
                0,
                xAt(t),
                plotH,
                colorOf(ca.gridlineColor),
                ca.gridlineWidth.value,
                enumOf(ca.gridlineStyle)
            )
        );
    }

    /* ---------------------------------------------- axes ----------- */
    if (ca.showAxisLine.value) {
        const l = svgEl("line");
        attrs(l, {
            x1: yAxisW,
            x2: yAxisW + plotW,
            y1: plotH,
            y2: plotH,
            stroke: theme.isHighContrast ? theme.foreground : colorOf(ca.axisLineColor),
            "stroke-width": 1
        });
        axisG.appendChild(l);
    }
    if (va.showAxisLine.value) {
        const l = svgEl("line");
        attrs(l, {
            x1: yAxisW,
            x2: yAxisW,
            y1: 0,
            y2: plotH,
            stroke: theme.isHighContrast ? theme.foreground : colorOf(va.axisLineColor),
            "stroke-width": 1
        });
        axisG.appendChild(l);
    }

    if (va.show.value) {
        const fill = theme.isHighContrast ? theme.foreground : colorOf(va.fontColor);
        yTicks.forEach((t) => {
            const el = svgEl("text");
            applySvgFont(el, va.font);
            attrs(el, {
                x: yAxisW - TICK_PAD,
                y: yAt(t) + yLabelH / 3,
                "text-anchor": "end",
                fill
            });
            el.textContent = yFmt.format(t);
            axisG.appendChild(el);
        });
    }
    if (ca.show.value) {
        const fill = theme.isHighContrast ? theme.foreground : colorOf(ca.fontColor);
        const room = plotW / Math.max(1, xTicks.length);
        xTicks.forEach((t) => {
            const el = svgEl("text");
            applySvgFont(el, ca.font);
            attrs(el, {
                x: xAt(t),
                y: plotH + xLabelH,
                "text-anchor": "middle",
                fill
            });
            el.textContent = truncate(xFmt.format(t), xFontStr, Math.max(24, room));
            axisG.appendChild(el);
        });
    }

    /* axis titles, drawn in the svg so no extra layout pass is needed */
    if (ca.show.value && ca.showTitle.value) {
        const el = svgEl("text");
        applySvgFont(el, ca.titleFont);
        attrs(el, {
            x: yAxisW + plotW / 2,
            y: svgH - 2,
            "text-anchor": "middle",
            fill: theme.isHighContrast ? theme.foreground : colorOf(ca.titleFontColor)
        });
        el.textContent =
            ca.titleText.value || (model.xMeta ? model.xMeta.displayName : model.measureName);
        axisG.appendChild(el);
    }
    if (va.show.value && va.showTitle.value) {
        const el = svgEl("text");
        applySvgFont(el, va.titleFont);
        attrs(el, {
            x: 0,
            y: 0,
            "text-anchor": "middle",
            transform: `translate(${textHeight(va.titleFont)}, ${plotH / 2}) rotate(-90)`,
            fill: theme.isHighContrast ? theme.foreground : colorOf(va.titleFontColor)
        });
        el.textContent =
            va.titleText.value || (model.yMeta ? model.yMeta.displayName : model.measureName);
        axisG.appendChild(el);
    }

    /* ---------------------------------------------- points --------- */
    const anySelection = cb.hasSelection();
    const alpha = (100 - (ss.transparency.value || 0)) / 100;
    const shape = enumOf(ss.markerShape);
    const tooltipFmt: IValueFormatter = createFormatter(model.measureFormat, 1, null, yr.max);
    const xTipFmt: IValueFormatter = createFormatter(
        model.xMeta ? model.xMeta.format : undefined,
        1,
        null,
        Math.abs(xr.max)
    );
    const yTipFmt: IValueFormatter = createFormatter(
        model.yMeta ? model.yMeta.format : undefined,
        1,
        null,
        Math.abs(yr.max)
    );
    const sizeFmt: IValueFormatter = createFormatter(
        model.sizeMeta ? model.sizeMeta.format : undefined,
        1,
        null,
        sMax || 1
    );

    /* the primary value row that attachMarkHandlers writes already says what Y is
       when Y came from the Values well, so only add a row when it did not */
    const yIsPrimary =
        !model.yMeta ||
        !model.valueColumnMeta ||
        model.yMeta.queryName === model.valueColumnMeta.queryName;

    /* biggest bubbles first, so a small point is never buried under a large one */
    const ordered = points.slice().sort((a, b) => radiusOf(b) - radiusOf(a));

    /*
     * The data-label colour defaults to white because on a column chart the label
     * sits inside the bar. A scatter label sits on the plot background, so it takes
     * the same auto-contrast route the line chart's labels take.
     */
    const plotBg = colorOf(pa.background);
    const labelColor = theme.isHighContrast
        ? theme.foreground
        : dl.autoContrast.value
        ? contrastColor(!plotBg || plotBg === "transparent" ? "#FFFFFF" : plotBg)
        : colorOf(dl.fontColor);

    const placed: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const labelFontStr = fontString(dl.font);
    const labelH = textHeight(dl.font);

    ordered.forEach((p) => {
        const cx = xAt(p.x);
        const cy = yAt(p.y);
        if (cx < -40 || cx > svgW + 40 || cy < -40 || cy > svgH + 40) {
            return;
        }
        const r = radiusOf(p);
        const dim = anySelection && !cb.isSelected(p.ids);

        const mark = markerShape(shape, cx, cy, r * 2);
        attrs(mark, {
            fill: theme.isHighContrast ? theme.background : p.color,
            "fill-opacity": dim ? alpha * 0.35 : alpha,
            stroke: theme.isHighContrast ? theme.foreground : p.color,
            "stroke-width": theme.isHighContrast ? 2 : 1,
            "stroke-opacity": dim ? 0.4 : 1,
            tabindex: 0,
            role: "img",
            "aria-label": `${p.cat.label}, ${xTipFmt.format(p.x)}, ${yTipFmt.format(p.y)}`
        });
        (mark as unknown as HTMLElement).style.cursor = "pointer";

        const extra: powerbi.extensibility.VisualTooltipDataItem[] = [];
        if (model.xMeta) {
            extra.push({ displayName: model.xMeta.displayName, value: xTipFmt.format(p.x) });
        }
        if (model.yMeta && !yIsPrimary) {
            extra.push({ displayName: model.yMeta.displayName, value: yTipFmt.format(p.y) });
        }
        if (hasSize && p.size !== null) {
            extra.push({ displayName: model.sizeMeta.displayName, value: sizeFmt.format(p.size) });
        }
        attachMarkHandlers(mark, p.cat, p.cell, p.ids, model, cb, tooltipFmt, extra);
        pointsG.appendChild(mark);

        if (!dl.show.value) {
            return;
        }
        /*
         * Power BI labels a scatter point with its category, not its value - the
         * value is what the two axes already say. Labels that would land on one
         * already drawn are dropped rather than overlapped.
         */
        const txt = p.cat.label + (model.series.length > 1 ? ` - ${p.series.label}` : "");
        const w = measureText(txt, labelFontStr);
        const lx = cx;
        if (lx - w / 2 < yAxisW - 2 || lx + w / 2 > yAxisW + plotW + 2) {
            return;
        }
        /* above the point, flipping below when that would clip the top of the plot */
        const clear = (y: number): boolean => {
            const b = { x1: lx - w / 2, y1: y - labelH, x2: lx + w / 2, y2: y };
            if (b.y1 < 0 || b.y2 > plotH) {
                return false;
            }
            return !placed.some(
                (q) => b.x1 < q.x2 && b.x2 > q.x1 && b.y1 < q.y2 && b.y2 > q.y1
            );
        };
        const above = cy - r - LABEL_GAP;
        const below = cy + r + LABEL_GAP + labelH;
        const ly = clear(above) ? above : clear(below) ? below : null;
        if (ly === null) {
            return;
        }
        placed.push({ x1: lx - w / 2, y1: ly - labelH, x2: lx + w / 2, y2: ly });

        const el = svgEl("text");
        applySvgFont(el, dl.font);
        attrs(el, {
            x: lx,
            y: ly,
            "text-anchor": "middle",
            "pointer-events": "none",
            fill: labelColor
        });
        el.textContent = txt;
        labelsG.appendChild(el);
    });

    svg.addEventListener("click", (e: MouseEvent) => {
        if (e.target === svg) {
            cb.onSelect([], false);
        }
    });
}
