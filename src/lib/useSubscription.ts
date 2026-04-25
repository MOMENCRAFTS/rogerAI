/**
 * useSubscription.ts — Roger AI Subscription & Feature Gate System
 *
 * Provides the current user's subscription plan and a feature gate
 * checker used throughout the app to enforce tier limits.
 *
 * Plans:
 *  'free'    — 50 PTT/day, 10 reminders, 1 meeting/week, no proactive engine
 *  'pro'     — Unlimited PTT, meetings, reminders, proactive engine
 *  'command' — All Pro features + team features
 *
 * Usage:
 *   const { plan, isPro, checkGate } = useSubscription(userId);
 *   const gate = checkGate('unlimited_ptt');
 *   if (!gate.allowed) showPaywall(gate.feature, gate.reason);
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabase';

export type SubscriptionPlan = 'free' | 'pro' | 'command';
export type SubscriptionStatus = 'active' | 'cancelled' | 'past_due' | 'trialing';

export type GatedFeature =
  | 'unlimited_ptt'
  | 'ambient_listener'
  | 'meeting_recorder'
  | 'proactive_engine'
  | 'unlimited_memory'
  | 'unlimited_reminders'
  | 'unlimited_tasks'
  | 'tune_in_unlimited'
  | 'analytics_history'
  | 'multilingual'
  | 'esp32_sync'
  | 'team_features';

export interface GateResult {
  allowed: boolean;
  feature: GatedFeature;
  reason: string;         // human-readable, spoken-friendly
  upgradeTarget: SubscriptionPlan;
}

export interface SubscriptionRecord {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  trial_ends_at: string | null;
  current_period_end: string | null;
}

export interface UsageRecord {
  ptt_today: number;
  ptt_date: string;
  tune_in_today: number;
  meeting_mins_week: number;
}

// ─── Free Tier Limits ─────────────────────────────────────────────────────────
export const FREE_LIMITS = {
  ptt_daily: 50,
  reminders: 10,
  tasks: 20,
  memory_facts: 100,
  tune_in_daily: 3,
  meeting_sessions_weekly: 1,
} as const;

// ─── Feature Gate Matrix ──────────────────────────────────────────────────────
const GATE_MATRIX: Record<GatedFeature, { requiredPlan: SubscriptionPlan; reason: string }> = {
  unlimited_ptt:        { requiredPlan: 'pro',     reason: 'Unlimited voice transmissions require Roger Pro.' },
  ambient_listener:     { requiredPlan: 'pro',     reason: 'Ambient listening is a Roger Pro feature.' },
  meeting_recorder:     { requiredPlan: 'pro',     reason: 'Unlimited meeting recordings require Roger Pro.' },
  proactive_engine:     { requiredPlan: 'pro',     reason: 'Proactive AI check-ins require Roger Pro.' },
  unlimited_memory:     { requiredPlan: 'pro',     reason: 'Unlimited memory storage requires Roger Pro.' },
  unlimited_reminders:  { requiredPlan: 'pro',     reason: 'Unlimited reminders require Roger Pro.' },
  unlimited_tasks:      { requiredPlan: 'pro',     reason: 'Unlimited tasks require Roger Pro.' },
  tune_in_unlimited:    { requiredPlan: 'pro',     reason: 'Unlimited Tune In sessions require Roger Pro.' },
  analytics_history:    { requiredPlan: 'pro',     reason: 'Full analytics history requires Roger Pro.' },
  multilingual:         { requiredPlan: 'pro',     reason: 'Multi-language responses require Roger Pro.' },
  esp32_sync:           { requiredPlan: 'pro',     reason: 'ESP32 hardware sync requires Roger Pro.' },
  team_features:        { requiredPlan: 'command', reason: 'Team features require Roger Command.' },
};

// ─── Plan hierarchy helper ────────────────────────────────────────────────────
function planRank(plan: SubscriptionPlan): number {
  return plan === 'command' ? 2 : plan === 'pro' ? 1 : 0;
}

function meetsRequirement(userPlan: SubscriptionPlan, requiredPlan: SubscriptionPlan): boolean {
  return planRank(userPlan) >= planRank(requiredPlan);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useSubscription(userId: string) {
  const [subscription, setSubscription] = useState<SubscriptionRecord>({
    plan: 'free',
    status: 'active',
    trial_ends_at: null,
    current_period_end: null,
  });
  const [usage, setUsage] = useState<UsageRecord>({
    ptt_today: 0,
    ptt_date: new Date().toISOString().slice(0, 10),
    tune_in_today: 0,
    meeting_mins_week: 0,
  });
  const [loading, setLoading] = useState(true);

  // Fetch subscription + usage from Supabase
  const refresh = useCallback(async () => {
    if (!userId || userId === 'dev-preview' || userId === 'admin-preview') {
      // In preview mode default to pro so nothing is blocked
      setSubscription({ plan: 'pro', status: 'active', trial_ends_at: null, current_period_end: null });
      setLoading(false);
      return;
    }
    try {
      const [subRes, usageRes] = await Promise.all([
        supabase.from('user_subscriptions').select('*').eq('user_id', userId).maybeSingle(),
        supabase.from('user_usage').select('*').eq('user_id', userId).maybeSingle(),
      ]);

      if (subRes.data) {
        setSubscription(subRes.data as SubscriptionRecord);
      }
      // If no row exists yet, defaults stand (free / active)

      if (usageRes.data) {
        const u = usageRes.data as UsageRecord;
        // Reset daily counter if date has changed
        const today = new Date().toISOString().slice(0, 10);
        if (u.ptt_date !== today) {
          setUsage({ ...u, ptt_today: 0, ptt_date: today, tune_in_today: 0 });
        } else {
          setUsage(u);
        }
      }
    } catch {
      // Silently fall back to free
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh]);

  // ─── Derived state ──────────────────────────────────────────────────────────
  const plan = subscription.plan;
  const status = subscription.status;
  const isPro = meetsRequirement(plan, 'pro') && (status === 'active' || status === 'trialing');
  const isCommand = meetsRequirement(plan, 'command') && (status === 'active' || status === 'trialing');
  const isTrialing = status === 'trialing';

  const trialDaysLeft = (() => {
    if (!subscription.trial_ends_at) return 0;
    const diff = new Date(subscription.trial_ends_at).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / 86_400_000));
  })();

  const pttUsedToday = usage.ptt_today;
  const pttRemaining = isPro ? Infinity : Math.max(0, FREE_LIMITS.ptt_daily - pttUsedToday);
  const pttLimitHit = !isPro && pttUsedToday >= FREE_LIMITS.ptt_daily;

  // ─── Feature gate checker ───────────────────────────────────────────────────
  const checkGate = useCallback((feature: GatedFeature): GateResult => {
    const gate = GATE_MATRIX[feature];
    const allowed = meetsRequirement(plan, gate.requiredPlan) &&
      (status === 'active' || status === 'trialing');
    return {
      allowed,
      feature,
      reason: gate.reason,
      upgradeTarget: gate.requiredPlan,
    };
  }, [plan, status]);

  // ─── Activate 7-day Pro trial (mockup: writes to DB directly) ──────────────
  const startTrial = useCallback(async () => {
    const trialEnd = new Date(Date.now() + 7 * 86_400_000).toISOString();
    try {
      await supabase.from('user_subscriptions').upsert({
        user_id: userId,
        plan: 'pro',
        status: 'trialing',
        trial_ends_at: trialEnd,
        updated_at: new Date().toISOString(),
      });
      setSubscription({ plan: 'pro', status: 'trialing', trial_ends_at: trialEnd, current_period_end: null });
    } catch { /* silent */ }
  }, [userId]);

  return {
    plan,
    status,
    isPro,
    isCommand,
    isTrialing,
    trialDaysLeft,
    loading,
    pttUsedToday,
    pttRemaining,
    pttLimitHit,
    checkGate,
    startTrial,
    refresh,
    FREE_LIMITS,
  };
}
