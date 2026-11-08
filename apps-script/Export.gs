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
 * PDF گزارش به‌صورت Google Doc ساخته و Export می‌شود تا در یک فایل واحد بیاید:
 *  ۱) صفحات گزارش (خلاصه، دریافت‌کنندگان وجه، جزئیات سفارش‌ها، امضا)
 *  ۲) در گزارش روزانه ادمین: پیوست مدارک — هر تصویر (فاکتور غذا و رسید پرداخت) در یک صفحه جدا،
 *     بزرگ و قابل چاپ، همراه مشخصات سفارش و توضیحی که کارمند هنگام ثبت نوشته است.
 */
var PDF_PAGE_ = { W: 595.28, H: 841.89, MARGIN: 36 };
var PDF_IMAGE_MAX_ = { W: 523, H: 600, UPSCALE: 2 };

function Exp_buildPdfDoc_(m, folder, base) {
  var font = Settings_str_('REPORT_FONT') || 'Vazirmatn';
  var doc = DocumentApp.create(base + '_pdf');
  var tmp = DriveApp.getFileById(doc.getId());
  tmp.moveTo(folder);
  var body = doc.getBody();
  body.setPageWidth(PDF_PAGE_.W).setPageHeight(PDF_PAGE_.H)
    .setMarginTop(PDF_PAGE_.MARGIN).setMarginBottom(PDF_PAGE_.MARGIN).setMarginLeft(PDF_PAGE_.MARGIN).setMarginRight(PDF_PAGE_.MARGIN);
  var first = true;
  function para(text, size, bold, center, color) {
    var p;
    if (first) { p = body.getParagraphs()[0]; p.setText(text); } else p = body.appendParagraph(text);
    first = false;
    p.setLeftToRight(false).setAlignment(center ? DocumentApp.HorizontalAlignment.CENTER : DocumentApp.HorizontalAlignment.RIGHT);
    var t = p.editAsText();
    if (text) t.setFontFamily(font).setFontSize(size || 9).setBold(!!bold).setForegroundColor(color || '#000000');
    return p;
  }
  function line(text, style) {
    if (style === 'title') return para(text, 15, true, true);
    if (style === 'sub') return para(text, 9, false, true, '#555555');
    if (style === 'h') return para(text, 11, true, false, '#1F3B6E');
    if (style === 'note') return para(text, 8, false, false, '#444444');
    return para(text, 9);
  }
  function table(headers, data) {
    // جدول‌های Docs جهت راست‌به‌چپ ندارند؛ ستون‌ها معکوس می‌شوند تا ستون اول سمت راست باشد.
    var cells = [headers].concat(data).map(function (r) {
      return r.map(function (v) { return v === null || v === undefined ? '' : String(v); }).reverse();
    });
    var t = body.appendTable(cells);
    t.setBorderColor('#999999');
    for (var i = 0; i < cells.length; i++) {
      var row = t.getRow(i);
      for (var j = 0; j < cells[i].length; j++) {
        var cell = row.getCell(j);
        if (i === 0) cell.setBackgroundColor(EXP_HEADER_BG_);
        var p = cell.getChild(0).asParagraph();
        p.setLeftToRight(false).setAlignment(i === 0 ? DocumentApp.HorizontalAlignment.CENTER : DocumentApp.HorizontalAlignment.RIGHT);
        if (cells[i][j]) p.editAsText().setFontFamily(font).setFontSize(8).setBold(i === 0);
      }
    }
    return t;
  }
  var F = Utils_formatNumberFa_;
  var s = m.summary;
  line(m.title, 'title');
  line('زمان تهیه: ' + Jal_formatDateTimeFa_(m.generated_at) + ' (وقت تهران)  |  واحد همه مبالغ: ریال', 'sub');
  line('خلاصه مالی', 'h');
  table(['شاخص', 'مقدار', 'شاخص', 'مقدار'], [
    ['سفارش‌های ثبت‌شده', F(s.orders), 'افراد یکتا (تأییدشده)', F(s.uniqueBeneficiariesApproved)],
    ['مبلغ کل فاکتورها', F(s.claimed), 'مبلغ واجد شرایط', F(s.eligible)],
    ['مبلغ تأییدشده', F(s.approved), 'پرداخت‌شده', F(s.paid)],
    ['قابل واریز (پرداخت‌نشده)', F(s.unpaid), 'در انتظار بررسی (تخمینی)', F(s.pendingEstimate)],
    ['در انتظار بررسی (تعداد)', F(s.counts.PENDING), 'ردشده / ناقص', F(s.counts.REJECTED) + ' / ' + F(s.counts.INCOMPLETE)]
  ]);
  line('فهرست دریافت‌کنندگان وجه (کل مبلغ هر سفارش به پرداخت‌کننده همان سفارش)', 'h');
  table(['ردیف', 'پرداخت‌کننده', 'تعداد', 'شناسه درخواست‌ها', 'تأییدشده (ریال)', 'پرداخت‌شده (ریال)', 'قابل واریز (ریال)', 'وضعیت'],
    m.payouts.map(function (p, i) {
      return [F(i + 1), p.payer_name, F(p.count), p.request_ids.join('، '), F(p.approved), F(p.paid), F(p.unpaid), p.unpaid ? 'در انتظار واریز' : 'پرداخت‌شده'];
    }).concat([['', 'جمع', F(Exp_sum_(m.payouts, 'count')), '', F(Exp_sum_(m.payouts, 'approved')), F(Exp_sum_(m.payouts, 'paid')), F(Exp_sum_(m.payouts, 'unpaid')), '']]));
  line('جزئیات سفارش‌ها', 'h');
  table(['شناسه', 'تاریخ', 'پرداخت‌کننده', 'افراد', 'فاکتور (ریال)', 'تأییدشده (ریال)', 'وضعیت', 'مدارک'],
    m.orders.filter(function (x) { return x.group !== 'CANCELLED'; }).map(function (x) {
      return [x.request_id, Utils_faDigits_(x.jdate), x.payer, x.beneficiaries, F(x.claimed), F(x.approved), x.status, Utils_faDigits_(x.docs)];
    }));
  if (m.pending_rejected.length) {
    line('موارد در انتظار، ردشده یا ناقص (جزو جمع قابل پرداخت نیستند)', 'h');
    table(['شناسه', 'تاریخ', 'پرداخت‌کننده', 'وضعیت', 'فاکتور (ریال)', 'تخمینی (ریال)', 'دلیل / توضیح'],
      m.pending_rejected.map(function (x) { return [x.request_id, Utils_faDigits_(x.jdate), x.payer, x.status, F(x.claimed), F(x.calculated), x.reason]; }));
  }
  line('وضعیت مدارک: برای هر سفارش، تعداد مدرک خرید و پرداخت در ستون «مدارک» آمده است. اصالت تصاویر رسید توسط سیستم تأیید نشده است (authenticity_not_verified) و مسئولیت تطبیق با ادمین مالی است.', 'note');
  line('تأییدکننده(ها): ' + (m.approvers.length ? m.approvers.join('، ') : '—') + '          امضا: ______________________', 'note');
  if (m.evidence_pages && m.evidence_pages.length) {
    line('پیوست مدارک: در صفحات بعد، هر تصویر فاکتور غذا و رسید پرداخت در یک صفحه جداگانه آمده است (' +
      F(m.evidence_pages.length) + ' تصویر).', 'note');
    Exp_appendEvidencePages_(body, m.evidence_pages, para);
  }
  doc.saveAndClose();
  return { doc: doc, file: tmp };
}

