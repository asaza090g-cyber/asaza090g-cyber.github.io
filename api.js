// Работа с сервером (Supabase). Ключ публичный: доступ ограничен правилами в базе.
const SB_URL = 'https://dpvthhzjwkjcpisiddoe.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwdnRoaHpqd2tqY3Bpc2lkZG9lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NzY1MDcsImV4cCI6MjEwNzA1MjUwN30.-YD2djR2htgKdiwJ8Sse8oBVDvljdrcBToUUboRqH74';
const sb = supabase.createClient(SB_URL, SB_KEY);

// вход по телефону: Supabase требует почту, поэтому телефон превращается в служебный адрес
const emailOf = (phone10) => `${phone10}@example.com`;

const toBooking = (r) => ({
  id: r.id, services: r.services, items: r.items, date: r.date, hour: r.hour, phone: r.phone, car: r.car,
  discount: r.discount, total: r.total, status: r.status, paid: r.paid, refund: r.refund || null, userName: r.user_name,
  comment: r.comment || '', photos: r.photos || [], workStatus: r.work_status || null, noShow: !!r.no_show,
});
const toService = (r) => ({ id: r.id, name: r.name, price: r.price, desc: r.description, img: r.img, sort: r.sort, active: r.active, hidden: r.hidden });

// фото уменьшается в браузере до 1000 px и JPEG, чтобы быстро грузилось на телефоне
function shrinkImage(file, maxW = 1000) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = Math.min(maxW, img.width), h = Math.round((img.height * w) / img.width);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Не удалось обработать фото'))), 'image/jpeg', 0.8);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('Не удалось открыть фото'));
    img.src = URL.createObjectURL(file);
  });
}
const toReview = (r) => ({ id: r.id, name: r.name, rating: r.rating, text: r.text, reply: r.reply, color: r.color || null, date: r.created_at.slice(0, 10) });

// ошибки сервера → понятный текст
function errText(e) {
  const m = (e && (e.message || e.error_description)) || '';
  if (/Invalid login credentials/i.test(m)) return 'Неверный телефон или пароль';
  if (/already registered|already exists/i.test(m)) return 'Этот телефон уже зарегистрирован';
  if (/Password should be/i.test(m)) return 'Пароль не короче 6 символов';
  if (/slot_full/.test(m)) return 'Это время уже заняли, выберите другое';
  if (/past_date/.test(m)) return 'Это время уже прошло';
  if (/day_closed/.test(m)) return 'В этот день центр не работает';
  if (/hour_closed/.test(m)) return 'В это время центр закрыт';
  if (/not_active/.test(m)) return 'Эту запись уже нельзя изменить';
  if (/too_late/.test(m)) return 'До записи осталось слишком мало времени — позвоните в центр';
  if (/not_allowed|row-level security|permission denied/i.test(m)) return 'Нет доступа';
  if (/Failed to fetch|Load failed|NetworkError|network|timeout/i.test(m)) return 'Нет связи с сервером';
  return 'Ошибка: ' + (m || 'попробуйте ещё раз');
}
async function must(p) {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}

