/**
 * Reports.gs — مدل داده گزارش روزانه/ماهانه/بازه دلخواه و ارسال خصوصی به نقش‌های مجاز.
 * جمع‌ها مستقیماً از مقادیر ذخیره‌شده (ریال) محاسبه می‌شوند تا با سیستم دقیقاً تطبیق کنند.
 */

var REPORT_GROUP_ = {
  READY_FOR_REVIEW: 'PENDING', APPROVED: 'APPROVED_UNPAID', PAID: 'PAID', REJECTED: 'REJECTED',
  NEEDS_CORRECTION: 'INCOMPLETE', DRAFT: 'INCOMPLETE', WAITING_FOR_PURCHASE_RECEIPT: 'INCOMPLETE',
  WAITING_FOR_PAYMENT_PROOF: 'INCOMPLETE', WAITING_FOR_DETAILS: 'INCOMPLETE', CANCELLED: 'CANCELLED'
};

var REPORT_GROUP_FA_ = {
  PENDING: 'در انتظار بررسی', APPROVED_UNPAID: 'تأییدشده اما پرداخت‌نشده', PAID: 'پرداخت‌شده',
  REJECTED: 'ردشده', INCOMPLETE: 'ناقص / نیازمند اصلاح', CANCELLED: 'لغوشده'
};

/**
 * ساخت مدل گزارش برای بازه [fromIso, toIso] بر اساس تاریخ سفارش.
 * opts.includeAudit: فقط برای ادمین مالی/مالک (شیت مدارک و تاریخچه).
 */
