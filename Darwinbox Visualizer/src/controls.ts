/*
 *  The header control strip.
 *
 *  Layout (matches the Darwinbox reference screens):
 *
 *    row 1   [text] [slot] [text] [slot] [text] [slot] [text]   [chart|table]
 *    row 2   [Annual|Quarterly|Monthly]
 *    row 3   (atom) [ insight banner .......................... ] [chart|table]
 *
 *  The three slots are the Top N box, the dimension dropdown and the second
 *  dimension dropdown, in whatever order Header layout puts them, with free text
 *  before, between and after - which is how both "Top [10] [Department] by
 *  attrition %" and "Attrition % variation by [Gender] across [Department]" come
 *  out of the same three slots.
 *
 *  The dimension dropdown is a custom control rather than a native <select>, so
 *  the open list is a radio-button panel that overlays the chart, as in the
 *  reference. Row 2 only exists when the granularity switch is placed on its own
 *  row (the default). In table view the dimension selector and the granularity
 *  switch are hidden unless explicitly switched on, leaving just the view icons.
 */
import { VisualSettings, colorOf, enumOf } from "./settings";
import { AxisFieldOption, Granularity, ViewMode } from "./dataModel";
import { cssFont, clearNode } from "./utils";

export interface ControlsState {
    axisOptions: AxisFieldOption[];
    activeAxisKey: string;
    /** options offered by the second dropdown (the active axis is never among them) */
    dimension2Options: AxisFieldOption[];
    activeDimension2Key: string;
    topN: number;
    granularity: Granularity;
    viewMode: ViewMode;
    granularityEnabled: boolean;
    /** which of the three buttons this dataview can offer */
    granularityAvailable: { annual: boolean; quarterly: boolean; monthly: boolean };
    /** used as the table-view heading when Table Setting -> Title is left blank */
    tableTitleFallback: string;
    /** resolved insight sentence: the measure's value, else the static setting */
    insightText: string;
}

export interface ControlsCallbacks {
    onAxisChange: (key: string) => void;
    onDimension2Change: (key: string) => void;
    onTopNChange: (n: number) => void;
    onGranularityChange: (g: Granularity) => void;
    onViewChange: (v: ViewMode) => void;
}

const CHEVRON_DOWN = "M2.6 5.2a.8.8 0 0 1 1.1 0L8 9.4l4.3-4.2a.8.8 0 1 1 1.1 1.1l-4.8 4.8a.8.8 0 0 1-1.1 0L2.6 6.3a.8.8 0 0 1 0-1.1z";
const CHEVRON_UP = "M13.4 10.8a.8.8 0 0 1-1.1 0L8 6.6l-4.3 4.2a.8.8 0 1 1-1.1-1.1l4.8-4.8a.8.8 0 0 1 1.1 0l4.9 4.8a.8.8 0 0 1 0 1.1z";

/*
 * View-toggle artwork, drawn as rectangles in a 20x20 box to match the icons the
 * Darwinbox reports already use: three ascending bars for the chart, and a grid
 * with a solid header band for the table.
 */
type Rect = { x: number; y: number; w: number; h: number; r?: number };

const CHART_BARS: Rect[] = [
    { x: 3, y: 12, w: 3.7, h: 6, r: 0.6 },
    { x: 8.15, y: 7.6, w: 3.7, h: 10.4, r: 0.6 },
    { x: 13.3, y: 3.4, w: 3.7, h: 14.6, r: 0.6 }
];

const TABLE_GRID: Rect[] = [
    /* header band */
    { x: 2.6, y: 3.6, w: 14.8, h: 3.7, r: 0.8 },
    /* two rows of three cells */
    { x: 2.6, y: 8.5, w: 4.27, h: 3.5, r: 0.4 },
    { x: 7.87, y: 8.5, w: 4.27, h: 3.5, r: 0.4 },
    { x: 13.13, y: 8.5, w: 4.27, h: 3.5, r: 0.4 },
    { x: 2.6, y: 13, w: 4.27, h: 3.5, r: 0.4 },
    { x: 7.87, y: 13, w: 4.27, h: 3.5, r: 0.4 },
    { x: 13.13, y: 13, w: 4.27, h: 3.5, r: 0.4 }
];

