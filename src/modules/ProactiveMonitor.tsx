/**
 * ProactiveMonitor.tsx — Admin control panel for the Roger Proactive Engine.
 * Allows admins to:
 *  - See current engine state (mode, snooze, pending message)
 *  - Manually fire each trigger type for testing
 *  - Observe the ping interaction model (PTT-to-speak / double-tap-snooze)
 *  - View the last 20 proactive events in a log
 */

import { useState, useEffect } from 'react';
import { Bell, Radio, Car, AlertTriangle, Clock, RefreshCw, Zap, VolumeX } from 'lucide-react';
import {
  queueMessage, clearPending, setProactiveMode,
  triggerHazardAlert, triggerReminderAlert, triggerDepartureAlert, triggerIdleCheckin,
  type ProactiveMode, type PendingMessage,
} from '../lib/proactiveEngine';
import { sfxRogerPing } from '../lib/sfx';

interface LogEntry {
  ts:      number;
  trigger: string;
  text:    string;
  mode:    ProactiveMode;
  action:  'queued' | 'spoken' | 'snoozed' | 'dismissed';
}

const MODES: { key: ProactiveMode; label: string; desc: string; color: string }[] = [
  { key: 'normal', label: 'NORMAL',  desc: 'Subtle ping, waits for PTT',        color: '#5a9c69' },
  { key: 'drive',  label: 'DRIVE',   desc: 'Loud ping, auto-speaks after 3s',   color: '#d4a044' },
  { key: 'muted',  label: 'MUTED',   desc: 'Silent — no pings or messages',      color: '#a84832' },
];

const TEST_TRIGGERS = [
  {
    label: 'HAZARD ALERT',
    icon: AlertTriangle,
    color: '#ef4444',
    fire: () => triggerHazardAlert('Speed Camera', 350),
  },
  {
    label: 'REMINDER DUE',
    icon: Bell,
    color: '#8b5cf6',
    fire: () => triggerReminderAlert('Team standup at 3PM'),
  },
  {
    label: 'DEPARTURE TIME',
    icon: Car,
    color: '#d4a044',
    fire: () => triggerDepartureAlert('22 minutes'),
  },
  {
    label: 'IDLE CHECK-IN',
    icon: Clock,
    color: '#3b82f6',
    fire: () => triggerIdleCheckin(4),
  },
  {
    label: 'CUSTOM PING',
    icon: Zap,
    color: '#10b981',
    fire: () => queueMessage({ id: `test-${Date.now()}`, text: 'This is a test proactive message from admin. Over.', trigger: 'idle' }),
  },
  {
    label: 'PING SOUND ONLY',
    icon: Radio,
    color: 'var(--amber)',
    fire: () => sfxRogerPing(false).catch(() => {}),
  },
  {
    label: 'DRIVE PING SOUND',
    icon: Radio,
    color: '#d4a044',
    fire: () => sfxRogerPing(true).catch(() => {}),
  },
];

