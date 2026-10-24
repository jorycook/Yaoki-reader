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
        justification: 'Runs the Japanese tokenizer and dictionary in a worker shared by all tabs, so they load once.',
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
  /* a ping that finds the page reopened (Safari closed it anyway, short of memory) starts loading the engine again */
  if (msg.type === 'yaoki:ping') msg = { type: 'yaoki:warm' };
  toHost(msg).then(function (res) {
    if (closesWhenIdle && res && typeof res === 'object') res.keep = true;
    sendResponse(res);
  }, function (err) { sendResponse({ error: String((err && err.message) || err) }); });
  return true;
});

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
