/* Keeps one copy of the reader's engine running for every tab: a worker (engine/worker.js, the reader's own) that
   loads the tokenizer and the dictionary once and then answers each lookup in a few milliseconds.
   In Chrome and Edge this runs in the offscreen document host.html, which background.js opens; in Firefox and
   Safari it runs in the background page itself, next to background.js. */
(function (root) {
'use strict';
var worker = null, state = 'idle', done = 0, total = 17, error = '', nextId = 1, failedAt = 0;
/* after a failed load, lookups are told so for a while rather than starting it again at once (and again, in a loop) */
var RETRY = 10000;
var waiting = new Map();
/* the engine holds about 200 MB: after half an hour without a lookup it is let go, and loaded again when needed */
var IDLE = 30 * 60 * 1000, idleTimer = 0;
function used() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(function () {
    if (!worker || waiting.size) return;
    worker.terminate(); worker = null; state = 'idle'; done = 0;
  }, IDLE);
}

function start() {
  if (worker) return;
  state = 'loading'; done = 0; error = '';
  try {
    worker = new Worker('engine/worker.js');
  } catch (err) {
    state = 'failed'; error = String((err && err.message) || err);
    return;
  }
  worker.onmessage = function (ev) {
    var m = ev.data || {};
    if (m.type === 'progress') { done = m.done; total = m.total; }
    else if (m.type === 'ready') { state = 'ready'; done = total; }
    else if (m.type === 'error') fail(m.message);
    else if (m.type === 'result' || m.type === 'fail') {
      var cb = waiting.get(m.id);
      if (cb) { waiting.delete(m.id); cb(m); }
    }
  };
  worker.onerror = function (ev) { fail((ev && ev.message) || 'the engine stopped'); };
  /* the extension's build has the dictionary packed for it (tools/extension.py) */
  worker.postMessage({ type: 'init', packed: true });
}
/* a failed load is tried again at the next lookup */
function fail(message) {
  state = 'failed'; error = String(message || 'unknown error'); failedAt = Date.now();
  if (worker) worker.terminate();
  worker = null;
  waiting.forEach(function (cb) { cb({ type: 'fail', message: error }); });
  waiting.clear();
}
function status() { return { state: state, done: done, total: total, error: error }; }

function analyze(text, ruby) {
  return new Promise(function (resolve) {
    var id = nextId++;
    waiting.set(id, function (m) { resolve(m.type === 'result' ? { analysis: m.analysis } : { error: m.message }); });
    worker.postMessage({ type: 'analyze', id: id, text: text, ruby: ruby });
  });
}

/* the lookups the content scripts send (through background.js) */
function handle(msg) {
  var type = msg && msg.type;
  if (type === 'yaoki:status') return Promise.resolve(status());
  if (type === 'yaoki:warm') {
    if (state === 'idle' || (state === 'failed' && Date.now() - failedAt >= RETRY)) start();
    used();
    return Promise.resolve(status());
  }
  if (type === 'yaoki:analyze') {
    used();
    if (typeof msg.text !== 'string' || msg.text.length > 4000) return Promise.resolve({ error: 'nothing to look up' });
    if (state !== 'ready') {
      if (state === 'failed' && Date.now() - failedAt < RETRY) return Promise.resolve({ error: 'the dictionary could not be loaded (' + error + ')' });
      start();
      if (state === 'failed') return Promise.resolve({ error: 'the dictionary could not be loaded (' + error + ')' });
      return Promise.resolve({ wait: status() });
    }
    return analyze(msg.text, Array.isArray(msg.ruby) ? msg.ruby : []);
  }
  return Promise.resolve({ error: 'unknown request' });
}
root.YaokiHost = { handle: handle };
})(typeof self !== 'undefined' ? self : this);
