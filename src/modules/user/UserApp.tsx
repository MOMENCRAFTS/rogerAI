import { useState, useEffect, useRef } from 'react';
import { Home, Bell, CheckSquare, BookOpen, Settings, RotateCcw, Trash2, AlertTriangle, BarChart3, MapPin, BookMarked, Map } from 'lucide-react';
import { useViewMode } from '../../context/ViewModeContext';
import { useAuth } from '../../context/AuthContext';
import { useLocation } from '../../lib/useLocation';
import UserHome      from './UserHome';
import RemindersView from './RemindersView';
import TasksView     from './TasksView';
import MemoryView    from './MemoryView';
import RogerSettings from './RogerSettings';
import Onboarding    from './Onboarding';
import FeatureTour   from './FeatureTour';
import UserAnalytics from './UserAnalytics';
import LocationView  from './LocationView';
import JournalView   from './JournalView';
import PermissionGate from '../../components/PermissionGate';
import { fetchOnboardingState, flushOnboarding, flushAllMemory, flushEverything, fetchUserPreferences, fetchReminders, fetchTasks, hasTourBeenSeen, markTourSeen, flushTourSeen } from '../../lib/api';
import { TOUR_VERSION } from '../../lib/featureTour';
import type { OnboardingAnswers } from '../../lib/onboarding';
import { setHapticsEnabled } from '../../lib/haptics';
import { setSfxEnabled, setSfxVolume } from '../../lib/sfx';
import { hasGrantedPermissions, markPermissionsGranted } from '../../lib/audioPermission';

type UserTab = 'home' | 'reminders' | 'tasks' | 'memory' | 'journal' | 'analytics' | 'location' | 'settings';
type FlushOp = 'onboarding' | 'memory' | 'all' | null;

interface UserAppProps {
  userId: string;
  userEmail: string;
}

const TABS: { key: UserTab; label: string; Icon: typeof Home }[] = [
  { key: 'home',      label: 'HOME',     Icon: Home },
  { key: 'reminders', label: 'REMIND',   Icon: Bell },
  { key: 'tasks',     label: 'TASKS',    Icon: CheckSquare },
  { key: 'memory',    label: 'MEMORY',   Icon: BookOpen },
  { key: 'journal',   label: 'JOURNAL',  Icon: BookMarked },
  { key: 'analytics', label: 'STATS',    Icon: BarChart3 },
  { key: 'location',  label: 'LOCATE',   Icon: MapPin },
  { key: 'settings',  label: 'SETTINGS', Icon: Settings },
];

