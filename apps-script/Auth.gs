/**
 * Auth.gs — کارکنان، نقش‌ها، مجوزها و وضعیت مکالمه (Session).
 * هویت فقط با telegram_user_id تعیین می‌شود؛ username و نام نمایشی معتبر نیستند.
 */

function Auth_ownerIds_() {
  return Utils_getProp_(PROP.OWNER_TELEGRAM_IDS).split(/[,\s،]+/).map(function (s) { return Utils_normalizeDigits_(s).trim(); })
    .filter(function (s) { return /^\d+$/.test(s); });
}

function Auth_resolve_(from) {
  var id = String(from.id);
  var emp = Emp_byTelegramId_(id);
  var isOwner = Auth_ownerIds_().indexOf(id) >= 0;
  var role = null;
  if (isOwner) role = ROLES.OWNER;
  else if (emp && emp.active) role = ROLE_FA[emp.role] ? emp.role : ROLES.EMPLOYEE;
  return {
    tgId: id,
    from: from,
    isOwner: isOwner,
    employee: emp && emp.active ? emp : null,
    rawEmployee: emp,
    role: role
  };
}

function Auth_can_(auth, perm) {
  if (!auth || !auth.role) return false;
  if (perm === 'SUBMIT' && !auth.employee) return false;
  return (PERMISSIONS[perm] || []).indexOf(auth.role) >= 0;
}

/** شناسه چت همه کسانی که مجوز perm دارند (برای اعلان‌ها). */
function Auth_chatIdsWith_(perm) {
  var ids = [];
  Auth_ownerIds_().forEach(function (id) { if (PERMISSIONS[perm].indexOf(ROLES.OWNER) >= 0) ids.push(id); });
  Emp_active_().forEach(function (e) {
    if (e.telegram_user_id && PERMISSIONS[perm].indexOf(e.role) >= 0) ids.push(String(e.telegram_user_id));
  });
  return Utils_unique_(ids);
}

function Auth_displayName_(from) {
  return [from.first_name, from.last_name].filter(Boolean).join(' ') || ('کاربر ' + from.id);
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

function Emp_all_() {
  return Db_all_(SHEETS.EMPLOYEES).filter(function (e) { return e.employee_id; });
}

function Emp_active_() {
  return Emp_all_().filter(function (e) { return e.active; }).sort(function (a, b) {
    return String(a.full_name_fa).localeCompare(String(b.full_name_fa), 'fa');
  });
}

function Emp_byId_(id) {
  return id ? Db_findOne_(SHEETS.EMPLOYEES, 'employee_id', id) : null;
}

function Emp_byTelegramId_(tgId) {
  var target = String(tgId);
  var rows = Emp_all_();
  for (var i = 0; i < rows.length; i++) {
    if (Utils_normalizeDigits_(rows[i].telegram_user_id).trim() === target) return rows[i];
  }
  return null;
}

function Emp_name_(id) {
  var e = Emp_byId_(id);
  return e ? e.full_name_fa : ('(' + id + ')');
}

function Emp_create_(fields, actorId) {
  var now = Utils_nowIso_();
  var row = Db_insert_(SHEETS.EMPLOYEES, {
    employee_id: Utils_newId_('E'),
    full_name_fa: fields.full_name_fa,
    telegram_user_id: fields.telegram_user_id || '',
    aliases: fields.aliases || '',
    active: fields.active !== false,
    role: fields.role || ROLES.EMPLOYEE,
    department: fields.department || '',
    payment_identifier_optional: '',
    ai_consent: '',
    telegram_username_snapshot: fields.telegram_username_snapshot || '',
    created_at: now,
    updated_at: now
  });
  Audit_log_('', actorId, 'EMPLOYEE_CREATED', '', row.role, { employee_id: row.employee_id, name: row.full_name_fa, telegram_user_id: row.telegram_user_id });
  return row;
}

function Emp_update_(emp, patch, actorId, action) {
  var before = {};
  Object.keys(patch).forEach(function (k) { before[k] = emp[k]; });
  patch.updated_at = Utils_nowIso_();
  Db_update_(SHEETS.EMPLOYEES, emp, patch);
  if (action) Audit_log_('', actorId, action, '', '', { employee_id: emp.employee_id, before: before, after: patch });
  return emp;
}

// ---------------------------------------------------------------------------
// Session (وضعیت مکالمه هر کاربر)
// ---------------------------------------------------------------------------

function Sess_get_(tgId) {
  var row = Db_findOne_(SHEETS.SESSIONS, 'telegram_user_id', tgId);
  if (!row) return { telegram_user_id: String(tgId), step: 'IDLE', request_id: '', data_json: {}, seq: 0, __new: true };
  if (!row.data_json || typeof row.data_json !== 'object') row.data_json = {};
  if (!row.step) row.step = 'IDLE';
  return row;
}

function Sess_save_(s) {
  s.updated_at = Utils_nowIso_();
  s.request_id = s.data_json && s.data_json.d ? s.data_json.d.rid : '';
  if (s.__new) {
    var r = Db_insert_(SHEETS.SESSIONS, s);
    s.__row = r.__row;
    delete s.__new;
  } else {
    Db_update_(SHEETS.SESSIONS, s, {});
  }
}

/** پاک‌کردن کامل فرم جاری (پیش‌نویس در شیت Requests باقی می‌ماند). */
function Sess_clearDraft_(s) {
  s.step = 'IDLE';
  if (s.data_json) delete s.data_json.d;
}

function Sess_nextSeq_(s) {
  s.seq = (Number(s.seq) || 0) + 1;
  if (s.seq > 99999) s.seq = 1;
  return s.seq;
}
