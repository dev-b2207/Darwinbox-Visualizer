import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = "file://" + path.join(__dirname, "harness.html");

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 760, height: 520 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("console", (m) => {
    if (m.type() === "error") errors.push("CONSOLE: " + m.text());
});

await page.goto(url);
await page.waitForTimeout(600);

const shot = async (name) => {
    await page.waitForTimeout(250);
    await page.locator("#host").screenshot({ path: path.join(__dirname, `../shots/${name}.png`) });
};

const state = async () =>
    page.evaluate(() => ({
        rendered: window.__rendered,
        err: window.__renderError,
        bars: document.querySelectorAll("#host .dbx-content svg rect, #host .dbx-content svg path").length,
        controls: Array.from(document.querySelectorAll("#host .dbx-controls button")).map((b) => b.textContent || b.getAttribute("aria-label")),
        options: Array.from(document.querySelectorAll("#host .dbx-dd-item span")).map((o) => o.textContent),
        boxText: (document.querySelector("#host .dbx-dd-text") || {}).textContent,
        xLabels: Array.from(document.querySelectorAll("#host .dbx-content svg text")).map((t) => t.textContent).slice(-14),
        persisted: window.__persisted && window.__persisted.merge && window.__persisted.merge[0].properties
    }));

console.log("initial:", JSON.stringify(await state(), null, 1));
await shot("01-chart-department");

// switch to the Date axis through the custom radio dropdown
const pickDimension = async (label) => {
    await page.locator("#host .dbx-dd-box").click();
    await page.waitForTimeout(250);
    await page.locator("#host .dbx-dd-item", { hasText: label }).first().click();
    await page.waitForTimeout(500);
};
await pickDimension("Month");
console.log("date axis:", JSON.stringify(await state(), null, 1));
await shot("02-chart-date-annual");

// granularity -> Quarterly then Monthly
await page.getByRole("button", { name: "Quarterly" }).click();
await page.waitForTimeout(250);
await shot("03-chart-date-quarterly");
console.log("quarterly:", JSON.stringify((await state()).xLabels));

await page.getByRole("button", { name: "Monthly" }).click();
await page.waitForTimeout(250);
await shot("04-chart-date-monthly");
console.log("monthly:", JSON.stringify((await state()).xLabels));

// back to Department, then table view
await pickDimension("Department");
await page.getByRole("button", { name: "Table" }).click();
await page.waitForTimeout(300);
await shot("05-table-department");
const table = await page.evaluate(() => ({
    headers: Array.from(document.querySelectorAll("#host th")).map((t) => t.textContent),
    firstRow: Array.from(document.querySelectorAll("#host tbody tr:first-child td")).map((t) => t.textContent),
    totalRow: Array.from(document.querySelectorAll("#host tfoot td")).map((t) => t.textContent),
    rows: document.querySelectorAll("#host tbody tr").length
}));
console.log("table:", JSON.stringify(table, null, 1));

// back to chart, click a bar to cross-filter
await page.getByRole("button", { name: "Chart" }).click();
await page.waitForTimeout(250);
const barBox = await page.locator("#host .dbx-content svg rect").nth(3).boundingBox();
if (barBox) {
    await page.mouse.click(barBox.x + barBox.width / 2, barBox.y + barBox.height / 2);
    await page.waitForTimeout(300);
}
await shot("06-chart-selection");
console.log("selection count:", await page.evaluate(() => window.__selectionState.length));
console.log("tooltip sample:", await page.evaluate(() => JSON.stringify(window.__lastTooltip && window.__lastTooltip.dataItems)));

if (errors.length) {
    console.log("ERRORS:\n" + errors.join("\n"));
} else {
    console.log("no page errors");
}
await browser.close();
