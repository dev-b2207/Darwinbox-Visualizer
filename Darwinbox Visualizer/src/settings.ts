/*
 *  Formatting-pane model for the Darwinbox interactive stacked column visual.
 *  Every visible control on the visual (dimension dropdown, granularity switch,
 *  chart/table toggle) has its own card so it can be restyled independently.
 */
import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import Card = formattingSettings.SimpleCard;
import CompositeCard = formattingSettings.CompositeCard;
import Group = formattingSettings.Group;
import Model = formattingSettings.Model;

/*
 * House defaults: Arial at 14. Every font control in the pane starts here, so a
 * report author does not have to restyle each element to match the Darwinbox
 * dashboards. Size is in points, the same unit the native visuals use.
 */
const DEFAULT_FONT = "Arial";
const DEFAULT_FONT_SIZE = 14;
/* axis values and axis titles are smaller and black, as in the reference charts */
const AXIS_FONT_SIZE = 10;
/* table view defaults, taken from the tableDarwinbox config in use today */
const TABLE_HEADER_FONT_SIZE = 12;
const TABLE_ROW_FONT_SIZE = 10;

/** default colour for a measure dropped into the Line values well (combo charts) */
export const COMBO_LINE_COLOR = "#FFC000";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

export function colorOf(picker: formattingSettings.ColorPicker): string {
    return picker && picker.value ? (picker.value as powerbi.ThemeColorData).value : undefined;
}

export function enumOf(dd: formattingSettings.ItemDropdown): string {
    return dd && dd.value ? String((dd.value as powerbi.IEnumMember).value) : undefined;
}

function member(value: string, displayName: string): powerbi.IEnumMember {
    return { value, displayName };
}

function makeFont(
    prefix: string,
    size: number = DEFAULT_FONT_SIZE,
    bold = false,
    italic = false
): formattingSettings.FontControl {
    /* most cards take the house size; the axes and the table pass their own */
    size = size || DEFAULT_FONT_SIZE;
    const p = prefix ? prefix : "";
    const cap = (s: string) => (p ? p + s.charAt(0).toUpperCase() + s.slice(1) : s);
    return new formattingSettings.FontControl({
        name: cap("font"),
        displayName: "Font",
        fontFamily: new formattingSettings.FontPicker({
            name: cap("fontFamily"),
            value: DEFAULT_FONT
        }),
        fontSize: new formattingSettings.NumUpDown({
            name: cap("fontSize"),
            displayName: "Text size",
            value: size,
            options: {
                minValue: { type: powerbi.visuals.ValidatorType.Min, value: 6 },
                maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 60 }
            }
        }),
        bold: new formattingSettings.ToggleSwitch({ name: cap("bold"), value: bold }),
        italic: new formattingSettings.ToggleSwitch({ name: cap("italic"), value: italic }),
        underline: new formattingSettings.ToggleSwitch({ name: cap("underline"), value: false })
    });
}

function pickColor(name: string, displayName: string, value: string): formattingSettings.ColorPicker {
    return new formattingSettings.ColorPicker({ name, displayName, value: { value } });
}

function toggle(name: string, displayName: string, value: boolean): formattingSettings.ToggleSwitch {
    return new formattingSettings.ToggleSwitch({ name, displayName, value });
}

function num(
    name: string,
    displayName: string,
    value: number,
    min = 0,
    max = 100
): formattingSettings.NumUpDown {
    return new formattingSettings.NumUpDown({
        name,
        displayName,
        value,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: min },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: max }
        }
    });
}

function text(name: string, displayName: string, value: string): formattingSettings.TextInput {
    return new formattingSettings.TextInput({ name, displayName, value, placeholder: "" });
}

function dropdown(
    name: string,
    displayName: string,
    items: powerbi.IEnumMember[],
    value: string
): formattingSettings.ItemDropdown {
    return new formattingSettings.ItemDropdown({
        name,
        displayName,
        items,
        value: items.filter((i) => i.value === value)[0] || items[0]
    });
}

const DISPLAY_UNIT_ITEMS = [
    member("0", "Auto"),
    member("1", "None"),
    member("1000", "Thousands"),
    member("1000000", "Millions"),
    member("1000000000", "Billions")
];

const GRIDLINE_STYLE_ITEMS = [
    member("solid", "Solid"),
    member("dashed", "Dashed"),
    member("dotted", "Dotted")
];

/* ------------------------------------------------------------------ */
/* chart type                                                          */
/* ------------------------------------------------------------------ */

export class ChartSettingsCard extends Card {
    name = "chartSettings";
    displayName = "Chart";
    description = "Which chart type this instance draws. The table view is the same either way.";

    chartType = dropdown(
        "chartType",
        "Chart type",
        [
            member("stackedColumn", "Stacked column"),
            member("percentColumn", "100% stacked column"),
            member("clusteredColumn", "Clustered column"),
            member("bar", "Bar"),
            member("stackedBar", "Stacked bar"),
            member("percentBar", "100% stacked bar"),
            member("line", "Line"),
            member("area", "Area"),
            member("stackedArea", "Stacked area"),
            member("percentArea", "100% stacked area"),
            member("scatter", "Scatter"),
            member("combo", "Line and clustered column"),
            member("stackedCombo", "Line and stacked column"),
            member("ribbon", "Ribbon"),
            member("donut", "Donut")
        ],
        "stackedColumn"
    );

    slices = [this.chartType];
}

/* ------------------------------------------------------------------ */
/* hidden persisted state                                              */
/* ------------------------------------------------------------------ */

export class StateCard extends Card {
    name = "state";
    displayName = "State";
    visible = false;

    selectedDimension = text("selectedDimension", "Dimension", "");
    selectedDimension2 = text("selectedDimension2", "Dimension 2", "");
    granularity = text("granularity", "Granularity", "");
    viewMode = text("viewMode", "View", "");
    selectedMeasure = text("selectedMeasure", "Measure", "");
    topNValue = text("topNValue", "Top N", "");

    slices = [
        this.selectedDimension,
        this.selectedDimension2,
        this.granularity,
        this.viewMode,
        this.selectedMeasure,
        this.topNValue
    ];
}

/* ------------------------------------------------------------------ */
/* header control bar                                                  */
/* ------------------------------------------------------------------ */

export class ControlBarCard extends Card {
    name = "controlBar";
    displayName = "Header controls";
    description = "The strip that holds the dimension dropdown, the time switch and the view toggle.";

    show = toggle("show", "Show", true);
    topLevelSlice = this.show;

    /* heading shown at the top-left of the header row, e.g. "Headcount Trend" */
    showTitle = toggle("showTitle", "Show title", true);
    titleText = text("titleText", "Title", "");
    titleFont = makeFont("title");
    titleFontColor = pickColor("titleFontColor", "Title colour", "#252423");

    position = dropdown("position", "Position", [member("top", "Top"), member("bottom", "Bottom")], "top");
    align = dropdown(
        "align",
        "Alignment",
        [
            member("left", "Left"),
            member("center", "Center"),
            member("right", "Right"),
            member("spread", "Space between")
        ],
        "spread"
    );
    gap = num("gap", "Space between controls", 8, 0, 60);
    paddingX = num("paddingX", "Horizontal padding", 4, 0, 60);
    paddingY = num("paddingY", "Vertical padding", 4, 0, 60);
    background = pickColor("background", "Background", "transparent");
    borderColor = pickColor("borderColor", "Border colour", "#E1E1E1");
    borderWidth = num("borderWidth", "Border width", 0, 0, 10);

