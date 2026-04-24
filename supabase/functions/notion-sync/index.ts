// ─── Roger AI — Notion Sync Edge Function ────────────────────────────────────
// Creates pages and tasks in the user's Notion workspace.
// Uses per-user Internal Integration Token from user_preferences.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const NOTION_API = 'https://api.notion.com/v1';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  // Load user's Notion token + DB ID from preferences
  const { data: prefs } = await supabase
    .from('user_preferences')
    .select('notion_token, notion_db_id')
    .eq('user_id', user.id)
    .single();

  if (!prefs?.notion_token) {
    return new Response(JSON.stringify({ error: 'Notion not connected. Add your Integration Token in Settings.' }), {
      status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const notionHeaders = {
    'Authorization':  `Bearer ${prefs.notion_token}`,
    'Content-Type':   'application/json',
    'Notion-Version': '2022-06-28',
  };

  const body = await req.json() as { action: string; userId: string; task?: object; session?: object; query?: string };

  // ── Action: create_task ─────────────────────────────────────────────────────
  if (body.action === 'create_task') {
    const task = body.task as { title: string; priority?: number; dueDate?: string | null; tags?: string[] };
    if (!prefs.notion_db_id) {
      return new Response(JSON.stringify({ error: 'Notion database ID not set in Settings.' }), {
        status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const properties: Record<string, unknown> = {
      Name: { title: [{ text: { content: task.title } }] },
    };
    if (task.priority)  properties['Priority'] = { number: task.priority };
    if (task.dueDate)   properties['Due Date']  = { date: { start: task.dueDate } };
    if (task.tags?.length) properties['Tags'] = { multi_select: task.tags.map(t => ({ name: t })) };

    const res = await fetch(`${NOTION_API}/pages`, {
      method: 'POST',
      headers: notionHeaders,
      body: JSON.stringify({ parent: { database_id: prefs.notion_db_id }, properties }),
    });
    const data = await res.json() as { id: string; url: string; properties: { Name: { title: { plain_text: string }[] } } };
    return new Response(JSON.stringify({ id: data.id, url: data.url, title: task.title }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  // ── Action: create_page (session note) ──────────────────────────────────────
  if (body.action === 'create_page') {
    const session = body.session as { title: string; participants: string[]; date: string; notes: string; flaggedItems: string[]; duration?: string };
    const participants = session.participants.join(', ');

    const content = [
      { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '📋 Session Notes' } }] } },
      { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: session.notes || 'No notes captured.' } }] } },
    ];

    if (session.flaggedItems?.length) {
      content.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '⭐ Flagged Moments' } }] } } as typeof content[0]);
      session.flaggedItems.forEach(item => {
        content.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: item } }] } } as typeof content[0]);
      });
    }

    const properties: Record<string, unknown> = {
      title: { title: [{ text: { content: session.title } }] },
    };

    const res = await fetch(`${NOTION_API}/pages`, {
      method: 'POST',
      headers: notionHeaders,
      body: JSON.stringify({
        parent: { type: 'page_id', page_id: prefs.notion_db_id ?? undefined },
        properties,
        children: content,
      }),
    });
    const data = await res.json() as { id: string; url: string };
    return new Response(JSON.stringify({ id: data.id, url: data.url, title: session.title }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  // ── Action: search ────────────────────────────────────────────────────────
  if (body.action === 'search') {
    const query = body.query ?? '';
    const res = await fetch(`${NOTION_API}/search`, {
      method: 'POST',
      headers: notionHeaders,
      body: JSON.stringify({ query, page_size: 5 }),
    });
    const data = await res.json() as { results: { url: string; properties?: { title?: { title: { plain_text: string }[] }; Name?: { title: { plain_text: string }[] } } }[] };
    const results = data.results.map(r => ({
      title: r.properties?.title?.title?.[0]?.plain_text ?? r.properties?.Name?.title?.[0]?.plain_text ?? 'Untitled',
      url: r.url,
    }));
    return new Response(JSON.stringify({ results }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), {
    status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
});
