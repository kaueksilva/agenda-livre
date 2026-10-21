process.env.TZ ||= 'America/Sao_Paulo';

import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import QRCode from 'qrcode';
import { db, getSettings, isConfigured, seedDefaults, setSettings } from './db.js';
import {
  clearLoginFailures,
  endSession,
  hashPassword,
  isLogged,
  loginBlocked,
  registerLoginFailure,
  requireAdmin,
  startSession,
  verifyPassword,
} from './auth.js';
import { availableSlots } from './slots.js';
import { pixPayload } from './pix.js';
import { apptStart, addDays, fmtMin, isValidDate, todayStr, toMin } from './time.js';
import {
  clientToBusinessMessage,
  evolutionEnabled,
  newBookingMessage,
  reminderMessage,
  sendWhatsApp,
  startReminderLoop,
  waLink,
} from './whatsapp.js';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const STATUSES = ['pending', 'confirmed', 'done', 'canceled'];

// Permite definir a senha do painel por variável de ambiente (útil em deploy de um clique).
if (!isConfigured() && process.env.ADMIN_PASSWORD) {
  setSettings({ admin_hash: hashPassword(process.env.ADMIN_PASSWORD) });
  seedDefaults();
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '50kb' }));
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

const bad = (res, error, status = 400) => res.status(status).json({ error });

const APPT_SELECT = `
  SELECT a.*, s.name AS service_name, p.name AS professional_name
  FROM appointments a
  JOIN services s ON s.id = a.service_id
  JOIN professionals p ON p.id = a.professional_id`;

const selectAppointments = (where, ...params) => db.prepare(`${APPT_SELECT} WHERE ${where}`).all(...params);

const publicAppointment = (a) => ({
  service_name: a.service_name,
  professional_name: a.professional_name,
  client_name: a.client_name,
  date: a.date,
  time: fmtMin(a.start_min),
  end_time: fmtMin(a.end_min),
  price_cents: a.price_cents,
  deposit_cents: a.deposit_cents,
  status: a.status,
});

const isCancelable = (a) => ['pending', 'confirmed'].includes(a.status) && apptStart(a) > new Date();

app.get('/healthz', (req, res) => res.json({ ok: true }));

// ---------- Área pública (cliente) ----------

app.get('/api/public/info', (req, res) => {
  const s = getSettings();
  const today = todayStr();
  res.json({
    configured: isConfigured(),
    business_name: s.business_name,
    deposit_percent: s.pix_key ? Number(s.deposit_percent) : 0,
    today,
    max_date: addDays(today, Number(s.max_days_ahead)),
    services: db.prepare('SELECT id, name, duration_min, price_cents FROM services WHERE active = 1 ORDER BY name').all(),
    professionals: db.prepare('SELECT id, name FROM professionals WHERE active = 1 ORDER BY name').all(),
  });
});

app.get('/api/public/slots', (req, res) => {
  const slots = availableSlots({
    date: String(req.query.date || ''),
    serviceId: Number(req.query.service_id),
    professionalId: Number(req.query.professional_id) || null,
  });
  res.json(slots.map((s) => fmtMin(s.start)));
});

app.post('/api/public/book', (req, res) => {
  const { service_id, professional_id, date, time, name, phone } = req.body ?? {};
  const clientName = String(name || '').trim().slice(0, 80);
  const clientPhone = String(phone || '').replace(/\D/g, '');

  if (!clientName) return bad(res, 'Informe seu nome.');
  if (clientPhone.length < 10 || clientPhone.length > 13) return bad(res, 'Informe um WhatsApp válido com DDD.');
  if (!isValidDate(date) || Number.isNaN(toMin(time))) return bad(res, 'Data ou horário inválido.');

  const service = db.prepare('SELECT * FROM services WHERE id = ? AND active = 1').get(Number(service_id));
  if (!service) return bad(res, 'Serviço inválido.');

  const start = toMin(time);
  const slot = availableSlots({ date, serviceId: service.id, professionalId: Number(professional_id) || null }).find(
    (s) => s.start === start
  );
  if (!slot) return bad(res, 'Esse horário não está mais disponível. Escolha outro.', 409);

  const settings = getSettings();
  const deposit = settings.pix_key ? Math.round((service.price_cents * Number(settings.deposit_percent)) / 100) : 0;
  const token = crypto.randomBytes(16).toString('hex');

  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO appointments
        (token, service_id, professional_id, client_name, client_phone, date, start_min, end_min,
         price_cents, deposit_cents, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      token,
      service.id,
      slot.professionalIds[0],
      clientName,
      clientPhone,
      date,
      start,
      start + service.duration_min,
      service.price_cents,
      deposit,
      deposit > 0 ? 'pending' : 'confirmed',
      new Date().toISOString()
    );

  const [appointment] = selectAppointments('a.id = ?', lastInsertRowid);
  sendWhatsApp(settings.whatsapp, newBookingMessage(appointment));
  res.status(201).json({ token });
});

