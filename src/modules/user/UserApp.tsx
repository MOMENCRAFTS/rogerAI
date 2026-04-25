import { useState, useEffect, useRef } from 'react';
import { Home, Bell, CheckSquare, BookOpen, Settings, RotateCcw, Trash2, AlertTriangle, BarChart3, MapPin, BookMarked, Map, Car, Mic, Crown, Moon } from 'lucide-react';
import { useViewMode } from '../../context/ViewModeContext';
import { useAuth } from '../../context/AuthContext';
import { useLocation } from '../../lib/useLocation';
import UserHome      from './UserHome';
import RemindersView from './RemindersView';
import TasksView     from './TasksView';
import MemoryView    from './MemoryView';
import RogerSettings from './RogerSettings';
import Onboarding    from './Onboarding';
import Orientation   from './Orientation';
import UserAnalytics from './UserAnalytics';
import LocationView  from './LocationView';
import JournalView   from './JournalView';
import CommuteRadar  from './CommuteRadar';
import MeetingRecorderView from './MeetingRecorderView';
import SubscriptionView  from './SubscriptionView';
import SalahView        from './SalahView';
import PermissionGate from '../../components/PermissionGate';
import { fetchOnboardingState, flushOnboarding, flushAllMemory, flushEverything, fetchUserPreferences, fetchReminders, fetchTasks, hasOrientationBeenSeen, markOrientationSeen } from '../../lib/api';
import { ORIENTATION_VERSION } from '../../lib/orientationScript';
import type { OnboardingAnswers } from '../../lib/onboarding';
import { setHapticsEnabled } from '../../lib/haptics';
import { setSfxEnabled, setSfxVolume } from '../../lib/sfx';
import { hasGrantedPermissions, markPermissionsGranted } from '../../lib/audioPermission';

type UserTab = 'home' | 'reminders' | 'tasks' | 'memory' | 'journal' | 'analytics' | 'location' | 'commute' | 'meetings' | 'upgrade' | 'salah' | 'settings';
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
  { key: 'meetings',  label: 'MEETINGS', Icon: Mic },
  { key: 'journal',   label: 'JOURNAL',  Icon: BookMarked },
  { key: 'analytics', label: 'STATS',    Icon: BarChart3 },
  { key: 'location',  label: 'LOCATE',   Icon: MapPin },
  { key: 'commute',   label: 'DRIVE',    Icon: Car },
  { key: 'upgrade',   label: 'UPGRADE',  Icon: Crown },
  { key: 'salah',     label: 'SALAH',    Icon: Moon },
  { key: 'settings',  label: 'SETTINGS', Icon: Settings },
];

