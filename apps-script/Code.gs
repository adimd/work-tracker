/**
 * Work Tracker — Google Apps Script backend.
 *
 * Files in this Apps Script project:
 *   Code.gs   (this file: web API, login, Google Sheets storage, jobs, WhatsApp, roster import)
 *   Core.gs      (a copy of assets/core.js: all business rules, shared with the browser)
 *   Insights.gs  (a copy of assets/insights.js: functions, summary facts, templates, AI prompts)
 *
 * Script Properties (Project Settings › Script properties):
 *   SPREADSHEET_ID     optional; the Google Sheet that holds the data (defaults to the sheet this script is bound to)
 *   ADMIN_NAME         name of the first System admin (used once by createAdmin)
 *   ADMIN_PASSWORD     their first password (used once by createAdmin; delete it afterwards)
 *   OWNER_NAMES        optional, comma-separated names to make Owners on roster import (e.g. "Asha Menon,Rahul Shenoy")
 *   WATI_ENDPOINT      optional, e.g. https://live-server-12345.wati.io
 *   WATI_TOKEN         optional, Wati API bearer token (without the word Bearer)
 *   WATI_TEMPLATE      optional, name of an approved template with one variable {{1}}
 *   WATI_BROADCAST     optional, broadcast name used for template sends
 *   WEBHOOK_KEY        optional, secret added to the Wati webhook URL as ?key=...
 *   ALLOWED_ORIGIN     optional, informational: the GitHub Pages URL of the frontend
 *   SEND_MODE          "test" (default when missing) or "live".
 *                      test: every message goes ONLY to TEST_PHONE, labelled with who it was meant for;
 *                            no email is ever sent to staff. If TEST_PHONE is empty, nothing is sent at all.
 *                      live: messages go to the real people. Only set this after the pilot is approved.
 *   TEST_PHONE         your own WhatsApp number for test mode, e.g. 9198XXXXXXXX
 *   AI_PROVIDER        optional: gemini, claude or openai. Leave empty to use template summaries (no AI).
 *   AI_API_KEY         the API key for that provider
 *   AI_MODEL           optional model name; defaults: gemini-2.5-flash, claude-haiku-5-5, gpt-4o-mini
 */

var SESSION_HOURS = 6;
var MAX_FAILED_LOGINS = 8;
var LOCK_MINUTES = 15;
var ITEM_HISTORY_DAYS = 180;
var AUTH_COLUMNS = ['personId', 'hash', 'salt', 'mustChange', 'failed', 'lockedUntil'];

// ===================================================================== web entry points

