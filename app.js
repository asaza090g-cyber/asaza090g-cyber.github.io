// Интерфейс сайта. Данные хранятся на сервере Supabase (см. api.js).
const CENTER = {
  name: 'GML Detailing',
  address: 'г. Екатеринбург, центр, ул. Вайнера, 10',
  phone: '+7 (343) 000-00-00',
  map: 'https://yandex.ru/maps/?text=' + encodeURIComponent('Екатеринбург, ул. Вайнера, 10'),
  payUrl: 'https://example.com/pay', // временная ссылка на оплату, заменить на настоящую
};
const payUrl = (b) => `${CENTER.payUrl}?order=${b.id}&amount=${b.total}`;
// график работы по умолчанию (пока не загрузился из базы): 0 = воскресенье … 6 = суббота; null — выходной
const DEFAULT_SCHEDULE = [null, { open: 10, close: 21 }, { open: 10, close: 21 }, { open: 10, close: 21 }, { open: 10, close: 21 }, { open: 10, close: 21 }, { open: 10, close: 18 }];

// услуги по умолчанию, пока не загрузились из базы
const DEFAULT_SERVICES = [
  { id: 1, name: 'Полировка кузова', price: 13000, img: 'polish-body.jpg', desc: 'Оценка состояния ЛКП, обезжиривание, глубокая очистка глиной и автоскрабом, восстановительная полировка, усиление блеска и защита неабразивной пастой.' },
  { id: 2, name: 'Химчистка салона', price: 1000, img: 'interior.jpg', desc: 'Глубокая сухая и влажная чистка салона и багажника с разбором. Труднодоступные места, решётки динамиков, ремни, воздуховоды, климат-контроль, руль.' },
  { id: 3, name: 'Химчистка подкапотного пространства', price: 3000, img: 'engine.jpg', desc: 'Мойка моторного отсека диэлектрическим шампунем с последующей консервацией.' },
  { id: 4, name: 'Защитные покрытия на кузов', price: 5000, img: 'coating.jpg', desc: 'Керамика, воски, силанты. Усиливают блеск и цвет ЛКП, защищают от дорожных реагентов.' },
  { id: 5, name: 'Удаление вмятин PDR', price: 1000, img: 'pdr.jpg', desc: 'Удаление вмятин без окраса клеевой системой и крючками.' },
  { id: 6, name: 'Предпродажная подготовка', price: 8000, img: 'presale.jpg', desc: 'Комплексная подготовка автомобиля к продаже.' },
  { id: 7, name: 'Полировка стекла', price: 5000, img: 'glass.jpg', desc: 'Удаление царапин и следов от дворников со стекла.' },
  { id: 8, name: 'Ремонт сколов и трещин на лобовом стекле', price: null, img: 'windshield-repair.jpg', desc: 'Ремонт сколов и трещин. Стоимость уточняйте по телефону.' },
];

const state = {
  tab: 'home',
  query: '',
  day: null, // при запуске: сегодня или завтра, если сегодня уже закрыто
  user: null, // { id, name, phone, isOwner }
  owner: false,
  cart: [],
  pendingDraft: null,
  counts: {}, // занятость: 'дата|час' → { booked, held, mine }
  blocks: [], // брони владельца (видны только ему)
  bookings: [], // свои записи; у владельца все
  reviews: [],
  services: DEFAULT_SERVICES,
  move: null, // перенос записи: { id, date, hour }
  promo: { on: false, percent: 0, text: '' },
  sched: { schedule: DEFAULT_SCHEDULE, capacity: 3, closed: [], cancelHours: 3 }, // график, боксы, нерабочие даты, правило отмены
  cars: [], // «мой гараж»
  ownerView: 'records', // записи / клиенты / статистика
  statsPeriod: 30,
  ownerFilter: 'today',
  ownerQuery: '',
  draft: null,
  busy: false,
  loaded: false, // данные с сервера пришли
};

// маска телефона: +7 (900) 000-00-00, не больше 10 цифр после +7
function phoneDigits(v) {
  v = String(v).trim();
  let d = v.replace(/\D/g, '');
  if (v.startsWith('+7')) d = d.slice(1);
  else if (d.length === 1 && (d === '7' || d === '8')) return '';
  else if (d.length > 10 && (d[0] === '7' || d[0] === '8')) d = d.slice(1);
  return d.slice(0, 10);
}
function formatPhone(v) {
  const d = phoneDigits(v);
  if (!d) return '';
  let s = '+7 (' + d.slice(0, 3);
  if (d.length >= 3) s += ')';
  if (d.length > 3) s += ' ' + d.slice(3, 6);
  if (d.length > 6) s += '-' + d.slice(6, 8);
  if (d.length > 8) s += '-' + d.slice(8, 10);
  return s;
}

// ---------- утилиты ----------
const $ = (s) => document.querySelector(s);
const money = (n) => n.toLocaleString('ru-RU') + ' ₽';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function pad(n) { return String(n).padStart(2, '0'); }
function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function parseDay(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const fmtDay = (k) => { const d = parseDay(k); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ', ' + WD[d.getDay()]; };
// если последний час сегодня уже начался, лента дат начинается с завтра
const cap = () => state.sched.capacity;
// часы работы в этот день или null, если выходной
function dayHours(k) {
  if (state.sched.closed.includes(k)) return null;
  return state.sched.schedule[parseDay(k).getDay()] || null;
}
const firstOpenDay = () => nextDays(14).find((k) => dayHours(k)) || nextDays(1)[0];
// если сегодня выходной или уже начался последний час — лента начинается с завтра
const nextDays = (n) => {
  const th = dayHours(dayKey(new Date()));
  const shift = !th || new Date().getHours() >= th.close - 1 ? 1 : 0;
  return Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i + shift); return dayKey(d); });
};
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
// «Сегодня», «Завтра» или «Сб, 10 октября»
function dayName(k) {
  const d = parseDay(k), t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((d - t) / 86400000);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Завтра';
  const wd = WD[d.getDay()];
  return wd[0].toUpperCase() + wd.slice(1) + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
}

// ошибка прямо под полем ввода; поле подсвечивается и получает фокус
function fieldError(id, msg) {
  clearErrors();
  const input = document.getElementById(id);
  if (!input) return toast(msg);
  input.classList.add('invalid');
  input.setAttribute('aria-invalid', 'true');
  input.insertAdjacentHTML('afterend', `<p class="field-err" role="alert">${esc(msg)}</p>`);
  input.focus();
}
// общая ошибка формы (например, неверный пароль) — над кнопками окна
function formError(msg) {
  clearErrors();
  const a = document.querySelector('.panel .actions');
  if (!a) return toast(msg);
  a.insertAdjacentHTML('beforebegin', `<p class="form-err" role="alert">${esc(msg)}</p>`);
}
function clearErrors() {
  document.querySelectorAll('.field-err, .form-err').forEach((e) => e.remove());
  document.querySelectorAll('.invalid').forEach((e) => { e.classList.remove('invalid'); e.removeAttribute('aria-invalid'); });
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600);
}

// ---------- загрузка с сервера ----------
async function refreshCounts() {
  const days = nextDays(14);
  state.counts = await api.counts(days[0], days[days.length - 1]);
}
async function loadPrivate() {
  state.cars = state.user && !state.owner ? await api.cars().catch(() => []) : [];
  state.bookings = state.user ? await api.bookings() : [];
  state.blocks = state.owner ? await api.blocks() : [];
}
// если сервер не ответил за отведённое время — честно говорим об этом, а не крутим загрузку бесконечно
const withTimeout = (p, ms = 12000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
async function reloadAll() {
  state.loadError = false;
  try {
    await withTimeout((async () => {
      const [s, reviews] = await Promise.all([api.settings(), api.reviews()]);
      state.promo = s.promo; state.reviews = reviews;
      if (s.schedule) state.sched = { schedule: s.schedule, capacity: s.capacity || 3, closed: s.closed || [], cancelHours: s.cancelHours ?? 3 };
      // если обновление базы №1 ещё не запущено, остаются услуги по умолчанию
      state.services = await api.services().catch(() => state.services);
      await Promise.all([refreshCounts(), loadPrivate()]);
    })());
  } catch (e) { state.loadError = true; toast(errText(e)); }
  state.loaded = true;
}
function setUser(u) { state.user = u; state.owner = !!u?.isOwner; }

// ---------- занятость ----------
function slotInfo(key, h) {
  const c = state.counts[key + '|' + h] || { booked: 0, held: 0, mine: 0 };
  const mine = Math.min(cap(), c.mine);
  const hold = Math.min(cap() - mine, c.held);
  const base = Math.max(0, Math.min(cap() - mine - hold, c.booked - c.mine));
  const busy = base + hold + mine;
  const now = new Date();
  const past = key === dayKey(now) && h <= now.getHours();
  return { base, hold, mine, busy, free: cap() - busy, past };
}

// ---------- расчёт цены ----------
function totals(ids) {
  const list = ids.map((id) => state.services.find((s) => s.id === id)).filter(Boolean);
  const sum = list.reduce((a, s) => a + (s.price || 0), 0);
  const unknown = list.some((s) => s.price === null);
  const discount = state.promo.on ? Math.round((sum * state.promo.percent) / 100) : 0;
  return { list, sum, discount, total: sum - discount, unknown };
}
// услуги записи: снимок на момент записи, у старых записей — из текущего списка
function itemsOf(b) {
  const list = b.items || b.services.map((id) => state.services.find((s) => s.id === id) || { name: 'Услуга', price: null });
  return { list, unknown: list.some((s) => s.price === null) };
}
const priceLabel = (s) => (s.price === null ? 'по телефону' : 'от ' + money(s.price));

// ---------- экраны ----------
const ICONS = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>',
  ticket: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  car: '<svg viewBox="0 0 24 24"><path d="M4 16.5V12l2.2-5.2A2 2 0 0 1 8 5.5h8a2 2 0 0 1 1.8 1.3L20 12v4.5"/><path d="M4 12h16M3 16.5h18"/><circle cx="7.5" cy="16.5" r="1.8"/><circle cx="16.5" cy="16.5" r="1.8"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><path d="M6.6 3h3l1.5 4.5-2.2 1.4a12 12 0 0 0 6.2 6.2l1.4-2.2 4.5 1.5v3a2 2 0 0 1-2.2 2A16.8 16.8 0 0 1 4.6 5.2 2 2 0 0 1 6.6 3z"/></svg>',
};
// маленькая иконка в строке текста (для чтения с экрана скрыта — рядом всегда есть текст)
const ico = (name) => ICONS[name].replace('<svg ', '<svg class="ico" aria-hidden="true" ');

const TABS = ['home', 'services', 'mine'];

// dir: направление смены экрана (1 вправо, -1 влево); без него анимации нет
function render(dir) {
  const screens = { home: viewHome, services: viewServices, mine: viewMine };
  document.body.dataset.tab = state.tab;
  const v = $('#view');
  v.innerHTML = screens[state.tab]();
  updateTabs();
  updateSoon();
  if (dir) {
    v.classList.remove('in-left', 'in-right');
    void v.offsetWidth;
    v.classList.add(dir > 0 ? 'in-right' : 'in-left');
  }
}

// ближайшее свободное окно
function nextFree() {
  for (const k of nextDays(14)) {
    const dh = dayHours(k); if (!dh) continue;
    for (let h = dh.open; h < dh.close; h++) {
      const s = slotInfo(k, h);
      if (!s.past && s.free > 0) return { date: k, hour: h };
    }
  }
  return null;
}

// нижняя панель создаётся один раз, чтобы ползунок мог плавно переезжать
function initTabs() {
  const t = (id, label, icon) => `<button class="tab" data-act="tab" data-id="${id}"><span>${icon}</span>${label}</button>`;
  $('#tabs').innerHTML = `<div class="tab-ind"></div>${t('home', 'Главная', ICONS.home)}${t('services', 'Услуги', ICONS.list)}${t('mine', 'Моя запись', ICONS.ticket)}`;
}
function updateTabs() {
  const i = TABS.indexOf(state.tab);
  $('.tab-ind').style.transform = `translateX(${i * 100}%)`;
  const active = !state.owner && state.bookings.some((b) => b.status === 'wait' || b.status === 'ok');
  document.querySelectorAll('.tab').forEach((b, n) => {
    b.classList.toggle('on', n === i);
    b.firstElementChild.classList.toggle('dot', n === 2 && active);
  });
}

