// ─── Roger AI — Finnhub Finance Integration ───────────────────────────────────
// Provides live stock quotes, market news, and portfolio context injection.

const FINNHUB_KEY = import.meta.env.VITE_FINNHUB_API_KEY as string;
const BASE = 'https://finnhub.io/api/v1';

export interface StockQuote {
  ticker:      string;
  name?:       string;
  price:       number;
  change:      number;      // absolute
  changePct:   number;      // percent
  high:        number;
  low:         number;
  open:        number;
  prevClose:   number;
  timestamp:   number;
}

export interface MarketNewsItem {
  headline:  string;
  source:    string;
  url:       string;
  summary:   string;
}

// ─── Ticker resolution — voice to symbol ──────────────────────────────────────
const KNOWN: Record<string, string> = {
  'apple':     'AAPL', 'tesla':   'TSLA', 'google':    'GOOGL', 'alphabet': 'GOOGL',
  'microsoft': 'MSFT', 'amazon':  'AMZN', 'meta':      'META',  'facebook': 'META',
  'nvidia':    'NVDA', 'netflix': 'NFLX', 'spotify':   'SPOT',  'coinbase': 'COIN',
  'uber':      'UBER', 'airbnb':  'ABNB', 'bitcoin':   'BTC',
  'aramco':    'ARMCO', 'starbucks': 'SBUX', 'disney':  'DIS',
};

/** Extract a stock ticker from natural voice text. */
export function detectTicker(transcript: string): string | null {
  const t = transcript.toLowerCase();
  for (const [word, sym] of Object.entries(KNOWN)) {
    if (t.includes(word)) return sym;
  }
  // Match explicit uppercase tickers: "What's AAPL doing?" or "$TSLA"
  const match = transcript.match(/\$?([A-Z]{1,5})\b/);
  return match?.[1] ?? null;
}

/** Fetch a live stock quote for a ticker symbol. */
export async function fetchQuote(ticker: string): Promise<StockQuote | null> {
  if (!FINNHUB_KEY) throw new Error('Finnhub API key not configured');
  try {
    const res = await fetch(`${BASE}/quote?symbol=${encodeURIComponent(ticker)}&token=${FINNHUB_KEY}`);
    if (!res.ok) return null;
    const d = await res.json() as { c: number; d: number; dp: number; h: number; l: number; o: number; pc: number; t: number };
    if (!d.c) return null;
    return {
      ticker,
      price:     Math.round(d.c * 100) / 100,
      change:    Math.round(d.d * 100) / 100,
      changePct: Math.round(d.dp * 100) / 100,
      high:      d.h,
      low:       d.l,
      open:      d.o,
      prevClose: d.pc,
      timestamp: d.t,
    };
  } catch {
    return null;
  }
}

/** Fetch top market news (general). */
export async function fetchMarketNews(): Promise<MarketNewsItem[]> {
  if (!FINNHUB_KEY) return [];
  try {
    const res = await fetch(`${BASE}/news?category=general&token=${FINNHUB_KEY}`);
    if (!res.ok) return [];
    const items = await res.json() as { headline: string; source: string; url: string; summary: string }[];
    return items.slice(0, 5).map(i => ({
      headline: i.headline, source: i.source, url: i.url, summary: i.summary,
    }));
  } catch {
    return [];
  }
}

/** Format a quote into a Roger spoken response string. */
export function quoteToSpeech(q: StockQuote): string {
  const dir   = q.changePct >= 0 ? 'up' : 'down';
  const arrow = q.changePct >= 0 ? '▲' : '▼';
  return `${q.ticker} is trading at $${q.price} — ${dir} ${Math.abs(q.changePct).toFixed(2)}% today ${arrow}. Day range: $${q.low}–$${q.high}. Over.`;
}

/** Format a quote for GPT-4o context injection. */
export function quoteToContext(q: StockQuote): string {
  const dir = q.changePct >= 0 ? '+' : '';
  return `${q.ticker}: $${q.price} (${dir}${q.changePct.toFixed(2)}% today) | H: $${q.high} L: $${q.low}`;
}

/** Summarise top movers for morning brief injection. */
export async function fetchMarketContext(tickers: string[] = ['AAPL', 'MSFT', 'NVDA']): Promise<string> {
  try {
    const quotes = await Promise.allSettled(tickers.map(fetchQuote));
    const valid  = quotes
      .filter((r): r is PromiseFulfilledResult<StockQuote> => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value);
    if (!valid.length) return '';
    return 'Market: ' + valid.map(quoteToContext).join(' | ');
  } catch {
    return '';
  }
}
