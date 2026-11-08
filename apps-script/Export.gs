/**
 * Export.gs — ساخت فایل واقعی Excel (.xlsx) و PDF فارسی راست‌به‌چپ از روی مدل گزارش.
 *
 * روش (کاملاً رایگان): یک Google Sheet موقت در پوشه خصوصی Reports ساخته می‌شود، سپس با Export
 * رسمی Google به XLSX و PDF تبدیل و در Drive بایگانی می‌شود؛ فایل موقت به سطل زباله می‌رود.
 * در Excel ستون‌های مبلغ «عدد واقعی» (ریال) و تاریخ‌ها «تاریخ واقعی» و قابل فیلترند.
 * در PDF اعداد با ارقام فارسی و جداکننده هزارگان نمایش داده می‌شوند.
 */

var EXP_HEADER_BG_ = '#E8EEF7';

function Exp_reportsFolder_() {
  return DriveApp.getFolderById(Utils_getProp_(PROP.REPORTS_FOLDER_ID));
}

function Exp_generateFiles_(m) {
  var stamp = Utilities.formatDate(CLOCK.now(), APP.TZ, 'yyyyMMdd-HHmmss');
  var base = 'LunchReport_' + m.type + '_' + m.from + (m.to !== m.from ? '_' + m.to : '') + '_' + stamp;
  var folder = Exp_reportsFolder_();
  var ss = SpreadsheetApp.create(base);
  var tmp = DriveApp.getFileById(ss.getId());
  tmp.moveTo(folder);
  try {
    ss.setSpreadsheetTimeZone(APP.TZ);
    Exp_buildWorkbook_(ss, m);
    SpreadsheetApp.flush();
    var xlsx = Exp_export_(ss.getId(), 'format=xlsx').setName(base + '.xlsx');
    var built = Exp_buildPdfDoc_(m, folder, base);
    var pdf;
    try {
      pdf = Exp_export_(built.doc.getId(), 'format=pdf', 'document').setName(base + '.pdf');
    } finally {
      try { built.file.setTrashed(true); } catch (e2) { console.warn('temp pdf doc trash failed'); }
    }
    var xlsxFile = folder.createFile(xlsx);
    var pdfFile = folder.createFile(pdf);
    var snap = folder.createFile(Utilities.newBlob(JSON.stringify(m), 'application/json', base + '.json'));
    return { xlsxBlob: xlsx, pdfBlob: pdf, xlsxId: xlsxFile.getId(), pdfId: pdfFile.getId(), snapshotId: snap.getId() };
  } finally {
    try { tmp.setTrashed(true); } catch (e) { console.warn('temp report trash failed'); }
  }
}

function Exp_export_(id, params, kind) {
  var url = 'https://docs.google.com/' + (kind || 'spreadsheets') + '/d/' + id + '/export?' + params;
  var last = 0;
  for (var i = 0; i < 3; i++) {
    var resp = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    last = resp.getResponseCode();
    if (last === 200) return resp.getBlob();
    if (last !== 429 && last < 500) break;
    Utilities.sleep(2000 * (i + 1));
  }
  var err = new Error('EXPORT_FAILED_' + last);
  err.code = 'EXPORT_FAILED';
  throw err;
}

/** تاریخ ISO → Date ساعت ۱۲ ظهر تهران (تا در هر منطقه زمانی همان روز نمایش داده شود). */
function Exp_dateCell_(iso) {
  if (!Utils_isValidIso_(iso)) return '';
  var p = iso.split('-');
  return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 8, 30));
}

/**
 * نوشتن جدول با یک فراخوانی setValues. types: money | int | date | text
 * خروجی: شماره ردیف بعد از جدول.
 */
