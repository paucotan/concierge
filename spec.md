# Concierge — App Specification

**Version:** 0.1 (pre-build)
**Last updated:** March 2026

---

## Overview

Concierge is a macOS menu bar utility that serves as a personal hub for lifehack tools. It lives unobtrusively in the top menu bar and presents a clean, minimal interface for launching and interacting with integrated apps.

---

## Platform & Distribution

- **OS:** macOS (primary)
- **Distribution:** Local only — built and run on user's machine, no app store
- **Menu bar behavior:** Bell icon in top-right status bar. No Dock icon (`LSUIElement = true` in Info.plist).

---

## Tech Stack

- **Tauri** — desktop framework (Rust backend, system WebView frontend)
- **TypeScript** — frontend logic
- **Tailwind CSS** — styling
- **Vite** — frontend build tool (Tauri default)

---

## UI Design

### Menu Bar Icon
- Bell symbol, monochrome
- Uses macOS template image (auto-inverts for light/dark menu bar)

### Main Window
- Appears on bell click, dismisses on click-outside or Escape
- Size: compact — approximately 320–400px wide, height adapts to tile count
- Style: minimal, dark or system-matched theme, subtle rounded corners
- No window chrome (no traffic light buttons)

### Tile Grid
- Each integrated tool gets a tile/card
- Tile contains: icon + label + optional status or quick action
- Layout: single column or 2-column grid depending on tile count

---

## Tiles — v1 Scope

### 1. Budget
- **Icon:** receipt or chart symbol
- **Label:** "Budget"
- **Actions:**
  - Primary button: "Sync & Export" — runs `scripts/export.js` from `~/Documents/budgeting/`
  - Secondary link: "Open Actual" — opens `http://localhost:5007` in default browser
- **Status indicator:** shows last export timestamp if available
- **Note:** export.js requires Node.js; Tauri backend spawns it as a child process

---

## Tiles — Planned (not in v1)

### 2. Coin Tracker
- Details TBD — placeholder tile in v1 acceptable

### 3. Smart Lamp
- Details TBD — placeholder tile in v1 acceptable

---

## Technical Notes

### Running Scripts from Tauri
- Tauri's `Command` API (Rust) can spawn child processes
- `export.js` invoked via: `node ~/Documents/budgeting/scripts/export.js`
- stdout/stderr surfaced in the UI (success/error state on the tile)

### Autostart (optional, post-v1)
- Tauri supports login item registration via `tauri-plugin-autostart`
- Not required for v1 — manual launch acceptable

### Window Positioning
- Window should appear anchored below the menu bar icon
- Tauri + tray positioning requires manual coordinate calculation on macOS

---

## Out of Scope (v1)

- Authentication or user accounts
- Cloud sync
- Mobile version
- Windows/Linux support
- In-app settings UI (config via files is fine)