    slices = [
        this.showTitle,
        this.titleText,
        this.titleFont,
        this.titleFontColor,
        this.position,
        this.align,
        this.gap,
        this.paddingX,
        this.paddingY,
        this.background,
        this.borderColor,
        this.borderWidth
    ];
}

/* ------------------------------------------------------------------ */
/* header layout: the order of the Top N / dimension controls and the   */
/* free text around them                                               */
/* ------------------------------------------------------------------ */

const SLOT_ITEMS = [
    member("none", "(nothing)"),
    member("topN", "Top N box"),
    member("dimension1", "Dimension 1"),
    member("dimension2", "Dimension 2")
];

export class HeaderLayoutCard extends Card {
    name = "headerLayout";
    displayName = "Header layout";
    description =
        'Builds the sentence in the header: text, control, text, control, text. "Top [10] [Department] by attrition %" and "Attrition % variation by [Gender] across [Department]" are the same three slots in a different order.';

    slot1 = dropdown("slot1", "First control", SLOT_ITEMS, "dimension1");
    slot2 = dropdown("slot2", "Second control", SLOT_ITEMS, "none");
    slot3 = dropdown("slot3", "Third control", SLOT_ITEMS, "none");

    textBefore = text("textBefore", "Text before the first", "");
    textBetween1 = text("textBetween1", "Text after the first", "");
    textBetween2 = text("textBetween2", "Text after the second", "");
    textAfter = text("textAfter", "Text after the last", "");

    font = makeFont("");
    fontColor = pickColor("fontColor", "Text colour", "#252423");
    gap = num("gap", "Space around the text", 6, 0, 40);

    slices = [
        this.slot1,
        this.slot2,
        this.slot3,
        this.textBefore,
        this.textBetween1,
        this.textBetween2,
        this.textAfter,
        this.font,
        this.fontColor,
        this.gap
    ];
}

/* ------------------------------------------------------------------ */
/* Top N                                                               */
/* ------------------------------------------------------------------ */

export class TopNCard extends Card {
    name = "topN";
    displayName = "Top N";
    description =
        "An editable number in the header that keeps only the leading N categories. Which end counts as the top follows Data handling -> Sort by and Direction.";

    show = toggle("show", "Show", false);
    topLevelSlice = this.show;

    /* the starting value; the header box then owns it and persists what the user types */
    defaultValue = num("defaultValue", "Default N", 10, 1, 10000);
    mode = dropdown(
        "mode",
        "Keep",
        [member("top", "Top N (first)"), member("bottom", "Bottom N (last)")],
        "top"
    );
    applyToTable = toggle("applyToTable", "Apply in table view too", true);
    showInTableView = toggle("showInTableView", "Show the box in table view", false);

    boxWidth = num("boxWidth", "Box width", 60, 30, 300);
    font = makeFont("");
    fontColor = pickColor("fontColor", "Text colour", "#252423");
    background = pickColor("background", "Background", "#FFFFFF");
    borderColor = pickColor("borderColor", "Border colour", "#C8C6C4");
    borderWidth = num("borderWidth", "Border width", 1, 0, 8);
    cornerRadius = num("cornerRadius", "Corner radius", 2, 0, 30);
    height = num("height", "Height", 28, 16, 80);

    slices = [
        this.defaultValue,
        this.mode,
        this.applyToTable,
        this.showInTableView,
        this.boxWidth,
        this.font,
        this.fontColor,
        this.background,
        this.borderColor,
        this.borderWidth,
        this.cornerRadius,
        this.height
    ];
}

/* ------------------------------------------------------------------ */
/* second dimension (the series split)                                 */
/* ------------------------------------------------------------------ */

export class Dimension2Card extends Card {
    name = "dimension2";
    displayName = "Dimension 2 (series)";
    description =
        "A second dropdown that chooses which field splits the chart into series - the runtime equivalent of the Legend well. It offers the fields in the Dimensions 2 well, or the Dimensions bucket when that well is empty. Styled by the Dimension selector card so the two dropdowns match.";

    show = toggle("show", "Show", false);
    topLevelSlice = this.show;

    allowNone = toggle("allowNone", "Offer a (None) option", true);
    noneLabel = text("noneLabel", '"None" label', "(None)");
    showInTableView = toggle("showInTableView", "Show in table view", false);

    slices = [this.allowNone, this.noneLabel, this.showInTableView];
}

/* ------------------------------------------------------------------ */
/* dimension selector                                                  */
/* ------------------------------------------------------------------ */

export class DimensionSelectorCard extends Card {
    name = "dimensionSelector";
    displayName = "Dimension selector";
    description = "Replaces the field-parameter slicer. Lists every field in the Dimensions bucket.";

    show = toggle("show", "Show", true);
    topLevelSlice = this.show;

    controlStyle = dropdown(
        "controlStyle",
        "Style",
        [member("dropdown", "Dropdown"), member("pills", "Pills")],
        "dropdown"
    );
    showInTableView = toggle("showInTableView", "Show in table view", false);
    showLabel = toggle("showLabel", "Show prefix label", true);
    labelText = text("labelText", "Prefix label", "Headcount by");
    font = makeFont("");
    fontColor = pickColor("fontColor", "Text colour", "#252423");
    background = pickColor("background", "Background", "#FFFFFF");
    selectedFontColor = pickColor("selectedFontColor", "Selected text colour", "#FFFFFF");
    selectedBackground = pickColor("selectedBackground", "Selected background", "#0B6BCB");
    borderColor = pickColor("borderColor", "Border colour", "#C8C6C4");
    borderWidth = num("borderWidth", "Border width", 1, 0, 8);
    cornerRadius = num("cornerRadius", "Corner radius", 2, 0, 30);
    minWidth = num("minWidth", "Minimum width", 150, 40, 600);
    height = num("height", "Height", 28, 16, 80);
    accentColor = pickColor("accentColor", "Selected option colour", "#0B6BCB");
    popupBackground = pickColor("popupBackground", "List background", "#FFFFFF");
    popupHoverBackground = pickColor("popupHoverBackground", "List hover colour", "#F3F2F1");
    popupMaxHeight = num("popupMaxHeight", "List max height", 220, 60, 900);

    slices = [
        this.controlStyle,
        this.showInTableView,
        this.showLabel,
        this.labelText,
        this.font,
        this.fontColor,
        this.background,
        this.selectedFontColor,
        this.selectedBackground,
        this.borderColor,
        this.borderWidth,
        this.cornerRadius,
        this.minWidth,
        this.height,
        this.accentColor,
        this.popupBackground,
        this.popupHoverBackground,
        this.popupMaxHeight
    ];
}

/* ------------------------------------------------------------------ */
/* granularity switch                                                  */
/* ------------------------------------------------------------------ */

export class GranularityCard extends CompositeCard {
    name = "granularitySwitch";
    displayName = "Time granularity switch";
    description = "Monthly / Quarterly / Annual. Replaces the bookmark-driven tab strip.";

    show = toggle("show", "Show", true);
    topLevelSlice = this.show;

