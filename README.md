# Yaoki Reader

Read Japanese with the furigana hidden. Touch a phrase and hold it to see its reading, the meaning of each word and any grammar pattern in it; let go and it hides again. It is the companion to the [Yaoki JLPT app](https://jorycook.github.io/Yaoki/) and shares its look: the same colours, typefaces, stamp-card style and daruma.

Open it at **https://jorycook.github.io/Yaoki-reader/**. On an iPhone: open the address in Safari, tap Share, then Add to Home Screen.

The same touch works on any Japanese web page with the **browser extension** in `extension/` (Chrome, Edge, Firefox, Firefox for Android, Safari): see [On any web page](#on-any-web-page-the-browser-extension).

## What it does

- **Your own texts.** Paste up to 30,000 characters of Japanese. Readings, meanings and grammar notes are worked out in the browser; nothing is sent anywhere.
- **Aozora Bunko.** **From Aozora Bunko** finds a work out of copyright by title or author (kanji, kana, roman letters, or the address of its Aozora page) and adds it. Modern spelling (新字新仮名) is shown unless that box is cleared, since readings are often wrong for old spelling. A long work is cut into parts at its chapter headings (about 12,000 characters, never over 30,000); each part is a text of its own, such as 吾輩は猫である（1/21）.
- **Saving.** Texts are kept in the browser they were added in (`localStorage`, keys starting `yomu.`; analyses in IndexedDB `yomu-reader`). **Save a backup** and **Load a backup** carry the library to another device or browser.
- **Words the dictionary does not have as written.** Names get their reading in roman letters and "(probably a name)" (犍陀多 → Kandata), katakana names "(foreign name or word)"; sound words are looked up in kana and with と (ドッと, モグモグ); older spellings are understood (ゐる, 思ふ, 帰つて, ストオヴ, 顫える, 気もち); a compound only known in pieces is glossed piece by piece; a kanji no word explains shows its own meaning, from KANJIDIC2. Works from Aozora Bunko keep the author's furigana, which decide readings and names.
- **Common words written in kana.** Which word a kana spelling stands for (あたり is 辺り, not 当たり) and a gloss of its usual senses (もう "already; (no) more; one more; soon") come, for about 250 common words, from checking the reader's choices against sentences of thirty works; the rest from how JMdict marks words usually written in kana.
- **Offline.** After the first visit the page opens without a connection. The dictionary (about 40 MB) is downloaded the first time a text is analysed and then kept on the device, so later texts are analysed offline too.

### Where Aozora texts come from

Aozora Bunko's own site does not let other web pages fetch its files, so the reader fetches a work's text from aozorahack's copy of Aozora's text files on GitHub (`raw.githubusercontent.com/aozorahack/aozorabunko_text`), which does. That copy stopped following Aozora around 2023 (in a sample, 56 of 60 listed works were in it). For a work that is missing, the page links to the work's zip file on Aozora Bunko and reads that file once it is loaded; it need not be unpacked, and a .txt works too. **Load an Aozora Bunko file** takes such a file at any time. Ruby, notes and the source notes at the end are taken out, and characters that Aozora's Shift_JIS files can only describe (※［＃…、第3水準1-85-25］) are filled in.

## On any web page: the browser extension

`extension/` is Yaoki Reader for every site, not only for texts added to the reader. On a Japanese page, **touch a word and keep your finger on it**: its reading shows over the kanji in the page, the phrase is marked, and the reader's card shows above it with the meaning of each word and any grammar pattern. Slide to the next word without lifting your finger; lift it and everything hides again. A quick swipe still scrolls and a tap still follows a link; holding a link shows the word and does not open it. With a mouse, **hold the button down** on a word (still, for a quarter of a second), or **hold Shift and point**.

It is the reader's own engine, run once in the background for all tabs, so readings and meanings are the reader's, worked out on the device; nothing a page says is sent anywhere. The dictionary loads (in about a second on a computer, a few on a phone) when a page with Japanese on it opens, when such a tab comes back on screen, or when a finger lands on Japanese with the dictionary not loaded; it is let go after half an hour unused, and Safari lets it go sooner, to save memory. A page's own furigana (`<ruby>`) decide readings, as Aozora's do in the reader. Kanji with no kana near them on a page not marked Japanese are taken for Chinese and left alone.

The toolbar button opens a panel: switch it off everywhere or for one site, choose what a touch shows (furigana, word meanings, grammar note: the reader's three switches) and how long a hold takes (short, normal, long).

### Building and installing it

```
python3 tools/extension.py           # builds dist/chrome, dist/firefox, dist/safari and a zip of each
```

It needs Python 3 and Node (Node makes the word index; without it the builds go without the index and the engine makes its own at each start, a second or more slower). The packed dictionary and the index are kept in `dist/` (`dist/dict`, `dist/jm-index.bin.gz`, each with a `.from` fingerprint of its sources) and made again only when those sources change.

The engine and dictionary are the reader's (`docs/engine/`), copied in by the build, so there is one copy of them in the repository. Two parts are packed for the extension as they are copied, so the engine starts in under a second on a computer (three times faster than the reader's files allow, and holding about 60 MB less): the tokenizer's dictionary as gzip binary without its padding, which the browser unpacks itself, and the engine's word index made ahead of time (`tools/jm-index.js`, by the engine's own code), which the engine would otherwise make at each start. Each zip is about 29 MB.

- **Chrome, Edge, Brave, Vivaldi on a computer:** open `chrome://extensions`, switch on Developer mode, **Load unpacked**, and pick `dist/chrome`. `dist/yaoki-reader-chrome.zip` is what the Chrome Web Store and Edge Add-ons take. Chrome for Android has no extensions; Vivaldi for Android (8.2 and later) installs them from the Chrome Web Store, and so do some smaller Android browsers.
- **Firefox on a computer:** `about:debugging` → This Firefox → **Load Temporary Add-on** → `dist/firefox/manifest.json` (it stays until Firefox closes). To keep it, upload `dist/yaoki-reader-firefox.zip` to addons.mozilla.org, listed or unlisted (just for yourself), which signs it.
- **Firefox for Android:** install the signed add-on from addons.mozilla.org, or from its signed file. While working on it, `web-ext run -t firefox-android` runs `dist/firefox` on a phone connected by USB.
- **Safari on iPhone, iPad and Mac:** Safari takes extensions only inside an app. On a Mac with Xcode, `xcrun safari-web-extension-packager dist/safari` (formerly `safari-web-extension-converter`) makes the Xcode project; build it to your iPhone, then switch the extension on in Settings → Apps → Safari → Extensions and allow it on all websites. Without a Mac, App Store Connect's Safari Web Extension Packager takes `dist/yaoki-reader-safari.zip` and builds the app for TestFlight. Either way needs an Apple developer account.

The three builds differ only where the browsers do. Chrome's background is a service worker, which cannot hold the engine, so the engine runs in an offscreen document (`host.html`), which Chrome keeps open. Firefox closes a Manifest V3 background page after 30 seconds idle, so its build is Manifest V2 with a background page that stays loaded. iPhone allows only a background page that Safari closes when idle, so in the Safari build pages with Japanese on them wake it every 20 seconds for a quarter of an hour after a lookup; Safari before 18.4 also needs the scripts marked as UTF-8, which the build does.

**Limits.** On iPhone, Safari decides when a finger lands whether a long press will select text, so the touched text is made unselectable at once; if Safari still shows its magnifier on some page, that is Safari's own long press, which a page cannot always stop. Text in images, canvases and form fields is not read. A page inside a frame gets its own card, inside the frame.

## What is where

The site is `docs/`, served by GitHub Pages (Settings → Pages → Deploy from a branch, `main`, folder `/docs`). It has no build step: these files are its source.

| File | What it is |
|---|---|
| `docs/index.html` | The whole page: library, add form, Aozora Bunko, reader, settings, backups. |
| `docs/sw.js` | The offline copy: the page and the engine's scripts fresh from the network when there is one, the dictionary kept on the device. If the dictionary's files are ever replaced, change `ENGINE` in it. |
| `docs/manifest.webmanifest`, `docs/icons/` | Home-screen name and icons (Yaoki's daruma on the reader's blue, drawn by `tools/icons.mjs`). |
| `docs/engine/analyzer.js` | Phrases, readings, glosses and grammar notes (analysis version 6). Texts analysed by an earlier version are analysed again when next opened. Besides the tokenizer's words it mends what the tokenizer gets wrong (unknown kanji, old spellings, runs of hiragana), reads Aozora's furigana, and has a chain of fallbacks for words the dictionary lacks. `KANA` and `GLOSS` near the top hold the choices for common words written in kana, checked against real texts. |
| `docs/engine/kuromoji.js`, `engine/dict/` | kuromoji.js 0.1.2 and the IPA dictionary, its loader changed to read the dictionary as base64 text (or, for the extension, as gzip binary), unpacked by the browser where it can, and its target map kept as numbers. |
| `docs/engine/jm-1.txt`, `jm-2.txt` | A shortened JMdict word list (2020 edition, from the `jamdict-data` 1.5 package). |
| `docs/engine/jm-3.txt` | The supplement from a newer JMdict: words added since 2020, more spellings of the list's words, how usual it is to write each word in kana. Made by `tools/jm-supplement.py`; after remaking it, change `SUPPLEMENT` in `sw.js`. |
| `docs/engine/kanji.txt` | English meanings of single kanji from KANJIDIC2, made by `tools/kanji-meanings.py`. |
| `docs/engine/worker.js`, `boot.js` | Runs the engine off the page's main thread. |
| `docs/aozora/aozora.js` | Aozora Bunko: searching the catalog, fetching a work, reading a .zip or .txt, taking out Aozora's notation, cutting long works into parts. |
| `docs/aozora/catalog.txt` | The 17,344 Aozora works out of copyright (titles, authors, file names; no texts), from Aozora's index of 2026-08-20. |
| `docs/aozora/jisx0213.json` | Characters by their JIS X 0213 place, for the ones Aozora's files describe. |
| `extension/content.js`, `content.css` | The extension on each page: the touch, mouse and Shift gestures; the character under the finger and the sentence around it (with the page's own ruby); the phrase it is in, from the engine; the readings over the kanji, the mark and the card, drawn in a layer of their own (a closed shadow root) so the page is not changed. |
| `extension/background.js`, `host.js`, `host.html`, `host-offscreen.js` | Pass lookups to the one engine for all tabs (`docs/engine/worker.js`) and keep it running: in Chrome's offscreen document (`host.html`), or in the background page in Firefox and Safari. |
| `extension/popup.html`, `popup.js`, `manifest.json`, `icons/` | The toolbar panel (settings kept in the browser's extension storage), the manifest the three builds are made from, and the icons (drawn by `tools/icons.mjs`). |
| `tools/` | `aozora-catalog.py` (remakes the catalog), `jm-supplement.py`, `kanji-meanings.py`, `jisx0213-table.py`, `icons.mjs`, `extension.py` (builds the extension into `dist/`), `jm-index.js` (the extension's word index made ahead of time). |
| `check/` | The tests (Playwright; Selenium for the extension in Firefox). |

To bring the catalog up to date with Aozora Bunko:

```
python3 tools/aozora-catalog.py      # downloads Aozora's index and rewrites docs/aozora/catalog.txt
```

## Tests

Needs Node and Playwright (point `NODE_PATH` at the Playwright install if it is not found by itself) and Python 3.

```
cd check
node engine-test.js           # the engine alone, in Node: readings and meanings that once went wrong
bash run.sh reader-test.js    # serves docs/ at /Yaoki-reader/ as GitHub Pages does: sample, adding a text, backups, offline
bash run.sh aozora-test.js    # Aozora Bunko: search, fetch, parts, a downloaded zip (the copy of Aozora's files is played by the test)
```

`BACKUP=<a reader backup file>` with `reader-test.js` also loads that file and opens every text in it.

The extension, built first by the tests themselves:

```
node extension-test.js        # Chromium with the extension: holding, sliding, letting go, swipes and links, mouse and Shift, ruby, vertical text, strict CSP, where the card goes, the panel
node dict-test.js             # the extension's packed dictionary and word index against the reader's: the same tokens and analyses (two minutes)
FIREFOX=<firefox> GECKODRIVER=<geckodriver> python3 extension-firefox-test.py   # the Firefox build in Firefox (needs Selenium and Pillow)
```

## Licences

Listed in `docs/licenses.txt`: Aozora Bunko (the catalog, and where the texts come from), JMdict and KANJIDIC2 (EDRDG, CC BY-SA 4.0; the shortened word list, its supplement and the kanji meanings under the same licence), kuromoji.js (Apache-2.0, with the mecab-ipadic notice) and the typefaces loaded from Google Fonts (SIL Open Font License 1.1). Each build of the extension carries the same `licenses.txt`, linked from its panel (it loads no typefaces from the web). Only add texts you are free to keep a copy of; nothing you add goes into this repository.