const api = {
  async session() {
    const { data } = await sb.auth.getSession();
    const u = data.session?.user;
    if (!u) return null;
    // колонка color появляется после обновления базы №4; без неё профиль всё равно загружается
    let p;
    try { p = await must(sb.from('profiles').select('name, phone, is_owner, color').eq('id', u.id).single()); }
    catch { p = await must(sb.from('profiles').select('name, phone, is_owner').eq('id', u.id).single()); }
    return { id: u.id, name: p.name, phone: p.phone, isOwner: p.is_owner, color: p.color || null };
  },
  async signUp(name, phone10, password) {
    const data = await must(sb.auth.signUp({ email: emailOf(phone10), password, options: { data: { name, phone: phone10 } } }));
    if (!data.session) throw new Error('Регистрация требует подтверждения почты. Выключите Confirm email в Supabase.');
    return api.session();
  },
  async signIn(phone10, password) {
    await must(sb.auth.signInWithPassword({ email: emailOf(phone10), password }));
    return api.session();
  },
  signOut: () => sb.auth.signOut(),

  // акция + график работы (поля графика появляются после обновления базы №5; до этого — значения по умолчанию)
  async settings() {
    const s = await must(sb.from('settings').select('*').eq('id', 1).single());
    return {
      promo: { on: s.promo_on, percent: s.promo_percent, text: s.promo_text },
      schedule: s.schedule || null, capacity: s.capacity || null, closed: s.closed_dates || [],
      cancelHours: s.cancel_hours ?? null,
    };
  },
  saveSchedule: (g) => must(sb.from('settings').update({ schedule: g.schedule, capacity: g.capacity, closed_dates: g.closed, ...(g.cancelHours != null ? { cancel_hours: g.cancelHours } : {}) }).eq('id', 1)),
  saveSettings: (p) => must(sb.from('settings').update({ promo_on: p.on, promo_percent: p.percent, promo_text: p.text }).eq('id', 1)),

  async reviews() { return (await must(sb.from('reviews').select('*').order('created_at'))).map(toReview); },
  async addReview(name, rating, text, color) {
    try { return toReview(await must(sb.from('reviews').insert({ name, rating, text, color }).select().single())); }
    catch (e) {
      if (!/color/.test(e.message || '')) throw e;
      return toReview(await must(sb.from('reviews').insert({ name, rating, text }).select().single()));
    }
  },
  setColor: (c) => must(sb.rpc('set_avatar_color', { c })),
  replyReview: (id, reply) => must(sb.from('reviews').update({ reply }).eq('id', id)),

  async counts(d1, d2) {
    const rows = await must(sb.rpc('slot_counts', { d1, d2 }));
    const map = {};
    rows.forEach((r) => { map[r.day + '|' + r.hr] = { booked: r.booked, held: r.held, mine: r.mine }; });
    return map;
  },

  async bookings() { return (await must(sb.from('bookings').select('*').order('date').order('hour'))).map(toBooking); },
  async addBooking(b) {
    const row = await must(sb.from('bookings').insert({
      user_name: b.userName, phone: b.phone, car: b.car, services: b.services,
      items: b.items, date: b.date, hour: b.hour, discount: b.discount, total: b.total,
      ...(b.comment ? { comment: b.comment } : {}), ...(b.photos?.length ? { photos: b.photos } : {}),
    }).select().single());
    return toBooking(row);
  },
  reschedule: (id, date, hour) => must(sb.rpc('reschedule_booking', { bid: id, d: date, h: hour })),

  async services() { return (await must(sb.from('services').select('*').eq('active', true).order('sort').order('id'))).map(toService); },
  async saveService(s, file) {
    let img = s.img;
    if (file) {
      const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      await must(sb.storage.from('services').upload(path, await shrinkImage(file), { contentType: 'image/jpeg' }));
      img = sb.storage.from('services').getPublicUrl(path).data.publicUrl;
    }
    const row = { name: s.name, price: s.price, description: s.desc, img };
    if (s.id) return must(sb.from('services').update(row).eq('id', s.id));
    return must(sb.from('services').insert({ ...row, sort: s.sort }));
  },
  hideService: (id, hidden) => must(sb.from('services').update({ hidden }).eq('id', id)),
  deleteService: (id) => must(sb.from('services').update({ active: false }).eq('id', id)),
  cancelBooking: (id) => must(sb.rpc('cancel_booking', { bid: id })),
  markPaid: (id) => must(sb.rpc('mark_paid', { bid: id })),
  setStatus: (id, status) => must(sb.from('bookings').update({ status }).eq('id', id)),
  setWork: (id, ws) => must(sb.from('bookings').update({ work_status: ws }).eq('id', id)),
  setNoShow: (id) => must(sb.from('bookings').update({ status: 'cancelled', no_show: true }).eq('id', id)),
  // фото повреждений: сжимаются в браузере и кладутся в папку клиента
  async uploadPhotos(files, uid) {
    const urls = [];
    for (const f of files) {
      const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      await must(sb.storage.from('photos').upload(path, await shrinkImage(f, 1280), { contentType: 'image/jpeg' }));
      urls.push(sb.storage.from('photos').getPublicUrl(path).data.publicUrl);
    }
    return urls;
  },
  cars: () => must(sb.from('cars').select('id, title').order('created_at', { ascending: false })),
  addCar: (title) => must(sb.from('cars').upsert({ title }, { onConflict: 'user_id,title', ignoreDuplicates: true })),
  delCar: (id) => must(sb.from('cars').delete().eq('id', id)),
  setRefunded: (id) => must(sb.from('bookings').update({ refund: 'done' }).eq('id', id)),

  blocks: () => must(sb.from('blocks').select('id, date, hour')),
  addBlock: (date, hour) => must(sb.from('blocks').insert({ date, hour })),
  delBlock: (id) => must(sb.from('blocks').delete().eq('id', id)),
  addBlocks: (date, hour, n) => must(sb.from('blocks').insert(Array.from({ length: n }, () => ({ date, hour })))),
  delBlocksAt: (date, hour) => must(sb.from('blocks').delete().eq('date', date).eq('hour', hour)),
};
