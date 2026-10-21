# Feature 02: Wallet flows (KYC, deposits, withdrawals)

*Written after the fact (2026-10-21), when the context folder was adopted. It records
what was built.*

## What

- SQL (migration `…000003_wallet_flows.sql`): `apply_kyc_result`, `review_kyc`,
  `record_deposit` (idempotent, AML/KYC holds), `resolve_held_deposit`,
  `request_withdrawal` (row lock + reserve), `approve_withdrawal` (one or two
  approvers via `withdrawal_limits`), `reject_withdrawal` (refund; also user cancel),
  `claim_withdrawal_for_payout`, `settle_withdrawal` (books miner fee),
  `fail_withdrawal`, `retry_withdrawal`.
- Edge Functions: `deposit-invoice`, `btcpay-webhook`, `kyc-start`, `kyc-webhook`,
  `withdrawal`, `staff-action`, plus `_shared` (http, auth, btcpay, sumsub, aml, payout).
- Portal pages: Verify (Sumsub WebSDK), Deposit (address + QR + history),
  Withdraw (address book with 24h cool-down, request, cancel).
- Console pages: Overview counts, Withdrawals queue, KYC review, Held deposits.
- `supabase/config.toml`, OTP email template, `supabase/functions/.env.example`.

## Why

Deposits and withdrawals are the core loop. Without them, strategies (Feature 03) have
nothing to invest.

## Acceptance

- [x] 33 PGlite tests pass (14 new: deposit lifecycle, duplicate webhook, holds,
      cool-down, minimums, single/dual approval, payout claim, refunds, retry,
      client calls denied, ledger zero-sum).
- [x] 6 Deno tests (HMAC vectors, BTCPay/Sumsub signatures, KYC mapping, AML fail-closed).
- [x] Edge Functions type-check. Both apps build.
- [ ] **Run against live testnet BTCPay + Sumsub sandbox** (unverified: API paths and
      payment-method ids follow the docs but haven't been exercised).
- [ ] Click through the new pages in the browser with a signed-in user.

## Deferred

- Assets other than BTC (USDT etc. need a custodian or BTCPay plugin). The UI lists BTC only.
- Production custodian (Fireblocks/BitGo) adapter. The BTCPay hot wallet is testnet only.
- Real AML provider contract (Chainalysis adapter is sanctions-API only).
- Removing addresses from the address book (`removed_at` exists, no UI yet).
- Admin UI to edit `withdrawal_limits` (SQL insert for now, see README).
