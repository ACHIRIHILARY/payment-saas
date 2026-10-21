// Staff actions from the console (2FA session + staff role required). The SQL
// functions re-check roles and four-eyes rules; this layer only authenticates.
//   { action: "approve_withdrawal", withdrawalId }
//   { action: "reject_withdrawal",  withdrawalId, reason }
//   { action: "retry_withdrawal",   withdrawalId }
//   { action: "review_kyc",         userId, status: "approved" | "rejected" }
//   { action: "resolve_deposit",    depositId, release: boolean, note }
import { adminClient, callerRoles, getCaller, must } from '../_shared/auth.ts'
import { handler, HttpError, json, readJson } from '../_shared/http.ts'
import { executePayout } from '../_shared/payout.ts'

type Body =
  | { action: 'approve_withdrawal' | 'retry_withdrawal'; withdrawalId: string }
  | { action: 'reject_withdrawal'; withdrawalId: string; reason: string }
  | { action: 'review_kyc'; userId: string; status: 'approved' | 'rejected' }
  | { action: 'resolve_deposit'; depositId: string; release: boolean; note: string }

Deno.serve(
  handler(async (req) => {
    const caller = await getCaller(req)
    const admin = adminClient()
    if ((await callerRoles(admin, caller)).size === 0) throw new HttpError(403, 'Staff only')
    const body = await readJson<Body>(req)
    const staff = caller.userId

    switch (body.action) {
      case 'approve_withdrawal': {
        const w = must(await admin.rpc('approve_withdrawal', { p_staff: staff, p_withdrawal: body.withdrawalId })) as {
          id: string
          status: string
        }
        const result = w.status === 'approved' ? await executePayout(admin, w.id) : w
        return json(req, { withdrawal: result })
      }
      case 'retry_withdrawal': {
        must(await admin.rpc('retry_withdrawal', { p_staff: staff, p_withdrawal: body.withdrawalId }))
        return json(req, { withdrawal: await executePayout(admin, body.withdrawalId) })
      }
      case 'reject_withdrawal': {
        if (!body.reason?.trim()) throw new HttpError(400, 'A reason is required')
        const w = must(
          await admin.rpc('reject_withdrawal', { p_actor: staff, p_withdrawal: body.withdrawalId, p_reason: body.reason }),
        )
        return json(req, { withdrawal: w })
      }
      case 'review_kyc': {
        must(await admin.rpc('review_kyc', { p_staff: staff, p_user: body.userId, p_status: body.status }))
        return json(req, { ok: true })
      }
      case 'resolve_deposit': {
        if (!body.note?.trim()) throw new HttpError(400, 'A note is required')
        const d = must(
          await admin.rpc('resolve_held_deposit', {
            p_staff: staff,
            p_deposit: body.depositId,
            p_release: body.release,
            p_note: body.note,
          }),
        )
        return json(req, { deposit: d })
      }
      default:
        throw new HttpError(400, 'Unknown action')
    }
  }),
)
