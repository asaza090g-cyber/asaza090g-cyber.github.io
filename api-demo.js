// Демо-сервер: те же функции, что в api.js, но данные выдуманные и хранятся прямо в браузере.
// В интернет ничего не уходит, VPN не нужен. Кнопка «↺» возвращает исходные данные.
// Снаружи видны только errText и api, остальное спрятано внутри, чтобы имена не пересекались с app.js.

// ошибки → понятный текст (как в api.js)
function errText(e) {
  const m = (e && e.message) || '';
  if (/Invalid login credentials/i.test(m)) return 'Неверный телефон или пароль';
  if (/already registered/i.test(m)) return 'Этот телефон уже зарегистрирован';
  if (/Password should be/i.test(m)) return 'Пароль не короче 6 символов';
  if (/slot_full/.test(m)) return 'Это время уже заняли, выберите другое';
  if (/past_date/.test(m)) return 'Это время уже прошло';
  if (/day_closed/.test(m)) return `В этот день ${CONFIG.place} не работает`;
  if (/hour_closed/.test(m)) return `В это время ${CONFIG.place} ${CONFIG.placeFem ? 'закрыта' : 'закрыт'}`;
  if (/not_active/.test(m)) return 'Эту запись уже нельзя изменить';
  if (/too_late/.test(m)) return 'До записи осталось слишком мало времени — позвоните нам';
  if (/not_allowed/.test(m)) return 'Нет доступа';
  return 'Ошибка: ' + (m || 'попробуйте ещё раз');
}

