// Draws the reader's icons into docs/icons/: Yaoki's daruma on the reader's blue, so the two apps sit
// side by side on a home screen and are told apart at a glance. The daruma is the one in Yaoki's build.
// usage: node tools/icons.mjs   (needs sharp: npm install sharp)
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'docs', 'icons');
const GROUND = '#2F4FD0';   /* the reader's accent */
const DARUMA = (shadow) => `
  ${shadow ? '<path d="M50 6c26 0 40 20 40 46 0 24-16 42-40 42S10 76 10 52C10 26 24 6 50 6z" fill="#1B2440" transform="translate(3.5 4.5)"/>' : ''}
  <path d="M50 6c26 0 40 20 40 46 0 24-16 42-40 42S10 76 10 52C10 26 24 6 50 6z" fill="#E2452B" stroke="#1B2440" stroke-width="2.6"/>
  <ellipse cx="50" cy="42" rx="27" ry="23" fill="#FFF6EA" stroke="#1B2440" stroke-width="2"/>
  <circle cx="39" cy="42" r="8" fill="#fff" stroke="#1B2440" stroke-width="2.5"/>
  <circle cx="61" cy="42" r="8" fill="#fff" stroke="#1B2440" stroke-width="2.5"/>
  <circle cx="61" cy="42" r="4.2" fill="#1B2440"/>
  <path d="M28 30c6-5 14-5 19 0M53 30c5-5 13-5 19 0" stroke="#1B2440" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path d="M44 55c4 3 8 3 12 0" stroke="#1B2440" stroke-width="2.5" fill="none" stroke-linecap="round"/>
  <path d="M38 74h24M42 82h16" stroke="#F2B43A" stroke-width="3.5" stroke-linecap="round"/>`;
const icon = (size, share) => {
  const d = size * share;
  const k = d / 100;
  const x = (size - d) / 2 - 1.5 * k;
  const y = (size - d) / 2 - 1.5 * k;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="${GROUND}"/><g transform="translate(${x} ${y}) scale(${k})">${DARUMA(true)}</g></svg>`;
};
const require = createRequire(import.meta.url);
const sharp = require('sharp');
fs.mkdirSync(OUT, { recursive: true });
const png = async (name, size, share) => fs.writeFileSync(path.join(OUT, name), await sharp(Buffer.from(icon(1024, share))).resize(size, size).png({ compressionLevel: 9 }).toBuffer());
await png('apple-touch-icon.png', 180, 0.7);
await png('icon-192.png', 192, 0.7);
await png('icon-512.png', 512, 0.7);
await png('icon-512-maskable.png', 512, 0.56);
await png('favicon-32.png', 32, 0.82);
console.log('icons written to', OUT);
/* the browser extension's (extension/icons/): toolbar and add-on list; small ones fill more of the square */
const EXT = path.join(HERE, '..', 'extension', 'icons');
fs.mkdirSync(EXT, { recursive: true });
for (const [size, share] of [[16, 0.86], [32, 0.82], [48, 0.78], [128, 0.72]]) {
  fs.writeFileSync(path.join(EXT, `icon-${size}.png`), await sharp(Buffer.from(icon(1024, share))).resize(size, size).png({ compressionLevel: 9 }).toBuffer());
}
console.log('extension icons written to', EXT);
/* the stores' (store/icons/): the listings' icons, and the App Store's app icon, which must be opaque (no alpha)
   and 1024 px, in sRGB */
const STORE = path.join(HERE, '..', 'store', 'icons');
fs.mkdirSync(STORE, { recursive: true });
for (const [name, size, share, alpha] of [['icon-64.png', 64, 0.76, true], ['icon-128.png', 128, 0.72, true], ['icon-300.png', 300, 0.7, true], ['icon-512.png', 512, 0.7, true], ['app-icon-1024.png', 1024, 0.7, false]]) {
  let img = sharp(Buffer.from(icon(1024, share))).resize(size, size);
  if (!alpha) img = img.flatten({ background: GROUND }).removeAlpha();
  fs.writeFileSync(path.join(STORE, name), await img.png({ compressionLevel: 9 }).toBuffer());
}
console.log('store icons written to', STORE);
