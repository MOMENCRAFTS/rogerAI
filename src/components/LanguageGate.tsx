/**
 * LanguageGate.tsx — 3-Node AI Conversational Language Selector
 *
 * All 3 nodes use GPT intelligence via the language-gate edge function.
 * Node 1: PTT → AI detects language → Roger asks about dialect
 * Node 2: PTT → AI detects dialect → Roger summarizes + asks to confirm
 * Node 3: PTT → AI detects confirm/change → lock in or navigate back
 *
 * Fallback tap targets preserved for accessibility.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Radio, Mic } from 'lucide-react';
import TwemojiFlag from './TwemojiFlag';
import type { Locale, BaseLanguage } from '../lib/i18n';
import { DIALECT_CONFIG, getDialectsForLanguage } from '../lib/translations/dialects';
import { speakResponse, unlockAudio } from '../lib/tts';

interface Props { onLocaleSelected: (locale: Locale) => void; }

type GateStep = 'node1' | 'node1_speak' | 'node2' | 'node2_speak' | 'node3' | 'node3_speak' | 'locked';

const GREETINGS = [
  { text: 'Hello Commander', lang: 'en', flag: '🇬🇧' },
  { text: 'أهلاً يا قائد', lang: 'ar', flag: '🇸🇦' },
  { text: 'Bonjour Commandant', lang: 'fr', flag: '🇫🇷' },
  { text: '¡Hola Comandante!', lang: 'es', flag: '🇪🇸' },
];

const LANG_LABELS: Record<BaseLanguage, string> = { en: 'English', ar: 'Arabic', fr: 'French', es: 'Spanish' };
const VALID_BASES: BaseLanguage[] = ['en', 'ar', 'fr', 'es'];

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

// ── AI system prompts for each gate node ──────────────────────────────────
// ── Node questions (Roger speaks these) ───────────────────────────────────
const NODE_QUESTIONS: Record<string, string> = {
  node1: 'Which language would you like me to operate in? English, Arabic, French, or Spanish.',
  // node2 and node3 are dynamic — built at runtime with dialect names
};

/** First-encounter greeting — blends all 4 languages naturally */
const WELCOME_GREETING = 'Roger online. Welcome. Marhaba. Bienvenue. Bienvenido. Choose your language — English, Al-Arabiyya, Français, or Español. Hold the mic and speak, or tap below.';

// ── Silent node prompts: GPT validates relevance + extracts ───────────────
const GATE_PROMPTS: Record<string, string> = {
  node1: `You are a silent classification node. Roger asked the user: "Which language would you like me to operate in? English, Arabic, French, or Spanish."

RULES:
1. Determine if the user's response is RELEVANT to choosing a language.
2. If relevant, extract the language. Supported: en, ar, fr, es.
3. If the response is gibberish, off-topic, or unrelated (e.g. "pizza", "hello", random words), mark as NOT relevant.

Respond ONLY with JSON:
- Relevant: {"relevant":true,"language":"xx"}
- Not relevant / gibberish: {"relevant":false,"language":null}`,

  node2: `You are a silent classification node. Roger asked which dialect/accent the user prefers.

Available locales: en-us (American), en-gb (British), ar-gulf (Gulf/Saudi/Khaliji), ar-egypt (Egyptian), ar-levant (Levantine/Shami), fr-fr (France), fr-ca (Québécois/Canadian), es-es (Spain/Castilian), es-latam (Latin American).

RULES:
1. Determine if the user's response is RELEVANT to choosing a dialect.
2. If relevant, extract the locale code.
3. If off-topic or gibberish, mark as NOT relevant.

Respond ONLY with JSON:
- Relevant: {"relevant":true,"dialect":"xx-yy"}
- Not relevant: {"relevant":false,"dialect":null}`,

  node3: `You are a silent classification node. Roger asked: "Confirm to lock in, or say change language, or change accent."

RULES:
1. Determine if the user is confirming, asking to change language, or asking to change accent.
2. If the response is off-topic or gibberish, mark as NOT relevant.

Respond ONLY with JSON:
- Confirm: {"relevant":true,"action":"confirm"}
- Change language: {"relevant":true,"action":"change_language"}
- Change accent: {"relevant":true,"action":"change_accent"}
- Not relevant: {"relevant":false,"action":null}`,
};

