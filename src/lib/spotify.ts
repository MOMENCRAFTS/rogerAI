// ─── Roger AI — Spotify Integration ──────────────────────────────────────────
// PKCE OAuth flow (no client secret exposed).
// Controls playback via Spotify Web API.

const CLIENT_ID    = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string;
const REDIRECT_URI = `${window.location.origin}/spotify-callback`;

export interface SpotifyTrack {
  id:         string;
  name:       string;
  artist:     string;
  album:      string;
  albumArt?:  string;
  durationMs: number;
  progressMs: number;
  isPlaying:  boolean;
}

// ─── PKCE Utilities ────────────────────────────────────────────────────────────

function randomBase64(len: number): string {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function sha256(plain: string): Promise<string> {
  const enc  = new TextEncoder().encode(plain);
  const hash = await crypto.subtle.digest('SHA-256', enc);
  return btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function connectSpotify(): Promise<void> {
  const verifier  = randomBase64(64);
  const challenge = await sha256(verifier);
  sessionStorage.setItem('spotify_verifier', verifier);

  const params = new URLSearchParams({
    client_id:             CLIENT_ID,
    response_type:         'code',
    redirect_uri:          REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge:        challenge,
    scope: [
      'user-read-playback-state',
      'user-modify-playback-state',
      'user-read-currently-playing',
      'streaming',
      'playlist-read-private',
    ].join(' '),
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

export async function handleSpotifyCallback(code: string): Promise<boolean> {
  const verifier = sessionStorage.getItem('spotify_verifier');
  if (!verifier) return false;

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     CLIENT_ID,
      grant_type:    'authorization_code',
      code,
      redirect_uri:  REDIRECT_URI,
      code_verifier: verifier,
    }),
  });

  if (!res.ok) return false;
  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
  sessionStorage.setItem('spotify_token',   data.access_token);
  sessionStorage.setItem('spotify_refresh', data.refresh_token);
  sessionStorage.setItem('spotify_expiry',  String(Date.now() + data.expires_in * 1000));
  sessionStorage.removeItem('spotify_verifier');
  return true;
}

async function refreshSpotifyToken(): Promise<string | null> {
  const refresh = sessionStorage.getItem('spotify_refresh');
  if (!refresh) return null;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: refresh }),
  });
  if (!res.ok) return null;
  const data = await res.json() as { access_token: string; expires_in: number };
  sessionStorage.setItem('spotify_token', data.access_token);
  sessionStorage.setItem('spotify_expiry', String(Date.now() + data.expires_in * 1000));
  return data.access_token;
}

export async function getSpotifyToken(): Promise<string | null> {
  const expiry = Number(sessionStorage.getItem('spotify_expiry') ?? 0);
  if (Date.now() < expiry - 60_000) return sessionStorage.getItem('spotify_token');
  return refreshSpotifyToken();
}

export function isSpotifyConnected(): boolean {
  return !!sessionStorage.getItem('spotify_token');
}

export function disconnectSpotify(): void {
  ['spotify_token','spotify_refresh','spotify_expiry','spotify_verifier'].forEach(k =>
    sessionStorage.removeItem(k));
}

// ─── Playback Control ─────────────────────────────────────────────────────────

async function spotifyApi(path: string, method = 'GET', body?: object): Promise<Response> {
  const token = await getSpotifyToken();
  if (!token) throw new Error('Not connected to Spotify');
  return fetch(`https://api.spotify.com/v1${path}`, {
    method,
    headers: { 'Authorization': `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

/** Get the currently playing track. Returns null if nothing is playing. */
export async function getNowPlaying(): Promise<SpotifyTrack | null> {
  try {
    const res = await spotifyApi('/me/player/currently-playing');
    if (res.status === 204 || !res.ok) return null;
    const d = await res.json() as {
      item?: { id: string; name: string; artists: { name: string }[]; album: { name: string; images: { url: string }[] }; duration_ms: number };
      progress_ms?: number;
      is_playing?: boolean;
    };
    if (!d.item) return null;
    return {
      id:         d.item.id,
      name:       d.item.name,
      artist:     d.item.artists.map(a => a.name).join(', '),
      album:      d.item.album.name,
      albumArt:   d.item.album.images[0]?.url,
      durationMs: d.item.duration_ms,
      progressMs: d.progress_ms ?? 0,
      isPlaying:  d.is_playing ?? false,
    };
  } catch {
    return null;
  }
}

export async function pausePlayback(): Promise<void> {
  await spotifyApi('/me/player/pause', 'PUT');
}

export async function resumePlayback(): Promise<void> {
  await spotifyApi('/me/player/play', 'PUT');
}

export async function nextTrack(): Promise<void> {
  await spotifyApi('/me/player/next', 'POST');
}

export async function prevTrack(): Promise<void> {
  await spotifyApi('/me/player/previous', 'POST');
}

export async function setVolume(pct: number): Promise<void> {
  await spotifyApi(`/me/player/volume?volume_percent=${Math.round(pct)}`, 'PUT');
}

/** Search for a track/playlist and play it. */
export async function playSearch(query: string): Promise<string | null> {
  try {
    // Try playlist first for mood/genre queries
    const isPlaylist = /playlist|mix|chill|focus|energetic|ambient|sleep|workout|jazz|lo-fi/i.test(query);
    const type = isPlaylist ? 'playlist' : 'track';

    const searchRes = await spotifyApi(`/search?q=${encodeURIComponent(query)}&type=${type}&limit=1`);
    if (!searchRes.ok) return null;
    const data = await searchRes.json() as {
      tracks?: { items: { uri: string; name: string; artists: { name: string }[] }[] };
      playlists?: { items: { uri: string; name: string }[] };
    };

    let uri: string | null = null;
    let label = '';

    if (type === 'playlist' && data.playlists?.items?.[0]) {
      uri   = data.playlists.items[0].uri;
      label = data.playlists.items[0].name;
    } else if (data.tracks?.items?.[0]) {
      uri   = data.tracks.items[0].uri;
      const t = data.tracks.items[0];
      label = `${t.name} by ${t.artists[0]?.name}`;
    }

    if (!uri) return null;
    await spotifyApi('/me/player/play', 'PUT', { [type === 'playlist' ? 'context_uri' : 'uris']: type === 'playlist' ? uri : [uri] });
    return label;
  } catch {
    return null;
  }
}
