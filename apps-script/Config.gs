/**
 * Config.gs — ثابت‌ها، ساختار شیت‌ها، وضعیت‌ها، نقش‌ها و تنظیمات پیش‌فرض.
 *
 * همه مبالغ مالی در این پروژه «ریال» و عدد صحیح‌اند (ستون‌های *_rial).
 * توکن ربات، کلید AI و شناسه‌های محرمانه اینجا نیستند؛ فقط در Script Properties.
 */

var APP = {
  NAME: 'LunchBot',
  VERSION: '1.0.0',
  TZ: 'Asia/Tehran',
  LOCK_WAIT_MS: 45000,
  TELEGRAM_MAX_DOWNLOAD_MB: 20,
  MAX_MESSAGE_CHARS: 3900
};

/** کلیدهای Script Properties (محرمانه یا شناسه‌های داخلی). */
var PROP = {
  BOT_TOKEN: 'BOT_TOKEN',
  OWNER_TELEGRAM_IDS: 'OWNER_TELEGRAM_IDS',
  WEBHOOK_SECRET: 'WEBHOOK_SECRET',
  WEB_APP_URL: 'WEB_APP_URL',
  SPREADSHEET_ID: 'SPREADSHEET_ID',
  ROOT_FOLDER_ID: 'ROOT_FOLDER_ID',
  DOCS_FOLDER_ID: 'DOCS_FOLDER_ID',
  REPORTS_FOLDER_ID: 'REPORTS_FOLDER_ID',
  BOT_USERNAME: 'BOT_USERNAME',
  GEMINI_API_KEY: 'GEMINI_API_KEY',
  UPDATE_MODE: 'UPDATE_MODE',          // WEBHOOK | POLLING
  POLL_OFFSET: 'POLL_OFFSET'
};

var SHEETS = {
  EMPLOYEES: 'Employees',
  JOIN_REQUESTS: 'JoinRequests',
  REQUESTS: 'Requests',
  BENEFICIARIES: 'RequestBeneficiaries',
  DOCUMENTS: 'Documents',
  PAYMENTS: 'Payments',
  AUDIT: 'AuditLog',
  UPDATES: 'ProcessedUpdates',
  SESSIONS: 'Sessions',
  SETTINGS: 'Settings',
  CAP_SCHEDULE: 'CapSchedule',
  REPORTS: 'ReportsArchive'
};

/**
 * ساختار ستون‌ها. نوع‌ها: str | int | bool | json
 * str/json/bool با فرمت متنی (@) ذخیره می‌شوند تا Sheets آن‌ها را به تاریخ/عدد تبدیل نکند.
 */
