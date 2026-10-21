// User withdrawal actions (2FA session required).
//   POST { action: "request", addressId, amount }
//   POST { action: "cancel", withdrawalId }
import { adminClient, getCaller, must } from '../_shared/auth.ts'
import { screen } from '../_shared/aml.ts'
import { handler, HttpError, json, readJson } from '../_shared/http.ts'

type Body =
  | { action: 'request'; addressId: string; amount: string }
  | { action: 'cancel'; withdrawalId: string }

const AMOUNT = /^\d{1,20}(\.\d{1,18})?$/

Deno.serve(
  handler(async (req) => {
    const caller = await getCaller(req)
    const body = await readJson<Body>(req)
    const admin = adminClient()

    if (body.action === 'request') {
      if (!AMOUNT.test(String(body.amount))) throw new HttpError(400, 'Invalid amount')
      const addr = (
        await admin
          .from('withdrawal_addresses')
          .select('id, asset_code, address, screened_ok')
          .eq('id', body.addressId)
          .eq('user_id', caller.userId)
          .maybeSingle()
      ).data as { id: string; asset_code: string; address: string; screened_ok: boolean | null } | null
      if (!addr) throw new HttpError(404, 'Unknown withdrawal address')

      if (addr.screened_ok === null) {
        const result = await screen('outbound', addr.asset_code, addr.address)
        must(await admin.from('withdrawal_addresses').update({ screened_ok: result.ok }).eq('id', addr.id))
        if (!result.ok) throw new HttpError(400, 'This address failed screening and cannot be used')
      }

      const w = must(
        await admin.rpc('request_withdrawal', { p_user: caller.userId, p_address: addr.id, p_amount: body.amount }),
      )
      return json(req, { withdrawal: w })
    }

    if (body.action === 'cancel') {
      const w = must(
        await admin.rpc('reject_withdrawal', { p_actor: caller.userId, p_withdrawal: body.withdrawalId, p_reason: null }),
      )
      return json(req, { withdrawal: w })
    }

    throw new HttpError(400, 'Unknown action')
  }),
)
