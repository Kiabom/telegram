/**
 * Wizard.gs — فرم مرحله‌ای ثبت هزینه ناهار (چت خصوصی).
 *
 * مراحل به ترتیب: روش خرید → روش پرداخت → مدرک خرید → مدرک پرداخت → تاریخ → افراد →
 * پرداخت‌کننده → مبلغ (واحد ریال/تومان، سهم‌ها) → مشخصات سفارش (اختیاری) → بازبینی و ثبت.
 *
 * مرحله بعدی همیشه از روی داده‌های پیش‌نویس محاسبه می‌شود (اولین مرحله ناتمام)، بنابراین
 * «بازگشت»، «اصلاح» و «ادامه درخواست نیمه‌کاره» به‌طور یکسان کار می‌کنند.
 * دکمه‌ها شماره نسخه (seq) دارند؛ دکمه‌های قدیمی (replay) پذیرفته نمی‌شوند.
 */

function Wiz_newDraft_(rid) {
  return {
    rid: rid, mode: 'NEW', channel: null, payment: null, purchaseDone: false, paymentDone: false,
    combined: false, date: null, people: [], peopleDone: false, peopleSig: '', payerId: null, payerDone: false,
    total: null, nonElig: 0, nonEligDone: false, split: null, shares: {}, merchant: '', orderNo: '',
    merchantDone: false, unitPref: null, pend: null, amb: [], sub: null, subFor: null, page: 0,
    aiFlags: [], aiTried: false, suggest: [], prefilled: false, rebalanced: false, voice: null, aiVoiceUsed: false
  };
}

function Wiz_eligible_(d) {
  return (d.total || 0) - (d.nonElig || 0);
}

function Wiz_sharesSum_(d) {
  return d.people.reduce(function (a, id) { return a + (Number(d.shares[id]) || 0); }, 0);
}

function Wiz_sharesComplete_(d) {
  return d.people.every(function (id) { return d.shares[id] !== undefined && d.shares[id] !== null; });
}

function Wiz_sharesOk_(d) {
  return Wiz_sharesComplete_(d) && Wiz_sharesSum_(d) === Wiz_eligible_(d);
}

var WIZ_STEPS_ = [
  { id: 'W_CHANNEL', label: 'روش خرید', done: function (d) { return !!d.channel; }, undo: function (d) { d.channel = null; } },
  { id: 'W_PAYMENT', label: 'روش پرداخت', done: function (d) { return !!d.payment; }, undo: function (d) { d.payment = null; } },
  { id: 'W_PURCHASE_DOCS', label: 'مدرک خرید', done: function (d) { return d.purchaseDone; }, undo: function (d) { d.purchaseDone = false; } },
  { id: 'W_PAYMENT_DOCS', label: 'مدرک پرداخت', done: function (d) { return d.paymentDone; }, undo: function (d) { d.paymentDone = false; d.combined = false; } },
  { id: 'W_DATE', label: 'تاریخ سفارش', done: function (d) { return !!d.date; }, undo: function (d) { d.date = null; } },
  { id: 'W_PEOPLE', label: 'افراد', done: function (d) { return d.peopleDone; }, undo: function (d) { d.peopleDone = false; } },
  { id: 'W_PAYER', label: 'پرداخت‌کننده', done: function (d) { return d.payerDone; }, undo: function (d) { d.payerDone = false; } },
  { id: 'W_TOTAL', label: 'مبلغ', done: function (d) { return d.total !== null && d.total !== undefined; }, undo: function (d) { d.total = null; } },
  {
    id: 'W_NONELIG', label: 'مبلغ', applies: function () { return Settings_nonEligibleItems_().length > 0; },
    done: function (d) { return d.nonEligDone; }, undo: function (d) { d.nonEligDone = false; d.nonElig = 0; }
  },
  {
    id: 'W_SPLIT', label: 'مبلغ', applies: function (d) { return d.people.length > 1; },
    done: function (d) { return d.split === SPLIT.EQUAL || d.split === SPLIT.INDIVIDUAL; }, undo: function (d) { d.split = null; d.shares = {}; }
  },
  {
    id: 'W_SHARE', label: 'مبلغ', applies: function (d) { return d.people.length > 1 && d.split === SPLIT.INDIVIDUAL; },
    done: Wiz_sharesOk_, undo: function (d) { d.shares = {}; d.rebalanced = false; }
  },
  { id: 'W_MERCHANT', label: 'مشخصات سفارش (اختیاری)', done: function (d) { return d.merchantDone; }, undo: function (d) { d.merchantDone = false; } }
];

var WIZ_DISPLAY_ORDER_ = ['W_CHANNEL', 'W_PAYMENT', 'W_PURCHASE_DOCS', 'W_PAYMENT_DOCS', 'W_DATE', 'W_PEOPLE', 'W_PAYER', 'W_TOTAL', 'W_MERCHANT'];

function Wiz_applies_(step, d) {
  return !step.applies || step.applies(d);
}

function Wiz_resolve_(d) {
  for (var i = 0; i < WIZ_STEPS_.length; i++) {
    var s = WIZ_STEPS_[i];
    if (Wiz_applies_(s, d) && !s.done(d)) return s.id;
  }
  return 'W_SUMMARY';
}

function Wiz_stepIndex_(id) {
  for (var i = 0; i < WIZ_STEPS_.length; i++) if (WIZ_STEPS_[i].id === id) return i;
  return WIZ_STEPS_.length;
}

/** بازگشت: آخرین مرحله تکمیل‌شده قبل از مرحله فعلی باز می‌شود. */
function Wiz_back_(d, current) {
  for (var i = Wiz_stepIndex_(current) - 1; i >= 0; i--) {
    var s = WIZ_STEPS_[i];
    if (Wiz_applies_(s, d) && s.done(d)) { s.undo(d); return true; }
  }
  return false;
}

function Wiz_setSub_(d, sub) {
  d.sub = sub;
  d.subFor = Wiz_resolve_(d);
}

function WB_(seq, act, arg) {
  return 'w|' + seq + '|' + act + (arg !== undefined && arg !== null ? '|' + arg : '');
}

function Wiz_header_(step, d) {
  if (step === 'W_SUMMARY') return '🧾 <b>بازبینی نهایی</b>  •  کد: <code>' + d.rid + '</code>';
  var s = WIZ_STEPS_[Wiz_stepIndex_(step)];
  var displayId = ['W_NONELIG', 'W_SPLIT', 'W_SHARE'].indexOf(step) >= 0 ? 'W_TOTAL' : step;
  var n = WIZ_DISPLAY_ORDER_.indexOf(displayId) + 1;
  return '🧾 <b>مرحله ' + Utils_faDigits_(n) + ' از ' + Utils_faDigits_(WIZ_DISPLAY_ORDER_.length) + ' — ' + s.label + '</b>' +
    (d.mode === 'CORRECTION' ? '  •  اصلاح <code>' + d.rid + '</code>' : '');
}

function Wiz_names_(ids) {
  return ids.map(function (id) { return Utils_escapeHtml_(Emp_name_(id)); }).join('، ');
}

// ---------------------------------------------------------------------------
// شروع، ادامه، لغو
// ---------------------------------------------------------------------------

