#!/bin/bash
# The changes to kuromoji.js, as a patch against the published library, for anyone (a store's reviewer, say) who
# wants to see exactly what was changed: docs/engine/kuromoji.js is build/kuromoji.js of the kuromoji 0.1.2 package
# on npm with tools/kuromoji/reader.patch applied.
# usage: tools/kuromoji/patch.sh          remakes reader.patch from the published build and docs/engine/kuromoji.js
#        tools/kuromoji/patch.sh check    fetches the published build, applies the patch, and compares (exits 1 if off)
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
OURS="$HERE/../../docs/engine/kuromoji.js"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
npm pack kuromoji@0.1.2 --silent >/dev/null
tar -xzf kuromoji-0.1.2.tgz
ORIG="$WORK/package/build/kuromoji.js"
if [ "$1" = check ]; then
  cp "$ORIG" patched.js
  patch -s patched.js "$HERE/reader.patch"
  if cmp -s patched.js "$OURS"; then echo "docs/engine/kuromoji.js is the published build with reader.patch applied"; else echo "docs/engine/kuromoji.js differs from the published build with reader.patch applied"; exit 1; fi
else
  diff -u --label a/kuromoji.js --label b/kuromoji.js "$ORIG" "$OURS" > "$HERE/reader.patch" || true
  echo "wrote $HERE/reader.patch ($(grep -c '^@@' "$HERE/reader.patch") changes)"
fi
