/*
 * Checks the shipped defaults with NO format-pane overrides at all:
 *  - axis values and axis titles: 10pt, black
 *  - table column header: 12pt, #0183FF
 *  - table row text: 10pt
 *  - the checkbox row header is hidden
 */
import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
});
const page = await browser.newPage({ viewport: { width: 900, height: 620 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("console", (m) => {
    if (m.type() === "error") errors.push("CONSOLE: " + m.text());
});

await page.goto("file://" + path.join(__dirname, "harness.html"));
await page.waitForTimeout(600);

/* chart view: only the axis titles are switched on, nothing else is styled */
await page.evaluate(() => {
    const h = document.getElementById("host");
    h.style.width = "820px";
    h.style.height = "440px";
    window.__viewport = { width: 820, height: 440 };
    window.__dataView.metadata.objects = {
        chartSettings: { chartType: "stackedColumn" },
        categoryAxis: { showTitle: true },
        valueAxis: { showTitle: true }
    };
    window.__update();
});
await page.waitForTimeout(900);

const axis = await page.evaluate(() => {
    const pick = (el) => {
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { size: cs.fontSize, family: cs.fontFamily.split(",")[0], fill: cs.fill || cs.color };
    };
    const texts = Array.from(document.querySelectorAll("#host .dbx-content svg text"));
    /* tick labels are the numbers on the value axis */
    const tick = texts.filter((t) => /^[\d,]+$/.test(t.textContent.trim()))[0];
    const axisTitle = texts.filter((t) => t.getAttribute("transform"))[0];
    return {
        valueTick: pick(tick),
        valueAxisTitle: pick(axisTitle),
        categoryTitle: pick(document.querySelector("#host .dbx-x-title")),
        categoryLabel: pick(
            texts.filter((t) => t.textContent.indexOf("Engineering") === 0)[0]
        )
    };
});
console.log("axis defaults:", JSON.stringify(axis, null, 1));

/* table view, defaults only */
await page.evaluate(() => {
    window.__addDetailFields();
    window.__dataView.metadata.objects = { state: { viewMode: "table" } };
    window.__update();
});
await page.waitForTimeout(1200);

const table = await page.evaluate(() => {
    const pick = (el) => {
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { size: cs.fontSize, family: cs.fontFamily.split(",")[0], color: cs.color };
    };
    return {
        header: pick(document.querySelector("#host .tabulator-col-title")),
        cell: pick(document.querySelector("#host .tabulator-cell")),
        checkboxColumn: !!document.querySelector("#host .tabulator-row-header"),
        rowCount: document.querySelectorAll("#host .tabulator-row").length
    };
});
console.log("table defaults:", JSON.stringify(table, null, 1));

console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no page errors");
await browser.close();
