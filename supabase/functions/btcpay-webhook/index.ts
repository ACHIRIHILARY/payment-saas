// BTCPay store webhook. Public endpoint (verify_jwt = false), authenticated by
// the BTCPay-Sig HMAC. On any invoice event we re-read the invoice's payments
// from BTCPay (never trusting amounts in the webhook body) and feed each one
// to record_deposit, which is idempotent.
import { adminClient, must } from '../_shared/auth.ts'
import { screen } from '../_shared/aml.ts'
import { getInvoicePayments, verifyWebhook } from '../_shared/btcpay.ts'

interface BtcpayEvent {
  deliveryId: string
  originalDeliveryId?: string
  type: string
  invoiceId?: string
  storeId: string
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const raw = await req.text()
  if (!(await verifyWebhook(raw, req.headers.get('BTCPay-Sig')))) {
    return new Response('Bad signature', { status: 401 })
  }

  const event = JSON.parse(raw) as BtcpayEvent
  const admin = adminClient()
  const externalId = event.originalDeliveryId ?? event.deliveryId

  // Store first: gives an audit trail and makes redeliveries cheap to spot.
  await admin
    .from('webhook_events')
    .upsert({ source: 'btcpay', external_id: externalId, payload: event }, { onConflict: 'source,external_id', ignoreDuplicates: true })

  if (!event.invoiceId || !event.type.startsWith('Invoice')) {
    return new Response('ignored', { status: 200 })
  }

  try {
    const addr = (
      await admin.from('deposit_addresses').select('id, asset_code').eq('custodian_ref', event.invoiceId).maybeSingle()
    ).data as { id: string; asset_code: string } | null
    if (!addr) throw new Error(`No deposit address for invoice ${event.invoiceId}`)

    const methods = await getInvoicePayments(event.invoiceId)
    for (const m of methods) {
      for (const p of m.payments) {
        if (p.status === 'Invalid') continue
        const settled = p.status === 'Settled'
        const txHash = p.id.split('-')[0]
        // Screen once funds are final; earlier calls just track confirmations.
        const aml = settled ? await screen('inbound', addr.asset_code, p.destination, txHash) : null
        must(
          await admin.rpc('record_deposit', {
            p_address_id: addr.id,
            p_payment_ref: p.id,
            p_tx_hash: txHash,
            p_amount: p.value,
            p_confirmations: settled ? 6 : 0,
            p_settled: settled,
            p_aml_ok: aml ? aml.ok : null,
            p_aml_result: aml ? { provider: aml.provider, risk: aml.risk } : null,
          }),
        )
      }
    }

    await admin.from('webhook_events').update({ processed_at: new Date().toISOString(), error: null })
      .eq('source', 'btcpay').eq('external_id', externalId)
    return new Response('ok', { status: 200 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('btcpay-webhook', msg)
    await admin.from('webhook_events').update({ error: msg }).eq('source', 'btcpay').eq('external_id', externalId)
    // Non-2xx makes BTCPay retry the delivery.
    return new Response('error', { status: 500 })
  }
})
