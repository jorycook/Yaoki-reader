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
const AZ = require(path.join(__dirname, '..', 'docs', 'aozora', 'aozora.js'));

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok: ' : '  FAIL: ') + msg); if (!cond) fails += 1; };
// every content word of a text as "surface(reading) = meaning"
// text may be in Aozora Bunko's notation (漢字《かんじ》): its furigana go to the engine as the reader sends them
function words(engine, text) {
  const out = [];
  const conv = AZ.convertText(text);
  engine.analyze(conv.text, conv.ruby).paras.forEach((p) => p.forEach((c) => (c.w || []).forEach((w) => {
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

  console.log('-- names and the furigana of Aozora Bunko');
  ws = words(engine, '犍陀多《かんだた》と云う男は。その犍陀多が蜘蛛を助けた。家《うち》へ帰った。');
  ok(find(ws, '犍陀多').r === 'かんだた' && /Kandata \(probably a name\)/.test(find(ws, '犍陀多').e), 'a name with furigana is one word: ' + find(ws, '犍陀多').r + ', ' + find(ws, '犍陀多').e);
  ok(ws.filter((w) => w.s === '犍陀多').length === 2 && ws.filter((w) => w.s === '犍陀多').every((w) => w.r === 'かんだた'), 'it keeps that reading where it comes again without furigana');
  ok(find(ws, '家').r === 'うち', 'the author\'s furigana decides the reading (家 うち)');
  ws = words(engine, '犍陀多が来た。ゴーシュ君とアンドレア・デル・サルトが話す。');
  ok(/probably a name/.test(find(ws, '犍陀多').e), 'kanji the tokenizer does not know make one name even without furigana');
  ok(/Gōshu \(foreign name or word\)/.test(find(ws, 'ゴーシュ君').e), 'a katakana name is read out: ' + find(ws, 'ゴーシュ君').e);
  ok(/Andorea Deru Saruto/.test(find(ws, 'アンドレア・デル・サルト').e), 'a name in parts: ' + find(ws, 'アンドレア・デル・サルト').e);

  console.log('-- rare kanji, old spelling and loanwords');
  ws = words(engine, '声が顫えて、哂った。恋人と逢つて、柱に倚って、喰べたい。');
  ok(/shiver|shake|tremble/.test(find(ws, '顫えて').e) && find(ws, '顫えて').r.startsWith('ふる'), '顫えて is 震える: ' + find(ws, '顫えて').e);
  ok(/laugh/.test(find(ws, '哂った').e), '哂った is 笑う');
  ok(/meet/.test(find(ws, '逢つて').e), '逢つて (old つ) is 逢う');
  ok(/lean/.test(find(ws, '倚って').e), '倚って is 寄る');
  ok(/eat/.test(find(ws, '喰べたい').e), '喰べたい is 食べる');
  ws = words(engine, '思ひ出して考へて、ゐる。やつぱり帰つていつた。');
  ok(/recall|remember/.test(find(ws, '思ひ出して').e), '思ひ出して is 思い出す: ' + find(ws, '思ひ出して').e);
  ok(/think/.test(find(ws, '考へて').e) && /be/.test(find(ws, 'ゐる').e), '考へて and ゐる');
  ok(/expected/.test(find(ws, 'やつぱり').e), 'やつぱり is やっぱり');
  ok(/return/.test(find(ws, '帰つて').e) && /go/.test(find(ws, 'いつた').e), '帰つていつた is 帰っていった: ' + find(ws, 'いつた').e);
  ws = words(engine, 'ストオヴとシャッタア。気もちが黄いろな口びる。');
  ok(/stove/.test(find(ws, 'ストオヴ').e) && /shutter/.test(find(ws, 'シャッタア').e), 'old loanword spellings');
  ok(/feeling/.test(find(ws, '気もち').e) && /yellow/.test(find(ws, '黄いろな').e) && /lip/.test(find(ws, '口びる').e), 'words written half in kana (気もち, 黄いろ, 口びる)');

  console.log('-- sounds, kana runs and the last resorts');
  ws = words(engine, 'ドッと笑った。ハハハハと笑い、ニャーと鳴く。モグモグ。してわざとじぶんの譜を。');
  ok(/(laugh|burst|rush)/.test(find(ws, 'ドッと').e), 'ドッと is どっと: ' + find(ws, 'ドッと').e);
  ok(find(ws, 'ハハハハ').e === '(laughter)' && /meow/.test(find(ws, 'ニャー').e) && find(ws, 'モグモグ').e, 'laughter, meow, mumbling');
  ok(/purpose|deliberately/.test(find(ws, 'わざと').e) && /myself|oneself/.test(find(ws, 'じぶん').e), 'a run of kana the tokenizer could not place is split again (わざと じぶん)');
  ws = words(engine, '屹と立つ。単細胞動物。');
  ok(/towering/.test(find(ws, '屹').e), 'a kanji no word explains gets its own meaning: ' + find(ws, '屹').e);
  ok(/ \+ /.test(find(ws, '単細胞動物').e), 'a compound only known in pieces: ' + find(ws, '単細胞動物').e);
  ws = words(engine, 'あたりへ溢れて。だんだん大きくなる。');
  ok(/neighbourhood|vicinity/.test(find(ws, 'あたり').e), 'あたり in kana is 辺り: ' + find(ws, 'あたり').e);

  console.log('-- readings fixed before');
  ws = words(engine, '令和元年の八日に、一本の傘を電車に忘れた。');
  ok(['令和', '八日', '一本'].every((k) => find(ws, k).e), 'the earlier fixes still hold (令和, 八日, 一本)');

  console.log(fails ? 'FAILED: ' + fails : 'PASS');
  process.exit(fails ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
