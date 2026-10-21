// Small HTTP helpers shared by every Edge Function.

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173,http://localhost:5174')
  .split(',')
  .map((s) => s.trim())

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

/** An error whose message is safe to show the caller. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

// Postgres RAISE EXCEPTION messages from our wallet functions are written for
// users ("Insufficient balance"), so they are passed through as 400s.
const USER_FACING_PG = /^(Insufficient balance|This address|Amount is below|Identity verification|Unknown withdrawal|Withdrawal is not|A second|You cannot|Only |This withdrawal|Withdrawal in status|Deposit is not|Review must|Not allowed)/

export function handler(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
    if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)
    try {
      return await fn(req)
    } catch (e) {
      if (e instanceof HttpError) return json(req, { error: e.message }, e.status)
      const msg = e instanceof Error ? e.message : String(e)
      if (USER_FACING_PG.test(msg)) return json(req, { error: msg }, 400)
      console.error(e)
      return json(req, { error: 'Internal error' }, 500)
    }
  }
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T
  } catch {
    throw new HttpError(400, 'Invalid JSON body')
  }
}

export function requireEnv(name: string): string {
  const v = Deno.env.get(name)
  if (!v) throw new Error(`Missing env var ${name}`)
  return v
}

/** Constant-time HMAC-SHA256 hex check. */
export async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
