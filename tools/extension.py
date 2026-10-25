#!/usr/bin/env python3
"""Builds the browser extension (extension/) with the reader's engine (docs/engine/) into dist/.

usage: python3 tools/extension.py

The extension's own files are in extension/; the engine and its dictionary are the reader's, copied in at build
time so there is one copy of them in the repository. Each browser gets a folder and a zip:
  dist/chrome/   dist/yaoki-reader-chrome.zip    Chrome, Edge and other Chromium browsers (Load unpacked, or the zip
                                                 for the Chrome Web Store and Edge Add-ons)
  dist/firefox/  dist/yaoki-reader-firefox.zip   Firefox and Firefox for Android (about:debugging, or the zip for
                                                 addons.mozilla.org, which signs it)
  dist/safari/   dist/yaoki-reader-safari.zip    Safari on a Mac, iPhone and iPad, made into an app by Xcode
                                                 (xcrun safari-web-extension-packager dist/safari) or by the
                                                 Safari Web Extension Packager in App Store Connect (the zip)
They differ in their manifest and in where the engine is kept running, since it takes seconds to load:
  Chrome: the background is a service worker, which cannot hold it; it runs in an offscreen document (host.html),
          which stays open.
  Firefox: Manifest V2, whose background page can stay loaded (Firefox closes a Manifest V3 one after 30 s idle).
  Safari: a background page that is not persistent (the only kind iPhone allows); pages with Japanese on them keep
          it awake while they are open (content.js), and Safari before 18.4 needs its scripts marked as UTF-8.
"""
import base64
import gzip
import hashlib
import json
import os
import shutil
import subprocess
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOP = os.path.join(HERE, '..')
SRC = os.path.join(TOP, 'extension')
ENGINE = os.path.join(TOP, 'docs', 'engine')
DIST = os.path.join(TOP, 'dist')
GECKO_ID = 'yaoki-reader@jorycook.github.io'

# the engine's files: worker.js loads the scripts beside it, and they load the dictionary from beside them
ENGINE_FILES = ['worker.js', 'kuromoji.js', 'analyzer.js', 'boot.js', 'jm-1.txt', 'jm-2.txt', 'jm-3.txt', 'kanji.txt']
COMMON = ['background.js', 'host.js', 'content.js', 'content.css', 'popup.html', 'popup.js', 'icons']
CHROME_ONLY = ['host.html', 'host-offscreen.js']


def chrome(m):
    return m


def firefox(m):
    m = dict(m)
    m['manifest_version'] = 2
    m['background'] = {'scripts': ['host.js', 'background.js'], 'persistent': True}
    m['browser_action'] = m.pop('action')
    m['permissions'] = [p for p in m['permissions'] if p != 'offscreen']
    m.pop('minimum_chrome_version', None)
    m['browser_specific_settings'] = {
        'gecko': {
            'id': GECKO_ID,
            'strict_min_version': '140.0',
            # nothing a page holds or a user does is collected or sent anywhere
            'data_collection_permissions': {'required': ['none']},
        },
        'gecko_android': {'strict_min_version': '142.0'},
    }
    return m


def safari(m):
    m = dict(m)
    m['background'] = {'scripts': ['host.js', 'background.js'], 'persistent': False}
    m['permissions'] = [p for p in m['permissions'] if p != 'offscreen']
    m.pop('minimum_chrome_version', None)
    return m


# name, manifest, the offscreen document's files, a byte order mark on scripts
TARGETS = [('chrome', chrome, True, False), ('firefox', firefox, False, False), ('safari', safari, False, True)]


def copy(src, dst):
    if os.path.isdir(src):
        shutil.copytree(src, dst)
    else:
        shutil.copy2(src, dst)


def mark_utf8(folder):
    for base, dirs, files in os.walk(folder):
        for f in files:
            if f.endswith('.js'):
                full = os.path.join(base, f)
                with open(full, 'rb') as fh:
                    data = fh.read()
                if not data.startswith(b'\xef\xbb\xbf'):
                    with open(full, 'wb') as fh:
                        fh.write(b'\xef\xbb\xbf' + data)


def fingerprint(files):
    digest = hashlib.sha256()
    for f in files:
        with open(f, 'rb') as fh:
            digest.update(fh.read())
    return digest.hexdigest()