const SVG_NS = "http://www.w3.org/2000/svg";

function icon(pathData: string, size: number, color: string): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", pathData);
    path.setAttribute("fill", color);
    svg.appendChild(path);
    return svg;
}

function rectIcon(shapes: Rect[], size: number, color: string): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 20 20");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("aria-hidden", "true");
    shapes.forEach((r) => {
        const el = document.createElementNS(SVG_NS, "rect");
        el.setAttribute("x", String(r.x));
        el.setAttribute("y", String(r.y));
        el.setAttribute("width", String(r.w));
        el.setAttribute("height", String(r.h));
        if (r.r) {
            el.setAttribute("rx", String(r.r));
        }
        el.setAttribute("fill", color);
        svg.appendChild(el);
    });
    return svg;
}

function applyFontTo(el: HTMLElement, font): void {
    const s = cssFont(font);
    Object.keys(s).forEach((k) => el.style.setProperty(k, s[k]));
}

function justify(align: string): string {
    return align === "center"
        ? "center"
        : align === "right"
        ? "flex-end"
        : align === "spread"
        ? "space-between"
        : "flex-start";
}

function styleButton(
    btn: HTMLElement,
    selected: boolean,
    opts: {
        fontColor: string;
        background: string;
        selectedFontColor: string;
        selectedBackground: string;
        borderColor: string;
        borderWidth: number;
        cornerRadius: number;
        height: number;
        paddingX: number;
        minWidth?: number;
    }
): void {
    btn.style.color = selected ? opts.selectedFontColor : opts.fontColor;
    btn.style.background = selected ? opts.selectedBackground : opts.background;
    btn.style.border = `${opts.borderWidth}px solid ${opts.borderColor}`;
    btn.style.borderRadius = `${opts.cornerRadius}px`;
    btn.style.height = `${opts.height}px`;
    btn.style.lineHeight = `${Math.max(0, opts.height - 2 * opts.borderWidth)}px`;
    btn.style.padding = `0 ${opts.paddingX}px`;
    btn.style.cursor = "pointer";
    btn.style.whiteSpace = "nowrap";
    btn.style.boxSizing = "border-box";
    btn.style.textAlign = "center";
    if (opts.minWidth) {
        btn.style.minWidth = `${opts.minWidth}px`;
    }
}

/* ------------------------------------------------------------------ */
/* dimension dropdown: closed box + radio-list popup                   */
/* ------------------------------------------------------------------ */

interface DropdownSpec {
    options: { key: string; label: string }[];
    activeKey: string;
    onChange: (key: string) => void;
    ariaLabel: string;
}

