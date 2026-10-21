// Gera o "PIX copia e cola" (BR Code estático) conforme o manual do Banco Central.

const field = (id, value) => {
  const v = String(value);
  return id + String(v.length).padStart(2, '0') + v;
};

const normalize = (text, max) =>
  String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .trim()
    .toUpperCase()
    .slice(0, max);

function crc16(payload) {
  let crc = 0xffff;
  for (const byte of Buffer.from(payload, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function pixPayload({ key, name, city, amountCents = 0, txid = '***' }) {
  const payload =
    field('00', '01') +
    field('26', field('00', 'br.gov.bcb.pix') + field('01', key.trim())) +
    field('52', '0000') +
    field('53', '986') +
    (amountCents > 0 ? field('54', (amountCents / 100).toFixed(2)) : '') +
    field('58', 'BR') +
    field('59', normalize(name, 25) || 'RECEBEDOR') +
    field('60', normalize(city, 15) || 'BRASIL') +
    field('62', field('05', normalize(txid, 25).replace(/ /g, '') || '***')) +
    '6304';
  return payload + crc16(payload);
}
