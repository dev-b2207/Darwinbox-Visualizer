/*
 *  Shared cartesian frame.
 *
 *  Everything every chart type needs and none of them should re-implement:
 *  legend, the pinned value axis, the horizontal scroller and its custom
 *  scrollbar, gridlines, category labels and the pinned category-axis title.
 *
 *  buildFrame() returns the geometry and the <svg> to draw into, so a chart type
 *  only has to draw its own marks. Adding a chart type means adding one file that
 *  draws marks plus a registry entry - no axis or scrolling code.
 */
import powerbi from "powerbi-visuals-api";
import ISelectionId = powerbi.visuals.ISelectionId;

import { VisualSettings, colorOf, enumOf } from "./../settings";
import { CategoryDatum, CellDatum, ChartModel } from "./../dataModel";
import {
    attrs,
    createFormatter,
    cssFont,
    dashArray,
    fontString,
    measureText,
    svgEl,
    textHeight,
    truncate,
    IValueFormatter
} from "./../utils";

export interface ChartCallbacks {
    /**
     * `rows` are the source rows behind the clicked mark, when the caller knows
     * them. The host filter runs off `ids`; `rows` is what lets the table half show
     * exactly the rows behind the mark, which identities cannot express because a
     * mark's identity carries the series scope and a table row's does not.
     */
    onSelect: (ids: ISelectionId[], multi: boolean, rows?: number[], seriesIndex?: number) => void;
    onContextMenu: (id: ISelectionId, x: number, y: number) => void;
    onTooltip: (
        items: powerbi.extensibility.VisualTooltipDataItem[],
        ids: ISelectionId[],
        x: number,
        y: number
    ) => void;
    onTooltipMove: (x: number, y: number) => void;
    onTooltipHide: () => void;
    isSelected: (ids: ISelectionId[]) => boolean;
    hasSelection: () => boolean;
}

export interface Theme {
    isHighContrast: boolean;
    foreground: string;
    background: string;
    foregroundSelected: string;
}

export const SCROLLBAR = 12;
const TICK_PAD = 6;

export type Orientation = "vertical" | "horizontal";

/** what a chart type tells the frame about its own space requirements */
export interface FrameRequest {
    /**
     * "vertical"   - categories along the bottom, values up the left  (columns, lines)
     * "horizontal" - categories down the left, values along the bottom (bars)
     */
    orientation?: Orientation;
    /** range for the right-hand axis; null for every type except the combos */
    secondary?: { min: number; max: number } | null;
    /** smallest usable width per category before the plot should scroll */
    minBandWidth: number;
    /** exact width per category when the type wants a fixed size, else null */
    fixedBandWidth: number | null;
    /** pixels to keep free at the far end of the value axis for marks/labels */
    gutter: number;
    /**
     * Overrides the measure's own format string on the value axis. A 100% stacked
     * chart plots 0..1, which the measure's "#,0" format would print as 0 / 1 / 1.
     */
    valueFormat?: string;
    /**
     * true  - stretch the value axis up to the next round gridline (columns need
     *         a complete axis under the bars)
     * false - stop at the data maximum, so a trend line topping out at 59,012
     *         shows 0 / 20,000 / 40,000 and no 60,000 line
     */
    extendToNiceMax: boolean;
    /** include zero in the range even when all values are far from it */
    includeZero: boolean;
}

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface Frame {
    svg: SVGSVGElement;
    plotHost: HTMLElement;
    scroller: HTMLElement;
    orientation: Orientation;
    /** plot geometry, all in the coordinate space of `svg` */
    innerPlotW: number;
    plotH: number;
    band: number;
    /** centre of category i along the category axis (x when vertical, y when horizontal) */
    catAt: (i: number) => number;
    /** position of a value along the value axis */
    valueAt: (v: number) => number;
    /** same for the secondary axis; equals valueAt when there is none */
    value2At: (v: number) => number;
    hasSecondary: boolean;
    /** vertical-only aliases kept so the column and line renderers read naturally */
    xAt: (i: number) => number;
    yScale: (v: number) => number;
    plotTop: number;
    plotBottom: number;
    yMin: number;
    yMax: number;
    y2Min: number;
    y2Max: number;
    zeroY: number;
    needsScroll: boolean;
    yAxisW: number;
    valueFormatter: IValueFormatter;
    secondaryFormatter: IValueFormatter;
    /** the drawable plot rectangle inside `svg`, for clamping labels */
    plotBox: { x1: number; y1: number; x2: number; y2: number };
    /** a bar spanning v0..v1 on the value axis, `thickness` wide across the band */
    rectFor: (catCentre: number, v0: number, v1: number, thickness: number) => Rect;
    /** vertical-orientation only: how category labels should be drawn, decided once
        so the space-reservation pass and the render pass never disagree */
    catLabelLayout?: CategoryLabelLayout;
}

/* ------------------------------------------------------------------ */
/* category-axis label layout: wrap before resorting to rotated text   */
/* ------------------------------------------------------------------ */

export type CategoryLabelMode = "horizontal" | "wrap" | "rotate";

export interface CategoryLabelLayout {
    mode: CategoryLabelMode;
    /** degrees, only meaningful when mode === "rotate" */
    rotation: number;
    /** per-category wrapped lines, only populated when mode === "wrap" */
    lines: string[][];
    lineHeight: number;
    /** space to reserve below the plot for these labels, in px */
    areaH: number;
}

/** greedy word-wrap: each line is as many whole words as fit within maxWidth */
function wrapWords(text: string, fontStr: string, maxWidth: number): string[] {
    const words = (text || "").split(/\s+/).filter(Boolean);
    if (!words.length) {
        return [""];
    }
    const lines: string[] = [];
    let current = words[0];
    for (let i = 1; i < words.length; i++) {
        const candidate = `${current} ${words[i]}`;
        if (measureText(candidate, fontStr) <= maxWidth) {
            current = candidate;
        } else {
            lines.push(current);
            current = words[i];
        }
    }
    lines.push(current);
    return lines;
}

/**
 * Decides, once per render, how category labels fit under the bars: plain
 * horizontal if they already fit; otherwise wrapped onto multiple horizontal
 * lines if that avoids overflow within the configured label-area budget;
 * otherwise the existing rotated-text fallback, applied to every label alike
 * so labels never mix straight and slanted within one chart.
 *
 * Only the "Auto" rotation setting goes through wrap-then-rotate - an explicit
 * fixed rotation picked in the format pane is a direct user override and is
 * honoured as-is.
 */
