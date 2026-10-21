const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dateBR = (d) => d.split('-').reverse().join('/');

const STATUS = {
  pending: 'Aguardando sinal',
  confirmed: 'Confirmado',
  done: 'Concluído',
  canceled: 'Cancelado',
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Algo deu errado. Tente novamente.');
  return data;
}

const state = { info: null, service: null, time: null };

async function init() {
  state.info = await api('/api/public/info');
  document.title = state.info.business_name;
  $('#business').textContent = state.info.business_name;
  if (state.info.demo) {
    const banner = $('#demo-banner');
    banner.innerHTML =
      '<strong>Demonstração do Agenda Livre.</strong> Faça um agendamento de teste e veja o resultado no ' +
      `<a href="/admin">painel</a>${state.info.demo_password ? ` (senha: <code>${esc(state.info.demo_password)}</code>)` : ''}. ` +
      'Não pague o PIX: os dados são fictícios e apagados periodicamente.';
    banner.hidden = false;
  }

  const token = new URLSearchParams(location.search).get('t');
  if (token) return showConfirmation(token);
  if (!state.info.configured) return ($('#not-configured').hidden = false);

  $('#booking').hidden = false;
  renderServices();
  renderProfessionals();

  const dateInput = $('#date');
  dateInput.min = state.info.today;
  dateInput.max = state.info.max_date;
  dateInput.value = state.info.today;
  dateInput.addEventListener('change', loadSlots);
  $('#professional').addEventListener('change', loadSlots);
  $('#step-client').addEventListener('submit', book);
}

function renderServices() {
  const box = $('#services');
  if (!state.info.services.length) {
    box.innerHTML = '<p class="muted">Nenhum serviço disponível no momento.</p>';
    return;
  }
  box.innerHTML = state.info.services
    .map(
      (s) => `<button type="button" class="option" data-id="${s.id}">
        <span><strong>${esc(s.name)}</strong><br><span class="muted small">${s.duration_min} min</span></span>
        <strong>${s.price_cents ? money(s.price_cents) : ''}</strong>
      </button>`
    )
    .join('');
  box.querySelectorAll('.option').forEach((btn) =>
    btn.addEventListener('click', () => {
      box.querySelectorAll('.option').forEach((b) => b.classList.toggle('selected', b === btn));
      state.service = state.info.services.find((s) => s.id === Number(btn.dataset.id));
      $('#step-professional').hidden = state.info.professionals.length < 2;
      $('#step-date').hidden = false;
      loadSlots();
    })
  );
}

function renderProfessionals() {
  const options = state.info.professionals.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`);
  $('#professional').innerHTML = '<option value="">Qualquer profissional</option>' + options.join('');
}

async function loadSlots() {
  state.time = null;
  $('#step-client').hidden = true;
  const box = $('#slots');
  box.innerHTML = '<p class="muted">Carregando horários…</p>';

  const params = new URLSearchParams({
    date: $('#date').value,
    service_id: state.service.id,
    professional_id: $('#professional').value,
  });
  const slots = await api(`/api/public/slots?${params}`);
  if (!slots.length) {
    box.innerHTML = '<p class="muted">Sem horários livres nesse dia. Tente outra data.</p>';
    return;
  }
  box.innerHTML = slots.map((t) => `<button type="button" class="slot">${t}</button>`).join('');
  box.querySelectorAll('.slot').forEach((btn) =>
    btn.addEventListener('click', () => {
      box.querySelectorAll('.slot').forEach((b) => b.classList.toggle('selected', b === btn));
      state.time = btn.textContent;
      showClientForm();
    })
  );
}

function showClientForm() {
  const s = state.service;
  const deposit = Math.round((s.price_cents * state.info.deposit_percent) / 100);
  $('#summary').innerHTML =
    `<strong>${esc(s.name)}</strong> em ${dateBR($('#date').value)} às ${state.time}` +
    (s.price_cents ? ` — ${money(s.price_cents)}` : '') +
    (deposit > 0 ? `<br><span class="small">Sinal de ${money(deposit)} via PIX para garantir o horário.</span>` : '');
  const form = $('#step-client');
  form.hidden = false;
  form.scrollIntoView({ behavior: 'smooth' });
}

async function book(event) {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('button');
  const error = $('#error');
  error.hidden = true;
  button.disabled = true;
  try {
    const { token } = await api('/api/public/book', {
      method: 'POST',
      body: {
        service_id: state.service.id,
        professional_id: $('#professional').value || null,
        date: $('#date').value,
        time: state.time,
        name: form.name.value,
        phone: form.phone.value,
      },
    });
    location.search = `?t=${token}`;
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
    button.disabled = false;
    loadSlots();
  }
}

async function showConfirmation(token) {
  const box = $('#confirmation');
  box.hidden = false;
  let a;
  try {
    a = await api(`/api/public/appointment/${encodeURIComponent(token)}`);
  } catch (err) {
    box.innerHTML = `<div class="card"><p class="error">${esc(err.message)}</p><a class="btn" href="/">Fazer um agendamento</a></div>`;
    return;
  }

  const pix = a.pix
    ? `<div class="card pix">
        <h2>Pague o sinal de ${money(a.deposit_cents)} via PIX</h2>
        <img src="${a.pix.qr}" alt="QR Code PIX">
        <textarea id="pix-code" readonly>${esc(a.pix.code)}</textarea>
        <button type="button" class="btn block" id="copy-pix">Copiar código PIX</button>
        <p class="muted small">Depois de pagar, envie o comprovante pelo WhatsApp para confirmarmos seu horário.</p>
      </div>`
    : '';

  box.innerHTML = `
    <div class="card">
      <p><span class="badge ${a.status}">${STATUS[a.status]}</span></p>
      <h2>${esc(a.service_name)} com ${esc(a.professional_name)}</h2>
      <p>${dateBR(a.date)}, das ${a.time} às ${a.end_time}${a.price_cents ? ` — ${money(a.price_cents)}` : ''}</p>
      <p class="muted small">Guarde este link para consultar ou cancelar seu horário.</p>
    </div>
    ${pix}
    <div class="actions">
      ${a.whatsapp_link ? `<a class="btn primary" href="${esc(a.whatsapp_link)}" target="_blank" rel="noopener">Falar no WhatsApp</a>` : ''}
      ${a.cancelable ? '<button type="button" class="btn danger" id="cancel">Cancelar agendamento</button>' : ''}
      <a class="btn" href="/">Novo agendamento</a>
    </div>`;

  $('#copy-pix')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(a.pix.code);
    $('#copy-pix').textContent = 'Código copiado!';
  });
  $('#cancel')?.addEventListener('click', async () => {
    if (!confirm('Cancelar este agendamento?')) return;
    await api(`/api/public/appointment/${encodeURIComponent(token)}/cancel`, { method: 'POST' });
    showConfirmation(token);
  });
}

init().catch((err) => {
  document.querySelector('main').insertAdjacentHTML('beforeend', `<p class="card error">${esc(err.message)}</p>`);
});
