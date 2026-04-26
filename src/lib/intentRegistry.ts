// ─── Roger AI — Intent Registry ─────────────────────────────────────────────
// Declarative dispatch system replacing the 42-branch if/else chain in UserHome.
// Each intent is a self-contained handler object with service dependencies,
// confirmation gates, and fallback routing.

import type { ServiceId } from './serviceGraph';
import { getServiceGraph } from './serviceGraph';
import type { RogerAIResponse } from './openai';
import { speakResponse } from './tts';
import { useIntentStore } from './intentStore';
import type { PendingAction } from './intentStore';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IntentContext {
  result: RogerAIResponse;
  transcript: string;
  userId: string;
  sessionId: string;
  location: { latitude: number; longitude: number } | null;
  preferences: Record<string, unknown> | null;
  isTest: boolean;

  // Helpers
  entity: (type: string) => string | null;
  entities: (type: string) => Array<{ type: string; text: string; confidence: number }>;
  speak: (msg: string) => Promise<void>;
  addMessage: (msg: { id: string; role: 'roger'; text: string; ts: number; intent: string; outcome: string }) => void;
  setPendingAction: (action: PendingAction | null) => void;

  // Tune In state (passed from component refs)
  tuneIn: {
    incomingRequest: { requestId: string; from: string; callsign: string; reason: string | null; expiresAt: string } | null;
    activeSession: { sessionId: string; withName: string } | null;
  };

  // Ambient/Meeting refs (passed from component)
  ambient: {
    active: boolean;
    lastChunk: unknown;
    sessionRef: { current: unknown };
  };
  meeting: {
    active: boolean;
    recorderRef: { current: unknown };
  };
}

export interface IntentHandler {
  /** Intent name(s) this handler covers */
  intent: string | string[];

  /** Services that must be available (checked via circuit breaker) */
  requiredServices: ServiceId[];

  /** If true, user must confirm before execute() runs */
  confirmationGate?: boolean;

  /** Generates the confirmation prompt label */
  confirmationLabel?: (result: RogerAIResponse, transcript: string) => string;

  /** Main execution logic — extracted from UserHome if/else branches */
  execute: (ctx: IntentContext) => Promise<void>;

  /** Runs when a required service is blocked (circuit open / unconfigured) */
  fallback?: (ctx: IntentContext) => Promise<void>;
}

// ─── Shared Helpers ──────────────────────────────────────────────────────────

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/** Shared auth header builder — eliminates 10+ redeclarations in UserHome */
export async function getSupabaseHeaders(): Promise<Record<string, string>> {
  const { supabase } = await import('./supabase');
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? SUPABASE_ANON_KEY;
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
}

