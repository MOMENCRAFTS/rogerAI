/**
 * getAuthToken.ts — Secure session token retrieval
 *
 * Always resolves the live user JWT from the Supabase session.
 * Throws if the session is missing or expired — callers must never
 * fall back to the anon key for write operations.
 *
 * Usage:
 *   import { getAuthToken } from '../../lib/getAuthToken';
 *   const token = await getAuthToken();
 *   fetch(url, { headers: { Authorization: `Bearer ${token}` } });
 */

import { supabase } from './supabase';

/**
 * Returns the user's live access_token.
 * Throws an Error if no authenticated session exists.
 */
export async function getAuthToken(): Promise<string> {
  const { data: { session }, error } = await supabase.auth.getSession();

  if (error) {
    throw new Error(`Auth session error: ${error.message}`);
  }

  if (!session?.access_token) {
    throw new Error('Not authenticated — no active session found.');
  }

  return session.access_token;
}
