/**
 * SubscriptionMonitor.tsx — Admin subscription management panel.
 * Lists all users, their plan/status, and lets admins manually override plans.
 */
import { useState, useEffect, useCallback } from 'react';
import { CreditCard, Crown, RefreshCw, Search, Users, CheckCircle2, AlertCircle, ChevronDown } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { SubscriptionPlan, SubscriptionStatus } from '../lib/useSubscription';

interface UserSubRow {
  user_id: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  trial_ends_at: string | null;
  current_period_end: string | null;
  stripe_customer_id: string | null;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
  // Joined from auth.users via admin view
  email?: string;
}

const PLAN_COLORS: Record<SubscriptionPlan, string> = {
  free: 'var(--text-muted)',
  pro: 'var(--amber)',
  command: '#a78bfa',
};

const STATUS_COLORS: Record<SubscriptionStatus, string> = {
  active: 'var(--green)',
  trialing: 'var(--amber)',
  cancelled: '#ef4444',
  past_due: '#f97316',
};

function rel(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function SubscriptionMonitor() {
  const [rows, setRows] = useState<UserSubRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterPlan, setFilterPlan] = useState<SubscriptionPlan | 'all'>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPlan, setEditPlan] = useState<SubscriptionPlan>('free');
  const [editStatus, setEditStatus] = useState<SubscriptionStatus>('active');
  const [editNote, setEditNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Try the admin view first (requires migration 021 + auth.users access)
      const { data, error } = await supabase
        .from('user_subscriptions')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(200);
      if (!error && data) {
        setRows(data as UserSubRow[]);
      }
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openEdit = (row: UserSubRow) => {
    setEditingId(row.user_id);
    setEditPlan(row.plan);
    setEditStatus(row.status);
    setEditNote(row.admin_note ?? '');
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('user_subscriptions').upsert({
        user_id: editingId,
        plan: editPlan,
        status: editStatus,
        admin_note: editNote || null,
        updated_by: user?.id ?? 'admin',
        updated_at: new Date().toISOString(),
      });
      setRows(prev => prev.map(r => r.user_id === editingId
        ? { ...r, plan: editPlan, status: editStatus, admin_note: editNote || null }
        : r
      ));
      setEditingId(null);
    } catch { /* silent */ }
    setSaving(false);
  };

  const grantTrial = async (userId: string) => {
    const trialEnd = new Date(Date.now() + 7 * 86_400_000).toISOString();
    await supabase.from('user_subscriptions').upsert({
      user_id: userId, plan: 'pro', status: 'trialing',
      trial_ends_at: trialEnd, updated_at: new Date().toISOString(),
    });
    setRows(prev => prev.map(r => r.user_id === userId
      ? { ...r, plan: 'pro', status: 'trialing', trial_ends_at: trialEnd }
      : r
    ));
  };

  const filtered = rows.filter(r => {
    const matchSearch = !search || r.user_id.includes(search) || (r.email ?? '').toLowerCase().includes(search.toLowerCase());
    const matchPlan = filterPlan === 'all' || r.plan === filterPlan;
    return matchSearch && matchPlan;
  });

  // KPIs
  const total = rows.length;
  const proCount = rows.filter(r => r.plan === 'pro' && (r.status === 'active' || r.status === 'trialing')).length;
  const commandCount = rows.filter(r => r.plan === 'command' && r.status === 'active').length;
  const trialCount = rows.filter(r => r.status === 'trialing').length;
  const mrrEst = proCount * 9.99 + commandCount * 29.99;

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-4 lg:p-6 space-y-4" style={{ fontFamily: 'monospace' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div>
          <h1 style={{ fontSize: 11, letterSpacing: '0.25em', textTransform: 'uppercase', color: 'var(--amber)', margin: 0 }}>Subscription Monitor</h1>
          <p style={{ fontSize: 9, color: 'var(--text-muted)', margin: '2px 0 0', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Billing & Entitlement Management</p>
        </div>
        <button onClick={load} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', cursor: loading ? 'not-allowed' : 'pointer' }}>
          <RefreshCw size={10} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /> Refresh
        </button>
      </div>

      {/* KPI Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {[
          { label: 'TOTAL SUBSCRIBERS', value: total, color: 'var(--text-primary)', icon: Users },
          { label: 'PRO / COMMAND', value: `${proCount} / ${commandCount}`, color: 'var(--amber)', icon: Crown },
          { label: 'ACTIVE TRIALS', value: trialCount, color: '#a78bfa', icon: CheckCircle2 },
          { label: 'EST. MRR', value: `$${mrrEst.toFixed(0)}`, color: 'var(--green)', icon: CreditCard },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} style={{ padding: '14px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Icon size={11} style={{ color, opacity: 0.7 }} />
              <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>{label}</span>
            </div>
            <span style={{ fontSize: 22, fontWeight: 700, color, letterSpacing: '-0.02em' }}>{value}</span>
          </div>
        ))}
      </div>

      {/* Stripe readiness notice */}
      <div style={{ padding: '10px 14px', border: '1px solid rgba(212,160,68,0.2)', background: 'rgba(212,160,68,0.04)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <AlertCircle size={12} style={{ color: 'var(--amber)', flexShrink: 0 }} />
        <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
          <span style={{ color: 'var(--amber)' }}>Mockup mode active</span> — Stripe webhook not yet wired. Admin can manually set plans below. Stripe integration: wire{' '}
          <span style={{ color: 'var(--amber)' }}>VITE_STRIPE_PUBLISHABLE_KEY</span> + deploy the{' '}
          <span style={{ color: 'var(--amber)' }}>stripe-webhook</span> Edge Function.
        </p>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <Search size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Search by user ID or email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', padding: '8px 10px 8px 32px', fontFamily: 'monospace', fontSize: 11, background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ position: 'relative' }}>
          <select
            value={filterPlan}
            onChange={e => setFilterPlan(e.target.value as SubscriptionPlan | 'all')}
            style={{ padding: '8px 32px 8px 12px', fontFamily: 'monospace', fontSize: 10, background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none', textTransform: 'uppercase', letterSpacing: '0.08em', appearance: 'none', cursor: 'pointer' }}
          >
            <option value="all">All Plans</option>
            <option value="free">Free</option>
            <option value="pro">Pro</option>
            <option value="command">Command</option>
          </select>
          <ChevronDown size={10} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
        </div>
      </div>

      {/* Edit modal */}
      {editingId && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(212,160,68,0.3)', maxWidth: 380, width: '100%', padding: 24 }}>
            <p style={{ fontSize: 12, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 20, fontWeight: 700 }}>Override Subscription</p>
            <p style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.1em' }}>User ID</p>
            <p style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 16, wordBreak: 'break-all' }}>{editingId}</p>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 5 }}>Plan</label>
              <select value={editPlan} onChange={e => setEditPlan(e.target.value as SubscriptionPlan)} style={{ width: '100%', padding: '8px', fontFamily: 'monospace', fontSize: 12, background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none' }}>
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="command">Command</option>
              </select>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 5 }}>Status</label>
              <select value={editStatus} onChange={e => setEditStatus(e.target.value as SubscriptionStatus)} style={{ width: '100%', padding: '8px', fontFamily: 'monospace', fontSize: 12, background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none' }}>
                <option value="active">Active</option>
                <option value="trialing">Trialing</option>
                <option value="cancelled">Cancelled</option>
                <option value="past_due">Past Due</option>
              </select>
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 5 }}>Admin Note</label>
              <input type="text" value={editNote} onChange={e => setEditNote(e.target.value)} placeholder="e.g. Beta tester, press access..." style={{ width: '100%', padding: '8px', fontFamily: 'monospace', fontSize: 11, background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={saveEdit} disabled={saving} style={{ flex: 1, padding: '9px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', background: 'rgba(212,160,68,0.15)', border: '1px solid rgba(212,160,68,0.4)', color: 'var(--amber)', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Saving...' : 'Save Override'}
              </button>
              <button onClick={() => setEditingId(null)} style={{ flex: 1, padding: '9px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div style={{ border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', gap: 0, borderBottom: '1px solid var(--border-subtle)', padding: '8px 14px', background: 'var(--bg-recessed)' }}>
          {['USER', 'PLAN', 'STATUS', 'TRIAL ENDS', 'UPDATED', 'ACTIONS'].map(h => (
            <span key={h} style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>{h}</span>
          ))}
        </div>

        {loading && (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>Loading subscriptions...</div>
        )}

        {!loading && filtered.length === 0 && (
          <div style={{ padding: '40px', textAlign: 'center' }}>
            <CreditCard size={28} style={{ color: 'var(--text-muted)', opacity: 0.3, marginBottom: 10 }} />
            <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
              {rows.length === 0 ? 'No subscriptions yet — run migration 021' : 'No results found'}
            </p>
          </div>
        )}

        {filtered.map((row, i) => (
          <div key={row.user_id} style={{
            display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr',
            padding: '10px 14px', alignItems: 'center',
            borderTop: i > 0 ? '1px solid var(--border-dim)' : 'none',
            background: editingId === row.user_id ? 'rgba(212,160,68,0.04)' : 'transparent',
          }}>
            {/* User */}
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 10, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.email ?? row.user_id.slice(0, 12) + '…'}
              </p>
              {row.admin_note && (
                <p style={{ fontSize: 8, color: 'var(--amber)', margin: '2px 0 0', opacity: 0.7 }}>📝 {row.admin_note}</p>
              )}
            </div>

            {/* Plan */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {row.plan === 'pro' && <Crown size={9} style={{ color: 'var(--amber)' }} />}
              <span style={{ fontSize: 10, color: PLAN_COLORS[row.plan], textTransform: 'uppercase', fontWeight: 600 }}>{row.plan}</span>
            </div>

            {/* Status */}
            <span style={{ fontSize: 9, color: STATUS_COLORS[row.status], textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {row.status === 'trialing' && '⏳ '}
              {row.status}
            </span>

            {/* Trial ends */}
            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
              {row.trial_ends_at ? new Date(row.trial_ends_at).toLocaleDateString() : '—'}
            </span>

            {/* Updated */}
            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{rel(row.updated_at)}</span>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              <button onClick={() => openEdit(row)} style={{ padding: '3px 8px', fontFamily: 'monospace', fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.08em', background: 'rgba(212,160,68,0.08)', border: '1px solid rgba(212,160,68,0.25)', color: 'var(--amber)', cursor: 'pointer' }}>
                Edit
              </button>
              {row.plan === 'free' && (
                <button onClick={() => grantTrial(row.user_id)} style={{ padding: '3px 8px', fontFamily: 'monospace', fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.08em', background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', cursor: 'pointer' }}>
                  +Trial
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Footer note */}
      <p style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.6, opacity: 0.7 }}>
        Manual overrides update <code>user_subscriptions</code> directly. Stripe webhooks will override these when wired.
      </p>
    </div>
  );
}
