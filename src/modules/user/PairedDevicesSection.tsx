import { useState, useEffect, useCallback, useRef } from 'react';
import { Radio, Loader, Trash2, Wifi, WifiOff, Camera, X, ChevronRight, Monitor, CheckCircle, ArrowLeft } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { fetchPairedDevices, pairDevice, unpairDevice, renameDevice, type DbPairedDevice } from '../../lib/api';

/* ── helpers ─────────────────────────────────────────────────────────── */
function timeAgo(d: string | null) {
  if (!d) return 'Never';
  const ms = Date.now() - new Date(d).getTime();
  if (ms < 60_000) return 'Just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function parseQr(raw: string) {
  try {
    const u = new URL(raw.replace('roger://', 'https://r.local/'));
    const id = u.searchParams.get('device_id'), c = u.searchParams.get('code');
    if (id && c) return { device_id: id, code: c };
  } catch { /* */ }
  try { const o = JSON.parse(raw); if (o.device_id && o.code) return o; } catch { /* */ }
  return null;
}

/* ── shared style helpers (Roger design system) ──────────────────────── */
const label = (sz = 9): React.CSSProperties => ({
  fontFamily: 'monospace', fontSize: sz, textTransform: 'uppercase',
  letterSpacing: '0.15em', color: 'var(--text-muted)', margin: 0,
});

const btn = (c: string, hover = true): React.CSSProperties => ({
  width: '100%', padding: '11px 14px', fontFamily: 'monospace', fontSize: 10,
  textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer',
  background: `rgba(${c},0.1)`, border: `1px solid rgba(${c},0.3)`,
  color: `rgb(${c})`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  transition: hover ? 'background 150ms' : 'none',
});

const AMBER = '212,160,68';
const GREEN = '34,197,94';
const PURPLE = '139,92,246';
const RED = '239,68,68';

/* ══════════════════════════════════════════════════════════════════════ */
/*  Setup Wizard                                                        */
/* ══════════════════════════════════════════════════════════════════════ */
type Step = 'wifi' | 'portal' | 'scan' | 'done';

