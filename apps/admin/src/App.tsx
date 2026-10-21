import { useQuery } from '@tanstack/react-query'
import { MfaGate, SignIn, getSupabase, useAuth, type StaffRole } from '@app/shared'

// Staff console. Deploy separately from the user portal, behind an IP
// allow-list. Staff accounts are invited, never self-registered.
export default function App() {
  const { session, loading } = useAuth()
  if (loading) return <div className="auth-shell muted">Loading…</div>
  if (!session) return <SignIn title="Staff console" allowSignUp={false} />
  return (
    <MfaGate>
      <Console />
    </MfaGate>
  )
}

function useRoles() {
  return useQuery({
    queryKey: ['my-roles'],
    queryFn: async () => {
      const { data: auth } = await getSupabase().auth.getUser()
      const { data, error } = await getSupabase()
        .from('staff_roles')
        .select('role, tenant_id')
        .eq('user_id', auth.user?.id ?? '')
      if (error) throw new Error(error.message)
      return (data ?? []) as { role: StaffRole; tenant_id: string }[]
    },
  })
}

async function count(table: string, filter: (q: any) => any) {
  const { count, error } = await filter(getSupabase().from(table).select('*', { count: 'exact', head: true }))
  if (error) throw new Error(error.message)
  return count ?? 0
}

function useQueues(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: ['queues'],
    queryFn: async () => {
      const [kyc, withdrawals, navDrafts, shortfalls] = await Promise.all([
        count('kyc_cases', (q) => q.eq('status', 'pending')),
        count('withdrawals', (q) => q.in('status', ['requested', 'pending_approval'])),
        count('nav_reports', (q) => q.eq('status', 'draft')),
        count('reconciliation_runs', (q) => q.neq('status', 'ok').gte('run_at', new Date(Date.now() - 864e5).toISOString())),
      ])
      return { kyc, withdrawals, navDrafts, shortfalls }
    },
  })
}

const QUEUES: { key: 'kyc' | 'withdrawals' | 'navDrafts' | 'shortfalls'; title: string; roles: StaffRole[]; hint: string }[] = [
  { key: 'kyc', title: 'KYC cases to review', roles: ['compliance', 'admin'], hint: 'Phase 1' },
  { key: 'withdrawals', title: 'Withdrawals awaiting approval', roles: ['ops', 'admin'], hint: 'Phase 1 (two approvers)' },
  { key: 'navDrafts', title: 'NAV drafts to approve', roles: ['finance', 'admin'], hint: 'Phase 2 (four-eyes)' },
  { key: 'shortfalls', title: 'Reconciliation alerts (24h)', roles: ['finance', 'compliance', 'admin'], hint: 'Phase 3' },
]

function Console() {
  const { session, signOut } = useAuth()
  const roles = useRoles()
  const myRoles = new Set((roles.data ?? []).map((r) => r.role))
  const queues = useQueues(myRoles.size > 0)

  return (
    <div className="min-h-screen">
      <header className="hero">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <span className="text-lg font-bold">Staff Console</span>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden opacity-80 sm:inline">{session?.user.email}</span>
            <button className="rounded-lg bg-white/15 px-3 py-1.5 font-semibold" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
        {roles.isLoading ? (
          <p className="muted">Checking access…</p>
        ) : myRoles.size === 0 ? (
          <div className="card">
            <h1 className="text-xl font-semibold">No staff access</h1>
            <p className="muted mt-1 text-sm">
              This account has no staff role. Ask an admin to grant one; every grant is recorded in the audit log.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="muted">Your roles:</span>
              {[...myRoles].map((r) => (
                <span key={r} className="rounded-full px-3 py-1 font-semibold" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                  {r}
                </span>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {QUEUES.filter((q) => q.roles.some((r) => myRoles.has(r))).map((q) => (
                <div key={q.key} className="card">
                  <p className="muted text-sm">{q.title}</p>
                  <p className="mt-2 text-3xl font-bold tabular-nums">
                    {queues.isLoading ? '…' : queues.error ? '!' : queues.data?.[q.key]}
                  </p>
                  <p className="muted mt-2 text-xs">Workflow: {q.hint}</p>
                </div>
              ))}
            </div>
            {queues.error && <p className="error">{(queues.error as Error).message}</p>}
            <p className="muted text-xs">
              Staff can read the ledger but never write to it. Every balance change goes through audited Edge Functions.
            </p>
          </>
        )}
      </main>
    </div>
  )
}
