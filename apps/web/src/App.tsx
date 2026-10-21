import { Navigate, Route, Routes } from 'react-router-dom'
import { MfaGate, SignIn, useAuth } from '@app/shared'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { Activity } from './pages/Activity'
import { ComingSoon } from './pages/ComingSoon'
import { Deposit } from './pages/Deposit'
import { Withdraw } from './pages/Withdraw'
import { Verify } from './pages/Verify'

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
          <Route path="deposit" element={<Deposit />} />
          <Route path="withdraw" element={<Withdraw />} />
          <Route path="verify" element={<Verify />} />
          <Route path="invest" element={<ComingSoon title="Invest" phase="Phase 2: strategies & NAV" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </MfaGate>
  )
}
