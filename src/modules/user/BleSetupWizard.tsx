import { useState, useEffect, useCallback } from 'react';
import { Radio, Wifi, WifiOff, Shield, Loader, X, CheckCircle, Eye, EyeOff, Lock, Signal, ChevronRight } from 'lucide-react';
import {
  scanForDevices, connectAndVerify, scanWifiNetworks, sendWifiCredentials,
  getDeviceInfo, disconnect, reset,
  signalBars,
  type BleDevice, type WifiNetwork, type ProvisioningStatus,
} from '../../lib/bleProvisioning';
import { pairDevice } from '../../lib/api';

/* ── Style helpers ────────────────────────────────────────────────── */
const AMBER = '212,160,68';
const GREEN = '34,197,94';
const RED   = '239,68,68';
const CYAN  = '6,182,212';

const label = (sz = 9): React.CSSProperties => ({
  fontFamily: 'monospace', fontSize: sz, textTransform: 'uppercase',
  letterSpacing: '0.15em', color: 'var(--text-muted)', margin: 0,
});

const btn = (c: string): React.CSSProperties => ({
  width: '100%', padding: '12px 14px', fontFamily: 'monospace', fontSize: 10,
  textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer',
  background: `rgba(${c},0.1)`, border: `1px solid rgba(${c},0.3)`,
  color: `rgb(${c})`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  transition: 'background 150ms',
});

type Step = 'find' | 'verify' | 'wifi' | 'done';