function Exp_writeTable_(sheet, row, headers, types, rows, totalsRow) {
  var values = [headers].concat(rows.map(function (r) {
    return r.map(function (v, i) {
      var t = types[i];
      if (t === 'money' || t === 'int') return v === '' || v === null || v === undefined ? '' : Number(v);
      if (t === 'date') return Exp_dateCell_(v);
      return Db_safeCell_(v === null || v === undefined ? '' : v);
    });
  }));
  if (totalsRow) values.push(totalsRow.map(function (v, i) { return types[i] === 'money' || types[i] === 'int' ? (v === '' ? '' : Number(v)) : Db_safeCell_(v); }));
  var n = values.length, c = headers.length;
  sheet.getRange(row, 1, n, c).setValues(values);
  sheet.getRange(row, 1, 1, c).setFontWeight('bold').setBackground(EXP_HEADER_BG_).setWrap(true).setVerticalAlignment('middle');
  types.forEach(function (t, i) {
    if (n < 2) return;
    var rng = sheet.getRange(row + 1, i + 1, n - 1, 1);
    if (t === 'money') rng.setNumberFormat('#,##0');
    else if (t === 'int') rng.setNumberFormat('0');
    else if (t === 'date') rng.setNumberFormat('yyyy-mm-dd');
  });
  if (totalsRow) sheet.getRange(row + n - 1, 1, 1, c).setFontWeight('bold').setBackground('#F4F4F4');
  return row + n + 1;
}

function Exp_prepareSheet_(sheet, font) {
  sheet.setRightToLeft(true);
  sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 1), Math.max(sheet.getMaxColumns(), 1)).setFontFamily(font).setFontSize(10);
}

