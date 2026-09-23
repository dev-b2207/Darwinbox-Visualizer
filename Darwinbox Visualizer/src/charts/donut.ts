/*
 *  Donut chart.
 *
 *  The only type that does not use the cartesian frame - no axes, no scrolling -
 *  so it builds its own legend + plot box and draws arcs. It keeps everything
 *  else the visual offers: the header controls, cross-filtering, tooltips,
 *  keyboard focus, high-contrast mode and the table toggle.
 *
 *  Slices come from the selected dimension. When a Legend field splits a single
 *  category (Headcount by Gender with one date bucket) the series become the
 *  slices instead, which is what the reference "Headcount by Gender" ring shows.
 */
import powerbi from "powerbi-visuals-api";
import ISelectionId = powerbi.visuals.ISelectionId;

import { VisualSettings, colorOf, enumOf } from "./../settings";
import { ChartModel } from "./../dataModel";
import {
    attrs,
    contrastColor,
    createFormatter,
    cssFont,
    fontString,
    measureText,
    svgEl,
    textHeight,
    truncate
} from "./../utils";
import { ChartCallbacks, Theme, applySvgFont, markerShape } from "./frame";

interface Slice {
    label: string;
    value: number;
    color: string;
    ids: ISelectionId[];
    rows: number[];
    /** index into model.series when the slice IS a series, -1 when it is a category */
    seriesIndex: number;
    hasHighlight: boolean;
    highlight: number;
}

/* ------------------------------------------------------------------ */

/**
 * Slices come from the dimension unless a Legend field splits a single category,
 * in which case the series are the slices. visual.ts asks the same question to
 * decide whether the Colours card lists categories or series.
 */
export function slicesAreCategories(model: ChartModel): boolean {
    return !(model.series.length > 1 && model.categories.length === 1);
}

function buildSlices(model: ChartModel): Slice[] {
    const out: Slice[] = [];

    if (!slicesAreCategories(model)) {
        const cat = model.categories[0];
        model.series.forEach((s) => {
            const cell = cat.cells.filter((c) => c.seriesIndex === s.index)[0];
            if (!cell) {
                return;
            }
            out.push({
                label: s.label,
                value: cell.value,
                color: s.color,
                ids: (cell as unknown as { allSelectionIds: ISelectionId[] }).allSelectionIds || [
                    cell.selectionId
                ],
                rows: cell.rowIndices || [],
                seriesIndex: s.index,
                hasHighlight: cell.hasHighlight,
                highlight: cell.highlight
            });
        });
        return out;
    }

    model.categories.forEach((cat) => {
        const value = cat.cells.reduce((s, c) => s + c.value, 0);
        out.push({
            label: cat.label,
            value,
            /* colour comes from the theme (or a per-slice override) per category */
            color: cat.color || THEME_CYCLE[out.length % THEME_CYCLE.length],
            ids: (cat as unknown as { allSelectionIds: ISelectionId[] }).allSelectionIds || [
                cat.selectionId
            ],
            rows: cat.rowIndices || [],
            seriesIndex: -1,
            hasHighlight: cat.cells.some((c) => c.hasHighlight),
            highlight: cat.cells.reduce((s, c) => s + (c.hasHighlight ? c.highlight : 0), 0)
        });
    });
    return out;
}

/* fallback only - the host palette normally supplies the per-slice colour */
const THEME_CYCLE = [
    "#0183FF", "#F4A0B0", "#7ED0C4", "#8764B8", "#4FC3F7", "#FF8B6B",
    "#1B4F91", "#F2C811", "#118DFF", "#E66C37", "#6B007B", "#00B7C3"
];

