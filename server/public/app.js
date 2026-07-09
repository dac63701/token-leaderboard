/* =============================================
   Token Leaderboard — Vanilla JS SPA
   ============================================= */

const state = {
  activeTab: 'home',
  homeData: [],
  detailedData: [],
  sortColumn: null,
  sortAsc: true,
  refreshInterval: null,
  countdown: 60,
  nickname: null
};

/* ---- Helpers ---- */

function $(sel, ctx) { return (ctx || document).querySelector(sel); }

function $$(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }

function formatNumber(n) {
  if (n == null || isNaN(n)) return '0';
  return Number(n).toLocaleString('en-US');
}

function formatCost(n) {
  if (n == null || isNaN(n)) return '0.00';
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/* ---- Data Fetching ---- */

async function fetchHome() {
  const loadingEl = $('#home-loading');
  const errorEl = $('#home-error');
  const container = $('#home-table-container');

  loadingEl.classList.remove('hidden');
  errorEl.classList.add('hidden');
  container.innerHTML = '';

  try {
    const res = await fetch('/api/leaderboard');
    if (!res.ok) throw new Error(`Server error: ${res.status}`);
    state.homeData = await res.json();
    renderHome();
  } catch (err) {
    errorEl.textContent = 'Failed to load leaderboard: ' + err.message;
    errorEl.classList.remove('hidden');
  } finally {
    loadingEl.classList.add('hidden');
  }
}

async function fetchDetailed() {
  const loadingEl = $('#detailed-loading');
  const errorEl = $('#detailed-error');
  const container = $('#detailed-table-container');

  loadingEl.classList.remove('hidden');
  errorEl.classList.add('hidden');
  container.innerHTML = '';

  try {
    const res = await fetch('/api/leaderboard/detailed');
    if (!res.ok) throw new Error(`Server error: ${res.status}`);
    state.detailedData = await res.json();
    renderDetailed();
  } catch (err) {
    errorEl.textContent = 'Failed to load detailed data: ' + err.message;
    errorEl.classList.remove('hidden');
  } finally {
    loadingEl.classList.add('hidden');
  }
}

/* ---- Rendering: Home ---- */

function renderHome() {
  const container = $('#home-table-container');
  const data = state.homeData;

  if (!data || data.length === 0) {
    container.innerHTML = '<p class="loading" style="padding:24px 0">No data yet.</p>';
    return;
  }

  const rows = data.map((row, i) => {
    const rank = i + 1;
    const isWinner = rank === 1;
    const trophy = isWinner ? '\u{1F3C6} ' : '';
    return `<tr class="${isWinner ? 'trophy-row' : ''}">
      <td class="rank-cell">${trophy}${rank}</td>
      <td class="nickname-cell">${escapeHtml(row.nickname)}</td>
      <td class="num-cell">${formatNumber(row.total_tokens)}</td>
      <td class="num-cell">$${formatCost(row.cost)}</td>
      <td class="num-cell">${formatNumber(row.sessions)}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `<div class="table-wrapper">
    <table>
      <thead><tr>
        <th>Rank</th>
        <th>Nickname</th>
        <th>Total Tokens</th>
        <th>Cost ($)</th>
        <th>Sessions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

/* ---- Rendering: Detailed ---- */

function getDetailedRows() {
  const rows = [];
  for (const entry of state.detailedData) {
    const nickname = entry.nickname;
    const models = entry.models || entry.breakdown || [];
    for (const m of models) {
      rows.push({
        nickname: nickname,
        model: m.model || 'unknown',
        input: m.input || 0,
        output: m.output || 0,
        cache_read: m.cache_read || 0,
        cache_write: m.cache_write || 0,
        reasoning: m.reasoning || 0,
        sessions: m.sessions || 0
      });
    }
  }
  return rows;
}

const DETAILED_COLUMNS = [
  { key: 'nickname', label: 'Nickname', type: 'string' },
  { key: 'model',    label: 'Model',    type: 'string' },
  { key: 'input',    label: 'Input',    type: 'number' },
  { key: 'output',   label: 'Output',   type: 'number' },
  { key: 'cache_read',  label: 'Cache Read',  type: 'number' },
  { key: 'cache_write', label: 'Cache Write', type: 'number' },
  { key: 'reasoning', label: 'Reasoning', type: 'number' },
  { key: 'sessions',  label: 'Sessions',  type: 'number' }
];

function renderDetailed() {
  const container = $('#detailed-table-container');
  let rows = getDetailedRows();

  if (rows.length === 0) {
    container.innerHTML = '<p class="loading" style="padding:24px 0">No detailed data yet.</p>';
    return;
  }

  // Apply sort
  if (state.sortColumn) {
    const col = DETAILED_COLUMNS.find(c => c.key === state.sortColumn);
    if (col) {
      rows.sort((a, b) => {
        let va = a[col.key];
        let vb = b[col.key];
        if (col.type === 'number') {
          va = va || 0;
          vb = vb || 0;
          return state.sortAsc ? va - vb : vb - va;
        }
        va = (va || '').toString().toLowerCase();
        vb = (vb || '').toString().toLowerCase();
        if (va < vb) return state.sortAsc ? -1 : 1;
        if (va > vb) return state.sortAsc ? 1 : -1;
        return 0;
      });
    }
  }

  const sortCol = state.sortColumn;

  const thead = DETAILED_COLUMNS.map(col => {
    const isActive = col.key === sortCol;
    const arrow = isActive
      ? (state.sortAsc ? ' \u25B2' : ' \u25BC')
      : ' <span class="sort-arrow empty">\u25B4</span>';
    return `<th class="sortable" data-column="${col.key}">
      ${col.label}<span class="sort-arrow${isActive ? '' : ' empty'}">${arrow}</span>
    </th>`;
  }).join('');

  const tbody = rows.map(r => `<tr>
    <td class="nickname-cell">${escapeHtml(r.nickname)}</td>
    <td>${escapeHtml(r.model)}</td>
    <td class="num-cell">${formatNumber(r.input)}</td>
    <td class="num-cell">${formatNumber(r.output)}</td>
    <td class="num-cell">${formatNumber(r.cache_read)}</td>
    <td class="num-cell">${formatNumber(r.cache_write)}</td>
    <td class="num-cell">${formatNumber(r.reasoning)}</td>
    <td class="num-cell">${formatNumber(r.sessions)}</td>
  </tr>`).join('');

  container.innerHTML = `<div class="table-wrapper">
    <table>
      <thead><tr>${thead}</tr></thead>
      <tbody>${tbody}</tbody>
    </table>
  </div>`;

  // Attach sort listeners to header cells
  container.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      sortData(th.dataset.column);
      renderDetailed();
    });
  });
}

