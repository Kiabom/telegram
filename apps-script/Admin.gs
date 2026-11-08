/**
 * Admin.gs — رابط ادمین مالی: کارت درخواست، تأیید/رد/اصلاح/پرداخت، مدارک، کارکنان و تنظیمات.
 * همه اقدامات با نقش (نه username) کنترل و با وضعیت درخواست در برابر replay محافظت می‌شوند.
 */

function Adm_require_(ctx, perm) {
  if (Auth_can_(ctx.auth, perm)) return true;
  if (ctx.cb) Ui_toast_(ctx, '⛔️ دسترسی ندارید.', true);
  else Ui_send_(ctx, '⛔️ این فرمان فقط برای نقش‌های مجاز است.');
  Audit_log_('', ctx.tgId, 'ACCESS_DENIED', '', '', { perm: perm, text: Utils_truncate_(ctx.text || (ctx.cb && ctx.cb.data) || '', 80) });
  return false;
}

function Adm_reviewerIds_() {
  return Auth_chatIdsWith_('REVIEW');
}

function Adm_notifyNewRequest_(rid, resubmitted) {
  if (!Settings_bool_('NOTIFY_ADMINS_ON_SUBMIT')) return;
  var req = Req_get_(rid);
  var card = Adm_card_(req);
  var title = resubmitted ? '🔁 <b>درخواست اصلاح‌شده برای بررسی</b>\n' : '🆕 <b>درخواست جدید برای بررسی</b>\n';
  Adm_reviewerIds_().forEach(function (chatId) { Tg_trySend_(chatId, title + card.text, card.kb); });
}

