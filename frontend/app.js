/**
 * Smart Ration Dispenser - Frontend Client Application
 * Handles real-time WebSocket telemetry, REST data sync, and UI rendering
 */

const API_BASE = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
  ? window.location.origin
  : 'http://localhost:3001';

const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host || 'localhost:3001'}`;

// State
let ws = null;
let currentBeneficiaries = [];
let currentInventory = [];
let activeFilter = 'all';

// DOM Elements
const systemStatusPill = document.getElementById('system-status-pill');
const systemStatusText = document.getElementById('system-status-text');
const wifiRssiEl = document.getElementById('wifi-rssi');

const statDispensed = document.getElementById('stat-dispensed');
const statServed = document.getElementById('stat-served');
const statFraud = document.getElementById('stat-fraud');

const lcdLine1 = document.getElementById('lcd-line-1');
const lcdLine2 = document.getElementById('lcd-line-2');
const activeAudioPrompt = document.getElementById('active-audio-prompt');
const activeAudioPromptTa = document.getElementById('active-audio-prompt-ta');

const liveWeightDisplay = document.getElementById('live-weight-display');
const gaugeWeightVal = document.getElementById('gauge-weight-val');
const loadCellRing = document.getElementById('load-cell-ring');
const telemetryTargetWeight = document.getElementById('telemetry-target-weight');
const telemetrySelectedGrain = document.getElementById('telemetry-selected-grain');
const activeServoText = document.getElementById('active-servo-text');

const irContainerIndicator = document.getElementById('ir-container-indicator');
const irContainerDot = document.getElementById('ir-container-dot');
const collectionContainer = document.getElementById('collection-container');
const containerStatusText = document.getElementById('container-status-text');
const containerGrainLevel = document.getElementById('container-grain-level');
const grainStream = document.getElementById('grain-stream');

const authStatusPill = document.getElementById('auth-status-pill');
const authDetailsBody = document.getElementById('auth-details-body');

// Initialize Web App
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initWebSocket();
  fetchStats();
  fetchBeneficiaries();
  fetchInventory();
  fetchTransactions();
  initModal();
  initQuickActions();
});

// -------------------------------------------------------------
// WebSocket Real-Time Connection
// -------------------------------------------------------------
function initWebSocket() {
  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('WebSocket Connected to Smart Ration Edge Backend');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'INIT_STATE' || msg.type === 'DISPENSER_TELEMETRY') {
          updateDispenserUI(msg.payload.machineState || msg.payload);
          if (msg.payload.stats) renderStats(msg.payload.stats);
        } else if (msg.type === 'DATA_UPDATED') {
          fetchStats();
          fetchBeneficiaries();
          fetchInventory();
          fetchTransactions();
        }
      } catch (e) {
        console.error('WS parse error:', e);
      }
    };

    ws.onclose = () => {
      console.warn('WS disconnected. Reconnecting in 3s...');
      setTimeout(initWebSocket, 3000);
    };
  } catch (err) {
    console.error('WS Error:', err);
  }
}

// -------------------------------------------------------------
// UI Telemetry Sync
// -------------------------------------------------------------
function updateDispenserUI(state) {
  if (!state) return;

  // Status Badge
  systemStatusText.textContent = state.status || 'READY';
  if (state.status === 'DISPENSING') {
    systemStatusPill.className = 'system-status-pill';
    systemStatusPill.style.background = 'rgba(6, 182, 212, 0.15)';
    systemStatusPill.style.color = '#06b6d4';
  } else if (state.status === 'ERROR') {
    systemStatusPill.className = 'system-status-pill';
    systemStatusPill.style.background = 'rgba(244, 63, 94, 0.15)';
    systemStatusPill.style.color = '#f43f5e';
  } else {
    systemStatusPill.className = 'system-status-pill';
    systemStatusPill.style.background = 'rgba(16, 185, 129, 0.1)';
    systemStatusPill.style.color = '#10b981';
  }

  // Audio & LCD
  if (state.lastAudioPrompt) activeAudioPrompt.textContent = `"${state.lastAudioPrompt}"`;
  if (state.lastAudioPromptTa) activeAudioPromptTa.textContent = `"${state.lastAudioPromptTa}"`;

  if (state.status === 'IDLE') {
    lcdLine1.textContent = 'SMART RATION PDS';
    lcdLine2.textContent = 'SCAN RFID / அட்டை';
  } else if (state.status === 'BIOMETRIC_VERIFIED') {
    lcdLine1.textContent = (state.currentBeneficiary?.name || 'VERIFIED').slice(0, 16).toUpperCase();
    lcdLine2.textContent = 'SELECT GRAIN...';
  } else if (state.status === 'DISPENSING') {
    lcdLine1.textContent = `DISPENSING ${(state.activeGrain || 'GRAIN').toUpperCase()}`;
    lcdLine2.textContent = `WT: ${state.currentWeightG || 0}g / ${state.targetWeightG || 500}g`;
  } else if (state.status === 'COMPLETED') {
    lcdLine1.textContent = 'DISPENSE COMPLETE';
    lcdLine2.textContent = 'THANK YOU / நன்றி';
  } else if (state.status === 'ERROR') {
    lcdLine1.textContent = 'VERIFICATION FAIL';
    lcdLine2.textContent = 'ACCESS BLOCKED';
  }

  // Weight & Gauge
  const currentWt = state.currentWeightG || 0;
  const targetWt = state.targetWeightG || 500;
  liveWeightDisplay.textContent = currentWt.toFixed(2);
  gaugeWeightVal.textContent = Math.round(currentWt);
  telemetryTargetWeight.textContent = `${targetWt} g`;
  telemetrySelectedGrain.textContent = state.activeGrain ? state.activeGrain.toUpperCase() : 'None';

  // SVG Progress Ring (circumference = 351.85)
  const maxVal = targetWt > 0 ? targetWt : 500;
  const percent = Math.min(100, Math.max(0, (currentWt / maxVal) * 100));
  const offset = 351.85 - (351.85 * percent) / 100;
  loadCellRing.style.strokeDashoffset = offset;
  containerGrainLevel.style.height = `${percent}%`;

  // Container Presence (IR-1)
  if (state.containerDetected) {
    irContainerIndicator.classList.add('blocked');
    irContainerDot.classList.add('active');
    collectionContainer.classList.add('present');
    containerStatusText.textContent = 'CONTAINER READY';
  } else {
    irContainerIndicator.classList.remove('blocked');
    irContainerDot.classList.remove('active');
    collectionContainer.classList.remove('present');
    containerStatusText.textContent = 'NO CONTAINER';
    containerGrainLevel.style.height = '0%';
  }

  // Active Servo & Grain stream
  for (let i = 1; i <= 4; i++) {
    const gateEl = document.getElementById(`servo-gate-${i}`);
    const statusEl = document.getElementById(`gate-status-${i}`);
    if (state.activeServo === i && state.status === 'DISPENSING') {
      gateEl?.classList.add('open');
      if (statusEl) statusEl.textContent = `GATE ${i} OPEN (65°)`;
    } else {
      gateEl?.classList.remove('open');
      if (statusEl) statusEl.textContent = `GATE ${i} CLOSED`;
    }
  }

  if (state.status === 'DISPENSING') {
    grainStream.classList.add('active');
    activeServoText.textContent = `Gate ${state.activeServo} Open (${state.activeGrain?.toUpperCase()})`;
    activeServoText.style.color = 'var(--accent-emerald)';
  } else {
    grainStream.classList.remove('active');
    activeServoText.textContent = 'All Servos Locked (0°)';
    activeServoText.style.color = '#ffffff';
  }

  // Beneficiary Profile
  if (state.currentBeneficiary) {
    authStatusPill.textContent = 'Beneficiary Authenticated';
    authStatusPill.style.color = 'var(--accent-emerald)';
    authStatusPill.style.borderColor = 'rgba(16, 185, 129, 0.3)';

    authDetailsBody.innerHTML = `
      <div class="beneficiary-profile-box">
        <div class="bp-header">
          <div class="bp-avatar">${state.currentBeneficiary.name.charAt(0)}</div>
          <div>
            <div class="bp-name">${state.currentBeneficiary.name}</div>
            <div class="bp-cardno">${state.currentBeneficiary.ration_card_no} • UID: ${state.currentBeneficiary.card_uid}</div>
          </div>
        </div>
        <div class="bp-quota-grid">
          <div class="bp-quota-item">
            <span>Rice Quota:</span>
            <span>${state.currentBeneficiary.rice_quota_g} g</span>
          </div>
          <div class="bp-quota-item">
            <span>Wheat Quota:</span>
            <span>${state.currentBeneficiary.wheat_quota_g} g</span>
          </div>
          <div class="bp-quota-item">
            <span>Toor Dal:</span>
            <span>${state.currentBeneficiary.dal_quota_g} g</span>
          </div>
          <div class="bp-quota-item">
            <span>Sugar Quota:</span>
            <span>${state.currentBeneficiary.sugar_quota_g} g</span>
          </div>
        </div>
      </div>
    `;
  } else {
    authStatusPill.textContent = 'Awaiting RFID Scan';
    authStatusPill.style.color = 'var(--text-muted)';
    authStatusPill.style.borderColor = 'var(--border-color)';
    authDetailsBody.innerHTML = `
      <div class="auth-placeholder">
        <div class="rfid-card-anim">💳</div>
        <p>Scan RFID Smart Card or use the Simulator tab to initiate ration collection.</p>
      </div>
    `;
  }
}

// -------------------------------------------------------------
// Stats and Summary
// -------------------------------------------------------------
async function fetchStats() {
  try {
    const res = await fetch(`${API_BASE}/api/stats`);
    const data = await res.json();
    renderStats(data);
  } catch (err) {
    console.error('Failed to fetch stats:', err);
  }
}

function renderStats(stats) {
  if (!stats) return;
  statDispensed.textContent = `${stats.totalDispensedKg} kg`;
  statServed.textContent = `${stats.collectedThisMonth} / ${stats.totalBeneficiaries}`;
  statFraud.textContent = stats.fraudAttempts;
}

// -------------------------------------------------------------
// Beneficiaries Management
// -------------------------------------------------------------
async function fetchBeneficiaries() {
  try {
    const res = await fetch(`${API_BASE}/api/beneficiaries`);
    currentBeneficiaries = await res.json();
    renderBeneficiariesTable();
  } catch (err) {
    console.error('Failed to fetch beneficiaries:', err);
  }
}

function renderBeneficiariesTable() {
  const tbody = document.getElementById('beneficiaries-tbody');
  const search = document.getElementById('beneficiary-search')?.value.toLowerCase() || '';

  const filtered = currentBeneficiaries.filter(b => {
    const matchSearch = b.name.toLowerCase().includes(search) ||
                        b.ration_card_no.toLowerCase().includes(search) ||
                        b.card_uid.toLowerCase().includes(search);
    if (!matchSearch) return false;
    if (activeFilter === 'pending') return b.is_collected_this_month === 0;
    if (activeFilter === 'collected') return b.is_collected_this_month === 1;
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 30px;">No beneficiaries found matching criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(b => `
    <tr>
      <td><span style="font-family: var(--font-mono); font-weight: 700; color: #fff;">${b.ration_card_no}</span></td>
      <td><strong>${b.name}</strong><br><span style="font-size: 11px; color: var(--text-dim);">${b.phone || 'No phone'}</span></td>
      <td><code style="background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px; color: var(--accent-cyan); font-family: var(--font-mono);">${b.card_uid}</code></td>
      <td>${b.fingerprint_id ? `<span class="badge badge-neutral">FP #${b.fingerprint_id}</span>` : '<span style="color: var(--text-dim);">Unlinked</span>'}</td>
      <td><span style="font-size: 11px;">${b.card_type}</span></td>
      <td>
        <span style="font-size: 11px; font-family: var(--font-mono); color: var(--text-muted);">
          Rice: ${b.rice_quota_g}g | Wheat: ${b.wheat_quota_g}g<br>
          Dal: ${b.dal_quota_g}g | Sugar: ${b.sugar_quota_g}g
        </span>
      </td>
      <td>
        ${b.is_collected_this_month === 1 
          ? '<span class="badge badge-warning">Collected</span>' 
          : '<span class="badge badge-success">Eligible</span>'}
      </td>
      <td><span style="font-size: 11px; color: var(--text-muted);">${b.last_collected_at ? new Date(b.last_collected_at).toLocaleDateString() : 'Never'}</span></td>
      <td>
        ${b.is_collected_this_month === 1 
          ? `<button class="btn btn-secondary btn-xs" onclick="resetBeneficiaryQuota(${b.id})">Reset Quota</button>` 
          : '<span style="font-size: 11px; color: var(--text-dim);">Ready</span>'}
      </td>
    </tr>
  `).join('');
}

window.resetBeneficiaryQuota = async function(id) {
  try {
    const res = await fetch(`${API_BASE}/api/beneficiaries/${id}/reset-quota`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      fetchBeneficiaries();
      fetchStats();
    }
  } catch (err) {
    alert('Failed to reset quota: ' + err.message);
  }
};

// -------------------------------------------------------------
// Inventory Hoppers
// -------------------------------------------------------------
async function fetchInventory() {
  try {
    const res = await fetch(`${API_BASE}/api/inventory`);
    currentInventory = await res.json();
    renderInventoryCards();
    updateSchematicHoppers();
  } catch (err) {
    console.error('Failed to fetch inventory:', err);
  }
}

function renderInventoryCards() {
  const container = document.getElementById('inventory-cards-container');
  if (!container) return;

  container.innerHTML = currentInventory.map(item => {
    const pct = Math.round((item.stock_grams / item.capacity_grams) * 100);
    const miniPct = Math.round((item.mini_hopper_stock_grams / item.mini_hopper_capacity_grams) * 100);
    const color = item.commodity === 'rice'  ? 'linear-gradient(90deg,#94a3b8,#e2e8f0)' :
                  item.commodity === 'wheat' ? 'linear-gradient(90deg,#b45309,#fbbf24)' :
                  item.commodity === 'dal'   ? 'linear-gradient(90deg,#c2410c,#fb923c)' :
                                              'linear-gradient(90deg,#0369a1,#38bdf8)';
    const pctColor = pct < 25 ? 'badge-danger' : pct < 50 ? 'badge-warning' : 'badge-success';
    const tam = item.commodity === 'rice' ? 'அரிசி' : item.commodity === 'wheat' ? 'கோதுமை' :
                item.commodity === 'dal'  ? 'பருப்பு' : 'சர்க்கரை';
    const icon = item.commodity === 'rice' ? '🌾' : item.commodity === 'wheat' ? '🥖' :
                 item.commodity === 'dal'  ? '🥣' : '🧂';

    return `
      <div class="inv-card ${item.commodity}">
        <div class="inv-header">
          <div class="inv-title-group">
            <div class="inv-title">${icon} ${item.display_name}</div>
            <div class="inv-tam">${tam}</div>
          </div>
          <span class="badge ${pctColor}">${pct}% Full</span>
        </div>

        <div class="inv-bar-wrap">
          <div class="inv-bar-bg">
            <div class="inv-bar-fill" style="width:${pct}%; background:${color};"></div>
          </div>
          <div class="inv-stock-stats">
            <span>Main Tank:</span>
            <span>${(item.stock_grams/1000).toFixed(1)} / ${(item.capacity_grams/1000).toFixed(0)} kg</span>
          </div>
        </div>

        <div class="inv-buffer-tag">
          🪣 Mini-Hopper: ${(item.mini_hopper_stock_grams/1000).toFixed(2)} kg (${miniPct}%)
        </div>

        <div class="inv-servo-tag" style="margin-top:4px; font-size:10px; color:var(--text-muted);">
          Gate Servo #${item.servo_id} · GPIO ${item.servo_id === 1 ? 13 : item.servo_id === 2 ? 12 : item.servo_id === 3 ? 14 : 25}
        </div>

        <button class="btn btn-secondary btn-xs" style="margin-top:8px;width:100%;" onclick="refillHopper('${item.commodity}')">
          ➕ Refill +10 kg
        </button>
      </div>
    `;
  }).join('');
}

function updateSchematicHoppers() {
  currentInventory.forEach(item => {
    const mainFill = document.getElementById(`fill-${item.commodity}`);
    const mainWeight = document.getElementById(`weight-${item.commodity}`);
    const miniFill = document.getElementById(`mini-fill-${item.commodity}`);

    if (mainFill) {
      const pct = (item.stock_grams / item.capacity_grams) * 100;
      mainFill.style.height = `${pct}%`;
    }
    if (mainWeight) {
      mainWeight.textContent = `${(item.stock_grams / 1000).toFixed(1)} kg`;
    }
    if (miniFill) {
      const miniPct = (item.mini_hopper_stock_grams / item.mini_hopper_capacity_grams) * 100;
      miniFill.style.height = `${miniPct}%`;
    }
  });
}

window.refillHopper = async function(commodity) {
  try {
    const res = await fetch(`${API_BASE}/api/inventory/refill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commodity, add_grams: 10000 })
    });
    const data = await res.json();
    if (data.success) {
      fetchInventory();
    }
  } catch (err) {
    alert('Refill failed: ' + err.message);
  }
};