function polar(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
    const a = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function arcPath(
    cx: number,
    cy: number,
    rOuter: number,
    rInner: number,
    a0: number,
    a1: number
): string {
    const full = a1 - a0 >= 359.999;
    if (full) {
        /* two half arcs, else the sweep collapses */
        return [
            arcPath(cx, cy, rOuter, rInner, a0, a0 + 180),
            arcPath(cx, cy, rOuter, rInner, a0 + 180, a1)
        ].join(" ");
    }
    const p0 = polar(cx, cy, rOuter, a0);
    const p1 = polar(cx, cy, rOuter, a1);
    const q1 = polar(cx, cy, rInner, a1);
    const q0 = polar(cx, cy, rInner, a0);
    const large = a1 - a0 > 180 ? 1 : 0;
    if (rInner <= 0.5) {
        return `M${cx},${cy} L${p0.x},${p0.y} A${rOuter},${rOuter} 0 ${large} 1 ${p1.x},${p1.y} Z`;
    }
    return [
        `M${p0.x},${p0.y}`,
        `A${rOuter},${rOuter} 0 ${large} 1 ${p1.x},${p1.y}`,
        `L${q1.x},${q1.y}`,
        `A${rInner},${rInner} 0 ${large} 0 ${q0.x},${q0.y}`,
        "Z"
    ].join(" ");
}

/* ------------------------------------------------------------------ */

export function render(
    root: HTMLElement,
    model: ChartModel,
    settings: VisualSettings,
    width: number,
    height: number,
    cb: ChartCallbacks,
    theme: Theme
): void {
    const ds = settings.donutSettings;
    const dl = settings.dataLabels;
    const pa = settings.plotArea;

    const slices = buildSlices(model).filter((s) => s.value > 0);
    if (!slices.length) {
        return;
    }
    const total = slices.reduce((s, x) => s + x.value, 0);

    /* ---------------------------------------------- legend --------- */
    const legendPos = enumOf(settings.legend.position);
    const showLegend = settings.legend.show.value && slices.length > 1;
    const horizontalLegend = legendPos === "top" || legendPos === "bottom";

    const outer = document.createElement("div");
    outer.style.display = "flex";
    outer.style.flex = "1 1 auto";
    outer.style.minHeight = "0";
    outer.style.flexDirection = horizontalLegend ? "column" : "row";
    root.appendChild(outer);

    const legendNode = showLegend ? buildSliceLegend(slices, settings, theme, cb) : null;
    const plotHost = document.createElement("div");
    plotHost.style.flex = "1 1 auto";
    plotHost.style.minWidth = "0";
    plotHost.style.minHeight = "0";
    plotHost.style.display = "flex";
    plotHost.style.alignItems = "center";
    plotHost.style.justifyContent = "center";
    plotHost.style.padding = `${pa.paddingTop.value}px ${pa.paddingRight.value}px ${pa.paddingBottom.value}px ${pa.paddingLeft.value}px`;
    plotHost.style.boxSizing = "border-box";

    if (legendNode && (legendPos === "top" || legendPos === "left")) {
        outer.appendChild(legendNode);
    }
    outer.appendChild(plotHost);
    if (legendNode && (legendPos === "bottom" || legendPos === "right")) {
        outer.appendChild(legendNode);
    }

    const legendW = legendNode && !horizontalLegend ? legendNode.getBoundingClientRect().width : 0;
    const legendH = legendNode && horizontalLegend ? legendNode.getBoundingClientRect().height : 0;

    const availW = Math.max(60, width - legendW - pa.paddingLeft.value - pa.paddingRight.value);
    const availH = Math.max(60, height - legendH - pa.paddingTop.value - pa.paddingBottom.value);

    /* ---------------------------------------------- labels --------- */
    const labelFmt = createFormatter(
        model.measureFormat,
        parseInt(enumOf(dl.displayUnits), 10),
        dl.precision.value,
        total
    );
    const content = enumOf(ds.labelContent);
    const dlFontStr = fontString(dl.font);
    const dlH = textHeight(dl.font);
    const outside = enumOf(ds.labelPlacement) === "outside";
    const minShare = (ds.minSharePercent.value || 0) / 100;

    const labelFor = (s: Slice): string => {
        const share = `${((s.value / total) * 100).toFixed(1)}%`;
        const val = labelFmt.format(s.value);
        switch (content) {
            case "value":
                return val;
            case "percent":
                return share;
            case "category":
                return s.label;
            case "categoryValue":
                return `${s.label} ${val}`;
            case "all":
                return `${s.label} ${val} (${share})`;
            default:
                return `${val} (${share})`;
        }
    };

    const labelled = dl.show.value
        ? slices.filter((s) => s.value / total >= minShare)
        : ([] as Slice[]);
    const widestLabel = labelled.reduce((m, s) => Math.max(m, measureText(labelFor(s), dlFontStr)), 0);

    const labelRoom = dl.show.value && outside ? widestLabel + 34 : 6;
    const rOuter = Math.max(
        18,
        Math.min(availW / 2 - labelRoom, availH / 2 - (dl.show.value && outside ? dlH + 6 : 4))
    );
    const rInner = rOuter * Math.min(0.9, Math.max(0, (ds.innerRadius.value || 0) / 100));

    const svgW = Math.max(40, availW);
    const svgH = Math.max(40, availH);
    const cx = svgW / 2;
    const cy = svgH / 2;

    const svg = svgEl("svg");
    attrs(svg, {
        width: svgW,
        height: svgH,
        role: "group",
        "aria-label": `${model.measureName} by ${model.activeAxis ? model.activeAxis.label : ""}`
    });
    svg.style.display = "block";
    svg.style.overflow = "visible";
    plotHost.appendChild(svg);

    const arcsG = svgEl("g");
    const leadersG = svgEl("g");
    const labelsG = svgEl("g");
    svg.appendChild(arcsG);
    svg.appendChild(leadersG);
    svg.appendChild(labelsG);

    const anySelection = cb.hasSelection();
    const tooltipFmt = createFormatter(model.measureFormat, 1, null, total);

    /* an outside label sits on the plot background, an inside one on its slice */
    const plotBg = colorOf(pa.background);
    const outsideLabelColor = theme.isHighContrast
        ? theme.foreground
        : dl.autoContrast.value
        ? contrastColor(!plotBg || plotBg === "transparent" ? "#FFFFFF" : plotBg)
        : colorOf(dl.fontColor);

    /* ---------------------------------------------- arcs ----------- */
    interface Anchor {
        slice: Slice;
        mid: number;
        text: string;
        side: number;
        y: number;
    }
    const anchors: Anchor[] = [];

    let angle = ds.startAngle.value || 0;
    slices.forEach((s) => {
        const sweep = (s.value / total) * 360;
        const a0 = angle;
        const a1 = angle + sweep;
        angle = a1;

        const dim = anySelection && !cb.isSelected(s.ids);
        const path = svgEl("path");
        attrs(path, {
            d: arcPath(cx, cy, rOuter, rInner, a0, a1),
            fill: theme.isHighContrast ? theme.background : s.color,
            stroke:
                ds.sliceBorderWidth.value > 0 || theme.isHighContrast
                    ? theme.isHighContrast
                        ? theme.foreground
                        : colorOf(ds.sliceBorderColor)
                    : null,
            "stroke-width": theme.isHighContrast ? 2 : ds.sliceBorderWidth.value || null,
            "fill-opacity": model.hasHighlights && !s.hasHighlight ? 0.3 : dim ? 0.35 : 1,
            tabindex: 0,
            role: "img",
            "aria-label": `${s.label}, ${tooltipFmt.format(s.value)}, ${((s.value / total) * 100).toFixed(1)}%`
        });
        path.style.cursor = "pointer";
        attachSliceHandlers(path, s, total, model, cb, tooltipFmt);
        arcsG.appendChild(path);

        if (dl.show.value && s.value / total >= minShare) {
            const mid = (a0 + a1) / 2;
            const p = polar(cx, cy, rOuter, mid);
            anchors.push({
                slice: s,
                mid,
                text: labelFor(s),
                side: p.x >= cx ? 1 : -1,
                y: polar(cx, cy, rOuter + 18, mid).y
            });
        }
    });

    /* ---------------------------------------------- slice labels --- */
    if (outside) {
        /*
         * Labels are stacked down each side. Only as many fit as the height allows,
         * so the smallest slices lose their label rather than the leader lines
         * turning into a cat's cradle across the ring - the same call the native
         * donut makes.
         */
        const gap = dlH + 3;
        const perSide = Math.max(1, Math.floor((svgH - 8) / gap));
        const keep: Anchor[] = [];
        [-1, 1].forEach((side) => {
            const mine = anchors.filter((a) => a.side === side);
            mine.sort((a, b) => b.slice.value - a.slice.value);
            const kept = mine.slice(0, perSide);
            kept.sort((a, b) => a.y - b.y);
            for (let i = 1; i < kept.length; i++) {
                if (kept[i].y - kept[i - 1].y < gap) {
                    kept[i].y = kept[i - 1].y + gap;
                }
            }
            for (let i = kept.length - 2; i >= 0; i--) {
                if (kept[i + 1].y - kept[i].y < gap) {
                    kept[i].y = kept[i + 1].y - gap;
                }
            }
            kept.forEach((a) => {
                a.y = Math.max(dlH, Math.min(svgH - 4, a.y));
                keep.push(a);
            });
        });
        anchors.length = 0;
        keep.forEach((a) => anchors.push(a));

        anchors.forEach((a) => {
            const from = polar(cx, cy, rOuter + 2, a.mid);
            const bend = polar(cx, cy, rOuter + 14, a.mid);
            const endX = cx + a.side * (rOuter + 26);
            if (ds.showLeaderLines.value) {
                const poly = svgEl("polyline");
                attrs(poly, {
                    points: `${from.x},${from.y} ${bend.x},${a.y} ${endX},${a.y}`,
                    fill: "none",
                    stroke: theme.isHighContrast ? theme.foreground : colorOf(ds.leaderLineColor),
                    "stroke-width": 1,
                    "pointer-events": "none"
                });
                leadersG.appendChild(poly);
            }
            const room = a.side > 0 ? svgW - (endX + 4) : endX - 4;
            const t = svgEl("text");
            attrs(t, {
                x: endX + a.side * 4,
                y: a.y + dlH / 3,
                "text-anchor": a.side > 0 ? "start" : "end",
                "pointer-events": "none",
                fill: outsideLabelColor
            });
            applySvgFont(t, dl.font);
            t.textContent = truncate(a.text, dlFontStr, Math.max(20, room));
            labelsG.appendChild(t);
        });
    } else {
        anchors.forEach((a) => {
            const p = polar(cx, cy, (rOuter + Math.max(rInner, rOuter * 0.35)) / 2, a.mid);
            const t = svgEl("text");
            attrs(t, {
                x: p.x,
                y: p.y + dlH / 3,
                "text-anchor": "middle",
                "pointer-events": "none",
                fill: theme.isHighContrast
                    ? theme.foreground
                    : dl.autoContrast.value
                    ? contrastColor(a.slice.color)
                    : colorOf(dl.fontColor)
            });
            applySvgFont(t, dl.font);
            t.textContent = a.text;
            labelsG.appendChild(t);
        });
    }

    /* ---------------------------------------------- centre total --- */
    if (ds.showCentreTotal.value && rInner > 8) {
        const fmt = createFormatter(
            model.measureFormat,
            parseInt(enumOf(ds.centreDisplayUnits), 10),
            ds.centrePrecision.value,
            total
        );
        const caption = ds.centreCaption.value || "";
        const totalH = textHeight(ds.centreFont);
        const t = svgEl("text");
        attrs(t, {
            x: cx,
            y: cy + totalH / 3 - (caption ? totalH * 0.45 : 0),
            "text-anchor": "middle",
            "pointer-events": "none",
            fill: theme.isHighContrast ? theme.foreground : colorOf(ds.centreFontColor)
        });
        applySvgFont(t, ds.centreFont);
        t.textContent = fmt.format(total);
        labelsG.appendChild(t);

        if (caption) {
            const c = svgEl("text");
            attrs(c, {
                x: cx,
                y: cy + totalH,
                "text-anchor": "middle",
                "pointer-events": "none",
                fill: theme.isHighContrast ? theme.foreground : colorOf(ds.centreFontColor)
            });
            applySvgFont(c, dl.font);
            c.textContent = caption;
            labelsG.appendChild(c);
        }
    }

    svg.addEventListener("click", (e) => {
        if (e.target === svg) {
            cb.onSelect([], false);
        }
    });
}

/* ------------------------------------------------------------------ */

function attachSliceHandlers(
    shape: SVGElement,
    slice: Slice,
    total: number,
    model: ChartModel,
    cb: ChartCallbacks,
    fmt: { format: (v: number) => string }
): void {
    const build = (): powerbi.extensibility.VisualTooltipDataItem[] => [
        {
            displayName: model.activeAxis ? model.activeAxis.label : "Category",
            value: slice.label
        },
        { displayName: model.measureName, value: fmt.format(slice.value), color: slice.color },
        { displayName: "% of total", value: `${((slice.value / total) * 100).toFixed(1)}%` }
    ];

    shape.addEventListener("click", (e: MouseEvent) => {
        e.stopPropagation();
        cb.onSelect(slice.ids, e.ctrlKey || e.metaKey || e.shiftKey, slice.rows, slice.seriesIndex);
    });
    shape.addEventListener("contextmenu", (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        cb.onContextMenu(slice.ids[0], e.clientX, e.clientY);
    });
    shape.addEventListener("mouseover", (e: MouseEvent) =>
        cb.onTooltip(build(), slice.ids, e.clientX, e.clientY)
    );
    shape.addEventListener("mousemove", (e: MouseEvent) => cb.onTooltipMove(e.clientX, e.clientY));
    shape.addEventListener("mouseout", () => cb.onTooltipHide());
    shape.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            cb.onSelect(slice.ids, e.ctrlKey || e.metaKey || e.shiftKey, slice.rows, slice.seriesIndex);
        }
    });
    shape.addEventListener("focus", () => {
        const r = (shape as SVGGraphicsElement).getBoundingClientRect();
        cb.onTooltip(build(), slice.ids, r.left + r.width / 2, r.top);
    });
    shape.addEventListener("blur", () => cb.onTooltipHide());
}

