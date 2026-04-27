import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Radio, MapPin, Square } from 'lucide-react';
import { RogerIcon } from '../../components/icons';
import { useI18n } from '../../context/I18nContext';
import MorningBriefing from './MorningBriefing';
import SpotifyMiniPlayer from './SpotifyMiniPlayer';
import RadioMiniPlayer from './RadioMiniPlayer';
import { useLocation, type UserLocation } from '../../lib/useLocation';
import { getCommute } from '../../lib/api';
import { checkGeoFences, geocodePlace } from '../../lib/geoFence';
import { supabase } from '../../lib/supabase';
import {
  hapticPTTDown, hapticPTTUp, hapticRogerSpeaking,
  hapticResponseReceived, hapticError, hapticGeoAlert, hapticSurface,
  hapticMilestone,
} from '../../lib/haptics';
import {
  preloadAll, sfxPTTDown, sfxPTTUp, sfxRogerIn, sfxRogerOut, sfxError,
} from '../../lib/sfx';

import { processTransmission, extractMemoryFacts, generateSurfaceScript, compileEncyclopediaArticle, type ConversationTurn } from '../../lib/openai';
import { speakResponse, stopSpeaking, unlockAudio } from '../../lib/tts';
import { transcribeAudio } from '../../lib/whisper';
import { buildWhisperHint } from '../../lib/whisperHint';
import { fetchNews, type NewsArticle } from '../../lib/news';
import { fetchQuote, fetchMarketContext, quoteToSpeech } from '../../lib/finance';
import { fetchFlightStatus, flightToSpeech } from '../../lib/flight';
import { fetchTodayEvents, createCalendarEvent, deleteCalendarEvent, eventToSpeech } from '../../lib/googleCalendar';
import { playSearch, pausePlayback, nextTrack, isSpotifyConnected } from '../../lib/spotify';
import { pushTaskToNotion } from '../../lib/notion';
import { createAudioRecorder } from '../../lib/audioRecorder';
import { createAmbientSession, type AmbientSessionResult, type AmbientChunkResult } from '../../lib/ambientListener';
import { createMeetingRecorder, type MeetingResult, type MeetingChunk } from '../../lib/meetingRecorder';
import { logClarification } from '../../lib/clarificationLogger';
import {
  type ClarificationContext,
  type IntentOption,
  createClarificationContext,
  isClarificationExpired,
  isClarificationExhausted,
  CLARIFICATION_EXPIRY_MS,
} from '../../lib/clarificationContext';
import {
  insertReminder, insertTask, insertTaskWithDedup, insertMemory,
  fetchSurfaceQueue, updateSurfaceItem,
  subscribeToRelayMessages, deferRelayMessage, markRelayRead,
  insertConversationTurn, upsertEntityMention,
  fetchFrequentEntities, markEntitySurfaced, insertSurfaceItem,
  fetchReminders, fetchTasks, fetchMemoryGraph,
  upsertEncyclopediaEntry,
  type DbSurfaceItem, type DbRelayMessage,
} from '../../lib/api';
import { useArrivalDebrief } from '../../lib/useArrivalDebrief';
import { useAlarmEngine } from '../../lib/useAlarmEngine';
import {
  initProactive, handleProactivePTT, setProactiveMode, setTalkativeDelivery,
  triggerIdleCheckin, triggerThinkingMessage,
  clearPending, type PendingMessage,
} from '../../lib/proactiveEngine';
import { useSubscription } from '../../lib/useSubscription';
import { getSilentNode } from '../../lib/silentNode';
import { buildIntentContext } from '../../lib/intentRegistry';

const MEDIA_RECORDER_SUPPORTED = typeof MediaRecorder !== 'undefined';

type PTTState = 'idle' | 'recording' | 'transcribing' | 'processing' | 'speaking' | 'responded' | 'awaiting_answer';

// ── Badge celebration ────────────────────────────────────────────────────────
interface BadgeCelebration {
  icon: string;
  title: string;
  subtitle: string;
  color: string;
  glow: string;
  image: string;
}

const MILESTONE_BADGES: Record<number, BadgeCelebration> = {
  7:   { icon: 'badge-7day', title: '7-Day Warrior', subtitle: 'First streak freeze earned', color: '#ef4444', glow: 'rgba(239,68,68,0.3)', image: '/badges/badge_7day_warrior.png' },
  14:  { icon: 'badge-14day', title: 'Dedicated Learner', subtitle: '14 days of commitment', color: '#f59e0b', glow: 'rgba(245,158,11,0.3)', image: '/badges/badge_dedicated_learner.png' },
  30:  { icon: 'badge-30day', title: 'Monthly Master', subtitle: 'One full month conquered', color: '#d4a044', glow: 'rgba(212,160,68,0.3)', image: '/badges/badge_monthly_master.png' },
  60:  { icon: 'badge-60day', title: 'Diamond Scholar', subtitle: 'Two months of excellence', color: '#60a5fa', glow: 'rgba(96,165,250,0.3)', image: '/badges/badge_diamond_scholar.png' },
  100: { icon: 'badge-100day', title: 'Elite Commander', subtitle: 'Triple-digit legend', color: '#8b5cf6', glow: 'rgba(139,92,246,0.3)', image: '/badges/badge_elite_commander.png' },
  365: { icon: 'badge-365day', title: 'Supreme Linguist', subtitle: 'One year. Unstoppable.', color: '#fbbf24', glow: 'rgba(251,191,36,0.4)', image: '/badges/badge_supreme_linguist.png' },
};

const FREEZE_BADGE: BadgeCelebration = {
  icon: 'badge-freeze', title: 'Streak Saved', subtitle: 'Freeze token activated', color: '#38bdf8', glow: 'rgba(56,189,248,0.3)', image: '/badges/badge_streak_freeze.png',
};

const PTT_RANK_IMAGES: Record<string, string> = {
  ROOKIE: '/badges/badge_ptt_rookie.png',
  OPERATOR: '/badges/badge_ptt_operator.png',
  COMMANDER: '/badges/badge_ptt_commander.png',
  LEGEND: '/badges/badge_ptt_legend.png',
};

function getPTTRank(totalSessions: number): { label: string; icon: string; color: string; image?: string } {
  if (totalSessions >= 1000) return { label: 'LEGEND', icon: 'badge-365day', color: '#fbbf24', image: PTT_RANK_IMAGES.LEGEND };
  if (totalSessions >= 500)  return { label: 'COMMANDER', icon: 'badge-100day', color: '#8b5cf6', image: PTT_RANK_IMAGES.COMMANDER };
  if (totalSessions >= 200)  return { label: 'VETERAN', icon: 'badge-14day', color: '#f59e0b' };
  if (totalSessions >= 50)   return { label: 'OPERATOR', icon: 'mode-active', color: '#3b82f6', image: PTT_RANK_IMAGES.OPERATOR };
  if (totalSessions >= 10)   return { label: 'CADET', icon: 'badge-cadet', color: '#10b981' };
  return { label: 'ROOKIE', icon: 'svc-radio', color: '#64748b', image: PTT_RANK_IMAGES.ROOKIE };
}

// ── Pending confirmation gate ────────────────────────────────────────────────
interface PendingAction {
  type: 'reminder' | 'task' | 'meeting' | 'sms';
  label: string;          // what Roger will speak
  execute: () => void;    // the actual DB write
}

interface Message { id: string; role: 'user' | 'roger'; text: string; ts: number; intent?: string; outcome?: string; news?: NewsArticle[]; isKnowledge?: boolean; subtopics?: { label: string; emoji: string }[]; deepDiveDepth?: number; translationSource?: string; translationTarget?: string; translationTargetLang?: string; translationRomanized?: string; }

type UserTab = 'home' | 'reminders' | 'tasks' | 'memory' | 'settings';