function buildDimensionDropdown(
    settings: VisualSettings,
    spec: DropdownSpec,
    hc: { on: boolean; fg: string; bg: string }
): HTMLElement {
    const ds = settings.dimensionSelector;
    const fg = hc.on ? hc.fg : colorOf(ds.fontColor);
    const bg = hc.on ? hc.bg : colorOf(ds.background);
    const border = hc.on ? hc.fg : colorOf(ds.borderColor);
    const accent = hc.on ? hc.fg : colorOf(ds.accentColor);

    const active = spec.options.filter((o) => o.key === spec.activeKey)[0];

    const wrap = document.createElement("div");
    wrap.className = "dbx-dd";

    /* --- closed box ------------------------------------------------ */
    const box = document.createElement("button");
    box.type = "button";
    box.className = "dbx-dd-box";
    box.setAttribute("aria-haspopup", "listbox");
    box.setAttribute("aria-expanded", "false");
    box.setAttribute("aria-label", spec.ariaLabel);
    applyFontTo(box, ds.font);
    box.style.color = fg;
    box.style.background = bg;
    box.style.border = `${ds.borderWidth.value}px solid ${border}`;
    box.style.borderRadius = `${ds.cornerRadius.value}px`;
    box.style.minWidth = `${ds.minWidth.value}px`;
    box.style.height = `${ds.height.value}px`;

    const boxText = document.createElement("span");
    boxText.className = "dbx-dd-text";
    boxText.textContent = active ? active.label : "";
    box.appendChild(boxText);

    const chev = document.createElement("span");
    chev.className = "dbx-dd-chev";
    chev.appendChild(icon(CHEVRON_DOWN, 12, fg));
    box.appendChild(chev);
    wrap.appendChild(box);

    /* --- popup ----------------------------------------------------- */
    const popup = document.createElement("div");
    popup.className = "dbx-dd-popup";
    popup.setAttribute("role", "radiogroup");
    popup.style.display = "none";
    popup.style.background = hc.on ? hc.bg : colorOf(ds.popupBackground);
    popup.style.border = `1px solid ${border}`;
    popup.style.maxHeight = `${ds.popupMaxHeight.value}px`;
    popup.style.minWidth = `${ds.minWidth.value}px`;

    const groupName = `dbx-dim-${spec.ariaLabel.replace(/\W+/g, "")}-${spec.options.length}`;
    spec.options.forEach((opt) => {
        const item = document.createElement("label");
        item.className = "dbx-dd-item";
        applyFontTo(item, ds.font);
        item.style.color = fg;

        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = groupName;
        radio.value = opt.key;
        radio.checked = opt.key === spec.activeKey;
        radio.style.accentColor = accent;
        radio.addEventListener("change", () => {
            if (radio.checked) {
                close();
                spec.onChange(opt.key);
            }
        });
        item.appendChild(radio);

        const txt = document.createElement("span");
        txt.textContent = opt.label;
        item.appendChild(txt);

        item.addEventListener("mouseenter", () => {
            item.style.background = hc.on ? hc.fg : colorOf(ds.popupHoverBackground);
            if (hc.on) {
                item.style.color = hc.bg;
            }
        });
        item.addEventListener("mouseleave", () => {
            item.style.background = "transparent";
            item.style.color = fg;
        });

        popup.appendChild(item);
    });
    wrap.appendChild(popup);

    /* --- open / close --------------------------------------------- */
    let open = false;
    const outside = (e: MouseEvent) => {
        if (!wrap.contains(e.target as Node)) {
            close();
        }
    };
    const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
            close();
            box.focus();
        }
    };

    function setChevron(up: boolean): void {
        clearNode(chev);
        chev.appendChild(icon(up ? CHEVRON_UP : CHEVRON_DOWN, 12, fg));
    }

    function close(): void {
        if (!open) {
            return;
        }
        open = false;
        popup.style.display = "none";
        box.setAttribute("aria-expanded", "false");
        setChevron(false);
        document.removeEventListener("mousedown", outside, true);
        document.removeEventListener("keydown", onKey, true);
    }

    function openPopup(): void {
        if (open) {
            return;
        }
        open = true;
        popup.style.display = "block";
        box.setAttribute("aria-expanded", "true");
        setChevron(true);
        document.addEventListener("mousedown", outside, true);
        document.addEventListener("keydown", onKey, true);
        const checked = popup.querySelector('input[type="radio"]:checked') as HTMLInputElement;
        if (checked) {
            checked.focus();
        }
    }

    box.addEventListener("click", (e) => {
        e.stopPropagation();
        if (open) {
            close();
        } else {
            openPopup();
        }
    });

    (wrap as unknown as { __close: () => void }).__close = close;
    return wrap;
}

/* ------------------------------------------------------------------ */

