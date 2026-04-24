// ─── Roger AI — Notion Integration ────────────────────────────────────────────
// Syncs sessions, tasks, and notes to Notion via the notion-sync edge function.
// Uses per-user Internal Integration Token stored in user_preferences.

import { supabase } from './supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

export interface NotionPage {
  id:      string;
  url:     string;
  title:   string;
}

async function callNotionFn(action: string, payload: object): Promise<unknown> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Not authenticated');

  const res = await fetch(`${SUPABASE_URL}/functions/v1/notion-sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `Notion sync error ${res.status}`);
  }
  return res.json();
}

/** Push a task to the user's Notion tasks database. */
export async function pushTaskToNotion(userId: string, task: {
  title:     string;
  priority?: number;
  dueDate?:  string | null;
  tags?:     string[];
}): Promise<NotionPage | null> {
  try {
    const result = await callNotionFn('create_task', { userId, task }) as NotionPage;
    return result;
  } catch {
    return null;
  }
}

/** Push a meeting / Tune In session summary to Notion as a page. */
export async function pushSessionToNotion(userId: string, session: {
  title:        string;
  participants: string[];
  date:         string;
  notes:        string;
  flaggedItems: string[];
  duration?:    string;
}): Promise<NotionPage | null> {
  try {
    const result = await callNotionFn('create_page', { userId, session }) as NotionPage;
    return result;
  } catch {
    return null;
  }
}

/** Search Notion pages for a keyword. */
export async function searchNotion(userId: string, query: string): Promise<{ title: string; url: string }[]> {
  try {
    const result = await callNotionFn('search', { userId, query }) as { results: { title: string; url: string }[] };
    return result.results ?? [];
  } catch {
    return [];
  }
}
