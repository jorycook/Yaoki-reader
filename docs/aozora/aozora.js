/* Aozora Bunko (青空文庫) works for the reader: the catalog, fetching a work, reading a downloaded file,
   turning Aozora's text notation into plain text, and cutting long works into parts.

   Where the text comes from. www.aozora.gr.jp does not let other web pages fetch its files, so a work is
   fetched from aozorahack's copy of the Aozora text files on GitHub, which does. That copy stopped
   following Aozora at some point (works added or corrected since are missing from it), so when a work is
   not there the page offers Aozora's own download of the work (a .zip), which this file can read.
   Only the catalog is part of this site (aozora/catalog.txt, made by tools/aozora-catalog.py);
   no text of a work is. */
(function (root) {
'use strict';

var AOZORA = 'https://www.aozora.gr.jp/cards/';
var MIRRORS = ['https://raw.githubusercontent.com/aozorahack/aozorabunko_text/master/cards/'];
var KINDS = ['新字新仮名', '新字旧仮名', '旧字旧仮名', '旧字新仮名', 'その他'];

function pad6(n) { n = String(n); while (n.length < 6) n = '0' + n; return n; }
function base(w) { return w.id + '_' + w.file; }
function zipUrl(w) { return AOZORA + pad6(w.folder) + '/files/' + base(w) + '.zip'; }
function cardUrl(w) { return AOZORA + pad6(w.folder) + '/card' + w.id + '.html'; }
function mirrorUrls(w) { return MIRRORS.map(function (m) { return m + pad6(w.folder) + '/files/' + base(w) + '/' + base(w) + '.txt'; }); }

/* ---------- catalog ---------- */
function parseCatalog(text) {
  var lines = text.split('\n'), cat = { date: '', authors: [], works: [], byId: {} };
  lines.forEach(function (line) {
    if (!line) return;
    var c = line.split('\t');
    if (c[0] === '#aozora') { cat.date = c[1] || ''; return; }
    if (c[0] === '@') { cat.authors.push({ name: c[1], yomi: c[2], roman: c[3] }); return; }
    if (c.length < 9) return;
    var w = { id: +c[0], folder: +c[1], file: c[2], title: c[3], sub: c[4], yomi: c[5],
      authors: c[6] ? c[6].split(',').map(Number) : [], trans: c[7], kind: +c[8] || 0 };
    cat.works.push(w);
    cat.byId[w.id] = w;
  });
  cat.works.forEach(function (w) {
    var a = w.authors.map(function (i) { return cat.authors[i] || { name: '', yomi: '', roman: '' }; });
    w.by = a.map(function (x) { return x.name; }).join('・');
    /* everything a search looks in, folded the way a query is folded */
    w.akey = fold(a.map(function (x) { return x.name + ' ' + x.yomi + ' ' + x.roman; }).join(' '));
    w.key = fold([w.title, w.sub, w.yomi, w.trans].join(' ')) + ' ' + w.akey;
    w.tkey = fold(w.title + ' ' + w.yomi);
  });
  return cat;
}
/* full-width to half-width, lower case, katakana to hiragana, long vowels in roman letters dropped */
function fold(s) {
  return String(s || '').normalize('NFKC').toLowerCase()
    .replace(/[ァ-ヶ]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0x60); })
    .replace(/[āâ]/g, 'a').replace(/[īî]/g, 'i').replace(/[ūû]/g, 'u').replace(/[ēê]/g, 'e').replace(/[ōô]/g, 'o')
    .replace(/[・･\s]+/g, ' ');
}
/* an Aozora address pasted into the search box: a card (card92.html) or a file (92_ruby_164.zip) */
function idFromUrl(q) {
  var m = /aozora\.gr\.jp\/cards\/\d+\/(?:card(\d+)\.html|files\/(\d+)_)/.exec(q);
  return m ? +(m[1] || m[2]) : 0;
}
function search(cat, query, opts) {
  opts = opts || {};
  var limit = opts.limit || 60;
  var id = idFromUrl(query);
  if (id) return { total: cat.byId[id] ? 1 : 0, works: cat.byId[id] ? [cat.byId[id]] : [], url: true };
  var q = fold(query).trim();
  if (!q) return { total: 0, works: [] };
  var terms = q.split(' ').filter(Boolean);
  /* roman letters also match without spaces and long vowels: "natsume soseki", "souseki" */
  function has(key, t) { return key.indexOf(t) >= 0 || (/^[a-z]+$/.test(t) && key.indexOf(t.replace(/ou/g, 'o').replace(/uu/g, 'u')) >= 0); }
  var hits = [];
  cat.works.forEach(function (w) {
    if (opts.modern && w.kind !== 0) return;
    for (var i = 0; i < terms.length; i++) if (!has(w.key, terms[i])) return;
    /* the title itself first, then works by the person searched for, then titles starting or holding it, then the rest */
    var title = fold(w.title);
    var score = w.tkey === q || title === q ? 0 : terms.every(function (t) { return has(w.akey, t); }) ? 1
      : title.indexOf(q) === 0 ? 2 : w.tkey.indexOf(q) >= 0 ? 3 : 4;
    hits.push({ w: w, s: score * 10 + (w.kind === 0 ? 0 : 1) });
  });
  hits.sort(function (a, b) { return a.s - b.s || (a.w.yomi < b.w.yomi ? -1 : a.w.yomi > b.w.yomi ? 1 : a.w.id - b.w.id); });
  return { total: hits.length, works: hits.slice(0, limit).map(function (h) { return h.w; }) };
}

