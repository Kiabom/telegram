/**
 * Telegram.gs — کلاینت Telegram Bot API و سازنده کیبوردها.
 * توکن هرگز در پیام خطا، لاگ یا متن کاربر نمایش داده نمی‌شود.
 */

function Tg_token_() {
  var t = Utils_getProp_(PROP.BOT_TOKEN);
  if (!t) throw new Error('BOT_TOKEN در Script Properties تنظیم نشده است.');
  return t;
}

function Tg_isBlob_(v) {
  return v && typeof v === 'object' && typeof v.getBytes === 'function';
}

/** فراخوانی متد Bot API؛ در صورت خطا Error با code مثل TG_400 / TG_NETWORK پرتاب می‌شود. */
function Tg_call_(method, payload, retried) {
  var url = 'https://api.telegram.org/bot' + Tg_token_() + '/' + method;
  payload = payload || {};
  var params = { method: 'post', muteHttpExceptions: true };
  var hasBlob = Object.keys(payload).some(function (k) { return Tg_isBlob_(payload[k]); });
  if (hasBlob) {
    var p = {};
    Object.keys(payload).forEach(function (k) {
      var v = payload[k];
      if (v === undefined || v === null) return;
      p[k] = Tg_isBlob_(v) ? v : (typeof v === 'object' ? JSON.stringify(v) : String(v));
    });
    params.payload = p;
  } else {
    params.contentType = 'application/json';
    params.payload = JSON.stringify(payload);
  }
  var resp;
  try {
    resp = UrlFetchApp.fetch(url, params);
  } catch (e) {
    var ne = new Error('TG_NETWORK ' + method + ': ' + Utils_redact_(e && e.message));
    ne.code = 'TG_NETWORK';
    throw ne;
  }
  var code = resp.getResponseCode();
  var body = Utils_safeJsonParse_(resp.getContentText(), null);
  if (code === 429 && !retried && body && body.parameters && body.parameters.retry_after <= 3) {
    Utilities.sleep(body.parameters.retry_after * 1000);
    return Tg_call_(method, payload, true);
  }
  if (!body || !body.ok) {
    var err = new Error('TG_API ' + method + ' ' + code + ': ' + Utils_redact_(body && body.description || ''));
    err.code = 'TG_' + code;
    err.description = body && body.description || '';
    throw err;
  }
  return body.result;
}

/**
 * متن بلندتر از محدودیت تلگرام: برش وسط تگ HTML باعث خطای parse می‌شود، پس تگ‌ها حذف و متن ساده ارسال می‌شود.
 */
function Tg_prepareText_(text) {
  var t = String(text === null || text === undefined ? '' : text);
  if (t.length <= 4096) return { text: t, parse_mode: 'HTML' };
  var plain = t.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return { text: Utils_truncate_(plain, 4096), parse_mode: undefined };
}

function Tg_send_(chatId, text, markup, extra) {
  var prepared = Tg_prepareText_(text);
  var payload = {
    chat_id: chatId,
    text: prepared.text,
    parse_mode: prepared.parse_mode,
    disable_web_page_preview: true
  };
  if (markup) payload.reply_markup = markup;
  Object.keys(extra || {}).forEach(function (k) { payload[k] = extra[k]; });
  return Tg_call_('sendMessage', payload);
}

/** ارسال بدون پرتاب خطا (برای اعلان‌ها؛ مثلاً اگر کاربر ربات را بلاک کرده باشد). */
function Tg_trySend_(chatId, text, markup) {
  try {
    return Tg_send_(chatId, text, markup);
  } catch (e) {
    console.warn('send failed to ' + chatId + ': ' + Utils_redact_(e.message));
    return null;
  }
}

function Tg_edit_(chatId, messageId, text, markup) {
  var prepared = Tg_prepareText_(text);
  var payload = {
    chat_id: chatId, message_id: messageId, text: prepared.text,
    parse_mode: prepared.parse_mode, disable_web_page_preview: true
  };
  if (markup) payload.reply_markup = markup;
  try {
    return Tg_call_('editMessageText', payload);
  } catch (e) {
    if (String(e.description || '').indexOf('message is not modified') >= 0) return null;
    throw e;
  }
}

