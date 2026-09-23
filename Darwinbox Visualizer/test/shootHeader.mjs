/*
 * The v4 header work, one case per reference screenshot:
 *   Top N + dimension + trailing text
 *   dimension 2 (series split) with text between the two dropdowns
 *   the insight banner with the view toggle inline
 *   per-granularity label columns driving the axis
 *   combo markers-only
 */
import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
});
const page = await browser.newPage({ viewport: { width: 1040, height: 700 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("console", (m) => {
    if (m.type() === "error") errors.push("CONSOLE: " + m.text());
});

const render = async (objects, size, fixtures) => {
    await page.goto("file://" + path.join(__dirname, "harness.html"));
    await page.waitForTimeout(400);
    await page.evaluate(
        ({ objects, size, fixtures }) => {
            (fixtures || []).forEach((f) => window[f.fn].apply(null, f.args || []));
            const h = document.getElementById("host");
            h.style.width = size[0] + "px";
            h.style.height = size[1] + "px";
            window.__viewport = { width: size[0], height: size[1] };
            window.__dataView.metadata.objects = objects;
            window.__update();
        },
        { objects, size, fixtures }
    );
    await page.waitForTimeout(900);
};

/** everything on the header, in DOM order, so slot ordering is verifiable */
const header = () =>
    page.evaluate(() => {
        const out = [];
        const walk = (row) => {
            const items = [];
            row.querySelectorAll(":scope > *").forEach((el) => {
                if (el.classList.contains("dbx-ctl-group")) {
                    if (el.classList.contains("dbx-view-toggle")) {
                        items.push("[toggle]");
                        return;
                    }
                    el.querySelectorAll(":scope > *").forEach((c) => items.push(describe(c)));
                    return;
                }
                items.push(describe(el));
            });
            out.push(items.filter(Boolean));
        };
        const describe = (el) => {
            if (el.classList.contains("dbx-topn")) return `N=${el.value}`;
            if (el.classList.contains("dbx-dd"))
                return `[${el.querySelector(".dbx-dd-text").textContent}]`;
            if (el.classList.contains("dbx-insight")) return `banner:"${el.textContent}"`;
            if (el.tagName === "svg") return "(icon)";
            if (el.classList.contains("dbx-view-toggle")) return "[toggle]";
            if (el.classList.contains("dbx-granularity"))
                return (
                    "gran:" +
                    Array.from(el.querySelectorAll("button"))
                        .map((b) => b.textContent + (b.getAttribute("aria-pressed") === "true" ? "*" : ""))
                        .join("/")
                );
            const t = (el.textContent || "").trim();
            return t ? `"${t}"` : null;
        };
        document.querySelectorAll("#host .dbx-ctl-row").forEach(walk);
        return out;
    });

const plot = () =>
    page.evaluate(() => ({
        bars: document.querySelectorAll("#host .dbx-content svg rect").length,
        paths: document.querySelectorAll("#host .dbx-content svg path").length,
        markers: document.querySelectorAll("#host .dbx-content svg polygon").length,
        xLabels: Array.from(document.querySelectorAll("#host .dbx-content svg text"))
            .map((t) => t.textContent)
            .filter((t) => /^(Q|FY|[A-Z][a-z]{2} )/.test(t))
            .slice(0, 4),
        legend: Array.from(document.querySelectorAll("#host .dbx-legend span")).map(
            (s) => s.textContent
        ),
        legendPos: (() => {
            const lg = document.querySelector("#host .dbx-legend");
            const sv = document.querySelector("#host .dbx-content svg");
            if (!lg || !sv) return null;
            return lg.getBoundingClientRect().top < sv.getBoundingClientRect().top
                ? "above"
                : "below";
        })()
    }));

/* ---------------------------------------------------------------- 1 */
await render(
    {
        chartSettings: { chartType: "clusteredColumn" },
        topN: { show: true, defaultValue: 10 },
        headerLayout: {
            slot1: "topN",
            slot2: "dimension1",
            textBefore: "Top",
            textAfter: "by attrition %"
        },
        dimensionSelector: { showLabel: false },
        dataLabels: { show: true }
    },
    [820, 420],
    [{ fn: "__ratioMeasure" }]
);
console.log("1 topN+dim :", JSON.stringify(await header()));
await page.locator("#host").screenshot({ path: path.join(__dirname, "../shots/60-topn.png") });

/* ---------------------------------------------------------------- 2 */
await render(
    {
        chartSettings: { chartType: "clusteredColumn" },
        controlBar: { showTitle: true, titleText: "" },
        dimension2: { show: true },
        headerLayout: {
            slot1: "dimension2",
            slot2: "dimension1",
            textBefore: "Attrition % variation by",
            textBetween1: "across"
        },
        dimensionSelector: { showLabel: false },
        state: { selectedDimension: "Function Mapping.Department", selectedDimension2: "Employee Attributes.Location" },
        legend: { show: true, position: "right", align: "left" },
        dataLabels: { show: true },
        dataSettings: { sortBy: "value" }
    },
    [980, 460],
    []
);
console.log("2 dim2     :", JSON.stringify(await header()));
console.log("           ", JSON.stringify(await plot()));
await page.locator("#host").screenshot({ path: path.join(__dirname, "../shots/61-dim2.png") });

/* ---------------------------------------------------------------- 3 */
await render(
    {
        chartSettings: { chartType: "combo" },
        controlBar: { showTitle: true, titleText: "Ending Headcount by Tenure (Yrs)" },
        insight: { show: true },
        comboSettings: { lineDisplay: "markers" },
        dimensionSelector: { show: false },
        granularitySwitch: { show: false },
        dataLabels: { show: true },
        valueAxis: { showTitle: true, titleText: "Employee Count" },
        dataSettings: { rollup: "avg" }
    },
    [1000, 500],
    [{ fn: "__comboMeasures", args: [1] }, { fn: "__addInsight" }]
);
console.log("3 insight  :", JSON.stringify(await header()));
console.log("           ", JSON.stringify(await plot()));
await page.locator("#host").screenshot({ path: path.join(__dirname, "../shots/62-insight-markers.png") });

/* ---------------------------------------------------------------- 4 */
await render(
    {
        chartSettings: { chartType: "clusteredColumn" },
        controlBar: { showTitle: true, titleText: "Exited Employees by Quarter" },
        state: { selectedDimension: "Calendar.Date", granularity: "quarterly" },
        granularitySwitch: { show: true, placement: "headerRow" },
        dataLabels: { show: true }
    },
    [1000, 440],
    [{ fn: "__addGranularityLabels" }]
);
console.log("4 qtr label:", JSON.stringify(await header()));
console.log("           ", JSON.stringify(await plot()));
await page.locator("#host").screenshot({ path: path.join(__dirname, "../shots/63-granularity-labels.png") });

/* ---------------------------------------------------------------- 5 */
await render(
    {
        chartSettings: { chartType: "clusteredColumn" },
        state: { selectedDimension: "__time", granularity: "annual" },
        granularitySwitch: { show: true, placement: "headerRow" },
        dataLabels: { show: true }
    },
    [1000, 440],
    [{ fn: "__addGranularityLabels" }, { fn: "__dropDate" }]
);
console.log("5 no date  :", JSON.stringify(await header()));
console.log("           ", JSON.stringify(await plot()));
await page.locator("#host").screenshot({ path: path.join(__dirname, "../shots/64-label-only.png") });

console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no page errors");
await browser.close();