/** شروع فرم جدید (prefill: داده تأییدشده از پیام آزاد). */
function Wiz_start_(ctx, prefill) {
  if (!Auth_can_(ctx.auth, 'SUBMIT')) return Ui_reply_(ctx, '⛔️ شما مجوز ثبت درخواست ندارید.');
  var s = ctx.sess;
  var old = s.data_json.d;
  if (old && old.rid) {
    var oldReq = Req_get_(old.rid);
    var active = oldReq && (DRAFT_STATUSES.indexOf(oldReq.status) >= 0 || (old.mode === 'CORRECTION' && oldReq.status === STATUS.NEEDS_CORRECTION));
    if (active && !prefill) {
      s.step = 'W_RESUME';
      var seq = Sess_nextSeq_(s);
      return Ui_reply_(ctx, '📝 شما یک درخواست نیمه‌کاره دارید (کد <code>' + old.rid + '</code>).\nادامه می‌دهید یا درخواست جدید شروع شود؟',
        Kb_inline_([[Btn_('▶️ ادامه همان درخواست', WB_(seq, 'rs'))], [Btn_('🆕 شروع درخواست جدید (لغو قبلی)', WB_(seq, 'rn'))]]));
    }
    if (active) Wiz_discard_(ctx, old);
  }
  if (Ai_anyEnabled_() && !ctx.auth.employee.ai_consent) {
    s.data_json.pre = prefill || null;
    s.step = 'W_CONSENT';
    var seq2 = Sess_nextSeq_(s);
    return Ui_reply_(ctx,
      '🤖 خوانش خودکار فاکتور و ویس با هوش مصنوعی فعال است.\n' +
      'در صورت موافقت، تصاویر مدارک و ویس‌های شما برای استخراج مبلغ و متن به سرویس Google Gemini ارسال می‌شود. ' +
      'طبق شرایط Free Tier ممکن است گوگل از این داده‌ها برای بهبود محصول استفاده کند.\n' +
      'بدون موافقت هم همه امکانات ربات با ورود دستی کار می‌کند.\n\nآیا موافقید؟',
      Kb_inline_([[Btn_('✅ موافقم', WB_(seq2, 'aiy')), Btn_('🚫 موافق نیستم (ورود دستی)', WB_(seq2, 'ain'))]]));
  }
  var req = Req_createDraft_(ctx);
  var d = Wiz_newDraft_(req.request_id);
  if (prefill) Free_applyPrefill_(ctx, d, prefill);
  s.data_json.d = d;
  delete s.data_json.pre;
  delete s.data_json.fx;
  if (s.data_json.pendingVoice) {
    Doc_save_(ctx, req, DOC_KIND.VOICE_NOTE, s.data_json.pendingVoice, null);
    delete s.data_json.pendingVoice;
  }
  Wiz_render_(ctx, prefill ? '✅ اطلاعات پیام شما در فرم قرار گرفت. لطفاً مراحل باقی‌مانده را تکمیل کنید.' : '');
}

/** کنار گذاشتن پیش‌نویس فعلی (درخواست جدید → لغو؛ اصلاح → فقط بستن فرم). */
function Wiz_discard_(ctx, d) {
  if (d.mode === 'NEW') Req_cancelByUser_(d.rid, ctx.tgId);
  Sess_clearDraft_(ctx.sess);
}

function Wiz_cancel_(ctx) {
  var d = ctx.sess.data_json.d;
  var msg;
  if (d.mode === 'CORRECTION') {
    msg = '↩️ فرم اصلاح بسته شد. درخواست <code>' + d.rid + '</code> همچنان در وضعیت «نیازمند اصلاح» است و از «📋 درخواست‌های من» قابل ادامه است.';
  } else {
    msg = '🚫 درخواست <code>' + d.rid + '</code> لغو شد. مدارک ارسال‌شده در پرونده بایگانی می‌مانند.';
  }
  Wiz_discard_(ctx, d);
  Ui_reply_(ctx, msg);
  Ui_send_(ctx, 'از منوی پایین می‌توانید درخواست جدید ثبت کنید.', Kb_mainMenu_(ctx.auth));
}

// ---------------------------------------------------------------------------
// نمایش مرحله
// ---------------------------------------------------------------------------

function Wiz_render_(ctx, notice) {
  var s = ctx.sess, d = s.data_json.d;
  var step = Wiz_resolve_(d);
  if (d.subFor !== step) { d.sub = null; d.subFor = step; }
  if (step === 'W_TOTAL' && !d.aiTried) {
    d.aiTried = true;
    Ai_analyzeDraftDocs_(ctx, d);
  }
  s.step = step;
  Req_syncDraft_(d);
  var seq = Sess_nextSeq_(s);
  var view = Wiz_view_(ctx, d, step, seq);
  var text = (notice ? notice + '\n\n' : '') + Wiz_header_(step, d) + '\n\n' + view.text;
  Ui_reply_(ctx, text, Kb_inline_(view.rows));
}

function Wiz_navRow_(seq, withBack) {
  return [withBack === false ? null : Btn_('⬅️ بازگشت', WB_(seq, 'back')), Btn_('❌ لغو', WB_(seq, 'cancel'))];
}

function Wiz_view_(ctx, d, step, seq) {
  if (d.sub === 'CONFIRM_CANCEL') {
    return {
      text: d.mode === 'CORRECTION' ? 'فرم اصلاح بسته شود؟ درخواست در وضعیت «نیازمند اصلاح» باقی می‌ماند.' :
        'آیا از لغو این درخواست مطمئن هستید؟ مدارک ارسالی در پرونده بایگانی می‌مانند.',
      rows: [[Btn_('بله، لغو شود', WB_(seq, 'cy')), Btn_('خیر، ادامه می‌دهم', WB_(seq, 'cn'))]]
    };
  }
  if (d.sub === 'VOICE_CONFIRM') {
    return {
      text: '🎙 متن ویس شما:\n«' + Utils_escapeHtml_(d.voice) + '»\n\nاگر درست است تأیید کنید؛ وگرنه متن صحیح را تایپ کنید.',
      rows: [[Btn_('✅ درست است', WB_(seq, 'vok')), Btn_('✍️ خودم تایپ می‌کنم', WB_(seq, 'vno'))]]
    };
  }
  var fn = WIZ_VIEWS_[step];
  return fn(ctx, d, seq);
}

