/* Work Tracker — browser app. Plain JavaScript, no build step. */
(function () {
  'use strict';
  var cfg = window.WT_CONFIG || {};
  var st = { data: null, S: null, meId: '', me: null, today: '', sub: {}, scope: null };

  // ------------------------------------------------------------------ helpers
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(s) { if (!s) return ''; var p = String(s).slice(0, 10).split('-'); return +p[2] + ' ' + MONTHS[+p[1] - 1] + (p[0] !== String(new Date().getFullYear()) ? ' ' + p[0] : ''); }
  function fmtWhen(iso) { if (!iso) return ''; var d = new Date(iso); return fmtDate(Core.isoDate(d)) + ', ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(function () { t.classList.remove('show'); }, 2800); }
  function nm(id) { if (id === 'system') return 'System'; var p = st.S && Core.person(st.S, id); return p ? p.name : (id || '—'); }
  function teamById(id) { return st.data.teams.filter(function (t) { return t.id === id; })[0]; }
  function teamName(id) { var t = teamById(id); return t ? t.name : ''; }
  function iniName(id) { var i = st.data.initiatives.filter(function (x) { return x.id === id; })[0]; return i ? i.title : ''; }
  function isLink(s) { return /^https?:\/\//i.test(String(s || '').trim()); }
  function activePeople() { return st.data.people.filter(function (p) { return p.status !== 'left'; }).sort(function (a, b) { return a.name.localeCompare(b.name); }); }
  function isOwner() { return Core.isOwner(st.me); }
  function isSys() { return Core.isSys(st.me); }
  function isHR() { return Core.hasRole(st.me, 'hr'); }
  function isAdmin() { return Core.hasRole(st.me, 'admin') || isSys(); }
  function myLedTeams() { return Core.teamsLedBy(st.S, st.meId); }
  function isLead() { return isOwner() || myLedTeams().length > 0 || Core.spanOf(st.S, st.meId, st.today) > 0; }
  function scope() { if (!st.scope) st.scope = Core.scopeIds(st.S, st.meId, st.today); return st.scope; }
  function assignable() {
    if (isOwner()) return activePeople();
    var sc = scope(), extra = {};
    myLedTeams().forEach(function (t) { Core.teamMemberIds(st.S, t.id).forEach(function (id) { extra[id] = true; }); });
    return activePeople().filter(function (p) { return sc[p.id] || extra[p.id] || p.id === st.meId; });
  }
  function personOptions(list, selected, blank) {
    var byTeam = {};
    list.forEach(function (p) { var k = teamName(p.homeTeamId) || 'No team'; (byTeam[k] = byTeam[k] || []).push(p); });
    var html = blank !== undefined ? '<option value="">' + esc(blank) + '</option>' : '';
    Object.keys(byTeam).sort().forEach(function (k) {
      html += '<optgroup label="' + esc(k) + '">' + byTeam[k].map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === selected ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</optgroup>';
    });
    return html;
  }
  function initiativeOptions(selected) {
    var html = '<option value="">No initiative (routine work)</option>';
    st.data.priorities.forEach(function (pr) {
      var inis = st.data.initiatives.filter(function (i) { return i.priorityId === pr.id && i.status !== 'stopped'; });
      if (!inis.length) return;
      html += '<optgroup label="' + esc(pr.title) + '">' + inis.map(function (i) { return '<option value="' + esc(i.id) + '"' + (i.id === selected ? ' selected' : '') + '>' + esc(i.title) + '</option>'; }).join('') + '</optgroup>';
    });
    var other = st.data.initiatives.filter(function (i) { return !i.priorityId && i.status !== 'stopped'; });
    if (other.length) html += '<optgroup label="Other">' + other.map(function (i) { return '<option value="' + esc(i.id) + '"' + (i.id === selected ? ' selected' : '') + '>' + esc(i.title) + '</option>'; }).join('') + '</optgroup>';
    return html;
  }
  function teamOptions(teams, selected, blank) {
    return (blank !== undefined ? '<option value="">' + esc(blank) + '</option>' : '') + teams.map(function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === selected ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('');
  }
  function opts(list, selected) { return list.map(function (x) { var v = Array.isArray(x) ? x[0] : x, l = Array.isArray(x) ? x[1] : x; return '<option value="' + esc(v) + '"' + (String(v) === String(selected) ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join(''); }

  // ------------------------------------------------------------------ data
  function load() {
    return API.bootstrap().then(function (d) {
      st.data = d; st.S = new MemoryStore(d); st.meId = d.meId; st.today = d.today; st.scope = null;
      st.me = Core.person(st.S, d.meId);
      render();
    }).catch(handleErr);
  }
  function handleErr(e) {
    if (e && e.mustChange) return renderChangePassword(true);
    if (e && e.auth) return renderSignIn(e.message);
    toast((e && e.message) || 'Something went wrong');
  }
  function doAct(name, payload, okMsg) {
    return API.act(name, payload).then(function (r) { if (okMsg) toast(okMsg); return load().then(function () { return r; }); });
  }

  // ------------------------------------------------------------------ modal
  function openModal(html, opts) {
    opts = opts || {};
    $('#modal-root').innerHTML = '<div class="modal-back"><div class="modal' + (opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' + html + '</div></div>';
    var back = $('.modal-back');
    back.addEventListener('click', function (e) { if (e.target === back) closeModal(); });
    var first = $('.modal input, .modal select, .modal textarea');
    if (first) setTimeout(function () { first.focus(); }, 30);
    return $('.modal');
  }
  function closeModal() { $('#modal-root').innerHTML = ''; }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  /** A form modal: fields html, submit(values) returns a promise. Errors show inside the modal. */
  function formModal(title, intro, fieldsHtml, submitLabel, submit, opts) {
    var m = openModal('<h2>' + esc(title) + '</h2>' + (intro ? '<p class="meta">' + intro + '</p>' : '') + '<form novalidate>' + fieldsHtml +
      '<div class="err" id="m-err"></div><div class="foot"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn" type="submit">' + esc(submitLabel) + '</button></div></form>', opts);
    $('[data-close]', m).onclick = closeModal;
    var form = $('form', m);
    form.onsubmit = function (e) {
      e.preventDefault();
      var vals = {};
      $$('[name]', form).forEach(function (el) {
        if (el.type === 'checkbox') { if (el.checked) (vals[el.name] = vals[el.name] || []).push(el.value); }
        else if (el.multiple) vals[el.name] = $$('option', el).filter(function (o) { return o.selected; }).map(function (o) { return o.value; });
        else vals[el.name] = el.value.trim();
      });
      var btn = $('button[type=submit]', form); btn.disabled = true;
      Promise.resolve().then(function () { return submit(vals, form); }).then(function () { closeModal(); }).catch(function (er) {
        btn.disabled = false; $('#m-err').textContent = (er && er.message) || 'Something went wrong';
      });
    };
    return m;
  }
  function segField(name, choices, value) {
    return '<input type="hidden" name="' + name + '" value="' + esc(value) + '"><div class="seg" data-seg="' + name + '">' + choices.map(function (c) { return '<button type="button" data-v="' + esc(c[0]) + '" class="' + (c[0] === value ? 'on' : '') + '">' + esc(c[1]) + '</button>'; }).join('') + '</div>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-seg] button');
    if (!b) return;
    var seg = b.parentNode;
    $$('button', seg).forEach(function (x) { x.classList.toggle('on', x === b); });
    var input = seg.previousElementSibling;
    input.value = b.dataset.v;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  function bandField(v) { return '<label>Time spent</label>' + segField('band', [['<1', 'Under 1h'], ['1-3', '1–3h'], ['3-6', '3–6h'], ['6+', '6h+']], v || '1-3'); }

  // ------------------------------------------------------------------ item rendering
  function statusPill(it) { return '<span class="pill st-' + it.status + '">' + esc(Core.STATUS[it.status] || it.status) + '</span>'; }
  function kindPill(it) { return it.kind === 'task' ? '' : '<span class="pill k-' + it.kind + '">' + esc(Core.KINDS[it.kind]) + '</span>'; }
  function actionsFor(it) {
    var a = [], me = st.meId, S = st.S, t = st.today;
    var mine = it.assigneeId === me;
    if (it.status === 'confirm' && mine) { a.push(['confirm', 'Confirm', 'teal']); a.push(['dispute', 'Not correct', 'secondary']); }
    if (it.status === 'disputed' && (it.createdBy === me || Core.canHandleHelp(S, me, it, t))) { a.push(['fix', 'Fix and resend', '']); a.push(['cancel', 'Cancel item', 'secondary']); }
    if ((it.status === 'open' || it.status === 'blocked') && mine) a.push(['complete', 'Done', 'teal']);
    if (it.status === 'open' && mine) a.push(['help', 'Need help', 'secondary']);
    if (it.status === 'blocked' && !mine && Core.canHandleHelp(S, me, it, t)) { if (!it.helpAckAt) a.push(['ack', 'I\'m on it', '']); a.push(['resolve', 'Resolve', 'teal']); }
    if (it.status === 'blocked' && mine) a.push(['resolve', 'Sorted, close request', 'secondary']);
    if (it.status === 'review' && Core.canVerify(S, me, it, t)) { a.push(['verify', 'Verify', 'teal']); a.push(['return', 'Return', 'secondary']); }
    if (!it.assigneeId && it.teamId && Core.OPEN.indexOf(it.status) >= 0) {
      var leads = myLedTeams().some(function (x) { return x.id === it.teamId; });
      if (leads || isOwner()) a.push(['assignInbox', 'Assign', '']);
      if (Core.teamMemberIds(S, it.teamId).indexOf(me) >= 0) a.push(['claim', 'I\'ll take it', 'secondary']);
    }
    if ((it.status === 'verified' || it.status === 'closed') && !mine && (it.verifiedBy === me || it.helpAckBy === me || isOwner() || Core.canHandleHelp(S, me, it, t))) a.push(['thank', 'Say thanks', 'secondary']);
    if (mine && it.status === 'closed' && it.helpAckBy) a.push(['thank', 'Thank ' + nm(it.helpAckBy).split(' ')[0], 'secondary']);
    return a;
  }
  function itemRow(it, opts) {
    opts = opts || {};
    var overdue = Core.isOverdue(it, st.today);
    var bits = [];
    if (opts.showWho !== false && it.assigneeId && it.assigneeId !== st.meId) bits.push(esc(nm(it.assigneeId)));
    if (!it.assigneeId && it.teamId) bits.push('Team inbox: ' + esc(teamName(it.teamId)));
    if (it.due) bits.push((overdue ? '<span class="bad">' : '') + 'Due ' + fmtDate(it.due) + (it.dueTime ? ' ' + esc(it.dueTime) : '') + (overdue ? '</span>' : ''));
    if (it.initiativeId) bits.push(esc(iniName(it.initiativeId)));
    if (it.band) bits.push(esc(Core.BAND_LABELS[it.band] || it.band));
    if (it.createdBy && it.createdBy !== it.assigneeId && it.createdBy !== 'system' && opts.showFrom !== false) bits.push('from ' + esc(nm(it.createdBy)));
    var notes = '';
    if (it.status === 'disputed') notes += '<div class="note red">Disputed: ' + esc(it.disputeReason) + '</div>';
    if (it.returnNote && it.status === 'open') notes += '<div class="note">Returned: ' + esc(it.returnNote) + '</div>';
    if (it.status === 'blocked') notes += '<div class="note red">Help needed: ' + esc(it.helpReason) + (it.helpAckAt ? ' · ' + esc(nm(it.helpAckBy)) + ' is on it' : '') + '</div>';
    if (it.status === 'review' && it.evidence) notes += '<div class="meta">Evidence: ' + evidenceHtml(it) + (it.verifierId ? ' · verifier ' + esc(nm(it.verifierId)) : '') + '</div>';
    if (it.thanks && opts.showThanks) notes += '<div class="note teal">' + esc(it.thanks).replace(/\n/g, '<br>') + '</div>';
    var btns = opts.noButtons ? [] : actionsFor(it);
    return '<div class="item">' + (opts.check ? '<input type="checkbox" class="pick" value="' + esc(it.id) + '" style="width:auto;margin-right:8px">' : '') +
      '<span class="t" data-open="' + esc(it.id) + '">' + esc(it.title) + '</span> ' + kindPill(it) + (opts.noStatus ? '' : statusPill(it)) + (overdue ? '<span class="pill overdue">Overdue</span>' : '') +
      '<div class="meta">' + bits.join(' · ') + '</div>' + notes +
      (btns.length ? '<div class="btns">' + btns.map(function (b) { return '<button class="btn sm ' + b[2] + '" data-act="' + b[0] + '" data-id="' + esc(it.id) + '">' + esc(b[1]) + '</button>'; }).join('') + '</div>' : '') + '</div>';
  }
  function evidenceHtml(it) {
    var e = it.evidence || '';
    if (isLink(e)) return '<a href="' + esc(e) + '" target="_blank" rel="noopener">' + esc(e.length > 48 ? e.slice(0, 48) + '…' : e) + '</a>';
    return esc(e);
  }
  function list(items, empty, opts) {
    return items.length ? items.map(function (it) { return itemRow(it, opts); }).join('') : '<p class="empty">' + esc(empty) + '</p>';
  }
  function card(title, count, body) { return '<div class="card"><h2>' + esc(title) + (count !== null && count !== undefined ? ' <span class="n">(' + count + ')</span>' : '') + '</h2>' + body + '</div>'; }

  // ------------------------------------------------------------------ item actions
  function itemById(id) { return st.data.items.filter(function (x) { return x.id === id; })[0]; }
  var ACT = {
    confirm: function (it) { doAct('confirm', { id: it.id }, 'Confirmed').catch(handleErr); },
    ack: function (it) { doAct('ackHelp', { id: it.id }, nm(it.assigneeId) + ' has been told you are on it').catch(handleErr); },
    verify: function (it) { doAct('verify', { id: it.id }, 'Verified').catch(handleErr); },
    claim: function (it) { doAct('claim', { id: it.id }, 'It\'s yours').catch(handleErr); },
    dispute: function (it) {
      formModal('Not correct', esc(it.title), '<label>What is wrong?</label><select name="reason">' + opts(Core.DISPUTE_REASONS, '') + '</select><label>Details <span class="hint">optional</span></label><textarea name="note"></textarea>', 'Send back',
        function (v) { return doAct('dispute', { id: it.id, reason: v.reason, note: v.note }, 'Sent back to ' + nm(it.createdBy)); });
    },
    fix: function (it) {
      formModal('Fix and resend', 'Disputed: ' + esc(it.disputeReason),
        '<label>Title</label><input name="title" value="' + esc(it.title) + '"><label>Assignee</label><select name="assigneeId">' + personOptions(assignable(), it.assigneeId) + '</select><label>Due</label><input type="date" name="due" value="' + esc(it.due) + '"><label>Note to them <span class="hint">optional</span></label><input name="note">',
        'Resend', function (v) { return doAct('fixDispute', { id: it.id, title: v.title, assigneeId: v.assigneeId, due: v.due, note: v.note }, 'Resent for confirmation'); });
    },
    cancel: function (it) {
      formModal('Cancel this item', esc(it.title) + '. It stays in the history but no longer counts.', '<label>Why?</label><input name="note">', 'Cancel item', function (v) { return doAct('cancel', { id: it.id, note: v.note }, 'Cancelled'); });
    },
    complete: function (it) {
      var ppl = activePeople().filter(function (p) { return p.id !== st.meId; });
      var m = formModal('Mark as done', esc(it.title) + (it.notes ? '<br>' + esc(it.notes) : ''),
        '<label>Evidence</label>' + segField('evidenceType', [['link', 'Link'], ['photo', 'Photo or file name'], ['witness', 'A colleague can confirm']], 'link') +
        '<div id="ev-in" style="margin-top:8px"><input name="evidence" placeholder="Paste a Google Drive, LMS or sheet link"></div>' + bandField(it.band),
        'Mark done', function (v) { return doAct('complete', { id: it.id, evidence: v.evidenceType === 'witness' && v.evidence ? 'Witness: ' + nm(v.evidence) : v.evidence, evidenceType: v.evidenceType, band: v.band }, 'Done. Sent for verification'); });
      $('[name=evidenceType]', m).addEventListener('change', function (e) {
        var t = e.target.value;
        $('#ev-in', m).innerHTML = t === 'witness' ? '<select name="evidence">' + personOptions(ppl, '', 'Choose a colleague…') + '</select>' : '<input name="evidence" placeholder="' + (t === 'photo' ? 'Photo or file name, e.g. register-12-nov.jpg' : 'Paste a Google Drive, LMS or sheet link') + '">';
      });
    },
    help: function (it) { helpModal(it); },
    resolve: function (it) {
      formModal(it.assigneeId === st.meId ? 'Close your help request' : 'Resolve help request', esc(it.helpReason), '<label>What was done?</label><textarea name="note"></textarea>', 'Resolve',
        function (v) { return doAct('resolveHelp', { id: it.id, note: v.note }, it.assigneeId === st.meId ? 'Closed' : nm(it.assigneeId) + ' has been told'); });
    },
    'return': function (it) {
      formModal('Return to ' + nm(it.assigneeId), esc(it.title), '<label>What is missing or needs changing?</label><textarea name="note"></textarea>', 'Return', function (v) { return doAct('returnItem', { id: it.id, note: v.note }, 'Returned'); });
    },
    thank: function (it) {
      formModal('Say thanks', esc(it.title), '<label>Message</label><input name="note" value="Thank you!">', 'Send', function (v) { return doAct('thank', { id: it.id, note: v.note }, 'Thanks sent'); });
    },
    assignInbox: function (it) {
      var members = Core.teamMemberIds(st.S, it.teamId).map(function (id) { return Core.person(st.S, id); }).filter(Boolean);
      formModal('Assign from the team inbox', esc(it.title), '<label>Who?</label><select name="assigneeId">' + personOptions(members, '') + '</select>', 'Assign', function (v) { return doAct('claim', { id: it.id, assigneeId: v.assigneeId }, 'Assigned'); });
    }
  };
  function helpModal(it) {
    formModal(it ? 'Ask for help' : 'Ask your Lead for help', it ? esc(it.title) : 'For anything not tied to one item, e.g. too much on this week.',
      '<label>What do you need?</label><select name="reason">' + opts(Core.HELP_REASONS, '') + '</select><label>Details</label><textarea name="note"></textarea><p class="meta">This goes to ' + esc(nm(Core.escalationChain(st.S, st.meId, st.today)[0])) + ' first.</p>',
      'Send', function (v) { return doAct('help', { id: it ? it.id : '', reason: v.reason, note: v.note }, 'Sent. You\'ll be told when it\'s picked up.'); });
  }
  function itemDetail(it) {
    var m = openModal('<h2>' + esc(it.title) + '</h2><div>' + kindPill(it) + statusPill(it) + '</div>' +
      '<table style="margin-top:12px"><tbody>' +
      [['Assigned to', it.assigneeId ? nm(it.assigneeId) : 'Team inbox: ' + teamName(it.teamId)], ['Entered by', nm(it.createdBy) + ' · ' + fmtWhen(it.createdAt)], ['Due', it.due ? fmtDate(it.due) + (it.dueTime ? ' ' + it.dueTime : '') : ''], ['Initiative', iniName(it.initiativeId)],
        ['Time', Core.BAND_LABELS[it.band] || ''], ['Collaborators', Core.list(it.collaborators).map(nm).join(', ')], ['Notes', it.notes], ['Verifier', it.verifierId ? nm(it.verifierId) : ''], ['Verified', it.verifiedBy ? nm(it.verifiedBy) + ' · ' + fmtWhen(it.verifiedAt) : ''],
        ['Help', it.helpReason ? it.helpReason + (it.helpResolution ? ' → ' + it.helpResolution : '') : ''], ['Thanks', it.thanks]]
        .filter(function (r) { return r[1]; }).map(function (r) { return '<tr><td class="meta" style="width:130px">' + esc(r[0]) + '</td><td>' + esc(r[1]).replace(/\n/g, '<br>') + '</td></tr>'; }).join('') +
      (it.evidence ? '<tr><td class="meta">Evidence</td><td>' + evidenceHtml(it) + '</td></tr>' : '') + '</tbody></table>' +
      '<div class="btns" style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap">' + actionsFor(it).map(function (b) { return '<button class="btn sm ' + b[2] + '" data-act="' + b[0] + '" data-id="' + esc(it.id) + '">' + esc(b[1]) + '</button>'; }).join('') +
      ((it.createdBy === st.meId || isOwner()) && (Core.OPEN.indexOf(it.status) >= 0) && it.status !== 'disputed' ? '<button class="btn sm danger" data-act="cancel" data-id="' + esc(it.id) + '">Cancel item</button>' : '') + '</div>' +
      '<h2 style="margin-top:18px;font-size:14px">History</h2><div class="history" id="hist">Loading…</div>' +
      '<form id="cm" class="row" style="margin-top:10px"><input name="note" placeholder="Add a comment"><button class="btn sm secondary" style="flex:0">Add</button></form>' +
      '<div class="foot"><button class="btn secondary" data-close>Close</button></div>', { wide: true });
    $('[data-close]', m).onclick = closeModal;
    API.events(it.id).then(function (evs) {
      $('#hist', m).innerHTML = evs.length ? evs.sort(function (a, b) { return a.at < b.at ? -1 : 1; }).map(function (e) { return '<div><b>' + esc(nm(e.actorId)) + '</b> ' + esc(e.action) + (e.note ? ': ' + esc(e.note) : '') + ' <span class="meta">' + fmtWhen(e.at) + '</span></div>'; }).join('') : '<div class="meta">No history</div>';
    }).catch(function () { $('#hist', m).textContent = 'Could not load history'; });
    $('#cm', m).onsubmit = function (e) { e.preventDefault(); var v = e.target.elements.note.value.trim(); if (!v) return; API.act('comment', { id: it.id, note: v }).then(function () { closeModal(); itemDetail(it); }).catch(handleErr); };
  }
  document.addEventListener('click', function (e) {
    var o = e.target.closest('[data-open]');
    if (o) { var it0 = itemById(o.dataset.open); if (it0) itemDetail(it0); return; }
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var it = itemById(b.dataset.id);
    if (!it || !ACT[b.dataset.act]) return;
    if ($('.modal') && !b.closest('form')) closeModal();
    ACT[b.dataset.act](it);
  });

  // ------------------------------------------------------------------ create work
  function newWorkModal(mode, preset) {
    preset = preset || {};
    if (mode === 'contribution') {
      var ppl = activePeople().filter(function (p) { return p.id !== st.meId; });
      var m = formModal('Log a contribution', 'Work beyond your regular duties that took over an hour or produced something.',
        '<label>What did you do?</label><textarea name="title" placeholder="e.g. Wrote 12 practice problems on electrostatics"></textarea>' +
        '<label>Which initiative did it serve?</label><select name="initiativeId">' + initiativeOptions(preset.initiativeId) + '</select>' +
        '<label>Who benefited, and what changed? <span class="hint">e.g. Grade 12, 3 sections</span></label><input name="notes">' +
        '<label>Evidence</label>' + segField('evidenceType', [['link', 'Link'], ['photo', 'Photo or file name'], ['witness', 'A colleague can confirm']], 'link') +
        '<div id="ev-in" style="margin-top:8px"><input name="evidence" placeholder="Paste a Google Drive link"></div>' +
        '<label>Worked with <span class="hint">optional; hold Ctrl or Cmd to pick several</span></label><select name="collaborators" multiple size="4">' + personOptions(ppl, '') + '</select>' + bandField('1-3'),
        'Log it', function (v) {
          return doAct('createItem', { kind: 'contribution', title: v.title, initiativeId: v.initiativeId, notes: v.notes ? 'Benefit: ' + v.notes : '', evidence: v.evidenceType === 'witness' && v.evidence ? 'Witness: ' + nm(v.evidence) : v.evidence, evidenceType: v.evidenceType, collaborators: v.collaborators, band: v.band }, 'Logged and sent for verification');
        });
      $('[name=evidenceType]', m).addEventListener('change', function (e) {
        var t = e.target.value;
        $('#ev-in', m).innerHTML = t === 'witness' ? '<select name="evidence">' + personOptions(ppl, '', 'Choose a colleague…') + '</select>' : '<input name="evidence" placeholder="' + (t === 'photo' ? 'Photo or file name' : 'Paste a Google Drive link') + '">';
      });
      return;
    }
    var teams = isOwner() ? st.data.teams.filter(function (t) { return t.active !== 'false'; }) : myLedTeams();
    formModal('Assign or log work', 'The person gets it on WhatsApp and confirms it. If it is already done, add the evidence and it goes for verification once they confirm.',
      '<label>Title</label><input name="title" value="' + esc(preset.title || '') + '" placeholder="e.g. Prepare seating plan for the mock test">' +
      '<div class="row"><div><label>Assign to</label><select name="assigneeId">' + personOptions(assignable(), preset.assigneeId || '', 'Choose a person…') + '</select></div>' +
      (teams.length ? '<div><label>…or a team inbox</label><select name="teamId">' + teamOptions(teams, '', 'No') + '</select></div>' : '') + '</div>' +
      '<div class="row"><div><label>Due date</label><input type="date" name="due"></div><div><label>Kind</label><select name="kind">' + opts([['task', 'Task'], ['followup', 'Follow-up from a meeting']], 'task') + '</select></div></div>' +
      '<label>Initiative</label><select name="initiativeId">' + initiativeOptions('') + '</select>' +
      '<label>Notes <span class="hint">optional</span></label><textarea name="notes"></textarea>' +
      '<label>Already done? Evidence <span class="hint">optional: link or photo name</span></label><input name="evidence">',
      'Send', function (v) {
        if (!v.assigneeId && !v.teamId) throw new Error('Choose a person or a team inbox');
        return doAct('createItem', { kind: v.kind, title: v.title, assigneeId: v.assigneeId, teamId: v.assigneeId ? '' : v.teamId, due: v.due, initiativeId: v.initiativeId, notes: v.notes, evidence: v.evidence, evidenceType: v.evidence ? (isLink(v.evidence) ? 'link' : 'photo') : '' }, 'Sent');
      });
  }
  function bulkModal() {
    formModal('Follow-ups from a meeting', 'One action per line, written as: Person name — action — due date (optional, YYYY-MM-DD).',
      '<textarea name="lines" style="min-height:160px" placeholder="Latha Nayak — Share the test blueprint — 2026-11-14"></textarea><label>Initiative</label><select name="initiativeId">' + initiativeOptions('') + '</select>',
      'Create items', function (v) {
        var people = assignable(), made = 0, problems = [];
        var lines = v.lines.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
        var chain = Promise.resolve();
        lines.forEach(function (l) {
          var parts = l.split(/\s+[—–-]\s+/);
          var who = people.filter(function (p) { return p.name.toLowerCase() === String(parts[0] || '').toLowerCase(); })[0];
          if (!who || !parts[1]) { problems.push(l); return; }
          chain = chain.then(function () { return API.act('createItem', { kind: 'followup', title: parts[1], assigneeId: who.id, due: /^\d{4}-\d{2}-\d{2}$/.test(parts[2] || '') ? parts[2] : '', initiativeId: v.initiativeId }).then(function () { made++; }); });
        });
        return chain.then(function () { return load(); }).then(function () {
          toast(made + ' follow-up(s) created');
          if (problems.length) throw new Error(made + ' created. Not understood (check the name matches exactly): ' + problems.join(' | '));
        });
      }, { wide: true });
  }

  // ------------------------------------------------------------------ pages
  var PAGES = {
    my: { label: 'My work', show: function () { return true; }, render: pageMy },
    team: { label: 'Team', show: function () { return isLead() || isAdmin(); }, render: pageTeam },
    help: { label: 'Needs help', show: function () { return isLead(); }, render: pageHelp, count: function () { return Core.signals(st.S, st.meId, st.today).filter(function (s) { return s.sev >= 2; }).length; } },
    org: { label: 'Organisation', show: isOwner, render: pageOrg },
    workload: { label: 'Workload', show: function () { return isLead(); }, render: pageWorkload },
    initiatives: { label: 'Priorities', show: function () { return true; }, render: pageInitiatives },
    chart: { label: 'Org chart', show: function () { return true; }, render: pageChart },
    people: { label: 'People & teams', show: function () { return isSys() || isHR(); }, render: pagePeople },
    duties: { label: 'SOP duties', show: function () { return isAdmin(); }, render: pageDuties },
    settings: { label: 'Settings', show: isSys, render: pageSettings }
  };
  function route() { var r = (location.hash || '').replace('#', ''); return PAGES[r] && PAGES[r].show() ? r : 'my'; }
  window.addEventListener('hashchange', function () { if (st.data) render(); });

  function render() {
    var r = route();
    var nav = Object.keys(PAGES).filter(function (k) { return PAGES[k].show(); }).map(function (k) {
      var c = PAGES[k].count ? PAGES[k].count() : 0;
      return '<a href="#' + k + '" class="' + (k === r ? 'on' : '') + '">' + esc(PAGES[k].label) + (c ? '<span class="count">' + c + '</span>' : '') + '</a>';
    }).join('');
    var banner = '';
    if (st.data.demo) banner = '<div class="banner">Demo mode: fictional people, stored only in this browser. Nothing is sent to anyone. <a href="#" id="leave-demo">Leave demo</a> · <a href="#" id="reset-demo">Reset demo data</a></div>';
    else if (st.data.sendMode !== 'live') banner = '<div class="banner">Test mode: WhatsApp messages go only to the test phone, never to staff.</div>';
    $('#app').innerHTML = '<header class="top"><div class="top-inner"><div class="brand-row"><div class="brand">' + esc(Core.settings(st.S).orgName || cfg.orgName || 'Work Tracker') + '</div>' +
      '<div class="user-chip"><span>' + esc(st.me.name) + '</span><button id="acct">Account</button><button id="signout">Sign out</button></div></div><nav class="tabs">' + nav + '</nav></div></header>' + banner + '<main id="page"></main>';
    $('#signout').onclick = function () { API.logout().then(function () { renderSignIn(); }); };
    $('#acct').onclick = accountModal;
    if ($('#leave-demo')) $('#leave-demo').onclick = function (e) { e.preventDefault(); API.logout(); API.setMode('remote'); renderSignIn(); };
    if ($('#reset-demo')) $('#reset-demo').onclick = function (e) { e.preventDefault(); API.resetDemo(); load(); toast('Demo data reset'); };
    PAGES[r].render($('#page'));
  }

  // ---------------- My work
  function pageMy(el) {
    var items = st.data.items, me = st.meId;
    var mine = items.filter(function (it) { return it.assigneeId === me; });
    var toConfirm = mine.filter(function (it) { return it.status === 'confirm'; });
    var toFix = items.filter(function (it) { return it.status === 'disputed' && it.createdBy === me; });
    var tomorrow = Core.addDays(st.today, 1);
    var activeAll = mine.filter(function (it) { return it.status === 'open' || it.status === 'blocked'; }).sort(function (a, b) { return (a.due || '9') < (b.due || '9') ? -1 : 1; });
    var activeItems = activeAll.filter(function (it) { return !(it.kind === 'duty' && it.due > tomorrow); });
    var upcoming = activeAll.filter(function (it) { return it.kind === 'duty' && it.due > tomorrow; });
    var myTeamIds = [st.me.homeTeamId].concat(st.data.memberships.filter(function (m) { return m.personId === me; }).map(function (m) { return m.teamId; }));
    var inbox = items.filter(function (it) { return !it.assigneeId && it.teamId && myTeamIds.indexOf(it.teamId) >= 0 && Core.OPEN.indexOf(it.status) >= 0; });
    var waiting = mine.filter(function (it) { return it.status === 'review'; });
    var sent = items.filter(function (it) { return it.createdBy === me && it.assigneeId !== me && it.status === 'confirm'; });
    var done = mine.filter(function (it) { return it.status === 'verified' || it.status === 'closed'; }).sort(function (a, b) { return a.updatedAt < b.updatedAt ? 1 : -1; }).slice(0, 8);
    var chain = Core.escalationChain(st.S, me, st.today);
    var canAssign = assignable().length > 1;
    el.innerHTML = '<div class="page-head"><div><h1>My work</h1><p class="lede">Your work is verified by <b>' + esc(nm(chain[0])) + '</b>. Help requests go to them first' + (chain[1] ? ', then ' + esc(nm(chain[1])) : '') + '.</p></div>' +
      '<div class="actions"><button class="btn" id="b-contrib">Log a contribution</button>' + (canAssign ? '<button class="btn secondary" id="b-assign">Assign or log work</button>' : '') + '<button class="btn secondary" id="b-help">Ask for help</button></div></div>' +
      '<div class="grid2"><div class="stack">' +
      (toConfirm.length ? card('Please confirm', toConfirm.length, '<p class="meta">Someone recorded this for you. Is it right?</p>' + list(toConfirm, '', { showWho: false })) : '') +
      (toFix.length ? card('Sent back to you to fix', toFix.length, list(toFix, '')) : '') +
      card('In progress', activeItems.length, list(activeItems, 'Nothing in progress.', { showWho: false }) + (upcoming.length ? '<p class="meta" style="margin-top:10px">Coming up: ' + upcoming.length + ' SOP duty item(s) due later this week.</p>' : '')) +
      (inbox.length ? card('Team inbox', inbox.length, list(inbox, '')) : '') +
      '</div><div class="stack">' +
      card('Waiting for verification', waiting.length, list(waiting, 'Nothing waiting.', { showWho: false })) +
      (sent.length ? card('You sent, not yet confirmed', sent.length, list(sent, '', { showFrom: false })) : '') +
      card('Recently verified', null, list(done, 'Nothing verified yet this term.', { showWho: false, showThanks: true })) +
      '</div></div>';
    $('#b-contrib').onclick = function () { newWorkModal('contribution'); };
    if ($('#b-assign')) $('#b-assign').onclick = function () { newWorkModal('assign'); };
    $('#b-help').onclick = function () { helpModal(null); };
  }

  // ---------------- Team
  function pageTeam(el) {
    var teams = isOwner() || isSys() ? st.data.teams.filter(function (t) { return t.active !== 'false'; }) : myLedTeams();
    if (!teams.length && st.me.homeTeamId) teams = [teamById(st.me.homeTeamId)].filter(Boolean);
    var sel = teams.filter(function (t) { return t.id === st.sub.team; })[0] || teams[0];
    var items = st.data.items;
    var queue = items.filter(function (it) { return it.status === 'review' && Core.canVerify(st.S, st.meId, it, st.today); });
    var html = '<div class="page-head"><div><h1>Team</h1><p class="lede">Your verification queue, and how each team is doing.</p></div><div class="actions">' +
      '<button class="btn secondary" id="b-assign">Assign or log work</button><button class="btn secondary" id="b-bulk">Follow-ups from a meeting</button>' + (isLead() ? '<button class="btn secondary" id="b-deleg">Delegate verification</button>' : '') + '</div></div>';
    html += card('Waiting for you to verify', queue.length, queue.length ? '<div class="row" style="margin-bottom:6px"><label class="checks" style="margin:0;flex:0 0 auto"><span><input type="checkbox" id="pick-all" style="width:auto"> Select all</span></label><button class="btn sm teal" id="b-verify-sel" style="flex:0 0 auto">Verify selected</button></div>' + list(queue, '', { check: true }) : '<p class="empty">Nothing to verify. Well done.</p>');
    if (sel) {
      var stats = Core.teamStats(st.S, sel.id, items, st.today);
      var inbox = items.filter(function (it) { return it.teamId === sel.id && !it.assigneeId && Core.OPEN.indexOf(it.status) >= 0; });
      var ids = stats.map(function (s) { return s.personId; });
      var helps = items.filter(function (it) { return it.status === 'blocked' && ids.indexOf(it.assigneeId) >= 0; });
      var week = Core.addDays(st.today, 7);
      var duties = items.filter(function (it) { return it.kind === 'duty' && ids.concat(['']).indexOf(it.assigneeId) >= 0 && (it.teamId === sel.id || ids.indexOf(it.assigneeId) >= 0) && Core.OPEN.indexOf(it.status) >= 0 && it.due && it.due <= week; });
      html += '<div style="margin:24px 0 12px" class="row"><select id="team-sel" style="max-width:360px">' + teamOptions(teams, sel.id) + '</select><span class="meta" style="flex:2">' + esc(Core.TEAM_TYPES[sel.type] || '') + ' · Lead ' + esc(nm(sel.leadId)) + (sel.deputyId ? ' · Deputy ' + esc(nm(sel.deputyId)) : '') + (sel.adminIds ? ' · Admin ' + esc(Core.list(sel.adminIds).map(nm).join(', ')) : '') + '</span></div>';
      html += card('Members', stats.length, '<div class="scroll"><table><thead><tr><th>Name</th><th>Verifier</th><th class="num">Open</th><th class="num">Overdue</th><th class="num">Awaiting check</th><th class="num">Load (h)</th><th class="num">Verified</th></tr></thead><tbody>' +
        stats.map(function (s) { var p = Core.person(st.S, s.personId) || {}; return '<tr class="click" data-person="' + esc(s.personId) + '"><td>' + esc(p.name) + (Core.onLeave(p, st.today) ? ' <span class="pill">On leave</span>' : '') + '<div class="meta">' + esc(p.designation || '') + '</div></td><td>' + esc(nm(Core.verifierOf(st.S, s.personId, st.today))) + '</td><td class="num">' + s.open + '</td><td class="num' + (s.overdue ? ' bad' : '') + '">' + s.overdue + '</td><td class="num">' + s.review + '</td><td class="num">' + s.load + '</td><td class="num">' + s.verified + '</td></tr>'; }).join('') + '</tbody></table></div>');
      html += '<div class="grid2" style="margin-top:20px"><div class="stack">' + card('Help requests', helps.length, list(helps, 'No one in this team has asked for help.')) + card('Team inbox', inbox.length, list(inbox, 'The inbox is empty.')) + '</div><div class="stack">' + card('SOP duties due this week', duties.length, list(duties, 'No duties due.')) + '</div></div>';
    }
    el.innerHTML = html;
    $('#b-assign').onclick = function () { newWorkModal('assign'); };
    $('#b-bulk').onclick = bulkModal;
    if ($('#b-deleg')) $('#b-deleg').onclick = delegateModal;
    if ($('#team-sel')) $('#team-sel').onchange = function (e) { st.sub.team = e.target.value; render(); };
    if ($('#pick-all')) $('#pick-all').onchange = function (e) { $$('.pick').forEach(function (c) { c.checked = e.target.checked; }); };
    if ($('#b-verify-sel')) $('#b-verify-sel').onclick = function () {
      var ids = $$('.pick').filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
      if (!ids.length) return toast('Select items first');
      doAct('verify', { ids: ids }, ids.length + ' verified').catch(handleErr);
    };
  }
  function delegateModal() {
    var sc = scope();
    var below = activePeople().filter(function (p) { return sc[p.id] && p.id !== st.meId; });
    formModal('Delegate verification', 'Choose who will check the work of the people you select. You still see everything.',
      '<label>New verifier</label><select name="verifierId">' + personOptions(below, '', 'Choose…') + '</select>' +
      '<label>For these people <span class="hint">hold Ctrl or Cmd to pick several</span></label><select name="personIds" multiple size="10">' + personOptions(below, '') + '</select>',
      'Save', function (v) { return doAct('delegateVerifier', { verifierId: v.verifierId, personIds: v.personIds }, 'Verification delegated'); });
  }
  document.addEventListener('click', function (e) { var r = e.target.closest('[data-person]'); if (r) personModal(r.dataset.person); });

  // ---------------- Needs help
  function pageHelp(el) {
    var sig = Core.signals(st.S, st.meId, st.today);
    el.innerHTML = '<div class="page-head"><div><h1>Who needs help</h1><p class="lede">Help requests first, then problems the system spotted. Oldest unanswered at the top.</p></div></div>' +
      '<div class="grid2"><div class="card"><h2>Today <span class="n">(' + sig.length + ')</span></h2>' + (sig.length ? sig.map(function (s) {
        var it = s.itemId ? itemById(s.itemId) : null;
        var btns = it ? actionsFor(it).filter(function (b) { return ['ack', 'resolve', 'verify', 'fix'].indexOf(b[0]) >= 0; }) : [];
        return '<div class="item"><span class="pill sev' + s.sev + '">' + esc(s.type) + '</span> ' + (it ? '<span class="t" data-open="' + esc(it.id) + '">' : '<span>') + esc(s.title) + '</span>' +
          '<div class="meta">' + (s.personId && it ? esc(nm(s.personId)) + ' · ' : '') + esc(s.detail || '') + '</div>' +
          (btns.length ? '<div class="btns">' + btns.map(function (b) { return '<button class="btn sm ' + b[2] + '" data-act="' + b[0] + '" data-id="' + esc(it.id) + '">' + esc(b[1]) + '</button>'; }).join('') + '</div>' : '') +
          (s.personId && !it ? '<div class="btns"><button class="btn sm secondary" data-person="' + esc(s.personId) + '">Open ' + esc(nm(s.personId).split(' ')[0]) + '</button></div>' : '') + '</div>';
      }).join('') : '<p class="empty">Nobody needs help right now.</p>') + '</div>' +
      (isOwner() ? '<div class="card"><h2>This morning\'s WhatsApp digest</h2><pre class="digest" id="digest">Loading…</pre><div class="btns" style="margin-top:10px"><button class="btn sm secondary" id="copy-digest">Copy</button></div></div>' : '') + '</div>';
    if (isOwner()) {
      API.digest().then(function (t) { $('#digest').textContent = t; }).catch(function () { $('#digest').textContent = Core.digestText(st.S, st.meId, st.today); });
      $('#copy-digest').onclick = function () { try { navigator.clipboard.writeText($('#digest').textContent).then(function () { toast('Copied'); }, function () { toast('Copy not allowed here'); }); } catch (e) { toast('Copy not allowed here'); } };
    }
  }

  // ---------------- Organisation
  function pageOrg(el) {
    var items = st.data.items, o = Core.orgStats(st.S, items, st.today);
    var kpi = function (n, l, warn) { return '<div class="card kpi' + (warn ? ' warn' : '') + '"><div class="n">' + (n === null ? '—' : n) + '</div><div class="l">' + esc(l) + '</div></div>'; };
    var teams = st.data.teams.filter(function (t) { return t.active !== 'false'; });
    var since = Core.addDays(st.today, -30);
    var rows = teams.map(function (t) {
      var ids = Core.teamMemberIds(st.S, t.id);
      var its = items.filter(function (it) { return ids.indexOf(it.assigneeId) >= 0 || (it.teamId === t.id && !it.assigneeId); });
      return { t: t, n: ids.length, open: its.filter(function (it) { return Core.OPEN.indexOf(it.status) >= 0; }).length, overdue: its.filter(function (it) { return Core.isOverdue(it, st.today); }).length, help: its.filter(function (it) { return it.status === 'blocked'; }).length, review: its.filter(function (it) { return it.status === 'review'; }).length, verified: its.filter(function (it) { return it.status === 'verified' && String(it.verifiedAt).slice(0, 10) >= since; }).length };
    }).sort(function (a, b) { return (b.overdue + b.help * 2) - (a.overdue + a.help * 2); });
    var duties = st.data.duties.filter(function (d) { return d.active !== 'false'; }).map(function (d) {
      var its = items.filter(function (it) { return it.dutyId === d.id && it.due && it.due < st.today && it.status !== 'cancelled'; }).sort(function (a, b) { return a.due < b.due ? 1 : -1; }).slice(0, 8);
      var on = its.filter(function (it) { return it.completedAt && String(it.completedAt).slice(0, 10) <= it.due; }).length;
      return { d: d, n: its.length, rate: its.length ? Math.round(on / its.length * 100) : null };
    });
    var issues = Core.structureIssues(st.S, st.today);
    el.innerHTML = '<div class="page-head"><div><h1>Organisation</h1><p class="lede">Both entities at a glance. Figures for the last 30 days where marked.</p></div></div>' +
      '<div class="kpis">' + kpi(o.helpOpen, 'Open help requests', o.helpOpen > 0) + kpi(o.overdue, 'Overdue items', o.overdue > 0) + kpi(o.dutyOnTime === null ? null : o.dutyOnTime + '%', 'SOP duties on time (30 days)') + kpi(o.verifiedRate === null ? null : o.verifiedRate + '%', 'Done items verified (30 days)') + kpi(o.helpResponseHours === null ? null : o.helpResponseHours + 'h', 'Avg. help response (working h)') + kpi(o.contributions, 'Contributions logged (30 days)') + '</div>' +
      card('Teams', rows.length, '<div class="scroll"><table><thead><tr><th>Team</th><th>Lead</th><th class="num">People</th><th class="num">Open</th><th class="num">Overdue</th><th class="num">Help</th><th class="num">Awaiting check</th><th class="num">Verified (30d)</th></tr></thead><tbody>' +
        rows.map(function (r) { return '<tr class="click" data-team="' + esc(r.t.id) + '"><td>' + esc(r.t.name) + '<div class="meta">' + esc(r.t.entity) + ' · ' + esc(Core.TEAM_TYPES[r.t.type] || '') + '</div></td><td>' + esc(nm(r.t.leadId)) + '</td><td class="num">' + r.n + '</td><td class="num">' + r.open + '</td><td class="num' + (r.overdue ? ' bad' : '') + '">' + r.overdue + '</td><td class="num' + (r.help ? ' bad' : '') + '">' + r.help + '</td><td class="num">' + r.review + '</td><td class="num">' + r.verified + '</td></tr>'; }).join('') + '</tbody></table></div>') +
      '<div class="grid2" style="margin-top:20px">' + card('SOP duties on time (last 8)', duties.length, duties.length ? '<table><tbody>' + duties.map(function (x) { return '<tr><td>' + esc(x.d.title) + '<div class="meta">' + esc(x.d.ownerType === 'team' ? teamName(x.d.ownerId) : nm(x.d.ownerId)) + '</div></td><td class="num' + (x.rate !== null && x.rate < 75 ? ' bad' : '') + '">' + (x.rate === null ? '—' : x.rate + '%') + '</td></tr>'; }).join('') + '</tbody></table>' : '<p class="empty">No SOP duties set up yet.</p>') +
      card('Structure problems', issues.length, issues.length ? issues.slice(0, 12).map(function (i) { return '<div class="item">' + (i.personId ? '<span class="t" data-person="' + esc(i.personId) + '">' + esc(nm(i.personId)) + '</span>' : esc(teamName(i.teamId))) + '<div class="meta">' + esc(i.issue) + '</div></div>'; }).join('') + (issues.length > 12 ? '<p class="meta">…and ' + (issues.length - 12) + ' more on the People & teams page.</p>' : '') : '<p class="empty">None.</p>') + '</div>';
    $$('[data-team]').forEach(function (r) { r.onclick = function () { st.sub.team = r.dataset.team; location.hash = 'team'; }; });
  }

  // ---------------- Workload
  function pageWorkload(el) {
    var sc = scope(), items = st.data.items;
    var rows = activePeople().filter(function (p) { return sc[p.id]; }).map(function (p) { var s = Core.personStats(st.S, p.id, items, st.today); s.p = p; s.span = Core.spanOf(st.S, p.id, st.today); return s; });
    var key = st.sub.sort || 'overdue';
    rows.sort(function (a, b) { return key === 'name' ? a.p.name.localeCompare(b.p.name) : (b[key] - a[key]); });
    var cfgS = Core.settings(st.S);
    var maxLoad = Math.max.apply(null, rows.map(function (r) { return r.load; }).concat([1]));
    var th = function (k, l) { return '<th class="sort num" data-sort="' + k + '">' + l + (key === k ? ' ▾' : '') + '</th>'; };
    el.innerHTML = '<div class="page-head"><div><h1>Workload</h1><p class="lede">Everyone you can see. Load counts confirmed open items by their time band. Red means over the limits in Settings.</p></div><input class="search" id="wl-q" placeholder="Search names"></div>' +
      '<div class="card scroll"><table><thead><tr><th class="sort" data-sort="name">Name' + (key === 'name' ? ' ▾' : '') + '</th><th>Team</th>' + th('open', 'Open') + th('overdue', 'Overdue') + th('blocked', 'Help') + th('review', 'Awaiting check') + th('load', 'Load (h)') + '<th></th>' + th('span', 'Verifies') + th('verified', 'Verified') + '</tr></thead><tbody>' +
      rows.map(function (r) {
        var over = r.open > +cfgS.overloadOpen || r.overdue >= +cfgS.overloadOverdue;
        return '<tr class="click" data-person="' + esc(r.p.id) + '" data-name="' + esc(r.p.name.toLowerCase()) + '"><td>' + esc(r.p.name) + (Core.onLeave(r.p, st.today) ? ' <span class="pill">On leave</span>' : '') + '</td><td class="meta">' + esc(teamName(r.p.homeTeamId)) + '</td><td class="num' + (over ? ' bad' : '') + '">' + r.open + '</td><td class="num' + (r.overdue ? ' bad' : '') + '">' + r.overdue + '</td><td class="num' + (r.blocked ? ' bad' : '') + '">' + r.blocked + '</td><td class="num">' + r.review + '</td><td class="num">' + r.load + '</td><td style="width:120px"><div class="bar"><span style="width:' + Math.round(r.load / maxLoad * 100) + '%"></span></div></td><td class="num' + (r.span > +cfgS.spanLimit ? ' bad' : '') + '">' + r.span + '</td><td class="num">' + r.verified + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    $$('[data-sort]').forEach(function (h) { h.onclick = function (e) { e.stopPropagation(); st.sub.sort = h.dataset.sort; render(); }; });
    $('#wl-q').oninput = function (e) { var q = e.target.value.toLowerCase(); $$('tr[data-name]').forEach(function (r) { r.style.display = r.dataset.name.indexOf(q) >= 0 ? '' : 'none'; }); };
  }

  // ---------------- Priorities, initiatives and decisions
  function pageInitiatives(el) {
    var stats = Core.byId(Core.initiativeStats(st.S, st.data.items));
    var owner = isOwner();
    var html = '<div class="page-head"><div><h1>Priorities and initiatives</h1><p class="lede">What the school is working on this term, where the effort is going, and what was decided.</p></div>' +
      (owner ? '<div class="actions"><button class="btn secondary" id="b-pr">Add priority</button><button class="btn" id="b-in">Add initiative</button></div>' : '') + '</div>';
    var prs = st.data.priorities.filter(function (p) { return p.active !== 'false'; });
    if (!prs.length) html += '<div class="card"><p class="empty">No priorities set yet.' + (owner ? ' Start with 3 to 5 for this term.' : '') + '</p></div>';
    prs.concat([{ id: '', title: 'Initiatives without a priority' }]).forEach(function (pr) {
      var inis = st.data.initiatives.filter(function (i) { return (i.priorityId || '') === pr.id; });
      if (!pr.id && !inis.length) return;
      html += '<div class="card" style="margin-bottom:16px"><h2>' + esc(pr.title) + (pr.ownerId ? ' <span class="n">· ' + esc(nm(pr.ownerId)) + (pr.term ? ' · ' + esc(pr.term) : '') + '</span>' : '') + '</h2>' +
        (inis.length ? '<div class="scroll"><table><thead><tr><th>Initiative</th><th>Owner</th><th class="num">Items</th><th class="num">Verified</th><th class="num">Effort (h)</th><th>Teams</th><th>Last activity</th><th>Last decision</th>' + (owner ? '<th></th>' : '') + '</tr></thead><tbody>' +
          inis.map(function (i) {
            var s = stats[i.id] || {}, last = st.data.decisions.filter(function (d) { return d.initiativeId === i.id; }).sort(function (a, b) { return a.at < b.at ? 1 : -1; })[0];
            return '<tr><td>' + esc(i.title) + (i.status === 'stopped' ? ' <span class="pill">Stopped</span>' : '') + '<div class="meta">' + esc(i.goal) + '</div></td><td>' + esc(nm(i.ownerId)) + '</td><td class="num">' + (s.items || 0) + '</td><td class="num">' + (s.verified || 0) + '</td><td class="num">' + (s.effort || 0) + '</td><td class="meta">' + esc((s.teams || []).map(teamName).join(', ')) + '</td><td class="meta">' + esc(fmtDate(s.last)) + '</td><td>' + (last ? '<b>' + esc(last.decision) + '</b><div class="meta">' + esc(fmtDate(last.at)) + '</div>' : '<span class="meta">None yet</span>') + '</td>' +
              (owner ? '<td><button class="btn sm secondary" data-decide="' + esc(i.id) + '">Decide</button> <button class="btn sm secondary" data-edit-ini="' + esc(i.id) + '">Edit</button></td>' : '') + '</tr>';
          }).join('') + '</tbody></table></div>' : '<p class="empty">No initiatives under this priority yet.</p>') + '</div>';
    });
    var log = st.data.decisions.slice().sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    html += card('Decision log', log.length, log.length ? '<table><tbody>' + log.map(function (d) { return '<tr><td style="width:110px" class="meta">' + esc(fmtDate(d.at)) + '</td><td><b>' + esc(iniName(d.initiativeId)) + ': ' + esc(d.decision) + '</b><div class="meta">' + esc(d.note) + (d.followups ? ' · ' + Core.list(d.followups).length + ' follow-up(s) created' : '') + ' · ' + esc(nm(d.byId)) + '</div></td></tr>'; }).join('') + '</tbody></table>' : '<p class="empty">No decisions recorded yet.</p>');
    el.innerHTML = html;
    if (owner) {
      $('#b-pr').onclick = function () { priorityModal(); };
      $('#b-in').onclick = function () { initiativeModal(); };
      $$('[data-decide]').forEach(function (b) { b.onclick = function () { decisionModal(b.dataset.decide); }; });
      $$('[data-edit-ini]').forEach(function (b) { b.onclick = function () { initiativeModal(st.data.initiatives.filter(function (i) { return i.id === b.dataset.editIni; })[0]); }; });
    }
  }
  function priorityModal() {
    formModal('Add a priority', 'Keep it to 3 to 5 a term.', '<label>Priority</label><input name="title"><div class="row"><div><label>Term</label><input name="term" placeholder="e.g. Term 2, 2026–27"></div><div><label>Owner</label><select name="ownerId">' + personOptions(activePeople(), st.meId) + '</select></div></div>', 'Add',
      function (v) { return doAct('savePriority', v, 'Priority added'); });
  }
  function initiativeModal(i) {
    i = i || {};
    formModal(i.id ? 'Edit initiative' : 'Add an initiative', '', '<label>Initiative</label><input name="title" value="' + esc(i.title || '') + '"><label>Priority</label><select name="priorityId"><option value="">None</option>' + opts(st.data.priorities.map(function (p) { return [p.id, p.title]; }), i.priorityId) + '</select>' +
      '<div class="row"><div><label>Owner</label><select name="ownerId">' + personOptions(activePeople(), i.ownerId || st.meId) + '</select></div><div><label>End date</label><input type="date" name="endDate" value="' + esc(i.endDate || '') + '"></div></div><label>Goal</label><input name="goal" value="' + esc(i.goal || '') + '">' +
      (i.id ? '<label>Status</label><select name="status">' + opts([['active', 'Active'], ['stopped', 'Stopped'], ['done', 'Done']], i.status) + '</select>' : '<div class="checks"><label><input type="checkbox" name="makeTeam" value="yes"> Create a project team for it (members from any team)</label></div>'),
      i.id ? 'Save' : 'Add', function (v) { v.id = i.id; v.makeTeam = !!v.makeTeam; return doAct('saveInitiative', v, 'Saved'); });
  }
  function decisionModal(iniId) {
    var people = activePeople();
    var row = function (n) { return '<div class="row" style="margin-top:6px"><input name="f' + n + 't" placeholder="Follow-up action" style="flex:3"><select name="f' + n + 'a" style="flex:2">' + personOptions(people, '', 'Owner…') + '</select><input type="date" name="f' + n + 'd" style="flex:1.4"></div>'; };
    formModal('Decision: ' + iniName(iniId), 'Recorded in the decision log. Follow-ups become work items straight away.',
      '<label>Decision</label>' + segField('decision', Core.DECISIONS.map(function (d) { return [d, d]; }), 'Continue') + '<label>Why</label><textarea name="note"></textarea><label>Follow-ups <span class="hint">optional</span></label>' + row(1) + row(2) + row(3),
      'Record decision', function (v) {
        var f = [1, 2, 3].map(function (n) { return { title: v['f' + n + 't'], assigneeId: v['f' + n + 'a'], due: v['f' + n + 'd'] }; }).filter(function (x) { return x.title; });
        return doAct('recordDecision', { initiativeId: iniId, decision: v.decision, note: v.note, followups: f }, 'Decision recorded');
      }, { wide: true });
  }

  // ---------------- Org chart
  function pageChart(el) {
    var tree = Core.orgTree(st.S);
    var open = st.sub.open || (st.sub.open = {});
    function node(id, depth) {
      var p = Core.person(st.S, id), kids = (tree.kids[id] || []).slice().sort(function (a, b) { return nm(a).localeCompare(nm(b)); });
      var v = Core.verifierOf(st.S, id, st.today), span = Core.spanOf(st.S, id, st.today);
      var isOpen = open[id] !== undefined ? open[id] : depth < 2;
      return '<li><button class="toggle" data-tog="' + esc(id) + '">' + (kids.length ? (isOpen ? '▾' : '▸') : '·') + '</button><span class="node" data-person="' + esc(id) + '"><b>' + esc(p.name) + '</b><span class="d">' + esc(p.designation || '') + (kids.length ? ' · ' + kids.length + ' direct' : '') + (span ? ' · verifies ' + span : '') + (v && v !== p.managerId ? ' · verified by ' + esc(nm(v)) : '') + '</span></span>' +
        (kids.length && isOpen ? '<ul>' + kids.map(function (k) { return node(k, depth + 1); }).join('') + '</ul>' : '') + '</li>';
    }
    el.innerHTML = '<div class="page-head"><div><h1>Org chart</h1><p class="lede">Line managers from the roster. Where someone else verifies a person\'s work, it is shown on their box.</p></div><div class="actions"><button class="btn secondary sm" id="exp">Expand all</button><button class="btn secondary sm" id="col">Collapse all</button></div></div>' +
      '<div class="card tree"><ul>' + tree.roots.sort(function (a, b) { return nm(a).localeCompare(nm(b)); }).map(function (r) { return node(r, 0); }).join('') + '</ul></div>';
    $$('[data-tog]').forEach(function (b) { b.onclick = function () { var id = b.dataset.tog; var cur = open[id] !== undefined ? open[id] : b.textContent === '▾'; open[id] = !cur; render(); }; });
    $('#exp').onclick = function () { st.data.people.forEach(function (p) { open[p.id] = true; }); render(); };
    $('#col').onclick = function () { st.data.people.forEach(function (p) { open[p.id] = false; }); render(); };
  }

  // ---------------- People and teams (structure admin)
  function pagePeople(el) {
    var tab = st.sub.ptab || 'people';
    var tabs = '<div class="sub-tabs">' + [['people', 'People'], ['teams', 'Teams'], ['issues', 'Structure problems'], ['audit', 'Change log']].map(function (t) { return '<button data-ptab="' + t[0] + '" class="' + (t[0] === tab ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div>';
    var html = '<div class="page-head"><div><h1>People and teams</h1><p class="lede">The hierarchy every other page relies on. Changes are logged.</p></div><div class="actions">' + (tab === 'people' ? '<button class="btn" id="b-addp">Add person</button>' : tab === 'teams' ? '<button class="btn" id="b-addt">Add team</button>' : '') + '</div></div>' + tabs;
    if (tab === 'people') {
      var f = st.sub.pf || {};
      var rows = st.data.people.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).filter(function (p) {
        if (f.status ? p.status !== f.status : p.status === 'left') return false;
        if (f.team && p.homeTeamId !== f.team) return false;
        return true;
      });
      html += '<div class="row" style="margin-bottom:12px"><input id="pq" placeholder="Search name or designation"><select id="pf-team">' + teamOptions(st.data.teams, f.team, 'All teams') + '</select><select id="pf-status">' + opts([['', 'Active and on leave'], ['active', 'Active'], ['leave', 'On leave'], ['left', 'Left']], f.status || '') + '</select></div>' +
        '<div class="card scroll"><table><thead><tr><th>ID</th><th>Name</th><th>Level</th><th>Home team</th><th>Line manager</th><th>Verifier</th><th>Roles</th><th>WhatsApp</th>' + (st.data.demo ? '' : '<th>Login</th>') + '</tr></thead><tbody>' +
        rows.map(function (p) {
          return '<tr class="click" data-person="' + esc(p.id) + '" data-q="' + esc((p.name + ' ' + p.designation).toLowerCase()) + '"><td class="meta">' + esc(p.id) + '</td><td>' + esc(p.name) + '<div class="meta">' + esc(p.designation) + '</div></td><td class="meta">' + esc(Core.LEVELS[+p.level] || '') + '</td><td>' + esc(teamName(p.homeTeamId)) + '</td><td>' + esc(p.managerId ? nm(p.managerId) : '') + '</td><td>' + esc(p.verifierId ? nm(p.verifierId) : '') + '</td><td class="meta">' + esc(p.roles) + '</td><td>' + (p.phone ? '✓' : '<span class="bad">—</span>') + '</td>' + (st.data.demo ? '' : '<td>' + (p.hasLogin === 'true' ? '✓' : '<span class="meta">none</span>') + '</td>') + '</tr>';
        }).join('') + '</tbody></table></div>';
    } else if (tab === 'teams') {
      html += '<div class="card scroll"><table><thead><tr><th>Team</th><th>Type</th><th>Entity</th><th>Lead</th><th>Deputy</th><th>Team Admin</th><th class="num">Members</th><th>Ends</th></tr></thead><tbody>' +
        st.data.teams.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (t) { return '<tr class="click" data-team-edit="' + esc(t.id) + '"><td>' + esc(t.name) + (t.active === 'false' ? ' <span class="pill">Archived</span>' : '') + '</td><td>' + esc(Core.TEAM_TYPES[t.type] || t.type) + '</td><td>' + esc(t.entity) + '</td><td>' + (t.leadId ? esc(nm(t.leadId)) : '<span class="bad">None</span>') + '</td><td>' + esc(t.deputyId ? nm(t.deputyId) : '') + '</td><td>' + esc(Core.list(t.adminIds).map(nm).join(', ')) + '</td><td class="num">' + Core.teamMemberIds(st.S, t.id).length + '</td><td class="meta">' + esc(fmtDate(t.endDate)) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    } else if (tab === 'issues') {
      var issues = Core.structureIssues(st.S, st.today);
      var kinds = {};
      issues.forEach(function (i) { var k = i.issue.replace(/:.*$/, '').replace(/\d+/g, 'N'); (kinds[k] = kinds[k] || []).push(i); });
      html += Object.keys(kinds).length ? Object.keys(kinds).map(function (k) { return card(k, kinds[k].length, kinds[k].map(function (i) { return '<div class="item">' + (i.personId ? '<span class="t" data-person="' + esc(i.personId) + '">' + esc(nm(i.personId)) + '</span>' : '<span class="t" data-team-edit="' + esc(i.teamId) + '">' + esc(teamName(i.teamId)) + '</span>') + ' <span class="meta">' + esc(i.issue) + '</span></div>'; }).join('')); }).join('<div style="height:16px"></div>') : '<div class="card"><p class="empty">No structure problems.</p></div>';
    } else {
      html += '<div class="card" id="audit">Loading…</div>';
    }
    el.innerHTML = html;
    $$('[data-ptab]').forEach(function (b) { b.onclick = function () { st.sub.ptab = b.dataset.ptab; render(); }; });
    $$('[data-team-edit]').forEach(function (r) { r.onclick = function () { teamModal(teamById(r.dataset.teamEdit)); }; });
    if ($('#b-addp')) $('#b-addp').onclick = function () { personEditModal({}); };
    if ($('#b-addt')) $('#b-addt').onclick = function () { teamModal({}); };
    if ($('#pq')) $('#pq').oninput = function (e) { var q = e.target.value.toLowerCase(); $$('tr[data-q]').forEach(function (r) { r.style.display = r.dataset.q.indexOf(q) >= 0 ? '' : 'none'; }); };
    if ($('#pf-team')) $('#pf-team').onchange = function (e) { st.sub.pf = Object.assign({}, st.sub.pf, { team: e.target.value }); render(); };
    if ($('#pf-status')) $('#pf-status').onchange = function (e) { st.sub.pf = Object.assign({}, st.sub.pf, { status: e.target.value }); render(); };
    if ($('#audit')) API.audit().then(function (rows) {
      $('#audit').innerHTML = rows.length ? '<table><tbody>' + rows.map(function (e) { return '<tr><td class="meta" style="width:140px">' + esc(fmtWhen(e.at)) + '</td><td><b>' + esc(e.action) + '</b><div class="meta">' + esc(e.note) + ' · ' + esc(nm(e.actorId)) + '</div></td></tr>'; }).join('') + '</tbody></table>' : '<p class="empty">No changes yet.</p>';
    }).catch(handleErr);
  }

  function personModal(id) {
    var p = Core.person(st.S, id);
    if (!p) return;
    var items = st.data.items.filter(function (it) { return it.assigneeId === id; });
    var s = Core.personStats(st.S, id, st.data.items, st.today);
    var chain = Core.escalationChain(st.S, id, st.today);
    var memberOf = st.data.memberships.filter(function (m) { return m.personId === id; }).map(function (m) { return teamName(m.teamId) + ' (' + m.role + ')'; });
    var recent = items.filter(function (it) { return it.status === 'verified'; }).sort(function (a, b) { return a.verifiedAt < b.verifiedAt ? 1 : -1; }).slice(0, 6);
    var open = items.filter(function (it) { return Core.OPEN.indexOf(it.status) >= 0 || it.status === 'review'; });
    var canEdit = isSys() || isHR();
    var m = openModal('<h2>' + esc(p.name) + '</h2><p class="meta">' + esc(p.designation) + ' · ' + esc(p.entity) + ' · ' + esc(Core.LEVELS[+p.level] || '') + (Core.onLeave(p, st.today) ? ' · <b>On leave until ' + esc(fmtDate(p.leaveUntil)) + '</b>, cover ' + esc(nm(p.coverId)) : '') + '</p>' +
      '<table><tbody>' + [['Home team', teamName(p.homeTeamId)], ['Other teams', memberOf.join(', ')], ['Line manager', nm(p.managerId)], ['Verified by', nm(Core.verifierOf(st.S, id, st.today))], ['Help goes to', chain.map(nm).join(' → ')], ['Verifies', Core.spanOf(st.S, id, st.today) + ' people']]
        .filter(function (r) { return r[1] && r[1] !== '—'; }).map(function (r) { return '<tr><td class="meta" style="width:120px">' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<div class="kpis" style="margin-top:14px"><div class="card kpi"><div class="n">' + s.open + '</div><div class="l">Open</div></div><div class="card kpi' + (s.overdue ? ' warn' : '') + '"><div class="n">' + s.overdue + '</div><div class="l">Overdue</div></div><div class="card kpi"><div class="n">' + s.verified + '</div><div class="l">Verified</div></div><div class="card kpi"><div class="n">' + s.contributions + '</div><div class="l">Contributions</div></div></div>' +
      '<h2 style="font-size:14px">Open</h2>' + list(open, 'Nothing open.', { showWho: false }) + '<h2 style="font-size:14px;margin-top:14px">Recently verified</h2>' + list(recent, 'Nothing yet.', { showWho: false, showThanks: true, noButtons: true }) +
      '<div class="foot">' + (canEdit ? '<button class="btn secondary" id="pm-edit">Edit</button>' : '') + (Core.scopeIds(st.S, st.meId, st.today)[id] && id !== st.meId ? '<button class="btn secondary" id="pm-assign">Assign work</button>' : '') + '<button class="btn secondary" data-close>Close</button></div>', { wide: true });
    $('[data-close]', m).onclick = closeModal;
    if ($('#pm-edit')) $('#pm-edit').onclick = function () { personEditModal(p); };
    if ($('#pm-assign')) $('#pm-assign').onclick = function () { newWorkModal('assign', { assigneeId: id }); };
  }

  function personEditModal(p) {
    var others = activePeople().filter(function (x) { return x.id !== p.id; });
    var roles = Core.list(p.roles);
    var roleBox = function (r, l) { return '<label><input type="checkbox" name="roles" value="' + r + '"' + (roles.indexOf(r) >= 0 ? ' checked' : '') + '> ' + l + '</label>'; };
    var m = formModal(p.id ? 'Edit ' + p.name : 'Add a person', p.id ? 'Staff ID ' + esc(p.id) : '',
      '<div class="row"><div><label>Name</label><input name="name" value="' + esc(p.name || '') + '"></div><div><label>Designation</label><input name="designation" value="' + esc(p.designation || '') + '"></div></div>' +
      '<div class="row"><div><label>Entity</label><input name="entity" value="' + esc(p.entity || '') + '"></div><div><label>Grade</label><input name="grade" value="' + esc(p.grade || '') + '"></div><div><label>Level</label><select name="level">' + opts(Core.LEVELS.map(function (l, i) { return [String(i), l]; }), p.level || '4') + '</select></div></div>' +
      '<div class="row"><div><label>Line manager</label><select name="managerId">' + personOptions(others, p.managerId, 'None') + '</select></div><div><label>Verifier <span class="hint">blank = line manager</span></label><select name="verifierId">' + personOptions(others, p.verifierId, 'Same as line manager') + '</select></div></div>' +
      '<div class="row"><div><label>Home team</label><select name="homeTeamId">' + teamOptions(st.data.teams.filter(function (t) { return t.type === 'home'; }), p.homeTeamId, 'None') + '</select></div><div><label>Status</label><select name="status">' + opts([['active', 'Active'], ['leave', 'On leave'], ['left', 'Left']], p.status || 'active') + '</select></div></div>' +
      '<div class="row"><div><label>WhatsApp number</label><input name="phone" value="' + esc(p.phone && p.phone !== '•••' ? p.phone : '') + '" placeholder="98XXXXXXXX"></div><div><label>Email <span class="hint">optional</span></label><input name="email" value="' + esc(p.email || '') + '"></div><div><label>Language</label><select name="lang">' + opts([['en', 'English'], ['kn', 'Kannada']], p.lang || 'en') + '</select></div></div>' +
      '<label>Roles</label><div class="checks">' + roleBox('owner', 'Owner') + roleBox('sysadmin', 'System admin') + roleBox('hr', 'HR') + roleBox('admin', 'Administrator / Team Admin') + '</div>' +
      '<div class="row"><div><label>Leave from</label><input type="date" name="leaveFrom" value="' + esc(p.leaveFrom || '') + '"></div><div><label>Leave until</label><input type="date" name="leaveUntil" value="' + esc(p.leaveUntil || '') + '"></div><div><label>Cover</label><select name="coverId">' + personOptions(others, p.coverId, 'None') + '</select></div></div>' +
      (p.id ? '<div class="row" style="margin-top:14px">' + (st.data.demo ? '' : '<button type="button" class="btn secondary" id="pe-reset" style="flex:0">Reset password</button>') + '<button type="button" class="btn danger" id="pe-hand" style="flex:0">Hand over and mark as left…</button></div>' : ''),
      'Save', function (v) {
        v.roles = (v.roles || []).join(',');
        v.id = p.id;
        if (p.phone === '•••' && !v.phone) delete v.phone;
        return doAct('savePerson', v, 'Saved');
      }, { wide: true });
    if ($('#pe-reset', m)) $('#pe-reset', m).onclick = function () {
      API.resetPassword(p.id).then(function (r) {
        openModal('<h2>Temporary password for ' + esc(p.name) + '</h2><p>Staff ID <b>' + esc(r.staffId) + '</b><br>Temporary password <b style="font-size:20px;letter-spacing:1px">' + esc(r.tempPassword) + '</b></p><p class="meta">Give this to them in person. They must choose a new one when they sign in. It is not shown again.</p><div class="foot"><button class="btn" data-close>Done</button></div>');
        $('[data-close]').onclick = closeModal;
      }).catch(handleErr);
    };
    if ($('#pe-hand', m)) $('#pe-hand', m).onclick = function () {
      formModal('Hand over ' + p.name + '\'s work', 'Moves their open items, SOP duties, team roles and the people who report to them to someone else, then marks them as left. History stays.',
        '<label>Hand over to</label><select name="toId">' + personOptions(others, '', 'Choose…') + '</select>', 'Hand over', function (v) { return doAct('handover', { fromId: p.id, toId: v.toId, markLeft: true }, 'Handed over'); });
    };
  }

  function teamModal(t) {
    t = t || {};
    var ppl = activePeople();
    var members = t.id ? st.data.memberships.filter(function (m) { return m.teamId === t.id; }) : [];
    var homeCount = t.id ? st.data.people.filter(function (p) { return p.homeTeamId === t.id && p.status !== 'left'; }).length : 0;
    var m = formModal(t.id ? 'Edit team' : 'Add a team', t.id ? homeCount + ' people have this as their home team.' : '',
      '<div class="row"><div><label>Name</label><input name="name" value="' + esc(t.name || '') + '"></div><div><label>Type</label><select name="type">' + opts(Object.keys(Core.TEAM_TYPES).map(function (k) { return [k, Core.TEAM_TYPES[k]]; }), t.type || 'home') + '</select></div></div>' +
      '<div class="row"><div><label>Entity</label><input name="entity" value="' + esc(t.entity || '') + '"></div><div><label>Ends on <span class="hint">projects</span></label><input type="date" name="endDate" value="' + esc(t.endDate || '') + '"></div></div>' +
      '<div class="row"><div><label>Lead</label><select name="leadId">' + personOptions(ppl, t.leadId, 'Choose…') + '</select></div><div><label>Deputy</label><select name="deputyId">' + personOptions(ppl, t.deputyId, 'None') + '</select></div></div>' +
      '<label>Team Admins <span class="hint">people who enter work for the team; hold Ctrl or Cmd for several</span></label><select name="adminIds" multiple size="4">' + personOptions(ppl, '') + '</select>' +
      '<label>Initiative <span class="hint">for project teams</span></label><select name="initiativeId">' + initiativeOptions(t.initiativeId) + '</select>' +
      (t.id ? '<div class="checks" style="margin-top:8px"><label><input type="checkbox" name="archive" value="1"' + (t.active === 'false' ? ' checked' : '') + '> Archived (unassigned inbox items go to the Lead)</label></div>' : '') +
      (t.id ? '<h2 style="font-size:14px;margin-top:16px">Extra members <span class="n">(besides home-team members)</span></h2><div id="tm-list">' + (members.length ? members.map(function (mb) { return '<div class="row" style="margin:4px 0"><span>' + esc(nm(mb.personId)) + ' <span class="meta">' + esc(mb.role) + '</span></span><button type="button" class="btn sm secondary" style="flex:0" data-rm="' + esc(mb.personId) + '">Remove</button></div>'; }).join('') : '<p class="empty">None</p>') + '</div>' +
        '<div class="row"><select id="tm-add">' + personOptions(ppl, '', 'Add a member…') + '</select><select id="tm-role" style="flex:0 0 140px">' + opts(['member', 'admin', 'observer'], 'member') + '</select><button type="button" class="btn sm secondary" id="tm-addb" style="flex:0">Add</button></div>' : ''),
      'Save', function (v) {
        v.id = t.id; v.active = v.archive ? 'false' : 'true';
        return doAct('saveTeam', v, 'Team saved');
      }, { wide: true });
    var sel = $('[name=adminIds]', m);
    Core.list(t.adminIds).forEach(function (id) { var o = $('option[value="' + id + '"]', sel); if (o) o.selected = true; });
    if ($('#tm-addb', m)) $('#tm-addb', m).onclick = function () {
      var pid = $('#tm-add', m).value; if (!pid) return;
      API.act('setMember', { teamId: t.id, personId: pid, role: $('#tm-role', m).value }).then(load).then(function () { toast('Member added'); teamModal(teamById(t.id)); }).catch(handleErr);
    };
    $$('[data-rm]', m).forEach(function (b) { b.onclick = function () { API.act('setMember', { teamId: t.id, personId: b.dataset.rm, remove: true }).then(load).then(function () { teamModal(teamById(t.id)); }).catch(handleErr); }; });
  }

  // ---------------- SOP duties
  function pageDuties(el) {
    var DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var when = function (d) { return d.freq === 'daily' ? 'Every working day' : d.freq === 'weekly' ? 'Every ' + DOW[+d.dow] : 'Monthly on day ' + d.dom; };
    el.innerHTML = '<div class="page-head"><div><h1>SOP duties</h1><p class="lede">Recurring duties from the SOP. The system creates each one a week ahead, on working days only, and flags it when it is late.</p></div><div class="actions"><button class="btn secondary" id="b-gen">Create this week\'s items now</button><button class="btn" id="b-addd">Add a duty</button></div></div>' +
      '<div class="card scroll"><table><thead><tr><th>Duty</th><th>Owner</th><th>When</th><th>Deadline</th><th>Evidence</th><th></th></tr></thead><tbody>' +
      (st.data.duties.length ? st.data.duties.map(function (d) { return '<tr class="click" data-duty="' + esc(d.id) + '"><td>' + esc(d.title) + (d.active === 'false' ? ' <span class="pill">Retired</span>' : '') + '<div class="meta">' + esc(d.sopRef) + '</div></td><td>' + esc(d.ownerType === 'team' ? 'Team: ' + teamName(d.ownerId) : nm(d.ownerId)) + '</td><td>' + esc(when(d)) + '</td><td>' + esc(d.time) + '</td><td class="meta">' + esc(d.evidenceHint) + '</td><td class="meta">Edit</td></tr>'; }).join('') : '<tr><td colspan="6" class="empty">No duties yet. Add the dated duties from the SOP, starting with the Administrators and AAs.</td></tr>') + '</tbody></table></div>';
    $('#b-addd').onclick = function () { dutyModal({}); };
    $('#b-gen').onclick = function () { doAct('generateDuties', {}).then(function (r) { toast(r.created + ' item(s) created'); }).catch(handleErr); };
    $$('[data-duty]').forEach(function (r) { r.onclick = function () { dutyModal(st.data.duties.filter(function (d) { return d.id === r.dataset.duty; })[0]); }; });
  }
  function dutyModal(d) {
    var m = formModal(d.id ? 'Edit duty' : 'Add an SOP duty', '',
      '<label>Duty</label><input name="title" value="' + esc(d.title || '') + '" placeholder="e.g. Share timetable and paper-prep status with Trustees"><label>SOP reference</label><input name="sopRef" value="' + esc(d.sopRef || '') + '" placeholder="e.g. Administrator, Academics, item 1">' +
      '<div class="row"><div><label>Owned by</label><select name="ownerType">' + opts([['person', 'A person'], ['team', 'A team (Lead hands it out)']], d.ownerType || 'person') + '</select></div><div id="own"></div></div>' +
      '<div class="row"><div><label>How often</label><select name="freq">' + opts([['weekly', 'Weekly'], ['daily', 'Every working day'], ['monthly', 'Monthly']], d.freq || 'weekly') + '</select></div><div><label>Day of week</label><select name="dow">' + opts([['1', 'Monday'], ['2', 'Tuesday'], ['3', 'Wednesday'], ['4', 'Thursday'], ['5', 'Friday'], ['6', 'Saturday'], ['0', 'Sunday']], d.dow || '6') + '</select></div><div><label>Day of month</label><input name="dom" type="number" min="1" max="28" value="' + esc(d.dom || '1') + '"></div><div><label>Deadline time</label><input name="time" type="time" value="' + esc(d.time || '') + '"></div></div>' +
      '<label>Evidence expected</label><input name="evidenceHint" value="' + esc(d.evidenceHint || '') + '" placeholder="e.g. Link to the shared sheet"><label>Initiative <span class="hint">optional</span></label><select name="initiativeId">' + initiativeOptions(d.initiativeId) + '</select>' +
      (d.id ? '<div class="checks" style="margin-top:8px"><label><input type="checkbox" name="retire" value="1"' + (d.active === 'false' ? ' checked' : '') + '> Retired (no new items; history kept)</label></div>' : ''),
      'Save', function (v) { v.id = d.id; v.active = !v.retire; v.ownerId = v.ownerId || ''; return doAct('saveDuty', v, 'Duty saved'); }, { wide: true });
    var fill = function () {
      var team = $('[name=ownerType]', m).value === 'team';
      $('#own', m).innerHTML = '<label>' + (team ? 'Team' : 'Person') + '</label><select name="ownerId">' + (team ? teamOptions(st.data.teams.filter(function (t) { return t.active !== 'false'; }), d.ownerId, 'Choose…') : personOptions(activePeople(), d.ownerId, 'Choose…')) + '</select>';
    };
    fill();
    $('[name=ownerType]', m).onchange = fill;
  }

  // ---------------- Settings
  function pageSettings(el) {
    var s = Core.settings(st.S);
    var f = function (k, l, hint) { return '<div><label>' + esc(l) + (hint ? ' <span class="hint">' + esc(hint) + '</span>' : '') + '</label><input name="' + k + '" value="' + esc(s[k]) + '"></div>'; };
    el.innerHTML = '<div class="page-head"><div><h1>Settings</h1><p class="lede">Rules and limits used for escalation and the "who needs help" signals. Changes are logged.</p></div><div class="actions"><button class="btn secondary" id="b-jobs">Run escalation and reminders now</button></div></div>' +
      '<div class="grid2"><form class="card" id="set-form"><h2>Rules</h2>' +
      '<div class="row">' + f('orgName', 'Organisation name') + '</div>' +
      '<div class="row">' + f('spanLimit', 'Max people one verifier checks') + f('overloadOpen', 'Overloaded at more than', 'open items') + f('overloadOverdue', '…or overdue items of') + '</div>' +
      '<div class="row">' + f('helpEscHours', 'Help escalates after', 'working hours') + f('overdueEscDays1', 'Overdue: tell Lead after', 'working days') + f('overdueEscDays2', 'Overdue: tell their manager after', 'working days') + '</div>' +
      '<div class="row">' + f('disputeDays', 'Stale dispute after', 'working days') + f('confirmDays', 'Unconfirmed after', 'working days') + f('verifyDays', 'Silent verifier after', 'days') + '</div>' +
      '<div class="row">' + f('neglectDays', 'Neglected priority after', 'days') + f('digestHour', 'Digest hour', '0–23') + f('quietStart', 'Quiet from', 'hour') + f('quietEnd', 'Quiet until', 'hour') + '</div>' +
      '<div class="row">' + f('workStart', 'Working day starts', 'hour') + f('workEnd', 'Working day ends', 'hour') + f('weekend', 'Weekend days', '0=Sun … 6=Sat, comma-separated') + '</div>' +
      '<div class="row">' + f('holidays', 'Holidays', 'YYYY-MM-DD, comma-separated') + '</div>' +
      '<div class="err" id="set-err"></div><div class="foot"><button class="btn">Save settings</button></div></form>' +
      '<div class="stack"><div class="card"><h2>Messages</h2><p class="meta">' + (st.data.demo ? 'Demo mode: messages are queued here and never sent.' : (st.data.sendMode === 'live' ? 'Live: messages go to staff.' : 'Test mode: messages go only to the test phone set in Script Properties.') + (st.data.whatsapp ? ' WhatsApp is connected.' : ' WhatsApp is not connected yet.')) + '</p><div id="outbox">Loading…</div></div></div></div>';
    $('#set-form').onsubmit = function (e) {
      e.preventDefault();
      var v = {}; $$('#set-form [name]').forEach(function (i) { v[i.name] = i.value.trim(); });
      doAct('saveSettings', v, 'Settings saved').catch(function (er) { $('#set-err').textContent = er.message; });
    };
    $('#b-jobs').onclick = function () { API.runJobs().then(function (r) { toast('Done: ' + (r.duties || 0) + ' duties, ' + ((r.helpEsc || 0) + (r.overdueEsc || 0)) + ' escalations'); return load(); }).catch(handleErr); };
    API.outbox().then(function (rows) {
      $('#outbox').innerHTML = rows.length ? rows.slice(0, 40).map(function (m) { return '<div class="item"><b>To ' + esc(nm(m.toId)) + '</b> <span class="pill">' + esc(m.kind) + '</span><div class="meta" style="white-space:pre-wrap">' + esc(m.text) + '</div><div class="meta">' + esc(fmtWhen(m.at)) + ' · ' + (m.sentAt ? 'sent ' + esc(fmtWhen(m.sentAt)) : m.error ? '<span class="bad">' + esc(m.error) + '</span>' : 'waiting') + '</div></div>'; }).join('') : '<p class="empty">No messages yet.</p>';
    }).catch(handleErr);
  }

  // ---------------- account
  function accountModal() {
    var others = activePeople().filter(function (x) { return x.id !== st.meId; });
    var p = st.me;
    var m = openModal('<h2>Your account</h2><p class="meta">' + esc(p.name) + ' · Staff ID ' + esc(p.id) + '</p>' +
      '<div class="row" style="margin-top:10px"><button class="btn secondary" id="ac-pw"' + (st.data.demo ? ' disabled' : '') + '>Change password</button><button class="btn secondary" id="ac-leave">Set leave and cover</button></div><div class="foot"><button class="btn secondary" data-close>Close</button></div>');
    $('[data-close]', m).onclick = closeModal;
    $('#ac-pw', m).onclick = function () { renderChangePassword(false); };
    $('#ac-leave', m).onclick = function () {
      formModal('Leave and cover', 'While you are away, your verification, help requests and duties go to your cover.',
        '<div class="row"><div><label>From</label><input type="date" name="leaveFrom" value="' + esc(p.leaveFrom || '') + '"></div><div><label>Until</label><input type="date" name="leaveUntil" value="' + esc(p.leaveUntil || '') + '"></div></div><label>Cover</label><select name="coverId">' + personOptions(others, p.coverId, 'None') + '</select>',
        'Save', function (v) { return doAct('setLeave', v, 'Saved'); });
    };
  }

  // ------------------------------------------------------------------ sign in
  function renderSignIn(msg) {
    var remote = API.hasRemote();
    var html = '<div class="signin"><h1 style="text-align:center;margin-bottom:20px">' + esc(cfg.orgName || 'Work Tracker') + '</h1><div class="card">';
    if (remote && API.mode() !== 'demo') {
      html += '<h2>Sign in</h2><form id="si"><label>Staff ID, phone or email</label><input name="ident" autocomplete="username" autocapitalize="off"><label>Password</label><input name="password" type="password" autocomplete="current-password"><div class="err" id="si-err">' + esc(msg && msg !== 'Please sign in' ? msg : '') + '</div><div class="foot"><button class="btn" style="width:100%">Sign in</button></div></form>' +
        '<p class="meta" style="margin-top:12px">Forgotten your password? Ask the System admin for a temporary one.</p>';
      if (API.canDemo()) html += '<div class="divider">or</div><button class="btn secondary" style="width:100%" id="go-demo">Try the demo with sample data</button>';
    } else {
      html += '<h2>Demo: choose who to be</h2><p class="meta">A fictional organisation. Everything stays in this browser and no messages are sent.</p>';
      var ppl = API.demoPeople();
      var pick = [['P001', 'Owner (Trustee)'], ['P003', 'Owner (Principal)'], ['P006', 'Administrator and System admin'], ['P008', 'Lead: Physics'], ['P023', 'Lead: Primary'], ['P009', 'Lecturer'], ['P016', 'Team Admin (Physics AA)'], ['P022', 'Support staff'], ['P028', 'Café manager']];
      html += pick.map(function (x) { var p = ppl.filter(function (q) { return q.id === x[0]; })[0]; return p ? '<button class="persona" data-demo="' + p.id + '"><span><b>' + esc(p.name) + '</b><div class="meta">' + esc(p.designation) + '</div></span><span class="pill">' + esc(x[1]) + '</span></button>' : ''; }).join('');
      if (remote) html += '<div class="divider">or</div><button class="btn secondary" style="width:100%" id="go-real">Sign in to the real system</button>';
    }
    html += '</div></div>';
    $('#app').innerHTML = html;
    if ($('#si')) $('#si').onsubmit = function (e) {
      e.preventDefault();
      var b = $('#si button'); b.disabled = true;
      API.login(e.target.elements.ident.value.trim(), e.target.elements.password.value).then(function (r) { if (r.mustChange) renderChangePassword(true); else load(); })
        .catch(function (er) { b.disabled = false; $('#si-err').textContent = er.message; });
    };
    if ($('#go-demo')) $('#go-demo').onclick = function () { API.setMode('demo'); renderSignIn(); };
    if ($('#go-real')) $('#go-real').onclick = function () { API.logout(); API.setMode('remote'); renderSignIn(); };
    $$('[data-demo]').forEach(function (b) { b.onclick = function () { API.login(b.dataset.demo).then(load); }; });
  }

  function renderChangePassword(forced) {
    var html = '<h2>' + (forced ? 'Choose your own password' : 'Change password') + '</h2>' + (forced ? '<p class="meta">You signed in with a temporary password. Choose one only you know, at least 8 characters.</p>' : '') +
      '<form id="cp"><label>Current password</label><input type="password" name="old" autocomplete="current-password"><label>New password</label><input type="password" name="n1" autocomplete="new-password"><label>New password again</label><input type="password" name="n2" autocomplete="new-password"><div class="err" id="cp-err"></div><div class="foot">' + (forced ? '' : '<button type="button" class="btn secondary" data-close>Cancel</button>') + '<button class="btn">Save</button></div></form>';
    var root;
    if (forced) { $('#app').innerHTML = '<div class="signin"><div class="card">' + html + '</div></div>'; root = $('#app'); }
    else { root = openModal(html); $('[data-close]', root).onclick = closeModal; }
    $('#cp', root).onsubmit = function (e) {
      e.preventDefault();
      var f = e.target;
      if (f.elements.n1.value.length < 8) return ($('#cp-err', root).textContent = 'Use at least 8 characters');
      if (f.elements.n1.value !== f.elements.n2.value) return ($('#cp-err', root).textContent = 'The two new passwords do not match');
      API.changePassword(f.elements.old.value, f.elements.n1.value).then(function () { toast('Password changed'); closeModal(); load(); }).catch(function (er) { $('#cp-err', root).textContent = er.message; });
    };
  }

  // ------------------------------------------------------------------ start
  document.title = cfg.orgName || 'Work Tracker';
  if (API.signedIn()) load(); else renderSignIn();
})();
