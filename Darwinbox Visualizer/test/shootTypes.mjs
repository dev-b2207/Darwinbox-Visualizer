/*
 * Renders every chart type in the registry from the one visual and asserts the
 * marks each one is supposed to produce. Screenshots land in shots/ so the
 * layouts can be compared against the reference images.
 */
import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
});
const page = await browser.newPage({ viewport: { width: 1000, height: 680 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("console", (m) => {
    if (m.type() === "error") errors.push("CONSOLE: " + m.text());
});

const render = async (objects, size, fixture) => {
    /* each case reloads, so a fixture that rewrites the dataview can't leak
       into the next chart type */
    await page.goto("file://" + path.join(__dirname, "harness.html"));
    await page.waitForTimeout(400);
    await page.evaluate(
        ({ objects, size, fixture }) => {
            if (fixture) {
                window[fixture.fn].apply(null, fixture.args || []);
            }
            const h = document.getElementById("host");
            h.style.width = size[0] + "px";
            h.style.height = size[1] + "px";
            window.__viewport = { width: size[0], height: size[1] };
            window.__dataView.metadata.objects = objects;
            window.__update();
        },
        { objects, size, fixture }
    );
    await page.waitForTimeout(800);
};

const probe = () =>
    page.evaluate(() => {
        const q = (s) => document.querySelectorAll("#host .dbx-content " + s);
        const texts = Array.from(q("svg text")).map((t) => t.textContent);
        return {
            rects: q("svg rect").length,
            paths: q("svg path").length,
            polygons: q("svg polygon").length,
            polylines: q("svg polyline").length,
            texts: texts.length,
            sample: texts.slice(0, 8),
            title: (document.querySelector("#host .dbx-chart-title") || {}).textContent,
            axisTitle: (document.querySelector("#host .dbx-x-title") || {}).textContent,
            hScroll: !!document.querySelector("#host .dbx-hscroll-thumb"),
            vScroll: !!document.querySelector("#host .dbx-vscroll-thumb"),
            legend: Array.from(document.querySelectorAll("#host .dbx-legend span")).map((s) =>
                s.textContent
            )
        };
    });

const base = (type, title) => ({
    chartSettings: { chartType: type },
    controlBar: { showTitle: true, titleText: title },
    dataLabels: { show: true },
    legend: { show: true, position: "top", align: "left" },
    categoryAxis: { fontSize: 9 },
    valueAxis: { fontSize: 9, showTitle: true, titleText: "Employee Count" },
    dataLabelsSegment: { fontSize: 9 }
});

const cases = [
    { key: "stackedColumn", title: "Headcount by Department", size: [860, 420] },
    {
        key: "percentColumn",
        title: "Headcount by Gender and",
        size: [560, 320],
        objects: { valueAxis: { showTitle: true, titleText: "Headcount Share", fontSize: 9 } }
    },
    {
        key: "clusteredColumn",
        title: "Overall Attrition % by",
        size: [860, 470],
        fixture: { fn: "__ratioMeasure" }
    },
    {
        key: "bar",
        title: "Conversion % by Gender",
        size: [860, 420],
        fixture: { fn: "__ratioMeasure" },
        objects: {
            legend: { show: false },
            categoryAxis: { showTitle: true, titleText: "Gender", fontSize: 9 },
            valueAxis: { showTitle: true, titleText: "", fontSize: 9 }
        }
    },
    {
        key: "stackedBar",
        title: "Popular Skills in the Organization",
        size: [860, 440],
        objects: {
            categoryAxis: { showTitle: true, titleText: "Skill Name", fontSize: 9 },
            valueAxis: { showTitle: true, titleText: "Employee Count", fontSize: 9 },
            dataLabelsSegment: { labelPosition: "insideCenter", fontSize: 9 }
        }
    },
    { key: "percentBar", title: "Share by Department", size: [860, 440] },
    {
        key: "line",
        title: "Headcount Trend",
        size: [860, 420],
        objects: { state: { selectedDimension: "Calendar.Date" } }
    },
    {
        key: "combo",
        title: "Leave Count and Leave % Trend",
        size: [980, 420],
        fixture: { fn: "__comboMeasures", args: [1] },
        objects: {
            state: { selectedDimension: "Calendar.Date" },
            /* a ratio must not be summed across the rows it spans */
            dataSettings: { rollup: "avg" },
            secondaryAxis: { show: true, showTitle: true, titleText: "Leave %", fontSize: 9 },
            valueAxis: { showTitle: true, titleText: "Leave Count", fontSize: 9 }
        }
    },
    {
        key: "stackedCombo",
        title: "Ending Headcount and Count of Designation",
        size: [860, 440],
        fixture: { fn: "__comboMeasures", args: [2] },
        objects: { valueAxis: { showTitle: true, titleText: "Ending Headcount", fontSize: 9 } }
    },
    {
        key: "area",
        title: "Headcount Trend",
        size: [860, 420],
        objects: { state: { selectedDimension: "Calendar.Date" } }
    },
    {
        key: "stackedArea",
        title: "Headcount Trend by Employment Type",
        size: [860, 420],
        objects: { state: { selectedDimension: "Calendar.Date" } }
    },
    {
        key: "percentArea",
        title: "Employment Type Mix",
        size: [860, 420],
        objects: {
            state: { selectedDimension: "Calendar.Date" },
            valueAxis: { showTitle: true, titleText: "Share", fontSize: 9 }
        }
    },
    {
        key: "scatter",
        title: "Attrition % against Tenure by Department",
        size: [860, 440],
        fixture: { fn: "__scatterMeasures" },
        objects: {
            legend: { show: false },
            categoryAxis: { showTitle: true, fontSize: 9 },
            valueAxis: { showTitle: true, titleText: "", fontSize: 9 }
        }
    },
    {
        key: "ribbon",
        title: "Diversity Trend",
        size: [980, 420],
        objects: { state: { selectedDimension: "Calendar.Date" } }
    },
    {
        key: "donut",
        title: "Headcount by Gender",
        size: [660, 420],
        objects: { legend: { show: true, position: "right", align: "left" } }
    },
    {
        /* too many rows to fit: the bar plot must scroll vertically */
        key: "stackedBar",
        label: "stackedBar-scroll",
        title: "Headcount by Department",
        size: [700, 360],
        fixture: { fn: "__manyCategories", args: [40] },
        objects: { columnSettings: { widthMode: "fixed", barWidth: 26 } }
    },
    {
        key: "donut",
        label: "donut-centre",
        title: "Gender Composition of New Hires",
        size: [660, 440],
        objects: {
            legend: { show: true, position: "top", align: "left" },
            donutCentre: { showCentreTotal: true, centreFontSize: 16 }
        }
    }
];

let n = 41;
for (const c of cases) {
    const objects = Object.assign(base(c.key, c.title), c.objects || {});
    await render(objects, c.size, c.fixture);
    const out = await probe();
    console.log((c.label || c.key).padEnd(16), JSON.stringify(out));
    await page
        .locator("#host")
        .screenshot({ path: path.join(__dirname, `../shots/${n}-${c.label || c.key}.png`) });
    n++;
}

console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no page errors");
await browser.close();
