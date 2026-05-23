# Google Sheets Dashboard Setup Guide

**Goal:** Create a comprehensive budgeting dashboard to visualize spending, track budget vs. actual, identify trends, and analyze top merchants.

**Time estimate:** 45-60 minutes for first setup (faster for monthly updates)

---

## Step 1: Create New Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com)
2. Click **+ Blank** to create new spreadsheet
3. Rename it: **"Budget Dashboard 2026"**

---

## Step 2: Import Your Transaction Data

1. Click on **Sheet1** tab at bottom, rename it to **"Raw Data"**
2. Go to **File → Import → Upload**
3. Select your `All-Accounts.csv` file
4. In the import dialog:
   - Import location: **"Replace current sheet"**
   - Separator type: **"Comma"**
   - Convert text to numbers: **Yes**
5. Click **Import data**

**Result:** You should now see 8 columns (Account, Date, Payee, Notes, Category, Amount, Split_Amount, Cleared)

---

## Step 3: Clean Up the Data

### 3.1 Format the Date Column
1. Select column B (Date)
2. Click **Format → Number → Date**

### 3.2 Format the Amount Column
1. Select column F (Amount)
2. Click **Format → Number → Currency**

### 3.3 Add a Month Column (for trend analysis)
1. Click on column G header (between Amount and Split_Amount)
2. Right-click → **Insert 1 column left**
3. In cell **G1**, type: **Month**
4. In cell **G2**, paste this formula:
   ```
   =TEXT(B2,"YYYY-MM")
   ```
5. Copy this formula down to all rows (double-click the small blue square at bottom-right of G2)

### 3.4 Filter Out Zero/Internal Transfers (Optional)
If you want cleaner data, you can filter out $0 amounts and internal transfers:
1. Select all data (Ctrl/Cmd + A)
2. Click **Data → Create a filter**
3. Click filter icon on **Category** column (column E)
4. Uncheck blank/empty categories if they exist
5. Click filter icon on **Amount** column (column F)
6. Uncheck $0.00 if you want to exclude it

---

## Step 4: Set Up Budget Reference Table

Create a reference table for your budget targets so formulas can use them.

1. Create a new sheet: Click **+** at bottom, name it **"Budget Targets"**
2. Set up this table:

| Category | Monthly Budget |
|----------|----------------|
| Bills | 600 |
| Bills (Flexible) | 100 |
| Food | 700 |
| Shopping | 300 |
| Health | 100 |
| Donation | 100 |
| General | 100 |
| Bitcoin | 550 |

3. Format column B as currency

---

## Step 5: Create Pivot Table - Category Spending

This will show total spending by category.

1. Go back to **"Raw Data"** sheet
2. Click any cell in your data
3. Go to **Insert → Pivot table**
4. Create pivot table in: **New sheet**
5. Click **Create**
6. Rename this new sheet to **"Pivot - Category"**

**Configure the pivot table:**
- **Rows:** Add "Category"
- **Values:** Add "Amount"
  - Click on it → **Summarize by: SUM**
  - Click again → **Show as: Default**
- **Filters:** Add these filters to clean up your data:
  1. **Amount filter:**
     - Click **Add** in Filters section → Select "Amount"
     - Filter by condition: **Less than 0** (shows only expenses, not income)
  2. **Category filter (remove blanks):**
     - Click **Add** in Filters section → Select "Category"
     - In the dropdown, **uncheck (Blanks)** - these are internal transfers
  3. **Month filter (optional but recommended):**
     - Click **Add** in Filters section → Select "Month"
     - This lets you view specific months (e.g., "2026-01" for January only)

**Result:** You should see total spending by category, excluding transfers and blank categories

---

## Step 6: Create Pivot Table - Monthly Trends

This tracks spending over time by category.

1. Go to **"Raw Data"** sheet
2. Insert another pivot table (**Insert → Pivot table → New sheet**)
3. Rename sheet to **"Pivot - Monthly Trends"**

**Configure the pivot table:**
- **Rows:** Add "Month" (the column you created)
- **Columns:** Add "Category"
- **Values:** Add "Amount"
  - Summarize by: **SUM**
- **Filters:** Add these filters:
  1. **Amount filter:**
     - Filter by condition: **Less than 0** (expenses only)
  2. **Payee filter (remove internal transfers):**
     - Click **Add** → Select "Payee"
     - **Uncheck** all bank account names (same as you did for Top Payees):
       - BMO Personal Chequing
       - BMO Personal Savings
       - BMO MasterCard
       - Vancity enviro Visa
       - Joint BMO Chequing
       - Starting Balance
       - Balance Adjustment
     - This is important! Without this filter, internal transfers may inflate your category totals
  3. **Category filter (optional):**
     - Exclude blanks if you want cleaner data

