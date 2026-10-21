import { useState, type FormEvent } from 'react'
import { getSupabase, tenantSlug } from '../supabase'

// Passwordless sign-in: email -> 6-digit code. New emails are registered on
// first use and attached to the configured tenant.
export function SignIn({ title, allowSignUp = true }: { title: string; allowSignUp?: boolean }) {
  const supabase = getSupabase()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function sendCode(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: allowSignUp, data: { tenant: tenantSlug } },
    })
    setBusy(false)
    if (error) setError(error.message)
    else setStep('code')
  }

  async function verify(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' })
    setBusy(false)
    if (error) setError(error.message)
  }

  return (
    <div className="auth-shell">
      <form className="card auth-card" onSubmit={step === 'email' ? sendCode : verify}>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {step === 'email' ? (
          <>
            <p className="muted">Enter your email and we'll send you a one-time code.</p>
            <label className="field">
              <span>Email</span>
              <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
          </>
        ) : (
          <>
            <p className="muted">We sent a 6-digit code to <strong>{email}</strong>.</p>
            <label className="field">
              <span>Code</span>
              <input
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </label>
          </>
        )}
        {error && <p className="error">{error}</p>}
        <button className="btn-primary" disabled={busy}>
          {busy ? 'Please wait…' : step === 'email' ? 'Send code' : 'Verify'}
        </button>
        {step === 'code' && (
          <button type="button" className="btn-link" onClick={() => setStep('email')}>
            Use a different email
          </button>
        )}
      </form>
    </div>
  )
}
