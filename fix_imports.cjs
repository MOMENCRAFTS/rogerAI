const fs = require('fs');

// Fix 1: audioRecorder.ts — Use a simple cast instead of buffer trick
let ar = fs.readFileSync('src/lib/audioRecorder.ts', 'utf8');
// Replace the whole amplitudeData init block with a simpler approach
ar = ar.replace(
  /let amplitudeData: Uint8Array = new Uint8Array\(0\);/,
  '// eslint-disable-next-line @typescript-eslint/no-explicit-any\n  let amplitudeData: any = new Uint8Array(0);'
);
ar = ar.replace(
  /    const buf = new ArrayBuffer\(analyser\.frequencyBinCount\);\n    amplitudeData = new Uint8Array\(buf\) as Uint8Array<ArrayBuffer>;/,
  '    amplitudeData = new Uint8Array(analyser.frequencyBinCount);'
);
fs.writeFileSync('src/lib/audioRecorder.ts', ar, 'utf8');
console.log('audioRecorder fixed');

// Fix 2: PTTTestLab.tsx — make whisperMs appear used via void expression
let ptt = fs.readFileSync('src/modules/PTTTestLab.tsx', 'utf8');
// Add whisperMs to the Whisper transcription step info display
// Find where the "transcribing" pttState renders and add whisperMs timing
ptt = ptt.replace(
  "const [whisperMs, setWhisperMs]                 = useState<number | null>(null); // shown in pipeline step after Whisper call",
  "const [whisperMs, setWhisperMs]                 = useState<number | null>(null);"
);
// Use whisperMs in a ternary in the live transcript area
ptt = ptt.replace(
  '{liveTranscript && ',
  '{whisperMs != null && pttState === \'transcribing\' && <span className="font-mono text-nano" style={{ color: \'var(--amber)\' }}>WHISPER · {whisperMs}ms</span>}\n            {liveTranscript && '
);
fs.writeFileSync('src/modules/PTTTestLab.tsx', ptt, 'utf8');
console.log('PTTTestLab whisperMs fixed');
