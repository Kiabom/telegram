'use strict';
/**
 * تست‌های یکپارچه: سناریوهای جدول بخش ۱۱ PRD (به ریال) روی ربات کامل با تلگرام/Sheets شبیه‌سازی‌شده.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStandardBot, submitRequest, USERS: U } = require('./harness');

function approve(bot, admin, rid) {
  bot.send(admin || U.admin, '/review ' + rid);
  bot.click(admin || U.admin, /^✅ تأیید /);
  return bot.request(rid);
}

function noErrors(bot) {
  const errs = bot.rows('AuditLog').filter((a) => a.action === 'ERROR');
  assert.deepEqual(errs.map((e) => e.field_changes_json), []);
}

test('سناریو: یک نفر کمتر از سقف (۲۲۰ هزار تومان) → بازپرداخت ۲٬۲۰۰٬۰۰۰ ریال به پرداخت‌کننده', () => {
  const bot = createStandardBot();
  const rid = submitRequest(bot, { user: U.ali, people: 'خودم', total: '۲۲۰ هزار تومان' });
  assert.ok(rid);
  const r = approve(bot, U.admin, rid);
  assert.equal(r.status, 'APPROVED');
  assert.equal(r.claimed_total_rial, 2200000);
  assert.equal(r.approved_reimbursement_rial, 2200000);
  const pays = bot.rows('Payments');
  assert.equal(pays.length, 1);
  assert.equal(pays[0].amount_rial, 2200000);
  assert.equal(pays[0].payer_employee_id, bot.emp.ali.employee_id);
  noErrors(bot);
});

test('سناریو: یک نفر بیشتر از سقف (۴٬۸۰۰٬۰۰۰ ریال) → ۳٬۵۰۰٬۰۰۰ ریال', () => {
  const bot = createStandardBot();
  const rid = submitRequest(bot, { user: U.ali, people: 'خودم', total: '۴٬۸۰۰٬۰۰۰ ریال' });
  assert.equal(approve(bot, U.admin, rid).approved_reimbursement_rial, 3500000);
  assert.match(bot.request(rid).flags, /OVER_CAP/);
});

test('سناریو: گروه سه‌نفره سهم مساوی ۱٬۲۶۰٬۰۰۰ تومان → ۱۰٬۵۰۰٬۰۰۰ ریال، یک پرداخت به پرداخت‌کننده', () => {
  const bot = createStandardBot();
  const rid = submitRequest(bot, { user: U.ali, people: 'خودم، محمد و رضا', total: '1260000', unit: 'T', split: 'equal' });
  const r = approve(bot, U.admin, rid);
  assert.equal(r.claimed_total_rial, 12600000);
  assert.equal(r.approved_reimbursement_rial, 10500000);
  const bens = bot.rows('RequestBeneficiaries').filter((b) => b.request_id === rid);
  assert.deepEqual(bens.map((b) => b.actual_cost_rial), [4200000, 4200000, 4200000]);
  assert.deepEqual(bens.map((b) => b.approved_allocation_rial), [3500000, 3500000, 3500000]);
  const pays = bot.rows('Payments');
  assert.equal(pays.length, 1, 'فقط یک پرداخت، نه یکی برای هر نفر');
  assert.equal(pays[0].payer_employee_id, bot.emp.ali.employee_id);
  assert.equal(pays[0].amount_rial, 10500000);
  assert.equal(r.equal_split_confirmed, true);
});

test('سناریو: دو نفر با هزینه متفاوت (۵ و ۱ میلیون ریال) → ۴٬۵۰۰٬۰۰۰ ریال نه ۶٬۰۰۰٬۰۰۰', () => {
  const bot = createStandardBot();
  const rid = submitRequest(bot, {
    user: U.ali, people: 'خودم و محمد', total: '6000000 ریال', split: 'individual', shares: ['5000000', '1000000']
  });
  const r = approve(bot, U.admin, rid);
  assert.equal(r.approved_reimbursement_rial, 4500000);
  assert.equal(r.split_mode, 'INDIVIDUAL');
});

test('سناریو: مصرف قبلی ۲٬۸۰۰٬۰۰۰ و سفارش بعدی ۱٬۲۰۰٬۰۰۰ → فقط ۷۰۰٬۰۰۰ مجاز (پرداخت به پرداخت‌کننده دوم)', () => {
  const bot = createStandardBot();
  const r1 = submitRequest(bot, { user: U.mohammad, people: 'خودم', total: '2800000 ریال' });
  assert.equal(approve(bot, U.admin, r1).approved_reimbursement_rial, 2800000);
  const r2 = submitRequest(bot, { user: U.reza, people: 'محمد', total: '1200000 ریال' });
  const req2 = approve(bot, U.admin, r2);
  assert.equal(req2.approved_reimbursement_rial, 700000);
  assert.equal(req2.payer_employee_id, bot.emp.reza.employee_id);
  assert.match(req2.flags, /PAYER_NOT_BENEFICIARY/);
  const ben = bot.rows('RequestBeneficiaries').find((b) => b.request_id === r2);
  assert.equal(ben.prior_approved_today_rial, 2800000);
  assert.equal(ben.remaining_cap_before_rial, 700000);
});

test('سناریو: یک نفر در سفارش دو پرداخت‌کننده → سقف محمد مشترک، پرداخت هر سفارش به پرداخت‌کننده خودش', () => {
  const bot = createStandardBot();
  const a = submitRequest(bot, { user: U.ali, people: 'خودم و محمد', total: '4000000 ریال', split: 'individual', shares: ['1000000', '3000000'] });
  const s = submitRequest(bot, { user: U.sara, people: 'خودم و محمد', total: '3000000 ریال', split: 'equal' });
  assert.equal(approve(bot, U.admin, a).approved_reimbursement_rial, 4000000);
  assert.equal(approve(bot, U.admin, s).approved_reimbursement_rial, 1500000 + 500000);
  const usage = bot.rows('RequestBeneficiaries').filter((b) => b.employee_id === bot.emp.mohammad.employee_id)
    .reduce((acc, b) => acc + b.approved_allocation_rial, 0);
  assert.equal(usage, 3500000, 'مصرف محمد در دو سفارش از سقف بیشتر نشود');
  const pays = bot.rows('Payments');
  assert.equal(pays.length, 2);
  assert.equal(pays.find((p) => p.request_id === a).payer_employee_id, bot.emp.ali.employee_id);
  assert.equal(pays.find((p) => p.request_id === s).payer_employee_id, bot.emp.sara.employee_id);
});

test('سناریو: نبود رسید پرداخت → عبور از مرحله ممکن نیست و تأیید ممنوع است', () => {
  const bot = createStandardBot();
  bot.send(U.ali, '/new');
  bot.click(U.ali, 'سفارش آنلاین');
  bot.click(U.ali, 'بانکی/درگاه');
  bot.photo(U.ali);
  bot.click(U.ali, 'ثبت مدرک خرید');
  assert.equal(bot.findButton(U.ali, 'ثبت مدرک پرداخت'), null, 'بدون تصویر، دکمه ثبت وجود ندارد');
  const seq = bot.rows('Sessions').find((x) => x.telegram_user_id === String(U.ali.id)).seq;
  bot.clickData(U.ali, 'w|' + seq + '|yd');
  assert.match(bot.lastAnswer().text, /مدرک پرداخت الزامی است/);
  const req = bot.lastRequest();
  assert.equal(req.status, 'WAITING_FOR_PAYMENT_PROOF');
  bot.g.App_resetState_();
  const res = bot.g.Req_approve_(req.request_id, 0, { tgId: String(U.admin.id) });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'BAD_STATUS');
  assert.equal(bot.rows('Payments').length, 0);
});

test('سناریو: مدرک حذف‌شده پس از ثبت → ادمین نمی‌تواند تأیید کند', () => {
  const bot = createStandardBot();
  const rid = submitRequest(bot, { user: U.ali, total: '2000000 ریال' });
  bot.g.App_resetState_();
  bot.g.Doc_removeKinds_(rid, ['BANK_PAYMENT'], 'TEST');
  bot.g.App_resetState_();
  const res = bot.g.Req_approve_(rid, 2000000, { tgId: String(U.admin.id) });
  assert.equal(res.code, 'MISSING_DOCS');
});

test('سناریو: اعتباری با عکس موجودی → ادمین رد می‌کند؛ سقف مصرف نمی‌شود و دلیل به کاربر می‌رسد', () => {
  const bot = createStandardBot();
  const rid = submitRequest(bot, { user: U.ali, payment: 'credit', total: '2500000 ریال' });
  assert.match(bot.request(rid).flags, /CREDIT_PAYMENT/);
  bot.send(U.admin, '/review ' + rid);
  bot.click(U.admin, '❌ رد');
  bot.click(U.admin, 'فقط موجودی اعتبار');
  const r = bot.request(rid);
  assert.equal(r.status, 'REJECTED');
  assert.match(r.rejection_reason, /موجودی اعتبار/);
  assert.match(bot.last(U.ali), /رد شد[\s\S]*موجودی اعتبار/);
  bot.g.App_resetState_();
  assert.deepEqual(JSON.parse(JSON.stringify(bot.g.Req_usageForDate_('2026-10-31', ''))), {});
  const actions = bot.rows('AuditLog').filter((a) => a.request_id === rid).map((a) => a.action);
  assert.ok(actions.includes('SUBMITTED') && actions.includes('REJECTED'), 'تاریخچه باقی می‌ماند');
});

test('سناریو: ریال/تومان — «۳٬۵۰۰٬۰۰۰ ریال» صریح و «۳۵۰۰۰۰ + انتخاب تومان» هر دو ۳٬۵۰۰٬۰۰۰ ریال', () => {
  const bot = createStandardBot();
  const r1 = submitRequest(bot, { user: U.ali, total: '۳٬۵۰۰٬۰۰۰ ریال' });
  const r2 = submitRequest(bot, { user: U.reza, total: '350000', unit: 'T' });
  assert.equal(bot.request(r1).claimed_total_rial, 3500000);
  assert.equal(bot.request(r2).claimed_total_rial, 3500000);
});

function goToAmountStep(bot, user, people) {
  bot.send(user, '/new');
  bot.click(user, 'سفارش آنلاین');
  bot.click(user, 'بانکی/درگاه');
  bot.photo(user);
  bot.click(user, 'ثبت مدرک خرید');
  bot.photo(user);
  bot.click(user, 'ثبت مدرک پرداخت');
  bot.click(user, 'امروز');
  bot.send(user, people || 'خودم');
}

test('واحد: عدد بدون واحد همیشه پرسیده می‌شود و هشدار مبلغ کم (احتمال اشتباه واحد) نمایش داده می‌شود', () => {
  const bot = createStandardBot();
  goToAmountStep(bot, U.ali);
  bot.click(U.ali, 'تأیید همین افراد');
  bot.click(U.ali, 'خودم');
  bot.send(U.ali, '350000');
  // بدون انتخاب واحد، فرم در مرحله واحد می‌ماند و هیچ مبلغی ثبت نمی‌شود
  assert.match(bot.last(U.ali), /به چه واحدی نوشتید/);
  assert.ok(bot.findButton(U.ali, 'تومان ← ۳٬۵۰۰٬۰۰۰ ریال'));
  bot.click(U.ali, 'ورود دوباره');
  bot.send(U.ali, '50000 ریال');
  assert.match(bot.last(U.ali), /غیرمعمول/);
  bot.click(U.ali, 'ورود دوباره');
  bot.send(U.ali, '5 هزار تومان');
  assert.match(bot.last(U.ali), /۵۰٬۰۰۰ ریال[\s\S]*غیرمعمول/);
  bot.click(U.ali, 'بله، درست است');
  assert.match(bot.last(U.ali), /مبلغ فاکتور: ۵۰٬۰۰۰ ریال \(۵٬۰۰۰ تومان\)/);
  assert.match(bot.request(bot.lastRequest().request_id).status, /WAITING_FOR_DETAILS/);
});

test('idempotency: بازپخش update تکراری درخواست/پرداخت تکراری نمی‌سازد', () => {
  const bot = createStandardBot();
  const rid = submitRequest(bot, { user: U.ali, total: '2000000 ریال', noSubmit: true });
  const f = bot.findButton(U.ali, 'تأیید و ثبت');
  const upd = bot.clickData(U.ali, f.button.callback_data, f.message.message_id);
  bot.post(upd); bot.post(upd);
  const reqs = bot.rows('Requests').filter((r) => r.status === 'READY_FOR_REVIEW');
  assert.equal(reqs.length, 1);
  bot.send(U.admin, '/review ' + reqs[0].request_id);
  const ap = bot.click(U.admin, /^✅ تأیید /);
  bot.post(ap); bot.post(ap);
  assert.equal(bot.rows('Payments').length, 1);
  assert.equal(bot.rows('ProcessedUpdates').filter((p) => p.telegram_update_id === String(ap.update_id)).length, 1);
  assert.equal(rid, null);
});

test('همزمانی: دو ادمین همزمان تأیید می‌کنند → فقط یک تأیید و یک پرداخت', () => {
  const bot = createStandardBot();
  const rid = submitRequest(bot, { user: U.ali, total: '2000000 ریال' });
  const card = bot.findButton(U.admin, /^✅ تأیید /);
  const card2 = bot.findButton(U.admin2, /^✅ تأیید /);
  bot.clickData(U.admin, card.button.callback_data, card.message.message_id);
  bot.clickData(U.admin2, card2.button.callback_data, card2.message.message_id);
  assert.match(bot.lastAnswer().text, /قبلاً توسط مریم مالی تأیید شده/);
  assert.equal(bot.rows('Payments').length, 1);
  assert.equal(bot.request(rid).reviewed_by, String(U.admin.id));
});

test('همزمانی: دو درخواست در انتظار برای یک نفر → تأیید دوم با مبلغ قدیمی رد و مبلغ جدید پیشنهاد می‌شود', () => {
  const bot = createStandardBot();
  const a = submitRequest(bot, { user: U.ali, people: 'محمد', total: '3000000 ریال' });
  const b = submitRequest(bot, { user: U.reza, people: 'محمد', total: '3000000 ریال' });
  const cardB = bot.findButton(U.admin2, new RegExp('تأیید ۳٬۰۰۰٬۰۰۰'));
  approve(bot, U.admin, a);
  // admin2 کارت قدیمی b را می‌زند (مبلغ نمایش‌داده‌شده ۳٬۰۰۰٬۰۰۰ که دیگر معتبر نیست)
  const stale = bot.chat(U.admin2).filter((m) => m.text.includes(b) && bot.allButtons(m).some((x) => /^✅ تأیید/.test(x.text))).pop();
  const btn = bot.allButtons(stale).find((x) => /^✅ تأیید/.test(x.text));
  assert.ok(cardB && btn);
  bot.clickData(U.admin2, btn.callback_data, stale.message_id);
  assert.equal(bot.request(b).status, 'READY_FOR_REVIEW');
  assert.match(bot.last(U.admin2), /تغییر کرد/);
  bot.click(U.admin2, 'تأیید ۵۰۰٬۰۰۰');
  assert.equal(bot.request(b).approved_reimbursement_rial, 500000);
  const usage = bot.rows('RequestBeneficiaries').filter((x) => x.employee_id === bot.emp.mohammad.employee_id).reduce((s, x) => s + x.approved_allocation_rial, 0);
  assert.equal(usage, 3500000);
});

test('اسامی مشابه: دو «محمد» → انتخاب صریح employee_id', () => {
  const bot = createStandardBot();
  bot.addEmployee('محمد کاظمی', null);
  const rid = submitRequest(bot, { user: U.ali, people: 'خودم و محمد', ambiguous: ['محمد کاظمی'], total: '4000000 ریال', split: 'equal' });
  const names = bot.rows('RequestBeneficiaries').filter((b) => b.request_id === rid).map((b) => b.employee_name_snapshot).sort();
  assert.deepEqual(names, ['علی احمدی', 'محمد کاظمی'].sort());
});

test('نام ناشناس ثبت نمی‌شود و اطلاع داده می‌شود', () => {
  const bot = createStandardBot();
  goToAmountStep(bot, U.ali, 'خودم و حسین');
  assert.match(bot.last(U.ali), /پیدا نشدند[\s\S]*حسین/);
  assert.match(bot.last(U.ali), /افراد فعلی \(۱ نفر\): علی احمدی/);
});

test('رد درخواست: سقف آزاد می‌ماند؛ درخواست بعدی همان روز سقف کامل دارد', () => {
  const bot = createStandardBot();
  const a = submitRequest(bot, { user: U.ali, total: '3500000 ریال' });
  bot.send(U.admin, '/review ' + a);
  bot.click(U.admin, '❌ رد');
  bot.click(U.admin, 'نوشتن دلیل دیگر');
  bot.send(U.admin, 'فاکتور مربوط به شام است');
  assert.equal(bot.request(a).rejection_reason, 'فاکتور مربوط به شام است');
  const b = submitRequest(bot, { user: U.ali, total: '3500000 ریال' });
  assert.equal(approve(bot, U.admin, b).approved_reimbursement_rial, 3500000);
});

test('لغو تأیید (قبل از پرداخت) → پرداخت لغو، سقف آزاد، تاریخچه حفظ', () => {
  const bot = createStandardBot();
  const a = submitRequest(bot, { user: U.ali, total: '3000000 ریال' });
  approve(bot, U.admin, a);
  bot.click(U.admin, 'لغو تأیید');
  bot.send(U.admin, 'تأیید اشتباه بود');
  const r = bot.request(a);
  assert.equal(r.status, 'READY_FOR_REVIEW');
  assert.equal(bot.rows('Payments')[0].status, 'CANCELLED');
  bot.g.App_resetState_();
  assert.equal(bot.g.Req_usageForDate_('2026-10-31', '')[bot.emp.ali.employee_id], undefined);
  approve(bot, U.admin, a);
  const pays = bot.rows('Payments');
  assert.equal(pays.filter((p) => p.status !== 'CANCELLED').length, 1);
  assert.ok(bot.rows('AuditLog').some((x) => x.action === 'APPROVAL_REVOKED' && x.field_changes_json.previous_allocations[0].approved_allocation_rial === 3000000));
});

test('درخواست اصلاح: کاربر مبلغ را اصلاح و دوباره ارسال می‌کند', () => {
  const bot = createStandardBot();
  const a = submitRequest(bot, { user: U.ali, total: '3000000 ریال' });
  bot.send(U.admin, '/review ' + a);
  bot.click(U.admin, 'درخواست اصلاح');
  bot.click(U.admin, 'مبلغ فاکتور با رسید');
  assert.equal(bot.request(a).status, 'NEEDS_CORRECTION');
  bot.click(U.ali, 'اصلاح درخواست');
  bot.click(U.ali, 'مبلغ و سهم‌ها');
  bot.send(U.ali, '2500000 ریال');
  bot.click(U.ali, 'ارسال مجدد');
  const r = bot.request(a);
  assert.equal(r.status, 'READY_FOR_REVIEW');
  assert.equal(r.claimed_total_rial, 2500000);
  assert.match(bot.last(U.admin), /اصلاح‌شده/);
  assert.ok(bot.rows('AuditLog').some((x) => x.request_id === a && x.action === 'RESUBMITTED'));
});

test('اصلاح مبلغ توسط ادمین با دلیل و تاریخچه (تقسیم مساوی دوباره محاسبه می‌شود)', () => {
  const bot = createStandardBot();
  const a = submitRequest(bot, { user: U.ali, people: 'خودم و محمد', total: '8000000 ریال', split: 'equal' });
  bot.send(U.admin, '/review ' + a);
  bot.click(U.admin, 'اصلاح مبلغ');
  bot.send(U.admin, '600000');
  bot.click(U.admin, 'تومان ←');
  bot.send(U.admin, 'کسر هزینه نوشابه اضافه');
  const r = bot.request(a);
  assert.equal(r.eligible_total_rial, 6000000);
  assert.equal(r.non_eligible_rial, 2000000);
  assert.deepEqual(bot.rows('RequestBeneficiaries').filter((b) => b.request_id === a).map((b) => b.actual_cost_rial), [3000000, 3000000]);
  assert.ok(bot.rows('AuditLog').some((x) => x.action === 'AMOUNT_ADJUSTED' && x.field_changes_json.reason === 'کسر هزینه نوشابه اضافه'));
  assert.equal(approve(bot, U.admin, a).approved_reimbursement_rial, 6000000);
});

test('اختلاف جمع سهم‌ها با مبلغ کل → توزیع متناسب با اعداد صحیح', () => {
  const bot = createStandardBot();
  const a = submitRequest(bot, {
    user: U.ali, people: 'خودم و محمد', total: '12600000 ریال', split: 'individual', shares: ['5000000', '7000000'], mismatch: 'توزیع اختلاف'
  });
  const bens = bot.rows('RequestBeneficiaries').filter((b) => b.request_id === a).map((b) => b.actual_cost_rial);
  assert.deepEqual(bens, [5250000, 7350000]);
  assert.match(bot.request(a).flags, /PROPORTIONAL_DISTRIBUTION/);
});

test('چند تصویر برای یک مدرک + کپشن ذخیره می‌شود و فایل‌ها در Drive خصوصی‌اند', () => {
  const bot = createStandardBot();
  const a = submitRequest(bot, { user: U.ali, total: '2000000 ریال', purchasePhotos: 3, paymentPhotos: 2 });
  const docs = bot.rows('Documents').filter((d) => d.request_id === a);
  assert.equal(docs.filter((d) => d.document_kind === 'PURCHASE').length, 3);
  assert.equal(docs.filter((d) => d.document_kind === 'BANK_PAYMENT').length, 2);
  assert.ok(docs.every((d) => d.drive_file_id && d.sha256_if_available.length === 64));
  assert.equal(docs[0].caption, 'فاکتور');
  assert.deepEqual(bot.env.publicShares, []);
});

test('تصویر یکسان برای خرید و پرداخت پذیرفته نمی‌شود؛ تصویر تکراری بین درخواست‌ها علامت می‌خورد', () => {
  const bot = createStandardBot();
  bot.send(U.ali, '/new');
  bot.click(U.ali, 'سفارش آنلاین');
  bot.click(U.ali, 'بانکی/درگاه');
  bot.photo(U.ali, { fileId: 'SAME', uniqueId: 'SAMEU' });
  bot.click(U.ali, 'ثبت مدرک خرید');
  bot.photo(U.ali, { fileId: 'SAME', uniqueId: 'SAMEU' });
  assert.match(bot.last(U.ali), /دو تصویر مستقل/);
  bot.send(U.ali, '/cancel');
  const first = submitRequest(bot, { user: U.reza, total: '1000000 ریال' });
  const firstDoc = bot.rows('Documents').find((d) => d.request_id === first && d.document_kind === 'PURCHASE');
  bot.send(U.sara, '/new');
  bot.click(U.sara, 'سفارش آنلاین');
  bot.click(U.sara, 'بانکی/درگاه');
  bot.photo(U.sara, { fileId: 'X1', uniqueId: firstDoc.telegram_file_unique_id });
  assert.match(bot.last(U.sara), /قبلاً در درخواست دیگری/);
  const dup = bot.rows('Documents').filter((d) => /DUPLICATE_FILE/.test(d.verification_flags));
  assert.equal(dup.length, 1);
});

test('فایل خیلی بزرگ و فایل غیرمجاز رد می‌شوند', () => {
  const bot = createStandardBot();
  bot.send(U.ali, '/new');
  bot.click(U.ali, 'سفارش آنلاین');
  bot.click(U.ali, 'بانکی/درگاه');
  bot.photo(U.ali, { size: 25 * 1024 * 1024 });
  assert.match(bot.last(U.ali), /حجم فایل/);
  bot.document(U.ali, { mime: 'application/zip', name: 'a.zip' });
  assert.match(bot.last(U.ali), /پذیرفته نیست/);
  bot.document(U.ali, { mime: 'application/pdf' });
  assert.match(bot.last(U.ali), /تصویر ۱ دریافت شد/);
});

test('لغو درخواست نیمه‌کاره با /cancel و شروع دوباره', () => {
  const bot = createStandardBot();
  bot.send(U.ali, '/new');
  bot.click(U.ali, 'خرید حضوری');
  const rid = bot.lastRequest().request_id;
  bot.send(U.ali, '/cancel');
  assert.equal(bot.request(rid).status, 'CANCELLED');
  assert.match(bot.texts(U.ali).join('\n'), /لغو شد/);
  bot.send(U.ali, '/new');
  assert.match(bot.last(U.ali), /غذا را چگونه تهیه کرده‌اید/);
});

test('ادامه درخواست نیمه‌کاره و دکمه بازگشت', () => {
  const bot = createStandardBot();
  bot.send(U.ali, '/new');
  bot.click(U.ali, 'سفارش آنلاین');
  bot.click(U.ali, 'بانکی/درگاه');
  bot.click(U.ali, 'بازگشت');
  assert.match(bot.last(U.ali), /چگونه پرداخت کرده‌اید/);
  bot.send(U.ali, '/new');
  assert.match(bot.last(U.ali), /نیمه‌کاره/);
  bot.click(U.ali, 'ادامه همان درخواست');
  assert.match(bot.last(U.ali), /چگونه پرداخت کرده‌اید/);
});

test('مرز نیمه‌شب تهران: «امروز» ساعت ۲۳:۵۹ و ۰۰:۰۰ تاریخ متفاوت ثبت می‌کند', () => {
  const bot = createStandardBot({ now: '2026-10-30T20:29:00Z' });
  const a = submitRequest(bot, { user: U.ali, total: '1000000 ریال' });
  assert.equal(bot.request(a).order_date_iso, '2026-10-30');
  bot.setNow('2026-10-30T20:31:00Z');
  const b = submitRequest(bot, { user: U.reza, total: '1000000 ریال' });
  assert.equal(bot.request(b).order_date_iso, '2026-10-31');
  assert.equal(bot.request(b).order_date_jalali, '1405/08/09');
});

test('تاریخ دیگر: تاریخ آینده و قدیمی‌تر از سیاست رد می‌شود', () => {
  const bot = createStandardBot();
  bot.send(U.ali, '/new');
  bot.click(U.ali, 'سفارش آنلاین');
  bot.click(U.ali, 'بانکی/درگاه');
  bot.photo(U.ali);
  bot.click(U.ali, 'ثبت مدرک خرید');
  bot.photo(U.ali);
  bot.click(U.ali, 'ثبت مدرک پرداخت');
  bot.click(U.ali, 'تاریخ دیگر');
  bot.send(U.ali, '1405/08/20');
  assert.match(bot.last(U.ali), /نمی‌تواند در آینده باشد/);
  bot.send(U.ali, '1405/06/01');
  assert.match(bot.last(U.ali), /فقط سفارش‌های ۳۰ روز اخیر/);
  bot.send(U.ali, 'فردا');
  assert.match(bot.last(U.ali), /قابل تشخیص نیست/);
  const bot2 = createStandardBot();
  const rid = submitRequest(bot2, { user: U.ali, date: '۱۴۰۵/۰۸/۰۵', total: '1000000 ریال' });
  assert.equal(bot2.request(rid).order_date_iso, '2026-10-27');
});

test('ارسال آزاد متنی: برداشت قاعده‌محور، تأیید کاربر و تکمیل فرم با مدارک اجباری', () => {
  const bot = createStandardBot();
  bot.send(U.ali, 'من امروز برای خودم، محمد و رضا از اسنپ‌فود غذا گرفتم. جمعش یک میلیون و دویست و شصت هزار تومان شد، خودم از کارت بانکی پرداخت کردم.');
  const card = bot.last(U.ali);
  assert.match(card, /سفارش آنلاین/);
  assert.match(card, /بانکی/);
  assert.match(card, /محمد رضایی/);
  assert.match(card, /۱۲٬۶۰۰٬۰۰۰ ریال/);
  bot.click(U.ali, 'شروع ثبت با همین اطلاعات');
  assert.match(bot.last(U.ali), /تصویر فاکتور/, 'مدرک خرید همچنان لازم است');
  bot.photo(U.ali);
  bot.click(U.ali, 'ثبت مدرک خرید');
  bot.photo(U.ali);
  bot.click(U.ali, 'ثبت مدرک پرداخت');
  bot.click(U.ali, 'تأیید همین افراد');
  bot.click(U.ali, 'از پیام شما');
  bot.click(U.ali, 'سهم مساوی');
  bot.click(U.ali, 'رد شدن');
  bot.click(U.ali, 'تأیید و ثبت');
  const r = bot.lastRequest();
  assert.equal(r.status, 'READY_FOR_REVIEW');
  assert.equal(r.claimed_total_rial, 12600000);
  assert.equal(r.calculated_reimbursement_rial, 10500000);
  assert.match(r.flags, /FREE_TEXT_PREFILL/);
});

test('ویس بدون AI: پیام راهنما، ویس در پرونده می‌ماند و کار متوقف نمی‌شود', () => {
  const bot = createStandardBot();
  bot.send(U.ali, '/new');
  bot.click(U.ali, 'سفارش آنلاین');
  bot.voice(U.ali);
  assert.match(bot.last(U.ali), /ویس دریافت شد/);
  assert.equal(bot.rows('Documents').filter((d) => d.document_kind === 'VOICE_NOTE').length, 1);
});

test('خطای شبکه تلگرام: خطا ثبت می‌شود، داده‌ها حفظ می‌شوند و تلاش بعدی موفق است', () => {
  const bot = createStandardBot();
  bot.send(U.ali, '/new');
  bot.tg.fail = { method: 'editMessageText', network: true, once: false };
  bot.click(U.ali, 'سفارش آنلاین');
  bot.tg.fail = null;
  assert.match(bot.last(U.ali), /چگونه پرداخت/, 'در صورت شکست ویرایش، پیام جدید ارسال می‌شود');
  bot.click(U.ali, 'بانکی/درگاه');
  bot.tg.fail = { method: 'sendMessage', network: true, once: true };
  bot.send(U.ali, '/new');
  assert.match(bot.last(U.ali), /خطای موقت/);
  const errors = bot.rows('AuditLog').filter((a) => a.action === 'ERROR');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].error_code_optional, 'TG_NETWORK');
  assert.ok(!JSON.stringify(errors).includes('TEST_TOKEN'), 'توکن در لاگ نیست');
  bot.send(U.ali, '/new');
  bot.click(U.ali, 'ادامه همان درخواست');
  assert.match(bot.last(U.ali), /تصویر فاکتور/, 'پیش‌نویس از دست نرفته است');
});

test('خطای پیش‌بینی‌نشده در پردازش: پیام خطای مؤدبانه و ثبت ERROR بدون از دست رفتن پیش‌نویس', () => {
  const bot = createStandardBot();
  bot.send(U.ali, '/new');
  bot.click(U.ali, 'سفارش آنلاین');
  const original = bot.g.Doc_save_;
  bot.g.Doc_save_ = () => { throw new Error('boom'); };
  bot.click(U.ali, 'بانکی/درگاه');
  bot.photo(U.ali);
  bot.g.Doc_save_ = original;
  assert.match(bot.last(U.ali), /خطای موقت/);
  const pu = bot.rows('ProcessedUpdates');
  assert.equal(pu[pu.length - 1].processing_result, 'ERROR');
  bot.photo(U.ali);
  assert.match(bot.last(U.ali), /تصویر ۱ دریافت شد/);
});

test('قفل مشغول: کاربر مطلع می‌شود و update پردازش‌نشده باقی نمی‌ماند تا تکرار شود', () => {
  const bot = createStandardBot();
  bot.env.lockAvailable = false;
  bot.send(U.ali, '/new');
  assert.match(bot.last(U.ali), /مشغول|در حال پردازش/);
  bot.env.lockAvailable = true;
  bot.send(U.ali, '/new');
  assert.match(bot.last(U.ali), /غذا را چگونه/);
});

test('سقف تاریخ‌دار (CapSchedule) بدون تغییر گزارش‌های تأییدشده گذشته', () => {
  const bot = createStandardBot();
  const a = submitRequest(bot, { user: U.ali, total: '5000000 ریال' });
  approve(bot, U.admin, a);
  bot.g.App_resetState_();
  bot.g.Db_insert_('CapSchedule', { effective_from_iso: '1405/08/09', cap_rial: 4000000, note: 'افزایش', created_at: '' });
  const b = submitRequest(bot, { user: U.reza, total: '5000000 ریال' });
  assert.equal(approve(bot, U.admin, b).approved_reimbursement_rial, 4000000);
  assert.equal(bot.request(a).approved_reimbursement_rial, 3500000);
  assert.equal(bot.request(a).cap_rial_applied, 3500000);
});

test('مانده سقف امروز (/balance) فقط اطلاعات خود کاربر را نشان می‌دهد', () => {
  const bot = createStandardBot();
  const a = submitRequest(bot, { user: U.ali, people: 'خودم و محمد', total: '4000000 ریال', split: 'equal' });
  approve(bot, U.admin, a);
  bot.send(U.mohammad, '/balance');
  const t = bot.last(U.mohammad);
  assert.match(t, /مصرف‌شده \(تأییدشده\): ۲٬۰۰۰٬۰۰۰ ریال/);
  assert.match(t, /مانده: <b>۱٬۵۰۰٬۰۰۰ ریال/);
  assert.ok(!t.includes('علی'));
});

test('درخواست‌های من: کاربر فقط درخواست‌های خودش را می‌بیند', () => {
  const bot = createStandardBot();
  const a = submitRequest(bot, { user: U.ali, total: '1000000 ریال' });
  bot.send(U.reza, '/status ' + a);
  assert.match(bot.last(U.reza), /پیدا نشد/);
  bot.send(U.ali, '/myrequests');
  assert.ok(bot.buttons(U.ali).some((b) => b.includes(a)));
});
