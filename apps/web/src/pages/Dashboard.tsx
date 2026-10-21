import { Link } from 'react-router-dom'
import { assetLabel, dec, formatAmount } from '@app/shared'
import { useActivity, useBalances, useProfile, useStrategies } from '../data'
import { ActivityList } from '../components/ActivityList'

export function Dashboard() {
  const profile = useProfile()
  const balances = useBalances()
  const activity = useActivity(8)
  const strategies = useStrategies()

  const cash = (balances.data ?? []).filter((b) => b.type === 'user_cash')
  const units = (balances.data ?? []).filter((b) => b.type === 'user_units' && dec(b.balance).gt(0))

  return (
    <div className="flex flex-col gap-6">
      {profile.data && profile.data.kyc_status !== 'approved' && (
        <div className="card flex flex-wrap items-center justify-between gap-3" style={{ borderColor: '#f59e0b' }}>
          <div>
            <p className="font-semibold">Verify your identity to start depositing</p>
            <p className="muted text-sm">
              Status: {profile.data.kyc_status.replace('_', ' ')}. Identity checks are required by law for
              investment accounts.
            </p>
          </div>
          <button className="btn-primary" disabled title="KYC provider integration lands in Phase 1">
            Start verification
          </button>
        </div>
      )}

      <section className="hero rounded-2xl p-6">
        <p className="text-sm opacity-80">
          Hi{profile.data?.full_name ? `, ${profile.data.full_name}` : ''}. Your cash balances
        </p>
        {balances.isLoading ? (
          <p className="mt-3 opacity-80">Loading…</p>
        ) : cash.length === 0 ? (
          <p className="mt-3 text-3xl font-bold">0.00</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-x-10 gap-y-3">
            {cash.map((b) => {
              const { symbol, network } = assetLabel(b.asset_code)
              return (
                <div key={b.account_id}>
                  <p className="text-3xl font-bold tabular-nums">
                    {formatAmount(b.balance, b.asset_code)} <span className="text-lg font-semibold">{symbol}</span>
                  </p>
                  {network && <p className="text-xs opacity-75">{network}</p>}
                </div>
              )
            })}
          </div>
        )}
        <div className="mt-6 flex flex-wrap gap-2">
          {[
            ['Deposit', '/deposit'],
            ['Withdraw', '/withdraw'],
            ['Invest', '/invest'],
          ].map(([label, to]) => (
            <Link key={to} to={to} className="rounded-lg bg-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/25">
              {label}
            </Link>
          ))}
        </div>
        <p className="mt-4 text-xs opacity-70">
          Balances are calculated from your ledger history and update in real time.
        </p>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="card">
          <h2 className="mb-3 font-semibold">Your investments</h2>
          {units.length === 0 ? (
            <p className="muted text-sm">You haven't invested in a strategy yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {units.map((u) => {
                const s = strategies.data?.strategies.find((x) => x.id === u.strategy_id)
                const nav = strategies.data?.navs.find((n) => n.strategy_id === u.strategy_id)
                const value = nav ? dec(u.balance).mul(nav.nav_per_unit) : null
                return (
                  <li key={u.account_id} className="flex justify-between gap-3">
                    <div>
                      <p className="font-medium">{s?.name ?? 'Strategy'}</p>
                      <p className="muted text-xs">
                        {formatAmount(u.balance, u.asset_code)} units
                        {nav && <> · NAV {formatAmount(nav.nav_per_unit, 'U-')} on {nav.valuation_date}</>}
                      </p>
                    </div>
                    {value && s && (
                      <p className="font-semibold tabular-nums">
                        {formatAmount(value, s.base_asset)} {assetLabel(s.base_asset).symbol}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="font-semibold">Recent activity</h2>
            <Link to="/activity" className="btn-link">
              See all
            </Link>
          </div>
          {activity.error ? (
            <p className="error">{(activity.error as Error).message}</p>
          ) : (
            <ActivityList rows={activity.data ?? []} />
          )}
        </section>
      </div>

      <p className="muted text-center text-xs">
        Investing involves risk. The value of investments can fall as well as rise and returns are not guaranteed.
      </p>
    </div>
  )
}
