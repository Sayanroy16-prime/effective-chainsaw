-- =========================================================
-- Supabase Cloud SQL Schema for Smart Ration Dispenser
-- Run this in the Supabase SQL Editor (https://app.supabase.com)
-- =========================================================

-- 1. Create Users Table
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    card_uid TEXT UNIQUE,
    fingerprint_id INT UNIQUE,
    ration_card_no TEXT UNIQUE,
    eligible BOOLEAN DEFAULT true,
    family_members INT DEFAULT 4,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create Transactions Table
CREATE TABLE IF NOT EXISTS transactions (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    item_dispensed TEXT NOT NULL,
    status TEXT DEFAULT 'SUCCESS',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Enable Row Level Security (RLS) & Allow Anonymous Access for IoT Device
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon read users" ON users FOR SELECT USING (true);
CREATE POLICY "Allow anon update users" ON users FOR UPDATE USING (true);
CREATE POLICY "Allow anon insert transactions" ON transactions FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon read transactions" ON transactions FOR SELECT USING (true);

-- 4. Seed Demo Beneficiaries
INSERT INTO users (name, card_uid, fingerprint_id, ration_card_no, eligible)
VALUES 
    ('Muthu Krishnan', 'E23A4B5C', 1, 'TN-03-A-778219', true),
    ('Selvi Anbarasan', 'A1B2C3D4', 2, 'TN-03-A-882190', false),
    ('Rajesh Kumar', '4F5E6D7C', 3, 'TN-03-B-334912', true),
    ('Kavitha Sundaram', '12345678', 4, 'TN-03-A-990142', true)
ON CONFLICT DO NOTHING;
