#!/bin/bash
# usage: run.sh reader-test.js   (serves docs/ at /Yaoki-reader/ on localhost:8766, as GitHub Pages does, runs the script, stops the server)
# NODE_PATH may point at the Playwright install to use.
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(mktemp -d)"
ln -s "$HERE/../docs" "$ROOT/Yaoki-reader"
python3 -m http.server 8766 --bind 127.0.0.1 --directory "$ROOT" >/dev/null 2>&1 &
SERVER=$!
sleep 0.8
node "$@"
STATUS=$?
kill $SERVER 2>/dev/null
rm -rf "$ROOT"
exit $STATUS