function Rep_build_(fromIso, toIso, opts) {
  opts = opts || {};
  var reqs = Db_find_(SHEETS.REQUESTS, function (r) {
    if (!r.order_date_iso || r.order_date_iso < fromIso || r.order_date_iso > toIso) return false;
    if (r.status === STATUS.CANCELLED && !r.submitted_at) return false;
    return true;
  }).sort(function (a, b) { return (a.order_date_iso + a.request_id).localeCompare(b.order_date_iso + b.request_id); });
  var ids = {};
  reqs.forEach(function (r) { ids[r.request_id] = r; });
  var bensBy = {};
  Db_all_(SHEETS.BENEFICIARIES).forEach(function (b) {
    if (ids[b.request_id]) (bensBy[b.request_id] = bensBy[b.request_id] || []).push(b);
  });
  var docsBy = {};
  Db_all_(SHEETS.DOCUMENTS).forEach(function (d) {
    if (ids[d.request_id] && d.status !== 'REMOVED') (docsBy[d.request_id] = docsBy[d.request_id] || []).push(d);
  });

  var sum = {
    orders: 0, uniqueBeneficiariesApproved: 0, uniqueBeneficiariesAll: 0, claimed: 0, eligible: 0, approved: 0,
    paid: 0, unpaid: 0, pendingEstimate: 0, counts: { PENDING: 0, APPROVED_UNPAID: 0, PAID: 0, REJECTED: 0, INCOMPLETE: 0, CANCELLED: 0 }
  };
  var uniqApproved = {}, uniqAll = {}, payouts = {}, capUsage = {}, orders = [], pendingRejected = [], approvers = {};

  reqs.forEach(function (r) {
    var g = REPORT_GROUP_[r.status] || 'INCOMPLETE';
    sum.counts[g]++;
    var bens = bensBy[r.request_id] || [];
    var docs = docsBy[r.request_id] || [];
    var submitted = DRAFT_STATUSES.indexOf(r.status) < 0 && g !== 'CANCELLED';
    if (submitted) {
      sum.orders++;
      sum.claimed += r.claimed_total_rial;
      sum.eligible += r.eligible_total_rial;
      bens.forEach(function (b) { uniqAll[r.order_date_iso + '|' + b.employee_id] = true; });
    }
    if (g === 'PENDING') sum.pendingEstimate += r.calculated_reimbursement_rial;
    if (g === 'APPROVED_UNPAID' || g === 'PAID') {
      sum.approved += r.approved_reimbursement_rial;
      if (g === 'PAID') sum.paid += r.approved_reimbursement_rial; else sum.unpaid += r.approved_reimbursement_rial;
      if (r.reviewed_by) approvers[r.reviewed_by] = true;
      var p = payouts[r.payer_employee_id] = payouts[r.payer_employee_id] || {
        payer_employee_id: r.payer_employee_id, payer_name: Emp_name_(r.payer_employee_id),
        payee_identifier: (Emp_byId_(r.payer_employee_id) || {}).payment_identifier_optional || '',
        request_ids: [], count: 0, approved: 0, paid: 0, unpaid: 0
      };
      p.request_ids.push(r.request_id);
      p.count++;
      p.approved += r.approved_reimbursement_rial;
      if (g === 'PAID') p.paid += r.approved_reimbursement_rial; else p.unpaid += r.approved_reimbursement_rial;
      bens.forEach(function (b) {
        uniqApproved[r.order_date_iso + '|' + b.employee_id] = true;
        var k = r.order_date_iso + '|' + b.employee_id;
        var c = capUsage[k] = capUsage[k] || {
          date: r.order_date_iso, employee_id: b.employee_id, name: b.employee_name_snapshot, cap: r.cap_rial_applied, used: 0, actual: 0, request_ids: []
        };
        c.used += b.approved_allocation_rial;
        c.actual += b.actual_cost_rial;
        c.cap = Math.max(c.cap, r.cap_rial_applied);
        c.request_ids.push(r.request_id);
      });
    }
    var purchaseN = docs.filter(function (d) { return d.document_kind === DOC_KIND.PURCHASE; }).length;
    var paymentN = docs.filter(function (d) { return PAYMENT_DOC_KINDS.indexOf(d.document_kind) >= 0; }).length;
    var row = {
      request_id: r.request_id, date: r.order_date_iso, jdate: Jal_isoToJalali_(r.order_date_iso),
      submitter: Emp_name_(r.submitter_employee_id), payer: Emp_name_(r.payer_employee_id),
      channel: CHANNEL_FA[r.purchase_channel] || '', payment: PAY_METHOD_FA[r.payment_method] || '',
      beneficiaries: bens.map(function (b) { return b.employee_name_snapshot; }).join('، '), count: bens.length,
      claimed: r.claimed_total_rial, non_eligible: r.non_eligible_rial, eligible: r.eligible_total_rial,
      calculated: r.calculated_reimbursement_rial, approved: (g === 'APPROVED_UNPAID' || g === 'PAID') ? r.approved_reimbursement_rial : 0,
      status: STATUS_FA[r.status] || r.status, group: g, payment_status: r.payment_status || '',
      docs: 'خرید ' + purchaseN + ' | پرداخت ' + paymentN + (r.combined_evidence ? ' | ترکیبی' : ''),
      docs_complete: purchaseN > 0 && (paymentN > 0 || r.combined_evidence),
      flags: Req_flagList_(r).map(function (f) { return FLAG_FA[f.split(':')[0]] || f; }).join('؛ '),
      folder: opts.includeAudit ? Doc_folderLink_(r.drive_folder_id) : '',
      reviewed_by: r.reviewed_by ? Adm_actorName_(r.reviewed_by) : '', reviewed_at: r.reviewed_at || '',
      reason: r.rejection_reason || ''
    };
    orders.push(row);
    if (g === 'PENDING' || g === 'REJECTED' || g === 'INCOMPLETE') pendingRejected.push(row);
  });
  sum.uniqueBeneficiariesApproved = Object.keys(uniqApproved).length;
  sum.uniqueBeneficiariesAll = Object.keys(uniqAll).length;

  var evidence = [], audit = [];
  if (opts.includeAudit) {
    reqs.forEach(function (r) {
      (docsBy[r.request_id] || []).forEach(function (d) {
        evidence.push({
          document_id: d.document_id, request_id: r.request_id, kind: DOC_KIND_FA[d.document_kind] || d.document_kind,
          mime: d.mime_type, uploaded_at: d.uploaded_at, ocr: d.ocr_status,
          extracted: d.extracted_amount_rial === '' ? '' : Number(d.extracted_amount_rial),
          flags: String(d.verification_flags || '').split(',').filter(Boolean).map(function (f) { return FLAG_FA[f.split(':')[0]] || f; }).join('؛ '),
          link: Doc_driveLink_(d.drive_file_id), authenticity: 'authenticity_not_verified — اصالت تأیید نشده'
        });
      });
    });
    Db_all_(SHEETS.AUDIT).forEach(function (a) {
      if (ids[a.request_id]) audit.push({ request_id: a.request_id, action: a.action, actor: Adm_actorName_(a.actor_telegram_id), from: a.previous_state, to: a.new_state, at: a.created_at });
    });
  }

  var evidencePages = opts.includeEvidence ? Rep_evidencePages_(reqs, bensBy, docsBy, ids) : [];

  var payoutList = Object.keys(payouts).map(function (k) { return payouts[k]; }).sort(function (a, b) { return b.approved - a.approved; });
  var capList = Object.keys(capUsage).map(function (k) { var c = capUsage[k]; c.remaining = Math.max(0, c.cap - c.used); return c; })
    .sort(function (a, b) { return (a.date + a.name).localeCompare(b.date + b.name, 'fa'); });

  return {
    from: fromIso, to: toIso, type: opts.type || (fromIso === toIso ? 'DAILY' : 'RANGE'),
    title: Rep_title_(fromIso, toIso, opts.type),
    generated_at: Utils_nowIso_(), generated_by: opts.generatedBy || '',
    include_audit: !!opts.includeAudit,
    summary: sum, payouts: payoutList, orders: orders, cap_usage: capList, pending_rejected: pendingRejected,
    evidence: evidence, audit: audit, evidence_pages: evidencePages,
    approvers: Object.keys(approvers).map(Adm_actorName_)
  };
}