/** متن و کیبورد کارت بررسی یک درخواست. */
function Adm_card_(req) {
  var rid = req.request_id;
  var bens = Req_bens_(rid);
  var docs = Doc_forRequest_(rid);
  var pDocs = docs.filter(function (d) { return d.document_kind === DOC_KIND.PURCHASE; });
  var yDocs = docs.filter(function (d) { return PAYMENT_DOC_KINDS.indexOf(d.document_kind) >= 0; });
  var vDocs = docs.filter(function (d) { return d.document_kind === DOC_KIND.VOICE_NOTE; });
  var live = null;
  if (req.status === STATUS.READY_FOR_REVIEW && bens.length) {
    live = Req_estimate_(req.order_date_iso, bens.map(function (b) { return { employee_id: b.employee_id, actual_cost_rial: b.actual_cost_rial }; }), rid);
  }
  var submitter = Emp_byId_(req.submitter_employee_id);
  var L = [];
  L.push('🧾 <b>درخواست <code>' + rid + '</code></b> — ' + (STATUS_ICON[req.status] || '') + ' ' + (STATUS_FA[req.status] || req.status));
  L.push('ثبت‌کننده: ' + Utils_escapeHtml_(submitter ? submitter.full_name_fa : req.submitter_telegram_id));
  L.push('پرداخت‌کننده (دریافت‌کننده کل وجه): <b>' + Utils_escapeHtml_(Emp_name_(req.payer_employee_id)) + '</b>');
  L.push('خرید: ' + (CHANNEL_FA[req.purchase_channel] || '—') + ' | پرداخت: ' + (PAY_METHOD_FA[req.payment_method] || '—'));
  L.push('تاریخ سفارش: ' + Jal_formatLong_(req.order_date_iso));
  if (req.merchant || req.merchant_order_id) L.push('رستوران/سفارش: ' + Utils_escapeHtml_([req.merchant, req.merchant_order_id ? 'شماره ' + req.merchant_order_id : ''].filter(Boolean).join(' — ')));
  L.push('افراد (' + Utils_faDigits_(bens.length) + ' نفر) — ' + (req.split_mode === SPLIT.EQUAL ? 'سهم مساوی' : req.split_mode === SPLIT.INDIVIDUAL ? 'سهم جداگانه' : 'تک‌نفره') + ':');
  bens.forEach(function (b) {
    if (live) {
      var l = live.lines.filter(function (x) { return x.employee_id === b.employee_id; })[0];
      L.push('• ' + Utils_escapeHtml_(b.employee_name_snapshot) + ' — سهم ' + Utils_formatNumberFa_(b.actual_cost_rial) +
        ' | مصرف قبلی ' + Utils_formatNumberFa_(l.prior_approved_today_rial) + ' | مانده ' + Utils_formatNumberFa_(l.remaining_cap_before_rial) +
        ' → مجاز ' + Utils_formatNumberFa_(l.approved_allocation_rial));
    } else {
      L.push('• ' + Utils_escapeHtml_(b.employee_name_snapshot) + ' — سهم ' + Utils_formatNumberFa_(b.actual_cost_rial) + ' → تخصیص ' + Utils_formatNumberFa_(b.approved_allocation_rial));
    }
  });
  L.push('مبلغ فاکتور: ' + Utils_formatRial_(req.claimed_total_rial));
  if (req.non_eligible_rial) L.push('غیرقابل بازپرداخت: ' + Utils_formatRial_(req.non_eligible_rial));
  L.push('مبلغ واجد شرایط: ' + Utils_formatRial_(req.eligible_total_rial));
  if (live) L.push('💰 <b>بازپرداخت محاسبه‌شده (لحظه‌ای): ' + Utils_formatRial_(live.total_rial) + '</b> | سقف روز: ' + Utils_formatRial_(live.cap));
  else L.push('💰 <b>مبلغ تأییدشده: ' + Utils_formatRial_(req.approved_reimbursement_rial) + '</b>');
  L.push('مدارک: خرید ' + Utils_faDigits_(pDocs.length) + (pDocs.length ? ' ✅' : ' ❌') + ' | پرداخت ' + Utils_faDigits_(yDocs.length) +
    (yDocs.length ? ' ✅' : (req.combined_evidence ? ' 📎' : ' ❌')) + (vDocs.length ? ' | ویس ' + Utils_faDigits_(vDocs.length) : ''));
  var aiLines = docs.filter(function (d) { return d.ocr_status === 'DONE'; }).map(function (d) {
    return '🤖 ' + (d.document_kind === DOC_KIND.PURCHASE ? 'فاکتور' : 'رسید') + ': ' +
      (d.extracted_amount_rial !== '' ? Utils_formatRial_(Number(d.extracted_amount_rial)) : 'مبلغ نامشخص') +
      (d.extracted_date ? ' | تاریخ: ' + Utils_escapeHtml_(Utils_faDigits_(d.extracted_date)) : '') +
      (d.extracted_reference ? ' | مرجع: ' + Utils_escapeHtml_(d.extracted_reference) : '');
  });
  if (aiLines.length) { L.push('استخراج خودکار (فقط پیشنهادی، نیازمند تطبیق با تصویر):'); L = L.concat(aiLines); }
  Req_flagList_(req).forEach(function (f) {
    var base = f.split(':')[0];
    var ref = f.indexOf(':') > 0 ? ' (' + f.split(':')[1] + ')' : '';
    L.push('⚠️ ' + (FLAG_FA[base] || base) + ref);
  });
  if (req.rejection_reason) L.push('📝 دلیل آخرین تصمیم: ' + Utils_escapeHtml_(req.rejection_reason));
  if (req.admin_notes) L.push('🗒 یادداشت‌ها:\n' + Utils_escapeHtml_(String(req.admin_notes).split('\n').slice(-3).join('\n')));
  if (req.reviewed_at) L.push('بررسی: ' + Utils_escapeHtml_(Adm_actorName_(req.reviewed_by)) + ' — ' + Jal_formatDateTimeFa_(req.reviewed_at));
  var pay = Req_activePayment_(rid);
  if (pay && pay.status === 'PAID') L.push('💵 پرداخت شد: ' + Jal_formatDateTimeFa_(pay.paid_at) + (pay.transaction_reference_optional ? ' | پیگیری: ' + Utils_escapeHtml_(pay.transaction_reference_optional) : ''));
  if (req.drive_folder_id) L.push('📁 <a href="' + Doc_folderLink_(req.drive_folder_id) + '">پوشه خصوصی مدارک در Drive</a>');

  var rows = [];
  if (req.status === STATUS.READY_FOR_REVIEW) {
    if (live && Req_docsComplete_(req)) rows.push([Btn_('✅ تأیید ' + Utils_formatRial_(live.total_rial), 'ad|ap|' + rid + '|' + live.total_rial)]);
    else L.push('⛔️ مدارک الزامی کامل نیست؛ تأیید ممکن نیست.');
    rows.push([Btn_('❌ رد', 'ad|rj|' + rid), Btn_('✏️ درخواست اصلاح', 'ad|rc|' + rid)]);
    rows.push([Btn_('📎 مشاهده مدارک', 'ad|dc|' + rid), Btn_('💰 اصلاح مبلغ', 'ad|ea|' + rid)]);
  } else if (req.status === STATUS.APPROVED) {
    rows.push([Btn_('💵 ثبت پرداخت‌شده', 'ad|pd|' + rid)]);
    rows.push([Btn_('↩️ لغو تأیید', 'ad|rv|' + rid), Btn_('📎 مدارک', 'ad|dc|' + rid)]);
  } else {
    rows.push([Btn_('📎 مدارک', 'ad|dc|' + rid), Btn_('🔄 به‌روزرسانی', 'ad|op|' + rid)]);
  }
  return { text: L.join('\n'), kb: Kb_inline_(rows) };
}

function Adm_actorName_(tgId) {
  var e = Emp_byTelegramId_(tgId);
  return e ? e.full_name_fa : String(tgId || '');
}

