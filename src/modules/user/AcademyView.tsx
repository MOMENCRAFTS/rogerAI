/**
 * AcademyView.tsx — Roger Academy · Voice-First Language School
 *
 * A dialect-aware language tutoring interface powered by the existing PTT pipeline.
 * Users learn a target language via vocabulary, drills, and free conversation.
 *
 * Features:
 *   - Target language selector (filtered to exclude user's native language)
 *   - Today's Mission card with progress bar
 *   - Three mode cards: Vocab, Drill, Conversation
 *   - Recent words list with mastery indicators
 *   - Streak & accuracy stats
 */

import { useState, useEffect, useCallback } from 'react';
import { GraduationCap, BookOpen, Mic, MessageCircle, Target, Flame, TrendingUp, ChevronDown, RefreshCw, Star, Zap, Award } from 'lucide-react';
import { useI18n } from '../../context/I18nContext';
import { type Locale, getLocaleName, getLocaleFlag, ALL_LOCALES, getBaseLanguage } from '../../lib/i18n';
import { fetchAcademyStreak, fetchVocabWords, upsertAcademyStreak } from '../../lib/api';
import { triggerAcademyQuiz } from '../../lib/proactiveEngine';

// ── Types ────────────────────────────────────────────────────────────────────

interface AcademyStreak {
  target_locale: string;
  current_streak: number;
  longest_streak: number;
  last_session: string | null;
  total_sessions: number;
  total_words: number;
  accuracy_pct: number;
  streak_freezes: number;
}

interface VocabWord {
  word: string;
  translation: string;
  mastery: number; // 0-5
  last_drilled: string | null;
}

type AcademyMode = 'overview' | 'vocab' | 'drill' | 'conversation';

// Mastery level labels & colors
const MASTERY_LEVELS = [
  { label: 'New',            color: 'rgba(255,255,255,0.2)', icon: '●' },
  { label: 'Seen',           color: '#64748b',               icon: '◐' },
  { label: 'Practiced',      color: '#f59e0b',               icon: '◑' },
  { label: 'Drilled',        color: '#3b82f6',               icon: '◕' },
  { label: 'Conversational', color: '#8b5cf6',               icon: '◉' },
  { label: 'Mastered',       color: '#10b981',               icon: '★' },
];

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  userId: string;
}

