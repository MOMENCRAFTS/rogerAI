#!/usr/bin/env node
// ─── Roger AI — Dual APK Build Script ─────────────────────────────────────────
// Usage: node scripts/build-apks.cjs
//
// Builds two debug APKs:
//   RogerAI-ADMIN-2026-04-24.apk
//   RogerAI-USER-2026-04-24.apk
//
// Requires:
//   - Java 17+ on PATH
//   - Android SDK (ANDROID_HOME set, or local.properties has sdk.dir)
//   - npm packages installed (cross-env is installed by this script if missing)

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT   = path.resolve(__dirname, '..');
const APK_SRC = path.join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const OUT_DIR = path.join(ROOT, 'dist-apk');

// Date+time stamp: YYYY-MM-DD_HHmm
const now = new Date();
const stamp = now.toISOString().slice(0, 10) + '_' + String(now.getHours()).padStart(2,'0') + String(now.getMinutes()).padStart(2,'0');

function run(cmd, cwd = ROOT) {
  console.log(`\n▶ ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit', shell: true });
}

// Force-delete a directory via PowerShell (works around OneDrive/Windows file locks)
function forceDeleteDir(dir) {
  if (!fs.existsSync(dir)) return;
  console.log(`\n▶ Force-deleting ${dir}`);
  try {
    execSync(
      `powershell -Command "Remove-Item -Path '${dir}' -Recurse -Force -ErrorAction SilentlyContinue"`,
      { stdio: 'inherit', shell: true }
    );
  } catch {
    console.warn('  (some files could not be deleted — OneDrive may still hold locks, proceeding anyway)');
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyApk(name) {
  ensureDir(OUT_DIR);
  const dest = path.join(OUT_DIR, `RogerAI-${name}-${stamp}.apk`);
  fs.copyFileSync(APK_SRC, dest);
  console.log(`\n✅ Saved: ${dest}`);
  return dest;
}

// ─── Check cross-env is available ──────────────────────────────────────────────
try {
  execSync('npx cross-env --version', { cwd: ROOT, stdio: 'pipe' });
} catch {
  console.log('Installing cross-env...');
  run('npm install --save-dev cross-env');
}

// ─── ApplicationId + App Name swap helpers ────────────────────────────────────
// Allows both ADMIN and USER APKs to coexist on the same device.
const GRADLE_FILE   = path.join(ROOT, 'android', 'app', 'build.gradle');
const STRINGS_FILE  = path.join(ROOT, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');
const RES_DIR       = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const USER_APP_ID   = 'com.rogerai.app';
const ADMIN_APP_ID  = 'com.rogerai.admin';
const USER_APP_NAME = 'Roger AI';
const ADMIN_APP_NAME = 'Roger HQ';

// Icon background colors: admin gets amber-orange, user gets dark
const ADMIN_ICON_BG = { r: 180, g: 120, b: 30, alpha: 255 };  // amber/orange
const USER_ICON_BG  = { r: 10, g: 12, b: 11, alpha: 255 };    // near-black (original)

function swapAppId(targetId) {
  let gradle = fs.readFileSync(GRADLE_FILE, 'utf8');
  gradle = gradle.replace(/applicationId\s+"com\.rogerai\.\w+"/, `applicationId "${targetId}"`);
  fs.writeFileSync(GRADLE_FILE, gradle);
  console.log(`  → applicationId set to ${targetId}`);
}

function swapAppName(targetName) {
  let strings = fs.readFileSync(STRINGS_FILE, 'utf8');
  strings = strings.replace(/<string name="app_name">.*?<\/string>/, `<string name="app_name">${targetName}</string>`);
  strings = strings.replace(/<string name="title_activity_main">.*?<\/string>/, `<string name="title_activity_main">${targetName}</string>`);
  fs.writeFileSync(STRINGS_FILE, strings);
  console.log(`  → app_name + title_activity_main set to "${targetName}"`);
}

// Rewrite adaptive icon backgrounds to a specific color using sharp
function swapIconBackground(bg) {
  const sharp = require('sharp');
  const ICON_SIZES = {
    'mipmap-ldpi':    81,
    'mipmap-mdpi':    108,
    'mipmap-hdpi':    162,
    'mipmap-xhdpi':   216,
    'mipmap-xxhdpi':  324,
    'mipmap-xxxhdpi': 432,
  };
  const promises = [];
  for (const [folder, size] of Object.entries(ICON_SIZES)) {
    const bgFile = path.join(RES_DIR, folder, 'ic_launcher_background.png');
    if (!fs.existsSync(path.join(RES_DIR, folder))) continue;
    promises.push(
      sharp({ create: { width: size, height: size, channels: 4, background: bg } })
        .png()
        .toFile(bgFile + '.tmp')
        .then(() => { fs.renameSync(bgFile + '.tmp', bgFile); })
    );
  }
  return Promise.all(promises).then(() => {
    console.log(`  → icon background set to rgb(${bg.r},${bg.g},${bg.b})`);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILD 1: ADMIN APK
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════');
console.log('  BUILDING ADMIN APK');
console.log('══════════════════════════════════════════');

// 1. Vite build with admin target
run('npm run build:admin');

// 2. Sync web assets into Android project (this overwrites strings.xml!)
run('npx cap sync android');

// 3. NOW swap applicationId + app name + icon background AFTER cap sync
//    (cap sync regenerates strings.xml from capacitor.config.ts, so we must patch after)
swapAppId(ADMIN_APP_ID);
swapAppName(ADMIN_APP_NAME);
// Swap icon backgrounds to amber for admin
execSync('node -e "' +
  `const sharp=require('sharp');const fs=require('fs');const path=require('path');` +
  `const RES='${RES_DIR.replace(/\\/g, '/')}';` +
  `const SIZES={'mipmap-ldpi':81,'mipmap-mdpi':108,'mipmap-hdpi':162,'mipmap-xhdpi':216,'mipmap-xxhdpi':324,'mipmap-xxxhdpi':432};` +
  `(async()=>{for(const[f,s]of Object.entries(SIZES)){const p=path.join(RES,f,'ic_launcher_background.png');if(!fs.existsSync(path.join(RES,f)))continue;` +
  `await sharp({create:{width:s,height:s,channels:4,background:{r:180,g:120,b:30,alpha:255}}}).png().toFile(p);}console.log('  → admin icon bg set')})()` +
  '"', { cwd: ROOT, stdio: 'inherit', shell: true });

// 4. Run the gradle fix script
run('node scripts/fix-gradle.js');

// 5. Force-delete stale build artifacts (OneDrive locks workaround)
// App module build dirs
forceDeleteDir(path.join(ROOT, 'android', 'app', 'build', 'intermediates'));
forceDeleteDir(path.join(ROOT, 'android', 'app', 'build', 'generated'));
forceDeleteDir(path.join(ROOT, 'android', 'app', 'build', 'outputs'));
// Capacitor plugin build dirs (also locked by OneDrive)
const capPluginDirs = [
  path.join(ROOT, 'node_modules', '@capacitor', 'android', 'capacitor', 'build'),
  path.join(ROOT, 'node_modules', '@capacitor', 'app', 'android', 'build'),
  path.join(ROOT, 'node_modules', '@capacitor', 'haptics', 'android', 'build'),
  path.join(ROOT, 'node_modules', '@capacitor', 'splash-screen', 'android', 'build'),
];
for (const d of capPluginDirs) forceDeleteDir(d);

// 6. Gradle build
run('.\\gradlew.bat assembleDebug --no-daemon', path.join(ROOT, 'android'));

// 7. Copy and rename APK
const adminApk = copyApk('ADMIN');

// ─────────────────────────────────────────────────────────────────────────────
// BUILD 2: USER APK
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════');
console.log('  BUILDING USER APK');
console.log('══════════════════════════════════════════');

// 1. Vite build with user target
run('npm run build:user');

// 2. Sync web assets (overwrites strings.xml from capacitor.config.ts)
run('npx cap sync android');

// 3. NOW restore applicationId + app name + icon background AFTER cap sync
swapAppId(USER_APP_ID);
swapAppName(USER_APP_NAME);
// Restore icon backgrounds to original dark
execSync('node -e "' +
  `const sharp=require('sharp');const fs=require('fs');const path=require('path');` +
  `const RES='${RES_DIR.replace(/\\/g, '/')}';` +
  `const SIZES={'mipmap-ldpi':81,'mipmap-mdpi':108,'mipmap-hdpi':162,'mipmap-xhdpi':216,'mipmap-xxhdpi':324,'mipmap-xxxhdpi':432};` +
  `(async()=>{for(const[f,s]of Object.entries(SIZES)){const p=path.join(RES,f,'ic_launcher_background.png');if(!fs.existsSync(path.join(RES,f)))continue;` +
  `await sharp({create:{width:s,height:s,channels:4,background:{r:10,g:12,b:11,alpha:255}}}).png().toFile(p);}console.log('  → user icon bg set')})()` +
  '"', { cwd: ROOT, stdio: 'inherit', shell: true });

// 4. Force-delete stale intermediates + outputs
forceDeleteDir(path.join(ROOT, 'android', 'app', 'build', 'intermediates'));
forceDeleteDir(path.join(ROOT, 'android', 'app', 'build', 'generated'));
forceDeleteDir(path.join(ROOT, 'android', 'app', 'build', 'outputs'));
// Capacitor plugin build dirs
const capPluginDirs2 = [
  path.join(ROOT, 'node_modules', '@capacitor', 'android', 'capacitor', 'build'),
  path.join(ROOT, 'node_modules', '@capacitor', 'app', 'android', 'build'),
  path.join(ROOT, 'node_modules', '@capacitor', 'haptics', 'android', 'build'),
  path.join(ROOT, 'node_modules', '@capacitor', 'splash-screen', 'android', 'build'),
];
for (const d of capPluginDirs2) forceDeleteDir(d);

// 5. Gradle build
run('.\\gradlew.bat assembleDebug --no-daemon', path.join(ROOT, 'android'));

// 6. Copy and rename APK
const userApk = copyApk('USER');

// ─────────────────────────────────────────────────────────────────────────────
// DONE
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════');
console.log('  BUILD COMPLETE');
console.log('══════════════════════════════════════════');
console.log(`  ADMIN → ${adminApk}`);
console.log(`  USER  → ${userApk}`);
console.log('══════════════════════════════════════════\n');

// Open the output folder in Explorer
try { execSync(`explorer.exe "${OUT_DIR}"`); } catch {}
