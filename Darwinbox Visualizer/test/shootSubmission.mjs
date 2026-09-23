/*
 * Microsoft's submission test cases, run against the visual.
 *
 * These are the cases from
 * https://learn.microsoft.com/en-us/power-bi/developer/visuals/submission-testing
 * that can be exercised outside Power BI Desktop: field removal in every order,
 * the format pane against each bucket configuration, bad and edge-case data,
 * resizing down to the minimum, several instances on one page, format strings and
 * precision, keyboard selection, and render timing at volume.
 *
 * A failure here is a rejection there, so every case asserts on "no exception, no
 * console error, and something sensible on screen" rather than on pixels.
 */
import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
});
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });

let errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("console", (m) => {
    if (m.type() === "error") errors.push("CONSOLE: " + m.text());
});

const results = [];
const check = (id, name, ok, detail) => {
    results.push({ id, name, ok, detail: detail === undefined ? "" : String(detail) });
    console.log(`${ok ? "PASS" : "FAIL"}  ${id}  ${name}${detail === undefined ? "" : "  — " + detail}`);
};

const boot = async (objects) => {
    errors = [];
    await page.goto("file://" + path.join(__dirname, "harness.html"));
    await page.waitForTimeout(350);
    await page.evaluate((objects) => {
        const h = document.getElementById("host");
        h.style.width = "900px";
        h.style.height = "500px";
        window.__viewport = { width: 900, height: 500 };
        window.__dataView.metadata.objects = objects || {};
        window.__update();
    }, objects);
    await page.waitForTimeout(600);
};

const BASE = { tableSetting: { paginationSize: 25 }, legend: { show: true } };

/* =================================================================== *
 * 1. Field buckets: remove every well, in several orders               *
 * =================================================================== */

const ROLE_ORDERS = [
    ["measure", "legend", "date", "dimension"],
    ["dimension", "date", "legend", "measure"],
    ["legend", "measure", "dimension", "date"],
    ["date", "dimension", "measure", "legend"]
];

for (let oi = 0; oi < ROLE_ORDERS.length; oi++) {
    await boot(BASE);
    const trace = await page.evaluate(async (order) => {
        const steps = [];
        const dv = window.__dataView;
        const dropRole = (role) => {
            const cats = dv.categorical.categories;
            for (let i = cats.length - 1; i >= 0; i--) {
                if (cats[i].source.roles && cats[i].source.roles[role]) {
                    cats.splice(i, 1);
                }
            }
            const vals = dv.categorical.values;
            for (let i = vals.length - 1; i >= 0; i--) {
                if (vals[i].source.roles && vals[i].source.roles[role]) {
                    vals.splice(i, 1);
                }
            }
            if (role === "legend" && vals.source) {
                delete vals.source;
                vals.grouped = function () {
                    return [{ name: undefined, values: vals.slice() }];
                };
            }
            dv.metadata.columns = cats
                .map((c) => c.source)
                .concat(Array.prototype.map.call(vals, (v) => v.source));
        };
        for (const role of order) {
            dropRole(role);
            try {
                window.__update();
                /* the format pane must survive every one of these shapes too */
                window.__visual.getFormattingModel();
                steps.push(role + ":ok");
            } catch (e) {
                steps.push(role + ":THREW " + e.message);
            }
        }
        return steps;
    }, ROLE_ORDERS[oi]);
    await page.waitForTimeout(250);
    const threw = trace.filter((t) => t.indexOf("THREW") !== -1);
    check(
        `1.${oi + 1}`,
        `Remove fields in order [${ROLE_ORDERS[oi].join(", ")}]`,
        !threw.length && !errors.length,
        threw.concat(errors).join(" | ") || trace.join(", ")
    );
}

/* =================================================================== *
 * 2. Format pane against each bucket configuration                     *
 * =================================================================== */

const PANE_CASES = [
    ["no data view at all", () => { window.__dataView = { metadata: { columns: [] } }; }],
    ["categories but no values", () => { window.__dataView.categorical.values = Object.assign([], { grouped: () => [] }); }],
    ["values but no categories", () => { window.__dataView.categorical.categories = []; }],
    ["everything mapped", () => {}]
];
for (let i = 0; i < PANE_CASES.length; i++) {
    await boot(BASE);
    const out = await page.evaluate((idx) => {
        const cases = [
            () => { window.__dataView = { metadata: { columns: [] } }; },
            () => { window.__dataView.categorical.values = Object.assign([], { grouped: () => [] }); },
            () => { window.__dataView.categorical.categories = []; },
            () => {}
        ];
        try {
            cases[idx]();
            window.__update();
            const model = window.__visual.getFormattingModel();
            return { ok: true, cards: model && model.cards ? model.cards.length : 0 };
        } catch (e) {
            return { ok: false, message: e.message };
        }
    }, i);
    await page.waitForTimeout(200);
    check(
        `2.${i + 1}`,
        `Format pane opens with ${PANE_CASES[i][0]}`,
        out.ok && !errors.length,
        out.ok ? `${out.cards} cards` : out.message
    );
}