function Adm_openCard_(ctx, rid, notice) {
  var req = Req_get_(rid);
  if (!req || DRAFT_STATUSES.indexOf(req.status) >= 0) return Ui_reply_(ctx, 'درخواستی با کد <code>' + Utils_escapeHtml_(rid) + '</code> برای بررسی پیدا نشد.');
  var card = Adm_card_(req);
  Ui_reply_(ctx, (notice ? notice + '\n\n' : '') + card.text, card.kb);
}

/** کاربران مرتبط با درخواست (ثبت‌کننده و در صورت تفاوت، پرداخت‌کننده). */
function Adm_notifyParties_(req, text, kb, includePayer) {
  var targets = [String(req.submitter_telegram_id)];
  if (includePayer) {
    var payer = Emp_byId_(req.payer_employee_id);
    if (payer && payer.telegram_user_id) targets.push(String(payer.telegram_user_id));
  }
  Utils_unique_(targets).forEach(function (chatId) { Tg_trySend_(chatId, text, kb); });
}

function Adm_onCallback_(ctx, act, rid, arg) {
  if (!Adm_require_(ctx, 'REVIEW')) return;
  var req = Req_get_(rid);
  if (!req) return Ui_toast_(ctx, 'درخواست پیدا نشد.', true);
  var s = ctx.sess;
  switch (act) {
    case 'op':
      return Adm_openCard_(ctx, rid);
    case 'ap':
      return Adm_doApprove_(ctx, rid, Number(arg));
    case 'rj':
    case 'rc':
      if (req.status !== STATUS.READY_FOR_REVIEW) return Adm_staleAction_(ctx, req);
      var pre = act === 'rj' ? 'rs' : 'rq';
      var rows = Object.keys(REASONS).map(function (k) { return [Btn_(REASONS[k], pre + '|' + k + '|' + rid)]; });
      rows.push([Btn_('✍️ نوشتن دلیل دیگر', pre + '|R0|' + rid)]);
      rows.push([Btn_('⬅️ بازگشت به کارت', 'ad|op|' + rid)]);
      return Ui_reply_(ctx, (act === 'rj' ? '❌ دلیل رد درخواست ' : '✏️ دلیل درخواست اصلاح ') + '<code>' + rid + '</code> را انتخاب کنید:', Kb_inline_(rows));
    case 'dc':
      return Adm_sendDocs_(ctx, req);
    case 'ea':
      if (req.status !== STATUS.READY_FOR_REVIEW) return Adm_staleAction_(ctx, req);
      s.data_json.pi = { k: 'AMOUNT', rid: rid };
      return Ui_send_(ctx, '💰 مبلغ «واجد شرایط» جدید برای <code>' + rid + '</code> را با واحد بنویسید (حداکثر ' +
        Utils_formatRial_(req.claimed_total_rial) + ').\nبرای انصراف: /cancel');
    case 'un':
      if (!s.data_json.pi || s.data_json.pi.k !== 'AMOUNT_UNIT' || s.data_json.pi.rid !== rid) return Ui_toast_(ctx, 'منقضی شده است.', true);
      s.data_json.pi = { k: 'AMOUNT_REASON', rid: rid, rial: Money_toRial_(s.data_json.pi.v, arg === 'T' ? 'TOMAN' : 'RIAL') };
      return Ui_reply_(ctx, 'مبلغ جدید: ' + Utils_formatRial_(s.data_json.pi.rial) + '\nدلیل اصلاح را بنویسید (در تاریخچه ثبت می‌شود):');
    case 'pd':
      if (req.status !== STATUS.APPROVED) return Adm_staleAction_(ctx, req);
      s.data_json.pi = { k: 'PAID_REF', rid: rid };
      return Ui_send_(ctx, '💵 شماره پیگیری/مرجع واریز به ' + Utils_escapeHtml_(Emp_name_(req.payer_employee_id)) + ' (' +
        Utils_formatRial_(req.approved_reimbursement_rial) + ') را بفرستید، یا:', Kb_inline_([[Btn_('📎 ثبت با عکس رسید بانکی', 'ad|pp|' + rid)], [Btn_('ثبت بدون شماره پیگیری', 'ad|pn|' + rid)]]));
    case 'pp':
      if (req.status !== STATUS.APPROVED) return Adm_staleAction_(ctx, req);
      s.data_json.pi = { k: 'PAID_PHOTO', rid: rid };
      return Ui_reply_(ctx, '📎 عکس یا PDF رسید بانکی واریز به ' + Utils_escapeHtml_(Emp_name_(req.payer_employee_id)) + ' (' +
        Utils_formatRial_(req.approved_reimbursement_rial) + ') را بفرستید.\nشماره پیگیری را (اختیاری) در کپشن همان عکس بنویسید. برای انصراف: /cancel');
    case 'pn':
      delete s.data_json.pi;
      return Adm_doPaid_(ctx, rid, '');
    case 'rv':
      if (req.status !== STATUS.APPROVED) return Adm_staleAction_(ctx, req);
      s.data_json.pi = { k: 'REVOKE', rid: rid };
      return Ui_send_(ctx, '↩️ دلیل لغو تأیید <code>' + rid + '</code> را بنویسید (مبلغ آزاد و درخواست به صف بررسی برمی‌گردد). برای انصراف: /cancel');
  }
  Ui_toast_(ctx, '');
}

