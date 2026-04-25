#!/usr/bin/env node
// ─── Generate Android launcher icons from a single source PNG ─────────────────
const sharp = require('sharp');
const path  = require('path');
const fs    = require('fs');

const SRC = path.resolve(__dirname, 'icon-source.png');
const RES = path.resolve(__dirname, '..', 'android', 'app', 'src', 'main', 'res');

const SIZES = {
  'mipmap-ldpi':    36,
  'mipmap-mdpi':    48,
  'mipmap-hdpi':    72,
  'mipmap-xhdpi':   96,
  'mipmap-xxhdpi':  144,
  'mipmap-xxxhdpi': 192,
};

(async () => {
  for (const [folder, size] of Object.entries(SIZES)) {
    const dir = path.join(RES, folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // ic_launcher.png (square)
    await sharp(SRC).resize(size, size).png().toFile(path.join(dir, 'ic_launcher.png'));
    console.log(`✅ ${folder}/ic_launcher.png  (${size}x${size})`);

    // ic_launcher_round.png (same image, Android clips to circle)
    await sharp(SRC).resize(size, size).png().toFile(path.join(dir, 'ic_launcher_round.png'));
    console.log(`✅ ${folder}/ic_launcher_round.png  (${size}x${size})`);

    // foreground (for adaptive icons — needs 108dp padding ratio = size * 1.5)
    const fgSize = Math.round(size * 1.5);
    const padded = Math.round((fgSize - size) / 2);
    await sharp(SRC)
      .resize(size, size)
      .extend({ top: padded, bottom: padded, left: padded, right: padded, background: { r: 10, g: 14, b: 26, alpha: 255 } })
      .resize(fgSize, fgSize)
      .png()
      .toFile(path.join(dir, 'ic_launcher_foreground.png'));
    console.log(`✅ ${folder}/ic_launcher_foreground.png  (${fgSize}x${fgSize})`);

    // background (solid dark navy)
    await sharp({ create: { width: fgSize, height: fgSize, channels: 4, background: { r: 10, g: 14, b: 26, alpha: 255 } } })
      .png()
      .toFile(path.join(dir, 'ic_launcher_background.png'));
    console.log(`✅ ${folder}/ic_launcher_background.png  (${fgSize}x${fgSize})`);
  }
  console.log('\n🎯 All launcher icons generated!');
})();
