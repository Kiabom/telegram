'use strict';
/**
 * شبیه‌ساز سرویس‌های Google Apps Script و Telegram Bot API برای اجرای واقعی کد .gs در Node.js.
 * هدف: آزمودن منطق ربات (Sheets درون‌حافظه، Drive، قفل، کش، UrlFetch) بدون حساب گوگل/تلگرام.
 * محدودیت: رندر واقعی XLSX/PDF توسط Google شبیه‌سازی نمی‌شود (فقط فراخوانی export بررسی می‌شود).
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SRC_DIR = path.join(__dirname, '..', 'apps-script');

function toSigned(buf) { return Array.from(buf).map((b) => (b > 127 ? b - 256 : b)); }
function toBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (typeof bytes === 'string') return Buffer.from(bytes, 'utf8');
  return Buffer.from(bytes.map((b) => b & 0xff));
}

class Blob {
  constructor(data, contentType, name) {
    this.bytes = toBuffer(data || []);
    this.contentType = contentType || 'application/octet-stream';
    this.name = name || '';
  }
  getBytes() { return toSigned(this.bytes); }
  getDataAsString() { return this.bytes.toString('utf8'); }
  getContentType() { return this.contentType; }
  setContentType(t) { this.contentType = t; return this; }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  copyBlob() { return new Blob(this.bytes, this.contentType, this.name); }
}

function chainProxy(target) {
  const proxy = new Proxy(target, {
    get(t, p) {
      if (p in t) return typeof t[p] === 'function' ? t[p].bind(t) : t[p];
      if (typeof p === 'symbol') return undefined;
      return () => proxy;
    }
  });
  return proxy;
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------
let SHEET_SEQ = 1;
class Sheet {
  constructor(ss, name) {
    this.ss = ss; this.name = name; this.data = []; this.maxRows = 1000; this.maxCols = 26; this.id = SHEET_SEQ++;
    this.formats = {}; this.calls = { setValues: 0, appendRow: 0 };
  }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getSheetId() { return this.id; }
  rowEmpty(r) { return !r || r.every((v) => v === '' || v === null || v === undefined); }
  getLastRow() { for (let i = this.data.length - 1; i >= 0; i--) if (!this.rowEmpty(this.data[i])) return i + 1; return 0; }
  getLastColumn() { let m = 0; this.data.forEach((r) => { if (!r) return; for (let i = r.length - 1; i >= 0; i--) if (r[i] !== '' && r[i] !== undefined && r[i] !== null) { m = Math.max(m, i + 1); break; } }); return m; }
  getMaxRows() { return Math.max(this.maxRows, this.data.length); }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(after, n) { this.maxRows += n; return this; }
  getRange(r, c, nr, nc) {
    if (typeof r === 'string') throw new Error('A1 notation not supported in mock');
    return chainProxy(new Range(this, r, c, nr || 1, nc || 1));
  }
  getDataRange() { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  appendRow(arr) {
    this.calls.appendRow++;
    const at = this.getLastRow();
    this.data[at] = arr.slice();
    if (at + 1 > this.maxRows) this.maxRows = at + 1;
    return this;
  }
  deleteRow(r) { this.data.splice(r - 1, 1); return this; }
  deleteRows(r, n) { this.data.splice(r - 1, n); return this; }
  clear() { this.data = []; return this; }
}
['setFrozenRows', 'setRightToLeft', 'setColumnWidth', 'setHiddenGridlines', 'autoResizeColumns', 'hideSheet', 'setTabColor'].forEach((m) => {
  Sheet.prototype[m] = function () { return this; };
});

class Range {
  constructor(sheet, r, c, nr, nc) {
    if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error(`Invalid range ${r},${c},${nr},${nc}`);
    this.sheet = sheet; this.r = r; this.c = c; this.nr = nr; this.nc = nc;
  }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sheet.data[this.r - 1 + i] || [];
      const vals = [];
      for (let j = 0; j < this.nc; j++) { const v = row[this.c - 1 + j]; vals.push(v === undefined || v === null ? '' : v); }
      out.push(vals);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(values) {
    if (values.length !== this.nr || values.some((row) => row.length !== this.nc)) {
      throw new Error(`setValues dimension mismatch: range ${this.nr}x${this.nc}, data ${values.length}x${values[0] && values[0].length}`);
    }
    this.sheet.calls.setValues++;
    for (let i = 0; i < this.nr; i++) {
      const idx = this.r - 1 + i;
      this.sheet.data[idx] = this.sheet.data[idx] || [];
      for (let j = 0; j < this.nc; j++) {
        let v = values[i][j];
        if (typeof v === 'string' && /^'[=+\-@]/.test(v)) v = v.slice(1); // Sheets quote-prefix → text
        this.sheet.data[idx][this.c - 1 + j] = v;
      }
    }
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setNumberFormat(f) { this.sheet.formats[`${this.c}`] = f; return this; }
  createFilter() { return {}; }
  setDataValidation() { return this; }
}

let SS_SEQ = 1;
class Spreadsheet {
  constructor(env, name) {
    this.env = env; this.id = 'ss' + (SS_SEQ++) + '_' + crypto.randomBytes(4).toString('hex'); this.name = name;
    this.sheets = [new Sheet(this, 'Sheet1')]; this.tz = 'America/New_York';
  }
  getId() { return this.id; }
  getName() { return this.name; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  getSheets() { return this.sheets.slice(); }
  insertSheet(n) { if (this.getSheetByName(n)) throw new Error('Sheet exists: ' + n); const s = new Sheet(this, n); this.sheets.push(s); return s; }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
  setSpreadsheetTimeZone(tz) { this.tz = tz; }
  getSpreadsheetTimeZone() { return this.tz; }
}

// ---------------------------------------------------------------------------
// Drive
// ---------------------------------------------------------------------------
let DRIVE_SEQ = 1;
function makeDrive(env) {
  const files = new Map(), folders = new Map();
  class File {
    constructor(name, blob, parent, mime) { this.id = 'f' + (DRIVE_SEQ++); this.name = name; this.blob = blob; this.parent = parent; this.trashed = false; this.mime = mime; files.set(this.id, this); }
    getId() { return this.id; }
    getName() { return this.name; }
    getUrl() { return 'https://drive.google.com/file/d/' + this.id + '/view'; }
    getBlob() { return this.blob ? this.blob.copyBlob() : new Blob('', this.mime, this.name); }
    getMimeType() { return this.mime; }
    moveTo(folder) { this.parent = folder.id; return this; }
    setTrashed(t) { this.trashed = t; return this; }
    isTrashed() { return this.trashed; }
    setSharing() { env.publicShares.push(this.id); return this; }
  }
  class Folder {
    constructor(name, parent) { this.id = 'd' + (DRIVE_SEQ++); this.name = name; this.parent = parent || null; folders.set(this.id, this); }
    getId() { return this.id; }
    getName() { return this.name; }
    getUrl() { return 'https://drive.google.com/drive/folders/' + this.id; }
    createFolder(n) { return new Folder(n, this.id); }
    createFile(blob) { return new File(blob.getName(), blob.copyBlob(), this.id, blob.getContentType()); }
    getFoldersByName(n) {
      const list = [...folders.values()].filter((f) => f.parent === this.id && f.name === n);
      let i = 0;
      return { hasNext: () => i < list.length, next: () => list[i++] };
    }
    getFiles() { const list = [...files.values()].filter((f) => f.parent === this.id); let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; }
    getSharingAccess() { return 'PRIVATE'; }
    setSharing() { env.publicShares.push(this.id); return this; }
  }
  const DriveApp = {
    Access: { PRIVATE: 'PRIVATE', ANYONE: 'ANYONE', ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', DOMAIN: 'DOMAIN' },
    Permission: { VIEW: 'VIEW', EDIT: 'EDIT' },
    createFolder: (n) => new Folder(n, null),
    getFolderById: (id) => { const f = folders.get(id); if (!f) throw new Error('No folder ' + id); return f; },
    getFileById: (id) => {
      const f = files.get(id);
      if (f) return f;
      if (env.spreadsheets.has(id)) { const s = new File(env.spreadsheets.get(id).name, null, null, 'application/vnd.google-apps.spreadsheet'); files.delete(s.id); s.id = id; files.set(id, s); return s; }
      throw new Error('No file ' + id);
    }
  };
  return { DriveApp, files, folders, File, Folder };
}

// ---------------------------------------------------------------------------
// Telegram fake
// ---------------------------------------------------------------------------
function makeTelegram(env) {
  const tg = {
    calls: [], chats: new Map(), nextMessageId: 1000, answers: [], documents: [], fail: null, files: new Map(), commands: [],
    webhook: null,
    chat(id) { id = String(id); if (!this.chats.has(id)) this.chats.set(id, []); return this.chats.get(id); },
    handle(method, payload) {
      this.calls.push({ method, payload });
      if (this.fail && (this.fail.method === method || this.fail.method === '*') && (this.fail.chatId === undefined || String(this.fail.chatId) === String(payload.chat_id))) {
        const f = this.fail;
        if (f.once) this.fail = null;
        if (f.network) throw new Error('DNS error for https://api.telegram.org/bot' + env.props.get('BOT_TOKEN') + '/' + method);
        return { code: f.code || 400, body: { ok: false, error_code: f.code || 400, description: f.description || 'Bad Request' } };
      }
      const ok = (result) => ({ code: 200, body: { ok: true, result } });
      switch (method) {
        case 'getMe': return ok({ id: 999, is_bot: true, username: 'lunch_test_bot' });
        case 'sendMessage': {
          if (typeof payload.text !== 'string' || !payload.text.length) return { code: 400, body: { ok: false, description: 'Bad Request: message text is empty' } };
          if (payload.text.length > 4096) return { code: 400, body: { ok: false, description: 'Bad Request: message is too long' } };
          const m = { message_id: this.nextMessageId++, chat_id: String(payload.chat_id), text: payload.text, reply_markup: payload.reply_markup || null };
          this.chat(payload.chat_id).push(m);
          return ok({ message_id: m.message_id, chat: { id: Number(payload.chat_id) }, text: payload.text });
        }
        case 'editMessageText': {
          const m = this.chat(payload.chat_id).find((x) => x.message_id === payload.message_id);
          if (!m) return { code: 400, body: { ok: false, description: 'Bad Request: message to edit not found' } };
          if (m.text === payload.text && JSON.stringify(m.reply_markup) === JSON.stringify(payload.reply_markup || null)) {
            return { code: 400, body: { ok: false, description: 'Bad Request: message is not modified' } };
          }
          m.text = payload.text; m.reply_markup = payload.reply_markup || null; m.edited = (m.edited || 0) + 1;
          return ok(true);
        }
        case 'editMessageReplyMarkup': {
          const m = this.chat(payload.chat_id).find((x) => x.message_id === payload.message_id);
          if (m) m.reply_markup = payload.reply_markup;
          return ok(true);
        }
        case 'answerCallbackQuery': this.answers.push(payload); return ok(true);
        case 'getFile': {
          const meta = this.files.get(payload.file_id) || { size: 50000 };
          return ok({ file_id: payload.file_id, file_size: meta.size, file_path: 'photos/' + payload.file_id + (meta.ext || '.jpg') });
        }
        case 'sendDocument': {
          const doc = payload.document;
          this.documents.push({ chat_id: String(payload.chat_id), name: doc && doc.getName ? doc.getName() : doc, bytes: doc && doc.bytes, caption: payload.caption });
          this.chat(payload.chat_id).push({ message_id: this.nextMessageId++, chat_id: String(payload.chat_id), text: '[document] ' + (doc && doc.getName ? doc.getName() : ''), document: true });
          return ok({ message_id: this.nextMessageId });
        }
        case 'sendPhoto': case 'sendVoice':
          this.chat(payload.chat_id).push({ message_id: this.nextMessageId++, chat_id: String(payload.chat_id), text: '[' + method + '] ' + (payload.caption || ''), media: payload.photo || payload.voice || payload.document });
          return ok({ message_id: this.nextMessageId });
        case 'setMyCommands': this.commands.push(payload); return ok(true);
        case 'setWebhook': this.webhook = payload; return ok(true);
        case 'deleteWebhook': this.webhook = null; return ok(true);
        case 'getWebhookInfo': return ok({ url: this.webhook ? this.webhook.url : '', pending_update_count: 0 });
        case 'getUpdates': { const u = env.pendingUpdates.filter((x) => !payload.offset || x.update_id >= payload.offset); return ok(u); }
        default: return ok(true);
      }
    }
  };
  return tg;
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
function formatDate(date, tz, pattern) {
  const d = new Date(date.getTime());
  const parts = {};
  new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).forEach((p) => { parts[p.type] = p.value; });
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const off = Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  const offStr = sign + String(Math.floor(abs / 60)).padStart(2, '0') + ':' + String(abs % 60).padStart(2, '0');
  let out = '';
  const re = /'([^']*)'|yyyy|MM|dd|HH|mm|ss|XXX/g;
  let last = 0, m;
  while ((m = re.exec(pattern)) !== null) {
    out += pattern.slice(last, m.index);
    const tok = m[0];
    if (m[1] !== undefined) out += m[1];
    else out += { yyyy: parts.year, MM: parts.month, dd: parts.day, HH: parts.hour, mm: parts.minute, ss: parts.second, XXX: offStr }[tok];
    last = re.lastIndex;
  }
  return out + pattern.slice(last);
}

function createEnv(opts = {}) {
  const env = {
    props: new Map(), cache: new Map(), logs: [], spreadsheets: new Map(), publicShares: [], fetchLog: [],
    pendingUpdates: [], lockAvailable: true, exports: [], aiHandler: null, triggers: [], quiet: opts.quiet !== false,
    lockCalls: 0
  };
  const drive = makeDrive(env);
  env.drive = drive;
  const tg = makeTelegram(env);
  env.tg = tg;

  const response = (code, body, blob) => ({
    getResponseCode: () => code,
    getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)),
    getBlob: () => blob || new Blob(typeof body === 'string' ? body : JSON.stringify(body), 'application/json'),
    getContent: () => (blob ? blob.getBytes() : []),
    getHeaders: () => ({})
  });

  const UrlFetchApp = {
    fetch(url, params = {}) {
      env.fetchLog.push({ url, params });
      if (env.networkDown) throw new Error('Address unavailable: ' + url);
      if (url.startsWith('https://api.telegram.org/file/bot')) {
        const fp = url.split('/').slice(6).join('/');
        const fileId = fp.replace(/^photos\//, '').replace(/\.[a-z0-9]+$/i, '');
        const meta = tg.files.get(fileId) || {};
        return response(200, '', new Blob(meta.content || ('FAKEFILE:' + fileId), meta.mime || 'image/jpeg', fp.split('/').pop()));
      }
      if (url.startsWith('https://api.telegram.org/bot')) {
        const method = url.split('/').pop();
        const payload = params.contentType === 'application/json' ? JSON.parse(params.payload) : (params.payload || {});
        const r = tg.handle(method, payload);
        return response(r.code, r.body);
      }
      if (url.startsWith('https://docs.google.com/document/d/')) {
        const id = url.split('/')[5];
        const doc = env.documents.get(id);
        env.exports.push({ id, fmt: 'pdf', url, kind: 'document', content: doc ? JSON.parse(JSON.stringify(doc.content)) : [], closed: doc && doc.closed });
        if (env.exportFail) return response(env.exportFail, 'error');
        return response(200, '', new Blob(Buffer.from('%PDF-1.4 fake-doc'), 'application/pdf', 'export.pdf'));
      }
      if (url.startsWith('https://docs.google.com/spreadsheets/d/')) {
        const id = url.split('/')[5];
        const fmt = (url.match(/format=(\w+)/) || [])[1];
        const ss = env.spreadsheets.get(id);
        env.exports.push({ id, fmt, url, sheets: ss ? ss.sheets.map((s) => ({ name: s.name, data: JSON.parse(JSON.stringify(s.data)) })) : [] });
        if (env.exportFail) return response(env.exportFail, 'error');
        const content = fmt === 'xlsx' ? Buffer.from('PK\u0003\u0004fake-xlsx') : Buffer.from('%PDF-1.4 fake');
        return response(200, '', new Blob(content, fmt === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf', 'export.' + fmt));
      }
      if (url.startsWith('https://generativelanguage.googleapis.com/')) {
        if (!env.aiHandler) return response(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED' } });
        const r = env.aiHandler(url, JSON.parse(params.payload), params.headers || {});
        return response(r.code, r.body);
      }
      throw new Error('Unexpected URL in test: ' + url);
    }
  };

  const store = (m) => ({
    getProperty: (k) => (m.has(k) ? m.get(k) : null),
    setProperty: (k, v) => { m.set(k, String(v)); },
    deleteProperty: (k) => { m.delete(k); },
    getProperties: () => Object.fromEntries(m),
    setProperties: (o) => { Object.keys(o).forEach((k) => m.set(k, String(o[k]))); }
  });

  const SpreadsheetApp = {
    openById: (id) => { const s = env.spreadsheets.get(id); if (!s) throw new Error('No spreadsheet ' + id); return s; },
    create: (name) => { const s = new Spreadsheet(env, name); env.spreadsheets.set(s.id, s); return s; },
    getActiveSpreadsheet: () => env.activeSpreadsheet || null,
    flush: () => {},
    newDataValidation: () => chainProxy({ build: () => ({}) }),
    BorderStyle: { SOLID: 'SOLID' }
  };

  // DocumentApp: محتوای سند (پاراگراف، جدول، تصویر، شکست صفحه) ثبت می‌شود تا تست‌ها بررسی کنند.
  env.documents = new Map();
  const makeParagraph = (doc, text) => {
    const item = { type: 'p', text };
    doc.content.push(item);
    const p = chainProxy({
      setText: (t) => { item.text = t; return undefined; }, // مثل Docs واقعی: void
      getText: () => item.text,
      editAsText: () => chainProxy({ getText: () => item.text }),
      asParagraph: () => p
    });
    return p;
  };
  const DocumentApp = {
    HorizontalAlignment: { LEFT: 'LEFT', CENTER: 'CENTER', RIGHT: 'RIGHT' },
    VerticalAlignment: { TOP: 'TOP', CENTER: 'CENTER', BOTTOM: 'BOTTOM' },
    create: (name) => {
      const id = 'doc' + (SS_SEQ++) + '_' + crypto.randomBytes(3).toString('hex');
      const doc = { id, name, content: [], closed: false };
      env.documents.set(id, doc);
      env.spreadsheets.set(id, { name, sheets: [] });
      let firstPara = null;
      const body = chainProxy({
        getParagraphs: () => { if (!firstPara) firstPara = makeParagraph(doc, ''); return [firstPara]; },
        appendParagraph: (t) => makeParagraph(doc, t),
        appendPageBreak: () => { doc.content.push({ type: 'pagebreak' }); return chainProxy({}); },
        appendTable: (cells) => {
          doc.content.push({ type: 'table', cells: JSON.parse(JSON.stringify(cells)) });
          const cell = chainProxy({ getChild: () => chainProxy({ asParagraph: () => chainProxy({ editAsText: () => chainProxy({}) }) }) });
          return chainProxy({ getRow: () => chainProxy({ getCell: () => cell }) });
        },
        appendImage: (blob) => {
          if (env.imageFail) throw new Error('Invalid image data');
          const item = { type: 'image', bytes: blob.getDataAsString(), w: 800, h: 1200 };
          doc.content.push(item);
          const para = chainProxy({});
          const img = chainProxy({
            getWidth: () => item.w, getHeight: () => item.h,
            setWidth: (w) => { item.w = w; return img; }, setHeight: (h) => { item.h = h; return img; },
            getParent: () => chainProxy({ asParagraph: () => para })
          });
          return img;
        }
      });
      return chainProxy({ getId: () => id, getBody: () => body, saveAndClose: () => { doc.closed = true; } });
    }
  };

  const triggerBuilder = (name) => {
    const t = { name, spec: [] };
    const b = chainProxy({ create: () => { env.triggers.push({ getHandlerFunction: () => name, spec: t.spec, name }); return t; } });
    return new Proxy(b, { get(target, p) { if (p === 'create') return target.create; return (...a) => { t.spec.push([p, ...a]); return b; }; } });
  };

  const sandboxConsole = {
    log: (...a) => env.logs.push(['log', a.join(' ')]),
    info: (...a) => env.logs.push(['info', a.join(' ')]),
    warn: (...a) => { env.logs.push(['warn', a.join(' ')]); if (!env.quiet) console.warn(...a); },
    error: (...a) => { env.logs.push(['error', a.join(' ')]); if (!env.quiet) console.error(...a); }
  };

  const context = {
    console: sandboxConsole,
    Logger: { log: (s) => env.logs.push(['Logger', String(s)]) },
    Utilities: {
      formatDate,
      getUuid: () => crypto.randomUUID(),
      sleep: () => {},
      base64Encode: (b) => toBuffer(b).toString('base64'),
      base64Decode: (s) => toSigned(Buffer.from(s, 'base64')),
      computeDigest: (alg, bytes) => toSigned(crypto.createHash('sha256').update(toBuffer(bytes)).digest()),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      newBlob: (data, type, name) => new Blob(data, type, name)
    },
    PropertiesService: { getScriptProperties: () => store(env.props) },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (env.cache.has(k) ? env.cache.get(k) : null),
        put: (k, v) => { env.cache.set(k, String(v)); },
        remove: (k) => { env.cache.delete(k); }
      })
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => { env.lockCalls++; return env.lockAvailable; },
        waitLock: () => { if (!env.lockAvailable) throw new Error('Lock timeout'); },
        releaseLock: () => {},
        hasLock: () => true
      })
    },
    SpreadsheetApp,
    DocumentApp,
    DriveApp: drive.DriveApp,
    UrlFetchApp,
    ScriptApp: {
      getOAuthToken: () => 'oauth-test-token',
      getService: () => ({ getUrl: () => env.props.get('WEB_APP_URL') || '' }),
      newTrigger: triggerBuilder,
      getProjectTriggers: () => env.triggers.slice(),
      deleteTrigger: (t) => { env.triggers = env.triggers.filter((x) => x !== t); }
    },
    HtmlService: { createHtmlOutput: (s) => ({ getContent: () => s, kind: 'html' }) },
    ContentService: { createTextOutput: (s) => ({ getContent: () => s, kind: 'text' }), MimeType: { JSON: 'JSON' } },
    Session: { getScriptTimeZone: () => 'Asia/Tehran' },
    MimeType: { GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet', PDF: 'application/pdf' }
  };
  vm.createContext(context);
  // LUNCHBOT_SRC=dist → آزمودن نسخه تک‌فایلی ساخته‌شده توسط npm run bundle
  const dir = process.env.LUNCHBOT_SRC === 'dist' ? path.join(__dirname, '..', 'dist') : SRC_DIR;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.gs')).sort();
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), context, { filename: f }));
  env.context = context;
  env.Blob = Blob;
  return env;
}

module.exports = { createEnv, Blob, formatDate, SRC_DIR };
