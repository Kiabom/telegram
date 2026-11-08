/**
 * Setup.gs — راه‌اندازی تکرارپذیر (idempotent) و توابع عمومی قابل اجرا از ویرایشگر Apps Script.
 *
 * ترتیب پیشنهادی (جزئیات در README_FA.md):
 *   1) در Script Properties مقدار BOT_TOKEN و OWNER_TELEGRAM_IDS را بگذارید.
 *   2) setup را اجرا و مجوزها را تأیید کنید.
 *   3) Deploy → Web app (Execute as: Me، Who has access: Anyone) و آدرس /exec را در WEB_APP_URL بگذارید.
 *   4) setWebhook را اجرا کنید؛ سپس checkWebhook.
 */

/** ساخت/تکمیل شیت‌ها، تنظیمات پیش‌فرض، پوشه‌های خصوصی Drive و secret وبهوک. */
function setup() {
  var props = Utils_props_();
  var log = [];
  var ss = null;
  var ssId = props.getProperty(PROP.SPREADSHEET_ID);
  if (ssId) {
    try { ss = SpreadsheetApp.openById(ssId); } catch (e) { ss = null; }
  }
  if (!ss) {
    try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e2) { ss = null; }
    if (!ss) ss = SpreadsheetApp.create('LunchBot Database');
    props.setProperty(PROP.SPREADSHEET_ID, ss.getId());
    log.push('✅ Spreadsheet: ' + ss.getUrl());
  }
  ss.setSpreadsheetTimeZone(APP.TZ);
  Object.keys(SCHEMA).forEach(function (name) { Setup_ensureSheet_(ss, name); });
  ss.getSheets().forEach(function (sh) {
    if (!SCHEMA[sh.getName()] && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
  Db_reset_();
  var added = Setup_ensureSettings_();
  log.push('✅ شیت‌ها آماده‌اند. تنظیمات جدید اضافه‌شده: ' + added);

  var root = Setup_folder_(PROP.ROOT_FOLDER_ID, 'LunchBot Data (Private)', null);
  Setup_folder_(PROP.DOCS_FOLDER_ID, 'Documents', root);
  Setup_folder_(PROP.REPORTS_FOLDER_ID, 'Reports', root);
  try {
    if (root.getSharingAccess() !== DriveApp.Access.PRIVATE) log.push('⚠️ پوشه Drive خصوصی نیست! اشتراک‌گذاری عمومی/لینک را از Drive حذف کنید.');
    else log.push('✅ پوشه خصوصی Drive: ' + root.getName());
  } catch (e3) {
    log.push('ℹ️ وضعیت اشتراک پوشه قابل بررسی نبود؛ دستی بررسی کنید که پوشه Share نشده باشد.');
  }

  if (!props.getProperty(PROP.WEBHOOK_SECRET)) {
    props.setProperty(PROP.WEBHOOK_SECRET, Utils_randomCode_(40));
    log.push('✅ WEBHOOK_SECRET ساخته شد.');
  }
  if (!props.getProperty(PROP.UPDATE_MODE)) props.setProperty(PROP.UPDATE_MODE, 'WEBHOOK');
  if (!props.getProperty(PROP.BOT_TOKEN)) {
    log.push('⚠️ BOT_TOKEN تنظیم نشده است (Project Settings → Script Properties).');
  } else {
    try {
      var me = Tg_call_('getMe', {});
      props.setProperty(PROP.BOT_USERNAME, me.username || '');
      log.push('✅ اتصال به تلگرام برقرار است: @' + me.username);
    } catch (e4) {
      log.push('⚠️ اتصال به تلگرام ناموفق بود: ' + Utils_redact_(e4.message));
    }
  }
  log.push(Auth_ownerIds_().length ? '✅ مالک(ها): ' + Auth_ownerIds_().join(', ') : '⚠️ OWNER_TELEGRAM_IDS تنظیم نشده است.');
  var out = log.join('\n');
  Logger.log(out);
  return out;
}

function Setup_ensureSheet_(ss, name) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var cols = SCHEMA[name];
  var headers = cols.map(function (c) { return c[0]; });
  var lastCol = sh.getLastColumn();
  var existing = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  if (!existing.filter(String).length) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    existing = headers.slice();
  } else {
    headers.forEach(function (h) {
      if (existing.indexOf(h) < 0) {
        existing.push(h);
        sh.getRange(1, existing.length).setValue(h);
      }
    });
  }
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, existing.length).setFontWeight('bold').setBackground('#E8EEF7');
  Setup_ensureFormats_(sh, name, existing);
  if (name === SHEETS.EMPLOYEES) {
    var roleCol = existing.indexOf('role') + 1;
    var rule = SpreadsheetApp.newDataValidation().requireValueInList(Object.keys(ROLE_FA), true).setAllowInvalid(false).build();
    sh.getRange(2, roleCol, Math.max(sh.getMaxRows() - 1, 1), 1).setDataValidation(rule);
  }
  return sh;
}