var WIZ_VIEWS_ = {
  W_CHANNEL: function (ctx, d, seq) {
    return {
      text: 'غذا را چگونه تهیه کرده‌اید؟',
      rows: [[Btn_('📱 سفارش آنلاین', WB_(seq, 'ch', 'ONLINE')), Btn_('🏪 خرید حضوری', WB_(seq, 'ch', 'IN_PERSON'))], Wiz_navRow_(seq, false)]
    };
  },

  W_PAYMENT: function (ctx, d, seq) {
    var rows = [[Btn_('💳 بانکی/درگاه', WB_(seq, 'pm', 'BANK'))]];
    if (Settings_bool_('ALLOW_CREDIT_PAYMENTS')) rows[0].push(Btn_('🪙 اعتباری (اسنپ‌پی و مشابه)', WB_(seq, 'pm', 'CREDIT')));
    if (Settings_bool_('ALLOW_MIXED_PAYMENTS')) rows.push([Btn_('🔀 پرداخت ترکیبی / نیازمند بررسی', WB_(seq, 'pm', 'MIXED'))]);
    rows.push(Wiz_navRow_(seq));
    return { text: 'هزینه را چگونه پرداخت کرده‌اید؟', rows: rows };
  },

  W_PURCHASE_DOCS: function (ctx, d, seq) {
    var n = Doc_count_(d.rid, [DOC_KIND.PURCHASE]);
    var hint = d.channel === CHANNEL.ONLINE ?
      'اسکرین‌شات صفحه «جزئیات سفارش» (ترجیحاً مبلغ نهایی، تاریخ، شماره سفارش و اقلام دیده شود).' :
      'عکس واضح فاکتور یا رسید خرید رستوران (مبلغ و تاریخ خوانا باشد).';
    var rows = [];
    if (n > 0) rows.push([Btn_('✅ ثبت مدرک خرید (' + Utils_faDigits_(n) + ' تصویر)', WB_(seq, 'pd'))]);
    if (n > 0) rows.push([Btn_('🗑 حذف تصاویر این مرحله و ارسال دوباره', WB_(seq, 'pclr'))]);
    rows.push(Wiz_navRow_(seq));
    return {
      text: 'لطفاً تصویر فاکتور خرید را ارسال کنید.\n' + hint +
        '\n\nمی‌توانید چند تصویر بفرستید و برای هر کدام توضیح (کپشن) بنویسید.\n📎 تصاویر دریافت‌شده: ' + Utils_faDigits_(n) +
        (n > 0 ? '\nپس از ارسال همه تصاویر، دکمه «ثبت مدرک خرید» را بزنید.' : ''),
      rows: rows
    };
  },

  W_PAYMENT_DOCS: function (ctx, d, seq) {
    var n = Doc_count_(d.rid, PAYMENT_DOC_KINDS);
    var lines = {
      BANK: '• رسید پرداخت بانک/درگاه (مبلغ، تاریخ و وضعیت موفق تراکنش دیده شود).',
      CREDIT: '• اسکرین‌شات تراکنش واقعی استفاده از اعتبار (اسنپ‌پی یا مشابه) با مبلغ و تاریخ.\n⚠️ عکس موجودی اعتبار به‌تنهایی کافی نیست.',
      MIXED: '• رسید همه بخش‌های پرداخت (بانکی و اعتباری).\n⚠️ عکس موجودی اعتبار به‌تنهایی کافی نیست.'
    };
    var rows = [];
    if (n > 0) rows.push([Btn_('✅ ثبت مدرک پرداخت (' + Utils_faDigits_(n) + ' تصویر)', WB_(seq, 'yd'))]);
    if (n > 0) rows.push([Btn_('🗑 حذف تصاویر این مرحله و ارسال دوباره', WB_(seq, 'yclr'))]);
    if (Settings_bool_('ALLOW_COMBINED_EVIDENCE') && n === 0) rows.push([Btn_('📎 فاکتور خرید، اطلاعات پرداخت را هم دارد', WB_(seq, 'comb'))]);
    rows.push(Wiz_navRow_(seq));
    return {
      text: 'حالا مدرک پرداخت همین سفارش را بفرستید:\n' + lines[d.payment] +
        '\n\n📎 تصاویر دریافت‌شده: ' + Utils_faDigits_(n) + (n > 0 ? '\nپس از ارسال همه تصاویر، دکمه «ثبت مدرک پرداخت» را بزنید.' : ''),
      rows: rows
    };
  },

  W_DATE: function (ctx, d, seq) {
    if (d.sub === 'DATE_INPUT') {
      return {
        text: '📅 تاریخ سفارش را به شمسی بنویسید؛ مثلاً ' + Utils_faDigits_(Jal_isoToJalali_(Utils_isoAddDays_(Utils_todayIso_(), -2))),
        rows: [[Btn_('⬅️ بازگشت', WB_(seq, 'back'))]]
      };
    }
    var today = Utils_todayIso_(), yday = Utils_isoAddDays_(today, -1);
    return {
      text: 'سفارش/خرید مربوط به چه روزی است؟',
      rows: [
        [Btn_('امروز — ' + Jal_formatLong_(today).replace(/ \S+$/, ''), WB_(seq, 'dt', '0'))],
        [Btn_('دیروز — ' + Jal_formatLong_(yday).replace(/ \S+$/, ''), WB_(seq, 'dt', '1'))],
        [Btn_('📅 تاریخ دیگر', WB_(seq, 'dt', 'X'))],
        Wiz_navRow_(seq)
      ]
    };
  },

  W_PEOPLE: function (ctx, d, seq) {
    if (d.amb.length) {
      var a = d.amb[0];
      var rows = a.ids.slice(0, 8).map(function (id) {
        var e = Emp_byId_(id);
        return [Btn_(e ? e.full_name_fa + (e.department ? ' (' + e.department + ')' : '') : id, WB_(seq, 'amb', id))];
      });
      rows.push([Btn_('هیچ‌کدام', WB_(seq, 'amb', 'none'))]);
      return { text: '❓ منظور از «' + Utils_escapeHtml_(a.token) + '» کدام همکار است؟', rows: rows };
    }
    if (d.sub === 'PEOPLE_LIST') return Wiz_peopleListView_(d, seq);
    var cur = d.people.length ? '\n\n👥 افراد فعلی (' + Utils_faDigits_(d.people.length) + ' نفر): ' + Wiz_names_(d.people) : '';
    var voice = Ai_isEnabled_('voice') && ctx.auth.employee.ai_consent === 'YES' ? '\n🎙 یا یک ویس بفرستید.' : '';
    var rows2 = [];
    if (d.people.length) rows2.push([Btn_('✅ تأیید همین افراد', WB_(seq, 'pok'))]);
    rows2.push([Btn_('👥 انتخاب از فهرست کارکنان', WB_(seq, 'pl'))]);
    rows2.push(Wiz_navRow_(seq));
    return {
      text: 'این غذا برای چه کسانی خریداری شده است؟\n✍️ اسامی را تایپ کنید (مثلاً: خودم، محمد و رضا)' + voice +
        '\nیا از فهرست کارکنان انتخاب کنید.' + cur,
      rows: rows2
    };
  },

  W_PAYER: function (ctx, d, seq) {
    if (d.sub === 'PAYER_LIST') return Wiz_payerListView_(ctx, d, seq);
    var me = ctx.auth.employee;
    return {
      text: 'چه کسی کل فاکتور را پرداخت کرده است؟\n💡 کل مبلغ قابل بازپرداخت این سفارش یکجا به همین شخص پرداخت می‌شود.',
      rows: [
        [Btn_('👤 خودم (' + me.full_name_fa + ')', WB_(seq, 'py', 'self'))],
        [Btn_('👥 شخص دیگری', WB_(seq, 'pyl'))],
        Wiz_navRow_(seq)
      ]
    };
  },

  W_TOTAL: function (ctx, d, seq) {
    if (d.sub === 'UNIT') {
      var v = d.pend.v;
      return {
        text: 'مبلغ «' + Utils_formatNumberFa_(v) + '» را به چه واحدی نوشتید؟\n(برای جلوگیری از خطای ریال/تومان، واحد را مشخص کنید.)',
        rows: [
          [Btn_('ریال ← ' + Utils_formatRial_(v), WB_(seq, 'un', 'R'))],
          [Btn_('تومان ← ' + Utils_formatRial_(v * 10), WB_(seq, 'un', 'T'))],
          [Btn_('✍️ ورود دوباره', WB_(seq, 'unr'))]
        ]
      };
    }
    if (d.sub === 'AMOUNT_CHECK') {
      var r = Money_toRial_(d.pend.v, d.pend.u);
      return {
        text: '⚠️ مبلغ واردشده: <b>' + Utils_formatRial_(r) + '</b> (معادل ' + Utils_formatNumberFa_(r / 10) + ' تومان)\n' +
          'این مبلغ برای یک فاکتور ناهار غیرمعمول به نظر می‌رسد. آیا درست است؟',
        rows: [[Btn_('✅ بله، درست است', WB_(seq, 'ack')), Btn_('✍️ ورود دوباره', WB_(seq, 'unr'))]]
      };
    }
    var rows = [];
    (d.suggest || []).forEach(function (sg, i) {
      var label = sg.u ? Utils_formatRial_(Money_toRial_(sg.v, sg.u)) : Utils_formatNumberFa_(sg.v) + ' (واحد نامشخص)';
      rows.push([Btn_((sg.src === 'AI' ? '🤖 ' : '📝 ') + label + (sg.src === 'AI' ? ' — از تصویر فاکتور' : ' — از پیام شما'), WB_(seq, 'sug', String(i)))]);
    });
    rows.push(Wiz_navRow_(seq));
    var policy = Settings_nonEligibleItems_().length ? '' : ' (شامل هزینه ارسال/بسته‌بندی/مالیات)';
    return {
      text: 'مبلغ نهایی فاکتور را بنویسید: مبلغی که واقعاً پرداخت شده، بعد از تخفیف' + policy + '.\n' +
        'واحد را هم بنویسید؛ مثلاً «۱٬۲۶۰٬۰۰۰ تومان» یا «۱۲٬۶۰۰٬۰۰۰ ریال».' +
        ((d.suggest || []).length ? '\n\n' + ((d.suggest[0].src === 'AI') ? '🤖 مقدار پیشنهادی صرفاً استخراج خودکار است و باید آن را بررسی کنید.' : '📝 مقدار پیشنهادی از پیام شما برداشت شده است.') : ''),
      rows: rows
    };
  },

  W_NONELIG: function (ctx, d, seq) {
    var items = Settings_nonEligibleItems_();
    return {
      text: 'طبق سیاست بازپرداخت، این موارد قابل بازپرداخت نیستند: ' + items.join('، ') + '.\n' +
        'اگر فاکتور (' + Utils_formatRial_(d.total) + ') شامل این موارد بوده، مجموع مبلغ آن‌ها را بنویسید.',
      rows: [[Btn_('نداشت (صفر)', WB_(seq, 'ne0'))], Wiz_navRow_(seq)]
    };
  },

  W_SPLIT: function (ctx, d, seq) {
    var eligible = Wiz_eligible_(d), n = d.people.length;
    var rows = [];
    if (Settings_bool_('ALLOW_EQUAL_SPLIT')) {
      rows.push([Btn_('✅ بله؛ سهم مساوی (هر نفر ≈ ' + Utils_formatNumberFa_(Math.floor(eligible / n)) + ')', WB_(seq, 'sp', 'E'))]);
    }
    rows.push([Btn_('✍️ خیر؛ ثبت سهم تک‌تک افراد', WB_(seq, 'sp', 'I'))]);
    rows.push(Wiz_navRow_(seq));
    return {
      text: 'آیا سهم هزینه همه افراد برابر بوده است؟\nمبلغ واجد شرایط: ' + Utils_formatRial_(eligible) + ' برای ' + Utils_faDigits_(n) + ' نفر',
      rows: rows
    };
  },

  W_SHARE: function (ctx, d, seq) {
    var eligible = Wiz_eligible_(d), sum = Wiz_sharesSum_(d);
    var listed = d.people.filter(function (id) { return d.shares[id] !== undefined; }).map(function (id) {
      return '• ' + Utils_escapeHtml_(Emp_name_(id)) + ': ' + Utils_formatRial_(d.shares[id]);
    }).join('\n');
    if (Wiz_sharesComplete_(d)) {
      var diff = eligible - sum;
      return {
        text: listed + '\n\n⚠️ جمع سهم‌ها (' + Utils_formatRial_(sum) + ') با مبلغ واجد شرایط (' + Utils_formatRial_(eligible) +
          ') برابر نیست. اختلاف: ' + Utils_formatRial_(Math.abs(diff)) + (diff > 0 ? ' (مثلاً هزینه ارسال)' : ' (مثلاً تخفیف)') + '\nچه کنیم؟',
        rows: [
          [Btn_('⚖️ توزیع اختلاف به‌نسبت سهم‌ها', WB_(seq, 'rb'))],
          [Btn_('🧾 مبلغ فاکتور = جمع سهم‌ها', WB_(seq, 'st'))],
          [Btn_('✍️ ورود دوباره سهم‌ها', WB_(seq, 'sr'))],
          [Btn_('⬅️ بازگشت', WB_(seq, 'back'))]
        ]
      };
    }
    var next = d.people.filter(function (id) { return d.shares[id] === undefined; });
    var k = d.people.length - next.length + 1;
    var rows = [];
    var remaining = eligible - sum;
    if (next.length === 1 && remaining > 0) rows.push([Btn_('باقی‌مانده: ' + Utils_formatRial_(remaining), WB_(seq, 'srem'))]);
    rows.push(Wiz_navRow_(seq));
    return {
      text: (listed ? listed + '\n\n' : '') + 'سهم «<b>' + Utils_escapeHtml_(Emp_name_(next[0])) + '</b>» از این سفارش چقدر بوده است؟ (' +
        Utils_faDigits_(k) + ' از ' + Utils_faDigits_(d.people.length) + ')\nمبلغ واجد شرایط کل: ' + Utils_formatRial_(eligible) +
        (d.unitPref === 'TOMAN' ? '\n💡 اگر واحد ننویسید، مثل مبلغ کل «تومان» در نظر گرفته می‌شود.' : ''),
      rows: rows
    };
  },

  W_MERCHANT: function (ctx, d, seq) {
    return {
      text: '(اختیاری) نام رستوران/فروشگاه و شماره سفارش یا فاکتور را بنویسید.\nمثال: «رستوران نمونه — سفارش ۱۲۳۴۵۶۷»',
      rows: [[Btn_('⏭ رد شدن', WB_(seq, 'mskip'))], Wiz_navRow_(seq)]
    };
  },

  W_SUMMARY: function (ctx, d, seq) {
    if (d.sub === 'EDIT_MENU') {
      return {
        text: 'کدام بخش را اصلاح می‌کنید؟',
        rows: [
          [Btn_('روش خرید', WB_(seq, 'e', 'ch')), Btn_('روش پرداخت', WB_(seq, 'e', 'pm'))],
          [Btn_('مدارک خرید', WB_(seq, 'e', 'pd')), Btn_('مدارک پرداخت', WB_(seq, 'e', 'yd'))],
          [Btn_('تاریخ', WB_(seq, 'e', 'dt')), Btn_('افراد', WB_(seq, 'e', 'pp'))],
          [Btn_('پرداخت‌کننده', WB_(seq, 'e', 'py')), Btn_('مبلغ و سهم‌ها', WB_(seq, 'e', 'am'))],
          [Btn_('مشخصات سفارش', WB_(seq, 'e', 'mr'))],
          [Btn_('⬅️ بازگشت به خلاصه', WB_(seq, 'e', 'x'))]
        ]
      };
    }
    return {
      text: Wiz_summaryText_(ctx, d),
      rows: [
        [Btn_(d.mode === 'CORRECTION' ? '✅ ارسال مجدد برای بررسی' : '✅ تأیید و ثبت', WB_(seq, 'submit'))],
        [Btn_('✏️ اصلاح', WB_(seq, 'edit')), Btn_('❌ لغو', WB_(seq, 'cancel'))]
      ]
    };
  }
};

