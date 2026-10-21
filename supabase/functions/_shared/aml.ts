// Blockchain AML screening (Chainalysis KYT, TRM, Elliptic, ...).
//
// AML_PROVIDER=none passes everything and exists ONLY for testnet work. It
// refuses to run when APP_ENV=production, so a misconfigured production
// deploy fails closed instead of crediting unscreened funds.
export interface ScreenResult {
  ok: boolean
  provider: string
  risk?: string
  raw?: unknown
}

type Direction = 'inbound' | 'outbound'

export async function screen(
  direction: Direction,
  asset: string,
  address: string,
  txHash?: string,
): Promise<ScreenResult> {
  const provider = Deno.env.get('AML_PROVIDER') ?? 'none'
  switch (provider) {
    case 'none': {
      if (Deno.env.get('APP_ENV') === 'production') {
        throw new Error('AML_PROVIDER=none is not allowed in production')
      }
      return { ok: true, provider: 'none', risk: 'unscreened-testnet' }
    }
    case 'chainalysis':
      return await chainalysis(direction, asset, address, txHash)
    default:
      throw new Error(`Unknown AML_PROVIDER ${provider}`)
  }
}

// Chainalysis Address Screening API (sanctions). Swap for KYT transfer
// registration once you have a KYT contract.
async function chainalysis(_d: Direction, _asset: string, address: string, _tx?: string): Promise<ScreenResult> {
  const key = Deno.env.get('CHAINALYSIS_API_KEY')
  if (!key) throw new Error('CHAINALYSIS_API_KEY not set')
  const res = await fetch(`https://public.chainalysis.com/api/v1/address/${encodeURIComponent(address)}`, {
    headers: { 'X-API-Key': key, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Chainalysis ${res.status}`)
  const body = (await res.json()) as { identifications?: unknown[] }
  const flagged = (body.identifications ?? []).length > 0
  return { ok: !flagged, provider: 'chainalysis', risk: flagged ? 'sanctioned' : 'none', raw: body }
}
