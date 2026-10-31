/**
 * Money.gs — تجزیه مبلغ از متن فارسی/لاتین و تبدیل قطعی به ریال.
 *
 * قواعد:
 *  - همه مبالغ ذخیره‌شده ریال و عدد صحیح‌اند.
 *  - تومان → ریال فقط با واحد مشخص (اعلام کاربر یا کلمه «تومان» در متن): ریال = تومان × ۱۰
 *  - اگر واحد در متن نباشد، تابع unit=null برمی‌گرداند تا ربات از کاربر بپرسد (حدس زده نمی‌شود).
 *  - ارقام فارسی/عربی، جداکننده‌های ٬ , ، . و عدد حروفی («یک میلیون و دویست هزار») پشتیبانی می‌شوند.
 */

var MONEY_MAX_RIAL = 100000000000; // سقف منطقی یک فاکتور ناهار برای جلوگیری از ورودی بی‌معنا

var FA_NUMBER_WORDS_ = {
  'صفر': 0, 'یک': 1, 'یه': 1, 'دو': 2, 'سه': 3, 'چهار': 4, 'پنج': 5, 'شش': 6, 'شیش': 6,
  'هفت': 7, 'هشت': 8, 'نه': 9, 'ده': 10, 'یازده': 11, 'دوازده': 12, 'سیزده': 13,
  'چهارده': 14, 'پانزده': 15, 'پونزده': 15, 'شانزده': 16, 'شونزده': 16, 'هفده': 17,
  'هیفده': 17, 'هجده': 18, 'هیجده': 18, 'نوزده': 19, 'بیست': 20, 'سی': 30, 'چهل': 40,
  'پنجاه': 50, 'شصت': 60, 'هفتاد': 70, 'هشتاد': 80, 'نود': 90, 'صد': 100, 'یکصد': 100,
  'دویست': 200, 'سیصد': 300, 'چهارصد': 400, 'پانصد': 500, 'پونصد': 500, 'ششصد': 600,
  'شیشصد': 600, 'هفتصد': 700, 'هشتصد': 800, 'نهصد': 900
};

var FA_MULTIPLIERS_ = {
  'هزار': 1000, 'میلیون': 1000000, 'ملیون': 1000000, 'میلیارد': 1000000000, 'ملیارد': 1000000000,
  'thousand': 1000, 'million': 1000000
};

var UNIT_WORDS_ = {
  'ریال': 'RIAL', 'ریالی': 'RIAL', 'rial': 'RIAL', 'rials': 'RIAL', 'irr': 'RIAL',
  'تومان': 'TOMAN', 'تومن': 'TOMAN', 'تومانی': 'TOMAN', 'تومنی': 'TOMAN', 'toman': 'TOMAN',
  'tomans': 'TOMAN', 'irt': 'TOMAN'
};

var UNIT_FA = { RIAL: 'ریال', TOMAN: 'تومان' };

/** تبدیل یک توکن رقمی به عدد؛ null اگر الگو نامعتبر باشد. */
function Money_parseNumToken_(t) {
  if (/^\d+$/.test(t)) return Number(t);
  if (/^\d{1,3}([,٬،']\d{3})+$/.test(t)) return Number(t.replace(/[,٬،']/g, ''));
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''));
  var m = t.match(/^(\d+)[.\/٫](\d+)$/);
  if (m) return Number(m[1] + '.' + m[2]);
  return null;
}