function Adm_staleAction_(ctx, req) {
  Ui_toast_(ctx, 'وضعیت این درخواست تغییر کرده است: ' + (STATUS_FA[req.status] || req.status), true);
  Adm_openCard_(ctx, req.request_id);
}

function Adm_onReason_(ctx, kind, code, rid) {
  if (!Adm_require_(ctx, 'REVIEW')) return;
  var req = Req_get_(rid);
  if (!req) return Ui_toast_(ctx, 'درخواست پیدا نشد.', true);
  if (req.status !== STATUS.READY_FOR_REVIEW) return Adm_staleAction_(ctx, req);
  if (code === 'R0') {
    ctx.sess.data_json.pi = { k: kind === 'rs' ? 'REJECT' : 'CORRECT', rid: rid };
    return Ui_reply_(ctx, 'دلیل را بنویسید (برای کاربر ارسال می‌شود). برای انصراف: /cancel');
  }
  if (!REASONS[code]) return Ui_toast_(ctx, '');
  return kind === 'rs' ? Adm_doReject_(ctx, rid, REASONS[code]) : Adm_doCorrection_(ctx, rid, REASONS[code]);
}

function Adm_doApprove_(ctx, rid, expected) {
  var r = Req_approve_(rid, expected, ctx.auth);
  if (!r.ok) {
    if (r.code === 'AMOUNT_CHANGED') {
      Ui_toast_(ctx, 'مبلغ مجاز به‌دلیل تأییدهای دیگر همان روز تغییر کرد؛ کارت به‌روز شد.', true);
      return Adm_openCard_(ctx, rid, '⚠️ مبلغ مجاز به ' + Utils_formatRial_(r.amount) + ' تغییر کرد. در صورت موافقت دوباره تأیید کنید.');
    }
    if (r.code === 'ALREADY') {
      Ui_toast_(ctx, 'این درخواست قبلاً توسط ' + Adm_actorName_(r.req.reviewed_by) + ' تأیید شده است.', true);
      return Adm_openCard_(ctx, rid);
    }
    if (r.code === 'MISSING_DOCS') return Ui_toast_(ctx, 'مدارک الزامی کامل نیست؛ تأیید ممکن نیست.', true);
    return Adm_staleAction_(ctx, r.req || Req_get_(rid));
  }
  ctx.requestId = rid;
  Ui_toast_(ctx, '✅ تأیید شد');
  Adm_openCard_(ctx, rid, '✅ تأیید شد. یک پرداخت به نام ' + Utils_escapeHtml_(Emp_name_(r.req.payer_employee_id)) + ' ثبت شد.');
  Adm_notifyParties_(r.req, '✅ درخواست <code>' + rid + '</code> تأیید شد.\nمبلغ قابل پرداخت به ' + Utils_escapeHtml_(Emp_name_(r.req.payer_employee_id)) +
    ': <b>' + Utils_formatRial_(r.amount) + '</b>\nپس از واریز به شما اطلاع داده می‌شود.', null, true);
}

function Adm_doReject_(ctx, rid, reason) {
  var r = Req_reject_(rid, reason, ctx.auth);
  if (!r.ok) return Adm_staleAction_(ctx, r.req || Req_get_(rid));
  ctx.requestId = rid;
  Adm_openCard_(ctx, rid, '❌ درخواست رد شد.');
  Adm_notifyParties_(r.req, '❌ درخواست <code>' + rid + '</code> رد شد.\nدلیل: ' + Utils_escapeHtml_(reason), null, false);
}

function Adm_doCorrection_(ctx, rid, reason) {
  var r = Req_requestCorrection_(rid, reason, ctx.auth);
  if (!r.ok) return Adm_staleAction_(ctx, r.req || Req_get_(rid));
  ctx.requestId = rid;
  Adm_openCard_(ctx, rid, '✏️ برای کاربر درخواست اصلاح ارسال شد.');
  Tg_trySend_(r.req.submitter_telegram_id, '✏️ درخواست <code>' + rid + '</code> نیاز به اصلاح دارد.\nدلیل: ' + Utils_escapeHtml_(reason) +
    '\nلطفاً موارد را اصلاح و دوباره ارسال کنید.', Kb_inline_([[Btn_('✏️ اصلاح درخواست', 'my|f|' + rid)]]));
}

