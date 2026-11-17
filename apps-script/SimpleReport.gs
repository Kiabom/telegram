/**
 * SimpleReport.gs — «گزارش‌گیری ساده»: فایل Word (.docx) برای هر سفارش یک صفحه:
 *   عنوان (تاریخ و تعداد نفرات)، دو عکس بزرگ کنار هم (رسید غذا و رسید پرداخت، بدون هم‌پوشانی)،
 *   و زیر عکس‌ها نام افراد با سهم هر نفر و مبلغ واریز به پرداخت‌کننده.
 * فایل با Google Docs ساخته و با Export رسمی به docx تبدیل می‌شود؛ گزارش‌های Excel/PDF قبلی تغییری نکرده‌اند.
 * فقط ادمین مالی و مالک (تصاویر رسیدها محرمانه‌اند).
 */

var SIMPLE_IMG_ = { CELL_W: 250, MAX_H: 470, SINGLE_W: 470, UPSCALE: 2 };
var SIMPLE_STATUSES_ = ['READY_FOR_REVIEW', 'APPROVED', 'PAID'];

function Simple_menu_(ctx) {
  if (!Adm_require_(ctx, 'AUDIT_REPORT')) return;
  Ui_send_(ctx, '🧾 <b>گزارش‌گیری ساده (فایل Word)</b>\nبرای هر سفارش: عکس رسید غذا و رسید پرداخت، افراد و سهم هر نفر.\nگزارش کدام روز را می‌خواهید؟',
    Kb_inline_([
      [Btn_('امروز', 'sw|t'), Btn_('دیروز', 'sw|y')],
      [Btn_('📆 یک روز دلخواه', 'sw|d'), Btn_('🗓 از تاریخ تا تاریخ', 'sw|r')]
    ]));
}

function Simple_onMenuCallback_(ctx, act) {
  if (!Adm_require_(ctx, 'AUDIT_REPORT')) return;
  var today = Utils_todayIso_();
  var ex = Utils_faDigits_(Jal_isoToJalali_(Utils_isoAddDays_(today, -3)));
  if (act === 't') { Ui_reply_(ctx, '🧾 گزارش ساده امروز'); return Simple_run_(ctx, today, today); }
  if (act === 'y') { var y = Utils_isoAddDays_(today, -1); Ui_reply_(ctx, '🧾 گزارش ساده دیروز'); return Simple_run_(ctx, y, y); }
  if (act === 'd') {
    ctx.sess.data_json.pi = { k: 'SIMPLE_DAY' };
    return Ui_reply_(ctx, '📆 تاریخ را به شمسی بنویسید؛ مثلاً ' + ex + '\nبرای انصراف: /cancel');
  }
  if (act === 'r') {
    ctx.sess.data_json.pi = { k: 'SIMPLE_RANGE' };
    return Ui_reply_(ctx, '🗓 هر دو تاریخ را بنویسید؛ مثلاً «' + ex + ' تا ' + Utils_faDigits_(Jal_isoToJalali_(today)) + '»\nبرای انصراف: /cancel');
  }
  Ui_toast_(ctx, '');
}

function Simple_onDateText_(ctx, text) {
  var pi = ctx.sess.data_json.pi;
  var today = Utils_todayIso_();
  var dates = Utils_normalizeDigits_(text).split(/\s*(?:تا|الی|to|–|—)\s*|\s+/).filter(Boolean)
    .map(function (p) { return Jal_parseUserDate_(p, today); });
  var need = pi.k === 'SIMPLE_DAY' ? 1 : 2;
  if (dates.length < need || dates.some(function (d) { return !d; })) {
    return Ui_send_(ctx, '⚠️ تاریخ قابل تشخیص نیست. نمونه: ' + Utils_faDigits_(Jal_isoToJalali_(today)) +
      (need === 2 ? ' تا ' + Utils_faDigits_(Jal_isoToJalali_(today)) : '') + ' (انصراف: /cancel)');
  }
  if (dates.some(function (d) { return d > today; })) return Ui_send_(ctx, '⚠️ تاریخ نمی‌تواند در آینده باشد.');
  delete ctx.sess.data_json.pi;
  var from = dates[0], to = need === 2 ? dates[1] : dates[0];
  if (from > to) { var x = from; from = to; to = x; }
  Simple_run_(ctx, from, to);
}

