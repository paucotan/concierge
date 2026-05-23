# Budget Export Automation Plan

## Goal
Automate the manual workflow of exporting transactions from Actual Budget and uploading the CSV to Google Drive, so the Google Sheets dashboard can be updated without manual steps.

## Current Manual Workflow
1. Open Actual Budget (localhost:5007)
2. Go to All Accounts → Export
3. Save `All-Accounts.csv`
4. Manually upload to Google Drive (`Budget Uploads` folder)
5. Run "🔄 Update Transactions" in the Google Sheet

## Proposed Automated Workflow
1. Run a single script (or cron job)
2. Script exports transactions from Actual via API
3. Script uploads CSV directly to Google Drive
4. Open Google Sheet and run "🔄 Update Transactions" (or trigger via Apps Script)

## Implementation Plan

### Stack
- **Node.js** script
- `@actual-app/api` — official Actual Budget npm package for local access
- Google Drive API (via service account or OAuth) — for uploading the CSV

### Steps to Build
1. Set up `@actual-app/api` and connect to local Actual instance (`localhost:5007`)
2. Query all transactions and export as CSV matching the current `All-Accounts.csv` format
3. Set up Google Drive API credentials (service account recommended for automation)
4. Upload CSV to the `Budget Uploads` folder on Drive, overwriting the existing file
5. (Optional) Trigger "Update Transactions" automatically via Google Apps Script HTTP endpoint

### Notes
- Actual Budget is self-hosted at `http://localhost:5007`
- CSV columns: Account, Date, Payee, Notes, Category, Amount, Split_Amount, Cleared
- Google Drive folder name: `Budget Uploads`
- CSV filename must stay: `All-Accounts.csv`

## TODO
- [ ] Explore `@actual-app/api` docs and available export methods
- [ ] Decide on Google Drive auth method (service account vs OAuth)
- [ ] Write the Node.js script
- [ ] Test CSV format matches what the Google Sheet expects
- [ ] (Optional) Set up as a monthly cron job
