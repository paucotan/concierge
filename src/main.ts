import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";

// ── Types ──────────────────────────────────────────────────────────────────

type AppState =
  | 'idle'
  | 'syncing'
  | 'sync-failed'
  | 'synced'        // bank sync done, ready to categorize
  | 'categorizing'
  | 'reviewing'     // suggestions ready, review panel open
  | 'synced-clean'  // categorized, nothing to review
  | 'done';         // exported

interface Suggestion {
  transaction_id: string;
  category_id: string;
  category_name: string;
  payee: string;
  amount: number;
}

interface SuggestionsResult {
  suggestions: Suggestion[];
  categories: string[];
}

// ── Persistent state ───────────────────────────────────────────────────────

const STATE_KEY = 'concierge-state-v1';
const LAST_SYNCED_KEY = 'last-synced';

let appState: AppState = 'idle';
let syncErrorMsg = '';
let doneMsg = '';
let allCategories: string[] = [];
let pendingSuggestions: Suggestion[] = [];

function loadPersistedState(): AppState {
  const s = localStorage.getItem(STATE_KEY) as AppState | null;
  // Only resume stable states — transient states restart from idle or synced
  if (s === 'synced' || s === 'synced-clean' || s === 'done') return s;
  return 'idle';
}

function persistState(s: AppState) {
  localStorage.setItem(STATE_KEY, s);
}

function setState(s: AppState) {
  appState = s;
  persistState(s);
  renderHero();
}

// ── Hero rendering ─────────────────────────────────────────────────────────

function renderHero() {
  const hero = document.getElementById('hero')!;
  hero.innerHTML = '';

  switch (appState) {
    case 'idle': {
      const btn = makeHeroButton('Sync Accounts →', onBankSync);
      btn.id = 'btn-bank-sync';
      hero.appendChild(btn);
      break;
    }

    case 'syncing': {
      hero.appendChild(makeStatusText('Connecting to Actual…', 'sync-status-text'));
      break;
    }

    case 'sync-failed': {
      const msg = document.createElement('p');
      msg.className = 'text-[11px] text-white/50 text-center mb-3 leading-relaxed';
      msg.textContent = friendlyError(syncErrorMsg);
      hero.appendChild(msg);

      const links = document.createElement('div');
      links.className = 'flex gap-4 justify-center';
      links.appendChild(makeLinkButton('Fix in SimpleFIN →', 'https://beta-bridge.simplefin.org/my-account'));
      links.appendChild(makeLinkButton('Gmail →', 'https://mail.google.com'));
      hero.appendChild(links);

      const retry = document.createElement('button');
      retry.className = 'mt-3 text-[9px] text-white/20 hover:text-white/45 transition-colors cursor-pointer';
      retry.textContent = '↺ retry sync';
      retry.addEventListener('click', onBankSync);
      hero.appendChild(retry);
      break;
    }

    case 'synced': {
      const check = document.createElement('p');
      check.className = 'text-[10px] text-white/35 text-center mb-3';
      check.textContent = 'Accounts synced.';
      hero.appendChild(check);

      const btn = makeHeroButton('Categorize Transactions →', onSyncData);
      btn.id = 'btn-run';
      hero.appendChild(btn);
      break;
    }

    case 'categorizing': {
      hero.appendChild(makeStatusText('Fetching transactions…', 'categorize-status-text'));
      break;
    }

    case 'reviewing': {
      const p = document.createElement('p');
      p.className = 'text-[11px] text-white/40 text-center';
      const n = pendingSuggestions.length;
      p.textContent = `${n} transaction${n === 1 ? '' : 's'} to review`;
      hero.appendChild(p);
      break;
    }

    case 'synced-clean': {
      hero.appendChild(makeStatusText('All clear ✓'));
      break;
    }

    case 'done': {
      hero.appendChild(makeStatusText(doneMsg || 'Done.'));
      break;
    }
  }

  resizeToContent();
}

function makeHeroButton(label: string, handler: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'px-5 py-2 rounded-lg bg-white/8 hover:bg-white/12 border border-white/10 text-white/65 hover:text-white/90 text-[12px] transition-all cursor-pointer';
  btn.textContent = label;
  btn.addEventListener('click', handler);
  return btn;
}

function makeStatusText(text: string, id?: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = 'text-[11px] text-white/35 text-center';
  p.textContent = text;
  if (id) p.id = id;
  return p;
}

function makeLinkButton(label: string, url: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'text-[10px] text-white/30 hover:text-white/60 transition-colors cursor-pointer';
  btn.textContent = label;
  btn.addEventListener('click', () => openUrl(url));
  return btn;
}

