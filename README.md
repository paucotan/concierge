# Concierge

Concierge is a minimal, lightweight macOS menu bar command center utility built with Tauri, TypeScript, and Tailwind CSS. It serves as an unobtrusive status hub and quick-action launcher for personal lifehack tools and scripting suites.

Its primary built-in utility is the **Budget Control Center**, which integrates directly with a local/self-hosted instance of **Actual Budget** to automate bank syncing, AI-assisted transaction categorization, and dashboard updates.

<p align="center">
  <img src="images/dashboard_preview.png" width="750" alt="Concierge & Dashboard Preview" />
  <br>
  <em>Note: The screenshot above uses simulated/sanitized values ($0.00) for privacy.</em>
</p>

---

## Features

- 🔔 **Unobtrusive macOS Menu Bar App:** Lives in your system tray, inverts automatically for dark/light menu bars, and auto-dismisses when clicking outside.
- 🔄 **Bank Sync Trigger:** Runs a Node-based sync script in the background to fetch transactions from bank accounts (via SimpleFIN).
- 🧠 **AI-Assisted Categorization:** Integrates with Claude (via CLI/API) or local LLMs (via Ollama) to analyze uncategorized transactions and present suggested categories.
- 📋 **In-App Review Panel:** Inspect AI categorization suggestions and apply them all with a single click before exporting.
- 📊 **Quick Metrics Widget:** Displays a prorated "Weekly Brief" badge (e.g. `🟢 on track` or `🔴 2 over`) and expandable category spending stats right in the popup.
- 🖥️ **Dashboard Server Control:** Starts your local budget server and opens the rich web dashboard in your default browser.

---

## How It Works

Here is the standard workflow when using Concierge to manage your personal budget:

1. **Syncing Accounts:**
   - Clicking the **Sync Accounts** button in the Concierge popover runs the background sync runner (`sync-only.js` / `fetch-rules.js`).
   - This script triggers your local/self-hosted **Actual Budget** instance to connect to the **SimpleFIN Bridge** API, fetching the latest transaction data directly from your bank accounts.
2. **Handling Connection or 2FA Failures:**
   - If the SimpleFIN token expires or a bank connection fails (e.g., due to a required multi-factor authentication prompt), the sync script will return an error status.
   - Concierge detects the failure and presents a button to **Repair Connection**, which links directly to your SimpleFIN web dashboard.
   - Once you repair the credentials or complete the 2FA on the SimpleFIN portal, click **Sync Accounts** again in Concierge to pull the new transactions.
3. **Auto-Categorization:**
   - Once bank feeds are successfully loaded, any uncategorized transactions are automatically processed. Concierge analyzes them using your chosen AI Provider (Claude API or a local Ollama model) based on your spending rules.
   - You can review these proposed categories within the interactive panel in the Concierge menu bar window, adjust any selections, and approve them in bulk.
4. **Accessing the Dashboard:**
   - Clicking **Open Dashboard** starts your local budget dashboard server (`dashboard-server.js`) and opens `http://localhost:5008` in your default browser for detailed analytics.

---

## Architecture

Concierge acts as a GUI control deck for the integrated **Budgeting Suite** (located in the internal `budgeting/` subfolder).

```
[System Menu Bar] -> Click 🔔
        │
        ▼
┌────────────────────────────────────────┐
│             CONCIERGE App              │ (Tauri Menu Bar Shell)
├────────────────────────────────────────┤
│ 1. [Sync Bank Data] ───────────────────┼─► Spawns node sync-only.js
│ 2. [Categorize & Export] ──────────────┼─► Spawns node categorize.js (AI query)
│ 3. [AI Suggestions Review Panel] ──────┼─► Spawns node apply-categories.js
│ 4. [Weekly Brief Status Widget] ───────┼─► Spawns node weekly-brief.js
│ 5. [Open Dashboard] ───────────────────┼─► Spawns node dashboard-server.js & opens URL
└────────────────────────────────────────┘
```

---

## Installation & Setup

### Prerequisites
- **macOS** (primary platform)
- **Node.js** (v18+)
- **Rust** (to compile the Tauri app)
- A running instance of **[Actual Budget](https://actualbudget.org/)** (usually at `http://localhost:5007`)
- A **[SimpleFIN Bridge](https://beta-bridge.simplefin.org/)** account (a paid API bridge to securely connect your bank accounts and download transaction feeds, costing only $1.50/month).

### 1. Clone the Repository
```bash
git clone https://github.com/username/concierge.git
cd concierge
```

### 2. Install Dependencies
Install dependencies for both the Tauri application and the background scripting runners:
```bash
# Install root Tauri/Vite dependencies
npm install

# Install budgeting script dependencies
cd budgeting/scripts && npm install
```

### 3. Launch Concierge
Navigate back to the root folder and start the app in development mode:
```bash
cd ../..
npm run tauri dev
```
A bell icon (🔔) will appear in your top macOS menu bar. Click it to open the Concierge command center.

### 4. Direct Configuration
Open the **⚙ Settings** panel at the bottom of the popup. Enter your Actual Budget server URL, Password, and Sync ID, and select your AI provider. Click **Save** to write these directly to `~/.concierge/.env` (no manual file editing or terminal config script runs required!).

---

### AI Auto-Categorization Options
Concierge supports three AI provider modes to analyze and suggest category rules:

1. **Ollama (Local LLM - Default):**
   - Runs transaction categorization entirely locally.
   - **Prerequisites:** Requires [Ollama](https://ollama.com/) to be installed and running on your system.
   - **Model Auto-Detection:** The **⚙ Settings** panel dynamically queries your local Ollama instance (`/api/tags`) to auto-detect your downloaded models (e.g. `gemma4:e4b`). You can select them directly from the input text field's autocomplete options.
2. **OpenAI-Compatible (Cloud APIs):**
   - Connects to OpenAI, OpenRouter, DeepSeek, Groq, or other custom endpoint services.
   - **Prerequisites:** Requires your provider's API Key and model name (e.g., `gpt-4o-mini`, `deepseek-chat`). You can specify custom Base URLs directly in settings.
3. **Claude CLI:**
   - Uses a local installation of the Claude CLI tool.
   - **Prerequisites:** Requires the `claude` command line tool binary located at `~/.local/bin/claude`.

---

## Directory Customization (Advanced)

Concierge automatically resolves scripts from the bundled resource assets by default. If you prefer to direct Concierge to run files from a custom git workspace location on your filesystem:
1. **Environment Variable:** Set `BUDGETING_DIR=/absolute/path/to/budgeting` in your shell environment.
2. **Configuration File:** Create a file named `~/.concierge-config.json` containing:
   ```json
   {
     "budgeting_dir": "/absolute/path/to/your/budgeting/folder"
   }
   ```

---

## License

This project is open-sourced under the MIT License.
