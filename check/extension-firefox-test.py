#!/usr/bin/env python3
"""Checks the Firefox build of the extension (dist/firefox, made by tools/extension.py) in Firefox: a finger or the
mouse held on a word shows the card and marks the phrase, sliding moves the mark, lifting hides both, a held link is
not followed, a swipe still scrolls, the card is styled under a strict Content-Security-Policy, and the toolbar
panel sees the dictionary loaded.

usage: FIREFOX=<firefox binary> GECKODRIVER=<geckodriver> python3 extension-firefox-test.py
Needs Selenium 4.2x or later (pip install selenium; PYTHONPATH may point at it) and Pillow.
The extension's card is in a closed shadow root that WebDriver cannot read, so what is shown is read from
screenshots: the card's outline colour above the word, the marker colour on the phrase.
"""
import http.server
import os
import subprocess
import sys
import tempfile
import threading
import time
from io import BytesIO

from PIL import Image
from selenium import webdriver
from selenium.webdriver.common.actions import interaction
from selenium.webdriver.common.actions.action_builder import ActionBuilder
from selenium.webdriver.common.actions.pointer_input import PointerInput
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service

TOP = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
EXT = os.path.join(TOP, 'dist', 'firefox')
fails = 0


def ok(cond, msg):
    global fails
    print(('  ok: ' if cond else '  FAIL: ') + msg)
    if not cond:
        fails += 1


def step(msg):
    print('-- ' + msg)


PAGES = {
    'plain.html': '''<!doctype html><html lang="ja"><meta charset="utf-8"><title>plain</title>
<body style="margin:0;padding:300px 30px 30px;font:20px/1.8 serif;width:600px;color:#000;background:#fff">
<p id="weather">今日はいい天気ですね！明日、一緒に行きませんか？</p>
<p id="link"><a href="next.html">新しい記事を読む</a></p>
''' + '<p>駅の前に小さな本屋があって、私は毎朝そこで新聞を買う。</p>' * 60 + '</body></html>',
    'next.html': '<!doctype html><meta charset="utf-8"><title>next</title><p>次のページ</p>',
    'strict.html': '''<!doctype html><html lang="ja"><meta charset="utf-8"><title>strict</title><link rel="stylesheet" href="page.css">
<body><p id="w">彼は静かに本を読んでいた。</p></body></html>''',
    'page.css': 'body { margin: 0; padding: 300px 30px; font: 20px/1.8 serif; color: #000; background: #fff; }',
}


class Pages(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        name = self.path.lstrip('/').split('?')[0] or 'plain.html'
        body = PAGES.get(name)
        if body is None:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header('Content-Type', 'text/css' if name.endswith('.css') else 'text/html; charset=utf-8')
        if name == 'strict.html':
            # a page that allows no inline styles or scripts of its own, as many sites do
            self.send_header('Content-Security-Policy', "default-src 'none'; style-src 'self'; script-src 'self'")
        self.end_headers()
        self.wfile.write(body.encode('utf-8'))

    def log_message(self, *args):
        pass


def near(px, rgb, tol):
    return all(abs(px[i] - rgb[i]) <= tol for i in range(3))


def main():
    subprocess.run([sys.executable, os.path.join(TOP, 'tools', 'extension.py')], check=True)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Pages)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    site = 'http://127.0.0.1:%d/' % server.server_address[1]

    opts = Options()
    opts.binary_location = os.environ['FIREFOX']
    opts.add_argument('-headless')
    # the panel's address holds an id Firefox gives the add-on on this profile, read from its preferences
    opts.add_argument('-remote-allow-system-access')
    opts.enable_bidi = True
    opts.set_preference('dom.w3c_touch_events.enabled', 1)
    drv = webdriver.Firefox(options=opts, service=Service(os.environ['GECKODRIVER']))
    try:
        run(drv, site)
    finally:
        drv.quit()
        server.shutdown()
    print('%d FAILED' % fails if fails else 'all passed')
    sys.exit(1 if fails else 0)


