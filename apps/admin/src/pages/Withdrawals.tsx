import { formatAmount } from '@app/shared'
import { useWithdrawalQueue } from '../data'
import { useStaffAction } from '../useStaffAction'

const STATUS_TEXT: Record<string, string> = {
  pending_approval: 'Awaiting approval',
  approved: 'Approved, queued for payout',
  broadcast: 'Sending',
  failed: 'Payout failed',
}

export function Withdrawals({ me }: { me: string }) {
  const q = useWithdrawalQueue()
  const { run, busyId, error } = useStaffAction()

  return (
    <section className="card overflow-x-auto">
      <h1 className="text-xl font-semibold">Withdrawals</h1>
      <p className="muted mt-1 text-sm">
        Large withdrawals need two different approvers. Approving the final signature sends the payout immediately.
      </p>
      {error && <p className="error mt-3">{error}</p>}
      {q.isLoading ? (
        <p className="muted mt-4">Loading…</p>
      ) : q.error ? (
        <p className="error mt-4">{(q.error as Error).message}</p>
      ) : !q.data?.list.length ? (
        <p className="muted mt-4">Nothing to review.</p>
      ) : (
        <table className="mt-4 w-full min-w-[760px] text-left text-sm">
          <thead className="muted text-xs uppercase">
            <tr>
              <th className="py-2">Requested</th>
              <th>Customer</th>
              <th>Amount</th>
              <th>Destination</th>
              <th>Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {q.data.list.map((w) => {
              const user = q.data.users.get(w.user_id)
              const addr = q.data.addrs.get(w.address_id)
              const iApproved = w.approved_by_1 === me
              const busy = busyId === w.id
              return (
                <tr key={w.id} className="border-t align-top" style={{ borderColor: 'var(--border)' }}>
                  <td className="py-3">{new Date(w.created_at).toLocaleString()}</td>
                  <td>
                    {user?.full_name ?? 'Unnamed'}
                    <div className="muted text-xs">
                      {w.user_id.slice(0, 8)} · KYC {user?.kyc_status ?? '?'}
                    </div>
                  </td>
                  <td className="tabular-nums">
                    {formatAmount(w.amount, w.asset_code)} {w.asset_code}
                    <div className="muted text-xs">fee {formatAmount(w.platform_fee, w.asset_code)}</div>
                  </td>
                  <td className="max-w-[220px] break-all">
                    {addr?.address}
                    {addr?.label && <div className="muted text-xs">{addr.label}</div>}
                  </td>
                  <td>
                    {STATUS_TEXT[w.status] ?? w.status}
                    {w.approved_by_1 && w.status === 'pending_approval' && (
                      <div className="muted text-xs">1 of 2 approvals{iApproved ? ' (yours)' : ''}</div>
                    )}
                    {w.status === 'failed' && w.reject_reason && (
                      <div className="error text-xs">{w.reject_reason}</div>
                    )}
                  </td>
                  <td className="text-right">
                    <div className="flex justify-end gap-2">
                      {w.status === 'pending_approval' && (
                        <button
                          className="btn-primary"
                          disabled={busy || iApproved}
                          title={iApproved ? 'A different staff member must give the second approval' : ''}
                          onClick={() => void run(w.id, { action: 'approve_withdrawal', withdrawalId: w.id })}
                        >
                          {iApproved ? 'Waiting for 2nd' : 'Approve'}
                        </button>
                      )}
                      {w.status === 'failed' && (
                        <button
                          className="btn-primary"
                          disabled={busy}
                          onClick={() => void run(w.id, { action: 'retry_withdrawal', withdrawalId: w.id })}
                        >
                          Retry payout
                        </button>
                      )}
                      {['pending_approval', 'approved', 'failed'].includes(w.status) && (
                        <button
                          className="btn-link"
                          disabled={busy}
                          onClick={() => {
                            const reason = prompt('Reason for rejecting (shown to the customer):')
                            if (reason?.trim()) void run(w.id, { action: 'reject_withdrawal', withdrawalId: w.id, reason })
                          }}
                        >
                          Reject &amp; refund
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}
