// ─── Roger AI — Intent Store (Zustand) ──────────────────────────────────────
// Centralized state management for the intent dispatch pipeline.
// Extracted from UserHome.tsx to decouple handlers from React component tree.
// Uses Zustand for minimal boilerplate and no provider wrappers.

import { create } from 'zustand';
import type { NewsArticle } from './news';
import type { ClarificationContext, IntentOption } from './clarificationContext';
import type { AmbientChunkResult } from './ambientListener';
import type { ConversationTurn } from './openai';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PendingAction {
  type: 'reminder' | 'task' | 'meeting' | 'sms';
  label: string;
  execute: () => void;
}

export interface Message {
  id: string;
  role: 'user' | 'roger';
  text: string;
  ts: number;
  intent?: string;
  outcome?: string;
  news?: NewsArticle[];
  isKnowledge?: boolean;
  subtopics?: { label: string; emoji: string }[];
  deepDiveDepth?: number;
  translationSource?: string;
  translationTarget?: string;
  translationTargetLang?: string;
  translationRomanized?: string;
}

export type PTTState = 'idle' | 'recording' | 'transcribing' | 'processing' | 'speaking' | 'responded' | 'awaiting_answer';

export interface DeepDiveState {
  topic: string;
  depth: number;
  coverageSummary: string;
  turns: string[];
}

// ─── Store Shape ─────────────────────────────────────────────────────────────

export interface IntentStoreState {
  // PTT lifecycle
  pttState: PTTState;
  isSpeaking: boolean;
  holdMs: number;

  // Message log
  messages: Message[];
  history: ConversationTurn[];

  // Confirmation gate
  pendingAction: PendingAction | null;

  // Clarification
  pendingClarification: ClarificationContext | null;
  intentOptions: IntentOption[] | null;
  clarifQuestion: string;
  clarifCountdown: number;

  // Tune In
  activeTuneInSession: { sessionId: string; withName: string } | null;
  incomingTuneInRequest: { requestId: string; from: string; callsign: string; reason: string | null; expiresAt: string } | null;
  pendingContactSave: { callsign: string; contactName: string } | null;
  contactSaveInput: string;

  // Name confirmation
  pendingNameConfirm: { name: string; factId?: string } | null;

  // Deep Dive knowledge
  deepDiveState: DeepDiveState | null;

  // Ambient Listening
  ambientActive: boolean;
  ambientLastChunk: AmbientChunkResult | null;

  // Meeting Recorder
  meetingActive: boolean;
  meetingElapsed: number;
  meetingWords: number;
  meetingTitle: string;
}

export interface IntentStoreActions {
  // PTT lifecycle
  setPttState: (state: PTTState) => void;
  setIsSpeaking: (v: boolean) => void;
  setHoldMs: (v: number) => void;

  // Messages
  addMessage: (msg: Message) => void;
  setMessages: (updater: (prev: Message[]) => Message[]) => void;
  appendHistory: (turns: ConversationTurn[]) => void;

  // Confirmation gate
  setPendingAction: (action: PendingAction | null) => void;
  confirmPendingAction: () => void;
  cancelPendingAction: () => void;

  // Clarification
  setPendingClarification: (ctx: ClarificationContext | null) => void;
  setIntentOptions: (opts: IntentOption[] | null) => void;
  setClarifQuestion: (q: string) => void;
  setClarifCountdown: (v: number | ((prev: number) => number)) => void;

  // Tune In
  setActiveTuneInSession: (v: { sessionId: string; withName: string } | null) => void;
  setIncomingTuneInRequest: (v: { requestId: string; from: string; callsign: string; reason: string | null; expiresAt: string } | null) => void;
  setPendingContactSave: (v: { callsign: string; contactName: string } | null) => void;
  setContactSaveInput: (v: string) => void;

  // Name confirm
  setPendingNameConfirm: (v: { name: string; factId?: string } | null) => void;

  // Deep Dive
  setDeepDiveState: (updater: DeepDiveState | null | ((prev: DeepDiveState | null) => DeepDiveState | null)) => void;

  // Ambient
  setAmbientActive: (v: boolean) => void;
  setAmbientLastChunk: (v: AmbientChunkResult | null) => void;