export default function UserApp({ userId, userEmail }: UserAppProps) {
  const { setViewMode } = useViewMode();
  const { isAdmin } = useAuth();
  const [tab, setTab]                   = useState<UserTab>('home');
  const [mountedTabs, setMountedTabs]   = useState<Set<UserTab>>(new Set(['home']));
  const [onboarded, setOnboarded]       = useState<boolean | null>(null);
  const [orientationSeen, setOrientationSeen] = useState<boolean | null>(null);
  const [displayName, setDisplayName]   = useState<string | undefined>();
  const [flushing, setFlushing]     = useState<FlushOp>(null);
  const [confirm, setConfirm]       = useState<FlushOp>(null);
  const [reminderCount, setReminderCount] = useState(0);
  const [taskCount, setTaskCount]   = useState(0);
  const sessionId = useRef(crypto.randomUUID());
  const { location } = useLocation(userId);
  const [islamicMode, setIslamicMode] = useState(false);

  // Mount a tab on first visit, keep it alive for instant re-visits
  const handleTabChange = (newTab: UserTab) => {
    setMountedTabs(prev => { const s = new Set(prev); s.add(newTab); return s; });
    setTab(newTab);
  };

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
        if (state.complete) {
          hasOrientationBeenSeen(userId, ORIENTATION_VERSION)
            .then(seen => setOrientationSeen(seen))
            .catch(() => setOrientationSeen(true));
        }
      })
      .catch(() => { setOnboarded(true); setOrientationSeen(true); });
  };

  useEffect(() => { loadOnboardingState(); }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply persisted UX preferences to runtime modules
  const applyUXPrefs = () => {
    fetchUserPreferences(userId).then(prefs => {
      if (!prefs) return;
      setHapticsEnabled(prefs.haptic_enabled ?? true);
      setSfxEnabled(prefs.sfx_enabled ?? true);
      setSfxVolume(Number(localStorage.getItem('sfxVolume') ?? 0.35));
      setIslamicMode(!!(prefs as unknown as Record<string, unknown>).islamic_mode);
    }).catch(() => {});
  };

  useEffect(() => { applyUXPrefs(); }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOnboardingComplete = (answers: OnboardingAnswers) => {
    setOnboarded(true);
    setOrientationSeen(false); // Always show orientation after fresh onboarding
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
        setOrientationSeen(null);
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

  // ── Orientation (replaces old auto-FeatureTour gate) ────────────────────────
  if (onboarded && orientationSeen === false) {
    return (
      <Orientation
        displayName={displayName}
        islamicMode={islamicMode}
        onComplete={() => {
          markOrientationSeen(userId, ORIENTATION_VERSION).catch(() => {});
          setOrientationSeen(true);
        }}
      />
    );
  }


  // ── Main app ─────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      overflow: 'hidden', position: 'relative',
      paddingTop: 'env(safe-area-inset-top, 56px)',
    }}>

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
          <UserHome userId={userId} sessionId={sessionId.current} onTabChange={handleTabChange} location={location} />
        </div>
        {mountedTabs.has('reminders') && (
          <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', display: tab === 'reminders' ? 'block' : 'none' }}>
            <RemindersView userId={userId} />
          </div>
        )}
        {mountedTabs.has('tasks') && (
          <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', display: tab === 'tasks'     ? 'block' : 'none' }}>
            <TasksView userId={userId} />
          </div>
        )}
        {mountedTabs.has('memory') && (
          <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', display: tab === 'memory'    ? 'block' : 'none' }}>
            <MemoryView userId={userId} />
          </div>
        )}
        {mountedTabs.has('journal') && (
          <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', display: tab === 'journal'   ? 'block' : 'none' }}>
            <JournalView userId={userId} />
          </div>
        )}
        {mountedTabs.has('analytics') && (
          <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', display: tab === 'analytics' ? 'block' : 'none' }}>
            <UserAnalytics userId={userId} />
          </div>
        )}
        {mountedTabs.has('location') && (
          <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', display: tab === 'location'  ? 'block' : 'none' }}>
            <LocationView userId={userId} location={location} />
          </div>
        )}
        {mountedTabs.has('commute') && (
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', display: tab === 'commute' ? 'flex' : 'none', flexDirection: 'column' }}>
            <CommuteRadar userId={userId} location={location} />
          </div>
        )}
        {mountedTabs.has('upgrade') && (
          <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', display: tab === 'upgrade'   ? 'block' : 'none' }}>
            <SubscriptionView userId={userId} />
          </div>
        )}
        {mountedTabs.has('meetings') && (
          <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', display: tab === 'meetings'  ? 'block' : 'none' }}>
            <MeetingRecorderView userId={userId} />
          </div>
        )}
        {islamicMode && mountedTabs.has('salah') && (
          <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', display: tab === 'salah' ? 'block' : 'none' }}>
            <SalahView userId={userId} location={location} />
          </div>
        )}
        {mountedTabs.has('settings') && (
          <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', display: tab === 'settings' ? 'block' : 'none' }}>
            <RogerSettings
              userId={userId}
              onReplayOrientation={() => setOrientationSeen(false)}
            />
          </div>
        )}
      </div>

      {/* ── Bottom Nav ── */}
      <nav style={{
        borderTop: '1px solid var(--border-subtle)',
        background: 'var(--bg-elevated)',
        display: 'flex', flexShrink: 0,
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}>
        {TABS.map(({ key, label, Icon }) => {
          // Hide SALAH tab for non-Islamic Mode users
          if (key === 'salah' && !islamicMode) return null;
          const active = tab === key;
          const badge = key === 'reminders' ? reminderCount : key === 'tasks' ? taskCount : 0;
          return (
            <button
              key={key}
              onClick={() => handleTabChange(key)}
              style={{
                flex: '0 0 auto', minWidth: 60, display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 4, padding: '12px 8px', position: 'relative',
                background: 'transparent', border: 'none', cursor: 'pointer',
                borderTop: `2px solid ${active ? (key === 'salah' ? '#10b981' : 'var(--amber)') : 'transparent'}`,
                transition: 'border-color 150ms',
              }}
            >
              <div style={{ position: 'relative' }}>
                <Icon size={22} style={{ color: active ? 'var(--amber)' : 'var(--text-muted)', transition: 'color 150ms' }} />
                {badge > 0 && (
                  <span style={{
                    position: 'absolute', top: -6, right: -8,
                    minWidth: 16, height: 16, borderRadius: 8,
                    background: '#ef4444', color: '#fff',
                    fontFamily: 'monospace', fontSize: 9, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '0 3px',
                  }}>
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </div>
              <span style={{
                fontFamily: 'monospace', fontSize: 9,
                letterSpacing: '0.06em', textTransform: 'uppercase',
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