export default function ProactiveMonitor() {
  const [mode, setMode]         = useState<ProactiveMode>('normal');
  const [log, setLog]           = useState<LogEntry[]>([]);
  const [pending, setPending]   = useState<PendingMessage | null>(null);
  const [fireCount, setFireCount] = useState(0);

  // Sync mode to engine
  useEffect(() => { setProactiveMode(mode); }, [mode]);

  const addLog = (trigger: string, text: string, action: LogEntry['action']) => {
    setLog(prev => [{ ts: Date.now(), trigger, text, mode, action }, ...prev].slice(0, 20));
  };

  const fire = (item: typeof TEST_TRIGGERS[0]) => {
    item.fire();
    setFireCount(c => c + 1);
    addLog(item.label, '—', 'queued');
  };

  const timeAgo = (ts: number) => {
    const s = Math.floor((Date.now() - ts) / 1000);
    return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ padding: '14px 20px 10px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <Bell size={14} style={{ color: 'var(--amber)' }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: '0.18em', color: 'var(--amber)', textTransform: 'uppercase' }}>PROACTIVE ENGINE</div>
          <div style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>ROGER ATTENTION SYSTEM · ADMIN MONITOR</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="led-pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: mode === 'muted' ? '#a84832' : mode === 'drive' ? '#d4a044' : '#5a9c69', display: 'inline-block' }} />
          <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{mode.toUpperCase()}</span>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Mode Selector */}
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', padding: '14px 16px' }}>
          <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 10 }}>ENGINE MODE</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {MODES.map(m => (
              <button key={m.key} onClick={() => setMode(m.key)} style={{
                flex: 1, padding: '10px 8px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em',
                cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                background: mode === m.key ? `${m.color}18` : 'transparent',
                border: `1px solid ${mode === m.key ? m.color : 'var(--border-subtle)'}`,
                color: mode === m.key ? m.color : 'var(--text-muted)',
                transition: 'all 0.15s',
              }}>
                <span style={{ fontSize: 16 }}>
                  {m.key === 'normal' ? '📡' : m.key === 'drive' ? '🚗' : '🔇'}
                </span>
                <span>{m.label}</span>
                <span style={{ fontSize: 7, color: mode === m.key ? m.color : 'var(--text-muted)', opacity: 0.7, textAlign: 'center', lineHeight: 1.3 }}>{m.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Interaction Model Reference */}
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', padding: '14px 16px' }}>
          <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 10 }}>INTERACTION MODEL</div>
          {[
            { icon: '📡', action: 'Roger queues message', result: 'Haptic + radio ping fires' },
            { icon: '🎙️', action: '1× PTT press',         result: 'Roger speaks the message' },
            { icon: '🎙️🎙️', action: '2× PTT within 1s',   result: 'Snooze for 5 minutes' },
            { icon: '⏱️', action: '30s no response',       result: 'Auto-snooze' },
            { icon: '🚗', action: 'Drive mode active',     result: 'Auto-speaks after 3s' },
          ].map(r => (
            <div key={r.action} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderBottom: '1px solid var(--border-dim)' }}>
              <span style={{ fontSize: 14, minWidth: 28 }}>{r.icon}</span>
              <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', flex: 1 }}>{r.action}</div>
              <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-secondary)', textAlign: 'right' }}>→ {r.result}</div>
            </div>
          ))}
        </div>

        {/* Test Triggers */}
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', padding: '14px 16px' }}>
          <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 10 }}>
            FIRE TEST TRIGGER · {fireCount} FIRED
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {TEST_TRIGGERS.map(t => {
              const Icon = t.icon;
              return (
                <button key={t.label} onClick={() => fire(t)} style={{
                  padding: '10px 12px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                  background: `${t.color}10`, border: `1px solid ${t.color}44`,
                  color: t.color, transition: 'all 0.15s',
                }}>
                  <Icon size={12} />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Live pending state */}
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.15em', flex: 1 }}>PENDING STATE</span>
            <button onClick={() => { clearPending(); setPending(null); }} style={{ fontFamily: 'monospace', fontSize: 8, color: '#a84832', background: 'transparent', border: '1px solid rgba(168,72,50,0.3)', padding: '2px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              <VolumeX size={9} /> CLEAR
            </button>
            <button onClick={() => setFireCount(0)} style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', background: 'transparent', border: '1px solid var(--border-subtle)', padding: '2px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              <RefreshCw size={9} /> RESET COUNT
            </button>
          </div>
          {pending ? (
            <div style={{ padding: '10px 12px', background: 'rgba(212,160,68,0.06)', border: '1px solid rgba(212,160,68,0.3)', animation: 'rogerPingPulse 2s ease-in-out infinite' }}>
              <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--amber)', textTransform: 'uppercase', marginBottom: 4 }}>{pending.trigger}</div>
              <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)' }}>{pending.text}</div>
            </div>
          ) : (
            <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', textAlign: 'center', padding: '12px 0' }}>NO PENDING MESSAGE</div>
          )}
        </div>

        {/* Event Log */}
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', padding: '14px 16px' }}>
          <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 10 }}>
            EVENT LOG · {log.length} ENTRIES
          </div>
          {log.length === 0 ? (
            <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0', textTransform: 'uppercase' }}>No events yet — fire a trigger above</div>
          ) : (
            log.map((entry, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--border-dim)', fontFamily: 'monospace', fontSize: 9 }}>
                <span style={{ color: 'var(--text-muted)', minWidth: 40 }}>{timeAgo(entry.ts)}</span>
                <span style={{ color: 'var(--amber)', minWidth: 60, textTransform: 'uppercase', fontSize: 8 }}>{entry.mode}</span>
                <span style={{ color: entry.action === 'queued' ? '#5a9c69' : entry.action === 'snoozed' ? '#a84832' : 'var(--text-muted)', minWidth: 60, textTransform: 'uppercase', fontSize: 8 }}>{entry.action}</span>
                <span style={{ color: 'var(--text-secondary)', flex: 1, textTransform: 'uppercase' }}>{entry.trigger}</span>
              </div>
            ))
          )}
        </div>

      </div>
    </div>
  );
}