function Wiz_peopleListView_(d, seq) {
  var emps = Emp_active_();
  var per = 10, pages = Math.max(1, Math.ceil(emps.length / per));
  var page = Math.min(Math.max(0, d.page || 0), pages - 1);
  var slice = emps.slice(page * per, page * per + per);
  var rows = Utils_chunk_(slice.map(function (e) {
    var on = d.people.indexOf(e.employee_id) >= 0;
    return Btn_((on ? '✅ ' : '▫️ ') + e.full_name_fa, WB_(seq, 'pt', e.employee_id));
  }), 2);
  if (pages > 1) {
    rows.push([
      page > 0 ? Btn_('◀️ قبلی', WB_(seq, 'pp', String(page - 1))) : null,
      Btn_(Utils_faDigits_(page + 1) + '/' + Utils_faDigits_(pages), WB_(seq, 'noop')),
      page < pages - 1 ? Btn_('بعدی ▶️', WB_(seq, 'pp', String(page + 1))) : null
    ]);
  }
  rows.push([Btn_('✅ تأیید انتخاب (' + Utils_faDigits_(d.people.length) + ' نفر)', WB_(seq, 'pok'))]);
  rows.push([Btn_('⬅️ بازگشت', WB_(seq, 'back'))]);
  return { text: 'افرادی را که از این غذا خورده‌اند انتخاب کنید (با هر لمس، انتخاب/لغو انتخاب می‌شود):', rows: rows };
}

