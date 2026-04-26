/**
 * PaywallModal.tsx — Contextual upgrade upsell
 */
import { Crown, X, Zap, ArrowRight } from 'lucide-react';
import type { GatedFeature, SubscriptionPlan } from '../../lib/useSubscription';

interface Props {
  feature: GatedFeature;
  reason: string;
  upgradeTarget: SubscriptionPlan;
  onStartTrial: () => void;
  onViewPlans: () => void;
  onClose: () => void;
}

const PLAN_LABELS: Record<SubscriptionPlan, string> = { free: 'Free', pro: 'Roger Pro', command: 'Roger Command' };
const PLAN_PRICES: Record<SubscriptionPlan, string> = { free: '$0', pro: '$9.99/mo', command: '$29.99/mo' };

const FEATURE_PERKS: Record<GatedFeature, string[]> = {
  unlimited_ptt:       ['Unlimited voice transmissions', 'GPT-5.5 full quality', 'Priority AI queue'],
  ambient_listener:    ['Unlimited ambient sessions', 'Auto meeting notes', 'Voice-to-memory capture'],
  meeting_recorder:    ['Unlimited recordings up to 3h', 'Action items & summaries', 'Transcript archive'],
  proactive_engine:    ['30-min intelligent check-ins', 'Deadline surfacing', 'Context-aware nudges'],
  unlimited_memory:    ['Unlimited memory facts', 'Lifetime history', 'Entity graph'],
  unlimited_reminders: ['Unlimited reminders', 'Geo-fence triggers', 'Alarm engine'],
  unlimited_tasks:     ['Unlimited tasks', 'Priority ranking', 'Notion sync'],
  tune_in_unlimited:   ['Unlimited Tune In sessions', 'No time cap', 'Multi-contact calling'],
  analytics_history:   ['Lifetime analytics', 'Weekly AI digest', 'Export data'],
  multilingual:        ['Arabic, French, Spanish', 'Auto-detect language', 'Cultural context'],
  esp32_sync:          ['ESP32 hardware sync', 'Multi-device sessions', 'Custom PTT button'],
  team_features:       ['Up to 10 simultaneous calls', 'Shared relay network', 'Org dashboard'],
};

export default function PaywallModal({ feature, reason, upgradeTarget, onStartTrial, onViewPlans, onClose }: Props) {
  const perks = FEATURE_PERKS[feature] ?? [];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9000,
      background: 'rgba(0,0,0,0.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, backdropFilter: 'blur(4px)',
    }}>
      <div style={{
        background: 'var(--bg-elevated)', border: '1px solid rgba(212,160,68,0.3)',
        maxWidth: 360, width: '100%', position: 'relative',
        boxShadow: '0 0 60px rgba(212,160,68,0.1)',
      }}>
        <div style={{ height: 3, background: 'linear-gradient(90deg, rgba(212,160,68,0.3), rgba(212,160,68,1), rgba(212,160,68,0.3))' }} />
        <button onClick={onClose} style={{ position: 'absolute', top: 12, right: 12, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
          <X size={14} />
        </button>
        <div style={{ padding: '24px 24px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(212,160,68,0.12)', border: '1px solid rgba(212,160,68,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Crown size={18} style={{ color: 'var(--amber)' }} />
            </div>
            <div>
              <p style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--amber)', fontWeight: 700, margin: 0, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {PLAN_LABELS[upgradeTarget]} Required
              </p>
              <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>
                {PLAN_PRICES[upgradeTarget]} · Cancel anytime
              </p>
            </div>
          </div>
          <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 20 }}>{reason}</p>
          <div style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {perks.map(perk => (
              <div key={perk} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Zap size={10} style={{ color: 'var(--amber)', flexShrink: 0 }} />
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)' }}>{perk}</span>
              </div>
            ))}
          </div>
          <button
            id="paywall-start-trial-btn"
            onClick={onStartTrial}
            style={{ width: '100%', padding: '12px', background: 'linear-gradient(135deg, rgba(212,160,68,0.9), rgba(212,130,40,0.9))', border: 'none', cursor: 'pointer', fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#0a0a08', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            <Crown size={13} /> Start 7-Day Free Trial
          </button>
          <button
            id="paywall-view-plans-btn"
            onClick={onViewPlans}
            style={{ width: '100%', padding: '8px', background: 'transparent', border: '1px solid var(--border-subtle)', cursor: 'pointer', fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            View all plans <ArrowRight size={10} />
          </button>
          <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: '12px 0 0', textAlign: 'center' }}>
            No credit card required · Islamic Mode always free
          </p>
        </div>
      </div>
    </div>
  );
}
