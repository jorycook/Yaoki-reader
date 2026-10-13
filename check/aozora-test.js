// Checks for adding works from Aozora Bunko to the reader (docs/, served under /Yaoki-reader/).
// usage: bash run.sh aozora-test.js
// The copy of Aozora's files the reader fetches from is answered by the test itself, with made-up texts
// in Aozora's own format (Shift_JIS, ruby, notes, headings), so no network is needed and no work's text
// is kept here.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const READER = 'http://127.0.0.1:8766/Yaoki-reader/';
const MIRROR = 'https://raw.githubusercontent.com/aozorahack/aozorabunko_text/master/cards/';
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok: ' : '  FAIL: ') + msg); if (!cond) fails += 1; };
const step = (msg) => console.log('-- ' + msg);

// Made-up texts in Aozora's format, encoded the way Aozora's files are (Shift_JIS, CRLF), by Python.
const LEGEND = ['-------------------------------------------------------', '【テキスト中に現れる記号について】', '', '《》：ルビ', '（例）吾輩《わがはい》', '-------------------------------------------------------'];
const SHORT = ['短い試しの話', '試し作者', '', ...LEGEND, '',
  '　｜昔々《むかしむかし》、山の村に一人の男《おとこ》が住んでいた。',
  '　男の名は親佐《おやさ》と云った。親佐は毎朝、家《うち》を出た。',
  '　男は※［＃「言＋墟のつくり」、第4水準2-88-74］をつかない人で、※［＃「てへん＋劣」、U+6318、111-7］という字も知っていた。',
  '［＃ここから２字下げ］',
  '　毎朝、川へ水をくみに行き、いろいろ［＃「いろいろ」に傍点］な話を聞いた。',
  '［＃ここで字下げ終わり］',
  '', '', '',
  '　ある日、男は一冊の本を見つけた。',
  '', '', '底本：「試しの本」試し出版', '　　1900（明治33）年1月1日発行', '入力：試し', '校正：試し'].join('\r\n') + '\r\n';
const para = (k) => '　' + ('第' + k + 'の話では、男が毎日《まいにち》本を読んで、少しずつ言葉を覚えていった。').repeat(9);
const chapter = (name, n) => ['［＃５字下げ］' + name + '［＃「' + name + '」は中見出し］', '', ...Array.from({ length: n }, (_, i) => para(i + 1))];
const LONG = ['長い試しの話', '試し作者', '', ...LEGEND, '', ...chapter('一', 40), '', ...chapter('二', 40), '', ...chapter('三', 6), '', ...chapter('四', 6), '', '底本：「試しの本」'].join('\r\n') + '\r\n';
const FILE = ['ファイルの話', '別の作者', '', '　ここに書いてあるのは、手元に落とした［＃「落とした」に傍点］ファイルの文です。', '', '底本：「試し」'].join('\r\n') + '\r\n';
function sjis(text) {
  return execFileSync('python3', ['-c', 'import sys; sys.stdout.buffer.write(sys.stdin.read().encode("shift_jis"))'], { input: text });
}
function zipOf(name, bytes) {
  const file = path.join(os.tmpdir(), 'aozora-test-' + Date.now() + '.zip');
  execFileSync('python3', ['-c', 'import sys, zipfile\nwith zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as z:\n z.writestr(sys.argv[2], sys.stdin.buffer.read())', file, name], { input: bytes });
  return file;
}