def run(drv, site):
    drv.install_addon(EXT, temporary=True)
    drv.set_window_size(800, 900)

    def at(sel, ch):
        return drv.execute_script('''
          const root = document.querySelector(arguments[0]);
          const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          let n;
          while ((n = w.nextNode())) {
            const i = n.data.indexOf(arguments[1]);
            if (i < 0) continue;
            const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1);
            const b = r.getBoundingClientRect();
            return { x: b.left + b.width / 2, y: b.top + b.height / 2, left: b.left, top: b.top, right: b.right, bottom: b.bottom };
          }
          return null;''', sel, ch)

    def shot():
        return Image.open(BytesIO(drv.get_screenshot_as_png())).convert('RGB')

    def card_shown(img, p):
        """the card's outline (#1B2440) in the band above the line the word is on"""
        w, h = img.size
        top = max(0, int(p['top']) - 220)
        n = 0
        for y in range(top, max(top + 1, int(p['top']) - 4), 2):
            for x in range(0, w, 2):
                if near(img.getpixel((x, y)), (27, 36, 64), 14):
                    n += 1
        return n > 60

    def marked(img, p):
        """the marker colour (#FFE9B0, or the overlay's yellow where highlights are not available) on the character"""
        n = 0
        for y in range(int(p['top']) + 1, int(p['bottom']) - 1):
            for x in range(int(p['left']) + 1, int(p['right']) - 1):
                r, g, b = img.getpixel((x, y))
                if r > 235 and 205 < g < 248 and 120 < b < 200:
                    n += 1
        return n > 4

    finger = PointerInput(interaction.POINTER_TOUCH, 'finger')

    def touch_down(p, hold=0.7):
        a = ActionBuilder(drv, mouse=finger)
        a.pointer_action.move_to_location(int(p['x']), int(p['y'])).pointer_down().pause(hold)
        a.perform()

    def touch_move(p):
        # WebDriver moves the finger there over 250 ms, in steps
        a = ActionBuilder(drv, mouse=finger)
        a.pointer_action.move_to_location(int(p['x']), int(p['y']))
        a.perform()
        time.sleep(0.5)

    def touch_up():
        a = ActionBuilder(drv, mouse=finger)
        a.pointer_action.pointer_up()
        a.perform()
        time.sleep(0.3)

    step('a Japanese page wakes the engine; a finger held on a word')
    drv.get(site + 'plain.html')
    p = at('#weather', '天')
    end = time.time() + 60
    shown = False
    while time.time() < end and not shown:
        touch_down(p)
        img = shot()
        shown = card_shown(img, p) and marked(img, p)
        touch_up()
    ok(shown, 'holding 天気 shows the card above it and marks the phrase')
    img = shot()
    ok(not card_shown(img, p) and not marked(img, p), 'lifting the finger hides the card and the mark')

    step('sliding to the next phrase, without scrolling')
    q = at('#weather', '明')
    touch_down(p)
    touch_move(q)
    img = shot()
    ok(marked(img, q) and not marked(img, p), 'the mark follows the finger from 天気 to 明日')
    ok(drv.execute_script('return scrollY') == 0, 'the page does not scroll while a word is held')
    touch_up()

    step('a held link is not followed; a swipe shows nothing')
    k = at('#link', '記')
    touch_down(k)
    ok(card_shown(shot(), k), 'a word in a link can be held')
    touch_up()
    time.sleep(0.5)
    ok(drv.current_url == site + 'plain.html', 'letting go of a held link stays on the page')
    # a quick swipe shows nothing (whether it scrolls cannot be seen here: WebDriver's finger does not scroll headless
    # Firefox, add-on or not; extension-test.js checks the scroll in Chromium)
    a = ActionBuilder(drv, mouse=PointerInput(interaction.POINTER_TOUCH, 'swipe'), duration=16)
    a.pointer_action.move_to_location(int(p['x']), int(p['y']) + 200).pointer_down()
    for k in range(1, 11):
        a.pointer_action.move_to_location(int(p['x']), int(p['y']) + 200 - 30 * k)
    a.pointer_action.pointer_up()
    a.perform()
    time.sleep(0.8)
    ok(not card_shown(shot(), p), 'a quick swipe over Japanese text shows no card')

    step('the mouse: hold the button, or hold Shift and point')
    a = ActionBuilder(drv)
    a.pointer_action.move_to_location(int(p['x']), int(p['y'])).pointer_down().pause(0.7)
    a.perform()
    img = shot()
    ok(card_shown(img, p) and marked(img, p), 'holding the mouse button on 天気 shows it')
    a = ActionBuilder(drv)
    a.pointer_action.pointer_up()
    a.perform()
    time.sleep(0.3)
    ok(not card_shown(shot(), p), 'letting go of the button hides it')
    ok(drv.execute_script('return String(getSelection())') == '', 'and nothing is left selected')
    a = ActionBuilder(drv)
    a.pointer_action.move_to_location(int(q['x']), int(q['y']))
    a.key_action.key_down(Keys.SHIFT)
    a.perform()
    time.sleep(0.6)
    img = shot()
    ok(card_shown(img, q) and marked(img, q), 'Shift while pointing at 明日 shows it')
    a = ActionBuilder(drv)
    a.key_action.key_up(Keys.SHIFT)
    a.perform()
    time.sleep(0.3)
    ok(not card_shown(shot(), q), 'letting go of Shift hides it')

    step('a page that allows no inline styles')
    drv.get(site + 'strict.html')
    s = at('#w', '静')
    touch_down(s, 1.0)
    img = shot()
    ok(card_shown(img, s), 'the card shows, outlined (so styled), under a strict Content-Security-Policy')
    touch_up()

    step('the toolbar panel')
    drv.set_context('chrome')
    uuids = drv.execute_script("return Services.prefs.getStringPref('extensions.webextensions.uuids')")
    drv.set_context('content')
    import json
    uuid = json.loads(uuids).get('yaoki-reader@jorycook.github.io')
    drv.get('moz-extension://%s/popup.html' % uuid)
    end = time.time() + 10
    text = ''
    while time.time() < end and 'ready' not in text:
        text = drv.find_element('id', 'state-text').text
        time.sleep(0.3)
    ok('ready' in text, 'the panel says the dictionary is ready: ' + text)


if __name__ == '__main__':
    main()