export default function UserApp({ userId, userEmail }: UserAppProps) {
  const { setViewMode } = useViewMode();
  const { isAdmin } = useAuth();
  const [tab, setTab]               = useState<UserTab>('home');
  const [onboarded, setOnboarded]   = useState<boolean | null>(null);
  const [tourSeen, setTourSeen]     = useState<boolean | null>(null);
  const [displayName, setDisplayName] = useState<string | undefined>();
  const [flushing, setFlushing]     = useState<FlushOp>(null);
  const [confirm, setConfirm]       = useState<FlushOp>(null);
  const [reminderCount, setReminderCount] = useState(0);
  const [taskCount, setTaskCount]   = useState(0);
  const sessionId = useRef(crypto.randomUUID());
  const { location } = useLocation(userId);

  // ── Permission gate — shown once on first install ─────────────────────────
  // Must be checked at component mount time (not lazily) so the gate renders
  // before onboarding and primes the Android audio pipeline on first tap.
  const [permsGranted, setPermsGranted] = useState<boolean>(hasGrantedPermissions);

  const refreshBadges = () => {
    fetchReminders(userId, 'pending').then(r => setReminderCount(r.length)).catch(() => {});
    fetchTasks(userId, 'open').then(t => setTaskCount(t.length)).catch(() => {});
  };

  useEffect(() => { refreshBadges(); }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const h = () => refreshBadges();
    window.addEventListener('roger:refresh', h);
    return () => window.removeEventListener('roger:refresh', h);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadOnboardingState = () => {
    fetchOnboardingState(userId)
      .then(state => {
        setOnboarded(state.complete);
        setDisplayName(state.displayName);
        // Only check tour once we know user is onboarded
        if (state.complete) {
          hasTourBeenSeen(userId, TOUR_VERSION)
            .then(seen => setTourSeen(seen))
            .catch(() => setTourSeen(true)); // fail-safe: don't block app
        }
      })
      .catch(() => { setOnboarded(true); setTourSeen(true); });
  };

  useEffect(() => { loadOnboardingState(); }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply persisted UX preferences to runtime modules
  const applyUXPrefs = () => {
    fetchUserPreferences(userId).then(prefs => {
      if (!prefs) return;
      setHapticsEnabled(prefs.haptic_enabled ?? true);
      setSfxEnabled(prefs.sfx_enabled ?? true);
      setSfxVolume(Number(localStorage.getItem('sfxVolume') ?? 0.35));
    }).catch(() => {});
  };

  useEffect(() => { applyUXPrefs(); }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOnboardingComplete = (answers: OnboardingAnswers) => {
    setOnboarded(true);
    setTourSeen(false); // Always show tour after fresh profiling
    if (answers.name) setDisplayName(answers.name);
    applyUXPrefs();
  };

  const handleFlush = async (op: FlushOp) => {
    if (!op) return;
    setConfirm(null);
    setFlushing(op);
    try {
      if (op === 'onboarding')     await flushOnboarding(userId);
      else if (op === 'memory')    await flushAllMemory(userId);
      else if (op === 'all')       await flushEverything(userId);
      if (op !== 'memory') {
        setOnboarded(false);
        setTourSeen(null);
        setDisplayName(undefined);
        sessionId.current = crypto.randomUUID();
      }
      loadOnboardingState();
    } catch { /* silent */ }
    finally { setFlushing(null); }
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (onboarded === null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--bg-base)' }}>
        <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          Initialising...
        </span>
      </div>
    );
  }

  // ── Permission Gate (first launch only) ──────────────────────────────────
  // Renders before onboarding so the very first user gesture (GRANT ACCESS tap)
  // primes the Android WebView audio pipeline. unlockAudio() and unlockSfxContext()
  // are called inside PermissionGate.onGranted before we proceed.
  if (!permsGranted) {
    return (
      <PermissionGate
        onGranted={() => {
          markPermissionsGranted();
          setPermsGranted(true);
        }}
      />
    );
  }

  // ── Onboarding ───────────────────────────────────────────────────────────
  if (!onboarded) {
    return <Onboarding userId={userId} onComplete={handleOnboardingComplete} />;
  }

  // ── Mission Brief Tour ────────────────────────────────────────────────────
  if (tourSeen === false) {
    return (
      <FeatureTour
        displayName={displayName}
        onComplete={() => {
          markTourSeen(userId, TOUR_VERSION).catch(() => {});
          setTourSeen(true);
        }}
      />
    );
  }

  // ── Main app ─────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', position: 'relative' }}>

      {/* ── Confirm dialog ── */}
      {confirm && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', padding: '24px 28px', maxWidth: 320, width: '90%' }}>
            <p style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', marginBottom: 20 }}>
              {confirm === 'onboarding' && 'Reset onboarding? Roger will re-introduce himself.'}
              {confirm === 'memory'     && 'Flush all memory? This cannot be undone.'}
              {confirm === 'all'        && '⚠ Factory reset? All data will be erased.'}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => handleFlush(confirm)} style={{ flex: 1, padding: '8px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', background: confirm === 'all' ? 'rgba(239,68,68,0.15)' : 'rgba(212,160,68,0.1)', border: `1px solid ${confirm === 'all' ? 'rgba(239,68,68,0.4)' : 'rgba(212,160,68,0.3)'}`, color: confirm === 'all' ? '#f87171' : 'var(--amber)', cursor: 'pointer' }}>
                Confirm
              </button>
              <button onClick={() => setConfirm(null)} style={{ flex: 1, padding: '8px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Admin Control Strip — only visible to admins ── */}
      {isAdmin && (
        <div style={{ background: 'rgba(212,160,68,0.07)', borderBottom: '1px solid rgba(212,160,68,0.2)', padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.18em', color: 'rgba(212,160,68,0.7)', textTransform: 'uppercase', flex: 1, minWidth: 0 }}>
            ⚠ ADMIN · {userEmail}{displayName ? ` · ${displayName}` : ''}
          </span>

          <button disabled={!!flushing} onClick={() => setConfirm('onboarding')} title="Reset onboarding"
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.1em', color: flushing === 'onboarding' ? 'var(--amber)' : 'var(--text-muted)', background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', padding: '3px 8px', cursor: flushing ? 'not-allowed' : 'pointer', textTransform: 'uppercase', opacity: flushing && flushing !== 'onboarding' ? 0.4 : 1 }}>
            <RotateCcw size={10} />
            {flushing === 'onboarding' ? 'Resetting...' : 'Re-board'}
          </button>

          {/* Replay tour button */}
          <button
            disabled={!!flushing}
            onClick={() => { flushTourSeen(userId).catch(() => {}); setTourSeen(false); }}
            title="Replay mission brief tour"
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.1em', color: 'var(--text-muted)', background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', padding: '3px 8px', cursor: flushing ? 'not-allowed' : 'pointer', textTransform: 'uppercase', opacity: flushing ? 0.4 : 1 }}>
            <Map size={10} />
            Tour
          </button>

          <button disabled={!!flushing} onClick={() => setConfirm('memory')} title="Flush all memory"
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.1em', color: flushing === 'memory' ? '#ef4444' : 'var(--text-muted)', background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', padding: '3px 8px', cursor: flushing ? 'not-allowed' : 'pointer', textTransform: 'uppercase', opacity: flushing && flushing !== 'memory' ? 0.4 : 1 }}>
            <Trash2 size={10} />
            {flushing === 'memory' ? 'Flushing...' : 'Flush Mem'}
          </button>

          <button disabled={!!flushing} onClick={() => setConfirm('all')} title="Factory reset"
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.1em', color: flushing === 'all' ? '#ef4444' : '#ef444488', background: flushing === 'all' ? 'rgba(239,68,68,0.1)' : 'transparent', border: '1px solid rgba(239,68,68,0.25)', padding: '3px 8px', cursor: flushing ? 'not-allowed' : 'pointer', textTransform: 'uppercase', opacity: flushing && flushing !== 'all' ? 0.4 : 1 }}>
            <AlertTriangle size={10} />
            {flushing === 'all' ? 'Resetting...' : 'Factory Reset'}
          </button>

          <button onClick={() => setViewMode('admin')}
            style={{ fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.1em', color: 'var(--amber)', background: 'transparent', border: '1px solid rgba(212,160,68,0.3)', padding: '3px 8px', cursor: 'pointer', textTransform: 'uppercase' }}>
            ← Admin
          </button>
        </div>
      )}

      {/* ── Tab Content — all panels stay mounted, hidden via CSS to preserve state ── */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', display: tab === 'home'      ? 'flex' : 'none', flexDirection: 'column' }}>
          <UserHome userId={userId} sessionId={sessionId.current} onTabChange={setTab} location={location} />
        </div>
        <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', display: tab === 'reminders' ? 'block' : 'none' }}>
          <RemindersView userId={userId} />
        </div>
        <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', display: tab === 'tasks'     ? 'block' : 'none' }}>
          <TasksView userId={userId} />
        </div>
        <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', display: tab === 'memory'    ? 'block' : 'none' }}>
          <MemoryView userId={userId} />
        </div>
        <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', display: tab === 'journal'   ? 'block' : 'none' }}>
          <JournalView userId={userId} />
        </div>
        <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', display: tab === 'analytics' ? 'block' : 'none' }}>
          <UserAnalytics userId={userId} />
        </div>
        <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', display: tab === 'location'  ? 'block' : 'none' }}>
          <LocationView userId={userId} location={location} />
        </div>
        <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', display: tab === 'settings'  ? 'block' : 'none' }}>
          <RogerSettings userId={userId} onReplayTour={() => setTourSeen(false)} />
        </div>
      </div>

      {/* ── Bottom Nav ── */}
      <nav style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', display: 'flex', flexShrink: 0 }}>
        {TABS.map(({ key, label, Icon }) => {
          const active = tab === key;
          const badge = key === 'reminders' ? reminderCount : key === 'tasks' ? taskCount : 0;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 3, padding: '8px 2px', position: 'relative',
                background: 'transparent', border: 'none', cursor: 'pointer',
                borderTop: `2px solid ${active ? 'var(--amber)' : 'transparent'}`,
                transition: 'border-color 150ms',
              }}
            >
              <div style={{ position: 'relative' }}>
                <Icon size={16} style={{ color: active ? 'var(--amber)' : 'var(--text-muted)', transition: 'color 150ms' }} />
                {badge > 0 && (
                  <span style={{
                    position: 'absolute', top: -5, right: -6,
                    minWidth: 14, height: 14, borderRadius: 7,
                    background: '#ef4444', color: '#fff',
                    fontFamily: 'monospace', fontSize: 8, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '0 3px',
                  }}>
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </div>
              <span style={{
                fontFamily: 'monospace', fontSize: 8,
                letterSpacing: '0.08em', textTransform: 'uppercase',
                color: active ? 'var(--amber)' : 'var(--text-muted)',
                transition: 'color 150ms',
              }}>
                {label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
