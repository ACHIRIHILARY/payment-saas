import Decimal from 'decimal.js'

// Amounts arrive from Postgres numeric(38,18) as strings. Never parse them into
// JS numbers for arithmetic; use Decimal end to end.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_DOWN })

export const dec = (v: string | number | null | undefined) => new Decimal(v ?? 0)

const DISPLAY_DECIMALS: Record<string, number> = {
  BTC: 8,
  'USDT-TRON': 2,
  'USDT-ETH': 2,
  'USDC-ETH': 2,
}

export function formatAmount(v: string | number | Decimal, assetCode: string, signed = false): string {
  const d = v instanceof Decimal ? v : dec(v)
  const places = DISPLAY_DECIMALS[assetCode] ?? (assetCode.startsWith('U-') ? 4 : 6)
  const [int, frac] = d.abs().toFixed(places).split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const sign = d.isNeg() ? '-' : signed && d.gt(0) ? '+' : ''
  return `${sign}${grouped}${frac ? `.${frac}` : ''}`
}

export function assetLabel(code: string): { symbol: string; network?: string } {
  const [symbol, network] = code.split('-')
  if (code.startsWith('U-')) return { symbol: 'units' }
  return { symbol, network }
}
