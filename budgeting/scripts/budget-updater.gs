// ============================================================
// Personal Budget Dashboard Updater
// Google Apps Script — paste into your Google Sheet
// Tools > Apps Script > paste > Save > run onOpen once
// ============================================================

// ── CONFIG ───────────────────────────────────────────────────
var CONFIG = {
  driveFolderName:      "Budget Uploads",   // Google Drive folder name
  csvFileName:          "All-Accounts.csv", // Exact CSV filename
  dataSheetName:        "Raw Data",         // Your data sheet name
  dashboardSheetName:   "Dashboard",        // Dashboard sheet name
  dateColumn:           2,                  // Column B = Date
  amountColumn:         6,                  // Column F = Amount
  monthColumn:          7,                  // Column G = Month (added by script)
  payeeColumn:          3,                  // Column C = Payee
  categoryColumn:       5,                  // Column E = Category
  monthColHeader:       "Month",
  monthlyIncome:        5500,               // Approximate monthly income (for savings rate)
  expensesAreNegative:  true,               // true = Actual Budget default
                                            // Set false if your spending shows as negative
};

// ── CATEGORIES ───────────────────────────────────────────────
// Names must match EXACTLY how they appear in your Raw Data Category column.
// If a category shows $0 when it shouldn't, check the name here against Raw Data.
var CATEGORIES = [
  { name: "Bills",                          budget: 600  },
  { name: "Bills (Flexible) Subscriptions", budget: 100  },
  { name: "Food",                           budget: 700  },
  { name: "Shopping",                       budget: 300  },
  { name: "Health",                         budget: 100  },
  { name: "Donation",                       budget: 100  },
  { name: "General",                        budget: 100  },
  { name: "Bitcoin",                        budget: 550  },
];

var TOTAL_BUDGET = CATEGORIES.reduce(function(sum, c) { return sum + c.budget; }, 0);

// ── ROW LAYOUT ───────────────────────────────────────────────
// Pre-calculated so formulas can reference exact rows without hard-coding.
function R_() {
  var R = {};
  R.title            = 1;
  R.monthSelector    = 2;
  // row 3 = blank
  R.summaryHeader    = 4;
  R.totalSpent       = 5;
  R.totalBudgeted    = 6;
  R.overUnder        = 7;
  R.savingsRate      = 8;
  // row 9 = blank
  R.catSectionHeader = 10;
  R.catColHeader     = 11;
  R.catStart         = 12;
  R.catEnd           = R.catStart + CATEGORIES.length - 1;  // row 19
  R.catTotal         = R.catEnd + 1;                        // row 20
  // row 21 = blank
  R.monthSectionHeader = R.catTotal + 2;                    // row 22
  R.monthData          = R.catTotal + 3;                    // row 23
  // Chart helper data lives in columns J–L (col 10–12), rows 2–8
  // These columns are unused by the main dashboard layout.
  R.chartDataHeaderRow = 2;
  R.chartDataStartRow  = 3;
  R.chartDataCol       = 10; // column J
  // Charts are anchored below the monthly data section
  R.chartsStart        = R.monthData + 18;                  // row 41 (leaves room for ~15 months)
  return R;
}

// ── MENU ─────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("💰 Budget Tools")
    .addItem("🔄 Update Transactions",  "updateTransactions")
    .addItem("🛠️  Setup Dashboard",      "setupDashboard")
    .addItem("ℹ️  How to use",           "showHelp")
    .addToUi();
}

