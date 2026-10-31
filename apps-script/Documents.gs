/**
 * Documents.gs — دریافت مدارک از تلگرام، ذخیره خصوصی در Google Drive و کنترل تکرار.
 * فایل‌ها هرگز Share عمومی نمی‌شوند؛ پوشه‌ها فقط در دسترس صاحب حساب Google هستند.
 */

var PAYMENT_DOC_KINDS = ['BANK_PAYMENT', 'CREDIT_PAYMENT', 'MIXED_PAYMENT'];

/** استخراج مشخصات فایل از پیام تلگرام. */
function Doc_fileInfo_(msg) {
  if (!msg) return null;
  if (msg.photo && msg.photo.length) {
    var p = msg.photo[msg.photo.length - 1];
    return { media: 'photo', file_id: p.file_id, file_unique_id: p.file_unique_id, file_size: p.file_size || 0, mime_type: 'image/jpeg', file_name: 'photo.jpg' };
  }
  if (msg.document) {
    var d = msg.document, mime = String(d.mime_type || '').toLowerCase();
    var ok = mime.indexOf('image/') === 0 || mime === 'application/pdf';
    return { media: 'document', file_id: d.file_id, file_unique_id: d.file_unique_id, file_size: d.file_size || 0, mime_type: mime, file_name: d.file_name || 'file', unsupported: !ok };
  }
  if (msg.voice) {
    var v = msg.voice;
    return { media: 'voice', file_id: v.file_id, file_unique_id: v.file_unique_id, file_size: v.file_size || 0, mime_type: v.mime_type || 'audio/ogg', file_name: 'voice.ogg', duration: v.duration || 0 };
  }
  if (msg.audio) {
    var a = msg.audio;
    return { media: 'voice', file_id: a.file_id, file_unique_id: a.file_unique_id, file_size: a.file_size || 0, mime_type: a.mime_type || 'audio/mpeg', file_name: a.file_name || 'audio', duration: a.duration || 0 };
  }
  return null;
}

function Doc_maxBytes_() {
  var mb = Math.min(Settings_int_('MAX_FILE_MB') || APP.TELEGRAM_MAX_DOWNLOAD_MB, APP.TELEGRAM_MAX_DOWNLOAD_MB);
  return mb * 1024 * 1024;
}

/** دانلود فایل از تلگرام (قبل از گرفتن قفل هم قابل اجراست). */
function Doc_download_(info) {
  if (info.file_size && info.file_size > Doc_maxBytes_()) return { ok: false, error: 'TOO_LARGE' };
  try {
    var f = Tg_getFile_(info.file_id);
    if (f.file_size && f.file_size > Doc_maxBytes_()) return { ok: false, error: 'TOO_LARGE' };
    if (!f.file_path) return { ok: false, error: 'NO_PATH' };
    var blob = Tg_downloadFile_(f.file_path);
    var ext = (String(f.file_path).match(/\.[A-Za-z0-9]{2,5}$/) || [''])[0];
    return { ok: true, blob: blob, ext: ext || Doc_extFromMime_(info.mime_type) };
  } catch (e) {
    var tooBig = String(e.description || '').indexOf('file is too big') >= 0;
    return { ok: false, error: tooBig ? 'TOO_LARGE' : 'DOWNLOAD_FAILED', detail: Utils_redact_(e.message) };
  }
}

function Doc_extFromMime_(mime) {
  var map = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'application/pdf': '.pdf', 'audio/ogg': '.ogg', 'audio/mpeg': '.mp3' };
  return map[mime] || '';
}

function Doc_forRequest_(rid, includeRemoved) {
  return Db_find_(SHEETS.DOCUMENTS, function (d) {
    return d.request_id === rid && (includeRemoved || d.status !== 'REMOVED');
  });
}

function Doc_count_(rid, kinds) {
  return Doc_forRequest_(rid).filter(function (d) { return kinds.indexOf(d.document_kind) >= 0; }).length;
}