/* ---------- bytes to text ---------- */
function decode(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) {}
  return new TextDecoder('shift_jis').decode(bytes);
}
function isZip(bytes) { return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04; }
/* the first .txt file in a zip (Aozora's downloads hold one text file, sometimes with pictures) */
function unzipText(bytes) {
  var v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  var eocd = -1;
  for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054B50) { eocd = i; break; }
  }
  if (eocd < 0) return Promise.reject(new Error('the zip file is damaged'));
  var count = v.getUint16(eocd + 10, true), p = v.getUint32(eocd + 16, true);
  for (var n = 0; n < count; n++) {
    if (p + 46 > bytes.length || v.getUint32(p, true) !== 0x02014B50) break;
    var method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    var nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), noteLen = v.getUint16(p + 32, true);
    var local = v.getUint32(p + 42, true);
    var name = bytes.subarray(p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + noteLen;
    var tail = String.fromCharCode.apply(null, Array.prototype.slice.call(name, -4)).toLowerCase();
    if (tail !== '.txt') continue;
    var start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    var data = bytes.subarray(start, start + size);
    if (method === 0) return Promise.resolve(data);
    if (method !== 8) return Promise.reject(new Error('the zip file uses a kind of compression this page cannot open'));
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('this browser cannot open zip files; unzip it and load the .txt file inside'));
    var stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  return Promise.reject(new Error('there is no text file in that zip'));
}
function bytesToText(bytes) {
  return (isZip(bytes) ? unzipText(bytes) : Promise.resolve(bytes)).then(decode);
}

/* ---------- Aozora notation to plain text ---------- */
var HEAD = /［＃[^］]*?(大|中)見出し(?:終わり)?］/;
var JISPLACE = /第[34]水準(\d)-(\d{1,2})-(\d{1,2})/;
function needsTable(raw) { return JISPLACE.test(raw); }
function cleanLine(s, jis) {
  return s
    /* characters Shift_JIS cannot hold, written ※［＃description、第3水準1-85-25］ or ［＃description、U+XXXX、…］.
       jis is the table in aozora/jisx0213.json; a character found in neither way stays as ※ */
    .replace(/※［＃[^］]*］/g, function (m) {
      var u = /U\+([0-9A-Fa-f]{4,6})/.exec(m);
      if (u) return String.fromCodePoint(parseInt(u[1], 16));
      var j = JISPLACE.exec(m);
      return (j && jis && jis[+j[1] + '-' + +j[2] + '-' + +j[3]]) || '※';
    })
    .replace(/［＃[^］]*］/g, '')
    /* ruby: 漢字《かんじ》, ｜一番獰悪《どうあく》 */
    .replace(/《[^》]*》/g, '').replace(/｜/g, '')
    /* repeat marks written across two characters */
    .replace(/／″＼/g, '〴〵').replace(/／＼/g, '〳〵')
    .replace(/\s+$/, '');
}
function parseText(raw, jis) {
  var lines = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  var i = 0, header = [];
  while (i < lines.length && lines[i].trim()) header.push(lines[i++].trim());
  while (i < lines.length && !lines[i].trim()) i++;
  /* the box that explains the notation, between two lines of dashes */
  if (i < lines.length && /^-{10,}/.test(lines[i])) {
    i++;
    while (i < lines.length && !/^-{10,}/.test(lines[i])) i++;
    i++;
  }
  var end = lines.length;
  for (var j = lines.length - 1; j >= i; j--) { if (/^底本[：:]/.test(lines[j])) { end = j; break; } }
  var out = [];
  for (; i < end; i++) {
    var src = lines[i];
    if (/［＃本文終わり］/.test(src)) break;
    var text = cleanLine(src, jis);
    if (!text.trim()) {
      /* a line that only held notes (indents, page breaks) leaves nothing; an empty line stays one */
      if (src.trim() && !/［＃改(?:ページ|丁|段|見開き)］/.test(src)) continue;
      if (out.length && out[out.length - 1].text === '' ) continue;
      out.push({ text: '' });
      continue;
    }
    var h = HEAD.exec(src);
    out.push(h ? { text: text.trim(), head: true } : { text: text });
  }
  while (out.length && !out[0].text) out.shift();
  while (out.length && !out[out.length - 1].text) out.pop();
  return { title: header[0] || '', author: header.slice(1).join(' '), lines: out };
}

