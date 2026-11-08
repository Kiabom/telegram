/**
 * Router.gs — نقطه ورود Webhook (doPost)، idempotency، قفل سراسری و مسیریابی پیام‌ها/دکمه‌ها.
 *
 * چرخه:
 *   Telegram update → بررسی secret مسیر → حذف تکراری‌ها (update_id) → دانلود فایل (خارج از قفل)
 *   → قفل سراسری → شناسایی کاربر/نقش/وضعیت مکالمه → اجرای مرحله → ذخیره + Audit → پاسخ تلگرام
 *   → آزاد کردن قفل → کارهای سنگین (گزارش) پس از قفل.
 *
 * نکته امنیتی: Apps Script به هدر X-Telegram-Bot-Api-Secret-Token دسترسی نمی‌دهد؛ به‌جای آن یک
 * پارامتر محرمانه طولانی و قابل تعویض (?k=...) در آدرس Webhook بررسی می‌شود (جزئیات در SECURITY.md).
 * پاسخ با HtmlService برگردانده می‌شود (ContentService ریدایرکت 302 می‌دهد و تلگرام آن را خطا می‌داند).
 */

function doPost(e) {
  try {
    var secret = Utils_getProp_(PROP.WEBHOOK_SECRET);
    var given = e && e.parameter ? e.parameter.k : '';
    if (!secret || !Utils_safeEquals_(given, secret)) {
      console.warn('webhook rejected: invalid secret');
      return HtmlService.createHtmlOutput('forbidden');
    }
    var update = Utils_safeJsonParse_(e.postData && e.postData.contents, null);
    if (!update || update.update_id === undefined) return HtmlService.createHtmlOutput('ignored');
    Router_processUpdate_(update);
  } catch (err) {
    console.error('doPost: ' + Utils_redact_(err && (err.stack || err.message)));
  }
  return HtmlService.createHtmlOutput('ok');
}

function doGet() {
  return HtmlService.createHtmlOutput('OK');
}

function App_resetState_() {
  Db_reset_();
  Settings_reset_();
}

function Router_updateType_(u) {
  var keys = Object.keys(u).filter(function (k) { return k !== 'update_id'; });
  return keys[0] || 'unknown';
}

/** پردازش یک update (مشترک بین Webhook و Polling). */
function Router_processUpdate_(update) {
  App_resetState_();
  if (CacheService.getScriptCache().get('upd_' + update.update_id)) return 'DUPLICATE';
  var prefetched = Router_prefetch_(update);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(APP.LOCK_WAIT_MS)) {
    Router_notifyBusy_(update);
    return 'BUSY';
  }
  var rowIdx = null, ctx = null, deferred = [];
  try {
    App_resetState_();
    if (Idem_isProcessed_(update.update_id)) return 'DUPLICATE';
    var from = (update.message && update.message.from) || (update.callback_query && update.callback_query.from) || null;
    rowIdx = Idem_markReceived_(update.update_id, Router_updateType_(update), from ? String(from.id) : '');
    ctx = Router_buildCtx_(update, prefetched);
    if (ctx) {
      var before = JSON.stringify([ctx.sess.step, ctx.sess.seq, ctx.sess.data_json]);
      Router_dispatch_(ctx);
      if (ctx.cb && !ctx.answered) Tg_answer_(ctx.cb.id);
      if (ctx.sess.__new || before !== JSON.stringify([ctx.sess.step, ctx.sess.seq, ctx.sess.data_json])) Sess_save_(ctx.sess);
      deferred = ctx.deferred;
    }
    Idem_finish_(rowIdx, ctx ? ctx.result : 'IGNORED', ctx ? ctx.requestId : '');
  } catch (err) {
    Audit_error_('UPDATE_' + update.update_id, err, ctx ? ctx.tgId : '', ctx ? ctx.requestId : '');
    try { Idem_finish_(rowIdx, 'ERROR', ''); } catch (e2) { /* ignore */ }
    if (ctx && ctx.cb && !ctx.answered) Tg_answer_(ctx.cb.id, 'خطای موقت؛ لطفاً دوباره تلاش کنید.', true);
    if (ctx && ctx.chatType === 'private') Tg_trySend_(ctx.chatId, '⚠️ خطای موقت رخ داد؛ اطلاعات قبلی شما حفظ شده است. لطفاً چند لحظه بعد دوباره تلاش کنید.');
  } finally {
    lock.releaseLock();
  }
  deferred.forEach(function (fn) {
    try { App_resetState_(); fn(); } catch (e3) { Audit_error_('DEFERRED', e3, ctx ? ctx.tgId : ''); }
  });
  return 'OK';
}