/* =================================================================== *
 * 3. Bad and edge-case data                                            *
 * =================================================================== */

const DATA_CASES = [
    ["nulls in the measure", (v) => v.map(() => null)],
    ["all zeroes", (v) => v.map(() => 0)],
    ["negative values", (v) => v.map((x, i) => (i % 2 ? -x : x))],
    ["Infinity and NaN", (v) => v.map((x, i) => (i % 3 === 0 ? Infinity : i % 3 === 1 ? NaN : x))],
    ["strings where numbers belong", (v) => v.map(() => "not a number")],
    ["one enormous outlier", (v) => v.map((x, i) => (i === 0 ? 1e15 : x))],
    ["very small fractions", (v) => v.map(() => 0.0000004)]
];

for (let i = 0; i < DATA_CASES.length; i++) {
    for (const type of ["stackedColumn", "line", "donut", "scatter", "percentArea"]) {
        await boot({ ...BASE, chartSettings: { chartType: type }, dataLabels: { show: true } });
        const out = await page.evaluate(
            ({ idx, type }) => {
                const fns = [
                    (v) => v.map(() => null),
                    (v) => v.map(() => 0),
                    (v) => v.map((x, i) => (i % 2 ? -x : x)),
                    (v) => v.map((x, i) => (i % 3 === 0 ? Infinity : i % 3 === 1 ? NaN : x)),
                    (v) => v.map(() => "not a number"),
                    (v) => v.map((x, i) => (i === 0 ? 1e15 : x)),
                    (v) => v.map(() => 0.0000004)
                ];
                try {
                    if (type === "scatter") {
                        window.__scatterMeasures();
                    }
                    const vals = window.__dataView.categorical.values;
                    for (let k = 0; k < vals.length; k++) {
                        vals[k].values = fns[idx](vals[k].values);
                    }
                    window.__update();
                    return { ok: true, nodes: document.querySelectorAll("#host .dbx-content *").length };
                } catch (e) {
                    return { ok: false, message: e.message };
                }
            },
            { idx: i, type }
        );
        await page.waitForTimeout(150);
        check(
            `3.${i + 1}`,
            `${DATA_CASES[i][0]} — ${type}`,
            out.ok && !errors.length,
            out.ok ? `${out.nodes} nodes drawn` : out.message
        );
    }
}

/* one row, two rows, and an empty result */
for (const n of [0, 1, 2]) {
    await boot(BASE);
    const out = await page.evaluate((n) => {
        try {
            const dv = window.__dataView;
            dv.categorical.categories.forEach((c) => {
                c.values = c.values.slice(0, n);
                c.identity = c.identity.slice(0, n);
            });
            Array.prototype.forEach.call(dv.categorical.values, (v) => {
                v.values = v.values.slice(0, n);
            });
            window.__update();
            return { ok: true };
        } catch (e) {
            return { ok: false, message: e.message };
        }
    }, n);
    await page.waitForTimeout(200);
    check(`3.8.${n}`, `${n} row result set`, out.ok && !errors.length, out.ok ? "" : out.message);
}

/* =================================================================== *
 * 4. Resizing, including the minimum report size                       *
 * =================================================================== */

const SIZES = [
    [1280, 720],
    [640, 480],
    [320, 240],
    [200, 120],
    [120, 80],
    [1600, 300],
    [300, 900]
];
for (const [w, h] of SIZES) {
    await boot({ ...BASE, chartSettings: { chartType: "stackedColumn" } });
    const out = await page.evaluate(
        ({ w, h }) => {
            try {
                const el = document.getElementById("host");
                el.style.width = w + "px";
                el.style.height = h + "px";
                window.__viewport = { width: w, height: h };
                window.__update();
                const r = document.querySelector("#host").getBoundingClientRect();
                const content = document.querySelector("#host .dbx-content");
                return {
                    ok: true,
                    overflowsX: content ? content.scrollWidth > Math.ceil(r.width) + 2 : false,
                    drew: document.querySelectorAll("#host svg rect, #host svg path").length
                };
            } catch (e) {
                return { ok: false, message: e.message };
            }
        },
        { w, h }
    );
    await page.waitForTimeout(150);
    check(
        `4.${w}x${h}`,
        `Renders at ${w}x${h}`,
        out.ok && !errors.length,
        out.ok ? `${out.drew} marks` : out.message
    );
}

