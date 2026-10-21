// POST { asset: "BTC" } -> { address, checkoutLink, expiresAt }
// Creates a BTCPay top-up invoice for the signed-in, KYC-approved user and
// records its address so the webhook can attribute incoming payments.
import { adminClient, getCaller, must } from '../_shared/auth.ts'
import { BTCPAY_ASSETS, createTopUpInvoice, getInvoicePayments } from '../_shared/btcpay.ts'
import { handler, HttpError, json, readJson } from '../_shared/http.ts'

Deno.serve(
  handler(async (req) => {
    const caller = await getCaller(req)
    const { asset } = await readJson<{ asset?: string }>(req)
    if (!asset || !BTCPAY_ASSETS[asset]) throw new HttpError(400, 'Unsupported asset')

    const admin = adminClient()
    const profile = must(
      await admin.from('profiles').select('kyc_status').eq('id', caller.userId).single(),
    ) as { kyc_status: string }
    if (profile.kyc_status !== 'approved') {
      throw new HttpError(403, 'Verify your identity before depositing')
    }

    const invoice = await createTopUpInvoice(asset, { userId: caller.userId, tenantId: caller.tenantId })
    const methods = await getInvoicePayments(invoice.id)
    const address = methods[0]?.destination
    if (!address) throw new Error(`BTCPay invoice ${invoice.id} has no destination`)

    must(
      await admin.from('deposit_addresses').insert({
        tenant_id: caller.tenantId,
        user_id: caller.userId,
        asset_code: asset,
        address,
        custodian_ref: invoice.id,
      }),
    )

    return json(req, {
      address,
      checkoutLink: invoice.checkoutLink,
      expiresAt: new Date(invoice.expirationTime * 1000).toISOString(),
    })
  }),
)
