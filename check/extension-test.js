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
/* EXT_DIR=dist/edge runs the same checks on the Edge build (the dictionary files unpacked) */
const EXT = process.env.EXT_DIR ? path.resolve(process.env.EXT_DIR) : path.join(TOP, 'dist', 'chrome');
const SITE = 'http://yaoki.test/';
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok: ' : '  FAIL: ') + msg); if (!cond) fails += 1; return cond; };
const step = (msg) => console.log('-- ' + msg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGES = {
  'plain.html': `<!doctype html><html lang="ja"><meta charset="utf-8"><title>plain</title>
<body style="margin:0;padding:300px 30px 30px;font:20px/1.8 serif;width:600px">
<p id="weather">今日はいい天気ですね！明日、一緒に行きませんか？</p>
<p id="link"><a href="${SITE}next.html">新しい記事を読む</a></p>
<p id="kakawa">彼はその事件に関わった。</p>
<p id="raise">銀行が金利を引き上げる。</p>
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
<div id="h2"></div>
<script>document.getElementById('h').attachShadow({mode:'open'}).innerHTML = '<p id="s">猫が窓の外を見ている。</p>';
document.getElementById('h2').attachShadow({mode:'open'}).innerHTML = '犬が<b>庭の隅</b>で寝ている。';</script></body></html>`,
  'cover.html': `<!doctype html><html lang="ja"><meta charset="utf-8"><title>cover</title>
<body style="margin:0;padding:300px 30px;font:20px/1.8 sans-serif">
<div id="card" style="position:relative;padding:10px;border:1px solid #ccc"><h2 id="story" style="font-size:20px;margin:0">駅前の本屋が来月で閉店する</h2>
<a href="${SITE}next.html" style="position:absolute;inset:0" aria-label="story"></a></div></body></html>`,
  'more.html': `<!doctype html><html lang="ja"><meta charset="utf-8"><title>more</title>
<style>::backdrop { background: rgba(0, 0, 0, 0.6); } .card2 { position: relative } .card2 a::after { content: ''; position: absolute; inset: 0 }</style>
<body style="margin:0;padding:300px 30px 30px;font:20px/1.8 serif;width:600px">
<p id="rt">その<ruby>蜘蛛<rt>くも</rt></ruby>を助けた。</p>
<p id="rb"><ruby><rb>東</rb><rb>京</rb><rt>とう</rt><rt>きょう</rt></ruby>へ行く。</p>
<ul id="list"><li>続きを読む</li><li>続きを読む</li></ul>
<div class="card2" id="card2"><h3 style="margin:0"><a href="${SITE}next.html">新しい記事の見出し</a></h3><p id="teaser" style="margin:0">本文の一部がここに入る。</p></div>
<p id="swap">雨の日は家で本を読む。</p>
<p><button id="next" onclick="this.dataset.n = (+this.dataset.n || 0) + 1">次へ</button></p>
${'<p>駅の前に小さな本屋があって、私は毎朝そこで新聞を買う。</p>'.repeat(30)}
</body></html>`,
  'xhtml.xhtml': `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" lang="ja"><head><title>x</title></head>
<body style="margin:0;padding:300px 30px;font:20px/1.8 serif"><div id="x">一行目の文章です<br/>二行目の文章です<br/>三行目</div></body></html>`,
  'place.html': `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>place</title>
<body style="margin:0;padding:8px 16px;font:17px/1.8 sans-serif">
${'<p>小さな町の図書館では、毎週土曜日に子ども向けの読み聞かせ会が開かれている。参加した親子は静かに話を聞いていた。</p>'.repeat(40)}
</body></html>`,
  'dark.html': `<!doctype html><html lang="ja"><meta charset="utf-8"><title>dark</title>
<body style="margin:0;padding:300px 30px;font:20px/1.8 serif;background:#14161a;color:#e8e8e8"><p id="d">夜の町は静かだった。</p></body></html>`,
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
    const headers = { 'content-type': name.endsWith('.css') ? 'text/css' : name.endsWith('.xhtml') ? 'application/xhtml+xml; charset=utf-8' : 'text/html; charset=utf-8' };
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
    (function find(n) { if (host || !n) return; if (n.nodeName.toUpperCase() === 'YAOKI-READER-LAYER') host = n; (n.children || []).forEach(find); })(doc.root);
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
          markTop: (this.querySelector('.mark') || { getBoundingClientRect: () => ({ top: -1 }) }).getBoundingClientRect().top,
          kept: (() => { let u = null; this.querySelectorAll('.mark, .rd').forEach((e) => { const r = e.getBoundingClientRect(); if (!r.width) return; u = u ? { left: Math.min(u.left, r.left), top: Math.min(u.top, r.top), right: Math.max(u.right, r.right), bottom: Math.max(u.bottom, r.bottom) } : { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }); return u; })(),
          forms: Array.from(card.querySelectorAll('.lb')).filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.textContent),
          others: Array.from(card.querySelectorAll('.lm')).filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.textContent),
          lj: card.querySelector('.lj') ? parseFloat(getComputedStyle(card.querySelector('.lj')).fontSize) : 0,
          rdSize: this.querySelector('.rd') ? parseFloat(getComputedStyle(this.querySelector('.rd')).fontSize) : 0,
          cardBg: getComputedStyle(card).backgroundColor,
          inTopLayer: this.host.matches(':popover-open'),
          fills: this.querySelectorAll('.mark.fill').length,
        };
      }`,
    });
    return result.value;
  }
  /* where a character of an element's text is on screen */
  async function at(sel, text, nth) {
    return page.evaluate(([sel, text, nth]) => {
      const root = sel[0] === '@' ? document.querySelector(sel.slice(1)).shadowRoot : document.querySelector(sel) || document.querySelector('#h').shadowRoot.querySelector(sel);
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

  step('installed, it opens its welcome page once');
  const welcome = await until(async () => ctx.pages().find((pg) => /\/welcome\.html$/.test(pg.url())), 5000);
  ok(!!welcome, 'a page with the gesture and lines to try it on opens on install');
  if (welcome) {
    await welcome.waitForSelector('.try p');
    ok(/Try it on these lines/.test(await welcome.locator('main').innerText()) && (await welcome.locator('.try p').count()) >= 3, 'it says how, and gives lines to try');
    await welcome.close();
  }

  step('switched off, a Japanese page loads nothing');
  const contexts = () => sw.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).then((c) => c.length));
  await sw.evaluate(() => chrome.storage.local.set({ settings: { on: false, off: [], furigana: true, meanings: true, grammar: true, hold: 1 } }));
  await page.goto(SITE + 'plain.html');
  await wait(3500);
  ok(await contexts() === 0, 'with Yaoki Reader off, opening a Japanese page does not start the engine');
  const panel0 = await ctx.newPage();
  await panel0.goto('chrome-extension://' + extId + '/popup.html');
  await wait(1500);
  ok(await contexts() === 0, 'nor does opening the toolbar panel');
  await panel0.close();

  step('a Japanese page wakes the engine before the first touch');
  await sw.evaluate(() => chrome.storage.local.set({ settings: { on: true, off: [], furigana: true, meanings: true, grammar: true, hold: 1 } }));
  await page.goto(SITE + 'plain.html');
  const ready = await until(async () => (await sw.evaluate(() => toHost({ type: 'yaoki:status' }))).state === 'ready', 40000);
  ok(ready, 'the dictionary is loaded in the background after the page opens');

  step('a finger held on a word');
  let p = await at('#weather', '天'), q;
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
  q = await at('#weather', '明');
  for (let k = 1; k <= 6; k++) await touch('touchMove', { x: p.x + (q.x - p.x) * k / 6, y: p.y + (q.y - p.y) * k / 6 });
  L = await until(async () => { const l = await layer(); return l.shown && /明日/.test(l.card) && l; }, 5000);
  ok(L && /tomorrow/.test(L.card), 'the card follows to 明日 "tomorrow": ' + (L && L.card));
  ok(L && L.readings.some((r) => r.text === 'あした'), 'and its reading あした');
  ok(await page.evaluate(() => scrollY) === scrollBefore, 'the page does not scroll while a word is held');
  await lift();
  L = await layer();
  ok(!L.shown && L.readings.length === 0 && L.marks === 0, 'lifting the finger hides the card, the reading and the mark');
  ok(!L.inTopLayer, 'and the layer leaves the top layer');

  step('a grammar pattern');
  p = await at('#weather', '行');
  await hold(p);
  L = await until(async () => { const l = await layer(); return l.shown && /行/.test(l.card) && l; }, 5000);
  ok(L && /文法/.test(L.card) && /ません/.test(L.card), 'holding 行きません shows the 〜ません note: ' + (L && L.card));
  ok(L && L.forms.length === 1 && /辞書形行くいく/.test(L.forms[0]), 'and its dictionary form 行く (いく): ' + JSON.stringify(L && L.forms));
  await lift();

  step('the dictionary form of an inflected word, and none for a word as the dictionary has it');
  p = await at('#kakawa', '関');
  await hold(p);
  L = await until(async () => { const l = await layer(); return l.shown && /関わ/.test(l.card) && l; }, 5000);
  ok(L && L.forms.length === 1 && /関わるかかわる/.test(L.forms[0]), 'holding 関わった shows 関わる (かかわる): ' + JSON.stringify(L && L.forms));
  await lift();
  p = await at('#weather', '天');
  await hold(p);
  L = await until(async () => { const l = await layer(); return l.shown && /天気/.test(l.card) && l; }, 5000);
  ok(L && L.forms.length === 0, 'holding 天気 shows none');
  await lift();

  const ON = { on: true, off: [], furigana: true, meanings: true, grammar: true, more: true, hold: 1, keep: true, size: 1 };
  step('other meanings, text size, a dark page, Esc and the shortcut');
  p = await at('#raise', '引');
  await hold(p);
  L = await until(async () => { const l = await layer(); return l.shown && /引き上げる/.test(l.card) && l; }, 5000);
  ok(L && L.others.length === 1 && /ほかの意味/.test(L.others[0]) && /to increase/.test(L.others[0]), 'holding 引き上げる shows its other senses under the card: ' + JSON.stringify(L && L.others));
  const lj1 = L && L.lj, rd1 = L && L.rdSize;
  ok(L && L.cardBg === 'rgb(255, 255, 255)', 'on a light page the card is light (' + (L && L.cardBg) + ')');
  await lift();
  await sw.evaluate((on) => chrome.storage.local.set({ settings: Object.assign({}, on, { more: false, size: 2 }) }), ON);
  await wait(200);
  await hold(p);
  L = await until(async () => { const l = await layer(); return l.shown && /引き上げる/.test(l.card) && l; }, 5000);
  ok(L && L.others.length === 0, 'with Other meanings off, the line is gone');
  ok(L && L.lj > lj1 * 1.1 && L.rdSize > rd1 * 1.1, 'with the large text size, the card and the readings are larger (' + lj1 + ' → ' + (L && L.lj) + ', ' + rd1 + ' → ' + (L && L.rdSize) + ')');
  await lift();
  await sw.evaluate((on) => chrome.storage.local.set({ settings: on }), ON);
  await wait(200);
  await page.goto(SITE + 'dark.html');
  p = await at('#d', '静');
  await hold(p);
  L = await until(async () => { const l = await layer(); return l.shown && /静か/.test(l.card) && l; }, 5000);
  ok(L && L.cardBg === 'rgb(28, 35, 59)', 'on a dark page the card is dark (' + (L && L.cardBg) + ')');
  await lift();
  await page.goto(SITE + 'plain.html');
  p = await at('#weather', '今');
  await page.mouse.move(p.x, p.y);
  await page.keyboard.down('Shift');
  L = await until(async () => { const l = await layer(); return l.shown && /今日/.test(l.card) && l; }, 5000);
  await page.keyboard.press('Escape');
  await wait(200);
  ok(L && !(await layer()).shown, 'Esc puts the card away while Shift is still held');
  await page.keyboard.up('Shift');
  const flipped = await sw.evaluate(() => toggleOn().then((on) => chrome.storage.local.get('settings').then((v) => [on, v.settings.on])));
  ok(flipped[0] === false && flipped[1] === false, 'the shortcut\'s command switches it off');
  ok((await sw.evaluate(() => toggleOn())) === true, 'and on again');

  step('the card keeps clear of the finger, upright and sideways');
  await page.goto(SITE + 'place.html');
  await wait(300);
  /* a character of the text near a height on the screen (a share of it): one inside a phrase, the last of a phrase
     (the は of 図書館では or 親子は), or the first on a line */
  const near = (share, kind) => page.evaluate(([share, kind]) => {
    const y = innerHeight * share, w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n, best = null;
    while ((n = w.nextNode())) {
      for (let i = 0; i < n.data.length; i++) {
        const c = n.data[i];
        if (kind === 'inside' && (i % 7 || !/[一-鿿]/.test(c))) continue;
        if (kind === 'end' && !(c === 'は' && /(館で|親子)$/.test(n.data.slice(0, i)))) continue;
        if (kind === 'start' && !/[一-鿿ぁ-ゖ]/.test(c)) continue;
        const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1);
        const b = r.getBoundingClientRect();
        if (kind === 'start' ? b.left > 30 : b.left < 40 || b.right > innerWidth - 40) continue;
        const d = Math.abs(b.top + b.height / 2 - y);
        if (!best || d < best.d) best = { d, x: b.left + b.width / 2, y: b.top + b.height / 2, top: b.top, bottom: b.bottom, left: b.left, right: b.right };
      }
    }
    return best;
  }, [share, kind]);
  const crosses = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  for (const [label, size] of [['upright', { width: 390, height: 700 }], ['sideways', { width: 844, height: 340 }]]) {
    await page.setViewportSize(size);
    await wait(300);
    for (const [share, kind] of [[0.15, 'inside'], [0.45, 'inside'], [0.8, 'inside'], [0.15, 'end'], [0.8, 'end'], [0.1, 'start']]) {
      p = await near(share, kind);
      if (!ok(!!p, label + ': a character ' + kind + ' near ' + Math.round(share * 100) + '% to hold')) continue;
      await hold(p);
      L = await until(async () => { const l = await layer(); return l.shown && l.marks > 0 && l; }, 5000);
      const where = label + ', ' + { inside: 'inside a phrase', end: 'the end of a phrase', start: 'the start of a line' }[kind] + ' at ' + Math.round(share * 100) + '%';
      ok(L && !crosses(L.rect, L.kept), where + ': the card leaves the phrase and its readings in view');
      ok(L && !crosses(L.rect, { left: p.x - 38, right: p.x + 38, top: p.y - 10, bottom: p.y + 110 }), where + ': it is clear of the fingertip and the thumb below it');
      ok(L && L.rect.left >= -1 && L.rect.right <= size.width + 1 && L.rect.top >= -1 && L.rect.bottom <= size.height + 1, where + ': and on the screen');
      await lift();
    }
  }
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto(SITE + 'plain.html');
  await wait(300);

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

  step('the page\'s own furigana: a finger on one, and readings paired base by base');
  await page.goto(SITE + 'more.html');
  p = await at('#rt', 'も');
  await hold(p);
  L = await until(async () => { const l = await layer(); return l.shown && /蜘蛛/.test(l.card) && l; }, 5000);
  ok(L && /spider/.test(L.card) && !/くも/.test(L.card.replace(/\s/g, '')), 'a finger on the reading くも shows the word under it, 蜘蛛, not くも as a word: ' + (L && L.card));
  await lift();
  p = await at('#rb', '京');
  await hold(p);
  L = await until(async () => { const l = await layer(); return l.shown && /東京/.test(l.card) && l; }, 5000);
  ok(L && L.cardReadings.join('') === 'とうきょう', 'rb/rt ruby gives 東京 the reading とうきょう: ' + JSON.stringify(L && L.cardReadings));
  await lift();

  step('the same words on two lines, and an element replaced while held');
  p = await at('#list', '読', 0);
  q = await at('#list', '読', 1);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await wait(600);
  L = await until(async () => { const l = await layer(); return l.shown && /読/.test(l.card) && l; }, 5000);
  const firstTop = L && L.markTop;
  for (let k = 1; k <= 6; k++) { await page.mouse.move(p.x, p.y + (q.y - p.y) * k / 6); await wait(30); }
  L = await until(async () => { const l = await layer(); return l.shown && Math.abs(l.markTop - firstTop) > 10 && l; }, 3000);
  ok(L && Math.abs(L.markTop - (q.top)) < 12, 'moving to the second 続きを読む moves the mark to it');
  await page.mouse.up(); await wait(100);
  await page.evaluate(() => document.getElementById('next').dataset.n = '0');
  const nb = await page.locator('#next').boundingBox();
  await page.mouse.click(nb.x + nb.width / 2, nb.y + nb.height / 2);
  ok(await page.evaluate(() => document.getElementById('next').dataset.n) === '1', 'a click on a button just after a hold still counts');
  p = await at('#swap', '雨');
  await hold(p);
  await until(async () => (await layer()).shown, 5000);
  await page.evaluate(() => { const e = document.getElementById('swap'); e.replaceWith(e.cloneNode(true)); });
  await lift();
  ok(!(await layer()).shown, 'when the page replaces the held text, lifting the finger still hides the card');
  const before2 = await page.evaluate(() => scrollY);
  p = await at('#swap', '本');
  await touch('touchStart', p);
  for (let k = 1; k <= 8; k++) { await touch('touchMove', { x: p.x, y: p.y - 30 * k }); await wait(16); }
  await touch('touchEnd'); await wait(400);
  ok(await page.evaluate(() => scrollY) > before2 + 50, 'and the next swipe scrolls');
  await page.evaluate(() => scrollTo(0, 0)); await wait(200);

  step('a story card that is one big link, and a page that dims its dialogs\' backdrop');
  p = await at('#card2', '見');
  await hold(p);
  L = await until(async () => { const l = await layer(); return l.shown && /見出し/.test(l.card) && l; }, 5000);
  ok(L && /headline/.test(L.card), 'the headline under the link\'s ::after cover is found: ' + (L && L.card));
  await lift();
  p = await at('#teaser', '部');
  await hold(p);
  L = await until(async () => { const l = await layer(); return l.shown && /一部/.test(l.card) && l; }, 5000);
  ok(L && /part/.test(L.card), 'and so is the teaser under it: ' + (L && L.card));
  await lift();
  await wait(300);
  ok(page.url() === SITE + 'more.html', 'letting go does not follow the card\'s link');
  const after = await page.evaluate(() => getComputedStyle(document.querySelector('yaoki-reader-layer'), '::backdrop').display);
  ok(after === 'none', 'the page\'s ::backdrop rule does not reach the layer (' + after + ')');

  step('XHTML: a <br/> still ends the line');
  await page.goto(SITE + 'xhtml.xhtml');
  p = await at('#x', '二');
  await hold(p);
  L = await until(async () => { const l = await layer(); return l.shown && /二/.test(l.card) && l; }, 5000);
  ok(L && !/です二|目三/.test(L.card.replace(/\s/g, '')), 'the line after <br/> is read on its own: ' + (L && L.card));
  await lift();

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
  p = await at('@#h2', '犬');
  await hold(p);
  L = await until(async () => { const l = await layer(); return l.shown && /犬/.test(l.card) && l; }, 5000);
  ok(L && /dog/.test(L.card), 'text straight in a shadow root is found: ' + (L && L.card));
  await lift();
  p = await at('@#h2', '隅');
  await hold(p);
  L = await until(async () => { const l = await layer(); return l.shown && /隅/.test(l.card) && l; }, 5000);
  ok(L && /corner|nook/.test(L.card), 'and a word in an inline element there, read with its sentence: ' + (L && L.card));
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

  step('a tab coming back starts the engine again, before any touch');
  await sw.evaluate(() => chrome.offscreen.closeDocument());
  await wait(200);
  ok(await contexts() === 0, 'the engine is closed (as Safari closes it after a while)');
  await page.goto(SITE + 'plain.html');
  /* the page's own start (a Japanese page opening) has come and gone before the engine is closed again */
  await wait(1500);
  await sw.evaluate(() => chrome.offscreen.closeDocument()).catch(() => {});
  await wait(2200);
  ok(await contexts() === 0, 'and stays closed while the page is left alone');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  ok(await until(async () => (await contexts()) === 1, 1500), 'the page coming back on screen opens it again at once');
  p = await at('#weather', '天');
  await hold(p);
  L = await until(async () => { const l = await layer(); return l.shown && l; }, 5000);
  ok(L && (/天気/.test(L.card) || /Loading the dictionary/.test(L.card)) && !/stays loaded/.test(L.card), 'a hold during the load says what is happening, truthfully: ' + (L && L.card.slice(0, 60)));
  L = await until(async () => { const l = await layer(); return l.shown && /天気/.test(l.card) && l; }, 30000);
  ok(L && /fine weather/.test(L.card), 'and then shows the word');
  await lift();

  step('the list of words looked up');
  await sw.evaluate((on) => chrome.storage.local.set({ settings: on, looked: [], lookedHead: { n: 0, recent: [] } }), ON);
  const looked = () => sw.evaluate(() => chrome.storage.local.get('looked').then((v) => v.looked || []));
  await page.goto(SITE + 'plain.html');
  await wait(300);
  p = await at('#weather', '天');
  await hold(p, 1300);
  await lift();
  let W = await until(async () => { const l = await looked(); return l.length && l; }, 3000);
  ok(W && W.length === 1 && W[0].w === 'いい天気' && W[0].r === 'いいてんき' && /fine weather/.test(W[0].e), 'holding 天気 lists its phrase\'s word いい天気 (いいてんき): ' + JSON.stringify(W && W[0] && [W[0].w, W[0].r, W[0].e]));
  ok(W && W[0].s === '今日はいい天気ですね！' && W[0].s.slice(W[0].a, W[0].b) === 'いい天気ですね', 'with its sentence, the phrase marked in it: ' + JSON.stringify(W && W[0] && [W[0].s, W[0].a, W[0].b]));
  ok(W && W[0].u === SITE + 'plain.html' && W[0].t === 'plain', 'and the page it was on');
  await hold(p, 1300); await lift(); await wait(300);
  W = await looked();
  ok(W.length === 1 && W[0].n === 1, 'held again on the same page, it is listed once');
  await page.goto(SITE + 'plain.html');
  await wait(300);
  await hold(p, 1300); await lift();
  W = await until(async () => { const l = await looked(); return l[0] && l[0].n === 2 && l; }, 3000);
  ok(W && W.length === 1 && W[0].n === 2, 'held on the page opened again, it is counted twice, still one entry');
  p = await at('#weather', '今');
  q = await at('#weather', '明');
  await touch('touchStart', p);
  await wait(400);
  for (let k = 1; k <= 5; k++) await touch('touchMove', { x: p.x + (q.x - p.x) * k / 5, y: q.y });
  await wait(1300);
  await lift();
  W = await until(async () => { const l = await looked(); return l.some((e) => e.w === '明日') && l; }, 3000);
  ok(W && W[0].w === '明日', 'sliding on to 明日 and resting there lists 明日: ' + JSON.stringify(W && W.map((e) => e.w)));
  ok(W && !W.some((e) => e.w === '今日'), 'but not 今日, which the finger only passed over');
  await sw.evaluate((on) => chrome.storage.local.set({ settings: Object.assign({}, on, { keep: false }) }), ON);
  await wait(200);
  p = await at('#weather', '行');
  await hold(p, 1300); await lift(); await wait(400);
  W = await looked();
  ok(!W.some((e) => e.w === '行く'), 'with the switch off, a hold lists nothing');
  await sw.evaluate((on) => chrome.storage.local.set({ settings: on }), ON);

  const listPage = await ctx.newPage();
  await listPage.goto('chrome-extension://' + extId + '/list.html');
  await listPage.waitForSelector('#list li');
  let items = await listPage.locator('#list li').allInnerTexts();
  ok(items.length === 2 && /明日/.test(items[0]) && /いい天気/.test(items[1]) && /×2/.test(items[1]), 'the list page shows both, newest first, with the count: ' + JSON.stringify(items.map((t) => t.replace(/\s+/g, ' ').slice(0, 40))));
  ok(await listPage.locator('#list .s b').first().innerText() === '明日', 'the phrase is marked in its sentence');
  await listPage.fill('#filter', '天気');
  ok(await listPage.locator('#list li').count() === 1 && /1 of 2 words/.test(await listPage.locator('#count').innerText()), 'the filter narrows the list');
  await listPage.fill('#filter', '');
  const [download] = await Promise.all([listPage.waitForEvent('download'), listPage.click('#anki')]);
  const file = fs.readFileSync(await download.path(), 'utf8').split('\n');
  ok(file[0] === '#separator:tab' && file[1] === '#html:true' && file[3].split('\t').length === 5 && /<b>明日<\/b>/.test(file[3]), 'Save for Anki writes a tab-separated file Anki imports: ' + file[3].slice(0, 60));
  await listPage.locator('#list .x').first().click();
  await until(async () => (await listPage.locator('#list li').count()) === 1, 3000);
  ok(await listPage.locator('#list li').count() === 1 && (await looked()).length === 1, 'an entry can be deleted');
  await listPage.click('#clear');
  await listPage.click('#clear-yes');
  await until(async () => (await listPage.locator('#list li').count()) === 0, 3000);
  ok(!(await listPage.locator('#empty').isHidden()) && (await looked()).length === 0, 'and the list cleared');
  await listPage.close();
  const capped = await sw.evaluate(() => chrome.storage.local.set({ looked: Array.from({ length: 1600 }, (_, i) => ({ w: '語' + i, r: '', e: '', n: 1, at: 0, first: 0 })) })
    .then(() => keepWord({ type: 'yaoki:keep', w: '新しい', r: 'あたらしい', e: 'new', x: '新しい', s: '新しい本', a: 0, b: 3, t: 't', u: 'http://x.test/' }))
    .then(() => chrome.storage.local.get('looked')).then((v) => [v.looked.length, v.looked[0].w]));
  ok(capped[0] === 1500 && capped[1] === '新しい', 'the list holds at most 1500 words, the newest first (' + capped + ')');
  await sw.evaluate(() => chrome.storage.local.set({ looked: [], lookedHead: { n: 0, recent: [] } }));

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