function doGet() {
  return json({ ok: true, service: 'Work Tracker API', time: new Date().toISOString() });
}

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (x) {
    return json({ ok: false, error: 'Bad request' });
  }
  if (e && e.parameter && e.parameter.webhook === 'wati') return json(handleWatiWebhook(e, body));
  try {
    return json({ ok: true, data: route(body) });
  } catch (x) {
    var msg = x && x.userFacing ? x.message : (x && x.message ? 'Server error: ' + x.message : 'Server error');
    if (!(x && x.userFacing)) console.error(x && x.stack ? x.stack : x);
    return json({ ok: false, error: msg, auth: !!(x && x.authError), mustChange: !!(x && x.mustChange) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function userError(msg, auth) { var e = new Error(msg); e.userFacing = true; e.authError = !!auth; return e; }

// ===================================================================== routing

function route(body) {
  var action = body.action;
  if (action === 'login') return login(body.payload || {});
  if (action === 'ping') return { time: new Date().toISOString() };

  var meId = sessionPerson(body.token);
  var S = new SheetStore();
  var me = Core.person(S, meId);
  if (!me || me.status === 'left') throw userError('Your account is not active', true);
  var auth = authRow(S, meId);
  if (auth && auth.mustChange === 'true' && action !== 'changePassword' && action !== 'logout') {
    var mc = userError('Please set a new password first', false);
    mc.mustChange = true;
    throw mc;
  }

  switch (action) {
    case 'logout':
      CacheService.getScriptCache().remove('sess_' + body.token);
      return true;
    case 'changePassword':
      return changePassword(S, meId, body.payload || {});
    case 'resetPassword':
      return resetPassword(S, meId, body.payload || {});
    case 'bootstrap':
      return bootstrap(S, meId);
    case 'itemEvents':
      return itemEvents(S, meId, (body.payload || {}).id);
    case 'auditLog':
      if (!Core.isSys(me)) throw userError('Not allowed');
      return S.all('events').filter(function (e) { return !e.itemId; }).slice(-300).reverse();
    case 'outbox':
      if (!Core.isSys(me)) throw userError('Not allowed');
      return S.all('outbox').slice(-200).reverse();
    case 'digestPreview':
      return Core.digestText(S, meId, Core.isoDate(new Date()));
    case 'runJobsNow':
      if (!Core.isSys(me)) throw userError('Not allowed');
      return withLock(function () { var r = Core.runJobs(S, new Date().toISOString()); r.sent = sendOutbox(S, true); return r; });
    case 'summarize':
      return withLock(function () { return summarize(new SheetStore(), meId, body.payload || {}); });
    case 'queueTermSummaries':
      if (!Core.isOwner(me)) throw userError('Only Owners can do this');
      return queueTermSummaries(S);
    case 'aiStatus':
      return aiStatus();
    case 'act':
      return withLock(function () {
        var S2 = new SheetStore(); // fresh read inside the lock
        var result = Core.act(S2, meId, body.name, body.payload || {}, new Date().toISOString());
        sendOutbox(S2, false);
        return result;
      });
    default:
      throw userError('Unknown action');
  }
}

function withLock(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw userError('The system is busy, please try again');
  try { return fn(); } finally { lock.releaseLock(); }
}

// ===================================================================== bootstrap (what the browser loads)

function bootstrap(S, meId) {
  var today = Core.isoDate(new Date());
  var me = Core.person(S, meId);
  var since = Core.addDays(today, -ITEM_HISTORY_DAYS);
  var items = Core.visibleItems(S, meId, today).filter(function (it) {
    return Core.OPEN.indexOf(it.status) >= 0 || it.status === 'review' || String(it.updatedAt).slice(0, 10) >= since;
  });
  var showContacts = Core.isSys(me) || Core.hasRole(me, 'hr');
  var people = S.all('people').map(function (p) {
    var o = {};
    Core.SCHEMA.people.forEach(function (k) { o[k] = p[k]; });
    if (!showContacts && p.id !== meId) { o.phone = p.phone ? '•••' : ''; o.email = ''; }
    return o;
  });
  var auth = S.all('auth');
  var hasLogin = {};
  auth.forEach(function (a) { if (a.hash) hasLogin[a.personId] = true; });
  if (showContacts) people.forEach(function (p) { p.hasLogin = hasLogin[p.id] ? 'true' : 'false'; });
  return {
    meId: meId,
    today: today,
    people: people,
    teams: S.all('teams'),
    memberships: S.all('memberships'),
    priorities: S.all('priorities'),
    initiatives: S.all('initiatives'),
    items: items,
    duties: S.all('duties'),
    decisions: S.all('decisions'),
    settings: S.all('settings'),
    summaries: S.all('summaries').filter(function (r) { return Insights.canSee(S, meId, r.scopeType, r.scopeId, today); }).slice(-250),
    reviews: S.all('reviews').filter(function (r) { return Core.isOwner(me) || Core.teamsLedBy(S, meId).some(function (t) { return t.id === r.teamId; }) || Core.teamMemberIds(S, r.teamId).indexOf(meId) >= 0; }),
    ai: aiStatus(),
    whatsapp: !!PropertiesService.getScriptProperties().getProperty('WATI_TOKEN'),
    sendMode: sendMode()
  };
}

function itemEvents(S, meId, id) {
  var it = Core.visibleItems(S, meId, Core.isoDate(new Date())).filter(function (x) { return x.id === id; })[0];
  if (!it) throw userError('Not allowed');
  return S.all('events').filter(function (e) { return e.itemId === id; });
}

// ===================================================================== login and passwords

function normaliseLogin(s) { return String(s || '').trim().toLowerCase().replace(/[\s-]/g, ''); }

function findPersonForLogin(S, ident) {
  var n = normaliseLogin(ident);
  if (!n) return null;
  var digits = n.replace(/\D/g, '');
  return S.all('people').filter(function (p) {
    if (p.status === 'left') return false;
    if (normaliseLogin(p.id) === n) return true;
    if (p.email && normaliseLogin(p.email) === n) return true;
    if (digits.length >= 10 && p.phone && String(p.phone).replace(/\D/g, '').slice(-10) === digits.slice(-10)) return true;
    return false;
  })[0] || null;
}

function login(payload) {
  var S = new SheetStore();
  var p = findPersonForLogin(S, payload.id);
  var generic = 'Wrong staff ID or password';
  if (!p) { Utilities.sleep(400); throw userError(generic, true); }
  var a = authRow(S, p.id);
  if (!a || !a.hash) throw userError('No password has been set for you yet. Ask the System admin.', true);
  if (a.lockedUntil && new Date(a.lockedUntil) > new Date()) throw userError('Too many attempts. Try again in ' + LOCK_MINUTES + ' minutes.', true);
  if (hashPassword(payload.password || '', a.salt) !== a.hash) {
    var failed = Number(a.failed || 0) + 1;
    var patch = { failed: String(failed) };
    if (failed >= MAX_FAILED_LOGINS) { patch.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString(); patch.failed = '0'; }
    S.update('auth', p.id, patch);
    Utilities.sleep(400);
    throw userError(generic, true);
  }
  S.update('auth', p.id, { failed: '0', lockedUntil: '' });
  var token = Utilities.getUuid() + Utilities.getUuid().slice(0, 8);
  CacheService.getScriptCache().put('sess_' + token, p.id, SESSION_HOURS * 3600);
  return { token: token, personId: p.id, name: p.name, mustChange: a.mustChange === 'true' };
}

function sessionPerson(token) {
  if (!token) throw userError('Please sign in', true);
  var cache = CacheService.getScriptCache();
  var id = cache.get('sess_' + token);
  if (!id) throw userError('Your session has ended. Please sign in again.', true);
  cache.put('sess_' + token, id, SESSION_HOURS * 3600); // sliding expiry
  return id;
}

function authRow(S, personId) {
  return S.all('auth').filter(function (a) { return a.personId === personId; })[0] || null;
}

function hashPassword(password, salt) {
  var value = salt + '|' + password;
  for (var i = 0; i < 500; i++) {
    value = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value + salt, Utilities.Charset.UTF_8));
  }
  return value;
}

function setPassword(S, personId, password, mustChange) {
  if (String(password).length < 8) throw userError('Passwords must be at least 8 characters');
  var salt = Utilities.getUuid();
  var row = { personId: personId, hash: hashPassword(password, salt), salt: salt, mustChange: mustChange ? 'true' : 'false', failed: '0', lockedUntil: '' };
  if (authRow(S, personId)) S.update('auth', personId, row); else S.insert('auth', row);
}

function changePassword(S, meId, p) {
  var a = authRow(S, meId);
  if (!a || hashPassword(p.oldPassword || '', a.salt) !== a.hash) throw userError('Your current password is not right');
  if (String(p.newPassword || '') === String(p.oldPassword || '')) throw userError('Choose a different password');
  setPassword(S, meId, p.newPassword, false);
  return true;
}

function resetPassword(S, meId, p) {
  var me = Core.person(S, meId);
  if (!(Core.isSys(me) || Core.hasRole(me, 'hr'))) throw userError('Only the System admin or HR can reset passwords');
  var target = Core.person(S, p.personId);
  if (!target) throw userError('Person not found');
  var temp = randomPassword();
  setPassword(S, target.id, temp, true);
  S.insert('events', { id: Core.uid('ev'), itemId: '', actorId: meId, action: 'password reset: ' + target.name, note: '', at: new Date().toISOString() });
  return { tempPassword: temp, staffId: target.id };
}

function randomPassword() {
  var chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var s = '';
  for (var i = 0; i < 10; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

// ===================================================================== Google Sheets storage

function SheetStore() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  this.ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!this.ss) throw new Error('No spreadsheet: bind the script to a Google Sheet or set SPREADSHEET_ID');
  this.cache = {};
}
SheetStore.columns = function (table) { return table === 'auth' ? AUTH_COLUMNS : Core.SCHEMA[table]; };
SheetStore.keyOf = function (table) { return table === 'settings' ? 'key' : table === 'auth' ? 'personId' : 'id'; };
SheetStore.prototype.sheet = function (table) {
  var sh = this.ss.getSheetByName(table);
  var cols = SheetStore.columns(table);
  if (!sh) {
    sh = this.ss.insertSheet(table);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), Math.max(cols.length, sh.getMaxColumns())).setNumberFormat('@');
    if (table === 'auth') sh.hideSheet();
  }
  return sh;
};
SheetStore.prototype.load = function (table) {
  if (this.cache[table]) return this.cache[table];
  var sh = this.sheet(table);
  var cols = SheetStore.columns(table);
  var last = sh.getLastRow();
  var header = sh.getRange(1, 1, 1, sh.getLastColumn() || cols.length).getDisplayValues()[0];
  var missing = cols.filter(function (c) { return header.indexOf(c) < 0; });
  if (missing.length) { // schema grew: add columns
    sh.getRange(1, header.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    header = header.concat(missing);
  }
  var rows = [];
  var index = {};
  if (last > 1) {
    var values = sh.getRange(2, 1, last - 1, header.length).getDisplayValues();
    var key = SheetStore.keyOf(table);
    values.forEach(function (v, i) {
      var o = {};
      header.forEach(function (h, j) { if (h) o[h] = v[j]; });
      if (!o[key]) return;
      rows.push(o);
      index[o[key]] = i + 2;
    });
  }
  this.cache[table] = { rows: rows, index: index, header: header, sheet: sh };
  return this.cache[table];
};
SheetStore.prototype.all = function (table) { return this.load(table).rows; };
SheetStore.prototype.toRow = function (c, obj) { return c.header.map(function (h) { return obj[h] === undefined || obj[h] === null ? '' : String(obj[h]); }); };
SheetStore.prototype.insert = function (table, obj) {
  var c = this.load(table);
  var row = {};
  SheetStore.columns(table).forEach(function (k) { row[k] = obj[k] === undefined || obj[k] === null ? '' : String(obj[k]); });
  var r = c.sheet.getLastRow() + 1;
  c.sheet.getRange(r, 1, 1, c.header.length).setNumberFormat('@').setValues([this.toRow(c, row)]);
  c.rows.push(row);
  c.index[row[SheetStore.keyOf(table)]] = r;
  return row;
};
SheetStore.prototype.update = function (table, id, patch) {
  var c = this.load(table);
  var r = c.index[id];
  if (!r) throw new Error('Not found: ' + table + ' ' + id);
  var key = SheetStore.keyOf(table);
  var row = c.rows.filter(function (x) { return x[key] === id; })[0];
  Object.keys(patch).forEach(function (k) { row[k] = patch[k] === undefined || patch[k] === null ? '' : String(patch[k]); });
  c.sheet.getRange(r, 1, 1, c.header.length).setNumberFormat('@').setValues([this.toRow(c, row)]);
  return row;
};
SheetStore.prototype.remove = function (table, id) {
  var c = this.load(table);
  var r = c.index[id];
  if (!r) return;
  c.sheet.deleteRow(r);
  delete this.cache[table];
};

// ===================================================================== messages (WhatsApp or email)

function shortCode(itemId) { return String(itemId || '').replace(/^it_/, '').slice(-6).toUpperCase(); }

function withReplyHelp(m) {
  if (!m.itemId) return m.text;
  var code = shortCode(m.itemId);
  var hints = {
    confirm: 'Reply CONFIRM ' + code + ' or WRONG ' + code + ' <reason>',
    returned: 'Reply DONE ' + code + ' <link> when fixed',
    help: 'Reply ACK ' + code + ' when you are on it',
    escalation: 'Reply ACK ' + code + ' to take it',
    verify: 'Reply VERIFY ' + code + ' or open the Team page'
  };
  return m.text + '\n[' + code + '] ' + (hints[m.kind] || 'Reply DONE ' + code + ' <link> or HELP ' + code + ' <reason>');
}

function inQuietHours(cfg) {
  var h = new Date().getHours();
  var qs = Number(cfg.quietStart || 20), qe = Number(cfg.quietEnd || 7);
  return qs > qe ? (h >= qs || h < qe) : (h >= qs && h < qe);
}

function sendMode() {
  var m = String(PropertiesService.getScriptProperties().getProperty('SEND_MODE') || 'test').toLowerCase();
  return m === 'live' ? 'live' : 'test';
}

function sendOutbox(S, force) {
  var cfg = Core.settings(S);
  var quiet = inQuietHours(cfg);
  var props = PropertiesService.getScriptProperties();
  var wati = props.getProperty('WATI_TOKEN') && props.getProperty('WATI_ENDPOINT');
  var mode = sendMode();
  var testPhone = props.getProperty('TEST_PHONE');
  var sent = 0;
  S.all('outbox').forEach(function (m) {
    if (m.sentAt || m.error) return;
    if (quiet && m.kind !== 'escalation' && !force) return;
    var p = Core.person(S, m.toId);
    if (!p || p.status === 'left') { S.update('outbox', m.id, { error: 'No active person' }); return; }
    var text = withReplyHelp(m);
    try {
      if (mode === 'test') {
        // SAFETY: in test mode nothing ever goes to staff. Only to TEST_PHONE, or nowhere.
        if (!wati || !testPhone) { S.update('outbox', m.id, { error: 'Held (test mode, no TEST_PHONE or WhatsApp set up)' }); return; }
        sendWhatsApp(testPhone, '[TEST → ' + p.name + ']\n' + text);
      } else if (wati && p.phone) sendWhatsApp(p.phone, text);
      else if (p.email) MailApp.sendEmail(p.email, cfg.orgName + ': ' + text.split('\n')[0].slice(0, 80), text);
      else { S.update('outbox', m.id, { error: 'No WhatsApp or email configured' }); return; }
      S.update('outbox', m.id, { sentAt: new Date().toISOString() });
      sent++;
    } catch (x) {
      S.update('outbox', m.id, { error: String(x.message || x).slice(0, 300) });
    }
  });
  return sent;
}

function waNumber(phone) {
  var d = String(phone).replace(/\D/g, '');
  if (d.length === 10) d = '91' + d; // default to India
  return d;
}

/** Sends a WhatsApp message through Wati. Tries a session message first (allowed within 24 hours of the
 *  person's last message), then falls back to the approved template with one variable. Check the endpoint
 *  names against your Wati account's API docs before going live. */
function sendWhatsApp(phone, text) {
  var props = PropertiesService.getScriptProperties();
  var base = props.getProperty('WATI_ENDPOINT').replace(/\/$/, '');
  var headers = { Authorization: 'Bearer ' + props.getProperty('WATI_TOKEN') };
  var num = waNumber(phone);
  var r = UrlFetchApp.fetch(base + '/api/v1/sendSessionMessage/' + num + '?messageText=' + encodeURIComponent(text), { method: 'post', headers: headers, muteHttpExceptions: true });
  var ok = r.getResponseCode() < 300 && !/"result"\s*:\s*false/.test(r.getContentText());
  if (ok) return;
  var tpl = props.getProperty('WATI_TEMPLATE');
  if (!tpl) throw new Error('Session message failed and no WATI_TEMPLATE set: ' + r.getContentText().slice(0, 200));
  var body = { template_name: tpl, broadcast_name: props.getProperty('WATI_BROADCAST') || 'work_tracker', parameters: [{ name: '1', value: text.replace(/\n/g, ' · ').slice(0, 900) }] };
  var r2 = UrlFetchApp.fetch(base + '/api/v1/sendTemplateMessage?whatsappNumber=' + num, { method: 'post', contentType: 'application/json', headers: headers, payload: JSON.stringify(body), muteHttpExceptions: true });
  if (r2.getResponseCode() >= 300) throw new Error('Wati ' + r2.getResponseCode() + ': ' + r2.getContentText().slice(0, 200));
}

/** Incoming WhatsApp replies from Wati. Point the Wati webhook at:  <web app URL>?webhook=wati&key=<WEBHOOK_KEY> */
function handleWatiWebhook(e, body) {
  var key = PropertiesService.getScriptProperties().getProperty('WEBHOOK_KEY');
  if (!key || e.parameter.key !== key) return { ok: false };
  var text = String(body.text || (body.message && body.message.text) || '').trim();
  var from = String(body.waId || body.from || '');
  if (!text || !from) return { ok: true };
  return withLock(function () {
    var S = new SheetStore();
    var fromDigits = from.replace(/\D/g, '').slice(-10);
    var p;
    if (sendMode() === 'test') {
      // In test mode only the test phone may reply. It acts as whoever it last chose with "AS <staff id>".
      var tp = PropertiesService.getScriptProperties().getProperty('TEST_PHONE') || '';
      if (!tp || waNumber(tp).slice(-10) !== fromDigits) return { ok: true };
      var asMatch = /^AS\s+(\S+)/i.exec(text);
      var cache = CacheService.getScriptCache();
      if (asMatch) { cache.put('test_as', asMatch[1].toUpperCase(), 21600); }
      p = Core.person(S, cache.get('test_as') || '');
      if (!p) { sendWhatsApp(tp, 'Test mode: reply AS <staff ID> (e.g. AS P012) to choose who you are replying as.'); return { ok: true }; }
      if (asMatch) { sendWhatsApp(tp, 'Test mode: you are now replying as ' + p.name + ' (' + p.id + ').'); return { ok: true }; }
    } else {
      p = S.all('people').filter(function (x) { return x.phone && waNumber(x.phone).slice(-10) === fromDigits && x.status !== 'left'; })[0];
    }
    if (!p) return { ok: true };
    var reply;
    try { reply = runWhatsAppCommand(S, p.id, text); } catch (x) { reply = x.userFacing ? x.message : 'Sorry, that did not work. Reply MY WORK for your list.'; }
    if (reply) S.insert('outbox', { id: Core.uid('msg'), toId: p.id, text: reply, kind: 'reply', itemId: '', at: new Date().toISOString(), sentAt: '', error: '' });
    sendOutbox(S, true);
    return { ok: true };
  });
}

function runWhatsAppCommand(S, meId, text) {
  var now = new Date().toISOString();
  var parts = text.split(/\s+/);
  var cmd = parts[0].toUpperCase();
  if (/^MY$/i.test(parts[0]) || /^LIST$/i.test(cmd)) {
    var today = Core.isoDate(new Date());
    var mine = S.all('items').filter(function (it) { return it.assigneeId === meId && Core.OPEN.indexOf(it.status) >= 0; });
    if (!mine.length) return 'You have nothing open. Thank you!';
    return 'Your open items:\n' + mine.slice(0, 12).map(function (it) { return '[' + shortCode(it.id) + '] ' + it.title + (it.due ? ' (due ' + it.due + (it.due < today ? ', overdue' : '') + ')' : '') + (it.status === 'confirm' ? ' — please CONFIRM' : ''); }).join('\n');
  }
  var code = (parts[1] || '').toUpperCase();
  var it = S.all('items').filter(function (x) { return shortCode(x.id) === code; })[0];
  var rest = parts.slice(2).join(' ');
  if (!it) return 'I could not find item ' + code + '. Reply MY WORK for your list.';
  switch (cmd) {
    case 'CONFIRM': case 'YES': Core.act(S, meId, 'confirm', { id: it.id }, now); return 'Confirmed: ' + it.title;
    case 'WRONG': case 'NO': Core.act(S, meId, 'dispute', { id: it.id, reason: 'Other', note: rest || 'Not correct' }, now); return 'Thanks, I have told ' + Core.nameOf(S, it.createdBy) + '.';
    case 'DONE': Core.act(S, meId, 'complete', { id: it.id, evidence: rest, evidenceType: /^https?:/.test(rest) ? 'link' : 'witness' }, now); return 'Marked done. ' + Core.nameOf(S, Core.verifierOf(S, meId, Core.isoDate(new Date()))) + ' will verify it.';
    case 'HELP': Core.act(S, meId, 'help', { id: it.id, reason: 'Other', note: rest || 'Needs help' }, now); return 'Your help request has gone to ' + Core.nameOf(S, Core.escalationChain(S, meId, Core.isoDate(new Date()))[0]) + '.';
    case 'ACK': Core.act(S, meId, 'ackHelp', { id: it.id }, now); return 'Noted, you are handling it. Resolve it on the Needs help page when done.';
    case 'VERIFY': Core.act(S, meId, 'verify', { id: it.id }, now); return 'Verified: ' + it.title;
    case 'THANKS': Core.act(S, meId, 'thank', { id: it.id, note: rest || 'Thank you!' }, now); return 'Your thanks have been sent.';
    default: return 'Commands: MY WORK · CONFIRM <code> · WRONG <code> <reason> · DONE <code> <link> · HELP <code> <reason>';
  }
}


// ===================================================================== AI summaries

var AI_DEFAULT_MODELS = { gemini: 'gemini-2.5-flash', claude: 'claude-haiku-5-5', openai: 'gpt-4o-mini' };

function aiConfig() {
  var props = PropertiesService.getScriptProperties();
  var provider = String(props.getProperty('AI_PROVIDER') || '').toLowerCase().trim();
  var key = props.getProperty('AI_API_KEY');
  if (!AI_DEFAULT_MODELS[provider] || !key) return null;
  return { provider: provider, key: key, model: props.getProperty('AI_MODEL') || AI_DEFAULT_MODELS[provider] };
}
function aiStatus() { var c = aiConfig(); return c ? { connected: true, provider: c.provider, model: c.model } : { connected: false }; }

/** Calls the configured provider. Returns the text, or throws. */
function aiGenerate(system, user) {
  var c = aiConfig();
  if (!c) throw new Error('No AI provider configured');
  var res, data;
  if (c.provider === 'gemini') {
    res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(c.model) + ':generateContent', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': c.key },
      payload: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 700 } })
    });
    data = JSON.parse(res.getContentText() || '{}');
    if (res.getResponseCode() >= 300) throw new Error('Gemini ' + res.getResponseCode() + ': ' + ((data.error && data.error.message) || '').slice(0, 200));
    return ((((data.candidates || [])[0] || {}).content || {}).parts || []).map(function (p) { return p.text || ''; }).join('').trim();
  }
  if (c.provider === 'claude') {
    res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-api-key': c.key, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({ model: c.model, max_tokens: 700, temperature: 0.3, system: system, messages: [{ role: 'user', content: user }] })
    });
    data = JSON.parse(res.getContentText() || '{}');
    if (res.getResponseCode() >= 300) throw new Error('Claude ' + res.getResponseCode() + ': ' + ((data.error && data.error.message) || '').slice(0, 200));
    return (data.content || []).map(function (p) { return p.text || ''; }).join('').trim();
  }
  res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + c.key },
    payload: JSON.stringify({ model: c.model, temperature: 0.3, max_tokens: 700, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
  });
  data = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() >= 300) throw new Error('OpenAI ' + res.getResponseCode() + ': ' + ((data.error && data.error.message) || '').slice(0, 200));
  return String((((data.choices || [])[0] || {}).message || {}).content || '').trim();
}