function computeCategoryLabelLayout(
    cats: CategoryDatum[],
    ca: VisualSettings["categoryAxis"],
    xFontStr: string,
    xLabelLineH: number,
    band: number
): CategoryLabelLayout {
    const rotSetting = enumOf(ca.labelRotation);
    const longest = cats.reduce((m, c) => Math.max(m, measureText(c.label, xFontStr)), 0);
    const maxLineW = Math.max(10, band - 4);

    const rotateFallback = (): CategoryLabelLayout => {
        let rotation = longest > band - 4 ? -90 : 0;
        /* diagonal labels grow up-and-left and clip on a scrolling plot */
        if (rotation === -90 && longest <= band * 1.6) {
            rotation = -45;
        }
        const projected =
            rotation === -90 ? longest : longest * Math.sin((Math.abs(rotation) * Math.PI) / 180);
        return {
            mode: "rotate",
            rotation,
            lines: [],
            lineHeight: xLabelLineH,
            areaH: rotation === 0 ? xLabelLineH + 4 : Math.min(ca.maxLabelHeight.value, projected + 8)
        };
    };

    if (rotSetting !== "auto") {
        const rotation = parseInt(rotSetting, 10) || 0;
        if (rotation === 0) {
            return { mode: "horizontal", rotation: 0, lines: [], lineHeight: xLabelLineH, areaH: xLabelLineH + 4 };
        }
        const projected =
            rotation === -90 ? longest : longest * Math.sin((Math.abs(rotation) * Math.PI) / 180);
        return {
            mode: "rotate",
            rotation,
            lines: [],
            lineHeight: xLabelLineH,
            areaH: Math.min(ca.maxLabelHeight.value, projected + 8)
        };
    }

    if (longest <= maxLineW) {
        return { mode: "horizontal", rotation: 0, lines: [], lineHeight: xLabelLineH, areaH: xLabelLineH + 4 };
    }

    /* try wrapping before falling back to slanted/vertical text */
    const wrapped = cats.map((c) => wrapWords(c.label, xFontStr, maxLineW));
    const anyWordTooWide = wrapped.some((ls) => ls.some((l) => measureText(l, xFontStr) > maxLineW));
    const neededLines = wrapped.reduce((m, ls) => Math.max(m, ls.length), 1);
    const maxLines = Math.max(2, Math.floor(ca.maxLabelHeight.value / xLabelLineH));
    if (!anyWordTooWide && neededLines <= maxLines) {
        return {
            mode: "wrap",
            rotation: 0,
            lines: wrapped,
            lineHeight: xLabelLineH,
            areaH: Math.min(ca.maxLabelHeight.value, neededLines * xLabelLineH + 4)
        };
    }

    return rotateFallback();
}

/* ------------------------------------------------------------------ */
/* ticks                                                               */
/* ------------------------------------------------------------------ */

function niceStep(span: number, target: number): number {
    if (!isFinite(span) || span <= 0) {
        return 1;
    }
    const step0 = span / Math.max(1, target);
    const mag = Math.pow(10, Math.floor(Math.log(step0) / Math.LN10));
    const norm = step0 / mag;
    if (norm < 1.5) {
        return mag;
    }
    if (norm < 3) {
        return 2 * mag;
    }
    if (norm < 7) {
        return 5 * mag;
    }
    return 10 * mag;
}

export function ticksFor(min: number, max: number, target: number, extend: boolean): number[] {
    const step = niceStep(max - min, target);
    const out: number[] = [];
    const first = extend ? Math.floor(min / step) * step : Math.ceil(min / step) * step;
    const last = extend ? Math.ceil(max / step) * step : max;
    for (let v = first; v <= last + step / 1e6; v += step) {
        out.push(Math.abs(v) < step / 1e6 ? 0 : v);
    }
    if (!out.length) {
        out.push(min);
    }
    return out;
}

/* ------------------------------------------------------------------ */

