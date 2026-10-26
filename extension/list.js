/* The list of words looked up (のぞいた語句): read from the browser's extension storage ('looked', kept by
   background.js), shown newest first, searchable; one entry or all can be deleted; saved as a file for Anki or
   the sentences copied. Nothing leaves this device. */
(function () {
'use strict';
var api = typeof browser !== 'undefined' && browser.runtime ? browser : chrome;
var list = [], filter = '';
function $(id) { return document.getElementById(id); }
function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
var toastTimer = 0;
function toast(msg) {
  var t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.hidden = true; }, 2200);
}
function day(ms) {
  try { return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (err) { return ''; }
}
function matches(e) {
  if (!filter) return true;
  return [e.w, e.r, e.e, e.s, e.t].some(function (v) { return v && v.toLowerCase().indexOf(filter) >= 0; });
}
function render() {
  var box = $('list'), shown = list.filter(matches);
  box.textContent = '';
  shown.forEach(function (e) {
    var li = el('li');
    var head = el('div', 'head');
    var w = el('span', 'w', e.w); w.lang = 'ja'; head.appendChild(w);
    if (e.r) { var r = el('span', 'r', e.r); r.lang = 'ja'; head.appendChild(r); }
    if (e.n > 1) head.appendChild(el('span', 'n', '×' + e.n));
    li.appendChild(head);
    li.appendChild(el('div', 'g', e.e || 'No dictionary entry found.'));
    if (e.s) {
      var s = el('div', 's'); s.lang = 'ja';
      s.appendChild(document.createTextNode(e.s.slice(0, e.a)));
      if (e.b > e.a) s.appendChild(el('b', null, e.s.slice(e.a, e.b)));
      s.appendChild(document.createTextNode(e.s.slice(e.b)));
      li.appendChild(s);
    }
    var src = el('div', 'src');
    if (e.u) {
      var a = el('a', null, e.t || e.u); a.href = e.u; a.target = '_blank'; a.rel = 'noopener';
      src.appendChild(a);
    } else if (e.t) src.appendChild(el('span', null, e.t));
    src.appendChild(el('span', null, day(e.at)));
    li.appendChild(src);
    var x = el('button', 'x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Delete ' + e.w);
    x.addEventListener('click', function () { remove(e); });
    li.appendChild(x);
    box.appendChild(li);
  });
  $('empty').hidden = list.length > 0;
  $('count').textContent = !list.length ? '' : filter ? shown.length + ' of ' + list.length + ' words' : list.length + (list.length === 1 ? ' word' : ' words');
  ['anki', 'copy', 'clear'].forEach(function (id) { $(id).disabled = !list.length; });
}
function save(next) {
  list = next;
  return api.storage.local.set({ looked: list, lookedHead: { n: list.length, recent: list.slice(0, 5) } });
}
function remove(e) { save(list.filter(function (x) { return x !== e; })).then(render); }

api.storage.local.get('looked').then(function (v) {
  list = Array.isArray(v && v.looked) ? v.looked : [];
  render();
});
/* another tab added a word while this page was open */
api.storage.onChanged.addListener(function (ch, area) {
  if (area !== 'local' || !ch.looked) return;
  list = Array.isArray(ch.looked.newValue) ? ch.looked.newValue : [];
  render();
});
$('filter').addEventListener('input', function () { filter = $('filter').value.trim().toLowerCase(); render(); });

/* Anki's import takes a tab-separated text file; its first lines say so and that the fields hold HTML (for the
   bold phrase in the sentence) */
function tsv() {
  var esc = function (s) { return String(s || '').replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }).replace(/[\t\n\r]+/g, ' '); };
  var lines = ['#separator:tab', '#html:true', '#columns:word\treading\tmeaning\tsentence\tsource'];
  list.filter(matches).forEach(function (e) {
    var sentence = e.s ? esc(e.s.slice(0, e.a)) + '<b>' + esc(e.s.slice(e.a, e.b)) + '</b>' + esc(e.s.slice(e.b)) : '';
    lines.push([esc(e.w), esc(e.r), esc(e.e), sentence, esc(e.t || e.u)].join('\t'));
  });
  return lines.join('\n') + '\n';
}
$('anki').addEventListener('click', function () {
  var blob = new Blob([tsv()], { type: 'text/tab-separated-values;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'yaoki-reader-words.txt';
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
});
$('copy').addEventListener('click', function () {
  var text = list.filter(matches).map(function (e) { return e.s || e.x || e.w; }).join('\n');
  navigator.clipboard.writeText(text).then(function () { toast('Copied. Paste into the Yaoki Reader app as a text to read.'); }, function () { toast('Could not copy.'); });
});
$('clear').addEventListener('click', function () { $('confirm').hidden = false; });
$('clear-no').addEventListener('click', function () { $('confirm').hidden = true; });
$('clear-yes').addEventListener('click', function () { $('confirm').hidden = true; save([]).then(render); });
})();
