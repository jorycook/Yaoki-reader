/* The toolbar button's panel: switches kept in storage.local (content.js follows them on every open page), the site
   of the tab it was opened from, and how far the dictionary has loaded. */
(function () {
'use strict';
var api = typeof browser !== 'undefined' && browser.runtime ? browser : chrome;
var DEFAULTS = { on: true, off: [], furigana: true, meanings: true, grammar: true, hold: 1 };
var S = Object.assign({}, DEFAULTS), site = '';
function $(id) { return document.getElementById(id); }

function save() { return api.storage.local.set({ settings: S }); }
function render() {
  $('sw-on').setAttribute('aria-checked', String(S.on));
  ['furigana', 'meanings', 'grammar'].forEach(function (k) { $('sw-' + k).setAttribute('aria-checked', String(S[k])); });
  [0, 1, 2].forEach(function (i) { $('hold-' + i).setAttribute('aria-pressed', String(S.hold === i)); });
  var b = $('sw-site');
  if (site) {
    b.disabled = !S.on;
    b.setAttribute('aria-checked', String(S.off.indexOf(site) < 0));
    $('site-name').textContent = site;
    $('site-ds').textContent = !S.on ? 'Yaoki Reader is off everywhere.' : S.off.indexOf(site) < 0 ? 'On for this site. Switch it off to leave its pages alone.' : 'Off for this site.';
  }
}
api.storage.local.get('settings').then(function (v) {
  S = Object.assign({}, DEFAULTS, v && v.settings);
  render();
});

$('sw-on').addEventListener('click', function () { S.on = !S.on; render(); save(); });
['furigana', 'meanings', 'grammar'].forEach(function (k) {
  $('sw-' + k).addEventListener('click', function () { S[k] = !S[k]; render(); save(); });
});
[0, 1, 2].forEach(function (i) { $('hold-' + i).addEventListener('click', function () { S.hold = i; render(); save(); }); });
$('sw-site').addEventListener('click', function () {
  if (!site) return;
  var at = S.off.indexOf(site);
  S.off = at < 0 ? S.off.concat([site]) : S.off.filter(function (h) { return h !== site; });
  render(); save();
});

/* the open page tells which site it is (no permission to read tab addresses is needed for that) */
api.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
  var tab = tabs && tabs[0];
  if (!tab) return null;
  return api.tabs.sendMessage(tab.id, { type: 'yaoki:site' }, { frameId: 0 });
}).then(function (res) {
  if (res && res.host) { site = res.host; render(); }
}).catch(function () {
  /* a tab opened before Yaoki Reader was installed or updated has none of it until it is reloaded */
  $('site-ds').textContent = 'Not running on this page. Reload it if it was open before Yaoki Reader was installed or updated; browser pages and add-on stores are closed to extensions.';
});

/* changed only when it says something new, so a screen reader announces each change once */
function say(node, text) { if (node.textContent !== text) node.textContent = text; }
function showState(st) {
  var text = $('state-text'), track = $('state-track'), box = $('state');
  box.classList.toggle('problem', st.state === 'failed');
  track.hidden = st.state !== 'loading';
  if (st.state === 'ready') say(text, 'Dictionary: ready.');
  else if (st.state === 'loading') {
    say(text, 'Dictionary: loading…');
    $('state-bar').style.width = Math.round(100 * (st.done || 0) / (st.total || 17)) + '%';
  } else if (st.state === 'failed') say(text, 'Dictionary: could not be loaded (' + (st.error || 'unknown error') + '). It is tried again at the next touch.');
  else say(text, 'Dictionary: not loaded. It loads when a Japanese page opens or a word is touched (a few seconds), and is let go when it has not been used for a while, to save memory.');
}
function poll() {
  api.runtime.sendMessage({ type: 'yaoki:status' }).then(function (st) {
    if (st && st.state) showState(st);
    if (!st || st.state !== 'ready') setTimeout(poll, 500);
  }).catch(function () { setTimeout(poll, 1000); });
}
poll();
})();