function Rep_title_(fromIso, toIso, type) {
  if (fromIso === toIso) return 'گزارش روزانه بازپرداخت ناهار — ' + Jal_formatLong_(fromIso);
  if (type === 'MONTHLY') {
    var j = Jal_fromIso_(fromIso);
    return 'گزارش ماهانه بازپرداخت ناهار — ' + JALALI_MONTHS_FA[j.jm - 1] + ' ' + Utils_faDigits_(j.jy);
  }
  return 'گزارش بازپرداخت ناهار — از ' + Jal_formatLong_(fromIso, false) + ' تا ' + Jal_formatLong_(toIso, false);
}

function Rep_summaryText_(m) {
  var s = m.summary;
  var L = [
    '📊 <b>' + m.title + '</b>',
    'سفارش‌های ثبت‌شده: ' + Utils_faDigits_(s.orders) + ' | افراد یکتا (تأییدشده): ' + Utils_faDigits_(s.uniqueBeneficiariesApproved),
    'مبلغ کل فاکتورها: ' + Utils_formatRial_(s.claimed),
    'مبلغ واجد شرایط: ' + Utils_formatRial_(s.eligible),
    'مبلغ تأییدشده: <b>' + Utils_formatRial_(s.approved) + '</b>',
    'پرداخت‌شده: ' + Utils_formatRial_(s.paid),
    'قابل واریز (تأییدشده، پرداخت‌نشده): <b>' + Utils_formatRial_(s.unpaid) + '</b>',
    'در انتظار بررسی: ' + Utils_faDigits_(s.counts.PENDING) + ' مورد (تخمینی ' + Utils_formatRial_(s.pendingEstimate) + '؛ جزو جمع قابل پرداخت نیست)',
    'ردشده: ' + Utils_faDigits_(s.counts.REJECTED) + ' | ناقص/نیازمند اصلاح: ' + Utils_faDigits_(s.counts.INCOMPLETE)
  ];
  if (m.payouts.length) {
    L.push('');
    L.push('<b>دریافت‌کنندگان وجه:</b>');
    m.payouts.slice(0, 25).forEach(function (p) {
      L.push('• ' + Utils_escapeHtml_(p.payer_name) + ': ' + Utils_formatRial_(p.approved) + (p.unpaid ? ' (قابل واریز ' + Utils_formatNumberFa_(p.unpaid) + ')' : ' ✅'));
    });
  }
  return L.join('\n');
}

/** تولید فایل‌ها + بایگانی خصوصی + ردیف ReportsArchive. */
function Rep_generate_(model) {
  var files = Exp_generateFiles_(model);
  Db_insert_(SHEETS.REPORTS, {
    report_id: Utils_newId_('RP'), report_type: model.type, from_iso: model.from, to_iso: model.to,
    generated_at: model.generated_at, generated_by: model.generated_by,
    xlsx_drive_id: files.xlsxId, pdf_drive_id: files.pdfId, snapshot_drive_id: files.snapshotId,
    totals_json: { summary: model.summary, include_audit: model.include_audit }
  });
  return files;
}

function Rep_sendTo_(chatId, model, files) {
  Tg_send_(chatId, Rep_summaryText_(model));
  Tg_sendDocument_(chatId, files.xlsxBlob, '📗 Excel — ' + model.title);
  Tg_sendDocument_(chatId, files.pdfBlob, '📕 PDF — ' + model.title);
}

