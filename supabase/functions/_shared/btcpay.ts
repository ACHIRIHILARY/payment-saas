// BTCPay Server Greenfield API client (testnet first, then mainnet).
// Docs: https://docs.btcpayserver.org/API/Greenfield/v1/
//
// Env:
//   BTCPAY_URL              e.g. https://testnet.your-btcpay.com
//   BTCPAY_API_KEY          store-scoped key: invoices + store wallet send
//   BTCPAY_STORE_ID
//   BTCPAY_WEBHOOK_SECRET   secret set on the store webhook
//   BTCPAY_PAYMENT_METHOD   default "BTC-CHAIN" (BTCPay 2.x); use "BTC" on 1.x
import { hmacSha256Hex, requireEnv, timingSafeEqual } from './http.ts'

const PM = () => Deno.env.get('BTCPAY_PAYMENT_METHOD') ?? 'BTC-CHAIN'

/** Our asset code -> BTCPay payment method. Add USDT etc. via BTCPay plugins later. */
export const BTCPAY_ASSETS: Record<string, { currency: string; paymentMethod: () => string }> = {
  BTC: { currency: 'BTC', paymentMethod: PM },
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = requireEnv('BTCPAY_URL').replace(/\/$/, '')
  const res = await fetch(`${base}/api/v1/stores/${requireEnv('BTCPAY_STORE_ID')}${path}`, {
    ...init,
    headers: {
      Authorization: `token ${requireEnv('BTCPAY_API_KEY')}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`BTCPay ${init.method ?? 'GET'} ${path} -> ${res.status}: ${text.slice(0, 300)}`)
  return (text ? JSON.parse(text) : null) as T
}

export interface BtcpayInvoice {
  id: string
  checkoutLink: string
  status: string
  expirationTime: number
  metadata?: Record<string, unknown>
}

export interface BtcpayPayment {
  id: string // "<txid>-<vout>"
  receivedDate: number
  value: string
  fee: string
  status: 'Invalid' | 'Processing' | 'Settled'
  destination: string
}

export interface BtcpayPaymentMethod {
  paymentMethodId?: string // 2.x
  paymentMethod?: string // 1.x
  destination: string
  payments: BtcpayPayment[]
}

/** Top-up invoice: no fixed amount, the user sends whatever they like. */
export function createTopUpInvoice(asset: string, meta: { userId: string; tenantId: string }) {
  const cfg = BTCPAY_ASSETS[asset]
  if (!cfg) throw new Error(`Asset ${asset} is not supported by BTCPay`)
  return api<BtcpayInvoice>('/invoices', {
    method: 'POST',
    body: JSON.stringify({
      currency: cfg.currency,
      metadata: { ...meta, asset, orderId: `dep-${meta.userId}-${Date.now()}` },
      checkout: { expirationMinutes: 24 * 60, paymentMethods: [cfg.paymentMethod()] },
    }),
  })
}

export const getInvoice = (invoiceId: string) => api<BtcpayInvoice>(`/invoices/${invoiceId}`)

export const getInvoicePayments = (invoiceId: string) =>
  api<BtcpayPaymentMethod[]>(`/invoices/${invoiceId}/payment-methods`)

/** Sends from the store's hot wallet. Testnet only; production uses a custodian. */
export async function sendOnchain(destination: string, amount: string): Promise<{ txid: string; fee?: string }> {
  const tx = await api<{ transactionHash: string; fee?: string }>(
    `/payment-methods/${PM()}/wallet/transactions`,
    {
      method: 'POST',
      body: JSON.stringify({
        destinations: [{ destination, amount, subtractFromAmount: false }],
        proceedWithBroadcast: true,
        rbf: true,
      }),
    },
  )
  return { txid: tx.transactionHash, fee: tx.fee }
}

/** BTCPay-Sig: sha256=<hex HMAC of raw body> */
export async function verifyWebhook(rawBody: string, sigHeader: string | null): Promise<boolean> {
  if (!sigHeader?.startsWith('sha256=')) return false
  const expected = await hmacSha256Hex(requireEnv('BTCPAY_WEBHOOK_SECRET'), rawBody)
  return timingSafeEqual(expected, sigHeader.slice('sha256='.length).toLowerCase())
}
