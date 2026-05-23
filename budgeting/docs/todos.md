# Todos & Roadmap

Last updated: March 2026 (session 2). Pick up from here next session.

---

## 🔴 Ready to do next session

### 1. Set up Actual Budget rules (manual, one-time)
Reference: `docs/actual-rules-setup.md`
- Open Actual → More → Rules → New Rule
- Work through the checklist category by category
- **Critical order:** Add Amazon Prime rule *before* the general Amazon → Shopping rule
- **Critical:** Use "is exactly" for plain `Uber` (subscription) so it doesn't catch Uber Eats/Trip
- Expected outcome: 7–15 transactions per cycle drops to ~2–4 needing manual review

### 2. Build two-trigger automation script
Reference: `docs/pipeline.md` (planned improvements section)

**Trigger 1 — "Start sync":**
- Vancity **always** requires 2FA (email code) on every sync — this is by design, not a bug
- Script opens `https://bridge.simplefin.org` directly to the accounts page every time
- User clicks Adjust on Vancity, waits ~2 min, enters the 2FA email code
- Optional: after user fixes it, poll SimpleFIN `GET /accounts` to confirm Vancity errors are cleared, then auto-open Actual
- **Note:** SimpleFIN ACCESS_URL needed for the polling step — locate in Actual's internal config or regenerate at `https://bridge.simplefin.org/simplefin/create`

**Trigger 2 — "I'm done categorizing":**
- Calls Actual API to export CSV (already works in `scripts/export.js`)
- Uploads to Google Drive (already works)
- Triggers Google Sheet dashboard refresh
- Telegram bot reads fresh data and fires alerts if any category is at 80%+ or over

### 3. Build Telegram bot
- **Type:** One-way push only (no interactive replies needed)
- **Alerts:** Fire after Trigger 2 runs — check each category against budget limits
  - ⚠️ Warning at ~80% of budget
  - 🚨 Alert when over budget (with exact overage amount)
  - ✅ Silent if all good (no message spam)
- **Weekly digest:** Every Sunday morning — spending vs budget per category, regardless of whether pipeline ran
- **Run as:** Lightweight background process on the local machine (Python script)
- **Data source:** Reads from latest `All-Accounts.csv` or Google Sheet
- **Budget limits:** Store in a `config.json` next to the script for easy editing
- **Setup needed:** Create bot via Telegram BotFather, get token + chat ID

---

## 🟡 Bigger project — tackle when ready

### 4. Mobile PWA (budget website)
Reference: `docs/pwa-plan.md`
- A Progressive Web App that can be saved to a mobile home screen
- Reads live data from Google Sheets API (Dashboard tab)
- Hosted free on GitHub Pages
- No changes needed to the existing pipeline

---

## 🟢 Ongoing / maintenance

### 5. Refresh Actual rules every 3–6 months
- Re-run the CSV payee analysis to catch new recurring payees
- The analysis script is at `/sessions/.../fetch-rules.js` (or can be re-run by Claude)
- Last run: March 2026 — 47 consistent payees identified

---

## ✅ Done

- [x] Export script (`scripts/export.js`) — Actual API → CSV → Google Drive
- [x] Google Sheets dashboard (`scripts/budget-updater.gs`) — reads CSV, builds Dashboard tab
- [x] Actual rules reference doc (`docs/actual-rules-setup.md`)
- [x] Documentation restructure (this file, pipeline.md, pwa-plan.md, lean CLAUDE.md)
