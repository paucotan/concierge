# Concierge — Session Log
**Last updated:** March 28, 2026

---

## What's Built & Working

### App Structure
- Tauri (Rust) + TypeScript + Tailwind menubar app
- Lives in top macOS menu bar — bell icon (🔔)
- Left-click: toggle window | Right-click: Quit
- Window positions top-right below menu bar
- Header is draggable (data-tauri-drag-region)
- No Dock icon (LSUIElement via ActivationPolicy::Accessory)

### Budget Pipeline UI (5 steps)
1. SimpleFIN → Open → button to beta-bridge.simplefin.org
2. Check email → manual check
3. Sync Actual → Open → button to localhost:5007
4. Categorize → clickable label → opens localhost:5007/categories/uncategorized
   - Shows count of real uncategorized transactions (filters out transfers)
   - "✦ Ask Claude" button (partially working — see bugs below)
5. Export → Run → runs export.js → CSV → Google Drive

### Scripts (in ~/Documents/budgeting/scripts/)
- `export.js` — exports Actual transactions to CSV, uploads to Google Drive
- `count-uncategorized.js` — counts real uncategorized (non-transfer) transactions
- `categorize.js` — fetches transactions, calls claude CLI, returns JSON suggestions
- `apply-categories.js` — reads JSON from stdin, applies categories to Actual via updateTransaction()

### Known Fixes Applied
- node path: uses `/opt/homebrew/bin/node` (absolute, GUI app has no PATH)
- HOME env: passed explicitly to all Rust subprocess commands
- Transfer filtering: payees with `transfer_acct` now excluded from uncategorized count/list
- current_dir: set to budgeting/scripts so dotenv finds .env

---

## Current Bug to Fix

### "Ask Claude" — SyntaxError: JSON Parse error: Unexpected identifier "dotenv"

**Root cause:** dotenv prints `[dotenv@17.3.1] injecting env (4) from .env -- tip: ...` to **stdout**.
This output gets mixed into what `categorize.js` captures as Claude's response, breaking JSON.parse().

**Fix needed in `categorize.js`:**
Silence dotenv's stdout log. Options:
1. Use `require('dotenv').config({ quiet: true })` — but dotenv v17 uses different API
2. Redirect stdout temporarily before calling dotenv
3. Parse only the last valid JSON from the output (strip non-JSON lines)
4. Use `process.env` directly without dotenv (env vars already set by Rust via `.env` + current_dir... actually no, Rust sets HOME and PATH but not the ACTUAL_* vars)

**Best fix:** In categorize.js, suppress dotenv output:
```js
const { config } = require('dotenv');
config({ quiet: true }); // dotenv v17 supports quiet option
```
Or simply parse stdout with a JSON extract rather than raw parse:
```js
const jsonMatch = result.stdout.match(/\[.*\]/s);
const suggestions = JSON.parse(jsonMatch[0]);
```

Also: dotenv noise was seen in count-uncategorized.js output too — same fix needed there.

**Also verify:** The claude --print call itself works when called as a Node subprocess (spawnSync). Was confirmed working in terminal directly but not yet confirmed working as subprocess from categorize.js.

---

## What Remains

### Immediate
- [ ] Fix dotenv stdout pollution in categorize.js (and count-uncategorized.js)
- [ ] Verify "Ask Claude" full flow works end-to-end (Actual → Claude → review panel)
- [ ] Test "Apply all" applies categories back to Actual correctly
- [ ] Test export (Run →) works with HOME env fix

### Next Features (discussed, not built)
- [ ] Financial recommendations ("How am I doing?") — Claude compares spending vs budget targets
- [ ] Rule suggestions — Claude proposes new rules based on manual categorization patterns
- [ ] Rule cleanup — Claude audits existing rules for redundancy/conflicts
- [ ] Settings panel — choose between Claude Code CLI vs Anthropic API key

### UX Polish
- [ ] Persistent checkboxes on restart — currently intentional (localStorage), user may want option to reset on launch
- [ ] Window positioning — currently top-right corner, could be anchored to tray icon position more precisely

---

## Key File Paths
| File | Purpose |
|------|---------|
| `~/Documents/concierge/` | Main app |
| `~/Documents/concierge/src/main.ts` | Frontend logic |
| `~/Documents/concierge/index.html` | UI |
| `~/Documents/concierge/src-tauri/src/lib.rs` | Rust/Tauri commands |
| `~/Documents/budgeting/scripts/categorize.js` | Claude categorization |
| `~/Documents/budgeting/scripts/apply-categories.js` | Apply categories to Actual |
| `~/Documents/budgeting/scripts/count-uncategorized.js` | Count for step 4 badge |
| `~/.local/bin/claude` | Claude CLI binary |
| `/opt/homebrew/bin/node` | Node binary (absolute path needed) |
