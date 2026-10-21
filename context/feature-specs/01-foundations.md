# Feature 01: Foundations (schema, RLS, auth, app shells)

*Written after the fact (2026-10-21), when the context folder was adopted. It records
what was built.*

## What

- Double-entry ledger with append-only and balance-per-asset enforcement in Postgres.
- Tenancy, profiles (auto-created on sign-up), staff roles, assets, audit log.
- Operations tables for later features: KYC cases, strategies, NAV reports,
  holdings snapshots, deposits, withdrawals, webhook events, reconciliation runs.
- RLS: users read only their own rows; staff read by role and tenant; clients can't
  write money tables.
- Passwordless email OTP + mandatory TOTP 2FA (`MfaGate`).
- User portal shell (dashboard with live balances and activity) and staff console shell.
- PGlite DB test harness, CI workflow, README, architecture doc, use case diagram.

## Why

The ledger and access rules are the product's credibility. Built first and tested,
so no later feature can bypass them.

## Acceptance (all met)

- `npm run test:db`: ledger invariants and RLS tests pass.
- Both apps build. The sign-in page renders without console errors.

## Deferred

- Generated Supabase types (`npm run db:types`): needs a running database.
- Live sign-in and 2FA run: needs local Docker or a hosted Supabase project.
