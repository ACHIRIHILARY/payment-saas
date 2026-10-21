// Sumsub identity verification. Docs: https://docs.sumsub.com/reference
//
// Env:
//   SUMSUB_APP_TOKEN, SUMSUB_SECRET_KEY   API credentials (use the sandbox pair while testing)
//   SUMSUB_LEVEL_NAME                     verification level, e.g. "basic-kyc-level"
//   SUMSUB_WEBHOOK_SECRET                 secret configured on the webhook
import { hmacSha256Hex, requireEnv, timingSafeEqual } from './http.ts'

const BASE = 'https://api.sumsub.com'

async function signedFetch(method: 'GET' | 'POST', path: string, body = ''): Promise<Response> {
  const ts = Math.floor(Date.now() / 1000).toString()
  const sig = await hmacSha256Hex(requireEnv('SUMSUB_SECRET_KEY'), ts + method + path + body)
  return fetch(BASE + path, {
    method,
    body: body || undefined,
    headers: {
      'X-App-Token': requireEnv('SUMSUB_APP_TOKEN'),
      'X-App-Access-Ts': ts,
      'X-App-Access-Sig': sig,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
}

/** Short-lived token for the Sumsub WebSDK. externalUserId = our auth user id. */
export async function sdkAccessToken(userId: string): Promise<string> {
  const level = requireEnv('SUMSUB_LEVEL_NAME')
  const path = `/resources/accessTokens?userId=${encodeURIComponent(userId)}&levelName=${encodeURIComponent(level)}&ttlInSecs=1200`
  const res = await signedFetch('POST', path)
  if (!res.ok) throw new Error(`Sumsub token ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return ((await res.json()) as { token: string }).token
}

export async function verifyWebhook(rawBody: string, digest: string | null): Promise<boolean> {
  if (!digest) return false
  const expected = await hmacSha256Hex(requireEnv('SUMSUB_WEBHOOK_SECRET'), rawBody)
  return timingSafeEqual(expected, digest.toLowerCase())
}

export interface SumsubEvent {
  type: string
  applicantId: string
  externalUserId: string
  reviewStatus?: string
  reviewResult?: { reviewAnswer?: 'GREEN' | 'RED'; reviewRejectType?: 'FINAL' | 'RETRY' }
  createdAtMs?: string
  correlationId?: string
}

/** Maps a Sumsub event to our KYC status, or null if it doesn't change anything. */
export function toKycStatus(e: SumsubEvent): 'pending' | 'approved' | 'rejected' | null {
  if (e.type === 'applicantPending' || e.type === 'applicantOnHold') return 'pending'
  if (e.type === 'applicantReviewed') {
    if (e.reviewResult?.reviewAnswer === 'GREEN') return 'approved'
    // RETRY = user may resubmit documents; keep them pending.
    return e.reviewResult?.reviewRejectType === 'FINAL' ? 'rejected' : 'pending'
  }
  return null
}