const api = (() => {
  const DEMO_KEY = 'demo-' + CONFIG.id + '-v5';
  const DM = CONFIG.masters?.list || [];
  const OWNER = { id: 'owner', name: 'Владелец', phone: '9000000000', isOwner: true, color: null };
  const ME = { id: 'client', name: CONFIG.demoData.me, phone: '9001234567', isOwner: false, color: null };
  const NAMES = ['Алексей', 'Дмитрий', 'Иван', 'Сергей', 'Андрей', 'Максим', 'Артём', 'Никита', 'Михаил', 'Егор', 'Анна', 'Мария', 'Елена', 'Ольга', 'Наталья', 'Татьяна', 'Ирина', 'Екатерина', 'Дарья', 'Полина', 'Виктория', 'Ксения'];

  const two = (n) => String(n).padStart(2, '0');
  const dkey = (d) => d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  const dayFrom = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const pause = (ms = 60) => new Promise((r) => setTimeout(r, ms));
  // воспроизводимые «случайные» числа: в течение дня демо выглядит одинаково
  function rng(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- общее: кто и когда занят ----------
  const CLASSES = CONFIG.classes || [];
  const active = (b) => b.status === 'wait' || b.status === 'ok';
  const weekday = (date) => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };
  const durOfIds = (list, ids) => Math.max(1, ...ids.map((id) => list.find((s) => s.id === id)?.hours || 1));
  // запись занимает часы с hour по hour + dur − 1; записи в группы место у мастеров не занимают
  const covers = (b, date, hour) => active(b) && !b.classId && b.date === date && hour >= b.hour && hour < b.hour + (b.dur || 1);
  const teaching = (date, hour) => CLASSES.filter((c) => c.day === weekday(date) && c.hour === hour).map((c) => c.master);
  const inClass = (list, date, classId, skipId) => list.filter((b) => active(b) && b.classId === classId && b.date === date && b.id !== skipId).length;

  // ---------- исходные данные: записи за месяц назад и полторы недели вперёд ----------
  function seed() {
    const D = CONFIG.demoData, today = dkey(new Date());
    const r = rng(Number(today.replace(/-/g, '')) + CONFIG.id.length * 7919);
    const pick = (a) => a[Math.floor(r() * a.length)];
    const services = CONFIG.services.map((s, i) => ({ ...s, sort: i + 1, active: true, hidden: false }));
    // около 90 клиентов: имя + первая буква фамилии, чтобы визиты распределялись правдоподобно
    const clients = Array.from({ length: 90 }, (_, i) => ({ id: 'c' + i, name: pick(D.clients || NAMES) + ' ' + pick('АБВГДЕЗИКЛМНОПРСТФХЧШЯ'.split('')) + '.', phone: '9' + String(100000000 + Math.floor(r() * 899999999)) }));
    const cap = DM.length || CONFIG.capacity;
    const store = { day: today, seq: 1001, services, bookings: [], blocks: [], cars: { client: [] }, users: {}, session: null,
      settings: { promo: { ...D.promo }, schedule: clone(CONFIG.schedule), capacity: cap, closed: [], cancelHours: 3 },
      reviews: D.reviews.map((rv, i) => ({ id: i + 1, color: null, reply: null, ...rv, date: dkey(dayFrom(-(i * 6 + 2))) })) };
    const svc = (id) => services.find((s) => s.id === id);
    const canDo = (m, ids) => ids.every((id) => !svc(id).masters || svc(id).masters.includes(m.id));
    const nowH = new Date().getHours();
    const make = (date, hour, ids, who, extra) => {
      const items = ids.map((id) => ({ id, name: svc(id).name, price: svc(id).price }));
      const b = { id: store.seq++, userId: who.id, userName: who.name, phone: who.phone, car: CONFIG.car ? (extra.car || pick(D.cars)) : '',
        services: ids, items, date, hour, master: null, dur: 1, discount: 0, total: items.reduce((a, s) => a + (s.price || 0), 0),
        status: 'wait', paid: false, refund: null, comment: '', photos: [], workStatus: null, noShow: false, ...extra };
      store.bookings.push(b);
      return b;
    };
    // запись в свободное место на все её часы; null — если места нет
    function put(date, hour, ids, who, extra = {}) {
      const dur = durOfIds(services, ids), day = CONFIG.schedule[weekday(date)];
      if (!day || hour + dur > day.close) return null;
      const hours = Array.from({ length: dur }, (_, i) => hour + i);
      if (hours.some((h) => store.bookings.filter((b) => covers(b, date, h)).length >= cap)) return null;
      let master = null;
      if (DM.length) {
        const free = DM.filter((m) => canDo(m, ids) && hours.every((h) => !store.bookings.some((b) => covers(b, date, h) && b.master === m.id) && !teaching(date, h).includes(m.id)));
        if (!free.length) return null;
        master = pick(free).id;
      }
      return make(date, hour, ids, who, { ...extra, master, dur });
    }
    // запись в группу по расписанию
    function putClass(date, c, ids, who, extra = {}) {
      if (inClass(store.bookings, date, c.id) >= c.places) return null;
      return make(date, c.hour, ids, who, { ...extra, classId: c.id, master: c.master });
    }
    const single = services.filter((s) => !s.group), group = services.filter((s) => s.group);
    const randomServices = () => {
      const ids = [pick(single).id];
      if (!CLASSES.length && r() < 0.25) { const second = pick(single).id; if (second !== ids[0]) ids.push(second); }
      return ids;
    };
    const status = (n, h) => {
      const x = r(), past = n < 0 || (n === 0 && h < nowH - 1);
      return past
        ? (x < 0.88 ? { status: 'done', paid: r() < 0.75 } : x < 0.94 ? { status: 'cancelled' } : { status: 'cancelled', noShow: true })
        : n === 0 && h <= nowH ? (CONFIG.work ? { status: 'ok', paid: r() < 0.5, workStatus: h === nowH ? 'in_work' : 'ready' } : { status: h === nowH ? 'ok' : 'done', paid: true })
        : (x < 0.35 ? { status: 'wait' } : { status: 'ok', paid: r() < 0.4 });
    };
    const openDay = (from, step) => { for (let n = from; Math.abs(n) < 40; n += step) { const d = dayFrom(n); if (CONFIG.schedule[d.getDay()]) return d; } return dayFrom(from); };
    const classDay = (from, step) => { for (let n = from; Math.abs(n) < 40; n += step) { const d = dayFrom(n); const c = CLASSES.find((x) => x.day === d.getDay()); if (c) return [d, c]; } return null; };

    // свои записи демо-клиента: одна впереди, две в истории
    if (CLASSES.length) {
      const [d0, c0] = classDay(1, 1), [d1, c1] = classDay(-9, -1), [d2, c2] = classDay(-16, -1);
      putClass(dkey(d0), c0, [group[0].id], ME);
      putClass(dkey(d1), c1, [group[0].id], ME, { status: 'done', paid: true });
      putClass(dkey(d2), c2, [group[1].id], ME, { status: 'done', paid: true });
    } else {
      const next = openDay(1, 1), nextS = CONFIG.schedule[next.getDay()];
      put(dkey(next), Math.min(nextS.open + 3, nextS.close - durOfIds(services, [services[0].id])), [services[0].id], ME, { car: CONFIG.car ? D.cars[0] : '' });
      const p1 = openDay(-12, -1), p1s = CONFIG.schedule[p1.getDay()];
      put(dkey(p1), p1s.open + 2, [services[1].id], ME, { status: 'done', paid: true, car: CONFIG.car ? D.cars[0] : '' });
      const p2 = openDay(-31, -1), p2s = CONFIG.schedule[p2.getDay()];
      put(dkey(p2), p2s.open + 4, [services[0].id], ME, { status: 'done', paid: true, car: CONFIG.car ? D.cars[0] : '' });
    }

    for (let n = -35; n <= 10; n++) {
      const day = dayFrom(n), date = dkey(day), s = CONFIG.schedule[day.getDay()];
      if (!s) continue;
      // группы: в прошлом почти полные, впереди — заполняются
      for (const c of CLASSES.filter((x) => x.day === day.getDay())) {
        const want = Math.round(c.places * (n < 0 ? 0.55 + r() * 0.4 : Math.max(0.15, 0.7 - n * 0.06 + r() * 0.2)));
        for (let k = 0; k < want; k++) {
          const ids = [r() < 0.2 ? group[0].id : pick(group).id];
          putClass(date, c, ids, pick(clients), status(n, c.hour));
        }
      }
      if (!single.length) continue;
      // многочасовые брони занимают больше места — выдуманных записей делаем меньше
      const avgDur = single.reduce((x, sv) => x + (sv.hours || 1), 0) / single.length;
      const fill = (CLASSES.length ? 0.35 : 1) / avgDur * (n < 0 ? 0.3 : n === 0 ? 0.4 : Math.max(0.08, 0.36 - n * 0.03));
      for (let h = s.open; h < s.close; h++) {
        for (let k = 0; k < cap; k++) {
          if (r() > fill) continue;
          const extra = status(n, h);
          if (r() < 0.15) extra.comment = pick(D.comments);
          put(date, h, randomServices(), pick(clients), extra);
        }
      }
    }
    return store;
  }

  let store;
  try { store = JSON.parse(localStorage.getItem(DEMO_KEY)); } catch { store = null; }
  if (!store || store.day !== dkey(new Date())) { store = seed(); save(); }
  function save() { try { localStorage.setItem(DEMO_KEY, JSON.stringify(store)); } catch {} }

  // ---------- проверки, как на настоящем сервере ----------
  const findB = (id) => store.bookings.find((b) => b.id === id);
  const svcOf = (id) => store.services.find((s) => s.id === id);
  const masterCan = (m, ids) => ids.every((id) => !svcOf(id)?.masters || svcOf(id).masters.includes(m.id));
  const startOf = (b) => { const [y, m, d] = b.date.split('-').map(Number); return new Date(y, m - 1, d, b.hour).getTime(); };
  const dayProblem = (date, hour) => {
    const s = store.settings, now = new Date(), today = dkey(now);
    if (date < today || (date === today && hour <= now.getHours())) return 'past_date';
    if (s.closed.includes(date) || !s.schedule[weekday(date)]) return 'day_closed';
    return null;
  };
  // свободные мастера на все часы записи
  const freeMasters = (date, hours, ids, skipId) => DM.filter((x) => masterCan(x, ids)
    && hours.every((h) => !store.bookings.some((b) => b.id !== skipId && covers(b, date, h) && b.master === x.id) && !teaching(date, h).includes(x.id)));
  function slotProblem(date, hour, master, ids, skipId, dur = 1) {
    const p = dayProblem(date, hour); if (p) return p;
    const s = store.settings, day = s.schedule[weekday(date)];
    if (hour < day.open || hour + dur > day.close) return 'hour_closed';
    const hours = Array.from({ length: dur }, (_, i) => hour + i);
    for (const h of hours) {
      const busy = store.bookings.filter((b) => b.id !== skipId && covers(b, date, h)).length;
      const held = store.blocks.filter((b) => b.date === date && b.hour === h).length;
      if (busy + held >= (DM.length || s.capacity)) return 'slot_full';
    }
    if (DM.length) {
      const fit = freeMasters(date, hours, ids, skipId);
      const any = DM.some((x) => masterCan(x, ids));
      if (master ? !fit.some((x) => x.id === master) : any && !fit.length) return 'slot_full';
    }
    return null;
  }
  function classProblem(date, classId, skipId) {
    const c = CLASSES.find((x) => x.id === classId);
    if (!c || c.day !== weekday(date)) return 'hour_closed';
    return dayProblem(date, c.hour) || (inClass(store.bookings, date, classId, skipId) >= c.places ? 'slot_full' : null);
  }
  const tooLate = (b) => store.settings.cancelHours > 0 && startOf(b) - Date.now() < store.settings.cancelHours * 3600000;
  function shut(b) {
    const day = store.settings.schedule[weekday(b.date)];
    return store.settings.closed.includes(b.date) || !day || b.hour < day.open || b.hour >= day.close;
  }
  function canChange(b) {
    const me = store.session;
    if (!b || !me || !(me.isOwner || b.userId === me.id)) throw new Error('not_allowed');
    if (!active(b)) throw new Error('not_active');
    if (!me.isOwner && tooLate(b) && !shut(b)) throw new Error('too_late');
  }

  // фото уменьшается в браузере и хранится вместе с демо-данными
  function toDataUrl(file, maxW) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const w = Math.min(maxW, img.width), h = Math.round((img.height * w) / img.width);
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = () => reject(new Error('Не удалось открыть фото'));
      img.src = URL.createObjectURL(file);
    });
  }


  return {
    // ---------- вход ----------
    async session() { return store.session ? clone(store.session) : null; },
    async demoLogin(role) { store.session = role === 'owner' ? { ...OWNER } : { ...ME, ...(store.users[ME.phone] || {}) }; save(); return clone(store.session); },
    demoReset() { try { localStorage.removeItem(DEMO_KEY); } catch {} },
    async signUp(name, phone, pass) {
      await pause();
      if (pass.length < 6) throw new Error('Password should be at least 6 characters');
      if (store.users[phone] || phone === OWNER.phone || phone === ME.phone) throw new Error('User already registered');
      store.users[phone] = { id: 'u' + phone, name, phone, isOwner: false, color: null };
      store.session = store.users[phone]; save();
      return clone(store.session);
    },
    async signIn(phone, pass) {
      await pause();
      if (pass.length < 6) throw new Error('Invalid login credentials');
      // в демо подходит любой номер: незнакомый сразу становится новым клиентом
      store.session = phone === OWNER.phone ? { ...OWNER } : phone === ME.phone ? { ...ME } : store.users[phone] || (store.users[phone] = { id: 'u' + phone, name: 'Гость', phone, isOwner: false, color: null });
      save();
      return clone(store.session);
    },
    async signOut() { store.session = null; save(); },
    async setColor(c) {
      store.session.color = c;
      if (store.users[store.session.phone]) store.users[store.session.phone].color = c;
      store.reviews.filter((r) => r.name === store.session.name).forEach((r) => { r.color = c; });
      save();
    },

    // ---------- настройки ----------
    async settings() { const s = store.settings; return clone({ promo: s.promo, schedule: s.schedule, capacity: s.capacity, closed: s.closed, cancelHours: s.cancelHours }); },
    async saveSchedule(g) { await pause(); Object.assign(store.settings, clone({ schedule: g.schedule, capacity: g.capacity, closed: g.closed, cancelHours: g.cancelHours ?? store.settings.cancelHours })); save(); },
    async saveSettings(p) { store.settings.promo = clone(p); save(); },

    // ---------- отзывы ----------
    async reviews() { return clone(store.reviews); },
    async addReview(name, rating, text, color) {
      await pause();
      const r = { id: Math.max(0, ...store.reviews.map((x) => x.id)) + 1, name, rating, text, reply: null, color: color || null, date: dkey(new Date()) };
      store.reviews.push(r); save();
      return clone(r);
    },
    async replyReview(id, reply) { store.reviews.find((r) => r.id === id).reply = reply; save(); },

    // ---------- занятость и записи ----------
    async counts(d1, d2) {
      const map = {}, me = store.session?.id;
      const slot = (k) => map[k] || (map[k] = { booked: 0, held: 0, mine: 0, masters: [], cls: {} });
      store.bookings.forEach((b) => {
        if (!active(b) || b.date < d1 || b.date > d2) return;
        // запись в группу: считаем места в группе, а не у мастеров
        if (b.classId) { const s = slot(b.date + '|' + b.hour); s.cls[b.classId] = (s.cls[b.classId] || 0) + 1; if (me && b.userId === me) s.mine++; return; }
        for (let h = b.hour; h < b.hour + (b.dur || 1); h++) {
          const s = slot(b.date + '|' + h);
          s.booked++; if (me && b.userId === me) s.mine++; if (b.master) s.masters.push(b.master);
        }
      });
      store.blocks.forEach((b) => { if (b.date >= d1 && b.date <= d2) slot(b.date + '|' + b.hour).held++; });
      return map;
    },
    async bookings() {
      const me = store.session; if (!me) return [];
      const list = me.isOwner ? store.bookings : store.bookings.filter((b) => b.userId === me.id);
      return clone(list).sort((a, b) => (a.date + two(a.hour)).localeCompare(b.date + two(b.hour)));
    },
    async addBooking(b) {
      await pause(150);
      const me = store.session; if (!me) throw new Error('not_allowed');
      let master = b.master || null, dur = b.dur || 1, hour = b.hour;
      if (b.classId) {
        const p = classProblem(b.date, b.classId, null); if (p) throw new Error(p);
        const c = CLASSES.find((x) => x.id === b.classId);
        master = c.master; hour = c.hour; dur = 1;
      } else {
        const p = slotProblem(b.date, b.hour, b.master, b.services, null, dur); if (p) throw new Error(p);
        // «любой мастер» — первый, кто свободен на все часы; услуги разных мастеров — без привязки
        if (DM.length && !master) master = freeMasters(b.date, Array.from({ length: dur }, (_, i) => b.hour + i), b.services, null)[0]?.id || null;
      }
      const row = { ...clone(b), id: store.seq++, master, hour, dur, userId: me.id, status: 'wait', paid: false, refund: null, workStatus: null, noShow: false };
      store.bookings.push(row); save();
      return clone(row);
    },
    async reschedule(id, date, hour) {
      await pause();
      const b = findB(id); canChange(b);
      const p = slotProblem(date, hour, b.master, b.services, b.id, b.dur || 1);
      if (p) throw new Error(p);
      b.date = date; b.hour = hour;
      if (!store.session.isOwner) b.status = 'wait';
      save();
    },
    async cancelBooking(id) {
      await pause();
      const b = findB(id); canChange(b);
      b.status = 'cancelled'; if (b.paid) b.refund = 'pending';
      save();
    },
    async markPaid(id) { await pause(300); findB(id).paid = true; save(); },
    async setStatus(id, status) { findB(id).status = status; save(); },
    async setWork(id, ws) { findB(id).workStatus = ws; save(); },
    async setNoShow(id) { Object.assign(findB(id), { status: 'cancelled', noShow: true }); save(); },
    async setRefunded(id) { findB(id).refund = 'done'; save(); },
    async uploadPhotos(files) { const out = []; for (const f of files) out.push(await toDataUrl(f, 800)); return out; },

    // ---------- услуги ----------
    async services() { return clone(store.services.filter((s) => s.active).sort((a, b) => a.sort - b.sort || a.id - b.id)); },
    async saveService(s, file) {
      await pause();
      const img = file ? await toDataUrl(file, 900) : s.img;
      const old = s.id ? svcOf(s.id) : null;
      if (old) Object.assign(old, { name: s.name, price: s.price, desc: s.desc, img });
      else store.services.push({ id: Math.max(0, ...store.services.map((x) => x.id)) + 1, name: s.name, price: s.price, desc: s.desc, img, sort: s.sort, active: true, hidden: false });
      save();
    },
    async hideService(id, hidden) { svcOf(id).hidden = hidden; save(); },
    async deleteService(id) { svcOf(id).active = false; save(); },

    // ---------- «мой гараж» ----------
    async cars() { return clone(store.cars[store.session?.id] || []); },
    async addCar(title) {
      const list = store.cars[store.session.id] || (store.cars[store.session.id] = []);
      if (!list.some((c) => c.title.toLowerCase() === title.toLowerCase())) list.unshift({ id: Date.now(), title });
      save();
    },
    async delCar(id) { const list = store.cars[store.session.id] || []; store.cars[store.session.id] = list.filter((c) => c.id !== id); save(); },

    // ---------- закрытые владельцем места ----------
    async blocks() { return clone(store.blocks); },
    async addBlock(date, hour) { store.blocks.push({ id: store.seq++, date, hour }); save(); },
    async delBlock(id) { store.blocks = store.blocks.filter((b) => b.id !== id); save(); },
    async addBlocks(date, hour, n) { for (let i = 0; i < n; i++) store.blocks.push({ id: store.seq++, date, hour }); save(); },
    async delBlocksAt(date, hour) { store.blocks = store.blocks.filter((b) => !(b.date === date && b.hour === hour)); save(); },
  };
})();
