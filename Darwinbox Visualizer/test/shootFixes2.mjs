/*
 * The four v4.1 reports:
 *   1 header slot text must not survive into table view
 *   2 the tooltip must not blank on mousemove
 *   3 Cell Formatting must not repeat one column as many identical groups
 *   4 Dimensions 2 well + the two dropdowns hiding each other's pick
 */
import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
});
const page = await browser.newPage({ viewport: { width: 980, height: 640 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("console", (m) => {
    if (m.type() === "error") errors.push("CONSOLE: " + m.text());
});

const boot = async (objects, fixtures, size) => {
    await page.goto("file://" + path.join(__dirname, "harness.html"));
    await page.waitForTimeout(400);
    await page.evaluate(
        ({ objects, fixtures, size }) => {
            (fixtures || []).forEach((f) => window[f.fn].apply(null, f.args || []));
            if (size) {
                const h = document.getElementById("host");
                h.style.width = size[0] + "px";
                h.style.height = size[1] + "px";
                window.__viewport = { width: size[0], height: size[1] };
            }
            window.__dataView.metadata.objects = objects;
            window.__update();
        },
        { objects, fixtures, size }
    );
    await page.waitForTimeout(900);
};

const headerText = () =>
    page.evaluate(() =>
        Array.from(document.querySelectorAll("#host .dbx-ctl-label")).map((e) => e.textContent)
    );

/* ---- 1. slot text in chart view, gone in table view ---------------- */
const slotObjects = {
    topN: { show: true, defaultValue: 5 },
    dimension2: { show: true },
    headerLayout: {
        slot1: "topN",
        slot2: "dimension1",
        slot3: "dimension2",
        textBefore: "Top",
        textBetween1: "Of",
        textBetween2: "By",
        textAfter: "Dimension"
    },
    dimensionSelector: { showLabel: false }
};
await boot(slotObjects, [{ fn: "__addDetailFields" }], [900, 460]);
console.log("1 chart view text:", JSON.stringify(await headerText()));
await boot(
    Object.assign({ state: { viewMode: "table" } }, slotObjects),
    [{ fn: "__addDetailFields" }],
    [900, 460]
);
console.log("1 table view text:", JSON.stringify(await headerText()));

/* ---- 2. tooltip survives a mousemove ------------------------------ */
await boot({ chartSettings: { chartType: "stackedColumn" } }, [], [900, 460]);
const tip = await page.evaluate(async () => {
    window.__tooltipLog = [];
    const bars = document.querySelectorAll("#host .dbx-content svg rect");
    const fire = (el, type, x, y) =>
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    const a = bars[0];
    const r = a.getBoundingClientRect();
    fire(a, "mouseover", r.left + 4, r.top + 8);
    fire(a, "mousemove", r.left + 6, r.top + 12);
    fire(a, "mousemove", r.left + 8, r.top + 16);
    /* and across to a different bar */
    const b = bars[3];
    const r2 = b.getBoundingClientRect();
    fire(a, "mouseout", r2.left, r2.top);
    fire(b, "mouseover", r2.left + 4, r2.top + 8);
    fire(b, "mousemove", r2.left + 6, r2.top + 10);
    return window.__tooltipLog;
});
console.log("2 tooltip ops:", JSON.stringify(tip));
console.log(
    "2 blank ops  :",
    tip.filter((o) => o.op !== "hide" && o.n === 0).length,
    "(must be 0)"
);

/* ---- 3. cell formatting groups ------------------------------------ */
const paneGroups = async (objects, fixtures) => {
    await boot(objects, fixtures, [900, 460]);
    return page.evaluate(() => {
        const m = window.__visual.getFormattingModel();
        const card = m.cards.filter((c) => (c.displayName || "") === "Cell Formatting")[0];
        if (!card) return { missing: true };
        const groups = (card.groups || []).map((g) => g.displayName);
        return { groups, slices: (card.topLevelToggle ? 1 : 0) + ((card.groups || []).length ? 0 : 0) };
    });
};
console.log("3 default   :", JSON.stringify(await paneGroups({}, [])));
console.log(
    "3 switched on:",
    JSON.stringify(await paneGroups({ cellFormatting: { show: true } }, []))
);
console.log(
    "3 dim2 split :",
    JSON.stringify(
        await paneGroups(
            { cellFormatting: { show: true }, dimension2: { show: true }, state: { selectedDimension2: "Employee Attributes.Location" } },
            []
        )
    )
);

/* ---- 4. Dimensions 2 well + mutual exclusion ---------------------- */
await boot(
    {
        chartSettings: { chartType: "clusteredColumn" },
        dimension2: { show: true },
        headerLayout: { slot1: "dimension1", slot2: "dimension2" },
        dimensionSelector: { showLabel: false }
    },
    [{ fn: "__addDimension2Well" }],
    [900, 460]
);
const listFor = (i) =>
    page.evaluate((idx) => {
        const dd = document.querySelectorAll("#host .dbx-dd")[idx];
        return Array.from(dd.querySelectorAll(".dbx-dd-item span")).map((s) => s.textContent);
    }, i);
console.log("4 dim1 list :", JSON.stringify(await listFor(0)));
console.log("4 dim2 list :", JSON.stringify(await listFor(1)));

/* the same fields in both wells: picking in one must remove it from the other */
await boot(
    {
        chartSettings: { chartType: "clusteredColumn" },
        dimension2: { show: true },
        headerLayout: { slot1: "dimension1", slot2: "dimension2" },
        dimensionSelector: { showLabel: false },
        state: {
            selectedDimension: "Function Mapping.Department",
            selectedDimension2: "Employee Attributes.Location"
        }
    },
    [{ fn: "__sharedDimension2" }],
    [900, 460]
);
console.log("4 shared d1 :", JSON.stringify(await listFor(0)));
console.log("4 shared d2 :", JSON.stringify(await listFor(1)));

console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no page errors");
await browser.close();
