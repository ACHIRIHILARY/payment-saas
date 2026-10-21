import { formatAmount } from '@app/shared'
import { useHeldDeposits } from '../data'
import { useStaffAction } from '../useStaffAction'

export function HeldDeposits() {
  const q = useHeldDeposits()
  const { run, busyId, error } = useStaffAction()

  function resolve(id: string, release: boolean) {
    const note = prompt(release ? 'Why is it safe to release? (kept in the audit trail)' : 'Reason for rejecting:')
    if (note?.trim()) void run(id, { action: 'resolve_deposit', depositId: id, release, note })
  }

  return (
    <section className="card overflow-x-auto">
      <h1 className="text-xl font-semibold">Held deposits</h1>
      <p className="muted mt-1 text-sm">
        Deposits flagged by AML screening, or sent by customers without approved KYC. Releasing credits the customer.
        Rejected funds must be returned to the sender outside the platform.
      </p>
      {error && <p className="error mt-3">{error}</p>}
      {q.isLoading ? (
        <p className="muted mt-4">Loading…</p>
      ) : q.error ? (
        <p className="error mt-4">{(q.error as Error).message}</p>
      ) : !q.data?.list.length ? (
        <p className="muted mt-4">No held deposits.</p>
      ) : (
        <table className="mt-4 w-full min-w-[700px] text-left text-sm">
          <thead className="muted text-xs uppercase">
            <tr>
              <th className="py-2">Received</th>
              <th>Customer</th>
              <th>Amount</th>
              <th>Reason</th>
              <th className="text-right">Decision</th>
            </tr>
          </thead>
          <tbody>
            {q.data.list.map((d) => {
              const u = q.data.users.get(d.user_id)
              const reason = (d.aml_result?.hold_reason as string) ?? (d.aml_result?.risk as string) ?? 'AML flag'
              return (
                <tr key={d.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  <td className="py-3">{new Date(d.created_at).toLocaleString()}</td>
                  <td>
                    {u?.full_name ?? 'Unnamed'}
                    <div className="muted text-xs">KYC {u?.kyc_status ?? '?'}</div>
                  </td>
                  <td className="tabular-nums">
                    {formatAmount(d.amount, d.asset_code)} {d.asset_code}
                    <div className="muted max-w-[180px] truncate text-xs">{d.tx_hash}</div>
                  </td>
                  <td>{reason}</td>
                  <td className="text-right">
                    <div className="flex justify-end gap-2">
                      <button className="btn-primary" disabled={busyId === d.id} onClick={() => resolve(d.id, true)}>
                        Release
                      </button>
                      <button className="btn-link" disabled={busyId === d.id} onClick={() => resolve(d.id, false)}>
                        Reject
                      </button>
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
