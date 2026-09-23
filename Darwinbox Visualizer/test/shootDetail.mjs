import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 820, height: 560 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message + "\n  " + (e.stack||"").split("\n").slice(1,5).join("\n  ")));
page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });

await page.goto("file://" + path.join(__dirname, "harness.html"));
await page.waitForTimeout(600);

const shot = async (n) => { await page.waitForTimeout(300); await page.locator("#host").screenshot({ path: path.join(__dirname, `../shots/${n}.png`) }); };

// add the Table rows / Table columns wells, then re-render into table view
await page.evaluate(() => {
  window.__addDetailFields();
  window.__dataView.metadata.objects = { state: { viewMode: "table" }, tableSetting: { paginationSize: 10 } };
  window.__update();
});
await page.waitForTimeout(1200);

const detailState = await page.evaluate(() => ({
  headers: Array.from(document.querySelectorAll("#host .tabulator-col-title")).map(t => t.textContent.trim()),
  rowCount: document.querySelectorAll("#host .tabulator-row").length,
  counter: (document.querySelector("#host .tabulator-page-counter") || {}).textContent,
  firstRows: Array.from(document.querySelectorAll("#host .tabulator-row")).slice(0,3).map(r =>
    Array.from(r.querySelectorAll(".tabulator-cell")).map(c => c.textContent.trim()).filter(Boolean)),
  pages: Array.from(document.querySelectorAll("#host .tabulator-page")).map(b => b.textContent.trim()),
  treeControls: document.querySelectorAll("#host .dbx-tree-chevron").length
}));
console.log("detail table:", JSON.stringify(detailState, null, 1));
await shot("15-detail-table");

// search across detail columns
await page.fill("#host .dbx-searchInput", "director");
await page.waitForTimeout(900);
console.log("search 'director':", await page.evaluate(() => ({
  counter: (document.querySelector("#host .tabulator-page-counter") || {}).textContent,
  first: Array.from(document.querySelectorAll("#host .tabulator-row")).slice(0,2).map(r =>
    Array.from(r.querySelectorAll(".tabulator-cell")).map(c => c.textContent.trim()).filter(Boolean))
})));
await shot("16-detail-search");
await page.fill("#host .dbx-searchInput", "");
await page.waitForTimeout(800);

// row selection
const box = page.locator("#host .tabulator-row .tabulator-row-header input[type=checkbox]").first();
if (await box.count()) { await box.click(); await page.waitForTimeout(400); }
console.log("selection ids:", await page.evaluate(() => window.__selectionState.length));

// chart must be unaffected by the finer grain
await page.evaluate(() => {
  window.__dataView.metadata.objects = { state: { viewMode: "chart" } };
  window.__update();
});
await page.waitForTimeout(900);
console.log("chart with detail grain:", await page.evaluate(() => ({
  bars: document.querySelectorAll("#host .dbx-content svg rect").length,
  xLabels: Array.from(document.querySelectorAll("#host .dbx-content svg text")).map(t => t.textContent).slice(-13)
})));
await shot("17-chart-with-detail-fields");

console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no page errors");
await browser.close();
