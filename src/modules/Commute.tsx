import { useState, useEffect, useCallback, useRef } from 'react';
import { Navigation, MapPin, Package, Clock, RefreshCw, Plus, CheckCircle, X, Car, Train, PersonStanding, Bike } from 'lucide-react';
import {
  fetchCommuteProfile, upsertCommuteProfile,
  fetchErrands, insertErrand, completeErrand,
  fetchLatestParking,
  getCommute,
  type DbCommuteProfile, type DbErrandItem, type DbParkingLog,
} from '../lib/api';
import { useLocation } from '../lib/useLocation';

const USER_ID = 'ADMIN-TEST';

const MODE_ICONS = {
  driving:  <Car size={12} />,
  transit:  <Train size={12} />,
  walking:  <PersonStanding size={12} />,
  cycling:  <Bike size={12} />,
};

export default function Commute() {
  const [profile, setProfile]   = useState<DbCommuteProfile | null>(null);
  const [errands, setErrands]   = useState<DbErrandItem[]>([]);
  const [parking, setParking]   = useState<DbParkingLog | null>(null);
  const [eta, setEta]           = useState<{ duration: string; distance: string; mode: string } | null>(null);
  const [loading, setLoading]   = useState(true);
  const [etaLoading, setEtaLoading] = useState(false);
  const [editProfile, setEditProfile] = useState(false);
  const [draft, setDraft]       = useState<Partial<DbCommuteProfile>>({});
  const [newErrand, setNewErrand] = useState('');
  const [newErrandLoc, setNewErrandLoc] = useState('');
  const [addingErrand, setAddingErrand] = useState(false);

  const { location } = useLocation(USER_ID);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [prof, errandData, park] = await Promise.all([
        fetchCommuteProfile(USER_ID).catch(() => null),
        fetchErrands(USER_ID, 'pending').catch(() => []),
        fetchLatestParking(USER_ID).catch(() => null),
      ]);
      setProfile(prof);
      setErrands(errandData);
      setParking(park);
      if (prof) setDraft(prof);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Live ETA — throttled to once per 60 s to avoid hammering commute-eta edge fn
  const etaLastFetchRef = useRef<number>(0);
  useEffect(() => {
    if (!profile?.work_address || !location) return;
    const now = Date.now();
    if (now - etaLastFetchRef.current < 60_000) return; // skip if called <60s ago
    etaLastFetchRef.current = now;
    setEtaLoading(true);
    getCommute(location.latitude, location.longitude, profile.work_address, profile.commute_mode ?? 'driving')
      .then(result => { if (result) setEta(result); })
      .catch(() => {})
      .finally(() => setEtaLoading(false));
  }, [profile, location]);

  const saveProfile = async () => {
    await upsertCommuteProfile(USER_ID, draft);
    setEditProfile(false);
    await load();
  };

  const addErrand = async () => {
    if (!newErrand.trim()) return;
    setAddingErrand(true);
    try {
      await insertErrand({
        user_id: USER_ID, item: newErrand.trim(),
        location_hint: newErrandLoc.trim() || null,
        location_lat: null, location_lng: null,
        radius_m: 300, status: 'pending', source_tx_id: null,
      });
      setNewErrand(''); setNewErrandLoc('');
      setErrands(await fetchErrands(USER_ID, 'pending'));
    } finally { setAddingErrand(false); }
  };

  const doneErrand = async (id: string) => {
    await completeErrand(id);
    setErrands(prev => prev.filter(e => e.id !== id));
  };

  const timeAgo = (iso: string) => {
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
  };

  // ── Departure Brief ───────────────────────────────────────────────────────
  const [showBrief, setShowBrief] = useState(false);

  const launchBrief = () => setShowBrief(true);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <Car size={15} style={{ color: 'var(--amber)' }} />
        <div style={{ flex: 1 }}>
          <h1 style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: '0.18em', color: 'var(--amber)', textTransform: 'uppercase', margin: 0 }}>
            COMMUTE COMMAND
          </h1>
          <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
            ROUTE INTELLIGENCE / DAILY DRIVER
          </p>
        </div>
        <button onClick={launchBrief} style={{
          padding: '5px 14px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase',
          letterSpacing: '0.12em', cursor: 'pointer',
          background: 'rgba(212,160,68,0.12)', border: '1px solid var(--amber)', color: 'var(--amber)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          DEPARTURE BRIEF
        </button>
        <button onClick={load} style={iconBtn}><RefreshCw size={12} /></button>
      </div>

      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.2em' }}>
          Loading commute data...
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* ── Route Card ── */}
          <div style={card}>
            <div style={cardHeader}>
              <Navigation size={12} style={{ color: 'var(--amber)' }} />
              <span>COMMUTE ROUTE</span>
              <button onClick={() => setEditProfile(e => !e)} style={{ ...iconBtn, marginLeft: 'auto', fontSize: 8 }}>
                {editProfile ? 'CANCEL' : 'EDIT'}
              </button>
            </div>

            {editProfile ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { key: 'home_address', label: 'HOME ADDRESS' },
                  { key: 'work_address', label: 'WORK ADDRESS' },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <div style={fieldLabel}>{label}</div>
                    <input
                      value={(draft as Record<string, string>)[key] ?? ''}
                      onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
                      style={inputStyle} placeholder={label} />
                  </div>
                ))}
                <div>
                  <div style={fieldLabel}>COMMUTE MODE</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['driving', 'transit', 'walking', 'cycling'] as const).map(m => (
                      <button key={m} onClick={() => setDraft(d => ({ ...d, commute_mode: m }))} style={{
                        flex: 1, padding: '5px', fontFamily: 'monospace', fontSize: 8, textTransform: 'uppercase',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                        border: `1px solid ${draft.commute_mode === m ? 'var(--amber)' : 'var(--border-subtle)'}`,
                        background: draft.commute_mode === m ? 'rgba(212,160,68,0.12)' : 'transparent',
                        color: draft.commute_mode === m ? 'var(--amber)' : 'var(--text-muted)',
                      }}>
                        {MODE_ICONS[m]} {m}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={fieldLabel}>LEAVE TIME</div>
                  <input type="time" value={(draft.commute_leave_time ?? '08:00').slice(0, 5)}
                    onChange={e => setDraft(d => ({ ...d, commute_leave_time: e.target.value }))}
                    style={inputStyle} />
                </div>
                <button onClick={saveProfile} style={{
                  padding: '7px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase',
                  letterSpacing: '0.1em', cursor: 'pointer',
                  background: 'rgba(212,160,68,0.15)', border: '1px solid var(--amber)', color: 'var(--amber)',
                }}>SAVE PROFILE</button>
              </div>
            ) : profile?.home_address || profile?.work_address ? (
              <div style={{ display: 'flex', gap: 0, flexDirection: 'column' }}>
                {/* Home → Work row */}
                <div style={{ display: 'flex', alignItems: 'stretch', gap: 0 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginRight: 12 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', flexShrink: 0 }} />
                    <div style={{ flex: 1, width: 1, background: 'var(--border-subtle)', margin: '4px 0' }} />
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--amber)', flexShrink: 0 }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ marginBottom: 10 }}>
                      <div style={fieldLabel}>HOME</div>
                      <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)' }}>{profile?.home_address ?? '—'}</div>
                    </div>
                    <div>
                      <div style={fieldLabel}>WORK</div>
                      <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)' }}>{profile?.work_address ?? '—'}</div>
                    </div>
                  </div>
                </div>
                {/* ETA banner */}
                <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(212,160,68,0.07)', border: '1px solid rgba(212,160,68,0.2)', display: 'flex', alignItems: 'center', gap: 12 }}>
                  {MODE_ICONS[profile?.commute_mode ?? 'driving']}
                  {etaLoading ? (
                    <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>Calculating ETA...</span>
                  ) : eta ? (
                    <>
                      <span style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 700, color: 'var(--amber)' }}>{eta.duration}</span>
                      <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>{eta.distance} · {eta.mode}</span>
                    </>
                  ) : (
                    <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>
                      {location ? 'ETA unavailable' : 'Enable GPS for live ETA'}
                    </span>
                  )}
                  <div style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)' }}>
                    {profile?.commute_mode?.toUpperCase()} · LEAVE {(profile?.commute_leave_time ?? '08:00').slice(0, 5)}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '24px 0', opacity: 0.5 }}>
                <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 8 }}>
                  No commute profile set
                </div>
                <button onClick={() => setEditProfile(true)} style={{ ...iconBtn, color: 'var(--amber)', borderColor: 'rgba(212,160,68,0.4)' }}>
                  + SET UP ROUTE
                </button>
              </div>
            )}
          </div>

          {/* ── Errand List ── */}
          <div style={card}>
            <div style={cardHeader}>
              <Package size={12} style={{ color: '#8b5cf6' }} />
              <span style={{ color: '#8b5cf6' }}>ERRAND LIST</span>
              <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)' }}>
                {errands.length} PENDING
              </span>
            </div>

            {/* Add errand row */}
            <div style={{ display: 'flex', gap: 6, marginBottom: errands.length > 0 ? 10 : 0 }}>
              <input value={newErrand} onChange={e => setNewErrand(e.target.value)}
                placeholder="Add errand..."
                onKeyDown={e => e.key === 'Enter' && addErrand()}
                style={{ ...inputStyle, flex: 2 }} />
              <input value={newErrandLoc} onChange={e => setNewErrandLoc(e.target.value)}
                placeholder="Location (optional)"
                onKeyDown={e => e.key === 'Enter' && addErrand()}
                style={{ ...inputStyle, flex: 1 }} />
              <button onClick={addErrand} disabled={addingErrand || !newErrand.trim()} style={{
                padding: '5px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center',
                background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.4)', color: '#8b5cf6',
              }}>
                <Plus size={12} />
              </button>
            </div>

            {errands.length === 0 ? (
              <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', margin: '8px 0 0', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                No errands — add one or say "On the way home, pick up..."
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {errands.map(e => (
                  <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)' }}>
                    <button onClick={() => doneErrand(e.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}>
                      <CheckCircle size={14} />
                    </button>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)' }}>{e.item}</div>
                      {e.location_hint && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                          <MapPin size={8} style={{ color: '#8b5cf6' }} />
                          <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)' }}>{e.location_hint}</span>
                        </div>
                      )}
                    </div>
                    <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)' }}>{timeAgo(e.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Parking Log ── */}
          <div style={card}>
            <div style={cardHeader}>
              <MapPin size={12} style={{ color: '#3b82f6' }} />
              <span style={{ color: '#3b82f6' }}>PARKING MEMORY</span>
            </div>
            {parking ? (
              <div style={{ padding: '10px 12px', background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.25)' }}>
                <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', marginBottom: 6 }}>
                  {parking.location_label}
                </div>
                {parking.address && (
                  <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', marginBottom: 4 }}>{parking.address}</div>
                )}
                {parking.notes && (
                  <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', marginBottom: 8 }}>Note: {parking.notes}</div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Clock size={9} style={{ color: 'var(--text-muted)' }} />
                  <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)' }}>Logged {timeAgo(parking.created_at)}</span>
                </div>
              </div>
            ) : (
              <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', margin: '8px 0 0', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                No parking logged — say "I parked at Level B2" to save
              </p>
            )}
          </div>

        </div>
      )}

      {/* ── Departure Brief Overlay ── */}
      {showBrief && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', width: '100%', maxWidth: 440, padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.18em' }}>
                DEPARTURE BRIEF
              </span>
              <button onClick={() => setShowBrief(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={14} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { icon: '', label: 'ETA TO WORK', value: eta ? `${eta.duration} (${eta.distance})` : 'Enable GPS', color: 'var(--amber)' },
                { icon: '', label: 'PENDING ERRANDS', value: `${errands.length} item${errands.length !== 1 ? 's' : ''} on route`, color: '#8b5cf6' },
                { icon: '', label: 'PARKING STATUS', value: parking ? `Last parked: ${parking.location_label}` : 'No log', color: '#3b82f6' },
                { icon: '', label: 'ROGER STATUS', value: 'Standing by · All systems active', color: '#10b981' },
              ].map(row => (
                <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)' }}>
                  <span style={{ fontSize: 16 }}>{row.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>{row.label}</div>
                    <div style={{ fontFamily: 'monospace', fontSize: 11, color: row.color }}>{row.value}</div>
                  </div>
                </div>
              ))}
            </div>

            <button onClick={() => setShowBrief(false)} style={{
              width: '100%', marginTop: 16, padding: '9px', fontFamily: 'monospace', fontSize: 10,
              textTransform: 'uppercase', letterSpacing: '0.15em', cursor: 'pointer',
              background: 'rgba(212,160,68,0.12)', border: '1px solid var(--amber)', color: 'var(--amber)',
            }}>
              UNDERSTOOD — DRIVE SAFE
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const card: React.CSSProperties = {
  background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', padding: '14px 16px',
};
const cardHeader: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
  fontFamily: 'monospace', fontSize: 9, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.15em',
};
const fieldLabel: React.CSSProperties = {
  fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase',
  letterSpacing: '0.1em', marginBottom: 4,
};
const iconBtn: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--border-subtle)',
  padding: '4px 8px', cursor: 'pointer', color: 'var(--text-muted)',
  display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'monospace', fontSize: 9,
};
const inputStyle: React.CSSProperties = {
  background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)',
  padding: '6px 10px', fontFamily: 'monospace', fontSize: 10, color: 'var(--text-primary)',
  outline: 'none', width: '100%',
};
