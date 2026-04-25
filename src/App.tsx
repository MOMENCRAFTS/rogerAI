import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ViewModeProvider, useViewMode } from './context/ViewModeContext';
import StatusBar from './components/layout/StatusBar';
import NavRail from './components/layout/NavRail';
import Dashboard from './modules/Dashboard';
import Transmissions from './modules/Transmissions';
import Devices from './modules/Devices';
import FlowInspector from './modules/FlowInspector';
import Sandbox from './modules/Sandbox';
import PTTTestLab from './modules/PTTTestLab';
import IntentRegistry from './modules/IntentRegistry';
import MemoryMonitor from './modules/MemoryMonitor';
import MemoryGraph   from './modules/MemoryGraph';
import PatternLab from './modules/PatternLab';
import Contacts from './modules/Contacts';
import Channels from './modules/Channels';
import Commute from './modules/Commute';
import TuneIn from './modules/TuneIn';
import SessionArchive from './modules/SessionArchive';
import HazardMonitor from './modules/HazardMonitor';
import UserApp from './modules/user/UserApp';
import ApiSettings from './modules/ApiSettings';
import RichPlaceholder from './components/shared/RichPlaceholder';
import SplashScreen from './components/SplashScreen';
import LoginScreen from './components/LoginScreen';
import OfflineBanner from './components/OfflineBanner';
import { moduleInfoMap } from './data/mockData';

function ModuleRenderer({ activeModule }: { activeModule: string }) {
  switch (activeModule) {
    case 'dashboard':     return <Dashboard />;
    case 'transmissions': return <Transmissions />;
    case 'devices':       return <Devices />;
    case 'flow':          return <FlowInspector />;
    case 'sandbox':       return <Sandbox />;
    case 'pttlab':          return <PTTTestLab />;
    case 'intents':         return <IntentRegistry />;
    case 'memory_monitor':  return <MemoryMonitor />;
    case 'memory':          return <MemoryGraph />;
    case 'pattern_lab':     return <PatternLab />;
    case 'contacts':        return <Contacts />;
    case 'channels':        return <Channels />;
    case 'commute':         return <Commute />;
    case 'tunein':          return <TuneIn />;
    case 'session_archive': return <SessionArchive />;
    case 'hazard_monitor':  return <HazardMonitor />;
    case 'settings':        return <ApiSettings />;
    default: {
      const info = moduleInfoMap[activeModule];
      if (!info) return (
        <div className="flex items-center justify-center h-full">
          <span className="font-mono text-mini uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            MODULE NOT FOUND
          </span>
        </div>
      );
      return <RichPlaceholder info={info} />;
    }
  }
}

function AdminLayout() {
  const { viewMode } = useViewMode();
  const { user, isAdmin } = useAuth();
  const [activeModule, setActiveModule] = useState('dashboard');
  const [navExpanded, setNavExpanded]   = useState(false);
  const [mobileOpen, setMobileOpen]     = useState(false);

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-primary)' }}>
      {/* User overlay — only admins can toggle into it from the admin panel */}
      {viewMode === 'user' && user && <UserApp userId={user.id} userEmail={user.email ?? ''} />}

      {/* Top status bar */}
      <StatusBar
        onMenuToggle={() => setMobileOpen(o => !o)}
        menuOpen={mobileOpen}
      />

      {/* Main layout */}
      <div className="flex flex-1 min-h-0">
        {/* NavRail — only shown in admin mode */}
        {isAdmin && (
          <>
            <div
              className="hidden md:block shrink-0 transition-all duration-300"
              style={{ width: navExpanded ? 192 : 64 }}
              onMouseEnter={() => setNavExpanded(true)}
              onMouseLeave={() => setNavExpanded(false)}
            >
              <NavRail
                activeModule={activeModule}
                onNavigate={setActiveModule}
                isExpanded={navExpanded}
                isMobileOpen={mobileOpen}
                onClose={() => setMobileOpen(false)}
              />
            </div>

            {/* Mobile NavRail drawer */}
            <div className="md:hidden">
              <NavRail
                activeModule={activeModule}
                onNavigate={setActiveModule}
                isExpanded={true}
                isMobileOpen={mobileOpen}
                onClose={() => setMobileOpen(false)}
              />
            </div>
          </>
        )}

        {/* Main content */}
        <main className="flex-1 min-w-0 min-h-0 overflow-hidden">
          {isAdmin ? (
            <AnimatePresence mode="wait">
              <motion.div
                key={activeModule}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                className="h-full"
              >
                <ModuleRenderer activeModule={activeModule} />
              </motion.div>
            </AnimatePresence>
          ) : (
            /* Non-admin users land directly in the user experience */
            user && <UserApp userId={user.id} userEmail={user.email ?? ''} />
          )}
        </main>
      </div>
    </div>
  );
}

// ─── Local dev preview bypass ─────────────────────────────────────────────────
// Visit http://localhost:5173/?preview=user to skip auth and see UserApp directly.
const DEV_PREVIEW = typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('preview') === 'user' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

function AppInner() {
  const { user, loading } = useAuth();
  const [showSplash, setShowSplash] = useState(true);

  // ── DEV shortcut: ?preview=user bypasses auth entirely ──
  if (DEV_PREVIEW) {
    return (
      <ViewModeProvider>
        {showSplash && <SplashScreen onDone={() => setShowSplash(false)} />}
        <UserApp userId="dev-preview" userEmail="preview@rogerai.local" />
      </ViewModeProvider>
    );
  }

  // Always show splash first — covers the auth loading state too.
  // Once splash is done, we show login or app based on auth state.
  if (showSplash) {
    return <SplashScreen onDone={() => setShowSplash(false)} />;
  }

  // Splash done — wait for Supabase session check
  if (loading) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: '#0a0a08',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{
          fontFamily: 'monospace', fontSize: 10, color: 'rgba(212,160,68,0.6)',
          textTransform: 'uppercase', letterSpacing: '0.25em',
        }}>
          Authenticating...
        </span>
      </div>
    );
  }

  // Not logged in → show login
  if (!user) return <LoginScreen />;

  return (
    <ViewModeProvider>
      <AdminLayout />
    </ViewModeProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <OfflineBanner />
      <AppInner />
    </AuthProvider>
  );
}
