/* =============================================
   Token Leaderboard v2 — Vanilla JS SPA
   ============================================= */

const state = {
  activeTab: 'home',
  homeData: [],
  detailedData: [],
  stats: null,
  sortColumn: null,
  sortAsc: true,
  refreshInterval: 60,
  refreshTimer: null,
  countdownTimer: null,
  countdown: 60,
  lastUpdated: null,
  nickname: null,
  user: null,
  pricingCache: {},
  tooltipTimeout: null,
  _tooltipCell: null,
  loginPollTimer: null,
  settingsOpen: false,
  autoRefreshEnabled: true,
  _serverConnected: true,
  _refreshing: false
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

function escapeHtml(str) {
  if (str == null) return '';
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

const SOURCE_CONFIG = {
  'opencode':    { color: '#6366f1', label: 'OpenCode' },
  'claude-code': { color: '#d97706', label: 'Claude' },
  'codex-cli':   { color: '#10b981', label: 'Codex' },
  'copilot':     { color: '#6b7280', label: 'Copilot' }
};

function formatCompact(n) {
  if (n == null || isNaN(n)) return '0';
  if (n >= 1000000000) return (n / 1000000000).toFixed(1) + 'B';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return Number(n).toLocaleString('en-US');
}

function timeSince(date) {
  var diff = Math.floor((Date.now() - date) / 1000);
  if (diff < 5) return 'just now';
  return diff + 's ago';
}

/* ---- Data Fetching ---- */

async function fetchStats() {
  try {
    var res = await fetch('/api/stats');
    if (!res.ok) throw new Error('Server error: ' + res.status);
    state.stats = await res.json();
    state._serverConnected = true;
    renderStats();
  } catch (err) {
    state._serverConnected = false;
  }
}

async function fetchHome() {
  var loadingEl = $('#home-loading');
  var errorEl = $('#home-error');
  var container = $('#home-table-container');

  loadingEl.classList.remove('hidden');
  errorEl.classList.add('hidden');
  container.innerHTML = '';

  try {
    var res = await fetch('/api/leaderboard');
    if (!res.ok) throw new Error('Server error: ' + res.status);
    state.homeData = await res.json();
    state._serverConnected = true;
    state.lastUpdated = Date.now();
    renderHome();
  } catch (err) {
    errorEl.textContent = 'Failed to load leaderboard: ' + err.message;
    errorEl.classList.remove('hidden');
    state._serverConnected = false;
  } finally {
    loadingEl.classList.add('hidden');
  }
}

async function fetchDetailed() {
  var loadingEl = $('#detailed-loading');
  var errorEl = $('#detailed-error');
  var container = $('#detailed-table-container');

  loadingEl.classList.remove('hidden');
  errorEl.classList.add('hidden');
  container.innerHTML = '';

  try {
    var res = await fetch('/api/leaderboard/detailed');
    if (!res.ok) throw new Error('Server error: ' + res.status);
    state.detailedData = await res.json();
    state._serverConnected = true;
    state.lastUpdated = Date.now();

    // Pre-load pricing for all models before rendering to avoid re-render cascade
    await loadPricingForDetailed();

    renderDetailed();
  } catch (err) {
    errorEl.textContent = 'Failed to load detailed data: ' + err.message;
    errorEl.classList.remove('hidden');
    state._serverConnected = false;
  } finally {
    loadingEl.classList.add('hidden');
  }
}

async function fetchPricing(model) {
  if (state.pricingCache[model] !== undefined) return state.pricingCache[model];
  try {
    var res = await fetch('/api/pricing?model=' + encodeURIComponent(model));
    if (!res.ok) throw new Error('Pricing error');
    var data = await res.json();
    state.pricingCache[model] = data;
    return data;
  } catch (err) {
    state.pricingCache[model] = null;
    return null;
  }
}

async function loadPricingForDetailed() {
  var rows = getDetailedRows();
  var modelSet = {};
  rows.forEach(function(r) { modelSet[r.model] = true; });
  var fetches = [];
  Object.keys(modelSet).forEach(function(m) {
    if (state.pricingCache[m] === undefined) {
      fetches.push(fetchPricing(m));
    }
  });
  if (fetches.length > 0) {
    await Promise.all(fetches);
  }
}

/* ---- Rendering: Stats ---- */

function renderStats() {
  if (!state.stats) return;
  $('#stat-total-tokens').textContent = formatCompact(state.stats.total_tokens);
  $('#stat-total-cost').textContent = '$' + formatCost(state.stats.total_cost);
  $('#stat-total-sessions').textContent = formatNumber(state.stats.total_sessions);
  $('#stat-active-users').textContent = formatNumber(state.stats.active_users || state.stats.active_24h || 0);
  $('#stat-active-7d').textContent = formatNumber(state.stats.active_7d || 0);
}

/* ---- Rendering: Home ---- */

function renderHome() {
  var container = $('#home-table-container');
  var data = state.homeData;

  if (!data || data.length === 0) {
    container.innerHTML = '<p class="loading" style="padding:24px 0">No data yet.</p>';
    return;
  }

  var rows = data.map(function(row, i) {
    var rank = i + 1;
    var isWinner = rank === 1;
    var trophy = isWinner ? '<span class="trophy-icon">&#x1F3C6;</span> ' : '';
    var tokenBreakdown = JSON.stringify({
      input: row.total_input || 0,
      output: row.total_output || 0,
      cache_read: row.total_cache_read || 0,
      cache_write: row.total_cache_write || 0,
      reasoning: row.total_reasoning || 0
    });
    return '<tr class="' + (isWinner ? 'trophy-row winner-animate' : '') + '" data-nickname="' + escapeHtml(row.nickname) + '">' +
      '<td class="rank-cell">' + trophy + rank + '</td>' +
      '<td class="nickname-cell">' + escapeHtml(row.nickname) + '</td>' +
      '<td class="num-cell token-cell" data-tk="' + tokenBreakdown.replace(/"/g, '&quot;') + '">' + formatNumber(row.total_tokens) + '</td>' +
      '<td class="num-cell cost-cell" data-tk="' + tokenBreakdown.replace(/"/g, '&quot;') + '" data-nick="' + escapeHtml(row.nickname) + '">$' + formatCost(row.total_cost) + '</td>' +
      '<td class="num-cell">' + formatNumber(row.session_count) + '</td>' +
    '</tr>';
  }).join('');

  container.innerHTML = '<div class="table-wrapper">' +
    '<table>' +
      '<thead><tr>' +
        '<th>Rank</th>' +
        '<th>Nickname</th>' +
        '<th>Total Tokens</th>' +
        '<th>Cost ($)</th>' +
        '<th>Sessions</th>' +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table>' +
  '</div>';
}

function getUserBreakdown(nickname) {
  var entry = state.detailedData.find(function(d) { return d.nickname === nickname; });
  if (!entry) return [];
  return entry.models || entry.breakdown || [];
}

function toggleExpandRow(row) {
  var nickname = row.dataset.nickname;
  var next = row.nextElementSibling;

  if (next && next.classList.contains('expanded-row')) {
    var inner = next.querySelector('.expanded-inner');
    if (inner) {
      inner.style.maxHeight = '0';
      inner.addEventListener('transitionend', function() { next.remove(); }, { once: true });
    } else {
      next.remove();
    }
    row.classList.remove('expanded');
    return;
  }

  var models = getUserBreakdown(nickname);
  if (models.length === 0) return;

  var subRows = models.map(function(m) {
    var srcBadges = (m.sources || []).map(function(src) {
      var cfg = SOURCE_CONFIG[src] || { color: '#9ca3af', label: src };
      return '<span class="source-badge" style="background:' + cfg.color + '">' + cfg.label + '</span>';
    }).join('');
    return '<tr>' +
      '<td>' + escapeHtml(m.model || 'unknown') + '</td>' +
      '<td class="num-cell">' + formatNumber(m.input || 0) + '</td>' +
      '<td class="num-cell">' + formatNumber(m.output || 0) + '</td>' +
      '<td class="num-cell">' + formatNumber(m.cache_read || 0) + '</td>' +
      '<td class="num-cell">' + formatNumber(m.cache_write || 0) + '</td>' +
      '<td class="num-cell">' + formatNumber(m.reasoning || 0) + '</td>' +
      '<td class="num-cell">' + formatNumber(m.sessions || 0) + '</td>' +
      '<td class="source-cell">' + srcBadges + '</td>' +
    '</tr>';
  }).join('');

  var subTable = '<table class="expanded-sub-table">' +
    '<thead><tr>' +
      '<th>Model</th><th>Input</th><th>Output</th><th>Cache Read</th><th>Cache Write</th><th>Reasoning</th><th>Sessions</th><th>Source</th>' +
    '</tr></thead>' +
    '<tbody>' + subRows + '</tbody>' +
  '</table>';

  var tr = document.createElement('tr');
  tr.className = 'expanded-row';
  tr.innerHTML = '<td colspan="5"><div class="expanded-inner" style="max-height:0;overflow:hidden;transition:max-height 0.3s ease">' + subTable + '</div></td>';

  row.parentNode.insertBefore(tr, row.nextSibling);
  row.classList.add('expanded');

  requestAnimationFrame(function() {
    var inner = tr.querySelector('.expanded-inner');
    if (inner) inner.style.maxHeight = inner.scrollHeight + 24 + 'px';
  });
}

/* ---- Rendering: Detailed ---- */

function getDetailedRows() {
  var rows = [];
  for (var ei = 0; ei < state.detailedData.length; ei++) {
    var entry = state.detailedData[ei];
    var nickname = entry.nickname;
    var models = entry.models || entry.breakdown || [];
    for (var mi = 0; mi < models.length; mi++) {
      var m = models[mi];
      rows.push({
        nickname: nickname,
        model: m.model || 'unknown',
        input: m.input || 0,
        output: m.output || 0,
        cache_read: m.cache_read || 0,
        cache_write: m.cache_write || 0,
        reasoning: m.reasoning || 0,
        sessions: m.sessions || 0,
        sources: m.sources || []
      });
    }
  }
  return rows;
}

var DETAILED_COLUMNS = [
  { key: 'nickname', label: 'Nickname', type: 'string' },
  { key: 'model',    label: 'Model',    type: 'string' },
  { key: 'input',    label: 'Input',    type: 'number' },
  { key: 'output',   label: 'Output',   type: 'number' },
  { key: 'cache_read',  label: 'Cache Read',  type: 'number' },
  { key: 'cache_write', label: 'Cache Write', type: 'number' },
  { key: 'reasoning', label: 'Reasoning', type: 'number' },
  { key: 'sessions',  label: 'Sessions',  type: 'number' },
  { key: 'source',    label: 'Source',    type: 'string' },
  { key: 'cost_per_1m', label: 'Cost/1M', type: 'string' }
];

function renderDetailed() {
  var container = $('#detailed-table-container');
  var rows = getDetailedRows();

  if (rows.length === 0) {
    container.innerHTML = '<p class="loading" style="padding:24px 0">No detailed data yet.</p>';
    return;
  }

  if (state.sortColumn) {
    var col = DETAILED_COLUMNS.find(function(c) { return c.key === state.sortColumn; });
    if (col) {
      rows.sort(function(a, b) {
        var va = a[col.key];
        var vb = b[col.key];
        if (col.type === 'number') {
          va = va || 0;
          vb = vb || 0;
          return state.sortAsc ? va - vb : vb - va;
        }
        if (col.key === 'source') {
          va = (a.sources || []).join(',').toLowerCase();
          vb = (b.sources || []).join(',').toLowerCase();
        } else {
          va = (va || '').toString().toLowerCase();
          vb = (vb || '').toString().toLowerCase();
        }
        if (va < vb) return state.sortAsc ? -1 : 1;
        if (va > vb) return state.sortAsc ? 1 : -1;
        return 0;
      });
    }
  }

  var sortCol = state.sortColumn;

  var thead = DETAILED_COLUMNS.map(function(col) {
    var isActive = col.key === sortCol;
    var arrow = isActive
      ? (state.sortAsc ? ' \u25B2' : ' \u25BC')
      : ' <span class="sort-arrow empty">\u25B4</span>';
    return '<th class="sortable" data-column="' + col.key + '">' +
      col.label + '<span class="sort-arrow' + (isActive ? '' : ' empty') + '">' + arrow + '</span>' +
    '</th>';
  }).join('');

  var tbody = rows.map(function(r) {
    var tokenBreakdown = JSON.stringify({
      input: r.input, output: r.output,
      cache_read: r.cache_read, cache_write: r.cache_write,
      reasoning: r.reasoning
    });
    var safeTk = tokenBreakdown.replace(/"/g, '&quot;');
    var pricing = state.pricingCache[r.model];
    var costPer1M = pricing ? '$' + formatCost((pricing.input || 0) + (pricing.output || 0)) : '\u2014';
    var srcBadges = (r.sources || []).map(function(src) {
      var cfg = SOURCE_CONFIG[src] || { color: '#9ca3af', label: src };
      return '<span class="source-badge" style="background:' + cfg.color + '">' + cfg.label + '</span>';
    }).join('');
    return '<tr>' +
      '<td class="nickname-cell">' + escapeHtml(r.nickname) + '</td>' +
      '<td>' + escapeHtml(r.model) + '</td>' +
      '<td class="num-cell token-cell" data-tk="' + safeTk + '">' + formatNumber(r.input) + '</td>' +
      '<td class="num-cell token-cell" data-tk="' + safeTk + '">' + formatNumber(r.output) + '</td>' +
      '<td class="num-cell token-cell" data-tk="' + safeTk + '">' + formatNumber(r.cache_read) + '</td>' +
      '<td class="num-cell token-cell" data-tk="' + safeTk + '">' + formatNumber(r.cache_write) + '</td>' +
      '<td class="num-cell token-cell" data-tk="' + safeTk + '">' + formatNumber(r.reasoning) + '</td>' +
      '<td class="num-cell">' + formatNumber(r.sessions) + '</td>' +
      '<td class="source-cell">' + srcBadges + '</td>' +
      '<td class="num-cell cost-cell" data-model="' + escapeHtml(r.model) + '">' + costPer1M + '</td>' +
    '</tr>';
  }).join('');

  container.innerHTML = '<div class="table-wrapper">' +
    '<table>' +
      '<thead><tr>' + thead + '</tr></thead>' +
      '<tbody>' + tbody + '</tbody>' +
    '</table>' +
  '</div>';
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

  $$('.tab').forEach(function(el) {
    el.classList.toggle('active', el.dataset.tab === tab);
  });

  $$('.tab-content').forEach(function(el) {
    el.classList.toggle('active', el.id === 'tab-' + tab);
  });

  if (tab === 'home' && state.homeData.length === 0) {
    fetchHome();
  } else if (tab === 'detailed' && state.detailedData.length === 0) {
    fetchDetailed();
  }
}

/* ---- Auto-Refresh ---- */

function startAutoRefresh() {
  stopAutoRefresh();

  state.countdown = state.refreshInterval;
  updateCountdownDisplay();

  state.countdownTimer = setInterval(function() {
    state.countdown--;
    updateCountdownDisplay();
    updateLastUpdated();
    if (state.countdown <= 0) {
      state.countdown = state.refreshInterval;
    }
  }, 1000);

  state.refreshTimer = setInterval(function() {
    refreshData();
    state.countdown = state.refreshInterval;
    updateCountdownDisplay();
  }, state.refreshInterval * 1000);
}

function stopAutoRefresh() {
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
  if (state.countdownTimer) {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  }
}

function restartAutoRefresh() {
  if (state.autoRefreshEnabled) {
    startAutoRefresh();
  } else {
    stopAutoRefresh();
    var el = $('#refresh-indicator');
    if (el) el.textContent = 'Auto-refresh paused';
  }
}

function updateCountdownDisplay() {
  var el = $('#refresh-indicator');
  if (!el) return;
  if (!state.autoRefreshEnabled) {
    el.textContent = 'Auto-refresh paused';
    return;
  }
  el.textContent = 'Auto-refreshing in ' + state.countdown + 's\u2026';
}

function updateLastUpdated() {
  var el = $('#last-updated');
  if (!el) return;
  if (state.lastUpdated) {
    el.textContent = 'Last updated: ' + timeSince(state.lastUpdated);
  } else {
    el.textContent = '';
  }

  var dot = $('#status-dot');
  if (dot) {
    dot.className = 'status-dot ' + (state._serverConnected ? 'connected' : 'disconnected');
  }
}

async function refreshData() {
  if (state._refreshing) return;
  state._refreshing = true;
  try {
    var promises = [];
    if (state.activeTab === 'home' || state.homeData.length > 0) {
      promises.push(fetchHome());
    }
    if (state.activeTab === 'detailed' || state.detailedData.length > 0) {
      promises.push(fetchDetailed());
    }
    if (promises.length === 0) {
      promises.push(fetchHome());
    }
    promises.push(fetchStats());
    await Promise.all(promises);
  } finally {
    state._refreshing = false;
  }
}

/* ---- Tooltips ---- */

function getTooltipData(cell) {
  var tkRaw = cell.dataset.tk;
  var tk;
  try {
    tk = JSON.parse(tkRaw);
  } catch (e) {
    return null;
  }
  var lines = [];
  if (tk.input !== undefined) lines.push('Input: ' + formatNumber(tk.input));
  if (tk.output !== undefined) lines.push('Output: ' + formatNumber(tk.output));
  if (tk.cache_read !== undefined) lines.push('Cache Read: ' + formatNumber(tk.cache_read));
  if (tk.cache_write !== undefined) lines.push('Cache Write: ' + formatNumber(tk.cache_write));
  if (tk.reasoning !== undefined) lines.push('Reasoning: ' + formatNumber(tk.reasoning));

  if (cell.classList.contains('cost-cell')) {
    var model = cell.dataset.model || cell.dataset.nick;
    if (model && state.pricingCache[model]) {
      var p = state.pricingCache[model];
      var rate = (p.input || 0) + (p.output || 0);
      lines.push('Rate: $' + formatCost(rate) + '/1M');
    }
  }

  return lines.join(' | ');
}

function showTooltip(cell) {
  var text = getTooltipData(cell);
  if (!text) return;

  var tip = $('#tooltip');
  var body = tip.querySelector('.tooltip-body');
  body.textContent = text;
  tip.classList.remove('hidden');

  var rect = cell.getBoundingClientRect();
  tip.style.display = 'block';
  var tipRect = tip.getBoundingClientRect();

  var top = rect.top - tipRect.height - 10;
  var left = rect.left + (rect.width / 2) - (tipRect.width / 2);

  tip.classList.remove('above', 'below');

  if (top < 8) {
    top = rect.bottom + 10;
    tip.classList.add('below');
  } else {
    tip.classList.add('above');
  }

  if (left < 8) left = 8;
  if (left + tipRect.width > window.innerWidth - 8) {
    left = window.innerWidth - tipRect.width - 8;
  }

  tip.style.top = top + 'px';
  tip.style.left = left + 'px';
  state.tooltipVisible = true;

  requestAnimationFrame(function() {
    tip.classList.add('visible');
  });
}

function hideTooltip() {
  var tip = $('#tooltip');
  tip.classList.remove('visible');
  tip.classList.add('hidden');
  tip.classList.remove('above', 'below');
  tip.style.display = '';
  state.tooltipVisible = false;
  state._tooltipCell = null;
}

function initTooltipListeners() {
  document.addEventListener('mouseover', function(e) {
    var cell = e.target.closest('td.token-cell, td.cost-cell');
    if (cell) {
      if (state._tooltipCell === cell) return;
      state._tooltipCell = cell;
      clearTimeout(state.tooltipTimeout);
      state.tooltipTimeout = setTimeout(function() {
        var c = state._tooltipCell;
        if (c && c.isConnected) {
          showTooltip(c);
        }
      }, 200);
    }
  });

  document.addEventListener('mouseout', function(e) {
    var cell = e.target.closest('td.token-cell, td.cost-cell');
    if (!cell || !cell.contains(e.relatedTarget)) {
      clearTimeout(state.tooltipTimeout);
      hideTooltip();
    }
  });
}

/* ---- Settings ---- */

function initSettings() {
  var saved = localStorage.getItem('tl_refresh_interval');
  state.refreshInterval = saved ? parseInt(saved, 10) : 60;
  if (isNaN(state.refreshInterval) || state.refreshInterval < 10) state.refreshInterval = 60;

  var slider = $('#interval-slider');
  var label = $('#interval-label');
  var toggle = $('#auto-refresh-toggle');
  var panel = $('#settings-panel');
  var overlay = $('#settings-overlay');
  var openBtn = $('#settings-btn');
  var closeBtn = $('#settings-close');

  slider.value = state.refreshInterval;
  label.textContent = 'Refresh every ' + state.refreshInterval + 's';

  var autoSaved = localStorage.getItem('tl_auto_refresh');
  state.autoRefreshEnabled = autoSaved !== null ? autoSaved === '1' : true;
  toggle.checked = state.autoRefreshEnabled;

  slider.addEventListener('input', function() {
    var val = parseInt(slider.value, 10);
    label.textContent = 'Refresh every ' + val + 's';
    state.refreshInterval = val;
    localStorage.setItem('tl_refresh_interval', val);
    if (state.autoRefreshEnabled) {
      restartAutoRefresh();
    }
  });

  toggle.addEventListener('change', function() {
    state.autoRefreshEnabled = toggle.checked;
    localStorage.setItem('tl_auto_refresh', state.autoRefreshEnabled ? '1' : '0');
    restartAutoRefresh();
  });

  openBtn.addEventListener('click', function() {
    state.settingsOpen = true;
    panel.classList.add('open');
    overlay.classList.remove('hidden');
    requestAnimationFrame(function() {
      overlay.classList.add('visible');
    });
  });

  function closeSettings() {
    state.settingsOpen = false;
    overlay.classList.remove('visible');
    panel.classList.remove('open');
    setTimeout(function() {
      overlay.classList.add('hidden');
    }, 200);
  }

  closeBtn.addEventListener('click', closeSettings);
  overlay.addEventListener('click', closeSettings);
}

/* ---- Login ---- */

function initLogin() {
  var stored = localStorage.getItem('tl_user');
  if (stored) {
    try {
      state.user = JSON.parse(stored);
    } catch (e) {
      state.user = null;
    }
  }

  // Single delegated listener for closing dropdown (added once, never leaks)
  document.addEventListener('click', function(e) {
    var dropdown = $('#user-dropdown');
    if (dropdown && dropdown.classList.contains('open')) {
      if (!e.target.closest('#user-badge') && !e.target.closest('#user-dropdown')) {
        dropdown.classList.remove('open');
      }
    }
  });

  updateLoginUI();
}

function updateLoginUI() {
  var area = $('#login-area');
  if (!area) return;

  if (state.user && state.user.nickname) {
    area.innerHTML = '<div class="user-badge" id="user-badge">' +
      '<img class="user-avatar" src="' + escapeHtml(state.user.avatar || '') + '" alt="" onerror="this.style.display=\'none\'">' +
      '<span class="user-nickname">' + escapeHtml(state.user.nickname) + '</span>' +
      '</div>' +
      '<div class="user-dropdown" id="user-dropdown">' +
      '<button class="dropdown-item logout" id="logout-btn">Log out</button>' +
      '</div>';

    var badge = $('#user-badge');
    var dropdown = $('#user-dropdown');

    badge.addEventListener('click', function(e) {
      e.stopPropagation();
      dropdown.classList.toggle('open');
    });

    $('#logout-btn').addEventListener('click', function() {
      state.user = null;
      localStorage.removeItem('tl_user');
      updateLoginUI();
    });
  } else {
    area.innerHTML = '<button class="login-btn" id="login-btn">' +
      '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>' +
      'Login with GitHub</button>';

    $('#login-btn').addEventListener('click', startLoginFlow);
  }
}

async function startLoginFlow() {
  var modal = $('#login-modal');
  var urlEl = $('#device-url');
  var codeEl = $('#device-code');
  var statusEl = $('#login-status');

  statusEl.textContent = '';
  statusEl.className = 'login-status';

  modal.classList.remove('hidden');
  requestAnimationFrame(function() {
    modal.classList.add('visible');
  });

  try {
    var res = await fetch('/api/auth/github/device');
    if (!res.ok) {
      var errBody;
      try { errBody = await res.json(); } catch (e) {}
      throw new Error(errBody && errBody.error ? errBody.error : 'Failed to start login: ' + res.status);
    }
    var data = await res.json();

    urlEl.textContent = data.verification_uri;
    codeEl.textContent = data.user_code;
    statusEl.textContent = 'Waiting for authentication\u2026';

    var pollInterval = (data.interval || 5) * 1000;
    loginPoll(data, pollInterval, statusEl, modal);
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.classList.add('error');
  }
}

async function loginPoll(data, interval, statusEl, modal) {
  if (state.loginPollTimer) {
    clearTimeout(state.loginPollTimer);
  }

  var deviceCode = data.device_code;

  async function poll() {
    try {
      var res = await fetch('/api/auth/github/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_code: deviceCode })
      });
      if (!res.ok) {
        throw new Error('Poll error: ' + res.status);
      }
      var result = await res.json();

      if (result.status === 'pending') {
        state.loginPollTimer = setTimeout(poll, interval);
        return;
      }

      if (result.status === 'complete') {
        state.user = {
          nickname: result.nickname || result.login,
          avatar: result.avatar || ''
        };
        localStorage.setItem('tl_user', JSON.stringify(state.user));
        closeModal(modal);
        updateLoginUI();
        return;
      }

      if (result.status === 'expired') {
        statusEl.textContent = 'Login expired. Please try again.';
        statusEl.classList.add('error');
        return;
      }

      statusEl.textContent = 'Unexpected response from server.';
      statusEl.classList.add('error');
    } catch (err) {
      statusEl.textContent = err.message;
      statusEl.classList.add('error');
    }
  }

  state.loginPollTimer = setTimeout(poll, interval);
}

function closeModal(modal) {
  modal.classList.remove('visible');
  setTimeout(function() {
    modal.classList.add('hidden');
  }, 200);
  if (state.loginPollTimer) {
    clearTimeout(state.loginPollTimer);
    state.loginPollTimer = null;
  }
}

/* ---- Expandable Rows (Home) + Delegation ---- */

function initHomeTableDelegation() {
  var container = $('#home-table-container');
  container.addEventListener('click', function(e) {
    var row = e.target.closest('tr[data-nickname]');
    if (row) {
      if (e.target.closest('a, button')) return;
      toggleExpandRow(row);
    }
  });
}

/* ---- Theme Toggle ---- */

var THEME_ICONS = {
  sun: '<circle cx="10" cy="10" r="4"/><path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M3.4 3.4l1.4 1.4M15.2 15.2l1.4 1.4M3.4 16.6l1.4-1.4M15.2 4.8l1.4-1.4"/>',
  moon: '<path d="M17.5 10.5A7.5 7.5 0 0 1 3 8a7.5 7.5 0 0 0 14.5 2.5z"/>'
};

function setThemeIcon(theme) {
  var icon = $('#theme-icon');
  if (!icon) return;
  var isDark = theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
  icon.innerHTML = isDark ? THEME_ICONS.sun : THEME_ICONS.moon;
}

function initTheme() {
  var btn = $('#theme-btn');
  if (!btn) return;

  var saved = localStorage.getItem('tl_theme');
  if (saved === 'light' || saved === 'dark') {
    document.documentElement.setAttribute('data-theme', saved);
  }

  setThemeIcon(document.documentElement.getAttribute('data-theme'));

  btn.addEventListener('click', function() {
    var current = document.documentElement.getAttribute('data-theme');
    var next;
    if (current === 'dark') {
      next = 'light';
    } else if (current === 'light') {
      next = 'dark';
    } else {
      next = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark';
    }
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('tl_theme', next);
    setThemeIcon(next);
  });
}

/* ---- Admin ---- */

/* ---- Init ---- */

function init() {
  var params = new URLSearchParams(window.location.search);
  state.nickname = params.get('nickname') || localStorage.getItem('leaderboard_nickname');

  if (state.nickname) {
    localStorage.setItem('leaderboard_nickname', state.nickname);
    var display = $('#nickname-display');
    if (display) {
      display.textContent = 'Your nickname: ' + state.nickname;
    }
  }

  $$('.tab').forEach(function(btn) {
    btn.addEventListener('click', function() {
      switchTab(btn.dataset.tab);
    });
  });

  var refreshBtn = $('#refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', function() {
      state.countdown = state.refreshInterval;
      updateCountdownDisplay();
      refreshData();
    });
  }

  $('#login-modal-close').addEventListener('click', function() {
    closeModal($('#login-modal'));
  });

  // Event delegation for detailed table sort headers (one listener, no per-render accumulation)
  var detailedContainer = $('#detailed-table-container');
  detailedContainer.addEventListener('click', function(e) {
    var th = e.target.closest('th.sortable');
    if (th) {
      sortData(th.dataset.column);
      renderDetailed();
    }
  });

  initTheme();
  initSettings();
  initLogin();
  initTooltipListeners();
  initHomeTableDelegation();

  fetchStats();
  fetchHome();
  fetchDetailed();

  restartAutoRefresh();
}

document.addEventListener('DOMContentLoaded', init);