/* ---- Sorting ---- */

function sortData(column) {
  if (state.sortColumn === column) {
    state.sortAsc = !state.sortAsc;
  } else {
    state.sortColumn = column;
    state.sortAsc = true;
  }
}

/* ---- Tab Switching ---- */

function switchTab(tab) {
  state.activeTab = tab;

  // Update tab buttons
  $$('.tab').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });

  // Show/hide content
  $$('.tab-content').forEach(el => {
    el.classList.toggle('active', el.id === 'tab-' + tab);
  });

  // Fetch data if needed
  if (tab === 'home' && state.homeData.length === 0) {
    fetchHome();
  } else if (tab === 'detailed' && state.detailedData.length === 0) {
    fetchDetailed();
  }
}

/* ---- Auto-Refresh ---- */

function startAutoRefresh() {
  if (state.refreshInterval) {
    clearInterval(state.refreshInterval);
    clearInterval(state._countdownInterval);
  }

  state.countdown = 60;
  updateCountdownDisplay();

  state._countdownInterval = setInterval(() => {
    state.countdown--;
    updateCountdownDisplay();
    if (state.countdown <= 0) {
      state.countdown = 60;
    }
  }, 1000);

  state.refreshInterval = setInterval(() => {
    refreshData();
    state.countdown = 60;
    updateCountdownDisplay();
  }, 60000);
}

function updateCountdownDisplay() {
  const el = $('#refresh-indicator');
  if (el) {
    el.textContent = 'Auto-refreshing in ' + state.countdown + 's\u2026';
  }
}

async function refreshData() {
  const promises = [];
  if (state.activeTab === 'home' || state.homeData.length > 0) {
    promises.push(fetchHome());
  }
  if (state.activeTab === 'detailed' || state.detailedData.length > 0) {
    promises.push(fetchDetailed());
  }
  if (promises.length === 0) {
    promises.push(fetchHome());
  }
  await Promise.all(promises);
}

/* ---- Utility ---- */

function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

/* ---- Init ---- */

function init() {
  // Read nickname from URL param or localStorage
  const params = new URLSearchParams(window.location.search);
  state.nickname = params.get('nickname') || localStorage.getItem('leaderboard_nickname');

  if (state.nickname) {
    localStorage.setItem('leaderboard_nickname', state.nickname);
    const display = $('#nickname-display');
    if (display) {
      display.textContent = 'Your nickname: ' + state.nickname;
    }
  }

  // Set up tab click handlers
  $$('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });

  // Refresh button
  const refreshBtn = $('#refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      state.countdown = 60;
      updateCountdownDisplay();
      refreshData();
    });
  }

  // Fetch initial data
  fetchHome();
  fetchDetailed();

  // Start auto-refresh
  startAutoRefresh();
}

/* ---- Boot ---- */
document.addEventListener('DOMContentLoaded', init);