function Wiz_payerListView_(ctx, d, seq) {
  var me = ctx.auth.employee.employee_id;
  var emps = Emp_active_().filter(function (e) { return e.employee_id !== me; });
  emps.sort(function (a, b) { return (d.people.indexOf(b.employee_id) >= 0) - (d.people.indexOf(a.employee_id) >= 0); });
  var per = 10, pages = Math.max(1, Math.ceil(emps.length / per));
  var page = Math.min(Math.max(0, d.page || 0), pages - 1);
  var rows = Utils_chunk_(emps.slice(page * per, page * per + per).map(function (e) {
    return Btn_(e.full_name_fa, WB_(seq, 'py', e.employee_id));
  }), 2);
  if (pages > 1) {
    rows.push([
      page > 0 ? Btn_('◀️ قبلی', WB_(seq, 'pp', String(page - 1))) : null,
      page < pages - 1 ? Btn_('بعدی ▶️', WB_(seq, 'pp', String(page + 1))) : null
    ]);
  }
  rows.push([Btn_('⬅️ بازگشت', WB_(seq, 'back'))]);
  return { text: 'چه کسی کل مبلغ را پرداخت کرده است؟\n⚠️ اگر پرداخت‌کننده شخص دیگری است، ادمین هویت را بررسی می‌کند.', rows: rows };
}

