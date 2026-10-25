// Makes the engine's word index ahead of time for the browser extension (engine/jm-index.bin.gz in each build),
// so the engine does not make it at each start. It is made by the engine's own code (packIndex in analyzer.js)
// from the word list in docs/engine, and names the lines it was made from: an engine given other lines makes its own.
// usage: node tools/jm-index.js <output file>   (tools/extension.py runs it)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const ENG = path.join(__dirname, '..', 'docs', 'engine');
globalThis.self = globalThis;
vm.runInThisContext(fs.readFileSync(path.join(ENG, 'analyzer.js'), 'utf8'), { filename: 'analyzer.js' });
/* the lines as the engine reads them (boot.js): each file split at its line ends, one after another */
const lines = [].concat(...['jm-1.txt', 'jm-2.txt', 'jm-3.txt'].map((name) => fs.readFileSync(path.join(ENG, name), 'utf8').split('\n')));
const buf = Buffer.from(globalThis.YomuEngine.packIndex(lines));
const gz = zlib.gzipSync(buf, { level: 9 });
gz.writeUInt32LE(0, 4);   /* no time in the gzip header, so the same lines make the same file */
fs.writeFileSync(process.argv[2], gz);
console.log(`word index: ${(buf.length / 1e6).toFixed(1)} MB, ${(gz.length / 1e6).toFixed(1)} MB packed`);