function Tg_clearKeyboard_(chatId, messageId) {
  try {
    Tg_call_('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
  } catch (e) { /* پیام قدیمی یا بدون کیبورد */ }
}

function Tg_answer_(callbackId, text, alert) {
  try {
    Tg_call_('answerCallbackQuery', { callback_query_id: callbackId, text: text ? Utils_truncate_(text, 190) : undefined, show_alert: !!alert });
  } catch (e) {
    console.warn('answerCallbackQuery failed: ' + Utils_redact_(e.message));
  }
}

function Tg_sendDocument_(chatId, blob, caption) {
  return Tg_call_('sendDocument', { chat_id: String(chatId), document: blob, caption: Utils_truncate_(caption || '', 1000), parse_mode: 'HTML' });
}

/** ارسال مجدد فایل موجود در تلگرام با file_id (برای نمایش مدارک به ادمین). */
function Tg_sendExisting_(chatId, media, fileId, caption) {
  var method = media === 'photo' ? 'sendPhoto' : (media === 'voice' ? 'sendVoice' : 'sendDocument');
  var payload = { chat_id: chatId, caption: Utils_truncate_(caption || '', 1000), parse_mode: 'HTML' };
  payload[media === 'photo' ? 'photo' : (media === 'voice' ? 'voice' : 'document')] = fileId;
  return Tg_call_(method, payload);
}

function Tg_getFile_(fileId) {
  return Tg_call_('getFile', { file_id: fileId });
}

function Tg_downloadFile_(filePath) {
  var url = 'https://api.telegram.org/file/bot' + Tg_token_() + '/' + filePath;
  var resp;
  try {
    resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  } catch (e) {
    var ne = new Error('TG_DOWNLOAD_NETWORK: ' + Utils_redact_(e && e.message));
    ne.code = 'TG_NETWORK';
    throw ne;
  }
  if (resp.getResponseCode() !== 200) {
    var err = new Error('TG_DOWNLOAD_' + resp.getResponseCode());
    err.code = 'TG_DOWNLOAD';
    throw err;
  }
  return resp.getBlob();
}

// ---------------------------------------------------------------------------
// کیبوردها
// ---------------------------------------------------------------------------

/** دکمه inline؛ callback_data باید ASCII و حداکثر ۶۴ بایت باشد. */
function Btn_(text, data) {
  if (data && data.length > 64) throw new Error('CALLBACK_DATA_TOO_LONG:' + data);
  return { text: text, callback_data: data };
}

function BtnUrl_(text, url) {
  return { text: text, url: url };
}

function Kb_inline_(rows) {
  return {
    inline_keyboard: rows.map(function (row) { return row.filter(Boolean); })
      .filter(function (row) { return row.length; })
  };
}

var MENU_ = {
  NEW: '➕ ثبت هزینه ناهار',
  MY: '📋 درخواست‌های من',
  BALANCE: '💰 مانده سقف امروز',
  HELP: 'ℹ️ راهنما',
  PENDING: '🗂 درخواست‌های در انتظار',
  UNPAID: '💵 پرداخت‌نشده‌ها',
  REPORT: '📊 گزارش امروز'
};

/** کیبورد اصلی (Reply Keyboard) متناسب با نقش. */
function Kb_mainMenu_(auth) {
  var rows = [];
  if (auth && auth.employee) {
    rows.push([MENU_.NEW]);
    rows.push([MENU_.MY, MENU_.BALANCE]);
  }
  if (Auth_can_(auth, 'REVIEW')) rows.push([MENU_.PENDING, MENU_.UNPAID]);
  if (Auth_can_(auth, 'REPORT')) rows.push([MENU_.REPORT]);
  rows.push([MENU_.HELP]);
  return {
    keyboard: rows.map(function (r) { return r.map(function (t) { return { text: t }; }); }),
    resize_keyboard: true,
    is_persistent: true
  };
}
