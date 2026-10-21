// npx deno@2 test --allow-env supabase/functions
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { hmacSha256Hex, timingSafeEqual } from './http.ts'
import { verifyWebhook as verifyBtcpay } from './btcpay.ts'
import { toKycStatus, verifyWebhook as verifySumsub } from './sumsub.ts'
import { screen } from './aml.ts'

Deno.test('hmacSha256Hex matches a known vector', async () => {
  // RFC 4231 test case 2
  assertEquals(
    await hmacSha256Hex('Jefe', 'what do ya want for nothing?'),
    '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
  )
})

Deno.test('timingSafeEqual', () => {
  assert(timingSafeEqual('abc', 'abc'))
  assert(!timingSafeEqual('abc', 'abd'))
  assert(!timingSafeEqual('abc', 'abcd'))
})

Deno.test('BTCPay signature: accepts valid, rejects tampered or missing', async () => {
  Deno.env.set('BTCPAY_WEBHOOK_SECRET', 'whsec')
  const body = '{"type":"InvoiceSettled","invoiceId":"inv1"}'
  const sig = `sha256=${await hmacSha256Hex('whsec', body)}`
  assert(await verifyBtcpay(body, sig))
  assert(!(await verifyBtcpay(body.replace('inv1', 'inv2'), sig)))
  assert(!(await verifyBtcpay(body, null)))
  assert(!(await verifyBtcpay(body, sig.replace('sha256=', ''))))
})

Deno.test('Sumsub signature', async () => {
  Deno.env.set('SUMSUB_WEBHOOK_SECRET', 'sumsec')
  const body = '{"type":"applicantReviewed"}'
  assert(await verifySumsub(body, await hmacSha256Hex('sumsec', body)))
  assert(!(await verifySumsub(body, 'deadbeef')))
})

Deno.test('Sumsub events map to KYC statuses', () => {
  const base = { applicantId: 'a', externalUserId: 'u' }
  assertEquals(toKycStatus({ ...base, type: 'applicantPending' }), 'pending')
  assertEquals(toKycStatus({ ...base, type: 'applicantReviewed', reviewResult: { reviewAnswer: 'GREEN' } }), 'approved')
  assertEquals(
    toKycStatus({ ...base, type: 'applicantReviewed', reviewResult: { reviewAnswer: 'RED', reviewRejectType: 'RETRY' } }),
    'pending',
  )
  assertEquals(
    toKycStatus({ ...base, type: 'applicantReviewed', reviewResult: { reviewAnswer: 'RED', reviewRejectType: 'FINAL' } }),
    'rejected',
  )
  assertEquals(toKycStatus({ ...base, type: 'applicantCreated' }), null)
})

Deno.test('AML "none" provider refuses to run in production', async () => {
  Deno.env.set('AML_PROVIDER', 'none')
  Deno.env.set('APP_ENV', 'development')
  assert((await screen('inbound', 'BTC', 'tb1qxyz')).ok)
  Deno.env.set('APP_ENV', 'production')
  let threw = false
  try {
    await screen('inbound', 'BTC', 'tb1qxyz')
  } catch {
    threw = true
  }
  assert(threw, 'expected AML none to throw in production')
})