/** Builds facts, asks the AI (or uses the template), stores and returns the summary row. */
function writeSummary(S, type, scopeType, scopeId, periodKind, entity, byId, custom) {
  var today = Core.isoDate(new Date());
  var range = Insights.periodRange(S, periodKind || 'week', today, custom);
  var facts = Insights.facts(S, scopeType, scopeId, range, entity || '', today);
  var text = '', source = 'template';
  if (aiConfig()) {
    try {
      var pr = Insights.prompt(type, facts);
      text = aiGenerate(pr.system, pr.user);
      source = 'AI: ' + aiConfig().provider;
    } catch (x) {
      console.error(x);
      source = 'template (AI unavailable: ' + String(x.message || x).slice(0, 80) + ')';
    }
  }
  if (!text) text = Insights.templateText(facts);
  return S.insert('summaries', { id: Core.uid('sm'), type: type, scopeType: scopeType, scopeId: scopeId || '', entity: entity || '', from: range.from, to: range.to, text: String(text).slice(0, 3000), source: source, createdAt: new Date().toISOString(), createdBy: byId || 'system' });
}

function summarize(S, meId, p) {
  var today = Core.isoDate(new Date());
  if (!Insights.SCOPES[p.scopeType]) throw userError('Unknown scope');
  if (!Insights.canSee(S, meId, p.scopeType, p.scopeId, today)) throw userError('You cannot see a summary for this');
  var type = Insights.SUMMARY_TYPES[p.type] ? p.type : 'custom';
  var recent = S.all('summaries').filter(function (r) {
    return r.scopeType === p.scopeType && r.scopeId === (p.scopeId || '') && r.type === type && (r.entity || '') === (p.entity || '') && (Date.now() - new Date(r.createdAt).getTime()) < 5 * 60000;
  })[0];
  if (recent) return recent; // at most one fresh summary per scope every 5 minutes
  return writeSummary(S, type, p.scopeType, p.scopeId || '', p.period || 'week', p.entity || '', meId, p.custom);
}

