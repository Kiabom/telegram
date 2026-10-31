/**
 * Requests.gs — سرویس درخواست: پیش‌نویس، ثبت نهایی، تأیید/رد/اصلاح/پرداخت/لغو تأیید.
 *
 * همه توابع تغییردهنده باید داخل قفل سراسری (Router) اجرا شوند.
 * در لحظه تأیید، سقف روزانه دوباره و با توجه به همه تأییدهای همان روز محاسبه می‌شود.
 * برای هر درخواست تأییدشده دقیقاً یک Payment فعال به نام پرداخت‌کننده ساخته می‌شود.
 */

function Req_get_(rid) {
  return rid ? Db_findOne_(SHEETS.REQUESTS, 'request_id', rid) : null;
}

function Req_bens_(rid) {
  return Db_find_(SHEETS.BENEFICIARIES, function (b) { return b.request_id === rid; });
}

function Req_activePayment_(rid) {
  var list = Db_find_(SHEETS.PAYMENTS, function (p) { return p.request_id === rid && p.status !== 'CANCELLED'; });
  return list.length ? list[list.length - 1] : null;
}

function Req_newId_() {
  var j = Jal_isoToJalali_(Utils_todayIso_()).replace(/\//g, '').slice(2);
  for (var i = 0; i < 5; i++) {
    var id = 'LR-' + j + '-' + Utils_randomCode_(4);
    if (!Req_get_(id)) return id;
  }
  return 'LR-' + j + '-' + Utils_randomCode_(8);
}

function Req_createDraft_(ctx) {
  var now = Utils_nowIso_();
  var req = Db_insert_(SHEETS.REQUESTS, {
    request_id: Req_newId_(),
    submitter_telegram_id: ctx.tgId,
    submitter_employee_id: ctx.auth.employee.employee_id,
    status: STATUS.DRAFT,
    created_at: now,
    updated_at: now
  });
  Audit_log_(req.request_id, ctx.tgId, 'DRAFT_CREATED', '', STATUS.DRAFT, {});
  return req;
}

/** وضعیت پیش‌نویس بر اساس پیشرفت فرم. */
function Req_draftStatus_(d) {
  if (!d.channel || !d.payment) return STATUS.DRAFT;
  if (!d.purchaseDone) return STATUS.WAITING_FOR_PURCHASE_RECEIPT;
  if (!d.paymentDone) return STATUS.WAITING_FOR_PAYMENT_PROOF;
  return STATUS.WAITING_FOR_DETAILS;
}

/** همگام‌سازی سبک پیش‌نویس با شیت (فقط در صورت تغییر). */
function Req_syncDraft_(d) {
  if (d.mode === 'CORRECTION') return;
  var req = Req_get_(d.rid);
  if (!req || DRAFT_STATUSES.indexOf(req.status) < 0) return;
  var patch = {
    status: Req_draftStatus_(d),
    purchase_channel: d.channel || '',
    payment_method: d.payment || '',
    order_date_iso: d.date || '',
    order_date_jalali: d.date ? Jal_isoToJalali_(d.date) : ''
  };
  var changed = Object.keys(patch).some(function (k) { return String(req[k]) !== String(patch[k]); });
  if (!changed) return;
  var prev = req.status;
  patch.updated_at = Utils_nowIso_();
  Db_update_(SHEETS.REQUESTS, req, patch);
  if (prev !== patch.status) Audit_log_(req.request_id, req.submitter_telegram_id, 'DRAFT_PROGRESS', prev, patch.status, {});
}

/**
 * مجموع تخصیص تأییدشده هر نفر در یک روز (فقط APPROVED/PAID)، به‌جز درخواست exclude.
 */
function Req_usageForDate_(dateIso, excludeRid) {
  var counted = {};
  Db_all_(SHEETS.REQUESTS).forEach(function (r) {
    if (r.order_date_iso === dateIso && r.request_id !== excludeRid && CAP_CONSUMING_STATUSES.indexOf(r.status) >= 0) counted[r.request_id] = true;
  });
  var usage = {};
  Db_all_(SHEETS.BENEFICIARIES).forEach(function (b) {
    if (counted[b.request_id]) usage[b.employee_id] = (usage[b.employee_id] || 0) + (b.approved_allocation_rial || 0);
  });
  return usage;
}

/** تعداد درخواست‌های دیگر در انتظار بررسی که شامل هر نفر هستند (برای هشدار تخمینی بودن). */
function Req_pendingOthersForDate_(dateIso, excludeRid) {
  var pending = {};
  Db_all_(SHEETS.REQUESTS).forEach(function (r) {
    if (r.order_date_iso === dateIso && r.request_id !== excludeRid && r.status === STATUS.READY_FOR_REVIEW) pending[r.request_id] = true;
  });
  var out = {};
  Db_all_(SHEETS.BENEFICIARIES).forEach(function (b) {
    if (pending[b.request_id]) out[b.employee_id] = (out[b.employee_id] || 0) + 1;
  });
  return out;
}

/** محاسبه تخمینی (پیش از تأیید) برای نمایش به کاربر/ادمین. */
function Req_estimate_(dateIso, costs, rid) {
  var cap = Settings_capForDate_(dateIso);
  var alloc = Fin_computeAllocations_(costs, Req_usageForDate_(dateIso, rid), cap);
  alloc.cap = cap;
  alloc.pendingOthers = Req_pendingOthersForDate_(dateIso, rid);
  return alloc;
}

function Req_draftCosts_(d) {
  var eligible = d.total - (d.nonElig || 0);
  var mode = d.people.length === 1 ? SPLIT.SINGLE : d.split;
  return Fin_buildCosts_(mode, d.people, eligible, d.shares || {});
}

function Req_flagList_(req) {
  return String(req.flags || '').split(',').filter(Boolean);
}

/** ثبت نهایی فرم (ارسال برای بررسی ادمین). */
function Req_submit_(ctx, d) {
  var req = Req_get_(d.rid);
  if (!req) return { ok: false, error: 'NOT_FOUND' };
  var allowedFrom = d.mode === 'CORRECTION' ? [STATUS.NEEDS_CORRECTION] : DRAFT_STATUSES;
  if (allowedFrom.indexOf(req.status) < 0) return { ok: false, error: 'BAD_STATUS', status: req.status };
  if (String(req.submitter_telegram_id) !== String(ctx.tgId)) return { ok: false, error: 'NOT_OWNER' };

  var purchaseCount = Doc_count_(req.request_id, [DOC_KIND.PURCHASE]);
  var paymentCount = Doc_count_(req.request_id, PAYMENT_DOC_KINDS);
  if (!purchaseCount) return { ok: false, error: 'MISSING_PURCHASE_DOC' };
  if (!paymentCount && !(d.combined && Settings_bool_('ALLOW_COMBINED_EVIDENCE'))) return { ok: false, error: 'MISSING_PAYMENT_DOC' };

  var costs = Req_draftCosts_(d);
  var eligible = d.total - (d.nonElig || 0);
  var est = Req_estimate_(d.date, costs, req.request_id);

  var flags = ['AUTHENTICITY_NOT_VERIFIED'];
  if (d.payerId !== ctx.auth.employee.employee_id) flags.push('PAYER_NOT_SUBMITTER');
  if (d.people.indexOf(d.payerId) < 0) flags.push('PAYER_NOT_BENEFICIARY');
  if (d.payment === PAY_METHOD.CREDIT) flags.push('CREDIT_PAYMENT');
  if (d.payment === PAY_METHOD.MIXED) flags.push('MIXED_PAYMENT');
  if (d.combined) flags.push('COMBINED_EVIDENCE');
  if (d.rebalanced) flags.push('PROPORTIONAL_DISTRIBUTION');
  if (d.prefilled) flags.push('FREE_TEXT_PREFILL');
  if (d.total < Settings_int_('LOW_AMOUNT_WARNING_RIAL') || d.total > Settings_int_('HIGH_AMOUNT_WARNING_RIAL')) flags.push('AMOUNT_UNUSUAL');
  if (est.lines.some(function (l) { return l.remaining_cap_before_rial < l.actual_cost_rial; })) flags.push('OVER_CAP');
  if (est.lines.some(function (l) { return l.prior_approved_today_rial > 0; })) flags.push('PRIOR_USAGE');
  (d.aiFlags || []).forEach(function (f) { flags.push(f); });
  Ai_mismatchFlags_(req.request_id, d.total).forEach(function (f) { flags.push(f); });
  Doc_forRequest_(req.request_id).forEach(function (doc) {
    String(doc.verification_flags || '').split(',').forEach(function (f) {
      if (f.indexOf('DUPLICATE_FILE') === 0) flags.push(f);
      if (f === 'DRIVE_SAVE_FAILED') flags.push(f);
    });
  });
  if (d.orderNo) {
    var dupOrder = Db_find_(SHEETS.REQUESTS, function (r) {
      return r.request_id !== req.request_id && r.merchant_order_id && r.merchant_order_id === d.orderNo &&
        [STATUS.CANCELLED, STATUS.REJECTED].indexOf(r.status) < 0;
    });
    if (dupOrder.length) flags.push('DUPLICATE_ORDER_ID:' + dupOrder[0].request_id);
  }
  flags = Utils_unique_(flags);

  var now = Utils_nowIso_();
  Db_deleteWhere_(SHEETS.BENEFICIARIES, function (b) { return b.request_id === req.request_id; });
  est.lines.forEach(function (l) {
    Db_insert_(SHEETS.BENEFICIARIES, {
      request_id: req.request_id,
      employee_id: l.employee_id,
      employee_name_snapshot: Emp_name_(l.employee_id),
      actual_cost_rial: l.actual_cost_rial,
      prior_approved_today_rial: l.prior_approved_today_rial,
      remaining_cap_before_rial: l.remaining_cap_before_rial,
      approved_allocation_rial: 0,
      created_at: now,
      updated_at: now
    });
  });

  var prev = req.status;
  var aiUsed = Doc_forRequest_(req.request_id).some(function (doc) { return doc.ocr_status === 'DONE'; }) || !!d.aiVoiceUsed;
  Db_update_(SHEETS.REQUESTS, req, {
    payer_employee_id: d.payerId,
    purchase_channel: d.channel,
    payment_method: d.payment,
    order_date_iso: d.date,
    order_date_jalali: Jal_isoToJalali_(d.date),
    merchant: d.merchant || '',
    merchant_order_id: d.orderNo || '',
    claimed_total_rial: d.total,
    non_eligible_rial: d.nonElig || 0,
    eligible_total_rial: eligible,
    calculated_reimbursement_rial: est.total_rial,
    approved_reimbursement_rial: 0,
    cap_rial_applied: est.cap,
    status: STATUS.READY_FOR_REVIEW,
    split_mode: d.people.length === 1 ? SPLIT.SINGLE : d.split,
    equal_split_confirmed: d.split === SPLIT.EQUAL,
    payer_is_submitter: d.payerId === ctx.auth.employee.employee_id,
    combined_evidence: !!d.combined,
    ai_used: aiUsed,
    ai_review_needed: aiUsed || (d.aiFlags || []).length > 0,
    flags: flags.join(','),
    submitted_at: now,
    updated_at: now,
    rejection_reason: ''
  });
  Audit_log_(req.request_id, ctx.tgId, d.mode === 'CORRECTION' ? 'RESUBMITTED' : 'SUBMITTED', prev, STATUS.READY_FOR_REVIEW, {
    payer_employee_id: d.payerId, beneficiaries: costs, claimed_total_rial: d.total, eligible_total_rial: eligible,
    estimated_reimbursement_rial: est.total_rial, flags: flags
  });
  return { ok: true, req: req, estimate: est, flags: flags };
}

function Req_docsComplete_(req) {
  var p = Doc_count_(req.request_id, [DOC_KIND.PURCHASE]);
  var y = Doc_count_(req.request_id, PAYMENT_DOC_KINDS);
  return p > 0 && (y > 0 || (req.combined_evidence && Settings_bool_('ALLOW_COMBINED_EVIDENCE')));
}

/**
 * تأیید اتمیک: سقف دوباره محاسبه می‌شود؛ اگر مبلغ با مبلغ نمایش‌داده‌شده به ادمین فرق کند، تأیید انجام نمی‌شود
 * و مبلغ جدید برای تأیید مجدد برگردانده می‌شود (جلوگیری از عبور از سقف در تأییدهای همزمان).
 */
function Req_approve_(rid, expectedRial, actor) {
  var req = Req_get_(rid);
  if (!req) return { ok: false, code: 'NOT_FOUND' };
  if (req.status === STATUS.APPROVED || req.status === STATUS.PAID) return { ok: false, code: 'ALREADY', req: req };
  if (req.status !== STATUS.READY_FOR_REVIEW) return { ok: false, code: 'BAD_STATUS', req: req };
  if (!Req_docsComplete_(req)) return { ok: false, code: 'MISSING_DOCS', req: req };
  var bens = Req_bens_(rid);
  if (!bens.length) return { ok: false, code: 'NO_BENEFICIARIES', req: req };

  var cap = Settings_capForDate_(req.order_date_iso);
  var usage = Req_usageForDate_(req.order_date_iso, rid);
  var alloc = Fin_computeAllocations_(bens.map(function (b) {
    return { employee_id: b.employee_id, actual_cost_rial: b.actual_cost_rial };
  }), usage, cap);
  if (Number(expectedRial) !== alloc.total_rial) return { ok: false, code: 'AMOUNT_CHANGED', amount: alloc.total_rial, req: req };

  var now = Utils_nowIso_();
  alloc.lines.forEach(function (l) {
    var b = bens.filter(function (x) { return x.employee_id === l.employee_id; })[0];
    Db_update_(SHEETS.BENEFICIARIES, b, {
      prior_approved_today_rial: l.prior_approved_today_rial,
      remaining_cap_before_rial: l.remaining_cap_before_rial,
      approved_allocation_rial: l.approved_allocation_rial,
      updated_at: now
    });
  });
  var payer = Emp_byId_(req.payer_employee_id);
  Db_update_(SHEETS.REQUESTS, req, {
    status: STATUS.APPROVED,
    calculated_reimbursement_rial: alloc.total_rial,
    approved_reimbursement_rial: alloc.total_rial,
    cap_rial_applied: cap,
    reviewed_by: actor.tgId,
    reviewed_at: now,
    payment_status: 'PENDING',
    updated_at: now
  });
  var payment = Db_insert_(SHEETS.PAYMENTS, {
    payment_id: Utils_newId_('P'),
    request_id: rid,
    payer_employee_id: req.payer_employee_id,
    payer_name_snapshot: payer ? payer.full_name_fa : '',
    amount_rial: alloc.total_rial,
    payee_identifier_optional: payer ? payer.payment_identifier_optional : '',
    status: 'PENDING',
    transaction_reference_optional: '',
    approved_at: now,
    paid_at: '',
    processed_by: actor.tgId,
    notes: '',
    updated_at: now
  });
  Audit_log_(rid, actor.tgId, 'APPROVED', STATUS.READY_FOR_REVIEW, STATUS.APPROVED, {
    approved_reimbursement_rial: alloc.total_rial, cap_rial: cap, allocations: alloc.lines, payment_id: payment.payment_id
  });
  return { ok: true, amount: alloc.total_rial, req: req, alloc: alloc, payment: payment };
}

function Req_reject_(rid, reason, actor) {
  var req = Req_get_(rid);
  if (!req) return { ok: false, code: 'NOT_FOUND' };
  if ([STATUS.READY_FOR_REVIEW, STATUS.NEEDS_CORRECTION].indexOf(req.status) < 0) return { ok: false, code: 'BAD_STATUS', req: req };
  var prev = req.status, now = Utils_nowIso_();
  Db_update_(SHEETS.REQUESTS, req, {
    status: STATUS.REJECTED, rejection_reason: reason, reviewed_by: actor.tgId, reviewed_at: now,
    approved_reimbursement_rial: 0, updated_at: now
  });
  Audit_log_(rid, actor.tgId, 'REJECTED', prev, STATUS.REJECTED, { reason: reason });
  return { ok: true, req: req };
}

function Req_requestCorrection_(rid, reason, actor) {
  var req = Req_get_(rid);
  if (!req) return { ok: false, code: 'NOT_FOUND' };
  if (req.status !== STATUS.READY_FOR_REVIEW) return { ok: false, code: 'BAD_STATUS', req: req };
  var now = Utils_nowIso_();
  Db_update_(SHEETS.REQUESTS, req, {
    status: STATUS.NEEDS_CORRECTION, rejection_reason: reason, reviewed_by: actor.tgId, reviewed_at: now, updated_at: now
  });
  Audit_log_(rid, actor.tgId, 'CORRECTION_REQUESTED', STATUS.READY_FOR_REVIEW, STATUS.NEEDS_CORRECTION, { reason: reason });
  return { ok: true, req: req };
}

/** لغو تأیید (فقط قبل از پرداخت). سهم سقف آزاد می‌شود و تاریخچه حفظ می‌شود. */
function Req_revoke_(rid, reason, actor) {
  var req = Req_get_(rid);
  if (!req) return { ok: false, code: 'NOT_FOUND' };
  if (req.status !== STATUS.APPROVED) return { ok: false, code: 'BAD_STATUS', req: req };
  var now = Utils_nowIso_();
  var before = Req_bens_(rid).map(function (b) { return { employee_id: b.employee_id, approved_allocation_rial: b.approved_allocation_rial }; });
  Req_bens_(rid).forEach(function (b) { Db_update_(SHEETS.BENEFICIARIES, b, { approved_allocation_rial: 0, updated_at: now }); });
  var pay = Req_activePayment_(rid);
  if (pay) Db_update_(SHEETS.PAYMENTS, pay, { status: 'CANCELLED', notes: 'لغو تأیید: ' + reason, updated_at: now });
  Db_update_(SHEETS.REQUESTS, req, {
    status: STATUS.READY_FOR_REVIEW, approved_reimbursement_rial: 0, payment_status: '',
    admin_notes: Req_appendNote_(req.admin_notes, 'لغو تأیید: ' + reason), updated_at: now
  });
  Audit_log_(rid, actor.tgId, 'APPROVAL_REVOKED', STATUS.APPROVED, STATUS.READY_FOR_REVIEW, {
    reason: reason, previous_allocations: before, payment_id: pay ? pay.payment_id : ''
  });
  return { ok: true, req: req };
}

function Req_markPaid_(rid, reference, actor) {
  var req = Req_get_(rid);
  if (!req) return { ok: false, code: 'NOT_FOUND' };
  if (req.status === STATUS.PAID) return { ok: false, code: 'ALREADY', req: req };
  if (req.status !== STATUS.APPROVED) return { ok: false, code: 'BAD_STATUS', req: req };
  var pay = Req_activePayment_(rid);
  if (!pay) return { ok: false, code: 'NO_PAYMENT', req: req };
  var now = Utils_nowIso_();
  Db_update_(SHEETS.PAYMENTS, pay, {
    status: 'PAID', transaction_reference_optional: reference || '', paid_at: now, processed_by: actor.tgId, updated_at: now
  });
  Db_update_(SHEETS.REQUESTS, req, { status: STATUS.PAID, payment_status: 'PAID', paid_at: now, updated_at: now });
  Audit_log_(rid, actor.tgId, 'PAID', STATUS.APPROVED, STATUS.PAID, { amount_rial: pay.amount_rial, reference: reference || '', payment_id: pay.payment_id });
  return { ok: true, req: req, payment: pay };
}

/**
 * اصلاح مبلغ واجد شرایط توسط ادمین (قبل از تأیید) با ثبت دلیل.
 * هزینه افراد: SINGLE → کل، EQUAL → تقسیم مساوی، INDIVIDUAL → توزیع متناسب با سهم‌های قبلی.
 */
function Req_adjustEligible_(rid, newEligible, reason, actor) {
  var req = Req_get_(rid);
  if (!req) return { ok: false, code: 'NOT_FOUND' };
  if (req.status !== STATUS.READY_FOR_REVIEW) return { ok: false, code: 'BAD_STATUS', req: req };
  if (!(newEligible >= 0) || newEligible > req.claimed_total_rial) return { ok: false, code: 'OUT_OF_RANGE', req: req };
  var bens = Req_bens_(rid);
  var ids = bens.map(function (b) { return b.employee_id; });
  var costs;
  if (bens.length === 1) costs = [newEligible];
  else if (req.split_mode === SPLIT.EQUAL) costs = Fin_splitEqual_(newEligible, bens.length);
  else costs = Fin_distributeProportional_(newEligible, bens.map(function (b) { return b.actual_cost_rial; }));
  var before = { eligible_total_rial: req.eligible_total_rial, costs: bens.map(function (b) { return b.actual_cost_rial; }) };
  var now = Utils_nowIso_();
  bens.forEach(function (b, i) { Db_update_(SHEETS.BENEFICIARIES, b, { actual_cost_rial: costs[i], updated_at: now }); });
  var est = Req_estimate_(req.order_date_iso, ids.map(function (id, i) { return { employee_id: id, actual_cost_rial: costs[i] }; }), rid);
  Db_update_(SHEETS.REQUESTS, req, {
    eligible_total_rial: newEligible,
    non_eligible_rial: req.claimed_total_rial - newEligible,
    calculated_reimbursement_rial: est.total_rial,
    admin_notes: Req_appendNote_(req.admin_notes, 'اصلاح مبلغ واجد شرایط به ' + newEligible + ' ریال: ' + reason),
    updated_at: now
  });
  Audit_log_(rid, actor.tgId, 'AMOUNT_ADJUSTED', req.status, req.status, {
    reason: reason, before: before, after: { eligible_total_rial: newEligible, costs: costs }
  });
  return { ok: true, req: req, estimate: est };
}

/** لغو توسط ثبت‌کننده (فقط قبل از تصمیم نهایی ادمین). */
function Req_cancelByUser_(rid, actorId) {
  var req = Req_get_(rid);
  if (!req) return { ok: false, code: 'NOT_FOUND' };
  if (String(req.submitter_telegram_id) !== String(actorId)) return { ok: false, code: 'NOT_OWNER' };
  var allowed = DRAFT_STATUSES.concat([STATUS.READY_FOR_REVIEW, STATUS.NEEDS_CORRECTION]);
  if (allowed.indexOf(req.status) < 0) return { ok: false, code: 'BAD_STATUS', req: req };
  var prev = req.status;
  Db_update_(SHEETS.REQUESTS, req, { status: STATUS.CANCELLED, updated_at: Utils_nowIso_() });
  Audit_log_(rid, actorId, 'CANCELLED_BY_USER', prev, STATUS.CANCELLED, {});
  return { ok: true, req: req, previous: prev };
}

function Req_appendNote_(notes, line) {
  var stamp = Jal_formatDateTimeFa_(Utils_nowIso_());
  return [notes, '[' + stamp + '] ' + line].filter(Boolean).join('\n');
}

/** بارگذاری پیش‌نویس فرم از یک درخواست موجود (برای اصلاح درخواست برگشتی). */
function Req_toDraft_(req) {
  var bens = Req_bens_(req.request_id);
  var shares = {};
  bens.forEach(function (b) { shares[b.employee_id] = b.actual_cost_rial; });
  var d = Wiz_newDraft_(req.request_id);
  d.mode = 'CORRECTION';
  d.channel = req.purchase_channel || null;
  d.payment = req.payment_method || null;
  d.purchaseDone = true;
  d.paymentDone = true;
  d.combined = !!req.combined_evidence;
  d.date = req.order_date_iso || null;
  d.people = bens.map(function (b) { return b.employee_id; });
  d.peopleDone = d.people.length > 0;
  d.payerId = req.payer_employee_id || null;
  d.payerDone = !!d.payerId;
  d.total = req.claimed_total_rial || null;
  d.nonElig = req.non_eligible_rial || 0;
  d.nonEligDone = true;
  d.split = bens.length > 1 ? (req.split_mode || null) : SPLIT.SINGLE;
  d.shares = d.split === SPLIT.INDIVIDUAL ? shares : {};
  d.merchant = req.merchant || '';
  d.orderNo = req.merchant_order_id || '';
  d.merchantDone = true;
  d.unitPref = 'RIAL';
  return d;
}
