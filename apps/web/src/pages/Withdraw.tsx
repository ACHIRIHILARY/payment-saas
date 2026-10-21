import { useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { callFunction, dec, formatAmount, getSupabase, type Withdrawal } from '@app/shared'
import { useBalances, useWithdrawalAddresses, useWithdrawalLimits, useWithdrawals } from '../data'
import { StatusBadge } from '../components/StatusBadge'

const ASSETS = ['BTC']

export function Withdraw() {
  const qc = useQueryClient()
  const addresses = useWithdrawalAddresses()
  const limits = useWithdrawalLimits()
  const balances = useBalances()
  const withdrawals = useWithdrawals()

  const [addressId, setAddressId] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const usable = (addresses.data ?? []).filter((a) => new Date(a.usable_after) <= new Date() && a.screened_ok !== false)
  const selected = usable.find((a) => a.id === addressId) ?? usable[0]
  const asset = selected?.asset_code
  const limit = limits.data?.find((l) => l.asset_code === asset)
  const available = dec(balances.data?.find((b) => b.type === 'user_cash' && b.asset_code === asset)?.balance)
  const fee = dec(limit?.platform_fee)
  const total = useMemo(() => {
    try {
      return dec(amount || 0).add(fee)
    } catch {
      return null
    }
  }, [amount, fee])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!selected) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await callFunction('withdrawal', { action: 'request', addressId: selected.id, amount })
      setAmount('')
      setNotice('Withdrawal requested. Our team reviews every withdrawal before it is sent.')
      void qc.invalidateQueries()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function cancel(w: Withdrawal) {
    try {
      await callFunction('withdrawal', { action: 'cancel', withdrawalId: w.id })
      void qc.invalidateQueries()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const addrLabel = (id: string) => {
    const a = addresses.data?.find((x) => x.id === id)
    return a ? a.label || `${a.address.slice(0, 10)}…${a.address.slice(-6)}` : 'address'
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="card">
        <h1 className="text-xl font-semibold">Withdraw</h1>
        {usable.length === 0 ? (
          <p className="muted mt-2 text-sm">
            Add a withdrawal address below. For your security, new addresses can be used 24 hours after you add them.
          </p>
        ) : (
          <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
            <label className="field">
              <span>To address</span>
              <select
                className="rounded-lg border px-3 py-2.5"
                style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                value={selected?.id}
                onChange={(e) => setAddressId(e.target.value)}
              >
                {usable.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label ? `${a.label} · ` : ''}
                    {a.address} ({a.asset_code})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>
                Amount ({asset}) · available {formatAmount(available, asset ?? '')}
              </span>
              <input
                inputMode="decimal"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="0.00"
              />
            </label>
            <p className="muted text-sm">
              Fee {formatAmount(fee, asset ?? '')} {asset}
              {limit && dec(limit.min_amount).gt(0) && <> · minimum {formatAmount(limit.min_amount, asset ?? '')}</>}
              {total && <> · total deducted {formatAmount(total, asset ?? '')} {asset}</>}
            </p>
            {error && <p className="error">{error}</p>}
            {notice && <p className="positive text-sm">{notice}</p>}
            <button className="btn-primary self-start" disabled={busy || !amount || (total ? total.gt(available) : true)}>
              {busy ? 'Submitting…' : 'Request withdrawal'}
            </button>
          </form>
        )}
      </section>

      <AddressBook />

      <section className="card">
        <h2 className="mb-2 font-semibold">Your withdrawals</h2>
        {withdrawals.data?.length ? (
          <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {withdrawals.data.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium tabular-nums">
                    {formatAmount(w.amount, w.asset_code)} {w.asset_code}{' '}
                    <span className="muted text-sm font-normal">to {addrLabel(w.address_id)}</span>
                  </p>
                  <p className="muted truncate text-xs">
                    {new Date(w.created_at).toLocaleString()}
                    {w.tx_hash && <> · tx {w.tx_hash.slice(0, 16)}…</>}
                    {w.status === 'rejected' && w.reject_reason && <> · {w.reject_reason}</>}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={w.status} />
                  {w.status === 'pending_approval' && (
                    <button className="btn-link" onClick={() => void cancel(w)}>
                      Cancel
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted py-4 text-sm">No withdrawals yet.</p>
        )}
      </section>
    </div>
  )
}

function AddressBook() {
  const qc = useQueryClient()
  const addresses = useWithdrawalAddresses()
  const [asset, setAsset] = useState(ASSETS[0])
  const [address, setAddress] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function add(e: FormEvent) {
    e.preventDefault()
    setError(null)
    // Allowed directly by RLS; the 24h cool-down is a column default users can't set.
    const { error } = await getSupabase()
      .from('withdrawal_addresses')
      .insert({ asset_code: asset, address: address.trim(), label: label.trim() || null })
    if (error) return setError(error.message)
    setAddress('')
    setLabel('')
    void qc.invalidateQueries({ queryKey: ['withdrawal-addresses'] })
  }

  return (
    <section className="card">
      <h2 className="font-semibold">Withdrawal addresses</h2>
      <ul className="mt-2 flex flex-col gap-2">
        {(addresses.data ?? []).map((a) => {
          const ready = new Date(a.usable_after) <= new Date()
          return (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-0 break-all">
                <strong>{a.label ?? a.asset_code}</strong> <span className="muted">{a.address}</span>
              </span>
              <span className={a.screened_ok === false ? 'error' : 'muted'}>
                {a.screened_ok === false
                  ? 'blocked by screening'
                  : ready
                    ? 'ready'
                    : `usable from ${new Date(a.usable_after).toLocaleString()}`}
              </span>
            </li>
          )
        })}
      </ul>
      <form onSubmit={add} className="mt-4 grid gap-3 sm:grid-cols-[120px_1fr_160px_auto] sm:items-end">
        <label className="field">
          <span>Asset</span>
          <select
            className="rounded-lg border px-3 py-2.5"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
            value={asset}
            onChange={(e) => setAsset(e.target.value)}
          >
            {ASSETS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Address</span>
          <input required minLength={10} value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>
        <label className="field">
          <span>Label (optional)</span>
          <input maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <button className="btn-primary">Add</button>
      </form>
      {error && <p className="error mt-2">{error}</p>}
    </section>
  )
}
