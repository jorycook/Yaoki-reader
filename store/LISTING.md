# Yaoki Reader: store listing text

The same text for every store, cut to each one's limits (noted beside each field). Paste as is.

## Name

Yaoki Reader

## Summary (one line; Chrome 132 characters, Firefox 250, Edge 250)

Touch a Japanese word on any page and hold it to see its reading and meaning. Readings over the kanji, a card with each word's meaning; let go and it hides.

## Description

Read Japanese on the web the way you would with a teacher beside you: touch a word and keep your finger on it. Its reading appears over the kanji in the page, the phrase is marked, and a card shows what each word means and any grammar pattern in it (〜ながら, 〜ません and the like). Slide your finger to the next word; lift it and everything hides again. A swipe still scrolls and a tap still follows a link.

With a mouse, hold the button down on a word, or hold Shift and point.

What a touch shows is up to you: furigana, word meanings, the grammar note, each with its own switch; the dictionary form of an inflected word (行く for 行きません) comes with the meaning. The words you look up go on a list (のぞいた語句, as in the app) with the sentence each was in, to look over later or save for Anki; a switch turns the list off, and it never leaves your device. A page's own furigana decide readings where the page has them. Chinese pages are left alone.

Everything is worked out on your device, from a dictionary carried inside the extension (JMdict for words, KANJIDIC2 for kanji, kuromoji.js for splitting sentences into words). Nothing you read is sent anywhere, and the extension makes no network requests at all. Switch it off for a site, or everywhere, from its toolbar panel.

A touch never shows a whole-sentence translation. You get the pieces and put the sentence together yourself. That is the point.

Yaoki Reader is the companion of the Yaoki Reader app (https://jorycook.github.io/Yaoki-reader/), which reads texts you paste and works from Aozora Bunko, and shares its look and its engine.

## Category

Chrome Web Store: Education (or Tools). Edge Add-ons: Education. Firefox: Language Support (or Search Tools). App Store: Education, secondary Reference.

## Keywords (App Store, 100 characters)

japanese,furigana,dictionary,reading,kanji,学習,日本語,jmdict,yomi,translation

## Single purpose (Chrome's privacy practices tab)

Shows the reading and meaning of the Japanese word the user touches or points at on a web page.

## Permission justifications (Chrome's privacy practices tab)

- Host permission on all sites (content script): the extension must run on whatever page the user is reading, to find the word under the finger and draw its reading and card above the page. It reads the sentence around the touched word only when the user touches it, and sends it to no one.
- storage: keeps the user's settings (on or off, sites switched off, what a touch shows, hold length) in the browser's extension storage.
- offscreen: keeps the dictionary (about 40 MB, several seconds to load) loaded in an offscreen document shared by all tabs, so that lookups answer at once. Reason: WORKERS.

## Remote code

None. All code and data is in the package. No scripts, modules or WebAssembly are loaded from the web, and no data is fetched.

## Data use (Chrome's certification, Apple's App Privacy)

No data collected. No personal communications, financial, health, location, authentication, personal, or web-history data is collected, transmitted or sold. Apple: "Data Not Collected".

## Notes to the reviewer (Firefox; also useful elsewhere)

The package is 29 MB because it carries its dictionary: a shortened JMdict word list (engine/jm-1.txt, jm-2.txt, jm-3.txt; CC BY-SA 4.0), KANJIDIC2 kanji meanings (engine/kanji.txt), the MeCab IPA dictionary for the kuromoji.js tokenizer (engine/dict/*.dat.gz, gzip binary, unpacked by the browser's DecompressionStream) and the engine's word index made ahead of time (engine/jm-index.bin.gz). Licences and credits are in licenses.txt, linked from the toolbar panel.

engine/kuromoji.js is the browser build of the kuromoji 0.1.2 package on npm (build/kuromoji.js), Apache-2.0, changed in three places, each marked "Reader patch" in the file: the dictionary loader (reads gzip binary or base64 text, unpacks with DecompressionStream where there is one), and the target map (kept as typed arrays). The exact changes are tools/kuromoji/reader.patch in the source; tools/kuromoji/patch.sh check fetches the published build, applies the patch and confirms the file is byte for byte the same. The build bundles the libraries async, doublearray and zlibjs (MIT), unchanged.

No other code is minified, transpiled or bundled: the extension's own files (content.js, background.js, host.js, popup.js, engine/analyzer.js, engine/boot.js, engine/worker.js) are the source as written.

To build the package from source: `python3 tools/extension.py` in the repository (Python 3 and Node), which writes dist/yaoki-reader-firefox.zip. The dictionary files are made from docs/engine/dict/*.b64.txt (the same data as base64 text) and the index by tools/jm-index.js from the word list; check/dict-test.js shows both give the same tokens and analyses as the reader's own files.

The list of looked-up words (storage.local key 'looked') is written only by background.js from the content script's 'yaoki:keep' messages and read by popup.js and list.html; it is never synced or sent. The extension makes no network requests. The content script runs on all sites because the user may read Japanese anywhere; it does nothing until a touch, hold or Shift+point on Japanese text.

The Firefox build is Manifest V2 with a persistent background page because the engine takes seconds to load and holds about 200 MB; an event page would be closed after 30 s idle and reloaded at every lookup. data_collection_permissions: none.

## What's new (version 1.0.0)

First release.