app.get('/api/public/appointment/:token', async (req, res) => {
  const [a] = selectAppointments('a.token = ?', req.params.token);
  if (!a) return bad(res, 'Agendamento não encontrado.', 404);

  const s = getSettings();
  let pix = null;
  if (a.status === 'pending' && a.deposit_cents > 0 && s.pix_key) {
    const code = pixPayload({
      key: s.pix_key,
      name: s.pix_name || s.business_name,
      city: s.pix_city,
      amountCents: a.deposit_cents,
      txid: `AG${a.id}`,
    });
    pix = { code, qr: await QRCode.toDataURL(code, { margin: 1, width: 260 }) };
  }

  res.json({
    ...publicAppointment(a),
    pix,
    whatsapp_link: s.whatsapp ? waLink(s.whatsapp, clientToBusinessMessage(a)) : null,
    cancelable: isCancelable(a),
  });
});

app.post('/api/public/appointment/:token/cancel', (req, res) => {
  const [a] = selectAppointments('a.token = ?', req.params.token);
  if (!a) return bad(res, 'Agendamento não encontrado.', 404);
  if (!isCancelable(a)) return bad(res, 'Este agendamento não pode mais ser cancelado.');
  db.prepare("UPDATE appointments SET status = 'canceled' WHERE id = ?").run(a.id);
  res.json({ ok: true });
});

// ---------- Painel (dono do negócio) ----------

app.get('/api/admin/status', (req, res) => res.json({ configured: isConfigured(), logged: isLogged(req) }));

app.post('/api/admin/setup', (req, res) => {
  if (isConfigured()) return bad(res, 'O sistema já foi configurado.', 403);
  const { business_name, professional_name, password } = req.body ?? {};
  if (String(password || '').length < 8) return bad(res, 'A senha precisa ter pelo menos 8 caracteres.');

  setSettings({
    business_name: String(business_name || '').trim().slice(0, 80) || 'Meu Negócio',
    admin_hash: hashPassword(String(password)),
  });
  seedDefaults(String(professional_name || '').trim().slice(0, 60));
  startSession(req, res);
  res.json({ ok: true });
});

app.post('/api/admin/login', (req, res) => {
  if (loginBlocked(req.ip)) return bad(res, 'Muitas tentativas. Aguarde 15 minutos.', 429);
  if (!verifyPassword(String(req.body?.password || ''), getSettings().admin_hash)) {
    registerLoginFailure(req.ip);
    return bad(res, 'Senha incorreta.', 401);
  }
  clearLoginFailures(req.ip);
  startSession(req, res);
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  endSession(req, res);
  res.json({ ok: true });
});

const admin = express.Router();
app.use('/api/admin', requireAdmin, admin);

admin.get('/appointments', (req, res) => {
  const date = isValidDate(req.query.date) ? req.query.date : todayStr();
  const s = getSettings();
  const rows = selectAppointments('a.date = ? ORDER BY a.start_min', date);
  res.json(
    rows.map((a) => ({
      id: a.id,
      ...publicAppointment(a),
      client_phone: a.client_phone,
      reminder_link: waLink(a.client_phone, reminderMessage(a, s)),
    }))
  );
});

admin.patch('/appointments/:id', (req, res) => {
  const { status } = req.body ?? {};
  if (!STATUSES.includes(status)) return bad(res, 'Status inválido.');
  db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(status, Number(req.params.id));
  res.json({ ok: true });
});

function parseService(body = {}) {
  const name = String(body.name || '').trim().slice(0, 60);
  const duration = Number(body.duration_min);
  const price = Number(body.price_cents);
  if (!name) return { error: 'Informe o nome do serviço.' };
  if (!Number.isInteger(duration) || duration < 5 || duration > 600) return { error: 'Duração deve ser entre 5 e 600 minutos.' };
  if (!Number.isInteger(price) || price < 0) return { error: 'Preço inválido.' };
  return { values: [name, duration, price, body.active === false ? 0 : 1] };
}

admin.get('/services', (req, res) => {
  res.json(db.prepare('SELECT * FROM services ORDER BY active DESC, name').all());
});

admin.post('/services', (req, res) => {
  const { error, values } = parseService(req.body);
  if (error) return bad(res, error);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO services (name, duration_min, price_cents, active) VALUES (?, ?, ?, ?)')
    .run(...values);
  res.status(201).json({ id: Number(lastInsertRowid) });
});

