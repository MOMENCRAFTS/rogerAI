import { useState, useEffect, useRef, useCallback } from 'react';
import { Radio, MapPin } from 'lucide-react';
import MorningBriefing from './MorningBriefing';
import { useLocation, type UserLocation } from '../../lib/useLocation';
import { getCommute } from '../../lib/api';
import { checkGeoFences, geocodePlace } from '../../lib/geoFence';
import { supabase } from '../../lib/supabase';

import { processTransmission, extractMemoryFacts, type ConversationTurn } from '../../lib/openai';
import { speakResponse, stopSpeaking } from '../../lib/tts';
import { transcribeAudio } from '../../lib/whisper';
import { fetchNews, type NewsArticle } from '../../lib/news';
import { createAudioRecorder } from '../../lib/audioRecorder';
import {
  insertReminder, insertTask, insertMemory,
  fetchSurfaceQueue, updateSurfaceItem,
  insertConversationTurn, upsertEntityMention,
  fetchFrequentEntities, markEntitySurfaced, insertSurfaceItem,
  fetchReminders, fetchTasks, fetchMemoryGraph,
  type DbSurfaceItem,
} from '../../lib/api';

const MEDIA_RECORDER_SUPPORTED = typeof MediaRecorder !== 'undefined';

type PTTState = 'idle' | 'recording' | 'transcribing' | 'processing' | 'speaking' | 'responded' | 'awaiting_answer';

interface Message { id: string; role: 'user' | 'roger'; text: string; ts: number; intent?: string; outcome?: string; news?: NewsArticle[]; }

type UserTab = 'home' | 'reminders' | 'tasks' | 'memory' | 'settings';

