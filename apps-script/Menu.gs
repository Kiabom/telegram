/**
 * Menu.gs — امکانات کارمند: شروع، راهنما، مانده سقف، درخواست‌های من، وضعیت، اصلاح درخواست برگشتی.
 * هر کاربر فقط درخواست‌هایی را می‌بیند که خودش ثبت کرده یا پرداخت‌کننده آن است.
 */

function Menu_start_(ctx) {
  var name = ctx.auth.employee ? ctx.auth.employee.full_name_fa : Auth_displayName_(ctx.from);
  Ui_send_(ctx, 'سلام ' + Utils_escapeHtml_(name) + '! به ربات مدیریت هزینه ناهار خوش آمدید. 🍽\n' +
    'نقش شما: ' + (ROLE_FA[ctx.auth.role] || '—') + '\nلطفاً یکی از گزینه‌های منوی پایین را انتخاب کنید.', Kb_mainMenu_(ctx.auth));
}

function Menu_help_(ctx) {
  var cap = Settings_capForDate_(Utils_todayIso_());
  var L = [
    'ℹ️ <b>راهنما</b>',
    '• سقف بازپرداخت هر نفر در هر روز: <b>' + Utils_formatRial_(cap) + '</b> (همه مبالغ به ریال).',
    '• اگر برای چند نفر غذا گرفته‌اید، اسم همه را ثبت کنید؛ سقف هر نفر جدا حساب می‌شود ولی کل مبلغ مجاز به پرداخت‌کننده سفارش پرداخت می‌شود.',
    '• دو مدرک لازم است: ۱) فاکتور یا اسکرین‌شات سفارش ۲) رسید پرداخت بانکی یا تراکنش اعتباری (عکس موجودی کافی نیست).',
    '• هنگام نوشتن مبلغ، واحد (ریال یا تومان) را بنویسید؛ اگر ننویسید ربات می‌پرسد.',
    '• می‌توانید جزئیات سفارش را یک‌جا در یک پیام بنویسید تا ربات فرم را برایتان پر کند.',
    '• مبلغ نهایی فقط پس از تأیید ادمین مالی قطعی می‌شود.',
    '',
    'فرمان‌ها: /new ثبت هزینه | /myrequests درخواست‌های من | /status کد | /balance مانده سقف | /cancel لغو فرم'
  ];
  if (Auth_can_(ctx.auth, 'REVIEW')) {
    L.push('');
    L.push('ادمین: /pending در انتظار | /unpaid پرداخت‌نشده‌ها | /review کد | /reports گزارش‌های قبلی | /employees کارکنان | /settings تنظیمات');
  }
  if (Auth_can_(ctx.auth, 'REPORT')) {
    L.push('گزارش: /dailyreport [تاریخ] | /monthlyreport [۱۴۰۵/۰۸] | /export از تا (مثلاً /export 1405/08/01 1405/08/15)');
  }
  if (Auth_can_(ctx.auth, 'SETTINGS_EDIT')) L.push('مالک: /set KEY VALUE');
  Ui_send_(ctx, L.join('\n'), Kb_mainMenu_(ctx.auth));
}

function Menu_balance_(ctx) {
  if (!ctx.auth.employee) return Ui_send_(ctx, 'برای مشاهده مانده سقف باید در فهرست کارکنان باشید.');
  var me = ctx.auth.employee.employee_id;
  var today = Utils_todayIso_();
  var cap = Settings_capForDate_(today);
  var used = Req_usageForDate_(today, '')[me] || 0;
  var pendingReqs = {};
  Db_all_(SHEETS.REQUESTS).forEach(function (r) {
    if (r.order_date_iso === today && r.status === STATUS.READY_FOR_REVIEW) pendingReqs[r.request_id] = true;
  });
  var pendingCost = 0, pendingCount = 0;
  Db_all_(SHEETS.BENEFICIARIES).forEach(function (b) {
    if (b.employee_id === me && pendingReqs[b.request_id]) { pendingCost += b.actual_cost_rial; pendingCount++; }
  });
  var remaining = Math.max(0, cap - used);
  Ui_send_(ctx, '💰 <b>مانده سقف امروز</b> (' + Jal_formatLong_(today) + ')\n' +
    'سقف روزانه: ' + Utils_formatRial_(cap) + '\n' +
    'مصرف‌شده (تأییدشده): ' + Utils_formatRial_(used) + '\n' +
    'مانده: <b>' + Utils_formatRial_(remaining) + '</b>' +
    (pendingCount ? '\n⏳ در انتظار بررسی: ' + Utils_faDigits_(pendingCount) + ' درخواست با سهم ' + Utils_formatRial_(pendingCost) + ' (هنوز از سقف کم نشده)' : ''),
    Kb_mainMenu_(ctx.auth));
}