function Exp_buildWorkbook_(ss, m) {
  var font = Settings_str_('REPORT_FONT') || 'Vazirmatn';
  var s = m.summary;

  var sh = ss.getSheets()[0];
  sh.setName('Daily Summary');
  Exp_prepareSheet_(sh, font);
  var info = [
    ['عنوان گزارش', m.title],
    ['بازه (شمسی)', Jal_isoToJalali_(m.from) + (m.to !== m.from ? ' تا ' + Jal_isoToJalali_(m.to) : '')],
    ['بازه (میلادی)', m.from + (m.to !== m.from ? ' تا ' + m.to : '')],
    ['زمان تهیه', Jal_isoToJalali_(Utils_isoDatePart_(m.generated_at)) + ' ' + String(m.generated_at).slice(11, 16) + ' (تهران)'],
    ['تهیه‌کننده', m.generated_by === 'SCHEDULER' ? 'زمان‌بندی خودکار' : Adm_actorName_(m.generated_by)],
    ['واحد مبالغ', 'ریال (IRR) — همه ستون‌های مبلغ به ریال‌اند'],
    ['توضیح اعتبارسنجی', 'اصالت تصاویر رسید توسط سیستم تأیید نشده است (authenticity_not_verified)؛ تأیید نهایی با ادمین مالی است.']
  ];
  var r = Exp_writeTable_(sh, 1, ['مورد', 'مقدار'], ['text', 'text'], info);
  var metrics = [
    ['تعداد سفارش‌های ثبت‌شده', s.orders], ['افراد یکتا (تأییدشده، نفر-روز)', s.uniqueBeneficiariesApproved],
    ['افراد یکتا (همه سفارش‌ها، نفر-روز)', s.uniqueBeneficiariesAll],
    ['مبلغ کل فاکتورها (ریال)', s.claimed], ['مبلغ واجد شرایط (ریال)', s.eligible],
    ['مبلغ تأییدشده (ریال)', s.approved], ['مبلغ پرداخت‌شده (ریال)', s.paid],
    ['قابل واریز — تأییدشده پرداخت‌نشده (ریال)', s.unpaid], ['در انتظار بررسی — تخمینی (ریال)', s.pendingEstimate]
  ];
  r = Exp_writeTable_(sh, r, ['شاخص', 'مقدار'], ['text', 'money'], metrics);
  r = Exp_writeTable_(sh, r, ['وضعیت', 'تعداد'], ['text', 'int'], Object.keys(REPORT_GROUP_FA_).map(function (g) { return [REPORT_GROUP_FA_[g], s.counts[g]]; }));
  if (m.from !== m.to) {
    var byDay = {};
    m.orders.forEach(function (o) {
      var d = byDay[o.date] = byDay[o.date] || { n: 0, claimed: 0, approved: 0, paid: 0 };
      if (o.group !== 'CANCELLED' && o.group !== 'INCOMPLETE') { d.n++; d.claimed += o.claimed; }
      d.approved += o.approved;
      if (o.group === 'PAID') d.paid += o.approved;
    });
    var dayRows = Object.keys(byDay).sort().map(function (k) { var d = byDay[k]; return [k, Jal_isoToJalali_(k), d.n, d.claimed, d.approved, d.paid]; });
    Exp_writeTable_(sh, r, ['تاریخ', 'تاریخ شمسی', 'تعداد سفارش', 'فاکتور (ریال)', 'تأییدشده (ریال)', 'پرداخت‌شده (ریال)'],
      ['date', 'text', 'int', 'money', 'money', 'money'], dayRows);
  }
  sh.setColumnWidth(1, 260);
  sh.setColumnWidth(2, 380);

  var p = ss.insertSheet('Payouts by Payer');
  Exp_prepareSheet_(p, font);
  var pRows = m.payouts.map(function (x, i) {
    return [i + 1, x.payer_name, m.include_audit ? x.payee_identifier : '', x.count, x.request_ids.join('، '), x.approved, x.paid, x.unpaid];
  });
  Exp_writeTable_(p, 1, ['ردیف', 'پرداخت‌کننده (دریافت‌کننده وجه)', 'شناسه پرداخت', 'تعداد درخواست', 'شناسه درخواست‌ها', 'مبلغ تأییدشده (ریال)', 'پرداخت‌شده (ریال)', 'قابل واریز (ریال)'],
    ['int', 'text', 'text', 'int', 'text', 'money', 'money', 'money'], pRows,
    ['', 'جمع', '', Exp_sum_(m.payouts, 'count'), '', Exp_sum_(m.payouts, 'approved'), Exp_sum_(m.payouts, 'paid'), Exp_sum_(m.payouts, 'unpaid')]);
  Exp_finishTable_(p, 8, [50, 200, 140, 90, 260, 150, 150, 150]);

  var o = ss.insertSheet('Order Details');
  Exp_prepareSheet_(o, font);
  var oRows = m.orders.map(function (x) {
    return [x.request_id, x.date, x.jdate, x.submitter, x.payer, x.channel, x.payment, x.beneficiaries, x.count, x.claimed,
      x.non_eligible, x.eligible, x.calculated, x.approved, x.status, x.docs, x.flags, x.reviewed_by, x.folder];
  });
  Exp_writeTable_(o, 1, ['شناسه درخواست', 'تاریخ', 'تاریخ شمسی', 'ثبت‌کننده', 'پرداخت‌کننده', 'روش خرید', 'روش پرداخت', 'افراد', 'تعداد نفرات',
    'مبلغ فاکتور (ریال)', 'غیرقابل بازپرداخت (ریال)', 'واجد شرایط (ریال)', 'محاسبه‌شده (ریال)', 'تأییدشده (ریال)', 'وضعیت', 'مدارک', 'هشدارها', 'بررسی‌کننده', 'پوشه مدارک (خصوصی)'],
    ['text', 'date', 'text', 'text', 'text', 'text', 'text', 'text', 'int', 'money', 'money', 'money', 'money', 'money', 'text', 'text', 'text', 'text', 'text'], oRows,
    ['جمع', '', '', '', '', '', '', '', '', Exp_sum_(m.orders, 'claimed'), Exp_sum_(m.orders, 'non_eligible'), Exp_sum_(m.orders, 'eligible'), Exp_sum_(m.orders, 'calculated'), Exp_sum_(m.orders, 'approved'), '', '', '', '', '']);
  Exp_finishTable_(o, 19, [130, 95, 95, 130, 130, 100, 120, 240, 70, 130, 120, 130, 130, 130, 150, 130, 260, 120, 220]);

  var c = ss.insertSheet('Beneficiary Cap Usage');
  Exp_prepareSheet_(c, font);
  Exp_writeTable_(c, 1, ['تاریخ', 'تاریخ شمسی', 'کارمند', 'سقف روز (ریال)', 'هزینه واقعی (ریال)', 'تخصیص تأییدشده (ریال)', 'مانده سقف (ریال)', 'درخواست‌ها'],
    ['date', 'text', 'text', 'money', 'money', 'money', 'money', 'text'],
    m.cap_usage.map(function (x) { return [x.date, Jal_isoToJalali_(x.date), x.name, x.cap, x.actual, x.used, x.remaining, x.request_ids.join('، ')]; }));
  Exp_finishTable_(c, 8, [95, 95, 180, 130, 130, 150, 130, 260]);

  var q = ss.insertSheet('Pending & Rejected');
  Exp_prepareSheet_(q, font);
  Exp_writeTable_(q, 1, ['شناسه درخواست', 'تاریخ', 'تاریخ شمسی', 'پرداخت‌کننده', 'وضعیت', 'مبلغ فاکتور (ریال)', 'محاسبه‌شده تخمینی (ریال)', 'دلیل / توضیح', 'هشدارها'],
    ['text', 'date', 'text', 'text', 'text', 'money', 'money', 'text', 'text'],
    m.pending_rejected.map(function (x) { return [x.request_id, x.date, x.jdate, x.payer, x.status, x.claimed, x.calculated, x.reason, x.flags]; }));
  Exp_finishTable_(q, 9, [130, 95, 95, 150, 170, 130, 150, 260, 260]);

  if (m.include_audit) {
    var a = ss.insertSheet('Audit & Evidence Index');
    Exp_prepareSheet_(a, font);
    var next = Exp_writeTable_(a, 1, ['شناسه مدرک', 'شناسه درخواست', 'نوع مدرک', 'نوع فایل', 'زمان ارسال', 'وضعیت OCR/AI', 'مبلغ استخراج‌شده (ریال)', 'هشدارها', 'لینک خصوصی Drive', 'اصالت'],
      ['text', 'text', 'text', 'text', 'text', 'text', 'money', 'text', 'text', 'text'],
      m.evidence.map(function (x) { return [x.document_id, x.request_id, x.kind, x.mime, x.uploaded_at, x.ocr, x.extracted, x.flags, x.link, x.authenticity]; }));
    Exp_writeTable_(a, next, ['شناسه درخواست', 'رویداد', 'انجام‌دهنده', 'از وضعیت', 'به وضعیت', 'زمان'], ['text', 'text', 'text', 'text', 'text', 'text'],
      m.audit.map(function (x) { return [x.request_id, x.action, x.actor, x.from, x.to, x.at]; }));
    Exp_finishTable_(a, 10, [140, 130, 190, 120, 190, 110, 150, 240, 300, 220]);
  }
}

