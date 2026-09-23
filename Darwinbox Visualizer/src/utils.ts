import { valueFormatter } from "powerbi-visuals-utils-formattingutils";

export type IValueFormatter = valueFormatter.IValueFormatter;
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

let measureCanvas: HTMLCanvasElement = null;

export function fontString(font: formattingSettings.FontControl, extra?: { bold?: boolean }): string {
    const size = font.fontSize.value || 10;
    const family = font.fontFamily.value || "Segoe UI";
    const weight = (extra && extra.bold) || (font.bold && font.bold.value) ? "bold" : "normal";
    const style = font.italic && font.italic.value ? "italic" : "normal";
    return `${style} ${weight} ${size}pt ${family}`;
}

export function cssFont(font: formattingSettings.FontControl): { [k: string]: string } {
    return {
        "font-family": font.fontFamily.value || "Segoe UI",
        "font-size": `${font.fontSize.value || 10}pt`,
        "font-weight": font.bold && font.bold.value ? "bold" : "normal",
        "font-style": font.italic && font.italic.value ? "italic" : "normal",
        "text-decoration": font.underline && font.underline.value ? "underline" : "none"
    };
}

export function applyFont(el: HTMLElement | SVGElement, font: formattingSettings.FontControl): void {
    const s = cssFont(font);
    Object.keys(s).forEach((k) => (el as HTMLElement).style.setProperty(k, s[k]));
}

export function measureText(txt: string, font: string): number {
    if (!measureCanvas) {
        measureCanvas = document.createElement("canvas");
    }
    const ctx = measureCanvas.getContext("2d");
    ctx.font = font;
    return ctx.measureText(txt || "").width;
}

export function textHeight(font: formattingSettings.FontControl): number {
    return Math.ceil((font.fontSize.value || 10) * 1.34) + 2;
}

export function truncate(txt: string, font: string, maxWidth: number): string {
    if (!txt) {
        return "";
    }
    if (measureText(txt, font) <= maxWidth) {
        return txt;
    }
    let lo = 0;
    let hi = txt.length;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (measureText(txt.slice(0, mid) + "…", font) <= maxWidth) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    return lo <= 0 ? "" : txt.slice(0, lo) + "…";
}

export function createFormatter(
    format: string,
    displayUnits: number,
    precision: number,
    sampleValue?: number
): IValueFormatter {
    /*
     * "Auto" should behave like the native chart: leave small numbers alone and
     * only switch to K/M once the axis actually needs it. Passing the raw sample
     * value would scale a 1,105 headcount down to "1K".
     */
    const auto = displayUnits === 0;
    const scale = auto ? (Math.abs(sampleValue || 0) >= 10000 ? sampleValue : 0) : displayUnits;
    return valueFormatter.create({
        format,
        value: scale,
        precision: precision === null || precision === undefined ? undefined : precision,
        allowFormatBeautification: true
    });
}

/**
 * Plain format-string formatter, matching tableDarwinbox's getFormattedValue:
 * no display units, no precision override - just the column's own format string
 * (long dates, currency, percent) rendered in the report culture.
 */
export function createSimpleFormatter(format: string, cultureSelector?: string): IValueFormatter {
    return valueFormatter.create({ format, cultureSelector });
}

/** WCAG-ish relative luminance, used for auto-contrast data labels */
export function contrastColor(background: string, light = "#FFFFFF", dark = "#252423"): string {
    const rgb = hexToRgb(background);
    if (!rgb) {
        return dark;
    }
    const srgb = [rgb.r, rgb.g, rgb.b].map((c) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    const lum = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
    return lum > 0.45 ? dark : light;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
    if (!hex) {
        return null;
    }
    let h = hex.trim();
    if (h.charAt(0) === "#") {
        h = h.slice(1);
    }
    if (h.length === 3) {
        h = h.split("").map((c) => c + c).join("");
    }
    if (h.length !== 6) {
        // rgb()/rgba()
        const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(hex);
        if (m) {
            return { r: +m[1], g: +m[2], b: +m[3] };
        }
        return null;
    }
    return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16)
    };
}

export function dashArray(style: string, width: number): string {
    switch (style) {
        case "dashed":
            return `${Math.max(2, width * 4)},${Math.max(2, width * 3)}`;
        case "dotted":
            return `${Math.max(1, width)},${Math.max(2, width * 2)}`;
        default:
            return null;
    }
}

export function roundedRectPath(
    x: number,
    y: number,
    w: number,
    h: number,
    rTop: number,
    rBottom: number
): string {
    const maxR = Math.min(w / 2, h / 2);
    const rt = Math.max(0, Math.min(rTop, maxR));
    const rb = Math.max(0, Math.min(rBottom, maxR));
    return [
        `M${x},${y + rt}`,
        `Q${x},${y} ${x + rt},${y}`,
        `L${x + w - rt},${y}`,
        `Q${x + w},${y} ${x + w},${y + rt}`,
        `L${x + w},${y + h - rb}`,
        `Q${x + w},${y + h} ${x + w - rb},${y + h}`,
        `L${x + rb},${y + h}`,
        `Q${x},${y + h} ${x},${y + h - rb}`,
        "Z"
    ].join(" ");
}

export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
    return document.createElementNS("http://www.w3.org/2000/svg", tag);
}

export function attrs(el: Element, map: { [k: string]: string | number }): void {
    Object.keys(map).forEach((k) => {
        const v = map[k];
        if (v === null || v === undefined) {
            el.removeAttribute(k);
        } else {
            el.setAttribute(k, String(v));
        }
    });
}

export function clearNode(node: Node): void {
    while (node.firstChild) {
        node.removeChild(node.firstChild);
    }
}