admin.put('/services/:id', (req, res) => {
  const { error, values } = parseService(req.body);
  if (error) return bad(res, error);
  db.prepare('UPDATE services SET name = ?, duration_min = ?, price_cents = ?, active = ? WHERE id = ?').run(
    ...values,
    Number(req.params.id)
  );
  res.json({ ok: true });
});

function parseProfessional(body = {}) {
  const name = String(body.name || '').trim().slice(0, 60);
  if (!name) return { error: 'Informe o nome do profissional.' };
  return { values: [name, body.active === false ? 0 : 1] };
}

admin.get('/professionals', (req, res) => {
  res.json(db.prepare('SELECT * FROM professionals ORDER BY active DESC, name').all());
});

admin.post('/professionals', (req, res) => {
  const { error, values } = parseProfessional(req.body);
  if (error) return bad(res, error);
  const { lastInsertRowid } = db.prepare('INSERT INTO professionals (name, active) VALUES (?, ?)').run(...values);
  res.status(201).json({ id: Number(lastInsertRowid) });
});

admin.put('/professionals/:id', (req, res) => {
  const { error, values } = parseProfessional(req.body);
  if (error) return bad(res, error);
  db.prepare('UPDATE professionals SET name = ?, active = ? WHERE id = ?').run(...values, Number(req.params.id));
  res.json({ ok: true });
});

admin.get('/hours', (req, res) => {
  res.json(db.prepare('SELECT weekday, start_time, end_time FROM hours ORDER BY weekday, start_time').all());
});

admin.put('/hours', (req, res) => {
  const list = Array.isArray(req.body) ? req.body : [];
  for (const h of list) {
    const ok =
      Number.isInteger(h.weekday) && h.weekday >= 0 && h.weekday <= 6 && toMin(h.start_time) < toMin(h.end_time);
    if (!ok) return bad(res, 'Confira os horários: o início precisa ser antes do fim.');
  }
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM hours');
    const insert = db.prepare('INSERT INTO hours (weekday, start_time, end_time) VALUES (?, ?, ?)');
    for (const h of list) insert.run(h.weekday, h.start_time, h.end_time);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json({ ok: true });
});

const EDITABLE_SETTINGS = {
  business_name: (v) => String(v).trim().slice(0, 80) || null,
  whatsapp: (v) => String(v).replace(/\D/g, '').slice(0, 13),
  pix_key: (v) => String(v).trim().slice(0, 77),
  pix_name: (v) => String(v).trim().slice(0, 25),
  pix_city: (v) => String(v).trim().slice(0, 15),
  deposit_percent: (v) => (Number.isInteger(Number(v)) && v >= 0 && v <= 100 ? Number(v) : null),
  slot_step: (v) => ([10, 15, 20, 30, 45, 60].includes(Number(v)) ? Number(v) : null),
  min_lead_min: (v) => (Number.isInteger(Number(v)) && v >= 0 && v <= 10080 ? Number(v) : null),
  max_days_ahead: (v) => (Number.isInteger(Number(v)) && v >= 1 && v <= 365 ? Number(v) : null),
};

admin.get('/settings', (req, res) => {
  const s = getSettings();
  const values = Object.fromEntries(Object.keys(EDITABLE_SETTINGS).map((k) => [k, s[k]]));
  res.json({ ...values, evolution_enabled: evolutionEnabled });
});

admin.put('/settings', (req, res) => {
  const updates = {};
  for (const [key, parse] of Object.entries(EDITABLE_SETTINGS)) {
    if (!(key in (req.body ?? {}))) continue;
    const value = parse(req.body[key]);
    if (value === null) return bad(res, `Valor inválido para "${key}".`);
    updates[key] = value;
  }
  setSettings(updates);
  res.json({ ok: true });
});

admin.put('/password', (req, res) => {
  const { current, password } = req.body ?? {};
  if (!verifyPassword(String(current || ''), getSettings().admin_hash)) return bad(res, 'Senha atual incorreta.');
  if (String(password || '').length < 8) return bad(res, 'A nova senha precisa ter pelo menos 8 caracteres.');
  setSettings({ admin_hash: hashPassword(String(password)) });
  res.json({ ok: true });
});

app.use('/api', (req, res) => bad(res, 'Rota não encontrada.', 404));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return bad(res, 'JSON inválido.');
  console.error(err);
  bad(res, 'Erro interno.', 500);
});

app.listen(PORT, () => {
  console.log(`Agenda Livre rodando em http://localhost:${PORT} (painel em /admin)`);
  startReminderLoop(selectAppointments);
});
