/**
 * Export.gs — ساخت فایل واقعی Excel (.xlsx) و PDF فارسی راست‌به‌چپ از روی مدل گزارش.
 *
 * روش (کاملاً رایگان): یک Google Sheet موقت در پوشه خصوصی Reports ساخته می‌شود، سپس با Export
 * رسمی Google به XLSX و PDF تبدیل و در Drive بایگانی می‌شود؛ فایل موقت به سطل زباله می‌رود.
 * در Excel ستون‌های مبلغ «عدد واقعی» (ریال) و تاریخ‌ها «تاریخ واقعی» و قابل فیلترند.
 * در PDF اعداد با ارقام فارسی و جداکننده هزارگان نمایش داده می‌شوند.
 */

var PDF_EXPORT_PARAMS_ = '&size=A4&portrait=false&fitw=true&gridlines=false&printtitle=false&sheetnames=false' +
  '&pagenum=CENTER&fzr=false&top_margin=0.5&bottom_margin=0.5&left_margin=0.4&right_margin=0.4&horizontal_alignment=CENTER';

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
    var pdfSheet = Exp_buildPdfSheet_(ss, m);
    SpreadsheetApp.flush();
    var pdf = Exp_export_(ss.getId(), 'format=pdf&gid=' + pdfSheet.getSheetId() + PDF_EXPORT_PARAMS_).setName(base + '.pdf');
    var xlsxFile = folder.createFile(xlsx);
    var pdfFile = folder.createFile(pdf);
    var snap = folder.createFile(Utilities.newBlob(JSON.stringify(m), 'application/json', base + '.json'));
    return { xlsxBlob: xlsx, pdfBlob: pdf, xlsxId: xlsxFile.getId(), pdfId: pdfFile.getId(), snapshotId: snap.getId() };
  } finally {
    try { tmp.setTrashed(true); } catch (e) { console.warn('temp report trash failed'); }
  }
}

