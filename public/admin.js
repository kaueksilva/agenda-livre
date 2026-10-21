const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const toCents = (value) => Math.round(Number(String(value).replace(/\./g, '').replace(',', '.')) * 100);
const centsInput = (cents) => (cents / 100).toFixed(2).replace('.', ',');
const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const STATUS = { pending: 'Aguardando sinal', confirmed: 'Confirmado', done: 'Concluído', canceled: 'Cancelado' };
const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.endsWith('/login')) {
    show('login');
    throw new Error('Sessão expirada.');
  }
  if (!res.ok) throw new Error(data.error || 'Algo deu errado.');
  return data;
}

function toast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 2500);
}

// Executa uma ação mostrando o erro em um toast, sem quebrar a tela.
const attempt = (fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (err) {
    toast(err.message);
  }
};

function show(view) {
  for (const id of ['setup', 'login', 'panel']) $(`#${id}`).hidden = id !== view;
}

function bindAuthForm(id, path) {
  const form = $(`#${id}`);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = $('.error', form);
    error.hidden = true;
    try {
      await api(path, { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      openPanel();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });
}

async function boot() {
  bindAuthForm('setup', '/api/admin/setup');
  bindAuthForm('login', '/api/admin/login');
  $('#logout').addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST' });
    show('login');
  });
  $$('.tab').forEach((tab) => tab.addEventListener('click', () => openTab(tab.dataset.tab)));

  const status = await api('/api/admin/status');
  if (!status.configured) return show('setup');
  if (!status.logged) return show('login');
  openPanel();
}

function openPanel() {
  show('panel');
  openTab('agenda');
}

const TABS = { agenda: renderAgenda, services: renderServices, professionals: renderProfessionals, hours: renderHours, settings: renderSettings };

function openTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  attempt(TABS[name])();
}

// ---------- Agenda ----------

let agendaDate = localDate(new Date());

async function renderAgenda() {
  const list = await api(`/api/admin/appointments?date=${agendaDate}`);
  const active = list.filter((a) => a.status !== 'canceled');
  const revenue = active.reduce((sum, a) => sum + a.price_cents, 0);

  $('#content').innerHTML = `
    <div class="card row">
      <button class="btn small" data-shift="-1">◀</button>
      <label class="narrow" style="flex:1 1 160px">Dia<input type="date" id="agenda-date" value="${agendaDate}"></label>
      <button class="btn small" data-shift="1">▶</button>
      <p class="muted small" style="margin:0 0 0 auto">${active.length} agendamento(s) · ${money(revenue)}</p>
    </div>
    <div class="list">
      ${list.length ? list.map(appointmentCard).join('') : '<p class="card muted">Nenhum agendamento neste dia.</p>'}
    </div>`;

  $('#agenda-date').addEventListener('change', (e) => {
    agendaDate = e.target.value;
    renderAgenda();
  });
  $$('[data-shift]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const [y, m, d] = agendaDate.split('-').map(Number);
      agendaDate = localDate(new Date(y, m - 1, d + Number(btn.dataset.shift)));
      renderAgenda();
    })
  );
  $$('[data-status]').forEach((btn) =>
    btn.addEventListener(
      'click',
      attempt(async () => {
        if (btn.dataset.status === 'canceled' && !confirm('Cancelar este agendamento?')) return;
        await api(`/api/admin/appointments/${btn.dataset.id}`, { method: 'PATCH', body: { status: btn.dataset.status } });
        renderAgenda();
      })
    )
  );
}

function appointmentCard(a) {
  const open = a.status === 'pending' || a.status === 'confirmed';
  const action = (status, label, cls = '') =>
    `<button class="btn small ${cls}" data-id="${a.id}" data-status="${status}">${label}</button>`;
  return `
    <div class="card appt">
      <div class="time">${a.time}<small>até ${a.end_time}</small></div>
      <div>
        <span class="badge ${a.status}">${STATUS[a.status]}</span>
        <h2 style="margin:6px 0 2px">${esc(a.client_name)}</h2>
        <p class="muted small" style="margin:0">
          ${esc(a.service_name)} · ${esc(a.professional_name)} · ${money(a.price_cents)}
          ${a.deposit_cents ? ` · sinal ${money(a.deposit_cents)}` : ''}
        </p>
        <div class="actions">
          ${a.status === 'pending' ? action('confirmed', 'Sinal recebido', 'primary') : ''}
          ${open ? action('done', 'Concluir') : ''}
          ${open ? `<a class="btn small" href="${esc(a.reminder_link)}" target="_blank" rel="noopener">Lembrete WhatsApp</a>` : ''}
          ${open ? action('canceled', 'Cancelar', 'danger') : ''}
          ${!open ? action('confirmed', 'Reabrir') : ''}
        </div>
      </div>
    </div>`;
}

