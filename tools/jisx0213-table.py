#!/usr/bin/env python3
"""Makes docs/aozora/jisx0213.json: the characters Aozora Bunko texts name by their JIS X 0213 place
(※［＃「…」、第3水準1-85-25］) because Shift_JIS cannot hold them. Keys are 'plane-row-cell'; only the places
outside JIS X 0208 (the ones such notes are written for) are listed. Uses Python's own euc_jis_2004 codec.

usage: python3 jisx0213-table.py [output file]"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', 'docs', 'aozora', 'jisx0213.json')
table = {}
# plane 2 of JIS X 0213 uses only these rows; the codec would read the others as JIS X 0212
PLANE2 = {1, 3, 4, 5, 8, 12, 13, 14, 15} | set(range(78, 95))
for plane in (1, 2):
    for row in range(1, 95):
        if plane == 2 and row not in PLANE2:
            continue
        for cell in range(1, 95):
            raw = bytes([0xA0 + row, 0xA0 + cell])
            if plane == 2:
                raw = b'\x8f' + raw
            else:
                try:
                    raw.decode('euc_jp')
                    continue  # in JIS X 0208: Shift_JIS has it, so no note is written for it
                except UnicodeDecodeError:
                    pass
            try:
                ch = raw.decode('euc_jis_2004')
            except UnicodeDecodeError:
                continue
            table['%d-%d-%d' % (plane, row, cell)] = ch
with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(table, f, ensure_ascii=False, separators=(',', ':'))
print(len(table), 'places,', os.path.getsize(OUT), 'bytes ->', OUT)
