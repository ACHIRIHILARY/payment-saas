import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { must } from './auth.ts'
import { sendOnchain } from './btcpay.ts'

interface WithdrawalRow {
  id: string
  status: string
  amount: string
  asset_code: string
  address_id: string
}

/**
 * Pays out an approved withdrawal. The claim step flips approved -> broadcast
 * atomically, so two concurrent calls can never both send funds.
 */
export async function executePayout(admin: SupabaseClient, withdrawalId: string): Promise<WithdrawalRow> {
  const claimed = must(
    await admin.rpc('claim_withdrawal_for_payout', { p_withdrawal: withdrawalId }),
  ) as WithdrawalRow | null
  if (!claimed?.id) {
    // Not approved yet (needs another approver) or already claimed elsewhere.
    return must(await admin.from('withdrawals').select('*').eq('id', withdrawalId).single()) as WithdrawalRow
  }

  const address = must(
    await admin.from('withdrawal_addresses').select('address').eq('id', claimed.address_id).single(),
  ) as { address: string }

  if (claimed.asset_code !== 'BTC') {
    // Other assets need a custodian integration; leave for ops to handle.
    return must(
      await admin.rpc('fail_withdrawal', { p_withdrawal: withdrawalId, p_error: `No payout rail for ${claimed.asset_code}` }),
    ) as WithdrawalRow
  }

  let sent: { txid: string; fee?: string }
  try {
    sent = await sendOnchain(address.address, String(claimed.amount))
  } catch (e) {
    // Nothing left custody: mark failed so ops can retry or reject (refund).
    return must(
      await admin.rpc('fail_withdrawal', { p_withdrawal: withdrawalId, p_error: e instanceof Error ? e.message : String(e) }),
    ) as WithdrawalRow
  }

  // Funds are on their way. If settling the ledger errors now, the row stays in
  // 'broadcast' with the txid logged, and reconciliation will flag it.
  console.log(`payout ${withdrawalId} broadcast ${sent.txid}`)
  return must(
    await admin.rpc('settle_withdrawal', {
      p_withdrawal: withdrawalId,
      p_custodian_ref: sent.txid,
      p_tx_hash: sent.txid,
      p_network_fee: sent.fee ?? 0,
    }),
  ) as WithdrawalRow
}
