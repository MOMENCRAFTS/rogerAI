/**
 * SalahExtras.tsx — UmmahAPI-powered Islamic content cards
 *
 * Premium sections rendered below the core Salah view:
 *  1. Hijri Date Banner + Next Islamic Event
 *  2. Hadith of the Day
 *  3. Dua of the Day
 *  4. Name of Allah (Asma ul Husna)
 *
 * All data is fetched once per day and cached in localStorage.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { BookOpen, Heart, Star, Calendar, Volume2, VolumeX } from 'lucide-react';
import {
  fetchHadithOfDay, fetchDuaOfDay, fetchNameOfAllah,
  fetchHijriDate, fetchNextIslamicEvent,
  type HadithOfDay, type DuaOfDay, type NameOfAllah,
  type HijriDate, type IslamicEvent,
} from '../../lib/islamicApi';

const EMERALD     = '#10b981';
const EMERALD_DIM = 'rgba(16,185,129,0.08)';
const GOLD        = '#d4a044';
const GOLD_DIM    = 'rgba(212,160,68,0.08)';

// ── Hijri Date Banner ─────────────────────────────────────────────────────────

export function HijriBanner() {
  const [hijri, setHijri]   = useState<HijriDate | null>(null);
  const [event, setEvent]   = useState<IslamicEvent | null>(null);

  useEffect(() => {
    fetchHijriDate().then(setHijri).catch(() => {});
    fetchNextIslamicEvent().then(setEvent).catch(() => {});
  }, []);

  if (!hijri) return null;

  return (
    <div style={{
      margin: '0 16px 16px',
      padding: '14px 16px',
      background: 'linear-gradient(135deg, rgba(16,185,129,0.06) 0%, rgba(212,160,68,0.06) 100%)',
      border: `1px solid ${EMERALD}18`,
      position: 'relative',
      zIndex: 1,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
    }}>
      <Calendar size={16} color={EMERALD} style={{ flexShrink: 0, opacity: 0.7 }} />
      <div style={{ flex: 1 }}>
        <p style={{
          fontFamily: 'monospace', fontSize: 12, fontWeight: 700,
          color: 'var(--text-primary)', margin: '0 0 2px',
          letterSpacing: '0.04em',
        }}>
          {hijri.formatted}
        </p>
        <p style={{
          fontFamily: 'monospace', fontSize: 9,
          color: 'var(--text-muted)', margin: 0,
          letterSpacing: '0.1em', textTransform: 'uppercase',
        }}>
          {hijri.monthNameArabic} · {hijri.year} AH
        </p>
      </div>
      {event && (
        <div style={{
          padding: '4px 10px',
          background: `${GOLD_DIM}`,
          border: `1px solid ${GOLD}25`,
          display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
        }}>
          <span style={{
            fontFamily: 'monospace', fontSize: 8, color: GOLD,
            textTransform: 'uppercase', letterSpacing: '0.12em',
          }}>
            Next Event
          </span>
          <span style={{
            fontFamily: 'monospace', fontSize: 10, color: 'var(--text-secondary)',
            fontWeight: 600,
          }}>
            {event.name}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Verse Audio Player ────────────────────────────────────────────────────────

export function VerseAudioButton({ audioUrl }: { audioUrl?: string }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const toggle = useCallback(() => {
    if (!audioUrl) return;
    if (!audioRef.current) {
      audioRef.current = new Audio(audioUrl);
      audioRef.current.onended = () => setPlaying(false);
    }
    if (playing) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPlaying(false);
    } else {
      audioRef.current.play().catch(() => {});
      setPlaying(true);
    }
  }, [audioUrl, playing]);

  useEffect(() => {
    return () => { audioRef.current?.pause(); };
  }, []);

  if (!audioUrl) return null;

  return (
    <button
      onClick={toggle}
      title={playing ? 'Stop recitation' : 'Listen to recitation'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '5px 12px',
        fontFamily: 'monospace', fontSize: 9,
        textTransform: 'uppercase', letterSpacing: '0.1em',
        cursor: 'pointer',
        background: playing ? `${EMERALD}18` : 'transparent',
        border: `1px solid ${EMERALD}${playing ? '50' : '25'}`,
        color: EMERALD,
        transition: 'all 200ms ease',
      }}
    >
      {playing ? <VolumeX size={11} /> : <Volume2 size={11} />}
      {playing ? 'Stop' : 'Listen'}
    </button>
  );
}

// ── Hadith of the Day ─────────────────────────────────────────────────────────

export function HadithCard() {
  const [hadith, setHadith] = useState<HadithOfDay | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetchHadithOfDay().then(setHadith).catch(() => {});
  }, []);

  if (!hadith) return null;

  // Truncate long hadith text for initial display
  const maxLen = 280;
  const isLong = hadith.english.length > maxLen;
  const displayText = expanded || !isLong
    ? hadith.english
    : hadith.english.slice(0, maxLen) + '…';

  return (
    <div style={{ marginBottom: 20 }}>
      <SectionLabel icon={BookOpen} label="Hadith of the Day" />
      <div style={{
        background: EMERALD_DIM,
        border: `1px solid ${EMERALD}18`,
        padding: '18px 16px',
      }}>
        {/* Grade + Collection badges */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          <Badge text={hadith.grade} color={hadith.grade === 'Sahih' ? EMERALD : GOLD} />
          <Badge text={hadith.collection} color="var(--text-muted)" />
        </div>

        {/* English text */}
        <p style={{
          fontFamily: 'monospace', fontSize: 11,
          color: 'var(--text-secondary)', lineHeight: 1.7,
          margin: '0 0 8px',
        }}>
          "{displayText}"
        </p>

        {isLong && (
          <button
            onClick={() => setExpanded(e => !e)}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontFamily: 'monospace', fontSize: 9, color: EMERALD,
              padding: 0, textTransform: 'uppercase', letterSpacing: '0.1em',
            }}
          >
            {expanded ? '▲ Show less' : '▼ Read full hadith'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Dua of the Day ────────────────────────────────────────────────────────────

export function DuaCard() {
  const [dua, setDua] = useState<DuaOfDay | null>(null);

  useEffect(() => {
    fetchDuaOfDay().then(setDua).catch(() => {});
  }, []);

  if (!dua) return null;

  return (
    <div style={{ marginBottom: 20 }}>
      <SectionLabel icon={Heart} label="Dua of the Day" />
      <div style={{
        background: EMERALD_DIM,
        border: `1px solid ${EMERALD}18`,
        padding: '18px 16px',
      }}>
        {/* Category + Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Badge text={dua.category} color={EMERALD} />
          <span style={{
            fontFamily: 'monospace', fontSize: 10,
            color: 'var(--text-secondary)', fontWeight: 600,
          }}>
            {dua.title}
          </span>
        </div>

        {/* Arabic */}
        <p style={{
          fontFamily: 'serif', fontSize: 20,
          color: 'var(--text-primary)',
          direction: 'rtl', textAlign: 'right',
          lineHeight: 2.2, margin: '0 0 10px',
        }}>
          {dua.arabic}
        </p>

        {/* Transliteration */}
        <p style={{
          fontFamily: 'monospace', fontSize: 11,
          color: EMERALD, fontStyle: 'italic',
          lineHeight: 1.6, margin: '0 0 8px',
        }}>
          {dua.transliteration}
        </p>

        {/* Translation */}
        <p style={{
          fontFamily: 'monospace', fontSize: 11,
          color: 'var(--text-secondary)',
          lineHeight: 1.65, margin: '0 0 10px',
        }}>
          "{dua.translation}"
        </p>

        {/* Source */}
        <span style={{
          fontFamily: 'monospace', fontSize: 8,
          color: `${EMERALD}60`,
          textTransform: 'uppercase', letterSpacing: '0.12em',
          padding: '2px 8px',
          border: `1px solid ${EMERALD}18`,
        }}>
          {dua.source}
        </span>
      </div>
    </div>
  );
}

// ── Name of Allah (Asma ul Husna) ─────────────────────────────────────────────

export function AsmaUlHusnaCard() {
  const [name, setName] = useState<NameOfAllah | null>(null);

  useEffect(() => {
    fetchNameOfAllah().then(setName).catch(() => {});
  }, []);

  if (!name) return null;

  return (
    <div style={{ marginBottom: 20 }}>
      <SectionLabel icon={Star} label="Name of Allah" />
      <div style={{
        background: 'linear-gradient(135deg, rgba(16,185,129,0.06) 0%, rgba(212,160,68,0.04) 100%)',
        border: `1px solid ${EMERALD}18`,
        padding: '20px 16px',
        textAlign: 'center',
      }}>
        {/* Number badge */}
        <span style={{
          fontFamily: 'monospace', fontSize: 8,
          color: `${EMERALD}70`, letterSpacing: '0.15em',
          textTransform: 'uppercase',
        }}>
          {name.number} of 99
        </span>

        {/* Arabic name — large */}
        <p style={{
          fontFamily: 'serif', fontSize: 36,
          color: 'var(--text-primary)',
          margin: '8px 0 6px', lineHeight: 1.3,
        }}>
          {name.arabic}
        </p>

        {/* Transliteration */}
        <p style={{
          fontFamily: 'monospace', fontSize: 13,
          color: EMERALD, fontWeight: 600,
          margin: '0 0 4px', letterSpacing: '0.06em',
        }}>
          {name.transliteration}
        </p>

        {/* English name */}
        <p style={{
          fontFamily: 'monospace', fontSize: 11,
          color: 'var(--text-secondary)', fontWeight: 700,
          margin: '0 0 10px', textTransform: 'uppercase',
          letterSpacing: '0.15em',
        }}>
          {name.english}
        </p>

        {/* Meaning */}
        <p style={{
          fontFamily: 'monospace', fontSize: 10,
          color: 'var(--text-muted)',
          lineHeight: 1.6, margin: 0,
          maxWidth: 320, marginLeft: 'auto', marginRight: 'auto',
        }}>
          {name.meaning}
        </p>
      </div>
    </div>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function SectionLabel({ icon: Icon, label }: { icon: typeof BookOpen; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <Icon size={13} color={EMERALD} />
      <span style={{
        fontFamily: 'monospace', fontSize: 9,
        color: `${EMERALD}80`,
        textTransform: 'uppercase', letterSpacing: '0.2em',
      }}>
        {label}
      </span>
    </div>
  );
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span style={{
      fontFamily: 'monospace', fontSize: 8,
      color, letterSpacing: '0.1em',
      textTransform: 'uppercase',
      padding: '2px 8px',
      border: `1px solid ${color}30`,
      background: `${color}08`,
    }}>
      {text}
    </span>
  );
}
