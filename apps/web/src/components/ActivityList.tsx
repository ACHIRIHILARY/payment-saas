import { assetLabel, dec, formatAmount, type UserActivity } from '@app/shared'

const KIND_LABEL: Record<string, string> = {
  deposit: 'Deposit',
  subscribe: 'Invested',
  redeem: 'Redeemed',
  withdrawal: 'Withdrawal',
  withdrawal_reversal: 'Withdrawal returned',
  fee: 'Fee',
  correction: 'Correction',
}

export function ActivityList({ rows }: { rows: UserActivity[] }) {
  if (!rows.length) {
    return <p className="muted py-6 text-center text-sm">No activity yet. Your deposits will appear here.</p>
  }
  return (
    <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
      {rows.map((r) => {
        const amt = dec(r.amount)
        const { symbol, network } = assetLabel(r.asset_code)
        return (
          <li key={r.line_id} className="flex items-center justify-between gap-3 py-3" style={{ borderColor: 'var(--border)' }}>
            <div className="min-w-0">
              <p className="truncate font-medium">{KIND_LABEL[r.kind] ?? r.kind}</p>
              <p className="muted truncate text-xs">
                {new Date(r.created_at).toLocaleString()}
                {r.external_ref && <> · <span title={r.external_ref}>{r.external_ref.slice(0, 14)}…</span></>}
              </p>
            </div>
            <div className="text-right">
              <p className={`font-semibold tabular-nums ${amt.isNeg() ? 'negative' : 'positive'}`}>
                {formatAmount(amt, r.asset_code, true)} {symbol}
              </p>
              {network && <p className="muted text-xs">{network}</p>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
