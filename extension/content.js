/* Yaoki Reader on any web page: touch a Japanese word and keep your finger on it to see the phrase's readings over
   the kanji and the reader's card (the meaning of each word, any grammar pattern); slide to the next word, lift
   your finger and it hides again. With a mouse: hold the button down on a word, or hold Shift and point.
   The text under the finger is found here, its sentence is sent to the engine (background.js, the same engine as
   the reader's) and the phrase holding the touched character is shown. Nothing on the page is changed: readings,
   marks and card are drawn in a layer of their own above it. */
(function () {
'use strict';
var api = typeof browser !== 'undefined' && browser.runtime ? browser : chrome;
if (window.__yaokiReader) return;
window.__yaokiReader = true;

/* ---------- settings (kept by popup.js in storage.local) ---------- */
var DEFAULTS = { on: true, off: [], furigana: true, meanings: true, grammar: true, hold: 1 };
/* how long a finger or the mouse button stays still on a word before it counts as holding it, in ms */
var HOLDS = [120, 220, 400];
var S = Object.assign({}, DEFAULTS);
var dead = false;
function siteOff() { return S.off.indexOf(location.hostname) >= 0; }
function active() { return !dead && S.on && !siteOff(); }
api.storage.local.get('settings').then(function (v) {
  Object.assign(S, v && v.settings);
}).catch(function () {});
api.storage.onChanged.addListener(function (ch, area) {
  if (area !== 'local' || !ch.settings) return;
  S = Object.assign({}, DEFAULTS, ch.settings.newValue);
  if (!active()) release();
  else if (shown) redraw();
});

/* ---------- the character under a point ---------- */
var JA = /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ々-〇〻]|[\ud840-\ud87f][\udc00-\udfff]/;
var KANA = /[぀-ヿｦ-ﾟ]/;

function caretIn(x, y, roots) {
  try {
    if (document.caretPositionFromPoint) {
      var p = roots ? document.caretPositionFromPoint(x, y, { shadowRoots: roots }) : document.caretPositionFromPoint(x, y);
      if (p) return { node: p.offsetNode, offset: p.offset };
    } else if (document.caretRangeFromPoint) {
      var r = document.caretRangeFromPoint(x, y);
      if (r) return { node: r.startContainer, offset: r.startOffset };
    }
  } catch (err) { /* nothing there */ }
  return null;
}
function caretAt(x, y) {
  var hit = caretIn(x, y, null);
  if (hit && hit.node.nodeType === 3) return hit;
  /* text inside a web component's shadow root is only found when its shadow roots are named */
  var roots = [], el = document.elementFromPoint(x, y), sr;
  while (el && el !== host && (sr = shadowOf(el)) && roots.length < 8) {
    roots.push(sr);
    var inner = sr.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  if (roots.length && document.caretPositionFromPoint) hit = caretIn(x, y, roots);
  return hit && hit.node && hit.node.nodeType === 3 ? hit : null;
}
/* a closed shadow root too, where the browser lets an extension see it (Chrome: chrome.dom; Firefox: on the element) */
function shadowOf(el) {
  if (el.shadowRoot) return el.shadowRoot;
  try {
    if (api.dom && api.dom.openOrClosedShadowRoot) return api.dom.openOrClosedShadowRoot(el);
    return el.openOrClosedShadowRoot || null;
  } catch (err) { return null; }
}
var probe = document.createRange();
function charLen(s, i) { var c = s.charCodeAt(i); return c >= 0xd800 && c < 0xdc00 && i + 1 < s.length ? 2 : 1; }
/* The caret lands between characters, on the nearest one even when the point is past the end of a line: the
   character counts as under the point only when its box holds the point (give or take a fingertip's slop). */
function charUnder(hit, x, y, slop) {
  var s = hit.node.data;
  var tries = [hit.offset, hit.offset - 1, hit.offset + 1, hit.offset - 2];
  /* first a character whose box holds the point itself, then one within the slop */
  for (var pass = 0; pass < 2; pass++) {
    var d = pass ? slop : 0;
    if (pass && !slop) break;
    for (var k = 0; k < tries.length; k++) {
      var i = tries[k];
      if (i < 0 || i >= s.length) continue;
      var c = s.charCodeAt(i);
      if (c >= 0xdc00 && c < 0xe000 && i > 0) i--;
      probe.setStart(hit.node, i); probe.setEnd(hit.node, i + charLen(s, i));
      var rects = probe.getClientRects();
      for (var j = 0; j < rects.length; j++) {
        var r = rects[j];
        if (r.width && x >= r.left - d && x <= r.right + d && y >= r.top - d && y <= r.bottom + d) return i;
      }
    }
  }
  return -1;
}

/* ---------- the sentence around it ---------- */
var SKIP = { RT: 1, RP: 1, RTC: 1, SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, TEXTAREA: 1, INPUT: 1, SELECT: 1, OPTION: 1, IFRAME: 1, OBJECT: 1, CANVAS: 1, VIDEO: 1, AUDIO: 1, SVG: 1, MATH: 1 };
/* how far to read either side of the touched character, and how long a line may be before it is cut at its sentences */
var REACH = 600, LONG = 300;
function styleOf(el, memo) {
  var v = memo.get(el);
  if (!v) { v = getComputedStyle(el); memo.set(el, v); }
  return v;
}
function isBlock(el, memo) {
  var d = styleOf(el, memo).display;
  return !(d.indexOf('inline') === 0 || d === 'contents' || d.indexOf('ruby') === 0 || d === 'none');
}
/* the element whose line box the text sits in: the nearest ancestor that is not inline */
function blockOf(node, memo) {
  var el = node.parentNode;
  while (el && el.nodeType === 1) {
    if (el === document.body || el === document.documentElement || isBlock(el, memo)) return el;
    var up = el.parentNode;
    if (!up || up.nodeType !== 1) return el;
    el = up;
  }
  return el;
}
function preserves(el, memo) { var w = styleOf(el, memo).whiteSpace; return w === 'pre' || w === 'pre-wrap' || w === 'pre-line' || w === 'break-spaces'; }

/* The run of inline text the hit is in, as far as REACH either side: it ends at a <br> and where a block starts or
   ends. Returns the text and where each piece of it came from. Text the page hides, ruby readings (rt) and form
   fields are left out; the readings of the page's own ruby go to the engine as its furigana. */
function gather(node, index) {
  var memo = new Map();
  var root = blockOf(node, memo);
  if (!root) return null;
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: function (n) {
      if (n.nodeType === 3) return NodeFilter.FILTER_ACCEPT;
      if (SKIP[n.tagName.toUpperCase()] || n === host) return NodeFilter.FILTER_REJECT;
      if (styleOf(n, memo).display === 'none') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  function stop(n) {
    if (n.nodeType === 1) return n.tagName === 'BR' || isBlock(n, memo);
    return blockOf(n, memo) !== root;
  }
  var before = [], after = [], nb = 0, na = 0, n;
  walker.currentNode = node;
  while (nb < REACH && (n = walker.previousNode())) {
    if (n.nodeType === 1 && n.contains(node)) continue;
    if (stop(n)) break;
    if (n.nodeType === 3) { before.push(n); nb += n.data.length; }
  }
  walker.currentNode = node;
  while (na < REACH && (n = walker.nextNode())) {
    if (stop(n)) break;
    if (n.nodeType === 3) { after.push(n); na += n.data.length; }
  }
  var nodes = before.reverse().concat([node], after);
  var pieces = [], text = '', at = 0;
  nodes.forEach(function (t) {
    var s = t.data, parent = t.parentNode && t.parentNode.nodeType === 1 ? t.parentNode : root;
    /* a line break in the page's source is a space on screen unless the text keeps its line breaks */
    s = preserves(parent, memo) ? s.replace(/\r/g, '\n') : s.replace(/[\n\r\t\f]/g, ' ');
    if (t === node) index += at;
    pieces.push({ node: t, at: at, len: s.length });
    text += s; at += s.length;
  });
  return { text: text, index: index, pieces: pieces, ruby: rubyOf(pieces) };
}
/* the page's own furigana, <ruby>base<rt>reading</rt></ruby>, as [start, length, reading] in the gathered text */
function rubyOf(pieces) {
  var where = new Map(), seen = new Set(), out = [];
  pieces.forEach(function (p) { where.set(p.node, p.at); });
  pieces.forEach(function (p) {
    var el = p.node.parentNode;
    var ruby = el && el.closest ? el.closest('ruby') : null;
    if (!ruby || seen.has(ruby)) return;
    seen.add(ruby);
    var start = -1, len = 0;
    function base(n) {
      if (n.nodeType === 3) {
        if (!where.has(n)) { start = -2; return; }
        if (start === -1) start = where.get(n);
        if (start >= 0) len += n.data.length;
      } else if (n.nodeType === 1 && !SKIP[n.tagName.toUpperCase()]) Array.prototype.forEach.call(n.childNodes, base);
    }
    Array.prototype.forEach.call(ruby.childNodes, function (c) {
      var tag = c.nodeType === 1 ? c.tagName.toUpperCase() : '';
      if (tag === 'RT') {
        var reading = c.textContent.replace(/\s+/g, '');
        if (start >= 0 && len > 0 && /^[ぁ-ゖァ-ヺー]+$/.test(reading)) out.push([start, len, reading]);
        start = -1; len = 0;
      } else if (tag !== 'RP' && tag !== 'RTC') base(c);
    });
  });
  return out;
}
/* What goes to the engine: the line the hit is in (the engine reads a line as one paragraph), cut down to the
   sentence it is in and its neighbours when the line is long. */
var END = /[。！？!?．][」』）)〉》】〕］｝”’"']*/g;
function sentenceAround(text, index) {
  var from = Math.max(text.lastIndexOf('\n', index - 1), text.lastIndexOf('\r', index - 1)) + 1;
  var to = text.length, nl = text.slice(index).search(/[\n\r]/);
  if (nl >= 0) to = index + nl;
  if (to - from <= LONG) return [from, to];
  var line = text.slice(from, to), cuts = [0], m;
  END.lastIndex = 0;
  while ((m = END.exec(line))) if (m.index + m[0].length < line.length) cuts.push(m.index + m[0].length);
  cuts.push(line.length);
  var k = 0, at = index - from;
  while (k < cuts.length - 2 && cuts[k + 1] <= at) k++;
  var a = k, b = k + 1;
  while (true) {
    var grew = false;
    if (a > 0 && cuts[b] - cuts[a - 1] <= LONG) { a--; grew = true; }
    if (b < cuts.length - 1 && cuts[b + 1] - cuts[a] <= LONG) { b++; grew = true; }
    if (!grew) break;
  }
  var s = cuts[a], e = cuts[b];
  /* one sentence longer than that (a list, a heading run on without stops): a stretch either side of the hit */
  if (e - s > LONG * 2) { s = Math.max(s, at - LONG); e = Math.min(e, at + LONG); }
  return [from + s, from + e];
}

/* a place in the gathered text as a point in the page */
function pointAt(g, i, isEnd) {
  var ps = g.pieces, lo = 0, hi = ps.length - 1;
  while (lo < hi) {
    var mid = (lo + hi + 1) >> 1;
    if (ps[mid].at < i || (!isEnd && ps[mid].at === i)) lo = mid; else hi = mid - 1;
  }
  var p = ps[lo];
  return { node: p.node, offset: Math.max(0, Math.min(p.len, i - p.at)) };
}
function rangeOf(g, from, to) {
  var a = pointAt(g, from, false), b = pointAt(g, to, true);
  var r = document.createRange();
  try { r.setStart(a.node, a.offset); r.setEnd(b.node, b.offset); } catch (err) { return null; }
  return r;
}

/* Everything about the place a finger is on: the line sent to the engine and where the hit is in it. Null where
   there is no Japanese under the point. */
function spotAt(x, y, slop) {
  var hit = caretAt(x, y);
  if (!hit || (host && host.contains(hit.node))) return null;
  var i = charUnder(hit, x, y, slop);
  if (i < 0) return null;
  var s = hit.node.data;
  if (!JA.test(s.substr(i, charLen(s, i)))) return null;
  var el = hit.node.parentNode;
  /* text being written (an editor, a comment box) keeps its own long-press: the cursor and selection */
  if (el && el.isContentEditable) return null;
  var langEl = el && el.closest ? el.closest('[lang]') : null;
  var lang = ((langEl && langEl.getAttribute('lang')) || '').toLowerCase();
  if (/^zh|^ko/.test(lang)) return null;
  var g = gather(hit.node, i);
  if (!g) return null;
  var span = sentenceAround(g.text, g.index);
  var text = g.text.slice(span[0], span[1]);
  /* only kanji, with no kana near it and nothing saying the page is Japanese: probably Chinese */
  if (!KANA.test(text) && lang.indexOf('ja') !== 0 && !pageIsJapanese()) return null;
  var ruby = g.ruby.filter(function (r) { return r[0] >= span[0] && r[0] + r[1] <= span[1]; })
    .map(function (r) { return [r[0] - span[0], r[1], r[2]]; });
  return { g: g, from: span[0], text: text, ruby: ruby, at: g.index - span[0], el: el };
}
var japanesePage = false, lookedAt = 0;
function pageIsJapanese() {
  if (japanesePage) return true;
  var lang = (document.documentElement.getAttribute('lang') || '').toLowerCase();
  if (lang.indexOf('ja') === 0) return (japanesePage = true);
  var body = document.body;
  /* a look at the first stretch of the page's text, not more than once every few seconds: kana means Japanese */
  if (!body || Date.now() - lookedAt < 4000) return false;
  lookedAt = Date.now();
  var w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT), n, seen = 0;
  while ((n = w.nextNode()) && seen < 20000) {
    if (KANA.test(n.data)) return (japanesePage = true);
    seen += n.data.length;
  }
  return false;
}

/* ---------- the engine ---------- */
var cache = new Map();
var CACHE = 80;
function keyOf(spot) { return spot.text + '\u0000' + JSON.stringify(spot.ruby); }
/* resolves to the analysis, or to { wait } while the engine is still loading its dictionary */
function analyse(spot) {
  var key = keyOf(spot);
  if (cache.has(key)) {
    var v = cache.get(key);
    cache.delete(key); cache.set(key, v);
    return Promise.resolve({ analysis: v });
  }
  return send({ type: 'yaoki:analyze', text: spot.text, ruby: spot.ruby }).then(function (res) {
    keepAwake(res);
    if (res && res.analysis) {
      cache.set(key, res.analysis);
      if (cache.size > CACHE) cache.delete(cache.keys().next().value);
    }
    return res || { error: 'no answer from the engine' };
  });
}
function send(msg) {
  try {
    return api.runtime.sendMessage(msg).catch(function (err) { return { error: String((err && err.message) || err) }; });
  } catch (err) {
    /* the extension was updated or removed while the page stayed open */
    dead = true;
    return Promise.resolve({ error: 'reload the page to use Yaoki Reader again' });
  }
}

/* The phrase (the engine's chunk) holding the hit, with where each of its pieces is in the line. The engine trims
   the line and cuts it into chunks whose head, words and tail together are exactly the trimmed line. */
function phraseAt(analysis, spot) {
  var para = analysis && analysis.paras && analysis.paras[0];
  if (!para || !para.length) return null;
  var lead = spot.text.length - spot.text.replace(/^[\s　]+/, '').length;
  var trimmed = spot.text.replace(/^[\s　]+|[\s　]+$/g, '');
  var pos = lead, found = null, rebuilt = '';
  para.forEach(function (c) {
    if (!c.w) { pos += (c.x || '').length; rebuilt += c.x || ''; return; }
    pos += (c.h || '').length; rebuilt += c.h || '';
    var start = pos, segs = [];
    c.w.forEach(function (w, wi) {
      w.s.forEach(function (s) {
        segs.push({ from: pos, to: pos + s[0].length, reading: s[1], word: wi });
        pos += s[0].length; rebuilt += s[0];
      });
    });
    var end = pos;
    pos += (c.t || '').length; rebuilt += c.t || '';
    if (!found && spot.at >= start && spot.at < end) found = { c: c, from: start, to: end, segs: segs };
  });
  /* the pieces do not add up to the line (it should not happen): the card can still be shown, but not where it is */
  if (found) found.placed = rebuilt === trimmed;
  return found;
}

/* ---------- what is shown ---------- */
var host = null, root = null, layer = {}, shown = null, highlight = null;
var STYLE = [
  ':host { all: initial; }',
  '.box { --card: #FFFFFF; --ink: #1B2440; --muted: #5A6382; --line: #DDE1EC; --line-strong: #C9D0E3; --outline: #1B2440; --hard: #1B2440;',
  '  --accent: #2F4FD0; --accent-ink: #2F4FD0; --accent-soft: #E8ECFB; --mark: #FFE9B0; --note: #FFF4D6; --stamp: #C7361E;',
  "  --ui: 'Hiragino Maru Gothic ProN', 'M PLUS Rounded 1c', 'Yu Gothic', 'Meiryo', system-ui, sans-serif;",
  "  --jp: 'Hiragino Mincho ProN', 'Yu Mincho', 'Noto Serif JP', 'Noto Serif CJK JP', 'Source Han Serif JP', serif; }",
  '@media (prefers-color-scheme: dark) { .box { --card: #1C233B; --ink: #E8EBF6; --muted: #A6AECA; --line: #2C3554; --line-strong: #3B466C;',
  '  --outline: #7B86B4; --hard: #05070F; --accent: #4560E0; --accent-ink: #A9B8FF; --accent-soft: #262F58; --mark: #5E4B10; --note: #37301A; --stamp: #FF8D76; } }',
  '.box { position: fixed; left: 0; top: 0; width: 0; height: 0; overflow: visible; pointer-events: none; }',
  '.mark { position: fixed; box-sizing: border-box; border-radius: 4px 4px 0 0; border-bottom: 2px solid #1B2440; }',
  '.mark.fill { background: rgba(255, 223, 128, 0.55); mix-blend-mode: multiply; }',
  '.rd { position: fixed; left: 0; top: 0; box-sizing: border-box; white-space: nowrap; padding: 1px 3px; border-radius: 4px; background: var(--card); color: var(--ink);',
  '  border: 1px solid var(--line-strong); font-family: var(--jp); font-weight: 500; line-height: 1; letter-spacing: 0; }',
  '.rd.v { writing-mode: vertical-rl; padding: 3px 1px; }',
  '.card { position: fixed; left: 0; top: 0; box-sizing: border-box; width: max-content; padding: 8px 14px 12px; border-radius: 18px; background: var(--card); color: var(--ink);',
  '  border: 2px solid var(--outline); box-shadow: 0 4px 0 var(--hard); display: flex; flex-direction: column; gap: 8px; transform-origin: 0 0;',
  '  font-family: var(--ui); font-size: 15px; line-height: 1.45; font-weight: 500; text-align: left; white-space: normal; letter-spacing: 0; }',
  '.card[hidden], .rd[hidden] { display: none; }',
  '.lw { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 10px 14px; padding-top: 4px; }',
  '.lc { display: flex; flex-direction: column; align-items: center; gap: 1px; min-width: 0; }',
  '.lj { font-family: var(--jp); font-size: 26px; font-weight: 500; line-height: 46px; white-space: nowrap; }',
  '.lc.f .lj { color: var(--muted); }',
  '.rb { position: relative; }',
  '.rt { position: absolute; left: 50%; bottom: 100%; transform: translateX(-50%); white-space: nowrap; font-family: var(--jp); font-size: 11px; font-weight: 400;',
  '  line-height: 1; margin-bottom: -3px; color: var(--muted); }',
  '.no-furi .rt { visibility: hidden; }',
  '.le { min-height: 15px; max-width: 180px; font-size: 12px; font-weight: 700; line-height: 15px; text-align: center; text-wrap: balance; }',
  '.no-mean .le { display: none; }',
  '.lg { display: flex; align-items: baseline; gap: 8px; padding: 5px 10px; border-radius: 10px; background: var(--accent-soft); line-height: 22px; }',
  '.lg b { flex-shrink: 0; font-size: 11px; font-weight: 800; color: var(--accent-ink); }',
  '.lg span { flex-shrink: 0; font-family: var(--jp); font-size: 15px; font-weight: 600; }',
  '.lg em { font-style: normal; font-size: 12px; font-weight: 700; line-height: 16px; }',
  '.wait { display: flex; flex-direction: column; gap: 8px; max-width: 300px; font-size: 13px; font-weight: 700; }',
  '.wait .ja { font-family: var(--jp); font-size: 16px; font-weight: 600; }',
  '.track { height: 10px; border-radius: 5px; background: var(--line); overflow: hidden; }',
  '.track i { display: block; height: 100%; border-radius: 0 5px 5px 0; background: var(--accent); }',
  '.problem { max-width: 300px; font-size: 13px; font-weight: 700; color: var(--stamp); }',
].join('\n');

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function ensureLayer() {
  if (host && host.isConnected) return;
  host = document.createElement('yaoki-reader-layer');
  host.style.cssText = 'all: initial; position: fixed; left: 0; top: 0; width: 0; height: 0; margin: 0; padding: 0; border: 0; ' +
    'overflow: visible; background: transparent; pointer-events: none; z-index: 2147483647; display: block;';
  /* in the top layer when the browser has one, so the card shows above a page's own dialogs and full-screen parts */
  if (host.showPopover) host.setAttribute('popover', 'manual');
  root = host.attachShadow({ mode: 'closed' });
  var styled = false;
  try {
    var sheet = new CSSStyleSheet();
    sheet.replaceSync(STYLE);
    root.adoptedStyleSheets = [sheet];
    styled = true;
  } catch (err) { styled = false; }
  if (!styled) root.appendChild(el('style', null, STYLE));
  var box = el('div', 'box');
  layer = { box: box, marks: el('div'), readings: el('div'), card: el('div', 'card') };
  layer.card.hidden = true;
  layer.card.setAttribute('role', 'status');
  box.appendChild(layer.marks); box.appendChild(layer.readings); box.appendChild(layer.card);
  root.appendChild(box);
  document.documentElement.appendChild(host);
}
function lift() {
  if (!host.showPopover) return;
  /* shown again each time, so it goes above whatever the page has put in the top layer since */
  try {
    if (host.matches(':popover-open')) host.hidePopover();
    host.showPopover();
  } catch (err) { /* left out of the top layer, which only matters on a page with a dialog open */ }
}
function rubyInto(node, segs, withReading) {
  segs.forEach(function (s) {
    if (s[1] && withReading) {
      var r = el('span', 'rb'); r.appendChild(document.createTextNode(s[0]));
      r.appendChild(el('span', 'rt', s[1]));
      node.appendChild(r);
    } else node.appendChild(document.createTextNode(s[0]));
  });
}
function fillCard(c) {
  var card = layer.card;
  card.textContent = '';
  card.className = 'card' + (S.furigana ? '' : ' no-furi') + (S.meanings ? '' : ' no-mean');
  var row = el('div', 'lw');
  c.w.forEach(function (w) {
    var col = el('div', w.f ? 'lc f' : 'lc');
    var j = el('div', 'lj'); j.lang = 'ja';
    rubyInto(j, w.s, true);
    col.appendChild(j);
    col.appendChild(el('div', 'le', w.e || ' '));
    row.appendChild(col);
  });
  card.appendChild(row);
  if (S.grammar) (c.g || []).forEach(function (g) {
    var line = el('div', 'lg');
    var tag = el('b', null, '文法'); tag.lang = 'ja';
    var pat = el('span', null, g[0]); pat.lang = 'ja';
    line.appendChild(tag); line.appendChild(pat); line.appendChild(el('em', null, g[1]));
    card.appendChild(line);
  });
}
function waitCard(status) {
  var card = layer.card;
  card.textContent = '';
  card.className = 'card';
  var box = el('div', 'wait');
  var ja = el('div', 'ja', '辞書を準備しています…'); ja.lang = 'ja';
  box.appendChild(ja);
  box.appendChild(el('div', null, 'Getting the dictionary ready. The first time takes a few seconds; after that it stays loaded.'));
  var track = el('div', 'track'), bar = el('i');
  bar.style.width = Math.round(100 * ((status && status.done) || 0) / ((status && status.total) || 17)) + '%';
  track.appendChild(bar); box.appendChild(track);
  card.appendChild(box);
}
function problemCard(message) {
  var card = layer.card;
  card.textContent = '';
  card.className = 'card';
  card.appendChild(el('div', 'problem', 'Yaoki Reader could not look this up: ' + message));
}

/* where the visible part of the page is, and how far it is zoomed: the card keeps its size on screen whatever the zoom */
function view() {
  var vv = window.visualViewport;
  if (!vv) return { left: 0, top: 0, width: innerWidth, height: innerHeight, k: 1 };
  var k = 1 / (vv.scale || 1);
  return { left: vv.offsetLeft, top: vv.offsetTop, width: vv.width, height: vv.height, k: Math.max(0.2, Math.min(5, k)) };
}
function placeCard(about, touchy, room) {
  var card = layer.card, v = view();
  card.style.visibility = 'hidden'; card.hidden = false;
  card.style.transform = 'none';
  card.style.maxWidth = Math.max(160, Math.min(560, (v.width / v.k) - 20)) + 'px';
  var w = card.offsetWidth * v.k, h = card.offsetHeight * v.k;
  var gap = 10 * v.k + room;
  var top = about.top - h - gap;
  if (top < v.top + 4) top = about.bottom + (touchy ? 28 : 14) * v.k;
  if (top + h > v.top + v.height - 4) top = Math.max(v.top + 4, v.top + v.height - h - 4);
  var left = about.left + about.width / 2 - w / 2;
  left = Math.max(v.left + 8, Math.min(left, v.left + v.width - w - 8));
  card.style.transform = 'translate(' + Math.round(left) + 'px, ' + Math.round(top) + 'px) scale(' + v.k + ')';
  card.style.visibility = 'visible';
}
function clearMarks() {
  if (!host) return;
  layer.marks.textContent = '';
  layer.readings.textContent = '';
  if (highlight) { try { CSS_HL.delete('yaoki-reader'); } catch (err) { /* gone already */ } highlight = null; }
}
var CSS_HL = window.CSS && window.CSS.highlights && typeof Highlight === 'function' ? window.CSS.highlights : null;
function rectsOf(range) { return Array.prototype.filter.call(range.getClientRects(), function (r) { return r.width > 0 && r.height > 0; }); }
function union(rects) {
  var u = null;
  rects.forEach(function (r) {
    if (!u) u = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    else { u.left = Math.min(u.left, r.left); u.top = Math.min(u.top, r.top); u.right = Math.max(u.right, r.right); u.bottom = Math.max(u.bottom, r.bottom); }
  });
  if (u) { u.width = u.right - u.left; u.height = u.bottom - u.top; }
  return u;
}
function vertical(node) {
  var p = node.parentNode;
  if (!p || p.nodeType !== 1) return false;
  return /^(vertical|sideways)/.test(getComputedStyle(p).writingMode || '');
}
function label(text, upright, size) {
  var e = el('div', upright ? 'rd' : 'rd v', text);
  e.lang = 'ja';
  e.style.fontSize = size + 'px';
  e.style.visibility = 'hidden';
  layer.readings.appendChild(e);
  return e;
}
function sameLine(a, b, upright) {
  return upright ? Math.abs(a.top - b.top) < Math.max(a.height, b.height) / 2 : Math.abs(a.left - b.left) < Math.max(a.width, b.width) / 2;
}
/* whether two readings, each centred on its kanji, would touch */
function clash(a, b, upright) {
  if (upright) return a.box.left + a.box.width / 2 + a.el.offsetWidth / 2 + 1 > b.box.left + b.box.width / 2 - b.el.offsetWidth / 2;
  return a.box.top + a.box.height / 2 + a.el.offsetHeight / 2 + 1 > b.box.top + b.box.height / 2 - b.el.offsetHeight / 2;
}
/* Marks the phrase in the page and puts each reading over its kanji. Returns the box around the phrase and how
   much room the readings take above it. */
function markPhrase(spot, ph) {
  clearMarks();
  var g = spot.g, base = spot.from;
  var range = ph.placed ? rangeOf(g, base + ph.from, base + ph.to) : null;
  var rects = range ? rectsOf(range) : [];
  if (!rects.length) {
    var r = spot.el && spot.el.getBoundingClientRect ? spot.el.getBoundingClientRect() : { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    return { box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }, room: 0 };
  }
  if (CSS_HL) {
    try { highlight = new Highlight(range); CSS_HL.set('yaoki-reader', highlight); } catch (err) { highlight = null; }
  }
  rects.forEach(function (r) {
    var m = el('div', highlight ? 'mark' : 'mark fill');
    m.style.left = r.left + 'px'; m.style.top = r.top + 'px'; m.style.width = r.width + 'px'; m.style.height = r.height + 'px';
    layer.marks.appendChild(m);
  });
  var room = 0, upright = !vertical(range.startContainer);
  if (S.furigana) {
    var px = parseFloat(getComputedStyle(range.startContainer.parentNode).fontSize) || 16;
    var size = Math.max(9 * view().k, Math.min(px * 0.55, 22));
    var labels = [];
    ph.segs.forEach(function (s) {
      if (!s.reading) return;
      var sr = rangeOf(g, base + s.from, base + s.to);
      var box = sr && union(rectsOf(sr).slice(0, 1));
      if (!box) return;
      var it = { to: s.to, reading: s.reading, box: box, el: label(s.reading, upright, size) };
      var prev = labels[labels.length - 1];
      /* a reading is often wider than its kanji: one that would run into the reading over the kanji just before it
         is joined to it (じょうれんきゃく over all of 常連客, not two labels on top of each other) */
      if (prev && prev.to === s.from && sameLine(prev.box, box, upright) && clash(prev, it, upright)) {
        layer.readings.removeChild(prev.el); layer.readings.removeChild(it.el);
        labels.pop();
        it = { to: s.to, reading: prev.reading + s.reading, box: union([prev.box, box]) };
        it.el = label(it.reading, upright, size);
      }
      labels.push(it);
    });
    /* any others that would still touch (kana between them) are moved apart, and all are kept on screen */
    var v = view(), end = -Infinity, line = null;
    labels.forEach(function (it) {
      var w = it.el.offsetWidth, h = it.el.offsetHeight, x, y;
      if (line && !sameLine(line, it.box, upright)) end = -Infinity;
      line = it.box;
      if (upright) {
        x = Math.max(it.box.left + it.box.width / 2 - w / 2, end + 1);
        x = Math.max(v.left + 2, Math.min(x, v.left + v.width - w - 2));
        y = it.box.top - h - 1;
        end = x + w;
        room = Math.max(room, h + 1);
      } else {
        x = it.box.right + 1;
        y = Math.max(it.box.top + it.box.height / 2 - h / 2, end + 1);
        end = y + h;
      }
      it.el.style.transform = 'translate(' + Math.round(x) + 'px, ' + Math.round(y) + 'px)';
      it.el.style.visibility = 'visible';
    });
  }
  return { box: union(rects), room: room };
}

/* the latest place asked for; answers for earlier places are dropped */
var asked = 0, retry = 0, lastPoint = null, lastTouchy = false;
function lookAt(x, y, touchy, found) {
  if (!active()) return false;
  var spot = found || spotAt(x, y, touchy ? 6 : 1);
  if (!spot) return false;
  lastPoint = { x: x, y: y }; lastTouchy = touchy;
  if (shown && shown.key === keyOf(spot) && shown.ph && shown.at >= shown.ph.from && shown.at < shown.ph.to &&
      spot.at >= shown.ph.from && spot.at < shown.ph.to) return true;
  var n = ++asked;
  clearTimeout(retry);
  ensureLayer();
  analyse(spot).then(function (res) {
    if (n !== asked || !holdingAny()) return;
    if (res.analysis) {
      var ph = phraseAt(res.analysis, spot);
      if (!ph) { if (!shown || !shown.ph) hideCard(); return; }
      shown = { key: keyOf(spot), spot: spot, ph: ph, at: spot.at, touchy: touchy };
      redraw();
    } else if (res.wait) {
      shown = { key: '', spot: spot, ph: null, at: -1, touchy: touchy };
      clearMarks(); waitCard(res.wait); lift(); placeCard(boxOfSpot(spot), touchy, 0);
      retry = setTimeout(function () { if (n === asked && holdingAny() && lastPoint) { asked++; lookAt(lastPoint.x, lastPoint.y, lastTouchy); } }, 300);
    } else {
      shown = { key: '', spot: spot, ph: null, at: -1, touchy: touchy };
      clearMarks(); problemCard(res.error || 'unknown error'); lift(); placeCard(boxOfSpot(spot), touchy, 0);
    }
  });
  return true;
}
function boxOfSpot(spot) {
  var r = rangeOf(spot.g, spot.g.index, spot.g.index + 1);
  var u = r && union(rectsOf(r));
  return u || { left: lastPoint.x, top: lastPoint.y, right: lastPoint.x, bottom: lastPoint.y, width: 0, height: 0 };
}
function redraw() {
  if (!shown || !shown.ph) return;
  lift();
  var m = markPhrase(shown.spot, shown.ph);
  fillCard(shown.ph.c);
  placeCard(m.box, shown.touchy, m.room);
}
function hideCard() {
  if (!host) return;
  clearMarks();
  layer.card.hidden = true;
}
function release() {
  asked++;
  clearTimeout(retry);
  shown = null;
  hideCard();
}

/* ---------- touch: hold a word, slide to the next, let go ---------- */
var touch = null, holdTimer = 0, holding = '', lastHold = 0, frame = 0, armed = false;
function holdMs() { return HOLDS[S.hold] || HOLDS[1]; }
function holdingAny() { return !!holding; }
function quiet(on) {
  /* while a word is held the page's own long-press (text selection, link menus) stays out of the way */
  if (on) document.documentElement.setAttribute('data-yaoki-hold', '');
  else document.documentElement.removeAttribute('data-yaoki-hold');
}
/* Safari on iPhone decides whether a long press will select text or open a link's menu when the finger lands, so a
   touch on Japanese text quiets the element it is on (the link it is in, if any) straight away, not only once the
   hold begins; a swipe or a tap gives it back. */
var quieted = null;
function quietHere(target) {
  unquietHere();
  var el = target && (target.nodeType === 1 ? target : target.parentElement);
  if (!el || el === document.documentElement || el === document.body || !ownJapanese(el)) return;
  quieted = (el.closest && el.closest('a[href]')) || el;
  quieted.setAttribute('data-yaoki-hold', '');
}
function unquietHere() {
  if (quieted) { quieted.removeAttribute('data-yaoki-hold'); quieted = null; }
}
function ownJapanese(el) {
  var kids = el.childNodes;
  for (var i = 0; i < kids.length && i < 60; i++) if (kids[i].nodeType === 3 && JA.test(kids[i].data)) return true;
  return false;
}
function startHold(kind) {
  holding = kind;
  quiet(true);
  var sel = window.getSelection && window.getSelection();
  if (sel && sel.rangeCount && kind === 'mouse') sel.removeAllRanges();
}
function endHold() {
  if (!holding) return;
  holding = '';
  lastHold = Date.now();
  release();
  setTimeout(function () { if (!holding) { quiet(false); if (!touch) unquietHere(); } }, 350);
}
function follow(x, y, touchy) {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(function () { if (holding) lookAt(x, y, touchy); });
}
/* A listener that may stop scrolling makes the browser wait for the page before it scrolls, so it is only added on
   pages with Japanese on them (and on the first touch of Japanese on any other page). */
function arm() {
  if (armed) return;
  armed = true;
  window.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
}
function onTouchStart(e) {
  clearTimeout(holdTimer);
  if (!active()) return;
  if (e.touches.length !== 1) { touch = null; endHold(); return; }
  var t = e.touches[0];
  touch = { x: t.clientX, y: t.clientY, cx: t.clientX, cy: t.clientY, moved: false };
  if (!armed && pageIsJapanese()) arm();
  quietHere(e.target);
  holdTimer = setTimeout(function () {
    if (!touch || touch.moved || holding) return;
    var spot = spotAt(touch.cx, touch.cy, 6);
    if (!spot) return;
    startHold('touch');
    lookAt(touch.cx, touch.cy, true, spot);
  }, holdMs());
}
function onTouchMove(e) {
  if (!touch) return;
  var t = e.touches[0];
  if (!t) return;
  touch.cx = t.clientX; touch.cy = t.clientY;
  if (holding === 'touch') {
    /* a move that can no longer be cancelled means the browser is scrolling after all: let the word go */
    if (!e.cancelable) { endHold(); return; }
    e.preventDefault();
    follow(t.clientX, t.clientY, true);
    return;
  }
  if (Math.abs(t.clientX - touch.x) > 10 || Math.abs(t.clientY - touch.y) > 10) {
    touch.moved = true; clearTimeout(holdTimer); unquietHere();
  }
}
function onTouchEnd(e) {
  clearTimeout(holdTimer);
  var held = holding === 'touch';
  if (held) {
    /* lifting the finger after a hold must not click the link or button the word was in */
    if (e.cancelable) e.preventDefault();
    endHold();
  }
  if (!e.touches || !e.touches.length) {
    touch = null;
    if (!held) unquietHere();
  }
}
window.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
if (!armed && pageLooksJapaneseSoon()) arm();
window.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
window.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: false });