/** پوشه خصوصی یک درخواست: Documents/<سال-ماه شمسی>/<request_id> */
function Doc_requestFolder_(req) {
  if (req.drive_folder_id) {
    try { return DriveApp.getFolderById(req.drive_folder_id); } catch (e) { /* پوشه حذف شده؛ دوباره ساخته می‌شود */ }
  }
  var root = DriveApp.getFolderById(Utils_getProp_(PROP.DOCS_FOLDER_ID));
  var j = Jal_isoToJalali_(Utils_isoDatePart_(req.created_at) || Utils_todayIso_());
  var monthName = j.slice(0, 7).replace('/', '-');
  var it = root.getFoldersByName(monthName);
  var month = it.hasNext() ? it.next() : root.createFolder(monthName);
  var folder = month.createFolder(req.request_id);
  Db_update_(SHEETS.REQUESTS, req, { drive_folder_id: folder.getId() });
  return folder;
}

/** درخواست‌هایی که وجودشان مانع پذیرش تصویر تکراری نیست ولی باید علامت بخورد. */
function Doc_activeRequestIds_() {
  var map = {};
  Db_all_(SHEETS.REQUESTS).forEach(function (r) {
    if (r.status !== STATUS.CANCELLED) map[r.request_id] = r.status;
  });
  return map;
}

/**
 * ذخیره یک مدرک برای درخواست.
 * خروجی: {ok:true, doc, flags:[...], warnings:[...]} یا {ok:false, error}
 */
function Doc_save_(ctx, req, kind, info, prefetched) {
  if (!info || info.unsupported) return { ok: false, error: 'UNSUPPORTED' };
  if (info.file_size && info.file_size > Doc_maxBytes_()) return { ok: false, error: 'TOO_LARGE' };
  var rid = req.request_id;
  var existing = Doc_forRequest_(rid);
  var sameHere = existing.filter(function (d) { return d.telegram_file_unique_id === info.file_unique_id; });
  if (sameHere.length) {
    var crossKind = sameHere.some(function (d) { return d.document_kind !== kind; });
    if (crossKind && kind !== DOC_KIND.VOICE_NOTE) return { ok: false, error: 'SAME_FILE_BOTH_KINDS' };
    return { ok: false, error: 'ALREADY_IN_REQUEST' };
  }

  var flags = [], warnings = [];
  var activeReqs = Doc_activeRequestIds_();
  var dupByFile = Db_find_(SHEETS.DOCUMENTS, function (d) {
    return d.request_id !== rid && d.status !== 'REMOVED' && d.telegram_file_unique_id === info.file_unique_id && activeReqs[d.request_id];
  });
  if (dupByFile.length) flags.push('DUPLICATE_FILE:' + dupByFile[0].request_id);

  var dl = prefetched && prefetched.ok ? prefetched : Doc_download_(info);
  if (!dl.ok && dl.error === 'TOO_LARGE') return { ok: false, error: 'TOO_LARGE' };

  var sha = '', driveId = '';
  if (dl.ok) {
    try {
      sha = Utils_sha256Hex_(dl.blob.getBytes());
      if (!dupByFile.length) {
        var dupBySha = Db_find_(SHEETS.DOCUMENTS, function (d) {
          return d.request_id !== rid && d.status !== 'REMOVED' && d.sha256_if_available === sha && activeReqs[d.request_id];
        });
        if (dupBySha.length) flags.push('DUPLICATE_FILE:' + dupBySha[0].request_id);
      }
      var n = existing.filter(function (d) { return d.document_kind === kind; }).length + 1;
      var folder = Doc_requestFolder_(req);
      var file = folder.createFile(dl.blob.setName(rid + '_' + kind + '_' + n + (dl.ext || '')));
      driveId = file.getId();
    } catch (e) {
      Audit_error_('DRIVE_SAVE', e, ctx.tgId, rid);
      flags.push('DRIVE_SAVE_FAILED');
    }
  } else {
    flags.push('DRIVE_SAVE_FAILED');
  }
  if (flags.some(function (f) { return f.indexOf('DUPLICATE_FILE') === 0; })) {
    warnings.push('⚠️ این تصویر قبلاً در درخواست دیگری ارسال شده است؛ برای بررسی ادمین علامت‌گذاری شد.');
  }
  if (flags.indexOf('DRIVE_SAVE_FAILED') >= 0) {
    warnings.push('⚠️ ذخیره نسخه پشتیبان در Drive انجام نشد، اما فایل در تلگرام ثبت شد و ادمین آن را می‌بیند.');
  }

  var consent = ctx.auth && ctx.auth.employee && ctx.auth.employee.ai_consent === 'YES';
  var aiPossible = kind !== DOC_KIND.VOICE_NOTE && consent && Ai_isEnabled_('image');
  var doc = Db_insert_(SHEETS.DOCUMENTS, {
    document_id: Utils_newId_('D'),
    request_id: rid,
    document_kind: kind,
    telegram_file_id: info.file_id,
    telegram_file_unique_id: info.file_unique_id,
    drive_file_id: driveId,
    sha256_if_available: sha,
    original_filename: Utils_truncate_(info.file_name || '', 120),
    mime_type: info.mime_type,
    file_size: info.file_size || 0,
    caption: Utils_maskSensitive_(Utils_truncate_((ctx.msg && ctx.msg.caption) || '', 500)),
    extracted_amount_rial: '',
    extracted_currency: '',
    extracted_date: '',
    extracted_reference: '',
    ocr_status: aiPossible ? 'PENDING' : 'SKIPPED',
    ai_json: '',
    verification_flags: flags.join(','),
    status: 'ACTIVE',
    uploaded_by: ctx.tgId,
    uploaded_at: Utils_nowIso_()
  });
  Audit_log_(rid, ctx.tgId, 'DOCUMENT_ADDED', '', kind, { document_id: doc.document_id, flags: flags });
  return { ok: true, doc: doc, flags: flags, warnings: warnings };
}

