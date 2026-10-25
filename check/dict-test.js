// Checks the extension's own copies of the engine's data (made by tools/extension.py) against the reader's:
// 1. its tokenizer dictionary (dist/chrome/engine/dict: gzip binary without its padding) tokenizes exactly as the
//    reader's (docs/engine/dict: base64 text): every field of every token, over every headword and reading of the
//    word list and the Japanese in the tests;
// 2. its word index made ahead of time (dist/chrome/engine/jm-index.bin.gz) answers every key as the index the
//    engine makes at start, and the engine analyses the same texts the same way with either; an index made from
//    other lines is not used.
// usage: node dict-test.js [kuromoji.js to load the reader's files with]   (builds the extension first; two minutes)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const TOP = path.join(__dirname, '..');
const ENG = path.join(TOP, 'docs', 'engine');
const PACKED = path.join(TOP, 'dist', 'chrome', 'engine');

/* a tokenizer from one copy of kuromoji.js and one folder of dictionary files, each in a context of its own */
function tokenizer(js, dir, binary) {
  const ctx = { console, setTimeout, atob, Blob, Response, DecompressionStream, Uint8Array, Int32Array, ArrayBuffer };
  ctx.self = ctx;
  ctx.__yomuDictBinary = binary;
  ctx.XMLHttpRequest = function () {
    this.open = (m, u) => { this.u = u; };
    this.send = () => setTimeout(() => {
      const file = fs.readFileSync(path.join(dir, this.u));
      this.status = 200;
      this.response = this.responseType === 'arraybuffer' ? file.buffer.slice(file.byteOffset, file.byteOffset + file.length) : file.toString('utf8');
      this.onload();
    }, 0);
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(js, 'utf8'), ctx, { filename: path.basename(js) });
  const t0 = performance.now();
  return new Promise((resolve, reject) => ctx.kuromoji.builder({ dicPath: 'dict/' }).build((err, tk) => (err ? reject(new Error(String(err))) : resolve({ tk, ms: performance.now() - t0 }))));
}

(async () => {
  execFileSync('python3', [path.join(TOP, 'tools', 'extension.py')], { stdio: 'inherit' });
  const words = [];
  ['jm-1.txt', 'jm-2.txt', 'jm-3.txt'].forEach((name) => fs.readFileSync(path.join(ENG, name), 'utf8').split('\n').forEach((line) => {
    const p = line.split('\t');
    if (p[0] && !/^[=?]/.test(p[0])) words.push(p[0].replace(/;/g, 'と'));
    if (p[1]) words.push(p[1].replace(/;/g, '、'));
  }));
  fs.readdirSync(__dirname).filter((f) => f.endsWith('.js')).forEach((f) => {
    (fs.readFileSync(path.join(__dirname, f), 'utf8').match(/[぀-ヿ㐀-鿿！-｠、。「」『』（）・ー　]{4,}/g) || []).forEach((s) => words.push(s));
  });
  /* sentence-sized pieces, so that tokens also meet across words */
  const texts = [];
  for (let i = 0; i < words.length; i += 8) texts.push(words.slice(i, i + 8).join('が'));

  const reader = await tokenizer(process.argv[2] || path.join(ENG, 'kuromoji.js'), ENG, false);
  const packed = await tokenizer(path.join(ENG, 'kuromoji.js'), PACKED, true);
  console.log(`tokenizer built in ${Math.round(reader.ms)} ms from the reader's files, ${Math.round(packed.ms)} ms from the extension's`);
  let tokens = 0, differ = 0;
  for (const t of texts) {
    const a = reader.tk.tokenize(t), b = packed.tk.tokenize(t);
    tokens += a.length;
    if (JSON.stringify(a) !== JSON.stringify(b) && differ++ < 5) console.log('  differs: ' + t.slice(0, 40));
  }
  console.log(`${texts.length} texts, ${tokens} tokens`);
  let fails = differ ? 1 : 0;
  console.log(differ ? `  FAIL: ${differ} texts tokenized differently` : '  ok: every token the same');

  /* the word index: made at start (a Map per table) and made ahead of time (sorted arrays) */
  const ctx = { console, Map, Set, Int32Array, Uint16Array, ArrayBuffer };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ENG, 'analyzer.js'), 'utf8'), ctx, { filename: 'analyzer.js' });
  const lines = [].concat(...['jm-1.txt', 'jm-2.txt', 'jm-3.txt'].map((n) => fs.readFileSync(path.join(ENG, n), 'utf8').split('\n')));
  const kanji = fs.readFileSync(path.join(ENG, 'kanji.txt'), 'utf8').split('\n');
  const gz = fs.readFileSync(path.join(PACKED, 'jm-index.bin.gz'));
  const raw = require('zlib').gunzipSync(gz);
  const index = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length);
  let t0 = performance.now();
  const made = ctx.YomuEngine.create(packed.tk, lines, kanji);
  const madeMs = performance.now() - t0;
  t0 = performance.now();
  const kept = ctx.YomuEngine.create(packed.tk, lines, kanji, index);
  const keptMs = performance.now() - t0;
  console.log(`engine made in ${Math.round(madeMs)} ms with its own index, ${Math.round(keptMs)} ms with the one made ahead of time`);
  const a = made.dict, b = kept.dict;
  const same = (x, y) => JSON.stringify(x instanceof Map ? Array.from(x) : x) === JSON.stringify(y instanceof Map ? Array.from(y) : y);
  let keys = 0, wrong = 0;
  for (const [name, m, s] of [['words', a.idx, b.idx], ['looser spellings', a.alts(), b.alt], ['kana scores', a.kscore, b.kscore]]) {
    let bad = 0;
    m.forEach((v, k) => { keys++; if (!same(s.get(k), v)) bad++; });
    if (s.n !== m.size) bad++;
    ['', 'ありえない語', 'zz', '食べ', '\ud842'].forEach((k) => { if (s.has(k) !== m.has(k)) bad++; });
    if (bad) console.log(`  ${name}: ${bad} keys answered differently`);
    wrong += bad;
  }
  if (b.idx instanceof Map) { console.log('  the index made ahead of time was not used'); wrong++; }
  console.log(wrong ? `  FAIL: the index made ahead of time differs (${wrong})` : `  ok: the index made ahead of time answers all ${keys} keys the same`);
  fails += wrong ? 1 : 0;
  let analyses = 0, unlike = 0;
  t0 = performance.now();
  for (let i = 0; i < texts.length; i += 15) {
    analyses++;
    if (JSON.stringify(made.analyze(texts[i])) !== JSON.stringify(kept.analyze(texts[i])) && unlike++ < 3) console.log('  analysed differently: ' + texts[i].slice(0, 40));
  }
  console.log(unlike ? `  FAIL: ${unlike} of ${analyses} texts analysed differently` : `  ok: ${analyses} texts analysed the same with either index (${Math.round(performance.now() - t0)} ms)`);
  fails += unlike ? 1 : 0;
  const other = ctx.YomuEngine.create(packed.tk, lines.slice(0, -1).concat(['x']), kanji, index);
  const used = !(other.dict.idx instanceof Map);
  console.log(used ? '  FAIL: an index made from other lines was used' : '  ok: an index made from other lines is not used (the engine makes its own)');
  fails += used ? 1 : 0;
  console.log(fails ? 'FAIL' : 'PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