export function buildFrame(
    root: HTMLElement,
    model: ChartModel,
    settings: VisualSettings,
    width: number,
    height: number,
    cb: ChartCallbacks,
    theme: Theme,
    req: FrameRequest,
    valueRange: { min: number; max: number },
    legendBuilder: (
        model: ChartModel,
        settings: VisualSettings,
        theme: Theme,
        cb: ChartCallbacks
    ) => HTMLElement
): Frame {
    if ((req.orientation || "vertical") === "horizontal") {
        return buildFrameHorizontal(
            root,
            model,
            settings,
            width,
            height,
            cb,
            theme,
            req,
            valueRange,
            legendBuilder
        );
    }

    const pa = settings.plotArea;
    const cats = model.categories;

    /* ---------------------------------------------- legend --------- */
    const legendPos = enumOf(settings.legend.position);
    const showLegend = settings.legend.show.value && model.series.length > 1;
    const legendNode = showLegend ? legendBuilder(model, settings, theme, cb) : null;
    const horizontalLegend = legendPos === "top" || legendPos === "bottom";

    const outer = document.createElement("div");
    outer.style.display = "flex";
    outer.style.flex = "1 1 auto";
    outer.style.minHeight = "0";
    outer.style.flexDirection = horizontalLegend ? "column" : "row";
    root.appendChild(outer);

    const plotHost = document.createElement("div");
    plotHost.style.display = "flex";
    plotHost.style.flexDirection = "column";
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

    const availW = Math.max(40, width - legendW - padL - padR - 2 * pa.borderWidth.value);
    const availH = Math.max(40, height - legendH - padT - padB - 2 * pa.borderWidth.value);

    /* ---------------------------------------------- value range ---- */
    const va = settings.valueAxis;
    const userStart = va.start.value;
    const userEnd = va.end.value;
    let yMin =
        userStart !== null && userStart !== undefined
            ? userStart
            : req.includeZero
            ? Math.min(0, valueRange.min)
            : valueRange.min;
    let yMax = userEnd !== null && userEnd !== undefined ? userEnd : valueRange.max;
    if (yMax <= yMin) {
        yMax = yMin + 1;
    }

    /* gridline density follows plot height, capped by the user's setting */
    const roughSpan = Math.max(40, availH - 60);
    const tickTarget = Math.max(2, Math.min(va.tickCount.value || 5, Math.round(roughSpan / 85)));
    const ticks = ticksFor(yMin, yMax, tickTarget, req.extendToNiceMax);
    if (req.extendToNiceMax) {
        if (userStart === null || userStart === undefined) {
            yMin = Math.min(yMin, ticks[0]);
        }
        if (userEnd === null || userEnd === undefined) {
            yMax = Math.max(yMax, ticks[ticks.length - 1]);
        }
    }

    const valueFormatter = createFormatter(
        req.valueFormat !== undefined && req.valueFormat !== null ? req.valueFormat : model.measureFormat,
        parseInt(enumOf(va.displayUnits), 10),
        va.precision.value,
        Math.max(Math.abs(yMax), Math.abs(yMin))
    );

    /*
     * Secondary axis. The interval count is copied from the primary axis so the two
     * scales share gridlines - a combo chart with its own set of secondary
     * gridlines reads as a mess.
     */
    const sa = settings.secondaryAxis;
    const hasSecondary = !!req.secondary && sa.show.value;
    let y2Min = 0;
    let y2Max = 1;
    const y2Ticks: number[] = [];
    if (hasSecondary) {
        const intervals = Math.max(1, ticks.length - 1);
        const s0 = sa.start.value;
        const s1 = sa.end.value;
        y2Min = s0 !== null && s0 !== undefined ? s0 : Math.min(0, req.secondary.min);
        let rawMax = s1 !== null && s1 !== undefined ? s1 : req.secondary.max;
        if (rawMax <= y2Min) {
            rawMax = y2Min + 1;
        }
        const step2 = niceStep(rawMax - y2Min, intervals);
        y2Max = s1 !== null && s1 !== undefined ? rawMax : y2Min + step2 * intervals;
        for (let i = 0; i <= intervals; i++) {
            y2Ticks.push(y2Min + ((y2Max - y2Min) * i) / intervals);
        }
    }
    const secondaryFormatter = createFormatter(
        model.secondaryFormat,
        parseInt(enumOf(sa.displayUnits), 10),
        sa.precision.value,
        Math.max(Math.abs(y2Max), Math.abs(y2Min))
    );

    /* ---------------------------------------------- axis metrics --- */
    const yFontStr = fontString(va.font);
    const yLabelH = textHeight(va.font);
    let yAxisW = 0;
    const tickLabels: string[] = [];
    if (va.show.value) {
        ticks.forEach((t) => {
            const s = valueFormatter.format(t);
            tickLabels.push(s);
            yAxisW = Math.max(yAxisW, measureText(s, yFontStr));
        });
        yAxisW += TICK_PAD;
        if (va.showTitle.value) {
            yAxisW += textHeight(va.titleFont) + 2;
        }
    }

    const y2FontStr = fontString(sa.font);
    const y2Labels: string[] = [];
    let y2AxisW = 0;
    if (hasSecondary) {
        y2Ticks.forEach((t) => {
            const s = secondaryFormatter.format(t);
            y2Labels.push(s);
            y2AxisW = Math.max(y2AxisW, measureText(s, y2FontStr));
        });
        y2AxisW += TICK_PAD;
        if (sa.showTitle.value) {
            y2AxisW += textHeight(sa.titleFont) + 2;
        }
    }

    const ca = settings.categoryAxis;
    const xFontStr = fontString(ca.font);
    const xLabelLineH = textHeight(ca.font);

    const plotW = Math.max(30, availW - yAxisW - y2AxisW);
    const bandCount = cats.length;
    const bandNeeded = req.fixedBandWidth !== null ? req.fixedBandWidth : req.minBandWidth;
    const requiredW = bandCount * bandNeeded;
    const needsScroll = requiredW > plotW + 0.5;
    const innerPlotW = needsScroll ? requiredW : plotW;
    const scrollH = needsScroll ? SCROLLBAR : 0;
    const band = innerPlotW / Math.max(1, bandCount);

    /* x label height + rotation/wrap */
    let xLabelAreaH = 0;
    let catLabelLayout: CategoryLabelLayout | undefined;
    if (ca.show.value) {
        catLabelLayout = computeCategoryLabelLayout(cats, ca, xFontStr, xLabelLineH, band);
        xLabelAreaH = catLabelLayout.areaH;
    }
    let xTitleH = 0;
    if (ca.show.value && ca.showTitle.value) {
        xTitleH = textHeight(ca.titleFont) + 4;
    }

    const plotH = Math.max(20, availH - xLabelAreaH - xTitleH - scrollH);
    const gut = Math.min(plotH / 3, Math.max(0, req.gutter));
    const plotTop = gut;
    const plotBottom = plotH - gut;
    const plotSpan = Math.max(10, plotBottom - plotTop);

    /*
     * The scales clamp rather than trust. dataModel already drops a measure value
     * that is not a finite number, so nothing should arrive here broken - but a
     * single NaN reaching an SVG coordinate produces a console error per mark, and
     * a console error is an automatic certification failure. Mapping it to the zero
     * line costs nothing and makes that impossible whatever the model returns.
     */
    const safe = (v: number): number => (isFinite(v) ? v : Math.max(yMin, Math.min(0, yMax)));
    const yScale = (v: number) =>
        plotTop + plotSpan - ((safe(v) - yMin) / (yMax - yMin)) * plotSpan;
    const y2Scale = hasSecondary
        ? (v: number) => plotTop + plotSpan - ((v - y2Min) / (y2Max - y2Min)) * plotSpan
        : yScale;
    const xAt = (i: number) => i * band + band / 2;
    const zeroY = yScale(Math.max(yMin, Math.min(0, yMax)));

    /* ---------------------------------------------- containers ----- */
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flex = "1 1 auto";
    wrap.style.minWidth = "0";
    wrap.style.padding = `${padT}px ${padR}px ${padB}px ${padL}px`;
    wrap.style.boxSizing = "border-box";
    plotHost.appendChild(wrap);

    /* --- pinned Y axis ------------------------------------------- */
    if (va.show.value) {
        const ySvg = svgEl("svg");
        attrs(ySvg, { width: yAxisW, height: plotH + xLabelAreaH });
        ySvg.style.flex = "0 0 auto";
        ySvg.style.overflow = "visible";

        if (va.showTitle.value) {
            const t = svgEl("text");
            attrs(t, {
                x: -(plotH / 2),
                y: textHeight(va.titleFont) - 4,
                transform: "rotate(-90)",
                "text-anchor": "middle",
                fill: theme.isHighContrast ? theme.foreground : colorOf(va.titleFontColor)
            });
            applySvgFont(t, va.titleFont);
            /* the title is centred on plotH and runs along it - on a short plot (e.g.
               once the granularity switch eats a row) an untruncated title overflows
               above the plot and disappears behind the opaque control bar */
            t.textContent = truncate(
                va.titleText.value || model.measureName,
                fontString(va.titleFont),
                Math.max(20, plotH - 8)
            );
            ySvg.appendChild(t);
        }

        ticks.forEach((tv, i) => {
            if (tv < yMin - 1e-9 || tv > yMax + 1e-9) {
                return;
            }
            const t = svgEl("text");
            attrs(t, {
                x: yAxisW - TICK_PAD,
                y: yScale(tv) + yLabelH / 3,
                "text-anchor": "end",
                fill: theme.isHighContrast ? theme.foreground : colorOf(va.fontColor)
            });
            applySvgFont(t, va.font);
            t.textContent = tickLabels[i];
            ySvg.appendChild(t);
        });

        if (va.showAxisLine.value) {
            const line = svgEl("line");
            attrs(line, {
                x1: yAxisW - 0.5,
                x2: yAxisW - 0.5,
                y1: plotTop,
                y2: plotBottom,
                stroke: theme.isHighContrast ? theme.foreground : colorOf(va.axisLineColor),
                "stroke-width": 1
            });
            ySvg.appendChild(line);
        }
        wrap.appendChild(ySvg);
    }

    /* --- scrollable plot ---------------------------------------- */
    const scroller = document.createElement("div");
    scroller.className = "dbx-plot-scroll";
    scroller.style.flex = "1 1 auto";
    scroller.style.minWidth = "0";
    scroller.style.overflowX = needsScroll ? "auto" : "visible";
    scroller.style.overflowY = needsScroll ? "hidden" : "visible";
    wrap.appendChild(scroller);

    const svg = svgEl("svg");
    attrs(svg, {
        width: innerPlotW,
        height: plotH + xLabelAreaH,
        role: "group",
        "aria-label": `${model.measureName} by ${model.activeAxis ? model.activeAxis.label : ""}`
    });
    svg.style.display = "block";
    svg.style.overflow = needsScroll ? "hidden" : "visible";
    scroller.appendChild(svg);

    /* --- gridlines ---------------------------------------------- */
    if (va.showGridlines.value) {
        const g = svgEl("g");
        ticks.forEach((tv) => {
            if (tv < yMin - 1e-9 || tv > yMax + 1e-9) {
                return;
            }
            const l = svgEl("line");
            attrs(l, {
                x1: 0,
                x2: innerPlotW,
                y1: yScale(tv),
                y2: yScale(tv),
                stroke: theme.isHighContrast ? theme.foreground : colorOf(va.gridlineColor),
                "stroke-width": va.gridlineWidth.value,
                "stroke-dasharray": dashArray(enumOf(va.gridlineStyle), va.gridlineWidth.value)
            });
            g.appendChild(l);
        });
        svg.appendChild(g);
    }
    if (ca.showGridlines.value) {
        const g = svgEl("g");
        cats.forEach((c, i) => {
            const l = svgEl("line");
            attrs(l, {
                x1: xAt(i),
                x2: xAt(i),
                y1: plotTop,
                y2: plotBottom,
                stroke: theme.isHighContrast ? theme.foreground : colorOf(ca.gridlineColor),
                "stroke-width": ca.gridlineWidth.value,
                "stroke-dasharray": dashArray(enumOf(ca.gridlineStyle), ca.gridlineWidth.value)
            });
            g.appendChild(l);
            void c;
        });
        svg.appendChild(g);
    }

    /* --- pinned secondary axis, right-hand side ------------------ */
    if (hasSecondary) {
        const y2Svg = svgEl("svg");
        attrs(y2Svg, { width: y2AxisW, height: plotH + xLabelAreaH });
        y2Svg.style.flex = "0 0 auto";
        y2Svg.style.overflow = "visible";

        y2Ticks.forEach((tv, i) => {
            const t = svgEl("text");
            attrs(t, {
                x: TICK_PAD,
                y: y2Scale(tv) + textHeight(sa.font) / 3,
                "text-anchor": "start",
                fill: theme.isHighContrast ? theme.foreground : colorOf(sa.fontColor)
            });
            applySvgFont(t, sa.font);
            t.textContent = y2Labels[i];
            y2Svg.appendChild(t);
        });

        if (sa.showTitle.value) {
            const t = svgEl("text");
            attrs(t, {
                x: plotH / 2,
                y: -(y2AxisW - textHeight(sa.titleFont)),
                transform: "rotate(90)",
                "text-anchor": "middle",
                fill: theme.isHighContrast ? theme.foreground : colorOf(sa.titleFontColor)
            });
            applySvgFont(t, sa.titleFont);
            t.textContent = truncate(
                sa.titleText.value || model.secondaryName || "",
                fontString(sa.titleFont),
                Math.max(20, plotH - 8)
            );
            y2Svg.appendChild(t);
        }
        wrap.appendChild(y2Svg);
    }

    return {
        svg,
        plotHost,
        scroller,
        orientation: "vertical",
        innerPlotW,
        plotH,
        band,
        catAt: xAt,
        valueAt: yScale,
        value2At: y2Scale,
        hasSecondary,
        xAt,
        yScale,
        plotTop,
        plotBottom,
        yMin,
        yMax,
        y2Min,
        y2Max,
        zeroY,
        needsScroll,
        yAxisW,
        valueFormatter,
        secondaryFormatter,
        plotBox: { x1: 0, y1: 0, x2: innerPlotW, y2: plotH },
        catLabelLayout,
        rectFor: (c: number, v0: number, v1: number, t: number): Rect => {
            const a = yScale(v0);
            const b = yScale(v1);
            return {
                x: c - t / 2,
                y: Math.min(a, b),
                width: t,
                height: Math.abs(b - a)
            };
        }
    };
}

