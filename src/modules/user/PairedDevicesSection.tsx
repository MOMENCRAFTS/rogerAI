import { useState, useEffect, useCallback, useRef } from 'react';
import { Radio, Loader, Trash2, Plus, Wifi, WifiOff, Camera, X } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { fetchPairedDevices, pairDevice, unpairDevice, type DbPairedDevice } from '../../lib/api';

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/** Parse roger://pair?device_id=xxx&code=yyy from QR content */
function parseQrData(raw: string): { device_id: string; code: string } | null {
  try {
    // Handle both roger:// scheme and plain URL
    const url = raw.replace('roger://', 'https://roger.local/');
    const u = new URL(url);
    const device_id = u.searchParams.get('device_id');
    const code = u.searchParams.get('code');
    if (device_id && code) return { device_id, code };
  } catch { /* not a URL */ }

  // Fallback: try JSON
  try {
    const obj = JSON.parse(raw);
    if (obj.device_id && obj.code) return obj;
  } catch { /* not JSON */ }

  return null;
}

export default function PairedDevicesSection({ userId: _userId }: { userId: string }) {
  const [devices, setDevices] = useState<DbPairedDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPairForm, setShowPairForm] = useState(false);
  const [pairDeviceId, setPairDeviceId] = useState('');
  const [pairCode, setPairCode] = useState('');
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState('');
  const [pairSuccess, setPairSuccess] = useState('');
  const [unpairingId, setUnpairingId] = useState<string | null>(null);

  // QR Scanner state
  const [scanning, setScanning] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerDivId = 'roger-qr-scanner';

  const load = useCallback(async () => {
    try {
      const d = await fetchPairedDevices();
      setDevices(d);
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Cleanup scanner on unmount
  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current = null;
      }
    };
  }, []);

  const startScanner = async () => {
    setPairError('');
    setPairSuccess('');
    setScanning(true);

    // Wait for DOM element to render
    await new Promise(r => setTimeout(r, 100));

    try {
      const scanner = new Html5Qrcode(scannerDivId);
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 200, height: 200 } },
        (decodedText) => {
          // QR code detected
          const parsed = parseQrData(decodedText);
          if (parsed) {
            setPairDeviceId(parsed.device_id);
            setPairCode(parsed.code);
            setPairSuccess('QR code scanned — pairing...');
            stopScanner();
            // Auto-pair
            autoPair(parsed.device_id, parsed.code);
          } else {
            setPairError('Invalid QR code. Point at the Roger device display.');
          }
        },
        () => { /* ignore scan failures */ }
      );
    } catch (err: any) {
      setPairError('Camera access denied. Use manual entry below.');
      setScanning(false);
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch { /* */ }
      scannerRef.current = null;
    }
    setScanning(false);
  };

  const autoPair = async (deviceId: string, code: string) => {
    setPairing(true);
    setPairError('');
    try {
      await pairDevice(deviceId, code);
      setPairSuccess('Device paired successfully.');
      setShowPairForm(false);
      setPairDeviceId('');
      setPairCode('');
      await load();
    } catch (e: any) {
      setPairError(e.message || 'Pairing failed');
      setPairSuccess('');
    }
    setPairing(false);
  };

  const handlePair = async () => {
    if (!pairDeviceId.trim() || !pairCode.trim()) {
      setPairError('Enter both device ID and pairing code');
      return;
    }
    await autoPair(pairDeviceId.trim(), pairCode.trim().toUpperCase());
  };

  const handleUnpair = async (deviceId: string) => {
    setUnpairingId(deviceId);
    try {
      await unpairDevice(deviceId);
      setDevices(prev => prev.filter(d => d.device_id !== deviceId));
    } catch { /* silent */ }
    setUnpairingId(null);
  };

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', margin: 0 }}>
          Paired Devices
        </p>
        <button
          onClick={() => { setShowPairForm(!showPairForm); if (scanning) stopScanner(); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '4px 10px', fontFamily: 'monospace', fontSize: 9,
            textTransform: 'uppercase', letterSpacing: '0.1em',
            background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.3)',
            color: '#3b82f6', cursor: 'pointer',
          }}
        >
          <Plus size={10} /> Pair
        </button>
      </div>

      {/* Pair Form */}
      {showPairForm && (
        <div style={{
          marginBottom: 12, padding: '14px 16px',
          border: '1px solid rgba(59,130,246,0.3)',
          background: 'rgba(59,130,246,0.04)',
        }}>
          {/* QR Scanner */}
          {!scanning ? (
            <button
              onClick={startScanner}
              style={{
                width: '100%', padding: '14px', marginBottom: 12,
                fontFamily: 'monospace', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em',
                background: 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(139,92,246,0.15))',
                border: '1px solid rgba(59,130,246,0.4)', color: '#3b82f6', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              <Camera size={16} /> Scan QR Code on Device
            </button>
          ) : (
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <p style={{ fontFamily: 'monospace', fontSize: 10, color: '#3b82f6', margin: 0, fontWeight: 600 }}>
                  Point camera at the device display
                </p>
                <button
                  onClick={stopScanner}
                  style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', padding: 4 }}
                >
                  <X size={16} />
                </button>
              </div>
              <div
                id={scannerDivId}
                style={{
                  width: '100%', maxWidth: 280, margin: '0 auto',
                  borderRadius: 8, overflow: 'hidden',
                  border: '2px solid rgba(59,130,246,0.4)',
                }}
              />
            </div>
          )}

          {/* Success message */}
          {pairSuccess && (
            <p style={{ fontFamily: 'monospace', fontSize: 10, color: '#22c55e', margin: '0 0 8px', fontWeight: 600 }}>{pairSuccess}</p>
          )}

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 12px' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
            <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>or enter manually</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
          </div>

          <input
            value={pairDeviceId}
            onChange={e => setPairDeviceId(e.target.value)}
            placeholder="Device ID (from device screen)"
            style={{
              width: '100%', padding: '8px 10px', marginBottom: 8,
              fontFamily: 'monospace', fontSize: 11,
              background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)', boxSizing: 'border-box',
            }}
          />
          <input
            value={pairCode}
            onChange={e => setPairCode(e.target.value.toUpperCase())}
            placeholder="6-digit pairing code"
            maxLength={6}
            style={{
              width: '100%', padding: '8px 10px', marginBottom: 8,
              fontFamily: 'monospace', fontSize: 14, letterSpacing: '0.3em', textAlign: 'center',
              background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)', boxSizing: 'border-box',
            }}
          />
          {pairError && (
            <p style={{ fontFamily: 'monospace', fontSize: 10, color: '#ef4444', margin: '0 0 8px' }}>{pairError}</p>
          )}
          <button
            onClick={handlePair}
            disabled={pairing}
            style={{
              width: '100%', padding: '10px',
              fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em',
              background: pairing ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.12)',
              border: '1px solid rgba(59,130,246,0.4)', color: '#3b82f6', cursor: pairing ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            {pairing ? <><Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> Pairing...</> : 'Pair Device'}
          </button>
        </div>
      )}

      {/* Device List */}
      {loading ? (
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <Loader size={16} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} />
        </div>
      ) : devices.length === 0 ? (
        <div style={{
          padding: '20px 16px', textAlign: 'center',
          border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)',
        }}>
          <Radio size={24} style={{ color: 'var(--text-muted)', opacity: 0.4, marginBottom: 8 }} />
          <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>
            No devices paired. Tap "+ Pair" to connect your Roger hardware.
          </p>
        </div>
      ) : (
        devices.map(dev => (
          <div
            key={dev.id}
            style={{
              marginBottom: 8, padding: '12px 16px',
              border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)',
              display: 'flex', alignItems: 'center', gap: 12,
            }}
          >
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              background: dev.last_used_at && (Date.now() - new Date(dev.last_used_at).getTime() < 300_000)
                ? 'rgba(34,197,94,0.12)' : 'rgba(107,114,128,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              {dev.last_used_at && (Date.now() - new Date(dev.last_used_at).getTime() < 300_000)
                ? <Wifi size={14} style={{ color: '#22c55e' }} />
                : <WifiOff size={14} style={{ color: '#6b7280' }} />
              }
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)', margin: '0 0 2px', fontWeight: 600 }}>
                {dev.device_name || 'Roger Device'}
              </p>
              <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: 0 }}>
                {dev.device_id.substring(0, 18)} · FW {dev.firmware_ver || '?'} · {timeAgo(dev.last_used_at)}
              </p>
            </div>

            <button
              onClick={() => handleUnpair(dev.device_id)}
              disabled={unpairingId === dev.device_id}
              style={{
                flexShrink: 0, padding: '6px 8px', background: 'transparent',
                border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', cursor: 'pointer',
              }}
            >
              {unpairingId === dev.device_id
                ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} />
                : <Trash2 size={12} />
              }
            </button>
          </div>
        ))
      )}
    </div>
  );
}
