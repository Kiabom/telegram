'use strict';
/**
 * ابزار تست: ساخت ربات روی شبیه‌ساز، ارسال پیام/عکس/ویس، کلیک روی دکمه‌ها و خواندن شیت‌ها.
 */
const { createEnv } = require('./gas-mock');

const USERS = {
  owner: { id: 1001, first_name: 'Owner' },
  admin: { id: 2001, first_name: 'Finance', last_name: 'Admin' },
  admin2: { id: 2002, first_name: 'Second', last_name: 'Admin' },
  viewer: { id: 3001, first_name: 'Manager' },
  ali: { id: 4001, first_name: 'Ali', username: 'ali_test' },
  mohammad: { id: 4002, first_name: 'Mohammad' },
  reza: { id: 4003, first_name: 'Reza' },
  sara: { id: 4004, first_name: 'Sara' },
  stranger: { id: 9001, first_name: 'Stranger', username: 'unknown_guy' }
};

function createBot(opts = {}) {
  const env = createEnv(opts);
  const g = env.context;
  env.props.set('BOT_TOKEN', '123456789:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz012');
  env.props.set('OWNER_TELEGRAM_IDS', String(USERS.owner.id));
  env.props.set('WEB_APP_URL', 'https://script.google.com/macros/s/TESTDEPLOY/exec');
  if (opts.now) g.CLOCK.now = () => new Date(opts.now);
  g.setup();
  let updateId = 5000;
  let fileSeq = 1;
  let cbSeq = 1;

  const bot = {
    env, g, tg: env.tg, USERS,
    secret: () => env.props.get('WEBHOOK_SECRET'),
    post(update, secret) {
      return g.doPost({ parameter: { k: secret === undefined ? bot.secret() : secret }, postData: { contents: JSON.stringify(update) } });
    },
    message(user, fields, chat) {
      const id = ++updateId;
      const u = { update_id: id, message: Object.assign({ message_id: id, from: user, chat: chat || { id: user.id, type: 'private' }, date: 1 }, fields) };
      bot.post(u);
      return u;
    },
    send(user, text) { return bot.message(user, { text }); },
    photo(user, o = {}) {
      const fid = o.fileId || 'PHOTO_' + (fileSeq++);
      env.tg.files.set(fid, { size: o.size || 120000, content: o.content || ('IMG-' + fid), ext: '.jpg' });
      return bot.message(user, {
        photo: [{ file_id: fid + '_small', file_unique_id: (o.uniqueId || fid) + '_s', file_size: 1000 }, { file_id: fid, file_unique_id: o.uniqueId || ('U' + fid), file_size: o.size || 120000 }],
        caption: o.caption
      });
    },
    document(user, o = {}) {
      const fid = o.fileId || 'DOC_' + (fileSeq++);
      env.tg.files.set(fid, { size: o.size || 50000, ext: o.ext || '.pdf', mime: o.mime });
      return bot.message(user, { document: { file_id: fid, file_unique_id: 'U' + fid, file_size: o.size || 50000, mime_type: o.mime || 'application/pdf', file_name: o.name || 'receipt.pdf' } });
    },
    voice(user, o = {}) {
      const fid = o.fileId || 'VOICE_' + (fileSeq++);
      env.tg.files.set(fid, { size: 8000, ext: '.oga', mime: 'audio/ogg' });
      return bot.message(user, { voice: { file_id: fid, file_unique_id: 'U' + fid, file_size: 8000, mime_type: 'audio/ogg', duration: 5 } });
    },
    chat(user) { return env.tg.chat(user.id); },
    last(user) { const c = bot.chat(user); return c.length ? c[c.length - 1].text : ''; },
    texts(user) { return bot.chat(user).map((m) => m.text); },
    allButtons(m) { return m && m.reply_markup && m.reply_markup.inline_keyboard ? [].concat(...m.reply_markup.inline_keyboard) : []; },
    buttons(user) {
      const c = bot.chat(user);
      for (let i = c.length - 1; i >= 0; i--) { const b = bot.allButtons(c[i]); if (b.length) return b.map((x) => x.text); }
      return [];
    },
    findButton(user, pattern) {
      const c = bot.chat(user);
      const match = (t) => (pattern instanceof RegExp ? pattern.test(t) : t.indexOf(pattern) >= 0);
      for (let i = c.length - 1; i >= 0; i--) {
        const b = bot.allButtons(c[i]).find((x) => match(x.text));
        if (b) return { message: c[i], button: b };
      }
      return null;
    },
    click(user, pattern) {
      const f = bot.findButton(user, pattern);
      if (!f) throw new Error('Button not found: ' + pattern + '\nLast message: ' + bot.last(user) + '\nButtons: ' + JSON.stringify(bot.buttons(user)));
      return bot.clickData(user, f.button.callback_data, f.message.message_id);
    },
    clickData(user, data, messageId) {
      const u = {
        update_id: ++updateId,
        callback_query: { id: 'cb' + (cbSeq++), from: user, data, message: { message_id: messageId || 1, chat: { id: user.id, type: 'private' } } }
      };
      bot.post(u);
      return u;
    },
    lastAnswer() { return env.tg.answers[env.tg.answers.length - 1] || {}; },
    rows(sheet) { g.App_resetState_(); return JSON.parse(JSON.stringify(g.Db_all_(sheet))); },
    request(rid) { return bot.rows('Requests').find((r) => r.request_id === rid); },
    lastRequest() { const r = bot.rows('Requests'); return r[r.length - 1]; },
    addEmployee(name, user, role, extra) {
      g.App_resetState_();
      return JSON.parse(JSON.stringify(g.Emp_create_(Object.assign({ full_name_fa: name, telegram_user_id: user ? String(user.id) : '', role: role || 'employee' }, extra || {}), 'TEST')));
    },
    setSetting(key, value) {
      g.App_resetState_();
      const r = g.Settings_set_(key, value, 'TEST');
      if (!r.ok) throw new Error('setSetting failed ' + key + ': ' + r.error);
    },
    setNow(iso) { g.CLOCK.now = () => new Date(iso); }
  };
  return bot;
}

