/**
 * SelfTest.gs — آزمون سریع توابع خالص (موتور مالی، مبلغ، تاریخ) داخل ویرایشگر Apps Script.
 * اجرا: تابع runSelfTests را از منوی Run اجرا کنید و Execution log را ببینید.
 * مجموعه کامل تست‌ها (شامل شبیه‌سازی تلگرام و Sheets) در پوشه tests/ با Node.js اجرا می‌شود.
 */

function runSelfTests() {
  var results = [], failed = 0;
  function eq(name, actual, expected) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failed++;
    results.push((ok ? '✅ ' : '❌ ') + name + (ok ? '' : ' → got ' + JSON.stringify(actual) + ' expected ' + JSON.stringify(expected)));
  }
  var cap = 3500000;
  eq('زیر سقف ۲٬۲۰۰٬۰۰۰', Fin_computeAllocations_([{ employee_id: 'A', actual_cost_rial: 2200000 }], {}, cap).total_rial, 2200000);
  eq('بالای سقف ۴٬۸۰۰٬۰۰۰', Fin_computeAllocations_([{ employee_id: 'A', actual_cost_rial: 4800000 }], {}, cap).total_rial, 3500000);
  var eq3 = Fin_buildCosts_('EQUAL', ['A', 'B', 'C'], 12600000, {});
  eq('گروه سه‌نفره مساوی', Fin_computeAllocations_(eq3, {}, cap).total_rial, 10500000);
  eq('دو نفر هزینه متفاوت', Fin_computeAllocations_([{ employee_id: 'A', actual_cost_rial: 5000000 }, { employee_id: 'B', actual_cost_rial: 1000000 }], {}, cap).total_rial, 4500000);
  eq('مصرف قبلی سقف', Fin_computeAllocations_([{ employee_id: 'M', actual_cost_rial: 1200000 }], { M: 2800000 }, cap).total_rial, 700000);
  eq('تقسیم با باقی‌مانده', Fin_splitEqual_(1000001, 3), [333334, 333334, 333333]);
  eq('توزیع متناسب', Fin_distributeProportional_(1260000, [500000, 700000]), [525000, 735000]);
  eq('ریال صریح', Money_parseAmount_('۳٬۵۰۰٬۰۰۰ ریال'), { ok: true, value: 3500000, unit: 'RIAL' });
  eq('تومان حروفی', Money_parseAmount_('یک میلیون و دویست و شصت هزار تومان'), { ok: true, value: 1260000, unit: 'TOMAN' });
  eq('تومان → ریال', Money_toRial_(350000, 'TOMAN'), 3500000);
  eq('بدون واحد', Money_parseAmount_('1,260,000').unit, null);
  eq('تاریخ شمسی', Jal_isoToJalali_('2026-10-31'), '1405/08/09');
  eq('تاریخ میلادی', Jal_toIso_(1405, 1, 1), '2026-03-21');
  eq('قالب ریال', Utils_formatRial_(3500000), '۳٬۵۰۰٬۰۰۰ ریال');
  var out = results.join('\n') + '\n\n' + (failed ? '❌ ' + failed + ' تست ناموفق' : '✅ همه تست‌ها موفق');
  Logger.log(out);
  return out;
}