    // -- options group
    showInTableView = toggle("showInTableView", "Show in table view", false);
    showMonthly = toggle("showMonthly", "Show Monthly", true);
    showQuarterly = toggle("showQuarterly", "Show Quarterly", true);
    showAnnual = toggle("showAnnual", "Show Annual", true);
    monthlyText = text("monthlyText", "Monthly label", "Monthly");
    quarterlyText = text("quarterlyText", "Quarterly label", "Quarterly");
    annualText = text("annualText", "Annual label", "Annual");

    optionsGroup: Group = new Group({
        name: "granularityOptions",
        displayName: "Options",
        slices: [
            this.showInTableView,
            this.showAnnual,
            this.showQuarterly,
            this.showMonthly,
            this.annualText,
            this.quarterlyText,
            this.monthlyText
        ]
    });

    // -- style group
    placement = dropdown(
        "placement",
        "Position",
        [
            member("ownRow", "Its own row below"),
            member("headerRow", "Same row as the dimension selector")
        ],
        "ownRow"
    );
    align = dropdown(
        "align",
        "Alignment",
        [member("left", "Left"), member("center", "Center"), member("right", "Right")],
        "left"
    );
    marginTop = num("marginTop", "Space above", 6, 0, 60);
    controlStyle = dropdown(
        "controlStyle",
        "Style",
        [member("segmented", "Segmented"), member("pills", "Pills"), member("dropdown", "Dropdown")],
        "segmented"
    );
    font = makeFont("");
    fontColor = pickColor("fontColor", "Text colour", "#252423");
    background = pickColor("background", "Background", "#F3F2F1");
    selectedFontColor = pickColor("selectedFontColor", "Selected text colour", "#FFFFFF");
    selectedBackground = pickColor("selectedBackground", "Selected background", "#252423");
    borderColor = pickColor("borderColor", "Border colour", "#C8C6C4");
    borderWidth = num("borderWidth", "Border width", 1, 0, 8);
    cornerRadius = num("cornerRadius", "Corner radius", 2, 0, 30);
    height = num("height", "Height", 26, 16, 80);
    itemPaddingX = num("itemPaddingX", "Item padding", 14, 0, 60);
    itemMinWidth = num("itemMinWidth", "Minimum item width", 0, 0, 400);

    styleGroup: Group = new Group({
        name: "granularityStyle",
        displayName: "Style",
        slices: [
            this.placement,
            this.align,
            this.marginTop,
            this.controlStyle,
            this.font,
            this.fontColor,
            this.background,
            this.selectedFontColor,
            this.selectedBackground,
            this.borderColor,
            this.borderWidth,
            this.cornerRadius,
            this.height,
            this.itemPaddingX,
            this.itemMinWidth
        ]
    });

    groups = [this.optionsGroup, this.styleGroup];
}

/* ------------------------------------------------------------------ */
/* insight banner                                                      */
/* ------------------------------------------------------------------ */

export class InsightCard extends Card {
    name = "insight";
    displayName = "Insight banner";
    description =
        "The gradient strip under the header. Its text comes from the Insight text measure well so it re-reads with the data; the static text below is the fallback when no measure is mapped.";

    show = toggle("show", "Show", false);
    topLevelSlice = this.show;

    /*
     * Marked ConstantOrRule so the pane offers the fx (conditional formatting)
     * button on this property as well. Whichever route the report author takes -
     * the fx dialog or the Insight text well - the resolved string lands here or
     * in the measure, and the banner renders the first one it finds.
     */
    insightText = new formattingSettings.TextInput({
        name: "insightText",
        displayName: "Text",
        value: "",
        placeholder: "Bind a measure, or type a fixed sentence",
        instanceKind: powerbi.VisualEnumerationInstanceKinds.ConstantOrRule
    });

    showIcon = toggle("showIcon", "Show icon", true);
    iconColor = pickColor("iconColor", "Icon colour", "#8B5CF6");
    iconSize = num("iconSize", "Icon size", 22, 10, 60);

    gradientStart = pickColor("gradientStart", "Gradient start", "#D7EAFB");
    gradientEnd = pickColor("gradientEnd", "Gradient end", "#EADFF8");
    font = makeFont("", 12, true);
    fontColor = pickColor("fontColor", "Text colour", "#1B3A93");
    cornerRadius = num("cornerRadius", "Corner radius", 4, 0, 30);
    paddingX = num("paddingX", "Horizontal padding", 14, 0, 60);
    paddingY = num("paddingY", "Vertical padding", 8, 0, 40);
    marginTop = num("marginTop", "Space above", 6, 0, 60);
    withViewToggle = toggle("withViewToggle", "Keep the view toggle on this row", true);
    showInTableView = toggle("showInTableView", "Show in table view", true);

    slices = [
        this.insightText,
        this.showIcon,
        this.iconColor,
        this.iconSize,
        this.gradientStart,
        this.gradientEnd,
        this.font,
        this.fontColor,
        this.cornerRadius,
        this.paddingX,
        this.paddingY,
        this.marginTop,
        this.withViewToggle,
        this.showInTableView
    ];
}

/* ------------------------------------------------------------------ */
/* chart <-> table toggle                                              */
/* ------------------------------------------------------------------ */

export class ViewToggleCard extends Card {
    name = "viewToggle";
    displayName = "Chart / table toggle";
    description = "Switches the same visual between column chart and table. Replaces the bookmark pair.";

    show = toggle("show", "Show", true);
    topLevelSlice = this.show;

    controlStyle = dropdown(
        "controlStyle",
        "Style",
        [member("icon", "Icons"), member("text", "Text")],
        "icon"
    );
    chartText = text("chartText", "Chart label", "Chart");
    tableText = text("tableText", "Table label", "Table");
    font = makeFont("");
    iconColor = pickColor("iconColor", "Icon / text colour", "#323130");
    background = pickColor("background", "Background", "transparent");
    selectedIconColor = pickColor("selectedIconColor", "Selected icon colour", "#FFFFFF");
    selectedBackground = pickColor("selectedBackground", "Selected background", "#0F83FF");
    borderColor = pickColor("borderColor", "Border colour", "#C8C6C4");
    borderWidth = num("borderWidth", "Border width", 0, 0, 8);
    cornerRadius = num("cornerRadius", "Corner radius", 3, 0, 30);
    size = num("size", "Button height", 26, 16, 80);
    width = num("width", "Button width", 34, 16, 120);
    groupBackground = pickColor("groupBackground", "Group background", "#EDEBE9");
    groupCornerRadius = num("groupCornerRadius", "Group corner radius", 4, 0, 30);
    groupPadding = num("groupPadding", "Group padding", 2, 0, 20);

    slices = [
        this.controlStyle,
        this.chartText,
        this.tableText,
        this.font,
        this.iconColor,
        this.background,
        this.selectedIconColor,
        this.selectedBackground,
        this.borderColor,
        this.borderWidth,
        this.cornerRadius,
        this.size,
        this.width,
        this.groupBackground,
        this.groupCornerRadius,
        this.groupPadding
    ];
}

/* ------------------------------------------------------------------ */
/* time settings                                                       */
/* ------------------------------------------------------------------ */