/**
 * Drawn after the marks so the category axis line, labels, scrollbar and pinned
 * title sit on top of / below them.
 */
export function finishFrame(
    frame: Frame,
    model: ChartModel,
    settings: VisualSettings,
    theme: Theme,
    cb: ChartCallbacks
): void {
    if (frame.orientation === "horizontal") {
        finishFrameHorizontal(frame, model, settings, theme, cb);
        return;
    }
    const ca = settings.categoryAxis;
    const cats = model.categories;
    const { svg, innerPlotW, plotH, band, xAt } = frame;

    if (ca.showAxisLine.value) {
        const l = svgEl("line");
        attrs(l, {
            x1: 0,
            x2: innerPlotW,
            y1: frame.zeroY,
            y2: frame.zeroY,
            stroke: theme.isHighContrast ? theme.foreground : colorOf(ca.axisLineColor),
            "stroke-width": 1
        });
        svg.appendChild(l);
    }

    if (ca.show.value) {
        const xFontStr = fontString(ca.font);
        const xLabelLineH = textHeight(ca.font);
        const layout = frame.catLabelLayout || computeCategoryLabelLayout(cats, ca, xFontStr, xLabelLineH, band);
        const rotation = layout.rotation;

        const g = svgEl("g");
        const fill = theme.isHighContrast ? theme.foreground : colorOf(ca.fontColor);
        cats.forEach((c, i) => {
            const cx = xAt(i);
            const t = svgEl("text");
            applySvgFont(t, ca.font);
            attrs(t, { fill });
            if (layout.mode === "wrap") {
                attrs(t, { x: cx, y: plotH + xLabelLineH, "text-anchor": "middle" });
                const lines = layout.lines[i] && layout.lines[i].length ? layout.lines[i] : [c.label];
                lines.forEach((line, li) => {
                    const tspan = svgEl("tspan");
                    attrs(tspan, { x: cx, dy: li === 0 ? 0 : xLabelLineH });
                    tspan.textContent = line;
                    t.appendChild(tspan);
                });
            } else if (rotation === 0) {
                attrs(t, { x: cx, y: plotH + xLabelLineH, "text-anchor": "middle" });
                t.textContent = truncate(c.label, xFontStr, band - 2);
            } else {
                const rad = (Math.abs(rotation) * Math.PI) / 180;
                const sin = Math.sin(rad) || 1;
                const cos = Math.cos(rad);
                const byHeight = ca.maxLabelHeight.value / sin;
                const leftRoom = cx + (frame.needsScroll ? 0 : frame.yAxisW);
                const byLeft = cos > 0.01 ? leftRoom / cos : Number.POSITIVE_INFINITY;
                attrs(t, {
                    x: cx,
                    y: plotH + 4,
                    "text-anchor": "end",
                    transform: `rotate(${rotation}, ${cx}, ${plotH + 4})`,
                    dy: rotation === -90 ? "0.34em" : "0.7em"
                });
                t.textContent = truncate(c.label, xFontStr, Math.max(20, Math.min(byHeight, byLeft)));
            }
            const title = svgEl("title");
            title.textContent = c.label;
            t.appendChild(title);
            g.appendChild(t);
        });
        svg.appendChild(g);
    }

    if (ca.show.value && ca.showTitle.value) {
        const xTitleH = textHeight(ca.titleFont) + 4;
        const titleEl = document.createElement("div");
        titleEl.className = "dbx-x-title";
        titleEl.textContent = ca.titleText.value || (model.activeAxis ? model.activeAxis.label : "");
        const f = cssFont(ca.titleFont);
        Object.keys(f).forEach((k) => titleEl.style.setProperty(k, f[k]));
        titleEl.style.color = theme.isHighContrast ? theme.foreground : colorOf(ca.titleFontColor);
        titleEl.style.height = `${xTitleH}px`;
        titleEl.style.lineHeight = `${xTitleH}px`;
        titleEl.style.marginLeft = `${frame.yAxisW}px`;
        frame.plotHost.appendChild(titleEl);
    }

    /* appended after the title so the scrollbar sits below it, not between the
       plot and its axis title */
    if (frame.needsScroll) {
        buildScrollbar(frame.plotHost, frame.scroller, frame.yAxisW);
    }

    svg.addEventListener("click", (e) => {
        if (e.target === svg) {
            cb.onSelect([], false);
        }
    });
}