var SCHEMA = {
  Employees: [
    ['employee_id', 'str'], ['full_name_fa', 'str'], ['telegram_user_id', 'str'],
    ['aliases', 'str'], ['active', 'bool'], ['role', 'str'], ['department', 'str'],
    ['payment_identifier_optional', 'str'], ['ai_consent', 'str'],
    ['telegram_username_snapshot', 'str'], ['created_at', 'str'], ['updated_at', 'str']
  ],
  JoinRequests: [
    ['join_id', 'str'], ['telegram_user_id', 'str'], ['telegram_name', 'str'],
    ['telegram_username', 'str'], ['requested_full_name', 'str'], ['status', 'str'],
    ['employee_id', 'str'], ['decided_by', 'str'], ['decided_at', 'str'], ['created_at', 'str']
  ],
  Requests: [
    ['request_id', 'str'], ['submitter_telegram_id', 'str'], ['submitter_employee_id', 'str'],
    ['payer_employee_id', 'str'], ['purchase_channel', 'str'], ['payment_method', 'str'],
    ['order_date_iso', 'str'], ['order_date_jalali', 'str'], ['merchant', 'str'],
    ['merchant_order_id', 'str'], ['claimed_total_rial', 'int'], ['non_eligible_rial', 'int'],
    ['eligible_total_rial', 'int'], ['calculated_reimbursement_rial', 'int'],
    ['approved_reimbursement_rial', 'int'], ['cap_rial_applied', 'int'], ['status', 'str'],
    ['split_mode', 'str'], ['equal_split_confirmed', 'bool'], ['payer_is_submitter', 'bool'],
    ['combined_evidence', 'bool'], ['ai_used', 'bool'], ['ai_review_needed', 'bool'],
    ['flags', 'str'], ['drive_folder_id', 'str'], ['created_at', 'str'], ['updated_at', 'str'],
    ['submitted_at', 'str'], ['reviewed_by', 'str'], ['reviewed_at', 'str'],
    ['rejection_reason', 'str'], ['payment_status', 'str'], ['paid_at', 'str'], ['admin_notes', 'str']
  ],
  RequestBeneficiaries: [
    ['request_id', 'str'], ['employee_id', 'str'], ['employee_name_snapshot', 'str'],
    ['actual_cost_rial', 'int'], ['prior_approved_today_rial', 'int'],
    ['remaining_cap_before_rial', 'int'], ['approved_allocation_rial', 'int'],
    ['created_at', 'str'], ['updated_at', 'str']
  ],
  Documents: [
    ['document_id', 'str'], ['request_id', 'str'], ['document_kind', 'str'],
    ['telegram_file_id', 'str'], ['telegram_file_unique_id', 'str'], ['drive_file_id', 'str'],
    ['sha256_if_available', 'str'], ['original_filename', 'str'], ['mime_type', 'str'],
    ['file_size', 'int'], ['caption', 'str'], ['extracted_amount_rial', 'str'],
    ['extracted_currency', 'str'], ['extracted_date', 'str'], ['extracted_reference', 'str'],
    ['ocr_status', 'str'], ['ai_json', 'json'], ['verification_flags', 'str'],
    ['status', 'str'], ['uploaded_by', 'str'], ['uploaded_at', 'str']
  ],
  Payments: [
    ['payment_id', 'str'], ['request_id', 'str'], ['payer_employee_id', 'str'],
    ['payer_name_snapshot', 'str'], ['amount_rial', 'int'], ['payee_identifier_optional', 'str'],
    ['status', 'str'], ['transaction_reference_optional', 'str'], ['approved_at', 'str'],
    ['paid_at', 'str'], ['processed_by', 'str'], ['notes', 'str'], ['updated_at', 'str']
  ],
  AuditLog: [
    ['event_id', 'str'], ['request_id', 'str'], ['actor_telegram_id', 'str'], ['action', 'str'],
    ['previous_state', 'str'], ['new_state', 'str'], ['field_changes_json', 'json'],
    ['created_at', 'str'], ['error_code_optional', 'str']
  ],
  ProcessedUpdates: [
    ['telegram_update_id', 'str'], ['event_type', 'str'], ['received_at', 'str'],
    ['processed_at', 'str'], ['processing_result', 'str'], ['request_id_optional', 'str'],
    ['actor_telegram_id', 'str']
  ],
  Sessions: [
    ['telegram_user_id', 'str'], ['step', 'str'], ['request_id', 'str'],
    ['data_json', 'json'], ['seq', 'int'], ['updated_at', 'str']
  ],
  Settings: [
    ['key', 'str'], ['value', 'str'], ['description', 'str'], ['updated_at', 'str']
  ],
  CapSchedule: [
    ['effective_from_iso', 'str'], ['cap_rial', 'int'], ['note', 'str'], ['created_at', 'str']
  ],
  ReportsArchive: [
    ['report_id', 'str'], ['report_type', 'str'], ['from_iso', 'str'], ['to_iso', 'str'],
    ['generated_at', 'str'], ['generated_by', 'str'], ['xlsx_drive_id', 'str'],
    ['pdf_drive_id', 'str'], ['snapshot_drive_id', 'str'], ['totals_json', 'json']
  ]
};

var STATUS = {
  DRAFT: 'DRAFT',
  WAITING_FOR_PURCHASE_RECEIPT: 'WAITING_FOR_PURCHASE_RECEIPT',
  WAITING_FOR_PAYMENT_PROOF: 'WAITING_FOR_PAYMENT_PROOF',
  WAITING_FOR_DETAILS: 'WAITING_FOR_DETAILS',
  READY_FOR_REVIEW: 'READY_FOR_REVIEW',
  NEEDS_CORRECTION: 'NEEDS_CORRECTION',
  REJECTED: 'REJECTED',
  APPROVED: 'APPROVED',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED'
};

/** فقط این وضعیت‌ها سقف روزانه افراد را مصرف می‌کنند. */
var CAP_CONSUMING_STATUSES = ['APPROVED', 'PAID'];