function Adm_doPaid_(ctx, rid, ref, receipt) {
  var r = Req_markPaid_(rid, ref, ctx.auth);
  if (!r.ok) {
    if (r.code === 'ALREADY') { Ui_toast_(ctx, 'قبلاً پرداخت‌شده ثبت شده است.', true); return Adm_openCard_(ctx, rid); }
    return Adm_staleAction_(ctx, r.req || Req_get_(rid));
  }
  ctx.requestId = rid;
  Adm_openCard_(ctx, rid, '💵 پرداخت ثبت شد.');
  Adm_notifyParties_(r.req, '💵 مبلغ <b>' + Utils_formatRial_(r.payment.amount_rial) + '</b> بابت درخواست <code>' + rid + '</code> به ' +
    Utils_escapeHtml_(Emp_name_(r.req.payer_employee_id)) + ' پرداخت شد.' + (ref ? '\nشماره پیگیری: ' + Utils_escapeHtml_(ref) : ''), null, true);
  if (receipt) Adm_sendReceiptToParties_(r.req, receipt, r.payment.amount_rial, ref);
}

/** عکس رسید واریز برای پرداخت‌کننده (و ثبت‌کننده اگر فرق دارد) فرستاده می‌شود. */
function Adm_sendReceiptToParties_(req, receipt, amount, ref) {
  var caption = '🧾 رسید بانکی واریز <b>' + Utils_formatRial_(amount) + '</b> بابت درخواست <code>' + req.request_id + '</code>' +
    (ref ? '\nشماره پیگیری: ' + Utils_escapeHtml_(ref) : '');
  var targets = [String(req.submitter_telegram_id)];
  var payer = Emp_byId_(req.payer_employee_id);
  if (payer && payer.telegram_user_id) targets.push(String(payer.telegram_user_id));
  Utils_unique_(targets).forEach(function (chatId) {
    try { Tg_sendExisting_(chatId, receipt.media === 'photo' ? 'photo' : 'document', receipt.file_id, caption); }
    catch (e) { console.warn('receipt send failed to ' + chatId + ': ' + Utils_redact_(e.message)); }
  });
}

/** ادمین در حالت ثبت پرداخت، عکس/PDF رسید واریز فرستاده است. */
function Adm_onPaidReceipt_(ctx, info) {
  var pi = ctx.sess.data_json.pi;
  if (!Auth_can_(ctx.auth, 'REVIEW')) { delete ctx.sess.data_json.pi; return Ui_send_(ctx, '⛔️ دسترسی ندارید.'); }
  if (info.unsupported || info.media === 'voice') return Ui_send_(ctx, '⚠️ لطفاً عکس یا PDF رسید را بفرستید (یا /cancel).');
  var req = Req_get_(pi.rid);
  if (!req || req.status !== STATUS.APPROVED) { delete ctx.sess.data_json.pi; return Adm_staleAction_(ctx, req || { request_id: pi.rid, status: '' }); }
  var saved = Doc_save_(ctx, req, DOC_KIND.PAYOUT_RECEIPT, info, ctx.prefetched);
  if (!saved.ok && saved.error !== 'ALREADY_IN_REQUEST') return Ui_send_(ctx, '⚠️ ' + Doc_errorFa_(saved.error));
  delete ctx.sess.data_json.pi;
  var ref = Utils_normalizeDigits_(Utils_truncate_(String((ctx.msg && ctx.msg.caption) || '').trim(), 100));
  Adm_doPaid_(ctx, pi.rid, ref, info);
}