export function renderControls(
    container: HTMLElement,
    settings: VisualSettings,
    state: ControlsState,
    cb: ControlsCallbacks,
    isHighContrast: boolean,
    hcForeground: string,
    hcBackground: string
): number {
    /* close any open dimension dropdown before its DOM is torn down, otherwise
       the document-level mousedown/keydown listeners it registered outlive it */
    const openDropdowns = container.querySelectorAll(".dbx-dd");
    for (let i = 0; i < openDropdowns.length; i++) {
        (openDropdowns[i] as unknown as { __close?: () => void }).__close?.();
    }
    clearNode(container);
    const bar = settings.controlBar;
    const hc = { on: isHighContrast, fg: hcForeground, bg: hcBackground };

    if (!bar.show.value) {
        container.style.display = "none";
        return 0;
    }

    const isTable = state.viewMode === "table";
    const ds = settings.dimensionSelector;
    const gs = settings.granularitySwitch;
    const vt = settings.viewToggle;
    const hl = settings.headerLayout;
    const tn = settings.topN;
    const d2 = settings.dimension2;
    const ins = settings.insight;

    /* what is actually visible in this view mode */
    const showDimension =
        ds.show.value && state.axisOptions.length > 0 && (!isTable || ds.showInTableView.value);
    const showDimension2 =
        d2.show.value && state.dimension2Options.length > 0 && (!isTable || d2.showInTableView.value);
    const showTopN = tn.show.value && (!isTable || tn.showInTableView.value);
    const showGranularity =
        gs.show.value && state.granularityEnabled && (!isTable || gs.showInTableView.value);
    const insightText = state.insightText || "";
    const showInsight = ins.show.value && !!insightText && (!isTable || ins.showInTableView.value);
    /* the toggle rides on the insight row when there is one, as in the reference */
    const toggleOnInsightRow = showInsight && ins.withViewToggle.value;

    container.style.display = "block";
    container.style.background = hc.on ? hc.bg : colorOf(bar.background);
    container.style.borderBottom =
        bar.borderWidth.value > 0
            ? `${bar.borderWidth.value}px solid ${hc.on ? hc.fg : colorOf(bar.borderColor)}`
            : "none";
    container.style.padding = `${bar.paddingY.value}px ${bar.paddingX.value}px`;
    container.style.boxSizing = "border-box";

    const placement = enumOf(gs.placement);
    const granularityOwnRow = placement !== "headerRow";

    /* ---------------------------------------------- row 1 --------- */
    const row1 = document.createElement("div");
    row1.className = "dbx-ctl-row";
    row1.style.display = "flex";
    row1.style.alignItems = "center";
    row1.style.gap = `${bar.gap.value}px`;
    row1.style.justifyContent = "flex-start";
    /* the toggle is the tallest thing here even when the row is otherwise empty,
       so the header keeps its height and the toggle stays vertically centred */
    row1.style.minHeight = `${vt.show.value ? vt.size.value : 0}px`;
    container.appendChild(row1);

    /*
     * Left cluster: the title, then the header slots. It takes all the free width so
     * the view toggle is pinned to the far end of the row whatever the alignment
     * setting says and whether or not anything is in the cluster - with no dimension
     * mapped the toggle used to follow an empty cluster wherever the alignment put it.
     * The alignment setting now positions the cluster's own contents.
     */
    const left = document.createElement("div");
    left.className = "dbx-ctl-group";
    left.style.display = "flex";
    left.style.alignItems = "center";
    left.style.gap = "6px";
    left.style.flexWrap = "nowrap";
    left.style.minWidth = "0";
    left.style.flex = "1 1 auto";
    /*
     * The cluster's contents stay packed together - spreading them would push the
     * dropdown away from the label it belongs to, which is what "Headcount by" and
     * its dropdown at opposite ends of the header was. "Space between" describes the
     * gap between the cluster and the toggle, and the cluster growing already does
     * that, so it reads as left here.
     */
    const clusterAlign = enumOf(bar.align);
    left.style.justifyContent = clusterAlign === "spread" ? "flex-start" : justify(clusterAlign);

    /*
     * Heading at the top-left of the header row: "Headcount Trend" in chart view,
     * "Employee Data" in table view. Table view prefers its own Table Setting
     * title and falls back to the shared header title, then to the row field.
     */
    if (isTable && settings.tableSetting.showTitle.value) {
        const ts = settings.tableSetting;
        const titleText =
            ts.titleText.value || bar.titleText.value || state.tableTitleFallback || "";
        if (titleText) {
            const title = document.createElement("span");
            title.className = "dbx-table-title";
            title.textContent = titleText;
            applyFontTo(title, ts.titleFont);
            title.style.color = hc.on ? hc.fg : colorOf(ts.titleFontColor);
            left.appendChild(title);
        }
    } else if (!isTable && bar.showTitle.value && bar.titleText.value) {
        const title = document.createElement("span");
        title.className = "dbx-chart-title";
        title.textContent = bar.titleText.value;
        applyFontTo(title, bar.titleFont);
        title.style.color = hc.on ? hc.fg : colorOf(bar.titleFontColor);
        left.appendChild(title);
    }

    /* ---------------------------------------------- slots --------- */
    const addText = (value: string): void => {
        if (!value) {
            return;
        }
        const lbl = document.createElement("span");
        lbl.className = "dbx-ctl-label";
        lbl.textContent = value;
        applyFontTo(lbl, hl.font);
        lbl.style.color = hc.on ? hc.fg : colorOf(hl.fontColor);
        lbl.style.whiteSpace = "nowrap";
        left.appendChild(lbl);
    };

    const addDimension1 = (): void => {
        if (enumOf(ds.controlStyle) === "pills") {
            state.axisOptions.forEach((opt) => {
                const b = document.createElement("button");
                b.type = "button";
                b.textContent = opt.label;
                b.setAttribute("aria-pressed", String(opt.key === state.activeAxisKey));
                applyFontTo(b, ds.font);
                styleButton(b, opt.key === state.activeAxisKey, {
                    fontColor: hc.on ? hc.fg : colorOf(ds.fontColor),
                    background: hc.on ? hc.bg : colorOf(ds.background),
                    selectedFontColor: hc.on ? hc.bg : colorOf(ds.selectedFontColor),
                    selectedBackground: hc.on ? hc.fg : colorOf(ds.selectedBackground),
                    borderColor: hc.on ? hc.fg : colorOf(ds.borderColor),
                    borderWidth: ds.borderWidth.value,
                    cornerRadius: ds.cornerRadius.value,
                    height: ds.height.value,
                    paddingX: 10
                });
                b.onclick = () => cb.onAxisChange(opt.key);
                left.appendChild(b);
            });
            return;
        }
        left.appendChild(
            buildDimensionDropdown(
                settings,
                {
                    options: state.axisOptions,
                    activeKey: state.activeAxisKey,
                    onChange: cb.onAxisChange,
                    ariaLabel: ds.labelText.value || "Dimension"
                },
                hc
            )
        );
    };

    const addDimension2 = (): void => {
        const opts: { key: string; label: string }[] = d2.allowNone.value
            ? [{ key: "", label: d2.noneLabel.value || "(None)" }]
            : [];
        state.dimension2Options.forEach((o) => opts.push({ key: o.key, label: o.label }));
        left.appendChild(
            buildDimensionDropdown(
                settings,
                {
                    options: opts,
                    activeKey: state.activeDimension2Key || "",
                    onChange: cb.onDimension2Change,
                    ariaLabel: "Series dimension"
                },
                hc
            )
        );
    };

    const addTopN = (): void => {
        const box = document.createElement("input");
        box.type = "number";
        box.className = "dbx-topn";
        box.min = "1";
        box.value = String(state.topN);
        box.setAttribute("aria-label", "How many categories to keep");
        applyFontTo(box, tn.font);
        box.style.color = hc.on ? hc.fg : colorOf(tn.fontColor);
        box.style.background = hc.on ? hc.bg : colorOf(tn.background);
        box.style.border = `${tn.borderWidth.value}px solid ${
            hc.on ? hc.fg : colorOf(tn.borderColor)
        }`;
        box.style.borderRadius = `${tn.cornerRadius.value}px`;
        box.style.width = `${tn.boxWidth.value}px`;
        box.style.height = `${tn.height.value}px`;
        box.style.boxSizing = "border-box";
        box.style.padding = "0 6px";
        const commit = (): void => {
            const n = Math.max(1, Math.round(Number(box.value) || 0));
            if (n !== state.topN) {
                cb.onTopNChange(n);
            }
        };
        box.addEventListener("change", commit);
        box.addEventListener("blur", commit);
        box.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Enter") {
                e.preventDefault();
                commit();
            }
        });
        left.appendChild(box);
    };

    /*
     * A slot renders only if its control is available in this view. The text that
     * follows a hidden slot is dropped with it, so turning Top N off does not leave
     * a dangling "by attrition %" fragment in mid-air.
     */
    const renderSlot = (which: string): boolean => {
        if (which === "topN" && showTopN) {
            addTopN();
            return true;
        }
        if (which === "dimension1" && showDimension) {
            addDimension1();
            return true;
        }
        if (which === "dimension2" && showDimension2) {
            addDimension2();
            return true;
        }
        return false;
    };

    const available = (which: string): boolean =>
        (which === "topN" && showTopN) ||
        (which === "dimension1" && showDimension) ||
        (which === "dimension2" && showDimension2);

    /*
     * Work out the running order first, so the text between controls follows what
     * is actually on screen: the last control drawn is followed by "Text after the
     * last" whether that is the first, second or third slot.
     */
    const used: { [k: string]: boolean } = {};
    const order: string[] = [];
    [enumOf(hl.slot1), enumOf(hl.slot2), enumOf(hl.slot3)].forEach((which) => {
        if (which === "none" || used[which] || !available(which)) {
            return;
        }
        used[which] = true;
        order.push(which);
    });

    /* the prefix label on the Dimension selector card is the legacy source of the
       leading text, so existing reports keep their "Headcount by" without change */
    const beforeText =
        hl.textBefore.value ||
        (showDimension && ds.showLabel.value ? ds.labelText.value : "");
    const between = [hl.textBetween1.value, hl.textBetween2.value];

    /*
     * The text belongs to the controls, so when none of them is on screen - table
     * view, typically, where all three are hidden by default - the text goes with
     * them rather than leaving "Top ... Of ... By ... Dimension" stranded.
     */
    if (order.length) {
        addText(beforeText);
        order.forEach((which, i) => {
            renderSlot(which);
            addText(i === order.length - 1 ? hl.textAfter.value : between[i]);
        });
    }
    left.style.gap = `${hl.gap.value}px`;
    row1.appendChild(left);

    /* granularity, when it shares row 1 */
    const gWrap = buildGranularity(settings, state, cb, hc);
    if (showGranularity && !granularityOwnRow) {
        row1.appendChild(gWrap);
    }

    /* right cluster: chart / table icons */
    const buildViewToggle = (): HTMLElement => {
    const right = document.createElement("div");
    right.className = "dbx-ctl-group dbx-view-toggle";
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "4px";
    right.style.flex = "0 0 auto";

    if (vt.show.value) {
        const isIcon = enumOf(vt.controlStyle) === "icon";
        /* the two buttons share one rounded container, as in the reference icons */
        right.style.background = hc.on ? hc.bg : colorOf(vt.groupBackground);
        right.style.borderRadius = `${vt.groupCornerRadius.value}px`;
        right.style.padding = `${vt.groupPadding.value}px`;
        right.style.gap = `${vt.groupPadding.value}px`;
        right.style.boxSizing = "border-box";

        const items: { key: ViewMode; label: string; shapes: Rect[] }[] = [
            { key: "chart", label: vt.chartText.value, shapes: CHART_BARS },
            { key: "table", label: vt.tableText.value, shapes: TABLE_GRID }
        ];
        items.forEach((it) => {
            const b = document.createElement("button");
            b.type = "button";
            const selected = it.key === state.viewMode;
            b.setAttribute("aria-pressed", String(selected));
            b.setAttribute("aria-label", it.label);
            b.title = it.label;
            const ifg = selected
                ? hc.on
                    ? hc.bg
                    : colorOf(vt.selectedIconColor)
                : hc.on
                ? hc.fg
                : colorOf(vt.iconColor);
            const ibg = selected
                ? hc.on
                    ? hc.fg
                    : colorOf(vt.selectedBackground)
                : hc.on
                ? hc.bg
                : colorOf(vt.background);
            if (isIcon) {
                b.appendChild(rectIcon(it.shapes, Math.round(vt.size.value * 0.66), ifg));
                b.style.width = `${vt.width.value}px`;
                b.style.display = "inline-flex";
                b.style.alignItems = "center";
                b.style.justifyContent = "center";
                b.style.padding = "0";
            } else {
                b.textContent = it.label;
                applyFontTo(b, vt.font);
                b.style.padding = "0 10px";
            }
            b.style.color = ifg;
            b.style.background = ibg;
            b.style.border = `${vt.borderWidth.value}px solid ${hc.on ? hc.fg : colorOf(vt.borderColor)}`;
            b.style.borderRadius = `${vt.cornerRadius.value}px`;
            b.style.height = `${vt.size.value}px`;
            b.style.cursor = "pointer";
            b.style.boxSizing = "border-box";
            b.onclick = () => cb.onViewChange(it.key);
            right.appendChild(b);
        });
    }
        return right;
    };

    if (!toggleOnInsightRow) {
        row1.appendChild(buildViewToggle());
    }

    /* ---------------------------------------------- row 2 --------- */
    if (showGranularity && granularityOwnRow) {
        const row2 = document.createElement("div");
        row2.className = "dbx-ctl-row dbx-ctl-row2";
        row2.style.display = "flex";
        row2.style.alignItems = "center";
        row2.style.marginTop = `${gs.marginTop.value}px`;
        row2.style.justifyContent = justify(enumOf(gs.align));
        row2.appendChild(gWrap);
        container.appendChild(row2);
    }

    /* ---------------------------------------------- row 3 --------- */
    if (showInsight) {
        const row3 = document.createElement("div");
        row3.className = "dbx-ctl-row dbx-insight-row";
        row3.style.display = "flex";
        row3.style.alignItems = "center";
        row3.style.gap = "10px";
        row3.style.marginTop = `${ins.marginTop.value}px`;
        container.appendChild(row3);

        if (ins.showIcon.value) {
            row3.appendChild(
                atomIcon(ins.iconSize.value, hc.on ? hc.fg : colorOf(ins.iconColor))
            );
        }

        const pill = document.createElement("div");
        pill.className = "dbx-insight";
        pill.textContent = insightText;
        applyFontTo(pill, ins.font);
        pill.style.color = hc.on ? hc.fg : colorOf(ins.fontColor);
        pill.style.background = hc.on
            ? hc.bg
            : `linear-gradient(90deg, ${colorOf(ins.gradientStart)} 0%, ${colorOf(
                  ins.gradientEnd
              )} 100%)`;
        pill.style.border = hc.on ? `1px solid ${hc.fg}` : "none";
        pill.style.borderRadius = `${ins.cornerRadius.value}px`;
        pill.style.padding = `${ins.paddingY.value}px ${ins.paddingX.value}px`;
        pill.style.flex = "1 1 auto";
        pill.style.minWidth = "0";
        pill.style.boxSizing = "border-box";
        row3.appendChild(pill);

        if (toggleOnInsightRow) {
            row3.appendChild(buildViewToggle());
        }
    }

    return container.getBoundingClientRect().height;
}

