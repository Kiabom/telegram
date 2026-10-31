/**
 * Finance.gs — موتور مالی قطعی (بدون AI). همه مبالغ ریال و عدد صحیح.
 *
 * برای هر فرد i در یک سفارش:
 *   remaining_i = max(0, cap - approved_i_today)
 *   allowed_i   = min(actual_cost_i, remaining_i)
 *   reimbursement = Σ allowed_i   → کل مبلغ به پرداخت‌کننده سفارش تعلق می‌گیرد.
 */

function Fin_assertInt_(v, name) {
  if (typeof v !== 'number' || !isFinite(v) || Math.floor(v) !== v || v < 0) {
    throw new Error('FIN_INVALID_' + (name || 'AMOUNT') + ':' + v);
  }
}

/**
 * تقسیم مساوی عدد صحیح با توزیع باقی‌مانده: جمع خروجی دقیقاً برابر total است.
 * splitEqual(1000001, 3) → [333334, 333334, 333333]
 */
function Fin_splitEqual_(total, n) {
  Fin_assertInt_(total, 'TOTAL');
  if (!n || n < 1) throw new Error('FIN_INVALID_COUNT');
  var base = Math.floor(total / n), rem = total - base * n, out = [];
  for (var i = 0; i < n; i++) out.push(base + (i < rem ? 1 : 0));
  return out;
}

/**
 * توزیع متناسب عدد صحیح total بر اساس وزن‌ها (روش بزرگ‌ترین باقی‌مانده، محاسبه دقیق با BigInt).
 * جمع خروجی دقیقاً برابر total است.
 */
function Fin_distributeProportional_(total, weights) {
  Fin_assertInt_(total, 'TOTAL');
  if (!weights.length) throw new Error('FIN_INVALID_COUNT');
  weights.forEach(function (w) { Fin_assertInt_(w, 'WEIGHT'); });
  var W = weights.reduce(function (a, b) { return a + b; }, 0);
  if (W === 0) return Fin_splitEqual_(total, weights.length);
  if (typeof BigInt === 'undefined') return Fin_distributeProportionalNumber_(total, weights, W);
  var T = BigInt(total), WB = BigInt(W);
  var parts = weights.map(function (w, i) {
    var num = T * BigInt(w);
    return { i: i, q: num / WB, r: num % WB };
  });
  var assigned = parts.reduce(function (a, p) { return a + p.q; }, BigInt(0));
  var left = Number(T - assigned);
  var order = parts.slice().sort(function (a, b) {
    if (a.r === b.r) return a.i - b.i;
    return a.r > b.r ? -1 : 1;
  });
  for (var k = 0; k < left; k++) order[k].q += BigInt(1);
  return parts.map(function (p) { return Number(p.q); });
}

/** نسخه بدون BigInt (فقط وقتی حاصل‌ضرب‌ها در محدوده دقیق Number باشند). */
function Fin_distributeProportionalNumber_(total, weights, W) {
  if (total * Math.max.apply(null, weights) > Number.MAX_SAFE_INTEGER) throw new Error('FIN_OVERFLOW');
  var parts = weights.map(function (w, i) { var num = total * w; return { i: i, q: Math.floor(num / W), r: num % W }; });
  var left = total - parts.reduce(function (a, p) { return a + p.q; }, 0);
  var order = parts.slice().sort(function (a, b) { return b.r - a.r || a.i - b.i; });
  for (var k = 0; k < left; k++) order[k].q += 1;
  return parts.map(function (p) { return p.q; });
}

/**
 * محاسبه تخصیص سقف برای افراد یک سفارش.
 * @param lines [{employee_id, actual_cost_rial}]
 * @param priorUsage {employee_id: مجموع تخصیص تأییدشده همان روز در سایر درخواست‌ها}
 * @param capRial سقف روزانه هر نفر
 * @return {lines:[{employee_id, actual_cost_rial, prior_approved_today_rial, remaining_cap_before_rial, approved_allocation_rial}], total_rial}
 */
function Fin_computeAllocations_(lines, priorUsage, capRial) {
  Fin_assertInt_(capRial, 'CAP');
  var seen = {};
  var out = lines.map(function (l) {
    if (seen[l.employee_id]) throw new Error('FIN_DUPLICATE_BENEFICIARY:' + l.employee_id);
    seen[l.employee_id] = true;
    Fin_assertInt_(l.actual_cost_rial, 'COST');
    var prior = Number((priorUsage || {})[l.employee_id] || 0);
    Fin_assertInt_(prior, 'PRIOR');
    var remaining = Math.max(0, capRial - prior);
    var allowed = Math.min(l.actual_cost_rial, remaining);
    return {
      employee_id: l.employee_id,
      actual_cost_rial: l.actual_cost_rial,
      prior_approved_today_rial: prior,
      remaining_cap_before_rial: remaining,
      approved_allocation_rial: allowed
    };
  });
  var total = out.reduce(function (a, l) { return a + l.approved_allocation_rial; }, 0);
  return { lines: out, total_rial: total };
}

/**
 * ساخت هزینه واقعی هر نفر از روی حالت تقسیم.
 * mode: SINGLE | EQUAL | INDIVIDUAL ؛ shares فقط برای INDIVIDUAL (به ترتیب ids).
 */
function Fin_buildCosts_(mode, ids, eligibleTotal, shares) {
  Fin_assertInt_(eligibleTotal, 'TOTAL');
  if (mode === 'SINGLE') {
    if (ids.length !== 1) throw new Error('FIN_SINGLE_NEEDS_ONE');
    return [{ employee_id: ids[0], actual_cost_rial: eligibleTotal }];
  }
  if (mode === 'EQUAL') {
    var eq = Fin_splitEqual_(eligibleTotal, ids.length);
    return ids.map(function (id, i) { return { employee_id: id, actual_cost_rial: eq[i] }; });
  }
  if (mode === 'INDIVIDUAL') {
    var sum = 0;
    var costs = ids.map(function (id) {
      var v = Number(shares[id]);
      Fin_assertInt_(v, 'SHARE');
      sum += v;
      return { employee_id: id, actual_cost_rial: v };
    });
    if (sum !== eligibleTotal) throw new Error('FIN_SHARES_SUM_MISMATCH');
    return costs;
  }
  throw new Error('FIN_UNKNOWN_SPLIT');
}

/** اختلاف جمع سهم‌ها با مبلغ واجد شرایط را به‌نسبت سهم‌ها توزیع می‌کند. */
function Fin_rebalanceShares_(ids, shares, eligibleTotal) {
  var dist = Fin_distributeProportional_(eligibleTotal, ids.map(function (id) { return Number(shares[id]) || 0; }));
  var out = {};
  ids.forEach(function (id, i) { out[id] = dist[i]; });
  return out;
}
