#!/usr/bin/env python3
"""Makes docs/engine/jm-3.txt, the supplement to the reader's word list (jm-1.txt and jm-2.txt, JMdict 2020).

usage: python3 tools/jm-supplement.py [path to JMdict_e or JMdict_e.gz] [output file]
Without a path it downloads the current JMdict_e from https://www.edrdg.org/pub/Nihongo/JMdict_e.gz

The word list is left as it is (phones keep it once downloaded); the supplement adds, from a newer JMdict:
  1. words the list does not have, in the list's own format:
       kanji forms (;) TAB readings (;) TAB rank+flags TAB senses
     rank: 3 common (ichi1, news1, spec1, gai1), 2 less common (ichi2, news2, spec2, gai2), 0 otherwise;
     flags: u when the first sense is usually written in kana. Senses: class letter (n noun, v verb,
     a i-adjective, d adverb, x other) and the glosses, separated by '|'; at most three senses.
  2. spellings the list's words lack (rare and old kanji forms such as 顫える for 震える, kana forms such as
     ストーヴ), one per line:  =spelling TAB kanji form TAB reading  (the list's line with that first
     kanji form, or reading when it has none, and that first reading)
  3. for kana spellings shared by several words, how usual it is to write each word in kana, one per line:
       ?kana TAB kanji form TAB reading TAB score
     The score (0 to 20) weighs: the share of the word's senses JMdict marks as usually written in kana,
     whether all its kanji forms are rare, how many senses the word has, and whether it is common.
     It helps decide, say, that なる in kana is 成る "to become" and not 生る "to bear fruit".
"""
import gzip
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.join(HERE, '..', 'docs', 'engine')
URL = 'https://www.edrdg.org/pub/Nihongo/JMdict_e.gz'
TAG = re.compile(r'<(\w+)>(.*)</\1>')
RARE_K = {'rK', 'sK', 'oK', 'iK', 'ateji'}
COMMON = {'ichi1', 'news1', 'spec1', 'gai1'}
LESS = {'ichi2', 'news2', 'spec2', 'gai2'}


