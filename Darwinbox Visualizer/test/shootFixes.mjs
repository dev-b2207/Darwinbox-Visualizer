import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });

await page.goto("file://" + path.join(__dirname, "harness.html"));
await page.waitForTimeout(600);
const shot = async (n) => { await page.waitForTimeout(350); await page.locator("#host").screenshot({ path: path.join(__dirname, `../shots/${n}.png`) }); };

/* ---- 1. duplicate-dimension bug ---- */
await page.evaluate(() => {
  const h = document.getElementById("host"); h.style.width = "560px"; h.style.height = "360px";
  window.__viewport = { width: 560, height: 360 };
  window.__duplicateRoleFields();
  window.__dataView.metadata.objects = { legend: { show: false }, granularitySwitch: { show: false } };
  window.__update();
});
await page.waitForTimeout(900);
await page.locator("#host .dbx-dd-box").click();
await page.waitForTimeout(300);
console.log("dropdown options (was GC, Dept, GC, Dept):", await page.evaluate(() => ({
  labels: Array.from(document.querySelectorAll("#host .dbx-dd-item span")).map((s) => s.textContent),
  keys: Array.from(document.querySelectorAll("#host .dbx-dd-item input")).map((i) => i.value),
  checked: Array.from(document.querySelectorAll("#host .dbx-dd-item input")).filter((i) => i.checked).length
})));
await shot("27-fix-no-duplicate-dimensions");
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

// picking the second option must actually switch the axis
await page.locator("#host .dbx-dd-box").click();
await page.waitForTimeout(250);
await page.locator("#host .dbx-dd-item", { hasText: "Group Company" }).first().click();
await page.waitForTimeout(700);
console.log("after picking Group Company:", await page.evaluate(() => ({
  boxText: (document.querySelector("#host .dbx-dd-text") || {}).textContent,
  firstXLabel: (Array.from(document.querySelectorAll("#host .dbx-content svg text")).filter((t) => /^GC /.test(t.textContent))[0] || {}).textContent
})));

/* ---- 2. new icons, both states ---- */
await page.evaluate(() => { window.__dataView.metadata.objects = { legend: { show: false } }; window.__update(); });
await page.waitForTimeout(700);
console.log("icon geometry (chart active):", await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll("#host button[aria-label='Chart'], #host button[aria-label='Table']"));
  const group = btns[0].parentElement;
  return {
    groupBg: getComputedStyle(group).backgroundColor,
    groupRadius: getComputedStyle(group).borderRadius,
    buttons: btns.map((b) => ({
      label: b.getAttribute("aria-label"),
      pressed: b.getAttribute("aria-pressed"),
      bg: getComputedStyle(b).backgroundColor,
      rects: b.querySelectorAll("rect").length,
      fill: b.querySelector("rect") && b.querySelector("rect").getAttribute("fill")
    }))
  };
}));
await page.locator("#host button[aria-label='Chart'], #host button[aria-label='Table']").first().screenshot({ path: path.join(__dirname, "../shots/28-icon-chart-active.png") });

/* ---- 3. table view header ---- */
await page.evaluate(() => {
  const h = document.getElementById("host"); h.style.width = "700px"; h.style.height = "420px";
  window.__viewport = { width: 700, height: 420 };
  window.__addDetailFields();
  window.__dataView.metadata.objects = {
    state: { viewMode: "table" },
    tableSetting: { paginationSize: 10, titleText: "Employee Data" }
  };
  window.__update();
});
await page.waitForTimeout(1200);
console.log("table header:", await page.evaluate(() => {
  const t = document.querySelector("#host .dbx-table-title");
  const btns = Array.from(document.querySelectorAll("#host button[aria-label='Chart'], #host button[aria-label='Table']"));
  return {
    title: t && t.textContent,
    titleFont: t && getComputedStyle(t).fontSize,
    dropdown: !!document.querySelector("#host .dbx-dd"),
    granularity: !!document.querySelector("#host .dbx-granularity"),
    tableActive: btns.map((b) => `${b.getAttribute("aria-label")}=${b.getAttribute("aria-pressed")}`),
    rows: document.querySelectorAll("#host .tabulator-row").length
  };
}));
await shot("29-table-with-header");

// and the fallback when Title is left blank
await page.evaluate(() => {
  window.__dataView.metadata.objects.tableSetting = { paginationSize: 10 };
  window.__update();
});
await page.waitForTimeout(1000);
console.log("blank title falls back to:", await page.evaluate(() =>
  (document.querySelector("#host .dbx-table-title") || {}).textContent));

console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no page errors");
await browser.close();
