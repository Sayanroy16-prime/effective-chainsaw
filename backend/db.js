const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const DB_PATH = path.join(__dirname, 'ration.db');
const db = new DatabaseSync(DB_PATH);

// Initialize Tables
function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS beneficiaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_uid TEXT UNIQUE NOT NULL,
      fingerprint_id INTEGER,
      name TEXT NOT NULL,
      ration_card_no TEXT UNIQUE NOT NULL,
      card_type TEXT DEFAULT 'PHH (Priority Household)',
      family_members INTEGER DEFAULT 4,
      phone TEXT,
      rice_quota_g INTEGER DEFAULT 500,
      wheat_quota_g INTEGER DEFAULT 500,
      dal_quota_g INTEGER DEFAULT 250,
      sugar_quota_g INTEGER DEFAULT 250,
      is_collected_this_month INTEGER DEFAULT 0,
      last_collected_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      commodity TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      stock_grams INTEGER NOT NULL DEFAULT 50000,
      capacity_grams INTEGER NOT NULL DEFAULT 50000,
      mini_hopper_stock_grams INTEGER NOT NULL DEFAULT 5000,
      mini_hopper_capacity_grams INTEGER NOT NULL DEFAULT 5000,
      servo_id INTEGER NOT NULL,
      unit_price_inr REAL DEFAULT 0.0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id TEXT UNIQUE NOT NULL,
      beneficiary_id INTEGER,
      beneficiary_name TEXT,
      ration_card_no TEXT,
      card_uid TEXT,
      commodity TEXT NOT NULL,
      target_weight_g INTEGER NOT NULL,
      dispensed_weight_g INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'COMPLETED',
      auth_mode TEXT DEFAULT 'RFID+BIOMETRIC',
      dispenser_id TEXT DEFAULT 'ESP32_DISP_01',
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (beneficiary_id) REFERENCES beneficiaries(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      severity TEXT DEFAULT 'INFO',
      details TEXT,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed default inventory if empty
  const countInventory = db.prepare('SELECT COUNT(*) as count FROM inventory').get();
  if (countInventory.count === 0) {
    const insertInventory = db.prepare(`
      INSERT INTO inventory (commodity, display_name, stock_grams, capacity_grams, mini_hopper_stock_grams, mini_hopper_capacity_grams, servo_id, unit_price_inr)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertInventory.run('rice', 'Arisi (Rice)', 35000, 50000, 4200, 5000, 1, 0.0);
    insertInventory.run('wheat', 'Godhumai (Wheat)', 28000, 50000, 3800, 5000, 2, 2.0);
    insertInventory.run('dal', 'Paruppu (Toor Dal)', 15000, 25000, 2500, 3000, 3, 30.0);
    insertInventory.run('sugar', 'Sarkarai (Sugar)', 20000, 30000, 2900, 3000, 4, 13.5);
  }

  // Seed sample beneficiaries if empty
  const countBeneficiaries = db.prepare('SELECT COUNT(*) as count FROM beneficiaries').get();
  if (countBeneficiaries.count === 0) {
    const insertBeneficiary = db.prepare(`
      INSERT INTO beneficiaries (card_uid, fingerprint_id, name, ration_card_no, card_type, family_members, phone, rice_quota_g, wheat_quota_g, dal_quota_g, sugar_quota_g, is_collected_this_month, last_collected_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Beneficiary 1: Ready to collect
    insertBeneficiary.run(
      'E23A4B5C',
      1,
      'Muthu Krishnan',
      'TN-03-A-778219',
      'PHH (Priority Household)',
      4,
      '+91 98401 23456',
      500,
      500,
      250,
      250,
      0,
      null
    );

    // Beneficiary 2: Already collected this month (for testing duplicate prevention)
    insertBeneficiary.run(
      'A1B2C3D4',
      2,
      'Selvi Anbarasan',
      'TN-03-A-882190',
      'AAY (Antyodaya Anna Yojana)',
      5,
      '+91 98402 34567',
      500,
      500,
      250,
      250,
      1,
      new Date(Date.now() - 86400000 * 3).toISOString()
    );

    // Beneficiary 3: Additional card
    insertBeneficiary.run(
      '4F5E6D7C',
      3,
      'Rajesh Kumar',
      'TN-03-B-334912',
      'NPHH (Non-Priority Household)',
      3,
      '+91 94441 56789',
      500,
      500,
      250,
      250,
      0,
      null
    );

    // Beneficiary 4: Demo Master Key card
    insertBeneficiary.run(
      '12345678',
      4,
      'Kavitha Sundaram',
      'TN-03-A-990142',
      'PHH (Priority Household)',
      4,
      '+91 97910 88990',
      500,
      500,
      250,
      250,
      0,
      null
    );

    // Seed initial transaction for Muthu last month
    const insertTx = db.prepare(`
      INSERT INTO transactions (transaction_id, beneficiary_id, beneficiary_name, ration_card_no, card_uid, commodity, target_weight_g, dispensed_weight_g, status, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertTx.run('TXN-2026-901', 2, 'Selvi Anbarasan', 'TN-03-A-882190', 'A1B2C3D4', 'rice', 500, 502, 'COMPLETED', new Date(Date.now() - 86400000 * 3).toISOString());
    insertTx.run('TXN-2026-902', 2, 'Selvi Anbarasan', 'TN-03-A-882190', 'A1B2C3D4', 'dal', 250, 251, 'COMPLETED', new Date(Date.now() - 86400000 * 3).toISOString());
  }
}

initDatabase();

module.exports = db;