var DRAFT_STATUSES = ['DRAFT', 'WAITING_FOR_PURCHASE_RECEIPT', 'WAITING_FOR_PAYMENT_PROOF', 'WAITING_FOR_DETAILS'];

var STATUS_FA = {
  DRAFT: 'پیش‌نویس',
  WAITING_FOR_PURCHASE_RECEIPT: 'در انتظار مدرک خرید',
  WAITING_FOR_PAYMENT_PROOF: 'در انتظار مدرک پرداخت',
  WAITING_FOR_DETAILS: 'در انتظار تکمیل اطلاعات',
  READY_FOR_REVIEW: 'در انتظار بررسی ادمین',
  NEEDS_CORRECTION: 'نیازمند اصلاح',
  REJECTED: 'ردشده',
  APPROVED: 'تأییدشده (در انتظار پرداخت)',
  PAID: 'پرداخت‌شده',
  CANCELLED: 'لغوشده'
};

var STATUS_ICON = {
  DRAFT: '📝', WAITING_FOR_PURCHASE_RECEIPT: '📝', WAITING_FOR_PAYMENT_PROOF: '📝',
  WAITING_FOR_DETAILS: '📝', READY_FOR_REVIEW: '⏳', NEEDS_CORRECTION: '✏️',
  REJECTED: '❌', APPROVED: '✅', PAID: '💵', CANCELLED: '🚫'
};

var ROLES = {
  EMPLOYEE: 'employee',
  FINANCE_ADMIN: 'finance_admin',
  REPORT_VIEWER: 'report_viewer',
  OWNER: 'owner'
};

var ROLE_FA = {
  employee: 'کارمند',
  finance_admin: 'ادمین مالی',
  report_viewer: 'ناظر گزارش',
  owner: 'مالک ربات'
};

/** مجوزها به تفکیک نقش. */
var PERMISSIONS = {
  SUBMIT: ['employee', 'finance_admin', 'report_viewer', 'owner'],
  REVIEW: ['finance_admin', 'owner'],
  REPORT: ['finance_admin', 'report_viewer', 'owner'],
  AUDIT_REPORT: ['finance_admin', 'owner'],
  MANAGE_EMPLOYEES: ['finance_admin', 'owner'],
  MANAGE_ROLES: ['owner'],
  SETTINGS_VIEW: ['finance_admin', 'owner'],
  SETTINGS_EDIT: ['owner']
};

var CHANNEL = { ONLINE: 'ONLINE', IN_PERSON: 'IN_PERSON' };
var CHANNEL_FA = { ONLINE: 'سفارش آنلاین', IN_PERSON: 'خرید حضوری' };

var PAY_METHOD = { BANK: 'BANK', CREDIT: 'CREDIT', MIXED: 'MIXED' };
var PAY_METHOD_FA = { BANK: 'بانکی/درگاه', CREDIT: 'اعتباری (اسنپ‌پی و مشابه)', MIXED: 'ترکیبی / نیازمند بررسی' };

var DOC_KIND = {
  PURCHASE: 'PURCHASE',
  BANK_PAYMENT: 'BANK_PAYMENT',
  CREDIT_PAYMENT: 'CREDIT_PAYMENT',
  MIXED_PAYMENT: 'MIXED_PAYMENT',
  VOICE_NOTE: 'VOICE_NOTE'
};

var DOC_KIND_FA = {
  PURCHASE: 'مدرک خرید (فاکتور/اسکرین‌شات سفارش)',
  BANK_PAYMENT: 'رسید پرداخت بانکی/درگاه',
  CREDIT_PAYMENT: 'اثبات تراکنش اعتباری',
  MIXED_PAYMENT: 'مدرک پرداخت ترکیبی',
  VOICE_NOTE: 'پیام صوتی'
};

var SPLIT = { SINGLE: 'SINGLE', EQUAL: 'EQUAL', INDIVIDUAL: 'INDIVIDUAL' };

