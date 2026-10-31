'use strict';
/**
 * ساخت نسخه تک‌فایلی برای نصب ساده (کپی/پیست در ویرایشگر Apps Script):
 *   dist/LunchBot.gs      ← همه فایل‌های apps-script/*.gs پشت سر هم
 *   dist/appsscript.json  ← مانیفست
 * اجرا: npm run bundle
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'apps-script');
const OUT = path.join(__dirname, '..', 'dist');
const ORDER = ['Config', 'Utils', 'Jalali', 'Money', 'Names', 'Finance', 'Db', 'Settings', 'Telegram', 'Auth',
  'Documents', 'Requests', 'Wizard', 'FreeText', 'Admin', 'Join', 'Menu', 'Reports', 'Export', 'Ai', 'Router',
  'Setup', 'Triggers', 'SelfTest'];

const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.gs')).map((f) => f.replace(/\.gs$/, ''));
const missing = files.filter((f) => !ORDER.includes(f));
if (missing.length) throw new Error('Add to ORDER in scripts/bundle.js: ' + missing.join(', '));

const version = (fs.readFileSync(path.join(SRC, 'Config.gs'), 'utf8').match(/VERSION: '([^']+)'/) || [])[1];
const header = [
  '/**',
  ' * LunchBot ' + version + ' — ربات رایگان مدیریت هزینه ناهار (Telegram + Google Apps Script + Sheets + Drive)',
  ' * این فایل به‌صورت خودکار از پوشه apps-script ساخته شده است (npm run bundle). مستقیماً ویرایش نکنید.',
  ' * راهنمای نصب: README_FA.md',
  ' */',
  ''
].join('\n');

const body = ORDER.filter((f) => files.includes(f)).map((f) =>
  '// ===========================================================================\n// ' + f + '.gs\n' +
  '// ===========================================================================\n' + fs.readFileSync(path.join(SRC, f + '.gs'), 'utf8').trim() + '\n'
).join('\n');

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'LunchBot.gs'), header + body);
fs.copyFileSync(path.join(SRC, 'appsscript.json'), path.join(OUT, 'appsscript.json'));
console.log('dist/LunchBot.gs (' + Math.round(fs.statSync(path.join(OUT, 'LunchBot.gs')).size / 1024) + ' KB) + dist/appsscript.json');