/** Silent node: call process-transmission with _direct_prompt (same as onboarding) */
async function classifyGate(transcript: string, node: 'node1' | 'node2' | 'node3', context?: string) {
  const { getAuthToken } = await import('../lib/getAuthToken');
  const token = await getAuthToken().catch(() => null);
  const system = GATE_PROMPTS[node];
  const user = context
    ? `Context: ${context}\nUser responded: "${transcript}"`
    : `User responded: "${transcript}"`;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/process-transmission`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ _direct_prompt: true, system, user }),
  });

  const data = await res.json() as Record<string, unknown>;
  const raw = typeof data.roger_response === 'string' ? data.roger_response : '{}';
  try { return JSON.parse(raw); } catch { return { relevant: false }; }
}


const CSS = `
@keyframes gp{0%,100%{box-shadow:0 0 20px rgba(212,160,68,.15)}50%{box-shadow:0 0 40px rgba(212,160,68,.35)}}
@keyframes gfi{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@keyframes gfo{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(-12px)}}
@keyframes gsi{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:scale(1)}}
@keyframes gso{0%{transform:scale(1);opacity:.5}100%{transform:scale(2.5);opacity:0}}
@keyframes gmi{from{opacity:0;transform:translateY(8px) scale(.96);filter:blur(4px)}to{opacity:1;transform:translateY(0) scale(1);filter:blur(0)}}
@keyframes glp{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
@keyframes gsh{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes gbr{0%,100%{transform:scale(1);box-shadow:0 0 30px rgba(212,160,68,.2)}50%{transform:scale(1.08);box-shadow:0 0 60px rgba(212,160,68,.5)}}
@keyframes grp{0%{transform:scale(1);opacity:.6}100%{transform:scale(1.8);opacity:0}}
`;

export default function LanguageGate({ onLocaleSelected }: Props) {
  const [step, setStep] = useState<GateStep>('node1');
  const [gi, setGi] = useState(0);
  const [morph, setMorph] = useState(false);
  const [base, setBase] = useState<BaseLanguage | null>(null);
  const [locale, setLocale] = useState<Locale | null>(null);
  const [ptt, setPtt] = useState(false);
  const [hint, setHint] = useState('');
  const [retries, setRetries] = useState(0);
  const showFallback = retries >= 2; // After 2 fails, emphasize tap targets
  const stylesRef = useRef(false);
  const recRef = useRef<any>(null);
  const greetedRef = useRef(false);

  useEffect(() => {
    if (stylesRef.current) return;
    stylesRef.current = true;
    const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s);
  }, []);

  // Auto-speak welcome greeting on first load (first encounter)
  useEffect(() => {
    if (greetedRef.current || step !== 'node1') return;
    greetedRef.current = true;
    // Small delay so the UI renders first, then Roger speaks
    const t = setTimeout(() => {
      unlockAudio();
      speakResponse(WELCOME_GREETING).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [step]);

  useEffect(() => {
    if (step !== 'node1') return;
    const iv = setInterval(() => {
      setMorph(true);
      setTimeout(() => { setGi(i => (i + 1) % GREETINGS.length); setMorph(false); }, 400);
    }, 3000);
    return () => clearInterval(iv);
  }, [step]);

  // Node 1: Language confirmed → Roger speaks + asks dialect
  const confirmLang = useCallback((b: BaseLanguage) => {
    unlockAudio();
    setBase(b);
    const dialects = getDialectsForLanguage(b);
    if (dialects.length === 1) {
      setLocale(dialects[0]);
      goToNode3(dialects[0], b);
      return;
    }
    setStep('node1_speak');
    const names = dialects.map(d => DIALECT_CONFIG[d].displayName).join(', or ');
    speakResponse(`Roger. I'll operate in ${LANG_LABELS[b]}. Which style do you prefer? ${names}?`).then(() => {
      setStep('node2');
    }).catch(() => setStep('node2'));
  }, []);

  // Node 2 → Node 3: dialect selected, ask for confirmation
  const selectDialect = useCallback((loc: Locale) => {
    setLocale(loc);
    goToNode3(loc, base);
  }, [base]);

  // Go to Node 3: Roger summarizes and asks to confirm
  const goToNode3 = useCallback((loc: Locale, b: BaseLanguage | null) => {
    setStep('node2_speak');
    const dc = DIALECT_CONFIG[loc];
    const langName = b ? LANG_LABELS[b] : 'your language';
    speakResponse(`${langName}, ${dc.displayName} style. Say confirm to lock in, or change language, or change accent.`).then(() => {
      setStep('node3');
    }).catch(() => setStep('node3'));
  }, []);

  // Final lock-in (only from Node 3 confirm)
  const lockIn = useCallback((loc: Locale) => {
    setStep('node3_speak');
    speakResponse(DIALECT_CONFIG[loc].confirmationScript).then(() => {
      setStep('locked');
      setTimeout(() => onLocaleSelected(loc), 1200);
    }).catch(() => {
      setStep('locked');
      setTimeout(() => onLocaleSelected(loc), 800);
    });
  }, [onLocaleSelected]);

  // ── Silent node handler: GPT validates relevance, repeats question on gibberish ──
  const repeatNodeQuestion = useCallback((nodeStep: GateStep) => {
    if (nodeStep === 'node1') {
      speakResponse(NODE_QUESTIONS.node1).catch(() => {});
    } else if (nodeStep === 'node2' && base) {
      const names = getDialectsForLanguage(base).map(d => DIALECT_CONFIG[d].displayName).join(', or ');
      speakResponse(`Which style? ${names}?`).catch(() => {});
    } else if (nodeStep === 'node3' && locale) {
      const dc = DIALECT_CONFIG[locale];
      const langName = base ? LANG_LABELS[base] : 'your language';
      speakResponse(`${langName}, ${dc.displayName} style. Say confirm to lock in, or change language, or change accent.`).catch(() => {});
    }
  }, [base, locale]);

  const processTranscript = useCallback(async (tx: string) => {
    setHint('Thinking...');
    try {
      if (step === 'node1') {
        const r = await classifyGate(tx, 'node1');
        if (r?.relevant && r.language && VALID_BASES.includes(r.language as BaseLanguage)) {
          setRetries(0); setHint(''); confirmLang(r.language as BaseLanguage);
        } else {
          // Not relevant / gibberish → repeat the same node question
          setRetries(n => n + 1);
          setHint('');
          repeatNodeQuestion('node1');
        }
      } else if (step === 'node2' && base) {
        const r = await classifyGate(tx, 'node2', `base=${base}, available: ${getDialectsForLanguage(base).join(',')}`);
        if (r?.relevant && r.dialect && getDialectsForLanguage(base).includes(r.dialect as Locale)) {
          setRetries(0); setHint(''); selectDialect(r.dialect as Locale);
        } else {
          setRetries(n => n + 1);
          setHint('');
          repeatNodeQuestion('node2');
        }
      } else if (step === 'node3' && locale) {
        const r = await classifyGate(tx, 'node3');
        if (r?.relevant && r.action === 'confirm') {
          setRetries(0); setHint(''); lockIn(locale);
        } else if (r?.relevant && r.action === 'change_language') {
          setRetries(0); setStep('node1'); setBase(null); setLocale(null); setHint('');
        } else if (r?.relevant && r.action === 'change_accent' && base) {
          setRetries(0); setStep('node2'); setLocale(null); setHint('');
        } else {
          setRetries(n => n + 1);
          setHint('');
          repeatNodeQuestion('node3');
        }
      }
    } catch {
      setRetries(n => n + 1);
      setHint('');
      repeatNodeQuestion(step);
    }
  }, [step, base, locale, confirmLang, selectDialect, lockIn, repeatNodeQuestion]);

  const pttDown = useCallback(() => {
    if (step !== 'node1' && step !== 'node2' && step !== 'node3') return;
    unlockAudio(); setPtt(true); setHint('');
    try {
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SR) { setHint('Voice not supported — tap below'); setPtt(false); return; }
      const r = new SR(); r.lang = 'en-US'; r.interimResults = false; r.maxAlternatives = 3;
      recRef.current = r;
      r.onresult = (e: any) => {
        const tx = e.results[0][0].transcript;
        processTranscript(tx);
        setPtt(false);
      };
      r.onerror = () => { setHint('Couldn\'t hear — hold and try again'); setPtt(false); };
      r.onend = () => setPtt(false);
      r.start();
    } catch { setHint('Voice not available'); setPtt(false); }
  }, [step, processTranscript]);

  const pttUp = useCallback(() => { setPtt(false); try { recRef.current?.stop(); } catch {} }, []);

  const g = GREETINGS[gi];
  const mono = (sz: number, c = 'rgba(212,160,68,0.9)', sp = '0.15em'): React.CSSProperties => ({
    fontFamily: '"SF Mono","Fira Code","Cascadia Code",monospace', fontSize: sz, color: c, letterSpacing: sp, textTransform: 'uppercase',
  });

  return (
    <div style={{ position:'fixed',inset:0,zIndex:9999,background:'radial-gradient(ellipse at 50% 30%,rgba(20,20,25,1) 0%,rgba(8,8,12,1) 100%)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',overflow:'hidden' }}>
      {/* Scanlines */}
      <div style={{ position:'absolute',inset:0,opacity:.03,backgroundImage:'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(212,160,68,.3) 2px,rgba(212,160,68,.3) 4px)',pointerEvents:'none' }} />
      {/* Mascot + Badge */}
      <div style={{ position:'absolute',top:36,left:'50%',transform:'translateX(-50%)',display:'flex',flexDirection:'column',alignItems:'center',gap:8,animation:'gfi .8s ease-out' }}>
        <img src="/mascot.png" alt="Roger AI" style={{ width:56,height:56,objectFit:'contain',mixBlendMode:'screen',filter:'drop-shadow(0 0 14px rgba(212,160,68,0.4))',animation:'glp 4s ease-in-out infinite' }} />
        <div style={mono(8,'rgba(212,160,68,.5)','.25em')}>▸ ROGER AI</div>
      </div>

      {/* ═══ NODE 1: Say your language ═══ */}
      {step === 'node1' && (
        <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:32,animation:'gfi .6s ease-out',padding:'0 24px',width:'100%',maxWidth:400 }}>
          <div style={{ minHeight:80,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center' }}>
            <div key={gi} style={{ ...mono(18,'rgba(212,160,68,.95)','.08em'),textTransform:'none',textAlign:'center',animation:morph?'gfo .4s ease-in forwards':'gmi .5s ease-out',direction:g.lang==='ar'?'rtl':'ltr' }}>
              <TwemojiFlag emoji={g.flag} size={28} style={{ marginRight: 8 }} />{g.text}
            </div>
          </div>
          <div style={{ ...mono(8,'rgba(255,255,255,.35)','.2em'),textAlign:'center' }}>— HOLD & SAY YOUR LANGUAGE —</div>

          {/* PTT */}
          <button onPointerDown={pttDown} onPointerUp={pttUp} onPointerCancel={pttUp} onContextMenu={e=>e.preventDefault()}
            style={{ width:120,height:120,borderRadius:'50%',border:ptt?'3px solid rgba(212,160,68,.8)':'2px solid rgba(212,160,68,.3)',background:ptt?'radial-gradient(circle,rgba(212,160,68,.25) 0%,rgba(212,160,68,.08) 100%)':'radial-gradient(circle,rgba(212,160,68,.1) 0%,rgba(212,160,68,.03) 100%)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',position:'relative',transition:'all .2s',animation:ptt?'gbr 1.2s ease-in-out infinite':'gp 3s ease-in-out infinite',WebkitTapHighlightColor:'transparent',touchAction:'none' }}>
            {ptt && <><div style={{ position:'absolute',inset:-4,borderRadius:'50%',border:'1px solid rgba(212,160,68,.4)',animation:'grp 1.5s ease-out infinite' }} /><div style={{ position:'absolute',inset:-4,borderRadius:'50%',border:'1px solid rgba(212,160,68,.3)',animation:'grp 1.5s ease-out infinite .5s' }} /></>}
            <Mic size={36} color={ptt?'rgba(212,160,68,1)':'rgba(212,160,68,.6)'} />
          </button>

          {hint && <div style={{ ...mono(8,'rgba(255,200,100,.7)','.08em'),textTransform:'none',textAlign:'center',maxWidth:300,animation:'gfi .3s ease-out' }}>{hint}</div>}

          {/* Fallback taps — highlighted after 2 voice fails */}
          <div style={{ marginTop: showFallback ? 0 : 8, transition: 'all .3s' }}>
            <div style={{ ...mono(showFallback ? 9 : 7, showFallback ? 'rgba(212,160,68,.8)' : 'rgba(255,255,255,.2)', '.15em'), textAlign:'center', marginBottom:8 }}>
              {showFallback ? '▸ TAP YOUR LANGUAGE ▸' : 'OR TAP'}
            </div>
            <div style={{ display:'flex', gap: showFallback ? 16 : 12, justifyContent:'center' }}>
              {([{b:'en' as BaseLanguage,f:'🇬🇧'},{b:'ar' as BaseLanguage,f:'🇸🇦'},{b:'fr' as BaseLanguage,f:'🇫🇷'},{b:'es' as BaseLanguage,f:'🇪🇸'}]).map(o=>(
                <button key={o.b} onClick={()=>confirmLang(o.b)} style={{
                  background: showFallback ? 'rgba(212,160,68,.12)' : 'rgba(212,160,68,.06)',
                  border: `1px solid ${showFallback ? 'rgba(212,160,68,.4)' : 'rgba(212,160,68,.15)'}`,
                  borderRadius:10, padding: showFallback ? '12px 18px' : '8px 14px',
                  cursor:'pointer', fontSize: showFallback ? 28 : 22,
                  transition:'all .3s', animation: showFallback ? 'gp 2s ease-in-out infinite' : 'none',
                }}
                  onPointerEnter={e=>{(e.currentTarget as HTMLButtonElement).style.background='rgba(212,160,68,.2)';(e.currentTarget as HTMLButtonElement).style.borderColor='rgba(212,160,68,.5)'}}
                  onPointerLeave={e=>{(e.currentTarget as HTMLButtonElement).style.background=showFallback?'rgba(212,160,68,.12)':'rgba(212,160,68,.06)';(e.currentTarget as HTMLButtonElement).style.borderColor=showFallback?'rgba(212,160,68,.4)':'rgba(212,160,68,.15)'}}
                >{<TwemojiFlag emoji={o.f} size={showFallback ? 28 : 22} />}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ NODE 1 CONFIRM: Roger speaking ═══ */}
      {step === 'node1_speak' && base && (
        <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:24,animation:'gsi .3s ease-out' }}>
          <div style={{ position:'relative',width:80,height:80 }}>
            <div style={{ position:'absolute',inset:0,borderRadius:'50%',border:'2px solid rgba(212,160,68,.3)',animation:'gso 1.5s ease-out infinite' }} />
            <div style={{ position:'absolute',inset:0,borderRadius:'50%',border:'2px solid rgba(212,160,68,.2)',animation:'gso 1.5s ease-out infinite .5s' }} />
            <div style={{ position:'absolute',inset:'50%',transform:'translate(-50%,-50%)',width:40,height:40,borderRadius:'50%',background:'rgba(212,160,68,.15)',display:'flex',alignItems:'center',justifyContent:'center' }}>
              <Radio size={18} color="rgba(212,160,68,.8)" />
            </div>
          </div>
          <div style={mono(9,'rgba(212,160,68,.7)','.2em')}>ROGER IS SPEAKING...</div>
          <div style={{ ...mono(10,'rgba(255,255,255,.4)','.08em'),textTransform:'none',textAlign:'center',maxWidth:300 }}>
            "Roger. I'll operate in {LANG_LABELS[base]}. Which style do you prefer?"
          </div>
        </div>
      )}

      {/* ═══ NODE 2: Say your dialect ═══ */}
      {step === 'node2' && base && (
        <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:28,animation:'gsi .4s ease-out',padding:'0 24px',width:'100%',maxWidth:400 }}>
          <div style={mono(10,'rgba(212,160,68,.7)','.2em')}>WHICH STYLE?</div>
          <div style={{ ...mono(8,'rgba(255,255,255,.35)','.15em'),textAlign:'center' }}>— HOLD & SAY YOUR ACCENT —</div>

          {/* PTT */}
          <button onPointerDown={pttDown} onPointerUp={pttUp} onPointerCancel={pttUp} onContextMenu={e=>e.preventDefault()}
            style={{ width:100,height:100,borderRadius:'50%',border:ptt?'3px solid rgba(212,160,68,.8)':'2px solid rgba(212,160,68,.3)',background:ptt?'radial-gradient(circle,rgba(212,160,68,.25) 0%,rgba(212,160,68,.08) 100%)':'radial-gradient(circle,rgba(212,160,68,.1) 0%,rgba(212,160,68,.03) 100%)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',position:'relative',transition:'all .2s',animation:ptt?'gbr 1.2s ease-in-out infinite':'gp 3s ease-in-out infinite',WebkitTapHighlightColor:'transparent',touchAction:'none' }}>
            {ptt && <><div style={{ position:'absolute',inset:-4,borderRadius:'50%',border:'1px solid rgba(212,160,68,.4)',animation:'grp 1.5s ease-out infinite' }} /></>}
            <Mic size={28} color={ptt?'rgba(212,160,68,1)':'rgba(212,160,68,.6)'} />
          </button>

          {hint && <div style={{ ...mono(8,'rgba(255,200,100,.7)','.08em'),textTransform:'none',textAlign:'center',maxWidth:300,animation:'gfi .3s ease-out' }}>{hint}</div>}

          {/* Fallback dialect taps */}
          <div style={{ display:'flex',flexDirection:'column',gap:8,width:'100%' }}>
            <div style={{ ...mono(7,'rgba(255,255,255,.2)','.15em'),textAlign:'center',marginBottom:4 }}>OR TAP</div>
            {getDialectsForLanguage(base).map(loc => {
              const dc = DIALECT_CONFIG[loc];
              return (
                <button key={loc} onClick={() => selectDialect(loc)} style={{ background:'rgba(212,160,68,.06)',border:'1px solid rgba(212,160,68,.2)',borderRadius:12,padding:'14px 18px',cursor:'pointer',display:'flex',alignItems:'center',gap:14,transition:'all .25s',textAlign:'left',direction:base==='ar'?'rtl':'ltr' }}
                  onPointerEnter={e=>{(e.currentTarget as HTMLButtonElement).style.background='rgba(212,160,68,.15)';(e.currentTarget as HTMLButtonElement).style.borderColor='rgba(212,160,68,.5)'}}
                  onPointerLeave={e=>{(e.currentTarget as HTMLButtonElement).style.background='rgba(212,160,68,.06)';(e.currentTarget as HTMLButtonElement).style.borderColor='rgba(212,160,68,.2)'}}
                >
                  <TwemojiFlag emoji={dc.flag} size={24} />
                  <div style={{ flex:1 }}>
                    <div style={mono(11,'rgba(212,160,68,.9)','.08em')}>{dc.displayName}</div>
                    <div style={{ ...mono(8,'rgba(255,255,255,.35)','.05em'),textTransform:'none',marginTop:4 }}>"{dc.sampleGreeting}"</div>
                  </div>
                  <span style={mono(7,'rgba(212,160,68,.4)')}>▸</span>
                </button>
              );
            })}
          </div>

          <button onClick={() => { setStep('node1'); setBase(null); setHint(''); }}
            style={{ background:'none',border:'none',cursor:'pointer',...mono(8,'rgba(255,255,255,.3)','.15em'),marginTop:8 }}>← BACK</button>
        </div>
      )}

      {/* ═══ NODE 2 SPEAK: Roger summarizing choice ═══ */}
      {step === 'node2_speak' && locale && (
        <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:24,animation:'gsi .3s ease-out' }}>
          <div style={{ position:'relative',width:80,height:80 }}>
            <div style={{ position:'absolute',inset:0,borderRadius:'50%',border:'2px solid rgba(212,160,68,.3)',animation:'gso 1.5s ease-out infinite' }} />
            <div style={{ position:'absolute',inset:'50%',transform:'translate(-50%,-50%)',width:40,height:40,borderRadius:'50%',background:'rgba(212,160,68,.15)',display:'flex',alignItems:'center',justifyContent:'center' }}>
              <Radio size={18} color="rgba(212,160,68,.8)" />
            </div>
          </div>
          <div style={mono(9,'rgba(212,160,68,.7)','.2em')}>ROGER IS SPEAKING...</div>
          <div style={{ ...mono(8,'rgba(255,255,255,.3)','.1em'),textTransform:'none',textAlign:'center',maxWidth:300 }}>
            "{base ? LANG_LABELS[base] : ''}, {DIALECT_CONFIG[locale].displayName}. Confirm or change?"
          </div>
        </div>
      )}

      {/* ═══ NODE 3: Confirm / Change ═══ */}
      {step === 'node3' && locale && base && (
        <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:24,animation:'gsi .4s ease-out',padding:'0 24px',width:'100%',maxWidth:400 }}>
          {/* Summary */}
          <div style={{ textAlign:'center' }}>
            <TwemojiFlag emoji={DIALECT_CONFIG[locale].flag} size={36} />
            <div style={{ ...mono(14,'rgba(212,160,68,.95)','.08em'),marginTop:8 }}>{LANG_LABELS[base]}</div>
            <div style={{ ...mono(10,'rgba(255,255,255,.5)','.08em'),marginTop:4 }}>{DIALECT_CONFIG[locale].displayName}</div>
          </div>

          <div style={{ ...mono(8,'rgba(255,255,255,.35)','.15em'),textAlign:'center' }}>— HOLD PTT: CONFIRM OR CHANGE —</div>

          {/* PTT */}
          <button onPointerDown={pttDown} onPointerUp={pttUp} onPointerCancel={pttUp} onContextMenu={e=>e.preventDefault()}
            style={{ width:100,height:100,borderRadius:'50%',border:ptt?'3px solid rgba(16,185,129,.8)':'2px solid rgba(16,185,129,.3)',background:ptt?'radial-gradient(circle,rgba(16,185,129,.25) 0%,rgba(16,185,129,.08) 100%)':'radial-gradient(circle,rgba(16,185,129,.1) 0%,rgba(16,185,129,.03) 100%)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',position:'relative',transition:'all .2s',animation:ptt?'gbr 1.2s ease-in-out infinite':'gp 3s ease-in-out infinite',WebkitTapHighlightColor:'transparent',touchAction:'none' }}>
            {ptt && <div style={{ position:'absolute',inset:-4,borderRadius:'50%',border:'1px solid rgba(16,185,129,.4)',animation:'grp 1.5s ease-out infinite' }} />}
            <Mic size={28} color={ptt?'rgba(16,185,129,1)':'rgba(16,185,129,.6)'} />
          </button>

          {hint && <div style={{ ...mono(8,'rgba(255,200,100,.7)','.08em'),textTransform:'none',textAlign:'center',maxWidth:300,animation:'gfi .3s ease-out' }}>{hint}</div>}

          {/* Fallback taps */}
          <div style={{ display:'flex',gap:10,width:'100%' }}>
            <button onClick={() => lockIn(locale)} style={{ flex:2,background:'rgba(16,185,129,.1)',border:'1px solid rgba(16,185,129,.3)',borderRadius:10,padding:'12px',cursor:'pointer',transition:'all .2s',...mono(9,'rgba(16,185,129,.9)','.1em') }}>✓ CONFIRM</button>
            <button onClick={() => { setStep('node2'); setLocale(null); setHint(''); }} style={{ flex:1,background:'rgba(255,255,255,.04)',border:'1px solid rgba(255,255,255,.1)',borderRadius:10,padding:'12px',cursor:'pointer',transition:'all .2s',...mono(8,'rgba(255,255,255,.4)','.08em') }}>ACCENT</button>
            <button onClick={() => { setStep('node1'); setBase(null); setLocale(null); setHint(''); }} style={{ flex:1,background:'rgba(255,255,255,.04)',border:'1px solid rgba(255,255,255,.1)',borderRadius:10,padding:'12px',cursor:'pointer',transition:'all .2s',...mono(8,'rgba(255,255,255,.4)','.08em') }}>LANGUAGE</button>
          </div>
        </div>
      )}

      {/* ═══ NODE 3 SPEAK: Roger confirming ═══ */}
      {step === 'node3_speak' && locale && (
        <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:24,animation:'gsi .3s ease-out' }}>
          <div style={{ position:'relative',width:80,height:80 }}>
            <div style={{ position:'absolute',inset:0,borderRadius:'50%',border:'2px solid rgba(16,185,129,.3)',animation:'gso 1.5s ease-out infinite' }} />
            <div style={{ position:'absolute',inset:'50%',transform:'translate(-50%,-50%)',width:40,height:40,borderRadius:'50%',background:'rgba(16,185,129,.15)',display:'flex',alignItems:'center',justifyContent:'center' }}>
              <Radio size={18} color="rgba(16,185,129,.8)" />
            </div>
          </div>
          <div style={mono(9,'rgba(16,185,129,.7)','.2em')}>LOCKING IN...</div>
          <div style={{ ...mono(8,'rgba(255,255,255,.3)','.1em'),textTransform:'none',textAlign:'center',maxWidth:280,direction:locale.startsWith('ar')?'rtl':'ltr' }}>
            "{DIALECT_CONFIG[locale].confirmationScript}"
          </div>
        </div>
      )}

      {/* ═══ LOCKED IN ═══ */}
      {step === 'locked' && locale && (
        <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:20,animation:'gsi .4s ease-out' }}>
          <TwemojiFlag emoji={DIALECT_CONFIG[locale].flag} size={48} style={{ animation: 'glp .6s ease-in-out' }} />
          <div style={{ ...mono(13,'rgba(212,160,68,1)','.15em'),background:'linear-gradient(90deg,rgba(212,160,68,.8),rgba(255,215,100,1),rgba(212,160,68,.8))',backgroundSize:'200% auto',animation:'gsh 2s linear infinite',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent' }}>✓ LOCKED IN</div>
          <div style={mono(9,'rgba(255,255,255,.4)','.1em')}>{DIALECT_CONFIG[locale].displayName}</div>
        </div>
      )}

      {/* Footer */}
      <div style={{ position:'absolute',bottom:32,left:'50%',transform:'translateX(-50%)',...mono(7,'rgba(255,255,255,.15)','.2em'),textAlign:'center' }}>ROGER AI · LANGUAGE SELECTION</div>
    </div>
  );
}