/** کدهای هشدار که روی درخواست/مدرک ثبت می‌شوند و ادمین می‌بیند. */
var FLAG_FA = {
  AUTHENTICITY_NOT_VERIFIED: 'اصالت تصاویر توسط سیستم تأیید نشده است',
  PAYER_NOT_SUBMITTER: 'پرداخت‌کننده با ثبت‌کننده متفاوت است (هویت بررسی شود)',
  PAYER_NOT_BENEFICIARY: 'پرداخت‌کننده جزو مصرف‌کنندگان نیست',
  CREDIT_PAYMENT: 'پرداخت اعتباری — طبق سیاست نیازمند تأیید صریح ادمین',
  MIXED_PAYMENT: 'پرداخت ترکیبی — نیازمند بررسی ادمین',
  COMBINED_EVIDENCE: 'یک تصویر هم مدرک خرید و هم مدرک پرداخت اعلام شده',
  DUPLICATE_FILE: 'تصویر تکراری: قبلاً در درخواست دیگری ارسال شده',
  DUPLICATE_ORDER_ID: 'شماره سفارش/فاکتور تکراری در درخواست دیگر',
  SAME_FILE_BOTH_KINDS: 'تصویر یکسان برای مدرک خرید و پرداخت',
  PROPORTIONAL_DISTRIBUTION: 'اختلاف جمع سهم‌ها و مبلغ کل به‌نسبت سهم‌ها توزیع شد',
  AI_AMOUNT_MISMATCH: 'مبلغ استخراج‌شده توسط AI با مبلغ اعلام‌شده مغایرت دارد',
  AI_BALANCE_ONLY: 'AI: احتمالاً تصویر فقط موجودی اعتبار است، نه تراکنش',
  AI_PAYMENT_FAILED: 'AI: وضعیت تراکنش ناموفق به نظر می‌رسد',
  AMOUNT_UNUSUAL: 'مبلغ خارج از محدوده معمول است',
  DRIVE_SAVE_FAILED: 'ذخیره فایل در Drive ناموفق بود (فایل در تلگرام موجود است)',
  FREE_TEXT_PREFILL: 'برخی فیلدها از متن/ویس آزاد استخراج و توسط کاربر تأیید شد',
  OVER_CAP: 'سهم برخی افراد بیشتر از مانده سقف روزانه است (فقط تا سقف قابل بازپرداخت است)',
  PRIOR_USAGE: 'برخی افراد در همان روز درخواست تأییدشده دیگری دارند (سقف مشترک)'
};

/**
 * تنظیمات پیش‌فرض شیت Settings: [key, value, description]
 * این مقادیر فقط اگر کلید در شیت وجود نداشته باشد اضافه می‌شوند (setup ایمن و تکرارپذیر).
 */
