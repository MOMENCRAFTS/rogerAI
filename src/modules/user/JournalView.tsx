import { useState, useEffect } from 'react';
import { BookMarked, Search, X, MapPin, Tag } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useI18n } from '../../context/I18nContext';

interface JournalEntry {
  id: string;
  text: string;
  created_at: string;
  location_label: string | null;
  tags: string[] | null;
  entities: { type: string; text: string }[] | null;
}

export default function JournalView({ userId }: { userId: string }) {
  const { t: _t } = useI18n();
  const [entries, setEntries]     = useState<JournalEntry[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [expanded, setExpanded]   = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const { data } = await supabase
          .from('memories')
          .select('id, text, created_at, location_label, tags, entities')
          .eq('user_id', userId)
          .eq('type', 'book')
          .order('created_at', { ascending: false });
        setEntries((data ?? []) as JournalEntry[]);
      } catch { /* silent */ }
      finally { setLoading(false); }
    })();
  }, [userId]);


  // Group entries by date
  const filtered = entries.filter(e =>
    !search || e.text.toLowerCase().includes(search.toLowerCase())
  );

  const grouped = filtered.reduce<Record<string, JournalEntry[]>>((acc, entry) => {
    const key = new Date(entry.created_at).toLocaleDateString('en', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    if (!acc[key]) acc[key] = [];
    acc[key].push(entry);
    return acc;
  }, {});

  return (
    <div style={{ padding: '16px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <BookMarked size={16} style={{ color: 'var(--amber)' }} />
        <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>
          Journal
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>
          {entries.length} ENTRIES
        </span>
      </div>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <Search size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search journal..."
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '8px 32px 8px 30px',
            fontFamily: 'monospace', fontSize: 12,
            background: 'var(--bg-recessed)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-primary)',
            outline: 'none',
          }}
        />
        {search && (
          <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 2 }}>
            <X size={12} style={{ color: 'var(--text-muted)' }} />
          </button>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>Loading...</p>
      )}

      {/* Empty state */}
      {!loading && entries.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 0', opacity: 0.4 }}>
          <BookMarked size={32} style={{ color: 'var(--text-muted)', marginBottom: 12 }} />
          <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.18em', marginBottom: 6 }}>
            No journal entries yet
          </p>
          <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', opacity: 0.7 }}>
            Say "note this" or "book update" to Roger
          </p>
        </div>
      )}

      {/* Grouped journal entries */}
      {Object.entries(grouped).map(([date, dayEntries]) => (
        <div key={date} style={{ marginBottom: 24 }}>
          {/* Date divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ height: 1, flex: 1, background: 'var(--border-subtle)' }} />
            <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.18em', whiteSpace: 'nowrap' }}>
              {date}
            </span>
            <div style={{ height: 1, flex: 1, background: 'var(--border-subtle)' }} />
          </div>

          {/* Entries for this day */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {dayEntries.map(entry => {
              const isOpen = expanded === entry.id;
              const time = new Date(entry.created_at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
              const preview = entry.text.length > 120 && !isOpen
                ? entry.text.slice(0, 120).replace(/\s\S+$/, '') + '…'
                : entry.text;

              return (
                <div
                  key={entry.id}
                  onClick={() => setExpanded(isOpen ? null : entry.id)}
                  style={{
                    padding: '14px 16px',
                    border: `1px solid ${isOpen ? 'rgba(212,160,68,0.3)' : 'var(--border-subtle)'}`,
                    background: isOpen ? 'rgba(212,160,68,0.04)' : 'var(--bg-elevated)',
                    cursor: 'pointer',
                    transition: 'border-color 150ms, background 150ms',
                  }}
                >
                  {/* Time + location row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>
                      {time}
                    </span>
                    {entry.location_label && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontFamily: 'monospace', fontSize: 9, color: '#6366f1' }}>
                        <MapPin size={9} />
                        {entry.location_label}
                      </span>
                    )}
                    <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 9, color: isOpen ? 'var(--amber)' : 'var(--text-muted)', opacity: 0.6 }}>
                      {isOpen ? '▲' : '▼'}
                    </span>
                  </div>

                  {/* Entry text */}
                  <p style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', margin: 0, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                    {preview}
                  </p>

                  {/* Tags + entities — show when expanded */}
                  {isOpen && (entry.tags?.length || entry.entities?.length) && (
                    <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {entry.tags?.filter(t => t && t !== 'BOOK_UPDATE').map(tag => (
                        <span key={tag} style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'monospace', fontSize: 9, color: '#a78bfa', padding: '2px 8px', border: '1px solid rgba(167,139,250,0.25)', background: 'rgba(167,139,250,0.07)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                          <Tag size={8} />{tag}
                        </span>
                      ))}
                      {entry.entities?.slice(0, 5).map((e, i) => (
                        <span key={i} style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', padding: '2px 8px', border: '1px solid var(--border-subtle)', background: 'var(--bg-recessed)' }}>
                          {e.text}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
