# Progress Tracker

## Current Phase

Phase 1 code complete. Waiting on live-service verification before Feature 03.

## Current Goal

Get Feature 02 running end to end on testnet: a hosted (dev) Supabase project, BTCPay
testnet store, Sumsub sandbox. Then start Feature 03 (strategies and NAV).

## Completed

**Feature 01: Foundations** (commit `08964d2`). Migrations `…000001_foundation.sql`
and `…000002_operations.sql`. Ledger = `ledger_accounts` / `journal_entries` /
`ledger_lines` with `forbid_mutation` triggers and the deferred `ledger_check_journal`
balance trigger. `post_journal` / `ensure_ledger_account` are service-role only.
Sign-up trigger `handle_new_user` attaches users to a tenant from
`raw_user_meta_data.tenant`. A schema-wide REVOKE in migration 2 was wiping the
profiles column grant; it's now scoped to that migration's tables (found by a test).
`packages/shared` holds the Supabase client, `AuthProvider`, `SignIn` (email OTP) and
`MfaGate` (TOTP enrol/verify), plus `money.ts` with decimal.js. The portal dashboard
reads `user_balances` / `user_activity` with realtime invalidation. The console checks
`staff_roles`. Also: PGlite test harness, CI, README, `docs/ARCHITECTURE.md` and the
use case diagram (regenerate with `python scripts/gen-use-case-diagram.py docs/use-case-diagram.svg`).

**Feature 02: Wallet flows** (commit `7958b04`). See `feature-specs/02-wallet-flows.md`.
Key decisions:
- BTCPay top-up invoices act as deposit addresses (24h expiry; late payments are
  still credited because the webhook re-reads payments).
- The webhook never trusts body amounts.
- `record_deposit` treats `held` as terminal for automation.
- Withdrawals reserve amount + platform fee at request time.
- The miner fee is booked against `fees` on settle so custody reconciles.
- A failed payout → `failed` → retry or reject (refund).
- AML `none` throws in production.

Verified by 33 DB tests, 6 Deno tests, function type-check and app builds.
**Not yet verified against live services or clicked through in a browser.**

## In Progress

Nothing.

## Next Up

1. User setup (with hand-holding): dev Supabase project + MCP connector, BTCPay testnet
   store, Sumsub sandbox. Then apply migrations, deploy functions, set secrets, and do
   one real deposit and withdrawal.
2. Feature 03: strategies (subscribe/redeem at next NAV, holdings snapshots, NAV
   draft → four-eyes publish, NAV chart). **Spec not written yet**, by design.

## Open Questions

- Push to GitHub: remote `origin` exists, nothing pushed yet. Waiting for the user's go-ahead.
- Which production custodian to target first (Fireblocks vs BitGo vs Coinbase Prime)?
- Which stablecoin rail first for testnet (USDT on Tron via a custodian, or BTCPay plugin)?

## Architecture Decisions

- Fund-style NAV accounting, not fixed interest (fixed rate = lending licence).
- Balances derived from the ledger only. No balance columns.
- Money logic in plpgsql (atomic, testable in PGlite). Edge Functions only authenticate and orchestrate.
- Separate staff console deployment.
- PGlite for DB tests, so CI and local work don't need Docker.

## Session Notes

- 2026-10-21: Built Features 01–02 before adopting this context folder. The user then
  asked for the spec-driven approach, so the folder was created and specs 01/02 were
  written after the fact. During that work `npm run build` was used for checks. From
  now on, use the dev server during iteration and build only at feature end.