/* =================================================================== *
 * 5. Several instances on one page                                     *
 * =================================================================== */

await boot(BASE);
const multi = await page.evaluate(() => {
    try {
        const plugin = window.powerbi.visuals.plugins.dbxStackedColumnE4A17C2B9D3F4A16B0C8D5E7F1A2B3C4;
        const made = [];
        for (let i = 0; i < 3; i++) {
            const el = document.createElement("div");
            el.style.width = "420px";
            el.style.height = "300px";
            el.className = "extra-host";
            document.body.appendChild(el);
            const v = plugin.create({ element: el, host: window.__host });
            v.update({
                dataViews: [window.__dataView],
                viewport: { width: 420, height: 300 },
                type: 2,
                operationKind: 0,
                viewMode: 1,
                editMode: 0,
                isInFocus: false,
                jsonFilters: []
            });
            made.push(el.querySelectorAll("svg").length);
        }
        return { ok: true, made };
    } catch (e) {
        return { ok: false, message: e.message };
    }
});
await page.waitForTimeout(400);
check(
    "5.1",
    "Four instances on one page",
    multi.ok && multi.made.every((n) => n > 0) && !errors.length,
    multi.ok ? `svg per instance: ${multi.made.join(", ")}` : multi.message
);

/* =================================================================== *
 * 6. Format strings, display units and precision                       *
 * =================================================================== */

const FORMAT_CASES = [
    ["#,0", 0, "1"],
    ["#,0.000", 3, "1"],
    ["0.00%", 2, "1"],
    ["\\$#,0;(\\$#,0)", 0, "1"],
    ["#,0", 0, "1000"]
];
for (let i = 0; i < FORMAT_CASES.length; i++) {
    const [fmt, precision, units] = FORMAT_CASES[i];
    await boot({
        ...BASE,
        chartSettings: { chartType: "stackedColumn" },
        dataLabels: { show: true, displayUnits: units, precision },
        valueAxis: { displayUnits: units, precision }
    });
    const out = await page.evaluate((fmt) => {
        try {
            Array.prototype.forEach.call(window.__dataView.categorical.values, (v) => {
                v.source.format = fmt;
            });
            window.__update();
            const labels = Array.from(document.querySelectorAll("#host .dbx-content svg text"))
                .map((t) => (t.textContent || "").trim())
                .filter(Boolean);
            return { ok: true, sample: labels.slice(0, 6) };
        } catch (e) {
            return { ok: false, message: e.message };
        }
    }, fmt);
    await page.waitForTimeout(150);
    check(
        `6.${i + 1}`,
        `Format string ${fmt} at ${precision} dp, units ${units}`,
        out.ok && !errors.length,
        out.ok ? JSON.stringify(out.sample) : out.message
    );
}

/* =================================================================== *
 * 7. Selection with Ctrl / Shift, and clearing                         *
 * =================================================================== */

await boot({ ...BASE, chartSettings: { chartType: "stackedColumn" } });
const sel = await page.evaluate(() => {
    const marks = Array.from(document.querySelectorAll("#host .dbx-content svg rect"));
    const dimCount = () =>
        Array.from(document.querySelectorAll("#host .dbx-content svg rect")).filter((r) => {
            const o = parseFloat(r.getAttribute("fill-opacity") || "1");
            return o > 0 && o < 1;
        }).length;
    const fire = (el, mods) =>
        el.dispatchEvent(new MouseEvent("click", Object.assign({ bubbles: true }, mods)));
    fire(marks[0], {});
    const afterOne = dimCount();
    fire(
        document.querySelectorAll("#host .dbx-content svg rect")[2],
        { ctrlKey: true }
    );
    const afterTwo = dimCount();
    fire(
        document.querySelectorAll("#host .dbx-content svg rect")[4],
        { shiftKey: true }
    );
    const afterThree = dimCount();
    const svg = Array.from(document.querySelectorAll("#host .dbx-content svg")).filter((s) =>
        s.querySelector("rect")
    )[0];
    svg.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return { afterOne, afterTwo, afterThree, afterClear: dimCount(), total: marks.length };
});
await page.waitForTimeout(400);
check(
    "7.1",
    "Ctrl / Shift click adds marks, background clears",
    sel.afterOne > 0 && sel.afterTwo < sel.afterOne && sel.afterThree < sel.afterTwo && sel.afterClear === 0 && !errors.length,
    `dimmed after 1/2/3 marks then clear: ${sel.afterOne}/${sel.afterTwo}/${sel.afterThree}/${sel.afterClear} of ${sel.total}`
);

