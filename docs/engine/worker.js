/* Runs the reader engine off the main thread. */
importScripts('kuromoji.js', 'analyzer.js', 'boot.js');
var engine = null, starting = null;
function start() {
  if (!starting) {
    starting = self.YomuBoot('', function (done, total) { self.postMessage({ type: 'progress', done: done, total: total }); })
      .then(function (e) { engine = e; self.postMessage({ type: 'ready', version: self.YomuEngine.VERSION }); })
      .catch(function (err) { starting = null; self.postMessage({ type: 'error', message: String((err && err.message) || err) }); });
  }
}
self.onmessage = function (ev) {
  var m = ev.data || {};
  if (m.type === 'init') start();
  else if (m.type === 'analyze') {
    try {
      if (!engine) throw new Error('engine not ready');
      self.postMessage({ type: 'result', id: m.id, analysis: engine.analyze(m.text, m.ruby) });
    } catch (err) {
      self.postMessage({ type: 'fail', id: m.id, message: String((err && err.message) || err) });
    }
  }
};