/* ══════════════════════════════════════════════════════════════════ */
/*  BLE Setup Wizard — 4-step provisioning flow                      */
/* ══════════════════════════════════════════════════════════════════ */
export default function BleSetupWizard({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [step, setStep]         = useState<Step>('find');
  const [device, setDevice]     = useState<BleDevice | null>(null);
  const [pop, setPop]           = useState('');
  const [networks, setNetworks] = useState<WifiNetwork[]>([]);
  const [selectedSsid, setSelectedSsid] = useState('');
  const [wifiPass, setWifiPass] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState('');
  const [status, setStatus]     = useState<ProvisioningStatus>('idle');

  // Cleanup on unmount
  useEffect(() => () => { reset(); }, []);

  /* ── Step 1: Find Device ─────────────────────────────────────── */
  const handleScan = useCallback(async () => {
    setBusy(true); setError('');
    const dev = await scanForDevices();
    setBusy(false);
    if (dev) {
      setDevice(dev);
      setStep('verify');
    }
  }, []);

  /* ── Step 2: Verify PoP ──────────────────────────────────────── */
  const handleVerify = useCallback(async () => {
    if (!pop.trim()) { setError('Enter the PoP code from your device screen'); return; }
    setBusy(true); setError(''); setStatus('connecting');
    const ok = await connectAndVerify(pop.trim());
    if (ok) {
      setStatus('scanning_wifi');
      const nets = await scanWifiNetworks();
      setNetworks(nets);
      setStep('wifi');
    } else {
      setError('PoP verification failed — check the code on device screen');
    }
    setBusy(false); setStatus('idle');
  }, [pop]);

  /* ── Step 3: Send WiFi ───────────────────────────────────────── */
  const handleConnect = useCallback(async () => {
    if (!selectedSsid) { setError('Select a network'); return; }
    setBusy(true); setError(''); setStatus('sending_credentials');
    const ok = await sendWifiCredentials(selectedSsid, wifiPass);
    if (ok) {
      // Try to get device info for auto-pairing
      const info = await getDeviceInfo();
      if (info?.device_id && info?.pairing_code) {
        try { await pairDevice(info.device_id, info.pairing_code); } catch { /* manual pair later */ }
      }
      await disconnect();
      setStep('done');
    } else {
      setError('WiFi connection failed — check password');
    }
    setBusy(false); setStatus('idle');
  }, [selectedSsid, wifiPass]);

  /* ── Step indicators ─────────────────────────────────────────── */
  const steps: { key: Step; label: string; icon: React.ReactNode }[] = [
    { key: 'find',   label: 'Find',   icon: <Radio size={10} /> },
    { key: 'verify', label: 'Verify', icon: <Shield size={10} /> },
    { key: 'wifi',   label: 'WiFi',   icon: <Wifi size={10} /> },
    { key: 'done',   label: 'Done',   icon: <CheckCircle size={10} /> },
  ];
  const stepIdx = steps.findIndex(s => s.key === step);

  return (
    <div style={{ padding: '16px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', marginBottom: 12 }}>

      {/* Header + Close */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Radio size={14} style={{ color: `rgb(${CYAN})` }} />
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
            BLE Device Setup
          </span>
        </div>
        <button onClick={() => { reset(); onCancel(); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
          <X size={14} />
        </button>
      </div>

      {/* Step Progress */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {steps.map((s, i) => (
          <div key={s.key} style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px',
            background: i <= stepIdx ? `rgba(${i === stepIdx ? CYAN : GREEN},0.08)` : 'transparent',
            border: `1px solid ${i <= stepIdx ? `rgba(${i === stepIdx ? CYAN : GREEN},0.3)` : 'var(--border-subtle)'}`,
            transition: 'all 200ms',
          }}>
            <span style={{ color: i < stepIdx ? `rgb(${GREEN})` : i === stepIdx ? `rgb(${CYAN})` : 'var(--text-muted)' }}>{s.icon}</span>
            <span style={{ fontFamily: 'monospace', fontSize: 7, textTransform: 'uppercase', letterSpacing: '0.1em',
              color: i < stepIdx ? `rgb(${GREEN})` : i === stepIdx ? `rgb(${CYAN})` : 'var(--text-muted)' }}>
              {s.label}
            </span>
          </div>
        ))}
      </div>

      {/* ── Step 1: Find Device ──────────────────────────────────── */}
      {step === 'find' && (
        <div>
          <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.7, margin: '0 0 14px' }}>
            Make sure your Roger device is powered on and showing the spinning amber ring.
            The device broadcasts its name via Bluetooth — we'll find it automatically.
          </p>

          {/* Animated radar */}
          {busy && (
            <div style={{ textAlign: 'center', padding: '20px 0', marginBottom: 12 }}>
              <div style={{
                width: 60, height: 60, borderRadius: '50%', margin: '0 auto 10px',
                border: `2px solid rgba(${CYAN},0.3)`,
                boxShadow: `0 0 20px rgba(${CYAN},0.15)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                animation: 'pulse 1.5s ease-in-out infinite',
              }}>
                <Radio size={20} style={{ color: `rgb(${CYAN})`, animation: 'spin 2s linear infinite' }} />
              </div>
              <p style={{ fontFamily: 'monospace', fontSize: 10, color: `rgb(${CYAN})`, margin: 0 }}>Scanning for Roger devices…</p>
            </div>
          )}

          {!busy && (
            <button onClick={handleScan} style={btn(CYAN)}
              onMouseEnter={e => (e.currentTarget.style.background = `rgba(${CYAN},0.2)`)}
              onMouseLeave={e => (e.currentTarget.style.background = `rgba(${CYAN},0.1)`)}>
              <Radio size={14} /> Scan for Device
            </button>
          )}
        </div>
      )}

      {/* ── Step 2: Verify PoP ───────────────────────────────────── */}
      {step === 'verify' && (
        <div>
          {device && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', marginBottom: 12,
              background: `rgba(${CYAN},0.05)`, border: `1px solid rgba(${CYAN},0.2)` }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: `rgba(${CYAN},0.1)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Radio size={12} style={{ color: `rgb(${CYAN})` }} />
              </div>
              <div>
                <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)', fontWeight: 600, margin: 0 }}>{device.name}</p>
                <p style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', margin: '2px 0 0' }}>Found via Bluetooth</p>
              </div>
            </div>
          )}

          <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.7, margin: '0 0 12px' }}>
            Enter the 8-character code shown on your device's screen. This verifies you're physically near the device.
          </p>

          <input
            value={pop}
            onChange={e => setPop(e.target.value.toUpperCase())}
            placeholder="e.g. A3K7MN2P"
            maxLength={8}
            autoFocus
            style={{
              width: '100%', padding: '12px', fontFamily: 'monospace', fontSize: 18,
              letterSpacing: '0.3em', textAlign: 'center', boxSizing: 'border-box',
              background: 'var(--bg-surface)', border: `1px solid rgba(${CYAN},0.3)`,
              color: 'var(--text-primary)', outline: 'none', caretColor: `rgb(${CYAN})`,
              marginBottom: 12,
            }}
            onKeyDown={e => { if (e.key === 'Enter' && pop.length === 8) handleVerify(); }}
          />

          <button onClick={handleVerify} disabled={busy || pop.length < 8} style={{
            ...btn(CYAN),
            opacity: pop.length < 8 ? 0.4 : 1,
            cursor: pop.length < 8 ? 'default' : 'pointer',
          }}>
            {busy ? <><Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> Verifying…</> :
              <><Shield size={14} /> Verify & Connect</>}
          </button>
        </div>
      )}

      {/* ── Step 3: WiFi ─────────────────────────────────────────── */}
      {step === 'wifi' && (
        <div>
          <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 10px' }}>
            Select a WiFi network for your Roger device. Your phone's hotspot works too.
          </p>

          {/* Network list */}
          <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {networks.length === 0 && (
              <div style={{ padding: '16px', textAlign: 'center', border: '1px solid var(--border-subtle)' }}>
                <WifiOff size={16} style={{ color: 'var(--text-muted)', marginBottom: 6 }} />
                <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: 0 }}>No networks found — enter SSID manually below</p>
              </div>
            )}
            {networks.map(net => {
              const bars = signalBars(net.rssi);
              const selected = selectedSsid === net.ssid;
              return (
                <button key={net.ssid} onClick={() => setSelectedSsid(net.ssid)} style={{
                  width: '100%', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10,
                  cursor: 'pointer', textAlign: 'left',
                  background: selected ? `rgba(${CYAN},0.08)` : 'transparent',
                  border: `1px solid ${selected ? `rgba(${CYAN},0.4)` : 'var(--border-subtle)'}`,
                  transition: 'all 150ms',
                }}>
                  <Signal size={14} style={{ color: bars >= 3 ? `rgb(${GREEN})` : bars >= 2 ? `rgb(${AMBER})` : `rgb(${RED})` }} />
                  <span style={{ flex: 1, fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)' }}>{net.ssid}</span>
                  {net.security !== 'open' && <Lock size={10} style={{ color: 'var(--text-muted)' }} />}
                  {selected && <ChevronRight size={12} style={{ color: `rgb(${CYAN})` }} />}
                </button>
              );
            })}
          </div>

          {/* Manual SSID + Password */}
          <input
            value={selectedSsid}
            onChange={e => setSelectedSsid(e.target.value)}
            placeholder="WiFi network name (SSID)"
            style={{
              width: '100%', padding: '9px 12px', fontFamily: 'monospace', fontSize: 11,
              boxSizing: 'border-box', background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)', color: 'var(--text-primary)',
              marginBottom: 6, outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <input
              type={showPass ? 'text' : 'password'}
              value={wifiPass}
              onChange={e => setWifiPass(e.target.value)}
              placeholder="WiFi password"
              style={{
                flex: 1, padding: '9px 12px', fontFamily: 'monospace', fontSize: 11,
                boxSizing: 'border-box', background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none',
              }}
              onKeyDown={e => { if (e.key === 'Enter' && selectedSsid) handleConnect(); }}
            />
            <button onClick={() => setShowPass(!showPass)} style={{
              width: 36, flexShrink: 0, background: 'transparent', border: '1px solid var(--border-subtle)',
              color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {showPass ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </div>

          <button onClick={handleConnect} disabled={busy || !selectedSsid} style={{
            ...btn(GREEN),
            opacity: !selectedSsid ? 0.4 : 1,
            cursor: !selectedSsid ? 'default' : 'pointer',
          }}>
            {busy ? <><Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> Connecting…</> :
              <><Wifi size={14} /> Connect to WiFi</>}
          </button>
        </div>
      )}

      {/* ── Step 4: Done ─────────────────────────────────────────── */}
      {step === 'done' && (
        <div style={{ textAlign: 'center', padding: '10px 0' }}>
          <CheckCircle size={36} style={{ color: `rgb(${GREEN})`, marginBottom: 10 }} />
          <p style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: `rgb(${GREEN})`, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>
            Device Ready
          </p>
          <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 16px' }}>
            Your Roger device is connected to WiFi and paired to your account.
            The device screen will confirm within seconds.
          </p>
          <button onClick={onDone} style={btn(GREEN)}
            onMouseEnter={e => (e.currentTarget.style.background = `rgba(${GREEN},0.2)`)}
            onMouseLeave={e => (e.currentTarget.style.background = `rgba(${GREEN},0.1)`)}>
            Done
          </button>
        </div>
      )}

      {/* Error display */}
      {error && (
        <p style={{ fontFamily: 'monospace', fontSize: 10, color: `rgb(${RED})`, margin: '10px 0 0', lineHeight: 1.5 }}>
          ⚠ {error}
        </p>
      )}
    </div>
  );
}
