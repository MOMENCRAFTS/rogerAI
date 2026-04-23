import { useState, useEffect, useCallback } from 'react';
import { BookOpen, StickyNote, Mic, Brain, Check, Trash2 } from 'lucide-react';

import {
  fetchMemories, fetchMemoryGraph, confirmMemoryFact, deleteMemoryFact,
  type DbMemory, type DbMemoryFact,
} from '../../lib/api';

type MainTab = 'vault' | 'roger_knows';
type VaultFilter = 'all' | 'note' | 'book' | 'observation' | 'capture';

const TYPE_ICONS: Record<DbMemory['type'], typeof BookOpen> = {
  book: BookOpen, note: StickyNote, observation: Mic, capture: Mic,
};

const FACT_COLORS: Record<string, string> = {
  person: '#f59e0b',     company: '#3b82f6',
  project: '#8b5cf6',    preference: '#ec4899',
  goal: '#ef4444',       habit: '#10b981',
  relationship: '#f97316', location: '#6366f1',
};

export default function MemoryView({ userId }: { userId: string }) {
  const [mainTab, setMainTab]   = useState<MainTab>('vault');

  // Vault state
  const [memories, setMemories] = useState<DbMemory[]>([]);
  const [filter, setFilter]     = useState<VaultFilter>('all');
  const [search, setSearch]     = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [vaultLoading, setVaultLoading] = useState(true);

  // Roger Knows state
  const [facts, setFacts]       = useState<DbMemoryFact[]>([]);
  const [factsLoading, setFactsLoading] = useState(true);
  const [factFilter, setFactFilter] = useState<string>('all');

  // Load vault
  const loadVault = useCallback(() => {
    setVaultLoading(true);
    fetchMemories(userId).then(d => { setMemories(d); setVaultLoading(false); }).catch(() => setVaultLoading(false));
  }, [userId]);

  // Load memory graph
  const loadFacts = useCallback(() => {
    setFactsLoading(true);
    fetchMemoryGraph(userId).then(d => { setFacts(d); setFactsLoading(false); }).catch(() => setFactsLoading(false));
  }, [userId]);

  useEffect(() => { if (mainTab === 'vault') loadVault(); }, [mainTab, loadVault]);
  useEffect(() => { if (mainTab === 'roger_knows') loadFacts(); }, [mainTab, loadFacts]);

  // Live-refresh on every Roger conversation turn
  useEffect(() => {
    const handler = () => { loadVault(); loadFacts(); };
    window.addEventListener('roger:refresh', handler);
    return () => window.removeEventListener('roger:refresh', handler);
  }, [loadVault, loadFacts]);

  const handleConfirmFact = async (id: string) => {
    await confirmMemoryFact(id).catch(() => {});
    setFacts(prev => prev.map(f => f.id === id ? { ...f, is_confirmed: true } : f));
  };

  const handleDeleteFact = async (id: string) => {
    await deleteMemoryFact(id).catch(() => {});
    setFacts(prev => prev.filter(f => f.id !== id));
  };

  const VAULT_FILTERS: VaultFilter[] = ['all', 'note', 'book', 'observation', 'capture'];
  const FACT_TYPES = ['all', ...Array.from(new Set(facts.map(f => f.fact_type)))];

  const filteredMemories = memories
    .filter(m => filter === 'all' || m.type === filter)
    .filter(m => !search || m.text.toLowerCase().includes(search.toLowerCase()));

  const filteredFacts = facts.filter(f => factFilter === 'all' || f.fact_type === factFilter);

  const typeColor = (t: DbMemory['type']) =>
    t === 'book' ? 'var(--amber)' : t === 'observation' ? '#a78bfa' : 'var(--green)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* ── Main tab switcher ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', padding: '0 16px 0' }}>
        {[
          { key: 'vault' as MainTab, icon: BookOpen, label: 'Memory Vault' },
          { key: 'roger_knows' as MainTab, icon: Brain, label: 'Roger Knows' },
        ].map(({ key, icon: Icon, label }) => (
          <button key={key} onClick={() => setMainTab(key)} style={{
            flex: 1, padding: '12px 8px', background: 'transparent', border: 'none', cursor: 'pointer',
            borderBottom: mainTab === key ? '2px solid var(--amber)' : '2px solid transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            color: mainTab === key ? 'var(--amber)' : 'var(--text-muted)',
            fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em',
            transition: 'color 150ms',
          }}>
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>

        {/* ── VAULT TAB ── */}
        {mainTab === 'vault' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <BookOpen size={14} style={{ color: 'var(--amber)' }} />
              <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>
                Memory Vault
              </span>
              <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>
                {memories.length} CAPTURED
              </span>
            </div>

            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search memories..."
              style={{ width: '100%', padding: '8px 12px', fontFamily: 'monospace', fontSize: 12, marginBottom: 12, boxSizing: 'border-box',
                background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none' }}
            />

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
                const Icon = TYPE_ICONS[m.type] ?? StickyNote;
                const isOpen = expanded === m.id;
                return (
                  <div key={m.id} onClick={() => setExpanded(isOpen ? null : m.id)}
                    style={{ padding: '12px 14px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', cursor: 'pointer', transition: 'background 150ms' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <Icon size={13} style={{ color: typeColor(m.type), marginTop: 2, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontFamily: 'monospace', fontSize: 9, color: typeColor(m.type), textTransform: 'uppercase', letterSpacing: '0.12em' }}>{m.type}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {(m as DbMemory & { location_label?: string }).location_label && (
                              <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#6366f1', display: 'flex', alignItems: 'center', gap: 3, letterSpacing: '0.08em' }}>
                                📍 {(m as DbMemory & { location_label?: string }).location_label}
                              </span>
                            )}
                            <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>{new Date(m.created_at).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', margin: 0, lineHeight: 1.5,
                          overflow: isOpen ? 'visible' : 'hidden', display: isOpen ? 'block' : '-webkit-box',
                          WebkitLineClamp: isOpen ? undefined : 2, WebkitBoxOrient: 'vertical' as const }}>
                          {m.text}
                        </p>
                        {isOpen && m.tags && m.tags.length > 0 && (
                          <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                            {m.tags.map(tag => (
                              <span key={tag} style={{ padding: '2px 8px', fontFamily: 'monospace', fontSize: 9, background: 'rgba(212,160,68,0.08)', border: '1px solid rgba(212,160,68,0.2)', color: 'var(--amber)', textTransform: 'uppercase' }}>
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
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
              <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>
                What Roger Knows
              </span>
              <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>
                {facts.length} FACTS
              </span>
            </div>
            <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.6 }}>
              Facts Roger has learned about you. Confirm to boost confidence. Delete to correct errors.
            </p>

            {/* Fact type filter */}
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
                <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>No facts yet — complete onboarding or start talking</p>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filteredFacts.map(f => {
                const color = FACT_COLORS[f.fact_type] ?? 'var(--amber)';
                return (
                  <div key={f.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px', border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-elevated)', borderLeft: `3px solid ${color}`,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 9, color, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                          {f.fact_type}
                        </span>
                        {f.is_confirmed && (
                          <span style={{ fontFamily: 'monospace', fontSize: 8, color: '#10b981', letterSpacing: '0.1em' }}>✓ CONFIRMED</span>
                        )}
                        {f.source_tx === 'onboarding' && (
                          <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>ONBOARDING</span>
                        )}
                      </div>
                      <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', margin: 0, lineHeight: 1.4 }}>
                        <span style={{ color: 'var(--text-muted)' }}>{f.subject}</span>{' '}
                        {f.predicate}{' '}
                        <strong style={{ color }}>{f.object}</strong>
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      {!f.is_confirmed && (
                        <button onClick={() => handleConfirmFact(f.id)} title="Confirm this fact" style={{
                          width: 28, height: 28, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)',
                          color: '#10b981', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Check size={12} />
                        </button>
                      )}
                      <button onClick={() => handleDeleteFact(f.id)} title="Delete this fact — it's wrong" style={{
                        width: 28, height: 28, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
                        color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Trash2 size={11} />
                      </button>
                    </div>
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