function friendlyError(err: string): string {
  const e = err.toLowerCase();
  if (e.includes('vancity')) return "Couldn't sync Vancity — check SimpleFIN for a 2FA code.";
  if (e.includes('timeout') || e.includes('connect')) return "Couldn't connect. Is Actual running?";
  if (e.includes('simplefin') || e.includes('bridge')) return "SimpleFIN error — check your access token.";
  return "Sync failed. Check SimpleFIN or try again.";
}

// ── Sync Accounts (Phase 1 of pipeline) ──────────────────────────────────

async function onBankSync() {
  setState('syncing');

  const progressTimer = setTimeout(() => {
    const p = document.getElementById('sync-status-text');
    if (p) p.textContent = 'Syncing bank data…';
  }, 5000);

  try {
    await invoke<string>('run_bank_sync');
    clearTimeout(progressTimer);
    localStorage.setItem(LAST_SYNCED_KEY, Date.now().toString());
    updateLastSynced();
    loadBrief(true);
    setState('synced');
  } catch (err) {
    clearTimeout(progressTimer);
    syncErrorMsg = String(err);
    setState('sync-failed');
  }
}

// ── Categorize & Export (Phase 2 of pipeline) ────────────────────────────

async function onSyncData() {
  setState('categorizing');

  const aiLabel = await invoke<string>('load_ai_config').then(raw => {
    const cfg = JSON.parse(raw);
    return cfg.provider === 'ollama' ? (cfg.ollama?.model || 'Ollama') : 'Claude';
  }).catch(() => 'AI');
  const stages = ['Fetching transactions…', `Asking ${aiLabel}…`, 'Parsing response…'];
  let stageIndex = 0;
  const progressTimer = setInterval(() => {
    stageIndex = Math.min(stageIndex + 1, stages.length - 1);
    const p = document.getElementById('categorize-status-text');
    if (p) p.textContent = stages[stageIndex];
  }, 8000);

  try {
    const raw = await invoke<string>('get_suggestions');
    clearInterval(progressTimer);
    const result: SuggestionsResult = JSON.parse(raw);
    allCategories = result.categories;
    pendingSuggestions = result.suggestions;

    if (pendingSuggestions.length === 0) {
      await finishCategorize(true);
    } else {
      setState('reviewing');
      renderReviewPanel(pendingSuggestions, allCategories);
      document.getElementById('review-panel')!.classList.remove('hidden');
      resizeToContent();
    }
  } catch (err) {
    clearInterval(progressTimer);
    // Return to synced state so user can retry
    setState('synced');
    let friendly = String(err);
    if (friendly.includes('Connection refused') || friendly.includes('connect') || friendly.includes('exit code 7')) {
      friendly = 'Could not connect to Ollama. Please check if Ollama is running, or select a different provider in Settings.';
    }
    appendHeroError(friendly);
  }
}

async function finishCategorize(fromCategorize = false) {
  if (fromCategorize) {
    setState('synced-clean');
  }
  doneMsg = 'Transactions categorized.';
  loadBrief(true);
  setState('done');
}

function appendHeroError(msg: string) {
  const hero = document.getElementById('hero')!;
  const errEl = document.createElement('p');
  errEl.className = 'text-[10px] text-red-400/60 text-center mt-1';
  errEl.textContent = msg;
  hero.appendChild(errEl);
  resizeToContent();
}

// ── Review panel ──────────────────────────────────────────────────────────

function renderReviewPanel(suggestions: Suggestion[], categories: string[]) {
  const list = document.getElementById('review-list')!;
  list.innerHTML = '';

  for (const s of suggestions) {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2 py-1 border-b border-white/5 last:border-0';

    const info = document.createElement('div');
    info.className = 'flex-1 min-w-0';

    const payee = document.createElement('div');
    payee.className = 'text-[11px] text-white/70 truncate';
    payee.textContent = s.payee;

    const amount = document.createElement('div');
    amount.className = `text-[10px] ${s.amount < 0 ? 'text-white/30' : 'text-green-400/60'}`;
    amount.textContent = `$${Math.abs(s.amount).toFixed(2)}`;

    info.appendChild(payee);
    info.appendChild(amount);
    row.appendChild(info);

    const select = document.createElement('select');
    select.dataset.txId = s.transaction_id;
    select.className = 'text-[10px] bg-white/8 border border-white/10 text-white/60 rounded px-1 py-0.5 cursor-pointer max-w-[110px]';

    for (const cat of categories) {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      if (cat === s.category_name) opt.selected = true;
      select.appendChild(opt);
    }

    select.addEventListener('change', (e) => {
      const sel = e.target as HTMLSelectElement;
      const match = pendingSuggestions.find(x => x.transaction_id === sel.dataset.txId);
      if (match) match.category_name = sel.value;
    });

    row.appendChild(select);
    list.appendChild(row);
  }
}

