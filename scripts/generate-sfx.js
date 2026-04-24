#!/usr/bin/env node
/**
 * scripts/generate-sfx.js
 * Generates subtle PTT radio sound effect WAV files for Roger AI.
 * No external dependencies. Run: node scripts/generate-sfx.js
 */
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SR   = 44100;
const PEAK = 0.28; // ~-11 dBFS — audible but subtle

function rand() { return Math.random() * 2 - 1; }
function ms(t)  { return Math.round(t * SR / 1000); }
function lerp(a, b, t) { return a + (b - a) * t; }

function writeWav(filePath, samples) {
  const n   = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22);  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  fs.writeFileSync(filePath, buf);
  console.log(`  ✓ ${path.basename(filePath)}  (${(n / SR * 1000).toFixed(0)} ms)`);
}

// 1. PTT Down — low thump + noise click (~85ms)
function pttDown() {
  const len = ms(85);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t        = i / SR;
    const clickEnv = i < ms(3) ? (1 - i / ms(3)) : 0;
    const thumpEnv = Math.exp(-t / 0.022);
    out[i] = (0.45 * rand() * clickEnv + 0.55 * Math.sin(2 * Math.PI * 70 * t) * thumpEnv) * PEAK;
  }
  return out;
}

// 2. PTT Up — lighter, higher pitch click (~60ms)
function pttUp() {
  const len = ms(60);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t        = i / SR;
    const clickEnv = i < ms(2) ? (1 - i / ms(2)) : 0;
    const thumpEnv = Math.exp(-t / 0.015);
    out[i] = (0.4 * rand() * clickEnv + 0.6 * Math.sin(2 * Math.PI * 100 * t) * thumpEnv) * PEAK * 0.8;
  }
  return out;
}

// 3. Roger In — noise burst + ascending tone (~160ms)
function rogerIn() {
  const len      = ms(160);
  const noiseEnd = ms(55);
  const toneStart = ms(40);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let noise = 0;
    if (i < noiseEnd) {
      const ramp = ms(10);
      const env  = i < ramp ? i / ramp : i < noiseEnd - ms(15) ? 1 : (noiseEnd - i) / ms(15);
      noise = rand() * env * 0.9;
    }
    let tone = 0;
    if (i >= toneStart) {
      const tp   = (i - toneStart) / (len - toneStart);
      const freq = lerp(250, 500, tp);
      const env  = tp < 0.1 ? tp / 0.1 : tp > 0.85 ? (1 - tp) / 0.15 : 1;
      tone = Math.sin(2 * Math.PI * freq * (i - toneStart) / SR) * env * 0.7;
    }
    out[i] = (noise + tone) * PEAK * 0.65;
  }
  return out;
}

// 4. Roger Out — descending tone + squelch close (~130ms)
function rogerOut() {
  const len      = ms(130);
  const toneEnd  = ms(80);
  const noiseStart = ms(65);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    let tone = 0;
    if (i < toneEnd) {
      const tp   = i / toneEnd;
      const freq = lerp(480, 220, tp);
      const env  = tp < 0.08 ? tp / 0.08 : tp > 0.8 ? (1 - tp) / 0.2 : 1;
      tone = Math.sin(2 * Math.PI * freq * t) * env * 0.7;
    }
    let noise = 0;
    if (i >= noiseStart) {
      noise = rand() * (1 - (i - noiseStart) / (len - noiseStart)) * 0.9;
    }
    out[i] = (tone + noise) * PEAK * 0.65;
  }
  return out;
}

// 5. Error — double beep at 880 Hz (~205ms)
function errorBeep() {
  const beepDur = ms(70);
  const gap     = ms(35);
  const tail    = ms(30);
  const len     = beepDur + gap + beepDur + tail;
  const out     = new Float32Array(len);
  const atk = ms(5), rel = ms(8);
  for (let b = 0; b < 2; b++) {
    const off = b * (beepDur + gap);
    for (let i = 0; i < beepDur; i++) {
      const env = i < atk ? i / atk : i > beepDur - rel ? (beepDur - i) / rel : 1;
      out[off + i] = Math.sin(2 * Math.PI * 880 * (off + i) / SR) * env * PEAK * 0.75;
    }
  }
  return out;
}

const outDir = path.join(__dirname, '..', 'public', 'sfx');
fs.mkdirSync(outDir, { recursive: true });

console.log('\nGenerating Roger AI SFX...');
writeWav(path.join(outDir, 'ptt-down.wav'),  pttDown());
writeWav(path.join(outDir, 'ptt-up.wav'),    pttUp());
writeWav(path.join(outDir, 'roger-in.wav'),  rogerIn());
writeWav(path.join(outDir, 'roger-out.wav'), rogerOut());
writeWav(path.join(outDir, 'error.wav'),     errorBeep());
console.log('\nDone — files in public/sfx/\n');
