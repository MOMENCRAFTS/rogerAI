// ─── Roger AI — News Intelligence ────────────────────────────────────────────
// Fetches real-time headlines from NewsAPI.org and formats them for voice/display.

const NEWS_API_KEY = import.meta.env.VITE_NEWS_API_KEY as string;

export interface NewsArticle {
  title:       string;
  source:      string;
  description: string | null;
  url:         string;
  publishedAt: string;
}

export interface NewsBrief {
  articles:  NewsArticle[];
  query:     string;
  category?: string;
  spokenBrief: string; // Ready for TTS — 3-5 headline summary
}

// Detect news category from transcript
function detectCategory(transcript: string): string | undefined {
  const t = transcript.toLowerCase();
  if (t.match(/tech|technology|ai|software|apple|google|microsoft/)) return 'technology';
  if (t.match(/business|market|stock|economy|finance|trading/))      return 'business';
  if (t.match(/sport|football|soccer|basketball|tennis|cricket/))    return 'sports';
  if (t.match(/health|medical|covid|hospital|medicine/))             return 'health';
  if (t.match(/science|space|nasa|climate|environment/))             return 'science';
  if (t.match(/entertain|movie|music|celebrity|film/))              return 'entertainment';
  return undefined;
}

// Extract keyword search from transcript
function extractQuery(transcript: string): string | undefined {
  const t = transcript.toLowerCase()
    .replace(/news|updates?|latest|headlines?|briefing|tell me|what's|what is|about|today|tonight|morning|any/gi, '')
    .replace(/\s+/g, ' ').trim();
  return t.length > 2 ? t : undefined;
}

export async function fetchNews(
  transcript: string,
  /** AI-extracted news category entity (e.g. 'technology', 'business') */
  aiCategory?: string,
  /** AI-extracted clean search query */
  aiQuery?: string,
): Promise<NewsBrief> {
  if (!NEWS_API_KEY) throw new Error('News API key not configured');

  // AI-powered: use LLM-extracted entities when available,
  // fall back to regex only if AI doesn't provide them
  const category = aiCategory ?? detectCategory(transcript);
  const keyword  = aiQuery ?? extractQuery(transcript);

  let url: string;

  if (keyword && keyword.length > 3 && !category) {
    // Keyword search
    url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(keyword)}&pageSize=5&sortBy=publishedAt&language=en&apiKey=${NEWS_API_KEY}`;
  } else {
    // Top headlines by category (default: general)
    const cat = category ? `&category=${category}` : '';
    url = `https://newsapi.org/v2/top-headlines?language=en${cat}&pageSize=5&apiKey=${NEWS_API_KEY}`;
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`NewsAPI error ${res.status}`);

  const data = await res.json() as {
    status: string;
    articles: { title: string; source: { name: string }; description: string | null; url: string; publishedAt: string }[];
  };

  if (data.status !== 'ok' || !data.articles?.length) {
    throw new Error('No articles returned');
  }

  const articles: NewsArticle[] = data.articles.slice(0, 5).map(a => ({
    title:       a.title,
    source:      a.source?.name ?? 'Unknown',
    description: a.description,
    url:         a.url,
    publishedAt: a.publishedAt,
  }));

  // Build spoken brief (3 headlines max for TTS brevity)
  const categoryLabel = category ? ` ${category}` : '';
  const headlines = articles.slice(0, 3).map((a, i) => `${i + 1}. ${a.title}`).join('. ');
  const spokenBrief = `Here are your top${categoryLabel} headlines. ${headlines}. Want me to go deeper on any of these?`;

  return {
    articles,
    query:    keyword ?? category ?? 'top headlines',
    category,
    spokenBrief,
  };
}