export default function UserHome({ userId, sessionId, onTabChange, location: locationProp }: { userId: string; sessionId: string; onTabChange: (t: UserTab) => void; location?: UserLocation | null }) {
  const [pttState, setPttState]   = useState<PTTState>('idle');
  const [messages, setMessages]   = useState<Message[]>([]);
  const [history, setHistory]     = useState<ConversationTurn[]>([]);
  const [holdMs, setHoldMs]       = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [surfaceItems, setSurfaceItems] = useState<DbSurfaceItem[]>([]);
  const [activeSurface, setActiveSurface] = useState<DbSurfaceItem | null>(null);
  const [rogerMode]               = useState<'quiet' | 'active' | 'briefing'>('active');

  // Use prop location if provided (lifted from UserApp), fall back to own hook for standalone use
  const { location: hookLocation, locationLabel: hookLabel } = useLocation(userId);
  const location = locationProp !== undefined ? locationProp : hookLocation;
  const locationLabel = location?.city
    ? (location.country ? `${location.city}, ${location.country}` : location.city)
    : hookLabel;

  const recorderRef  = useRef<ReturnType<typeof createAudioRecorder> extends Promise<infer T> ? T : never | null>(null);
  const holdRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const awaitRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef    = useRef<HTMLDivElement>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-scroll
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages]);

  // Load surface queue on mount + deadline intelligence
  useEffect(() => {
    fetchSurfaceQueue(userId).then(setSurfaceItems).catch(() => {});

    // Deadline intelligence — surface reminders/tasks due within 24h
    const TWENTY_FOUR_H = 86_400_000;
    const now = Date.now();
    Promise.all([
      fetchReminders(userId, 'pending').catch(() => []),
      fetchTasks(userId, 'open').catch(() => []),
    ]).then(([reminders, tasks]) => {
      const upcoming = [
        ...reminders
          .filter(r => r.due_at && new Date(r.due_at).getTime() - now < TWENTY_FOUR_H && new Date(r.due_at).getTime() > now)
          .map(r => ({ label: `Reminder due soon: "${r.text}"`, id: `deadline-r-${r.id}` })),
        ...tasks
          .filter(t => t.due_at && new Date(t.due_at).getTime() - now < TWENTY_FOUR_H && new Date(t.due_at).getTime() > now)
          .map(t => ({ label: `Task due soon: "${t.text}" [Priority ${t.priority}]`, id: `deadline-t-${t.id}` })),
      ];
      upcoming.forEach(item =>
        insertSurfaceItem({
          user_id: userId, type: 'DEADLINE_ALERT',
          content: item.label,
          priority: 9, dismissed: false, snooze_count: 0,
          surface_at: new Date().toISOString(),
          context: 'Due within 24 hours', source_tx_id: item.id,
        }).catch(() => {})
      );
    }).catch(() => {});
  }, [userId]);

  // ── Geo-fence check — runs every time GPS updates (~60s) ─────────────────────
  useEffect(() => {
    if (!location) return;
    checkGeoFences(userId, location.latitude, location.longitude).then(triggered => {
      triggered.forEach(reminder => {
        // Mark as geo_triggered so it won't fire again
        Promise.resolve(supabase.from('reminders').update({ geo_triggered: true }).eq('id', reminder.id)).then(() => {}).catch(() => {});
        // Surface as high-priority card
        insertSurfaceItem({
          user_id: userId, type: 'GEO_REMINDER',
          content: `📍 You're near ${reminder.due_location} — ${reminder.text}`,
          priority: 10, dismissed: false, snooze_count: 0,
          surface_at: new Date().toISOString(),
          context: `Geo-triggered at ${location.city ?? 'your location'}`,
          source_tx_id: reminder.id,
        }).catch(() => {});
        // Speak the alert
        const msg = `Location alert — you're near ${reminder.due_location}. ${reminder.text}. Over.`;
        speakResponse(msg).catch(() => { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(msg)); });
      });
    }).catch(() => {});
  }, [location, userId]);

  // Proactive surface: in ACTIVE mode, pick item after 45s idle
  const triggerSurface = useCallback(() => {
    if (rogerMode !== 'active' || surfaceItems.length === 0 || pttState !== 'idle') return;
    const item = surfaceItems[0];
    setActiveSurface(item);
    const script = `${item.content} Over.`;
    setPttState('speaking');
    setIsSpeaking(true);
    speakResponse(script)
      .catch(() => { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(script)); })
      .finally(() => { setIsSpeaking(false); setPttState('awaiting_answer'); });
  }, [rogerMode, surfaceItems, pttState]);

  // Idle timer — reset on user activity
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(triggerSurface, 45_000);
  }, [triggerSurface]);

  useEffect(() => { resetIdleTimer(); return () => { if (idleTimerRef.current) clearTimeout(idleTimerRef.current); }; }, [resetIdleTimer]);

  // ── PTT Down ──────────────────────────────────────────────────────────────
  const handlePTTDown = useCallback(async () => {
    resetIdleTimer();
    if (pttState === 'speaking') { stopSpeaking(); setIsSpeaking(false); }
    else if (pttState !== 'idle' && pttState !== 'responded' && pttState !== 'awaiting_answer') return;
    if (awaitRef.current) clearTimeout(awaitRef.current);
    stopSpeaking(); setIsSpeaking(false);
    setPttState('recording'); setHoldMs(0);
    holdRef.current = setInterval(() => setHoldMs(h => h + 100), 100);

    if (MEDIA_RECORDER_SUPPORTED) {
      const recorder = await createAudioRecorder();
      (recorderRef as React.MutableRefObject<typeof recorder | null>).current = recorder;
      const granted = await recorder.start();
      if (!granted) { (recorderRef as React.MutableRefObject<typeof recorder | null>).current = null; }
    }
  }, [pttState, resetIdleTimer]);

  // ── PTT Up ────────────────────────────────────────────────────────────────
  const handlePTTUp = useCallback(async () => {
    if (pttState !== 'recording') return;
    if (holdRef.current) clearInterval(holdRef.current);
    resetIdleTimer();

    if (holdMs < 300) {
      setPttState('idle');
      const m = 'Too brief. Hold and speak clearly. Over.';
      speakResponse(m).catch(() => { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(m)); });
      return;
    }

    const recorder = (recorderRef as React.MutableRefObject<{ stop: () => Promise<Blob>; dispose: () => void } | null>).current;
    if (!recorder) { setPttState('idle'); return; }
    (recorderRef as React.MutableRefObject<null>).current = null;

    setPttState('transcribing');
    let transcript = '';
    try {
      const blob = await recorder.stop();
      recorder.dispose();
      const { transcript: t } = await transcribeAudio(blob);
      transcript = t;
      const clean = transcript.replace(/[^a-zA-Z\u0600-\u06FF]/g, '');
      if (!clean || clean.length < 3) {
        const m = 'Nothing received. Say your command. Over.';
        await speakResponse(m).catch(() => { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(m)); });
        setPttState('idle');
        return;
      }
    } catch {
      const m = 'Voice processing offline. Type below. Over.';
      speakResponse(m).catch(() => { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(m)); });
      setPttState('idle');
      return;
    }

    // User message
    setMessages(prev => [...prev, { id: `u-${Date.now()}`, role: 'user', text: transcript, ts: Date.now() }]);
    setPttState('processing');

    try {
      // Build location context string for GPT-4o injection
      const locationContext = location
        ? `${location.city ? `${location.city}, ` : ''}${location.country ?? ''} (${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)})`.trim()
        : undefined;
      const result = await processTransmission(transcript, history, undefined, userId, locationContext);

      // Append history
      setHistory(prev => [...prev.slice(-10),
        { role: 'user', content: transcript },
        { role: 'assistant', content: result.roger_response },
      ]);

      // Persist turns to conversation_history (fire-and-forget)
      const isTest = userId.includes('ADMIN');
      insertConversationTurn({ user_id: userId, session_id: sessionId, role: 'user', content: transcript, intent: null, is_admin_test: isTest }).catch(() => {});

      // Save to DB based on intent
      if (result.intent === 'CREATE_REMINDER') {
        // Detect geo-triggered reminder (LOCATION entity present)
        const locEntity = result.entities?.find(e => e.type === 'LOCATION' || e.type === 'PLACE');
        insertReminder({
          user_id: userId, text: transcript, entities: result.entities ?? null,
          due_at: null, status: 'pending', source_tx_id: null, is_admin_test: isTest,
          due_location:     locEntity?.text ?? null,
          due_location_lat: null,
          due_location_lng: null,
          due_radius_m:     300,
          geo_triggered:    false,
        }).catch(() => {});
        // Fire-and-forget geocoding for the location entity
        if (locEntity) {
          geocodePlace(locEntity.text, location?.latitude, location?.longitude).then(coords => {
            if (coords) {
              supabase.from('reminders')
                .update({ due_location: locEntity.text, due_location_lat: coords.lat, due_location_lng: coords.lng })
                .eq('user_id', userId).eq('status', 'pending').order('created_at', { ascending: false }).limit(1);
                  // fire-and-forget
            }
          }).catch(() => {});
        }
      } else if (!result.intent.startsWith('QUERY_') &&
                 !result.intent.startsWith('STATUS_') &&
                 !result.intent.startsWith('EXPLAIN_') &&
                 !result.intent.startsWith('MARKET_') &&
                 !result.intent.startsWith('RESEARCH_') &&
                 !result.intent.startsWith('BRIEFING_') &&
                 !result.intent.startsWith('WATCHLIST_') &&
                 !result.intent.startsWith('IDENTIFY_') &&
                 !result.intent.endsWith('_QUERY') &&
                 result.intent !== 'CONVERSE' &&
                 result.intent !== 'COMMUTE_QUERY') {
        // Save any action intent (CREATE_*, SEND_*, BOOK_*, CALL_*, SCHEDULE_*, etc.) as a task
        insertTask({ user_id: userId, text: transcript, priority: 5, status: 'open', due_at: null, source_tx_id: null, is_admin_test: isTest }).catch(() => {});
      } else if (result.intent === 'MEMORY_CAPTURE' || result.intent === 'BOOK_UPDATE') {
        // Tag memory with current location
        insertMemory({
          user_id: userId,
          type: result.intent === 'BOOK_UPDATE' ? 'book' : 'capture',
          text: result.roger_response,
          entities: result.entities ?? null,
          tags: [result.intent],
          source_tx_id: transcript,
          is_admin_test: isTest,
          location_label: location?.city ?? null,
          location_lat:   location?.latitude  ?? null,
          location_lng:   location?.longitude ?? null,
        }).catch(() => {});
      }

      // Persist Roger's turn
      insertConversationTurn({ user_id: userId, session_id: sessionId, role: 'assistant', content: result.roger_response, intent: result.intent, is_admin_test: isTest }).catch(() => {});

      // ── Auto-create proposed tasks (from every turn, not just action intents) ──
      if (result.proposed_tasks?.length) {
        result.proposed_tasks.forEach(pt => {
          insertTask({
            user_id: userId, text: pt.text,
            priority: pt.priority ?? 5, status: 'open',
            due_at: null, source_tx_id: null, is_admin_test: isTest,
          }).catch(() => {});
        });
      }

      // ── Save every exchange as a memory capture (enriches Memory panel) ─────
      insertMemory({
        user_id: userId,
        type: 'capture',
        text: `Q: ${transcript}\nA: ${result.roger_response.split('\n\n📋')[0]}`, // strip proposals from stored text
        entities: result.entities ?? null,
        tags: [result.intent, ...(result.proposed_tasks?.length ? ['HAS_PROPOSALS'] : [])],
        source_tx_id: sessionId,
        is_admin_test: isTest,
        location_label: location?.city ?? null,
        location_lat:   location?.latitude  ?? null,
        location_lng:   location?.longitude ?? null,
      }).catch(() => {});

      // ── Signal all panels to refresh ─────────────────────────────────────────
      window.dispatchEvent(new CustomEvent('roger:refresh'));

      // Track entity mentions + pattern detection (fire-and-forget)
      if (result.entities?.length) {
        Promise.all(
          result.entities
            .filter(e => ['PERSON','COMPANY','PROJECT','TOPIC'].includes(e.type))
            .map(e => upsertEntityMention(userId, e.text, e.type))
        ).then(() => fetchFrequentEntities(userId, 3)).then(hotEntities => {
          for (const entity of hotEntities) {
            insertSurfaceItem({
              user_id: userId, type: 'PATTERN_DETECTED',
              content: `You've mentioned ${entity.entity_text} ${entity.mention_count} times. Want to create a task or set a reminder?`,
              priority: 7, dismissed: false, snooze_count: 0,
              surface_at: new Date().toISOString(),
              context: `Entity: ${entity.entity_type}`, source_tx_id: null,
            }).catch(() => {});
            markEntitySurfaced(entity.id).catch(() => {});
          }
        }).catch(() => {});
      }

      // ── NEWS INTENT — fetch live headlines ────────────────────────────────
      const isNewsIntent = result.intent.startsWith('QUERY_NEWS') ||
        result.intent.startsWith('NEWS_') ||
        result.intent === 'BRIEFING_NEWS' ||
        result.intent.includes('NEWS') ||
        /\b(news|headlines?|briefing|updates?)\b/i.test(transcript);

      if (isNewsIntent) {
        try {
          const brief = await fetchNews(transcript);
          const newsText = brief.spokenBrief;
          setMessages(prev => [...prev, {
            id: `news-${Date.now()}`, role: 'roger' as const,
            text: newsText, ts: Date.now(),
            intent: result.intent, outcome: 'success',
            news: brief.articles,
          }]);
          setPttState('speaking'); setIsSpeaking(true);
          try { await speakResponse(newsText); }
          catch { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(newsText)); }
          setIsSpeaking(false); setPttState('responded');
          return;
        } catch {
          // Fall through to GPT-4o response if news fetch fails
        }
      }

      // COMMUTE_QUERY — Real Google Maps ETA
      if (result.intent === 'COMMUTE_QUERY' && location) {
        // Extract destination from GPT-4o entities (LOCATION type) or raw transcript
        const destEntity = result.entities?.find(e => e.type === 'LOCATION' || e.type === 'PLACE');
        const destination = destEntity?.text ?? transcript.replace(/how long|to get|to reach|commute|drive|to/gi, '').trim();
        if (destination) {
          getCommute(location.latitude, location.longitude, destination).then(commute => {
            if (commute) {
              const etaMsg = `${destination} is ${commute.duration} away by ${commute.mode} (${commute.distance}). Standing by. Over.`;
              setMessages(prev => [...prev, { id: `eta-${Date.now()}`, role: 'roger' as const, text: etaMsg, ts: Date.now(), type: 'response' as const }]);
              speakResponse(etaMsg).catch(() => { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(etaMsg)); });
            }
          }).catch(() => {});
        }
      }
      extractMemoryFacts(transcript, result.roger_response, userId).catch(() => {});

      // Meeting Prep Cards — surface what Roger knows about mentioned people
      const mentionedPeople = (result.entities ?? []).filter(e => e.type === 'PERSON');
      if (mentionedPeople.length > 0) {
        fetchMemoryGraph(userId, 'person').then(personFacts => {
          for (const person of mentionedPeople) {
            const relevantFacts = personFacts.filter(f =>
              f.subject.toLowerCase() === person.text.toLowerCase() ||
              f.object.toLowerCase() === person.text.toLowerCase()
            );
            if (relevantFacts.length > 0) {
              const summary = relevantFacts.slice(0, 3).map(f => `${f.subject} ${f.predicate} ${f.object}`).join('; ');
              insertSurfaceItem({
                user_id: userId, type: 'MEETING_PREP',
                content: `${person.text} mentioned — Roger knows: ${summary}`,
                priority: 8, dismissed: false, snooze_count: 0,
                surface_at: new Date().toISOString(),
                context: `${relevantFacts.length} memory facts`, source_tx_id: null,
              }).catch(() => {});
            }
          }
        }).catch(() => {});
      }

      // Roger response message
      const insight = (result as {insight?: string}).insight;
      setMessages(prev => [...prev, {
        id: `r-${Date.now()}`, role: 'roger',
        text: result.roger_response + (insight ? `\n\n💡 ${insight}` : ''),
        ts: Date.now(), intent: result.intent, outcome: result.outcome,
      }]);

      // TTS
      setPttState('speaking'); setIsSpeaking(true);
      try { await speakResponse(result.roger_response); }
      catch { try { window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(result.roger_response); window.speechSynthesis.speak(u); await new Promise<void>(res => { u.onend = () => res(); }); } catch { /* silent */ } }
      setIsSpeaking(false);

      if (result.outcome === 'clarification') {
        setPttState('awaiting_answer');
        awaitRef.current = setTimeout(() => handlePTTDown(), 800);
        setTimeout(() => { if (awaitRef.current) clearTimeout(awaitRef.current); setPttState(s => s === 'awaiting_answer' ? 'idle' : s); }, 8000);
      } else {
        setPttState('responded');
      }
    } catch (e) {
      const m = e instanceof Error && e.message.includes('abort') ? 'Signal timeout. Retry. Over.' : 'AI offline. Retry. Over.';
      speakResponse(m).catch(() => { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(m)); });
      setIsSpeaking(false); setPttState('responded');
    }
  }, [pttState, holdMs, history, userId, handlePTTDown, resetIdleTimer]);

  // ── Surface item response ─────────────────────────────────────────────────
  const handleSurfaceAction = async (action: 'execute' | 'forget' | 'defer') => {
    if (!activeSurface) return;
    const patch =
      action === 'forget' ? { dismissed: true } :
      action === 'defer'  ? { snooze_count: activeSurface.snooze_count + 1, surface_at: new Date(Date.now() + 7200_000).toISOString() } :
      { dismissed: true };
    await updateSurfaceItem(activeSurface.id, patch).catch(() => {});
    setSurfaceItems(prev => prev.filter(i => i.id !== activeSurface.id));
    setActiveSurface(null);
    setPttState('idle');
  };

  // ── State display ─────────────────────────────────────────────────────────
  const stateLabel = pttState === 'recording' ? `● REC ${(holdMs/1000).toFixed(1)}s`
    : pttState === 'transcribing' ? 'WHISPER...'
    : pttState === 'processing'   ? 'THINKING...'
    : pttState === 'speaking'     ? 'ROGER SPEAKING'
    : pttState === 'awaiting_answer' ? 'ANSWER ROGER'
    : 'HOLD TO TRANSMIT';

  const btnColor = pttState === 'recording' ? '#d4a044'
    : pttState === 'speaking' || pttState === 'awaiting_answer' ? '#4ade80'
    : pttState === 'processing' || pttState === 'transcribing' ? '#a78bfa'
    : 'var(--text-muted)';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 0 }}>

      {/* ── Header ── */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Radio size={14} style={{ color: 'var(--green)' }} className="led-pulse" />
          <span style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: '0.2em', color: 'var(--amber)', textTransform: 'uppercase', fontWeight: 600 }}>Roger AI</span>
        </div>
        <span style={{ fontFamily: 'monospace', fontSize: 9, padding: '2px 8px', border: '1px solid var(--green-border)', background: 'var(--green-dim)', color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
          📡 {rogerMode.toUpperCase()}
        </span>
        {location && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'monospace', fontSize: 9, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
            <MapPin size={9} /> {locationLabel}
          </span>
        )}
      </div>

      {/* ── Proactive Surface Card ── */}
      {activeSurface && (
        <div style={{ margin: '12px 16px 0', padding: '14px 16px', background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.15em' }}>🎙 ROGER · PROACTIVE</span>
            <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>Auto-surfaced</span>
          </div>
          <p style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', margin: '0 0 12px', lineHeight: 1.5 }}>{activeSurface.content}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['Handle it', 'execute'], ['Later', 'defer'], ['Forget', 'forget']].map(([label, action]) => (
              <button key={action} onClick={() => handleSurfaceAction(action as 'execute' | 'defer' | 'forget')}
                style={{ flex: 1, padding: '6px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer',
                  background: 'transparent', border: `1px solid ${action === 'execute' ? 'var(--green-border)' : action === 'forget' ? 'rgba(239,68,68,0.3)' : 'var(--border-subtle)'}`,
                  color: action === 'execute' ? 'var(--green)' : action === 'forget' ? '#f87171' : 'var(--text-secondary)' }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Messages ── */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.length === 0 && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: 0.35 }}>
            <Radio size={32} style={{ color: 'var(--amber)' }} />
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.2em' }}>Press and hold to transmit</span>
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start', gap: 6 }}>
            <div style={{
              maxWidth: '85%', padding: '10px 14px',
              background: msg.role === 'user' ? 'rgba(212,160,68,0.1)' : msg.outcome === 'clarification' ? 'rgba(212,160,68,0.06)' : 'rgba(74,222,128,0.06)',
              border: `1px solid ${msg.role === 'user' ? 'rgba(212,160,68,0.2)' : msg.outcome === 'clarification' ? 'rgba(212,160,68,0.2)' : 'rgba(74,222,128,0.15)'}`,
            }}>
              <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
                {msg.role === 'user' ? 'YOU' : `ROGER${msg.intent ? ` · ${msg.intent}` : ''}`}
              </div>
              <p style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', margin: 0, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{msg.text}</p>
            </div>

            {/* News article cards */}
            {msg.news && msg.news.length > 0 && (
              <div style={{ maxWidth: '85%', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {msg.news.map((article, i) => (
                  <a
                    key={i}
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'block', padding: '10px 12px', textDecoration: 'none',
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(74,222,128,0.1)',
                      borderLeft: '3px solid var(--green)',
                      transition: 'background 150ms',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(74,222,128,0.07)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                  >
                    <div style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 4 }}>
                      📰 {article.source} · {new Date(article.publishedAt).toLocaleDateString()}
                    </div>
                    <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                      {article.title}
                    </div>
                    {article.description && (
                      <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.3,
                        overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                        {article.description}
                      </div>
                    )}
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
        {(pttState === 'transcribing' || pttState === 'processing') && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: 0.6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--amber)', animation: 'pulse 1s infinite' }} />
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{stateLabel}</span>
          </div>
        )}
      </div>

      {/* ── Morning Briefing ── */}
      {messages.length === 0 && <MorningBriefing userId={userId} location={location} />}

      {/* ── Quick Nav Shortcuts ── */}
      <div style={{ padding: '8px 16px', display: 'flex', gap: 8, borderTop: '1px solid var(--border-subtle)', overflowX: 'auto' }}>
        {[['Reminders', 'reminders'], ['Tasks', 'tasks'], ['Memory', 'memory']].map(([label, tab]) => (
          <button key={tab} onClick={() => onTabChange(tab as UserTab)}
            style={{ flexShrink: 0, padding: '5px 12px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── PTT Button ── */}
      <div style={{ padding: '20px 16px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, borderTop: '1px solid var(--border-subtle)' }}>
        <span style={{ fontFamily: 'monospace', fontSize: 9, color: btnColor, textTransform: 'uppercase', letterSpacing: '0.2em', transition: 'color 200ms' }}>
          {stateLabel}
        </span>
        <button
          onPointerDown={handlePTTDown}
          onPointerUp={handlePTTUp}
          onPointerLeave={handlePTTUp}
          aria-label={isSpeaking ? 'Interrupt Roger — press to speak' : 'Push to talk'}
          style={{
            width: 88, height: 88, borderRadius: '50%', border: `3px solid ${btnColor}`,
            background: pttState === 'recording' ? 'rgba(212,160,68,0.15)' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', transition: 'all 200ms', marginBottom: 8,
            boxShadow: pttState === 'recording' ? `0 0 24px ${btnColor}44` : 'none',
          }}
        >
          <Radio size={32} style={{ color: btnColor, transition: 'color 200ms' }} />
        </button>
      </div>
    </div>
  );
}