/* ------------------------------------------------------------------ */
/* horizontal frame (bar charts)                                       */
/*                                                                     */
/* Same contract as the vertical builder, axes swapped: categories run  */
/* down the left, values along the bottom, and the plot scrolls         */
/* vertically instead of horizontally.                                  */
/* ------------------------------------------------------------------ */

function buildFrameHorizontal(
    root: HTMLElement,
    model: ChartModel,
    settings: VisualSettings,
    width: number,
    height: number,
    cb: ChartCallbacks,
    theme: Theme,
    req: FrameRequest,
    valueRange: { min: number; max: number },
    legendBuilder: (
        model: ChartModel,
        settings: VisualSettings,
        theme: Theme,
        cb: ChartCallbacks
    ) => HTMLElement
): Frame {
    const pa = settings.plotArea;
    const va = settings.valueAxis;
    const ca = settings.categoryAxis;
    const cats = model.categories;

    /* ---------------------------------------------- legend --------- */
    const legendPos = enumOf(settings.legend.position);
    const showLegend = settings.legend.show.value && model.series.length > 1;
    const legendNode = showLegend ? legendBuilder(model, settings, theme, cb) : null;
    const horizontalLegend = legendPos === "top" || legendPos === "bottom";

    const outer = document.createElement("div");
    outer.style.display = "flex";
    outer.style.flex = "1 1 auto";
    outer.style.minHeight = "0";
    outer.style.flexDirection = horizontalLegend ? "column" : "row";
    root.appendChild(outer);

    const plotHost = document.createElement("div");
    plotHost.style.display = "flex";
    plotHost.style.flexDirection = "column";
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
    const availW = Math.max(60, width - legendW - padL - padR - 2 * pa.borderWidth.value);
    const availH = Math.max(40, height - legendH - padT - padB - 2 * pa.borderWidth.value);

    /* ---------------------------------------------- value range ---- */
    const userStart = va.start.value;
    const userEnd = va.end.value;
    let yMin =
        userStart !== null && userStart !== undefined
            ? userStart
            : req.includeZero
            ? Math.min(0, valueRange.min)
            : valueRange.min;
    let yMax = userEnd !== null && userEnd !== undefined ? userEnd : valueRange.max;
    if (yMax <= yMin) {
        yMax = yMin + 1;
    }

    /* tick density follows plot width here, not height */
    const tickTarget = Math.max(2, Math.min(va.tickCount.value || 5, Math.round(availW / 110)));
    const ticks = ticksFor(yMin, yMax, tickTarget, req.extendToNiceMax);
    if (req.extendToNiceMax) {
        if (userStart === null || userStart === undefined) {
            yMin = Math.min(yMin, ticks[0]);
        }
        if (userEnd === null || userEnd === undefined) {
            yMax = Math.max(yMax, ticks[ticks.length - 1]);
        }
    }

    const valueFormatter = createFormatter(
        req.valueFormat !== undefined && req.valueFormat !== null ? req.valueFormat : model.measureFormat,
        parseInt(enumOf(va.displayUnits), 10),
        va.precision.value,
        Math.max(Math.abs(yMax), Math.abs(yMin))
    );

    /* ---------------------------------------------- metrics -------- */
    const catFontStr = fontString(ca.font);
    const maxLabelW = settings.columnSettings.maxLabelWidth.value || 160;
    let catAxisW = 0;
    if (ca.show.value) {
        const longest = cats.reduce((m, c) => Math.max(m, measureText(c.label, catFontStr)), 0);
        catAxisW = Math.min(maxLabelW, longest) + TICK_PAD;
    }

    /* rotated category-axis title, pinned outside the scroller */
    const catTitleW = ca.show.value && ca.showTitle.value ? textHeight(ca.titleFont) + 4 : 0;

    const valueAxisH = va.show.value ? textHeight(va.font) + TICK_PAD : 0;
    const valueTitleH = va.show.value && va.showTitle.value ? textHeight(va.titleFont) + 4 : 0;

    const bandCount = cats.length;
    const bandNeeded = req.fixedBandWidth !== null ? req.fixedBandWidth : req.minBandWidth;
    const requiredH = bandCount * bandNeeded;
    const visibleH = Math.max(30, availH - valueAxisH - valueTitleH);
    const needsScroll = requiredH > visibleH + 0.5;
    const innerPlotH = needsScroll ? requiredH : visibleH;
    const band = innerPlotH / Math.max(1, bandCount);

    const scrollW = needsScroll ? SCROLLBAR : 0;
    const plotW = Math.max(40, availW - catTitleW - scrollW);
    const gut = Math.min(plotW / 3, Math.max(0, req.gutter));
    const valueSpan = Math.max(10, plotW - catAxisW - gut);

    /* see the note on `safe` in the vertical frame */
    const safeH = (v: number): number => (isFinite(v) ? v : Math.max(yMin, Math.min(0, yMax)));
    const valueAt = (v: number) => catAxisW + ((safeH(v) - yMin) / (yMax - yMin)) * valueSpan;
    const catAt = (i: number) => i * band + band / 2;
    const zeroX = valueAt(Math.max(yMin, Math.min(0, yMax)));

    /* ---------------------------------------------- containers ----- */
    const wrapRow = document.createElement("div");
    wrapRow.style.display = "flex";
    wrapRow.style.flex = "1 1 auto";
    wrapRow.style.minHeight = "0";
    wrapRow.style.padding = `${padT}px ${padR}px 0 ${padL}px`;
    wrapRow.style.boxSizing = "border-box";
    plotHost.appendChild(wrapRow);

    if (catTitleW) {
        const tSvg = svgEl("svg");
        attrs(tSvg, { width: catTitleW, height: visibleH });
        tSvg.style.flex = "0 0 auto";
        const t = svgEl("text");
        attrs(t, {
            x: -(visibleH / 2),
            y: textHeight(ca.titleFont) - 4,
            transform: "rotate(-90)",
            "text-anchor": "middle",
            fill: theme.isHighContrast ? theme.foreground : colorOf(ca.titleFontColor)
        });
        applySvgFont(t, ca.titleFont);
        t.textContent = truncate(
            ca.titleText.value || (model.activeAxis ? model.activeAxis.label : ""),
            fontString(ca.titleFont),
            Math.max(20, visibleH - 8)
        );
        tSvg.appendChild(t);
        wrapRow.appendChild(tSvg);
    }

    const scroller = document.createElement("div");
    scroller.className = "dbx-plot-scroll";
    scroller.style.flex = "1 1 auto";
    scroller.style.minHeight = "0";
    scroller.style.overflowY = needsScroll ? "auto" : "visible";
    scroller.style.overflowX = "hidden";
    wrapRow.appendChild(scroller);

    const svg = svgEl("svg");
    attrs(svg, {
        width: plotW,
        height: innerPlotH,
        role: "group",
        "aria-label": `${model.measureName} by ${model.activeAxis ? model.activeAxis.label : ""}`
    });
    svg.style.display = "block";
    scroller.appendChild(svg);

    /* --- gridlines ---------------------------------------------- */
    if (va.showGridlines.value) {
        const g = svgEl("g");
        ticks.forEach((tv) => {
            if (tv < yMin - 1e-9 || tv > yMax + 1e-9) {
                return;
            }
            const l = svgEl("line");
            attrs(l, {
                x1: valueAt(tv),
                x2: valueAt(tv),
                y1: 0,
                y2: innerPlotH,
                stroke: theme.isHighContrast ? theme.foreground : colorOf(va.gridlineColor),
                "stroke-width": va.gridlineWidth.value,
                "stroke-dasharray": dashArray(enumOf(va.gridlineStyle), va.gridlineWidth.value)
            });
            g.appendChild(l);
        });
        svg.appendChild(g);
    }
    if (ca.showGridlines.value) {
        const g = svgEl("g");
        cats.forEach((c, i) => {
            const l = svgEl("line");
            attrs(l, {
                x1: catAxisW,
                x2: catAxisW + valueSpan,
                y1: catAt(i),
                y2: catAt(i),
                stroke: theme.isHighContrast ? theme.foreground : colorOf(ca.gridlineColor),
                "stroke-width": ca.gridlineWidth.value,
                "stroke-dasharray": dashArray(enumOf(ca.gridlineStyle), ca.gridlineWidth.value)
            });
            g.appendChild(l);
            void c;
        });
        svg.appendChild(g);
    }

    /* --- pinned value axis along the bottom --------------------- */
    if (va.show.value) {
        const axSvg = svgEl("svg");
        attrs(axSvg, { width: plotW, height: valueAxisH });
        axSvg.style.flex = "0 0 auto";
        axSvg.style.marginLeft = `${catTitleW + padL}px`;
        axSvg.style.overflow = "visible";
        ticks.forEach((tv, i) => {
            if (tv < yMin - 1e-9 || tv > yMax + 1e-9) {
                return;
            }
            const t = svgEl("text");
            attrs(t, {
                x: valueAt(tv),
                y: textHeight(va.font) - 4,
                "text-anchor": "middle",
                fill: theme.isHighContrast ? theme.foreground : colorOf(va.fontColor)
            });
            applySvgFont(t, va.font);
            t.textContent = valueFormatter.format(tv);
            axSvg.appendChild(t);
            void i;
        });
        if (va.showAxisLine.value) {
            const l = svgEl("line");
            attrs(l, {
                x1: catAxisW,
                x2: catAxisW + valueSpan,
                y1: 0.5,
                y2: 0.5,
                stroke: theme.isHighContrast ? theme.foreground : colorOf(va.axisLineColor),
                "stroke-width": 1
            });
            axSvg.appendChild(l);
        }
        plotHost.appendChild(axSvg);
    }

    if (valueTitleH) {
        const titleEl = document.createElement("div");
        titleEl.className = "dbx-x-title";
        titleEl.textContent = va.titleText.value || model.measureName;
        const f = cssFont(va.titleFont);
        Object.keys(f).forEach((k) => titleEl.style.setProperty(k, f[k]));
        titleEl.style.color = theme.isHighContrast ? theme.foreground : colorOf(va.titleFontColor);
        titleEl.style.height = `${valueTitleH}px`;
        titleEl.style.lineHeight = `${valueTitleH}px`;
        titleEl.style.marginLeft = `${catTitleW + catAxisW + padL}px`;
        titleEl.style.width = `${valueSpan}px`;
        plotHost.appendChild(titleEl);
    }

    return {
        svg,
        plotHost,
        scroller,
        orientation: "horizontal",
        innerPlotW: plotW,
        plotH: innerPlotH,
        band,
        catAt,
        valueAt,
        value2At: valueAt,
        hasSecondary: false,
        xAt: catAt,
        yScale: valueAt,
        plotTop: 0,
        plotBottom: innerPlotH,
        yMin,
        yMax,
        y2Min: yMin,
        y2Max: yMax,
        zeroY: zeroX,
        needsScroll,
        yAxisW: catAxisW,
        valueFormatter,
        secondaryFormatter: valueFormatter,
        plotBox: { x1: catAxisW, y1: 0, x2: plotW, y2: innerPlotH },
        rectFor: (c: number, v0: number, v1: number, t: number): Rect => {
            const a = valueAt(v0);
            const b = valueAt(v1);
            return {
                x: Math.min(a, b),
                y: c - t / 2,
                width: Math.abs(b - a),
                height: t
            };
        }
    };
}

