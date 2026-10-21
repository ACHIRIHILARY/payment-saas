import { Link } from 'react-router-dom'
import type { StaffRole } from '@app/shared'
import { useQueueCounts } from '../data'

type Key = 'kyc' | 'withdrawals' | 'held' | 'navDrafts' | 'shortfalls'
const QUEUES: { key: Key; title: string; roles: StaffRole[]; to?: string; hint?: string }[] = [
  { key: 'withdrawals', title: 'Withdrawals needing action', roles: ['ops', 'admin'], to: '/withdrawals' },
  { key: 'kyc', title: 'KYC cases to review', roles: ['compliance', 'admin'], to: '/kyc' },
  { key: 'held', title: 'Held deposits', roles: ['compliance', 'admin'], to: '/deposits' },
  { key: 'navDrafts', title: 'NAV drafts to approve', roles: ['finance', 'admin'], hint: 'Phase 2' },
  { key: 'shortfalls', title: 'Reconciliation alerts (24h)', roles: ['finance', 'compliance', 'admin'], hint: 'Phase 3' },
]

export function Overview({ roles }: { roles: Set<StaffRole> }) {
  const counts = useQueueCounts(true)
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="muted">Your roles:</span>
        {[...roles].map((r) => (
          <span key={r} className="rounded-full px-3 py-1 font-semibold" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            {r}
          </span>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {QUEUES.filter((q) => q.roles.some((r) => roles.has(r))).map((q) => {
          const body = (
            <>
              <p className="muted text-sm">{q.title}</p>
              <p className="mt-2 text-3xl font-bold tabular-nums">
                {counts.isLoading ? '…' : counts.error ? '!' : counts.data?.[q.key]}
              </p>
              <p className="muted mt-2 text-xs">{q.to ? 'Open queue →' : `Workflow: ${q.hint}`}</p>
            </>
          )
          return q.to ? (
            <Link key={q.key} to={q.to} className="card block hover:border-[var(--brand)]">
              {body}
            </Link>
          ) : (
            <div key={q.key} className="card">
              {body}
            </div>
          )
        })}
      </div>
      {counts.error && <p className="error">{(counts.error as Error).message}</p>}
      <p className="muted text-xs">
        Staff can read the ledger but never write to it. Every balance change goes through audited Edge Functions.
      </p>
    </>
  )
}
