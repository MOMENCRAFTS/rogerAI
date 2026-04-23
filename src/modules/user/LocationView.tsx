import { useState, useEffect, useCallback } from 'react';
import { MapPin, Cloud, Bell, BookOpen, Loader, Car, Train, Navigation, RefreshCw, AlertCircle } from 'lucide-react';
import { fetchWeather, type WeatherData } from '../../lib/weather';
import { fetchReminders, fetchMemories, type DbReminder, type DbMemory } from '../../lib/api';
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

interface LocationViewProps {
  userId: string;
  location: UserLocation | null;
}

export default function LocationView({ userId, location }: LocationViewProps) {
  const [weather, setWeather]       = useState<WeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [geoReminders, setGeoReminders] = useState<DbReminder[]>([]);
  const [placeMemories, setPlaceMemories] = useState<DbMemory[]>([]);
  const [loading, setLoading]       = useState(true);

  // Commute ETA state
  const [commute, setCommute]             = useState<CommuteSnapshot | null>(null);
  const [commuteLoading, setCommuteLoading] = useState(false);
  const [commuteError, setCommuteError]   = useState<string | null>(null);
  const [commuteMode, setCommuteMode]     = useState<CommuteMode>('driving');
  const [destinations, setDestinations]   = useState<CommuteDestination[]>([]);

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

  useEffect(() => {
    if (location && destinations.length) refreshCommute(commuteMode);
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 24 }}>{weather.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'monospace', fontSize: 14, color: 'var(--text-primary)', fontWeight: 600 }}>
                    {weather.tempC}°C · {weather.description}
                  </div>
                  <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                    {weather.feelsLike} · Humidity {weather.humidity}% · Wind {weather.windKph} kph
                  </div>
                </div>
              </div>
            )}
            {hasLocation && !weatherLoading && !weather && (
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>Weather unavailable</span>
            )}
          </div>
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
