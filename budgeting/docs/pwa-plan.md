# Mobile Budget PWA — Plan

A Progressive Web App (PWA) that the user can save to their iPhone home screen for a fast, visual, mobile-friendly budget view. Replaces the Google Sheets dashboard for day-to-day checking.

---

## Why

- Google Sheets dashboard works but feels clunky on mobile
- A PWA installs to iPhone home screen — full screen, no browser chrome, feels native
- Faster to open and glance at than navigating to a Sheet
- Can be designed specifically for mobile reading, not editing

---

## Data Source

Reads from the **Google Sheets Dashboard tab** via the Google Sheets API (read-only).
- No changes to the existing pipeline
- Every time the app loads, it fetches the latest data from the Sheet
- The Sheet is already structured with category totals, budgeted amounts, and month — perfect as a backend

---

## Hosting

**GitHub Pages** — free, HTTPS, no server needed, takes ~10 min to set up.
Single HTML file with embedded JS/CSS. No framework required.

---

## iPhone Setup

1. Open the URL in Safari
2. Tap Share → "Add to Home Screen"
3. Give it a name + icon
4. Done — it opens full screen like an app

Requires: `manifest.json` (app name, icon, display mode) + optionally a service worker for offline caching.

---

## Planned Features

- **Budget rings / progress bars** per category (spent vs budgeted)
- **Monthly summary** — total spent, total budgeted, over/under, savings rate
- **Month selector** — tap to switch between months
- **Category drill-down** — tap a category to see individual transactions (stretch goal)
- **Color coding** — green/yellow/red based on % used
- **Last updated timestamp** — so you know how fresh the data is

---

## Technical Approach

- Single `index.html` — HTML + CSS + JS in one file
- Fetch data from Google Sheets via Sheets API (read-only, public or service account)
- No build step, no framework, no dependencies to manage
- Mobile-first CSS, designed for 390px width (iPhone 14)

---

## Open Questions (decide before building)

1. **Google Sheet visibility:** Does the Sheet need to be made public (read-only), or will we use the service account credentials already in `scripts/service-account.json`?
2. **Offline support:** Is a service worker worth it, or is "always online when checking budget" fine?
3. **Color scheme / style:** Minimal/dark? Match a specific aesthetic?
4. **Stretch goal:** Transaction list per category — useful or overkill for a phone glance?

---

## Status: Not started — planned
See `docs/todos.md` item #4 for next steps.
