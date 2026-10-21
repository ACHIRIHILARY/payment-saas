import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { MfaGate, SignIn, useAuth } from '@app/shared'
import { useMe } from './data'
import { Overview } from './pages/Overview'
import { Withdrawals } from './pages/Withdrawals'
import { KycReview } from './pages/KycReview'
import { HeldDeposits } from './pages/HeldDeposits'

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

const TABS = [
  { to: '/', label: 'Overview', end: true },
  { to: '/withdrawals', label: 'Withdrawals' },
  { to: '/kyc', label: 'KYC review' },
  { to: '/deposits', label: 'Held deposits' },
]

function Console() {
  const { session, signOut } = useAuth()
  const me = useMe()
  const hasAccess = (me.data?.roles.size ?? 0) > 0

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
        {hasAccess && (
          <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4">
            {TABS.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-t-lg px-4 py-2 text-sm font-semibold ${
                    isActive ? 'bg-[var(--bg)] text-[var(--text)]' : 'text-white/80 hover:text-white'
                  }`
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
        {me.isLoading ? (
          <p className="muted">Checking access…</p>
        ) : !hasAccess ? (
          <div className="card">
            <h1 className="text-xl font-semibold">No staff access</h1>
            <p className="muted mt-1 text-sm">
              This account has no staff role. Ask an admin to grant one; every grant is recorded in the audit log.
            </p>
          </div>
        ) : (
          <Routes>
            <Route index element={<Overview roles={me.data!.roles} />} />
            <Route path="withdrawals" element={<Withdrawals me={me.data!.id} />} />
            <Route path="kyc" element={<KycReview />} />
            <Route path="deposits" element={<HeldDeposits />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>
    </div>
  )
}
