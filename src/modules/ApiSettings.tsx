// ─── Roger AI — API Settings & Diagnostics ───────────────────────────────────
// Admin panel to view, test, and update all API credentials at runtime.
// Keys typed here are saved to localStorage and override .env.local values.

import { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle, XCircle, AlertCircle, RefreshCw,
  Eye, EyeOff, Save, Zap, Key, Server, Newspaper, Map, Bell, Brain
} from 'lucide-react';
import HelpBadge from '../components/shared/HelpBadge';

// ─── Types ────────────────────────────────────────────────────────────────────
type ApiStatus = 'idle' | 'testing' | 'ok' | 'error';

interface ApiConfig {
  id:       string;
  label:    string;
  envKey:   string;
  lsKey:    string; // localStorage override key
  Icon:     React.FC<{ size?: number; style?: React.CSSProperties }>;
  color:    string;
  testFn:   (key: string) => Promise<string>; // returns status message
  docs:     string;
  masked:   boolean;
}

const LS_PREFIX = 'ROGER_API_';

// ─── API Test Functions ───────────────────────────────────────────────────────
async function testOpenAI(key: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as { data: { id: string }[] };
  const models = data.data?.slice(0, 3).map(m => m.id).join(', ');
  return `Connected — ${data.data?.length} models available (${models}…)`;
}

async function testSupabase(url: string, key: string): Promise<string> {
  // Test with the anon key via a simple health endpoint
  const base = url || import.meta.env.VITE_SUPABASE_URL;
  const res = await fetch(`${base}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return `Connected to ${base.replace('https://', '').split('.')[0]}`;
}

async function testNewsAPI(key: string): Promise<string> {
  const res = await fetch(
    `https://newsapi.org/v2/top-headlines?country=us&pageSize=1&apiKey=${key}`
  );
  const data = await res.json() as { status: string; totalResults?: number; message?: string };
  if (data.status !== 'ok') throw new Error(data.message ?? `HTTP ${res.status}`);
  return `Connected — ${data.totalResults?.toLocaleString()} articles available`;
}

