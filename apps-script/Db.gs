/**
 * Db.gs — لایه دسترسی به Google Sheets (مخزن داده) + idempotency به‌روزرسانی‌های تلگرام.
 *
 * نکات:
 *  - Sheets پایگاه داده تراکنشی نیست؛ همزمانی با LockService (قفل سراسری در Router) کنترل می‌شود.
 *  - داده هر شیت در طول یک اجرا memo می‌شود تا تعداد فراخوانی‌ها کم بماند.
 *  - رشته‌هایی که با = + - @ شروع شوند با ' ذخیره می‌شوند تا فرمول تزریق نشود.
 */

var DB_MEMO_ = {};
var DB_HEADERS_ = {};
var DB_SS_ = null;

function Db_reset_() {
  DB_MEMO_ = {};
  DB_HEADERS_ = {};
  DB_SS_ = null;
}

function Db_ss_() {
  if (DB_SS_) return DB_SS_;
  var id = Utils_getProp_(PROP.SPREADSHEET_ID);
  if (!id) throw new Error('SPREADSHEET_ID تنظیم نشده است؛ ابتدا تابع setup را اجرا کنید.');
  DB_SS_ = SpreadsheetApp.openById(id);
  return DB_SS_;
}

function Db_sheet_(name) {
  var sh = Db_ss_().getSheetByName(name);
  if (!sh) throw new Error('SHEET_MISSING:' + name + ' — تابع setup را دوباره اجرا کنید.');
  return sh;
}

function Db_types_(name) {
  var map = {};
  (SCHEMA[name] || []).forEach(function (c) { map[c[0]] = c[1]; });
  return map;
}

function Db_headers_(name) {
  if (DB_HEADERS_[name]) return DB_HEADERS_[name];
  var sh = Db_sheet_(name);
  var lastCol = sh.getLastColumn();
  var headers = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  DB_HEADERS_[name] = headers;
  return headers;
}

