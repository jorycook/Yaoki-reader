/* Loads the tokenizer and the dictionary, then hands back a ready engine.
   base is '' inside the worker and 'engine/' on the page. opts.index: load the word index made ahead of time
   (jm-index.bin.gz, which the browser extension's build has) instead of making it at start. */
(function (root) {
'use strict';
root.YomuBoot = function (base, onProgress, opts) {
  var withIndex = !!(opts && opts.index) && typeof DecompressionStream !== 'undefined';
  var done = 0, total = withIndex ? 18 : 17;
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
  /* the index unpacked by the browser (unless it has done so already); on any trouble the engine makes its own */
  function index() {
    if (!withIndex) return Promise.resolve(null);
    return fetch(base + 'jm-index.bin.gz').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    }).then(function (buf) {
      var b = new Uint8Array(buf, 0, 2);
      if (b[0] !== 0x1f || b[1] !== 0x8b) return buf;
      return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    }).then(function (buf) { step(); return buf; }, function () { step(); return null; });
  }
  /* jm-1 and jm-2: the word list; jm-3: the supplement (newer words, more spellings, kana preferences) */
  /* kanji.txt: what each kanji means (KANJIDIC), for kanji no word explains */
  return Promise.all([tokenizer, lines('jm-1.txt'), lines('jm-2.txt'), lines('jm-3.txt'), lines('kanji.txt'), index()]).then(function (v) {
    var engine = root.YomuEngine.create(v[0], v[1].concat(v[2], v[3]), v[4], v[5]);
    step();
    return engine;
  });
};
})(typeof self !== 'undefined' ? self : this);