function queueTermSummaries(S) {
  var ids = S.all('people').filter(function (p) { return p.status !== 'left'; }).map(function (p) { return p.id; });
  PropertiesService.getScriptProperties().setProperty('TERM_QUEUE', ids.join(','));
  return { queued: ids.length, note: 'Term summaries are written in batches by the hourly job: about 25 people an hour.' };
}

function processTermQueue(S, started) {
  var props = PropertiesService.getScriptProperties();
  var q = Core.list(props.getProperty('TERM_QUEUE') || '');
  var done = 0;
  while (q.length && done < 25 && Date.now() - started < 240000) {
    writeSummary(S, 'term', 'person', q.shift(), 'term', '', 'system');
    done++;
  }
  props.setProperty('TERM_QUEUE', q.join(','));
  return done;
}

/** Saturday afternoon: a weekly summary for every function and every home team. */
function weeklyJob() {
  withLock(function () {
    var S = new SheetStore(), started = Date.now();
    Insights.functions(S).forEach(function (fn) {
      if (Date.now() - started > 270000) return;
      if (Insights.scopePeople(S, 'function', fn, '').length) writeSummary(S, 'weekly', 'function', fn, 'week', '', 'system');
    });
    S.all('teams').filter(function (t) { return t.active !== 'false'; }).forEach(function (t) {
      if (Date.now() - started > 300000) return;
      if (Core.teamMemberIds(S, t.id).length) writeSummary(S, 'weekly', 'team', t.id, 'week', '', 'system');
    });
    writeSummary(S, 'weekly', 'org', '', 'week', '', 'system');
  });
}