/* ---------- mouse: hold the button still on a word, or hold Shift and point ---------- */
var mouse = null, mouseTimer = 0, shiftShown = false, pointer = null;
function editing() {
  var a = document.activeElement;
  return !!a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
}
window.addEventListener('pointerdown', function (e) {
  if (e.pointerType === 'touch' || e.button !== 0 || !active()) return;
  clearTimeout(mouseTimer);
  mouse = { x: e.clientX, y: e.clientY, cx: e.clientX, cy: e.clientY };
  mouseTimer = setTimeout(function () {
    if (!mouse || holding) return;
    var spot = spotAt(mouse.cx, mouse.cy, 1);
    if (!spot) return;
    startHold('mouse');
    lookAt(mouse.cx, mouse.cy, false, spot);
  }, Math.max(250, holdMs()));
}, true);
window.addEventListener('pointermove', function (e) {
  if (e.pointerType === 'touch') return;
  pointer = { x: e.clientX, y: e.clientY };
  if (holding === 'mouse') {
    var sel = window.getSelection && window.getSelection();
    if (sel && sel.rangeCount) sel.removeAllRanges();
    follow(e.clientX, e.clientY, false);
    return;
  }
  if (mouse) {
    mouse.cx = e.clientX; mouse.cy = e.clientY;
    if (Math.abs(e.clientX - mouse.x) > 4 || Math.abs(e.clientY - mouse.y) > 4) { clearTimeout(mouseTimer); mouse = null; }
  }
  if (e.shiftKey && !editing() && active()) {
    if (!holding) holding = 'shift';
    if (holding === 'shift') { shiftShown = true; follow(e.clientX, e.clientY, false); }
  } else if (holding === 'shift') { holding = ''; shiftShown = false; release(); }
}, true);
function mouseUp() {
  clearTimeout(mouseTimer);
  mouse = null;
  if (holding === 'mouse') endHold();
}
window.addEventListener('pointerup', function (e) { if (e.pointerType !== 'touch') mouseUp(); }, true);
window.addEventListener('pointercancel', function (e) { if (e.pointerType !== 'touch') mouseUp(); }, true);
window.addEventListener('keydown', function (e) {
  if (e.key !== 'Shift' || e.repeat || holding || !pointer || editing() || !active()) return;
  holding = 'shift'; shiftShown = true;
  lookAt(pointer.x, pointer.y, false);
}, true);
window.addEventListener('keyup', function (e) {
  if (e.key === 'Shift' && holding === 'shift') { holding = ''; shiftShown = false; release(); }
}, true);
window.addEventListener('blur', function () {
  clearTimeout(holdTimer); clearTimeout(mouseTimer);
  touch = null; mouse = null;
  unquietHere();
  if (holding) { holding = ''; release(); quiet(false); }
});