function Exp_sum_(list, field) {
  return list.reduce(function (acc, x) { return acc + (Number(x[field]) || 0); }, 0);
}

function Exp_finishTable_(sheet, cols, widths) {
  sheet.setFrozenRows(1);
  widths.forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  var last = sheet.getLastRow();
  if (last >= 2) sheet.getRange(1, 1, last, cols).createFilter();
}

/**
 * PDF گزارش به‌صورت Google Doc ساخته و یک‌جا Export می‌شود (A4 عمودی، راست‌به‌چپ، قالب حسابداری):
 *  صفحه گزارش: سربرگ، مشخصات گزارش، کارت‌های جمع مالی، صورت پرداخت به دریافت‌کنندگان وجه،
 *  دفتر سفارش‌ها، موارد باز، جدول امضا.
 *  پیوست (گزارش روزانه ادمین): هر تصویر در یک صفحه — فاکتور غذا، رسید پرداخت کارمند و رسید
 *  واریز شرکت — با جدول مشخصات و توضیح ارسال‌کننده.
 */
var PDF_PAGE_ = { W: 595.28, H: 841.89, MARGIN: 34 };
var PDF_CONTENT_W_ = 527;
var PDF_IMAGE_MAX_ = { W: 515, H: 520, UPSCALE: 2 };
var PDF_COLOR_ = {
  NAVY: '#1F3B6E', NAVY_TEXT: '#FFFFFF', HEAD: '#DCE4F2', ZEBRA: '#F5F7FB', TOTAL: '#E3EAF6',
  BORDER: '#9AA8BF', MUTED: '#5A6478', GOOD: '#1B7F3B', WARN: '#B45309', LABEL: '#EEF2F8'
};

