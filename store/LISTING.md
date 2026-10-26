# Yaoki Reader: store listing text

The same text for every store, cut to each one's limits (noted beside each field). Paste as is. What each store needs, and in what order, is at the end.

## Name

Yaoki Reader (Chrome and Edge read it from the manifest's `name`, which cannot be edited in their dashboards: to change it, change the manifest, raise `version`, upload again.)

## Summary (one line)

Touch a Japanese word on any page and hold it to see its reading over the kanji and each word's meaning; let go and it hides.

(The manifest's `description`, which is what Chrome shows under the title, 132 characters at most, and what Edge shows as the short description; Firefox and the App Store take the same line typed in. Like the name, it is changed only through the manifest.)

## Description

Read Japanese on the web the way you would with a teacher beside you: touch a word and keep your finger on it. Its reading appears over the kanji in the page, the phrase is marked, and a card shows what each word means and any grammar pattern in it (〜ながら, 〜ません and the like). Slide your finger to the next word; lift it and everything hides again. A swipe still scrolls and a tap still follows a link.

With a mouse, hold the button down on a word, or hold Shift and point; Esc puts the card away, and a keyboard shortcut (Alt+Shift+Y at first) switches it on and off.

What a touch shows is up to you: furigana, word meanings, the grammar note, the word's other senses, each with its own switch, and the text size; the dictionary form of an inflected word (行く for 行きません) comes with the meaning. On a dark page the card is dark too. The words you look up go on a list (のぞいた語句, as in the app) with the sentence each was in, to look over later or save for Anki; a switch turns the list off, and it never leaves your device. A page's own furigana decide readings where the page has them. Chinese pages are left alone.

Everything is worked out on your device, from a dictionary carried inside the extension (JMdict for words, KANJIDIC2 for kanji, kuromoji.js for splitting sentences into words). Nothing you read is sent anywhere, and the extension makes no network requests at all. Switch it off for a site, or everywhere, from its toolbar panel.

A touch never shows a whole-sentence translation. You get the pieces and put the sentence together yourself. That is the point.

Yaoki Reader is the companion of the Yaoki Reader app (https://jorycook.github.io/Yaoki-reader/), which reads texts you paste and works from Aozora Bunko, and shares its look and its engine.

## Category

Chrome Web Store: Education (under Productivity), language English. Edge Add-ons: Productivity (its list has no Education; Accessibility or Search tools otherwise; check the dropdown at submission). Firefox: Language Support (or Search Tools). App Store: Education, secondary Reference.

## Links (the dashboards' optional fields)

Homepage: https://jorycook.github.io/Yaoki-reader/ (also the manifest's `homepage_url`). Support: https://github.com/jorycook/Yaoki-reader/issues. Privacy statement: https://jorycook.github.io/Yaoki-reader/privacy.html (give it even where nothing is collected; it saves a reviewer's question). Mature content: no.

## Keywords (App Store, 100 characters)

japanese,furigana,dictionary,reading,kanji,学習,日本語,jmdict,yomi,translation

## Single purpose (Chrome's privacy practices tab)

Shows the reading and meaning of the Japanese word the user touches or points at on a web page.

## Permission justifications (Chrome's privacy practices tab)

- Host permission on all sites (content script): the extension must run on whatever page the user is reading, to find the word under the finger and draw its reading and card above the page. It reads the sentence around the touched word only when the user touches it, and sends it to no one.
- storage: keeps the user's settings (on or off, sites switched off, what a touch shows, hold length) in the browser's extension storage.
- offscreen: keeps the dictionary (about 40 MB, several seconds to load) loaded in an offscreen document shared by all tabs, so that lookups answer at once. Reason: WORKERS.

## Remote code

None ("No, I am not using remote code"). All code and data is in the package. No scripts, modules or WebAssembly are loaded from the web, and no data is fetched: engine/worker.js's importScripts() and kuromoji.js's XMLHttpRequest load only files inside the package (engine/*.js, engine/dict/*). The dictionary files (engine/dict/*.dat.gz, engine/jm-index.bin.gz; unpacked .dat and .bin in the Edge build) are data, not code.

## Data use (Chrome's certification, Apple's App Privacy)

No data collected: tick none of the data-type boxes, and tick all three certifications (not sold, used only for the single purpose, not used for creditworthiness or lending), which are compulsory; the listing then says "The developer has disclosed that it will not collect or use your data". Apple: "Data Not Collected". The list of looked-up words is kept on the device at the user's choice and never transmitted, which Chrome's policy counts as local handling of website content: say so in the privacy statement (done) and keep the in-panel line "nothing you read is sent anywhere".

## Trader declaration (Chrome, EU)

Non-trader: a free personal project outside any trade or profession, nothing sold. Say the same on Edge and Firefox.

## Test instructions (Chrome's optional tab; Edge's notes for certification)

Open a page with Japanese text on it (for example https://jorycook.github.io/Yaoki-reader/ and the sample text there, or any Japanese news page). The first time, the dictionary loads for a few seconds (the toolbar panel shows "Dictionary: loading"). Then hold the mouse button down on a Japanese word for a quarter of a second, or hold Shift and point at one; on a touch screen, touch a word and keep your finger on it. The word's reading appears over the kanji, the phrase is marked, and a card above it shows each word's meaning. Let go and it hides. No account, no sign-in, no network.

## Notes to the reviewer (Firefox; also useful elsewhere)

The package is 29 MB because it carries its dictionary: a shortened JMdict word list (engine/jm-1.txt, jm-2.txt, jm-3.txt; CC BY-SA 4.0), KANJIDIC2 kanji meanings (engine/kanji.txt), the MeCab IPA dictionary for the kuromoji.js tokenizer (engine/dict/*.dat.gz, gzip binary, unpacked by the browser's DecompressionStream) and the engine's word index made ahead of time (engine/jm-index.bin.gz). Licences and credits are in licenses.txt, linked from the toolbar panel.

engine/kuromoji.js is the browser build of the kuromoji 0.1.2 package on npm (build/kuromoji.js), Apache-2.0, changed in three places, each marked "Reader patch" in the file: the dictionary loader (reads gzip binary or base64 text, unpacks with DecompressionStream where there is one), and the target map (kept as typed arrays). The exact changes are tools/kuromoji/reader.patch in the source; tools/kuromoji/patch.sh check fetches the published build, applies the patch and confirms the file is byte for byte the same. The build bundles the libraries async, doublearray and zlibjs (MIT), unchanged.

No other code is minified, transpiled or bundled: the extension's own files (content.js, background.js, host.js, popup.js, engine/analyzer.js, engine/boot.js, engine/worker.js) are the source as written.

To build the package from source: `python3 tools/extension.py` in the repository (Python 3 and Node), which writes dist/yaoki-reader-firefox.zip. The dictionary files are made from docs/engine/dict/*.b64.txt (the same data as base64 text) and the index by tools/jm-index.js from the word list; check/dict-test.js shows both give the same tokens and analyses as the reader's own files.

The list of looked-up words (storage.local key 'looked') is written only by background.js from the content script's 'yaoki:keep' messages and read by popup.js and list.html; it is never synced or sent. The extension makes no network requests. The content script runs on all sites because the user may read Japanese anywhere; it does nothing until a touch, hold or Shift+point on Japanese text.

The Firefox build is Manifest V2 with a persistent background page because the engine takes seconds to load and holds about 200 MB; an event page would be closed after 30 s idle and reloaded at every lookup. data_collection_permissions: none.

## What's new (version 1.0.0)

First release.

## Each store, in order

Chrome first: Edge takes the same text, and the App Store and Firefox the same statement.

1. **Chrome Web Store.** A Google account kept for good (its address cannot be changed later), 2-step verification on, the one-time US$5 fee, a verified contact address, the non-trader declaration. Upload `dist/yaoki-reader-chrome.zip`. Store listing: the description above, Education, the icon from the package (128 px), three to five screenshots of 1280×800 (`store/screenshots/desktop-*.png`), the small promo tile `store/promo/small-440x280.png` (listings without one come after those with), the marquee tile if wanted. Privacy practices: single purpose, the three justifications, "No" to remote code, no data collected, the privacy statement's address. Distribution: public, all regions, free. A first review with access to all sites and a new account can take one to three weeks.
2. **Edge Add-ons.** A Microsoft or GitHub account, no fee; Partner Center, Individual. Upload `dist/yaoki-reader-edge.zip`, never the Chrome one: Edge's store refuses a package holding packed files, so the Edge build carries its dictionary unpacked (29.7 MB zip). Name and short description come from the manifest. Properties: Productivity; the privacy statement's address; the same justifications. The listing must not name other browsers (the manifest and this text do not). Certification takes up to seven working days.
3. **Firefox (addons.mozilla.org).** See "Notes to the reviewer". Listed, or unlisted for a signed file of your own. `dist/yaoki-reader-firefox.zip`, with the source as the notes say.
4. **Safari (App Store Connect).** The Safari Web Extension Packager takes `dist/yaoki-reader-safari.zip`; the app icon is `store/icons/app-icon-1024.png`; "Data Not Collected"; the privacy statement's address is required for every app.
