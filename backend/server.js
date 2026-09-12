const express = require('express');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const cors = require('cors');
const path = require('path');
const os = require('os');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../frontend')));

// In-memory machine state (synchronized across ESP32, backend, and frontend)
let machineState = {
  status: 'IDLE', // IDLE, CARD_SWIPED, BIOMETRIC_VERIFIED, GRAIN_SELECTED, CONTAINER_READY, DISPENSING, COMPLETED, ERROR
  currentWeightG: 0,
  targetWeightG: 0,
  activeGrain: null,
  activeServo: 0,
  containerDetected: false,
  hopperLevelOk: true,
  currentCardUid: null,
  currentBeneficiary: null,
  language: 'EN', // EN or TA
  lastAudioPrompt: 'Welcome. Please scan your ration card.',
  lastAudioPromptTa: 'வணக்கம். உங்கள் குடும்ப அட்டையை ஸ்கேன் செய்யவும்.',
  dispenserId: 'ESP32_DISP_01',
  wifiRssi: -58,
  uptimeSec: 0,
  lastUpdated: new Date().toISOString()
};

// Broadcast machine state to all connected WebSocket clients
function broadcast(type, payload) {
  const message = JSON.stringify({ type, payload, timestamp: new Date().toISOString() });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// WebSocket Connection Handler
wss.on('connection', (ws) => {
  // Send initial state upon connection
  ws.send(JSON.stringify({
    type: 'INIT_STATE',
    payload: {
      machineState,
      inventory: db.prepare('SELECT * FROM inventory').all(),
      stats: getStatsData()
    }
  }));

  ws.on('message', (data) => {
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === 'TELEMETRY_UPDATE') {
        machineState = { ...machineState, ...parsed.payload, lastUpdated: new Date().toISOString() };
        broadcast('DISPENSER_TELEMETRY', machineState);
      } else if (parsed.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG' }));
      }
    } catch (err) {
      console.error('WebSocket parse error:', err.message);
    }
  });
});

// Helper: Stats summary
function getStatsData() {
  const totalBeneficiaries = db.prepare('SELECT COUNT(*) as count FROM beneficiaries').get().count;
  const collectedThisMonth = db.prepare('SELECT COUNT(*) as count FROM beneficiaries WHERE is_collected_this_month = 1').get().count;
  const totalDispensedG = db.prepare('SELECT COALESCE(SUM(dispensed_weight_g), 0) as total FROM transactions').get().total;
  const transactionsCount = db.prepare('SELECT COUNT(*) as count FROM transactions').get().count;
  const fraudAttempts = db.prepare("SELECT COUNT(*) as count FROM audit_logs WHERE event_type = 'DUPLICATE_COLLECTION_PREVENTED'").get().count;

  return {
    totalBeneficiaries,
    collectedThisMonth,
    pendingBeneficiaries: totalBeneficiaries - collectedThisMonth,
    totalDispensedKg: (totalDispensedG / 1000).toFixed(2),
    transactionsCount,
    fraudAttempts
  };
}

// -------------------------------------------------------------
// REST API ROUTES
// -------------------------------------------------------------

// 1. Health check & Machine State
app.get('/api/health', (req, res) => {
  res.json({ status: 'ONLINE', timestamp: new Date().toISOString() });
});

app.get('/api/dispenser/state', (req, res) => {
  res.json(machineState);
});

// 2. Beneficiaries List & Details
app.get('/api/beneficiaries', (req, res) => {
  const beneficiaries = db.prepare('SELECT * FROM beneficiaries ORDER BY id ASC').all();
  res.json(beneficiaries);
});

app.get('/api/beneficiaries/card/:uid', (req, res) => {
  const uid = req.params.uid.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const beneficiary = db.prepare("SELECT * FROM beneficiaries WHERE UPPER(REPLACE(card_uid, ':', '')) = ?").get(uid);
  if (!beneficiary) {
    return res.status(404).json({ success: false, message: 'Card not registered' });
  }
  res.json({ success: true, beneficiary });
});

