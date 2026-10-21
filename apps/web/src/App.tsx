import { Navigate, Route, Routes } from 'react-router-dom'
import { MfaGate, SignIn, useAuth } from '@app/shared'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { Activity } from './pages/Activity'
import { ComingSoon } from './pages/ComingSoon'

export default function App() {
  const { session, loading } = useAuth()
  if (loading) return <div className="auth-shell muted">Loading…</div>
  if (!session) return <SignIn title="Sign in to your portfolio" />

  return (
    <MfaGate>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="activity" element={<Activity />} />
          <Route path="deposit" element={<ComingSoon title="Deposit" phase="Phase 1: custodian deposit addresses" />} />
          <Route path="withdraw" element={<ComingSoon title="Withdraw" phase="Phase 1: whitelisted withdrawals" />} />
          <Route path="invest" element={<ComingSoon title="Invest" phase="Phase 2: strategies & NAV" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </MfaGate>
  )
}