function Money_tokenize_(text) {
  var s = Names_normalizeLetters_(Utils_normalizeDigits_(text)).toLowerCase();
  s = s.replace(/‌/g, ' ');
  s = s.replace(/(هزار|میلیون|ملیون|میلیارد|ملیارد)(?=(تومان|تومن|ریال))/g, '$1 ');
  s = s.replace(/(\d)([^\d\s.,٬،'\/٫])/g, '$1 $2').replace(/([^\d\s.,٬،'\/٫])(\d)/g, '$1 $2');
  s = s.replace(/(^|[^\d])(\d{1,3})((?: \d{3})+)(?!\d)/g, function (m0, pre, a, b) { return pre + a + b.replace(/ /g, ''); });
  var re = /(\d+(?:[.,٬،'\/٫]\d+)*)|([a-zء-غف-يپچژکگیۀً-ْ]+)/g;
  var tokens = [], m;
  while ((m = re.exec(s)) !== null) {
    if (m[1]) {
      var v = Money_parseNumToken_(m[1]);
      tokens.push(v === null ? { type: 'WORD', text: m[1] } : { type: 'NUM', value: v });
      continue;
    }
    var w = m[2];
    if (w === 'و' || w === 'and') tokens.push({ type: 'AND' });
    else if (w === 'نیم') tokens.push({ type: 'HALF' });
    else if (FA_NUMBER_WORDS_.hasOwnProperty(w)) tokens.push({ type: 'WNUM', value: FA_NUMBER_WORDS_[w] });
    else if (FA_MULTIPLIERS_.hasOwnProperty(w)) tokens.push({ type: 'MULT', value: FA_MULTIPLIERS_[w] });
    else if (UNIT_WORDS_.hasOwnProperty(w)) tokens.push({ type: 'UNIT', unit: UNIT_WORDS_[w] });
    else tokens.push({ type: 'WORD', text: w });
  }
  return tokens;
}

function Money_isNumeric_(t) {
  return t.type === 'NUM' || t.type === 'WNUM' || t.type === 'MULT' || t.type === 'HALF';
}

/** محاسبه مقدار یک گروه توکن عددی پیوسته. */
function Money_evalGroup_(toks) {
  var total = 0, current = 0, lastMult = 0, saw = false, hasMult = false;
  toks.forEach(function (t) {
    if (t.type === 'NUM' || t.type === 'WNUM') {
      if (t.type === 'WNUM' && t.value === 100 && current > 0 && current < 10) current *= 100;
      else current += t.value;
      saw = true;
    } else if (t.type === 'MULT') {
      if (current === 0) current = 1;
      total += current * t.value;
      current = 0;
      lastMult = t.value;
      saw = true;
      hasMult = true;
    } else if (t.type === 'HALF') {
      if (current === 0 && lastMult) total += lastMult / 2;
      else current += 0.5;
    }
  });
  total += current;
  return saw ? { value: total, hasMult: hasMult } : null;
}

/** گروه‌بندی توکن‌ها به عبارات عددی مستقل، همراه با واحدی که بلافاصله بعد از آن آمده. */
function Money_groups_(tokens) {
  var groups = [], i = 0;
  while (i < tokens.length) {
    if (!Money_isNumeric_(tokens[i])) { i++; continue; }
    var run = [];
    while (i < tokens.length) {
      var t = tokens[i];
      if (Money_isNumeric_(t)) { run.push(t); i++; continue; }
      if (t.type === 'AND' && i + 1 < tokens.length && Money_isNumeric_(tokens[i + 1])) { run.push(t); i++; continue; }
      break;
    }
    var ev = Money_evalGroup_(run);
    if (!ev) continue;
    var unit = null;
    if (i < tokens.length && tokens[i].type === 'UNIT') { unit = tokens[i].unit; i++; }
    groups.push({ value: ev.value, unit: unit, hasMult: ev.hasMult, size: run.length });
  }
  return groups;
}

/**
 * تجزیه سخت‌گیرانه پیامی که فقط مبلغ است.
 * خروجی: {ok:true, value:int, unit:'RIAL'|'TOMAN'|null} یا {ok:false, error}
 */
function Money_parseAmount_(text) {
  var tokens = Money_tokenize_(text);
  var groups = Money_groups_(tokens);
  if (!groups.length) return { ok: false, error: 'NO_NUMBER' };
  if (groups.length > 1) return { ok: false, error: 'MULTIPLE_NUMBERS' };
  var units = Utils_unique_(tokens.filter(function (t) { return t.type === 'UNIT'; }).map(function (t) { return t.unit; }));
  if (units.length > 1) return { ok: false, error: 'UNIT_CONFLICT' };
  var g = groups[0];
  var v = g.value;
  if (!isFinite(v)) return { ok: false, error: 'NO_NUMBER' };
  if (Math.abs(v - Math.round(v)) > 1e-6) return { ok: false, error: 'NOT_INTEGER' };
  v = Math.round(v);
  if (v <= 0) return { ok: false, error: 'ZERO' };
  var unit = g.unit || (units.length === 1 ? units[0] : null);
  if (Money_toRial_(v, unit || 'RIAL') > MONEY_MAX_RIAL) return { ok: false, error: 'TOO_LARGE' };
  return { ok: true, value: v, unit: unit };
}

/**
 * یافتن مبالغ احتمالی در متن آزاد (مثل «جمعش یک میلیون و دویست هزار تومان شد»).
 * اعداد کوچک بدون واحد/ضریب (مثل «۳ نفر» یا «نه») حذف می‌شوند.
 */
function Money_findAmounts_(text) {
  var groups = Money_groups_(Money_tokenize_(text));
  return groups.filter(function (g) {
    var v = g.value;
    if (!isFinite(v) || v <= 0 || Math.abs(v - Math.round(v)) > 1e-6) return false;
    return g.unit || g.hasMult || v >= 1000;
  }).map(function (g) { return { value: Math.round(g.value), unit: g.unit }; })
    .sort(function (a, b) { return (b.unit ? 1 : 0) - (a.unit ? 1 : 0) || b.value - a.value; });
}

/** تبدیل قطعی به ریال؛ واحد باید مشخص باشد. */
function Money_toRial_(value, unit) {
  var v = Math.round(Number(value));
  if (!isFinite(v)) throw new Error('INVALID_AMOUNT');
  if (unit === 'TOMAN') return v * 10;
  if (unit === 'RIAL') return v;
  throw new Error('UNKNOWN_UNIT');
}

function Money_formatInUnit_(value, unit) {
  return Utils_formatNumberFa_(value) + ' ' + UNIT_FA[unit];
}

/** پیام خطای فارسی برای خطاهای تجزیه مبلغ. */
function Money_errorFa_(code) {
  var map = {
    NO_NUMBER: 'عددی در پیام پیدا نشد. لطفاً فقط مبلغ را بنویسید؛ مثلاً ۳۵۰۰۰۰۰ ریال یا ۳۵۰ هزار تومان.',
    MULTIPLE_NUMBERS: 'پیام شامل چند عدد است. لطفاً فقط یک مبلغ بنویسید.',
    UNIT_CONFLICT: 'هم «ریال» و هم «تومان» در پیام آمده است. لطفاً فقط یک واحد بنویسید.',
    NOT_INTEGER: 'مبلغ باید عدد صحیح باشد (اعشار ریال پذیرفته نیست).',
    ZERO: 'مبلغ باید بیشتر از صفر باشد.',
    TOO_LARGE: 'مبلغ بسیار بزرگ است؛ لطفاً دوباره بررسی کنید.'
  };
  return map[code] || 'مبلغ نامعتبر است.';
}