def made_from(out, files):
    """Whether out was made from these very files (it is kept with their fingerprint), so that it need not be made
    again: packing the dictionary and making the index take some seconds each."""
    stamp = out + '.from'
    return os.path.exists(out) and os.path.exists(stamp) and open(stamp).read() == fingerprint(files)


def stamp_from(out, files):
    with open(out + '.from', 'w') as fh:
        fh.write(fingerprint(files))


def packed_dict():
    """pack_dict once for all builds, in dist/dict."""
    out = os.path.join(DIST, 'dict')
    files = [os.path.join(ENGINE, 'dict', n) for n in sorted(os.listdir(os.path.join(ENGINE, 'dict')))] + [os.path.abspath(__file__)]
    if not made_from(out, files):
        if os.path.exists(out):
            shutil.rmtree(out)
        pack_dict(out)
        stamp_from(out, files)
    return out


def pack_dict(out):
    """The tokenizer dictionary as the extension reads it: gzip binary (name.dat.gz) rather than the reader's base64
    text, so the browser unpacks it itself, and without the zeros that pad most files (64.6 MB of real data in
    100 MB): the tokenizer reads past a file's end as zeros anyway. One zero is kept, and each file stays a whole
    number of 4-byte ints."""
    os.makedirs(out)
    for name in sorted(os.listdir(os.path.join(ENGINE, 'dict'))):
        if not name.endswith('.dat.b64.txt'):
            continue
        with open(os.path.join(ENGINE, 'dict', name), encoding='ascii') as f:
            raw = base64.b64decode(f.read())
        if raw[:2] == b'\x1f\x8b':
            raw = gzip.decompress(raw)
        n = min(len(raw), (len(raw.rstrip(b'\0')) + 1 + 3) // 4 * 4)
        with open(os.path.join(out, name[:-len('.b64.txt')] + '.gz'), 'wb') as f:
            f.write(gzip.compress(raw[:n], 9, mtime=0))


def make_index():
    """The engine's word index made ahead of time (tools/jm-index.js, by the engine's own code), once for all
    builds."""
    out = os.path.join(DIST, 'jm-index.bin.gz')
    files = [os.path.join(ENGINE, f) for f in ('analyzer.js', 'jm-1.txt', 'jm-2.txt', 'jm-3.txt')] + [os.path.join(HERE, 'jm-index.js')]
    if not made_from(out, files):
        subprocess.run(['node', os.path.join(HERE, 'jm-index.js'), out], check=True)
        stamp_from(out, files)
    return out


def build(name, shape, offscreen, bom, index, dict_dir):
    out = os.path.join(DIST, name)
    if os.path.exists(out):
        shutil.rmtree(out)
    os.makedirs(out)
    with open(os.path.join(SRC, 'manifest.json'), encoding='utf-8') as f:
        manifest = shape(json.load(f))
    with open(os.path.join(out, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write('\n')
    for item in COMMON + (CHROME_ONLY if offscreen else []):
        copy(os.path.join(SRC, item), os.path.join(out, item))
    os.makedirs(os.path.join(out, 'engine'))
    for item in ENGINE_FILES:
        copy(os.path.join(ENGINE, item), os.path.join(out, 'engine', item))
    copy(dict_dir, os.path.join(out, 'engine', 'dict'))
    copy(index, os.path.join(out, 'engine', 'jm-index.bin.gz'))
    copy(os.path.join(TOP, 'docs', 'licenses.txt'), os.path.join(out, 'licenses.txt'))
    if bom:
        mark_utf8(out)
    return out, manifest['version']


def pack(folder, zip_path):
    if os.path.exists(zip_path):
        os.remove(zip_path)
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for base, dirs, files in os.walk(folder):
            dirs.sort()
            for f in sorted(files):
                full = os.path.join(base, f)
                z.write(full, os.path.relpath(full, folder))


def main():
    os.makedirs(DIST, exist_ok=True)
    index, dict_dir = make_index(), packed_dict()
    for name, shape, offscreen, bom in TARGETS:
        folder, version = build(name, shape, offscreen, bom, index, dict_dir)
        zip_path = os.path.join(DIST, 'yaoki-reader-%s.zip' % name)
        pack(folder, zip_path)
        print('dist/%s/  dist/%s (%.1f MB)  version %s' % (name, os.path.basename(zip_path), os.path.getsize(zip_path) / 1e6, version))


if __name__ == '__main__':
    main()
