/**
 * SubscriptionView.tsx — User-facing plan management & upgrade page.
 * Shows current plan, usage meters, 3-tier pricing cards, and Stripe-ready CTA.
 */
import { useState } from 'react';
import { Crown, Zap, Check, Radio, Users, Star } from 'lucide-react';
import { useSubscription, FREE_LIMITS } from '../../lib/useSubscription';
import type { SubscriptionPlan } from '../../lib/useSubscription';
import { useI18n } from '../../context/I18nContext';

interface Props { userId: string }

const PLANS: {
  key: SubscriptionPlan;
  name: string;
  badge?: string;
  monthlyPrice: string;
  annualPrice: string;
  annualSaving: string;
  color: string;
  border: string;
  icon: typeof Crown;
  features: string[];
}[] = [
  {
    key: 'free',
    name: 'ROGER FREE',
    monthlyPrice: '$0',
    annualPrice: '$0',
    annualSaving: '',
    color: 'var(--text-muted)',
    border: 'var(--border-subtle)',
    icon: Radio,
    features: [
      '50 PTT transmissions/day',
      '10 reminders · 20 tasks',
      '100 memory facts',
      '3 Tune In sessions/day',
      'Morning & evening briefings',
      'Commute radar & hazard reporting',
      'Islamic Mode (always free)',
      '7-day analytics',
    ],
  },
  {
    key: 'pro',
    name: 'ROGER PRO',
    badge: 'MOST POPULAR',
    monthlyPrice: '$9.99',
    annualPrice: '$79',
    annualSaving: 'Save 34%',
    color: 'var(--amber)',
    border: 'rgba(212,160,68,0.5)',
    icon: Crown,
    features: [
      'Unlimited PTT transmissions',
      'Unlimited reminders & tasks',
      'Unlimited memory storage',
      'GPT-5.5 full quality responses',
      'Meeting recorder (3h/session)',
      'Ambient listener',
      'Proactive AI check-ins',
      'Geo-fence reminders',
      'Lifetime analytics + weekly digest',
      'Arabic, French, Spanish, English',
      'Spotify, Calendar, Notion, SMS',
      'ESP32 hardware sync',
      'Emergency PTT broadcast',
    ],
  },
  {
    key: 'command',
    name: 'ROGER COMMAND',
    badge: 'TEAMS',
    monthlyPrice: '$29.99',
    annualPrice: '$249',
    annualSaving: 'Save 31%',
    color: '#a78bfa',
    border: 'rgba(167,139,250,0.4)',
    icon: Users,
    features: [
      'Everything in Pro',
      'Team Tune In (up to 10 users)',
      'Shared contact relay network',
      'Multi-device sync',
      'Admin org dashboard',
      'Webhook output (Zapier etc.)',
      'Custom Roger persona name',
      'White-label callsign prefix',
      'Priority support',
    ],
  },
];

function UsageMeter({ label, used, max, color }: { label: string; used: number; max: number; color: string }) {
  const pct = Math.min(100, Math.round((used / max) * 100));
  const warn = pct >= 80;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</span>
        <span style={{ fontFamily: 'monospace', fontSize: 9, color: warn ? '#ef4444' : color }}>
          {used}/{max}
        </span>
      </div>
      <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: warn ? '#ef4444' : color, borderRadius: 2, transition: 'width 600ms ease' }} />
      </div>
    </div>
  );
}