/** فرمان‌های /dailyreport /monthlyreport /export */
function Rep_command_(ctx, kind, args) {
  if (!Adm_require_(ctx, 'REPORT')) return;
  var today = Utils_todayIso_();
  var a = String(args || '').trim().split(/\s+/).filter(Boolean);
  var from, to, type;
  if (kind === 'daily') {
    from = to = a[0] ? Jal_parseUserDate_(a[0]) : today;
    type = 'DAILY';
  } else if (kind === 'monthly') {
    var jy, jm;
    if (a[0]) {
      var mm = Utils_normalizeDigits_(a[0]).match(/^(\d{4})[\/\-](\d{1,2})$/);
      if (mm) { jy = Number(mm[1]); jm = Number(mm[2]); }
    } else {
      var jt = Jal_fromIso_(today);
      jy = jt.jy; jm = jt.jm;
    }
    if (jy && jm >= 1 && jm <= 12) {
      var range = Jal_monthRangeIso_(jy, jm);
      from = range.from; to = range.to;
    }
    type = 'MONTHLY';
  } else {
    from = a[0] ? Jal_parseUserDate_(a[0]) : null;
    to = a[1] ? Jal_parseUserDate_(a[1]) : from;
    type = 'RANGE';
  }
  if (!from || !to || from > to) {
    return Ui_send_(ctx, '⚠️ تاریخ نامعتبر است. نمونه‌ها:\n/dailyreport 1405/08/09\n/monthlyreport 1405/08\n/export 1405/08/01 1405/08/15');
  }
  if (Utils_isoDiffDays_(from, to) > 92) return Ui_send_(ctx, '⚠️ حداکثر بازه گزارش ۹۲ روز است.');
  var includeAudit = Auth_can_(ctx.auth, 'AUDIT_REPORT');
  Ui_send_(ctx, '⏳ در حال تهیه گزارش Excel و PDF… (ممکن است تا یک دقیقه طول بکشد)');
  var chatId = ctx.chatId, actor = ctx.tgId;
  ctx.defer(function () {
    try {
      var model = Rep_build_(from, to, {
        includeAudit: includeAudit, type: type, generatedBy: actor,
        includeEvidence: includeAudit && type === 'DAILY' && Settings_bool_('REPORT_PDF_EVIDENCE')
      });
      var files = Rep_generate_(model);
      Rep_sendTo_(chatId, model, files);
    } catch (e) {
      Audit_error_('REPORT', e, actor);
      Tg_trySend_(chatId, '⚠️ تهیه گزارش ناموفق بود. خطا ثبت شد؛ لطفاً چند دقیقه دیگر دوباره امتحان کنید.');
    }
  });
}

/** گیرندگان گزارش خودکار: فقط افراد دارای نقش REPORT. */
function Rep_recipients_() {
  var allowed = Auth_chatIdsWith_('REPORT');
  var configured = Utils_normalizeDigits_(Settings_str_('REPORT_RECIPIENTS')).split(/[,\s،]+/).filter(function (s) { return /^\d+$/.test(s); });
  var reviewers = Auth_chatIdsWith_('AUDIT_REPORT');
  var list = configured.length ? configured.filter(function (id) { return allowed.indexOf(id) >= 0; }) : reviewers;
  return list.map(function (id) { return { chatId: id, audit: reviewers.indexOf(id) >= 0 }; });
}

/** اجرای زمان‌بندی‌شده گزارش روزانه (از Triggers). */
function Rep_scheduledDaily_() {
  if (!Settings_bool_('REPORT_DAILY_ENABLED')) return;
  var today = Utils_todayIso_();
  var recipients = Rep_recipients_();
  if (!recipients.length) return;
  var cache = {};
  recipients.forEach(function (r) {
    var key = r.audit ? 'audit' : 'plain';
    if (!cache[key]) {
      var model = Rep_build_(today, today, {
        includeAudit: r.audit, type: 'DAILY', generatedBy: 'SCHEDULER', includeEvidence: r.audit && Settings_bool_('REPORT_PDF_EVIDENCE')
      });
      cache[key] = { model: model, files: model.summary.orders || model.summary.counts.INCOMPLETE ? Rep_generate_(model) : null };
    }
    var c = cache[key];
    if (!c.files) Tg_trySend_(r.chatId, '📊 ' + c.model.title + '\nامروز درخواستی ثبت نشده است.');
    else {
      try { Rep_sendTo_(r.chatId, c.model, c.files); } catch (e) { Audit_error_('REPORT_SEND', e, 'SCHEDULER'); }
    }
  });
}