def parse(path):
    """JMdict_e holds one element per line; entities such as &n; are kept as their names."""
    op = gzip.open if path.endswith('.gz') else open
    ents, e, cur = [], None, None
    with op(path, 'rt', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line == '<entry>':
                e = {'k': [], 'r': [], 's': []}
            elif line == '</entry>':
                ents.append(e)
                e = None
            elif e is None:
                continue
            elif line == '<k_ele>':
                cur = {'t': '', 'inf': [], 'pri': []}
                e['k'].append(cur)
            elif line == '<r_ele>':
                cur = {'t': '', 'inf': [], 'pri': [], 'restr': [], 'nokanji': False}
                e['r'].append(cur)
            elif line == '<sense>':
                cur = {'pos': [], 'misc': [], 'gloss': [], 'stagk': [], 'stagr': []}
                e['s'].append(cur)
            elif line == '<re_nokanji/>':
                cur['nokanji'] = True
            else:
                m = TAG.match(line) or re.match(r'<(gloss)[^>]*>(.*)</gloss>', line)
                if not m:
                    continue
                tag, val = m.group(1), m.group(2)
                ent = re.fullmatch(r'&([\w-]+);', val)
                if ent:
                    val = ent.group(1)
                if tag in ('keb', 'reb'):
                    cur['t'] = val
                elif tag in ('ke_inf', 're_inf'):
                    cur['inf'].append(val)
                elif tag in ('ke_pri', 're_pri'):
                    cur['pri'].append(val)
                elif tag == 're_restr':
                    cur['restr'].append(val)
                elif tag in ('pos', 'misc', 'gloss', 'stagk', 'stagr') and 'pos' in cur:
                    cur[tag].append(val)
    return ents


def cls(pos):
    """The list's class letter for a sense, from its JMdict parts of speech (the first that decides)."""
    for p in pos:
        if p.startswith('v') and p not in ('vidg',):
            return 'v'
        if p in ('adj-i', 'adj-ix'):
            return 'a'
        if p.startswith('adv'):
            return 'd'
        if p.startswith('n') or p in ('adj-na', 'adj-no', 'pn', 'ctr', 'suf', 'pref'):
            return 'n'
    return 'x'


def rank(pri):
    if COMMON & set(pri):
        return 3
    if LESS & set(pri):
        return 2
    return 0


def nf(pri):
    for p in pri:
        if p.startswith('nf'):
            return int(p[2:])
    return 99


def line_of(e):
    ks = [k['t'] for k in e['k'] if not (set(k['inf']) & {'sK'})]
    rs = [r['t'] for r in e['r'] if 'sk' not in r['inf']]
    pri = [p for x in e['k'] + e['r'] for p in x['pri']]
    flags = str(rank(pri)) + ('u' if e['s'] and 'uk' in e['s'][0]['misc'] else '')
    senses, last = [], 'x'
    for s in e['s'][:3]:
        c = cls(s['pos']) if s['pos'] else last
        last = c
        g = '; '.join(s['gloss'][:4]).replace('\t', ' ').replace('|', '/')
        if g:
            senses.append(c + g)
    if not rs or not senses:
        return None
    return '\t'.join([';'.join(ks), ';'.join(rs), flags, '|'.join(senses)])


def kana_score(e, kana):
    """How likely this word is meant when `kana` is written. JMdict's frequency tags on a kana spelling count every
    word written that way, so they cannot tell the words apart; what can: the share of the word's senses marked as
    usually written in kana, kanji forms that are all rare, and how many senses the word has (the general word for
    a spelling has many, a specialised one few: 成る has eleven, 生る "to bear fruit" one)."""
    r = next((x for x in e['r'] if x['t'] == kana), None)
    if r is None:
        return 0
    senses = e['s'] or [{'misc': []}]
    uk = sum('uk' in s['misc'] for s in senses) / len(senses)
    score = uk * 6
    if 'uk' in senses[0]['misc']:
        score += 1
    if not e['k'] or all(set(k['inf']) & RARE_K for k in e['k']) or r['nokanji']:
        score += 4
    score += min(len(senses), 10) * 0.6
    score += {3: 2, 2: 1, 0: 0}[rank([p for x in e['k'] + e['r'] for p in x['pri']])]
    if set(senses[0]['misc']) & {'arch', 'obs', 'rare', 'obsc'}:
        score -= 3
    return max(0, min(20, round(score)))


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else None
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ENGINE, 'jm-3.txt')
    if src is None:
        src = os.path.join(os.environ.get('TMPDIR', '/tmp'), 'JMdict_e.gz')
        urllib.request.urlretrieve(URL, src)
    ents = parse(src)

    # the list's lines: first kanji form (or ''), all kanji forms, all readings
    have = []
    for name in ('jm-1.txt', 'jm-2.txt'):
        with open(os.path.join(ENGINE, name), encoding='utf-8') as f:
            for line in f:
                p = line.rstrip('\n').split('\t')
                if len(p) < 4:
                    continue
                have.append((p[0].split(';') if p[0] else [], p[1].split(';')))
    by_k, by_r = {}, {}
    for i, (ks, rs) in enumerate(have):
        for k in ks:
            by_k.setdefault(k, []).append(i)
        for r in rs:
            by_r.setdefault(r, []).append(i)

    def match(e):
        """The list's line for a JMdict entry: one sharing a kanji form and a reading, or for a word without
        kanji, one without kanji sharing a reading."""
        ks = [k['t'] for k in e['k']]
        rs = [r['t'] for r in e['r']]
        best, best_n = None, 0
        cand = set()
        for k in ks:
            cand.update(by_k.get(k, []))
        if not ks:
            for r in rs:
                cand.update(i for i in by_r.get(r, []) if not have[i][0])
        for i in cand:
            hk, hr = have[i]
            n = len(set(hk) & set(ks)) * 2 + len(set(hr) & set(rs))
            if set(hr) & set(rs) and n > best_n:
                best, best_n = i, n
        return best

    new_lines, aliases, kana_rows = [], [], []
    ref = lambda i: (have[i][0][0] if have[i][0] else '', have[i][1][0])
    matched = {}
    for e in ents:
        i = match(e)
        if i is None:
            line = line_of(e)
            if line:
                new_lines.append(line)
            continue
        matched[id(e)] = i
        hk, hr = have[i]
        k0, r0 = ref(i)
        for k in e['k']:
            if k['t'] not in hk and k['t'] not in by_k:
                aliases.append('=%s\t%s\t%s' % (k['t'], k0, r0))
        for r in e['r']:
            if r['t'] not in hr and r['t'] not in by_r and 'sk' not in r['inf']:
                aliases.append('=%s\t%s\t%s' % (r['t'], k0, r0))

    # kana spellings several of the list's words share
    by_kana = {}
    for e in ents:
        if id(e) not in matched:
            continue
        for r in e['r']:
            by_kana.setdefault(r['t'], []).append(e)
    for kana, es in by_kana.items():
        lines = {matched[id(e)] for e in es}
        if len(lines) < 2:
            continue
        for e in es:
            k0, r0 = ref(matched[id(e)])
            s = kana_score(e, kana)
            if s:
                kana_rows.append('?%s\t%s\t%s\t%d' % (kana, k0, r0, s))

    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        for block in (new_lines, sorted(set(aliases)), kana_rows):
            for line in block:
                f.write(line + '\n')
    print('%d new words, %d spellings, %d kana scores, %d bytes -> %s' % (
        len(new_lines), len(set(aliases)), len(kana_rows), os.path.getsize(out), out))


if __name__ == '__main__':
    main()
