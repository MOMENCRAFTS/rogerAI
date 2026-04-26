/**
 * generate-translations.ts
 *
 * One-time build-time script that uses ChatGPT (GPT-5.5) to translate
 * the English UI dictionary into Arabic, French, and Spanish.
 *
 * Usage:  npx tsx scripts/generate-translations.ts
 * Requires: OPENAI_API_KEY env var
 *
 * Outputs: src/lib/translations/ar.ts, fr.ts, es.ts
 */

import fs from 'fs';
import path from 'path';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('❌ Set OPENAI_API_KEY environment variable');
  process.exit(1);
}

// ── Load the English source dictionary ──────────────────────────────────────

// We parse en.ts manually to extract key-value pairs
// (we can't import .ts directly in this script context without bundling)
const EN_PATH = path.resolve(__dirname, '../src/lib/translations/en.ts');
const enSource = fs.readFileSync(EN_PATH, 'utf8');

// Extract all 'key': 'value' pairs using regex
const pairs: Record<string, string> = {};
const regex = /'([^']+)'\s*:\s*'((?:[^'\\]|\\.)*)'/g;
let match: RegExpExecArray | null;
while ((match = regex.exec(enSource)) !== null) {
  pairs[match[1]] = match[2].replace(/\\'/g, "'");
}

const allKeys = Object.keys(pairs);
console.log(`📖 Found ${allKeys.length} English keys`);

// ── Target language configs ─────────────────────────────────────────────────

interface LangConfig {
  code: string;
  name: string;
  systemInstruction: string;
}

const TARGETS: LangConfig[] = [
  {
    code: 'ar',
    name: 'Arabic',
    systemInstruction: `You are a professional UI translator. Translate these English UI strings to Arabic.
Rules:
- Use Modern Standard Arabic (MSA) suitable for a professional mobile app UI.
- Keep the tone formal but warm.
- Keep ALL placeholders exactly as-is: {name}, {count}, {time}, {level}, {version}, {percent}, {location}
- Keep emoji and special characters (●, ✓, ◎, 🗺, 🚦, 📡, etc.) exactly as-is.
- Keep brand names unchanged: Roger AI, ROGER, GPT-5.5, Spotify, Google Calendar, Finnhub, Twilio, Notion, Tuya, Stripe, AlAdhan.com, Uber
- Short labels (nav items, badges) should stay short — abbreviate if needed.
- Return valid JSON only. No explanations.`,
  },
  {
    code: 'fr',
    name: 'French',
    systemInstruction: `You are a professional UI translator. Translate these English UI strings to French.
Rules:
- Use standard French suitable for a professional mobile app UI.
- Keep the tone formal but warm.
- Keep ALL placeholders exactly as-is: {name}, {count}, {time}, {level}, {version}, {percent}, {location}
- Keep emoji and special characters (●, ✓, ◎, 🗺, 🚦, 📡, etc.) exactly as-is.
- Keep brand names unchanged: Roger AI, ROGER, GPT-5.5, Spotify, Google Calendar, Finnhub, Twilio, Notion, Tuya, Stripe, AlAdhan.com, Uber
- Short labels (nav items, badges) should stay short.
- Return valid JSON only. No explanations.`,
  },
  {
    code: 'es',
    name: 'Spanish',
    systemInstruction: `You are a professional UI translator. Translate these English UI strings to Spanish.
Rules:
- Use standard Spanish suitable for a professional mobile app UI (neutral, not Castilian-specific or LatAm-specific).
- Keep the tone formal but warm.
- Keep ALL placeholders exactly as-is: {name}, {count}, {time}, {level}, {version}, {percent}, {location}
- Keep emoji and special characters (●, ✓, ◎, 🗺, 🚦, 📡, etc.) exactly as-is.
- Keep brand names unchanged: Roger AI, ROGER, GPT-5.5, Spotify, Google Calendar, Finnhub, Twilio, Notion, Tuya, Stripe, AlAdhan.com, Uber
- Short labels (nav items, badges) should stay short.
- Return valid JSON only. No explanations.`,
  },
];

// ── GPT Call ─────────────────────────────────────────────────────────────────

async function callGPT(system: string, user: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GPT error: ${JSON.stringify(err)}`);
  }

  const data = await res.json() as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message?.content ?? '{}';
}

// ── Chunk + Translate ───────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function translateLanguage(config: LangConfig): Promise<Record<string, string>> {
  const BATCH_SIZE = 50;
  const batches = chunk(allKeys, BATCH_SIZE);
  const result: Record<string, string> = {};

  console.log(`\n🌐 Translating to ${config.name} (${batches.length} batches)...`);

  for (let i = 0; i < batches.length; i++) {
    const batchKeys = batches[i];
    const batchObj: Record<string, string> = {};
    for (const key of batchKeys) {
      batchObj[key] = pairs[key];
    }

    console.log(`  Batch ${i + 1}/${batches.length} (${batchKeys.length} keys)...`);

    const response = await callGPT(
      config.systemInstruction,
      JSON.stringify(batchObj, null, 2)
    );

    try {
      const parsed = JSON.parse(response) as Record<string, string>;
      Object.assign(result, parsed);
    } catch (e) {
      console.error(`  ❌ Failed to parse batch ${i + 1} response`);
      // Fill with English fallbacks for this batch
      for (const key of batchKeys) {
        if (!result[key]) result[key] = pairs[key];
      }
    }

    // Rate limit: wait 500ms between batches
    if (i < batches.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  return result;
}

// ── Validate ────────────────────────────────────────────────────────────────

function validate(translated: Record<string, string>, lang: string): string[] {
  const missing: string[] = [];
  for (const key of allKeys) {
    if (!translated[key]) {
      missing.push(key);
      translated[key] = pairs[key]; // fallback to English
    }
  }
  if (missing.length > 0) {
    console.warn(`  ⚠️  ${lang}: ${missing.length} missing keys filled with English fallback`);
  }
  return missing;
}

// ── Write Output ────────────────────────────────────────────────────────────

function writeDict(code: string, dict: Record<string, string>): void {
  const outPath = path.resolve(__dirname, `../src/lib/translations/${code}.ts`);

  const lines = [
    `/**`,
    ` * ${code}.ts — ${code.toUpperCase()} UI translation dictionary`,
    ` *`,
    ` * AUTO-GENERATED by scripts/generate-translations.ts`,
    ` * Source: en.ts → ChatGPT (GPT-4o) → ${code}.ts`,
    ` *`,
    ` * You may manually edit this file. Re-running the script will OVERWRITE it.`,
    ` * Generated: ${new Date().toISOString()}`,
    ` */`,
    ``,
    `import type { TranslationDict } from '../i18n';`,
    ``,
    `const ${code}: TranslationDict = {`,
  ];

  for (const key of allKeys) {
    const val = (dict[key] ?? pairs[key]).replace(/'/g, "\\'");
    lines.push(`  '${key}': '${val}',`);
  }

  lines.push(`};`);
  lines.push(``);
  lines.push(`export default ${code};`);
  lines.push(``);

  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(`  ✅ Written: ${outPath}`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 RogerAI Translation Generator');
  console.log('================================\n');

  for (const target of TARGETS) {
    const translated = await translateLanguage(target);
    validate(translated, target.name);
    writeDict(target.code, translated);
  }

  console.log('\n✅ All translations generated!');
  console.log('📝 Review the output files and commit to git.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