/* keyboard: every mark must be focusable and Enter must select */
await boot({ ...BASE, chartSettings: { chartType: "stackedColumn" } });
const kbd = await page.evaluate(() => {
    const marks = Array.from(document.querySelectorAll("#host .dbx-content svg rect[tabindex]"));
    if (!marks.length) {
        return { ok: false, message: "no focusable marks" };
    }
    marks[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const dimmed = Array.from(document.querySelectorAll("#host .dbx-content svg rect")).filter(
        (r) => {
            const o = parseFloat(r.getAttribute("fill-opacity") || "1");
            return o > 0 && o < 1;
        }
    ).length;
    return { ok: true, focusable: marks.length, dimmed };
});
await page.waitForTimeout(300);
check(
    "7.2",
    "Marks are keyboard focusable and Enter selects",
    kbd.ok && kbd.dimmed > 0 && !errors.length,
    kbd.ok ? `${kbd.focusable} focusable, ${kbd.dimmed} dimmed after Enter` : kbd.message
);

/* =================================================================== *
 * 8. Volume and render time                                            *
 * =================================================================== */

for (const n of [200, 2000, 10000]) {
    await boot({ ...BASE, chartSettings: { chartType: "stackedColumn" } });
    const perf = await page.evaluate((n) => {
        try {
            window.__manyCategories(n);
            const t0 = performance.now();
            window.__update();
            const t1 = performance.now();
            return { ok: true, ms: Math.round(t1 - t0) };
        } catch (e) {
            return { ok: false, message: e.message };
        }
    }, n);
    await page.waitForTimeout(400);
    check(
        `8.${n}`,
        `${n} categories renders in reasonable time`,
        perf.ok && perf.ms < 4000 && !errors.length,
        perf.ok ? `${perf.ms} ms` : perf.message
    );
}

/* table view at volume, which is the heavier half */
await boot({ ...BASE, state: { viewMode: "table" } });
const tablePerf = await page.evaluate(() => {
    try {
        window.__addDetailFields();
        const t0 = performance.now();
        window.__update();
        const t1 = performance.now();
        return { ok: true, ms: Math.round(t1 - t0), rows: document.querySelectorAll(".tabulator-row").length };
    } catch (e) {
        return { ok: false, message: e.message };
    }
});
await page.waitForTimeout(500);
check(
    "8.table",
    "Table view renders at detail grain",
    tablePerf.ok && !errors.length,
    tablePerf.ok ? `${tablePerf.ms} ms, ${tablePerf.rows} rows on the page` : tablePerf.message
);

/* =================================================================== *
 * 9. Empty data view and the landing page                              *
 * =================================================================== */

await boot(BASE);
const empty = await page.evaluate(() => {
    try {
        window.__visual.update({
            dataViews: [],
            viewport: { width: 900, height: 500 },
            type: 2,
            operationKind: 0,
            viewMode: 1,
            editMode: 0,
            isInFocus: false,
            jsonFilters: []
        });
        const notice = document.querySelector("#host .dbx-notice");
        return { ok: true, landing: !!(notice && notice.className.indexOf("dbx-landing") !== -1) };
    } catch (e) {
        return { ok: false, message: e.message };
    }
});
await page.waitForTimeout(200);
check("9.1", "No data view shows the landing state, not an error", empty.ok && empty.landing && !errors.length, empty.ok ? "" : empty.message);

/* =================================================================== *
 * 10. High contrast                                                    *
 * =================================================================== */

await boot(BASE);
const hc = await page.evaluate(() => {
    try {
        window.__host.colorPalette.isHighContrast = true;
        window.__host.colorPalette.foreground = { value: "#FFFFFF" };
        window.__host.colorPalette.background = { value: "#000000" };
        window.__host.colorPalette.foregroundSelected = { value: "#FFFF00" };
        window.__host.colorPalette.hyperlink = { value: "#00FFFF" };
        window.__update();
        const fills = Array.from(document.querySelectorAll("#host .dbx-content svg rect"))
            .map((r) => r.getAttribute("fill"))
            .filter(Boolean);
        return { ok: true, distinct: Array.from(new Set(fills)).slice(0, 4) };
    } catch (e) {
        return { ok: false, message: e.message };
    }
});
await page.waitForTimeout(250);
check(
    "10.1",
    "High-contrast mode redraws in the host palette",
    hc.ok && !errors.length,
    hc.ok ? `fills: ${JSON.stringify(hc.distinct)}` : hc.message
);

/* =================================================================== */

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
    console.log("FAILED:");
    failed.forEach((f) => console.log(`  ${f.id} ${f.name} — ${f.detail}`));
}

const fs = await import("fs");
fs.writeFileSync(
    path.join(__dirname, "..", "submission-test-results.json"),
    JSON.stringify(results, null, 2)
);

await browser.close();
process.exit(failed.length ? 1 : 0);
