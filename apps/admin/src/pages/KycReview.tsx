import { useKycQueue } from '../data'
import { useStaffAction } from '../useStaffAction'

export function KycReview() {
  const q = useKycQueue()
  const { run, busyId, error } = useStaffAction()

  return (
    <section className="card">
      <h1 className="text-xl font-semibold">KYC review</h1>
      <p className="muted mt-1 text-sm">
        Most decisions arrive automatically from the verification provider. Cases here are waiting on a manual
        decision. Check the applicant in the provider's dashboard before deciding.
      </p>
      {error && <p className="error mt-3">{error}</p>}
      {q.isLoading ? (
        <p className="muted mt-4">Loading…</p>
      ) : q.error ? (
        <p className="error mt-4">{(q.error as Error).message}</p>
      ) : !q.data?.list.length ? (
        <p className="muted mt-4">No pending cases.</p>
      ) : (
        <ul className="mt-4 divide-y" style={{ borderColor: 'var(--border)' }}>
          {q.data.list.map((k) => {
            const u = q.data.users.get(k.user_id)
            const busy = busyId === k.user_id
            return (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">{u?.full_name ?? 'Unnamed applicant'}</p>
                  <p className="muted text-xs">
                    {k.provider} applicant {k.provider_ref} · {u?.country ?? 'country unknown'} · since{' '}
                    {new Date(k.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    className="btn-primary"
                    disabled={busy}
                    onClick={() => void run(k.user_id, { action: 'review_kyc', userId: k.user_id, status: 'approved' })}
                  >
                    Approve
                  </button>
                  <button
                    className="btn-link"
                    disabled={busy}
                    onClick={() => {
                      if (confirm('Reject this applicant? They will not be able to deposit or withdraw.')) {
                        void run(k.user_id, { action: 'review_kyc', userId: k.user_id, status: 'rejected' })
                      }
                    }}
                  >
                    Reject
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
