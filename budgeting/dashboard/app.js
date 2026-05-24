// ── State ────────────────────────────────────────────────────────────────

let currentMonth = null;
let allMonths = [];
let currentTransactions = [];
let currentSummary = null;
let activeFilter = null; // { type: 'category'|'payee'|'direction', value: string }
let sortCol = 'date';
let sortDir = -1; // -1 = descending
let categoryChart = null;
let payeeChart = null;
let payeeHistoryChart = null;
let trendChart = null;
let catChartType = 'doughnut';
let trendStacked = false;
let advisorMonth = null;
let conversationHistory = [];
let activeTab = 'dashboard';
let ccComparisonChart = null;
let ratioDonutChart = null;
let excludedCardIds = [];
try {
  const saved = localStorage.getItem('insights-excluded-cards');
  excludedCardIds = saved ? JSON.parse(saved) : ['amex_simplycash_preferred'];
} catch (e) {
  excludedCardIds = ['amex_simplycash_preferred'];
}

let compareCardIds = [];
let currentInsightsData = null;

const INSIGHTS_CACHE_KEY = 'insights-data-v1';
const INSIGHTS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// ── Chart colors ─────────────────────────────────────────────────────────

const COLORS = [
  '#6366f1', '#f43f5e', '#10b981', '#f59e0b', '#8b5cf6',
  '#06b6d4', '#ec4899', '#84cc16', '#ef4444', '#14b8a6',
  '#a855f7', '#eab308', '#3b82f6',
];

// ── Init ─────────────────────────────────────────────────────────────────

async function init() {
  // Ensure marked respects single line breaks
  if (typeof marked !== 'undefined') {
    marked.setOptions({ gfm: true, breaks: true });
  }

  const months = await api('/api/months');
  allMonths = months;
  if (!months.length) return;

  currentMonth = months[0];
  populateMonthSelect('month-select', months, currentMonth);
  populateMonthSelect('compare-month', months, months[1] || months[0]);
  updateExportLink();

  document.getElementById('month-select').addEventListener('change', (e) => {
    currentMonth = e.target.value;
    updateExportLink();
    if (activeTab === 'insights') {
      loadInsights();
    } else {
      loadDashboard();
    }
  });

  // Tab switching
  const tabDashboard = document.getElementById('tab-dashboard');
  const tabInsights = document.getElementById('tab-insights');
  const mainView = document.getElementById('dashboard-main-view');
  const insightsView = document.getElementById('insights-view');

  tabDashboard.addEventListener('click', () => {
    activeTab = 'dashboard';
    tabDashboard.className = 'text-sm px-3 py-1.5 rounded-md text-white font-medium bg-white/10 transition-all';
    tabInsights.className = 'text-sm px-3 py-1.5 rounded-md text-white/40 hover:text-white/70 transition-all';
    mainView.classList.remove('hidden');
    insightsView.classList.add('hidden');
    document.getElementById('advisor-sidebar')?.classList.add('hidden');
    document.getElementById('btn-advisor-mobile')?.classList.add('hidden');
    loadDashboard();
  });

  tabInsights.addEventListener('click', () => {
    activeTab = 'insights';
    tabInsights.className = 'text-sm px-3 py-1.5 rounded-md text-white font-medium bg-white/10 transition-all';
    tabDashboard.className = 'text-sm px-3 py-1.5 rounded-md text-white/40 hover:text-white/70 transition-all';
    mainView.classList.add('hidden');
    insightsView.classList.remove('hidden');
    document.getElementById('advisor-sidebar')?.classList.remove('hidden');
    document.getElementById('btn-advisor-mobile')?.classList.remove('hidden');
    loadInsights();
  });

  // Sort headers
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (sortCol === col) sortDir *= -1;
      else { sortCol = col; sortDir = col === 'amount' ? 1 : -1; }
      renderTable();
    });
  });

  // Summary card clicks
  document.getElementById('card-income-wrap').addEventListener('click', () => setFilter('direction', 'income'));
  document.getElementById('card-expenses-wrap').addEventListener('click', () => setFilter('direction', 'expenses'));
  document.getElementById('card-net-wrap').addEventListener('click', () => clearFilter());

  // Search
  document.getElementById('search-input').addEventListener('input', renderTable);

  // Filter clear
  document.getElementById('btn-clear-filter').addEventListener('click', clearFilter);

  // Category chart type toggle
  document.getElementById('btn-toggle-cat-chart').addEventListener('click', () => {
    catChartType = catChartType === 'doughnut' ? 'bar' : 'doughnut';
    document.getElementById('btn-toggle-cat-chart').textContent = catChartType === 'doughnut' ? 'Bar' : 'Donut';
    if (currentSummary) renderCategoryChart(currentSummary.categoryBreakdown);
  });

  // Advisor
  document.getElementById('btn-get-insights').addEventListener('click', loadAdvisor);
  document.getElementById('advisor-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); loadAdvisor(); }
  });
  document.getElementById('btn-collapse-advisor')?.addEventListener('click', toggleAdvisor);
  document.getElementById('btn-advisor-mobile')?.addEventListener('click', showAdvisorMobile);
  document.getElementById('btn-refresh-brief')?.addEventListener('click', () => {
    localStorage.removeItem(BRIEF_CACHE_KEY);
    const messages = document.getElementById('advisor-messages');
    messages.innerHTML = '';
    loadAdvisorBrief();
  });

  // Reset comparison checks
  document.getElementById('btn-reset-cc-compare')?.addEventListener('click', () => {
    compareCardIds = [];
    renderCcSimulator();
  });

  // Payee panel close
  document.getElementById('payee-panel-close').addEventListener('click', closePayeePanel);
  document.getElementById('payee-panel').addEventListener('click', (e) => {
    if (e.target === document.getElementById('payee-panel')) closePayeePanel();
  });

  // Compare
  document.getElementById('btn-compare').addEventListener('click', () => {
    document.getElementById('compare-panel').classList.toggle('hidden');
    if (!document.getElementById('compare-panel').classList.contains('hidden')) loadComparison();
  });
  document.getElementById('btn-close-compare').addEventListener('click', () => {
    document.getElementById('compare-panel').classList.add('hidden');
  });
  document.getElementById('compare-month').addEventListener('change', loadComparison);

  // Actual link
  api('/api/config').then(cfg => {
    if (cfg.actualServerUrl) {
      const btn = document.getElementById('btn-actual');
      btn.href = cfg.actualServerUrl;
      btn.classList.remove('hidden');
    }
  });

  // AI provider label
  api('/api/ai-provider').then(data => {
    const el = document.getElementById('advisor-title');
    if (el) el.textContent = `AI Advisor · ${data.label}`;
  }).catch(() => {});

  // Trend chart controls
  document.getElementById('btn-toggle-trend').addEventListener('click', () => {
    trendStacked = !trendStacked;
    document.getElementById('btn-toggle-trend').textContent = trendStacked ? 'Overall' : 'Stacked';
    loadTrendChart();
  });
  document.getElementById('trend-months-select').addEventListener('change', loadTrendChart);

  // CC Sim rows interactions
  const ccSimRows = document.getElementById('cc-sim-rows');
  if (ccSimRows) {
    ccSimRows.addEventListener('click', (e) => {
      const toggleCheck = e.target.closest('.cc-toggle-use');
      if (toggleCheck) {
        const cardId = toggleCheck.getAttribute('data-id');
        toggleCardExclusion(cardId);
        return;
      }
      
      const toggleExclude = e.target.closest('.cc-toggle-exclude');
      if (toggleExclude) {
        e.stopPropagation();
        const cardId = toggleExclude.getAttribute('data-id');
        toggleCardExclusionPersistent(cardId);
        return;
      }
      
      const clickableTd = e.target.closest('.cc-row-toggle');
      if (clickableTd) {
        const tr = clickableTd.closest('tr');
        if (tr && tr.hasAttribute('data-card-id')) {
          const cardId = tr.getAttribute('data-card-id');
          toggleCardDetails(cardId);
        }
      }
    });
  }

  // Refresh Insights button binding
  const btnRefreshInsights = document.getElementById('btn-refresh-insights');
  if (btnRefreshInsights) {
    btnRefreshInsights.addEventListener('click', () => {
      loadInsights(true); // forceRefresh = true
    });
  }

  // Set initial advisor sidebar visibility (hidden on dashboard by default)
  document.getElementById('advisor-sidebar')?.classList.add('hidden');
  document.getElementById('btn-advisor-mobile')?.classList.add('hidden');

  loadDashboard();
  loadAdvisorBrief();
  loadTrendChart();
}

// ── API helper ───────────────────────────────────────────────────────────

