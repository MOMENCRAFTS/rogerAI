import { CheckCircle2, Shield, Zap, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { DbTask } from '../../lib/api';

const mono = (size: number): React.CSSProperties => ({
  fontFamily: 'monospace', fontSize: size, textTransform: 'uppercase' as const,
  letterSpacing: '0.1em',
});

// ── Auto-Resolved Banner ────────────────────────────────────────────────────
export function AutoResolvedBanner({ tasks, onUndo }: { tasks: DbTask[]; onUndo: () => void }) {
  const [expanded, setExpanded] = useState(false);
  if (tasks.length === 0) return null;

  return (
    <div style={{
      marginBottom: 12, padding: '10px 14px',
      background: 'rgba(90,156,105,0.06)',
      border: '1px solid rgba(90,156,105,0.3)',
      borderLeft: '3px solid var(--green)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Zap size={12} style={{ color: 'var(--green)' }} />
        <span style={{ ...mono(10), color: 'var(--green)', flex: 1 }}>
          Roger handled {tasks.length} task{tasks.length > 1 ? 's' : ''}
        </span>
        <button onClick={() => setExpanded(e => !e)} style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--text-muted)', padding: 2,
        }}>
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        <button onClick={onUndo} style={{
          ...mono(8), padding: '3px 8px', background: 'transparent',
          border: '1px solid rgba(90,156,105,0.3)', color: 'var(--green)',
          cursor: 'pointer',
        }}>
          <RotateCcw size={8} style={{ marginRight: 3 }} />Undo
        </button>
      </div>
      {expanded && (
        <div style={{ marginTop: 8, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {tasks.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <CheckCircle2 size={10} style={{ color: 'var(--green)' }} />
              <span style={{ ...mono(9), color: 'var(--text-secondary)' }}>{t.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Confirmation Card ───────────────────────────────────────────────────────
export function ConfirmCard({ task, onApprove, onDismiss }: {
  task: DbTask; onApprove: (id: string) => void; onDismiss: (id: string) => void;
}) {
  return (
    <div style={{
      marginBottom: 8, padding: '12px 14px',
      background: 'rgba(212,160,68,0.06)',
      border: '1px solid rgba(212,160,68,0.25)',
      borderLeft: '3px solid var(--amber)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Zap size={10} style={{ color: 'var(--amber)' }} />
        <span style={{ ...mono(9), color: 'var(--amber)' }}>Roger wants to</span>
      </div>
      <p style={{ ...mono(12), color: 'var(--text-primary)', margin: '0 0 10px', lineHeight: 1.4, textTransform: 'none' as const, letterSpacing: 'normal' }}>
        {task.text}
      </p>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => onApprove(task.id)} style={{
          ...mono(10), padding: '6px 14px',
          background: 'rgba(90,156,105,0.1)', border: '1px solid var(--green-border)',
          color: 'var(--green)', cursor: 'pointer',
        }}>
          <CheckCircle2 size={10} style={{ marginRight: 4 }} />Approve
        </button>
        <button onClick={() => onDismiss(task.id)} style={{
          ...mono(10), padding: '6px 14px',
          background: 'transparent', border: '1px solid var(--border-subtle)',
          color: 'var(--text-muted)', cursor: 'pointer',
        }}>Not Now</button>
      </div>
    </div>
  );
}

// ── Setup-Blocked Card ──────────────────────────────────────────────────────
export function SetupBlockedCard({ service, count }: { service: string; count: number }) {
  return (
    <div style={{
      marginBottom: 8, padding: '12px 14px',
      background: 'rgba(168,72,50,0.06)',
      border: '1px solid rgba(168,72,50,0.25)',
      borderLeft: '3px solid var(--rust)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <Shield size={10} style={{ color: 'var(--rust)' }} />
        <span style={{ ...mono(9), color: 'var(--rust)' }}>Blocked — needs setup</span>
      </div>
      <p style={{ ...mono(11), color: 'var(--text-secondary)', margin: '0 0 10px', textTransform: 'none' as const, letterSpacing: 'normal' }}>
        Connect {service} to unlock {count} task{count > 1 ? 's' : ''}.
      </p>
      <button onClick={() => window.dispatchEvent(new CustomEvent('roger:navigate', { detail: 'settings' }))}
        style={{
          ...mono(9), padding: '6px 14px',
          background: 'rgba(212,160,68,0.08)', border: '1px solid var(--amber-border)',
          color: 'var(--amber)', cursor: 'pointer',
        }}>
        Connect {service}
      </button>
    </div>
  );
}
