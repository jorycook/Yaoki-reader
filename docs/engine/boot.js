/* Loads the tokenizer and the dictionary, then hands back a ready engine.
   base is '' inside the worker and 'engine/' on the page. */
(function (root) {
'use strict';
root.YomuBoot = function (base, onProgress) {
  var done = 0, total = 15;
  function step() { done++; if (onProgress) onProgress(done, total); }
  root.__yomuFile = step;
  var tokenizer = new Promise(function (resolve, reject) {
    root.kuromoji.builder({ dicPath: base + 'dict/' }).build(function (err, tk) {
      if (err) reject(new Error('tokenizer: ' + (err.message || err))); else resolve(tk);
    });
  });
  function lines(name) {
    return fetch(base + name).then(function (r) {
      if (!r.ok) throw new Error('dictionary: HTTP ' + r.status);
      return r.text();
    }).then(function (t) { step(); return t.split('\n'); });
  }
  return Promise.all([tokenizer, lines('jm-1.txt'), lines('jm-2.txt')]).then(function (v) {
    var engine = root.YomuEngine.create(v[0], v[1].concat(v[2]));
    step();
    return engine;
  });
};
})(typeof self !== 'undefined' ? self : this);
