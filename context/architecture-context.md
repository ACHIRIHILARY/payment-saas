# Architecture Context

Full design: `docs/ARCHITECTURE.md` (flows, schema rationale, compliance) and
`docs/use-case-diagram.svg`. This file is the short version a session needs.

## Stack

| Layer | Choice |
|---|---|
| User portal | React 19 + Vite 8 + TypeScript, Tailwind v4 (`apps/web`) |
| Staff console | Same stack, separate deploy (`apps/admin`) |
| Shared client code | `packages/shared`: Supabase client, OTP/TOTP auth screens, money helpers, theme |
| Data fetching | TanStack Query + Supabase Realtime |
| Backend | Supabase: Postgres 17, Auth, RLS, Edge Functions (Deno), Realtime |
| Deposits/payouts (testnet) | BTCPay Server Greenfield API (`supabase/functions/_shared/btcpay.ts`) |
| KYC | Sumsub (WebSDK in portal, webhook to `kyc-webhook`) |
| AML | Pluggable `_shared/aml.ts`: `none` (testnet only) or `chainalysis` |
| DB tests | PGlite (`scripts/test-db.mjs`) with a stubbed `auth` schema |
| CI | GitHub Actions `.github/workflows/ci.yml` |

## Boundaries

- **Clients never write money tables.** All money movement goes through SQL functions
  (`post_journal`, `record_deposit`, `request_withdrawal`, …) granted only to
  `service_role` and called from Edge Functions after `getCaller()` auth.
- The only client writes allowed: `profiles(full_name, country)` and inserting
  `withdrawal_addresses(asset_code, address, memo_tag, label)`.
- Webhook functions (`btcpay-webhook`, `kyc-webhook`) have `verify_jwt = false` and
  authenticate by HMAC instead.
- Staff console and user portal share `packages/shared` but are separate apps and
  separate deployments.

## Storage model

Double-entry ledger: `ledger_accounts` → `journal_entries` → `ledger_lines`.
`amount > 0` = debit, `< 0` = credit. User accounts are credit-normal, so the user's
balance = −sum (view `user_balances`). Units for strategies are their own asset codes
(`U-…`, `assets.is_unit = true`).

## Invariants (never violate)

1. No balance column anywhere. Balances are derived from ledger lines.
2. `journal_entries`, `ledger_lines`, `audit_log`, `holdings_snapshots` and
   `reconciliation_runs` are append-only. Fix mistakes with reversing entries.
3. Every journal balances per asset (deferred constraint trigger).
4. Every credit has an `external_ref` (tx/payment id, custodian event, NAV report),
   which makes webhook retries idempotent.
5. Four-eyes: corrections, NAV publication and large withdrawals need two different
   people. Nobody approves their own withdrawal.
6. Money-moving and staff endpoints require an `aal2` (2FA) session.
7. Amounts are `numeric(38,18)` in SQL and `decimal.js` in TS. Never JS floats.
8. Secrets live in Supabase secrets / `supabase/functions/.env` (gitignored), never
   in the React bundle. The browser only has the anon key.
9. AML `none` must fail closed when `APP_ENV=production`.
10. A new migration never edits a previous one. Add a new timestamped file.
11. `video_to_reverse_engineer.mp4` is reference only. Never copy its scam
    patterns (see project-overview).

## Migrations so far

- `20261021000001_foundation.sql`: tenants, profiles, staff_roles, assets, ledger, audit, views, RLS
- `20261021000002_operations.sql`: kyc_cases, strategies, nav_reports, holdings, deposits, withdrawals, webhooks, recon
- `20261021000003_wallet_flows.sql`: withdrawal_limits + KYC/deposit/withdrawal SQL functions