/** فرمت متنی برای ستون‌های رشته‌ای (جلوگیری از تبدیل خودکار به تاریخ/عدد) و ذخیره ردیف خالی کافی. */
function Setup_ensureFormats_(sh, name, headers) {
  var minFree = 500;
  var free = sh.getMaxRows() - Math.max(sh.getLastRow(), 1);
  if (free < minFree) sh.insertRowsAfter(sh.getMaxRows(), minFree * 2 - free);
  var types = Db_types_(name);
  var rows = sh.getMaxRows() - 1;
  headers.forEach(function (h, i) {
    var t = types[h];
    if (!t) return;
    sh.getRange(2, i + 1, rows, 1).setNumberFormat(t === 'int' ? '0' : '@');
  });
}

function Setup_ensureSettings_() {
  var existing = {};
  Db_all_(SHEETS.SETTINGS).forEach(function (r) { existing[String(r.key).trim()] = true; });
  var added = 0;
  DEFAULT_SETTINGS.forEach(function (d) {
    if (existing[d[0]]) return;
    Db_insert_(SHEETS.SETTINGS, { key: d[0], value: d[1], description: d[2], updated_at: Utils_nowIso_() });
    added++;
  });
  Settings_clearCache_();
  return added;
}

function Setup_folder_(propKey, name, parent) {
  var props = Utils_props_();
  var id = props.getProperty(propKey);
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* پوشه پاک شده؛ دوباره ساخته می‌شود */ }
  }
  var folder = parent ? parent.createFolder(name) : DriveApp.createFolder(name);
  props.setProperty(propKey, folder.getId());
  return folder;
}

/** تنظیم Webhook تلگرام روی آدرس Web App + secret مسیر. */
function setWebhook() {
  var url = Utils_getProp_(PROP.WEB_APP_URL) || ScriptApp.getService().getUrl();
  if (!url || !/\/exec$/.test(url)) {
    throw new Error('آدرس Web App (پایان‌یافته با /exec) را در Script Property به نام WEB_APP_URL قرار دهید.');
  }
  var secret = Utils_getProp_(PROP.WEBHOOK_SECRET);
  if (!secret) throw new Error('ابتدا setup را اجرا کنید.');
  Tg_call_('setWebhook', {
    url: url + '?k=' + encodeURIComponent(secret),
    allowed_updates: ['message', 'callback_query'],
    max_connections: 5,
    drop_pending_updates: false
  });
  Utils_setProp_(PROP.UPDATE_MODE, 'WEBHOOK');
  App_resetState_();
  Triggers_install_();
  Setup_setDefaultCommands_();
  var msg = '✅ Webhook تنظیم شد. اکنون checkWebhook را اجرا کنید و در تلگرام /start بزنید.';
  Logger.log(msg);
  return msg;
}

/** وضعیت Webhook (بدون نمایش secret). */
function checkWebhook() {
  var info = Tg_call_('getWebhookInfo', {});
  var out = [
    'url: ' + String(info.url || '').replace(/\?.*$/, '?k=***'),
    'pending_update_count: ' + info.pending_update_count,
    'last_error: ' + (info.last_error_message ? info.last_error_message + ' @ ' + new Date(info.last_error_date * 1000) : 'ندارد'),
    'mode: ' + (Utils_getProp_(PROP.UPDATE_MODE) || 'WEBHOOK')
  ].join('\n');
  if (/302|Moved/i.test(info.last_error_message || '')) {
    out += '\n⚠️ خطای 302: استقرار Web App را با Who has access = Anyone بررسی کنید؛ اگر ادامه داشت enablePollingMode را اجرا کنید.';
  }
  Logger.log(out);
  return out;
}

/** تعویض secret وبهوک (مثلاً اگر آدرس لو رفته باشد). */
function rotateWebhookSecret() {
  Utils_setProp_(PROP.WEBHOOK_SECRET, Utils_randomCode_(40));
  return setWebhook();
}

