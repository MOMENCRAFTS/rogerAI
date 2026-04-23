import { useState, useEffect } from 'react';
import { Smartphone, Signal, BatteryFull, BatteryLow, Battery, RefreshCw, CheckCircle2, AlertTriangle, XCircle, Wifi } from 'lucide-react';
import { fetchDevices, subscribeToDevices } from '../lib/api';
import type { DbDevice } from '../lib/api';
import TelemetryBadge from '../components/shared/TelemetryBadge';

function batteryIcon(v: number) {
  if (v > 60) return <BatteryFull size={12} style={{ color: 'var(--green)' }} />;
  if (v > 25) return <Battery     size={12} style={{ color: 'var(--amber)' }} />;
  return             <BatteryLow  size={12} style={{ color: 'var(--rust)'  }} />;
}
function batteryColor(v: number) {
  return v > 60 ? 'var(--green)' : v > 25 ? 'var(--amber)' : 'var(--rust)';
}
function signalColor(v: number) {
  return v > 85 ? 'var(--green)' : v > 65 ? 'var(--amber)' : 'var(--rust)';
}
function statusBorderColor(s: DbDevice['status']) {
  if (s === 'online')      return 'var(--green-border)';
  if (s === 'sync_issue')  return 'var(--amber-border)';
  return 'var(--rust-border)';
}
function statusBg(s: DbDevice['status']) {
  if (s === 'online')      return 'var(--green-dim)';
  if (s === 'sync_issue')  return 'var(--amber-warn-dim)';
  return 'var(--rust-dim)';
}
function statusIcon(s: DbDevice['status']) {
  if (s === 'online')      return <CheckCircle2  size={14} style={{ color: 'var(--green)' }} />;
  if (s === 'sync_issue')  return <AlertTriangle size={14} style={{ color: 'var(--amber)' }} />;
  return                          <XCircle       size={14} style={{ color: 'var(--rust)'  }} />;
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'JUST NOW';
  if (mins < 60) return `${mins} MIN AGO`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs} HR AGO` : `${Math.floor(hrs / 24)}D AGO`;
}

export default function Devices() {
  const [devices, setDevices] = useState<DbDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDevices();
      setDevices(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load devices');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Realtime device updates
  useEffect(() => {
    const channel = subscribeToDevices((updated) => {
      setDevices(prev => prev.map(d => d.id === updated.id ? updated : d));
    });
    return () => { channel.unsubscribe(); };
  }, []);

  const online     = devices.filter(d => d.status === 'online').length;
  const syncIssue  = devices.filter(d => d.status === 'sync_issue').length;
  const offline    = devices.filter(d => d.status === 'offline').length;

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-4 lg:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Smartphone size={14} style={{ color: 'var(--amber)' }} />
            <h1 className="font-mono text-mini tracking-widest uppercase" style={{ color: 'var(--amber)' }}>DEVICE FLEET</h1>
            <div className="flex items-center gap-1.5 px-2 py-0.5 border" style={{ borderColor: 'var(--green-border)', background: 'var(--green-dim)' }}>
              <div className="w-1.5 h-1.5 led-pulse" style={{ background: 'var(--green)', borderRadius:'50%' }} />
              <Wifi size={9} style={{ color: 'var(--green)' }} />
              <span className="font-mono text-nano" style={{ color: 'var(--green)' }}>LIVE</span>
            </div>
          </div>
          <p className="font-mono text-nano tracking-wider mt-0.5" style={{ color: 'var(--text-muted)' }}>
            HARDWARE OPERATIONS / FLEET TELEMETRY · {devices.length} DEVICES
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 border px-2 py-1 font-mono text-nano uppercase tracking-wider"
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
        >
          <RefreshCw size={10} className={loading ? 'animate-spin' : ''} /> REFRESH
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="border px-4 py-3 font-mono text-nano" style={{ borderColor: 'var(--rust-border)', background: 'var(--rust-dim)', color: 'var(--rust)' }}>
          ⚠ {error}
        </div>
      )}

      {/* Fleet summary bar */}
      {!loading && devices.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'ONLINE',      count: online,    color: 'var(--green)', border: 'var(--green-border)',  bg: 'var(--green-dim)' },
            { label: 'SYNC ISSUE',  count: syncIssue, color: 'var(--amber)', border: 'var(--amber-border)',  bg: 'var(--amber-warn-dim)' },
            { label: 'OFFLINE',     count: offline,   color: 'var(--rust)',  border: 'var(--rust-border)',   bg: 'var(--rust-dim)' },
          ].map(s => (
            <div key={s.label} className="border p-3 text-center" style={{ borderColor: s.border, background: s.bg }}>
              <p className="font-mono text-label font-bold" style={{ color: s.color }}>{s.count}</p>
              <p className="font-mono text-micro tracking-widest uppercase" style={{ color: s.color }}>{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1,2,3,4].map(i => (
            <div key={i} className="border p-4 h-28 animate-pulse" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }} />
          ))}
        </div>
      )}

      {/* Device list */}
      {!loading && (
        <div className="space-y-3">
          {devices.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <span className="font-mono text-mini tracking-wider uppercase" style={{ color: 'var(--text-muted)' }}>NO DEVICES IN DATABASE</span>
            </div>
          )}

          {devices.map(device => (
            <div
              key={device.id}
              className="border p-4 space-y-3"
              style={{ borderColor: statusBorderColor(device.status), background: statusBg(device.status) }}
            >
              {/* Top row */}
              <div className="flex items-start gap-3">
                <div className="flex items-center justify-center p-1.5 border shrink-0" style={{ borderColor: statusBorderColor(device.status), background: 'var(--bg-recessed)' }}>
                  {statusIcon(device.status)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{device.id}</span>
                    <span className="font-mono text-nano" style={{ color: 'var(--text-muted)' }}>
                      SYNC: {relativeTime(device.last_sync_at)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    <span className="font-mono text-nano" style={{ color: 'var(--text-secondary)' }}>USR: {device.user_id}</span>
                    <span className="font-mono text-nano" style={{ color: 'var(--text-secondary)' }}>{device.region}</span>
                    <span className="font-mono text-nano" style={{ color: 'var(--text-secondary)' }}>FW {device.firmware}</span>
                    {device.queue_depth > 0 && (
                      <span className="font-mono text-nano border px-1" style={{ borderColor: 'var(--amber-border)', color: 'var(--amber)' }}>
                        Q:{device.queue_depth}
                      </span>
                    )}
                  </div>
                </div>
                <div className="shrink-0 px-2 py-0.5 font-mono text-nano tracking-wider uppercase border"
                  style={{ borderColor: statusBorderColor(device.status), color: device.status === 'online' ? 'var(--green)' : device.status === 'sync_issue' ? 'var(--amber)' : 'var(--rust)' }}>
                  {device.status.replace('_', ' ').toUpperCase()}
                </div>
              </div>

              {/* Telemetry row */}
              <div className="pl-11 grid grid-cols-3 gap-2">
                {/* Battery */}
                <div className="border px-2 py-1.5 space-y-1" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-cell)' }}>
                  <div className="flex items-center gap-1">
                    {batteryIcon(device.battery)}
                    <span className="font-mono text-micro uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>BATTERY</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1" style={{ background: 'var(--bg-recessed)' }}>
                      <div style={{ width: `${device.battery}%`, height: '100%', background: batteryColor(device.battery) }} />
                    </div>
                    <span className="font-mono text-nano font-semibold" style={{ color: batteryColor(device.battery) }}>{device.battery}%</span>
                  </div>
                </div>

                {/* Signal */}
                <div className="border px-2 py-1.5 space-y-1" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-cell)' }}>
                  <div className="flex items-center gap-1">
                    <Signal size={12} style={{ color: signalColor(device.signal) }} />
                    <span className="font-mono text-micro uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>SIGNAL</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1" style={{ background: 'var(--bg-recessed)' }}>
                      <div style={{ width: `${device.signal}%`, height: '100%', background: signalColor(device.signal) }} />
                    </div>
                    <span className="font-mono text-nano font-semibold" style={{ color: signalColor(device.signal) }}>{device.signal}%</span>
                  </div>
                </div>

                {/* Sync Health */}
                <TelemetryBadge
                  label="SYNC HLTH"
                  value={`${device.sync_health}%`}
                  status={device.sync_health >= 99 ? 'success' : device.sync_health >= 90 ? 'warning' : 'error'}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