// ─────────────────────────────────────────────────────────────
// UPDATE TRANSACTIONS
// ─────────────────────────────────────────────────────────────
function updateTransactions() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var dataSheet = ss.getSheetByName(CONFIG.dataSheetName);
  if (!dataSheet) {
    ui.alert("❌ Sheet not found",
      'Could not find a sheet named "' + CONFIG.dataSheetName + '".',
      ui.ButtonSet.OK);
    return;
  }

  var folders = DriveApp.getFoldersByName(CONFIG.driveFolderName);
  if (!folders.hasNext()) {
    ui.alert("❌ Folder not found",
      'Create a folder called "' + CONFIG.driveFolderName + '" in Google Drive.',
      ui.ButtonSet.OK);
    return;
  }
  var folder = folders.next();
  var files = folder.getFilesByName(CONFIG.csvFileName);
  if (!files.hasNext()) {
    ui.alert("❌ CSV not found",
      'Could not find "' + CONFIG.csvFileName + '" in the "' + CONFIG.driveFolderName + '" folder.',
      ui.ButtonSet.OK);
    return;
  }

  var rows = Utilities.parseCsv(files.next().getBlob().getDataAsString());
  if (rows.length < 2) {
    ui.alert("⚠️ Empty file", "The CSV file appears to be empty.", ui.ButtonSet.OK);
    return;
  }
  var csvHeaders = rows[0];
  var dataRows   = rows.slice(1);
  var csvColCount = csvHeaders.length;

  var lastRow = dataSheet.getLastRow();
  if (lastRow > 1) dataSheet.getRange(2, 1, lastRow - 1, csvColCount).clearContent();

  dataSheet.getRange(2, 1, dataRows.length, csvColCount).setValues(dataRows);
  dataSheet.getRange(2, 1, dataRows.length, csvColCount)
    .sort({ column: CONFIG.dateColumn, ascending: false });
  dataSheet.getRange(2, CONFIG.dateColumn, dataRows.length, 1).setNumberFormat("YYYY-MM-DD");

  // Month header + formulas in column G
  dataSheet.getRange(1, CONFIG.monthColumn).setValue(CONFIG.monthColHeader);
  var monthFormulas = [];
  for (var i = 2; i <= dataRows.length + 1; i++) {
    monthFormulas.push(['=TEXT(B' + i + ',"YYYY-MM")']);
  }
  dataSheet.getRange(2, CONFIG.monthColumn, dataRows.length, 1).setFormulas(monthFormulas);

  // Refresh Dashboard dropdown if it exists
  var dashSheet = ss.getSheetByName(CONFIG.dashboardSheetName);
  if (dashSheet) refreshMonthDropdown_(dashSheet, dataSheet, dataRows.length);

  ui.alert("✅ Done!",
    dataRows.length + ' transactions loaded.\n\n' +
    "✔ Column B formatted as date\n" +
    "✔ Month column (G) filled\n" +
    (dashSheet ? "✔ Dashboard month dropdown refreshed" : ""),
    ui.ButtonSet.OK);
}