/** حذف منطقی مدارک یک مرحله (فایل‌ها در Drive می‌مانند). */
function Doc_removeKinds_(rid, kinds, actorId) {
  var removed = 0;
  Doc_forRequest_(rid).forEach(function (d) {
    if (kinds.indexOf(d.document_kind) >= 0) {
      Db_update_(SHEETS.DOCUMENTS, d, { status: 'REMOVED' });
      removed++;
    }
  });
  if (removed) Audit_log_(rid, actorId, 'DOCUMENTS_REMOVED', '', '', { kinds: kinds, count: removed });
  return removed;
}

/** تغییر نوع مدارک پرداخت پس از تغییر روش پرداخت. */
function Doc_relabelPayment_(rid, newKind, actorId) {
  Doc_forRequest_(rid).forEach(function (d) {
    if (PAYMENT_DOC_KINDS.indexOf(d.document_kind) >= 0 && d.document_kind !== newKind) {
      var prev = d.document_kind;
      Db_update_(SHEETS.DOCUMENTS, d, { document_kind: newKind, verification_flags: [d.verification_flags, 'RELABELED_FROM_' + prev].filter(Boolean).join(',') });
      Audit_log_(rid, actorId, 'DOCUMENT_RELABELED', prev, newKind, { document_id: d.document_id });
    }
  });
}

function Doc_paymentKindFor_(method) {
  if (method === PAY_METHOD.CREDIT) return DOC_KIND.CREDIT_PAYMENT;
  if (method === PAY_METHOD.MIXED) return DOC_KIND.MIXED_PAYMENT;
  return DOC_KIND.BANK_PAYMENT;
}

function Doc_driveLink_(driveId) {
  return driveId ? 'https://drive.google.com/file/d/' + driveId + '/view' : '';
}

function Doc_folderLink_(folderId) {
  return folderId ? 'https://drive.google.com/drive/folders/' + folderId : '';
}

function Doc_errorFa_(code) {
  var map = {
    UNSUPPORTED: 'این نوع فایل پذیرفته نیست. لطفاً عکس (JPG/PNG) یا فایل PDF بفرستید.',
    TOO_LARGE: 'حجم فایل بیشتر از حد مجاز است. لطفاً تصویر را فشرده‌تر یا به‌صورت «عکس» (نه فایل) ارسال کنید.',
    ALREADY_IN_REQUEST: 'این تصویر قبلاً در همین درخواست ثبت شده است.',
    SAME_FILE_BOTH_KINDS: 'این همان تصویری است که برای مرحله دیگر ارسال کرده‌اید. مدرک خرید و مدرک پرداخت باید دو تصویر مستقل باشند.'
  };
  return map[code] || 'ذخیره فایل ناموفق بود؛ لطفاً دوباره ارسال کنید.';
}
