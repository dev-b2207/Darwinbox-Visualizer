import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 900, height: 620 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });

await page.goto("file://" + path.join(__dirname, "harness.html"));
await page.waitForTimeout(600);

const setType = async (t, extra) => {
  await page.evaluate(({ t, extra }) => {
    const h = document.getElementById("host"); h.style.width = "840px"; h.style.height = "400px";
    window.__viewport = { width: 840, height: 400 };
    window.__dataView.metadata.objects = Object.assign({
      chartSettings: { chartType: t },
      controlBar: { showTitle: true, titleText: t === "line" ? "Headcount Trend" : "Headcount by Department" },
      dataLabels: { show: true },
      valueAxis: { showTitle: true, titleText: "Employee Count" },
      categoryAxis: { showTitle: true }
    }, extra || {});
    window.__update();
  }, { t, extra });
  await page.waitForTimeout(900);
};

await setType("stackedColumn", {});
const col = await page.evaluate(() => ({
  bars: document.querySelectorAll("#host .dbx-content svg rect").length,
  lines: document.querySelectorAll("#host .dbx-content svg path").length,
  yTicks: Array.from(document.querySelectorAll("#host .dbx-content svg text")).map(t=>t.textContent).slice(0,6),
  xTitle: (document.querySelector("#host .dbx-x-title")||{}).textContent,
  title: (document.querySelector("#host .dbx-chart-title")||{}).textContent
}));
console.log("stackedColumn:", JSON.stringify(col));
await page.locator("#host").screenshot({ path: path.join(__dirname, "../shots/39-merged-column.png") });

await setType("line", { state: { selectedDimension: "Calendar.Date" }, legend: { show: true, position: "top", align: "left" } });
const ln = await page.evaluate(() => ({
  bars: document.querySelectorAll("#host .dbx-content svg rect").length,
  paths: document.querySelectorAll("#host .dbx-content svg path").length,
  markers: document.querySelectorAll("#host .dbx-content svg polygon").length,
  yTicks: Array.from(document.querySelectorAll("#host .dbx-content svg text")).map(t=>t.textContent).slice(0,6),
  title: (document.querySelector("#host .dbx-chart-title")||{}).textContent
}));
console.log("line:", JSON.stringify(ln));
await page.locator("#host").screenshot({ path: path.join(__dirname, "../shots/40-merged-line.png") });

/* switching type must not disturb the table half */
await page.evaluate(() => {
  window.__addDetailFields();
  window.__dataView.metadata.objects.state = { viewMode: "table" };
  window.__dataView.metadata.objects.tableSetting = { paginationSize: 10, titleText: "Employee Data" };
  window.__update();
});
await page.waitForTimeout(1100);
console.log("table half after switching:", await page.evaluate(() => ({
  headers: Array.from(document.querySelectorAll("#host .tabulator-col-title")).map(t=>t.textContent.trim()).filter(Boolean),
  title: (document.querySelector("#host .dbx-table-title")||{}).textContent,
  rows: document.querySelectorAll("#host .tabulator-row").length
})));

console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no page errors");
await browser.close();
