// ─── Roger AI — Radio Browser Integration ──────────────────────────────────
// Client library for the Radio Browser API (https://api.radio-browser.info).
// Provides server discovery, advanced station search, click tracking, and
// a singleton playback manager backed by HTMLAudioElement.
// All external API calls are routed through the radio-search Supabase edge function.

import { supabase } from './supabase';

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RadioStation {
  stationuuid:     string;
  name:            string;
  url:             string;
  url_resolved:    string;
  homepage:        string;
  favicon:         string;
  tags:            string;       // comma-separated
  country:         string;
  countrycode:     string;
  state:           string;
  language:        string;
  languagecodes:   string;
  votes:           number;
  clickcount:      number;
  clicktrend:      number;
  codec:           string;
  bitrate:         number;
  hls:             0 | 1;
  lastcheckok:     0 | 1;
  geo_lat:         number | null;
  geo_long:        number | null;
  geo_distance:    number | null;
}

export interface RadioSearchFilters {
  name?:         string;
  tag?:          string;
  tagList?:      string;
  country?:      string;
  countrycode?:  string;
  language?:     string;
  codec?:        string;
  bitrateMin?:   number;
  bitrateMax?:   number;
  order?:        string;
  reverse?:      boolean;
  limit?:        number;
  offset?:       number;
  hidebroken?:   boolean;
  geo_lat?:      number;
  geo_long?:     number;
}

export interface RadioPlaybackState {
  station:    RadioStation | null;
  isPlaying:  boolean;
  isLoading:  boolean;
  error:      string | null;
}

// ─── Edge Function Caller ────────────────────────────────────────────────────

async function callRadioEdge(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? SUPABASE_ANON_KEY;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/radio-search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`radio-search error ${res.status}: ${err}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

// ─── Search API ──────────────────────────────────────────────────────────────

/** Search stations with advanced multi-field filters via edge function. */
export async function searchStations(filters: RadioSearchFilters): Promise<RadioStation[]> {
  const result = await callRadioEdge({ action: 'search', filters });
  return (result.stations as RadioStation[]) ?? [];
}

/** Get top stations by clicks, votes, or trending. */
export async function topStations(
  type: 'clicks' | 'votes' | 'trending' = 'clicks',
  limit = 10,
): Promise<RadioStation[]> {
  const result = await callRadioEdge({ action: 'top', type, limit });
  return (result.stations as RadioStation[]) ?? [];
}

/** Get stations near a geographic location. */
export async function nearbyStations(
  lat: number, lng: number, limit = 10,
): Promise<RadioStation[]> {
  const result = await callRadioEdge({ action: 'nearby', lat, lng, limit });
  return (result.stations as RadioStation[]) ?? [];
}

/** Count a click (play) for community stats — call when user starts playing. */
export async function countClick(stationuuid: string): Promise<void> {
  await callRadioEdge({ action: 'click', stationuuid }).catch(() => {});
}

// ─── Playback Manager (Singleton) ────────────────────────────────────────────

let _audio: HTMLAudioElement | null = null;
let _state: RadioPlaybackState = {
  station: null,
  isPlaying: false,
  isLoading: false,
  error: null,
};

// Last search results — used for "next station" cycling
let _lastSearchResults: RadioStation[] = [];
let _currentIndex = 0;

function emitStateChange(): void {
  window.dispatchEvent(new CustomEvent('roger:radio-state-change', {
    detail: { ..._state },
  }));
}

function updateState(patch: Partial<RadioPlaybackState>): void {
  _state = { ..._state, ...patch };
  emitStateChange();
}

/** Get the current playback state. */
export function getRadioState(): RadioPlaybackState {
  return { ..._state };
}

/** Get the currently playing station, or null. */
export function getCurrentStation(): RadioStation | null {
  return _state.station;
}

/** Check if radio is currently playing. */
export function isRadioPlaying(): boolean {
  return _state.isPlaying;
}

/** Play a specific station. Creates or reuses the HTMLAudioElement. */
export function playStation(station: RadioStation): void {
  // Stop any existing playback
  if (_audio) {
    _audio.pause();
    _audio.removeAttribute('src');
    _audio.load();
  }

  updateState({ station, isPlaying: false, isLoading: true, error: null });

  // Create audio element
  _audio = _audio ?? new Audio();
  _audio.crossOrigin = 'anonymous';

  // Use url_resolved (pre-resolved redirect chain), fall back to url
  _audio.src = station.url_resolved || station.url;

  // Event listeners
  _audio.onplaying = () => updateState({ isPlaying: true, isLoading: false });
  _audio.onpause   = () => updateState({ isPlaying: false });
  _audio.onended   = () => updateState({ isPlaying: false, isLoading: false });
  _audio.onerror   = () => {
    updateState({
      isPlaying: false, isLoading: false,
      error: 'Stream unavailable. Try next station.',
    });
  };
  _audio.onwaiting  = () => updateState({ isLoading: true });
  _audio.oncanplay  = () => updateState({ isLoading: false });

  // Start playback
  _audio.play().catch(err => {
    updateState({
      isPlaying: false, isLoading: false,
      error: `Playback failed: ${err.message ?? 'unknown'}`,
    });
  });

  // Count the click (fire-and-forget, community obligation)
  countClick(station.stationuuid);
}

/** Pause/resume toggle. */
export function toggleRadio(): void {
  if (!_audio || !_state.station) return;

  if (_state.isPlaying) {
    _audio.pause();
  } else {
    _audio.play().catch(() => {});
  }
}

/** Stop radio playback completely and clear state. */
export function stopRadio(): void {
  if (_audio) {
    _audio.pause();
    _audio.removeAttribute('src');
    _audio.load();
  }
  _lastSearchResults = [];
  _currentIndex = 0;
  updateState({ station: null, isPlaying: false, isLoading: false, error: null });
}

/** Play the next station from the last search results. Wraps around. */
export async function playNextStation(): Promise<RadioStation | null> {
  if (_lastSearchResults.length === 0) return null;

  _currentIndex = (_currentIndex + 1) % _lastSearchResults.length;
  const next = _lastSearchResults[_currentIndex];
  playStation(next);
  return next;
}

// ─── High-Level Search & Play (used by PTT intent handler) ───────────────────

/**
 * Search for stations matching the given criteria and immediately play the top result.
 * Stores results for "next station" cycling.
 * Returns the station that was selected, or null if nothing found.
 */
export async function searchAndPlay(filters: RadioSearchFilters): Promise<RadioStation | null> {
  // Default: only working stations, sorted by popularity
  const searchFilters: RadioSearchFilters = {
    hidebroken: true,
    order: 'clickcount',
    reverse: true,
    limit: 10,
    ...filters,
  };

  let stations: RadioStation[];

  // If geo coordinates provided, use nearby search
  if (searchFilters.geo_lat != null && searchFilters.geo_long != null && !searchFilters.tag && !searchFilters.name) {
    stations = await nearbyStations(
      searchFilters.geo_lat,
      searchFilters.geo_long,
      searchFilters.limit ?? 10,
    );
  } else {
    stations = await searchStations(searchFilters);
  }

  if (stations.length === 0) return null;

  _lastSearchResults = stations;
  _currentIndex = 0;

  playStation(stations[0]);
  return stations[0];
}