export default function AcademyView({ userId }: Props) {
  const { t, locale } = useI18n();

  // State
  const [targetLocale, setTargetLocale] = useState<Locale>('fr-fr');
  const [streak, setStreak]             = useState<AcademyStreak | null>(null);
  const [words, setWords]               = useState<VocabWord[]>([]);
  const [loading, setLoading]           = useState(true);
  const [showPicker, setShowPicker]     = useState(false);
  const [mode, setMode]                 = useState<AcademyMode>('overview');
  const [showEntry, setShowEntry]       = useState(true);

  // Entry animation: show a pulse, then fade out after 3s
  useEffect(() => {
    const t = setTimeout(() => setShowEntry(false), 3500);
    return () => clearTimeout(t);
  }, []);

  // Available targets = all locales minus user's native base language
  const nativeBase = locale ? getBaseLanguage(locale) : 'en';
  const availableTargets = ALL_LOCALES.filter(l => getBaseLanguage(l) !== nativeBase);

  // ── Data fetching ────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch streak via API
      const streakData = await fetchAcademyStreak(userId);
      if (streakData) {
        setStreak(streakData as AcademyStreak);
        setTargetLocale(streakData.target_locale as Locale);
      }

      // Fetch vocab via API
      const vocabData = await fetchVocabWords(userId, streakData?.target_locale);
      if (vocabData.length > 0) {
        setWords(vocabData.map(v => ({
          word: v.word,
          translation: v.translation,
          mastery: v.mastery,
          last_drilled: null,
        })));

        // Schedule proactive quiz if user has words to practice
        const practiceWords = vocabData.filter(w => w.mastery >= 1 && w.mastery < 4);
        if (practiceWords.length > 0) {
          const quizWord = practiceWords[Math.floor(Math.random() * practiceWords.length)];
          const targetName = streakData?.target_locale ? getLocaleName(streakData.target_locale as Locale) : 'French';
          setTimeout(() => {
            triggerAcademyQuiz(quizWord.translation, targetName, streakData?.current_streak ?? 0);
          }, 60_000); // Trigger after 1 min idle
        }
      }
    } catch (err) {
      console.error('Academy load error:', err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { loadData(); }, [loadData]);
  // Refresh when returning to this tab
  useEffect(() => {
    const onRefresh = () => { loadData(); };
    window.addEventListener('roger:refresh', onRefresh);
    return () => window.removeEventListener('roger:refresh', onRefresh);
  }, [loadData]);

  // ── Target language change ───────────────────────────────────────────────

  const handleTargetChange = async (newTarget: Locale) => {
    setTargetLocale(newTarget);
    setShowPicker(false);

    // Upsert streak record via API
    await upsertAcademyStreak(userId, { target_locale: newTarget });
    loadData(); // Refresh vocab for new target
  };

  // ── Stats ────────────────────────────────────────────────────────────────

  const masteredCount  = words.filter(w => w.mastery >= 5).length;
  const inProgress     = words.filter(w => w.mastery >= 1 && w.mastery < 5).length;
  const newWords       = words.filter(w => w.mastery === 0).length;
  const totalWords     = streak?.total_words ?? words.length;
  const currentStreak  = streak?.current_streak ?? 0;
  const accuracy       = streak?.accuracy_pct ?? 0;
  const totalSessions  = streak?.total_sessions ?? 0;

  // Level calculation
  const level = totalWords < 25 ? 'Beginner'
    : totalWords < 100 ? 'Elementary'
    : totalWords < 300 ? 'Intermediate'
    : totalWords < 500 ? 'Upper Intermediate'
    : 'Advanced';

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 8 }}>
        <RefreshCw size={18} style={{ animation: 'spin 1s linear infinite' }} />
        <span style={{ opacity: 0.6 }}>Loading Academy…</span>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 12px 100px', maxWidth: 500, margin: '0 auto', position: 'relative' }}>
      {/* ── Entry "Speak" overlay ────────────────────────────────────── */}
      {showEntry && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 20, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 16,
          background: 'rgba(15,15,20,0.92)', borderRadius: 12,
          animation: 'fadeIn 0.4s ease-out',
          pointerEvents: 'none',
        }}>
          <div style={{
            width: 80, height: 80, borderRadius: '50%',
            border: '2px solid rgba(212,160,68,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'pulse 1.5s ease-in-out infinite',
          }}>
            <Mic size={32} color="rgba(212,160,68,0.9)" />
          </div>
          <span style={{ fontSize: 13, letterSpacing: 2, color: 'rgba(212,160,68,0.8)', textTransform: 'uppercase' }}>
            Hold PTT to begin
          </span>
          <span style={{ fontSize: 11, opacity: 0.4, maxWidth: 200, textAlign: 'center' }}>
            Say “Teach me a word”, “Quiz me”, or “Let’s practice conversation”
          </span>
        </div>
      )}
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <GraduationCap size={22} color="var(--amber)" />
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>ROGER ACADEMY</h2>
          <span style={{ fontSize: 11, opacity: 0.5 }}>Language Training · Voice-First</span>
        </div>
      </div>

      {/* ── Target Language Selector — Voice-First ────────────────────── */}
      <div style={{
        background: 'rgba(255,255,255,0.04)',
        borderRadius: 12,
        padding: '12px 14px',
        marginBottom: 16,
        border: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: 10, textTransform: 'uppercase', opacity: 0.4, letterSpacing: 1 }}>TARGET</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <span style={{ fontSize: 20 }}>{getLocaleFlag(targetLocale)}</span>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{getLocaleName(targetLocale)}</span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: 10, textTransform: 'uppercase', opacity: 0.4, letterSpacing: 1 }}>LEVEL</span>
            <div style={{ fontSize: 13, color: 'var(--amber)', fontWeight: 600, marginTop: 2 }}>{level} · {totalWords} words</div>
          </div>
        </div>

        {/* Voice-first change target */}
        <button
          onClick={() => setShowPicker(!showPicker)}
          style={{
            marginTop: 8, background: 'none', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8, padding: '6px 12px', color: 'inherit', cursor: 'pointer',
            fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, width: '100%', justifyContent: 'center',
          }}
        >
          Change Target <ChevronDown size={14} style={{ transform: showPicker ? 'rotate(180deg)' : 'none', transition: 'transform 200ms' }} />
        </button>

        {showPicker && (
          <div style={{
            marginTop: 10, padding: '14px',
            background: 'rgba(212,160,68,0.04)',
            border: '1px solid rgba(212,160,68,0.15)',
            borderRadius: 10,
          }}>
            {/* PTT hint */}
            <div style={{ textAlign: 'center', marginBottom: 12 }}>
              <Mic size={22} color="var(--amber)" style={{ marginBottom: 4 }} />
              <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: 0.5 }}>
                "Roger, I want to learn {availableTargets.length > 0 ? getLocaleName(availableTargets[0]) : 'a language'}"
              </div>
              <div style={{ fontSize: 10, opacity: 0.4, marginTop: 4 }}>
                Use PTT on the Home tab to tell Roger which language to study
              </div>
            </div>

            {/* Divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0' }}>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
              <span style={{ fontSize: 9, opacity: 0.3, textTransform: 'uppercase', letterSpacing: 1 }}>or tap</span>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
            </div>

            {/* Fallback scrollable list — compact, single column */}
            <div style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {availableTargets.map(l => (
                <button
                  key={l}
                  onClick={() => handleTargetChange(l)}
                  style={{
                    background: l === targetLocale ? 'rgba(212,160,68,0.15)' : 'transparent',
                    border: l === targetLocale ? '1px solid var(--amber)' : '1px solid rgba(255,255,255,0.04)',
                    borderRadius: 6, padding: '6px 10px', cursor: 'pointer', color: 'inherit',
                    display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
                    transition: 'all 200ms', width: '100%', textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 16 }}>{getLocaleFlag(l)}</span>
                  <span style={{ flex: 1 }}>{getLocaleName(l)}</span>
                  {l === targetLocale && <span style={{ fontSize: 10, color: 'var(--amber)' }}>✓ ACTIVE</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Today's Mission ──────────────────────────────────────────── */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(212,160,68,0.12) 0%, rgba(212,160,68,0.04) 100%)',
        borderRadius: 14,
        padding: '16px 14px',
        marginBottom: 16,
        border: '1px solid rgba(212,160,68,0.15)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Target size={16} color="var(--amber)" />
          <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
            TODAY'S MISSION
          </span>
        </div>
        <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 10 }}>
          3 words · 1 drill · 1 conversation
        </div>
        <div style={{
          height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, marginBottom: 10, overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            width: `${Math.min(100, (totalSessions % 5) * 20)}%`,
            background: 'var(--amber)',
            borderRadius: 2,
            transition: 'width 600ms ease',
          }} />
        </div>
        <div style={{ fontSize: 11, opacity: 0.4 }}>
          {totalSessions % 5}/5 complete today
        </div>
      </div>

      {/* ── Mode Cards ───────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
        {/* Vocab Card */}
        <button
          onClick={() => setMode(mode === 'vocab' ? 'overview' : 'vocab')}
          style={{
            background: mode === 'vocab' ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.04)',
            border: mode === 'vocab' ? '1px solid #f59e0b' : '1px solid rgba(255,255,255,0.06)',
            borderRadius: 12, padding: '14px 8px', cursor: 'pointer', color: 'inherit',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            transition: 'all 300ms ease',
          }}
        >
          <BookOpen size={20} color="#f59e0b" />
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>🔤 VOCAB</span>
          <span style={{ fontSize: 10, opacity: 0.5 }}>{totalWords}/200</span>
        </button>

        {/* Drill Card */}
        <button
          onClick={() => setMode(mode === 'drill' ? 'overview' : 'drill')}
          style={{
            background: mode === 'drill' ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.04)',
            border: mode === 'drill' ? '1px solid #3b82f6' : '1px solid rgba(255,255,255,0.06)',
            borderRadius: 12, padding: '14px 8px', cursor: 'pointer', color: 'inherit',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            transition: 'all 300ms ease',
          }}
        >
          <Mic size={20} color="#3b82f6" />
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>🎙 DRILL</span>
          <span style={{ fontSize: 10, opacity: 0.5 }}>Streak: {currentStreak}</span>
        </button>

        {/* Conversation Card */}
        <button
          onClick={() => setMode(mode === 'conversation' ? 'overview' : 'conversation')}
          style={{
            background: mode === 'conversation' ? 'rgba(139,92,246,0.15)' : 'rgba(255,255,255,0.04)',
            border: mode === 'conversation' ? '1px solid #8b5cf6' : '1px solid rgba(255,255,255,0.06)',
            borderRadius: 12, padding: '14px 8px', cursor: 'pointer', color: 'inherit',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            transition: 'all 300ms ease',
          }}
        >
          <MessageCircle size={20} color="#8b5cf6" />
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>💬 CONV</span>
          <span style={{ fontSize: 10, opacity: 0.5 }}>Level {Math.min(5, Math.floor(totalWords / 50) + 1)}</span>
        </button>
      </div>

      {/* ── Mode Active Hint ─────────────────────────────────────────── */}
      {mode !== 'overview' && (
        <div style={{
          background: 'rgba(16,185,129,0.08)',
          border: '1px solid rgba(16,185,129,0.2)',
          borderRadius: 10,
          padding: '12px 14px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          animation: 'fadeIn 300ms ease',
        }}>
          <Zap size={16} color="#10b981" />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {mode === 'vocab' ? '🔤 Vocabulary Mode Active' :
               mode === 'drill' ? '🎙 Drill Mode Active' :
               '💬 Conversation Mode Active'}
            </div>
            <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2 }}>
              Hold PTT on the Home tab to {mode === 'vocab' ? 'learn new words' : mode === 'drill' ? 'start a quiz' : 'practice conversation'}
            </div>
          </div>
        </div>
      )}

      {/* ── Recent Words ─────────────────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, opacity: 0.4, marginBottom: 10 }}>
          RECENT WORDS
        </h3>
        {words.length === 0 ? (
          <div style={{
            background: 'rgba(255,255,255,0.03)',
            borderRadius: 10,
            padding: '20px 14px',
            textAlign: 'center',
            opacity: 0.4,
            fontSize: 13,
          }}>
            No words yet — start a Vocab session via PTT
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {words.slice(0, 10).map((w, i) => {
              const m = MASTERY_LEVELS[Math.min(w.mastery, 5)];
              return (
                <div
                  key={i}
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    borderRadius: 8,
                    padding: '8px 12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderLeft: `3px solid ${m.color}`,
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{w.word}</span>
                    <span style={{ opacity: 0.4, fontSize: 12, marginLeft: 8 }}>({w.translation})</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, color: m.color }}>{m.icon}</span>
                    <span style={{ fontSize: 10, opacity: 0.4 }}>{m.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Stats Footer ─────────────────────────────────────────────── */}
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        borderRadius: 12,
        padding: '14px',
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 10,
        textAlign: 'center',
      }}>
        <div>
          <Flame size={16} color="#ef4444" style={{ marginBottom: 4 }} />
          <div style={{ fontSize: 18, fontWeight: 700 }}>{currentStreak}</div>
          <div style={{ fontSize: 10, opacity: 0.4 }}>Day Streak</div>
        </div>
        <div>
          <TrendingUp size={16} color="#10b981" style={{ marginBottom: 4 }} />
          <div style={{ fontSize: 18, fontWeight: 700 }}>{accuracy > 0 ? `${Math.round(accuracy)}%` : '—'}</div>
          <div style={{ fontSize: 10, opacity: 0.4 }}>Accuracy</div>
        </div>
        <div>
          <Star size={16} color="var(--amber)" style={{ marginBottom: 4 }} />
          <div style={{ fontSize: 18, fontWeight: 700 }}>{masteredCount}</div>
          <div style={{ fontSize: 10, opacity: 0.4 }}>Mastered</div>
        </div>
        <div>
          <Award size={16} color="#60a5fa" style={{ marginBottom: 4 }} />
          <div style={{ fontSize: 18, fontWeight: 700 }}>{streak?.streak_freezes ?? 0}</div>
          <div style={{ fontSize: 10, opacity: 0.4 }}>❄️ Freezes</div>
        </div>
      </div>

      {/* ── Word Distribution ─────────────────────────────────────────── */}
      {words.length > 0 && (
        <div style={{
          marginTop: 12,
          background: 'rgba(255,255,255,0.03)',
          borderRadius: 12,
          padding: '14px',
        }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, opacity: 0.4, marginBottom: 8 }}>
            WORD DISTRIBUTION
          </div>
          <div style={{ display: 'flex', gap: 4, height: 6, borderRadius: 3, overflow: 'hidden' }}>
            {masteredCount > 0 && <div style={{ flex: masteredCount, background: '#10b981', borderRadius: 3 }} />}
            {inProgress > 0 && <div style={{ flex: inProgress, background: '#3b82f6', borderRadius: 3 }} />}
            {newWords > 0 && <div style={{ flex: newWords, background: 'rgba(255,255,255,0.15)', borderRadius: 3 }} />}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            <span style={{ fontSize: 10, color: '#10b981' }}>✓ {masteredCount} mastered</span>
            <span style={{ fontSize: 10, color: '#3b82f6' }}>⚡ {inProgress} learning</span>
            <span style={{ fontSize: 10, opacity: 0.4 }}>● {newWords} new</span>
          </div>
        </div>
      )}

      {/* ── Earned Badges ─────────────────────────────────────────────── */}
      <div style={{ marginTop: 16, marginBottom: 20 }}>
        <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, opacity: 0.4, marginBottom: 10 }}>
          BADGES
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {[
            { day: 7,   title: '7-Day Warrior',    color: '#ef4444', image: '/badges/badge_7day_warrior.png' },
            { day: 14,  title: 'Dedicated',         color: '#f59e0b', image: '/badges/badge_dedicated_learner.png' },
            { day: 30,  title: 'Monthly Master',    color: '#d4a044', image: '/badges/badge_monthly_master.png' },
            { day: 60,  title: 'Diamond Scholar',   color: '#60a5fa', image: '/badges/badge_diamond_scholar.png' },
            { day: 100, title: 'Elite Commander',   color: '#8b5cf6', image: '/badges/badge_elite_commander.png' },
            { day: 365, title: 'Supreme Linguist',  color: '#fbbf24', image: '/badges/badge_supreme_linguist.png' },
          ].map(badge => {
            const earned = currentStreak >= badge.day || (streak?.longest_streak ?? 0) >= badge.day;
            return (
              <div
                key={badge.day}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                  padding: '10px 6px 8px',
                  borderRadius: 12,
                  background: earned ? `${badge.color}10` : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${earned ? `${badge.color}30` : 'rgba(255,255,255,0.04)'}`,
                  opacity: earned ? 1 : 0.35,
                  transition: 'all 300ms',
                  position: 'relative',
                }}
              >
                <img
                  src={badge.image}
                  alt={badge.title}
                  style={{
                    width: earned ? 64 : 48,
                    height: earned ? 64 : 48,
                    objectFit: 'contain',
                    filter: earned ? `drop-shadow(0 0 10px ${badge.color}44)` : 'grayscale(1) brightness(0.4)',
                    transition: 'all 300ms',
                  }}
                />
                <span style={{
                  fontSize: 8, fontWeight: 700,
                  color: earned ? badge.color : 'rgba(255,255,255,0.3)',
                  textTransform: 'uppercase', letterSpacing: 0.5,
                  textAlign: 'center', lineHeight: 1.2,
                }}>
                  {badge.title}
                </span>
                <span style={{ fontSize: 7, opacity: earned ? 0.5 : 0.3, fontWeight: 600 }}>
                  {earned ? '✓ EARNED' : `🔒 ${badge.day}d`}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