var DEFAULT_SETTINGS = [
  ['DAILY_CAP_RIAL', '3500000', 'سقف پایه بازپرداخت ناهار هر نفر در هر روز (ریال). برای سقف تاریخ‌دار از شیت CapSchedule استفاده کنید.'],
  ['TIMEZONE', 'Asia/Tehran', 'منطقه زمانی (فقط اطلاعاتی؛ منطقه زمانی اصلی در appsscript.json است).'],
  ['ALLOW_CREDIT_PAYMENTS', 'TRUE', 'پذیرش پرداخت اعتباری (اسنپ‌پی و مشابه). در هر حال نیازمند تأیید ادمین است.'],
  ['ALLOW_MIXED_PAYMENTS', 'TRUE', 'پذیرش پرداخت ترکیبی (بانکی + اعتباری) با بررسی ادمین.'],
  ['ALLOW_COMBINED_EVIDENCE', 'FALSE', 'اگر TRUE باشد کاربر می‌تواند اعلام کند یک تصویر هم فاکتور و هم رسید پرداخت است (با علامت بررسی ادمین).'],
  ['ALLOW_EQUAL_SPLIT', 'TRUE', 'امکان اعلام سهم مساوی برای سفارش گروهی.'],
  ['ELIGIBLE_DELIVERY_FEE', 'TRUE', 'هزینه ارسال جزو مبلغ قابل بازپرداخت است.'],
  ['ELIGIBLE_PACKAGING_FEE', 'TRUE', 'هزینه بسته‌بندی جزو مبلغ قابل بازپرداخت است.'],
  ['ELIGIBLE_TAX', 'TRUE', 'مالیات/عوارض جزو مبلغ قابل بازپرداخت است.'],
  ['ELIGIBLE_TIP', 'TRUE', 'انعام/کارمزد جزو مبلغ قابل بازپرداخت است.'],
  ['REQUIRE_ADMIN_APPROVAL', 'TRUE', 'همیشه TRUE؛ مقدار FALSE نادیده گرفته می‌شود (تأیید نهایی فقط با ادمین مالی).'],
  ['MAX_CLAIM_AGE_DAYS', '30', 'حداکثر قدمت تاریخ سفارش (روز).'],
  ['LOW_AMOUNT_WARNING_RIAL', '100000', 'مبالغ کمتر از این مقدار با هشدار تأیید گرفته می‌شوند (احتمال اشتباه ریال/تومان).'],
  ['HIGH_AMOUNT_WARNING_RIAL', '200000000', 'مبالغ بیشتر از این مقدار با هشدار تأیید گرفته می‌شوند.'],
  ['MAX_FILE_MB', '20', 'حداکثر حجم هر فایل مدرک (مگابایت). محدودیت دانلود Bot API تلگرام ۲۰ مگابایت است.'],
  ['MAX_FILES_PER_STEP', '10', 'حداکثر تعداد تصویر در هر مرحله مدرک.'],
  ['AI_ENABLED', 'FALSE', 'روشن/خاموش کردن هوش مصنوعی (Gemini). پیش‌فرض خاموش.'],
  ['AI_CONSENT_CONFIRMED', 'FALSE', 'تأیید سازمان برای ارسال تصاویر/ویس به سرویس خارجی AI. بدون TRUE، AI اجرا نمی‌شود.'],
  ['AI_IMAGE_ENABLED', 'TRUE', 'استخراج مبلغ از تصویر فاکتور/رسید (فقط اگر AI_ENABLED روشن باشد).'],
  ['AI_VOICE_ENABLED', 'TRUE', 'تبدیل ویس فارسی به متن (فقط اگر AI_ENABLED روشن باشد).'],
  ['GEMINI_MODEL', '', 'نام مدل Gemini که در Free Tier ورودی تصویر و صوت را پشتیبانی کند. قبل از تنظیم، مستندات رسمی روز را بررسی کنید.'],
  ['RETENTION_DAYS', '1095', 'دوره نگهداری اسناد مالی (روز). حذف خودکار انجام نمی‌شود؛ فقط گزارش موارد قدیمی‌تر.'],
  ['PROCESSED_UPDATES_KEEP_DAYS', '14', 'مدت نگهداری شناسه‌های update تلگرام برای جلوگیری از پردازش تکراری.'],
  ['DRAFT_EXPIRY_DAYS', '7', 'درخواست‌های نیمه‌کاره قدیمی‌تر از این مقدار لغو می‌شوند.'],
  ['REPORT_DAILY_ENABLED', 'TRUE', 'ارسال خودکار گزارش روزانه.'],
  ['REPORT_DAILY_HOUR', '17', 'ساعت تقریبی ارسال گزارش روزانه (۰ تا ۲۳ به وقت تهران). تریگر گوگل ممکن است تا یک ساعت جابه‌جا اجرا شود.'],
  ['REPORT_RECIPIENTS', '', 'شناسه‌های تلگرام گیرندگان گزارش خودکار (با کاما). خالی = همه ادمین‌های مالی و مالک. فقط افراد دارای نقش مجاز دریافت می‌کنند.'],
  ['REPORT_FONT', 'Vazirmatn', 'فونت گزارش PDF/Excel.'],
  ['NOTIFY_ADMINS_ON_SUBMIT', 'TRUE', 'ارسال کارت درخواست جدید برای ادمین‌های مالی.']
];

/** کلیدهایی که مالک می‌تواند با /set از داخل تلگرام تغییر دهد. */
var EDITABLE_SETTING_KEYS = DEFAULT_SETTINGS.map(function (s) { return s[0]; })
  .filter(function (k) { return k !== 'TIMEZONE' && k !== 'REQUIRE_ADMIN_APPROVAL'; });

/** دلایل آماده رد/درخواست اصلاح. */
var REASONS = {
  R1: 'مدرک خرید ناخوانا یا ناقص است',
  R2: 'مدرک پرداخت معتبر نیست (مثلاً فقط موجودی اعتبار نشان داده شده)',
  R3: 'مبلغ فاکتور با رسید پرداخت مطابقت ندارد',
  R4: 'تاریخ سفارش نامشخص یا نامعتبر است',
  R5: 'درخواست تکراری است',
  R6: 'خارج از سیاست بازپرداخت ناهار است',
  R7: 'اسامی افراد یا سهم‌ها نیاز به اصلاح دارد'
};