// кнопка профиля в правом верхнем углу: по нажатию — меню «Вы вошли как … / Выйти»
// ---------- цветные аватары ----------
const AVATAR_COLORS = ['#c9ced6', '#5b6472', '#3a6ea5', '#2f8f6b', '#8a3b4a', '#b8893b', '#6b4fa0', '#a3532c'];
// без выбора цвет подбирается по имени: у одного имени всегда один цвет
function avatarColor(name, color) {
  if (color) return color;
  let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function avatarHtml(name, color, cls = '') {
  const bg = avatarColor(name, color);
  const r = parseInt(bg.slice(1, 3), 16), g = parseInt(bg.slice(3, 5), 16), b = parseInt(bg.slice(5, 7), 16);
  const light = 0.299 * r + 0.587 * g + 0.114 * b > 150; // на светлом фоне — тёмная буква
  return `<span class="avatar ${cls}" aria-hidden="true" style="background:${bg};color:${light ? '#0d0f13' : '#fff'}">${esc((String(name).trim()[0] || '?').toUpperCase())}</span>`;
}
// свой цвет из полоски оттенков: насыщенность и яркость фиксированы, чтобы цвет оставался благородным
function hueHex(h) {
  const s = 0.55, l = 0.5, k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
function hexHue(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
}
// у владельца вместо буквы — логотип
const ownerAvatar = (cls = '') => `<span class="avatar logo-av ${cls}" aria-hidden="true"><img src="icon-192.png" alt=""></span>`;

function profileMenu() {
  const u = state.user;
  return `<div class="profile">
    <button class="btn sm profile-btn" data-act="profile" aria-haspopup="true" aria-expanded="false">
      ${state.owner ? ownerAvatar('sm') : avatarHtml(u.name, u.color, 'sm')}<span class="profile-name">${esc(u.name)}</span></button>
    <div class="profile-menu glass" hidden>
      <p class="muted small">Вы вошли как</p>
      <p class="profile-who">${esc(u.name)}</p>
      <p class="muted small">${esc(formatPhone(u.phone))}${state.owner ? ' · владелец' : ''}</p>
      ${state.owner ? '' : `<p class="muted small" style="margin-top:14px">Цвет аватара</p>
      <div class="swatches" role="radiogroup" aria-label="Цвет аватара">${AVATAR_COLORS.map((c) => `<button class="swatch ${avatarColor(u.name, u.color) === c ? 'on' : ''}" role="radio" aria-checked="${avatarColor(u.name, u.color) === c}" aria-label="Цвет ${c}" data-act="avatar-color" data-id="${c}" style="background:${c}"></button>`).join('')}</div>
      <p class="muted small" style="margin-top:10px">Свой цвет</p>
      <input type="range" class="hue" min="0" max="359" step="1" value="${hexHue(avatarColor(u.name, u.color))}" aria-label="Свой цвет аватара">`}
      <button class="btn sm danger block" data-act="logout" style="margin-top:14px">Выйти</button>
    </div></div>`;
}
function closeProfile() {
  const m = document.querySelector('.profile-menu');
  if (m && !m.hidden) { m.hidden = true; document.querySelector('.profile-btn')?.setAttribute('aria-expanded', 'false'); }
}

function header() {
  return `<div class="head"><div><h1><img class="logo" src="logo.png" alt="${CENTER.name}"></h1>
    ${state.tab === 'home' ? `<div class="addr">${ico('pin')}<a href="${CENTER.map}" target="_blank" rel="noopener">${CENTER.address}</a></div>` : ''}</div>
    ${state.user ? profileMenu() : '<button class="btn sm primary" data-act="login">Войти</button>'}</div>`;
}

// календарь-полоски выбранного дня (anim: ' anim' для плавного появления)
function slotsBlock(anim) {
  let rows = '';
  // пока данные не пришли — серые «мерцающие» полоски, а не ложное «всё свободно»
  if (!state.loaded) {
    for (let h = 10; h < 16; h++) rows += `<div class="slot"><span class="t">${pad(h)}:00</span><div class="bar sk"><i></i><i></i><i></i></div><span class="s">…</span></div>`;
    return `<div class="slots glass" aria-busy="true">${rows}</div>`;
  }
  // нет связи: не показываем ложное «всё свободно»
  if (state.loadError) {
    return `<div class="slots glass load-err"><p><b>Не удалось загрузить расписание</b></p>
      <p class="muted small">Проверьте интернет и попробуйте ещё раз.</p>
      <button class="btn sm primary" data-act="retry" style="margin-top:12px">Повторить</button></div>`;
  }
  const dh = dayHours(state.day);
  if (!dh) {
    const shut = state.sched.closed.includes(state.day);
    return `<div class="slots glass load-err"><p><b>${shut ? 'День закрыт для записи' : 'Выходной'}</b></p><p class="muted small">${shut ? 'Центр в этот день не принимает записи.' : 'В этот день центр не работает.'} Выберите другой день.</p></div>`;
  }
  for (let h = dh.open; h < dh.close; h++) {
    const s = slotInfo(state.day, h);
    if (s.past) continue; // прошедшие часы не показываем
    const bar = Array.from({ length: cap() }, (_, i) => {
      const cls = i < s.base ? 'busy' : i < s.base + s.hold ? 'hold' : i < s.busy ? 'mine' : '';
      return `<i class="${cls}"></i>`;
    }).join('');
    const label = s.free ? `свободно ${s.free}` : state.owner && s.hold ? 'закрыто' : 'занято';
    // у владельца любой час кликабелен: можно поставить или снять бронь
    const act = state.owner ? `data-act="owner-slot" data-h="${h}"` : s.free ? `data-act="slot" data-h="${h}"` : '';
    rows += `<div class="slot ${act ? 'free' : ''}" ${act}>
      <span class="t">${pad(h)}:00</span><div class="bar">${bar}</div><span class="s">${label}</span></div>`;
  }
  if (!rows) return `<div class="slots glass load-err"><p><b>На сегодня запись закончилась</b></p><p class="muted small">Выберите другой день.</p></div>`;
  return `<div class="slots glass${anim}">${rows}</div>`;
}

function viewHome() {
  const p = state.promo;
  let html = header();

  const nf = nextFree();
  const when = !state.loaded ? 'Загружаем расписание…' : state.loadError ? 'Нет связи с сервером' : nf ? `${dayName(nf.date)} · ${pad(nf.hour)}:00` : 'На две недели вперёд мест нет';
  html += `<div class="hero glass" ${nf ? `data-act="hero" data-date="${nf.date}" data-h="${nf.hour}"` : 'data-act="book"'}>
    <div class="hero-text"><h2>Записаться сейчас</h2><p class="hero-label">Ближайшее свободное время</p><p class="hero-time">${when}</p>
    <span class="btn primary">Записаться</span></div></div>`;

  if (state.owner) {
    html += `<div class="owner glass"><h3>Режим владельца</h3>
      <div class="row mt"><span>Акции и скидки</span><button class="btn sm" data-act="promo-toggle">${p.on ? 'Выключить' : 'Включить'}</button></div>
      <div class="row"><span>Скидка, %</span><input type="text" inputmode="numeric" style="width:90px" value="${p.percent}" data-act="promo-percent"></div>
      <div class="row"><span>Текст</span><input type="text" style="width:190px" value="${esc(p.text)}" data-act="promo-text"></div></div>`;
  }
  if (p.on) {
    html += `<div class="promo glass"><div class="tag">АКЦИИ И СКИДКИ</div>
      <h3 style="margin-top:6px">${esc(p.text)}: −${p.percent}%</h3>
      <p class="muted small" style="margin-top:4px">Скидка применяется автоматически при записи.</p></div>`;
  }

  html += `<h2 class="section-h">Свободное время</h2><div class="dates">${nextDays(14).map((k) => {
    const d = parseDay(k);
    return `<button class="date ${k === state.day ? 'on' : ''} ${dayHours(k) ? '' : 'off'}" data-act="day" data-id="${k}"><span>${WD[d.getDay()]}</span><b>${d.getDate()}</b></button>`;
  }).join('')}</div>`;

  html += `<div id="owner-day">${ownerDayBar()}</div>${slotsBlock('')}
    <div class="legend"><span><i style="background:#1fe06a"></i>свободно</span><span><i style="background:#ff3040"></i>занято</span><span><i style="background:#2d8cff"></i>ваша запись</span>${state.owner ? '<span><i class="lg-hold"></i>закрыто вами</span>' : ''}</div>
    <button class="btn primary block mt" data-act="book">Записаться</button>`;

  html += installCard();
  html += reviewsBlock();
  return html;
}

function reviewsBlock() {
  const avg = state.reviews.length ? (state.reviews.reduce((a, r) => a + r.rating, 0) / state.reviews.length).toFixed(1) : '—';
  const list = [...state.reviews].reverse().map((r) => `<div class="review">
    <div class="rv-head">${avatarHtml(r.name, r.color)}
      <div class="rv-who"><b>${esc(r.name)}</b><span class="muted small">${fmtDay(r.date)}</span></div>
      <span class="stars" role="img" aria-label="Оценка ${r.rating} из 5">${stars(r.rating)}</span></div>
    <p class="rv-text">${esc(r.text)}</p>
    ${r.reply ? `<div class="reply"><div class="reply-head">${ownerAvatar('xs')}<b>Ответ владельца</b></div><p>${esc(r.reply)}</p></div>` : ''}
    ${state.owner ? `<button class="btn sm" data-act="reply" data-id="${r.id}" style="margin-top:8px">${r.reply ? 'Изменить ответ' : 'Ответить'}</button>` : ''}</div>`).join('')
    || '<p class="muted small">Отзывов пока нет. Будьте первым!</p>';
  const form = state.user
    ? `<div class="mt"><div class="rate" id="rate">${[1, 2, 3, 4, 5].map((n) => `<button data-act="rate" data-id="${n}" aria-label="Оценка ${n}" class="${n <= (state.draftRating || 5) ? 'on' : ''}">★</button>`).join('')}</div>
        <textarea id="rtext" rows="3" placeholder="Ваш отзыв"></textarea>
        <button class="btn block mt" data-act="review-send">Оставить отзыв</button></div>`
    : `<button class="btn block mt" data-act="login">Войти, чтобы оставить отзыв</button>`;
  return `<h2 class="section-h">Отзывы · ${avg} <span class="gold">★</span></h2><div class="card glass">${list}${form}</div>`;
}

// ---------- корзина ----------
function cartBtn(id) {
  const inCart = state.cart.includes(id);
  return `<button class="btn sm ${inCart ? 'in-cart' : 'primary'}" data-act="cart-toggle" data-id="${id}">${inCart ? 'В корзине ✓' : 'Добавить'}</button>`;
}
function updateCart() {
  document.querySelectorAll('[data-act="cart-toggle"]').forEach((b) => {
    const inCart = state.cart.includes(Number(b.dataset.id));
    b.className = `btn sm ${inCart ? 'in-cart' : 'primary'}`;
    b.textContent = inCart ? 'В корзине ✓' : 'Добавить';
  });
  const fab = $('#cart');
  fab.hidden = state.cart.length === 0;
  fab.querySelector('.badge').textContent = state.cart.length;
}

function svcCards() {
  const q = state.query.trim().toLowerCase();
  const list = state.services.filter((s) => s.name.toLowerCase().includes(q));
  return list.map((s) => `<div class="card glass svc ${s.hidden ? 'is-hidden' : ''}">
    ${s.img ? `<div class="svc-img"><img src="${esc(s.img)}" alt="" loading="lazy" decoding="async"></div>` : ''}
    <div class="row" style="align-items:flex-start"><h3>${esc(s.name)}${s.hidden ? ' <span class="hidden-tag">скрыта</span>' : ''}</h3><span class="price">${priceLabel(s)}</span></div>
    <p>${esc(s.desc)}</p>${state.owner ? `<div class="svc-tools"><button class="btn sm" data-act="svc-edit" data-id="${s.id}">Изменить</button>
      <button class="btn sm" data-act="svc-hide" data-id="${s.id}">${s.hidden ? 'Показать' : 'Скрыть'}</button>
      <button class="cancel-link" data-act="svc-del" data-id="${s.id}">Удалить</button></div>` : cartBtn(s.id)}</div>`).join('')
    || '<div class="empty">Ничего не найдено</div>';
}

function viewServices() {
  return `${header()}${state.owner ? '<button class="btn primary block" data-act="svc-new" style="margin-bottom:12px">＋ Добавить услугу</button>' : ''}
    <input type="text" id="search" placeholder="Поиск по названию услуги" value="${esc(state.query)}" style="margin-bottom:16px">
    <div id="svc-list">${svcCards()}</div>
    <p class="muted small">Цены ориентировочные, точную стоимость подтвердит мастер. Телефон: ${CENTER.phone}</p>`;
}

// статус записи; пока запись ждёт подтверждения, после текста бегут три точки
function statusHtml(status) {
  const [label, cls] = STATUS[status];
  return `<span class="status ${cls}">${label}${status === 'wait' ? '<span class="dots"><i></i><i></i><i></i></span>' : ''}</span>`;
}
const STATUS = { wait: ['Ожидает подтверждения', 'wait'], ok: ['Подтверждена', 'ok'], done: ['Выполнена', 'ok'], cancelled: ['Отменена', 'off'] };
// [полный текст, класс, короткий текст для таблицы]
function bState(b) {
  if (b.noShow) return ['Неявка', 'off', 'Неявка'];
  if (shutOut(b)) return ['Центр закрыт — нужен перенос', 'off', 'Нужен перенос'];
  if (b.status === 'ok' && b.workStatus === 'in_work') return ['Машина в работе', 'work', 'В работе'];
  if (b.status === 'ok' && b.workStatus === 'ready') return ['Готово — можно забирать', 'ready', 'Готово к выдаче'];
  return [STATUS[b.status][0], STATUS[b.status][1], SHORT[b.status]];
}
function bStatusHtml(b) {
  if (b.status === 'wait' && !b.noShow && !shutOut(b)) return statusHtml('wait');
  const [label, cls] = bState(b);
  return `<span class="status ${cls}">${label}</span>`;
}
// правило отмены: клиент отменяет и переносит онлайн не позже чем за N часов
const tooLate = (b) => state.sched.cancelHours > 0 && startMs(b) - Date.now() < state.sched.cancelHours * 3600000;
// владелец закрыл день или час уже после записи — клиенту нужно перенести или отменить её (правило «за N часов» не действует)
function shutOut(b) {
  if (!(b.status === 'wait' || b.status === 'ok') || b.workStatus || b.noShow || startMs(b) <= Date.now()) return false;
  const h = dayHours(b.date);
  return !h || b.hour < h.open || b.hour >= h.close;
}
const hoursWord = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'час' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'часа' : 'часов');
// пожелания и фото к записи
function extrasHtml(b) {
  return `${b.comment ? `<p class="comment">«${esc(b.comment)}»</p>` : ''}
    ${b.photos?.length ? `<div class="thumbs">${b.photos.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Фото к записи" loading="lazy"></a>`).join('')}</div>` : ''}`;
}

function bookingCard(b, history) {
  const cls = STATUS[b.status][1];
  const t = itemsOf(b);
  const lines = t.list.map((s) => `<div class="row"><span>${esc(s.name)}</span><span>${s.price === null ? 'по телефону' : money(s.price)}</span></div>`).join('');
  const active = b.status === 'wait' || b.status === 'ok';
  const pay = b.refund === 'pending' ? `<div class="refund wait">Возврат ${money(b.total)}: ожидается<span class="dots"><i></i><i></i><i></i></span></div>`
    : b.refund === 'done' ? `<div class="refund ok">↩️ Деньги возвращены: ${money(b.total)}</div>`
    : b.paid ? '<div class="paid">✅ Заказ оплачен</div>'
    : active && b.total > 0 ? `<a class="btn pay block" href="${payUrl(b)}" target="_blank" rel="noopener" data-pay="${b.id}">Оплатить ${money(b.total)}</a>` : '';
  // пока машина в работе или готова, отменять и переносить уже нечего
  const shut = shutOut(b);
  const late = active && !shut && (tooLate(b) || !!b.workStatus);
  const cancel = active && !late ? `<button class="cancel-link" data-act="cancel" data-id="${b.id}">Отменить запись</button>` : '';
  const move = active && !late ? `<button class="move-link" data-act="move" data-id="${b.id}">Перенести</button>` : '';
  const cal = active ? `<button class="move-link" data-act="ics" data-id="${b.id}">${ico('ticket')}В календарь</button>` : '';
  const foot = active ? `<div class="card-foot">${cal}${move}${cancel}</div>` : '';
  const lateNote = late && !b.workStatus ? `<p class="muted small late-note">До записи меньше ${state.sched.cancelHours} ${hoursWord(state.sched.cancelHours)} — отменить или перенести можно только по телефону ${CENTER.phone}.</p>` : '';
  const ready = b.status === 'ok' && b.workStatus === 'ready' ? '<div class="work-plate">🚗 Машина готова — можно забирать</div>' : '';
  const shutNote = shut ? `<div class="shut-plate">Центр не работает в это время. Перенесите запись или отмените её${b.paid ? ` — вернём ${money(b.total)}` : ''}.
    <button class="btn primary block" data-act="move" data-id="${b.id}">Выбрать другое время</button></div>` : '';
  const repeat = history ?`<button class="btn primary block" data-act="repeat" data-id="${b.id}" style="margin-top:12px">Повторить</button>` : '';
  return `<div class="card glass booking">
    <div class="row">${bStatusHtml(b)}<span class="muted small">№${b.id}</span></div>
    ${ready}${shutNote}
    <h3 style="margin-top:10px">${fmtDay(b.date)}, ${pad(b.hour)}:00</h3>
    <p class="meta">${ico('pin')}${CENTER.address}</p>
    <p class="meta">${ico('car')}${esc(b.car)}</p>
    ${extrasHtml(b)}
    <div class="lines">${lines}
      ${b.discount ? `<div class="row muted"><span>Скидка</span><span>−${money(b.discount)}</span></div>` : ''}
      <div class="row total"><span>Итого</span><span>${money(b.total)}${t.unknown ? ' + по телефону' : ''}</span></div>
    </div>
    ${pay ? `<div class="upfront">${pay}</div>` : ''}${repeat}${foot}${lateNote}
  </div>`;
}

// ---------- добавить сайт на главный экран ----------
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
window.addEventListener('appinstalled', () => { installPrompt = null; render(); });
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
// плашка нужна только на телефонах и планшетах; закрытая крестиком больше не показывается
const isMobile = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) <= 1024);
const installHidden = () => { try { return localStorage.getItem('gml_install_hidden') === '1'; } catch { return false; } };
function installCard() {
  if (isStandalone() || !isMobile() || installHidden()) return '';
  return `<div class="card glass install"><button class="install-x" data-act="install-x" aria-label="Скрыть плашку"><span aria-hidden="true">×</span></button>
    <img src="icon-192.png" alt="">
    <div class="install-text"><h3>Добавить сайт на главный экран</h3>
      <p class="muted small">Своя иконка на экране.<br>Быстрый доступ к сайту.</p></div>
    <button class="btn sm primary" data-act="install">Добавить</button></div>`;
}
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// shared = меню «Поделиться» уже открыто сайтом, осталось выбрать нужный пункт
function installSheet(shared) {
  const ios = isIOS();
  if (shared) {
    return openSimple(`<h2>Почти готово</h2>
      <div class="card glass"><ol class="steps-list">
        <li>В открывшемся меню «Поделиться» пролистайте список вниз.</li>
        <li>Выберите <b>«На экран Домой»</b>.</li>
        <li>Нажмите <b>«Добавить»</b> вверху справа.</li></ol></div>
      <p class="muted small" style="margin-top:4px">Меню закрылось раньше? Нажмите «Открыть снова».</p>
      <div class="actions"><button class="btn" data-act="close">Готово</button><button class="btn primary" data-act="install">Открыть снова</button></div>`);
  }
  openSimple(`<h2>Добавить на главный экран</h2>
    <p class="muted small" style="margin-bottom:12px">Сайт появится на экране телефона со своей иконкой и будет открываться как приложение.</p>
    <div class="card glass"><ol class="steps-list">${ios
      ? '<li>Откройте сайт в <b>Safari</b>.</li><li>Нажмите кнопку <b>«Поделиться»</b> (квадрат со стрелкой) внизу экрана.</li><li>Выберите <b>«На экран Домой»</b>.</li><li>Нажмите <b>«Добавить»</b>.</li>'
      : '<li>Нажмите меню браузера <b>⋮</b> (три точки) вверху справа.</li><li>Выберите <b>«Установить приложение»</b> или <b>«Добавить на главный экран»</b>.</li><li>Подтвердите.</li>'}</ol></div>
    <div class="actions"><button class="btn primary" data-act="close">Понятно</button></div>`);
}

