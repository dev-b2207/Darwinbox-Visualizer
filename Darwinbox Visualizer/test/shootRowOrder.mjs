/*
 * The chart must be a function of the data, not of the order the rows arrive in.
 * That is what broke when Table rows / Table columns fields were added alongside a
 * Date field: those wells re-shape the query, the row order changes, and any
 * roll-up that picked "first" or "last" followed the order instead of the date.
 */
import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("console", (m) => {
    if (m.type() === "error") errors.push("CONSOLE: " + m.text());
});

const read = async (objects, fixtures) => {
    await page.goto("file://" + path.join(__dirname, "harness.html"));
    await page.waitForTimeout(350);
    await page.evaluate(
        ({ objects, fixtures }) => {
            (fixtures || []).forEach((f) => window[f.fn].apply(null, f.args || []));
            window.__dataView.metadata.objects = objects;
            window.__update();
        },
        { objects, fixtures }
    );
    await page.waitForTimeout(700);
    return page.evaluate(() => {
        const labels = [];
        document.querySelectorAll("#host .dbx-content svg text").forEach((t) => {
            const s = t.textContent.trim();
            if (/^[\d,.\-]+%?$/.test(s)) labels.push(s);
        });
        return labels.join(" ");
    });
};

const base = (rollup) => ({
    chartSettings: { chartType: "stackedColumn" },
    dataSettings: { rollup },
    dataLabels: { show: true, labelPosition: "insideCenter" },
    valueAxis: { show: false },
    legend: { show: false }
});

/* several orderings, because one permutation can leave the last-inserted row
   where it started and hide the defect */
const SEEDS = [3, 7, 11, 19, 23];

for (const rollup of ["last", "first", "sum", "avg", "min", "max"]) {
    const plain = await read(base(rollup), []);
    const runs = [{ how: "detail only", got: await read(base(rollup), [{ fn: "__addDetailFields" }]) }];
    for (const seed of SEEDS) {
        runs.push({
            how: `shuffle ${seed}`,
            got: await read(base(rollup), [{ fn: "__shuffleRows", args: [seed] }])
        });
        runs.push({
            how: `detail + shuffle ${seed}`,
            got: await read(base(rollup), [
                { fn: "__addDetailFields" },
                { fn: "__shuffleRows", args: [seed] }
            ])
        });
    }
    const bad = runs.filter((r) => r.got !== plain);
    console.log(`${rollup.padEnd(5)} ${bad.length ? `CHANGED in ${bad.length}/${runs.length}` : `stable across ${runs.length}`}`);
    bad.slice(0, 2).forEach((b) => console.log(`   ${b.how}\n     want ${plain}\n     got  ${b.got}`));
}

console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no page errors");
await browser.close();