/** هر مدرک در یک صفحه: مشخصات سفارش + توضیح کارمند + تصویر بزرگ وسط صفحه. */
function Exp_appendEvidencePages_(body, pages, para) {
  var F = Utils_formatNumberFa_;
  pages.forEach(function (pg) {
    body.appendPageBreak();
    para('پیوست مدرک — ' + pg.kind_fa + ' (' + F(pg.index) + ' از ' + F(pg.count) + ')', 13, true, true);
    para('درخواست ' + pg.request_id + '  |  تاریخ سفارش: ' + pg.date_fa + '  |  وضعیت: ' + pg.status, 9, false, true);
    para('پرداخت‌کننده: ' + pg.payer + '  |  افراد: ' + pg.beneficiaries, 9, false, true);
    para('مبلغ فاکتور: ' + F(pg.claimed) + ' ریال  |  تأییدشده: ' + F(pg.approved) + ' ریال' +
      (pg.merchant ? '  |  رستوران/سفارش: ' + pg.merchant : ''), 9, false, true);
    para('توضیح کارمند: ' + (pg.caption || '—') + '  |  ارسال: ' + pg.uploaded_fa + ' توسط ' + pg.uploaded_by, 9, false, true, '#1F3B6E');
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
        img.getParent().asParagraph().setAlignment(DocumentApp.HorizontalAlignment.CENTER);
        placed = true;
      } catch (e) {
        console.warn('evidence image failed ' + pg.document_id + ': ' + Utils_redact_(e.message));
      }
    }
    if (!placed) {
      para(pg.isImage ? '⚠️ تصویر قابل درج نبود (فرمت پشتیبانی‌نشده یا فایل در دسترس نیست). نسخه اصلی در پوشه خصوصی Drive است.'
        : '📄 این مدرک فایل PDF است و به‌صورت تصویر درج نمی‌شود؛ نسخه اصلی در پوشه خصوصی Drive درخواست موجود است.', 10, true, true, '#A33');
    }
    para('اصالت تصویر توسط سیستم تأیید نشده است (authenticity_not_verified).', 7, false, true, '#666666');
  });
}

function Exp_evidenceBlob_(pg) {
  if (pg.drive_file_id) {
    try { return DriveApp.getFileById(pg.drive_file_id).getBlob(); } catch (e) { /* از تلگرام دریافت می‌شود */ }
  }
  var dl = Doc_download_({ file_id: pg.telegram_file_id, file_size: pg.file_size, mime_type: pg.mime_type });
  return dl.ok ? dl.blob : null;
}
