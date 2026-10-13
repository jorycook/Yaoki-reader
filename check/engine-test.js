// Checks the reader's engine (docs/engine/) directly in Node: readings and meanings for cases that went wrong.
// usage: node engine-test.js   (no browser or server needed; loads the full dictionary, a few seconds)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ENG = path.join(__dirname, '..', 'docs', 'engine');
const g = globalThis;
g.self = g;
// the engine fetches its files; here they are read from the folder
g.XMLHttpRequest = function () {
  this.open = (m, u) => { this.u = u; };
  this.send = () => setTimeout(() => { this.status = 200; this.response = this.responseText = fs.readFileSync(path.join(ENG, this.u), 'utf8'); if (this.onload) this.onload(); }, 0);
};
g.fetch = (u) => Promise.resolve({ ok: true, text: () => Promise.resolve(fs.readFileSync(path.join(ENG, u), 'utf8')) });
for (const f of ['kuromoji.js', 'analyzer.js', 'boot.js']) vm.runInThisContext(fs.readFileSync(path.join(ENG, f), 'utf8'), { filename: f });

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok: ' : '  FAIL: ') + msg); if (!cond) fails += 1; };
// every content word of a text as "surface(reading) = meaning"
function words(engine, text) {
  const out = [];
  engine.analyze(text).paras.forEach((p) => p.forEach((c) => (c.w || []).forEach((w) => {
    if (w.f) return;
    out.push({ s: w.s.map((x) => x[0]).join(''), r: w.s.map((x) => x[1]).join(''), e: w.e || '' });
  })));
  return out;
}
const find = (ws, s) => ws.find((w) => w.s === s) || { s, r: '', e: '' };

g.YomuBoot('', null).then((engine) => {
  console.log('-- spellings without their kana (絶間 for 絶え間)');
  let ws = words(engine, '絶間がない。受付で申込の取扱を聞いた。');
  ok(/interval|pause/.test(find(ws, '絶間').e) && find(ws, '絶間').r === 'たえま', '絶間 is たえま, ' + find(ws, '絶間').e);
  ok(/reception/.test(find(ws, '受付').e), '受付: ' + find(ws, '受付').e);
  ok(/application/.test(find(ws, '申込').e), '申込: ' + find(ws, '申込').e);
  ok(/treatment|handling/.test(find(ws, '取扱').e), '取扱: ' + find(ws, '取扱').e);
  ws = words(engine, '好い匂が、絶間なくあたりへ溢れて居ります。');
  ok(/incessantly/.test(find(ws, '絶間なく').e), '絶間なく is one word: ' + find(ws, '絶間なく').e);

  console.log('-- ない');
  ws = words(engine, '何とも云えない好い匂。お金がない。気がなくございますから。読めない本は行かない。');
  ok(find(ws, '云えない').e === 'cannot say, utter', '云えない: ' + find(ws, '云えない').e);
  ok(/^not/.test(find(ws, 'ない').e), 'ない after a noun: ' + find(ws, 'ない').e);
  ok(!ws.some((w) => /emphatic suffix/.test(w.e)), 'nothing is glossed "emphatic suffix"');
  ok(/read/.test(find(ws, '読めない').e) && /go/.test(find(ws, '行かない').e), '読めない and 行かない keep their verbs');

  console.log('-- readings fixed before');
  ws = words(engine, '令和元年の八日に、一本の傘を電車に忘れた。');
  ok(['令和', '八日', '一本'].every((k) => find(ws, k).e), 'the earlier fixes still hold (令和, 八日, 一本)');

  console.log(fails ? 'FAILED: ' + fails : 'PASS');
  process.exit(fails ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