/** دانلود فایل کارکنان فعال پیش از گرفتن قفل، تا ارسال آلبوم چندتصویری صف طولانی نسازد. */
function Router_prefetch_(update) {
  try {
    var msg = update.message;
    if (!msg || !msg.chat || msg.chat.type !== 'private' || !msg.from) return null;
    var info = Doc_fileInfo_(msg);
    if (!info || info.unsupported) return null;
    var emp = Emp_byTelegramId_(String(msg.from.id));
    if (!emp || !emp.active) return null;
    return Doc_download_(info);
  } catch (e) {
    return null;
  }
}

function Router_notifyBusy_(update) {
  var text = '⏳ سیستم در حال پردازش پیام‌های دیگر است؛ لطفاً چند ثانیه دیگر همین مورد را دوباره ارسال کنید.';
  try {
    if (update.callback_query) Tg_answer_(update.callback_query.id, text, true);
    else if (update.message && update.message.chat && update.message.chat.type === 'private') Tg_trySend_(update.message.chat.id, text);
    Audit_log_('', '', 'LOCK_TIMEOUT', '', '', { update_id: update.update_id }, 'LOCK_TIMEOUT');
  } catch (e) { /* ignore */ }
}

function Router_buildCtx_(update, prefetched) {
  var msg = update.message, cb = update.callback_query;
  if (!msg && !cb) return null;
  var from = msg ? msg.from : cb.from;
  if (!from || from.is_bot) return null;
  var chat = msg ? msg.chat : (cb.message && cb.message.chat);
  var ctx = {
    update: update, from: from, tgId: String(from.id),
    chatId: chat ? chat.id : from.id, chatType: chat ? chat.type : 'private',
    msg: msg || (cb && cb.message) || null, cb: cb || null,
    text: msg ? String(msg.text || '').trim() : '',
    prefetched: prefetched, deferred: [], result: 'OK', requestId: '',
    forceNew: false, answered: false
  };
  ctx.defer = function (fn) { ctx.deferred.push(fn); };
  ctx.auth = Auth_resolve_(from);
  ctx.sess = Sess_get_(ctx.tgId);
  return ctx;
}

// ---------------------------------------------------------------------------
// پاسخ‌دهی
// ---------------------------------------------------------------------------

function Ui_send_(ctx, text, markup) {
  return Tg_send_(ctx.chatId, text, markup);
}

/** در پاسخ به دکمه، همان پیام ویرایش می‌شود؛ در غیر این صورت پیام جدید ارسال می‌شود. */
function Ui_reply_(ctx, text, markup) {
  var inline = !markup || !!markup.inline_keyboard;
  if (ctx.cb && ctx.cb.message && !ctx.forceNew && inline) {
    try {
      Tg_edit_(ctx.chatId, ctx.cb.message.message_id, text, markup || { inline_keyboard: [] });
      ctx.forceNew = true;
      return;
    } catch (e) {
      console.warn('edit failed, sending new message: ' + Utils_redact_(e.message));
    }
  }
  Tg_send_(ctx.chatId, text, markup);
}

