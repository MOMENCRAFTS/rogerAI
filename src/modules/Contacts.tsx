import { useState, useEffect, useRef } from 'react';
import { Radio, Plus, UserCheck, UserX, Clock, MessageSquare, RefreshCw, X, Send } from 'lucide-react';
import {
  fetchContacts, inviteContact, blockContact, acceptContact,
  type DbRogerContact,
} from '../lib/api';
import { supabase } from '../lib/supabase';

const USER_ID = 'ADMIN-TEST';

export default function Contacts() {
  const [contacts, setContacts]   = useState<DbRogerContact[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState<'all' | 'active' | 'pending' | 'blocked'>('all');
  const [showInvite, setShowInvite] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteHandle, setInviteHandle] = useState('');
  const [inviting, setInviting]   = useState(false);
  const [historyContact, setHistoryContact] = useState<DbRogerContact | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchContacts(USER_ID).catch(() => [] as DbRogerContact[]);
      setContacts(data);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  // Realtime: contacts table changes
  useEffect(() => {
    const ch = supabase
      .channel('contacts-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roger_contacts' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const handleInvite = async () => {
    if (!inviteName.trim() || !inviteHandle.trim()) return;
    setInviting(true);
    try {
      await inviteContact(USER_ID, inviteName.trim(), inviteHandle.trim());
      setInviteName(''); setInviteHandle(''); setShowInvite(false);
      await load();
    } catch { /* show error TODO */ }
    finally { setInviting(false); }
  };

  const handleBlock   = async (id: string) => { await blockContact(id);   await load(); };
  const handleAccept  = async (id: string) => { await acceptContact(id);  await load(); };

  const filtered = filter === 'all' ? contacts : contacts.filter(c => c.status === filter);

  const statusDot = (s: DbRogerContact['status']) =>
    s === 'active'  ? '#10b981' :
    s === 'pending' ? 'var(--amber)' : 'var(--rust, #c0392b)';

  const timeAgo = (iso: string) => {
    const d = Date.now() - new Date(iso).getTime();
    const m = Math.floor(d / 60000);
    return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <Radio size={15} style={{ color: 'var(--amber)' }} />
        <div style={{ flex: 1 }}>
          <h1 style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: '0.18em', color: 'var(--amber)', textTransform: 'uppercase', margin: 0 }}>
            ROGER NETWORK
          </h1>
          <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
            YOUR CONTACTS / CALLSIGNS LINKED — {contacts.filter(c => c.status === 'active').length} ACTIVE
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={load} style={iconBtn}><RefreshCw size={12} /></button>
          <button onClick={() => { setShowInvite(true); setTimeout(() => nameRef.current?.focus(), 80); }} style={{ ...iconBtn, color: 'var(--amber)', borderColor: 'rgba(212,160,68,0.4)' }}>
            <Plus size={12} /> <span style={{ fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.1em' }}>INVITE</span>
          </button>
        </div>
      </div>

      {/* Filter chips */}
      <div style={{ padding: '8px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 6, flexShrink: 0 }}>
        {(['all', 'active', 'pending', 'blocked'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '2px 12px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase',
            letterSpacing: '0.1em', cursor: 'pointer',
            border: `1px solid ${filter === f ? 'var(--amber)' : 'var(--border-subtle)'}`,
            background: filter === f ? 'rgba(212,160,68,0.1)' : 'transparent',
            color: filter === f ? 'var(--amber)' : 'var(--text-muted)',
          }}>{f} {f !== 'all' && `(${contacts.filter(c => c.status === f).length})`}</button>
        ))}
      </div>

      {/* Invite modal */}
      {showInvite && (
        <div style={{ margin: '12px 20px', padding: '16px 18px', background: 'rgba(212,160,68,0.06)', border: '1px solid rgba(212,160,68,0.3)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>📡 INVITE TO ROGER NETWORK</span>
            <button onClick={() => setShowInvite(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={12} /></button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input ref={nameRef} value={inviteName} onChange={e => setInviteName(e.target.value)}
              placeholder="Display name  (e.g. Ahmad)"
              style={{ flex: 1, ...inputStyle }} />
            <input value={inviteHandle} onChange={e => setInviteHandle(e.target.value)}
              placeholder="Email or handle"
              onKeyDown={e => e.key === 'Enter' && handleInvite()}
              style={{ flex: 1, ...inputStyle }} />
          </div>
          <button onClick={handleInvite} disabled={inviting || !inviteName || !inviteHandle} style={{
            width: '100%', padding: '7px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase',
            letterSpacing: '0.12em', cursor: 'pointer',
            background: 'rgba(212,160,68,0.15)', border: '1px solid var(--amber)', color: 'var(--amber)',
            opacity: inviting ? 0.5 : 1,
          }}>
            <Send size={10} style={{ display: 'inline', marginRight: 6 }} />
            {inviting ? 'SENDING...' : 'SEND INVITE'}
          </button>
        </div>
      )}

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.2em' }}>
            Scanning network...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, opacity: 0.4 }}>
            <Radio size={40} style={{ color: 'var(--amber)' }} />
            <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.2em' }}>
              {filter === 'all' ? 'No contacts yet — invite someone to join your network' : `No ${filter} contacts`}
            </span>
          </div>
        ) : filtered.map(contact => (
          <div key={contact.id} style={{
            padding: '14px 16px', background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderLeft: `3px solid ${statusDot(contact.status)}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              {/* Status dot */}
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusDot(contact.status), flexShrink: 0 }} />
              <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', fontWeight: 700, flex: 1 }}>
                {contact.display_name.toUpperCase()}
              </span>
              <span style={{
                fontFamily: 'monospace', fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.12em',
                padding: '2px 8px',
                background: contact.status === 'active' ? 'rgba(16,185,129,0.1)' : contact.status === 'pending' ? 'rgba(212,160,68,0.1)' : 'rgba(192,57,43,0.1)',
                color: statusDot(contact.status),
                border: `1px solid ${statusDot(contact.status)}40`,
              }}>{contact.status}</span>
            </div>

            <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', marginBottom: 10 }}>
              {contact.handle && <span>Handle: {contact.handle} · </span>}
              {contact.status === 'active' && contact.accepted_at
                ? <span>Connected {timeAgo(contact.accepted_at)}</span>
                : <span>Invited {timeAgo(contact.invited_at)}</span>}
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              {contact.status === 'pending' && contact.contact_id && (
                <button onClick={() => handleAccept(contact.id)} style={{ ...actionBtn, color: '#10b981', borderColor: 'rgba(16,185,129,0.3)' }}>
                  <UserCheck size={10} /> ACCEPT
                </button>
              )}
              {contact.status === 'active' && (
                <button
                  onClick={() => setHistoryContact(contact)}
                  style={{ ...actionBtn, color: 'var(--amber)', borderColor: 'rgba(212,160,68,0.3)' }}>
                  <MessageSquare size={10} /> VIEW HISTORY
                </button>
              )}
              {contact.status !== 'blocked' && (
                <button onClick={() => handleBlock(contact.id)} style={{ ...actionBtn, color: 'var(--text-muted)', borderColor: 'var(--border-subtle)' }}>
                  <UserX size={10} /> BLOCK
                </button>
              )}
              <div style={{ flex: 1 }} />
              {contact.status === 'pending' && (
                <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Clock size={9} /> AWAITING ACCEPTANCE
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* History slide-in */}
      {historyContact && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 50,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex', justifyContent: 'flex-end',
        }} onClick={() => setHistoryContact(null)}>
          <div style={{
            width: 340, height: '100%', background: 'var(--bg-elevated)',
            borderLeft: '1px solid var(--border-subtle)',
            padding: 20, overflowY: 'auto',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
                📡 {historyContact.display_name}
              </span>
              <button onClick={() => setHistoryContact(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={14} /></button>
            </div>
            <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Relay history will appear here once messages are exchanged.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--border-subtle)',
  padding: '4px 8px', cursor: 'pointer', color: 'var(--text-muted)',
  display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'monospace', fontSize: 10,
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