/** ربات با کارکنان نمونه: مالک، ادمین مالی، ناظر و چند کارمند. */
function createStandardBot(opts = {}) {
  const bot = createBot(Object.assign({ now: '2026-10-31T09:00:00Z' }, opts));
  const u = USERS;
  bot.emp = {
    owner: bot.addEmployee('مالک ربات', u.owner, 'owner'),
    admin: bot.addEmployee('مریم مالی', u.admin, 'finance_admin'),
    admin2: bot.addEmployee('نسرین حسابدار', u.admin2, 'finance_admin'),
    viewer: bot.addEmployee('مدیر ناظر', u.viewer, 'report_viewer'),
    ali: bot.addEmployee('علی احمدی', u.ali),
    mohammad: bot.addEmployee('محمد رضایی', u.mohammad),
    reza: bot.addEmployee('رضا کریمی', u.reza),
    sara: bot.addEmployee('سارا محمدی', u.sara)
  };
  return bot;
}

/**
 * پیمودن کامل فرم ثبت درخواست.
 * o: {user, channel:'online'|'inperson', payment:'bank'|'credit'|'mixed', people:'خودم، محمد و رضا', payer:'self'|name,
 *     total:'1260000', unit:'T'|'R'|null, split:'equal'|'individual', shares:[...], merchant:null|'text'}
 */
function submitRequest(bot, o) {
  const user = o.user;
  bot.send(user, '/new');
  bot.click(user, o.channel === 'inperson' ? 'خرید حضوری' : 'سفارش آنلاین');
  bot.click(user, { bank: 'بانکی/درگاه', credit: 'اعتباری', mixed: 'ترکیبی' }[o.payment || 'bank']);
  for (let i = 0; i < (o.purchasePhotos || 1); i++) bot.photo(user, { caption: 'فاکتور' });
  bot.click(user, 'ثبت مدرک خرید');
  for (let i = 0; i < (o.paymentPhotos || 1); i++) bot.photo(user);
  bot.click(user, 'ثبت مدرک پرداخت');
  if (o.date) { bot.click(user, 'تاریخ دیگر'); bot.send(user, o.date); } else bot.click(user, o.yesterday ? 'دیروز' : 'امروز');
  bot.send(user, o.people || 'خودم');
  (o.ambiguous || []).forEach((name) => bot.click(user, name));
  bot.click(user, 'تأیید همین افراد');
  if (!o.payer || o.payer === 'self') bot.click(user, 'خودم');
  else { bot.click(user, 'شخص دیگری'); bot.click(user, o.payer); }
  bot.send(user, o.total);
  if (o.unit) bot.click(user, o.unit === 'T' ? 'تومان ←' : 'ریال ←');
  if (o.ack) bot.click(user, 'بله، درست است');
  if (o.split === 'equal') bot.click(user, 'سهم مساوی');
  if (o.split === 'individual') {
    bot.click(user, 'ثبت سهم تک‌تک');
    (o.shares || []).forEach((s) => bot.send(user, s));
    if (o.mismatch) bot.click(user, o.mismatch);
  }
  if (o.merchant) bot.send(user, o.merchant); else bot.click(user, 'رد شدن');
  if (o.noSubmit) return null;
  bot.click(user, 'تأیید و ثبت');
  const m = bot.last(user).match(/LR-[0-9]{6}-[A-Z0-9]{4,8}/);
  return m ? m[0] : null;
}

module.exports = { createBot, createStandardBot, submitRequest, USERS };
