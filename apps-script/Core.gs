// GENERATED from assets/core.js by tools/build.sh. Do not edit here: edit assets/core.js and rebuild.
/*
 * Work Tracker — shared core logic.
 * The same file runs in the browser (demo mode and dashboards) and in Google Apps Script (as Core.gs).
 * It never touches storage directly: every function takes a store S with
 *   S.all(table) -> array of row objects
 *   S.insert(table, obj) -> obj
 *   S.update(table, id, patch) -> obj
 *   S.remove(table, id)
 * Keep this file free of browser-only and Apps-Script-only APIs.
 */
var Core = (function () {
  'use strict';

  var SCHEMA = {
    people: ['id', 'name', 'designation', 'grade', 'entity', 'level', 'managerId', 'verifierId', 'homeTeamId', 'roles', 'phone', 'email', 'lang', 'status', 'leaveFrom', 'leaveUntil', 'coverId', 'notes'],
    teams: ['id', 'name', 'entity', 'function', 'type', 'leadId', 'deputyId', 'adminIds', 'endDate', 'initiativeId', 'active'],
    memberships: ['id', 'teamId', 'personId', 'role'],
    priorities: ['id', 'title', 'term', 'ownerId', 'active'],
    initiatives: ['id', 'title', 'priorityId', 'ownerId', 'goal', 'endDate', 'status'],
    items: ['id', 'kind', 'title', 'notes', 'assigneeId', 'teamId', 'createdBy', 'createdAt', 'updatedAt', 'initiativeId', 'due', 'dueTime', 'status', 'band', 'collaborators', 'evidence', 'evidenceType', 'verifierId', 'verifiedBy', 'verifiedAt', 'completedAt', 'disputeReason', 'returnNote', 'helpReason', 'helpAt', 'helpAckBy', 'helpAckAt', 'helpStep', 'helpResolution', 'overdueStep', 'dutyId', 'thanks'],
    events: ['id', 'itemId', 'actorId', 'action', 'note', 'at'],
    duties: ['id', 'title', 'sopRef', 'ownerType', 'ownerId', 'freq', 'dow', 'dom', 'time', 'evidenceHint', 'initiativeId', 'active'],
    decisions: ['id', 'initiativeId', 'decision', 'note', 'byId', 'at', 'followups'],
    settings: ['key', 'value'],
    outbox: ['id', 'toId', 'text', 'kind', 'itemId', 'at', 'sentAt', 'error'],
    summaries: ['id', 'type', 'scopeType', 'scopeId', 'entity', 'from', 'to', 'text', 'source', 'createdAt', 'createdBy'],
    reviews: ['id', 'teamId', 'date', 'heldBy', 'notes', 'commitments']
  };

  var DEFAULT_SETTINGS = {
    orgName: 'Work Tracker',
    spanLimit: '15',
    overloadOpen: '8',
    overloadOverdue: '3',
    helpEscHours: '4',
    overdueEscDays1: '1',
    overdueEscDays2: '3',
    disputeDays: '2',
    confirmDays: '2',
    verifyDays: '7',
    neglectDays: '21',
    digestHour: '8',
    quietStart: '20',
    quietEnd: '7',
    workStart: '8',
    workEnd: '18',
    weekend: '0',
    holidays: '',
    termStart: '',
    functions: 'Academics|Administration|Operations|Support|Café|Marketing, IT and finance|Leadership'
  };

  var STATUS = {
    confirm: 'Awaiting confirmation',
    disputed: 'Disputed',
    open: 'In progress',
    blocked: 'Needs help',
    review: 'Awaiting verification',
    verified: 'Verified',
    closed: 'Closed',
    cancelled: 'Cancelled'
  };
  var OPEN = ['confirm', 'disputed', 'open', 'blocked'];
  var KINDS = { duty: 'SOP duty', task: 'Assigned task', contribution: 'Contribution', followup: 'Follow-up', help: 'Help request' };
  var BANDS = { '<1': 0.5, '1-3': 2, '3-6': 4.5, '6+': 7 };
  var BAND_LABELS = { '<1': 'Under 1h', '1-3': '1–3h', '3-6': '3–6h', '6+': '6h+' };
  var LEVELS = ['L0 Trustee', 'L1 Leadership', 'L2 Administrator', 'L3 Coordinator', 'L4 Staff', 'L5 Support'];
  var DISPUTE_REASONS = ['Not mine', 'Wrong date', 'Already done', 'Wrong details', 'Other'];
  var HELP_REASONS = ['Blocked by someone', 'Need resources', 'Need a decision', 'Too much on my plate', 'Other'];
  var DECISIONS = ['Continue', 'Scale up', 'Stop', 'Rebalance'];
  var TEAM_TYPES = { home: 'Home team', committee: 'Committee', project: 'Project or event', working: 'Working group' };

  // ---------- small helpers ----------
  function err(msg) { var e = new Error(msg); e.userFacing = true; return e; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDate(s) { if (!s) return null; var p = String(s).slice(0, 10).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parseDate(s); d.setDate(d.getDate() + n); return isoDate(d); }
  function list(v) { return String(v || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
  function uid(prefix) {
    var s = '';
    for (var i = 0; i < 8; i++) s += 'abcdefghjkmnpqrstuvwxyz23456789'.charAt(Math.floor(Math.random() * 31));
    return prefix + '_' + s;
  }
  function joinList(v) { return Array.isArray(v) ? v.join(',') : (v || ''); }
  function byId(rows) { var m = {}; rows.forEach(function (r) { m[r.id] = r; }); return m; }
  function num(v, d) { var n = Number(v); return isNaN(n) || v === '' || v === null || v === undefined ? d : n; }

  function settings(S) {
    var s = {};
    Object.keys(DEFAULT_SETTINGS).forEach(function (k) { s[k] = DEFAULT_SETTINGS[k]; });
    S.all('settings').forEach(function (r) { if (r.key) s[r.key] = r.value; });
    return s;
  }

  // ---------- calendar ----------
  function isWorkingDay(S, dateStr, cfg) {
    cfg = cfg || settings(S);
    var d = parseDate(dateStr);
    if (list(cfg.weekend).indexOf(String(d.getDay())) >= 0) return false;
    if (list(cfg.holidays).indexOf(dateStr) >= 0) return false;
    return true;
  }
  function workingDaysBetween(S, fromStr, toStr) {
    var cfg = settings(S), n = 0, d = fromStr;
    if (!fromStr || !toStr || fromStr >= toStr) return 0;
    for (var i = 0; i < 400 && d < toStr; i++) { d = addDays(d, 1); if (isWorkingDay(S, d, cfg)) n++; }
    return n;
  }
  function workingHoursBetween(S, fromIso, toIso) {
    if (!fromIso) return 0;
    var cfg = settings(S), a = new Date(fromIso), b = new Date(toIso), h = 0;
    var ws = num(cfg.workStart, 8), we = num(cfg.workEnd, 18);
    var t = new Date(a.getTime());
    for (var i = 0; i < 24 * 30 && t < b; i++) {
      var next = new Date(t.getTime() + 3600000);
      if (isWorkingDay(S, isoDate(t), cfg) && t.getHours() >= ws && t.getHours() < we) h += Math.min(1, (Math.min(next, b) - t) / 3600000);
      t = next;
    }
    return h;
  }

  // ---------- people and hierarchy ----------
  function people(S) { return S.all('people'); }
  function person(S, id) { if (!id) return null; var all = S.all('people'); for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i]; return null; }
  function active(p) { return p && p.status !== 'left'; }
  function hasRole(p, r) { return !!p && list(p.roles).indexOf(r) >= 0; }
  function isOwner(p) { return hasRole(p, 'owner'); }
  function isSys(p) { return hasRole(p, 'sysadmin') || isOwner(p); }
  function onLeave(p, today) {
    if (!p) return false;
    if (p.status === 'leave') return true;
    return !!(p.leaveFrom && p.leaveUntil && today >= p.leaveFrom && today <= p.leaveUntil);
  }
  function resolveCover(S, id, today) {
    var seen = {};
    while (id && !seen[id]) {
      seen[id] = true;
      var q = person(S, id);
      if (q && onLeave(q, today) && q.coverId) id = q.coverId; else break;
    }
    return id;
  }
  function verifierOf(S, pid, today) {
    var p = person(S, pid);
    if (!p) return '';
    var v = p.verifierId || p.managerId;
    if (!v || v === pid) v = p.managerId !== pid ? p.managerId : '';
    v = resolveCover(S, v, today);
    return v === pid ? '' : (v || '');
  }
  function owners(S) { return people(S).filter(function (p) { return isOwner(p) && active(p); }); }
  function escalationChain(S, pid, today) {
    var chain = [], first = verifierOf(S, pid, today), cur = first;
    if (first) chain.push(first);
    for (var i = 0; i < 10 && cur; i++) {
      var p = person(S, cur);
      var m = p && p.managerId ? resolveCover(S, p.managerId, today) : '';
      if (!m || chain.indexOf(m) >= 0 || m === pid) break;
      chain.push(m); cur = m;
    }
    var o = owners(S).map(function (x) { return x.id; }).filter(function (x) { return x !== pid; });
    if (o.length && !o.some(function (x) { return chain.indexOf(x) >= 0; })) chain.push(o[0]);
    return chain;
  }
  function teamsLedBy(S, pid) {
    return S.all('teams').filter(function (t) {
      return t.active !== 'false' && (t.leadId === pid || t.deputyId === pid || list(t.adminIds).indexOf(pid) >= 0);
    });
  }
  function teamMemberIds(S, teamId) {
    var ids = people(S).filter(function (p) { return p.homeTeamId === teamId && active(p); }).map(function (p) { return p.id; });
    S.all('memberships').forEach(function (m) { if (m.teamId === teamId && ids.indexOf(m.personId) < 0) ids.push(m.personId); });
    var t = byId(S.all('teams'))[teamId];
    if (t && t.leadId && ids.indexOf(t.leadId) < 0) ids.push(t.leadId);
    return ids;
  }
  function scopeIds(S, meId, today) {
    var me = person(S, meId);
    var set = {};
    if (!me) return set;
    if (isOwner(me)) { people(S).forEach(function (p) { set[p.id] = true; }); return set; }
    set[meId] = true;
    var changed = true, all = people(S);
    while (changed) {
      changed = false;
      all.forEach(function (p) {
        if (set[p.id]) return;
        if ((p.managerId && set[p.managerId]) || set[verifierOf(S, p.id, today)]) { set[p.id] = true; changed = true; }
      });
    }
    teamsLedBy(S, meId).forEach(function (t) { teamMemberIds(S, t.id).forEach(function (id) { set[id] = true; }); });
    return set;
  }
  function spanOf(S, pid, today) {
    return people(S).filter(function (p) { return active(p) && p.id !== pid && verifierOf(S, p.id, today) === pid; }).length;
  }
  function wouldLoop(S, pid, newManagerId) {
    var cur = newManagerId, seen = {};
    while (cur) {
      if (cur === pid) return true;
      if (seen[cur]) return true;
      seen[cur] = true;
      var p = person(S, cur);
      cur = p ? p.managerId : '';
    }
    return false;
  }
  function structureIssues(S, today) {
    var cfg = settings(S), out = [], ids = byId(people(S)), teams = byId(S.all('teams'));
    people(S).forEach(function (p) {
      if (!active(p)) return;
      if (!p.managerId && !isOwner(p)) out.push({ personId: p.id, issue: 'No line manager' });
      else if (p.managerId && !ids[p.managerId]) out.push({ personId: p.id, issue: 'Manager not found: ' + p.managerId });
      else if (p.managerId && wouldLoop(S, p.id, p.managerId)) out.push({ personId: p.id, issue: 'Reporting loop' });
      if (!p.homeTeamId || !teams[p.homeTeamId]) out.push({ personId: p.id, issue: 'No home team' });
      if (!p.phone) out.push({ personId: p.id, issue: 'No WhatsApp number' });
      if (p.level === '' || p.level === undefined) out.push({ personId: p.id, issue: 'No level' });
      var span = spanOf(S, p.id, today);
      if (span > num(cfg.spanLimit, 15)) out.push({ personId: p.id, issue: 'Verifies ' + span + ' people (limit ' + cfg.spanLimit + ')' });
    });
    S.all('teams').forEach(function (t) {
      if (t.active === 'false') return;
      if (!t.leadId) out.push({ teamId: t.id, issue: 'Team has no Lead' });
    });
    return out;
  }
  function orgTree(S) {
    var kids = {}, roots = [];
    people(S).filter(active).forEach(function (p) {
      if (p.managerId && person(S, p.managerId)) (kids[p.managerId] = kids[p.managerId] || []).push(p.id);
      else roots.push(p.id);
    });
    return { roots: roots, kids: kids };
  }

  // ---------- items ----------
  function item(S, id) { var all = S.all('items'); for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i]; return null; }
  function isCurrent(it, today) { return !(it.kind === 'duty' && it.due && it.due > today); }
  function isOverdue(it, today) { return OPEN.indexOf(it.status) >= 0 && it.due && it.due < today; }
  function canSeeItem(S, meId, it, today, scope) {
    var me = person(S, meId);
    if (!me) return false;
    if (isOwner(me)) return true;
    scope = scope || scopeIds(S, meId, today);
    if (it.assigneeId && scope[it.assigneeId]) return true;
    if (it.createdBy === meId || it.verifierId === meId) return true;
    if (list(it.collaborators).indexOf(meId) >= 0) return true;
    if (it.teamId && teamsLedBy(S, meId).some(function (t) { return t.id === it.teamId; })) return true;
    if (it.teamId && !it.assigneeId && teamMemberIds(S, it.teamId).indexOf(meId) >= 0) return true;
    return false;
  }
  function visibleItems(S, meId, today) {
    var scope = scopeIds(S, meId, today);
    return S.all('items').filter(function (it) { return canSeeItem(S, meId, it, today, scope); });
  }
  function canAssignTo(S, meId, targetId, today) {
    if (!targetId || targetId === meId) return true;
    var me = person(S, meId);
    if (isOwner(me)) return true;
    if (scopeIds(S, meId, today)[targetId]) return true;
    var t = person(S, targetId);
    return !!t && teamsLedBy(S, meId).some(function (tm) { return teamMemberIds(S, tm.id).indexOf(targetId) >= 0; });
  }
  function canVerify(S, meId, it, today) {
    if (!it.assigneeId || it.assigneeId === meId) return false;
    if (isOwner(person(S, meId))) return true;
    return it.verifierId === meId || verifierOf(S, it.assigneeId, today) === meId;
  }
  function canHandleHelp(S, meId, it, today) {
    if (isOwner(person(S, meId))) return true;
    if (!it.assigneeId) return teamsLedBy(S, meId).some(function (t) { return t.id === it.teamId; });
    return escalationChain(S, it.assigneeId, today).indexOf(meId) >= 0;
  }
  function loadHours(items) { return items.reduce(function (a, it) { return a + (BANDS[it.band] || 2); }, 0); }

  function logEvent(S, itemId, actorId, action, note, now) {
    S.insert('events', { id: uid('ev'), itemId: itemId || '', actorId: actorId || '', action: action, note: note || '', at: now });
  }
  function notify(S, toId, text, kind, itemId, now) {
    if (!toId) return;
    S.insert('outbox', { id: uid('msg'), toId: toId, text: text, kind: kind || 'info', itemId: itemId || '', at: now, sentAt: '', error: '' });
  }
  function nameOf(S, id) { var p = person(S, id); return p ? p.name : (id || 'someone'); }

  // ---------- actions ----------
  function need(cond, msg) { if (!cond) throw err(msg); }
  function mustItem(S, id) { var it = item(S, id); need(it, 'Item not found'); return it; }
  function touch(S, it, patch, now) { patch.updatedAt = now; return S.update('items', it.id, patch); }

  var A = {};

  A.createItem = function (S, meId, p, ctx) {
    var kind = p.kind || 'task';
    need(KINDS[kind] && kind !== 'help', 'Unknown kind');
    need(String(p.title || '').trim().length >= 3, 'Add a title of at least 3 characters');
    var assignee = p.assigneeId || (p.teamId ? '' : meId);
    if (assignee) need(person(S, assignee), 'Assignee not found');
    need(canAssignTo(S, meId, assignee, ctx.today) || (p.teamId && teamsLedBy(S, meId).some(function (t) { return t.id === p.teamId; })), 'You can only assign work to people in your teams or below you');
    if (kind === 'contribution') need(assignee === meId, 'Contributions are logged by the person who did the work');
    var status;
    if (!assignee) status = 'open';
    else if (assignee !== meId) status = 'confirm';
    else if (p.evidence) status = 'review';
    else status = 'open';
    if (status === 'review') need(verifierOf(S, assignee, ctx.today), 'You have no verifier yet; ask an admin to set one');
    var it = S.insert('items', {
      id: uid('it'), kind: kind, title: String(p.title).trim(), notes: p.notes || '', assigneeId: assignee, teamId: p.teamId || '',
      createdBy: meId, createdAt: ctx.now, updatedAt: ctx.now, initiativeId: p.initiativeId || '', due: p.due || '', dueTime: p.dueTime || '',
      status: status, band: p.band || '', collaborators: joinList(p.collaborators),
      evidence: p.evidence || '', evidenceType: p.evidenceType || '', verifierId: status === 'review' ? verifierOf(S, assignee, ctx.today) : '',
      verifiedBy: '', verifiedAt: '', completedAt: status === 'review' ? ctx.now : '', disputeReason: '', returnNote: '',
      helpReason: '', helpAt: '', helpAckBy: '', helpAckAt: '', helpStep: '', helpResolution: '', overdueStep: '', dutyId: p.dutyId || '', thanks: ''
    });
    logEvent(S, it.id, meId, 'created', KINDS[kind], ctx.now);
    if (status === 'confirm') notify(S, assignee, nameOf(S, meId) + ' has recorded: "' + it.title + '"' + (it.due ? ' (due ' + it.due + ')' : '') + '. Is this correct?', 'confirm', it.id, ctx.now);
    if (status === 'review') notify(S, it.verifierId, nameOf(S, assignee) + ' logged "' + it.title + '" with evidence. Please verify.', 'verify', it.id, ctx.now);
    if (!assignee && p.teamId) { var t = byId(S.all('teams'))[p.teamId]; if (t) notify(S, t.leadId, 'New item in the ' + t.name + ' inbox: "' + it.title + '"', 'inbox', it.id, ctx.now); }
    return it;
  };

  A.confirm = function (S, meId, p, ctx) {
    var it = mustItem(S, p.id);
    need(it.assigneeId === meId, 'Only the assignee can confirm');
    need(it.status === 'confirm' || it.status === 'disputed', 'This item does not need confirming');
    var next = it.evidence ? 'review' : 'open';
    var patch = { status: next, disputeReason: '' };
    if (next === 'review') { patch.verifierId = verifierOf(S, meId, ctx.today); patch.completedAt = ctx.now; }
    touch(S, it, patch, ctx.now);
    logEvent(S, it.id, meId, 'confirmed', '', ctx.now);
    if (next === 'review') notify(S, patch.verifierId, nameOf(S, meId) + ' confirmed "' + it.title + '". Please verify.', 'verify', it.id, ctx.now);
    return item(S, it.id);
  };

  A.dispute = function (S, meId, p, ctx) {
    var it = mustItem(S, p.id);
    need(it.assigneeId === meId, 'Only the assignee can dispute');
    need(it.status === 'confirm', 'Only items awaiting confirmation can be disputed');
    need(p.reason, 'Choose a reason');
    var reason = p.reason + (p.note ? ': ' + p.note : '');
    touch(S, it, { status: 'disputed', disputeReason: reason }, ctx.now);
    logEvent(S, it.id, meId, 'disputed', reason, ctx.now);
    notify(S, it.createdBy, nameOf(S, meId) + ' says "' + it.title + '" is not correct: ' + reason, 'dispute', it.id, ctx.now);
    return item(S, it.id);
  };

  A.fixDispute = function (S, meId, p, ctx) {
    var it = mustItem(S, p.id);
    need(it.status === 'disputed', 'Item is not disputed');
    need(it.createdBy === meId || isOwner(person(S, meId)) || canHandleHelp(S, meId, it, ctx.today), 'Only the person who entered it, or their Lead, can fix it');
    var patch = {};
    ['title', 'due', 'notes', 'band', 'initiativeId'].forEach(function (k) { if (p[k] !== undefined) patch[k] = p[k]; });
    if (p.assigneeId && p.assigneeId !== it.assigneeId) { need(canAssignTo(S, meId, p.assigneeId, ctx.today), 'You cannot assign to that person'); patch.assigneeId = p.assigneeId; }
    patch.status = (patch.assigneeId || it.assigneeId) === meId ? 'open' : 'confirm';
    patch.disputeReason = '';
    touch(S, it, patch, ctx.now);
    logEvent(S, it.id, meId, 'corrected', p.note || '', ctx.now);
    var fresh = item(S, it.id);
    if (fresh.status === 'confirm') notify(S, fresh.assigneeId, nameOf(S, meId) + ' corrected "' + fresh.title + '". Is it right now?', 'confirm', it.id, ctx.now);
    return fresh;
  };

  A.cancel = function (S, meId, p, ctx) {
    var it = mustItem(S, p.id);
    need(OPEN.indexOf(it.status) >= 0 || it.status === 'review', 'Item is already closed');
    need(it.createdBy === meId || isOwner(person(S, meId)) || canHandleHelp(S, meId, it, ctx.today), 'Only the person who entered it, or their Lead, can cancel it');
    need(p.note, 'Say why it is cancelled');
    touch(S, it, { status: 'cancelled' }, ctx.now);
    logEvent(S, it.id, meId, 'cancelled', p.note, ctx.now);
    return item(S, it.id);
  };

  A.claim = function (S, meId, p, ctx) {
    var it = mustItem(S, p.id);
    need(!it.assigneeId && it.teamId, 'Only unassigned team items can be claimed');
    var members = teamMemberIds(S, it.teamId);
    var target = p.assigneeId || meId;
    need(members.indexOf(meId) >= 0 || teamsLedBy(S, meId).some(function (t) { return t.id === it.teamId; }) || isOwner(person(S, meId)), 'You are not in this team');
    if (target !== meId) need(teamsLedBy(S, meId).some(function (t) { return t.id === it.teamId; }) || isOwner(person(S, meId)), 'Only the team Lead can hand out inbox items');
    touch(S, it, { assigneeId: target, status: target === meId ? 'open' : 'confirm' }, ctx.now);
    logEvent(S, it.id, meId, target === meId ? 'claimed' : 'assigned', nameOf(S, target), ctx.now);
    if (target !== meId) notify(S, target, nameOf(S, meId) + ' assigned you "' + it.title + '". Is this correct?', 'confirm', it.id, ctx.now);
    return item(S, it.id);
  };

  A.complete = function (S, meId, p, ctx) {
    var it = mustItem(S, p.id);
    need(it.assigneeId === meId, 'Only the assignee can mark this done');
    need(it.status === 'open' || it.status === 'blocked', 'Item cannot be completed from its current state');
    need(String(p.evidence || '').trim(), 'Add evidence: a link, a photo, or the name of a colleague who can confirm');
    var v = verifierOf(S, meId, ctx.today);
    need(v, 'You have no verifier yet; ask an admin to set one');
    touch(S, it, { status: 'review', evidence: String(p.evidence).trim(), evidenceType: p.evidenceType || 'link', band: p.band || it.band, completedAt: ctx.now, verifierId: v, returnNote: '' }, ctx.now);
    logEvent(S, it.id, meId, 'done', p.evidenceType || 'link', ctx.now);
    notify(S, v, nameOf(S, meId) + ' finished "' + it.title + '". Please verify.', 'verify', it.id, ctx.now);
    return item(S, it.id);
  };

  A.verify = function (S, meId, p, ctx) {
    var ids = p.ids || [p.id], out = [];
    ids.forEach(function (id) {
      var it = mustItem(S, id);
      need(it.status === 'review', 'Item is not waiting for verification');
      need(canVerify(S, meId, it, ctx.today), 'You cannot verify this item');
      touch(S, it, { status: 'verified', verifiedBy: meId, verifiedAt: ctx.now }, ctx.now);
      logEvent(S, it.id, meId, 'verified', p.note || '', ctx.now);
      if (p.thanks) A.thank(S, meId, { id: it.id, note: p.thanks }, ctx);
      out.push(item(S, it.id));
    });
    return out;
  };

  A.returnItem = function (S, meId, p, ctx) {
    var it = mustItem(S, p.id);
    need(it.status === 'review', 'Item is not waiting for verification');
    need(canVerify(S, meId, it, ctx.today), 'You cannot verify this item');
    need(String(p.note || '').trim(), 'Add a note saying what is missing');
    touch(S, it, { status: 'open', returnNote: p.note }, ctx.now);
    logEvent(S, it.id, meId, 'returned', p.note, ctx.now);
    notify(S, it.assigneeId, nameOf(S, meId) + ' returned "' + it.title + '": ' + p.note, 'returned', it.id, ctx.now);
    return item(S, it.id);
  };

  A.help = function (S, meId, p, ctx) {
    var it;
    need(p.reason, 'Choose a reason');
    var reason = p.reason + (p.note ? ': ' + p.note : '');
    if (p.id) {
      it = mustItem(S, p.id);
      need(it.assigneeId === meId, 'Only the assignee can ask for help on this item');
      need(OPEN.indexOf(it.status) >= 0, 'Item is closed');
      touch(S, it, { status: 'blocked', helpReason: reason, helpAt: ctx.now, helpAckBy: '', helpAckAt: '', helpStep: '0', helpResolution: '' }, ctx.now);
    } else {
      it = S.insert('items', {
        id: uid('it'), kind: 'help', title: reason, notes: p.note || '', assigneeId: meId, teamId: '', createdBy: meId, createdAt: ctx.now, updatedAt: ctx.now,
        initiativeId: '', due: '', dueTime: '', status: 'blocked', band: '', collaborators: '', evidence: '', evidenceType: '', verifierId: '', verifiedBy: '', verifiedAt: '',
        completedAt: '', disputeReason: '', returnNote: '', helpReason: reason, helpAt: ctx.now, helpAckBy: '', helpAckAt: '', helpStep: '0', helpResolution: '', overdueStep: '', dutyId: '', thanks: ''
      });
    }
    logEvent(S, it.id, meId, 'help', reason, ctx.now);
    var chain = escalationChain(S, meId, ctx.today);
    notify(S, chain[0], nameOf(S, meId) + ' needs help: ' + reason + (it.kind !== 'help' ? ' (on "' + it.title + '")' : ''), 'help', it.id, ctx.now);
    return item(S, it.id);
  };

  A.ackHelp = function (S, meId, p, ctx) {
    var it = mustItem(S, p.id);
    need(it.status === 'blocked', 'No open help request');
    need(canHandleHelp(S, meId, it, ctx.today), 'You are not in this person\'s escalation line');
    touch(S, it, { helpAckBy: meId, helpAckAt: ctx.now }, ctx.now);
    logEvent(S, it.id, meId, 'help acknowledged', p.note || '', ctx.now);
    notify(S, it.assigneeId, nameOf(S, meId) + ' has seen your help request and is on it.', 'help-ack', it.id, ctx.now);
    return item(S, it.id);
  };

  A.resolveHelp = function (S, meId, p, ctx) {
    var it = mustItem(S, p.id);
    need(it.status === 'blocked', 'No open help request');
    need(canHandleHelp(S, meId, it, ctx.today) || it.assigneeId === meId, 'You are not in this person\'s escalation line');
    need(String(p.note || '').trim(), 'Say what was done');
    touch(S, it, { status: it.kind === 'help' ? 'closed' : 'open', helpResolution: p.note, helpAckBy: it.helpAckBy || meId, helpAckAt: it.helpAckAt || ctx.now }, ctx.now);
    logEvent(S, it.id, meId, 'help resolved', p.note, ctx.now);
    if (it.assigneeId !== meId) notify(S, it.assigneeId, nameOf(S, meId) + ' resolved your help request: ' + p.note + '. Reply THANKS to thank them.', 'help-done', it.id, ctx.now);
    return item(S, it.id);
  };

  A.thank = function (S, meId, p, ctx) {
    var it = mustItem(S, p.id);
    need(String(p.note || '').trim(), 'Write a short thank-you');
    var t = (it.thanks ? it.thanks + '\n' : '') + nameOf(S, meId) + ': ' + p.note;
    touch(S, it, { thanks: t }, ctx.now);
    logEvent(S, it.id, meId, 'thanked', p.note, ctx.now);
    var to = it.assigneeId === meId ? it.helpAckBy : it.assigneeId;
    notify(S, to, nameOf(S, meId) + ' says thank you for "' + it.title + '": ' + p.note, 'thanks', it.id, ctx.now);
    return item(S, it.id);
  };

  A.comment = function (S, meId, p, ctx) {
    var it = mustItem(S, p.id);
    need(canSeeItem(S, meId, it, ctx.today), 'Not allowed');
    need(String(p.note || '').trim(), 'Write a comment');
    logEvent(S, it.id, meId, 'comment', p.note, ctx.now);
    return it;
  };

  // ---- structure ----
  function needStructure(S, meId) { need(isSys(person(S, meId)) || hasRole(person(S, meId), 'hr'), 'Only Owners, the System admin or HR can change the structure'); }
  var PERSON_FIELDS = ['name', 'designation', 'grade', 'entity', 'level', 'managerId', 'verifierId', 'homeTeamId', 'roles', 'phone', 'email', 'lang', 'status', 'leaveFrom', 'leaveUntil', 'coverId', 'notes'];

  A.savePerson = function (S, meId, p, ctx) {
    needStructure(S, meId);
    need(String(p.name || '').trim(), 'Name is required');
    var existing = p.id ? person(S, p.id) : null;
    if (p.managerId) {
      need(person(S, p.managerId), 'Manager not found');
      if (existing) need(!wouldLoop(S, existing.id, p.managerId), 'That would create a reporting loop');
    }
    if (p.verifierId && existing) need(p.verifierId !== existing.id, 'Nobody can verify their own work');
    if (p.roles !== undefined && existing && list(existing.roles).indexOf('owner') >= 0 && list(p.roles).indexOf('owner') < 0) {
      need(owners(S).length > 1, 'There must always be at least one Owner');
    }
    var patch = {};
    PERSON_FIELDS.forEach(function (k) { if (p[k] !== undefined) patch[k] = String(p[k]); });
    var row;
    if (existing) {
      var changes = PERSON_FIELDS.filter(function (k) { return patch[k] !== undefined && String(existing[k] || '') !== patch[k]; })
        .map(function (k) { return k + ': ' + (existing[k] || '—') + ' → ' + (patch[k] || '—'); });
      row = S.update('people', existing.id, patch);
      if (changes.length) logEvent(S, '', meId, 'person changed: ' + existing.name, changes.join('; '), ctx.now);
    } else {
      patch.id = p.newId || nextPersonId(S);
      patch.status = patch.status || 'active';
      patch.lang = patch.lang || 'en';
      row = S.insert('people', patch);
      logEvent(S, '', meId, 'person added: ' + row.name, '', ctx.now);
    }
    return row;
  };
  function nextPersonId(S) {
    var max = 0;
    people(S).forEach(function (p) { var m = /^P(\d+)$/.exec(p.id); if (m) max = Math.max(max, +m[1]); });
    return 'P' + ('000' + (max + 1)).slice(-3);
  }

  A.delegateVerifier = function (S, meId, p, ctx) {
    var me = person(S, meId);
    var scope = scopeIds(S, meId, ctx.today);
    need(p.verifierId && person(S, p.verifierId), 'Choose who will verify');
    need(isSys(me) || scope[p.verifierId], 'The new verifier must be in your team or below you');
    (p.personIds || []).forEach(function (pid) {
      need(isSys(me) || (scope[pid] && pid !== meId), 'You can only delegate for people below you');
      need(pid !== p.verifierId, 'Nobody can verify their own work');
      var old = person(S, pid);
      S.update('people', pid, { verifierId: p.verifierId });
      logEvent(S, '', meId, 'verifier delegated: ' + old.name, (verifierOf(S, pid, ctx.today) || '') + ' ← ' + nameOf(S, p.verifierId), ctx.now);
    });
    return true;
  };

  A.setLeave = function (S, meId, p, ctx) {
    var me = person(S, meId), target = p.personId || meId;
    need(target === meId || isSys(me) || scopeIds(S, meId, ctx.today)[target], 'You cannot set leave for this person');
    if (p.coverId) need(p.coverId !== target && person(S, p.coverId), 'Choose a different cover person');
    S.update('people', target, { leaveFrom: p.leaveFrom || '', leaveUntil: p.leaveUntil || '', coverId: p.coverId || '' });
    logEvent(S, '', meId, 'leave/cover set: ' + nameOf(S, target), (p.leaveFrom || '') + ' to ' + (p.leaveUntil || '') + ', cover ' + nameOf(S, p.coverId), ctx.now);
    return person(S, target);
  };

  A.handover = function (S, meId, p, ctx) {
    needStructure(S, meId);
    need(p.fromId && p.toId && p.fromId !== p.toId, 'Choose two different people');
    var moved = 0;
    S.all('items').forEach(function (it) {
      if (it.assigneeId === p.fromId && (OPEN.indexOf(it.status) >= 0 || it.status === 'review')) {
        S.update('items', it.id, { assigneeId: p.toId, status: it.status === 'review' ? 'review' : 'confirm', updatedAt: ctx.now });
        logEvent(S, it.id, meId, 'handed over', nameOf(S, p.fromId) + ' → ' + nameOf(S, p.toId), ctx.now);
        moved++;
      }
    });
    S.all('duties').forEach(function (d) { if (d.ownerType === 'person' && d.ownerId === p.fromId) { S.update('duties', d.id, { ownerId: p.toId }); moved++; } });
    S.all('teams').forEach(function (t) {
      var patch = {};
      if (t.leadId === p.fromId) patch.leadId = p.toId;
      if (t.deputyId === p.fromId) patch.deputyId = p.toId;
      if (list(t.adminIds).indexOf(p.fromId) >= 0) patch.adminIds = list(t.adminIds).map(function (x) { return x === p.fromId ? p.toId : x; }).join(',');
      if (Object.keys(patch).length) { S.update('teams', t.id, patch); moved++; }
    });
    people(S).forEach(function (q) {
      if (q.managerId === p.fromId) S.update('people', q.id, { managerId: p.toId });
      if (q.verifierId === p.fromId) S.update('people', q.id, { verifierId: p.toId });
    });
    if (p.markLeft) S.update('people', p.fromId, { status: 'left' });
    logEvent(S, '', meId, 'handover', nameOf(S, p.fromId) + ' → ' + nameOf(S, p.toId) + ' (' + moved + ' items, duties and roles)', ctx.now);
    return { moved: moved };
  };

  A.saveTeam = function (S, meId, p, ctx) {
    var me = person(S, meId);
    var existing = p.id ? byId(S.all('teams'))[p.id] : null;
    need(isSys(me) || hasRole(me, 'hr') || (existing && existing.leadId === meId), 'Only Owners, the System admin or the team Lead can change a team');
    need(String(p.name || '').trim(), 'Team name is required');
    need(TEAM_TYPES[p.type || 'home'], 'Unknown team type');
    if (existing && existing.leadId && !p.leadId) need(false, 'A team must always have a Lead');
    var row = { name: p.name, entity: p.entity || '', 'function': p['function'] || '', type: p.type || 'home', leadId: p.leadId || '', deputyId: p.deputyId || '', adminIds: joinList(p.adminIds), endDate: p.endDate || '', initiativeId: p.initiativeId || '', active: p.active === false || p.active === 'false' ? 'false' : 'true' };
    if (existing) {
      if (row.active === 'false' && existing.active !== 'false') {
        var open = S.all('items').filter(function (it) { return it.teamId === existing.id && !it.assigneeId && OPEN.indexOf(it.status) >= 0; });
        open.forEach(function (it) { S.update('items', it.id, { assigneeId: existing.leadId, status: 'confirm', updatedAt: ctx.now }); });
      }
      S.update('teams', existing.id, row);
      logEvent(S, '', meId, 'team changed: ' + row.name, '', ctx.now);
      return byId(S.all('teams'))[existing.id];
    }
    row.id = uid('tm');
    S.insert('teams', row);
    logEvent(S, '', meId, 'team added: ' + row.name, '', ctx.now);
    return row;
  };

  A.setMember = function (S, meId, p, ctx) {
    var t = byId(S.all('teams'))[p.teamId];
    need(t, 'Team not found');
    var me = person(S, meId);
    need(isSys(me) || t.leadId === meId || t.deputyId === meId, 'Only the team Lead or an admin can change members');
    need(person(S, p.personId), 'Person not found');
    var existing = S.all('memberships').filter(function (m) { return m.teamId === p.teamId && m.personId === p.personId; })[0];
    if (p.remove) { if (existing) S.remove('memberships', existing.id); logEvent(S, '', meId, 'member removed: ' + t.name, nameOf(S, p.personId), ctx.now); return true; }
    if (existing) S.update('memberships', existing.id, { role: p.role || 'member' });
    else S.insert('memberships', { id: uid('mb'), teamId: p.teamId, personId: p.personId, role: p.role || 'member' });
    logEvent(S, '', meId, 'member set: ' + t.name, nameOf(S, p.personId) + ' as ' + (p.role || 'member'), ctx.now);
    return true;
  };

  // ---- priorities, initiatives, decisions ----
  A.savePriority = function (S, meId, p, ctx) {
    need(isOwner(person(S, meId)), 'Only Owners set priorities');
    need(String(p.title || '').trim(), 'Title is required');
    var row = { title: p.title, term: p.term || '', ownerId: p.ownerId || meId, active: p.active === false ? 'false' : 'true' };
    if (p.id) { S.update('priorities', p.id, row); return row; }
    row.id = uid('pr'); S.insert('priorities', row);
    logEvent(S, '', meId, 'priority added', row.title, ctx.now);
    return row;
  };
  A.saveInitiative = function (S, meId, p, ctx) {
    need(isOwner(person(S, meId)), 'Only Owners create initiatives');
    need(String(p.title || '').trim(), 'Title is required');
    var row = { title: p.title, priorityId: p.priorityId || '', ownerId: p.ownerId || meId, goal: p.goal || '', endDate: p.endDate || '', status: p.status || 'active' };
    if (p.id) { S.update('initiatives', p.id, row); return row; }
    row.id = uid('in'); S.insert('initiatives', row);
    logEvent(S, '', meId, 'initiative added', row.title, ctx.now);
    if (p.makeTeam) A.saveTeam(S, meId, { name: row.title, type: 'project', leadId: row.ownerId, endDate: row.endDate, initiativeId: row.id }, ctx);
    return row;
  };
  A.recordDecision = function (S, meId, p, ctx) {
    need(isOwner(person(S, meId)), 'Only Owners record decisions');
    need(DECISIONS.indexOf(p.decision) >= 0, 'Choose a decision');
    var ini = byId(S.all('initiatives'))[p.initiativeId];
    need(ini, 'Initiative not found');
    var created = [];
    (p.followups || []).forEach(function (f) {
      if (!f.title) return;
      created.push(A.createItem(S, meId, { kind: 'followup', title: f.title, assigneeId: f.assigneeId || ini.ownerId, due: f.due || '', initiativeId: ini.id }, ctx).id);
    });
    var row = { id: uid('dc'), initiativeId: ini.id, decision: p.decision, note: p.note || '', byId: meId, at: ctx.now, followups: created.join(',') };
    S.insert('decisions', row);
    if (p.decision === 'Stop') S.update('initiatives', ini.id, { status: 'stopped' });
    logEvent(S, '', meId, 'decision: ' + ini.title, p.decision + (p.note ? ' — ' + p.note : ''), ctx.now);
    return row;
  };

  // ---- duties ----
  A.saveDuty = function (S, meId, p, ctx) {
    var me = person(S, meId);
    need(isSys(me) || hasRole(me, 'admin'), 'Only Owners and Administrators manage SOP duties');
    need(String(p.title || '').trim(), 'Title is required');
    need(['daily', 'weekly', 'monthly'].indexOf(p.freq) >= 0, 'Choose how often');
    need(p.ownerId, 'Choose who owns the duty');
    var row = { title: p.title, sopRef: p.sopRef || '', ownerType: p.ownerType || 'person', ownerId: p.ownerId, freq: p.freq, dow: String(p.dow || ''), dom: String(p.dom || ''), time: p.time || '', evidenceHint: p.evidenceHint || '', initiativeId: p.initiativeId || '', active: p.active === false ? 'false' : 'true' };
    if (p.id) { S.update('duties', p.id, row); logEvent(S, '', meId, 'duty changed', row.title, ctx.now); return row; }
    row.id = uid('du'); S.insert('duties', row);
    logEvent(S, '', meId, 'duty added', row.title, ctx.now);
    return row;
  };
  function dutyDates(S, d, fromStr, toStr) {
    var out = [], cfg = settings(S), day = fromStr;
    for (var i = 0; i < 40 && day <= toStr; i++) {
      var dt = parseDate(day), ok = false;
      if (d.freq === 'daily') ok = isWorkingDay(S, day, cfg);
      if (d.freq === 'weekly') ok = String(dt.getDay()) === String(d.dow);
      if (d.freq === 'monthly') ok = String(dt.getDate()) === String(d.dom || 1);
      if (ok) {
        var due = day;
        for (var k = 0; k < 7 && !isWorkingDay(S, due, cfg) && d.freq !== 'daily'; k++) due = addDays(due, -1);
        if (out.indexOf(due) < 0) out.push(due);
      }
      day = addDays(day, 1);
    }
    return out;
  }
  function generateDuties(S, ctx) {
    var made = 0, items = S.all('items');
    S.all('duties').forEach(function (d) {
      if (d.active === 'false') return;
      dutyDates(S, d, ctx.today, addDays(ctx.today, 6)).forEach(function (due) {
        var exists = items.some(function (it) { return it.dutyId === d.id && it.due === due; });
        if (exists) return;
        var assignee = d.ownerType === 'person' ? resolveCover(S, d.ownerId, due) : '';
        var team = d.ownerType === 'team' ? d.ownerId : '';
        var it = S.insert('items', {
          id: uid('it'), kind: 'duty', title: d.title, notes: (d.sopRef ? 'SOP: ' + d.sopRef + '. ' : '') + (d.evidenceHint ? 'Evidence: ' + d.evidenceHint : ''),
          assigneeId: assignee, teamId: team, createdBy: 'system', createdAt: ctx.now, updatedAt: ctx.now, initiativeId: d.initiativeId || '', due: due, dueTime: d.time || '',
          status: 'open', band: '', collaborators: '', evidence: '', evidenceType: '', verifierId: '', verifiedBy: '', verifiedAt: '', completedAt: '', disputeReason: '', returnNote: '',
          helpReason: '', helpAt: '', helpAckBy: '', helpAckAt: '', helpStep: '', helpResolution: '', overdueStep: '', dutyId: d.id, thanks: ''
        });
        items.push(it);
        logEvent(S, it.id, 'system', 'duty created', '', ctx.now);
        made++;
      });
    });
    return made;
  }
  A.generateDuties = function (S, meId, p, ctx) {
    var me = person(S, meId);
    need(isSys(me) || hasRole(me, 'admin'), 'Not allowed');
    return { created: generateDuties(S, ctx) };
  };

  A.saveReview = function (S, meId, p, ctx) {
    var t = byId(S.all('teams'))[p.teamId];
    need(t, 'Team not found');
    var me = person(S, meId);
    need(isOwner(me) || t.leadId === meId || t.deputyId === meId || list(t.adminIds).indexOf(meId) >= 0, 'Only the team Lead, Deputy or Team Admin records the review');
    var made = [];
    (p.commitments || []).forEach(function (c) {
      if (!c || !String(c.title || '').trim()) return;
      var target = c.personId || meId;
      var it = A.createItem(S, meId, { kind: 'followup', title: c.title, assigneeId: target, due: c.due || addDays(ctx.today, 7), notes: 'Commitment from the ' + t.name + ' weekly review', initiativeId: c.initiativeId || '' }, ctx);
      made.push(it.id);
    });
    var row = S.insert('reviews', { id: uid('rv'), teamId: t.id, date: ctx.today, heldBy: meId, notes: p.notes || '', commitments: made.join(',') });
    logEvent(S, '', meId, 'weekly review: ' + t.name, made.length + ' commitment(s)', ctx.now);
    return row;
  };

  A.saveSettings = function (S, meId, p, ctx) {
    need(isSys(person(S, meId)), 'Only Owners and the System admin change settings');
    Object.keys(p || {}).forEach(function (k) {
      if (!(k in DEFAULT_SETTINGS)) return;
      var row = S.all('settings').filter(function (r) { return r.key === k; })[0];
      if (row) S.update('settings', row.key, { value: String(p[k]) }); else S.insert('settings', { key: k, value: String(p[k]) });
    });
    logEvent(S, '', meId, 'settings changed', Object.keys(p || {}).join(', '), ctx.now);
    return settings(S);
  };

  function act(S, meId, action, payload, now) {
    var fn = A[action];
    if (!fn) throw err('Unknown action: ' + action);
    var me = person(S, meId);
    if (!me || !active(me)) throw err('Your account is not active');
    var ctx = { now: now || new Date().toISOString(), today: isoDate(new Date(now || Date.now())) };
    return fn(S, meId, payload || {}, ctx);
  }

  // ---------- scheduled jobs (escalation, reminders, digest) ----------
  function runJobs(S, nowIso) {
    var cfg = settings(S), now = nowIso || new Date().toISOString(), today = isoDate(new Date(now));
    var ctx = { now: now, today: today }, report = { duties: 0, helpEsc: 0, overdueEsc: 0, reminders: 0 };
    report.duties = generateDuties(S, ctx);
    var helpH = num(cfg.helpEscHours, 4);
    S.all('items').forEach(function (it) {
      if (it.status === 'blocked' && !it.helpAckAt) {
        var h = workingHoursBetween(S, it.helpAt, now);
        var step = num(it.helpStep, 0);
        var target = h >= helpH * 2 ? 2 : h >= helpH ? 1 : 0;
        if (target > step) {
          var chain = escalationChain(S, it.assigneeId, today);
          var to = chain[Math.min(target, chain.length - 1)];
          notify(S, to, 'Unanswered help request from ' + nameOf(S, it.assigneeId) + ' (' + Math.round(h) + ' working hours): ' + it.helpReason, 'escalation', it.id, now);
          S.update('items', it.id, { helpStep: String(target) });
          logEvent(S, it.id, 'system', 'escalated', 'to ' + nameOf(S, to), now);
          report.helpEsc++;
        }
      }
      if (isOverdue(it, today) && it.assigneeId) {
        var days = workingDaysBetween(S, it.due, today);
        var ostep = num(it.overdueStep, 0);
        var otarget = days >= num(cfg.overdueEscDays2, 3) ? 2 : days >= num(cfg.overdueEscDays1, 1) ? 1 : 0;
        if (otarget > ostep) {
          var ch = escalationChain(S, it.assigneeId, today);
          var who = ch[Math.min(otarget - 1, ch.length - 1)];
          notify(S, who, '"' + it.title + '" (' + nameOf(S, it.assigneeId) + ') is ' + days + ' working day(s) overdue.', 'escalation', it.id, now);
          S.update('items', it.id, { overdueStep: String(otarget) });
          logEvent(S, it.id, 'system', 'overdue escalated', 'to ' + nameOf(S, who), now);
          report.overdueEsc++;
        }
      }
    });
    return report;
  }
  function dailyReminders(S, nowIso) {
    var now = nowIso || new Date().toISOString(), today = isoDate(new Date(now)), tomorrow = addDays(today, 1), n = 0;
    var byPerson = {};
    S.all('items').forEach(function (it) {
      if (!it.assigneeId || ['open', 'confirm', 'blocked'].indexOf(it.status) < 0) return;
      if (it.due === today || it.due === tomorrow) (byPerson[it.assigneeId] = byPerson[it.assigneeId] || []).push(it);
    });
    Object.keys(byPerson).forEach(function (pid) {
      var lines = byPerson[pid].map(function (it) { return '• ' + it.title + (it.due === today ? ' (today' : ' (tomorrow') + (it.dueTime ? ' ' + it.dueTime : '') + ')'; });
      notify(S, pid, 'Due soon:\n' + lines.join('\n') + '\nReply DONE or HELP on each item, or MY WORK for your list.', 'reminder', '', now);
      n++;
    });
    var verifiers = {};
    S.all('items').forEach(function (it) { if (it.status === 'review' && it.verifierId) verifiers[it.verifierId] = (verifiers[it.verifierId] || 0) + 1; });
    Object.keys(verifiers).forEach(function (v) { notify(S, v, verifiers[v] + ' item(s) waiting for you to verify. Open the Team page to verify them.', 'verify-batch', '', now); n++; });
    return n;
  }

  // ---------- signals: who needs help ----------
  function signals(S, meId, today) {
    var cfg = settings(S), me = person(S, meId), out = [];
    var items = visibleItems(S, meId, today), scope = scopeIds(S, meId, today);
    var nowIso = new Date().toISOString();
    items.forEach(function (it) {
      if (it.status === 'blocked') out.push({ sev: it.helpAckAt ? 2 : 3, type: 'Help request', personId: it.assigneeId, itemId: it.id, title: it.helpReason, age: it.helpAt, detail: it.helpAckAt ? 'Acknowledged by ' + nameOf(S, it.helpAckBy) : 'Not yet acknowledged · ' + Math.round(workingHoursBetween(S, it.helpAt, nowIso)) + ' working h' });
      else if (isOverdue(it, today)) out.push({ sev: it.kind === 'duty' ? 2 : 1, type: it.kind === 'duty' ? 'Overdue SOP duty' : 'Overdue', personId: it.assigneeId, itemId: it.id, title: it.title, age: it.due, detail: 'Due ' + it.due + ' · ' + workingDaysBetween(S, it.due, today) + ' working day(s) late' });
      if (it.status === 'disputed' && workingDaysBetween(S, String(it.updatedAt).slice(0, 10), today) >= num(cfg.disputeDays, 2)) out.push({ sev: 1, type: 'Stale dispute', personId: it.createdBy, itemId: it.id, title: it.title, age: it.updatedAt, detail: it.disputeReason });
      if (it.status === 'confirm' && workingDaysBetween(S, String(it.updatedAt).slice(0, 10), today) >= num(cfg.confirmDays, 2)) out.push({ sev: 1, type: 'Unconfirmed', personId: it.assigneeId, itemId: it.id, title: it.title, age: it.updatedAt, detail: 'No reply from ' + nameOf(S, it.assigneeId) });
    });
    var backlog = {};
    items.forEach(function (it) { if (it.status === 'review' && workingDaysBetween(S, String(it.completedAt).slice(0, 10), today) >= num(cfg.verifyDays, 7)) backlog[it.verifierId] = (backlog[it.verifierId] || 0) + 1; });
    Object.keys(backlog).forEach(function (v) { out.push({ sev: 1, type: 'Silent verifier', personId: v, title: nameOf(S, v) + ' has ' + backlog[v] + ' item(s) waiting over ' + cfg.verifyDays + ' days', detail: '' }); });
    people(S).filter(function (p) { return active(p) && scope[p.id]; }).forEach(function (p) {
      var mine = items.filter(function (it) { return it.assigneeId === p.id && OPEN.indexOf(it.status) >= 0 && isCurrent(it, today); });
      var od = mine.filter(function (it) { return isOverdue(it, today); }).length;
      if (mine.length > num(cfg.overloadOpen, 8) || od >= num(cfg.overloadOverdue, 3)) out.push({ sev: 2, type: 'Overloaded', personId: p.id, title: p.name + ': ' + mine.length + ' open, ' + od + ' overdue', detail: '' });
      var span = spanOf(S, p.id, today);
      if (span > num(cfg.spanLimit, 15)) out.push({ sev: 1, type: 'Too many to verify', personId: p.id, title: p.name + ' verifies ' + span + ' people', detail: 'Delegate verification to sub-team Leads' });
    });
    if (isOwner(me)) {
      var all = S.all('items');
      S.all('priorities').filter(function (pr) { return pr.active !== 'false'; }).forEach(function (pr) {
        var inis = S.all('initiatives').filter(function (i) { return i.priorityId === pr.id; }).map(function (i) { return i.id; });
        var last = all.filter(function (it) { return inis.indexOf(it.initiativeId) >= 0; }).map(function (it) { return String(it.updatedAt).slice(0, 10); }).sort().pop();
        if (!last || workingDaysBetween(S, last, today) >= num(cfg.neglectDays, 21) * 5 / 7) out.push({ sev: 1, type: 'Neglected priority', title: pr.title, detail: last ? 'No activity since ' + last : 'No work logged yet' });
      });
    }
    out.sort(function (a, b) { return b.sev - a.sev || String(a.age || '').localeCompare(String(b.age || '')); });
    return out;
  }

  // ---------- dashboards ----------
  function personStats(S, pid, items, today) {
    var mine = items.filter(function (it) { return it.assigneeId === pid; });
    var open = mine.filter(function (it) { return OPEN.indexOf(it.status) >= 0 && isCurrent(it, today); });
    return {
      open: open.length,
      overdue: open.filter(function (it) { return isOverdue(it, today); }).length,
      blocked: mine.filter(function (it) { return it.status === 'blocked'; }).length,
      review: mine.filter(function (it) { return it.status === 'review'; }).length,
      verified: mine.filter(function (it) { return it.status === 'verified'; }).length,
      load: loadHours(open.filter(function (it) { return it.status !== 'confirm'; })),
      contributions: mine.filter(function (it) { return it.kind === 'contribution' && it.status === 'verified'; }).length
    };
  }
  function orgStats(S, items, today) {
    var since = addDays(today, -30);
    var recent = items.filter(function (it) { return String(it.updatedAt).slice(0, 10) >= since; });
    var duties = recent.filter(function (it) { return it.kind === 'duty' && it.due && it.due < today && it.status !== 'cancelled'; });
    var onTime = duties.filter(function (it) { return it.completedAt && String(it.completedAt).slice(0, 10) <= it.due; }).length;
    var done = recent.filter(function (it) { return it.status === 'verified' || it.status === 'review'; });
    var helps = items.filter(function (it) { return it.helpAt && it.helpAckAt && String(it.helpAt).slice(0, 10) >= since; });
    var resp = helps.length ? helps.reduce(function (a, it) { return a + workingHoursBetween(S, it.helpAt, it.helpAckAt); }, 0) / helps.length : null;
    return {
      open: items.filter(function (it) { return OPEN.indexOf(it.status) >= 0 && isCurrent(it, today); }).length,
      overdue: items.filter(function (it) { return isOverdue(it, today); }).length,
      helpOpen: items.filter(function (it) { return it.status === 'blocked'; }).length,
      awaitingVerification: items.filter(function (it) { return it.status === 'review'; }).length,
      dutyOnTime: duties.length ? Math.round(onTime / duties.length * 100) : null,
      verifiedRate: done.length ? Math.round(done.filter(function (it) { return it.status === 'verified'; }).length / done.length * 100) : null,
      helpResponseHours: resp === null ? null : Math.round(resp * 10) / 10,
      contributions: recent.filter(function (it) { return it.kind === 'contribution'; }).length
    };
  }
  function teamStats(S, teamId, items, today) {
    var ids = teamMemberIds(S, teamId);
    return ids.map(function (pid) { var s = personStats(S, pid, items, today); s.personId = pid; return s; });
  }
  function initiativeStats(S, items) {
    return S.all('initiatives').map(function (ini) {
      var its = items.filter(function (it) { return it.initiativeId === ini.id && it.status !== 'cancelled'; });
      var teams = {};
      its.forEach(function (it) { var p = person(S, it.assigneeId); if (p && p.homeTeamId) teams[p.homeTeamId] = true; });
      var effort = loadHours(its.filter(function (it) { return it.status === 'verified' || it.status === 'review'; }));
      return { id: ini.id, items: its.length, verified: its.filter(function (it) { return it.status === 'verified'; }).length, effort: effort, teams: Object.keys(teams), last: its.map(function (it) { return String(it.updatedAt).slice(0, 10); }).sort().pop() || '' };
    });
  }
  function digestText(S, meId, today) {
    var cfg = settings(S), sig = signals(S, meId, today);
    var count = function (t) { return sig.filter(function (s) { return s.type === t; }).length; };
    var lines = [];
    lines.push('Good morning. ' + cfg.orgName + ' digest for ' + today + '.');
    var help = sig.filter(function (s) { return s.type === 'Help request'; });
    if (help.length) lines.push(help.length + ' open help request(s), ' + help.filter(function (s) { return s.sev === 3; }).length + ' not yet acknowledged.');
    if (count('Overdue SOP duty')) lines.push(count('Overdue SOP duty') + ' SOP duty item(s) overdue.');
    if (count('Overdue')) lines.push(count('Overdue') + ' other item(s) overdue.');
    if (count('Stale dispute')) lines.push(count('Stale dispute') + ' dispute(s) unresolved.');
    if (count('Overloaded')) lines.push(count('Overloaded') + ' person/people overloaded.');
    if (count('Silent verifier')) lines.push(count('Silent verifier') + ' verifier(s) behind.');
    if (count('Neglected priority')) lines.push(count('Neglected priority') + ' priority/priorities with no recent work.');
    if (lines.length === 1) lines.push('Nothing needs your attention today.');
    var top = sig.slice(0, 5).map(function (s) { return '• ' + s.type + ': ' + (s.personId && s.type !== 'Overloaded' && s.type !== 'Silent verifier' && s.type !== 'Too many to verify' ? nameOf(S, s.personId) + ' — ' : '') + s.title; });
    return lines.concat(top).join('\n');
  }

  return {
    SCHEMA: SCHEMA, DEFAULT_SETTINGS: DEFAULT_SETTINGS, STATUS: STATUS, OPEN: OPEN, KINDS: KINDS, BANDS: BANDS, BAND_LABELS: BAND_LABELS, LEVELS: LEVELS,
    DISPUTE_REASONS: DISPUTE_REASONS, HELP_REASONS: HELP_REASONS, DECISIONS: DECISIONS, TEAM_TYPES: TEAM_TYPES,
    isoDate: isoDate, addDays: addDays, list: list, uid: uid, byId: byId, settings: settings,
    person: person, isOwner: isOwner, isSys: isSys, hasRole: hasRole, onLeave: onLeave, verifierOf: verifierOf, escalationChain: escalationChain,
    teamsLedBy: teamsLedBy, teamMemberIds: teamMemberIds, scopeIds: scopeIds, spanOf: spanOf, structureIssues: structureIssues, orgTree: orgTree,
    canSeeItem: canSeeItem, isCurrent: isCurrent, visibleItems: visibleItems, canAssignTo: canAssignTo, canVerify: canVerify, canHandleHelp: canHandleHelp, isOverdue: isOverdue,
    act: act, actions: Object.keys(A), runJobs: runJobs, dailyReminders: dailyReminders, generateDuties: generateDuties,
    signals: signals, personStats: personStats, orgStats: orgStats, teamStats: teamStats, initiativeStats: initiativeStats, digestText: digestText,
    workingDaysBetween: workingDaysBetween, workingHoursBetween: workingHoursBetween, nameOf: nameOf
  };
})();
if (typeof module !== 'undefined') module.exports = Core;