// красный мигающий кружок у записей, до начала которых осталось не больше 30 минут
const startMs = (b) => { const d = parseDay(b.date); d.setHours(b.hour, 0, 0, 0); return d.getTime(); };
function updateSoon() {
  const now = Date.now();
  document.querySelectorAll('.soon-dot').forEach((el) => {
    const left = Number(el.dataset.start) - now;
    el.hidden = el.dataset.off === '1' || left <= 0 || left > 30 * 60 * 1000;
  });
}
setInterval(updateSoon, 20000);

// ---------- владелец: таблица всех записей ----------
const SHORT = { wait: 'Ждёт', ok: 'Подтв.', done: 'Готово', cancelled: 'Отмена' };
// фильтры таблицы: сегодня / завтра / неделя / все + поиск по имени, телефону, машине
const OWNER_FILTERS = [['today', 'Сегодня'], ['tomorrow', 'Завтра'], ['week', 'Неделя'], ['all', 'Все']];
function ownerList(filter = state.ownerFilter) {
  const today = dayKey(new Date()), t2 = new Date(); t2.setDate(t2.getDate() + 1);
  const w = new Date(); w.setDate(w.getDate() + 6);
  const tomorrow = dayKey(t2), weekEnd = dayKey(w);
  const q = state.ownerQuery.trim().toLowerCase(), qd = q.replace(/\D/g, '');
  return state.bookings.filter((b) => {
    if (filter === 'today' && b.date !== today) return false;
    if (filter === 'tomorrow' && b.date !== tomorrow) return false;
    if (filter === 'week' && (b.date < today || b.date > weekEnd)) return false;
    if (filter === 'refund' && b.refund !== 'pending') return false;
    if (!q) return true;
    return (b.userName || '').toLowerCase().includes(q) || (b.car || '').toLowerCase().includes(q) || (qd.length >= 3 && String(b.phone).includes(qd));
  });
}
function ownerTable() {
  const key = (b) => b.date + pad(b.hour);
  const list = ownerList();
  const active = list.filter((b) => b.status === 'wait' || b.status === 'ok').sort((a, b) => key(a).localeCompare(key(b)));
  const rest = list.filter((b) => b.status === 'done' || b.status === 'cancelled').sort((a, b) => key(b).localeCompare(key(a)));
  const rows = [...active, ...rest].map((b) => {
    const d = parseDay(b.date);
    return `<tr data-act="owner-booking" data-id="${b.id}" class="${b.status === 'done' || b.status === 'cancelled' ? 'dim' : ''}">
      <td><b>${pad(d.getDate())}.${pad(d.getMonth() + 1)}</b> ${WD[d.getDay()]}<br><span class="muted">${pad(b.hour)}:00</span><i class="soon-dot" data-start="${startMs(b)}" ${b.status === 'wait' || b.status === 'ok' ? '' : 'data-off="1"'} hidden></i></td>
      <td>${esc(b.userName || 'Клиент')}<br><span class="muted">${esc(b.car)}</span></td>
      <td class="num">${money(b.total)}${b.refund === 'pending' ? '<br><span class="refund-mark">вернуть!</span>' : b.refund === 'done' ? '<br><span class="paid-mark">возвращено</span>' : b.paid ? '<br><span class="paid-mark">оплачено</span>' : ''}</td>
      <td><span class="status ${bState(b)[1]}">${bState(b)[2]}</span></td></tr>`;
  }).join('');
  const empty = state.ownerQuery ? 'Ничего не найдено.' : { refund: 'Возвратов нет.', today: 'На сегодня записей нет.', tomorrow: 'На завтра записей нет.', week: 'На неделю записей нет.', all: 'Записей пока нет.' }[state.ownerFilter];
  return rows
    ? `<div class="card glass table-wrap"><table class="otable"><thead><tr><th>Дата</th><th>Клиент</th><th class="num">Сумма</th><th>Статус</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : `<div class="empty">${empty}</div>`;
}
function ownerChips() {
  return OWNER_FILTERS.map(([id, label]) => {
    const n = ownerList(id).filter((b) => b.status === 'wait' || b.status === 'ok').length;
    return `<button class="chip ${state.ownerFilter === id ? 'on' : ''}" data-act="ofilter" data-id="${id}">${label}${id !== 'all' && n ? ` <b>${n}</b>` : ''}</button>`;
  }).join('');
}
function refundBanner() {
  const list = state.bookings.filter((b) => b.refund === 'pending');
  if (!list.length) return '';
  const sum = list.reduce((s, b) => s + b.total, 0);
  return `<button class="refund-banner" data-act="ofilter" data-id="refund">❗️ Нужно вернуть деньги: ${list.length} ${list.length === 1 ? 'клиенту' : 'клиентам'}, ${money(sum)}<span>Показать</span></button>`;
}
const OWNER_VIEWS = [['records', 'Записи'], ['clients', 'Клиенты'], ['stats', 'Статистика']];
function viewOwner() {
  const seg = `<div class="seg" role="tablist">${OWNER_VIEWS.map(([id, label]) => `<button role="tab" aria-selected="${state.ownerView === id}" class="${state.ownerView === id ? 'on' : ''}" data-act="oview" data-id="${id}">${label}</button>`).join('')}</div>`;
  if (state.ownerView === 'clients') return `${header()}${seg}${clientsView()}${installCard()}`;
  if (state.ownerView === 'stats') return `${header()}${seg}${statsView()}${installCard()}`;
  return `${header()}${seg}<div class="row" style="margin-bottom:12px"><h2 style="margin:0">Записи</h2>
      <div class="row" style="gap:8px"><button class="btn sm" data-act="export">Excel</button><button class="btn sm" data-act="sched">${ico('ticket')}График</button></div></div>
    ${refundBanner()}
    <div class="chips" id="ochips">${ownerChips()}</div>
    <input type="text" id="osearch" placeholder="Поиск: имя, телефон или машина" value="${esc(state.ownerQuery)}" style="margin-bottom:12px">
    <div id="otable">${ownerTable()}</div>${installCard()}`;
}

// ---------- владелец: клиентская база ----------
// клиенты собираются из записей по номеру телефона
function clientList() {
  const map = new Map();
  for (const b of state.bookings) {
    const key = phoneDigits(b.phone);
    const c = map.get(key) || { phone: key, name: b.userName || 'Клиент', visits: 0, spent: 0, last: '', upcoming: 0, noShows: 0 };
    if (b.status === 'done') { c.visits++; c.spent += b.total; if (b.date > c.last) { c.last = b.date; c.name = b.userName || c.name; } }
    if (b.status === 'wait' || b.status === 'ok') c.upcoming++;
    if (b.noShow) c.noShows++;
    map.set(key, c);
  }
  return [...map.values()].sort((a, b) => b.spent - a.spent || b.visits - a.visits);
}
function clientsRows() {
  const q = (state.clientQuery || '').trim().toLowerCase(), qd = q.replace(/\D/g, '');
  const list = clientList().filter((c) => !q || c.name.toLowerCase().includes(q) || (qd.length >= 3 && c.phone.includes(qd)));
  if (!list.length) return `<div class="empty">${q ? 'Ничего не найдено.' : 'Клиентов пока нет.'}</div>`;
  return `<div class="card glass table-wrap"><table class="otable"><thead><tr><th>Клиент</th><th class="num">Визитов</th><th class="num">Потратил</th><th>Был</th></tr></thead><tbody>
    ${list.map((c) => `<tr data-act="client" data-id="${c.phone}">
      <td><b>${esc(c.name)}</b><br><span class="muted">${esc(formatPhone(c.phone))}</span>${c.noShows ? `<br><span class="refund-mark">неявок: ${c.noShows}</span>` : ''}</td>
      <td class="num">${c.visits}${c.upcoming ? `<br><span class="paid-mark">+${c.upcoming} впереди</span>` : ''}</td>
      <td class="num">${money(c.spent)}</td>
      <td>${c.last ? `${pad(parseDay(c.last).getDate())}.${pad(parseDay(c.last).getMonth() + 1)}` : '—'}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function clientsView() {
  return `<input type="text" id="csearch" placeholder="Поиск: имя или телефон" value="${esc(state.clientQuery || '')}" style="margin-bottom:12px">
    <div id="ctable">${clientsRows()}</div>
    <p class="muted small">Нажмите на клиента, чтобы увидеть все его записи.</p>`;
}

// ---------- владелец: статистика ----------
const PERIODS = [[7, '7 дней'], [30, '30 дней'], [0, 'Всё время']];
function statsView() {
  const today = dayKey(new Date());
  const from = state.statsPeriod ? dayKey(new Date(Date.now() - (state.statsPeriod - 1) * 86400000)) : '';
  const inP = (b) => (!from || b.date >= from) && b.date <= today;
  const done = state.bookings.filter((b) => b.status === 'done' && inP(b));
  const revenue = done.reduce((s, b) => s + b.total, 0);
  const cancelled = state.bookings.filter((b) => b.status === 'cancelled' && !b.noShow && inP(b)).length;
  const noShows = state.bookings.filter((b) => b.noShow && inP(b)).length;
  const upcoming = state.bookings.filter((b) => (b.status === 'wait' || b.status === 'ok') && b.date >= today).length;
  // популярные услуги и загрузка по дням недели — по выполненным и предстоящим записям периода
  const counted = state.bookings.filter((b) => (b.status === 'done' || b.status === 'wait' || b.status === 'ok') && (!from || b.date >= from));
  const svc = {};
  counted.forEach((b) => itemsOf(b).list.forEach((s) => { svc[s.name] = (svc[s.name] || 0) + 1; }));
  const top = Object.entries(svc).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const wd = [1, 2, 3, 4, 5, 6, 0].map((d) => [WD[d], counted.filter((b) => parseDay(b.date).getDay() === d).length]);
  const bars = (rows, unit) => {
    const max = Math.max(1, ...rows.map((r) => r[1]));
    return rows.map(([label, v]) => `<div class="hbar" title="${esc(label)}: ${v} ${unit}">
      <span class="hbar-l">${esc(label)}</span><span class="hbar-t"><i style="width:${Math.max(v ? 4 : 0, (v / max) * 100)}%"></i></span><span class="hbar-v">${v}</span></div>`).join('');
  };
  const tile = (label, value, sub = '') => `<div class="tile glass"><span class="muted small">${label}</span><b>${value}</b>${sub ? `<span class="muted small">${sub}</span>` : ''}</div>`;
  return `<div class="chips">${PERIODS.map(([d, l]) => `<button class="chip ${state.statsPeriod === d ? 'on' : ''}" data-act="speriod" data-id="${d}">${l}</button>`).join('')}</div>
    <div class="tiles">
      ${tile('Выручка', money(revenue), 'по выполненным')}
      ${tile('Выполнено', done.length, done.length ? `средний чек ${money(Math.round(revenue / done.length))}` : '')}
      ${tile('Отмены', cancelled)}
      ${tile('Неявки', noShows)}
    </div>
    <p class="muted small" style="margin:-4px 0 16px">Впереди записей: ${upcoming}</p>
    <h3 style="margin-bottom:10px">Популярные услуги</h3>
    <div class="card glass">${top.length ? bars(top, 'записей') : '<p class="muted small">Пока нет данных.</p>'}</div>
    <h3 style="margin:18px 0 10px">Загрузка по дням недели</h3>
    <div class="card glass">${bars(wd, 'записей')}</div>`;
}

// ---------- владелец: выгрузка в Excel ----------
// CSV с разделителем «;» и BOM — Excel открывает его по-русски без настроек
function exportCsv() {
  const list = ownerList().slice().sort((a, b) => (a.date + pad(a.hour)).localeCompare(b.date + pad(b.hour)));
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['№', 'Дата', 'Время', 'Клиент', 'Телефон', 'Автомобиль', 'Услуги', 'Сумма, ₽', 'Скидка, ₽', 'Статус', 'Оплата', 'Пожелания'];
  const rows = list.map((b) => [b.id, b.date.split('-').reverse().join('.'), `${pad(b.hour)}:00`, b.userName, formatPhone(b.phone), b.car,
    itemsOf(b).list.map((s) => s.name).join(', '), b.total, b.discount, bState(b)[0],
    b.refund === 'pending' ? 'нужен возврат' : b.refund === 'done' ? 'возвращено' : b.paid ? 'оплачено' : 'нет', b.comment]);
  const csv = '﻿' + [head, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = `gml-zapisi-${dayKey(new Date())}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast(`Выгружено записей: ${list.length}`);
}

// ---------- владелец: график работы ----------
const WEEK = [[1, 'Понедельник'], [2, 'Вторник'], [3, 'Среда'], [4, 'Четверг'], [5, 'Пятница'], [6, 'Суббота'], [0, 'Воскресенье']];
function hourOptions(sel, from, to) {
  let o = '';
  for (let h = from; h <= to; h++) o += `<option value="${h}" ${h === sel ? 'selected' : ''}>${pad(h)}:00</option>`;
  return o;
}
function schedSheet() {
  // черновик, чтобы добавление и удаление дат не теряло уже изменённые часы
  const g = state.schedDraft || (state.schedDraft = JSON.parse(JSON.stringify(state.sched)));
  const rows = WEEK.map(([i, name]) => {
    const d = g.schedule[i];
    return `<div class="sched-row ${d ? '' : 'off'}" data-day="${i}">
      <label class="sw"><input type="checkbox" data-act="sched-day" data-id="${i}" ${d ? 'checked' : ''}><span></span></label>
      <span class="sched-name">${name}</span>
      ${d ? `<select data-sched="open" aria-label="Открытие, ${name}">${hourOptions(d.open, 0, 23)}</select><span class="muted">—</span>
        <select data-sched="close" aria-label="Закрытие, ${name}">${hourOptions(d.close, 1, 24)}</select>` : '<span class="muted small sched-off">Выходной</span>'}
    </div>`;
  }).join('');
  const dates = g.closed.slice().sort().map((k) => `<span class="dtag">${fmtDay(k)}<button data-act="sched-undate" data-id="${k}" aria-label="Убрать дату">×</button></span>`).join('') || '<span class="muted small">Нет</span>';
  openSimple(`<h2>График работы</h2>
    <div class="card glass sched">${rows}</div>
    <div class="card glass">
      <div class="row"><span>Боксов (машин в час)</span><select id="sched-cap" aria-label="Число боксов">${Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}" ${i + 1 === g.capacity ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></div>
      <div class="row" style="margin-top:10px"><span>Клиент отменяет онлайн не позже чем за</span><select id="sched-cancel" aria-label="Правило отмены">${[0, 1, 2, 3, 6, 12, 24, 48].map((h) => `<option value="${h}" ${h === (g.cancelHours ?? 3) ? 'selected' : ''}>${h ? `${h} ч` : 'в любое время'}</option>`).join('')}</select></div>
    </div>
    <div class="card glass">
      <p style="margin-bottom:8px">Нерабочие даты <span class="muted small">(праздники, отпуск)</span></p>
      <div class="tags">${dates}</div>
      <div class="row" style="margin-top:10px"><input type="date" id="sched-date" min="${dayKey(new Date())}" aria-label="Нерабочая дата"><button class="btn sm" data-act="sched-adddate">Добавить</button></div>
    </div>
    <div class="actions"><button class="btn" data-act="sched-cancel">Закрыть</button><button class="btn primary" data-act="sched-save">Сохранить</button></div>`);
}
// забираем часы из полей окна в черновик (перед перерисовкой и сохранением)
function readSched() {
  const g = state.schedDraft;
  document.querySelectorAll('.sched-row').forEach((r) => {
    const i = Number(r.dataset.day), o = r.querySelector('[data-sched="open"]'), c = r.querySelector('[data-sched="close"]');
    if (g.schedule[i] && o && c) g.schedule[i] = { open: Number(o.value), close: Number(c.value) };
  });
  const cp = $('#sched-cap'); if (cp) g.capacity = Number(cp.value);
  const ch = $('#sched-cancel'); if (ch) g.cancelHours = Number(ch.value);
  return g;
}

// ---------- «добавить в календарь» ----------
// файл .ics открывается календарём телефона; время центра — Екатеринбург (UTC+5)
function addToCalendar(b) {
  const d = parseDay(b.date);
  const utc = (h) => { const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), h - 5)); return x.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'; };
  const names = itemsOf(b).list.map((s) => s.name).join(', ');
  const icsEsc = (s) => String(s).replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//GML Detailing//RU', 'BEGIN:VEVENT',
    `UID:gml-${b.id}@gml-detailing`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART:${utc(b.hour)}`, `DTEND:${utc(b.hour + 1)}`,
    `SUMMARY:${icsEsc('GML Detailing: ' + names)}`, `LOCATION:${icsEsc(CENTER.address)}`,
    `DESCRIPTION:${icsEsc(`Запись №${b.id}. ${names}. Итого: ${b.total} ₽. Автомобиль: ${b.car}`)}`,
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Скоро запись в GML Detailing', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = `gml-zapis-${b.id}.ics`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------- запись попала на закрытый день ----------
// напоминаем клиенту при каждом открытии сайта, пока он не перенесёт или не отменит запись
function askShut() {
  if (!state.user || state.owner || !$('#sheet').hidden) return;
  const b = state.bookings.find(shutOut);
  if (!b) return;
  openSimple(`<h2>Центр не работает в день вашей записи</h2>
    <p class="muted" style="margin:6px 0 14px">Запись на ${fmtDay(b.date)}, ${pad(b.hour)}:00. Перенесите её на другое время или отмените.${b.paid ? ` При отмене вернём ${money(b.total)}.` : ''}</p>
    <button class="btn primary block" data-act="move" data-id="${b.id}">Перенести</button>
    <div class="actions"><button class="btn" data-act="close">Позже</button><button class="btn danger" data-act="cancel" data-id="${b.id}">Отменить запись</button></div>`);
}

// ---------- оценка после визита ----------
// один раз на каждую выполненную запись за последние 30 дней
function askRating() {
  if (!state.user || state.owner || !$('#sheet').hidden) return;
  let asked = [];
  try { asked = JSON.parse(localStorage.getItem('gml_rate_asked') || '[]'); } catch {}
  const since = new Date(); since.setDate(since.getDate() - 30);
  const b = state.bookings.find((x) => x.status === 'done' && !asked.includes(x.id) && parseDay(x.date) >= since);
  if (!b) return;
  try { localStorage.setItem('gml_rate_asked', JSON.stringify([...asked, b.id])); } catch {}
  state.rateStars = 5;
  openSimple(`<h2>Как прошёл визит?</h2>
    <p class="muted" style="margin-bottom:6px">${fmtDay(b.date)} · ${esc(itemsOf(b).list.map((s) => s.name).join(', '))}</p>
    <div class="rate rate-big" id="rate2">${[1, 2, 3, 4, 5].map((n) => `<button data-act="rate2" data-id="${n}" aria-label="Оценка ${n}" class="on">★</button>`).join('')}</div>
    <textarea id="rtext2" rows="3" placeholder="Пара слов о работе (необязательно)"></textarea>
    <div class="actions"><button class="btn" data-act="close">Не сейчас</button><button class="btn primary" data-act="rate-send">Отправить</button></div>`);
}
function ownerBookingSheet(id) {
  const b = state.bookings.find((x) => x.id === id);
  const t = itemsOf(b);
  const active = b.status === 'wait' || b.status === 'ok';
  const noShows = state.bookings.filter((x) => x.noShow && phoneDigits(x.phone) === phoneDigits(b.phone)).length;
  const started = startMs(b) <= Date.now();
  const shut = shutOut(b);
  // главная кнопка зависит от этапа: подтвердить → в работе → готово → выполнена
  const main = b.status === 'wait' ? ['confirm', 'Подтвердить запись']
    : !b.workStatus ? ['work', 'Машина в работе', 'in_work']
    : b.workStatus === 'in_work' ? ['work', 'Готово, можно забирать', 'ready']
    : ['confirm', 'Машину забрали — выполнена'];
  openSimple(`<div class="row">${bStatusHtml(b)}<span class="muted small">№${b.id}</span></div>
    <h2 style="margin-top:12px">${fmtDay(b.date)}, ${pad(b.hour)}:00</h2>
    ${noShows ? `<p class="warn-note">⚠️ У клиента неявок: ${noShows}</p>` : ''}
    ${shut ? '<p class="warn-note">⚠️ В это время центр закрыт. Клиент видит просьбу перенести или отменить запись. Можно позвонить ему или перенести самому.</p>' : ''}
    ${b.comment || b.photos?.length ? `<div class="card glass"><p class="muted small" style="margin-bottom:4px">Пожелания клиента</p>${extrasHtml(b)}</div>` : ''}
    <div class="card glass small">
      <div class="row"><span class="muted">Клиент</span><span>${esc(b.userName || '—')}</span></div>
      <div class="row"><span class="muted">Телефон</span><a href="tel:+7${phoneDigits(b.phone)}" style="color:var(--accent)">${esc(formatPhone(b.phone) || b.phone)}</a></div>
      <div class="row"><span class="muted">Автомобиль</span><span>${esc(b.car)}</span></div>
      <div class="row"><span class="muted">Оплата</span><span>${b.refund === 'pending' ? '<b class="refund-mark">нужно вернуть ' + money(b.total) + '</b>' : b.refund === 'done' ? 'деньги возвращены' : b.paid ? '✅ оплачено' : 'не оплачено'}</span></div>
    </div>
    <div class="card glass"><div class="lines" style="margin-top:0;border-top:0;padding-top:0">
      ${t.list.map((s) => `<div class="row"><span>${esc(s.name)}</span><span>${s.price === null ? 'по телефону' : money(s.price)}</span></div>`).join('')}
      ${b.discount ? `<div class="row muted"><span>Скидка</span><span>−${money(b.discount)}</span></div>` : ''}
      <div class="row total"><span>Итого</span><span>${money(b.total)}${t.unknown ? ' + по телефону' : ''}</span></div></div></div>
    ${active ? `${shut ? '' : `<button class="btn primary block" data-act="${main[0]}" data-id="${b.id}" ${main[2] ? `data-ws="${main[2]}"` : ''}>${main[1]}</button>`}
      <button class="btn ${shut ? 'primary' : ''} block" data-act="move" data-id="${b.id}" style="margin-top:10px">Перенести</button>
      ${started && !b.workStatus ? `<button class="btn block" data-act="noshow" data-id="${b.id}" style="margin-top:10px">Клиент не пришёл</button>` : ''}` : ''}
    ${b.refund === 'pending' ? `<p class="muted small" style="margin:4px 0 10px">Верните ${money(b.total)} клиенту удобным способом (например, переводом по номеру ${esc(formatPhone(b.phone))}) и нажмите кнопку ниже.</p>
      <button class="btn pay block" data-act="refunded" data-id="${b.id}">Деньги возвращены</button>` : ''}
    <div class="actions"><button class="btn" data-act="close">Закрыть</button>
      ${active ? `<button class="btn danger" data-act="cancel" data-id="${b.id}">Отменить</button>` : ''}</div>`);
}

function viewMine() {
  if (state.owner) return viewOwner();
  if (!state.user) {
    return `${header()}<h2>Моя запись</h2>
      <div class="card glass"><h3>Войдите в аккаунт</h3>
        <p class="muted small" style="margin:6px 0 14px">Чтобы посмотреть свои записи, войдите или зарегистрируйтесь.</p>
        <div class="actions" style="margin-top:0"><button class="btn primary" data-act="login">Войти</button><button class="btn" data-act="register">Регистрация</button></div></div>${installCard()}`;
  }
  const all = [...state.bookings].reverse();
  const current = all.filter((b) => b.status === 'wait' || b.status === 'ok');
  const past = all.filter((b) => b.status === 'done' || b.status === 'cancelled');
  const body = current.length
    ? current.map((b) => bookingCard(b, false)).join('')
    : `<div class="empty">${past.length ? 'Активных записей нет.' : 'У вас пока нет записей.'}<br>Выберите время на главной странице.</div>`;
  const hist = past.length ? `<h2 style="margin-top:24px">История</h2>${past.map((b) => bookingCard(b, true)).join('')}` : '';
  return `${header()}<h2>Моя запись</h2>${body}${hist}${installCard()}`;
}

// ---------- запись (4 шага) ----------
function openBooking(opts = {}) {
  renderSheet.prev = 1; renderSheet.last = null;
  const services = opts.services ? [...opts.services] : opts.service ? [opts.service] : [];
  state.draft = { step: 1, services, date: opts.date || (dayHours(state.day) ? state.day : firstOpenDay()), hour: opts.hour ?? null, phone: opts.phone || state.user?.phone || '', car: opts.car || '', comment: '', files: [] };
  state.draft.step = opts.step || (services.length ? 2 : 1);
  renderSheet();
  // свежая занятость: вдруг кто-то записался, пока страница была открыта
  refreshCounts().then(() => { if (state.draft?.step === 2) $('.panel .hours').innerHTML = hoursGrid(state.draft); }).catch(() => {});
}
function closeSheet() { const s = $('#sheet'); s.hidden = true; s.innerHTML = ''; state.draft = null; }

// сетка часов; skip — час, который нельзя выбрать (текущее время переносимой записи)
function hoursGrid(d, act = 'hour', skip = null) {
  const dh = dayHours(d.date);
  if (!dh) return '<p class="muted hours-note">Выходной — выберите другой день.</p>';
  return Array.from({ length: dh.close - dh.open }, (_, i) => dh.open + i).map((h) => {
    const s = slotInfo(d.date, h);
    if (s.past) return '';
    const dis = s.free <= 0 || (skip && skip.date === d.date && skip.hour === h);
    return `<button class="btn ${d.hour === h ? 'on' : ''}" ${dis ? 'disabled' : ''} data-act="${act}" data-h="${h}">${pad(h)}:00</button>`;
  }).join('');
}

// ---------- перенос записи ----------
function moveSheet(id) {
  const b = state.bookings.find((x) => x.id === id);
  const days = nextDays(14);
  state.move = { id, date: days.includes(b.date) && dayHours(b.date) ? b.date : days.find((k) => dayHours(k)) || days[0], hour: null, from: { date: b.date, hour: b.hour } };
  const m = state.move;
  openSimple(`<h2>Перенос записи</h2>
    <p class="muted" style="margin-bottom:12px">Сейчас: ${fmtDay(b.date)}, ${pad(b.hour)}:00.${state.owner ? '' : ' После переноса запись снова подтвердит владелец.'}</p>
    <div class="dates">${days.map((k) => {
      const dt = parseDay(k);
      return `<button class="date ${k === m.date ? 'on' : ''} ${dayHours(k) ? '' : 'off'}" data-act="mdate" data-id="${k}" ${dayHours(k) ? '' : 'disabled'}><span>${WD[dt.getDay()]}</span><b>${dt.getDate()}</b></button>`;
    }).join('')}</div>
    <div class="hours">${hoursGrid(m, 'mhour', m.from)}</div>
    <div class="actions"><button class="btn" data-act="close">Закрыть</button><button class="btn primary" data-act="move-ok" disabled>Перенести</button></div>`);
}

function renderSheet() {
  const d = state.draft; if (!d) return;
  const dots = `<div class="steps">${[1, 2, 3, 4].map((n) => `<i class="${n <= d.step ? 'on' : ''}"></i>`).join('')}</div>`;
  let body = '', next = 'Далее', ok = true;

  if (d.step === 1) {
    body = `<h2>1. Выберите услуги</h2>` + state.services.map((s) => `<div class="pick glass ${d.services.includes(s.id) ? 'on' : ''}" data-act="pick" data-id="${s.id}">
      <div class="chk">${d.services.includes(s.id) ? '✓' : ''}</div><div style="flex:1"><b>${esc(s.name)}</b></div><span class="price small">${priceLabel(s)}</span></div>`).join('');
    ok = d.services.length > 0;
  } else if (d.step === 2) {
    const hours = hoursGrid(d);
    body = `<h2>2. Дата и время</h2><div class="dates">${nextDays(14).map((k) => {
      const dt = parseDay(k);
      return `<button class="date ${k === d.date ? 'on' : ''} ${dayHours(k) ? '' : 'off'}" data-act="sdate" data-id="${k}" ${dayHours(k) ? '' : 'disabled'}><span>${WD[dt.getDay()]}</span><b>${dt.getDate()}</b></button>`;
    }).join('')}</div><div class="hours">${hours}</div>`;
    ok = d.hour !== null;
  } else if (d.step === 3) {
    body = `<h2>3. Контакты и автомобиль</h2>
      <label class="field"><span>Номер телефона</span><input type="tel" inputmode="tel" maxlength="18" id="f-phone" placeholder="+7 (900) 000-00-00" value="${esc(formatPhone(d.phone))}"></label>
      <div id="garage">${garageChips()}</div>
      <label class="field"><span>Марка и модель автомобиля</span><input type="text" id="f-car" placeholder="Например, Toyota Camry" value="${esc(d.car)}"></label>
      <label class="field"><span>Пожелания <span class="opt">необязательно</span></span><textarea id="f-comment" rows="2" maxlength="500" placeholder="Например: запах в салоне, скол на капоте">${esc(d.comment || '')}</textarea></label>
      <div class="field"><span class="flabel">Фото повреждений <span class="opt">до 3, необязательно</span></span>
        <div class="thumbs" id="f-thumbs">${draftThumbs(d)}</div>
        <label class="btn sm file-btn">${ico('car')}Добавить фото<input type="file" id="f-photos" accept="image/*" multiple hidden></label></div>`;
  } else {
    const t = totals(d.services);
    body = `<h2>4. Проверьте запись</h2><div class="card glass">
      ${t.list.map((s) => `<div class="row" style="padding:3px 0"><span>${esc(s.name)}</span><span>${s.price === null ? 'по телефону' : money(s.price)}</span></div>`).join('')}
      <div class="lines">${t.discount ? `<div class="row muted"><span>Скидка ${state.promo.percent}%</span><span>−${money(t.discount)}</span></div>` : ''}
      <div class="row total"><span>Итого</span><span>${money(t.total)}${t.unknown ? ' + по телефону' : ''}</span></div></div></div>
      <div class="card glass summary"><p class="meta">${ico('ticket')}${fmtDay(d.date)}, ${pad(d.hour)}:00</p><p class="meta">${ico('car')}${esc(d.car)}</p><p class="meta">${ico('phone')}${esc(formatPhone(d.phone))}</p><p class="meta">${ico('pin')}${CENTER.address}</p>
        ${d.comment ? `<p class="comment">«${esc(d.comment)}»</p>` : ''}${d.files?.length ? `<p class="meta">Фото: ${d.files.length}</p>` : ''}</div>
      ${state.sched.cancelHours ? `<p class="muted small">Отменить или перенести запись онлайн можно не позже чем за ${state.sched.cancelHours} ${hoursWord(state.sched.cancelHours)} до начала.</p>` : ''}`;
    next = 'Записаться';
  }
  const sheet = $('#sheet');
  const keep = sheet.hidden ? null : { top: sheet.querySelector('.panel')?.scrollTop || 0, left: sheet.querySelector('.dates')?.scrollLeft || 0 };
  if (sheet.hidden) { sheet.classList.add('opening'); setTimeout(() => sheet.classList.remove('opening'), 500); }
  sheet.hidden = false;
  sheet.innerHTML = `<div class="panel glass">${dots}<div class="step-body">${body}</div>
    <div class="actions">${d.step > 1 ? '<button class="btn" data-act="back">Назад</button>' : '<button class="btn" data-act="close">Закрыть</button>'}
    <button class="btn primary" data-act="next" ${ok ? '' : 'disabled'}>${next}</button></div></div>`;
  // анимация только при смене шага, а не при выборе даты или услуги
  if (renderSheet.last !== d.step) {
    sheet.querySelector('.step-body').classList.add(d.step >= (renderSheet.prev || 1) ? 'to-next' : 'to-prev');
  }
  renderSheet.prev = d.step; renderSheet.last = d.step;
  if (keep) {
    sheet.querySelector('.panel').scrollTop = keep.top;
    const ds = sheet.querySelector('.dates'); if (ds) ds.scrollLeft = keep.left;
  }
}

// «мой гараж»: сохранённые машины кнопками над полем
function garageChips() {
  if (!state.cars.length) return '';
  return `<p class="flabel">Мой гараж</p><div class="chips garage">${state.cars.map((c) => `<span class="chip car-chip"><button class="car-pick" data-act="car-pick" data-id="${esc(c.title)}">${esc(c.title)}</button><button class="car-del" data-act="car-del" data-id="${c.id}" aria-label="Удалить ${esc(c.title)}">×</button></span>`).join('')}</div>`;
}
function draftThumbs(d) {
  return (d.files || []).map((f, i) => `<span class="thumb"><img src="${URL.createObjectURL(f)}" alt="Фото ${i + 1}"><button data-act="photo-del" data-id="${i}" aria-label="Убрать фото">×</button></span>`).join('');
}
function nextStep() {
  const d = state.draft;
  if (d.step === 3) {
    d.phone = $('#f-phone').value.trim(); d.car = $('#f-car').value.trim(); d.comment = $('#f-comment').value.trim();
    if (phoneDigits(d.phone).length < 10) return fieldError('f-phone', 'Введите номер полностью: 10 цифр после +7');
    if (d.car.length < 2) return fieldError('f-car', 'Укажите марку и модель автомобиля');
  }
  if (d.step === 4) return confirmBooking();
  d.step++; renderSheet();
}

async function confirmBooking() {
  const d = state.draft;
  if (!state.user) { state.pendingDraft = d; authSheet('login'); return toast('Войдите, чтобы записаться'); }
  if (state.busy) return;
  const t = totals(d.services);
  state.busy = true; $('[data-act="next"]').disabled = true;
  try {
    const items = t.list.map((s) => ({ id: s.id, name: s.name, price: s.price }));
    const photos = d.files?.length ? await api.uploadPhotos(d.files, state.user.id) : [];
    const created = await api.addBooking({ userName: state.user.name, phone: phoneDigits(d.phone), car: d.car, services: d.services, items, date: d.date, hour: d.hour, discount: t.discount, total: t.total, comment: d.comment, photos });
    // машину — в «мой гараж», чтобы в следующий раз выбрать одним нажатием
    if (!state.cars.some((c) => c.title.toLowerCase() === d.car.toLowerCase())) api.addCar(d.car).then(() => api.cars()).then((c) => { state.cars = c; }).catch(() => {});
    state.bookings.push(created);
    state.cart = []; updateCart();
    closeSheet();
    await refreshCounts().catch(() => {});
    state.tab = 'mine';
    render(); window.scrollTo(0, 0);
    if (created.total > 0) paySheet(created); else toast('Запись создана');
  } catch (e) {
    toast(errText(e));
    if (/slot_full/.test(e.message)) { await refreshCounts().catch(() => {}); d.step = 2; d.hour = null; renderSheet(); }
    else { const b = $('[data-act="next"]'); if (b) b.disabled = false; }
  } finally { state.busy = false; }
}

// предложение оплатить сразу после записи
function paySheet(b) {
  const sheet = $('#sheet');
  sheet.classList.add('opening'); setTimeout(() => sheet.classList.remove('opening'), 500);
  sheet.hidden = false;
  sheet.innerHTML = `<div class="panel glass"><div class="step-body to-next"><h2>Запись создана</h2>
    <p class="muted" style="margin-bottom:14px">${fmtDay(b.date)}, ${pad(b.hour)}:00. Оплатить можно сейчас онлайн или позже, в разделе «Моя запись».</p>
    <a class="btn pay block" href="${payUrl(b)}" target="_blank" rel="noopener" data-pay="${b.id}" data-act="close">Оплатить ${money(b.total)}</a>
    <button class="btn block" data-act="ics" data-id="${b.id}" style="margin-top:10px">${ico('ticket')}Добавить в календарь</button>
    <div class="actions"><button class="btn" data-act="close">Оплатить позже</button></div></div></div>`;
}

// ---------- вход и регистрация ----------
function authSheet(mode) {
  state.authMode = mode;
  const reg = mode === 'register';
  const sheet = $('#sheet');
  if (sheet.hidden) { sheet.classList.add('opening'); setTimeout(() => sheet.classList.remove('opening'), 500); }
  sheet.hidden = false;
  sheet.innerHTML = `<div class="panel glass"><div class="step-body to-next"><h2>${reg ? 'Регистрация' : 'Вход'}</h2>
    <p class="muted small" style="margin-bottom:14px">${reg ? 'Создайте аккаунт, чтобы записываться и оставлять отзывы.' : 'Войдите в свой аккаунт.'}</p>
    ${reg ? '<label class="field"><span>Имя</span><input type="text" id="a-name" placeholder="Как к вам обращаться"></label>' : ''}
    <label class="field"><span>Телефон</span><input type="tel" inputmode="tel" maxlength="18" id="a-phone" placeholder="+7 (900) 000-00-00"></label>
    <label class="field"><span>Пароль</span><input type="password" id="a-pass" placeholder="Не короче 6 символов" autocomplete="${reg ? 'new-password' : 'current-password'}"></label>
    ${reg ? '<label class="field"><span>Повторите пароль</span><input type="password" id="a-pass2" placeholder="Ещё раз пароль" autocomplete="new-password"></label>' : ''}
    <div class="actions"><button class="btn" data-act="close">Закрыть</button><button class="btn primary" data-act="${reg ? 'register-ok' : 'login-ok'}">${reg ? 'Создать аккаунт' : 'Войти'}</button></div>
    <p class="auth-switch">${reg ? 'Уже есть аккаунт?' : 'Нет аккаунта?'} <a href="#" data-act="auth-switch">${reg ? 'Войти' : 'Зарегистрироваться'}</a></p></div></div>`;
}
function loginSheet() { authSheet('login'); }

// после входа подгружаем записи и возвращаем клиента к незавершённой записи
async function afterAuth(u, msg) {
  setUser(u);
  await loadPrivate().catch((e) => toast(errText(e)));
  await refreshCounts().catch(() => {});
  closeSheet(); render(); toast(msg);
  if (state.pendingDraft) { state.draft = state.pendingDraft; state.pendingDraft = null; renderSheet.last = null; renderSheet(); }
  else askShut();
}

async function withBusy(btn, fn) {
  if (state.busy) return;
  state.busy = true; if (btn) btn.disabled = true;
  try { await fn(); } catch (e) { toast(errText(e)); } finally { state.busy = false; if (btn && btn.isConnected) btn.disabled = false; }
}

function doLogin(btn) {
  const phone = phoneDigits($('#a-phone').value), pass = $('#a-pass').value;
  if (phone.length < 10) return fieldError('a-phone', 'Введите номер полностью: 10 цифр после +7');
  if (!pass) return fieldError('a-pass', 'Введите пароль');
  return withBusy(btn, async () => {
    let u; try { u = await api.signIn(phone, pass); } catch (e) { return formError(errText(e)); }
    await afterAuth(u, 'Вы вошли');
  });
}
function doRegister(btn) {
  const name = $('#a-name').value.trim(), phone = phoneDigits($('#a-phone').value);
  const pass = $('#a-pass').value, pass2 = $('#a-pass2').value;
  if (!name) return fieldError('a-name', 'Введите имя');
  if (phone.length < 10) return fieldError('a-phone', 'Введите номер полностью: 10 цифр после +7');
  if (pass.length < 6) return fieldError('a-pass', 'Пароль должен быть не короче 6 символов');
  if (pass !== pass2) return fieldError('a-pass2', 'Пароли не совпадают');
  return withBusy(btn, async () => {
    let u; try { u = await api.signUp(name, phone, pass); } catch (e) { return formError(errText(e)); }
    await afterAuth(u, 'Аккаунт создан');
  });
}

// ---------- события ----------
document.addEventListener('click', (e) => {
  if (!e.target.closest('.profile')) closeProfile();
  const el = e.target.closest('[data-act]'); if (!el) return;
  if (el.tagName === 'INPUT') return;
  const a = el.dataset.act, id = el.dataset.id, d = state.draft;
  if (el.tagName === 'A' && el.getAttribute('href') === '#') e.preventDefault();
  const findB = () => state.bookings.find((x) => x.id === Number(id));

  const actions = {
    tab: () => {
      if (id === state.tab) return window.scrollTo({ top: 0, behavior: 'smooth' });
      const dir = TABS.indexOf(id) - TABS.indexOf(state.tab);
      state.tab = id; window.scrollTo(0, 0); render(dir);
    },
    day: () => {
      // лента дат не перерисовывается: меняем только подсветку и календарь
      state.day = id;
      document.querySelectorAll('.dates .date').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
      $('.slots').outerHTML = slotsBlock(' anim');
      const od = $('#owner-day'); if (od) od.innerHTML = ownerDayBar();
    },
    slot: () => openBooking({ date: state.day, hour: Number(el.dataset.h) }),
    repeat: () => { const b = findB(); openBooking({ services: b.services, car: b.car, phone: b.phone }); },
    hero: () => openBooking({ date: el.dataset.date, hour: Number(el.dataset.h) }),
    book: () => openBooking({ service: id ? Number(id) : null }),
    close: () => { state.pendingDraft = null; closeSheet(); },
    'cart-toggle': () => {
      const n = Number(id);
      state.cart = state.cart.includes(n) ? state.cart.filter((x) => x !== n) : [...state.cart, n];
      updateCart();
    },
    cart: () => openBooking({ services: state.cart, step: 1 }),
    back: () => { d.step--; renderSheet(); },
    next: nextStep,
    pick: () => { const n = Number(id); d.services = d.services.includes(n) ? d.services.filter((x) => x !== n) : [...d.services, n]; renderSheet(); },
    sdate: () => {
      d.date = id; d.hour = null;
      document.querySelectorAll('.panel .date').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
      $('.panel .hours').innerHTML = hoursGrid(d);
      $('[data-act="next"]').disabled = true;
    },
    hour: () => {
      d.hour = Number(el.dataset.h);
      document.querySelectorAll('.panel .hours .btn').forEach((b) => b.classList.toggle('on', Number(b.dataset.h) === d.hour));
      $('[data-act="next"]').disabled = false;
    },
    cancel: () => {
      const cb = findB();
      const msg = cb.paid
        ? (state.owner ? `Запись оплачена (${money(cb.total)}). После отмены нужно будет вернуть деньги клиенту. Отменить?`
          : `Запись оплачена. После отмены владелец вернёт вам ${money(cb.total)} — с вами свяжутся. Отменить запись?`)
        : 'Отменить запись?';
      if (!confirm(msg)) return;
      withBusy(null, async () => {
        await api.cancelBooking(Number(id));
        cb.status = 'cancelled';
        if (cb.paid) cb.refund = 'pending';
        await refreshCounts().catch(() => {});
        closeSheet(); render(); toast('Запись отменена');
      });
    },
    confirm: () => withBusy(el, async () => {
      const b = findB(), status = b.status === 'wait' ? 'ok' : 'done';
      await api.setStatus(b.id, status);
      b.status = status; closeSheet(); render();
    }),
    paid: () => withBusy(el, async () => {
      await api.markPaid(Number(id));
      findB().paid = true; closeSheet(); render(); toast('Оплата подтверждена');
    }),
    'owner-booking': () => ownerBookingSheet(Number(id)),
    oview: () => { state.ownerView = id; render(); window.scrollTo(0, 0); },
    export: () => exportCsv(),
    speriod: () => { state.statsPeriod = Number(id); render(); },
    client: () => { state.ownerView = 'records'; state.ownerFilter = 'all'; state.ownerQuery = id; render(); window.scrollTo(0, 0); },
    work: () => withBusy(el, async () => {
      const b = findB(), ws = el.dataset.ws;
      await api.setWork(b.id, ws);
      b.workStatus = ws; closeSheet(); render();
      toast(ws === 'ready' ? 'Клиент увидит: «Машина готова — можно забирать»' : 'Статус: машина в работе');
    }),
    noshow: () => {
      if (!confirm('Отметить, что клиент не пришёл? Запись будет закрыта, у клиента появится отметка о неявке.')) return;
      withBusy(el, async () => {
        const b = findB();
        await api.setNoShow(b.id);
        b.status = 'cancelled'; b.noShow = true;
        await refreshCounts().catch(() => {});
        closeSheet(); render(); toast('Отмечена неявка');
      });
    },
    'car-pick': () => { const f = $('#f-car'); if (f) { f.value = id; clearErrors(); } },
    'car-del': () => withBusy(null, async () => {
      await api.delCar(Number(id));
      state.cars = state.cars.filter((c) => c.id !== Number(id));
      const g = $('#garage'); if (g) g.innerHTML = garageChips();
    }),
    'photo-del': () => { d.files.splice(Number(id), 1); $('#f-thumbs').innerHTML = draftThumbs(d); },
    refunded: () => withBusy(el, async () => {
      await api.setRefunded(Number(id));
      findB().refund = 'done';
      closeSheet(); render(); toast('Возврат отмечен');
    }),
    move: () => moveSheet(Number(id)),
    mdate: () => {
      const m = state.move; m.date = id; m.hour = null;
      document.querySelectorAll('.panel .date').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
      $('.panel .hours').innerHTML = hoursGrid(m, 'mhour', m.from);
      $('[data-act="move-ok"]').disabled = true;
    },
    mhour: () => {
      const m = state.move; m.hour = Number(el.dataset.h);
      document.querySelectorAll('.panel .hours .btn').forEach((b) => b.classList.toggle('on', Number(b.dataset.h) === m.hour));
      $('[data-act="move-ok"]').disabled = false;
    },
    'move-ok': () => withBusy(el, async () => {
      const m = state.move, b = state.bookings.find((x) => x.id === m.id);
      await api.reschedule(m.id, m.date, m.hour);
      b.date = m.date; b.hour = m.hour;
      if (!state.owner) b.status = 'wait';
      await refreshCounts().catch(() => {});
      closeSheet(); render(); toast('Запись перенесена');
    }),
    'install-x': () => { try { localStorage.setItem('gml_install_hidden', '1'); } catch {} render(); },
    install: () => {
      // Android (Chrome): системное окно установки
      if (installPrompt) { installPrompt.prompt(); installPrompt.userChoice.catch(() => {}).finally(() => { installPrompt = null; }); return; }
      // iPhone: сразу открываем меню «Поделиться», в нём есть пункт «На экран Домой» (работает только по https)
      if (isIOS() && navigator.share) {
        installSheet(true);
        navigator.share({ title: 'GML Detailing', url: location.href.split('#')[0] }).catch(() => {});
        return;
      }
      installSheet();
    },
    ofilter: () => {
      state.ownerFilter = id;
      $('#ochips').innerHTML = ownerChips();
      $('#otable').innerHTML = ownerTable(); updateSoon();
    },
    sched: () => { state.schedDraft = null; schedSheet(); },
    'sched-cancel': () => { state.schedDraft = null; closeSheet(); },
    'sched-adddate': () => {
      const v = $('#sched-date').value; if (!v) return fieldError('sched-date', 'Выберите дату');
      const g = readSched(); if (!g.closed.includes(v)) g.closed.push(v); schedSheet();
    },
    'sched-undate': () => { const g = readSched(); g.closed = g.closed.filter((k) => k !== id); schedSheet(); },
    'sched-save': () => {
      const g = readSched();
      const bad = g.schedule.some((d) => d && d.close <= d.open);
      if (bad) return formError('Время закрытия должно быть позже открытия');
      withBusy(el, async () => {
        await api.saveSchedule(g);
        state.sched = g; state.schedDraft = null;
        if (!dayHours(state.day)) state.day = firstOpenDay();
        await refreshCounts().catch(() => {});
        closeSheet(); render(); toast('График сохранён');
      });
    },
    ics: () => addToCalendar(state.bookings.find((x) => x.id === Number(id))),
    rate2: () => {
      state.rateStars = Number(id);
      document.querySelectorAll('#rate2 button').forEach((b, i) => b.classList.toggle('on', i < state.rateStars));
    },
    'rate-send': () => withBusy(el, async () => {
      const text = $('#rtext2').value.trim();
      state.reviews.push(await api.addReview(state.user.name, state.rateStars || 5, text, state.user.color));
      closeSheet(); render(); toast('Спасибо за оценку!');
    }),
    'svc-new': () => serviceSheet(null),
    'svc-hide': () => withBusy(el, async () => {
      const sv = state.services.find((x) => x.id === Number(id));
      await api.hideService(sv.id, !sv.hidden);
      sv.hidden = !sv.hidden; render(); toast(sv.hidden ? 'Услуга скрыта от клиентов' : 'Услуга снова видна клиентам');
    }),
    'svc-edit': () => serviceSheet(Number(id)),
    'svc-save': () => saveServiceFromSheet(el),
    'svc-del': () => {
      if (!confirm('Удалить услугу? В уже сделанных записях она останется.')) return;
      withBusy(el, async () => {
        await api.deleteService(Number(id));
        state.services = await api.services();
        state.cart = state.cart.filter((x) => x !== Number(id)); updateCart();
        closeSheet(); render(); toast('Услуга удалена');
      });
    },
    'owner-slot': () => ownerSlotSheet(Number(el.dataset.h)),
    'hour-close': () => withBusy(el, async () => {
      const h = Number(el.dataset.h), s = slotInfo(state.day, h);
      if (s.free > 0) await api.addBlocks(state.day, h, s.free);
      await afterBlock(`${pad(h)}:00 закрыто для записи`);
    }),
    'hour-open': () => withBusy(el, async () => {
      const h = Number(el.dataset.h);
      await api.delBlocksAt(state.day, h);
      await afterBlock(`${pad(h)}:00 снова открыто`);
    }),
    'day-close': () => {
      const k = state.day;
      const n = state.bookings.filter((b) => b.date === k && (b.status === 'wait' || b.status === 'ok')).length;
      if (!confirm(`Закрыть ${fmtDay(k)} для записи?${n ? `\nНа этот день записей: ${n}. Клиенты увидят просьбу перенести или отменить запись (оплаченные при отмене попадут в возвраты).` : ''}`)) return;
      withBusy(el, async () => {
        const g = { ...state.sched, closed: [...state.sched.closed, k] };
        await api.saveSchedule(g); state.sched = g;
        render(); toast('День закрыт для записи');
      });
    },
    'day-open': () => withBusy(el, async () => {
      const g = { ...state.sched, closed: state.sched.closed.filter((x) => x !== state.day) };
      await api.saveSchedule(g); state.sched = g;
      await refreshCounts().catch(() => {});
      render(); toast('День снова открыт');
    }),
    'block-add': () => withBusy(el, async () => {
      await api.addBlock(state.day, Number(el.dataset.h));
      await afterBlock('Бронь поставлена');
    }),
    'block-del': () => withBusy(el, async () => {
      const blk = state.blocks.find((x) => x.date === state.day && x.hour === Number(el.dataset.h));
      if (blk) await api.delBlock(blk.id);
      await afterBlock('Бронь снята');
    }),
    reply: () => replySheet(Number(id)),
    'reply-send': () => withBusy(el, async () => {
      const text = $('#r-reply').value.trim() || null;
      await api.replyReview(Number(id), text);
      state.reviews.find((r) => r.id === Number(id)).reply = text;
      closeSheet(); render(); toast('Ответ сохранён');
    }),
    'promo-toggle': () => withBusy(el, async () => {
      state.promo.on = !state.promo.on;
      await api.saveSettings(state.promo); render();
    }),
    login: loginSheet,
    register: () => authSheet('register'),
    'login-ok': () => doLogin(el),
    'register-ok': () => doRegister(el),
    'auth-switch': () => authSheet(state.authMode === 'login' ? 'register' : 'login'),
    retry: async () => {
      state.loaded = false; render();
      try { if (!state.user) setUser(await withTimeout(api.session(), 10000)); } catch {}
      await reloadAll(); render();
    },
    'avatar-color': () => withBusy(null, async () => {
      await api.setColor(id);
      state.user.color = id;
      state.reviews = await api.reviews();
      render();
      document.querySelector('.profile-btn')?.click(); // меню остаётся открытым, видно новый цвет
    }),
    profile: () => {
      const m = el.nextElementSibling, open = m.hidden;
      m.hidden = !open; el.setAttribute('aria-expanded', String(open));
    },
    logout: async () => {
      await api.signOut();
      setUser(null); state.bookings = []; state.blocks = [];
      await refreshCounts().catch(() => {});
      render(); toast('Вы вышли');
    },
    rate: () => { state.draftRating = Number(id); const t = $('#rtext')?.value; render(); if (t) $('#rtext').value = t; },
    'review-send': () => {
      const text = $('#rtext').value.trim(); if (text.length < 3) return fieldError('rtext', 'Напишите хотя бы пару слов');
      withBusy(el, async () => {
        state.reviews.push(await api.addReview(state.user.name, state.draftRating || 5, text, state.user.color));
        state.draftRating = 5; render(); toast('Спасибо за отзыв');
      });
    },
  };
  actions[a]?.();
});

// поиск и поля владельца не перерисовывают весь экран, чтобы не терять фокус
let promoTimer;
document.addEventListener('input', (e) => {
  const el = e.target;
  // полоска оттенков: аватар перекрашивается сразу, пока ведёте кружок
  if (el.classList.contains('hue')) {
    const c = hueHex(Number(el.value)), av = document.querySelector('.profile-btn .avatar');
    const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
    if (av) { av.style.background = c; av.style.color = 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#0d0f13' : '#fff'; }
    document.querySelectorAll('.swatch.on').forEach((s) => s.classList.remove('on'));
    return;
  }
  if (el.classList.contains('invalid')) { el.classList.remove('invalid'); el.removeAttribute('aria-invalid'); el.nextElementSibling?.classList.contains('field-err') && el.nextElementSibling.remove(); }
  if (el.type === 'tel') {
    let d = phoneDigits(el.value);
    // стирание символа маски должно стирать цифру, а не возвращать скобку
    if (e.inputType && e.inputType.startsWith('delete') && d.length === (el._digits || '').length) d = d.slice(0, -1);
    el._digits = d;
    el.value = formatPhone(d);
    return;
  }
  if (el.id === 'csearch') {
    state.clientQuery = el.value;
    $('#ctable').innerHTML = clientsRows();
    return;
  }
  if (el.id === 'osearch') {
    state.ownerQuery = el.value;
    $('#otable').innerHTML = ownerTable(); updateSoon();
    return;
  }
  if (el.id === 'search') {
    state.query = el.value;
    $('#svc-list').innerHTML = svcCards();
    return;
  }
  if (el.dataset.act === 'promo-percent') state.promo.percent = Math.max(0, Math.min(90, Number(el.value.replace(/\D/g, '')) || 0));
  else if (el.dataset.act === 'promo-text') state.promo.text = el.value;
  else return;
  // сохраняем акцию на сервер через секунду после последнего нажатия
  clearTimeout(promoTimer);
  promoTimer = setTimeout(() => api.saveSettings(state.promo).catch((err) => toast(errText(err))), 800);
});

// нижняя панель прячется при прокрутке вниз и возвращается при прокрутке вверх
let lastY = 0;
window.addEventListener('scroll', () => {
  const y = Math.max(0, window.scrollY), dy = y - lastY;
  const nearEnd = window.innerHeight + y >= document.documentElement.scrollHeight - 40;
  if (Math.abs(dy) < 6) return;
  const hide = dy > 0 && y > 60 && !nearEnd;
  $('#tabs').classList.toggle('hide', hide);
  $('#cart').classList.toggle('low', hide);
  lastY = y;
}, { passive: true });

// ---------- окна владельца и подтверждение оплаты ----------
function openSimple(html) {
  const s = $('#sheet');
  if (s.hidden) { s.classList.add('opening'); setTimeout(() => s.classList.remove('opening'), 500); }
  s.hidden = false;
  s.innerHTML = `<div class="panel glass"><div class="step-body to-next">${html}</div></div>`;
}
function ownerSlotSheet(h) {
  const s = slotInfo(state.day, h), booked = s.busy - s.hold;
  openSimple(`<h2>${fmtDay(state.day)}, ${pad(h)}:00</h2>
    <p class="muted" style="margin-bottom:14px">Записей клиентов: ${booked}. Закрыто вами: ${s.hold}. Свободно: ${s.free} из ${cap()}.</p>
    ${s.free > 0 ? `<button class="btn primary block" data-act="hour-close" data-h="${h}">Закрыть это время для записи</button>` : ''}
    ${s.hold > 0 ? `<button class="btn block" data-act="hour-open" data-h="${h}" style="margin-top:10px">Открыть это время</button>` : ''}
    ${booked && s.free > 0 ? '<p class="muted small" style="margin-top:8px">Уже записанные клиенты останутся.</p>' : ''}
    <div class="row stepper-row"><span class="muted small">Или по одному месту</span>
      <div class="stepper"><button class="btn sm" data-act="block-del" data-h="${h}" aria-label="Открыть одно место" ${s.hold <= 0 ? 'disabled' : ''}>−</button>
        <b>${s.hold}</b><button class="btn sm" data-act="block-add" data-h="${h}" aria-label="Закрыть одно место" ${s.free <= 0 ? 'disabled' : ''}>+</button></div></div>
    <div class="actions"><button class="btn" data-act="close">Готово</button></div>`);
}
// плашка владельца над календарём: закрыть или открыть весь выбранный день
function ownerDayBar() {
  if (!state.owner) return '';
  const k = state.day;
  if (!state.sched.schedule[parseDay(k).getDay()]) return '<p class="owner-day muted small">Выходной по графику. Изменить — кнопка «График» на странице записей.</p>';
  return state.sched.closed.includes(k)
    ? `<div class="owner-day row"><span>${fmtDay(k)} закрыт для записи</span><button class="btn sm" data-act="day-open">Открыть день</button></div>`
    : `<div class="owner-day row"><span class="muted small">Нажмите на час, чтобы закрыть его, или</span><button class="btn sm" data-act="day-close">Закрыть весь день</button></div>`;
}
async function afterBlock(msg) {
  state.blocks = await api.blocks();
  await refreshCounts();
  closeSheet();
  const sl = $('.slots'); if (sl) sl.outerHTML = slotsBlock('');
  toast(msg);
}
// ---------- владелец: услуги ----------
function serviceSheet(id) {
  const s = id ? state.services.find((x) => x.id === id) : { name: '', price: null, desc: '', img: '' };
  openSimple(`<h2>${id ? 'Изменить услугу' : 'Новая услуга'}</h2>
    <div class="svc-img" id="s-preview" style="${s.img ? `background-image:url('${esc(s.img)}')` : ''}">${s.img ? '' : '<span>Нет фото</span>'}</div>
    <label class="btn sm file-btn">Выбрать фото<input type="file" id="s-file" accept="image/*" hidden></label>
    <label class="field mt"><span>Название</span><input type="text" id="s-name" value="${esc(s.name)}" placeholder="Например, Мойка кузова"></label>
    <label class="field"><span>Цена, ₽ (пусто — «по телефону»)</span><input type="text" inputmode="numeric" id="s-price" value="${s.price ?? ''}" placeholder="по телефону"></label>
    <label class="field"><span>Описание</span><textarea id="s-desc" rows="4" placeholder="Что входит в услугу">${esc(s.desc)}</textarea></label>
    <div class="actions"><button class="btn" data-act="close">Закрыть</button><button class="btn primary" data-act="svc-save" data-id="${id || ''}">Сохранить</button></div>
    ${id ? `<button class="cancel-link" data-act="svc-del" data-id="${id}" style="display:block;margin:14px auto 0">Удалить услугу</button>` : ''}`);
}
function saveServiceFromSheet(btn) {
  const id = Number(btn.dataset.id) || null;
  const name = $('#s-name').value.trim();
  const priceRaw = $('#s-price').value.replace(/\D/g, '');
  const desc = $('#s-desc').value.trim();
  const file = $('#s-file').files[0] || null;
  if (name.length < 2) return fieldError('s-name', 'Введите название услуги');
  const old = id ? state.services.find((x) => x.id === id) : null;
  const sort = old ? old.sort : Math.max(0, ...state.services.map((x) => x.sort || 0)) + 1;
  return withBusy(btn, async () => {
    btn.textContent = 'Сохраняю…';
    try {
    await api.saveService({ id, name, price: priceRaw ? Number(priceRaw) : null, desc, img: old?.img || '', sort }, file);
    state.services = await api.services();
    closeSheet(); render(); toast(id ? 'Услуга сохранена' : 'Услуга добавлена');
    } finally { if (btn.isConnected) btn.textContent = 'Сохранить'; }
  });
}
// фото повреждений к записи: не больше трёх
document.addEventListener('change', (e) => {
  if (e.target.id !== 'f-photos' || !state.draft) return;
  const d = state.draft;
  const room = 3 - d.files.length;
  const add = [...e.target.files].filter((f) => f.type.startsWith('image/')).slice(0, room);
  if (e.target.files.length > room) toast('Можно прикрепить не больше 3 фото');
  d.files.push(...add);
  e.target.value = '';
  $('#f-thumbs').innerHTML = draftThumbs(d);
});
// график: включили или выключили рабочий день
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset?.act !== 'sched-day') return;
  const g = readSched(), i = Number(el.dataset.id);
  g.schedule[i] = el.checked ? (state.sched.schedule[i] || { open: 10, close: 21 }) : null;
  schedSheet();
});
// отпустили кружок на полоске — сохраняем выбранный оттенок
document.addEventListener('change', (e) => {
  if (!e.target.classList?.contains('hue')) return;
  const c = hueHex(Number(e.target.value));
  withBusy(null, async () => {
    await api.setColor(c);
    state.user.color = c;
    state.reviews = await api.reviews();
    render();
    document.querySelector('.profile-btn')?.click();
  });
});
// предпросмотр выбранного фото
document.addEventListener('change', (e) => {
  if (e.target.id !== 's-file' || !e.target.files[0]) return;
  const pv = $('#s-preview');
  pv.style.backgroundImage = `url('${URL.createObjectURL(e.target.files[0])}')`;
  pv.innerHTML = '';
});

function replySheet(id) {
  const r = state.reviews.find((x) => x.id === id);
  openSimple(`<h2>Ответ на отзыв</h2>
    <p class="muted small" style="margin-bottom:12px">${esc(r.name)}: ${esc(r.text)}</p>
    <textarea id="r-reply" rows="4" placeholder="Ваш ответ">${esc(r.reply || '')}</textarea>
    <div class="actions"><button class="btn" data-act="close">Закрыть</button><button class="btn primary" data-act="reply-send" data-id="${id}">Сохранить</button></div>`);
}
// после перехода по ссылке оплаты спрашиваем, оплатил ли клиент
document.addEventListener('click', (e) => {
  const p = e.target.closest('[data-pay]');
  if (p) state.payPending = Number(p.dataset.pay);
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  // вернулись на вкладку — обновляем занятость
  refreshCounts().then(() => { if (state.tab === 'home' && $('.slots')) $('.slots').outerHTML = slotsBlock(''); }).catch(() => {});
  if (!state.payPending) return;
  const id = state.payPending; state.payPending = null;
  if (state.bookings.find((b) => b.id === id)?.paid) return;
  openSimple(`<h2>Вы оплатили запись?</h2>
    <p class="muted" style="margin-bottom:14px">Подтвердите оплату, и появится надпись «Заказ оплачен».</p>
    <button class="btn pay block" data-act="paid" data-id="${id}">Да, оплатил(а)</button>
    <div class="actions"><button class="btn" data-act="close">Ещё нет</button></div>`);
});

// ---------- запуск ----------
(async () => {
  state.day = firstOpenDay();
  initTabs();
  render();
  try { setUser(await withTimeout(api.session(), 10000)); } catch (e) { setUser(null); }
  await reloadAll();
  if (!dayHours(state.day)) state.day = firstOpenDay(); // график из базы мог отличаться
  render();
  askShut();
  askRating();
})();