export class TimeSettingsCard extends Card {
    name = "timeSettings";
    displayName = "Time axis";
    description = "How the Date field is bucketed when the time granularity switch is used.";

    fiscalYearStartMonth = dropdown(
        "fiscalYearStartMonth",
        "Fiscal year starts",
        [
            member("1", "January"),
            member("2", "February"),
            member("3", "March"),
            member("4", "April"),
            member("5", "May"),
            member("6", "June"),
            member("7", "July"),
            member("8", "August"),
            member("9", "September"),
            member("10", "October"),
            member("11", "November"),
            member("12", "December")
        ],
        "4"
    );
    yearLabelStyle = dropdown(
        "yearLabelStyle",
        "Year label",
        [
            member("range", "2024-2025"),
            member("rangeShort", "2024-25"),
            member("fyShort", "FY25"),
            member("startYear", "2024"),
            member("endYear", "2025")
        ],
        "range"
    );
    quarterLabelStyle = dropdown(
        "quarterLabelStyle",
        "Quarter label",
        [
            member("qYear", "Q1 2025"),
            member("yearQ", "2025 Q1"),
            member("qOnly", "Q1"),
            member("qFy", "Q1 FY25")
        ],
        "qYear"
    );
    monthLabelStyle = dropdown(
        "monthLabelStyle",
        "Month label",
        [
            member("mmmYY", "Jan 25"),
            member("mmmYYYY", "Jan 2025"),
            member("mmm", "Jan"),
            member("mmmmYYYY", "January 2025"),
            member("mmYYYY", "01-2025")
        ],
        "mmmYY"
    );

    slices = [
        this.fiscalYearStartMonth,
        this.yearLabelStyle,
        this.quarterLabelStyle,
        this.monthLabelStyle
    ];
}

/* ------------------------------------------------------------------ */
/* data handling                                                       */
/* ------------------------------------------------------------------ */

export class DataSettingsCard extends Card {
    name = "dataSettings";
    displayName = "Data handling";
    description =
        "How rows are combined when the visual re-groups by the selected dimension or time bucket.";

    rollup = dropdown(
        "rollup",
        "Combine values using",
        [
            member("sum", "Sum"),
            member("avg", "Average"),
            member("min", "Minimum"),
            member("max", "Maximum"),
            member("first", "First (oldest period)"),
            member("last", "Last (latest period)")
        ],
        "sum"
    );
    sortBy = dropdown(
        "sortBy",
        "Sort by",
        [member("value", "Value"), member("category", "Category name"), member("model", "Model order")],
        "value"
    );
    sortDirection = dropdown(
        "sortDirection",
        "Sort direction",
        [member("desc", "Descending"), member("asc", "Ascending")],
        "desc"
    );
    /*
     * Bucket labels sort as text by default, which puts "10-20" before "2-5" and
     * "0-1" after "0-10". Reading the numbers inside the label fixes age and tenure
     * buckets without asking the model for a sort column. Labels with no numbers in
     * them compare exactly as they did before, so this is safe to leave on.
     */
    sortNumeric = toggle("sortNumeric", "Sort labels by the numbers in them", true);
    hideBlank = toggle("hideBlank", "Hide blank categories", false);
    blankLabel = text("blankLabel", "Blank label", "(Blank)");
    maxCategories = num("maxCategories", "Max categories shown", 200, 1, 5000);
    /*
     * How a clicked mark is handed to the rest of the report.
     *
     *   fast       describe the mark by its coordinates - "Department = Engineering"
     *              - as a report filter. One or two conditions however many rows sit
     *              behind the bar, so the other visuals re-query as quickly as they
     *              do for a native chart. They are filtered rather than highlighted.
     *   highlight  the native look: every source row behind the mark is handed over
     *              as a selection identity and the other visuals shade the matching
     *              part of their own bars. At detail grain that is thousands of
     *              identities per click, which is what makes a click feel slow.
     *
     * Fast falls back to highlight on its own whenever the mark cannot be written
     * as a filter - a model measure on the axis, a blank category, several date
     * buckets picked at once.
     */
    crossFilter = dropdown(
        "crossFilter",
        "Cross-filtering",
        [member("fast", "Fast (filter other visuals)"), member("highlight", "Highlight (slower)")],
        "fast"
    );
    /*
     * Only read on the highlight path. Each mark carries one selection identity per
     * source row behind it; at detail grain that can be thousands, and handing the
     * host thousands of identities is what makes a click take seconds.
     */
    maxSelectionIds = num("maxSelectionIds", "Max identities per selection", 1000, 10, 20000);

    slices = [
        this.rollup,
        this.sortBy,
        this.sortDirection,
        this.sortNumeric,
        this.hideBlank,
        this.blankLabel,
        this.maxCategories,
        this.crossFilter,
        this.maxSelectionIds
    ];
}

/* ------------------------------------------------------------------ */
/* columns                                                             */
/* ------------------------------------------------------------------ */

export class ColumnSettingsCard extends Card {
    name = "columnSettings";
    displayName = "Columns and bars";

    /*
     * Stacked vs 100% is a chart type of its own now, so this slice is no longer
     * shown. It is still read: a v2 report that set it to "percent" on a stacked
     * column keeps rendering as 100% stacked after the upgrade.
     */
    stackType = dropdown(
        "stackType",
        "Stack type",
        [member("stacked", "Stacked"), member("percent", "100% stacked")],
        "stacked"
    );
    widthMode = dropdown(
        "widthMode",
        "Column width",
        [member("auto", "Auto (fit, then scroll)"), member("fixed", "Fixed width")],
        "auto"
    );
    barWidth = num("barWidth", "Bar width", 28, 1, 600);
    innerPadding = num("innerPadding", "Space between columns (%)", 20, 0, 90);
    minColumnWidth = num("minColumnWidth", "Min column width before scrolling", 14, 1, 400);
    maxColumnWidth = num("maxColumnWidth", "Max column width", 120, 4, 600);
    cornerRadius = num("cornerRadius", "Corner radius", 0, 0, 30);
    segmentGap = num("segmentGap", "Gap between segments", 0, 0, 20);
    borderColor = pickColor("borderColor", "Border colour", "#FFFFFF");
    borderWidth = num("borderWidth", "Border width", 0, 0, 8);

    clusterPadding = num("clusterPadding", "Space within a cluster (%)", 8, 0, 90);
    maxLabelWidth = num("maxLabelWidth", "Max category label width", 160, 20, 600);

    slices = [
        this.widthMode,
        this.barWidth,
        this.innerPadding,
        this.clusterPadding,
        this.minColumnWidth,
        this.maxColumnWidth,
        this.maxLabelWidth,
        this.cornerRadius,
        this.segmentGap,
        this.borderColor,
        this.borderWidth
    ];
}

/* ------------------------------------------------------------------ */
/* ribbon                                                             */
/* ------------------------------------------------------------------ */

export class RibbonSettingsCard extends Card {
    name = "ribbonSettings";
    displayName = "Ribbons";
    description = "The bands that connect each series between neighbouring categories.";

    transparency = num("transparency", "Ribbon transparency (%)", 40, 0, 100);
    borderWidth = num("ribbonBorderWidth", "Ribbon border width", 0, 0, 6);
    borderColor = pickColor("ribbonBorderColor", "Ribbon border colour", "#FFFFFF");
    sortWithinCategory = toggle("sortWithinCategory", "Largest series on top", true);

