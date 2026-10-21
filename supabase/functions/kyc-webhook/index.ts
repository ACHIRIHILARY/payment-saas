// Sumsub webhook. Public endpoint (verify_jwt = false), authenticated by the
// X-Payload-Digest HMAC.
import { adminClient, must } from '../_shared/auth.ts'
import { toKycStatus, verifyWebhook, type SumsubEvent } from '../_shared/sumsub.ts'

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const raw = await req.text()
  if (!(await verifyWebhook(raw, req.headers.get('X-Payload-Digest')))) {
    return new Response('Bad signature', { status: 401 })
  }

  const event = JSON.parse(raw) as SumsubEvent
  const admin = adminClient()
  const externalId = event.correlationId ?? `${event.applicantId}:${event.type}:${event.createdAtMs ?? raw.length}`

  await admin
    .from('webhook_events')
    .upsert({ source: 'sumsub', external_id: externalId, payload: event }, { onConflict: 'source,external_id', ignoreDuplicates: true })

  const status = toKycStatus(event)
  if (!status) return new Response('ignored', { status: 200 })

  try {
    must(
      await admin.rpc('apply_kyc_result', {
        p_user: event.externalUserId,
        p_provider: 'sumsub',
        p_provider_ref: event.applicantId,
        p_status: status,
      }),
    )
    await admin.from('webhook_events').update({ processed_at: new Date().toISOString() })
      .eq('source', 'sumsub').eq('external_id', externalId)
    return new Response('ok', { status: 200 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('kyc-webhook', msg)
    await admin.from('webhook_events').update({ error: msg }).eq('source', 'sumsub').eq('external_id', externalId)
    return new Response('error', { status: 500 })
  }
})
