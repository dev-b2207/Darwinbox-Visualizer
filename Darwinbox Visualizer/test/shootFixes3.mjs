/*
 * 1 numeric ordering of bucket labels on the category axis
 * 2 the view toggle sits at the end of the header row with no dimension mapped
 * 3 a chart selection filters the table, and does not rebuild the body twice
 * 4 the pre-data state is a spinner, not a page of field documentation
 */
import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 2 });
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
            window.__renderCount = 0;
            window.__dataView.metadata.objects = objects;
            window.__update();
        },
        { objects, fixtures, size }
    );
    await page.waitForTimeout(800);
};

const axisLabels = () =>
    page.evaluate(() =>
        Array.from(document.querySelectorAll("#host .dbx-content svg text"))
            .map((t) => (t.firstChild ? t.firstChild.textContent : t.textContent).trim())
            .filter((s) => /^\d+(-\d+)?\+?$/.test(s))
    );

/* ---- 1. bucket ordering ------------------------------------------ */
const sortObjects = (numeric) => ({
    chartSettings: { chartType: "stackedColumn" },
    dataSettings: { sortBy: "category", sortDirection: "asc", sortNumeric: numeric },
    categoryAxis: { labelRotation: "0" },
    legend: { show: false }
});
await boot(sortObjects(true), [{ fn: "__bucketCategories" }], [900, 420]);
console.log("1 numeric on :", JSON.stringify(await axisLabels()));
await boot(sortObjects(false), [{ fn: "__bucketCategories" }], [900, 420]);
console.log("1 numeric off:", JSON.stringify(await axisLabels()));

/* ---- 2. toggle position ------------------------------------------ */
for (const align of ["spread", "left", "center"]) {
    await boot(
        {
            dimensionSelector: { show: false },
            granularitySwitch: { show: false },
            controlBar: { showTitle: true, titleText: "Ending Headcount by Tenure", align }
        },
        [],
        [700, 400]
    );
    console.log(
        `2 align=${align.padEnd(6)}:`,
        JSON.stringify(
            await page.evaluate(() => {
                const tog = document.querySelector("#host .dbx-view-toggle");
                const row = document.querySelector("#host .dbx-ctl-row");
                const r = tog.getBoundingClientRect();
                const rr = row.getBoundingClientRect();
                return {
                    sameRow: row.contains(tog),
                    atRightEdge: Math.round(rr.right - r.right) <= 6,
                    centred: Math.abs(Math.round(r.top + r.height / 2 - (rr.top + rr.height / 2))) <= 2
                };
            })
        )
    );
}
/* and with the insight banner on, it must move to that row */
await boot(
    {
        dimensionSelector: { show: false },
        granularitySwitch: { show: false },
        insight: { show: true },
        controlBar: { showTitle: true, titleText: "Ending Headcount by Tenure" }
    },
    [{ fn: "__addInsight" }],
    [900, 420]
);
console.log(
    "2 insight on :",
    JSON.stringify(
        await page.evaluate(() => {
            const tog = document.querySelector("#host .dbx-view-toggle");
            const rows = Array.from(document.querySelectorAll("#host .dbx-ctl-row"));
            return {
                rows: rows.length,
                toggleRow: rows.findIndex((r) => r.contains(tog)),
                onInsightRow: !!tog.closest(".dbx-insight-row")
            };
        })
    )
);

/* ---- 3. selection filters the table ------------------------------ */
const selectThenTable = async (filterBySelection) => {
    await boot(
        {
            chartSettings: { chartType: "stackedColumn" },
            tableSetting: { filterBySelection, paginationSize: 100 }
        },
        [{ fn: "__addDetailFields" }],
        [900, 460]
    );
    const before = await page.evaluate(() => window.__updateCount || 0);
    await page.evaluate(() => {
        document
            .querySelector("#host .dbx-content svg rect")
            .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await page.waitForTimeout(600);
    await page.evaluate(() => {
        document.querySelectorAll("#host .dbx-view-toggle button")[1].click();
    });
    await page.waitForTimeout(1400);
    return page.evaluate(
        (b) => ({
            rows: document.querySelectorAll("#host .tabulator-row").length,
            firstCell: (document.querySelector("#host .tabulator-cell") || {}).textContent,
            selection: window.__selectionState.length,
            extraUpdates: (window.__updateCount || 0) - b
        }),
        before
    );
};
console.log("3 filter on  :", JSON.stringify(await selectThenTable(true)));
console.log("3 filter off :", JSON.stringify(await selectThenTable(false)));

/* ---- 4. pre-data state ------------------------------------------- */
await page.goto("file://" + path.join(__dirname, "harness.html"));
await page.waitForTimeout(400);
await page.evaluate(() => {
    window.__dataView = { metadata: { columns: [] } };
    window.__update();
});
await page.waitForTimeout(500);
console.log(
    "4 pre-data   :",
    JSON.stringify(
        await page.evaluate(() => ({
            spinner: !!document.querySelector("#host .dbx-spinner"),
            words: (document.querySelector("#host .dbx-notice") || {}).textContent.trim().length,
            headings: document.querySelectorAll("#host .dbx-notice h3, #host .dbx-notice ul").length
        }))
    )
);

console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no page errors");
await browser.close();
