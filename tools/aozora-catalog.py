#!/usr/bin/env python3
"""Makes docs/aozora/catalog.txt, the list of Aozora Bunko works the reader can search and add.

usage: python3 aozora-catalog.py [path to list_person_all_extended_utf8.zip or .csv] [output file]

Without a path it downloads Aozora Bunko's own index of works and people:
https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip

Only works that are out of copyright are kept: the work's own copyright flag and the flag of every
person named on it (author, translator, editor) must all be なし. Works whose text file is not on
www.aozora.gr.jp (links to outside sites) are left out, since the reader cannot fetch those.

The file is plain text, one record per line, tab-separated. The first line is '#aozora' and the
newest publication date in the index. Then one line per author, starting '@':
  @, name, reading, name in roman letters
and one line per work:
  work id, card folder (without its leading zeros), text file name (without the work id and '_' in
  front and '.zip' after), title, subtitle, title reading, authors (their places in the author lines,
  from 0, joined by ','), translators (names, joined by '・'), spelling kind
Spelling kind: 0 新字新仮名 (modern), 1 新字旧仮名, 2 旧字旧仮名, 3 旧字新仮名, 4 その他.
Example: 92, 879, ruby_164 is https://www.aozora.gr.jp/cards/000879/files/92_ruby_164.zip
"""
import csv
import io
import os
import re
import sys
import urllib.request
import zipfile

INDEX = 'https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip'
KINDS = {'新字新仮名': 0, '新字旧仮名': 1, '旧字旧仮名': 2, '旧字新仮名': 3}
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'docs', 'aozora', 'catalog.txt')
PREFIX = 'https://www.aozora.gr.jp/cards/'


def read_rows(src):
    if src is None:
        with urllib.request.urlopen(INDEX) as r:
            data = r.read()
        src = io.BytesIO(data)
    elif src.endswith('.csv'):
        with open(src, encoding='utf-8-sig', newline='') as f:
            return list(csv.reader(f))
    with zipfile.ZipFile(src) as z:
        name = next(n for n in z.namelist() if n.endswith('.csv'))
        text = z.read(name).decode('utf-8-sig')
    return list(csv.reader(io.StringIO(text, newline='')))


def person(last, first):
    """Japanese names read family name first; names written in katakana (foreign authors) given name first."""
    if first and re.fullmatch(r'[゠-ヿ]+', last + first):
        return first + '・' + last
    return last + first


def clean(s):
    return ' '.join(s.replace('\t', ' ').split())


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else None
    out = sys.argv[2] if len(sys.argv) > 2 else OUT
    rows = read_rows(src)
    head, rows = rows[0], rows[1:]
    col = {name: i for i, name in enumerate(head)}

    def get(x, name):
        return x[col[name]].strip()

    works = {}
    for x in rows:
        wid = get(x, '作品ID')
        w = works.setdefault(wid, {'rows': [], 'first': x})
        w['rows'].append(x)

    lines, newest, people = [], '', {}
    for wid, w in works.items():
        x = w['first']
        if any(get(r, '作品著作権フラグ') != 'なし' or get(r, '人物著作権フラグ') != 'なし' for r in w['rows']):
            continue
        url = get(x, 'テキストファイルURL')
        if not url.startswith(PREFIX) or not url.endswith('.zip'):
            continue
        folder, _, file = url[len(PREFIX):].partition('/files/')
        if not folder.isdigit() or '/' in file or not file.startswith(wid.lstrip('0') + '_'):
            continue
        authors, trans = [], []
        for r in w['rows']:
            name = clean(person(get(r, '姓'), get(r, '名')))
            role = get(r, '役割フラグ')
            if role == '著者':
                key = (name, clean(person(get(r, '姓読み'), get(r, '名読み'))), clean(get(r, '名ローマ字') + ' ' + get(r, '姓ローマ字')))
                if key not in people:
                    people[key] = len(people)
                authors.append(str(people[key]))
            elif role == '翻訳者':
                trans.append(name)
        if not authors:
            continue
        newest = max(newest, get(x, '公開日'))
        lines.append((
            int(wid),
            [str(int(wid)), str(int(folder)), file[len(wid.lstrip('0')) + 1:-4], clean(get(x, '作品名')), clean(get(x, '副題')),
             clean(get(x, '作品名読み')), ','.join(authors), '・'.join(trans), str(KINDS.get(get(x, '文字遣い種別'), 4))],
        ))
    lines.sort()
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write('#aozora\t' + newest + '\n')
        for key in people:
            f.write('\t'.join(('@',) + key) + '\n')
        for _, cells in lines:
            f.write('\t'.join(cells) + '\n')
    print('%d works by %d authors, newest %s, %d bytes -> %s' % (len(lines), len(people), newest, os.path.getsize(out), out))


if __name__ == '__main__':
    main()