export default function UserHome({ userId, sessionId, onTabChange, location: locationProp }: { userId: string; sessionId: string; onTabChange: (t: UserTab) => void; location?: UserLocation | null }) {
  const { checkGate } = useSubscription(userId);
  const { t } = useI18n();
  const [pttState, setPttState]   = useState<PTTState>('idle');
  const [messages, setMessages]   = useState<Message[]>([]);
  const [history, setHistory]     = useState<ConversationTurn[]>([]);
  const [holdMs, setHoldMs]       = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [surfaceItems, setSurfaceItems] = useState<DbSurfaceItem[]>([]);
  const [activeSurface, setActiveSurface] = useState<DbSurfaceItem | null>(null);
  const [rogerMode, setRogerMode] = useState<'quiet' | 'active' | 'briefing'>('active');
  const [talkativeEnabled, setTalkativeEnabled] = useState(false);
  const [talkativeFreq, setTalkativeFreq] = useState<'thoughtful' | 'active_talk' | 'always_on'>('thoughtful');
  const [thinkingPulse, setThinkingPulse]       = useState(false);  // pulsating red PTT
  const [clarifQuestion, setClarifQuestion] = useState<string>('');
  const [clarifCountdown, setClarifCountdown] = useState(0);
  const clarifTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // ── Relay inbox state ──────────────────────────────────────────────────────
  const [incomingRelay, setIncomingRelay] = useState<DbRelayMessage | null>(null);
  // ── Tune In state ──────────────────────────────────────────────────────────
  const [activeTuneInSession, setActiveTuneInSession] = useState<{ sessionId: string; withName: string } | null>(null);
  const [incomingTuneInRequest, setIncomingTuneInRequest] = useState<{ requestId: string; from: string; callsign: string; reason: string | null; expiresAt: string } | null>(null);
  const [pendingContactSave, setPendingContactSave] = useState<{ callsign: string; contactName: string } | null>(null);
  const [contactSaveInput, setContactSaveInput] = useState('');
  const [myCallsign, setMyCallsign] = useState<string | null>(null);
  // ── Confirmation gate ─────────────────────────────────────────────────────
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  // ── Name confirm ──────────────────────────────────────────────────────────
  // ── Deep Dive Knowledge state ─────────────────────────────────────────────
  const [deepDiveState, setDeepDiveState] = useState<{
    topic: string;
    depth: number;
    coverageSummary: string;
    turns: string[];       // raw turns for encyclopedia compilation
  } | null>(null);
  const deepDiveRef = useRef(deepDiveState);
  deepDiveRef.current = deepDiveState;
  const [pendingNameConfirm, setPendingNameConfirm] = useState<{ name: string; factId?: string } | null>(null);
  // ── Clarification resolution state (L1) ────────────────────────────────────
  const [pendingClarification, setPendingClarification] = useState<ClarificationContext | null>(null);
  const [intentOptions, setIntentOptions] = useState<IntentOption[] | null>(null);
  const clarificationExpiryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ── Badge celebration overlay ─────────────────────────────────────────────
  const [activeBadge, setActiveBadge] = useState<BadgeCelebration | null>(null);
  const badgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showBadge = useCallback((badge: BadgeCelebration) => {
    setActiveBadge(badge);
    if (badgeTimerRef.current) clearTimeout(badgeTimerRef.current);
    badgeTimerRef.current = setTimeout(() => setActiveBadge(null), 5000);
  }, []);

  // ── Ambient Listening state ───────────────────────────────────────────────
  const [ambientActive, setAmbientActive]           = useState(false);
  const [ambientLastChunk, setAmbientLastChunk]     = useState<AmbientChunkResult | null>(null);
  const ambientSessionRef = useRef<ReturnType<typeof createAmbientSession> | null>(null);
  // ── Meeting Recorder state ────────────────────────────────────────────────
  const [meetingActive, setMeetingActive]           = useState(false);
  const [meetingElapsed, setMeetingElapsed]         = useState(0);
  const [meetingWords, setMeetingWords]             = useState(0);
  const [meetingTitle, setMeetingTitle]             = useState('');
  const meetingRecorderRef = useRef<ReturnType<typeof createMeetingRecorder> | null>(null);

  // Use prop location if provided (lifted from UserApp), fall back to own hook for standalone use
  const { location: hookLocation, locationLabel: hookLabel } = useLocation(userId);
  const location = locationProp !== undefined ? locationProp : hookLocation;
  const locationLabel = location?.city
    ? (location.country ? `${location.city}, ${location.country}` : location.city)
    : hookLabel;

  // ── Stabilised GPS coordinates ─────────────────────────────────────────────
  // GPS watchPosition fires every few seconds with sub-metre jitter.
  // Rounding to 2 decimals (~1.1 km) prevents effects that depend on lat/lng
  // from re-running on every tick. This eliminates the reminders + prayer_prefs
  // + prayer-times query storm visible in the network tab.
  const stableLat = useMemo(() => Math.round((location?.latitude ?? 0) * 100) / 100, [location?.latitude]);
  const stableLng = useMemo(() => Math.round((location?.longitude ?? 0) * 100) / 100, [location?.longitude]);
  const hasLocation = location != null;

  const recorderRef  = useRef<ReturnType<typeof createAudioRecorder> extends Promise<infer T> ? T : never | null>(null);
  const holdRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const pttStartRef  = useRef<number>(0);
  const awaitRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef    = useRef<HTMLDivElement>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stores a chip prompt waiting to be processed through the PTT pipeline
  const chipPromptRef = useRef<string | null>(null);
  // ── PTT Gesture refs ─────────────────────────────────────────────────────
  const lastRogerMsgRef   = useRef<string>('');       // last Roger response for replay
  const lastTapTimeRef    = useRef<number>(0);         // timestamp of last short tap
  const tapCountRef       = useRef<number>(0);          // consecutive short taps for triple-tap confirm
  const pttWasSpeakingRef = useRef<boolean>(false);    // tracks if PTT down happened during speaking
  const whisperHintRef    = useRef<string>('');          // Whisper vocabulary hint (contact names, etc.)

  // Arrival debrief — geo-triggered spoken brief on arriving at work/home
  useArrivalDebrief(userId, location ?? null, (text) => {
    setMessages(prev => [...prev, {
      id: `arrival-${Date.now()}`, role: 'roger',
      text, ts: Date.now(), type: 'response' as const,
    }]);
    speakResponse(text).catch(() => {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    });
  });

  // Load own callsign
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from('user_callsigns').select('callsign').eq('user_id', userId).maybeSingle();
        if (data?.callsign) setMyCallsign(data.callsign);
      } catch { /* silent */ }
    })();
    // Build Whisper vocabulary hint (contacts + memory + static vocab)
    buildWhisperHint(userId).then(h => { whisperHintRef.current = h; }).catch(() => {});
  }, [userId]);

  // ── Silent AI Node — lifecycle ─────────────────────────────────────────────
  const silentNodeRef = useRef(getSilentNode());
  useEffect(() => {
    const node = silentNodeRef.current;
    node.start({ userId }).catch(err => console.warn('[SilentNode] Init failed:', err));

    // ── Task Automation: auto-resolve sweep on mount ──
    import('../../lib/api').then(({ autoResolveTasks }) => {
      autoResolveTasks(userId).then(resolved => {
        if (resolved.length > 0) {
          console.log(`[TaskEngine] Auto-resolved ${resolved.length} tasks`);
          window.dispatchEvent(new CustomEvent('roger:tasks-auto-resolved', {
            detail: { count: resolved.length, tasks: resolved }
          }));
        }
      }).catch(() => {});
    }).catch(() => {});

    return () => { node.stop(); };
  }, [userId]);

  // ── Alarm engine (polls due reminders every 60s, fires voice alerts) ──────
  useAlarmEngine(userId);

  // ── Islamic Mode: proactive prayer alerts ─────────────────────────────────
  // Fires TTS alerts:
  //   • 10 min before each prayer STARTS
  //   • 30 min before each prayer window ENDS  (gentle reminder)
  //   • 15 min before each prayer window ENDS  (urgent reminder)
  // Only activates if the user has islamic_mode === true in their preferences.
  useEffect(() => {
    let cancelled = false;
    const timerIds: ReturnType<typeof setTimeout>[] = [];

    (async () => {
      try {
        const { data: prefs } = await (await import('../../lib/supabase')).supabase
          .from('user_preferences')
          .select('islamic_mode, prayer_notifications')
          .eq('user_id', userId)
          .maybeSingle();

        if (cancelled) return;
        const islamicOn = !!(prefs as Record<string, unknown> | null)?.islamic_mode;
        const notifOn   = (prefs as Record<string, unknown> | null)?.prayer_notifications !== false;

        if (!islamicOn || !notifOn || rogerMode === 'quiet') return;

        // Fetch today's prayer times based on stable GPS or Riyadh fallback
        const lat = stableLat || 24.71;
        const lng = stableLng || 46.78;
        const { fetchPrayerTimes: fpt, bearingToCardinal: btc, getQiblaDirection: gqd, getPrayerEndTimes: gpet } =
          await import('../../lib/islamicApi');
        const times = await fpt(lat, lng).catch(() => null);
        if (!times || cancelled) return;

        const PRAYER_NAMES = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'] as const;
        const now = new Date();
        const nowSecs = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
        const qibla = gqd(lat, lng);
        const direction = btc(qibla);
        const endTimes = gpet(times);

        // Helper: log alert to DB
        const logAlert = (prayerName: string, alertType: string) => {
          import('../../lib/supabase').then(({ supabase: sb }) => {
            Promise.resolve(sb.from('islamic_alerts_log').insert({
              user_id: userId,
              prayer_name: prayerName,
              alert_type: alertType,
            })).catch(() => {});
          }).catch(() => {});
        };

        // Helper: schedule a timer
        const schedule = (delaySecs: number, msg: string, prayerName: string, alertType: string) => {
          const delayMs = delaySecs * 1000;
          if (delayMs > 0) {
            const id = setTimeout(() => {
              if (cancelled || (rogerMode as string) === 'quiet') return;
              speakResponse(msg).catch(() => {
                window.speechSynthesis.speak(new SpeechSynthesisUtterance(msg));
              });
              logAlert(prayerName, alertType);
            }, delayMs);
            timerIds.push(id);
          }
        };

        PRAYER_NAMES.forEach(name => {
          const [h, min] = (times[name] as string).split(':').map(Number);
          const prayerSecs = h * 3600 + min * 60;
          const endSecs = endTimes[name];

          // ── 1. Alert 10 min BEFORE prayer starts ──
          const startAlertSecs = prayerSecs - 600;
          schedule(
            startAlertSecs - nowSecs,
            `Roger. ${name} prayer begins in 10 minutes. Qibla is to your ${direction}. Over.`,
            name,
            'start',
          );

          // ── 2. Alert 30 min BEFORE prayer window ends ──
          // Only fire if the prayer window is > 30 minutes long
          const windowDuration = endSecs - prayerSecs;
          const end30Secs = endSecs - 1800; // 30 min before end

          if (windowDuration > 1800) {
            // For Isha that wraps past midnight, adjust nowSecs comparison
            let adjustedNow = nowSecs;
            if (name === 'Isha' && end30Secs > 86400 && nowSecs < prayerSecs) {
              adjustedNow = nowSecs + 86400;
            }
            const delay30 = end30Secs - (name === 'Isha' && end30Secs > 86400 ? adjustedNow : nowSecs);
            schedule(
              delay30,
              `Roger. ${name} prayer window closes in 30 minutes. Qibla is to your ${direction}. Over.`,
              name,
              'ending_30',
            );
          }

          // ── 3. Alert 15 min BEFORE prayer window ends ──
          // Only fire if the prayer window is > 15 minutes long
          const end15Secs = endSecs - 900; // 15 min before end

          if (windowDuration > 900) {
            let adjustedNow = nowSecs;
            if (name === 'Isha' && end15Secs > 86400 && nowSecs < prayerSecs) {
              adjustedNow = nowSecs + 86400;
            }
            const delay15 = end15Secs - (name === 'Isha' && end15Secs > 86400 ? adjustedNow : nowSecs);
            schedule(
              delay15,
              `Attention. Only 15 minutes left for ${name} prayer. Qibla is to your ${direction}. Don't miss it. Over.`,
              name,
              'ending_15',
            );
          }
        });
      } catch { /* silent — Islamic alerts are best-effort */ }
    })();

    return () => {
      cancelled = true;
      timerIds.forEach(id => clearTimeout(id));
    };
  }, [userId, stableLat, stableLng, rogerMode]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Subscribe to incoming relay messages via Supabase Realtime
  useEffect(() => {
    const channel = subscribeToRelayMessages(userId, (msg) => {
      setIncomingRelay(msg);
      // Speak Roger's delivery line via TTS
      const timeRef = (() => {
        const m = Math.floor((Date.now() - new Date(msg.created_at).getTime()) / 60000);
        return m < 1 ? 'just now' : m < 60 ? `${m} minutes ago` : `${Math.floor(m / 60)} hours ago`;
      })();
      const prefix = msg.priority === 'emergency' ? 'EMERGENCY relay incoming from'
        : msg.priority === 'urgent' ? 'Urgent message from'
        : 'Message from';
      const spoken = `${prefix} one of your contacts, ${timeRef}: ${msg.roger_summary ?? msg.transcript}. Over.`;
      speakResponse(spoken).catch(() => {});
    });
    return () => { channel.unsubscribe(); };
  }, [userId]);

  // Subscribe to Tune In Realtime events
  useEffect(() => {
    // tunein-{userId} — incoming requests / accepted / declined
    const requestCh = supabase
      .channel(`tunein-${userId}`)
      .on('broadcast', { event: 'tune_in_request' }, ({ payload }) => {
        const p = payload as { requestId: string; from: string; callsign: string; reason: string | null; expiresAt: string; rogerSpeak?: string };
        setIncomingTuneInRequest({ requestId: p.requestId, from: p.from, callsign: p.callsign, reason: p.reason, expiresAt: p.expiresAt });
        if (p.rogerSpeak) speakResponse(p.rogerSpeak).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
      })
      .on('broadcast', { event: 'tune_in_accepted' }, ({ payload }) => {
        const p = payload as { sessionId: string; withName: string; rogerSpeak?: string };
        setActiveTuneInSession({ sessionId: p.sessionId, withName: p.withName });
        setIncomingTuneInRequest(null);
        if (p.rogerSpeak) speakResponse(p.rogerSpeak).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
      })
      .on('broadcast', { event: 'tune_in_declined' }, ({ payload }) => {
        const p = payload as { rogerSpeak?: string };
        setIncomingTuneInRequest(null);
        if (p.rogerSpeak) speakResponse(p.rogerSpeak).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
      })
      .subscribe();

    return () => { requestCh.unsubscribe(); };
  }, [userId]);

  // Subscribe to active session events (turn relay + session end)
  useEffect(() => {
    if (!activeTuneInSession) return;
    const { sessionId: sid, withName } = activeTuneInSession;

    const sessionCh = supabase
      .channel(`tunein-session-${sid}`)
      .on('broadcast', { event: 'session_turn' }, ({ payload }) => {
        const p = payload as { speakerId: string; spokenLine: string; transcript: string };
        // Only speak turns from the OTHER person
        if (p.speakerId !== userId && p.spokenLine) {
          speakResponse(p.spokenLine).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
          setMessages(prev => [...prev, { id: `turn-${Date.now()}`, role: 'roger', text: `📡 ${withName}: ${p.transcript}`, ts: Date.now() }]);
        }
      })
      .on('broadcast', { event: 'session_ended' }, ({ payload }) => {
        const p = payload as { rogerSpeak?: string };
        const prevSession = activeTuneInSession; // capture before clearing
        setActiveTuneInSession(null);
        if (p.rogerSpeak) speakResponse(p.rogerSpeak).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
        // If the other person was a stranger (not yet saved as contact), prompt to save
        if (prevSession?.withName?.startsWith('Callsign ')) {
          const cs = prevSession.withName.replace('Callsign ', '');
          setPendingContactSave({ callsign: cs, contactName: '' });
          setContactSaveInput('');
          const prompt = `That was Callsign ${cs}. Want to save them as a contact? Just type or say their name.`;
          setTimeout(() => speakResponse(prompt).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); }), 2000);
        }
      })
      .subscribe();

    return () => { sessionCh.unsubscribe(); };
  }, [activeTuneInSession, userId]);

  // ── Geo-fence check — throttled to once per 60s ────────────────────────────
  const lastGeoCheckRef = useRef<number>(0);
  useEffect(() => {
    if (!hasLocation || !location) return;
    const now = Date.now();
    // Throttle: skip if checked less than 60s ago
    if (now - lastGeoCheckRef.current < 60_000) return;
    lastGeoCheckRef.current = now;
    checkGeoFences(userId, location.latitude, location.longitude).then(triggered => {
      triggered.forEach(reminder => {
        // Mark as geo_triggered so it won't fire again
        Promise.resolve(supabase.from('reminders').update({ geo_triggered: true }).eq('id', reminder.id)).then(() => {}).catch(() => {});
        // Haptic alert for geo-fence trigger
        hapticGeoAlert();
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
        speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
      });
    }).catch(() => {});
  }, [stableLat, stableLng, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Proactive surface: in ACTIVE mode, pick item after 45s idle
  const triggerSurface = useCallback(async () => {
    if (rogerMode !== 'active' || surfaceItems.length === 0 || pttState !== 'idle') return;
    const item = surfaceItems[0];
    // Remove item from queue immediately so next idle trigger picks the next one
    setSurfaceItems(prev => prev.filter(i => i.id !== item.id));
    setActiveSurface(item);
    hapticSurface();
    // Use AI-generated natural script instead of raw content
    let script: string;
    try {
      script = await generateSurfaceScript({
        type: item.type,
        content: item.content,
        createdAt: new Date(item.surface_at ?? Date.now()),
        context: item.context ?? undefined,
      });
    } catch {
      script = `${item.content} Over.`;
    }
    setPttState('speaking');
    setIsSpeaking(true);
    speakResponse(script)
      .catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); })
      .finally(() => { setIsSpeaking(false); setPttState('awaiting_answer'); });
  }, [rogerMode, surfaceItems, pttState]);

  // Idle timer — reset on user activity
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(triggerSurface, 45_000);
  }, [triggerSurface]);

  useEffect(() => { resetIdleTimer(); return () => { if (idleTimerRef.current) clearTimeout(idleTimerRef.current); }; }, [resetIdleTimer]);

  // ── 30-minute proactive check-in loop ────────────────────────────────────
  const proactiveCheckInRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    proactiveCheckInRef.current = setInterval(async () => {
      if (pttState !== 'idle') return;
      try {
        const [reminders, tasks] = await Promise.all([
          fetchReminders(userId, 'pending').catch(() => []),
          fetchTasks(userId, 'open').catch(() => []),
        ]);
        const total = reminders.length + tasks.length;
        if (total === 0) return;
        triggerIdleCheckin(total);
      } catch { /* silent */ }
    }, 30 * 60 * 1000);
    return () => { if (proactiveCheckInRef.current) clearInterval(proactiveCheckInRef.current); };
  }, [userId, pttState]);

  // ── Confirmation gate handlers ───────────────────────────────────────────────
  const confirmPendingAction = useCallback(() => {
    if (!pendingAction) return;
    pendingAction.execute();
    const ack = pendingAction.type === 'reminder' ? 'Reminder set. Over.'
      : pendingAction.type === 'meeting' ? 'Meeting booked. Over.'
      : 'Task saved. Over.';
    speakResponse(ack).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
    setPendingAction(null);
    window.dispatchEvent(new CustomEvent('roger:refresh'));
  }, [pendingAction]);

  const cancelPendingAction = useCallback(() => {
    if (!pendingAction) return;
    const ack = 'Cancelled. Standing by. Over.';
    speakResponse(ack).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
    setPendingAction(null);
  }, [pendingAction]);

  // Speak confirmation gate prompt whenever pendingAction is set
  useEffect(() => {
    if (!pendingAction) return;
    speakResponse(pendingAction.label).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
  }, [pendingAction]);

  // Preload SFX buffers once on mount
  useEffect(() => { preloadAll(); }, []);

  // ── Proactive Engine init ─────────────────────────────────────────────────
  const [proactivePending, setProactivePending] = useState<PendingMessage | null>(null);
  useEffect(() => {
    initProactive({
      onSpeak: (msg) => setProactivePending(msg),
      onClear: ()    => setProactivePending(null),
    });
  }, []);

  // Sync proactive mode with drive speed + talkative mode
  useEffect(() => {
    const speed = (locationProp ?? hookLocation)?.speed ?? 0;
    if (speed >= 5.56) {
      setProactiveMode('drive');
    } else if (talkativeEnabled) {
      setProactiveMode('talkative');
    } else {
      setProactiveMode('normal');
    }
  }, [(locationProp ?? hookLocation)?.speed, talkativeEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Talkative mode: fetch prefs & listen for push thinking messages ────
  useEffect(() => {
    // Fetch talkative preferences
    (async () => {
      try {
        const { data } = await supabase
          .from('user_preferences')
          .select('roger_mode, talkative_enabled, talkative_frequency, talkative_delivery')
          .eq('user_id', userId)
          .maybeSingle();
        if (data) {
          const d = data as Record<string, unknown>;
          if (d.roger_mode === 'quiet' || d.roger_mode === 'active' || d.roger_mode === 'briefing') {
            setRogerMode(d.roger_mode);
          }
          setTalkativeEnabled(!!d.talkative_enabled);
          if (d.talkative_frequency === 'thoughtful' || d.talkative_frequency === 'active_talk' || d.talkative_frequency === 'always_on') {
            setTalkativeFreq(d.talkative_frequency);
          }
          if (d.talkative_delivery === 'auto_speak' || d.talkative_delivery === 'ptt_pulse') {
            setTalkativeDelivery(d.talkative_delivery);
          }
        }
      } catch { /* silent */ }
    })();

    // Listen for push notification messages relayed from service worker
    const handleThinkingMessage = (event: MessageEvent) => {
      if (event.data?.type === 'thinking') {
        const { thought, delivery } = event.data;
        if (delivery === 'auto_speak') {
          // Auto-speak: just speak immediately
          triggerThinkingMessage(thought);
        } else {
          // PTT Pulse: show pulsating red + queue message
          setThinkingPulse(true);
          triggerThinkingMessage(thought);
        }
      }
    };
    navigator.serviceWorker?.addEventListener('message', handleThinkingMessage);

    return () => {
      navigator.serviceWorker?.removeEventListener('message', handleThinkingMessage);
    };
  }, [userId]);

  // ── Replay last Roger message ─────────────────────────────────────────────
  const replayLastMessage = useCallback(() => {
    const msg = lastRogerMsgRef.current;
    if (!msg) return;
    hapticPTTDown();
    setPttState('speaking');
    setIsSpeaking(true);
    speakResponse(msg)
      .catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); })
      .finally(() => { setIsSpeaking(false); setPttState('responded'); });
  }, []);

  // ── PTT Down ──────────────────────────────────────────────────────────────
  const handlePTTDown = useCallback(async (e?: React.PointerEvent) => {
    resetIdleTimer();

    // Capture the pointer so pointerleave doesn't fire while holding on desktop
    if (e) { try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ } }

    // ── Proactive intercept: if Roger has a pending message, consume PTT ────
    if (handleProactivePTT()) {
      setThinkingPulse(false);  // clear red pulse if thinking was consumed
      return;
    }

    // ── While speaking: stop Roger, do NOT start recording yet ──────────────
    if (pttState === 'speaking') {
      pttWasSpeakingRef.current = true;
      stopSpeaking(); setIsSpeaking(false);
      setPttState('responded');
      // Start hold timer so we can detect long-press vs short tap on PTT Up
      setHoldMs(0);
      holdRef.current = setInterval(() => setHoldMs(h => h + 100), 100);
      return;
    }

    pttWasSpeakingRef.current = false;
    if (pttState !== 'idle' && pttState !== 'responded' && pttState !== 'awaiting_answer') return;
    if (awaitRef.current) clearTimeout(awaitRef.current);
    stopSpeaking(); setIsSpeaking(false);

    // Keep AudioContext alive on PC browsers — must run inside a user gesture
    unlockAudio().catch(() => {});

    hapticPTTDown();
    sfxPTTDown();
    setPttState('recording'); setHoldMs(0);
    pttStartRef.current = Date.now();
    holdRef.current = setInterval(() => setHoldMs(h => h + 100), 100);

    if (MEDIA_RECORDER_SUPPORTED) {
      const recorder = await createAudioRecorder();
      (recorderRef as React.MutableRefObject<typeof recorder | null>).current = recorder;
      const granted = await recorder.start();
      if (!granted) { (recorderRef as React.MutableRefObject<typeof recorder | null>).current = null; }
    }
  }, [pttState, resetIdleTimer]);

  // ── Chip prompt processor — fires when a quick-action chip sets pttState='processing' ──
  // This is the fix for the silent chip bug: chips previously set state but never
  // called processTransmission, so nothing happened after the chip was tapped.
  useEffect(() => {
    if (pttState !== 'processing' || !chipPromptRef.current) return;
    const prompt = chipPromptRef.current;
    chipPromptRef.current = null;

    (async () => {
      try {
        setPttState('processing');
        const ddCtx = deepDiveRef.current;
        const chipTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('AI_TIMEOUT')), 45_000)
        );
        const result = await Promise.race([
          processTransmission(prompt, history, userId, undefined, undefined, null,
            ddCtx ? { topic: ddCtx.topic, depth: ddCtx.depth, coverageSummary: ddCtx.coverageSummary } : null
          ),
          chipTimeout,
        ]);
        setHistory(prev => [...prev, { role: 'assistant', content: result.roger_response }]);
        const isKnowledge = result.is_knowledge_query ?? false;
        const currentDepth = ddCtx?.depth ?? 0;
        // Track deep dive state for knowledge responses
        if (isKnowledge && !ddCtx) {
          // First knowledge response — initialize state from topic entity
          const topicEntity = result.entities?.find(e => e.type === 'TOPIC');
          setDeepDiveState({
            topic: topicEntity?.text || prompt.slice(0, 60),
            depth: 0,
            coverageSummary: result.roger_response.slice(0, 200),
            turns: [result.roger_response],
          });
        } else if (isKnowledge && ddCtx) {
          // Existing deep dive — accumulate
          setDeepDiveState(prev => prev ? {
            ...prev,
            coverageSummary: prev.coverageSummary + '\n' + result.roger_response.slice(0, 200),
            turns: [...prev.turns, result.roger_response],
          } : null);
        } else if (!isKnowledge) {
          // Non-knowledge intent breaks the deep dive
          setDeepDiveState(null);
        }
        setMessages(prev => [...prev, {
          id: `r-chip-${Date.now()}`, role: 'roger',
          text: result.roger_response,
          ts: Date.now(), intent: result.intent, outcome: result.outcome,
          isKnowledge,
          subtopics: result.subtopics ?? undefined,
          deepDiveDepth: isKnowledge ? currentDepth : undefined,
        }]);
        hapticRogerSpeaking();
        sfxRogerIn();
        lastRogerMsgRef.current = result.roger_response;
        setPttState('speaking'); setIsSpeaking(true);
        try { await speakResponse(result.roger_response); }
        catch { try { window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(result.roger_response); window.speechSynthesis.speak(u); await new Promise<void>(res => { u.onend = () => res(); }); } catch { /* silent */ } }
        setIsSpeaking(false);
        sfxRogerOut();
        setPttState('responded');
        void supabase.rpc('increment_ptt_usage', { p_user_id: userId });
        extractMemoryFacts(prompt, result.roger_response, userId).catch(() => {});
        window.dispatchEvent(new CustomEvent('roger:refresh'));
      } catch {
        setPttState('idle');
      }
    })();
  }, [pttState]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── PTT Up ────────────────────────────────────────────────────────────────
  const handlePTTUp = useCallback(async () => {
    if (holdRef.current) clearInterval(holdRef.current);

    // ── Short tap that interrupted speaking → handle stop / double-tap replay ──
    if (pttWasSpeakingRef.current) {
      pttWasSpeakingRef.current = false;
      const elapsed = Date.now() - pttStartRef.current;
      if (elapsed >= 300) {
        // Long press while speaking → stop + start recording
        resetIdleTimer();
        hapticPTTDown(); sfxPTTDown();
        setPttState('recording'); setHoldMs(0);
        pttStartRef.current = Date.now();
        holdRef.current = setInterval(() => setHoldMs(h => h + 100), 100);
        if (MEDIA_RECORDER_SUPPORTED) {
          const recorder = await createAudioRecorder();
          (recorderRef as React.MutableRefObject<typeof recorder | null>).current = recorder;
          const granted = await recorder.start();
          if (!granted) { (recorderRef as React.MutableRefObject<typeof recorder | null>).current = null; }
        }
        return;
      }
      // Short tap while speaking → Roger already stopped in PTT Down
      // Check for multi-tap gestures
      const now = Date.now();
      if (now - lastTapTimeRef.current < 400) {
        tapCountRef.current += 1;
        if (tapCountRef.current >= 3 && pendingAction) {
          // Triple-tap: confirm and execute pending action
          tapCountRef.current = 0; lastTapTimeRef.current = 0;
          confirmPendingAction();
        } else if (tapCountRef.current >= 2 && !pendingAction) {
          tapCountRef.current = 0; lastTapTimeRef.current = 0;
          replayLastMessage();
        } else {
          lastTapTimeRef.current = now;
        }
      } else {
        tapCountRef.current = 1;
        lastTapTimeRef.current = now;
      }
      return;
    }

    if (pttState !== 'recording') {
      // Use timestamp ref for hold duration — immune to stale-closure issues
      const idleElapsed = Date.now() - pttStartRef.current;
      if (idleElapsed < 300) {
        const now = Date.now();
        if (now - lastTapTimeRef.current < 400) {
          tapCountRef.current += 1;
          if (tapCountRef.current >= 3 && pendingAction) {
            tapCountRef.current = 0; lastTapTimeRef.current = 0;
            confirmPendingAction();
          } else if (tapCountRef.current >= 2 && !pendingAction && lastRogerMsgRef.current) {
            tapCountRef.current = 0; lastTapTimeRef.current = 0;
            replayLastMessage();
          } else {
            lastTapTimeRef.current = now;
          }
        } else {
          tapCountRef.current = 1;
          lastTapTimeRef.current = now;
        }
      }
      return;
    }

    resetIdleTimer();
    hapticPTTUp();
    sfxPTTUp();

    // Use timestamp ref for hold duration — immune to stale-closure issues
    const recordElapsed = Date.now() - pttStartRef.current;
    if (recordElapsed < 300) {
      hapticError();
      sfxError();
      setPttState('idle');
      const m = 'Too brief. Hold and speak clearly. Over.';
      speakResponse(m).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
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
      const { transcript: t } = await transcribeAudio(blob, whisperHintRef.current || undefined);
      transcript = t;
      const clean = transcript.replace(/[^a-zA-Z\u0600-\u06FF]/g, '');
      if (!clean || clean.length < 3) {
        const m = 'Nothing received. Say your command. Over.';
        await speakResponse(m).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
        setPttState('idle');
        return;
      }
    } catch {
      const m = 'Voice processing offline. Type below. Over.';
      speakResponse(m).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
      setPttState('idle');
      return;
    }

    // User message
    setMessages(prev => [...prev, { id: `u-${Date.now()}`, role: 'user', text: transcript, ts: Date.now() }]);

    // ── Verbal confirmation gate: intercept yes/no before GPT processing ────
    if (pendingAction) {
      const norm = transcript.toLowerCase().trim();
      // AI-powered confirmation gate: classify intent with context about pending action
      // Falls back to regex if AI call fails (latency-sensitive path)
      let decision: 'confirm' | 'cancel' | 'new_command' = 'new_command';

      // Quick regex check first (instant path for clear single-word responses)
      const CONFIRM_WORDS = /^(yes|yeah|yep|yup|confirm|do it|go ahead|go|execute|approved|affirmative|roger|proceed|ok|okay|sure|absolutely|correct|right)$/i;
      const CANCEL_WORDS  = /^(no|nah|nope|cancel|stop|don't|abort|negative|nevermind|never mind|scratch that|forget it|disregard)$/i;
      const cleanNorm = norm.replace(/[.,!?]/g, '');

      if (CONFIRM_WORDS.test(norm) || CONFIRM_WORDS.test(cleanNorm)) {
        decision = 'confirm';
      } else if (CANCEL_WORDS.test(norm) || CANCEL_WORDS.test(cleanNorm)) {
        decision = 'cancel';
      } else {
        // Ambiguous phrasing — use AI to understand (e.g. "yeah go for it", "nah scratch that idea")
        try {
          const confirmResult = await processTransmission(
            transcript, [],
            `Roger asked: "${pendingAction.label}". The user is responding to confirm or cancel this action. Classify their response.`,
            userId
          );
          if (confirmResult.intent.includes('CONFIRM') || confirmResult.outcome === 'success') {
            decision = 'confirm';
          } else if (confirmResult.intent.includes('CANCEL') || confirmResult.intent.includes('DECLINE')) {
            decision = 'cancel';
          }
        } catch {
          // AI failed — default to treating as new command (cancel pending + process normally)
        }
      }

      if (decision === 'confirm') {
        confirmPendingAction();
        setPttState('responded');
        return;
      }
      if (decision === 'cancel') {
        cancelPendingAction();
        setPttState('idle');
        return;
      }
      // User said something else entirely — cancel the pending action
      // and process the new command normally (they changed their mind)
      cancelPendingAction();
    }

    setPttState('processing');

    try {
    // ── SESSION MODE: In active Tune In session — relay PTT to partner ──────
    if (activeTuneInSession) {
      const sess = activeTuneInSession;
      const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL as string;
      const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

      // AI-powered flag detection: run a quick classification to detect
      // flag/note/mark intents instead of brittle regex matching
      let isFlagged = false;
      try {
        const flagCheck = await processTransmission(transcript, [], undefined, userId);
        isFlagged = flagCheck.intent === 'TUNE_IN_FLAG';
      } catch { /* silent — default to not flagged */ }

      supabase.auth.getSession().then(async ({ data: { session } }) => {
        const token = session?.access_token ?? SUPABASE_ANON_KEY;
        await fetch(`${SUPABASE_URL}/functions/v1/relay-session-turn`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ sessionId: sess.sessionId, transcript, isFlagged }),
        });
      }).catch(() => {});

      // Show transcript in message log
      setMessages(prev => [...prev, { id: `r-${Date.now()}`, role: 'roger', text: `📡 You → ${sess.withName}: ${transcript}${isFlagged ? ' ⭐' : ''}`, ts: Date.now() }]);
      setPttState('responded');
      const ack = isFlagged ? 'Flagged and relayed. Over.' : 'Relayed. Over.';
      speakResponse(ack).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
      return;
    }

    // Build location context string for GPT-5.5 injection
      const locationContext = location
        ? `${location.city ? `${location.city}, ` : ''}${location.country ?? ''} (${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)})`.trim()
        : undefined;

      // ── L1: Check for pending clarification context ────────────────────────
      let activeClariCtx = pendingClarification;
      if (activeClariCtx && isClarificationExpired(activeClariCtx)) {
        // Context expired — treat as fresh transmission
        activeClariCtx = null;
        setPendingClarification(null);
        setIntentOptions(null);
      }
      if (activeClariCtx && isClarificationExhausted(activeClariCtx)) {
        // Max retries exceeded — abandon
        const abandonMsg = 'Transmission unclear. Let\'s start over. What do you need? Over.';
        setMessages(prev => [...prev, { id: `r-abandon-${Date.now()}`, role: 'roger', text: abandonMsg, ts: Date.now(), intent: 'ABANDON_CLARIFICATION', outcome: 'error' }]);
        speakResponse(abandonMsg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
        setPendingClarification(null);
        setIntentOptions(null);
        setClarifQuestion('');
        setPttState('responded');
        return;
      }

      // Inject live service health into GPT-5.5 system prompt
      const serviceContext = silentNodeRef.current.getServiceContext();

      // Race against a 45s timeout so the user never gets stuck on "Processing..."
      const aiTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('AI_TIMEOUT')), 45_000)
      );
      const result = await Promise.race([
        processTransmission(
          transcript, history, undefined, userId, locationContext,
          activeClariCtx ? {
            original_transcript: activeClariCtx.original_transcript,
            original_intent: activeClariCtx.original_intent,
            clarification_question: activeClariCtx.clarification_question,
            missing_entities: activeClariCtx.missing_entities,
            attempt: activeClariCtx.attempt,
          } : null,
          null, // deepDiveContext (passed separately below if active)
          serviceContext
        ),
        aiTimeout,
      ]);

      // Append history
      setHistory(prev => [...prev.slice(-10),
        { role: 'user', content: transcript },
        { role: 'assistant', content: result.roger_response },
      ]);

      // Persist turns to conversation_history (fire-and-forget)
      const isTest = false;
      insertConversationTurn({ user_id: userId, session_id: sessionId, role: 'user', content: transcript, intent: null, is_admin_test: isTest }).catch(() => {});

      // ── Memory quality gate — skip noisy/incomplete transmissions ──────────
      const meaningfulWords = transcript.replace(/[^a-zA-Z\u0600-\u06FF\s]/g, '').trim().split(/\s+/).filter(w => w.length > 1);
      const isQualityTx = meaningfulWords.length >= 4;

      // ── Silent AI Node: try registry dispatch first ─────────────────────────
      const silentNodeHandled = await (async () => {
        try {
          const prefs = await import('../../lib/api').then(m => m.fetchUserPreferences(userId)).catch(() => null);
          const ctx = buildIntentContext({
            result, transcript, userId, sessionId,
            location: location ? { latitude: location.latitude, longitude: location.longitude } : null,
            preferences: prefs as Record<string, unknown> | null,
            isTest: false,
            tuneIn: {
              incomingRequest: incomingTuneInRequest,
              activeSession: activeTuneInSession,
            },
            ambient: {
              active: ambientActive,
              lastChunk: ambientLastChunk,
              sessionRef: ambientSessionRef,
            },
            meeting: {
              active: meetingActive,
              recorderRef: meetingRecorderRef,
            },
          });
          return await silentNodeRef.current.dispatch(result, ctx);
        } catch (err) {
          console.warn('[SilentNode] Dispatch failed, falling back to legacy:', err);
          return false;
        }
      })();

      // Save to DB based on intent (legacy — skipped if SilentNode handled it)
      if (!silentNodeHandled && result.intent === 'CREATE_REMINDER') {
        // ── Confirmation gate for reminders ────────────────────────────────
        const locEntity = result.entities?.find(e => e.type === 'LOCATION' || e.type === 'PLACE');
        const timeEntity = result.entities?.find(e => e.type === 'TIME' || e.type === 'DATE' || e.type === 'MEETING_TIME');
        const confirmLabel = `Set reminder: "${transcript.slice(0, 60)}"${timeEntity ? ` at ${timeEntity.text}` : ''}${locEntity ? ` near ${locEntity.text}` : ''}. Confirm? Over.`;
        setPendingAction({
          type: 'reminder',
          label: confirmLabel,
          execute: () => {
            insertReminder({
              user_id: userId, text: transcript, entities: result.entities ?? null,
              due_at: null, status: 'pending', source_tx_id: null, is_admin_test: isTest,
              due_location:     locEntity?.text ?? null,
              due_location_lat: null,
              due_location_lng: null,
              due_radius_m:     300,
              geo_triggered:    false,
            }).then(() => window.dispatchEvent(new CustomEvent('roger:refresh'))).catch(() => {});
            if (locEntity) {
              geocodePlace(locEntity.text, location?.latitude, location?.longitude).then(coords => {
                if (coords) supabase.from('reminders').update({ due_location: locEntity.text, due_location_lat: coords.lat, due_location_lng: coords.lng }).eq('user_id', userId).eq('status', 'pending').order('created_at', { ascending: false }).limit(1);
              }).catch(() => {});
            }
          },
        });
      } else if (result.intent === 'SMART_HOME_CONTROL') {
        // ── Smart Home: confirmation gate before device control ──────────
        const deviceEntity = result.entities?.find(e => e.type === 'SMART_DEVICE');
        const valueEntity  = result.entities?.find(e => e.type === 'DEVICE_VALUE');
        const deviceLabel  = deviceEntity?.text ?? 'device';
        const confirmLabel = `Smart home: ${result.roger_response.replace(/ Over\.$/, '')}. Execute? Over.`;
        setPendingAction({
          type: 'task' as const,
          label: confirmLabel,
          execute: () => {
            import('../../lib/tuya').then(async ({ listTuyaDevices, matchDevice, inferCommand, controlDevice }) => {
              try {
                const prefs = await import('../../lib/api').then(m => m.fetchUserPreferences(userId));
                const uid = (prefs as Record<string, unknown> | null)?.tuya_uid as string | undefined;
                if (!uid) { speakResponse('Tuya not connected. Set up in Settings. Over.').catch(() => {}); return; }
                const devices = await listTuyaDevices(uid);
                const matched = matchDevice(deviceLabel, devices);
                if (!matched) { speakResponse(`Could not find "${deviceLabel}" in your devices. Over.`).catch(() => {}); return; }
                const actionEnt = result.entities?.find(e => e.type === 'DEVICE_ACTION');
                const cmd = inferCommand(result.intent, matched.category, valueEntity ? (isNaN(Number(valueEntity.text)) ? valueEntity.text : Number(valueEntity.text)) : undefined, actionEnt?.text);
                if (!cmd) { speakResponse('Unable to determine command. Over.').catch(() => {}); return; }
                await controlDevice(matched.id, [cmd]);
                const ack = `Done. ${matched.name} ${cmd.value === true ? 'on' : cmd.value === false ? 'off' : 'updated'}. Over.`;
                speakResponse(ack).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
              } catch (err) {
                const msg = `Smart home error: ${err instanceof Error ? err.message : 'unknown'}. Over.`;
                speakResponse(msg).catch(() => {});
              }
            });
          },
        });
      } else if (result.intent === 'SMART_HOME_SCENE') {
        // ── Smart Home: confirmation gate before scene trigger ──────────
        const sceneEntity = result.entities?.find(e => e.type === 'SCENE_NAME');
        const sceneName   = sceneEntity?.text ?? 'scene';
        const confirmLabel = `Run scene "${sceneName}"? Over.`;
        setPendingAction({
          type: 'task' as const,
          label: confirmLabel,
          execute: () => {
            import('../../lib/tuya').then(async ({ listTuyaDevices, listTuyaScenes, matchScene, triggerTuyaScene }) => {
              try {
                const prefs = await import('../../lib/api').then(m => m.fetchUserPreferences(userId));
                const uid = (prefs as Record<string, unknown> | null)?.tuya_uid as string | undefined;
                if (!uid) { speakResponse('Tuya not connected. Set up in Settings. Over.').catch(() => {}); return; }
                const devices = await listTuyaDevices(uid);
                if (devices.length === 0) { speakResponse('No homes found. Over.').catch(() => {}); return; }
                const homeId = String(devices[0].home_id);
                const scenes = await listTuyaScenes(homeId);
                const matched = matchScene(sceneName, scenes);
                if (!matched) { speakResponse(`Could not find scene "${sceneName}". Over.`).catch(() => {}); return; }
                await triggerTuyaScene(homeId, matched.scene_id);
                const ack = `Scene "${matched.name}" triggered. Over.`;
                speakResponse(ack).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
              } catch (err) {
                const msg = `Scene error: ${err instanceof Error ? err.message : 'unknown'}. Over.`;
                speakResponse(msg).catch(() => {});
              }
            });
          },
        });
      } else if (result.intent === 'SMART_HOME_QUERY') {
        // ── Smart Home query: read-only, no confirmation needed ──────────
        const deviceEntity = result.entities?.find(e => e.type === 'SMART_DEVICE');
        if (deviceEntity) {
          import('../../lib/tuya').then(async ({ listTuyaDevices, matchDevice, getDeviceStatus }) => {
            try {
              const prefs = await import('../../lib/api').then(m => m.fetchUserPreferences(userId));
              const uid = (prefs as Record<string, unknown> | null)?.tuya_uid as string | undefined;
              if (!uid) return;
              const devices = await listTuyaDevices(uid);
              const matched = matchDevice(deviceEntity.text, devices);
              if (!matched) return;
              const status = await getDeviceStatus(matched.id);
              // Roger's GPT response already includes a natural status line, so this is supplementary
              console.log('[SmartHome] Device status:', matched.name, status);
            } catch { /* silent — GPT response already covers the query */ }
          });
        }
      } else if (result.intent === 'BOOK_MEETING') {
        // BOOK_MEETING confirmation is handled inside the BOOK_MEETING block below — skip here
      } else if (result.intent === 'SEND_SMS' || result.intent === 'TEXT_MESSAGE') {
        // ── Voice-driven SMS: resolve contact + open native SMS composer ──────
        const personEntity = result.entities?.find(e => e.type === 'PERSON');
        const msgEntity    = result.entities?.find(e => e.type === 'MESSAGE_BODY' || e.type === 'MESSAGE');
        const contactName  = personEntity?.text ?? '';
        const msgBody      = msgEntity?.text ?? transcript;

        if (contactName) {
          import('../../lib/deviceContacts').then(async ({ fetchDeviceContacts, resolveContactByName, getPhoneNumber }) => {
            const contacts = await fetchDeviceContacts();
            const matches = resolveContactByName(contactName, contacts);
            if (matches.length > 0) {
              const phone = getPhoneNumber(matches[0]);
              if (phone) {
                const { openSmsComposer } = await import('../../lib/nativeIntents');
                const confirmLabel = `Text ${matches[0].displayName}: "${msgBody.slice(0, 50)}". Send? Over.`;
                setPendingAction({
                  type: 'sms',
                  label: confirmLabel,
                  execute: () => openSmsComposer(phone, msgBody),
                });
              } else {
                speakResponse(`Found ${matches[0].displayName} but no phone number on file. Over.`).catch(() => {});
              }
            } else {
              speakResponse(`I couldn't find ${contactName} in your contacts. Check the name and try again. Over.`).catch(() => {});
            }
          }).catch(() => {
            speakResponse('Contacts not connected. Enable in Settings to use voice messaging. Over.').catch(() => {});
          });
        }
      } else if (result.intent === 'PHONE_CALL' || result.intent === 'CALL_CONTACT') {
        // ── Voice-driven phone call: resolve contact + open native dialer ──────
        const personEntity = result.entities?.find(e => e.type === 'PERSON');
        const contactName  = personEntity?.text ?? '';

        if (contactName) {
          import('../../lib/deviceContacts').then(async ({ fetchDeviceContacts, resolveContactByName, getPhoneNumber }) => {
            const contacts = await fetchDeviceContacts();
            const matches = resolveContactByName(contactName, contacts);
            if (matches.length > 0) {
              const phone = getPhoneNumber(matches[0]);
              if (phone) {
                const { openPhoneDialer } = await import('../../lib/nativeIntents');
                const confirmLabel = `Call ${matches[0].displayName}? Over.`;
                setPendingAction({
                  type: 'task' as const,
                  label: confirmLabel,
                  execute: () => openPhoneDialer(phone),
                });
              } else {
                speakResponse(`Found ${matches[0].displayName} but no phone number. Over.`).catch(() => {});
              }
            } else {
              speakResponse(`I couldn't find ${contactName} in your contacts. Over.`).catch(() => {});
            }
          }).catch(() => {
            speakResponse('Contacts not connected. Enable in Settings. Over.').catch(() => {});
          });
        }
      } else if (result.intent === 'WHATSAPP_SEND' || result.intent === 'WHATSAPP_MESSAGE') {
        // ── Voice-driven WhatsApp: resolve contact + open WhatsApp ──────────
        const personEntity = result.entities?.find(e => e.type === 'PERSON');
        const msgEntity    = result.entities?.find(e => e.type === 'MESSAGE_BODY' || e.type === 'MESSAGE');
        const contactName  = personEntity?.text ?? '';
        const msgBody      = msgEntity?.text ?? transcript;

        if (contactName) {
          import('../../lib/deviceContacts').then(async ({ fetchDeviceContacts, resolveContactByName, getPhoneNumber }) => {
            const contacts = await fetchDeviceContacts();
            const matches = resolveContactByName(contactName, contacts);
            if (matches.length > 0) {
              const phone = getPhoneNumber(matches[0]);
              if (phone) {
                const { openWhatsApp } = await import('../../lib/nativeIntents');
                const confirmLabel = `WhatsApp ${matches[0].displayName}: "${msgBody.slice(0, 50)}". Send? Over.`;
                setPendingAction({
                  type: 'sms',
                  label: confirmLabel,
                  execute: () => openWhatsApp(phone, msgBody),
                });
              } else {
                speakResponse(`Found ${matches[0].displayName} but no phone number for WhatsApp. Over.`).catch(() => {});
              }
            } else {
              speakResponse(`I couldn't find ${contactName} in your contacts. Over.`).catch(() => {});
            }
          }).catch(() => {
            speakResponse('Contacts not connected. Enable in Settings for WhatsApp. Over.').catch(() => {});
          });
        }
      } else if (!result.intent.startsWith('QUERY_') &&
                 !result.intent.startsWith('STATUS_') &&
                 !result.intent.startsWith('EXPLAIN_') &&
                 !result.intent.startsWith('MARKET_') &&
                 !result.intent.startsWith('RESEARCH_') &&
                 !result.intent.startsWith('BRIEFING_') &&
                 !result.intent.startsWith('WATCHLIST_') &&
                 !result.intent.startsWith('IDENTIFY_') &&
                 !result.intent.startsWith('SMART_HOME_') &&
                 !result.intent.endsWith('_QUERY') &&
                 result.intent !== 'CONVERSE' &&
                 result.intent !== 'COMMUTE_QUERY' &&
                 result.intent !== 'SEND_SMS' &&
                 result.intent !== 'TEXT_MESSAGE' &&
                 result.intent !== 'PHONE_CALL' &&
                 result.intent !== 'CALL_CONTACT' &&
                 result.intent !== 'WHATSAPP_SEND' &&
                 result.intent !== 'WHATSAPP_MESSAGE' &&
                 isQualityTx) {
        // Save action intents as tasks (with quality gate)
        const taskLabel = `Task: "${transcript.slice(0, 60)}". Confirm? Over.`;
        setPendingAction({
          type: 'task',
          label: taskLabel,
          execute: () => {
            insertTask({ user_id: userId, text: transcript, priority: 5, status: 'open', due_at: null, source_tx_id: null, is_admin_test: isTest, execution_tier: 'confirm', dedup_group: null, resolved_by: null, resolved_at: null })
              .then(() => window.dispatchEvent(new CustomEvent('roger:refresh'))).catch(() => {});
          },
        });
      } else if ((result.intent === 'MEMORY_CAPTURE' || result.intent === 'BOOK_UPDATE') && isQualityTx) {
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
      } // end legacy if/else chain

      // ── Academy: auto-save vocab words + record session ─────────────────────
      if (result.intent?.startsWith('ACADEMY_')) {
        import('../../lib/api').then(({ recordAcademySession, upsertVocabWord, upsertAcademyStreak, fetchAcademyStreak }) => {
          recordAcademySession(userId).then(({ milestone, frozeUsed }) => {
            if (milestone) {
              const celebrations: Record<number, string> = {
                7: '🔥 7-day streak! You earned a Streak Freeze. Keep it up, Commander!',
                14: '⭐ 14 days strong! Your dedication is showing. Over.',
                30: '🏆 30-day streak! One full month. You\'re unstoppable. Over.',
                60: '💎 60 days! Two months of consistent learning. Impressive. Over.',
                100: '🎖️ 100-day streak! Triple digits. You\'re in the elite tier now. Over.',
                365: '👑 365 days! One full year. Legendary status achieved. Over.',
              };
              const msg = celebrations[milestone] ?? `🎯 ${milestone}-day streak milestone! Over.`;
              hapticMilestone();
              // Show badge overlay
              const badge = MILESTONE_BADGES[milestone] ?? { icon: 'badge-fallback', title: `${milestone}-Day Streak`, subtitle: 'Keep the momentum going', color: '#d4a044', glow: 'rgba(212,160,68,0.3)' };
              showBadge(badge);
              import('../../lib/tts').then(({ speakResponse }) => speakResponse(msg).catch(() => {}));
            }
            if (frozeUsed) {
              showBadge(FREEZE_BADGE);
              import('../../lib/tts').then(({ speakResponse }) =>
                speakResponse('❄️ Streak Freeze activated — your streak is safe. Over.').catch(() => {})
              );
            }
          }).catch(() => {});

          // ACADEMY_START: auto-set target language from voice ("I want to learn French")
          if (result.intent === 'ACADEMY_START') {
            const langEntity = result.entities?.find(e => e.type === 'LANGUAGE' || e.type === 'TARGET_LANGUAGE');
            if (langEntity) {
              // Fuzzy-match against available locales
              import('../../lib/i18n').then(({ ALL_LOCALES: locales, getLocaleName: getName }) => {
                const spoken = langEntity.text.toLowerCase().trim();
                const matched = locales.find(l => getName(l).toLowerCase().includes(spoken) || l.toLowerCase().startsWith(spoken.slice(0, 2)));
                if (matched) {
                  upsertAcademyStreak(userId, { target_locale: matched }).catch(() => {});
                  window.dispatchEvent(new CustomEvent('roger:refresh'));
                }
              }).catch(() => {});
            }
          }

          // If vocab mode returned a word, save it
          if (result.academy_word) {
            fetchAcademyStreak(userId).then(streak => {
              const locale = streak?.target_locale ?? 'fr-fr';
              upsertVocabWord(userId, result.academy_word!.word, result.academy_word!.translation, locale, 1).catch(() => {});
            }).catch(() => {});
          }

          // ── Drill answer: update mastery level based on correctness ──
          if (result.academy_drill_result && result.academy_drill_word) {
            fetchAcademyStreak(userId).then(async streak => {
              const locale = streak?.target_locale ?? 'fr-fr';
              const { fetchVocabWords } = await import('../../lib/api');
              const words = await fetchVocabWords(userId, locale);
              const existing = words.find(w => w.word.toLowerCase() === result.academy_drill_word!.toLowerCase());
              const currentMastery = existing?.mastery ?? 0;

              let newMastery = currentMastery;
              if (result.academy_drill_result === 'correct') newMastery = Math.min(5, currentMastery + 1);
              else if (result.academy_drill_result === 'wrong') newMastery = Math.max(0, currentMastery - 1);
              // 'close' keeps same mastery

              const translation = result.academy_word?.translation ?? existing?.translation ?? '';
              upsertVocabWord(userId, result.academy_drill_word!, translation, locale, newMastery).catch(() => {});
            }).catch(() => {});
          }
        }).catch(() => {});
      }

      // ── Translation: auto-save translated words as vocab ────────────────────
      if ((result.intent === 'TRANSLATE_TEXT' || result.intent === 'TRANSLATE_LAST') && result.translation_target && result.translation_source) {
        import('../../lib/api').then(({ upsertVocabWord, fetchAcademyStreak }) => {
          fetchAcademyStreak(userId).then(streak => {
            const locale = result.translation_target_lang ? `${result.translation_target_lang}-${result.translation_target_lang}` : (streak?.target_locale ?? 'fr-fr');
            upsertVocabWord(userId, result.translation_target!, result.translation_source!, locale, 0).catch(() => {});
          }).catch(() => {});
        }).catch(() => {});
      }

      // Persist Roger's turn
      insertConversationTurn({ user_id: userId, session_id: sessionId, role: 'assistant', content: result.roger_response, intent: result.intent, is_admin_test: isTest }).catch(() => {});

      // Increment daily PTT usage counter (enforces Free-tier 50/day limit)
      void supabase.rpc('increment_ptt_usage', { p_user_id: userId });

      // ── Auto-create proposed tasks WITH dedup + tier classification ──
      if (result.proposed_tasks?.length) {
        result.proposed_tasks.forEach(pt => {
          insertTaskWithDedup({
            user_id: userId, text: pt.text,
            priority: pt.priority ?? 5, status: 'open',
            due_at: null, source_tx_id: null, is_admin_test: isTest,
            execution_tier: pt.execution_tier ?? 'manual',
          }).then(({ merged }) => {
            if (merged) console.log(`[TaskEngine] Merged duplicate: "${pt.text.slice(0, 40)}..."`);
          }).catch(() => {});
        });
      }

      // ── Save every exchange as a memory capture (quality gate applied) ──────
      if (isQualityTx && result.intent !== 'CONVERSE') {
        insertMemory({
          user_id: userId,
          type: 'capture',
          text: `Q: ${transcript}\nA: ${result.roger_response.split('\n\n📋')[0]}`,
          entities: result.entities ?? null,
          tags: [result.intent, ...(result.proposed_tasks?.length ? ['HAS_PROPOSALS'] : [])],
          source_tx_id: sessionId,
          is_admin_test: isTest,
          location_label: location?.city ?? null,
          location_lat:   location?.latitude  ?? null,
          location_lng:   location?.longitude ?? null,
        }).catch(() => {});
      }

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
      // AI-powered: trust the LLM's intent classification instead of regex
      // fallback that caused false positives (e.g. "update my calendar" → news)
      const isNewsIntent = result.intent.startsWith('QUERY_NEWS') ||
        result.intent.startsWith('NEWS_') ||
        result.intent === 'BRIEFING_NEWS' ||
        result.intent.includes('NEWS');

      if (isNewsIntent) {
        try {
          // AI-powered: extract category and query from LLM entities
          const newsCatEnt   = result.entities?.find(e => e.type === 'NEWS_CATEGORY');
          const newsQueryEnt = result.entities?.find(e => e.type === 'NEWS_QUERY' || e.type === 'TOPIC');
          const brief = await fetchNews(transcript, newsCatEnt?.text, newsQueryEnt?.text);
          const newsText = brief.spokenBrief;
          setMessages(prev => [...prev, {
            id: `news-${Date.now()}`, role: 'roger' as const,
            text: newsText, ts: Date.now(),
            intent: result.intent, outcome: 'success',
            news: brief.articles,
          }]);
          hapticRogerSpeaking();
          sfxRogerIn();
          setPttState('speaking'); setIsSpeaking(true);
          try { await speakResponse(newsText); }
          catch { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(newsText)); }
          setIsSpeaking(false);
          sfxRogerOut();
          setPttState('responded');
          return;
        } catch {
          // Fall through to GPT-5.5 response if news fetch fails
        }
      }

      // COMMUTE_QUERY — Real Google Maps ETA
      if (result.intent === 'COMMUTE_QUERY' && location) {
        // Extract destination from GPT-5.5 entities (LOCATION type) or raw transcript
        const destEntity = result.entities?.find(e => e.type === 'LOCATION' || e.type === 'PLACE');
        const destination = destEntity?.text ?? transcript.replace(/how long|to get|to reach|commute|drive|to/gi, '').trim();
        if (destination) {
          getCommute(location.latitude, location.longitude, destination).then(commute => {
            if (commute) {
              const etaMsg = `${destination} is ${commute.duration} away by ${commute.mode} (${commute.distance}). Standing by. Over.`;
              setMessages(prev => [...prev, { id: `eta-${Date.now()}`, role: 'roger' as const, text: etaMsg, ts: Date.now(), type: 'response' as const }]);
              speakResponse(etaMsg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
            }
          }).catch(() => {});
        }
      }

      // ── DEPARTURE_SIGNAL — log departure + prep brief ─────────────────────
      if (result.intent === 'DEPARTURE_SIGNAL') {
        import('../../lib/api').then(async ({ fetchCommuteProfile, fetchErrands }) => {
          const [prof, errands] = await Promise.all([
            fetchCommuteProfile(userId).catch(() => null),
            fetchErrands(userId, 'pending').catch(() => []),
          ]);
          const parts: string[] = ['Departure logged.'];
          if (prof?.work_address) parts.push(`ETA to ${prof.work_address} calculating.`);
          if (errands.length > 0) parts.push(`${errands.length} errand${errands.length > 1 ? 's' : ''} on your list.`);
          parts.push('Have a safe drive. Over.');
          const brief = parts.join(' ');
          speakResponse(brief).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
        }).catch(() => {});
      }

      // ── PARK_REMEMBER — log parking spot ──────────────────────────────────
      if (result.intent === 'PARK_REMEMBER') {
        const spotEntity = result.entities?.find(e => e.type === 'PARKING_SPOT' || e.type === 'LOCATION');
        const label = (spotEntity?.text ?? transcript.replace(/parked|park|remember|i'm|at|on/gi, '').trim()) || 'Parking location';
        import('../../lib/api').then(({ logParking }) => {
          logParking(userId, label, {
            lat:  location?.latitude  ?? undefined,
            lng:  location?.longitude ?? undefined,
          }).catch(() => {});
        }).catch(() => {});
      }

      // ── PARK_RECALL — fetch and speak last parking spot ───────────────────
      if (result.intent === 'PARK_RECALL') {
        import('../../lib/api').then(async ({ fetchLatestParking }) => {
          const park = await fetchLatestParking(userId).catch(() => null);
          const msg = park
            ? `Your last logged parking: ${park.location_label}. Logged ${Math.floor((Date.now() - new Date(park.created_at).getTime()) / 60000)} minutes ago. Over.`
            : 'No parking location logged. To save it, say: I parked at Level B2. Over.';
          speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
        }).catch(() => {});
      }

      // ── ERRAND_ADD — insert errand item ───────────────────────────────────
      if (result.intent === 'ERRAND_ADD') {
        const item  = result.entities?.find(e => e.type === 'ERRAND_ITEM');
        const place = result.entities?.find(e => e.type === 'ERRAND_LOCATION');
        if (item?.text) {
          import('../../lib/api').then(({ insertErrand }) => {
            insertErrand({
              user_id: userId, item: item.text,
              location_hint: place?.text ?? null,
              location_lat: null, location_lng: null,
              radius_m: 300, status: 'pending', source_tx_id: null,
            }).catch(() => {});
          }).catch(() => {});
        }
      }

      // ── ROAD_BRIEF — speak a quick road summary ───────────────────────────
      if (result.intent === 'ROAD_BRIEF' && location) {
        import('../../lib/api').then(async ({ fetchCommuteProfile, fetchErrands, getCommute }) => {
          const [prof, errands] = await Promise.all([
            fetchCommuteProfile(userId).catch(() => null),
            fetchErrands(userId, 'pending').catch(() => []),
          ]);
          const parts: string[] = ['Road brief:'];
          if (prof?.work_address) {
            const eta = await getCommute(location.latitude, location.longitude, prof.work_address, prof.commute_mode ?? 'driving').catch(() => null);
            if (eta) parts.push(`${eta.duration} to ${prof.work_address}.`);
          }
          if (errands.length > 0) {
            const top = errands.slice(0, 2).map(e => e.item).join(', ');
            parts.push(`${errands.length} errands including: ${top}.`);
          }
          parts.push('Over.');
          const brief = parts.join(' ');
          speakResponse(brief).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
        }).catch(() => {});
      }

      // ── TUNE_IN_REQUEST — dial by code or by contact name ────────────────
      if (result.intent === 'TUNE_IN_REQUEST') {
        const callsignEnt = result.entities?.find(e => e.type === 'CALLSIGN');
        const nameEnt     = result.entities?.find(e => e.type === 'CONTACT_NAME');
        const SUPABASE_URL     = import.meta.env.VITE_SUPABASE_URL as string;
        const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

        const doTuneInRequest = async (targetCallsign: string, reason?: string) => {
          const { data: { session } } = await (await import('../../lib/supabase')).supabase.auth.getSession().catch(() => ({ data: { session: null } }));
          const token = session?.access_token ?? SUPABASE_ANON_KEY;
          const res = await fetch(`${SUPABASE_URL}/functions/v1/request-tune-in`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ targetCallsign, reason }),
          }).then(r => r.json()).catch(() => ({ ok: false, rogerResponse: 'Connection failed. Over.' }));
          const msg = res.rogerResponse ?? result.roger_response;
          speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
        };

        if (callsignEnt?.text) {
          doTuneInRequest(callsignEnt.text.toUpperCase(), nameEnt?.text).catch(() => {});
        } else if (nameEnt?.text) {
          // Resolve name → callsign from roger_contacts
          import('../../lib/supabase').then(async ({ supabase }) => {
            const { data: contact } = await supabase
              .from('roger_contacts')
              .select('callsign, display_name')
              .ilike('display_name', `%${nameEnt.text}%`)
              .eq('user_id', userId)
              .maybeSingle();
            if (contact?.callsign) {
              doTuneInRequest(contact.callsign, `Request from ${contact.display_name}`).catch(() => {});
            } else {
              const msg = `${nameEnt.text} doesn't have a callsign saved. Ask them to share their Roger code. Over.`;
              speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
            }
          }).catch(() => {});
        }
      }

      // ── TUNE_IN_ACCEPT — accept incoming request by voice ─────────────────
      if (result.intent === 'TUNE_IN_ACCEPT' && incomingTuneInRequest) {
        const req = incomingTuneInRequest;
        const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL as string;
        const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
        import('../../lib/supabase').then(async ({ supabase }) => {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token ?? SUPABASE_ANON_KEY;
          const res = await fetch(`${SUPABASE_URL}/functions/v1/accept-tune-in`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ requestId: req.requestId }),
          }).then(r => r.json()).catch(() => ({ ok: false }));
          if (res.ok) {
            setActiveTuneInSession({ sessionId: res.sessionId, withName: res.withName ?? req.from });
            setIncomingTuneInRequest(null);
            const msg = res.rogerResponse ?? result.roger_response;
            speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
          }
        }).catch(() => {});
      }

      // ── TUNE_IN_DECLINE ───────────────────────────────────────────────────
      if (result.intent === 'TUNE_IN_DECLINE' && incomingTuneInRequest) {
        const req = incomingTuneInRequest;
        const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL as string;
        const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
        import('../../lib/supabase').then(async ({ supabase }) => {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token ?? SUPABASE_ANON_KEY;
          await fetch(`${SUPABASE_URL}/functions/v1/decline-tune-in`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ requestId: req.requestId }),
          }).catch(() => {});
          setIncomingTuneInRequest(null);
        }).catch(() => {});
      }

      // ── TUNE_IN_END ───────────────────────────────────────────────────────
      if (result.intent === 'TUNE_IN_END' && activeTuneInSession) {
        const sess = activeTuneInSession;
        const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL as string;
        const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
        import('../../lib/supabase').then(async ({ supabase }) => {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token ?? SUPABASE_ANON_KEY;
          const res = await fetch(`${SUPABASE_URL}/functions/v1/end-tune-in`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ sessionId: (sess as { sessionId: string; withName: string }).sessionId }),
          }).then(r => r.json()).catch(() => ({ ok: false }));
          setActiveTuneInSession(null);
          const msg = res.rogerResponse ?? result.roger_response;
          speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
        }).catch(() => {});
      }

      // ── TUNE_IN_FLAG — mark current turn in session ───────────────────────
      if (result.intent === 'TUNE_IN_FLAG' && activeTuneInSession) {
        const sess = activeTuneInSession;
        const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL as string;
        const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
        import('../../lib/supabase').then(async ({ supabase }) => {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token ?? SUPABASE_ANON_KEY;
          await fetch(`${SUPABASE_URL}/functions/v1/relay-session-turn`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ sessionId: (sess as { sessionId: string; withName: string }).sessionId, transcript: `[FLAGGED] ${transcript}`, isFlagged: true }),
          }).catch(() => {});
        }).catch(() => {});
      }

      // ── SAVE_CONTACT — voice-save a stranger met via Tune In ─────────────────
      if (result.intent === 'SAVE_CONTACT' && pendingContactSave) {
        const nameEnt = result.entities?.find(e => e.type === 'CONTACT_NAME');
        const name = nameEnt?.text ?? transcript.replace(/save (as|contact|them as)?/i, '').trim();
        if (name) {
          Promise.resolve(
            supabase.from('user_callsigns').select('user_id').eq('callsign', pendingContactSave.callsign).maybeSingle()
          ).then(async ({ data: csRow }) => {
              if (csRow?.user_id) {
                await supabase.from('roger_contacts').upsert(
                  { user_id: userId, contact_id: csRow.user_id, display_name: name, callsign: pendingContactSave.callsign },
                  { onConflict: 'user_id,contact_id' }
                );
              }
              setPendingContactSave(null);
              setContactSaveInput('');
              const conf = `${name} saved. You can now say "tune in with ${name}" to reach them. Over.`;
              speakResponse(conf).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
            }).catch(() => {});

        }
      }

      // ── SESSION_QUERY — search + read back past session notes ──────────────
      if (result.intent === 'SESSION_QUERY') {
        const nameEnt  = result.entities?.find(e => e.type === 'CONTACT_NAME');
        const topicEnt = result.entities?.find(e => e.type === 'TOPIC');
        const keyword  = nameEnt?.text ?? topicEnt?.text ?? '';

        import('../../lib/api').then(async ({ searchSessions, fetchSessionArchive }) => {
          const results = keyword
            ? await searchSessions(userId, keyword)
            : await fetchSessionArchive(userId);

          if (results.length === 0) {
            const msg = `No sessions found${keyword ? ` mentioning ${keyword}` : ''}. Over.`;
            speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
            return;
          }

          const top = results[0];
          const who = top.contact_name ?? top.contact_callsign ?? 'Unknown';
          const when = new Date(top.session_start).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
          const dur = top.duration_min < 1 ? 'under a minute' : `${top.duration_min} minute${top.duration_min !== 1 ? 's' : ''}`;

          let msg = `Your most recent session with ${who} was ${when}, ${dur} long.`;
          if (top.roger_notes) {
            // Speak a trimmed version (first 180 chars)
            const notePreview = top.roger_notes.length > 180
              ? top.roger_notes.slice(0, 180).replace(/\s\S+$/, '') + '...'
              : top.roger_notes;
            msg += ` Roger's debrief: ${notePreview}`;
          }
          msg += ' Full transcript is in your Session Log. Over.';

          speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });

          // Surface a card pointing to the archive
          insertSurfaceItem({
            user_id: userId, type: 'SESSION_RECAP',
            content: `Session with ${who} (${when}) — tap to view full transcript & notes`,
            priority: 7, dismissed: false, snooze_count: 0,
            surface_at: new Date().toISOString(),
            context: top.id, source_tx_id: null,
          }).catch(() => {});
        }).catch(() => {});
      }

      // ── QUERY_STOCK — live stock quote ──────────────────────────────────────
      if (result.intent === 'QUERY_STOCK' || result.intent === 'MARKET_BRIEF') {
        const tickerEnt = result.entities?.find(e => e.type === 'STOCK_TICKER');
        // AI-powered: GPT-5.5 resolves any company name → ticker symbol
        // (replaces hard-coded 16-company detectTicker() regex dictionary)
        const ticker = tickerEnt?.text ?? null;

        if (result.intent === 'MARKET_BRIEF' || !ticker) {
          // Market overview
          fetchMarketContext(['AAPL', 'MSFT', 'NVDA', 'TSLA']).then(ctx => {
            const msg = ctx ? `Market brief: ${ctx}. Over.` : 'Market data unavailable at this time. Over.';
            speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
          }).catch(() => {});
        } else {
          fetchQuote(ticker).then(quote => {
            const msg = quote ? quoteToSpeech(quote) : `Could not retrieve ${ticker} data right now. Over.`;
            if (quote) {
              setMessages(prev => [...prev, {
                id: `stock-${Date.now()}`, role: 'roger' as const,
                text: `📈 ${quote.ticker} · $${quote.price} · ${quote.changePct >= 0 ? '▲' : '▼'}${Math.abs(quote.changePct).toFixed(2)}%`,
                ts: Date.now(), intent: result.intent, outcome: 'success',
              }]);
            }
            speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
          }).catch(() => {});
        }
      }

      // ── QUERY_FLIGHT — live flight status ────────────────────────────────────
      if (result.intent === 'QUERY_FLIGHT') {
        const flightEnt = result.entities?.find(e => e.type === 'FLIGHT_NUMBER');
        // AI-powered: GPT-5.5 resolves any airline name + number → IATA code
        // (replaces hard-coded 18-airline parseFlight() regex dictionary)
        const flightNum = flightEnt?.text ?? null;

        if (flightNum) {
          fetchFlightStatus(flightNum).then(flight => {
            const msg = flight ? flightToSpeech(flight) : `Could not find status for flight ${flightNum}. Over.`;
            if (flight) {
              const statusEmoji = { scheduled:'🕐', active:'✈️', landed:'🛬', cancelled:'❌', incident:'⚠️', diverted:'🔀', unknown:'❓' }[flight.status] ?? '✈️';
              setMessages(prev => [...prev, {
                id: `flight-${Date.now()}`, role: 'roger' as const,
                text: `${statusEmoji} ${flight.flightNumber} · ${flight.airline} · ${flight.status.toUpperCase()}${flight.delayMinutes ? ` · +${flight.delayMinutes}min` : ''}`,
                ts: Date.now(), intent: result.intent, outcome: 'success',
              }]);
            }
            speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
          }).catch(() => {
            const msg = 'Flight tracking unavailable. Check your AviationStack API key. Over.';
            speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
          });
        }
      }

      // ── SEND_SMS — Twilio outbound text message ───────────────────────────────
      if (result.intent === 'SEND_SMS') {
        const recipientEnt = result.entities?.find(e => e.type === 'RELAY_RECIPIENT' || e.type === 'PHONE_NUMBER');
        const contentEnt   = result.entities?.find(e => e.type === 'RELAY_CONTENT');
        const recipient    = recipientEnt?.text;
        const content      = contentEnt?.text ?? transcript.replace(/text|sms|message|send to/gi, '').trim();

        if (recipient && content) {
          // Look up phone number from contacts
          import('../../lib/supabase').then(async ({ supabase: sb }) => {
            const { data: contact } = await sb
              .from('roger_contacts')
              .select('display_name, phone_number')
              .ilike('display_name', `%${recipient}%`)
              .eq('user_id', userId)
              .maybeSingle();

            const phone = contact?.phone_number ?? (recipientEnt?.type === 'PHONE_NUMBER' ? recipient : null);
            if (!phone) {
              const noPhone = `${recipient} doesn't have a phone number saved. Add it in your Memory Vault. Over.`;
              speakResponse(noPhone).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
              return;
            }

            const SUPABASE_URL_VAL      = import.meta.env.VITE_SUPABASE_URL as string;
            const SUPABASE_ANON_KEY_VAL = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
            const { data: { session: authSess } } = await sb.auth.getSession();
            const authToken = authSess?.access_token ?? SUPABASE_ANON_KEY_VAL;

            const smsRes = await fetch(`${SUPABASE_URL_VAL}/functions/v1/twilio-sms`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
              body: JSON.stringify({ to: phone, message: content }),
            });
            const smsData = await smsRes.json() as { ok?: boolean; error?: string };
            const msg = smsData.ok
              ? `SMS sent to ${contact?.display_name ?? recipient}. Over.`
              : `SMS failed: ${smsData.error ?? 'unknown error'}. Over.`;
            speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
          }).catch(() => {});
        }
      }

      // ── CHECK_CALENDAR / BOOK_MEETING / CANCEL_MEETING ───────────────────────
      if (['CHECK_CALENDAR','FIND_FREE_SLOT','BOOK_MEETING','CANCEL_MEETING'].includes(result.intent)) {
        if (result.intent === 'CHECK_CALENDAR' || result.intent === 'FIND_FREE_SLOT') {
          fetchTodayEvents(userId).then(cal => {
            if (!cal.events.length) {
              const msg = 'Your calendar is clear today. Over.';
              speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
              return;
            }
            const summary = cal.events.slice(0, 3).map(eventToSpeech).join(', then ');
            const msg = `You have ${cal.events.length} event${cal.events.length > 1 ? 's' : ''} today. ${summary}. Over.`;
            setMessages(prev => [...prev, {
              id: `cal-${Date.now()}`, role: 'roger' as const,
              text: `📅 ${cal.events.length} events today`,
              ts: Date.now(), intent: result.intent, outcome: 'success',
            }]);
            speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
          }).catch(() => {
            const msg = 'Calendar not connected. Go to Settings to link your Google Calendar. Over.';
            speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
          });
        }

        if (result.intent === 'BOOK_MEETING') {
          const titleEnt = result.entities?.find(e => e.type === 'MEETING_TITLE');
          const timeEnt  = result.entities?.find(e => e.type === 'MEETING_TIME');
          const title = titleEnt?.text ?? 'Meeting';
          if (timeEnt?.text) {
            const now = new Date();
            const hourMatch = timeEnt.text.match(/(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
            let startIso = now.toISOString();
            if (hourMatch) {
              let hour = parseInt(hourMatch[1], 10);
              const min = parseInt(hourMatch[2] ?? '0', 10);
              const ampm = hourMatch[3]?.toLowerCase();
              if (ampm === 'pm' && hour < 12) hour += 12;
              if (ampm === 'am' && hour === 12) hour = 0;
              const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, min);
              if (timeEnt.text.toLowerCase().includes('tomorrow')) start.setDate(start.getDate() + 1);
              startIso = start.toISOString();
            }
            const endIso = new Date(new Date(startIso).getTime() + 60 * 60 * 1000).toISOString();
            // ── Confirmation gate for meeting booking ────────────────────────
            setPendingAction({
              type: 'meeting',
              label: `Book "${title}" at ${timeEnt.text}. Confirm? Over.`,
              execute: () => {
                createCalendarEvent(userId, { title, startIso, endIso }).then(() => {
                  const msg = `${title} booked at ${timeEnt.text}. Done. Over.`;
                  speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
                }).catch(() => {
                  const msg = 'Could not book meeting. Calendar not connected. Over.';
                  speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
                });
              },
            });
          }
        }

        if (result.intent === 'CANCEL_MEETING') {
          const titleEnt = result.entities?.find(e => e.type === 'MEETING_TITLE');
          if (titleEnt?.text) {
            deleteCalendarEvent(userId, titleEnt.text).then(ok => {
              const msg = ok ? `${titleEnt.text} cancelled. Over.` : `Could not find that meeting to cancel. Over.`;
              speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
            }).catch(() => {});
          }
        }
      }

      // ── SPOTIFY MUSIC INTENTS ─────────────────────────────────────────────────
      if (['PLAY_MUSIC','PLAY_PLAYLIST','PAUSE_MUSIC','SKIP_TRACK'].includes(result.intent)) {
        if (!isSpotifyConnected()) {
          const msg = 'Spotify not connected. Go to Settings to link your account. Over.';
          speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
        } else if (result.intent === 'PAUSE_MUSIC') {
          pausePlayback().then(() => {
            const msg = 'Music paused. Over.';
            speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
          }).catch(() => {});
        } else if (result.intent === 'SKIP_TRACK') {
          nextTrack().then(() => {
            const msg = 'Skipping. Over.';
            speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
          }).catch(() => {});
        } else {
          // PLAY_MUSIC or PLAY_PLAYLIST
          const moodEnt    = result.entities?.find(e => e.type === 'MOOD');
          const playlistEnt = result.entities?.find(e => e.type === 'PLAYLIST_NAME');
          const artistEnt  = result.entities?.find(e => e.type === 'ARTIST_NAME');
          const query = playlistEnt?.text ?? artistEnt?.text ?? moodEnt?.text ?? transcript.replace(/play|music|queue|spotify/gi, '').trim();
          playSearch(query).then(label => {
            const msg = label ? `Playing ${label}. Over.` : 'Could not find that on Spotify. Over.';
            speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
          }).catch(() => {});
        }
      }

      // ── INTERNET RADIO INTENTS ──────────────────────────────────────────────
      if (['PLAY_RADIO','STOP_RADIO','RADIO_INFO','NEXT_STATION'].includes(result.intent)) {
        const { searchAndPlay, stopRadio: stopRadioFn, getCurrentStation, playNextStation } = await import('../../lib/radioBrowser');

        if (result.intent === 'STOP_RADIO') {
          stopRadioFn();
          // Roger already spoke "Radio off. Over." from GPT response
        } else if (result.intent === 'RADIO_INFO') {
          const station = getCurrentStation();
          if (station) {
            const infoMsg = `Now playing: ${station.name}. ${station.tags?.split(',')[0] ?? 'Radio'}. ${station.country}. ${station.bitrate > 0 ? station.bitrate + 'kbps.' : ''} Over.`;
            speakResponse(infoMsg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
          } else {
            const noRadio = 'No radio playing right now. Say "play radio" to start. Over.';
            speakResponse(noRadio).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
          }
        } else if (result.intent === 'NEXT_STATION') {
          const next = await playNextStation();
          if (next) {
            const msg = `Switching to ${next.name}. Over.`;
            speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
          } else {
            const msg = 'No more stations in queue. Try a new search. Over.';
            speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
          }
        } else {
          // PLAY_RADIO — extract search criteria from entities
          const tagEnt     = result.entities?.find(e => e.type === 'RADIO_TAG' || e.type === 'MOOD');
          const stationEnt = result.entities?.find(e => e.type === 'RADIO_STATION');
          const countryEnt = result.entities?.find(e => e.type === 'RADIO_COUNTRY');
          const langEnt    = result.entities?.find(e => e.type === 'RADIO_LANGUAGE');
          const nearbyEnt  = result.entities?.find(e => e.type === 'RADIO_NEARBY');

          const station = await searchAndPlay({
            tag: tagEnt?.text,
            name: stationEnt?.text,
            countrycode: countryEnt?.text,
            language: langEnt?.text,
            geo_lat: nearbyEnt ? location?.latitude : undefined,
            geo_long: nearbyEnt ? location?.longitude : undefined,
          });

          if (station) {
            const msg = `Tuning in to ${station.name}. ${station.tags?.split(',')[0] ?? 'Radio'}. Over.`;
            speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
            setMessages(prev => [...prev, {
              id: `radio-${Date.now()}`, role: 'roger' as const,
              text: `📻 Now playing: ${station.name} (${station.country})`,
              ts: Date.now(), intent: result.intent, outcome: 'success',
            }]);
          } else {
            const msg = 'No stations found matching that. Try a different genre or country. Over.';
            speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
          }
        }
      }

      // ── LOG_TO_NOTION ────────────────────────────────────────────────────────
      if (result.intent === 'LOG_TO_NOTION') {
        pushTaskToNotion(userId, {
          title: transcript,
          priority: 5,
          tags: [result.intent, ...(result.entities?.map(e => e.text) ?? [])],
        }).then(page => {
          const msg = page ? `Logged to Notion. Over.` : 'Notion not connected. Add your token in Settings. Over.';
          speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
        }).catch(() => {});
      }

      // ── BOOK_RIDE — Uber Universal Link deep link ─────────────────────────
      if (result.intent === 'BOOK_RIDE' || result.intent === 'OPEN_UBER') {
        const destEnt = result.entities?.find(e =>
          e.type === 'LOCATION' || e.type === 'PLACE' || e.type === 'DESTINATION'
        );
        const destText = destEnt?.text ??
          transcript.replace(/book|ride|uber|careem|taxi|cab|take me|drive me|to|a/gi, '').trim();

        const openUber = (lat?: number, lng?: number, label?: string) => {
          let url: string;
          if (lat && lng) {
            // Uber Universal Link — officially supported, works with or without app installed
            const params = new URLSearchParams({
              'action': 'setPickup',
              'dropoff[latitude]':          lat.toFixed(6),
              'dropoff[longitude]':         lng.toFixed(6),
              'dropoff[nickname]':          label ?? destText,
              'dropoff[formatted_address]': label ?? destText,
            });
            url = `https://m.uber.com/ul/?${params.toString()}`;
          } else {
            // Fallback — no coords, open Uber homepage
            url = 'https://www.uber.com';
          }
          // Open in a new tab — Capacitor will hand off to the OS / Uber app
          window.open(url, '_blank', 'noopener');
        };

        if (destText && location) {
          // Geocode the destination using the existing geocodePlace utility
          geocodePlace(destText, location.latitude, location.longitude)
            .then(coords => openUber(coords?.lat, coords?.lng, destText))
            .catch(() => openUber(undefined, undefined, destText));
        } else {
          openUber(undefined, undefined, destText);
        }

        // Show a ride card in the message log
        setMessages(prev => [...prev, {
          id: `ride-${Date.now()}`, role: 'roger' as const,
          text: `🚗 Opening Uber to ${destText || 'your destination'}`,
          ts: Date.now(), intent: result.intent, outcome: 'success',
        }]);
      }

      // ── AMBIENT_LISTEN — start continuous ambient listening ───────────────────
      if (result.intent === 'AMBIENT_LISTEN' && !ambientActive) {
        // Gate: Pro-only feature
        const gate = checkGate('ambient_listener');
        if (!gate.allowed) {
          const gateMsg = `${gate.reason} Say "upgrade" to unlock it. Over.`;
          speakResponse(gateMsg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
        } else {
          const sess = createAmbientSession(
            {
              onChunk: (chunk) => {
                setAmbientLastChunk(chunk);
                if (chunk.isMusicDominant) {
                  const musicLabel = chunk.musicIdentified
                    ? `🎵 ${chunk.musicIdentified.title} — ${chunk.musicIdentified.artist}`
                    : chunk.musicHint ?? '🎵 Music detected';
                  setMessages(prev => [...prev, {
                    id: `ambient-music-${Date.now()}`, role: 'roger' as const,
                    text: musicLabel, ts: Date.now(), intent: 'AMBIENT_LISTEN', outcome: 'success',
                  }]);
                } else if (chunk.language && chunk.language !== 'en') {
                  const langMsg = `🌐 ${chunk.languageName ?? chunk.language} detected: "${chunk.transcriptClean.slice(0, 120)}${chunk.transcriptClean.length > 120 ? '…' : ''}"`;
                  setMessages(prev => [...prev, {
                    id: `ambient-lang-${Date.now()}`, role: 'roger' as const,
                    text: langMsg, ts: Date.now(), intent: 'AMBIENT_LISTEN', outcome: 'success',
                  }]);
                }
              },
              onMusicDetected: (info) => {
                const msg = `That's "${info.title}" by ${info.artist}${info.album ? ` from ${info.album}` : ''}. Over.`;
                speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
              },
              onError: (err) => console.warn('[Ambient]', err),
            },
          );
          const started = await sess.start();
          if (started) {
            ambientSessionRef.current = sess;
            setAmbientActive(true);
          } else {
            const errMsg = 'Microphone access required for listening mode. Over.';
            speakResponse(errMsg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
          }
        }
      }

      // ── AMBIENT_QUERY — read back last ambient chunk analysis ─────────────────
      if (result.intent === 'AMBIENT_QUERY') {
        const chunk = ambientLastChunk;
        if (!chunk) {
          const msg = "I haven't captured anything yet. Say 'listen to this' to start. Over.";
          speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
        } else {
          let msg = chunk.summary;
          if (chunk.language && chunk.language !== 'en') msg += ` Spoken in ${chunk.languageName ?? chunk.language}.`;
          if (chunk.musicHint) msg += ` Music note: ${chunk.musicHint}.`;
          msg += ' Over.';
          speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
        }
      }

      // ── AMBIENT_STOP — stop ambient session + summarise ───────────────────────
      if (result.intent === 'AMBIENT_STOP' && ambientActive && ambientSessionRef.current) {
        const finalResult: AmbientSessionResult = await ambientSessionRef.current.stop();
        ambientSessionRef.current = null;
        setAmbientActive(false);
        setAmbientLastChunk(null);

        // Save to DB (fire-and-forget)
        import('../../lib/supabase').then(async ({ supabase: sb }) => {
          await sb.from('ambient_sessions').insert({
            user_id:       userId,
            content_type:  finalResult.contentType,
            language:      finalResult.language,
            language_name: finalResult.languageName,
            transcript:    finalResult.transcript,
            summary:       finalResult.summary,
            music_title:   finalResult.musicTitle,
            music_artist:  finalResult.musicArtist,
            music_album:   finalResult.musicAlbum,
            duration_s:    finalResult.durationS,
            raw_chunks:    finalResult.chunks,
            ended_at:      new Date().toISOString(),
          });
        }).catch(() => {});

        const summary = finalResult.summary || 'No clear audio captured.';
        const finalMsg = `Listening stopped. ${summary} Over.`;
        speakResponse(finalMsg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
        setMessages(prev => [...prev, {
          id: `ambient-end-${Date.now()}`, role: 'roger' as const,
          text: `🎙️ Ambient session ended · ${finalResult.durationS}s · ${finalResult.contentType}${finalResult.musicTitle ? ` · 🎵 ${finalResult.musicTitle}` : ''}${finalResult.language && finalResult.language !== 'en' ? ` · 🌐 ${finalResult.languageName}` : ''}`,
          ts: Date.now(), intent: 'AMBIENT_STOP', outcome: 'success',
        }]);
      }

      // ── RECORD_MEETING — start meeting recorder ───────────────────────────────
      if (result.intent === 'RECORD_MEETING' && !meetingActive) {
        // Gate: Pro-only feature
        const gate = checkGate('meeting_recorder');
        if (!gate.allowed) {
          const gateMsg = `${gate.reason} Say "upgrade" to unlock it. Over.`;
          speakResponse(gateMsg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
        } else {
          const titleEnt  = result.entities?.find(e => e.type === 'MEETING_TITLE');
          const mTitle = titleEnt?.text ?? 'Meeting';
          setMeetingTitle(mTitle);

          const rec = createMeetingRecorder(
            userId,
            {
              onChunkTranscribed: (chunk: MeetingChunk) => {
                setMeetingWords(prev => prev + chunk.wordCount);
              },
              onProgress: (elapsed, words) => {
                setMeetingElapsed(elapsed);
                setMeetingWords(words);
              },
              onComplete: (res: MeetingResult) => {
                setMeetingActive(false);
                setMeetingElapsed(0);
                setMeetingWords(0);
                const msg = res.notes.spoken_summary || `Meeting notes ready. ${res.notes.action_items.length} action item${res.notes.action_items.length !== 1 ? 's' : ''}. Over.`;
                speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
                setMessages(prev => [...prev, {
                  id: `meeting-done-${Date.now()}`, role: 'roger' as const,
                  text: `📋 Meeting notes ready: "${res.title}" · ${res.notes.action_items.length} actions · ${res.notes.decisions.length} decisions`,
                  ts: Date.now(), intent: 'END_MEETING', outcome: 'success',
                }]);
              },
              onError: (err) => console.warn('[Meeting]', err),
            },
          );

          const started = await rec.start(mTitle);
          if (started) {
            meetingRecorderRef.current = rec;
            setMeetingActive(true);
          } else {
            const errMsg = 'Microphone access required for meeting recording. Over.';
            speakResponse(errMsg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
          }
        }
      }

      // ── END_MEETING — stop recorder and generate notes ────────────────────────
      if (result.intent === 'END_MEETING' && meetingActive && meetingRecorderRef.current) {
        await meetingRecorderRef.current.stop(); // onComplete fires automatically
        meetingRecorderRef.current = null;
      }

      extractMemoryFacts(transcript, result.roger_response, userId).catch(() => {});

      // ── Fix 1: Name Spelling Confirmation ──────────────────────────────────
      // For any new PERSON entity, Roger spells it back for confirmation
      const personEntities = (result.entities ?? []).filter(e => e.type === 'PERSON' && e.confidence > 60);
      if (personEntities.length > 0 && !pendingNameConfirm) {
        const firstPerson = personEntities[0];
        const spelled = firstPerson.text.toUpperCase().split('').join(', ');
        const namePrompt = `Confirming name: ${spelled}. Is that correct? Over.`;
        setTimeout(() => {
          speakResponse(namePrompt).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
          setPendingNameConfirm({ name: firstPerson.text });
        }, 1500); // small delay so Roger's main response finishes first
      }



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
      const isKnowledge = result.is_knowledge_query ?? false;
      const ddCtx = deepDiveRef.current;
      const currentDepth = ddCtx?.depth ?? 0;
      // Track deep dive state for voice-triggered knowledge queries
      if (isKnowledge && !ddCtx) {
        const topicEntity = result.entities?.find(e => e.type === 'TOPIC');
        setDeepDiveState({
          topic: topicEntity?.text || transcript.slice(0, 60),
          depth: 0,
          coverageSummary: result.roger_response.slice(0, 200),
          turns: [result.roger_response],
        });
      } else if (isKnowledge && ddCtx) {
        setDeepDiveState(prev => prev ? {
          ...prev,
          coverageSummary: prev.coverageSummary + '\n' + result.roger_response.slice(0, 200),
          turns: [...prev.turns, result.roger_response],
        } : null);
      } else if (!isKnowledge) {
        setDeepDiveState(null);
      }
      setMessages(prev => [...prev, {
        id: `r-${Date.now()}`, role: 'roger',
        text: result.roger_response + (insight ? `\n\n💡 ${insight}` : ''),
        ts: Date.now(), intent: result.intent, outcome: result.outcome,
        isKnowledge,
        subtopics: result.subtopics ?? undefined,
        deepDiveDepth: isKnowledge ? currentDepth : undefined,
        translationSource: result.translation_source ?? undefined,
        translationTarget: result.translation_target ?? undefined,
        translationTargetLang: result.translation_target_lang ?? undefined,
        translationRomanized: result.translation_romanized ?? undefined,
      }]);

      hapticResponseReceived();

      // TTS
      hapticRogerSpeaking();
      sfxRogerIn();
      lastRogerMsgRef.current = result.roger_response;
      setPttState('speaking'); setIsSpeaking(true);
      try { await speakResponse(result.roger_response); }
      catch { try { window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(result.roger_response); window.speechSynthesis.speak(u); await new Promise<void>(res => { u.onend = () => res(); }); } catch { /* silent */ } }
      setIsSpeaking(false);
      sfxRogerOut();

      if (result.outcome === 'clarification') {
        setPttState('awaiting_answer');
        // Store the question Roger asked for the overlay
        setClarifQuestion(result.roger_response);

        // ── L1: Store clarification context for next PTT cycle ─────────────
        const ctx = createClarificationContext(transcript, result, pendingClarification);
        setPendingClarification(ctx);

        // ── L3: Store intent disambiguation options if present ─────────────
        setIntentOptions(result.intent_options ?? null);

        // Auto-expire clarification context
        if (clarificationExpiryRef.current) clearTimeout(clarificationExpiryRef.current);
        clarificationExpiryRef.current = setTimeout(() => {
          setPendingClarification(null);
          setIntentOptions(null);
        }, CLARIFICATION_EXPIRY_MS);

        // Log clarification to DB so admin can see it
        const txStart = Date.now();
        logClarification({
          userId,
          sessionId,
          transcript,
          rogerQuestion:  result.roger_response,
          ambiguity:      result.ambiguity ?? 70,
          intent:         result.intent,
          latencyMs:      Date.now() - txStart,
        });
        // Countdown ring: 8 seconds
        setClarifCountdown(8);
        if (clarifTimerRef.current) clearInterval(clarifTimerRef.current);
        clarifTimerRef.current = setInterval(() => {
          setClarifCountdown(c => {
            if (c <= 1) {
              clearInterval(clarifTimerRef.current!);
              setClarifQuestion('');
              setPttState(s => s === 'awaiting_answer' ? 'idle' : s);
              return 0;
            }
            return c - 1;
          });
        }, 1000);
        // Auto-PTT after 800ms so user can answer hands-free
        awaitRef.current = setTimeout(() => handlePTTDown(), 800);
      } else {
        // ── L1: Clear clarification context on successful resolution ────────
        if (pendingClarification) {
          setPendingClarification(null);
          setIntentOptions(null);
          if (clarificationExpiryRef.current) clearTimeout(clarificationExpiryRef.current);
        }
        setClarifQuestion('');
        setPttState('responded');
      }
    } catch (e) {
      hapticError();
      sfxError();
      const m = e instanceof Error && e.message === 'AI_TIMEOUT'
        ? 'Roger lost signal — transmission timed out. Hold and try again. Over.'
        : e instanceof Error && e.message.includes('abort') ? 'Signal timeout. Retry. Over.' : 'AI offline. Retry. Over.';
      speakResponse(m).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
      setIsSpeaking(false); setPttState('responded');
    }
  }, [pttState, history, userId, handlePTTDown, resetIdleTimer]);

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
  const stateLabel = pttState === 'recording' ? `● ${t('ptt.recording_time', { time: (holdMs/1000).toFixed(1) })}`
    : pttState === 'transcribing' ? `▸▸ ${t('ptt.listening')}`
    : pttState === 'processing'   ? `◈ ${t('ptt.thinking')}`
    : pttState === 'speaking'     ? `◉ ${t('ptt.speaking')}`
    : pttState === 'awaiting_answer' ? 'ANSWER NOW'
    : pttState === 'responded'    ? `${t('ptt.standing_by')}`
    : `▣ ${t('ptt.hold_to_talk')}`;

  const btnColor = pttState === 'recording'       ? '#d4a044'
    : pttState === 'speaking'                     ? '#4ade80'
    : pttState === 'awaiting_answer'              ? '#4ade80'
    : pttState === 'processing'                   ? '#a78bfa'
    : pttState === 'transcribing'                 ? '#a78bfa'
    : pttState === 'responded'                    ? '#4ade8088'
    : 'rgba(255,255,255,0.25)';

  const intentColor = (intent?: string) => {
    if (!intent) return 'var(--text-muted)';
    if (intent.startsWith('CREATE_')) return '#4ade80';
    if (intent.startsWith('QUERY_') || intent.includes('QUERY')) return '#3b82f6';
    if (intent === 'MEMORY_CAPTURE' || intent === 'BOOK_UPDATE') return '#a78bfa';
    if (intent === 'CONVERSE') return 'var(--text-muted)';
    if (intent.startsWith('TUNE_IN')) return '#6366f1';
    return 'var(--amber)';
  };

  const relativeTime = (ts: number) => {
    const d = Math.floor((Date.now() - ts) / 1000);
    if (d < 60) return 'just now';
    if (d < 3600) return `${Math.floor(d/60)}m ago`;
    return `${Math.floor(d/3600)}h ago`;
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 0 }}>

      {/* ── Header ── */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Radio size={14} style={{ color: 'var(--green)' }} className="led-pulse" />
          <span style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: '0.2em', color: 'var(--amber)', textTransform: 'uppercase', fontWeight: 600 }}>{t('app.name')}</span>
          {myCallsign && (
            <span style={{ fontFamily: 'monospace', fontSize: 8, padding: '2px 7px', border: '1px solid rgba(212,160,68,0.25)', color: 'rgba(212,160,68,0.6)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              {myCallsign}
            </span>
          )}
        </div>
        <span style={{ fontFamily: 'monospace', fontSize: 9, padding: '2px 8px', border: '1px solid var(--green-border)', background: 'var(--green-dim)', color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
          <RogerIcon name="mode-active" size={9} color="var(--green)" style={{ display: 'inline', verticalAlign: 'middle', marginRight: 3 }} />{rogerMode.toUpperCase()}
        </span>
        {location && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'monospace', fontSize: 9, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
              <MapPin size={9} /> {locationLabel}
            </span>
            <span style={{ fontFamily: 'monospace', fontSize: 7, color: 'rgba(255,255,255,0.18)', letterSpacing: '0.06em' }}>
              {location.latitude.toFixed(4)}°{location.latitude >= 0 ? 'N' : 'S'}, {location.longitude.toFixed(4)}°{location.longitude >= 0 ? 'E' : 'W'}
            </span>
          </div>
        )}
      </div>

      {/* ── Proactive Roger Ping Banner ── */}
      {proactivePending && (
        <div style={{
          margin: '8px 16px 0',
          background: proactivePending.trigger === 'thinking' ? 'rgba(239,161,51,0.10)' : 'rgba(212,160,68,0.08)',
          border: `1px solid ${proactivePending.trigger === 'thinking' ? 'rgba(239,161,51,0.45)' : 'rgba(212,160,68,0.35)'}`,
          padding: '10px 14px',
          display: 'flex', alignItems: 'center', gap: 10,
          animation: proactivePending.trigger === 'thinking' ? 'thinkingPulse 1.5s ease-in-out infinite' : 'rogerPingPulse 2s ease-in-out infinite',
        }}>
          <RogerIcon name={proactivePending.trigger === 'thinking' ? 'brain' : 'mode-active'} size={16} color={proactivePending.trigger === 'thinking' ? '#efa133' : 'var(--amber)'} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'monospace', fontSize: 9, color: proactivePending.trigger === 'thinking' ? '#efa133' : 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 2 }}>
              {proactivePending.trigger === 'thinking' ? 'ROGER IS THINKING' : `ROGER HAS A MESSAGE · ${proactivePending.trigger.toUpperCase()}`}
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {proactivePending.text}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
            <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              {proactivePending.trigger === 'thinking' ? '1×PTT → hear · 2×PTT → snooze 15m' : 'PTT → speak · 2×PTT → snooze'}
            </span>
            <button onClick={() => { clearPending(); setThinkingPulse(false); }} style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', background: 'transparent', border: '1px solid var(--border-subtle)', padding: '2px 8px', cursor: 'pointer', textTransform: 'uppercase' }}>
              DISMISS
            </button>
          </div>
        </div>
      )}

      {/* ── Incoming Relay Transmission Card ── */}
      {incomingRelay && (

        <div style={{
          margin: '12px 16px 0',
          padding: '16px 18px',
          background: incomingRelay.priority === 'emergency' ? 'rgba(239,68,68,0.08)'
            : incomingRelay.priority === 'urgent' ? 'rgba(212,160,68,0.08)'
            : 'rgba(59,130,246,0.06)',
          border: `1px solid ${incomingRelay.priority === 'emergency' ? 'rgba(239,68,68,0.5)'
            : incomingRelay.priority === 'urgent' ? 'rgba(212,160,68,0.4)'
            : 'rgba(59,130,246,0.3)'}`,
          animation: incomingRelay.priority === 'emergency' ? 'pulse 1s infinite' : 'none',
        }}>
          {/* Top row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{
              fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.18em', fontWeight: 700,
              color: incomingRelay.priority === 'emergency' ? '#ef4444'
                : incomingRelay.priority === 'urgent' ? 'var(--amber)' : '#3b82f6',
            }}>
              {incomingRelay.priority === 'emergency' ? 'EMERGENCY TRANSMISSION'
               : incomingRelay.priority === 'urgent'  ? 'URGENT MESSAGE'
               : 'INCOMING TRANSMISSION'}
            </span>
            <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)' }}>
              {Math.floor((Date.now() - new Date(incomingRelay.created_at).getTime()) / 60000)}m ago
            </span>
          </div>
          {/* Message */}
          <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', margin: '0 0 12px', lineHeight: 1.55 }}>
            {incomingRelay.roger_summary ?? incomingRelay.transcript}
          </p>
          {/* Actions */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onPointerDown={handlePTTDown}
              style={{
                flex: 1, padding: '7px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase',
                letterSpacing: '0.12em', cursor: 'pointer',
                background: 'rgba(59,130,246,0.12)', border: '1px solid #3b82f6', color: '#3b82f6',
              }}>
              REPLY NOW
            </button>
            <button
              onClick={async () => { await deferRelayMessage(incomingRelay.id); setIncomingRelay(null); }}
              style={{
                padding: '7px 12px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase',
                letterSpacing: '0.12em', cursor: 'pointer',
                background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)',
              }}>
              DEFER 2H
            </button>
            <button
              onClick={async () => { await markRelayRead(incomingRelay.id); setIncomingRelay(null); }}
              style={{
                padding: '7px 12px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase',
                letterSpacing: '0.12em', cursor: 'pointer',
                background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)',
              }}>
              READ
            </button>
          </div>
        </div>
      )}

      {/* ── Tune In: Incoming Request Card ── */}
      {incomingTuneInRequest && (() => {
        const req = incomingTuneInRequest;
        const secondsLeft = Math.max(0, Math.floor((new Date(req.expiresAt).getTime() - Date.now()) / 1000));
        return (
          <div style={{
            margin: '12px 16px 0',
            padding: '16px 18px',
            background: 'rgba(99,102,241,0.08)',
            border: '1px solid rgba(99,102,241,0.5)',
            borderRadius: 4,
            animation: 'pulse 1.5s infinite',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.18em', fontWeight: 700, color: '#6366f1' }}>
                INCOMING TUNE-IN REQUEST
              </span>
              <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>
                {secondsLeft}s
              </span>
            </div>
            <p style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', margin: '0 0 4px', fontWeight: 600 }}>
              {req.from}
            </p>
            <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 12px' }}>
              {req.callsign}{req.reason ? ` — "${req.reason}"` : ''}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={async () => {
                  const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL as string;
                  const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
                  const { data: { session } } = await supabase.auth.getSession();
                  const token = session?.access_token ?? SUPABASE_ANON_KEY;
                  const res = await fetch(`${SUPABASE_URL}/functions/v1/accept-tune-in`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ requestId: req.requestId }),
                  }).then(r => r.json()).catch(() => ({ ok: false }));
                  if (res.ok) { setActiveTuneInSession({ sessionId: res.sessionId, withName: res.withName ?? req.from }); setIncomingTuneInRequest(null); }
                }}
                style={{ flex: 1, padding: '9px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', cursor: 'pointer', background: 'rgba(99,102,241,0.15)', border: '1px solid #6366f1', color: '#6366f1', borderRadius: 3 }}>
                ACCEPT
              </button>
              <button
                onClick={async () => {
                  const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL as string;
                  const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
                  const { data: { session } } = await supabase.auth.getSession();
                  const token = session?.access_token ?? SUPABASE_ANON_KEY;
                  await fetch(`${SUPABASE_URL}/functions/v1/decline-tune-in`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ requestId: req.requestId }),
                  }).catch(() => {});
                  setIncomingTuneInRequest(null);
                }}
                style={{ padding: '9px 16px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', cursor: 'pointer', background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', borderRadius: 3 }}>
                DECLINE
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Tune In: Active Session Banner ── */}
      {activeTuneInSession && (
        <div style={{
          margin: '12px 16px 0',
          padding: '14px 18px',
          background: 'rgba(16,185,129,0.06)',
          border: '1px solid rgba(16,185,129,0.35)',
          borderRadius: 4,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.18em', color: '#10b981', marginBottom: 4 }}>
              LIVE SESSION — ROGER LISTENING
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>
              {activeTuneInSession.withName}
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
              PTT relays your voice directly. Say "over and out" to end.
            </div>
          </div>
          <button
            style={{ padding: '8px 14px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', cursor: 'pointer', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444', borderRadius: 3, flexShrink: 0 }}
            onClick={async () => {
              const SUPABASE_URL       = import.meta.env.VITE_SUPABASE_URL as string;
              const SUPABASE_ANON_KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
              const { data: { session } } = await supabase.auth.getSession();
              const token = session?.access_token ?? SUPABASE_ANON_KEY;
              const prevSess = activeTuneInSession;
              const res = await fetch(`${SUPABASE_URL}/functions/v1/end-tune-in`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ sessionId: activeTuneInSession!.sessionId }),
              }).then(r => r.json()).catch(() => ({ ok: false }));
              setActiveTuneInSession(null);
              const msg = res.rogerResponse ?? 'Channel closed. Over.';
              speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
              if (prevSess?.withName?.startsWith('Callsign ')) {
                const cs = prevSess.withName.replace('Callsign ', '');
                setPendingContactSave({ callsign: cs, contactName: '' });
                setContactSaveInput('');
                const prompt = `That was Callsign ${cs}. Want to save them? Type or say their name.`;
                setTimeout(() => speakResponse(prompt).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); }), 2000);
              }
            }}>
            END SESSION
          </button>

        </div>
      )}

      {/* ── Ambient Listening Active Banner ── */}
      {ambientActive && (
        <div style={{
          margin: '8px 16px 0',
          padding: '10px 16px',
          background: 'rgba(168,85,247,0.06)',
          border: '1px solid rgba(168,85,247,0.35)',
          borderRadius: 4,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.18em', color: '#a855f7', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#a855f7', animation: 'pulse 1.2s infinite' }} />
              AMBIENT LISTENING ACTIVE
            </div>
            {ambientLastChunk && (
              <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                {ambientLastChunk.contentType === 'music' || ambientLastChunk.isMusicDominant
                  ? `🎵 Music detected${ambientLastChunk.musicIdentified ? ` — ${ambientLastChunk.musicIdentified.title}` : ''}`
                  : ambientLastChunk.language && ambientLastChunk.language !== 'en'
                    ? `🌐 ${ambientLastChunk.languageName ?? ambientLastChunk.language} · ${ambientLastChunk.summary}`
                    : ambientLastChunk.summary}
              </div>
            )}
            {!ambientLastChunk && (
              <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>
                Analysing every 30s · Say "stop listening" to end
              </div>
            )}
          </div>
          <button
            onClick={async () => {
              if (ambientSessionRef.current) {
                const res = await ambientSessionRef.current.stop();
                ambientSessionRef.current = null;
                setAmbientActive(false);
                setAmbientLastChunk(null);
                const msg = `Listening stopped. ${res.summary || 'Session ended'}. Over.`;
                speakResponse(msg).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
              }
            }}
            style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.35)', color: '#a855f7', borderRadius: 3, flexShrink: 0 }}
          >
            STOP
          </button>
        </div>
      )}

      {/* ── Meeting Recording Active Banner ── */}
      {meetingActive && (
        <div style={{
          margin: '8px 16px 0',
          padding: '10px 16px',
          background: 'rgba(239,68,68,0.05)',
          border: '1px solid rgba(239,68,68,0.35)',
          borderRadius: 4,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.18em', color: '#ef4444', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#ef4444', animation: 'pulse 0.9s infinite' }} />
              RECORDING: {meetingTitle || 'MEETING'}
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', display: 'flex', gap: 14 }}>
              <span>⏱ {Math.floor(meetingElapsed / 60)}:{String(meetingElapsed % 60).padStart(2, '0')}</span>
              <span>~{meetingWords} words</span>
              <span>Say "end meeting" to stop</span>
            </div>
          </div>
          <button
            onClick={async () => {
              if (meetingRecorderRef.current) {
                meetingRecorderRef.current.stop().catch(() => {});
                meetingRecorderRef.current = null;
              }
            }}
            style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', color: '#ef4444', borderRadius: 3, flexShrink: 0 }}
          >
            END
          </button>
        </div>
      )}

      {/* ── Save Contact Prompt ── */}
      {pendingContactSave && (
        <div style={{
          margin: '12px 16px 0',
          padding: '16px 18px',
          background: 'rgba(245,158,11,0.06)',
          border: '1px solid rgba(245,158,11,0.35)',
          borderRadius: 4,
        }}>
          <div style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.18em', color: 'var(--amber)', marginBottom: 8 }}>
            SAVE CONTACT — {pendingContactSave.callsign}
          </div>
          <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>
            What should Roger call this person?
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={contactSaveInput}
              onChange={e => setContactSaveInput(e.target.value)}
              onKeyDown={async e => {
                if (e.key !== 'Enter' || !contactSaveInput.trim()) return;
                const name = contactSaveInput.trim();
                const { data: csRow } = await supabase.from('user_callsigns').select('user_id').eq('callsign', pendingContactSave.callsign).maybeSingle();
                if (csRow?.user_id) {
                  await supabase.from('roger_contacts').upsert({ user_id: userId, contact_id: csRow.user_id, display_name: name, callsign: pendingContactSave.callsign }, { onConflict: 'user_id,contact_id' });
                }
                setPendingContactSave(null);
                setContactSaveInput('');
                const conf = `${name} saved. You can now say "tune in with ${name}". Over.`;
                speakResponse(conf).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); });
              }}
              placeholder="Type name + Enter"
              style={{ flex: 1, padding: '8px 12px', fontFamily: 'monospace', fontSize: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: 3, outline: 'none' }}
            />
            <button
              onClick={() => { setPendingContactSave(null); setContactSaveInput(''); }}
              style={{ padding: '8px 14px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', cursor: 'pointer', background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', borderRadius: 3 }}>
              SKIP
            </button>
          </div>
        </div>
      )}

      {/* ── Confirmation Gate Card ── */}
      {pendingAction && (
        <div style={{
          margin: '12px 16px 0',
          padding: '16px 18px',
          background: 'rgba(74,222,128,0.06)',
          border: '1px solid rgba(74,222,128,0.4)',
          borderRadius: 4,
        }}>
          <div style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.18em', color: 'var(--green)', marginBottom: 8, fontWeight: 700 }}>
            ROGER AWAITING CONFIRMATION
          </div>
          <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', margin: '0 0 12px', lineHeight: 1.55 }}>
            {pendingAction.label}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={confirmPendingAction}
              style={{ flex: 1, padding: '8px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', cursor: 'pointer', background: 'rgba(74,222,128,0.12)', border: '1px solid var(--green)', color: 'var(--green)' }}>
              CONFIRM
            </button>
            <button
              onClick={cancelPendingAction}
              style={{ padding: '8px 16px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', cursor: 'pointer', background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
              CANCEL
            </button>
          </div>
        </div>
      )}

      {/* ── Name Spelling Confirm Card ── */}
      {pendingNameConfirm && (
        <div style={{
          margin: '12px 16px 0',
          padding: '16px 18px',
          background: 'rgba(167,139,250,0.06)',
          border: '1px solid rgba(167,139,250,0.4)',
          borderRadius: 4,
        }}>
          <div style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.18em', color: '#a78bfa', marginBottom: 8, fontWeight: 700 }}>
            NAME CONFIRMATION
          </div>
          <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', margin: '0 0 12px', lineHeight: 1.55 }}>
            Roger heard: <strong style={{ letterSpacing: '0.1em' }}>{pendingNameConfirm.name.toUpperCase().split('').join(' · ')}</strong> — is that correct?
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => { setPendingNameConfirm(null); const m = 'Name confirmed. Over.'; speakResponse(m).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); }); }}
              style={{ flex: 1, padding: '8px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', cursor: 'pointer', background: 'rgba(167,139,250,0.12)', border: '1px solid #a78bfa', color: '#a78bfa' }}>
              CORRECT
            </button>
            <button
              onClick={() => { setPendingNameConfirm(null); const m = 'Please say the name again. Over.'; speakResponse(m).catch(() => { console.warn('[TTS] OpenAI TTS failed, silent fallback'); }); }}
              style={{ padding: '8px 16px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', cursor: 'pointer', background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
              WRONG
            </button>
          </div>
        </div>
      )}

      {/* ── Clarification Overlay Card ── */}
      {pttState === 'awaiting_answer' && clarifQuestion && (
        <div style={{
          margin: '12px 16px 0',
          padding: '16px 18px',
          background: 'rgba(212,160,68,0.07)',
          border: '1px solid rgba(212,160,68,0.35)',
          borderRadius: 2,
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Animated left-border progress bar */}
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
            background: 'var(--amber)',
            animation: 'none',
            transformOrigin: 'top',
            transform: `scaleY(${clarifCountdown / 8})`,
            transition: 'transform 1s linear',
          }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.18em', fontWeight: 700 }}>
              ROGER NEEDS CLARIFICATION
              {pendingClarification && pendingClarification.attempt > 1
                ? ` (ATTEMPT ${pendingClarification.attempt}/${2})`
                : ''}
            </span>
            {/* Countdown circle */}
            <div style={{ position: 'relative', width: 28, height: 28 }}>
              <svg width={28} height={28} style={{ transform: 'rotate(-90deg)' }}>
                <circle cx={14} cy={14} r={11} fill="none" stroke="rgba(212,160,68,0.15)" strokeWidth={2} />
                <circle cx={14} cy={14} r={11} fill="none" stroke="var(--amber)" strokeWidth={2}
                  strokeDasharray={`${2 * Math.PI * 11}`}
                  strokeDashoffset={`${2 * Math.PI * 11 * (1 - clarifCountdown / 8)}`}
                  style={{ transition: 'stroke-dashoffset 1s linear' }}
                />
              </svg>
              <span style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'monospace', fontSize: 9, color: 'var(--amber)', fontWeight: 700,
              }}>{clarifCountdown}</span>
            </div>
          </div>
          <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', margin: '0 0 12px', lineHeight: 1.55 }}>
            {clarifQuestion.split('\n')[0]}
          </p>

          {/* ── L3: Intent Disambiguation Chips ── */}
          {intentOptions && intentOptions.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {intentOptions.map((opt) => (
                <button
                  key={opt.intent}
                  onClick={() => {
                    // Inject the chosen intent as a chip prompt
                    chipPromptRef.current = opt.label;
                    if (clarifTimerRef.current) clearInterval(clarifTimerRef.current);
                    setClarifQuestion('');
                    setIntentOptions(null);
                    // Clear clarification context since user chose explicitly
                    setPendingClarification(null);
                    if (clarificationExpiryRef.current) clearTimeout(clarificationExpiryRef.current);
                    setMessages(prev => [...prev, { id: `u-choice-${Date.now()}`, role: 'user', text: opt.label, ts: Date.now() }]);
                    setPttState('processing');
                  }}
                  style={{
                    padding: '6px 12px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase',
                    letterSpacing: '0.1em', cursor: 'pointer',
                    background: 'rgba(212,160,68,0.12)', border: '1px solid rgba(212,160,68,0.4)',
                    color: 'var(--amber)', borderRadius: 1,
                    transition: 'background 0.15s',
                  }}
                  onPointerEnter={(e) => (e.currentTarget.style.background = 'rgba(212,160,68,0.25)')}
                  onPointerLeave={(e) => (e.currentTarget.style.background = 'rgba(212,160,68,0.12)')}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onPointerDown={handlePTTDown}
              style={{
                flex: 1, padding: '7px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase',
                letterSpacing: '0.12em', cursor: 'pointer',
                background: 'rgba(212,160,68,0.1)', border: '1px solid var(--amber)', color: 'var(--amber)',
              }}>
              ANSWER NOW
            </button>
            <button
              onClick={() => {
                if (clarifTimerRef.current) clearInterval(clarifTimerRef.current);
                setClarifQuestion('');
                setPendingClarification(null);
                setIntentOptions(null);
                if (clarificationExpiryRef.current) clearTimeout(clarificationExpiryRef.current);
                setPttState('idle');
              }}
              style={{
                padding: '7px 14px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase',
                letterSpacing: '0.12em', cursor: 'pointer',
                background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)',
              }}>
              DISMISS
            </button>
          </div>
        </div>
      )}
      {activeSurface && (
        <div style={{ margin: '12px 16px 0', padding: '14px 16px', background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.15em' }}>ROGER · PROACTIVE</span>
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
      {/* ── Learning Mode Banner ── */}
      {deepDiveState && deepDiveState.depth >= 3 && (
        <div style={{
          margin: '8px 16px 0', padding: '8px 14px',
          background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#818cf8', animation: 'pulse 1.5s ease-in-out infinite' }} />
          <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.12em', flex: 1 }}>
            LEARNING MODE — {deepDiveState.topic}
          </span>
          <button
            onClick={() => setDeepDiveState(null)}
            style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', background: 'transparent', border: '1px solid var(--border-subtle)', padding: '2px 8px', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.1em' }}
          >EXIT</button>
        </div>
      )}

      {/* ── Messages ── */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, opacity: 0.3 }}>
            <Radio size={36} style={{ color: 'var(--amber)' }} />
            <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.25em' }}>{t('ptt.hold_to_talk')}</span>
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start', gap: 4 }}>

            {/* Role label + timestamp */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: msg.role === 'user' ? 0 : 2, paddingRight: msg.role === 'user' ? 2 : 0 }}>
              {msg.role === 'roger' && msg.intent && msg.intent !== 'CONVERSE' && (
                <span style={{ fontFamily: 'monospace', fontSize: 8, color: intentColor(msg.intent), padding: '1px 6px', border: `1px solid ${intentColor(msg.intent)}44`, background: `${intentColor(msg.intent)}11`, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {msg.intent.replace(/_/g,' ')}
                </span>
              )}
              <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                {msg.role === 'user' ? 'YOU' : 'ROGER'}
              </span>
              <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'rgba(255,255,255,0.2)' }}>
                {relativeTime(msg.ts)}
              </span>
            </div>

            {/* Bubble */}
            <div style={{
              maxWidth: '88%',
              padding: '10px 14px',
              background: msg.role === 'user'
                ? 'rgba(212,160,68,0.08)'
                : msg.outcome === 'clarification'
                  ? 'rgba(212,160,68,0.05)'
                  : 'rgba(255,255,255,0.04)',
              borderLeft: msg.role === 'roger' ? `3px solid ${intentColor(msg.intent)}` : 'none',
              borderRight: msg.role === 'user' ? '3px solid rgba(212,160,68,0.5)' : 'none',
              border: `1px solid ${
                msg.role === 'user' ? 'rgba(212,160,68,0.18)'
                : msg.outcome === 'clarification' ? 'rgba(212,160,68,0.2)'
                : 'rgba(255,255,255,0.08)'
              }`,
            }}>
              <p style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{msg.text}</p>
              {/* ── Translation Dual-Line Bubble ── */}
              {msg.translationTarget && (
                <div style={{
                  marginTop: 10, padding: '10px 12px',
                  background: 'rgba(59,130,246,0.08)',
                  border: '1px solid rgba(59,130,246,0.2)',
                  borderRadius: 6,
                }}>
                  <div style={{ fontFamily: 'monospace', fontSize: 8, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
                    TRANSLATION {msg.translationTargetLang ? `(${msg.translationTargetLang.toUpperCase()})` : ''}
                  </div>
                  {msg.translationSource && (
                    <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, opacity: 0.6 }}>
                      {msg.translationSource}
                    </div>
                  )}
                  <div style={{ fontFamily: 'monospace', fontSize: 15, color: '#60a5fa', fontWeight: 600 }}>
                    {msg.translationTarget}
                  </div>
                  {msg.translationRomanized && (
                    <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(96,165,250,0.6)', fontStyle: 'italic', marginTop: 3 }}>
                      {msg.translationRomanized}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* News article cards */}
            {msg.news && msg.news.length > 0 && (
              <div style={{ maxWidth: '88%', display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2 }}>
                {msg.news.map((article, i) => (
                  <a key={i} href={article.url} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'block', padding: '10px 12px', textDecoration: 'none', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(74,222,128,0.12)', borderLeft: '3px solid var(--green)', transition: 'background 150ms' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(74,222,128,0.07)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                  >
                    <div style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 4 }}>{article.source} · {new Date(article.publishedAt).toLocaleDateString()}</div>
                    <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.4 }}>{article.title}</div>
                    {article.description && (
                      <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{article.description}</div>
                    )}
                  </a>
                ))}
              </div>
            )}

            {/* ── Knowledge Mode — progressive UI ── */}
            {msg.role === 'roger' && msg.isKnowledge && pttState !== 'recording' && pttState !== 'processing' && (
              <div style={{ maxWidth: '88%', display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>

                {/* Depth 0-1: Tell Me More button */}
                {(msg.deepDiveDepth === undefined || msg.deepDiveDepth < 2) && (
                  <button
                    onClick={() => {
                      if (pttState !== 'idle' && pttState !== 'responded') return;
                      const topic = deepDiveState?.topic || msg.text.slice(0, 60);
                      const newDepth = (deepDiveState?.depth ?? 0) + 1;
                      setDeepDiveState(prev => ({
                        topic, depth: newDepth,
                        coverageSummary: (prev?.coverageSummary ?? '') + '\n' + msg.text.slice(0, 200),
                        turns: [...(prev?.turns ?? []), msg.text],
                      }));
                      const synth: Message = { id: `dd-${Date.now()}`, role: 'user', text: `Tell me more about ${topic}`, ts: Date.now() };
                      setMessages(prev => [...prev, synth]);
                      setHistory(prev => [...prev, { role: 'user', content: `Tell me more about ${topic}` }]);
                      chipPromptRef.current = `Tell me more about ${topic}`;
                      setPttState('processing');
                    }}
                    style={{ padding: '6px 14px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', background: 'rgba(99,102,241,0.10)', border: '1px solid rgba(99,102,241,0.3)', color: '#818cf8', transition: 'all 150ms', alignSelf: 'flex-start' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.20)'; e.currentTarget.style.borderColor = '#818cf8'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.10)'; e.currentTarget.style.borderColor = 'rgba(99,102,241,0.3)'; }}
                  >
                    Tell Me More
                  </button>
                )}

                {/* Depth 2: Deep Dive Gate */}
                {msg.deepDiveDepth === 2 && (
                  <div style={{ padding: '10px 14px', background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.25)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#818cf8', lineHeight: 1.4 }}>
                      This is getting thorough. Want a full deep dive with sub-topics?
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => {
                          if (pttState !== 'idle' && pttState !== 'responded') return;
                          const topic = deepDiveState?.topic || '';
                          setDeepDiveState(prev => prev ? { ...prev, depth: 3 } : null);
                          const synth: Message = { id: `dd-${Date.now()}`, role: 'user', text: `Yes, deep dive on ${topic}`, ts: Date.now() };
                          setMessages(prev => [...prev, synth]);
                          setHistory(prev => [...prev, { role: 'user', content: `Give me a full deep dive on ${topic} with sub-topics to explore` }]);
                          chipPromptRef.current = `Give me a full deep dive on ${topic} with sub-topics to explore`;
                          setPttState('processing');
                        }}
                        style={{ flex: 1, padding: '6px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.4)', color: '#818cf8' }}
                      >Yes, Deep Dive</button>
                      <button
                        onClick={() => setDeepDiveState(null)}
                        style={{ flex: 1, padding: '6px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
                      >That's Enough</button>
                    </div>
                  </div>
                )}

                {/* Depth 3+: Keep Going + Sub-topic chips */}
                {msg.deepDiveDepth !== undefined && msg.deepDiveDepth >= 3 && (
                  <>
                    {/* Compile gate at depth 4+ */}
                    {msg.deepDiveDepth >= 4 && (
                      <div style={{ padding: '10px 14px', background: 'rgba(20,184,166,0.06)', border: '1px solid rgba(20,184,166,0.25)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#14b8a6', lineHeight: 1.4 }}>
                          That's a thorough briefing. Save to your Personal Encyclopedia?
                        </span>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            onClick={async () => {
                              if (!deepDiveState) return;
                              const turns = deepDiveState.turns;
                              try {
                                const compiled = await compileEncyclopediaArticle(deepDiveState.topic, turns);
                                await upsertEncyclopediaEntry({
                                  user_id: userId,
                                  topic: deepDiveState.topic,
                                  emoji: compiled.emoji,
                                  summary: compiled.summary,
                                  full_article: compiled.full_article,
                                  sections: compiled.sections,
                                  tags: compiled.tags,
                                  source_turns: turns.length,
                                });
                                const confirmMsg = `Compiled and saved to your encyclopedia. ${compiled.sections.length} sections, ${compiled.tags.length} tags. Over.`;
                                setMessages(prev => [...prev, { id: `enc-${Date.now()}`, role: 'roger', text: `📚 Saved "${deepDiveState.topic}" to your Personal Encyclopedia.`, ts: Date.now(), intent: 'ENCYCLOPEDIA_SAVE' }]);
                                speakResponse(confirmMsg).catch(() => {});
                              } catch {
                                speakResponse('Had trouble compiling that. Try again later. Over.').catch(() => {});
                              }
                              setDeepDiveState(null);
                            }}
                            style={{ flex: 1, padding: '6px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', background: 'rgba(20,184,166,0.12)', border: '1px solid rgba(20,184,166,0.4)', color: '#14b8a6' }}
                          >Save to Encyclopedia</button>
                          <button
                            onClick={() => setDeepDiveState(null)}
                            style={{ flex: 1, padding: '6px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
                          >Skip</button>
                        </div>
                      </div>
                    )}

                    {/* Keep Going button */}
                    <button
                      onClick={() => {
                        if (pttState !== 'idle' && pttState !== 'responded') return;
                        const topic = deepDiveState?.topic || '';
                        setDeepDiveState(prev => prev ? { ...prev, depth: prev.depth + 1, coverageSummary: prev.coverageSummary + '\n' + msg.text.slice(0, 200), turns: [...prev.turns, msg.text] } : null);
                        const synth: Message = { id: `dd-${Date.now()}`, role: 'user', text: `Keep going on ${topic}`, ts: Date.now() };
                        setMessages(prev => [...prev, synth]);
                        setHistory(prev => [...prev, { role: 'user', content: `Tell me more about ${topic}` }]);
                        chipPromptRef.current = `Tell me more about ${topic}`;
                        setPttState('processing');
                      }}
                      style={{ padding: '6px 14px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', background: 'rgba(99,102,241,0.10)', border: '1px solid rgba(99,102,241,0.3)', color: '#818cf8', transition: 'all 150ms', alignSelf: 'flex-start' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.20)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.10)'; }}
                    >Keep Going</button>

                    {/* Sub-topic chips */}
                    {msg.subtopics && msg.subtopics.length > 0 && (
                      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
                        {msg.subtopics.map((sub, i) => (
                          <button key={i}
                            onClick={() => {
                              if (pttState !== 'idle' && pttState !== 'responded') return;
                              const topic = deepDiveState?.topic || '';
                              setDeepDiveState(prev => prev ? { ...prev, depth: prev.depth + 1, coverageSummary: prev.coverageSummary + '\n' + msg.text.slice(0, 200), turns: [...prev.turns, msg.text] } : null);
                              const prompt = `Tell me about ${sub.emoji} ${sub.label} regarding ${topic}`;
                              const synth: Message = { id: `sub-${Date.now()}`, role: 'user', text: prompt, ts: Date.now() };
                              setMessages(prev => [...prev, synth]);
                              setHistory(prev => [...prev, { role: 'user', content: prompt }]);
                              chipPromptRef.current = prompt;
                              setPttState('processing');
                            }}
                            style={{ flexShrink: 0, padding: '4px 10px', fontFamily: 'monospace', fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.06em', border: '1px solid rgba(99,102,241,0.25)', background: 'rgba(99,102,241,0.06)', color: '#a5b4fc', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 150ms' }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = '#818cf8'; e.currentTarget.style.color = '#818cf8'; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.25)'; e.currentTarget.style.color = '#a5b4fc'; }}
                          >{sub.emoji} {sub.label}</button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Thinking indicator */}
        {(pttState === 'transcribing' || pttState === 'processing') && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              {[0,1,2].map(i => (
                <div key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: '#a78bfa', animation: `pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />
              ))}
            </div>
            <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.15em' }}>{stateLabel}</span>
          </div>
        )}
      </div>

      {/* ── Spotify Mini Player — renders when connected and playing ── */}
      <SpotifyMiniPlayer />
      <RadioMiniPlayer />

      {/* ── Morning Briefing ── */}
      {messages.length === 0 && <MorningBriefing userId={userId} location={location} />}

      {/* ── Quick Actions (tap to synthesise a voice command) ── */}
      {/* Radio chip added alongside existing quick actions */}
      <div style={{ padding: '8px 16px 0', display: 'flex', gap: 6, borderTop: '1px solid var(--border-subtle)', overflowX: 'auto', flexShrink: 0 }}>
        {([
          { label: 'My tasks',       prompt: 'What tasks do I have open right now?' },
          { label: 'Reminders',       prompt: 'What reminders do I have coming up?' },
          { label: 'Calendar',        prompt: "What's on my calendar today?" },
          { label: 'Radio',           prompt: 'Play some popular radio near me.' },
          { label: 'Memory',          prompt: 'What do you know about me?' },
          { label: 'News',            prompt: 'Give me a quick news briefing.' },
          { label: 'Markets',         prompt: 'Give me a market brief.' },
          { label: 'Uber',            prompt: 'Book me an Uber ride.' },
          { label: 'Reminders',       prompt: 'Reminders', isNav: true as const, tab: 'reminders' as UserTab },
        ] as { label: string; prompt?: string; isNav?: true; tab?: UserTab }[]).map((chip, i) => (
          <button key={i}
            onClick={() => {
              if (chip.isNav && chip.tab) { onTabChange(chip.tab); return; }
              if (!chip.prompt || pttState !== 'idle') return;
              // Inject prompt into history, then signal the chip-processing effect
              const syntheticMsg: Message = { id: `chip-${Date.now()}`, role: 'user', text: chip.prompt, ts: Date.now() };
              setMessages(prev => [...prev, syntheticMsg]);
              setHistory(prev => [...prev, { role: 'user', content: chip.prompt! }]);
              chipPromptRef.current = chip.prompt;
              setPttState('processing');
            }}
            style={{ flexShrink: 0, padding: '5px 11px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-muted)', cursor: pttState === 'idle' ? 'pointer' : 'default', opacity: pttState !== 'idle' ? 0.4 : 1, transition: 'all 150ms', whiteSpace: 'nowrap' }}
            onMouseEnter={e => { if (pttState === 'idle') (e.currentTarget.style.borderColor = 'rgba(212,160,68,0.4)', e.currentTarget.style.color = 'var(--amber)'); }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {/* ── PTT Button ── */}
      <div style={{
        padding: '24px 16px 32px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
        borderTop: '1px solid var(--border-subtle)',
        background: 'linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.5) 100%)',
        flexShrink: 0,
        position: 'relative',
      }}>
        <span style={{ fontFamily: 'monospace', fontSize: 10, color: btnColor, textTransform: 'uppercase', letterSpacing: '0.25em', transition: 'color 300ms', minHeight: 14 }}>
          {stateLabel}
        </span>

        {/* ── Mode Roll Selector (right side of PTT) ── */}
        {(() => {
          type RollMode = { key: string; iconName: string; label: string; color: string; roger: 'quiet' | 'active' | 'briefing'; talk: boolean; freq?: 'thoughtful' | 'active_talk' | 'always_on' };
          const modes: RollMode[] = [
            { key: 'quiet',      iconName: 'mode-quiet',     label: 'QRT',  color: '#6b7280', roger: 'quiet',    talk: false },
            { key: 'active',     iconName: 'mode-active',    label: 'ACT',  color: '#d4a044', roger: 'active',   talk: false },
            { key: 'briefing',   iconName: 'mode-briefing',  label: 'BRF',  color: '#a78bfa', roger: 'briefing', talk: false },
            { key: 'thoughtful', iconName: 'mode-thoughtful',label: 'THK',  color: '#f59e0b', roger: 'active',   talk: true, freq: 'thoughtful' },
            { key: 'chatty',     iconName: 'mode-chatty',    label: 'CHT',  color: '#ef8a33', roger: 'active',   talk: true, freq: 'active_talk' },
            { key: 'always_on',  iconName: 'mode-always-on', label: 'MAX',  color: '#ef4444', roger: 'active',   talk: true, freq: 'always_on' },
          ];
          let currentIdx = talkativeEnabled
            ? modes.findIndex(m => m.talk && m.freq === talkativeFreq)
            : modes.findIndex(m => !m.talk && m.roger === rogerMode);
          if (currentIdx < 0) currentIdx = 1;
          const current = modes[currentIdx];

          const cycleMode = () => {
            const nextIdx = (currentIdx + 1) % modes.length;
            const next = modes[nextIdx];
            // Update roger_mode
            setRogerMode(next.roger);
            // Update talkative
            setTalkativeEnabled(next.talk);
            if (next.freq) setTalkativeFreq(next.freq);
            if (!next.talk) setThinkingPulse(false);
            // Persist
            const update: Record<string, unknown> = {
              roger_mode: next.roger,
              talkative_enabled: next.talk,
            };
            if (next.freq) update.talkative_frequency = next.freq;
            supabase
              .from('user_preferences')
              .update(update)
              .eq('user_id', userId)
              .then(() => {});
          };

          return (
            <>
              <div
                id="mode-roll-selector"
                onClick={cycleMode}
                style={{
                  position: 'absolute',
                  right: 'max(12px, calc(50% - 140px))', top: '50%', transform: 'translateY(-50%)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                  cursor: 'pointer',
                  userSelect: 'none', WebkitUserSelect: 'none',
                }}
              >
                {/* Up arrow hint */}
                <div style={{
                  width: 0, height: 0,
                  borderLeft: '4px solid transparent', borderRight: '4px solid transparent',
                  borderBottom: `5px solid ${current.color}30`,
                  transition: 'border-color 300ms',
                }} />

                {/* Mode dial */}
                <div style={{
                  width: 48, height: 48,
                  borderRadius: '50%',
                  border: `1.5px solid ${current.color}60`,
                  background: `${current.color}10`,
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 1,
                  transition: 'all 300ms ease',
                  boxShadow: `0 0 14px ${current.color}18, inset 0 0 8px ${current.color}08`,
                }}>
                  <RogerIcon name={current.iconName} size={16} color={current.color} />
                  <span style={{
                    fontFamily: 'monospace', fontSize: 6,
                    color: current.color, textTransform: 'uppercase',
                    letterSpacing: '0.1em', fontWeight: 700,
                    lineHeight: 1,
                  }}>{current.label}</span>
                </div>

                {/* Down arrow hint */}
                <div style={{
                  width: 0, height: 0,
                  borderLeft: '4px solid transparent', borderRight: '4px solid transparent',
                  borderTop: `5px solid ${current.color}30`,
                  transition: 'border-color 300ms',
                }} />

                {/* Mode name below */}
                <span style={{
                  fontFamily: 'monospace', fontSize: 7,
                  color: `${current.color}90`,
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                  marginTop: 1,
                }}>
                  {current.key === 'quiet' ? 'Silent' : current.key === 'active' ? 'Active' : current.key === 'briefing' ? 'Brief' : current.key === 'thoughtful' ? 'Think' : current.key === 'chatty' ? 'Chatty' : 'Always'}
                </span>
              </div>
            </>
          );
        })()}

        {/* Sonar rings + button — touch target is the full outer area */}
        <div
          onPointerDown={handlePTTDown}
          onPointerUp={handlePTTUp}
          onPointerLeave={handlePTTUp}
          onPointerCancel={handlePTTUp}
          onContextMenu={e => e.preventDefault()}
          role="button"
          aria-label={isSpeaking ? 'Interrupt Roger' : 'Push to talk'}
          style={{
            position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 190, height: 190,
            padding: 24,            /* invisible touch padding — total hit area ~238px */
            margin: -24,            /* negative margin so padding doesn't shift layout */
            cursor: 'pointer',
            touchAction: 'none',
            userSelect: 'none', WebkitUserSelect: 'none',
          }}
        >
          {/* Idle breathing glow — subtle hero animation */}
          {(pttState === 'idle' || pttState === 'responded' || pttState === 'awaiting_answer') && !thinkingPulse && (
            <>
              <div style={{ position: 'absolute', width: 160, height: 160, borderRadius: '50%', border: `1.5px solid ${btnColor}`, opacity: 0.12, animation: 'pttBreathe 3s ease-in-out infinite' }} />
              <div style={{ position: 'absolute', width: 175, height: 175, borderRadius: '50%', border: `1px solid ${btnColor}`, opacity: 0.06, animation: 'pttBreathe 3s ease-in-out 1.5s infinite' }} />
            </>
          )}
          {/* Thinking pulse — pulsating red glow when Roger has a thought */}
          {thinkingPulse && (pttState === 'idle' || pttState === 'responded') && (
            <>
              <div style={{ position: 'absolute', width: 165, height: 165, borderRadius: '50%', border: '2px solid #ef4444', opacity: 0.5, animation: 'thinkingRedPulse 1.2s ease-in-out infinite' }} />
              <div style={{ position: 'absolute', width: 185, height: 185, borderRadius: '50%', border: '1.5px solid #ef4444', opacity: 0.25, animation: 'thinkingRedPulse 1.2s ease-in-out 0.4s infinite' }} />
              <div style={{ position: 'absolute', width: 155, height: 155, borderRadius: '50%', background: 'rgba(239,68,68,0.08)', animation: 'thinkingRedPulse 1.2s ease-in-out 0.2s infinite' }} />
            </>
          )}
          {/* Sonar rings */}
          {pttState === 'recording' && (
            <>
              <div style={{ position: 'absolute', width: 190, height: 190, borderRadius: '50%', border: `2px solid ${btnColor}`, opacity: 0, animation: 'sonar 1.6s ease-out infinite' }} />
              <div style={{ position: 'absolute', width: 190, height: 190, borderRadius: '50%', border: `2px solid ${btnColor}`, opacity: 0, animation: 'sonar 1.6s ease-out 0.5s infinite' }} />
              <div style={{ position: 'absolute', width: 190, height: 190, borderRadius: '50%', border: `1.5px solid ${btnColor}`, opacity: 0, animation: 'sonar 1.6s ease-out 1.0s infinite' }} />
            </>
          )}
          {/* Speaking pulse */}
          {(pttState === 'speaking') && (
            <div style={{ position: 'absolute', width: 168, height: 168, borderRadius: '50%', background: `${btnColor}18`, animation: 'pulse 1.2s ease-in-out infinite' }} />
          )}
          <div
            style={{
              width: 140, height: 140, borderRadius: '50%',
              border: `3px solid ${thinkingPulse ? '#ef4444' : btnColor}`,
              background: pttState === 'recording'
                ? `radial-gradient(circle at 40% 40%, ${btnColor}40 0%, ${btnColor}15 60%, transparent 100%)`
                : pttState === 'speaking' ? `radial-gradient(circle, ${btnColor}20 0%, ${btnColor}08 100%)`
                : `radial-gradient(circle at 40% 40%, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.01) 100%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'border-color 250ms, background 250ms, box-shadow 350ms, transform 200ms',
              transform: pttState === 'recording' ? 'scale(1.05)' : 'scale(1)',
              boxShadow: pttState === 'recording'
                ? `0 0 60px ${btnColor}66, 0 0 24px ${btnColor}44, inset 0 0 28px ${btnColor}1a`
                : pttState === 'speaking' ? `0 0 36px ${btnColor}44, 0 0 12px ${btnColor}22`
                : `0 0 24px ${btnColor}20, 0 0 8px ${btnColor}10`,
              animation: (pttState === 'idle' || pttState === 'responded') ? (thinkingPulse ? 'thinkingGlow 1.2s ease-in-out infinite' : 'pttGlow 3s ease-in-out infinite') : 'none',
              pointerEvents: 'none',  /* visual only — parent handles events */
            }}
          >
            {pttState === 'speaking' ? <Square size={32} style={{ color: btnColor, transition: 'color 250ms' }} /> : <Radio size={44} style={{ color: btnColor, transition: 'color 250ms', filter: `drop-shadow(0 0 6px ${btnColor}44)` }} />}
          </div>
        </div>

        {/* Speaking waveform bars */}
        {pttState === 'speaking' && (
          <div style={{ display: 'flex', gap: 3, alignItems: 'center', height: 20 }}>
            {[0.4,0.7,1,0.8,0.5,0.9,0.6,1,0.7,0.4].map((h,i) => (
              <div key={i} style={{ width: 3, borderRadius: 2, background: btnColor, opacity: 0.7, height: `${h*18}px`, animation: `pulse ${0.8+i*0.07}s ease-in-out infinite` }} />
            ))}
          </div>
        )}

        {/* PTT Rank Badge */}
        {(() => {
          const totalTx = messages.filter(m => m.role === 'user').length;
          const rank = getPTTRank(totalTx);
          return (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 12px',
              borderRadius: 20,
              border: `1px solid ${rank.color}30`,
              background: `${rank.color}0a`,
              animation: 'rankPulse 3s ease-in-out infinite',
            }}>
              {rank.image ? (
                <img src={rank.image} alt={rank.label} style={{ width: 24, height: 24, objectFit: 'contain', filter: `drop-shadow(0 0 4px ${rank.color}44)` }} />
              ) : (
                <span style={{ fontSize: 12 }}>{rank.icon}</span>
              )}
              <span style={{
                fontFamily: 'monospace', fontSize: 9,
                color: rank.color, textTransform: 'uppercase',
                letterSpacing: '0.15em', fontWeight: 700,
              }}>
                {rank.label}
              </span>
            </div>
          );
        })()}

        {/* ── Talkative Mode Dial (left side, mirrors Mode Roll on right) ── */}
        {(() => {
          const talkColor = talkativeEnabled ? '#efa133' : '#6b7280';
          return (
            <div
              id="talkative-quick-toggle"
              onClick={() => {
                const next = !talkativeEnabled;
                setTalkativeEnabled(next);
                setThinkingPulse(false);
                supabase
                  .from('user_preferences')
                  .update({ talkative_enabled: next })
                  .eq('user_id', userId)
                  .then(() => {});
              }}
              style={{
                position: 'absolute',
                left: 'max(12px, calc(50% - 140px))', top: '50%', transform: 'translateY(-50%)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                cursor: 'pointer',
                userSelect: 'none', WebkitUserSelect: 'none',
              }}
            >
              {/* Up arrow hint */}
              <div style={{
                width: 0, height: 0,
                borderLeft: '4px solid transparent', borderRight: '4px solid transparent',
                borderBottom: `5px solid ${talkColor}30`,
                transition: 'border-color 300ms',
              }} />

              {/* Dial circle */}
              <div style={{
                width: 48, height: 48,
                borderRadius: '50%',
                border: `1.5px solid ${talkColor}60`,
                background: `${talkColor}10`,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 1,
                transition: 'all 300ms ease',
                boxShadow: talkativeEnabled
                  ? `0 0 14px ${talkColor}30, inset 0 0 8px ${talkColor}12`
                  : `0 0 14px ${talkColor}18, inset 0 0 8px ${talkColor}08`,
                animation: talkativeEnabled ? 'thinkingPulse 2.5s ease-in-out infinite' : 'none',
              }}>
                <span style={{
                  fontSize: 16, lineHeight: 1,
                  filter: talkativeEnabled ? `drop-shadow(0 0 6px ${talkColor}80)` : 'none',
                  transition: 'filter 300ms',
                }}>AI</span>
                <span style={{
                  fontFamily: 'monospace', fontSize: 6,
                  color: talkColor, textTransform: 'uppercase',
                  letterSpacing: '0.1em', fontWeight: 700,
                  lineHeight: 1,
                }}>{talkativeEnabled ? 'ON' : 'OFF'}</span>
              </div>

              {/* Down arrow hint */}
              <div style={{
                width: 0, height: 0,
                borderLeft: '4px solid transparent', borderRight: '4px solid transparent',
                borderTop: `5px solid ${talkColor}30`,
                transition: 'border-color 300ms',
              }} />

              {/* Label below */}
              <span style={{
                fontFamily: 'monospace', fontSize: 7,
                color: `${talkColor}90`,
                textTransform: 'uppercase', letterSpacing: '0.08em',
                marginTop: 1,
              }}>
                {talkativeEnabled ? 'Think' : 'Silent'}
              </span>
            </div>
          );
        })()}
      </div>

      {/* Sonar keyframe */}
      <style>{`
        @keyframes sonar {
          0%   { transform: scale(0.7); opacity: 0.8; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        @keyframes pttBreathe {
          0%, 100% { transform: scale(1); opacity: 0.06; }
          50%      { transform: scale(1.1); opacity: 0.2; }
        }
        @keyframes pttGlow {
          0%, 100% { box-shadow: 0 0 24px ${btnColor}20, 0 0 8px ${btnColor}10; }
          50%      { box-shadow: 0 0 40px ${btnColor}38, 0 0 16px ${btnColor}28; }
        }
        @keyframes badgeEnter {
          0%   { transform: scale(0.3) rotate(-12deg); opacity: 0; }
          50%  { transform: scale(1.08) rotate(2deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes badgeBurst {
          0%   { transform: scale(0.5); opacity: 0.9; }
          100% { transform: scale(3.5); opacity: 0; }
        }
        @keyframes badgeShimmer {
          0%, 100% { opacity: 0.4; }
          50%      { opacity: 1; }
        }
        @keyframes badgeFadeOut {
          0%   { opacity: 1; }
          100% { opacity: 0; transform: scale(0.9) translateY(-20px); }
        }
        @keyframes rankPulse {
          0%, 100% { opacity: 0.5; }
          50%      { opacity: 0.9; }
        }
        @keyframes thinkingRedPulse {
          0%, 100% { transform: scale(1); opacity: 0.15; }
          50%      { transform: scale(1.12); opacity: 0.55; }
        }
        @keyframes thinkingGlow {
          0%, 100% { box-shadow: 0 0 24px rgba(239,68,68,0.15), 0 0 8px rgba(239,68,68,0.1); }
          50%      { box-shadow: 0 0 50px rgba(239,68,68,0.4), 0 0 20px rgba(239,68,68,0.3); }
        }
        @keyframes thinkingPulse {
          0%, 100% { background: rgba(239,161,51,0.06); border-color: rgba(239,161,51,0.3); }
          50%      { background: rgba(239,161,51,0.14); border-color: rgba(239,161,51,0.55); }
        }
      `}</style>

      {/* ── Badge Celebration Overlay ── */}
      {activeBadge && (
        <div
          onClick={() => setActiveBadge(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 0,
            background: 'rgba(0,0,0,0.85)',
            backdropFilter: 'blur(12px)',
            animation: 'fadeIn 300ms ease-out',
            cursor: 'pointer',
          }}
        >
          {/* Radial burst rings */}
          <div style={{ position: 'absolute', width: 200, height: 200, borderRadius: '50%', border: `2px solid ${activeBadge.color}`, opacity: 0, animation: 'badgeBurst 1.2s ease-out forwards' }} />
          <div style={{ position: 'absolute', width: 200, height: 200, borderRadius: '50%', border: `1.5px solid ${activeBadge.color}`, opacity: 0, animation: 'badgeBurst 1.2s ease-out 0.2s forwards' }} />
          <div style={{ position: 'absolute', width: 200, height: 200, borderRadius: '50%', border: `1px solid ${activeBadge.color}`, opacity: 0, animation: 'badgeBurst 1.2s ease-out 0.4s forwards' }} />

          {/* Badge image */}
          <img
            src={activeBadge.image}
            alt={activeBadge.title}
            style={{
              width: 180, height: 180,
              objectFit: 'contain',
              animation: 'badgeEnter 600ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
              filter: `drop-shadow(0 0 40px ${activeBadge.glow})`,
              marginBottom: 16,
            }}
          />

          {/* Glow ring behind badge */}
          <div style={{
            position: 'absolute',
            width: 200, height: 200, borderRadius: '50%',
            background: `radial-gradient(circle, ${activeBadge.glow} 0%, transparent 70%)`,
            animation: 'badgeShimmer 2s ease-in-out infinite',
            marginTop: -80,
            pointerEvents: 'none',
          }} />

          {/* Title */}
          <div style={{
            fontFamily: 'monospace', fontSize: 22, fontWeight: 800,
            color: activeBadge.color, textTransform: 'uppercase',
            letterSpacing: '0.15em',
            animation: 'badgeEnter 600ms cubic-bezier(0.34, 1.56, 0.64, 1) 200ms both',
            textShadow: `0 0 20px ${activeBadge.glow}`,
            textAlign: 'center', padding: '0 24px', maxWidth: '100%',
          }}>
            {activeBadge.title}
          </div>

          {/* Subtitle */}
          <div style={{
            fontFamily: 'monospace', fontSize: 12,
            color: 'rgba(255,255,255,0.5)',
            textTransform: 'uppercase', letterSpacing: '0.2em',
            marginTop: 8,
            animation: 'badgeEnter 600ms cubic-bezier(0.34, 1.56, 0.64, 1) 400ms both',
            textAlign: 'center', padding: '0 24px', maxWidth: '100%',
          }}>
            {activeBadge.subtitle}
          </div>

          {/* Dismiss hint */}
          <div style={{
            position: 'absolute', bottom: 40,
            fontFamily: 'monospace', fontSize: 9,
            color: 'rgba(255,255,255,0.2)',
            textTransform: 'uppercase', letterSpacing: '0.2em',
            animation: 'badgeShimmer 2s ease-in-out 1s infinite',
          }}>
            TAP TO DISMISS
          </div>
        </div>
      )}
    </div>
  );
}