/** فهرست گزارش‌های بایگانی‌شده (لینک‌های خصوصی Drive) برای ادمین مالی/مالک. */
function Rep_listArchive_(ctx) {
  if (!Adm_require_(ctx, 'AUDIT_REPORT')) return;
  var list = Db_all_(SHEETS.REPORTS).slice(-10).reverse();
  if (!list.length) return Ui_send_(ctx, 'هنوز گزارشی بایگانی نشده است.');
  var lines = list.map(function (r) {
    var range = Jal_formatShortFa_(r.from_iso) + (r.to_iso !== r.from_iso ? ' تا ' + Jal_formatShortFa_(r.to_iso) : '');
    var approved = r.totals_json && r.totals_json.summary ? ' | تأییدشده ' + Utils_formatRial_(r.totals_json.summary.approved) : '';
    return '• ' + range + ' (' + Jal_formatDateTimeFa_(r.generated_at) + ')' + approved +
      '\n   <a href="' + Doc_driveLink_(r.xlsx_drive_id) + '">Excel</a> | <a href="' + Doc_driveLink_(r.pdf_drive_id) + '">PDF</a>';
  });
  Ui_send_(ctx, '🗄 <b>آخرین گزارش‌های بایگانی‌شده</b> (لینک‌های خصوصی Drive؛ فقط برای حساب‌های مجاز باز می‌شوند):\n' + lines.join('\n'));
}

/**
 * صفحات پیوست مدارک برای PDF روزانه: برای هر درخواست ثبت‌شده (به‌جز لغوشده/پیش‌نویس)،
 * ابتدا مدارک خرید و سپس مدارک پرداخت، با توضیح (کپشن) کارمند.
 */
function Rep_evidencePages_(reqs, bensBy, docsBy) {
  var max = Settings_int_('REPORT_PDF_MAX_IMAGES') || 150;
  var pages = [];
  reqs.forEach(function (r) {
    if (r.status === STATUS.CANCELLED || DRAFT_STATUSES.indexOf(r.status) >= 0) return;
    var docs = (docsBy[r.request_id] || []).filter(function (d) { return d.document_kind !== DOC_KIND.VOICE_NOTE; });
    var ordered = docs.filter(function (d) { return d.document_kind === DOC_KIND.PURCHASE; })
      .concat(docs.filter(function (d) { return PAYMENT_DOC_KINDS.indexOf(d.document_kind) >= 0; }));
    var bens = (bensBy[r.request_id] || []).map(function (b) { return b.employee_name_snapshot; }).join('، ');
    ordered.forEach(function (d) {
      var sameKind = ordered.filter(function (x) { return (x.document_kind === DOC_KIND.PURCHASE) === (d.document_kind === DOC_KIND.PURCHASE); });
      pages.push({
        document_id: d.document_id, request_id: r.request_id,
        kind_fa: d.document_kind === DOC_KIND.PURCHASE ? 'فاکتور / رسید غذا' : DOC_KIND_FA[d.document_kind],
        index: sameKind.indexOf(d) + 1, count: sameKind.length,
        date_fa: Jal_formatLong_(r.order_date_iso), status: STATUS_FA[r.status] || r.status,
        payer: Emp_name_(r.payer_employee_id), beneficiaries: bens,
        claimed: r.claimed_total_rial, approved: (r.status === STATUS.APPROVED || r.status === STATUS.PAID) ? r.approved_reimbursement_rial : 0,
        merchant: [r.merchant, r.merchant_order_id].filter(Boolean).join(' — '),
        caption: d.caption || '', uploaded_fa: Jal_formatDateTimeFa_(d.uploaded_at),
        uploaded_by: (Emp_byTelegramId_(d.uploaded_by) || {}).full_name_fa || String(d.uploaded_by || ''),
        drive_file_id: d.drive_file_id, telegram_file_id: d.telegram_file_id, mime_type: d.mime_type, file_size: d.file_size,
        isImage: String(d.mime_type || '').indexOf('image/') === 0
      });
    });
  });
  if (pages.length > max) pages = pages.slice(0, max);
  return pages;
}
