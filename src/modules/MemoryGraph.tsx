import { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, Brain, ZoomIn, ZoomOut, Maximize2, Trash2, CheckCircle, Filter } from 'lucide-react';
import {
  fetchMemoryGraph, fetchAllEntityMentions, confirmMemoryFact, deleteMemoryFact,
  type DbMemoryFact, type DbEntityMention,
} from '../lib/api';

const USER_ID = 'ADMIN-TEST';

// ── Color palette by fact_type ────────────────────────────────────────────────
const TYPE_COLOR: Record<string, string> = {
  person:       '#f59e0b',
  company:      '#3b82f6',
  project:      '#8b5cf6',
  preference:   '#ec4899',
  goal:         '#ef4444',
  habit:        '#10b981',
  relationship: '#f97316',
  location:     '#6366f1',
  default:      '#6b7280',
};

function typeColor(t: string) { return TYPE_COLOR[t] ?? TYPE_COLOR.default; }

// ── Graph types ───────────────────────────────────────────────────────────────
interface GraphNode {
  id: string;
  label: string;
  factType: string;
  x: number; y: number;
  vx: number; vy: number;
  radius: number;
  mentionCount: number;
  pinned: boolean;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  predicate: string;
  confidence: number;
  factId: string;
  factType: string;
  confirmed: boolean;
}

// ── Build graph from facts ────────────────────────────────────────────────────
function buildGraph(facts: DbMemoryFact[], mentions: DbEntityMention[], w: number, h: number) {
  const nodeMap = new Map<string, GraphNode>();
  const mentionMap = new Map<string, number>();
  mentions.forEach(m => mentionMap.set(m.entity_text.toLowerCase(), m.mention_count));

  const cx = w / 2, cy = h / 2;

  const ensureNode = (label: string, factType: string) => {
    const key = label.toLowerCase();
    if (!nodeMap.has(key)) {
      const angle = Math.random() * Math.PI * 2;
      const dist  = 80 + Math.random() * 120;
      const mc    = mentionMap.get(key) ?? 1;
      nodeMap.set(key, {
        id: key, label,
        factType,
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        vx: 0, vy: 0,
        radius: Math.max(18, Math.min(38, 14 + mc * 3)),
        mentionCount: mc,
        pinned: false,
      });
    }
  };

  facts.forEach(f => {
    ensureNode(f.subject, f.fact_type);
    ensureNode(f.object,  f.fact_type);
  });

  const edges: GraphEdge[] = facts.map(f => ({
    id:         f.id,
    source:     f.subject.toLowerCase(),
    target:     f.object.toLowerCase(),
    predicate:  f.predicate,
    confidence: f.confidence,
    factId:     f.id,
    factType:   f.fact_type,
    confirmed:  f.is_confirmed,
  }));

  return { nodes: Array.from(nodeMap.values()), edges };
}

// ── Force simulation (single tick) ───────────────────────────────────────────
const REPULSION   = 4000;
const SPRING_LEN  = 160;
const SPRING_K    = 0.04;
const DAMPING     = 0.85;
const CENTER_K    = 0.015;

function tick(nodes: GraphNode[], edges: GraphEdge[], cx: number, cy: number) {
  // Repulsion
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      if (a.pinned && b.pinned) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d2 = dx * dx + dy * dy + 1;
      const f  = REPULSION / d2;
      const fx = (dx / Math.sqrt(d2)) * f;
      const fy = (dy / Math.sqrt(d2)) * f;
      if (!a.pinned) { a.vx -= fx; a.vy -= fy; }
      if (!b.pinned) { b.vx += fx; b.vy += fy; }
    }
  }

  // Spring attraction
  const nodeIdx = new Map(nodes.map((n, i) => [n.id, i]));
  edges.forEach(e => {
    const si = nodeIdx.get(e.source), ti = nodeIdx.get(e.target);
    if (si === undefined || ti === undefined) return;
    const a = nodes[si], b = nodes[ti];
    const dx = b.x - a.x, dy = b.y - a.y;
    const d  = Math.sqrt(dx * dx + dy * dy) + 0.01;
    const f  = (d - SPRING_LEN) * SPRING_K;
    const fx = (dx / d) * f, fy = (dy / d) * f;
    if (!a.pinned) { a.vx += fx; a.vy += fy; }
    if (!b.pinned) { b.vx -= fx; b.vy -= fy; }
  });

  // Center gravity + integrate
  nodes.forEach(n => {
    if (n.pinned) return;
    n.vx += (cx - n.x) * CENTER_K;
    n.vy += (cy - n.y) * CENTER_K;
    n.vx *= DAMPING; n.vy *= DAMPING;
    n.x += n.vx;     n.y += n.vy;
  });
}