/** ورودی متنی ادمین وقتی منتظر دلیل/مبلغ/شماره پیگیری است. */
function Adm_onPendingText_(ctx, text) {
  var pi = ctx.sess.data_json.pi;
  delete ctx.sess.data_json.pi;
  if (!Auth_can_(ctx.auth, 'REVIEW')) return Ui_send_(ctx, '⛔️ دسترسی ندارید.');
  var t = Utils_truncate_(String(text).trim(), 400);
  if (!t) return Ui_send_(ctx, 'متن خالی است؛ عملیات لغو شد.');
  switch (pi.k) {
    case 'REJECT': return Adm_doReject_(ctx, pi.rid, t);
    case 'CORRECT': return Adm_doCorrection_(ctx, pi.rid, t);
    case 'REVOKE':
      var rv = Req_revoke_(pi.rid, t, ctx.auth);
      if (!rv.ok) return Ui_send_(ctx, 'لغو تأیید ممکن نیست (وضعیت: ' + (STATUS_FA[(rv.req || {}).status] || rv.code) + ').');
      ctx.requestId = pi.rid;
      Adm_openCard_(ctx, pi.rid, '↩️ تأیید لغو شد و درخواست به صف بررسی برگشت.');
      Adm_notifyParties_(rv.req, '↩️ تأیید درخواست <code>' + pi.rid + '</code> برای بررسی مجدد لغو شد.\nدلیل: ' + Utils_escapeHtml_(t), null, true);
      return;
    case 'PAID_REF': return Adm_doPaid_(ctx, pi.rid, Utils_normalizeDigits_(t));
    case 'AMOUNT':
      var p = Money_parseAmount_(t);
      if (!p.ok) { ctx.sess.data_json.pi = pi; return Ui_send_(ctx, '⚠️ ' + Money_errorFa_(p.error)); }
      if (!p.unit) {
        ctx.sess.data_json.pi = { k: 'AMOUNT_UNIT', rid: pi.rid, v: p.value };
        return Ui_send_(ctx, 'مبلغ «' + Utils_formatNumberFa_(p.value) + '» به چه واحدی است؟', Kb_inline_([[
          Btn_('ریال ← ' + Utils_formatRial_(p.value), 'ad|un|' + pi.rid + '|R'),
          Btn_('تومان ← ' + Utils_formatRial_(p.value * 10), 'ad|un|' + pi.rid + '|T')
        ]]));
      }
      ctx.sess.data_json.pi = { k: 'AMOUNT_REASON', rid: pi.rid, rial: Money_toRial_(p.value, p.unit) };
      return Ui_send_(ctx, 'مبلغ جدید: ' + Utils_formatRial_(ctx.sess.data_json.pi.rial) + '\nدلیل اصلاح را بنویسید (در تاریخچه ثبت می‌شود):');
    case 'AMOUNT_UNIT':
      ctx.sess.data_json.pi = pi;
      return Ui_send_(ctx, 'لطفاً واحد را با دکمه‌ها انتخاب کنید یا /cancel بزنید.');
    case 'AMOUNT_REASON':
      var a = Req_adjustEligible_(pi.rid, pi.rial, t, ctx.auth);
      if (!a.ok) return Ui_send_(ctx, a.code === 'OUT_OF_RANGE' ? '⚠️ مبلغ واجد شرایط نمی‌تواند بیشتر از مبلغ فاکتور باشد.' : 'اصلاح مبلغ ممکن نیست (وضعیت تغییر کرده).');
      ctx.requestId = pi.rid;
      return Adm_openCard_(ctx, pi.rid, '💰 مبلغ واجد شرایط اصلاح شد.');
  }
}

function Adm_sendDocs_(ctx, req) {
  var docs = Doc_forRequest_(req.request_id);
  if (!docs.length) return Ui_toast_(ctx, 'مدرکی ثبت نشده است.', true);
  Ui_toast_(ctx, 'در حال ارسال ' + Utils_faDigits_(docs.length) + ' مدرک…');
  docs.slice(0, 15).forEach(function (d, i) {
    var media = d.document_kind === DOC_KIND.VOICE_NOTE ? 'voice' : (d.mime_type === 'image/jpeg' && /^photo/.test(d.original_filename) ? 'photo' : 'document');
    var flags = String(d.verification_flags || '').split(',').filter(Boolean).map(function (f) { return FLAG_FA[f.split(':')[0]] || f; });
    var caption = '📎 ' + Utils_faDigits_(i + 1) + ' — ' + DOC_KIND_FA[d.document_kind] + ' | <code>' + req.request_id + '</code>' +
      (d.caption ? '\n' + Utils_escapeHtml_(d.caption) : '') + (flags.length ? '\n⚠️ ' + flags.join('، ') : '') +
      '\nاصالت: تأیید نشده (authenticity_not_verified)';
    try {
      Tg_sendExisting_(ctx.chatId, media, d.telegram_file_id, caption);
    } catch (e) {
      Tg_trySend_(ctx.chatId, caption + (d.drive_file_id ? '\n<a href="' + Doc_driveLink_(d.drive_file_id) + '">نسخه Drive</a>' : '\n(فایل در دسترس نیست)'));
    }
  });
}

// ---------------------------------------------------------------------------
// فهرست‌ها
// ---------------------------------------------------------------------------

function Adm_pending_(ctx) {
  if (!Adm_require_(ctx, 'REVIEW')) return;
  var list = Db_find_(SHEETS.REQUESTS, function (r) { return r.status === STATUS.READY_FOR_REVIEW; })
    .sort(function (a, b) { return String(a.submitted_at).localeCompare(String(b.submitted_at)); });
  if (!list.length) return Ui_send_(ctx, '✅ درخواستی در انتظار بررسی نیست.');
  var rows = list.slice(0, 20).map(function (r) {
    return [Btn_(r.request_id + ' • ' + Emp_name_(r.payer_employee_id) + ' • ' + Utils_formatNumberFa_(r.calculated_reimbursement_rial), 'ad|op|' + r.request_id)];
  });
  Ui_send_(ctx, '🗂 <b>درخواست‌های در انتظار بررسی</b>: ' + Utils_faDigits_(list.length) + ' مورد' +
    (list.length > 20 ? ' (۲۰ مورد قدیمی‌تر نمایش داده شد)' : '') + '\nمبالغ: بازپرداخت تخمینی به ریال', Kb_inline_(rows));
}

