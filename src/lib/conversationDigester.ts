// ─── Roger AI — Conversation Digester ───────────────────────────────────────
// Watches the message session and extracts actionable items AFTER the
// conversation settles (30s idle or app background). This replaces
// per-turn task forcing with intelligent post-session analysis.
//
// Design:
//   - Does NOT interfere with explicit action intents (CREATE_REMINDER, etc.)
//   - Fires only after 30s silence AND 3+ conversation turns
//   - Also fires on app visibility change (user locks phone)
//   - Persists suggested items to DB as status='suggested' so nothing is lost
//   - UI shows a digest card with per-item approve/dismiss

import { callGPT } from './openai';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DigestItem {
  type: 'task' | 'reminder' | 'followup';
  text: string;
  priority: number;       // 1-10
  confidence: number;     // 0-100
  due_hint?: string;      // "tomorrow", "3pm", "next week"
  source_excerpt: string; // which part of conversation triggered this
}

export interface DigestResult {
  items: DigestItem[];
  session_summary: string;
  digested_message_count: number;
}

/** Minimal message shape — matches UserHome's Message interface */
interface SessionMessage {
  id: string;
  role: 'user' | 'roger';
  text: string;
  ts: number;
  intent?: string;
}

// ─── Digest Prompt ───────────────────────────────────────────────────────────

const DIGEST_PROMPT = `You are a post-conversation analyst for Roger AI, a voice-first executive assistant.

You are given a COMPLETE conversation transcript between a user and Roger.
Your job is to extract ONLY genuinely actionable items that the user should track.

RULES:
- Greetings, chitchat, general questions, and informational exchanges are NOT actionable
- Only extract items the user explicitly or strongly implicitly intends to do
- "I need to call Ahmad" → actionable (task)
- "The lease expires in March" in context of planning → actionable (reminder)  
- "What's gold at?" → NOT actionable (just a question)
- "Hello, how are you?" → NOT actionable
- Be CONSERVATIVE. When in doubt, do NOT include it.
- Only return items with confidence > 70

For each item, classify as:
- task: something the user should do or Roger should track
- reminder: time-sensitive item with a deadline or date reference
- followup: something to revisit or check on later

Return valid JSON:
{
  "items": [
    {
      "type": "task" | "reminder" | "followup",
      "text": "concise action description",
      "priority": 1-10,
      "confidence": 70-100,
      "due_hint": "optional time reference or null",
      "source_excerpt": "the user's words that implied this action"
    }
  ],
  "session_summary": "one-line summary of what the conversation was about"
}

If the conversation was purely social or informational with no actionable content, return:
{ "items": [], "session_summary": "..." }

Respond with valid JSON only. No markdown, no explanation.`;

// ─── Digester Class ──────────────────────────────────────────────────────────

export class ConversationDigester {
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastDigestedId: string | null = null;
  private userId: string | null = null;
  private running = false;
  private digesting = false;
  private visibilityHandler: (() => void) | null = null;

  // Configurable
  private idleMs = 30_000;       // 30s silence before digest
  private minTurns = 3;          // minimum user+roger turns to bother digesting

  // Callbacks — set by consumer (UserHome)
  onDigest: ((result: DigestResult) => void) | null = null;

  // Track messages for visibility change handler
  private currentMessages: SessionMessage[] = [];

  // ── Lifecycle ──────────────────────────────────────────────────────────