async function api(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ── Load dashboard ───────────────────────────────────────────────────────

async function loadDashboard() {
  const [summary, txns] = await Promise.all([
    api(`/api/summary?month=${currentMonth}`),
    api(`/api/transactions?month=${currentMonth}`),
  ]);

  currentTransactions = txns;
  currentSummary = summary;

  // Clear stale advisor messages when month changes
  if (advisorMonth && advisorMonth !== currentMonth) {
    const messages = document.getElementById('advisor-messages');
    messages.innerHTML = '<p id="advisor-placeholder" class="text-white/15 text-xs text-center pt-6 leading-relaxed">Ask anything about<br>your finances</p>';
    document.getElementById('btn-get-insights').textContent = 'Get Insights';
    advisorMonth = null;
    conversationHistory = [];
  }
  renderSummary(summary);
  renderCategoryChart(summary.categoryBreakdown);
  renderPayeeChart(summary.topPayees);
  clearFilter();
  renderTable();
}

// ── Summary cards ────────────────────────────────────────────────────────

function renderSummary(s) {
  document.getElementById('card-income').textContent = fmt(s.income);
  document.getElementById('card-expenses').textContent = fmt(s.expenses);
  const netEl = document.getElementById('card-net');
  netEl.textContent = fmt(s.net);
  netEl.className = `text-2xl font-light ${s.net >= 0 ? 'text-green-400/80' : 'text-red-400/80'}`;
}

// ── Category doughnut chart ──────────────────────────────────────────────

function renderCategoryChart(breakdown) {
  const ctx = document.getElementById('chart-categories');
  if (categoryChart) categoryChart.destroy();

  const labels = breakdown.map(c => c.name);
  const data = breakdown.map(c => Math.abs(c.total));

  if (catChartType === 'bar') {
    categoryChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: COLORS.slice(0, labels.length),
          borderRadius: 4,
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => fmt(-ctx.raw) } },
        },
        scales: {
          x: {
            ticks: { color: 'rgba(255,255,255,0.3)', callback: (v) => '$' + v },
            grid: { color: 'rgba(255,255,255,0.04)' },
          },
          y: {
            ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 11 } },
            grid: { display: false },
          },
        },
        onClick: (e, elements) => {
          if (elements.length) setFilter('category', labels[elements[0].index]);
        },
      },
    });
  } else {
    categoryChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: COLORS.slice(0, labels.length),
          borderWidth: 0,
          hoverBorderWidth: 2,
          hoverBorderColor: 'rgba(255,255,255,0.3)',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '55%',
        plugins: {
          legend: {
            position: 'right',
            labels: { color: 'rgba(255,255,255,0.5)', font: { size: 11 }, padding: 8, boxWidth: 12 },
            onClick: (e, legendItem) => setFilter('category', legendItem.text),
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.label}: ${fmt(-ctx.raw)} (${ctx.dataset.data.length > 0 ? Math.round(ctx.raw / ctx.dataset.data.reduce((a, b) => a + b, 0) * 100) : 0}%)`,
            },
          },
        },
        onClick: (e, elements) => {
          if (elements.length) setFilter('category', labels[elements[0].index]);
        },
      },
    });
  }
}

// ── Payee horizontal bar chart ───────────────────────────────────────────

function renderPayeeChart(topPayees) {
  const ctx = document.getElementById('chart-payees');
  if (payeeChart) payeeChart.destroy();

  const labels = topPayees.map(p => p.name);
  const data = topPayees.map(p => Math.abs(p.total));

  payeeChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: 'rgba(99, 102, 241, 0.6)',
        borderRadius: 4,
        hoverBackgroundColor: 'rgba(99, 102, 241, 0.9)',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: (ctx) => fmt(-ctx.raw) },
        },
      },
      scales: {
        x: {
          ticks: { color: 'rgba(255,255,255,0.3)', callback: (v) => '$' + v },
          grid: { color: 'rgba(255,255,255,0.04)' },
        },
        y: {
          ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 11 } },
          grid: { display: false },
        },
      },
      onClick: (e, elements) => {
        if (elements.length) setFilter('payee', labels[elements[0].index]);
      },
    },
  });
}

// ── Transaction table ────────────────────────────────────────────────────

function renderTable() {
  const search = document.getElementById('search-input').value.toLowerCase();
  let txns = currentTransactions;

  // Apply active filter
  if (activeFilter) {
    if (activeFilter.type === 'category') txns = txns.filter(t => t.category === activeFilter.value);
    if (activeFilter.type === 'payee') txns = txns.filter(t => t.payee === activeFilter.value);
    if (activeFilter.type === 'direction') {
      txns = activeFilter.value === 'income'
        ? txns.filter(t => t.amount > 0)
        : txns.filter(t => t.amount < 0);
    }
  }

  // Apply search
  if (search) {
    txns = txns.filter(t =>
      t.payee.toLowerCase().includes(search) ||
      t.category.toLowerCase().includes(search) ||
      t.notes.toLowerCase().includes(search) ||
      t.account.toLowerCase().includes(search)
    );
  }

  // Sort
  txns = [...txns].sort((a, b) => {
    let va = a[sortCol], vb = b[sortCol];
    if (typeof va === 'string') return va.localeCompare(vb) * sortDir;
    return ((va || 0) - (vb || 0)) * sortDir;
  });

  document.getElementById('txn-count').textContent = `(${txns.length})`;

  const tbody = document.getElementById('txn-body');
  tbody.innerHTML = '';

  for (const t of txns) {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-white/[0.02] transition-colors';
    tr.innerHTML = `
      <td class="py-2 px-3 text-white/50 text-xs whitespace-nowrap">${t.date}</td>
      <td class="py-2 px-3">
        <button class="text-white/70 hover:text-indigo-400 transition-colors text-left payee-link">${esc(t.payee)}</button>
      </td>
      <td class="py-2 px-3 hidden sm:table-cell">
        <button class="text-white/40 hover:text-indigo-400 transition-colors text-left category-link text-xs">${esc(t.category)}</button>
      </td>
      <td class="py-2 px-3 text-right font-mono text-xs ${t.amount < 0 ? 'text-white/50' : 'text-green-400/70'}">${fmt(t.amount)}</td>
      <td class="py-2 px-3 text-white/25 text-xs hidden sm:table-cell">${esc(t.account)}</td>
    `;

    tr.querySelector('.payee-link')?.addEventListener('click', () => setFilter('payee', t.payee));
    tr.querySelector('.category-link')?.addEventListener('click', () => setFilter('category', t.category));

    tbody.appendChild(tr);
  }
}

// ── Filtering ────────────────────────────────────────────────────────────

function setFilter(type, value) {
  if (!value) return;
  activeFilter = { type, value };

  // Calculate filtered total for verification
  let filtered = currentTransactions;
  if (type === 'category') filtered = filtered.filter(t => t.category === value);
  if (type === 'payee') filtered = filtered.filter(t => t.payee === value);
  if (type === 'direction') filtered = value === 'income'
    ? filtered.filter(t => t.amount > 0)
    : filtered.filter(t => t.amount < 0);

  const total = filtered.reduce((s, t) => s + t.amount, 0);
  const label = type === 'direction' ? value : `${type}: ${value}`;
  document.getElementById('filter-label').textContent = `${label} — Total: ${fmt(total)} (${filtered.length} txns)`;
  document.getElementById('filter-bar').classList.remove('hidden');

  // Show "all time →" only for payee filters
  const allTimeBtn = document.getElementById('btn-all-time');
  if (type === 'payee') {
    allTimeBtn.classList.remove('hidden');
    allTimeBtn.onclick = () => openPayeePanel(value);
  } else {
    allTimeBtn.classList.add('hidden');
  }

  // When filtering by category, update payee chart to show top payees within that category
  if (type === 'category') {
    const catTxns = currentTransactions.filter(t => t.category === value && t.amount < 0);
    const payeeTotals = {};
    for (const t of catTxns) {
      const p = t.payee || 'Unknown';
      if (!payeeTotals[p]) payeeTotals[p] = { name: p, total: 0, count: 0 };
      payeeTotals[p].total += t.amount;
      payeeTotals[p].count++;
    }
    const topPayees = Object.values(payeeTotals).sort((a, b) => a.total - b.total).slice(0, 10);
    renderPayeeChart(topPayees);
  }

  renderTable();
}

function clearFilter() {
  activeFilter = null;
  document.getElementById('filter-bar').classList.add('hidden');
  document.getElementById('btn-all-time').classList.add('hidden');
  if (currentSummary) renderPayeeChart(currentSummary.topPayees);
  renderTable();
}

// ── Comparison ───────────────────────────────────────────────────────────

async function loadComparison() {
  const compareMonth = document.getElementById('compare-month').value;
  const data = await api(`/api/compare?months=${currentMonth},${compareMonth}`);
  const a = data[currentMonth];
  const b = data[compareMonth];
  if (!a || !b) return;

  const diff = {
    income: a.income - b.income,
    // For expenses, we want magnitude change: current_magnitude - comparison_magnitude
    // If current is -500 and comparison is -1000, diff is 500 - 1000 = -500 (spent less)
    expenses: Math.abs(a.expenses) - Math.abs(b.expenses),
    net: a.net - b.net,
  };

  const expenseAbsDiff = Math.abs(diff.expenses);
  const expenseMsg = diff.expenses > 0 
    ? `<span class="text-red-400/80">spent ${fmt(expenseAbsDiff)} more</span>`
    : `<span class="text-green-400/80">spent ${fmt(expenseAbsDiff)} less</span>`;

  const container = document.getElementById('compare-content');
  container.innerHTML = `
    <div class="col-span-full bg-white/[0.03] border border-white/5 rounded-lg p-3 mb-2 flex items-center justify-between">
      <div class="text-xs text-white/40 uppercase tracking-widest">Comparison Summary</div>
      <div class="text-sm text-white/70">
        In ${formatMonthLabel(currentMonth)}, you ${expenseMsg} than in ${formatMonthLabel(compareMonth)}.
      </div>
    </div>
    <div>
      <div class="text-white/50 text-sm font-medium mb-3">${formatMonthLabel(currentMonth)}</div>
      ${compareSummaryHTML(a, diff)}
      ${compareCategoriesHTML(a.categoryBreakdown, b.categoryBreakdown)}
    </div>
    <div>
      <div class="text-white/50 text-sm font-medium mb-3">${formatMonthLabel(compareMonth)}</div>
      ${compareSummaryHTML(b)}
      ${compareCategoriesHTML(b.categoryBreakdown, a.categoryBreakdown)}
    </div>
  `;
}

function compareSummaryHTML(s, diff = null) {
  const renderDelta = (val, type) => {
    if (!diff) return '<div class="text-[10px] invisible mt-1 font-mono">&nbsp;</div>';
    const absVal = Math.abs(val);
    let color = 'text-white/20';
    let prefix = val >= 0 ? '+' : '';
    
    if (type === 'income') {
      color = val > 0 ? 'text-green-400/40' : (val < 0 ? 'text-red-400/40' : 'text-white/20');
    } else if (type === 'expenses') {
      // Expenses: positive change = more spent (red), negative change = less spent (green)
      color = val > 0 ? 'text-red-400/40' : (val < 0 ? 'text-green-400/40' : 'text-white/20');
    } else {
      color = val > 0 ? 'text-green-400/40' : (val < 0 ? 'text-red-400/40' : 'text-white/20');
    }

    return `<div class="text-[10px] ${color} mt-1 font-mono">${prefix}${fmt(val)}</div>`;
  };

  return `
    <div class="grid grid-cols-3 gap-2 mb-4">
      <div class="bg-surface rounded-lg p-3">
        <div class="text-white/25 text-[10px] uppercase">Income</div>
        <div class="text-green-400/70 text-sm font-mono">${fmt(s.income)}</div>
        ${renderDelta(diff?.income, 'income')}
      </div>
      <div class="bg-surface rounded-lg p-3">
        <div class="text-white/25 text-[10px] uppercase">Expenses</div>
        <div class="text-red-400/70 text-sm font-mono">${fmt(s.expenses)}</div>
        ${renderDelta(diff?.expenses, 'expenses')}
      </div>
      <div class="bg-surface rounded-lg p-3">
        <div class="text-white/25 text-[10px] uppercase">Net</div>
        <div class="${s.net >= 0 ? 'text-green-400/70' : 'text-red-400/70'} text-sm font-mono">${fmt(s.net)}</div>
        ${renderDelta(diff?.net, 'net')}
      </div>
    </div>
  `;
}

function compareCategoriesHTML(breakdown, otherBreakdown = []) {
  return `
    <div class="space-y-1">
      ${breakdown.map(c => {
        const other = otherBreakdown.find(oc => oc.name === c.name);
        // Magnitude change: spent 500 vs spent 1000 = -500 (spent less)
        const delta = other ? Math.abs(c.total) - Math.abs(other.total) : null;
        const catId = esc(c.name).replace(/\s+/g, '-');
        
        return `
          <div class="flex items-center justify-between text-xs px-2 py-1.5 transition-colors duration-150 group" 
               data-cat="${catId}"
               onmouseover="highlightCategory('${catId}')" 
               onmouseout="unhighlightCategory('${catId}')">
            <span class="text-white/50 truncate mr-2">
              ${esc(c.name)}
              <span class="text-white/15 ml-1 text-[10px]">(${c.count})</span>
            </span>
            <div class="flex flex-col items-end flex-shrink-0">
              <span class="text-white/30 font-mono">${fmt(c.total)}</span>
              ${delta !== null ? `
                <span class="cat-delta text-[9px] font-mono opacity-0 transition-opacity ${delta > 0 ? 'text-red-400/50' : (delta < 0 ? 'text-green-400/50' : 'text-white/20')}">
                  ${delta > 0 ? '+' : ''}${fmt(delta)}
                </span>
              ` : '<span class="cat-delta text-[9px] font-mono invisible">&nbsp;</span>'}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function highlightCategory(id) {
  document.querySelectorAll(`[data-cat="${id}"]`).forEach(el => {
    el.classList.add('bg-white/[0.06]', 'rounded-lg');
    el.querySelector('.cat-delta')?.classList.remove('opacity-0');
    el.querySelector('.cat-delta')?.classList.remove('invisible');
  });
}

function unhighlightCategory(id) {
  document.querySelectorAll(`[data-cat="${id}"]`).forEach(el => {
    el.classList.remove('bg-white/[0.06]', 'rounded-lg');
    el.querySelector('.cat-delta')?.classList.add('opacity-0');
  });
}

// ── Advisor collapse ─────────────────────────────────────────────────────

let advisorCollapsed = false;

function showAdvisorMobile() {
  const sidebar = document.getElementById('advisor-sidebar');
  const btn = document.getElementById('btn-advisor-mobile');
  sidebar.style.display = 'flex';
  btn.style.display = 'none';
  sidebar.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function toggleAdvisor() {
  const isMobile = window.innerWidth < 768;

  if (isMobile) {
    // On mobile the ‹ button just hides the sidebar again
    const sidebar = document.getElementById('advisor-sidebar');
    sidebar.style.display = '';
    document.getElementById('btn-advisor-mobile').style.display = '';
    return;
  }

  // Desktop: collapse to icon strip
  advisorCollapsed = !advisorCollapsed;
  const sidebar = document.getElementById('advisor-sidebar');
  const btn = document.getElementById('btn-collapse-advisor');
  const title = document.getElementById('advisor-title');
  const messages = document.getElementById('advisor-messages');
  const inputArea = document.getElementById('advisor-input-area');

  if (advisorCollapsed) {
    sidebar.style.width = '32px';
    btn.textContent = '›';
    btn.title = 'Expand';
    title.classList.add('hidden');
    messages.classList.add('hidden');
    inputArea.classList.add('hidden');
  } else {
    sidebar.style.width = '320px';
    btn.textContent = '‹';
    btn.title = 'Collapse';
    title.classList.remove('hidden');
    messages.classList.remove('hidden');
    inputArea.classList.remove('hidden');
  }
}

// ── Advisor Brief (auto-opening message) ─────────────────────────────────

function appendBriefMessage(content) {
  const messages = document.getElementById('advisor-messages');
  const placeholder = document.getElementById('advisor-placeholder');
  if (placeholder) placeholder.remove();
  
  if (!content || !content.trim()) {
    appendAdvisorMessage('error', 'The advisor returned an empty response. Please try again or check your AI provider.');
    return;
  }

  const div = document.createElement('div');
  div.className = 'advisor-msg text-white/60 text-xs leading-relaxed space-y-2';
  div.innerHTML = typeof marked !== 'undefined' ? marked.parse(content) : content;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

const BRIEF_CACHE_KEY = 'advisor-brief-v1';
const BRIEF_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function loadAdvisorBrief() {
  const raw = localStorage.getItem(BRIEF_CACHE_KEY);
  const cache = raw ? JSON.parse(raw) : null;
  const stale = !cache || cache.month !== currentMonth || (Date.now() - cache.timestamp) > BRIEF_CACHE_TTL;

  if (cache?.insights && !stale) {
    appendBriefMessage(cache.insights);
    return;
  }

  const loadingEl = appendAdvisorMessage('loading', '');
  try {
    const data = await api(`/api/advisor-brief`);
    loadingEl.remove();
    if (data.insights) {
      localStorage.setItem(BRIEF_CACHE_KEY, JSON.stringify({ insights: data.insights, month: data.month, timestamp: Date.now() }));
      appendBriefMessage(data.insights);
    } else {
      appendAdvisorMessage('error', 'Advisor brief returned no insights.');
    }
  } catch (err) {
    loadingEl.remove();
    appendAdvisorMessage('error', `Brief failed: ${err.message}`);
  }
}

// ── AI Advisor ───────────────────────────────────────────────────────────

// ── AI Advisor ───────────────────────────────────────────────────────────

function createActionCard(action) {
  const card = document.createElement('div');
  card.className = 'mt-3 p-3 bg-indigo-500/10 border border-indigo-500/25 rounded-xl space-y-2 fade-in';
  
  let desc = '';
  if (action.command === 'update_transactions') {
    const filters = [];
    if (action.filters.payee_name) filters.push(`payee matches "${action.filters.payee_name}"`);
    if (action.filters.category_name) filters.push(`category matches "${action.filters.category_name}"`);
    if (action.filters.startDate) filters.push(`since ${action.filters.startDate}`);
    
    const updates = [];
    if (action.updates.category_name) updates.push(`set category to "${action.updates.category_name}"`);
    if (action.updates.payee_name) updates.push(`set payee to "${action.updates.payee_name}"`);
    if (action.updates.notes) updates.push(`set notes to "${action.updates.notes}"`);

    desc = `Update transactions where ${filters.length ? filters.join(' and ') : 'all'} to ${updates.join(', ')}.`;
  } else if (action.command === 'create_rule') {
    const conds = action.conditions.map(c => `${c.field} ${c.op} "${c.value}"`);
    const acts = action.actions.map(a => `${a.op} ${a.field} "${a.value}"`);
    desc = `Create rule: If ${conds.join(' and ')} then ${acts.join(', ')}.`;
  } else {
    desc = `Execute action: ${action.command}`;
  }

  card.innerHTML = `
    <div class="text-[10px] text-indigo-400 font-semibold tracking-wide uppercase">Proposed Action</div>
    <div class="text-white/80 text-[11px] font-medium leading-relaxed">${esc(desc)}</div>
    
    <!-- Preview Area -->
    <div id="preview-area" class="text-[10px] text-white/40 pt-1.5 space-y-1.5">
      <div id="preview-loader" class="flex items-center gap-1.5 text-white/30">
        <span class="w-1.5 h-1.5 rounded-full bg-white/20 animate-pulse"></span>
        <span>Calculating affected transactions...</span>
      </div>
      <div id="preview-details" class="hidden space-y-1.5">
        <div class="flex items-center justify-between">
          <span id="preview-count" class="font-medium text-white/50"></span>
          <button id="btn-toggle-preview" class="text-indigo-400 hover:text-indigo-300 font-medium transition-colors hidden">Show details</button>
        </div>
        <div id="preview-list" class="mt-1.5 hidden border border-white/[0.04] bg-black/20 p-2 rounded-lg max-h-32 overflow-y-auto space-y-1 divide-y divide-white/[0.03]"></div>
        <div id="preview-warning" class="text-yellow-400/80 font-medium hidden"></div>
        <div id="preview-checkbox-wrap" class="hidden"></div>
      </div>
    </div>

    <div class="flex gap-2 mt-2" id="action-buttons">
      <button id="btn-confirm-action" class="flex-1 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition-all">Confirm</button>
      <button id="btn-cancel-action" class="flex-1 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 text-xs font-medium transition-all">Cancel</button>
    </div>
    <div id="action-status" class="hidden text-xs font-medium pt-1"></div>
    <div id="undo-area" class="hidden pt-1"></div>
  `;

  const previewLoader = card.querySelector('#preview-loader');
  const previewDetails = card.querySelector('#preview-details');
  const previewCount = card.querySelector('#preview-count');
  const btnTogglePreview = card.querySelector('#btn-toggle-preview');
  const previewList = card.querySelector('#preview-list');
  const previewWarning = card.querySelector('#preview-warning');
  const previewCheckboxWrap = card.querySelector('#preview-checkbox-wrap');
  
  const btnConfirm = card.querySelector('#btn-confirm-action');
  const btnCancel = card.querySelector('#btn-cancel-action');
  const btnArea = card.querySelector('#action-buttons');
  const statusDiv = card.querySelector('#action-status');
  const undoArea = card.querySelector('#undo-area');

  // Disable confirm until preview loads
  btnConfirm.disabled = true;
  btnConfirm.classList.add('opacity-50', 'cursor-not-allowed');

  // Fetch preview asynchronously
  fetch('/api/advisor/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  })
    .then(res => res.json())
    .then(data => {
      previewLoader.classList.add('hidden');
      previewDetails.classList.remove('hidden');

      if (!data.success) {
        previewCount.textContent = 'Failed to load preview details.';
        btnConfirm.disabled = false;
        btnConfirm.classList.remove('opacity-50', 'cursor-not-allowed');
        return;
      }

      const count = data.count;
      
      // Update match count display
      previewCount.textContent = count === 1 ? 'Affects 1 transaction' : `Affects ${count} transactions`;

      if (count === 0) {
        // 0 matches: disable confirm
        previewCount.className = 'text-red-400/80 font-medium';
        previewCount.textContent = 'No matching transactions found.';
        btnConfirm.disabled = true;
        btnConfirm.classList.add('opacity-50', 'cursor-not-allowed');
        return;
      }

      // Re-enable confirm by default (unless bulk limit applies)
      btnConfirm.disabled = false;
      btnConfirm.classList.remove('opacity-50', 'cursor-not-allowed');

      // Populate preview list if transactions exist
      if (data.transactions && data.transactions.length > 0) {
        btnTogglePreview.classList.remove('hidden');
        previewList.innerHTML = data.transactions.map(t => `
          <div class="pt-1 first:pt-0 text-[10px] flex items-center justify-between gap-1.5 font-mono text-white/45">
            <span class="text-white/20 whitespace-nowrap">${t.date}</span>
            <span class="truncate max-w-[100px] text-white/60">${esc(t.payee)}</span>
            <span class="truncate max-w-[80px] text-white/30">${esc(t.category || 'Uncategorized')}</span>
            <span class="${t.amount < 0 ? 'text-white/40' : 'text-green-500/50'} ml-auto whitespace-nowrap">${fmt(t.amount)}</span>
          </div>
        `).join('');

        btnTogglePreview.addEventListener('click', () => {
          const isHidden = previewList.classList.contains('hidden');
          if (isHidden) {
            previewList.classList.remove('hidden');
            btnTogglePreview.textContent = 'Hide details';
          } else {
            previewList.classList.add('hidden');
            btnTogglePreview.textContent = 'Show details';
          }
        });
      }

      // Bulk actions styling & controls
      if (count > 10) {
        // Warning background/border
        card.classList.remove('bg-indigo-500/10', 'border-indigo-500/25');
        card.classList.add('bg-yellow-500/5', 'border-yellow-500/25');
        previewWarning.classList.remove('hidden');
        previewWarning.textContent = count > 50 
          ? `⚠️ Critical: Very large change affecting ${count} transactions!`
          : `⚠️ Warning: Bulk change affecting ${count} transactions.`;
      }

      if (count > 50) {
        // Require checkbox confirmation
        btnConfirm.disabled = true;
        btnConfirm.classList.add('opacity-50', 'cursor-not-allowed');

        previewCheckboxWrap.classList.remove('hidden');
        previewCheckboxWrap.innerHTML = `
          <label class="flex items-start gap-1.5 mt-2 cursor-pointer select-none">
            <input type="checkbox" id="chk-bulk-confirm" class="mt-0.5 rounded border-white/10 bg-black/40 text-indigo-500 focus:ring-0">
            <span class="text-[9px] text-white/45 leading-normal">I understand this will bulk-update ${count} transactions in the database.</span>
          </label>
        `;

        const checkbox = previewCheckboxWrap.querySelector('#chk-bulk-confirm');
        checkbox.addEventListener('change', (e) => {
          if (e.target.checked) {
            btnConfirm.disabled = false;
            btnConfirm.classList.remove('opacity-50', 'cursor-not-allowed');
          } else {
            btnConfirm.disabled = true;
            btnConfirm.classList.add('opacity-50', 'cursor-not-allowed');
          }
        });
      }
    })
    .catch(err => {
      previewLoader.classList.add('hidden');
      previewDetails.classList.remove('hidden');
      previewCount.textContent = 'Could not fetch transaction preview.';
      btnConfirm.disabled = false;
      btnConfirm.classList.remove('opacity-50', 'cursor-not-allowed');
    });

  btnConfirm.addEventListener('click', async () => {
    btnConfirm.disabled = true;
    btnCancel.disabled = true;
    btnConfirm.textContent = 'Applying...';
    
    try {
      const res = await fetch('/api/advisor/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error || res.statusText);
      }
      const data = await res.json();
      btnArea.remove();
      
      // Update warning/checkbox style back to neutral
      card.classList.remove('bg-yellow-500/5', 'border-yellow-500/25');
      card.classList.add('bg-green-500/5', 'border-green-500/25');

      statusDiv.className = 'text-green-400/80 text-[11px] font-medium pt-1 fade-in';
      statusDiv.innerHTML = `✓ Applied: ${data.message || 'Success'}`;
      if (data.backupFile) {
        statusDiv.innerHTML += `<div class="text-white/30 text-[9px] mt-0.5">Pre-action backup saved: ${data.backupFile}</div>`;
      }
      statusDiv.classList.remove('hidden');

      // Add Undo UI
      if (data.backupFile) {
        undoArea.classList.remove('hidden');
        undoArea.innerHTML = `
          <button id="btn-undo-action" class="mt-2 w-full py-1.5 rounded-lg bg-red-950/20 hover:bg-red-950/50 text-red-400 border border-red-500/20 text-[10px] font-semibold transition-all">
            Undo Database Modifications
          </button>
        `;
        const btnUndo = undoArea.querySelector('#btn-undo-action');
        btnUndo.addEventListener('click', async () => {
          btnUndo.disabled = true;
          btnUndo.textContent = 'Restoring database...';
          try {
            const undoRes = await fetch('/api/advisor/undo', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ backupFile: data.backupFile }),
            });
            if (!undoRes.ok) {
              const e = await undoRes.json();
              throw new Error(e.error || undoRes.statusText);
            }
            
            // Switch card style back to neutral/disabled
            card.classList.remove('bg-green-500/5', 'border-green-500/25');
            card.classList.add('bg-white/[0.02]', 'border-white/5');
            statusDiv.className = 'text-white/30 text-[11px] font-medium pt-1 fade-in';
            statusDiv.textContent = `✗ Reverted: Database restored successfully.`;
            undoArea.remove();
            
            // Reload dashboard to update everything!
            loadDashboard();
          } catch (undoErr) {
            btnUndo.disabled = false;
            btnUndo.textContent = 'Undo Database Modifications';
            alert(`Undo failed: ${undoErr.message}`);
          }
        });
      }

      // Refresh the dashboard automatically in real-time
      loadDashboard();
      
    } catch (err) {
      btnConfirm.disabled = false;
      btnCancel.disabled = false;
      btnConfirm.textContent = 'Confirm';
      statusDiv.className = 'text-red-400/80 text-xs font-medium pt-1';
      statusDiv.textContent = `✗ Failed: ${err.message}`;
      statusDiv.classList.remove('hidden');
    }
  });

  btnCancel.addEventListener('click', () => {
    btnArea.remove();
    statusDiv.className = 'text-white/20 text-xs font-medium pt-1 fade-in';
    statusDiv.textContent = `✗ Cancelled`;
    statusDiv.classList.remove('hidden');
  });

  return card;
}

function appendAdvisorMessage(role, content, action = null) {
  const messages = document.getElementById('advisor-messages');
  const placeholder = document.getElementById('advisor-placeholder');
  if (placeholder) placeholder.remove();

  const div = document.createElement('div');

  if (role === 'user') {
    div.className = 'flex justify-end';
    div.innerHTML = `<div class="bg-white/8 rounded-xl rounded-tr-sm px-3 py-2 text-white/55 text-xs max-w-[90%]">${esc(content)}</div>`;
  } else if (role === 'loading') {
    div.className = 'flex gap-1.5 items-center advisor-loading-msg';
    div.id = 'advisor-loading';
    div.innerHTML = `
      <span class="w-1.5 h-1.5 rounded-full bg-white/20 animate-bounce" style="animation-delay:0ms"></span>
      <span class="w-1.5 h-1.5 rounded-full bg-white/20 animate-bounce" style="animation-delay:150ms"></span>
      <span class="w-1.5 h-1.5 rounded-full bg-white/20 animate-bounce" style="animation-delay:300ms"></span>`;
  } else if (role === 'error') {
    div.className = 'advisor-msg p-3 rounded-lg bg-red-500/5 border border-red-500/20 text-red-400/80 text-xs italic';
    div.textContent = `Error: ${content}`;
  } else {
    div.className = 'advisor-msg text-white/60 text-xs leading-relaxed space-y-2';
    div.innerHTML = marked.parse(content);

    if (action) {
      const card = createActionCard(action);
      div.appendChild(card);
    }
  }

  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

async function loadAdvisor() {
  const btn = document.getElementById('btn-get-insights');
  const input = document.getElementById('advisor-input');
  const question = input.value.trim();

  // Clear and lock immediately to prevent duplicate submissions
  input.value = '';
  input.disabled = true;
  btn.textContent = 'Analyzing…';
  btn.disabled = true;

  if (question) appendAdvisorMessage('user', question);
  const loadingEl = appendAdvisorMessage('loading', '');

  try {
    const res = await fetch('/api/advisor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month: currentMonth, question, history: conversationHistory }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || res.statusText); }
    const { insights, action } = await res.json();
    loadingEl.remove();
    appendAdvisorMessage('assistant', insights, action);
    if (question) conversationHistory.push({ role: 'user', content: question });
    conversationHistory.push({ role: 'assistant', content: insights });
    advisorMonth = currentMonth;
    btn.textContent = 'Ask';
  } catch (err) {
    loadingEl.remove();
    appendAdvisorMessage('error', err.message);
    btn.textContent = 'Get Insights';
  } finally {
    input.disabled = false;
    input.focus();
    btn.disabled = false;
  }
}

// ── Payee detail panel ───────────────────────────────────────────────────

async function openPayeePanel(payee) {
  if (!payee) return;
  const panel = document.getElementById('payee-panel');
  panel.classList.remove('hidden');
  document.getElementById('payee-panel-title').textContent = payee;
  document.getElementById('payee-panel-total').textContent = 'Loading…';
  document.getElementById('payee-panel-txns').innerHTML = '';
  if (payeeHistoryChart) { payeeHistoryChart.destroy(); payeeHistoryChart = null; }

  const [history, config] = await Promise.all([
    api(`/api/payee-history?name=${encodeURIComponent(payee)}`),
    api('/api/config'),
  ]);

  const total = history.transactions.reduce((s, t) => s + t.amount, 0);
  document.getElementById('payee-panel-total').textContent =
    `${fmt(total)} across ${history.transactions.length} transaction${history.transactions.length === 1 ? '' : 's'}`;

  const link = document.getElementById('payee-panel-actual-link');
  link.href = config.actualServerUrl || '#';
  if (!config.actualServerUrl) link.style.display = 'none';

  const ctx = document.getElementById('chart-payee-history');
  payeeHistoryChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: history.months.map(m => formatMonthLabel(m.month)),
      datasets: [{
        data: history.months.map(m => Math.abs(m.total)),
        backgroundColor: 'rgba(99, 102, 241, 0.5)',
        borderRadius: 3,
        hoverBackgroundColor: 'rgba(99, 102, 241, 0.8)',
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => fmt(-ctx.raw) } },
      },
      scales: {
        x: { ticks: { color: 'rgba(255,255,255,0.3)', font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: 'rgba(255,255,255,0.3)', callback: (v) => '$' + v }, grid: { color: 'rgba(255,255,255,0.04)' } },
      },
    },
  });

  const tbody = document.getElementById('payee-panel-txns');
  for (const t of history.transactions) {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-white/[0.02] transition-colors';
    tr.innerHTML = `
      <td class="py-2 px-5 text-white/40 text-xs whitespace-nowrap">${t.date}</td>
      <td class="py-2 px-5 text-white/35 text-xs">${esc(t.category)}</td>
      <td class="py-2 px-5 text-right font-mono text-xs ${t.amount < 0 ? 'text-white/50' : 'text-green-400/70'}">${fmt(t.amount)}</td>
      <td class="py-2 px-5 text-white/25 text-xs hidden sm:table-cell">${esc(t.account)}</td>
    `;
    tbody.appendChild(tr);
  }
}

function closePayeePanel() {
  document.getElementById('payee-panel').classList.add('hidden');
  if (payeeHistoryChart) { payeeHistoryChart.destroy(); payeeHistoryChart = null; }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function fmt(n) {
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-$${abs}` : `$${abs}`;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function formatMonthLabel(m) {
  const [y, mo] = m.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[parseInt(mo) - 1]} ${y}`;
}

function populateMonthSelect(id, months, selected) {
  const sel = document.getElementById(id);
  sel.innerHTML = '';
  for (const m of months) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = formatMonthLabel(m);
    if (m === selected) opt.selected = true;
    sel.appendChild(opt);
  }
}

function updateExportLink() {
  document.getElementById('btn-export').href = `/api/export?month=${currentMonth}`;
}

// ── Spending Trend chart ─────────────────────────────────────────────────

async function loadTrendChart() {
  const n = document.getElementById('trend-months-select').value || '12';
  try {
    const data = await api(`/api/spending-trend?months=${n}`);
    renderTrendChart(data);
  } catch (err) {
    // silent — chart stays blank if server unavailable
  }
}

function renderTrendChart(data) {
  const ctx = document.getElementById('chart-trend');
  if (trendChart) trendChart.destroy();

  const labels = data.months.map(formatMonthLabel);

  let datasets;
  if (trendStacked) {
    // One dataset per category, sorted by total spend descending
    const cats = Object.entries(data.byCategory)
      .map(([name, values]) => ({ name, values, total: values.reduce((s, v) => s + v, 0) }))
      .sort((a, b) => b.total - a.total);

    datasets = cats.map((cat, i) => ({
      label: cat.name,
      data: cat.values,
      backgroundColor: COLORS[i % COLORS.length],
      borderWidth: 0,
      borderRadius: 2,
      stack: 'expenses',
    }));
  } else {
    datasets = [{
      label: 'Expenses',
      data: data.totals,
      backgroundColor: data.months.map((m, i) =>
        i === data.months.length - 1 ? 'rgba(99,102,241,0.8)' : 'rgba(99,102,241,0.35)'
      ),
      hoverBackgroundColor: 'rgba(99,102,241,0.9)',
      borderRadius: 3,
      borderWidth: 0,
    }];
  }

  // Add average line
  const currentMonthStr = new Date().toISOString().slice(0, 7);
  const isLastMonthCurrent = data.months[data.months.length - 1] === currentMonthStr;
  const avgData = isLastMonthCurrent && data.totals.length > 1 ? data.totals.slice(0, -1) : data.totals;
  const avg = avgData.length > 0 ? avgData.reduce((a, b) => a + b, 0) / avgData.length : 0;

  datasets.push({
    type: 'line',
    label: 'Average',
    data: new Array(data.months.length).fill(avg),
    borderColor: 'rgba(255, 255, 255, 0.2)',
    borderWidth: 1.5,
    borderDash: [6, 4],
    pointRadius: 0,
    hitRadius: 10,
    fill: false,
    order: -1,
  });

  trendChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      onClick: (e, elements) => {
        console.log('trendChart onClick triggered. Elements:', elements);
        if (elements.length) {
          const index = elements[0].index;
          const clickedMonth = data.months[index];
          console.log('Switching to month:', clickedMonth);
          if (clickedMonth && clickedMonth !== currentMonth) {
            currentMonth = clickedMonth;
            const selectEl = document.getElementById('month-select');
            if (selectEl) selectEl.value = clickedMonth;
            updateExportLink();
            loadDashboard();
          }
        }
      },
      plugins: {
        legend: trendStacked
          ? {
            position: 'bottom',
            labels: {
              color: 'rgba(255,255,255,0.35)',
              font: { size: 10 },
              padding: 8,
              boxWidth: 10,
              // Don't show Average in legend
              filter: (item) => item.text !== 'Average'
            }
          }
          : { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => (trendStacked || ctx.dataset.label === 'Average')
              ? `${ctx.dataset.label}: ${fmt(-ctx.raw)}`
              : fmt(-ctx.raw),
          },
        },
      },
      scales: {
        x: {
          stacked: trendStacked,
          ticks: { color: 'rgba(255,255,255,0.3)', font: { size: 10 } },
          grid: { display: false },
        },
        y: {
          stacked: trendStacked,
          ticks: { color: 'rgba(255,255,255,0.3)', callback: (v) => '$' + v },
          grid: { color: 'rgba(255,255,255,0.04)' },
        },
      },
    },
  });
}

let insightsLoading = false;

async function loadInsights(forceRefresh = false) {
  const cacheKey = `${INSIGHTS_CACHE_KEY}_${currentMonth}`;
  if (!forceRefresh) {
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const cache = JSON.parse(raw);
        if (cache && (Date.now() - cache.timestamp) < INSIGHTS_CACHE_TTL) {
          if (ccComparisonChart) { ccComparisonChart.destroy(); ccComparisonChart = null; }
          if (ratioDonutChart) { ratioDonutChart.destroy(); ratioDonutChart = null; }
          renderInsights(cache.data);
          return;
        }
      }
    } catch (e) {
      console.warn("Failed to load cached insights, fetching fresh data...", e);
      localStorage.removeItem(cacheKey);
    }
  }

  if (insightsLoading) return;
  insightsLoading = true;

  // Set loading states
  document.getElementById('pulse-percentage').textContent = '—';
  document.getElementById('pulse-status').textContent = 'Loading…';
  document.getElementById('pulse-summary').textContent = 'Fetching current month diagnostics...';
  document.getElementById('pulse-actual').textContent = '$0.00';
  document.getElementById('pulse-baseline').textContent = '$0.00';
  document.getElementById('pulse-progress-bar').style.width = '0%';
  
  document.getElementById('ratio-fixed-pct').textContent = '0%';
  document.getElementById('ratio-fixed-amt').textContent = '$0.00 (Bills, Savings, Stocks)';
  document.getElementById('ratio-variable-pct').textContent = '0%';
  document.getElementById('ratio-variable-amt').textContent = '$0.00 (Dining, Groceries, General, etc.)';
  
  document.getElementById('optimization-alpha-title').textContent = 'Analyzing credit card rewards based on your spending history...';
  document.getElementById('optimization-alpha-val').textContent = '$0.00';
  
  document.getElementById('cc-total-spend-analyzed').textContent = '$0.00';
  document.getElementById('cc-sim-rows').innerHTML = '<tr><td colspan="5" class="py-4 text-center text-white/30">Running simulations...</td></tr>';
  
  document.getElementById('leaks-container').innerHTML = '<p class="text-white/30 italic">Checking for leaks...</p>';
  document.getElementById('ai-coach-content').innerHTML = '<p class="text-white/30 italic text-center pt-8">Generating mindful reflections...</p>';

  if (ccComparisonChart) { ccComparisonChart.destroy(); ccComparisonChart = null; }
  if (ratioDonutChart) { ratioDonutChart.destroy(); ratioDonutChart = null; }

  // Clean any previous error notices
  const iv = document.getElementById('insights-view');
  if (iv) {
    const existingErr = iv.querySelector('.insights-error-notice');
    if (existingErr) existingErr.remove();
  }

  try {
    const data = await api(`/api/insights?month=${currentMonth}`);
    localStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now() }));
    renderInsights(data);
  } catch (err) {
    console.error("loadInsights error:", err);
    const pulseSummary = document.getElementById('pulse-summary');
    if (pulseSummary) pulseSummary.textContent = `Error loading insights: ${err.message}`;
    const aiCoachContent = document.getElementById('ai-coach-content');
    if (aiCoachContent) aiCoachContent.innerHTML = `<p class="text-red-400/80">Failed to load: ${err.message}</p>`;
    
    // Inject a global error notice at the top of the insights view
    if (iv) {
      const errNotice = document.createElement('div');
      errNotice.className = 'insights-error-notice p-4 mb-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs font-mono overflow-auto';
      errNotice.innerHTML = `<strong>Error Loading Insights:</strong> ${err.message}<br><pre class="mt-2 text-[10px]">${err.stack || ''}</pre>`;
      iv.insertBefore(errNotice, iv.firstChild);
    }
  } finally {
    insightsLoading = false;
  }
}

function renderInsights(data) {
  currentInsightsData = data;

  const pulse = data.pulseCheck;
  const ratios = data.ratios;
  const leaks = data.leaks;

  // 1. Render Pulse Check
  const pctStr = pulse.percentage >= 0 ? `+${pulse.percentage}%` : `${pulse.percentage}%`;
  const statusStr = pulse.diff >= 0 ? 'Above Baseline' : 'Below Baseline';
  
  const percentageEl = document.getElementById('pulse-percentage');
  percentageEl.textContent = pctStr;
  percentageEl.className = `text-4xl font-light ${pulse.diff >= 0 ? 'text-red-400/80' : 'text-green-400/80'}`;

  const statusEl = document.getElementById('pulse-status');
  statusEl.textContent = statusStr;
  statusEl.className = `text-sm font-medium ${pulse.diff >= 0 ? 'text-red-400/50' : 'text-green-400/50'}`;

  const compLabel = pulse.isProrated ? 'prorated baseline' : 'baseline';
  const actionWord = pulse.diff >= 0 ? 'above' : 'below';
  document.getElementById('pulse-summary').textContent = 
    `You are currently spending ${fmt(Math.abs(pulse.diff))} ${actionWord} your ${compLabel} of ${fmt(pulse.isProrated ? pulse.compBaseline : pulse.baselineSpend)}.`;

  document.getElementById('pulse-actual').textContent = fmt(pulse.actualSpend);
  document.getElementById('pulse-baseline').textContent = fmt(pulse.isProrated ? pulse.compBaseline : pulse.baselineSpend);

  const baselineToUse = pulse.isProrated ? pulse.compBaseline : pulse.baselineSpend;
  const progressPct = baselineToUse > 0 ? Math.min(120, (pulse.actualSpend / baselineToUse) * 100) : 0;
  
  const progressBar = document.getElementById('pulse-progress-bar');
  progressBar.style.width = `${Math.min(100, progressPct)}%`;
  if (pulse.diff > 0) {
    progressBar.className = 'bg-red-500 h-full rounded-full transition-all duration-500';
  } else {
    progressBar.className = 'bg-green-500 h-full rounded-full transition-all duration-500';
  }

  // 2. Render Ratios & Donut Chart
  document.getElementById('ratio-fixed-pct').textContent = `${ratios.fixedRatio}%`;
  document.getElementById('ratio-fixed-amt').textContent = `${fmt(ratios.fixed)} (Fixed Costs)`;
  document.getElementById('ratio-variable-pct').textContent = `${ratios.variableRatio}%`;
  document.getElementById('ratio-variable-amt').textContent = `${fmt(ratios.variable)} (Variable Lifestyle)`;

  const donutCtx = document.getElementById('ratio-donut-chart');
  if (ratioDonutChart) ratioDonutChart.destroy();
  ratioDonutChart = new Chart(donutCtx, {
    type: 'doughnut',
    data: {
      labels: ['Fixed', 'Variable'],
      datasets: [{
        data: [ratios.fixed, ratios.variable],
        backgroundColor: ['#6366f1', '#f43f5e'],
        borderWidth: 0,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label}: ${fmt(ctx.raw)}`
          }
        }
      }
    }
  });

  // 3. Render Leaks
  const leaksContainer = document.getElementById('leaks-container');
  if (leaks.length === 0) {
    leaksContainer.innerHTML = '<p class="text-white/30 italic">No creeping leaks detected.</p>';
  } else {
    leaksContainer.innerHTML = leaks.map(l => `
      <div class="flex items-center justify-between border-b border-white/5 py-1.5 last:border-0">
        <div>
          <span class="font-medium text-white/70">${esc(l.payee)}</span>
          <div class="text-[10px] text-white/30">${l.count} transactions · Avg ${fmt(l.average)}</div>
        </div>
        <span class="font-mono text-white/50 font-medium">${fmt(l.total)}</span>
      </div>
    `).join('');
  }

  // 4. Render CC Simulator
  renderCcSimulator();

  // 5. Render AI Mindful Prompt
  const aiCoach = document.getElementById('ai-coach-content');
  aiCoach.innerHTML = marked.parse(data.aiInsights || 'No reflections could be generated.');
}

