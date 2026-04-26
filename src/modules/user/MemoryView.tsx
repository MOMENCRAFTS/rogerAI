import { useState, useEffect, useCallback } from 'react';
import { BookOpen, StickyNote, Mic, Brain, Check, Trash2, Search, X, MapPin, Pin, GraduationCap, ChevronDown, ChevronUp } from 'lucide-react';
import {
  fetchMemories, fetchMemoryGraph, confirmMemoryFact, deleteMemoryFact,
  fetchEncyclopedia, deleteEncyclopediaEntry,
  type DbMemory, type DbMemoryFact, type DbEncyclopediaEntry,
} from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { useI18n } from '../../context/I18nContext';

type MainTab = 'vault' | 'roger_knows' | 'knowledge';
type VaultFilter = 'all' | 'note' | 'book' | 'observation' | 'capture';

const TYPE_ICONS: Record<DbMemory['type'], typeof BookOpen> = {
  book: BookOpen, note: StickyNote, observation: Mic, capture: Mic,
};

const FACT_COLORS: Record<string, string> = {
  person: '#f59e0b',    company: '#3b82f6',
  project: '#8b5cf6',   preference: '#ec4899',
  goal: '#ef4444',      habit: '#10b981',
  relationship: '#f97316', location: '#6366f1',
};

const typeColor = (t: DbMemory['type']) =>
  t === 'book' ? 'var(--amber)' : t === 'observation' ? '#a78bfa' : 'var(--green)';