// ===================================================================== scheduled jobs

/** Run once from the editor: creates the hourly and daily jobs. */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('hourlyJob').timeBased().everyHours(1).create();
  var S = new SheetStore();
  var hour = Number(Core.settings(S).digestHour || 8);
  ScriptApp.newTrigger('dailyJob').timeBased().atHour(hour).everyDays(1).create();
  ScriptApp.newTrigger('weeklyJob').timeBased().onWeekDay(ScriptApp.WeekDay.SATURDAY).atHour(16).create();
  return 'Triggers installed: hourly, daily at ' + hour + ':00, and weekly on Saturday at 16:00';
}

function hourlyJob() {
  withLock(function () {
    var S = new SheetStore(), started = Date.now();
    Core.runJobs(S, new Date().toISOString());
    sendOutbox(S, false);
    processTermQueue(S, started);
  });
}

function dailyJob() {
  withLock(function () {
    var S = new SheetStore();
    var now = new Date().toISOString(), today = Core.isoDate(new Date());
    Core.runJobs(S, now);
    Core.dailyReminders(S, now);
    var owners = S.all('people').filter(function (p) { return Core.isOwner(p) && p.status !== 'left'; });
    var aiDigest = aiConfig() && owners.length ? writeSummary(S, 'digest', 'org', '', 'day', '', 'system') : null;
    owners.forEach(function (o) {
      var text = aiDigest && aiDigest.source.indexOf('AI') === 0 ? aiDigest.text : Core.digestText(S, o.id, today);
      S.insert('outbox', { id: Core.uid('msg'), toId: o.id, text: text, kind: 'digest', itemId: '', at: now, sentAt: '', error: '' });
    });
    sendOutbox(S, true);
  });
}

