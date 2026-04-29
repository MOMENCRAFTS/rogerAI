// supabase/functions/admin-users/index.ts
// Admin-only endpoint — uses service-role key to bypass RLS on user_preferences.
// Returns either all user profiles (action=list) or per-user stats (action=stats).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')          ?? '';
const SERVICE_ROLE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY             = Deno.env.get('SUPABASE_ANON_KEY')     ?? '';

// Admin emails allowed to call this function (comma-separated env var)
const ADMIN_EMAILS = (Deno.env.get('ADMIN_EMAILS') ?? '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // ── Auth check: only verified admin emails may call this ──────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // Verify the caller's JWT using anon client (reads the user's email)
  const anonClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data: { user }, error: authErr } = await anonClient.auth.getUser(token);
  if (authErr || !user?.email) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // If ADMIN_EMAILS is configured, enforce it; otherwise allow any authenticated user
  // (useful during initial setup before ADMIN_EMAILS is set)
  if (ADMIN_EMAILS.length > 0 && !ADMIN_EMAILS.includes(user.email.toLowerCase())) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // ── Service-role client — bypasses ALL RLS ────────────────────────────────
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const body = await req.json() as { action: string; userId?: string };

    // ── action=list: return all user profiles ─────────────────────────────
    if (body.action === 'list') {
      const { data, error } = await db
        .from('user_preferences')
        .select('user_id, display_name, roger_mode, language, timezone, onboarding_complete, islamic_mode, tour_seen, updated_at')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      return new Response(JSON.stringify({ users: data ?? [] }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── action=stats: return per-user counts ──────────────────────────────
    if (body.action === 'stats' && body.userId) {
      const uid = body.userId;
      const [mem, rem, tsk, tx, conv] = await Promise.all([
        db.from('memories').select('id', { count: 'exact', head: true }).eq('user_id', uid),
        db.from('reminders').select('id', { count: 'exact', head: true }).eq('user_id', uid),
        db.from('tasks').select('id', { count: 'exact', head: true }).eq('user_id', uid),
        db.from('transmissions').select('id', { count: 'exact', head: true }).eq('user_id', uid),
        db.from('conversation_history').select('id', { count: 'exact', head: true }).eq('user_id', uid),
      ]);
      return new Response(JSON.stringify({
        memories:      mem.count  ?? 0,
        reminders:     rem.count  ?? 0,
        tasks:         tsk.count  ?? 0,
        transmissions: tx.count   ?? 0,
        conversations: conv.count ?? 0,
      }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
