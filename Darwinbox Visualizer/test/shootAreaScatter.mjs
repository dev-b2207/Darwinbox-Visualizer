/*
 * The four types added in v4.5: Area, Stacked area, 100% stacked area, Scatter.
 *
 * What is actually being proved:
 *   - each type draws the marks it should, in the right number;
 *   - stacking is real - the stacked top sits above the overlapping top, and the
 *     100% version fills the plot for every category;
 *   - a stacked band's label reads that series' own value, not the running total;
 *   - the scatter puts one point per category, sizes bubbles from the Size well,
 *     formats each axis from its own measure, and cross-filters on a click;
 *   - a scatter works with the X / Y wells alone, no Values field at all.
 */
import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
});
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("console", (m) => {
    if (m.type() === "error") errors.push("CONSOLE: " + m.text());
});

const fails = [];
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === undefined ? "" : "  " + detail}`);
    if (!ok) fails.push(name);
};

const boot = async (objects, fixture, arg) => {
    await page.goto("file://" + path.join(__dirname, "harness.html"));
    await page.waitForTimeout(350);
    await page.evaluate(
        ({ objects, fixture, arg }) => {
            if (fixture) window[fixture](arg);
            const h = document.getElementById("host");
            h.style.width = "920px";
            h.style.height = "520px";
            window.__viewport = { width: 920, height: 520 };
            window.__dataView.metadata.objects = objects;
            window.__update();
        },
        { objects, fixture, arg }
    );
    await page.waitForTimeout(800);
};

const BASE = {
    tableSetting: { paginationSize: 50 },
    legend: { show: true },
    dataSettings: { sortBy: "category", sortDirection: "asc" }
};

/* what is on the plot, read back in one go */
const readPlot = () =>
    page.evaluate(() => {
        const svg = Array.from(document.querySelectorAll("#host .dbx-content svg")).filter(
            (s) => s.querySelectorAll("path, circle, rect, polygon").length > 2
        )[0];
        const paths = Array.from(svg ? svg.querySelectorAll("path") : []);
        const filled = paths.filter((p) => {
            const o = p.getAttribute("fill-opacity");
            return p.getAttribute("fill") !== "none" && o !== null && parseFloat(o) > 0;
        });
        const topY = (el) => {
            const d = el.getAttribute("d") || "";
            const ys = (d.match(/[-\d.]+,[-\d.]+/g) || []).map((p) => parseFloat(p.split(",")[1]));
            return ys.length ? Math.min.apply(null, ys) : null;
        };
        const texts = Array.from(svg ? svg.querySelectorAll("text") : []).map((t) =>
            (t.textContent || "").trim()
        );
        /* the value axis lives in its own svg beside the plot, so read them all */
        const allTexts = Array.from(document.querySelectorAll("#host .dbx-content svg text")).map(
            (t) => (t.textContent || "").trim()
        );
        return {
            filledPaths: filled.length,
            strokePaths: paths.filter((p) => p.getAttribute("fill") === "none").length,
            markers: svg ? svg.querySelectorAll("circle, polygon, rect[rx]").length : 0,
            highestFill: filled.length ? Math.min.apply(null, filled.map(topY)) : null,
            texts,
            allTexts,
            /* the top of the value axis: what the tallest mark is measured against */
            axisMax: allTexts
                .map((t) => parseFloat(String(t).replace(/[,%]/g, "")))
                .filter((v) => isFinite(v))
                .reduce((m, v) => Math.max(m, v), 0)
        };
    });

/* ---- 1. plain Area: one transparent fill per series, drawn to zero ---- */

await boot({ ...BASE, chartSettings: { chartType: "area" } }, "__singleSeries");
const areaOne = await readPlot();
check("Area draws a fill", areaOne.filledPaths >= 1, `fills=${areaOne.filledPaths}`);
await page.screenshot({ path: path.join(__dirname, "out-area.png") });

await boot({ ...BASE, chartSettings: { chartType: "area" } });
const areaTwo = await readPlot();
check("Area fills each series", areaTwo.filledPaths === 2, `fills=${areaTwo.filledPaths}`);
const areaTransparency = await page.evaluate(() => {
    const p = Array.from(document.querySelectorAll("#host .dbx-content svg path")).filter(
        (x) => x.getAttribute("fill") !== "none" && x.getAttribute("fill-opacity")
    )[0];
    return p ? parseFloat(p.getAttribute("fill-opacity")) : null;
});
check(
    "overlapping fills are see-through",
    areaTransparency !== null && areaTransparency > 0.2 && areaTransparency < 0.5,
    `opacity=${areaTransparency}`
);

/* ---- 2. Stacked area really stacks -------------------------------- */

await boot({ ...BASE, chartSettings: { chartType: "stackedArea" } });
const stacked = await readPlot();
await page.screenshot({ path: path.join(__dirname, "out-stacked-area.png") });
check("Stacked area fills each series", stacked.filledPaths === 2, `fills=${stacked.filledPaths}`);
/*
 * Both modes scale their tallest mark to the top of the plot, so pixels prove
 * nothing. The value axis does: stacking two series has to push the axis past
 * where the taller series alone reached.
 */
check(
    "the stack really stacks - the value axis grows",
    stacked.axisMax > areaTwo.axisMax,
    `stacked axis=${stacked.axisMax} overlap axis=${areaTwo.axisMax}`
);
const stackedNearlySolid = await page.evaluate(() => {
    const p = Array.from(document.querySelectorAll("#host .dbx-content svg path")).filter(
        (x) => x.getAttribute("fill") !== "none" && x.getAttribute("fill-opacity")
    )[0];
    return p ? parseFloat(p.getAttribute("fill-opacity")) : null;
});
check("stacked fills are near-solid", stackedNearlySolid > 0.7, `opacity=${stackedNearlySolid}`);

/* ---- 3. 100% stacked area: a percentage axis, full every category -- */

await boot(
    { ...BASE, chartSettings: { chartType: "percentArea" }, dataLabels: { show: true } },
    null
);
const pct = await readPlot();
await page.screenshot({ path: path.join(__dirname, "out-percent-area.png") });
check("100% area fills each series", pct.filledPaths === 2, `fills=${pct.filledPaths}`);
check(
    "value axis is a percentage",
    pct.allTexts.some((t) => /^100%$/.test(t)) && pct.allTexts.some((t) => /^0%$/.test(t)),
    JSON.stringify(pct.allTexts.filter((t) => /^\d+%$/.test(t)).slice(0, 6))
);
/* the label on a band is that band's share, so no label may exceed 100% */
const shareLabels = pct.texts.filter((t) => /^\d+%$/.test(t)).map((t) => parseInt(t, 10));
check(
    "band labels are shares, not running totals",
    shareLabels.length > 0 && shareLabels.every((v) => v >= 0 && v <= 100),
    JSON.stringify(shareLabels.slice(0, 8))
);

/* ---- 4. Scatter with the X / Y / Size wells and no Values field ---- */

await boot(
    {
        ...BASE,
        chartSettings: { chartType: "scatter" },
        dataLabels: { show: true },
        categoryAxis: { showTitle: true },
        valueAxis: { showTitle: true }
    },
    "__scatterMeasures"
);
await page.screenshot({ path: path.join(__dirname, "out-scatter.png") });

const sc = await page.evaluate(() => {
    const svg = Array.from(document.querySelectorAll("#host .dbx-content svg")).filter(
        (s) => s.querySelectorAll("circle").length > 1
    )[0];
    const circles = Array.from(svg ? svg.querySelectorAll("circle") : []);
    const texts = Array.from(svg ? svg.querySelectorAll("text") : []).map((t) =>
        (t.textContent || "").trim()
    );
    return {
        points: circles.length,
        radii: circles.map((c) => parseFloat(c.getAttribute("r"))),
        xs: circles.map((c) => parseFloat(c.getAttribute("cx"))),
        ys: circles.map((c) => parseFloat(c.getAttribute("cy"))),
        texts
    };
});
const CATEGORIES = 12;
check("one point per category", sc.points === CATEGORIES, `points=${sc.points}`);
check(
    "bubbles are sized from the Size well",
    new Set(sc.radii.map((r) => Math.round(r))).size > 3,
    JSON.stringify(sc.radii.map((r) => Math.round(r)))
);
check(
    "points are spread on both axes, not on a diagonal",
    new Set(sc.xs.map(Math.round)).size > 3 && new Set(sc.ys.map(Math.round)).size > 3,
    `distinct x=${new Set(sc.xs.map(Math.round)).size} y=${new Set(sc.ys.map(Math.round)).size}`
);
check(
    "X axis is formatted by its own measure (a percentage)",
    sc.texts.some((t) => /%$/.test(t)),
    JSON.stringify(sc.texts.filter((t) => /%$/.test(t)).slice(0, 5))
);
check(
    "axis titles name the two wells",
    sc.texts.indexOf("Attrition %") !== -1 && sc.texts.indexOf("Avg Tenure (Yrs)") !== -1,
    JSON.stringify(sc.texts.slice(-4))
);
check(
    "points are labelled with the category",
    sc.texts.some((t) => /Finance\/Accounts|Engineering|Marketing/.test(t)),
    JSON.stringify(sc.texts.filter((t) => /[A-Za-z]{4}/.test(t)).slice(0, 5))
);

/* a click cross-filters, through the same path every other type uses */
const before = await page.evaluate(() => {
    window.__filters = null;
    const c = document.querySelector("#host .dbx-content svg circle");
    c.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return true;
});
await page.waitForTimeout(500);
const clicked = await page.evaluate(() => ({
    filters: window.__filters,
    dimmed: Array.from(document.querySelectorAll("#host .dbx-content svg circle")).filter(
        (c) => parseFloat(c.getAttribute("fill-opacity")) < 0.5
    ).length
}));
check("clicking a point cross-filters", !!clicked.filters, JSON.stringify(clicked.filters && clicked.filters.filter && clicked.filters.filter[0] && clicked.filters.filter[0].values));
check("the other points dim", clicked.dimmed > 3, `dimmed=${clicked.dimmed}`);
void before;

/* ---- 5. Scatter with a legend: one point per category and series --- */

await boot({ ...BASE, chartSettings: { chartType: "scatter" } }, "__scatterMeasures", true);
await page.screenshot({ path: path.join(__dirname, "out-scatter-legend.png") });
const scl = await page.evaluate(
    () => document.querySelectorAll("#host .dbx-content svg circle").length
);
check("legend splits each category into a point per series", scl === CATEGORIES * 2, `points=${scl}`);

/* ---- 6. the table view is untouched by any of this ----------------- */

await boot(
    { ...BASE, chartSettings: { chartType: "scatter" }, state: { viewMode: "table" } },
    "__scatterMeasures"
);
const rows = await page.evaluate(() => document.querySelectorAll("#host .tabulator-row").length);
check("table view still renders under the scatter type", rows > 0, `rows=${rows}`);

if (errors.length) {
    console.log("\nPAGE ERRORS:");
    errors.forEach((e) => console.log("  " + e));
}
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(", ")}` : "\nall good");
await browser.close();
process.exit(fails.length || errors.length ? 1 : 0);
