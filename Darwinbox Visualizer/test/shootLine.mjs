import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 940, height: 620 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });

await page.goto("file://" + path.join(__dirname, "harness.html"));
await page.waitForTimeout(600);
const shot = async (n) => { await page.waitForTimeout(350); await page.locator("#host").screenshot({ path: path.join(__dirname, `../shots/${n}.png`) }); };

/* ---- reference 1: "Headcount Trend", single series, Date axis ---- */
await page.evaluate(() => {
  const h = document.getElementById("host"); h.style.width = "860px"; h.style.height = "420px";
  window.__viewport = { width: 860, height: 420 };
  window.__singleSeries(72);
  window.__dataView.metadata.objects = {
    chartSettings: { chartType: "line" },
    state: { selectedDimension: "Calendar.Date", granularity: "annual" },
    controlBar: { showTitle: true, titleText: "Headcount Trend" },
    dimensionSelector: { show: false },
    granularitySwitch: { show: true, placement: "ownRow", align: "left", itemMinWidth: 92 },
    dataLabels: { show: true },
    valueAxis: { showTitle: true, titleText: "Employee Count" },
    categoryAxis: { showTitle: true, titleText: "Fiscal Year" },
    timeSettings: { yearLabelStyle: "startYear" },
    dataSettings: { rollup: "last" },
    legend: { show: false }
  };
  window.__update();
});
await page.waitForTimeout(1000);
const single = await page.evaluate(() => ({
  paths: document.querySelectorAll("#host .dbx-content svg path").length,
  markers: document.querySelectorAll("#host .dbx-content svg polygon").length,
  yTicks: Array.from(document.querySelectorAll("#host svg")).length && Array.from(document.querySelectorAll("#host .dbx-content svg text")).map(t=>t.textContent).slice(0,8),
  xLabels: Array.from(document.querySelectorAll("#host .dbx-content svg text")).map(t=>t.textContent).filter(t=>/^20\d\d$/.test(t)),
  yTitle: Array.from(document.querySelectorAll("#host .dbx-content svg text")).map(t=>t.textContent).filter(t=>t==="Employee Count").length,
  xTitle: (document.querySelector("#host .dbx-x-title")||{}).textContent
}));
console.log("single series:", JSON.stringify(single, null, 1));
await shot("32-line-single-series");

/* ---- reference 2: two measures, legend top-left ---- */
await page.goto("file://" + path.join(__dirname, "harness.html"));
await page.waitForTimeout(600);
await page.evaluate(() => {
  const h = document.getElementById("host"); h.style.width = "900px"; h.style.height = "420px";
  window.__viewport = { width: 900, height: 420 };
  window.__twoMeasures();
  window.__dataView.metadata.objects = {
    chartSettings: { chartType: "line" },
    state: { selectedDimension: "Calendar.Date", granularity: "annual" },
    controlBar: { showTitle: true, titleText: "Trend of New Hires and Exits" },
    dimensionSelector: { show: false },
    granularitySwitch: { show: true, placement: "ownRow", align: "left", itemMinWidth: 92 },
    dataLabels: { show: true },
    valueAxis: { showTitle: true, titleText: "Employee Count" },
    categoryAxis: { showTitle: true, titleText: "Fiscal Year" },
    timeSettings: { yearLabelStyle: "startYear" },
    legend: { show: true, position: "top", align: "left" }
  };
  window.__update();
});
await page.waitForTimeout(1000);
const two = await page.evaluate(() => ({
  legendItems: Array.from(document.querySelectorAll("#host .dbx-legend [role=button] span")).map(s=>s.textContent),
  legendMarkers: document.querySelectorAll("#host .dbx-legend svg polygon").length,
  lines: document.querySelectorAll("#host .dbx-content svg path").length,
  lineColors: Array.from(document.querySelectorAll("#host .dbx-content svg path")).map(p=>p.getAttribute("stroke")),
  markers: document.querySelectorAll("#host .dbx-content svg polygon").length,
  labels: Array.from(document.querySelectorAll("#host .dbx-content svg text")).map(t=>t.textContent).filter(t=>/^[\d,]+$/.test(t))
}));
console.log("two measures:", JSON.stringify(two, null, 1));
await shot("33-line-two-measures");

/* ---- scrolling with many points, and the table half unchanged ---- */
await page.evaluate(() => {
  window.__dataView.metadata.objects.state = { selectedDimension: "Calendar.Date", granularity: "monthly" };
  window.__dataView.metadata.objects.chartSettings = { chartType: "line" };
  window.__dataView.metadata.objects.lineSettings = { spacingMode: "fixed", pointSpacing: 120 };
  window.__update();
});
await page.waitForTimeout(900);
console.log("scroll:", await page.evaluate(() => {
  const el = document.querySelector("#host .dbx-plot-scroll");
  return { scrolls: el.scrollWidth > el.clientWidth, scrollW: el.scrollWidth, clientW: el.clientWidth, thumb: !!document.querySelector("#host .dbx-hscroll-thumb") };
}));
await shot("34-line-scroll");

await page.evaluate(() => { window.__dataView.metadata.objects.state = { viewMode: "table" }; window.__update(); });
await page.waitForTimeout(1100);
console.log("table half:", await page.evaluate(() => ({
  tabulator: !!document.querySelector("#host .tabulator"),
  headers: Array.from(document.querySelectorAll("#host .tabulator-col-title")).map(t=>t.textContent.trim()).filter(Boolean),
  search: !!document.querySelector("#host .dbx-searchBar"),
  counter: (document.querySelector("#host .tabulator-page-counter")||{}).textContent
})));
await shot("35-line-table");

console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no page errors");
await browser.close();