/** Shared Tune In edge function caller — eliminates 300+ lines of boilerplate */
export async function tuneInFetch(endpoint: string, body: object): Promise<Record<string, unknown>> {
  const headers = await getSupabaseHeaders();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${endpoint}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

/** Build an IntentContext from raw parameters */
export function buildIntentContext(params: {
  result: RogerAIResponse;
  transcript: string;
  userId: string;
  sessionId: string;
  location: { latitude: number; longitude: number } | null;
  preferences: Record<string, unknown> | null;
  isTest: boolean;
  tuneIn: IntentContext['tuneIn'];
  ambient: IntentContext['ambient'];
  meeting: IntentContext['meeting'];
}): IntentContext {
  const store = useIntentStore.getState();

  return {
    ...params,
    entity: (type: string) => {
      const e = params.result.entities?.find(ent => ent.type === type);
      return e?.text ?? null;
    },
    entities: (type: string) => {
      return (params.result.entities ?? []).filter(ent => ent.type === type);
    },
    speak: (msg: string) => speakResponse(msg),
    addMessage: (msg) => store.addMessage(msg),
    setPendingAction: (action) => store.setPendingAction(action),
  };
}

// ─── Registry Engine ─────────────────────────────────────────────────────────

class IntentRegistryImpl {
  private handlers: Map<string, IntentHandler> = new Map();
  private prefixHandlers: Array<{ prefix: string; handler: IntentHandler }> = [];

  /** Register a handler for one or more intents */
  register(handler: IntentHandler): void {
    const intents = Array.isArray(handler.intent) ? handler.intent : [handler.intent];
    for (const intent of intents) {
      if (intent.endsWith('*')) {
        // Prefix match — e.g., 'ACADEMY_*' matches ACADEMY_START, ACADEMY_LESSON, etc.
        this.prefixHandlers.push({ prefix: intent.slice(0, -1), handler });
      } else {
        this.handlers.set(intent, handler);
      }
    }
  }

  /** Look up a handler for a given intent */
  lookup(intent: string): IntentHandler | null {
    // Exact match first
    const exact = this.handlers.get(intent);
    if (exact) return exact;

    // Prefix match
    for (const { prefix, handler } of this.prefixHandlers) {
      if (intent.startsWith(prefix)) return handler;
    }

    return null;
  }

  /** Dispatch an intent through the registry with circuit breaker checks */
  async dispatch(result: RogerAIResponse, ctx: IntentContext): Promise<boolean> {
    const handler = this.lookup(result.intent);
    if (!handler) return false; // No handler — caller should fall through

    const graph = getServiceGraph();

    // Check service requirements
    const blocked = handler.requiredServices.filter(s => graph.isBlocked(s));
    if (blocked.length > 0) {
      if (handler.fallback) {
        await handler.fallback(ctx);
      } else {
        const names = blocked.map(s => graph.getDisplayName(s)).join(', ');
        await ctx.speak(`${names} not available right now. Check Settings. Over.`);
      }
      return true;
    }

    // Confirmation gate
    if (handler.confirmationGate) {
      const label = handler.confirmationLabel?.(result, ctx.transcript)
        ?? `Execute ${result.intent}? Over.`;
      ctx.setPendingAction({
        type: 'task',
        label,
        execute: () => { handler.execute(ctx).catch(err => console.error('[Registry] Handler error:', err)); },
      });
      return true;
    }

    // Direct execution
    try {
      await handler.execute(ctx);
      // Report success to service graph
      for (const s of handler.requiredServices) {
        graph.reportSuccess(s);
      }
    } catch (err) {
      // Report failure to service graph
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      for (const s of handler.requiredServices) {
        graph.reportFailure(s, errMsg);
      }
      await ctx.speak(`Something went wrong: ${errMsg}. Over.`);
    }

    return true;
  }

  /** Get count of registered handlers */
  get size(): number {
    return this.handlers.size + this.prefixHandlers.length;
  }

  /** List all registered intent names */
  listIntents(): string[] {
    return [
      ...Array.from(this.handlers.keys()),
      ...this.prefixHandlers.map(p => p.prefix + '*'),
    ];
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _registry: IntentRegistryImpl | null = null;

export function getIntentRegistry(): IntentRegistryImpl {
  if (!_registry) {
    _registry = new IntentRegistryImpl();
    registerAllHandlers(_registry);
  }
  return _registry;
}

export type { IntentRegistryImpl as IntentRegistry };

// ─── Handler Registration ────────────────────────────────────────────────────
// Handlers are registered in groups below. Each group is a self-contained batch.

function registerAllHandlers(r: IntentRegistryImpl): void {
  registerCoreHandlers(r);
  registerCalendarHandlers(r);
  registerMediaHandlers(r);
  registerTuneInHandlers(r);
  registerRemainingHandlers(r);
}

// ── Batch A: Core Services ──────────────────────────────────────────────────

function registerCoreHandlers(r: IntentRegistryImpl): void {
  // ── CREATE_REMINDER ─────────────────────────────────────────────────────
  r.register({
    intent: 'CREATE_REMINDER',
    requiredServices: ['supabase'],
    confirmationGate: true,
    confirmationLabel: (result, transcript) => {
      const loc = result.entities?.find(e => e.type === 'LOCATION' || e.type === 'PLACE');
      const time = result.entities?.find(e => e.type === 'TIME' || e.type === 'DATE' || e.type === 'MEETING_TIME');
      return `Set reminder: "${transcript.slice(0, 60)}"${time ? ` at ${time.text}` : ''}${loc ? ` near ${loc.text}` : ''}. Confirm? Over.`;
    },
    async execute(ctx) {
      const { insertReminder } = await import('./api');
      const { geocodePlace } = await import('./geoFence');
      const { supabase } = await import('./supabase');
      const loc = ctx.entity('LOCATION') ?? ctx.entity('PLACE');
      await insertReminder({
        user_id: ctx.userId, text: ctx.transcript, entities: ctx.result.entities ?? null,
        due_at: null, status: 'pending', source_tx_id: null, is_admin_test: ctx.isTest,
        due_location: loc, due_location_lat: null, due_location_lng: null,
        due_radius_m: 300, geo_triggered: false,
      });
      window.dispatchEvent(new CustomEvent('roger:refresh'));
      if (loc && ctx.location) {
        const coords = await geocodePlace(loc, ctx.location.latitude, ctx.location.longitude).catch(() => null);
        if (coords) {
          await supabase.from('reminders').update({ due_location: loc, due_location_lat: coords.lat, due_location_lng: coords.lng })
            .eq('user_id', ctx.userId).eq('status', 'pending').order('created_at', { ascending: false }).limit(1);
        }
      }
    },
  });

  // ── SMART_HOME_CONTROL ──────────────────────────────────────────────────
  r.register({
    intent: 'SMART_HOME_CONTROL',
    requiredServices: ['tuya'],
    confirmationGate: true,
    confirmationLabel: (result) => `Smart home: ${result.roger_response.replace(/ Over\.$/, '')}. Execute? Over.`,
    async execute(ctx) {
      const { listTuyaDevices, matchDevice, inferCommand, controlDevice } = await import('./tuya');
      const uid = ctx.preferences?.tuya_uid as string | undefined;
      if (!uid) { await ctx.speak('Tuya not connected. Set up in Settings. Over.'); return; }
      const devices = await listTuyaDevices(uid);
      const deviceLabel = ctx.entity('SMART_DEVICE') ?? 'device';
      const matched = matchDevice(deviceLabel, devices);
      if (!matched) { await ctx.speak(`Could not find "${deviceLabel}" in your devices. Over.`); return; }
      const value = ctx.entity('DEVICE_VALUE');
      const action = ctx.entity('DEVICE_ACTION');
      const cmd = inferCommand(ctx.result.intent, matched.category, value ? (isNaN(Number(value)) ? value : Number(value)) : undefined, action);
      if (!cmd) { await ctx.speak('Unable to determine command. Over.'); return; }
      await controlDevice(matched.id, [cmd]);
      await ctx.speak(`Done. ${matched.name} ${cmd.value === true ? 'on' : cmd.value === false ? 'off' : 'updated'}. Over.`);
    },
  });

  // ── SMART_HOME_SCENE ────────────────────────────────────────────────────
  r.register({
    intent: 'SMART_HOME_SCENE',
    requiredServices: ['tuya'],
    confirmationGate: true,
    confirmationLabel: (result) => {
      const scene = result.entities?.find(e => e.type === 'SCENE_NAME');
      return `Run scene "${scene?.text ?? 'scene'}"? Over.`;
    },
    async execute(ctx) {
      const { listTuyaDevices, listTuyaScenes, matchScene, triggerTuyaScene } = await import('./tuya');
      const uid = ctx.preferences?.tuya_uid as string | undefined;
      if (!uid) { await ctx.speak('Tuya not connected. Set up in Settings. Over.'); return; }
      const devices = await listTuyaDevices(uid);
      if (devices.length === 0) { await ctx.speak('No homes found. Over.'); return; }
      const homeId = String(devices[0].home_id);
      const scenes = await listTuyaScenes(homeId);
      const sceneName = ctx.entity('SCENE_NAME') ?? 'scene';
      const matched = matchScene(sceneName, scenes);
      if (!matched) { await ctx.speak(`Could not find scene "${sceneName}". Over.`); return; }
      await triggerTuyaScene(homeId, matched.scene_id);
      await ctx.speak(`Scene "${matched.name}" triggered. Over.`);
    },
  });

  // ── SMART_HOME_QUERY ────────────────────────────────────────────────────
  r.register({
    intent: 'SMART_HOME_QUERY',
    requiredServices: ['tuya'],
    async execute(ctx) {
      const { listTuyaDevices, matchDevice, getDeviceStatus } = await import('./tuya');
      const uid = ctx.preferences?.tuya_uid as string | undefined;
      if (!uid) return;
      const deviceLabel = ctx.entity('SMART_DEVICE');
      if (!deviceLabel) return;
      const devices = await listTuyaDevices(uid);
      const matched = matchDevice(deviceLabel, devices);
      if (!matched) return;
      const status = await getDeviceStatus(matched.id);
      console.log('[SmartHome] Device status:', matched.name, status);
      // GPT response already covers the query — this is supplementary data
    },
  });

  // ── QUERY_STOCK / MARKET_BRIEF ──────────────────────────────────────────
  r.register({
    intent: ['QUERY_STOCK', 'MARKET_BRIEF'],
    requiredServices: ['finnhub'],
    async execute(ctx) {
      const { fetchQuote, quoteToSpeech, fetchMarketContext } = await import('./finance');
      const ticker = ctx.entity('STOCK_TICKER');

      if (ctx.result.intent === 'MARKET_BRIEF' || !ticker) {
        const mktCtx = await fetchMarketContext(['AAPL', 'MSFT', 'NVDA', 'TSLA']);
        await ctx.speak(mktCtx ? `Market brief: ${mktCtx}. Over.` : 'Market data unavailable at this time. Over.');
      } else {
        const quote = await fetchQuote(ticker);
        if (quote) {
          ctx.addMessage({
            id: `stock-${Date.now()}`, role: 'roger',
            text: `📈 ${quote.ticker} · $${quote.price} · ${quote.changePct >= 0 ? '▲' : '▼'}${Math.abs(quote.changePct).toFixed(2)}%`,
            ts: Date.now(), intent: ctx.result.intent, outcome: 'success',
          });
        }
        await ctx.speak(quote ? quoteToSpeech(quote) : `Could not retrieve ${ticker} data right now. Over.`);
      }
    },
  });

  // ── QUERY_FLIGHT ────────────────────────────────────────────────────────
  r.register({
    intent: 'QUERY_FLIGHT',
    requiredServices: ['aviationstack'],
    async execute(ctx) {
      const { fetchFlightStatus, flightToSpeech } = await import('./flight');
      const flightNum = ctx.entity('FLIGHT_NUMBER');
      if (!flightNum) return;
      try {
        const flight = await fetchFlightStatus(flightNum);
        if (flight) {
          const emoji: Record<string, string> = { scheduled:'🕐', active:'✈️', landed:'🛬', cancelled:'❌', incident:'⚠️', diverted:'🔀', unknown:'❓' };
          ctx.addMessage({
            id: `flight-${Date.now()}`, role: 'roger',
            text: `${emoji[flight.status] ?? '✈️'} ${flight.flightNumber} · ${flight.airline} · ${flight.status.toUpperCase()}${flight.delayMinutes ? ` · +${flight.delayMinutes}min` : ''}`,
            ts: Date.now(), intent: ctx.result.intent, outcome: 'success',
          });
          await ctx.speak(flightToSpeech(flight));
        } else {
          await ctx.speak(`Could not find status for flight ${flightNum}. Over.`);
        }
      } catch {
        await ctx.speak('Flight tracking unavailable. Check your AviationStack API key. Over.');
      }
    },
  });

  // ── SEND_SMS (Twilio) ───────────────────────────────────────────────────
  r.register({
    intent: 'SEND_SMS',
    requiredServices: ['twilio'],
    async execute(ctx) {
      const recipient = ctx.entity('RELAY_RECIPIENT') ?? ctx.entity('PHONE_NUMBER');
      const content = ctx.entity('RELAY_CONTENT') ?? ctx.transcript.replace(/text|sms|message|send to/gi, '').trim();
      if (!recipient || !content) return;

      const { supabase: sb } = await import('./supabase');
      const { data: contact } = await sb.from('roger_contacts')
        .select('display_name, phone_number')
        .ilike('display_name', `%${recipient}%`)
        .eq('user_id', ctx.userId)
        .maybeSingle();

      const phone = contact?.phone_number ?? (ctx.entities('PHONE_NUMBER').length > 0 ? recipient : null);
      if (!phone) {
        await ctx.speak(`${recipient} doesn't have a phone number saved. Add it in your Memory Vault. Over.`);
        return;
      }

      const headers = await getSupabaseHeaders();
      const smsRes = await fetch(`${SUPABASE_URL}/functions/v1/twilio-sms`, {
        method: 'POST', headers, body: JSON.stringify({ to: phone, message: content }),
      });
      const smsData = await smsRes.json() as { ok?: boolean; error?: string };
      await ctx.speak(smsData.ok
        ? `SMS sent to ${contact?.display_name ?? recipient}. Over.`
        : `SMS failed: ${smsData.error ?? 'unknown error'}. Over.`);
    },
  });

  // ── LOG_TO_NOTION ───────────────────────────────────────────────────────
  r.register({
    intent: 'LOG_TO_NOTION',
    requiredServices: ['notion'],
    async execute(ctx) {
      const { pushTaskToNotion } = await import('./notion');
      const page = await pushTaskToNotion(ctx.userId, {
        title: ctx.transcript,
        priority: 5,
        tags: [ctx.result.intent, ...(ctx.result.entities?.map(e => e.text) ?? [])],
      });
      await ctx.speak(page ? 'Logged to Notion. Over.' : 'Notion not connected. Add your token in Settings. Over.');
    },
  });
}

// ── Batch B: Calendar + Communication ───────────────────────────────────────

function registerCalendarHandlers(r: IntentRegistryImpl): void {
  // ── CHECK_CALENDAR / FIND_FREE_SLOT ─────────────────────────────────────
  r.register({
    intent: ['CHECK_CALENDAR', 'FIND_FREE_SLOT'],
    requiredServices: ['gcal'],
    async execute(ctx) {
      const { fetchTodayEvents, eventToSpeech } = await import('./googleCalendar');
      try {
        const cal = await fetchTodayEvents(ctx.userId);
        if (!cal.events.length) {
          await ctx.speak('Your calendar is clear today. Over.'); return;
        }
        const summary = cal.events.slice(0, 3).map(eventToSpeech).join(', then ');
        ctx.addMessage({
          id: `cal-${Date.now()}`, role: 'roger',
          text: `📅 ${cal.events.length} events today`,
          ts: Date.now(), intent: ctx.result.intent, outcome: 'success',
        });
        await ctx.speak(`You have ${cal.events.length} event${cal.events.length > 1 ? 's' : ''} today. ${summary}. Over.`);
      } catch {
        await ctx.speak('Calendar not connected. Go to Settings to link your Google Calendar. Over.');
      }
    },
  });

  // ── BOOK_MEETING ────────────────────────────────────────────────────────
  r.register({
    intent: 'BOOK_MEETING',
    requiredServices: ['gcal'],
    async execute(ctx) {
      const { createCalendarEvent } = await import('./googleCalendar');
      const title = ctx.entity('MEETING_TITLE') ?? 'Meeting';
      const timeText = ctx.entity('MEETING_TIME');
      if (!timeText) return;

      const now = new Date();
      const hourMatch = timeText.match(/(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
      let startIso = now.toISOString();
      if (hourMatch) {
        let hour = parseInt(hourMatch[1], 10);
        const min = parseInt(hourMatch[2] ?? '0', 10);
        const ampm = hourMatch[3]?.toLowerCase();
        if (ampm === 'pm' && hour < 12) hour += 12;
        if (ampm === 'am' && hour === 12) hour = 0;
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, min);
        if (timeText.toLowerCase().includes('tomorrow')) start.setDate(start.getDate() + 1);
        startIso = start.toISOString();
      }
      const endIso = new Date(new Date(startIso).getTime() + 60 * 60 * 1000).toISOString();

      ctx.setPendingAction({
        type: 'meeting',
        label: `Book "${title}" at ${timeText}. Confirm? Over.`,
        execute: () => {
          createCalendarEvent(ctx.userId, { title, startIso, endIso }).then(() => {
            ctx.speak(`${title} booked at ${timeText}. Done. Over.`);
          }).catch(() => {
            ctx.speak('Could not book meeting. Calendar not connected. Over.');
          });
        },
      });
    },
  });

  // ── CANCEL_MEETING ──────────────────────────────────────────────────────
  r.register({
    intent: 'CANCEL_MEETING',
    requiredServices: ['gcal'],
    async execute(ctx) {
      const { deleteCalendarEvent } = await import('./googleCalendar');
      const title = ctx.entity('MEETING_TITLE');
      if (!title) return;
      const ok = await deleteCalendarEvent(ctx.userId, title);
      await ctx.speak(ok ? `${title} cancelled. Over.` : 'Could not find that meeting to cancel. Over.');
    },
  });

  // ── PHONE_CALL / CALL_CONTACT ───────────────────────────────────────────
  r.register({
    intent: ['PHONE_CALL', 'CALL_CONTACT'],
    requiredServices: ['contacts'],
    async execute(ctx) {
      const { fetchDeviceContacts, resolveContactByName, getPhoneNumber } = await import('./deviceContacts');
      const contactName = ctx.entity('PERSON') ?? '';
      if (!contactName) return;
      const contacts = await fetchDeviceContacts();
      const matches = resolveContactByName(contactName, contacts);
      const match = matches[0];
      if (!match) { await ctx.speak(`Could not find ${contactName} in your contacts. Over.`); return; }
      const phone = getPhoneNumber(match);
      if (!phone) { await ctx.speak(`${match.displayName ?? contactName} has no phone number. Over.`); return; }
      window.open(`tel:${phone}`, '_system');
      ctx.addMessage({
        id: `call-${Date.now()}`, role: 'roger',
        text: `📞 Calling ${match.displayName ?? contactName}`,
        ts: Date.now(), intent: ctx.result.intent, outcome: 'success',
      });
    },
  });

  // ── WHATSAPP_SEND / WHATSAPP_MESSAGE ────────────────────────────────────
  r.register({
    intent: ['WHATSAPP_SEND', 'WHATSAPP_MESSAGE'],
    requiredServices: ['contacts'],
    async execute(ctx) {
      const { fetchDeviceContacts, resolveContactByName, getPhoneNumber } = await import('./deviceContacts');
      const contactName = ctx.entity('PERSON') ?? '';
      const msgBody = ctx.entity('MESSAGE_BODY') ?? ctx.entity('MESSAGE') ?? ctx.transcript;
      if (!contactName) return;
      const contacts = await fetchDeviceContacts();
      const matches = resolveContactByName(contactName, contacts);
      const match = matches[0];
      if (!match) { await ctx.speak(`Could not find ${contactName}. Over.`); return; }
      const phone = getPhoneNumber(match);
      if (!phone) { await ctx.speak(`${match.displayName ?? contactName} has no phone number. Over.`); return; }
      const clean = phone.replace(/[^+\d]/g, '');
      const encoded = encodeURIComponent(msgBody);
      window.open(`https://wa.me/${clean}?text=${encoded}`, '_blank', 'noopener');
      ctx.addMessage({
        id: `wa-${Date.now()}`, role: 'roger',
        text: `💬 Opening WhatsApp to ${match.displayName ?? contactName}`,
        ts: Date.now(), intent: ctx.result.intent, outcome: 'success',
      });
    },
  });

  // ── BOOK_RIDE / OPEN_UBER ───────────────────────────────────────────────
  r.register({
    intent: ['BOOK_RIDE', 'OPEN_UBER'],
    requiredServices: [],
    async execute(ctx) {
      const { geocodePlace } = await import('./geoFence');
      const destText = ctx.entity('LOCATION') ?? ctx.entity('PLACE') ?? ctx.entity('DESTINATION')
        ?? ctx.transcript.replace(/book|ride|uber|careem|taxi|cab|take me|drive me|to|a/gi, '').trim();

      const openUber = (lat?: number, lng?: number, label?: string) => {
        let url: string;
        if (lat && lng) {
          const params = new URLSearchParams({
            'action': 'setPickup',
            'dropoff[latitude]': lat.toFixed(6), 'dropoff[longitude]': lng.toFixed(6),
            'dropoff[nickname]': label ?? destText, 'dropoff[formatted_address]': label ?? destText,
          });
          url = `https://m.uber.com/ul/?${params.toString()}`;
        } else { url = 'https://www.uber.com'; }
        window.open(url, '_blank', 'noopener');
      };

      if (destText && ctx.location) {
        const coords = await geocodePlace(destText, ctx.location.latitude, ctx.location.longitude).catch(() => null);
        openUber(coords?.lat, coords?.lng, destText);
      } else { openUber(undefined, undefined, destText); }

      ctx.addMessage({
        id: `ride-${Date.now()}`, role: 'roger',
        text: `🚗 Opening Uber to ${destText || 'your destination'}`,
        ts: Date.now(), intent: ctx.result.intent, outcome: 'success',
      });
    },
  });

  // ── TRANSLATE_TEXT / TRANSLATE_LAST ──────────────────────────────────────
  r.register({
    intent: ['TRANSLATE_TEXT', 'TRANSLATE_LAST'],
    requiredServices: ['openai'],
    async execute(ctx) {
      // Translation is handled by GPT in processTransmission — the result
      // already contains translation_source/target/romanized fields.
      // This handler just ensures the translation card is surfaced.
      if (ctx.result.translation_target && ctx.result.translation_source) {
        ctx.addMessage({
          id: `translate-${Date.now()}`, role: 'roger',
          text: `🌐 ${ctx.result.translation_source} → ${ctx.result.translation_target}${ctx.result.translation_romanized ? ` (${ctx.result.translation_romanized})` : ''}`,
          ts: Date.now(), intent: ctx.result.intent, outcome: 'success',
        });
      }
    },
  });
}

// ── Batch C: Media + Ambient ────────────────────────────────────────────────

function registerMediaHandlers(r: IntentRegistryImpl): void {
  // ── PLAY_MUSIC / PLAY_PLAYLIST (Spotify) ────────────────────────────────
  r.register({
    intent: ['PLAY_MUSIC', 'PLAY_PLAYLIST'],
    requiredServices: ['spotify'],
    async execute(ctx) {
      const { isSpotifyConnected, playSearch } = await import('./spotify');
      if (!isSpotifyConnected()) {
        await ctx.speak('Spotify not connected. Go to Settings to link your account. Over.'); return;
      }
      const query = ctx.entity('PLAYLIST_NAME') ?? ctx.entity('ARTIST_NAME') ?? ctx.entity('MOOD')
        ?? ctx.transcript.replace(/play|music|queue|spotify/gi, '').trim();
      const label = await playSearch(query);
      await ctx.speak(label ? `Playing ${label}. Over.` : 'Could not find that on Spotify. Over.');
    },
    async fallback(ctx) {
      // Spotify down → try Radio Browser
      const { searchAndPlay } = await import('./radioBrowser');
      const tag = ctx.entity('MOOD') ?? ctx.entity('PLAYLIST_NAME') ?? 'music';
      const station = await searchAndPlay({ tag });
      if (station) {
        await ctx.speak(`Spotify unavailable. Tuning in to ${station.name} instead. Over.`);
      } else {
        await ctx.speak('Spotify and radio both unavailable right now. Over.');
      }
    },
  });

  // ── PAUSE_MUSIC ─────────────────────────────────────────────────────────
  r.register({
    intent: 'PAUSE_MUSIC',
    requiredServices: ['spotify'],
    async execute(ctx) {
      const { pausePlayback } = await import('./spotify');
      await pausePlayback();
      await ctx.speak('Music paused. Over.');
    },
  });

  // ── SKIP_TRACK ──────────────────────────────────────────────────────────
  r.register({
    intent: 'SKIP_TRACK',
    requiredServices: ['spotify'],
    async execute(ctx) {
      const { nextTrack } = await import('./spotify');
      await nextTrack();
      await ctx.speak('Skipping. Over.');
    },
  });

  // ── PLAY_RADIO ──────────────────────────────────────────────────────────
  r.register({
    intent: 'PLAY_RADIO',
    requiredServices: ['radio'],
    async execute(ctx) {
      const { searchAndPlay } = await import('./radioBrowser');
      const station = await searchAndPlay({
        tag: ctx.entity('RADIO_TAG') ?? ctx.entity('MOOD'),
        name: ctx.entity('RADIO_STATION'),
        countrycode: ctx.entity('RADIO_COUNTRY'),
        language: ctx.entity('RADIO_LANGUAGE'),
        geo_lat: ctx.entity('RADIO_NEARBY') ? ctx.location?.latitude : undefined,
        geo_long: ctx.entity('RADIO_NEARBY') ? ctx.location?.longitude : undefined,
      });
      if (station) {
        await ctx.speak(`Tuning in to ${station.name}. ${station.tags?.split(',')[0] ?? 'Radio'}. Over.`);
        ctx.addMessage({
          id: `radio-${Date.now()}`, role: 'roger',
          text: `📻 Now playing: ${station.name} (${station.country})`,
          ts: Date.now(), intent: ctx.result.intent, outcome: 'success',
        });
      } else {
        await ctx.speak('No stations found matching that. Try a different genre or country. Over.');
      }
    },
  });

  // ── STOP_RADIO ──────────────────────────────────────────────────────────
  r.register({
    intent: 'STOP_RADIO',
    requiredServices: [],
    async execute(_ctx) {
      const { stopRadio } = await import('./radioBrowser');
      stopRadio();
    },
  });

  // ── RADIO_INFO ──────────────────────────────────────────────────────────
  r.register({
    intent: 'RADIO_INFO',
    requiredServices: [],
    async execute(ctx) {
      const { getCurrentStation } = await import('./radioBrowser');
      const station = getCurrentStation();
      if (station) {
        await ctx.speak(`Now playing: ${station.name}. ${station.tags?.split(',')[0] ?? 'Radio'}. ${station.country}. ${station.bitrate > 0 ? station.bitrate + 'kbps.' : ''} Over.`);
      } else {
        await ctx.speak('No radio playing right now. Say "play radio" to start. Over.');
      }
    },
  });

  // ── NEXT_STATION ────────────────────────────────────────────────────────
  r.register({
    intent: 'NEXT_STATION',
    requiredServices: ['radio'],
    async execute(ctx) {
      const { playNextStation } = await import('./radioBrowser');
      const next = await playNextStation();
      await ctx.speak(next ? `Switching to ${next.name}. Over.` : 'No more stations in queue. Try a new search. Over.');
    },
  });

  // ── AMBIENT_LISTEN ──────────────────────────────────────────────────────
  r.register({
    intent: 'AMBIENT_LISTEN',
    requiredServices: [],
    async execute(ctx) {
      if (ctx.ambient.active) return;
      const { useIntentStore: store } = await import('./intentStore');
      const { createAmbientSession } = await import('./ambientListener');

      const sess = createAmbientSession({
        onChunk: (chunk) => {
          store.getState().setAmbientLastChunk(chunk);
          if (chunk.isMusicDominant) {
            const label = chunk.musicIdentified
              ? `🎵 ${chunk.musicIdentified.title} — ${chunk.musicIdentified.artist}`
              : chunk.musicHint ?? '🎵 Music detected';
            ctx.addMessage({ id: `ambient-music-${Date.now()}`, role: 'roger', text: label, ts: Date.now(), intent: 'AMBIENT_LISTEN', outcome: 'success' });
          }
        },
        onMusicDetected: (info) => {
          ctx.speak(`That's "${info.title}" by ${info.artist}${info.album ? ` from ${info.album}` : ''}. Over.`);
        },
        onError: (err) => console.warn('[Ambient]', err),
      });

      const started = await sess.start();
      if (started) {
        (ctx.ambient.sessionRef as { current: unknown }).current = sess;
        store.getState().setAmbientActive(true);
      } else {
        await ctx.speak('Microphone access required for listening mode. Over.');
      }
    },
  });

  // ── AMBIENT_QUERY ───────────────────────────────────────────────────────
  r.register({
    intent: 'AMBIENT_QUERY',
    requiredServices: [],
    async execute(ctx) {
      const chunk = ctx.ambient.lastChunk as { summary?: string; language?: string; languageName?: string; musicHint?: string } | null;
      if (!chunk) {
        await ctx.speak("I haven't captured anything yet. Say 'listen to this' to start. Over."); return;
      }
      let msg = chunk.summary ?? '';
      if (chunk.language && chunk.language !== 'en') msg += ` Spoken in ${chunk.languageName ?? chunk.language}.`;
      if (chunk.musicHint) msg += ` Music note: ${chunk.musicHint}.`;
      msg += ' Over.';
      await ctx.speak(msg);
    },
  });

  // ── AMBIENT_STOP ────────────────────────────────────────────────────────
  r.register({
    intent: 'AMBIENT_STOP',
    requiredServices: [],
    async execute(ctx) {
      if (!ctx.ambient.active || !ctx.ambient.sessionRef.current) return;
      const { useIntentStore: store } = await import('./intentStore');
      const sess = ctx.ambient.sessionRef.current as { stop: () => Promise<{ contentType: string; language: string; languageName: string; transcript: string; summary: string; musicTitle?: string; musicArtist?: string; musicAlbum?: string; durationS: number; chunks: unknown[] }> };
      const result = await sess.stop();
      (ctx.ambient.sessionRef as { current: unknown }).current = null;
      store.getState().setAmbientActive(false);
      store.getState().setAmbientLastChunk(null);

      // Persist to DB (fire-and-forget)
      import('./supabase').then(({ supabase: sb }) => {
        sb.from('ambient_sessions').insert({
          user_id: ctx.userId, content_type: result.contentType, language: result.language,
          language_name: result.languageName, transcript: result.transcript, summary: result.summary,
          music_title: result.musicTitle, music_artist: result.musicArtist, music_album: result.musicAlbum,
          duration_s: result.durationS, raw_chunks: result.chunks, ended_at: new Date().toISOString(),
        });
      }).catch(() => {});

      await ctx.speak(`Listening stopped. ${result.summary || 'No clear audio captured.'} Over.`);
      ctx.addMessage({
        id: `ambient-end-${Date.now()}`, role: 'roger',
        text: `🎙️ Ambient session ended · ${result.durationS}s · ${result.contentType}${result.musicTitle ? ` · 🎵 ${result.musicTitle}` : ''}`,
        ts: Date.now(), intent: 'AMBIENT_STOP', outcome: 'success',
      });
    },
  });
}

// ── Batch D: Tune In + PTT Network ─────────────────────────────────────────

function registerTuneInHandlers(r: IntentRegistryImpl): void {
  // ── TUNE_IN_REQUEST ─────────────────────────────────────────────────────
  r.register({
    intent: 'TUNE_IN_REQUEST',
    requiredServices: ['supabase'],
    async execute(ctx) {
      const callsign = ctx.entity('CALLSIGN') ?? ctx.entity('PERSON') ?? '';
      if (!callsign) return;
      const res = await tuneInFetch('request-tune-in', { userId: ctx.userId, targetCallsign: callsign });
      if (res.ok) {
        await ctx.speak(res.rogerResponse as string ?? `Tune In request sent to ${callsign}. Waiting for response. Over.`);
      } else {
        await ctx.speak(res.error as string ?? `Could not reach ${callsign}. Over.`);
      }
    },
  });

  // ── TUNE_IN_ACCEPT ──────────────────────────────────────────────────────
  r.register({
    intent: 'TUNE_IN_ACCEPT',
    requiredServices: ['supabase'],
    async execute(ctx) {
      const req = ctx.tuneIn.incomingRequest;
      if (!req) { await ctx.speak('No incoming Tune In request. Over.'); return; }
      const res = await tuneInFetch('accept-tune-in', { requestId: req.requestId });
      if (res.ok) {
        const store = useIntentStore.getState();
        store.setActiveTuneInSession({ sessionId: res.sessionId as string, withName: req.callsign });
        store.setIncomingTuneInRequest(null);
        await ctx.speak(res.rogerResponse as string ?? `Connected with ${req.callsign}. Over.`);
      }
    },
  });

  // ── TUNE_IN_DECLINE ─────────────────────────────────────────────────────
  r.register({
    intent: 'TUNE_IN_DECLINE',
    requiredServices: ['supabase'],
    async execute(ctx) {
      const req = ctx.tuneIn.incomingRequest;
      if (!req) return;
      await tuneInFetch('decline-tune-in', { requestId: req.requestId });
      useIntentStore.getState().setIncomingTuneInRequest(null);
      await ctx.speak(`Declined ${req.callsign}'s request. Over.`);
    },
  });

  // ── TUNE_IN_END ─────────────────────────────────────────────────────────
  r.register({
    intent: 'TUNE_IN_END',
    requiredServices: ['supabase'],
    async execute(ctx) {
      const session = ctx.tuneIn.activeSession;
      if (!session) return;
      await tuneInFetch('end-tune-in', { sessionId: session.sessionId });
      useIntentStore.getState().setActiveTuneInSession(null);
      await ctx.speak(`Session with ${session.withName} ended. Over.`);
    },
  });

  // ── TUNE_IN_FLAG ────────────────────────────────────────────────────────
  r.register({
    intent: 'TUNE_IN_FLAG',
    requiredServices: ['supabase'],
    async execute(ctx) {
      const session = ctx.tuneIn.activeSession;
      if (!session) return;
      await tuneInFetch('flag-tune-in', { sessionId: session.sessionId, reason: ctx.transcript });
      await ctx.speak('Session flagged. Our team will review. Over.');
    },
  });

  // ── RECORD_MEETING ──────────────────────────────────────────────────────
  r.register({
    intent: 'RECORD_MEETING',
    requiredServices: [],
    async execute(ctx) {
      if (ctx.meeting.active) return;
      const { useIntentStore: store } = await import('./intentStore');
      const { createMeetingRecorder } = await import('./meetingRecorder');
      const title = ctx.entity('MEETING_TITLE') ?? 'Meeting';
      store.getState().setMeetingTitle(title);

      const rec = createMeetingRecorder(ctx.userId, {
        onChunkTranscribed: (chunk) => { store.getState().setMeetingWords(prev => prev + chunk.wordCount); },
        onProgress: (elapsed, words) => { store.getState().setMeetingElapsed(elapsed); store.getState().setMeetingWords(words); },
        onComplete: (res) => {
          store.getState().setMeetingActive(false);
          store.getState().setMeetingElapsed(0);
          store.getState().setMeetingWords(0);
          const msg = res.notes.spoken_summary || `Meeting notes ready. ${res.notes.action_items.length} action items. Over.`;
          ctx.speak(msg);
          ctx.addMessage({
            id: `meeting-done-${Date.now()}`, role: 'roger',
            text: `📋 Meeting notes ready: "${res.title}" · ${res.notes.action_items.length} actions · ${res.notes.decisions.length} decisions`,
            ts: Date.now(), intent: 'END_MEETING', outcome: 'success',
          });
        },
        onError: (err) => console.warn('[Meeting]', err),
      });

      const started = await rec.start(title);
      if (started) {
        (ctx.meeting.recorderRef as { current: unknown }).current = rec;
        store.getState().setMeetingActive(true);
      } else {
        await ctx.speak('Microphone access required for meeting recording. Over.');
      }
    },
  });

  // ── END_MEETING ─────────────────────────────────────────────────────────
  r.register({
    intent: 'END_MEETING',
    requiredServices: [],
    async execute(ctx) {
      if (!ctx.meeting.active || !ctx.meeting.recorderRef.current) return;
      const rec = ctx.meeting.recorderRef.current as { stop: () => Promise<void> };
      await rec.stop(); // onComplete fires automatically
      (ctx.meeting.recorderRef as { current: unknown }).current = null;
    },
  });

  // ── SESSION_RECALL / SESSION_QUERY ──────────────────────────────────────
  r.register({
    intent: ['SESSION_RECALL', 'SESSION_QUERY'],
    requiredServices: ['supabase'],
    async execute(ctx) {
      const { fetchSessionArchive, searchSessions, insertSurfaceItem } = await import('./api');
      const keyword = ctx.entity('KEYWORD') ?? ctx.entity('TOPIC');
      const results = keyword
        ? await searchSessions(ctx.userId, keyword)
        : await fetchSessionArchive(ctx.userId);

      if (results.length === 0) {
        await ctx.speak(`No sessions found${keyword ? ` mentioning ${keyword}` : ''}. Over.`); return;
      }

      const top = results[0];
      const who = top.contact_name ?? top.contact_callsign ?? 'Unknown';
      const when = new Date(top.session_start).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
      const dur = top.duration_min < 1 ? 'under a minute' : `${top.duration_min} minute${top.duration_min !== 1 ? 's' : ''}`;
      let msg = `Your most recent session with ${who} was ${when}, ${dur} long.`;
      if (top.roger_notes) {
        const preview = top.roger_notes.length > 180 ? top.roger_notes.slice(0, 180).replace(/\s\S+$/, '') + '...' : top.roger_notes;
        msg += ` Roger's debrief: ${preview}`;
      }
      msg += ' Full transcript is in your Session Log. Over.';
      await ctx.speak(msg);

      insertSurfaceItem({
        user_id: ctx.userId, type: 'SESSION_RECAP',
        content: `Session with ${who} (${when}) — tap to view full transcript & notes`,
        priority: 7, dismissed: false, snooze_count: 0,
        surface_at: new Date().toISOString(), context: top.id, source_tx_id: null,
      }).catch(() => {});
    },
  });
}

// ── Batch E: Remaining + Catch-All ──────────────────────────────────────────

function registerRemainingHandlers(r: IntentRegistryImpl): void {
  // ── MEMORY_CAPTURE / BOOK_UPDATE ────────────────────────────────────────
  r.register({
    intent: ['MEMORY_CAPTURE', 'BOOK_UPDATE'],
    requiredServices: ['supabase'],
    async execute(ctx) {
      const { upsertMemoryFact } = await import('./api');
      await upsertMemoryFact({
        user_id: ctx.userId,
        fact_type: ctx.result.intent === 'BOOK_UPDATE' ? 'preference' : 'preference',
        subject: ctx.entity('PERSON') ?? ctx.entity('TOPIC') ?? 'note',
        predicate: 'captured',
        object: ctx.transcript,
        confidence: ctx.result.confidence ?? 80,
        source_tx: ctx.result.intent,
        is_confirmed: false,
        is_draft: true,
      });
    },
  });

  // ── ACADEMY_* (wildcard prefix) ─────────────────────────────────────────
  r.register({
    intent: 'ACADEMY_*',
    requiredServices: [],
    async execute(ctx) {
      // Academy intents are handled by the AcademyView component.
      // The registry just surfaces a navigation message.
      ctx.addMessage({
        id: `academy-${Date.now()}`, role: 'roger',
        text: `🎓 Academy: ${ctx.result.roger_response.slice(0, 100)}`,
        ts: Date.now(), intent: ctx.result.intent, outcome: 'success',
      });
    },
  });

  // ── NEWS_BRIEF ──────────────────────────────────────────────────────────
  r.register({
    intent: 'NEWS_BRIEF',
    requiredServices: ['news'],
    async execute(ctx) {
      const { fetchNews } = await import('./news');
      const topic = ctx.entity('TOPIC') ?? ctx.transcript;
      const brief = await fetchNews(topic).catch(() => null);
      if (!brief || !brief.articles.length) {
        await ctx.speak('No news available right now. Over.'); return;
      }
      const newsText = brief.spokenBrief + ' Over.';
      await ctx.speak(newsText);
    },
  });

  // ── COMMUTE_QUERY / COMMUTE_START ───────────────────────────────────────
  r.register({
    intent: ['COMMUTE_QUERY', 'COMMUTE_START'],
    requiredServices: [],
    async execute(ctx) {
      // Commute is primarily handled by the CommuteRadar component.
      // GPT response already covers the query.
      const dest = ctx.entity('DESTINATION') ?? ctx.entity('LOCATION');
      if (dest) {
        ctx.addMessage({
          id: `commute-${Date.now()}`, role: 'roger',
          text: `🚗 Commute to ${dest}`,
          ts: Date.now(), intent: ctx.result.intent, outcome: 'success',
        });
      }
    },
  });

  // ── PARK_REMEMBER ───────────────────────────────────────────────────────
  r.register({
    intent: 'PARK_REMEMBER',
    requiredServices: ['supabase'],
    async execute(ctx) {
      if (!ctx.location) {
        await ctx.speak('Location not available. Enable location services. Over.'); return;
      }
      const { supabase: sb } = await import('./supabase');
      await sb.from('parked_locations').upsert({
        user_id: ctx.userId,
        latitude: ctx.location.latitude,
        longitude: ctx.location.longitude,
        note: ctx.entity('NOTE') ?? ctx.transcript,
        parked_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      await ctx.speak('Parking spot saved. I\'ll remind you where you parked. Over.');
    },
  });

  // ── ERRAND_ADD / ERRAND_LIST ─────────────────────────────────────────────
  r.register({
    intent: ['ERRAND_ADD', 'ERRAND_LIST'],
    requiredServices: ['supabase'],
    async execute(ctx) {
      const { insertReminder, fetchReminders } = await import('./api');
      if (ctx.result.intent === 'ERRAND_ADD') {
        await insertReminder({
          user_id: ctx.userId, text: ctx.transcript, entities: ctx.result.entities ?? null,
          due_at: null, status: 'pending', source_tx_id: null, is_admin_test: ctx.isTest,
          due_location: ctx.entity('LOCATION'), due_location_lat: null, due_location_lng: null,
          due_radius_m: 300, geo_triggered: false,
        });
        await ctx.speak('Errand added. Over.');
      } else {
        const errands = await fetchReminders(ctx.userId);
        if (!errands.length) { await ctx.speak('No errands pending. Over.'); return; }
        const list = errands.slice(0, 5).map((e, i) => `${i + 1}. ${e.text.slice(0, 60)}`).join('. ');
        await ctx.speak(`You have ${errands.length} errands. ${list}. Over.`);
      }
    },
  });

  // ── QUERY_WEATHER ───────────────────────────────────────────────────────
  r.register({
    intent: 'QUERY_WEATHER',
    requiredServices: [],
    async execute(ctx) {
      // Weather is handled by GPT response — this handler ensures card surfacing
      if (ctx.location) {
        ctx.addMessage({
          id: `weather-${Date.now()}`, role: 'roger',
          text: `🌤️ Weather update`,
          ts: Date.now(), intent: ctx.result.intent, outcome: 'success',
        });
      }
    },
  });

  // ── ISLAMIC_* (prefix wildcard) ─────────────────────────────────────────
  r.register({
    intent: 'ISLAMIC_*',
    requiredServices: ['islamic'],
    async execute(ctx) {
      // Islamic intents are handled by the SalahView component + islamicApi.
      // GPT response already covers prayer times, Quran, hadith, etc.
      ctx.addMessage({
        id: `islamic-${Date.now()}`, role: 'roger',
        text: `🕌 ${ctx.result.roger_response.slice(0, 100)}`,
        ts: Date.now(), intent: ctx.result.intent, outcome: 'success',
      });
    },
  });

  // ── CONVERSE (default conversation — no service dependencies) ───────────
  r.register({
    intent: 'CONVERSE',
    requiredServices: [],
    async execute(_ctx) {
      // No-op: CONVERSE is handled by the main TTS flow in UserHome.
      // The registry returns true to indicate it was matched, but the
      // actual speaking is done by the main PTT pipeline.
    },
  });
}