function SetupWizard({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [step, setStep] = useState<Step>('wifi');
  const [scanning, setScanning] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [error, setError] = useState('');
  const [manualId, setManualId] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [showManual, setShowManual] = useState(false);
  const ref = useRef<Html5Qrcode | null>(null);
  const divId = 'roger-qr';

  useEffect(() => () => { ref.current?.stop().catch(() => {}); }, []);

  const startScan = async () => {
    setError(''); setScanning(true);
    await new Promise(r => setTimeout(r, 120));
    try {
      const s = new Html5Qrcode(divId);
      ref.current = s;
      await s.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 200, height: 200 } },
        async (txt) => {
          const p = parseQr(txt);
          if (p) { await s.stop().catch(() => {}); ref.current = null; setScanning(false); doPair(p.device_id, p.code); }
        }, () => {});
    } catch { setError('Camera access denied.'); setScanning(false); setShowManual(true); }
  };

  const stopScan = () => { ref.current?.stop().catch(() => {}); ref.current = null; setScanning(false); };

  const doPair = async (id: string, code: string) => {
    setPairing(true); setError('');
    try { await pairDevice(id, code); setStep('done'); }
    catch (e: any) { setError(e.message || 'Pairing failed.'); }
    setPairing(false);
  };

  /* ── Step 1: WiFi ── */
  if (step === 'wifi') return (
    <div style={{ padding: '16px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <p style={{ ...label(9), color: 'var(--amber)' }}>Step 1 of 3</p>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={14} /></button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <Wifi size={18} style={{ color: 'var(--amber)', flexShrink: 0 }} />
        <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0, fontWeight: 600 }}>Connect to Device WiFi</p>
      </div>
      <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 12px' }}>
        Open your phone's WiFi settings and connect to the network below. No password required.
      </p>
      <div style={{ padding: '14px', marginBottom: 14, textAlign: 'center', background: 'rgba(212,160,68,0.06)', border: '1px dashed rgba(212,160,68,0.35)' }}>
        <p style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700, color: 'var(--amber)', margin: '0 0 2px', letterSpacing: '0.05em' }}>RogerDevice-Setup</p>
        <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: 0 }}>Open network · no password</p>
      </div>
      <button onClick={() => setStep('portal')} style={btn(AMBER)}
        onMouseEnter={e => (e.currentTarget.style.background = `rgba(${AMBER},0.2)`)}
        onMouseLeave={e => (e.currentTarget.style.background = `rgba(${AMBER},0.1)`)}>
        I'm Connected <ChevronRight size={12} />
      </button>
    </div>
  );

  /* ── Step 2: Portal ── */
  if (step === 'portal') return (
    <div style={{ padding: '16px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <p style={{ ...label(9), color: 'var(--amber)' }}>Step 2 of 3</p>
        <button onClick={() => setStep('wifi')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><ArrowLeft size={14} /></button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <Monitor size={18} style={{ color: 'var(--amber)', flexShrink: 0 }} />
        <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0, fontWeight: 600 }}>Configure Home WiFi</p>
      </div>
      <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 12px' }}>
        Tap below to open the device portal. Select your home WiFi network and enter the password. The device will restart automatically.
      </p>
      <a href="http://192.168.4.1" target="_blank" rel="noopener noreferrer"
        style={{ ...btn(PURPLE), textDecoration: 'none', marginBottom: 10 }}>
        <Monitor size={13} /> Open WiFi Portal
      </a>
      <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 12px' }}>
        After saving, switch your phone back to your home WiFi. The device display will show a QR code when ready.
      </p>
      <button onClick={() => setStep('scan')} style={btn(GREEN)}
        onMouseEnter={e => (e.currentTarget.style.background = `rgba(${GREEN},0.2)`)}
        onMouseLeave={e => (e.currentTarget.style.background = `rgba(${GREEN},0.1)`)}>
        Device Shows QR Code <ChevronRight size={12} />
      </button>
    </div>
  );

  /* ── Step 3: Scan ── */
  if (step === 'scan') return (
    <div style={{ padding: '16px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <p style={{ ...label(9), color: 'var(--amber)' }}>Step 3 of 3</p>
        <button onClick={() => setStep('portal')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><ArrowLeft size={14} /></button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <Camera size={18} style={{ color: 'var(--amber)', flexShrink: 0 }} />
        <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0, fontWeight: 600 }}>Scan Device QR Code</p>
      </div>
      <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 12px' }}>
        Point your camera at the QR code on the round display of your Roger device.
      </p>

      {pairing ? (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <Loader size={20} style={{ color: 'var(--amber)', animation: 'spin 1s linear infinite', marginBottom: 6 }} />
          <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--amber)', margin: 0 }}>Pairing device…</p>
        </div>
      ) : !scanning ? (
        <button onClick={startScan} style={btn(AMBER)}
          onMouseEnter={e => (e.currentTarget.style.background = `rgba(${AMBER},0.2)`)}
          onMouseLeave={e => (e.currentTarget.style.background = `rgba(${AMBER},0.1)`)}>
          <Camera size={14} /> Open Camera
        </button>
      ) : (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--amber)', margin: 0 }}>Scanning…</p>
            <button onClick={stopScan} style={{ background: 'none', border: 'none', color: `rgb(${RED})`, cursor: 'pointer' }}><X size={14} /></button>
          </div>
          <div id={divId} style={{ width: '100%', maxWidth: 260, margin: '0 auto', borderRadius: 6, overflow: 'hidden', border: '2px solid rgba(212,160,68,0.35)' }} />
        </div>
      )}

      {error && <p style={{ fontFamily: 'monospace', fontSize: 10, color: `rgb(${RED})`, margin: '8px 0 0' }}>{error}</p>}

      {/* Manual fallback */}
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
        <button onClick={() => setShowManual(!showManual)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textDecoration: 'underline' }}>
          {showManual ? 'Hide manual entry' : 'Enter code manually'}
        </button>
        {showManual && (
          <div style={{ marginTop: 8 }}>
            <input value={manualId} onChange={e => setManualId(e.target.value)} placeholder="Device ID"
              style={{ width: '100%', padding: '8px 10px', marginBottom: 6, fontFamily: 'monospace', fontSize: 11, boxSizing: 'border-box', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }} />
            <input value={manualCode} onChange={e => setManualCode(e.target.value.toUpperCase())} placeholder="6-char code" maxLength={6}
              style={{ width: '100%', padding: '8px 10px', marginBottom: 8, fontFamily: 'monospace', fontSize: 14, letterSpacing: '0.3em', textAlign: 'center', boxSizing: 'border-box', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }} />
            <button onClick={() => { if (manualId && manualCode) doPair(manualId.trim(), manualCode.trim()); else setError('Enter both fields'); }} disabled={pairing} style={btn(AMBER)}>Pair Device</button>
          </div>
        )}
      </div>
    </div>
  );

  /* ── Done ── */
  return (
    <div style={{ padding: '20px 16px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', marginBottom: 12, textAlign: 'center' }}>
      <CheckCircle size={32} style={{ color: `rgb(${GREEN})`, marginBottom: 8 }} />
      <p style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: `rgb(${GREEN})`, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Device Paired</p>
      <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 14px' }}>
        Your Roger device is connected. It will confirm on its display within a few seconds.
      </p>
      <button onClick={onDone} style={btn(GREEN)}
        onMouseEnter={e => (e.currentTarget.style.background = `rgba(${GREEN},0.2)`)}
        onMouseLeave={e => (e.currentTarget.style.background = `rgba(${GREEN},0.1)`)}>Done</button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Main Section                                                        */
/* ══════════════════════════════════════════════════════════════════════ */
export default function PairedDevicesSection({ userId: _userId }: { userId: string }) {
  const [devices, setDevices] = useState<DbPairedDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizard, setWizard] = useState(false);
  const [unpairingId, setUnpairingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [revokeConfirm, setRevokeConfirm] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setDevices(await fetchPairedDevices()); } catch { /* */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleUnpair = async (id: string) => {
    setUnpairingId(id);
    try { await unpairDevice(id); setDevices(p => p.filter(d => d.device_id !== id)); setExpandedId(null); setRevokeConfirm(null); } catch { /* */ }
    setUnpairingId(null);
  };

  const handleRename = async (id: string) => {
    if (!editName.trim()) return;
    setRenaming(true);
    try {
      await renameDevice(id, editName.trim());
      setDevices(p => p.map(d => d.device_id === id ? { ...d, device_name: editName.trim() } : d));
    } catch { /* */ }
    setRenaming(false);
  };

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <p style={label(10)}>Paired Devices</p>
        {!wizard && (
          <button onClick={() => setWizard(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', background: 'rgba(212,160,68,0.1)', border: '1px solid rgba(212,160,68,0.3)', color: 'var(--amber)', cursor: 'pointer', transition: 'background 150ms' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(212,160,68,0.2)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(212,160,68,0.1)')}>
            <Radio size={10} /> Setup Device
          </button>
        )}
      </div>

      {/* Wizard */}
      {wizard && <SetupWizard onDone={() => { setWizard(false); load(); }} onCancel={() => setWizard(false)} />}

      {/* List */}
      {loading ? (
        <div style={{ padding: 20, textAlign: 'center' }}>
          <Loader size={16} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} />
        </div>
      ) : devices.length === 0 && !wizard ? (
        <div style={{ padding: '24px 16px', textAlign: 'center', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <Radio size={28} style={{ color: 'var(--text-muted)', opacity: 0.3, marginBottom: 10 }} />
          <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', margin: '0 0 12px' }}>No devices paired yet.</p>
          <button onClick={() => setWizard(true)}
            style={{ padding: '9px 18px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', background: 'rgba(212,160,68,0.1)', border: '1px solid rgba(212,160,68,0.3)', color: 'var(--amber)', cursor: 'pointer', transition: 'background 150ms' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(212,160,68,0.2)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(212,160,68,0.1)')}>
            Setup Roger Device
          </button>
        </div>
      ) : devices.map(dev => {
        const online = dev.last_used_at && (Date.now() - new Date(dev.last_used_at).getTime() < 300_000);
        const isExpanded = expandedId === dev.device_id;
        return (
          <div key={dev.id} style={{ marginBottom: 8, border: `1px solid ${isExpanded ? 'rgba(212,160,68,0.3)' : 'var(--border-subtle)'}`, background: 'var(--bg-elevated)', transition: 'border-color 150ms' }}>
            {/* Device row — tappable */}
            <div
              onClick={() => { setExpandedId(isExpanded ? null : dev.device_id); setEditName(dev.device_name || 'Roger Device'); setRevokeConfirm(null); }}
              style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: online ? 'rgba(34,197,94,0.1)' : 'rgba(107,114,128,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {online ? <Wifi size={14} style={{ color: `rgb(${GREEN})` }} /> : <WifiOff size={14} style={{ color: '#6b7280' }} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)', margin: '0 0 2px', fontWeight: 600 }}>{dev.device_name || 'Roger Device'}</p>
                <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: 0 }}>
                  {online ? '🟢 Online' : '⚫ Offline'} · FW {dev.firmware_ver || '?'} · {timeAgo(dev.last_used_at)}
                </p>
              </div>
              <ChevronRight size={14} style={{ color: 'var(--text-muted)', transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 150ms', flexShrink: 0 }} />
            </div>

            {/* Expanded management panel */}
            {isExpanded && (
              <div style={{ padding: '0 16px 14px', borderTop: '1px solid var(--border-subtle)' }}>
                {/* Info row */}
                <div style={{ padding: '10px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <div>
                    <p style={label(8)}>Device ID</p>
                    <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-primary)', margin: '2px 0 0', wordBreak: 'break-all' }}>{dev.device_id}</p>
                  </div>
                  <div>
                    <p style={label(8)}>Paired</p>
                    <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-primary)', margin: '2px 0 0' }}>{new Date(dev.paired_at).toLocaleDateString()}</p>
                  </div>
                  <div>
                    <p style={label(8)}>Last Active</p>
                    <p style={{ fontFamily: 'monospace', fontSize: 9, color: online ? `rgb(${GREEN})` : 'var(--text-primary)', margin: '2px 0 0' }}>{dev.last_used_at ? new Date(dev.last_used_at).toLocaleString() : 'Never'}</p>
                  </div>
                  <div>
                    <p style={label(8)}>Firmware</p>
                    <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-primary)', margin: '2px 0 0' }}>{dev.firmware_ver || 'Unknown'}</p>
                  </div>
                </div>

                {/* Rename */}
                <div style={{ marginBottom: 10 }}>
                  <p style={{ ...label(8), marginBottom: 4 }}>Rename Device</p>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input value={editName} onChange={e => setEditName(e.target.value)} maxLength={30}
                      style={{ flex: 1, padding: '7px 10px', fontFamily: 'monospace', fontSize: 11, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', boxSizing: 'border-box' }} />
                    <button onClick={() => handleRename(dev.device_id)} disabled={renaming || editName.trim() === (dev.device_name || 'Roger Device')}
                      style={{ padding: '7px 14px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', background: editName.trim() !== (dev.device_name || 'Roger Device') ? 'rgba(212,160,68,0.1)' : 'transparent', border: '1px solid rgba(212,160,68,0.2)', color: 'var(--amber)', cursor: editName.trim() !== (dev.device_name || 'Roger Device') ? 'pointer' : 'default', opacity: editName.trim() === (dev.device_name || 'Roger Device') ? 0.4 : 1 }}>
                      {renaming ? '...' : 'Save'}
                    </button>
                  </div>
                </div>

                {/* Revoke / Lost-Stolen */}
                {revokeConfirm === dev.device_id ? (
                  <div style={{ padding: '12px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)', marginBottom: 6 }}>
                    <p style={{ fontFamily: 'monospace', fontSize: 10, color: `rgb(${RED})`, margin: '0 0 8px', lineHeight: 1.5 }}>
                      ⚠ This will permanently revoke this device's access. It cannot be undone — the device will need to be re-paired. Use this if the device was lost or stolen.
                    </p>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => handleUnpair(dev.device_id)} disabled={unpairingId === dev.device_id}
                        style={{ ...btn(RED), flex: 1 }}>
                        {unpairingId === dev.device_id ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> : '🔴 Confirm Revoke'}
                      </button>
                      <button onClick={() => setRevokeConfirm(null)}
                        style={{ flex: 1, padding: '8px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', cursor: 'pointer' }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setRevokeConfirm(dev.device_id)}
                    style={{ ...btn(RED), opacity: 0.8 }}
                    onMouseEnter={e => { e.currentTarget.style.background = `rgba(${RED},0.15)`; e.currentTarget.style.opacity = '1'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = `rgba(${RED},0.1)`; e.currentTarget.style.opacity = '0.8'; }}>
                    <Trash2 size={12} /> Revoke Access (Lost / Stolen)
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

