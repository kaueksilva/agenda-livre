// Todas as datas são tratadas no fuso do negócio (process.env.TZ).
const pad = (n) => String(n).padStart(2, '0');

export const toMin = (hhmm) => {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm));
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

export const fmtMin = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

export const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const todayStr = () => dateStr(new Date());

export const nowMinutes = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

export const parseDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const isValidDate = (s) =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && dateStr(parseDate(s)) === s;

export const addDays = (s, n) => {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return dateStr(d);
};

export const weekdayOf = (s) => parseDate(s).getDay();

export const fmtDateBR = (s) => s.split('-').reverse().join('/');

export const apptStart = (a) => {
  const d = parseDate(a.date);
  d.setMinutes(a.start_min);
  return d;
};
