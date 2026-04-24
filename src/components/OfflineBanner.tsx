import { useState, useEffect } from 'react';
import { WifiOff } from 'lucide-react';

export default function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const on  = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online',  on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  if (!offline) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9998,
      background: 'rgba(212,160,68,0.95)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      padding: '7px 16px',
      backdropFilter: 'blur(8px)',
    }}>
      <WifiOff size={13} style={{ color: '#0a0a08', flexShrink: 0 }} />
      <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#0a0a08', textTransform: 'uppercase', letterSpacing: '0.2em', fontWeight: 700 }}>
        No signal — Roger offline
      </span>
    </div>
  );
}
