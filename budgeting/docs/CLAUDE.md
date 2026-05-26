# CLAUDE.md — Personal Budget Tracker

This is the master index. Load this every session. Load linked files only when needed.

---

## Who & What

Personal finance system. Tracks monthly spending across categories against set budgets.
The user works in tech, aiming to optimize budget management.

## North Star

**Maximize UX to reduce friction.** Every build decision should be filtered through this.

The unavoidable manual steps (2FA, transaction categorization) are acceptable friction — they require human judgment. Everything else should get out of the way. A feature that adds complexity without meaningfully reducing friction is not worth building.

---

## Key Numbers (always relevant)

**Monthly income:** ~$5,000 (bi-weekly paychecks)

**Budget targets** (total ~$2,500/month):
| Category | Budget |
|---|---|
| Bills | $600 |
| Subscriptions | $100 |
| Food | $700 |
| Shopping | $300 |
| Health | $100 |
| Donation | $100 |
| General | $100 |
| Savings | $500 |

**Accounts in Actual:**
- Bank Chequing
- Bank Savings
- Credit Card
- Joint Chequing

**CSV columns:** Account, Date, Payee, Notes, Category, Amount, Split_Amount, Cleared

---

## Current Pipeline

1. **SimpleFIN Bridge** syncs bank transactions into Actual Budget (`localhost:5007`)
2. **User categorizes** uncategorized transactions in Actual (~7–15 per 2-week cycle)
3. **Trigger script** to export:
   - Connects to Actual via API, exports all transactions as CSV
   - Uploads `All-Accounts.csv` to Google Drive (`Budget Uploads` folder)
4. **Google Sheet** (`budget-updater.gs` pasted into Apps Script) reads the CSV and rebuilds the Dashboard tab

**Cadence:** Every ~2 weeks

---

## File Index

| File | What it is |
|---|---|
| `docs/todos.md` | Current task list — start here each session |
| `docs/pipeline.md` | Full pipeline breakdown, tools, constraints, planned improvements |
| `docs/pwa-plan.md` | Mobile website / PWA project plan |
| `docs/actual-rules-setup.example.md` | Checklist of Actual Budget rules to set up (template) |
| `docs/goals.md` | Short / medium / long-term financial goals |
| `scripts/export.js` | Node script: Actual API → CSV → Google Drive upload |
| `scripts/budget-updater.gs` | Google Apps Script: paste into Google Sheet to rebuild dashboard |

---

## Constraints (don't try to work around these)

- **Bank 2FA** — SimpleFIN requires manual 2FA verification. Cannot be automated.
- **Transaction categorization** — requires user's judgment. Rules reduce volume but can't eliminate it.
- **Actual API** — requires Actual app running at `localhost:5007`. VM sandbox cannot reach this directly; use the CSV for analysis instead.

---

## Notes

- Expenses in Actual are stored as **negative numbers** (`expensesAreNegative: true`)
- Category names must match exactly between Actual, the CSV, and `budget-updater.gs`
