// Checks that the extension's copy of the tokenizer dictionary (dist/chrome/engine/dict: gzip binary without its
// padding, made by tools/extension.py) tokenizes exactly as the reader's (docs/engine/dict: base64 text): every
// field of every token, over every headword and reading of the word list and the Japanese in the tests.
// usage: node dict-test.js [kuromoji.js to load the reader's files with]   (builds the extension first; about a minute)
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
  console.log(differ ? `FAIL: ${differ} texts tokenized differently` : 'PASS: every token the same');
  process.exit(differ ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