function finishFrameHorizontal(
    frame: Frame,
    model: ChartModel,
    settings: VisualSettings,
    theme: Theme,
    cb: ChartCallbacks
): void {
    const ca = settings.categoryAxis;
    const cats = model.categories;
    const { svg, band, catAt, yAxisW } = frame;

    if (ca.showAxisLine.value) {
        const l = svgEl("line");
        attrs(l, {
            x1: frame.zeroY,
            x2: frame.zeroY,
            y1: 0,
            y2: frame.plotH,
            stroke: theme.isHighContrast ? theme.foreground : colorOf(ca.axisLineColor),
            "stroke-width": 1
        });
        svg.appendChild(l);
    }

    if (ca.show.value) {
        const fontStr = fontString(ca.font);
        const lineH = textHeight(ca.font);
        const g = svgEl("g");
        const fill = theme.isHighContrast ? theme.foreground : colorOf(ca.fontColor);
        cats.forEach((c, i) => {
            const t = svgEl("text");
            applySvgFont(t, ca.font);
            attrs(t, {
                x: yAxisW - TICK_PAD,
                y: catAt(i) + lineH / 3,
                "text-anchor": "end",
                fill
            });
            t.textContent = truncate(c.label, fontStr, Math.max(20, yAxisW - TICK_PAD));
            const title = svgEl("title");
            title.textContent = c.label;
            t.appendChild(title);
            g.appendChild(t);
            void band;
        });
        svg.appendChild(g);
    }

    if (frame.needsScroll) {
        buildVerticalScrollbar(frame.scroller);
    }

    svg.addEventListener("click", (e) => {
        if (e.target === svg) {
            cb.onSelect([], false);
        }
    });
}