function Menu_canView_(ctx, req) {
  if (Auth_can_(ctx.auth, 'REVIEW')) return true;
  if (String(req.submitter_telegram_id) === ctx.tgId) return true;
  return !!(ctx.auth.employee && req.payer_employee_id === ctx.auth.employee.employee_id);
}

function Menu_myRequests_(ctx) {
  var me = ctx.auth.employee ? ctx.auth.employee.employee_id : '-';
  var list = Db_find_(SHEETS.REQUESTS, function (r) {
    return (String(r.submitter_telegram_id) === ctx.tgId || r.payer_employee_id === me) && !(r.status === STATUS.CANCELLED && !r.submitted_at);
  }).sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); }).slice(0, 10);
  if (!list.length) return Ui_send_(ctx, 'هنوز درخواستی ثبت نکرده‌اید.', Kb_mainMenu_(ctx.auth));
  var rows = list.map(function (r) {
    var amount = r.status === STATUS.APPROVED || r.status === STATUS.PAID ? r.approved_reimbursement_rial : r.calculated_reimbursement_rial;
    return [Btn_((STATUS_ICON[r.status] || '') + ' ' + r.request_id + ' • ' + Jal_formatShortFa_(r.order_date_iso || Utils_isoDatePart_(r.created_at)) +
      (amount ? ' • ' + Utils_formatNumberFa_(amount) : ''), 'my|v|' + r.request_id)];
  });
  Ui_send_(ctx, '📋 <b>درخواست‌های اخیر شما</b> (مبالغ به ریال):', Kb_inline_(rows));
}

function Menu_detailText_(req) {
  var bens = Req_bens_(req.request_id);
  var L = [
    (STATUS_ICON[req.status] || '') + ' <b>درخواست <code>' + req.request_id + '</code></b>',
    'وضعیت: ' + (STATUS_FA[req.status] || req.status),
    'تاریخ سفارش: ' + (req.order_date_iso ? Jal_formatLong_(req.order_date_iso) : '—'),
    'خرید: ' + (CHANNEL_FA[req.purchase_channel] || '—') + ' | پرداخت: ' + (PAY_METHOD_FA[req.payment_method] || '—')
  ];
  if (req.payer_employee_id) L.push('پرداخت‌کننده: ' + Utils_escapeHtml_(Emp_name_(req.payer_employee_id)));
  if (bens.length) L.push('افراد: ' + bens.map(function (b) { return Utils_escapeHtml_(b.employee_name_snapshot); }).join('، '));
  if (req.claimed_total_rial) L.push('مبلغ فاکتور: ' + Utils_formatRial_(req.claimed_total_rial));
  if (req.status === STATUS.APPROVED || req.status === STATUS.PAID) L.push('مبلغ تأییدشده: <b>' + Utils_formatRial_(req.approved_reimbursement_rial) + '</b>');
  else if (req.calculated_reimbursement_rial) L.push('مبلغ پیشنهادی (تخمینی): ' + Utils_formatRial_(req.calculated_reimbursement_rial));
  if (req.rejection_reason && [STATUS.REJECTED, STATUS.NEEDS_CORRECTION].indexOf(req.status) >= 0) L.push('دلیل: ' + Utils_escapeHtml_(req.rejection_reason));
  if (req.paid_at) L.push('تاریخ پرداخت: ' + Jal_formatDateTimeFa_(req.paid_at));
  return L.join('\n');
}