// ---------- Serviços ----------

async function renderServices() {
  const services = await api('/api/admin/services');
  const row = (s = {}) => `
    <form class="card row" data-id="${s.id ?? ''}">
      <label>Nome<input name="name" value="${esc(s.name)}" required maxlength="60"></label>
      <label class="narrow">Duração (min)<input name="duration_min" type="number" min="5" max="600" step="5" value="${s.duration_min ?? 30}" required></label>
      <label class="narrow">Preço (R$)<input name="price" inputmode="decimal" value="${centsInput(s.price_cents ?? 0)}" required></label>
      <label class="narrow"><input type="checkbox" name="active" ${s.active === 0 ? '' : 'checked'}>Ativo</label>
      <button class="btn small ${s.id ? '' : 'primary'}">${s.id ? 'Salvar' : 'Adicionar'}</button>
    </form>`;

  $('#content').innerHTML = `<h2>Novo serviço</h2>${row()}<h2>Serviços</h2>${services.map(row).join('')}`;
  $$('#content form').forEach((form) =>
    form.addEventListener(
      'submit',
      attempt(async (e) => {
        e.preventDefault();
        const body = {
          name: form.name.value,
          duration_min: Number(form.duration_min.value),
          price_cents: toCents(form.price.value),
          active: form.active.checked,
        };
        const id = form.dataset.id;
        await api(`/api/admin/services${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', body });
        toast('Serviço salvo');
        renderServices();
      })
    )
  );
}

// ---------- Profissionais ----------

async function renderProfessionals() {
  const professionals = await api('/api/admin/professionals');
  const row = (p = {}) => `
    <form class="card row" data-id="${p.id ?? ''}">
      <label>Nome<input name="name" value="${esc(p.name)}" required maxlength="60"></label>
      <label class="narrow"><input type="checkbox" name="active" ${p.active === 0 ? '' : 'checked'}>Ativo</label>
      <button class="btn small ${p.id ? '' : 'primary'}">${p.id ? 'Salvar' : 'Adicionar'}</button>
    </form>`;

  $('#content').innerHTML = `<h2>Novo profissional</h2>${row()}<h2>Equipe</h2>${professionals.map(row).join('')}`;
  $$('#content form').forEach((form) =>
    form.addEventListener(
      'submit',
      attempt(async (e) => {
        e.preventDefault();
        const id = form.dataset.id;
        const body = { name: form.name.value, active: form.active.checked };
        await api(`/api/admin/professionals${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', body });
        toast('Profissional salvo');
        renderProfessionals();
      })
    )
  );
}

// ---------- Horários ----------

async function renderHours() {
  const hours = await api('/api/admin/hours');
  const interval = (h = { start_time: '09:00', end_time: '18:00' }) => `
    <div class="interval">
      <input type="time" name="start" value="${h.start_time}" required> até
      <input type="time" name="end" value="${h.end_time}" required>
      <button type="button" class="btn small danger" data-remove>Remover</button>
    </div>`;

  $('#content').innerHTML = `
    <form class="card" id="hours-form">
      <p class="muted small">Use mais de um intervalo no mesmo dia para pausas (ex.: almoço). Dias sem intervalo ficam fechados.</p>
      ${WEEKDAYS.map(
        (name, wd) => `
        <div class="weekday" data-weekday="${wd}">
          <strong>${name}</strong>
          <div class="intervals">${hours.filter((h) => h.weekday === wd).map(interval).join('')}</div>
          <button type="button" class="btn small" data-add>+ Intervalo</button>
        </div>`
      ).join('')}
      <button class="btn primary">Salvar horários</button>
    </form>`;

  const form = $('#hours-form');
  form.addEventListener('click', (e) => {
    if (e.target.matches('[data-remove]')) e.target.closest('.interval').remove();
    if (e.target.matches('[data-add]')) $('.intervals', e.target.closest('.weekday')).insertAdjacentHTML('beforeend', interval());
  });
  form.addEventListener(
    'submit',
    attempt(async (e) => {
      e.preventDefault();
      const body = $$('.weekday', form).flatMap((day) =>
        $$('.interval', day).map((row) => ({
          weekday: Number(day.dataset.weekday),
          start_time: $('[name=start]', row).value,
          end_time: $('[name=end]', row).value,
        }))
      );
      await api('/api/admin/hours', { method: 'PUT', body });
      toast('Horários salvos');
    })
  );
}

// ---------- Configurações ----------

async function renderSettings() {
  const s = await api('/api/admin/settings');
  $('#content').innerHTML = `
    <form class="card" id="settings-form">
      <h2>Negócio</h2>
      <label>Nome do negócio<input name="business_name" value="${esc(s.business_name)}" required maxlength="80"></label>
      <label>WhatsApp do negócio (com DDD)<input name="whatsapp" value="${esc(s.whatsapp)}" inputmode="tel" placeholder="11912345678"></label>

      <h2>PIX e sinal</h2>
      <label>Chave PIX (celular no formato +5511912345678, e-mail, CPF/CNPJ ou chave aleatória)
        <input name="pix_key" value="${esc(s.pix_key)}" maxlength="77">
      </label>
      <div class="row">
        <label>Nome do recebedor<input name="pix_name" value="${esc(s.pix_name)}" maxlength="25"></label>
        <label>Cidade<input name="pix_city" value="${esc(s.pix_city)}" maxlength="15"></label>
        <label class="narrow">Sinal (%)<input name="deposit_percent" type="number" min="0" max="100" value="${s.deposit_percent}"></label>
      </div>
      <p class="muted small">Com sinal acima de 0% e chave PIX preenchida, o cliente recebe um QR Code e o horário fica "Aguardando sinal" até você confirmar.</p>

      <h2>Agenda</h2>
      <div class="row">
        <label>Intervalo entre horários
          <select name="slot_step">${[10, 15, 20, 30, 45, 60]
            .map((v) => `<option value="${v}" ${Number(s.slot_step) === v ? 'selected' : ''}>${v} min</option>`)
            .join('')}</select>
        </label>
        <label>Antecedência mínima (min)<input name="min_lead_min" type="number" min="0" value="${s.min_lead_min}"></label>
        <label>Agendar até (dias à frente)<input name="max_days_ahead" type="number" min="1" max="365" value="${s.max_days_ahead}"></label>
      </div>
      <p class="muted small">Lembretes automáticos por WhatsApp: <strong>${s.evolution_enabled ? 'ativos' : 'desativados'}</strong> (configure a Evolution API nas variáveis de ambiente).</p>
      <button class="btn primary">Salvar configurações</button>
    </form>

    <form class="card" id="password-form">
      <h2>Trocar senha</h2>
      <div class="row">
        <label>Senha atual<input name="current" type="password" required autocomplete="current-password"></label>
        <label>Nova senha<input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
        <button class="btn small">Trocar</button>
      </div>
    </form>`;

  const settingsForm = $('#settings-form');
  settingsForm.addEventListener(
    'submit',
    attempt(async (e) => {
      e.preventDefault();
      await api('/api/admin/settings', { method: 'PUT', body: Object.fromEntries(new FormData(settingsForm)) });
      $('#panel-title').textContent = settingsForm.business_name.value;
      toast('Configurações salvas');
    })
  );

  const passwordForm = $('#password-form');
  passwordForm.addEventListener(
    'submit',
    attempt(async (e) => {
      e.preventDefault();
      await api('/api/admin/password', { method: 'PUT', body: Object.fromEntries(new FormData(passwordForm)) });
      passwordForm.reset();
      toast('Senha alterada');
    })
  );
}

boot().catch((err) => toast(err.message));