**Why filter Payees here?** Actual Budget exports both sides of internal transfers (e.g., -$250 from Checking to Visa AND +$250 from Visa to Checking). If these have categories assigned, they'll inflate your spending numbers. Filtering out bank account payees ensures you only see real merchant spending.

**Result:** Matrix showing TRUE spending by category each month (excluding internal transfers)

---

## Step 7: Create Pivot Table - Top Payees

This shows where you spend most frequently.

1. Go to **"Raw Data"** sheet
2. Insert another pivot table (**Insert → Pivot table → New sheet**)
3. Rename sheet to **"Pivot - Top Payees"**

**Configure the pivot table:**
- **Rows:** Add "Payee"
- **Values:** Add "Amount"
  - Summarize by: **SUM**
- **Filters:** Add these filters:
  1. **Amount filter:**
     - Filter by condition: **Less than 0** (expenses only)
  2. **Payee filter (remove bank accounts/transfers):**
     - Click **Add** → Select "Payee"
     - **Uncheck** all bank accounts and system entries:
       - BMO Personal Chequing
       - BMO Personal Savings
       - BMO MasterCard
       - Vancity enviro Visa
       - Joint BMO Chequing
       - Starting Balance
       - Balance Adjustment
     - This shows only real merchants where you spend money
  3. **Month filter (optional):**
     - Add "Month" to see specific months
  4. **Category filter (optional):**
     - Add "Category" to focus on specific categories (like "Food")
- **Sort:** Click on "SUM of Amount" column
  - Sort by: **SUM of Amount**
  - Order: **Ascending** (most negative = highest spending first)

**Result:** Ranked list of real merchants you spend most with (Amazon, Tim Hortons, grocery stores, etc.)

---

## Step 8: Create Dashboard Sheet

Now let's build the actual dashboard that pulls everything together.

1. Create new sheet, name it **"Dashboard"**
2. At the top, add a title and date:
   - **A1:** `Budget Dashboard`
   - **A2:** `Last updated: [today's date]`
   - Format as bold, increase font size

### 8.1 Add Key Metrics Summary (Rows 4-7)

Before creating the budget table, add summary metrics at the top:

