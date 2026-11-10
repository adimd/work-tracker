/* In-memory store with the same interface as the Google Sheets store. Used for demo mode,
 * for computing dashboards in the browser, and for tests. */
var MemoryStore = (function () {
  'use strict';
  function keyOf(table) { return table === 'settings' ? 'key' : 'id'; }
  function MemoryStore(data) {
    this.data = {};
    var self = this;
    Object.keys(Core.SCHEMA).forEach(function (t) { self.data[t] = (data && data[t]) ? data[t].map(function (r) { return Object.assign({}, r); }) : []; });
  }
  MemoryStore.prototype.all = function (t) { return this.data[t] || (this.data[t] = []); };
  MemoryStore.prototype.insert = function (t, obj) {
    var row = {};
    (Core.SCHEMA[t] || Object.keys(obj)).forEach(function (k) { row[k] = obj[k] === undefined || obj[k] === null ? '' : String(obj[k]); });
    this.all(t).push(row);
    return row;
  };
  MemoryStore.prototype.update = function (t, id, patch) {
    var k = keyOf(t), rows = this.all(t);
    for (var i = 0; i < rows.length; i++) {
      if (rows[i][k] === id) {
        Object.keys(patch).forEach(function (f) { rows[i][f] = patch[f] === undefined || patch[f] === null ? '' : String(patch[f]); });
        return rows[i];
      }
    }
    throw new Error('Not found: ' + t + ' ' + id);
  };
  MemoryStore.prototype.remove = function (t, id) {
    var k = keyOf(t);
    this.data[t] = this.all(t).filter(function (r) { return r[k] !== id; });
  };
  MemoryStore.prototype.dump = function () { return JSON.parse(JSON.stringify(this.data)); };
  return MemoryStore;
})();
if (typeof module !== 'undefined') module.exports = MemoryStore;