app.post('/api/beneficiaries', (req, res) => {
  const { card_uid, fingerprint_id, name, ration_card_no, card_type, family_members, phone, rice_quota_g, wheat_quota_g, dal_quota_g, sugar_quota_g } = req.body;

  if (!card_uid || !name || !ration_card_no) {
    return res.status(400).json({ success: false, message: 'Card UID, Name, and Ration Card No are required.' });
  }

  try {
    const cleanUid = card_uid.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const insert = db.prepare(`
      INSERT INTO beneficiaries (card_uid, fingerprint_id, name, ration_card_no, card_type, family_members, phone, rice_quota_g, wheat_quota_g, dal_quota_g, sugar_quota_g)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insert.run(
      cleanUid,
      fingerprint_id || null,
      name,
      ration_card_no,
      card_type || 'PHH (Priority Household)',
      family_members || 4,
      phone || '',
      rice_quota_g || 500,
      wheat_quota_g || 500,
      dal_quota_g || 250,
      sugar_quota_g || 250
    );

    res.json({ success: true, id: result.lastInsertRowid, message: 'Beneficiary registered successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/beneficiaries/:id/reset-quota', (req, res) => {
  try {
    db.prepare('UPDATE beneficiaries SET is_collected_this_month = 0, last_collected_at = NULL WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Monthly quota reset successfully' });
    broadcast('DATA_UPDATED', { type: 'BENEFICIARY_RESET', id: req.params.id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/beneficiaries/reset-all', (req, res) => {
  try {
    db.prepare('UPDATE beneficiaries SET is_collected_this_month = 0').run();
    db.prepare('INSERT INTO audit_logs (event_type, message) VALUES (?, ?)').run('MONTHLY_RESET', 'All beneficiary rations reset for new calendar month.');
    res.json({ success: true, message: 'All rations reset for new monthly cycle' });
    broadcast('DATA_UPDATED', { type: 'ALL_RESET' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// -------------------------------------------------------------
// SUPABASE POSTGREST REST API COMPATIBILITY LAYER
// Allows ESP32 code using Supabase syntax to connect locally!
// -------------------------------------------------------------
// -------------------------------------------------------------
// SUPABASE POSTGREST REST API COMPATIBILITY LAYER
// Handles GET/POST /users and POST /transactions for ESP32
// Supports both '/rest/v1/...' and root '/...' paths
// -------------------------------------------------------------

// Handler: GET /users
function handleGetUsers(req, res) {
  let queryUid = null;
  let queryFp = null;

  for (const [key, value] of Object.entries(req.query)) {
    if (key === 'card_uid' && typeof value === 'string') {
      queryUid = value.replace('eq.', '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    } else if (key === 'fingerprint_id' && typeof value === 'string') {
      queryFp = parseInt(value.replace('eq.', ''), 10);
    }
  }

  let rows = [];
  if (queryUid) {
    rows = db.prepare("SELECT * FROM beneficiaries WHERE UPPER(REPLACE(card_uid, ':', '')) = ?").all(queryUid);
  } else if (queryFp) {
    rows = db.prepare("SELECT * FROM beneficiaries WHERE fingerprint_id = ?").all(queryFp);
  } else {
    rows = db.prepare("SELECT * FROM beneficiaries").all();
  }

  const mapped = rows.map(b => ({
    id: b.id,
    name: b.name,
    card_uid: b.card_uid,
    fingerprint_id: b.fingerprint_id,
    ration_card_no: b.ration_card_no,
    eligible: b.is_collected_this_month === 0,
    is_collected_this_month: b.is_collected_this_month
  }));

  res.json(mapped);
}

// Handler: POST /users (ESP32 Sign-up / Enrollment Mode)
function handlePostUsers(req, res) {
  const { card_uid, fingerprint_id, name, eligible } = req.body;

  if (!card_uid) {
    return res.status(400).json({ error: 'card_uid is required' });
  }

  const cleanUid = String(card_uid).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const fpId = fingerprint_id !== undefined && fingerprint_id !== null ? parseInt(fingerprint_id, 10) : null;
  const beneficiaryName = name || 'Registered Beneficiary';
  const isEligible = eligible !== false; // default true

  // Check if beneficiary already exists
  const existing = db.prepare("SELECT * FROM beneficiaries WHERE UPPER(REPLACE(card_uid, ':', '')) = ?").get(cleanUid);

  if (existing) {
    db.prepare(`
      UPDATE beneficiaries
      SET fingerprint_id = COALESCE(?, fingerprint_id),
          name = COALESCE(?, name),
          is_collected_this_month = ?
      WHERE id = ?
    `).run(fpId, beneficiaryName, isEligible ? 0 : 1, existing.id);

    db.prepare('INSERT INTO audit_logs (event_type, message, details) VALUES (?, ?, ?)').run(
      'BENEFICIARY_UPDATED',
      `Beneficiary ${beneficiaryName} updated from ESP32 signup button.`,
      JSON.stringify({ card_uid: cleanUid, fingerprint_id: fpId })
    );

    broadcast('DATA_UPDATED', { type: 'BENEFICIARY_UPDATED', id: existing.id });
    return res.status(200).json([{
      id: existing.id,
      name: beneficiaryName,
      card_uid: cleanUid,
      fingerprint_id: fpId,
      eligible: isEligible
    }]);
  }

  // Create new beneficiary
  const generatedRationNo = `TN-03-${Math.floor(100000 + Math.random() * 900000)}`;
  const insert = db.prepare(`
    INSERT INTO beneficiaries (card_uid, fingerprint_id, name, ration_card_no, card_type, family_members, rice_quota_g, wheat_quota_g, dal_quota_g, sugar_quota_g, is_collected_this_month)
    VALUES (?, ?, ?, ?, 'PHH (Priority Household)', 4, 500, 500, 250, 250, ?)
  `);

  const result = insert.run(cleanUid, fpId, beneficiaryName, generatedRationNo, isEligible ? 0 : 1);

  db.prepare('INSERT INTO audit_logs (event_type, message, details) VALUES (?, ?, ?)').run(
    'BENEFICIARY_ENROLLED',
    `New beneficiary enrolled from ESP32: ${beneficiaryName} (Card: ${cleanUid}, FP: #${fpId})`,
    JSON.stringify({ card_uid: cleanUid, fingerprint_id: fpId, ration_card_no: generatedRationNo })
  );

  broadcast('DATA_UPDATED', { type: 'NEW_BENEFICIARY', id: result.lastInsertRowid });
  res.status(201).json([{
    id: result.lastInsertRowid,
    name: beneficiaryName,
    card_uid: cleanUid,
    fingerprint_id: fpId,
    ration_card_no: generatedRationNo,
    eligible: isEligible
  }]);
}

// Handler: POST /transactions
function handlePostTransactions(req, res) {
  const { user_id, item_dispensed, status } = req.body;
  const cleanId = String(user_id || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

  let beneficiary = db.prepare("SELECT * FROM beneficiaries WHERE UPPER(REPLACE(card_uid, ':', '')) = ? OR fingerprint_id = ? OR id = ?").get(
    cleanId,
    parseInt(cleanId, 10) || 0,
    parseInt(cleanId, 10) || 0
  );

  const commodityName = (item_dispensed || 'Rice').toLowerCase();
  const targetWeight = commodityName === 'dal' ? 250 : 500;
  const txnId = `TXN-${Date.now().toString().slice(-6)}`;

  if (beneficiary) {
    db.prepare(`
      INSERT INTO transactions (transaction_id, beneficiary_id, beneficiary_name, ration_card_no, card_uid, commodity, target_weight_g, dispensed_weight_g, status, auth_mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      txnId,
      beneficiary.id,
      beneficiary.name,
      beneficiary.ration_card_no,
      beneficiary.card_uid,
      commodityName,
      targetWeight,
      targetWeight,
      status || 'SUCCESS',
      'RFID_OR_FINGERPRINT'
    );

    // Lock quota for the month
    db.prepare('UPDATE beneficiaries SET is_collected_this_month = 1, last_collected_at = CURRENT_TIMESTAMP WHERE id = ?').run(beneficiary.id);
  } else {
    db.prepare(`
      INSERT INTO transactions (transaction_id, beneficiary_id, beneficiary_name, ration_card_no, card_uid, commodity, target_weight_g, dispensed_weight_g, status)
      VALUES (?, NULL, 'Unknown User', 'N/A', ?, ?, ?, ?, ?)
    `).run(txnId, cleanId, commodityName, targetWeight, targetWeight, status || 'SUCCESS');
  }

  // Deduct inventory
  db.prepare(`
    UPDATE inventory
    SET stock_grams = MAX(0, stock_grams - ?),
        mini_hopper_stock_grams = MAX(0, mini_hopper_stock_grams - ?),
        updated_at = CURRENT_TIMESTAMP
    WHERE commodity = ?
  `).run(targetWeight, targetWeight, commodityName);

  broadcast('DATA_UPDATED', { type: 'NEW_TRANSACTION', txnId });
  res.status(201).json([{ id: txnId, status: 'SUCCESS' }]);
}

// Mount routes on both /rest/v1 and root /
app.get('/rest/v1/users', handleGetUsers);
app.post('/rest/v1/users', handlePostUsers);
app.post('/rest/v1/transactions', handlePostTransactions);

// Supabase smart_ration_input table endpoints
app.get('/rest/v1/smart_ration_input', handleGetUsers);
app.post('/rest/v1/smart_ration_input', (req, res) => {
  if (req.body.item_dispensed || req.body.status) {
    return handlePostTransactions(req, res);
  }
  return handlePostUsers(req, res);
});

app.get('/users', handleGetUsers);
app.post('/users', handlePostUsers);
app.post('/transactions', handlePostTransactions);
app.get('/smart_ration_input', handleGetUsers);
app.post('/smart_ration_input', (req, res) => {
  if (req.body.item_dispensed || req.body.status) {
    return handlePostTransactions(req, res);
  }
  return handlePostUsers(req, res);
});

// 3. Hardware / ESP32 Verification Endpoint (Dual-Factor: RFID + Fingerprint)
app.post('/api/dispenser/verify', (req, res) => {
  const { card_uid, fingerprint_id } = req.body;

  if (!card_uid) {
    return res.status(400).json({ success: false, error_code: 'MISSING_UID', message: 'RFID Card UID required' });
  }

  const cleanUid = card_uid.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const beneficiary = db.prepare("SELECT * FROM beneficiaries WHERE UPPER(REPLACE(card_uid, ':', '')) = ?").get(cleanUid);

  if (!beneficiary) {
    db.prepare('INSERT INTO audit_logs (event_type, message, severity, details) VALUES (?, ?, ?, ?)').run(
      'UNKNOWN_CARD_SCAN',
      `Unregistered RFID card scanned: ${cleanUid}`,
      'WARNING',
      JSON.stringify({ card_uid: cleanUid })
    );

    machineState.status = 'ERROR';
    machineState.lastAudioPrompt = 'Card not recognized. Please contact civil supplies office.';
    machineState.lastAudioPromptTa = 'அட்டை செல்லாது. நியாயவிலைக் கடை அதிகாரியை அணுகவும்.';
    broadcast('DISPENSER_TELEMETRY', machineState);

    return res.status(404).json({
      success: false,
      error_code: 'CARD_NOT_FOUND',
      audio_track_en: 11, // Card not found
      audio_track_ta: 11,
      message: 'Card not registered in ration database.'
    });
  }

  // Check if beneficiary has already collected monthly ration
  if (beneficiary.is_collected_this_month === 1) {
    db.prepare('INSERT INTO audit_logs (event_type, message, severity, details) VALUES (?, ?, ?, ?)').run(
      'DUPLICATE_COLLECTION_PREVENTED',
      `Duplicate collection attempt by ${beneficiary.name} (${beneficiary.ration_card_no})`,
      'WARNING',
      JSON.stringify({ card_uid: cleanUid, last_collected_at: beneficiary.last_collected_at })
    );

    machineState.status = 'ERROR';
    machineState.currentBeneficiary = beneficiary;
    machineState.lastAudioPrompt = "You have already collected this month's ration.";
    machineState.lastAudioPromptTa = 'இந்த மாதத்திற்கான ரேஷன் பொருட்களை ஏற்கனவே பெற்றுள்ளீர்கள்.';
    broadcast('DISPENSER_TELEMETRY', machineState);

    return res.status(403).json({
      success: false,
      error_code: 'ALREADY_COLLECTED',
      audio_track_en: 8, // Already collected audio
      audio_track_ta: 8,
      beneficiary,
      message: "You have already collected this month's ration."
    });
  }

  // Biometric Verification (If fingerprint_id is supplied by ESP32 R307S)
  if (fingerprint_id !== undefined && fingerprint_id !== null) {
    if (beneficiary.fingerprint_id && parseInt(fingerprint_id, 10) !== beneficiary.fingerprint_id) {
      db.prepare('INSERT INTO audit_logs (event_type, message, severity, details) VALUES (?, ?, ?, ?)').run(
        'BIOMETRIC_MISMATCH',
        `Biometric mismatch for ${beneficiary.name}: Sensor ID ${fingerprint_id} vs DB ID ${beneficiary.fingerprint_id}`,
        'WARNING',
        JSON.stringify({ card_uid: cleanUid, provided_fp: fingerprint_id, expected_fp: beneficiary.fingerprint_id })
      );

      machineState.status = 'ERROR';
      machineState.lastAudioPrompt = 'Fingerprint mismatch. Verification failed.';
      machineState.lastAudioPromptTa = 'கைரேகை பொருந்தவில்லை. சரிபார்ப்பு தோல்வியடைந்தது.';
      broadcast('DISPENSER_TELEMETRY', machineState);

      return res.status(401).json({
        success: false,
        error_code: 'BIOMETRIC_FAILED',
        audio_track_en: 12, // Fingerprint failed
        audio_track_ta: 12,
        message: 'Biometric fingerprint mismatch.'
      });
    }
  }

  // Verification successful
  machineState.status = 'BIOMETRIC_VERIFIED';
  machineState.currentCardUid = cleanUid;
  machineState.currentBeneficiary = beneficiary;
  machineState.lastAudioPrompt = `Authentication successful. Welcome ${beneficiary.name}. Please select commodity.`;
  machineState.lastAudioPromptTa = `சரிபார்ப்பு முடிந்தது. வருக ${beneficiary.name}. பொருளை தேர்வு செய்யவும்.`;
  broadcast('DISPENSER_TELEMETRY', machineState);

  // Return available grains & quotas
  const commodities = [
    { id: 'rice', name: 'Rice (அரிசி)', quota_g: beneficiary.rice_quota_g, servo_id: 1 },
    { id: 'wheat', name: 'Wheat (கோதுமை)', quota_g: beneficiary.wheat_quota_g, servo_id: 2 },
    { id: 'dal', name: 'Toor Dal (துவரம் பருப்பு)', quota_g: beneficiary.dal_quota_g, servo_id: 3 },
    { id: 'sugar', name: 'Sugar (சர்க்கரை)', quota_g: beneficiary.sugar_quota_g, servo_id: 4 }
  ];

  res.json({
    success: true,
    message: 'Beneficiary authenticated successfully',
    beneficiary,
    commodities,
    audio_track_en: 2, // Authentication successful
    audio_track_ta: 2
  });
});

// 4. Dispense Completion & Transaction Logging
app.post('/api/dispenser/dispense', (req, res) => {
  const { card_uid, commodity, dispensed_weight_g, dispenser_id, auth_mode } = req.body;

  if (!card_uid || !commodity || !dispensed_weight_g) {
    return res.status(400).json({ success: false, message: 'Missing required dispensing parameters.' });
  }

  const cleanUid = card_uid.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const beneficiary = db.prepare("SELECT * FROM beneficiaries WHERE UPPER(REPLACE(card_uid, ':', '')) = ?").get(cleanUid);

  if (!beneficiary) {
    return res.status(404).json({ success: false, message: 'Beneficiary not found.' });
  }

  // Get commodity info
  const item = db.prepare('SELECT * FROM inventory WHERE commodity = ?').get(commodity.toLowerCase());
  if (!item) {
    return res.status(400).json({ success: false, message: 'Invalid commodity selected.' });
  }

  const txnId = `TXN-${Date.now().toString().slice(-6)}`;
  const targetWeight = commodity === 'dal' || commodity === 'sugar' ? 250 : 500;

  // Begin transaction updates
  try {
    // 1. Insert transaction record
    db.prepare(`
      INSERT INTO transactions (transaction_id, beneficiary_id, beneficiary_name, ration_card_no, card_uid, commodity, target_weight_g, dispensed_weight_g, status, auth_mode, dispenser_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      txnId,
      beneficiary.id,
      beneficiary.name,
      beneficiary.ration_card_no,
      cleanUid,
      commodity.toLowerCase(),
      targetWeight,
      Math.round(dispensed_weight_g),
      'COMPLETED',
      auth_mode || 'RFID+BIOMETRIC',
      dispenser_id || 'ESP32_DISP_01'
    );

    // 2. Deduct inventory (mini hopper and main hopper)
    db.prepare(`
      UPDATE inventory
      SET stock_grams = MAX(0, stock_grams - ?),
          mini_hopper_stock_grams = MAX(0, mini_hopper_stock_grams - ?),
          updated_at = CURRENT_TIMESTAMP
      WHERE commodity = ?
    `).run(Math.round(dispensed_weight_g), Math.round(dispensed_weight_g), commodity.toLowerCase());

    // 3. Mark beneficiary collected
    db.prepare(`
      UPDATE beneficiaries
      SET is_collected_this_month = 1,
          last_collected_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(beneficiary.id);

    // 4. Update machine state
    machineState.status = 'COMPLETED';
    machineState.currentWeightG = Math.round(dispensed_weight_g);
    machineState.lastAudioPrompt = `${commodity.toUpperCase()} dispensed accurately. Please take your container. Thank you!`;
    machineState.lastAudioPromptTa = `${item.display_name} வழங்கப்பட்டது. பாத்திரத்தை எடுத்துக்கொள்ளவும். நன்றி!`;
    broadcast('DISPENSER_TELEMETRY', machineState);
    broadcast('DATA_UPDATED', { type: 'NEW_TRANSACTION', txnId });

    res.json({
      success: true,
      transaction_id: txnId,
      message: 'Dispensing completed and logged successfully',
      receipt: {
        transaction_id: txnId,
        beneficiary_name: beneficiary.name,
        ration_card_no: beneficiary.ration_card_no,
        commodity: item.display_name,
        dispensed_weight_g: Math.round(dispensed_weight_g),
        timestamp: new Date().toISOString()
      },
      audio_track_en: 7, // Dispensing completed. Thank you.
      audio_track_ta: 7
    });
  } catch (err) {
    console.error('Dispense transaction error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 5. Real-Time Telemetry Feed from ESP32
app.post('/api/dispenser/telemetry', (req, res) => {
  const telemetry = req.body;
  machineState = {
    ...machineState,
    ...telemetry,
    lastUpdated: new Date().toISOString()
  };

  broadcast('DISPENSER_TELEMETRY', machineState);
  res.json({ success: true, state: machineState.status });
});

// 6. Inventory & Hopper Refill
app.get('/api/inventory', (req, res) => {
  const inventory = db.prepare('SELECT * FROM inventory').all();
  res.json(inventory);
});

app.post('/api/inventory/refill', (req, res) => {
  const { commodity, add_grams } = req.body;
  if (!commodity || !add_grams) {
    return res.status(400).json({ success: false, message: 'Commodity and add_grams required' });
  }

  try {
    db.prepare(`
      UPDATE inventory
      SET stock_grams = MIN(capacity_grams, stock_grams + ?),
          mini_hopper_stock_grams = mini_hopper_capacity_grams,
          updated_at = CURRENT_TIMESTAMP
      WHERE commodity = ?
    `).run(parseInt(add_grams, 10), commodity.toLowerCase());

    db.prepare('INSERT INTO audit_logs (event_type, message, details) VALUES (?, ?, ?)').run(
      'HOPPER_REFILL',
      `Hopper refilled: ${commodity} +${(add_grams / 1000).toFixed(2)}kg`,
      JSON.stringify({ commodity, add_grams })
    );

    res.json({ success: true, message: 'Hopper refilled successfully' });
    broadcast('DATA_UPDATED', { type: 'INVENTORY_REFILL' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 7. Transactions History & Audit Logs
app.get('/api/transactions', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  const transactions = db.prepare('SELECT * FROM transactions ORDER BY id DESC LIMIT ?').all(limit);
  res.json(transactions);
});

app.get('/api/logs', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  const logs = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?').all(limit);
  res.json(logs);
});

// 8. Stats summary
app.get('/api/stats', (req, res) => {
  res.json(getStatsData());
});

// Start Server on all network interfaces (0.0.0.0) for local ESP32 LAN access
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Smart Ration Dispenser IoT Backend running on http://localhost:${PORT}`);
  
  // Print local IP addresses for ESP32 configuration
  const interfaces = os.networkInterfaces();
  console.log('\n--- Local Network IPs (Enter in firmware config.h) ---');
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`  Interface ${name}: http://${net.address}:${PORT}`);
      }
    }
  }
  console.log('------------------------------------------------------\n');
  console.log(`WebSocket server listening on ws://localhost:${PORT}`);
});
