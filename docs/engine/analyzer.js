/* Reader engine: turns Japanese text into phrases with readings, word glosses and grammar notes.
   Needs a kuromoji tokenizer (IPADIC) and the compact JMdict lines. Runs in a worker, on the page, or in Node. */
(function (root) {
'use strict';

var VERSION = 5;
var KANJI = /[㐀-䶿一-鿿豈-﫿々〆]/;
var OPEN = '「『（(〈《【〔［[｛{“‘"\'';

function hira(s) {
  return s ? s.replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); }) : '';
}
function hasKanji(s) { return KANJI.test(s); }
function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function lemma(t) { return t.basic_form && t.basic_form !== '*' ? t.basic_form : t.surface_form; }

/* Split a token into [text, reading] pieces so furigana sits only over the kanji. */
function furi(surface, reading) {
  if (!reading || reading === '*' || !hasKanji(surface)) return [[surface, '']];
  var r = hira(reading);
  var runs = [], cur = '', curK = null;
  Array.from(surface).forEach(function (ch) {
    var k = KANJI.test(ch);
    if (curK === null || k === curK) cur += ch; else { runs.push([cur, curK]); cur = ch; }
    curK = k;
  });
  runs.push([cur, curK]);
  if (runs.length === 1) return [[surface, r]];
  var re = '^' + runs.map(function (x) { return x[1] ? '(.+?)' : '(' + esc(hira(x[0])) + ')'; }).join('') + '$';
  var m = new RegExp(re).exec(r);
  if (!m) return [[surface, r]];
  return runs.map(function (x, i) { return [x[0], x[1] ? m[i + 1] : '']; });
}

/* ---------- dictionary ---------- */

function Dict(lines) {
  this.lines = lines;
  var idx = new Map();
  function add(key, i) {
    if (!key) return;
    var v = idx.get(key);
    if (v === undefined) idx.set(key, i);
    else if (typeof v === 'number') idx.set(key, [v, i]);
    else v.push(i);
  }
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var a = line.indexOf('\t'), b = line.indexOf('\t', a + 1);
    if (a < 0 || b < 0) continue;
    if (a > 0) line.slice(0, a).split(';').forEach(function (k) { add(k, i); });
    line.slice(a + 1, b).split(';').forEach(function (k) { add(k, i); });
  }
  this.idx = idx;
  this.alt = null;
}
/* Older and looser writing leaves out the kana between kanji: 絶間 for 絶え間, 取扱 for 取り扱い, 申込 for
   申し込み. Those spellings are looked up under the dictionary's own when nothing else matches; they are
   built the first time one is needed. */
var INNER_KANA = new RegExp('(' + KANJI.source + ')[ぁ-ゖ]+(?=' + KANJI.source + ')', 'g');
var END_KANA = new RegExp('(' + KANJI.source + ')[ぁ-ゖ]+$');
Dict.prototype.alts = function () {
  if (this.alt) return this.alt;
  var alt = new Map(), idx = this.idx, lines = this.lines;
  function add(key, i) {
    if (idx.has(key)) return;
    var v = alt.get(key);
    if (v === undefined) alt.set(key, [i]); else if (v.indexOf(i) < 0) v.push(i);
  }
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i], a = line.indexOf('\t');
    if (a <= 0) continue;
    var noun = /\tn/.test(line) || /\|n/.test(line);
    line.slice(0, a).split(';').forEach(function (k) {
      var inner = k.replace(INNER_KANA, '$1');
      if (inner !== k) add(inner, i);
      /* a noun also loses the kana at its end (取扱い → 取扱), only once the inner kana are gone */
      if (noun && inner !== k && END_KANA.test(inner)) add(inner.replace(END_KANA, '$1'), i);
    });
  }
  return (this.alt = alt);
};
Dict.prototype.has = function (key) { return this.idx.has(key) || (hasKanji(key) && this.alts().has(key)); };
Dict.prototype.entries = function (key) {
  var v = this.idx.get(key), alt = false;
  if (v === undefined && hasKanji(key)) { v = this.alts().get(key); alt = true; }
  if (v === undefined) return [];
  var ids = typeof v === 'number' ? [v] : v;
  var lines = this.lines;
  return ids.map(function (i) {
    var p = lines[i].split('\t');
    var flags = p[2] || '0';
    return {
      k: p[0] ? p[0].split(';') : [],
      r: p[1].split(';'),
      rank: +flags.charAt(0) || 0,
      uk: flags.indexOf('u') >= 0,
      old: flags.indexOf('o') >= 0, alt: alt,
      senses: (p[3] || '').split('|').map(function (s) { return { c: s.charAt(0), g: s.slice(1) }; }),
    };
  });
};
function commonPrefix(a, b) {
  var n = 0;
  while (n < a.length && n < b.length && a.charAt(n) === b.charAt(n)) n++;
  return n;
}
function shortGloss(g) {
  var parts = g.split('; ');
  var out = parts[0];
  if (parts.length > 1 && (out + ', ' + parts[1]).length <= 34) out += ', ' + parts[1];
  if (out.length > 46) out = out.slice(0, 45).replace(/\s+\S*$/, '') + '…';
  return out;
}
/* Pick the best entry for a key, given what the tokenizer says about the word. */
Dict.prototype.pick = function (key, cls, reading, inflected, weak) {
  var list = this.entries(key);
  /* a spelling found only without its kana must be read the way the dictionary reads it */
  if (list.length && list[0].alt && reading) {
    list = list.filter(function (e) {
      return e.r.some(function (r) { return r === reading || (inflected && commonPrefix(r, reading) >= Math.max(1, r.length - 1)); });
    });
  }
  if (!list.length) return null;
  var kanaKey = !hasKanji(key);
  var best = null, bestScore = -1e9;
  list.forEach(function (e, n) {
    var score = e.rank * 2 - n * 0.01;
    if (e.old) score -= 4;
    if (kanaKey) {
      if (!e.k.length) score += 5; else if (e.uk) score += 4; else score -= 3;
      if (e.r[0] === key) score += 1;
    } else {
      if (e.k[0] === key) score += 1;
      if (reading) {
        var ok = 0;
        e.r.forEach(function (r) {
          if (r === reading) ok = Math.max(ok, weak ? 3 : 6);
          else if (inflected) {
            var cp = commonPrefix(r, reading);
            if (cp > 0 && cp >= r.length - 1) ok = Math.max(ok, 4);
            else if (cp > 0 && cp >= Math.min(r.length, reading.length) - 2) ok = Math.max(ok, 2);
          }
        });
        score += ok;
      }
    }
    var sense = null;
    for (var i = 0; i < e.senses.length; i++) if (e.senses[i].c === cls) { sense = e.senses[i]; break; }
    if (sense) score += 3; else sense = e.senses[0];
    if (score > bestScore) { bestScore = score; best = { e: e, sense: sense }; }
  });
  var rd = best.e.r[0], matched = false;
  if (reading) best.e.r.forEach(function (r) {
    if (r === reading) { rd = r; matched = true; }
    else if (inflected && commonPrefix(r, reading) >= Math.max(1, r.length - 1)) matched = true;
  });
  return { en: shortGloss(best.sense.g), reading: rd, matched: matched, readings: best.e.r, old: best.e.old };
};

