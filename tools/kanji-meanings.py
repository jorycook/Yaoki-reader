#!/usr/bin/env python3
"""Makes docs/engine/kanji.txt: an English meaning for each kanji, from KANJIDIC2 (EDRDG).

usage: python3 tools/kanji-meanings.py [path to kanjidic2.xml or kanjidic2.xml.gz] [output file]
Without a path it downloads https://www.edrdg.org/kanjidic/kanjidic2.xml.gz

The reader shows these only for a kanji that no word in the dictionary explains, such as a rare kanji standing on
its own (屹, 匀). One line per kanji: the kanji, a tab, and its first meanings (at most three, joined by '; ').
"""
import gzip
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'https://www.edrdg.org/kanjidic/kanjidic2.xml.gz'


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else None
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, '..', 'docs', 'engine', 'kanji.txt')
    if src is None:
        src = os.path.join(os.environ.get('TMPDIR', '/tmp'), 'kanjidic2.xml.gz')
        urllib.request.urlretrieve(URL, src)
    op = gzip.open if src.endswith('.gz') else open
    rows, lit, means = [], None, []
    with op(src, 'rt', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            m = re.match(r'<literal>(.*)</literal>', line)
            if m:
                lit, means = m.group(1), []
                continue
            m = re.match(r'<meaning>(.*)</meaning>', line)  # English only: other languages carry m_lang
            if m and lit:
                means.append(m.group(1).replace('\t', ' '))
                continue
            if line == '</character>' and lit:
                if means:
                    rows.append(lit + '\t' + '; '.join(means[:3]))
                lit = None
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(rows) + '\n')
    print('%d kanji, %d bytes -> %s' % (len(rows), os.path.getsize(out), out))


if __name__ == '__main__':
    main()
