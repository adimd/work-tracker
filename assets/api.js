/* API layer: talks to the Apps Script backend, or runs everything locally in demo mode. */
var API = (function () {
  'use strict';
  var cfg = window.WT_CONFIG || {};
  var DEMO_KEY = 'wt_demo_v1', TOKEN_KEY = 'wt_token', DEMO_USER = 'wt_demo_user';
  var demoStore = null;

  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }

  var mode = (/[?&]demo=1/.test(location.search) || !cfg.apiUrl) ? 'demo' : 'remote';
  if (safeGet('wt_mode') === 'demo' && cfg.allowDemo !== false) mode = 'demo';

  // ---------------- remote ----------------
  function post(body) {
    return fetch(cfg.apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' })
      .then(function (r) { return r.json(); })
      .catch(function () { throw { message: 'Could not reach the server. Check your connection and try again.' }; })
      .then(function (res) {
        if (!res.ok) { var e = { message: res.error || 'Something went wrong', auth: res.auth, mustChange: res.mustChange }; if (res.auth) safeSet(TOKEN_KEY, null); throw e; }
        return res.data;
      });
  }
  function call(action, payload, extra) {
    var body = Object.assign({ action: action, token: safeGet(TOKEN_KEY), payload: payload || {} }, extra || {});
    return post(body);
  }

  // ---------------- demo ----------------
  function demo() {
    if (demoStore) return demoStore;
    var saved = safeGet(DEMO_KEY);
    var data = null;
    try { data = saved ? JSON.parse(saved) : null; } catch (e) { data = null; }
    demoStore = new MemoryStore(data || DemoData.build(Core.isoDate(new Date())));
    if (!data) { Core.runJobs(demoStore, new Date().toISOString()); saveDemo(); }
    return demoStore;
  }
  function saveDemo() { safeSet(DEMO_KEY, JSON.stringify(demoStore.dump())); }
  function later(fn) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () { try { resolve(fn()); } catch (e) { reject({ message: e.message }); } }, 60);
    });
  }
  function demoMe() { var id = safeGet(DEMO_USER); if (!id) throw { message: 'Please sign in', auth: true }; return id; }
  function demoBootstrap() {
    var S = demo(), meId = demoMe(), today = Core.isoDate(new Date());
    return {
      meId: meId, today: today, demo: true,
      people: S.all('people'), teams: S.all('teams'), memberships: S.all('memberships'), priorities: S.all('priorities'),
      initiatives: S.all('initiatives'), items: Core.visibleItems(S, meId, today), duties: S.all('duties'), decisions: S.all('decisions'), settings: S.all('settings'), whatsapp: false,
      summaries: S.all('summaries').filter(function (r) { return Insights.canSee(S, meId, r.scopeType, r.scopeId, today); }),
      reviews: S.all('reviews'), ai: { connected: false, demo: true }
    };
  }

  return {
    mode: function () { return mode; },
    setMode: function (m) { mode = m; safeSet('wt_mode', m === 'demo' ? 'demo' : null); },
    canDemo: function () { return cfg.allowDemo !== false; },
    hasRemote: function () { return !!cfg.apiUrl; },
    signedIn: function () { return mode === 'demo' ? !!safeGet(DEMO_USER) : !!safeGet(TOKEN_KEY); },
    demoPeople: function () { return demo().all('people'); },
    resetDemo: function () { safeSet(DEMO_KEY, null); demoStore = null; demo(); },
    login: function (id, password) {
      if (mode === 'demo') return later(function () { safeSet(DEMO_USER, id); return { personId: id, mustChange: false }; });
      return post({ action: 'login', payload: { id: id, password: password } }).then(function (r) { safeSet(TOKEN_KEY, r.token); return r; });
    },
    logout: function () {
      if (mode === 'demo') { safeSet(DEMO_USER, null); return Promise.resolve(true); }
      var p = call('logout').catch(function () { return true; });
      safeSet(TOKEN_KEY, null);
      return p;
    },
    bootstrap: function () { return mode === 'demo' ? later(demoBootstrap) : call('bootstrap'); },
    act: function (name, payload) {
      if (mode === 'demo') return later(function () { var r = Core.act(demo(), demoMe(), name, payload, new Date().toISOString()); saveDemo(); return r; });
      return call('act', payload, { name: name });
    },
    events: function (id) {
      if (mode === 'demo') return later(function () { return demo().all('events').filter(function (e) { return e.itemId === id; }); });
      return call('itemEvents', { id: id });
    },
    changePassword: function (oldPassword, newPassword) {
      if (mode === 'demo') return later(function () { return true; });
      return call('changePassword', { oldPassword: oldPassword, newPassword: newPassword });
    },
    resetPassword: function (personId) {
      if (mode === 'demo') return later(function () { return { tempPassword: '(demo: no passwords)', staffId: personId }; });
      return call('resetPassword', { personId: personId });
    },
    audit: function () {
      if (mode === 'demo') return later(function () { return demo().all('events').filter(function (e) { return !e.itemId; }).slice(-300).reverse(); });
      return call('auditLog');
    },
    outbox: function () {
      if (mode === 'demo') return later(function () { return demo().all('outbox').slice(-200).reverse(); });
      return call('outbox');
    },
    digest: function () {
      if (mode === 'demo') return later(function () { return Core.digestText(demo(), demoMe(), Core.isoDate(new Date())); });
      return call('digestPreview');
    },
    summarize: function (p) {
      if (mode === 'demo') return later(function () {
        var S = demo(), meId = demoMe(), today = Core.isoDate(new Date());
        if (!Insights.canSee(S, meId, p.scopeType, p.scopeId, today)) throw { message: 'You cannot see a summary for this' };
        var range = Insights.periodRange(S, p.period || 'week', today, p.custom);
        var text = Insights.templateText(Insights.facts(S, p.scopeType, p.scopeId || '', range, p.entity || '', today));
        var row = S.insert('summaries', { id: Core.uid('sm'), type: p.type || 'custom', scopeType: p.scopeType, scopeId: p.scopeId || '', entity: p.entity || '', from: range.from, to: range.to, text: text, source: 'template', createdAt: new Date().toISOString(), createdBy: meId });
        saveDemo();
        return row;
      });
      return call('summarize', p);
    },
    queueTermSummaries: function () {
      if (mode === 'demo') return later(function () {
        var S = demo(), today = Core.isoDate(new Date()), n = 0;
        S.all('people').filter(function (x) { return x.status !== 'left'; }).forEach(function (x) {
          var range = Insights.periodRange(S, 'term', today);
          S.insert('summaries', { id: Core.uid('sm'), type: 'term', scopeType: 'person', scopeId: x.id, entity: '', from: range.from, to: range.to, text: Insights.templateText(Insights.facts(S, 'person', x.id, range, '', today)), source: 'template', createdAt: new Date().toISOString(), createdBy: 'system' });
          n++;
        });
        saveDemo();
        return { queued: n, note: 'Demo: written straight away.' };
      });
      return call('queueTermSummaries');
    },
    runJobs: function () {
      if (mode === 'demo') return later(function () { var r = Core.runJobs(demo(), new Date().toISOString()); Core.dailyReminders(demo(), new Date().toISOString()); saveDemo(); return r; });
      return call('runJobsNow');
    }
  };
})();
