/*
 * The bar and the table must agree. With a point-in-time measure (1 for people
 * active at a date, 0 for the rest) at employee x date grain, a "Last" roll-up
 * shows the actives at the latest date - and the table has to list exactly those
 * people, not everyone the query paired with that category.
 */
import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
});
const page = await browser.newPage({ viewport: { width: 980, height: 620 } });
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("console", (m) => {
    if (m.type() === "error") errors.push("CONSOLE: " + m.text());
});

const boot = async (objects) => {
    await page.goto("file://" + path.join(__dirname, "harness.html"));
    await page.waitForTimeout(400);
    await page.evaluate((objects) => {
        window.__pointInTimeMeasure();
        const h = document.getElementById("host");
        h.style.width = "900px";
        h.style.height = "500px";
        window.__viewport = { width: 900, height: 500 };
        window.__dataView.metadata.objects = objects;
        window.__update();
    }, objects);
    await page.waitForTimeout(900);
};

const OBJ = {
    chartSettings: { chartType: "stackedColumn" },
    dataSettings: { rollup: "last" },
    dataLabels: { show: true },
    tableSetting: { paginationSize: 100, showExport: true, titleText: "People" },
    legend: { show: false }
};

await boot(OBJ);
const chart = await page.evaluate(() => ({
    expected: window.__expected,
    labels: Array.from(document.querySelectorAll("#host .dbx-content svg text"))
        .map((t) => (t.firstChild ? t.firstChild.textContent : t.textContent).trim())
        .filter((s) => /^\d+$/.test(s))
}));
console.log("bar labels:", JSON.stringify(chart.labels), "expected:", JSON.stringify(chart.expected));

/* click the first bar, switch to table, count the rows */
await page.evaluate(() => {
    document
        .querySelector("#host .dbx-content svg rect")
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await page.waitForTimeout(500);
await page.evaluate(() => {
    document.querySelectorAll("#host .dbx-view-toggle button")[1].click();
});
await page.waitForTimeout(1300);

const table = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("#host .tabulator-row"));
    return {
        rows: rows.length,
        counter: (document.querySelector("#host .tabulator-paginator") || {}).textContent || "",
        first: rows.length ? rows[0].querySelector(".tabulator-cell").textContent : null
    };
});
console.log("table after clicking the first bar:", JSON.stringify(table));

/* export what is shown */
const exported = await page.evaluate(() => {
    const btn = document.querySelector("#host .dbx-export-btn");
    if (!btn) return { missing: true };
    btn.click();
    const e = window.__exported || {};
    const lines = (e.content || "").split("\r\n");
    return { fileName: e.fileName, type: e.fileType, lines: lines.length, head: lines[0], row1: lines[1] };
});
console.log("export:", JSON.stringify(exported));

console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no page errors");
await browser.close();