// -------------------------------------------------------------
// Transactions & Logs
// -------------------------------------------------------------
async function fetchTransactions() {
  try {
    const res = await fetch(`${API_BASE}/api/transactions`);
    const transactions = await res.json();
    renderTransactionsTable(transactions);
  } catch (err) {
    console.error('Failed to fetch transactions:', err);
  }
}

function renderTransactionsTable(transactions) {
  const tbody = document.getElementById('transactions-tbody');
  if (!tbody) return;

  if (transactions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 24px;">No transactions recorded yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = transactions.map(tx => `
    <tr>
      <td><span style="font-family: var(--font-mono); font-weight: 700; color: var(--accent-cyan);">${tx.transaction_id}</span></td>
      <td><span style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono);">${new Date(tx.timestamp).toLocaleString()}</span></td>
      <td><strong>${tx.beneficiary_name || 'Beneficiary'}</strong></td>
      <td><span style="font-family: var(--font-mono); font-size: 11px;">${tx.ration_card_no}</span></td>
      <td><span style="text-transform: capitalize; font-weight: 600;">${tx.commodity}</span></td>
      <td><span style="font-family: var(--font-mono);">${tx.target_weight_g} g</span></td>
      <td><strong style="font-family: var(--font-mono); color: var(--accent-emerald);">${tx.dispensed_weight_g} g</strong></td>
      <td><span class="badge badge-neutral">${tx.auth_mode || 'RFID+BIOMETRIC'}</span></td>
      <td><span class="badge badge-success">Completed</span></td>
    </tr>
  `).join('');
}

// -------------------------------------------------------------
// Navigation & Modals
// -------------------------------------------------------------
function initNavigation() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const targetId = tab.dataset.tab;
      if (targetId) {
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        document.getElementById(targetId)?.classList.add('active');
      }
      if (window.scrollFX && typeof window.scrollFX.goTo === 'function') {
        window.scrollFX.goTo(index, true);
      }
    });
  });

  // Handle URL query parameter ?tab=...
  const urlParams = new URLSearchParams(window.location.search);
  const targetTab = urlParams.get('tab');
  if (targetTab) {
    document.querySelector(`.nav-tab[data-tab="${targetTab}"]`)?.click();
  }

  // Search filter
  document.getElementById('beneficiary-search')?.addEventListener('input', renderBeneficiariesTable);

  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeFilter = pill.dataset.filter;
      renderBeneficiariesTable();
    });
  });

  // Reset all month
  document.getElementById('btn-reset-all-month')?.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to reset all beneficiary quotas for the new month cycle?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/beneficiaries/reset-all`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        alert(data.message);
        fetchBeneficiaries();
        fetchStats();
      }
    } catch (err) {
      alert('Reset failed: ' + err.message);
    }
  });

  // Bulk refill
  document.getElementById('btn-bulk-refill')?.addEventListener('click', async () => {
    const commodities = ['rice', 'wheat', 'dal', 'sugar'];
    for (const c of commodities) {
      await fetch(`${API_BASE}/api/inventory/refill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commodity: c, add_grams: 15000 })
      });
    }
    fetchInventory();
    alert('All 4 hoppers refilled with +15kg stock.');
  });
}

function initModal() {
  const modal = document.getElementById('modal-enroll');
  const btnAdd = document.getElementById('btn-add-beneficiary');
  const btnClose = document.getElementById('modal-enroll-close');
  const btnCancel = document.getElementById('modal-enroll-cancel');
  const form = document.getElementById('form-enroll');

  btnAdd?.addEventListener('click', () => modal.classList.add('active'));
  btnClose?.addEventListener('click', () => modal.classList.remove('active'));
  btnCancel?.addEventListener('click', () => modal.classList.remove('active'));

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('new-name').value.trim(),
      ration_card_no: document.getElementById('new-card-no').value.trim(),
      card_uid: document.getElementById('new-rfid-uid').value.trim(),
      fingerprint_id: parseInt(document.getElementById('new-fp-id').value, 10) || null,
      card_type: document.getElementById('new-card-type').value,
      family_members: parseInt(document.getElementById('new-family-count').value, 10) || 4,
      rice_quota_g: parseInt(document.getElementById('new-quota-rice').value, 10) || 500,
      wheat_quota_g: parseInt(document.getElementById('new-quota-wheat').value, 10) || 500,
      dal_quota_g: parseInt(document.getElementById('new-quota-dal').value, 10) || 250,
      sugar_quota_g: parseInt(document.getElementById('new-quota-sugar').value, 10) || 250
    };

    try {
      const res = await fetch(`${API_BASE}/api/beneficiaries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        modal.classList.remove('active');
        form.reset();
        fetchBeneficiaries();
        fetchStats();
      } else {
        alert(data.message);
      }
    } catch (err) {
      alert('Enrollment error: ' + err.message);
    }
  });
}

function initQuickActions() {
  document.getElementById('btn-open-simulator')?.addEventListener('click', () => {
    document.querySelector('.nav-tab[data-tab="tab-simulator"]')?.click();
  });

  document.getElementById('btn-tare-scale')?.addEventListener('click', () => {
    liveWeightDisplay.textContent = '0.00';
    gaugeWeightVal.textContent = '0';
    loadCellRing.style.strokeDashoffset = 351.85;
    alert('HX711 Load Cell auto-tared to 0.00g');
  });

  document.getElementById('btn-test-audio')?.addEventListener('click', () => {
    const audioTrack = new Audio('https://actions.google.com/sounds/v1/communication/service_bell.ogg');
    audioTrack.play().catch(() => {});
    activeAudioPrompt.textContent = '"DFPlayer Mini Speaker Test - Track 001 playing..."';
  });

  document.getElementById('btn-emergency-stop')?.addEventListener('click', () => {
    if (window.abortDispense) window.abortDispense();
    fetch(`${API_BASE}/api/dispenser/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'IDLE',
        activeServo: 0,
        lastAudioPrompt: 'Emergency Stop Engaged. All Servos Closed.'
      })
    });
  });
}
