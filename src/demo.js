import crypto from 'node:crypto';
import { db, setSettings } from './db.js';
import { addDays, todayStr, weekdayOf } from './time.js';

export const DEMO = process.env.DEMO_MODE === 'true';

// Popula a demonstração com dados realistas. Só roda com o banco vazio
// (no Render gratuito o disco é apagado a cada reinício, então a demo "se renova").
export function seedDemo() {
  if (db.prepare('SELECT 1 FROM appointments LIMIT 1').get()) return;

  setSettings({
    business_name: 'Barbearia Demonstração',
    pix_key: 'demo@agendalivre.dev',
    pix_name: 'Agenda Livre Demo',
    pix_city: 'Sao Paulo',
    deposit_percent: 30,
  });

  db.exec('DELETE FROM services; DELETE FROM professionals;');
  const service = db.prepare('INSERT INTO services (name, duration_min, price_cents) VALUES (?, ?, ?)');
  for (const [name, duration, price] of [
    ['Corte de cabelo', 30, 4000],
    ['Barba', 30, 3000],
    ['Corte + barba', 60, 6500],
    ['Sobrancelha', 15, 1500],
  ]) service.run(name, duration, price);

  const professional = db.prepare('INSERT INTO professionals (name) VALUES (?)');
  for (const name of ['Carlos', 'Rafael']) professional.run(name);

  const clients = ['Ana Paula', 'Bruno Lima', 'Diego Santos', 'Fernanda Rocha', 'Gustavo Alves', 'Lucas Mendes'];
  const insert = db.prepare(
    `INSERT INTO appointments
      (token, service_id, professional_id, client_name, client_phone, date, start_min, end_min,
       price_cents, deposit_cents, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const services = db.prepare('SELECT * FROM services').all();
  const professionals = db.prepare('SELECT id FROM professionals').all();

  // Agendamentos nos próximos dias úteis para o painel não começar vazio.
  let day = todayStr();
  let created = 0;
  for (let offset = 0; offset < 7 && created < clients.length; offset++, day = addDays(day, 1)) {
    if (weekdayOf(day) === 0) continue;
    for (const [i, start] of [[0, 14 * 60], [1, 15 * 60]]) {
      if (created >= clients.length) break;
      const s = services[created % services.length];
      const deposit = Math.round(s.price_cents * 0.3);
      insert.run(
        crypto.randomBytes(16).toString('hex'),
        s.id,
        professionals[i].id,
        clients[created],
        `1199${String(1000000 + created * 1234567).slice(0, 7)}`,
        day,
        start,
        start + s.duration_min,
        s.price_cents,
        deposit,
        created % 3 === 0 ? 'pending' : 'confirmed',
        new Date().toISOString()
      );
      created++;
    }
  }
}
