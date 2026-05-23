# Budget Dashboard Auto-Update — Setup Guide

## The Problem (and Fix)

Every time you imported a new CSV, Google Sheets treated it as a brand new sheet, breaking all your pivot table references. This script fixes that by **never replacing the sheet** — it only refreshes the data *inside* it.

---

## One-Time Setup (takes ~5 minutes)

### Step 1 — Create a Google Drive folder

1. Go to [drive.google.com](https://drive.google.com)
2. Create a new folder called exactly: **`Budget Uploads`**
3. Upload your current `All-Accounts.csv` into that folder

---

### Step 2 — Open the Apps Script editor

1. Open your Budget Google Sheet
2. Click **Extensions** in the top menu
3. Click **Apps Script**
4. You'll see a code editor with a default function — **delete everything** in it

---

### Step 3 — Paste the script

1. Open the file `budget-updater.gs` (provided alongside this guide)
2. Copy the entire contents
3. Paste it into the Apps Script editor
4. Click the 💾 **Save** button (or Ctrl+S / Cmd+S)
5. Name the project something like `Budget Updater` when prompted

---

### Step 4 — Run it for the first time (grants permissions)

1. In the Apps Script editor, select `onOpen` from the function dropdown
2. Click the ▶ **Run** button
3. Google will ask you to **review permissions** — click through:
   - "Review permissions" → choose your Google account → "Advanced" → "Go to Budget Updater (unsafe)" → **Allow**
   - This is normal for first-time scripts you write yourself
4. Close the Apps Script tab and go back to your sheet
5. **Refresh the sheet** — you should now see a "💰 Budget Tools" menu in the top bar

---

### Step 5 — Test it

1. Click **💰 Budget Tools → 🔄 Update Transactions**
2. Wait a few seconds
3. You should see: *"✅ Done! X transactions loaded"*
4. Check that your pivot tables and dashboard updated correctly

---

## Monthly Workflow (going forward)

Every month, your entire process is now:

1. **Export** `All-Accounts.csv` from Actual Budget
2. **Upload** it to the `Budget Uploads` folder in Google Drive
   *(just drag and drop the new file — replace the old one)*
3. In your Google Sheet, click **💰 Budget Tools → 🔄 Update Transactions**
4. Done ✅

No more broken pivot tables. No more rebuilding the dashboard.

---

## About your custom formatting

The script is smart about extra columns:
- **Column widths, colors, bold text** → preserved ✅
- **Extra columns you've added to the RIGHT of the CSV columns** → preserved ✅
- **Manually edited values within the CSV columns** → will be overwritten ⚠️

If you're manually editing category names or adding notes inside the Raw Data columns, consider moving those customizations to a second sheet ("Processed Data") that uses formulas to reference Raw Data — that way your edits are always safe. Ask Claude to help set that up if needed.

---

## Troubleshooting

| Error message | Fix |
|---|---|
| "Sheet not found" | Make sure your sheet is named exactly `Raw Data` (check capitalisation) |
| "Folder not found" | Create a folder called `Budget Uploads` in Google Drive |
| "CSV not found" | Make sure the file is named exactly `All-Accounts.csv` |
| Menu doesn't appear | Refresh the sheet, or re-run the `onOpen` function from Apps Script |
| Pivot tables still broken | Your pivot tables may be pointing at the old imported sheet — update them to point at `Raw Data` |

---

## Customising the script

At the top of `budget-updater.gs` there's a `CONFIG` block:

```js
var CONFIG = {
  driveFolderName: "Budget Uploads",   // Change if you name the folder differently
  csvFileName:     "All-Accounts.csv", // Change if your export has a different name
  dataSheetName:   "Raw Data",         // Change if your sheet has a different name
};
```

You only need to edit these three values if anything differs from the defaults.
