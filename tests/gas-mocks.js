// Minimal fakes of the Apps Script services used by Code.gs, for local testing.
const crypto = require('crypto');
function makeSheet(name) {
  const sh = { name, data: [], hidden: false };
  const ensure = (r, c) => { while (sh.data.length < r) sh.data.push([]); sh.data.forEach(row => { while (row.length < c) row.push(''); }); };
  sh.getLastRow = () => { let n = sh.data.length; while (n > 0 && sh.data[n - 1].every(v => v === '')) n--; return n; };
  sh.getLastColumn = () => Math.max(0, ...sh.data.map(r => { let n = r.length; while (n > 0 && r[n - 1] === '') n--; return n; }));
  sh.getMaxRows = () => Math.max(1000, sh.data.length); sh.getMaxColumns = () => 26;
  sh.setFrozenRows = () => sh; sh.hideSheet = () => { sh.hidden = true; return sh; };
  sh.deleteRow = r => { sh.data.splice(r - 1, 1); };
  sh.clear = () => { sh.data = []; return sh; };
  sh.getRange = (r, c, nr = 1, nc = 1) => {
    const rg = {
      setValues(v) { ensure(r + nr - 1, c + nc - 1); for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) sh.data[r - 1 + i][c - 1 + j] = String(v[i][j]); return rg; },
      getDisplayValues() { ensure(r + nr - 1, c + nc - 1); return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => sh.data[r - 1 + i][c - 1 + j] ?? '')); },
      setNumberFormat() { return rg; }, setFontWeight() { return rg; }
    };
    return rg;
  };
  return sh;
}
function makeSpreadsheet() {
  const sheets = {};
  return { sheets, getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = makeSheet(n)) };
}
function install(g, props) {
  const ss = makeSpreadsheet();
  const cache = {};
  g.SpreadsheetApp = { getActiveSpreadsheet: () => ss, openById: () => ss };
  g.PropertiesService = { getScriptProperties: () => ({ getProperty: k => props[k] || null }) };
  g.CacheService = { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) };
  g.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };
  g.Utilities = {
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, v) => [...crypto.createHash('sha256').update(v, 'utf8').digest()],
    base64Encode: b => Buffer.from(b).toString('base64'),
    getUuid: () => crypto.randomUUID(), sleep: () => {}
  };
  g.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: t => ({ text: t, setMimeType() { return this; } }) };
  g.sentMail = []; g.fetched = [];
  g.MailApp = { sendEmail: (to, subj, body) => g.sentMail.push({ to, subj, body }) };
  g.UrlFetchApp = { fetch: (url, opt) => { g.fetched.push({ url, opt }); return { getResponseCode: () => 200, getContentText: () => '{"result":true}' }; } };
  g.ScriptApp = { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => ({ timeBased: () => ({ everyHours: () => ({ create() {} }), atHour: () => ({ everyDays: () => ({ create() {} }) }) }) }) };
  g.console = console;
  return ss;
}
module.exports = { install };
