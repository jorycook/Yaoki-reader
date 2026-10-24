// Checks the browser extension (extension/, built into dist/chrome by tools/extension.py) in Chromium: a finger held on
// a word shows its reading and meaning, sliding moves to the next word, lifting hides it; a swipe still scrolls and a
// tap still follows a link; the mouse and Shift; the page's own furigana; switches in the toolbar panel.
// usage: node extension-test.js   (builds the extension first; the test pages are played by the test, no server)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const TOP = path.join(__dirname, '..');
const EXT = path.join(TOP, 'dist', 'chrome');
const SITE = 'http://yaoki.test/';
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok: ' : '  FAIL: ') + msg); if (!cond) fails += 1; };
const step = (msg) => console.log('-- ' + msg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGES = {
  'plain.html': `<!doctype html><html lang="ja"><meta charset="utf-8"><title>plain</title>
<body style="margin:0;padding:300px 30px 30px;font:20px/1.8 serif;width:600px">
<p id="weather">今日はいい天気ですね！明日、一緒に行きませんか？</p>
<p id="link"><a href="${SITE}next.html">新しい記事を読む</a></p>
<p id="english">This line is English and nothing happens when it is held.</p>
<div id="editor" contenteditable="true">ここに感想を書いてください。</div>
<p id="ruby">その<ruby><rb>犍陀多</rb><rp>（</rp><rt>かんだた</rt><rp>）</rp></ruby>と云う男は、<ruby>蜘蛛<rt>くも</rt></ruby>を助けた。</p>
<div id="split">東京都は<b>２４日</b>、<span>新型ウイルス</span>の感染者が<br>新たに確認されたと発表した。</div>
${'<p>駅の前に小さな本屋があって、私は毎朝そこで新聞を買う。店の主人はいつも静かに本を読んでいる。</p>'.repeat(30)}
</body></html>`,
  'next.html': '<!doctype html><meta charset="utf-8"><title>next</title><p>次のページ</p>',
  'strict.html': `<!doctype html><html lang="ja"><meta charset="utf-8"><title>strict</title><link rel="stylesheet" href="page.css">
<body><p id="w">彼は静かに本を読んでいた。</p></body></html>`,
  'page.css': 'body { margin: 0; padding: 220px 30px; font: 20px/1.8 serif; }',
  'vertical.html': `<!doctype html><html lang="ja"><meta charset="utf-8"><title>vertical</title>
<body style="margin:0;padding:40px"><p id="v" style="writing-mode:vertical-rl;font:24px/2 serif;height:400px">雨が降っている。</p></body></html>`,
  'chinese.html': `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>zh</title>
<body style="margin:0;padding:120px 30px;font:20px/1.8 serif"><p id="zh">我们今天去图书馆学习中文。</p></body></html>`,
  'shadow.html': `<!doctype html><html lang="ja"><meta charset="utf-8"><title>shadow</title>
<body style="margin:0;padding:120px 30px;font:20px/1.8 serif"><div id="h"></div>
<script>document.getElementById('h').attachShadow({mode:'open'}).innerHTML = '<p id="s">猫が窓の外を見ている。</p>';</script></body></html>`,
  'cover.html': `<!doctype html><html lang="ja"><meta charset="utf-8"><title>cover</title>
<body style="margin:0;padding:300px 30px;font:20px/1.8 sans-serif">
<div id="card" style="position:relative;padding:10px;border:1px solid #ccc"><h2 id="story" style="font-size:20px;margin:0">駅前の本屋が来月で閉店する</h2>
<a href="${SITE}next.html" style="position:absolute;inset:0" aria-label="story"></a></div></body></html>`,
  'desktop.html': `<!doctype html><html lang="ja"><meta charset="utf-8"><title>desktop</title>
<body style="margin:0;padding:200px 30px;width:960px;font:16px/1.7 sans-serif"><p id="d">駅前の喫茶店で友達と待ち合わせをした。</p></body></html>`,
};

async function main() {
  execFileSync('python3', [path.join(TOP, 'tools', 'extension.py')], { stdio: 'inherit' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaoki-ext-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: 'chromium', headless: true, hasTouch: true, isMobile: true, viewport: { width: 390, height: 700 }, deviceScaleFactor: 2,
    args: ['--disable-extensions-except=' + EXT, '--load-extension=' + EXT],
  });
  await ctx.route(/^http:\/\/yaoki\.test\//, (route) => {
    const name = new URL(route.request().url()).pathname.slice(1) || 'plain.html';
    if (!PAGES[name]) return route.fulfill({ status: 404, body: 'none' });
    const headers = { 'content-type': name.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8' };
    /* a page that allows no inline styles or scripts of its own, as many sites do */
    if (name === 'strict.html') headers['content-security-policy'] = "default-src 'none'; style-src 'self'; script-src 'self'";
    return route.fulfill({ status: 200, headers, body: PAGES[name] });
  });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  const logs = [];
  const page = await ctx.newPage();
  page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 200)));
  const cdp = await ctx.newCDPSession(page);

  /* the extension's layer is a closed shadow root: read it through the browser's own view of the page */
  async function layer() {
    const doc = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    let host = null;
    (function find(n) { if (host || !n) return; if (n.nodeName === 'YAOKI-READER-LAYER') host = n; (n.children || []).forEach(find); })(doc.root);
    if (!host || !host.shadowRoots || !host.shadowRoots.length) return { card: '', shown: false, readings: [], marks: 0 };
    const { object } = await cdp.send('DOM.resolveNode', { nodeId: host.shadowRoots[0].nodeId });
    const { result } = await cdp.send('Runtime.callFunctionOn', {
      objectId: object.objectId, returnByValue: true,
      functionDeclaration: `function () {
        const card = this.querySelector('.card');
        const r = card.getBoundingClientRect(), cs = getComputedStyle(card);
        return {
          shown: !card.hidden,
          card: card.hidden ? '' : Array.from(card.childNodes).map((n) => { const c = n.cloneNode(true); c.querySelectorAll('.rt').forEach((r) => r.remove()); return c.textContent; }).join(' '),
          cardReadings: Array.from(card.querySelectorAll('.rt')).map((r) => r.textContent),
          rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
          radius: cs.borderTopLeftRadius, transform: card.style.transform,
          readings: Array.from(this.querySelectorAll('.rd')).map((e) => { const b = e.getBoundingClientRect(); return { text: e.textContent, left: b.left, top: b.top, right: b.right, bottom: b.bottom, vertical: e.classList.contains('v') }; }),
          marks: this.querySelectorAll('.mark').length,
          fills: this.querySelectorAll('.mark.fill').length,
        };
      }`,
    });
    return result.value;
  }
  /* where a character of an element's text is on screen */
  async function at(sel, text, nth) {
    return page.evaluate(([sel, text, nth]) => {
      const root = document.querySelector(sel) || document.querySelector('#h').shadowRoot.querySelector(sel);
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n, seen = 0;
      while ((n = w.nextNode())) {
        let i = n.data.indexOf(text);
        while (i >= 0) {
          if (seen++ === (nth || 0)) {
            const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1);
            const b = r.getBoundingClientRect();
            return { x: b.left + b.width / 2, y: b.top + b.height / 2, top: b.top, bottom: b.bottom, left: b.left, right: b.right };
          }
          i = n.data.indexOf(text, i + 1);
        }
      }
      return null;
    }, [sel, text, nth]);
  }
  const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
  async function hold(p, ms) { await touch('touchStart', p); await wait(ms || 600); }
  async function lift() { await touch('touchEnd'); await wait(150); }
  async function until(fn, ms) {
    const end = Date.now() + (ms || 30000);
    let v;
    while (Date.now() < end) { v = await fn(); if (v) return v; await wait(150); }
    return v;
  }

  step('a Japanese page wakes the engine before the first touch');
  await page.goto(SITE + 'plain.html');
  const ready = await until(async () => (await sw.evaluate(() => toHost({ type: 'yaoki:status' }))).state === 'ready', 40000);
  ok(ready, 'the dictionary is loaded in the background after the page opens');

  step('a finger held on a word');
  let p = await at('#weather', '天');
  await hold(p);
  let L = await until(async () => { const l = await layer(); return l.shown && /天気/.test(l.card) && l; }, 5000);
  ok(L && /fine weather/.test(L.card), 'the card shows 天気 and "fine weather": ' + (L && L.card));
  ok(L && L.readings.some((r) => r.text === 'てんき'), 'the reading てんき is put over the kanji in the page');
  const rd = L && L.readings.find((r) => r.text === 'てんき');
  ok(rd && rd.bottom <= p.top + 2 && rd.left < p.right + 30 && rd.right > p.left - 30, 'the reading sits just above 天気');
  ok(L && L.marks > 0, 'the phrase is marked in the page');
  ok(L && L.rect.bottom <= p.top, 'the card is above the finger');
  ok(L && L.cardReadings.indexOf('てんき') >= 0, 'the card has the reading too');
  ok(L && L.radius === '18px', 'the card has the reader\'s look (styles applied)');

  step('sliding the finger to the next phrase');
  const scrollBefore = await page.evaluate(() => scrollY);
  const q = await at('#weather', '明');
  for (let k = 1; k <= 6; k++) await touch('touchMove', { x: p.x + (q.x - p.x) * k / 6, y: p.y + (q.y - p.y) * k / 6 });
  L = await until(async () => { const l = await layer(); return l.shown && /明日/.test(l.card) && l; }, 5000);
  ok(L && /tomorrow/.test(L.card), 'the card follows to 明日 "tomorrow": ' + (L && L.card));
  ok(L && L.readings.some((r) => r.text === 'あした'), 'and its reading あした');
  ok(await page.evaluate(() => scrollY) === scrollBefore, 'the page does not scroll while a word is held');
  await lift();
  L = await layer();
  ok(!L.shown && L.readings.length === 0 && L.marks === 0, 'lifting the finger hides the card, the reading and the mark');

  step('a grammar pattern');
  p = await at('#weather', '行');
  await hold(p);
  L = await until(async () => { const l = await layer(); return l.shown && /行/.test(l.card) && l; }, 5000);
  ok(L && /文法/.test(L.card) && /ません/.test(L.card), 'holding 行きません shows the 〜ません note: ' + (L && L.card));
  await lift();

  step('near the top of the screen the card goes below the word, clear of it');
  await page.evaluate(() => scrollTo(0, document.getElementById('weather').offsetTop - 20));
  await wait(200);
  p = await at('#weather', '天');
  await hold(p);
  L = await until(async () => { const l = await layer(); return l.shown && /天気/.test(l.card) && l; }, 5000);
  ok(L && L.rect.top >= p.bottom + 10, 'the card is below the word (' + Math.round(p.bottom) + ' → ' + Math.round(L && L.rect.top) + ')');
  await lift();
  await page.evaluate(() => scrollTo(0, 0));
  await wait(200);

  step('a swipe still scrolls, a quick tap shows nothing');
  p = await at('#weather', '今');
  await touch('touchStart', p);
  for (let k = 1; k <= 8; k++) { await touch('touchMove', { x: p.x, y: p.y - 30 * k }); await wait(16); }
  await touch('touchEnd');
  await wait(400);
  const scrolled = await page.evaluate(() => scrollY);
  ok(scrolled > 50, 'swiping up from Japanese text scrolls the page (' + scrolled + 'px)');
  ok(!(await layer()).shown, 'no card after a swipe');
  await page.evaluate(() => scrollTo(0, 0));
  await wait(200);
  p = await at('#weather', '一');
  await touch('touchStart', p); await wait(40); await touch('touchEnd'); await wait(500);
  ok(!(await layer()).shown, 'no card after a quick tap');

  step('holding a link does not follow it; tapping it does');
  p = await at('#link', '記');
  await hold(p);
  L = await until(async () => { const l = await layer(); return l.shown && /記事/.test(l.card) && l; }, 5000);
  ok(L && /article/.test(L.card), 'a word in a link can be held: ' + (L && L.card));
  await lift();
  await wait(500);
  ok(page.url() === SITE + 'plain.html', 'letting go of a held link stays on the page');
  await page.touchscreen.tap(p.x, p.y);
  await page.waitForURL(SITE + 'next.html', { timeout: 5000 }).catch(() => {});
  ok(page.url() === SITE + 'next.html', 'a tap on the link still follows it');
  await page.goto(SITE + 'plain.html');
  await wait(300);

  step('English text and the gaps between lines are left alone');
  p = await at('#english', 'E');
  await hold(p);
  ok(!(await layer()).shown, 'holding English shows nothing');
  await lift();

  p = await at('#editor', '感');
  await hold(p);
  ok(!(await layer()).shown, 'holding text in an editable box shows nothing (its own long-press stays)');
  await lift();
  /* lifting there was a tap, which put the cursor in the box: Shift is for typing while it is there */
  await page.evaluate(() => document.activeElement.blur());

  step('the page\'s own furigana decide readings');
  p = await at('#ruby', '陀');
  await hold(p);
  L = await until(async () => { const l = await layer(); return l.shown && /犍陀多/.test(l.card) && l; }, 5000);
  ok(L && L.readings.some((r) => r.text === 'かんだた'), 'the name 犍陀多 gets the page\'s reading かんだた: ' + JSON.stringify(L && L.readings.map((r) => r.text)));
  ok(L && !/かんだた.*かんだた/.test(L.card.replace(/\s/g, '')) && !/（/.test(L.card), 'the ruby\'s own text (rt, rp) is not read as part of the sentence');
  await lift();

  step('a sentence across inline tags, cut at a line break');
  p = await at('#split', '新', 0);
  await hold(p);
  L = await until(async () => { const l = await layer(); return l.shown && /新型/.test(l.card) && l; }, 5000);
  ok(L && /新型/.test(L.card), 'a word inside a <span> is found with its sentence: ' + (L && L.card));
  await lift();
  p = await at('#split', '確');
  await hold(p);
  L = await until(async () => { const l = await layer(); return l.shown && /確認/.test(l.card) && l; }, 5000);
  ok(L && /confirm/.test(L.card), 'the line after a <br> is read on its own: ' + (L && L.card));
  await lift();

  step('the mouse: hold the button, or hold Shift and point');
  p = await at('#weather', '緒');
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await wait(600);
  L = await until(async () => { const l = await layer(); return l.shown && /一緒/.test(l.card) && l; }, 5000);
  ok(L && /together/.test(L.card), 'holding the mouse button on 一緒 shows "together"');
  await page.mouse.up();
  await wait(150);
  ok(!(await layer()).shown, 'letting go of the button hides it');
  ok(await page.evaluate(() => String(getSelection())) === '', 'and nothing is left selected');
  p = await at('#weather', '今');
  await page.mouse.move(p.x, p.y);
  await page.keyboard.down('Shift');
  L = await until(async () => { const l = await layer(); return l.shown && /今日/.test(l.card) && l; }, 5000);
  ok(L && /today/.test(L.card), 'Shift while pointing at 今日 shows "today"');
  await page.keyboard.up('Shift');
  await wait(150);
  ok(!(await layer()).shown, 'letting go of Shift hides it');

  step('a page that allows no inline styles');
  await page.goto(SITE + 'strict.html');
  p = await at('#w', '静');
  await hold(p);
  L = await until(async () => { const l = await layer(); return l.shown && /静か/.test(l.card) && l; }, 5000);
  ok(L && /quiet/.test(L.card) && L.radius === '18px', 'the card shows, styled, under a strict Content-Security-Policy');
  await lift();

  step('vertical text');
  await page.goto(SITE + 'vertical.html');
  p = await at('#v', '雨');
  await hold(p);
  L = await until(async () => { const l = await layer(); return l.shown && /雨/.test(l.card) && l; }, 5000);
  ok(L && /rain/.test(L.card), 'a word in vertical text is found: ' + (L && L.card));
  const vr = L && L.readings.find((r) => r.text === 'あめ');
  ok(vr && vr.vertical && vr.left >= p.right - 2, 'its reading runs down the right of the kanji');
  ok(L && L.fills > 0, 'and the phrase is marked with boxes of the extension\'s own (the browser\'s marking is wrong in vertical text)');
  await lift();

  step('text under an empty link laid over a story card');
  await page.goto(SITE + 'cover.html');
  p = await at('#story', '閉');
  await hold(p);
  L = await until(async () => { const l = await layer(); return l.shown && /閉店/.test(l.card) && l; }, 5000);
  ok(L && /closing|clos/.test(L.card), 'the word under the cover is found: ' + (L && L.card));
  ok(await page.evaluate(() => { const a = document.querySelector('#card a'); return a.style.pointerEvents === '' && getComputedStyle(a).pointerEvents === 'auto'; }), 'the cover is put back as it was');
  await lift();
  await wait(400);
  ok(page.url() === SITE + 'cover.html', 'letting go does not follow the covering link');

  step('Chinese is left alone');
  await page.goto(SITE + 'chinese.html');
  p = await at('#zh', '图');
  await hold(p);
  ok(!(await layer()).shown, 'holding a Chinese page (lang zh, no kana) shows nothing');
  await lift();

  step('text inside a web component');
  await page.goto(SITE + 'shadow.html');
  p = await at('#s', '窓');
  await hold(p);
  L = await until(async () => { const l = await layer(); return l.shown && /窓/.test(l.card) && l; }, 5000);
  ok(L && /window/.test(L.card), 'a word in an open shadow root is found: ' + (L && L.card));
  await lift();

  step('a desktop page shrunk to fit a phone: the card stays readable');
  await page.goto(SITE + 'desktop.html');
  const scale = await page.evaluate(() => visualViewport.scale);
  p = await at('#d', '喫');
  await hold(p);
  L = await until(async () => { const l = await layer(); return l.shown && /喫茶/.test(l.card) && l; }, 5000);
  ok(L && /coffee|tea/.test(L.card), 'the card shows 喫茶店: ' + (L && L.card));
  ok(L && scale < 0.9 && /scale\(1\.[0-9]|scale\([2-9]/.test(L.transform), 'zoomed out to ' + scale.toFixed(2) + ', the card is scaled back up: ' + (L && L.transform));
  const vw = await page.evaluate(() => [visualViewport.offsetLeft, visualViewport.width]);
  ok(L && L.rect.left >= vw[0] - 1 && L.rect.right <= vw[0] + vw[1] + 1, 'and fits across the screen');
  await lift();

  step('the toolbar panel: switches');
  const panel = await ctx.newPage();
  await panel.goto('chrome-extension://' + extId + '/popup.html');
  await panel.waitForSelector('#sw-on');
  ok(await until(() => panel.locator('#state-text').innerText().then((t) => /ready/.test(t)), 5000), 'the panel says the dictionary is ready');
  await panel.click('#sw-furigana');
  await page.bringToFront();
  await page.goto(SITE + 'plain.html');
  p = await at('#weather', '天');
  await hold(p);
  L = await until(async () => { const l = await layer(); return l.shown && /天気/.test(l.card) && l; }, 5000);
  ok(L && L.readings.length === 0, 'with Furigana off, no reading is put in the page');
  await lift();
  await panel.click('#sw-furigana');
  await panel.click('#sw-on');
  await wait(200);
  await hold(p);
  ok(!(await layer()).shown, 'with Yaoki Reader off, holding a word shows nothing');
  await lift();
  await panel.click('#sw-on');
  const off = await sw.evaluate(() => chrome.storage.local.set({ settings: { on: true, off: ['yaoki.test'], furigana: true, meanings: true, grammar: true, hold: 1 } }));
  await wait(200);
  await hold(p);
  ok(!(await layer()).shown, 'switched off for this site, holding a word shows nothing');
  await lift();
  await sw.evaluate(() => chrome.storage.local.set({ settings: { on: true, off: [], furigana: true, meanings: true, grammar: true, hold: 1 } }));

  ok(logs.length === 0, 'no page errors' + (logs.length ? ': ' + logs.join(' | ') : ''));
  await ctx.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(fails ? fails + ' FAILED' : 'all passed');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