function Adm_unpaid_(ctx) {
  if (!Adm_require_(ctx, 'REVIEW')) return;
  var list = Db_find_(SHEETS.REQUESTS, function (r) { return r.status === STATUS.APPROVED; });
  if (!list.length) return Ui_send_(ctx, '✅ پرداخت معوقی وجود ندارد.');
  var byPayer = {};
  list.forEach(function (r) {
    var k = r.payer_employee_id;
    byPayer[k] = byPayer[k] || { total: 0, n: 0 };
    byPayer[k].total += r.approved_reimbursement_rial;
    byPayer[k].n++;
  });
  var lines = Object.keys(byPayer).map(function (k) {
    return '• ' + Utils_escapeHtml_(Emp_name_(k)) + ': ' + Utils_formatRial_(byPayer[k].total) + ' (' + Utils_faDigits_(byPayer[k].n) + ' درخواست)';
  });
  var total = list.reduce(function (a, r) { return a + r.approved_reimbursement_rial; }, 0);
  var rows = list.slice(0, 20).map(function (r) {
    return [Btn_(r.request_id + ' • ' + Emp_name_(r.payer_employee_id) + ' • ' + Utils_formatNumberFa_(r.approved_reimbursement_rial), 'ad|op|' + r.request_id)];
  });
  Ui_send_(ctx, '💵 <b>تأییدشده‌های پرداخت‌نشده</b>\n' + lines.join('\n') + '\n\nجمع قابل واریز: <b>' + Utils_formatRial_(total) + '</b>', Kb_inline_(rows));
}

// ---------------------------------------------------------------------------
// کارکنان
// ---------------------------------------------------------------------------

function Adm_employees_(ctx, page) {
  if (!Adm_require_(ctx, 'MANAGE_EMPLOYEES')) return;
  var emps = Emp_all_().sort(function (a, b) { return String(a.full_name_fa).localeCompare(String(b.full_name_fa), 'fa'); });
  var joins = Db_find_(SHEETS.JOIN_REQUESTS, function (j) { return j.status === 'PENDING'; });
  var per = 10, pages = Math.max(1, Math.ceil(emps.length / per));
  page = Math.min(Math.max(0, page || 0), pages - 1);
  var rows = emps.slice(page * per, page * per + per).map(function (e) {
    return [Btn_((e.active ? '🟢 ' : '🔴 ') + e.full_name_fa + ' — ' + (ROLE_FA[e.role] || e.role) + (e.telegram_user_id ? '' : ' (بدون تلگرام)'), 'em|v|' + e.employee_id)];
  });
  if (pages > 1) rows.push([page > 0 ? Btn_('◀️ قبلی', 'em|l|' + (page - 1)) : null, page < pages - 1 ? Btn_('بعدی ▶️', 'em|l|' + (page + 1)) : null]);
  joins.slice(0, 10).forEach(function (j) { rows.push([Btn_('🙋 درخواست عضویت: ' + j.requested_full_name, 'jr|v|' + j.join_id)]); });
  var text = '👥 <b>کارکنان</b>: ' + Utils_faDigits_(emps.length) + ' نفر (' + Utils_faDigits_(emps.filter(function (e) { return e.active; }).length) + ' فعال)' +
    (joins.length ? '\n🙋 درخواست عضویت در انتظار: ' + Utils_faDigits_(joins.length) : '') +
    '\n💡 نام مستعار (aliases)، واحد و شناسه پرداخت را مستقیماً در شیت Employees ویرایش کنید.';
  Ui_reply_(ctx, text, Kb_inline_(rows));
}

function Adm_employeeCard_(ctx, emp, notice) {
  var canRoles = Auth_can_(ctx.auth, 'MANAGE_ROLES');
  var text = (notice ? notice + '\n\n' : '') + '👤 <b>' + Utils_escapeHtml_(emp.full_name_fa) + '</b>\n' +
    'شناسه: <code>' + emp.employee_id + '</code>\nنقش: ' + (ROLE_FA[emp.role] || emp.role) + '\nوضعیت: ' + (emp.active ? 'فعال' : 'غیرفعال') +
    '\nتلگرام: ' + (emp.telegram_user_id ? '<code>' + Utils_escapeHtml_(emp.telegram_user_id) + '</code>' : '—') +
    (emp.aliases ? '\nنام‌های مستعار: ' + Utils_escapeHtml_(emp.aliases) : '') + (emp.department ? '\nواحد: ' + Utils_escapeHtml_(emp.department) : '');
  var rows = [[emp.active ? Btn_('🔴 غیرفعال‌سازی', 'em|off|' + emp.employee_id) : Btn_('🟢 فعال‌سازی', 'em|on|' + emp.employee_id)]];
  if (canRoles) {
    rows.push([Btn_('نقش: کارمند', 'em|r|' + emp.employee_id + '|e'), Btn_('نقش: ادمین مالی', 'em|r|' + emp.employee_id + '|f')]);
    rows.push([Btn_('نقش: ناظر گزارش', 'em|r|' + emp.employee_id + '|v')]);
  }
  rows.push([Btn_('⬅️ فهرست کارکنان', 'em|l|0')]);
  Ui_reply_(ctx, text, Kb_inline_(rows));
}

