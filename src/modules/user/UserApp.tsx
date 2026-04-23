import { useState, useEffect, useRef } from 'react';
import { Home, Bell, CheckSquare, BookOpen, Settings, RotateCcw, Trash2, AlertTriangle, BarChart3, MapPin } from 'lucide-react';
import { useViewMode } from '../../context/ViewModeContext';
import { useLocation } from '../../lib/useLocation';
import UserHome      from './UserHome';
import RemindersView from './RemindersView';
import TasksView     from './TasksView';
import MemoryView    from './MemoryView';
import RogerSettings from './RogerSettings';
import Onboarding    from './Onboarding';
import UserAnalytics from './UserAnalytics';
import LocationView  from './LocationView';
import { fetchOnboardingState, flushOnboarding, flushAllMemory, flushEverything } from '../../lib/api';
import type { OnboardingAnswers } from '../../lib/onboarding';

type UserTab = 'home' | 'reminders' | 'tasks' | 'memory' | 'analytics' | 'location' | 'settings';
type FlushOp = 'onboarding' | 'memory' | 'all' | null;

const TABS: { key: UserTab; label: string; Icon: typeof Home }[] = [
  { key: 'home',      label: 'HOME',      Icon: Home },
  { key: 'reminders', label: 'REMINDERS', Icon: Bell },
  { key: 'tasks',     label: 'TASKS',     Icon: CheckSquare },
  { key: 'memory',    label: 'MEMORY',    Icon: BookOpen },
  { key: 'analytics', label: 'STATS',     Icon: BarChart3 },
  { key: 'location',  label: 'LOCATE',    Icon: MapPin },
  { key: 'settings',  label: 'SETTINGS',  Icon: Settings },
];

export const USER_ID = 'ADMIN-TEST';