    slices = [this.transparency, this.borderWidth, this.borderColor, this.sortWithinCategory];
}

/* ------------------------------------------------------------------ */
/* donut                                                              */
/* ------------------------------------------------------------------ */

export class DonutSettingsCard extends CompositeCard {
    name = "donutSettings";
    displayName = "Donut";

    innerRadius = num("innerRadius", "Inner radius (%)", 60, 0, 90);
    sliceBorderWidth = num("sliceBorderWidth", "Slice border width", 0, 0, 8);
    sliceBorderColor = pickColor("sliceBorderColor", "Slice border colour", "#FFFFFF");
    startAngle = num("startAngle", "Start angle", 0, -360, 360);

    shapeGroup: Group = new Group({
        name: "donutShape",
        displayName: "Shape",
        slices: [this.innerRadius, this.sliceBorderWidth, this.sliceBorderColor, this.startAngle]
    });

    /* the total in the middle of the ring */
    showCentreTotal = toggle("showCentreTotal", "Show total in centre", true);
    centreCaption = text("centreCaption", "Caption under the total", "");
    centreFont = makeFont("centre");
    centreFontColor = pickColor("centreFontColor", "Total colour", "#252423");
    centreDisplayUnits = dropdown("centreDisplayUnits", "Display units", DISPLAY_UNIT_ITEMS, "1");
    centrePrecision = num("centrePrecision", "Decimal places", 0, 0, 6);

    centreGroup: Group = new Group({
        name: "donutCentre",
        displayName: "Centre total",
        slices: [
            this.showCentreTotal,
            this.centreCaption,
            this.centreFont,
            this.centreFontColor,
            this.centreDisplayUnits,
            this.centrePrecision
        ]
    });

    labelContent = dropdown(
        "labelContent",
        "Label content",
        [
            member("value", "Value"),
            member("percent", "Share"),
            member("valuePercent", "Value and share"),
            member("category", "Category"),
            member("categoryValue", "Category and value"),
            member("all", "Category, value and share")
        ],
        "valuePercent"
    );
    labelPlacement = dropdown(
        "labelPlacement",
        "Label placement",
        [member("outside", "Outside"), member("inside", "Inside the ring")],
        "outside"
    );
    showLeaderLines = toggle("showLeaderLines", "Leader lines", true);
    leaderLineColor = pickColor("leaderLineColor", "Leader line colour", "#605E5C");
    minSharePercent = num("minSharePercent", "Hide labels below (%)", 0, 0, 50);

    labelGroup: Group = new Group({
        name: "donutLabels",
        displayName: "Slice labels",
        slices: [
            this.labelContent,
            this.labelPlacement,
            this.showLeaderLines,
            this.leaderLineColor,
            this.minSharePercent
        ]
    });

    groups = [this.shapeGroup, this.centreGroup, this.labelGroup];
}

/* ------------------------------------------------------------------ */
/* combo                                                              */
/* ------------------------------------------------------------------ */

export class ComboSettingsCard extends Card {
    name = "comboSettings";
    displayName = "Combo line";
    description =
        "Measures dropped into the Line values well draw as a line over the columns. Their default colour is yellow.";

    onSecondaryAxis = toggle("onSecondaryAxis", "Plot the line on a secondary axis", true);
    lineDisplay = dropdown(
        "lineDisplay",
        "Draw as",
        [member("line", "Line with markers"), member("markers", "Markers only")],
        "line"
    );
    labelBadge = toggle("labelBadge", "Badge behind the line labels", true);
    badgeColor = pickColor("badgeColor", "Badge colour", "#7A7A7A");
    badgeTextColor = pickColor("badgeTextColor", "Badge text colour", "#FFFFFF");
    badgeRadius = num("badgeRadius", "Badge corner radius", 4, 0, 20);

    slices = [
        this.onSecondaryAxis,
        this.lineDisplay,
        this.labelBadge,
        this.badgeColor,
        this.badgeTextColor,
        this.badgeRadius
    ];
}

export class LineSettingsCard extends Card {
    name = "lineSettings";
    displayName = "Lines";

    lineWidth = num("lineWidth", "Line width", 2.5, 0.5, 20);
    lineStyle = dropdown("lineStyle", "Line style", GRIDLINE_STYLE_ITEMS, "solid");
    curve = dropdown(
        "curve",
        "Line shape",
        [member("straight", "Straight"), member("smooth", "Smooth"), member("step", "Stepped")],
        "straight"
    );
    showMarkers = toggle("showMarkers", "Show markers", true);
    markerShape = dropdown(
        "markerShape",
        "Marker shape",
        [
            member("diamond", "Diamond"),
            member("circle", "Circle"),
            member("square", "Square"),
            member("triangle", "Triangle")
        ],
        "diamond"
    );
    markerSize = num("markerSize", "Marker size", 7, 2, 40);
    connectNulls = toggle("connectNulls", "Join across gaps", false);
    showArea = toggle("showArea", "Fill area below line", false);
    areaTransparency = num("areaTransparency", "Area transparency (%)", 85, 0, 100);
    spacingMode = dropdown(
        "spacingMode",
        "Point spacing",
        [member("auto", "Auto (fit, then scroll)"), member("fixed", "Fixed spacing")],
        "auto"
    );
    pointSpacing = num("pointSpacing", "Spacing between points", 90, 4, 800);
    minPointSpacing = num("minPointSpacing", "Min spacing before scrolling", 40, 4, 400);

    slices = [
        this.lineWidth,
        this.lineStyle,
        this.curve,
        this.showMarkers,
        this.markerShape,
        this.markerSize,
        this.connectNulls,
        this.showArea,
        this.areaTransparency,
        this.spacingMode,
        this.pointSpacing,
        this.minPointSpacing
    ];
}

/* ------------------------------------------------------------------ */
/* areas                                                              */
/* ------------------------------------------------------------------ */

export class AreaSettingsCard extends Card {
    name = "areaSettings";
    displayName = "Areas";

    /*
     * Two transparencies because the two shapes of area chart want opposite things.
     * Stacked bands do not overlap, so they are drawn nearly solid the way Power BI
     * draws them; overlapping areas have to be see-through or the tallest series
     * hides the rest. Each type reads only its own value, so changing one never
     * moves the other.
     */
    transparency = num("transparency", "Fill transparency, stacked (%)", 20, 0, 100);
    overlapTransparency = num(
        "overlapTransparency",
        "Fill transparency, overlapping (%)",
        65,
        0,
        100
    );

    slices = [this.transparency, this.overlapTransparency];
}

/* ------------------------------------------------------------------ */
/* scatter                                                             */
/* ------------------------------------------------------------------ */

export class ScatterSettingsCard extends Card {
    name = "scatterSettings";
    displayName = "Scatter";

