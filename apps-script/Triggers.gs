/**
 * Triggers.gs — کارهای زمان‌بندی‌شده: گزارش روزانه، نگهداری روزانه، Polling پشتیبان.
 * زمان اجرای تریگرهای گوگل دقیق نیست (معمولاً داخل همان ساعت انتخاب‌شده).
 */

var TRIGGER_HANDLERS_ = ['scheduledDailyReport', 'dailyMaintenance', 'pollTelegramUpdates'];

function Triggers_install_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (TRIGGER_HANDLERS_.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  if (Settings_bool_('REPORT_DAILY_ENABLED')) {
    var hour = Math.min(23, Math.max(0, Settings_int_('REPORT_DAILY_HOUR')));
    ScriptApp.newTrigger('scheduledDailyReport').timeBased().atHour(hour).everyDays(1).inTimezone(APP.TZ).create();
  }
  ScriptApp.newTrigger('dailyMaintenance').timeBased().atHour(3).everyDays(1).inTimezone(APP.TZ).create();
  if (Utils_getProp_(PROP.UPDATE_MODE) === 'POLLING') {
    ScriptApp.newTrigger('pollTelegramUpdates').timeBased().everyMinutes(1).create();
  }
}

function scheduledDailyReport() {
  App_resetState_();
  try {
    Rep_scheduledDaily_();
  } catch (e) {
    Audit_error_('SCHEDULED_REPORT', e, 'SCHEDULER');
    Auth_ownerIds_().forEach(function (id) { Tg_trySend_(id, '⚠️ گزارش خودکار امروز ناموفق بود؛ جزئیات در AuditLog ثبت شد.'); });
  }
}

/** حذف شناسه‌های update قدیمی، لغو پیش‌نویس‌های رهاشده و تمدید فرمت ستون‌ها. */
function dailyMaintenance() {
  App_resetState_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(APP.LOCK_WAIT_MS)) return;
  try {
    var cutoff = Utils_isoAddDays_(Utils_todayIso_(), -Settings_int_('PROCESSED_UPDATES_KEEP_DAYS'));
    var updates = Db_all_(SHEETS.UPDATES);
    var old = 0;
    for (var i = 0; i < updates.length && Utils_isoDatePart_(updates[i].received_at) < cutoff; i++) old++;
    if (old) Db_deleteOldestRows_(SHEETS.UPDATES, old);

    var draftCutoff = Utils_isoAddDays_(Utils_todayIso_(), -Settings_int_('DRAFT_EXPIRY_DAYS'));
    Db_find_(SHEETS.REQUESTS, function (r) {
      return DRAFT_STATUSES.indexOf(r.status) >= 0 && Utils_isoDatePart_(r.updated_at || r.created_at) < draftCutoff;
    }).forEach(function (r) {
      Db_update_(SHEETS.REQUESTS, r, { status: STATUS.CANCELLED, updated_at: Utils_nowIso_() });
      Audit_log_(r.request_id, 'SYSTEM', 'DRAFT_EXPIRED', r.status, STATUS.CANCELLED, {});
      var s = Sess_get_(r.submitter_telegram_id);
      if (!s.__new && s.data_json.d && s.data_json.d.rid === r.request_id) { Sess_clearDraft_(s); Sess_save_(s); }
      Tg_trySend_(r.submitter_telegram_id, '🗑 پیش‌نویس <code>' + r.request_id + '</code> به‌دلیل تکمیل‌نشدن لغو شد. در صورت نیاز درخواست جدید ثبت کنید.');
    });

    var ss = Db_ss_();
    Object.keys(SCHEMA).forEach(function (name) {
      var sh = ss.getSheetByName(name);
      if (sh) Setup_ensureFormats_(sh, name, Db_headers_(name));
    });

    var retentionCutoff = Utils_isoAddDays_(Utils_todayIso_(), -Settings_int_('RETENTION_DAYS'));
    var expired = Db_find_(SHEETS.DOCUMENTS, function (d) { return Utils_isoDatePart_(d.uploaded_at) < retentionCutoff; }).length;
    if (expired) Audit_log_('', 'SYSTEM', 'RETENTION_NOTICE', '', '', { documents_past_retention: expired });
  } catch (e) {
    Audit_error_('MAINTENANCE', e, 'SYSTEM');
  } finally {
    lock.releaseLock();
  }
}

/** حالت پشتیبان Polling: هر دقیقه getUpdates (فقط وقتی UPDATE_MODE=POLLING). */
function pollTelegramUpdates() {
  if (Utils_getProp_(PROP.UPDATE_MODE) !== 'POLLING') return;
  var cache = CacheService.getScriptCache();
  if (cache.get('polling_active')) return;
  cache.put('polling_active', '1', 55);
  try {
    var offset = Number(Utils_getProp_(PROP.POLL_OFFSET) || 0);
    var updates = Tg_call_('getUpdates', { offset: offset || undefined, limit: 50, timeout: 0, allowed_updates: ['message', 'callback_query'] });
    updates.forEach(function (u) {
      Router_processUpdate_(u);
      Utils_setProp_(PROP.POLL_OFFSET, u.update_id + 1);
    });
  } catch (e) {
    Audit_error_('POLLING', e, 'SYSTEM');
  } finally {
    cache.remove('polling_active');
  }
}
