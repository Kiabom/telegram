'use strict';
/**
 * تست‌های واحد توابع خالص: موتور مالی، تجزیه مبلغ ریال/تومان، تاریخ شمسی/مرز نیمه‌شب تهران، تطبیق اسامی.
 * اجرا: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv, formatDate } = require('./gas-mock');

const g = createEnv().context;
const CAP = 3500000;
const plain = (x) => JSON.parse(JSON.stringify(x));
const alloc = (lines, prior) => g.Fin_computeAllocations_(lines, prior || {}, CAP);
const L = (id, cost) => ({ employee_id: id, actual_cost_rial: cost });

test('مالی: یک نفر زیر سقف → دقیقاً همان مبلغ (۲٬۲۰۰٬۰۰۰ ریال)', () => {
  assert.equal(alloc([L('A', 2200000)]).total_rial, 2200000);
});

test('مالی: یک نفر بیشتر از سقف (۴٬۸۰۰٬۰۰۰) → ۳٬۵۰۰٬۰۰۰ ریال', () => {
  assert.equal(alloc([L('A', 4800000)]).total_rial, 3500000);
});

test('مالی: گروه سه‌نفره سهم مساوی ۱۲٬۶۰۰٬۰۰۰ → ۴٬۲۰۰٬۰۰۰ هر نفر، جمع ۱۰٬۵۰۰٬۰۰۰', () => {
  const costs = g.Fin_buildCosts_('EQUAL', ['A', 'B', 'C'], 12600000, {});
  assert.deepEqual(plain(costs.map((c) => c.actual_cost_rial)), [4200000, 4200000, 4200000]);
  assert.equal(alloc(costs).total_rial, 10500000);
});

test('مالی: دو نفر با هزینه متفاوت ۵٬۰۰۰٬۰۰۰ و ۱٬۰۰۰٬۰۰۰ → ۴٬۵۰۰٬۰۰۰ (نه ۶ یا ۷ میلیون)', () => {
  const r = alloc([L('A', 5000000), L('B', 1000000)]);
  assert.equal(r.total_rial, 4500000);
  assert.notEqual(r.total_rial, Math.min(6000000, CAP * 2));
});

test('مالی: مصرف قبلی ۲٬۸۰۰٬۰۰۰ و سفارش بعدی ۱٬۲۰۰٬۰۰۰ → فقط ۷۰۰٬۰۰۰', () => {
  const r = alloc([L('M', 1200000)], { M: 2800000 });
  assert.equal(r.total_rial, 700000);
  assert.equal(r.lines[0].remaining_cap_before_rial, 700000);
  assert.equal(r.lines[0].prior_approved_today_rial, 2800000);
});

test('مالی: سقف کاملاً مصرف‌شده → صفر، نه منفی', () => {
  const r = alloc([L('M', 1000000)], { M: 4000000 });
  assert.equal(r.total_rial, 0);
  assert.equal(r.lines[0].remaining_cap_before_rial, 0);
});

test('مالی: تقسیم مساوی عدد صحیح با توزیع باقی‌مانده؛ جمع دقیقاً برابر کل', () => {
  assert.deepEqual(plain(g.Fin_splitEqual_(1000001, 3)), [333334, 333334, 333333]);
  for (const [t, n] of [[10, 3], [7, 7], [1, 4], [12600001, 4], [999999999, 7]]) {
    const parts = g.Fin_splitEqual_(t, n);
    assert.equal(parts.reduce((a, b) => a + b, 0), t);
    assert.ok(Math.max(...parts) - Math.min(...parts) <= 1);
  }
});

test('مالی: توزیع متناسب دقیق (BigInt) و جمع برابر کل', () => {
  assert.deepEqual(plain(g.Fin_distributeProportional_(1260000, [500000, 700000])), [525000, 735000]);
  const big = g.Fin_distributeProportional_(99999999999, [33333333333, 33333333333, 33333333334]);
  assert.equal(big.reduce((a, b) => a + b, 0), 99999999999);
  assert.deepEqual(plain(g.Fin_distributeProportional_(100, [0, 0])), [50, 50]);
});

test('مالی: سهم‌های جداگانه باید جمعشان برابر مبلغ واجد شرایط باشد', () => {
  assert.throws(() => g.Fin_buildCosts_('INDIVIDUAL', ['A', 'B'], 1000, { A: 400, B: 500 }), /SUM_MISMATCH/);
  assert.equal(g.Fin_buildCosts_('INDIVIDUAL', ['A', 'B'], 900, { A: 400, B: 500 }).length, 2);
});

test('مالی: ورودی نامعتبر (اعشار، منفی، تکراری) رد می‌شود', () => {
  assert.throws(() => alloc([L('A', 100.5)]), /FIN_INVALID/);
  assert.throws(() => alloc([L('A', -1)]), /FIN_INVALID/);
  assert.throws(() => alloc([L('A', 1), L('A', 2)]), /DUPLICATE/);
});

test('مبلغ: ارقام فارسی/عربی/لاتین و جداکننده‌ها', () => {
  const cases = [
    ['۳٬۵۰۰٬۰۰۰ ریال', 3500000, 'RIAL'],
    ['3,500,000 ریال', 3500000, 'RIAL'],
    ['٣٥٠٠٠٠٠ ريال', 3500000, 'RIAL'],
    ['1.260.000 تومان', 1260000, 'TOMAN'],
    ['۱۲۶۰۰۰۰', 1260000, null],
    ['350.000', 350000, null],
    ['1 260 000', 1260000, null],
    ['۳۵۰ هزار تومان', 350000, 'TOMAN'],
    ['۳۵۰هزارتومن', 350000, 'TOMAN'],
    ['یک میلیون و دویست و شصت هزار تومان', 1260000, 'TOMAN'],
    ['دو میلیون و پانصد هزار ریال', 2500000, 'RIAL'],
    ['صد و بیست هزار', 120000, null],
    ['۱.۲ میلیون تومان', 1200000, 'TOMAN'],
    ['۳/۵ میلیون', 3500000, null],
    ['یک و نیم میلیون تومان', 1500000, 'TOMAN'],
    ['12 million rials', 12000000, 'RIAL']
  ];
  for (const [text, value, unit] of cases) {
    const r = g.Money_parseAmount_(text);
    assert.equal(r.ok, true, text + ' → ' + JSON.stringify(r));
    assert.equal(r.value, value, text);
    assert.equal(r.unit, unit, text);
  }
});

test('مبلغ: خطاهای ورودی بدون حدس', () => {
  assert.equal(g.Money_parseAmount_('سلام').error, 'NO_NUMBER');
  assert.equal(g.Money_parseAmount_('12.5').error, 'NOT_INTEGER');
  assert.equal(g.Money_parseAmount_('۱۰۰ تومان ۲۰۰ ریال').error, 'MULTIPLE_NUMBERS');
  assert.equal(g.Money_parseAmount_('۱۰۰۰ تومان ریال').error, 'UNIT_CONFLICT');
  assert.equal(g.Money_parseAmount_('0').error, 'ZERO');
});

test('مبلغ: تبدیل ریال/تومان فقط با واحد قطعی', () => {
  assert.equal(g.Money_toRial_(350000, 'TOMAN'), 3500000);
  assert.equal(g.Money_toRial_(3500000, 'RIAL'), 3500000);
  assert.throws(() => g.Money_toRial_(3500000, null), /UNKNOWN_UNIT/);
});

test('مبلغ: یافتن مبلغ در متن آزاد بدون اشتباه گرفتن تعداد نفرات', () => {
  const r = g.Money_findAmounts_('من امروز برای ۳ نفر غذا گرفتم. جمعش یک میلیون و دویست و شصت هزار تومان شد، نه بیشتر');
  assert.equal(r[0].value, 1260000);
  assert.equal(r[0].unit, 'TOMAN');
  assert.ok(!r.some((x) => x.value === 3 || x.value === 9));
});

test('نمایش: قالب ریال با ارقام فارسی و جداکننده', () => {
  assert.equal(g.Utils_formatRial_(3500000), '۳٬۵۰۰٬۰۰۰ ریال');
  assert.equal(g.Utils_formatRial_(0), '۰ ریال');
  assert.equal(g.Utils_formatNumberFa_(1050000), '۱٬۰۵۰٬۰۰۰');
});

test('تاریخ: تبدیل شمسی/میلادی (نوروز، کبیسه، امروز)', () => {
  assert.equal(g.Jal_isoToJalali_('2026-10-31'), '1405/08/09');
  assert.equal(g.Jal_toIso_(1405, 1, 1), '2026-03-21');
  assert.equal(g.Jal_toIso_(1403, 1, 1), '2024-03-20');
  assert.equal(g.Jal_isLeap_(1403), true);
  assert.equal(g.Jal_monthLength_(1403, 12), 30);
  assert.equal(g.Jal_monthLength_(1404, 12), 29);
  assert.equal(g.Jal_isoToJalali_('2025-03-20'), '1403/12/30');
  // مقایسه با تقویم ICU نود برای یک بازه طولانی
  const fmt = new Intl.DateTimeFormat('en-u-ca-persian', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
  for (let t = Date.UTC(2020, 0, 1); t < Date.UTC(2030, 0, 1); t += 86400000 * 7) {
    const iso = new Date(t).toISOString().slice(0, 10);
    const parts = Object.fromEntries(fmt.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
    const expected = `${parseInt(parts.year, 10)}/${String(parts.month).padStart(2, '0')}/${String(parts.day).padStart(2, '0')}`;
    assert.equal(g.Jal_isoToJalali_(iso), expected, iso);
    assert.equal(g.Jal_parseUserDate_(expected), iso);
  }
});

test('تاریخ: مرز نیمه‌شب تهران (UTC+03:30)', () => {
  g.CLOCK.now = () => new Date('2026-10-30T20:29:59Z');
  assert.equal(g.Utils_todayIso_(), '2026-10-30');
  g.CLOCK.now = () => new Date('2026-10-30T20:30:00Z');
  assert.equal(g.Utils_todayIso_(), '2026-10-31');
  assert.equal(g.Utils_nowIso_(), '2026-10-31T00:00:00+03:30');
  g.CLOCK.now = () => new Date();
  assert.equal(formatDate(new Date('2026-03-20T21:00:00Z'), 'Asia/Tehran', 'yyyy-MM-dd HH:mm XXX'), '2026-03-21 00:30 +03:30');
});

test('تاریخ: ورودی کاربر', () => {
  assert.equal(g.Jal_parseUserDate_('۱۴۰۵/۰۸/۰۹'), '2026-10-31');
  assert.equal(g.Jal_parseUserDate_('1405-8-9'), '2026-10-31');
  assert.equal(g.Jal_parseUserDate_('2026-10-31'), '2026-10-31');
  assert.equal(g.Jal_parseUserDate_('08/09', '2026-10-31'), '2026-10-31');
  assert.equal(g.Jal_parseUserDate_('1405/13/01'), null);
  assert.equal(g.Jal_parseUserDate_('1404/12/30'), null);
  assert.equal(g.Jal_parseUserDate_('دیروز'), null);
});

test('اسامی: نرمال‌سازی ي/ك عربی، نیم‌فاصله و عنوان‌ها', () => {
  const emps = [
    { employee_id: 'E1', full_name_fa: 'علی احمدی', aliases: 'علی‌جان' },
    { employee_id: 'E2', full_name_fa: 'محمد رضایی', aliases: '' },
    { employee_id: 'E3', full_name_fa: 'محمد کریمی', aliases: 'ممد' },
    { employee_id: 'E4', full_name_fa: 'محمدرضا نوری', aliases: '' }
  ];
  assert.equal(g.Names_matchOne_('آقای علي احمدي', emps).employee.employee_id, 'E1');
  assert.equal(g.Names_matchOne_('علی جان', emps).employee.employee_id, 'E1');
  assert.equal(g.Names_matchOne_('ممد', emps).employee.employee_id, 'E3');
  assert.equal(g.Names_matchOne_('محمد', emps).type, 'AMBIGUOUS');
  assert.equal(g.Names_matchOne_('محمد رضا نوری', emps).employee.employee_id, 'E4');
  assert.equal(g.Names_matchOne_('خودم', emps).type, 'SELF');
  assert.equal(g.Names_matchOne_('حسین', emps).type, 'UNKNOWN');
  const r = g.Names_resolveList_('خودم، رضایی و محمد و حسین', emps, emps[0]);
  assert.deepEqual(plain(r.resolved.map((e) => e.employee_id)), ['E1', 'E2']);
  assert.equal(r.ambiguous.length, 1);
  assert.deepEqual(plain(r.unknown), ['حسین']);
});

test('اسامی: یافتن اسامی در متن آزاد', () => {
  const emps = [
    { employee_id: 'E1', full_name_fa: 'علی احمدی', aliases: '' },
    { employee_id: 'E2', full_name_fa: 'محمد رضایی', aliases: '' },
    { employee_id: 'E5', full_name_fa: 'رضا کریمی', aliases: '' }
  ];
  const r = g.Names_findMentions_('من امروز برای خودم، محمد و رضا از اسنپ‌فود غذا گرفتم', emps, emps[0]);
  assert.deepEqual(plain(r.resolved.map((e) => e.employee_id)).sort(), ['E1', 'E2', 'E5']);
  assert.equal(r.includesSelf, true);
});

test('امنیت: پنهان‌سازی توکن و شماره کارت', () => {
  const env = createEnv();
  env.props.set('BOT_TOKEN', '123456789:SECRET_TOKEN_VALUE_abcdefghij');
  const s = env.context.Utils_redact_('fetch failed https://api.telegram.org/bot123456789:SECRET_TOKEN_VALUE_abcdefghij/sendMessage');
  assert.ok(!s.includes('SECRET_TOKEN_VALUE'));
  assert.equal(env.context.Utils_maskSensitive_('کارت 6037-9911-2233-4455 رمز 1234'), 'کارت ****4455 رمز ***');
});

test('Sheets: جلوگیری از تزریق فرمول', () => {
  assert.equal(g.Db_safeCell_('=IMPORTXML("x")'), "'=IMPORTXML(\"x\")");
  assert.equal(g.Db_unsafeCell_("'=1+1"), '=1+1');
  assert.equal(g.Db_safeCell_('رستوران'), 'رستوران');
});

test('تلگرام: متن بلند بدون شکستن HTML ارسال می‌شود', () => {
  const long = '<b>عنوان</b>\n' + 'ردیف &lt;۱&gt; '.repeat(600);
  const p = g.Tg_prepareText_(long);
  assert.ok(p.text.length <= 4096);
  assert.equal(p.parse_mode, undefined);
  assert.ok(!p.text.includes('<b>'));
  assert.equal(g.Tg_prepareText_('<b>کوتاه</b>').parse_mode, 'HTML');
});

test('مالی: توزیع متناسب بدون BigInt همان نتیجه را می‌دهد', () => {
  for (const [t, w] of [[1260000, [500000, 700000]], [100, [1, 1, 1]], [12600001, [3, 5, 7, 11]]]) {
    assert.deepEqual(plain(g.Fin_distributeProportionalNumber_(t, w, w.reduce((a, b) => a + b, 0))), plain(g.Fin_distributeProportional_(t, w)));
  }
});