/* ------------------------------------------------------------------ */
/* shared leaf helpers                                                 */
/* ------------------------------------------------------------------ */

export function applySvgFont(el: SVGElement, font): void {
    el.setAttribute("font-family", font.fontFamily.value || "Segoe UI");
    el.setAttribute("font-size", `${font.fontSize.value || 10}pt`);
    el.setAttribute("font-weight", font.bold && font.bold.value ? "bold" : "normal");
    el.setAttribute("font-style", font.italic && font.italic.value ? "italic" : "normal");
    if (font.underline && font.underline.value) {
        el.setAttribute("text-decoration", "underline");
    }
}

export function markerShape(shape: string, x: number, y: number, size: number): SVGElement {
    const h = size / 2;
    if (shape === "circle") {
        const el = svgEl("circle");
        attrs(el, { cx: x, cy: y, r: h });
        return el;
    }
    if (shape === "square") {
        const el = svgEl("rect");
        attrs(el, { x: x - h, y: y - h, width: size, height: size });
        return el;
    }
    if (shape === "triangle") {
        const el = svgEl("polygon");
        attrs(el, { points: `${x},${y - h} ${x + h},${y + h} ${x - h},${y + h}` });
        return el;
    }
    /* diamond - the marker used across the Darwinbox trend charts */
    const el = svgEl("polygon");
    attrs(el, { points: `${x},${y - h} ${x + h},${y} ${x},${y + h} ${x - h},${y}` });
    return el;
}

export function attachMarkHandlers(
    shape: SVGElement,
    cat: CategoryDatum,
    cell: CellDatum,
    ids: ISelectionId[],
    model: ChartModel,
    cb: ChartCallbacks,
    fmt: IValueFormatter,
    extra?: powerbi.extensibility.VisualTooltipDataItem[]
): void {
    const rows = cell.rowIndices;
    const series = model.series[cell.seriesIndex];
    const build = (): powerbi.extensibility.VisualTooltipDataItem[] => {
        const items: powerbi.extensibility.VisualTooltipDataItem[] = [
            {
                displayName: model.activeAxis ? model.activeAxis.label : "Category",
                value: cat.label
            },
            {
                displayName: model.series.length > 1 ? series.label : model.measureName,
                value: fmt.format(cell.value),
                color: series.color
            }
        ];
        (extra || []).forEach((e) => items.push(e));
        (cell.tooltipValues || []).forEach((t) =>
            items.push({ displayName: t.name, value: fmt.format(t.value) })
        );
        return items;
    };

    shape.addEventListener("click", (e: MouseEvent) => {
        e.stopPropagation();
        cb.onSelect(ids, e.ctrlKey || e.metaKey || e.shiftKey, rows, cell.seriesIndex);
    });
    shape.addEventListener("contextmenu", (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        cb.onContextMenu(ids[0], e.clientX, e.clientY);
    });
    shape.addEventListener("mouseover", (e: MouseEvent) =>
        cb.onTooltip(build(), ids, e.clientX, e.clientY)
    );
    shape.addEventListener("mousemove", (e: MouseEvent) => cb.onTooltipMove(e.clientX, e.clientY));
    shape.addEventListener("mouseout", () => cb.onTooltipHide());
    shape.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            cb.onSelect(ids, e.ctrlKey || e.metaKey || e.shiftKey, rows, cell.seriesIndex);
        }
    });
    shape.addEventListener("focus", () => {
        const r = (shape as SVGGraphicsElement).getBoundingClientRect();
        cb.onTooltip(build(), ids, r.left + r.width / 2, r.top);
    });
    shape.addEventListener("blur", () => cb.onTooltipHide());
}

export function buildLegend(
    model: ChartModel,
    settings: VisualSettings,
    theme: Theme,
    cb: ChartCallbacks
): HTMLElement {
    const lg = settings.legend;
    const pos = enumOf(lg.position);
    const vertical = pos === "left" || pos === "right";
    const align = enumOf(lg.align);

    const el = document.createElement("div");
    el.className = "dbx-legend";
    el.style.display = "flex";
    el.style.flexDirection = vertical ? "column" : "row";
    el.style.flexWrap = "wrap";
    el.style.alignItems = vertical ? "flex-start" : "center";
    el.style.justifyContent =
        align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start";
    el.style.gap = "12px";
    el.style.padding = "2px 8px 6px";
    el.style.maxHeight = vertical ? "100%" : "60px";
    el.style.overflow = "auto";
    el.style.flex = "0 0 auto";

    if (lg.showTitle.value) {
        const t = document.createElement("span");
        t.textContent = lg.titleText.value || "";
        t.style.fontWeight = "600";
        t.style.color = theme.isHighContrast ? theme.foreground : colorOf(lg.fontColor);
        applyHtmlFont(t, lg.font);
        el.appendChild(t);
    }

    const shape = enumOf(lg.markerShape);
    const size = lg.markerSize.value || 8;

    model.series.forEach((s) => {
        const item = document.createElement("div");
        item.style.display = "flex";
        item.style.alignItems = "center";
        item.style.gap = "4px";
        item.style.cursor = "pointer";
        item.setAttribute("role", "button");
        item.setAttribute("tabindex", "0");
        item.setAttribute("aria-label", s.label);

        const color = theme.isHighContrast ? theme.foreground : s.color;
        if (shape === "line") {
            const marker = document.createElement("span");
            marker.style.display = "inline-block";
            marker.style.width = `${size * 1.8}px`;
            marker.style.height = "3px";
            marker.style.background = color;
            item.appendChild(marker);
        } else {
            const svg = svgEl("svg");
            attrs(svg, { width: size + 4, height: size + 4 });
            const m = markerShape(shape, (size + 4) / 2, (size + 4) / 2, size);
            attrs(m, { fill: color });
            svg.appendChild(m);
            svg.style.display = "block";
            item.appendChild(svg);
        }

        const label = document.createElement("span");
        label.textContent = s.label;
        label.style.color = theme.isHighContrast ? theme.foreground : colorOf(lg.fontColor);
        applyHtmlFont(label, lg.font);
        item.appendChild(label);

        const ids = s.selectionId ? [s.selectionId] : [];
        item.onclick = (e: MouseEvent) => {
            e.stopPropagation();
            if (ids.length) {
                cb.onSelect(ids, e.ctrlKey || e.metaKey || e.shiftKey, [], s.index);
            }
        };
        item.onkeydown = (e: KeyboardEvent) => {
            if ((e.key === "Enter" || e.key === " ") && ids.length) {
                e.preventDefault();
                cb.onSelect(ids, e.ctrlKey || e.metaKey || e.shiftKey, [], s.index);
            }
        };
        if (cb.hasSelection() && ids.length && !cb.isSelected(ids)) {
            item.style.opacity = "0.4";
        }
        el.appendChild(item);
    });

    return el;
}

