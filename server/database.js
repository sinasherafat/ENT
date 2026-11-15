import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, salt, expectedHex) {
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function openDatabase(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','final')),
      patient_name TEXT NOT NULL,
      patient_id TEXT NOT NULL DEFAULT '',
      examination_date TEXT NOT NULL,
      modalities_json TEXT NOT NULL,
      state_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finalized_at TEXT
    );
    CREATE INDEX IF NOT EXISTS reports_owner_updated ON reports(owner_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS reports_patient_search ON reports(owner_id, patient_name, patient_id);
    CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      modality TEXT NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS images_report ON images(report_id, modality, created_at);
    CREATE TABLE IF NOT EXISTS clinic_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      clinician_name TEXT NOT NULL,
      professional_title TEXT NOT NULL,
      center_descriptor TEXT NOT NULL,
      address TEXT NOT NULL,
      telephone TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      registration_number TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL,
      footer_text TEXT NOT NULL DEFAULT 'Confidential clinical report',
      logo_path TEXT,
      logo_mime TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  const settingColumns = new Set(db.prepare('PRAGMA table_info(clinic_settings)').all().map((column) => column.name));
  const migrations = [
    ['email', "ALTER TABLE clinic_settings ADD COLUMN email TEXT NOT NULL DEFAULT ''"],
    ['registration_number', "ALTER TABLE clinic_settings ADD COLUMN registration_number TEXT NOT NULL DEFAULT ''"],
    ['footer_text', "ALTER TABLE clinic_settings ADD COLUMN footer_text TEXT NOT NULL DEFAULT 'Confidential clinical report'"],
  ];
  for (const [column, sql] of migrations) if (!settingColumns.has(column)) db.exec(sql);

  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO clinic_settings
    (id, clinician_name, professional_title, center_descriptor, address, telephone, website, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      'Dr. Mahjube Entezar-e-Ghaem',
      'Oral & Maxillofacial Radiologist',
      'Oral & Maxillofacial Radiology Center',
      'No. 23, Alley 26, Shahid Ghandi Blvd., Safaeiyeh, Yazd, Iran',
      '+98 35 3834 6654',
      'www.drentezareghaem.ir',
      now,
    );
  return db;
}

export function bootstrapAdmin(db, username, password) {
  const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (count > 0) return false;
  if (!username || !password || password.length < 12) return false;
  const { salt, hash } = hashPassword(password);
  db.prepare('INSERT INTO users (username, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?)')
    .run(username.trim(), hash, salt, new Date().toISOString());
  return true;
}

export function pruneSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
}
