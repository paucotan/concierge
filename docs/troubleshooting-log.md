# Troubleshooting Log: Concierge Dashboard & Actual Budget Sync

**Timestamp:** 2026-05-02 12:11:46

## Issue 1: Backend Connection Failure (Port 5008)
**Symptom:** The Concierge dashboard gave `ERR_CONNECTION_REFUSED`. Backend logs showed `Failed to connect to Actual: Could not get remote files` or `Error: out-of-sync-migrations`.

**Root Cause:**
The `@actual-app/api` library version in the budgeting scripts was older than the version of Actual Budget that last migrated the budget file. This prevented the API from handshaking with the server.

**Fix:**
- Navigated to `~/Documents/budgeting/scripts`.
- Ran `npm install @actual-app/api@latest` to upgrade the library (to version `26.4.0`).
- Cleared the local cache at `~/Documents/budgeting/scripts/.actual-cache` to force a fresh sync.

---

## Issue 2: Browser Redirect / Wrong Dashboard
**Symptom:** Visiting `localhost:5008` redirected to `/budget` and showed the standard Actual Budget UI (with sync errors) instead of the custom Concierge Dashboard.

**Root Cause:**
A **Service Worker conflict**. The standard Actual Budget web app (which runs on port 5007) had previously been accessed on port 5008. Its Service Worker was still registered in the browser for `localhost:5008`, intercepting all requests and serving the cached Actual UI instead of hitting the Concierge backend.

**Fix:**
- Opened `localhost:5008` in the browser.
- Opened Developer Tools -> **Application** (or Storage) tab.
- Selected **Service Workers** and clicked **Unregister** for the localhost:5008 entry.
- Clicked **Clear site data** to wipe the cached Actual UI.
- Performed a **Hard Refresh** (`Cmd + Shift + R`).

---

## Issue 3: Empty Dashboard Data
**Symptom:** Dashboard loaded but looked empty or missing data.

**Root Cause:**
The dashboard defaults to the *current* month. Since today is May 2nd, the dashboard was displaying May 2026, which only had a single transaction recorded.

**Resolution:**
- Use the month dropdown in the custom dashboard to switch back to the previous month (April 2026) to see full transaction history and charts.
