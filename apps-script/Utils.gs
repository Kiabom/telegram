/**
 * Utils.gs — توابع کمکی عمومی: ارقام فارسی، قالب‌بندی، زمان تهران، شناسه، JSON، پنهان‌سازی اسرار.
 */

/** ساعت سیستم؛ تست‌ها می‌توانند CLOCK.now را جایگزین کنند. */
var CLOCK = {
  now: function () { return new Date(); }
};

var FA_DIGITS_ = '۰۱۲۳۴۵۶۷۸۹';
var AR_DIGITS_ = '٠١٢٣٤٥٦٧٨٩';

/** تبدیل ارقام فارسی/عربی به لاتین. */
function Utils_normalizeDigits_(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[۰-۹]/g, function (d) { return String(FA_DIGITS_.indexOf(d)); })
    .replace(/[٠-٩]/g, function (d) { return String(AR_DIGITS_.indexOf(d)); });
}

/** تبدیل ارقام لاتین به فارسی (برای نمایش). */
function Utils_faDigits_(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[0-9]/g, function (d) { return FA_DIGITS_.charAt(Number(d)); });
}

/** جداکننده هزارگان فارسی (٬) با ارقام فارسی. */
function Utils_formatNumberFa_(n) {
  var num = Math.round(Number(n) || 0);
  var neg = num < 0;
  var s = String(Math.abs(num)).replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
  return (neg ? '−' : '') + Utils_faDigits_(s);
}

/** نمایش مبلغ به ریال: «۳٬۵۰۰٬۰۰۰ ریال». */
function Utils_formatRial_(n) {
  return Utils_formatNumberFa_(n) + ' ریال';
}

/** جداکننده هزارگان با ارقام لاتین (برای Excel/لاگ). */
function Utils_formatNumberEn_(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function Utils_escapeHtml_(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** زمان فعلی به ISO با آفست تهران، مثل 2026-10-31T12:30:00+03:30 */
function Utils_nowIso_() {
  return Utilities.formatDate(CLOCK.now(), APP.TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/** تاریخ امروز تهران به ISO (yyyy-MM-dd). مرز نیمه‌شب طبق وقت تهران. */
function Utils_todayIso_() {
  return Utilities.formatDate(CLOCK.now(), APP.TZ, 'yyyy-MM-dd');
}

function Utils_dateToIso_(date) {
  return Utilities.formatDate(date, APP.TZ, 'yyyy-MM-dd');
}

/** جمع روز به تاریخ ISO بدون وابستگی به منطقه زمانی. */
function Utils_isoAddDays_(iso, days) {
  var p = iso.split('-');
  var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + days));
  var mm = ('0' + (d.getUTCMonth() + 1)).slice(-2);
  var dd = ('0' + d.getUTCDate()).slice(-2);
  return d.getUTCFullYear() + '-' + mm + '-' + dd;
}

/** فاصله روزها بین دو تاریخ ISO (b - a). */
function Utils_isoDiffDays_(a, b) {
  var pa = a.split('-'), pb = b.split('-');
  var ta = Date.UTC(Number(pa[0]), Number(pa[1]) - 1, Number(pa[2]));
  var tb = Date.UTC(Number(pb[0]), Number(pb[1]) - 1, Number(pb[2]));
  return Math.round((tb - ta) / 86400000);
}

function Utils_isValidIso_(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return false;
  var p = iso.split('-');
  var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
  return d.getUTCFullYear() === Number(p[0]) && d.getUTCMonth() === Number(p[1]) - 1 && d.getUTCDate() === Number(p[2]);
}

/** ISO دیگر بخش تاریخ از یک datetime ISO. */
function Utils_isoDatePart_(dt) {
  return String(dt || '').slice(0, 10);
}

var ID_ALPHABET_ = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

/** رشته تصادفی از حروف بدون ابهام (بدون 0/O و 1/I/L). */
function Utils_randomCode_(len) {
  var hex = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var out = '';
  for (var i = 0; out.length < len && i + 1 < hex.length; i += 2) {
    var v = parseInt(hex.substr(i, 2), 16);
    if (v < 240) out += ID_ALPHABET_.charAt(v % ID_ALPHABET_.length);
  }
  while (out.length < len) out += ID_ALPHABET_.charAt(Math.floor(Math.random() * ID_ALPHABET_.length));
  return out;
}

function Utils_newId_(prefix) {
  return prefix + '-' + Utils_randomCode_(10);
}

function Utils_safeJsonParse_(s, fallback) {
  if (s === null || s === undefined || s === '') return fallback;
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch (e) { return fallback; }
}

function Utils_chunk_(arr, size) {
  var out = [];
  for (var i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function Utils_unique_(arr) {
  var seen = {}, out = [];
  arr.forEach(function (x) { var k = String(x); if (!seen[k]) { seen[k] = true; out.push(x); } });
  return out;
}

function Utils_truncate_(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function Utils_toBool_(v) {
  if (v === true) return true;
  if (v === false || v === null || v === undefined) return false;
  var s = String(v).trim().toUpperCase();
  return s === 'TRUE' || s === '1' || s === 'YES' || s === 'Y' || s === 'بله';
}

/** پنهان‌سازی توکن و کلیدها در متن خطا/لاگ. */
function Utils_redact_(text) {
  var s = String(text === undefined || text === null ? '' : text);
  var props = PropertiesService.getScriptProperties();
  [PROP.BOT_TOKEN, PROP.GEMINI_API_KEY, PROP.WEBHOOK_SECRET].forEach(function (k) {
    var v = props.getProperty(k);
    if (v && v.length >= 6) s = s.split(v).join('***');
  });
  s = s.replace(/bot\d{5,}:[A-Za-z0-9_-]{20,}/g, 'bot***');
  s = s.replace(/key=[A-Za-z0-9_-]{20,}/g, 'key=***');
  return s;
}

/** پوشاندن شماره کارت/حساب طولانی در متن استخراج‌شده (فقط ۴ رقم آخر). */
function Utils_maskSensitive_(text) {
  return String(text || '')
    .replace(/\b(\d[ -]?){12,19}\b/g, function (m) {
      var digits = m.replace(/\D/g, '');
      return '****' + digits.slice(-4);
    })
    .replace(/(cvv2?|رمز|otp|پویا)\s*[:：]?\s*\d{3,8}/gi, '$1 ***');
}

function Utils_sha256Hex_(bytes) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  return digest.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}

/** مقایسه دو رشته با زمان ثابت (برای secret). */
function Utils_safeEquals_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length || !a.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function Utils_props_() {
  return PropertiesService.getScriptProperties();
}

function Utils_getProp_(key) {
  return Utils_props_().getProperty(key) || '';
}

function Utils_setProp_(key, value) {
  Utils_props_().setProperty(key, String(value));
}