// ─────────────────────────────────────────────────────────────
// SETUP DASHBOARD
// ─────────────────────────────────────────────────────────────
function setupDashboard() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rawSheet = ss.getSheetByName(CONFIG.dataSheetName);

  if (!rawSheet) {
    ui.alert("❌ Error", 'Run "Update Transactions" first.', ui.ButtonSet.OK);
    return;
  }
  var existing = ss.getSheetByName(CONFIG.dashboardSheetName);
  if (existing) {
    if (ui.alert("⚠️ Rebuild Dashboard?",
          "This will rebuild the Dashboard sheet from scratch. Continue?",
          ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
    existing.clear();
    existing.clearFormats();
    var dashSheet = existing;
  } else {
    var dashSheet = ss.insertSheet(CONFIG.dashboardSheetName);
  }
  ss.setActiveSheet(dashSheet);
  ss.moveActiveSheet(1);

  var R = R_();
  // SEL = the month selector cell expression, wrapped in TEXT() so it works
  // whether B2 stores the month as text ("2026-01") or as a date (Jan 1 2026).
  // Without TEXT(), QUERY concatenation converts a date to its serial number,
  // producing WHERE Col3='46043' which matches nothing → "No data" errors.
  var SEL     = 'TEXT($B$' + R.monthSelector + ',"YYYY-MM")';
  var sign    = CONFIG.expensesAreNegative ? "-"  : "";   // negate to show spending as positive
  var expF    = CONFIG.expensesAreNegative ? "< 0" : "> 0"; // expense filter for QUERY
  var incF    = CONFIG.expensesAreNegative ? "> 0" : "< 0"; // income  filter for QUERY
  var expSort = CONFIG.expensesAreNegative ? "ASC" : "DESC"; // highest spending first

  // ── Column widths ─────────────────────────────────────────
  dashSheet.setColumnWidth(1, 240);  // A: labels
  dashSheet.setColumnWidth(2, 110);  // B: values / budget
  dashSheet.setColumnWidth(3, 110);  // C: actual
  dashSheet.setColumnWidth(4, 110);  // D: variance
  dashSheet.setColumnWidth(5, 100);  // E: % of budget
  dashSheet.setColumnWidth(6, 30);   // F: spacer
  dashSheet.setColumnWidth(7, 180);  // G: payee label
  dashSheet.setColumnWidth(8, 110);  // H: payee amount
  dashSheet.setColumnWidth(9, 30);   // I: spacer
  dashSheet.setColumnWidth(10, 90);  // J: chart data (hidden area)
  dashSheet.setColumnWidth(11, 90);  // K
  dashSheet.setColumnWidth(12, 90);  // L

  // ── Row 1: Title ──────────────────────────────────────────
  dashSheet.getRange(R.title, 1, 1, 8).merge()
    .setValue("💰 Personal Budget Dashboard")
    .setFontSize(16).setFontWeight("bold")
    .setBackground("#1a73e8").setFontColor("#ffffff")
    .setHorizontalAlignment("center");
  dashSheet.setRowHeight(R.title, 40);

  // ── Row 2: Month selector ─────────────────────────────────
  dashSheet.getRange(R.monthSelector, 1)
    .setValue("📅 Month").setFontWeight("bold").setBackground("#e8f0fe");
  // "@" = text number format — prevents Sheets from auto-converting "2026-01" → date,
  // which would break the QUERY month filter (date serial ≠ "YYYY-MM" string).
  dashSheet.getRange(R.monthSelector, 2)
    .setNumberFormat("@")
    .setBackground("#e8f0fe").setFontWeight("bold").setFontSize(13)
    .setHorizontalAlignment("center");
  dashSheet.getRange(R.monthSelector, 3, 1, 3).merge()
    .setValue("← pick a month from the dropdown")
    .setFontColor("#888888").setFontStyle("italic");
  dashSheet.setRowHeight(R.monthSelector, 30);

  // ── Row 4: Summary header ─────────────────────────────────
  dashSheet.getRange(R.summaryHeader, 1, 1, 5).merge()
    .setValue("📋 Summary")
    .setFontWeight("bold").setFontSize(12).setBackground("#f1f3f4");

  // ── Row 5: Total Spent ────────────────────────────────────
  // References the category TOTAL row's Actual column (C20) instead of a raw
  // SUMIFS over all transactions — that would include income and give a wrong number.
  dashSheet.getRange(R.totalSpent, 1).setValue("Total Spent This Month").setFontWeight("bold");
  dashSheet.getRange(R.totalSpent, 2)
    .setFormula('=IFERROR(C' + R.catTotal + ',0)')
    .setNumberFormat('"$"#,##0.00').setFontWeight("bold").setFontSize(12);

  // ── Row 6: Total Budgeted ─────────────────────────────────
  dashSheet.getRange(R.totalBudgeted, 1).setValue("Total Budgeted").setFontWeight("bold");
  dashSheet.getRange(R.totalBudgeted, 2)
    .setValue(TOTAL_BUDGET)
    .setNumberFormat('"$"#,##0.00').setFontWeight("bold").setFontSize(12);

  // ── Row 7: Over / Under ───────────────────────────────────
  dashSheet.getRange(R.overUnder, 1).setValue("Over / Under Budget").setFontWeight("bold");
  dashSheet.getRange(R.overUnder, 2)
    .setFormula('=B' + R.totalSpent + '-B' + R.totalBudgeted)
    .setNumberFormat('"$"#,##0.00').setFontWeight("bold").setFontSize(12);

  // ── Row 8: Savings Rate ───────────────────────────────────
  dashSheet.getRange(R.savingsRate, 1).setValue("Savings Rate").setFontWeight("bold");
  dashSheet.getRange(R.savingsRate, 2)
    .setFormula(
      '=IFERROR(' + sign + 'SUMIFS(\'Raw Data\'!F:F,' +
      '\'Raw Data\'!E:E,"Bitcoin",\'Raw Data\'!G:G,' + SEL + ')/' + CONFIG.monthlyIncome + ',0)')
    .setNumberFormat("0.00%").setFontWeight("bold").setFontSize(12);

  // ── Row 10: Category section header ───────────────────────
  dashSheet.getRange(R.catSectionHeader, 1, 1, 5).merge()
    .setValue("📊 Spending by Category")
    .setFontWeight("bold").setFontSize(12).setBackground("#f1f3f4");

  // Right side: Top Payees header (same row)
  dashSheet.getRange(R.catSectionHeader, 7, 1, 2).merge()
    .setValue("🏆 Top Payees (selected month)")
    .setFontWeight("bold").setFontSize(12).setBackground("#f1f3f4");

  // ── Row 11: Column headers ────────────────────────────────
  dashSheet.getRange(R.catColHeader, 1, 1, 5)
    .setValues([["Category", "Budget", "Actual", "Variance", "% of Budget"]])
    .setFontWeight("bold").setBackground("#4a86e8").setFontColor("#ffffff");
  dashSheet.getRange(R.catColHeader, 7, 1, 2)
    .setValues([["Payee", "Amount"]])
    .setFontWeight("bold").setBackground("#4a86e8").setFontColor("#ffffff");

  // ── Rows 12–19: Category rows ─────────────────────────────
  CATEGORIES.forEach(function(cat, i) {
    var r = R.catStart + i;
    dashSheet.getRange(r, 1).setValue(cat.name);
    dashSheet.getRange(r, 2).setValue(cat.budget).setNumberFormat('"$"#,##0.00');
    dashSheet.getRange(r, 3)
      .setFormula(
        '=IFERROR(' + sign + 'SUMIFS(\'Raw Data\'!F:F,' +
        '\'Raw Data\'!E:E,"' + cat.name + '",\'Raw Data\'!G:G,' + SEL + '),0)')
      .setNumberFormat('"$"#,##0.00');
    dashSheet.getRange(r, 4)
      .setFormula('=C' + r + '-B' + r)
      .setNumberFormat('"$"#,##0.00');
    dashSheet.getRange(r, 5)
      .setFormula('=IFERROR(C' + r + '/B' + r + ',0)')
      .setNumberFormat("0.00%");
    // Highlight row if over budget
    dashSheet.getRange(r, 1, 1, 5)
      .setBackground(i % 2 === 0 ? "#ffffff" : "#f8f9fa");
  });

  // ── Row 20: TOTAL row ─────────────────────────────────────
  dashSheet.getRange(R.catTotal, 1).setValue("TOTAL").setFontWeight("bold");
  dashSheet.getRange(R.catTotal, 2)
    .setFormula('=SUM(B' + R.catStart + ':B' + R.catEnd + ')')
    .setNumberFormat('"$"#,##0.00').setFontWeight("bold");
  dashSheet.getRange(R.catTotal, 3)
    .setFormula('=SUM(C' + R.catStart + ':C' + R.catEnd + ')')
    .setNumberFormat('"$"#,##0.00').setFontWeight("bold");
  dashSheet.getRange(R.catTotal, 4)
    .setFormula('=C' + R.catTotal + '-B' + R.catTotal)
    .setNumberFormat('"$"#,##0.00').setFontWeight("bold");
  dashSheet.getRange(R.catTotal, 5)
    .setFormula('=IFERROR(C' + R.catTotal + '/B' + R.catTotal + ',0)')
    .setNumberFormat("0.00%").setFontWeight("bold");
  dashSheet.getRange(R.catTotal, 1, 1, 5).setBackground("#e8f0fe");

  // ── Right side: Top Payees QUERY ──────────────────────────
  // FIX: query Raw Data directly with F < 0 filter instead of array literal
  // negation ({(-1)*range}), which was unreliable and caused "No data" errors.
  // Negative amounts are displayed as positive via the number format "$#,##0.00;$#,##0.00".
  var payeeQuery =
    '=IFERROR(QUERY(\'Raw Data\'!A:G,' +
    '"SELECT C, SUM(F) ' +
    'WHERE G=\'"&' + SEL + '&"\' AND C <> \'\' AND F ' + expF +
    ' GROUP BY C ORDER BY SUM(F) ' + expSort + ' LIMIT 10' +
    '"' +
    // headers=0, no LABEL: QUERY outputs data rows only.
    // Row 11 already has "Payee"/"Amount" hardcoded as headers.
    // Having a LABEL with headers=0 was outputting "Payee, Amount" as
    // the first data row (G12/H12), duplicating the header visually.
    ',0),{"No payees found for this month",""})';
  dashSheet.getRange(R.catStart, 7).setFormula(payeeQuery);
  // Show negative expense amounts as positive dollar values
  dashSheet.getRange(R.catStart, 8, 12, 1)
    .setNumberFormat('"$"#,##0.00;"$"#,##0.00');

  // ── Row 22: Monthly totals section header ─────────────────
  dashSheet.getRange(R.monthSectionHeader, 1, 1, 4).merge()
    .setValue("📅 Monthly Spending — All Time")
    .setFontWeight("bold").setFontSize(12).setBackground("#f1f3f4");

  // ── Row 23: Monthly totals QUERY ──────────────────────────
  // FIX: same approach — query Raw Data directly with F < 0 filter.
  // Display with "$#,##0.00;$#,##0.00" so negative expenses show as positive.
  var monthlyQuery =
    '=IFERROR(QUERY(\'Raw Data\'!A:G,' +
    '"SELECT G, SUM(F) ' +
    // MATCHES '20[0-9][0-9]-[0-9][0-9]' replaces G <> '' to exclude garbage
    // rows like "0" (produced when a transaction has a blank date, causing
    // TEXT("","YYYY-MM") to return 0 or an invalid value instead of empty).
    'WHERE G MATCHES \'20[0-9][0-9]-[0-9][0-9]\' AND F ' + expF +
    ' GROUP BY G ORDER BY G DESC' +
    ' LABEL G \'Month\', SUM(F) \'Total Spent\'"' +
    ',0),{"Month","Total Spent"})';
  dashSheet.getRange(R.monthData, 1).setFormula(monthlyQuery);
  dashSheet.getRange(R.monthData, 2, 30, 1)
    .setNumberFormat('"$"#,##0.00;"$"#,##0.00');

  // ── Total Income column next to monthly spending ───────────
  // The QUERY at R.monthData outputs its LABEL row first (row 23: "Month/Total Spent"),
  // then actual data from row 24 onwards — so incRow = R.monthData + 1.
  var incRow = R.monthData + 1;
  dashSheet.getRange(R.monthData, 3).setValue("Total Income").setFontWeight("bold");
  dashSheet.getRange(incRow, 3).setFormula(
    '=ARRAYFORMULA(IF(A' + incRow + ':A' + (incRow + 29) + '="","",IFERROR(' +
    'SUMIFS(\'Raw Data\'!F:F,\'Raw Data\'!G:G,A' + incRow + ':A' + (incRow + 29) + ',' +
    '\'Raw Data\'!F:F,"' + incF + '"),0)))'
  );
  dashSheet.getRange(incRow, 3, 30, 1).setNumberFormat('"$"#,##0.00');

  // ── Chart helper data (columns J–L, rows 2–8) ─────────────
  // This data is used by the line chart. It's tucked away in columns J–L
  // which are outside the visible dashboard area.
  buildChartData_(dashSheet, R, expF, incF);

  // ── Charts section header ─────────────────────────────────
  dashSheet.getRange(R.chartsStart - 1, 1, 1, 8).merge()
    .setValue("📈 Charts")
    .setFontWeight("bold").setFontSize(12).setBackground("#f1f3f4");

  // ── Build the 3 charts ────────────────────────────────────
  buildCharts_(dashSheet, R);

  // ── Populate month dropdown ───────────────────────────────
  refreshMonthDropdown_(dashSheet, rawSheet, rawSheet.getLastRow() - 1);

  ui.alert("✅ Dashboard ready!",
    "Your dashboard has been rebuilt with 3 charts.\n\n" +
    "• Use the B2 dropdown to switch months — all numbers and charts update\n" +
    "• Run '🔄 Update Transactions' each month — everything refreshes\n\n" +
    "⚠️  If spending shows as $0 or negative, check:\n" +
    "  1. Category names in CATEGORIES array match Raw Data exactly\n" +
    "  2. If amounts look wrong, toggle expensesAreNegative in CONFIG",
    ui.ButtonSet.OK);
}

// ─────────────────────────────────────────────────────────────
// BUILD CHART HELPER DATA
// Columns J–L, rows 2–8: month list + spending + income per month.
// Used as the data source for the line chart.
// ─────────────────────────────────────────────────────────────
function buildChartData_(dashSheet, R, expF, incF) {
  var col = R.chartDataCol;  // column J = 10
  var hdr = R.chartDataHeaderRow; // row 2
  var dat = R.chartDataStartRow;  // row 3

  // Grey labels so this area is visually subtle
  var labelStyle = { fontColor: "#aaaaaa", fontSize: 9, fontStyle: "italic" };
  dashSheet.getRange(hdr, col)
    .setValue("Month").setFontColor("#aaaaaa").setFontSize(9).setFontStyle("italic");
  dashSheet.getRange(hdr, col + 1)
    .setValue("Spending").setFontColor("#aaaaaa").setFontSize(9).setFontStyle("italic");
  dashSheet.getRange(hdr, col + 2)
    .setValue("Income").setFontColor("#aaaaaa").setFontSize(9).setFontStyle("italic");

  // Month list: last 6 unique months from Raw Data
  dashSheet.getRange(dat, col).setFormula(
    '=IFERROR(QUERY(\'Raw Data\'!G:G,' +
    '"SELECT G WHERE G <> \'\' GROUP BY G ORDER BY G DESC LIMIT 6"' +
    ',0),{""})'
  );

  // Spending per month: sum of expense amounts (negative → negated → positive)
  // Uses ARRAYFORMULA + SUMIFS so it fills rows 3–8 automatically
  var jRef = 'J' + dat + ':J' + (dat + 5); // J3:J8
  dashSheet.getRange(dat, col + 1).setFormula(
    '=ARRAYFORMULA(IFERROR(' +
    '-SUMIFS(\'Raw Data\'!F:F,\'Raw Data\'!G:G,' + jRef + ',\'Raw Data\'!F:F,"' + expF + '"),0))'
  );

  // Income per month: sum of income amounts (positive in Actual Budget)
  dashSheet.getRange(dat, col + 2).setFormula(
    '=ARRAYFORMULA(IFERROR(' +
    'SUMIFS(\'Raw Data\'!F:F,\'Raw Data\'!G:G,' + jRef + ',\'Raw Data\'!F:F,"' + incF + '"),0))'
  );

  dashSheet.getRange(dat, col + 1, 6, 2).setNumberFormat('"$"#,##0.00');
}

// ─────────────────────────────────────────────────────────────
// BUILD CHARTS
// Creates 3 charts. Charts reference fixed cell ranges and auto-update
// when those ranges change — no need to rebuild after each data refresh.
// ─────────────────────────────────────────────────────────────
function buildCharts_(dashSheet, R) {
  // Remove any previously created charts
  dashSheet.getCharts().forEach(function(c) { dashSheet.removeChart(c); });

  var cs = R.chartsStart; // first row of charts section

  // ── Chart 1: Budget vs Actual (column/bar chart) ──────────
  // Data: A11:C19 (Category | Budget | Actual), 1 header row
  var barChart = dashSheet.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(dashSheet.getRange(R.catColHeader, 1, CATEGORIES.length + 1, 3))
    .setNumHeaders(1)
    .setOption('title', 'Budget vs Actual')
    .setOption('width', 480)
    .setOption('height', 300)
    .setOption('colors', ['#4a86e8', '#ea4335'])
    .setOption('vAxis.title', 'Amount ($)')
    .setOption('legend.position', 'top')
    .setOption('bar.groupWidth', '70%')
    .setPosition(cs, 1, 0, 10)
    .build();
  dashSheet.insertChart(barChart);

  // ── Chart 2: Spending breakdown (pie chart) ───────────────
  // Data: category names (col A) + actual spending (col C), rows 11–19
  var pieChart = dashSheet.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(dashSheet.getRange(R.catColHeader, 1, CATEGORIES.length + 1, 1)) // A11:A19 labels
    .addRange(dashSheet.getRange(R.catColHeader, 3, CATEGORIES.length + 1, 1)) // C11:C19 actuals
    .setNumHeaders(1)
    .setOption('title', 'Spending Breakdown')
    .setOption('width', 380)
    .setOption('height', 300)
    .setOption('legend.position', 'right')
    .setOption('pieSliceText', 'percentage')
    .setPosition(cs, 7, 0, 10)
    .build();
  dashSheet.insertChart(pieChart);

  // ── Chart 3: Monthly spending vs income (line chart) ──────
  // Data: J2:L8 — Month (col J) | Spending (col K) | Income (col L)
  // Last 6 months, with spending and income as two separate lines.
  var lineChart = dashSheet.newChart()
    .setChartType(Charts.ChartType.LINE)
    .addRange(dashSheet.getRange(R.chartDataHeaderRow, R.chartDataCol, 7, 3)) // J2:L8
    .setNumHeaders(1)
    .setOption('title', 'Spending vs Income — Last 6 Months')
    .setOption('width', 860)
    .setOption('height', 300)
    .setOption('colors', ['#ea4335', '#34a853'])
    .setOption('curveType', 'function')
    .setOption('vAxis.title', 'Amount ($)')
    .setOption('legend.position', 'top')
    .setPosition(cs + 16, 1, 0, 10)
    .build();
  dashSheet.insertChart(lineChart);
}

// ─────────────────────────────────────────────────────────────
// REFRESH MONTH DROPDOWN
// ─────────────────────────────────────────────────────────────
function refreshMonthDropdown_(dashSheet, rawSheet, dataRowCount) {
  if (!dashSheet || !rawSheet || dataRowCount < 1) return;

  var monthData = rawSheet.getRange(2, CONFIG.monthColumn, dataRowCount, 1).getValues();
  var seen = {};
  monthData.forEach(function(r) { if (r[0]) seen[r[0]] = true; });
  var months = Object.keys(seen).sort().reverse();
  if (months.length === 0) return;

  var cell = dashSheet.getRange(2, 2);
  cell.setNumberFormat("@"); // force text — prevents date auto-conversion
  cell.setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(months, true)
      .setAllowInvalid(true)
      .build()
  );
  cell.setValue(months[0]);
}

// ─────────────────────────────────────────────────────────────
// HELP
// ─────────────────────────────────────────────────────────────
function showHelp() {
  SpreadsheetApp.getUi().alert(
    "ℹ️ How to use Budget Tools",
    "── Monthly update ───────────────────────────────────\n" +
    "1. Export All-Accounts.csv from Actual Budget\n" +
    "2. Upload it to the 'Budget Uploads' folder in Google Drive\n" +
    "3. Click: 💰 Budget Tools → 🔄 Update Transactions\n\n" +
    "── First-time setup ─────────────────────────────────\n" +
    "1. Run 'Update Transactions' first\n" +
    "2. Run '🛠️ Setup Dashboard' to build the dashboard + charts\n" +
    "   (only needed once — or to fully reset)\n\n" +
    "── Switching months ──────────────────────────────────\n" +
    "Pick a month from the B2 dropdown.\n" +
    "Numbers + charts update instantly.",
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}