function Exp_buildPdfDoc_(m, folder, base) {
  var font = Settings_str_('REPORT_FONT') || 'Vazirmatn';
  var doc = DocumentApp.create(base + '_pdf');
  var tmp = DriveApp.getFileById(doc.getId());
  tmp.moveTo(folder);
  var body = doc.getBody();
  body.setPageWidth(PDF_PAGE_.W).setPageHeight(PDF_PAGE_.H)
    .setMarginTop(PDF_PAGE_.MARGIN).setMarginBottom(PDF_PAGE_.MARGIN).setMarginLeft(PDF_PAGE_.MARGIN).setMarginRight(PDF_PAGE_.MARGIN);
  var R = Exp_pdfRenderer_(body, font);
  var F = Utils_formatNumberFa_;
  var s = m.summary;

  R.banner(m.title, 'گزارش بازپرداخت هزینه ناهار کارکنان — همه مبالغ به ریال');
  R.kv([
    ['تاریخ گزارش', m.from === m.to ? Jal_formatLong_(m.from) : Jal_formatLong_(m.from, false) + ' تا ' + Jal_formatLong_(m.to, false)],
    ['زمان تهیه', Jal_formatDateTimeFa_(m.generated_at) + ' (تهران)'],
    ['تهیه‌کننده', m.generated_by === 'SCHEDULER' ? 'زمان‌بندی خودکار' : Adm_actorName_(m.generated_by) || '—'],
    ['واحد مبالغ', 'ریال (IRR)']
  ], 4);
  R.heading('۱. خلاصه مالی');
  R.cards([
    ['مبلغ کل فاکتورها', F(s.claimed)], ['مبلغ واجد شرایط', F(s.eligible)],
    ['مبلغ تأییدشده', F(s.approved)], ['پرداخت‌شده', F(s.paid)],
    ['مانده قابل واریز', F(s.unpaid)], ['در انتظار بررسی (تخمینی)', F(s.pendingEstimate)],
    ['تعداد سفارش‌ها', F(s.orders)], ['افراد یکتا (تأییدشده)', F(s.uniqueBeneficiariesApproved)]
  ]);
  R.heading('۲. صورت پرداخت به دریافت‌کنندگان وجه');
  R.note('کل مبلغ مجاز هر سفارش به پرداخت‌کننده همان سفارش تعلق می‌گیرد؛ سقف روزانه هر نفر جداگانه کنترل شده است.');
  R.table(['ردیف', 'دریافت‌کننده وجه', 'تعداد', 'شناسه درخواست‌ها', 'تأییدشده', 'پرداخت‌شده', 'مانده', 'وضعیت'],
    m.payouts.map(function (p, i) {
      return [F(i + 1), p.payer_name, F(p.count), p.request_ids.join('\n'), F(p.approved), F(p.paid), F(p.unpaid), p.unpaid ? 'در انتظار واریز' : 'تسویه‌شده'];
    }),
    { widths: [30, 92, 38, 100, 70, 70, 62, 65], numeric: [0, 2, 4, 5, 6], total: ['', 'جمع کل', F(Exp_sum_(m.payouts, 'count')), '', F(Exp_sum_(m.payouts, 'approved')), F(Exp_sum_(m.payouts, 'paid')), F(Exp_sum_(m.payouts, 'unpaid')), ''],
      empty: 'در این بازه پرداخت تأییدشده‌ای وجود ندارد.' });
  R.heading('۳. دفتر سفارش‌ها');
  R.table(['شناسه', 'تاریخ', 'پرداخت‌کننده', 'افراد', 'مبلغ فاکتور', 'تأییدشده', 'وضعیت', 'مدارک'],
    m.orders.filter(function (x) { return x.group !== 'CANCELLED'; }).map(function (x) {
      return [x.request_id, Utils_faDigits_(x.jdate), x.payer, x.beneficiaries, F(x.claimed), F(x.approved), x.status, Utils_faDigits_(x.docs)];
    }),
    { widths: [78, 52, 70, 100, 62, 62, 60, 43], numeric: [1, 4, 5], fontSize: 7.5,
      total: ['جمع', '', '', '', F(Exp_sum_(m.orders.filter(function (x) { return x.group !== 'CANCELLED' && x.group !== 'INCOMPLETE'; }), 'claimed')), F(Exp_sum_(m.orders, 'approved')), '', ''],
      empty: 'سفارشی در این بازه ثبت نشده است.' });
  if (m.pending_rejected.length) {
    R.heading('۴. موارد باز، ردشده یا ناقص (جزو جمع قابل پرداخت نیستند)');
    R.table(['شناسه', 'تاریخ', 'پرداخت‌کننده', 'وضعیت', 'مبلغ فاکتور', 'تخمینی', 'دلیل / توضیح'],
      m.pending_rejected.map(function (x) { return [x.request_id, Utils_faDigits_(x.jdate), x.payer, x.status, F(x.claimed), F(x.calculated), x.reason || '—']; }),
      { widths: [80, 52, 75, 80, 65, 60, 115], numeric: [1, 4, 5], fontSize: 7.5 });
  }
  R.heading('تأیید و امضا');
  R.signatures(m.approvers.length ? m.approvers.join('، ') : '—');
  R.note('اصالت تصاویر رسید توسط سیستم تأیید نشده است (authenticity_not_verified)؛ تطبیق نهایی مدارک با ادمین مالی است.' +
    (m.evidence_pages && m.evidence_pages.length ? ' پیوست مدارک: ' + F(m.evidence_pages.length) + ' تصویر در صفحات بعد.' : ''));
  if (m.evidence_pages && m.evidence_pages.length) Exp_appendEvidencePages_(body, m.evidence_pages, R);
  doc.saveAndClose();
  return { doc: doc, file: tmp };
}

