import { db, getSettings } from './db.js';
import { addDays, isValidDate, nowMinutes, todayStr, toMin, weekdayOf } from './time.js';

// Retorna os horários livres de um dia para um serviço.
// Cada slot traz os profissionais livres naquele horário; o primeiro é usado ao agendar.
export function availableSlots({ date, serviceId, professionalId = null }) {
  const settings = getSettings();
  const service = db.prepare('SELECT * FROM services WHERE id = ? AND active = 1').get(serviceId);
  if (!service || !isValidDate(date)) return [];

  const today = todayStr();
  if (date < today || date > addDays(today, Number(settings.max_days_ahead))) return [];

  const professionals = professionalId
    ? db.prepare('SELECT id FROM professionals WHERE id = ? AND active = 1').all(professionalId)
    : db.prepare('SELECT id FROM professionals WHERE active = 1 ORDER BY id').all();
  const intervals = db
    .prepare('SELECT start_time, end_time FROM hours WHERE weekday = ? ORDER BY start_time')
    .all(weekdayOf(date));
  const busy = db
    .prepare("SELECT professional_id, start_min, end_min FROM appointments WHERE date = ? AND status != 'canceled'")
    .all(date);

  const step = Number(settings.slot_step) || 30;
  const earliest = date === today ? nowMinutes() + Number(settings.min_lead_min) : -1;
  const slots = [];

  for (const interval of intervals) {
    const close = toMin(interval.end_time);
    for (let start = toMin(interval.start_time); start + service.duration_min <= close; start += step) {
      if (start < earliest) continue;
      const end = start + service.duration_min;
      const free = professionals.filter(
        (p) => !busy.some((b) => b.professional_id === p.id && b.start_min < end && start < b.end_min)
      );
      if (free.length) slots.push({ start, professionalIds: free.map((p) => p.id) });
    }
  }
  return slots;
}
