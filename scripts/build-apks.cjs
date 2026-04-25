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

// Today's date stamp YYYY-MM-DD
const today = new Date().toISOString().slice(0, 10);

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
  const dest = path.join(OUT_DIR, `RogerAI-${name}-${today}.apk`);
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

// ─────────────────────────────────────────────────────────────────────────────
// BUILD 1: ADMIN APK
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════');
console.log('  BUILDING ADMIN APK');
console.log('══════════════════════════════════════════');

// 1. Vite build with admin target
run('npm run build:admin');

// 2. Sync web assets into Android project
run('npx cap sync android');

// 3. Run the gradle fix script
run('node scripts/fix-gradle.js');

// 4. Force-delete stale build artifacts (OneDrive locks workaround)
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

// 5. Gradle build
run('.\\gradlew.bat assembleDebug --no-daemon', path.join(ROOT, 'android'));

// 6. Copy and rename APK
const adminApk = copyApk('ADMIN');

// ─────────────────────────────────────────────────────────────────────────────
// BUILD 2: USER APK
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════');
console.log('  BUILDING USER APK');
console.log('══════════════════════════════════════════');

// 1. Vite build with user target
run('npm run build:user');

// 2. Sync web assets
run('npx cap sync android');

// 3. Force-delete stale intermediates + outputs
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

// 4. Gradle build
run('.\\gradlew.bat assembleDebug --no-daemon', path.join(ROOT, 'android'));

// 5. Copy and rename APK
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
