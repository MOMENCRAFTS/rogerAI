import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
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
import PatternLab from './modules/PatternLab';
import UserApp from './modules/user/UserApp';
import RichPlaceholder from './components/shared/RichPlaceholder';
import SplashScreen from './components/SplashScreen';
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
    case 'pattern_lab':     return <PatternLab />;
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
  const [activeModule, setActiveModule] = useState('dashboard');
  const [navExpanded, setNavExpanded]   = useState(false);
  const [mobileOpen, setMobileOpen]     = useState(false);

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-primary)' }}>
      {/* User overlay */}
      {viewMode === 'user' && <UserApp />}

      {/* Top status bar */}
      <StatusBar
        onMenuToggle={() => setMobileOpen(o => !o)}
        menuOpen={mobileOpen}
      />

      {/* Main layout */}
      <div className="flex flex-1 min-h-0">
        {/* NavRail */}
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

        {/* Main content */}
        <main className="flex-1 min-w-0 min-h-0 overflow-hidden">
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
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const [showSplash, setShowSplash] = useState(true);

  return (
    <ViewModeProvider>
      {showSplash && <SplashScreen onDone={() => setShowSplash(false)} />}
      <AdminLayout />
    </ViewModeProvider>
  );
}
