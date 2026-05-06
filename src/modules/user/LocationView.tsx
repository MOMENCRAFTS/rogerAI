import { useState, useEffect, useCallback, useRef } from 'react';
import { MapPin, Cloud, Bell, BookOpen, Loader, Car, Train, Navigation, RefreshCw, AlertCircle, Compass, Sun, Eye, Gauge, Pin, X, Check, Home, Briefcase, Plus } from 'lucide-react';
import { fetchWeather, type WeatherData } from '../../lib/weather';
import {
  fetchReminders, fetchMemories, upsertCommuteProfile, upsertMemoryFact,
  fetchSavedSpots, upsertSavedSpot, deleteSavedSpot, reverseGeocode,
  type DbReminder, type DbMemory, type DbSavedSpot,
} from '../../lib/api';
import type { UserLocation } from '../../lib/useLocation';
import {
  fetchCommuteETAs,
  loadUserDestinations,
  formatDuration,
  trafficLevel,
  type CommuteSnapshot,
  type CommuteDestination,
  type CommuteMode,
} from '../../lib/commute';
import { fetchNearbyPlaces, NEARBY_CATEGORIES, type NearbyPlace } from '../../lib/nearbyPlaces';
import { useI18n } from '../../context/I18nContext';

interface LocationViewProps {
  userId: string;
  location: UserLocation | null;
}

