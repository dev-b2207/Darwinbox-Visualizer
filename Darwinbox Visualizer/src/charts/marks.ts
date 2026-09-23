/*
 *  Mark drawing shared by every cartesian chart type.
 *
 *  drawColumns() covers stacked, 100% stacked and clustered, in either
 *  orientation - so stacked column, 100% stacked column, clustered column, bar,
 *  stacked bar, 100% stacked bar, the column half of the combos and the column
 *  half of the ribbon chart are all the same code path.
 *
 *  drawLines() covers the line chart and the line half of the combos.
 *
 *  Everything here works through frame.rectFor() / frame.valueAt(), so a renderer
 *  never has to know which way round the axes are.
 */
import powerbi from "powerbi-visuals-api";
import ISelectionId = powerbi.visuals.ISelectionId;

import { VisualSettings, colorOf, enumOf } from "./../settings";
import { CategoryDatum, CellDatum, ChartModel, SeriesInfo } from "./../dataModel";
import {
    attrs,
    contrastColor,
    createFormatter,
    dashArray,
    fontString,
    measureText,
    roundedRectPath,
    svgEl,
    textHeight,
    IValueFormatter
} from "./../utils";
import { ChartCallbacks, Frame, Theme, applySvgFont, attachMarkHandlers, markerShape } from "./frame";

export type StackMode = "stacked" | "percent" | "cluster";

export interface ColumnOpts {
    mode: StackMode;
    /** the series to draw as columns (a combo leaves its line series out) */
    series: SeriesInfo[];
    /** stacking order within a category; the ribbon chart re-sorts by value */
    orderCells?: (cat: CategoryDatum) => CellDatum[];
    /** collected so a caller (ribbon) can reuse the exact segment geometry */
    collect?: (catIndex: number, seriesIndex: number, rect: { x: number; y: number; width: number; height: number }) => void;
}

export interface LineOpts {
    series: SeriesInfo[];
    /** "markers" drops the connecting path and draws only the point markers */
    mode?: "line" | "markers";
    /** which axis the line reads - frame.valueAt or frame.value2At */
    scale: (v: number) => number;
    /** rounded background behind each label, as in the reference combo chart */
    badge?: { fill: string; text: string; radius: number } | null;
    /** format string for the labels and tooltips of these series */
    format?: string;
    /*
     * The three below exist for the stacked area types. A stacked area's line is
     * drawn at the running total, not at the series' own value, but its label and
     * its tooltip must still read that series' own value - so the geometry is
     * redirected and nothing else is. Undefined for every other caller, which is
     * the line chart and both combos, so their behaviour is untouched.
     */
    /** where this point sits on the value axis; defaults to the cell's own value */
    stackTop?: (catIndex: number, cell: CellDatum) => number;
    /** the lower edge of the filled band under this point, when there is one */
    stackBase?: (catIndex: number, cell: CellDatum) => number;
    /** draw the fill whatever the Lines card says, at this transparency */
    forceArea?: { transparency: number };
    /** overrides the data-label text; the 100% stacked area labels a share, not a count */
    labelText?: (catIndex: number, cell: CellDatum) => string;
    /** extra tooltip rows for this point, as the 100% stacked column adds "% of total" */
    tooltipExtra?: (catIndex: number, cell: CellDatum) => powerbi.extensibility.VisualTooltipDataItem[];
    /**
     * Puts the label at an exact pixel height instead of solving a position around
     * the marker. The stacked areas use it to centre a label inside its own band,
     * which is where Power BI puts it; returning null drops the label, which is what
     * a band too thin to hold one does.
     */
    labelY?: (catIndex: number, cell: CellDatum) => number;
}

/* ------------------------------------------------------------------ */
/* ranges                                                              */
/* ------------------------------------------------------------------ */

