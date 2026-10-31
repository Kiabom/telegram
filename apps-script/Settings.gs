/**
 * Settings.gs — خواندن/نوشتن تنظیمات شیت Settings و سقف تاریخ‌دار (CapSchedule) + Audit Log.
 */

var SETTINGS_MEMO_ = null;
var SETTINGS_CACHE_KEY_ = 'settings_v1';

function Settings_reset_() {
  SETTINGS_MEMO_ = null;
}

function Settings_all_() {
  if (SETTINGS_MEMO_) return SETTINGS_MEMO_;
  var cache = CacheService.getScriptCache();
  var cached = cache.get(SETTINGS_CACHE_KEY_);
  if (cached) {
    SETTINGS_MEMO_ = Utils_safeJsonParse_(cached, null);
    if (SETTINGS_MEMO_) return SETTINGS_MEMO_;
  }
  var map = {};
  DEFAULT_SETTINGS.forEach(function (s) { map[s[0]] = s[1]; });
  Db_all_(SHEETS.SETTINGS).forEach(function (r) {
    var k = String(r.key || '').trim();
    if (k) map[k] = String(r.value === undefined ? '' : r.value).trim();
  });
  cache.put(SETTINGS_CACHE_KEY_, JSON.stringify(map), 120);
  SETTINGS_MEMO_ = map;
  return map;
}

function Settings_clearCache_() {
  CacheService.getScriptCache().remove(SETTINGS_CACHE_KEY_);
  SETTINGS_MEMO_ = null;
}

function Settings_str_(key) {
  var v = Settings_all_()[key];
  return v === undefined || v === null ? '' : String(v);
}

function Settings_bool_(key) {
  return Utils_toBool_(Settings_str_(key));
}

function Settings_int_(key) {
  var s = Utils_normalizeDigits_(Settings_str_(key)).replace(/[,٬\s]/g, '');
  var n = Number(s);
  if (!isFinite(n)) {
    var def = DEFAULT_SETTINGS.filter(function (d) { return d[0] === key; })[0];
    n = def ? Number(def[1]) : 0;
  }
  return Math.round(n);
}

/** تغییر تنظیم (فقط کلیدهای مجاز) با ثبت در Audit Log. */
function Settings_set_(key, value, actorId) {
  if (EDITABLE_SETTING_KEYS.indexOf(key) < 0) return { ok: false, error: 'KEY_NOT_EDITABLE' };
  var def = DEFAULT_SETTINGS.filter(function (d) { return d[0] === key; })[0];
  var v = String(value).trim();
  if (/^(TRUE|FALSE)$/i.test(def[1]) && !/^(TRUE|FALSE)$/i.test(v)) return { ok: false, error: 'EXPECT_BOOL' };
  if (/^\d+$/.test(def[1])) {
    v = Utils_normalizeDigits_(v).replace(/[,٬\s]/g, '');
    if (!/^\d+$/.test(v)) return { ok: false, error: 'EXPECT_INT' };
  }
  if (/^(TRUE|FALSE)$/i.test(v)) v = v.toUpperCase();
  var row = Db_findOne_(SHEETS.SETTINGS, 'key', key);
  var prev = row ? row.value : def[1];
  if (row) Db_update_(SHEETS.SETTINGS, row, { value: v, updated_at: Utils_nowIso_() });
  else Db_insert_(SHEETS.SETTINGS, { key: key, value: v, description: def[2], updated_at: Utils_nowIso_() });
  Settings_clearCache_();
  Audit_log_('', actorId, 'SETTING_CHANGED', '', '', { key: key, from: prev, to: v });
  return { ok: true, previous: prev, value: v };
}

/**
 * سقف روزانه برای یک تاریخ: آخرین ردیف CapSchedule با effective_from <= تاریخ، وگرنه DAILY_CAP_RIAL.
 * تاریخ CapSchedule می‌تواند میلادی (2026-11-22) یا شمسی (1405/09/01) نوشته شود.
 */
function Settings_capForDate_(iso) {
  var cap = Settings_int_('DAILY_CAP_RIAL');
  var best = null;
  Db_all_(SHEETS.CAP_SCHEDULE).forEach(function (r) {
    var from = String(r.effective_from_iso || '').trim();
    if (from.indexOf('/') >= 0) from = Jal_parseUserDate_(from) || '';
    if (!Utils_isValidIso_(from) || !(r.cap_rial > 0) || from > iso) return;
    if (!best || from >= best.from) best = { from: from, cap: r.cap_rial };
  });
  return best ? best.cap : cap;
}

/** سیاست هزینه‌های جانبی: فهرست مواردی که قابل بازپرداخت نیستند. */
function Settings_nonEligibleItems_() {
  var items = [];
  if (!Settings_bool_('ELIGIBLE_DELIVERY_FEE')) items.push('هزینه ارسال');
  if (!Settings_bool_('ELIGIBLE_PACKAGING_FEE')) items.push('هزینه بسته‌بندی');
  if (!Settings_bool_('ELIGIBLE_TAX')) items.push('مالیات/عوارض');
  if (!Settings_bool_('ELIGIBLE_TIP')) items.push('انعام/کارمزد');
  return items;
}

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------

function Audit_log_(requestId, actorId, action, prevState, newState, changes, errorCode) {
  try {
    Db_insert_(SHEETS.AUDIT, {
      event_id: Utils_newId_('EV'),
      request_id: requestId || '',
      actor_telegram_id: actorId ? String(actorId) : '',
      action: action,
      previous_state: prevState || '',
      new_state: newState || '',
      field_changes_json: changes || {},
      created_at: Utils_nowIso_(),
      error_code_optional: errorCode || ''
    });
  } catch (e) {
    console.error('AUDIT_WRITE_FAILED ' + Utils_redact_(e && e.message));
  }
}

function Audit_error_(context, err, actorId, requestId) {
  var msg = Utils_redact_(err && (err.stack || err.message) || String(err));
  console.error('[' + context + '] ' + msg);
  Audit_log_(requestId || '', actorId, 'ERROR', '', '', { context: context, message: Utils_truncate_(msg, 1500) },
    (err && err.code) || 'UNHANDLED');
}