export default function MemoryView({ userId }: { userId: string }) {
  const { t: _t } = useI18n();
  const [mainTab, setMainTab]         = useState<MainTab>('vault');

  // Vault state
  const [memories, setMemories]       = useState<DbMemory[]>([]);
  const [pinned, setPinned]           = useState<Set<string>>(new Set());
  const [filter, setFilter]           = useState<VaultFilter>('all');
  const [search, setSearch]           = useState('');
  const [expanded, setExpanded]       = useState<string | null>(null);
  const [vaultLoading, setVaultLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null); // memory id

  // Roger Knows state
  const [facts, setFacts]             = useState<DbMemoryFact[]>([]);
  const [factsLoading, setFactsLoading] = useState(true);
  const [factFilter, setFactFilter]   = useState<string>('all');

  // Encyclopedia state
  const [entries, setEntries]           = useState<DbEncyclopediaEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [expandedEntry, setExpandedEntry]   = useState<string | null>(null);

  const loadVault = useCallback(() => {
    setVaultLoading(true);
    fetchMemories(userId).then(d => { setMemories(d); setVaultLoading(false); }).catch(() => setVaultLoading(false));
  }, [userId]);

  const loadFacts = useCallback(() => {
    setFactsLoading(true);
    fetchMemoryGraph(userId).then(d => { setFacts(d); setFactsLoading(false); }).catch(() => setFactsLoading(false));
  }, [userId]);

  const loadEncyclopedia = useCallback(() => {
    setEntriesLoading(true);
    fetchEncyclopedia(userId).then(d => { setEntries(d); setEntriesLoading(false); }).catch(() => setEntriesLoading(false));
  }, [userId]);

  useEffect(() => { if (mainTab === 'vault') loadVault(); }, [mainTab, loadVault]);
  useEffect(() => { if (mainTab === 'roger_knows') loadFacts(); }, [mainTab, loadFacts]);
  useEffect(() => { if (mainTab === 'knowledge') loadEncyclopedia(); }, [mainTab, loadEncyclopedia]);

  useEffect(() => {
    const handler = () => { loadVault(); loadFacts(); loadEncyclopedia(); };
    window.addEventListener('roger:refresh', handler);
    return () => window.removeEventListener('roger:refresh', handler);
  }, [loadVault, loadFacts, loadEncyclopedia]);

  // Load pinned set from localStorage
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`roger:pinned:${userId}`) ?? '[]') as string[];
      setPinned(new Set(saved));
    } catch { /* silent */ }
  }, [userId]);

  const togglePin = (id: string) => {
    setPinned(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem(`roger:pinned:${userId}`, JSON.stringify([...next]));
      return next;
    });
  };

  const handleDeleteMemory = async (id: string) => {
    try { await supabase.from('memories').delete().eq('id', id); } catch { /* silent */ }
    setMemories(prev => prev.filter(m => m.id !== id));
    setConfirmDelete(null);
    if (expanded === id) setExpanded(null);
  };

  const handleConfirmFact = async (id: string) => {
    await confirmMemoryFact(id).catch(() => {});
    setFacts(prev => prev.map(f => f.id === id ? { ...f, is_confirmed: true } : f));
  };
  const handleDeleteFact = async (id: string) => {
    await deleteMemoryFact(id).catch(() => {});
    setFacts(prev => prev.filter(f => f.id !== id));
  };

  const handleDeleteEntry = async (id: string) => {
    await deleteEncyclopediaEntry(id).catch(() => {});
    setEntries(prev => prev.filter(e => e.id !== id));
  };

  const VAULT_FILTERS: VaultFilter[] = ['all', 'note', 'book', 'observation', 'capture'];
  const FACT_TYPES = ['all', ...Array.from(new Set(facts.map(f => f.fact_type)))];

  const filteredMemories = memories
    .filter(m => filter === 'all' || m.type === filter)
    .filter(m => !search || m.text.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const ap = pinned.has(a.id) ? 1 : 0;
      const bp = pinned.has(b.id) ? 1 : 0;
      return bp - ap; // pinned first
    });

  const filteredFacts = facts.filter(f => factFilter === 'all' || f.fact_type === factFilter);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Delete confirm dialog */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(239,68,68,0.3)', padding: '24px 28px', maxWidth: 300, width: '90%' }}>
            <p style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', marginBottom: 20 }}>Delete this memory? This cannot be undone.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => handleDeleteMemory(confirmDelete)} style={{ flex: 1, padding: '8px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171', cursor: 'pointer' }}>Delete</button>
              <button onClick={() => setConfirmDelete(null)} style={{ flex: 1, padding: '8px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Main tab switcher */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', padding: '0 16px' }}>
        {[
          { key: 'vault' as MainTab, icon: BookOpen, label: 'Memory Vault' },
          { key: 'roger_knows' as MainTab, icon: Brain, label: 'Roger Knows' },
          { key: 'knowledge' as MainTab, icon: GraduationCap, label: 'Knowledge' },
        ].map(({ key, icon: Icon, label }) => (
          <button key={key} onClick={() => setMainTab(key)} style={{
            flex: 1, padding: '12px 8px', background: 'transparent', border: 'none', cursor: 'pointer',
            borderBottom: mainTab === key ? '2px solid var(--amber)' : '2px solid transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            color: mainTab === key ? 'var(--amber)' : 'var(--text-muted)',
            fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em',
            transition: 'color 150ms',
          }}>
            <Icon size={12} />{label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>

        {/* ── VAULT TAB ── */}
        {mainTab === 'vault' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <BookOpen size={14} style={{ color: 'var(--amber)' }} />
              <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>Memory Vault</span>
              <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>{memories.length} CAPTURED</span>
            </div>

            {/* Search bar */}
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <Search size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search memories..."
                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 32px 8px 30px', fontFamily: 'monospace', fontSize: 12, background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none' }}
              />
              {search && (
                <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 2 }}>
                  <X size={12} style={{ color: 'var(--text-muted)' }} />
                </button>
              )}
            </div>

            {/* Filter chips */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 16, overflowX: 'auto' }}>
              {VAULT_FILTERS.map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{
                  flexShrink: 0, padding: '4px 12px', fontFamily: 'monospace', fontSize: 10,
                  textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer',
                  border: `1px solid ${filter === f ? 'var(--amber)' : 'var(--border-subtle)'}`,
                  background: filter === f ? 'rgba(212,160,68,0.1)' : 'transparent',
                  color: filter === f ? 'var(--amber)' : 'var(--text-muted)',
                }}>{f}</button>
              ))}
            </div>

            {vaultLoading && <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>Loading...</p>}
            {!vaultLoading && filteredMemories.length === 0 && (
              <div style={{ textAlign: 'center', padding: '48px 0', opacity: 0.4 }}>
                <BookOpen size={28} style={{ color: 'var(--text-muted)', marginBottom: 8 }} />
                <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>No memories yet</p>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filteredMemories.map(m => {
                const Icon   = TYPE_ICONS[m.type] ?? StickyNote;
                const isOpen = expanded === m.id;
                const isPinned = pinned.has(m.id);
                const locLabel = (m as DbMemory & { location_label?: string }).location_label;

                return (
                  <div key={m.id} style={{
                    padding: '12px 14px', border: `1px solid ${isPinned ? 'rgba(212,160,68,0.3)' : 'var(--border-subtle)'}`,
                    background: isPinned ? 'rgba(212,160,68,0.04)' : 'var(--bg-elevated)',
                    transition: 'background 150ms, border-color 150ms',
                  }}>
                    {/* Header row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <Icon size={11} style={{ color: typeColor(m.type), flexShrink: 0 }} />
                      <span style={{ fontFamily: 'monospace', fontSize: 9, color: typeColor(m.type), textTransform: 'uppercase', letterSpacing: '0.12em' }}>{m.type}</span>
                      {locLabel && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontFamily: 'monospace', fontSize: 9, color: '#6366f1' }}>
                          <MapPin size={8} />{locLabel}
                        </span>
                      )}
                      <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>{new Date(m.created_at).toLocaleDateString()}</span>

                      {/* Pin button */}
                      <button onClick={e => { e.stopPropagation(); togglePin(m.id); }} title={isPinned ? 'Unpin' : 'Pin to top'} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, opacity: isPinned ? 1 : 0.35 }}>
                        <Pin size={11} style={{ color: isPinned ? 'var(--amber)' : 'var(--text-muted)' }} />
                      </button>
                      {/* Delete button */}
                      <button onClick={e => { e.stopPropagation(); setConfirmDelete(m.id); }} title="Delete memory" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, opacity: 0.35 }}>
                        <Trash2 size={11} style={{ color: '#f87171' }} />
                      </button>
                    </div>

                    {/* Text — click to expand */}
                    <p
                      onClick={() => setExpanded(isOpen ? null : m.id)}
                      style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', margin: 0, lineHeight: 1.55, cursor: 'pointer',
                        overflow: isOpen ? 'visible' : 'hidden', display: isOpen ? 'block' : '-webkit-box',
                        WebkitLineClamp: isOpen ? undefined : 2, WebkitBoxOrient: 'vertical' as const,
                      }}
                    >
                      {m.text}
                    </p>

                    {/* Tags — visible when expanded */}
                    {isOpen && m.tags && m.tags.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, marginTop: 10, flexWrap: 'wrap' }}>
                        {m.tags.map(tag => (
                          <span key={tag} style={{ padding: '2px 8px', fontFamily: 'monospace', fontSize: 9, background: 'rgba(212,160,68,0.08)', border: '1px solid rgba(212,160,68,0.2)', color: 'var(--amber)', textTransform: 'uppercase' }}>{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── ROGER KNOWS TAB ── */}
        {mainTab === 'roger_knows' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Brain size={14} style={{ color: '#a78bfa' }} />
              <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>What Roger Knows</span>
              <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>{facts.length} FACTS</span>
            </div>
            <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.6 }}>
              Facts Roger has learned. Confirm to boost confidence. Delete to correct errors.
            </p>

            <div style={{ display: 'flex', gap: 6, marginBottom: 14, overflowX: 'auto' }}>
              {FACT_TYPES.map(t => {
                const color = FACT_COLORS[t] ?? 'var(--amber)';
                const active = factFilter === t;
                return (
                  <button key={t} onClick={() => setFactFilter(t)} style={{
                    flexShrink: 0, padding: '4px 10px', fontFamily: 'monospace', fontSize: 9,
                    textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer',
                    border: `1px solid ${active ? color : 'var(--border-subtle)'}`,
                    background: active ? `${color}18` : 'transparent',
                    color: active ? color : 'var(--text-muted)',
                  }}>{t}</button>
                );
              })}
            </div>

            {factsLoading && <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>Loading...</p>}
            {!factsLoading && filteredFacts.length === 0 && (
              <div style={{ textAlign: 'center', padding: '48px 0', opacity: 0.4 }}>
                <Brain size={28} style={{ color: 'var(--text-muted)', marginBottom: 8 }} />
                <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>No facts yet — start talking to Roger</p>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filteredFacts.map(f => {
                const color = FACT_COLORS[f.fact_type] ?? 'var(--amber)';
                return (
                  <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', borderLeft: `3px solid ${color}` }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 9, color, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{f.fact_type}</span>
                        {f.is_confirmed && <span style={{ fontFamily: 'monospace', fontSize: 8, color: '#10b981', letterSpacing: '0.1em' }}>✓ CONFIRMED</span>}
                        {f.source_tx === 'onboarding' && <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>ONBOARDING</span>}
                      </div>
                      <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', margin: 0, lineHeight: 1.4 }}>
                        <span style={{ color: 'var(--text-muted)' }}>{f.subject}</span>{' '}{f.predicate}{' '}
                        <strong style={{ color }}>{f.object}</strong>
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      {!f.is_confirmed && (
                        <button onClick={() => handleConfirmFact(f.id)} title="Confirm" style={{ width: 28, height: 28, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Check size={12} />
                        </button>
                      )}
                      <button onClick={() => handleDeleteFact(f.id)} title="Delete" style={{ width: 28, height: 28, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── KNOWLEDGE / ENCYCLOPEDIA TAB ── */}
        {mainTab === 'knowledge' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <GraduationCap size={14} style={{ color: '#6366f1' }} />
              <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>Personal Encyclopedia</span>
              <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>{entries.length} ARTICLES</span>
            </div>
            <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.6 }}>
              Topics you've explored with Roger. Compiled from deep dive conversations.
            </p>

            {entriesLoading && <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>Loading...</p>}
            {!entriesLoading && entries.length === 0 && (
              <div style={{ textAlign: 'center', padding: '48px 0', opacity: 0.4 }}>
                <GraduationCap size={28} style={{ color: 'var(--text-muted)', marginBottom: 8 }} />
                <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>No articles yet — ask Roger about any topic</p>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {entries.map(entry => {
                const isOpen = expandedEntry === entry.id;
                return (
                  <div key={entry.id} style={{ border: '1px solid rgba(99,102,241,0.2)', background: isOpen ? 'rgba(99,102,241,0.04)' : 'var(--bg-elevated)', transition: 'background 150ms' }}>
                    {/* Header */}
                    <button
                      onClick={() => setExpandedEntry(isOpen ? null : entry.id)}
                      style={{ width: '100%', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                    >
                      <span style={{ fontSize: 18 }}>{entry.emoji}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', fontWeight: 600, marginBottom: 2 }}>{entry.topic}</div>
                        <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.summary}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 8, color: '#6366f1' }}>{entry.source_turns} turns</span>
                        {isOpen ? <ChevronUp size={14} style={{ color: 'var(--text-muted)' }} /> : <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />}
                      </div>
                    </button>

                    {/* Expanded content */}
                    {isOpen && (
                      <div style={{ padding: '0 14px 14px' }}>
                        {/* Tags */}
                        {entry.tags && entry.tags.length > 0 && (
                          <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
                            {entry.tags.map(tag => (
                              <span key={tag} style={{ padding: '2px 8px', fontFamily: 'monospace', fontSize: 8, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', color: '#818cf8', textTransform: 'uppercase' }}>{tag}</span>
                            ))}
                          </div>
                        )}

                        {/* Sections */}
                        {entry.sections && entry.sections.length > 0 && entry.sections.map((sec, i) => (
                          <div key={i} style={{ marginBottom: 12 }}>
                            <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>{sec.title}</div>
                            <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{sec.content}</p>
                          </div>
                        ))}

                        {/* Full article fallback if no sections */}
                        {(!entry.sections || entry.sections.length === 0) && (
                          <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{entry.full_article}</p>
                        )}

                        {/* Footer */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--border-subtle)' }}>
                          <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)' }}>
                            Updated {new Date(entry.updated_at).toLocaleDateString()}
                          </span>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteEntry(entry.id); }}
                            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontFamily: 'monospace', fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.1em', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', cursor: 'pointer' }}
                          >
                            <Trash2 size={9} /> Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