function Adm_onEmployeeCallback_(ctx, act, id, arg) {
  if (!Adm_require_(ctx, 'MANAGE_EMPLOYEES')) return;
  if (act === 'l') return Adm_employees_(ctx, Number(id) || 0);
  var emp = Emp_byId_(id);
  if (!emp) return Ui_toast_(ctx, 'کارمند پیدا نشد.', true);
  if (act === 'v') return Adm_employeeCard_(ctx, emp);
  var privileged = emp.role !== ROLES.EMPLOYEE;
  if ((act === 'on' || act === 'off') && privileged && !Auth_can_(ctx.auth, 'MANAGE_ROLES')) return Ui_toast_(ctx, 'تغییر وضعیت ادمین‌ها فقط با مالک ربات است.', true);
  if (act === 'off' && String(emp.telegram_user_id) === ctx.tgId) return Ui_toast_(ctx, 'نمی‌توانید حساب خودتان را غیرفعال کنید.', true);
  if (act === 'on' || act === 'off') {
    Emp_update_(emp, { active: act === 'on' }, ctx.tgId, act === 'on' ? 'EMPLOYEE_ACTIVATED' : 'EMPLOYEE_DEACTIVATED');
    return Adm_employeeCard_(ctx, emp, '✅ ذخیره شد.');
  }
  if (act === 'r') {
    if (!Auth_can_(ctx.auth, 'MANAGE_ROLES')) return Ui_toast_(ctx, 'فقط مالک ربات نقش‌ها را تغییر می‌دهد.', true);
    var role = { e: ROLES.EMPLOYEE, f: ROLES.FINANCE_ADMIN, v: ROLES.REPORT_VIEWER }[arg];
    if (!role) return Ui_toast_(ctx, '');
    Emp_update_(emp, { role: role }, ctx.tgId, 'ROLE_CHANGED');
    if (emp.telegram_user_id) Setup_setCommandsFor_(emp.telegram_user_id, role);
    return Adm_employeeCard_(ctx, emp, '✅ نقش به «' + ROLE_FA[role] + '» تغییر کرد.');
  }
  Ui_toast_(ctx, '');
}

// ---------------------------------------------------------------------------
// تنظیمات
// ---------------------------------------------------------------------------

function Adm_settings_(ctx) {
  if (!Adm_require_(ctx, 'SETTINGS_VIEW')) return;
  var all = Settings_all_();
  var lines = DEFAULT_SETTINGS.map(function (d) { return '• <code>' + d[0] + '</code> = ' + Utils_escapeHtml_(all[d[0]] || '—'); });
  var today = Utils_todayIso_();
  var aiState = Ai_anyEnabled_() ? 'روشن' : 'خاموش' + (Settings_bool_('AI_ENABLED') ? ' (پیش‌نیازها کامل نیست: ' + Ai_disabledReason_() + ')' : '');
  Ui_send_(ctx, '⚙️ <b>تنظیمات</b>\nسقف امروز: ' + Utils_formatRial_(Settings_capForDate_(today)) + '\nهوش مصنوعی: ' + aiState +
    '\nحالت دریافت پیام: ' + (Utils_getProp_(PROP.UPDATE_MODE) || 'WEBHOOK') + '\n\n' + lines.join('\n') +
    '\n\nتغییر (فقط مالک): <code>/set KEY VALUE</code>\nمثال: <code>/set DAILY_CAP_RIAL 4000000</code>\nسقف تاریخ‌دار: شیت CapSchedule');
}

function Adm_set_(ctx, args) {
  if (!Adm_require_(ctx, 'SETTINGS_EDIT')) return;
  var m = String(args || '').trim().match(/^([A-Z_]+)\s+([\s\S]+)$/);
  if (!m) return Ui_send_(ctx, 'قالب درست: <code>/set KEY VALUE</code>');
  var r = Settings_set_(m[1], m[2], ctx.tgId);
  if (!r.ok) {
    var err = { KEY_NOT_EDITABLE: 'این کلید قابل تغییر نیست.', EXPECT_BOOL: 'مقدار باید TRUE یا FALSE باشد.', EXPECT_INT: 'مقدار باید عدد صحیح باشد.' }[r.error];
    return Ui_send_(ctx, '⚠️ ' + err);
  }
  if (m[1] === 'REPORT_DAILY_HOUR' || m[1] === 'REPORT_DAILY_ENABLED') Triggers_install_();
  Ui_send_(ctx, '✅ <code>' + m[1] + '</code>: ' + Utils_escapeHtml_(r.previous) + ' ← ' + Utils_escapeHtml_(r.value));
}
