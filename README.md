# Yaoki Reader

Read Japanese with the furigana hidden. Touch a phrase and hold it to see its reading, the meaning of each word and any grammar pattern in it; let go and it hides again. It is the companion to the [Yaoki JLPT app](https://jorycook.github.io/Yaoki/) and shares its look: the same colours, typefaces, stamp-card style and daruma.

Open it at **https://jorycook.github.io/Yaoki-reader/**. On an iPhone: open the address in Safari, tap Share, then Add to Home Screen.

## What it does

- **Your own texts.** Paste up to 30,000 characters of Japanese. Readings, meanings and grammar notes are worked out in the browser; nothing is sent anywhere.
- **Aozora Bunko.** **From Aozora Bunko** finds a work out of copyright by title or author (kanji, kana, roman letters, or the address of its Aozora page) and adds it. Modern spelling (新字新仮名) is shown unless that box is cleared, since readings are often wrong for old spelling. A long work is cut into parts at its chapter headings (about 12,000 characters, never over 30,000); each part is a text of its own, such as 吾輩は猫である（1/21）.
- **Saving.** Texts are kept in the browser they were added in (`localStorage`, keys starting `yomu.`; analyses in IndexedDB `yomu-reader`). **Save a backup** and **Load a backup** carry the library to another device or browser.
- **Offline.** After the first visit the page opens without a connection. The dictionary (about 36 MB) is downloaded the first time a text is analysed and then kept on the device, so later texts are analysed offline too.

### Where Aozora texts come from

Aozora Bunko's own site does not let other web pages fetch its files, so the reader fetches a work's text from aozorahack's copy of Aozora's text files on GitHub (`raw.githubusercontent.com/aozorahack/aozorabunko_text`), which does. That copy stopped following Aozora around 2023 (in a sample, 56 of 60 listed works were in it). For a work that is missing, the page links to the work's zip file on Aozora Bunko and reads that file once it is loaded; it need not be unpacked, and a .txt works too. **Load an Aozora Bunko file** takes such a file at any time. Ruby, notes and the source notes at the end are taken out, and characters that Aozora's Shift_JIS files can only describe (※［＃…、第3水準1-85-25］) are filled in.

## What is where

The site is `docs/`, served by GitHub Pages (Settings → Pages → Deploy from a branch, `main`, folder `/docs`). It has no build step: these files are its source.

| File | What it is |
|---|---|
| `docs/index.html` | The whole page: library, add form, Aozora Bunko, reader, settings, backups. |
| `docs/sw.js` | The offline copy: the page and the engine's scripts fresh from the network when there is one, the dictionary kept on the device. If the dictionary's files are ever replaced, change `ENGINE` in it. |
| `docs/manifest.webmanifest`, `docs/icons/` | Home-screen name and icons (Yaoki's daruma on the reader's blue, drawn by `tools/icons.mjs`). |
| `docs/engine/analyzer.js` | Phrases, readings, glosses and grammar notes (analysis version 5). Texts analysed by an earlier version are analysed again when next opened. |
| `docs/engine/kuromoji.js`, `engine/dict/` | kuromoji.js 0.1.2 and the IPA dictionary, its loader changed to read the dictionary as base64 text. |
| `docs/engine/jm-1.txt`, `jm-2.txt` | A shortened JMdict word list (2020 edition, from the `jamdict-data` 1.5 package). |
| `docs/engine/worker.js`, `boot.js` | Runs the engine off the page's main thread. |
| `docs/aozora/aozora.js` | Aozora Bunko: searching the catalog, fetching a work, reading a .zip or .txt, taking out Aozora's notation, cutting long works into parts. |
| `docs/aozora/catalog.txt` | The 17,344 Aozora works out of copyright (titles, authors, file names; no texts), from Aozora's index of 2026-08-20. |
| `docs/aozora/jisx0213.json` | Characters by their JIS X 0213 place, for the ones Aozora's files describe. |
| `tools/` | `aozora-catalog.py` (remakes the catalog), `jisx0213-table.py`, `icons.mjs`. |
| `check/` | The tests (Playwright). |

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

## Licences

Listed in `docs/licenses.txt`: Aozora Bunko (the catalog, and where the texts come from), JMdict (EDRDG, CC BY-SA 4.0, and the shortened word list under the same licence), kuromoji.js (Apache-2.0, with the mecab-ipadic notice) and the typefaces loaded from Google Fonts (SIL Open Font License 1.1). Only add texts you are free to keep a copy of; nothing you add goes into this repository.