function renderCcSimulator() {
  if (!currentInsightsData) return;

  const cc = currentInsightsData.ccMetrics;
  const allCards = cc.cards;
  const current = allCards.find(c => c.isCurrent);
  
  // Base active cards for recommendation and chart on selected cards if any are checked,
  // otherwise default to all non-excluded cards.
  const activeCards = compareCardIds.length > 0
    ? allCards.filter(c => compareCardIds.includes(c.id))
    : allCards.filter(c => !excludedCardIds.includes(c.id));
    
  const winner = activeCards[0]; // activeCards is already sorted by net benefit descending

  // Update Header Reset Button
  const resetBtn = document.getElementById('btn-reset-cc-compare');
  if (resetBtn) {
    if (compareCardIds.length > 0) {
      resetBtn.classList.remove('hidden');
    } else {
      resetBtn.classList.add('hidden');
    }
  }

  // Update Comparison VS Banner
  const compBanner = document.getElementById('cc-comparison-vs-banner');
  if (compareCardIds.length === 2) {
    const cardA = allCards.find(c => c.id === compareCardIds[0]);
    const cardB = allCards.find(c => c.id === compareCardIds[1]);

    if (cardA && cardB) {
      const sorted = [cardA, cardB].sort((x, y) => y.net - x.net);
      const betterCard = sorted[0];
      const otherCard = sorted[1];
      const netDelta = betterCard.net - otherCard.net;

      // Calculate category deltas
      const catDeltas = [];
      for (const catKey of Object.keys(betterCard.categoryBreakdown)) {
        const valA = betterCard.categoryBreakdown[catKey].rewards;
        const valB = otherCard.categoryBreakdown[catKey].rewards;
        const diff = valA - valB;
        if (diff !== 0) {
          catDeltas.push({
            category: catKey,
            diff: +diff.toFixed(2),
            rateLabelA: betterCard.categoryBreakdown[catKey].rateLabel,
            rateLabelB: otherCard.categoryBreakdown[catKey].rateLabel
          });
        }
      }

      const deltasHtml = catDeltas.map(d => {
        const positive = d.diff > 0;
        const amountStr = fmt(Math.abs(d.diff));
        const categoryLabel = d.category.charAt(0).toUpperCase() + d.category.slice(1);
        if (positive) {
          return `<div>🟢 <strong>${categoryLabel}</strong>: <strong>${betterCard.name.split(' (')[0]}</strong> is better by <strong>+${amountStr}</strong> (${d.rateLabelA} vs ${d.rateLabelB})</div>`;
        } else {
          return `<div>🔵 <strong>${categoryLabel}</strong>: <strong>${otherCard.name.split(' (')[0]}</strong> is better by <strong>+${amountStr}</strong> (${d.rateLabelB} vs ${d.rateLabelA})</div>`;
        }
      }).join('');

      compBanner.innerHTML = `
        <div class="flex items-start justify-between gap-3 text-xs">
          <div class="space-y-1.5 flex-1">
            <div class="text-indigo-400 font-semibold uppercase tracking-wider text-[10px]">Side-by-Side Comparison</div>
            <div class="text-white font-medium text-[13px]">
              <strong>${esc(betterCard.name)}</strong> outperforms <strong>${esc(otherCard.name)}</strong> by <strong class="text-indigo-300 font-semibold">${fmt(netDelta)}/yr</strong> net benefit.
            </div>
            <div class="text-white/50 text-[11px] pt-1.5 space-y-1 border-t border-white/5 mt-1.5">
              ${deltasHtml || '<div>No differences in category rewards.</div>'}
            </div>
          </div>
          <button id="btn-clear-comparison-checks" class="text-white/30 hover:text-white/60 text-[10px] uppercase font-semibold tracking-wider transition-colors pt-0.5">Reset</button>
        </div>
      `;
      compBanner.classList.remove('hidden');

      document.getElementById('btn-clear-comparison-checks').addEventListener('click', () => {
        compareCardIds = [];
        renderCcSimulator();
      });
    } else {
      compBanner.classList.add('hidden');
      compBanner.innerHTML = '';
    }
  } else if (compareCardIds.length > 2) {
    const sortedSelected = allCards.filter(c => compareCardIds.includes(c.id)).sort((x, y) => y.net - x.net);
    const winnerSel = sortedSelected[0];
    compBanner.innerHTML = `
      <div class="flex items-start justify-between gap-3 text-xs">
        <div class="space-y-1.5 flex-1">
          <div class="text-indigo-400 font-semibold uppercase tracking-wider text-[10px]">Active Selection Comparison</div>
          <div class="text-white font-medium text-[13px]">
            Winner of selected is <strong>${esc(winnerSel.name)}</strong> (Net: ${fmt(winnerSel.net)}).
          </div>
          <div class="text-white/50 text-[11px] pt-1.5 space-y-1 border-t border-white/5 mt-1.5">
            ${sortedSelected.map((c, i) => `<div>${i+1}. <strong>${esc(c.name.split(' (')[0])}</strong>: ${fmt(c.net)}/yr (Fee: ${fmt(c.annualFee)})</div>`).join('')}
          </div>
        </div>
        <button id="btn-clear-comparison-checks" class="text-white/30 hover:text-white/60 text-[10px] uppercase font-semibold tracking-wider transition-colors pt-0.5">Reset</button>
      </div>
    `;
    compBanner.classList.remove('hidden');

    document.getElementById('btn-clear-comparison-checks').addEventListener('click', () => {
      compareCardIds = [];
      renderCcSimulator();
    });
  } else {
    compBanner.classList.add('hidden');
    compBanner.innerHTML = '';
  }

  // Update Alpha Banner
  const alphaValEl = document.getElementById('optimization-alpha-val');
  const alphaTitleEl = document.getElementById('optimization-alpha-title');

  if (!winner || !current) {
    alphaValEl.textContent = '$0.00';
    alphaTitleEl.innerHTML = 'Please select at least one credit card to simulate.';
  } else {
    const alphaVal = winner.net - current.net;
    alphaValEl.textContent = fmt(alphaVal);
    
    if (winner.id === current.id) {
      alphaTitleEl.innerHTML = `Your current card <strong>${esc(winner.name)}</strong> is the most optimal card for your spending! Net annual gain is maximized.`;
    } else {
      alphaTitleEl.innerHTML = `By switching to <strong>${esc(winner.name)}</strong>, you could save <strong>${fmt(alphaVal)}</strong> more per year!`;
    }
  }

  // Render Table Rows
  document.getElementById('cc-total-spend-analyzed').textContent = fmt(cc.totalCcSpend);

  const ccRows = document.getElementById('cc-sim-rows');
  const totalCycles = currentInsightsData.simPeriod.length;

  ccRows.innerHTML = allCards.map((c, idx) => {
    const isExcluded = excludedCardIds.includes(c.id);
    const isWinner = winner && c.id === winner.id;
    const isChecked = compareCardIds.includes(c.id);
    
    const winnerMarker = isWinner ? '<span class="ml-1 text-[10px] bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 rounded px-1 font-semibold uppercase tracking-wider">Winner</span>' : '';
    const currentMarker = c.isCurrent ? '<span class="ml-1 text-[10px] bg-white/10 text-white/60 border border-white/15 rounded px-1 font-medium whitespace-nowrap">Current</span>' : '';
    
    let alphaStr = '';
    let alphaClass = '';
    if (c.isCurrent) {
      alphaStr = '—';
      alphaClass = 'text-white/20';
    } else {
      alphaStr = c.diffFromCurrent >= 0 ? `+${fmt(c.diffFromCurrent)}` : `${fmt(c.diffFromCurrent)}`;
      alphaClass = c.diffFromCurrent >= 0 ? 'text-green-400 font-medium' : 'text-red-400/50';
    }

    const hideShowBtn = `
      <button class="cc-toggle-exclude text-[10px] ${isExcluded ? 'text-indigo-400 hover:text-indigo-300 font-semibold' : 'text-white/20 hover:text-white/50'} ml-2" data-id="${c.id}" onclick="event.stopPropagation(); toggleCardExclusionPersistent('${c.id}');">
        ${isExcluded ? 'Show' : 'Hide'}
      </button>
    `;

    return `
      <!-- Main Card Row -->
      <tr class="hover:bg-white/[0.01] transition-colors border-b border-white/5 last:border-0 text-xs ${isExcluded ? 'opacity-40' : ''}" data-card-id="${c.id}">
        <td class="py-2.5 text-center">
          <input type="checkbox" class="cc-toggle-use cursor-pointer" data-id="${c.id}" ${isChecked ? 'checked' : ''} onclick="event.stopPropagation(); toggleCardExclusion('${c.id}');">
        </td>
        <td class="py-2.5 font-medium text-white/70 cursor-pointer cc-row-toggle">
          <span class="flex items-center flex-wrap gap-1">
            ${idx + 1}. ${esc(c.name)} ${winnerMarker} ${currentMarker} ${hideShowBtn}
          </span>
        </td>
        <td class="py-2.5 text-right font-mono text-white/40 cursor-pointer cc-row-toggle">${fmt(c.annualFee)}</td>
        <td class="py-2.5 text-right font-mono text-white/40 cursor-pointer cc-row-toggle">${fmt(c.rewards)}</td>
        <td class="py-2.5 text-right font-mono font-medium text-white/70 cursor-pointer cc-row-toggle">${fmt(c.net)}</td>
        <td class="py-2.5 text-right font-mono ${alphaClass} cursor-pointer cc-row-toggle">${alphaStr}</td>
      </tr>
      
      <!-- Expandable Details Accordion Panel Row -->
      <tr id="details-${c.id}" class="hidden bg-white/[0.01]">
        <td colspan="6" class="p-4 border-b border-white/5">
          <div class="bg-surface/50 border border-border p-4 rounded-lg space-y-4">
            <div class="flex items-center justify-between">
              <div class="text-white/60 font-semibold text-xs flex items-center gap-2">
                <span>Reward Calculation Details (Simulated over ${totalCycles} statement cycles)</span>
              </div>
              <div class="text-white/40 text-xs">Base Annual Fee: <strong class="text-white/70">${fmt(c.annualFee)}</strong></div>
            </div>
            
            <div class="overflow-x-auto">
              <table class="w-full text-[11px] text-left">
                <thead>
                  <tr class="text-white/30 uppercase tracking-wider border-b border-white/5">
                    <th class="py-1">Category</th>
                    <th class="py-1 text-right">Total Spend (Sim Period)</th>
                    <th class="py-1 pl-4">Reward Rate Structure</th>
                    <th class="py-1 text-right">Rewards (Sim Period)</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-white/5">
                  ${Object.entries(c.categoryBreakdown).map(([catKey, cat]) => {
                    return `
                      <tr>
                        <td class="py-1.5 capitalize text-white/70">${catKey}</td>
                        <td class="py-1.5 text-right font-mono text-white/60">${fmt(cat.spend)}</td>
                        <td class="py-1.5 text-white/50 pl-4">${cat.rateLabel}</td>
                        <td class="py-1.5 text-right font-mono text-white/70">${fmt(cat.rewards)}</td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>

            <!-- Cap limit warnings section -->
            ${Object.entries(c.categoryBreakdown)
              .filter(([_, cat]) => cat.capExceededMonths > 0)
              .map(([catKey, cat]) => {
                return `
                  <div class="text-amber-400/90 bg-amber-500/10 border border-amber-500/20 px-3 py-2 rounded text-[11px] flex items-start gap-2">
                    <span class="mt-0.5">⚠️</span>
                    <div>
                      <strong>${catKey.charAt(0).toUpperCase() + catKey.slice(1)} Cap Exceeded:</strong> 
                      Exceeded the reward limit in ${cat.capExceededMonths} out of ${totalCycles} statement cycles. 
                      Spend exceeding the limit was calculated at the base/downgraded reward rate.
                    </div>
                  </div>
                `;
              }).join('')}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // CC Comparison Chart
  const ccCtx = document.getElementById('chart-cc-comparison');
  if (ccComparisonChart) ccComparisonChart.destroy();

  const labels = activeCards.map(c => c.name.split(' (')[0]);
  const dataNet = activeCards.map(c => c.net);
  const activeWinnerId = winner ? winner.id : null;
  const chartColors = activeCards.map(c => {
    if (c.id === activeWinnerId) return '#6366f1';
    if (c.isCurrent) return 'rgba(255,255,255,0.25)';
    return 'rgba(255,255,255,0.08)';
  });

  ccComparisonChart = new Chart(ccCtx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Net Reward Benefit ($)',
        data: dataNet,
        backgroundColor: chartColors,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `Net Benefit: ${fmt(ctx.raw)}`
          }
        }
      },
      scales: {
        x: {
          ticks: { color: 'rgba(255,255,255,0.3)', font: { size: 9 }, maxRotation: 15, autoSkip: false },
          grid: { display: false }
        },
        y: {
          ticks: { color: 'rgba(255,255,255,0.3)', font: { size: 9 }, callback: (v) => '$' + v },
          grid: { color: 'rgba(255,255,255,0.04)' }
        }
      }
    }
  });
}

function toggleCardExclusion(cardId) {
  const idx = compareCardIds.indexOf(cardId);
  if (idx === -1) {
    compareCardIds.push(cardId);
  } else {
    compareCardIds.splice(idx, 1);
  }
  renderCcSimulator();
}

function toggleCardExclusionPersistent(cardId) {
  const idx = excludedCardIds.indexOf(cardId);
  if (idx === -1) {
    excludedCardIds.push(cardId);
  } else {
    excludedCardIds.splice(idx, 1);
  }
  localStorage.setItem('insights-excluded-cards', JSON.stringify(excludedCardIds));
  renderCcSimulator();
}

function toggleCardDetails(cardId) {
  const detailsRow = document.getElementById(`details-${cardId}`);
  if (!detailsRow) return;
  detailsRow.classList.toggle('hidden');
}

// ── Go ───────────────────────────────────────────────────────────────────

init();
