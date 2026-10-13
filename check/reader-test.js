// Checks for the reader in docs/, served the way GitHub Pages serves it (under /Yaoki-reader/).
// usage: bash run.sh reader-test.js
// optional: BACKUP=<path to a reader backup file> also loads that file and opens every text in it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const READER = 'http://127.0.0.1:8766/Yaoki-reader/';
const out = path.join(__dirname, 'out');
fs.mkdirSync(out, { recursive: true });
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok: ' : '  FAIL: ') + msg); if (!cond) fails += 1; };
const step = (msg) => console.log('-- ' + msg);

async function newPage(ctx, logs) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text()) && !/ERR_FAILED|net::/.test(m.text())) logs.push('console: ' + m.text().slice(0, 200)); });
  return page;
}
const cards = (page) => page.locator('#texts .tc-title').allInnerTexts();
const toastText = async (page) => { await page.waitForSelector('#toast:not([hidden])', { timeout: 5000 }); return page.locator('#toast').innerText(); };
async function writeBackup(texts) {
  const file = path.join(os.tmpdir(), 'reader-backup-' + Date.now() + Math.random().toString(36).slice(2) + '.json');
  fs.writeFileSync(file, JSON.stringify({ app: 'yaoki-reader', version: 1, exported: new Date().toISOString(), texts }));
  return file;
}
async function holdFirstPhrase(page, nth) {
  const ph = page.locator('#passage .ph').nth(nth || 0);
  await ph.scrollIntoViewIfNeeded();
  const b = await ph.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(250);
  const lens = await page.locator('#lens').isVisible() ? await page.locator('#lens').innerText() : '';
  const rubyShown = await page.locator('.ph.on .rt').count() ? await page.locator('.ph.on .rt').first().isVisible() : null;
  await page.mouse.up();
  await page.waitForTimeout(100);
  return { lens, rubyShown, hidden: !(await page.locator('#lens').isVisible()) };
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
  // Google Fonts cannot be reached from the test machine; refuse them at once so the page falls back without waiting
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const logs = [];

  step('the reader opens and installs its offline copy');
  const page = await newPage(ctx, logs);
  const resp = await page.goto(READER);
  ok(resp && resp.ok(), 'reader page answers ' + (resp && resp.status()));
  ok(await page.title() === 'Yaoki Reader', 'page title is Yaoki Reader');
  await page.waitForSelector('#texts .text-card');
  const active = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then((r) => !!r.active), new Promise((res) => setTimeout(() => res(false), 10000))]));
  ok(active, 'the offline worker is active');
  const manifest = await page.evaluate(() => fetch(document.querySelector('link[rel=manifest]').href).then((r) => r.json()));
  ok(manifest.name === 'Yaoki Reader' && manifest.icons.length === 3, 'the page has an install manifest with icons');
  ok(await page.evaluate(() => fetch('icons/apple-touch-icon.png').then((r) => r.ok)), 'the home-screen icon is there');
  await page.reload();
  await page.waitForSelector('#texts .text-card');
  ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'after a reload the page is served through it');
  ok(JSON.stringify(await cards(page)) === JSON.stringify(['片目のだるま']), 'library shows only the sample at first');
  ok(await page.locator('#lib-state').innerText().then((t) => /this browser/.test(t)), 'library says texts are kept in this browser');
  ok(!(await page.locator('#export-lib').isVisible()), 'Save a backup is hidden while there is nothing to save');
  ok(await page.locator('a[href="https://jorycook.github.io/Yaoki/"]').count() === 1, 'there is a link to the Yaoki app');

  step('the sample: hold to reveal');
  await page.locator('#texts .text-card').first().click();
  await page.waitForSelector('#passage .ph');
  const sampleCount = await page.locator('#passage .ph').count();
  ok(sampleCount === 34, 'sample has 34 phrases (' + sampleCount + ')');
  const r1 = await holdFirstPhrase(page, 0);
  ok(/祖母/.test(r1.lens) && /grandmother/.test(r1.lens), 'holding the first phrase shows 祖母 and "grandmother"');
  ok(r1.rubyShown === true, 'furigana shows in the text while held');
  ok(r1.hidden, 'letting go hides the card');
  ok((await page.locator('#read-count').innerText()).startsWith('1'), 'the looked-up count is 1');
  await page.locator('#read-back').click();

  step('adding a text end to end (loads the whole dictionary)');
  await page.locator('#go-add').click();
  await page.fill('#add-title', '令和のテスト');
  await page.fill('#add-text', '令和元年の八日に、一本の傘を電車に忘れた。\n係の人は三十四分で見つけてくれた。');
  const t0 = Date.now();
  await page.locator('#add-go').click();
  await page.waitForSelector('#passage .ph', { timeout: 120000 });
  const took = ((Date.now() - t0) / 1000).toFixed(1);
  ok(true, 'dictionary loaded and text analysed in ' + took + ' s');
  const words = await page.evaluate(() => Array.from(document.querySelectorAll('#passage .rb')).map((r) => r.firstChild.textContent + '=' + r.querySelector('.rt').textContent));
  ['令和=れいわ', '八日=ようか', '一本=いっぽん'].forEach((w) => ok(words.includes(w), 'reading ' + w));
  await page.locator('#read-back').click();
  ok(JSON.stringify(await cards(page)) === JSON.stringify(['令和のテスト', '片目のだるま']), 'the new text is listed above the sample');
  ok(await page.locator('#export-lib').isVisible(), 'Save a backup shows once there is a text');

  step('kept after a reload');
  await page.reload();
  await page.waitForSelector('#texts .text-card');
  ok(JSON.stringify(await cards(page)) === JSON.stringify(['令和のテスト', '片目のだるま']), 'the text is still listed after a reload');

  step('save a backup');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#export-lib').click()]);
  ok(/^yaoki-reader-backup-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename()), 'backup file name ' + dl.suggestedFilename());
  const saved = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  ok(saved.app === 'yaoki-reader' && saved.version === 1 && saved.texts.length === 1 && saved.texts[0].title === '令和のテスト', 'backup holds the one text');
  ok(/Saved 1 text/.test(await toastText(page)), 'a note says the backup was saved');

  step('load a backup: one new text, one already here, one empty entry');
  const fixture = await writeBackup([
    saved.texts[0],
    { title: '短い話', text: '駅の忘れ物センターには、毎日たくさんの傘が届く。', created: saved.texts[0].created + 1000, seen: [0, 2], n: 9, av: 5 },
    { title: '空', text: '   ' },
  ]);
  await page.setInputFiles('#import-file', fixture);
  ok(/Loaded 1 text\. 1 was already here\./.test(await toastText(page)), 'note: loaded 1, 1 already here');
  const order = await cards(page);
  ok(JSON.stringify(order) === JSON.stringify(['短い話', '令和のテスト', '片目のだるま']), 'library order after loading, newest first (' + order.join(', ') + ')');
  await page.locator('#texts .text-card').first().click();
  await page.waitForSelector('#passage .ph', { timeout: 60000 });
  const marks = await page.locator('#passage .ph.seen').count();
  ok(marks === 2, 'the loaded text keeps its looked-up marks (' + marks + ', title ' + (await page.locator('#read-title').innerText()) + ')');
  await page.locator('#read-back').click();
  await page.reload();
  await page.waitForSelector('#texts .text-card');
  ok((await cards(page)).length === 3, 'the loaded text is kept after a reload');

  step('a file that is not a backup');
  const bad = path.join(os.tmpdir(), 'not-a-backup.json');
  fs.writeFileSync(bad, '{"hello":"world"}');
  await page.setInputFiles('#import-file', bad);
  ok(/not a Yaoki Reader backup/.test(await toastText(page)), 'it is refused with a note');
  ok((await cards(page)).length === 3, 'the library is unchanged');

  if (process.env.BACKUP) {
    step('the backup file given in BACKUP');
    const real = JSON.parse(fs.readFileSync(process.env.BACKUP, 'utf8'));
    await page.setInputFiles('#import-file', process.env.BACKUP);
    console.log('  note: ' + (await toastText(page)));
    for (const t of real.texts) {
      await page.locator('#texts .text-card', { hasText: t.title }).first().click();
      await page.waitForSelector('#passage .ph', { timeout: 120000 });
      const n = await page.locator('#passage .ph').count();
      const same = await page.evaluate((src) => {
        const strip = (s) => s.replace(/\s+/g, '');
        let o = '';
        document.querySelectorAll('#passage p').forEach((p) => { const c = p.cloneNode(true); c.querySelectorAll('.rt').forEach((r) => r.remove()); o += c.textContent; });
        return strip(o) === strip(src);
      }, t.text);
      ok(same, t.title + ': ' + t.text.length + ' characters, ' + n + ' phrases, shown text matches the backup');
      if (t.title === '始末書') await page.screenshot({ path: path.join(out, 'reader-shimatsusho.png') });
      await page.locator('#read-back').click();
    }
  }

  step('offline: the page and the dictionary come from the device');
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('#texts .text-card');
  ok((await cards(page)).length === 3, 'the reader opens with no connection, texts and all');
  await page.locator('#go-add').click();
  await page.fill('#add-text', '雨の日は、家で本を読むのが好きだ。');
  await page.locator('#add-go').click();
  await page.waitForSelector('#passage .ph', { timeout: 120000 });
  ok(await page.locator('#passage .ph').count() > 3, 'a new text is analysed offline with the kept dictionary');
  await page.locator('#read-back').click();
  await ctx.setOffline(false);

  await page.goto(READER);
  await page.waitForSelector('#texts .text-card');
  await page.screenshot({ path: path.join(out, 'reader-library.png') });

  ok(logs.length === 0, 'no page errors' + (logs.length ? ': ' + logs.join(' | ') : ''));
  await browser.close();
  console.log(fails ? fails + ' problem(s)' : 'PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('STEP FAILED: ' + (e && e.stack || e)); process.exit(1); });
