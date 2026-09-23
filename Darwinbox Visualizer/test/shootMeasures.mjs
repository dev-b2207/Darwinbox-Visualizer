import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 780, height: 480 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });

await page.goto("file://" + path.join(__dirname, "harness.html"));
await page.waitForTimeout(600);
const shot = async (n) => { await page.waitForTimeout(350); await page.locator("#host").screenshot({ path: path.join(__dirname, `../shots/${n}.png`) }); };

const state = () => page.evaluate(() => ({
  headers: Array.from(document.querySelectorAll("#host .tabulator-col-title")).map((t) => t.textContent.trim()).filter(Boolean),
  hasTotalStrip: !!document.querySelector("#host .tabulator-calcs-bottom"),
  totals: Array.from(document.querySelectorAll("#host .tabulator-calcs-bottom .tabulator-cell")).map((c) => c.textContent.trim()),
  firstRow: Array.from(document.querySelectorAll("#host .tabulator-row:first-child .tabulator-cell")).map((c) => c.textContent.trim()).filter(Boolean),
  counter: (document.querySelector("#host .tabulator-page-counter") || {}).textContent
}));

/* Table rows = Employee Name, Table columns = Dept/Designation/DOJ/Manager,
   Ending Headcount sits in Values - it must NOT become a column */
await page.evaluate(() => {
  const h = document.getElementById("host"); h.style.width = "740px"; h.style.height = "440px";
  window.__viewport = { width: 740, height: 440 };
  window.__addDetailFields();
  window.__dataView.metadata.objects = {
    state: { viewMode: "table" },
    tableSetting: { paginationSize: 10, titleText: "Employee Data" }
  };
  window.__update();
});
await page.waitForTimeout(1200);
console.log("default (measures hidden):", JSON.stringify(await state(), null, 1));
await shot("30-table-no-value-measures");

/* opt back in */
await page.evaluate(() => {
  window.__dataView.metadata.objects.tableSetting = { paginationSize: 10, titleText: "Employee Data", showMeasureColumns: true };
  window.__update();
});
await page.waitForTimeout(1200);
console.log("with showMeasureColumns=true:", JSON.stringify(await state(), null, 1));
await shot("31-table-with-value-measures");

/* chart-derived fallback (no Table rows) must still show the measures */
await page.goto("file://" + path.join(__dirname, "harness.html"));
await page.waitForTimeout(600);
await page.evaluate(() => {
  window.__dataView.metadata.objects = { state: { viewMode: "table" } };
  window.__update();
});
await page.waitForTimeout(1100);
console.log("chart-derived fallback:", JSON.stringify(await state(), null, 1));

console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no page errors");
await browser.close();