// ── Main component ────────────────────────────────────────────────────────────
export default function MemoryGraph() {
  const [facts,    setFacts]    = useState<DbMemoryFact[]>([]);
  const [mentions, setMentions] = useState<DbEntityMention[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [nodes,    setNodes]    = useState<GraphNode[]>([]);
  const [edges,    setEdges]    = useState<GraphEdge[]>([]);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [zoom, setZoom]         = useState(1);
  const [pan,  setPan]          = useState({ x: 0, y: 0 });
  const [simRunning, setSimRunning] = useState(true);

  const svgRef    = useRef<SVGSVGElement>(null);
  const rafRef    = useRef<number>(0);
  const nodesRef  = useRef<GraphNode[]>([]);
  const edgesRef  = useRef<GraphEdge[]>([]);
  const dragRef   = useRef<{ nodeId: string; ox: number; oy: number } | null>(null);
  const panRef    = useRef<{ startX: number; startY: number; origPan: { x: number; y: number } } | null>(null);

  const svgW = 900, svgH = 560;
  const cx = svgW / 2, cy = svgH / 2;

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [f, m] = await Promise.all([
        fetchMemoryGraph(USER_ID).catch(() => [] as DbMemoryFact[]),
        fetchAllEntityMentions(USER_ID).catch(() => [] as DbEntityMention[]),
      ]);
      setFacts(f); setMentions(m);
      const g = buildGraph(f, m, svgW, svgH);
      nodesRef.current = g.nodes;
      edgesRef.current = g.edges;
      setNodes([...g.nodes]);
      setEdges([...g.edges]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // refresh on roger:refresh event
  useEffect(() => {
    const h = () => load();
    window.addEventListener('roger:refresh', h);
    return () => window.removeEventListener('roger:refresh', h);
  }, [load]);

  // ── Simulation loop ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!simRunning) return;
    let frameCount = 0;
    const animate = () => {
      frameCount++;
      tick(nodesRef.current, edgesRef.current, cx, cy);
      if (frameCount % 2 === 0) setNodes([...nodesRef.current]);
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [simRunning, cx, cy]);

  // ── Drag node ─────────────────────────────────────────────────────────────
  const toSVGCoords = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: ((clientX - rect.left) / zoom - pan.x),
      y: ((clientY - rect.top)  / zoom - pan.y),
    };
  };

  const onNodePointerDown = (e: React.PointerEvent, n: GraphNode) => {
    e.stopPropagation();
    const { x, y } = toSVGCoords(e.clientX, e.clientY);
    dragRef.current = { nodeId: n.id, ox: x - n.x, oy: y - n.y };
    n.pinned = true;
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const onSVGPointerMove = (e: React.PointerEvent) => {
    if (dragRef.current) {
      const { x, y } = toSVGCoords(e.clientX, e.clientY);
      const node = nodesRef.current.find(n => n.id === dragRef.current!.nodeId);
      if (node) { node.x = x - dragRef.current.ox; node.y = y - dragRef.current.oy; node.vx = 0; node.vy = 0; }
    }
    if (panRef.current) {
      const dx = e.clientX - panRef.current.startX;
      const dy = e.clientY - panRef.current.startY;
      setPan({ x: panRef.current.origPan.x + dx / zoom, y: panRef.current.origPan.y + dy / zoom });
    }
  };

  const onSVGPointerUp = (_e: React.PointerEvent) => {
    if (dragRef.current) {
      const node = nodesRef.current.find(n => n.id === dragRef.current!.nodeId);
      if (node) node.pinned = false;
      dragRef.current = null;
    }
    panRef.current = null;
  };

  const onSVGPointerDown = (e: React.PointerEvent) => {
    if (dragRef.current) return;
    panRef.current = { startX: e.clientX, startY: e.clientY, origPan: { ...pan } };
  };

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleConfirm = async (factId: string) => {
    await confirmMemoryFact(factId);
    setFacts(prev => prev.map(f => f.id === factId ? { ...f, is_confirmed: true } : f));
    setEdges(prev => prev.map(e => e.factId === factId ? { ...e, confirmed: true } : e));
  };

  const handleDelete = async (factId: string) => {
    await deleteMemoryFact(factId);
    setFacts(prev => prev.filter(f => f.id !== factId));
    edgesRef.current = edgesRef.current.filter(e => e.factId !== factId);
    setEdges([...edgesRef.current]);
    // Remove orphan nodes
    const used = new Set(edgesRef.current.flatMap(e => [e.source, e.target]));
    nodesRef.current = nodesRef.current.filter(n => used.has(n.id));
    setNodes([...nodesRef.current]);
  };

  // ── Filtered facts for sidebar ────────────────────────────────────────────
  const selectedFacts = selected
    ? facts.filter(f => f.subject.toLowerCase() === selected.id || f.object.toLowerCase() === selected.id)
    : [];

  const visibleEdges = typeFilter === 'all' ? edges : edges.filter(e => e.factType === typeFilter);
  const visibleNodeIds = new Set(visibleEdges.flatMap(e => [e.source, e.target]));
  const visibleNodes = typeFilter === 'all' ? nodes : nodes.filter(n => visibleNodeIds.has(n.id));

  const factTypes = ['all', ...Array.from(new Set(facts.map(f => f.fact_type)))];

  // ── Stats ─────────────────────────────────────────────────────────────────
  const confirmed = facts.filter(f => f.is_confirmed).length;

  if (loading) return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.2em' }}>
        Loading memory graph...
      </span>
    </div>
  );

  const isEmpty = facts.length === 0;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <Brain size={15} style={{ color: 'var(--amber)' }} />
        <div>
          <h1 style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: '0.18em', color: 'var(--amber)', textTransform: 'uppercase', margin: 0 }}>
            MEMORY GRAPH
          </h1>
          <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
            CONTEXT ENGINE / KNOWLEDGE NETWORK — {USER_ID}
          </p>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 16, marginLeft: 'auto', alignItems: 'center' }}>
          {[
            { label: 'NODES',     value: nodes.length },
            { label: 'EDGES',     value: edges.length },
            { label: 'CONFIRMED', value: confirmed },
            { label: 'ENTITIES',  value: mentions.length },
          ].map(s => (
            <div key={s.label} style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, color: 'var(--amber)' }}>{s.value}</div>
              <div style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', gap: 6, marginLeft: 16 }}>
          <button onClick={() => setZoom(z => Math.min(2, z + 0.15))} style={iconBtn}><ZoomIn size={12} /></button>
          <button onClick={() => setZoom(z => Math.max(0.4, z - 0.15))} style={iconBtn}><ZoomOut size={12} /></button>
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} style={iconBtn}><Maximize2 size={12} /></button>
          <button onClick={() => setSimRunning(r => !r)} style={{ ...iconBtn, color: simRunning ? 'var(--green)' : 'var(--text-muted)' }}>
            <span style={{ fontFamily: 'monospace', fontSize: 9 }}>{simRunning ? 'SIM●' : 'SIM○'}</span>
          </button>
          <button onClick={load} style={iconBtn}><RefreshCw size={12} /></button>
        </div>
      </div>

      {/* ── Type filter chips ── */}
      <div style={{ padding: '8px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 6, overflowX: 'auto', flexShrink: 0 }}>
        <Filter size={11} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 2 }} />
        {factTypes.map(t => {
          const col = t === 'all' ? 'var(--amber)' : typeColor(t);
          const active = typeFilter === t;
          return (
            <button key={t} onClick={() => setTypeFilter(t)} style={{
              flexShrink: 0, padding: '2px 10px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase',
              cursor: 'pointer', letterSpacing: '0.1em',
              border: `1px solid ${active ? col : 'var(--border-subtle)'}`,
              background: active ? `${col}18` : 'transparent',
              color: active ? col : 'var(--text-muted)',
            }}>{t}</button>
          );
        })}
      </div>

      {/* ── Main area ── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>

        {/* SVG Graph */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {isEmpty ? (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, opacity: 0.4 }}>
              <Brain size={48} style={{ color: 'var(--amber)' }} />
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.2em' }}>
                No memory facts yet — start talking to Roger
              </span>
            </div>
          ) : (
            <svg
              ref={svgRef}
              width="100%" height="100%"
              style={{ cursor: dragRef.current ? 'grabbing' : 'grab' }}
              onPointerMove={onSVGPointerMove}
              onPointerUp={onSVGPointerUp}
              onPointerDown={onSVGPointerDown}
            >
              <g transform={`scale(${zoom}) translate(${pan.x}, ${pan.y})`}>
                {/* Edge lines */}
                {visibleEdges.map(e => {
                  const src = nodesRef.current.find(n => n.id === e.source);
                  const tgt = nodesRef.current.find(n => n.id === e.target);
                  if (!src || !tgt) return null;
                  const col = typeColor(e.factType);
                  const mx  = (src.x + tgt.x) / 2, my = (src.y + tgt.y) / 2;
                  return (
                    <g key={e.id}>
                      <line
                        x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
                        stroke={col} strokeOpacity={e.confirmed ? 0.7 : 0.3}
                        strokeWidth={e.confirmed ? 1.5 : 1}
                        strokeDasharray={e.confirmed ? 'none' : '4 3'}
                      />
                      {/* Predicate label */}
                      <text x={mx} y={my - 4} textAnchor="middle"
                        style={{ fontFamily: 'monospace', fontSize: 8, fill: col, fillOpacity: 0.8, pointerEvents: 'none' }}>
                        {e.predicate.slice(0, 20)}
                      </text>
                    </g>
                  );
                })}

                {/* Nodes */}
                {visibleNodes.map(n => {
                  const col   = typeColor(n.factType);
                  const isSel = selected?.id === n.id;
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${n.x}, ${n.y})`}
                      style={{ cursor: 'pointer' }}
                      onPointerDown={e => onNodePointerDown(e, n)}
                      onClick={() => setSelected(isSel ? null : n)}
                    >
                      {/* Glow ring for selected */}
                      {isSel && (
                        <circle r={n.radius + 8} fill="none" stroke={col} strokeOpacity={0.35} strokeWidth={2} />
                      )}
                      <circle
                        r={n.radius}
                        fill={`${col}18`}
                        stroke={col}
                        strokeWidth={isSel ? 2 : 1}
                        strokeOpacity={isSel ? 1 : 0.7}
                      />
                      {/* Label */}
                      <text textAnchor="middle" dominantBaseline="middle"
                        style={{ fontFamily: 'monospace', fontSize: Math.max(8, Math.min(11, n.radius * 0.55)), fill: col, fillOpacity: 0.95, pointerEvents: 'none', fontWeight: isSel ? 700 : 400 }}>
                        {n.label.length > 12 ? n.label.slice(0, 11) + '…' : n.label}
                      </text>
                      {/* Mention count badge */}
                      {n.mentionCount > 1 && (
                        <text x={n.radius - 4} y={-n.radius + 4} textAnchor="middle"
                          style={{ fontFamily: 'monospace', fontSize: 7, fill: col, fillOpacity: 0.8, pointerEvents: 'none' }}>
                          {n.mentionCount}×
                        </text>
                      )}
                      {/* Type label below */}
                      <text y={n.radius + 11} textAnchor="middle"
                        style={{ fontFamily: 'monospace', fontSize: 7, fill: col, fillOpacity: 0.55, textTransform: 'uppercase', pointerEvents: 'none' }}>
                        {n.factType.slice(0, 6)}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          )}

          {/* Zoom indicator */}
          <div style={{ position: 'absolute', bottom: 12, left: 16, fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>
            {Math.round(zoom * 100)}% · drag to pan · scroll to zoom
          </div>
        </div>

        {/* ── Sidebar ── */}
        <div style={{ width: 280, borderLeft: '1px solid var(--border-subtle)', overflowY: 'auto', background: 'var(--bg-elevated)', flexShrink: 0 }}>
          {selected ? (
            <div style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: typeColor(selected.factType) }} />
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>{selected.label}</span>
                <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', marginLeft: 'auto', textTransform: 'uppercase' }}>
                  {selected.mentionCount}× mentions
                </span>
              </div>
              <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10 }}>
                {selectedFacts.length} FACTS
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {selectedFacts.map(f => {
                  const col = typeColor(f.fact_type);
                  return (
                    <div key={f.id} style={{ padding: '10px 12px', background: 'var(--bg-recessed)', border: `1px solid var(--border-subtle)`, borderLeft: `3px solid ${col}` }}>
                      <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)', margin: '0 0 4px', lineHeight: 1.45 }}>
                        <span style={{ color: 'var(--text-muted)' }}>{f.subject}</span>
                        {' '}<span style={{ color: col }}>{f.predicate}</span>{' '}
                        <strong style={{ color: 'var(--text-primary)' }}>{f.object}</strong>
                      </p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                        <div style={{ flex: 1, height: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 1 }}>
                          <div style={{ width: `${f.confidence}%`, height: '100%', background: col, borderRadius: 1 }} />
                        </div>
                        <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)' }}>{f.confidence}%</span>
                        {f.is_confirmed && <span style={{ fontFamily: 'monospace', fontSize: 8, color: '#10b981' }}>✓</span>}
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        {!f.is_confirmed && (
                          <button onClick={() => handleConfirm(f.id)} style={{ ...actionBtn, color: '#10b981', borderColor: 'rgba(16,185,129,0.3)' }}>
                            <CheckCircle size={10} /> CONFIRM
                          </button>
                        )}
                        <button onClick={() => handleDelete(f.id)} style={{ ...actionBtn, color: 'var(--rust)', borderColor: 'var(--rust-border)' }}>
                          <Trash2 size={10} /> DELETE
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{ padding: 20, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.4, gap: 8 }}>
              <Brain size={28} style={{ color: 'var(--amber)' }} />
              <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center' }}>
                Click a node to inspect its facts
              </span>
            </div>
          )}
        </div>
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
  padding: '3px 8px', fontFamily: 'monospace', fontSize: 9,
  textTransform: 'uppercase', cursor: 'pointer', background: 'transparent',
  border: '1px solid', letterSpacing: '0.08em',
};
