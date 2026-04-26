#!/usr/bin/env node
// Generate Android app icons from the mascot icon image
const sharp = require('sharp');
const path  = require('path');
const fs    = require('fs');

const SRC = path.join(process.env.USERPROFILE || process.env.HOME || '', '.gemini', 'antigravity', 'brain', 'f1633df2-13c3-49b5-9039-7cdb0ad5192e', 'roger_ai_icon_1777163185553.png');
const RES = path.resolve(__dirname, '..', 'android', 'app', 'src', 'main', 'res');

// Android adaptive icon sizes: foreground is 108dp at each density
const SIZES = {
  'mipmap-ldpi':    { icon: 36, fg: 81 },
  'mipmap-mdpi':    { icon: 48, fg: 108 },
  'mipmap-hdpi':    { icon: 72, fg: 162 },
  'mipmap-xhdpi':   { icon: 96, fg: 216 },
  'mipmap-xxhdpi':  { icon: 144, fg: 324 },
  'mipmap-xxxhdpi': { icon: 192, fg: 432 },
};

(async () => {
  for (const [folder, { icon, fg }] of Object.entries(SIZES)) {
    const dir = path.join(RES, folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    // ic_launcher.png — standard icon
    await sharp(SRC)
      .resize(icon, icon, { fit: 'cover' })
      .png()
      .toFile(path.join(dir, 'ic_launcher.png'));
    
    // ic_launcher_round.png — round icon
    const roundMask = Buffer.from(
      `<svg width="${icon}" height="${icon}"><circle cx="${icon/2}" cy="${icon/2}" r="${icon/2}" fill="white"/></svg>`
    );
    await sharp(SRC)
      .resize(icon, icon, { fit: 'cover' })
      .composite([{ input: roundMask, blend: 'dest-in' }])
      .png()
      .toFile(path.join(dir, 'ic_launcher_round.png'));
    
    // ic_launcher_foreground.png — adaptive icon foreground (108dp)
    await sharp(SRC)
      .resize(fg, fg, { fit: 'contain', background: { r: 10, g: 12, b: 11, alpha: 1 } })
      .png()
      .toFile(path.join(dir, 'ic_launcher_foreground.png'));
    
    // ic_launcher_background.png — solid dark background
    await sharp({
      create: { width: fg, height: fg, channels: 4, background: { r: 10, g: 12, b: 11, alpha: 255 } }
    })
      .png()
      .toFile(path.join(dir, 'ic_launcher_background.png'));
    
    console.log(`✅ ${folder}: ${icon}px icon, ${fg}px foreground`);
  }
  console.log('\nDone! All icons generated from mascot.');
})();