**In row 4:**
- **A4:** `Total Spent This Month:`
- **B4:** `=SUM(C11:C18)` (we'll create the table below, so this references future cells)

**In row 5:**
- **A5:** `Total Budgeted:`
- **B5:** `=SUM(B11:B18)`

**In row 6:**
- **A6:** `Over/Under Budget:`
- **B6:** `=B4-B5` (positive = over budget, negative = under budget)

**In row 7:**
- **A7:** `Savings Rate:`
- **B7:** `=ABS(C18)/5500` (ABS converts negative to positive; 5500 is monthly income)
- Format **B7** as **Percentage** (Format → Number → Percent)

Format cells B4:B7 with **bold text** and **larger font** (14-16pt) to make them stand out.

### 8.2 Budget vs. Actual Summary Table

Create the comparison table starting at row 10:

**Row 10 (Headers):**
- **A10:** `Category`
- **B10:** `Budget`
- **C10:** `Actual`
- **D10:** `Variance`
- **E10:** `% of Budget`

**Starting at Row 11, list your categories:**
- A11: `Bills`
- A12: `Bills (Flexible) Subscriptions`
- A13: `Food`
- A14: `Shopping`
- A15: `Health`
- A16: `Donation`
- A17: `General`
- A18: `Bitcoin`

**Column B - Budget (pull from Budget Targets sheet):**
In **B11**, enter:
```
=VLOOKUP(A11,'Budget Targets'!$A$2:$B$9,2,FALSE)
```
Copy this down to B18.

**Column C - Actual (pull from Category Pivot):**
In **C11**, enter:
```
=IFERROR(-VLOOKUP(A11,'Pivot - Category'!$A:$B,2,FALSE),0)
```
(Note: The negative sign converts expenses from negative to positive for easier reading)
Copy this down to C18.

**Column D - Variance:**
In **D11**, enter:
```
=C11-B11
```
Copy down to D18.

**Column E - % of Budget:**
In **E11**, enter:
```
=IF(B11=0,0,C11/B11)
```
Copy down to E18. Then format column E as **Percentage** (Format → Number → Percent).

**Add Conditional Formatting:**
1. Select **D11:D18** (Variance column)
2. Click **Format → Conditional formatting**
3. Format rules:
   - **Less than 0** → Green fill (under budget)
   - Add another rule: **Greater than 0** → Red fill (over budget)

**Note:** Bitcoin will show red (over budget) but that's actually GOOD - you're saving more than planned!

### 8.3 Add Total Row

In **row 19**, add totals:
- **A19:** `TOTAL` (bold)
- **B19:** `=SUM(B11:B18)` → Shows $2,550.00
- **C19:** `=SUM(C11:C18)` → Shows total spent
- **D19:** `=SUM(D11:D18)` → Shows total variance
- **E19:** `=C19/B19` → Format as percentage

Format row 19 with **bold text** and a **top border** to distinguish it as the total row.

---

## Step 9: Create Charts

### Chart 1: Category Spending (Bar Chart)

1. Select your **Budget vs. Actual table** (A10:C18 - just categories, budget, and actual)
2. Click **Insert → Chart**
3. In Chart editor:
   - Chart type: **Combo chart** or **Column chart**
   - X-axis: Category
   - Series: Budget and Actual
4. Customize:
   - Chart title: "Budget vs. Actual by Category"
   - Legend position: Bottom
5. Move chart to a good spot on your Dashboard sheet

### Chart 2: Category Breakdown (Pie Chart)

1. Select just the Category and Actual columns (**A10:A18** and **C10:C18**)
2. Hold Ctrl/Cmd and select both ranges
3. Click **Insert → Chart**
4. Chart type: **Pie chart**
5. Customize:
   - Title: "Spending Breakdown"
   - Show percentage labels
6. Position on dashboard

### Chart 3: Monthly Spending Trends (Line Chart)

1. Go to **"Pivot - Monthly Trends"** sheet
2. Select all the data (including headers)
3. Click **Insert → Chart**
4. Chart type: **Line chart**
5. Customize:
   - Title: "Monthly Spending Trends by Category"
   - X-axis: Month
   - Y-axis: Amount spent
   - Legend: Right side
6. Click the three dots → **Move to sheet** → Select "Dashboard"

### Chart 4: Top 10 Merchants (Bar Chart)

1. Go to **"Pivot - Top Payees"** sheet
2. Select the **top 10 rows** (Payee name and Amount)
3. Click **Insert → Chart**
4. Chart type: **Bar chart** (horizontal bars)
5. Customize:
   - Title: "Top 10 Spending: Where You Shop Most"
   - Flip the amounts to positive (in chart editor, check "Reverse axis")
6. Move to Dashboard sheet

---

## Step 10: Final Dashboard Polish

Your dashboard is now functionally complete! Here are some final touches:

### 10.1 Format the Key Metrics Section
Make the summary metrics (rows 4-7) stand out:
- Select **B4:B7**
- Apply **bold formatting**
- Increase font size to **14-16pt**
- Add background color (light blue or gray)
- Add borders around the section

### 10.2 Format Currency Properly
Ensure all currency cells display correctly:
- Select all Budget, Actual, and Variance columns
- Format → Number → Currency (with 2 decimal places)

### 10.3 Adjust Column Widths
- **Column A:** Wide enough for category names (~250px)
- **Columns B-E:** Equal width (~120px each)

### 10.4 Add Visual Separation
- Add a thick border between row 9 and row 10 (separates metrics from table)
- Add a thick border at row 19 (highlights total row)

---

## Step 11: Final Touches & Protection

1. **Freeze header rows:**
   - Select row 10 (the table header row)
   - Click **View → Freeze → Up to row 10**
   - This keeps your metrics and headers visible when scrolling

2. **Protect the Raw Data sheet:**
   - Right-click "Raw Data" tab
   - Click **Protect sheet**
   - This prevents accidental edits

3. **Organize sheet tabs:**
   - Drag "Dashboard" to the front (leftmost position)
   - Order: Dashboard → Budget Targets → Raw Data → Pivot tables

4. **Add update instructions:**
   - In cell A21 (below your table), add:
     - "To update: Import new CSV to Raw Data sheet → Refresh all pivot tables (Data → Refresh)"
   - Format as italic, smaller font

---

## Monthly Update Process

**Time required: 3-5 minutes**

When you want to update with new data at the end of each month:

### Step 1: Export from Actual Budget
- Export all transactions as CSV
- Save as `All-Accounts.csv`

### Step 2: Import to Google Sheets
1. Open your Budget Dashboard Google Sheet
2. Go to **"Raw Data"** tab
3. Click **File → Import → Upload**
4. Select your new CSV file
5. Import location: **"Replace current sheet"**
6. Click **Import data**

⚠️ **Important:** This will completely replace the Raw Data sheet, including the Month column you created. This is expected - you'll recreate it in the next step.

### Step 3: Re-create the Month Column (30 seconds)
1. Click on column **G header** (the column between Amount and Split_Amount)
2. Right-click → **Insert 1 column left**
3. In cell **G1**, type: `Month`
4. In cell **G2**, paste this formula: `=TEXT(B2,"YYYY-MM")`
5. **Double-click** the small blue square at bottom-right of cell G2
   - This auto-fills the formula down to all rows

💡 **Pro tip:** Keep this formula saved in a note or in your Dashboard sheet so you can quickly copy/paste it each month!

### Step 4: Refresh All Pivot Tables (1 minute)
Visit each pivot table sheet and refresh the data:

1. Go to **"Pivot - Category"** sheet
   - Click anywhere in the pivot table
   - Click **Data → Pivot table → Refresh**

2. Go to **"Pivot - Monthly Trends"** sheet
   - Click anywhere in the pivot table
   - Click **Data → Pivot table → Refresh**

3. Go to **"Pivot - Top Payees"** sheet
   - Click anywhere in the pivot table
   - Click **Data → Pivot table → Refresh**

### Step 5: Update Month Filters & Review Dashboard
1. On each pivot table, update the **Month filter** to show current month (e.g., "2026-02")
2. Go to **Dashboard** sheet
3. Update the "Last updated" date in cell A2
4. Review your numbers - everything should auto-update!

---

### Alternative: Preserve Month Column (Advanced)

If you don't want to recreate the Month column each time:

**Method: Import to Temp Sheet First**
1. Import CSV to a **new sheet** (instead of replacing Raw Data)
2. Add Month column to this temp sheet
3. Select all data in temp sheet → Copy
4. Go to Raw Data sheet → Select cell A1 → Paste
5. Delete the temp sheet

This preserves any manual adjustments but takes a bit longer.

---

## Tips & Tricks

- **Filter by Month:** Add a dropdown filter on your Dashboard to view specific months
- **Create Monthly Snapshots:** Duplicate your dashboard sheet each month to preserve history
- **Set up Data Validation:** Lock down categories to prevent typos in Actual Budget
- **Color Code:** Use consistent colors (red for overspending, green for savings)
- **Mobile Access:** Google Sheets app works great for checking dashboard on-the-go

---

## Troubleshooting

**Pivot table shows #REF! error:**
- Refresh the pivot: Data → Refresh

**Formulas show #N/A:**
- Check that category names match exactly between sheets (case-sensitive)
- Make sure "Bills (Flexible)" matches exactly in all sheets

**Charts look weird:**
- Make sure amounts are formatted as currency/numbers, not text

**Can't see recent data:**
- Remember to refresh all pivot tables after importing new CSV

**Pivot shows blank category with huge amount:**
- This is normal - those are internal transfers between your accounts
- Filter out blanks using the Category filter (see Step 5)

**Top Payees shows bank accounts instead of merchants:**
- Add Payee filter to exclude bank account names (see Step 7)
- This will reveal your real spending at merchants

**Savings Rate shows huge negative percentage:**
- Make sure you're using `=ABS(C18)/5500` (the ABS function is critical!)
- Bitcoin/savings amounts are negative in the data, ABS converts to positive

**Total Budgeted shows only $550 instead of $2,550:**
- Check that your formula is `=SUM(B11:B18)` not just pointing to one cell
- Verify the formula range includes all 8 categories

---

## Understanding Your Dashboard Data

### Reading the Variance Column
- **Green (negative numbers):** Under budget - you spent LESS than planned ✅
- **Red (positive numbers):** Over budget - you spent MORE than planned 🔴
- **Exception:** Bitcoin showing red is actually GOOD - you saved more than your 10% goal!

### Interpreting % of Budget
- **100%** = Exactly on budget
- **< 100%** = Under budget (e.g., 99.68% = spent $0.32 less)
- **> 100%** = Over budget (e.g., 211% = spent 2.11x your budget)

### Common Insights to Look For
1. **Food category over 150%?** Check Top Payees for restaurant frequency
2. **High Health percentage?** Look for subscription services (BetterHelp, gym, etc.)
3. **Bitcoin over 100%?** Celebrate! You're saving more than planned
4. **Shopping spikes?** Filter by month to see if it's a one-time gift month
5. **General under budget?** This is your buffer category - good to have extra

---

## Next Steps

Once you're comfortable with this dashboard:
- **Filter by Month:** Use the Month filter on pivots to compare January vs. February
- **Food Deep Dive:** Create a filtered Top Payees view for just Food category to track Tim Hortons
- **Emergency Fund Tracker:** Add a section tracking progress toward your $2,500 goal
- **Monthly Snapshots:** Duplicate your Dashboard sheet at month-end to preserve history
- **Automate Updates:** Consider Google Apps Script for automated CSV imports (advanced)

---

**Questions or issues?** Check the formulas in each cell - they're all designed to be simple and understandable. Good luck with your dashboard! 🎉