/** جلوگیری از تفسیر رشته کاربر به‌عنوان فرمول در Sheets. */
function Db_safeCell_(s) {
  s = String(s);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function Db_unsafeCell_(s) {
  return /^'[=+\-@]/.test(s) ? s.slice(1) : s;
}

function Db_deserialize_(name, headers, r) {
  var types = Db_types_(name), obj = {};
  headers.forEach(function (h, i) {
    if (!h) return;
    var t = types[h] || 'str', v = r[i];
    if (t === 'int') {
      if (v === '' || v === null || v === undefined) obj[h] = 0;
      else if (typeof v === 'number') obj[h] = Math.round(v);
      else obj[h] = Math.round(Number(Utils_normalizeDigits_(v).replace(/[,٬\s]/g, ''))) || 0;
    } else if (t === 'bool') {
      obj[h] = Utils_toBool_(v);
    } else if (t === 'json') {
      obj[h] = Utils_safeJsonParse_(typeof v === 'string' ? Db_unsafeCell_(v) : v, null);
    } else if (v instanceof Date) {
      obj[h] = Utils_dateToIso_(v);
    } else {
      obj[h] = (v === null || v === undefined) ? '' : Db_unsafeCell_(String(v));
    }
  });
  return obj;
}

function Db_serialize_(name, headers, obj) {
  var types = Db_types_(name);
  return headers.map(function (h) {
    var t = types[h] || 'str', v = obj[h];
    if (t === 'int') return (v === undefined || v === null || v === '') ? 0 : (Math.round(Number(v)) || 0);
    if (t === 'bool') return v ? 'TRUE' : 'FALSE';
    if (v === undefined || v === null) return '';
    if (t === 'json') {
      var js = typeof v === 'string' ? v : JSON.stringify(v);
      if (js.length > 45000) js = JSON.stringify({ truncated: true });
      return Db_safeCell_(js);
    }
    return Db_safeCell_(v);
  });
}

function Db_load_(name) {
  if (DB_MEMO_[name]) return DB_MEMO_[name];
  var sh = Db_sheet_(name);
  var headers = Db_headers_(name);
  var lastRow = sh.getLastRow(), rows = [];
  if (lastRow > 1 && headers.length) {
    var values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
    values.forEach(function (r, i) {
      for (var c = 0; c < r.length; c++) {
        if (r[c] !== '' && r[c] !== null) {
          var obj = Db_deserialize_(name, headers, r);
          obj.__row = i + 2;
          rows.push(obj);
          return;
        }
      }
    });
  }
  DB_MEMO_[name] = { headers: headers, rows: rows, sheet: sh };
  return DB_MEMO_[name];
}

function Db_all_(name) {
  return Db_load_(name).rows;
}

function Db_find_(name, pred) {
  return Db_all_(name).filter(pred);
}

function Db_findOne_(name, field, value) {
  var v = String(value);
  var rows = Db_all_(name);
  for (var i = 0; i < rows.length; i++) if (String(rows[i][field]) === v) return rows[i];
  return null;
}

/** درج ردیف جدید (بدون نیاز به بارگذاری کل شیت). */
function Db_insert_(name, obj) {
  var headers = Db_headers_(name);
  var sh = Db_sheet_(name);
  var row = Db_serialize_(name, headers, obj);
  sh.appendRow(row);
  var copy = Db_deserialize_(name, headers, row);
  copy.__row = sh.getLastRow();
  if (DB_MEMO_[name]) DB_MEMO_[name].rows.push(copy);
  return copy;
}

/** به‌روزرسانی یک ردیف (obj باید __row داشته باشد). */
function Db_update_(name, obj, patch) {
  if (!obj || !obj.__row) throw new Error('DB_UPDATE_NO_ROW:' + name);
  var headers = Db_headers_(name);
  Object.keys(patch || {}).forEach(function (k) { obj[k] = patch[k]; });
  var row = Db_serialize_(name, headers, obj);
  Db_sheet_(name).getRange(obj.__row, 1, 1, headers.length).setValues([row]);
  var memo = DB_MEMO_[name];
  if (memo) {
    for (var i = 0; i < memo.rows.length; i++) {
      if (memo.rows[i].__row === obj.__row && memo.rows[i] !== obj) {
        var fresh = Db_deserialize_(name, headers, row);
        fresh.__row = obj.__row;
        memo.rows[i] = fresh;
      }
    }
  }
  return obj;
}

/** حذف ردیف‌های منطبق (از پایین به بالا). memo این شیت باطل می‌شود. */
function Db_deleteWhere_(name, pred) {
  var m = Db_load_(name);
  var targets = m.rows.filter(pred).map(function (r) { return r.__row; }).sort(function (a, b) { return b - a; });
  targets.forEach(function (r) { m.sheet.deleteRow(r); });
  if (targets.length) delete DB_MEMO_[name];
  return targets.length;
}

/** حذف N ردیف قدیمی‌تر از ابتدای شیت (برای شیت‌های زمانی مثل ProcessedUpdates). */
function Db_deleteOldestRows_(name, count) {
  if (count <= 0) return 0;
  Db_sheet_(name).deleteRows(2, count);
  delete DB_MEMO_[name];
  return count;
}

function Db_colIndex_(name, field) {
  var idx = Db_headers_(name).indexOf(field);
  if (idx < 0) throw new Error('DB_NO_COLUMN:' + name + '.' + field);
  return idx + 1;
}

// ---------------------------------------------------------------------------
// Idempotency: هر update_id تلگرام فقط یک بار پردازش می‌شود.
// ---------------------------------------------------------------------------

var IDEM_SCAN_ROWS_ = 600;

function Idem_isProcessed_(updateId) {
  var key = 'upd_' + updateId;
  if (CacheService.getScriptCache().get(key)) return true;
  var sh = Db_sheet_(SHEETS.UPDATES);
  var last = sh.getLastRow();
  if (last < 2) return false;
  var n = Math.min(IDEM_SCAN_ROWS_, last - 1);
  var vals = sh.getRange(last - n + 1, 1, n, 1).getValues();
  var target = String(updateId);
  for (var i = vals.length - 1; i >= 0; i--) if (String(vals[i][0]) === target) return true;
  return false;
}

function Idem_markReceived_(updateId, type, actorId) {
  var row = Db_insert_(SHEETS.UPDATES, {
    telegram_update_id: String(updateId), event_type: type, received_at: Utils_nowIso_(),
    processed_at: '', processing_result: 'RECEIVED', request_id_optional: '', actor_telegram_id: actorId || ''
  });
  CacheService.getScriptCache().put('upd_' + updateId, '1', 21600);
  return row.__row;
}

function Idem_finish_(rowIndex, result, requestId) {
  if (!rowIndex) return;
  var sh = Db_sheet_(SHEETS.UPDATES);
  var c = Db_colIndex_(SHEETS.UPDATES, 'processed_at');
  sh.getRange(rowIndex, c, 1, 3).setValues([[Utils_nowIso_(), String(result || 'OK'), Db_safeCell_(requestId || '')]]);
}
