/*
 *  Chart dispatcher.
 *
 *  Keeps the same exported surface the rest of the visual expects
 *  (renderChart / ChartCallbacks / Theme) and delegates to the renderer for the
 *  selected chart type. See charts/registry.ts to add a type.
 */
import { VisualSettings, colorOf, enumOf } from "./settings";
import { ChartModel } from "./dataModel";
import { clearNode } from "./utils";
import { ChartCallbacks, Theme } from "./charts/frame";
import { chartTypeFor } from "./charts/registry";

export { ChartCallbacks, Theme } from "./charts/frame";

export function renderChart(
    root: HTMLElement,
    model: ChartModel,
    settings: VisualSettings,
    width: number,
    height: number,
    cb: ChartCallbacks,
    theme: Theme
): void {
    clearNode(root);
    root.style.position = "relative";
    root.style.width = `${width}px`;
    root.style.height = `${height}px`;
    root.style.display = "flex";
    root.style.flexDirection = "column";
    root.style.overflow = "hidden";

    const pa = settings.plotArea;
    root.style.background = theme.isHighContrast ? theme.background : colorOf(pa.background);
    if (pa.borderWidth.value > 0) {
        root.style.border = `${pa.borderWidth.value}px solid ${
            theme.isHighContrast ? theme.foreground : colorOf(pa.borderColor)
        }`;
        root.style.borderRadius = `${pa.cornerRadius.value}px`;
    }

    if (!model || !model.categories.length) {
        return;
    }

    chartTypeFor(enumOf(settings.chartSettings.chartType)).render(
        root,
        model,
        settings,
        width,
        height,
        cb,
        theme
    );
}
