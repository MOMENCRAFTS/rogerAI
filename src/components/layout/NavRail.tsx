import {
  LayoutDashboard, Users, Smartphone, Radio, Workflow,
  Brain, Zap, Bell, CreditCard, Headphones,
  Flag, FileText, Settings, FlaskConical, Cpu, Rss, Car, Archive, AlertTriangle, Moon,
  MessageSquare,
} from 'lucide-react';
import Tooltip from '../shared/Tooltip';
import type { NavGroup } from '../../types';

interface NavItem {
  key: string;
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Icon: any;
  group: NavGroup;
  tooltip: string; // user-friendly tooltip
}

interface NavGroup2 {
  name: NavGroup;
  items: NavItem[];
}

const navGroups: NavGroup2[] = [
  {
    name: 'PTT NETWORK',
    items: [
      { key: 'contacts',        label: 'CONTACTS',      Icon: Radio,          group: 'PTT NETWORK', tooltip: 'Roger network contacts & callsigns' },
      { key: 'channels',        label: 'CHANNELS',      Icon: Rss,            group: 'PTT NETWORK', tooltip: 'Group channels & convoy coordination' },
      { key: 'tunein',          label: 'TUNE IN',       Icon: Headphones,     group: 'PTT NETWORK', tooltip: 'Live peer-to-peer session via callsign' },
      { key: 'commute',         label: 'COMMUTE CMD',   Icon: Car,            group: 'PTT NETWORK', tooltip: 'Route intelligence & departure brief' },
      { key: 'hazard_monitor',  label: 'HAZARD LAYER',  Icon: AlertTriangle,  group: 'PTT NETWORK', tooltip: 'Unified road hazard monitor & control' },
      { key: 'session_archive', label: 'SESSION LOG',   Icon: Archive,        group: 'PTT NETWORK', tooltip: 'Past sessions, transcripts & debriefs' },
    ],
  },
  {
    name: 'OPERATIONS',
    items: [
      { key: 'dashboard',     label: 'DASHBOARD',      Icon: LayoutDashboard, group: 'OPERATIONS', tooltip: 'Mission control overview' },
      { key: 'transmissions', label: 'TRANSMISSIONS',  Icon: Radio,           group: 'OPERATIONS', tooltip: 'Live PTT voice stream' },
      { key: 'conversations', label: 'CONVERSATIONS',  Icon: MessageSquare,   group: 'OPERATIONS', tooltip: 'All user ↔ Roger conversations' },
      { key: 'flow',          label: 'FLOW INSPECTOR', Icon: Workflow,        group: 'OPERATIONS', tooltip: 'AI pipeline trace viewer' },
    ],
  },
  {
    name: 'AI LAB',
    items: [
      { key: 'ai_brain',      label: 'AI BRAIN',       Icon: Cpu,          group: 'AI LAB', tooltip: 'View Roger AI prompts & architecture' },
      { key: 'memory',        label: 'MEMORY GRAPH',   Icon: Brain,        group: 'AI LAB', tooltip: 'Knowledge context graph & memory health' },
      { key: 'pattern_lab',   label: 'PATTERN LAB',    Icon: FlaskConical, group: 'AI LAB', tooltip: 'Entity patterns & insights log' },
      { key: 'intents',       label: 'INTENT REGISTRY',Icon: Cpu,          group: 'AI LAB', tooltip: 'AI intent governance & control' },
      { key: 'proactive',     label: 'PROACTIVE ENG',  Icon: Bell,         group: 'AI LAB', tooltip: 'Roger proactive attention system monitor' },
    ],
  },
  {
    name: 'ANALYTICS',
    items: [
      { key: 'billing',         label: 'BILLING',       Icon: CreditCard, group: 'ANALYTICS', tooltip: 'Subscriptions & entitlements' },
      { key: 'islamic_monitor', label: 'ISLAMIC MODE',  Icon: Moon,       group: 'ANALYTICS', tooltip: 'Islamic Mode adoption & user alerts' },
    ],
  },
  {
    name: 'ADMIN',
    items: [
      { key: 'users',    label: 'USER REGISTRY',     Icon: Users,      group: 'ADMIN', tooltip: 'Real user accounts & management' },
      { key: 'personas', label: 'AI PERSONAS',        Icon: Zap,        group: 'ADMIN', tooltip: 'AI persona hub — spawn, audit, test & analytics' },
      { key: 'devices',  label: 'DEVICE FLEET',       Icon: Smartphone, group: 'ADMIN', tooltip: 'Hardware & fleet operations' },
      { key: 'flags',    label: 'FEATURE FLAGS',      Icon: Flag,       group: 'ADMIN', tooltip: 'Experiments & staged rollouts' },
      { key: 'audit',    label: 'AUDIT LOG',          Icon: FileText,   group: 'ADMIN', tooltip: 'System action journal' },
      { key: 'settings', label: 'SETTINGS',           Icon: Settings,   group: 'ADMIN', tooltip: 'Global configuration & API keys' },
    ],
  },
];

