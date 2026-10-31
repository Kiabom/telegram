'use strict';
/**
 * تست‌های امنیت و دسترسی: secret وبهوک، نقش‌ها، callback جعلی، گروه، عضویت، replay دکمه‌ها، تنظیمات.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBot, createStandardBot, submitRequest, USERS: U } = require('./harness');

test('webhook: secret نادرست یا خالی → هیچ پردازشی انجام نمی‌شود', () => {
  const bot = createStandardBot();
  const upd = { update_id: 77, message: { message_id: 1, from: U.ali, chat: { id: U.ali.id, type: 'private' }, text: '/new' } };
  const out1 = bot.post(upd, 'wrong-secret');
  const out2 = bot.post(upd, '');
  assert.equal(out1.getContent(), 'forbidden');
  assert.equal(out2.getContent(), 'forbidden');
  assert.equal(bot.chat(U.ali).length, 0);
  assert.equal(bot.rows('ProcessedUpdates').length, 0);
  assert.equal(bot.post(upd).getContent(), 'ok');
  assert.equal(bot.post(upd).kind, 'html', 'پاسخ HtmlService (نه ContentService که 302 می‌دهد)');
});

test('setWebhook: آدرس با secret و فقط به‌روزرسانی‌های لازم؛ checkWebhook secret را نشان نمی‌دهد', () => {
  const bot = createStandardBot();
  bot.g.setWebhook();
  const wh = bot.tg.webhook;
  assert.match(wh.url, /\/exec\?k=[A-Z0-9]{40}$/);
  assert.deepEqual(wh.allowed_updates, ['message', 'callback_query']);
  const info = bot.g.checkWebhook();
  assert.ok(!info.includes(bot.secret()));
  assert.ok(bot.env.triggers.some((t) => t.name === 'scheduledDailyReport'));
  bot.g.rotateWebhookSecret();
  assert.ok(!bot.tg.webhook.url.includes(wh.url.split('k=')[1]));
});

test('نقش‌ها: کارمند به فرمان‌های ادمین/گزارش/تنظیمات دسترسی ندارد', () => {
  const bot = createStandardBot();
  for (const cmd of ['/pending', '/unpaid', '/review LR-1', '/employees', '/settings', '/set DAILY_CAP_RIAL 1', '/dailyreport', '/export 1405/08/01 1405/08/09']) {
    bot.send(U.ali, cmd);
    assert.match(bot.last(U.ali), /فقط برای نقش‌های مجاز|دسترسی/, cmd);
  }
  assert.ok(bot.rows('AuditLog').filter((a) => a.action === 'ACCESS_DENIED').length >= 8);
  assert.equal(bot.tg.documents.length, 0);
});

test('نقش‌ها: callback جعلی تأیید از طرف کارمند رد می‌شود', () => {
  const bot = createStandardBot();
  const rid = submitRequest(bot, { user: U.ali, total: '2000000 ریال' });
  bot.clickData(U.ali, 'ad|ap|' + rid + '|2000000');
  bot.clickData(U.reza, 'ad|pd|' + rid);
  bot.clickData(U.reza, 'rs|R1|' + rid);
  assert.equal(bot.request(rid).status, 'READY_FOR_REVIEW');
  assert.equal(bot.rows('Payments').length, 0);
  assert.match(bot.lastAnswer().text, /دسترسی ندارید/);
});

test('نقش‌ها: ناظر گزارش، گزارش می‌گیرد ولی شیت Audit/Evidence و تأیید ندارد', () => {
  const bot = createStandardBot();
  const rid = submitRequest(bot, { user: U.ali, total: '2000000 ریال' });
  bot.send(U.viewer, '/review ' + rid);
  assert.match(bot.last(U.viewer), /فقط برای نقش‌های مجاز/);
  bot.send(U.viewer, '/dailyreport');
  const exp = bot.env.exports.filter((e) => e.fmt === 'xlsx').pop();
  assert.ok(exp, 'Excel ساخته شد');
  assert.ok(!exp.sheets.some((s) => /Audit/.test(s.name)), 'ناظر شیت مدارک/تاریخچه را دریافت نمی‌کند');
  const docs = bot.tg.documents.filter((d) => d.chat_id === String(U.viewer.id));
  assert.equal(docs.length, 2);
});

test('دکمه قدیمی فرم (replay) پذیرفته نمی‌شود', () => {
  const bot = createStandardBot();
  bot.send(U.ali, '/new');
  const old = bot.findButton(U.ali, 'سفارش آنلاین');
  bot.click(U.ali, 'سفارش آنلاین');
  bot.click(U.ali, 'بانکی/درگاه');
  bot.clickData(U.ali, old.button.callback_data, old.message.message_id);
  assert.match(bot.lastAnswer().text, /پیام قدیمی/);
  assert.equal(bot.lastRequest().payment_method, 'BANK');
});

test('کاربر ناشناس: فقط مسیر عضویت؛ هیچ دسترسی به فرم یا داده', () => {
  const bot = createStandardBot();
  bot.send(U.stranger, '/new');
  assert.match(bot.last(U.stranger), /ثبت نشده‌اید[\s\S]*شناسه تلگرام شما: <code>9001<\/code>/);
  bot.send(U.stranger, '/pending');
  bot.clickData(U.stranger, 'ad|op|LR-1');
  assert.match(bot.lastAnswer().text, /عضویت/);
  assert.equal(bot.rows('Requests').length, 0);
});

test('عضویت: درخواست با نام، تأیید ادمین، فعال شدن کارمند', () => {
  const bot = createStandardBot();
  bot.send(U.stranger, '/start');
  bot.send(U.stranger, 'حسین موسوی');
  assert.match(bot.last(U.stranger), /برای ادمین ارسال شد/);
  assert.match(bot.last(U.admin), /درخواست عضویت[\s\S]*حسین موسوی[\s\S]*9001/);
  const btn = bot.findButton(U.admin, 'تأیید به‌عنوان کارمند جدید');
  bot.click(U.admin, 'تأیید به‌عنوان کارمند جدید');
  const emp = bot.rows('Employees').find((e) => e.telegram_user_id === '9001');
  assert.equal(emp.active, true);
  assert.equal(emp.role, 'employee');
  assert.match(bot.last(U.stranger), /عضویت شما تأیید شد/);
  bot.clickData(U.admin2, btn.button.callback_data, btn.message.message_id);
  assert.equal(bot.rows('Employees').filter((e) => e.telegram_user_id === '9001').length, 1, 'تأیید تکراری کارمند تکراری نمی‌سازد');
  bot.send(U.stranger, '/new');
  assert.match(bot.last(U.stranger), /غذا را چگونه/);
});

test('عضویت: اتصال به ردیف موجود در فهرست و رد درخواست', () => {
  const bot = createStandardBot();
  bot.addEmployee('کاوه نیک‌نام', null);
  bot.send(U.stranger, '/start');
  bot.send(U.stranger, 'کاوه نیکنام');
  assert.match(bot.last(U.admin), /نام‌های مشابه[\s\S]*کاوه نیک‌نام/);
  bot.click(U.admin, 'اتصال به کارمند موجود');
  bot.click(U.admin, 'کاوه نیک‌نام');
  const emp = bot.rows('Employees').find((e) => e.full_name_fa === 'کاوه نیک‌نام');
  assert.equal(emp.telegram_user_id, '9001');
  const other = { id: 9002, first_name: 'X' };
  bot.send(other, '/start');
  bot.send(other, 'ناشناس دوم');
  bot.click(U.admin, '❌ رد');
  assert.match(bot.last(other), /تأیید نشد/);
  assert.equal(bot.rows('JoinRequests').find((j) => j.telegram_user_id === '9002').status, 'REJECTED');
});

test('کارمند غیرفعال‌شده دسترسی ندارد؛ فقط مالک نقش ادمین می‌دهد', () => {
  const bot = createStandardBot();
  bot.send(U.admin, '/employees');
  bot.click(U.admin, 'رضا کریمی');
  bot.click(U.admin, 'غیرفعال‌سازی');
  bot.send(U.reza, '/new');
  assert.match(bot.last(U.reza), /غیرفعال است/);
  bot.send(U.admin, '/employees');
  bot.click(U.admin, 'علی احمدی');
  assert.equal(bot.findButton(U.admin, 'نقش: ادمین مالی'), null, 'ادمین مالی دکمه تغییر نقش ندارد');
  bot.clickData(U.admin, 'em|r|' + bot.emp.ali.employee_id + '|f');
  assert.equal(bot.rows('Employees').find((e) => e.employee_id === bot.emp.ali.employee_id).role, 'employee');
  bot.send(U.owner, '/employees');
  bot.click(U.owner, 'علی احمدی');
  bot.click(U.owner, 'نقش: ادمین مالی');
  assert.equal(bot.rows('Employees').find((e) => e.employee_id === bot.emp.ali.employee_id).role, 'finance_admin');
  bot.send(U.ali, '/pending');
  assert.match(bot.last(U.ali), /در انتظار بررسی نیست/);
});

test('گروه: هیچ داده مالی پردازش نمی‌شود؛ فقط راهنمای چت خصوصی', () => {
  const bot = createStandardBot();
  const group = { id: -100123, type: 'supergroup' };
  bot.message(U.ali, { text: '/new' }, group);
  const msgs = bot.tg.chat(group.id);
  assert.equal(msgs.length, 1);
  assert.match(msgs[0].text, /فقط در چت خصوصی/);
  assert.match(JSON.stringify(msgs[0].reply_markup), /t\.me\/lunch_test_bot/);
  bot.message(U.ali, { photo: [{ file_id: 'G1', file_unique_id: 'G1U', file_size: 10 }] }, group);
  assert.equal(bot.rows('Documents').length, 0);
  assert.equal(bot.rows('Requests').length, 0);
});

test('مالک بدون پروفایل: ساخت پروفایل با /start؛ تنظیمات فقط توسط مالک', () => {
  const bot = createBot({ now: '2026-10-31T09:00:00Z' });
  bot.send(U.owner, '/start');
  assert.match(bot.last(U.owner), /مالک ربات هستید/);
  bot.send(U.owner, 'مالک اصلی');
  assert.match(bot.last(U.owner), /نقش «مالک ربات» ساخته شد/);
  bot.send(U.owner, '/set DAILY_CAP_RIAL 4,000,000');
  assert.match(bot.last(U.owner), /3500000 ← 4000000/);
  bot.send(U.owner, '/set AI_ENABLED maybe');
  assert.match(bot.last(U.owner), /TRUE یا FALSE/);
  bot.send(U.owner, '/set REQUIRE_ADMIN_APPROVAL FALSE');
  assert.match(bot.last(U.owner), /قابل تغییر نیست/);
  bot.send(U.owner, '/settings');
  assert.match(bot.last(U.owner), /سقف امروز: ۴٬۰۰۰٬۰۰۰ ریال/);
  assert.ok(bot.rows('AuditLog').some((a) => a.action === 'SETTING_CHANGED'));
});

test('توکن و کلیدها هرگز در شیت‌ها یا پیام‌ها ذخیره نمی‌شوند', () => {
  const bot = createStandardBot();
  bot.env.props.set('GEMINI_API_KEY', 'AIzaSECRETKEY1234567890abcdef');
  submitRequest(bot, { user: U.ali, total: '2000000 ریال' });
  const token = bot.env.props.get('BOT_TOKEN');
  for (const ss of bot.env.spreadsheets.values()) {
    const dump = JSON.stringify(ss.sheets.map((s) => s.data));
    assert.ok(!dump.includes(token) && !dump.includes('AIzaSECRETKEY') && !dump.includes(bot.secret()));
  }
  for (const [, msgs] of bot.tg.chats) assert.ok(!JSON.stringify(msgs).includes(token));
});

test('polling پشتیبان: پیام‌ها با getUpdates پردازش و offset ذخیره می‌شود', () => {
  const bot = createStandardBot();
  bot.g.enablePollingMode();
  assert.ok(bot.env.triggers.some((t) => t.name === 'pollTelegramUpdates'));
  bot.env.pendingUpdates.push({ update_id: 42, message: { message_id: 1, from: U.ali, chat: { id: U.ali.id, type: 'private' }, text: '/balance' } });
  bot.g.pollTelegramUpdates();
  assert.match(bot.last(U.ali), /مانده سقف امروز/);
  assert.equal(bot.env.props.get('POLL_OFFSET'), '43');
  bot.g.pollTelegramUpdates();
  assert.equal(bot.chat(U.ali).filter((m) => /مانده سقف/.test(m.text)).length, 1);
});

test('setup تکرارپذیر است و تنظیمات/داده‌های موجود را بازنویسی نمی‌کند', () => {
  const bot = createStandardBot();
  bot.setSetting('DAILY_CAP_RIAL', '5000000');
  const before = bot.rows('Employees').length;
  bot.g.setup();
  bot.g.setup();
  assert.equal(bot.rows('Employees').length, before);
  assert.equal(bot.rows('Settings').filter((s) => s.key === 'DAILY_CAP_RIAL').length, 1);
  assert.equal(bot.rows('Settings').find((s) => s.key === 'DAILY_CAP_RIAL').value, '5000000');
});

test('نگهداری روزانه: پیش‌نویس رهاشده لغو و شناسه‌های قدیمی update حذف می‌شوند', () => {
  const bot = createStandardBot({ now: '2026-10-01T09:00:00Z' });
  bot.send(U.ali, '/new');
  bot.click(U.ali, 'سفارش آنلاین');
  const rid = bot.lastRequest().request_id;
  const n = bot.rows('ProcessedUpdates').length;
  bot.setNow('2026-10-31T09:00:00Z');
  bot.send(U.reza, '/help');
  bot.g.dailyMaintenance();
  assert.equal(bot.request(rid).status, 'CANCELLED');
  assert.match(bot.last(U.ali), /تکمیل‌نشدن لغو شد/);
  assert.ok(bot.rows('ProcessedUpdates').length < n + 1);
  assert.ok(bot.rows('ProcessedUpdates').some((p) => p.received_at.startsWith('2026-10-31')));
});
