const vm = require('vm'), fs = require('fs'), assert = require('assert');
const { install } = require('./gas-mocks');
const props = { ADMIN_NAME: 'Asha Menon', ADMIN_PASSWORD: 'firstpass123', OWNER_NAMES: 'Asha Menon,Rahul Shenoy', WATI_ENDPOINT: 'https://live.wati.test', WATI_TOKEN: 'tok', WEBHOOK_KEY: 'k1', TEST_PHONE: '9000000001' };
const ctx = { Date, Math, JSON, String, Number, Object, Array, Error, RegExp, encodeURIComponent, isNaN, Buffer };
vm.createContext(ctx);
const ss = install(ctx, props);
vm.runInContext(fs.readFileSync(__dirname + '/../assets/core.js', 'utf8').replace(/^var Core/m, 'var Core') , ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../assets/insights.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../apps-script/Code.gs', 'utf8'), ctx);
const call = (body, params) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) }, parameter: params || {} }).text);

console.log(ctx.setup());
// roster: real roster file if present (local only, never committed), else a small sample
let rosterRows;
const rosterPath = process.env.ROSTER_TSV;
if (rosterPath && fs.existsSync(rosterPath)) rosterRows = fs.readFileSync(rosterPath, 'utf8').trim().split('\n').slice(1).map(l => l.split('\t'));
else rosterRows = [
  ['Kavitha Rao', 'T5', 'Principal and Director of Research', 'CFAL', 'Asha Menon'],
  ['Nisha Kamath', 'A3', 'Administrator, Academic Coordination', 'CFAL', 'Kavitha Rao'],
  ['Imran Sheikh', 'T4', 'Senior Lecturer, Physics', 'CFAL', 'Nisha Kamath'],
  ['Latha Nayak', 'T3', 'Lecturer, Physics', 'CFAL', 'Nisha Kamath'],
  ['Ramesh Gowda', 'SUPW', 'Warden', 'CFAL', 'Deepak'],
  ['Deepak Shetty', 'A3', 'Administrator, Operations', 'CFAL', 'Kavitha Rao'],
  ['Old Staffer', 'T1', 'Junior Lecturer, Physics', 'CFAL', 'Discontinued']
];
const R = ss.getSheetByName('Roster');
R.getRange(2, 1, rosterRows.length, 6).setValues(rosterRows.map(r => [r[0], r[1], r[2], r[3], r[4], r[5] || '']));
console.log(ctx.importRoster());
console.log(ctx.createAdmin());
const people = ss.getSheetByName('people').data.slice(1);
const owner = people.find(r => r[1] === 'Asha Menon');
assert(owner, 'Asha Menon created');
// login
let r = call({ action: 'login', payload: { id: owner[0], password: 'wrong' } });
assert(!r.ok && r.auth);
r = call({ action: 'login', payload: { id: owner[0], password: 'firstpass123' } });
assert(r.ok && r.data.mustChange, JSON.stringify(r));
const tok = r.data.token;
r = call({ action: 'token', token: tok, action: 'bootstrap' });
assert(!r.ok && r.mustChange, 'must change first');
r = call({ action: 'changePassword', token: tok, payload: { oldPassword: 'firstpass123', newPassword: 'a-better-pass-9' } });
assert(r.ok, JSON.stringify(r));
r = call({ action: 'bootstrap', token: tok });
assert(r.ok, JSON.stringify(r));
console.log('bootstrap people', r.data.people.length, 'teams', r.data.teams.length, 'items', r.data.items.length);
call({ action: 'act', token: tok, name: 'saveSettings', payload: { quietStart: '0', quietEnd: '0' } });
// make a lecturer login
const latha = r.data.people.find(p => p.name.startsWith('Latha'));
const lead = r.data.people.find(p => p.name === 'Imran Sheikh');
r = call({ action: 'act', token: tok, name: 'savePerson', payload: Object.assign({}, lead, { phone: '9876543210' }) }); assert(r.ok, JSON.stringify(r));
r = call({ action: 'act', token: tok, name: 'savePerson', payload: Object.assign({}, latha, { phone: '9876500000', verifierId: lead.id }) }); assert(r.ok, JSON.stringify(r));
r = call({ action: 'resetPassword', token: tok, payload: { personId: latha.id } }); assert(r.ok);
const temp = r.data.tempPassword;
let a = call({ action: 'login', payload: { id: '98765 00000', password: temp } }); assert(a.ok, JSON.stringify(a));
call({ action: 'changePassword', token: a.data.token, payload: { oldPassword: temp, newPassword: 'latha-pass-1' } });
const atok = a.data.token;
// Asha Menon assigns a task to Latha
r = call({ action: 'act', token: tok, name: 'createItem', payload: { title: 'Prepare Physics practice set 4', assigneeId: latha.id, due: '2030-01-01' } });
assert(r.ok && r.data.status === 'confirm', JSON.stringify(r));
const itemId = r.data.id;
console.log("whatsapp sends so far", ctx.fetched.length, JSON.stringify(ss.getSheetByName("outbox").data));
assert(ctx.fetched.length > 0 && ctx.fetched.every(f => f.url.includes('919000000001')), 'test mode: only the test phone');
assert(ctx.fetched.some(f => decodeURIComponent(f.url).includes('[TEST → Latha')), 'labelled with real recipient');
assert.equal(ctx.sentMail.length, 0, 'no email in test mode');
// Latha replies on WhatsApp
const code = itemId.replace(/^it_/, '').slice(-6).toUpperCase();
const wh = (from, text) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ waId: from, text }) }, parameter: { webhook: 'wati', key: 'k1' } }).text);
// a staff phone is ignored in test mode
wh('919876500000', 'CONFIRM ' + code);
assert.equal(call({ action: 'bootstrap', token: atok }).data.items.find(x => x.id === itemId).status, 'confirm', 'staff phone ignored in test mode');
wh('919000000001', 'AS ' + latha.id);
let w = wh('919000000001', 'CONFIRM ' + code);
assert(w.ok);
w = wh('919000000001', 'DONE ' + code + ' https://drive.google.com/x');
r = call({ action: 'bootstrap', token: atok });
const it = r.data.items.find(x => x.id === itemId);
assert.equal(it.status, 'review'); assert.equal(it.verifierId, lead.id);
// Latha cannot see owner-only things
r = call({ action: 'auditLog', token: atok }); assert(!r.ok);
r = call({ action: 'act', token: atok, name: 'savePerson', payload: { id: latha.id, name: 'x' } }); assert(!r.ok);
// bad webhook key
w = JSON.parse(ctx.doPost({ postData: { contents: '{"waId":"1","text":"MY WORK"}' }, parameter: { webhook: 'wati', key: 'bad' } }).text); assert(!w.ok);
// jobs
ctx.hourlyJob(); ctx.dailyJob();
console.log('outbox rows', ss.getSheetByName('outbox').data.length - 1, 'whatsapp calls', ctx.fetched.length);
console.log('import issues', ss.getSheetByName('Import issues').data.length - 1);
console.log('auth sheet hidden', ss.getSheetByName('auth').hidden);
assert(ctx.fetched.every(f => f.url.includes('919000000001')), 'still only the test phone after jobs');
// with no TEST_PHONE, nothing at all is sent
delete props.TEST_PHONE; const before = ctx.fetched.length;
call({ action: 'act', token: tok, name: 'createItem', payload: { title: 'Another task for Latha', assigneeId: latha.id } });
assert.equal(ctx.fetched.length, before, 'held when no TEST_PHONE');
// ---- summaries
console.log(ctx.installTriggers());
let sm = call({ action: 'summarize', token: tok, payload: { type: 'weekly', scopeType: 'org', period: 'week' } });
assert(sm.ok && sm.data.source === 'template', JSON.stringify(sm));
sm = call({ action: 'summarize', token: atok, payload: { type: 'weekly', scopeType: 'org', period: 'week' } });
assert(!sm.ok, 'staff cannot summarise the org');
sm = call({ action: 'summarize', token: atok, payload: { type: 'term', scopeType: 'person', scopeId: latha.id, period: 'term' } });
assert(sm.ok, 'staff can summarise themselves');
props.AI_PROVIDER = 'gemini'; props.AI_API_KEY = 'k';
sm = call({ action: 'summarize', token: tok, payload: { type: 'initiative', scopeType: 'function', scopeId: 'Academics', period: 'month' } });
assert(sm.ok && sm.data.source === 'AI: gemini' && /AI SUMMARY/.test(sm.data.text), JSON.stringify(sm));
assert(ctx.aiCalls[0].opt.headers['x-goog-api-key'] === 'k' && !/key=/.test(ctx.aiCalls[0].url), 'key in header not URL');
const sent = JSON.parse(ctx.aiCalls[0].opt.payload); assert(/ONLY the facts/.test(sent.systemInstruction.parts[0].text));
props.AI_PROVIDER = 'claude';
sm = call({ action: 'summarize', token: tok, payload: { type: 'weekly', scopeType: 'person', scopeId: latha.id, period: 'week' } });
assert(sm.ok && /claude/.test(sm.data.text), JSON.stringify(sm));
const bs = call({ action: 'bootstrap', token: atok }); assert(bs.data.summaries.every(r => r.scopeType === 'person' && r.scopeId === latha.id), 'staff only sees own summaries');
ctx.weeklyJob();
r = call({ action: 'queueTermSummaries', token: tok }); assert(r.ok && r.data.queued > 3);
ctx.hourlyJob(); assert.equal(props.TERM_QUEUE, '', 'queue drained');
console.log('summaries stored', ss.getSheetByName('summaries').data.length - 1, 'AI calls', ctx.aiCalls.length);
console.log('ALL GAS TESTS PASSED');