function Menu_requestDetail_(ctx, rid) {
  var req = Req_get_(Utils_normalizeDigits_(rid).trim().toUpperCase());
  if (!req || !Menu_canView_(ctx, req)) return Ui_reply_(ctx, 'درخواستی با این کد برای شما پیدا نشد.');
  var mine = String(req.submitter_telegram_id) === ctx.tgId;
  var rows = [];
  if (mine && DRAFT_STATUSES.indexOf(req.status) >= 0) rows.push([Btn_('▶️ ادامه', 'my|r|' + req.request_id), Btn_('❌ لغو', 'my|c|' + req.request_id)]);
  if (mine && req.status === STATUS.NEEDS_CORRECTION) rows.push([Btn_('✏️ اصلاح درخواست', 'my|f|' + req.request_id), Btn_('❌ لغو', 'my|c|' + req.request_id)]);
  if (mine && req.status === STATUS.READY_FOR_REVIEW) rows.push([Btn_('❌ انصراف از درخواست', 'my|c|' + req.request_id)]);
  Ui_reply_(ctx, Menu_detailText_(req), rows.length ? Kb_inline_(rows) : null);
}

function Menu_onCallback_(ctx, act, rid) {
  var req = Req_get_(rid);
  if (!req || !Menu_canView_(ctx, req)) return Ui_toast_(ctx, 'درخواست پیدا نشد.', true);
  var mine = String(req.submitter_telegram_id) === ctx.tgId;
  var s = ctx.sess;
  switch (act) {
    case 'v':
      return Menu_requestDetail_(ctx, rid);
    case 'c':
      if (!mine) return Ui_toast_(ctx, 'فقط ثبت‌کننده می‌تواند لغو کند.', true);
      return Ui_reply_(ctx, 'درخواست <code>' + rid + '</code> لغو شود؟', Kb_inline_([[Btn_('بله، لغو شود', 'my|cy|' + rid), Btn_('خیر', 'my|v|' + rid)]]));
    case 'cy':
      var r = Req_cancelByUser_(rid, ctx.tgId);
      if (!r.ok) return Ui_reply_(ctx, 'لغو ممکن نیست؛ وضعیت فعلی: ' + (STATUS_FA[(r.req || req).status] || r.code));
      if (s.data_json.d && s.data_json.d.rid === rid) Sess_clearDraft_(s);
      ctx.requestId = rid;
      Ui_reply_(ctx, '🚫 درخواست <code>' + rid + '</code> لغو شد.');
      if (r.previous === STATUS.READY_FOR_REVIEW || r.previous === STATUS.NEEDS_CORRECTION) {
        Adm_reviewerIds_().forEach(function (id) { Tg_trySend_(id, '🚫 درخواست <code>' + rid + '</code> توسط ثبت‌کننده لغو شد.'); });
      }
      return;
    case 'r':
      if (s.data_json.d && s.data_json.d.rid === rid) return Wiz_render_(ctx);
      return Ui_reply_(ctx, 'این پیش‌نویس دیگر در فرم فعال شما نیست؛ لطفاً آن را لغو و درخواست جدید ثبت کنید.', Kb_inline_([[Btn_('❌ لغو پیش‌نویس', 'my|c|' + rid)]]));
    case 'f':
      if (!mine) return Ui_toast_(ctx, 'فقط ثبت‌کننده می‌تواند اصلاح کند.', true);
      if (req.status !== STATUS.NEEDS_CORRECTION) return Ui_toast_(ctx, 'این درخواست در وضعیت «نیازمند اصلاح» نیست.', true);
      var cur = s.data_json.d;
      if (cur && cur.rid !== rid && cur.mode === 'NEW') {
        var curReq = Req_get_(cur.rid);
        if (curReq && DRAFT_STATUSES.indexOf(curReq.status) >= 0) return Ui_reply_(ctx, '⚠️ یک فرم نیمه‌کاره دیگر (<code>' + cur.rid + '</code>) دارید؛ ابتدا آن را تکمیل یا با /cancel لغو کنید.');
      }
      var d = Req_toDraft_(req);
      s.data_json.d = d;
      d.sub = 'EDIT_MENU';
      d.subFor = 'W_SUMMARY';
      if (Wiz_resolve_(d) !== 'W_SUMMARY') d.sub = null;
      return Wiz_render_(ctx, '✏️ اصلاح درخواست <code>' + rid + '</code>\nدلیل ادمین: ' + Utils_escapeHtml_(req.rejection_reason || '—') +
        '\nبخش موردنظر را اصلاح کنید و سپس «ارسال مجدد» را بزنید. برای افزودن مدرک، «مدارک خرید/پرداخت» را انتخاب کنید.');
  }
  Ui_toast_(ctx, '');
}