export function columnValueRange(
    model: ChartModel,
    series: SeriesInfo[],
    mode: StackMode
): { min: number; max: number } {
    if (mode === "percent") {
        let anyNeg = false;
        model.categories.forEach((c) =>
            c.cells.forEach((cell) => {
                if (inSeries(series, cell) && cell.value < 0) {
                    anyNeg = true;
                }
            })
        );
        return { min: anyNeg ? -1 : 0, max: 1 };
    }
    let maxPos = 0;
    let minNeg = 0;
    model.categories.forEach((c) => {
        let p = 0;
        let n = 0;
        c.cells.forEach((cell) => {
            if (!inSeries(series, cell)) {
                return;
            }
            if (mode === "cluster") {
                maxPos = Math.max(maxPos, cell.value);
                minNeg = Math.min(minNeg, cell.value);
                return;
            }
            if (cell.value >= 0) {
                p += cell.value;
            } else {
                n += cell.value;
            }
        });
        maxPos = Math.max(maxPos, p);
        minNeg = Math.min(minNeg, n);
    });
    return { min: minNeg, max: maxPos };
}

export function seriesValueRange(model: ChartModel, series: SeriesInfo[]): { min: number; max: number } {
    let max = Number.NEGATIVE_INFINITY;
    let min = Number.POSITIVE_INFINITY;
    model.categories.forEach((c) =>
        c.cells.forEach((cell) => {
            if (!inSeries(series, cell)) {
                return;
            }
            max = Math.max(max, cell.value);
            min = Math.min(min, cell.value);
        })
    );
    return { min: isFinite(min) ? min : 0, max: isFinite(max) ? max : 1 };
}

export function inSeries(series: SeriesInfo[], cell: CellDatum): boolean {
    for (let i = 0; i < series.length; i++) {
        if (series[i].index === cell.seriesIndex) {
            return true;
        }
    }
    return false;
}

export function columnSeries(model: ChartModel): SeriesInfo[] {
    return model.series.filter((s) => !s.isLine);
}

export function lineSeries(model: ChartModel): SeriesInfo[] {
    return model.series.filter((s) => s.isLine);
}

/* ------------------------------------------------------------------ */
/* columns / bars                                                      */
/* ------------------------------------------------------------------ */

export function labelIsOutside(settings: VisualSettings): boolean {
    const p = enumOf(settings.dataLabels.labelPosition);
    return p === "auto" || p === "above" || p === "outsideEnd" || p === "right";
}