async function testGoogleMaps(key: string): Promise<string> {
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=Riyadh&key=${key}`
  );
  const data = await res.json() as { status: string; error_message?: string };
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS')
    throw new Error(data.error_message ?? data.status);
  return `Connected — Geocoding API active`;
}

// ─── API Definitions ──────────────────────────────────────────────────────────
const APIS: ApiConfig[] = [
  {
    id: 'openai', label: 'OpenAI', envKey: 'VITE_OPENAI_API_KEY', lsKey: `${LS_PREFIX}OPENAI`,
    Icon: Brain, color: '#10a37f', docs: 'platform.openai.com/api-keys', masked: true,
    testFn: testOpenAI,
  },
  {
    id: 'supabase_anon', label: 'Supabase Anon Key', envKey: 'VITE_SUPABASE_ANON_KEY', lsKey: `${LS_PREFIX}SUPABASE_ANON`,
    Icon: Server, color: '#3ecf8e', docs: 'supabase.com/dashboard', masked: true,
    testFn: (key) => testSupabase(import.meta.env.VITE_SUPABASE_URL, key),
  },
  {
    id: 'news', label: 'NewsAPI', envKey: 'VITE_NEWS_API_KEY', lsKey: `${LS_PREFIX}NEWS`,
    Icon: Newspaper, color: '#f59e0b', docs: 'newsapi.org/account', masked: false,
    testFn: testNewsAPI,
  },
  {
    id: 'google_maps', label: 'Google Maps', envKey: 'VITE_GOOGLE_MAPS_API_KEY', lsKey: `${LS_PREFIX}GOOGLE_MAPS`,
    Icon: Map, color: '#4285f4', docs: 'console.cloud.google.com', masked: false,
    testFn: testGoogleMaps,
  },
  {
    id: 'vapid', label: 'VAPID Public Key', envKey: 'VITE_VAPID_PUBLIC_KEY', lsKey: `${LS_PREFIX}VAPID`,
    Icon: Bell, color: '#8b5cf6', docs: 'Run: npx web-push generate-vapid-keys', masked: false,
    testFn: async (key) => key?.length > 60 ? 'Key format valid (88 chars expected)' : 'Key looks too short',
  },
];

function maskKey(key: string): string {
  if (!key || key.length < 12) return '••••••••';
  return key.slice(0, 8) + '••••••••••••••••' + key.slice(-4);
}

// ─── Single API Row ────────────────────────────────────────────────────────────
function ApiRow({ api }: { api: ApiConfig }) {
  const envValue  = import.meta.env[api.envKey] as string ?? '';
  const lsValue   = localStorage.getItem(api.lsKey) ?? '';
  const effective = lsValue || envValue;

  const [value,   setValue]   = useState(lsValue);
  const [status,  setStatus]  = useState<ApiStatus>('idle');
  const [msg,     setMsg]     = useState('');
  const [visible, setVisible] = useState(false);
  const [dirty,   setDirty]   = useState(false);

  const activeKey = value || effective;

  const handleTest = useCallback(async () => {
    if (!activeKey) { setMsg('No key configured'); setStatus('error'); return; }
    setStatus('testing'); setMsg('');
    try {
      const result = await api.testFn(activeKey);
      setMsg(result); setStatus('ok');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Unknown error'); setStatus('error');
    }
  }, [activeKey, api]);

  const handleSave = () => {
    if (value) localStorage.setItem(api.lsKey, value);
    else localStorage.removeItem(api.lsKey);
    setDirty(false);
    setMsg('Saved to session — restart dev server to apply .env.local changes');
    setStatus('ok');
  };

  const { Icon } = api;

  const statusIcon = status === 'ok'      ? <CheckCircle size={14} style={{ color: '#4ade80' }} />
                   : status === 'error'   ? <XCircle     size={14} style={{ color: '#f87171' }} />
                   : status === 'testing' ? <RefreshCw   size={14} style={{ color: api.color, animation: 'spin 1s linear infinite' }} />
                   : <AlertCircle size={14} style={{ color: 'var(--text-muted)' }} />;

  return (
    <div style={{
      border: '1px solid var(--border-subtle)', marginBottom: 12,
      background: 'rgba(255,255,255,0.02)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)',
        background: 'rgba(255,255,255,0.02)',
      }}>
        <Icon size={15} style={{ color: api.color }} />
        <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.12em', flex: 1 }}>
          {api.label}
        </span>
        {/* Source badge with tooltip */}
        <HelpBadge
          placement="left"
          title={lsValue ? 'Key Source: Override' : envValue ? 'Key Source: .env' : 'Key Source: Missing'}
          text={
            lsValue
              ? 'This key was manually overridden in localStorage for this browser session. It takes priority over .env.local.'
              : envValue
              ? 'This key is loaded from the .env.local file at build time. Restart the dev server after editing .env.local.'
              : 'No key is configured for this service. Enter one below and save, or add it to .env.local.'
          }
        />
        <span style={{
          fontFamily: 'monospace', fontSize: 9, padding: '2px 8px', textTransform: 'uppercase', letterSpacing: '0.1em',
          border: `1px solid ${lsValue ? 'rgba(139,92,246,0.4)' : 'rgba(74,222,128,0.3)'}`,
          color: lsValue ? '#a78bfa' : 'var(--green)',
          background: lsValue ? 'rgba(139,92,246,0.08)' : 'rgba(74,222,128,0.06)',
        }}>
          {lsValue ? '🔑 OVERRIDE' : envValue ? '📄 .ENV' : '⚠️ MISSING'}
        </span>
        {statusIcon}
      </div>

      {/* Body */}
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Current effective key (masked) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Key size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', flex: 1, wordBreak: 'break-all' }}>
            {effective ? (visible ? effective : maskKey(effective)) : 'Not configured'}
          </span>
          {effective && (
            <button
              onClick={() => setVisible(v => !v)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
            >
              {visible ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          )}
        </div>

        {/* Override input */}
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type={visible ? 'text' : 'password'}
            placeholder={`Paste new ${api.label} key to override…`}
            value={value}
            onChange={e => { setValue(e.target.value); setDirty(true); setStatus('idle'); setMsg(''); }}
            style={{
              flex: 1, fontFamily: 'monospace', fontSize: 11,
              background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)', padding: '6px 10px', outline: 'none',
            }}
          />
          {dirty && (
            <>
              <HelpBadge
                title="Save Key"
                text="Saves this key to browser localStorage for the current session. It will override the .env value until cleared. Does NOT persist across incognito windows."
                placement="top"
              />
              <button
                onClick={handleSave}
                title="Save override to localStorage"
                style={{
                  display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px',
                  fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em',
                  background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.3)',
                  color: '#a78bfa', cursor: 'pointer',
                }}
              >
                <Save size={12} /> Save
              </button>
            </>
          )}
          <HelpBadge
            title="Test API Key"
            text="Sends a live request to the API to verify the key is valid and the service is reachable. Uses the currently effective key (override takes priority over .env)."
            placement="top"
          />
          <button
            onClick={handleTest}
            disabled={status === 'testing'}
            title="Run live API test"
            style={{
              display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px',
              fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em',
              background: status === 'ok' ? 'rgba(74,222,128,0.08)' : status === 'error' ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${status === 'ok' ? 'rgba(74,222,128,0.3)' : status === 'error' ? 'rgba(239,68,68,0.3)' : 'var(--border-subtle)'}`,
              color: status === 'ok' ? 'var(--green)' : status === 'error' ? '#f87171' : 'var(--text-secondary)',
              cursor: status === 'testing' ? 'not-allowed' : 'pointer',
            }}
          >
            <Zap size={12} />
            {status === 'testing' ? 'Testing…' : 'Test'}
          </button>
        </div>

        {/* Status message */}
        {msg && (
          <div style={{
            fontFamily: 'monospace', fontSize: 11, padding: '6px 10px',
            background: status === 'ok' ? 'rgba(74,222,128,0.06)' : 'rgba(239,68,68,0.06)',
            border: `1px solid ${status === 'ok' ? 'rgba(74,222,128,0.2)' : 'rgba(239,68,68,0.2)'}`,
            color: status === 'ok' ? '#4ade80' : '#f87171',
          }}>
            {msg}
          </div>
        )}

        {/* Docs link */}
        <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>
          📎 Docs: {api.docs}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function ApiSettings() {
  const [testingAll, setTestingAll] = useState(false);
  const [allStatuses, setAllStatuses] = useState<Record<string, 'ok' | 'error'>>({});

  const testAll = async () => {
    setTestingAll(true);
    const results: Record<string, 'ok' | 'error'> = {};
    for (const api of APIS) {
      const key = localStorage.getItem(api.lsKey) || (import.meta.env[api.envKey] as string ?? '');
      try { await api.testFn(key); results[api.id] = 'ok'; }
      catch { results[api.id] = 'error'; }
    }
    setAllStatuses(results);
    setTestingAll(false);
  };

  useEffect(() => { testAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const okCount    = Object.values(allStatuses).filter(s => s === 'ok').length;
  const errorCount = Object.values(allStatuses).filter(s => s === 'error').length;

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 24 }}>
      {/* Header */}
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: 6 }}>
            ADMIN · CONFIGURATION
          </div>
          <h1 style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.15em', margin: 0 }}>
            API Settings & Diagnostics
          </h1>
          <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
            View, test and override all API credentials. Overrides are stored in localStorage for this session.
            To persist permanently, update <code style={{ color: 'var(--amber)' }}>.env.local</code> and restart the dev server.
          </p>
        </div>

        <button
          onClick={testAll}
          disabled={testingAll}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', flexShrink: 0,
            fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em',
            background: 'rgba(212,160,68,0.1)', border: '1px solid rgba(212,160,68,0.3)',
            color: 'var(--amber)', cursor: testingAll ? 'not-allowed' : 'pointer',
          }}
        >
          <RefreshCw size={13} style={{ animation: testingAll ? 'spin 1s linear infinite' : 'none' }} />
          {testingAll ? 'Testing…' : 'Test All APIs'}
        </button>
      </div>

      {/* Health summary bar */}
      {Object.keys(allStatuses).length > 0 && (
        <div style={{
          display: 'flex', gap: 16, padding: '10px 16px', marginBottom: 20,
          background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle)',
        }}>
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#4ade80' }}>
            ✅ {okCount} Healthy
          </span>
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#f87171' }}>
            ❌ {errorCount} Failed
          </span>
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>
            {APIS.length - okCount - errorCount} Unchecked
          </span>
        </div>
      )}

      {/* API rows */}
      {APIS.map(api => <ApiRow key={api.id} api={api} />)}

      {/* Note */}
      <div style={{
        marginTop: 8, padding: '12px 16px',
        background: 'rgba(212,160,68,0.04)', border: '1px solid rgba(212,160,68,0.15)',
        fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6,
      }}>
        ⚠️ <strong style={{ color: 'var(--amber)' }}>Security note:</strong> API keys saved here are stored in your browser's localStorage.
        They are not sent to any server. For production deployments, always use server-side environment variables.
      </div>
    </div>
  );
}