/*
 * The insight marker from the reference screens: a nucleus with three orbits.
 * Drawn rather than shipped as an image so it takes the icon colour and stays
 * crisp at any size.
 */
function atomIcon(size: number, color: string): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("aria-hidden", "true");
    svg.style.flex = "0 0 auto";

    [0, 60, 120].forEach((deg) => {
        const e = document.createElementNS(SVG_NS, "ellipse");
        e.setAttribute("cx", "12");
        e.setAttribute("cy", "12");
        e.setAttribute("rx", "10.2");
        e.setAttribute("ry", "4.2");
        e.setAttribute("fill", "none");
        e.setAttribute("stroke", color);
        e.setAttribute("stroke-width", "1.4");
        e.setAttribute("transform", `rotate(${deg} 12 12)`);
        svg.appendChild(e);
    });
    const core = document.createElementNS(SVG_NS, "circle");
    core.setAttribute("cx", "12");
    core.setAttribute("cy", "12");
    core.setAttribute("r", "2.6");
    core.setAttribute("fill", color);
    svg.appendChild(core);
    return svg;
}

/* ------------------------------------------------------------------ */
/* Annual / Quarterly / Monthly                                        */
/* ------------------------------------------------------------------ */

function buildGranularity(
    settings: VisualSettings,
    state: ControlsState,
    cb: ControlsCallbacks,
    hc: { on: boolean; fg: string; bg: string }
): HTMLElement {
    const gs = settings.granularitySwitch;
    const gStyle = enumOf(gs.controlStyle);

    const gWrap = document.createElement("div");
    gWrap.className = "dbx-ctl-group dbx-granularity";
    gWrap.style.display = "flex";
    gWrap.style.alignItems = "center";
    gWrap.style.gap = gStyle === "segmented" ? "0px" : "4px";
    gWrap.style.flex = "0 0 auto";

    /*
     * A button appears when the format pane asks for it AND the dataview can serve
     * it - that is, its own label field is mapped, or a Date field is mapped and the
     * bucket can be derived.
     */
    const avail = state.granularityAvailable;
    const items: { key: Granularity; label: string }[] = [];
    if (gs.showAnnual.value && avail.annual) {
        items.push({ key: "annual", label: gs.annualText.value });
    }
    if (gs.showQuarterly.value && avail.quarterly) {
        items.push({ key: "quarterly", label: gs.quarterlyText.value });
    }
    if (gs.showMonthly.value && avail.monthly) {
        items.push({ key: "monthly", label: gs.monthlyText.value });
    }
    if (!items.length) {
        return gWrap;
    }

    if (gStyle === "dropdown") {
        const sel = document.createElement("select");
        sel.setAttribute("aria-label", "Time granularity");
        items.forEach((it) => {
            const o = document.createElement("option");
            o.value = it.key;
            o.textContent = it.label;
            if (it.key === state.granularity) {
                o.selected = true;
            }
            sel.appendChild(o);
        });
        applyFontTo(sel, gs.font);
        sel.style.color = hc.on ? hc.fg : colorOf(gs.fontColor);
        sel.style.background = hc.on ? hc.bg : colorOf(gs.background);
        sel.style.border = `${gs.borderWidth.value}px solid ${hc.on ? hc.fg : colorOf(gs.borderColor)}`;
        sel.style.borderRadius = `${gs.cornerRadius.value}px`;
        sel.style.height = `${gs.height.value}px`;
        sel.style.padding = "0 6px";
        sel.style.cursor = "pointer";
        sel.style.boxSizing = "border-box";
        sel.onchange = () => cb.onGranularityChange(sel.value as Granularity);
        gWrap.appendChild(sel);
        return gWrap;
    }

    items.forEach((it, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = it.label;
        b.setAttribute("aria-pressed", String(it.key === state.granularity));
        applyFontTo(b, gs.font);
        styleButton(b, it.key === state.granularity, {
            fontColor: hc.on ? hc.fg : colorOf(gs.fontColor),
            background: hc.on ? hc.bg : colorOf(gs.background),
            selectedFontColor: hc.on ? hc.bg : colorOf(gs.selectedFontColor),
            selectedBackground: hc.on ? hc.fg : colorOf(gs.selectedBackground),
            borderColor: hc.on ? hc.fg : colorOf(gs.borderColor),
            borderWidth: gs.borderWidth.value,
            cornerRadius: gStyle === "pills" ? gs.cornerRadius.value : 0,
            height: gs.height.value,
            paddingX: gs.itemPaddingX.value,
            minWidth: gs.itemMinWidth.value
        });
        if (gStyle === "segmented") {
            if (i > 0) {
                b.style.borderLeftWidth = "0px";
            }
            if (i === 0) {
                b.style.borderTopLeftRadius = `${gs.cornerRadius.value}px`;
                b.style.borderBottomLeftRadius = `${gs.cornerRadius.value}px`;
            }
            if (i === items.length - 1) {
                b.style.borderTopRightRadius = `${gs.cornerRadius.value}px`;
                b.style.borderBottomRightRadius = `${gs.cornerRadius.value}px`;
            }
        }
        b.onclick = () => cb.onGranularityChange(it.key);
        gWrap.appendChild(b);
    });

    return gWrap;
}