async function newPage(ctx, logs) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text()) && !/ERR_FAILED|net::|404/.test(m.text())) logs.push('console: ' + m.text().slice(0, 200)); });
  return page;
}
const cards = (page) => page.locator('#texts .tc-title').allInnerTexts();
const toastText = async (page) => { await page.waitForSelector('#toast:not([hidden])', { timeout: 5000 }); return page.locator('#toast').innerText(); };
async function search(page, q) {
  await page.fill('#aoz-q', q);
  await page.waitForTimeout(400);
  return page.locator('#aoz-results .tc-title').allInnerTexts();
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const asked = [];
  const served = {
    '000879/files/92_ruby_164/92_ruby_164.txt': sjis(SHORT),        // 蜘蛛の糸 in the catalog, a made-up text here
    '000148/files/789_ruby_5639/789_ruby_5639.txt': sjis(LONG),     // 吾輩は猫である
  };
  {
    await ctx.route(MIRROR + '**', (r) => {
      const key = r.request().url().slice(MIRROR.length);
      asked.push(key);
      if (served[key]) return r.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', headers: { 'access-control-allow-origin': '*' }, body: served[key] });
      return r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '404: Not Found' });
    });
  }
  const logs = [];
  const page = await newPage(ctx, logs);
  await page.goto(READER);
  await page.waitForSelector('#texts .text-card');

  step('the Aozora Bunko view');
  await page.click('#go-aoz');
  await page.waitForSelector('#aoz-results .text-card', { timeout: 15000 });
  const picks = await page.locator('#aoz-results .tc-title').allInnerTexts();
  ok(picks.length >= 8 && picks[0] === '蜘蛛の糸', 'short works to start with are listed (' + picks.slice(0, 3).join(', ') + '…)');
  ok((await search(page, 'くものいと'))[0] === '蜘蛛の糸', 'a title found by its reading');
  const soseki = await search(page, 'natsume soseki');
  const sosekiBy = await page.locator('#aoz-results .tc-by').first().innerText();
  ok(soseki.length > 10 && sosekiBy === '夏目漱石', 'an author found in roman letters (' + soseki.length + ' shown, by ' + sosekiBy + ')');
  ok(/of [\d,]+ works|[\d,]+ works\./.test(await page.locator('#aoz-state').innerText()), 'the number of works found is shown');
  ok((await search(page, 'https://www.aozora.gr.jp/cards/000148/card789.html'))[0] === '吾輩は猫である', 'a pasted Aozora address finds the work');
  const modern = (await search(page, '羅生門')).length;
  await page.uncheck('#aoz-modern');
  await page.waitForTimeout(300);
  const allKinds = await page.locator('#aoz-results .tc-title').count();
  const oldTag = await page.locator('#aoz-results .tag').count();
  ok(allKinds > modern && oldTag >= 1, 'old-spelling works show when allowed, marked as such (' + modern + ' → ' + allKinds + ')');
  await page.check('#aoz-modern');
  ok((await search(page, '老人と海')).length === 0 && /out of copyright/.test(await page.locator('#aoz-state').innerText()), 'a work still in copyright is not listed, and the note says why');

  step('a short work: fetch, clean up, add and read');
  await search(page, '蜘蛛の糸');
  await page.locator('#aoz-results .text-card').first().click();
  await page.waitForSelector('#aoz-work [data-part]', { timeout: 15000 });
  ok(await page.locator('#aoz-work .work-h').innerText() === '蜘蛛の糸', 'the work page shows its title');
  ok(await page.locator('#aoz-work [data-part]').count() === 1, 'a short work is one part');
  ok(await page.locator('#aoz-work a[href="https://www.aozora.gr.jp/cards/000879/card92.html"]').count() === 1, 'it links to the work\'s Aozora page');
  const t0 = Date.now();
  await page.locator('#aoz-work [data-part]').click();
  await page.waitForSelector('#passage .ph', { timeout: 120000 });
  ok(true, 'the reader opens and the text is analysed (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
  const passage = await page.locator('#passage').evaluate((n) => { const c = n.cloneNode(true); c.querySelectorAll('.rt').forEach((r) => r.remove()); return c.textContent; });
  ok(!/[《》｜［］＃]/.test(passage), 'no Aozora notation is left in the text');
  ok(passage.includes('昔々、山の村') && passage.includes('いろいろな話'), 'ruby and notes are taken out');
  ok(passage.includes('譃') && passage.includes('挘'), 'characters named by JIS place and by U+ code are filled in');
  ok(!passage.includes('底本') && !passage.includes('テキスト中に現れる記号'), 'the notation box and the source notes are left out');
  // the work's own furigana: a name the dictionary does not have is read as the author wrote it, there and later on
  const names = await page.evaluate(() => Array.from(document.querySelectorAll('#passage .ph')).filter((b) => /親佐/.test(b.textContent)).map((b) => b.querySelector('.rt') ? b.querySelector('.rt').textContent : ''));
  ok(names.length === 2 && names.every((r) => r === 'おやさ'), 'a name gets the reading of its furigana, also where it comes again without (' + names.join(', ') + ')');
  const nameCard = await (async () => {
    const ph = page.locator('#passage .ph', { hasText: '親佐' }).first();
    await ph.scrollIntoViewIfNeeded();
    const b = await ph.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.waitForTimeout(250);
    const t = await page.locator('#lens').innerText(); await page.mouse.up(); return t;
  })();
  ok(/Oyasa \(probably a name\)/.test(nameCard), 'its card says it is probably a name: ' + nameCard.replace(/\n/g, ' '));
  const uchi = await page.evaluate(() => Array.from(document.querySelectorAll('#passage .rb')).filter((r) => r.firstChild.textContent === '家').map((r) => r.querySelector('.rt').textContent));
  ok(uchi[0] === 'うち', 'the author\'s furigana decides a reading (家 うち)');
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('yomu.texts'))[0].ruby || '');
  ok(/,おやさ/.test(kept), 'the furigana are saved with the text');
  ok(await page.locator('#read-title').innerText() === '蜘蛛の糸', 'reader title is the work\'s title');
  await page.click('#read-back');
  ok(JSON.stringify(await cards(page)) === JSON.stringify(['蜘蛛の糸', '片目のだるま']), 'the work is in the library');
  ok(await page.locator('#texts .tc-by').first().innerText() === '芥川竜之介', 'the library card names the author');

  step('a long work: parts at the chapters, all added');
  await page.click('#go-aoz');
  await search(page, '吾輩は猫である');
  await page.locator('#aoz-results .text-card', { hasText: '吾輩は猫である' }).first().click();
  await page.waitForSelector('#aoz-work [data-part]', { timeout: 15000 });
  const parts = await page.locator('#aoz-work .ps').allInnerTexts();
  const sizes = await page.locator('#aoz-work .pn').allInnerTexts();
  ok(parts.length === 3 && parts[0].startsWith('一') && parts[1].startsWith('二') && parts[2].startsWith('三'), 'three parts, starting at chapters 一, 二 and 三 (' + parts.map((p) => p.slice(0, 1)).join(' ') + ')');
  ok(sizes.every((s) => +s.replace(/.*· |,| characters/g, '') <= 30000), 'no part is over 30,000 characters (' + sizes.map((s) => s.replace(/.*· /, '')).join(', ') + ')');
  await page.locator('#aoz-work [data-part="1"]').click();
  await page.waitForSelector('#aoz-work [data-part="1"].done');
  ok(await page.locator('#aoz-add-all').innerText() === 'Add the other 2 parts', 'adding one part leaves the others to add');
  await page.click('#aoz-add-all');
  await page.waitForSelector('#v-lib:not([hidden])');
  ok(/Added 2 parts of 吾輩は猫である/.test(await toastText(page)), 'a note says the parts were added');
  const lib = await cards(page);
  ok(JSON.stringify(lib.slice(0, 3)) === JSON.stringify(['吾輩は猫である（1/3）', '吾輩は猫である（2/3）', '吾輩は猫である（3/3）']), 'the parts are listed in reading order (' + lib.slice(0, 3).join(', ') + ')');
  await page.reload();
  await page.waitForSelector('#texts .text-card');
  ok((await cards(page)).length === 5, 'everything is still there after a reload');
  await page.locator('#texts .text-card', { hasText: '（3/3）' }).click();
  await page.waitForSelector('#passage .ph', { timeout: 120000 });
  ok(/^三/.test(await page.locator('#passage').innerText()), 'a part opens at its chapter');
  await page.click('#read-back');

  step('a work missing from the copy: Aozora\'s own zip file instead');
  await page.click('#go-aoz');
  await search(page, '走れメロス');
  await page.locator('#aoz-results .text-card').first().click();
  await page.waitForSelector('#aoz-work .problem', { timeout: 15000 });
  ok(/could not be fetched here/.test(await page.locator('#aoz-work .problem').innerText()), 'it says the work could not be fetched');
  ok(await page.locator('#aoz-work a[href="https://www.aozora.gr.jp/cards/000035/files/1567_ruby_4948.zip"]').count() === 1, 'it links to the zip file on Aozora Bunko');
  const zip = zipOf('hashire.txt', sjis(FILE));
  await page.setInputFiles('#aoz-file', zip);
  await page.waitForSelector('#aoz-work [data-part]', { timeout: 15000 });
  ok(await page.locator('#aoz-work .work-h').innerText() === 'ファイルの話' && await page.locator('#aoz-work .work-by').innerText() === '別の作者', 'the zip is read: title and author from the file');
  await page.locator('#aoz-work [data-part]').click();
  await page.waitForSelector('#passage .ph', { timeout: 120000 });
  ok(/手元に落としたファイルの文です。/.test(await page.locator('#passage').evaluate((n) => { const c = n.cloneNode(true); c.querySelectorAll('.rt').forEach((r) => r.remove()); return c.textContent; })), 'the file\'s text is in the reader');
  await page.click('#read-back');

  step('a plain text file, and the same work twice');
  const txt = path.join(os.tmpdir(), 'aozora-test-' + Date.now() + '.txt');
  fs.writeFileSync(txt, sjis(FILE));
  await page.click('#go-aoz');
  await page.click('#aoz-file-btn').catch(() => {});
  await page.setInputFiles('#aoz-file', txt);
  await page.waitForSelector('#aoz-work [data-part]', { timeout: 15000 });
  ok(await page.locator('#aoz-work [data-part]').innerText() === 'Read', 'a work already in the library is marked, not added twice');
  await page.click('#aoz-back');
  ok(await page.locator('#aoz-find').isVisible(), 'back from a work returns to the search');
  await page.click('#aoz-back');
  ok((await cards(page)).length === 6, 'the library has the six texts');

  step('backups keep the author');
  const by = await page.evaluate(() => JSON.parse(localStorage.getItem('yomu.texts')).map((t) => t.by));
  ok(by.filter((b) => b === '夏目漱石').length === 3 && by.includes('芥川竜之介') && by.includes('別の作者'), 'saved texts keep who wrote them');

  ok(asked.every((k) => /^\d{6}\/files\/\d+_[a-z]+_\d+\/\d+_[a-z]+_\d+\.txt$/.test(k)), 'only text files in the copy were asked for (' + asked.length + ')');
  ok(logs.length === 0, 'no page errors' + (logs.length ? ': ' + logs.join(' | ') : ''));
  await browser.close();
  console.log(fails ? 'FAILED: ' + fails : 'PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