// ===================================================================== set-up helpers (run from the editor)

/** Step 1: creates every sheet with its headers. Safe to run again. */
function setup() {
  var S = new SheetStore();
  Object.keys(Core.SCHEMA).forEach(function (t) { S.load(t); });
  S.load('auth');
  var existing = S.all('settings').map(function (r) { return r.key; });
  Object.keys(Core.DEFAULT_SETTINGS).forEach(function (k) { if (existing.indexOf(k) < 0) S.insert('settings', { key: k, value: Core.DEFAULT_SETTINGS[k] }); });
  if (!S.ss.getSheetByName('Roster')) {
    var r = S.ss.insertSheet('Roster');
    r.getRange(1, 1, 1, 6).setValues([['Name', 'Grade', 'Designation', 'Entity', 'Reporting manager', 'Phone']]).setFontWeight('bold');
  }
  return 'Sheets ready. Paste the staff roster into the "Roster" sheet, then run importRoster.';
}

/** Step 3: makes ADMIN_NAME a System admin and Owner with ADMIN_PASSWORD. */
function createAdmin() {
  var props = PropertiesService.getScriptProperties();
  var name = props.getProperty('ADMIN_NAME'), pw = props.getProperty('ADMIN_PASSWORD');
  if (!name || !pw) throw new Error('Set ADMIN_NAME and ADMIN_PASSWORD in Script Properties first');
  var S = new SheetStore();
  var p = S.all('people').filter(function (x) { return x.name.toLowerCase() === name.toLowerCase(); })[0];
  if (!p) {
    p = S.insert('people', { id: 'P' + ('000' + (S.all('people').length + 1)).slice(-3), name: name, designation: 'System admin', level: '1', roles: 'owner,sysadmin', status: 'active', lang: 'en' });
  } else {
    var roles = Core.list(p.roles);
    ['owner', 'sysadmin'].forEach(function (r) { if (roles.indexOf(r) < 0) roles.push(r); });
    S.update('people', p.id, { roles: roles.join(',') });
  }
  setPassword(S, p.id, pw, true);
  return 'Admin ready. Sign in with staff ID ' + p.id + ' and the password from ADMIN_PASSWORD, then delete ADMIN_PASSWORD from Script Properties.';
}