    markerShape = dropdown(
        "markerShape",
        "Marker shape",
        [
            member("circle", "Circle"),
            member("diamond", "Diamond"),
            member("square", "Square"),
            member("triangle", "Triangle")
        ],
        "circle"
    );
    /** used when the Size well is empty, so every point is the same size */
    markerSize = num("markerSize", "Marker size", 10, 2, 60);
    /** the two ends of the bubble scale, used only when Size is mapped */
    minBubbleSize = num("minBubbleSize", "Smallest bubble", 8, 2, 100);
    maxBubbleSize = num("maxBubbleSize", "Largest bubble", 40, 2, 200);
    transparency = num("transparency", "Marker transparency (%)", 10, 0, 100);
    /*
     * Off matches Power BI: without a Legend field every point is one colour. On
     * gives each category its own colour from the Data colours card, which is
     * useful when the points ARE the categories and there is no legend.
     */
    colorByCategory = toggle("colorByCategory", "Colour points by category", false);

    /*
     * The Y axis borrows Start / End / Display units / Decimals / Max gridlines from
     * the Value axis card; the X axis is numeric here too and has nowhere else to
     * get them from, so it gets its own set.
     */
    xStart = new formattingSettings.NumUpDown({ name: "xStart", displayName: "X axis start", value: null });
    xEnd = new formattingSettings.NumUpDown({ name: "xEnd", displayName: "X axis end", value: null });
    xDisplayUnits = dropdown("xDisplayUnits", "X axis display units", DISPLAY_UNIT_ITEMS, "1");
    xPrecision = num("xPrecision", "X axis decimal places", 0, 0, 6);
    xTickCount = num("xTickCount", "X axis max gridlines", 6, 2, 20);
    /*
     * Power BI lets a scatter axis start away from zero - which is usually right,
     * since two measures rarely both reach it - so both default to off.
     */
    xIncludeZero = toggle("xIncludeZero", "X axis includes zero", false);
    yIncludeZero = toggle("yIncludeZero", "Y axis includes zero", false);

    slices = [
        this.markerShape,
        this.markerSize,
        this.minBubbleSize,
        this.maxBubbleSize,
        this.transparency,
        this.colorByCategory,
        this.xStart,
        this.xEnd,
        this.xDisplayUnits,
        this.xPrecision,
        this.xTickCount,
        this.xIncludeZero,
        this.yIncludeZero
    ];
}

/* ------------------------------------------------------------------ */
/* legend                                                              */
/* ------------------------------------------------------------------ */

export class LegendCard extends Card {
    name = "legend";
    displayName = "Legend";

    show = toggle("show", "Show", true);
    topLevelSlice = this.show;

    position = dropdown(
        "position",
        "Position",
        [member("top", "Top"), member("bottom", "Bottom"), member("left", "Left"), member("right", "Right")],
        "top"
    );
    showTitle = toggle("showTitle", "Show title", false);
    titleText = text("titleText", "Title", "");
    align = dropdown(
        "align",
        "Alignment",
        [member("left", "Left"), member("center", "Center"), member("right", "Right")],
        "left"
    );
    markerShape = dropdown(
        "markerShape",
        "Marker shape",
        [
            member("diamond", "Diamond"),
            member("circle", "Circle"),
            member("square", "Square"),
            member("line", "Line")
        ],
        "diamond"
    );
    markerSize = num("markerSize", "Marker size", 8, 2, 30);
    font = makeFont("");
    fontColor = pickColor("fontColor", "Text colour", "#252423");

    slices = [
        this.position,
        this.align,
        this.showTitle,
        this.titleText,
        this.markerShape,
        this.markerSize,
        this.font,
        this.fontColor
    ];
}

/* ------------------------------------------------------------------ */
/* data labels                                                         */
/* ------------------------------------------------------------------ */

export class DataLabelsCard extends CompositeCard {
    name = "dataLabels";
    displayName = "Data labels";

    show = toggle("show", "Show", false);
    topLevelSlice = this.show;

    labelPosition = dropdown(
        "labelPosition",
        "Position",
        [
            member("auto", "Auto"),
            member("above", "Above (outside)"),
            member("below", "Below"),
            member("insideCenter", "Inside center"),
            member("insideEnd", "Inside end"),
            member("insideBase", "Inside base"),
            member("left", "Left"),
            member("right", "Right")
        ],
        "auto"
    );
    font = makeFont("");
    fontColor = pickColor("fontColor", "Colour", "#FFFFFF");
    autoContrast = toggle("autoContrast", "Auto contrast colour", true);
    displayUnits = dropdown("displayUnits", "Display units", DISPLAY_UNIT_ITEMS, "1");
    precision = num("precision", "Decimal places", 0, 0, 6);
    hideOverlapping = toggle("hideOverlapping", "Hide labels that do not fit", true);

    segmentGroup: Group = new Group({
        name: "dataLabelsSegment",
        displayName: "Segment labels",
        slices: [
            this.labelPosition,
            this.font,
            this.fontColor,
            this.autoContrast,
            this.displayUnits,
            this.precision,
            this.hideOverlapping
        ]
    });

    showTotal = toggle("showTotal", "Show total", false);
    totalFont = makeFont("total", DEFAULT_FONT_SIZE, true);
    totalFontColor = pickColor("totalFontColor", "Total colour", "#252423");
    totalShowBackground = toggle("totalShowBackground", "Total background", false);
    totalBackground = pickColor("totalBackground", "Total background colour", "#EFEFEF");

    totalGroup: Group = new Group({
        name: "dataLabelsTotal",
        displayName: "Total labels",
        slices: [
            this.showTotal,
            this.totalFont,
            this.totalFontColor,
            this.totalShowBackground,
            this.totalBackground
        ]
    });

    groups = [this.segmentGroup, this.totalGroup];
}

/* ------------------------------------------------------------------ */
/* axes                                                                */
/* ------------------------------------------------------------------ */

export class CategoryAxisCard extends CompositeCard {
    name = "categoryAxis";
    /* "Category axis" rather than "X axis": on a bar chart it runs vertically */
    displayName = "Category axis";

    show = toggle("show", "Show", true);
    topLevelSlice = this.show;

    font = makeFont("", AXIS_FONT_SIZE);
    fontColor = pickColor("fontColor", "Colour", "#000000");
    labelRotation = dropdown(
        "labelRotation",
        "Label rotation",
        [member("auto", "Auto"), member("0", "Horizontal"), member("-45", "-45°"), member("-90", "Vertical")],
        "auto"
    );
    maxLabelHeight = num("maxLabelHeight", "Max label area", 90, 10, 400);

    valuesGroup: Group = new Group({
        name: "categoryAxisValues",
        displayName: "Values",
        slices: [this.font, this.fontColor, this.labelRotation, this.maxLabelHeight]
    });

    showTitle = toggle("showTitle", "Show title", false);
    titleText = text("titleText", "Title text", "");
    titleFont = makeFont("title", AXIS_FONT_SIZE);
    titleFontColor = pickColor("titleFontColor", "Title colour", "#000000");

    titleGroup: Group = new Group({
        name: "categoryAxisTitle",
        displayName: "Title",
        slices: [this.showTitle, this.titleText, this.titleFont, this.titleFontColor]
    });

    showAxisLine = toggle("showAxisLine", "Show axis line", true);
    axisLineColor = pickColor("axisLineColor", "Axis line colour", "#D9D9D9");
    showGridlines = toggle("showGridlines", "Show gridlines", false);
    gridlineColor = pickColor("gridlineColor", "Gridline colour", "#EAEAEA");
    gridlineWidth = num("gridlineWidth", "Gridline width", 1, 0, 10);
    gridlineStyle = dropdown("gridlineStyle", "Gridline style", GRIDLINE_STYLE_ITEMS, "solid");