interface NavRailProps {
  activeModule: string;
  onNavigate: (key: string) => void;
  isExpanded: boolean;
  isMobileOpen: boolean;
  onClose: () => void;
}

export default function NavRail({ activeModule, onNavigate, isExpanded, isMobileOpen, onClose }: NavRailProps) {
  const handleNav = (key: string) => {
    onNavigate(key);
    onClose();
  };

  const rail = (
    <nav
      className="flex flex-col h-full scrollbar-thin overflow-y-auto overflow-x-hidden"
      style={{
        background: 'var(--bg-recessed)',
        borderRight: '1px solid var(--border-subtle)',
        width: isExpanded ? 192 : 64,
        transition: 'width 300ms ease',
        minWidth: isExpanded ? 192 : 64,
      }}
    >
      {navGroups.map((group) => (
        <div key={group.name} className="flex flex-col">
          {/* Group header — only visible when expanded */}
          {isExpanded && (
            <div
              className="px-3 pt-4 pb-1 font-mono text-micro tracking-widest uppercase"
              style={{ color: 'var(--text-muted)' }}
            >
              {group.name}
            </div>
          )}
          {!isExpanded && (
            <div
              className="mt-3 mb-1 mx-auto"
              style={{ width: 24, height: 1, background: 'var(--border-subtle)' }}
            />
          )}

          {group.items.map(({ key, label, Icon, tooltip }) => {
            const isActive = activeModule === key;
            return (
              <Tooltip
                key={key}
                content={tooltip}
                placement="right"
                delay={200}
                maxWidth={200}
              >
                <button
                  onClick={() => handleNav(key)}
                  className="flex items-center gap-3 px-4 py-3 w-full text-left transition-all duration-150 relative group"
                  style={{
                    background: isActive ? 'rgba(212, 160, 68, 0.12)' : 'transparent',
                    color: isActive ? 'var(--amber)' : 'var(--text-secondary)',
                    borderLeft: isActive ? '2px solid var(--amber)' : '2px solid transparent',
                  }}
                  onMouseEnter={e => {
                    if (!isActive) {
                      (e.currentTarget as HTMLElement).style.background = 'rgba(74, 82, 64, 0.2)';
                      (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)';
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isActive) {
                      (e.currentTarget as HTMLElement).style.background = 'transparent';
                      (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)';
                    }
                  }}
                >
                  <Icon size={16} className="shrink-0" />
                  {isExpanded && (
                    <span className="font-mono text-label tracking-wide uppercase whitespace-nowrap overflow-hidden">
                      {label}
                    </span>
                  )}
                </button>
              </Tooltip>
            );
          })}
        </div>
      ))}
    </nav>
  );

  return (
    <>
      {/* Desktop: hover-expand rail */}
      <div
        className="hidden md:block h-full shrink-0"
        style={{ width: isExpanded ? 192 : 64, transition: 'width 300ms ease' }}
      >
        {rail}
      </div>

      {/* Mobile/Tablet: slide-in drawer */}
      {isMobileOpen && (
        <>
          {/* Backdrop */}
          <div
            className="md:hidden fixed inset-0 z-40"
            style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={onClose}
          />
          {/* Drawer */}
          <div className="md:hidden fixed left-0 top-0 bottom-0 z-50 w-56 shadow-2xl" style={{ background: 'var(--bg-recessed)' }}>
            <div className="h-full" style={{ minWidth: 192 }}>
              <nav
                className="flex flex-col h-full scrollbar-thin overflow-y-auto"
                style={{ borderRight: '1px solid var(--border-subtle)' }}
              >
                <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                  <span className="font-mono text-mini tracking-widest uppercase" style={{ color: 'var(--amber)' }}>
                    ROGER AI — NAV
                  </span>
                </div>
                {navGroups.map((group) => (
                  <div key={group.name} className="flex flex-col">
                    <div className="px-3 pt-4 pb-1 font-mono text-micro tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>
                      {group.name}
                    </div>
                    {group.items.map(({ key, label, Icon, tooltip }) => {
                      const isActive = activeModule === key;
                      return (
                        <button
                          key={key}
                          title={tooltip}
                          onClick={() => handleNav(key)}
                          className="flex items-center gap-3 px-4 py-2.5 w-full text-left"
                          style={{
                            background: isActive ? 'rgba(212, 160, 68, 0.12)' : 'transparent',
                            color: isActive ? 'var(--amber)' : 'var(--text-secondary)',
                            borderLeft: isActive ? '2px solid var(--amber)' : '2px solid transparent',
                          }}
                        >
                          <Icon size={16} className="shrink-0" />
                          <span className="font-mono text-label tracking-wide uppercase whitespace-nowrap">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </nav>
            </div>
          </div>
        </>
      )}
    </>
  );
}