export default function UserApp() {
  const { setViewMode } = useViewMode();
  const [tab, setTab]               = useState<UserTab>('home');
  const [onboarded, setOnboarded]   = useState<boolean | null>(null);
  const [displayName, setDisplayName] = useState<string | undefined>();
  const [flushing, setFlushing]     = useState<FlushOp>(null);
  const [confirm, setConfirm]       = useState<FlushOp>(null);
  const sessionId = useRef(crypto.randomUUID());
  // Lift location to app level so UserHome + LocationView share the same GPS watch
  const { location } = useLocation(USER_ID);

  const loadOnboardingState = () => {
    fetchOnboardingState(USER_ID)
      .then(state => { setOnboarded(state.complete); setDisplayName(state.displayName); })
      .catch(() => setOnboarded(true));
  };

  useEffect(() => { loadOnboardingState(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOnboardingComplete = (answers: OnboardingAnswers) => {
    setOnboarded(true);
    setDisplayName(answers.name);
    sessionId.current = crypto.randomUUID();
  };

  const handleFlush = async (op: FlushOp) => {
    if (!op) return;
    setConfirm(null);
    setFlushing(op);
    try {
      if (op === 'onboarding')     await flushOnboarding(USER_ID);
      else if (op === 'memory')    await flushAllMemory(USER_ID);
      else if (op === 'all')       await flushEverything(USER_ID);
      if (op !== 'memory') {
        setOnboarded(false);
        setDisplayName(undefined);
        sessionId.current = crypto.randomUUID();
      }
      loadOnboardingState();
    } catch { /* silent */ }
    finally { setFlushing(null); }
  };

  // ── Loading ──────────────────────────────────────────────────────────────
  if (onboarded === null) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.2em' }}>
          Initializing...
        </span>
      </div>
    );
  }

  // ── Onboarding ───────────────────────────────────────────────────────────
  if (!onboarded) {
    return <Onboarding userId={USER_ID} onComplete={handleOnboardingComplete} />;
  }

  // ── Main app ─────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column' }}>

      {/* ── Confirm dialog ── */}
      {confirm && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(212,160,68,0.3)', padding: '24px', maxWidth: 320, width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <AlertTriangle size={16} style={{ color: '#ef4444' }} />
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.15em' }}>Confirm</span>
            </div>
            <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', margin: '0 0 20px', lineHeight: 1.6 }}>
              {confirm === 'onboarding' && 'Reset onboarding? Roger will re-introduce himself on next entry.'}
              {confirm === 'memory' && 'Flush all memory? Clears conversations, entities, memories, and surface queue.'}
              {confirm === 'all' && 'Factory reset? Clears ALL memory AND resets onboarding. Cannot be undone.'}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => handleFlush(confirm)} style={{ flex: 1, padding: '8px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', background: '#ef4444', border: 'none', color: '#fff', cursor: 'pointer' }}>
                Confirm
              </button>
              <button onClick={() => setConfirm(null)} style={{ flex: 1, padding: '8px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Admin Control Strip ── */}
      <div style={{ background: 'rgba(212,160,68,0.07)', borderBottom: '1px solid rgba(212,160,68,0.2)', padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.18em', color: 'rgba(212,160,68,0.7)', textTransform: 'uppercase', flex: 1, minWidth: 0 }}>
          ⚠ ADMIN TEST{displayName ? ` · ${displayName}` : ''}
        </span>

        {/* Re-board */}
        <button disabled={!!flushing} onClick={() => setConfirm('onboarding')} title="Reset onboarding — Roger will re-introduce himself"
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.1em', color: flushing === 'onboarding' ? 'var(--amber)' : 'var(--text-muted)', background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', padding: '3px 8px', cursor: flushing ? 'not-allowed' : 'pointer', textTransform: 'uppercase', opacity: flushing && flushing !== 'onboarding' ? 0.4 : 1 }}>
          <RotateCcw size={10} />
          {flushing === 'onboarding' ? 'Resetting...' : 'Re-board'}
        </button>

        {/* Flush Memory */}
        <button disabled={!!flushing} onClick={() => setConfirm('memory')} title="Flush all memory data"
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.1em', color: flushing === 'memory' ? '#ef4444' : 'var(--text-muted)', background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', padding: '3px 8px', cursor: flushing ? 'not-allowed' : 'pointer', textTransform: 'uppercase', opacity: flushing && flushing !== 'memory' ? 0.4 : 1 }}>
          <Trash2 size={10} />
          {flushing === 'memory' ? 'Flushing...' : 'Flush Mem'}
        </button>

        {/* Factory Reset */}
        <button disabled={!!flushing} onClick={() => setConfirm('all')} title="Factory reset — flush everything + restart onboarding"
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.1em', color: flushing === 'all' ? '#ef4444' : '#ef444488', background: flushing === 'all' ? 'rgba(239,68,68,0.1)' : 'transparent', border: '1px solid rgba(239,68,68,0.25)', padding: '3px 8px', cursor: flushing ? 'not-allowed' : 'pointer', textTransform: 'uppercase', opacity: flushing && flushing !== 'all' ? 0.4 : 1 }}>
          <AlertTriangle size={10} />
          {flushing === 'all' ? 'Resetting...' : 'Factory Reset'}
        </button>

        {/* Back to Admin */}
        <button onClick={() => setViewMode('admin')}
          style={{ fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.1em', color: 'var(--amber)', background: 'transparent', border: '1px solid rgba(212,160,68,0.3)', padding: '3px 8px', cursor: 'pointer', textTransform: 'uppercase' }}>
          ← Admin
        </button>
      </div>

      {/* ── Active Tab Content ── */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {tab === 'home'      && <UserHome userId={USER_ID} sessionId={sessionId.current} onTabChange={setTab} location={location} />}
        {tab === 'reminders' && <RemindersView userId={USER_ID} />}
        {tab === 'tasks'     && <TasksView userId={USER_ID} />}
        {tab === 'memory'    && <MemoryView userId={USER_ID} />}
        {tab === 'analytics' && <UserAnalytics userId={USER_ID} />}
        {tab === 'location'  && <LocationView userId={USER_ID} location={location} />}
        {tab === 'settings'  && <RogerSettings userId={USER_ID} />}
      </div>

      {/* ── Bottom Tab Bar ── */}
      <nav style={{ display: 'flex', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-recessed)' }}>
        {TABS.map(({ key, label, Icon }) => {
          const active = tab === key;
          return (
            <button key={key} onClick={() => setTab(key)} style={{ flex: 1, padding: '10px 4px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: 'transparent', border: 'none', cursor: 'pointer', color: active ? 'var(--amber)' : 'var(--text-muted)', borderTop: active ? '2px solid var(--amber)' : '2px solid transparent', transition: 'color 150ms' }}>
              <Icon size={18} />
              <span style={{ fontFamily: 'monospace', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
