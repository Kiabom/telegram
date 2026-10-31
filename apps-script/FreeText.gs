/**
 * FreeText.gs — مسیر «ارسال آزاد»: برداشت قاعده‌محور (بدون AI) از پیام متنی یا متن ویس.
 * مثال: «امروز برای خودم، محمد و رضا از اسنپ‌فود غذا گرفتم. جمعش یک میلیون و دویست و شصت هزار تومان شد، خودم با کارت پرداخت کردم.»
 *
 * هیچ فیلدی بدون تأیید کاربر نهایی نمی‌شود؛ مدارک خرید و پرداخت همچنان اجباری‌اند.
 */

function Free_parse_(text, auth) {
  var t = Names_normalizeLetters_(Utils_normalizeDigits_(text)).replace(/‌/g, ' ');
  var out = { channel: null, payment: null, date: null, payerSelf: false };
  var online = /اسنپ\s*فود|snapp\s*food|آنلاین|انلاین|اپلیکیشن|اپلیکیشن|سایت|تپسی\s*فود|دلینو|ریحون|سفارش\s*اینترنتی/i.test(t);
  var inPerson = /حضوری|رفتم\s*رستوران|رفتیم\s*رستوران|از\s*خود\s*رستوران|سلف/i.test(t);
  if (online !== inPerson) out.channel = online ? CHANNEL.ONLINE : CHANNEL.IN_PERSON;
  var credit = /اسنپ\s*پی|snapp\s*pay|اعتبار|اعتباری|قسطی/i.test(t);
  var bank = /کارت|بانکی|درگاه|عابر\s*بانک|انتقال\s*وجه|پوز/i.test(t);
  if (credit && bank) out.payment = PAY_METHOD.MIXED;
  else if (credit) out.payment = PAY_METHOD.CREDIT;
  else if (bank) out.payment = PAY_METHOD.BANK;
  if (/دیروز/.test(t)) out.date = Utils_isoAddDays_(Utils_todayIso_(), -1);
  else if (/امروز/.test(t)) out.date = Utils_todayIso_();
  out.payerSelf = /خودم\s+(?:\S+\s+){0,5}?(?:پرداخت|حساب)\s*کردم|(?:پرداخت|حساب)\s*کردم|من\s+(?:\S+\s+){0,3}?پرداخت/.test(t);
  var mentions = Names_findMentions_(t, Emp_active_(), auth.employee);
  out.people = mentions.resolved.map(function (e) { return e.employee_id; });
  out.amb = mentions.ambiguous.map(function (a) { return { token: a.token, ids: a.candidates.map(function (e) { return e.employee_id; }) }; });
  var amounts = Money_findAmounts_(t);
  out.amount = amounts.length ? { v: amounts[0].value, u: amounts[0].unit } : null;
  return out;
}

function Free_isClaimLike_(p) {
  return !!(p.amount || p.channel || p.payment || p.people.length > 1 || p.amb.length);
}

function Free_cardText_(p, auth) {
  var unknown = '❔ نامشخص';
  var people = p.people.map(function (id) { return Utils_escapeHtml_(Emp_name_(id)); });
  p.amb.forEach(function (a) { people.push('❓«' + Utils_escapeHtml_(a.token) + '» (مبهم)'); });
  var amount = unknown;
  if (p.amount) {
    amount = p.amount.u ? Money_formatInUnit_(p.amount.v, p.amount.u) + (p.amount.u === 'TOMAN' ? ' = ' + Utils_formatRial_(p.amount.v * 10) : '')
      : Utils_formatNumberFa_(p.amount.v) + ' (واحد نامشخص؛ پرسیده می‌شود)';
  }
  return [
    '🤖 <b>برداشت من از پیام شما</b> (لطفاً بررسی کنید):',
    '• روش خرید: ' + (p.channel ? CHANNEL_FA[p.channel] : unknown),
    '• روش پرداخت: ' + (p.payment ? PAY_METHOD_FA[p.payment] : unknown),
    '• تاریخ: ' + (p.date ? Jal_formatLong_(p.date) : unknown),
    '• افراد: ' + (people.length ? people.join('، ') : unknown),
    '• پرداخت‌کننده: ' + (p.payerSelf ? 'خودم (' + Utils_escapeHtml_(auth.employee.full_name_fa) + ')' : unknown),
    '• مبلغ: ' + amount,
    '',
    'هیچ‌کدام از این موارد بدون تأیید شما نهایی نمی‌شود و ارسال مدرک خرید و مدرک پرداخت همچنان لازم است.'
  ].join('\n');
}