    linesGroup: Group = new Group({
        name: "categoryAxisLines",
        displayName: "Lines",
        slices: [
            this.showAxisLine,
            this.axisLineColor,
            this.showGridlines,
            this.gridlineColor,
            this.gridlineWidth,
            this.gridlineStyle
        ]
    });

    groups = [this.valuesGroup, this.titleGroup, this.linesGroup];
}

export class ValueAxisCard extends CompositeCard {
    name = "valueAxis";
    displayName = "Value axis";

    show = toggle("show", "Show", true);
    topLevelSlice = this.show;

    start = new formattingSettings.NumUpDown({ name: "start", displayName: "Start", value: null });
    end = new formattingSettings.NumUpDown({ name: "end", displayName: "End", value: null });
    font = makeFont("", AXIS_FONT_SIZE);
    fontColor = pickColor("fontColor", "Colour", "#000000");
    displayUnits = dropdown("displayUnits", "Display units", DISPLAY_UNIT_ITEMS, "1");
    precision = num("precision", "Decimal places", 0, 0, 6);
    tickCount = num("tickCount", "Max gridlines", 5, 2, 20);

    valuesGroup: Group = new Group({
        name: "valueAxisValues",
        displayName: "Values",
        slices: [
            this.start,
            this.end,
            this.font,
            this.fontColor,
            this.displayUnits,
            this.precision,
            this.tickCount
        ]
    });

    showTitle = toggle("showTitle", "Show title", false);
    titleText = text("titleText", "Title text", "");
    titleFont = makeFont("title", AXIS_FONT_SIZE);
    titleFontColor = pickColor("titleFontColor", "Title colour", "#000000");

    titleGroup: Group = new Group({
        name: "valueAxisTitle",
        displayName: "Title",
        slices: [this.showTitle, this.titleText, this.titleFont, this.titleFontColor]
    });

    showAxisLine = toggle("showAxisLine", "Show axis line", false);
    axisLineColor = pickColor("axisLineColor", "Axis line colour", "#D9D9D9");
    showGridlines = toggle("showGridlines", "Show gridlines", true);
    gridlineColor = pickColor("gridlineColor", "Gridline colour", "#EAEAEA");
    gridlineWidth = num("gridlineWidth", "Gridline width", 1, 0, 10);
    gridlineStyle = dropdown("gridlineStyle", "Gridline style", GRIDLINE_STYLE_ITEMS, "dotted");

    linesGroup: Group = new Group({
        name: "valueAxisLines",
        displayName: "Lines",
        slices: [
            this.showAxisLine,
            this.axisLineColor,
            this.showGridlines,
            this.gridlineColor,
            this.gridlineWidth,
            this.gridlineStyle
        ]
    });

    groups = [this.valuesGroup, this.titleGroup, this.linesGroup];
}

/** right-hand axis, used by the combo types for the line measure */
export class SecondaryAxisCard extends CompositeCard {
    name = "secondaryAxis";
    displayName = "Secondary value axis";

    show = toggle("show", "Show", true);
    topLevelSlice = this.show;

    start = new formattingSettings.NumUpDown({ name: "start", displayName: "Start", value: null });
    end = new formattingSettings.NumUpDown({ name: "end", displayName: "End", value: null });
    font = makeFont("", AXIS_FONT_SIZE);
    fontColor = pickColor("fontColor", "Colour", "#000000");
    displayUnits = dropdown("displayUnits", "Display units", DISPLAY_UNIT_ITEMS, "1");
    precision = num("precision", "Decimal places", 0, 0, 6);

    valuesGroup: Group = new Group({
        name: "secondaryAxisValues",
        displayName: "Values",
        slices: [
            this.start,
            this.end,
            this.font,
            this.fontColor,
            this.displayUnits,
            this.precision
        ]
    });

    showTitle = toggle("showTitle", "Show title", false);
    titleText = text("titleText", "Title text", "");
    titleFont = makeFont("title", AXIS_FONT_SIZE);
    titleFontColor = pickColor("titleFontColor", "Title colour", "#000000");

    titleGroup: Group = new Group({
        name: "secondaryAxisTitle",
        displayName: "Title",
        slices: [this.showTitle, this.titleText, this.titleFont, this.titleFontColor]
    });

    groups = [this.valuesGroup, this.titleGroup];
}

/* ------------------------------------------------------------------ */
/* table view - card names, groups and defaults mirror the existing    */
/* tableDarwinbox custom visual so report authors see the same pane    */
/* ------------------------------------------------------------------ */

/** hidden: persisted column widths + sort, same shape as tableDarwinbox */
export class SaveStateCard extends Card {
    name = "saveState";
    displayName = "Save State";
    visible = false;

    columnMetadata = text("columnMetadata", "", "{}");
    slices = [this.columnMetadata];
}

export class SearchSettingCard extends Card {
    name = "searchSetting";
    displayName = "Search Bar Setting";

    show = toggle("show", "Show", true);
    topLevelSlice = this.show;

    placeholder = text("placeholder", "Placeholder", "Search");
    width = num("width", "Width", 250, 80, 900);
    font = makeFont("");
    color = pickColor("color", "Text Color", "#000000");
    backColor = pickColor("backColor", "Background Color", "#FFFFFF");
    borderColor = pickColor("borderColor", "Border Color", "#000000");

    slices = [
        this.placeholder,
        this.width,
        this.font,
        this.color,
        this.backColor,
        this.borderColor
    ];
}

export class ColumnSettingCard extends Card {
    name = "column";
    displayName = "Column Setting";

    font = makeFont("", TABLE_HEADER_FONT_SIZE);
    color = pickColor("color", "Text Color", "#0183FF");
    backColor = pickColor("backColor", "Background Color", "#FFFFFF");
    textAlignment = new formattingSettings.AlignmentGroup({
        name: "textAlignment",
        displayName: "Text Alignment",
        mode: powerbi.visuals.AlignmentGroupMode.Horizonal,
        value: "left"
    });
    borderColor = pickColor("borderColor", "Border Color", "#67B5FF");

    slices = [this.font, this.color, this.backColor, this.textAlignment, this.borderColor];
}

export class RowSettingCard extends CompositeCard {
    name = "row";
    displayName = "Row Setting";

    rowHeight = num("rowHeight", "Row Height", 38, 16, 200);

    rowGroup: Group = new Group({
        name: "row_rowGroup",
        displayName: "Row",
        slices: [this.rowHeight]
    });

    font = makeFont("", TABLE_ROW_FONT_SIZE);
    color = pickColor("color", "Text Color", "#000000");
    backColor = pickColor("backColor", "Background Color", "#FFFFFF");
    selectedBackColor = pickColor("selectedBackColor", "Selected Row Color", "#98E7E6");
    bandedRows = toggle("bandedRows", "Banded Rows", false);
    alternateBackColor = pickColor("alternateBackColor", "Alternate Row Color", "#F7F7F7");
    textAlignment = new formattingSettings.AlignmentGroup({
        name: "textAlignment",
        displayName: "Text Alignment",
        mode: powerbi.visuals.AlignmentGroupMode.Horizonal,
        value: "left"
    });