/** Step 2: reads the "Roster" sheet (Name, Grade, Designation, Entity, Reporting manager, optional Phone)
 *  and creates people and home teams. Writes every problem to an "Import issues" sheet. Re-running updates
 *  existing people matched by name and never deletes anyone. */
function importRoster() {
  var S = new SheetStore();
  var sh = S.ss.getSheetByName('Roster');
  if (!sh || sh.getLastRow() < 2) throw new Error('Paste the roster into the "Roster" sheet first (run setup to create it)');
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(6, sh.getLastColumn())).getDisplayValues();
  var owners = Core.list(PropertiesService.getScriptProperties().getProperty('OWNER_NAMES') || '').map(function (x) { return x.toLowerCase(); });
  var issues = [];
  var rows = values.filter(function (v) { return String(v[0]).trim(); }).map(function (v) {
    return { name: v[0].trim(), grade: v[1].trim(), designation: v[2].trim(), entity: v[3].trim(), manager: v[4].trim(), phone: (v[5] || '').trim() };
  });

  // 1. people (matched on name + designation, so two people with the same name stay separate)
  var keyOf = function (name, desig) { return (name + '|' + desig).toLowerCase(); };
  var byKey = {}, byName = {}, nameCount = {};
  S.all('people').forEach(function (p) { byKey[keyOf(p.name, p.designation)] = p; });
  rows.forEach(function (r) { nameCount[r.name.toLowerCase()] = (nameCount[r.name.toLowerCase()] || 0) + 1; });
  var nextNum = S.all('people').reduce(function (m, p) { var x = /^P(\d+)$/.exec(p.id); return x ? Math.max(m, +x[1]) : m; }, 0);
  var newId = function () { nextNum++; return 'P' + ('000' + nextNum).slice(-3); };
  rows.forEach(function (r) {
    var discontinued = /discontinued/i.test(r.manager);
    var patch = { name: r.name, grade: r.grade, designation: r.designation, entity: /^cfal/i.test(r.entity) ? 'CFAL' : 'ELC / TLC School', level: levelFor(r.grade), status: discontinued ? 'left' : 'active' };
    if (r.phone) patch.phone = r.phone;
    if (owners.indexOf(r.name.toLowerCase()) >= 0) patch.roles = 'owner';
    var ex = byKey[keyOf(r.name, r.designation)];
    if (ex) { S.update('people', ex.id, patch); }
    else {
      patch.id = newId(); patch.lang = 'en'; patch.roles = patch.roles || '';
      ex = S.insert('people', patch); byKey[keyOf(r.name, r.designation)] = ex;
    }
    r.personId = ex.id;
    if (!byName[r.name.toLowerCase()] || !discontinued) byName[r.name.toLowerCase()] = ex;
    if (nameCount[r.name.toLowerCase()] > 1) issues.push([r.name, 'Appears more than once in the roster (' + r.designation + '). Kept as separate people: check whether they are the same person.']);
    if (discontinued) issues.push([r.name, 'Manager is "Discontinued": marked as left. Change status if they still work here.']);
    if (/to be decided/i.test(r.grade)) issues.push([r.name, 'Grade is "To be decided": level set to L4 Staff']);
    if (!r.phone) issues.push([r.name, 'No WhatsApp number']);
  });

  // 2. managers (resolve names; add people for managers not in the roster)
  var grouped = {};
  var note = function (msg, who) { (grouped[msg] = grouped[msg] || []).push(who); };
  var activeNames = S.all('people').filter(function (p) { return p.status !== 'left'; });
  rows.forEach(function (r) {
    if (!r.manager || /discontinued/i.test(r.manager)) return;
    var me = Core.person(S, r.personId);
    var m = resolveName(activeNames, r.manager);
    if (m.match) { S.update('people', me.id, { managerId: m.match.id }); if (m.fuzzy) note('Manager "' + r.manager + '" was matched to ' + m.match.name + ': check this', r.name); }
    else if (m.many) note('Manager "' + r.manager + '" matches several people (' + m.many.join(', ') + '): set these managers by hand', r.name);
    else {
      var added = byName[r.manager.toLowerCase()];
      if (!added) {
        added = S.insert('people', { id: newId(), name: r.manager, designation: 'Added: manager not in roster', level: '1', status: 'active', lang: 'en', roles: owners.indexOf(r.manager.toLowerCase()) >= 0 ? 'owner' : '' });
        byName[r.manager.toLowerCase()] = added; activeNames.push(added);
        issues.push([r.manager, 'Not in the roster but listed as a manager: added as a person. Fill in their details.']);
      }
      S.update('people', me.id, { managerId: added.id });
    }
  });

  Object.keys(grouped).forEach(function (msg) { issues.push([grouped[msg].length + ' people: ' + grouped[msg].slice(0, 6).join(', ') + (grouped[msg].length > 6 ? '…' : ''), msg]); });

  // 3. home teams from designation
  var teamsByName = {};
  S.all('teams').forEach(function (t) { teamsByName[t.name] = t; });
  rows.forEach(function (r) {
    var me = Core.person(S, r.personId);
    if (me.status === 'left') return;
    var tn = teamFor(r);
    var t = teamsByName[tn];
    if (!t) { t = S.insert('teams', { id: Core.uid('tm'), name: tn, entity: /^cfal/i.test(r.entity) ? 'CFAL' : 'ELC / TLC School', 'function': Insights.guessFunction(tn), type: 'home', leadId: '', deputyId: '', adminIds: '', endDate: '', initiativeId: '', active: 'true' }); teamsByName[tn] = t; }
    S.update('people', me.id, { homeTeamId: t.id });
  });
  // suggest a Lead: the most senior person in the team, else the most common manager
  Object.keys(teamsByName).forEach(function (tn) {
    var t = teamsByName[tn];
    if (t.leadId) return;
    var members = S.all('people').filter(function (p) { return p.homeTeamId === t.id && p.status !== 'left'; });
    var senior = members.slice().sort(function (a, b) { return Number(a.level) - Number(b.level); })[0];
    var counts = {};
    members.forEach(function (p) { if (p.managerId) counts[p.managerId] = (counts[p.managerId] || 0) + 1; });
    var topManager = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
    var lead = senior && Number(senior.level) <= 3 ? senior.id : topManager || (senior && senior.id) || '';
    S.update('teams', t.id, { leadId: lead });
    issues.push(['Team: ' + tn, 'Suggested Lead: ' + Core.nameOf(S, lead) + '. Confirm or change it on the People & teams page.']);
  });

  var out = S.ss.getSheetByName('Import issues') || S.ss.insertSheet('Import issues');
  out.clear();
  out.getRange(1, 1, 1, 2).setValues([['Who', 'Issue']]).setFontWeight('bold');
  if (issues.length) out.getRange(2, 1, issues.length, 2).setValues(issues);
  return rows.length + ' roster rows read; ' + issues.length + ' issues written to the "Import issues" sheet.';
}

