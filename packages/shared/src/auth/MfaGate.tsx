import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { getSupabase } from '../supabase'
import { useAuth } from './AuthProvider'

// Blocks the app until the session is aal2. Users without a TOTP factor are
// walked through enrolment first. 2FA is mandatory on a money platform.
export function MfaGate({ children }: { children: ReactNode }) {
  const { currentLevel, nextLevel, refreshAal, signOut } = useAuth()
  if (currentLevel === 'aal2') return <>{children}</>
  return (
    <div className="auth-shell">
      <div className="card auth-card">
        {nextLevel === 'aal2' ? <Verify onDone={refreshAal} /> : <Enroll onDone={refreshAal} />}
        <button type="button" className="btn-link" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </div>
  )
}

function Enroll({ onDone }: { onDone: () => Promise<void> }) {
  const supabase = getSupabase()
  const [factorId, setFactorId] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Clear half-finished enrolments so the user can retry cleanly.
      const { data: factors } = await supabase.auth.mfa.listFactors()
      for (const f of factors?.all ?? []) {
        if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id })
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' })
      if (cancelled) return
      if (error) return setError(error.message)
      setFactorId(data.id)
      setQr(data.totp.qr_code)
      setSecret(data.totp.secret)
    })()
    return () => {
      cancelled = true
    }
  }, [supabase])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!factorId) return
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
    if (error) return setError(error.message)
    await onDone()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Set up two-factor authentication</h1>
      <p className="muted">
        Scan this QR code with Google Authenticator, Authy or 1Password, then enter the 6-digit code.
      </p>
      {qr ? <img src={qr} alt="TOTP QR code" className="mx-auto h-48 w-48 rounded-lg bg-white p-2" /> : <p>Loading…</p>}
      {secret && (
        <p className="text-center text-xs muted">
          Can't scan? Key: <code className="select-all">{secret}</code>
        </p>
      )}
      <CodeInput value={code} onChange={setCode} />
      {error && <p className="error">{error}</p>}
      <button className="btn-primary" disabled={!factorId || code.length !== 6}>
        Turn on 2FA
      </button>
    </form>
  )
}

function Verify({ onDone }: { onDone: () => Promise<void> }) {
  const supabase = getSupabase()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const { data: factors } = await supabase.auth.mfa.listFactors()
    const totp = factors?.totp.find((f) => f.status === 'verified')
    if (!totp) return setError('No authenticator found on this account.')
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: totp.id, code })
    if (error) return setError(error.message)
    await onDone()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Two-factor check</h1>
      <p className="muted">Enter the 6-digit code from your authenticator app.</p>
      <CodeInput value={code} onChange={setCode} />
      {error && <p className="error">{error}</p>}
      <button className="btn-primary" disabled={code.length !== 6}>
        Continue
      </button>
    </form>
  )
}

function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>Authenticator code</span>
      <input
        inputMode="numeric"
        maxLength={6}
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
      />
    </label>
  )
}
