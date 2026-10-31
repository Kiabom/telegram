/**
 * Names.gs — نرمال‌سازی نام فارسی و تطبیق اسامی با فهرست رسمی کارکنان.
 * اسامی مبهم هرگز حدس زده نمی‌شوند؛ در صورت ابهام گزینه‌ها برای انتخاب صریح برگردانده می‌شوند.
 */

var HONORIFICS_ = ['آقای', 'آقا', 'خانم', 'جناب', 'سرکار', 'مهندس', 'دکتر', 'استاد'];
var SELF_WORDS_ = ['خودم', 'من', 'خود', 'خودمم', 'بنده', 'خودمو', 'خودمان'];

function Names_normalizeLetters_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/ة/g, 'ه').replace(/[أإٱ]/g, 'ا')
    .replace(/[ً-ٰٟـ]/g, '');
}

/** کلید مقایسه: بدون فاصله، نیم‌فاصله، علائم و عنوان‌ها. */
function Names_key_(s) {
  var t = Names_normalizeLetters_(Utils_normalizeDigits_(s)).toLowerCase().trim();
  HONORIFICS_.forEach(function (h) {
    if (t.indexOf(h + ' ') === 0 || t.indexOf(h + '‌') === 0) t = t.slice(h.length);
  });
  return t.replace(/[\s‌‏‎.,،؛;:!?؟'"«»()\-_]/g, '');
}

function Names_words_(s) {
  return Names_normalizeLetters_(Utils_normalizeDigits_(s)).toLowerCase()
    .split(/[\s‌.,،؛;:!?؟'"«»()\[\]\-_\/]+/).filter(function (w) { return w; });
}

function Names_isSelfWord_(s) {
  return SELF_WORDS_.indexOf(Names_key_(s)) >= 0;
}

/** کلیدهای قوی (نام کامل، نام‌های مستعار) و ضعیف (نام کوچک/خانوادگی) یک کارمند. */
function Names_employeeKeys_(emp) {
  var words = Names_words_(emp.full_name_fa).filter(function (w) { return HONORIFICS_.indexOf(w) < 0; });
  var strong = [Names_key_(emp.full_name_fa)];
  String(emp.aliases || '').split(/[,،;؛\n]+/).forEach(function (a) {
    var k = Names_key_(a);
    if (k) strong.push(k);
  });
  var weak = [];
  if (words.length > 1) {
    weak.push(Names_key_(words[0]));
    weak.push(Names_key_(words[words.length - 1]));
  }
  return { strong: Utils_unique_(strong.filter(String)), weak: Utils_unique_(weak.filter(String)) };
}

/**
 * تطبیق یک نام واحد.
 * خروجی: {type:'SELF'} | {type:'MATCH', employee} | {type:'AMBIGUOUS', candidates} | {type:'UNKNOWN'}
 */
function Names_matchOne_(query, employees) {
  if (Names_isSelfWord_(query)) return { type: 'SELF' };
  var k = Names_key_(query);
  if (!k) return { type: 'UNKNOWN' };
  var strong = employees.filter(function (e) { return Names_employeeKeys_(e).strong.indexOf(k) >= 0; });
  if (strong.length === 1) return { type: 'MATCH', employee: strong[0] };
  if (strong.length > 1) return { type: 'AMBIGUOUS', candidates: strong };
  var weak = employees.filter(function (e) {
    var keys = Names_employeeKeys_(e);
    return keys.weak.indexOf(k) >= 0 || (k.length >= 3 && keys.strong[0].indexOf(k) === 0);
  });
  if (weak.length === 1) return { type: 'MATCH', employee: weak[0] };
  if (weak.length > 1) return { type: 'AMBIGUOUS', candidates: weak };
  return { type: 'UNKNOWN' };
}

/** شکستن فهرست تایپ‌شده: «خودم، محمد و رضا» → ['خودم','محمد','رضا'] */
function Names_splitList_(text) {
  var t = Names_normalizeLetters_(Utils_normalizeDigits_(text)).replace(/‌/g, ' ');
  t = t.replace(/\d+\s*(نفر|نفری)/g, ' ');
  return t.split(/[،,;؛.!?؟\n]+|\s+و\s+|\s+and\s+|\s+با\s+/)
    .map(function (p) { return p.replace(/^\s*(برای|و|با|هم)\s+/, '').replace(/\s+(هم|بود|بودند|بودیم)\s*$/, '').trim(); })
    .filter(function (p) { return p && Names_key_(p); });
}

/**
 * تطبیق فهرست اسامی تایپ‌شده با کارکنان.
 * خروجی: {resolved:[emp], ambiguous:[{token,candidates}], unknown:[token], includesSelf:bool}
 */
function Names_resolveList_(text, employees, selfEmployee) {
  var out = { resolved: [], ambiguous: [], unknown: [], includesSelf: false };
  Names_splitList_(text).forEach(function (token) {
    var r = Names_matchOne_(token, employees);
    if (r.type === 'SELF') {
      out.includesSelf = true;
      if (selfEmployee) out.resolved.push(selfEmployee);
    } else if (r.type === 'MATCH') out.resolved.push(r.employee);
    else if (r.type === 'AMBIGUOUS') out.ambiguous.push({ token: token, candidates: r.candidates });
    else out.unknown.push(token);
  });
  out.resolved = Names_uniqueEmployees_(out.resolved);
  return out;
}

function Names_uniqueEmployees_(list) {
  var seen = {};
  return list.filter(function (e) {
    if (seen[e.employee_id]) return false;
    seen[e.employee_id] = true;
    return true;
  });
}

/**
 * یافتن اسامی کارکنان داخل متن آزاد (n-gram تا ۳ کلمه).
 * خروجی مشابه Names_resolveList_.
 */
function Names_findMentions_(text, employees, selfEmployee) {
  var words = Names_words_(text);
  var used = words.map(function () { return false; });
  var out = { resolved: [], ambiguous: [], unknown: [], includesSelf: false };
  var keyed = employees.map(function (e) { return { e: e, keys: Names_employeeKeys_(e) }; });
  for (var n = 3; n >= 1; n--) {
    for (var i = 0; i + n <= words.length; i++) {
      var free = true;
      for (var j = i; j < i + n; j++) if (used[j]) free = false;
      if (!free) continue;
      var phrase = words.slice(i, i + n).join(' ');
      var k = Names_key_(phrase);
      if (!k) continue;
      if (n === 1 && SELF_WORDS_.indexOf(k) >= 0) {
        out.includesSelf = true;
        used[i] = true;
        continue;
      }
      var strong = keyed.filter(function (x) { return x.keys.strong.indexOf(k) >= 0; }).map(function (x) { return x.e; });
      var cands = strong.length ? strong : (n <= 2 ? keyed.filter(function (x) { return x.keys.weak.indexOf(k) >= 0; }).map(function (x) { return x.e; }) : []);
      if (!cands.length) continue;
      for (j = i; j < i + n; j++) used[j] = true;
      if (cands.length === 1) out.resolved.push(cands[0]);
      else out.ambiguous.push({ token: phrase, candidates: cands });
    }
  }
  if (out.includesSelf && selfEmployee) out.resolved.unshift(selfEmployee);
  out.resolved = Names_uniqueEmployees_(out.resolved);
  return out;
}