/** حالت پشتیبان: دریافت پیام‌ها با getUpdates هر دقیقه (اگر Webhook روی حساب شما کار نکرد). */
function enablePollingMode() {
  Tg_call_('deleteWebhook', { drop_pending_updates: false });
  Utils_setProp_(PROP.UPDATE_MODE, 'POLLING');
  App_resetState_();
  Triggers_install_();
  Setup_setDefaultCommands_();
  var msg = '✅ حالت Polling فعال شد (تأخیر پاسخ حداکثر حدود یک دقیقه).';
  Logger.log(msg);
  return msg;
}

function enableWebhookMode() {
  return setWebhook();
}

function deleteWebhook() {
  Tg_call_('deleteWebhook', { drop_pending_updates: false });
  Logger.log('Webhook حذف شد.');
}

function installTriggers() {
  App_resetState_();
  Triggers_install_();
  Logger.log('✅ تریگرها نصب شدند.');
}

/** آزمایش واقعی تولید Excel و PDF و ارسال به مالک‌ها (برای چک‌لیست استقرار). */
function sendTestReport() {
  App_resetState_();
  var today = Utils_todayIso_();
  var model = Rep_build_(today, today, { includeAudit: true, includeEvidence: true, type: 'DAILY', generatedBy: 'SETUP_TEST' });
  var files = Rep_generate_(model);
  Auth_ownerIds_().forEach(function (id) { Rep_sendTo_(id, model, files); });
  Logger.log('✅ گزارش آزمایشی ساخته و برای مالک ارسال شد. XLSX: ' + files.xlsxId + ' PDF: ' + files.pdfId);
}

function clearSettingsCache() {
  Settings_clearCache_();
  Logger.log('✅ کش تنظیمات پاک شد.');
}

var BOT_COMMANDS_ = {
  employee: [
    ['new', 'ثبت هزینه ناهار'], ['myrequests', 'درخواست‌های من'], ['status', 'وضعیت درخواست با کد'],
    ['balance', 'مانده سقف امروز'], ['cancel', 'لغو فرم جاری'], ['help', 'راهنما']
  ],
  admin: [
    ['pending', 'درخواست‌های در انتظار'], ['unpaid', 'تأییدشده‌های پرداخت‌نشده'], ['review', 'بررسی درخواست با کد'],
    ['dailyreport', 'گزارش روزانه'], ['monthlyreport', 'گزارش ماهانه'], ['export', 'گزارش بازه دلخواه'],
    ['reports', 'گزارش‌های بایگانی‌شده'], ['employees', 'مدیریت کارکنان'], ['settings', 'تنظیمات']
  ],
  viewer: [['dailyreport', 'گزارش روزانه'], ['monthlyreport', 'گزارش ماهانه'], ['export', 'گزارش بازه دلخواه']]
};

function Setup_cmdList_(pairs) {
  return pairs.map(function (p) { return { command: p[0], description: p[1] }; });
}

function Setup_setDefaultCommands_() {
  try {
    Tg_call_('setMyCommands', { commands: Setup_cmdList_(BOT_COMMANDS_.employee), scope: { type: 'all_private_chats' } });
    Auth_chatIdsWith_('REVIEW').forEach(function (id) { Setup_setCommandsFor_(id, ROLES.FINANCE_ADMIN); });
    Auth_chatIdsWith_('REPORT').forEach(function (id) {
      if (Auth_chatIdsWith_('REVIEW').indexOf(id) < 0) Setup_setCommandsFor_(id, ROLES.REPORT_VIEWER);
    });
  } catch (e) {
    console.warn('setMyCommands failed: ' + Utils_redact_(e.message));
  }
}

/** منوی فرمان‌ها متناسب با نقش در چت همان کاربر (غیرحیاتی). */
function Setup_setCommandsFor_(chatId, role) {
  var list = BOT_COMMANDS_.employee.slice();
  if (PERMISSIONS.REVIEW.indexOf(role) >= 0) list = list.concat(BOT_COMMANDS_.admin);
  else if (PERMISSIONS.REPORT.indexOf(role) >= 0) list = list.concat(BOT_COMMANDS_.viewer);
  try {
    Tg_call_('setMyCommands', { commands: Setup_cmdList_(list), scope: { type: 'chat', chat_id: Number(chatId) } });
  } catch (e) {
    console.warn('setMyCommands(chat) failed: ' + Utils_redact_(e.message));
  }
}
