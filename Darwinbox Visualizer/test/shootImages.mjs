import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 920, height: 620 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });

await page.goto("file://" + path.join(__dirname, "harness.html"));
await page.waitForTimeout(600);

const shot = async (n) => { await page.waitForTimeout(350); await page.locator("#host").screenshot({ path: path.join(__dirname, `../shots/${n}.png`) }); };

// resize host to match the reference chart proportions, and configure like the
// "Overall Attrition % by Department" screen
await page.evaluate(() => {
  document.getElementById("host").style.width = "860px";
  document.getElementById("host").style.height = "440px";
  window.__viewport = { width: 860, height: 440 };
  window.__dataView.metadata.objects = {
    dimensionSelector: { labelText: "Overall Attrition % by", minWidth: 200 },
    dataLabels: { show: true, labelPosition: "outsideEnd", fontSize: 9, precision: 1 },
    valueAxis: { showTitle: true, titleText: "Attrition %" },
    categoryAxis: { showTitle: true, titleText: "Department" },
    columnSettings: { widthMode: "fixed", barWidth: 34 },
    legend: { show: false },
    granularitySwitch: { show: false }
  };
  window.__update();
});
await page.waitForTimeout(900);
await shot("18-ref-chart-closed");

const closed = await page.evaluate(() => ({
  prefix: (document.querySelector("#host .dbx-ctl-label")||{}).textContent,
  boxText: (document.querySelector("#host .dbx-dd-text")||{}).textContent,
  boxExpanded: (document.querySelector("#host .dbx-dd-box")||{}).getAttribute ? document.querySelector("#host .dbx-dd-box").getAttribute("aria-expanded") : null,
  scrollbar: (() => { const el = document.querySelector("#host .dbx-plot-scroll"); return el ? { scrollW: el.scrollWidth, clientW: el.clientWidth, scrolls: el.scrollWidth > el.clientWidth } : null; })(),
  xTitleFixed: !!document.querySelector("#host .dbx-x-title"),
  xTitleText: (document.querySelector("#host .dbx-x-title")||{}).textContent,
  barWidths: Array.from(document.querySelectorAll("#host .dbx-content svg rect")).slice(0,4).map(r => r.getAttribute("width")),
  labels: Array.from(document.querySelectorAll("#host .dbx-content svg text")).map(t=>t.textContent).filter(t=>/%$/.test(t)).slice(0,6)
}));
console.log("closed state:", JSON.stringify(closed, null, 1));

// open the dropdown
await page.locator("#host .dbx-dd-box").click();
await page.waitForTimeout(350);
const open = await page.evaluate(() => {
  const p = document.querySelector("#host .dbx-dd-popup");
  const r = p.getBoundingClientRect();
  const host = document.getElementById("host").getBoundingClientRect();
  return {
    expanded: document.querySelector("#host .dbx-dd-box").getAttribute("aria-expanded"),
    radios: Array.from(p.querySelectorAll("input[type=radio]")).map(i => ({ v: i.value, checked: i.checked })),
    labels: Array.from(p.querySelectorAll(".dbx-dd-item span")).map(s => s.textContent),
    overlapsChart: r.top > host.top && r.bottom > host.top + 60,
    scrollableList: p.scrollHeight > p.clientHeight,
    maxHeight: getComputedStyle(p).maxHeight
  };
});
console.log("open state:", JSON.stringify(open, null, 1));
await shot("19-ref-chart-open");

// pick a different dimension
await page.locator("#host .dbx-dd-item", { hasText: "Location" }).first().click();
await page.waitForTimeout(700);
console.log("after pick:", await page.evaluate(() => ({
  boxText: (document.querySelector("#host .dbx-dd-text")||{}).textContent,
  popupOpen: getComputedStyle(document.querySelector("#host .dbx-dd-popup")).display,
  persisted: window.__persisted && window.__persisted.merge[0].properties.selectedDimension
})));
await shot("20-ref-after-pick");

// granularity on its own row, left aligned (Trend screen)
await page.evaluate(() => {
  window.__dataView.metadata.objects = {
    dimensionSelector: { show: false },
    granularitySwitch: { show: true, placement: "ownRow", align: "left", itemMinWidth: 130 },
    dataLabels: { show: false },
    legend: { show: false }
  };
  window.__update();
});
await page.waitForTimeout(800);
console.log("trend layout:", await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll("#host .dbx-ctl-row"));
  const g = document.querySelector("#host .dbx-granularity");
  const icons = document.querySelectorAll("#host .dbx-ctl-group button[aria-label]");
  return {
    rowCount: rows.length,
    granularityInRow2: rows.length > 1 && rows[1].contains(g),
    granularityLeft: Math.round(g.getBoundingClientRect().left - document.getElementById("host").getBoundingClientRect().left),
    segments: Array.from(g.querySelectorAll("button")).map(b => ({ t: b.textContent, w: Math.round(b.getBoundingClientRect().width) })),
    iconsCount: icons.length
  };
}));
await shot("21-ref-trend-granularity");

// table view: no dimension selector, no granularity
await page.evaluate(() => {
  window.__addDetailFields();
  window.__dataView.metadata.objects = {
    state: { viewMode: "table" },
    dimensionSelector: { show: true, labelText: "Overall Attrition % by" },
    granularitySwitch: { show: true },
    tableSetting: { paginationSize: 10 }
  };
  window.__update();
});
await page.waitForTimeout(1200);
console.log("table view controls:", await page.evaluate(() => ({
  dropdown: !!document.querySelector("#host .dbx-dd"),
  prefixLabel: !!document.querySelector("#host .dbx-ctl-label"),
  granularity: !!document.querySelector("#host .dbx-granularity"),
  viewIcons: document.querySelectorAll("#host button[aria-label='Chart'], #host button[aria-label='Table']").length,
  rows: document.querySelectorAll("#host .tabulator-row").length
})));
await shot("22-ref-table-no-dropdown");

console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no page errors");
await browser.close();