function Simple_run_(ctx, from, to) {
  if (Utils_isoDiffDays_(from, to) > 31) return Ui_send_(ctx, '⚠️ حداکثر بازه گزارش ساده ۳۱ روز است.');
  Ui_send_(ctx, '⏳ در حال تهیه فایل Word…');
  var chatId = ctx.chatId, actor = ctx.tgId;
  ctx.defer(function () {
    try {
      var m = Simple_build_(from, to);
      if (!m.orders.length) return Tg_trySend_(chatId, 'برای ' + m.title + ' سفارش ثبت‌شده‌ای وجود ندارد.');
      var file = Simple_generateDocx_(m);
      Tg_sendDocument_(chatId, file.blob, '🧾 ' + m.title + ' — ' + Utils_faDigits_(m.orders.length) + ' سفارش، جمع ' + Utils_formatRial_(m.total));
      Audit_log_('', actor, 'SIMPLE_REPORT', '', '', { from: from, to: to, orders: m.orders.length, drive_file_id: file.id });
    } catch (e) {
      Audit_error_('SIMPLE_REPORT', e, actor);
      Tg_trySend_(chatId, '⚠️ تهیه فایل Word ناموفق بود. خطا ثبت شد؛ لطفاً دوباره امتحان کنید.');
    }
  });
}

/** مدل: سفارش‌های ثبت‌شده بازه (در انتظار بررسی، تأییدشده، پرداخت‌شده). */
function Simple_build_(from, to) {
  var reqs = Db_find_(SHEETS.REQUESTS, function (r) {
    return r.order_date_iso >= from && r.order_date_iso <= to && SIMPLE_STATUSES_.indexOf(r.status) >= 0;
  }).sort(function (a, b) { return (a.order_date_iso + a.submitted_at).localeCompare(b.order_date_iso + b.submitted_at); });
  var total = 0;
  var orders = reqs.map(function (r) {
    var approved = r.status === STATUS.APPROVED || r.status === STATUS.PAID;
    var people = Req_bens_(r.request_id).map(function (b) {
      return { name: b.employee_name_snapshot, share: approved ? b.approved_allocation_rial : b.actual_cost_rial, cost: b.actual_cost_rial };
    });
    var amount = approved ? r.approved_reimbursement_rial : r.calculated_reimbursement_rial;
    total += amount;
    var docs = Doc_forRequest_(r.request_id);
    return {
      request_id: r.request_id, date: r.order_date_iso, status: r.status, payer: Emp_name_(r.payer_employee_id),
      people: people, claimed: r.claimed_total_rial, amount: amount, approved: approved,
      images: docs.filter(function (d) { return d.document_kind === DOC_KIND.PURCHASE; })
        .concat(docs.filter(function (d) { return PAYMENT_DOC_KINDS.indexOf(d.document_kind) >= 0; }))
    };
  });
  var title = from === to ? 'گزارش ناهار ' + Jal_formatLong_(from) : 'گزارش ناهار ' + Jal_formatLong_(from, false) + ' تا ' + Jal_formatLong_(to, false);
  return { from: from, to: to, title: title, orders: orders, total: total };
}

