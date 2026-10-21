import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import QRCode from 'qrcode'
import { callFunction, formatAmount } from '@app/shared'
import { useDeposits, useProfile } from '../data'
import { StatusBadge } from '../components/StatusBadge'

interface Invoice {
  address: string
  checkoutLink: string
  expiresAt: string
}

// Only assets with a live deposit rail are listed.
const ASSETS = [{ code: 'BTC', name: 'Bitcoin', network: 'Bitcoin testnet' }]

export function Deposit() {
  const profile = useProfile()
  const deposits = useDeposits()
  const [asset, setAsset] = useState(ASSETS[0].code)
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!invoice) return setQr(null)
    QRCode.toDataURL(`bitcoin:${invoice.address}`, { margin: 1, width: 220 }).then(setQr)
  }, [invoice])

  if (profile.data && profile.data.kyc_status !== 'approved') {
    return (
      <section className="card text-center">
        <h1 className="text-xl font-semibold">Deposit</h1>
        <p className="muted mt-2 text-sm">Verify your identity before making your first deposit.</p>
        <Link to="/verify" className="btn-primary mt-4 inline-block">
          Verify identity
        </Link>
      </section>
    )
  }

  async function generate() {
    setBusy(true)
    setError(null)
    try {
      setInvoice(await callFunction<Invoice>('deposit-invoice', { asset }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const network = ASSETS.find((a) => a.code === asset)?.network

  return (
    <div className="flex flex-col gap-6">
      <section className="card">
        <h1 className="text-xl font-semibold">Deposit</h1>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="field">
            <span>Asset</span>
            <select
              className="rounded-lg border px-3 py-2.5"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
              value={asset}
              onChange={(e) => {
                setAsset(e.target.value)
                setInvoice(null)
              }}
            >
              {ASSETS.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.name} ({a.network})
                </option>
              ))}
            </select>
          </label>
          <button className="btn-primary" onClick={generate} disabled={busy}>
            {busy ? 'Generating…' : invoice ? 'New address' : 'Get deposit address'}
          </button>
        </div>
        {error && <p className="error mt-3">{error}</p>}

        {invoice && (
          <div className="mt-6 grid items-center gap-6 sm:grid-cols-[220px_1fr]">
            {qr && <img src={qr} alt="Deposit address QR code" className="rounded-lg bg-white p-2" />}
            <div className="flex min-w-0 flex-col gap-3">
              <p className="text-sm font-medium">Send only {asset} on {network} to:</p>
              <code className="break-all rounded-lg p-3 text-sm" style={{ background: 'var(--bg)' }}>
                {invoice.address}
              </code>
              <div className="flex flex-wrap gap-3">
                <button
                  className="btn-primary"
                  onClick={async () => {
                    await navigator.clipboard.writeText(invoice.address)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  }}
                >
                  {copied ? 'Copied' : 'Copy address'}
                </button>
                <a className="btn-link self-center" href={invoice.checkoutLink} target="_blank" rel="noreferrer">
                  Open payment page
                </a>
              </div>
              <p className="muted text-xs">
                Use this address within 24 hours (until {new Date(invoice.expiresAt).toLocaleString()}). Your balance
                is credited after network confirmations and a standard compliance check.
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="mb-2 font-semibold">Your deposits</h2>
        {deposits.data?.length ? (
          <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {deposits.data.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium tabular-nums">
                    {formatAmount(d.amount, d.asset_code)} {d.asset_code}
                  </p>
                  <p className="muted truncate text-xs">
                    {new Date(d.created_at).toLocaleString()} · {d.tx_hash.split('-')[0].slice(0, 16)}…
                  </p>
                </div>
                <StatusBadge status={d.status} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted py-4 text-sm">No deposits yet.</p>
        )}
      </section>
    </div>
  )
}