function applyHtmlFont(el: HTMLElement, font): void {
    el.style.fontFamily = font.fontFamily.value || "Segoe UI";
    el.style.fontSize = `${font.fontSize.value || 10}pt`;
    el.style.fontWeight = font.bold && font.bold.value ? "bold" : "normal";
    el.style.fontStyle = font.italic && font.italic.value ? "italic" : "normal";
    if (font.underline && font.underline.value) {
        el.style.textDecoration = "underline";
    }
}

/**
 * Bar charts scroll vertically. Same reason the horizontal one is hand-drawn:
 * Chromium's overlay scrollbars take no layout space and ignore CSS.
 */
function buildVerticalScrollbar(scroller: HTMLElement): void {
    const parent = scroller.parentNode as HTMLElement;
    if (!parent) {
        return;
    }
    const track = document.createElement("div");
    track.className = "dbx-vscroll-track";
    track.style.width = `${SCROLLBAR - 4}px`;

    const thumb = document.createElement("div");
    thumb.className = "dbx-vscroll-thumb";
    thumb.setAttribute("role", "scrollbar");
    thumb.setAttribute("aria-orientation", "vertical");
    thumb.setAttribute("aria-label", "Scroll categories");
    track.appendChild(thumb);
    parent.appendChild(track);

    const sync = (): void => {
        const trackH = track.clientHeight;
        const ratio = scroller.clientHeight / Math.max(1, scroller.scrollHeight);
        const thumbH = Math.max(24, Math.round(trackH * ratio));
        const maxTop = trackH - thumbH;
        const scrollable = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
        const top = Math.round((scroller.scrollTop / scrollable) * maxTop);
        thumb.style.height = `${thumbH}px`;
        thumb.style.transform = `translateY(${Math.max(0, Math.min(maxTop, top))}px)`;
    };
    scroller.addEventListener("scroll", sync);

    let dragging = false;
    let startY = 0;
    let startScroll = 0;
    const onMove = (e: MouseEvent): void => {
        if (!dragging) {
            return;
        }
        const maxTop = Math.max(1, track.clientHeight - thumb.offsetHeight);
        const scrollable = scroller.scrollHeight - scroller.clientHeight;
        scroller.scrollTop = startScroll + ((e.clientY - startY) / maxTop) * scrollable;
    };
    const onUp = (): void => {
        dragging = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
    };
    thumb.addEventListener("mousedown", (e: MouseEvent) => {
        e.preventDefault();
        dragging = true;
        startY = e.clientY;
        startScroll = scroller.scrollTop;
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    });
    track.addEventListener("mousedown", (e: MouseEvent) => {
        if (e.target === thumb) {
            return;
        }
        const rect = track.getBoundingClientRect();
        const ratio = (e.clientY - rect.top) / Math.max(1, rect.height);
        scroller.scrollTop = ratio * (scroller.scrollHeight - scroller.clientHeight);
    });

    sync();
    requestAnimationFrame(sync);
}

function buildScrollbar(plotHost: HTMLElement, scroller: HTMLElement, yAxisW: number): void {
    const track = document.createElement("div");
    track.className = "dbx-hscroll-track";
    track.style.marginLeft = `${yAxisW}px`;
    track.style.height = `${SCROLLBAR - 4}px`;

    const thumb = document.createElement("div");
    thumb.className = "dbx-hscroll-thumb";
    thumb.setAttribute("role", "scrollbar");
    thumb.setAttribute("aria-orientation", "horizontal");
    thumb.setAttribute("aria-label", "Scroll categories");
    track.appendChild(thumb);
    plotHost.appendChild(track);

    const sync = (): void => {
        const trackW = track.clientWidth;
        const ratio = scroller.clientWidth / Math.max(1, scroller.scrollWidth);
        const thumbW = Math.max(24, Math.round(trackW * ratio));
        const maxLeft = trackW - thumbW;
        const scrollable = Math.max(1, scroller.scrollWidth - scroller.clientWidth);
        const left = Math.round((scroller.scrollLeft / scrollable) * maxLeft);
        thumb.style.width = `${thumbW}px`;
        thumb.style.transform = `translateX(${Math.max(0, Math.min(maxLeft, left))}px)`;
    };
    scroller.addEventListener("scroll", sync);

    let dragging = false;
    let dragStartX = 0;
    let dragStartScroll = 0;
    const onMove = (e: MouseEvent): void => {
        if (!dragging) {
            return;
        }
        const maxLeft = Math.max(1, track.clientWidth - thumb.offsetWidth);
        const scrollable = scroller.scrollWidth - scroller.clientWidth;
        scroller.scrollLeft = dragStartScroll + ((e.clientX - dragStartX) / maxLeft) * scrollable;
    };
    const onUp = (): void => {
        dragging = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
    };
    thumb.addEventListener("mousedown", (e: MouseEvent) => {
        e.preventDefault();
        dragging = true;
        dragStartX = e.clientX;
        dragStartScroll = scroller.scrollLeft;
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    });
    track.addEventListener("mousedown", (e: MouseEvent) => {
        if (e.target === thumb) {
            return;
        }
        const rect = track.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / Math.max(1, rect.width);
        scroller.scrollLeft = ratio * (scroller.scrollWidth - scroller.clientWidth);
    });

    sync();
    requestAnimationFrame(sync);
}