export function drawColumns(
    frame: Frame,
    model: ChartModel,
    settings: VisualSettings,
    theme: Theme,
    cb: ChartCallbacks,
    opts: ColumnOpts
): void {
    const cs = settings.columnSettings;
    const dl = settings.dataLabels;
    const horizontal = frame.orientation === "horizontal";
    const percent = opts.mode === "percent";
    const cluster = opts.mode === "cluster";

    const { svg, band, catAt } = frame;
    const barsG = svgEl("g");
    const labelsG = svgEl("g");
    svg.appendChild(barsG);
    svg.appendChild(labelsG);

    const innerPad = Math.min(0.9, Math.max(0, (cs.innerPadding.value || 0) / 100));
    const fixed = enumOf(cs.widthMode) === "fixed";
    let bandW = fixed
        ? Math.max(1, cs.barWidth.value || 28)
        : Math.min(band * (1 - innerPad), cs.maxColumnWidth.value || 120);
    bandW = Math.max(1, Math.min(bandW, band));

    const nSlots = cluster ? Math.max(1, opts.series.length) : 1;
    const clusterGap = cluster
        ? Math.min(bandW / nSlots / 2, (bandW * Math.min(0.9, (cs.clusterPadding.value || 0) / 100)) / nSlots)
        : 0;
    const slotW = Math.max(1, bandW / nSlots - clusterGap);

    const dlFontStr = fontString(dl.font);
    const dlH = textHeight(dl.font);
    const dlPos = enumOf(dl.labelPosition);
    const outside = labelIsOutside(settings);
    const dlFmt = percent
        ? null
        : createFormatter(
              model.measureFormat,
              parseInt(enumOf(dl.displayUnits), 10),
              dl.precision.value,
              frame.yMax
          );
    const tooltipFmt = createFormatter(model.measureFormat, 1, null, frame.yMax);

    /* an outside label sits on the plot background, not on a bar */
    const plotBg = colorOf(settings.plotArea.background);
    const outsideColor = theme.isHighContrast
        ? theme.foreground
        : dl.autoContrast.value
        ? contrastColor(!plotBg || plotBg === "transparent" ? "#FFFFFF" : plotBg)
        : colorOf(dl.fontColor);

    const anySelection = cb.hasSelection();
    const fmtSafe = (v: number) => (dlFmt ? dlFmt.format(v) : String(v));
    const slotIndex: { [seriesIndex: number]: number } = {};
    opts.series.forEach((s, i) => (slotIndex[s.index] = i));

    model.categories.forEach((cat, ci) => {
        const mine = cat.cells.filter((c) => inSeries(opts.series, c));
        const posTotal = mine.reduce((s, c) => s + (c.value > 0 ? c.value : 0), 0);
        /* when a category is all-negative there is no positive total to divide by -
           fall back to the magnitude of the negative total instead of 1, otherwise
           the raw (unscaled) values would be plotted/labelled as if they were already
           fractions in [-1, 1] */
        const negTotal = mine.reduce((s, c) => s + (c.value < 0 ? -c.value : 0), 0);
        const denom = percent ? posTotal || negTotal || 1 : 1;
        /* the non-percent "outside total" label reflects the actual net total, not
           just the positive stack - otherwise an all-negative category would label
           its bar "0" */
        const catTotal = mine.reduce((s, c) => s + c.value, 0);

        let posAcc = 0;
        let negAcc = 0;
        const ordered = opts.orderCells
            ? opts.orderCells(cat).filter((c) => inSeries(opts.series, c))
            : mine.slice().sort((a, b) => a.seriesIndex - b.seriesIndex);
        const topIndex = ordered.reduce((best, c, i) => (c.value > 0 ? i : best), -1);

        ordered.forEach((cell, idx) => {
            const raw = cell.value / denom;
            if (!raw) {
                return;
            }
            const series = model.series[cell.seriesIndex];

            let v0: number;
            let v1: number;
            if (cluster) {
                v0 = 0;
                v1 = raw;
            } else if (raw >= 0) {
                v0 = posAcc;
                posAcc += raw;
                v1 = posAcc;
            } else {
                v0 = negAcc;
                negAcc += raw;
                v1 = negAcc;
            }

            /* clustered marks sit side by side inside the band */
            const centre = cluster
                ? catAt(ci) - bandW / 2 + (slotIndex[cell.seriesIndex] + 0.5) * (bandW / nSlots)
                : catAt(ci);
            const thickness = cluster ? slotW : bandW;
            const rect = frame.rectFor(centre, v0, v1, thickness);

            /* the segment gap is taken off the value-axis side only */
            const gap = cs.segmentGap.value || 0;
            if (!cluster && gap > 0) {
                if (horizontal && rect.width > gap + 0.5) {
                    rect.width -= gap;
                } else if (!horizontal && rect.height > gap + 0.5) {
                    rect.height -= gap;
                }
            }

            const isTop = idx === topIndex;
            const r = cs.cornerRadius.value || 0;
            const ids = (cell as unknown as { allSelectionIds: ISelectionId[] }).allSelectionIds || [
                cell.selectionId
            ];
            const selected = cb.isSelected(ids);
            const dim = anySelection && !selected;
            const fill = theme.isHighContrast ? theme.background : series.color;

            const shape = r > 0 ? svgEl("path") : svgEl("rect");
            if (r > 0) {
                attrs(shape, {
                    d: roundedRectPath(
                        rect.x,
                        rect.y,
                        rect.width,
                        rect.height,
                        (isTop || cluster) && raw > 0 ? r : 0,
                        0
                    )
                });
            } else {
                attrs(shape, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
            }
            attrs(shape, {
                fill,
                stroke: theme.isHighContrast
                    ? theme.foreground
                    : cs.borderWidth.value > 0
                    ? colorOf(cs.borderColor)
                    : null,
                "stroke-width": theme.isHighContrast ? 2 : cs.borderWidth.value || null,
                "fill-opacity": model.hasHighlights && cell.hasHighlight ? 0.3 : dim ? 0.35 : 1,
                tabindex: 0,
                role: "img",
                "aria-label": `${cat.label}, ${series.label}, ${
                    percent ? `${Math.round(raw * 100)}%` : tooltipFmt.format(cell.value)
                }`
            });
            shape.style.cursor = "pointer";
            attachMarkHandlers(
                shape,
                cat,
                cell,
                ids,
                model,
                cb,
                tooltipFmt,
                percent
                    ? [
                          {
                              displayName: "% of total",
                              value: `${(raw * 100).toFixed(1)}%`
                          }
                      ]
                    : undefined
            );
            barsG.appendChild(shape);
            if (opts.collect) {
                opts.collect(ci, cell.seriesIndex, rect);
            }

            /* highlight overlay from another visual's cross-filter */
            if (model.hasHighlights && cell.hasHighlight && cell.highlight) {
                const hRatio = cell.value ? cell.highlight / cell.value : 0;
                const f = Math.max(0, Math.min(1, hRatio));
                const hShape = svgEl("rect");
                if (horizontal) {
                    attrs(hShape, {
                        x: rect.x,
                        y: rect.y,
                        width: rect.width * f,
                        height: rect.height
                    });
                } else {
                    attrs(hShape, {
                        x: rect.x,
                        y: raw >= 0 ? rect.y + rect.height * (1 - f) : rect.y,
                        width: rect.width,
                        height: rect.height * f
                    });
                }
                attrs(hShape, { fill, "pointer-events": "none" });
                barsG.appendChild(hShape);
            }

            /* --- labels ------------------------------------------- */
            if (!dl.show.value) {
                return;
            }

            const barEndValue = cluster ? raw : posAcc;
            const wantsOutsideHere = outside && (cluster || (isTop && raw > 0));
            if (wantsOutsideHere) {
                const txt = percent
                    ? `${(barEndValue * 100).toFixed(dl.precision.value || 0)}%`
                    : fmtSafe(cluster ? cell.value : catTotal);
                const w = measureText(txt, dlFontStr);
                /* a clustered bar only owns its own slot, so its label is measured
                   against that - not the whole band, which would let four labels
                   pile on top of each other */
                const room = horizontal
                    ? frame.plotBox.x2 - (rect.x + rect.width)
                    : cluster
                    ? slotW + clusterGap
                    : band;
                if (!dl.hideOverlapping.value || w <= room) {
                    const t = svgEl("text");
                    if (horizontal) {
                        attrs(t, {
                            x: rect.x + rect.width + 5,
                            y: rect.y + rect.height / 2 + dlH / 3,
                            "text-anchor": "start"
                        });
                    } else {
                        attrs(t, {
                            x: rect.x + rect.width / 2,
                            y: Math.max(dlH, rect.y - 5),
                            "text-anchor": "middle"
                        });
                    }
                    attrs(t, { "pointer-events": "none", fill: outsideColor });
                    applySvgFont(t, dl.font);
                    t.textContent = txt;
                    labelsG.appendChild(t);
                }
                return;
            }

            if (outside) {
                return;
            }

            /* per-segment label, inside the mark */
            const across = horizontal ? rect.height : rect.width;
            const along = horizontal ? rect.width : rect.height;
            if (across < dlH * 0.7) {
                return;
            }
            const txt = percent
                ? `${(raw * 100).toFixed(dl.precision.value || 0)}%`
                : fmtSafe(cell.value);
            const w = measureText(txt, dlFontStr);
            if (dl.hideOverlapping.value && w > along - 4) {
                return;
            }
            const t = svgEl("text");
            let tx: number;
            let ty: number;
            let anchor = "middle";
            if (horizontal) {
                ty = rect.y + rect.height / 2 + dlH / 3;
                if (dlPos === "insideEnd") {
                    tx = rect.x + rect.width - 4;
                    anchor = "end";
                } else if (dlPos === "insideBase") {
                    tx = rect.x + 4;
                    anchor = "start";
                } else {
                    tx = rect.x + rect.width / 2;
                }
            } else {
                tx = rect.x + rect.width / 2;
                ty =
                    dlPos === "insideEnd" || dlPos === "left"
                        ? rect.y + dlH
                        : dlPos === "insideBase" || dlPos === "below"
                        ? rect.y + rect.height - 3
                        : rect.y + rect.height / 2 + dlH / 3;
            }
            attrs(t, {
                x: tx,
                y: ty,
                "text-anchor": anchor,
                "pointer-events": "none",
                fill: theme.isHighContrast
                    ? theme.foreground
                    : dl.autoContrast.value
                    ? contrastColor(series.color)
                    : colorOf(dl.fontColor)
            });
            applySvgFont(t, dl.font);
            t.textContent = txt;
            labelsG.appendChild(t);
        });
    });
}

/* ------------------------------------------------------------------ */
/* lines                                                               */
/* ------------------------------------------------------------------ */

export interface PlacedLabel {
    x1: number;
    x2: number;
    y1: number;
    y2: number;
}

interface Pt {
    i: number;
    x: number;
    y: number;
    /** stacked areas only: the lower edge of this point's band, in pixels */
    base?: number;
    cell: CellDatum;
    cat: CategoryDatum;
}

export function drawLines(
    frame: Frame,
    model: ChartModel,
    settings: VisualSettings,
    theme: Theme,
    cb: ChartCallbacks,
    opts: LineOpts
): void {
    const ls = settings.lineSettings;
    const dl = settings.dataLabels;
    const { svg, catAt, innerPlotW, plotH } = frame;

    const areaG = svgEl("g");
    const linesG = svgEl("g");
    const markersG = svgEl("g");
    const labelsG = svgEl("g");
    svg.appendChild(areaG);
    svg.appendChild(linesG);
    svg.appendChild(markersG);
    svg.appendChild(labelsG);

    const fmtSource = opts.format !== undefined ? opts.format : model.measureFormat;
    const dlFontStr = fontString(dl.font);
    const dlH = textHeight(dl.font);
    const dlPos = enumOf(dl.labelPosition);
    const dlFmt = createFormatter(
        fmtSource,
        parseInt(enumOf(dl.displayUnits), 10),
        dl.precision.value,
        frame.yMax
    );
    const tooltipFmt: IValueFormatter = createFormatter(fmtSource, 1, null, frame.yMax);

    const plotBg = colorOf(settings.plotArea.background);
    const labelColor = opts.badge
        ? colorOf(settings.comboSettings.badgeTextColor)
        : theme.isHighContrast
        ? theme.foreground
        : dl.autoContrast.value
        ? contrastColor(!plotBg || plotBg === "transparent" ? "#FFFFFF" : plotBg)
        : colorOf(dl.fontColor);

    const anySelection = cb.hasSelection();
    const curve = enumOf(ls.curve);
    /* markers-only: no path, and the markers are always drawn even if the Lines
       card has them switched off - they are the whole mark in that mode */
    const markersOnly = opts.mode === "markers";
    const showMarkers = markersOnly || ls.showMarkers.value;
    const markerR = showMarkers ? (ls.markerSize.value || 7) / 2 : ls.lineWidth.value / 2;
    const placed: PlacedLabel[] = [];

    opts.series.forEach((series) => {
        const pts: Pt[] = [];
        model.categories.forEach((cat, ci) => {
            const cell = cat.cells.filter((c) => c.seriesIndex === series.index)[0];
            if (!cell) {
                return;
            }
            const at = opts.stackTop ? opts.stackTop(ci, cell) : cell.value;
            pts.push({
                i: ci,
                x: catAt(ci),
                y: opts.scale(at),
                base: opts.stackBase ? opts.scale(opts.stackBase(ci, cell)) : null,
                cell,
                cat
            });
        });
        if (!pts.length) {
            return;
        }

        const stroke = theme.isHighContrast ? theme.foreground : series.color;

        /* a missing category breaks the line unless joining is switched on */
        const runs: Pt[][] = [];
        let run: Pt[] = [];
        let expected = -1;
        pts.forEach((p) => {
            if (!ls.connectNulls.value && expected >= 0 && p.i !== expected) {
                if (run.length) {
                    runs.push(run);
                }
                run = [];
            }
            run.push(p);
            expected = p.i + 1;
        });
        if (run.length) {
            runs.push(run);
        }

        runs.forEach((r) => {
            if (markersOnly) {
                return;
            }
            const wantsArea = !!opts.forceArea || ls.showArea.value;
            const areaAlpha = opts.forceArea
                ? (100 - (opts.forceArea.transparency || 0)) / 100
                : (100 - (ls.areaTransparency.value || 0)) / 100;
            if (wantsArea && r.length > 1) {
                /*
                 * Two shapes of fill. A stacked area's band is bounded above by this
                 * series' running total and below by the one under it, so the lower
                 * edge is traced back through the same curve; a plain area just drops
                 * to the zero line.
                 */
                const d =
                    r[0].base !== null && r[0].base !== undefined
                        ? `${linePath(r, curve)} ${linePath(
                              r.slice().reverse().map((p) => ({ x: p.x, y: p.base })),
                              curve
                          ).replace(/^M/, "L")} Z`
                        : (() => {
                              const base = opts.scale(Math.max(frame.yMin, Math.min(0, frame.yMax)));
                              return `${linePath(r, curve)} L${r[r.length - 1].x},${base} L${r[0].x},${base} Z`;
                          })();
                const area = svgEl("path");
                attrs(area, {
                    d,
                    fill: stroke,
                    "fill-opacity": anySelection ? areaAlpha * 0.45 : areaAlpha,
                    stroke: "none",
                    "pointer-events": "none"
                });
                areaG.appendChild(area);
            }
            if (r.length > 1) {
                const path = svgEl("path");
                attrs(path, {
                    d: linePath(r, curve),
                    fill: "none",
                    stroke,
                    "stroke-width": ls.lineWidth.value,
                    "stroke-linejoin": "round",
                    "stroke-linecap": "round",
                    "stroke-dasharray": dashArray(enumOf(ls.lineStyle), ls.lineWidth.value),
                    "stroke-opacity": anySelection ? 0.35 : 1,
                    "pointer-events": "none"
                });
                linesG.appendChild(path);
            }
        });

        pts.forEach((p, pi) => {
            const ids = (p.cell as unknown as { allSelectionIds: ISelectionId[] }).allSelectionIds || [
                p.cell.selectionId
            ];
            const dim = anySelection && !cb.isSelected(ids);

            if (showMarkers || pts.length === 1) {
                const shape = markerShape(enumOf(ls.markerShape), p.x, p.y, ls.markerSize.value || 7);
                attrs(shape, {
                    fill: theme.isHighContrast ? theme.background : series.color,
                    stroke: theme.isHighContrast ? theme.foreground : "none",
                    "stroke-width": theme.isHighContrast ? 2 : 0,
                    "fill-opacity": dim ? 0.35 : 1,
                    tabindex: 0,
                    role: "img",
                    "aria-label": `${p.cat.label}, ${series.label}, ${
                        opts.labelText ? opts.labelText(p.i, p.cell) : tooltipFmt.format(p.cell.value)
                    }`
                });
                shape.style.cursor = "pointer";
                attachMarkHandlers(
                    shape,
                    p.cat,
                    p.cell,
                    ids,
                    model,
                    cb,
                    tooltipFmt,
                    opts.tooltipExtra ? opts.tooltipExtra(p.i, p.cell) : undefined
                );
                markersG.appendChild(shape);
            }

            if (!dl.show.value) {
                return;
            }
            const txt = opts.labelText ? opts.labelText(p.i, p.cell) : dlFmt.format(p.cell.value);

            if (opts.labelY) {
                const ly = opts.labelY(p.i, p.cell);
                if (ly === null || ly === undefined) {
                    return;
                }
                const inBand = svgEl("text");
                attrs(inBand, {
                    x: p.x,
                    y: ly,
                    "text-anchor": "middle",
                    "pointer-events": "none",
                    fill: labelColor
                });
                applySvgFont(inBand, dl.font);
                inBand.textContent = txt;
                labelsG.appendChild(inBand);
                return;
            }

            const w = measureText(txt, dlFontStr);
            const padX = opts.badge ? 5 : 0;
            const pos = resolveLabelPosition(dlPos, p, pts[pi - 1], pts[pi + 1], w + padX * 2, dlH, {
                markerR,
                plotTop: frame.plotBox.y1,
                plotBottom: frame.plotBox.y2,
                innerPlotW,
                placed
            });
            if (!pos) {
                return;
            }
            placed.push(pos.box);

            if (opts.badge) {
                const bg = svgEl("rect");
                attrs(bg, {
                    x: pos.box.x1,
                    y: pos.box.y1 - 1,
                    width: pos.box.x2 - pos.box.x1,
                    height: pos.box.y2 - pos.box.y1 + 2,
                    rx: opts.badge.radius,
                    ry: opts.badge.radius,
                    fill: opts.badge.fill,
                    "pointer-events": "none"
                });
                labelsG.appendChild(bg);
            }

            const t = svgEl("text");
            attrs(t, {
                x: pos.x,
                y: pos.y,
                "text-anchor": pos.anchor,
                "pointer-events": "none",
                fill: labelColor
            });
            applySvgFont(t, dl.font);
            t.textContent = txt;
            labelsG.appendChild(t);
        });
    });

    void plotH;
}

/* ------------------------------------------------------------------ */

export function linePath(pts: { x: number; y: number }[], curve: string): string {
    if (!pts.length) {
        return "";
    }
    if (pts.length === 1) {
        return `M${pts[0].x},${pts[0].y}`;
    }
    if (curve === "step") {
        let d = `M${pts[0].x},${pts[0].y}`;
        for (let i = 1; i < pts.length; i++) {
            const midX = (pts[i - 1].x + pts[i].x) / 2;
            d += ` L${midX},${pts[i - 1].y} L${midX},${pts[i].y} L${pts[i].x},${pts[i].y}`;
        }
        return d;
    }
    if (curve === "smooth") {
        /* Catmull-Rom expressed as cubic beziers */
        let d = `M${pts[0].x},${pts[0].y}`;
        for (let i = 0; i < pts.length - 1; i++) {
            const p0 = pts[i - 1] || pts[i];
            const p1 = pts[i];
            const p2 = pts[i + 1];
            const p3 = pts[i + 2] || p2;
            d += ` C${p1.x + (p2.x - p0.x) / 6},${p1.y + (p2.y - p0.y) / 6} ${
                p2.x - (p3.x - p1.x) / 6
            },${p2.y - (p3.y - p1.y) / 6} ${p2.x},${p2.y}`;
        }
        return d;
    }
    return pts.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
}

/**
 * "Auto" prefers above the marker and flips below when that would clip the top of
 * the plot, collide with a label already placed, or run into the space the line
 * occupies (a neighbouring point sitting higher up). Power BI's own solver is
 * more elaborate; the explicit Above / Below / Left / Right settings bypass this.
 */
export function resolveLabelPosition(
    mode: string,
    p: { x: number; y: number },
    prev: { y: number } | undefined,
    next: { y: number } | undefined,
    w: number,
    h: number,
    ctx: {
        markerR: number;
        plotTop: number;
        plotBottom: number;
        innerPlotW: number;
        placed: PlacedLabel[];
    }
): { x: number; y: number; anchor: string; box: PlacedLabel } | null {
    const gap = ctx.markerR + 3;

    const make = (side: string) => {
        let x = p.x;
        let y = p.y;
        let anchor = "middle";
        if (side === "below" || side === "insideBase") {
            y = p.y + gap + h * 0.8;
        } else if (side === "left") {
            x = p.x - gap;
            y = p.y + h * 0.32;
            anchor = "end";
        } else if (side === "right") {
            x = p.x + gap;
            y = p.y + h * 0.32;
            anchor = "start";
        } else {
            y = p.y - gap;
        }
        const x1 = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
        return { x, y, anchor, box: { x1, x2: x1 + w, y1: y - h * 0.8, y2: y + h * 0.2 } };
    };

    const fits = (c: { box: PlacedLabel }) =>
        c.box.y1 >= ctx.plotTop - 0.5 &&
        c.box.y2 <= ctx.plotBottom + 0.5 &&
        c.box.x1 >= -2 &&
        c.box.x2 <= ctx.innerPlotW + 2 &&
        !ctx.placed.some(
            (q) => c.box.x1 < q.x2 && c.box.x2 > q.x1 && c.box.y1 < q.y2 && c.box.y2 > q.y1
        );

    if (mode !== "auto") {
        return make(mode === "above" || mode === "outsideEnd" ? "above" : mode);
    }

    const lineAbove =
        (prev !== undefined && prev.y < p.y - h) || (next !== undefined && next.y < p.y - h);
    const order = lineAbove
        ? ["below", "above", "right", "left"]
        : ["above", "below", "right", "left"];
    for (let i = 0; i < order.length; i++) {
        const c = make(order[i]);
        if (fits(c)) {
            return c;
        }
    }
    return null;
}
