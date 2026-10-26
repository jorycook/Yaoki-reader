# Building the Firefox package from this source

For addons.mozilla.org's reviewers: how `yaoki-reader-firefox.zip` is made from this source, byte for byte.

## Tools

- Python 3.12 or later (the build script; no packages beyond the standard library)
- Node 22 (makes the engine's word index ahead of time; `npm` fetches the original kuromoji.js for the check below)

`TOOL-VERSIONS.txt` at the top of this archive says which versions made the submitted package.

## Build

```
python3 tools/extension.py
```

writes `dist/yaoki-reader-firefox.zip` (and the Chrome, Edge and Safari packages beside it). The zips are reproducible: every entry carries the same date and the files go in one order, so a build of the same commit gives the same bytes. `sha256sum dist/yaoki-reader-firefox.zip` can be compared with the submitted package.

What the build does, all of it in `tools/extension.py`:

1. Copies the extension's own files from `extension/` as they are. None of them is minified, transpiled or bundled: `background.js`, `host.js`, `content.js`, `popup.js`, `list.js`, `welcome.html`, `popup.html`, `list.html`, `content.css` are the source.
2. Copies the engine from `docs/engine/` (shared with the Yaoki Reader web app in `docs/`): `analyzer.js`, `boot.js`, `worker.js` (source as written), `kuromoji.js` (see below), the word list `jm-1.txt`, `jm-2.txt`, `jm-3.txt` and `kanji.txt` (data).
3. Packs the tokenizer's dictionary: `docs/engine/dict/*.dat.b64.txt` (the IPA dictionary as base64 text, as the web app serves it) becomes `engine/dict/*.dat.gz` (the same bytes as gzip binary, without the zeros that pad the files). The browser unpacks them with `DecompressionStream`.
4. Makes the engine's word index ahead of time: `node tools/jm-index.js` runs the engine's own `packIndex` (in `analyzer.js`) over the word list and writes `engine/jm-index.bin.gz`. The engine checks that the index was made from the very lines it has, and otherwise makes its own.
5. Writes the Firefox manifest: Manifest V2, a persistent background page (the engine takes seconds to load and holds about 200 MB; an event page would be closed after 30 s idle), `browser_specific_settings` with the fixed id, `data_collection_permissions: none`, and `gecko_android`.

## kuromoji.js

`engine/kuromoji.js` is `build/kuromoji.js` of the kuromoji 0.1.2 package on npm (https://registry.npmjs.org/kuromoji/-/kuromoji-0.1.2.tgz; Apache-2.0; a browserify bundle of the library with async, doublearray and zlibjs), changed in three places, each marked `Reader patch` in the file: the dictionary loader reads gzip binary or base64 text and unpacks it with the browser's `DecompressionStream` where there is one, and the target map is kept as typed arrays instead of an object of 300,000 small arrays. The exact change is `tools/kuromoji/reader.patch`, and

```
tools/kuromoji/patch.sh check
```

fetches the published build with `npm pack`, applies the patch and confirms the file in this source is byte for byte the result. Nothing else in the package comes from a third party's code.

## Checks

```
cd check
node engine-test.js       # the engine's readings and meanings
node dict-test.js         # the packed dictionary and the index give the same tokens and analyses as the web app's files
```

The extension makes no network requests; nothing a page says leaves the device.
