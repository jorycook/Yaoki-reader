/* Reader engine: turns Japanese text into phrases with readings, word glosses and grammar notes.
   Needs a kuromoji tokenizer (IPADIC) and the compact JMdict lines. Runs in a worker, on the page, or in Node. */
(function (root) {
'use strict';

var VERSION = 6;
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

/* The word list: jm-1.txt and jm-2.txt (JMdict 2020), then the supplement jm-3.txt made from a newer JMdict
   by tools/jm-supplement.py. The supplement's words are ordinary lines; its other lines refer to a word of the
   list by its first kanji form (or nothing) and first reading:
     =spelling TAB kanji TAB reading         one more way to write that word (顫える for 震える)
     ?kana TAB kanji TAB reading TAB score   how usual it is to write that word in that kana (0 to 20) */
function Dict(lines) {
  this.lines = lines;
  var idx = new Map(), refs = [], ref = new Map(), kscore = new Map();
  function add(key, i) {
    if (!key) return;
    var v = idx.get(key);
    if (v === undefined) idx.set(key, i);
    else if (typeof v === 'number') { if (v !== i) idx.set(key, [v, i]); }
    else if (v.indexOf(i) < 0) v.push(i);
  }
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i], c0 = line.charAt(0);
    if (c0 === '=' || c0 === '?') { refs.push(i); continue; }
    var a = line.indexOf('\t'), b = line.indexOf('\t', a + 1);
    if (a < 0 || b < 0) continue;
    if (a > 0) line.slice(0, a).split(';').forEach(function (k) { add(k, i); });
    line.slice(a + 1, b).split(';').forEach(function (k) { add(k, i); });
    var rk = (a > 0 ? line.slice(0, a).split(';')[0] : '') + '\t' + line.slice(a + 1, b).split(';')[0];
    if (!ref.has(rk)) ref.set(rk, i);
  }
  refs.forEach(function (i) {
    var p = lines[i].split('\t'), target = ref.get(p[1] + '\t' + p[2]);
    if (target === undefined) return;
    if (p[0].charAt(0) === '=') add(p[0].slice(1), target);
    else {
      var kana = p[0].slice(1), m = kscore.get(kana);
      if (!m) kscore.set(kana, m = new Map());
      m.set(target, +p[3] || 0);
    }
  });
  this.idx = idx;
  this.kscore = kscore;
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
    if (a <= 0 || line.charAt(0) === '=' || line.charAt(0) === '?') continue;
    var noun = /\t[0-9][uo]*\tn/.test(line), verbal = /\t[0-9][uo]*\t[va]/.test(line);
    line.slice(0, a).split(';').forEach(function (k) {
      var inner = k.replace(INNER_KANA, '$1');
      if (inner !== k) add(inner, i);
      /* a verb or adjective written with less okurigana: 寝過ごす → 寝過す, 少ない → 少い, 羨ましい → 羨しい */
      var short = /^(.*[㐀-䶿一-鿿々])([ぁ-ゖ])([ぁ-ゖ]+)$/.exec(k);
      if (verbal && short && short[3].length >= 1 && !/^[いうくぐすつぬぶむる]$/.test(short[2] + short[3]) && short[2] !== 'っ') add(short[1] + short[3], i);
      /* a noun also loses the kana at its end (取扱い → 取扱, 借金取り → 借金取) */
      if (noun && END_KANA.test(inner)) add(inner.replace(END_KANA, '$1'), i);
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
      old: flags.indexOf('o') >= 0, alt: alt, i: i,
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
/* Words written in kana that mean one word far more often than the others it could be, in the texts of
   Aozora Bunko: the kanji form of the word meant. Made from reviewing the reader's choices in thirty works. */
var KANA = {};

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
  /* for a word written in kana, how usual that is for each candidate (the supplement's scores) */
  var ks = kanaKey ? this.kscore.get(key) : null;
  var best = null, bestScore = -1e9;
  list.forEach(function (e, n) {
    var score = e.rank * 2 - n * 0.01;
    if (e.old) score -= 4;
    if (kanaKey) {
      /* in kana, a common word always comes before a rare one (時 before 鴇 for とき) */
      score += e.rank;
      if (!e.k.length) score += 5; else if (e.uk) score += 4; else score -= 3;
      /* how likely the word is meant by this kana (the supplement): decides between words the list marks alike,
         such as 成る and 生る for なる, 中 and 仲 for なか */
      if (ks && ks.has(e.i)) score += ks.get(e.i) * 0.3;
      /* the words a learner meets in kana most, checked by hand against real texts (KANA below) */
      var pref = KANA[key];
      if (pref && e.k.indexOf(pref) >= 0) score += 30;
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
  return { en: shortGloss(best.sense.g), reading: rd, matched: matched, readings: best.e.r, old: best.e.old, rank: best.e.rank, k: best.e.k };
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
/* inside: token ranges [from, to) that are one dictionary word (思ひ + 出す); no pattern is found within them */
function grammarAt(toks, from, to, inside) {
  var found = [];
  for (var s = from; s < to; s++) {
    for (var p = 0; p < PATTERNS.length; p++) {
      var seq = PATTERNS[p].seq, ok = s + seq.length <= toks.length;
      for (var j = 0; ok && j < seq.length; j++) ok = matchOne(seq[j], toks[s + j]);
      if (ok && inside && inside.some(function (r) { return s >= r[0] && s + seq.length <= r[1]; })) ok = false;
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

/* ---------- words the dictionary does not have as written ---------- */

/* Hepburn romanisation, so a name the dictionary does not have can at least be read: かんだた → Kandata */
var ROMA = {};
('あa いi うu えe おo かka きki くku けke こko さsa しshi すsu せse そso たta ちchi つtsu てte とto なna にni ぬnu ねne のno ' +
 'はha ひhi ふfu へhe ほho まma みmi むmu めme もmo やya ゆyu よyo らra りri るru れre ろro わwa ゐi ゑe をo んn ' +
 'がga ぎgi ぐgu げge ごgo ざza じji ずzu ぜze ぞzo だda ぢji づzu でde どdo ばba びbi ぶbu べbe ぼbo ぱpa ぴpi ぷpu ぺpe ぽpo ' +
 'ぁa ぃi ぅu ぇe ぉo ゃya ゅyu ょyo ゎwa ゔvu').split(' ').forEach(function (p) { ROMA[p.charAt(0)] = p.slice(1); });
var MACRON = { a: 'ā', i: 'ī', u: 'ū', e: 'ē', o: 'ō' };
function romaji(kana) {
  var s = hira(kana || ''), out = '';
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i), n = s.charAt(i + 1);
    if (c === 'っ') { var nx = ROMA[n] || ''; out += nx ? (nx.charAt(0) === 'c' ? 't' : nx.charAt(0)) : ''; continue; }
    if (c === 'ー') { var lv = out.charAt(out.length - 1); if (MACRON[lv]) out = out.slice(0, -1) + MACRON[lv]; continue; }
    if (c === '・' || c === '･' || c === ' ') { out += ' '; continue; }
    var r = ROMA[c];
    if (r === undefined) { out += c; continue; }
    /* ん before a vowel or y: Shin'ichi, Kin'iro */
    if (c === 'ん') { out += /^[aiueoy]/.test(ROMA[n] || '') ? "n'" : 'n'; continue; }
    if (n && 'ゃゅょ'.indexOf(n) >= 0 && /i$/.test(r) && r.length > 1) {
      var stem = r.slice(0, -1);
      out += (/(sh|ch|j)$/.test(stem) ? stem : stem + 'y') + ROMA[n].slice(1);
      i++; continue;
    }
    if (n && 'ぁぃぅぇぉ'.indexOf(n) >= 0 && r.length > 1 && 'ゃゅょ'.indexOf(c) < 0) {
      out += r.replace(/[aiueo]$/, '').replace(/^w$/, 'w') + ROMA[n];
      i++; continue;
    }
    out += r;
  }
  /* long o and u as in names: Zōshigaya, Kantarō, Yūki */
  out = out.replace(/o[ou]/g, 'ō').replace(/uu/g, 'ū');
  return out.split(' ').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ').trim();
}
function kata(s) { return s ? s.replace(/[ぁ-ゖ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) + 0x60); }) : ''; }
function isKana(s) { return /^[ぁ-ゖァ-ヺーゝゞヽヾ]+$/.test(s); }
function isKata(s) { return /^[ァ-ヺー・･]+$/.test(s) && /[ァ-ヺ]/.test(s); }
function allKanji(s) { return /^[㐀-䶿一-鿿豈-﫿々〆〇ヶ]+$/.test(s); }
function uniq(a) { var seen = {}; return a.filter(function (x) { if (!x || seen[x]) return false; seen[x] = 1; return true; }); }

/* Older spelling, as Aozora Bunko keeps it for many works: ゐ ゑ, ふ ひ へ in verb endings, a full-size つ for っ,
   やう for よう. Each variant is only tried when the word as written is not found. */
var OLD_O = { か: 'こ', が: 'ご', さ: 'そ', ざ: 'ぞ', た: 'と', だ: 'ど', な: 'の', ま: 'も', や: 'よ', ら: 'ろ' };
function oldVariants(s) {
  var v = [];
  var a = s.replace(/ゐ/g, 'い').replace(/ゑ/g, 'え').replace(/ヰ/g, 'イ').replace(/ヱ/g, 'エ');
  v.push(a);
  var b = a.replace(/ふ$/, 'う').replace(/へる$/, 'える').replace(/ひる$/, 'いる').replace(/はる$/, 'わる');
  v.push(b);
  v.push(b.replace(/つ(?=[かきくけこさしすせそたちつてとぱぴぷぺぽ])/g, 'っ'));
  v.push(b.replace(/([かがさざただなまやら])う/g, function (m, c) { return OLD_O[c] + 'う'; })
    .replace(/せう/g, 'しょう').replace(/てふ/g, 'ちょう').replace(/けう/g, 'きょう').replace(/しやう/g, 'しょう'));
  v.push(b.replace(/ぢ/g, 'じ').replace(/づ/g, 'ず'));
  /* ハ行 kana right after a kanji are an old okurigana: 思ひ出す → 思い出す, 考へ → 考え, 違ひ → 違い */
  var kh = b.replace(new RegExp('(' + KANJI.source + ')([はひふへほ])', 'g'), function (m, k, c) { return k + 'わいうえお'.charAt('はひふへほ'.indexOf(c)); });
  v.push(kh);
  v.push(kh.replace(/つ(?=[かきくけこさしすせそたちつてとぱぴぷぺぽ])/g, 'っ'));
  return uniq(v).filter(function (x) { return x !== s; });
}
/* Older ways of writing loanwords: ストオヴ (ストーブ), シャッタア (シャッター), ポッケット (ポケット) */
var VOWEL = {};
'アァカガサザタダナハバパマヤャラワ:a イィキギシジチヂニヒビピミリヰ:i ウゥクグスズツヅヌフブプムユュルヴ:u エェケゲセゼテデネヘベペメレヱ:e オォコゴソゾトドノホボポモヨョロヲ:o'
  .split(' ').forEach(function (g) { var p = g.split(':'); Array.from(p[0]).forEach(function (c) { VOWEL[c] = p[1]; }); });
var LONG = { ア: 'a', イ: 'i', ウ: 'u', エ: 'e', オ: 'o' };
function loanVariants(s) {
  var v = [];
  /* a vowel written out after a kana with the same vowel is a long vowel: タア → ター, トオ → トー, ゴウ → ゴー */
  var a = '';
  Array.from(s).forEach(function (c, i, arr) {
    var prev = a.charAt(a.length - 1);
    if (i > 0 && LONG[c] && (VOWEL[prev] === LONG[c] || (c === 'ウ' && VOWEL[prev] === 'o')) && prev !== 'ー') a += 'ー'; else a += c;
  });
  v.push(a);
  var b = a.replace(/ヴァ/g, 'バ').replace(/ヴィ/g, 'ビ').replace(/ヴェ/g, 'ベ').replace(/ヴォ/g, 'ボ').replace(/ヴ/g, 'ブ')
    .replace(/ヂ/g, 'ジ').replace(/ヅ/g, 'ズ').replace(/ヰ/g, 'ウィ').replace(/ヱ/g, 'ウェ');
  v.push(b);
  [s, a, b].forEach(function (x) { var i = x.indexOf('ッ'); while (i > 0) { v.push(x.slice(0, i) + x.slice(i + 1)); i = x.indexOf('ッ', i + 1); } });
  v.push(b.replace(/ー$/, ''));
  return uniq(v).filter(function (x) { return x !== s; });
}
var LAUGH = /^[あうえおアウエオ]?([はひふへほハヒフヘホ])\1+[っッーぁァ]*$|^(?:わっはっは|ワッハッハ|あはは|アハハ|ははは|ハハハ|げらげら)$/;
/* reduplicated (ゴロゴロ), ending in っ (ドッ), or drawn out (ザアー, ビュウ): a word for a sound or a manner */
function soundLike(s) {
  var h = hira(s);
  if (!isKana(h)) return false;
  return /[っ]$/.test(h) || /^(.{2,3})\1+$/.test(h) || /^(.)ー*\1/.test(h) || /^.[ゃゅょ]?(?:っ|ん)?り$/.test(h.replace(/と$/, '')) ||
    /(.)(ー|あ|う)ー*$/.test(h) && h.length <= 4;
}

/* Base forms a written form may come from: 顫えて → 顫える, 逢って → 逢う, 入ろう → 入る, 恐ろしく → 恐ろしい.
   Every cut of the word is a stem plus an ending; the stem is turned back into each possible dictionary form.
   The dictionary decides which of them exist; longer stems come first. */
var GODAN = { か: 'く', き: 'く', け: 'く', こ: 'く', が: 'ぐ', ぎ: 'ぐ', げ: 'ぐ', ご: 'ぐ', さ: 'す', し: 'す', せ: 'す', そ: 'す',
  た: 'つ', ち: 'つ', て: 'つ', と: 'つ', な: 'ぬ', に: 'ぬ', ね: 'ぬ', の: 'ぬ', ば: 'ぶ', び: 'ぶ', べ: 'ぶ', ぼ: 'ぶ',
  ま: 'む', み: 'む', め: 'む', も: 'む', ら: 'る', り: 'る', れ: 'る', ろ: 'る', わ: 'う', い: 'う', え: 'う', お: 'う' };
function baseForms(s) {
  var out = [{ b: s, stem: s.length, cls: '' }];
  for (var cut = s.length; cut >= 1; cut--) {
    var p = s.slice(0, cut), t = s.slice(cut), last = p.charAt(p.length - 1), q = p.slice(0, -1);
    if (t && !/^[ぁ-ゖ]+$/.test(t)) continue;
    out.push({ b: p + 'る', stem: cut, cls: 'v' });
    if (GODAN[last]) out.push({ b: q + GODAN[last], stem: cut, cls: 'v' });
    if (last === 'っ' && q) ['う', 'つ', 'る', 'く'].forEach(function (e) { out.push({ b: q + e, stem: cut, cls: 'v' }); });
    if (last === 'ん' && q) ['ぬ', 'ぶ', 'む'].forEach(function (e) { out.push({ b: q + e, stem: cut, cls: 'v' }); });
    if (last === 'い' && q && /^[てただで]/.test(t)) ['く', 'ぐ'].forEach(function (e) { out.push({ b: q + e, stem: cut, cls: 'v' }); });
    if (/^(く|か|け|さ|そ|すぎ|げ)/.test(t)) out.push({ b: p + 'い', stem: cut, cls: 'a' });
    if (KANJI.test(last) && /^[てたっ]/.test(t)) ['く', 'う', 'る', 'つ', 'む', 'す'].forEach(function (e) { out.push({ b: p + e, stem: cut, cls: 'v' }); });
    if (/^[しさせ]/.test(t)) out.push({ b: p + 'する', stem: cut, cls: 'v' });
  }
  return out;
}

/* what may follow a stem in an inflected form (the rest of a written form after its stem) */
var INFLECTION = /^(|て|で|た|だ|ちゃ|じゃ|たら|だら|たり|だり|ない|なかっ?た?|なく|ます|まし|ませ|ましょう|れ|られ|せ|させ|う|よう|ば|ず|ぬ|ん|い|く|かっ?た?|けれ|さ|そう|すぎ)(て|た|ば|る|ん|う)?(て|た)?$/;

/* ---------- tokens the tokenizer got wrong ---------- */

function synth(parts, o) {
  var surface = parts.map(function (t) { return t.surface_form; }).join('');
  return {
    surface_form: surface, pos: o.pos || '名詞', pos_detail_1: o.d1 || '一般', pos_detail_2: o.d2 || '*', pos_detail_3: '*',
    conjugated_type: o.ctype || '*', conjugated_form: o.cform || '*', basic_form: o.basic || surface,
    reading: o.reading || '', pronunciation: '', word_type: o.type || 'SYNTH', synth: true, name: !!o.name,
  };
}
/* the reading of a written form whose base form the dictionary reads as baseReading: 顫えて from 顫える ふるえる */
function formReading(surface, base, baseReading) {
  var i = 0;
  while (i < surface.length && i < base.length && surface.charAt(i) === base.charAt(i)) i++;
  var kanaTail = base.slice(i);
  var r = hira(baseReading || '');
  if (!r || !kanaTail || r.slice(-kanaTail.length) !== kanaTail) {
    if (!kanaTail && r) return r + hira(surface.slice(i));
    return '';
  }
  return kata(r.slice(0, r.length - kanaTail.length) + hira(surface.slice(i)));
}

/* Applies Aozora Bunko's furigana (spans of [start, length, reading] in this paragraph), joins names and words the
   tokenizer broke into pieces, and joins a sound word with its と. names: base → reading for the whole text. */
Engine.prototype.repair = function (toks, spans, names) {
  var dict = this.dict, self = this;
  function starts() { var p = [], o = 0; toks.forEach(function (t) { p.push(o); o += t.surface_form.length; }); p.push(o); return p; }
  var at = starts();
  function replace(a, b, t) { toks.splice(a, b - a, t); at = starts(); }
  function known(s) { return dict.has(s) || dict.has(hira(s)); }

  /* 0. a run of kana the tokenizer could not place: it takes the whole run as one unknown word
        (わ + ざとじぶんの, ぐうぐうねむってしまいました). Known words are taken off its front one by one and the rest is
        tokenized again; the kana before it may belong to it (のに + ぎやかな → の + にぎやかな), and after a kanji the
        start of the run may be the rest of a word written half in kana (口 + びるを → 唇 + を). */
  function unknownLen(list) { return list.reduce(function (n, x) { return n + (x.word_type === 'UNKNOWN' ? x.surface_form.length : 0); }, 0); }
  /* Kana the tokenizer could not place, split again into the cheapest run of dictionary words, inflected forms of
     them, and particles (ぐうぐうねむってしまいました → ぐうぐう ねむって しまいました). */
  var oneTok = {};
  function single(p) {
    if (!(p in oneTok)) { var tt = self.tokenizer.tokenize(p); oneTok[p] = tt.length === 1 && tt[0].word_type !== 'UNKNOWN' ? tt[0] : null; }
    return oneTok[p];
  }
  function classPos(c) { return c === 'd' ? '副詞' : c === 'a' ? '形容詞' : c === 'v' ? '動詞' : '名詞'; }
  function peel(str) {
    var n = str.length, best = [{ cost: 0, parts: [] }];
    for (var i = 0; i < n; i++) {
      if (!best[i]) continue;
      for (var len = 1; len <= Math.min(10, n - i); len++) {
        var p = str.slice(i, i + len), cost = null, kind = null, base = null;
        var one = single(p);
        if (len >= 2 && dict.has(p)) {
          var pe = dict.entries(p)[0];
          cost = 1 - pe.rank * 0.1 - Math.min(len, 6) * 0.05; kind = 'word';
        }
        if (cost === null && len >= 2) {
          var bf = len <= 9 && baseForms(p).filter(function (c) {
            return c.b !== p && c.stem >= 2 && INFLECTION.test(p.slice(c.stem)) && dict.has(c.b) && (c.cls === 'v' || c.cls === 'a');
          })[0];
          if (bf) { cost = 1.1 - len * 0.05; kind = 'form'; base = bf; }
        }
        if (cost === null && one && (one.pos === '助詞' || one.pos === '助動詞')) { cost = len >= 2 ? 0.9 : 1.05; kind = 'tok'; }
        if (cost === null && len === 1) { cost = 3; kind = 'char'; }
        if (cost === null) continue;
        var total = best[i].cost + cost;
        if (!best[i + len] || total < best[i + len].cost) best[i + len] = { cost: total, parts: best[i].parts.concat([{ p: p, kind: kind, base: base, one: one }]) };
      }
    }
    var out = [];
    out.cost = best[n].cost;
    best[n].parts.forEach(function (x) {
      if (x.one && x.kind !== 'form') { out.push(x.one); return; }
      if (x.kind === 'word') {
        var c0 = (dict.entries(x.p)[0].senses[0] || {}).c;
        out.push(synth([{ surface_form: x.p }], { pos: classPos(c0), d1: c0 === 'v' || c0 === 'a' ? '自立' : '一般', basic: x.p, reading: kata(x.p), type: 'JOINED' }));
      } else if (x.kind === 'form') {
        out.push(synth([{ surface_form: x.p }], { pos: x.base.cls === 'a' ? '形容詞' : '動詞', d1: '自立', basic: x.base.b, reading: kata(x.p), type: 'JOINED' }));
      } else self.tokenizer.tokenize(x.p).forEach(function (t) { out.push(t); });
    });
    return out;
  }
  for (var z = 0; z < toks.length; z++) {
    var zt = toks[z], zs = zt.surface_form;
    if (zt.word_type !== 'UNKNOWN' || !/^[ぁ-ゖー]{2,}$/.test(zs)) continue;
    var pv0 = toks[z - 1], options = [];
    if (pv0 && allKanji(pv0.surface_form) && pv0.reading && pv0.reading !== '*') {
      for (var kk = zs.length; kk >= 1; kk--) {
        var whole0 = hira(pv0.reading) + zs.slice(0, kk);
        var es0 = dict.entries(whole0).filter(function (e) { return e.k.length && e.rank >= 2 && !e.alt; });
        if (es0.length === 1) {
          var joined = synth([pv0, { surface_form: zs.slice(0, kk) }], { basic: es0[0].k[0], reading: kata(whole0), type: 'JOINED' });
          var restList = kk < zs.length ? peel(zs.slice(kk)) : [];
          options.push({ from: z - 1, list: [joined].concat(restList), cost: 0.4 + (restList.cost || 0) });
          break;
        }
      }
    }
    var prevKana = pv0 && /^[ぁ-ゖ]+$/.test(pv0.surface_form) && !pv0.synth;
    var alone = peel(zs);
    /* the kana before, kept as it is, counts as one more piece */
    options.push({ from: z, list: alone, cost: alone.cost + (prevKana ? 1.05 : 0) });
    if (prevKana) {
      for (var c = 0; c < pv0.surface_form.length; c++) {
        var keep = pv0.surface_form.slice(0, c), give = pv0.surface_form.slice(c), pl = peel(give + zs);
        options.push({ from: z - 1, list: (keep ? self.tokenizer.tokenize(keep) : []).concat(pl), cost: pl.cost + (keep ? 1.05 : 0) });
      }
    }
    /* a run starting with a small kana (ゃいって…) cannot start a word: the two tokens before it go back in too */
    var pv1 = toks[z - 2];
    if (prevKana && /^[ゃゅょっぁぃぅぇぉ]/.test(zs) && pv1 && /^[ぁ-ゖ]+$/.test(pv1.surface_form) && !pv1.synth) {
      var pl2 = peel(pv1.surface_form + pv0.surface_form + zs);
      options.push({ from: z - 2, list: pl2, cost: pl2.cost - 1.05 });
    }
    var bestOpt = null;
    options.forEach(function (o) {
      o.score = unknownLen(o.list) * 10 + (o.cost === undefined ? o.list.length : o.cost);
      if (!bestOpt || o.score < bestOpt.score) bestOpt = o;
    });
    if (bestOpt && unknownLen(bestOpt.list) < zs.length) {
      toks.splice.apply(toks, [bestOpt.from, z + 1 - bestOpt.from].concat(bestOpt.list));
      /* what is still unknown in the new tokens is looked at again */
      z = bestOpt.from - 1;
    }
  }
  at = starts();

  /* 1. the author's furigana */
  (spans || []).forEach(function (sp) {
    var s = sp[0], e = sp[0] + sp[1], reading = kata(sp[2]);
    var a = at.indexOf(s), b = at.indexOf(e);
    if (a >= 0 && b > a) {
      var group = toks.slice(a, b), surface = group.map(function (t) { return t.surface_form; }).join('');
      if (b - a === 1) {
        if (hasKanji(surface) && (!sp[3] || group[0].word_type === 'UNKNOWN')) { group[0].reading = reading; group[0].ruby = true; }
        return;
      }
      var odd = group.some(function (t) { return t.word_type === 'UNKNOWN' || !t.reading || t.reading === '*'; }) ||
        group.every(function (t) { return t.surface_form.length === 1 && allKanji(t.surface_form); });
      if ((known(surface) && !sp[3]) || odd) {
        /* not in the dictionary as written, but its reading is a word written with these kanji: a rarer spelling
           of that word (獣物《けだもの》 is 獣), not a name */
        var kj = Array.from(surface).filter(function (c) { return KANJI.test(c); });
        var same = known(surface) ? null : dict.entries(hira(reading)).filter(function (e) {
          return e.rank >= 2 && e.k.some(function (k) { return kj.some(function (c) { return k.indexOf(c) >= 0; }); });
        })[0];
        var asWord = known(surface) || same;
        replace(a, b, synth(group, { reading: reading, d1: asWord ? '一般' : '固有名詞', name: !asWord, basic: same ? same.k[0] : surface, type: 'RUBY' }));
        toks[a].ruby = true;
      }
      return;
    }
    /* furigana on part of one word (顫《ふる》える read as one token): the token's reading, where every kanji is covered */
    if (sp[3]) return;
    for (var i = 0; i < toks.length; i++) {
      if (at[i] <= s && at[i + 1] >= e && (at[i] < s || at[i + 1] > e)) {
        var t = toks[i], sf = t.surface_form, off = s - at[i], before = sf.slice(0, off), after = sf.slice(off + sp[1]);
        if (!hasKanji(before) && !hasKanji(after)) { t.reading = kata(before) + reading + kata(after); t.ruby = true; }
        break;
      }
    }
  });

  /* 2. kanji the tokenizer did not know, with the single kanji next to them: one name or word (犍 陀 多 → 犍陀多) */
  for (var i = 0; i < toks.length; i++) {
    var t = toks[i];
    if (!(t.word_type === 'UNKNOWN' && allKanji(t.surface_form))) continue;
    var a = i, b = i + 1;
    while (a > 0 && toks[a - 1].surface_form.length === 1 && allKanji(toks[a - 1].surface_form) && !toks[a - 1].synth) a--;
    while (b < toks.length && allKanji(toks[b].surface_form) && (toks[b].word_type === 'UNKNOWN' || toks[b].surface_form.length === 1) && !toks[b].synth) b++;
    if (b - a < 2) continue;
    var grp = toks.slice(a, b), sf = grp.map(function (x) { return x.surface_form; }).join('');
    if (known(sf)) continue;
    replace(a, b, synth(grp, { reading: names && names.get(sf) ? kata(names.get(sf)) : '', d1: '固有名詞', name: true, type: 'NAME' }));
    i = a;
  }
  /* a name that has furigana elsewhere in the text gets that reading here too */
  if (names) toks.forEach(function (t) {
    if ((t.name || t.word_type === 'UNKNOWN') && !t.ruby && names.has(t.surface_form)) { t.reading = kata(names.get(t.surface_form)); t.name = true; }
  });

  /* 3. words broken at a kanji the tokenizer did not know, or at an old spelling: 顫+え → 顫える, 逢+つて → 逢う,
        やつ+ぱり → やっぱり, 帰+つて → 帰る */
  /* 1: a token the tokenizer did not know; 2: a full-size つ standing for っ, which only an old spelling explains */
  function trigger(i) {
    var t = toks[i];
    if (t.synth || t.pos === '記号') return 0;
    if (t.word_type === 'UNKNOWN' && !isKata(t.surface_form)) return 1;
    if (/^つ[てたちつけこかくきさしすせそぱぴぷぺぽ]/.test(t.surface_form) && i > 0) return 2;
    if (t.surface_form === 'つ' && i > 0 && toks[i + 1] && /^[てた]/.test(toks[i + 1].surface_form)) return 2;
    return 0;
  }
  for (var j = 0; j < toks.length; j++) {
    var why = trigger(j);
    if (!why) continue;
    var best = null;
    for (var a2 = Math.max(0, j - 2); a2 <= j; a2++) {
      for (var b2 = j + 1; b2 <= Math.min(toks.length, j + 3); b2++) {
        if (b2 - a2 < 2) continue;
        var grp2 = toks.slice(a2, b2);
        if (grp2.some(function (x) { return x.pos === '記号' || x.synth; })) continue;
        /* a word does not start with a particle, and a full-size つ belongs to the word before it */
        if (grp2[0].pos === '助詞' || grp2[0].pos === '助動詞' || (why === 2 && a2 === j)) continue;
        var sf2 = grp2.map(function (x) { return x.surface_form; }).join('');
        if (sf2.length > 10) continue;
        /* part of a set phrase the dictionary has as written (に + 就て: について) */
        if (a2 > 0 && toks[a2 - 1].pos === '助詞' && dict.has(toks[a2 - 1].surface_form + sf2)) {
          var phrase = toks[a2 - 1].surface_form + sf2, ph = dict.pick(phrase, 'x', '', false);
          if (ph && (!best || 1e6 > best.score)) best = { a: a2 - 1, b: b2, base: phrase, cls: 'x', hit: ph, form: phrase, score: 1e6 };
          continue;
        }
        [sf2].concat(oldVariants(sf2)).forEach(function (form) {
          if (why === 2 && form.indexOf('っ') < 0) return;
          baseForms(form).forEach(function (c) {
            if (c.stem < 1 || c.b.length < 2 || /^[っゃゅょぁぃぅぇぉんー]/.test(c.b) || !dict.has(c.b)) return;
            /* the word must start where the written form starts, and keep its kanji */
            if (c.b.charAt(0) !== form.charAt(0)) return;
            var hit = dict.pick(c.b, c.cls || 'x', '', true);
            if (!hit) return;
            var score = c.stem * 10 - (b2 - a2) - (c.b === form ? 0 : 1);
            /* before て, た or ない the word is a verb or adjective (顫え + て: 顫える, not the noun 顫え) */
            var after = toks[b2];
            if (after && (c.cls === 'v' || c.cls === 'a') && /^(て|で|た|だ|ない|ず|ぬ|ます|れ|られ|せ|させ)/.test(after.surface_form) && (after.pos === '助詞' || after.pos === '助動詞')) score += 2;
            /* いった after a て form is 行った (帰っていった), elsewhere 言った comes first */
            if (c.b === 'いく' && a2 > 0 && /[てで]$/.test(toks[a2 - 1].surface_form)) score += 2;
            /* a full-size つ is only explained by a verb or adjective ending (帰つて, いつた), not by a word as it stands */
            if (why === 2 && c.b === form) return;
            if (!best || score > best.score) best = { a: a2, b: b2, base: c.b, cls: c.cls, hit: hit, form: form, score: score };
          });
        });
      }
    }
    if (!best) continue;
    var g = toks.slice(best.a, best.b), surf = g.map(function (x) { return x.surface_form; }).join('');
    var cls = best.cls || (/[うくぐすつぬぶむる]$/.test(best.base) && best.hit ? 'v' : 'n');
    if (best.score === 1e6) {
      replace(best.a, best.b, synth(toks.slice(best.a, best.b), { pos: '副詞', basic: best.base, reading: kata(best.hit.reading || ''), type: 'JOINED' }));
      j = best.a;
      continue;
    }
    var reading = formReading(surf, best.base, best.hit.reading) || formReading(best.form, best.base, best.hit.reading);
    replace(best.a, best.b, synth(g, {
      pos: cls === 'v' ? '動詞' : cls === 'a' ? '形容詞' : best.base === best.form ? '名詞' : '副詞',
      d1: cls === 'v' || cls === 'a' ? '自立' : '一般', basic: best.base, reading: reading, type: 'JOINED',
      cform: g[g.length - 1].conjugated_form,
    }));
    j = best.a;
  }

  /* a noun suffix the tokenizer put after a particle or at the start is a noun of its own (と 音 → 音 おと) */
  toks.forEach(function (t, i) {
    if (t.pos !== '名詞' || t.pos_detail_1 !== '接尾' || t.pos_detail_2 === '助数詞' || t.pos_detail_2 === '助動詞語幹') return;
    var prev = toks[i - 1];
    if (prev && !(prev.pos === '助詞' || prev.pos === '記号')) return;
    var h = dict.pick(t.surface_form, 'n', '', false);
    if (h && h.reading) { t.pos_detail_1 = '一般'; t.reading = kata(h.reading); }
  });

  /* a "noun" that is a verb's let-us form (入ろう, read にゅうろう by the tokenizer) */
  toks.forEach(function (t, i) {
    var m = /^([㐀-䶿一-鿿]+)(ろう|よう)$/.exec(t.surface_form);
    if (!m || t.pos !== '名詞' || !(toks[i + 1] && /^(じゃ|と|か|よ|ね|。|！|」)/.test(toks[i + 1].surface_form))) return;
    var base = m[1] + 'る', hit = dict.has(base) && dict.pick(base, 'v', '', true);
    if (hit && hit.rank !== 0) {
      t.pos = '動詞'; t.pos_detail_1 = '自立'; t.basic_form = base; t.conjugated_form = '未然ウ接続';
      t.reading = formReading(t.surface_form, base, hit.reading); t.synth = true;
    }
  });

  /* 4. a sound word and its と: ドッ + と → どっと, ハッ + と → はっと */
  for (var k = 0; k + 1 < toks.length; k++) {
    var w = toks[k], nx = toks[k + 1];
    if (nx.surface_form !== 'と' || nx.pos !== '助詞' || !isKana(w.surface_form)) continue;
    var hk = hira(w.surface_form) + 'と';
    if (!/[っッ]$/.test(w.surface_form) && !(w.word_type === 'UNKNOWN' || !dict.has(hira(w.surface_form)))) continue;
    if (dict.has(hk)) replace(k, k + 2, synth([w, nx], { pos: '副詞', basic: hk, reading: kata(hk), type: 'JOINED' }));
  }
  return toks;
};

/* Meaning for a word the dictionary does not have as written. w: the word; head: its first token; surface: the word
   as written (without endings fused on); reading: the reading known for it. Returns { en, reading } or null. */
Engine.prototype.rescue = function (w, head, surface, reading) {
  var dict = this.dict, key = w.key, cls = w.cls;
  function tryKey(k, c, rd, infl) { return k && k !== key ? dict.pick(k, c || cls, rd || '', infl === undefined ? true : infl) : null; }
  var hit = null, i;
  if (LAUGH.test(surface) || LAUGH.test(hira(surface))) return { en: '(laughter)', reading: '' };
  /* a piece of hiragana the tokenizer could not place is a fragment of something, not a word to look up */
  if (head.word_type === 'UNKNOWN' && /^[ぁ-ゖ]+$/.test(surface)) return null;
  /* old spelling: 思ふ → 思う, ゐる → いる, 考へる → 考える, やつぱり → やっぱり */
  var forms = uniq([key, surface]);
  for (i = 0; !hit && i < forms.length; i++) {
    var vs = oldVariants(forms[i]);
    for (var j = 0; !hit && j < vs.length; j++) hit = tryKey(vs[j]);
  }
  if (hit) return hit;
  /* a word ending in と, に, な (漠然と, ぶらりと → ぶらり) */
  if (/[とになだ]$/.test(surface) && surface.length > 2) hit = tryKey(surface.slice(0, -1), '', '', false) || tryKey(hira(surface.slice(0, -1)), '', '', false);
  if (hit) return hit;
  /* kana: in hiragana (モグモグ → もぐもぐ), with と (ドッ → どっと), drawn-out vowels shortened (ザアー → ざあ) */
  if (isKana(surface)) {
    var h = hira(surface);
    var cands = [h, h + 'と', h.replace(/ー+$/, ''), h.replace(/っ$/, '') + 'と', h.replace(/^(.{2,3})\1$/, '$1'), h.replace(/^(.{2,3})\1$/, '$1') + 'と'];
    for (i = 0; !hit && i < cands.length; i++) hit = tryKey(cands[i], '', '', false);
    if (hit) return hit;
  }
  /* older loanword spellings: ストオヴ → ストーブ, シャッタア → シャッター */
  if (isKata(surface)) {
    var lv = loanVariants(surface);
    for (i = 0; !hit && i < lv.length; i++) hit = tryKey(lv[i], '', '', false);
    if (hit) return hit;
  }
  /* a polite prefix (お客 → 客) */
  var pm = /^(お|ご|御)(.+)$/.exec(surface);
  if (pm && pm[2].length >= 1) {
    hit = tryKey(pm[2], '', '', false) || tryKey(pm[2] + 'さん', '', '', false);
    if (hit) return { en: hit.en, reading: '' };
  }
  /* the same word written with kana for one of its kanji, or with other kanji: 気もち (気持ち), 黄いろ (黄色) */
  var rd = hira(reading || '');
  if (rd && rd !== surface && hasKanji(surface)) {
    var kj = Array.from(surface).filter(function (c) { return KANJI.test(c); });
    var list = dict.entries(rd).filter(function (e) {
      return e.k.some(function (k) { return kj.every(function (c) { return k.indexOf(c) >= 0; }); });
    });
    if (list.length) {
      var k0 = list[0].k.filter(function (k) { return kj.every(function (c) { return k.indexOf(c) >= 0; }); })[0];
      hit = dict.pick(k0, cls, rd, false);
      if (hit) return hit;
    }
  }
  /* a written form the tokenizer did not take back to its base form: 入ろう → 入る, 恐ろしく → 恐ろしい */
  if (hasKanji(surface)) {
    var bf = baseForms(surface).filter(function (c) { return c.b !== surface && c.stem >= 1 && c.b.charAt(0) === surface.charAt(0) && dict.has(c.b); });
    bf.sort(function (a, b) { return b.stem - a.stem; });
    for (i = 0; !hit && i < bf.length && i < 6; i++) {
      var hh = dict.pick(bf[i].b, bf[i].cls || cls, '', true);
      if (hh) hit = { en: hh.en, reading: formReading(surface, bf[i].b, hh.reading) ? hira(formReading(surface, bf[i].b, hh.reading)) : '', base: bf[i].b, baseReading: hh.reading };
    }
    if (hit) return hit;
  }
  /* a word with the author's furigana that the dictionary lacks is left to be called a name or rare word */
  if (head.ruby && allKanji(surface) && surface.length >= 2) return null;
  /* a compound the dictionary only has in pieces: 単細胞動物 → single-celled + animal */
  if (surface.length >= 2 && surface.length <= 12) {
    var parts = this.pieces(surface);
    if (parts) return { en: parts.map(function (p) { return p.en; }).join(' + '), reading: '' };
  }
  /* a number and its counter: 500秒 → 500 + second */
  var nc = /^([0-9０-９.,]+)(.+)$/.exec(surface);
  if (nc) { var ch = dict.pick(nc[2], 'n', '', false); if (ch) return { en: nc[1].replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }) + ' ' + ch.en.split(', ')[0], reading: '' }; }
  /* last: what its kanji mean (屹 "towering mountains"), from KANJIDIC */
  var km = this.kanji, means = Array.from(surface).filter(function (c) { return KANJI.test(c); }).map(function (c) { return km.get(c); });
  if (means.length && means.length <= 3 && means.every(Boolean)) {
    return { en: means.map(function (m) { return m.split('; ').slice(0, means.length > 1 ? 1 : 2).join(', '); }).join(' + ') + ' (kanji)', reading: '' };
  }
  return null;
};
/* the fewest dictionary words (two or three) that make up s, with a short gloss each; null when there are none */
Engine.prototype.pieces = function (s) {
  var dict = this.dict, n = s.length, best = new Array(n + 1);
  best[0] = { parts: [] };
  for (var i = 0; i < n; i++) {
    if (!best[i] || best[i].parts.length >= 3) continue;
    for (var j = Math.min(n, i + 8); j > i; j--) {
      var piece = s.slice(i, j);
      if (piece.length === 1 && !KANJI.test(piece)) continue;
      if (!dict.has(piece)) continue;
      var cand = best[i].parts.concat([piece]);
      if (!best[j] || best[j].parts.length > cand.length) best[j] = { parts: cand };
    }
  }
  if (!best[n] || best[n].parts.length < 2) return null;
  if (best[n].parts.every(function (p) { return p.length === 1; }) && !allKanji(s)) return null;
  var out = [];
  for (var k = 0; k < best[n].parts.length; k++) {
    var h = dict.pick(best[n].parts[k], 'n', '', false);
    if (!h) return null;
    out.push({ s: best[n].parts[k], en: h.en.split(', ')[0] });
  }
  return out;
};
/* what to say about a word nothing was found for */
function unknownGloss(surface, reading, head, isName) {
  var h = hira(surface);
  if (LAUGH.test(surface) || LAUGH.test(h)) return '(laughter)';
  if (!isName && isKana(surface) && soundLike(surface)) return '(sound or manner word)';
  var rd = reading || (isKana(surface) ? surface : '');
  var ro = rd ? romaji(rd) : '';
  if (isKata(surface)) return ro + ' (foreign name or word)';
  if (head && head.ruby && !head.name && allKanji(surface) && surface.length >= 2 && ro) return ro + ' (a name or rare word)';
  if (isName || (head && head.pos_detail_1 === '固有名詞')) {
    var kind = head && head.pos_detail_2 === '地域' ? 'place' : head && head.pos_detail_2 === '組織' ? 'organisation' : 'name';
    return ro ? ro + ' (probably a ' + kind + ')' : '(probably a ' + kind + ')';
  }
  return '';
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
  if (/^[!-\/:-@\[-`{-~！-／：-＠［-｀｛-･、。〃〜「」『』【】〔〕（）〈〉《》・…‥]+$/.test(t.surface_form)) return 'PUNCT';
  if (/^[A-Za-zＡ-Ｚａ-ｚ'’]+$/.test(t.surface_form)) return 'PUNCT';
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

/* kanji: lines of kanji.txt (a kanji, a tab, its meanings), for kanji no word explains */
function Engine(tokenizer, lines, kanji) {
  this.tokenizer = tokenizer;
  this.dict = new Dict(lines);
  var km = this.kanji = new Map();
  (kanji || []).forEach(function (l) { var t = l.indexOf('\t'); if (t > 0) km.set(l.slice(0, t), l.slice(t + 1)); });
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
    /* old spelling of a compound: 思ひ出す → 思い出す */
    if (!dict.has(key) && /[ゐゑふへひつ]/.test(key)) key = oldVariants(key).filter(function (v) { return dict.has(v); })[0] || key;
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

Engine.prototype.paragraph = function (text, spans, names) {
  var self = this, dict = this.dict;
  var toks = this.repair(this.tokenizer.tokenize(text), spans, names);
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
      var isNumber = /^[0-9０-９.,，．]+$/.test(head.surface_form);
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
        var spanRuby = spanToks.some(function (t) { return t.ruby; });
        if (hit && !w.minutes && !w.number && w.merged && !w.preLen && !spanName && spanKnown && !spanRuby && !hit.old && hit.reading && hasKanji(w.key)) {
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
        /* nothing found as written: older spellings, sound words, other ways of writing the word, pieces, names */
        var own = w.merged ? w.toks.slice(0, w.mergedN) : w.toks.slice(w.preLen || 0, (w.preLen || 0) + 1);
        var ownSurface = own.map(function (t) { return t.surface_form; }).join('');
        var ownReading = own.map(function (t) { return t.reading && t.reading !== '*' ? t.reading : isKana(t.surface_form) || isKata(t.surface_form) ? t.surface_form : ''; }).join('');
        var isName = head.name || (head.pos_detail_1 === '固有名詞' && !isKata(ownSurface));
        if (!hit && !w.minutes && !w.number && !isName) {
          hit = self.rescue(w, head, ownSurface, ownReading);
          /* found by a different base form: the tokenizer's reading of it was a guess, the dictionary's is used */
          if (hit && hit.reading && hit.base && !head.ruby) {
            var ownFrom = w.merged ? 0 : (w.preLen || 0), ownTo = ownFrom + own.length, fixed = [];
            function addSeg(p) { var ls = fixed[fixed.length - 1]; if (ls && !ls[1] && !p[1]) ls[0] += p[0]; else fixed.push([p[0], p[1]]); }
            w.toks.slice(0, ownFrom).forEach(function (t) { furi(t.surface_form, t.reading).forEach(addSeg); });
            furi(ownSurface, hit.reading).forEach(addSeg);
            w.toks.slice(ownTo).forEach(function (t) { furi(t.surface_form, t.reading).forEach(addSeg); });
            segs = fixed;
            hit = { en: hit.en, reading: hit.baseReading || '' };
          }
        }
        if (hit) { en = hit.en; rd = hit.reading; }
        else en = unknownGloss(ownSurface, ownReading, head, isName);
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
    var g = grammarAt(toks, c.from, c.to, c.words.filter(function (w) { return w.merged && w.mergedN > 1; }).map(function (w) {
      var at = toks.indexOf(w.toks[0]); return [at, at + w.mergedN];
    }));
    if (g.length) item.g = g;
    if (c.head) item.h = c.head;
    if (c.tail) item.t = c.tail;
    if (first) item.d = first;
    return item;
  });
  if (pendingHead) out.push({ x: pendingHead });
  return out;
};

/* ruby: the text's own furigana, [start, length, reading] in text (as Aozora Bunko gives it); may be left out */
Engine.prototype.analyze = function (text, ruby) {
  var self = this, src = String(text).replace(/\r\n?/g, '\n');
  var spans = (Array.isArray(ruby) ? ruby : []).filter(function (r) {
    return Array.isArray(r) && r[0] >= 0 && r[1] > 0 && r[0] + r[1] <= src.length && typeof r[2] === 'string' && /^[ぁ-ゖァ-ヺー]+$/.test(r[2]);
  }).sort(function (a, b) { return a[0] - b[0]; });
  /* a word given furigana once keeps that reading where it comes again without (names, mostly) */
  var names = new Map();
  spans.forEach(function (r) { var base = src.substr(r[0], r[1]); if (hasKanji(base) && !names.has(base)) names.set(base, hira(r[2])); });
  /* where such a word of two kanji or more comes again without furigana, it gets the same, marked as borrowed:
     it is only used where the tokenizer breaks the word up or does not know it (names, mostly) */
  var covered = new Uint8Array(src.length + 1);
  spans.forEach(function (r) { for (var c = r[0]; c < r[0] + r[1]; c++) covered[c] = 1; });
  var more = [];
  names.forEach(function (rd, base) {
    if (base.length < 2 || !/^[㐀-䶿一-鿿豈-﫿々〆ヶ]+$/.test(base)) return;
    var at = src.indexOf(base);
    while (at >= 0) {
      if (!covered[at] && !covered[at + base.length - 1]) more.push([at, base.length, rd, true]);
      at = src.indexOf(base, at + base.length);
    }
  });
  if (more.length) spans = spans.concat(more).sort(function (a, b) { return a[0] - b[0]; });
  var off = 0, n = 0;
  var paras = src.split('\n').map(function (line) {
    var lead = line.length - line.replace(/^[\s　]+/, '').length;
    var trimmed = line.replace(/^[\s　]+|[\s　]+$/g, '');
    var from = off + lead, to = from + trimmed.length, mine = [];
    while (n < spans.length && spans[n][0] < from) n++;
    for (var q = n; q < spans.length && spans[q][0] < to; q++) {
      if (spans[q][0] + spans[q][1] <= to) mine.push([spans[q][0] - from, spans[q][1], spans[q][2], spans[q][3]]);
    }
    off += line.length + 1;
    return trimmed ? self.paragraph(trimmed, mine, names) : [];
  });
  /* collapse runs of blank lines */
  var clean = [];
  paras.forEach(function (p) { if (p.length || (clean.length && clean[clean.length - 1].length)) clean.push(p); });
  while (clean.length && !clean[clean.length - 1].length) clean.pop();
  return { v: VERSION, paras: clean };
};

root.YomuEngine = { VERSION: VERSION, create: function (tokenizer, lines, kanji) { return new Engine(tokenizer, lines, kanji); }, furi: furi, romaji: romaji };
if (typeof module !== 'undefined' && module.exports) module.exports = root.YomuEngine;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);