  start(userId: string): void {
    if (this.running) return;
    this.userId = userId;
    this.running = true;
    this.lastDigestedId = null;

    // Fire digest when app goes to background
    this.visibilityHandler = () => {
      if (document.hidden && this.currentMessages.length > 0) {
        this.fireDigest(this.currentMessages);
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);

    console.log('[Digester] Started for user', userId);
  }

  stop(): void {
    this.cancelTimer();
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    this.running = false;
    this.currentMessages = [];
    console.log('[Digester] Stopped');
  }

  // ── Message Feed ───────────────────────────────────────────────────────

  /**
   * Called by UserHome whenever the messages array changes.
   * Resets the idle timer and checks if we have enough turns to digest.
   */
  onMessagesChanged(messages: SessionMessage[]): void {
    if (!this.running) return;
    this.currentMessages = messages;

    // Cancel any pending digest — conversation is still active
    this.cancelTimer();

    // Count turns since last digest
    const newMessages = this.getNewMessages(messages);
    const userTurns = newMessages.filter(m => m.role === 'user').length;
    const rogerTurns = newMessages.filter(m => m.role === 'roger').length;

    // Need at least minTurns total exchanges
    if (userTurns < Math.ceil(this.minTurns / 2) || rogerTurns < 1) return;

    // Start idle countdown — if no new messages for idleMs, digest
    this.idleTimer = setTimeout(() => {
      this.fireDigest(messages);
    }, this.idleMs);
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private getNewMessages(messages: SessionMessage[]): SessionMessage[] {
    if (!this.lastDigestedId) return messages;
    const idx = messages.findIndex(m => m.id === this.lastDigestedId);
    return idx >= 0 ? messages.slice(idx + 1) : messages;
  }

  private cancelTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private async fireDigest(messages: SessionMessage[]): Promise<void> {
    if (this.digesting || !this.userId) return;

    const newMessages = this.getNewMessages(messages);
    if (newMessages.length < this.minTurns) return;

    // Check that we have at least one user turn — don't digest roger-only
    if (!newMessages.some(m => m.role === 'user')) return;

    this.digesting = true;
    const lastMsg = newMessages[newMessages.length - 1];

    try {
      console.log(`[Digester] Analyzing ${newMessages.length} messages...`);

      // Build transcript
      const transcript = newMessages.map(m => {
        const speaker = m.role === 'user' ? 'User' : 'Roger';
        // Strip the "📋 Roger suggests:" section from roger messages
        const clean = m.text.replace(/📋 Roger suggests:[\s\S]*$/, '').trim();
        return `${speaker}: ${clean}`;
      }).join('\n');

      // Call GPT
      const result = await callGPT<{ items: DigestItem[]; session_summary: string }>(
        DIGEST_PROMPT,
        transcript,
        'gpt-5.4-mini', // cheaper model — this is background analysis
        true,
        30_000 // 30s timeout — not user-facing so can be generous
      );

      // Mark digested
      this.lastDigestedId = lastMsg.id;

      // Filter low-confidence items
      const items = (result.items ?? []).filter(item => item.confidence >= 70);

      if (items.length > 0) {
        console.log(`[Digester] Found ${items.length} actionable items`);

        const digestResult: DigestResult = {
          items,
          session_summary: result.session_summary ?? '',
          digested_message_count: newMessages.length,
        };

        // Persist suggested items to DB (safety net)
        this.persistSuggestions(items).catch(() => {});

        // Notify UI
        this.onDigest?.(digestResult);
      } else {
        console.log('[Digester] No actionable items found — session was conversational');
      }
    } catch (err) {
      console.warn('[Digester] Analysis failed:', err);
      // Silent — never interrupt user experience
    } finally {
      this.digesting = false;
    }
  }

  /**
   * Persist suggested items to DB as status='suggested' so they're
   * recoverable even if the digest card is dismissed or missed.
   */
  private async persistSuggestions(items: DigestItem[]): Promise<void> {
    if (!this.userId) return;
    const { insertTaskWithDedup } = await import('./api');

    await Promise.allSettled(
      items.map(item =>
        insertTaskWithDedup({
          user_id: this.userId!,
          text: `[Digest] ${item.text}`,
          priority: item.priority,
          status: 'suggested' as never, // custom status — shows in tasks but needs approval
          due_at: null,
          source_tx_id: null,
          is_admin_test: false,
          execution_tier: 'manual',
        }).catch(() => {})
      )
    );
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _digester: ConversationDigester | null = null;

export function getConversationDigester(): ConversationDigester {
  if (!_digester) _digester = new ConversationDigester();
  return _digester;
}
