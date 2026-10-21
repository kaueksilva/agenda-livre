import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'agenda.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS services (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    duration_min INTEGER NOT NULL,
    price_cents  INTEGER NOT NULL DEFAULT 0,
    active       INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS professionals (
    id     INTEGER PRIMARY KEY,
    name   TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS hours (
    id         INTEGER PRIMARY KEY,
    weekday    INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id              INTEGER PRIMARY KEY,
    token           TEXT NOT NULL UNIQUE,
    service_id      INTEGER NOT NULL REFERENCES services(id),
    professional_id INTEGER NOT NULL REFERENCES professionals(id),
    client_name     TEXT NOT NULL,
    client_phone    TEXT NOT NULL,
    date            TEXT NOT NULL,
    start_min       INTEGER NOT NULL,
    end_min         INTEGER NOT NULL,
    price_cents     INTEGER NOT NULL,
    deposit_cents   INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL,
    reminder_sent   INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date);

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );
`);

const DEFAULTS = {
  business_name: 'Meu Negócio',
  whatsapp: '',
  pix_key: '',
  pix_name: '',
  pix_city: '',
  deposit_percent: '0',
  slot_step: '30',
  min_lead_min: '60',
  max_days_ahead: '30',
};

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return { ...DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}

export function setSettings(values) {
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  for (const [key, value] of Object.entries(values)) upsert.run(key, String(value ?? ''));
}

export const isConfigured = () => Boolean(getSettings().admin_hash);

// Dados iniciais para o sistema já sair funcionando após o setup.
export function seedDefaults(professionalName) {
  if (!db.prepare('SELECT 1 FROM professionals LIMIT 1').get()) {
    db.prepare('INSERT INTO professionals (name) VALUES (?)').run(professionalName || 'Profissional');
  }
  if (!db.prepare('SELECT 1 FROM services LIMIT 1').get()) {
    db.prepare('INSERT INTO services (name, duration_min, price_cents) VALUES (?, ?, ?)').run('Corte de cabelo', 30, 4000);
  }
  if (!db.prepare('SELECT 1 FROM hours LIMIT 1').get()) {
    const insert = db.prepare('INSERT INTO hours (weekday, start_time, end_time) VALUES (?, ?, ?)');
    for (let wd = 1; wd <= 5; wd++) {
      insert.run(wd, '09:00', '12:00');
      insert.run(wd, '13:00', '18:00');
    }
    insert.run(6, '09:00', '13:00');
  }
}