/** ابزار رسم: پاراگراف، سربرگ، جدول کلید/مقدار، کارت‌ها، جدول داده با سطر جمع، امضا. */
function Exp_pdfRenderer_(body, font) {
  var C = PDF_COLOR_;
  var first = true;
  var DA = DocumentApp;
  function styleText(el, size, bold, color) {
    var t = el.editAsText();
    if (t.getText && !t.getText()) return;
    t.setFontFamily(font).setFontSize(size).setBold(!!bold).setForegroundColor(color || '#000000');
  }
  function para(text, size, bold, align, color, before, after) {
    var p;
    if (first) { p = body.getParagraphs()[0]; p.setText(text); first = false; } else p = body.appendParagraph(text);
    p.setLeftToRight(false).setAlignment(align || DA.HorizontalAlignment.RIGHT).setSpacingBefore(before || 0).setSpacingAfter(after || 0);
    if (text) styleText(p, size || 9, bold, color);
    return p;
  }
  function cellStyle(cell, text, o) {
    o = o || {};
    if (o.bg) cell.setBackgroundColor(o.bg);
    cell.setPaddingTop(o.pad || 3).setPaddingBottom(o.pad || 3).setPaddingLeft(4).setPaddingRight(4);
    if (cell.setVerticalAlignment && DA.VerticalAlignment) cell.setVerticalAlignment(DA.VerticalAlignment.CENTER);
    var p = cell.getChild(0).asParagraph();
    p.setLeftToRight(false).setAlignment(o.align || DA.HorizontalAlignment.RIGHT).setSpacingBefore(0).setSpacingAfter(0);
    if (text) styleText(p, o.size || 8, o.bold, o.color);
  }
  /** جدول راست‌به‌چپ: ستون‌ها معکوس درج می‌شوند تا ستون اول سمت راست صفحه باشد. */
  function rtlTable(rows, widths) {
    var cells = rows.map(function (r) { return r.map(function (v) { return v === null || v === undefined ? '' : String(v); }).reverse(); });
    var t = body.appendTable(cells);
    t.setBorderColor(C.BORDER).setBorderWidth(0.5);
    if (widths) widths.slice().reverse().forEach(function (w, i) { t.setColumnWidth(i, w); });
    first = false;
    return { t: t, cells: cells, n: rows[0].length };
  }
  function cellAt(tb, r, logicalCol) { return tb.t.getRow(r).getCell(tb.n - 1 - logicalCol); }
  return {
    para: para,
    spacer: function () { para('', 4); },
    banner: function (title, sub) {
      var tb = rtlTable([[title], [sub]], [PDF_CONTENT_W_]);
      cellStyle(cellAt(tb, 0, 0), title, { bg: C.NAVY, color: C.NAVY_TEXT, size: 15, bold: true, align: DA.HorizontalAlignment.CENTER, pad: 8 });
      cellStyle(cellAt(tb, 1, 0), sub, { bg: C.HEAD, color: C.NAVY, size: 9, align: DA.HorizontalAlignment.CENTER, pad: 4 });
      para('', 4);
    },
    heading: function (text) { para(text, 11.5, true, null, C.NAVY, 10, 4); },
    note: function (text) { para(text, 7.5, false, null, C.MUTED, 2, 4); },
    /** جدول کلید/مقدار؛ perRow = تعداد ستون (۲ یا ۴). */
    kv: function (pairs, perRow) {
      var per = (perRow || 2) / 2, rows = [];
      for (var i = 0; i < pairs.length; i += per) {
        var row = [];
        for (var j = 0; j < per; j++) { var pr = pairs[i + j] || ['', '']; row.push(pr[0], pr[1]); }
        rows.push(row);
      }
      var w = per === 2 ? [80, 183, 80, 184] : [130, 397];
      var tb = rtlTable(rows, w);
      rows.forEach(function (row, r) {
        row.forEach(function (v, c) {
          var label = c % 2 === 0;
          cellStyle(cellAt(tb, r, c), v, { bg: label ? C.LABEL : null, bold: label, color: label ? C.NAVY : '#000000', size: 8.5 });
        });
      });
      para('', 4);
    },
    /** کارت‌های جمع مالی: ۴ کارت در هر ردیف (عنوان بالا، مبلغ درشت پایین). */
    cards: function (items) {
      var rows = [];
      for (var i = 0; i < items.length; i += 4) {
        var chunk = items.slice(i, i + 4);
        while (chunk.length < 4) chunk.push(['', '']);
        rows.push(chunk.map(function (x) { return x[0]; }));
        rows.push(chunk.map(function (x) { return x[1]; }));
      }
      var tb = rtlTable(rows, [131, 132, 132, 132]);
      rows.forEach(function (row, r) {
        row.forEach(function (v, c) {
          var isLabel = r % 2 === 0;
          cellStyle(cellAt(tb, r, c), v, isLabel ? { bg: C.HEAD, color: C.NAVY, size: 8, align: DA.HorizontalAlignment.CENTER }
            : { size: 12, bold: true, align: DA.HorizontalAlignment.CENTER, pad: 6 });
        });
      });
      para('', 2);
    },
    /** جدول داده: سرستون تیره، سطرهای راه‌راه، اعداد وسط‌چین، سطر جمع. */
    table: function (headers, data, o) {
      o = o || {};
      if (!data.length) { para(o.empty || '—', 8.5, false, null, C.MUTED, 2, 4); return; }
      var rows = [headers].concat(data);
      if (o.total) rows.push(o.total);
      var tb = rtlTable(rows, o.widths);
      var last = rows.length - 1;
      rows.forEach(function (row, r) {
        row.forEach(function (v, c) {
          var head = r === 0, total = o.total && r === last;
          var num = (o.numeric || []).indexOf(c) >= 0;
          cellStyle(cellAt(tb, r, c), v, {
            bg: head ? C.NAVY : total ? C.TOTAL : (r % 2 === 0 ? C.ZEBRA : null),
            color: head ? C.NAVY_TEXT : '#000000', bold: head || total, size: head ? 8 : (o.fontSize || 8),
            align: head || num ? DA.HorizontalAlignment.CENTER : DA.HorizontalAlignment.RIGHT
          });
        });
      });
      para('', 2);
    },
    signatures: function (approvers) {
      var rows = [['تهیه‌کننده (ادمین مالی)', 'تأییدکننده', 'مدیر مالی'], ['', approvers, ''], ['امضا و تاریخ:', 'امضا و تاریخ:', 'امضا و تاریخ:']];
      var tb = rtlTable(rows, [175, 176, 176]);
      rows.forEach(function (row, r) {
        row.forEach(function (v, c) {
          cellStyle(cellAt(tb, r, c), v, r === 0 ? { bg: C.HEAD, bold: true, color: C.NAVY, align: DA.HorizontalAlignment.CENTER }
            : { size: 8.5, pad: r === 2 ? 22 : 6, align: DA.HorizontalAlignment.CENTER, color: r === 2 ? C.MUTED : '#000000' });
        });
      });
      para('', 2);
    },
    table_raw: rtlTable,
    cellAt: cellAt,
    cellStyle: cellStyle
  };
}

