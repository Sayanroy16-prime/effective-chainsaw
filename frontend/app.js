/**
 * Smart Ration Dispenser — operator console.
 *
 * Talks to the Express/WebSocket backend on :3001. The API contract is fixed
 * and is consumed exactly as the server defines it; nothing here changes the
 * backend.
 *
 * No external dependencies, no CDN, no build step. All motion is CSS.
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Endpoints
  // ---------------------------------------------------------------------
  var origin = window.location.origin;
  var API_BASE =
    origin.indexOf('localhost') !== -1 || origin.indexOf('127.0.0.1') !== -1
      ? origin
      : 'http://localhost:3001';
  var WS_URL =
    (window.location.protocol === 'https:' ? 'wss:' : 'ws:') +
    '//' +
    (window.location.host || 'localhost:3001');

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  var beneficiaries = [];
  var inventory = [];
  var transactions = [];
  var activeFilter = 'all';
  var txFilter = 'all';
  var sortState = { beneficiaries: null, transactions: null };
  var socket = null;

  var TAMIL = {
    rice: 'அரிசி',
    wheat: 'கோதுமை',
    dal: 'பருப்பு',
    sugar: 'சர்க்கரை'
  };

  var GPIO = { 1: 13, 2: 12, 3: 14, 4: 25 };

  var STATUS_LABEL = {
    IDLE: 'Idle',
    CARD_SWIPED: 'Card swiped',
    BIOMETRIC_VERIFIED: 'Verified',
    GRAIN_SELECTED: 'Grain selected',
    CONTAINER_READY: 'Container ready',
    DISPENSING: 'Dispensing',
    COMPLETED: 'Completed',
    ERROR: 'Error'
  };

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  /**
   * Escape before interpolating into innerHTML. Beneficiary names and card
   * numbers are operator-entered and reach us straight from the database.
   */
  function esc(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function $(id) {
    return document.getElementById(id);
  }

  function icon(name, size) {
    var s = size || 16;
    return (
      '<svg width="' + s + '" height="' + s + '" aria-hidden="true"><use href="#icon-' + name +
      '" /></svg>'
    );
  }

  function titleCase(s) {
    if (!s) return '';
    return String(s).charAt(0).toUpperCase() + String(s).slice(1);
  }

  function kg(grams) {
    return (Number(grams || 0) / 1000).toFixed(1);
  }

  function pct(part, whole) {
    if (!whole) return 0;
    return Math.min(100, Math.max(0, Math.round((Number(part || 0) / Number(whole)) * 100)));
  }

  /** Apply a stagger index so `.stagger > *` animates in sequence. */
  function stagger(container) {
    var kids = container.children;
    for (var i = 0; i < kids.length; i++) {
      kids[i].style.setProperty('--i', Math.min(i, 12));
    }
  }

  // ---------------------------------------------------------------------
  // Toasts — replaces alert() and the never-defined showToast()
  // ---------------------------------------------------------------------
  var toastHost = $('toasts');

  function toast(message, kind) {
    if (!toastHost) return;
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    var glyph = kind === 'error' ? 'alert' : kind === 'success' ? 'check' : 'info';
    el.innerHTML =
      '<span class="toast-icon">' + icon(glyph, 18) + '</span><span>' + esc(message) + '</span>';
    toastHost.appendChild(el);

    window.setTimeout(function () {
      el.classList.add('leaving');
      window.setTimeout(function () {
        el.remove();
      }, 200);
    }, 3600);
  }
  window.showToast = toast;

  // ---------------------------------------------------------------------
  // Element references
  // ---------------------------------------------------------------------
  var els = {};
  var REQUIRED = [
    'system-status-pill', 'system-status-text', 'wifi-rssi',
    'stat-dispensed', 'stat-served', 'stat-fraud',
    'lcd-line-1', 'lcd-line-2', 'active-audio-prompt', 'active-audio-prompt-ta',
    'live-weight-display', 'scale-weight', 'gauge-weight-val', 'load-cell-ring',
    'telemetry-target-weight', 'telemetry-selected-grain', 'active-servo-text',
    'ir-container-indicator', 'ir-container-dot', 'collection-container',
    'container-status-text', 'container-grain-level', 'grain-stream',
    'auth-status-pill', 'auth-details-body',
    'beneficiaries-tbody', 'beneficiary-search', 'inventory-cards-container',
    'transactions-tbody', 'count-beneficiaries', 'count-transactions',
    'conn-dot', 'conn-text', 'modal-enroll'
  ];

  /** Placeholder rows so the tables don't flash empty before data lands. */
  function showSkeletons() {
    function rows(tbody, cols, n) {
      if (!tbody) return;
      var cells = '';
      for (var c = 0; c < cols; c++) cells += '<td><span class="skeleton"></span></td>';
      var html = '';
      for (var i = 0; i < n; i++) html += '<tr>' + cells + '</tr>';
      tbody.innerHTML = html;
    }
    rows($('beneficiaries-tbody'), 9, 4);
    rows($('transactions-tbody'), 9, 3);

    var inv = $('inventory-cards-container');
    if (inv) {
      inv.innerHTML = '<span class="skeleton skeleton-card"></span>'.repeat(4);
    }
  }

  function bindElements() {
    var missing = [];
    REQUIRED.forEach(function (id) {
      var node = $(id);
      if (!node) missing.push(id);
      els[id] = node;
    });
    if (missing.length) {
      // Loud, early and specific. The previous build cached ~25 IDs with no
      // guards, so a single markup rename silently killed the whole file.
      console.error('[app] missing required elements:', missing.join(', '));
    }
  }

  // ---------------------------------------------------------------------
  // Gauge geometry — one source of truth
  //
  // The old build declared stroke-dasharray for r=52 in the HTML but computed
  // offsets against r=56 in JS, so the ring never read correctly. The radius
  // is now read back off the element itself.
  // ---------------------------------------------------------------------
  var ring = null;
  var CIRC = 0;

  function initGauge() {
    ring = $('load-cell-ring');
    if (!ring) return;
    var r = Number(ring.getAttribute('r')) || 66;
    CIRC = 2 * Math.PI * r;
    ring.style.strokeDasharray = String(CIRC);
    ring.style.strokeDashoffset = String(CIRC);
  }

  function setGauge(percent) {
    if (!ring) return;
    ring.style.strokeDashoffset = String(CIRC - (CIRC * percent) / 100);
  }

  // ---------------------------------------------------------------------
  // Dispenser telemetry
  // ---------------------------------------------------------------------
  function updateDispenserUI(state) {
    if (!state) return;

    var status = state.status || 'IDLE';

    // Status pill — driven by data-status so CSS owns the colour and the
    // modifier can never be wiped by a className assignment.
    els['system-status-pill'].setAttribute('data-status', status);
    els['system-status-text'].textContent = STATUS_LABEL[status] || status;

    if (state.wifiRssi !== undefined && state.wifiRssi !== null) {
      var rssi = Number(state.wifiRssi);
      var quality = rssi >= -60 ? 'strong' : rssi >= -75 ? 'fair' : 'weak';
      els['wifi-rssi'].textContent = rssi + ' dBm · ' + quality;
    }

    if (state.lastAudioPrompt) {
      els['active-audio-prompt'].textContent = state.lastAudioPrompt;
    }
    if (state.lastAudioPromptTa) {
      els['active-audio-prompt-ta'].textContent = state.lastAudioPromptTa;
    }

    // LCD replica
    var name = state.currentBeneficiary && state.currentBeneficiary.name;
    if (status === 'IDLE') {
      els['lcd-line-1'].textContent = 'SMART RATION PDS';
      els['lcd-line-2'].textContent = 'SCAN RFID CARD';
    } else if (status === 'BIOMETRIC_VERIFIED') {
      els['lcd-line-1'].textContent = (name || 'VERIFIED').slice(0, 16).toUpperCase();
      els['lcd-line-2'].textContent = 'SELECT GRAIN...';
    } else if (status === 'DISPENSING') {
      els['lcd-line-1'].textContent = 'DISPENSING ' + String(state.activeGrain || 'GRAIN').toUpperCase();
      els['lcd-line-2'].textContent =
        'WT ' + Math.round(state.currentWeightG || 0) + 'g / ' + (state.targetWeightG || 500) + 'g';
    } else if (status === 'COMPLETED') {
      els['lcd-line-1'].textContent = 'DISPENSE COMPLETE';
      els['lcd-line-2'].textContent = 'THANK YOU';
    } else if (status === 'ERROR') {
      els['lcd-line-1'].textContent = 'VERIFICATION FAIL';
      els['lcd-line-2'].textContent = 'ACCESS BLOCKED';
    }

    // Weight + gauge
    var current = Number(state.currentWeightG || 0);
    var target = Number(state.targetWeightG || 500);
    var fillPct = pct(current, target > 0 ? target : 500);

    els['live-weight-display'].textContent = current.toFixed(2);
    els['scale-weight'].textContent = current.toFixed(2);
    els['gauge-weight-val'].textContent = String(Math.round(current));
    els['telemetry-target-weight'].textContent = target + ' g';
    els['telemetry-selected-grain'].textContent = titleCase(state.activeGrain) || 'None';
    setGauge(fillPct);

    // Tint the chamber and stream with the active grain, and lift the silo
    // that is actually feeding so the flow path reads at a glance.
    var stage = els['collection-container'].parentElement;
    COMMODITY_ORDER.forEach(function (g) {
      stage.classList.remove('grain-' + g);
      els['grain-stream'].classList.remove('grain-' + g);
      var hop = $('hopper-' + g);
      if (hop) hop.classList.toggle('is-active', state.activeGrain === g && status === 'DISPENSING');
    });
    if (state.activeGrain) {
      stage.classList.add('grain-' + state.activeGrain);
      els['grain-stream'].classList.add('grain-' + state.activeGrain);
    }

    // Container presence (IR-1)
    if (state.containerDetected) {
      els['ir-container-indicator'].classList.add('blocked');
      els['ir-container-dot'].classList.add('active');
      els['collection-container'].classList.add('present');
      els['container-status-text'].textContent = '';
      els['container-grain-level'].style.height = fillPct + '%';
    } else {
      els['ir-container-indicator'].classList.remove('blocked');
      els['ir-container-dot'].classList.remove('active');
      els['collection-container'].classList.remove('present');
      els['container-status-text'].textContent = 'No container';
      els['container-grain-level'].style.height = '0%';
    }

    // Servo gates
    for (var i = 1; i <= 4; i++) {
      var gate = $('servo-gate-' + i);
      var label = $('gate-status-' + i);
      var open = state.activeServo === i && status === 'DISPENSING';
      if (gate) gate.setAttribute('data-open', open ? 'true' : 'false');
      if (label) label.textContent = 'Gate ' + i + (open ? ' open (65°)' : ' closed');
    }

    if (status === 'DISPENSING') {
      els['grain-stream'].classList.add('active');
      els['active-servo-text'].textContent =
        'Gate ' + state.activeServo + ' open · ' + String(state.activeGrain || '').toUpperCase();
    } else {
      els['grain-stream'].classList.remove('active');
      els['active-servo-text'].textContent = 'All locked (0°)';
    }

    renderAuthPanel(state.currentBeneficiary);
  }

  function renderAuthPanel(b) {
    var pill = els['auth-status-pill'];
    var body = els['auth-details-body'];

    if (!b) {
      pill.className = 'badge';
      pill.textContent = 'Awaiting scan';
      body.innerHTML =
        '<div class="auth-empty">' +
        icon('card', 34) +
        '<p>Scan an RFID ration card, or use the Simulator tab to start a collection.</p>' +
        '</div>';
      return;
    }

    pill.className = 'badge badge-success';
    pill.textContent = 'Authenticated';

    body.innerHTML =
      '<div class="profile">' +
      '<div class="profile-head">' +
      '<span class="profile-avatar" aria-hidden="true">' + esc(String(b.name || '?').charAt(0)) + '</span>' +
      '<span>' +
      '<span class="profile-name">' + esc(b.name) + '</span><br>' +
      '<span class="profile-card-no">' + esc(b.ration_card_no) + ' · ' + esc(b.card_uid) + '</span>' +
      '</span>' +
      '</div>' +
      '<div class="quota-grid">' +
      quotaCell('Rice', b.rice_quota_g) +
      quotaCell('Wheat', b.wheat_quota_g) +
      quotaCell('Dal', b.dal_quota_g) +
      quotaCell('Sugar', b.sugar_quota_g) +
      '</div>' +
      '</div>';
  }

  function quotaCell(label, grams) {
    return (
      '<div class="quota"><div class="quota-name">' + esc(label) + '</div>' +
      '<div class="quota-val">' + esc(grams || 0) + ' g</div></div>'
    );
  }

  // ---------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------
  function renderStats(stats) {
    if (!stats) return;
    els['stat-dispensed'].innerHTML =
      esc(stats.totalDispensedKg) + ' <span class="stat-unit">kg</span>';
    els['stat-served'].textContent =
      stats.collectedThisMonth + ' / ' + stats.totalBeneficiaries;
    els['stat-fraud'].textContent = String(stats.fraudAttempts);
  }

  function fetchStats() {
    return fetch(API_BASE + '/api/stats')
      .then(function (r) { return r.json(); })
      .then(renderStats)
      .catch(function (e) { console.error('stats:', e); });
  }

  // ---------------------------------------------------------------------
  // Beneficiaries
  // ---------------------------------------------------------------------
  function fetchBeneficiaries() {
    return fetch(API_BASE + '/api/beneficiaries')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        beneficiaries = data || [];
        els['count-beneficiaries'].textContent = String(beneficiaries.length);
        renderBeneficiaries();
      })
      .catch(function (e) { console.error('beneficiaries:', e); });
  }

  /** Sort rows in place by the active column for a table. */
  function applySort(rows, which) {
    var st = sortState[which];
    if (!st) return rows;
    var dir = st.dir === 'asc' ? 1 : -1;
    return rows.slice().sort(function (a, b) {
      var x = a[st.key], y = b[st.key];
      if (x === null || x === undefined) x = '';
      if (y === null || y === undefined) y = '';
      var nx = Number(x), ny = Number(y);
      if (!isNaN(nx) && !isNaN(ny) && x !== '' && y !== '') return (nx - ny) * dir;
      return String(x).localeCompare(String(y)) * dir;
    });
  }

  function renderBeneficiaries() {
    var tbody = els['beneficiaries-tbody'];
    var term = (els['beneficiary-search'].value || '').toLowerCase();

    var rows = beneficiaries.filter(function (b) {
      var hit =
        String(b.name).toLowerCase().indexOf(term) !== -1 ||
        String(b.ration_card_no).toLowerCase().indexOf(term) !== -1 ||
        String(b.card_uid).toLowerCase().indexOf(term) !== -1;
      if (!hit) return false;
      if (activeFilter === 'pending') return b.is_collected_this_month === 0;
      if (activeFilter === 'collected') return b.is_collected_this_month === 1;
      return true;
    });

    rows = applySort(rows, 'beneficiaries');

    if (!rows.length) {
      tbody.innerHTML =
        '<tr><td colspan="9"><div class="empty">' +
        icon('inbox', 34) +
        '<p class="empty-title">No beneficiaries match</p>' +
        '<p class="empty-hint">Try clearing the search box or switching the filter to “All”.</p>' +
        '</div></td></tr>';
      return;
    }

    tbody.innerHTML = rows
      .map(function (b) {
        var collected = b.is_collected_this_month === 1;
        return (
          '<tr>' +
          '<td><div class="cell-title">' + esc(b.name) + '</div>' +
          '<div class="cell-sub">' + esc(b.phone || 'No phone') + '</div></td>' +
          '<td class="mono">' + esc(b.ration_card_no) + '</td>' +
          '<td class="mono">' + esc(b.card_uid) + '</td>' +
          '<td><span class="cell-sub">' + esc(b.card_type) + '</span></td>' +
          '<td class="num">' + esc(b.family_members) + '</td>' +
          '<td class="num mono">' +
          esc(b.rice_quota_g) + ' / ' + esc(b.wheat_quota_g) + ' / ' +
          esc(b.dal_quota_g) + ' / ' + esc(b.sugar_quota_g) +
          '</td>' +
          '<td>' +
          (collected
            ? '<span class="badge badge-warning">Collected</span>'
            : '<span class="badge badge-success">Pending</span>') +
          '</td>' +
          '<td class="cell-sub">' +
          (b.last_collected_at ? esc(new Date(b.last_collected_at).toLocaleDateString()) : 'Never') +
          '</td>' +
          '<td>' +
          (collected
            ? '<button class="btn btn-ghost btn-sm" data-reset="' + esc(b.id) + '" type="button">Reset</button>'
            : '<span class="cell-sub">Ready</span>') +
          '</td>' +
          '</tr>'
        );
      })
      .join('');
  }

  function resetQuota(id) {
    fetch(API_BASE + '/api/beneficiaries/' + id + '/reset-quota', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.success) {
          toast('Monthly quota reset.', 'success');
          fetchBeneficiaries();
          fetchStats();
        } else {
          toast(d.message || 'Reset failed.', 'error');
        }
      })
      .catch(function (e) { toast('Reset failed: ' + e.message, 'error'); });
  }
  window.resetBeneficiaryQuota = resetQuota;

  // ---------------------------------------------------------------------
  // Inventory
  // ---------------------------------------------------------------------
  function fetchInventory() {
    return fetch(API_BASE + '/api/inventory')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        inventory = data || [];
        renderInventory();
        updateSchematic();
        renderCharts();
      })
      .catch(function (e) { console.error('inventory:', e); });
  }

  function renderInventory() {
    var host = els['inventory-cards-container'];

    if (!inventory.length) {
      host.innerHTML =
        '<div class="empty">' + icon('package', 34) +
        '<p class="empty-title">No hoppers configured</p></div>';
      return;
    }

    host.innerHTML = inventory
      .map(function (item) {
        var main = pct(item.stock_grams, item.capacity_grams);
        var mini = pct(item.mini_hopper_stock_grams, item.mini_hopper_capacity_grams);
        var level =
          main < 25
            ? '<span class="badge badge-danger">' + icon('alert', 12) + ' Low · ' + main + '%</span>'
            : main < 50
            ? '<span class="badge badge-warning">' + icon('alert', 12) + ' Fair · ' + main + '%</span>'
            : '<span class="badge badge-success">' + icon('check', 12) + ' Good · ' + main + '%</span>';

        return (
          '<article class="stock-card grain-' + esc(item.commodity) + '">' +
          '<div class="stock-head">' +
          '<span class="stock-swatch" aria-hidden="true"></span>' +
          '<div>' +
          '<div class="stock-name">' + esc(item.display_name) + '</div>' +
          '<div class="stock-tam" lang="ta">' + esc(TAMIL[item.commodity] || '') + '</div>' +
          '</div>' +
          '</div>' +

          '<div class="meter">' +
          '<div class="meter-head"><span>Main silo</span>' +
          '<span class="meter-val">' + kg(item.stock_grams) + ' / ' + kg(item.capacity_grams) + ' kg</span></div>' +
          '<div class="meter-track"><div class="meter-fill" style="width:' + main + '%"></div></div>' +
          '</div>' +

          '<div class="meter">' +
          '<div class="meter-head"><span>Buffer hopper</span>' +
          '<span class="meter-val">' + kg(item.mini_hopper_stock_grams) + ' / ' +
          kg(item.mini_hopper_capacity_grams) + ' kg</span></div>' +
          '<div class="meter-track"><div class="meter-fill" style="width:' + mini + '%"></div></div>' +
          '</div>' +

          '<div class="stock-foot">' +
          level +
          '<span class="badge">Gate ' + esc(item.servo_id) + ' · GPIO ' + esc(GPIO[item.servo_id] || '—') + '</span>' +
          '</div>' +

          '<button class="btn btn-ghost btn-block" data-refill="' + esc(item.commodity) + '" type="button">' +
          icon('plus', 16) + ' Refill 10 kg</button>' +
          '</article>'
        );
      })
      .join('');

    stagger(host);
  }

  function updateSchematic() {
    inventory.forEach(function (item) {
      var main = $('fill-' + item.commodity);
      var weight = $('weight-' + item.commodity);
      var mini = $('mini-fill-' + item.commodity);
      if (main) main.style.height = pct(item.stock_grams, item.capacity_grams) + '%';
      if (weight) weight.textContent = kg(item.stock_grams) + ' kg';
      if (mini) {
        mini.style.width = pct(item.mini_hopper_stock_grams, item.mini_hopper_capacity_grams) + '%';
      }
    });
  }

  function refill(commodity, grams) {
    return fetch(API_BASE + '/api/inventory/refill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commodity: commodity, add_grams: grams })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.success) {
          toast(d.message || 'Hopper refilled.', 'success');
          fetchInventory();
        } else {
          toast(d.message || 'Refill failed.', 'error');
        }
      })
      .catch(function (e) { toast('Refill failed: ' + e.message, 'error'); });
  }
  window.refillHopper = function (commodity) {
    return refill(commodity, 10000);
  };

  // ---------------------------------------------------------------------
  // Transactions
  // ---------------------------------------------------------------------
  function fetchTransactions() {
    return fetch(API_BASE + '/api/transactions')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        transactions = data || [];
        els['count-transactions'].textContent = String(transactions.length);
        renderTransactions();
        renderCharts();
      })
      .catch(function (e) { console.error('transactions:', e); });
  }

  function renderTransactions() {
    var tbody = els['transactions-tbody'];
    var searchEl = $('transaction-search');
    var term = (searchEl && searchEl.value ? searchEl.value : '').toLowerCase();

    var rows = transactions.filter(function (tx) {
      if (txFilter !== 'all' && String(tx.commodity).toLowerCase() !== txFilter) return false;
      if (!term) return true;
      return (
        String(tx.transaction_id).toLowerCase().indexOf(term) !== -1 ||
        String(tx.beneficiary_name || '').toLowerCase().indexOf(term) !== -1 ||
        String(tx.ration_card_no || '').toLowerCase().indexOf(term) !== -1 ||
        String(tx.card_uid || '').toLowerCase().indexOf(term) !== -1
      );
    });

    rows = applySort(rows, 'transactions');

    if (!rows.length) {
      tbody.innerHTML =
        '<tr><td colspan="9"><div class="empty">' +
        icon('receipt', 34) +
        (transactions.length
          ? '<p class="empty-title">No matching transactions</p>' +
            '<p class="empty-hint">Try clearing the search box or switching the filter to “All”.</p>'
          : '<p class="empty-title">No transactions yet</p>' +
            '<p class="empty-hint">Run a collection from the Simulator tab to create one.</p>') +
        '</div></td></tr>';
      return;
    }

    tbody.innerHTML = rows
      .map(function (tx) {
        var target = Number(tx.target_weight_g || 0);
        var actual = Number(tx.dispensed_weight_g || 0);
        var diff = actual - target;
        var within = Math.abs(diff) <= 1.5;
        var sign = diff > 0 ? '+' : '';

        return (
          '<tr>' +
          '<td class="mono">' + esc(tx.transaction_id) + '</td>' +
          '<td><div class="cell-title">' + esc(tx.beneficiary_name || 'Beneficiary') + '</div>' +
          '<div class="cell-sub mono">' + esc(tx.ration_card_no) + '</div></td>' +
          '<td>' + esc(titleCase(tx.commodity)) + '</td>' +
          '<td class="num mono">' + target + ' g</td>' +
          '<td class="num mono">' + actual.toFixed(1) + ' g</td>' +
          '<td class="num mono ' + (within ? 'text-success' : 'text-danger') + '">' +
          sign + diff.toFixed(1) + ' g</td>' +
          '<td><span class="badge">' + esc(tx.auth_mode || 'RFID+BIOMETRIC') + '</span></td>' +
          '<td><span class="badge badge-success">' + esc(tx.status || 'Completed') + '</span></td>' +
          '<td class="cell-sub">' + esc(new Date(tx.timestamp).toLocaleString()) + '</td>' +
          '</tr>'
        );
      })
      .join('');
  }

  /** Client-side CSV export. The old Export button had no handler at all. */
  function exportCsv() {
    if (!transactions.length) {
      toast('Nothing to export yet.', 'error');
      return;
    }

    var cols = [
      'transaction_id', 'timestamp', 'beneficiary_name', 'ration_card_no', 'card_uid',
      'commodity', 'target_weight_g', 'dispensed_weight_g', 'status', 'auth_mode', 'dispenser_id'
    ];

    function cell(v) {
      var s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }

    var csv = [cols.join(',')]
      .concat(transactions.map(function (tx) {
        return cols.map(function (c) { return cell(tx[c]); }).join(',');
      }))
      .join('\r\n');

    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'transactions-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('Exported ' + transactions.length + ' transactions.', 'success');
  }

  function refreshAll() {
    return Promise.all([
      fetchStats(), fetchBeneficiaries(), fetchInventory(), fetchTransactions()
    ]);
  }

  // ---------------------------------------------------------------------
  // Charts — inline SVG, no library.
  //
  // Form follows the job: chart A ranks hoppers by how full they are (a
  // comparison the per-hopper meters can't give, since capacities differ);
  // chart B is throughput over time, which exists nowhere else.
  //
  // Chart B is deliberately ONE series. A per-commodity stack was the
  // obvious design, but no four-hue categorical palette clears CVD
  // separation when segments touch, so stacking would have made identity
  // depend on colours that some readers cannot separate.
  // ---------------------------------------------------------------------
  var COMMODITY_ORDER = ['rice', 'wheat', 'dal', 'sugar'];

  function svgEl(tag, attrs) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }

  /** Horizontal bars: hoppers ranked by % of capacity, emptiest first. */
  function renderStockChart() {
    if (!inventory.length) return '<p class="chart-empty">No hopper data.</p>';

    var rows = inventory.slice().sort(function (a, b) {
      return pct(a.stock_grams, a.capacity_grams) - pct(b.stock_grams, b.capacity_grams);
    });

    var W = 700, rowH = 38, padL = 120, padR = 74;
    var H = rows.length * rowH + 10;
    var trackW = W - padL - padR;

    var bars = rows.map(function (item, i) {
      var p = pct(item.stock_grams, item.capacity_grams);
      var y = i * rowH + 8;
      var w = Math.max(2, (trackW * p) / 100);
      var label = titleCase(item.commodity);
      return (
        '<text class="chart-label" x="' + (padL - 12) + '" y="' + (y + 15) +
        '" text-anchor="end">' + esc(label) + '</text>' +
        '<rect class="chart-bar-track" x="' + padL + '" y="' + y + '" width="' + trackW +
        '" height="20" rx="4" />' +
        '<rect class="chart-bar" x="' + padL + '" y="' + y + '" width="' + w +
        '" height="20" rx="4" fill="var(--' + esc(item.commodity) + ')">' +
        '<title>' + esc(label) + ': ' + kg(item.stock_grams) + ' of ' +
        kg(item.capacity_grams) + ' kg (' + p + '%)</title></rect>' +
        '<text class="chart-value" x="' + (padL + trackW + 10) + '" y="' + (y + 15) + '">' +
        p + '%</text>'
      );
    }).join('');

    return (
      '<div class="chart">' +
      '<div class="chart-head"><span class="chart-title">Hopper capacity</span>' +
      '<span class="chart-note">emptiest first</span></div>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
      'aria-label="Hopper capacity by commodity, emptiest first. ' +
      esc(rows.map(function (i) {
        return titleCase(i.commodity) + ' ' + pct(i.stock_grams, i.capacity_grams) + ' percent';
      }).join(', ')) + '">' + bars + '</svg>' +
      '</div>'
    );
  }

  /** Columns: grams dispensed per day over the trailing 7 days. */
  function renderThroughputChart() {
    var days = [];
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    for (var d = 6; d >= 0; d--) {
      var day = new Date(today.getTime() - d * 86400000);
      days.push({ date: day, total: 0 });
    }

    transactions.forEach(function (tx) {
      var t = new Date(tx.timestamp);
      t.setHours(0, 0, 0, 0);
      for (var i = 0; i < days.length; i++) {
        if (days[i].date.getTime() === t.getTime()) {
          days[i].total += Number(tx.dispensed_weight_g || 0);
        }
      }
    });

    var max = Math.max.apply(null, days.map(function (d) { return d.total; }));
    if (max <= 0) {
      return (
        '<div class="chart">' +
        '<div class="chart-head"><span class="chart-title">Dispensed per day</span>' +
        '<span class="chart-note">last 7 days</span></div>' +
        '<p class="chart-empty">Nothing dispensed in the last 7 days.</p></div>'
      );
    }

    var W = 700, H = 210, padB = 30, padT = 26, padL = 52;
    var colW = (W - padL) / days.length;
    var barW = Math.min(54, colW - 16);
    var plotH = H - padB - padT;

    // Two recessive gridlines: max and half.
    var grid = [0, 0.5, 1].map(function (f) {
      var y = padT + plotH * (1 - f);
      return '<line class="chart-grid-line" x1="' + padL + '" y1="' + y + '" x2="' + W +
        '" y2="' + y + '" />' +
        '<text class="chart-axis-label" x="' + (padL - 10) + '" y="' + (y + 4) +
        '" text-anchor="end">' + (Math.round((max * f) / 1000 * 10) / 10) + '</text>';
    }).join('');

    var cols = days.map(function (d, i) {
      var h = d.total > 0 ? Math.max(3, (plotH * d.total) / max) : 0;
      var x = padL + i * colW + (colW - barW) / 2;
      var y = padT + plotH - h;
      var dayName = d.date.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2);
      var mark = h > 0
        ? '<rect class="chart-col" x="' + x + '" y="' + y + '" width="' + barW +
          '" height="' + h + '" rx="4"><title>' +
          esc(d.date.toLocaleDateString()) + ': ' + (d.total / 1000).toFixed(2) + ' kg</title></rect>'
        : '';
      return mark +
        '<text class="chart-axis-label" x="' + (x + barW / 2) + '" y="' + (H - 8) +
        '" text-anchor="middle">' + esc(dayName) + '</text>';
    }).join('');

    var total = days.reduce(function (a, d) { return a + d.total; }, 0);

    return (
      '<div class="chart">' +
      '<div class="chart-head"><span class="chart-title">Dispensed per day</span>' +
      '<span class="chart-note">kg · ' + (total / 1000).toFixed(2) + ' kg over 7 days</span></div>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Kilograms dispensed per day ' +
      'over the last seven days. ' + esc(days.map(function (d) {
        return d.date.toLocaleDateString() + ' ' + (d.total / 1000).toFixed(2) + ' kilograms';
      }).join(', ')) + '">' +
      grid +
      '<line class="chart-baseline" x1="' + padL + '" y1="' + (padT + plotH) +
      '" x2="' + W + '" y2="' + (padT + plotH) + '" />' +
      cols + '</svg>' +
      '</div>'
    );
  }

  function renderCharts() {
    var host = $('charts-body');
    if (!host) return;
    host.innerHTML = renderStockChart() + renderThroughputChart();
  }

  // ---------------------------------------------------------------------
  // WebSocket
  // ---------------------------------------------------------------------
  function setConnection(up, label) {
    els['conn-dot'].style.background = up ? 'var(--success)' : 'var(--danger)';
    els['conn-text'].textContent = label;
  }

  function initWebSocket() {
    try {
      socket = new WebSocket(WS_URL);
    } catch (err) {
      setConnection(false, 'Socket unavailable');
      return;
    }

    socket.addEventListener('open', function () {
      setConnection(true, 'Live');
    });

    socket.addEventListener('message', function (event) {
      var msg;
      try {
        msg = JSON.parse(event.data);
      } catch (err) {
        return;
      }

      if (msg.type === 'INIT_STATE') {
        updateDispenserUI(msg.payload.machineState);
        renderStats(msg.payload.stats);
      } else if (msg.type === 'DISPENSER_TELEMETRY') {
        updateDispenserUI(msg.payload.machineState || msg.payload);
      } else if (msg.type === 'DATA_UPDATED') {
        refreshAll();
      }
    });

    socket.addEventListener('close', function () {
      setConnection(false, 'Reconnecting…');
      window.setTimeout(initWebSocket, 3000);
    });

    socket.addEventListener('error', function () {
      setConnection(false, 'Connection error');
    });
  }

  // ---------------------------------------------------------------------
  // Tabs — ARIA tablist, roving tabindex, deep-linkable
  // ---------------------------------------------------------------------
  var tabs = [];
  var panels = [];

  function selectTab(index, opts) {
    var options = opts || {};
    if (index < 0 || index >= tabs.length) return;

    tabs.forEach(function (tab, i) {
      var on = i === index;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
      if (panels[i]) panels[i].hidden = !on;
    });

    if (options.focus) tabs[index].focus();

    var id = tabs[index].dataset.tab;
    // Deliberately NOT '#tab-overview': a hash matching a real element id
    // makes the browser jump-scroll to it and leaves a focus ring on the
    // panel. '#tab=overview' deep-links without either side effect.
    var hash = '#tab=' + id.replace('tab-', '');
    if (options.push !== false && window.location.hash !== hash) {
      history.pushState({ tab: id }, '', hash);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Re-run the entrance animation on the panel that just appeared.
    var panel = panels[index];
    if (panel) {
      panel.style.animation = 'none';
      void panel.offsetWidth;
      panel.style.animation = '';
    }
  }

  /** Read '#tab=overview' back into the panel id 'tab-overview'. */
  function tabIdFromHash() {
    var m = /^#tab=(.+)$/.exec(window.location.hash);
    return m ? 'tab-' + m[1] : '';
  }

  function tabIndexById(id) {
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].dataset.tab === id) return i;
    }
    return -1;
  }

  function initTabs() {
    tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
    panels = tabs.map(function (t) { return $(t.dataset.tab); });

    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () {
        selectTab(i);
      });

      tab.addEventListener('keydown', function (e) {
        var next = -1;
        if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = tabs.length - 1;
        if (next === -1) return;
        e.preventDefault();
        selectTab(next, { focus: true });
      });
    });

    window.addEventListener('popstate', function () {
      var idx = tabIndexById(tabIdFromHash());
      selectTab(idx === -1 ? 0 : idx, { push: false });
    });

    // Entry point: ?tab=… (kept from the old build) then #hash.
    var params = new URLSearchParams(window.location.search);
    var wanted = params.get('tab') || tabIdFromHash();
    var start = tabIndexById(wanted);
    selectTab(start === -1 ? 0 : start, { push: false });
  }

  // ---------------------------------------------------------------------
  // Modal
  // ---------------------------------------------------------------------
  function initModal() {
    var modal = els['modal-enroll'];
    var form = $('form-enroll');
    var lastFocus = null;

    function open() {
      lastFocus = document.activeElement;
      modal.hidden = false;
      $('new-name').focus();
    }

    function close() {
      modal.hidden = true;
      if (lastFocus) lastFocus.focus();
    }

    $('btn-add-beneficiary').addEventListener('click', open);
    $('modal-enroll-close').addEventListener('click', close);
    $('modal-enroll-cancel').addEventListener('click', close);

    modal.addEventListener('click', function (e) {
      if (e.target === modal) close();
    });

    document.addEventListener('keydown', function (e) {
      if (modal.hidden) return;

      if (e.key === 'Escape') {
        close();
        return;
      }

      // Trap Tab inside the dialog — without this, focus walks out behind
      // the backdrop and the operator is typing into an invisible page.
      if (e.key !== 'Tab') return;
      // `a[href]`, not `[href]` — a bare [href] also matches every SVG
      // <use href="#icon-…"> in the dialog, and those are not focusable.
      var focusable = modal.querySelectorAll(
        'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      var list = Array.prototype.filter.call(focusable, function (el) {
        return !el.disabled && el.offsetParent !== null;
      });
      if (!list.length) return;
      var first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var payload = {
        name: $('new-name').value.trim(),
        ration_card_no: $('new-card-no').value.trim(),
        card_uid: $('new-rfid-uid').value.trim(),
        fingerprint_id: parseInt($('new-fp-id').value, 10) || null,
        card_type: $('new-card-type').value,
        family_members: parseInt($('new-family-count').value, 10) || 4,
        rice_quota_g: parseInt($('new-quota-rice').value, 10) || 500,
        wheat_quota_g: parseInt($('new-quota-wheat').value, 10) || 500,
        dal_quota_g: parseInt($('new-quota-dal').value, 10) || 250,
        sugar_quota_g: parseInt($('new-quota-sugar').value, 10) || 250
      };

      fetch(API_BASE + '/api/beneficiaries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.success) {
            close();
            form.reset();
            toast('Beneficiary enrolled.', 'success');
            fetchBeneficiaries();
            fetchStats();
          } else {
            toast(d.message || 'Enrollment failed.', 'error');
          }
        })
        .catch(function (err) { toast('Enrollment error: ' + err.message, 'error'); });
    });
  }

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------

  /**
   * A short confirmation tone, synthesised locally. The old build fetched an
   * .ogg from a Google CDN, which cannot work on an offline terminal.
   */
  function beep() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.45);
      osc.onended = function () { ctx.close(); };
    } catch (err) {
      /* Audio is a convenience, never a requirement. */
    }
  }

  function initActions() {
    // Delegated: table rows and stock cards are re-rendered constantly, so
    // binding per element would leak handlers.
    document.addEventListener('click', function (e) {
      var reset = e.target.closest('[data-reset]');
      if (reset) {
        resetQuota(reset.getAttribute('data-reset'));
        return;
      }
      var refillBtn = e.target.closest('[data-refill]');
      if (refillBtn) {
        refill(refillBtn.getAttribute('data-refill'), 10000);
      }
    });

    els['beneficiary-search'].addEventListener('input', renderBeneficiaries);

    var txSearch = $('transaction-search');
    if (txSearch) txSearch.addEventListener('input', renderTransactions);

    Array.prototype.forEach.call(document.querySelectorAll('[data-txfilter]'), function (btn) {
      btn.addEventListener('click', function () {
        txFilter = btn.getAttribute('data-txfilter');
        Array.prototype.forEach.call(document.querySelectorAll('[data-txfilter]'), function (b) {
          b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
        });
        renderTransactions();
      });
    });

    // Sortable column headers.
    Array.prototype.forEach.call(document.querySelectorAll('[data-sort]'), function (btn) {
      btn.addEventListener('click', function () {
        var th = btn.closest('th');
        var table = btn.closest('table');
        var which = table.id === 'transactions-table' ? 'transactions' : 'beneficiaries';
        var key = btn.getAttribute('data-sort');
        var cur = sortState[which];
        var dir = cur && cur.key === key && cur.dir === 'asc' ? 'desc' : 'asc';
        sortState[which] = { key: key, dir: dir };

        Array.prototype.forEach.call(table.querySelectorAll('th'), function (h) {
          h.removeAttribute('aria-sort');
        });
        th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');

        if (which === 'transactions') renderTransactions();
        else renderBeneficiaries();
      });
    });

    // Number keys jump straight to a tab, unless the operator is typing.
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (!$('modal-enroll').hidden) return;
      var n = parseInt(e.key, 10);
      if (n >= 1 && n <= tabs.length) {
        e.preventDefault();
        selectTab(n - 1, { focus: true });
      }
    });

    Array.prototype.forEach.call(document.querySelectorAll('.filter'), function (btn) {
      btn.addEventListener('click', function () {
        activeFilter = btn.dataset.filter;
        Array.prototype.forEach.call(document.querySelectorAll('.filter'), function (b) {
          b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
        });
        renderBeneficiaries();
      });
    });

    $('btn-reset-all-month').addEventListener('click', function () {
      fetch(API_BASE + '/api/beneficiaries/reset-all', { method: 'POST' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          toast(d.message || 'Monthly cycle reset.', 'success');
          fetchBeneficiaries();
          fetchStats();
        })
        .catch(function (e) { toast('Reset failed: ' + e.message, 'error'); });
    });

    $('btn-bulk-refill').addEventListener('click', function () {
      Promise.all(
        inventory.map(function (i) {
          return fetch(API_BASE + '/api/inventory/refill', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ commodity: i.commodity, add_grams: 15000 })
          });
        })
      ).then(function () {
        toast('All hoppers topped up by 15 kg.', 'success');
        fetchInventory();
      });
    });

    $('btn-export-csv').addEventListener('click', exportCsv);

    $('btn-open-simulator').addEventListener('click', function () {
      selectTab(tabIndexById('tab-simulator'), { focus: true });
    });

    $('btn-tare-scale').addEventListener('click', function () {
      els['live-weight-display'].textContent = '0.00';
      els['scale-weight'].textContent = '0.00';
      els['gauge-weight-val'].textContent = '0';
      setGauge(0);
      toast('Load cell tared to 0.00 g.', 'success');
    });

    $('btn-test-audio').addEventListener('click', function () {
      beep();
      els['active-audio-prompt'].textContent = 'DFPlayer Mini speaker test — track 001.';
      els['active-audio-prompt-ta'].textContent = 'ஒலிபெருக்கி சோதனை — பாடல் 001.';
    });

    $('btn-emergency-stop').addEventListener('click', function () {
      if (window.abortDispense) window.abortDispense();
      fetch(API_BASE + '/api/dispenser/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'IDLE',
          activeServo: 0,
          lastAudioPrompt: 'Emergency stop engaged. All servo gates closed.'
        })
      });
      toast('Emergency stop engaged. All gates closed.', 'error');
    });
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  function boot() {
    bindElements();
    showSkeletons();
    initGauge();
    initTabs();
    initModal();
    initActions();
    initWebSocket();
    refreshAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