// ── Apply categories ───────────────────────────────────────────────────────

document.getElementById('btn-apply')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-apply') as HTMLButtonElement;
  btn.textContent = 'Applying…';
  btn.disabled = true;

  const payload = pendingSuggestions.map(s => ({
    transaction_id: s.transaction_id,
    category_id: s.category_id,
    category_name: s.category_name,
  }));

  try {
    const count = await invoke<string>('apply_categories', { json: JSON.stringify(payload) });
    document.getElementById('review-panel')!.classList.add('hidden');
    setApplyStatus(`${count} transaction${count === '1' ? '' : 's'} categorized.`, false);
    await finishCategorize();
  } catch (err) {
    setApplyStatus(String(err), true);
  } finally {
    btn.textContent = 'Apply all';
    btn.disabled = false;
  }
});

document.getElementById('btn-cancel-review')?.addEventListener('click', () => {
  document.getElementById('review-panel')!.classList.add('hidden');
  setState('synced');
  setApplyStatus('');
  resizeToContent();
});

function setApplyStatus(msg: string, isError = false) {
  const el = document.getElementById('apply-status')!;
  el.textContent = msg;
  el.className = `mt-1.5 text-[10px] min-h-[14px] ${isError ? 'text-red-400/70' : 'text-white/30'}`;
}

// ── Last synced timestamp ──────────────────────────────────────────────────

