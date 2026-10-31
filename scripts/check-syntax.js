'use strict';
/** بررسی نحوی همه فایل‌های .gs با موتور V8 نود (همان موتور Apps Script V8). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..', 'apps-script');
let failed = 0;
fs.readdirSync(dir).filter((f) => f.endsWith('.gs')).forEach((f) => {
  try {
    new vm.Script(fs.readFileSync(path.join(dir, f), 'utf8'), { filename: f });
  } catch (e) {
    failed++;
    console.error('✗ ' + f + ': ' + e.message);
  }
});
JSON.parse(fs.readFileSync(path.join(dir, 'appsscript.json'), 'utf8'));
console.log(failed ? failed + ' file(s) failed' : '✓ all .gs files parse; appsscript.json is valid JSON');
process.exit(failed ? 1 : 0);
