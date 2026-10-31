/**
 * Join.gs — عضویت کارکنان: کاربر ناشناس نام خود را می‌فرستد، ادمین تأیید/رد یا به ردیف موجود وصل می‌کند.
 * ثبت دستی در شیت Employees (نام + Telegram ID + active=TRUE) هم همیشه کار می‌کند.
 */

function Join_handle_(ctx) {
  var s = ctx.sess, text = (ctx.text || '').trim();
  var idLine = 'شناسه تلگرام شما: <code>' + ctx.tgId + '</code>';
  if (ctx.auth.rawEmployee && !ctx.auth.rawEmployee.active && !ctx.auth.isOwner) {
    return Ui_send_(ctx, '⛔️ حساب شما در ربات غیرفعال است. لطفاً با ادمین مالی تماس بگیرید.\n' + idLine);
  }
  if (/^\//.test(text) || !text) {
    var pending = Join_pendingFor_(ctx.tgId);
    if (pending) return Ui_send_(ctx, '⏳ درخواست عضویت شما («' + Utils_escapeHtml_(pending.requested_full_name) + '») در انتظار تأیید ادمین است.\n' + idLine);
    s.step = 'J_NAME';
    return Ui_send_(ctx, '👋 سلام! به ربات مدیریت هزینه ناهار خوش آمدید.\n' +
      (ctx.auth.isOwner ? 'شما مالک ربات هستید. ' : 'شما هنوز در فهرست کارکنان ثبت نشده‌اید.\n') +
      'لطفاً <b>نام و نام خانوادگی</b> خود را به فارسی بفرستید' + (ctx.auth.isOwner ? ' تا پروفایل شما ساخته شود.' : ' تا درخواست عضویت برای ادمین ارسال شود.') +
      '\n\n' + idLine, { remove_keyboard: true });
  }
  if (s.step !== 'J_NAME') {
    if (Join_pendingFor_(ctx.tgId)) return Ui_send_(ctx, '⏳ درخواست عضویت شما در انتظار تأیید ادمین است.');
    s.step = 'J_NAME';
    return Ui_send_(ctx, 'برای استفاده از ربات ابتدا نام و نام خانوادگی خود را به فارسی بفرستید.\n' + idLine);
  }
  var name = Names_normalizeLetters_(text).replace(/\s+/g, ' ').trim();
  if (name.length < 3 || name.length > 60 || /^\//.test(name) || /\d/.test(Utils_normalizeDigits_(name))) {
    return Ui_send_(ctx, 'نام معتبر نیست؛ لطفاً فقط نام و نام خانوادگی را بنویسید (مثلاً: علی احمدی).');
  }
  if (ctx.auth.isOwner) {
    var emp = Emp_create_({ full_name_fa: name, telegram_user_id: ctx.tgId, role: ROLES.OWNER, telegram_username_snapshot: ctx.from.username || '' }, ctx.tgId);
    s.step = 'IDLE';
    ctx.auth = Auth_resolve_(ctx.from);
    Setup_setCommandsFor_(ctx.tgId, ROLES.OWNER);
    return Ui_send_(ctx, '✅ پروفایل شما (' + Utils_escapeHtml_(emp.full_name_fa) + ') با نقش «مالک ربات» ساخته شد.\nکارکنان با /start درخواست عضویت می‌فرستند و شما یا ادمین مالی تأیید می‌کنید.', Kb_mainMenu_(ctx.auth));
  }
  var jr = Db_insert_(SHEETS.JOIN_REQUESTS, {
    join_id: Utils_newId_('J'),
    telegram_user_id: ctx.tgId,
    telegram_name: Auth_displayName_(ctx.from),
    telegram_username: ctx.from.username || '',
    requested_full_name: name,
    status: 'PENDING',
    employee_id: '',
    decided_by: '',
    decided_at: '',
    created_at: Utils_nowIso_()
  });
  Audit_log_('', ctx.tgId, 'JOIN_REQUESTED', '', 'PENDING', { join_id: jr.join_id, name: name });
  s.step = 'J_WAIT';
  Auth_chatIdsWith_('MANAGE_EMPLOYEES').forEach(function (chatId) {
    var card = Join_card_(jr);
    Tg_trySend_(chatId, card.text, card.kb);
  });
  Ui_send_(ctx, '✅ درخواست عضویت شما برای ادمین ارسال شد. پس از تأیید، از همین‌جا اطلاع می‌دهیم.');
}

function Join_pendingFor_(tgId) {
  var list = Db_find_(SHEETS.JOIN_REQUESTS, function (j) { return String(j.telegram_user_id) === String(tgId) && j.status === 'PENDING'; });
  return list.length ? list[list.length - 1] : null;
}

