/**
 * Jalali.gs — تبدیل تاریخ میلادی ↔ شمسی (الگوریتم jalaali) و قالب‌بندی فارسی.
 * تاریخ‌ها در پایگاه داده ISO میلادی ذخیره می‌شوند و فقط در رابط کاربری و گزارش شمسی نمایش داده می‌شوند.
 */

var JALALI_BREAKS_ = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097,
  2192, 2262, 2324, 2394, 2456, 3178];

var JALALI_MONTHS_FA = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

/** نام روزهای هفته؛ اندیس مطابق getUTCDay (۰ = یکشنبه). */
var WEEKDAYS_FA = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];

function Jal_div_(a, b) { return ~~(a / b); }
function Jal_mod_(a, b) { return a - ~~(a / b) * b; }

function Jal_cal_(jy) {
  var bl = JALALI_BREAKS_.length, gy = jy + 621, leapJ = -14, jp = JALALI_BREAKS_[0], jm, jump = 0, leap, leapG, march, n, i;
  if (jy < jp || jy >= JALALI_BREAKS_[bl - 1]) throw new Error('Invalid Jalali year ' + jy);
  for (i = 1; i < bl; i += 1) {
    jm = JALALI_BREAKS_[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + Jal_div_(jump, 33) * 8 + Jal_div_(Jal_mod_(jump, 33), 4);
    jp = jm;
  }
  n = jy - jp;
  leapJ = leapJ + Jal_div_(n, 33) * 8 + Jal_div_(Jal_mod_(n, 33) + 3, 4);
  if (Jal_mod_(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  leapG = Jal_div_(gy, 4) - Jal_div_((Jal_div_(gy, 100) + 1) * 3, 4) - 150;
  march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + Jal_div_(jump + 4, 33) * 33;
  leap = Jal_mod_(Jal_mod_(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap: leap, gy: gy, march: march };
}

function Jal_g2d_(gy, gm, gd) {
  var d = Jal_div_((gy + Jal_div_(gm - 8, 6) + 100100) * 1461, 4) + Jal_div_(153 * Jal_mod_(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - Jal_div_(Jal_div_(gy + 100100 + Jal_div_(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function Jal_d2g_(jdn) {
  var j = 4 * jdn + 139361631;
  j = j + Jal_div_(Jal_div_(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  var i = Jal_div_(Jal_mod_(j, 1461), 4) * 5 + 308;
  var gd = Jal_div_(Jal_mod_(i, 153), 5) + 1;
  var gm = Jal_mod_(Jal_div_(i, 153), 12) + 1;
  var gy = Jal_div_(j, 1461) - 100100 + Jal_div_(8 - gm, 6);
  return { gy: gy, gm: gm, gd: gd };
}

function Jal_j2d_(jy, jm, jd) {
  var r = Jal_cal_(jy);
  return Jal_g2d_(r.gy, 3, r.march) + (jm - 1) * 31 - Jal_div_(jm, 7) * (jm - 7) + jd - 1;
}

function Jal_d2j_(jdn) {
  var gy = Jal_d2g_(jdn).gy, jy = gy - 621, r = Jal_cal_(jy), jdn1f = Jal_g2d_(gy, 3, r.march), jd, jm, k;
  k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) {
      jm = 1 + Jal_div_(k, 31);
      jd = Jal_mod_(k, 31) + 1;
      return { jy: jy, jm: jm, jd: jd };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  jm = 7 + Jal_div_(k, 30);
  jd = Jal_mod_(k, 30) + 1;
  return { jy: jy, jm: jm, jd: jd };
}

function Jal_toJalali_(gy, gm, gd) {
  return Jal_d2j_(Jal_g2d_(gy, gm, gd));
}

function Jal_toGregorian_(jy, jm, jd) {
  return Jal_d2g_(Jal_j2d_(jy, jm, jd));
}

function Jal_isLeap_(jy) {
  return Jal_cal_(jy).leap === 0;
}

function Jal_monthLength_(jy, jm) {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return Jal_isLeap_(jy) ? 30 : 29;
}

function Jal_isValid_(jy, jm, jd) {
  return jy >= -61 && jy <= 3177 && jm >= 1 && jm <= 12 && jd >= 1 && jd <= Jal_monthLength_(jy, jm);
}

function Jal_pad_(n) { return (n < 10 ? '0' : '') + n; }

/** '2026-10-31' → {jy:1405, jm:8, jd:9} */
function Jal_fromIso_(iso) {
  var p = String(iso).split('-');
  return Jal_toJalali_(Number(p[0]), Number(p[1]), Number(p[2]));
}

/** '2026-10-31' → '1405/08/09' */
function Jal_isoToJalali_(iso) {
  if (!Utils_isValidIso_(iso)) return '';
  var j = Jal_fromIso_(iso);
  return j.jy + '/' + Jal_pad_(j.jm) + '/' + Jal_pad_(j.jd);
}

function Jal_toIso_(jy, jm, jd) {
  var g = Jal_toGregorian_(jy, jm, jd);
  return g.gy + '-' + Jal_pad_(g.gm) + '-' + Jal_pad_(g.gd);
}

/** نام روز هفته برای تاریخ ISO. */
function Jal_weekdayFa_(iso) {
  var p = String(iso).split('-');
  return WEEKDAYS_FA[new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]))).getUTCDay()];
}

/** '2026-10-31' → 'شنبه ۹ آبان ۱۴۰۵' */
function Jal_formatLong_(iso, withWeekday) {
  if (!Utils_isValidIso_(iso)) return '—';
  var j = Jal_fromIso_(iso);
  var s = Utils_faDigits_(j.jd) + ' ' + JALALI_MONTHS_FA[j.jm - 1] + ' ' + Utils_faDigits_(j.jy);
  return withWeekday === false ? s : Jal_weekdayFa_(iso) + ' ' + s;
}

/** '2026-10-31' → '۱۴۰۵/۰۸/۰۹' */
function Jal_formatShortFa_(iso) {
  return Utils_faDigits_(Jal_isoToJalali_(iso));
}

/** datetime ISO → '۱۴۰۵/۰۸/۰۹ ۱۲:۳۰' */
function Jal_formatDateTimeFa_(dtIso) {
  if (!dtIso) return '—';
  var date = Utils_isoDatePart_(dtIso);
  var time = String(dtIso).slice(11, 16);
  return Utils_faDigits_(Jal_isoToJalali_(date) + (time ? ' ' + time : ''));
}

/**
 * تبدیل ورودی کاربر به تاریخ ISO.
 * می‌پذیرد: ۱۴۰۵/۰۸/۰۹ ، 1405-8-9 ، ۰۸/۰۹ (سال جاری شمسی) ، 2026-10-31 (میلادی).
 */
function Jal_parseUserDate_(text, todayIso) {
  var s = Utils_normalizeDigits_(text).trim().replace(/[\s.\-_\\]+/g, '/');
  var m = s.match(/^(\d{2,4})\/(\d{1,2})\/(\d{1,2})$/);
  var y, mo, d;
  if (m) {
    y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]);
    if (y > 1700) {
      var iso = y + '-' + Jal_pad_(mo) + '-' + Jal_pad_(d);
      return Utils_isValidIso_(iso) ? iso : null;
    }
    if (y < 100) y += 1400;
  } else {
    m = s.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (!m) return null;
    y = Jal_fromIso_(todayIso || Utils_todayIso_()).jy;
    mo = Number(m[1]); d = Number(m[2]);
  }
  if (!Jal_isValid_(y, mo, d)) return null;
  return Jal_toIso_(y, mo, d);
}

/** بازه یک ماه شمسی به ISO. */
function Jal_monthRangeIso_(jy, jm) {
  return { from: Jal_toIso_(jy, jm, 1), to: Jal_toIso_(jy, jm, Jal_monthLength_(jy, jm)) };
}
