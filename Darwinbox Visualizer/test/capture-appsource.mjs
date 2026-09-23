/*
 * Capture the raw plates for the AppSource screenshots.
 *
 * Playwright renders the visual in the test harness at a fixed size and writes one
 * PNG per configuration; compose-screenshots.py then lays those plates onto the
 * 1366x768 canvases Partner Center requires, with the headline and callouts.
 * Keeping capture and composition apart means a caption can be reworded without
 * re-rendering the visual.
 */
import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "appsource-plates");
const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

const shoot = async ({ name, objects, fixture, args, size, action }) => {
    await page.goto("file://" + path.join(__dirname, "harness.html"));
    await page.waitForTimeout(350);
    await page.evaluate(
        ({ objects, fixture, args, size }) => {
            if (fixture) window[fixture](args);
            const h = document.getElementById("host");
            h.style.width = size[0] + "px";
            h.style.height = size[1] + "px";
            h.style.background = "#FFFFFF";
            window.__viewport = { width: size[0], height: size[1] };
            window.__dataView.metadata.objects = objects;
            window.__update();
        },
        { objects, fixture, args, size }
    );
    await page.waitForTimeout(900);
    if (action) {
        await page.evaluate(action);
        await page.waitForTimeout(800);
    }
    await page.locator("#host").screenshot({ path: path.join(OUT, name + ".png") });
    console.log("captured", name);
};

const BASE = {
    controlBar: { show: true },
    legend: { show: true, position: "top", align: "left" },
    dataSettings: { sortBy: "value", sortDirection: "desc" }
};

/* 1 - the whole point: controls that live in the visual */
await shoot({
    name: "overview",
    size: [1180, 700],
    objects: {
        ...BASE,
        chartSettings: { chartType: "stackedColumn" },
        controlBar: { show: true, showTitle: false },
        headerLayout: { slot1: "dimension1", textBefore: "Headcount by" },
        dataLabels: { show: true },
        valueAxis: { showTitle: true, titleText: "Employee Count", fontSize: 9 },
        categoryAxis: { fontSize: 9 }
    }
});

/* 2 - four of the fifteen types, same fields, one setting apart */
const typePlate = async (key, label, extra, fixture, args) =>
    shoot({
        name: "type-" + key,
        size: [560, 320],
        fixture,
        args,
        objects: {
            ...BASE,
            chartSettings: { chartType: key },
            controlBar: { show: true, showTitle: true, titleText: label },
            headerLayout: { slot1: "dimension1", textBefore: "by" },
            categoryAxis: { fontSize: 8 },
            valueAxis: { fontSize: 8 },
            legend: { show: true, position: "top", align: "left", fontSize: 8 },
            ...(extra || {})
        }
    });

await typePlate("stackedColumn", "Stacked column");
await typePlate("line", "Line", { state: { selectedDimension: "Calendar.Date" } });
await typePlate("stackedArea", "Stacked area", { state: { selectedDimension: "Calendar.Date" } });
await typePlate("donut", "Donut", { legend: { show: true, position: "right", align: "left", fontSize: 8 } });
await typePlate(
    "scatter",
    "Scatter",
    { legend: { show: false }, dataSettings: { rollup: "avg", sortBy: "value", sortDirection: "desc" } },
    "__scatterMeasures"
);
await typePlate("ribbon", "Ribbon", { state: { selectedDimension: "Calendar.Date" } });

/* 3 - the table half, reached from the same toggle */
await shoot({
    name: "table",
    size: [1180, 700],
    fixture: "__addDetailFields",
    objects: {
        ...BASE,
        chartSettings: { chartType: "stackedColumn" },
        controlBar: { show: true, showTitle: true, titleText: "Employee Data" },
        state: { viewMode: "table" },
        tableSetting: { paginationSize: 8, showExport: true },
        cellFormatting: { show: false }
    }
});

/* 4 - the header sentence and the insight banner */
await shoot({
    name: "header",
    size: [1180, 700],
    fixture: "__addInsight",
    args: "Attrition is 2.4 points above the same quarter last year, driven by Engineering.",
    objects: {
        ...BASE,
        chartSettings: { chartType: "clusteredColumn" },
        controlBar: { show: true, showTitle: false },
        headerLayout: {
            slot1: "topN",
            slot2: "dimension1",
            slot3: "dimension2",
            textBefore: "Top",
            textBetween1: "",
            textBetween2: "by headcount, split by",
            textAfter: ""
        },
        topN: { show: true, defaultValue: 8 },
        dimension2: { show: true },
        state: { selectedDimension2: "Employee Attributes.Location" },
        insight: { show: true },
        dataLabels: { show: true },
        categoryAxis: { fontSize: 9 },
        valueAxis: { fontSize: 9 }
    }
});

/* 5 - the same visual, cross-filtered by a click on a column */
await shoot({
    name: "selection",
    size: [1180, 700],
    objects: {
        ...BASE,
        chartSettings: { chartType: "stackedColumn" },
        controlBar: { show: true, showTitle: false },
        headerLayout: { slot1: "dimension1", textBefore: "Headcount by" },
        dataLabels: { show: true },
        categoryAxis: { fontSize: 9 },
        valueAxis: { fontSize: 9 }
    },
    action: () => {
        const r = document.querySelectorAll("#host .dbx-content svg rect");
        if (r.length) r[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
});

if (errors.length) {
    console.log("PAGE ERRORS:", errors.join("\n"));
}
await browser.close();
process.exit(errors.length ? 1 : 0);
