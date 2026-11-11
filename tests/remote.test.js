// Browser app in "remote" mode, wired to Code.gs running on fake Google services.
const { JSDOM } = require(require('child_process').execSync('npm root -g').toString().trim() + '/jsdom');
const vm = require('vm'), fs = require('fs'), path = require('path');
const { install } = require('./gas-mocks');
const root = path.join(__dirname, '..');
const props = { ADMIN_NAME: 'Test Admin', ADMIN_PASSWORD: 'firstpass123', TEST_PHONE: '9000000001', WATI_ENDPOINT: 'https://x', WATI_TOKEN: 't' };
const g = { Date, Math, JSON, String, Number, Object, Array, Error, RegExp, encodeURIComponent, isNaN, Buffer };
vm.createContext(g); const ss = install(g, props);
vm.runInContext(fs.readFileSync(root + '/assets/core.js', 'utf8'), g);
vm.runInContext(fs.readFileSync(root + '/assets/insights.js', 'utf8'), g);
vm.runInContext(fs.readFileSync(root + '/apps-script/Code.gs', 'utf8'), g);
g.setup();
ss.getSheetByName('Roster').getRange(2, 1, 3, 6).setValues([['Head One', 'T5', 'Principal', 'CFAL', 'Test Admin', '9111111111'], ['Lead Two', 'T4', 'Senior Lecturer, Physics', 'CFAL', 'Head One', '9222222222'], ['Staff Three', 'T3', 'Lecturer, Physics', 'CFAL', 'Lead Two', '9333333333']]);
g.importRoster(); const msg = g.createAdmin(); const adminId = /staff ID (\S+)/.exec(msg)[1];
let html = fs.readFileSync(root + '/index.html', 'utf8').replace(/<script src="([^"]+)"><\/script>/g, (m, src) => '<script>' + fs.readFileSync(root + '/' + src, 'utf8').replace("apiUrl: ''", "apiUrl: 'https://script.google.com/macros/s/TEST/exec'") + '</script>').replace(/<link[^>]+>/g, '');
const errors = [];
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.github.io/tracker/', pretendToBeVisual: true, beforeParse(w) {
  w.addEventListener('error', e => errors.push(e.message));
  w.fetch = (url, opt) => Promise.resolve({ json: () => Promise.resolve(JSON.parse(g.doPost({ postData: { contents: opt.body }, parameter: {} }).text)) });
} });
const w = dom.window, d = w.document, sleep = ms => new Promise(r => setTimeout(r, ms)), $ = s => d.querySelector(s), $$ = s => [...d.querySelectorAll(s)];
const submit = f => f.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
let n = 0; const ok = (c, m) => { if (!c) throw new Error('FAILED ' + m); n++; };
(async () => {
  await sleep(100);
  ok($('#si'), 'sign-in form shown');
  $('[name=ident]').value = adminId; $('[name=password]').value = 'wrong-pass'; submit($('#si')); await sleep(80);
  ok($('#si-err').textContent.includes('Wrong'), 'wrong password rejected');
  $('[name=password]').value = 'firstpass123'; submit($('#si')); await sleep(80);
  ok($('#cp'), 'forced password change');
  $('[name=old]').value = 'firstpass123'; $('[name=n1]').value = 'new-secret-99'; $('[name=n2]').value = 'new-secret-99'; submit($('#cp')); await sleep(150);
  ok(d.body.textContent.includes('Test mode'), 'test mode banner');
  ok($('a[href="#people"]'), 'admin sees people page');
  // assign work to Staff Three
  click($('#b-assign')); await sleep(30);
  const staff = [...$$('.modal [name=assigneeId] option')].find(o => o.textContent === 'Staff Three');
  $('.modal [name=title]').value = 'Remote test task'; $('.modal [name=assigneeId]').value = staff.value; submit($('.modal form')); await sleep(150);
  ok(!$('.modal'), 'assigned via backend');
  ok(g.fetched.every(f => f.url.includes('919000000001')), 'only test phone messaged');
  // reset Staff Three password from People page
  w.location.hash = 'people'; w.dispatchEvent(new w.HashChangeEvent('hashchange')); await sleep(80);
  click($(`[data-person="${staff.value}"]`)); await sleep(30); click($('#pm-edit')); await sleep(30); click($('#pe-reset')); await sleep(120);
  const temp = $('.modal b[style]').textContent; ok(temp.length === 10, 'temp password shown');
  click($('[data-close]')); click($('#signout')); await sleep(120);
  $('[name=ident]').value = staff.value; $('[name=password]').value = temp; submit($('#si')); await sleep(80);
  $('[name=old]').value = temp; $('[name=n1]').value = 'staff-pass-1'; $('[name=n2]').value = 'staff-pass-1'; submit($('#cp')); await sleep(150);
  ok(d.body.textContent.includes('Remote test task'), 'staff sees task');
  ok(!$('a[href="#people"]'), 'staff has no admin pages');
  click([...$$('[data-act="confirm"]')][0]); await sleep(150);
  ok($$('[data-act="complete"]').length > 0, 'confirmed via backend');
  // AI summary through the real backend (fake Gemini)
  click($('#signout')); await sleep(120);
  $('[name=ident]').value = adminId; $('[name=password]').value = 'new-secret-99'; submit($('#si')); await sleep(150);
  props.AI_PROVIDER = 'gemini'; props.AI_API_KEY = 'k';
  w.location.hash = 'org'; w.dispatchEvent(new w.HashChangeEvent('hashchange')); await sleep(100);
  ok($$('[data-org-fn]').length > 0, 'org functions from roster import');
  click($('[data-sum]')); await sleep(300);
  ok($('.sumtext') && /AI SUMMARY/.test($('.sumtext').textContent) && /Written by AI/.test(d.body.textContent), 'AI summary shown and labelled');
  console.log(n + ' remote checks passed'); if (errors.length) { console.log(errors); process.exit(1); } process.exit(0);
})().catch(e => { console.error(e.message, errors); process.exit(1); });
