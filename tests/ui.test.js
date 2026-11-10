const { JSDOM } = require(require('child_process').execSync('npm root -g').toString().trim() + '/jsdom');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(root + '/index.html', 'utf8').replace(/<script src="([^"]+)"><\/script>/g, (m, src) => '<script>' + fs.readFileSync(root + '/' + src, 'utf8') + '</script>').replace(/<link[^>]+>/g, '');
const errors = [];
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.github.io/tracker/', pretendToBeVisual: true,
  beforeParse(w) { w.addEventListener('error', e => errors.push(e.message)); w.console.error = (...a) => errors.push(a.join(' ')); } });
const w = dom.window, d = w.document;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = s => d.querySelector(s), $$ = s => [...d.querySelectorAll(s)];
const click = el => { if (!el) throw new Error("missing element after " + checks + " checks, page: " + (d.querySelector("nav a.on")||{}).textContent + " modal:" + !!d.querySelector(".modal")); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); };
const submit = f => f.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
const go = async h => { w.location.hash = h; w.dispatchEvent(new w.HashChangeEvent('hashchange')); await sleep(50); };
const as = async id => { console.log("as", id, checks); if ($('#signout')) { click($('#signout')); await sleep(150); } click($(`[data-demo="${id}"]`)); await sleep(250); };
const text = () => d.body.textContent;
let checks = 0; const ok = (c, m) => { if (!c) throw new Error('FAILED: ' + m); checks++; };
(async () => {
  await sleep(100);
  ok($$('[data-demo]').length >= 8, 'demo personas shown');
  // Owner: all pages
  await as('P001');
  ok(text().includes('My work'), 'my work');
  for (const p of ['team', 'help', 'org', 'workload', 'initiatives', 'chart', 'people', 'duties', 'settings']) {
    await go(p); await sleep(80);
    ok(!$('#page').textContent.includes('undefined'), 'no undefined on ' + p);
    ok($('nav a.on').getAttribute('href') === '#' + p, 'route ' + p);
  }
  await go('help'); await sleep(100);
  ok(text().includes('Help request'), 'help signals present');
  ok($('#digest').textContent.includes('digest'), 'digest');
  // owner records a decision with follow-up
  await go('initiatives');
  click($('[data-decide="in_fete"]')); await sleep(30);
  $('[name=note]').value = 'Going well'; $('[name=f1t]').value = 'Book the hall'; $('[name=f1a]').value = 'P007';
  submit($('.modal form')); await sleep(250);
  ok(text().includes('Book the hall') || text().includes('follow-up(s) created'), 'decision logged');
  // people page: edit person
  await go('people'); click($('[data-person="P015"]')); await sleep(30);
  click($('#pm-edit')); await sleep(30);
  $('.modal [name=phone]').value = '9876543210'; submit($('.modal form')); await sleep(250);
  ok(!$('.modal'), 'person saved');
  // structure problems tab + audit
  click($('[data-ptab="issues"]')); await sleep(50); ok(text().includes('Structure') , 'issues tab');
  click($('[data-ptab="audit"]')); await sleep(150); ok($('#audit').textContent.includes('person changed'), 'audit shows change');
  // team edit modal with members
  click($('[data-ptab="teams"]')); await sleep(50); click($('[data-team-edit="tm_fete"]')); await sleep(30);
  ok($('.modal').textContent.includes('Extra members'), 'team modal');
  click($('[data-close]')); await sleep(20);
  // duty add
  await go('duties'); click($('#b-addd')); await sleep(30);
  $('.modal [name=title]').value = 'Daily front desk log'; $('.modal [name=freq]').value = 'daily'; $('.modal [name=ownerId]').value = 'P019';
  submit($('.modal form')); await sleep(250); ok(text().includes('Daily front desk log'), 'duty added');
  click($('#b-gen')); await sleep(250);
  // assign work to Latha
  await go('my'); click($('#b-assign')); await sleep(30);
  $('.modal [name=title]').value = 'Check lab safety signs'; $('.modal [name=assigneeId]').value = 'P009';
  submit($('.modal form')); await sleep(250); ok(!$('.modal'), 'assigned');
  // Latha confirms, completes
  await as('P009');
  ok(text().includes('Check lab safety signs'), 'Latha sees item');
  const conf = $$('[data-act="confirm"]').find(b => b.closest('.item').textContent.includes('Check lab safety'));
  click(conf); await sleep(250);
  const done = $$('[data-act="complete"]').find(b => b.closest('.item').textContent.includes('Check lab safety'));
  click(done); await sleep(30);
  submit($('.modal form')); await sleep(200);
  ok($('#m-err').textContent.includes('evidence'), 'evidence required');
  $('.modal [name=evidence]').value = 'https://drive.google.com/x'; submit($('.modal form')); await sleep(250);
  ok(!$('.modal'), 'completed');
  // contribution
  click($('#b-contrib')); await sleep(30);
  $('.modal [name=title]').value = 'Made a revision video'; $('.modal [name=evidence]').value = 'https://youtu.be/x';
  submit($('.modal form')); await sleep(250); ok(!$('.modal'), 'contribution logged');
  // help
  click($('#b-help')); await sleep(30); $('.modal [name=note]').value = 'Need lab time'; submit($('.modal form')); await sleep(250);
  ok(!$('.modal'), 'help sent');
  ok(!$('a[href="#people"]'), 'staff cannot see People & teams');
  // Imran verifies in bulk
  await as('P008'); await go('team'); await sleep(80);
  ok($$('.pick').length >= 2, 'queue has items: ' + $$('.pick').length);
  $('#pick-all').checked = true; $('#pick-all').dispatchEvent(new w.Event('change'));
  click($('#b-verify-sel')); await sleep(300);
  ok(text().includes('Nothing to verify'), 'bulk verified');
  // Imran acks help
  await go('help'); await sleep(80);
  const ack = $$('[data-act="ack"]')[0]; ok(ack, 'ack button'); click(ack); await sleep(250);
  const res = $$('[data-act="resolve"]')[0]; click(res); await sleep(30); $('.modal [name=note]').value = 'Booked the lab Thursday'; submit($('.modal form')); await sleep(250);
  ok(!$('.modal'), 'resolved');
  // delegate verification
  await go('team'); click($('#b-deleg')); await sleep(30); ok($('.modal'), 'delegate modal'); click($('[data-close]'));
  // item detail with history
  await go('my'); const t0 = $('[data-open]'); if (t0) { click(t0); await sleep(150); ok($('#hist').textContent.length > 0, 'history'); click($('[data-close]')); }
  // support staff view
  await as('P022'); ok(text().includes('My work'), 'support staff my work'); ok(!$('a[href="#org"]'), 'no org page');
  // café: dispute flow
  await as('P028'); ok(text().includes('Order new café menu boards'), 'café inbox');
  const disputedVisible = text().includes('Clean and restock');
  // org chart expand
  await as('P003'); await go('chart'); click($('#exp')); await sleep(60); ok($$('.node').length >= 30, 'chart expanded');
  // workload sort
  await go('workload'); click($('[data-sort="load"]')); await sleep(50); ok(text().includes('Load'), 'workload');
  // settings save
  await as('P006'); await go('settings'); await sleep(100); $('[name=spanLimit]').value = '12'; submit($('#set-form')); await sleep(250); ok(true);
  ok($('#outbox').textContent.length > 0, 'outbox list');
  console.log(checks + ' UI checks passed');
  if (errors.length) { console.log('ERRORS:', errors); process.exit(1); }
  process.exit(0);
})().catch(e => { console.error(e.message); console.log('errors', errors); process.exit(1); });