function Wiz_summaryText_(ctx, d) {
  var costs = Req_draftCosts_(d);
  var est = Req_estimate_(d.date, costs, d.rid);
  var pCount = Doc_count_(d.rid, [DOC_KIND.PURCHASE]);
  var yCount = Doc_count_(d.rid, PAYMENT_DOC_KINDS);
  var lines = [];
  lines.push('خرید: ' + CHANNEL_FA[d.channel]);
  lines.push('پرداخت: ' + PAY_METHOD_FA[d.payment]);
  lines.push('تاریخ سفارش: ' + Jal_formatLong_(d.date));
  lines.push('پرداخت‌کننده (دریافت‌کننده وجه): <b>' + Utils_escapeHtml_(Emp_name_(d.payerId)) + '</b>');
  lines.push('افراد (' + Utils_faDigits_(d.people.length) + ' نفر): ' + Wiz_names_(d.people));
  lines.push('مبلغ فاکتور: ' + Utils_formatRial_(d.total));
  if (d.nonElig) lines.push('غیرقابل بازپرداخت: ' + Utils_formatRial_(d.nonElig) + ' ← واجد شرایط: ' + Utils_formatRial_(Wiz_eligible_(d)));
  if (d.people.length > 1) lines.push('تقسیم هزینه: ' + (d.split === SPLIT.EQUAL ? 'مساوی' : 'سهم جداگانه' + (d.rebalanced ? ' (اختلاف به‌نسبت توزیع شد)' : '')));
  lines.push('');
  lines.push('سهم و سقف هر نفر (سقف روزانه ' + Utils_formatRial_(est.cap) + '):');
  est.lines.forEach(function (l) {
    var warn = est.pendingOthers[l.employee_id] ? ' ⏳' : '';
    lines.push('• ' + Utils_escapeHtml_(Emp_name_(l.employee_id)) + ': سهم ' + Utils_formatNumberFa_(l.actual_cost_rial) +
      ' | مانده سقف ' + Utils_formatNumberFa_(l.remaining_cap_before_rial) + ' ← مجاز ' + Utils_formatNumberFa_(l.approved_allocation_rial) + warn);
  });
  lines.push('');
  lines.push('💰 <b>مبلغ پیشنهادی بازپرداخت: ' + Utils_formatRial_(est.total_rial) + '</b>');
  lines.push('(تخمینی است؛ مبلغ نهایی هنگام تأیید ادمین با توجه به سایر تأییدهای همان روز محاسبه می‌شود.)');
  if (Object.keys(est.pendingOthers).length) lines.push('⏳ برای برخی افراد درخواست دیگری هم در انتظار بررسی است؛ ممکن است مبلغ نهایی کمتر شود.');
  lines.push('');
  lines.push('مدارک: فاکتور ' + (pCount ? '✅ (' + Utils_faDigits_(pCount) + ')' : '❌') + ' / رسید پرداخت ' +
    (yCount ? '✅ (' + Utils_faDigits_(yCount) + ')' : (d.combined ? '📎 در همان فاکتور' : '❌')));
  if (d.merchant || d.orderNo) lines.push('رستوران/سفارش: ' + Utils_escapeHtml_([d.merchant, d.orderNo ? 'شماره ' + Utils_faDigits_(d.orderNo) : ''].filter(Boolean).join(' — ')));
  if (d.payerId !== ctx.auth.employee.employee_id) lines.push('⚠️ پرداخت‌کننده شخص دیگری است؛ ادمین هویت را بررسی می‌کند.');
  if (d.payment === PAY_METHOD.CREDIT) lines.push('⚠️ پرداخت اعتباری طبق سیاست نیازمند تأیید صریح ادمین است.');
  (d.aiFlags || []).forEach(function (f) { if (FLAG_FA[f]) lines.push('🤖 ' + FLAG_FA[f]); });
  lines.push('وضعیت پس از ثبت: در انتظار بررسی ادمین');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// ورودی‌ها
// ---------------------------------------------------------------------------

function Wiz_onCallback_(ctx, seq, act, arg) {
  var s = ctx.sess, d = s.data_json.d;
  if (Number(seq) !== Number(s.seq)) return Ui_toast_(ctx, 'این دکمه مربوط به پیام قدیمی است؛ لطفاً از آخرین پیام ربات استفاده کنید.', true);
  if (act === 'aiy' || act === 'ain') return Wiz_onConsent_(ctx, act === 'aiy');
  if (!d) {
    s.step = 'IDLE';
    return Ui_toast_(ctx, 'این فرم دیگر فعال نیست؛ از «➕ ثبت هزینه ناهار» شروع کنید.', true);
  }
  if (act === 'rs') return Wiz_render_(ctx);
  if (act === 'rn') { Wiz_discard_(ctx, d); return Wiz_start_(ctx); }
  if (act === 'noop') return Ui_toast_(ctx, '');
  var step = Wiz_resolve_(d);
  var rid = d.rid;

  switch (act) {
    case 'ch':
      if (!CHANNEL[arg]) break;
      if (d.channel && d.channel !== arg) d.purchaseDone = false;
      d.channel = arg;
      break;
    case 'pm':
      if (!PAY_METHOD[arg]) break;
      if (arg === 'CREDIT' && !Settings_bool_('ALLOW_CREDIT_PAYMENTS')) return Ui_toast_(ctx, 'پرداخت اعتباری طبق سیاست فعلی پذیرفته نمی‌شود.', true);
      if (arg === 'MIXED' && !Settings_bool_('ALLOW_MIXED_PAYMENTS')) return Ui_toast_(ctx, 'پرداخت ترکیبی طبق سیاست فعلی پذیرفته نمی‌شود.', true);
      if (d.payment && d.payment !== arg) { Doc_relabelPayment_(rid, Doc_paymentKindFor_(arg), ctx.tgId); d.paymentDone = false; }
      d.payment = arg;
      break;
    case 'pd':
      if (!Doc_count_(rid, [DOC_KIND.PURCHASE])) return Ui_toast_(ctx, 'حداقل یک تصویر مدرک خرید لازم است.', true);
      d.purchaseDone = true;
      break;
    case 'pclr':
      Doc_removeKinds_(rid, [DOC_KIND.PURCHASE], ctx.tgId);
      d.aiTried = false;
      break;
    case 'yd':
      if (!Doc_count_(rid, PAYMENT_DOC_KINDS)) return Ui_toast_(ctx, 'مدرک پرداخت الزامی است.', true);
      d.paymentDone = true;
      break;
    case 'yclr':
      Doc_removeKinds_(rid, PAYMENT_DOC_KINDS, ctx.tgId);
      d.aiTried = false;
      break;
    case 'comb':
      if (!Settings_bool_('ALLOW_COMBINED_EVIDENCE')) return Ui_toast_(ctx, 'طبق سیاست، مدرک پرداخت مستقل لازم است.', true);
      d.combined = true;
      d.paymentDone = true;
      break;
    case 'dt':
      if (arg === 'X') { Wiz_setSub_(d, 'DATE_INPUT'); break; }
      d.date = Utils_isoAddDays_(Utils_todayIso_(), arg === '1' ? -1 : 0);
      break;
    case 'pl':
      if (!d.people.length) d.people = [ctx.auth.employee.employee_id];
      d.page = 0;
      Wiz_setSub_(d, 'PEOPLE_LIST');
      break;
    case 'pt':
      var e = Emp_byId_(arg);
      if (!e || !e.active) return Ui_toast_(ctx, 'این فرد در فهرست کارکنان فعال نیست.', true);
      var idx = d.people.indexOf(arg);
      if (idx >= 0) d.people.splice(idx, 1); else d.people.push(arg);
      break;
    case 'pp':
      d.page = Number(arg) || 0;
      break;
    case 'pok':
      if (!d.people.length) return Ui_toast_(ctx, 'حداقل یک نفر را انتخاب کنید.', true);
      var sig = d.people.slice().sort().join(',');
      if (d.peopleSig && d.peopleSig !== sig) { d.split = null; d.shares = {}; d.rebalanced = false; }
      d.peopleSig = sig;
      d.peopleDone = true;
      d.sub = null;
      break;
    case 'amb':
      var a = d.amb.shift();
      if (a && arg !== 'none' && a.ids.indexOf(arg) >= 0 && d.people.indexOf(arg) < 0) d.people.push(arg);
      break;
    case 'py':
      if (arg === 'self') d.payerId = ctx.auth.employee.employee_id;
      else {
        var pe = Emp_byId_(arg);
        if (!pe || !pe.active) return Ui_toast_(ctx, 'این فرد در فهرست کارکنان فعال نیست.', true);
        d.payerId = arg;
      }
      d.payerDone = true;
      break;
    case 'pyl':
      d.page = 0;
      Wiz_setSub_(d, 'PAYER_LIST');
      break;
    case 'un':
      if (!d.pend) break;
      d.pend.u = arg === 'T' ? 'TOMAN' : 'RIAL';
      return Wiz_applyPending_(ctx, d, false);
    case 'ack':
      if (!d.pend) break;
      return Wiz_applyPending_(ctx, d, true);
    case 'unr':
      d.pend = null;
      d.sub = null;
      break;
    case 'sug':
      var sg = (d.suggest || [])[Number(arg)];
      if (!sg) break;
      return Wiz_amountInput_(ctx, d, 'TOTAL', { ok: true, value: sg.v, unit: sg.u }, null);
    case 'ne0':
      d.nonElig = 0;
      d.nonEligDone = true;
      break;
    case 'sp':
      if (arg === 'E' && !Settings_bool_('ALLOW_EQUAL_SPLIT')) return Ui_toast_(ctx, 'تقسیم مساوی طبق سیاست فعلی مجاز نیست.', true);
      d.split = arg === 'E' ? SPLIT.EQUAL : SPLIT.INDIVIDUAL;
      d.shares = {};
      d.rebalanced = false;
      break;
    case 'srem':
      var left = d.people.filter(function (id) { return d.shares[id] === undefined; });
      var rem = Wiz_eligible_(d) - Wiz_sharesSum_(d);
      if (left.length === 1 && rem > 0) d.shares[left[0]] = rem;
      break;
    case 'rb':
      if (!Wiz_sharesComplete_(d)) break;
      d.shares = Fin_rebalanceShares_(d.people, d.shares, Wiz_eligible_(d));
      d.rebalanced = true;
      break;
    case 'st':
      if (!Wiz_sharesComplete_(d)) break;
      d.total = Wiz_sharesSum_(d) + (d.nonElig || 0);
      break;
    case 'sr':
      d.shares = {};
      d.rebalanced = false;
      break;
    case 'mskip':
      d.merchantDone = true;
      break;
    case 'submit':
      if (step !== 'W_SUMMARY') break;
      return Wiz_submit_(ctx);
    case 'edit':
      if (step === 'W_SUMMARY') Wiz_setSub_(d, 'EDIT_MENU');
      break;
    case 'e':
      Wiz_applyEdit_(d, arg);
      break;
    case 'back':
      if (d.sub && d.sub !== 'CONFIRM_CANCEL') { d.sub = null; break; }
      Wiz_back_(d, step);
      break;
    case 'cancel':
      Wiz_setSub_(d, 'CONFIRM_CANCEL');
      break;
    case 'cy':
      return Wiz_cancel_(ctx);
    case 'cn':
      d.sub = null;
      break;
    case 'vok':
      var t = d.voice;
      d.voice = null;
      d.sub = null;
      d.aiVoiceUsed = true;
      return Wiz_onText_(ctx, t || '');
    case 'vno':
      d.voice = null;
      d.sub = null;
      break;
  }
  Wiz_render_(ctx);
}

function Wiz_applyEdit_(d, what) {
  d.sub = null;
  switch (what) {
    case 'ch': d.channel = null; d.purchaseDone = false; break;
    case 'pm': d.payment = null; d.paymentDone = false; d.combined = false; break;
    case 'pd': d.purchaseDone = false; d.aiTried = false; break;
    case 'yd': d.paymentDone = false; d.combined = false; d.aiTried = false; break;
    case 'dt': d.date = null; break;
    case 'pp': d.peopleDone = false; break;
    case 'py': d.payerDone = false; break;
    case 'am': d.total = null; d.split = null; d.shares = {}; d.nonEligDone = false; d.nonElig = 0; d.rebalanced = false; break;
    case 'mr': d.merchantDone = false; break;
  }
}

function Wiz_onConsent_(ctx, yes) {
  var emp = ctx.auth.employee;
  Emp_update_(emp, { ai_consent: yes ? 'YES' : 'NO' }, ctx.tgId, 'AI_CONSENT_' + (yes ? 'GIVEN' : 'DECLINED'));
  var pre = ctx.sess.data_json.pre || null;
  delete ctx.sess.data_json.pre;
  Ui_reply_(ctx, yes ? '✅ موافقت شما ثبت شد.' : '✅ ثبت شد؛ برای شما فقط ورود دستی استفاده می‌شود.');
  ctx.forceNew = true;
  Wiz_start_(ctx, pre);
}

function Wiz_onText_(ctx, text) {
  var d = ctx.sess.data_json.d;
  var step = Wiz_resolve_(d);
  if (d.sub === 'CONFIRM_CANCEL' || d.sub === 'EDIT_MENU' || d.sub === 'VOICE_CONFIRM') d.sub = null;

  if (step === 'W_DATE') {
    var iso = Jal_parseUserDate_(text);
    if (!iso) { Wiz_setSub_(d, 'DATE_INPUT'); return Wiz_render_(ctx, '⚠️ تاریخ قابل تشخیص نیست. نمونه درست: ۱۴۰۵/۰۸/۰۷'); }
    var today = Utils_todayIso_();
    if (iso > today) { Wiz_setSub_(d, 'DATE_INPUT'); return Wiz_render_(ctx, '⚠️ تاریخ سفارش نمی‌تواند در آینده باشد.'); }
    if (Utils_isoDiffDays_(iso, today) > Settings_int_('MAX_CLAIM_AGE_DAYS')) {
      Wiz_setSub_(d, 'DATE_INPUT');
      return Wiz_render_(ctx, '⚠️ طبق سیاست، فقط سفارش‌های ' + Utils_faDigits_(Settings_int_('MAX_CLAIM_AGE_DAYS')) + ' روز اخیر قابل ثبت‌اند.');
    }
    d.date = iso;
    return Wiz_render_(ctx, '✅ تاریخ: ' + Jal_formatLong_(iso));
  }

  if (step === 'W_PEOPLE') {
    var r = Names_resolveList_(text, Emp_active_(), ctx.auth.employee);
    var notice = [];
    if (!r.resolved.length && !r.ambiguous.length) {
      return Wiz_render_(ctx, '⚠️ هیچ نامی در فهرست کارکنان پیدا نشد' + (r.unknown.length ? ': ' + Utils_escapeHtml_(r.unknown.join('، ')) : '') + '. می‌توانید از «انتخاب از فهرست» استفاده کنید.');
    }
    d.people = r.resolved.map(function (e) { return e.employee_id; });
    d.amb = r.ambiguous.map(function (a) { return { token: a.token, ids: a.candidates.map(function (e) { return e.employee_id; }) }; });
    d.sub = null;
    if (r.unknown.length) notice.push('⚠️ این نام‌ها در فهرست کارکنان پیدا نشدند و ثبت نشدند: ' + Utils_escapeHtml_(r.unknown.join('، ')) + '\nفقط افراد فهرست رسمی قابل ثبت‌اند.');
    return Wiz_render_(ctx, notice.join('\n'));
  }

  if (step === 'W_PAYER') {
    var m = Names_matchOne_(text, Emp_active_());
    if (m.type === 'SELF') d.payerId = ctx.auth.employee.employee_id;
    else if (m.type === 'MATCH') d.payerId = m.employee.employee_id;
    else return Wiz_render_(ctx, m.type === 'AMBIGUOUS' ? '⚠️ نام مبهم است؛ لطفاً از فهرست انتخاب کنید.' : '⚠️ این نام در فهرست کارکنان نیست؛ از دکمه‌ها استفاده کنید.');
    d.payerDone = true;
    return Wiz_render_(ctx);
  }

  if (step === 'W_TOTAL') return Wiz_amountInput_(ctx, d, 'TOTAL', Money_parseAmount_(text), null);
  if (step === 'W_NONELIG') return Wiz_amountInput_(ctx, d, 'NONELIG', Money_parseAmount_(text), null);
  if (step === 'W_SHARE') {
    if (Wiz_sharesComplete_(d)) return Wiz_render_(ctx, 'لطفاً یکی از گزینه‌ها را انتخاب کنید.');
    var nextId = d.people.filter(function (id) { return d.shares[id] === undefined; })[0];
    return Wiz_amountInput_(ctx, d, 'SHARE', Money_parseAmount_(text), nextId);
  }

  if (step === 'W_MERCHANT') {
    var norm = Utils_normalizeDigits_(text);
    var num = norm.match(/\d{4,}/);
    d.orderNo = num ? num[0] : '';
    d.merchant = Utils_truncate_(norm.replace(num ? num[0] : '', '').replace(/(شماره\s*)?(سفارش|فاکتور|رسید)\s*[:：]?/g, '').replace(/[\s\-—:،,]+$/g, '').replace(/^[\s\-—:،,]+/g, '').trim(), 100);
    d.merchantDone = true;
    return Wiz_render_(ctx);
  }

  if (step === 'W_PURCHASE_DOCS' || step === 'W_PAYMENT_DOCS') {
    return Wiz_render_(ctx, '📎 در این مرحله لطفاً «تصویر» بفرستید. برای توضیح، متن را به‌صورت کپشن همراه عکس بنویسید.');
  }
  Wiz_render_(ctx, 'لطفاً از دکمه‌های زیر استفاده کنید.');
}

/** ورودی مبلغ: اگر واحد مشخص نیست پرسیده می‌شود؛ هیچ تبدیلی بدون واحد قطعی انجام نمی‌شود. */
function Wiz_amountInput_(ctx, d, purpose, parsed, empId) {
  if (!parsed.ok) return Wiz_render_(ctx, '⚠️ ' + Money_errorFa_(parsed.error));
  var unit = parsed.unit, fromPref = false;
  if (!unit && purpose !== 'TOTAL' && d.unitPref) { unit = d.unitPref; fromPref = true; }
  d.pend = { v: parsed.value, u: unit, p: purpose, e: empId || null, pref: fromPref };
  if (!unit) { Wiz_setSub_(d, 'UNIT'); return Wiz_render_(ctx); }
  Wiz_applyPending_(ctx, d, false);
}

function Wiz_applyPending_(ctx, d, acknowledged) {
  var p = d.pend;
  var rial = Money_toRial_(p.v, p.u);
  if (p.p === 'TOTAL' && !acknowledged && (rial < Settings_int_('LOW_AMOUNT_WARNING_RIAL') || rial > Settings_int_('HIGH_AMOUNT_WARNING_RIAL'))) {
    Wiz_setSub_(d, 'AMOUNT_CHECK');
    return Wiz_render_(ctx);
  }
  var note = p.u === 'TOMAN' ? ' (' + Money_formatInUnit_(p.v, 'TOMAN') + (p.pref ? '، واحد طبق انتخاب قبلی' : '') + ')' : '';
  var notice;
  if (p.p === 'TOTAL') {
    d.total = rial;
    d.unitPref = p.u;
    if (d.nonElig >= rial) { d.nonElig = 0; d.nonEligDone = false; }
    notice = '✅ مبلغ فاکتور: ' + Utils_formatRial_(rial) + note;
  } else if (p.p === 'NONELIG') {
    if (rial >= d.total) { d.pend = null; d.sub = null; return Wiz_render_(ctx, '⚠️ مبلغ غیرقابل بازپرداخت باید کمتر از مبلغ فاکتور باشد.'); }
    d.nonElig = rial;
    d.nonEligDone = true;
    notice = '✅ مبلغ غیرقابل بازپرداخت: ' + Utils_formatRial_(rial) + note;
  } else {
    d.shares[p.e] = rial;
    notice = '✅ سهم ' + Utils_escapeHtml_(Emp_name_(p.e)) + ': ' + Utils_formatRial_(rial) + note;
  }
  d.pend = null;
  d.sub = null;
  Wiz_render_(ctx, notice);
}

/** فایل (عکس/PDF/ویس) در حین فرم. */
function Wiz_onFile_(ctx, info, prefetched) {
  var d = ctx.sess.data_json.d;
  var step = Wiz_resolve_(d);
  var req = Req_get_(d.rid);
  if (info.media === 'voice') return Wiz_onVoice_(ctx, d, req, info, prefetched);
  if (step !== 'W_PURCHASE_DOCS' && step !== 'W_PAYMENT_DOCS') {
    return Wiz_render_(ctx, '📎 در این مرحله تصویر لازم نیست. برای تغییر مدارک، در مرحله بازبینی از «✏️ اصلاح» استفاده کنید.');
  }
  var kind = step === 'W_PURCHASE_DOCS' ? DOC_KIND.PURCHASE : Doc_paymentKindFor_(d.payment);
  var kinds = step === 'W_PURCHASE_DOCS' ? [DOC_KIND.PURCHASE] : PAYMENT_DOC_KINDS;
  if (Doc_count_(d.rid, kinds) >= Settings_int_('MAX_FILES_PER_STEP')) {
    return Wiz_render_(ctx, '⚠️ حداکثر تعداد تصویر این مرحله ارسال شده است.');
  }
  var res = Doc_save_(ctx, req, kind, info, prefetched);
  if (!res.ok) return Wiz_render_(ctx, '⚠️ ' + Doc_errorFa_(res.error));
  d.aiTried = false;
  var n = Doc_count_(d.rid, kinds);
  Wiz_render_(ctx, ['✅ تصویر ' + Utils_faDigits_(n) + ' دریافت شد.'].concat(res.warnings).join('\n'));
}

function Wiz_onVoice_(ctx, d, req, info, prefetched) {
  Doc_save_(ctx, req, DOC_KIND.VOICE_NOTE, info, prefetched);
  var textSteps = ['W_PEOPLE', 'W_TOTAL', 'W_NONELIG', 'W_SHARE', 'W_MERCHANT', 'W_DATE', 'W_PAYER'];
  var step = Wiz_resolve_(d);
  if (textSteps.indexOf(step) < 0 || !Ai_isEnabled_('voice') || ctx.auth.employee.ai_consent !== 'YES') {
    return Wiz_render_(ctx, '🎙 ویس دریافت شد و برای بررسی ادمین در پرونده ماند؛ لطفاً جزئیات را به‌صورت متنی یا با دکمه‌ها وارد کنید.');
  }
  var tr = Ai_transcribe_(info, prefetched);
  if (!tr.ok) return Wiz_render_(ctx, '🎙 ' + Ai_fallbackMessage_(tr.error));
  d.voice = tr.text;
  Wiz_setSub_(d, 'VOICE_CONFIRM');
  Wiz_render_(ctx);
}

function Wiz_submit_(ctx) {
  var d = ctx.sess.data_json.d;
  var res = Req_submit_(ctx, d);
  if (!res.ok) {
    if (res.error === 'MISSING_PURCHASE_DOC') { d.purchaseDone = false; return Wiz_render_(ctx, '⚠️ مدرک خرید پیدا نشد؛ لطفاً دوباره ارسال کنید.'); }
    if (res.error === 'MISSING_PAYMENT_DOC') { d.paymentDone = false; return Wiz_render_(ctx, '⚠️ مدرک پرداخت پیدا نشد؛ لطفاً دوباره ارسال کنید.'); }
    Sess_clearDraft_(ctx.sess);
    return Ui_reply_(ctx, '⚠️ این درخواست دیگر قابل ثبت نیست (وضعیت: ' + (STATUS_FA[res.status] || res.error) + ').');
  }
  Sess_clearDraft_(ctx.sess);
  ctx.requestId = d.rid;
  Ui_reply_(ctx,
    '✅ درخواست شما با کد پیگیری <code>' + d.rid + '</code> ' + (d.mode === 'CORRECTION' ? 'دوباره برای بررسی ارسال شد.' : 'ثبت شد.') +
    '\nمبلغ پیشنهادی (تخمینی): ' + Utils_formatRial_(res.estimate.total_rial) +
    '\nوضعیت: در انتظار بررسی ادمین مالی. نتیجه را از همین ربات به شما اطلاع می‌دهیم.');
  Adm_notifyNewRequest_(d.rid, d.mode === 'CORRECTION');
}