export default function SubscriptionView({ userId }: Props) {
  const { t: _t } = useI18n();
  const {
    plan, status, isPro, isTrialing, trialDaysLeft,
    pttUsedToday, startTrial, loading,
  } = useSubscription(userId);

  const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly');
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState(false);

  const handleTrial = async () => {
    setStarting(true);
    await startTrial();
    setStarted(true);
    setStarting(false);
  };

  if (loading) {
    return (
      <div style={{ padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.2em' }}>Loading plan...</span>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px', fontFamily: 'monospace' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <Crown size={16} style={{ color: 'var(--amber)' }} />
        <span style={{ fontSize: 13, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>
          Subscription
        </span>
      </div>

      {/* Current plan status card */}
      <div style={{ marginBottom: 24, padding: '16px', background: 'var(--bg-elevated)', border: `1px solid ${isPro ? 'rgba(212,160,68,0.3)' : 'var(--border-subtle)'}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', margin: '0 0 2px' }}>Current Plan</p>
            <p style={{ fontSize: 18, color: isPro ? 'var(--amber)' : 'var(--text-primary)', fontWeight: 700, margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {plan === 'free' ? 'Roger Free' : plan === 'pro' ? 'Roger Pro' : 'Roger Command'}
            </p>
          </div>
          <div style={{ padding: '4px 10px', border: `1px solid ${status === 'active' || status === 'trialing' ? 'var(--green-border)' : '#ef4444'}`, background: status === 'active' || status === 'trialing' ? 'var(--green-dim)' : 'rgba(239,68,68,0.08)' }}>
            <span style={{ fontSize: 9, color: status === 'active' || status === 'trialing' ? 'var(--green)' : '#ef4444', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
              {status === 'trialing' ? `Trial · ${trialDaysLeft}d left` : status}
            </span>
          </div>
        </div>

        {/* Usage meters — only shown on free */}
        {!isPro && (
          <div>
            <p style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10 }}>Today's Usage</p>
            <UsageMeter label="PTT Transmissions" used={pttUsedToday} max={FREE_LIMITS.ptt_daily} color="var(--amber)" />
          </div>
        )}

        {/* Trial success banner */}
        {(started || isTrialing) && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.25)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Star size={12} style={{ color: 'var(--green)' }} />
            <span style={{ fontSize: 10, color: 'var(--green)' }}>
              {isTrialing ? `Pro trial active — ${trialDaysLeft} days remaining` : 'Pro trial activated! All features unlocked.'}
            </span>
          </div>
        )}

        {/* Stripe coming soon notice */}
        {isPro && !isTrialing && (
          <p style={{ fontSize: 9, color: 'rgba(212,160,68,0.5)', margin: '10px 0 0' }}>
            Payment billing via Stripe — coming soon. Your access is active.
          </p>
        )}
      </div>

      {/* Billing toggle */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, padding: '4px', background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)', width: 'fit-content' }}>
        {(['monthly', 'annual'] as const).map(b => (
          <button key={b} onClick={() => setBilling(b)} style={{
            padding: '6px 16px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', cursor: 'pointer', border: 'none',
            background: billing === b ? 'rgba(212,160,68,0.15)' : 'transparent',
            color: billing === b ? 'var(--amber)' : 'var(--text-muted)',
            transition: 'all 150ms',
          }}>{b}</button>
        ))}
      </div>

      {/* Plan cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 }}>
        {PLANS.map(p => {
          const isCurrent = plan === p.key;
          const price = billing === 'annual' ? p.annualPrice : p.monthlyPrice;
          const priceSuffix = billing === 'annual' && p.key !== 'free' ? '/yr' : p.key !== 'free' ? '/mo' : '';
          const PlanIcon = p.icon;

          return (
            <div key={p.key} style={{
              border: `1px solid ${isCurrent ? p.border : 'var(--border-subtle)'}`,
              background: isCurrent ? `${p.color.replace('var(--amber)', 'rgba(212,160,68')}08)`.replace('08)', '0.04)') : 'var(--bg-elevated)',
              padding: '16px',
              position: 'relative',
              transition: 'border-color 150ms',
            }}>
              {/* Badge */}
              {p.badge && (
                <div style={{ position: 'absolute', top: -10, right: 16, padding: '2px 10px', background: p.color === 'var(--amber)' ? 'var(--amber)' : '#a78bfa', color: '#0a0a08', fontFamily: 'monospace', fontSize: 8, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                  {p.badge}
                </div>
              )}

              {/* Plan header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <PlanIcon size={14} style={{ color: p.color, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 11, color: p.color, fontWeight: 700, margin: 0, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{p.name}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: 20, color: isCurrent ? p.color : 'var(--text-primary)', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
                    {price}<span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)' }}>{priceSuffix}</span>
                  </p>
                  {billing === 'annual' && p.annualSaving && (
                    <p style={{ fontSize: 9, color: 'var(--green)', margin: 0 }}>{p.annualSaving}</p>
                  )}
                </div>
              </div>

              {/* Features */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                {p.features.map(f => (
                  <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <Check size={10} style={{ color: p.color, flexShrink: 0, marginTop: 2 }} />
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{f}</span>
                  </div>
                ))}
              </div>

              {/* CTA */}
              {isCurrent ? (
                <div style={{ padding: '8px', textAlign: 'center', border: `1px solid ${p.border}`, fontSize: 10, color: p.color, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  ● Current Plan
                </div>
              ) : p.key === 'free' ? null : (
                <button
                  id={`upgrade-to-${p.key}-btn`}
                  onClick={p.key === 'pro' ? handleTrial : undefined}
                  disabled={starting}
                  style={{ width: '100%', padding: '10px', cursor: starting ? 'not-allowed' : 'pointer', fontFamily: 'monospace', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', border: `1px solid ${p.border}`, background: 'transparent', color: p.color, transition: 'background 150ms', opacity: starting ? 0.6 : 1 }}
                  onMouseEnter={e => (e.currentTarget.style.background = `${p.color === 'var(--amber)' ? 'rgba(212,160,68,0.1)' : 'rgba(167,139,250,0.1)'}`)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {starting ? 'Activating...' : p.key === 'pro' ? 'Start 7-Day Free Trial →' : 'Contact Us →'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Add-ons section */}
      <div style={{ marginBottom: 28 }}>
        <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 12 }}>Add-Ons</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { label: 'Extra Tune In Minutes', price: '$1.99/100 min', desc: 'For Free users — buy extra Tune In time' },
            { label: 'Memory Vault Export', price: '$2.99 once', desc: 'Export all memories as JSON or PDF' },
            { label: 'Custom Voice Persona', price: '$4.99/mo', desc: 'Different TTS voice & Roger persona name' },
          ].map(a => (
            <div key={a.label} style={{ padding: '12px 14px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <Zap size={12} style={{ color: 'var(--amber)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 11, color: 'var(--text-primary)', margin: '0 0 2px', fontWeight: 600 }}>{a.label}</p>
                <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>{a.desc}</p>
              </div>
              <span style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 700, flexShrink: 0 }}>{a.price}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer note */}
      <div style={{ padding: '12px 14px', border: '1px solid rgba(212,160,68,0.15)', background: 'rgba(212,160,68,0.03)' }}>
        <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
          🛡 <span style={{ color: 'var(--amber)' }}>Islamic Mode</span> — Prayer times, Qibla, Quran — always free.<br />
          💳 Stripe payment integration coming soon. All upgrades applied instantly.
        </p>
      </div>
    </div>
  );
}
