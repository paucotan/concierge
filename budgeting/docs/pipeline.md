# Pipeline — How the Budget System Works

---

## Tools Involved

| Tool | Role | Where |
|---|---|---|
| **SimpleFIN Bridge** | Syncs bank transactions into Actual | simplefin.org (web + API) |
| **Actual Budget** | Source of truth — transaction ledger, categories, budgets | `localhost:5007` |
| **export.js** | Node script: exports CSV from Actual, uploads to Google Drive | `scripts/export.js` |
| **Google Drive** | Stores the CSV between Actual and Google Sheets | `Budget Uploads` folder |
| **budget-updater.gs** | Google Apps Script: reads CSV, rebuilds dashboard | Pasted into Google Sheet → Apps Script |
| **Google Sheet** | Dashboard with spending vs budget by category + month | Google Drive |

---

## Current Flow (as of March 2026)

```
Banks (BMO + Vancity)
       │
       ▼ SimpleFIN Bridge (auto-sync every 24h)
Actual Budget (localhost:5007)
       │
       ├─ [MANUAL] Fix Vancity bridge if broken (2FA email code, ~2 min)
       ├─ [MANUAL] Press Sync in Actual
       └─ [MANUAL] Review + categorize uncategorized transactions (~7–15, ~10 min)
       │
       ▼ Mouse button shortcut triggers export.js
export.js (Node)
       ├─ Connects to Actual API
       ├─ Exports all transactions → All-Accounts.csv
       └─ Uploads to Google Drive (Budget Uploads/All-Accounts.csv)
       │
       ▼ [MANUAL] Open Google Sheet → 💰 Budget Tools → 🔄 Update Transactions
budget-updater.gs (Apps Script)
       ├─ Reads All-Accounts.csv from Drive
       ├─ Pastes into Raw Data sheet
       └─ Rebuilds Dashboard tab (spending vs budget by category + month)
```

**Cadence:** Every ~2 weeks

---

## SimpleFIN API Notes

SimpleFIN exposes a `GET /accounts` endpoint (Basic Auth with ACCESS_URL) that returns accounts + transactions. Crucially, each account has an `errors` array — if Vancity's connection is broken, an error string will appear there. This lets Trigger 1 check programmatically whether the fix page needs to be opened, rather than always interrupting the user.

- Endpoint: `GET {ACCESS_URL}/accounts`
- Auth: Basic Auth (username:password embedded in ACCESS_URL)
- Rate limit: max ~24 requests/day
- Error detection: check `data.accounts[].errors` — useful for confirming Vancity fix succeeded (errors clear once 2FA is completed), not for deciding whether to show the fix page (Vancity always needs it)
- ACCESS_URL setup: `https://bridge.simplefin.org/simplefin/create` → Actual may already store this internally

---

## Hard Constraints (cannot be automated)

- **Vancity 2FA:** Vancity requires an email 2FA code on **every single sync** — this is a bank-level security requirement, not a connection issue. It will always need manual intervention. Cannot be automated.
- **Transaction categorization:** Requires user's judgment. Actual rules reduce volume significantly but can't replace human review entirely.

---

## Planned Improvements

### Two-Trigger Flow
Replace the current multi-step manual process with two clean trigger points:

**Trigger 1 — "Start sync" button:**
- Auto-opens SimpleFIN in browser at the accounts page (Vancity is front and center)
- User clicks Fix, waits for 2FA, enters code
- Optional: script monitors SimpleFIN status and auto-opens Actual when Vancity goes green
- User syncs + categorizes in Actual

**Trigger 2 — "Done categorizing" button (same or second shortcut):**
- Calls Actual API → exports CSV (export.js already handles this)
- Uploads to Google Drive
- Triggers Google Sheet dashboard refresh (via Apps Script HTTP endpoint)
- Telegram bot reads fresh data, fires alerts if needed

### Telegram Bot
- Runs as background process on the local machine (Python)
- Fires after Trigger 2: checks each category against budget limits
  - ⚠️ at 80% of budget
  - 🚨 when over (shows exact overage)
  - Silent if all good
- Weekly digest every Sunday morning (independent of pipeline trigger)
- Budget limits stored in `config.json` for easy editing

---

## File Locations

```
budgeting/
├── All-Accounts.csv              ← latest export, updated by export.js
├── scripts/
│   ├── export.js                 ← main pipeline script (Actual → Drive)
│   ├── budget-updater.gs         ← paste into Google Sheet Apps Script
│   ├── .env                      ← ACTUAL_SERVER_URL, ACTUAL_PASSWORD, ACTUAL_SYNC_ID, GDRIVE_FOLDER_ID
│   └── service-account.json      ← Google Drive API credentials
└── docs/
    └── pipeline.md               ← this file
```

---

## Notes

- Actual API requires the app to be running at `localhost:5007`
- The VM/sandbox cannot reach `localhost:5007` — use the CSV for analysis instead
- `expensesAreNegative: true` in budget-updater.gs — spending shows as negative in Actual's export
- Category names must match exactly between Actual, CSV, and budget-updater.gs CATEGORIES array
- Google Drive folder ID: `1DaN6iGoWghs_eC0LoOYwfzC1b9N-H3A9`