function updateLastSynced() {
  const raw = localStorage.getItem(LAST_SYNCED_KEY);
  const el = document.getElementById('last-synced-label');
  if (!el) return;
  if (!raw) { el.classList.add('hidden'); return; }

  const d = new Date(parseInt(raw, 10));
  const month = d.toLocaleString('en-CA', { month: 'short' });
  const day = d.getDate();
  const time = d.toLocaleString('en-CA', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
  el.textContent = `Last synced: ${month} ${day} at ${time}`;
  el.classList.remove('hidden');
}

// ── Weekly Brief ──────────────────────────────────────────────────────────

const BRIEF_CACHE_KEY = 'weekly-brief-v1';
const BRIEF_CACHE_TTL = 60 * 60 * 1000;

interface BriefRow {
  emoji: string;
  category: string;
  amount: number;
  delta: string;
  pct: number | null;
  isNew: boolean;
  proratedAvg: number | null;
  avgMonths: number;
  topPayees: { name: string; amount: number }[];
}

interface BriefData {
  month: string;
  elapsed: number;
  total: number;
  rows: BriefRow[];
}

function briefBadge(rows: BriefRow[]): string {
  const red = rows.filter(r => r.emoji === '🔴').length;
  const yel = rows.filter(r => r.emoji === '🟡').length;
  if (red > 0) return `🔴 ${red} over`;
  if (yel > 0) return `🟡 ${yel} watch`;
  return '🟢 on track';
}

function renderBrief(data: BriefData) {
  const container = document.getElementById('brief-rows')!;
  container.innerHTML = '';

  for (const r of data.rows) {
    const deltaColor = r.emoji === '🔴' ? 'text-red-400/70'
      : r.emoji === '🟡' ? 'text-yellow-400/70'
      : r.emoji === '🔵' ? 'text-sky-400/60'
      : 'text-green-400/60';

    const avgLabel = r.isNew ? 'new this month'
      : `${r.avgMonths}-month avg $${r.proratedAvg}`;

    const hasPayees = r.topPayees && r.topPayees.length > 0;

    const row = document.createElement('div');
    row.className = 'flex flex-col';

    const mainRow = document.createElement('div');
    mainRow.className = `flex items-center gap-1.5${hasPayees ? ' cursor-pointer' : ''}`;
    mainRow.innerHTML = `
      <span class="text-[11px] flex-shrink-0">${r.emoji}</span>
      <span class="text-[10px] text-white/65 flex-1 truncate">${r.category}</span>
      <span class="text-[10px] font-mono text-white/55 flex-shrink-0">$${Math.abs(r.amount).toFixed(0)}</span>
      <span class="text-[10px] font-mono flex-shrink-0 w-10 text-right ${deltaColor}">${r.delta}</span>
    `;

    const subRow = document.createElement('div');
    subRow.className = 'pl-5 text-[9px] text-white/20';
    subRow.textContent = avgLabel;

    const payeeList = document.createElement('div');
    payeeList.className = 'hidden pl-5 pt-1 pb-0.5 flex flex-col gap-0.5';
    if (hasPayees) {
      for (const p of r.topPayees) {
        const line = document.createElement('div');
        line.className = 'flex justify-between text-[9px] text-white/25';
        line.innerHTML = `<span class="truncate flex-1 mr-2">${p.name}</span><span class="font-mono flex-shrink-0">$${Math.abs(p.amount).toFixed(0)}</span>`;
        payeeList.appendChild(line);
      }

      mainRow.addEventListener('click', () => {
        const hidden = payeeList.classList.contains('hidden');
        payeeList.classList.toggle('hidden', !hidden);
        resizeToContent();
      });
    }

    row.appendChild(mainRow);
    row.appendChild(subRow);
    row.appendChild(payeeList);
    container.appendChild(row);
  }

  document.getElementById('brief-badge')!.textContent = briefBadge(data.rows);

  const cache = JSON.parse(localStorage.getItem(BRIEF_CACHE_KEY) || '{}');
  if (cache.timestamp) {
    const mins = Math.round((Date.now() - cache.timestamp) / 60000);
    document.getElementById('brief-updated')!.textContent =
      mins < 2 ? 'just updated' : `updated ${mins}m ago`;
  }
  resizeToContent();
}

async function loadBrief(force = false) {
  const raw = localStorage.getItem(BRIEF_CACHE_KEY);
  const cache = raw ? JSON.parse(raw) : null;
  const stale = !cache || (Date.now() - cache.timestamp) > BRIEF_CACHE_TTL;

  if (cache?.data) renderBrief(cache.data);

  if (stale || force) {
    if (!cache?.data) document.getElementById('brief-badge')!.textContent = 'loading…';
    try {
      const json = await invoke<string>('get_weekly_brief');
      const data: BriefData = JSON.parse(json);
      localStorage.setItem(BRIEF_CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
      renderBrief(data);
    } catch {
      document.getElementById('brief-badge')!.textContent = 'unavailable';
    }
  }
}

document.getElementById('btn-brief-toggle')?.addEventListener('click', () => {
  document.getElementById('brief-content')!.classList.toggle('hidden');
  resizeToContent();
});

// ── Window sizing ──────────────────────────────────────────────────────────

async function resizeToContent() {
  await new Promise(r => requestAnimationFrame(r));
  const h = document.getElementById('app')?.getBoundingClientRect().height ?? 0;
  if (h > 0) {
    await getCurrentWindow().setSize(new LogicalSize(320, Math.ceil(h)));
  }
}

// ── Welcome animation ──────────────────────────────────────────────────────

function playWelcome() {
  const overlay = document.getElementById('welcome-overlay')!;
  overlay.style.transition = 'none';
  overlay.style.opacity = '0';

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.style.transition = 'opacity 0.4s ease';
      overlay.style.opacity = '1';
      setTimeout(() => {
        overlay.style.transition = 'opacity 0.5s ease';
        overlay.style.opacity = '0';
      }, 1000);
    });
  });
}

// ── Init ───────────────────────────────────────────────────────────────────

document.getElementById('btn-close')?.addEventListener('click', () => {
  getCurrentWindow().hide();
});

document.getElementById('btn-dashboard')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-dashboard') as HTMLButtonElement;
  btn.textContent = 'Launching…';
  btn.disabled = true;
  try {
    await invoke<string>('launch_dashboard');
  } catch {
    // silent — dashboard opens in browser regardless
  } finally {
    btn.textContent = 'Dashboard →';
    btn.disabled = false;
  }
});

document.getElementById('btn-new-cycle')?.addEventListener('click', () => {
  localStorage.removeItem(STATE_KEY);
  document.getElementById('review-panel')!.classList.add('hidden');
  pendingSuggestions = [];
  allCategories = [];
  syncErrorMsg = '';
  doneMsg = '';
  setApplyStatus('');
  appState = 'idle';
  persistState('idle');
  renderHero();
});

getCurrentWindow().listen('tauri://focus', resizeToContent);
getCurrentWindow().listen('tauri://show', playWelcome);

// ── AI Settings ────────────────────────────────────────────────────────────

interface AIConfig {
  provider: 'claude' | 'ollama' | 'openai';
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  ollama?: { model: string; baseUrl: string };
}