  // Meeting
  setMeetingActive: (v: boolean) => void;
  setMeetingElapsed: (v: number) => void;
  setMeetingWords: (v: number | ((prev: number) => number)) => void;
  setMeetingTitle: (v: string) => void;

  // Utility
  reset: () => void;
}

// ─── Initial State ───────────────────────────────────────────────────────────

const INITIAL_STATE: IntentStoreState = {
  pttState: 'idle',
  isSpeaking: false,
  holdMs: 0,
  messages: [],
  history: [],
  pendingAction: null,
  pendingClarification: null,
  intentOptions: null,
  clarifQuestion: '',
  clarifCountdown: 0,
  activeTuneInSession: null,
  incomingTuneInRequest: null,
  pendingContactSave: null,
  contactSaveInput: '',
  pendingNameConfirm: null,
  deepDiveState: null,
  ambientActive: false,
  ambientLastChunk: null,
  meetingActive: false,
  meetingElapsed: 0,
  meetingWords: 0,
  meetingTitle: '',
};

// ─── Store ───────────────────────────────────────────────────────────────────

export const useIntentStore = create<IntentStoreState & IntentStoreActions>((set, get) => ({
  ...INITIAL_STATE,

  // ── PTT ──────────────────────────────────────────────────────────────────
  setPttState: (state) => set({ pttState: state }),
  setIsSpeaking: (v) => set({ isSpeaking: v }),
  setHoldMs: (v) => set({ holdMs: v }),

  // ── Messages ─────────────────────────────────────────────────────────────
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  setMessages: (updater) => set((s) => ({ messages: updater(s.messages) })),
  appendHistory: (turns) => set((s) => ({
    history: [...s.history.slice(-10), ...turns],
  })),

  // ── Confirmation ─────────────────────────────────────────────────────────
  setPendingAction: (action) => set({ pendingAction: action }),
  confirmPendingAction: () => {
    const { pendingAction } = get();
    if (pendingAction) {
      try { pendingAction.execute(); } catch { /* handler errors logged elsewhere */ }
    }
    set({ pendingAction: null });
  },
  cancelPendingAction: () => set({ pendingAction: null }),

  // ── Clarification ────────────────────────────────────────────────────────
  setPendingClarification: (ctx) => set({ pendingClarification: ctx }),
  setIntentOptions: (opts) => set({ intentOptions: opts }),
  setClarifQuestion: (q) => set({ clarifQuestion: q }),
  setClarifCountdown: (v) => set((s) => ({
    clarifCountdown: typeof v === 'function' ? v(s.clarifCountdown) : v,
  })),

  // ── Tune In ──────────────────────────────────────────────────────────────
  setActiveTuneInSession: (v) => set({ activeTuneInSession: v }),
  setIncomingTuneInRequest: (v) => set({ incomingTuneInRequest: v }),
  setPendingContactSave: (v) => set({ pendingContactSave: v }),
  setContactSaveInput: (v) => set({ contactSaveInput: v }),

  // ── Name confirm ─────────────────────────────────────────────────────────
  setPendingNameConfirm: (v) => set({ pendingNameConfirm: v }),

  // ── Deep Dive ────────────────────────────────────────────────────────────
  setDeepDiveState: (updater) => set((s) => ({
    deepDiveState: typeof updater === 'function' ? updater(s.deepDiveState) : updater,
  })),

  // ── Ambient ──────────────────────────────────────────────────────────────
  setAmbientActive: (v) => set({ ambientActive: v }),
  setAmbientLastChunk: (v) => set({ ambientLastChunk: v }),

  // ── Meeting ──────────────────────────────────────────────────────────────
  setMeetingActive: (v) => set({ meetingActive: v }),
  setMeetingElapsed: (v) => set({ meetingElapsed: v }),
  setMeetingWords: (v) => set((s) => ({
    meetingWords: typeof v === 'function' ? v(s.meetingWords) : v,
  })),
  setMeetingTitle: (v) => set({ meetingTitle: v }),

  // ── Reset ────────────────────────────────────────────────────────────────
  reset: () => set(INITIAL_STATE),
}));
