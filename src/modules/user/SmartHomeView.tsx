import { useState, useEffect, useCallback } from 'react';
import { Zap, RefreshCw, Power, Play, Wifi, WifiOff, Home, ChevronRight } from 'lucide-react';
import { RogerIcon } from '../../components/icons';
import { listTuyaDevices, controlDevice, listTuyaScenes, triggerTuyaScene, TUYA_CATEGORY_LABELS, type TuyaDevice, type TuyaScene } from '../../lib/tuya';
import { fetchUserPreferences } from '../../lib/api';
import { useI18n } from '../../context/I18nContext';

type ViewMode = 'devices' | 'scenes';

export default function SmartHomeView({ userId }: { userId: string }) {
  const { t: _t } = useI18n();
  const [devices, setDevices]     = useState<TuyaDevice[]>([]);
  const [scenes, setScenes]       = useState<TuyaScene[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [tuyaUid, setTuyaUid]     = useState<string | null>(null);
  const [viewMode, setViewMode]   = useState<ViewMode>('devices');
  const [toggling, setToggling]   = useState<Set<string>>(new Set());
  const [triggeringScene, setTriggeringScene] = useState<string | null>(null);

  // Load Tuya UID from preferences
  useEffect(() => {
    fetchUserPreferences(userId).then(prefs => {
      const uid = (prefs as Record<string, unknown> | null)?.tuya_uid as string | undefined;
      setTuyaUid(uid ?? null);
    }).catch(() => {});
  }, [userId]);

  const loadDevices = useCallback(async () => {
    if (!tuyaUid) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const devs = await listTuyaDevices(tuyaUid);
      setDevices(devs);
      // Also load scenes from the first home
      if (devs.length > 0) {
        const homeId = String((devs[0] as TuyaDevice).home_id);
        const sc = await listTuyaScenes(homeId).catch(() => []);
        setScenes(sc);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load devices');
    } finally {
      setLoading(false);
    }
  }, [tuyaUid]);

  useEffect(() => { loadDevices(); }, [loadDevices]);

  // Toggle a device on/off
  const handleToggle = async (device: TuyaDevice) => {
    setToggling(prev => new Set(prev).add(device.id));
    try {
      // Find current switch state
      const switchStatus = device.status.find(s =>
        s.code === 'switch_1' || s.code === 'switch_led' || s.code === 'switch'
      );
      const currentVal = switchStatus?.value === true;
      const code = switchStatus?.code ?? 'switch_1';
      await controlDevice(device.id, [{ code, value: !currentVal }]);
      // Update local state optimistically
      setDevices(prev => prev.map(d => {
        if (d.id !== device.id) return d;
        return {
          ...d,
          status: d.status.map(s =>
            s.code === code ? { ...s, value: !currentVal } : s
          ),
        };
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Command failed');
    } finally {
      setToggling(prev => { const s = new Set(prev); s.delete(device.id); return s; });
    }
  };

  // Trigger a scene
  const handleTriggerScene = async (scene: TuyaScene) => {
    if (!devices[0]) return;
    setTriggeringScene(scene.scene_id);
    try {
      await triggerTuyaScene(String(devices[0].home_id), scene.scene_id);
      // Refresh device states after scene execution
      setTimeout(() => loadDevices(), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scene trigger failed');
    } finally {
      setTimeout(() => setTriggeringScene(null), 1500);
    }
  };

  const isDeviceOn = (device: TuyaDevice): boolean => {
    const sw = device.status.find(s =>
      s.code === 'switch_1' || s.code === 'switch_led' || s.code === 'switch'
    );
    return sw?.value === true;
  };

  const getCategoryInfo = (cat: string) => TUYA_CATEGORY_LABELS[cat] ?? { label: cat.toUpperCase(), emoji: '', iconName: 'device-unknown' };

  const onlineCount  = devices.filter(d => d.online).length;
  const offlineCount = devices.filter(d => !d.online).length;
  const onCount      = devices.filter(d => isDeviceOn(d)).length;

  // ── No Tuya UID configured ───────────────────────────────────────────────
  if (!tuyaUid && !loading) {
    return (
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 20 }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(212,160,68,0.1)', border: '2px solid rgba(212,160,68,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Home size={28} style={{ color: 'var(--amber)' }} />
        </div>
        <div style={{ textAlign: 'center', maxWidth: 320 }}>
          <p style={{ fontFamily: 'monospace', fontSize: 14, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, margin: '0 0 8px' }}>
            Smart Home
          </p>
          <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', margin: '0 0 20px', lineHeight: 1.6 }}>
            Connect your Tuya / SmartLife account to control garage doors, switches, lights, and automations via voice.
          </p>
        </div>
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', padding: 16, maxWidth: 320, width: '100%' }}>
          <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.15em', margin: '0 0 12px', fontWeight: 600 }}>Setup Steps</p>
          {[
            { step: '1', text: 'Open the SmartLife or Tuya Smart app' },
            { step: '2', text: 'Go to Profile → Account and Security' },
            { step: '3', text: 'Copy your Account UID' },
            { step: '4', text: 'Paste it in Settings → Integrations → Tuya Smart Home' },
          ].map(({ step, text }) => (
            <div key={step} style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'flex-start' }}>
              <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--amber)', background: 'rgba(212,160,68,0.15)', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, borderRadius: '50%', fontWeight: 700 }}>{step}</span>
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{text}</span>
            </div>
          ))}
        </div>
        <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', maxWidth: 280, lineHeight: 1.5 }}>
          After setup, say <span style={{ color: 'var(--amber)' }}>"turn off the garage"</span> or <span style={{ color: 'var(--amber)' }}>"run goodnight scene"</span> via PTT.
        </p>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ── Header ── */}
      <div style={{ padding: '14px 16px 10px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Zap size={14} style={{ color: 'var(--amber)' }} />
            <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>Smart Home</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px', border: `1px solid ${error ? 'rgba(239,68,68,0.3)' : 'rgba(74,222,128,0.3)'}`, background: error ? 'rgba(239,68,68,0.06)' : 'rgba(74,222,128,0.06)' }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: error ? '#ef4444' : 'var(--green)' }} />
              <span style={{ fontFamily: 'monospace', fontSize: 8, color: error ? '#ef4444' : 'var(--green)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                {error ? 'ERROR' : 'TUYA'}
              </span>
            </div>
          </div>
          <button
            onClick={loadDevices}
            disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', cursor: loading ? 'not-allowed' : 'pointer' }}
          >
            <RefreshCw size={10} style={loading ? { animation: 'spin 1s linear infinite' } : {}} /> Refresh
          </button>
        </div>

        {/* Stats bar */}
        {!loading && devices.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            {[
              { label: 'DEVICES', val: devices.length, color: 'var(--amber)' },
              { label: 'ONLINE', val: onlineCount, color: 'var(--green)' },
              { label: 'ACTIVE', val: onCount, color: '#60a5fa' },
              { label: 'OFFLINE', val: offlineCount, color: offlineCount > 0 ? 'var(--rust)' : 'var(--text-muted)' },
            ].map(s => (
              <div key={s.label} style={{ flex: 1, padding: '6px 8px', border: `1px solid ${s.color}33`, background: `${s.color}0a`, textAlign: 'center' }}>
                <p style={{ fontFamily: 'monospace', fontSize: 14, color: s.color, fontWeight: 700, margin: 0 }}>{s.val}</p>
                <p style={{ fontFamily: 'monospace', fontSize: 7, color: s.color, textTransform: 'uppercase', letterSpacing: '0.15em', margin: 0 }}>{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* View mode toggle */}
        <div style={{ display: 'flex', gap: 4 }}>
          {(['devices', 'scenes'] as ViewMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                flex: 1, padding: '6px', fontFamily: 'monospace', fontSize: 10,
                textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer',
                border: `1px solid ${viewMode === mode ? 'var(--amber)' : 'var(--border-subtle)'}`,
                background: viewMode === mode ? 'rgba(212,160,68,0.1)' : 'transparent',
                color: viewMode === mode ? 'var(--amber)' : 'var(--text-muted)',
              }}
            >
              {mode === 'devices' ? `Devices (${devices.length})` : `Scenes (${scenes.length})`}
            </button>
          ))}
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div style={{ margin: '0 16px 8px', padding: '8px 12px', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)' }}>
          <p style={{ fontFamily: 'monospace', fontSize: 10, color: '#ef4444', margin: 0 }}>{error}</p>
        </div>
      )}

      {/* ── Content ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px' }}>
        {/* Loading */}
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8 }}>
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} style={{ height: 72, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', opacity: 0.5 + (i % 3) * 0.15 }}>
                <div style={{ height: '100%', background: 'linear-gradient(90deg, transparent 0%, rgba(212,160,68,0.03) 50%, transparent 100%)', animation: `pulse 1.5s ease-in-out infinite ${i * 0.1}s` }} />
              </div>
            ))}
          </div>
        )}

        {/* ── Devices Grid ── */}
        {!loading && viewMode === 'devices' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, paddingTop: 8 }}>
            {devices.length === 0 && (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px 0' }}>
                <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>No devices found</p>
                <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', margin: '6px 0 0' }}>Make sure devices are added in SmartLife app</p>
              </div>
            )}
            {devices.map(device => {
              const on = isDeviceOn(device);
              const cat = getCategoryInfo(device.category);
              const isToggling = toggling.has(device.id);
              const accentColor = on ? '#60a5fa' : 'var(--text-muted)';

              return (
                <button
                  key={device.id}
                  onClick={() => handleToggle(device)}
                  disabled={!device.online || isToggling}
                  style={{
                    padding: '14px 12px',
                    border: `1px solid ${on ? 'rgba(96,165,250,0.35)' : 'var(--border-subtle)'}`,
                    background: on ? 'rgba(96,165,250,0.06)' : 'var(--bg-elevated)',
                    cursor: device.online ? 'pointer' : 'not-allowed',
                    opacity: device.online ? 1 : 0.45,
                    textAlign: 'left',
                    transition: 'all 200ms',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  {/* Toggling overlay */}
                  {isToggling && (
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
                      <RefreshCw size={16} style={{ color: 'var(--amber)', animation: 'spin 0.8s linear infinite' }} />
                    </div>
                  )}

                  {/* Top row: emoji + status */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <RogerIcon name={cat.iconName} size={22} color={on ? '#60a5fa' : 'var(--text-muted)'} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {device.online
                        ? <Wifi size={9} style={{ color: 'var(--green)' }} />
                        : <WifiOff size={9} style={{ color: 'var(--rust)' }} />
                      }
                      <Power size={12} style={{ color: accentColor }} />
                    </div>
                  </div>

                  {/* Device name */}
                  <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)', margin: 0, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {device.name}
                  </p>

                  {/* Category + state */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                      {cat.label}
                    </span>
                    <span style={{
                      fontFamily: 'monospace', fontSize: 8, fontWeight: 700,
                      padding: '1px 6px',
                      border: `1px solid ${on ? 'rgba(96,165,250,0.4)' : 'var(--border-subtle)'}`,
                      color: accentColor,
                      textTransform: 'uppercase',
                      letterSpacing: '0.1em',
                    }}>
                      {on ? 'ON' : 'OFF'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Scenes List ── */}
        {!loading && viewMode === 'scenes' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8 }}>
            {scenes.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>No scenes found</p>
                <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', margin: '6px 0 0' }}>Create tap-to-run scenes in the SmartLife app</p>
              </div>
            )}
            {scenes.map(scene => {
              const isTriggering = triggeringScene === scene.scene_id;
              return (
                <button
                  key={scene.scene_id}
                  onClick={() => handleTriggerScene(scene)}
                  disabled={isTriggering}
                  style={{
                    padding: '14px 16px',
                    border: `1px solid ${isTriggering ? 'rgba(212,160,68,0.5)' : 'var(--border-subtle)'}`,
                    background: isTriggering ? 'rgba(212,160,68,0.08)' : 'var(--bg-elevated)',
                    cursor: isTriggering ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: 12,
                    textAlign: 'left',
                    transition: 'all 200ms',
                  }}
                >
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: isTriggering ? 'rgba(212,160,68,0.2)' : 'rgba(212,160,68,0.08)',
                    border: `1px solid ${isTriggering ? 'var(--amber)' : 'rgba(212,160,68,0.2)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'all 300ms',
                  }}>
                    <Play size={14} style={{ color: isTriggering ? 'var(--amber)' : 'var(--text-muted)', marginLeft: 2 }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', margin: '0 0 2px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      {scene.name}
                    </p>
                    <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: 0 }}>
                      {isTriggering ? 'Executing...' : 'Tap-to-run scene'}
                    </p>
                  </div>
                  <ChevronRight size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Voice hint ── */}
      <div style={{
        flexShrink: 0, padding: '8px 16px', borderTop: '1px solid var(--border-subtle)',
        background: 'rgba(212,160,68,0.03)',
      }}>
        <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: 0, textAlign: 'center', lineHeight: 1.5 }}>
          Voice: <span style={{ color: 'var(--amber)' }}>"turn off the garage"</span> · <span style={{ color: 'var(--amber)' }}>"set AC to 22"</span> · <span style={{ color: 'var(--amber)' }}>"run goodnight"</span>
        </p>
      </div>
    </div>
  );
}