function Join_card_(jr) {
  var similar = Emp_all_().filter(function (e) {
    return Names_key_(e.full_name_fa) === Names_key_(jr.requested_full_name) || Names_matchOne_(jr.requested_full_name, [e]).type === 'MATCH';
  });
  var text = '🙋 <b>درخواست عضویت</b>\nنام اعلام‌شده: <b>' + Utils_escapeHtml_(jr.requested_full_name) + '</b>\n' +
    'نام تلگرام: ' + Utils_escapeHtml_(jr.telegram_name) + (jr.telegram_username ? ' (@' + Utils_escapeHtml_(jr.telegram_username) + ')' : '') +
    '\nTelegram ID: <code>' + jr.telegram_user_id + '</code>\n⚠️ هویت را از روی Telegram ID تطبیق دهید، نه نام کاربری.' +
    (similar.length ? '\n🔎 نام‌های مشابه در فهرست: ' + similar.map(function (e) { return Utils_escapeHtml_(e.full_name_fa); }).join('، ') : '');
  var kb = Kb_inline_([
    [Btn_('✅ تأیید به‌عنوان کارمند جدید', 'jr|ok|' + jr.join_id)],
    [Btn_('🔗 اتصال به کارمند موجود در فهرست', 'jr|ln|' + jr.join_id)],
    [Btn_('❌ رد', 'jr|no|' + jr.join_id)]
  ]);
  return { text: text, kb: kb };
}

function Join_onCallback_(ctx, act, jid, arg) {
  if (!Adm_require_(ctx, 'MANAGE_EMPLOYEES')) return;
  var jr = Db_findOne_(SHEETS.JOIN_REQUESTS, 'join_id', jid);
  if (!jr) return Ui_toast_(ctx, 'درخواست پیدا نشد.', true);
  if (act === 'v') { var c = Join_card_(jr); return Ui_reply_(ctx, c.text + '\nوضعیت: ' + jr.status, jr.status === 'PENDING' ? c.kb : null); }
  if (jr.status !== 'PENDING') return Ui_reply_(ctx, 'این درخواست قبلاً بررسی شده است (' + jr.status + ').');
  var existing = Emp_byTelegramId_(jr.telegram_user_id);
  var now = Utils_nowIso_();
  if (act === 'ok') {
    if (existing) return Ui_toast_(ctx, 'این Telegram ID قبلاً به ' + existing.full_name_fa + ' متصل است.', true);
    var emp = Emp_create_({ full_name_fa: jr.requested_full_name, telegram_user_id: jr.telegram_user_id, telegram_username_snapshot: jr.telegram_username }, ctx.tgId);
    return Join_finish_(ctx, jr, emp, now);
  }
  if (act === 'ln') {
    var free = Emp_all_().filter(function (e) { return !e.telegram_user_id; });
    if (!free.length) return Ui_toast_(ctx, 'کارمند بدون Telegram ID در فهرست نیست. ابتدا نام او را در شیت Employees اضافه کنید.', true);
    var rows = free.slice(0, 30).map(function (e) { return [Btn_(e.full_name_fa, 'jr|lk|' + jid + '|' + e.employee_id)]; });
    rows.push([Btn_('⬅️ بازگشت', 'jr|v|' + jid)]);
    return Ui_reply_(ctx, 'درخواست «' + Utils_escapeHtml_(jr.requested_full_name) + '» به کدام کارمند فهرست وصل شود؟', Kb_inline_(rows));
  }
  if (act === 'lk') {
    if (existing) return Ui_toast_(ctx, 'این Telegram ID قبلاً به ' + existing.full_name_fa + ' متصل است.', true);
    var target = Emp_byId_(arg);
    if (!target || target.telegram_user_id) return Ui_toast_(ctx, 'این ردیف در دسترس نیست.', true);
    Emp_update_(target, { telegram_user_id: jr.telegram_user_id, active: true, telegram_username_snapshot: jr.telegram_username }, ctx.tgId, 'EMPLOYEE_LINKED');
    return Join_finish_(ctx, jr, target, now);
  }
  if (act === 'no') {
    Db_update_(SHEETS.JOIN_REQUESTS, jr, { status: 'REJECTED', decided_by: ctx.tgId, decided_at: now });
    Audit_log_('', ctx.tgId, 'JOIN_REJECTED', 'PENDING', 'REJECTED', { join_id: jid });
    Tg_trySend_(jr.telegram_user_id, '⛔️ درخواست عضویت شما در ربات هزینه ناهار تأیید نشد. برای پیگیری با ادمین مالی تماس بگیرید.');
    var us = Sess_get_(jr.telegram_user_id);
    if (!us.__new) { us.step = 'IDLE'; Sess_save_(us); }
    return Ui_reply_(ctx, '❌ درخواست عضویت «' + Utils_escapeHtml_(jr.requested_full_name) + '» رد شد.');
  }
  Ui_toast_(ctx, '');
}

function Join_finish_(ctx, jr, emp, now) {
  Db_update_(SHEETS.JOIN_REQUESTS, jr, { status: 'APPROVED', employee_id: emp.employee_id, decided_by: ctx.tgId, decided_at: now });
  Audit_log_('', ctx.tgId, 'JOIN_APPROVED', 'PENDING', 'APPROVED', { join_id: jr.join_id, employee_id: emp.employee_id });
  var us = Sess_get_(jr.telegram_user_id);
  us.step = 'IDLE';
  Sess_save_(us);
  Setup_setCommandsFor_(jr.telegram_user_id, emp.role);
  Tg_trySend_(jr.telegram_user_id, '🎉 عضویت شما تأیید شد (' + Utils_escapeHtml_(emp.full_name_fa) + ').\nاز منوی پایین «➕ ثبت هزینه ناهار» را بزنید.',
    Kb_mainMenu_({ employee: emp, role: emp.role }));
  Ui_reply_(ctx, '✅ ' + Utils_escapeHtml_(emp.full_name_fa) + ' به‌عنوان کارمند فعال ثبت شد.');
}