function Exp_export_(id, params) {
  var url = 'https://docs.google.com/spreadsheets/d/' + id + '/export?' + params;
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

/** شیت چاپی PDF: متن فارسی، ارقام فارسی، راست‌به‌چپ، ۸ ستون. */
function Exp_buildPdfSheet_(ss, m) {
  var font = Settings_str_('REPORT_FONT') || 'Vazirmatn';
  var sh = ss.insertSheet('PDF');
  sh.setRightToLeft(true);
  sh.setHiddenGridlines(true);
  [105, 85, 130, 230, 115, 115, 115, 100].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  var rows = [], blocks = [];
  var C = 8;
  function line(text, style) { blocks.push({ type: 'line', row: rows.length + 1, style: style || '' }); rows.push([Db_safeCell_(text), '', '', '', '', '', '', '']); }
  function table(headers, data) {
    var start = rows.length + 1;
    var hdr = headers.slice(); while (hdr.length < C) hdr.push('');
    rows.push(hdr.map(Db_safeCell_));
    data.forEach(function (d) { var x = d.slice(); while (x.length < C) x.push(''); rows.push(x.map(function (v) { return Db_safeCell_(v === null || v === undefined ? '' : v); })); });
    blocks.push({ type: 'table', row: start, n: data.length + 1 });
  }
  var F = Utils_formatNumberFa_;
  var s = m.summary;
  line(m.title, 'title');
  line('زمان تهیه: ' + Jal_formatDateTimeFa_(m.generated_at) + ' (وقت تهران)  |  واحد همه مبالغ: ریال', 'sub');
  line('');
  line('خلاصه مالی', 'h');
  table(['شاخص', 'مقدار', 'شاخص', 'مقدار'], [
    ['سفارش‌های ثبت‌شده', F(s.orders), 'افراد یکتا (تأییدشده)', F(s.uniqueBeneficiariesApproved)],
    ['مبلغ کل فاکتورها', F(s.claimed), 'مبلغ واجد شرایط', F(s.eligible)],
    ['مبلغ تأییدشده', F(s.approved), 'پرداخت‌شده', F(s.paid)],
    ['قابل واریز (پرداخت‌نشده)', F(s.unpaid), 'در انتظار بررسی (تخمینی)', F(s.pendingEstimate)],
    ['در انتظار بررسی (تعداد)', F(s.counts.PENDING), 'ردشده / ناقص', F(s.counts.REJECTED) + ' / ' + F(s.counts.INCOMPLETE)]
  ]);
  line('');
  line('فهرست دریافت‌کنندگان وجه (کل مبلغ هر سفارش به پرداخت‌کننده همان سفارش)', 'h');
  table(['ردیف', 'پرداخت‌کننده', 'تعداد', 'شناسه درخواست‌ها', 'تأییدشده (ریال)', 'پرداخت‌شده (ریال)', 'قابل واریز (ریال)', 'وضعیت'],
    m.payouts.map(function (p, i) {
      return [F(i + 1), p.payer_name, F(p.count), p.request_ids.join('، '), F(p.approved), F(p.paid), F(p.unpaid), p.unpaid ? 'در انتظار واریز' : 'پرداخت‌شده'];
    }).concat([['', 'جمع', F(Exp_sum_(m.payouts, 'count')), '', F(Exp_sum_(m.payouts, 'approved')), F(Exp_sum_(m.payouts, 'paid')), F(Exp_sum_(m.payouts, 'unpaid')), '']]));
  line('');
  line('جزئیات سفارش‌ها', 'h');
  table(['شناسه', 'تاریخ', 'پرداخت‌کننده', 'افراد', 'فاکتور (ریال)', 'تأییدشده (ریال)', 'وضعیت', 'مدارک'],
    m.orders.filter(function (x) { return x.group !== 'CANCELLED'; }).map(function (x) {
      return [x.request_id, Utils_faDigits_(x.jdate), x.payer, x.beneficiaries, F(x.claimed), F(x.approved), x.status, Utils_faDigits_(x.docs)];
    }));
  if (m.pending_rejected.length) {
    line('');
    line('موارد در انتظار، ردشده یا ناقص (جزو جمع قابل پرداخت نیستند)', 'h');
    table(['شناسه', 'تاریخ', 'پرداخت‌کننده', 'وضعیت', 'فاکتور (ریال)', 'تخمینی (ریال)', 'دلیل / توضیح', ''],
      m.pending_rejected.map(function (x) { return [x.request_id, Utils_faDigits_(x.jdate), x.payer, x.status, F(x.claimed), F(x.calculated), x.reason, '']; }));
  }
  line('');
  line('وضعیت مدارک: برای هر سفارش، تعداد مدرک خرید و پرداخت در ستون «مدارک» آمده است. اصالت تصاویر رسید توسط سیستم تأیید نشده است (authenticity_not_verified) و مسئولیت تطبیق با ادمین مالی است.', 'note');
  line('تأییدکننده(ها): ' + (m.approvers.length ? m.approvers.join('، ') : '—') + '          امضا: ______________________', 'note');

  sh.getRange(1, 1, rows.length, C).setValues(rows);
  sh.getRange(1, 1, rows.length, C).setFontFamily(font).setFontSize(9).setWrap(true).setVerticalAlignment('middle').setHorizontalAlignment('right');
  blocks.forEach(function (b) {
    if (b.type === 'line') {
      var rg = sh.getRange(b.row, 1, 1, C).merge();
      if (b.style === 'title') rg.setFontSize(15).setFontWeight('bold').setHorizontalAlignment('center');
      else if (b.style === 'sub') rg.setFontSize(9).setHorizontalAlignment('center').setFontColor('#555555');
      else if (b.style === 'h') rg.setFontSize(11).setFontWeight('bold').setBackground('#DDE6F3');
      else if (b.style === 'note') rg.setFontSize(8).setFontColor('#444444');
    } else {
      sh.getRange(b.row, 1, b.n, C).setBorder(true, true, true, true, true, true, '#999999', SpreadsheetApp.BorderStyle.SOLID);
      sh.getRange(b.row, 1, 1, C).setFontWeight('bold').setBackground(EXP_HEADER_BG_).setHorizontalAlignment('center');
    }
  });
  return sh;
}
