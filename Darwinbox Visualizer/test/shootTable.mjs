import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = "file://" + path.join(__dirname, "harness.html");

const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
});
const page = await browser.newPage({ viewport: { width: 780, height: 560 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("console", (m) => {
    if (m.type() === "error") errors.push("CONSOLE: " + m.text());
});

await page.goto(url);
await page.waitForTimeout(700);

const shot = async (name) => {
    await page.waitForTimeout(350);
    await page.locator("#host").screenshot({ path: path.join(__dirname, `../shots/${name}.png`) });
};

// switch to table view
await page.getByRole("button", { name: "Table" }).click();
await page.waitForTimeout(800);

const tableState = async () =>
    page.evaluate(() => ({
        tabulatorPresent: !!document.querySelector("#host .tabulator"),
        searchBar: !!document.querySelector("#host .dbx-searchBar"),
        headers: Array.from(document.querySelectorAll("#host .tabulator-col-title")).map((t) =>
            t.textContent.trim()
        ),
        firstRows: Array.from(document.querySelectorAll("#host .tabulator-row"))
            .slice(0, 3)
            .map((r) =>
                Array.from(r.querySelectorAll(".tabulator-cell"))
                    .map((c) => c.textContent.trim())
                    .filter(Boolean)
            ),
        checkboxes: document.querySelectorAll("#host .tabulator-row-header input[type=checkbox]").length,
        treeControls: document.querySelectorAll("#host .dbx-tree-chevron").length,
        pageButtons: Array.from(document.querySelectorAll("#host .tabulator-page")).map((b) => ({
            page: b.getAttribute("data-page"),
            text: b.textContent.trim(),
            display: getComputedStyle(b).display
        })),
        counter: (document.querySelector("#host .tabulator-page-counter") || {}).textContent,
        rowsPerPage: (document.querySelector("#host .tabulator-page-size .selectText") || {}).textContent,
        pageMore: !!document.querySelector("#host .pageMore"),
        calcsBottom: Array.from(document.querySelectorAll("#host .tabulator-calcs-bottom .tabulator-cell")).map(
            (c) => c.textContent.trim()
        )
    }));

console.log("table:", JSON.stringify(await tableState(), null, 1));
await shot("07-table-tabulator");

// expand the first parent row via its chevron
const chevron = page.locator("#host .dbx-tree-chevron").first();
if (await chevron.count()) {
    await chevron.click();
    await page.waitForTimeout(400);
    console.log(
        "after expand, visible rows:",
        await page.evaluate(() => document.querySelectorAll("#host .tabulator-row").length)
    );
    console.log(
        "child row cells:",
        await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll("#host .tabulator-row"));
            return rows.slice(0, 4).map((r) =>
                Array.from(r.querySelectorAll(".tabulator-cell"))
                    .map((c) => c.textContent.trim())
                    .filter(Boolean)
            );
        })
    );
    await shot("08-table-expanded");
}

// search
await page.fill("#host .dbx-searchInput", "eng");
await page.waitForTimeout(900);
console.log(
    "after search 'eng':",
    await page.evaluate(() => ({
        rows: Array.from(document.querySelectorAll("#host .tabulator-row")).map((r) =>
            (r.querySelector(".tabulator-cell") || {}).textContent
        ),
        counter: (document.querySelector("#host .tabulator-page-counter") || {}).textContent
    }))
);
await shot("09-table-search");

await page.fill("#host .dbx-searchInput", "");
await page.waitForTimeout(900);

// row selection via checkbox
const box = page.locator("#host .tabulator-row .tabulator-row-header input[type=checkbox]").first();
if (await box.count()) {
    await box.click();
    await page.waitForTimeout(400);
    console.log("selection ids after checkbox:", await page.evaluate(() => window.__selectionState.length));
}
await shot("10-table-selected");

// rows-per-page popup
const sizeToggle = page.locator("#host .tabulator-page-size .select").first();
if (await sizeToggle.count()) {
    await sizeToggle.click();
    await page.waitForTimeout(300);
    console.log(
        "page size options visible:",
        await page.evaluate(() => {
            const opt = document.querySelector("#host .option");
            return opt
                ? {
                      display: getComputedStyle(opt).display,
                      values: Array.from(opt.children).map((c) => c.textContent)
                  }
                : null;
        })
    );
    await shot("11-table-pagesize");
    await page.locator("#host .custom-dropdown-option", { hasText: "10" }).first().click();
    await page.waitForTimeout(600);
    console.log(
        "after page size 10:",
        await page.evaluate(() => ({
            rows: document.querySelectorAll("#host .tabulator-row").length,
            counter: (document.querySelector("#host .tabulator-page-counter") || {}).textContent,
            persisted: window.__persisted && JSON.stringify(window.__persisted.merge[0])
        }))
    );
    await shot("12-table-paged");
}

// back to chart to confirm the table teardown does not break the chart
await page.getByRole("button", { name: "Chart" }).click();
await page.waitForTimeout(500);
console.log(
    "chart after table:",
    await page.evaluate(() => document.querySelectorAll("#host .dbx-content svg rect").length)
);
await shot("13-chart-after-table");

if (errors.length) {
    console.log("ERRORS:\n" + errors.join("\n"));
} else {
    console.log("no page errors");
}
await browser.close();