/* ---------- numbers ---------- */

var KNUM = { '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
function isNum(t) { return t.pos === '名詞' && t.pos_detail_1 === '数' && /^([0-9０-９]+|[〇零一二三四五六七八九十]+)$/.test(t.surface_form); }
/* 1 to 99, written in digits or kanji (五, 十, 十五, 二十, 四十八); 0 when it is something else */
function numValue(s) {
  s = s.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
  if (/^[0-9]+$/.test(s)) { var d = parseInt(s, 10); return d >= 1 && d <= 99 ? d : 0; }
  var m = /^([一二三四五六七八九])?(十)?([一二三四五六七八九])?$/.exec(s);
  if (!m || !s) return 0;
  if (!m[2]) return m[1] && !m[3] ? KNUM[m[1]] : 0;
  return (m[1] ? KNUM[m[1]] : 1) * 10 + (m[3] ? KNUM[m[3]] : 0);
}
var DIG = ['', 'いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう'];
/* Kanji numbers, with units (三十四, 八千五百) or digit by digit (一九一六, 一二〇). 0 when not a plain number. */
function kanjiNumValue(s) {
  if (!/^[〇零一二三四五六七八九十百千万]+$/.test(s)) return 0;
  if (!/[十百千万]/.test(s)) {
    if (s.length > 1 && /^[〇零]/.test(s)) return 0;
    var p = 0;
    Array.from(s).forEach(function (c) { p = p * 10 + KNUM[c]; });
    return p > 0 && p < 1e8 ? p : 0;
  }
  if (/[〇零]/.test(s)) return 0;
  var total = 0, section = 0, num = 0, UNIT = { '十': 10, '百': 100, '千': 1000 };
  var ok = true;
  Array.from(s).forEach(function (c) {
    if (c in KNUM) { if (num) ok = false; num = KNUM[c]; }
    else if (UNIT[c]) { section += (num || 1) * UNIT[c]; num = 0; }
    else { total += ((section + num) || 1) * 10000; section = 0; num = 0; }
  });
  var v = total + section + num;
  return ok && v > 0 && v < 1e8 ? v : 0;
}
function under10000(n) {
  var th = Math.floor(n / 1000), h = Math.floor(n / 100) % 10, t = Math.floor(n / 10) % 10, u = n % 10, s = '';
  if (th) s += th === 1 ? 'せん' : th === 3 ? 'さんぜん' : th === 8 ? 'はっせん' : DIG[th] + 'せん';
  if (h) s += h === 1 ? 'ひゃく' : h === 3 ? 'さんびゃく' : h === 6 ? 'ろっぴゃく' : h === 8 ? 'はっぴゃく' : DIG[h] + 'ひゃく';
  if (t) s += (t === 1 ? '' : DIG[t]) + 'じゅう';
  if (u) s += DIG[u];
  return s;
}
function numReading(v) {
  if (v >= 10000) return under10000(Math.floor(v / 10000)) + 'まん' + under10000(v % 10000);
  return under10000(v);
}
function numGloss(v) { return v < 10000 ? String(v) : String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
var MIN = ['', 'いっぷん', 'にふん', 'さんぷん', 'よんぷん', 'ごふん', 'ろっぷん', 'ななふん', 'はっぷん', 'きゅうふん'];
function minutesReading(v) {
  if (!v || v > 99) return '';
  var t = Math.floor(v / 10), u = v % 10;
  var tens = t === 0 ? '' : (t === 1 ? '' : DIG[t]) + 'じゅう';
  if (u === 0) return tens.replace(/じゅう$/, '') + 'じゅっぷん';
  return tens + MIN[u];
}

/* Put a dictionary reading of the base form (key) onto the text as written (surface).
   Works when both have the same kanji runs in the same order; returns null otherwise. */
function remapReading(surface, key, keyReading) {
  var parts = furi(key, keyReading), kr = [];
  for (var i = 0; i < parts.length; i++) {
    if (!hasKanji(parts[i][0])) continue;
    if (!parts[i][1] || /[^㐀-䶿一-鿿豈-﫿々〆]/.test(parts[i][0])) return null;
    kr.push(parts[i]);
  }
  var runs = [], cur = '', curK = null;
  Array.from(surface).forEach(function (ch) {
    var k = KANJI.test(ch);
    if (curK === null || k === curK) cur += ch; else { runs.push([cur, curK]); cur = ch; }
    curK = k;
  });
  if (cur) runs.push([cur, curK]);
  var n = 0, out = [];
  for (var j = 0; j < runs.length; j++) {
    if (!runs[j][1]) { out.push([runs[j][0], '']); continue; }
    if (n >= kr.length || kr[n][0] !== runs[j][0]) return null;
    out.push([runs[j][0], kr[n][1]]);
    n++;
  }
  return n === kr.length ? out : null;
}
/* The same for the first part of a word only (the part before a verb ending that changes, as in 来る → 来ない):
   the kanji runs of head take the first readings of key, in order. */
function remapHead(head, key, keyReading) {
  if (key.indexOf(head) !== 0) return null;
  var parts = furi(key, keyReading), kr = [];
  for (var i = 0; i < parts.length; i++) {
    if (!hasKanji(parts[i][0])) continue;
    if (!parts[i][1] || /[^㐀-䶿一-鿿豈-﫿々〆]/.test(parts[i][0])) return null;
    kr.push(parts[i]);
  }
  var out = [], n = 0, cur = '', curK = null, runs = [];
  Array.from(head).forEach(function (ch) {
    var k = KANJI.test(ch);
    if (curK === null || k === curK) cur += ch; else { runs.push([cur, curK]); cur = ch; }
    curK = k;
  });
  if (cur) runs.push([cur, curK]);
  for (var j = 0; j < runs.length; j++) {
    if (!runs[j][1]) { out.push([runs[j][0], '']); continue; }
    if (n >= kr.length || kr[n][0] !== runs[j][0]) return null;
    out.push([runs[j][0], kr[n][1]]);
    n++;
  }
  return out;
}

/* ---------- grammar notes ---------- */

function P(name, en, seq) { return { name: name, en: en, seq: seq }; }
var TE = { s: 'て|で', pos: '助詞' };
var PATTERNS = [
  P('〜ている', 'is doing; ongoing state', [TE, { l: 'いる|おる', d1: '非自立' }]),
  P('〜ている', 'is doing; ongoing state', [{ l: 'てる|でる', pos: '動詞', d1: '非自立' }]),
  P('〜てある', 'has been done and stays so', [TE, { l: 'ある', d1: '非自立' }]),
  P('〜ておく', 'do ahead of time; leave as it is', [TE, { l: 'おく', d1: '非自立' }]),
  P('〜ておく', 'do ahead of time; leave as it is', [{ l: 'とく|どく', pos: '動詞', d1: '非自立' }]),
  P('〜てしまう', 'end up doing; do completely', [TE, { l: 'しまう', d1: '非自立' }]),
  P('〜てしまう', 'end up doing; do completely', [{ l: 'ちゃう|じゃう|ちまう', pos: '動詞' }]),
  P('〜てくる', 'come to; has been doing up to now', [TE, { l: 'くる', d1: '非自立' }]),
  P('〜ていく', 'go on doing; from now on', [TE, { l: 'いく|ゆく', d1: '非自立' }]),
  P('〜てみる', 'try doing', [TE, { l: 'みる', d1: '非自立' }]),
  P('〜てくれる', 'someone does it for me', [TE, { l: 'くれる', d1: '非自立' }]),
  P('〜てください', 'please do', [TE, { l: 'くださる', d1: '非自立' }]),
  P('〜てもらう', 'have someone do it', [TE, { l: 'もらう|いただく', d1: '非自立' }]),
  P('〜てあげる', 'do it for someone', [TE, { l: 'あげる|やる', d1: '非自立' }]),
  P('〜てほしい', 'want someone to do', [TE, { l: 'ほしい|欲しい' }]),
  P('〜てもいい', 'may; it is all right to', [TE, { s: 'も' }, { l: 'いい|よい|良い|かまう|構う' }]),
  P('〜ても', 'even if; even though', [TE, { s: 'も', pos: '助詞' }]),
  P('〜てはいけない', 'must not', [TE, { s: 'は' }, { l: 'いける|なる|だめ|駄目' }]),
  P('〜てから', 'after doing', [TE, { s: 'から', pos: '助詞' }]),
  P('〜たら', 'when; if; once', [{ s: 'たら|だら', pos: '助動詞' }]),
  P('〜たり', 'doing things like', [{ s: 'たり|だり', pos: '助詞' }]),
  P('〜ば', 'if', [{ s: 'ば', pos: '助詞', d1: '接続助詞' }]),
  P('〜なければならない', 'must; have to', [{ s: 'なけれ' }, { s: 'ば' }, { l: 'なる|いける' }]),
  P('〜なきゃ', 'must (casual)', [{ s: 'なきゃ|なくちゃ' }]),
  P('〜ずに', 'without doing', [{ s: 'ず', pos: '助動詞' }, { s: 'に', pos: '助詞' }]),
  P('〜ず', 'not; without', [{ s: 'ず', pos: '助動詞' }]),
  P('〜ないで', 'without doing; do not', [{ l: 'ない', pos: '助動詞' }, { s: 'で', pos: '助詞' }]),
  P('〜なくて', 'not, and so', [{ s: 'なく', pos: '助動詞' }, { s: 'て' }]),
  P('〜ない', 'not', [{ l: 'ない', pos: '助動詞' }]),
  P('〜ません', 'not (polite)', [{ l: 'ます' }, { s: 'ん', pos: '助動詞' }]),
  P('〜ましょう', 'let us (polite)', [{ s: 'ましょ' }, { s: 'う' }]),
  P('〜たい', 'want to', [{ l: 'たい', pos: '助動詞' }]),
  P('〜たがる', 'someone else wants to', [{ l: 'たがる' }]),
  P('〜（ら）れる', 'passive, or can do', [{ l: 'れる|られる', pos: '動詞', d1: '接尾' }]),
  P('〜（さ）せる', 'make or let someone do', [{ l: 'せる|させる', pos: '動詞', d1: '接尾' }]),
  P('〜（よ）うとする', 'try to; be about to', [{ l: 'う|よう', pos: '助動詞' }, { s: 'と' }, { l: 'する' }]),
  P('〜（よ）うと思う', 'intend to', [{ l: 'う|よう', pos: '助動詞' }, { s: 'と' }, { l: '思う|おもう' }]),
  P('〜だろう', 'probably', [{ s: 'だろ|でしょ' }, { s: 'う' }]),
  P('〜（よ）う', 'let us; I will (volitional)', [{ l: 'う|よう', pos: '助動詞' }]),
  P('〜ながら', 'while doing', [{ s: 'ながら', pos: '助詞' }]),
  P('〜つつ', 'while; even though', [{ s: 'つつ', pos: '助詞' }]),
  P('〜そうだ', 'looks like; about to', [{ l: 'そう', pos: '名詞', d1: '接尾' }]),
  P('〜そうだ', 'I hear that', [{ l: 'そう', pos: '名詞', d1: '特殊' }]),
  P('〜ようになる', 'come to; reach the point where', [{ l: 'よう', d1: '非自立' }, { s: 'に' }, { l: 'なる' }]),
  P('〜ようにする', 'make a point of doing', [{ l: 'よう', d1: '非自立' }, { s: 'に' }, { l: 'する' }]),
  P('〜ように', 'so that; in the way that', [{ l: 'よう', d1: '非自立' }, { s: 'に' }]),
  P('〜ような', 'like; such as', [{ l: 'よう', d1: '非自立' }, { s: 'な' }]),
  P('〜ようだ', 'seems; looks like', [{ l: 'よう', d1: '非自立' }]),
  P('〜みたい', 'like; seems', [{ l: 'みたい' }]),
  P('〜らしい', 'apparently; typical of', [{ l: 'らしい' }]),
  P('〜かもしれない', 'might; maybe', [{ s: 'か' }, { s: 'も' }, { l: 'しれる|知れる' }]),
  P('〜かもしれない', 'might; maybe', [{ s: 'かも' }, { l: 'しれる|知れる' }]),
  P('〜ものだ', 'used to; that is how things are', [{ l: 'もの|物', d1: '非自立' }, { l: 'だ|です', pos: '助動詞' }]),
  P('〜かどうか', 'whether or not', [{ s: 'か' }, { s: 'どう' }, { s: 'か' }]),
  P('〜はず', 'should be; expected to', [{ l: 'はず|筈', pos: '名詞' }]),
  P('〜わけ', 'the reason; it means that', [{ l: 'わけ|訳', d1: '非自立' }]),
  P('〜つもり', 'intend to', [{ l: 'つもり|積もり' }]),
  P('〜たことがある', 'have done before', [{ l: 'た|だ', pos: '助動詞' }, { l: 'こと|事' }, { s: 'が|も|は' }, { l: 'ある' }]),
  P('〜ことができる', 'can; be able to', [{ l: 'こと|事' }, { s: 'が|も|は' }, { l: 'できる|出来る' }]),
  P('〜ことにする', 'decide to', [{ l: 'こと|事' }, { s: 'に' }, { l: 'する' }]),
  P('〜ことになる', 'it is decided that; ends up', [{ l: 'こと|事' }, { s: 'に' }, { l: 'なる' }]),
  P('〜こと', 'the act or fact of (makes a noun)', [{ l: 'こと|事', d1: '非自立' }]),
  P('〜のだ', 'explains or stresses the situation', [{ l: 'の|ん', pos: '名詞', d1: '非自立' }, { l: 'だ|です', pos: '助動詞' }]),
  P('〜の', 'the one that; the act of (makes a noun)', [{ l: 'の', pos: '名詞', d1: '非自立' }]),
  P('〜ため', 'for the sake of; because of', [{ l: 'ため|為', pos: '名詞' }]),
  P('〜まま', 'as it is; without changing', [{ l: 'まま', pos: '名詞' }]),
  P('〜ところ', 'about to; in the middle of; just did', [{ l: 'ところ|所', d1: '非自立' }]),
  P('〜ので', 'because; since', [{ s: 'ので', pos: '助詞' }]),
  P('〜のに', 'even though; in order to', [{ s: 'のに', pos: '助詞' }]),
  P('〜から', 'because', [{ s: 'から', pos: '助詞', d1: '接続助詞' }]),
  P('〜けれど', 'but; although', [{ s: 'けれど|けれども|けど|けども', pos: '助詞' }]),
  P('〜が', 'but; and (links two clauses)', [{ s: 'が', pos: '助詞', d1: '接続助詞' }]),
  P('〜と', 'when; if; whenever', [{ s: 'と', pos: '助詞', d1: '接続助詞' }]),
  P('〜し', 'and what is more', [{ s: 'し', pos: '助詞', d1: '接続助詞' }]),
  P('〜なら', 'if; if it is the case that', [{ s: 'なら|ならば', pos: '助動詞' }]),
  P('〜すぎる', 'too much', [{ l: 'すぎる|過ぎる', d1: '非自立' }]),
  P('〜やすい', 'easy to', [{ l: 'やすい|易い', d1: '非自立' }]),
  P('〜にくい', 'hard to', [{ l: 'にくい|難い|づらい|がたい', d1: '非自立' }]),
  P('〜はじめる', 'begin to', [{ l: 'はじめる|始める|だす|出す', d1: '非自立' }]),
  P('〜つづける', 'keep on doing', [{ l: 'つづける|続ける', d1: '非自立' }]),
  P('〜おわる', 'finish doing', [{ l: 'おわる|終わる|おえる|終える', d1: '非自立' }]),
  P('〜なさい', 'do (an instruction)', [{ s: 'なさい' }]),
  P('〜だけ', 'only; just', [{ s: 'だけ', pos: '助詞' }]),
  P('〜しか', 'only; nothing but (with a negative)', [{ s: 'しか', pos: '助詞' }]),
  P('〜ばかり', 'nothing but; just did', [{ s: 'ばかり|ばっかり', pos: '助詞' }]),
  P('〜ほど', 'to the extent that; about', [{ s: 'ほど', pos: '助詞' }]),
  P('〜くらい', 'about; to the extent that', [{ s: 'くらい|ぐらい', pos: '助詞' }]),
  P('〜まで', 'until; as far as; even', [{ s: 'まで', pos: '助詞' }]),
  P('〜など', 'such as; and so on', [{ s: 'など|なんか|なんて', pos: '助詞' }]),
  P('〜さえ', 'even', [{ s: 'さえ|すら', pos: '助詞' }]),
  P('〜こそ', 'precisely; it is this that', [{ s: 'こそ', pos: '助詞' }]),
  P('〜より', 'than; from', [{ s: 'より', pos: '助詞' }]),
  P('〜でも', 'even; or something', [{ s: 'でも', pos: '助詞' }]),
  P('〜という', 'called; that says', [{ s: 'という|っていう' }]),
  P('〜という', 'called; that says', [{ s: 'と|って', pos: '助詞' }, { l: 'いう|言う' }]),
  P('〜について', 'about; concerning', [{ s: 'について|につき' }]),
  P('〜によって', 'by; depending on', [{ s: 'によって|により' }]),
  P('〜によると', 'according to', [{ s: 'によると|によれば' }]),
  P('〜にとって', 'for; from the standpoint of', [{ s: 'にとって' }]),
  P('〜として', 'as; in the role of', [{ s: 'として' }]),
  P('〜に対して', 'toward; in contrast to', [{ s: 'に対して|に対し|にたいして' }]),
  P('〜に関して', 'concerning', [{ s: 'に関して|に関し' }]),
  P('〜において', 'in; at (formal)', [{ s: 'において|における' }]),
  P('〜方', 'way of doing', [{ s: '方', pos: '名詞', d1: '接尾' }]),
];
PATTERNS.forEach(function (p) {
  p.seq = p.seq.map(function (m) {
    return { l: m.l ? m.l.split('|') : null, s: m.s ? m.s.split('|') : null, pos: m.pos || null, d1: m.d1 || null };
  });
});
function matchOne(m, t) {
  if (m.pos && t.pos !== m.pos) return false;
  if (m.d1 && t.pos_detail_1 !== m.d1) return false;
  if (m.l && m.l.indexOf(lemma(t)) < 0) return false;
  if (m.s && m.s.indexOf(t.surface_form) < 0) return false;
  return true;
}
function grammarAt(toks, from, to) {
  var found = [];
  for (var s = from; s < to; s++) {
    for (var p = 0; p < PATTERNS.length; p++) {
      var seq = PATTERNS[p].seq, ok = s + seq.length <= toks.length;
      for (var j = 0; ok && j < seq.length; j++) ok = matchOne(seq[j], toks[s + j]);
      if (ok) found.push({ name: PATTERNS[p].name, en: PATTERNS[p].en, s: s, e: s + seq.length });
    }
  }
  var keep = found.filter(function (a) {
    return !found.some(function (b) {
      return b !== a && b.s <= a.s && b.e >= a.e && (b.e - b.s) > (a.e - a.s);
    });
  });
  var longNeg = keep.some(function (m) { return /(ない|いけない|ならない)$/.test(m.name) && m.name.length > 3; });
  if (longNeg) keep = keep.filter(function (m) { return m.name !== '〜ない' && m.name !== '〜ません'; });
  var out = [], seen = {};
  keep.forEach(function (m) {
    if (seen[m.name] || out.length >= 2) return;
    seen[m.name] = 1;
    out.push([m.name, m.en]);
  });
  return out;
}

/* ---------- phrases ---------- */

var NOMINAL = { 'こと': 'thing; fact', '事': 'thing; fact', 'の': '', 'ん': '', 'もの': 'thing', '物': 'thing', 'よう': 'manner; way',
  'はず': 'expectation', '筈': 'expectation', 'わけ': 'reason', '訳': 'reason', 'ため': 'sake; cause', '為': 'sake; cause',
  'まま': 'as it is', 'つもり': 'intention', 'ところ': 'place; moment', 'ほう': 'side; direction', '方': 'side; direction',
  'そう': '', 'みたい': '' };

function kindOf(t) {
  var pos = t.pos, d1 = t.pos_detail_1;
  if (pos === '記号') return 'PUNCT';
  if (/^\s+$/.test(t.surface_form)) return 'PUNCT';
  if (pos === '助詞') return d1 === '接続助詞' ? 'CONJP' : 'PART';
  if (pos === '助動詞') return 'AUX';
  if (pos === '動詞' || pos === '形容詞') return d1 === '自立' ? 'CONTENT' : 'TAIL';
  if (pos === '接頭詞') return 'PREFIX';
  if (pos === '名詞') {
    if (d1 === '接尾') return t.pos_detail_2 === '助動詞語幹' ? 'TAIL' : 'NSUF';
    if (d1 === '特殊') return 'NFUNC';
    if (d1 === '非自立') return Object.prototype.hasOwnProperty.call(NOMINAL, lemma(t)) ? 'NFUNC' : 'CONTENT';
    return 'CONTENT';
  }
  return 'CONTENT';
}
function clsOf(t) {
  if (t.pos === '動詞') return 'v';
  if (t.pos === '形容詞') return 'a';
  if (t.pos === '副詞') return 'd';
  if (t.pos === '名詞') return 'n';
  return 'x';
}

function Engine(tokenizer, lines) {
  this.tokenizer = tokenizer;
  this.dict = new Dict(lines);
}

/* Longest run of tokens starting at i that the dictionary knows as one word or set phrase. */
Engine.prototype.merge = function (toks, i) {
  var dict = this.dict, first = toks[i];
  /* never start a word in the middle of a number (一九一六年 must not yield 九一) */
  if (i > 0 && isNum(first) && isNum(toks[i - 1])) return null;
  /* a number followed by 分 is usually minutes: 三分 さんぷん, 九時十分 じゅっぷん */
  var numRun = 0;
  while (i + numRun < toks.length && isNum(toks[i + numRun])) numRun++;
  if (numRun && i + numRun < toks.length && toks[i + numRun].surface_form === '分') {
    var numText = '', after = toks[i + numRun + 1], after2 = toks[i + numRun + 2];
    for (var q = 0; q < numRun; q++) numText += toks[i + q].surface_form;
    var v = numValue(numText);
    var fraction = after && after.surface_form === 'の' && after2 && isNum(after2);
    var afterTime = i > 0 && toks[i - 1].surface_form === '時';
    if (v && !fraction && (afterTime || (numText !== '十' && numText !== '十二'))) {
      var mr = minutesReading(v);
      if (mr) return { n: numRun + 1, key: numText + '分', minutes: { v: v, num: numText, reading: mr } };
    }
    if (numText === '十' || numText === '十二') return { n: numRun + 1, key: numText + '分' };
  }
  if (first.pos === '名詞' && first.pos_detail_1 === '数' && /^[0-9０-９]+$/.test(first.surface_form)) return null;
  for (var n = Math.min(4, toks.length - i); n >= 2; n--) {
    var last = toks[i + n - 1], bad = false, head = '';
    if (last.pos === '助詞' || last.pos === '助動詞' || last.pos === '記号') continue;
    for (var j = 0; j < n; j++) {
      var t = toks[i + j];
      if (t.pos === '記号' || /^\s+$/.test(t.surface_form)) { bad = true; break; }
      if (j > 0 && j < n - 1 && t.pos === '助動詞') { bad = true; break; }
      if (j < n - 1) head += t.surface_form;
    }
    if (bad) continue;
    var hasParticle = false;
    for (var q = 1; q < n - 1; q++) if (toks[i + q].pos === '助詞') hasParticle = true;
    if (hasParticle && n < 3) continue;
    var key = head + lemma(last);
    /* a word the dictionary lists in its inflected form is taken as it stands: 絶え間なく "incessantly" */
    if (last.surface_form !== lemma(last) && last.pos === '形容詞' && dict.has(head + last.surface_form)) key = head + last.surface_form;
    /* a word may not cut a number in two (一二〇 must not yield 一二), and file numbers with 〇 stay as digits */
    if (numRun >= 2 && n < numRun) continue;
    if (numRun && /[〇零]/.test(key)) continue;
    if (dict.has(key) && (hasKanji(key) || key.length >= 4)) {
      /* a noun followed by する is left alone: the noun gets its own gloss */
      if (n === 2 && lemma(last) === 'する') continue;
      return { n: n, key: key };
    }
  }
  /* a number written in two or more kanji (三十四, 一九一六) is one word, read as a whole number */
  if (numRun >= 2) {
    var nt = '';
    for (var r = 0; r < numRun; r++) nt += toks[i + r].surface_form;
    var nv = kanjiNumValue(nt);
    if (nv) return { n: numRun, key: nt, number: { v: nv, reading: numReading(nv) } };
  }
  return null;
};

Engine.prototype.paragraph = function (text) {
  var self = this, dict = this.dict;
  var toks = this.tokenizer.tokenize(text);
  var chunks = [], chunk = null, word = null, pendingHead = '', joinNext = false, prefixOpen = false;

  function closeChunk() { chunk = null; word = null; joinNext = false; prefixOpen = false; }
  function openChunk(i) {
    chunk = { head: pendingHead, tail: '', words: [], from: i, to: i, len: 0 };
    pendingHead = '';
    chunks.push(chunk);
    word = null;
  }
  function addWord(i, n, w) {
    w.toks = toks.slice(i, i + n);
    chunk.words.push(w);
    chunk.to = i + n;
    w.toks.forEach(function (t) { chunk.len += t.surface_form.length; });
    word = w;
  }
  function fuse(i, t) {
    word.toks.push(t);
    chunk.to = i + 1;
    chunk.len += t.surface_form.length;
  }
  function lastIsWord() { return word && chunk && chunk.words[chunk.words.length - 1] === word; }

  for (var i = 0; i < toks.length; i++) {
    var t = toks[i], K = kindOf(t), s = t.surface_form;

    if (K === 'PUNCT') {
      if (OPEN.indexOf(s) >= 0 || t.pos_detail_1 === '括弧開') { closeChunk(); pendingHead += s; }
      else if (chunk) { chunk.tail += s; closeChunk(); }
      else if (chunks.length && !pendingHead) chunks[chunks.length - 1].tail += s;
      else pendingHead += s;
      continue;
    }

    if ((lemma(t) === 'しれる' || lemma(t) === '知れる') && i > 0 && /も$/.test(toks[i - 1].surface_form) && chunk) {
      addWord(i, 1, { kind: 'f', aux: true });
      continue;
    }
    if (K === 'NSUF' && !(lastIsWord() && word.kind === 'c')) K = 'CONTENT';
    if (K === 'TAIL' && !lastIsWord()) K = 'CONTENT';

    /* する after a noun that takes it: 合格 + したら is one word */
    if (K === 'CONTENT' && lemma(t) === 'する' && lastIsWord() && word.kind === 'c' && word.suru) {
      fuse(i, t); word.verbal = true; word.suru = false;
      continue;
    }

    /* 云え + ない: the tokenizer's dictionary has no 云える, so "cannot say" comes as an order followed by
       the adjective ない; the two are one word */
    if (t.pos === '形容詞' && lemma(t) === 'ない' && lastIsWord() && word.kind === 'c' && word.cls === 'v' && !word.potNeg &&
        /^命令ｅ/.test(word.toks[word.toks.length - 1].conjugated_form || '')) {
      fuse(i, t); word.potNeg = true; word.inflected = true;
      continue;
    }

    if (K === 'CONTENT') {
      var m = this.merge(toks, i);
      var n = m ? m.n : 1;
      var lastTok = toks[i + n - 1];
      var w = {
        kind: 'c', key: m ? m.key : lemma(t), merged: !!m, mergedN: m ? m.n : 0, minutes: m && m.minutes, number: m && m.number,
        cls: m && m.number ? 'x' : clsOf(lastTok),
        verbal: lastTok.pos === '動詞' || lastTok.pos === '形容詞',
        suru: lastTok.pos === '名詞' && lastTok.pos_detail_1 === 'サ変接続',
        na: lastTok.pos === '名詞' && lastTok.pos_detail_1 === '形容動詞語幹',
        inflected: lastTok.basic_form !== '*' && lastTok.basic_form !== lastTok.surface_form,
      };
      if (prefixOpen && lastIsWord()) {
        /* お + 茶: the prefix and the word are shown as one */
        var pre = word.toks.map(function (x) { return x.surface_form; }).join('');
        for (var a = 0; a < n; a++) fuse(i + a, toks[i + a]);
        word.key = dict.has(pre + w.key) ? pre + w.key : w.key;
        word.cls = w.cls; word.verbal = w.verbal; word.suru = w.suru; word.na = w.na; word.inflected = w.inflected;
        word.preLen = 1;
        prefixOpen = false;
      } else {
        var same = false;
        if (chunk && joinNext && chunk.len <= 10) same = true;
        else if (lastIsWord() && word.kind === 'c' && word.cls === 'n' && !word.verbal && t.pos === '名詞' && chunk.len <= 8) same = true;
        if (!same) openChunk(i);
        addWord(i, n, w);
      }
      joinNext = t.pos === '連体詞';
      i += n - 1;
      continue;
    }

    if (K === 'PREFIX') {
      if (!(chunk && joinNext)) openChunk(i);
      addWord(i, 1, { kind: 'c', key: s, cls: 'x', verbal: false });
      prefixOpen = true; joinNext = false;
      continue;
    }

    if (!chunk) openChunk(i);
    joinNext = false; prefixOpen = false;

    if (K === 'NSUF') {
      var joined = word.toks.map(function (x) { return x.surface_form; }).join('') + s;
      fuse(i, t);
      if (dict.has(joined)) { word.key = joined; word.merged = true; word.mergedN = word.toks.length; }
      continue;
    }
    if (K === 'NFUNC') {
      addWord(i, 1, { kind: 'n', key: lemma(t), cls: 'n', verbal: false, nominal: true });
      continue;
    }
    if (K === 'TAIL') { fuse(i, t); word.verbal = true; continue; }
    if (K === 'AUX') {
      if (lastIsWord() && (word.verbal || word.aux || word.nominal || (word.na && s === 'な'))) fuse(i, t);
      else addWord(i, 1, { kind: 'f', aux: true });
      continue;
    }
    if (K === 'CONJP' && lastIsWord() && (word.verbal || (word.aux && word.kind === 'f'))) { fuse(i, t); continue; }
    /* a plain particle: grey, untranslated */
    if (lastIsWord() && word.na && t.pos_detail_1 === '副詞化') { fuse(i, t); continue; }
    if (lastIsWord() && word.kind === 'f' && !word.aux) fuse(i, t);
    else addWord(i, 1, { kind: 'f' });
  }

  var out = chunks.map(function (c) {
    var first = null, firstWeak = false;
    var words = c.words.map(function (w) {
      var segs = [];
      w.toks.forEach(function (t) { furi(t.surface_form, t.reading).forEach(function (p) {
        var lastSeg = segs[segs.length - 1];
        if (lastSeg && !lastSeg[1] && !p[1]) lastSeg[0] += p[0]; else segs.push([p[0], p[1]]);
      }); });
      if (w.kind === 'f') return { s: segs, f: 1 };
      if (w.nominal) {
        var ng = NOMINAL[w.key];
        return ng ? { s: segs, e: ng } : { s: segs, f: 1 };
      }
      var head = w.toks[w.preLen || 0] || w.toks[0];
      var en = '', rd = '';
      var isNumber = head.pos_detail_1 === '数' && /^[0-9０-９.,]+$/.test(head.surface_form);
      if (!isNumber) {
        var stemReading = '';
        if (w.merged) stemReading = '';
        else if (!w.inflected && w.toks.length === 1 + (w.preLen || 0)) stemReading = hira(head.reading || '');
        else stemReading = hira(head.reading || '');
        /* a word the tokenizer only knew as separate pieces (令 + 和): its pieces' readings may not be
           the word's reading, so the dictionary's reading wins when they disagree (りょうわ → れいわ) */
        /* The matched span is the first mergedN tokens; anything after it is an ending fused on later
           (ない, おき, 発), which always keeps the tokenizer's own reading. */
        var spanN = w.mergedN || w.toks.length;
        var spanToks = w.toks.slice(0, spanN), restToks = w.toks.slice(spanN);
        function withRest(spanSegs) {
          var out = spanSegs.map(function (p) { return [p[0], p[1]]; });
          restToks.forEach(function (t) { furi(t.surface_form, t.reading).forEach(function (p) {
            var ls = out[out.length - 1];
            if (ls && !ls[1] && !p[1]) ls[0] += p[0]; else out.push([p[0], p[1]]);
          }); });
          return out;
        }
        var spanReading = '', spanKnown = true, spanName = false, spanSurface = '';
        var headSurface = '', headReading = '';
        var lastT = spanToks[spanToks.length - 1];
        var endsInflected = lastT.basic_form !== '*' && lastT.basic_form !== lastT.surface_form;
        if (w.merged && !w.preLen) {
          spanToks.forEach(function (t, k) {
            var r;
            spanSurface += t.surface_form;
            if (t.pos_detail_1 === '固有名詞') spanName = true;
            if (t.reading && t.reading !== '*') r = hira(t.reading);
            else if (hasKanji(t.surface_form)) { spanKnown = false; r = ''; }
            else r = hira(t.surface_form);
            spanReading += r;
            if (k < spanToks.length - 1) { headSurface += t.surface_form; headReading += r; }
          });
        }
        var hit = null;
        if (w.minutes) {
          hit = { en: w.minutes.v + (w.minutes.v === 1 ? ' minute' : ' minutes'), reading: w.minutes.reading };
          segs = withRest(/^[0-9０-９]+$/.test(w.minutes.num)
            ? [[w.minutes.num, ''], ['分', /ぷん$/.test(w.minutes.reading) ? 'ぷん' : 'ふん']]
            : [[w.minutes.num + '分', w.minutes.reading]]);
        } else if (w.number) {
          hit = { en: numGloss(w.number.v), reading: w.number.reading };
          segs = withRest([[w.key, w.number.reading]]);
        } else if (w.merged) {
          /* the pieces' reading counts, but less than for a single word: it is a guess made piece by piece */
          hit = dict.pick(w.key, w.cls, spanKnown && !endsInflected ? spanReading : '', false, true);
        } else {
          hit = dict.pick(w.key, w.cls, stemReading, w.inflected || w.toks.length > 1);
        }
        /* a word the tokenizer only knew as separate pieces (令 + 和): the pieces' readings may not be
           the word's reading, so the dictionary's reading wins when they disagree (りょうわ → れいわ) */
        if (hit && !w.minutes && !w.number && w.merged && !w.preLen && !spanName && spanKnown && !hit.old && hit.reading && hasKanji(w.key)) {
          var fixed = null;
          if (!endsInflected) {
            if (hit.readings.indexOf(spanReading) < 0) fixed = remapReading(spanSurface, w.key, hit.reading);
          } else if (hasKanji(headSurface) && !hit.readings.some(function (r) { return r.indexOf(headReading) === 0; })) {
            /* only the part before the ending is corrected; the ending keeps its own reading (来ない stays こない) */
            var hs = remapHead(headSurface, w.key, hit.reading);
            if (hs) fixed = hs.concat(furi(lastT.surface_form, lastT.reading));
          }
          if (fixed) segs = withRest(fixed);
        }
        if (!hit && w.key !== lemma(head)) hit = dict.pick(lemma(head), w.cls, stemReading, true);
        if (!hit && w.cls === 'v') {
          var pm = /^(.*)([えけげせてねべめれ])る$/.exec(w.key);
          if (pm) {
            var base = pm[1] + 'うくぐすつぬぶむる'.charAt('えけげせてねべめれ'.indexOf(pm[2]));
            var ph = dict.pick(base, 'v', '', true);
            if (ph) hit = { en: 'can ' + ph.en.replace(/^to /, '').replace(/, to /g, ', '), reading: '' };
          }
        }
        /* ない on its own is "not" or "there is none", never the dictionary's other senses of the kana */
        if (w.key === 'ない' && head.pos === '形容詞') hit = { en: 'not; there is none', reading: '' };
        if (hit && w.potNeg) hit = { en: 'cannot ' + hit.en.replace(/^to /, '').replace(/, to /g, ', '), reading: hit.reading };
        if (hit) { en = hit.en; rd = hit.reading; }
        else if (head.pos_detail_1 === '固有名詞') {
          en = head.pos_detail_2 === '人名' ? '(a name)' : head.pos_detail_2 === '地域' ? '(a place)' : head.pos_detail_2 === '組織' ? '(an organisation)' : '(a name)';
        }
      }
      var o = { s: segs };
      if (en) o.e = en;
      if (!isNumber) {
        var cand = [w.key, hasKanji(w.key) ? rd : '', en];
        if (!first) { first = cand; firstWeak = w.cls === 'x' || w.cls === 'd'; }
        else if (firstWeak && w.cls !== 'x' && w.cls !== 'd') { first = cand; firstWeak = false; }
      }
      return o;
    });
    var item = { w: words };
    var g = grammarAt(toks, c.from, c.to);
    if (g.length) item.g = g;
    if (c.head) item.h = c.head;
    if (c.tail) item.t = c.tail;
    if (first) item.d = first;
    return item;
  });
  if (pendingHead) out.push({ x: pendingHead });
  return out;
};

Engine.prototype.analyze = function (text) {
  var self = this;
  var paras = String(text).replace(/\r\n?/g, '\n').split('\n').map(function (line) {
    var trimmed = line.replace(/^[\s　]+|[\s　]+$/g, '');
    return trimmed ? self.paragraph(trimmed) : [];
  });
  /* collapse runs of blank lines */
  var clean = [];
  paras.forEach(function (p) { if (p.length || (clean.length && clean[clean.length - 1].length)) clean.push(p); });
  while (clean.length && !clean[clean.length - 1].length) clean.pop();
  return { v: VERSION, paras: clean };
};

root.YomuEngine = { VERSION: VERSION, create: function (tokenizer, lines) { return new Engine(tokenizer, lines); }, furi: furi };
if (typeof module !== 'undefined' && module.exports) module.exports = root.YomuEngine;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);