function Simple_generateDocx_(m) {
  var font = Settings_str_('REPORT_FONT') || 'Vazirmatn';
  var folder = Exp_reportsFolder_();
  var stamp = Utilities.formatDate(CLOCK.now(), APP.TZ, 'yyyyMMdd-HHmmss');
  var name = 'گزارش-ساده-ناهار_' + Jal_isoToJalali_(m.from).replace(/\//g, '-') + (m.to !== m.from ? '_تا_' + Jal_isoToJalali_(m.to).replace(/\//g, '-') : '') + '_' + stamp;
  var doc = DocumentApp.create(name);
  var tmp = DriveApp.getFileById(doc.getId());
  tmp.moveTo(folder);
  try {
    var body = doc.getBody();
    body.setPageWidth(595.28).setPageHeight(841.89).setMarginTop(36).setMarginBottom(36).setMarginLeft(36).setMarginRight(36);
    var first = true;
    var CENTER = DocumentApp.HorizontalAlignment.CENTER, RIGHT = DocumentApp.HorizontalAlignment.RIGHT;
    function para(text, size, bold, align) {
      var p;
      if (first) { p = body.getParagraphs()[0]; p.setText(text); first = false; } else p = body.appendParagraph(text);
      p.setLeftToRight(false).setAlignment(align || RIGHT).setSpacingBefore(0).setSpacingAfter(4);
      if (text) p.editAsText().setFontFamily(font).setFontSize(size || 13).setBold(!!bold);
      return p;
    }
    var F = Utils_formatNumberFa_;
    m.orders.forEach(function (o, idx) {
      if (idx > 0) body.appendPageBreak();
      para('ناهار ' + Jal_formatLong_(o.date) + ' — غذای ' + F(o.people.length) + ' نفر', 16, true, CENTER);
      Simple_appendImages_(body, o.images);
      para('افراد و سهم هر نفر:', 13, true);
      o.people.forEach(function (p, i) {
        para(F(i + 1) + '. ' + p.name + ' — سهم ' + F(p.share) + ' ریال' + (p.share !== p.cost ? ' (هزینه واقعی ' + F(p.cost) + ')' : ''), 13);
      });
      para('مبلغ فاکتور: ' + F(o.claimed) + ' ریال', 12);
      para((o.status === STATUS.PAID ? 'واریز ' : o.approved ? 'قابل واریز ' : 'در انتظار تأیید — مبلغ تخمینی ') +
        F(o.amount) + ' ریال به ' + o.payer, 15, true);
    });
    body.appendPageBreak();
    para(m.title + ' — جمع کل', 16, true, CENTER);
    m.orders.forEach(function (o, i) {
      para(F(i + 1) + '. ' + Jal_formatShortFa_(o.date) + ' — ' + o.payer + ' — ' + F(o.people.length) + ' نفر — ' + F(o.amount) + ' ریال', 12);
    });
    para('جمع کل: ' + F(m.total) + ' ریال', 15, true);
    doc.saveAndClose();
    var blob = Exp_export_(doc.getId(), 'format=docx', 'document').setName(name + '.docx');
    var saved = folder.createFile(blob);
    return { blob: blob, id: saved.getId() };
  } finally {
    try { tmp.setTrashed(true); } catch (e) { console.warn('temp simple doc trash failed'); }
  }
}

/** عکس‌ها دوتا‌دوتا کنار هم در جدول بدون خط (بدون هم‌پوشانی)، بزرگ و کامل. */
function Simple_appendImages_(body, docs) {
  var blobs = docs.map(function (d) {
    if (String(d.mime_type || '').indexOf('image/') !== 0) return null;
    return Exp_evidenceBlob_({ drive_file_id: d.drive_file_id, telegram_file_id: d.telegram_file_id, file_size: d.file_size, mime_type: d.mime_type });
  }).filter(Boolean);
  if (!blobs.length) {
    body.appendParagraph('(تصویر رسیدی برای این سفارش در دسترس نیست)').setLeftToRight(false).setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    return;
  }
  var single = blobs.length === 1;
  var cellW = single ? SIMPLE_IMG_.SINGLE_W : SIMPLE_IMG_.CELL_W;
  for (var i = 0; i < blobs.length; i += 2) {
    var pair = blobs.slice(i, i + 2);
    var t = body.appendTable([pair.map(function () { return ''; })]);
    t.setBorderWidth(0);
    // ستون اول جدول در سمت چپ است؛ ترتیب معکوس تا رسید غذا سمت راست بیاید.
    pair.slice().reverse().forEach(function (blob, j) {
      var cell = t.getRow(0).getCell(j);
      cell.setPaddingTop(2).setPaddingBottom(2).setPaddingLeft(2).setPaddingRight(2);
      var p = cell.getChild(0).asParagraph();
      p.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
      try {
        var img = p.appendInlineImage(blob);
        var w = img.getWidth(), h = img.getHeight();
        if (w > 0 && h > 0) {
          var r = Math.min(cellW / w, SIMPLE_IMG_.MAX_H / h, SIMPLE_IMG_.UPSCALE);
          img.setWidth(Math.round(w * r)).setHeight(Math.round(h * r));
        }
      } catch (e) {
        p.appendText('(تصویر قابل درج نبود)');
      }
    });
  }
}