export default function LocationView({ userId, location }: LocationViewProps) {
  const { t: _t } = useI18n();
  const [weather, setWeather]       = useState<WeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [geoReminders, setGeoReminders] = useState<DbReminder[]>([]);
  const [placeMemories, setPlaceMemories] = useState<DbMemory[]>([]);
  const [loading, setLoading]       = useState(true);

  // Nearby places state
  const [nearbyCategory, setNearbyCategory] = useState<string | null>(null);
  const [nearbyPlaces, setNearbyPlaces]     = useState<NearbyPlace[]>([]);
  const [nearbyLoading, setNearbyLoading]   = useState(false);

  // Commute ETA state
  const [commute, setCommute]             = useState<CommuteSnapshot | null>(null);
  const [commuteLoading, setCommuteLoading] = useState(false);
  const [commuteError, setCommuteError]   = useState<string | null>(null);
  const [commuteMode, setCommuteMode]     = useState<CommuteMode>('driving');
  const [destinations, setDestinations]   = useState<CommuteDestination[]>([]);

  // Saved spots state
  const [savedSpots, setSavedSpots]       = useState<DbSavedSpot[]>([]);
  const [pinning, setPinning]             = useState(false);
  const [pinFlash, setPinFlash]           = useState<string | null>(null);
  const [customLabel, setCustomLabel]     = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [reverseAddr, setReverseAddr]     = useState<string | null>(null);
  const [reverseLoading, setReverseLoading] = useState(false);

  // Fetch weather when location becomes available
  useEffect(() => {
    if (!location) return;
    setWeatherLoading(true);
    fetchWeather(location.latitude, location.longitude, location.city)
      .then(wx => { setWeather(wx); setWeatherLoading(false); })
      .catch(() => setWeatherLoading(false));
  }, [location?.latitude, location?.longitude]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load user destinations once
  useEffect(() => {
    loadUserDestinations(userId).then(setDestinations);
  }, [userId]);

  // Load saved spots
  useEffect(() => {
    fetchSavedSpots(userId).then(setSavedSpots).catch(() => {});
  }, [userId]);

  // Reverse-geocode current position
  useEffect(() => {
    if (!location) return;
    setReverseLoading(true);
    reverseGeocode(location.latitude, location.longitude)
      .then(addr => { setReverseAddr(addr); setReverseLoading(false); })
      .catch(() => setReverseLoading(false));
  }, [location?.latitude, location?.longitude]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pin flash helper
  const flash = (msg: string) => { setPinFlash(msg); setTimeout(() => setPinFlash(null), 2500); };

  // Pin location handler
  const handlePin = useCallback(async (type: 'home' | 'work' | 'other', label?: string) => {
    if (!location || pinning) return;
    setPinning(true);
    try {
      const addr = reverseAddr ?? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;
      const spotLabel = type === 'home' ? 'Home' : type === 'work' ? 'Work' : (label ?? 'Custom');

      // Save to saved_spots table
      await upsertSavedSpot(userId, {
        label: spotLabel, spot_type: type,
        lat: location.latitude, lng: location.longitude,
        address: addr,
      });

      // For home/work, also update user_preferences for commute ETA integration
      if (type === 'home') {
        await upsertCommuteProfile(userId, {
          home_address: addr, home_lat: location.latitude, home_lng: location.longitude,
        });
      } else if (type === 'work') {
        await upsertCommuteProfile(userId, {
          work_address: addr, work_lat: location.latitude, work_lng: location.longitude,
        });
      }

      // Sync to memory graph for AI context
      await upsertMemoryFact({
        user_id: userId, fact_type: 'preference',
        subject: 'user', predicate: `${type} location is`,
        object: addr, confidence: 100,
        is_confirmed: true, is_draft: false, source_tx: 'location_pin',
      }).catch(() => {});

      // Refresh spots list + destinations
      const [spots] = await Promise.all([
        fetchSavedSpots(userId).catch(() => [] as DbSavedSpot[]),
        loadUserDestinations(userId).then(setDestinations).catch(() => {}),
      ]);
      setSavedSpots(spots);
      flash(`✓ ${spotLabel} pinned`);
      setShowCustomInput(false);
      setCustomLabel('');
    } catch (e) {
      flash(`✕ Failed: ${(e as Error).message}`);
    } finally {
      setPinning(false);
    }
  }, [location, pinning, reverseAddr, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Delete spot handler
  const handleDeleteSpot = useCallback(async (spot: DbSavedSpot) => {
    try {
      await deleteSavedSpot(spot.id);
      setSavedSpots(prev => prev.filter(s => s.id !== spot.id));
      flash(`✓ ${spot.label} removed`);
    } catch { flash('✕ Failed to delete'); }
  }, []);

  // Distance calculator (meters between two points)
  const distanceBetween = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  // Fetch commute ETAs
  const refreshCommute = useCallback(async (mode: CommuteMode = commuteMode) => {
    if (!location || !destinations.length) return;
    setCommuteLoading(true);
    setCommuteError(null);
    try {
      const snap = await fetchCommuteETAs(
        location.latitude, location.longitude, destinations, mode, userId,
      );
      setCommute(snap);
    } catch (e) {
      setCommuteError((e as Error).message ?? 'Could not fetch commute data');
    } finally {
      setCommuteLoading(false);
    }
  }, [location, destinations, commuteMode, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch commute ETAs — auto-refresh at most once per 5 minutes
  const lastAutoFetchRef = useRef<number>(0);
  const AUTO_COMMUTE_GAP_MS = 5 * 60 * 1000; // 5 minutes
  useEffect(() => {
    if (!location || !destinations.length) return;
    const now = Date.now();
    if (now - lastAutoFetchRef.current < AUTO_COMMUTE_GAP_MS) return;
    lastAutoFetchRef.current = now;
    refreshCommute(commuteMode);
  }, [location?.latitude, location?.longitude, destinations.length, commuteMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch geo reminders + place-tagged memories
  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchReminders(userId, 'pending').catch(() => []),
      fetchMemories(userId).catch(() => []),
    ]).then(([reminders, memories]) => {
      // Filter to geo reminders only (have a due_location set and not yet triggered)
      const geo = (reminders as DbReminder[]).filter(
        r => (r as DbReminder & { due_location?: string; geo_triggered?: boolean }).due_location &&
             !(r as DbReminder & { geo_triggered?: boolean }).geo_triggered
      );
      // Filter to memories with a location label (last 10)
      const placed = (memories as DbMemory[])
        .filter(m => (m as DbMemory & { location_label?: string }).location_label)
        .slice(0, 10);
      setGeoReminders(geo);
      setPlaceMemories(placed);
      setLoading(false);
    });
  }, [userId]);

  const hasLocation = !!location;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>

      {/* ── Header ── */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <MapPin size={14} style={{ color: '#6366f1' }} />
        <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.18em', fontWeight: 600 }}>
          Location Intel
        </span>
      </div>

      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Current Position ── */}
        <section>
          <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.18em', marginBottom: 8 }}>
            Current Position
          </div>
          <div style={{ padding: '14px 16px', border: '1px solid rgba(99,102,241,0.2)', background: 'rgba(99,102,241,0.04)' }}>
            {hasLocation ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#6366f1', boxShadow: '0 0 8px rgba(99,102,241,0.6)', animation: 'pulse 2s infinite' }} />
                  <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>
                    {location.city ? `${location.city}${location.country ? `, ${location.country}` : ''}` : 'Position acquired'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 16, fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>
                  <span>{location.latitude.toFixed(4)}° N</span>
                  <span>{location.longitude.toFixed(4)}° E</span>
                  {location.accuracy && (
                    <span style={{ marginLeft: 'auto' }}>±{Math.round(location.accuracy)}m accuracy</span>
                  )}
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: 0.5 }}>
                <MapPin size={13} style={{ color: 'var(--text-muted)' }} />
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>
                  Awaiting GPS signal — allow location access
                </span>
              </div>
            )}
          </div>
        </section>

        {/* ── Pin This Location ── */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <Pin size={10} style={{ color: '#f59e0b' }} />
            <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.18em' }}>
              Pin This Location
            </div>
            {pinFlash && (
              <span style={{
                fontFamily: 'monospace', fontSize: 9, marginLeft: 'auto',
                color: pinFlash.startsWith('✓') ? 'var(--green)' : '#ef4444',
                animation: 'pulse 0.6s ease-in-out',
              }}>{pinFlash}</span>
            )}
          </div>

          <div style={{
            padding: '14px 16px', border: '1px solid rgba(245,158,11,0.2)',
            background: 'rgba(245,158,11,0.03)',
          }}>
            {/* Current address readout */}
            <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', marginBottom: 12, minHeight: 14 }}>
              {!hasLocation ? 'Awaiting GPS...' :
               reverseLoading ? 'Resolving address...' :
               reverseAddr ? reverseAddr : `${location!.latitude.toFixed(5)}, ${location!.longitude.toFixed(5)}`}
            </div>

            {/* Quick-pin buttons */}
            <div style={{ display: 'flex', gap: 8, marginBottom: showCustomInput ? 10 : 0 }}>
              <button
                onClick={() => handlePin('home')}
                disabled={!hasLocation || pinning}
                style={{
                  flex: 1, padding: '10px 12px', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 6, cursor: hasLocation ? 'pointer' : 'not-allowed',
                  background: savedSpots.some(s => s.spot_type === 'home') ? 'rgba(16,185,129,0.06)' : 'rgba(245,158,11,0.05)',
                  border: `1px solid ${savedSpots.some(s => s.spot_type === 'home') ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.2)'}`,
                  opacity: hasLocation ? 1 : 0.4, transition: 'all 200ms',
                }}
              >
                <Home size={18} style={{ color: savedSpots.some(s => s.spot_type === 'home') ? '#10b981' : '#f59e0b' }} />
                <span style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em',
                  color: savedSpots.some(s => s.spot_type === 'home') ? '#10b981' : 'var(--text-muted)' }}>
                  {savedSpots.some(s => s.spot_type === 'home') ? '✓ Home' : 'Home'}
                </span>
              </button>

              <button
                onClick={() => handlePin('work')}
                disabled={!hasLocation || pinning}
                style={{
                  flex: 1, padding: '10px 12px', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 6, cursor: hasLocation ? 'pointer' : 'not-allowed',
                  background: savedSpots.some(s => s.spot_type === 'work') ? 'rgba(16,185,129,0.06)' : 'rgba(245,158,11,0.05)',
                  border: `1px solid ${savedSpots.some(s => s.spot_type === 'work') ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.2)'}`,
                  opacity: hasLocation ? 1 : 0.4, transition: 'all 200ms',
                }}
              >
                <Briefcase size={18} style={{ color: savedSpots.some(s => s.spot_type === 'work') ? '#10b981' : '#f59e0b' }} />
                <span style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em',
                  color: savedSpots.some(s => s.spot_type === 'work') ? '#10b981' : 'var(--text-muted)' }}>
                  {savedSpots.some(s => s.spot_type === 'work') ? '✓ Work' : 'Work'}
                </span>
              </button>

              <button
                onClick={() => setShowCustomInput(v => !v)}
                disabled={!hasLocation || pinning}
                style={{
                  flex: 1, padding: '10px 12px', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 6, cursor: hasLocation ? 'pointer' : 'not-allowed',
                  background: showCustomInput ? 'rgba(139,92,246,0.08)' : 'rgba(245,158,11,0.05)',
                  border: `1px solid ${showCustomInput ? 'rgba(139,92,246,0.4)' : 'rgba(245,158,11,0.2)'}`,
                  opacity: hasLocation ? 1 : 0.4, transition: 'all 200ms',
                }}
              >
                <Plus size={18} style={{ color: showCustomInput ? '#8b5cf6' : '#f59e0b' }} />
                <span style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em',
                  color: showCustomInput ? '#8b5cf6' : 'var(--text-muted)' }}>
                  Custom
                </span>
              </button>
            </div>

            {/* Custom label input */}
            {showCustomInput && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="text"
                  value={customLabel}
                  onChange={e => setCustomLabel(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && customLabel.trim()) handlePin('other', customLabel.trim());
                    if (e.key === 'Escape') { setShowCustomInput(false); setCustomLabel(''); }
                  }}
                  placeholder="Gym, Mom's house, Office 2…"
                  autoFocus
                  style={{
                    flex: 1, padding: '8px 12px',
                    background: 'rgba(139,92,246,0.04)',
                    border: '1px solid rgba(139,92,246,0.3)',
                    color: 'var(--text-primary)',
                    fontFamily: 'monospace', fontSize: 11,
                    outline: 'none', caretColor: '#8b5cf6',
                    letterSpacing: '0.04em',
                  }}
                />
                <button
                  onClick={() => { if (customLabel.trim()) handlePin('other', customLabel.trim()); }}
                  disabled={!customLabel.trim() || pinning}
                  style={{
                    width: 34, height: 34, flexShrink: 0,
                    background: customLabel.trim() ? 'rgba(139,92,246,0.1)' : 'transparent',
                    border: '1px solid rgba(139,92,246,0.3)',
                    color: customLabel.trim() ? '#8b5cf6' : 'var(--text-muted)',
                    cursor: customLabel.trim() ? 'pointer' : 'default',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {pinning ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={14} />}
                </button>
              </div>
            )}

            {/* Pinning indicator */}
            {pinning && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                <Loader size={11} style={{ color: '#f59e0b', animation: 'spin 1s linear infinite' }} />
                <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#f59e0b' }}>Pinning location...</span>
              </div>
            )}
          </div>

          {/* Saved spots list */}
          {savedSpots.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {savedSpots.map(spot => {
                const dist = location ? distanceBetween(location.latitude, location.longitude, spot.lat, spot.lng) : null;
                const isNearby = dist !== null && dist < 100;
                return (
                  <div key={spot.id} style={{
                    padding: '10px 14px',
                    border: `1px solid ${isNearby ? 'rgba(16,185,129,0.35)' : 'rgba(245,158,11,0.12)'}`,
                    background: isNearby ? 'rgba(16,185,129,0.04)' : 'rgba(245,158,11,0.02)',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0 }}>{spot.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)', fontWeight: 600 }}>
                          {spot.label}
                        </span>
                        {isNearby && (
                          <span style={{
                            fontFamily: 'monospace', fontSize: 7, padding: '1px 5px',
                            background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)',
                            color: '#10b981', textTransform: 'uppercase',
                          }}>HERE</span>
                        )}
                      </div>
                      <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', marginTop: 2,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {spot.address ?? `${spot.lat.toFixed(4)}, ${spot.lng.toFixed(4)}`}
                      </div>
                    </div>
                    {dist !== null && (
                      <span style={{ fontFamily: 'monospace', fontSize: 10, color: isNearby ? '#10b981' : 'var(--text-muted)', fontWeight: 600, flexShrink: 0 }}>
                        {dist < 1000 ? `${Math.round(dist)}m` : `${(dist / 1000).toFixed(1)}km`}
                      </span>
                    )}
                    <button
                      onClick={() => handleDeleteSpot(spot)}
                      title={`Remove ${spot.label}`}
                      style={{
                        width: 24, height: 24, flexShrink: 0,
                        background: 'transparent', border: '1px solid rgba(239,68,68,0.2)',
                        color: 'rgba(239,68,68,0.5)', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 200ms',
                      }}
                    >
                      <X size={11} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Weather Now ── */}
        <section>
          <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.18em', marginBottom: 8 }}>
            Weather Now
          </div>
          <div style={{ padding: '14px 16px', border: '1px solid rgba(99,102,241,0.15)', background: 'rgba(99,102,241,0.03)' }}>
            {!hasLocation && (
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>Awaiting location...</span>
            )}
            {hasLocation && weatherLoading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Loader size={12} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} />
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>Fetching weather...</span>
              </div>
            )}
            {hasLocation && !weatherLoading && weather && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: (weather.uvIndex !== undefined || weather.visibilityKm !== undefined) ? 10 : 0 }}>
                  <span style={{ fontSize: 24 }}>{weather.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: 'monospace', fontSize: 14, color: 'var(--text-primary)', fontWeight: 600 }}>
                      {weather.tempC}°C · {weather.description}
                    </div>
                    <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                      {weather.feelsLike}{weather.feelsLikeC !== undefined ? ` (${weather.feelsLikeC}°C)` : ''} · Humidity {weather.humidity}% · Wind {weather.windKph} kph
                    </div>
                  </div>
                </div>
                {/* ── Google Weather extras ── */}
                {(weather.uvIndex !== undefined || weather.visibilityKm !== undefined || weather.pressureHPa !== undefined) && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {weather.uvIndex !== undefined && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 2 }}>
                        <Sun size={10} style={{ color: '#f59e0b' }} />
                        <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#f59e0b' }}>UV {weather.uvIndex}</span>
                      </div>
                    )}
                    {weather.visibilityKm !== undefined && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: 2 }}>
                        <Eye size={10} style={{ color: '#6366f1' }} />
                        <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>{weather.visibilityKm} km vis</span>
                      </div>
                    )}
                    {weather.pressureHPa !== undefined && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)', borderRadius: 2 }}>
                        <Gauge size={10} style={{ color: '#10b981' }} />
                        <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>{weather.pressureHPa} hPa</span>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
            {hasLocation && !weatherLoading && !weather && (
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>Weather unavailable</span>
            )}
          </div>
        </section>

        {/* ── Nearby Places ── */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <Compass size={10} style={{ color: '#8b5cf6' }} />
            <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.18em' }}>
              Nearby
            </div>
          </div>

          {/* Category pills */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {NEARBY_CATEGORIES.map(cat => {
              const active = nearbyCategory === cat.key;
              return (
                <button
                  key={cat.key}
                  onClick={() => {
                    if (active) {
                      setNearbyCategory(null);
                      setNearbyPlaces([]);
                      return;
                    }
                    if (!location) return;
                    setNearbyCategory(cat.key);
                    setNearbyLoading(true);
                    fetchNearbyPlaces(location.latitude, location.longitude, cat.type)
                      .then(setNearbyPlaces)
                      .finally(() => setNearbyLoading(false));
                  }}
                  style={{
                    padding: '5px 12px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase',
                    letterSpacing: '0.08em', cursor: hasLocation ? 'pointer' : 'not-allowed',
                    display: 'flex', alignItems: 'center', gap: 5, borderRadius: 2,
                    background: active ? 'rgba(139,92,246,0.12)' : 'transparent',
                    border: `1px solid ${active ? 'rgba(139,92,246,0.5)' : 'var(--border-subtle)'}`,
                    color: active ? '#8b5cf6' : 'var(--text-muted)',
                    opacity: hasLocation ? 1 : 0.4,
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{ fontSize: 12, lineHeight: 1 }}>{cat.icon}</span> {cat.label}
                </button>
              );
            })}
          </div>

          {/* Results */}
          {nearbyLoading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', border: '1px solid var(--border-subtle)' }}>
              <Loader size={12} style={{ color: '#8b5cf6', animation: 'spin 1s linear infinite' }} />
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>Scanning nearby...</span>
            </div>
          )}

          {!nearbyLoading && nearbyCategory && nearbyPlaces.length === 0 && (
            <div style={{ padding: '16px', border: '1px solid var(--border-subtle)', textAlign: 'center' }}>
              <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                No results within 1.5 km
              </span>
            </div>
          )}

          {!nearbyLoading && nearbyPlaces.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {nearbyPlaces.map(p => (
                <div key={p.id} style={{
                  padding: '12px 14px', border: '1px solid rgba(139,92,246,0.15)',
                  background: 'rgba(139,92,246,0.03)', display: 'flex', alignItems: 'center', gap: 12,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)', fontWeight: 600, marginBottom: 2 }}>
                      {p.name}
                    </div>
                    <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.address}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#8b5cf6' }}>
                      {p.distanceM < 1000 ? `${p.distanceM}m` : `${(p.distanceM / 1000).toFixed(1)}km`}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end', marginTop: 2 }}>
                      {p.rating && (
                        <span style={{ fontFamily: 'monospace', fontSize: 8, color: '#f59e0b' }}>
                          ★ {p.rating.toFixed(1)}
                        </span>
                      )}
                      {p.isOpen !== undefined && (
                        <span style={{ fontFamily: 'monospace', fontSize: 7, padding: '1px 5px',
                          background: p.isOpen ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                          border: `1px solid ${p.isOpen ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
                          color: p.isOpen ? '#10b981' : '#ef4444', textTransform: 'uppercase',
                        }}>
                          {p.isOpen ? 'OPEN' : 'CLOSED'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Commute ETA ── */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.18em' }}>
              Commute ETA
            </div>
            {/* Mode Switcher */}
            <div style={{ display: 'flex', marginLeft: 'auto', gap: 4 }}>
              {(['driving', 'transit', 'walking'] as CommuteMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => { setCommuteMode(m); }}
                  title={m.charAt(0).toUpperCase() + m.slice(1)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 24, height: 24, border: '1px solid',
                    borderColor: commuteMode === m ? 'rgba(99,102,241,0.6)' : 'var(--border-subtle)',
                    background:  commuteMode === m ? 'rgba(99,102,241,0.12)' : 'transparent',
                    color:       commuteMode === m ? '#6366f1' : 'var(--text-muted)',
                    cursor: 'pointer', borderRadius: 2,
                  }}
                >
                  {m === 'driving' ? <Car size={11} /> : m === 'transit' ? <Train size={11} /> : <Navigation size={11} />}
                </button>
              ))}
              <button
                onClick={() => refreshCommute(commuteMode)}
                disabled={commuteLoading}
                title="Refresh"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 24, height: 24, border: '1px solid var(--border-subtle)',
                  background: 'transparent', color: 'var(--text-muted)', cursor: commuteLoading ? 'not-allowed' : 'pointer', borderRadius: 2,
                }}
              >
                <RefreshCw size={11} style={{ animation: commuteLoading ? 'spin 1s linear infinite' : 'none' }} />
              </button>
            </div>
          </div>

          {/* ETA Cards */}
          {!location && (
            <div style={{ padding: '16px', border: '1px solid var(--border-subtle)', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', opacity: 0.5 }}>
              Awaiting GPS signal...
            </div>
          )}

          {location && commuteLoading && !commute && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', border: '1px solid var(--border-subtle)' }}>
              <Loader size={12} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} />
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>Calculating routes...</span>
            </div>
          )}

          {commuteError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.05)' }}>
              <AlertCircle size={12} style={{ color: '#ef4444', flexShrink: 0 }} />
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#ef4444' }}>{commuteError}</span>
            </div>
          )}

          {commute && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {commute.results.map((r) => {
                const tLevel = trafficLevel(r.durationSeconds);
                const tColor = tLevel === 'clear' ? 'var(--green)' : tLevel === 'moderate' ? 'var(--amber)' : '#ef4444';
                const tBg    = tLevel === 'clear' ? 'var(--green-dim)' : tLevel === 'moderate' ? 'rgba(212,160,68,0.08)' : 'rgba(239,68,68,0.08)';
                const tBorder= tLevel === 'clear' ? 'var(--green-border)' : tLevel === 'moderate' ? 'rgba(212,160,68,0.25)' : 'rgba(239,68,68,0.25)';
                return (
                  <div key={r.label} style={{ padding: '14px 16px', border: `1px solid ${tBorder}`, background: tBg, display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: tColor, flexShrink: 0, boxShadow: `0 0 6px ${tColor}` }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>
                        {r.label}
                      </div>
                      <div style={{ fontFamily: 'monospace', fontSize: 15, color: 'var(--text-primary)', fontWeight: 700, letterSpacing: '-0.01em' }}>
                        {r.status === 'OK' ? formatDuration(r.durationSeconds) : r.status}
                      </div>
                      {r.status === 'OK' && (
                        <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
                          {r.distanceText} · {tLevel.toUpperCase()} TRAFFIC
                        </div>
                      )}
                    </div>
                    {commuteLoading && (
                      <Loader size={11} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                    )}
                  </div>
                );
              })}
              <div style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textAlign: 'right', opacity: 0.5 }}>
                {commute.fromCache ? '● CACHED' : '● LIVE'} · {new Date(commute.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          )}
        </section>

        {/* ── Geo Reminders ── */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.18em' }}>
              Geo Reminders
            </div>
            <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--green)', padding: '1px 6px', border: '1px solid var(--green-border)', background: 'var(--green-dim)' }}>
              {geoReminders.length} ACTIVE
            </span>
          </div>

          {loading && <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', padding: '12px 0' }}>Loading...</div>}

          {!loading && geoReminders.length === 0 && (
            <div style={{ padding: '20px', border: '1px solid var(--border-subtle)', textAlign: 'center', opacity: 0.4 }}>
              <Bell size={20} style={{ color: 'var(--text-muted)', marginBottom: 6, display: 'block', margin: '0 auto 6px' }} />
              <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                No geo reminders — say "remind me when I'm near X"
              </span>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {geoReminders.map(reminder => {
              const r = reminder as DbReminder & { due_location?: string; due_radius_m?: number };
              return (
                <div key={reminder.id} style={{
                  padding: '12px 14px', border: '1px solid var(--green-border)',
                  background: 'var(--green-dim)', display: 'flex', alignItems: 'flex-start', gap: 10,
                }}>
                  <MapPin size={13} style={{ color: 'var(--green)', marginTop: 2, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>
                      Near {r.due_location} · {r.due_radius_m ?? 300}m radius
                    </div>
                    <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', margin: 0 }}>
                      {reminder.text}
                    </p>
                  </div>
                  <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--green)', padding: '2px 6px', border: '1px solid var(--green-border)', flexShrink: 0 }}>
                    ● WATCHING
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Place-Tagged Memories ── */}
        <section>
          <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.18em', marginBottom: 8 }}>
            Place-Tagged Memories
          </div>

          {!loading && placeMemories.length === 0 && (
            <div style={{ padding: '20px', border: '1px solid var(--border-subtle)', textAlign: 'center', opacity: 0.4 }}>
              <BookOpen size={20} style={{ color: 'var(--text-muted)', display: 'block', margin: '0 auto 6px' }} />
              <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                Memories captured by voice will appear here with their location
              </span>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {placeMemories.map(memory => {
              const m = memory as DbMemory & { location_label?: string };
              return (
                <div key={memory.id} style={{ padding: '12px 14px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#6366f1', letterSpacing: '0.1em', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Cloud size={9} /> {m.location_label}
                    </span>
                    <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>
                      {new Date(memory.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', margin: 0, lineHeight: 1.5,
                    overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>
                    {memory.text}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

      </div>
    </div>
  );
}
