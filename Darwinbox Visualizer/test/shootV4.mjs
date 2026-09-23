/*
 * v4 guards: the format pane still builds with every new card, Top N really
 * trims, the legend now starts at the top, and Dimension 2 survives a re-render.
 */
import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
});
const page = await browser.newPage({ viewport: { width: 900, height: 620 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("console", (m) => {
    if (m.type() === "error") errors.push("CONSOLE: " + m.text());
});

const boot = async (objects, fixtures) => {
    await page.goto("file://" + path.join(__dirname, "harness.html"));
    await page.waitForTimeout(400);
    await page.evaluate(
        ({ objects, fixtures }) => {
            (fixtures || []).forEach((f) => window[f.fn].apply(null, f.args || []));
            window.__dataView.metadata.objects = objects;
            window.__update();
        },
        { objects, fixtures }
    );
    await page.waitForTimeout(800);
};

/* the whole pane must build - a bad slice or instanceKind would throw here */
await boot({}, []);
const pane = await page.evaluate(() => {
    try {
        const m = window.__visual.getFormattingModel();
        return { cards: m.cards.length, names: m.cards.map((c) => c.displayName || c.uid).slice(0, 40) };
    } catch (e) {
        return { error: String(e) };
    }
});
console.log("format pane:", JSON.stringify(pane));

/* legend default: top, i.e. above the plot, with nothing configured */
console.log(
    "legend default:",
    JSON.stringify(
        await page.evaluate(() => {
            const lg = document.querySelector("#host .dbx-legend");
            const sv = document.querySelector("#host .dbx-content svg");
            return {
                present: !!lg,
                above: !!lg && lg.getBoundingClientRect().top < sv.getBoundingClientRect().top
            };
        })
    )
);

/* Top N trims to N bands, and the typed value wins over the default */
for (const n of [12, 4]) {
    await boot(
        { topN: { show: true, defaultValue: n }, headerLayout: { slot1: "topN", slot2: "dimension1" } },
        []
    );
    const got = await page.evaluate(() => ({
        boxes: document.querySelectorAll("#host .dbx-content svg rect").length,
        n: document.querySelector("#host .dbx-topn").value,
        labels: Array.from(document.querySelectorAll("#host .dbx-content svg text")).filter((t) =>
            /Finance|Support/.test(t.textContent)
        ).length
    }));
    console.log(`top ${n}:`, JSON.stringify(got));
}

/* typing a new N re-renders */
await page.evaluate(() => {
    const box = document.querySelector("#host .dbx-topn");
    box.value = "3";
    box.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.waitForTimeout(700);
console.log(
    "after typing 3:",
    JSON.stringify(
        await page.evaluate(() => ({
            bars: document.querySelectorAll("#host .dbx-content svg rect").length,
            persisted: (window.__persisted && window.__persisted.merge[0].properties.topNValue) || null
        }))
    )
);

/* dimension 2 persists what it picked */
await boot(
    {
        chartSettings: { chartType: "clusteredColumn" },
        dimension2: { show: true },
        headerLayout: { slot1: "dimension1", slot2: "dimension2" }
    },
    []
);
await page.evaluate(() => {
    const dds = document.querySelectorAll("#host .dbx-dd .dbx-dd-box");
    dds[1].click();
});
await page.waitForTimeout(300);
await page.evaluate(() => {
    const radios = document.querySelectorAll('#host .dbx-dd .dbx-dd-popup input[type="radio"]');
    const last = radios[radios.length - 1];
    last.checked = true;
    last.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.waitForTimeout(800);
console.log(
    "dim2 pick:",
    JSON.stringify(
        await page.evaluate(() => ({
            boxes: Array.from(document.querySelectorAll("#host .dbx-dd-text")).map((t) => t.textContent),
            persisted:
                (window.__persisted && window.__persisted.merge[0].properties.selectedDimension2) || null,
            series: Array.from(document.querySelectorAll("#host .dbx-legend span")).map((s) => s.textContent)
        }))
    )
);

console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no page errors");
await browser.close();
