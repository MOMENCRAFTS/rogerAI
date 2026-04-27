import { useState, useEffect } from 'react';
import { Rss, Plus, Radio, Users, RefreshCw, X } from 'lucide-react';
import { fetchChannels, createChannel, type DbRogerChannel } from '../lib/api';
import { supabase } from '../lib/supabase';

const USER_ID = 'ADMIN-TEST';

export default function Channels() {
  const [channels, setChannels]   = useState<DbRogerChannel[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName]     = useState('');
  const [newType, setNewType]     = useState<DbRogerChannel['type']>('group');
  const [creating, setCreating]   = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchChannels(USER_ID).catch(() => [] as DbRogerChannel[]);
      setChannels(data);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const ch = supabase
      .channel('channels-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roger_channels' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await createChannel(newName.trim(), newType, USER_ID);
      setNewName(''); setShowCreate(false);
      await load();
    } finally { setCreating(false); }
  };

  const typeIcon = (t: DbRogerChannel['type']) =>
    t === 'group' ? <Users size={12} /> :
    t === 'open'  ? <Rss   size={12} /> :
                    <Radio  size={12} />;

  const typeColor = (t: DbRogerChannel['type']) =>
    t === 'group' ? '#8b5cf6' :
    t === 'open'  ? '#3b82f6' :
                    'var(--amber)';

  const timeAgo = (iso: string) => {
    const d = Date.now() - new Date(iso).getTime();
    const m = Math.floor(d / 60000);
    return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <Rss size={15} style={{ color: 'var(--amber)' }} />
        <div style={{ flex: 1 }}>
          <h1 style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: '0.18em', color: 'var(--amber)', textTransform: 'uppercase', margin: 0 }}>
            ROGER CHANNELS
          </h1>
          <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
            GROUP COMMUNICATION / CONVOY COORDINATION — {channels.length} CHANNELS
          </p>
        </div>
        <button onClick={load} style={iconBtn}><RefreshCw size={12} /></button>
        <button onClick={() => setShowCreate(s => !s)} style={{ ...iconBtn, color: 'var(--amber)', borderColor: 'rgba(212,160,68,0.4)' }}>
          <Plus size={12} /> <span style={{ fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.1em' }}>CREATE</span>
        </button>
      </div>

      {/* Create panel */}
      {showCreate && (
        <div style={{ margin: '12px 20px 0', padding: '16px 18px', background: 'rgba(212,160,68,0.05)', border: '1px solid rgba(212,160,68,0.25)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>CREATE CHANNEL</span>
            <button onClick={() => setShowCreate(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={12} /></button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Channel name  (e.g. Family, Work Convoy)"
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              style={{ flex: 1, ...inputStyle }} />
            <select value={newType} onChange={e => setNewType(e.target.value as DbRogerChannel['type'])}
              style={{ ...inputStyle, width: 'auto', cursor: 'pointer' }}>
              <option value="direct">Direct (1:1)</option>
              <option value="group">Group</option>
              <option value="open">Open channel</option>
            </select>
          </div>

          {/* Type descriptions */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {(['direct', 'group', 'open'] as const).map(t => (
              <div key={t} onClick={() => setNewType(t)} style={{
                flex: 1, padding: '8px 10px', cursor: 'pointer',
                border: `1px solid ${newType === t ? typeColor(t) : 'var(--border-subtle)'}`,
                background: newType === t ? `${typeColor(t)}10` : 'transparent',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, color: typeColor(t) }}>
                  {typeIcon(t)}
                  <span style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{t}</span>
                </div>
                <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)' }}>
                  {t === 'direct' ? '1-to-1 private' : t === 'group' ? 'Invite-only group' : 'Open to all contacts'}
                </span>
              </div>
            ))}
          </div>

          <button onClick={handleCreate} disabled={creating || !newName.trim()} style={{
            width: '100%', padding: '7px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase',
            letterSpacing: '0.12em', cursor: 'pointer',
            background: 'rgba(212,160,68,0.15)', border: '1px solid var(--amber)', color: 'var(--amber)',
            opacity: creating ? 0.5 : 1,
          }}>
            {creating ? 'CREATING...' : 'OPEN CHANNEL'}
          </button>
        </div>
      )}

      {/* Channel list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.2em' }}>
            Scanning frequencies...
          </div>
        ) : channels.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, opacity: 0.4 }}>
            <Rss size={40} style={{ color: 'var(--amber)' }} />
            <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.2em' }}>
              No channels yet — create one to start your convoy
            </span>
          </div>
        ) : channels.map(ch => {
          const col = typeColor(ch.type);
          return (
            <div key={ch.id} style={{
              padding: '14px 16px', background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)', borderLeft: `3px solid ${col}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ color: col }}>{typeIcon(ch.type)}</div>
                <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', fontWeight: 700, flex: 1 }}>
                  {ch.name.toUpperCase()}
                </span>
                <span style={{
                  fontFamily: 'monospace', fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.1em',
                  padding: '2px 8px', background: `${col}15`, color: col, border: `1px solid ${col}40`,
                }}>{ch.type}</span>
              </div>

              <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', marginBottom: 10 }}>
                Created {timeAgo(ch.created_at)} · Owner: {ch.owner_id === USER_ID ? 'YOU' : ch.owner_id.slice(0, 8)}
              </div>

              <div style={{ display: 'flex', gap: 6 }}>
                <button style={{ ...actionBtn, color: col, borderColor: `${col}40` }}>
                  <Radio size={10} /> PTT TO CHANNEL
                </button>
                <button style={{ ...actionBtn, color: 'var(--text-muted)', borderColor: 'var(--border-subtle)' }}>
                  VIEW LOG
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--border-subtle)',
  padding: '4px 8px', cursor: 'pointer', color: 'var(--text-muted)',
  display: 'flex', alignItems: 'center', gap: 4,
};
const actionBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4,
  padding: '3px 10px', fontFamily: 'monospace', fontSize: 9,
  textTransform: 'uppercase', cursor: 'pointer', background: 'transparent',
  border: '1px solid', letterSpacing: '0.08em',
};
const inputStyle: React.CSSProperties = {
  background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)',
  padding: '6px 10px', fontFamily: 'monospace', fontSize: 10, color: 'var(--text-primary)',
  outline: 'none', width: '100%',
};