function levelFor(grade) {
  var g = String(grade || '').toUpperCase();
  if (g === 'T5') return '1';
  if (['A3', 'L4', 'CAFM'].indexOf(g) >= 0) return '2';
  if (['A2', 'COORD', 'T4'].indexOf(g) >= 0) return '3';
  if (['SUP', 'SUPW', 'CAF'].indexOf(g) >= 0) return '5';
  return '4';
}

function resolveName(people, name) {
  var n = name.toLowerCase().trim();
  var exact = people.filter(function (p) { return p.name.toLowerCase() === n; });
  var sameFirst = people.filter(function (p) { return p.name.toLowerCase().split(/\s+/)[0] === n.split(/\s+/)[0]; });
  if (exact.length === 1 && (n.indexOf(' ') > 0 || sameFirst.length === 1)) return { match: exact[0] };
  if (exact.length >= 1 && sameFirst.length > 1) return { many: sameFirst.map(function (p) { return p.name; }) };
  var starts = people.filter(function (p) { return p.name.toLowerCase().split(/\s+/)[0] === n.split(/\s+/)[0] && p.name.toLowerCase().indexOf(n) === 0; });
  if (starts.length === 1) return { match: starts[0], fuzzy: true };
  if (starts.length > 1) return { many: starts.map(function (p) { return p.name; }) };
  return {};
}

function teamFor(r) {
  var d = r.designation, e = r.entity, g = String(r.grade).toUpperCase();
  if (/^cfal/i.test(e)) {
    if (/^T\d/.test(g) || g === 'CON') {
      if (/principal/i.test(d)) return 'CFAL Leadership';
      var subj = d.split(',').pop().trim();
      if (/english|sanskrit|hindi|kannada|^cfal$/i.test(subj)) return 'CFAL Languages and optional subjects';
      return 'CFAL ' + (subj || 'Academics');
    }
    if (/warden/i.test(d)) return 'CFAL Hostel';
    if (/housekeeping|maintenance/i.test(d)) return 'CFAL Housekeeping and maintenance';
    if (/driver/i.test(d)) return 'CFAL Transport';
    if (g === 'IT' || g === 'DATA') return 'CFAL IT and data';
    if (/front desk/i.test(d)) return 'CFAL Front desk';
    if (/marketing|finance/i.test(d)) return 'Marketing, IT and finance';
    if (/caf/i.test(e) || /caf/i.test(d)) return 'Café';
    return 'CFAL Academic administration';
  }
  if (/montessori/i.test(d)) return 'School Kindergarten and Montessori';
  if (/primary/i.test(d)) return 'School Primary';
  if (/middle/i.test(d)) return 'School Middle school';
  if (/languages|PE|special/i.test(d)) return 'School Languages, PE and special education';
  if (/high school/i.test(d) || /high school/i.test(e)) return 'School High school';
  if (/caf/i.test(e)) return 'Café';
  if (/support/i.test(e)) return 'School Support staff';
  if (/coordination|leadership/i.test(e)) return 'School Coordinators';
  if (/marketing/i.test(e)) return 'Marketing, IT and finance';
  return 'School Admin office';
}
