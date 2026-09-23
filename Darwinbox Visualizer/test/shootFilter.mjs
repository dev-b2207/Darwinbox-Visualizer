/*
 * Cross-filtering.
 *
 *   1. clicking a mark repaints BEFORE the host is told, so the visual is usable
 *      while Power BI is still re-querying the rest of the page;
 *   2. on the fast path the host is handed a report filter naming the mark's
 *      coordinates - two conditions - not one identity per source row;
 *   3. the "Highlight" setting still hands over identities, unchanged;
 *   4. nothing raises the identity-cap banner any more.
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

const fails = [];
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === undefined ? "" : "  " + detail}`);
    if (!ok) fails.push(name);
};

const boot = async (objects, fixture) => {
    await page.goto("file://" + path.join(__dirname, "harness.html"));
    await page.waitForTimeout(400);
    await page.evaluate(
        ({ objects, fixture }) => {
            if (fixture) window[fixture]();
            const h = document.getElementById("host");
            h.style.width = "900px";
            h.style.height = "500px";
            window.__viewport = { width: 900, height: 500 };
            window.__dataView.metadata.objects = objects;
            window.__update();
        },
        { objects, fixture }
    );
    await page.waitForTimeout(800);
};

const BASE = {
    chartSettings: { chartType: "stackedColumn" },
    dataSettings: { maxSelectionIds: 4 },
    tableSetting: { paginationSize: 50 },
    legend: { show: true }
};

/* ---- 1. the repaint does not wait for the host ------------------- */

await boot(BASE);

const instant = await page.evaluate(() => {
    const before = document.querySelectorAll("#host .dbx-content svg rect").length;
    document
        .querySelector("#host .dbx-content svg rect")
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    /* read straight back, in the same task: nothing async has had a turn yet */
    const rects = Array.from(document.querySelectorAll("#host .dbx-content svg rect"));
    const dimmed = rects.filter((r) => {
        const o = parseFloat(r.getAttribute("fill-opacity") || r.style.opacity || "1");
        return o > 0 && o < 1;
    }).length;
    return { before, after: rects.length, dimmed, told: !!window.__filters };
});
check("mark dims before the host is called", instant.dimmed > 0 && !instant.told, JSON.stringify(instant));

await page.waitForTimeout(400);

/* ---- 2. the fast path hands over a filter, not identities -------- */

const fast = await page.evaluate(() => ({
    filters: window.__filters,
    ids: window.__selectionState.length,
    notice: (() => {
        const n = document.querySelector("#host .dbx-notice");
        return n ? n.style.display : "gone";
    })()
}));
console.log("filter payload:", JSON.stringify(fast.filters));
check("host was given a report filter", !!fast.filters && fast.filters.objectName === "general", fast.filters && fast.filters.propertyName);
check("filter action is merge", fast.filters && fast.filters.action === 0);

const list = (fast.filters && fast.filters.filter) || [];
check("one condition per coordinate, not per row", list.length === 2, `filters=${list.length}`);
check(
    "axis condition names the dimension",
    list[0] && list[0].target.table === "Function Mapping" && list[0].target.column === "Department",
    JSON.stringify(list[0] && list[0].target)
);
check(
    "axis condition holds a single category",
    list[0] && Array.isArray(list[0].values) && list[0].values.length === 1,
    JSON.stringify(list[0] && list[0].values)
);
check(
    "series condition names the legend column",
    list[1] && list[1].target.column === "Employement Type" && list[1].values.length === 1,
    JSON.stringify(list[1] && list[1].values)
);
check("no selection identities were sent", fast.ids === 0, `ids=${fast.ids}`);
check("no identity-cap banner", fast.notice === "none" || fast.notice === "gone", fast.notice);

/* the grid still filters to the clicked mark, which is local bookkeeping */
await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("#host .dbx-controls button"));
    const t = btns.filter((b) => /table/i.test(b.title || b.getAttribute("aria-label") || ""))[0];
    if (t) t.click();
});
await page.waitForTimeout(700);
const tableRows = await page.evaluate(
    () => document.querySelectorAll("#host .tabulator-row").length
);
check("grid still trims to the clicked mark", tableRows > 0, `rows=${tableRows}`);

/* ---- 3. Highlight keeps the identity path ------------------------ */

await boot({ ...BASE, dataSettings: { maxSelectionIds: 4, crossFilter: "highlight" } });
await page.evaluate(() => {
    window.__filters = null;
    document
        .querySelector("#host .dbx-content svg rect")
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await page.waitForTimeout(500);
const hl = await page.evaluate(() => ({
    filters: window.__filters,
    ids: window.__selectionState.length,
    notice: (() => {
        const n = document.querySelector("#host .dbx-notice");
        return n ? n.style.display : "gone";
    })()
}));
check("highlight mode sends identities", hl.ids > 0, `ids=${hl.ids}`);
check("highlight mode sends no filter", !hl.filters);
check("highlight mode raises no banner either", hl.notice === "none" || hl.notice === "gone", hl.notice);

/* ---- 4. clicking the background lifts the filter ----------------- */

await boot(BASE);
await page.evaluate(() => {
    document
        .querySelector("#host .dbx-content svg rect")
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await page.waitForTimeout(400);
await page.evaluate(() => {
    /* the legend draws its swatches in little <svg>s of their own; the plot is
       the one that actually holds bars */
    const svg = Array.from(document.querySelectorAll("#host .dbx-content svg")).filter(
        (s) => s.querySelector("rect")
    )[0];
    svg.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await page.waitForTimeout(400);
const cleared = await page.evaluate(() => window.__filters);
check("background click removes the filter", !!cleared && cleared.action === 1, JSON.stringify(cleared));

/* ---- 5. a date axis filters on a range -------------------------- */

await boot({ ...BASE, state: { selectedDimension: "Calendar.Date" } });
await page.evaluate(() => {
    window.__filters = null;
    document
        .querySelector("#host .dbx-content svg rect")
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await page.waitForTimeout(500);
const dated = await page.evaluate(() => window.__filters);
const dl = (dated && dated.filter) || [];
console.log("date payload:", JSON.stringify(dated));
check(
    "date bucket becomes a two-condition range",
    dl[0] && dl[0].conditions && dl[0].conditions.length === 2,
    JSON.stringify(dl[0] && dl[0].conditions)
);

if (errors.length) {
    console.log("\nPAGE ERRORS:");
    errors.forEach((e) => console.log("  " + e));
}
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(", ")}` : "\nall good");
await browser.close();
process.exit(fails.length || errors.length ? 1 : 0);