interface EnvConfig {
  actual_url: string;
  actual_password: string;
  actual_sync_id: string;
}

function toggleAIFields(provider: string) {
  const fields = document.getElementById('settings-ollama-fields')!;
  const keyContainer = document.getElementById('settings-apiKey-container')!;
  
  if (provider === 'claude') {
    fields.classList.add('hidden');
    fields.classList.remove('flex');
  } else {
    fields.classList.remove('hidden');
    fields.classList.add('flex');
    
    if (provider === 'openai') {
      keyContainer.classList.remove('hidden');
      keyContainer.classList.add('flex');
    } else {
      keyContainer.classList.add('hidden');
      keyContainer.classList.remove('flex');
    }
  }
  resizeToContent();
}

async function initSettingsPanel() {
  const rawAI = await invoke<string>('load_ai_config');
  const aiConfig: AIConfig = JSON.parse(rawAI);
  (document.getElementById('settings-provider') as HTMLSelectElement).value = aiConfig.provider;

  const model = aiConfig.model || aiConfig.ollama?.model || 'gemma4:e4b';
  const baseUrl = aiConfig.baseUrl || aiConfig.ollama?.baseUrl || 'http://localhost:11434';
  const apiKey = aiConfig.apiKey ?? '';

  (document.getElementById('settings-ollama-model') as HTMLInputElement).value = model;
  (document.getElementById('settings-ollama-url') as HTMLInputElement).value = baseUrl;
  (document.getElementById('settings-api-key') as HTMLInputElement).value = apiKey;

  toggleAIFields(aiConfig.provider);

  try {
    const envConfig = await invoke<EnvConfig>('load_env_config');
    (document.getElementById('settings-actual-url') as HTMLInputElement).value = envConfig.actual_url ?? 'http://localhost:5007';
    (document.getElementById('settings-actual-password') as HTMLInputElement).value = envConfig.actual_password ?? '';
    (document.getElementById('settings-actual-sync-id') as HTMLInputElement).value = envConfig.actual_sync_id ?? '';
  } catch (err) {
    console.error('Failed to load env config', err);
  }
}

document.getElementById('btn-settings-toggle')?.addEventListener('click', async () => {
  const panel = document.getElementById('settings-panel')!;
  if (panel.classList.contains('hidden')) {
    await initSettingsPanel();
    panel.classList.remove('hidden');
  } else {
    panel.classList.add('hidden');
  }
  resizeToContent();
});

document.getElementById('btn-settings-close')?.addEventListener('click', () => {
  document.getElementById('settings-panel')!.classList.add('hidden');
  resizeToContent();
});

document.getElementById('settings-provider')?.addEventListener('change', (e) => {
  toggleAIFields((e.target as HTMLSelectElement).value);
});

document.getElementById('btn-settings-save')?.addEventListener('click', async () => {
  const provider = (document.getElementById('settings-provider') as HTMLSelectElement).value as 'claude' | 'ollama' | 'openai';
  const model = (document.getElementById('settings-ollama-model') as HTMLInputElement).value.trim();
  const baseUrl = (document.getElementById('settings-ollama-url') as HTMLInputElement).value.trim();
  const apiKey = (document.getElementById('settings-api-key') as HTMLInputElement).value.trim();
  const aiConfig: AIConfig = { provider, model, baseUrl, apiKey };

  const actualUrl = (document.getElementById('settings-actual-url') as HTMLInputElement).value.trim() || 'http://localhost:5007';
  const actualPassword = (document.getElementById('settings-actual-password') as HTMLInputElement).value.trim();
  const actualSyncId = (document.getElementById('settings-actual-sync-id') as HTMLInputElement).value.trim();

  const statusEl = document.getElementById('settings-status')!;
  try {
    await invoke('save_ai_config', { json: JSON.stringify(aiConfig) });
    await invoke('save_env_config', {
      actualUrl,
      actualPassword,
      actualSyncId,
    });
    statusEl.textContent = 'Saved.';
    statusEl.className = 'text-[9px] text-green-400/50 text-center min-h-[12px]';
    setTimeout(() => { statusEl.textContent = ''; }, 2000);
  } catch (err) {
    statusEl.textContent = `Error: ${err}`;
    statusEl.className = 'text-[9px] text-red-400/60 text-center min-h-[12px]';
  }
});

// ── Boot ───────────────────────────────────────────────────────────────────

appState = loadPersistedState();
renderHero();
updateLastSynced();
loadBrief();
