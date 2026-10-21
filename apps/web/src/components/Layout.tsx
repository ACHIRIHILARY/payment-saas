import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '@app/shared'
import { useLiveLedger } from '../data'

const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/activity', label: 'Activity' },
  { to: '/deposit', label: 'Deposit' },
  { to: '/withdraw', label: 'Withdraw' },
  { to: '/invest', label: 'Invest' },
]

export function Layout() {
  const { session, signOut } = useAuth()
  useLiveLedger()

  return (
    <div className="min-h-screen">
      <header className="border-b" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <span className="text-lg font-bold" style={{ color: 'var(--brand)' }}>
            Yield Portal
          </span>
          <div className="flex items-center gap-3 text-sm">
            <span className="muted hidden sm:inline">{session?.user.email}</span>
            <button className="btn-link" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
                  isActive ? 'border-[var(--brand)] text-[var(--brand)]' : 'border-transparent muted'
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
