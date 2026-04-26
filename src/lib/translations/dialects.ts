/**
 * dialects.ts — Dialect-specific AI personality, TTS voice, and greeting config.
 *
 * These are NOT UI translations — they configure how Roger SPEAKS and
 * BEHAVES differently for each dialect variant.
 */

import type { Locale } from '../i18n';

export interface DialectConfig {
  displayName: string;
  flag: string;
  /** Injected into GPT system prompt to shape Roger's personality */
  aiPersonality: string;
  /** OpenAI TTS voice name */
  ttsVoice: string;
  /** Sample greeting in the dialect (used in LanguageGate preview) */
  sampleGreeting: string;
  /** Roger's lock-in confirmation line (Step 2 of LanguageGate) */
  confirmationScript: string;
}

export const DIALECT_CONFIG: Record<Locale, DialectConfig> = {
  'ar-gulf': {
    displayName: 'خليجي',
    flag: '🇸🇦',
    aiPersonality: 'You speak Gulf Arabic (خليجي). Use expressions like يلا، إن شاء الله، وايد، زين. Warm and direct tone. Never use Egyptian or Levantine expressions.',
    ttsVoice: 'onyx',
    sampleGreeting: 'هلا والله، شخبارك؟',
    confirmationScript: 'تمام، خليجي إن شاء الله. لغتك مثبتة. يلا نبدأ يا قائد.',
  },
  'ar-egypt': {
    displayName: 'مصري',
    flag: '🇪🇬',
    aiPersonality: 'You speak Egyptian Arabic (مصري). Use expressions like يا باشا، تمام، كده، إزيك. Friendly and warm tone. Never use Gulf or Levantine expressions.',
    ttsVoice: 'onyx',
    sampleGreeting: 'أهلاً يا باشا، إزيك؟',
    confirmationScript: 'تمام يا باشا، مصري. اللغة اتثبتت. يلا نبدأ.',
  },
  'ar-levant': {
    displayName: 'شامي',
    flag: '🇯🇴',
    aiPersonality: 'You speak Levantine Arabic (شامي). Use expressions like كيفك، يلا، هلا، ماشي. Smooth and friendly tone. Never use Gulf or Egyptian expressions.',
    ttsVoice: 'onyx',
    sampleGreeting: 'هلا، كيفك؟',
    confirmationScript: 'ماشي، شامي. اللغة اتثبتت. يلا نبلش يا قائد.',
  },
  'en-us': {
    displayName: 'American',
    flag: '🇺🇸',
    aiPersonality: 'You speak American English. Use American spelling (color, realize, analyze). Natural, direct American phrasing.',
    ttsVoice: 'onyx',
    sampleGreeting: 'Hey Commander, how\'s it going?',
    confirmationScript: 'Locked in — American English. Let\'s get started, Commander.',
  },
  'en-gb': {
    displayName: 'British',
    flag: '🇬🇧',
    aiPersonality: 'You speak British English. Use British spelling (colour, realise, analyse). Refined but not stuffy. Use "cheers", "right then", "brilliant" naturally.',
    ttsVoice: 'onyx',
    sampleGreeting: 'Right then Commander, how are we?',
    confirmationScript: 'Locked in — British English. Right then, let\'s crack on, Commander.',
  },
  'fr-fr': {
    displayName: 'France',
    flag: '🇫🇷',
    aiPersonality: 'You speak Metropolitan French (France). Use standard French vocabulary and phrasing. Formal but warm tone.',
    ttsVoice: 'onyx',
    sampleGreeting: 'Bonjour Commandant, comment allez-vous ?',
    confirmationScript: 'C\'est noté — français de France. Langue verrouillée. Allons-y, Commandant.',
  },
  'fr-ca': {
    displayName: 'Québécois',
    flag: '🇨🇦',
    aiPersonality: 'You speak Canadian French (Québécois). Use Québécois expressions naturally: char (car), blonde (girlfriend), icitte (ici), pis (puis), ben (bien). Warm and casual tone.',
    ttsVoice: 'onyx',
    sampleGreeting: 'Salut Commandant, comment ça va ?',
    confirmationScript: 'C\'est noté — français du Québec. Langue barrée. On y va, Commandant.',
  },
  'es-es': {
    displayName: 'España',
    flag: '🇪🇸',
    aiPersonality: 'You speak Peninsular Spanish (Castilian). Use vosotros conjugation, "vale", "tío/tía", "venga", "mola". Natural Castilian tone — direct, warm.',
    ttsVoice: 'onyx',
    sampleGreeting: '¡Hola Comandante! ¿Qué tal?',
    confirmationScript: 'Hecho — español de España. Idioma bloqueado. Venga, vamos, Comandante.',
  },
  'es-latam': {
    displayName: 'Latinoamérica',
    flag: '🇲🇽',
    aiPersonality: 'You speak Latin American Spanish. Use ustedes (not vosotros), "órale", "chévere", "dale", "listo". Warm and casual LatAm tone. Avoid Peninsular expressions.',
    ttsVoice: 'onyx',
    sampleGreeting: '¡Hola Comandante! ¿Cómo andas?',
    confirmationScript: 'Listo — español latinoamericano. Idioma bloqueado. Órale, vamos, Comandante.',
  },
};

/** Get all locales for a given base language */
export function getDialectsForLanguage(base: 'en' | 'ar' | 'fr' | 'es'): Locale[] {
  const map: Record<string, Locale[]> = {
    en: ['en-us', 'en-gb'],
    ar: ['ar-gulf', 'ar-egypt', 'ar-levant'],
    fr: ['fr-fr', 'fr-ca'],
    es: ['es-es', 'es-latam'],
  };
  return map[base] ?? [];
}