/* what a hold would otherwise set off: the click of a link it was on, the page's menu, a selection, a drag */
['mousedown', 'click'].forEach(function (type) {
  window.addEventListener(type, function (e) {
    if (Date.now() - lastHold < 500) { e.preventDefault(); e.stopPropagation(); }
  }, true);
});
window.addEventListener('contextmenu', function (e) {
  if (holding === 'touch' || holding === 'mouse' || Date.now() - lastHold < 600) e.preventDefault();
}, true);
['selectstart', 'dragstart'].forEach(function (type) {
  window.addEventListener(type, function (e) { if (holding === 'touch' || holding === 'mouse') e.preventDefault(); }, true);
});
/* the page moved under a held word: show what is under the finger now; otherwise put it away */
window.addEventListener('scroll', function () {
  if (!shown) return;
  if (holding && lastPoint) follow(lastPoint.x, lastPoint.y, lastTouchy); else release();
}, { capture: true, passive: true });
window.addEventListener('resize', function () { if (shown && !holding) release(); });

/* ---------- getting ready ---------- */
/* On a page with Japanese the engine is woken as soon as the page settles, so the first touch need not wait for
   the dictionary to load. */
function pageLooksJapaneseSoon() {
  var lang = (document.documentElement.getAttribute('lang') || '').toLowerCase();
  return lang.indexOf('ja') === 0;
}
function warm() {
  if (!active() || !pageIsJapanese()) return;
  arm();
  if (window === window.top) send({ type: 'yaoki:warm' }).then(keepAwake);
}
/* Where the browser closes the engine's background page when it has been idle (Safari), an open page with Japanese
   on it pings it every 20 s for a quarter of an hour after it opened or was last used, while it is on screen, so
   the next touch does not wait for the dictionary to load again. */
var KEEP = 15 * 60 * 1000, keepUntil = 0, keepTimer = 0;
function keepAwake(res) {
  if (!res || !res.keep) return;
  keepUntil = Date.now() + KEEP;
  if (keepTimer) return;
  keepTimer = setInterval(function () {
    if (Date.now() > keepUntil || dead) { clearInterval(keepTimer); keepTimer = 0; return; }
    if (document.visibilityState === 'visible') send({ type: 'yaoki:ping' });
  }, 20000);
}
if (window.requestIdleCallback) requestIdleCallback(warm, { timeout: 3000 }); else setTimeout(warm, 1500);

/* the toolbar panel asks which site this tab shows */
api.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || msg.type !== 'yaoki:site' || window !== window.top) return false;
  sendResponse({ host: location.hostname, japanese: pageIsJapanese() });
  return false;
});
})();