/** the cartesian legend lists series; a donut's legend lists slices */
function buildSliceLegend(
    slices: Slice[],
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
    el.style.gap = vertical ? "6px" : "12px";
    el.style.padding = "2px 8px 6px";
    el.style.maxHeight = vertical ? "100%" : "60px";
    el.style.overflow = "auto";
    el.style.flex = "0 0 auto";

    if (lg.showTitle.value && lg.titleText.value) {
        const t = document.createElement("span");
        t.textContent = lg.titleText.value;
        t.style.fontWeight = "600";
        t.style.color = theme.isHighContrast ? theme.foreground : colorOf(lg.fontColor);
        applyFontTo(t, lg.font);
        el.appendChild(t);
    }

    const shape = enumOf(lg.markerShape);
    const size = lg.markerSize.value || 8;

    slices.forEach((s) => {
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
        label.style.whiteSpace = "nowrap";
        applyFontTo(label, lg.font);
        item.appendChild(label);

        item.onclick = (e: MouseEvent) =>
            cb.onSelect(s.ids, e.ctrlKey || e.metaKey || e.shiftKey, s.rows, s.seriesIndex);
        item.onkeydown = (e: KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                cb.onSelect(s.ids, e.ctrlKey || e.metaKey || e.shiftKey, s.rows, s.seriesIndex);
            }
        };
        if (cb.hasSelection() && !cb.isSelected(s.ids)) {
            item.style.opacity = "0.4";
        }
        el.appendChild(item);
    });

    return el;
}

function applyFontTo(el: HTMLElement, font): void {
    const f = cssFont(font);
    Object.keys(f).forEach((k) => el.style.setProperty(k, f[k]));
}