/* ---------- long works in parts ---------- */
/* Parts break at chapter headings where there are any. Short chapters are put together up to about
   `target` characters; a chapter longer than `max` is broken between paragraphs. */
function splitParts(lines, target, max) {
  var sections = [], cur = null;
  lines.forEach(function (l) {
    if (!cur || (l.head && cur.lines.some(function (x) { return x.text && !x.head; }))) { cur = { lines: [], len: 0 }; sections.push(cur); }
    cur.lines.push(l); cur.len += l.text.length + 1;
  });
  var parts = [], part = null;
  function flush() { if (part && part.lines.length) parts.push(part); part = null; }
  function addLine(l) {
    if (!part) part = { lines: [], len: 0 };
    part.lines.push(l); part.len += l.text.length + 1;
  }
  sections.forEach(function (s) {
    if (part && part.len + s.len > target) flush();
    if (s.len <= max) { s.lines.forEach(addLine); return; }
    s.lines.forEach(function (l) {
      if (part && part.len + l.text.length + 1 > target) flush();
      if (l.text.length < target) { addLine(l); return; }
      /* one paragraph longer than a part: broken after a sentence */
      var chunk = '';
      (l.text.match(new RegExp('[^。]{1,' + (target - 1) + '}。?|[\\s\\S]{1,' + target + '}', 'g')) || []).forEach(function (t) {
        if (chunk && chunk.length + t.length > target) { addLine({ text: chunk }); flush(); chunk = ''; }
        chunk += t;
      });
      if (chunk) addLine({ text: chunk });
    });
  });
  flush();
  return parts.map(function (p) {
    var text = p.lines.map(function (l) { return l.text; }).join('\n').replace(/^\n+|\n+$/g, '');
    var head = p.lines.filter(function (l) { return l.head; })[0];
    var first = p.lines.filter(function (l) { return l.text.trim() && !l.head; })[0];
    return { text: text, head: head ? head.text : '', start: first ? first.text.trim().slice(0, 40) : '' };
  }).filter(function (p) { return p.text.trim(); });
}

/* ---------- fetching ---------- */
function fetchBytes(url) {
  return fetch(url, { credentials: 'omit' }).then(function (r) {
    if (!r.ok) { var e = new Error(r.status === 404 ? 'not there' : 'answered ' + r.status); e.status = r.status; throw e; }
    return r.arrayBuffer();
  }).then(function (b) { return new Uint8Array(b); });
}
/* resolves to { raw text, source address } or rejects with err.missing set when no source has the work */
function fetchWork(w) {
  var urls = mirrorUrls(w), i = 0, last = null;
  function next() {
    if (i >= urls.length) {
      var e = new Error(last && last.status === 404 ? 'the work is not in the copy this page can reach' : (last && last.message) || 'could not be fetched');
      e.missing = !!(last && last.status === 404);
      return Promise.reject(e);
    }
    var url = urls[i++];
    return fetchBytes(url).then(bytesToText).then(function (t) { return { raw: t, url: url }; }, function (err) { last = err; return next(); });
  }
  return next();
}

var api = {
  KINDS: KINDS, zipUrl: zipUrl, cardUrl: cardUrl, mirrorUrls: mirrorUrls,
  parseCatalog: parseCatalog, search: search, fold: fold,
  decode: decode, isZip: isZip, unzipText: unzipText, bytesToText: bytesToText,
  parseText: parseText, needsTable: needsTable, splitParts: splitParts, fetchWork: fetchWork,
};
root.YomuAozora = api;
if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