/** پیام متنی آزاد در حالت عادی (خارج از فرم). */
function Free_handleText_(ctx, text) {
  if (!Auth_can_(ctx.auth, 'SUBMIT')) return Menu_help_(ctx);
  var p = Free_parse_(text, ctx.auth);
  if (ctx.aiVoiceUsed) p.voice = true;
  if (!Free_isClaimLike_(p)) {
    return Ui_send_(ctx, 'متوجه نشدم 🙂 برای ثبت هزینه ناهار «➕ ثبت هزینه ناهار» را بزنید یا جزئیات سفارش را در یک پیام بنویسید.', Kb_mainMenu_(ctx.auth));
  }
  var s = ctx.sess;
  s.data_json.fx = p;
  s.step = 'FREE_CONFIRM';
  var seq = Sess_nextSeq_(s);
  Ui_reply_(ctx, Free_cardText_(p, ctx.auth), Kb_inline_([
    [Btn_('✅ شروع ثبت با همین اطلاعات', 'fx|' + seq + '|y')],
    [Btn_('📝 فرم خالی', 'fx|' + seq + '|n'), Btn_('❌ بی‌خیال', 'fx|' + seq + '|c')]
  ]));
}

function Free_onCallback_(ctx, seq, act) {
  var s = ctx.sess;
  if (Number(seq) !== Number(s.seq) || !s.data_json.fx) return Ui_toast_(ctx, 'این دکمه منقضی شده است.', true);
  var p = s.data_json.fx;
  delete s.data_json.fx;
  s.step = 'IDLE';
  if (act === 'c') return Ui_reply_(ctx, 'باشه؛ چیزی ثبت نشد.');
  Ui_reply_(ctx, act === 'y' ? '👌 فرم با اطلاعات پیام شما شروع می‌شود.' : '👌 فرم خالی شروع می‌شود.');
  ctx.forceNew = true;
  Wiz_start_(ctx, act === 'y' ? p : null);
}

/** ویس در حالت عادی: با AI به متن تبدیل و برای تأیید نشان داده می‌شود؛ وگرنه راهنمای ورود دستی. */
function Free_handleVoice_(ctx, info, prefetched) {
  var s = ctx.sess;
  s.data_json.pendingVoice = info;
  if (!Auth_can_(ctx.auth, 'SUBMIT') || !Ai_isEnabled_('voice') || ctx.auth.employee.ai_consent !== 'YES') {
    return Ui_send_(ctx, '🎙 ویس دریافت شد؛ لطفاً جزئیات را به‌صورت متنی بنویسید یا از «➕ ثبت هزینه ناهار» فرم را پر کنید. ویس به درخواست بعدی شما پیوست می‌شود تا ادمین ببیند.', Kb_mainMenu_(ctx.auth));
  }
  var tr = Ai_transcribe_(info, prefetched);
  if (!tr.ok) return Ui_send_(ctx, '🎙 ' + Ai_fallbackMessage_(tr.error), Kb_mainMenu_(ctx.auth));
  s.data_json.vt = tr.text;
  s.step = 'VOICE_CONFIRM';
  var seq = Sess_nextSeq_(s);
  Ui_send_(ctx, '🎙 متن ویس شما:\n«' + Utils_escapeHtml_(tr.text) + '»\n\nاگر درست است تأیید کنید؛ وگرنه متن صحیح را تایپ کنید.',
    Kb_inline_([[Btn_('✅ درست است', 'fv|' + seq + '|y'), Btn_('✍️ خودم تایپ می‌کنم', 'fv|' + seq + '|n')]]));
}

function Free_onVoiceCallback_(ctx, seq, act) {
  var s = ctx.sess;
  if (Number(seq) !== Number(s.seq) || !s.data_json.vt) return Ui_toast_(ctx, 'این دکمه منقضی شده است.', true);
  var text = s.data_json.vt;
  delete s.data_json.vt;
  s.step = 'IDLE';
  if (act !== 'y') return Ui_reply_(ctx, 'لطفاً جزئیات را تایپ کنید.');
  ctx.forceNew = true;
  ctx.aiVoiceUsed = true;
  Free_handleText_(ctx, text);
}

/** اعمال برداشت تأییدشده روی پیش‌نویس تازه. */
function Free_applyPrefill_(ctx, d, p) {
  d.prefilled = true;
  if (p.channel) d.channel = p.channel;
  if (p.payment === PAY_METHOD.CREDIT && !Settings_bool_('ALLOW_CREDIT_PAYMENTS')) p.payment = null;
  if (p.payment === PAY_METHOD.MIXED && !Settings_bool_('ALLOW_MIXED_PAYMENTS')) p.payment = null;
  if (p.payment) d.payment = p.payment;
  if (p.date) d.date = p.date;
  var active = {};
  Emp_active_().forEach(function (e) { active[e.employee_id] = true; });
  d.people = (p.people || []).filter(function (id) { return active[id]; });
  d.amb = (p.amb || []).map(function (a) { return { token: a.token, ids: a.ids.filter(function (id) { return active[id]; }) }; })
    .filter(function (a) { return a.ids.length; });
  if (p.payerSelf) { d.payerId = ctx.auth.employee.employee_id; d.payerDone = true; }
  if (p.amount) d.suggest = [{ v: p.amount.v, u: p.amount.u, src: 'TEXT' }];
  if (p.voice) d.aiVoiceUsed = true;
}