function Ui_toast_(ctx, text, alert) {
  if (!ctx.cb || ctx.answered) return;
  ctx.answered = true;
  Tg_answer_(ctx.cb.id, text, alert);
}

// ---------------------------------------------------------------------------
// مسیریابی
// ---------------------------------------------------------------------------

/** متن دکمه‌های منوی اصلی → فرمان (تابع، تا به ترتیب بارگذاری فایل‌ها وابسته نباشد). */
function Router_menuCommand_(text) {
  var map = {};
  map[MENU_.NEW] = 'new';
  map[MENU_.MY] = 'myrequests';
  map[MENU_.BALANCE] = 'balance';
  map[MENU_.HELP] = 'help';
  map[MENU_.RANGE] = 'reportmenu';
  map[MENU_.PENDING] = 'pending';
  map[MENU_.UNPAID] = 'unpaid';
  map[MENU_.REPORT] = 'dailyreport';
  return map[text] || null;
}

function Router_parseCommand_(text) {
  var m = String(text || '').match(/^\/([a-zA-Z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
  if (m) return { name: m[1].toLowerCase(), args: (m[2] || '').trim() };
  var menu = Router_menuCommand_(text);
  return menu ? { name: menu, args: '' } : null;
}

function Router_dispatch_(ctx) {
  if (ctx.chatType !== 'private') return Router_group_(ctx);
  if (ctx.cb) return Router_callback_(ctx);
  var s = ctx.sess;
  var cmd = Router_parseCommand_(ctx.text);
  if (!ctx.auth.employee) {
    var ownerAdminCmd = ctx.auth.isOwner && cmd && cmd.name !== 'start' && s.step !== 'J_NAME';
    if (!ownerAdminCmd) return Join_handle_(ctx);
  }
  if (cmd) return Router_command_(ctx, cmd.name, cmd.args);
  if (s.data_json.pi && /^RANGE_/.test(s.data_json.pi.k) && ctx.text) return Rep_onRangeText_(ctx, ctx.text);
  if (s.data_json.pi && ctx.text) return Adm_onPendingText_(ctx, ctx.text);
  var paidInfo = s.data_json.pi && (s.data_json.pi.k === 'PAID_PHOTO' || s.data_json.pi.k === 'PAID_REF') ? Doc_fileInfo_(ctx.msg) : null;
  if (paidInfo) return Adm_onPaidReceipt_(ctx, paidInfo);

  var inWizard = !!(s.data_json.d && /^W_/.test(s.step));
  var info = Doc_fileInfo_(ctx.msg);
  if (info) {
    if (info.unsupported) return Ui_send_(ctx, '⚠️ ' + Doc_errorFa_('UNSUPPORTED'));
    if (inWizard) return Wiz_onFile_(ctx, info, ctx.prefetched);
    if (info.media === 'voice') return Free_handleVoice_(ctx, info, ctx.prefetched);
    return Ui_send_(ctx, '📎 برای ثبت مدرک، ابتدا «➕ ثبت هزینه ناهار» را بزنید و تصویر را در مرحله مدرک خرید/پرداخت بفرستید.', Kb_mainMenu_(ctx.auth));
  }
  if (!ctx.text) return Ui_send_(ctx, 'این نوع پیام پشتیبانی نمی‌شود؛ لطفاً متن، عکس یا PDF بفرستید.');
  if (inWizard) return Wiz_onText_(ctx, ctx.text);
  return Free_handleText_(ctx, ctx.text);
}

function Router_command_(ctx, name, args) {
  switch (name) {
    case 'start': return Menu_start_(ctx);
    case 'help': return Menu_help_(ctx);
    case 'myid': return Ui_send_(ctx, 'شناسه تلگرام شما: <code>' + ctx.tgId + '</code>');
    case 'new': return Wiz_start_(ctx);
    case 'myrequests': return Menu_myRequests_(ctx);
    case 'status': return args ? Menu_requestDetail_(ctx, args) : Menu_myRequests_(ctx);
    case 'balance': return Menu_balance_(ctx);
    case 'cancel': return Router_cancel_(ctx);
    case 'pending': return Adm_pending_(ctx);
    case 'unpaid': return Adm_unpaid_(ctx);
    case 'review':
      if (!Adm_require_(ctx, 'REVIEW')) return;
      return args ? Adm_openCard_(ctx, Utils_normalizeDigits_(args).trim().toUpperCase()) : Adm_pending_(ctx);
    case 'dailyreport': return Rep_command_(ctx, 'daily', args);
    case 'monthlyreport': return Rep_command_(ctx, 'monthly', args);
    case 'export': return Rep_command_(ctx, 'export', args);
    case 'reports': return Rep_listArchive_(ctx);
    case 'reportmenu': return Rep_menu_(ctx);
    case 'employees': return Adm_employees_(ctx, 0);
    case 'settings': return Adm_settings_(ctx);
    case 'set': return Adm_set_(ctx, args);
  }
  Ui_send_(ctx, 'فرمان ناشناخته است. /help را بزنید.', Kb_mainMenu_(ctx.auth));
}

function Router_cancel_(ctx) {
  var s = ctx.sess;
  if (s.data_json.pi) {
    delete s.data_json.pi;
    return Ui_send_(ctx, '↩️ عملیات ادمین لغو شد.');
  }
  if (s.data_json.d) return Wiz_cancel_(ctx);
  delete s.data_json.fx;
  delete s.data_json.vt;
  s.step = 'IDLE';
  Ui_send_(ctx, 'فرم فعالی وجود ندارد.', Kb_mainMenu_(ctx.auth));
}

function Router_callback_(ctx) {
  var parts = String(ctx.cb.data || '').split('|');
  var p = parts[0];
  if (!ctx.auth.role) return Ui_toast_(ctx, 'ابتدا باید عضویت شما تأیید شود. /start', true);
  switch (p) {
    case 'w':
      if (!Auth_can_(ctx.auth, 'SUBMIT')) return Ui_toast_(ctx, 'دسترسی ندارید.', true);
      return Wiz_onCallback_(ctx, parts[1], parts[2], parts[3]);
    case 'fx': return Free_onCallback_(ctx, parts[1], parts[2]);
    case 'fv': return Free_onVoiceCallback_(ctx, parts[1], parts[2]);
    case 'ad': return Adm_onCallback_(ctx, parts[1], parts[2], parts[3]);
    case 'rs':
    case 'rq': return Adm_onReason_(ctx, p, parts[1], parts[2]);
    case 'jr': return Join_onCallback_(ctx, parts[1], parts[2], parts[3]);
    case 'em': return Adm_onEmployeeCallback_(ctx, parts[1], parts[2], parts[3]);
    case 'my': return Menu_onCallback_(ctx, parts[1], parts[2]);
    case 'rp': return Rep_onMenuCallback_(ctx, parts[1]);
  }
  Ui_toast_(ctx, 'این دکمه دیگر معتبر نیست.', true);
}

/** در گروه هیچ اطلاعات مالی پردازش نمی‌شود؛ فقط راهنمای ورود به چت خصوصی. */
function Router_group_(ctx) {
  if (ctx.cb) return Ui_toast_(ctx, 'لطفاً در چت خصوصی با ربات کار کنید.', true);
  var cmd = Router_parseCommand_(ctx.text);
  if (!cmd || ['start', 'help', 'new'].indexOf(cmd.name) < 0) return;
  var username = Utils_getProp_(PROP.BOT_USERNAME);
  Tg_trySend_(ctx.chatId, '🔒 برای حفظ حریم خصوصی، ثبت هزینه و ارسال رسیدها فقط در چت خصوصی با ربات انجام می‌شود.',
    username ? Kb_inline_([[BtnUrl_('ورود به چت خصوصی ربات', 'https://t.me/' + username + '?start=lunch')]]) : null);
}