    styleGroup: Group = new Group({
        name: "row_fontGroup",
        displayName: "Style",
        slices: [
            this.font,
            this.color,
            this.backColor,
            this.selectedBackColor,
            this.bandedRows,
            this.alternateBackColor,
            this.textAlignment
        ]
    });

    unit = new formattingSettings.AutoDropdown({ name: "unit", displayName: "Display Units", value: 1 });
    dataPrecision = num("dataPrecision", "Decimals", 0, 0, 6);

    valueGroup: Group = new Group({
        name: "row_valueGroup",
        displayName: "Values",
        slices: [this.unit, this.dataPrecision]
    });

    groups = [this.rowGroup, this.styleGroup, this.valueGroup];
}

export class TableSettingCard extends CompositeCard {
    name = "tableSetting";
    displayName = "Table Setting";

    filterBySelection = toggle("filterBySelection", "Filter rows by the chart selection", true);
    /*
     * Power BI's own "Export data" hands back the query behind the visual, which is
     * coarser than the grid - every date for every employee, zeros included. This
     * exports what the grid is actually showing.
     */
    showExport = toggle("showExport", "Show export button", true);
    exportText = text("exportText", "Export button text", "Export");
    hideCheckBox = toggle("hideCheckBox", "Hide CheckBox", true);
    showPagination = toggle("showPagination", "Show Pagination", true);
    paginationSize = num("paginationSize", "Page Size", 100, 1, 5000);
    startExpanded = toggle("startExpanded", "Start Expanded", false);
    showMeasureColumns = toggle("showMeasureColumns", "Show measures from Values", false);

    actionGroup: Group = new Group({
        name: "tableSetting_actions",
        displayName: "Table Actions",
        slices: [
            this.filterBySelection,
            this.showExport,
            this.exportText,
            this.hideCheckBox,
            this.showPagination,
            this.paginationSize,
            this.startExpanded,
            this.showMeasureColumns
        ]
    });

    showTotalRow = toggle("showTotalRow", "Total Row", true);
    showTotalColumn = toggle("showTotalColumn", "Total Column", true);
    totalLabel = text("totalLabel", "Total Label", "Total");

    totalsGroup: Group = new Group({
        name: "tableSetting_totals",
        displayName: "Totals",
        slices: [this.showTotalRow, this.showTotalColumn, this.totalLabel]
    });

    /* the heading shown at the top-left of table view, e.g. "Employee Data" */
    showTitle = toggle("showTitle", "Show Title", true);
    titleText = text("titleText", "Title", "");
    titleFont = makeFont("title");
    titleFontColor = pickColor("titleFontColor", "Title Colour", "#252423");

    headerGroup: Group = new Group({
        name: "tableSetting_header",
        displayName: "Header",
        slices: [this.showTitle, this.titleText, this.titleFont, this.titleFontColor]
    });

    groups = [this.headerGroup, this.actionGroup, this.totalsGroup];
}

/** groups are generated per value column at runtime, as tableDarwinbox does */
/**
 * In-cell formatting for the table's value columns, ported from tableDarwinbox:
 * "Bar" turns a numeric column into an in-cell progress bar scaled to the column
 * maximum, "URL" renders a text column as a hyperlink. Off by default, because
 * most tables want neither and the per-column groups are noise until they do.
 */
export class CellFormattingCard extends CompositeCard {
    name = "cellFormatting";
    displayName = "Cell Formatting";

    show = toggle("show", "Show", false);
    topLevelSlice = this.show;

    backColor = pickColor("backColor", "Background Color", "#0183FF");
    groups: Group[] = [];
}

/* ------------------------------------------------------------------ */
/* plot area                                                           */
/* ------------------------------------------------------------------ */

export class PlotAreaCard extends Card {
    name = "plotArea";
    displayName = "Plot area";

    background = pickColor("background", "Background", "transparent");
    borderColor = pickColor("borderColor", "Border colour", "#E1E1E1");
    borderWidth = num("borderWidth", "Border width", 0, 0, 10);
    cornerRadius = num("cornerRadius", "Corner radius", 0, 0, 30);
    paddingTop = num("paddingTop", "Padding top", 12, 0, 120);
    paddingRight = num("paddingRight", "Padding right", 12, 0, 120);
    paddingBottom = num("paddingBottom", "Padding bottom", 4, 0, 120);
    paddingLeft = num("paddingLeft", "Padding left", 4, 0, 120);

    slices = [
        this.background,
        this.borderColor,
        this.borderWidth,
        this.cornerRadius,
        this.paddingTop,
        this.paddingRight,
        this.paddingBottom,
        this.paddingLeft
    ];
}

/* ------------------------------------------------------------------ */
/* colours (per-series, populated at runtime)                          */
/* ------------------------------------------------------------------ */

export class DataPointCard extends Card {
    name = "dataPoint";
    displayName = "Colours";
    slices: Array<formattingSettings.Slice> = [];
}

/* ------------------------------------------------------------------ */
/* model                                                               */
/* ------------------------------------------------------------------ */

export class VisualSettings extends Model {
    chartSettings = new ChartSettingsCard();
    state = new StateCard();
    controlBar = new ControlBarCard();
    headerLayout = new HeaderLayoutCard();
    topN = new TopNCard();
    dimensionSelector = new DimensionSelectorCard();
    dimension2 = new Dimension2Card();
    insight = new InsightCard();
    granularitySwitch = new GranularityCard();
    viewToggle = new ViewToggleCard();
    timeSettings = new TimeSettingsCard();
    dataSettings = new DataSettingsCard();
    columnSettings = new ColumnSettingsCard();
    lineSettings = new LineSettingsCard();
    ribbonSettings = new RibbonSettingsCard();
    donutSettings = new DonutSettingsCard();
    comboSettings = new ComboSettingsCard();
    areaSettings = new AreaSettingsCard();
    scatterSettings = new ScatterSettingsCard();
    dataPoint = new DataPointCard();
    legend = new LegendCard();
    dataLabels = new DataLabelsCard();
    categoryAxis = new CategoryAxisCard();
    valueAxis = new ValueAxisCard();
    secondaryAxis = new SecondaryAxisCard();
    plotArea = new PlotAreaCard();

    /* table view (mirrors tableDarwinbox) */
    saveState = new SaveStateCard();
    searchSetting = new SearchSettingCard();
    column = new ColumnSettingCard();
    row = new RowSettingCard();
    tableSetting = new TableSettingCard();
    cellFormatting = new CellFormattingCard();

    cards = [
        this.chartSettings,
        this.state,
        this.saveState,
        this.controlBar,
        this.headerLayout,
        this.topN,
        this.dimensionSelector,
        this.dimension2,
        this.insight,
        this.granularitySwitch,
        this.viewToggle,
        this.timeSettings,
        this.dataSettings,
        this.columnSettings,
        this.lineSettings,
        this.ribbonSettings,
        this.donutSettings,
        this.comboSettings,
        this.areaSettings,
        this.scatterSettings,
        this.dataPoint,
        this.legend,
        this.dataLabels,
        this.categoryAxis,
        this.valueAxis,
        this.secondaryAxis,
        this.plotArea,
        this.searchSetting,
        this.column,
        this.row,
        this.tableSetting,
        this.cellFormatting
    ];
}
