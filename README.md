# Crypto Deposit & Managed Yield Platform

Users deposit crypto, see their balance in real time, and invest in strategies run by the operator. Returns come from measured performance (units × published NAV), never from typed-in balances.

- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Use case diagram: [docs/use-case-diagram.svg](docs/use-case-diagram.svg)

## Repository layout

```
apps/web        React user portal (sign-in, 2FA, balances, activity)
apps/admin      React staff console (role-gated, read-only queues for now)
packages/shared Supabase client, auth screens (OTP + TOTP), money helpers, theme
supabase/       migrations, seed, (Edge Functions from Phase 1)
scripts/        test-db.mjs: runs migrations + invariant tests in PGlite
```

## Getting started

Requirements: Node 24+, Docker Desktop (for local Supabase).

```bash
npm install
npm run test:db          # no Docker needed: checks the ledger rules and RLS
npx supabase@latest init # first time only; creates supabase/config.toml
npx supabase@latest start
```

`supabase start` prints the API URL and anon key. Put them in `apps/web/.env.local` and `apps/admin/.env.local` (templates are copied from `.env.example`), then:

```bash
npx supabase@latest db reset   # applies migrations + seed.sql
npm run dev:web                # http://localhost:5173
npm run dev:admin              # http://localhost:5174
```

**Email codes locally:** open Mailpit at http://127.0.0.1:54324. Sign-in uses 6-digit codes, so the *Magic Link* email template must contain `{{ .Token }}` (Supabase Dashboard → Auth → Email Templates, or `[auth.email.template.magic_link]` in `config.toml`).

**Make yourself staff:** sign in once in the user portal, then in Supabase Studio's SQL editor:

```sql
insert into staff_roles (user_id, tenant_id, role)
select u.id, t.id, 'admin' from auth.users u, tenants t
where u.email = 'you@example.com' and t.slug = 'default';
```

## Ledger rules (enforced by the database)

| Rule | Where |
|---|---|
| Balances = sum of ledger lines; no balance column exists | `user_balances` view |
| Ledger, journals, audit log, snapshots are append-only | `forbid_mutation` triggers |
| Every journal balances per asset, checked at commit | `ledger_lines_balanced` constraint trigger |
| Only the service role can post journals | `post_journal` grants |
| Webhook retries can't double-credit | unique `(tenant, kind, external_ref)` |
| Corrections, NAV publication and withdrawals need two different people | check constraints |
| New withdrawal addresses wait 24h, and users can't override it | column grants + default |

`npm run test:db` checks every rule above. It also runs in CI (`.github/workflows/ci.yml`).

## Roadmap

- [x] **Phase 0**: schema, RLS, auth with mandatory 2FA, user portal shell, staff console shell, CI
- [ ] **Phase 1**: KYC provider, BTCPay Server (testnet) deposits → webhook → ledger, withdrawals with dual approval
- [ ] **Phase 2**: subscribe/redeem, holdings snapshots, NAV draft/publish, NAV charts
- [ ] **Phase 3**: reconciliation + alerts, statements, public proof-of-reserves page
- [ ] **Phase 4**: white-label tenant config and per-tenant deploys

> Operating this with real customer funds requires the licences described in ARCHITECTURE.md §9. Build and test on testnets only.
