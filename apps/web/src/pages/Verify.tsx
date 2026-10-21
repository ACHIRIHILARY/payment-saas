import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import snsWebSdk from '@sumsub/websdk'
import { callFunction } from '@app/shared'
import { useProfile } from '../data'

const fetchToken = () => callFunction<{ token: string }>('kyc-start', {}).then((r) => r.token)

export function Verify() {
  const profile = useProfile()
  const container = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const status = profile.data?.kyc_status

  useEffect(() => {
    if (!container.current || status === 'approved' || status === undefined) return
    let sdk: { destroy: () => void } | undefined
    let cancelled = false
    fetchToken()
      .then((token) => {
        if (cancelled || !container.current) return
        const built = snsWebSdk
          .init(token, fetchToken)
          .withConf({ lang: navigator.language.slice(0, 2) || 'en' })
          .withOptions({ addViewportTag: false, adaptIframeHeight: true })
          .on('idCheck.onError', (e) => setError(String((e as { error?: unknown }).error ?? 'Verification error')))
          .build()
        built.launch(container.current)
        sdk = built
      })
      .catch((e: Error) => setError(e.message))
    return () => {
      cancelled = true
      sdk?.destroy()
    }
  }, [status])

  if (status === 'approved') {
    return (
      <section className="card text-center">
        <h1 className="text-xl font-semibold">You're verified</h1>
        <p className="muted mt-2 text-sm">You can now deposit and withdraw.</p>
        <Link to="/deposit" className="btn-primary mt-4 inline-block">
          Make a deposit
        </Link>
      </section>
    )
  }

  return (
    <section className="card">
      <h1 className="text-xl font-semibold">Verify your identity</h1>
      <p className="muted mt-1 text-sm">
        You'll need a government ID and your phone camera. It usually takes a few minutes. Your documents go straight
        to our verification partner and are not stored in this app.
      </p>
      {status === 'pending' && (
        <p className="mt-3 rounded-lg p-3 text-sm" style={{ background: 'var(--bg)' }}>
          Your documents are being reviewed. This page updates automatically when there's a decision.
        </p>
      )}
      {status === 'rejected' && (
        <p className="error mt-3">Verification was declined. Contact support if you think this is a mistake.</p>
      )}
      {error && <p className="error mt-3">{error}</p>}
      <div ref={container} className="mt-4 min-h-[400px]" />
    </section>
  )
}