/** هر مدرک در یک صفحه: سربرگ رنگی، جدول مشخصات، تصویر بزرگ وسط صفحه. */
function Exp_appendEvidencePages_(body, pages, R) {
  var F = Utils_formatNumberFa_;
  var DA = DocumentApp;
  var color = { FOOD: '#1F3B6E', EMPLOYEE_PAYMENT: '#7A4E0B', PAYOUT: '#1B7F3B' };
  pages.forEach(function (pg, n) {
    body.appendPageBreak();
    var title = 'پیوست ' + F(n + 1) + ' از ' + F(pages.length) + ' — ' + pg.kind_fa + (pg.count > 1 ? ' (' + F(pg.index) + ' از ' + F(pg.count) + ')' : '');
    var tb = R.table_raw([[title]], [PDF_CONTENT_W_]);
    R.cellStyle(R.cellAt(tb, 0, 0), title, { bg: color[pg.section] || '#1F3B6E', color: '#FFFFFF', size: 12, bold: true, align: DA.HorizontalAlignment.CENTER, pad: 6 });
    R.para('', 3);
    var pairs = [
      ['شناسه درخواست', pg.request_id], ['تاریخ سفارش', pg.date_fa],
      ['پرداخت‌کننده (دریافت وجه)', pg.payer], ['وضعیت', pg.status],
      ['افراد', pg.beneficiaries], ['خرید / پرداخت', [pg.channel, pg.payment].filter(Boolean).join(' / ')],
      ['مبلغ فاکتور (ریال)', F(pg.claimed)], ['مبلغ تأییدشده (ریال)', F(pg.approved)]
    ];
    if (pg.section === 'PAYOUT') {
      pairs.push(['مبلغ واریزشده (ریال)', F(pg.paid_amount)], ['زمان واریز', pg.paid_at_fa || '—'], ['شماره پیگیری', pg.paid_ref || '—'], ['', '']);
    }
    if (pg.merchant) pairs.push(['رستوران / شماره سفارش', pg.merchant], ['', '']);
    R.kv(pairs, 4);
    R.kv([['توضیح ارسال‌کننده', pg.caption || '—'], ['ارسال', pg.uploaded_fa + ' — ' + pg.uploaded_by]], 2);
    var blob = pg.isImage ? Exp_evidenceBlob_(pg) : null;
    var placed = false;
    if (blob) {
      try {
        var img = body.appendImage(blob);
        var w = img.getWidth(), h = img.getHeight();
        if (w > 0 && h > 0) {
          var r = Math.min(PDF_IMAGE_MAX_.W / w, PDF_IMAGE_MAX_.H / h, PDF_IMAGE_MAX_.UPSCALE);
          img.setWidth(Math.round(w * r)).setHeight(Math.round(h * r));
        }
        img.getParent().asParagraph().setAlignment(DA.HorizontalAlignment.CENTER).setSpacingBefore(6);
        placed = true;
      } catch (e) {
        console.warn('evidence image failed ' + pg.document_id + ': ' + Utils_redact_(e.message));
      }
    }
    if (!placed) {
      R.para(pg.isImage ? '⚠️ تصویر قابل درج نبود (فرمت پشتیبانی‌نشده یا فایل در دسترس نیست). نسخه اصلی در پوشه خصوصی Drive است.'
        : '📄 این مدرک فایل PDF است و به‌صورت تصویر درج نمی‌شود؛ نسخه اصلی در پوشه خصوصی Drive درخواست موجود است.',
        10, true, DA.HorizontalAlignment.CENTER, '#A33', 30, 4);
    }
    R.para('اصالت تصویر توسط سیستم تأیید نشده است (authenticity_not_verified).', 7, false, DA.HorizontalAlignment.CENTER, '#666666', 4, 0);
  });
}

function Exp_evidenceBlob_(pg) {
  if (pg.drive_file_id) {
    try { return DriveApp.getFileById(pg.drive_file_id).getBlob(); } catch (e) { /* از تلگرام دریافت می‌شود */ }
  }
  var dl = Doc_download_({ file_id: pg.telegram_file_id, file_size: pg.file_size, mime_type: pg.mime_type });
  return dl.ok ? dl.blob : null;
}
