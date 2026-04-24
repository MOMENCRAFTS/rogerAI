import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { User } from '@supabase/supabase-js';
import { App as CapApp } from '@capacitor/app';
import { supabase } from '../lib/supabase';

// ─── Admin email list from env ─────────────────────────────────────────────────
const ADMIN_EMAILS = (import.meta.env.VITE_ADMIN_EMAILS ?? '')
  .split(',')
  .map((e: string) => e.trim().toLowerCase())
  .filter(Boolean);

// ─── NATO phonetic alphabet callsign pool ─────────────────────────────────────
const NATO = ['ALPHA','BRAVO','CHARLIE','DELTA','ECHO','FOXTROT','GOLF',
  'HOTEL','INDIA','JULIET','KILO','LIMA','MIKE','NOVEMBER','OSCAR',
  'PAPA','QUEBEC','ROMEO','SIERRA','TANGO','UNIFORM','VICTOR',
  'WHISKEY','XRAY','YANKEE','ZULU'];

function generateCallsign(): string {
  const word = NATO[Math.floor(Math.random() * NATO.length)];
  const num  = Math.floor(10 + Math.random() * 90); // 10–99
  return `${word}-${num}`;
}

// ─── Auto-provision callsign for new users ────────────────────────────────────
async function provisionCallsign(userId: string): Promise<void> {
  // Check if user already has a callsign
  const { data: existing } = await supabase
    .from('user_callsigns')
    .select('callsign')
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) return; // already assigned

  // Try up to 5 times to find a unique callsign
  for (let i = 0; i < 5; i++) {
    const callsign = generateCallsign();
    const { error } = await supabase
      .from('user_callsigns')
      .insert({ user_id: userId, callsign })
      .select()
      .single();
    if (!error) return; // success
    // If unique constraint violation, try again
  }
}

// ─── Context type ─────────────────────────────────────────────────────────────
interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]         = useState<User | null>(null);
  const [loading, setLoading]   = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    // P0.3: Check for OAuth error params in URL before reading session
    const params = new URLSearchParams(window.location.hash.replace('#', '?'));
    const urlError = params.get('error_description') ?? params.get('error');
    if (urlError) {
      setAuthError(decodeURIComponent(urlError.replace(/\+/g, ' ')));
      setLoading(false);
      // Clean the error out of the URL
      window.history.replaceState(null, '', window.location.pathname);
      return;
    }

    // Grab the initial session (handles OAuth redirect back)
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) setAuthError(error.message);
      const u = data.session?.user ?? null;
      setUser(u);
      setLoading(false);
      // Auto-provision callsign for any authenticated user
      if (u) provisionCallsign(u.id).catch(() => {});
    });

    // Listen for future auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      // Provision on every sign-in event (idempotent)
      if (u && _event === 'SIGNED_IN') provisionCallsign(u.id).catch(() => {});
    });

    return () => subscription.unsubscribe();
  }, []);

  // ── Capacitor deep link: handle OAuth callback on native mobile ────────────
  // When Google redirects to com.rogerai.app://login-callback?code=xxx,
  // Android opens the app but the WebView never sees the URL change.
  // We must intercept it here and manually exchange the code for a session.
  useEffect(() => {
    let listener: { remove: () => void } | null = null;

    const attachListener = async () => {
      try {
        listener = await CapApp.addListener('appUrlOpen', async ({ url }) => {
          if (!url.includes('login-callback')) return;

          // ── PKCE flow (default in Supabase v2): ?code=xxxx ──
          const urlObj = new URL(url);
          const code = urlObj.searchParams.get('code');
          if (code) {
            const { data, error } = await supabase.auth.exchangeCodeForSession(code);
            if (!error && data.session) {
              setUser(data.session.user);
              provisionCallsign(data.session.user.id).catch(() => {});
            }
            return;
          }

          // ── Implicit flow fallback: #access_token=xxx ──
          const hash = url.split('#')[1];
          if (hash) {
            const params = new URLSearchParams(hash);
            const access_token  = params.get('access_token');
            const refresh_token = params.get('refresh_token');
            if (access_token && refresh_token) {
              const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
              if (!error && data.session) {
                setUser(data.session.user);
                provisionCallsign(data.session.user.id).catch(() => {});
              }
            }
          }
        });
      } catch {
        // Not running in Capacitor (web) — listener not needed
      }
    };

    attachListener();
    return () => { listener?.remove(); };
  }, []);

  const signInWithGoogle = async () => {
    setAuthError(null);

    // On native mobile (Capacitor), redirect back to the app via custom URI scheme.
    // On web, redirect back to the current origin (works for both localhost and production).
    const isNative = typeof window !== 'undefined' &&
      !!(window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

    const redirectTo = isNative
      ? 'com.rogerai.app://login-callback'   // Android/iOS deep link → opens app
      : window.location.origin;              // Web → back to same page

    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  // VITE_BUILD_TARGET=user means this is the user-only APK build — always non-admin
  const isAdmin = import.meta.env.VITE_BUILD_TARGET !== 'user' &&
    ADMIN_EMAILS.includes((user?.email ?? '').toLowerCase());

  return (
    <AuthContext.Provider value={{ user, loading, isAdmin, authError, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
