// Takes the store listings' screenshots (store/screenshots/): the extension on sample pages written here (no real
// site's text), a finger or the mouse on a word, in Chromium with the Chrome build loaded.
// usage: python3 tools/extension.py && node tools/screenshots.js   (needs Playwright with its Chromium)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const TOP = path.join(__dirname, '..');
const EXT = path.join(TOP, 'dist', 'chrome');
const OUT = path.join(TOP, 'store', 'screenshots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* a sample article (not from any site), and a sample blog, both in a plain style of their own */
const ARTICLE = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>まちのニュース</title>
<style>
body { margin: 0; font: 17px/1.85 'Noto Sans CJK JP', 'Hiragino Sans', sans-serif; color: #222; background: #fff; }
header { background: #b71c1c; color: #fff; padding: 14px 18px; font-weight: 700; font-size: 18px; letter-spacing: 0.04em; }
main { max-width: 680px; margin: 0 auto; padding: 10px 18px 60px; }
h1 { font-size: 24px; line-height: 1.4; margin: 14px 0 4px; }
.date { color: #777; font-size: 13px; margin: 0 0 18px; }
p { margin: 0 0 1em; }
</style>
<body><header>まちのニュース</header><main>
<h1>駅前の古い本屋、来月で閉店へ</h1>
<p class="date">2026年10月24日</p>
<p>駅前で五十年続いてきた小さな本屋が、来月末で店を閉じることになった。店主の田中さんは「長い間、本当にありがとうございました」と話している。</p>
<p>店には毎朝、新聞や雑誌を買いに来る常連客が多く、閉店を知った人たちからは残念がる声が上がっている。</p>
<p>田中さんは、閉店の後も地域の子どもたちに本を読む楽しさを伝える活動を続けたいという。</p>
<p>近くの小学校では、来月から毎週土曜日に読み聞かせの会を開く予定で、最初の回には田中さんも参加する。</p>
</main></body></html>`;
const BLOG = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>週末の記録</title>
<style>
body { margin: 0; font: 18px/1.9 'Noto Serif CJK JP', 'Hiragino Mincho ProN', serif; color: #2a2a2a; background: #faf8f3; }
article { max-width: 640px; margin: 0 auto; padding: 36px 24px 80px; }
h1 { font-size: 26px; font-weight: 600; margin: 0 0 6px; }
.meta { color: #8a8070; font-size: 13px; font-family: sans-serif; margin-bottom: 24px; }
p { margin: 0 0 1.2em; }
</style>
<body><article>
<h1>雨の日の図書館</h1>
<div class="meta">週末の記録 · 10月</div>
<p>土曜日は朝から雨が降っていたので、傘を持って駅の向こうの図書館まで歩いた。思ったより人が少なく、窓際の席が空いていた。</p>
<p>借りたのは、ずっと読みたいと思っていた古い旅行記だ。知らない町の名前がたくさん出てきて、地図を広げながら読み進めた。</p>
<p>帰りに寄った喫茶店で、店の人に本のことを話したら、同じ本を読んだことがあると言って笑った。</p>
</article></body></html>`;
const PAGES = { 'news.test/': ARTICLE, 'blog.test/': BLOG };

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaoki-shots-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: 'chromium', headless: true, hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
    args: ['--disable-extensions-except=' + EXT, '--load-extension=' + EXT],
  });
  await ctx.route(/^http:\/\/(news|blog)\.test\//, (r) => r.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: PAGES[new URL(r.request().url()).host + '/'] }));
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const page = await ctx.newPage();
  await page.goto('http://news.test/');
  for (let i = 0; i < 100; i++) { const st = await sw.evaluate(() => toHost({ type: 'yaoki:status' })); if (st.state === 'ready') break; await wait(200); }
  const cdp = await ctx.newCDPSession(page);
  const at = (word, nth) => page.evaluate(([word, nth]) => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const i = n.data.indexOf(word);
      if (i < 0) continue;
      const r = document.createRange(); r.setStart(n, i + nth); r.setEnd(n, i + nth + 1);
      const b = r.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }
  }, [word, nth]);
  /* a word held under a finger: the card settles, then the shot */
  async function phone(url, word, nth, name) {
    await page.goto(url);
    await wait(400);
    const p = await at(word, nth || 0);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
    await wait(900);
    await page.screenshot({ path: path.join(OUT, name) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await wait(200);
  }
  await phone('http://news.test/', '常連客', 1, 'phone-1-news.png');
  await phone('http://news.test/', '残念がる', 1, 'phone-2-grammar.png');
  await phone('http://blog.test/', '読み進めた', 1, 'phone-3-blog.png');
  await page.close();

  /* desktop pages, the mouse held on a word: 1280x800, which the Chrome Web Store and Edge Add-ons ask for */
  const ctx2 = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'yaoki-shots-d-')), {
    channel: 'chromium', headless: true, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
    args: ['--disable-extensions-except=' + EXT, '--load-extension=' + EXT],
  });
  await ctx2.route(/^http:\/\/(news|blog)\.test\//, (r) => r.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: PAGES[new URL(r.request().url()).host + '/'] }));
  const sw2 = ctx2.serviceWorkers()[0] || await ctx2.waitForEvent('serviceworker', { timeout: 15000 });
  const d = await ctx2.newPage();
  await d.goto('http://blog.test/');
  for (let i = 0; i < 100; i++) { const st = await sw2.evaluate(() => toHost({ type: 'yaoki:status' })); if (st.state === 'ready') break; await wait(200); }
  async function desktop(url, word, nth, name) {
    await d.goto(url);
    await wait(400);
    const q = await d.evaluate(([word, nth]) => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) { const i = n.data.indexOf(word); if (i >= 0) { const r = document.createRange(); r.setStart(n, i + nth); r.setEnd(n, i + nth + 1); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; } }
    }, [word, nth]);
    await d.mouse.move(q.x, q.y);
    await d.mouse.down();
    await wait(900);
    await d.screenshot({ path: path.join(OUT, name) });
    await d.mouse.up();
    await wait(200);
  }
  await desktop('http://blog.test/', '旅行記', 1, 'desktop-1-blog.png');
  await desktop('http://news.test/', '常連客', 1, 'desktop-2-news.png');
  await desktop('http://news.test/', '残念がる', 1, 'desktop-3-grammar.png');
  await desktop('http://blog.test/', '読み進めた', 1, 'desktop-4-form.png');
  /* the toolbar panel, and the list of words looked up, each at its own width on a 1280x800 ground */
  const panel = await ctx2.newPage();
  await panel.setViewportSize({ width: 400, height: 800 });
  await panel.goto('chrome-extension://' + new URL(sw2.url()).host + '/popup.html');
  await panel.waitForSelector('#state-text');
  for (let i = 0; i < 20; i++) { if (/ready/.test(await panel.locator('#state-text').innerText())) break; await wait(200); }
  await panel.screenshot({ path: path.join(OUT, 'panel-400x800.png') });
  await panel.close();
  await ctx2.close();
  await ctx.close();
  console.log('screenshots written to', OUT);
}
main().catch((e) => { console.error(e); process.exit(1); });
