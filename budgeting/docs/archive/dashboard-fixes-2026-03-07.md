# Budget Dashboard Fixes - March 7, 2026

## 🐛 Bugs Fixed

1. **Income column showing $1,959.50 for all months**
   - **Issue**: ARRAYFORMULA + SUMIFS doesn't work with array criteria
   - **Fix**: Used QUERY with INDEX to calculate actual income per month
   - **Filter**: `E = 'Income'` (excludes transfers between accounts)

2. **Top Payees showing "sum" instead of amounts**
   - **Issue**: QUERY outputting aggregate function name
   - **Fix**: Added explicit LABEL clause

3. **Spending vs Income chart missing X-axis labels**
   - **Issue**: Chart data in wrong order + missing month labels
   - **Fix**: Reversed sort order (ASC for chronological display)
   - **Fix**: Chart data now references main table (single source of truth)

4. **Spending values too high (counting transfers)**
   - **Issue**: Counting all negative amounts including transfers to savings/investments
   - **Fix**: Exclude non-expense categories: Income, Savings, Starting Balances

5. **Chart lines going opposite directions (unintuitive)**
   - **Issue**: Spending showing as negative values (below axis)
   - **Fix**: Use ABS() to show both spending and income as positive for visual comparison

## ✨ Improvements

- **Trimmed empty rows**: 30 months → 12 months (cleaner sheet)
- **Hidden columns J, K, L**: Chart helper data no longer visible
- **Single source of truth**: Chart references main table instead of duplicate queries
- **Better data alignment**: Month/Spending/Income always match

## 📊 Key Changes

### Income Formula (excludes transfers)
```javascript
WHERE E = 'Income'  // Only count salary/tax refunds, not account transfers
```

### Spending Formula (excludes transfers)
```javascript
WHERE E<>'Income' AND E<>'Savings' AND E<>'Starting Balances'
// Includes: Bills, Food, Shopping, Health, Donation, General, Bitcoin, Cash/ATM
```

### Chart Data
- References main table (A24:C29) instead of separate queries
- Sorted ASC (oldest→newest) for chronological visualization
- Spending uses ABS() to show as positive values

## 🚀 Usage

### Update Transactions
**💰 Budget Tools → 🔄 Update Transactions**
- Run monthly after exporting CSV from Actual Budget
- Upload to "Budget Uploads" folder in Google Drive

### Rebuild Dashboard
**💰 Budget Tools → 🛠️ Setup Dashboard**
- Run after script changes
- Rebuilds charts and formulas

### Switch Months
Use B2 dropdown to select different months - all charts/tables update automatically

## 📁 Files

- **Script**: `~/Documents/gws-automation/budget-updater.md`
- **Sheet**: [Budget Dashboard 2026](https://docs.google.com/spreadsheets/d/1lUbW2ygV-KzoFMd5lDGxlqisGnrEMkFQpwKobp74YCY/edit)
- **CSV Source**: `~/Documents/budgeting/all-accounts.csv`

## 🎯 Result

- ✅ Accurate income tracking (salary + tax refunds only)
- ✅ Accurate spending (expenses only, no transfers)
- ✅ Working "Spending vs Income" chart with month labels
- ✅ Visual comparison (both lines go upward, easy to spot surplus/deficit)
