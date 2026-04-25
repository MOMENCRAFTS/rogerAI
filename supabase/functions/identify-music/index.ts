// supabase/functions/identify-music/index.ts
// ACRCloud fingerprint-based music identification.
// Receives base64-encoded audio, returns track metadata.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const ACR_HOST   = Deno.env.get('ACRCLOUD_HOST')   ?? '';  // e.g. identify-eu-west-1.acrcloud.com
const ACR_KEY    = Deno.env.get('ACRCLOUD_KEY')    ?? '';
const ACR_SECRET = Deno.env.get('ACRCLOUD_SECRET') ?? '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/** Build HMAC-SHA1 signature for ACRCloud */
async function buildSignature(timestamp: number): Promise<string> {
  const stringToSign = `POST\n/v1/identify\n${ACR_KEY}\naudio\n1\n${timestamp}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(ACR_SECRET),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(stringToSign));
  // Base64 encode
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { audioBase64, mimeType = 'audio/webm' } = await req.json() as {
      audioBase64: string;
      mimeType?: string;
    };

    if (!ACR_HOST || !ACR_KEY || !ACR_SECRET) {
      return new Response(
        JSON.stringify({ identified: false, error: 'ACRCloud not configured' }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await buildSignature(timestamp);

    // Decode base64 → binary
    const binary = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));

    // Build multipart form
    const boundary = `----AcrBoundary${timestamp}`;
    const bodyParts: Uint8Array[] = [];

    const field = (name: string, value: string) =>
      new TextEncoder().encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      );

    bodyParts.push(field('access_key',        ACR_KEY));
    bodyParts.push(field('data_type',         'audio'));
    bodyParts.push(field('signature_version', '1'));
    bodyParts.push(field('signature',         signature));
    bodyParts.push(field('timestamp',         String(timestamp)));

    // Audio field
    bodyParts.push(new TextEncoder().encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="sample"; filename="audio.webm"\r\nContent-Type: ${mimeType}\r\n\r\n`
    ));
    bodyParts.push(binary);
    bodyParts.push(new TextEncoder().encode(`\r\n--${boundary}--\r\n`));

    const totalLen = bodyParts.reduce((s, b) => s + b.length, 0);
    const body = new Uint8Array(totalLen);
    let offset = 0;
    for (const part of bodyParts) { body.set(part, offset); offset += part.length; }

    const acrRes = await fetch(`https://${ACR_HOST}/v1/identify`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
    });

    if (!acrRes.ok) {
      return new Response(
        JSON.stringify({ identified: false, error: `ACRCloud HTTP ${acrRes.status}` }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    const result = await acrRes.json() as {
      status: { code: number; msg: string };
      metadata?: {
        music?: { title: string; artists: { name: string }[]; album?: { name: string }; genres?: { name: string }[] }[];
      };
    };

    if (result.status.code !== 0 || !result.metadata?.music?.length) {
      return new Response(
        JSON.stringify({ identified: false, status: result.status }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    const track = result.metadata.music[0];
    return new Response(JSON.stringify({
      identified: true,
      title:   track.title,
      artist:  track.artists.map(a => a.name).join(', '),
      album:   track.album?.name ?? null,
      genre:   track.genres?.[0]?.name ?? null,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch (e) {
    return new Response(
      JSON.stringify({ identified: false, error: String(e) }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});
