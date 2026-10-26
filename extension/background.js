/* Passes the content scripts' lookups to the engine (host.js) and shows on the toolbar button when Yaoki Reader is
   switched off. Chrome and Edge run this as a service worker, which cannot hold the engine: the engine runs in an
   offscreen document (host.html) that stays open while the service worker comes and goes. Firefox and Safari run
   this in a background page that has host.js loaded beside it. */
var api = typeof browser !== 'undefined' && browser.runtime ? browser : chrome;

var opening = null;
function hasHost() {
  if (chrome.runtime.getContexts) {
    return chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).then(function (c) { return c.length > 0; });
  }
  return chrome.offscreen.hasDocument ? chrome.offscreen.hasDocument() : Promise.resolve(false);
}
function openHost() {
  if (!chrome.offscreen) return Promise.reject(new Error('this browser cannot run the dictionary in the background (it has no offscreen documents)'));
  if (!opening) {
    opening = hasHost().then(function (has) {
      if (has) return;
      return chrome.offscreen.createDocument({
        url: 'host.html',
        reasons: ['WORKERS'],
        justification: 'Keeps the 40 MB Japanese dictionary and tokenizer loaded in a worker between lookups, shared by all tabs, so each lookup answers at once.',
      });
    }).catch(function (err) {
      /* opened in the meantime by another lookup */
      if (!/single offscreen|already/i.test(String((err && err.message) || err))) throw err;
    }).finally(function () { opening = null; });
  }
  return opening;
}
function toHost(msg, again) {
  if (self.YaokiHost) return self.YaokiHost.handle(msg);
  return openHost().then(function () {
    return chrome.runtime.sendMessage(Object.assign({ to: 'yaoki-host' }, msg));
  }).then(function (res) {
    if (res === undefined && !again) return toHost(msg, true);
    return res;
  }, function (err) {
    /* the offscreen document was closing or not listening yet */
    if (!again) return new Promise(function (r) { setTimeout(r, 150); }).then(function () { return toHost(msg, true); });
    throw err;
  });
}

/* Safari closes a background page about 30 s after its last event, and the engine with it: the answers say so,
   and pages with Japanese on them send a ping now and then while they are open (content.js) */
var manifest = api.runtime.getManifest();
var closesWhenIdle = !!self.YaokiHost && !(manifest.manifest_version === 2 && manifest.background && manifest.background.persistent !== false);

api.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || msg.to || typeof msg.type !== 'string' || msg.type.indexOf('yaoki:') !== 0) return false;
  if (sender && sender.id && sender.id !== api.runtime.id) return false;
  if (msg.type === 'yaoki:keep') {
    keepWord(msg).then(sendResponse, function (err) { sendResponse({ error: String((err && err.message) || err) }); });
    return true;
  }
  /* a ping that finds the page reopened (Safari closed it anyway, short of memory) starts loading the engine again */
  if (msg.type === 'yaoki:ping') msg = { type: 'yaoki:warm' };
  /* the panel asking how far the engine has got does not open Chrome's offscreen document by itself */
  if (msg.type === 'yaoki:status' && !self.YaokiHost) {
    hasHost().then(function (has) {
      return has ? toHost(msg) : { state: 'idle', done: 0, total: 17, error: '' };
    }).then(sendResponse, function (err) { sendResponse({ error: String((err && err.message) || err) }); });
    return true;
  }
  toHost(msg).then(function (res) {
    if (closesWhenIdle && res && typeof res === 'object') res.keep = true;
    sendResponse(res);
  }, function (err) { sendResponse({ error: String((err && err.message) || err) }); });
  return true;
});

/* The list of words looked up (のぞいた語句): kept in the browser's extension storage on this device as 'looked',
   newest first, one entry per word and reading (a word met again moves to the top, with its newest sentence and a
   count), at most LOOKED entries; 'lookedHead' (how many, the newest few) is what the panel reads. Writes from all
   tabs go one after another. Never storage.sync, which would send the list to the browser's maker. */
var LOOKED = 1500, keeping = Promise.resolve();
function text(v, n) { return typeof v === 'string' ? v.slice(0, n) : ''; }
function keepWord(m) {
  var w = text(m.w, 60), r = text(m.r, 60);
  if (!w) return Promise.resolve({ error: 'no word' });
  var done = keeping.then(function () {
    return api.storage.local.get('looked').then(function (v) {
      var list = Array.isArray(v && v.looked) ? v.looked : [], now = Date.now();
      var at = -1;
      for (var i = 0; i < list.length; i++) if (list[i] && list[i].w === w && list[i].r === r) { at = i; break; }
      var entry = at >= 0 ? list.splice(at, 1)[0] : { w: w, r: r, n: 0, first: now };
      entry.n = (entry.n || 0) + 1;
      entry.e = text(m.e, 200) || entry.e || '';
      entry.x = text(m.x, 80);
      entry.s = text(m.s, 200);
      entry.a = Math.max(0, Math.min(entry.s.length, m.a | 0));
      entry.b = Math.max(entry.a, Math.min(entry.s.length, m.b | 0));
      entry.t = text(m.t, 100);
      entry.u = /^https?:/.test(text(m.u, 300)) ? text(m.u, 300) : '';
      entry.at = now;
      list.unshift(entry);
      if (list.length > LOOKED) list.length = LOOKED;
      return api.storage.local.set({ looked: list, lookedHead: { n: list.length, recent: list.slice(0, 5) } }).then(function () { return { ok: true, n: list.length }; });
    });
  });
  keeping = done.catch(function () {});
  return done;
}

/* once, when it is installed: a page that says what the gesture is, with lines to try it on (on a phone there is
   no toolbar to find that out from) */
api.runtime.onInstalled.addListener(function (d) {
  if (d && d.reason === 'install') api.tabs.create({ url: api.runtime.getURL('welcome.html') });
});

/* the keyboard shortcut (the manifest's command) switches it on or off everywhere */
var DEFAULTS = { on: true, off: [], furigana: true, meanings: true, grammar: true, more: true, hold: 1, keep: true, size: 1 };
function toggleOn() {
  return api.storage.local.get('settings').then(function (v) {
    var s = Object.assign({}, DEFAULTS, v && v.settings);
    s.on = !s.on;
    return api.storage.local.set({ settings: s }).then(function () { return s.on; });
  });
}
if (api.commands && api.commands.onCommand) api.commands.onCommand.addListener(function (name) { if (name === 'toggle') toggleOn(); });

function badge(settings) {
  var action = api.action || api.browserAction;
  if (!action || !action.setBadgeText) return;
  try {
    action.setBadgeText({ text: settings && settings.on === false ? 'off' : '' });
    if (action.setBadgeBackgroundColor) action.setBadgeBackgroundColor({ color: '#5A6382' });
  } catch (err) { /* no badges here (Firefox for Android) */ }
}
api.storage.onChanged.addListener(function (ch, area) { if (area === 'local' && ch.settings) badge(ch.settings.newValue); });
api.storage.local.get('settings').then(function (v) { badge(v && v.settings); }).catch(function () {});
