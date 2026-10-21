import { db, getSettings } from './db.js';
import { addDays, apptStart, fmtDateBR, fmtMin, todayStr } from './time.js';

const digits = (phone) => String(phone || '').replace(/\D/g, '');
// Números sem DDI (até 11 dígitos) são tratados como brasileiros.
const withCountry = (phone) => (digits(phone).length <= 11 ? `55${digits(phone)}` : digits(phone));

export const waLink = (phone, text) => `https://wa.me/${withCountry(phone)}?text=${encodeURIComponent(text)}`;

const when = (a) => `${fmtDateBR(a.date)} às ${fmtMin(a.start_min)}`;
const firstName = (name) => String(name).trim().split(/\s+/)[0];

export const reminderMessage = (a, s) =>
  `Olá, ${firstName(a.client_name)}! Lembrete do seu horário em ${s.business_name}: ` +
  `${a.service_name} com ${a.professional_name} em ${when(a)}. Até lá!`;

export const clientToBusinessMessage = (a) =>
  `Olá! Agendei ${a.service_name} com ${a.professional_name} para ${when(a)} em nome de ${a.client_name}.` +
  (a.status === 'pending' ? ' Segue o comprovante do sinal.' : '');

export const newBookingMessage = (a) =>
  `Novo agendamento: ${a.client_name} (${a.client_phone}) — ${a.service_name} com ${a.professional_name} em ${when(a)}.`;

// Envio automático é opcional e usa a Evolution API (https://github.com/EvolutionAPI/evolution-api).
const { EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE } = process.env;
export const evolutionEnabled = Boolean(EVOLUTION_API_URL && EVOLUTION_API_KEY && EVOLUTION_INSTANCE);

export async function sendWhatsApp(phone, text) {
  if (!evolutionEnabled || !phone) return false;
  try {
    const res = await fetch(`${EVOLUTION_API_URL.replace(/\/$/, '')}/message/sendText/${EVOLUTION_INSTANCE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
      body: JSON.stringify({ number: withCountry(phone), text }),
    });
    if (!res.ok) console.error(`[whatsapp] envio falhou: HTTP ${res.status}`);
    return res.ok;
  } catch (err) {
    console.error('[whatsapp] envio falhou:', err.message);
    return false;
  }
}

export function startReminderLoop(selectAppointments) {
  if (!evolutionEnabled) return;
  const hoursBefore = Number(process.env.REMINDER_HOURS_BEFORE) || 24;

  const run = async () => {
    const today = todayStr();
    const due = selectAppointments(
      "a.date BETWEEN ? AND ? AND a.status IN ('pending', 'confirmed') AND a.reminder_sent = 0",
      today,
      addDays(today, Math.ceil(hoursBefore / 24) + 1)
    ).filter((a) => {
      const diff = apptStart(a) - Date.now();
      return diff > 0 && diff <= hoursBefore * 3600 * 1000;
    });

    const settings = getSettings();
    for (const a of due) {
      if (await sendWhatsApp(a.client_phone, reminderMessage(a, settings))) {
        db.prepare('UPDATE appointments SET reminder_sent = 1 WHERE id = ?').run(a.id);
      }
    }
  };

  setInterval(run, 5 * 60 * 1000);
  run();
  console.log(`[whatsapp] lembretes automáticos ativos (${hoursBefore}h antes)`);
}
